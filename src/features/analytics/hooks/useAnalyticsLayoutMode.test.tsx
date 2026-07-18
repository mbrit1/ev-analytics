import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnalyticsLayoutMode } from './useAnalyticsLayoutMode'

type MediaQueryListener = (event: MediaQueryListEvent) => void

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<MediaQueryListener>()
  const addEventListener = vi.fn((type: string, listener: MediaQueryListener) => {
    if (type === 'change') {
      listeners.add(listener)
    }
  })
  const removeEventListener = vi.fn((type: string, listener: MediaQueryListener) => {
    if (type === 'change') {
      listeners.delete(listener)
    }
  })
  const mediaQueryList = {
    get matches() {
      return matches
    },
    media: '(min-width: 768px)',
    addEventListener,
    removeEventListener,
  } as unknown as MediaQueryList
  const matchMedia = vi.fn(() => mediaQueryList)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  })

  return {
    matchMedia,
    addEventListener,
    removeEventListener,
    emit(nextMatches: boolean) {
      matches = nextMatches
      for (const listener of listeners) {
        listener({ matches: nextMatches } as MediaQueryListEvent)
      }
    },
  }
}

/**
 * Test suite for the feature-local Analytics responsive layout subscription.
 *
 * Verifies the mobile-safe fallback, live media-query transitions, and listener
 * cleanup without relying on the global app shell.
 */
describe('useAnalyticsLayoutMode', () => {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia)
    } else {
      delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
    }
  })

  it('uses the safe bottom-dock mode when matchMedia is unavailable', () => {
    // Arrange: Simulate a non-browser-compatible environment.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    })

    // Act: Render the layout subscription.
    const { result } = renderHook(() => useAnalyticsLayoutMode())

    // Assert: The deterministic initial mode keeps the mobile composition safe.
    expect(result.current).toBe('bottom-dock')
  })

  it('reads the current md media-query match and responds to later changes', () => {
    // Arrange: Begin below the sidebar breakpoint.
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useAnalyticsLayoutMode())

    // Act: Cross to sidebar mode, then back to bottom-dock mode.
    act(() => media.emit(true))
    const sidebarMode = result.current
    act(() => media.emit(false))

    // Assert: The hook reacts to event values rather than a stale query result.
    expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 768px)')
    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(sidebarMode).toBe('sidebar')
    expect(result.current).toBe('bottom-dock')
  })

  it('uses sidebar mode when the current md media query already matches', () => {
    // Arrange: Enter Analytics on a desktop-width viewport.
    installMatchMedia(true)

    // Act: Render the responsive subscription.
    const { result } = renderHook(() => useAnalyticsLayoutMode())

    // Assert: The mounted hook synchronizes to the sidebar composition.
    expect(result.current).toBe('sidebar')
  })

  it('removes its media-query listener when the Analytics route unmounts', () => {
    // Arrange: Render an active responsive subscription.
    const media = installMatchMedia(true)
    const { unmount } = renderHook(() => useAnalyticsLayoutMode())

    // Act: Leave the Analytics route.
    unmount()

    // Assert: The exact listener is removed to avoid route-lifetime leaks.
    expect(media.removeEventListener).toHaveBeenCalledWith(
      'change',
      media.addEventListener.mock.calls[0]?.[1],
    )
  })
})
