import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SyncPayload } from '../../../lib/db';
import { getSessions } from '../services/sessionService';

export function useSessions() {
  const sessions = useLiveQuery(() => getSessions(), []);
  const pendingSyncIds = useLiveQuery(
    async () => {
      const outbox = await db.sync_outbox.where('table_name').equals('sessions').toArray();
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
