import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type SyncPayload } from '../../../lib/db';
import { useSyncStatus } from './useSyncStatus';
import 'fake-indexeddb/auto';

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
      pendingByTable: { providers: 0, tariffs: 0, sessions: 0 },
      oldestPendingAt: undefined,
      isLoading: false
    });
  });

  it('counts mixed provider tariff and session outbox entries by table', async () => {
    // Arrange: Queue local mutations across every sync-supported table.
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: { id: 'provider-1' } as SyncPayload,
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        table_name: 'tariffs',
        action: 'UPDATE',
        payload: { id: 'tariff-1' } as SyncPayload,
        timestamp: new Date('2026-05-21T09:01:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'session-1' } as SyncPayload,
        timestamp: new Date('2026-05-21T09:02:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'DELETE',
        payload: { id: 'session-2' } as SyncPayload,
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
    expect(result.current.pendingByTable).toEqual({ providers: 1, tariffs: 1, sessions: 2 });
  });

  it('returns the earliest oldest pending timestamp from non-sorted outbox entries', async () => {
    // Arrange: Queue mutations in an order that differs from timestamp order.
    const earliestTimestamp = new Date('2026-05-21T08:00:00.000Z');
    await db.sync_outbox.bulkAdd([
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'session-newer' } as SyncPayload,
        timestamp: new Date('2026-05-21T10:00:00.000Z')
      },
      {
        table_name: 'tariffs',
        action: 'UPDATE',
        payload: { id: 'tariff-earliest' } as SyncPayload,
        timestamp: earliestTimestamp
      },
      {
        table_name: 'providers',
        action: 'INSERT',
        payload: { id: 'provider-middle' } as SyncPayload,
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
