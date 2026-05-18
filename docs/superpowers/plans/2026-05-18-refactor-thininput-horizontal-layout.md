# Refactor ThinInput for Horizontal Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the `ThinInput` component to support a horizontal layout mode ('vertical' | 'horizontal') for numeric fields, ensuring visual alignment on wide viewports.

**Architecture:** Add a `layout` prop to `ThinInput`. In horizontal mode, the component will use flex-row with the label on the left and the input+unit on the right, sharing a single bottom border on the outer wrapper.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, React Testing Library.

---

### Task 1: Add Horizontal Layout Support to ThinInput

**Files:**
- Modify: `src/components/ui/ThinInput.tsx`
- Modify: `src/components/ui/ThinInput.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test case to `src/components/ui/ThinInput.test.tsx`:

```tsx
  it('applies horizontal layout classes when requested', () => {
    const { container } = render(<ThinInput label="kWh Billed" layout="horizontal" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('flex-row');
    expect(wrapper).toHaveClass('items-center');
    expect(wrapper).toHaveClass('border-b');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test src/components/ui/ThinInput.test.tsx`
Expected: FAIL (Compilation error: Property 'layout' does not exist on type 'ThinInputProps')

- [ ] **Step 3: Update ThinInputProps and Implementation**

Modify `src/components/ui/ThinInput.tsx` to include `layout` prop and update the component structure.

```tsx
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
            ? 'flex-row items-center justify-between gap-4 border-b border-secondary/20 focus-within:border-accent' 
            : 'flex-col'
        }`}
      >
        <label 
          htmlFor={inputId} 
          className={`font-medium text-secondary uppercase tracking-wider shrink-0 ${
            isHorizontal ? 'text-xs' : 'text-[13px] mb-1'
          }`}
        >
          {label}
        </label>
        <div 
          className={`flex items-baseline transition-colors duration-300 py-1 ${
            isHorizontal 
              ? 'flex-1' 
              : `border-b border-secondary/20 focus-within:border-accent ${
                  error ? 'border-red-500 focus-within:border-red-500' : ''
                }`
          }`}
        >
          <input
            ref={ref}
            id={inputId}
            className={`flex-1 bg-transparent text-4xl font-medium tabular-nums outline-none placeholder:text-secondary/20 ${
              textAlignment === 'right' ? 'text-right' : 'text-left'
            } ${className || ''}`}
            {...props}
          />
          {unit && (
            <span className="text-xl text-secondary font-medium ml-2 shrink-0">
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test src/components/ui/ThinInput.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ThinInput.tsx src/components/ui/ThinInput.test.tsx
git commit -m "feat(ui): refactor ThinInput to support horizontal layout"
```
