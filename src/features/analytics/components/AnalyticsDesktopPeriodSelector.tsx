import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthLabel } from '../../../shared/lib'
import type {
  AnalyticsPeriodPreset,
  AnalyticsPeriodSelection,
  CalendarMonth,
} from '../model/analyticsPeriods'
import { compareCalendarMonths, shiftCalendarMonth } from '../model/analyticsPeriods'

const PRESETS: { value: AnalyticsPeriodPreset; label: string }[] = [
  { value: '7-days', label: '7 Days' },
  { value: '30-days', label: '30 Days' },
  { value: '3-months', label: '3 Months' },
  { value: 'year', label: 'Year' },
]
const MONTHS = Array.from({ length: 12 }, (_, month) => ({
  value: month,
  label: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2026, month, 1)),
}))
const CONTROL_CLASS = 'inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-xl text-secondary transition-colors hover:bg-slab-border/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-35'

/** Inputs for the desktop month-first period control. */
interface AnalyticsDesktopPeriodSelectorProps {
  selection: AnalyticsPeriodSelection
  selectedMonth: CalendarMonth
  currentMonth: CalendarMonth
  onChange: (selection: AnalyticsPeriodSelection) => void
}

/** Month-first desktop period selector with keyboard-dismissable local popovers. */
export function AnalyticsDesktopPeriodSelector({
  selection,
  selectedMonth,
  currentMonth,
  onChange,
}: AnalyticsDesktopPeriodSelectorProps) {
  const [popup, setPopup] = useState<'month' | 'ranges' | null>(null)
  const [pickerYear, setPickerYear] = useState(selectedMonth.year)
  const rootRef = useRef<HTMLDivElement>(null)
  const monthTriggerRef = useRef<HTMLButtonElement>(null)
  const rangesTriggerRef = useRef<HTMLButtonElement>(null)
  const monthButtonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const presetButtonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const isCurrentMonth = compareCalendarMonths(selectedMonth, currentMonth) >= 0
  const selectedPreset = selection.kind === 'preset'
    ? PRESETS.find(({ value }) => value === selection.preset)
    : undefined

  useEffect(() => {
    if (popup === null) return undefined

    const dismissOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPopup(null)
    }
    const dismissOutsideFocus = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPopup(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const trigger = popup === 'month' ? monthTriggerRef.current : rangesTriggerRef.current
      setPopup(null)
      trigger?.focus()
    }

    document.addEventListener('pointerdown', dismissOutsidePointer)
    document.addEventListener('focusin', dismissOutsideFocus)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutsidePointer)
      document.removeEventListener('focusin', dismissOutsideFocus)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [popup])

  useEffect(() => {
    if (popup === 'month') {
      monthButtonRefs.current[selectedMonth.month]?.focus()
    } else if (popup === 'ranges') {
      const selectedIndex = selectedPreset
        ? PRESETS.findIndex(({ value }) => value === selectedPreset.value)
        : 0
      presetButtonRefs.current[selectedIndex]?.focus()
    }
  }, [popup, selectedMonth.month, selectedMonth.year, selectedPreset])

  const openPopup = (nextPopup: 'month' | 'ranges') => {
    if (nextPopup === 'month' && popup !== 'month') setPickerYear(selectedMonth.year)
    setPopup((current) => current === nextPopup ? null : nextPopup)
  }
  const finishSelection = (nextSelection: AnalyticsPeriodSelection, trigger: HTMLButtonElement | null) => {
    onChange(nextSelection)
    setPopup(null)
    trigger?.focus()
  }

  return (
    <div ref={rootRef} className="relative mx-auto w-full max-w-3xl">
      <div className="flex w-full items-center gap-2 rounded-xl border border-slab-border bg-surface px-2 py-1.5 shadow-slab">
        {selection.kind === 'month' ? (
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              className={CONTROL_CLASS}
              onClick={() => finishSelection({ kind: 'month', month: shiftCalendarMonth(selectedMonth, -1) }, null)}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              ref={monthTriggerRef}
              type="button"
              aria-label={`Choose calendar month, ${formatMonthLabel(selectedMonth.year, selectedMonth.month)}`}
              aria-haspopup="dialog"
              aria-expanded={popup === 'month'}
              onClick={() => openPopup('month')}
              className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-base font-semibold text-primary hover:bg-slab-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
              <span className="truncate">{formatMonthLabel(selectedMonth.year, selectedMonth.month)}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              disabled={isCurrentMonth}
              className={CONTROL_CLASS}
              onClick={() => finishSelection({ kind: 'month', month: shiftCalendarMonth(selectedMonth, 1) }, null)}
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="flex h-11 min-w-0 items-center px-2 text-base font-semibold text-primary">
            {selectedPreset?.label}
          </p>
        )}
        <button
          ref={rangesTriggerRef}
          type="button"
          aria-label={selectedPreset ? `Other ranges (${selectedPreset.label})` : 'Other ranges'}
          aria-haspopup="dialog"
          aria-expanded={popup === 'ranges'}
          title={selectedPreset ? `Other ranges · ${selectedPreset.label}` : 'Other ranges'}
          onClick={() => openPopup('ranges')}
          className={`${CONTROL_CLASS} ml-auto gap-2 whitespace-nowrap border border-slab-border px-3 ${selectedPreset ? 'text-accent' : ''}`}
        >
          <span>Other ranges</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </div>

      {popup === 'month' && selection.kind === 'month' && (
        <section
          role="dialog"
          aria-label="Choose month and year"
          className="absolute left-0 top-full z-30 mt-2 w-full max-w-[22rem] rounded-xl border border-slab-border bg-surface p-4 shadow-slab"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous year"
              className={CONTROL_CLASS}
              onClick={() => setPickerYear((year) => year - 1)}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <p className="font-semibold text-primary" aria-live="polite">{pickerYear}</p>
            <button
              type="button"
              aria-label="Next year"
              disabled={pickerYear >= currentMonth.year}
              className={CONTROL_CLASS}
              onClick={() => setPickerYear((year) => year + 1)}
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MONTHS.map(({ value, label }) => {
              const isSelected = pickerYear === selectedMonth.year && value === selectedMonth.month
              const isFuture = pickerYear > currentMonth.year
                || (pickerYear === currentMonth.year && value > currentMonth.month)
              return (
                <button
                  key={value}
                  ref={(node) => { monthButtonRefs.current[value] = node }}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isFuture}
                  onClick={() => finishSelection({ kind: 'month', month: { year: pickerYear, month: value } }, monthTriggerRef.current)}
                  className={`min-h-11 rounded-lg px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-35 ${isSelected ? 'bg-primary text-surface' : 'text-primary hover:bg-slab-border/40'}`}
                >
                  <span className="inline-flex items-center justify-center gap-1.5">
                    {label}
                    {isSelected && <Check className="h-4 w-4" aria-hidden="true" />}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {popup === 'ranges' && (
        <section
          role="dialog"
          aria-label="Other ranges"
          className="absolute right-0 top-full z-30 mt-2 w-56 max-w-full rounded-xl border border-slab-border bg-surface p-2 shadow-slab"
        >
          <div className="grid gap-1">
            {selection.kind === 'preset' && (
              <button
                type="button"
                onClick={() => finishSelection({ kind: 'month', month: selectedMonth }, rangesTriggerRef.current)}
                className="min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-primary hover:bg-slab-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Calendar Month
              </button>
            )}
            {PRESETS.map(({ value, label }, index) => {
              const isSelected = selection.kind === 'preset' && selection.preset === value
              return (
                <button
                  key={value}
                  ref={(node) => { presetButtonRefs.current[index] = node }}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => finishSelection({ kind: 'preset', preset: value }, rangesTriggerRef.current)}
                  className={`min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-primary hover:bg-slab-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${isSelected ? 'bg-slab-border/40' : ''}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
