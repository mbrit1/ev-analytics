/** A user-facing local calendar month. Month is zero-based, matching Date. */
export interface CalendarMonth {
  year: number
  month: number
}
/** Shared filtering metadata for Analytics periods. */
export interface AnalyticsPeriodBounds {
  startUtc: Date
  endUtc: Date
  isCurrentMonth: boolean
  isCompleteMonth: boolean
}

/** Filtering and presentation metadata for a local calendar month. */
export interface MonthPeriod extends AnalyticsPeriodBounds {
  month: CalendarMonth
}

/** Named trailing range available from the Analytics period selector. */
export type AnalyticsPeriodPreset = '7-days' | '30-days' | '3-months' | 'year'

/** A calendar month or a trailing preset selected for the Analytics summary. */
export type AnalyticsPeriodSelection =
  | { kind: 'month'; month: CalendarMonth }
  | { kind: 'preset'; preset: AnalyticsPeriodPreset }

/** Filtering and display metadata for any Analytics summary period. */
export interface AnalyticsPeriod extends AnalyticsPeriodBounds {
  selection: AnalyticsPeriodSelection
  isInProgress: boolean
}

/** Bounds and display metadata for the period immediately before a selection. */
export interface PreviousAnalyticsPeriod {
  startUtc: Date
  endUtc: Date
  dayCount: number
  isDayCountEqual: boolean
  isInProgress: boolean
  /** Prior calendar month for calendar-month comparisons. */
  monthLabel?: CalendarMonth
  /** True when current month-to-date days had to be backfilled across a short prior month. */
  isMonthToDateFallback?: boolean
}

/** Returns the local calendar month containing the supplied instant. */
export function getCalendarMonth(date: Date): CalendarMonth {
  return { year: date.getFullYear(), month: date.getMonth() }
}

/** Moves a calendar month by an integer number of months. */
export function shiftCalendarMonth(value: CalendarMonth, amount: number): CalendarMonth {
  const shifted = new Date(value.year, value.month + amount, 1)
  return getCalendarMonth(shifted)
}

/** Compares local calendar months without depending on their UTC offsets. */
export function compareCalendarMonths(left: CalendarMonth, right: CalendarMonth): number {
  return (left.year * 12 + left.month) - (right.year * 12 + right.month)
}

/**
 * Builds inclusive-start/exclusive-end instants for a user-facing local month.
 *
 * Date converts local midnights to absolute instants, making the resulting
 * boundaries safe to compare with UTC timestamps stored by IndexedDB.
 */
export function createMonthPeriod(month: CalendarMonth, now = new Date()): MonthPeriod {
  const currentMonth = getCalendarMonth(now)
  const isCurrentMonth = compareCalendarMonths(month, currentMonth) === 0

  return {
    month,
    startUtc: new Date(month.year, month.month, 1),
    endUtc: isCurrentMonth
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      : new Date(month.year, month.month + 1, 1),
    isCurrentMonth,
    isCompleteMonth: compareCalendarMonths(month, currentMonth) < 0,
  }
}

function subtractCalendarMonths(end: Date, months: number): Date {
  const destination = new Date(end.getFullYear(), end.getMonth() - months, 1)
  const lastDay = new Date(destination.getFullYear(), destination.getMonth() + 1, 0).getDate()
  destination.setDate(Math.min(end.getDate(), lastDay))
  return destination
}

/** Builds one local-calendar period definition for filtering and presentation. */
export function createAnalyticsPeriod(
  selection: AnalyticsPeriodSelection,
  now = new Date(),
): AnalyticsPeriod {
  if (selection.kind === 'month') {
    const monthPeriod = createMonthPeriod(selection.month, now)
    return {
      selection,
      ...monthPeriod,
      isInProgress: monthPeriod.isCurrentMonth,
    }
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endUtc = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const startUtc = selection.preset === '7-days' || selection.preset === '30-days'
    ? new Date(todayStart)
    : subtractCalendarMonths(endUtc, selection.preset === '3-months' ? 3 : 12)

  if (selection.preset === '7-days') startUtc.setDate(startUtc.getDate() - 6)
  if (selection.preset === '30-days') startUtc.setDate(startUtc.getDate() - 29)

  return {
    selection,
    startUtc,
    endUtc,
    isCurrentMonth: false,
    isCompleteMonth: false,
    isInProgress: true,
  }
}

/** Counts local calendar dates in an inclusive-start/exclusive-end interval. */
export function countCalendarDays(start: Date, end: Date): number {
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((endDay - startDay) / 86_400_000)
}

/**
 * Derives an equal-local-day comparison window immediately before a selection.
 * Current month-to-date uses matching dates in the prior month when possible,
 * then backfills from the selection start if that month is too short.
 */
export function createPreviousAnalyticsPeriod(selected: AnalyticsPeriod): PreviousAnalyticsPeriod {
  const selectedDayCount = countCalendarDays(selected.startUtc, selected.endUtc)
  let endUtc = new Date(selected.startUtc)
  let startUtc = new Date(
    endUtc.getFullYear(),
    endUtc.getMonth(),
    endUtc.getDate() - selectedDayCount,
  )
  let monthLabel: CalendarMonth | undefined
  let isMonthToDateFallback = false

  if (selected.selection.kind === 'month' && selected.isCurrentMonth) {
    const priorMonth = shiftCalendarMonth(selected.selection.month, -1)
    const priorMonthDays = new Date(priorMonth.year, priorMonth.month + 1, 0).getDate()

    if (selectedDayCount <= priorMonthDays) {
      startUtc = new Date(priorMonth.year, priorMonth.month, 1)
      endUtc = new Date(priorMonth.year, priorMonth.month, selectedDayCount + 1)
      monthLabel = priorMonth
    } else {
      isMonthToDateFallback = true
    }
  } else if (selected.selection.kind === 'month') {
    const lastIncludedDay = new Date(endUtc.getFullYear(), endUtc.getMonth(), endUtc.getDate() - 1)
    if (
      startUtc.getFullYear() === lastIncludedDay.getFullYear()
      && startUtc.getMonth() === lastIncludedDay.getMonth()
    ) {
      monthLabel = getCalendarMonth(startUtc)
    }
  }

  const dayCount = countCalendarDays(startUtc, endUtc)
  return {
    startUtc,
    endUtc,
    dayCount,
    isDayCountEqual: dayCount === selectedDayCount,
    isInProgress: selected.isInProgress,
    ...(monthLabel ? { monthLabel } : {}),
    ...(isMonthToDateFallback ? { isMonthToDateFallback: true } : {}),
  }
}
