import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { getCalendarMonth } from '../model/analyticsPeriods'
import { useMonthlySessionSpend } from '../hooks/useMonthlySessionSpend'
import { AnalyticsMonthSelector } from './AnalyticsMonthSelector'
import { MonthlySessionSpendSlab } from './MonthlySessionSpendSlab'

/** Props for the initial Analytics page. */
export interface AnalyticsPageProps {
  onAddSession: () => void
}

/** Monthly session-spend analytics route composed from local-first data. */
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
    <section className="space-y-6" aria-labelledby="analytics-heading">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-accent" aria-hidden="true" />
        <h1 id="analytics-heading" className="text-2xl font-bold tracking-tight text-primary">Analytics</h1>
      </div>
      <AnalyticsMonthSelector
        value={selectedMonth}
        currentMonth={currentMonth}
        onChange={setSelectedMonth}
      />
      <MonthlySessionSpendSlab
        month={selectedMonth}
        result={result}
        isLoading={isLoading}
        onAddSession={onAddSession}
      />
    </section>
  )
}
