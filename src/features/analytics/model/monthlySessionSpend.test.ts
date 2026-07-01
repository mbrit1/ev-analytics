import { describe, expect, it } from 'vitest'
import type { ChargingSession } from '../../charging-sessions'
import { createMonthPeriod } from './analyticsPeriods'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'

function buildSession(id: string, timestamp: Date, cost: number, deleted = false): ChargingSession {
  return {
    id,
    user_id: 'user-1',
    session_timestamp: timestamp,
    provider_id: 'provider-1',
    provider_name_snapshot: 'Provider',
    charging_type: 'AC',
    kwh_billed: 10,
    total_cost: cost,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: deleted ? new Date(timestamp.getTime() + 1) : undefined,
  }
}

/**
 * Test suite for monthly session-spend aggregation.
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
    expect(result).toMatchObject({ totalSessionSpendCents: 0, sessionCount: 0, isEmpty: true })
  })

  it('sums valid sessions in integer cents', () => {
    // Arrange: Add one session at the inclusive start and another within June.
    const sessions = [
      buildSession('start', period.startUtc, 1201),
      buildSession('middle', new Date(2026, 5, 15, 12), 2302),
    ]

    // Act: Calculate monthly spend.
    const result = calculateMonthlySessionSpend(sessions, period)

    // Assert: Both exact cent values and sessions are included.
    expect(result).toMatchObject({ totalSessionSpendCents: 3503, sessionCount: 2, isEmpty: false })
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
})
