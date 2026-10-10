import { useId, useState } from 'react'
import { Slab } from '../../../shared/ui'
import { formatCurrency } from '../../../shared/lib'
import type { AnalyticsPeriod } from '../model/analyticsPeriods'
import type { SessionSpendingBucket, SessionSpendingTrend as SessionSpendingTrendResult } from '../model/sessionSpendingTrend'

/** Props for the selected-period session-spending trend. */
export interface SessionSpendingTrendSlabProps {
  period: AnalyticsPeriod
  trend: SessionSpendingTrendResult
  isLoading: boolean
  error?: unknown | null
}

function formatBucketRange(start: Date, end: Date, unit: 'day' | 'month'): string {
  const lastIncluded = new Date(end)
  lastIncluded.setDate(lastIncluded.getDate() - 1)
  const formatDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (unit === 'day' && start.toDateString() === lastIncluded.toDateString()) return formatDate.format(start)
  if (unit === 'month' && start.getDate() === 1 && lastIncluded.getDate() === new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()) {
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(start)
  }
  return `${formatDate.format(start)} – ${formatDate.format(lastIncluded)}`
}

function formatBucketValue(bucket: SessionSpendingBucket, unit: 'day' | 'month'): string {
  const value = bucket.totalSessionSpendCents === null ? 'Unavailable' : formatCurrency(bucket.totalSessionSpendCents)
  return `${formatBucketRange(bucket.startUtc, bucket.endUtc, unit)}${bucket.isPartialMonth ? ', partial month' : ''}, ${bucket.sessionCount} ${bucket.sessionCount === 1 ? 'session' : 'sessions'}, ${value}`
}

function formatBucketTooltip(bucket: SessionSpendingBucket, unit: 'day' | 'month'): string {
  const value = bucket.totalSessionSpendCents === null ? 'Unavailable' : formatCurrency(bucket.totalSessionSpendCents)
  return `${formatBucketRange(bucket.startUtc, bucket.endUtc, unit)}${bucket.isPartialMonth ? ' · Partial month' : ''} · ${value}`
}

