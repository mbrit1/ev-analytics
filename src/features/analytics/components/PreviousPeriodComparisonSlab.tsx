import { useSyncExternalStore } from 'react'
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

function compactMonthRange(start: Date, end: Date): string {
  const lastIncluded = new Date(end.getTime() - 1)
  const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
  return `${formatter.format(start)} – ${formatter.format(lastIncluded)}`
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

function signedDifference(value: number, formatter: (value: number) => string, precision = 0): string {
  const threshold = precision === 2 ? 0.005 : precision === 1 ? 0.05 : 0
  const normalized = Math.abs(value) < threshold ? 0 : value
  return `${normalized > 0 ? '+' : normalized < 0 ? '−' : ''}${formatter(Math.abs(normalized)).replace(/ (?=€|kWh)/g, '\u00a0')}`
}

function comparisonDifference(change: MetricChange, current: number | null, previous: number | null, formatter: (value: number) => string, precision = 0): string | null {
  if (!['percentage', 'no-change', 'up-from-zero'].includes(change.status) || current === null || previous === null) return null
  return `Difference ${signedDifference(current - previous, formatter, precision)}`
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

function isCalendarMonth(period: AnalyticsPeriod): boolean {
  return period.selection.kind === 'month'
}

const metricLabelColor = 'text-slab-secondary dark:text-[color-mix(in_srgb,var(--color-slab-secondary)_85%,var(--color-primary))]'

// Match the Tailwind lg breakpoint so only one reading order is rendered.
const DESKTOP_COMPARISON_QUERY = '(min-width: 64rem)'

function subscribeToDesktopComparison(onChange: () => void) {
  const query = window.matchMedia?.(DESKTOP_COMPARISON_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function isDesktopComparison() {
  return window.matchMedia?.(DESKTOP_COMPARISON_QUERY).matches ?? false
}

function isMobileComparison() {
  return false
}

/** Shows neutral, period-scoped changes in session spend, billed energy and weighted price. */
export function PreviousPeriodComparisonSlab({ period, previousPeriod, result, previousResult, comparison, isLoading, error = null }: PreviousPeriodComparisonSlabProps) {
  const desktop = useSyncExternalStore(subscribeToDesktopComparison, isDesktopComparison, isMobileComparison)
  const unequalNote = !previousPeriod.isDayCountEqual
    ? `The ranges contain different numbers of days: current period ${periodDayCount(period)} days; previous period ${previousPeriod.dayCount} days.${period.isInProgress ? ' Percentage changes are unavailable for unequal ranges.' : ''}`
    : null
  const rows = [
    { label: 'Session spend', current: valueForPeriod(result, result.totalSessionSpendCents, formatCurrency), previous: valueForPeriod(previousResult, previousResult.totalSessionSpendCents, formatCurrency), change: formatChange(comparison.spending), difference: comparisonDifference(comparison.spending, result.totalSessionSpendCents, previousResult.totalSessionSpendCents, formatCurrency) },
    { label: 'Billed energy', current: energyValue(result), previous: energyValue(previousResult), change: formatChange(comparison.energy), difference: comparisonDifference(comparison.energy, result.billedEnergyKwh, previousResult.billedEnergyKwh, (value) => `${formatKwh(value)} kWh`, 2) },
    { label: 'Weighted session price', current: valueForPeriod(result, result.averageSessionPriceCtPerKwh, formatPrice), previous: valueForPeriod(previousResult, previousResult.averageSessionPriceCtPerKwh, formatPrice), change: formatPriceDifference(comparison.priceDifferenceEurPerKwh), difference: null },
  ]
  const currentRange = period.selection.kind === 'month'
    ? compactMonthRange(period.startUtc, period.endUtc)
    : formatAnalyticsPeriodRange(period)
  const previousRange = previousPeriod.monthLabel
    ? compactMonthRange(previousPeriod.startUtc, previousPeriod.endUtc)
    : formatAnalyticsPeriodRange(previousPeriod)
  return (
    <Slab padding="none" className="w-full space-y-5 p-5 max-[360px]:px-4 md:p-8" aria-busy={isLoading && error === null}>
      <div className="min-w-0 space-y-2">
        <h2 className="text-base font-semibold text-primary">Previous period comparison</h2>
        <p className="text-sm font-medium text-slab-secondary">Recorded charging activity</p>
        <div className="grid min-w-0 grid-cols-2 divide-x divide-slab-border rounded-xl bg-secondary/5 p-3">
          <div className="min-w-0 pr-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slab-secondary">Current period</p>
            <p className="mt-1 break-words text-sm font-medium text-primary">{periodLabel(period)}</p>
            <p className="mt-1 break-words text-xs text-slab-secondary">{currentRange}{period.isInProgress ? ' · In progress' : ''}</p>
          </div>
          <div className="min-w-0 pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slab-secondary">Previous period</p>
            <p className="mt-1 break-words text-sm font-medium text-primary">{previousLabel(previousPeriod)}</p>
            <p className="mt-1 break-words text-xs text-slab-secondary">{previousRange}</p>
          </div>
        </div>
        {period.isInProgress && isCalendarMonth(period) && previousPeriod.isDayCountEqual && <p className="text-xs text-slab-secondary">Compared across {periodDayCount(period)} matching calendar days.</p>}
        {unequalNote && <p className="text-xs text-slab-secondary">{unequalNote}</p>}
      </div>
      {error !== null ? <p role="alert" className="text-sm text-primary">Unable to load the previous period comparison. Please try again.</p>
        : isLoading ? <div role="status"><span className="sr-only">Loading comparison</span><div aria-hidden="true" className="h-20 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" /></div>
        : <>
          {comparison.status === 'no-comparison-data' && <p className="text-sm text-slab-secondary">No comparison data</p>}
          <table className="w-full border-separate border-spacing-0 text-left text-sm text-primary" aria-label="Previous period comparison">
            <thead className="sr-only">
              <tr><th scope="col">Metric</th><th scope="col">Current</th><th scope="col">Previous</th>{desktop && <th scope="col">Change</th>}</tr>
            </thead>
            <tbody className="block min-w-0 lg:grid lg:grid-cols-3 lg:gap-y-3 lg:divide-x lg:divide-slab-border">
              {rows.map((row) => {
                const direction = row.label === 'Weighted session price' ? '' : row.change[0]
                const change = (
                  <span aria-label={desktop ? undefined : `Change ${row.change}`} className="inline-flex w-fit max-w-full items-center rounded-full bg-secondary/10 px-2 py-1 text-xs font-medium tabular-nums text-slab-secondary max-lg:[overflow-wrap:anywhere]">
                    {direction === '+' && <><span aria-hidden="true" className="mr-1">↑</span><span className="sr-only">Increase </span></>}
                    {direction === '−' && <><span aria-hidden="true" className="mr-1">↓</span><span className="sr-only">Decrease </span></>}
                    {desktop ? <span className="min-w-0 [overflow-wrap:anywhere]">{row.change}</span> : row.change}
                  </span>
                )
                const difference = row.difference && <span className={`mt-1 block min-w-0 break-words [overflow-wrap:anywhere] text-xs font-normal ${metricLabelColor}`}>{row.difference}</span>
                return (
                  <tr key={row.label} role="row" className="mb-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-3 border-t border-slab-border py-4 last:mb-0 lg:row-span-4 lg:grid-cols-1 lg:grid-rows-subgrid lg:mb-0 lg:border-t-0 lg:px-4 lg:py-3 first:lg:pl-0 last:lg:pr-0">
                    <th scope="row" role="rowheader" className="col-span-2 min-w-0 text-left font-medium max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_fit-content(50%)] max-lg:items-center max-lg:gap-x-2 lg:col-span-1">
                      <span className="min-w-0 break-words">{row.label}</span>{!desktop && change}
                    </th>
                    <td role="cell" className="min-w-0 break-words [overflow-wrap:anywhere] tabular-nums align-top">
                      <span className={`mb-1 block text-xs font-normal ${metricLabelColor}`}>Current</span>
                      <span className="block min-w-0 break-words [overflow-wrap:anywhere] text-lg font-semibold leading-tight text-primary">{row.current}</span>
                      {!desktop && difference}
                    </td>
                    <td role="cell" className="min-w-0 break-words [overflow-wrap:anywhere] tabular-nums align-top">
                      <span className={`mb-1 block text-xs font-normal ${metricLabelColor}`}>Previous</span>
                      <span className="block min-w-0 break-words [overflow-wrap:anywhere] text-sm font-normal text-primary">{row.previous}</span>
                    </td>
                    {desktop && (
                      <td role="cell" className="min-w-0 pt-2 tabular-nums">
                        <span className={`mb-1 block text-xs ${metricLabelColor}`}>Change</span>
                        {change}
                        {difference}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-slab-secondary">Weighted session price requires complete session cost and billed energy coverage. Price change is current minus previous.</p>
          {(comparison.spending.status === 'up-from-zero' || comparison.energy.status === 'up-from-zero') && <p className="text-xs text-slab-secondary">Percentage change is unavailable when the previous value is zero.</p>}
        </>}
    </Slab>
  )
}
