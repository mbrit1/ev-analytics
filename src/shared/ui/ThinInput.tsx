import React, { forwardRef } from 'react';

/**
 * Properties for the ThinInput component.
 */
interface ThinInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** The label text displayed above or next to the input. */
  label: string;
  /** Optional unit suffix (e.g., 'kWh', '€') displayed inside the input. */
  unit?: string;
  /** Error message to display below the input. */
  error?: string;
  /** Text alignment for the input value. Defaults to 'right' if horizontal or unit present, else 'left'. */
  align?: 'left' | 'right';
  /** Layout direction: 'vertical' (stacked) or 'horizontal' (row). */
  layout?: 'vertical' | 'horizontal';
  /** Optional label class override for strict visual consistency across forms. */
  labelClassName?: string;
  /** Whether to render a visual required marker next to the label. */
  requiredIndicator?: boolean;
}

/**
 * A high-impact numeric/text input component with a minimalist bottom border design.
 * 
 * Supports vertical and horizontal layouts, custom units, and error states.
 * It forwards refs to the underlying HTML input element for use with form libraries.
 * 
 * @param props - Component properties ({@link ThinInputProps})
 * @param ref - Forwarded ref for the input element
 * @returns The rendered input component.
 */
export const ThinInput = forwardRef<HTMLInputElement, ThinInputProps>(
  ({ label, unit, error, align, layout = 'vertical', className, id, labelClassName, requiredIndicator = false, ...props }, ref) => {
    const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
    const errorId = `${inputId}-error`;
    const isHorizontal = layout === 'horizontal';
    const textAlignment = align || (isHorizontal || unit ? 'right' : 'left');
    const describedBy = [props['aria-describedby'], error ? errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div
        className={`flex w-full transition-colors duration-300 ${
          isHorizontal
            ? 'flex-col md:flex-row md:items-center md:justify-between md:gap-4 md:border-b md:border-secondary/20 md:focus-within:border-accent'
            : 'flex-col'
        }`}
      >
        <label 
          htmlFor={inputId} 
          className={`${labelClassName ?? ''} font-medium text-secondary uppercase tracking-[0.12em] leading-none shrink-0 transition-all duration-300 ${
            isHorizontal 
              ? 'text-[13px] mb-1 md:mb-0' 
              : 'text-[13px] mb-1'
          }`}
        >
          {label}
          {requiredIndicator && (
            <>
              {' '}
              <span className="text-primary" aria-hidden="true">*</span>
            </>
          )}
        </label>
        <div 
          className={`flex items-center transition-colors duration-300 py-1 ${
            isHorizontal 
              ? 'flex-1 justify-end border-b border-secondary/20 md:border-none focus-within:border-accent md:focus-within:border-none' 
              : `border-b border-secondary/20 focus-within:border-accent ${
                  error ? 'border-red-500 focus-within:border-red-500' : ''
                }`
          }`}
        >
          <input
            ref={ref}
            id={inputId}
            {...props}
            aria-describedby={describedBy}
            aria-invalid={error ? 'true' : props['aria-invalid']}
            aria-required={props.required ? 'true' : props['aria-required']}
            className={`flex-1 bg-transparent text-2xl md:text-4xl font-medium tabular-nums outline-none placeholder:text-secondary/20 transition-all ${
              textAlignment === 'right' ? 'text-right' : 'text-left'
            } ${className || ''}`}
          />
          {unit && (
            <span className="text-base md:text-xl text-secondary font-medium ml-2 shrink-0 min-w-[24px] md:min-w-[32px] text-right">
              {unit}
            </span>
          )}
        </div>
        {error && (
          <p id={errorId} className="text-sm text-red-500 font-medium mt-1.5">{error}</p>
        )}
      </div>
    );
  }
);

ThinInput.displayName = 'ThinInput';
