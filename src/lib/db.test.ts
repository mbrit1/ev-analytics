import { describe, it, expect, beforeEach } from 'vitest'
import { EVAnalyticsDB, type ChargingSession } from './db'
import 'fake-indexeddb/auto'

/**
 * Test suite for the Dexie schema wrapper.
 *
 * Verifies that the offline-first database can be instantiated, exposes the
 * required stores, and supports the charging-session records used by the app.
 */
describe('EVAnalyticsDB', () => {
  let db: EVAnalyticsDB

  beforeEach(() => {
    // Arrange: Create a fresh database wrapper for each schema assertion.
    db = new EVAnalyticsDB()
  })

  it('should instantiate the database', () => {
    // Assert: The Dexie database wrapper should be constructed successfully.
    expect(db).toBeDefined()
  })

  it('should have the required tables', () => {
    // Assert: All offline-first domain stores and the sync outbox are present.
    expect(db.providers).toBeDefined()
    expect(db.tariffs).toBeDefined()
    expect(db.sessions).toBeDefined()
    expect(db.sync_outbox).toBeDefined()
  })

  it('should perform basic CRUD on sessions', async () => {
    // Arrange: Build a complete charging session with tariff snapshots.
    const session: ChargingSession = {
      id: 'test-session-1',
      user_id: 'user-123',
      session_timestamp: new Date(),
      provider_id: 'provider-1',
      provider_name: 'Ionity',
      tariff_id: 'tariff-1',
      tariff_name: 'Ionity Direct',
      location_type: 'Fast Charger',
      charging_type: 'DC',
      kwh_billed: 50.5,
      total_cost: 3989, // 50.5 * 79
      start_soc_percentage: 10,
      end_soc_percentage: 80,
      applied_ac_price: 79,
      applied_dc_price: 79,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Persist the session locally and read it back by id.
    await db.sessions.add(session)
    const retrieved = await db.sessions.get('test-session-1')

    // Assert: Stored session fields should round-trip through IndexedDB.
    expect(retrieved).toBeDefined()
    expect(retrieved?.provider_name).toBe('Ionity')
    expect(retrieved?.total_cost).toBe(3989)
    expect(retrieved?.start_soc_percentage).toBe(10)
  })
})
