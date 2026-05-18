# Design Spec: Horizontal Row Numeric Inputs

## 1. Problem Statement
The current vertical layout for numeric inputs with units (kWh, km, %) creates a visual disconnection on wide screens. Right-aligning the input solves the unit-value coupling but leaves a large gap between the label and the data.

## 2. Goal
Implement a horizontal row layout for numeric inputs (iOS Style) where labels and values are on the same line, ensuring data remains visually connected and the interface feels native and balanced.

## 3. Requirements

### 3.1. Component Refactor (`ThinInput.tsx`)
- Support a `layout` prop: `"vertical"` (default) or `"horizontal"`.
- **Horizontal Mode:**
  - Label on the left.
  - Input and unit on the right.
  - Tightly coupled grouping (`flex items-center justify-end gap-2`).
  - Full-width underline (`border-b`).
  - Text alignment inside the input should be `right`.

### 3.2. Visual Consistency
- Maintain existing typography (`text-4xl` for values, `text-[13px]` for labels).
- Ensure a minimum hit area of 44px for the entire row.
- Preserve error state rendering (below the row).

### 3.3. Application in `SessionForm.tsx`
- Apply `layout="horizontal"` to:
  - kWh Billed
  - kWh Added
  - Odometer
  - Start SoC
  - End SoC
- Keep `layout="vertical"` for text/date fields where appropriate.

## 4. Architecture

### 4.1. Props
- `layout?: 'vertical' | 'horizontal'`
- Existing props (`label`, `unit`, `error`, etc.) remain.

### 4.2. Styling
- Use Flexbox for layout switching.
- Ensure the input expands to fill the space between label and unit in horizontal mode.

## 5. Success Criteria
- [ ] Numeric inputs and labels stay visually connected on all screen sizes.
- [ ] No "dead zone" gaps between labels and values in horizontal mode.
- [ ] Component remains fully keyboard accessible and screen-reader friendly.
- [ ] All unit tests pass.
