# Remove Tariff History Page UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the tariff-page history trigger and history sheet while preserving stored tariff history data for later analytics work.

**Architecture:** Keep `logicalTariff.history` and all data/model behavior intact, but detach the tariff page from the `history` surface. Clean up the now-unused page-only history component and align tests with the slimmer page interaction model.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library

---

### Task 1: Lock the UI expectation with a failing tariff-list test

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
- Verify: `src/features/charging-plans/components/TariffList.tsx`

- [ ] **Step 1: Replace the card-level history access test with an absence assertion**

```tsx
it('does not expose tariff history entry points on the tariff card', () => {
  // Arrange: Render a logical tariff that still carries history data.
  vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({
    logicalTariffs: [
      buildLogicalTariff({
        history: [
          {
            plan: buildPlan({ id: 'baseline', valid_to: utc('2026-08-10'), ac_price_per_kwh: 29 }),
            labels: ['Past'],
            startDate: '2026-01-01',
            endDateInclusive: '2026-08-09',
          },
        ],
      }),
    ],
  }));

  // Act: Render the tariff list.
  renderTariffList();

  // Assert: The page keeps history data out of the tariff card UI.
  expect(screen.queryByRole('button', { name: /view history for ionity lidl/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /tariff history/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the right reason**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`
Expected: FAIL because the tariff card still renders the `View history for ...` button.

### Task 2: Remove tariff-page history wiring

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Check: `src/features/charging-plans/components/TariffVersionHistorySheet.tsx`

- [ ] **Step 1: Remove the history surface import, union member, conditional render, and card button**

```tsx
type ActiveSurface =
  | { kind: 'none' }
  | { kind: 'details'; key: string }
  | { kind: 'permanent_change'; key: string }
  | { kind: 'promotion'; key: string }
  | { kind: 'delete'; key: string };
```

```tsx
            {logicalTariff.upcomingVisibility.kind === 'preview' && (
              <div className="space-y-3">
                <div className="h-px bg-secondary/20" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold tabular-nums text-secondary">
                    {logicalTariff.upcomingVisibility.label}
                  </p>
                  {logicalTariff.upcomingVisibility.changes.length > 0 && (
                    <p className="text-sm tabular-nums text-primary">
                      {formatUpcomingPreviewCopy(logicalTariff.upcomingVisibility)}
                    </p>
                  )}
                </div>
              </div>
            )}
```

- [ ] **Step 2: Run the focused tariff-list test and verify it passes**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`
Expected: PASS, including the new absence assertion.

### Task 3: Remove the unused history-sheet component and verify no page references remain

**Files:**
- Delete: `src/features/charging-plans/components/TariffVersionHistorySheet.tsx`
- Delete: `src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx`

- [ ] **Step 1: Delete the page-only history sheet component and its dedicated test**

```text
Remove the unused TariffVersionHistorySheet component files after TariffList no longer imports or renders them.
```

- [ ] **Step 2: Verify no app code still references the removed component**

Run: `rg -n "TariffVersionHistorySheet|View history for|kind: 'history'" src/features/charging-plans`
Expected: no matches

### Task 4: Run regression verification for the changed tariff page

**Files:**
- Verify: `src/features/charging-plans/components/TariffList.test.tsx`
- Verify: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`

- [ ] **Step 1: Run targeted component tests**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`
Expected: PASS

- [ ] **Step 2: Run lint for the affected code path**

Run: `npm run lint`
Expected: PASS
