import { countCalendarDays, type AnalyticsPeriod, type PreviousAnalyticsPeriod } from './analyticsPeriods'
import type { MonthlySessionSpendResult } from './monthlySessionSpend'

/** Availability or signed percentage state for one compared metric. */
export type MetricChange =
  | { status: 'unavailable' }
  | { status: 'unequal-day-count' }
  | { status: 'up-from-zero' }
  | { status: 'no-change' }
  | { status: 'percentage'; percentage: number }

/** Metric changes and weighted price difference for comparable aggregates. */
export interface PreviousPeriodComparison {
  status: 'compared'
  spending: MetricChange
  energy: MetricChange
  /** Signed current-minus-previous weighted price, in EUR per kWh. */
  priceDifferenceEurPerKwh: number | null
}

/** Result returned when the previous period contains no active sessions. */
export interface NoComparisonData {
  status: 'no-comparison-data'
  spending: MetricChange
  energy: MetricChange
  priceDifferenceEurPerKwh: null
}

function percentageChange(current: number, previous: number): MetricChange {
  if (previous === 0) return current === 0 ? { status: 'no-change' } : { status: 'up-from-zero' }
  if (current === 0 && previous > 0) return { status: 'percentage', percentage: -100 }
  return { status: 'percentage', percentage: ((current - previous) / previous) * 100 }
}

function hasCompleteEnergy(result: MonthlySessionSpendResult): boolean {
  return !result.isEmpty
    && result.billedEnergyKwh !== null
    && result.validBilledEnergySessionCount === result.sessionCount
}

/** Compares existing period aggregates without changing their session validity rules. */
export function comparePreviousPeriod(
  current: MonthlySessionSpendResult,
  previous: MonthlySessionSpendResult,
  currentPeriod: AnalyticsPeriod,
  previousPeriod: PreviousAnalyticsPeriod,
): PreviousPeriodComparison | NoComparisonData {
  if (previous.isEmpty) {
    return { status: 'no-comparison-data', spending: { status: 'unavailable' }, energy: { status: 'unavailable' }, priceDifferenceEurPerKwh: null }
  }

  const currentDayCount = countCalendarDays(currentPeriod.startUtc, currentPeriod.endUtc)
  const previousDayCount = countCalendarDays(previousPeriod.startUtc, previousPeriod.endUtc)
  const unequalDayCount = currentDayCount !== previousDayCount
  const spending = current.isEmpty || current.totalSessionSpendCents === null || previous.totalSessionSpendCents === null
    ? { status: 'unavailable' } as const
    : unequalDayCount
      ? { status: 'unequal-day-count' } as const
      : percentageChange(current.totalSessionSpendCents, previous.totalSessionSpendCents)

  const energy = !hasCompleteEnergy(current) || !hasCompleteEnergy(previous)
    ? { status: 'unavailable' } as const
    : unequalDayCount
      ? { status: 'unequal-day-count' } as const
      : percentageChange(current.billedEnergyKwh!, previous.billedEnergyKwh!)

  const priceDifferenceEurPerKwh = current.averageSessionPriceCtPerKwh !== null
      && previous.averageSessionPriceCtPerKwh !== null
    ? (current.averageSessionPriceCtPerKwh - previous.averageSessionPriceCtPerKwh) / 100
    : null

  return { status: 'compared', spending, energy, priceDifferenceEurPerKwh }
}
