import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Provider } from '../../../lib/db';
import { getProviders, saveProvider } from './providerService';
import 'fake-indexeddb/auto';

/**
 * Test suite for provider persistence services.
 *
 * Verifies local provider writes, outbox retry metadata initialization, and
 * filtering of soft-deleted providers in offline-first reads.
 */
describe('providerService', () => {
  beforeEach(async () => {
    // Arrange: Keep provider and outbox state isolated for each test.
    await db.providers.clear();
    await db.sync_outbox.clear();
  });

  it('should save a provider and create an outbox entry with retry metadata', async () => {
    // Arrange: Build a provider record to persist locally.
    const provider: Provider = {
      id: 'provider-1',
      user_id: 'user-1',
      name: 'Ionity',
      created_at: new Date(),
      updated_at: new Date()
    };

    // Act: Save provider through the transactional service.
    await saveProvider(provider);

    // Assert: Local provider record and retry-enabled outbox entry are created.
    const storedProvider = await db.providers.get('provider-1');
    expect(storedProvider).toBeDefined();
    expect(storedProvider?.name).toBe('Ionity');

    const outbox = await db.sync_outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].table_name).toBe('providers');
    expect(outbox[0].action).toBe('INSERT');
    expect(outbox[0]).toMatchObject({
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });

  it('should return only non-deleted providers', async () => {
    // Arrange: Seed one active and one soft-deleted provider.
    const activeProvider: Provider = {
      id: 'active-provider',
      user_id: 'user-1',
      name: 'Fastned',
      created_at: new Date(),
      updated_at: new Date()
    };
    const deletedProvider: Provider = {
      id: 'deleted-provider',
      user_id: 'user-1',
      name: 'Legacy Provider',
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date()
    };
    await db.providers.bulkAdd([activeProvider, deletedProvider]);

    // Act: Fetch providers through the service.
    const providers = await getProviders();

    // Assert: Soft-deleted providers are excluded.
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('active-provider');
  });
});
