import Dexie from 'dexie';
import { createSyncOutboxEntry, db, type Provider } from '../../../infra/db';

const DUPLICATE_PROVIDER_NAME_MESSAGE = 'Provider name already exists (active, case-insensitive)';
export const MAX_PROVIDER_NAME_LENGTH = 120;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

/**
 * Normalizes a provider name before local persistence and remote replay.
 */
export function normalizeProviderName(name: string): string {
  return name.trim();
}

/**
 * Returns a user-safe error when a provider name violates its durable contract.
 */
export function getProviderNameValidationError(name: string | undefined | null): string | undefined {
  const rawName = name ?? '';
  if (CONTROL_CHARACTER_PATTERN.test(rawName)) {
    return 'Provider name cannot contain control characters';
  }

  const normalizedName = normalizeProviderName(rawName);
  if (!normalizedName) {
    return 'Provider name is required';
  }
  if (Array.from(normalizedName).length > MAX_PROVIDER_NAME_LENGTH) {
    return `Provider name must be ${MAX_PROVIDER_NAME_LENGTH} characters or fewer`;
  }

  return undefined;
}

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

/** Raised when a local write would recreate a removed or foreign provider reference. */
export class ProviderReferenceUnavailableError extends Error {
  constructor() {
    super('Provider reference is unavailable');
    this.name = 'ProviderReferenceUnavailableError';
  }
}

/**
 * Verifies a provider reference inside the active Dexie transaction when one
 * exists, so concurrent reconciliation cannot leave an orphaned local graph.
 */
export async function assertOwnedProviderReference(
  userId: string,
  providerId: string,
): Promise<void> {
  const providers = Dexie.currentTransaction != null
    ? Dexie.currentTransaction.table<Provider, string>('providers')
    : db.providers;
  const provider = await providers.get(providerId);

  if (!provider || provider.user_id !== userId || provider.deleted_at) {
    throw new ProviderReferenceUnavailableError();
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
  const validationError = getProviderNameValidationError(provider.name);
  if (validationError) {
    throw new Error(validationError);
  }
  const providerName = normalizeProviderName(provider.name);

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
