import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Provider } from '../../../infra/db';
import {
  DuplicateProviderNameError,
  getProviders,
  saveProvider
} from './providerService';
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

  it('should return only non-deleted providers for requested user', async () => {
    // Arrange: Seed one active and one soft-deleted provider for user-1 and one active provider for user-2.
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
    const otherUserProvider: Provider = {
      id: 'other-user-provider',
      user_id: 'user-2',
      name: 'Other User Provider',
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.providers.bulkAdd([activeProvider, deletedProvider, otherUserProvider]);

    // Act: Fetch providers through the service for user-1.
    const providers = await getProviders('user-1');

    // Assert: Soft-deleted and foreign-user providers are excluded.
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('active-provider');
  });

  it('should reject duplicate active provider names case-insensitively', async () => {
    // Arrange: Seed one active provider for the same user.
    const existingProvider: Provider = {
      id: 'provider-existing',
      user_id: 'user-1',
      name: 'EnBW',
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.providers.add(existingProvider);

    const duplicateProvider: Provider = {
      id: 'provider-duplicate',
      user_id: 'user-1',
      name: '  enbw  ',
      created_at: new Date(),
      updated_at: new Date()
    };

    // Act: Attempt to save the case-insensitive duplicate.
    const error = await saveProvider(duplicateProvider).catch((cause: unknown) => cause);

    // Assert: A typed error exposes the existing provider for recovery.
    expect(error).toBeInstanceOf(DuplicateProviderNameError);
    expect(error).toMatchObject({
      name: 'DuplicateProviderNameError',
      message: 'Provider name already exists (active, case-insensitive)',
      provider: existingProvider
    });
  });

  it('should reject a provider name that is empty after trimming', async () => {
    // Arrange: Build a provider whose name contains only whitespace.
    const provider: Provider = {
      id: 'provider-empty-name',
      user_id: 'user-1',
      name: '   ',
      created_at: new Date(),
      updated_at: new Date()
    };

    // Act: Attempt to save the invalid provider.
    const saveResult = saveProvider(provider);

    // Assert: Validation fails before either local record is written.
    await expect(saveResult).rejects.toThrow('Provider name is required');
    expect(await db.providers.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it.each([
    ['longer than 120 Unicode code points', 'A'.repeat(121), 'Provider name must be 120 characters or fewer'],
    ['containing a control character', 'New\u0007 CPO', 'Provider name cannot contain control characters'],
  ])('should reject a provider name %s before writing local records', async (_description, name, message) => {
    // Arrange: Build a provider that violates the durable name contract.
    const provider: Provider = {
      id: 'provider-invalid-name',
      user_id: 'user-1',
      name,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Act: Attempt to save the invalid provider.
    const saveResult = saveProvider(provider);

    // Assert: Neither the provider nor its outbox entry is persisted.
    await expect(saveResult).rejects.toThrow(message);
    expect(await db.providers.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('should accept a provider name containing exactly 120 Unicode code points', async () => {
    // Arrange: Build a name whose JavaScript UTF-16 length exceeds its code-point count.
    const provider: Provider = {
      id: 'provider-unicode-boundary',
      user_id: 'user-1',
      name: '⚡'.repeat(120),
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Act: Save the maximum-length valid provider name.
    await saveProvider(provider);

    // Assert: The durable limit counts Unicode code points rather than UTF-16 units.
    expect(await db.providers.get(provider.id)).toMatchObject({ name: provider.name });
  });

  it('should allow provider name reuse when only soft-deleted matches exist', async () => {
    // Arrange: Seed a soft-deleted provider with a matching name.
    const softDeletedProvider: Provider = {
      id: 'provider-deleted',
      user_id: 'user-1',
      name: 'Fastned',
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date()
    };
    await db.providers.add(softDeletedProvider);

    const reusedNameProvider: Provider = {
      id: 'provider-new',
      user_id: 'user-1',
      name: '  FASTNED ',
      created_at: new Date(),
      updated_at: new Date()
    };

    // Act: Save provider that reuses a soft-deleted name.
    await saveProvider(reusedNameProvider);

    // Assert: Save succeeds and a normalized name is persisted.
    const savedProvider = await db.providers.get('provider-new');
    expect(savedProvider?.name).toBe('FASTNED');
  });

  it('should allow editing same provider without changing effective name', async () => {
    // Arrange: Seed provider to update in-place.
    const provider: Provider = {
      id: 'provider-edit',
      user_id: 'user-1',
      name: 'Ionity',
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.providers.add(provider);

    // Act: Update same provider id with only whitespace/case variation.
    await saveProvider({
      ...provider,
      name: ' ionity '
    });

    // Assert: Update succeeds and trims persisted name.
    const updated = await db.providers.get('provider-edit');
    expect(updated?.name).toBe('ionity');
  });
});
