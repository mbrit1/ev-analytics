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

export interface ProcessOutboxOptions {
  now?: () => Date;
}

interface SyncFailure {
  errorMessage: string;
  nonRetryable?: boolean;
}

type RemoteChargingSessionPayload = Omit<ChargingSession, 'pricing_context'>;

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

function toRemoteChargingSessionPayload(session: ChargingSession): RemoteChargingSessionPayload {
  const remotePayload = { ...session };
  delete remotePayload.pricing_context;
  return remotePayload;
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

  for (const item of items) {
    const currentTime = now();
    if (item.next_attempt_at && item.next_attempt_at > currentTime) {
      // Skip delayed items but continue scanning so later ready items do not
      // starve behind an older future-retry entry.
      continue;
    }

    const result = await syncItem(item);
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

      // Later writes may depend on earlier ones, so stop at the first failure
      // rather than skipping ahead and risking out-of-order remote state.
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
        const result = await supabase.from('providers').upsert(item.payload as Provider);
        error = result.error as { message: string; code?: string } | null;
        break;
      }
      case 'charging_plans': {
        const result = await supabase.from('charging_plans').upsert(item.payload as ChargingPlan);
        error = result.error as { message: string; code?: string } | null;
        break;
      }
      case 'provider_plan_selections': {
        const result = await supabase.from('provider_plan_selections').upsert(item.payload as ProviderPlanSelection);
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
        const message = item.table_name === 'charging_plans'
          ? 'Tariff validity overlaps with an existing active version for this provider and name'
          : `Validation failed for ${item.table_name}: ${error.message}`;
        console.error(`Non-retryable sync validation error for table ${item.table_name}:`, error.message);
        return { success: false, errorMessage: message, nonRetryable: true };
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
export async function initialSync(): Promise<void> {
  const tables: (keyof typeof db)[] = ['providers', 'charging_plans', 'sessions'];

  for (const tableName of tables) {
    const table = db[tableName];
    if (typeof table === 'object' && 'bulkPut' in table) {
      // Supabase keeps charging sessions under a more explicit table name than
      // the local Dexie store.
      const supabaseTable = tableName === 'sessions' ? 'charging_sessions' : tableName;
      const { data, error } = await supabase.from(supabaseTable as string).select('*');
      
      if (error) {
        // Continue with the remaining tables so one failed pull does not block
        // all locally cached data from refreshing.
        console.error(`Error pulling data for ${tableName}:`, error.message);
        continue;
      }

      if (data && data.length > 0) {
        if (tableName === 'providers') await db.providers.bulkPut(data);
        if (tableName === 'charging_plans') await db.charging_plans.bulkPut(data);
        if (tableName === 'sessions') await db.sessions.bulkPut(data);
      }
    }
  }
}
