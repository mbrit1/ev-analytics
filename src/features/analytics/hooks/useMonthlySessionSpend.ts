import { useMemo } from 'react'
import { useSessions } from '../../charging-sessions'
import { createMonthPeriod, type CalendarMonth } from '../model/analyticsPeriods'
import { calculateMonthlySessionSpend } from '../model/monthlySessionSpend'

/** Reactively aggregates locally stored charging sessions for a selected month. */
export function useMonthlySessionSpend(month: CalendarMonth, now: Date) {
  const { sessions, isLoading } = useSessions()
  const period = useMemo(
    () => createMonthPeriod({ year: month.year, month: month.month }, now),
    [month.month, month.year, now],
  )
  const result = useMemo(
    () => calculateMonthlySessionSpend(sessions, period),
    [period, sessions],
  )

  return { result, isLoading }
}
