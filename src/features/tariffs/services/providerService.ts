import { db, type Provider, type SyncPayload } from '../../../lib/db';

/**
 * Saves a charging provider locally and queues the change for remote sync.
 *
 * Providers are created inline from the tariff form, so this function keeps the
 * local provider list and sync outbox consistent in a single transaction.
 *
 * @param provider - Provider record to insert or update.
 */
export async function saveProvider(provider: Provider): Promise<void> {
  await db.transaction('rw', db.providers, db.sync_outbox, async () => {
    const existing = await db.providers.get(provider.id);
    const now = new Date();
    
    // Updates retain the original creation timestamp while refreshing updated_at.
    const providerToSave: Provider = {
      ...provider,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.providers.put(providerToSave);
    await db.sync_outbox.add({
      table_name: 'providers',
      // The sync engine replays this as an upsert, but action still records the
      // user's local intent for observability and future sync behavior.
      action: existing ? 'UPDATE' : 'INSERT',
      payload: providerToSave as SyncPayload,
      timestamp: now
    });
  });
}

/**
 * Returns active charging providers from the local cache.
 *
 * @returns Providers that have not been soft-deleted.
 */
export async function getProviders(): Promise<Provider[]> {
  return db.providers.filter(p => !p.deleted_at).toArray();
}
