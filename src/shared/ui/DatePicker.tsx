import React from 'react';
import { Calendar, Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface DatePickerProps {
  /** Visible field label. */
  label: string;
  /** Controlled date value as `YYYY-MM-DD`, or an empty string when allowed. */
  value: string;
  /** Commits a selected `YYYY-MM-DD` value, or an empty string for optional clear. */
  onChange: (value: string) => void;
  /** Marks the field as required for forms and assistive technology. */
  required?: boolean;
  /** Renders the visual required marker used by app forms. */
  requiredIndicator?: boolean;
  /** Allows the committed value to be cleared to an empty string. */
  allowEmpty?: boolean;
  /** User-facing text for the optional empty state. */
  emptyLabel?: string;
  /** Earliest selectable `YYYY-MM-DD` date. */
  min?: string;
  /** Latest selectable `YYYY-MM-DD` date. */
  max?: string;
  /** Accessible validation message. */
  error?: string;
  /** Prevents the picker from opening or changing values. */
  disabled?: boolean;
  /** Explicit id for label and error wiring. */
  id?: string;
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
type StagedMode = 'date' | 'empty';

function formatToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateString(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function formatDateLabel(value: string): string {
  if (!isDateString(value)) return value;
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function getMonthStart(value: string): Date {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function formatMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function getCalendarDates(month: Date): Date[] {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function clampDate(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

/**
 * Shared app-controlled date picker using controlled `YYYY-MM-DD` strings.
 */
export function DatePicker({
  label,
  value,
  onChange,
  required = false,
  requiredIndicator = false,
  allowEmpty = false,
  emptyLabel = 'No date',
  min,
  max,
  error,
  disabled = false,
  id,
}: DatePickerProps): React.ReactElement {
  const reactId = React.useId();
  const inputId = id ?? `${reactId}-date-picker`;
  const errorId = `${inputId}-error`;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [stagedValue, setStagedValue] = React.useState(value);
  const [stagedMode, setStagedMode] = React.useState<StagedMode>(allowEmpty && !value ? 'empty' : 'date');
  const [visibleMonth, setVisibleMonth] = React.useState(() => getMonthStart(value || clampDate(formatToday(), min, max)));
  const displayValue = value ? formatDateLabel(value) : emptyLabel;
  const describedBy = error ? errorId : undefined;
  const isEmptyMode = allowEmpty && stagedMode === 'empty';

  const closePicker = React.useCallback((options: { restoreFocus?: boolean } = {}) => {
    const { restoreFocus = true } = options;
    setIsOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, []);

  const openPicker = React.useCallback(() => {
    if (disabled) return;
    const focusValue = value || clampDate(formatToday(), min, max);
    setStagedValue(focusValue);
    setStagedMode(allowEmpty && !value ? 'empty' : 'date');
    setVisibleMonth(getMonthStart(focusValue));
    setIsOpen(true);
  }, [allowEmpty, disabled, max, min, value]);

  React.useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideTarget = (target: EventTarget | null) => {
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      closePicker({ restoreFocus: false });
    };

    const handlePointerDown = (event: PointerEvent) => {
      closeOnOutsideTarget(event.target);
    };

    const handleFocusIn = (event: FocusEvent) => {
      closeOnOutsideTarget(event.target);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, [closePicker, isOpen]);

  React.useLayoutEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    const selectedDateButton = stagedValue
      ? dialog?.querySelector<HTMLButtonElement>(`[data-date-picker-date="${stagedValue}"]`)
      : null;
    const firstAvailableDateButton = dialog?.querySelector<HTMLButtonElement>('[data-date-picker-date]:not(:disabled)');
    const emptyModeButton = dialog?.querySelector<HTMLButtonElement>('[data-date-picker-empty]');
    const target = isEmptyMode
      ? emptyModeButton ?? selectedDateButton ?? firstAvailableDateButton
      : selectedDateButton ?? firstAvailableDateButton;

    target?.focus();
  }, [isEmptyMode, isOpen, stagedValue, visibleMonth]);

  const moveStagedDate = React.useCallback((days: number) => {
    const baseValue = stagedValue || value || clampDate(formatToday(), min, max);
    const [year, month, day] = baseValue.split('-').map(Number);
    const nextDate = new Date(year, month - 1, day + days);
    const nextValue = clampDate(formatDateKey(nextDate), min, max);
    setStagedValue(nextValue);
    setStagedMode('date');
    setVisibleMonth(getMonthStart(nextValue));
  }, [max, min, stagedValue, value]);

  const handleCalendarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker();
      return;
    }

    const keyDayMovement: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -30,
      End: 30,
    };

    if (event.key in keyDayMovement) {
      event.preventDefault();
      moveStagedDate(keyDayMovement[event.key]);
    }
  };

  const commitStagedValue = () => {
    if (isEmptyMode) {
      onChange('');
      closePicker();
      return;
    }
    if (!stagedValue) return;
    onChange(stagedValue);
    closePicker();
  };

  const selectEmptyMode = () => {
    if (!allowEmpty) return;
    setStagedMode('empty');
  };

  const selectDateMode = () => {
    setStagedMode('date');
  };

  return (
    <div ref={rootRef} className="relative flex w-full flex-col">
      <label
        id={`${inputId}-label`}
        className="text-[13px] font-medium text-secondary uppercase tracking-[0.12em] leading-none mb-1"
      >
        {label}
        {requiredIndicator && (
          <>
            {' '}
            <span className="text-primary" aria-hidden="true">*</span>
          </>
        )}
      </label>
      <button
        ref={triggerRef}
        id={inputId}
        type="button"
        disabled={disabled}
        aria-labelledby={`${inputId}-label ${inputId}-value`}
        aria-describedby={describedBy}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-invalid={error ? 'true' : undefined}
        aria-required={required ? 'true' : undefined}
        onClick={() => (isOpen ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !isOpen) {
            event.preventDefault();
            openPicker();
          }
        }}
        className={`flex min-h-[44px] w-full items-center border-b py-1 text-left transition-colors duration-300 outline-none focus:border-accent disabled:opacity-70 ${
          error ? 'border-red-500' : 'border-secondary/20'
        }`}
      >
        <Calendar className="mr-2 h-5 w-5 shrink-0 text-secondary/50" aria-hidden="true" />
        <span
          id={`${inputId}-value`}
          className={`flex-1 text-xl font-medium tabular-nums ${value ? 'text-primary' : 'text-secondary'}`}
        >
          {displayValue}
        </span>
        <Calendar className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      </button>

      {error && (
        <p id={errorId} className="text-sm text-red-500 font-medium mt-1.5">
          {error}
        </p>
      )}

      {isOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${inputId}-calendar-heading`}
          tabIndex={-1}
          className="absolute left-0 top-full z-30 mt-3 w-full min-w-[296px] max-w-[360px] rounded-lg border border-slab-border bg-surface p-3 shadow-slab"
          onKeyDown={handleCalendarKeyDown}
        >
          {allowEmpty && (
            <div
              className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-secondary/10 p-1"
              aria-label={`${label} mode`}
            >
              <button
                type="button"
                aria-pressed={!isEmptyMode}
                onClick={selectDateMode}
                className={`min-h-[44px] rounded-md px-3 text-sm font-bold transition-colors ${
                  !isEmptyMode
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Ends on a date
              </button>
              <button
                type="button"
                aria-pressed={isEmptyMode}
                data-date-picker-empty="true"
                onClick={selectEmptyMode}
                className={`min-h-[44px] rounded-md px-3 text-sm font-bold transition-colors ${
                  isEmptyMode
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                No end date
              </button>
            </div>
          )}

          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-secondary hover:bg-secondary/10 hover:text-primary"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <h4
              id={`${inputId}-calendar-heading`}
              data-testid="date-picker-month"
              data-month={formatMonthKey(visibleMonth)}
              className="text-sm font-semibold text-primary"
            >
              {getMonthLabel(visibleMonth)}
            </h4>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-secondary hover:bg-secondary/10 hover:text-primary"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div
            className={`grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-secondary transition-opacity ${
              isEmptyMode ? 'opacity-50' : ''
            }`}
            aria-hidden="true"
          >
            {WEEKDAY_LABELS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className={`mt-1 grid grid-cols-7 gap-1 transition-opacity ${isEmptyMode ? 'opacity-50' : ''}`}>
            {getCalendarDates(visibleMonth).map((date) => {
              const dateValue = formatDateKey(date);
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
              const isSelected = stagedMode === 'date' && stagedValue === dateValue;
              const isDisabled = Boolean((min && dateValue < min) || (max && dateValue > max));

              return (
                <button
                  key={dateValue}
                  type="button"
                  aria-label={`Choose ${formatDateLabel(dateValue)}`}
                  aria-pressed={isSelected}
                  data-date-picker-date={dateValue}
                  disabled={isDisabled}
                  onClick={() => {
                    setStagedValue(dateValue);
                    setStagedMode('date');
                  }}
                  className={`flex min-h-[44px] min-w-[36px] items-center justify-center rounded-md text-sm font-medium tabular-nums transition-colors ${
                    isSelected
                      ? 'bg-accent text-white'
                      : 'text-primary hover:bg-secondary/10'
                  } ${isCurrentMonth ? '' : 'opacity-40'} disabled:cursor-not-allowed disabled:text-secondary/40 disabled:hover:bg-transparent`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => closePicker()}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-secondary/10 px-3 text-sm font-bold text-primary hover:bg-secondary/20"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitStagedValue}
              disabled={!isEmptyMode && !stagedValue}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              {allowEmpty ? 'Apply' : 'Set Date'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
