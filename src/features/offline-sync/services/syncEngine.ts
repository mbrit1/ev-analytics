import { db, type SyncOutbox, type Provider, type Tariff, type ChargingSession } from '../../../lib/db';
import { supabase } from '../../../lib/supabase';

/**
 * Processes all entries in the sync outbox, uploading them to Supabase.
 *
 * Items are processed oldest-first to preserve the order in which local writes
 * occurred. An item is deleted only after Supabase accepts it; failures leave
 * the item in place so a later sync attempt can retry the same payload.
 */
export async function processOutbox(): Promise<void> {
  const items = await db.sync_outbox.orderBy('timestamp').toArray();

  for (const item of items) {
    const success = await syncItem(item);
    if (success) {
      await db.sync_outbox.delete(item.id!);
    } else {
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
 * @returns True when Supabase accepted the payload; false when it should retry.
 */
async function syncItem(item: SyncOutbox): Promise<boolean> {
  try {
    let error;

    if (item.table_name === 'providers') {
      const result = await supabase.from('providers').upsert(item.payload as Provider);
      error = result.error;
    } else if (item.table_name === 'tariffs') {
      const result = await supabase.from('tariffs').upsert(item.payload as Tariff);
      error = result.error;
    } else if (item.table_name === 'sessions') {
      const result = await supabase.from('charging_sessions').upsert(item.payload as ChargingSession);
      error = result.error;
    }

    if (error) {
      console.error(`Sync error for table ${item.table_name}:`, error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`Unexpected sync failure for table ${item.table_name}:`, err);
    return false;
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
  const tables: (keyof typeof db)[] = ['providers', 'tariffs', 'sessions'];

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
        if (tableName === 'tariffs') await db.tariffs.bulkPut(data);
        if (tableName === 'sessions') await db.sessions.bulkPut(data);
      }
    }
  }
}
