import type { ChargingSession } from '../../charging-sessions'
import { compareCalendarMonths, createAnalyticsPeriod, getCalendarMonth, type AnalyticsPeriod, type CalendarMonth } from './analyticsPeriods'
import { calculateMonthlySessionSpend } from './monthlySessionSpend'

/** Recorded spend and coverage for one local calendar month. End is exclusive. */
export interface SessionSpendingBucket {
  /** Inclusive UTC instant represented by the bucket. */
  startUtc: Date
  /** Exclusive UTC instant ending the bucket. */
  endUtc: Date
  totalSessionSpendCents: number | null
  sessionCount: number
  unit: 'month'
  /** Local calendar identity used to align the chart and selected summary. */
  month: CalendarMonth
  /** Whether this bucket belongs to the in-progress month covered by the period. */
  isCurrentMonth: boolean
  /** Whether this bucket covers only part of its local calendar month. */
  isPartialMonth: boolean
}

/** Monthly chart data and its bounds, which may be wider than the summary period. */
export interface SessionSpendingTrend {
  /** Inclusive first instant represented by the chart. */
  startUtc: Date
  /** Exclusive final instant represented by the chart. */
  endUtc: Date
  /** Selected calendar month, or null when a rolling preset is selected. */
  selectedMonth: CalendarMonth | null
  buckets: SessionSpendingBucket[]
  unit: 'month'
  isEmpty: boolean
}

function usesThreeMonthContext(period: AnalyticsPeriod): boolean {
  return period.selection.kind === 'month'
    || period.selection.preset === '7-days'
    || period.selection.preset === '30-days'
}

/** Aggregates local-calendar buckets through the same validity rules as the summary. */
export function calculateSessionSpendingTrend(
  sessions: readonly ChargingSession[],
  period: AnalyticsPeriod,
): SessionSpendingTrend {
  const chartPeriod = usesThreeMonthContext(period)
    ? {
        ...createAnalyticsPeriod(
          { kind: 'preset', preset: '3-months' },
          new Date(period.endUtc.getTime() - 1),
        ),
        isInProgress: period.isInProgress,
      }
    : period

  const selectedMonth = period.selection.kind === 'month' ? period.selection.month : null
  const startUtc = new Date(chartPeriod.startUtc)
  const endUtc = new Date(chartPeriod.endUtc)
  const lastIncludedMonth = getCalendarMonth(new Date(endUtc.getTime() - 1))
  const cursor = new Date(startUtc.getFullYear(), startUtc.getMonth(), 1)

  const buckets: SessionSpendingBucket[] = []
  while (cursor.getTime() < endUtc.getTime()) {
    const month = getCalendarMonth(cursor)
    const calendarEnd = new Date(month.year, month.month + 1, 1)
    const bucketStartUtc = new Date(Math.max(cursor.getTime(), startUtc.getTime()))
    const bucketEndUtc = new Date(Math.min(calendarEnd.getTime(), endUtc.getTime()))
    const isCurrentMonth = selectedMonth !== null
      ? period.isCurrentMonth && compareCalendarMonths(month, selectedMonth) === 0
      : chartPeriod.isInProgress && compareCalendarMonths(month, lastIncludedMonth) === 0
    const aggregate = calculateMonthlySessionSpend(sessions, {
      startUtc: bucketStartUtc,
      endUtc: bucketEndUtc,
      isCurrentMonth,
      isCompleteMonth: !isCurrentMonth && bucketStartUtc.getTime() === cursor.getTime() && bucketEndUtc.getTime() === calendarEnd.getTime(),
    })

    buckets.push({
      startUtc: bucketStartUtc,
      endUtc: bucketEndUtc,
      totalSessionSpendCents: aggregate.totalSessionSpendCents,
      sessionCount: aggregate.sessionCount,
      unit: 'month',
      month,
      isCurrentMonth,
      isPartialMonth: bucketStartUtc.getTime() !== cursor.getTime() || bucketEndUtc.getTime() !== calendarEnd.getTime(),
    })
    cursor.setTime(calendarEnd.getTime())
  }

  return {
    startUtc,
    endUtc,
    selectedMonth,
    buckets,
    unit: 'month',
    isEmpty: buckets.every(({ sessionCount }) => sessionCount === 0),
  }
}
