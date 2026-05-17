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
  const buttonRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + options.length) % options.length;
        break;
      default:
        break;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextOption = options[nextIndex];
      onChange(nextOption.value);
      
      // Focus the next button after a small delay to allow React to re-render
      // or use a useEffect to handle focus when value changes.
      // Actually, we can just focus it directly since it's already in the DOM.
      buttonRefs.current[nextIndex]?.focus();
    }
  };

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
        {options.map((option, index) => {
          const isActive = option.value === value;
          // If no value matches, the first item should be focusable
          const isFocusable = isActive || (value === '' && index === 0);
          
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isFocusable ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
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
