import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest'
import { EVAnalyticsDB, type ChargingSession, type SyncOutboxEntry } from './db'
import Dexie, { type Table } from 'dexie'
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

  it('should clear legacy tariff stores when upgrading to v4', async () => {
    // Arrange: Seed a v3-shaped database with obsolete tariff/fixed-cost rows.
    const legacyDbName = 'EVAnalyticsDB-v3-migration-test'
    class LegacyDB extends Dexie {
      tariffs!: Table<Record<string, unknown>>
      fixed_tariff_costs!: Table<Record<string, unknown>>
      sessions!: Table<Record<string, unknown>>
      sync_outbox!: Table<Record<string, unknown>>

      constructor() {
        super(legacyDbName)
        this.version(3).stores({
          providers: 'id, user_id, name, deleted_at',
          tariffs: 'id, user_id, provider_id, tariff_name, tariff_kind, valid_from, valid_to, deleted_at',
          sessions: 'id, user_id, session_timestamp, provider_id, tariff_id, pricing_context, charging_type, deleted_at',
          fixed_tariff_costs: 'id, user_id, cost_date, provider_id, tariff_id, cost_type, deleted_at',
          sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
        })
      }
    }

    const legacy = new LegacyDB()
    await legacy.open()
    await legacy.table('tariffs').add({
      id: 'legacy-tariff-1',
      user_id: 'user-123',
      provider_id: 'provider-1',
      tariff_name: 'Legacy Tariff',
      ac_price_per_kwh: 49,
      dc_price_per_kwh: 79,
      session_fee: 0,
      valid_from: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    })
    await legacy.table('fixed_tariff_costs').add({
      id: 'legacy-fixed-1',
      user_id: 'user-123',
      cost_date: new Date(),
      provider_id: 'provider-1',
      amount: 1199,
      cost_type: 'subscription',
      created_at: new Date(),
      updated_at: new Date()
    })
    await legacy.table('sessions').add({
      id: 'legacy-session-1',
      user_id: 'user-123',
      session_timestamp: new Date(),
      provider_id: 'provider-1',
      provider_name: 'Ionity',
      tariff_id: 'legacy-tariff-1',
      tariff_name: 'Legacy Tariff',
      charging_type: 'DC',
      kwh_billed: 10,
      total_cost: 790,
      pricing_context: 'roaming',
      applied_roaming_dc_price_per_kwh: 79,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })
    await legacy.table('sync_outbox').bulkAdd([
      {
        table_name: 'tariffs',
        action: 'INSERT',
        payload: { id: 'legacy-tariff-1' },
        timestamp: new Date('2026-05-21T09:00:00.000Z')
      },
      {
        table_name: 'fixed_tariff_costs',
        action: 'UPDATE',
        payload: { id: 'legacy-fixed-1' },
        timestamp: new Date('2026-05-21T09:01:00.000Z')
      },
      {
        table_name: 'sessions',
        action: 'INSERT',
        payload: { id: 'legacy-session-queued' },
        timestamp: new Date('2026-05-21T09:02:00.000Z')
      }
    ])
    await legacy.close()

    const migrated = new EVAnalyticsDB(legacyDbName)

    // Act: Open v4 schema and read migrated records.
    await migrated.open()
    const planCount = await migrated.charging_plans.count()
    const session = await migrated.sessions.get('legacy-session-1')
    const remainingOutboxTables = (await migrated.sync_outbox.toArray()).map((entry) => entry.table_name)

    // Assert: Obsolete stores are dropped, obsolete outbox rows are purged,
    // and non-obsolete session data remains.
    expect(planCount).toBe(0)
    expect(remainingOutboxTables).toEqual(['sessions'])
    expect(session).toBeDefined()
    await migrated.delete()
  })

  it('should instantiate the database', () => {
    // Assert: The Dexie database wrapper should be constructed successfully.
    expect(db).toBeDefined()
  })

  it('should have the required tables', () => {
    // Assert: All offline-first domain stores and the sync outbox are present.
    expect(db.providers).toBeDefined()
    expect(db.charging_plans).toBeDefined()
    expect(db.provider_plan_selections).toBeDefined()
    expect(db.sessions).toBeDefined()
    expect(db.sync_outbox).toBeDefined()
  })

  it('should include charging_plans in outbox table names', () => {
    // Assert: Outbox union includes charging-plan mutations for sync replay.
    expectTypeOf<SyncOutboxEntry['table_name']>().toEqualTypeOf<
      'providers' | 'charging_plans' | 'provider_plan_selections' | 'sessions'
    >()
  })

  it('should perform basic CRUD on sessions', async () => {
    // Arrange: Build a complete charging session with charging-plan snapshots.
    const session: ChargingSession = {
      id: 'test-session-1',
      user_id: 'user-123',
      session_timestamp: new Date(),
      provider_id: 'provider-1',
      provider_name: 'Ionity',
      charging_plan_id: 'plan-1',
      charging_plan_name: 'Ionity Direct',
      charging_type: 'DC',
      kwh_billed: 50.5,
      total_cost: 3989, // 50.5 * 79
      pricing_source: 'chargingPlan',
      applied_dc_price_per_kwh: 79,
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
    expect(retrieved?.start_soc_percentage).toBeUndefined()
    expect(retrieved?.end_soc_percentage).toBeUndefined()
  })
})
