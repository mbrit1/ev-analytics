import React, { forwardRef } from 'react';

interface ThinInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  unit?: string;
  error?: string;
}

export const ThinInput = forwardRef<HTMLInputElement, ThinInputProps>(
  ({ label, unit, error, className, id, ...props }, ref) => {
    const inputId = id || label.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col w-full">
        <label 
          htmlFor={inputId} 
          className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1"
        >
          {label}
        </label>
        <div 
          className={`flex items-baseline border-b border-secondary/20 focus-within:border-accent transition-colors duration-300 py-1 ${
            error ? 'border-red-500 focus-within:border-red-500' : ''
          }`}
        >
          <input
            ref={ref}
            id={inputId}
            className={`flex-1 bg-transparent text-4xl font-medium tabular-nums outline-none placeholder:text-secondary/20 ${className || ''}`}
            {...props}
          />
          {unit && (
            <span className="text-lg text-secondary font-medium ml-2">
              {unit}
            </span>
          )}
        </div>
        {error && (
          <p className="text-sm text-red-500 font-medium mt-1.5">{error}</p>
        )}
      </div>
    );
  }
);

ThinInput.displayName = 'ThinInput';
