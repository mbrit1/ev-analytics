# Session Form Provider-Scoped Plan Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the `Plan` field in session entry is gated by provider selection, filtered to provider-owned plans, and auto-selected when only one matching plan exists.

**Architecture:** Implement this behavior inside `SessionForm` by deriving `providerPlans` from selected provider and synchronizing `charging_plan_id` via a focused effect that enforces validity on provider changes. Keep `react-hook-form` as the single source of truth and drive behavior through existing hooks (`useProviders`, `useChargingPlans`) without changing services or persistence.

**Tech Stack:** React 19, TypeScript, react-hook-form, Vitest, React Testing Library.

---

### Task 1: Define failing UI behavior tests first

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`

- [ ] **Step 1: Expand mocked provider/plan fixtures to cover multi-provider and single-plan scenarios**

```ts
beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(useChargingPlans).mockReturnValue({
    chargingPlans: [
      {
        id: 't1',
        plan_name: 'P1 Home',
        provider_id: 'p1',
        prices: { domestic: { ac: 40, dc: 60 }, roaming: { ac: 50, dc: 70 } },
        fees: { sessionFixed: 0 }
      },
      {
        id: 't2',
        plan_name: 'P1 Flex',
        provider_id: 'p1',
        prices: { domestic: { ac: 44, dc: 64 }, roaming: { ac: 54, dc: 74 } },
        fees: { sessionFixed: 0 }
      },
      {
        id: 't3',
        plan_name: 'P2 Solo',
        provider_id: 'p2',
        prices: { domestic: { ac: 39, dc: 59 }, roaming: { ac: 49, dc: 69 } },
        fees: { sessionFixed: 0 }
      }
    ] as unknown as ChargingPlan[],
    isLoading: false,
    addChargingPlan: vi.fn(),
    removeChargingPlan: vi.fn(),
  });

  vi.mocked(useProviders).mockReturnValue({
    providers: [
      { id: 'p1', name: 'ChargePoint' },
      { id: 'p2', name: 'Ionity' }
    ] as unknown as Provider[],
    isLoading: false
  });
});
```

- [ ] **Step 2: Add test for disabled-until-provider behavior**

```ts
it('disables plan select until a provider is selected', () => {
  // Arrange: render with no provider selected.
  render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

  // Act: read plan control before and after provider selection.
  const planSelect = screen.getByLabelText(/plan/i);

  // Assert: disabled initially, enabled once provider is chosen.
  expect(planSelect).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
  expect(planSelect).not.toBeDisabled();
});
```

- [ ] **Step 3: Add test for provider-scoped option filtering**

```ts
it('shows only plans belonging to the selected provider', () => {
  // Arrange: render and choose provider p1.
  render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });

  // Act: collect visible plan option labels.
  const optionLabels = Array.from(screen.getByLabelText(/plan/i).querySelectorAll('option'))
    .map(option => option.textContent);

  // Assert: p1 plans exist, p2 plan is excluded.
  expect(optionLabels).toContain('P1 Home');
  expect(optionLabels).toContain('P1 Flex');
  expect(optionLabels).not.toContain('P2 Solo');
});
```

- [ ] **Step 4: Add test for single-plan auto-selection**

```ts
it('auto-selects the plan when selected provider has exactly one plan', () => {
  // Arrange: render fresh form.
  render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

  // Act: select provider p2 that has one plan.
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p2' } });

  // Assert: the single provider plan is selected automatically.
  expect(screen.getByLabelText(/plan/i)).toHaveValue('t3');
});
```

- [ ] **Step 5: Add test for stale selection reset on provider switch**

```ts
it('clears stale plan when provider changes to one that does not own it', () => {
  // Arrange: pick p1 and plan t1 first.
  render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 't1' } });

  // Act: switch to p2 (single-plan provider).
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'p2' } });

  // Assert: stale p1 plan is replaced by valid p2 single option.
  expect(screen.getByLabelText(/plan/i)).toHaveValue('t3');
});
```

- [ ] **Step 6: Run targeted component test file to confirm red state**

Run: `npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx`
Expected: FAIL on at least disabled and auto-select tests before implementation.

- [ ] **Step 7: Commit test-only changes**

```bash
git add src/features/charging-sessions/components/SessionForm.test.tsx
git commit -m "test(sessions): add provider-gated plan selection scenarios"
```

### Task 2: Implement provider-gated and auto-select logic in SessionForm

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`

- [ ] **Step 1: Add form helpers and derived provider-specific plan list**

```ts
const {
  register,
  handleSubmit,
  control,
  setValue,
  getValues,
  formState: { errors, isSubmitting },
} = useForm<SessionFormValues>({
  resolver: zodResolver(sessionSchema),
  defaultValues: {
    // existing defaults unchanged
  },
});

const selectedProviderId = useWatch({ control, name: 'provider_id' });

const providerPlans = React.useMemo(
  () => chargingPlans.filter(plan => plan.provider_id === selectedProviderId),
  [chargingPlans, selectedProviderId]
);
```

- [ ] **Step 2: Add synchronization effect for validity + single-plan auto-select**

```ts
React.useEffect(() => {
  const currentPlanId = getValues('charging_plan_id');

  if (!selectedProviderId) {
    if (currentPlanId) {
      setValue('charging_plan_id', '');
    }
    return;
  }

  const currentPlanStillValid = providerPlans.some(plan => plan.id === currentPlanId);
  if (currentPlanStillValid) {
    return;
  }

  if (providerPlans.length === 1) {
    setValue('charging_plan_id', providerPlans[0].id, { shouldDirty: true });
    return;
  }

  setValue('charging_plan_id', '');
}, [selectedProviderId, providerPlans, getValues, setValue]);
```

- [ ] **Step 3: Gate plan control interactivity and bind options to providerPlans**

```tsx
<select
  id="charging_plan_id"
  {...register('charging_plan_id')}
  disabled={!selectedProviderId}
  className="w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors disabled:text-secondary/40 disabled:cursor-not-allowed"
>
  <option value="">Select Plan</option>
  {providerPlans.map(plan => (
    <option key={plan.id} value={plan.id}>{plan.plan_name}</option>
  ))}
</select>
```

- [ ] **Step 4: Re-run targeted tests for this component**

Run: `npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx`
Expected: PASS for all SessionForm tests, including new provider/plan scenarios.

- [ ] **Step 5: Commit implementation changes**

```bash
git add src/features/charging-sessions/components/SessionForm.tsx
git commit -m "feat(sessions): gate plan selection by provider"
```

### Task 3: Full verification and handoff package

**Files:**
- No code file changes expected unless regressions appear.

- [ ] **Step 1: Run linting, full tests, and production build**

Run: `npm run lint && npm run test -- --run && npm run build`
Expected: PASS across all three commands.

- [ ] **Step 2: Validate behavior manually in the running app**

Run: `npm run dev`
Manual checklist:
- Before selecting provider, `Plan` is visible and disabled.
- Selecting `p1` enables `Plan` and shows `P1 Home`/`P1 Flex` only.
- Selecting `p2` auto-selects `P2 Solo`.
- Switching from `p1/t1` to `p2` reassigns selection to `t3`.
- Switching pricing source to `Ad-Hoc` still hides the plan field as before.

- [ ] **Step 3: Prepare implementation handoff summary**

Include:
- changed files list,
- verification outputs (pass/fail per command),
- residual risks:
  - auto-select dirty-state behavior in edit mode,
  - runtime list-refresh edge case while form is open,
- suggested final conventional commit message if squashing is desired.
