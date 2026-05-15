import { db, type SyncOutbox, type Provider, type Tariff, type ChargingSession } from '../../../lib/db';
import { supabase } from '../../../lib/supabase';

/**
 * Processes all entries in the sync outbox, uploading them to Supabase.
 * Deletes outbox entries only on successful sync.
 */
export async function processOutbox(): Promise<void> {
  const items = await db.sync_outbox.orderBy('timestamp').toArray();

  for (const item of items) {
    const success = await syncItem(item);
    if (success) {
      await db.sync_outbox.delete(item.id!);
    } else {
      // Stop processing if an item fails (preserve order)
      break;
    }
  }
}

/**
 * Syncs a single outbox item to Supabase.
 * Returns true if successful, false otherwise.
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
 * Typically called on app startup or after login.
 */
export async function initialSync(): Promise<void> {
  const tables: (keyof typeof db)[] = ['providers', 'tariffs', 'sessions'];

  for (const tableName of tables) {
    const table = db[tableName];
    if (typeof table === 'object' && 'bulkPut' in table) {
      const supabaseTable = tableName === 'sessions' ? 'charging_sessions' : tableName;
      const { data, error } = await supabase.from(supabaseTable as string).select('*');
      
      if (error) {
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
