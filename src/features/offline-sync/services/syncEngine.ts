import { db, type SyncOutbox, type Provider, type ChargingPlan, type ChargingSession } from '../../../infra/db';
import { supabase } from '../../../infra/supabase';

const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface ProcessOutboxOptions {
  now?: () => Date;
}

function getRetryDelayMs(retryCount: number): number {
  const exponentialDelay = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, retryCount - 1));
  return Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
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
      await db.sync_outbox.update(item.id!, {
        retry_count: retryCount,
        last_attempt_at: currentTime,
        next_attempt_at: new Date(currentTime.getTime() + getRetryDelayMs(retryCount)),
        last_error: result.errorMessage ?? 'Unknown sync error'
      });

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
async function syncItem(item: SyncOutbox): Promise<{ success: boolean; errorMessage?: string }> {
  try {
    let error;

    if (item.table_name === 'providers') {
      const result = await supabase.from('providers').upsert(item.payload as Provider);
      error = result.error;
    } else if (item.table_name === 'charging_plans') {
      const result = await supabase.from('charging_plans').upsert(item.payload as ChargingPlan);
      error = result.error;
    } else if (item.table_name === 'sessions') {
      const result = await supabase.from('charging_sessions').upsert(item.payload as ChargingSession);
      error = result.error;
    } else {
      const message = `Unsupported sync table: ${item.table_name}`;
      console.error(message);
      return { success: false, errorMessage: message };
    }

    if (error) {
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
