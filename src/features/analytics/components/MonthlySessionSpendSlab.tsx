import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh, formatMonthLabel, formatCtPerKwhAsEuroAmount } from '../../../shared/lib'
import type { CalendarMonth } from '../model/analyticsPeriods'
import type { MonthlySessionSpendResult } from '../model/monthlySessionSpend'

/** Selected-month summary state and the established session-entry action. */
export interface MonthlySessionSpendSlabProps {
  month: CalendarMonth
  result: MonthlySessionSpendResult
  isLoading: boolean
  error?: unknown | null
  onAddSession: () => void
}

/** Presents recorded spending, billed energy and their complete-coverage weighted price. */
export function MonthlySessionSpendSlab({ month, result, isLoading, error = null, onAddSession }: MonthlySessionSpendSlabProps) {
  const monthLabel = formatMonthLabel(month.year, month.month)
  const lastDay = new Date(result.periodEndUtc)
  lastDay.setDate(lastDay.getDate() - 1)
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const valueClass = 'break-words text-3xl font-bold leading-tight tracking-tight text-primary tabular-nums'
  const unavailableClass = 'text-base font-semibold text-primary'

  return (
    <Slab padding="none" className="w-full space-y-6 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-primary">
          {result.isCurrentMonth ? 'This month summary' : `${monthLabel} summary`}
        </h2>
        <p className="text-xs leading-5 text-secondary">
          {result.isCurrentMonth ? 'Month to date · In progress' : 'Completed month'}
          {' · '}{dateFormat.format(result.periodStartUtc)} – {dateFormat.format(lastDay)}
        </p>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load the monthly summary. Please try again.</p>
      ) : isLoading ? (
        <div role="status">
          <span className="sr-only">Loading monthly summary</span>
          <div aria-hidden="true" className="h-24 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" />
        </div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium text-secondary">Billed energy</h3>
              <p className={result.billedEnergyKwh === null ? unavailableClass : valueClass}>
                {result.billedEnergyKwh === null ? 'Unavailable' : <>{formatKwh(result.billedEnergyKwh)} <span className="text-base font-medium">kWh</span></>}
              </p>
              <p className="text-xs leading-5 text-secondary">Energy billed by providers, not battery-added energy.</p>
              {!result.isEmpty && result.validBilledEnergySessionCount < result.sessionCount && (
                <p className="text-xs leading-5 text-secondary">Billed energy available for {result.validBilledEnergySessionCount} of {result.sessionCount} sessions.</p>
              )}
            </div>
            <div className="min-w-0 space-y-2 border-t border-slab-border pt-5 lg:border-t-0 lg:pt-0">
              <h3 className="text-sm font-medium text-secondary">Session spend</h3>
              <p className={result.totalSessionSpendCents === null ? unavailableClass : valueClass}>
                {result.totalSessionSpendCents === null ? 'Unavailable' : formatCurrency(result.totalSessionSpendCents)}
              </p>
              <p className="text-xs leading-5 text-secondary">
                {result.totalSessionSpendCents === null ? 'One or more sessions has an invalid recorded cost.' : 'Recorded session charges. Excludes subscription fees.'}
              </p>
            </div>
            <div className="min-w-0 space-y-2 border-t border-slab-border pt-5 lg:border-t-0 lg:pt-0">
              <h3 className="text-sm font-medium text-secondary">Average session price</h3>
              <p className={result.averageSessionPriceCtPerKwh === null ? unavailableClass : valueClass}>
                {result.averageSessionPriceCtPerKwh === null ? 'Unavailable' : <>{formatCtPerKwhAsEuroAmount(result.averageSessionPriceCtPerKwh, 'de-DE')} <span className="text-base font-medium">€/kWh</span></>}
              </p>
              <p className="text-xs leading-5 text-secondary">
                {result.averageSessionPriceCtPerKwh === null ? 'Requires valid cost and billed energy for every session.' : 'Session spend divided by billed energy.'}
              </p>
            </div>
          </div>
          <div className="space-y-3 border-t border-slab-border pt-4">
            <p className="text-sm text-secondary">
              {result.sessionCount} {result.sessionCount === 1 ? 'charging session' : 'charging sessions'}
            </p>
            {result.isEmpty && (
              <>
                <p className="text-sm text-secondary">No charging sessions recorded for this month{result.isCurrentMonth ? ' yet' : ''}. Billed energy and average price are unavailable.</p>
                {result.isCurrentMonth && (
                  <button type="button" onClick={onAddSession} className="min-h-11 rounded-xl bg-accent px-4 py-2 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                    Add Session
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Slab>
  )
}
