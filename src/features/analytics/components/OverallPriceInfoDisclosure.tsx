import { useEffect, useId, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'

/** Explains the lifetime Overall Price calculation without leaving Analytics. */
export function OverallPriceInfoDisclosure() {
  const [isOpen, setIsOpen] = useState(false)
  const disclosureId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = (shouldRestoreFocus: boolean) => {
    setIsOpen(false)
    if (shouldRestoreFocus) {
      triggerRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close(false)
      }
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
  }, [isOpen])

  return (
    <div ref={containerRef} className="w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-label="How Overall Price is calculated"
        aria-expanded={isOpen}
        aria-controls={disclosureId}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-secondary transition-colors hover:bg-secondary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
      >
        <Info aria-hidden="true" className="size-5" />
      </button>
      {isOpen && (
        <section
          id={disclosureId}
          role="region"
          aria-labelledby={`${disclosureId}-heading`}
          className="mt-2 w-full rounded-xl border border-slab-border/70 bg-secondary/5 p-4 text-sm leading-5 text-secondary transition-opacity duration-200 motion-reduce:transition-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 id={`${disclosureId}-heading`} className="font-semibold text-primary">
              About Overall Price
            </h3>
            <button
              type="button"
              aria-label="Close Overall Price information"
              onClick={() => close(true)}
              className="-m-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-secondary transition-colors hover:bg-secondary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <p className="mt-2">
            Overall price divides included spend by provider-billed energy across all recorded
            sessions. Included spend adds fixed tariff fees only for tariff-months with a
            recorded session. The current month includes fees through today. Battery-added
            energy is not used.
          </p>
        </section>
      )}
    </div>
  )
}
