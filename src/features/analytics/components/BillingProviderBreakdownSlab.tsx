import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh } from '../../../shared/lib'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { groupBillingProviders, type ProviderColor } from '../model/billingProviderGrouping'
import type { BillingProviderBreakdown } from '../model/billingProviderBreakdown'

/** Props for the selected-period provider spend summary. */
export interface BillingProviderBreakdownSlabProps {
  breakdown: BillingProviderBreakdown
  isLoading: boolean
  error?: unknown | null
  layoutMode?: AnalyticsLayoutMode
}

type ProviderColorStyle = CSSProperties & {
  '--provider-color-light': string
  '--provider-color-dark': string
}

function providerColorStyle(color: ProviderColor): ProviderColorStyle {
  return {
    '--provider-color-light': color.light,
    '--provider-color-dark': color.dark,
  }
}

/** Shows provider spend and billed energy for the selected Analytics period. */
export function BillingProviderBreakdownSlab({ breakdown, isLoading, error = null, layoutMode = 'bottom-dock' }: BillingProviderBreakdownSlabProps) {
  const [isOthersExpanded, setIsOthersExpanded] = useState(false)
  const detailsId = useId()
  const othersButtonRef = useRef<HTMLButtonElement>(null)
  const providerListRef = useRef<HTMLUListElement>(null)
  const othersWasFocused = useRef(false)
  const groupedProviders = groupBillingProviders(breakdown.groups, layoutMode)
  const positiveEnergyGroups = groupedProviders.barGroups.filter((group) => (group.billedEnergyKwh ?? 0) > 0)
  const positiveEnergyTotal = positiveEnergyGroups.reduce((total, group) => total + (group.billedEnergyKwh ?? 0), 0)
  const showEnergyBar = groupedProviders.groups.length > 1 && positiveEnergyTotal > 0

  useLayoutEffect(() => {
    if (!groupedProviders.groups.some((group) => group.isOthers) && othersWasFocused.current) {
      othersWasFocused.current = false
      providerListRef.current?.focus()
    }
  }, [groupedProviders.groups])

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
          {showEnergyBar && (
            <div
              role="img"
              aria-label={`Billed energy by provider: ${groupedProviders.barGroups.map((group) => `${group.name} ${group.billedEnergyKwh === null ? 'energy unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}`).join(', ')}`}
              className="flex h-3 w-full overflow-hidden rounded-full bg-secondary/10"
            >
              {positiveEnergyGroups.map((group) => (
                <span
                  key={group.isOthers ? 'group:others' : `provider:${group.normalizedName}`}
                  aria-hidden="true"
                  className="h-full min-w-0 bg-[var(--provider-color-light)] dark:bg-[var(--provider-color-dark)]"
                  style={{ ...providerColorStyle(group.color), width: `${((group.billedEnergyKwh ?? 0) / positiveEnergyTotal) * 100}%` }}
                />
              ))}
            </div>
          )}
          <ul ref={providerListRef} tabIndex={-1} className="divide-y divide-slab-border border-t border-slab-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label="Provider totals">
            {groupedProviders.groups.map((group) => {
              return (
                <li key={group.isOthers ? 'group:others' : `provider:${group.normalizedName}`} className="min-w-0 py-2">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)] md:gap-x-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full bg-[var(--provider-color-light)] dark:bg-[var(--provider-color-dark)]" style={providerColorStyle(group.color)} />
                      <div className="min-w-0 space-y-1">
                        {group.isOthers ? (
                          <button
                            ref={othersButtonRef}
                            type="button"
                            aria-expanded={isOthersExpanded}
                            aria-controls={detailsId}
                            onFocus={() => { othersWasFocused.current = true }}
                            onBlur={() => { othersWasFocused.current = false }}
                            onClick={() => setIsOthersExpanded((expanded) => !expanded)}
                            className="min-h-[44px] rounded-lg text-left text-sm font-medium text-primary underline decoration-secondary/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                          >
                            Others <span className="text-secondary">
                              ({group.members?.length ?? 0} {group.members?.length === 1 ? 'provider' : 'providers'})
                            </span>
                          </button>
                        ) : (
                          <p className="break-words text-sm font-medium text-primary">{group.name}</p>
                        )}
                        <p className="text-xs text-secondary md:hidden">
                          {group.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}
                          {group.validBilledEnergySessionCount < group.sessionCount && ` · ${group.validBilledEnergySessionCount}/${group.sessionCount} measured`}
                        </p>
                      </div>
                    </div>
                    <p className="hidden text-right text-sm tabular-nums text-secondary md:block">
                      {group.billedEnergyKwh === null ? 'Unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}
                      {group.validBilledEnergySessionCount < group.sessionCount && (
                        <span className="block text-[10px]">{group.validBilledEnergySessionCount}/{group.sessionCount} measured</span>
                      )}
                    </p>
                    <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
                      {group.totalCostCents === null ? 'Unavailable' : formatCurrency(group.totalCostCents)}
                      {group.totalCostCents === 0 && <span className="block text-xs font-normal text-secondary">Free</span>}
                    </p>
                  </div>
                  {group.isOthers && isOthersExpanded && (
                    <ul id={detailsId} className="ml-6 mt-1 divide-y divide-slab-border border-l-2 border-slab-border pl-3" aria-label="Other provider totals">
                      {group.members?.map((member) => (
                        <li key={member.normalizedName} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2 text-xs md:grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)] md:gap-3">
                          <span className="min-w-0 break-words text-primary">
                            {member.name}
                            <span className="block text-secondary md:hidden">
                              {member.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(member.billedEnergyKwh)} kWh`}
                              {member.validBilledEnergySessionCount < member.sessionCount && ` · ${member.validBilledEnergySessionCount}/${member.sessionCount} measured`}
                            </span>
                          </span>
                          <span className="hidden text-right tabular-nums text-secondary md:block">
                            {member.billedEnergyKwh === null ? 'Unavailable' : `${formatKwh(member.billedEnergyKwh)} kWh`}
                            {member.validBilledEnergySessionCount < member.sessionCount && (
                              <span className="block text-[10px]">{member.validBilledEnergySessionCount}/{member.sessionCount} measured</span>
                            )}
                          </span>
                          <span className="text-right tabular-nums text-primary">
                            {member.totalCostCents === null ? 'Unavailable' : formatCurrency(member.totalCostCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Slab>
  )
}
