import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh } from '../../../shared/lib'
import type { BillingProviderBreakdown } from '../model/billingProviderBreakdown'

/** Props for the selected-period provider spend summary. */
export interface BillingProviderBreakdownSlabProps {
  breakdown: BillingProviderBreakdown
  isLoading: boolean
  error?: unknown | null
}

/** Shows provider spend and billed energy for the selected Analytics period. */
export function BillingProviderBreakdownSlab({ breakdown, isLoading, error = null }: BillingProviderBreakdownSlabProps) {
  return (
    <Slab padding="none" className="w-full space-y-5 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-primary">Billing providers</h2>
        <p className="text-xs text-secondary">Recorded session charges by provider</p>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load billing providers. Please try again.</p>
      ) : isLoading ? (
        <div role="status">
          <span className="sr-only">Loading billing providers</span>
          <div aria-hidden="true" className="h-24 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" />
        </div>
      ) : breakdown.sessionCount === 0 ? (
        <p className="text-sm text-secondary">No charging sessions recorded for this period.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-medium text-secondary">Total spend</h3>
              <p className="break-words text-3xl font-bold leading-tight tracking-tight text-primary tabular-nums">
                {breakdown.totalSessionSpendCents === null ? 'Unavailable' : formatCurrency(breakdown.totalSessionSpendCents)}
              </p>
              {breakdown.totalSessionSpendCents === null && <p className="text-xs text-secondary">At least one session has an invalid recorded cost.</p>}
              {breakdown.totalSessionSpendCents === 0 && <p className="text-xs text-secondary">Free sessions</p>}
            </div>
            <div className="min-w-0 space-y-1 sm:border-l sm:border-slab-border sm:pl-5">
              <h3 className="text-sm font-medium text-secondary">Billed energy</h3>
              <p className="text-xl font-semibold leading-tight text-primary tabular-nums">
                {breakdown.billedEnergyKwh === null ? 'Unavailable' : <>{formatKwh(breakdown.billedEnergyKwh)} <span className="text-sm">kWh</span></>}
              </p>
              {breakdown.validBilledEnergySessionCount < breakdown.sessionCount && (
                <p className="text-xs text-secondary">Available for {breakdown.validBilledEnergySessionCount} of {breakdown.sessionCount} sessions.</p>
              )}
            </div>
          </div>
          <ul className="divide-y divide-slab-border border-t border-slab-border" aria-label="Provider totals">
            {breakdown.groups.map((group) => (
              <li key={group.normalizedName} className="flex min-w-0 items-start justify-between gap-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-medium text-primary">{group.name}</p>
                  <p className="text-xs text-secondary">
                    {group.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}
                    {group.validBilledEnergySessionCount < group.sessionCount && ` · ${group.validBilledEnergySessionCount}/${group.sessionCount} measured`}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                  {group.totalCostCents === null ? 'Unavailable' : formatCurrency(group.totalCostCents)}
                  {group.totalCostCents === 0 && <span className="block text-right text-xs font-normal text-secondary">Free</span>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Slab>
  )
}
