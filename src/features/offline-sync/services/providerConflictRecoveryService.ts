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
  type SyncOutbox,
} from '../../../infra/db';
import { supabase } from '../../../infra/supabase';
import {
  createProviderConflictRecoveryReviewVersion,
  type PrepareProviderConflictRecoveryInput,
  type ProviderConflictRecoveryPreparation,
} from '../model/providerConflictRecovery';
import { createCanonicalSerialization } from '../model/canonicalSerialization';
import { isTypedTerminalProviderNameConflict } from '../model/syncFailure';

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
    return { status: 'already-reconciled' };
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

function inspectLocalGraph(graph: LocalGraph, staged: Provider, userId: string): LocalGraph | null {
  const plans = graph.plans.filter((plan) => plan.provider_id === staged.id);
  const selections = graph.selections.filter((selection) => selection.provider_id === staged.id);
  const sessions = graph.sessions.filter(
    (session): session is Extract<ChargingSession, { session_mode: 'plan' }> => (
      session.session_mode === 'plan' && session.provider_id === staged.id
    ),
  );
  const outbox = graph.outbox.filter((item) => referencesProvider(item, staged.id));

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

function blocked(): ProviderConflictRecoveryPreparation {
  return { status: 'blocked', reason: BLOCKED_REASON };
}

function retryable(): ProviderConflictRecoveryPreparation {
  return { status: 'retryable-error', reason: RETRYABLE_REASON };
}
