import {
  evaluateProviderRebindTariffConflicts,
  getProviderNameValidationError,
  normalizeProviderName,
} from '../../charging-plans';
import {
  db,
  type ChargingPlan,
  type ChargingSession,
  type Provider,
  type ProviderPlanSelection,
  type ProviderReconciliation,
  type SyncPayload,
  type SyncOutbox,
} from '../../../infra/db';
import { supabase } from '../../../infra/supabase';
import {
  createProviderConflictRecoveryReviewVersion,
  type PrepareProviderConflictRecoveryInput,
  type ProviderConflictRecoveryDescriptor,
  type ProviderConflictRecoveryPreparation,
} from '../model/providerConflictRecovery';
import { createCanonicalSerialization } from '../model/canonicalSerialization';
import { isTypedTerminalProviderNameConflict } from '../model/syncFailure';
import { runSyncRuntimeExclusive } from './syncRuntime';

const BLOCKED_REASON = 'This provider conflict cannot be recovered safely.';
const RETRYABLE_REASON = 'Provider conflict verification could not be completed. Please try again.';
const PROVIDER_SELECT = 'id, user_id, name, created_at, updated_at, deleted_at';
const CHARGING_PLAN_SELECT = [
  'id', 'user_id', 'provider_id', 'name', 'valid_from', 'valid_to',
  'ac_price_per_kwh', 'dc_price_per_kwh', 'roaming_ac_price_per_kwh',
  'roaming_dc_price_per_kwh', 'monthly_base_fee', 'session_fee',
  'affiliation', 'notes', 'created_at', 'updated_at', 'deleted_at',
].join(', ');

interface LocalGraph {
  providers: Provider[];
  plans: ChargingPlan[];
  selections: ProviderPlanSelection[];
  sessions: ChargingSession[];
  outbox: SyncOutbox[];
}

interface RemoteProvider {
  id: string;
  user_id: string;
  name: string;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at?: string | Date | null;
}

/** User-safe result returned after a confirmation attempt. */
export type ProviderConflictRecoveryConfirmation =
  | { status: 'reconciled' }
  | { status: 'already-reconciled' }
  | { status: 'blocked'; reason: string }
  | { status: 'retryable-error'; reason: string };

/**
 * Performs read-only eligibility, graph, authentication, and remote preflight
 * checks before a provider-conflict confirmation can be shown.
 */
