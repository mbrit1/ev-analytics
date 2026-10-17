import Dexie from 'dexie';
import { createSyncOutboxEntry, db, type ProviderPlanSelection, type SyncOutbox, type TariffPriceSnapshot } from '../../../infra/db';
import { assertOwnedProviderReference } from './providerService';

/** Input for appending an owner-scoped selection event to a provider history. */
export interface SetActivePlanSelectionInput {
  userId: string;
  providerId: string;
  tariffPlanId: string;
  validFrom: Date;
  priceSnapshot: TariffPriceSnapshot;
}

/** Input used by session persistence, which may reuse an existing row without a snapshot. */
export type PlanSessionSelectionInput = Omit<SetActivePlanSelectionInput, 'priceSnapshot'> & {
  priceSnapshot?: TariffPriceSnapshot;
};

const compareSelectionPrecedence = (left: ProviderPlanSelection, right: ProviderPlanSelection): number => {
  const startDifference = right.valid_from.getTime() - left.valid_from.getTime();
  if (startDifference !== 0) {
    return startDifference;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? 1 : -1;
};

const currentSelectionTable = () => Dexie.currentTransaction != null
  ? Dexie.currentTransaction.table<ProviderPlanSelection, string>('provider_plan_selections')
  : db.provider_plan_selections;

const currentOutboxTable = () => Dexie.currentTransaction != null
  ? Dexie.currentTransaction.table<SyncOutbox, number>('sync_outbox')
  : db.sync_outbox;

async function getProviderRows(providerId: string, userId: string): Promise<ProviderPlanSelection[]> {
  return currentSelectionTable()
    .where('provider_id')
    .equals(providerId)
    .filter((row) => row.user_id === userId)
    .toArray();
}

function assertFiniteStart(validFrom: Date): number {
  const start = validFrom instanceof Date ? validFrom.getTime() : Number.NaN;
  if (!Number.isFinite(start)) {
    throw new Error('Selection valid_from must be a finite date');
  }
  return start;
}

function assertUnambiguousMutationHistory(rows: ProviderPlanSelection[]): void {
  for (const row of rows) {
    const start = row.valid_from instanceof Date ? row.valid_from.getTime() : Number.NaN;
    const end = row.valid_to == null
      ? null
      : row.valid_to instanceof Date ? row.valid_to.getTime() : Number.NaN;
    if (!Number.isFinite(start) || (end != null && !Number.isFinite(end)) || (end != null && end < start)) {
      throw new Error('Cannot change malformed provider plan selection history');
    }
  }

  const ordered = [...rows].sort((left, right) => {
    const difference = left.valid_from.getTime() - right.valid_from.getTime();
    if (difference !== 0) {
      return difference;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const active = ordered.filter((row) => !row.deleted_at && (row.valid_to == null || row.valid_to.getTime() > row.valid_from.getTime()));
  for (let index = 0; index < active.length; index += 1) {
    const current = active[index];
    const next = active[index + 1];
    if (next && (current.valid_to == null || next.valid_from.getTime() < current.valid_to.getTime())) {
      throw new Error('Cannot change overlapping provider plan selection history');
    }
  }
}

function chooseCoveringSelection(rows: ProviderPlanSelection[], at: Date): ProviderPlanSelection | null {
  return rows
    .filter((row) => !row.deleted_at
      && row.valid_from.getTime() <= at.getTime()
      && (row.valid_to == null || row.valid_to.getTime() > at.getTime()))
    .sort(compareSelectionPrecedence)[0] ?? null;
}

async function insertSelectionEvent(input: SetActivePlanSelectionInput): Promise<ProviderPlanSelection> {
  const start = assertFiniteStart(input.validFrom);
  await assertOwnedProviderReference(input.userId, input.providerId);
  const table = currentSelectionTable();
  const outbox = currentOutboxTable();
  const rows = await getProviderRows(input.providerId, input.userId);
  assertUnambiguousMutationHistory(rows);

  const now = new Date();
  const next: ProviderPlanSelection = {
    id: crypto.randomUUID(),
    user_id: input.userId,
    provider_id: input.providerId,
    tariff_plan_id: input.tariffPlanId,
    valid_from: new Date(start),
    valid_to: null,
    price_snapshot: structuredClone(input.priceSnapshot),
    created_at: now,
    updated_at: now,
  };

  const predecessor = chooseCoveringSelection(rows, input.validFrom);
  const successor = rows
    .filter((row) => row.valid_from.getTime() > start || (row.valid_from.getTime() === start && row.id > next.id))
    .sort((left, right) => left.valid_from.getTime() - right.valid_from.getTime()
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
  const losesEqualStart = successor?.valid_from.getTime() === start;

  if (successor) {
    next.valid_to = new Date(successor.valid_from);
  }

  if (!losesEqualStart && predecessor && (predecessor.valid_to == null || predecessor.valid_to.getTime() > start)) {
    const updatedAt = new Date();
    await table.update(predecessor.id, { valid_to: new Date(start), updated_at: updatedAt });
    const updatedPredecessor = await table.get(predecessor.id);
    if (updatedPredecessor) {
      await outbox.add(createSyncOutboxEntry(
        'provider_plan_selections',
        'UPDATE',
        updatedPredecessor,
        updatedAt,
      ));
    }
  }

  await table.add(next);
  await outbox.add(createSyncOutboxEntry('provider_plan_selections', 'INSERT', next, now));
  return next;
}

async function withSelectionTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (Dexie.currentTransaction != null) {
    return work();
  }
  return db.transaction('rw', db.providers, db.provider_plan_selections, db.sync_outbox, work);
}

/**
 * Appends a requested selection event, preserving switch-back history and
 * assigning half-open boundaries from the surrounding timeline events.
 */
export async function applyActivePlanSelectionChange(
  input: SetActivePlanSelectionInput
): Promise<ProviderPlanSelection> {
  return withSelectionTransaction(() => insertSelectionEvent(input));
}

/**
 * Reuses the canonical selection covering the requested instant when it
 * matches the plan; otherwise appends a new event within the active transaction.
 */
export async function applyPlanSelectionForSession(
  input: PlanSessionSelectionInput
): Promise<ProviderPlanSelection> {
  return withSelectionTransaction(async () => {
    assertFiniteStart(input.validFrom);
    await assertOwnedProviderReference(input.userId, input.providerId);
    const rows = await getProviderRows(input.providerId, input.userId);
    const covering = chooseCoveringSelection(rows, input.validFrom);
    if (covering?.tariff_plan_id === input.tariffPlanId) {
      return covering;
    }
    if (!input.priceSnapshot) {
      throw new Error('A price snapshot is required to create provider plan selection history');
    }
    return insertSelectionEvent({ ...input, priceSnapshot: input.priceSnapshot });
  });
}

export async function setActivePlanSelection(input: SetActivePlanSelectionInput): Promise<ProviderPlanSelection> {
  return applyActivePlanSelectionChange(input);
}

export async function getProviderPlanSelections(providerId: string, userId: string): Promise<ProviderPlanSelection[]> {
  return db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter((row) => row.user_id === userId && !row.deleted_at)
    .sortBy('valid_from');
}

/** Returns the canonical covering selection across every plan for this provider. */
export async function getActivePlanSelectionAt(providerId: string, userId: string, at: Date): Promise<ProviderPlanSelection | null> {
  assertFiniteStart(at);
  const rows = await db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter((row) => row.user_id === userId)
    .toArray();
  return chooseCoveringSelection(rows, at);
}
