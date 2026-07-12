import {
  db,
  type SyncOutbox,
  type Provider,
  type ChargingPlan,
  type ChargingSession,
  type ProviderPlanSelection
} from '../../../infra/db';
import { supabase } from '../../../infra/supabase';

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
}

function shouldContinueAfterFailure(item: SyncOutbox, result: { success: false } & SyncFailure): boolean {
  return item.table_name === 'charging_plans' && result.nonRetryable === true && result.isOverlapConflict === true;
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
type RemoteChargingSession = Omit<
  ChargingSession,
  'session_timestamp' | 'created_at' | 'updated_at' | 'deleted_at'
> & {
  session_timestamp: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at?: Date | string;
};

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

function isChargingPlanOverlapConflict(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23P01'
    && typeof error.message === 'string'
    && error.message.includes('charging_plans_no_overlapping_active_versions');
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

function normalizeRemoteChargingSession(session: RemoteChargingSession): ChargingSession {
  return {
    ...session,
    session_timestamp: new Date(session.session_timestamp),
    created_at: new Date(session.created_at),
    updated_at: new Date(session.updated_at),
    deleted_at: session.deleted_at == null ? undefined : new Date(session.deleted_at),
  };
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

  for (const item of items) {
    if (options.signal?.aborted) {
      return;
    }

    const currentTime = now();
    if (item.next_attempt_at && item.next_attempt_at > currentTime) {
      // Skip delayed items but continue scanning so later ready items do not
      // starve behind an older future-retry entry.
      continue;
    }

    const result = await syncItem(item);
    if (options.signal?.aborted) {
      return;
    }

    if (result.success) {
      await db.sync_outbox.delete(item.id!);
    } else {
      const retryCount = (item.retry_count ?? 0) + 1;
      if (result.nonRetryable) {
        await db.sync_outbox.update(item.id!, {
          retry_count: retryCount,
          last_attempt_at: currentTime,
          next_attempt_at: undefined,
          last_error: result.errorMessage ?? 'Unknown sync error'
        });
      } else {
        await db.sync_outbox.update(item.id!, {
          retry_count: retryCount,
          last_attempt_at: currentTime,
          next_attempt_at: new Date(currentTime.getTime() + getRetryDelayMs(retryCount)),
          last_error: result.errorMessage ?? 'Unknown sync error'
        });
      }

      if (shouldContinueAfterFailure(item, result)) {
        // charging_plans overlap conflicts are non-retryable and item-local:
        // keep the failed row for user resolution, but allow later ready rows
        // to sync instead of permanently blocking the queue.
        continue;
      }

      // Later writes may depend on earlier ones, so stop at retryable or other
      // failures rather than skipping ahead and risking out-of-order state.
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
      if (isNonRetryableConstraintViolation(error)) {
        const overlapConflict = item.table_name === 'charging_plans' && isChargingPlanOverlapConflict(error);
        const message = overlapConflict
          ? 'Tariff validity overlaps with an existing active version for this provider and name'
          : `Validation failed for ${item.table_name}: ${error.message}`;
        console.error(`Non-retryable sync validation error for table ${item.table_name}:`, error.message);
        return { success: false, errorMessage: message, nonRetryable: true, isOverlapConflict: overlapConflict };
      }
      console.error(`Sync error for table ${item.table_name}:`, error.message);
      return { success: false, errorMessage: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error(`Unexpected sync failure for table ${item.table_name}:`, err);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errorMessage: message };
  }
}

/**
 * Performs an initial pull of all user data from Supabase to Dexie.
 *
 * This is intentionally additive/upserting: remote rows hydrate the local cache
 * without clearing any pending local writes that may still exist in the outbox.
 * Typically called on app startup or after login.
 */
export async function initialSync(options: InitialSyncOptions = {}): Promise<void> {
  const tables = ['providers', 'charging_plans', 'sessions'] as const;

  for (const tableName of tables) {
    if (options.signal?.aborted) {
      return;
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
        return;
      }

      if (error) {
        // Continue with the remaining tables so one failed pull does not block
        // all locally cached data from refreshing.
        console.error(`Error pulling data for ${tableName}:`, error.message);
        continue;
      }

      if (data && data.length > 0) {
        if (tableName === 'providers') await db.providers.bulkPut(data as Provider[]);
        if (tableName === 'charging_plans') {
          await db.charging_plans.bulkPut((data as RemoteChargingPlan[]).map(normalizeRemoteChargingPlan));
        }
        if (tableName === 'sessions') {
          await db.sessions.bulkPut(
            (data as RemoteChargingSession[]).map(normalizeRemoteChargingSession)
          );
        }
      }
    }
  }
}