export async function prepareProviderConflictRecovery(
  input: PrepareProviderConflictRecoveryInput,
): Promise<ProviderConflictRecoveryPreparation> {
  if (!isRecoveryInput(input) || await getAuthenticatedUserId() !== input.userId) {
    return blocked();
  }

  const completed = await db.provider_reconciliations.get(input.terminalOutboxId);
  if (completed?.user_id === input.userId) {
    return await hasVerifiedCompletedReconciliation(completed)
      ? { status: 'already-reconciled' }
      : blocked();
  }

  const terminalOutbox = await db.sync_outbox.get(input.terminalOutboxId);
  if (!isTerminalProviderConflict(terminalOutbox, input.userId)) {
    return blocked();
  }

  const stagedProvider = await db.providers.get(terminalOutbox.payload.id);
  if (!isMatchingStagedProvider(stagedProvider, terminalOutbox.payload, input.userId)) {
    return blocked();
  }

  const localGraph = await readLocalGraph();
  const inspection = inspectLocalGraph(localGraph, stagedProvider, input.userId);
  if (!inspection) {
    return blocked();
  }

  const providerResult = await supabase
    .from('providers')
    .select(PROVIDER_SELECT)
    .is('deleted_at', null) as unknown as { data: unknown; error: unknown };
  if (await getAuthenticatedUserId() !== input.userId) {
    return blocked();
  }
  if (providerResult.error) {
    return retryable();
  }

  const canonicalProvider = findCanonicalProvider(providerResult.data, stagedProvider, input.userId);
  if (!canonicalProvider) {
    return blocked();
  }

  if (await getAuthenticatedUserId() !== input.userId) {
    return blocked();
  }

  const planResult = await supabase
    .from('charging_plans')
    .select(CHARGING_PLAN_SELECT)
    .eq('provider_id', canonicalProvider.id) as unknown as { data: unknown; error: unknown };
  if (await getAuthenticatedUserId() !== input.userId) {
    return blocked();
  }
  if (planResult.error) {
    return retryable();
  }

  const canonicalPlans = toRemoteChargingPlans(planResult.data, input.userId, canonicalProvider.id);
  if (!canonicalPlans || !hasCompatibleCanonicalLocalGraph(
    localGraph,
    canonicalProvider,
    canonicalPlans,
    input.userId,
  ) || evaluateProviderRebindTariffConflicts({
    stagedPlans: inspection.plans,
    canonicalPlans,
  }).kind !== 'safe') {
    return blocked();
  }

  const reviewVersion = createProviderConflictRecoveryReviewVersion({
    authenticatedUserId: input.userId,
    terminalOutbox,
    stagedProvider,
    canonicalProvider,
    local: {
      plans: sortRows(inspection.plans),
      selections: sortRows(inspection.selections),
      sessions: sortRows(inspection.sessions),
      outbox: sortOutbox(inspection.outbox),
    },
    remote: { canonicalPlans: sortRows(canonicalPlans) },
  });

  return {
    status: 'ready',
    descriptor: {
      userId: input.userId,
      terminalOutboxId: input.terminalOutboxId,
      stagedProviderId: stagedProvider.id,
      canonicalProviderId: canonicalProvider.id,
      affectedRowIds: {
        chargingPlanIds: inspection.plans.map(({ id }) => id).sort(),
        selectionIds: inspection.selections.map(({ id }) => id).sort(),
        sessionIds: inspection.sessions.map(({ id }) => id).sort(),
      },
      affectedOutboxIds: inspection.outbox.flatMap(({ id }) => id == null ? [] : [id]).sort((a, b) => a - b),
      reviewVersion,
    },
    summary: {
      chargingPlanCount: inspection.plans.length,
      selectionCount: inspection.selections.length,
      sessionCount: inspection.sessions.length,
      outboxCount: inspection.outbox.length,
    },
  };
}

/**
 * Reconciles a reviewed no-reference conflict under sync exclusion and one
 * local transaction. Broader graphs remain blocked until their explicit
 * confirmation contracts are implemented.
 */
