import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { db } from '../../../infra/db';
import {
  getSyncRuntimeHydrationSnapshot,
  subscribeSyncRuntimeHydration
} from '../services/syncRuntime';
import type { SyncRuntimeHydrationSnapshot } from '../model/types';

/** The concise sync condition rendered by application-level status UI. */
export type SyncDisplayState = 'sync-issue' | 'pending' | 'syncing' | 'synced';

/**
 * Counts of pending sync mutations grouped by local table.
 */
export interface PendingSyncByTable {
  /** Pending provider mutations. */
  providers: number;
  /** Pending charging-plan mutations. */
  charging_plans: number;
  /** Pending charging session mutations. */
  sessions: number;
  /** Pending provider-plan selection history mutations. */
  provider_plan_selections: number;
}

/**
 * Normalized view of the local sync outbox for UI and diagnostics.
 */
export interface SyncStatus {
  /** Total number of queued sync mutations. */
  queueLength: number;
  /** Whether any local mutations are waiting to sync. */
  hasPendingSync: boolean;
  /** Pending mutation counts grouped by table. */
  pendingByTable: PendingSyncByTable;
  /** Earliest queued mutation timestamp when pending work exists. */
  oldestPendingAt?: Date;
  /** Whether the outbox has a currently actionable item with a recorded sync error. */
  hasBlockingSyncError: boolean;
  /** Human-readable last error for the oldest actionable blocking outbox item. */
  blockingErrorMessage?: string;
  /** Retry count for the oldest actionable blocking outbox item. */
  retryCount?: number;
  /** Next scheduled retry for the oldest actionable blocking outbox item. */
  nextRetryAt?: Date;
  /** Per-table state of the latest authenticated remote hydration pass. */
  hydration: SyncRuntimeHydrationSnapshot;
  /** Whether any remote table failed during hydration. */
  hasHydrationFailure: boolean;
  /** Whether any remote table is awaiting or actively performing hydration. */
  isHydrating: boolean;
  /** Overall sync state after applying user-facing status precedence rules. */
  displayState: SyncDisplayState;
  /** Whether the live outbox query has not resolved yet. */
  isLoading: boolean;
}

const emptyPendingByTable: PendingSyncByTable = {
  providers: 0,
  charging_plans: 0,
  sessions: 0,
  provider_plan_selections: 0
};

/**
 * Reads the local sync outbox and returns normalized pending sync status.
 */
export function useSyncStatus(): SyncStatus {
  const outboxItems = useLiveQuery(() => db.sync_outbox.toArray(), []);
  const hydration = useSyncExternalStore(
    subscribeSyncRuntimeHydration,
    getSyncRuntimeHydrationSnapshot,
    getSyncRuntimeHydrationSnapshot
  );
  const hasHydrationFailure = Object.values(hydration).some((table) => table.status === 'failed');
  const isHydrating = Object.values(hydration).some(
    (table) => table.status === 'idle' || table.status === 'loading'
  );

  if (outboxItems === undefined) {
    return {
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: emptyPendingByTable,
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
      hydration,
      hasHydrationFailure,
      isHydrating,
      displayState: hasHydrationFailure ? 'sync-issue' : 'syncing',
      isLoading: true
    };
  }

  const pendingByTable: PendingSyncByTable = { ...emptyPendingByTable };
  let oldestPendingAt: Date | undefined;
  const now = new Date();
  let blockingItem:
    | {
      timestamp: Date;
      last_error?: string;
      retry_count?: number;
      next_attempt_at?: Date;
    }
    | undefined;

  for (const item of outboxItems) {
    pendingByTable[item.table_name] += 1;

    if (oldestPendingAt === undefined || item.timestamp < oldestPendingAt) {
      oldestPendingAt = item.timestamp;
    }

    const isActionableNow = item.next_attempt_at == null || item.next_attempt_at <= now;
    const hasExceededRetryThreshold = (item.retry_count ?? 0) >= 2;
    if (!isActionableNow || !item.last_error || !hasExceededRetryThreshold) {
      continue;
    }

    if (blockingItem === undefined || item.timestamp < blockingItem.timestamp) {
      blockingItem = item;
    }
  }

  const queueLength = outboxItems.length;
  const hasBlockingSyncError = blockingItem != null;
  const displayState: SyncDisplayState = hasHydrationFailure || hasBlockingSyncError
    ? 'sync-issue'
    : queueLength > 0
      ? 'pending'
      : isHydrating
        ? 'syncing'
        : 'synced';

  return {
    queueLength,
    hasPendingSync: queueLength > 0,
    pendingByTable,
    oldestPendingAt,
    hasBlockingSyncError,
    blockingErrorMessage: blockingItem?.last_error,
    retryCount: blockingItem?.retry_count,
    nextRetryAt: blockingItem?.next_attempt_at,
    hydration,
    hasHydrationFailure,
    isHydrating,
    displayState,
    isLoading: false
  };
}
