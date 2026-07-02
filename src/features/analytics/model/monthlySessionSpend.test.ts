import { describe, expect, it } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { createMonthPeriod } from './analyticsPeriods'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'

function buildSession(
  id: string,
  timestamp: Date,
  cost: number,
  deleted = false,
  billedEnergyKwh = 10,
): ChargingSession {
  return {
    id,
    user_id: 'user-1',
    session_timestamp: timestamp,
    provider_id: 'provider-1',
    provider_name_snapshot: 'Provider',
    charging_type: 'AC',
    kwh_billed: billedEnergyKwh,
    total_cost: cost,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: deleted ? new Date(timestamp.getTime() + 1) : undefined,
  }
}

/**
 * Test suite for monthly session-spend and billed-energy aggregation.
 *
 * Verifies integer-cent totals, active-session filtering, exact period edges,
 * and result metadata without involving rendering or persistence.
 */
describe('calculateMonthlySessionSpend', () => {
  const period = createMonthPeriod(
    { year: 2026, month: 5 },
    new Date(2026, 6, 1),
  )

  it('returns an empty result for no sessions', () => {
    // Arrange: Use an empty local session list.
    const sessions: ChargingSession[] = []

    // Act: Calculate June spend.
    const result = calculateMonthlySessionSpend(sessions, period)

    // Assert: Empty metadata and integer zero are returned.
    expect(result).toMatchObject({
      totalSessionSpendCents: 0,
      billedEnergyKwh: null,
      sessionCount: 0,
      validBilledEnergySessionCount: 0,
      isEmpty: true,
    })
  })

  it('sums valid sessions in integer cents', () => {
    // Arrange: Add one session at the inclusive start and another within June.
    const sessions = [
      buildSession('start', period.startUtc, 1201, false, 12.35),
      buildSession('middle', new Date(2026, 5, 15, 12), 2302, false, 23.45),
    ]

    // Act: Calculate monthly spend.
    const result = calculateMonthlySessionSpend(sessions, period)

    // Assert: Both exact cent values and sessions are included.
    expect(result).toMatchObject({
      totalSessionSpendCents: 3503,
      billedEnergyKwh: 35.8,
      sessionCount: 2,
      validBilledEnergySessionCount: 2,
      isEmpty: false,
    })
  })

  it('excludes outside, soft-deleted, and exclusive-end sessions', () => {
    // Arrange: Mix one valid session with every excluded case.
    const sessions = [
      buildSession('valid', new Date(2026, 5, 20, 12), 500),
      buildSession('before', new Date(period.startUtc.getTime() - 1), 100),
      buildSession('end', period.endUtc, 200),
      buildSession('deleted', new Date(2026, 5, 21, 12), 300, true),
    ]

    // Act: Calculate monthly spend.
    const result = calculateMonthlySessionSpend(sessions, period)

    // Assert: Only the active in-range session contributes to count and cents.
    expect(result).toMatchObject({ totalSessionSpendCents: 500, sessionCount: 1 })
    expect(result.periodStartUtc).toBe(period.startUtc)
    expect(result.periodEndUtc).toBe(period.endUtc)
  })

  it('does not coerce invalid billed-energy values to zero', () => {
    // Arrange: Simulate legacy or malformed local records alongside one valid value.
    const sessions = [
      {
        ...buildSession('missing', new Date(2026, 5, 10, 12), 100),
        kwh_billed: undefined as unknown as number,
      },
      buildSession('zero', new Date(2026, 5, 11, 12), 200, false, 0),
      buildSession('valid', new Date(2026, 5, 12, 12), 300, false, 7.5),
    ]

    // Act: Aggregate the selected month.
    const result = calculateMonthlySessionSpend(sessions, period)

    // Assert: Spend still covers all sessions while energy uses valid billed kWh only.
    expect(result).toMatchObject({
      totalSessionSpendCents: 600,
      billedEnergyKwh: 7.5,
      sessionCount: 3,
      validBilledEnergySessionCount: 1,
    })
  })

  it('reports billed energy as unavailable when no included session has a valid value', () => {
    // Arrange: Simulate an included session without valid provider-billed energy.
    const sessions = [
      buildSession('invalid', new Date(2026, 5, 10, 12), 100, false, Number.NaN),
    ]

    // Act: Aggregate the selected month.
    const result = calculateMonthlySessionSpend(sessions, period)

    // Assert: The month is not empty, but its energy result remains unavailable.
    expect(result).toMatchObject({
      billedEnergyKwh: null,
      sessionCount: 1,
      validBilledEnergySessionCount: 0,
      isEmpty: false,
    })
  })
})
