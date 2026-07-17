import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ChargingSession, type SyncPayload } from '../../../infra/db';
import { getSessions } from '../services/sessionService';
import { useAuth } from '../../auth';

type SettledQuery<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown };

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
  const sessionQuery = useLiveQuery<SettledQuery<ChargingSession[]>>(async () => {
    if (!user) return { status: 'success', data: [] };
    try {
      return { status: 'success', data: await getSessions(user.id) };
    } catch (error) {
      return { status: 'error', error };
    }
  }, [user?.id]);
  const pendingSyncQuery = useLiveQuery<SettledQuery<Set<string>>>(
    async () => {
      if (!user) {
        return { status: 'success', data: new Set<string>() };
      }
      try {
        const outbox = await db.sync_outbox.where('table_name').equals('sessions').toArray();
        // Outbox payloads share the source record id, which lets the history view
        // mark only the sessions still awaiting remote sync.
        return {
          status: 'success',
          data: new Set(
            outbox
              .filter((item) => (item.payload as SyncPayload).user_id === user.id)
              .map((item) => (item.payload as SyncPayload).id)
          ),
        };
      } catch (error) {
        return { status: 'error', error };
      }
    },
    [user?.id]
  );

  const error = sessionQuery?.status === 'error' ? sessionQuery.error : null;
  const pendingSyncError = pendingSyncQuery?.status === 'error'
    ? pendingSyncQuery.error
    : null;

  return {
    sessions: sessionQuery?.status === 'success' ? sessionQuery.data : [],
    pendingSyncIds: pendingSyncQuery?.status === 'success'
      ? pendingSyncQuery.data
      : new Set<string>(),
    isLoading: error === null
      && pendingSyncError === null
      && (sessionQuery === undefined || pendingSyncQuery === undefined),
    error,
    pendingSyncError,
  };
}
