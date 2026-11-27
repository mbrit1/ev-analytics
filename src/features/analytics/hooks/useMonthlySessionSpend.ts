import { useMemo } from 'react'
import { useSessions } from '../../charging-sessions'
import type { AnalyticsPeriod, PreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateBillingProviderBreakdown } from '../model/billingProviderBreakdown'
import { calculateMonthlySessionSpend } from '../model/monthlySessionSpend'
import { comparePreviousPeriod } from '../model/previousPeriodComparison'

/** Reactively aggregates spend and billed energy for the selected Analytics period. */
export function useMonthlySessionSpend(period: AnalyticsPeriod, previousPeriod: PreviousAnalyticsPeriod) {
  const { sessions, isLoading, error, retry } = useSessions()
  const result = useMemo(
    () => calculateMonthlySessionSpend(sessions, period),
    [sessions, period],
  )
  const previousResult = useMemo(
    () => calculateMonthlySessionSpend(sessions, {
      startUtc: previousPeriod.startUtc,
      endUtc: previousPeriod.endUtc,
      isCurrentMonth: false,
      isCompleteMonth: false,
    }),
    [sessions, previousPeriod],
  )
  const comparison = useMemo(
    () => comparePreviousPeriod(result, previousResult, period, previousPeriod),
    [period, previousPeriod, previousResult, result],
  )
  const providerBreakdown = useMemo(
    () => calculateBillingProviderBreakdown(sessions, period),
    [sessions, period],
  )
  return { result, previousResult, comparison, providerBreakdown, isLoading, error, retry }
}
