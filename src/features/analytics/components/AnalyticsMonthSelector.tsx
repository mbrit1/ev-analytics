import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthLabel } from '../../../shared/lib'
import {
  compareCalendarMonths,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../model/analyticsPeriods'

/** Props for navigating the analytics calendar month. */
export interface AnalyticsMonthSelectorProps {
  value: CalendarMonth
  currentMonth: CalendarMonth
  onChange: (month: CalendarMonth) => void
}

/** Restrained previous/next month control for analytics periods. */
export function AnalyticsMonthSelector({
  value,
  currentMonth,
  onChange,
}: AnalyticsMonthSelectorProps) {
  const isCurrentMonth = compareCalendarMonths(value, currentMonth) >= 0

  return (
    <div
      className="mx-auto grid w-full max-w-72 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 md:max-w-sm md:rounded-full md:border md:border-slab-border md:bg-surface/70 md:px-1 md:shadow-sm"
      role="group"
      aria-label="Analytics month"
    >
      <button
        type="button"
        onClick={() => onChange(shiftCalendarMonth(value, -1))}
        className="flex h-11 w-11 items-center justify-center rounded-full text-secondary transition-colors hover:bg-secondary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
        aria-label="Previous month"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <p className="min-w-0 text-center text-base font-semibold text-primary" aria-live="polite">
        {formatMonthLabel(value.year, value.month)}
      </p>
      <button
        type="button"
        onClick={() => onChange(shiftCalendarMonth(value, 1))}
        disabled={isCurrentMonth}
        className="flex h-11 w-11 items-center justify-center rounded-full text-secondary transition-colors hover:bg-secondary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none"
        aria-label="Next month"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}
