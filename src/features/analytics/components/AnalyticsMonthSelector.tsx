import { useId, useLayoutEffect, useRef } from 'react'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import type { AnalyticsPeriod, CalendarMonth, AnalyticsPeriodSelection } from '../model/analyticsPeriods'
import { formatMonthLabel } from '../../../shared/lib'
import { AnalyticsDesktopPeriodSelector } from './AnalyticsDesktopPeriodSelector'
import { AnalyticsMobilePeriodSelector } from './AnalyticsMobilePeriodSelector'
import { formatAnalyticsPeriodRange } from './analyticsPeriodLabels'

/** Props for selecting an Analytics period and navigating calendar months. */
export interface AnalyticsMonthSelectorProps {
  selection: AnalyticsPeriodSelection
  period: AnalyticsPeriod
  selectedMonth: CalendarMonth
  currentMonth: CalendarMonth
  onChange: (selection: AnalyticsPeriodSelection) => void
  layoutMode?: AnalyticsLayoutMode
}

/** Selects a trailing preset or a historical calendar month. */
export function AnalyticsMonthSelector({
  selection,
  period,
  selectedMonth,
  currentMonth,
  onChange,
  layoutMode = 'bottom-dock',
}: AnalyticsMonthSelectorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rangeId = useId()
  const lastFocusedControl = useRef<{ element: HTMLElement; identity: string | null } | null>(null)

  // Responsive composition replaces controls; restore focus only when the replaced control owned it.
  useLayoutEffect(() => {
    const previous = lastFocusedControl.current
    if (!previous || previous.element.isConnected || document.activeElement !== document.body) return

    queueMicrotask(() => {
      const root = rootRef.current
      if (!root?.isConnected || document.activeElement !== document.body) return
      const replacement = previous.identity
        ? root.querySelector<HTMLButtonElement>(`button[data-analytics-period-control="${previous.identity}"]`)
        : null
      replacement?.focus()
    })
  }, [layoutMode])

  const captureFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const control = target.closest<HTMLElement>('[data-analytics-period-control]')
    lastFocusedControl.current = { element: target, identity: control?.dataset.analyticsPeriodControl ?? null }
  }

  const clearFocusWhenLeaving = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      lastFocusedControl.current = null
    }
  }
  const progressLabel = period.isInProgress
    ? selection.kind === 'month' ? 'Month to date · In progress' : 'In progress'
    : selection.kind === 'month' ? 'Completed month' : 'Completed period'
  const rangeDescription = (
    <p id={rangeId} className={layoutMode === 'sidebar'
      ? 'min-w-0 basis-64 grow text-xs leading-5 text-secondary'
      : 'mt-1 text-center text-xs text-secondary'}>
      {formatAnalyticsPeriodRange(period)} · {progressLabel}
    </p>
  )

  return (
    <div ref={rootRef} onFocusCapture={captureFocus} onBlurCapture={clearFocusWhenLeaving} className={layoutMode === 'sidebar' ? 'w-full' : 'mx-auto w-full max-w-2xl'}>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{selection.kind === 'month' ? `Selected month: ${formatMonthLabel(selectedMonth.year, selectedMonth.month)}` : ''}</span>
      {layoutMode === 'sidebar' ? (
        <AnalyticsDesktopPeriodSelector
          selection={selection}
          selectedMonth={selectedMonth}
          currentMonth={currentMonth}
          onChange={onChange}
          rangeDescriptionId={rangeId}
          rangeDescription={rangeDescription}
        />
      ) : (
        <AnalyticsMobilePeriodSelector
          selection={selection}
          selectedMonth={selectedMonth}
          currentMonth={currentMonth}
          onChange={onChange}
          rangeDescriptionId={rangeId}
        />
      )}
      {layoutMode === 'bottom-dock' && rangeDescription}
    </div>
  )
}
