# Charging History Header Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the charging history page header and monthly group headers so the screen reads as a cleaner chronological history view without session counts or dashboard-like summary density.

**Architecture:** Keep the change presentation-only inside the existing `ChargingHistory` component and its UI test. Reuse the existing month-group data, localized number formatters, and session card markup while tightening spacing and replacing the responsive split-row month header with a compact two-line stack on every breakpoint.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, Tailwind utility classes, Dexie-backed session test fixtures

---

## File Structure

- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`
  - Update UI assertions to reflect the new `kWh · €` month-summary order and the removal of session-count copy.
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
  - Tighten page-title spacing and replace the month-header row layout with a compact stacked block.
- Create: no new files
  - The approved design keeps this refinement inside the existing component and test rather than introducing a new abstraction.

### Task 1: Lock in the new header behavior with a failing UI test

**Files:**
- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`
- Test: `src/features/charging-sessions/components/ChargingHistory.test.tsx`

- [ ] **Step 1: Update the grouped-history assertions to describe the new hierarchy**

Replace the final assertions in the `renders month group labels and stable summaries while keeping session cards visible` test with:

```tsx
    // Assert: Group labels, compact summaries, and existing cards all remain visible.
    expect(screen.getByText('Mai 2026')).toBeInTheDocument();
    expect(screen.getByText('51,75 kWh · 22,00 €')).toBeInTheDocument();
    expect(screen.getByText('51,25 kWh · 22,04 €')).toBeInTheDocument();
    expect(screen.queryByText('2 Sessions · 22,00 € · 51,75 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('1 Session · 22,04 € · 51,25 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('2 Sessions')).not.toBeInTheDocument();
    expect(screen.getAllByText('Tesla')).toHaveLength(2);
    expect(screen.getByText('Ionity')).toBeInTheDocument();
    expect(screen.getByText('22,00 €')).toBeInTheDocument();
    expect(screen.getByText('0,00 €')).toBeInTheDocument();
```

- [ ] **Step 2: Run the targeted UI test to confirm it fails first**

Run:

```bash
npm run test -- --run src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: FAIL because the current header still renders `Sessions · € · kWh` copy instead of the new stacked `kWh · €` summary.

- [ ] **Step 3: Commit the failing test change**

Run:

```bash
git add src/features/charging-sessions/components/ChargingHistory.test.tsx
git commit -m "test(charging-sessions): cover refined history headers"
```

Expected: a commit containing only the updated UI expectation.

### Task 2: Implement the compact page and month headers

**Files:**
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
- Test: `src/features/charging-sessions/components/ChargingHistory.test.tsx`

- [ ] **Step 1: Update the non-empty page title spacing and month-header markup**

In `src/features/charging-sessions/components/ChargingHistory.tsx`, replace the non-empty page header and month header block:

```tsx
    <div className="space-y-6">
      <h2 className="text-sm font-bold text-secondary uppercase tracking-widest mb-4 px-2">
        Charging History
      </h2>
      <div className="space-y-6">
        {monthGroups.map((group) => (
          <section key={group.monthKey} className="space-y-4">
            <header className="border-t border-slab-border/70 px-2 pt-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className="text-sm font-semibold text-primary">
                  {group.label}
                </h3>
                <p className="text-sm text-secondary tabular-nums">
                  {group.count} {group.count === 1 ? 'Session' : 'Sessions'} · {formatCurrency(group.totalCostCents)} · {formatKwh(group.totalKwh)} kWh
                </p>
              </div>
            </header>
```

with:

```tsx
    <div className="space-y-5">
      <h2 className="px-2 text-xl font-bold tracking-tight text-primary">
        Charging History
      </h2>
      <div className="space-y-6">
        {monthGroups.map((group) => (
          <section key={group.monthKey} className="space-y-4">
            <header className="border-t border-slab-border/70 px-2 pt-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-primary">
                  {group.label}
                </h3>
                <p className="text-sm text-secondary tabular-nums">
                  {formatKwh(group.totalKwh)} kWh · {formatCurrency(group.totalCostCents)}
                </p>
              </div>
            </header>
```

This keeps the existing tokens and typography roles, removes the session count, preserves the localized formatters, and keeps the month header stacked on desktop and mobile.

- [ ] **Step 2: Run the focused UI test to verify the refined header passes**

Run:

```bash
npm run test -- --run src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: PASS with the updated title still present, month labels still present, new `kWh · €` summaries visible, and session cards unchanged.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add src/features/charging-sessions/components/ChargingHistory.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx
git commit -m "feat(charging-sessions): refine charging history headers"
```

Expected: a commit containing only the header markup/class updates and the matching test changes.

### Task 3: Run project verification and prepare handoff

**Files:**
- Modify: none
- Test: `src/features/charging-sessions/components/ChargingHistory.test.tsx`

- [ ] **Step 1: Run the repository verification commands required by `AGENTS.md`**

Run:

```bash
npm run lint
npm run test -- --run
npm run build
```

Expected:

- `npm run lint`: PASS with no new lint violations.
- `npm run test -- --run`: PASS with the charging history test updated and no regressions elsewhere.
- `npm run build`: PASS with the app type-checking and production bundle completing successfully.

- [ ] **Step 2: Capture concise handoff notes**

Prepare a short handoff summary that includes:

- changed files: `src/features/charging-sessions/components/ChargingHistory.tsx`, `src/features/charging-sessions/components/ChargingHistory.test.tsx`
- verification results from lint, tests, and build
- risk note: spacing is visually refined but still depends on existing token classes and should be spot-checked in the browser if a design QA pass is desired
- suggested commit message:

```text
feat(charging-sessions): refine charging history headers
```

- [ ] **Step 3: If requested, stage the final implementation commit for review**

Run:

```bash
git status --short
```

Expected: clean working tree after the verification pass and implementation commit, or a clearly explained list of any intentional remaining changes.
