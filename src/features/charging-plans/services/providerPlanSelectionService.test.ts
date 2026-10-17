import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { EVAnalyticsDB, db, type Provider, type ProviderPlanSelection } from '../../../infra/db';
import {
  applyActivePlanSelectionChange,
  getActivePlanSelectionAt,
  getProviderPlanSelections,
  setActivePlanSelection,
} from './providerPlanSelectionService';

/**
 * Test suite for provider-plan selection history service.
 *
 * Verifies selection history rows are append-only, closed on switch, and keep
 * unique IDs even when switching back to a previously used tariff plan.
 */
describe('providerPlanSelectionService', () => {
  const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

  function buildSelection(overrides: Partial<ProviderPlanSelection> = {}): ProviderPlanSelection {
    return {
      id: 'selection-default',
      user_id: 'u1',
      provider_id: 'p1',
      tariff_plan_id: 't-l',
      valid_from: utc('2026-01-01'),
      valid_to: null,
      price_snapshot: { label: 'Plan', kWhPrice: 50 },
      created_at: utc('2026-01-01'),
      updated_at: utc('2026-01-01'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
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

  it('chooses the canonical covering row by latest start, then lexical ID, across plans', async () => {
    // Arrange: deliberately overlap plan histories and include an equal-start conflict.
    const rows = [
      buildSelection({ id: 'older', tariff_plan_id: 't-a', valid_from: utc('2026-01-01') }),
      buildSelection({ id: 'newer-start', tariff_plan_id: 't-b', valid_from: utc('2026-04-01') }),
      buildSelection({ id: 'equal-z', tariff_plan_id: 't-c', valid_from: utc('2026-05-01') }),
      buildSelection({ id: 'equal-a', tariff_plan_id: 't-d', valid_from: utc('2026-05-01') }),
    ];
    await db.provider_plan_selections.bulkAdd(rows);

    // Act: lookup at an instant covered by every row.
    const winner = await getActivePlanSelectionAt('p1', 'u1', utc('2026-06-01'));

    // Assert: latest valid_from wins first; greatest lexical ID wins equal starts.
    expect(winner?.id).toBe('equal-z');
  });

  it('inserts a backdated row between predecessor and finite successor without extending either endpoint', async () => {
    // Arrange: retain an earlier interval and a future row with an explicit finite closure.
    const predecessor = buildSelection({ id: 'predecessor', valid_from: utc('2026-01-01'), valid_to: utc('2026-07-01') });
    const successor = buildSelection({ id: 'successor', tariff_plan_id: 't-m', valid_from: utc('2026-09-01'), valid_to: utc('2026-12-01') });
    await db.provider_plan_selections.bulkAdd([predecessor, successor]);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000003');

    // Act: add an event in the gap before the existing future event.
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-new',
      validFrom: utc('2026-08-01'),
      priceSnapshot: { label: 'Backdated', kWhPrice: 55 },
    });

    // Assert: the new row ends at its successor and the finite closure is preserved.
    expect(await db.provider_plan_selections.get('predecessor')).toMatchObject({ valid_to: utc('2026-07-01') });
    expect(await db.provider_plan_selections.get('00000000-0000-4000-8000-000000000003')).toMatchObject({ valid_from: utc('2026-08-01'), valid_to: utc('2026-09-01') });
    expect(await db.provider_plan_selections.get('successor')).toMatchObject({ valid_from: utc('2026-09-01'), valid_to: utc('2026-12-01') });
  });

  it('keeps the losing equal-start row addressable with a zero-length interval', async () => {
    // Arrange: an existing selection ID sorts after the deterministic inserted ID.
    const existing = buildSelection({ id: '00000000-0000-4000-8000-000000000002', valid_from: utc('2026-01-01') });
    await db.provider_plan_selections.add(existing);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

    // Act: add another event at the exact same instant.
    await setActivePlanSelection({
      userId: 'u1',
      providerId: 'p1',
      tariffPlanId: 't-m',
      validFrom: utc('2026-01-01'),
      priceSnapshot: { label: 'Same instant', kWhPrice: 60 },
    });

    // Assert: the losing row keeps its ID and becomes empty at the tie boundary.
    expect(await db.provider_plan_selections.get('00000000-0000-4000-8000-000000000001')).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      valid_from: utc('2026-01-01'),
      valid_to: utc('2026-01-01'),
    });
    expect(await db.provider_plan_selections.get(existing.id)).toMatchObject({
      id: existing.id,
      valid_from: utc('2026-01-01'),
      valid_to: null,
    });
    expect(await getActivePlanSelectionAt('p1', 'u1', utc('2026-01-01'))).toMatchObject({ id: existing.id });
  });

  it('caps a backdated row at a future open selection even when no predecessor exists', async () => {
    // Arrange: the first existing event is in the future.
    const future = buildSelection({ id: 'future-open', tariff_plan_id: 't-m', valid_from: utc('2026-09-01') });
    await db.provider_plan_selections.add(future);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000004');

    // Act: insert a selection before the first event.
    await setActivePlanSelection({
      userId: 'u1', providerId: 'p1', tariffPlanId: 't-a', validFrom: utc('2026-06-01'),
      priceSnapshot: { label: 'Backdated', kWhPrice: 55 },
    });

    // Assert: the new interval ends at the successor and leaves its open end intact.
    expect(await db.provider_plan_selections.get('00000000-0000-4000-8000-000000000004'))
      .toMatchObject({ valid_to: utc('2026-09-01') });
    expect(await db.provider_plan_selections.get('future-open')).toMatchObject({ valid_to: null });
  });

  it('uses a tombstoned successor as a boundary for a backdated insertion', async () => {
    // Arrange: a deleted row still records the next historical event boundary.
    await db.provider_plan_selections.add(buildSelection({
      id: 'deleted-successor',
      valid_from: utc('2026-09-01'),
      deleted_at: utc('2026-10-01'),
    }));
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000005');

    // Act: insert before that tombstone.
    await setActivePlanSelection({
      userId: 'u1', providerId: 'p1', tariffPlanId: 't-a', validFrom: utc('2026-06-01'),
      priceSnapshot: { label: 'Backdated', kWhPrice: 55 },
    });

    // Assert: the tombstone itself stays hidden and its start still caps the new interval.
    expect(await db.provider_plan_selections.get('00000000-0000-4000-8000-000000000005'))
      .toMatchObject({ valid_to: utc('2026-09-01') });
    expect(await db.provider_plan_selections.get('deleted-successor')).toMatchObject({ deleted_at: utc('2026-10-01') });
    expect(await getActivePlanSelectionAt('p1', 'u1', utc('2026-09-15'))).toBeNull();
  });

  it('keeps a new equal-start event empty when a later-ID tombstone defines the boundary', async () => {
    // Arrange: a tombstoned equal-start row still wins the lexical event boundary.
    await db.provider_plan_selections.add(buildSelection({
      id: '00000000-0000-4000-8000-000000000002',
      valid_from: utc('2026-06-01'),
      deleted_at: utc('2026-07-01'),
    }));
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

    // Act: append a lower-ID event at the tombstone's start.
    await setActivePlanSelection({
      userId: 'u1', providerId: 'p1', tariffPlanId: 't-a', validFrom: utc('2026-06-01'),
      priceSnapshot: { label: 'Same start', kWhPrice: 55 },
    });

    // Assert: the new row remains addressable with no active duration.
    expect(await db.provider_plan_selections.get('00000000-0000-4000-8000-000000000001'))
      .toMatchObject({ valid_from: utc('2026-06-01'), valid_to: utc('2026-06-01') });
    expect(await db.provider_plan_selections.get('00000000-0000-4000-8000-000000000002'))
      .toMatchObject({ deleted_at: utc('2026-07-01') });
  });

  it('refuses to mutate malformed overlapping history without changing rows or outbox', async () => {
    // Arrange: preserve an unrelated legacy overlap exactly as stored.
    const history = [
      buildSelection({ id: 'overlap-a', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-01') }),
      buildSelection({ id: 'overlap-b', tariff_plan_id: 't-m', valid_from: utc('2026-04-01'), valid_to: null }),
    ];
    await db.provider_plan_selections.bulkAdd(history);

    // Act/Assert: do not guess a repair while trying to append another event.
    await expect(setActivePlanSelection({
      userId: 'u1', providerId: 'p1', tariffPlanId: 't-x', validFrom: utc('2026-06-01'),
      priceSnapshot: { label: 'New', kWhPrice: 60 },
    })).rejects.toThrow('Cannot change overlapping provider plan selection history');

    // Assert: the rejected mutation leaves both legacy rows and queue state unchanged.
    expect(await db.provider_plan_selections.toArray()).toEqual(history);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('writes interval mutations through a second Dexie transaction connection', async () => {
    // Arrange: seed an open selection through the primary connection and use another connection for the switch.
    const current = await setActivePlanSelection({
      userId: 'u1', providerId: 'p1', tariffPlanId: 't-a', validFrom: utc('2026-01-01'),
      priceSnapshot: { label: 'A', kWhPrice: 50 },
    });
    const secondRuntime = new EVAnalyticsDB();

    // Act: the service helper must resolve the ambient transaction's tables on the second connection.
    try {
      await secondRuntime.transaction(
        'rw',
        secondRuntime.providers,
        secondRuntime.provider_plan_selections,
        secondRuntime.sync_outbox,
        async () => applyActivePlanSelectionChange({
          userId: 'u1', providerId: 'p1', tariffPlanId: 't-b', validFrom: utc('2026-03-01'),
          priceSnapshot: { label: 'B', kWhPrice: 60 },
        })
      );
    } finally {
      secondRuntime.close();
    }

    // Assert: the first interval closes and the second connection queued both selection mutations.
    expect(await db.provider_plan_selections.get(current.id)).toMatchObject({ valid_to: utc('2026-03-01') });
    expect(await db.provider_plan_selections.count()).toBe(2);
    expect(await db.sync_outbox.count()).toBe(3);
  });

});
