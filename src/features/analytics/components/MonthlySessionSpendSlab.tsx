import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh, formatMonthLabel } from '../../../shared/lib'
import type { CalendarMonth } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'

/** Props for the monthly session-spend presentation slab. */
export interface MonthlySessionSpendSlabProps {
  month: CalendarMonth
  result: MonthlySessionSpendResult
  isLoading: boolean
  onAddSession: () => void
}

/** Presents monthly session spend with companion provider-billed energy. */
export function MonthlySessionSpendSlab({
  month,
  result,
  isLoading,
  onAddSession,
}: MonthlySessionSpendSlabProps) {
  const monthLabel = formatMonthLabel(month.year, month.month)
  const summaryHeading = result.isCurrentMonth ? 'This month summary' : `${monthLabel} summary`
  const spendAccessibleLabel = result.isCurrentMonth
    ? 'Session spend this month'
    : `Session spend in ${monthLabel}`
  const periodCopy = result.isCurrentMonth ? 'Month to date' : 'Completed month'
  const emptyHeading = result.isCurrentMonth
    ? 'No charging spend recorded for this month yet.'
    : 'No charging spend recorded for this month.'
  const billedEnergyAccessibleLabel = result.isCurrentMonth
    ? 'Billed energy this month'
    : `Billed energy in ${monthLabel}`

  return (
    <Slab padding="none" className="space-y-4 p-5 md:space-y-5 md:p-8" aria-busy={isLoading}>
      <div className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-secondary md:text-sm md:normal-case md:tracking-normal">
          {summaryHeading}
        </h2>
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
                  ? 'Add a charging session to see monthly spend and billed energy here.'
                  : 'Recorded sessions with spend and billed kWh will appear here.'}
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
          <div className="space-y-5">
            <div className="analytics-metric-row space-y-3">
              <h3 className="text-sm font-semibold text-secondary md:text-[0.9375rem]">Session spend</h3>
              <p
                className="analytics-metric-value whitespace-nowrap text-[2.75rem] font-bold leading-none tracking-tight text-primary tabular-nums md:text-[3.5rem]"
                aria-label={`${spendAccessibleLabel}: ${formatCurrency(result.totalSessionSpendCents)}`}
              >
                {formatCurrency(result.totalSessionSpendCents)}
              </p>
              <p className="text-sm leading-5 text-secondary md:text-base md:leading-6">
                {result.sessionCount === 1
                  ? 'Based on 1 charging session.'
                  : `Across ${result.sessionCount} charging sessions.`}
              </p>
            </div>
            <div className="analytics-metric-row space-y-2 border-t border-slab-border/70 pt-5">
              <h3 className="text-sm font-semibold text-secondary md:text-[0.9375rem]">
                Billed energy
              </h3>
              {result.billedEnergyKwh === null ? (
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-primary">Billed energy unavailable</p>
                  <p className="text-sm leading-5 text-secondary">
                    This month has recorded sessions, but no valid billed-kWh values to summarize.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p
                    className="analytics-metric-value inline-flex items-baseline gap-1 whitespace-nowrap text-[2rem] font-bold leading-none tracking-tight text-primary tabular-nums md:text-[2.5rem]"
                    aria-label={`${billedEnergyAccessibleLabel}: ${formatKwh(result.billedEnergyKwh)} kWh`}
                  >
                    {formatKwh(result.billedEnergyKwh)} <span className="text-lg leading-none md:text-xl">kWh</span>
                  </p>
                  <p className="text-sm leading-5 text-secondary">
                    Energy billed by providers, not battery-added energy.
                  </p>
                </div>
              )}
            </div>
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
