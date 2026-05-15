import { db, type Provider, type SyncPayload } from '../../../lib/db';

export async function saveProvider(provider: Provider): Promise<void> {
  await db.transaction('rw', db.providers, db.sync_outbox, async () => {
    const existing = await db.providers.get(provider.id);
    const now = new Date();
    
    const providerToSave: Provider = {
      ...provider,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.providers.put(providerToSave);
    await db.sync_outbox.add({
      table_name: 'providers',
      action: existing ? 'UPDATE' : 'INSERT',
      payload: providerToSave as SyncPayload,
      timestamp: now
    });
  });
}

export async function getProviders(): Promise<Provider[]> {
  return db.providers.filter(p => !p.deleted_at).toArray();
}
