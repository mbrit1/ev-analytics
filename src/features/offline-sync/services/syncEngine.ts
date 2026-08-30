import {
  db,
  type SyncOutbox,
  type Provider,
  type ChargingPlan,
  type ChargingSession,
  type ProviderPlanSelection
} from '../../../infra/db';
import { supabase } from '../../../infra/supabase';
import type { InitialSyncResult } from '../model/types';
import { createCanonicalSerialization } from '../model/canonicalSerialization';
import {
  getLiveSyncFailureKind,
  isLegacyTerminalProviderNameConflict,
  isTypedTerminalProviderNameConflict,
  PROVIDER_NAME_CONFLICT_ERROR_MESSAGE,
} from '../model/syncFailure';

const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const REMOTE_PROVIDER_COLUMNS = [
  'id',
  'user_id',
  'name',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;
const REMOTE_CHARGING_PLAN_COLUMNS = [
  'id',
  'user_id',
  'provider_id',
  'name',
  'valid_from',
  'valid_to',
  'ac_price_per_kwh',
  'dc_price_per_kwh',
  'roaming_ac_price_per_kwh',
  'roaming_dc_price_per_kwh',
  'monthly_base_fee',
  'session_fee',
  'affiliation',
  'notes',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;
const REMOTE_CHARGING_SESSION_COLUMNS = [
  'id',
  'user_id',
  'session_timestamp',
  'provider_id',
  'provider_name_snapshot',
  'charging_plan_name_snapshot',
  'charging_type',
  'kwh_billed',
  'kwh_added',
  'total_cost',
  'session_mode',
  'tariff_plan_id',
  'ad_hoc_pricing',
  'plan_selection_id',
  'price_snapshot',
  'odometer_km',
  'start_soc_percentage',
  'end_soc_percentage',
  'notes',
  'applied_price_per_kwh',
  'applied_ac_price_per_kwh',
  'applied_dc_price_per_kwh',
  'applied_roaming_ac_price_per_kwh',
  'applied_roaming_dc_price_per_kwh',
  'applied_monthly_base_fee',
  'applied_session_fee',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;
const REMOTE_PROVIDER_SELECT = REMOTE_PROVIDER_COLUMNS.join(', ');
const REMOTE_CHARGING_PLAN_SELECT = REMOTE_CHARGING_PLAN_COLUMNS.join(', ');
const REMOTE_CHARGING_SESSION_SELECT = REMOTE_CHARGING_SESSION_COLUMNS.join(', ');

export interface ProcessOutboxOptions {
  now?: () => Date;
  signal?: AbortSignal;
}

export interface InitialSyncOptions {
  signal?: AbortSignal;
}

interface SyncFailure {
  errorMessage: string;
  nonRetryable?: boolean;
  isOverlapConflict?: boolean;
  failureKind?: SyncOutbox['failure_kind'];
}

const GENERIC_PROVIDER_SYNC_ERROR_MESSAGE = 'Unable to sync provider. Please try again.';
const LOGICAL_TARIFF_OVERLAP_ERROR_MESSAGE =
  'Tariff validity overlaps with an existing active version for this provider and name';
const PAID_PROVIDER_TARIFF_OVERLAP_ERROR_MESSAGE =
  'Paid tariff validity overlaps with another active paid tariff for this provider';
const CHARGING_PLAN_OVERLAP_ERROR_MESSAGES = new Set([
  LOGICAL_TARIFF_OVERLAP_ERROR_MESSAGE,
  PAID_PROVIDER_TARIFF_OVERLAP_ERROR_MESSAGE,
]);

function shouldContinueAfterFailure(item: SyncOutbox, result: { success: false } & SyncFailure): boolean {
  return result.nonRetryable === true && (
    (item.table_name === 'charging_plans' && result.isOverlapConflict === true)
    || (item.table_name === 'providers' && result.failureKind === 'provider-name-conflict')
  );
}

function isBlockedProviderNameConflict(item: SyncOutbox): boolean {
  return isTypedTerminalProviderNameConflict(item)
    || isLegacyTerminalProviderNameConflict(item);
}

function isBlockedChargingPlanOverlap(item: SyncOutbox): boolean {
  return item.table_name === 'charging_plans'
    && (item.retry_count ?? 0) > 0
    && item.last_attempt_at !== undefined
    && item.next_attempt_at === undefined
    && item.last_error !== undefined
    && CHARGING_PLAN_OVERLAP_ERROR_MESSAGES.has(item.last_error);
}

function isEarlierOutboxItem(candidate: SyncOutbox, item: SyncOutbox): boolean {
  if (candidate.timestamp.getTime() !== item.timestamp.getTime()) {
    return candidate.timestamp.getTime() < item.timestamp.getTime();
  }

  return (candidate.id ?? Number.POSITIVE_INFINITY) < (item.id ?? Number.NEGATIVE_INFINITY);
}

async function removeSupersededBlockedEntries(
  item: SyncOutbox,
  blockedEntries: SyncOutbox[],
): Promise<SyncOutbox[]> {
  const supersededEntries = blockedEntries.filter((candidate) => (
    candidate.id !== item.id
    && candidate.table_name === item.table_name
    && candidate.payload.id === item.payload.id
    && isEarlierOutboxItem(candidate, item)
    && isBlockedChargingPlanOverlap(candidate)
  ));

  await db.sync_outbox.bulkDelete(supersededEntries.flatMap((candidate) => candidate.id ?? []));
  return supersededEntries;
}
type OutboxDependency = {
  tableName: SyncOutbox['table_name'];
  id: string;
};

function getOutboxRecordValue(item: SyncOutbox, field: string): unknown {
  return (item.payload as unknown as Record<string, unknown>)[field];
}

function getOutboxDependency(tableName: SyncOutbox['table_name'], id: unknown): OutboxDependency | undefined {
  return typeof id === 'string' && id.length > 0
    ? { tableName, id }
    : undefined;
}

function getOutboxDependencies(item: SyncOutbox): OutboxDependency[] {
  const dependencies: OutboxDependency[] = [];
  const addDependency = (tableName: SyncOutbox['table_name'], id: unknown): void => {
    const dependency = getOutboxDependency(tableName, id);
    if (dependency) dependencies.push(dependency);
  };

  switch (item.table_name) {
    case 'charging_plans':
      addDependency('providers', getOutboxRecordValue(item, 'provider_id'));
      break;
    case 'provider_plan_selections':
      addDependency('providers', getOutboxRecordValue(item, 'provider_id'));
      addDependency('charging_plans', getOutboxRecordValue(item, 'tariff_plan_id'));
      break;
    case 'sessions':
      if (getOutboxRecordValue(item, 'session_mode') === 'plan') {
        addDependency('providers', getOutboxRecordValue(item, 'provider_id'));
        addDependency('charging_plans', getOutboxRecordValue(item, 'tariff_plan_id'));
        addDependency('provider_plan_selections', getOutboxRecordValue(item, 'plan_selection_id'));
      }
      break;
    case 'providers':
      break;
    default: {
      const unhandledTable: never = item.table_name;
      void unhandledTable;
    }
  }

  return dependencies;
}

function getOutboxIdentityKey(dependency: OutboxDependency): string {
  return `${dependency.tableName}:${dependency.id}`;
}

function getOutboxIdentity(item: SyncOutbox): OutboxDependency | undefined {
  return getOutboxDependency(item.table_name, getOutboxRecordValue(item, 'id'));
}

function isTerminalOutboxItem(item: SyncOutbox): boolean {
  return isBlockedProviderNameConflict(item)
    || isBlockedChargingPlanOverlap(item)
    || (
      (item.retry_count ?? 0) > 0
      && item.last_attempt_at !== undefined
      && item.next_attempt_at === undefined
      && item.last_error !== undefined
    );
}

function canContinuePastTerminalOutboxItem(item: SyncOutbox): boolean {
  return isBlockedProviderNameConflict(item) || isBlockedChargingPlanOverlap(item);
}

interface TerminalOverlapInsertSummary {
  count: number;
  latestItem: SyncOutbox;
}

function canSupersedeOwnChargingPlanInsert(
  item: SyncOutbox,
  identityKey: string,
  pendingParentInsertCounts: ReadonlyMap<string, number>,
  terminalOverlapInsertSummaries: ReadonlyMap<string, TerminalOverlapInsertSummary>,
): boolean {
  if (item.table_name !== 'charging_plans' || item.action !== 'UPDATE') return false;

  const pendingInsertCount = pendingParentInsertCounts.get(identityKey) ?? 0;
  const summary = terminalOverlapInsertSummaries.get(identityKey);
  return summary !== undefined
    && summary.count === pendingInsertCount
    && isEarlierOutboxItem(summary.latestItem, item);
}


type RemoteProviderPayload = Pick<
  Provider,
  'id' | 'user_id' | 'name' | 'created_at' | 'updated_at' | 'deleted_at'
>;
type RemoteProviderPlanSelectionPayload = Pick<
  ProviderPlanSelection,
  | 'id'
  | 'user_id'
  | 'provider_id'
  | 'tariff_plan_id'
  | 'valid_from'
  | 'valid_to'
  | 'price_snapshot'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;
type RemoteChargingSessionPayload = Omit<ChargingSession, 'pricing_context'>;
type RemoteChargingPlanPayload = Pick<
  ChargingPlan,
  | 'id'
  | 'user_id'
  | 'provider_id'
  | 'name'
  | 'valid_from'
  | 'valid_to'
  | 'ac_price_per_kwh'
  | 'dc_price_per_kwh'
  | 'roaming_ac_price_per_kwh'
  | 'roaming_dc_price_per_kwh'
  | 'monthly_base_fee'
  | 'session_fee'
  | 'affiliation'
  | 'notes'
  | 'created_at'
  | 'updated_at'
  | 'deleted_at'
>;
type RemoteChargingPlan = ChargingPlan & {
  valid_period?: unknown;
};
interface RemoteChargingSession extends Record<string, unknown> {
  session_timestamp: Date | string;
  provider_id: string | null;
  provider_name_snapshot: string;
  session_mode: 'plan' | 'ad_hoc';
  tariff_plan_id: string | null;
  ad_hoc_pricing?: unknown;
  plan_selection_id?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at?: Date | string | null;
}

function getRetryDelayMs(retryCount: number): number {
  const exponentialDelay = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, retryCount - 1));
  return Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
}

function isNonRetryableConstraintViolation(error: unknown): error is { code: string; message: string } {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: unknown; message?: unknown };
  return (maybeError.code === '23514' || maybeError.code === '23P01')
    && typeof maybeError.message === 'string';
}