export async function confirmProviderConflictRecovery(
  descriptor: ProviderConflictRecoveryDescriptor,
): Promise<ProviderConflictRecoveryConfirmation> {
  return runSyncRuntimeExclusive(async () => {
    const refreshed = await prepareProviderConflictRecovery({
      userId: descriptor.userId,
      terminalOutboxId: descriptor.terminalOutboxId,
    });
    if (refreshed.status === 'already-reconciled') {
      return refreshed;
    }
    if (refreshed.status === 'blocked' || refreshed.status === 'retryable-error') {
      return refreshed;
    }
    if (refreshed.descriptor.reviewVersion !== descriptor.reviewVersion) {
      return blocked();
    }

    const canonicalProvider = await getRemoteCanonicalProvider(
      descriptor.userId,
      descriptor.canonicalProviderId,
    );
    if (!canonicalProvider) {
      return blocked();
    }
    const canonicalPlans = await getRemoteCanonicalPlans(
      descriptor.userId,
      descriptor.canonicalProviderId,
    );
    if (!canonicalPlans) {
      return retryable();
    }

    return db.transaction(
      'rw',
      [
        db.providers,
        db.charging_plans,
        db.provider_plan_selections,
        db.sessions,
        db.sync_outbox,
        db.provider_reconciliations,
      ],
      async (): Promise<ProviderConflictRecoveryConfirmation> => {
        const terminalOutbox = await db.sync_outbox.get(descriptor.terminalOutboxId);
        if (!isTerminalProviderConflict(terminalOutbox, descriptor.userId)
          || terminalOutbox.payload.id !== descriptor.stagedProviderId) {
          return blocked();
        }
        const stagedProvider = await db.providers.get(descriptor.stagedProviderId);
        if (!isMatchingStagedProvider(stagedProvider, terminalOutbox.payload, descriptor.userId)) {
          return blocked();
        }
        const [providers, plans, selections, sessions, outbox] = await Promise.all([
          db.providers.toArray(),
          db.charging_plans.toArray(),
          db.provider_plan_selections.toArray(),
          db.sessions.toArray(),
          db.sync_outbox.toArray(),
        ]);
        const inspection = inspectLocalGraph(
          { providers, plans, selections, sessions, outbox },
          stagedProvider,
          descriptor.userId,
        );
        if (!inspection || !matchesConfirmationDescriptor(descriptor, inspection)) {
          return blocked();
        }

        const currentReviewVersion = createProviderConflictRecoveryReviewVersion({
          authenticatedUserId: descriptor.userId,
          terminalOutbox,
          stagedProvider,
          canonicalProvider,
          local: {
            plans: sortRows(inspection.plans),
            selections: sortRows(inspection.selections),
            sessions: sortRows(inspection.sessions),
            outbox: sortOutbox(inspection.outbox),
          },
          remote: { canonicalPlans: sortRows(canonicalPlans) },
        });
        if (currentReviewVersion !== descriptor.reviewVersion) {
          return blocked();
        }

        const reboundPlans = inspection.plans.map((plan) => ({
          ...plan,
          provider_id: descriptor.canonicalProviderId,
        }));
        const reboundSelections = inspection.selections.map((selection) => ({
          ...selection,
          provider_id: descriptor.canonicalProviderId,
        }));
        const reboundSessions: Array<Extract<ChargingSession, { session_mode: 'plan' }>> = inspection.sessions.map((session) => ({
          ...session,
          provider_id: descriptor.canonicalProviderId,
        } as Extract<ChargingSession, { session_mode: 'plan' }>));
        const reboundPlansById = new Map(reboundPlans.map((plan) => [plan.id, plan]));
        const reboundSelectionsById = new Map(reboundSelections.map((selection) => [selection.id, selection]));
        const reboundSessionsById = new Map(reboundSessions.map((session) => [session.id, session]));
        const rewrittenOutbox = inspection.outbox.map((item) => ({
          item,
          payload: getReboundOutboxPayload(
            item,
            reboundPlansById,
            reboundSelectionsById,
            reboundSessionsById,
          ),
        }));
        if (rewrittenOutbox.some(({ payload }) => payload === null)) {
          return blocked();
        }

        await db.providers.put(toLocalProvider(canonicalProvider));
        await db.charging_plans.bulkPut(reboundPlans);
        await db.provider_plan_selections.bulkPut(reboundSelections);
        await db.sessions.bulkPut(reboundSessions);
        for (const { item, payload } of rewrittenOutbox) {
          const rewritten: SyncOutbox = {
            ...item,
            payload: payload!,
          };
          delete rewritten.retry_count;
          delete rewritten.last_attempt_at;
          delete rewritten.next_attempt_at;
          delete rewritten.last_error;
          delete rewritten.failure_kind;
          await db.sync_outbox.put(rewritten);
        }
        await db.sync_outbox.delete(descriptor.terminalOutboxId);
        await db.providers.delete(descriptor.stagedProviderId);
        await db.provider_reconciliations.add({
          terminal_outbox_id: descriptor.terminalOutboxId,
          user_id: descriptor.userId,
          staged_provider_id: descriptor.stagedProviderId,
          canonical_provider_id: descriptor.canonicalProviderId,
          affected_row_ids: {
            charging_plan_ids: [...descriptor.affectedRowIds.chargingPlanIds],
            selection_ids: [...descriptor.affectedRowIds.selectionIds],
            session_ids: [...descriptor.affectedRowIds.sessionIds],
          },
          affected_outbox_ids: [...descriptor.affectedOutboxIds],
          review_serialization: descriptor.reviewVersion,
          completed_at: new Date(),
        });
        return { status: 'reconciled' };
      },
    );
  });
}

