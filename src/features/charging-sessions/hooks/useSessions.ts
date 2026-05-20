import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SyncPayload } from '../../../lib/db';
import { getSessions } from '../services/sessionService';

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
  const sessions = useLiveQuery(() => getSessions(), []);
  const pendingSyncIds = useLiveQuery(
    async () => {
      const outbox = await db.sync_outbox.where('table_name').equals('sessions').toArray();
      // Outbox payloads share the source record id, which lets the history view
      // mark only the sessions still awaiting remote sync.
      return new Set(outbox.map(item => (item.payload as SyncPayload).id));
    },
    []
  );

  return {
    sessions: sessions || [],
    pendingSyncIds: pendingSyncIds || new Set<string>(),
    isLoading: sessions === undefined || pendingSyncIds === undefined,
  };
}