function getChargingPlanOverlapConflictMessage(error: { code?: string; message?: string } | null): string | undefined {
  if (!error) return undefined;
  if (error.code !== '23P01' || typeof error.message !== 'string') return undefined;
  if (error.message.includes('charging_plans_no_overlapping_active_versions')) {
    return LOGICAL_TARIFF_OVERLAP_ERROR_MESSAGE;
  }
  if (error.message.includes('charging_plans_no_overlapping_paid_provider_versions')) {
    return PAID_PROVIDER_TARIFF_OVERLAP_ERROR_MESSAGE;
  }
  return undefined;
}

interface OutboxAttemptSnapshot {
  id: number;
  tableName: SyncOutbox['table_name'];
  action: SyncOutbox['action'];
  timestamp: string;
  payload: string;
}

function createOutboxAttemptSnapshot(item: SyncOutbox): OutboxAttemptSnapshot | undefined {
  if (item.id === undefined) return undefined;
  return {
    id: item.id,
    tableName: item.table_name,
    action: item.action,
    timestamp: item.timestamp.toISOString(),
    payload: createCanonicalSerialization(item.payload),
  };
}

function matchesOutboxAttemptSnapshot(item: SyncOutbox, snapshot: OutboxAttemptSnapshot): boolean {
  return item.id === snapshot.id
    && item.table_name === snapshot.tableName
    && item.action === snapshot.action
    && item.timestamp.toISOString() === snapshot.timestamp
    && createCanonicalSerialization(item.payload) === snapshot.payload;
}

