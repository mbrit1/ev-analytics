import { useEffect, useState } from 'react'

const SIDEBAR_LAYOUT_MEDIA_QUERY = '(min-width: 768px)'

/** The Analytics information architecture selected by the app-shell breakpoint. */
export type AnalyticsLayoutMode = 'sidebar' | 'bottom-dock'

/**
 * Subscribes to the existing `md` breakpoint for Analytics-only composition.
 *
 * The deterministic bottom-dock initial state is safe before browser media
 * capabilities are available; the active media-query value replaces it on mount.
 */
export function useAnalyticsLayoutMode(): AnalyticsLayoutMode {
  const [layoutMode, setLayoutMode] = useState<AnalyticsLayoutMode>('bottom-dock')

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia(SIDEBAR_LAYOUT_MEDIA_QUERY)
    const updateLayoutMode = (matches: boolean) => {
      setLayoutMode(matches ? 'sidebar' : 'bottom-dock')
    }
    const handleChange = (event: MediaQueryListEvent) => updateLayoutMode(event.matches)

    updateLayoutMode(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return layoutMode
}
