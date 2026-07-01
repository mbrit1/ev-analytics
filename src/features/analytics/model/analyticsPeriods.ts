/** A user-facing local calendar month. Month is zero-based, matching Date. */
export interface CalendarMonth {
  year: number
  month: number
}
/** Filtering and presentation metadata for a local calendar month. */
export interface MonthPeriod {
  month: CalendarMonth
  startUtc: Date
  endUtc: Date
  isCurrentMonth: boolean
  isCompleteMonth: boolean
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
    endUtc: new Date(month.year, month.month + 1, 1),
    isCurrentMonth,
    isCompleteMonth: compareCalendarMonths(month, currentMonth) < 0,
  }
}
