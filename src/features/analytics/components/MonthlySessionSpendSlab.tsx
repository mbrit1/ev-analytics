import { Slab } from '../../../shared/ui'
import { formatCurrency, formatMonthLabel } from '../../../shared/lib'
import type { CalendarMonth } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'

/** Props for the monthly session-spend presentation slab. */
export interface MonthlySessionSpendSlabProps {
  month: CalendarMonth
  result: MonthlySessionSpendResult
  isLoading: boolean
  onAddSession: () => void
}

/** Presents monthly session spend without tariff fees or inferred comparisons. */
export function MonthlySessionSpendSlab({
  month,
  result,
  isLoading,
  onAddSession,
}: MonthlySessionSpendSlabProps) {
  const heading = result.isCurrentMonth
    ? 'Session spend this month'
    : `Session spend in ${formatMonthLabel(month.year, month.month)}`
  const periodCopy = result.isCurrentMonth ? 'Month to date' : 'Completed month'
  const emptyHeading = result.isCurrentMonth
    ? 'No charging spend recorded for this month yet.'
    : 'No charging spend recorded for this month.'

  return (
    <Slab padding="none" className="space-y-4 p-5 md:space-y-5 md:p-8" aria-busy={isLoading}>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-secondary md:text-[0.9375rem]">{heading}</h2>
        {isLoading ? (
          <div role="status" className="h-12 w-40 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none">
            <span className="sr-only">Loading session spend</span>
          </div>
        ) : result.isEmpty ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-lg font-semibold text-primary">{emptyHeading}</p>
              <p className="text-sm text-secondary">
                {result.isCurrentMonth
                  ? 'Add a charging session to see monthly spending here.'
                  : 'Charging sessions dated to this month will appear here.'}
              </p>
            </div>
            {result.isCurrentMonth && (
              <button
                type="button"
                onClick={onAddSession}
                className="min-h-[44px] rounded-xl bg-accent px-4 py-2 font-bold text-white shadow-md shadow-accent/20 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
              >
                Add Session
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p
              className="whitespace-nowrap text-[2.75rem] font-bold leading-none tracking-tight text-primary tabular-nums md:text-[3.5rem]"
              aria-label={`${heading}: ${formatCurrency(result.totalSessionSpendCents)}`}
            >
              {formatCurrency(result.totalSessionSpendCents)}
            </p>
            <p className="text-sm leading-5 text-secondary md:text-base md:leading-6">
              {result.sessionCount === 1
                ? 'Based on 1 charging session.'
                : `Across ${result.sessionCount} charging sessions.`}
            </p>
          </div>
        )}
      </div>
      {!isLoading && (
        <p className="text-xs leading-5 text-secondary">
          {periodCopy} · Charging session costs only
        </p>
      )}
    </Slab>
  )
}
