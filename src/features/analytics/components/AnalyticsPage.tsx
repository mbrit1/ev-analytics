import { useEffect, useState } from 'react'
import { getCalendarMonth } from '../model/analyticsPeriods'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'

/** Props for the initial Analytics page. */
export interface AnalyticsPageProps {
  onAddSession: () => void
}

/** Monthly session-spend and billed-energy analytics route composed from local-first data. */
export function AnalyticsPage({ onAddSession }: AnalyticsPageProps) {
  const [now, setNow] = useState(() => new Date())
  const currentMonth = getCalendarMonth(now)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const { result, isLoading } = useMonthlySessionSpend(selectedMonth, now)

  useEffect(() => {
    const nextDay = new Date(now)
    nextDay.setHours(24, 0, 0, 0)
    const timeoutId = window.setTimeout(
      () => setNow(new Date()),
      nextDay.getTime() - now.getTime(),
    )

    return () => window.clearTimeout(timeoutId)
  }, [now])

  return (
    <section
      className="mx-auto w-full space-y-3 md:max-w-xl md:space-y-5 min-[900px]:!max-w-[760px] min-[900px]:!space-y-0 min-[900px]:pb-16 min-[900px]:pt-[clamp(8px,2vh,24px)]"
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
      <div className="min-[900px]:pb-7">
        <AnalyticsMonthSelector
          value={selectedMonth}
          currentMonth={currentMonth}
          onChange={setSelectedMonth}
        />
      </div>
      <MonthlySessionSpendSlab
        month={selectedMonth}
        result={result}
        isLoading={isLoading}
        onAddSession={onAddSession}
      />
    </section>
  )
}
