import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EVAnalyticsDB, db as sharedDb, type ChargingPlan, type Provider, type ChargingSession, type AdHocPricingSnapshot } from '../../../infra/db'
import { resolveEffectivePlanForDate } from '../../charging-plans'
import {
  hasPlanPricingIdentityChanged,
  prepareSession,
  prepareSessionEdit,
  saveSession,
  saveSessionWithPlanSelection,
  type SessionPersistenceRequest,
  updateSession,
  updateSessionWithPlanSelection,
} from './sessionService'
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
    await db.provider_plan_selections.clear()
    await db.sync_outbox.clear()
    await sharedDb.sessions.clear()
    await sharedDb.provider_plan_selections.clear()
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
    name: 'Ionity Passport',
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

  const ad_hocPricing: AdHocPricingSnapshot = {
    cpoName: 'Guest CPO',
    pricePerKwh: 55,
    pricePerSession: 199,
    otherFees: [{ label: 'Parking', amount: 50, notes: 'First hour' }]
  };

  const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

  function buildVersionFixture(overrides: Partial<ChargingPlan> = {}): ChargingPlan {
    return {
      ...mockChargingPlan,
      id: 'version-fixture',
      name: 'Versioned Plan',
      valid_from: utc('2026-01-01'),
      valid_to: null,
      created_at: utc('2026-01-01'),
      updated_at: utc('2026-01-01'),
      ...overrides,
    };
  }

  function buildPromotionChain(): ChargingPlan[] {
    return [
      buildVersionFixture({
        id: 'baseline',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-08-10'),
      }),
      buildVersionFixture({
        id: 'promo',
        valid_from: utc('2026-08-10'),
        valid_to: utc('2026-09-01'),
        ac_price_per_kwh: 39,
        dc_price_per_kwh: 49,
        roaming_ac_price_per_kwh: 59,
        roaming_dc_price_per_kwh: 69,
        monthly_base_fee: 199,
      }),
      buildVersionFixture({
        id: 'restore',
        valid_from: utc('2026-09-01'),
        valid_to: null,
      }),
    ];
  }

  type SessionOverrides =
    | Partial<Extract<ChargingSession, { session_mode: 'plan' }>>
    | Partial<Extract<ChargingSession, { session_mode: 'ad_hoc' }>>;

  function buildSessionFixture(overrides: SessionOverrides = {}): ChargingSession {
    return {
      id: 'session-fixture',
      user_id: 'user-456',
      session_timestamp: new Date('2024-01-01'),
      provider_id: 'provider-1',
      provider_name_snapshot: 'Tesla',
      tariff_plan_id: 'tariff-1',
      charging_plan_name_snapshot: 'Supercharger',
      charging_type: 'DC',
      kwh_billed: 40,
      total_cost: 1800,
      session_mode: 'plan',
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
    } as unknown as ChargingSession;
  }

  it('requires tariff_plan_id/provider/plan when session_mode is plan', () => {
    // Arrange: Use an AC charging session with decimal kWh input.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_plan_id: undefined,
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
      kwh_billed: 20.5, // kWh as decimal
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert: missing tariff_plan_id and dependencies should fail loudly.
    expect(() => prepareSession(input)).toThrow('tariff_plan_id is required for plan pricing');
    expect(() =>
      prepareSession({ ...input, tariff_plan_id: 't1' })
    ).toThrow('Provider is required for plan pricing');
    expect(() =>
      prepareSession({ ...input, tariff_plan_id: 't1' }, undefined, mockProvider)
    ).toThrow('Charging plan is required for plan pricing');
  });

  it('rejects non-positive kwh_billed values', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
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
      tariff_plan_id: 't1',
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
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
      tariff_plan_id: 't1',
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 10,
      start_soc_percentage: 70,
      end_soc_percentage: 60,
    };

    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).toThrow(
      'end_soc_percentage must be greater than or equal to start_soc_percentage'
    );
  });

  it('does not require plan_selection_id for plan mode sessions', () => {
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

    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).not.toThrow();
  });

  it('resolves baseline, promotion, and restoration on their effective dates', () => {
    // Arrange: build a baseline -> promo -> restore version chain.
    const versions = buildPromotionChain();

    // Act/Assert: the shared resolver switches on the exact effective dates.
    expect(resolveEffectivePlanForDate(versions, utc('2026-08-09'))?.id).toBe('baseline');
    expect(resolveEffectivePlanForDate(versions, utc('2026-08-10'))?.id).toBe('promo');
    expect(resolveEffectivePlanForDate(versions, utc('2026-08-31'))?.id).toBe('promo');
    expect(resolveEffectivePlanForDate(versions, utc('2026-09-01'))?.id).toBe('restore');
  });

  it('forbids tariff_plan_id and plan_selection_id for ad_hoc mode', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date('2026-05-28T00:00:00Z'),
      session_mode: 'ad_hoc' as const,
      tariff_plan_id: 'tp1',
      plan_selection_id: 'ps1',
      charging_type: 'AC' as const,
      kwh_billed: 10,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      price_snapshot: { label: 'Ad-Hoc', kWhPrice: 59 },
    } as unknown as Parameters<typeof prepareSession>[0];

    expect(() => prepareSession(input)).toThrow(
      'tariff_plan_id must be null for ad_hoc pricing'
    );
  });

  it('calculates plan domestic AC total and snapshots', () => {
    // Arrange: domestic AC charging with no fixed session fee.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
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
    expect(session.session_mode).toBe('plan');
  });

  it('calculates plan roaming DC total and includes session_fee', () => {
    // Arrange: Use a DC tariff with a fixed session fee.
    const tariffWithFee: ChargingPlan = {
      ...mockChargingPlan,
      session_fee: 150 // 1.50 EUR
    };

    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      charging_type: 'DC' as const,
      session_mode: 'plan' as const,
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
    expect(session.session_mode).toBe('plan');
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
      tariff_plan_id: 't1',
      charging_type: 'DC' as const,
      session_mode: 'plan' as const,
      pricing_context: 'roaming' as const,
      kwh_billed: 12
    };

    // Act/Assert: Missing context-specific pricing should fail loudly.
    expect(() => prepareSession(input, planMissingRoamingDc, mockProvider)).toThrow(
      'No matching roaming DC price for selected charging plan'
    );
  });

  it('requires ad_hoc_pricing when session_mode is ad_hoc', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'AC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 10,
      billing_provider_name: 'Cariqa',
      cpo_name: null,
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert: ad-hoc pricing snapshot is mandatory.
    expect(() => prepareSession(input)).toThrow('ad_hoc_pricing is required for ad_hoc pricing');
  });

  it('calculates ad_hoc totals from supported components without saved plan', () => {
    // Arrange: Cariqa bills the session while TEAG operates the charger.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 10,
      billing_provider_name: '  Cariqa  ',
      cpo_name: '  TEAG  ',
      ad_hoc_pricing: {
        pricePerKwh: 55,
        pricePerSession: 199,
        otherFees: [{ label: 'Parking', amount: 50, notes: 'First hour' }]
      }
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act: Prepare session using only ad-hoc snapshot input.
    const session = prepareSession(input);

    // Assert: 10*55 + 199 + 50 = 799 cents.
    expect(session.total_cost).toBe(799);
    expect(session.applied_price_per_kwh).toBe(55);
    expect(session.provider_name_snapshot).toBe('Cariqa');
    expect(session.provider_id).toBeNull();
    expect(session.tariff_plan_id).toBeNull();
    expect(session.charging_plan_name_snapshot).toBe('Ad-Hoc');
    expect(session.session_mode).toBe('ad_hoc');
    expect(session.ad_hoc_pricing).toEqual({
      cpoName: 'TEAG',
      pricePerKwh: 55,
      pricePerSession: 199,
      otherFees: [{ label: 'Parking', amount: 50, notes: 'First hour' }]
    });
    expect(Number.isInteger(session.total_cost)).toBe(true);
  });

  it('keeps snapshots stable by cloning ad-hoc input', () => {
    // Arrange: Prepare ad-hoc session then mutate original input.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 3,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      ad_hoc_pricing: { ...ad_hocPricing, otherFees: [...(ad_hocPricing.otherFees ?? [])] }
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act: build session, then mutate source snapshot object.
    const session = prepareSession(input);
    input.ad_hoc_pricing?.otherFees?.push({ label: 'Late fee', amount: 400, notes: 'Mutated later' });

    // Assert: stored snapshot does not change after caller mutation.
    expect(session.ad_hoc_pricing?.otherFees).toHaveLength(1);
    expect(session.total_cost).toBe(414);
  });

  it('rejects tariff_plan_id on ad_hoc sessions', () => {
    // Arrange: pass tariff_plan_id alongside ad-hoc pricing.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: 'should-not-persist',
      plan_selection_id: null,
      charging_type: 'AC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 1,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      ad_hoc_pricing: { pricePerKwh: 55 }
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert
    expect(() => prepareSession(input)).toThrow('tariff_plan_id must be null for ad_hoc pricing');
  });

  it('rejects ad_hoc_pricing on plan sessions', () => {
    // Arrange: include ad_hoc_pricing even though session_mode is plan.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_plan_id: 't1',
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 2,
      ad_hoc_pricing: ad_hocPricing
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert: invalid mode combinations are rejected at the boundary.
    expect(() => prepareSession(input, mockChargingPlan, mockProvider)).toThrow(
      'ad_hoc_pricing must be absent for plan pricing'
    );
  });

  it('throws when ad_hoc monetary components are non-integer cents', () => {
    // Arrange: non-integer pricePerMinute should fail validation.
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 4,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      ad_hoc_pricing: {
        ...ad_hocPricing,
        pricePerMinute: 1.5
      }
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert
    expect(() => prepareSession(input)).toThrow('ad_hoc_pricing.pricePerMinute must be an integer cent amount');
  });

  it('throws when ad_hoc pricePerMinute is provided', () => {
    // Arrange
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 4,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      ad_hoc_pricing: {
        ...ad_hocPricing,
        pricePerMinute: 3
      }
    } as unknown as Parameters<typeof prepareSession>[0];

    // Act/Assert
    expect(() => prepareSession(input)).toThrow(
      'ad_hoc_pricing.pricePerMinute is not currently supported without a billed-duration field'
    );
  });

  it('stores an unavailable CPO when the optional operator is blank', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 4,
      billing_provider_name: 'Cariqa',
      cpo_name: '   ',
      ad_hoc_pricing: {
        pricePerKwh: 55,
      }
    } as unknown as Parameters<typeof prepareSession>[0];

    const session = prepareSession(input);

    if (session.session_mode !== 'ad_hoc') {
      throw new Error('Expected an ad-hoc session');
    }
    expect(session.ad_hoc_pricing.cpoName).toBeNull();
  });

  it('rejects a blank billing provider for ad_hoc pricing', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 4,
      billing_provider_name: '   ',
      cpo_name: null,
      ad_hoc_pricing: { pricePerKwh: 55 }
    } as unknown as Parameters<typeof prepareSession>[0];

    expect(() => prepareSession(input)).toThrow('billing_provider_name is required for ad_hoc pricing');
  });

  it('rejects a saved provider relationship for ad_hoc pricing', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      provider_id: 'p1',
      tariff_plan_id: null,
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 4,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      ad_hoc_pricing: { pricePerKwh: 55 }
    } as unknown as Parameters<typeof prepareSession>[0];

    expect(() => prepareSession(input)).toThrow('provider_id must be null for ad_hoc pricing');
  });

  it('requires tariff_plan_id to be null when session_mode is ad_hoc', () => {
    const input = {
      user_id: 'u1',
      session_timestamp: new Date(),
      tariff_plan_id: 'cp1',
      plan_selection_id: null,
      charging_type: 'DC' as const,
      session_mode: 'ad_hoc' as const,
      kwh_billed: 4,
      billing_provider_name: 'Cariqa',
      cpo_name: 'TEAG',
      ad_hoc_pricing: { pricePerKwh: 55 }
    } as unknown as Parameters<typeof prepareSession>[0];

    expect(() => prepareSession(input)).toThrow('tariff_plan_id must be null for ad_hoc pricing');
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
      tariff_plan_id: 't1',
      charging_type: 'AC' as const,
      session_mode: 'plan' as const,
      pricing_context: 'standard' as const,
      kwh_billed: 2
    };

    // Act/Assert
    expect(() => prepareSession(input, nonIntegerPlan, mockProvider)).toThrow(
      'plan.ac_price_per_kwh must be an integer cent amount'
    );
  });

  it('preserves plan snapshots and selection when pricing identity is unchanged', () => {
    // Arrange: the current plan price differs from the historical session price.
    const original = buildSessionFixture({
      id: 'session-history',
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'selection-history',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'AC',
      pricing_context: 'standard',
      kwh_billed: 40,
      total_cost: 1800,
      applied_price_per_kwh: 40,
      applied_session_fee: 200,
      price_snapshot: { label: 'Historical plan', kWhPrice: 40, sessionFee: 200 },
      provider_name_snapshot: 'Historical Provider',
      charging_plan_name_snapshot: 'Historical Plan',
    });
    if (original.session_mode !== 'plan') {
      throw new Error('Expected a plan session fixture');
    }

    // Act: edit only billed energy and notes without supplying current plan data.
    const edited = prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      provider_id: original.provider_id,
      charging_type: original.charging_type,
      kwh_billed: 50,
      notes: 'Updated note',
      session_mode: 'plan',
      tariff_plan_id: original.tariff_plan_id!,
      plan_selection_id: original.plan_selection_id,
      price_snapshot: original.price_snapshot,
      pricing_context: original.pricing_context,
    });

    // Assert: history stays attached to the persisted pricing facts.
    expect(edited).toEqual(expect.objectContaining({
      id: original.id,
      created_at: original.created_at,
      plan_selection_id: 'selection-history',
      provider_name_snapshot: 'Historical Provider',
      charging_plan_name_snapshot: 'Historical Plan',
      price_snapshot: { label: 'Historical plan', kWhPrice: 40, sessionFee: 200 },
      applied_price_per_kwh: 40,
      applied_session_fee: 200,
      total_cost: 2200,
      notes: 'Updated note',
    }));
  });

  it('detects deliberate plan pricing identity changes', () => {
    // Arrange: start from a persisted standard AC plan session.
    const original = buildSessionFixture({
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'AC',
      pricing_context: 'standard',
      session_mode: 'plan',
    });

    // Act and Assert: usage-only edits are stable, while rate identity changes reprice.
    expect(hasPlanPricingIdentityChanged(original, {
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'AC',
      pricing_context: 'standard',
    })).toBe(false);
    expect(hasPlanPricingIdentityChanged(original, {
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'DC',
      pricing_context: 'standard',
    })).toBe(true);
  });

  it('recalculates plan snapshots after a deliberate pricing identity change', () => {
    // Arrange: change the existing session from plan-1 to the current plan fixture.
    const original = buildSessionFixture({
      id: 'session-reprice',
      provider_id: 'provider-old',
      tariff_plan_id: 'plan-old',
      plan_selection_id: 'selection-old',
      price_snapshot: { label: 'Old plan', kWhPrice: 40, sessionFee: 0 },
      created_at: new Date('2026-05-01T08:00:00.000Z'),
    });
    const currentProvider: Provider = {
      ...mockProvider,
      id: 'provider-new',
      name: 'Current Provider',
    };
    const currentPlan: ChargingPlan = {
      ...mockChargingPlan,
      id: 'plan-new',
      provider_id: 'provider-new',
      name: 'Current Plan',
      ac_price_per_kwh: 55,
      session_fee: 100,
    };

    // Act: prepare a deliberate provider/plan change with its new selection id.
    const edited = prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      provider_id: currentProvider.id,
      charging_type: 'AC',
      kwh_billed: 10,
      session_mode: 'plan',
      tariff_plan_id: currentPlan.id,
      plan_selection_id: 'selection-new',
      price_snapshot: { label: 'Stale caller snapshot', kWhPrice: 1, sessionFee: 999 },
      pricing_context: 'standard',
    }, currentPlan, currentProvider);

    // Assert: identity is stable but pricing history now reflects the deliberate choice.
    expect(edited).toEqual(expect.objectContaining({
      id: 'session-reprice',
      created_at: original.created_at,
      provider_id: 'provider-new',
      tariff_plan_id: 'plan-new',
      plan_selection_id: 'selection-new',
      provider_name_snapshot: 'Current Provider',
      charging_plan_name_snapshot: 'Current Plan',
      price_snapshot: {
        label: 'Current Provider Current Plan',
        kWhPrice: 55,
        sessionFee: 100,
      },
      applied_price_per_kwh: 55,
      applied_session_fee: 100,
      total_cost: 650,
    }));
  });

  it('rejects switching pricing source while editing a session', () => {
    // Arrange: start from a persisted plan-based session.
    const original = buildSessionFixture({
      session_mode: 'plan',
      tariff_plan_id: 'plan-1',
      provider_id: 'provider-1',
      charging_type: 'AC',
      pricing_context: 'standard',
    });

    // Act/Assert: editing cannot switch the persisted pricing source.
    expect(() => prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      charging_type: original.charging_type,
      kwh_billed: original.kwh_billed,
      session_mode: 'ad_hoc',
      tariff_plan_id: null,
      plan_selection_id: null,
      billing_provider_name: 'Cariqa',
      cpo_name: 'Guest CPO',
      pricing_context: 'ad_hoc',
      ad_hoc_pricing: {
        pricePerKwh: 55,
      },
    })).toThrow('Pricing source cannot be changed while editing a session');
  });

  it('rejects invalid unchanged-identity edits that violate session invariants', () => {
    // Arrange: keep the plan identity fixed while sending invalid billed energy.
    const original = buildSessionFixture({
      session_mode: 'plan',
      tariff_plan_id: 'plan-1',
      provider_id: 'provider-1',
      charging_type: 'AC',
      pricing_context: 'standard',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
    });
    if (original.session_mode !== 'plan') {
      throw new Error('Expected a plan session fixture');
    }

    // Act/Assert: unchanged-identity edits still enforce the same input invariants.
    expect(() => prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      provider_id: original.provider_id,
      charging_type: original.charging_type,
      kwh_billed: 0,
      session_mode: 'plan',
      tariff_plan_id: original.tariff_plan_id!,
      plan_selection_id: original.plan_selection_id,
      price_snapshot: original.price_snapshot,
      pricing_context: original.pricing_context,
    })).toThrow('kwh_billed must be greater than 0');
  });

  it('preserves ad-hoc fee collections when an unchanged edit is resaved', () => {
    // Arrange: store multiple fee rows with labels and notes.
    const original = buildSessionFixture({
      id: 'session-ad-hoc-preserve-fees',
      session_mode: 'ad_hoc',
      provider_id: null,
      tariff_plan_id: null,
      plan_selection_id: null,
      pricing_context: 'ad_hoc',
      charging_plan_name_snapshot: 'Ad-Hoc',
      provider_name_snapshot: 'Guest CPO',
      applied_price_per_kwh: 55,
      applied_session_fee: 199,
      total_cost: 924,
      ad_hoc_pricing: {
        cpoName: 'Guest CPO',
        pricePerKwh: 55,
        pricePerSession: 199,
        otherFees: [
          { label: 'Parking', amount: 50, notes: 'First hour' },
          { label: 'Idle', amount: 125, notes: 'Overstay' },
        ],
      },
      price_snapshot: { label: 'Ad-Hoc', kWhPrice: 55, sessionFee: 199, blockingFee: 175 },
    });

    // Act: update notes only while resubmitting the same aggregate pricing.
    const edited = prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      charging_type: original.charging_type,
      kwh_billed: original.kwh_billed,
      notes: 'Updated note',
      session_mode: 'ad_hoc',
      tariff_plan_id: null,
      plan_selection_id: null,
      billing_provider_name: 'Guest CPO',
      cpo_name: 'Guest CPO',
      pricing_context: 'ad_hoc',
      ad_hoc_pricing: {
        pricePerKwh: 55,
        pricePerSession: 199,
        otherFees: [
          { label: 'Parking', amount: 50, notes: 'First hour' },
          { label: 'Idle', amount: 125, notes: 'Overstay' },
        ],
      },
    });

    // Assert: all persisted fee rows survive unchanged.
    expect(edited.ad_hoc_pricing?.otherFees).toEqual([
      { label: 'Parking', amount: 50, notes: 'First hour' },
      { label: 'Idle', amount: 125, notes: 'Overstay' },
    ]);
    expect(edited.total_cost).toBe(2574);
    expect(edited.notes).toBe('Updated note');
  });

  it('replaces ad-hoc fee collections when the aggregate other-fees amount changes', () => {
    // Arrange: start from a stored ad-hoc session with multiple fee rows.
    const original = buildSessionFixture({
      id: 'session-ad-hoc-rewrite-fees',
      session_mode: 'ad_hoc',
      provider_id: null,
      tariff_plan_id: null,
      plan_selection_id: null,
      pricing_context: 'ad_hoc',
      charging_plan_name_snapshot: 'Ad-Hoc',
      provider_name_snapshot: 'Guest CPO',
      applied_price_per_kwh: 55,
      applied_session_fee: 199,
      total_cost: 924,
      ad_hoc_pricing: {
        cpoName: 'Guest CPO',
        pricePerKwh: 55,
        pricePerSession: 199,
        otherFees: [
          { label: 'Parking', amount: 50, notes: 'First hour' },
          { label: 'Idle', amount: 125, notes: 'Overstay' },
        ],
      },
      price_snapshot: { label: 'Ad-Hoc', kWhPrice: 55, sessionFee: 199, blockingFee: 175 },
    });

    // Act: submit a changed aggregate amount through the simplified UI model.
    const edited = prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      charging_type: original.charging_type,
      kwh_billed: original.kwh_billed,
      session_mode: 'ad_hoc',
      tariff_plan_id: null,
      plan_selection_id: null,
      billing_provider_name: 'Guest CPO',
      cpo_name: 'Guest CPO',
      pricing_context: 'ad_hoc',
      ad_hoc_pricing: {
        pricePerKwh: 55,
        pricePerSession: 199,
        otherFees: [{ label: 'Other fees', amount: 250 }],
      },
    });

    // Assert: the aggregate rewrite intentionally collapses to one synthetic fee row.
    expect(edited.ad_hoc_pricing?.otherFees).toEqual([{ label: 'Other fees', amount: 250 }]);
    expect(edited.price_snapshot?.blockingFee).toBe(250);
    expect(edited.total_cost).toBe(2649);
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

  it('atomically saves a plan session together with its plan-selection history', async () => {
    // Arrange: create a prepared plan session plus its matching selection change.
    const session = buildSessionFixture({
      id: 'session-with-selection',
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'selection-new',
      price_snapshot: { label: 'Provider Plan', kWhPrice: 40, sessionFee: 0 },
    });
    if (session.session_mode !== 'plan') {
      throw new Error('Expected a plan session fixture');
    }
    const request: SessionPersistenceRequest = {
      session,
      planSelectionChange: {
        userId: session.user_id,
        providerId: session.provider_id,
        tariffPlanId: 'plan-1',
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        priceSnapshot: { label: 'Provider Plan', kWhPrice: 40, sessionFee: 0 },
      },
    };

    // Act: persist the session and selection in one orchestration call.
    await saveSessionWithPlanSelection(request);

    // Assert: session, selection row, and outbox items are all committed.
    const storedSession = await sharedDb.sessions.get('session-with-selection');
    const storedSelection = await sharedDb.provider_plan_selections.toCollection().first();
    expect(await sharedDb.sessions.get('session-with-selection')).toEqual(
      expect.objectContaining({
        id: 'session-with-selection',
        plan_selection_id: storedSelection?.id,
      })
    );
    expect(await sharedDb.provider_plan_selections.count()).toBe(1);
    expect(storedSelection).toEqual(expect.objectContaining({
      tariff_plan_id: 'plan-1',
      provider_id: 'provider-1',
    }));
    expect(storedSession?.plan_selection_id).toBe(storedSelection?.id);
    expect(await sharedDb.sync_outbox.toArray()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table_name: 'sessions', action: 'INSERT' }),
        expect.objectContaining({ table_name: 'provider_plan_selections', action: 'INSERT' }),
      ])
    );
  });

  it('rolls back a plan-linked update when the session row is missing after selection writes', async () => {
    // Arrange: build an update request whose session id is not present locally.
    const session = buildSessionFixture({
      id: 'session-selection-rollback',
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'selection-new',
      price_snapshot: { label: 'Provider Plan', kWhPrice: 40, sessionFee: 0 },
    });
    if (session.session_mode !== 'plan') {
      throw new Error('Expected a plan session fixture');
    }

    // Act/Assert: no partial selection or session data survives the rejected transaction.
    await expect(updateSessionWithPlanSelection({
      session,
      planSelectionChange: {
        userId: session.user_id,
        providerId: session.provider_id,
        tariffPlanId: 'plan-1',
        validFrom: new Date('2026-06-01T00:00:00.000Z'),
        priceSnapshot: { label: 'Provider Plan', kWhPrice: 40, sessionFee: 0 },
      },
    })).rejects.toThrow('Session not found: session-selection-rollback');

    expect(await sharedDb.sessions.get('session-selection-rollback')).toBeUndefined();
    expect(await sharedDb.provider_plan_selections.count()).toBe(0);
    expect(await sharedDb.sync_outbox.count()).toBe(0);
  });

  it('updates only an existing row and preserves stored immutable fields', async () => {
    // Arrange: persist a row, then provide conflicting caller-owned fields.
    const original = buildSessionFixture({
      id: 'session-edit-1',
      user_id: 'stored-user',
      created_at: new Date('2026-06-01T08:00:00.000Z'),
      session_mode: 'plan',
      deleted_at: new Date('2026-06-03T08:00:00.000Z'),
      notes: 'Original',
    });
    await sharedDb.sessions.put(original);

    // Act: update mutable content.
    await updateSession({
      ...original,
      user_id: 'caller-user',
      created_at: new Date('2026-06-02T08:00:00.000Z'),
      deleted_at: undefined,
      notes: 'Edited',
    });

    // Assert: service-owned identity and lifecycle fields come from storage.
    expect(await sharedDb.sessions.get(original.id)).toEqual(expect.objectContaining({
      id: original.id,
      user_id: 'stored-user',
      created_at: original.created_at,
      session_mode: 'plan',
      deleted_at: original.deleted_at,
      notes: 'Edited',
    }));
  })

  it('rejects an update when the local session does not exist', async () => {
    // Arrange: build a valid payload without seeding its id.
    const missing = buildSessionFixture({ id: 'missing-session' });

    // Act and Assert: edit cannot silently become an insert.
    await expect(updateSession(missing)).rejects.toThrow('Session not found: missing-session');
    expect(await sharedDb.sessions.get('missing-session')).toBeUndefined();
    expect(await sharedDb.sync_outbox.count()).toBe(0);
  })

  it('queues an UPDATE payload for the stored session id', async () => {
    // Arrange: seed directly so the assertion contains only the update outbox row.
    const original = buildSessionFixture({ id: 'session-edit-outbox', total_cost: 1800 });
    await sharedDb.sessions.put(original);

    // Act: update the same logical row.
    await updateSession({ ...original, total_cost: 2500, notes: 'Edited' });

    // Assert: one retryable UPDATE is queued with the committed payload.
    expect(await sharedDb.sync_outbox.toArray()).toEqual([
      expect.objectContaining({
        table_name: 'sessions',
        action: 'UPDATE',
        retry_count: 0,
        payload: expect.objectContaining({
          id: 'session-edit-outbox',
          total_cost: 2500,
          notes: 'Edited',
        }),
      }),
    ]);
  })

  it('rolls back the local edit when the update outbox write fails', async () => {
    // Arrange: seed the original row and force the queue write to reject.
    const original = buildSessionFixture({ id: 'session-update-rollback', notes: 'Original' });
    await sharedDb.sessions.put(original);
    const outboxSpy = vi.spyOn(sharedDb.sync_outbox, 'add')
      .mockRejectedValueOnce(new Error('Outbox failed'));

    // Act and Assert: the transaction rejects and restores the original row.
    await expect(updateSession({ ...original, notes: 'Edited' })).rejects.toThrow('Outbox failed');
    expect(await sharedDb.sessions.get(original.id)).toEqual(original);
    outboxSpy.mockRestore();
  })

  it('should fetch sessions for requested user ordered by timestamp desc', async () => {
    // Arrange: Seed two sessions for user-456 with different timestamps and one for another user.
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
    const otherUserSession = buildSessionFixture({ ...s1, id: 's3', user_id: 'user-999' });

    await db.sessions.bulkAdd([s1, s2, otherUserSession]);

    // Act: Fetch active sessions through the service.
    const sessions = await (await import('./sessionService')).getSessions('user-456');
    // Assert: Foreign-user rows are excluded and newer sessions appear first.
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('s2');
    expect(sessions[1].id).toBe('s1');
  });

  it('prefers session_timestamp over updated_at when ordering history', async () => {
    // Arrange: Give the older session a newer update timestamp.
    const newerSessionDate = buildSessionFixture({
      id: 'session-newer-date',
      session_timestamp: new Date('2026-06-03T08:00:00.000Z'),
      created_at: new Date('2026-06-03T08:30:00.000Z'),
      updated_at: new Date('2026-06-03T08:30:00.000Z'),
    });
    const olderSessionDate = buildSessionFixture({
      id: 'session-older-date',
      session_timestamp: new Date('2026-06-02T08:00:00.000Z'),
      created_at: new Date('2026-06-04T08:30:00.000Z'),
      updated_at: new Date('2026-06-04T08:30:00.000Z'),
    });

    await db.sessions.bulkAdd([olderSessionDate, newerSessionDate]);

    // Act: Fetch active sessions through the service.
    const sessions = await (await import('./sessionService')).getSessions('user-456');

    // Assert: Session date remains the primary ordering key.
    expect(sessions.map((session) => session.id)).toEqual([
      'session-newer-date',
      'session-older-date',
    ]);
  });
})
