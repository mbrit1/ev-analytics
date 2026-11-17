import { useId } from 'react'
import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh, formatMonthLabel, formatCtPerKwhAsEuroAmount } from '../../../shared/lib'
import type { AnalyticsPeriod, AnalyticsPeriodPreset, PreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import type { MetricChange, NoComparisonData, PreviousPeriodComparison } from '../model/previousPeriodComparison'
import { formatAnalyticsPeriodRange } from './analyticsPeriodLabels'

/** Selected-period summary state and the established session-entry action. */
export interface MonthlySessionSpendSlabProps {
  period: AnalyticsPeriod
  previousPeriod: PreviousAnalyticsPeriod
  result: MonthlySessionSpendResult
  previousResult: MonthlySessionSpendResult
  comparison: PreviousPeriodComparison | NoComparisonData
  isLoading: boolean
  error?: unknown | null
  onAddSession: () => void
}

const PRESET_LABELS: Record<AnalyticsPeriodPreset, string> = {
  '7-days': '7 Days',
  '30-days': '30 Days',
  '3-months': '3 Months',
  year: 'Year',
}

const percentFormatter = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const energy = (kwh: number) => `${formatKwh(kwh)} kWh`
const price = (cents: number) => `${formatCtPerKwhAsEuroAmount(cents, 'de-DE')} €/kWh`

function signed(value: number, format: (amount: number) => string, threshold = 0) {
  const shown = Math.abs(value) < threshold ? 0 : value
  return `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${format(Math.abs(shown))}`
}

function additiveChange(change: MetricChange, current: number | null, previous: number | null, format: (amount: number) => string, threshold?: number) {
  if (change.status === 'unequal-day-count') return 'Period lengths differ'
  if (change.status === 'unavailable' || current === null || previous === null) return 'Change unavailable'
  const absolute = signed(current - previous, format, threshold)
  return change.status === 'percentage' && Number.isFinite(change.percentage)
    ? `${absolute} (${signed(change.percentage, (amount) => `${percentFormatter.format(amount)}%`, 0.05)})`
    : absolute
}

function energyCoverage(result: MonthlySessionSpendResult) {
  return !result.isEmpty && result.validBilledEnergySessionCount < result.sessionCount
    ? `${result.validBilledEnergySessionCount} of ${result.sessionCount} sessions`
    : null
}

/** Presents recorded spending, billed energy and their complete-coverage weighted price. */
export function MonthlySessionSpendSlab({ period, previousPeriod, result, previousResult, comparison, isLoading, error = null, onAddSession }: MonthlySessionSpendSlabProps) {
  const selection = period.selection
  const monthLabel = selection.kind === 'month'
    ? formatMonthLabel(selection.month.year, selection.month.month)
    : PRESET_LABELS[selection.preset]
  const scopeStatus = period.isInProgress
    ? selection.kind === 'month' ? 'Month to date, in progress' : 'In progress'
    : selection.kind === 'month' ? 'Completed month' : 'Completed period'
  const accessibleScope = `${monthLabel} summary, ${formatAnalyticsPeriodRange(period)}, ${scopeStatus}`
  const valueClass = 'break-words text-3xl font-bold leading-tight tracking-tight text-primary tabular-nums'
  const unavailableClass = 'text-base font-semibold text-primary'
  const previousLabel = `Previous period · ${formatAnalyticsPeriodRange(previousPeriod)}`
  const id = useId()
  const currentCoverage = energyCoverage(result)
  const previousCoverage = energyCoverage(previousResult)
  const previousEnergy = previousResult.billedEnergyKwh === null
    ? 'Unavailable'
    : `${previousCoverage ? 'Known ' : ''}${energy(previousResult.billedEnergyKwh)}`
  const compared = comparison.status === 'compared'
  const zeroBaseline = compared && (comparison.spending.status === 'up-from-zero'
    || (comparison.spending.status === 'no-change' && previousResult.totalSessionSpendCents === 0))
  const metrics = [
    {
      label: 'Session spend',
      value: result.totalSessionSpendCents === null ? null : formatCurrency(result.totalSessionSpendCents),
      change: additiveChange(comparison.spending, result.totalSessionSpendCents, previousResult.totalSessionSpendCents, formatCurrency),
      previous: previousResult.totalSessionSpendCents === null ? 'Unavailable (invalid recorded cost)' : formatCurrency(previousResult.totalSessionSpendCents),
      note: result.totalSessionSpendCents === null ? 'One or more sessions has an invalid recorded cost.' : 'Recorded session charges. Excludes subscription fees.',
    },
    {
      label: 'Billed energy',
      value: result.billedEnergyKwh === null ? null : <>
        {currentCoverage && <span className="text-base font-medium">Known: </span>}
        {formatKwh(result.billedEnergyKwh)} <span className="text-base font-medium">kWh</span>
      </>,
      change: additiveChange(comparison.energy, result.billedEnergyKwh, previousResult.billedEnergyKwh, energy, 0.005),
      previous: previousCoverage ? `${previousEnergy} (${previousCoverage} measured)` : previousEnergy,
      note: currentCoverage ? `Billed energy available for ${currentCoverage}.` : 'Energy billed by providers, not battery-added energy.',
    },
    {
      label: 'Average session price',
      value: result.averageSessionPriceCtPerKwh === null ? null : <>{formatCtPerKwhAsEuroAmount(result.averageSessionPriceCtPerKwh, 'de-DE')} <span className="text-base font-medium">€/kWh</span></>,
      change: comparison.priceDifferenceEurPerKwh === null ? 'Change unavailable' : signed(comparison.priceDifferenceEurPerKwh * 100, price, 0.5),
      previous: previousResult.averageSessionPriceCtPerKwh === null ? 'Unavailable' : price(previousResult.averageSessionPriceCtPerKwh),
      note: result.averageSessionPriceCtPerKwh === null || (compared && previousResult.averageSessionPriceCtPerKwh === null)
        ? 'Requires valid cost and billed energy for every session.'
        : 'Session spend divided by billed energy.',
    },
  ]

  return (
    <Slab padding="none" className="w-full space-y-4 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="space-y-1">
        <h2 aria-label={accessibleScope} className="text-sm font-semibold text-primary">
          Summary
        </h2>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load the summary. Please try again.</p>
      ) : isLoading ? (
        <div role="status">
          <span className="sr-only">Loading summary</span>
          <div aria-hidden="true" className="h-24 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" />
        </div>
      ) : (
        <>
          <div className="space-y-1 text-sm text-slab-secondary">
            <p>{previousLabel}</p>
            {previousPeriod.isMonthToDateFallback && (
              <p className="text-xs">The previous window extends before the prior month to match {previousPeriod.dayCount} calendar days.</p>
            )}
            {!compared && <p>No comparison data · No sessions in the previous period.</p>}
          </div>
          <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
            {metrics.map((metric, index) => {
              const headingId = `${id}-${index}`
              return (
                <section key={metric.label} aria-labelledby={headingId} className="min-w-0 space-y-1 border-t border-slab-border pt-4 first:border-t-0 first:pt-0 lg:border-t-0 lg:pt-0">
                  <h3 id={headingId} className="text-sm font-medium text-slab-secondary">{metric.label}</h3>
                  <p className={metric.value === null ? unavailableClass : valueClass}>{metric.value ?? 'Unavailable'}</p>
                  {compared && (
                    <>
                      <p className="text-sm font-medium text-slab-secondary tabular-nums">
                        <span className="sr-only">Compared with previous period: </span>{metric.change}
                      </p>
                      <p className="text-xs leading-5 text-slab-secondary tabular-nums">Previous: {metric.previous}</p>
                    </>
                  )}
                  <p className="text-xs leading-5 text-slab-secondary">{metric.note}</p>
                </section>
              )
            })}
          </div>
          <div className="space-y-2 border-t border-slab-border pt-3">
            <p className="text-sm text-slab-secondary">
              {result.sessionCount} {result.sessionCount === 1 ? 'charging session' : 'charging sessions'}
            </p>
            {zeroBaseline && <p className="text-xs text-slab-secondary">Percentage change is unavailable when previous spending is zero.</p>}
            {result.isEmpty && (
              <>
                <p className="text-sm text-slab-secondary">No charging sessions recorded for this {selection.kind === 'month' ? 'month' : 'period'}{period.isInProgress ? ' yet' : ''}. Billed energy and average price are unavailable.</p>
                {period.isInProgress && (
                  <button type="button" onClick={onAddSession} className="min-h-11 rounded-xl bg-accent px-4 py-2 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                    Add Session
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Slab>
  )
}