function isRecoveryInput(input: PrepareProviderConflictRecoveryInput): boolean {
  return input.userId.length > 0
    && Number.isSafeInteger(input.terminalOutboxId)
    && input.terminalOutboxId > 0;
}

async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return error || typeof data.user?.id !== 'string' ? null : data.user.id;
  } catch {
    return null;
  }
}

async function getRemoteCanonicalProvider(userId: string, providerId: string): Promise<RemoteProvider | null> {
  const result = await supabase
    .from('providers')
    .select(PROVIDER_SELECT)
    .eq('id', providerId)
    .is('deleted_at', null) as unknown as { data: unknown; error: unknown };
  if (await getAuthenticatedUserId() !== userId || result.error || !Array.isArray(result.data)) {
    return null;
  }
  const matches = result.data.filter(isRemoteProvider)
    .filter((provider) => provider.id === providerId && provider.user_id === userId && !provider.deleted_at);
  return matches.length === 1 ? matches[0] : null;
}

async function getRemoteCanonicalPlans(userId: string, providerId: string): Promise<ChargingPlan[] | null> {
  const result = await supabase
    .from('charging_plans')
    .select(CHARGING_PLAN_SELECT)
    .eq('provider_id', providerId) as unknown as { data: unknown; error: unknown };
  if (await getAuthenticatedUserId() !== userId || result.error) {
    return null;
  }
  return toRemoteChargingPlans(result.data, userId, providerId);
}

