import { useLayoutEffect, useRef } from 'react'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import type { CalendarMonth, AnalyticsPeriodSelection } from '../model/analyticsPeriods'
import { AnalyticsDesktopPeriodSelector } from './AnalyticsDesktopPeriodSelector'
import { AnalyticsMobilePeriodSelector } from './AnalyticsMobilePeriodSelector'

/** Props for selecting an Analytics period and navigating calendar months. */
export interface AnalyticsMonthSelectorProps {
  selection: AnalyticsPeriodSelection
  selectedMonth: CalendarMonth
  currentMonth: CalendarMonth
  onChange: (selection: AnalyticsPeriodSelection) => void
  layoutMode?: AnalyticsLayoutMode
}

/** Selects a trailing preset or a historical calendar month. */
export function AnalyticsMonthSelector({
  selection,
  selectedMonth,
  currentMonth,
  onChange,
  layoutMode = 'bottom-dock',
}: AnalyticsMonthSelectorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const lastFocusedControl = useRef<HTMLButtonElement | null>(null)

  // Responsive composition replaces buttons; retain focus on the equivalent month arrow.
  useLayoutEffect(() => {
    const previousControl = lastFocusedControl.current
    const label = previousControl?.getAttribute('aria-label')
    if (previousControl && !previousControl.isConnected && document.activeElement === document.body
      && (label === 'Previous month' || label === 'Next month')) {
      rootRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus()
    }
  }, [layoutMode])

  const captureFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    lastFocusedControl.current = event.target instanceof HTMLButtonElement ? event.target : null
  }

  if (layoutMode === 'sidebar') {
    return (
      <div ref={rootRef} onFocusCapture={captureFocus} className="w-full">
        <AnalyticsDesktopPeriodSelector
          selection={selection}
          selectedMonth={selectedMonth}
          currentMonth={currentMonth}
          onChange={onChange}
        />
      </div>
    )
  }

  return (
    <div ref={rootRef} onFocusCapture={captureFocus} className="mx-auto w-full max-w-2xl">
      <AnalyticsMobilePeriodSelector
        selection={selection}
        selectedMonth={selectedMonth}
        currentMonth={currentMonth}
        onChange={onChange}
      />
    </div>
  )
}
