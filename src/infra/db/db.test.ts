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
      provider_name_snapshot: 'Ionity',
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

  it('closes an already-open v5 connection when the v6 runtime upgrades the database', async () => {
    // Arrange: Hold a legacy v5 connection open with an existing provider row.
    const dbName = 'EVAnalyticsDB-v5-versionchange-test'
    class V5Runtime extends Dexie {
      providers!: Table<Record<string, unknown>>

      constructor() {
        super(dbName)
        this.version(5).stores({
          providers: 'id, user_id, name, deleted_at',
          charging_plans: 'id, user_id, provider_id, name, deleted_at',
          provider_plan_selections: 'id, user_id, provider_id, tariff_plan_id, valid_from, valid_to, deleted_at',
          sessions: 'id, user_id, session_timestamp, provider_id, session_mode, tariff_plan_id, plan_selection_id, charging_type, deleted_at',
          sync_outbox: '++id, table_name, action, timestamp, next_attempt_at'
        })
      }
    }
    const legacy = new V5Runtime()
    let versionChangeReceived = false
    legacy.on('versionchange', () => {
      versionChangeReceived = true
    })
    await legacy.open()
    await legacy.providers.add({ id: 'provider-before-v6', user_id: 'user-1', name: 'Before upgrade' })

    // Act: Open the current runtime against the v5 database.
    const upgraded = new EVAnalyticsDB(dbName)
    await upgraded.open()

    // Assert: The version upgrade closes the connection that was already open.
    expect(upgraded.verno).toBe(6)
    expect(versionChangeReceived).toBe(true)
    expect(legacy.isOpen()).toBe(false)
    expect(await upgraded.providers.get('provider-before-v6')).toMatchObject({ name: 'Before upgrade' })
    await upgraded.delete()
  })

  it('persists local-only reconciliation evidence through database recreation', async () => {
    // Arrange: Open a fresh runtime and access the planned local evidence store.
    const dbName = 'EVAnalyticsDB-provider-reconciliations-test'
    const upgraded = new EVAnalyticsDB(dbName)
    await upgraded.open()
    const reconciliations = upgraded.provider_reconciliations

    // Act: Persist the evidence without creating any outbox mutation.
    expect(reconciliations).toBeDefined()
    await reconciliations.add({
      terminal_outbox_id: 41,
      user_id: 'user-1',
      staged_provider_id: 'staged-provider',
      canonical_provider_id: 'canonical-provider',
      affected_row_ids: { charging_plan_ids: ['plan-1'], selection_ids: [], session_ids: [] },
      affected_outbox_ids: [42],
      review_serialization: '{"review":"complete"}',
      completed_at: new Date('2026-08-23T09:00:00.000Z'),
    })
    await upgraded.close()

    const reopened = new EVAnalyticsDB(dbName)
    await reopened.open()
    const reopenedReconciliations = reopened.provider_reconciliations

    // Assert: The durable local record survives recreation and is absent from the outbox.
    expect(await reopenedReconciliations.where('terminal_outbox_id').equals(41).first()).toMatchObject({
      user_id: 'user-1',
      staged_provider_id: 'staged-provider',
      canonical_provider_id: 'canonical-provider',
      affected_outbox_ids: [42],
      review_serialization: '{"review":"complete"}',
    })
    expect(await reopened.sync_outbox.count()).toBe(0)
    await reopened.delete()
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
      provider_name_snapshot: 'Ionity',
      tariff_plan_id: 'plan-1',
      charging_plan_name_snapshot: 'Ionity Direct',
      charging_type: 'DC',
      kwh_billed: 50.5,
      total_cost: 3989, // 50.5 * 79
      session_mode: 'plan',
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
    expect(retrieved?.provider_name_snapshot).toBe('Ionity')
    expect(retrieved?.total_cost).toBe(3989)
    expect(retrieved?.start_soc_percentage).toBeUndefined()
    expect(retrieved?.end_soc_percentage).toBeUndefined()
  })

  it('should atomically round-trip an ad-hoc session and outbox payload with no provider link', async () => {
    // Arrange: Build the canonical local record for Cariqa billing at a TEAG charger.
    const now = new Date('2026-07-17T08:00:00.000Z')
    const session: Extract<ChargingSession, { session_mode: 'ad_hoc' }> = {
      id: 'ad-hoc-null-provider',
      user_id: 'user-123',
      session_timestamp: now,
      provider_id: null,
      provider_name_snapshot: 'Cariqa',
      tariff_plan_id: null,
      charging_plan_name_snapshot: null,
      charging_type: 'DC',
      kwh_billed: 20,
      total_cost: 1180,
      session_mode: 'ad_hoc',
      plan_selection_id: null,
      pricing_context: 'ad_hoc',
      ad_hoc_pricing: { cpoName: 'TEAG', pricePerKwh: 59 },
      applied_price_per_kwh: 59,
      applied_session_fee: 0,
      created_at: now,
      updated_at: now,
    }

    // Act: Persist the session and matching outbox entry in one local transaction.
    await db.transaction('rw', [db.sessions, db.sync_outbox], async () => {
      await db.sessions.put(session)
      await db.sync_outbox.add({
        table_name: 'sessions',
        action: 'INSERT',
        payload: session,
        timestamp: now,
      })
    })

    // Assert: IndexedDB preserves null linkage and both identity snapshots.
    const storedSession = await db.sessions.get(session.id)
    const [storedOutbox] = await db.sync_outbox.toArray()
    expect(storedSession).toMatchObject({
      provider_id: null,
      provider_name_snapshot: 'Cariqa',
      ad_hoc_pricing: { cpoName: 'TEAG' },
    })
    expect(storedOutbox.payload).toMatchObject({
      id: session.id,
      provider_id: null,
      provider_name_snapshot: 'Cariqa',
      ad_hoc_pricing: { cpoName: 'TEAG' },
    })
  })
})
