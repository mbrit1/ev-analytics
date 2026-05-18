# Design System Sandbox v2.0 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the EV Analytics UI to the "Design System Sandbox v2.0" aesthetic, featuring "Thin Underline" inputs, "Tactile Matrix" grids, and "Floating Slab" containers using Tailwind v4 tokens.

**Architecture:** Leverage Tailwind v4's CSS-First token system to define the Sandbox design system in `index.css`. Extract core UI paradigms into reusable components (`Slab`, `ThinInput`, `TactileMatrix`) and refactor feature forms to use them.

**Tech Stack:** React, Tailwind CSS v4, Lucide React, react-hook-form, Vitest.

---

## File Mapping

### New Files

- `src/components/ui/Slab.tsx`: Reusable container with Sandbox shadow and radius.
- `src/components/ui/ThinInput.tsx`: High-impact numeric/text input with bottom border.
- `src/components/ui/TactileMatrix.tsx`: Zero-typing radio-based selection grid.

### Modified Files

- `src/index.css`: Define Sandbox v2.0 tokens and global resets.
- `src/App.tsx`: Update layout shell and navigation.
- `src/features/auth/components/LoginForm.tsx`: Apply new styling.
- `src/features/charging-sessions/components/SessionForm.tsx`: Implement Matrix and Thin Inputs.
- `src/features/charging-sessions/components/ChargingHistory.tsx`: Apply Slab styling to cards.
- `src/features/tariffs/components/TariffForm.tsx`: Apply new styling.

---

### Task 1: Sandbox v2.0 Tokens & Global CSS

**Files:**

- Modify: `src/index.css`

- [ ] **Step 1: Define Sandbox tokens in `index.css`**

```css
@import "tailwindcss";

@theme {
  --color-environment: #F5F5F7;
  --color-surface: #FFFFFF;
  --color-accent: #007AFF;
  --color-primary: #1D1D1F;
  --color-secondary: #86868B;
  
  --shadow-slab: 0 10px 30px rgba(0, 0, 0, 0.04);
  --radius-slab: 28px;
  
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Rounded", sans-serif;
}

@layer base {
  :root {
    --bg-environment: var(--color-environment);
    --surface-slab: var(--color-surface);
    --primary-typography: var(--color-primary);
    --secondary-typography: var(--color-secondary);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg-environment: #000000;
      --surface-slab: #1C1C1E;
      --primary-typography: #F5F5F7;
      --secondary-typography: #8E8E93;
    }
  }

  body {
    background-color: var(--bg-environment);
    color: var(--primary-typography);
    @apply antialiased;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(design): integrate Sandbox v2.0 tokens into index.css"
```

---

### Task 2: Base UI Component - Slab

**Files:**

- Create: `src/components/ui/Slab.tsx`
- Test: `src/components/ui/Slab.test.tsx`

- [ ] **Step 1: Create Slab component**

```tsx
import React from 'react';

interface SlabProps {
  children: React.ReactNode;
  className?: string;
}

export const Slab: React.FC<SlabProps> = ({ children, className = '' }) => {
  return (
    <div className={`bg-surface border border-secondary/10 rounded-slab shadow-slab p-8 transition-colors duration-300 ${className}`}>
      {children}
    </div>
  );
};
```

- [ ] **Step 2: Create simple test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Slab } from './Slab';

describe('Slab', () => {
  it('renders children correctly', () => {
    render(<Slab>Test Content</Slab>);
    expect(screen.getByText('Test Content')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test**

Run: `npm run test -- src/components/ui/Slab.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Slab.tsx src/components/ui/Slab.test.tsx
git commit -m "feat(design): add reusable Slab component"
```

---

### Task 3: Base UI Component - ThinInput

**Files:**

- Create: `src/components/ui/ThinInput.tsx`

- [ ] **Step 1: Create ThinInput component**

```tsx
import React from 'react';

interface ThinInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  unit?: string;
  error?: string;
}

export const ThinInput = React.forwardRef<HTMLInputElement, ThinInputProps>(
  ({ label, unit, error, className = '', ...props }, ref) => {
    return (
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-secondary">
          {label}
        </label>
        <div className="flex items-baseline border-b border-secondary/20 focus-within:border-accent transition-colors">
          <input
            ref={ref}
            className={`w-full bg-transparent text-4xl font-medium tabular-nums text-primary outline-none py-2 placeholder:text-secondary/30 ${className}`}
            {...props}
          />
          {unit && <span className="text-lg text-secondary font-medium ml-2">{unit}</span>}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/ThinInput.tsx
git commit -m "feat(design): add reusable ThinInput component"
```

---

### Task 4: Base UI Component - TactileMatrix

**Files:**

- Create: `src/components/ui/TactileMatrix.tsx`

- [ ] **Step 1: Create TactileMatrix component**

```tsx
import React from 'react';

interface Option {
  label: string;
  value: string;
}

interface TactileMatrixProps {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const TactileMatrix: React.FC<TactileMatrixProps> = ({ label, options, value, onChange, className = '' }) => {
  return (
    <div className={`space-y-2 ${className}`}>
      <span className="text-xs font-bold uppercase tracking-wider text-secondary">{label}</span>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`py-3 px-4 rounded-xl font-bold text-sm transition-all min-h-[44px] ${
              value === opt.value
                ? 'bg-primary text-surface shadow-md scale-[1.02]'
                : 'bg-secondary/10 text-primary hover:bg-secondary/20'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/TactileMatrix.tsx
git commit -m "feat(design): add reusable TactileMatrix component"
```

---

### Task 5: App Shell Migration

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Update App.tsx layout and styles**

```tsx
// Remove old bg-slate-50 classes, replace with bg-environment
// Wrap main content in a max-width container with padding-top
// Simplify header to match the minimalist Sandbox style
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(design): update App shell layout to match Sandbox v2.0"
```

---

### Task 6: SessionForm Refactor

**Files:**

- Modify: `src/features/charging-sessions/components/SessionForm.tsx`

- [ ] **Step 1: Replace inputs with ThinInput and TactileMatrix**

- [ ] **Step 2: Wrap form in Slab component**

- [ ] **Step 3: Update field styles for Provider/Tariff selects** (Minimalist selects)

- [ ] **Step 4: Commit**

```bash
git add src/features/charging-sessions/components/SessionForm.tsx
git commit -m "feat(design): refactor SessionForm with Sandbox components"
```

---

### Task 7: History & Lists Migration

**Files:**

- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
- Modify: `src/features/tariffs/components/TariffList.tsx`

- [ ] **Step 1: Wrap history cards and list items in Slab component**

- [ ] **Step 2: Update typography scale for metrics (large numbers)**

- [ ] **Step 3: Commit**

```bash
git add src/features/charging-sessions/components/ChargingHistory.tsx src/features/tariffs/components/TariffList.tsx
git commit -m "feat(design): apply Slab and display-large styles to history and lists"
```
