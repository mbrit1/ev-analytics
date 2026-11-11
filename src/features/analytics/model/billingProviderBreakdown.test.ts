import { describe, expect, it } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { createAnalyticsPeriod } from './analyticsPeriods'
import { calculateBillingProviderBreakdown } from './billingProviderBreakdown'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'

function buildSession(
  id: string,
  timestamp: Date,
  providerName: string,
  overrides: Partial<ChargingSession> = {},
): ChargingSession {
  return {
    id,
    user_id: 'owner-1',
    session_timestamp: timestamp,
    session_mode: 'plan',
    provider_id: 'provider-1',
    tariff_plan_id: 'plan-1',
    provider_name_snapshot: providerName,
    charging_type: 'AC',
    kwh_billed: 10,
    total_cost: 1000,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  } as ChargingSession
}

/** Verifies billing-provider identity, validity rules, and selected-period bounds. */
describe('calculateBillingProviderBreakdown', () => {
  const period = createAnalyticsPeriod(
    { kind: 'month', month: { year: 2026, month: 5 } },
    new Date(2026, 6, 1),
  )

  it('normalizes trimmed case-insensitive names across modes and preserves renamed snapshots', () => {
    // Arrange: Plan and ad hoc records use equivalent names; a later rename is separate.
    const sessions = [
      buildSession('plan-old', new Date(2026, 5, 4), '  ChargeCo '),
      buildSession('adhoc-old', new Date(2026, 5, 5), 'chargeco', {
        session_mode: 'ad_hoc', provider_id: null, tariff_plan_id: null,
        plan_selection_id: null, pricing_context: 'ad_hoc', ad_hoc_pricing: { pricePerKwh: 100 },
      } as Partial<ChargingSession>),
      buildSession('renamed', new Date(2026, 5, 6), 'ChargeCo Europe'),
    ]

    // Act
    const result = calculateBillingProviderBreakdown(sessions, period)

    // Assert
    expect(result.groups).toEqual([
      expect.objectContaining({ normalizedName: 'chargeco', name: 'chargeco', sessionCount: 2, totalCostCents: 2000, billedEnergyKwh: 20 }),
      expect.objectContaining({ normalizedName: 'chargeco europe', name: 'ChargeCo Europe', sessionCount: 1, totalCostCents: 1000, billedEnergyKwh: 10 }),
    ])
  })

  it('uses newest snapshot spelling with an ID tie break and ranks equal energy by normalized name', () => {
    // Arrange: Equal energy totals have deliberate name and timestamp ties.
    const sessions = [
      buildSession('z-last', new Date(2026, 5, 8), 'Zulu'),
      buildSession('a-newest', new Date(2026, 5, 9), 'ALPHA', { kwh_billed: 5 }),
      buildSession('b-same-time', new Date(2026, 5, 9), 'Alpha', { kwh_billed: 5 }),
    ]

    // Act
    const result = calculateBillingProviderBreakdown(sessions, period)

    // Assert
    expect(result.groups.map(({ normalizedName, name }) => ({ normalizedName, name }))).toEqual([
      { normalizedName: 'alpha', name: 'Alpha' },
      { normalizedName: 'zulu', name: 'Zulu' },
    ])
    expect(result.groups.map(({ billedEnergyKwh }) => billedEnergyKwh)).toEqual([10, 10])
  })

  it('reconciles to the selected-period summary for boundaries, deletion, free sessions, and partial energy', () => {
    // Arrange: The fixtures exercise exact period edges, soft deletion, free cost, and missing energy.
    const sessions = [
      buildSession('measured', new Date(2026, 5, 10), 'Provider A', { total_cost: 300, kwh_billed: 5 }),
      buildSession('unmeasured', new Date(2026, 5, 11), 'Provider B', { total_cost: 700, kwh_billed: Number.NaN }),
      buildSession('free-start-boundary', period.startUtc, 'Provider C', { total_cost: 0, kwh_billed: 2 }),
      buildSession('deleted', new Date(2026, 5, 12), 'Deleted', { total_cost: 500, kwh_billed: 4, deleted_at: new Date(2026, 5, 12) }),
      buildSession('before-start', new Date(period.startUtc.getTime() - 1), 'Outside', { total_cost: 800, kwh_billed: 8 }),
      buildSession('at-exclusive-end', period.endUtc, 'Outside', { total_cost: 900, kwh_billed: 9 }),
    ]

    // Act
    const result = calculateBillingProviderBreakdown(sessions, period)
    const summary = calculateMonthlySessionSpend(sessions, period)

    // Assert
    expect(result.totalSessionSpendCents).toBe(summary.totalSessionSpendCents)
    expect(result.groups.reduce((sum, group) => sum + (group.totalCostCents ?? 0), 0)).toBe(summary.totalSessionSpendCents)
    expect(result.billedEnergyKwh).toBe(summary.billedEnergyKwh)
    expect(result.groups.reduce((sum, group) => sum + (group.billedEnergyKwh ?? 0), 0)).toBe(summary.billedEnergyKwh)
    expect(result.sessionCount).toBe(summary.sessionCount)
    expect(result.validBilledEnergySessionCount).toBe(summary.validBilledEnergySessionCount)
    expect(result.groups).toEqual([
      expect.objectContaining({ normalizedName: 'provider a', totalCostCents: 300, billedEnergyKwh: 5, validBilledEnergySessionCount: 1 }),
      expect.objectContaining({ normalizedName: 'provider c', totalCostCents: 0, billedEnergyKwh: 2, validBilledEnergySessionCount: 1 }),
      expect.objectContaining({ normalizedName: 'provider b', totalCostCents: 700, billedEnergyKwh: null, validBilledEnergySessionCount: 0 }),
    ])
  })

  it('keeps blank names in an unknown group and applies summary-compatible energy and cost validity', () => {
    // Arrange: Blank, invalid, deleted, and out-of-period sessions exercise independent rules.
    const sessions = [
      buildSession('blank', new Date(2026, 5, 1), '   ', { total_cost: 0, kwh_billed: 0 }),
      buildSession('legacy-blank', new Date(2026, 5, 1), '', {
        provider_name_snapshot: null as unknown as string,
        total_cost: 0,
        kwh_billed: 0,
      }),
      buildSession('bad-cost', new Date(2026, 5, 2), 'Unknown', { total_cost: Number.NaN, kwh_billed: 5 }),
      buildSession('bad-energy', new Date(2026, 5, 3), 'Unknown', { total_cost: 200, kwh_billed: 0 }),
      buildSession('deleted', new Date(2026, 5, 4), 'Deleted', { deleted_at: new Date(2026, 5, 4) } as Partial<ChargingSession>),
      buildSession('before', new Date(2026, 4, 31, 23, 59), 'Outside'),
      buildSession('at-end', new Date(2026, 6, 1), 'Outside'),
    ]

    // Act
    const result = calculateBillingProviderBreakdown(sessions, period)
    const summary = calculateMonthlySessionSpend(sessions, period)

    // Assert
    expect(result.groups).toEqual([
      expect.objectContaining({ normalizedName: 'unknown', sessionCount: 2, billedEnergyKwh: 5, totalCostCents: null }),
      expect.objectContaining({ normalizedName: '', name: 'Unknown provider', sessionCount: 2, billedEnergyKwh: null, totalCostCents: 0 }),
    ])
    expect(result.totalSessionSpendCents).toBeNull()
    expect(result.totalSessionSpendCents).toBe(summary.totalSessionSpendCents)
    expect(result.billedEnergyKwh).toBe(summary.billedEnergyKwh)
    expect(result.billedEnergyKwh).toBe(5)
    expect(result.sessionCount).toBe(4)
    expect(result.validBilledEnergySessionCount).toBe(1)
    expect(result.periodStartUtc).toEqual(period.startUtc)
    expect(result.periodEndUtc).toEqual(period.endUtc)
  })
})
