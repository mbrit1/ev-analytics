import type { ChargingSession } from '../../charging-sessions'
import type { MonthPeriod } from './analyticsPeriods'

/** Result of aggregating active charging-session costs for one month. */
export interface MonthlySessionSpendResult {
  totalSessionSpendCents: number
  sessionCount: number
  periodStartUtc: Date
  periodEndUtc: Date
  isCurrentMonth: boolean
  isCompleteMonth: boolean
  isEmpty: boolean
}
/** Sums integer session costs inside an inclusive-start/exclusive-end period. */
export function calculateMonthlySessionSpend(
  sessions: readonly ChargingSession[],
  period: MonthPeriod,
): MonthlySessionSpendResult {
  const includedSessions = sessions.filter((session) => {
    const timestamp = new Date(session.session_timestamp).getTime()
    return !session.deleted_at
      && timestamp >= period.startUtc.getTime()
      && timestamp < period.endUtc.getTime()
  })

  return {
    totalSessionSpendCents: includedSessions.reduce(
      (total, session) => total + session.total_cost,
      0,
    ),
    sessionCount: includedSessions.length,
    periodStartUtc: period.startUtc,
    periodEndUtc: period.endUtc,
    isCurrentMonth: period.isCurrentMonth,
    isCompleteMonth: period.isCompleteMonth,
    isEmpty: includedSessions.length === 0,
  }
}
