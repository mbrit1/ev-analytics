import { useId } from 'react'
import { Slab } from '../../../shared/ui'
import { formatCurrency, formatCtPerKwhAsEuroAmount, formatKwh } from '../../../shared/lib'
import type { AnalyticsPeriod, PreviousAnalyticsPeriod } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'
import { formatAnalyticsPeriodRange } from './analyticsPeriodLabels'

/** Metric shown for both windows. */
export type PeriodComparisonMetric = 'spending' | 'energy' | 'price'

/** Inputs for the selected and immediately previous period comparison chart. */
export interface PeriodComparisonSlabProps {
  period: AnalyticsPeriod
  previousPeriod: PreviousAnalyticsPeriod
  result: MonthlySessionSpendResult
  previousResult: MonthlySessionSpendResult
  isLoading: boolean
  error?: unknown | null
  metric: PeriodComparisonMetric
  onMetricChange: (metric: PeriodComparisonMetric) => void
}

interface MetricValue {
  amount: number | null
  text: string
}

function getMetricValue(result: MonthlySessionSpendResult, metric: PeriodComparisonMetric): MetricValue {
  if (result.isEmpty) return { amount: null, text: 'No sessions' }
  if (metric === 'spending') {
    return result.totalSessionSpendCents === null
      ? { amount: null, text: 'Unavailable: at least one session has an invalid recorded cost' }
      : { amount: result.totalSessionSpendCents, text: formatCurrency(result.totalSessionSpendCents) }
  }
  if (metric === 'energy') {
    if (result.billedEnergyKwh === null) {
      return { amount: null, text: `Unavailable: no valid billed energy, 0 of ${result.sessionCount} sessions` }
    }
    const partial = result.validBilledEnergySessionCount < result.sessionCount
      ? ` · Partial coverage: ${result.validBilledEnergySessionCount} of ${result.sessionCount} sessions`
      : ''
    return { amount: result.billedEnergyKwh, text: `${partial ? 'Known: ' : ''}${formatKwh(result.billedEnergyKwh)} kWh${partial}` }
  }
  return result.averageSessionPriceCtPerKwh === null
    ? { amount: null, text: `Unavailable: complete valid cost and billed energy coverage required for all ${result.sessionCount} ${result.sessionCount === 1 ? 'session' : 'sessions'}` }
    : { amount: result.averageSessionPriceCtPerKwh / 100, text: `${formatCtPerKwhAsEuroAmount(result.averageSessionPriceCtPerKwh, 'de-DE')} €/kWh` }
}

function formatRange(period: Pick<AnalyticsPeriod, 'startUtc' | 'endUtc'> | PreviousAnalyticsPeriod, inProgress = false): string {
  return `${formatAnalyticsPeriodRange(period)}${inProgress ? ' · In progress' : ''}`
}

/** Displays the desktop comparison in its own slab. */
export function PeriodComparisonSlab(props: PeriodComparisonSlabProps) {
  return <PeriodComparisonContent {...props} orientation="vertical" />
}

interface PeriodComparisonContentProps extends PeriodComparisonSlabProps {
  orientation: 'horizontal' | 'vertical'
}

