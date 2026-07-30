import { createSyncOutboxEntry, db, type Provider } from '../../../infra/db';

const DUPLICATE_PROVIDER_NAME_MESSAGE = 'Provider name already exists (active, case-insensitive)';

/**
 * Error raised when an active provider already uses the requested name.
 *
 * The matching provider allows callers to offer a direct recovery path without
 * repeating the local lookup or parsing the human-readable message.
 */
export class DuplicateProviderNameError extends Error {
  /** Existing active provider whose normalized name conflicts. */
  readonly provider: Provider;

  constructor(provider: Provider) {
    super(DUPLICATE_PROVIDER_NAME_MESSAGE);
    this.name = 'DuplicateProviderNameError';
    this.provider = provider;
  }
}

/**
 * Saves a charging provider locally and queues the change for remote sync.
 *
 * Providers are created inline from the tariff form, so this function keeps the
 * local provider list and sync outbox consistent in a single transaction.
 *
 * @param provider - Provider record to insert or update.
 */
export async function saveProvider(provider: Provider): Promise<void> {
  const providerName = (provider.name ?? '').trim();
  if (!providerName) {
    throw new Error('Provider name is required');
  }

  await db.transaction('rw', db.providers, db.sync_outbox, async () => {
    const existing = await db.providers.get(provider.id);
    const now = new Date();
    const normalizedProviderName = providerName.toLowerCase();

    const conflictingProvider = await db.providers
      .where('user_id')
      .equals(provider.user_id)
      .filter((row) => (
        !row.deleted_at
        && row.id !== provider.id
        && (row.name ?? '').trim().toLowerCase() === normalizedProviderName
      ))
      .first();

    if (conflictingProvider) {
      throw new DuplicateProviderNameError(conflictingProvider);
    }

    // Updates retain the original creation timestamp while refreshing updated_at.
    const providerToSave: Provider = {
      ...provider,
      name: providerName,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.providers.put(providerToSave);
    await db.sync_outbox.add(createSyncOutboxEntry(
      'providers',
      existing ? 'UPDATE' : 'INSERT',
      providerToSave,
      now,
    ));
  });
}

/**
 * Returns active charging providers from the local cache.
 *
 * @returns Providers that have not been soft-deleted.
 */
export async function getProviders(userId: string): Promise<Provider[]> {
  return db.providers.filter((provider) => provider.user_id === userId && !provider.deleted_at).toArray();
}
