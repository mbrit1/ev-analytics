import { useEffect, useMemo, useState } from 'react'
import { createAnalyticsPeriod, createPreviousAnalyticsPeriod, getCalendarMonth, type AnalyticsPeriodSelection } from '../model/analyticsPeriods'
import { useAnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { useOverallChargingPrice } from '../hooks/useOverallChargingPrice'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'
import { PeriodComparisonSlab, type PeriodComparisonMetric } from './PeriodComparisonSlab'
import { OverallPriceSlab } from './OverallPriceSlab'
import { BillingProviderBreakdownSlab } from './BillingProviderBreakdownSlab'

/** Props for the responsive Analytics route composition. */
export interface AnalyticsPageProps {
  /** Opens the established session-entry flow. */
  onAddSession: () => void
  /** Opens the established tariff-management destination. */
  onReviewTariffs?: () => void
}

function formatLocalDateKey(value: Date): string {
  const year = `${value.getFullYear()}`.padStart(4, '0')
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Selected-period and lifetime Analytics route composed from local-first query state. */
export function AnalyticsPage({
  onAddSession,
  onReviewTariffs = () => {},
}: AnalyticsPageProps) {
  const [now, setNow] = useState(() => new Date())
  const currentMonth = getCalendarMonth(now)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [selection, setSelection] = useState<AnalyticsPeriodSelection>(() => ({ kind: 'month', month: currentMonth }))
  const [chartMetric, setChartMetric] = useState<PeriodComparisonMetric>('spending')
  const period = useMemo(() => createAnalyticsPeriod(selection, now), [selection, now])
  const previousPeriod = useMemo(() => createPreviousAnalyticsPeriod(period), [period])
  const layoutMode = useAnalyticsLayoutMode()
  const {
    result: monthlyResult,
    previousResult,
    comparison,
    providerBreakdown,
    isLoading: isMonthlyLoading,
    error: monthlyError,
  } = useMonthlySessionSpend(period, previousPeriod)
  const overallPriceQuery = useOverallChargingPrice(formatLocalDateKey(now))

  useEffect(() => {
    const nextDay = new Date(now)
    nextDay.setHours(24, 0, 0, 0)
    const timeoutId = window.setTimeout(
      () => {
        setNow(new Date())
      },
      nextDay.getTime() - now.getTime(),
    )

    return () => window.clearTimeout(timeoutId)
  }, [now])

  const overallContent = overallPriceQuery.status === 'error' ? (
    <div role="alert" className="p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
      Unable to calculate Overall Price right now. Please try again.
    </div>
  ) : (
    <OverallPriceSlab
      result={overallPriceQuery.status === 'success' ? overallPriceQuery.result : { status: 'empty' }}
      isLoading={overallPriceQuery.status === 'loading'}
      onAddSession={onAddSession}
      onReviewTariffs={onReviewTariffs}
      layoutMode={layoutMode}
    />
  )
  return (
    <section
      className="@container mx-auto w-full min-w-0 space-y-5 pb-8 md:space-y-6"
      aria-labelledby="analytics-heading"
    >
      <h1 id="analytics-heading" className="text-xl font-bold tracking-tight text-primary md:text-2xl">
        Analytics
      </h1>
      <AnalyticsMonthSelector
        selection={selection}
        period={period}
        selectedMonth={selectedMonth}
        currentMonth={currentMonth}
        layoutMode={layoutMode}
        onChange={(nextSelection) => {
          if (nextSelection.kind === 'month') setSelectedMonth(nextSelection.month)
          setSelection(nextSelection)
        }}
      />
      <section aria-label="Selected-period analytics" className="space-y-4">
        <MonthlySessionSpendSlab
          period={period}
          previousPeriod={previousPeriod}
          result={monthlyResult}
          previousResult={previousResult}
          comparison={comparison}
          layoutMode={layoutMode}
          isLoading={isMonthlyLoading}
          error={monthlyError}
          onAddSession={onAddSession}
        />
      </section>
      {layoutMode === 'sidebar' ? (
        <div className="grid min-w-0 gap-6 @min-[68rem]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] @min-[68rem]:items-start">
          <div className="min-w-0">
            <PeriodComparisonSlab
              period={period}
              previousPeriod={previousPeriod}
              result={monthlyResult}
              previousResult={previousResult}
              isLoading={isMonthlyLoading}
              error={monthlyError}
              metric={chartMetric}
              onMetricChange={setChartMetric}
            />
          </div>
          <div className="min-w-0">
            <BillingProviderBreakdownSlab breakdown={providerBreakdown} isLoading={isMonthlyLoading} error={monthlyError} layoutMode={layoutMode} />
          </div>
        </div>
      ) : (
        <BillingProviderBreakdownSlab breakdown={providerBreakdown} isLoading={isMonthlyLoading} error={monthlyError} layoutMode={layoutMode} />
      )}
      <section aria-label="Lifetime Overall Price" className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-slab-secondary">Lifetime · All recorded sessions</p>
        {overallContent}
      </section>
    </section>
  )
}
