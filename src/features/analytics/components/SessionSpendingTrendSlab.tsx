import { useId, useState } from 'react'
import { Slab } from '../../../shared/ui'
import { formatCurrency } from '../../../shared/lib'
import type { AnalyticsPeriod } from '../model/analyticsPeriods'
import type { SessionSpendingBucket, SessionSpendingTrend as SessionSpendingTrendResult } from '../model/sessionSpendingTrend'
import { createSpendingAxisTicks } from './sessionSpendingAxis'

/** Props for the selected-period session-spending trend. */
export interface SessionSpendingTrendSlabProps {
  period: AnalyticsPeriod
  trend: SessionSpendingTrendResult
  isLoading: boolean
  error?: unknown | null
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(value)
}

function formatBucketRange(bucket: SessionSpendingBucket): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(bucket.startUtc)
}

function formatBucketValue(bucket: SessionSpendingBucket): string {
  const amount = bucket.totalSessionSpendCents === null
    ? 'Unavailable: at least one session has an invalid recorded cost'
    : formatCurrency(bucket.totalSessionSpendCents)
  const status = [bucket.isPartialMonth ? 'Partial month' : null, bucket.isCurrentMonth ? 'Month to date' : null]
    .filter((value): value is string => value !== null).join(', ') || 'Complete month'
  return `${formatBucketRange(bucket)}, ${formatDate(bucket.startUtc)} – ${formatDate(new Date(bucket.endUtc.getTime() - 1))}, ${status}, ${bucket.sessionCount} ${bucket.sessionCount === 1 ? 'session' : 'sessions'}, ${amount}`
}

function formatCompactBucket(bucket: SessionSpendingBucket): { primary: string; secondary: string } {
  const lastIncluded = new Date(bucket.endUtc.getTime() - 1)
  const dateOptions: Intl.DateTimeFormatOptions = bucket.startUtc.getFullYear() === lastIncluded.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  const dayRange = bucket.startUtc.getMonth() === lastIncluded.getMonth() && bucket.startUtc.getFullYear() === lastIncluded.getFullYear()
    ? `${bucket.startUtc.getDate()}–${lastIncluded.getDate()} ${new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(bucket.startUtc)}`
    : `${new Intl.DateTimeFormat('en-GB', dateOptions).format(bucket.startUtc)} – ${new Intl.DateTimeFormat('en-GB', dateOptions).format(lastIncluded)}`
  const status = bucket.isCurrentMonth ? 'Month to date' : bucket.isPartialMonth ? 'Partial month' : null
  const amount = bucket.totalSessionSpendCents === null ? 'Unavailable' : formatCurrency(bucket.totalSessionSpendCents)
  return {
    primary: `${formatBucketRange(bucket)} · ${amount}`,
    secondary: `${dayRange}${status ? ` · ${status}` : ''}`,
  }
}

function formatAxisRange(start: Date, end: Date): string {
  return `${formatDate(start)} – ${formatDate(new Date(end.getTime() - 1))}`
}

function formatQuietAxisRange(start: Date, end: Date): string {
  const lastIncluded = new Date(end.getTime() - 1)
  const sameYear = start.getFullYear() === lastIncluded.getFullYear()
  const startDate = sameYear
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(start)
    : formatDate(start)
  return `${startDate} – ${formatDate(lastIncluded)}`
}

function formatBucketMonthLabel(bucket: SessionSpendingBucket): string {
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(bucket.startUtc)
  if (bucket.isCurrentMonth) return `${month} · MTD`
  return bucket.isPartialMonth ? `${month}*` : month
}

