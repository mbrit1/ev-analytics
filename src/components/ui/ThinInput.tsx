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
  ({ label, unit, error, align, layout = 'vertical', className, id, ...props }, ref) => {
    const inputId = id || label.toLowerCase().replace(/\s+/g, '-');
    const isHorizontal = layout === 'horizontal';
    const textAlignment = align || (isHorizontal || unit ? 'right' : 'left');

    return (
      <div 
        className={`flex w-full transition-colors duration-300 ${
          isHorizontal 
            ? 'md:flex-row md:items-center md:justify-between md:gap-4 md:border-b md:border-secondary/20 md:focus-within:border-accent' 
            : 'flex-col'
        } ${!isHorizontal ? 'flex-col' : ''}`}
      >
        <label 
          htmlFor={inputId} 
          className={`font-medium text-secondary uppercase tracking-wider shrink-0 transition-all duration-300 ${
            isHorizontal 
              ? 'text-[11px] md:text-xs mb-1 md:mb-0' 
              : 'text-[13px] mb-1'
          }`}
        >
          {label}
        </label>
        <div 
          className={`flex items-baseline transition-colors duration-300 py-1 ${
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
            className={`flex-1 bg-transparent text-2xl md:text-4xl font-medium tabular-nums outline-none placeholder:text-secondary/20 transition-all ${
              textAlignment === 'right' ? 'text-right' : 'text-left'
            } ${className || ''}`}
            {...props}
          />
          {unit && (
            <span className="text-base md:text-xl text-secondary font-medium ml-2 shrink-0 min-w-[24px] md:min-w-[32px] text-right">
              {unit}
            </span>
          )}
        </div>
        {error && !isHorizontal && (
          <p className="text-sm text-red-500 font-medium mt-1.5">{error}</p>
        )}
      </div>
    );
  }
);

ThinInput.displayName = 'ThinInput';
