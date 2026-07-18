import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getCalendarMonth } from '../model/analyticsPeriods'
import { useAnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { useOverallChargingPrice } from '../hooks/useOverallChargingPrice'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'
import { ANALYTICS_VIEW_IDS } from './analyticsViewIds'
import { AnalyticsViewSelector, type AnalyticsView } from './AnalyticsViewSelector'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'
import { OverallPriceSlab } from './OverallPriceSlab'

/** Props for the responsive Analytics route composition. */
export interface AnalyticsPageProps {
  /** Opens the established session-entry flow. */
  onAddSession: () => void
  /** Opens tariff management; Task 10 supplies the app-level destination. */
  onReviewTariffs?: () => void
}

function formatLocalDateKey(value: Date): string {
  const year = `${value.getFullYear()}`.padStart(4, '0')
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Monthly and lifetime Analytics route composed from local-first query state. */
export function AnalyticsPage({
  onAddSession,
  onReviewTariffs = () => {},
}: AnalyticsPageProps) {
  const [now, setNow] = useState(() => new Date())
  const currentMonth = getCalendarMonth(now)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [mobileView, setMobileView] = useState<AnalyticsView>('overview')
  const layoutMode = useAnalyticsLayoutMode()
  const previousLayoutMode = useRef(layoutMode)
  const sidebarContentRef = useRef<HTMLDivElement>(null)
  const previousFocusWasInSidebar = useRef(false)
  const selectorContainerRef = useRef<HTMLDivElement>(null)
  const { result: monthlyResult, isLoading: isMonthlyLoading } = useMonthlySessionSpend(selectedMonth, now)
  const overallPriceQuery = useOverallChargingPrice(formatLocalDateKey(now))

  useEffect(() => {
    const nextDay = new Date(now)
    nextDay.setHours(24, 0, 0, 0)
    const timeoutId = window.setTimeout(
      () => setNow(new Date()),
      nextDay.getTime() - now.getTime(),
    )

    return () => window.clearTimeout(timeoutId)
  }, [now])

  useLayoutEffect(() => {
    const enteredBottomDock = previousLayoutMode.current === 'sidebar'
      && layoutMode === 'bottom-dock'
    if (enteredBottomDock && previousFocusWasInSidebar.current) {
      selectorContainerRef.current
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus()
      previousFocusWasInSidebar.current = false
    }
    previousLayoutMode.current = layoutMode
  }, [layoutMode])

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
    />
  )
  const monthlyContent = (
    <>
      <div className="min-[900px]:pb-7">
        <AnalyticsMonthSelector
          value={selectedMonth}
          currentMonth={currentMonth}
          onChange={setSelectedMonth}
        />
      </div>
      <MonthlySessionSpendSlab
        month={selectedMonth}
        result={monthlyResult}
        isLoading={isMonthlyLoading}
        onAddSession={onAddSession}
      />
    </>
  )

  return (
    <section
      className="mx-auto w-full space-y-3 md:max-w-xl md:space-y-5 min-[900px]:!max-w-[760px] min-[900px]:space-y-0 min-[900px]:pb-16 min-[900px]:pt-[clamp(8px,2vh,24px)]"
      aria-labelledby="analytics-heading"
    >
      <div className="min-[900px]:pb-3">
        <h1
          id="analytics-heading"
          className="text-xl font-bold tracking-tight text-primary md:text-center md:text-2xl"
        >
          Analytics
        </h1>
      </div>
      {layoutMode === 'sidebar' ? (
        <div
          ref={sidebarContentRef}
          className="contents"
          onFocusCapture={() => {
            previousFocusWasInSidebar.current = true
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              previousFocusWasInSidebar.current = false
            }
          }}
        >
          <section className="min-[900px]:pb-7" aria-label="Overall price">
            {overallContent}
          </section>
          <section aria-label="Monthly analytics">
            {monthlyContent}
          </section>
        </div>
      ) : (
        <>
          <div ref={selectorContainerRef}>
            <AnalyticsViewSelector value={mobileView} onChange={setMobileView} />
          </div>
          {mobileView === 'overview' ? (
            <section
              id={ANALYTICS_VIEW_IDS.overview.panel}
              role="tabpanel"
              aria-labelledby={ANALYTICS_VIEW_IDS.overview.tab}
            >
              {overallContent}
            </section>
          ) : (
            <section
              id={ANALYTICS_VIEW_IDS.monthly.panel}
              role="tabpanel"
              aria-labelledby={ANALYTICS_VIEW_IDS.monthly.tab}
            >
              {monthlyContent}
            </section>
          )}
        </>
      )}
    </section>
  )
}
