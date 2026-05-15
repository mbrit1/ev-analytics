import { db, type ChargingSession, type Tariff, type Provider } from '../../../lib/db';

/**
 * Prepares a complete ChargingSession object from user input and associated data.
 * Handles snapshotting and cost calculation.
 */
export function prepareSession(
  input: Omit<ChargingSession, 'id' | 'provider_name' | 'tariff_name' | 'total_cost' | 'applied_ac_price' | 'applied_dc_price' | 'applied_session_fee' | 'created_at' | 'updated_at'>,
  tariff: Tariff,
  provider: Provider
): ChargingSession {
  const appliedPrice = input.charging_type === 'AC' ? tariff.ac_price_per_kwh : tariff.dc_price_per_kwh;
  
  // total_cost in cents. kwh_billed is a float.
  // (kwh * cents) + fee_cents
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

/**
 * Fetches all charging sessions from the local database, ordered by timestamp descending.
 */
export async function getSessions(): Promise<ChargingSession[]> {
  return db.sessions
    .filter(s => !s.deleted_at)
    .reverse()
    .sortBy('session_timestamp');
}
