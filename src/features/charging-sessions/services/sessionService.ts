import { db, type ChargingSession, type Tariff, type Provider } from '../../../infra/db';

/**
 * Prepares a complete ChargingSession object from user input and associated data.
 *
 * The session stores provider/tariff names and applied prices as snapshots so
 * historic charging costs remain stable even if the related tariff changes
 * later. Monetary values are stored as integer cents.
 *
 * @param input - User-entered charging session data without generated fields.
 * @param tariff - Tariff used to calculate and snapshot the session price.
 * @param provider - Provider used to snapshot the display name.
 * @returns A complete charging session ready to persist locally.
 */
export function prepareSession(
  input: Omit<ChargingSession, 'id' | 'provider_name' | 'tariff_name' | 'total_cost' | 'applied_ac_price' | 'applied_dc_price' | 'applied_session_fee' | 'created_at' | 'updated_at'>,
  tariff: Tariff,
  provider: Provider
): ChargingSession {
  const appliedPrice = input.charging_type === 'AC' ? tariff.ac_price_per_kwh : tariff.dc_price_per_kwh;
  
  // kWh is decimal input, while tariff prices and fees are integer cents.
  const totalCost = Math.round(input.kwh_billed * appliedPrice) + tariff.session_fee;

  return {
    ...input,
    id: crypto.randomUUID(),
    provider_name: provider.name,
    tariff_name: tariff.tariff_name,
    total_cost: totalCost,
    applied_ac_price: tariff.ac_price_per_kwh,
    applied_dc_price: tariff.dc_price_per_kwh,
    applied_session_fee: tariff.session_fee,
    created_at: new Date(),
    updated_at: new Date()
  };
}

/**
 * Saves a charging session to the local database and creates a sync outbox entry.
 *
 * The transaction keeps the local write and pending sync request atomic: either
 * both are committed, or neither is. That prevents a saved session from being
 * stranded without a corresponding sync entry.
 *
 * @param session - Fully prepared charging session to save and sync.
 */
export async function saveSession(session: ChargingSession): Promise<void> {
  await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
    // Save locally first so the UI can update immediately from IndexedDB.
    await db.sessions.put(session);

    // Queue the same payload for the sync engine to replay remotely later.
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: session,
      timestamp: new Date(),
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}

/**
 * Fetches all charging sessions from the local database, ordered by timestamp descending.
 *
 * Soft-deleted sessions are omitted so history views only show active records.
 *
 * @returns Active charging sessions sorted from newest to oldest.
 */
export async function getSessions(): Promise<ChargingSession[]> {
  return db.sessions
    .filter(s => !s.deleted_at)
    .reverse()
    .sortBy('session_timestamp');
}
