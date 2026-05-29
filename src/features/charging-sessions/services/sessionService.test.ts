import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EVAnalyticsDB, db as sharedDb, type ChargingPlan, type Provider, type ChargingSession, type AdHocPricingSnapshot } from '../../../infra/db'
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
    await sharedDb.sessions.clear()
    await sharedDb.sync_outbox.clear()
    vi.restoreAllMocks()
  })

  const mockProvider: Provider = {
    id: 'p1',
    user_id: 'u1',
    name: 'Ionity',
    created_at: new Date(),
    updated_at: new Date()
  };

  const mockChargingPlan: ChargingPlan = {
    id: 't1',
    user_id: 'u1',
    provider_id: 'p1',
    plan_name: 'Ionity Passport',
    valid_from: new Date(),
          valid_to: null,
    ac_price_per_kwh: 49,
    dc_price_per_kwh: 79 ,
    roaming_ac_price_per_kwh: 59,
    roaming_dc_price_per_kwh: 89 ,
    monthly_base_fee: 1199,
    session_fee: 0 ,
    created_at: new Date(),
    updated_at: new Date()
  };

  const adHocPricing: AdHocPricingSnapshot = {
    cpoName: 'Guest CPO',
    pricePerKwh: 55,
    pricePerSession: 199,
    otherFees: [{ label: 'Parking', amount: 50, notes: 'First hour' }]
  };

  function buildSessionFixture(overrides: Partial<ChargingSession> = {}): ChargingSession {
    return {
      id: 'session-fixture',
      user_id: 'user-456',
      session_timestamp: new Date('2024-01-01'),
      provider_id: 'provider-1',
      provider_name_snapshot: 'Tesla',
      charging_plan_id: 'tariff-1',
      charging_plan_name_snapshot: 'Supercharger',
      charging_type: 'DC',
      kwh_billed: 40,
      total_cost: 1800,
      pricing_source: 'chargingPlan',
      applied_price_per_kwh: 45,
      applied_ac_price_per_kwh: 45,
      applied_dc_price_per_kwh: 45,
      applied_roaming_ac_price_per_kwh: undefined,
      applied_roaming_dc_price_per_kwh: undefined,
      applied_monthly_base_fee: undefined,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    };
  }

  it('requires charging_plan_id/provider/plan when pricing_source is chargingPlan', () => {
    // Arrange: Use an AC charging session with decimal kWh input.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: undefined,
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      kwh_billed: 20.5, // kWh as decimal
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert: missing charging_plan_id and dependencies should fail loudly.
    expect(() => prepareSession(input)).toThrow('charging_plan_id is required for chargingPlan pricing');
    expect(() =>
      prepareSession({ ...input, charging_plan_id: 't1' })
    ).toThrow('Provider is required for chargingPlan pricing');
    expect(() =>
      prepareSession({ ...input, charging_plan_id: 't1' }, undefined, mockProvider)
    ).toThrow('Charging plan is required for chargingPlan pricing');
  });

  it('rejects non-positive kwh_billed values', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 0,
    };

    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).toThrow(
      'kwh_billed must be greater than 0'
    );
  });

  it('rejects negative kwh_added values', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 10,
      kwh_added: -0.1,
    };

    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).toThrow(
      'kwh_added must be null or greater than or equal to 0'
    );
  });

  it('rejects SoC where end is below start', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 10,
      start_soc_percentage: 70,
      end_soc_percentage: 60,
    };

    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).toThrow(
      'end_soc_percentage must be greater than or equal to start_soc_percentage'
    );
  });

  it('requires plan_selection_id for plan mode sessions', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date('2026-05-28T00:00:00Z'),
      provider_id: 'p1',
      tariff_plan_id: 'tp1',
      session_mode: 'plan' as const,
      pricing_context: 'standard' as const,
      charging_type: 'AC' as const,
      kwh_billed: 10,
    } as unknown as Parameters<typeof prepareSession>[0];

    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).toThrow(
      'plan_selection_id is required for plan mode'
    );
  });

  it('forbids tariff_plan_id and plan_selection_id for adHoc mode', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date('2026-05-28T00:00:00Z'),
      provider_id: 'p1',
      session_mode: 'adHoc' as const,
      tariff_plan_id: 'tp1',
      plan_selection_id: 'ps1',
      charging_type: 'AC' as const,
      kwh_billed: 10,
      price_snapshot: { label: 'Ad-Hoc', kWhPrice: 59 },
    } as unknown as Parameters<typeof prepareSession>[0];

    expect(() => prepareSession(input)).toThrow(
      'tariff_plan_id and plan_selection_id are forbidden for adHoc mode'
    );
  });

  it('calculates chargingPlan domestic AC total and snapshots', () => {
    // Arrange: domestic AC charging with no fixed session fee.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 20.5
    };

    // Act: Prepare using selected charging plan and provider.
    const session = prepareSession(input, mockChargingPlan, mockProvider);

    // Assert: AC domestic price and snapshots are stable.
    expect(session.applied_price_per_kwh).toBe(49);
    expect(session.applied_ac_price_per_kwh).toBe(49);
    expect(session.applied_dc_price_per_kwh).toBe(79);
    expect(session.applied_roaming_ac_price_per_kwh).toBe(59);
    expect(session.applied_roaming_dc_price_per_kwh).toBe(89);
    expect(session.applied_monthly_base_fee).toBe(1199);
    expect(session.applied_session_fee).toBe(0);
    expect(session.total_cost).toBe(1005);
    expect(session.provider_name_snapshot).toBe('Ionity');
    expect(session.charging_plan_name_snapshot).toBe('Ionity Passport');
    expect(session.pricing_source).toBe('chargingPlan');
  });

  it('calculates chargingPlan roaming DC total and includes session_fee', () => {
    // Arrange: Use a DC tariff with a fixed session fee.
    const tariffWithFee: ChargingPlan = {
      ...mockChargingPlan,
      session_fee: 150 // 1.50 EUR
    };

    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'DC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'roaming' as const,
      kwh_billed: 40.0,
    };

    // Act: Prepare the session with DC charging selected.
    const session = prepareSession(input, tariffWithFee, mockProvider);

    // Assert: DC pricing includes both energy cost and fixed session fee.
    expect(session.applied_price_per_kwh).toBe(89);
    expect(session.applied_dc_price_per_kwh).toBe(79);
    expect(session.applied_roaming_dc_price_per_kwh).toBe(89);
    expect(session.applied_session_fee).toBe(150);
    expect(session.pricing_source).toBe('chargingPlan');
    expect(session.total_cost).toBe(3710);
  });

  it('should throw when selected pricing context has no matching price', () => {
    // Arrange: Remove roaming DC price and request roaming DC calculation.
    const planMissingRoamingDc: ChargingPlan = {
      ...mockChargingPlan,
      roaming_dc_price_per_kwh: undefined
    };

    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'DC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'roaming' as const,
      kwh_billed: 12
    };

    // Act/Assert: Missing context-specific pricing should fail loudly.
    expect(() => prepareSession(input, planMissingRoamingDc, mockProvider)).toThrow(
      'No matching roaming DC price for selected charging plan'
    );
  });

  it('requires ad_hoc_pricing when pricing_source is adHoc', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: null,
      charging_type: 'AC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 10
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert: ad-hoc pricing snapshot is mandatory.
    expect(() => prepareSession(input)).toThrow('ad_hoc_pricing is required for adHoc pricing');
  });

  it('calculates adHoc totals from supported components without saved plan', () => {
    // Arrange: Ad-hoc pricing with energy, session, and additional fees.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: null,
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 10,
      ad_hoc_pricing: adHocPricing
    };

    // Act: Prepare session using only ad-hoc snapshot input.
    const session = prepareSession(input);

    // Assert: 10*55 + 199 + 50 = 799 cents.
    expect(session.total_cost).toBe(799);
    expect(session.applied_price_per_kwh).toBe(55);
    expect(session.provider_name_snapshot).toBe('Guest CPO');
    expect(session.provider_id).toBe('p1');
    expect(session.charging_plan_id).toBeNull();
    expect(session.charging_plan_name_snapshot).toBe('Ad-Hoc');
    expect(session.pricing_source).toBe('adHoc');
    expect(session.ad_hoc_pricing).toEqual(adHocPricing);
    expect(Number.isInteger(session.total_cost)).toBe(true);
  });

  it('keeps snapshots stable by cloning ad-hoc input', () => {
    // Arrange: Prepare ad-hoc session then mutate original input.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: null,
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 3,
      ad_hoc_pricing: { ...adHocPricing, otherFees: [...(adHocPricing.otherFees ?? [])] }
    };

    // Act: build session, then mutate source snapshot object.
    const session = prepareSession(input);
    input.ad_hoc_pricing.otherFees?.push({ label: 'Late fee', amount: 400, notes: 'Mutated later' });

    // Assert: stored snapshot does not change after caller mutation.
    expect(session.ad_hoc_pricing?.otherFees).toHaveLength(1);
    expect(session.total_cost).toBe(414);
  });

  it('rejects charging_plan_id on adHoc sessions', () => {
    // Arrange: pass charging_plan_id alongside ad-hoc pricing.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 'should-not-persist',
      charging_type: 'AC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 1,
      ad_hoc_pricing: adHocPricing
    };

    // Act/Assert
    expect(() => prepareSession(input)).toThrow('charging_plan_id must be null for adHoc pricing');
  });

  it('ignores ad_hoc_pricing on chargingPlan sessions', () => {
    // Arrange: include ad_hoc_pricing even though pricing_source is chargingPlan.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 2,
      ad_hoc_pricing: adHocPricing
    };

    // Act
    const session = prepareSession(input, mockChargingPlan, mockProvider);

    // Assert
    expect(session.ad_hoc_pricing).toBeUndefined();
  });

  it('throws when adHoc monetary components are non-integer cents', () => {
    // Arrange: non-integer pricePerMinute should fail validation.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: null,
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 4,
      ad_hoc_pricing: {
        ...adHocPricing,
        pricePerMinute: 1.5
      }
    };

    // Act/Assert
    expect(() => prepareSession(input)).toThrow('ad_hoc_pricing.pricePerMinute must be an integer cent amount');
  });

  it('throws when adHoc pricePerMinute is provided', () => {
    // Arrange
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: null,
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 4,
      ad_hoc_pricing: {
        ...adHocPricing,
        pricePerMinute: 3
      }
    };

    // Act/Assert
    expect(() => prepareSession(input)).toThrow(
      'ad_hoc_pricing.pricePerMinute is not currently supported without a billed-duration field'
    );
  });

  it('requires ad_hoc_pricing.cpoName when pricing_source is adHoc', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: null,
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 4,
      ad_hoc_pricing: {
        ...adHocPricing,
        cpoName: '   '
      }
    };

    expect(() => prepareSession(input)).toThrow('ad_hoc_pricing.cpoName is required for adHoc pricing');
  });

  it('requires provider_id when pricing_source is adHoc', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: '',
      charging_plan_id: null,
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 4,
      ad_hoc_pricing: adHocPricing
    };

    expect(() => prepareSession(input)).toThrow('provider_id is required for adHoc pricing');
  });

  it('requires charging_plan_id to be null when pricing_source is adHoc', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 'cp1',
      charging_type: 'DC' as const,
      pricing_source: 'adHoc' as const,
      kwh_billed: 4,
      ad_hoc_pricing: adHocPricing
    };

    expect(() => prepareSession(input)).toThrow('charging_plan_id must be null for adHoc pricing');
  });

  it('throws when charging-plan snapped cents are non-integer', () => {
    // Arrange
    const nonIntegerPlan: ChargingPlan = {
      ...mockChargingPlan,
      ac_price_per_kwh: 49.5
    };
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      charging_plan_id: 't1',
      charging_type: 'AC' as const,
      pricing_source: 'chargingPlan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 2
    };

    // Act/Assert
    expect(() => prepareSession(input, nonIntegerPlan, mockProvider)).toThrow(
      'chargingPlan.ac_price_per_kwh must be an integer cent amount'
    );
  });

  it('should atomically save a session and create an outbox entry', async () => {
    // Arrange: Create a complete session ready for local persistence.
    const sessionData = buildSessionFixture({ id: 'session-123' })

    // Act: Save the session through the service transaction.
    await saveSession(sessionData)

    // Assert: The local session and matching outbox item are both committed.
    const session = await db.sessions.get('session-123')
    expect(session).toBeDefined()
    expect(session?.provider_name_snapshot).toBe('Tesla')

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

  it('rolls back saveSession when outbox add fails', async () => {
    // Arrange: force outbox write failure inside saveSession transaction.
    const sessionData = buildSessionFixture({ id: 'session-rollback' })
    const outboxSpy = vi.spyOn(sharedDb.sync_outbox, 'add').mockRejectedValueOnce(new Error('Outbox failed'))

    // Act/Assert
    await expect(saveSession(sessionData)).rejects.toThrow('Outbox failed');
    outboxSpy.mockRestore();

    // Assert: Dexie should roll back the session write.
    const session = await sharedDb.sessions.get('session-rollback');
    expect(session).toBeUndefined();
  })

  it('should fetch sessions ordered by timestamp desc', async () => {
    // Arrange: Seed two sessions with different timestamps.
    const s1 = buildSessionFixture({
      id: 's1',
      session_timestamp: new Date('2024-01-01'),
      provider_name_snapshot: 'P1',
      charging_plan_name_snapshot: 'T1',
      total_cost: 100,
      charging_type: 'AC',
      kwh_billed: 10,
      applied_price_per_kwh: 10,
      applied_ac_price_per_kwh: 10,
      applied_dc_price_per_kwh: 10
    });
    const s2 = buildSessionFixture({ ...s1, id: 's2', session_timestamp: new Date('2024-01-02') });

    await db.sessions.bulkAdd([s1, s2]);

    // Act: Fetch active sessions through the service.
    const sessions = await (await import('./sessionService')).getSessions();
    // Assert: Newer sessions should appear first.
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('s2');
    expect(sessions[1].id).toBe('s1');
  });
})
