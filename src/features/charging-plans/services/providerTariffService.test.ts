import { beforeEach, describe, expect, it } from 'vitest';
import { db, type ChargingPlan, type Provider } from '../../../infra/db';
import { createProviderWithTariff } from './providerTariffService';
import 'fake-indexeddb/auto';

const buildProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'provider-new',
  user_id: 'user-1',
  name: 'EWE Go',
  created_at: new Date('2026-07-30T08:00:00.000Z'),
  updated_at: new Date('2026-07-30T08:00:00.000Z'),
  ...overrides
});

const buildPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: 'plan-new',
  user_id: 'user-1',
  provider_id: 'provider-new',
  name: 'EWE Go Standard',
  valid_from: new Date('2026-08-01T00:00:00.000Z'),
  valid_to: null,
  ac_price_per_kwh: 49,
  monthly_base_fee: 0,
  session_fee: 0,
  created_at: new Date('2026-07-30T08:00:00.000Z'),
  updated_at: new Date('2026-07-30T08:00:00.000Z'),
  ...overrides
});

/**
 * Test suite for atomic provider-and-first-tariff persistence.
 *
 * Verifies ownership and linkage validation, provider-first outbox ordering,
 * and complete rollback through the real fake-IndexedDB transaction boundary.
 */
describe('providerTariffService', () => {
  beforeEach(async () => {
    // Arrange: Keep provider, tariff, and outbox state isolated for each test.
    await db.providers.clear();
    await db.charging_plans.clear();
    await db.sync_outbox.clear();
  });

  it('should save a provider and its first tariff with provider-first outbox order', async () => {
    // Arrange: Build matching provider and tariff records.
    const provider = buildProvider({ name: '  EWE Go  ' });
    const plan = buildPlan();

    // Act: Persist both records through the combined service.
    await createProviderWithTariff({ provider, plan });

    // Assert: Both records persist and the dependency enters the outbox first.
    expect(await db.providers.get(provider.id)).toMatchObject({
      id: provider.id,
      name: 'EWE Go'
    });
    expect(await db.charging_plans.get(plan.id)).toMatchObject({
      id: plan.id,
      provider_id: provider.id
    });

    const outbox = (await db.sync_outbox.toArray())
      .sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
    expect(outbox).toHaveLength(2);
    expect(outbox.map((entry) => entry.table_name)).toEqual([
      'providers',
      'charging_plans'
    ]);
    expect(outbox[0]!.id).toEqual(expect.any(Number));
    expect(outbox[1]!.id).toEqual(expect.any(Number));
    expect(outbox[0]!.id!).toBeLessThan(outbox[1]!.id!);
  });

  it('should roll back the provider when tariff validation fails', async () => {
    // Arrange: Build a valid provider and a tariff without meaningful pricing.
    const provider = buildProvider();
    const plan = buildPlan({
      ac_price_per_kwh: undefined,
      dc_price_per_kwh: undefined,
      roaming_ac_price_per_kwh: undefined,
      roaming_dc_price_per_kwh: undefined,
      monthly_base_fee: 0,
      session_fee: 0
    });

    // Act: Attempt the combined write with the invalid tariff.
    const saveResult = createProviderWithTariff({ provider, plan });

    // Assert: The tariff error aborts provider, tariff, and outbox writes.
    await expect(saveResult).rejects.toThrow(
      'charging plan requires at least one price or fee value'
    );
    expect(await db.providers.count()).toBe(0);
    expect(await db.charging_plans.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it.each([
    {
      mismatch: 'different user ids',
      provider: buildProvider({ user_id: 'user-provider' }),
      plan: buildPlan({ user_id: 'user-plan' })
    },
    {
      mismatch: 'different provider ids',
      provider: buildProvider({ id: 'provider-input' }),
      plan: buildPlan({ provider_id: 'provider-plan' })
    }
  ])('should reject $mismatch before writing any records', async ({ provider, plan }) => {
    // Arrange: Use the mismatched provider and tariff identities from the case.

    // Act: Attempt the combined write.
    const saveResult = createProviderWithTariff({ provider, plan });

    // Assert: Identity validation fails before any local mutation is made.
    await expect(saveResult).rejects.toThrow();
    expect(await db.providers.count()).toBe(0);
    expect(await db.charging_plans.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });
});
