import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../../infra/db';
import { getProviderPlanSelections, setActivePlanSelection } from './providerPlanSelectionService';

/**
 * Test suite for provider-plan selection history service.
 *
 * Verifies selection history rows are append-only, closed on switch, and keep
 * unique IDs even when switching back to a previously used tariff plan.
 */
describe('providerPlanSelectionService', () => {
  beforeEach(async () => {
    await db.provider_plan_selections.clear();
    await db.sync_outbox.clear();
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
      providerId: 'p1',
      tariffPlanId: 't-b',
      validFrom: new Date('2026-01-02T00:00:00.000Z'),
      priceSnapshot: { label: 'Plan B', kWhPrice: 69 }
    });

    const rows = await getProviderPlanSelections('p1', 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('u1');
  });
});
