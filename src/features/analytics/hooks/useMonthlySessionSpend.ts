import { useMemo } from 'react'
import { useSessions } from '../../charging-sessions'
import type { AnalyticsPeriod } from '../model/analyticsPeriods'
import { calculateBillingProviderBreakdown } from '../model/billingProviderBreakdown'
import { calculateMonthlySessionSpend } from '../model/monthlySessionSpend'
import { calculateSessionSpendingTrend } from '../model/sessionSpendingTrend'

/** Reactively aggregates spend and billed energy for the selected Analytics period. */
export function useMonthlySessionSpend(period: AnalyticsPeriod) {
  const { sessions, isLoading, error } = useSessions()
  const result = useMemo(
    () => calculateMonthlySessionSpend(sessions, period),
    [sessions, period],
  )
  const providerBreakdown = useMemo(
    () => calculateBillingProviderBreakdown(sessions, period),
    [sessions, period],
  )
  const trend = useMemo(
    () => calculateSessionSpendingTrend(sessions, period),
    [sessions, period],
  )

  return { result, providerBreakdown, trend, isLoading, error }
}
