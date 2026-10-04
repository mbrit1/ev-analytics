import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CalendarMonth } from '../model/analyticsPeriods'

const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(2026, month, 1)))
const YEAR_CONTROL = 'inline-flex h-11 w-11 items-center justify-center rounded-xl text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-35'

/** Calendar choices inside the mobile month-selection sheet. */
interface AnalyticsMonthChoicesProps {
  year: number
  selectedMonth: CalendarMonth
  currentMonth: CalendarMonth
  onYearChange: (year: number) => void
  onSelect: (month: CalendarMonth) => void
}

/** Uses the desktop chooser's month/year model while preventing future calendar months. */
export function AnalyticsMonthChoices({ year, selectedMonth, currentMonth, onYearChange, onSelect }: AnalyticsMonthChoicesProps) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="Previous year" className={YEAR_CONTROL} onClick={() => onYearChange(year - 1)}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="font-semibold text-primary" aria-live="polite">{year}</p>
        <button type="button" aria-label="Next year" disabled={year >= currentMonth.year} className={YEAR_CONTROL} onClick={() => onYearChange(year + 1)}>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MONTHS.map((label, month) => {
          const isSelected = selectedMonth.year === year && selectedMonth.month === month
          const isFuture = year > currentMonth.year || (year === currentMonth.year && month > currentMonth.month)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={isSelected}
              disabled={isFuture}
              onClick={() => onSelect({ year, month })}
              className={`min-h-11 rounded-lg px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-35 ${isSelected ? 'bg-primary text-surface' : 'text-primary hover:bg-secondary/10'}`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </>
  )
}
