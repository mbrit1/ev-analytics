import { db, type ChargingSession } from '../../../lib/db';

/**
 * Saves a charging session to the local database and creates a sync outbox entry.
 * Wrapped in a transaction to ensure atomicity.
 */
export async function saveSession(session: ChargingSession): Promise<void> {
  await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
    // 1. Save the session locally
    await db.sessions.put(session);

    // 2. Create an outbox entry for the sync engine
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date()
    });
  });
}
