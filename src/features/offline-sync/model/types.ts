export type { SyncPayload, SyncOutbox, SyncOutboxEntry } from '../../../infra/db'

/** Remote tables hydrated into the authenticated user's local cache. */
export type InitialSyncTable = 'providers' | 'charging_plans' | 'sessions';

/** Stable failure categories safe to expose to application state. */
export type HydrationFailureKind = 'network' | 'invalid_data' | 'unknown';

/** Result of one table's initial remote-to-local hydration attempt. */
export type InitialSyncTableOutcome =
  | { status: 'ready' }
  | { status: 'failed'; failureKind: HydrationFailureKind }
  | { status: 'aborted' };

/** Per-table outcome returned after an isolated initial hydration pass. */
export type InitialSyncResult = Record<InitialSyncTable, InitialSyncTableOutcome>;

/** Observable runtime state for one remote hydration table. */
export type HydrationTableState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; failureKind: HydrationFailureKind };

/** Current authenticated runtime hydration state exposed to UI hooks. */
export type SyncRuntimeHydrationSnapshot = Record<InitialSyncTable, HydrationTableState>;
