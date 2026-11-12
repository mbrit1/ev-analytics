import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, X } from 'lucide-react'
import { Slab } from '../../../shared/ui'
import { formatCurrency, formatKwh } from '../../../shared/lib'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'
import { groupBillingProviders, type ProviderColor } from '../model/billingProviderGrouping'
import type { BillingProviderBreakdown } from '../model/billingProviderBreakdown'

/** Props for the selected-period provider breakdown. */
export interface BillingProviderBreakdownSlabProps {
  breakdown: BillingProviderBreakdown
  isLoading: boolean
  error?: unknown | null
  layoutMode?: AnalyticsLayoutMode
}

type ProviderColorStyle = CSSProperties & {
  '--provider-color': string
}

function providerColorStyle(color: ProviderColor): ProviderColorStyle {
  return {
    '--provider-color': color,
  }
}

/** Shows selected-period spending and billed energy grouped by provider. */
export function BillingProviderBreakdownSlab({ breakdown, isLoading, error = null, layoutMode = 'bottom-dock' }: BillingProviderBreakdownSlabProps) {
  const [isOthersExpanded, setIsOthersExpanded] = useState(false)
  const [isOthersSheetOpen, setIsOthersSheetOpen] = useState(false)
  const detailsId = useId()
  const sheetHeadingId = useId()
  const othersButtonRef = useRef<HTMLButtonElement>(null)
  const sheetCloseRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const sheetRootRef = useRef<HTMLDivElement>(null)
  const providerListRef = useRef<HTMLUListElement>(null)
  const othersWasFocused = useRef(false)
  const restoreFocusAfterContextChange = useRef(false)
  const groupedProviders = groupBillingProviders(breakdown.groups, layoutMode)
  const othersGroup = groupedProviders.groups.find((group) => group.isOthers)
  const membersIdentity = othersGroup?.members?.map((member) => member.normalizedName).join('|') ?? ''
  const previousSheetContext = useRef({ layoutMode, membersIdentity })
  const positiveEnergyGroups = groupedProviders.barGroups.filter((group) => (group.billedEnergyKwh ?? 0) > 0)
  const positiveEnergyTotal = positiveEnergyGroups.reduce((total, group) => total + (group.billedEnergyKwh ?? 0), 0)
  const showEnergyBar = groupedProviders.groups.length > 1 && positiveEnergyTotal > 0
  const hasPartialBilledEnergy = breakdown.validBilledEnergySessionCount < breakdown.sessionCount
  const energyBarLabel = hasPartialBilledEnergy ? 'Known billed energy by provider' : 'Billed energy by provider'

  useLayoutEffect(() => {
    if (!groupedProviders.groups.some((group) => group.isOthers) && othersWasFocused.current) {
      othersWasFocused.current = false
      providerListRef.current?.focus()
    }
  }, [groupedProviders.groups])

  const dismissOthersSheet = useCallback(() => setIsOthersSheetOpen(false), [])

  useLayoutEffect(() => {
    const contextChanged = previousSheetContext.current.layoutMode !== layoutMode
      || previousSheetContext.current.membersIdentity !== membersIdentity
    if (contextChanged) {
      restoreFocusAfterContextChange.current = isOthersSheetOpen
      setIsOthersSheetOpen(false)
      setIsOthersExpanded(false)
    }
    previousSheetContext.current = { layoutMode, membersIdentity }
  }, [isOthersSheetOpen, layoutMode, membersIdentity])

  useEffect(() => {
    const root = sheetRootRef.current
    const dialog = sheetRef.current
    if (!isOthersSheetOpen || !root || !dialog) return undefined

    const trigger = othersButtonRef.current
    const body = document.body
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingRight
    const viewportWidth = document.documentElement.clientWidth
    const scrollbarWidth = viewportWidth > 0 ? Math.max(0, window.innerWidth - viewportWidth) : 0
    const backgrounds = Array.from(body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== root)
      .map((element) => ({ element, inert: element.inert, inertAttribute: element.getAttribute('inert') }))

    backgrounds.forEach(({ element }) => {
      element.inert = true
      element.setAttribute('inert', '')
    })
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `calc(${getComputedStyle(body).paddingRight} + ${scrollbarWidth}px)`
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissOthersSheet()
      } else if (event.key === 'Tab') {
        const focusable = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    sheetCloseRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
      backgrounds.forEach(({ element, inert, inertAttribute }) => {
        element.inert = inert
        if (inertAttribute === null) element.removeAttribute('inert')
        else element.setAttribute('inert', inertAttribute)
      })
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true })
      }
    }
  }, [dismissOthersSheet, isOthersSheetOpen])

  useEffect(() => {
    if (isOthersSheetOpen || !restoreFocusAfterContextChange.current) return

    restoreFocusAfterContextChange.current = false
    const liveTrigger = othersButtonRef.current
    const focusTarget = liveTrigger?.isConnected ? liveTrigger : providerListRef.current
    focusTarget?.focus({ preventScroll: true })
  }, [isOthersSheetOpen, layoutMode, membersIdentity])

  return (
    <Slab padding="none" className="w-full space-y-5 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-primary">Billing providers</h2>
        <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">Billed energy and session spending by provider</p>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load billing providers. Please try again.</p>
      ) : isLoading ? (
        <div role="status">
          <span className="sr-only">Loading billing providers</span>
          <div aria-hidden="true" className="h-24 animate-pulse rounded-xl bg-secondary/10 motion-reduce:animate-none" />
        </div>
      ) : breakdown.sessionCount === 0 ? (
        <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">No charging sessions recorded for this period.</p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 aria-hidden={showEnergyBar || undefined} className="text-xs font-medium text-[#6E6E73] dark:text-[#8E8E93]">{energyBarLabel}</h3>
              {breakdown.billedEnergyKwh !== null && (
                <p className="text-sm font-semibold tabular-nums text-primary">
                  {formatKwh(breakdown.billedEnergyKwh)} <span className="text-xs font-normal">kWh</span>
                </p>
              )}
            </div>
            {showEnergyBar && (
              <div
                role="img"
                aria-label={`${energyBarLabel}: ${groupedProviders.barGroups.map((group) => `${group.name} ${group.billedEnergyKwh === null ? 'energy unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}`).join(', ')}`}
                className="flex h-3 w-full overflow-hidden rounded-full bg-secondary/10"
              >
                {positiveEnergyGroups.map((group) => (
                  <span
                    key={group.isOthers ? 'group:others' : `provider:${group.normalizedName}`}
                    aria-hidden="true"
                    className="h-full min-w-0 border-l border-surface bg-[var(--provider-color)] first:border-l-0"
                    style={{ ...providerColorStyle(group.color), width: `${((group.billedEnergyKwh ?? 0) / positiveEnergyTotal) * 100}%` }}
                  />
                ))}
              </div>
            )}
            {hasPartialBilledEnergy && (
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">Available for {breakdown.validBilledEnergySessionCount} of {breakdown.sessionCount} sessions.</p>
            )}
            {positiveEnergyTotal === 0 && (
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">No provider distribution is shown because no sessions have positive known billed energy.</p>
            )}
            {breakdown.totalSessionSpendCents === null && <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">At least one session has an invalid recorded cost.</p>}
          </div>
          <div>
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)] gap-x-3 pb-1 text-xs font-medium text-[#6E6E73] dark:text-[#8E8E93] md:grid">
              <span>Provider</span>
              <span className="text-right">Billed energy</span>
              <span className="text-right">Session spend</span>
            </div>
          <ul ref={providerListRef} tabIndex={-1} className="divide-y divide-slab-border border-t border-slab-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" aria-label="Provider totals">
            {groupedProviders.groups.map((group) => {
              return (
                <li key={group.isOthers ? 'group:others' : `provider:${group.normalizedName}`} className="min-w-0 py-2">
                  {group.isOthers && layoutMode === 'bottom-dock' ? (
                    <button
                      ref={othersButtonRef}
                      type="button"
                      aria-haspopup="dialog"
                      aria-controls={isOthersSheetOpen ? `${sheetHeadingId}-dialog` : undefined}
                      aria-describedby={`${detailsId}-aggregate-description`}
                      aria-label={`Show ${group.members?.length ?? 0} other ${group.members?.length === 1 ? 'provider' : 'providers'}`}
                      onFocus={() => { othersWasFocused.current = true }}
                      onBlur={() => { othersWasFocused.current = false }}
                      onClick={() => setIsOthersSheetOpen(true)}
                      className="grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_auto] items-center gap-x-3 rounded-lg text-left active:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface md:grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)_auto]"
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full bg-[var(--provider-color)]" style={providerColorStyle(group.color)} />
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium text-primary">
                            Others <span className="text-[#6E6E73] dark:text-[#8E8E93]">({group.members?.length ?? 0} {group.members?.length === 1 ? 'provider' : 'providers'})</span>
                          </span>
                          <span className="block text-xs text-[#6E6E73] dark:text-[#8E8E93] md:hidden">
                            {group.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}
                            {group.validBilledEnergySessionCount < group.sessionCount && ` · ${group.validBilledEnergySessionCount}/${group.sessionCount} measured`}
                          </span>
                        </span>
                      </span>
                      <span className="hidden text-right text-sm tabular-nums text-[#6E6E73] dark:text-[#8E8E93] md:block">
                        {group.billedEnergyKwh === null ? 'Unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}
                        {group.validBilledEnergySessionCount < group.sessionCount && <span className="block text-[10px]">{group.validBilledEnergySessionCount}/{group.sessionCount} measured</span>}
                      </span>
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
                        {group.totalCostCents === null ? 'Unavailable' : formatCurrency(group.totalCostCents)}
                        {group.totalCostCents === 0 && <span className="block text-xs font-normal text-[#6E6E73] dark:text-[#8E8E93]">Free</span>}
                      </span>
                      <ChevronRight aria-hidden="true" className="size-4 text-[#6E6E73] dark:text-[#8E8E93]" />
                      <span id={`${detailsId}-aggregate-description`} className="sr-only">
                        {group.billedEnergyKwh === null
                          ? 'Billed energy unavailable'
                          : `Billed energy ${formatKwh(group.billedEnergyKwh)} kWh`}
                        ; {group.validBilledEnergySessionCount} of {group.sessionCount} sessions measured
                        ; {group.totalCostCents === null
                          ? 'Session spend unavailable'
                          : `Session spend ${formatCurrency(group.totalCostCents)}`}
                      </span>
                    </button>
                  ) : (
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)] md:gap-x-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full bg-[var(--provider-color)]" style={providerColorStyle(group.color)} />
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
                              Others <span className="text-[#6E6E73] dark:text-[#8E8E93]">
                                ({group.members?.length ?? 0} {group.members?.length === 1 ? 'provider' : 'providers'})
                              </span>
                            </button>
                          ) : (
                            <p className="break-words text-sm font-medium text-primary">{group.name}</p>
                          )}
                          <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] md:hidden">
                            {group.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(group.billedEnergyKwh)} kWh`}
                            {group.validBilledEnergySessionCount < group.sessionCount && ` · ${group.validBilledEnergySessionCount}/${group.sessionCount} measured`}
                          </p>
                        </div>
                      </div>
                      <p className="hidden text-right text-sm tabular-nums text-[#6E6E73] dark:text-[#8E8E93] md:block">
                        {group.billedEnergyKwh === null ? <><span className="sr-only">Billed energy </span>Unavailable</> : `${formatKwh(group.billedEnergyKwh)} kWh`}
                        {group.validBilledEnergySessionCount < group.sessionCount && (
                          <span className="block text-[10px]">{group.validBilledEnergySessionCount}/{group.sessionCount} measured</span>
                        )}
                      </p>
                      <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
                        {group.totalCostCents === null ? <><span className="sr-only">Session spend </span>Unavailable</> : formatCurrency(group.totalCostCents)}
                        {group.totalCostCents === 0 && <span className="block text-xs font-normal text-[#6E6E73] dark:text-[#8E8E93]">Free</span>}
                      </p>
                    </div>
                  )}
                  {group.isOthers && isOthersExpanded && (
                    <ul id={detailsId} className="ml-6 mt-1 divide-y divide-slab-border border-l-2 border-slab-border pl-3" aria-label="Other provider totals">
                      {group.members?.map((member) => (
                        <li key={member.normalizedName} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2 text-xs md:grid-cols-[minmax(0,1fr)_minmax(4rem,6rem)_minmax(4rem,6rem)] md:gap-3">
                          <span className="min-w-0 break-words text-primary">
                            {member.name}
                            <span className="block text-[#6E6E73] dark:text-[#8E8E93] md:hidden">
                              {member.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(member.billedEnergyKwh)} kWh`}
                              {member.validBilledEnergySessionCount < member.sessionCount && ` · ${member.validBilledEnergySessionCount}/${member.sessionCount} measured`}
                            </span>
                          </span>
                          <span className="hidden text-right tabular-nums text-[#6E6E73] dark:text-[#8E8E93] md:block">
                            {member.billedEnergyKwh === null ? <><span className="sr-only">Billed energy </span>Unavailable</> : `${formatKwh(member.billedEnergyKwh)} kWh`}
                            {member.validBilledEnergySessionCount < member.sessionCount && (
                              <span className="block text-[10px]">{member.validBilledEnergySessionCount}/{member.sessionCount} measured</span>
                            )}
                          </span>
                          <span className="text-right tabular-nums text-primary">
                            {member.totalCostCents === null ? <><span className="sr-only">Session spend </span>Unavailable</> : formatCurrency(member.totalCostCents)}
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
        </div>
      )}
      {isOthersSheetOpen && othersGroup?.members && createPortal(
        <div ref={sheetRootRef} className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="Dismiss other billing providers"
            onClick={dismissOthersSheet}
            className="absolute inset-0 bg-primary/30"
          />
          <section
            id={`${sheetHeadingId}-dialog`}
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetHeadingId}
            aria-describedby={`${sheetHeadingId}-description`}
            className="relative z-10 flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] border border-slab-border bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-slab"
          >
            <header className="flex shrink-0 items-start justify-between gap-4">
              <div>
                <h2 id={sheetHeadingId} className="text-base font-semibold text-primary">Other billing providers</h2>
                <p id={`${sheetHeadingId}-description`} className="mt-1 text-sm text-[#6E6E73] dark:text-[#8E8E93]">
                  {othersGroup.members.length} {othersGroup.members.length === 1 ? 'additional provider' : 'additional providers'}
                </p>
              </div>
              <button
                ref={sheetCloseRef}
                type="button"
                aria-label="Close other billing providers"
                onClick={dismissOthersSheet}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-[#6E6E73] dark:text-[#8E8E93] active:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </header>
            <div className="mt-3 min-h-0 overflow-y-auto overscroll-contain">
            <ul className="divide-y divide-slab-border border-t border-slab-border" aria-label="Other provider totals">
              {othersGroup.members.map((member) => {
                const color = groupedProviders.providerColors.get(member.normalizedName)
                return (
                  <li key={member.normalizedName} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3">
                    <span className="flex min-w-0 items-start gap-3">
                      <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full bg-[var(--provider-color)]" style={providerColorStyle(color ?? '#8E8E93')} />
                      <span className="min-w-0 space-y-1">
                        <span className="block break-words text-sm font-medium text-primary">{member.name}</span>
                        <span className="block text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                          {member.billedEnergyKwh === null ? 'Energy unavailable' : `${formatKwh(member.billedEnergyKwh)} kWh`}
                          {member.validBilledEnergySessionCount < member.sessionCount && ` · ${member.validBilledEnergySessionCount}/${member.sessionCount} measured`}
                        </span>
                      </span>
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums text-primary">
                      {member.totalCostCents === null
                        ? <><span className="sr-only">Session spend </span>Unavailable</>
                        : formatCurrency(member.totalCostCents)}
                    </span>
                  </li>
                )
              })}
            </ul>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </Slab>
  )
}
