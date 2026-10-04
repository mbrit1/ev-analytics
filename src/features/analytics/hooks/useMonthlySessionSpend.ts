import { useMemo } from 'react'
import { useSessions } from '../../charging-sessions'
import type { AnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateMonthlySessionSpend } from '../model/monthlySessionSpend'

/** Reactively aggregates spend and billed energy for the selected Analytics period. */
export function useMonthlySessionSpend(period: AnalyticsPeriod) {
  const { sessions, isLoading, error } = useSessions()
  const result = useMemo(
    () => calculateMonthlySessionSpend(sessions, period),
    [sessions, period],
  )

  return { result, isLoading, error }
}