function matchesConfirmationDescriptor(
  descriptor: ProviderConflictRecoveryDescriptor,
  inspection: LocalGraph,
): boolean {
  const equalIds = (left: readonly string[] | readonly number[], right: readonly string[] | readonly number[]) => (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
  const planIds = inspection.plans.map((plan) => plan.id).sort();
  const selectionIds = inspection.selections.map((selection) => selection.id).sort();
  const sessionIds = inspection.sessions.map((session) => session.id).sort();
  const outboxIds = inspection.outbox.flatMap((item) => item.id == null ? [] : [item.id]).sort((left, right) => left - right);
  return equalIds(descriptor.affectedRowIds.chargingPlanIds, planIds)
    && equalIds(descriptor.affectedRowIds.selectionIds, selectionIds)
    && equalIds(descriptor.affectedRowIds.sessionIds, sessionIds)
    && equalIds(descriptor.affectedOutboxIds, outboxIds);
}

function getReboundOutboxPayload(
  item: SyncOutbox,
  plans: ReadonlyMap<string, ChargingPlan>,
  selections: ReadonlyMap<string, ProviderPlanSelection>,
  sessions: ReadonlyMap<string, Extract<ChargingSession, { session_mode: 'plan' }>>,
): SyncPayload | null {
  switch (item.table_name) {
    case 'charging_plans':
      return plans.get(item.payload.id) ?? null;
    case 'provider_plan_selections':
      return selections.get(item.payload.id) ?? null;
    case 'sessions':
      return sessions.get(item.payload.id) ?? null;
    case 'providers':
      return null;
  }
}

function isTerminalProviderConflict(item: SyncOutbox | undefined, userId: string): item is SyncOutbox & { id: number; payload: Provider } {
  return item?.id !== undefined
    && item.table_name === 'providers'
    && item.action === 'INSERT'
    && isTypedTerminalProviderNameConflict(item)
    && isProvider(item.payload)
    && item.payload.user_id === userId;
}

function isMatchingStagedProvider(staged: Provider | undefined, payload: Provider, userId: string): staged is Provider {
  return staged !== undefined
    && !staged.deleted_at
    && staged.id === payload.id
    && staged.user_id === userId
    && staged.name === payload.name;
}

async function hasVerifiedCompletedReconciliation(evidence: ProviderReconciliation): Promise<boolean> {
  const [
    stagedProvider,
    canonicalProvider,
    terminalOutbox,
    plans,
    selections,
    sessions,
    outbox,
  ] = await Promise.all([
    db.providers.get(evidence.staged_provider_id),
    db.providers.get(evidence.canonical_provider_id),
    db.sync_outbox.get(evidence.terminal_outbox_id),
    db.charging_plans.bulkGet(evidence.affected_row_ids.charging_plan_ids),
    db.provider_plan_selections.bulkGet(evidence.affected_row_ids.selection_ids),
    db.sessions.bulkGet(evidence.affected_row_ids.session_ids),
    db.sync_outbox.toArray(),
  ]);

  return stagedProvider === undefined
    && canonicalProvider !== undefined
    && canonicalProvider.user_id === evidence.user_id
    && !canonicalProvider.deleted_at
    && terminalOutbox === undefined
    && plans.every((plan) => plan?.user_id === evidence.user_id && plan.provider_id === evidence.canonical_provider_id)
    && selections.every((selection) => selection?.user_id === evidence.user_id && selection.provider_id === evidence.canonical_provider_id)
    && sessions.every((session) => session?.user_id === evidence.user_id
      && session.session_mode === 'plan'
      && session.provider_id === evidence.canonical_provider_id)
    && outbox.every((item) => hasCanonicalEvidenceOutboxPayload(item, evidence))
    && !outbox.some((item) => referencesProvider(item, evidence.staged_provider_id));
}

function hasCanonicalEvidenceOutboxPayload(
  item: SyncOutbox,
  evidence: ProviderReconciliation,
): boolean {
  if (!evidence.affected_outbox_ids.includes(item.id ?? Number.NaN)) {
    return true;
  }

  switch (item.table_name) {
    case 'charging_plans':
      return evidence.affected_row_ids.charging_plan_ids.includes(item.payload.id)
        && (item.payload as ChargingPlan).provider_id === evidence.canonical_provider_id;
    case 'provider_plan_selections':
      return evidence.affected_row_ids.selection_ids.includes(item.payload.id)
        && (item.payload as ProviderPlanSelection).provider_id === evidence.canonical_provider_id;
    case 'sessions':
      return evidence.affected_row_ids.session_ids.includes(item.payload.id)
        && (item.payload as ChargingSession).session_mode === 'plan'
        && (item.payload as Extract<ChargingSession, { session_mode: 'plan' }>).provider_id === evidence.canonical_provider_id;
    case 'providers':
      return false;
  }
}

async function readLocalGraph(): Promise<LocalGraph> {
  const [providers, plans, selections, sessions, outbox] = await Promise.all([
    db.providers.toArray(),
    db.charging_plans.toArray(),
    db.provider_plan_selections.toArray(),
    db.sessions.toArray(),
    db.sync_outbox.toArray(),
  ]);
  return { providers, plans, selections, sessions, outbox };
}

function hasCompatibleCanonicalLocalGraph(
  graph: LocalGraph,
  canonical: RemoteProvider,
  remotePlans: ChargingPlan[],
  userId: string,
): boolean {
  const localCanonicalProvider = graph.providers.find((provider) => provider.id === canonical.id);
  if (localCanonicalProvider && !matchesRemoteProvider(localCanonicalProvider, canonical, userId)) {
    return false;
  }

  const remotePlansById = new Map(remotePlans.map((plan) => [plan.id, plan]));
  for (const localPlan of graph.plans.filter((plan) => plan.provider_id === canonical.id)) {
    const remotePlan = remotePlansById.get(localPlan.id);
    if (!remotePlan || !matchesRemoteChargingPlan(localPlan, remotePlan)) {
      return false;
    }
  }

  return !graph.outbox.some((item) => referencesProvider(item, canonical.id));
}

function matchesRemoteChargingPlan(local: ChargingPlan, remote: ChargingPlan): boolean {
  return createCanonicalSerialization(toCanonicalRemotePlanShape(local))
    === createCanonicalSerialization(toCanonicalRemotePlanShape(remote));
}

function toCanonicalRemotePlanShape(plan: ChargingPlan): Record<string, unknown> {
  return {
    id: plan.id,
    user_id: plan.user_id,
    provider_id: plan.provider_id,
    name: plan.name,
    valid_from: plan.valid_from,
    valid_to: plan.valid_to ?? null,
    ac_price_per_kwh: plan.ac_price_per_kwh ?? null,
    dc_price_per_kwh: plan.dc_price_per_kwh ?? null,
    roaming_ac_price_per_kwh: plan.roaming_ac_price_per_kwh ?? null,
    roaming_dc_price_per_kwh: plan.roaming_dc_price_per_kwh ?? null,
    monthly_base_fee: plan.monthly_base_fee,
    session_fee: plan.session_fee,
    affiliation: plan.affiliation ?? null,
    notes: plan.notes ?? null,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    deleted_at: plan.deleted_at ?? null,
  };
}

function matchesRemoteProvider(local: Provider, remote: RemoteProvider, userId: string): boolean {
  const remoteCreatedAt = asDate(remote.created_at);
  const remoteUpdatedAt = asDate(remote.updated_at);
  const remoteDeletedAt = remote.deleted_at == null ? undefined : asDate(remote.deleted_at);
  return remoteCreatedAt !== null
    && remoteUpdatedAt !== null
    && (remote.deleted_at == null || remoteDeletedAt !== null)
    && local.user_id === userId
    && local.name === remote.name
    && local.created_at.getTime() === remoteCreatedAt.getTime()
    && local.updated_at.getTime() === remoteUpdatedAt.getTime()
    && (local.deleted_at?.getTime() ?? undefined) === (remoteDeletedAt?.getTime() ?? undefined);
}

function toLocalProvider(remote: RemoteProvider): Provider {
  const createdAt = asDate(remote.created_at);
  const updatedAt = asDate(remote.updated_at);
  const deletedAt = remote.deleted_at == null ? undefined : asDate(remote.deleted_at);
  if (!createdAt || !updatedAt || (remote.deleted_at != null && !deletedAt)) {
    throw new Error('Canonical provider has invalid date metadata');
  }
  return {
    id: remote.id,
    user_id: remote.user_id,
    name: remote.name,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: deletedAt ?? undefined,
  };
}

function inspectLocalGraph(graph: LocalGraph, staged: Provider, userId: string): LocalGraph | null {
  const plans = graph.plans.filter((plan) => plan.provider_id === staged.id);
  const selections = graph.selections.filter((selection) => selection.provider_id === staged.id);
  const sessions = graph.sessions.filter(
    (session): session is Extract<ChargingSession, { session_mode: 'plan' }> => (
      session.session_mode === 'plan' && session.provider_id === staged.id
    ),
  );
  const outbox = graph.outbox.filter((item) => (
    referencesProvider(item, staged.id)
    && !isTypedTerminalProviderNameConflict(item)
  ));

  if ([...plans, ...selections, ...sessions].some((row) => row.user_id !== userId)
    || outbox.some((item) => item.payload.user_id !== userId)) {
    return null;
  }

  const planIds = new Set(plans.map(({ id }) => id));
  if (selections.some((selection) => !planIds.has(selection.tariff_plan_id))
    || sessions.some((session) => !planIds.has(session.tariff_plan_id))) {
    return null;
  }

  return { providers: graph.providers, plans, selections, sessions, outbox };
}

function referencesProvider(item: SyncOutbox, providerId: string): boolean {
  switch (item.table_name) {
    case 'providers':
      return item.payload.id === providerId;
    case 'charging_plans':
      return (item.payload as ChargingPlan).provider_id === providerId;
    case 'provider_plan_selections':
      return (item.payload as ProviderPlanSelection).provider_id === providerId;
    case 'sessions':
      return (item.payload as ChargingSession).session_mode === 'plan'
        && (item.payload as Extract<ChargingSession, { session_mode: 'plan' }>).provider_id === providerId;
  }
}

function findCanonicalProvider(data: unknown, staged: Provider, userId: string): RemoteProvider | null {
  if (!Array.isArray(data) || getProviderNameValidationError(staged.name)) return null;
  const candidates = data.filter(isRemoteProvider)
    .filter((provider) => provider.user_id === userId && !provider.deleted_at)
    .filter((provider) => !getProviderNameValidationError(provider.name))
    .filter((provider) => normalizedProviderName(provider.name) === normalizedProviderName(staged.name));
  const distinct = new Map(candidates.map((provider) => [provider.id, provider]));
  if (distinct.size !== 1) return null;

  const canonical = distinct.values().next().value as RemoteProvider;
  return canonical.id === staged.id ? null : canonical;
}

function isRemoteProvider(value: unknown): value is RemoteProvider {
  if (!value || typeof value !== 'object') return false;
  const provider = value as Record<string, unknown>;
  return typeof provider.id === 'string'
    && typeof provider.user_id === 'string'
    && typeof provider.name === 'string'
    && isDateLike(provider.created_at)
    && isDateLike(provider.updated_at)
    && (provider.deleted_at === undefined || provider.deleted_at === null || isDateLike(provider.deleted_at));
}

function normalizedProviderName(name: string): string {
  return normalizeProviderName(name).toLocaleLowerCase();
}

function toRemoteChargingPlans(data: unknown, userId: string, providerId: string): ChargingPlan[] | null {
  if (!Array.isArray(data)) return null;
  const plans: ChargingPlan[] = [];
  for (const value of data) {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (raw.user_id !== userId || raw.provider_id !== providerId
      || typeof raw.id !== 'string' || typeof raw.name !== 'string'
      || typeof raw.monthly_base_fee !== 'number' || typeof raw.session_fee !== 'number') {
      return null;
    }
    const validFrom = asDate(raw.valid_from);
    const createdAt = asDate(raw.created_at);
    const updatedAt = asDate(raw.updated_at);
    const validTo = raw.valid_to == null ? raw.valid_to : asDate(raw.valid_to);
    const deletedAt = raw.deleted_at == null ? raw.deleted_at : asDate(raw.deleted_at);
    if (!validFrom || !createdAt || !updatedAt || (raw.valid_to != null && !validTo) || (raw.deleted_at != null && !deletedAt)) {
      return null;
    }
    plans.push({
      ...raw,
      id: raw.id,
      user_id: userId,
      provider_id: providerId,
      name: raw.name,
      valid_from: validFrom,
      valid_to: validTo as Date | null | undefined,
      monthly_base_fee: raw.monthly_base_fee,
      session_fee: raw.session_fee,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: deletedAt as Date | undefined,
    } as ChargingPlan);
  }
  return plans;
}

function isProvider(value: unknown): value is Provider {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as Provider).id === 'string'
    && typeof (value as Provider).user_id === 'string'
    && typeof (value as Provider).name === 'string';
}

function isDateLike(value: unknown): value is string | Date {
  return (typeof value === 'string' && !Number.isNaN(Date.parse(value))) || value instanceof Date;
}

function asDate(value: unknown): Date | null {
  if (!isDateLike(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sortRows<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function sortOutbox(rows: readonly SyncOutbox[]): SyncOutbox[] {
  return [...rows].sort((left, right) => (left.id ?? -1) - (right.id ?? -1));
}

function blocked(): { status: 'blocked'; reason: string } {
  return { status: 'blocked', reason: BLOCKED_REASON };
}

function retryable(): { status: 'retryable-error'; reason: string } {
  return { status: 'retryable-error', reason: RETRYABLE_REASON };
}
