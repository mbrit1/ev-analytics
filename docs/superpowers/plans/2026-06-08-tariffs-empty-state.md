# Tariffs Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sessions-style empty-state card to the Tariffs screen when no plans exist and the tariff form is closed, while preserving current form and non-empty list behavior.

**Architecture:** Keep the change entirely inside the charging-plans feature UI layer. Extend `TariffList.tsx` with a small conditional render branch that mirrors the existing Sessions empty-state markup, then lock the behavior in with focused RTL/Vitest coverage in `TariffList.test.tsx`.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, lucide-react, shared `Slab` UI primitive

---

## File Map

- Modify: `src/features/charging-plans/components/TariffList.tsx`
  Renders the Tariffs page header, create/edit form, and tariff cards. This is
  where the empty-state conditional belongs because the behavior is
  presentation-only.
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
  Existing component-level test coverage for the Tariffs screen. Add the new
  empty-state assertions here rather than creating a second test file.
- Reference only: `src/features/charging-sessions/components/ChargingHistory.tsx`
  Existing Sessions empty-state markup and class choices to mirror closely.

### Task 1: Add empty-state test coverage first

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.test.tsx:1-337`
- Reference: `src/features/charging-plans/components/TariffList.tsx:55-157`
- Reference: `src/features/charging-sessions/components/ChargingHistory.tsx:30-37`

- [ ] **Step 1: Write the failing tests for the new empty-state behavior**

Add these two tests near the bottom of
`src/features/charging-plans/components/TariffList.test.tsx`, after the
existing `opens the create form when the parent requests tariff creation` test.
Also extend that existing parent-create test with the negative empty-state
assertion shown below so the empty `plans: []` + form-open state is covered:

```tsx
  it('renders a sessions-style empty state and keeps the desktop add action visible when no plans exist', () => {
    // Arrange: No plans and no open form should show the informative empty state.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    // Act: Render the tariffs screen in its closed, empty state.
    renderTariffList();

    // Assert: The empty-state headline, copy, and desktop CTA are all visible.
    expect(screen.getByText('No Tariffs Yet')).toBeInTheDocument();
    expect(
      screen.getByText('Your saved tariffs will appear here once you add your first tariff.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add tariff/i })).toBeInTheDocument();
    expect(screen.queryByText('Tariff Form')).not.toBeInTheDocument();
  });

  it('keeps existing list behavior when the form is open and suppresses the empty state', () => {
    // Arrange: A non-empty list should stay visible under the edit form.
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [
        {
          id: 't1',
          user_id: 'u1',
          provider_id: 'p1',
          name: 'Primary Plan',
          valid_from: new Date(),
          valid_to: null,
          ac_price_per_kwh: 39,
          dc_price_per_kwh: 59,
          monthly_base_fee: 0,
          session_fee: 0,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
      isLoading: false,
    });

    renderTariffList();

    // Act: Open the edit form from an existing tariff card.
    fireEvent.click(screen.getByRole('button', { name: /edit ionity primary plan/i }));

    // Assert: The form opens, the existing list remains visible, and no empty state appears.
    expect(screen.getByText('Tariff Form')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ionity', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText('No Tariffs Yet')).not.toBeInTheDocument();
  });

  // Add this assertion to the existing parent-create test:
  expect(screen.queryByText('No Tariffs Yet')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the component test file to verify the first test fails**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx
```

Expected:

```text
FAIL  src/features/charging-plans/components/TariffList.test.tsx
TestingLibraryElementError: Unable to find an element with the text: No Tariffs Yet
```

The second new test and the added parent-create assertion should already pass
against current behavior because the non-empty list currently remains rendered
beneath an open form and the empty create form currently renders without an
empty state. That is fine: the important failing signal is the missing
empty-state card in the closed, empty state.

- [ ] **Step 3: Commit the failing-test checkpoint**

Run:

```bash
git add src/features/charging-plans/components/TariffList.test.tsx
git commit -m "test(charging-plans): cover tariffs empty state"
```

### Task 2: Implement the empty-state branch in `TariffList`

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx:1-159`
- Reference: `src/features/charging-sessions/components/ChargingHistory.tsx:30-37`
- Test: `src/features/charging-plans/components/TariffList.test.tsx`

- [ ] **Step 1: Add the minimal implementation**

Update `src/features/charging-plans/components/TariffList.tsx` as follows:

```tsx
import { useEffect, useState } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../../shared/lib';
import { type ChargingPlan } from '../../../infra/db';
import { useChargingPlans } from '../hooks/useChargingPlans';
import { useProviders } from '../hooks/useProviders';
import { TariffFormLoader } from './TariffFormLoader';
import { Slab } from '../../../shared/ui';

/**
 * Tariffs screen backed by the charging-plan domain.
 */
interface TariffListProps {
  /** Controls whether the create form should open from the parent shell. */
  isCreatingTariff: boolean
  /** Clears the parent-owned tariff create request when consumed or dismissed. */
  onCreateTariffChange: (isCreatingTariff: boolean) => void
  /** Emits whether the create/edit form surface is currently open. */
  onFormOpenChange?: (isOpen: boolean) => void
}

/**
 * Tariffs screen backed by the charging-plan domain.
 */
export function TariffList({
  isCreatingTariff,
  onCreateTariffChange,
  onFormOpenChange,
}: TariffListProps) {
  const { plans, addChargingPlan, removeChargingPlan, isLoading } = useChargingPlans()
  const { providers } = useProviders()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<ChargingPlan | undefined>(undefined)
  const isCreateRequested = isCreatingTariff && !isFormOpen
  const isFormVisible = isFormOpen || isCreateRequested
  const hasPlans = plans.length > 0

  useEffect(() => {
    onFormOpenChange?.(isFormVisible)
  }, [isFormVisible, onFormOpenChange])

  const handleSubmit = async (plan: ChargingPlan) => {
    await addChargingPlan(plan)
    setIsFormOpen(false)
    setEditingPlan(undefined)
    onCreateTariffChange(false)
  }

  if (isLoading) {
    return <div>Loading tariffs...</div>
  }

  const shouldRenderOptionalAmount = (amount: number | undefined): amount is number => amount != null && amount > 0
  const providerNameById = new Map(providers.map((provider) => [provider.id, provider.name]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Tariffs</h1>
        {!isFormVisible && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="hidden md:flex items-center px-4 py-2 bg-accent text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-md shadow-accent/20 min-h-[44px]"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Tariff
          </button>
        )}
      </div>

      {isFormVisible && (
        <TariffFormLoader
          onSubmit={handleSubmit}
          onCancel={() => {
            setIsFormOpen(false)
            setEditingPlan(undefined)
            onCreateTariffChange(false)
          }}
          initialValues={isCreatingTariff ? undefined : editingPlan}
        />
      )}

      {!isFormVisible && !hasPlans && (
        <Slab className="text-center p-12">
          <Info className="w-12 h-12 text-secondary/30 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-primary mb-2">No Tariffs Yet</h2>
          <p className="text-secondary">
            Your saved tariffs will appear here once you add your first tariff.
          </p>
        </Slab>
      )}

      {plans.map((plan) => {
        const providerName = providerNameById.get(plan.provider_id) ?? plan.provider_id;
        const variantName = (plan.name ?? '').trim();
        const editLabel = variantName.length > 0 ? `Edit ${providerName} ${variantName}` : `Edit ${providerName}`;
        const deleteLabel = variantName.length > 0 ? `Delete ${providerName} ${variantName}` : `Delete ${providerName}`;

        return (
          <Slab key={plan.id} className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-primary">{providerName}</h2>
                {variantName.length > 0 && (
                  <p className="text-sm text-secondary">{variantName}</p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setEditingPlan(plan)
                    setIsFormOpen(true)
                  }}
                  aria-label={editLabel}
                  className="inline-flex items-center justify-center px-3 py-2 bg-secondary/10 text-primary font-bold rounded-xl hover:bg-secondary/20 transition-all min-h-[44px] sm:px-4"
                >
                  <span className="text-lg leading-none sm:hidden" aria-hidden="true">✎</span>
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => removeChargingPlan(plan.id)}
                  aria-label={deleteLabel}
                  className="inline-flex items-center justify-center px-3 py-2 border border-secondary/20 text-primary font-bold rounded-xl hover:bg-secondary/5 transition-all min-h-[44px] sm:px-4"
                >
                  <Trash2 className="h-4 w-4 sm:hidden" aria-hidden="true" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </div>
            </div>

            <div className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Domestic AC</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">{plan.ac_price_per_kwh == null ? '—' : formatCurrency(plan.ac_price_per_kwh)}</span>
              </div>
              <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                <span>Domestic DC</span>
                <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums font-medium">{plan.dc_price_per_kwh == null ? '—' : formatCurrency(plan.dc_price_per_kwh)}</span>
              </div>
              {shouldRenderOptionalAmount(plan.roaming_ac_price_per_kwh) && (
                <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                  <span>Roaming AC</span>
                  <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.roaming_ac_price_per_kwh)}</span>
                </div>
              )}
              {shouldRenderOptionalAmount(plan.roaming_dc_price_per_kwh) && (
                <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                  <span>Roaming DC</span>
                  <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.roaming_dc_price_per_kwh)}</span>
                </div>
              )}
              {shouldRenderOptionalAmount(plan.monthly_base_fee) && (
                <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                  <span>Monthly Base Fee</span>
                  <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.monthly_base_fee)}</span>
                </div>
              )}
              {shouldRenderOptionalAmount(plan.session_fee) && (
                <div className="grid w-fit grid-cols-[auto_auto] items-baseline justify-start gap-x-3">
                  <span>Session Fee</span>
                  <span className="min-w-[6ch] whitespace-nowrap text-right tabular-nums">{formatCurrency(plan.session_fee)}</span>
                </div>
              )}
            </div>
          </Slab>
        );
      })}
    </div>
  );
}
```

Why this is the minimal change:

- imports only the missing `Info` icon,
- adds one local boolean, `hasPlans`,
- adds one conditional branch for the empty state,
- keeps existing form-open and list rendering logic unchanged.

- [ ] **Step 2: Run the targeted component test file**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx
```

Expected:

```text
PASS  src/features/charging-plans/components/TariffList.test.tsx
```

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx
git commit -m "feat(charging-plans): add tariffs empty state"
```

### Task 3: Verify against the spec and guard against regressions

**Files:**
- Verify: `src/features/charging-plans/components/TariffList.tsx`
- Verify: `src/features/charging-plans/components/TariffList.test.tsx`

- [ ] **Step 1: Re-read the approved spec and compare behavior**

Use this checklist while reviewing the diff:

```text
[ ] Empty-state card appears only when plans.length === 0 and the form is closed.
[ ] Empty-state card uses Slab + Info + headline + supporting copy.
[ ] Copy matches the spec exactly.
[ ] Desktop inline Add Tariff button remains visible in the empty state.
[ ] Mobile contextual Add Tariff flow is unchanged because App.tsx was not modified.
[ ] Existing tariff cards still render under an open edit/create form when plans exist.
```

- [ ] **Step 2: Run focused lint/test/build verification**

Run:

```bash
npm run lint
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx
npm run build
```

Expected:

```text
lint: no errors
test: PASS for src/features/charging-plans/components/TariffList.test.tsx
build: Vite production build completes successfully
```

- [ ] **Step 3: Commit the verification checkpoint**

Run:

```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx
git commit -m "test(charging-plans): verify tariffs empty state"
```

## Spec Coverage Check

- `plans.length === 0` + closed form empty state:
  Covered by Task 1 test 1 and Task 2 implementation branch.
- Match Sessions visual pattern:
  Covered by Task 2 implementation using the same `Slab` + `Info` + headline +
  body structure and classes.
- Desktop inline CTA remains visible:
  Covered by Task 1 test 1 and preserved in Task 2.
- Mobile contextual action unchanged:
  Covered by the plan boundary itself; `App.tsx` is intentionally untouched and
  verified in Task 3 checklist.
- Existing non-empty cards remain rendered under an open form:
  Covered by Task 1 test 2 and preserved by Task 2.

## Placeholder Scan

Checked for `TBD`, `TODO`, vague “handle appropriately” language, and missing
commands. None remain.

## Type Consistency Check

- Uses existing `TariffList` prop names: `isCreatingTariff`,
  `onCreateTariffChange`, `onFormOpenChange`.
- Uses existing hook names: `useChargingPlans`, `useProviders`.
- Uses existing component names: `TariffFormLoader`, `Slab`.
- Uses the exact approved copy from the spec.
