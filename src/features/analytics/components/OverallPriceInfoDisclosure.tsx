import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import type { AnalyticsLayoutMode } from '../hooks/useAnalyticsLayoutMode'

const EXPLANATION = 'Overall Price divides included spend by provider-billed energy across all recorded sessions. Fixed tariff fees are included only for months in which that tariff was used. The current month is calculated through today. Battery-added energy is not included.'
const VIEWPORT_GUTTER = 16
const POPOVER_GAP = 8

interface SidebarPosition {
  left: number
  top: number
}

/** Props for the adaptive Overall Price calculation disclosure. */
export interface OverallPriceInfoDisclosureProps {
  /** Existing Analytics composition mode selects a popover or bottom sheet. */
  layoutMode: AnalyticsLayoutMode
}

/** Explains the lifetime Overall Price calculation without leaving Analytics. */
export function OverallPriceInfoDisclosure({ layoutMode }: OverallPriceInfoDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [sidebarPosition, setSidebarPosition] = useState<SidebarPosition>({ left: 16, top: 16 })
  const disclosureId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const isOpenRef = useRef(isOpen)
  const shouldRestoreFocusRef = useRef(false)
  const previousLayoutMode = useRef(layoutMode)
  const [portalHost] = useState<HTMLDivElement | null>(() => (
    typeof document === 'undefined' ? null : document.createElement('div')
  ))

  const close = useCallback((shouldRestoreFocus: boolean) => {
    shouldRestoreFocusRef.current ||= shouldRestoreFocus
    setIsOpen(false)
  }, [])

  useLayoutEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  useEffect(() => {
    if (portalHost === null) {
      return undefined
    }

    document.body.appendChild(portalHost)
    return () => portalHost.remove()
  }, [portalHost])

  useEffect(() => {
    const layoutChanged = previousLayoutMode.current !== layoutMode
    if (layoutChanged && isOpen) {
      close(true)
    }
    previousLayoutMode.current = layoutMode
  }, [close, isOpen, layoutMode])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    if (layoutMode === 'sidebar') {
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target
        if (
          target instanceof Node
          && (triggerRef.current?.contains(target) || surfaceRef.current?.contains(target))
        ) {
          return
        }
        close(true)
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close(true)
        }
      }

      document.addEventListener('pointerdown', handlePointerDown)
      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('pointerdown', handlePointerDown)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }

    closeRef.current?.focus()
    const body = document.body
    const backgroundElements = Array.from(body.children)
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && element !== portalHost
      ))
      .map((element) => ({
        element,
        hadInertAttribute: element.hasAttribute('inert'),
        wasInert: element.inert,
      }))
    const previousOverflow = body.style.overflow

    backgroundElements.forEach(({ element }) => {
      element.inert = true
      element.setAttribute('inert', '')
    })
    body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
        return
      }
      if (event.key !== 'Tab') {
        return
      }

      const focusableElements = surfaceRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusableElements === undefined || focusableElements.length === 0) {
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      body.style.overflow = previousOverflow
      backgroundElements.forEach(({ element, hadInertAttribute, wasInert }) => {
        element.inert = wasInert
        if (!hadInertAttribute) {
          element.removeAttribute('inert')
        }
      })
    }
  }, [close, isOpen, layoutMode, portalHost])

  useEffect(() => {
    if (!isOpen && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false
      triggerRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => () => {
    if (!isOpenRef.current) {
      return
    }

    queueMicrotask(() => {
      document.querySelector<HTMLButtonElement>(
        '[data-overall-price-disclosure-trigger]',
      )?.focus()
    })
  }, [])

  useLayoutEffect(() => {
    if (!isOpen || layoutMode !== 'sidebar') {
      return undefined
    }

    const updateSidebarPosition = () => {
      const trigger = triggerRef.current
      const surface = surfaceRef.current
      if (trigger === null || surface === null) {
        return
      }

      const triggerRect = trigger.getBoundingClientRect()
      const surfaceRect = surface.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const width = Math.min(surfaceRect.width || 352, viewportWidth - VIEWPORT_GUTTER * 2)
      const height = Math.min(surfaceRect.height || 180, viewportHeight - VIEWPORT_GUTTER * 2)
      const preferredLeft = triggerRect.left - width - POPOVER_GAP
      const left = Math.min(
        Math.max(preferredLeft, VIEWPORT_GUTTER),
        viewportWidth - width - VIEWPORT_GUTTER,
      )
      const belowTop = triggerRect.bottom + POPOVER_GAP
      const aboveTop = triggerRect.top - height - POPOVER_GAP
      const canSitBesideTrigger = preferredLeft >= VIEWPORT_GUTTER
      const top = aboveTop >= VIEWPORT_GUTTER || canSitBesideTrigger
        ? Math.max(aboveTop, VIEWPORT_GUTTER)
        : Math.min(
          Math.max(belowTop, VIEWPORT_GUTTER),
          viewportHeight - height - VIEWPORT_GUTTER,
        )

      setSidebarPosition({ left, top })
    }

    updateSidebarPosition()
    window.addEventListener('resize', updateSidebarPosition)
    window.addEventListener('scroll', updateSidebarPosition, true)
    return () => {
      window.removeEventListener('resize', updateSidebarPosition)
      window.removeEventListener('scroll', updateSidebarPosition, true)
    }
  }, [isOpen, layoutMode])

  const headingId = `${disclosureId}-heading`
  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      aria-label="Close Overall Price information"
      onClick={() => close(true)}
      className="-m-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-secondary transition-colors hover:bg-secondary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
    >
      <X aria-hidden="true" className="size-4" />
    </button>
  )

  const portalContent = !isOpen ? null : layoutMode === 'sidebar' ? (
    <section
      ref={surfaceRef}
      id={disclosureId}
      role="region"
      aria-labelledby={headingId}
      style={sidebarPosition}
      className="fixed z-50 w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-slab-border/70 bg-surface p-4 text-sm leading-5 text-secondary shadow-slab transition-opacity duration-200 motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="font-semibold text-primary">
          How Overall Price is calculated
        </h3>
        {closeButton}
      </div>
      <p className="mt-2">{EXPLANATION}</p>
    </section>
  ) : (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Dismiss Overall Price information"
        onClick={() => close(true)}
        className="absolute inset-0 bg-primary/30 motion-reduce:transition-none"
      />
      <section
        ref={surfaceRef}
        id={disclosureId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="relative bottom-0 z-10 max-h-[calc(100dvh-env(safe-area-inset-bottom)-1rem)] w-full overflow-y-auto rounded-t-[2rem] border border-slab-border bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 text-sm leading-5 text-secondary shadow-slab transition-transform duration-200 motion-reduce:transition-none"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-4 h-1 w-12 rounded-full bg-secondary/40"
        />
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="text-base font-semibold text-primary">
            How Overall Price is calculated
          </h2>
          {closeButton}
        </div>
        <p className="mt-3">{EXPLANATION}</p>
      </section>
    </div>
  )

  return (
    <>
      <div className="w-full">
        <button
          ref={triggerRef}
          data-overall-price-disclosure-trigger
          type="button"
          aria-label="How Overall Price is calculated"
          aria-expanded={isOpen}
          aria-controls={disclosureId}
          onClick={() => setIsOpen((current) => !current)}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-secondary transition-colors hover:bg-secondary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
        >
          <Info aria-hidden="true" className="size-5" />
        </button>
      </div>
      {portalHost !== null && createPortal(portalContent, portalHost)}
    </>
  )
}
