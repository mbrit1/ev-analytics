import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SyncPayload } from '../../../infra/db';
import { getSessions } from '../services/sessionService';
import { useAuth } from '../../auth';

/**
 * Subscribes UI components to charging sessions and their pending sync status.
 *
 * Dexie live queries re-run when the underlying IndexedDB tables change, so
 * session lists update after local saves and after the sync engine clears outbox
 * entries.
 *
 * @returns Current sessions, session ids still waiting to sync, and loading state.
 */
export function useSessions() {
  const { user } = useAuth();
  const sessions = useLiveQuery(async () => {
    if (!user) return [];
    return getSessions(user.id);
  }, [user?.id]);
  const pendingSyncIds = useLiveQuery(
    async () => {
      if (!user) {
        return new Set<string>();
      }
      const outbox = await db.sync_outbox.where('table_name').equals('sessions').toArray();
      // Outbox payloads share the source record id, which lets the history view
      // mark only the sessions still awaiting remote sync.
      return new Set(
        outbox
          .filter((item) => (item.payload as SyncPayload).user_id === user.id)
          .map((item) => (item.payload as SyncPayload).id)
      );
    },
    [user?.id]
  );

  return {
    sessions: sessions || [],
    pendingSyncIds: pendingSyncIds || new Set<string>(),
    isLoading: sessions === undefined || pendingSyncIds === undefined,
  };
}
