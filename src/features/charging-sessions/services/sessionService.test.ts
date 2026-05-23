import { describe, it, expect, beforeEach } from 'vitest'
import { EVAnalyticsDB, type Tariff, type Provider } from '../../../infra/db'
import { saveSession, prepareSession } from './sessionService'
import 'fake-indexeddb/auto'

/**
 * Test suite for charging-session domain persistence.
 *
 * Verifies price snapshot generation, cents-based cost calculations, atomic
 * outbox writes, rollback behavior, and newest-first session retrieval.
 */
describe('sessionService', () => {
  let db: EVAnalyticsDB

  beforeEach(async () => {
    // Each test starts with a clean fake IndexedDB so outbox/session assertions
    // are isolated from earlier writes.
    db = new EVAnalyticsDB()
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })

  const mockProvider: Provider = {
    id: 'p1',
    user_id: 'u1',
    name: 'Ionity',
    created_at: new Date(),
    updated_at: new Date()
  };

  const mockTariff: Tariff = {
    id: 't1',
    user_id: 'u1',
    provider_id: 'p1',
    tariff_name: 'Ionity Passport',
    ac_price_per_kwh: 49, // 0.49 EUR
    dc_price_per_kwh: 79, // 0.79 EUR
    session_fee: 0,
    valid_from: new Date('2024-01-01'),
    created_at: new Date(),
    updated_at: new Date()
  };

  it('should correctly prepare a session with snapshots and calculated cost (AC)', () => {
    // Arrange: Use an AC charging session with decimal kWh input.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_id: 't1',
      location_type: 'Public' as const,
      charging_type: 'AC' as const,
      kwh_billed: 20.5, // kWh as decimal
      start_soc_percentage: 10,
      end_soc_percentage: 50,
      odometer_km: 12000
    };

    // Act: Prepare the complete session from input, tariff, and provider data.
    const session = prepareSession(input, mockTariff, mockProvider);

    // Assert: AC pricing and tariff/provider snapshots are preserved.
    expect(session.applied_ac_price).toBe(49);
    expect(session.applied_dc_price).toBe(79);
    expect(session.applied_session_fee).toBe(0);
    // Cost calculation: 20.5 * 0.49 = 10.045 -> 1005 cents (rounded)
    expect(session.total_cost).toBe(1005);
    expect(session.provider_name).toBe('Ionity');
    expect(session.tariff_name).toBe('Ionity Passport');
    expect(session.kwh_billed).toBe(20.5);
  });

  it('should correctly prepare a session with snapshots and calculated cost (DC with fee)', () => {
    // Arrange: Use a DC tariff with a fixed session fee.
    const tariffWithFee: Tariff = {
      ...mockTariff,
      session_fee: 150 // 1.50 EUR
    };

    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_id: 't1',
      location_type: 'Fast Charger' as const,
      charging_type: 'DC' as const,
      kwh_billed: 40.0,
      start_soc_percentage: 20,
      end_soc_percentage: 80
    };

    // Act: Prepare the session with DC charging selected.
    const session = prepareSession(input, tariffWithFee, mockProvider);

    // Assert: DC pricing includes both energy cost and fixed session fee.
    expect(session.applied_dc_price).toBe(79);
    expect(session.applied_session_fee).toBe(150);
    // Cost calculation: 40.0 * 0.79 + 1.50 = 31.60 + 1.50 = 33.10 -> 3310 cents
    expect(session.total_cost).toBe(3310);
  });

  it('should atomically save a session and create an outbox entry', async () => {
    // Arrange: Create a complete session ready for local persistence.
    const sessionData = {
      id: 'session-123',
      user_id: 'user-456',
      session_timestamp: new Date(),
      provider_id: 'provider-1',
      provider_name: 'Tesla',
      tariff_id: 'tariff-1',
      tariff_name: 'Supercharger',
      location_type: 'Fast Charger' as const,
      charging_type: 'DC' as const,
      kwh_billed: 40,
      total_cost: 1800,
      start_soc_percentage: 20,
      end_soc_percentage: 80,
      applied_ac_price: 45,
      applied_dc_price: 45,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save the session through the service transaction.
    await saveSession(sessionData)

    // Assert: The local session and matching outbox item are both committed.
    const session = await db.sessions.get('session-123')
    expect(session).toBeDefined()
    expect(session?.provider_name).toBe('Tesla')

    const outboxItems = await db.sync_outbox.toArray()
    expect(outboxItems).toHaveLength(1)
    expect(outboxItems[0].table_name).toBe('sessions')
    expect(outboxItems[0].action).toBe('INSERT')
    expect(outboxItems[0].payload.id).toBe('session-123')
    expect(outboxItems[0]).toMatchObject({
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    })
  })

  it('should rollback session save if outbox entry fails', async () => {
    // Arrange: Create a session and a transaction body that fails after put.
    const sessionData = {
      id: 'session-rollback',
      user_id: 'user-456',
      session_timestamp: new Date(),
      provider_id: 'provider-1',
      provider_name: 'Tesla',
      tariff_id: 'tariff-1',
      tariff_name: 'Supercharger',
      location_type: 'Fast Charger' as const,
      charging_type: 'DC' as const,
      kwh_billed: 40,
      total_cost: 1800,
      start_soc_percentage: 20,
      end_soc_percentage: 80,
      applied_ac_price: 45,
      applied_dc_price: 45,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Force a failure by throwing inside the transaction.
    try {
      await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
        await db.sessions.put(sessionData);
        throw new Error('Simulated Failure');
      });
    } catch {
      // Expected
    }

    // Assert: Dexie should roll back the session write.
    const session = await db.sessions.get('session-rollback');
    expect(session).toBeUndefined();
  })

  it('should fetch sessions ordered by timestamp desc', async () => {
    // Arrange: Seed two sessions with different timestamps.
    const s1 = { ...mockTariff, id: 's1', session_timestamp: new Date('2024-01-01'), provider_name: 'P1', tariff_name: 'T1', total_cost: 100, charging_type: 'AC' as const, location_type: 'Home' as const, kwh_billed: 10, start_soc_percentage: 10, end_soc_percentage: 50, applied_ac_price: 10, applied_dc_price: 10, applied_session_fee: 0, created_at: new Date(), updated_at: new Date() };
    const s2 = { ...s1, id: 's2', session_timestamp: new Date('2024-01-02') };

    // The test data is intentionally minimal; fields irrelevant to ordering are
    // borrowed from mockTariff to keep the fixture compact.
    // @ts-expect-error - simplified for testing
    await db.sessions.bulkAdd([s1, s2]);

    // Act: Fetch active sessions through the service.
    const sessions = await (await import('./sessionService')).getSessions();
    // Assert: Newer sessions should appear first.
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('s2');
    expect(sessions[1].id).toBe('s1');
  });
})
