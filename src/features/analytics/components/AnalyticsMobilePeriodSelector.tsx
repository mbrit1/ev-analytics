import { useCallback, useRef, useState } from 'react'
import { CalendarDays, ChartNoAxesColumn, Check, ChevronLeft, ChevronRight, Ellipsis, Zap } from 'lucide-react'
import { formatMonthLabel } from '../../../shared/lib'
import { compareCalendarMonths, shiftCalendarMonth, type AnalyticsPeriodPreset, type AnalyticsPeriodSelection, type CalendarMonth } from '../model/analyticsPeriods'
import { AnalyticsMonthChoices } from './AnalyticsMonthChoices'
import { AnalyticsPeriodSheet } from './AnalyticsPeriodSheet'

const PRESETS: { value: AnalyticsPeriodPreset; label: string; icon: typeof CalendarDays }[] = [
  { value: '7-days', label: '7 Days', icon: Zap },
  { value: '30-days', label: '30 Days', icon: CalendarDays },
  { value: '3-months', label: '3 Months', icon: ChartNoAxesColumn },
  { value: 'year', label: 'Year', icon: ChartNoAxesColumn },
]
const CONTROL_CLASS = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-secondary shadow-sm transition-colors hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-environment disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none'

/** Controlled mobile period state, sharing the established Analytics period definition. */
interface AnalyticsMobilePeriodSelectorProps {
  selection: AnalyticsPeriodSelection
  selectedMonth: CalendarMonth
  currentMonth: CalendarMonth
  onChange: (selection: AnalyticsPeriodSelection) => void
}

/** Month-first mobile controls with modal sheets for calendar and rolling-period choices. */
export function AnalyticsMobilePeriodSelector({ selection, selectedMonth, currentMonth, onChange }: AnalyticsMobilePeriodSelectorProps) {
  const [panel, setPanel] = useState<'month' | 'options' | null>(null)
  const [pickerYear, setPickerYear] = useState(selectedMonth.year)
  const monthRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setPanel(null), [])
  const select = (next: AnalyticsPeriodSelection) => {
    onChange(next)
    close()
  }
  const isMonth = selection.kind === 'month'
  const label = isMonth ? formatMonthLabel(selectedMonth.year, selectedMonth.month)
    : PRESETS.find(({ value }) => value === selection.preset)?.label
  const optionClass = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none'

  return (
    <>
      <div role="group" aria-label="Analytics period" className={`flex w-full items-center ${isMonth ? 'gap-1' : 'gap-2'}`}>
        {isMonth && (
          <button type="button" aria-label="Previous month" className={CONTROL_CLASS} onClick={() => select({ kind: 'month', month: shiftCalendarMonth(selectedMonth, -1) })}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {isMonth ? (
          <button
            ref={monthRef}
            type="button"
            aria-label={`Choose calendar month, ${label}`}
            aria-haspopup="dialog"
            aria-expanded={panel === 'month'}
            onClick={() => { setPickerYear(selectedMonth.year); setPanel('month') }}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl bg-surface px-1 text-sm font-semibold text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-environment"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        ) : (
          <p className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl bg-surface px-3 text-sm font-semibold text-primary shadow-sm">{label}</p>
        )}
        {isMonth && (
          <button type="button" aria-label="Next month" disabled={compareCalendarMonths(selectedMonth, currentMonth) >= 0} className={CONTROL_CLASS} onClick={() => select({ kind: 'month', month: shiftCalendarMonth(selectedMonth, 1) })}>
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <button
          ref={optionsRef}
          type="button"
          aria-label="Choose analysis period"
          aria-haspopup="dialog"
          aria-expanded={panel === 'options'}
          onClick={() => setPanel('options')}
          className={CONTROL_CLASS}
        >
          <Ellipsis className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {panel !== null && (
        <AnalyticsPeriodSheet label={panel === 'options' ? 'Analysis period' : 'Choose month and year'} triggerRef={panel === 'options' ? optionsRef : monthRef} onDismiss={close}>
          {panel === 'month' ? (
            <AnalyticsMonthChoices year={pickerYear} selectedMonth={selectedMonth} currentMonth={currentMonth} onYearChange={setPickerYear} onSelect={(month) => select({ kind: 'month', month })} />
          ) : (
            <div className="space-y-1">
              <button type="button" aria-pressed={isMonth} onClick={() => select({ kind: 'month', month: selectedMonth })} className={`${optionClass} ${isMonth ? 'bg-secondary/10' : ''}`}>
                <CalendarDays className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <span>Calendar Month</span>
                {isMonth && <Check className="ml-auto h-5 w-5 text-accent" aria-hidden="true" />}
              </button>
              {PRESETS.map(({ value, label: presetLabel, icon: Icon }) => {
                const active = selection.kind === 'preset' && selection.preset === value
                return (
                  <button key={value} type="button" aria-pressed={active} onClick={() => select({ kind: 'preset', preset: value })} className={`${optionClass} ${active ? 'bg-secondary/10' : ''}`}>
                    <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                    <span>{presetLabel}</span>
                    {active && <Check className="ml-auto h-5 w-5 text-accent" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          )}
        </AnalyticsPeriodSheet>
      )}
    </>
  )
}
