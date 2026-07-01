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
      className="flex items-center justify-between gap-3"
      role="group"
      aria-label="Analytics month"
    >
      <button
        type="button"
        onClick={() => onChange(shiftCalendarMonth(value, -1))}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
        aria-label="Previous month"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <p className="text-base font-semibold text-primary" aria-live="polite">
        {formatMonthLabel(value.year, value.month)}
      </p>
      <button
        type="button"
        onClick={() => onChange(shiftCalendarMonth(value, 1))}
        disabled={isCurrentMonth}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none"
        aria-label="Next month"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  )
}