/** Accessible monthly spending bars with keyboard selection and equivalent textual values. */
export function SessionSpendingTrendSlab({ period, trend, isLoading, error = null }: SessionSpendingTrendSlabProps) {
  const instructionsId = useId()
  const rangeIdentity = `${period.startUtc.getTime()}:${period.endUtc.getTime()}:${trend.startUtc.getTime()}:${trend.endUtc.getTime()}:${trend.selectedMonth?.year ?? ''}:${trend.selectedMonth?.month ?? ''}`
  const anchorIndex = Math.max(0, trend.buckets.findIndex(({ month }) => (
    trend.selectedMonth !== null && month.year === trend.selectedMonth.year && month.month === trend.selectedMonth.month
  )))
  const [selection, setSelection] = useState({ rangeIdentity, index: anchorIndex })
  if (selection.rangeIdentity !== rangeIdentity) {
    setSelection({ rangeIdentity, index: anchorIndex })
  }
  const selectedIndex = selection.rangeIdentity === rangeIdentity
    ? Math.min(selection.index, Math.max(0, trend.buckets.length - 1))
    : anchorIndex
  const selected = trend.buckets[selectedIndex]
  const maxCents = Math.max(0, ...trend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents ?? 0))
  const axisTicks = createSpendingAxisTicks(trend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents))
  const axisMaximum = axisTicks.at(-1) ?? 0
  const hasInvalidBucket = trend.buckets.some(({ totalSessionSpendCents }) => totalSessionSpendCents === null)
  const hasRecordedFreeSessions = !trend.isEmpty && maxCents === 0 && !hasInvalidBucket
  const selectedValue = selected ? formatBucketValue(selected) : 'No monthly values are available'
  const anchorMonthLabel = trend.selectedMonth
    ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(trend.selectedMonth.year, trend.selectedMonth.month, 1))
    : null
  const hasPartialMonth = trend.buckets.some(({ isPartialMonth, isCurrentMonth }) => isPartialMonth && !isCurrentMonth)
  const hasCurrentMonth = trend.buckets.some(({ isCurrentMonth }) => isCurrentMonth)
  const monthNotes = [hasPartialMonth ? '* Partial month' : null, hasCurrentMonth ? 'MTD: month to date.' : null]
    .filter((value): value is string => value !== null)
  const selectedTooltip = selected ? formatCompactBucket(selected) : null
  const longestAxisLabel = axisTicks.length === 0
    ? 'Unavailable'
    : axisTicks.map(formatCurrency).reduce((longest, label) => label.length > longest.length ? label : longest, '')
  const [tooltip, setTooltip] = useState({ rangeIdentity, visible: false })
  if (tooltip.rangeIdentity !== rangeIdentity) setTooltip({ rangeIdentity, visible: false })
  const isTooltipVisible = tooltip.rangeIdentity === rangeIdentity && tooltip.visible && selected !== undefined
  const plotWidth = 600
  const plotHeight = 220
  const plotBottom = 176
  const plotTop = 58
  const plotInnerWidth = plotWidth - 12
  const plotX = (index: number) => ((index + 0.5) / Math.max(1, trend.buckets.length)) * plotInnerWidth
  const axisY = (cents: number) => plotBottom - (axisMaximum > 0 ? (cents / axisMaximum) * (plotBottom - plotTop) : 0)
  const selectIndex = (index: number) => setSelection({ rangeIdentity, index })

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (trend.buckets.length === 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, selectedIndex - 1)
    if (event.key === 'ArrowRight') nextIndex = Math.min(trend.buckets.length - 1, selectedIndex + 1)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = trend.buckets.length - 1
    if (event.key === 'Escape') {
      setTooltip({ rangeIdentity, visible: false })
      return
    }
    if (nextIndex !== null) {
      event.preventDefault()
      selectIndex(nextIndex)
      setTooltip({ rangeIdentity, visible: true })
    }
  }

  const handlePointerSelect = (event: React.PointerEvent<HTMLDivElement>) => {
    if (trend.buckets.length === 0 || (event.type === 'pointerdown' && event.button !== 0)) return
    const plot = event.currentTarget.querySelector('svg')
    if (!plot) return
    const bounds = plot.getBoundingClientRect()
    if (bounds.width <= 0) return
    const isDragging = event.type === 'pointermove' && event.buttons === 1
    if (!isDragging && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) return
    const position = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    selectIndex(Math.min(trend.buckets.length - 1, Math.floor(position * trend.buckets.length)))
    setTooltip({ rangeIdentity, visible: true })
    if (event.type === 'pointerdown') {
      event.currentTarget.focus()
      if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  return (
    <Slab padding="none" className="w-full space-y-4 px-[min(1.25rem,20px)] py-5 md:p-8" aria-busy={isLoading && error === null}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-primary">Session spending</h2>
          {error === null && !isLoading && <p className="text-xs text-secondary">{formatQuietAxisRange(trend.startUtc, trend.endUtc)}</p>}
        </div>
        <details className="relative shrink-0">
          <summary
            aria-label="Info"
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                const disclosure = event.currentTarget.parentElement
                if (disclosure instanceof HTMLDetailsElement) disclosure.open = !disclosure.open
              }
            }}
            className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-sm text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.6">
              <circle cx="10" cy="10" r="7.25" />
              <path d="M10 9v5m0-8h.01" strokeLinecap="round" />
            </svg>
          </summary>
          <p className="absolute right-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-4rem)] rounded-lg border border-slab-border bg-surface p-3 text-xs leading-5 text-primary shadow-slab">Recorded session charges; excludes subscription fees</p>
        </details>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load spending trend. Please try again.</p>
      ) : isLoading ? (
        <div role="status"><span className="sr-only">Loading spending trend</span><div aria-hidden="true" className="h-40 rounded-xl bg-secondary/10 motion-safe:animate-pulse motion-reduce:animate-none" /></div>
      ) : (
        <>
          {trend.isEmpty && <p className="text-sm text-secondary">No charging sessions recorded for this period.</p>}
          {hasRecordedFreeSessions && <p className="text-sm text-secondary">Recorded sessions in this period were free (0,00 €).</p>}
          {hasInvalidBucket && <p className="text-sm text-secondary">Unavailable: at least one session has an invalid recorded cost. A ? marks each affected month.</p>}
          {anchorMonthLabel && <p className="text-xs text-secondary">Outlined month matches the selected summary · {anchorMonthLabel}</p>}
          <div
            role="slider"
            aria-label="Monthly spending by month"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, trend.buckets.length - 1)}
            aria-valuenow={selectedIndex}
            aria-valuetext={selectedValue}
            aria-describedby={instructionsId}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={() => setTooltip({ rangeIdentity, visible: true })}
            onBlur={() => setTooltip({ rangeIdentity, visible: false })}
            onPointerDown={handlePointerSelect}
            onPointerMove={handlePointerSelect}
            className="@container/spending-chart min-w-0 touch-pan-y rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span id={instructionsId} className="sr-only">Use left and right arrow keys to select a month. Use Home and End for the first and last month. Pointer or touch anywhere in the chart selects the nearest month.</span>
            <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{selectedValue}</span>
            {isTooltipVisible && <div data-spending-tooltip="true" aria-hidden="true" className="mb-2 w-[min(14rem,100%)] break-words rounded-lg border border-slab-border bg-surface px-2 py-1 text-sm leading-5 text-primary shadow-slab">
              <span className="block text-sm font-medium text-primary">{selectedTooltip?.primary}</span>
              <span className="block text-xs text-secondary">{selectedTooltip?.secondary}</span>
            </div>}
            <div className="flex min-w-0">
              <div role="group" aria-label="Spending scale in euros" className="relative h-52 w-fit min-w-14 shrink-0 pr-2 text-right text-xs tabular-nums text-primary">
                <span aria-hidden="true" className="invisible whitespace-nowrap">{longestAxisLabel}</span>
                {axisTicks.length === 0
                  ? <span className="absolute right-2 top-1/2 -translate-y-1/2">Unavailable</span>
                  : axisTicks.map((tick) => <span key={tick} data-axis-label-cents={tick} className="absolute right-2 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(axisY(tick) / plotHeight) * 100}%` }}>{formatCurrency(tick)}</span>)}
              </div>
              <div className="relative min-w-0 flex-1">
                <div className="relative min-w-0">
                <svg aria-hidden="true" viewBox={`0 0 ${plotWidth} ${plotHeight}`} className="block h-52 w-full" preserveAspectRatio="none">
                {axisTicks.map((tick) => {
                  const y = axisY(tick)
                  return <line key={tick} data-axis-tick-cents={tick} x1="0" y1={y} x2={plotWidth} y2={y} stroke="currentColor" className="text-slab-border" />
                })}
                {trend.buckets.map((bucket, index) => {
                  const cents = bucket.totalSessionSpendCents
                  const slotWidth = plotInnerWidth / Math.max(1, trend.buckets.length)
                  const barWidth = Math.min(36, Math.max(4, slotWidth - 10))
                  const x = plotX(index) - barWidth / 2
                  const y = cents === null || cents === 0 ? plotBottom : axisY(cents)
                  const height = cents === null || cents === 0 ? 0 : plotBottom - y
                  const isSelected = index === selectedIndex
                  const isAnchor = trend.selectedMonth?.year === bucket.month.year && trend.selectedMonth.month === bucket.month.month
                  return <g key={bucket.startUtc.toISOString()}>
                    {isAnchor && <rect data-selected-month-anchor="true" x={plotX(index) - slotWidth / 2 + 1} y={plotTop} width={slotWidth - 2} height={plotBottom - plotTop} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />}
                    {isSelected && <line x1={plotX(index)} x2={plotX(index)} y1={plotTop} y2={plotBottom} stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="3 3" />}
                    <rect data-month-bar="true" data-spend-cents={cents === null ? 'unavailable' : cents} data-bar-height={height} x={x} y={y} width={barWidth} height={height} fill="var(--color-accent)" fillOpacity={isSelected ? 1 : 0.72} stroke={isSelected ? 'var(--color-accent)' : 'none'} strokeWidth="2" />
                    {cents === 0 && <line x1={x} x2={x + barWidth} y1={plotBottom - 1} y2={plotBottom - 1} stroke="var(--color-accent)" strokeWidth="2" />}
                  </g>
                })}
                </svg>
              {trend.buckets.map((bucket, index) => bucket.totalSessionSpendCents === null && (
                <span key={bucket.startUtc.toISOString()} aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-xs font-semibold text-secondary" style={{ left: `${(plotX(index) / plotWidth) * 100}%`, top: `${((plotBottom - 5) / plotHeight) * 100}%` }}>?</span>
              ))}
                </div>
              {trend.buckets.length <= 8 ? (
                <div aria-hidden="true" className="hidden min-w-0 text-xs text-secondary @sm/spending-chart:grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, trend.buckets.length)}, minmax(0, 1fr))` }}>
                  {trend.buckets.map((bucket) => {
                    const isAnchor = trend.selectedMonth?.year === bucket.month.year && trend.selectedMonth.month === bucket.month.month
                    return <div key={bucket.startUtc.toISOString()} className={`min-w-0 text-center ${isAnchor ? 'font-semibold text-primary' : ''}`} title={formatBucketRange(bucket)}>
                      <span className="block break-words">{formatBucketMonthLabel(bucket)}</span>
                      <span className="block break-words">{bucket.month.year}</span>
                    </div>
                  })}
                </div>
              ) : null}
              </div>
            </div>
            <div aria-hidden="true" className={`grid min-w-0 grid-cols-3 text-xs text-secondary ${trend.buckets.length <= 8 ? '@sm/spending-chart:hidden' : ''}`}>
              {[trend.buckets[0], trend.buckets[Math.floor((trend.buckets.length - 1) / 2)], trend.buckets.at(-1)].map((bucket, index) => bucket && (
                <div key={`${bucket.startUtc.toISOString()}-${index}`} className={`min-w-0 ${index === 1 ? 'text-center' : index === 2 ? 'text-right' : 'text-left'} ${trend.selectedMonth?.year === bucket.month.year && trend.selectedMonth.month === bucket.month.month ? 'font-semibold text-primary' : ''}`}>
                  <span className="block break-words">{formatBucketMonthLabel(bucket)}</span>
                  <span className="block break-words">{bucket.month.year}</span>
                </div>
              ))}
            </div>
          </div>
          {monthNotes.length > 0 && <p className="text-xs text-secondary">{monthNotes.join(' · ')}</p>}
          {trend.buckets.length === 0 && <p className="text-sm text-secondary">No monthly values are available for this chart range.</p>}
          <details className="text-sm text-primary">
            <summary className="flex min-h-11 cursor-pointer items-center py-2 text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">View monthly values</summary>
            <div role="region" aria-label="Monthly values table" tabIndex={0} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
              <table className="min-w-[20rem] w-full table-fixed text-left text-xs sm:text-sm">
                <caption className="sr-only">Monthly session spending values for {formatAxisRange(trend.startUtc, trend.endUtc)}</caption>
                <thead><tr className="border-b border-slab-border text-secondary"><th scope="col" className="py-2 pr-3">Month and dates</th><th scope="col" className="py-2 pr-3">Sessions</th><th scope="col" className="py-2 text-right">Spend</th></tr></thead>
                <tbody>{trend.buckets.map((bucket) => (
                  <tr key={bucket.startUtc.toISOString()} className="border-b border-slab-border/60">
                    <th scope="row" className="break-words py-2 pr-2 font-medium">{formatBucketRange(bucket)} · {formatDate(bucket.startUtc)} – {formatDate(new Date(bucket.endUtc.getTime() - 1))}{bucket.isPartialMonth ? ' · Partial month' : ''}{bucket.isCurrentMonth ? ' · Month to date' : ''}</th>
                    <td className="break-words py-2 pr-2 tabular-nums">{bucket.sessionCount}</td>
                    <td className="break-words py-2 text-right tabular-nums">{bucket.totalSessionSpendCents === null ? 'Unavailable: invalid recorded cost' : formatCurrency(bucket.totalSessionSpendCents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Slab>
  )
}
