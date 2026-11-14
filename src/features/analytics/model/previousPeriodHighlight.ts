import type { MonthlySessionSpendResult } from './monthlySessionSpend'
import type { MetricChange, NoComparisonData, PreviousPeriodComparison } from './previousPeriodComparison'

/** One eligible current-minus-previous observation, in cents, kWh, or EUR/kWh. */
export type PreviousPeriodHighlight =
  | { metric: 'spending' | 'energy'; difference: number; percentage: number | null }
  | { metric: 'price'; difference: number }

function eligibleChange(change: MetricChange, current: number, previous: number, minimum: number): number | null | undefined {
  const difference = Math.abs(current - previous)
  // Allow only the error introduced by floating-point arithmetic at the boundary.
  const error = Number.EPSILON * (Math.abs(current) + Math.abs(previous))
  if (difference + error < minimum) return undefined
  if (change.status === 'up-from-zero') return null
  if (change.status === 'percentage' && (difference + error) * 100 >= Math.abs(previous) * 15) return change.percentage
  return undefined
}

/** Selects at most one observation using unrounded values and existing comparison availability. */
export function selectPreviousPeriodHighlight(
  current: MonthlySessionSpendResult,
  previous: MonthlySessionSpendResult,
  comparison: PreviousPeriodComparison | NoComparisonData,
  equalDayCount: boolean,
): PreviousPeriodHighlight | null {
  if (comparison.status !== 'compared') return null
  if (equalDayCount) {
    if (current.totalSessionSpendCents !== null && previous.totalSessionSpendCents !== null) {
      const difference = current.totalSessionSpendCents - previous.totalSessionSpendCents
      const percentage = eligibleChange(comparison.spending, current.totalSessionSpendCents, previous.totalSessionSpendCents, 1000)
      if (percentage !== undefined) return { metric: 'spending', difference, percentage }
    }
    if (current.billedEnergyKwh !== null && previous.billedEnergyKwh !== null) {
      const difference = current.billedEnergyKwh - previous.billedEnergyKwh
      const percentage = eligibleChange(comparison.energy, current.billedEnergyKwh, previous.billedEnergyKwh, 20)
      if (percentage !== undefined) return { metric: 'energy', difference, percentage }
    }
  }
  // Subtraction of two weighted prices can land one floating-point step below an exact boundary.
  const priceError = current.averageSessionPriceCtPerKwh !== null && previous.averageSessionPriceCtPerKwh !== null
    ? Number.EPSILON * (Math.abs(current.averageSessionPriceCtPerKwh) + Math.abs(previous.averageSessionPriceCtPerKwh)) / 100
    : 0
  if (comparison.priceDifferenceEurPerKwh !== null && Math.abs(comparison.priceDifferenceEurPerKwh) + priceError >= 0.05) {
    return { metric: 'price', difference: comparison.priceDifferenceEurPerKwh }
  }
  return null
}