/** Compares the same period aggregates in either layout. */
export function PeriodComparisonContent({
  period, previousPeriod, result, previousResult, isLoading, error = null, metric, onMetricChange, orientation,
}: PeriodComparisonContentProps) {
  const id = useId()
  const options: PeriodComparisonMetric[] = ['spending', 'energy', 'price']
  const values = error !== null || isLoading ? null : [getMetricValue(previousResult, metric), getMetricValue(result, metric)]
  const maximum = values ? Math.max(0, ...values.map(({ amount }) => amount ?? 0)) : 0
  const labels = ['Previous period', 'Selected period'] as const
  const periods = [previousPeriod, period] as const

  const plotHorizontalBars = maximum > 0 && values?.every(({ amount }) => amount !== null)
  const horizontal = orientation === 'horizontal'
  const Heading = horizontal ? 'h3' : 'h2'
  const content = (
    <>
      <div className="grid min-w-0 gap-3">
        <Heading id={id} className="text-sm font-semibold text-primary">Period comparison</Heading>
        <fieldset className="min-w-0">
          <legend className="sr-only">Chart metric</legend>
          <div role="radiogroup" aria-label="Chart metric" className={`grid w-full gap-1 rounded-2xl bg-environment p-1 ${horizontal ? 'grid-cols-1 @min-[12rem]/charging-summary:grid-cols-3' : 'grid-cols-3 md:max-w-[420px]'}`}>
            {options.map((option) => {
              const selected = metric === option
              const label = option === 'spending' ? 'Spending' : option === 'energy' ? 'Energy' : 'Price/kWh'
              return <label key={option} className={`relative flex ${horizontal ? 'min-h-[44px] min-w-[44px]' : 'min-h-11 min-w-11'} cursor-pointer items-center justify-center rounded-xl px-1 text-center text-xs leading-tight transition-colors sm:text-sm motion-reduce:transition-none focus-within:outline-none focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent ${selected ? 'bg-[#1D1D1F] text-white dark:bg-white dark:text-[#1D1D1F]' : 'text-primary dark:text-secondary'}`}>
                <input type="radio" name={`period-comparison-metric-${id}`} value={option} checked={selected} onChange={() => onMetricChange(option)} className="peer sr-only" />
                <span className="pointer-events-none [overflow-wrap:anywhere] peer-focus-visible:underline">{label}</span>
              </label>
            })}
          </div>
        </fieldset>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load the period comparison. Please try again.</p>
      ) : isLoading ? (
        <div role="status"><span className="sr-only">Loading period comparison</span><div aria-hidden="true" className="h-28 rounded-xl bg-secondary/10 motion-safe:animate-pulse motion-reduce:animate-none" /></div>
      ) : values && (horizontal ? (
        <div className="space-y-3">
          {values.map(({ amount, text }, index) => {
            const headingId = `${id}-period-${index}`
            return (
              <section key={labels[index]} aria-labelledby={headingId} className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  <h4 id={headingId} className="font-medium text-primary">{labels[index]}</h4>
                  <p className="font-semibold text-primary tabular-nums">{text}</p>
                </div>
                <p className="text-xs text-slab-secondary">{formatRange(periods[index], index === 1 && period.isInProgress)}</p>
                {amount !== null && plotHorizontalBars && (
                  <div aria-hidden="true" className="h-2 w-full rounded-full bg-secondary/10">
                    <div className={`h-full rounded-full ${index === 0 ? 'bg-slab-secondary' : 'bg-accent'}`} style={{ width: `${amount / maximum * 100}%` }} />
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="mx-auto grid max-w-md grid-cols-2 gap-y-2 text-center">
          {values.map(({ amount, text }, index) => {
            const headingId = `${id}-period-${index}`
            const color = index === 0 ? 'bg-slab-secondary' : 'bg-accent'
            return (
              <section key={labels[index]} aria-labelledby={headingId} className="row-span-3 grid min-w-0 grid-rows-subgrid">
                <p className="self-end px-1 text-sm font-semibold wrap-anywhere text-primary tabular-nums">{text}</p>
                <div aria-hidden="true" className={maximum > 0 ? 'flex h-18 items-end justify-center border-b border-slab-border @min-[68rem]:h-36' : 'h-0'}>
                  {amount !== null && amount > 0 && (
                    <div className={`w-3/5 max-w-24 rounded-t-lg ${color}`} style={{ height: `${amount / maximum * 100}%` }} />
                  )}
                </div>
                <div className="row-start-3 min-w-0 px-1 text-xs leading-5">
                  <h3 id={headingId} className="font-medium text-primary">{labels[index]}</h3>
                  <p className="text-slab-secondary">{formatRange(periods[index], index === 1 && period.isInProgress)}</p>
                </div>
              </section>
            )
          })}
        </div>
      ))}
    </>
  )

  return horizontal ? (
    <section aria-labelledby={id} className="space-y-4 border-t border-slab-border pt-3">
      {content}
    </section>
  ) : (
    <Slab role="region" aria-labelledby={id} padding="none" className="w-full space-y-4 p-5 motion-reduce:transition-none md:p-8" aria-busy={isLoading && error === null}>
      {content}
    </Slab>
  )
}