async function applySyncResult(
  item: SyncOutbox,
  result: Awaited<ReturnType<typeof syncItem>>,
  currentTime: Date,
): Promise<boolean> {
  const snapshot = createOutboxAttemptSnapshot(item);
  if (!snapshot) return false;

  return db.transaction('rw', db.sync_outbox, async () => {
    const current = await db.sync_outbox.get(snapshot.id);
    if (!current || !matchesOutboxAttemptSnapshot(current, snapshot)) {
      return false;
    }

    if (result.success) {
      await db.sync_outbox.delete(snapshot.id);
      return true;
    }

    const retryCount = (current.retry_count ?? 0) + 1;
    const next: SyncOutbox = {
      ...current,
      retry_count: retryCount,
      last_attempt_at: currentTime,
      next_attempt_at: result.nonRetryable
        ? undefined
        : new Date(currentTime.getTime() + getRetryDelayMs(retryCount)),
      last_error: result.errorMessage ?? 'Unknown sync error',
    };
    if (result.failureKind === undefined) {
      delete next.failure_kind;
    } else {
      next.failure_kind = result.failureKind;
    }
    await db.sync_outbox.put(next);
    return true;
  });
}

function toRemoteChargingSessionPayload(session: ChargingSession): RemoteChargingSessionPayload {
  return {
    id: session.id,
    user_id: session.user_id,
    session_timestamp: session.session_timestamp,
    provider_id: session.provider_id,
    provider_name_snapshot: session.provider_name_snapshot,
    charging_plan_name_snapshot: session.charging_plan_name_snapshot,
    charging_type: session.charging_type,
    kwh_billed: session.kwh_billed,
    kwh_added: session.kwh_added,
    total_cost: session.total_cost,
    session_mode: session.session_mode,
    tariff_plan_id: session.tariff_plan_id,
    ad_hoc_pricing: session.ad_hoc_pricing,
    plan_selection_id: session.plan_selection_id,
    price_snapshot: session.price_snapshot,
    odometer_km: session.odometer_km,
    start_soc_percentage: session.start_soc_percentage,
    end_soc_percentage: session.end_soc_percentage,
    notes: session.notes,
    applied_price_per_kwh: session.applied_price_per_kwh,
    applied_ac_price_per_kwh: session.applied_ac_price_per_kwh,
    applied_dc_price_per_kwh: session.applied_dc_price_per_kwh,
    applied_roaming_ac_price_per_kwh: session.applied_roaming_ac_price_per_kwh,
    applied_roaming_dc_price_per_kwh: session.applied_roaming_dc_price_per_kwh,
    applied_monthly_base_fee: session.applied_monthly_base_fee,
    applied_session_fee: session.applied_session_fee,
    created_at: session.created_at,
    updated_at: session.updated_at,
    deleted_at: session.deleted_at,
  };
}

