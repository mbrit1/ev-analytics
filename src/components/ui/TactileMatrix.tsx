import React from 'react';

interface TactileOption {
  label: string;
  value: string;
}

interface TactileMatrixProps {
  label: string;
  options: TactileOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const TactileMatrix: React.FC<TactileMatrixProps> = ({
  label,
  options,
  value,
  onChange,
  className = '',
}) => {
  const labelId = React.useId();

  return (
    <div 
      className={`flex flex-col w-full ${className}`}
      role="radiogroup"
      aria-labelledby={labelId}
    >
      <span 
        id={labelId}
        className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-3"
      >
        {label}
      </span>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.value)}
              className={`
                py-3 px-4 rounded-xl font-bold text-sm transition-all min-h-[44px] cursor-pointer
                flex items-center justify-center text-center
                ${
                  isActive
                    ? 'bg-primary text-surface shadow-md scale-[1.02]'
                    : 'bg-secondary/10 text-primary hover:bg-secondary/20'
                }
              `}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
