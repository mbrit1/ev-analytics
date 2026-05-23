import { db, type Tariff, type SyncPayload } from '../../../infra/db';

/**
 * Saves a tariff to the local database and creates a sync outbox entry.
 *
 * Tariff prices and fees are stored as integer cents. The local write and sync
 * outbox entry are created in one transaction so offline changes can be replayed
 * remotely without losing their corresponding local state.
 *
 * @param tariff - Tariff record to insert or update.
 */
export async function saveTariff(tariff: Tariff): Promise<void> {
  await db.transaction('rw', db.tariffs, db.sync_outbox, async () => {
    const existing = await db.tariffs.get(tariff.id);
    const now = new Date();
    
    // Preserve the original creation timestamp on edits while refreshing the
    // modification timestamp for conflict/audit visibility.
    const tariffToSave: Tariff = {
      ...tariff,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.tariffs.put(tariffToSave);
    await db.sync_outbox.add({
      table_name: 'tariffs',
      // Existing local records become UPDATE syncs; new records become INSERTs.
      action: existing ? 'UPDATE' : 'INSERT',
      payload: tariffToSave as SyncPayload,
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}

/**
 * Returns all tariffs that have not been soft-deleted.
 *
 * @returns Active local tariffs available for forms and charging sessions.
 */
export async function getTariffs(): Promise<Tariff[]> {
  // Simple filter is efficient enough for single-user tariff counts
  return db.tariffs
    .filter(tariff => !tariff.deleted_at)
    .toArray();
}

/**
 * Soft deletes a tariff locally and creates a DELETE outbox entry.
 *
 * Retrieval is inside the transaction to prevent race conditions. The record is
 * retained locally with `deleted_at` so the deletion can still sync remotely
 * and historical charging sessions can keep their tariff snapshots intact.
 *
 * @param id - Tariff id to mark deleted.
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
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}