/** Accessible local-calendar line-area chart with an equivalent text table. */
export function SessionSpendingTrendSlab({ period, trend, isLoading, error = null }: SessionSpendingTrendSlabProps) {
  const periodIdentity = `${period.startUtc.getTime()}:${period.endUtc.getTime()}`
  const instructionsId = useId()
  const tooltipId = useId()
  const [selection, setSelection] = useState({ periodIdentity, index: 0 })
  const selectedIndex = selection.periodIdentity === periodIdentity
    ? Math.min(selection.index, Math.max(0, trend.buckets.length - 1))
    : 0
  const selectIndex = (index: number) => setSelection({ periodIdentity, index })
  const selected = trend.buckets[selectedIndex]
  const maxCents = Math.max(0, ...trend.buckets.map(({ totalSessionSpendCents }) => totalSessionSpendCents ?? 0))
  const hasAvailableCost = trend.buckets.some(({ totalSessionSpendCents }) => totalSessionSpendCents !== null)
  const hasInvalidBucket = trend.buckets.some(({ totalSessionSpendCents }) => totalSessionSpendCents === null)
  const hasRecordedFreeSessions = !trend.isEmpty && maxCents === 0 && !hasInvalidBucket
  const width = 600
  const chartHeight = 220
  const padding = 12
  const plotLeft = 0
  const plotTop = 62
  const plotBottom = chartHeight - padding
  const plotHeight = plotBottom - plotTop
  const plotWidth = width - plotLeft - padding
  const pointX = (index: number) => Number((plotLeft + ((index + 0.5) / Math.max(1, trend.buckets.length)) * plotWidth).toFixed(2))
  const pointY = (value: number) => plotBottom - (maxCents > 0 ? (value / maxCents) * plotHeight : 0)
  const segments: number[][] = []
  trend.buckets.forEach((bucket, index) => {
    if (bucket.totalSessionSpendCents === null) return
    const current = segments.at(-1)
    if (current && current.at(-1) === index - 1) current.push(index)
    else segments.push([index])
  })
  const pathForSegment = (indices: number[]) => {
    const firstIndex = indices[0]!
    const lastIndex = indices.at(-1)!
    const line = indices.map((index, pointIndex) => {
      const value = trend.buckets[index]!.totalSessionSpendCents!
      return `${pointIndex === 0 ? 'M' : 'L'} ${pointX(index)} ${pointY(value)}`
    }).join(' ')
    return `${line} L ${pointX(lastIndex)} ${plotBottom} L ${pointX(firstIndex)} ${plotBottom} Z`
  }
  const lineForSegment = (indices: number[]) => indices.map((index, pointIndex) => {
    const value = trend.buckets[index]!.totalSessionSpendCents!
    return `${pointIndex === 0 ? 'M' : 'L'} ${pointX(index)} ${pointY(value)}`
  }).join(' ')
  const selectedValueText = selected ? formatBucketValue(selected, trend.unit) : ''
  const selectedTooltip = selected ? formatBucketTooltip(selected, trend.unit) : ''
  const selectedX = selected ? (pointX(selectedIndex) / width) * 100 : 0

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (trend.buckets.length === 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, selectedIndex - 1)
    if (event.key === 'ArrowRight') nextIndex = Math.min(trend.buckets.length - 1, selectedIndex + 1)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = trend.buckets.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      selectIndex(nextIndex)
    }
  }

  const handlePointerSelect = (event: React.PointerEvent<HTMLDivElement>) => {
    if (trend.buckets.length === 0) return
    if (event.type === 'pointerdown' && event.button !== 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0) return
    const position = Math.min(width, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * width))
    const nearestIndex = trend.buckets.reduce((nearest, _bucket, index) => (
      Math.abs(pointX(index) - position) < Math.abs(pointX(nearest) - position) ? index : nearest
    ), 0)
    selectIndex(nearestIndex)
    if (event.type === 'pointerdown') {
      event.currentTarget.focus()
      if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  return (
    <Slab padding="none" className="w-full space-y-4 p-5 md:p-8" aria-busy={isLoading && error === null}>
      <div>
        <h2 className="text-sm font-semibold text-primary">Session spending trend</h2>
        <p className="text-xs leading-5 text-secondary">Recorded session charges · Excludes subscription fees</p>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-primary">Unable to load spending trend. Please try again.</p>
      ) : isLoading ? (
        <div role="status"><span className="sr-only">Loading spending trend</span><div aria-hidden="true" className="h-40 rounded-xl bg-secondary/10 motion-safe:animate-pulse motion-reduce:animate-none" /></div>
      ) : trend.isEmpty ? (
        <p className="text-sm text-secondary">No charging sessions recorded for this period.</p>
      ) : (
        <>
          {hasRecordedFreeSessions && <p className="text-sm text-secondary">Recorded sessions in this period were free (0,00 €).</p>}
          {hasInvalidBucket && <p className="text-sm text-secondary">Unavailable: at least one session has an invalid recorded cost. A ? marks each affected bucket.</p>}
          <div className="min-w-0 @container">
          <div className="flex min-w-0 gap-2 @max-sm:flex-col">
            <div aria-hidden="true" className="relative h-52 min-w-14 shrink-0 whitespace-nowrap pr-1 text-xs tabular-nums text-secondary @max-sm:hidden">
              <span className="invisible inline-block w-max">{hasAvailableCost ? formatCurrency(maxCents) : '—'}</span>
              {[1, 0.5, 0].map((ratio) => {
                const value = ratio === 1 ? maxCents : ratio === 0.5 ? Math.round(maxCents / 2) : 0
                const label = hasAvailableCost ? formatCurrency(value) : '—'
                const y = plotBottom - ratio * plotHeight
                return <span key={ratio} className="absolute right-1 -translate-y-1/2" style={{ top: `${(y / chartHeight) * 100}%` }}>{label}</span>
              })}
            </div>
            <div aria-hidden="true" className="hidden min-w-0 break-words text-xs tabular-nums text-secondary @max-sm:block">
              Scale: {hasAvailableCost ? `0,00 €–${formatCurrency(maxCents)}` : 'Unavailable'}
            </div>
            <div
              role="slider"
              aria-label="Session spending by bucket"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, trend.buckets.length - 1)}
              aria-valuenow={selectedIndex}
              aria-valuetext={selectedValueText}
              aria-describedby={`${instructionsId} ${tooltipId}`}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onPointerDown={handlePointerSelect}
              onPointerMove={(event) => { if (event.buttons === 1) handlePointerSelect(event) }}
              className="min-w-0 flex-1 touch-pan-y rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <span id={instructionsId} className="sr-only">Use left and right arrow keys to select a bucket. Use Home and End to move to the first and last bucket. Pointer or touch anywhere in the plot selects the nearest bucket.</span>
              <span id={tooltipId} aria-live="polite" aria-atomic="true" className="sr-only">{selectedTooltip}</span>
              <div className="relative">
                {selected && (
                  <div aria-hidden="true" className="absolute top-1 z-10 box-border w-[min(12rem,calc(100%-0.5rem))] max-w-[12rem] break-words rounded-lg border border-slab-border bg-surface px-2 py-1 text-sm leading-5 text-primary shadow-slab @max-sm:static @max-sm:mb-2 @max-sm:w-full @max-sm:max-w-full" style={{ left: `clamp(0px, calc(${selectedX}% - 6rem), max(0px, calc(100% - min(12rem, 100%))))` }}>
                    {selectedTooltip}
                  </div>
                )}
                <svg aria-hidden="true" viewBox={`0 0 ${width} ${chartHeight}`} className="block h-52 w-full" preserveAspectRatio="none">
                  {[0, 0.5, 1].map((ratio) => {
                    const y = plotBottom - ratio * plotHeight
                    return <line key={ratio} data-scale-ratio={ratio} x1={plotLeft} y1={y} x2={width - padding} y2={y} stroke="currentColor" className="text-slab-border" />
                  })}
                  {segments.map((indices) => indices.length > 1 && (
                    <g key={indices[0]} data-trend-segment="true">
                      <path d={pathForSegment(indices)} fill="var(--color-accent)" fillOpacity="0.12" stroke="none" />
                      <path d={lineForSegment(indices)} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    </g>
                  ))}
                  {trend.buckets.map((bucket, index) => {
                    const selectedPoint = selectedIndex === index
                    if (bucket.totalSessionSpendCents === null) return null
                    const singletonPoint = segments.some((segment) => segment.length === 1 && segment[0] === index)
                    if (!selectedPoint && !singletonPoint) return null
                    return <circle key={bucket.startUtc.toISOString()} data-bucket-index={index} data-selected-bucket-point={selectedPoint || undefined} cx={pointX(index)} cy={pointY(bucket.totalSessionSpendCents)} r={selectedPoint ? 6 : 4} fill="var(--color-accent)" />
                  })}
                </svg>
                {trend.buckets.map((bucket, index) => bucket.totalSessionSpendCents === null ? (
                  <span key={bucket.startUtc.toISOString()} aria-hidden="true" className="pointer-events-none absolute top-[62%] -translate-x-1/2 -translate-y-1/2 text-xs font-semibold text-secondary" style={{ left: `${(pointX(index) / width) * 100}%` }}>?</span>
                ) : null)}
              </div>
              <div aria-hidden="true" className="flex justify-between gap-2 text-xs text-secondary"><span className="min-w-0 truncate">{formatBucketRange(trend.buckets[0]!.startUtc, trend.buckets[0]!.endUtc, trend.unit)}</span><span className="min-w-0 truncate text-right">{formatBucketRange(trend.buckets.at(-1)!.startUtc, trend.buckets.at(-1)!.endUtc, trend.unit)}</span></div>
            </div>
          </div>
          </div>
          <details className="text-sm text-primary">
            <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">View all bucket values</summary>
            <div>
              <table className="w-full table-fixed text-left text-xs sm:text-sm">
                <caption className="sr-only">Session spend buckets for {period.startUtc.toLocaleDateString('en-GB')} to {new Date(period.endUtc.getTime() - 1).toLocaleDateString('en-GB')}</caption>
                <thead><tr className="border-b border-slab-border text-secondary"><th scope="col" className="py-2 pr-3">Date range</th><th scope="col" className="py-2 pr-3">Sessions</th><th scope="col" className="py-2 text-right">Spend</th></tr></thead>
                <tbody>{trend.buckets.map((bucket) => <tr key={bucket.startUtc.toISOString()} className="border-b border-slab-border/60"><th scope="row" className="break-words py-2 pr-2 font-medium">{formatBucketRange(bucket.startUtc, bucket.endUtc, trend.unit)}{bucket.isPartialMonth ? ' · Partial month' : ''}</th><td className="break-words py-2 pr-2 tabular-nums">{bucket.sessionCount}</td><td className="break-words py-2 text-right tabular-nums">{bucket.totalSessionSpendCents === null ? 'Unavailable' : formatCurrency(bucket.totalSessionSpendCents)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Slab>
  )
}
