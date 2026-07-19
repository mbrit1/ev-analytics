import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, type Provider, type ChargingPlan, type ChargingSession } from '../../../infra/db';
import { useSyncStatus } from './useSyncStatus';
import type { SyncRuntimeHydrationSnapshot } from '../model/types';
import 'fake-indexeddb/auto';

let hydrationSnapshot: SyncRuntimeHydrationSnapshot = {
  providers: { status: 'ready' },
  charging_plans: { status: 'ready' },
  sessions: { status: 'ready' }
};
const hydrationListeners = new Set<() => void>();

vi.mock('../services/syncRuntime', () => ({
  getSyncRuntimeHydrationSnapshot: () => hydrationSnapshot,
  subscribeSyncRuntimeHydration: (listener: () => void) => {
    hydrationListeners.add(listener);
    return () => hydrationListeners.delete(listener);
  }
}));

function publishHydrationSnapshot(snapshot: SyncRuntimeHydrationSnapshot): void {
  hydrationSnapshot = snapshot;
  hydrationListeners.forEach((listener) => listener());
}

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

type SessionOverrides =
  | Partial<Extract<ChargingSession, { session_mode: 'plan' }>>
  | Partial<Extract<ChargingSession, { session_mode: 'ad_hoc' }>>;

function buildChargingSession(overrides: SessionOverrides = {}): ChargingSession {
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
  } as unknown as ChargingSession;
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
    hydrationSnapshot = {
      providers: { status: 'ready' },
      charging_plans: { status: 'ready' },
      sessions: { status: 'ready' }
    };
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
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
      hydration: hydrationSnapshot,
      hasHydrationFailure: false,
      isHydrating: false,
      displayState: 'synced',
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

  it('surfaces a blocking error only after retry threshold from the oldest actionable failed item', async () => {
    // Arrange: Add one first-failure row and two threshold-qualified failed rows.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-first-failure' }),
        timestamp: new Date('2026-05-21T07:00:00.000Z'),
        retry_count: 1,
        next_attempt_at: new Date('2026-05-21T07:01:00.000Z'),
        last_error: 'First failure should not be user-visible yet'
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-oldest-failed' }),
        timestamp: new Date('2026-05-21T08:00:00.000Z'),
        retry_count: 2,
        next_attempt_at: new Date('2026-05-21T08:01:00.000Z'),
        last_error: 'Oldest actionable sync error'
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-newer-failed' }),
        timestamp: new Date('2026-05-21T09:00:00.000Z'),
        retry_count: 1,
        next_attempt_at: new Date('2026-05-21T09:01:00.000Z'),
        last_error: 'Newer sync error'
      }
    ]);

    // Act
    const { result } = renderHook(() => useSyncStatus());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert
    expect(result.current.hasBlockingSyncError).toBe(true);
    expect(result.current.blockingErrorMessage).toBe('Oldest actionable sync error');
    expect(result.current.retryCount).toBe(2);
    expect(result.current.nextRetryAt).toEqual(new Date('2026-05-21T08:01:00.000Z'));
  });

  it('does not surface blocking error for first-failure rows', async () => {
    // Arrange: Add only first-failure rows, which should stay silent for users.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-failure-1' }),
        timestamp: new Date('2026-05-21T08:00:00.000Z'),
        retry_count: 1,
        next_attempt_at: new Date('2026-05-21T08:01:00.000Z'),
        last_error: 'First failure'
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: buildChargingSession({ id: 'session-failure-2' }),
        timestamp: new Date('2026-05-21T09:00:00.000Z'),
        retry_count: 1,
        next_attempt_at: new Date('2026-05-21T09:01:00.000Z'),
        last_error: 'Another first failure'
      }
    ]);

    // Act
    const { result } = renderHook(() => useSyncStatus());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert
    expect(result.current.hasBlockingSyncError).toBe(false);
    expect(result.current.blockingErrorMessage).toBeUndefined();
    expect(result.current.retryCount).toBeUndefined();
    expect(result.current.nextRetryAt).toBeUndefined();
  });

  it('does not surface blocking error when threshold-qualified failures are deferred to future retry windows', async () => {
    // Arrange: Add a threshold-qualified failed row that is not actionable yet.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 'session-future-retry' }),
      timestamp: new Date('2026-05-21T08:00:00.000Z'),
      retry_count: 2,
      next_attempt_at: new Date('2999-01-01T00:00:00.000Z'),
      last_error: 'Deferred retry error'
    });

    // Act
    const { result } = renderHook(() => useSyncStatus());
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Assert
    expect(result.current.hasBlockingSyncError).toBe(false);
    expect(result.current.blockingErrorMessage).toBeUndefined();
    expect(result.current.retryCount).toBeUndefined();
    expect(result.current.nextRetryAt).toBeUndefined();
  });

  it('surfaces an isolated sessions hydration failure without hiding ready tables', async () => {
    // Arrange: Keep a pending write while the remote sessions pull fails and other tables hydrate.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 'session-pending-during-hydration-failure' }),
      timestamp: new Date('2026-05-21T08:00:00.000Z'),
    });
    const { result } = renderHook(() => useSyncStatus());

    // Act: Publish the isolated hydration result through the runtime store.
    publishHydrationSnapshot({
      providers: { status: 'ready' },
      charging_plans: { status: 'ready' },
      sessions: { status: 'failed', failureKind: 'invalid_data' }
    });

    // Assert: The hook retains the per-table result and elevates the sync issue.
    await waitFor(() => {
      expect(result.current.displayState).toBe('sync-issue');
    });
    expect(result.current.hydration.sessions).toEqual({ status: 'failed', failureKind: 'invalid_data' });
    expect(result.current.hydration.charging_plans).toEqual({ status: 'ready' });
    expect(result.current.hasHydrationFailure).toBe(true);
    expect(result.current.hasPendingSync).toBe(true);
  });

  it('reports syncing while hydration is loading', async () => {
    // Arrange: Start with a loading hydration snapshot and no pending mutations.
    hydrationSnapshot = {
      providers: { status: 'loading' },
      charging_plans: { status: 'loading' },
      sessions: { status: 'loading' }
    };

    // Act: Render the hook.
    const { result } = renderHook(() => useSyncStatus());

    // Assert: Hydration progress produces the syncing state.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isHydrating).toBe(true);
    expect(result.current.displayState).toBe('syncing');
  });

  it('prioritizes a blocking outbox error above a pending queue', async () => {
    // Arrange: Queue an actionable failed mutation that crosses the retry threshold.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: buildChargingSession({ id: 'session-blocking-error' }),
      timestamp: new Date('2026-05-21T08:00:00.000Z'),
      retry_count: 2,
      last_error: 'Unable to sync session'
    });

    // Act: Render the hook after the outbox query resolves.
    const { result } = renderHook(() => useSyncStatus());

    // Assert: A blocking error wins over the general pending state.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.hasPendingSync).toBe(true);
    expect(result.current.displayState).toBe('sync-issue');
  });
});
