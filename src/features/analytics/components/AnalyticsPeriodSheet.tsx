import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Modal period surface following the existing Analytics bottom-sheet interaction. */
interface AnalyticsPeriodSheetProps {
  label: string
  children: ReactNode
  triggerRef: RefObject<HTMLButtonElement | null>
  onDismiss: () => void
}

/** Locks background interaction, contains keyboard focus and restores the invoking control. */
export function AnalyticsPeriodSheet({ label, children, triggerRef, onDismiss }: AnalyticsPeriodSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const headingId = useId()

  useEffect(() => {
    const root = rootRef.current
    const dialog = dialogRef.current
    if (!root || !dialog) return undefined

    const trigger = triggerRef.current
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
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      } else if (event.key === 'Tab') {
        const buttons = focusable()
        const first = buttons[0]
        const last = buttons.at(-1)
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
    const selected = dialog.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    const initialFocus = selected ?? focusable()[0]
    initialFocus?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
      backgrounds.forEach(({ element, inert, inertAttribute }) => {
        element.inert = inert
        if (inertAttribute === null) element.removeAttribute('inert')
        else element.setAttribute('inert', inertAttribute)
      })
      if (trigger?.isConnected) trigger.focus()
      else {
        // A breakpoint can replace the mobile trigger while its sheet is open.
        queueMicrotask(() => document.querySelector<HTMLButtonElement>('button[aria-label^="Other ranges"]')?.focus())
      }
    }
  }, [onDismiss, triggerRef])

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={`Dismiss ${label}`}
        onClick={onDismiss}
        className="absolute inset-0 bg-primary/30"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="relative z-10 max-h-[calc(100dvh-env(safe-area-inset-bottom)-1rem)] w-full max-w-lg overflow-y-auto rounded-t-[2rem] border border-slab-border bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-slab"
      >
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-12 rounded-full bg-secondary/40" />
        <h2 id={headingId} className="text-base font-semibold text-primary">{label}</h2>
        <div className="mt-4">{children}</div>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl bg-secondary/10 px-3 py-2 font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </section>
    </div>,
    document.body,
  )
}
