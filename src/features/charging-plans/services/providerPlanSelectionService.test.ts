import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { EVAnalyticsDB, db, type Provider } from '../../../infra/db';
import { getProviderPlanSelections, setActivePlanSelection } from './providerPlanSelectionService';

/**
 * Test suite for provider-plan selection history service.
 *
 * Verifies selection history rows are append-only, closed on switch, and keep
 * unique IDs even when switching back to a previously used tariff plan.
 */
describe('providerPlanSelectionService', () => {
  beforeEach(async () => {
    await db.providers.clear();
    await db.provider_plan_selections.clear();
    await db.sync_outbox.clear();
    await db.providers.bulkAdd([
      {
        id: 'p1',
        user_id: 'u1',
        name: 'Provider one',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'p2',
        user_id: 'u2',
        name: 'Provider two',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('rejects stale selection creates and updates after another runtime removes the provider', async () => {
    // Arrange: create the current selection while the provider exists, then remove it from a second runtime.
    const provider: Provider = {
      id: 'staged-provider',
      user_id: 'u1',
      name: 'Staged provider',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    await db.providers.add(provider);
    const staleInput = {
      userId: 'u1',
      providerId: provider.id,
      tariffPlanId: 't-l',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      priceSnapshot: { label: 'Staged plan', kWhPrice: 59 },
    };
    const current = await setActivePlanSelection(staleInput);
    await db.sync_outbox.clear();

    const reconciliationRuntime = new EVAnalyticsDB();
    await reconciliationRuntime.providers.delete(provider.id);
    reconciliationRuntime.close();

    // Act and Assert: closing the old selection and inserting a successor both roll back.
    await expect(setActivePlanSelection({
      ...staleInput,
      tariffPlanId: 't-m',
      validFrom: new Date('2026-02-01T00:00:00.000Z'),
    })).rejects.toThrow('Provider reference is unavailable');
    expect(await db.provider_plan_selections.toArray()).toEqual([current]);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('creates a new selection row with unique id when switching plans', async () => {
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-l',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      priceSnapshot: { label: 'EnBW L', kWhPrice: 59 }
    });
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-m',
      validFrom: new Date('2026-05-28T00:00:00.000Z'),
      priceSnapshot: { label: 'EnBW M', kWhPrice: 69 }
    });

    const rows = await getProviderPlanSelections('p1', 'u1');
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].valid_to).toEqual(new Date('2026-05-28T00:00:00.000Z'));
    expect(rows[1].valid_to).toBeNull();
  });

  it('creates a third row when switching back to a prior tariff plan', async () => {
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-l',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      priceSnapshot: { label: 'EnBW L', kWhPrice: 59 }
    });
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-m',
      validFrom: new Date('2026-05-28T00:00:00.000Z'),
      priceSnapshot: { label: 'EnBW M', kWhPrice: 69 }
    });
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-l',
      validFrom: new Date('2026-08-10T00:00:00.000Z'),
      priceSnapshot: { label: 'EnBW L', kWhPrice: 64 }
    });

    const rows = await getProviderPlanSelections('p1', 'u1');
    expect(rows).toHaveLength(3);
    expect(rows[2].tariff_plan_id).toBe('t-l');
    expect(rows[2].price_snapshot).toEqual({ label: 'EnBW L', kWhPrice: 64 });
  });

  it('returns only rows for the requested user', async () => {
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-a',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      priceSnapshot: { label: 'Plan A', kWhPrice: 59 }
    });
    await setActivePlanSelection({
      userId: 'u2',
      providerId: 'p2',
      tariffPlanId: 't-b',
      validFrom: new Date('2026-01-02T00:00:00.000Z'),
      priceSnapshot: { label: 'Plan B', kWhPrice: 69 }
    });

    const rows = await getProviderPlanSelections('p1', 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('u1');
  });
});