function toRemoteProviderPayload(provider: Provider): RemoteProviderPayload {
  return {
    id: provider.id,
    user_id: provider.user_id,
    name: provider.name,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
    deleted_at: provider.deleted_at,
  };
}

function toRemoteProviderPlanSelectionPayload(
  selection: ProviderPlanSelection
): RemoteProviderPlanSelectionPayload {
  return {
    id: selection.id,
    user_id: selection.user_id,
    provider_id: selection.provider_id,
    tariff_plan_id: selection.tariff_plan_id,
    valid_from: selection.valid_from,
    valid_to: selection.valid_to,
    price_snapshot: selection.price_snapshot,
    created_at: selection.created_at,
    updated_at: selection.updated_at,
    deleted_at: selection.deleted_at,
  };
}

function toRemoteChargingPlanPayload(plan: ChargingPlan): RemoteChargingPlanPayload {
  return {
    id: plan.id,
    user_id: plan.user_id,
    provider_id: plan.provider_id,
    name: plan.name,
    valid_from: plan.valid_from,
    valid_to: plan.valid_to,
    ac_price_per_kwh: plan.ac_price_per_kwh,
    dc_price_per_kwh: plan.dc_price_per_kwh,
    roaming_ac_price_per_kwh: plan.roaming_ac_price_per_kwh,
    roaming_dc_price_per_kwh: plan.roaming_dc_price_per_kwh,
    monthly_base_fee: plan.monthly_base_fee,
    session_fee: plan.session_fee,
    affiliation: plan.affiliation,
    notes: plan.notes,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    deleted_at: plan.deleted_at,
  };
}

