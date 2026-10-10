import { useEffect, useMemo, useState } from 'react'
import { createAnalyticsPeriod, getCalendarMonth, type AnalyticsPeriodSelection } from '../model/analyticsPeriods'
import { useAnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { useOverallChargingPrice } from '../hooks/useOverallChargingPrice'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'
import { SessionSpendingTrendSlab } from './SessionSpendingTrendSlab'
import { OverallPriceSlab } from './OverallPriceSlab'

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
  const period = useMemo(() => createAnalyticsPeriod(selection, now), [selection, now])
  const layoutMode = useAnalyticsLayoutMode()
  const { result: monthlyResult, trend, isLoading: isMonthlyLoading, error: monthlyError } = useMonthlySessionSpend(period)
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
      className="mx-auto w-full max-w-3xl space-y-5 pb-8 md:space-y-6"
      aria-labelledby="analytics-heading"
    >
      <h1 id="analytics-heading" className="text-xl font-bold tracking-tight text-primary md:text-2xl">
        Analytics
      </h1>
      <AnalyticsMonthSelector
        selection={selection}
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
          result={monthlyResult}
          isLoading={isMonthlyLoading}
          error={monthlyError}
          onAddSession={onAddSession}
        />
        {trend !== null && (
          <SessionSpendingTrendSlab
            period={period}
            trend={trend}
            isLoading={isMonthlyLoading}
            error={monthlyError}
          />
        )}
      </section>
      <section aria-label="Lifetime Overall Price" className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-secondary">Lifetime · All recorded sessions</p>
        {overallContent}
      </section>
    </section>
  )
}
