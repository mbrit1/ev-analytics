import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ChargingSession, type SyncPayload } from '../../../infra/db';
import { getSessions } from '../services/sessionService';
import { useAuth } from '../../auth';

type SettledQuery<T> =
  | { userId: string | null; status: 'success'; data: T }
  | { userId: string | null; status: 'error'; error: unknown };

/** Current local charging-session data and its independent query diagnostics. */
export interface UseSessionsResult {
  /** User-owned local charging sessions, or an empty fallback before success. */
  sessions: ChargingSession[];
  /** Session ids whose writes are still queued for synchronization. */
  pendingSyncIds: Set<string>;
  /** Whether either local source is still resolving without a known error. */
  isLoading: boolean;
  /** Failure from the session-row read used by Analytics calculations. */
  error: unknown | null;
  /** Independent failure from the pending-sync outbox decoration read. */
  pendingSyncError: unknown | null;
}

/**
 * Subscribes UI components to charging sessions and their pending sync status.
 *
 * Dexie live queries re-run when the underlying IndexedDB tables change, so
 * session lists update after local saves and after the sync engine clears outbox
 * entries.
 *
 * @returns Current sessions, session ids still waiting to sync, and loading state.
 */
export function useSessions(): UseSessionsResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const sessionQuery = useLiveQuery<SettledQuery<ChargingSession[]>>(async () => {
    if (!user) return { userId, status: 'success', data: [] };
    try {
      return { userId, status: 'success', data: await getSessions(user.id) };
    } catch (error) {
      return { userId, status: 'error', error: error ?? new Error('Session read failed') };
    }
  }, [userId]);
  const pendingSyncQuery = useLiveQuery<SettledQuery<Set<string>>>(
    async () => {
      if (!user) {
        return { userId, status: 'success', data: new Set<string>() };
      }
      try {
        const outbox = await db.sync_outbox.where('table_name').equals('sessions').toArray();
        // Outbox payloads share the source record id, which lets the history view
        // mark only the sessions still awaiting remote sync.
        return {
          userId,
          status: 'success',
          data: new Set(
            outbox
              .filter((item) => (item.payload as SyncPayload).user_id === user.id)
              .map((item) => (item.payload as SyncPayload).id)
          ),
        };
      } catch (error) {
        return { userId, status: 'error', error: error ?? new Error('Pending sync read failed') };
      }
    },
    [userId]
  );

  // A live query can retain its previous value while dependencies switch. Only
  // expose a settled value once it belongs to the currently authenticated user.
  const currentSessionQuery = sessionQuery?.userId === userId ? sessionQuery : undefined;
  const currentPendingSyncQuery = pendingSyncQuery?.userId === userId ? pendingSyncQuery : undefined;
  const error = currentSessionQuery?.status === 'error' ? currentSessionQuery.error : null;
  const pendingSyncError = currentPendingSyncQuery?.status === 'error'
    ? currentPendingSyncQuery.error
    : null;

  return {
    sessions: currentSessionQuery?.status === 'success' ? currentSessionQuery.data : [],
    pendingSyncIds: currentPendingSyncQuery?.status === 'success'
      ? currentPendingSyncQuery.data
      : new Set<string>(),
    isLoading: currentSessionQuery === undefined
      || (error === null && pendingSyncError === null && currentPendingSyncQuery === undefined),
    error,
    pendingSyncError,
  };
}
