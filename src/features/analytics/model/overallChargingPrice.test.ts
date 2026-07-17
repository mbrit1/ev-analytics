import { afterEach, describe, expect, it } from 'vitest'
import type { ChargingPlan } from '../../charging-plans'
import type { ChargingSession } from '../../charging-sessions'
import { calculateOverallChargingPrice } from './overallChargingPrice'

const utcDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`)

type PlanSession = Extract<ChargingSession, { session_mode: 'plan' }>
type AdHocSession = Extract<ChargingSession, { session_mode: 'ad_hoc' }>
type SessionOverrides = Partial<PlanSession> | Partial<AdHocSession>

function buildPlan(overrides: Partial<ChargingPlan> = {}): ChargingPlan {
  const createdAt = utcDate('2026-01-01')

  return {
    id: overrides.id ?? 'plan-1',
    user_id: overrides.user_id ?? 'user-1',
    provider_id: overrides.provider_id ?? 'provider-1',
    name: overrides.name ?? 'Monthly Plan',
    valid_from: overrides.valid_from ?? utcDate('2026-01-01'),
    valid_to: overrides.valid_to ?? null,
    monthly_base_fee: overrides.monthly_base_fee ?? 0,
    session_fee: overrides.session_fee ?? 0,
    created_at: overrides.created_at ?? createdAt,
    updated_at: overrides.updated_at ?? createdAt,
    deleted_at: overrides.deleted_at,
  }
}

function buildSession(overrides: SessionOverrides = {}): ChargingSession {
  const timestamp = overrides.session_timestamp ?? new Date(2026, 0, 15, 12)
  const common = {
    id: overrides.id ?? 'session-1',
    user_id: overrides.user_id ?? 'user-1',
    session_timestamp: timestamp,
    provider_name_snapshot: overrides.provider_name_snapshot ?? 'Provider',
    charging_type: overrides.charging_type ?? 'AC',
    kwh_billed: overrides.kwh_billed ?? 10,
    total_cost: overrides.total_cost ?? 500,
    applied_session_fee: 0,
    created_at: overrides.created_at ?? timestamp,
    updated_at: overrides.updated_at ?? timestamp,
    deleted_at: overrides.deleted_at,
  }

  if (overrides.session_mode === 'plan' || overrides.tariff_plan_id) {
    const planOverrides = overrides as Partial<PlanSession>
    return {
      ...common,
      session_mode: 'plan',
      provider_id: planOverrides.provider_id ?? 'provider-1',
      tariff_plan_id: planOverrides.tariff_plan_id ?? 'plan-1',
    }
  }

  const adHocOverrides = overrides as Partial<AdHocSession>
  return {
    ...common,
    session_mode: 'ad_hoc',
    provider_id: null,
    tariff_plan_id: null,
    plan_selection_id: null,
    pricing_context: 'ad_hoc',
    ad_hoc_pricing: adHocOverrides.ad_hoc_pricing ?? { pricePerKwh: null },
  }
}

/**
 * Test suite for the pure lifetime Overall Price calculation.
 *
 * Verifies strict local-date input, trustworthy result variants, weighted
 * session totals, tariff timelines and conflicts, and exact fixed-cost
 * proration and rounding.
 */
describe('calculateOverallChargingPrice', () => {
  const originalTimeZone = process.env.TZ

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  })

  it.each([
    '2026-7-01',
    '2026-07-01T00:00:00.000Z',
    '2026-02-29',
    '2026-13-01',
  ])('rejects non-canonical or impossible local date %s', (asOfLocalDate) => {
    // Arrange: Provide no business data so only the boundary value is relevant.
    const input = { sessions: [], chargingPlanVersions: [], asOfLocalDate }

    // Act / Assert: Invalid local calendar keys fail before calculation.
    expect(() => calculateOverallChargingPrice(input)).toThrowError(RangeError)
  })

  it('returns empty when every supplied session is deleted', () => {
    // Arrange: Include only a soft-deleted local session.
    const deletedAt = new Date(2026, 0, 16, 12)
    const sessions = [buildSession({ deleted_at: deletedAt })]

    // Act: Calculate the lifetime result.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: Deleted sessions do not create numerator or denominator data.
    expect(result).toEqual({ status: 'empty' })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns unavailable for participating billed energy %s',
    (kwhBilled) => {
      // Arrange: Keep a malformed active session in the trusted lifetime set.
      const sessions = [buildSession({ kwh_billed: kwhBilled })]

      // Act: Calculate without silently dropping the session.
      const result = calculateOverallChargingPrice({
        sessions,
        chargingPlanVersions: [],
        asOfLocalDate: '2026-07-15',
      })

      // Assert: Invalid energy makes the complete KPI unavailable.
      expect(result).toEqual({
        status: 'unavailable',
        reason: 'invalid_billed_energy',
      })
    },
  )

  it('guards against a non-finite final billed-energy denominator', () => {
    // Arrange: Each value is finite, but their sum overflows.
    const sessions = [
      buildSession({ id: 'one', kwh_billed: Number.MAX_VALUE }),
      buildSession({ id: 'two', kwh_billed: Number.MAX_VALUE }),
    ]

    // Act: Calculate the lifetime result.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: Division by an invalid aggregate is prevented.
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'invalid_billed_energy',
    })
  })

  it('returns unavailable when a plan session references missing tariff history', () => {
    // Arrange: Mark the session as plan-linked without supplying its version.
    const sessions = [buildSession({ tariff_plan_id: 'missing-plan' })]

    // Act: Calculate the lifetime result.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: Missing history cannot produce a partial ready result.
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'missing_tariff_history',
    })
  })

  it('uses weighted plan and ad-hoc totals and qualifies one current-month fee once', () => {
    // Arrange: Two plan sessions and one ad-hoc session contribute weighted totals.
    const plan = buildPlan({
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 1199,
    })
    const sessions = [
      buildSession({
        id: 'plan-one',
        session_timestamp: new Date(2026, 6, 5, 12),
        tariff_plan_id: plan.id,
        total_cost: 4000,
        kwh_billed: 80,
      }),
      buildSession({
        id: 'plan-two',
        session_timestamp: new Date(2026, 6, 14, 12),
        tariff_plan_id: plan.id,
        total_cost: 622,
        kwh_billed: 9.2,
      }),
      buildSession({
        id: 'ad-hoc',
        session_timestamp: new Date(2026, 5, 20, 12),
        total_cost: 2000,
        kwh_billed: 40,
      }),
      buildSession({
        id: 'deleted',
        session_timestamp: new Date(2026, 6, 15, 12),
        tariff_plan_id: 'missing-plan',
        total_cost: 9999,
        kwh_billed: 0,
        deleted_at: new Date(2026, 6, 16, 12),
      }),
    ]

    // Act: Include July 1 through July 15, not the future month remainder.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: Session prices are not averaged and the subscription is not duplicated.
    expect(result).toEqual({
      status: 'ready',
      sessionCount: 3,
      billedEnergyKwh: 129.2,
      sessionSpendCents: 6622,
      fixedCostCents: 580,
      includedSpendCents: 7202,
      overallPriceCtPerKwh: 7202 / 129.2,
    })
  })

  it('charges the full fee when a tariff covers a completed qualifying month', () => {
    // Arrange: The only session occurs on the final day of a fully active June.
    const plan = buildPlan({ monthly_base_fee: 1199 })
    const sessions = [buildSession({
      session_timestamp: new Date(2026, 5, 30, 18),
      tariff_plan_id: plan.id,
    })]

    // Act: Calculate after June has completed.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: Session timing does not move the tariff's billing start.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 1199 })
  })

  it('starts first-month proration at the tariff start before the first session', () => {
    // Arrange: A June tariff starts on day 10 but is first used on day 25.
    const plan = buildPlan({
      valid_from: utcDate('2026-06-10'),
      monthly_base_fee: 3000,
    })
    const sessions = [buildSession({
      session_timestamp: new Date(2026, 5, 25, 12),
      tariff_plan_id: plan.id,
    })]

    // Act: Calculate after the qualifying month.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: June 10 through June 30 contributes 21 of 30 days.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 2100 })
  })

  it('does not charge an unused month between two qualifying months', () => {
    // Arrange: The tariff is active continuously but used only in January and March.
    const plan = buildPlan({ monthly_base_fee: 1000 })
    const sessions = [
      buildSession({
        id: 'january',
        session_timestamp: new Date(2026, 0, 20, 12),
        tariff_plan_id: plan.id,
      }),
      buildSession({
        id: 'february-ad-hoc',
        session_timestamp: new Date(2026, 1, 20, 12),
      }),
      buildSession({
        id: 'march',
        session_timestamp: new Date(2026, 2, 20, 12),
        tariff_plan_id: plan.id,
      }),
    ]

    // Act: Calculate after both qualifying months are complete.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-04-15',
    })

    // Assert: February is an excluded sunk-cost month.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 2000 })
  })

  it('uses leap-year month length for partial February fees', () => {
    // Arrange: A 2900-cent plan begins on 15 February in a leap year.
    const plan = buildPlan({
      valid_from: utcDate('2024-02-15'),
      monthly_base_fee: 2900,
    })
    const sessions = [buildSession({
      session_timestamp: new Date(2024, 1, 28, 12),
      tariff_plan_id: plan.id,
    })]

    // Act: Calculate after February has completed.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2024-03-15',
    })

    // Assert: February 15 through 29 contributes 15 of 29 days.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 1500 })
  })

  it('qualifies the tariff month from the session local date rather than its UTC date', () => {
    // Arrange: This instant is 30 June locally but 1 July in UTC.
    process.env.TZ = 'America/Los_Angeles'
    const plan = buildPlan({
      valid_from: utcDate('2026-06-01'),
      monthly_base_fee: 3000,
    })
    const sessions = [buildSession({
      session_timestamp: new Date('2026-07-01T00:30:00.000Z'),
      tariff_plan_id: plan.id,
    })]

    // Act: Calculate after June has completed.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-15',
    })

    // Assert: The fully active local June qualifies, not partial July.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 3000 })
  })

  it('uses the explicit local as-of date as the current-month horizon', () => {
    // Arrange: Use a July fee that divides into 100 cents per day.
    const plan = buildPlan({
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 3100,
    })
    const sessions = [buildSession({
      session_timestamp: new Date(2026, 6, 10, 12),
      tariff_plan_id: plan.id,
    })]

    // Act: Calculate the same data at two explicit local dates.
    const onDayTen = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-10',
    })
    const onDayTwenty = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-20',
    })

    // Assert: Today is included and no system-clock value determines the result.
    expect(onDayTen).toMatchObject({ status: 'ready', fixedCostCents: 1000 })
    expect(onDayTwenty).toMatchObject({ status: 'ready', fixedCostCents: 2000 })
  })

  it('lets an earlier exclusive tariff end win over the current-day horizon', () => {
    // Arrange: The plan ends at July 11, so July 10 is its last billable day.
    const plan = buildPlan({
      valid_from: utcDate('2026-07-01'),
      valid_to: utcDate('2026-07-11'),
      monthly_base_fee: 3100,
    })
    const sessions = [buildSession({
      session_timestamp: new Date(2026, 6, 10, 12),
      tariff_plan_id: plan.id,
    })]

    // Act: Calculate later in the same month.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [plan],
      asOfLocalDate: '2026-07-20',
    })

    // Assert: Only July 1 through July 10 contributes.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 1000 })
  })

  it('collapses promotions and restored versions into one logical tariff timeline', () => {
    // Arrange: One tariff changes fee for a promotion, then restores its baseline.
    const baseline = buildPlan({
      id: 'baseline',
      name: 'EnBW L',
      valid_from: utcDate('2026-07-01'),
      valid_to: utcDate('2026-07-10'),
      monthly_base_fee: 3100,
    })
    const promotion = buildPlan({
      id: 'promotion',
      name: ' enbw l ',
      valid_from: utcDate('2026-07-10'),
      valid_to: utcDate('2026-07-20'),
      monthly_base_fee: 1550,
      deleted_at: utcDate('2026-08-01'),
    })
    const restored = buildPlan({
      id: 'restored',
      name: 'ENBW L',
      valid_from: utcDate('2026-07-20'),
      monthly_base_fee: 3100,
    })
    const sessions = [buildSession({
      session_timestamp: new Date(2026, 6, 15, 12),
      tariff_plan_id: promotion.id,
    })]

    // Act: Calculate after the promotion month is complete.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [restored, promotion, baseline],
      asOfLocalDate: '2026-08-15',
    })

    // Assert: Each non-overlapping fee segment contributes once.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 2600 })
  })

  it('prorates a non-overlapping mid-month switch between logical tariffs', () => {
    // Arrange: EnBW L ends as EnBW M begins, and both are used in July.
    const large = buildPlan({
      id: 'large',
      name: 'EnBW L',
      valid_from: utcDate('2026-07-01'),
      valid_to: utcDate('2026-07-16'),
      monthly_base_fee: 3100,
    })
    const medium = buildPlan({
      id: 'medium',
      name: 'EnBW M',
      valid_from: utcDate('2026-07-16'),
      monthly_base_fee: 620,
    })
    const sessions = [
      buildSession({
        id: 'large-session',
        session_timestamp: new Date(2026, 6, 10, 12),
        tariff_plan_id: large.id,
      }),
      buildSession({
        id: 'medium-session',
        session_timestamp: new Date(2026, 6, 20, 12),
        tariff_plan_id: medium.id,
      }),
    ]

    // Act: Calculate after July has completed.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [medium, large],
      asOfLocalDate: '2026-08-15',
    })

    // Assert: Fifteen L days and sixteen M days are both counted.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 1820 })
  })

  it('returns every paid-tariff conflict in deterministic order', () => {
    // Arrange: Supply two conflicts out of chronological and provider order.
    const juneAble = buildPlan({
      id: 'june-able',
      provider_id: 'provider-2',
      name: 'Able',
      valid_from: utcDate('2026-06-01'),
      monthly_base_fee: 3000,
    })
    const juneZeta = buildPlan({
      id: 'june-zeta',
      provider_id: 'provider-2',
      name: 'Zeta',
      valid_from: utcDate('2026-06-10'),
      monthly_base_fee: 3000,
    })
    const julyAlpha = buildPlan({
      id: 'july-alpha',
      provider_id: 'provider-1',
      name: 'Alpha',
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 3100,
    })
    const julyBeta = buildPlan({
      id: 'july-beta',
      provider_id: 'provider-1',
      name: 'Beta',
      valid_from: utcDate('2026-07-10'),
      monthly_base_fee: 3100,
    })
    const sessions = [
      buildSession({
        id: 'july-beta-session',
        provider_id: 'provider-1',
        session_timestamp: new Date(2026, 6, 20, 12),
        tariff_plan_id: julyBeta.id,
      }),
      buildSession({
        id: 'june-zeta-session',
        provider_id: 'provider-2',
        session_timestamp: new Date(2026, 5, 20, 12),
        tariff_plan_id: juneZeta.id,
      }),
      buildSession({
        id: 'july-alpha-session',
        provider_id: 'provider-1',
        session_timestamp: new Date(2026, 6, 5, 12),
        tariff_plan_id: julyAlpha.id,
      }),
      buildSession({
        id: 'june-able-session',
        provider_id: 'provider-2',
        session_timestamp: new Date(2026, 5, 5, 12),
        tariff_plan_id: juneAble.id,
      }),
    ]

    // Act: Calculate with plans supplied in an unrelated order.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [julyBeta, juneZeta, julyAlpha, juneAble],
      asOfLocalDate: '2026-08-15',
    })

    // Assert: Month, provider, and normalized tariff names define the order.
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'overlapping_paid_tariffs',
      conflicts: [
        {
          providerId: 'provider-2',
          tariffNames: ['Able', 'Zeta'],
          month: '2026-06',
        },
        {
          providerId: 'provider-1',
          tariffNames: ['Alpha', 'Beta'],
          month: '2026-07',
        },
      ],
    })
  })

  it('does not flag an overlap when either qualifying tariff has no fixed fee', () => {
    // Arrange: A free tariff overlaps a paid tariff from the same provider.
    const free = buildPlan({
      id: 'free',
      name: 'Free',
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 0,
    })
    const paid = buildPlan({
      id: 'paid',
      name: 'Paid',
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 3100,
    })
    const sessions = [
      buildSession({
        id: 'free-session',
        session_timestamp: new Date(2026, 6, 5, 12),
        tariff_plan_id: free.id,
      }),
      buildSession({
        id: 'paid-session',
        session_timestamp: new Date(2026, 6, 10, 12),
        tariff_plan_id: paid.id,
      }),
    ]

    // Act: Calculate after the overlapping month.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [paid, free],
      asOfLocalDate: '2026-08-15',
    })

    // Assert: Only the paid tariff contributes; no conflict is raised.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 3100 })
  })

  it('does not flag an overlap when only one logical tariff qualifies', () => {
    // Arrange: Two paid tariffs overlap, but only Alpha has a July session.
    const alpha = buildPlan({
      id: 'alpha',
      name: 'Alpha',
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 3100,
    })
    const beta = buildPlan({
      id: 'beta',
      name: 'Beta',
      valid_from: utcDate('2026-07-01'),
      monthly_base_fee: 3100,
    })
    const sessions = [buildSession({
      session_timestamp: new Date(2026, 6, 5, 12),
      tariff_plan_id: alpha.id,
    })]

    // Act: Calculate after July has completed.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [beta, alpha],
      asOfLocalDate: '2026-08-15',
    })

    // Assert: The unrelated Beta history does not participate.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 3100 })
  })

  it('rounds an exact half-cent upward after summing all fixed costs', () => {
    // Arrange: Three February prorations sum exactly to 14/28 = 0.5 cent.
    const oneDay = buildPlan({
      id: 'one-day',
      provider_id: 'provider-1',
      valid_from: utcDate('2026-02-01'),
      valid_to: utcDate('2026-02-02'),
      monthly_base_fee: 1,
    })
    const twelveDays = buildPlan({
      id: 'twelve-days',
      provider_id: 'provider-2',
      valid_from: utcDate('2026-02-01'),
      valid_to: utcDate('2026-02-13'),
      monthly_base_fee: 1,
    })
    const finalDay = buildPlan({
      id: 'final-day',
      provider_id: 'provider-3',
      valid_from: utcDate('2026-02-27'),
      valid_to: utcDate('2026-02-28'),
      monthly_base_fee: 1,
    })
    const sessions = [
      buildSession({
        id: 'one-day-session',
        provider_id: 'provider-1',
        session_timestamp: new Date(2026, 1, 1, 12),
        tariff_plan_id: oneDay.id,
      }),
      buildSession({
        id: 'twelve-days-session',
        provider_id: 'provider-2',
        session_timestamp: new Date(2026, 1, 5, 12),
        tariff_plan_id: twelveDays.id,
      }),
      buildSession({
        id: 'final-day-session',
        provider_id: 'provider-3',
        session_timestamp: new Date(2026, 1, 27, 12),
        tariff_plan_id: finalDay.id,
      }),
    ]

    // Act: Calculate after February has completed.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [oneDay, twelveDays, finalDay],
      asOfLocalDate: '2026-03-15',
    })

    // Assert: Rational accumulation avoids binary floating-point under-rounding.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 1 })
  })

  it('rounds fixed costs once at the lifetime boundary', () => {
    // Arrange: Two separate half-cent contributions total one exact cent.
    const first = buildPlan({
      id: 'first-half-cent',
      provider_id: 'provider-1',
      valid_from: utcDate('2026-02-01'),
      valid_to: utcDate('2026-02-15'),
      monthly_base_fee: 1,
    })
    const second = buildPlan({
      id: 'second-half-cent',
      provider_id: 'provider-2',
      valid_from: utcDate('2026-02-01'),
      valid_to: utcDate('2026-02-15'),
      monthly_base_fee: 1,
    })
    const sessions = [
      buildSession({
        id: 'first-half-session',
        provider_id: 'provider-1',
        session_timestamp: new Date(2026, 1, 5, 12),
        tariff_plan_id: first.id,
      }),
      buildSession({
        id: 'second-half-session',
        provider_id: 'provider-2',
        session_timestamp: new Date(2026, 1, 10, 12),
        tariff_plan_id: second.id,
      }),
    ]

    // Act: Calculate after both qualifying prorations are complete.
    const result = calculateOverallChargingPrice({
      sessions,
      chargingPlanVersions: [first, second],
      asOfLocalDate: '2026-03-15',
    })

    // Assert: Per-tariff rounding would incorrectly produce two cents.
    expect(result).toMatchObject({ status: 'ready', fixedCostCents: 1 })
  })
})
