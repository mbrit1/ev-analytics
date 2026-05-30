import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../infra/db';

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

  if (outboxItems === undefined) {
    return {
      queueLength: 0,
      hasPendingSync: false,
      pendingByTable: emptyPendingByTable,
      hasBlockingSyncError: false,
      blockingErrorMessage: undefined,
      retryCount: undefined,
      nextRetryAt: undefined,
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
    if (!isActionableNow || !item.last_error) {
      continue;
    }

    if (blockingItem === undefined || item.timestamp < blockingItem.timestamp) {
      blockingItem = item;
    }
  }

  const queueLength = outboxItems.length;

  return {
    queueLength,
    hasPendingSync: queueLength > 0,
    pendingByTable,
    oldestPendingAt,
    hasBlockingSyncError: blockingItem != null,
    blockingErrorMessage: blockingItem?.last_error,
    retryCount: blockingItem?.retry_count,
    nextRetryAt: blockingItem?.next_attempt_at,
    isLoading: false
  };
}
