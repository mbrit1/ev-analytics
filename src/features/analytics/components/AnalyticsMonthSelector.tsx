import { useLayoutEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthLabel } from '../../../shared/lib'
import { TactileMatrix } from '../../../shared/ui'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import {
  type AnalyticsPeriodPreset,
  type CalendarMonth,
  type AnalyticsPeriodSelection,
  compareCalendarMonths,
  shiftCalendarMonth,
} from '../model/analyticsPeriods'
import { AnalyticsDesktopPeriodSelector } from './AnalyticsDesktopPeriodSelector'

/** Props for selecting an Analytics period and navigating calendar months. */
export interface AnalyticsMonthSelectorProps {
  selection: AnalyticsPeriodSelection
  selectedMonth: CalendarMonth
  currentMonth: CalendarMonth
  onChange: (selection: AnalyticsPeriodSelection) => void
  layoutMode?: AnalyticsLayoutMode
}

const PRESETS: { value: AnalyticsPeriodPreset; label: string }[] = [
  { value: '7-days', label: '7 Days' },
  { value: '30-days', label: '30 Days' },
  { value: '3-months', label: '3 Months' },
  { value: 'year', label: 'Year' },
]

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

  const isCurrentMonth = compareCalendarMonths(selectedMonth, currentMonth) >= 0
  const isMonthSelected = selection.kind === 'month'
  const selectedValue = selection.kind === 'month' ? 'month' : selection.preset

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
    <div ref={rootRef} onFocusCapture={captureFocus} className="mx-auto w-full max-w-2xl space-y-3">
      <TactileMatrix
        label="Analytics period"
        options={[{ value: 'month', label: 'Calendar Month' }, ...PRESETS]}
        value={selectedValue}
        onChange={(value) => onChange(value === 'month'
          ? { kind: 'month', month: selectedMonth }
          : { kind: 'preset', preset: value as AnalyticsPeriodPreset })}
      />
      {isMonthSelected && (
        <div role="group" aria-label="Analytics month" className="mx-auto grid w-full max-w-72 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:max-w-sm">
          <button
            type="button"
            onClick={() => onChange({ kind: 'month', month: shiftCalendarMonth(selectedMonth, -1) })}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-secondary transition-[background-color,color,transform] duration-150 hover:bg-slab-border/50 hover:text-primary active:scale-95 active:bg-slab-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-environment motion-reduce:transition-none motion-reduce:active:scale-100"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="min-w-0 text-center text-base font-semibold text-primary" aria-live="polite">
            {formatMonthLabel(selectedMonth.year, selectedMonth.month)}
          </p>
          <button
            type="button"
            onClick={() => onChange({ kind: 'month', month: shiftCalendarMonth(selectedMonth, 1) })}
            disabled={isCurrentMonth}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-secondary transition-[background-color,color,transform] duration-150 hover:bg-slab-border/50 hover:text-primary active:scale-95 active:bg-slab-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-environment disabled:pointer-events-none disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none motion-reduce:active:scale-100"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
