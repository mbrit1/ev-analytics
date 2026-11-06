import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh, formatMonthLabel } from '../../../shared/lib'
import type { AnalyticsPeriod, PreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import type { MetricChange, NoComparisonData, PreviousPeriodComparison } from '../model/previousPeriodComparison'
import { formatAnalyticsPeriodRange } from './analyticsPeriodLabels'

/** Values and query state for comparing the selected period with its predecessor. */
export interface PreviousPeriodComparisonSlabProps {
  period: AnalyticsPeriod
  previousPeriod: PreviousAnalyticsPeriod
  result: MonthlySessionSpendResult
  previousResult: MonthlySessionSpendResult
  comparison: PreviousPeriodComparison | NoComparisonData
  isLoading: boolean
  error?: unknown | null
}

function periodLabel(period: AnalyticsPeriod): string {
  return period.selection.kind === 'month'
    ? formatMonthLabel(period.selection.month.year, period.selection.month.month)
    : ({ '7-days': '7 Days', '30-days': '30 Days', '3-months': '3 Months', year: 'Year' }[period.selection.preset])
}

function previousLabel(period: PreviousAnalyticsPeriod): string {
  return period.monthLabel
    ? formatMonthLabel(period.monthLabel.year, period.monthLabel.month)
    : 'Previous period'
}

function formatChange(change: MetricChange): string {
  if (change.status === 'unavailable') return 'Unavailable'
  if (change.status === 'unequal-day-count') return 'Period lengths differ'
  if (change.status === 'up-from-zero') return 'Increased from zero'
  if (change.status === 'no-change') return 'No change'
  const value = Math.abs(change.percentage) < 0.05 ? 0 : change.percentage
  const formatted = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(Math.abs(value))
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}%`
}

function formatPriceDifference(value: number | null): string {
  if (value === null) return 'Unavailable'
  const normalized = Math.abs(value) < 0.005 ? 0 : value
  const amount = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(normalized))
  return `${normalized > 0 ? '+' : normalized < 0 ? '−' : ''}${amount} €/kWh`
}

function periodDayCount(period: Pick<AnalyticsPeriod, 'startUtc' | 'endUtc'>): number {
  const startDay = Date.UTC(period.startUtc.getFullYear(), period.startUtc.getMonth(), period.startUtc.getDate())
  const endDay = Date.UTC(period.endUtc.getFullYear(), period.endUtc.getMonth(), period.endUtc.getDate())
  return Math.round((endDay - startDay) / 86_400_000)
}

function metricValue(current: number | null, previous: number | null, formatter: (value: number) => string) {
  return current === null || previous === null
    ? 'Unavailable'
    : `${formatter(current)} now · ${formatter(previous)} before`
}

/** Shows neutral, period-scoped changes in session spend, billed energy and weighted price. */
export function PreviousPeriodComparisonSlab({
  period,
  previousPeriod,
  result,
  previousResult,
  comparison,
  isLoading,
  error = null,
}: PreviousPeriodComparisonSlabProps) {
  const currentLabel = periodLabel(period)
  const priorLabel = previousLabel(previousPeriod)
  const equalDayCountNote = period.isInProgress && !previousPeriod.isDayCountEqual
    ? `The ranges contain different numbers of days: current period ${periodDayCount(period)} days; previous period ${previousPeriod.dayCount} days. Percentage changes are unavailable for unequal ranges.`
    : null

  return (
    <Slab padding="none" className="w-full space-y-5 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-primary">Previous period comparison</h2>
        <p className="text-sm text-secondary">{currentLabel}: {formatAnalyticsPeriodRange(period)}{period.isInProgress ? ' · In progress' : ''}</p>
        <p className="text-sm text-secondary">{priorLabel}: {formatAnalyticsPeriodRange(previousPeriod)}</p>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load the previous period comparison. Please try again.</p>
      ) : isLoading ? (
        <div role="status"><span className="sr-only">Loading comparison</span><div aria-hidden="true" className="h-20 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" /></div>
      ) : comparison.status === 'no-comparison-data' ? (
        <p className="text-sm text-secondary">No comparison data: no charging sessions in the previous period.</p>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-secondary">Session spend</h3>
              <p className="text-sm font-semibold text-primary">{metricValue(result.isEmpty ? null : result.totalSessionSpendCents, previousResult.isEmpty ? null : previousResult.totalSessionSpendCents, formatCurrency)}</p>
              <p className="text-sm text-secondary">Change: {formatChange(comparison.spending)}</p>
            </div>
            <div className="space-y-2 border-t border-slab-border pt-4 sm:border-t-0 sm:pt-0">
              <h3 className="text-sm font-medium text-secondary">Billed energy</h3>
              <p className="text-sm font-semibold text-primary">{metricValue(result.isEmpty ? null : result.billedEnergyKwh, previousResult.isEmpty ? null : previousResult.billedEnergyKwh, formatKwh)}{!result.isEmpty && result.billedEnergyKwh !== null && !previousResult.isEmpty && previousResult.billedEnergyKwh !== null ? ' kWh' : ''}</p>
              <p className="text-sm text-secondary">Change: {formatChange(comparison.energy)}</p>
              {result.sessionCount > 0 && result.validBilledEnergySessionCount < result.sessionCount && <p className="text-xs text-secondary">Current period energy is available for {result.validBilledEnergySessionCount} of {result.sessionCount} sessions.</p>}
              {previousResult.sessionCount > 0 && previousResult.validBilledEnergySessionCount < previousResult.sessionCount && <p className="text-xs text-secondary">Previous period energy is available for {previousResult.validBilledEnergySessionCount} of {previousResult.sessionCount} sessions.</p>}
            </div>
            <div className="space-y-2 border-t border-slab-border pt-4 sm:border-t-0 sm:pt-0">
              <h3 className="text-sm font-medium text-secondary">Weighted price difference</h3>
              <p className="text-sm font-semibold text-primary">{formatPriceDifference(comparison.priceDifferenceEurPerKwh)}</p>
              <p className="text-xs text-secondary">Current period minus previous period, based on complete cost and energy coverage.</p>
            </div>
          </div>
          {(comparison.spending.status === 'up-from-zero' || comparison.energy.status === 'up-from-zero') && <p className="text-xs text-secondary">Percentage change is unavailable when the previous value is zero.</p>}
        </>
      )}
      {!isLoading && error === null && equalDayCountNote && <p className="text-xs text-secondary">{equalDayCountNote}</p>}
    </Slab>
  )
}
