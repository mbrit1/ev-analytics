import { useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh, formatMonthLabel, formatCtPerKwhAsEuroAmount } from '../../../shared/lib'
import type { AnalyticsPeriod, AnalyticsPeriodPreset, PreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import type { MetricChange, NoComparisonData, PreviousPeriodComparison } from '../model/previousPeriodComparison'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { AnalyticsInfoDisclosure } from './AnalyticsInfoDisclosure'
import { PeriodComparisonContent, type PeriodComparisonMetric } from './PeriodComparisonSlab'
import { formatAnalyticsPeriodRange } from './analyticsPeriodLabels'

/** Selected-period summary state and the established session-entry action. */
export interface MonthlySessionSpendSlabProps {
  period: AnalyticsPeriod
  previousPeriod: PreviousAnalyticsPeriod
  result: MonthlySessionSpendResult
  previousResult: MonthlySessionSpendResult
  comparison: PreviousPeriodComparison | NoComparisonData
  /** Selects the Summary composition used by the app shell. */
  layoutMode: AnalyticsLayoutMode
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

const ZERO_SPENDING_BASELINE_NOTE = 'Percentage change is unavailable when previous spending is zero.'

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
export function MonthlySessionSpendSlab({ period, previousPeriod, result, previousResult, comparison, layoutMode, isLoading, error = null, onAddSession }: MonthlySessionSpendSlabProps) {
  const isMobile = layoutMode === 'bottom-dock'
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
  const comparisonId = `${id}-comparison`
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [comparisonMetric, setComparisonMetric] = useState<PeriodComparisonMetric>('price')
  const comparisonTriggerRef = useRef<HTMLButtonElement>(null)
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null)
  const methodologyFocusFallback = useMemo(() => ({
    get current() {
      return comparisonTriggerRef.current ?? summaryHeadingRef.current
    },
  }), [])
  const currentCoverage = energyCoverage(result)
  const previousCoverage = energyCoverage(previousResult)
  const previousEnergy = previousResult.billedEnergyKwh === null
    ? 'Unavailable'
    : `${previousCoverage ? 'Known ' : ''}${energy(previousResult.billedEnergyKwh)}`
  const compared = comparison.status === 'compared'
  const zeroBaseline = compared && (comparison.spending.status === 'up-from-zero'
    || (comparison.spending.status === 'no-change' && previousResult.totalSessionSpendCents === 0))
  const [spendingMetric, energyMetric, priceMetric] = [
    {
      label: 'Session spend',
      value: result.totalSessionSpendCents === null ? null : formatCurrency(result.totalSessionSpendCents),
      change: additiveChange(comparison.spending, result.totalSessionSpendCents, previousResult.totalSessionSpendCents, formatCurrency),
      previous: previousResult.totalSessionSpendCents === null ? 'Unavailable (invalid recorded cost)' : formatCurrency(previousResult.totalSessionSpendCents),
      previousWarning: previousResult.totalSessionSpendCents === null ? 'Previous period has an invalid recorded cost.' : null,
      warning: result.totalSessionSpendCents === null ? 'One or more sessions has an invalid recorded cost.' : null,
    },
    {
      label: 'Billed energy',
      value: result.billedEnergyKwh === null ? null : <>
        {currentCoverage && <span className="text-base font-medium">Known: </span>}
        {formatKwh(result.billedEnergyKwh)} <span className="text-base font-medium">kWh</span>
      </>,
      change: additiveChange(comparison.energy, result.billedEnergyKwh, previousResult.billedEnergyKwh, energy, 0.005),
      previous: previousCoverage ? `${previousEnergy} (${previousCoverage} measured)` : previousEnergy,
      previousWarning: previousCoverage ? `Previous period: billed energy available for ${previousCoverage}.` : null,
      warning: currentCoverage ? `Billed energy available for ${currentCoverage}.` : null,
    },
    {
      label: 'Average session price',
      value: result.averageSessionPriceCtPerKwh === null ? null : <>{formatCtPerKwhAsEuroAmount(result.averageSessionPriceCtPerKwh, 'de-DE')} <span className="text-base font-medium">€/kWh</span></>,
      change: comparison.priceDifferenceEurPerKwh === null ? 'Change unavailable' : signed(comparison.priceDifferenceEurPerKwh * 100, price, 0.5),
      previous: previousResult.averageSessionPriceCtPerKwh === null ? 'Unavailable' : price(previousResult.averageSessionPriceCtPerKwh),
      previousWarning: null,
      warning: result.averageSessionPriceCtPerKwh === null || (compared && previousResult.averageSessionPriceCtPerKwh === null)
        ? 'Requires valid cost and billed energy for every session.'
        : null,
    },
  ]

  const metrics = isMobile
    ? [priceMetric, spendingMetric, energyMetric]
    : [spendingMetric, energyMetric, priceMetric]

  const hasComparableChange = compared && (
    comparison.priceDifferenceEurPerKwh !== null
    || [comparison.spending, comparison.energy].some(({ status }) => status !== 'unavailable' && status !== 'unequal-day-count')
  )
  const methodology = (
    <AnalyticsInfoDisclosure
      layoutMode={layoutMode}
      heading="How Charging Summary is calculated"
      explanation="Average session price is session spending divided by valid billed energy. Session spend uses recorded session charges, excluding fixed subscription fees. Billed energy is the energy providers bill for, not the energy added to the vehicle battery."
      closeLabel="Close Charging Summary information"
      dismissLabel="Dismiss Charging Summary information"
      triggerKey="charging-summary"
      triggerText={isMobile ? 'How these metrics are calculated' : undefined}
      unmountFocusFallback={methodologyFocusFallback}
    />
  )

  const sessionCount = (
    <p className="text-sm text-slab-secondary">
      {result.sessionCount} {result.sessionCount === 1 ? 'charging session' : 'charging sessions'}
    </p>
  )

  return (
    <Slab padding="none" className={isMobile ? '@container/charging-summary w-full space-y-3 p-5 wrap-anywhere motion-reduce:transition-none' : 'w-full space-y-4 p-5 md:p-8'} aria-busy={isLoading && error === null}>
      <div className={isMobile ? 'flex items-start justify-between gap-2' : 'relative pr-11'}>
        <div className="min-w-0 space-y-1">
          <h2
            ref={summaryHeadingRef}
            tabIndex={-1}
            aria-label={isMobile ? `Charging Summary · ${accessibleScope}` : accessibleScope}
            className="text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/60"
          >
            {isMobile ? 'Charging Summary' : 'Summary'}
          </h2>
        </div>
        {!isMobile && <div className="absolute -top-3 right-0">{methodology}</div>}
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
          {(!isMobile || previousPeriod.isMonthToDateFallback || !compared) && (
            <div className="space-y-1 text-sm text-slab-secondary">
              {!isMobile && <p>{previousLabel}</p>}
              {previousPeriod.isMonthToDateFallback && (
                <p className="text-xs">The previous window extends before the prior month to match {previousPeriod.dayCount} calendar days.</p>
              )}
              {!compared && <p>No comparison data · No sessions in the previous period.</p>}
            </div>
          )}
          <div className={isMobile ? 'grid gap-4 @min-[18rem]/charging-summary:grid-cols-2' : 'grid gap-4 lg:grid-cols-3 lg:gap-6'}>
            {metrics.map((metric, index) => {
              const headingId = `${id}-${index}`
              const isHero = isMobile && metric === priceMetric
              const metricClass = isMobile
                ? `min-w-0 space-y-1 ${isHero ? 'col-span-full' : ''}`
                : 'min-w-0 space-y-1 border-t border-slab-border pt-4 first:border-t-0 first:pt-0 lg:border-t-0 lg:pt-0'
              const mobileValueClass = isHero ? 'text-[2.75rem] leading-none' : 'text-2xl leading-tight'
              const metricValueClass = isMobile ? `font-bold tracking-tight text-primary tabular-nums ${mobileValueClass}` : valueClass
              return (
                <section key={metric.label} aria-labelledby={headingId} className={metricClass}>
                  <h3 id={headingId} className="text-sm font-medium text-slab-secondary">{metric.label}</h3>
                  <p className={metric.value === null ? unavailableClass : metricValueClass}>{metric.value ?? 'Unavailable'}</p>
                  {compared && (
                    <>
                      <p className="text-sm font-medium text-slab-secondary tabular-nums">
                        <span className="sr-only">Compared with previous period: </span>{metric.change}
                      </p>
                      {!isMobile && <p className="text-xs leading-5 text-slab-secondary tabular-nums">Previous: {metric.previous}</p>}
                    </>
                  )}
                  {isMobile && compared && metric.previousWarning && (
                    <p className="text-xs leading-5 text-slab-secondary">{metric.previousWarning}</p>
                  )}
                  {metric.warning && <p className="text-xs leading-5 text-slab-secondary">{metric.warning}</p>}
                  {isMobile && metric === spendingMetric && zeroBaseline && (
                    <p className="text-xs leading-5 text-slab-secondary">{ZERO_SPENDING_BASELINE_NOTE}</p>
                  )}
                </section>
              )
            })}
          </div>
          <div>
            <div className="space-y-2 border-t border-slab-border pt-3">
              {isMobile ? (
                <div className="-mt-2">
                  {hasComparableChange && <p className="pt-1 text-xs text-slab-secondary">vs previous period</p>}
                  <div className="flex flex-wrap items-center justify-between gap-x-3">
                    {sessionCount}
                    <button
                      ref={comparisonTriggerRef}
                      type="button"
                      aria-expanded={comparisonOpen}
                      aria-controls={comparisonId}
                      onClick={(event) => {
                        if (comparisonOpen) event.currentTarget.focus({ preventScroll: true })
                        setComparisonOpen(!comparisonOpen)
                      }}
                      className="flex min-h-[44px] min-w-[44px] max-w-full items-center gap-1 rounded-lg px-1 text-left text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="min-w-0">Compare periods</span>
                      <ChevronDown className={`size-4 shrink-0 ${comparisonOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : sessionCount}
              {!isMobile && zeroBaseline && <p className="text-xs text-slab-secondary">{ZERO_SPENDING_BASELINE_NOTE}</p>}
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
            {isMobile && (
              <div id={comparisonId} hidden={!comparisonOpen} className="mt-3">
                {comparisonOpen && (
                  <>
                    <PeriodComparisonContent
                      orientation="horizontal"
                      period={period}
                      previousPeriod={previousPeriod}
                      result={result}
                      previousResult={previousResult}
                      isLoading={false}
                      metric={comparisonMetric}
                      onMetricChange={setComparisonMetric}
                    />
                    <div className="mt-2">{methodology}</div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Slab>
  )
}
