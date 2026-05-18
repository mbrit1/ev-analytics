# Horizontal Row Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `ThinInput` to support a horizontal layout for numeric fields to improve visual connection on wide screens.

**Architecture:** We will extend `ThinInput` with a `layout` prop. In `horizontal` mode, we'll use Flexbox to place the label on the left and the input + unit on the right, sharing a single bottom border.

**Tech Stack:** React, TypeScript, Tailwind CSS.

---

### Task 1: Refactor `ThinInput` Component

**Files:**
- Modify: `src/components/ui/ThinInput.tsx`
- Modify: `src/components/ui/ThinInput.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/ThinInput.test.tsx
// Add a test case for horizontal layout
it('applies horizontal layout classes when requested', () => {
  const { container } = render(<ThinInput label="kWh Billed" layout="horizontal" />);
  // Check for the presence of horizontal layout classes (e.g., flex-row, items-center)
  const wrapper = container.firstChild as HTMLElement;
  expect(wrapper).toHaveClass('flex-row');
  expect(wrapper).toHaveClass('items-center');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/ui/ThinInput.test.tsx --run`
Expected: FAIL

- [ ] **Step 3: Update `ThinInput.tsx`**

```tsx
// src/components/ui/ThinInput.tsx
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
      <div className={`flex w-full ${isHorizontal ? 'flex-row items-center justify-between gap-4 border-b border-secondary/20 focus-within:border-accent transition-colors duration-300' : 'flex-col'}`}>
        <label 
          htmlFor={inputId} 
          className={`font-medium text-secondary uppercase tracking-wider ${
            isHorizontal ? 'text-xs shrink-0' : 'text-[13px] mb-1'
          }`}
        >
          {label}
        </label>
        
        <div 
          className={`flex items-baseline ${
            isHorizontal 
              ? 'flex-1 justify-end py-2' 
              : `border-b border-secondary/20 focus-within:border-accent transition-colors duration-300 py-1 ${
                  error ? 'border-red-500 focus-within:border-red-500' : ''
                }`
          }`}
        >
          <input
            ref={ref}
            id={inputId}
            className={`bg-transparent text-4xl font-medium tabular-nums outline-none placeholder:text-secondary/20 min-w-0 ${
              textAlignment === 'right' ? 'text-right' : 'text-left'
            } ${isHorizontal ? 'flex-1' : 'w-full'} ${className || ''}`}
            {...props}
          />
          {unit && (
            <span className={`text-secondary font-medium ml-2 shrink-0 ${isHorizontal ? 'text-xl' : 'text-lg min-w-[32px]'}`}>
              {unit}
            </span>
          )}
        </div>

        {error && !isHorizontal && (
          <p className="text-sm text-red-500 font-medium mt-1.5">{error}</p>
        )}
        {/* Note: Error handling for horizontal might need a separate row or absolute positioning if it occurs */}
      </div>
    );
  }
);

ThinInput.displayName = 'ThinInput';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/ui/ThinInput.test.tsx --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ThinInput.tsx src/components/ui/ThinInput.test.tsx
git commit -m "feat(ui): refactor ThinInput to support horizontal layout"
```

---

### Task 2: Apply Horizontal Layout to `SessionForm`

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`

- [ ] **Step 1: Update `SessionForm.tsx`**

We will apply `layout="horizontal"` to all numeric inputs (kWh, Odometer, SoC).

```tsx
// src/features/charging-sessions/components/SessionForm.tsx
// ... update kWh Billed
<ThinInput
  label="kWh Billed"
  unit="kWh"
  layout="horizontal" // Add this
  type="text"
  inputMode="decimal"
  placeholder="0,00"
  {...register('kwh_billed')}
  error={errors.kwh_billed?.message}
/>

// ... repeat for kWh Added, Odometer, Start SoC, End SoC
```

- [ ] **Step 2: Run verification**

Run: `npm run lint && npm run test -- --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/charging-sessions/components/SessionForm.tsx
git commit -m "feat(ui): apply horizontal layout to numeric fields in SessionForm"
```

---

### Task 3: Apply Horizontal Layout to `TariffForm`

**Files:**
- Modify: `src/features/tariffs/components/TariffForm.tsx`

- [ ] **Step 1: Update `TariffForm.tsx`**

Apply `layout="horizontal"` to AC Price, DC Price, and Session Fee.

```tsx
// src/features/tariffs/components/TariffForm.tsx
<ThinInput
  label="AC Price"
  unit="€/kWh"
  layout="horizontal" // Add this
  type="text"
  inputMode="decimal"
  {...register('ac_price')}
  error={errors.ac_price?.message}
  placeholder="0,55"
/>
// ... repeat for DC Price and Session Fee
```

- [ ] **Step 2: Run verification**

Run: `npm run lint && npm run test -- --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/tariffs/components/TariffForm.tsx
git commit -m "feat(ui): apply horizontal layout to price fields in TariffForm"
```
