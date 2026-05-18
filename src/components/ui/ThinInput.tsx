import React, { forwardRef } from 'react';

interface ThinInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  unit?: string;
  error?: string;
  align?: 'left' | 'right';
  layout?: 'vertical' | 'horizontal';
}

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
