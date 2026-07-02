import type { ChargingSession } from '../../charging-sessions'
import type { MonthPeriod } from './analyticsPeriods'

/** Result of aggregating active charging-session spend and billed energy for one month. */
export interface MonthlySessionSpendResult {
  totalSessionSpendCents: number
  billedEnergyKwh: number | null
  sessionCount: number
  validBilledEnergySessionCount: number
  periodStartUtc: Date
  periodEndUtc: Date
  isCurrentMonth: boolean
  isCompleteMonth: boolean
  isEmpty: boolean
}
/** Aggregates session spend and valid billed kWh inside an inclusive-start/exclusive-end period. */
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
  const validBilledEnergySessions = includedSessions.filter(
    (session) => Number.isFinite(session.kwh_billed) && session.kwh_billed > 0,
  )

  return {
    totalSessionSpendCents: includedSessions.reduce(
      (total, session) => total + session.total_cost,
      0,
    ),
    billedEnergyKwh: validBilledEnergySessions.length > 0
      ? validBilledEnergySessions.reduce((total, session) => total + session.kwh_billed, 0)
      : null,
    sessionCount: includedSessions.length,
    validBilledEnergySessionCount: validBilledEnergySessions.length,
    periodStartUtc: period.startUtc,
    periodEndUtc: period.endUtc,
    isCurrentMonth: period.isCurrentMonth,
    isCompleteMonth: period.isCompleteMonth,
    isEmpty: includedSessions.length === 0,
  }
}
