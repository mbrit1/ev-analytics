import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh, formatMonthLabel } from '../../../shared/lib'
import type { AnalyticsPeriod, PreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import type { MetricChange, NoComparisonData, PreviousPeriodComparison } from '../model/previousPeriodComparison'
import { selectPreviousPeriodHighlight, type PreviousPeriodHighlight } from '../model/previousPeriodHighlight'
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

function valueForPeriod(result: MonthlySessionSpendResult, value: number | null, formatter: (value: number) => string): string {
  if (result.isEmpty) return 'No sessions'
  return value === null ? 'Unavailable' : formatter(value)
}

function energyValue(result: MonthlySessionSpendResult) {
  const partial = !result.isEmpty && result.validBilledEnergySessionCount < result.sessionCount
  const value = valueForPeriod(result, result.billedEnergyKwh, (amount) => `${formatKwh(amount)} kWh`)
  return <>{partial && result.billedEnergyKwh !== null ? `Known: ${value}` : value}{partial && <span className="mt-1 block text-xs font-normal">{result.validBilledEnergySessionCount} of {result.sessionCount} sessions measured</span>}</>
}

function formatPrice(value: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)} €/kWh`
}

function highlightSentence(highlight: PreviousPeriodHighlight, equalDayCount: boolean): string {
  if (highlight.metric === 'price') {
    return `Weighted session price changed by ${formatPriceDifference(highlight.difference)}${equalDayCount ? '' : ' across periods of different lengths'}.`
  }
  const label = highlight.metric === 'spending' ? 'Session spend' : 'Billed energy'
  const amount = highlight.metric === 'spending' ? formatCurrency(Math.abs(highlight.difference)) : `${formatKwh(Math.abs(highlight.difference))} kWh`
  if (highlight.percentage === null) return `${label} increased from zero to ${amount}.`
  const percent = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(Math.abs(highlight.percentage))
  return `${label} ${highlight.difference > 0 ? 'increased' : 'decreased'} by ${amount} (${percent}%).`
}

/** Shows neutral, period-scoped changes in session spend, billed energy and weighted price. */
export function PreviousPeriodComparisonSlab({ period, previousPeriod, result, previousResult, comparison, isLoading, error = null }: PreviousPeriodComparisonSlabProps) {
  const unequalNote = !previousPeriod.isDayCountEqual
    ? `The ranges contain different numbers of days: current period ${periodDayCount(period)} days; previous period ${previousPeriod.dayCount} days.${period.isInProgress ? ' Percentage changes are unavailable for unequal ranges.' : ''}`
    : null
  const highlight = selectPreviousPeriodHighlight(result, previousResult, comparison, previousPeriod.isDayCountEqual)
  const rows = [
    { label: 'Session spend', current: valueForPeriod(result, result.totalSessionSpendCents, formatCurrency), previous: valueForPeriod(previousResult, previousResult.totalSessionSpendCents, formatCurrency), change: formatChange(comparison.spending) },
    { label: 'Billed energy', current: energyValue(result), previous: energyValue(previousResult), change: formatChange(comparison.energy) },
    { label: 'Weighted session price', current: valueForPeriod(result, result.averageSessionPriceCtPerKwh, formatPrice), previous: valueForPeriod(previousResult, previousResult.averageSessionPriceCtPerKwh, formatPrice), change: formatPriceDifference(comparison.priceDifferenceEurPerKwh) },
  ]
  return (
    <Slab padding="none" className="w-full space-y-5 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-primary">Previous period comparison</h2>
        <p className="text-sm text-slab-secondary">Current · {periodLabel(period)}: {formatAnalyticsPeriodRange(period)}{period.isInProgress ? ' · In progress' : ''}</p>
        <p className="text-sm text-slab-secondary">Previous · {previousLabel(previousPeriod)}: {formatAnalyticsPeriodRange(previousPeriod)}</p>
      </div>
      {error !== null ? <p role="alert" className="text-sm text-primary">Unable to load the previous period comparison. Please try again.</p>
        : isLoading ? <div role="status"><span className="sr-only">Loading comparison</span><div aria-hidden="true" className="h-20 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" /></div>
        : <>
          {highlight && <p className="text-sm text-primary">{highlightSentence(highlight, previousPeriod.isDayCountEqual)}</p>}
          <table className="w-full text-left text-sm text-primary" aria-label="Previous period comparison">
            <thead className="sr-only sm:not-sr-only">
              <tr><th scope="col" className="pb-3 font-medium">Metric</th><th scope="col" className="pb-3 font-medium">Current</th><th scope="col" className="pb-3 font-medium">Previous</th><th scope="col" className="pb-3 font-medium">Change</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => <tr key={row.label} className="grid grid-cols-3 gap-x-2 border-t border-slab-border py-4 sm:table-row sm:border-0 sm:py-0">
                <th scope="row" className="col-span-3 pb-3 text-left font-medium sm:border-t sm:border-slab-border sm:py-4 sm:pr-3">{row.label}</th>
                {[row.current, row.previous, row.change].map((value, index) => <td key={index} className="min-w-0 break-words tabular-nums align-top sm:border-t sm:border-slab-border sm:py-4 sm:pr-3"><span aria-hidden="true" className="mb-1 block text-xs font-normal sm:hidden">{['Current', 'Previous', 'Change'][index]}</span>{value}</td>)}
              </tr>)}
            </tbody>
          </table>
          <p className="text-xs text-slab-secondary">Weighted session price requires complete session cost and billed energy coverage. Price change is current minus previous.</p>
          {(comparison.spending.status === 'up-from-zero' || comparison.energy.status === 'up-from-zero') && <p className="text-xs text-slab-secondary">Percentage change is unavailable when the previous value is zero.</p>}
          {unequalNote && <p className="text-xs text-slab-secondary">{unequalNote}</p>}
        </>}
    </Slab>
  )
}
