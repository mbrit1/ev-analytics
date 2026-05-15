import { db, type Tariff, type SyncPayload } from '../../../lib/db';

/**
 * Saves a tariff to the local database and creates a sync outbox entry.
 * Automatically manages updated_at and detects if it's an INSERT or UPDATE.
 */
export async function saveTariff(tariff: Tariff): Promise<void> {
  await db.transaction('rw', db.tariffs, db.sync_outbox, async () => {
    const existing = await db.tariffs.get(tariff.id);
    const now = new Date();
    
    const tariffToSave: Tariff = {
      ...tariff,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.tariffs.put(tariffToSave);
    await db.sync_outbox.add({
      table_name: 'tariffs',
      action: existing ? 'UPDATE' : 'INSERT',
      payload: tariffToSave as SyncPayload,
      timestamp: now
    });
  });
}

/**
 * Returns all tariffs that have not been soft-deleted.
 */
export async function getTariffs(): Promise<Tariff[]> {
  // Simple filter is efficient enough for single-user tariff counts
  return db.tariffs
    .filter(tariff => !tariff.deleted_at)
    .toArray();
}

/**
 * Soft deletes a tariff locally and creates a DELETE outbox entry.
 * Retrieval is inside the transaction to prevent race conditions.
 */
export async function deleteTariff(id: string): Promise<void> {
  await db.transaction('rw', db.tariffs, db.sync_outbox, async () => {
    const tariff = await db.tariffs.get(id);
    if (!tariff || tariff.deleted_at) return;

    const now = new Date();
    const deletedTariff: Tariff = {
      ...tariff,
      deleted_at: now,
      updated_at: now
    };

    await db.tariffs.put(deletedTariff);
    await db.sync_outbox.add({
      table_name: 'tariffs',
      action: 'DELETE',
      payload: deletedTariff as SyncPayload,
      timestamp: now
    });
  });
}
