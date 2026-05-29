import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type Provider, type ChargingPlan, type ChargingSession } from '../../../infra/db';
import { useSyncStatus } from './useSyncStatus';
import 'fake-indexeddb/auto';

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  const now = new Date('2026-05-21T00:00:00.000Z');
  return {
    id: 'provider-default',
    user_id: 'user-1',
    name: 'Ionity',
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function buildChargingPlan(overrides: Partial<ChargingPlan> = {}): ChargingPlan {
  const now = new Date('2026-05-21T00:00:00.000Z');
  return {
    id: 'plan-default',
    user_id: 'user-1',
    provider_id: 'provider-default',
    name: 'Default Plan',
    valid_from: new Date(),
          valid_to: null,
    ac_price_per_kwh: 49, dc_price_per_kwh: 79 ,
      monthly_base_fee: 0,
      session_fee: 0,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function buildChargingSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const now = new Date('2026-05-21T00:00:00.000Z');
  return {
    id: 'session-default',
    user_id: 'user-1',
    session_timestamp: new Date('2026-05-21T12:00:00.000Z'),
    provider_id: 'provider-default',
    provider_name_snapshot: 'Ionity',
    tariff_plan_id: 'plan-default',
    charging_plan_name_snapshot: 'Default Plan',
    charging_type: 'DC',
    kwh_billed: 10,
    total_cost: 790,
    session_mode: 'plan',
    applied_dc_price_per_kwh: 79,
    applied_session_fee: 0,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

/**
 * Test suite for the sync status live query hook.
 *
 * Verifies normalized outbox queue counts, pending state, and oldest pending
 * timestamp derivation from local Dexie state.
 */
describe('useSyncStatus', () => {
  beforeEach(async () => {
    await db.sync_outbox.clear();
  });

  it('returns an empty status after the outbox live query resolves', async () => {
    // Arrange: Start with no queued local mutations.

    // Act: Render the hook and let the live query resolve.
    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: Empty outbox state is normalized for consumers.
    expect(result.current).toEqual({
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: { providers: 0, charging_plans: 0, sessions: 0, provider_plan_selections: 0 },
      oldestPendingAt: undefined,
      isLoading: false
    });
  });

  it('counts mixed provider charging plan and session outbox entries by table', async () => {
    // Arrange: Queue local mutations across every sync-supported table.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: buildProvider({ id: 'provider-1' }),
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        table_name: 'charging_plans',
        action: 'UPDATE',
        payload: buildChargingPlan({ id: 'plan-1' }),
        timestamp: new Date('2026-05-21T09:01:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-1' }),
        timestamp: new Date('2026-05-21T09:02:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'DELETE',
        payload: buildChargingSession({ id: 'session-2' }),
        timestamp: new Date('2026-05-21T09:03:00.000Z')
      }
    ]);

    // Act: Render the hook and let the live query resolve.
    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: Pending status and per-table counts reflect the outbox contents.
    expect(result.current.queueLength).toBe(4);
    expect(result.current.hasPendingSync).toBe(true);
    expect(result.current.pendingByTable).toEqual({
      providers: 1,
      charging_plans: 1,
      sessions: 2,
      provider_plan_selections: 0
    });
  });

  it('returns the earliest oldest pending timestamp from non-sorted outbox entries', async () => {
    // Arrange: Queue mutations in an order that differs from timestamp order.
    const earliestTimestamp = new Date('2026-05-21T08:00:00.000Z');
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-newer' }),
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      },
      {
        table_name: 'charging_plans',
        action: 'UPDATE',
        payload: buildChargingPlan({ id: 'plan-earliest' }),
        timestamp: earliestTimestamp
      },
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: buildProvider({ id: 'provider-middle' }),
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      }
    ]);

    // Act: Render the hook and let the live query resolve.
    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert: The oldest pending timestamp is derived independently of insertion order.
    expect(result.current.oldestPendingAt).toEqual(earliestTimestamp);
  });
});
