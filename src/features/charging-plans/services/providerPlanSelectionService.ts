import Dexie from 'dexie';
import { db, type ProviderPlanSelection, type SyncOutbox, type SyncPayload, type TariffPriceSnapshot } from '../../../infra/db';

export interface SetActivePlanSelectionInput {
  userId: string;
  providerId: string;
  tariffPlanId: string;
  validFrom: Date;
  priceSnapshot: TariffPriceSnapshot;
}

/**
 * Persists the active selection change using the current Dexie transaction when
 * one exists, allowing callers to compose it atomically with other writes.
 */
export async function applyActivePlanSelectionChange(
  input: SetActivePlanSelectionInput
): Promise<ProviderPlanSelection> {
  const providerPlanSelections = Dexie.currentTransaction != null
    ? Dexie.currentTransaction.table<ProviderPlanSelection, string>('provider_plan_selections')
    : db.provider_plan_selections;
  const syncOutbox = Dexie.currentTransaction != null
    ? Dexie.currentTransaction.table<SyncOutbox, number>('sync_outbox')
    : db.sync_outbox;

  const current = await providerPlanSelections
    .where('provider_id')
    .equals(input.providerId)
    .filter((row) => row.user_id === input.userId && !row.deleted_at && row.valid_to == null)
    .first();

  const now = new Date();
  if (current) {
    await providerPlanSelections.update(current.id, { valid_to: input.validFrom, updated_at: now });
    const updatedCurrent = await providerPlanSelections.get(current.id);
    if (updatedCurrent) {
      await syncOutbox.add({
        table_name: 'provider_plan_selections',
        action: 'UPDATE',
        payload: updatedCurrent as SyncPayload,
        timestamp: now,
        retry_count: 0,
        last_attempt_at: undefined,
        next_attempt_at: undefined,
        last_error: undefined
      });
    }
  }

  const next: ProviderPlanSelection = {
    id: crypto.randomUUID(),
    user_id: input.userId,
    provider_id: input.providerId,
    tariff_plan_id: input.tariffPlanId,
    valid_from: input.validFrom,
    valid_to: null,
    price_snapshot: structuredClone(input.priceSnapshot),
    created_at: now,
    updated_at: now
  };

  await providerPlanSelections.add(next);
  await syncOutbox.add({
    table_name: 'provider_plan_selections',
    action: 'INSERT',
    payload: next as SyncPayload,
    timestamp: now,
    retry_count: 0,
    last_attempt_at: undefined,
    next_attempt_at: undefined,
    last_error: undefined
  });

  return next;
}

export async function setActivePlanSelection(input: SetActivePlanSelectionInput): Promise<ProviderPlanSelection> {
  return db.transaction('rw', db.provider_plan_selections, db.sync_outbox, async () => {
    return applyActivePlanSelectionChange(input);
  });
}

export async function getProviderPlanSelections(providerId: string, userId: string): Promise<ProviderPlanSelection[]> {
  return db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter((row) => row.user_id === userId && !row.deleted_at)
    .sortBy('valid_from');
}

export async function getActivePlanSelectionAt(providerId: string, userId: string, at: Date): Promise<ProviderPlanSelection | null> {
  const rows = await db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter((row) => row.user_id === userId && !row.deleted_at && row.valid_from <= at && (row.valid_to == null || row.valid_to > at))
    .toArray();

  return rows[0] ?? null;
}
