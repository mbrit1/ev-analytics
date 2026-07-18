import { useRef } from 'react'
import { ANALYTICS_VIEW_IDS } from './analyticsViewIds'

/** The two mobile Analytics views represented by the local tab control. */
export type AnalyticsView = 'overview' | 'monthly'

/** Props for the controlled mobile-only Analytics view selector. */
export interface AnalyticsViewSelectorProps {
  /** The currently visible Analytics subview. */
  value: AnalyticsView
  /** Selects a subview in the parent Analytics composition. */
  onChange: (view: AnalyticsView) => void
}

const VIEWS: readonly AnalyticsView[] = ['overview', 'monthly']

/**
 * Provides automatic-activation tabs for the mobile Analytics subviews.
 *
 * Sidebar composition omits this component entirely so desktop content retains
 * ordinary section semantics rather than mobile tab semantics.
 */
export function AnalyticsViewSelector({
  value,
  onChange,
}: AnalyticsViewSelectorProps) {
  const tabRefs = useRef<Record<AnalyticsView, HTMLButtonElement | null>>({
    overview: null,
    monthly: null,
  })

  const selectView = (view: AnalyticsView) => {
    onChange(view)
    tabRefs.current[view]?.focus()
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentView: AnalyticsView,
  ) => {
    const currentIndex = VIEWS.indexOf(currentView)
    let nextView: AnalyticsView | null = null

    if (event.key === 'ArrowRight') {
      nextView = VIEWS[(currentIndex + 1) % VIEWS.length]
    } else if (event.key === 'ArrowLeft') {
      nextView = VIEWS[(currentIndex - 1 + VIEWS.length) % VIEWS.length]
    } else if (event.key === 'Home') {
      nextView = VIEWS[0]
    } else if (event.key === 'End') {
      nextView = VIEWS[VIEWS.length - 1]
    }

    if (nextView) {
      event.preventDefault()
      selectView(nextView)
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Analytics view"
      className="grid w-full grid-cols-2 rounded-xl border border-slab-border bg-secondary/10 p-1"
    >
      {VIEWS.map((view) => {
        const isSelected = view === value
        const label = view === 'overview' ? 'Overview' : 'Monthly'
        const ids = ANALYTICS_VIEW_IDS[view]

        return (
          <button
            key={view}
            ref={(element) => {
              tabRefs.current[view] = element
            }}
            id={ids.tab}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls={ids.panel}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => selectView(view)}
            onKeyDown={(event) => handleKeyDown(event, view)}
            className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-environment motion-reduce:transition-none ${
              isSelected
                ? 'bg-surface text-primary shadow-sm'
                : 'text-secondary hover:bg-surface/70 hover:text-primary'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