function normalizeRemoteChargingPlan(plan: RemoteChargingPlan): ChargingPlan {
  const localPlan = { ...plan };
  delete localPlan.valid_period;
  return localPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isIntegerCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isOptionalNullableIntegerCents(value: unknown): boolean {
  return value == null || isIntegerCents(value);
}

function isOptionalNullableString(value: unknown): boolean {
  return value == null || typeof value === 'string';
}

function isAdHocOtherFee(value: unknown): boolean {
  return isRecord(value)
    && isNonBlankTrimmedString(value.label)
    && isIntegerCents(value.amount)
    && (value.notes === undefined || typeof value.notes === 'string');
}

function getAdHocPricingSnapshotError(value: Record<string, unknown>): string | undefined {
  if (value.pricePerKwh !== null && !isIntegerCents(value.pricePerKwh)) {
    return 'Ad-hoc charging session has an invalid price-per-kWh snapshot';
  }
  if (!isOptionalNullableIntegerCents(value.pricePerMinute)) {
    return 'Ad-hoc charging session has an invalid price-per-minute snapshot';
  }
  if (!isOptionalNullableIntegerCents(value.pricePerSession)) {
    return 'Ad-hoc charging session has an invalid session-fee snapshot';
  }
  if (value.cpoName != null && !isNonBlankTrimmedString(value.cpoName)) {
    return 'Ad-hoc charging session has an invalid CPO snapshot';
  }
  if (value.otherFees !== undefined && (!Array.isArray(value.otherFees) || !value.otherFees.every(isAdHocOtherFee))) {
    return 'Ad-hoc charging session has invalid other-fee snapshots';
  }
  if (!isOptionalNullableString(value.receiptUrl)) {
    return 'Ad-hoc charging session has an invalid receipt URL snapshot';
  }
  if (!isOptionalNullableString(value.notes)) {
    return 'Ad-hoc charging session has invalid pricing notes';
  }
}

function parseRemoteDate(value: unknown, fieldName: string): Date {
  if (!(typeof value === 'string' || value instanceof Date)) {
    throw new Error(`Invalid charging session ${fieldName}`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid charging session ${fieldName}`);
  }

  return parsed;
}

function parseRemoteChargingSession(value: unknown): RemoteChargingSession {
  if (!isRecord(value)) {
    throw new Error('Invalid charging session row');
  }

  if (
    !isNonBlankTrimmedString(value.id)
    || !isNonBlankTrimmedString(value.user_id)
    || !isNonBlankTrimmedString(value.provider_name_snapshot)
    || (value.charging_type !== 'AC' && value.charging_type !== 'DC')
    || typeof value.kwh_billed !== 'number'
    || !Number.isFinite(value.kwh_billed)
    || typeof value.total_cost !== 'number'
    || !Number.isFinite(value.total_cost)
    || typeof value.applied_session_fee !== 'number'
    || !Number.isFinite(value.applied_session_fee)
  ) {
    throw new Error('Invalid charging session base fields');
  }

  parseRemoteDate(value.session_timestamp, 'session_timestamp');
  parseRemoteDate(value.created_at, 'created_at');
  parseRemoteDate(value.updated_at, 'updated_at');
  if (value.deleted_at != null) {
    parseRemoteDate(value.deleted_at, 'deleted_at');
  }

  if (value.session_mode === 'plan') {
    if (!isNonBlankTrimmedString(value.provider_id)) {
      throw new Error('Plan charging session requires a provider id');
    }
    if (!isNonBlankTrimmedString(value.tariff_plan_id)) {
      throw new Error('Plan charging session requires a tariff plan id');
    }
    if (value.ad_hoc_pricing != null) {
      throw new Error('Plan charging session cannot include ad-hoc pricing');
    }
    if (value.plan_selection_id != null && !isNonBlankTrimmedString(value.plan_selection_id)) {
      throw new Error('Plan charging session has an invalid plan selection id');
    }
  } else if (value.session_mode === 'ad_hoc') {
    if (value.provider_id !== null) {
      throw new Error('Ad-hoc charging session cannot include a provider id');
    }
    if (value.tariff_plan_id !== null || value.plan_selection_id !== null) {
      throw new Error('Ad-hoc charging session cannot include plan linkage');
    }
    if (!isRecord(value.ad_hoc_pricing)) {
      throw new Error('Ad-hoc charging session requires pricing details');
    }
    const pricingError = getAdHocPricingSnapshotError(value.ad_hoc_pricing);
    if (pricingError) {
      throw new Error(pricingError);
    }
  } else {
    throw new Error('Invalid charging session mode');
  }

  return value as RemoteChargingSession;
}

function normalizeRemoteChargingSession(value: unknown): ChargingSession {
  const session = parseRemoteChargingSession(value);
  const normalized = {
    ...session,
    session_timestamp: parseRemoteDate(session.session_timestamp, 'session_timestamp'),
    created_at: parseRemoteDate(session.created_at, 'created_at'),
    updated_at: parseRemoteDate(session.updated_at, 'updated_at'),
    deleted_at: session.deleted_at == null
      ? undefined
      : parseRemoteDate(session.deleted_at, 'deleted_at'),
    pricing_context: session.session_mode === 'ad_hoc' ? 'ad_hoc' : undefined,
  };

  return normalized as ChargingSession;
}

function getInitialSyncSelectColumns(tableName: 'providers' | 'charging_plans' | 'sessions'): string {
  if (tableName === 'providers') {
    return REMOTE_PROVIDER_SELECT;
  }

  if (tableName === 'charging_plans') {
    return REMOTE_CHARGING_PLAN_SELECT;
  }

  if (tableName === 'sessions') {
    return REMOTE_CHARGING_SESSION_SELECT;
  }

  return '*';
}

/**
 * Processes all entries in the sync outbox, uploading them to Supabase.
 *
 * Items are processed oldest-first to preserve the order in which local writes
 * occurred. An item is deleted only after Supabase accepts it; failures leave
 * the item in place so a later sync attempt can retry the same payload.
 */
export async function processOutbox(options: ProcessOutboxOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  const items = await db.sync_outbox.orderBy('timestamp').toArray();
  if (options.signal?.aborted) {
    return;
  }

  const pendingParentInsertCounts = new Map<string, number>();
  const pendingDescendantIdentityKeys = new Set<string>();
  const legacyProviderInsertIdentityKeys = new Set<string>();
  const blockedChargingPlanEntriesByIdentity = new Map<string, Set<SyncOutbox>>();
  const terminalOverlapInsertSummaries = new Map<string, TerminalOverlapInsertSummary>();
  const recordTerminalOverlapInsert = (item: SyncOutbox): void => {
    if (item.table_name !== 'charging_plans' || item.action !== 'INSERT') return;
    const identity = getOutboxIdentity(item);
    if (!identity) return;
    const key = getOutboxIdentityKey(identity);
    const summary = terminalOverlapInsertSummaries.get(key);
    terminalOverlapInsertSummaries.set(key, {
      count: (summary?.count ?? 0) + 1,
      latestItem: !summary || isEarlierOutboxItem(summary.latestItem, item) ? item : summary.latestItem,
    });
  };
  const removeTerminalOverlapInsert = (item: SyncOutbox): void => {
    if (item.table_name !== 'charging_plans' || item.action !== 'INSERT') return;
    const identity = getOutboxIdentity(item);
    if (!identity) return;
    const key = getOutboxIdentityKey(identity);
    const summary = terminalOverlapInsertSummaries.get(key);
    if (!summary) return;
    if (summary.count === 1) {
      terminalOverlapInsertSummaries.delete(key);
      return;
    }
    terminalOverlapInsertSummaries.set(key, {
      count: summary.count - 1,
      latestItem: summary.latestItem,
    });
  };
  for (const item of items) {
    for (const dependency of getOutboxDependencies(item)) {
      pendingDescendantIdentityKeys.add(getOutboxIdentityKey(dependency));
    }
    const identity = getOutboxIdentity(item);
    if (identity && isBlockedChargingPlanOverlap(item)) {
      const key = getOutboxIdentityKey(identity);
      const blockedEntries = blockedChargingPlanEntriesByIdentity.get(key) ?? new Set<SyncOutbox>();
      blockedEntries.add(item);
      blockedChargingPlanEntriesByIdentity.set(key, blockedEntries);
    }
    if (item.action !== 'INSERT' || !identity) continue;
    const key = getOutboxIdentityKey(identity);
    pendingParentInsertCounts.set(key, (pendingParentInsertCounts.get(key) ?? 0) + 1);
    if (isBlockedChargingPlanOverlap(item)) {
      recordTerminalOverlapInsert(item);
    }
    if (item.table_name === 'providers' && isLegacyTerminalProviderNameConflict(item)) {
      legacyProviderInsertIdentityKeys.add(key);
    }
  }

  const worklist = [...items];
  const queuedItems = new Set(items);
  const finishedItems = new Set<SyncOutbox>();
  const waitersByIdentity = new Map<string, Set<SyncOutbox>>();
  const releaseInsertedIdentity = (insertedItem: SyncOutbox): void => {
    if (insertedItem.action !== 'INSERT') return;
    const identity = getOutboxIdentity(insertedItem);
    if (!identity) return;
    const key = getOutboxIdentityKey(identity);
    const count = pendingParentInsertCounts.get(key);
    if (count === undefined) return;
    if (count > 1) {
      pendingParentInsertCounts.set(key, count - 1);
      return;
    }

    pendingParentInsertCounts.delete(key);
    const waiters = waitersByIdentity.get(key);
    waitersByIdentity.delete(key);
    if (!waiters) return;
    for (const waiter of waiters) {
      if (!finishedItems.has(waiter) && !queuedItems.has(waiter)) {
        worklist.push(waiter);
        queuedItems.add(waiter);
      }
    }
  };
  let worklistIndex = 0;

  while (worklistIndex < worklist.length) {
    if (options.signal?.aborted) {
      return;
    }

    const item = worklist[worklistIndex++];
    queuedItems.delete(item);

    const currentTime = now();
    if (isTerminalOutboxItem(item) && !canContinuePastTerminalOutboxItem(item)) {
      // Generic terminal rows keep their ordering boundary even if they also
      // reference a delayed parent, so unrelated later work cannot pass them.
      finishedItems.add(item);
      break;
    }
    const identity = getOutboxIdentity(item);
    const identityKey = identity ? getOutboxIdentityKey(identity) : undefined;
    const blockedDependencyKeys = new Set<string>();
    const canBypassOwnParentInsert = identityKey !== undefined
      && canSupersedeOwnChargingPlanInsert(
        item,
        identityKey,
        pendingParentInsertCounts,
        terminalOverlapInsertSummaries,
      );
    if (
      item.action !== 'INSERT'
      && identityKey !== undefined
      && (pendingParentInsertCounts.get(identityKey) ?? 0) > 0
      && pendingDescendantIdentityKeys.has(identityKey)
      && !legacyProviderInsertIdentityKeys.has(identityKey)
      && !canBypassOwnParentInsert
    ) {
      blockedDependencyKeys.add(identityKey);
    }
    for (const dependency of getOutboxDependencies(item)) {
      const dependencyKey = getOutboxIdentityKey(dependency);
      if ((pendingParentInsertCounts.get(dependencyKey) ?? 0) > 0) {
        blockedDependencyKeys.add(dependencyKey);
      }
    }
    if (blockedDependencyKeys.size > 0) {
      // Leave dependent entries untouched until every parent INSERT for each
      // referenced identity has been accepted or repaired.
      for (const dependencyKey of blockedDependencyKeys) {
        const waiters = waitersByIdentity.get(dependencyKey) ?? new Set<SyncOutbox>();
        waiters.add(item);
        waitersByIdentity.set(dependencyKey, waiters);
      }
      continue;
    }

    if (isTerminalOutboxItem(item)) {
      // Keep terminal failures for diagnosis. Their identities remain in the
      // dependency counts so descendants cannot be uploaded without repair.
      finishedItems.add(item);
      if (!canContinuePastTerminalOutboxItem(item)) {
        break;
      }
      continue;
    }

    if (item.next_attempt_at && item.next_attempt_at > currentTime) {
      // Skip delayed items but continue scanning so later ready items do not
      // starve behind an older future-retry entry.
      finishedItems.add(item);
      continue;
    }

    const result = await syncItem(item);
    if (options.signal?.aborted) {
      return;
    }

    const applied = await applySyncResult(item, result, currentTime);
    finishedItems.add(item);
    if (!applied) {
      // Another writer changed or removed this row while the remote call was
      // pending, so this acknowledgement cannot safely affect local state.
      continue;
    }

    if (result.success) {
      const itemIdentity = getOutboxIdentity(item);
      const itemIdentityKey = itemIdentity ? getOutboxIdentityKey(itemIdentity) : undefined;
      const blockedEntries = itemIdentityKey
        ? [...(blockedChargingPlanEntriesByIdentity.get(itemIdentityKey) ?? [])]
        : [];
      const supersededItems = await removeSupersededBlockedEntries(item, blockedEntries);
      if (itemIdentityKey && supersededItems.length > 0) {
        const remainingBlockedEntries = blockedChargingPlanEntriesByIdentity.get(itemIdentityKey);
        if (remainingBlockedEntries) {
          for (const supersededItem of supersededItems) {
            remainingBlockedEntries.delete(supersededItem);
            removeTerminalOverlapInsert(supersededItem);
          }
          if (remainingBlockedEntries.size === 0) {
            blockedChargingPlanEntriesByIdentity.delete(itemIdentityKey);
          }
        }
      }
      releaseInsertedIdentity(item);
      for (const supersededItem of supersededItems) {
        releaseInsertedIdentity(supersededItem);
      }
    } else if (shouldContinueAfterFailure(item, result)) {
      if (item.table_name === 'charging_plans' && result.isOverlapConflict) {
        const failedIdentity = getOutboxIdentity(item);
        if (failedIdentity) {
          const key = getOutboxIdentityKey(failedIdentity);
          const blockedEntries = blockedChargingPlanEntriesByIdentity.get(key) ?? new Set<SyncOutbox>();
          blockedEntries.add(item);
          blockedChargingPlanEntriesByIdentity.set(key, blockedEntries);
          recordTerminalOverlapInsert(item);
        }
      }
    } else {
      // Later writes may depend on earlier ones, so stop at retryable or
      // other failures rather than skipping ahead and risking out-of-order
      // state.
      break;
    }
  }
}

/**
 * Syncs a single outbox item to Supabase.
 *
 * Local table names mostly match Supabase table names, except sessions, which
 * are stored remotely in the `charging_sessions` table.
 *
 * @param item - Outbox entry created by a local write operation.
 * @returns Success state and optional error message for retry bookkeeping.
 */
async function syncItem(item: SyncOutbox): Promise<{ success: true } | ({ success: false } & SyncFailure)> {
  try {
    let error: { message: string; code?: string } | null = null;

    switch (item.table_name) {
      case 'providers': {
        const result = await supabase
          .from('providers')
          .upsert(toRemoteProviderPayload(item.payload as Provider));
        error = result.error as { message: string; code?: string } | null;
        break;
      }
      case 'charging_plans': {
        const result = await supabase
          .from('charging_plans')
          .upsert(toRemoteChargingPlanPayload(item.payload as ChargingPlan));
        error = result.error as { message: string; code?: string } | null;
        break;
      }
      case 'provider_plan_selections': {
        const result = await supabase
          .from('provider_plan_selections')
          .upsert(toRemoteProviderPlanSelectionPayload(item.payload as ProviderPlanSelection));
        error = result.error as { message: string; code?: string } | null;
        break;
      }
      case 'sessions': {
        const result = await supabase
          .from('charging_sessions')
          .upsert(toRemoteChargingSessionPayload(item.payload as ChargingSession));
        error = result.error as { message: string; code?: string } | null;
        break;
      }
      default: {
        const unhandledTable: never = item.table_name;
        const message = `Unsupported sync table: ${String(unhandledTable)}`;
        console.error(message);
        return { success: false, errorMessage: message };
      }
    }

    if (error) {
      const failureKind = item.table_name === 'providers'
        ? getLiveSyncFailureKind(error)
        : undefined;
      if (failureKind === 'provider-name-conflict') {
        console.error('Non-retryable provider-name conflict recorded.');
        return {
          success: false,
          errorMessage: PROVIDER_NAME_CONFLICT_ERROR_MESSAGE,
          nonRetryable: true,
          failureKind,
        };
      }

      if (isNonRetryableConstraintViolation(error)) {
        const overlapConflictMessage = item.table_name === 'charging_plans'
          ? getChargingPlanOverlapConflictMessage(error)
          : undefined;
        const message = item.table_name === 'providers'
          ? GENERIC_PROVIDER_SYNC_ERROR_MESSAGE
          : overlapConflictMessage
          ? overlapConflictMessage
          : `Validation failed for ${item.table_name}: ${error.message}`;
        console.error(`Non-retryable sync validation error for table ${item.table_name}:`, error.message);
        return { success: false, errorMessage: message, nonRetryable: true, isOverlapConflict: overlapConflictMessage !== undefined };
      }
      console.error(`Sync error for table ${item.table_name}:`, error.message);
      return {
        success: false,
        errorMessage: item.table_name === 'providers'
          ? GENERIC_PROVIDER_SYNC_ERROR_MESSAGE
          : error.message,
      };
    }

    return { success: true };
  } catch (err) {
    console.error(`Unexpected sync failure for table ${item.table_name}:`, err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorMessage: item.table_name === 'providers'
        ? GENERIC_PROVIDER_SYNC_ERROR_MESSAGE
        : message,
    };
  }
}

/**
 * Performs an initial pull of all user data from Supabase to Dexie.
 *
 * This is intentionally additive/upserting: remote rows hydrate the local cache
 * without clearing any pending local writes that may still exist in the outbox.
 * Typically called on app startup or after login.
 */
export async function initialSync(options: InitialSyncOptions = {}): Promise<InitialSyncResult> {
  const tables = ['providers', 'charging_plans', 'sessions'] as const;
  const result: InitialSyncResult = {
    providers: { status: 'aborted' },
    charging_plans: { status: 'aborted' },
    sessions: { status: 'aborted' },
  };

  for (const tableName of tables) {
    if (options.signal?.aborted) {
      return result;
    }

    const table = db[tableName];
    if (typeof table === 'object' && 'bulkPut' in table) {
      // Supabase keeps charging sessions under a more explicit table name than
      // the local Dexie store.
      const supabaseTable = tableName === 'sessions' ? 'charging_sessions' : tableName;
      const { data, error } = await supabase
        .from(supabaseTable as string)
        .select(getInitialSyncSelectColumns(tableName)) as {
          data: Provider[] | RemoteChargingPlan[] | RemoteChargingSession[] | null;
          error: { message: string } | null;
        };

      if (options.signal?.aborted) {
        return result;
      }

      if (error) {
        // Continue with the remaining tables so one failed pull does not block
        // all locally cached data from refreshing.
        console.error(`Error pulling data for ${tableName}:`, error.message);
        result[tableName] = { status: 'failed', failureKind: 'network' };
        continue;
      }

      if (data && data.length > 0) {
        try {
          if (tableName === 'providers') await db.providers.bulkPut(data as Provider[]);
          if (tableName === 'charging_plans') {
            await db.charging_plans.bulkPut((data as RemoteChargingPlan[]).map(normalizeRemoteChargingPlan));
          }
          if (tableName === 'sessions') {
            const sessions = (data as RemoteChargingSession[]).map(normalizeRemoteChargingSession);
            await db.sessions.bulkPut(sessions);
          }
        } catch (err) {
          // A malformed or unwritable table response must not block the other
          // independently hydrated domain tables.
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error hydrating data for ${tableName}:`, message);
          result[tableName] = { status: 'failed', failureKind: 'invalid_data' };
          continue;
        }
      }

      result[tableName] = { status: 'ready' };
    }
  }

  return result;
}
