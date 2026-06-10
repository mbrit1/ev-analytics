# Session Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit an existing charging session in place without changing its historical pricing meaning unless they deliberately change its pricing identity.

**Architecture:** `App.tsx` owns closed/create/edit mode, `ChargingHistory` emits selected sessions, and `SessionForm` remains the shared create/edit surface. Domain helpers preserve historical snapshots for ordinary edits and recalculate only after a provider, plan, date, charging type, or standard/roaming change. The persistence service independently enforces existing-row updates and atomically queues the matching outbox entry.

**Tech Stack:** React 19, TypeScript, React Hook Form, Vitest, React Testing Library, Dexie, fake IndexedDB, Vite

---

## File Map

- Modify: `src/features/charging-sessions/services/sessionService.ts`
  - Add edit preparation and guarded update persistence.
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`
  - Cover historical snapshot preservation, deliberate repricing, missing rows, immutable fields, and rollback.
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
  - Add read-only pricing source, historical provider/plan fallbacks, and edit-aware plan-selection behavior.
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`
  - Cover prefilling, snapshot preservation, repricing, inactive plan fallback, and submit errors.
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
  - Make each history card an accessible edit trigger.
- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`
  - Cover pointer and keyboard activation semantics.
- Modify: `src/app/App.tsx`
  - Replace the create-only boolean with closed/create/edit state.
- Modify: `src/app/App.mobile-action-dock.test.tsx`
  - Cover selection, cancel, successful save, failed save, and create-state isolation.

### Task 1: Edit Preparation Semantics

**Files:**
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`
- Modify: `src/features/charging-sessions/services/sessionService.ts`

- [ ] **Step 1: Write failing historical-pricing tests**

Update the service import:

```ts
import {
  hasPlanPricingIdentityChanged,
  prepareSession,
  prepareSessionEdit,
  saveSession,
} from './sessionService'
```

Add tests using the existing `buildSessionFixture`, `mockProvider`, and
`mockChargingPlan` fixtures:

```ts
  it('preserves plan snapshots and selection when pricing identity is unchanged', () => {
    // Arrange: the current plan price differs from the historical session price.
    const original = buildSessionFixture({
      id: 'session-history',
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      plan_selection_id: 'selection-history',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'AC',
      pricing_context: 'standard',
      kwh_billed: 40,
      total_cost: 1800,
      applied_price_per_kwh: 40,
      applied_session_fee: 200,
      price_snapshot: { label: 'Historical plan', kWhPrice: 40, sessionFee: 200 },
      provider_name_snapshot: 'Historical Provider',
      charging_plan_name_snapshot: 'Historical Plan',
    });

    // Act: edit only billed energy and notes without supplying current plan data.
    const edited = prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      provider_id: original.provider_id,
      charging_type: original.charging_type,
      kwh_billed: 50,
      notes: 'Updated note',
      session_mode: 'plan',
      tariff_plan_id: original.tariff_plan_id,
      plan_selection_id: original.plan_selection_id,
      price_snapshot: original.price_snapshot,
      pricing_context: original.pricing_context,
    });

    // Assert: history stays attached to the persisted pricing facts.
    expect(edited).toEqual(expect.objectContaining({
      id: original.id,
      created_at: original.created_at,
      plan_selection_id: 'selection-history',
      provider_name_snapshot: 'Historical Provider',
      charging_plan_name_snapshot: 'Historical Plan',
      price_snapshot: { label: 'Historical plan', kWhPrice: 40, sessionFee: 200 },
      applied_price_per_kwh: 40,
      applied_session_fee: 200,
      total_cost: 2200,
      notes: 'Updated note',
    }));
  });

  it('detects deliberate plan pricing identity changes', () => {
    // Arrange: start from a persisted standard AC plan session.
    const original = buildSessionFixture({
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'AC',
      pricing_context: 'standard',
      session_mode: 'plan',
    });

    // Act and Assert: usage-only edits are stable, while rate identity changes reprice.
    expect(hasPlanPricingIdentityChanged(original, {
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'AC',
      pricing_context: 'standard',
    })).toBe(false);
    expect(hasPlanPricingIdentityChanged(original, {
      provider_id: 'provider-1',
      tariff_plan_id: 'plan-1',
      session_timestamp: new Date('2026-06-01T00:00:00.000Z'),
      charging_type: 'DC',
      pricing_context: 'standard',
    })).toBe(true);
  });

  it('recalculates plan snapshots after a deliberate pricing identity change', () => {
    // Arrange: change the existing session from plan-1 to the current plan fixture.
    const original = buildSessionFixture({
      id: 'session-reprice',
      provider_id: 'provider-old',
      tariff_plan_id: 'plan-old',
      plan_selection_id: 'selection-old',
      price_snapshot: { label: 'Old plan', kWhPrice: 40, sessionFee: 0 },
      created_at: new Date('2026-05-01T08:00:00.000Z'),
    });
    const currentProvider: Provider = {
      ...mockProvider,
      id: 'provider-new',
      name: 'Current Provider',
    };
    const currentPlan: ChargingPlan = {
      ...mockChargingPlan,
      id: 'plan-new',
      provider_id: 'provider-new',
      name: 'Current Plan',
      ac_price_per_kwh: 55,
      session_fee: 100,
    };

    // Act: prepare a deliberate provider/plan change with its new selection id.
    const edited = prepareSessionEdit(original, {
      user_id: original.user_id,
      session_timestamp: original.session_timestamp,
      provider_id: currentProvider.id,
      charging_type: 'AC',
      kwh_billed: 10,
      session_mode: 'plan',
      tariff_plan_id: currentPlan.id,
      plan_selection_id: 'selection-new',
      price_snapshot: { label: 'Current Provider Current Plan', kWhPrice: 55, sessionFee: 100 },
      pricing_context: 'standard',
    }, currentPlan, currentProvider);

    // Assert: identity is stable but pricing history now reflects the deliberate choice.
    expect(edited).toEqual(expect.objectContaining({
      id: 'session-reprice',
      created_at: original.created_at,
      provider_id: 'provider-new',
      tariff_plan_id: 'plan-new',
      plan_selection_id: 'selection-new',
      provider_name_snapshot: 'Current Provider',
      charging_plan_name_snapshot: 'Current Plan',
      applied_price_per_kwh: 55,
      applied_session_fee: 100,
      total_cost: 650,
    }));
  });
```

- [ ] **Step 2: Run the targeted service test**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`

Expected: FAIL because the edit helpers do not exist.

- [ ] **Step 3: Implement pricing-identity detection and edit preparation**

Add these exports before persistence functions in `sessionService.ts`:

```ts
type PlanPricingIdentityInput = Pick<
  SessionPreparationInput,
  'provider_id' | 'session_timestamp' | 'charging_type'
> & {
  tariff_plan_id?: string | null;
  pricing_context?: ChargingSession['pricing_context'];
};

/**
 * Returns whether a plan edit deliberately changes the fields that define its
 * historical price source.
 */
export function hasPlanPricingIdentityChanged(
  existing: ChargingSession,
  input: PlanPricingIdentityInput
): boolean {
  return existing.provider_id !== input.provider_id
    || existing.tariff_plan_id !== input.tariff_plan_id
    || existing.session_timestamp.getTime() !== input.session_timestamp.getTime()
    || existing.charging_type !== input.charging_type
    || (existing.pricing_context ?? 'standard') !== (input.pricing_context ?? 'standard');
}

/**
 * Prepares an edited session while preserving historical pricing unless the
 * user deliberately changes its pricing identity.
 */
export function prepareSessionEdit(
  existing: ChargingSession,
  input: SessionPreparationInput,
  plan?: ChargingPlan,
  provider?: Provider
): ChargingSession {
  if ((existing.session_mode ?? 'plan') !== input.session_mode) {
    throw new Error('Pricing source cannot be changed while editing a session');
  }

  if (
    input.session_mode === 'plan'
    && !hasPlanPricingIdentityChanged(existing, input)
  ) {
    const appliedPrice = existing.applied_price_per_kwh ?? existing.price_snapshot?.kWhPrice;
    if (appliedPrice == null) {
      throw new Error('Historical plan price is unavailable for this session');
    }
    const appliedSessionFee = existing.applied_session_fee
      ?? existing.price_snapshot?.sessionFee
      ?? 0;

    return {
      ...existing,
      ...input,
      id: existing.id,
      user_id: existing.user_id,
      session_mode: existing.session_mode,
      provider_name_snapshot: existing.provider_name_snapshot,
      charging_plan_name_snapshot: existing.charging_plan_name_snapshot,
      plan_selection_id: existing.plan_selection_id,
      price_snapshot: structuredClone(existing.price_snapshot),
      applied_price_per_kwh: appliedPrice,
      applied_ac_price_per_kwh: existing.applied_ac_price_per_kwh,
      applied_dc_price_per_kwh: existing.applied_dc_price_per_kwh,
      applied_roaming_ac_price_per_kwh: existing.applied_roaming_ac_price_per_kwh,
      applied_roaming_dc_price_per_kwh: existing.applied_roaming_dc_price_per_kwh,
      applied_monthly_base_fee: existing.applied_monthly_base_fee,
      applied_session_fee: appliedSessionFee,
      total_cost: Math.round(input.kwh_billed * appliedPrice) + appliedSessionFee,
      created_at: existing.created_at,
      updated_at: new Date(),
      deleted_at: existing.deleted_at,
    };
  }

  const prepared = prepareSession(input, plan, provider);
  return {
    ...prepared,
    id: existing.id,
    user_id: existing.user_id,
    created_at: existing.created_at,
    deleted_at: existing.deleted_at,
  };
}
```

- [ ] **Step 4: Run the targeted service test**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`

Expected: PASS for edit preparation and all existing preparation tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/charging-sessions/services/sessionService.ts src/features/charging-sessions/services/sessionService.test.ts
git commit -m "feat(sessions): preserve historical pricing during edits"
```

### Task 2: Guarded Update Persistence

**Files:**
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`
- Modify: `src/features/charging-sessions/services/sessionService.ts`

- [ ] **Step 1: Write failing guarded-update tests**

Add `updateSession` to the existing service import:

```ts
import {
  hasPlanPricingIdentityChanged,
  prepareSession,
  prepareSessionEdit,
  saveSession,
  updateSession,
} from './sessionService'
```

```ts
  it('updates only an existing row and preserves stored immutable fields', async () => {
    // Arrange: persist a row, then provide conflicting caller-owned fields.
    const original = buildSessionFixture({
      id: 'session-edit-1',
      user_id: 'stored-user',
      created_at: new Date('2026-06-01T08:00:00.000Z'),
      session_mode: 'plan',
      deleted_at: new Date('2026-06-03T08:00:00.000Z'),
      notes: 'Original',
    });
    await sharedDb.sessions.put(original);

    // Act: update mutable content.
    await updateSession({
      ...original,
      user_id: 'caller-user',
      created_at: new Date('2026-06-02T08:00:00.000Z'),
      session_mode: 'ad_hoc',
      deleted_at: undefined,
      notes: 'Edited',
    });

    // Assert: service-owned identity and lifecycle fields come from storage.
    expect(await sharedDb.sessions.get(original.id)).toEqual(expect.objectContaining({
      id: original.id,
      user_id: 'stored-user',
      created_at: original.created_at,
      session_mode: 'plan',
      deleted_at: original.deleted_at,
      notes: 'Edited',
    }));
  });

  it('rejects an update when the local session does not exist', async () => {
    // Arrange: build a valid payload without seeding its id.
    const missing = buildSessionFixture({ id: 'missing-session' });

    // Act and Assert: edit cannot silently become an insert.
    await expect(updateSession(missing)).rejects.toThrow('Session not found: missing-session');
    expect(await sharedDb.sessions.get('missing-session')).toBeUndefined();
    expect(await sharedDb.sync_outbox.count()).toBe(0);
  });

  it('queues an UPDATE payload for the stored session id', async () => {
    // Arrange: seed directly so the assertion contains only the update outbox row.
    const original = buildSessionFixture({ id: 'session-edit-outbox', total_cost: 1800 });
    await sharedDb.sessions.put(original);

    // Act: update the same logical row.
    await updateSession({ ...original, total_cost: 2500, notes: 'Edited' });

    // Assert: one retryable UPDATE is queued with the committed payload.
    expect(await sharedDb.sync_outbox.toArray()).toEqual([
      expect.objectContaining({
        table_name: 'sessions',
        action: 'UPDATE',
        retry_count: 0,
        payload: expect.objectContaining({
          id: 'session-edit-outbox',
          total_cost: 2500,
          notes: 'Edited',
        }),
      }),
    ]);
  });

  it('rolls back the local edit when the update outbox write fails', async () => {
    // Arrange: seed the original row and force the queue write to reject.
    const original = buildSessionFixture({ id: 'session-update-rollback', notes: 'Original' });
    await sharedDb.sessions.put(original);
    const outboxSpy = vi.spyOn(sharedDb.sync_outbox, 'add')
      .mockRejectedValueOnce(new Error('Outbox failed'));

    // Act and Assert: the transaction rejects and restores the original row.
    await expect(updateSession({ ...original, notes: 'Edited' })).rejects.toThrow('Outbox failed');
    expect(await sharedDb.sessions.get(original.id)).toEqual(original);
    outboxSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the targeted service test**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`

Expected: FAIL because `updateSession` is not implemented.

- [ ] **Step 3: Implement existing-row-only persistence**

```ts
/**
 * Updates an existing charging session and atomically queues remote sync.
 */
export async function updateSession(session: ChargingSession): Promise<void> {
  await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
    const existing = await db.sessions.get(session.id);
    if (!existing) {
      throw new Error(`Session not found: ${session.id}`);
    }

    const updatedSession: ChargingSession = {
      ...session,
      id: existing.id,
      user_id: existing.user_id,
      created_at: existing.created_at,
      session_mode: existing.session_mode,
      deleted_at: existing.deleted_at,
      updated_at: new Date(),
    };

    const updatedRows = await db.sessions.update(existing.id, updatedSession);
    if (updatedRows !== 1) {
      throw new Error(`Session not found: ${existing.id}`);
    }

    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'UPDATE',
      payload: updatedSession,
      timestamp: updatedSession.updated_at,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined,
    });
  });
}
```

Keep `saveSession` unchanged so creation remains an `INSERT`.

- [ ] **Step 4: Run the targeted service test**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`

Expected: PASS, including rollback and existing create coverage.

- [ ] **Step 5: Commit**

```bash
git add src/features/charging-sessions/services/sessionService.ts src/features/charging-sessions/services/sessionService.test.ts
git commit -m "feat(sessions): guard offline session updates"
```

### Task 3: Edit-Aware Session Form

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`

- [ ] **Step 1: Write failing edit-mode tests**

Add tests that use complete `ChargingSession` initial values:

```ts
  function buildSessionFixture(
    overrides: Partial<import('../../../infra/db').ChargingSession> = {}
  ): import('../../../infra/db').ChargingSession {
    const timestamp = new Date('2026-06-01T00:00:00.000Z');
    return {
      id: 'session-form-fixture',
      user_id: 'user-1',
      session_timestamp: timestamp,
      provider_id: 'p1',
      provider_name_snapshot: 'ChargePoint',
      charging_plan_name_snapshot: 'P1 Home',
      charging_type: 'AC',
      kwh_billed: 25,
      total_cost: 1000,
      session_mode: 'plan',
      tariff_plan_id: 't1',
      plan_selection_id: 'selection-1',
      price_snapshot: { label: 'ChargePoint P1 Home', kWhPrice: 40, sessionFee: 0 },
      pricing_context: 'standard',
      applied_price_per_kwh: 40,
      applied_ac_price_per_kwh: 40,
      applied_dc_price_per_kwh: 60,
      applied_roaming_ac_price_per_kwh: 50,
      applied_roaming_dc_price_per_kwh: 70,
      applied_monthly_base_fee: 0,
      applied_session_fee: 0,
      created_at: timestamp,
      updated_at: timestamp,
      ...overrides,
    };
  }

  it('renders pricing source as read-only while keeping persisted plan values visible', () => {
    // Arrange: the persisted provider and plan are absent from active hook results.
    vi.mocked(useProviders).mockReturnValue({ providers: [], isLoading: false });
    vi.mocked(useChargingPlans).mockReturnValue({
      plans: [],
      isLoading: false,
      addChargingPlan: vi.fn(),
      removeChargingPlan: vi.fn(),
    });
    const initialValues = buildSessionFixture({
      id: 'session-plan-edit',
      provider_id: 'retired-provider',
      provider_name_snapshot: 'Retired Provider',
      tariff_plan_id: 'retired-plan',
      charging_plan_name_snapshot: 'Retired Plan',
      session_mode: 'plan',
    });

    // Act: render edit mode.
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);

    // Assert: source is fixed and historical selections remain represented.
    expect(screen.getByText('Charging Plan')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /charging plan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /ad-hoc/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/provider/i)).toHaveValue('retired-provider');
    expect(screen.getByLabelText(/^plan\s*\*?$/i)).toHaveValue('retired-plan');
  });

  it('preserves snapshots and skips plan-selection writes for an unchanged plan edit', async () => {
    // Arrange: current hooks contain changed prices for the same ids.
    const initialValues = buildSessionFixture({
      id: 'session-plan-stable',
      provider_id: 'p1',
      tariff_plan_id: 't1',
      plan_selection_id: 'selection-old',
      kwh_billed: 25,
      applied_price_per_kwh: 40,
      applied_session_fee: 100,
      price_snapshot: { label: 'Historical Plan', kWhPrice: 40, sessionFee: 100 },
    });
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);
    fireEvent.change(screen.getByLabelText(/kwh billed/i), { target: { value: '30' } });

    // Act: save without changing provider, plan, date, or rate.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: no plan-selection mutation occurs and historical prices calculate the total.
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
        id: 'session-plan-stable',
        plan_selection_id: 'selection-old',
        price_snapshot: { label: 'Historical Plan', kWhPrice: 40, sessionFee: 100 },
        total_cost: 1300,
      }));
    });
    expect(setActivePlanSelection).not.toHaveBeenCalled();
  });

  it('creates or selects plan history after a deliberate plan pricing change', async () => {
    // Arrange: edit an existing session and switch its charging rate.
    const initialValues = buildSessionFixture({
      id: 'session-plan-change',
      provider_id: 'p1',
      tariff_plan_id: 't1',
      charging_type: 'AC',
      pricing_context: 'standard',
    });
    render(<SessionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} initialValues={initialValues} />);

    // Act: select the roaming AC rate and save.
    fireEvent.click(screen.getByRole('radio', { name: /roaming ac/i }));
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: deliberate repricing consults and updates selection history.
    await waitFor(() => expect(setActivePlanSelection).toHaveBeenCalled());
    expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-plan-change',
      pricing_context: 'roaming',
    }));
  });

  it('keeps edit mode open and shows the submit error when persistence rejects', async () => {
    // Arrange: reject the parent persistence callback.
    mockOnSubmit.mockRejectedValueOnce(new Error('Local update failed'));
    render(
      <SessionForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        initialValues={buildSessionFixture({ id: 'session-error' })}
      />
    );

    // Act: submit the edit.
    fireEvent.click(screen.getByRole('button', { name: /save session/i }));

    // Assert: the existing submit-level error pattern remains active.
    expect(await screen.findByRole('alert')).toHaveTextContent('Local update failed');
    expect(screen.getByRole('heading', { name: 'Edit Session' })).toBeInTheDocument();
    expect(mockOnCancel).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the targeted form test**

Run: `npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx`

Expected: FAIL because pricing source is interactive, inactive values disappear, and every plan submit mutates selection history.

- [ ] **Step 3: Add edit helpers and historical fallback options**

Import the service helpers:

```ts
import {
  hasPlanPricingIdentityChanged,
  prepareSession,
  prepareSessionEdit,
} from '../services/sessionService';
```

Add `isEditMode`, `existingSession`, and `pricingSourceLabel` immediately after
the watched values. Add the fallback booleans immediately after `providerPlans`
is declared so `providerPlans` is initialized before it is referenced:

```ts
  const isEditMode = Boolean(initialValues?.id);
  const existingSession = isEditMode ? initialValues as ChargingSession : undefined;
  const pricingSourceLabel = selectedPricingSource === 'ad_hoc' ? 'Ad-Hoc' : 'Charging Plan';
```

```ts
  const hasHistoricalProviderFallback = Boolean(
    existingSession
    && !providers.some((provider) => provider.id === existingSession.provider_id)
  );
  const hasHistoricalPlanFallback = Boolean(
    existingSession?.tariff_plan_id
    && !providerPlans.some((plan) => plan.id === existingSession.tariff_plan_id)
  );
```

In the provider select, insert before `providers.map`:

```tsx
{hasHistoricalProviderFallback && existingSession && (
  <option value={existingSession.provider_id}>
    {existingSession.provider_name_snapshot}
  </option>
)}
```

In the plan select, insert before `providerPlans.map`:

```tsx
{hasHistoricalPlanFallback && existingSession?.tariff_plan_id && (
  <option value={existingSession.tariff_plan_id}>
    {existingSession.charging_plan_name_snapshot
      ?? existingSession.price_snapshot?.label
      ?? 'Historical Plan'}
  </option>
)}
```

Change the plan-validity effect so the persisted edit plan is not cleared:

```ts
    const currentPlanStillValid = providerPlans.some(plan => plan.id === currentPlanId);
    const isPersistedEditPlan = existingSession?.tariff_plan_id === currentPlanId;
    if (currentPlanStillValid || isPersistedEditPlan) {
      return;
    }
```

Render the pricing source conditionally:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
  {isEditMode ? (
    <div className="flex flex-col">
      <span className="text-[13px] font-medium text-secondary uppercase tracking-wider mb-1">
        Pricing Source
      </span>
      <div className="min-h-[44px] border-b border-secondary/20 py-2 text-xl font-medium text-primary">
        {pricingSourceLabel}
      </div>
    </div>
  ) : (
    <Controller
      name="session_mode"
      control={control}
      render={({ field }) => (
        <TactileMatrix
          label="Pricing Source"
          value={field.value}
          onChange={field.onChange}
          options={[
            { label: 'Charging Plan', value: 'plan' },
            { label: 'Ad-Hoc', value: 'ad_hoc' },
          ]}
        />
      )}
    />
  )}
</div>
```

- [ ] **Step 4: Make plan submission edit-aware**

Replace the plan branch inside `handleFormSubmit` with:

```ts
      if (values.session_mode === 'plan') {
        const planInput = {
          ...sessionBase,
          provider_id: providerId,
          session_mode: 'plan' as const,
          tariff_plan_id: values.tariff_plan_id,
          pricing_context: values.pricing_mode,
        };
        const pricingIdentityChanged = existingSession
          ? hasPlanPricingIdentityChanged(existingSession, planInput)
          : true;

        if (existingSession && !pricingIdentityChanged) {
          await onSubmit(prepareSessionEdit(existingSession, {
            ...planInput,
            plan_selection_id: existingSession.plan_selection_id,
            price_snapshot: existingSession.price_snapshot,
          }));
          return;
        }

        const provider = providers.find((candidate) => candidate.id === providerId);
        const plan = plans.find((candidate) => candidate.id === values.tariff_plan_id);
        if (!provider || !plan) {
          throw new Error('Select an active provider and charging plan to change historical pricing');
        }

        const sessionDate = parseDateInputAsUtc(values.session_timestamp);
        const snapshot = buildTariffPriceSnapshot(
          plan,
          provider.name,
          values.pricing_mode,
          values.charging_type
        );
        const activeSelection = await getActivePlanSelectionAt(providerId, user.id, sessionDate);
        const planSelection = (!activeSelection || activeSelection.tariff_plan_id !== plan.id)
          ? await setActivePlanSelection({
            userId: user.id,
            providerId,
            tariffPlanId: plan.id,
            validFrom: sessionDate,
            priceSnapshot: snapshot,
          })
          : activeSelection;
        const input = {
          ...planInput,
          plan_selection_id: planSelection.id,
          price_snapshot: snapshot,
        };
        const session = existingSession
          ? prepareSessionEdit(existingSession, input, plan, provider)
          : prepareSession(input, plan, provider);
        await onSubmit(session);
        return;
      }
```

In the ad-hoc branch, replace the final preparation call with:

```ts
      const input = {
        ...sessionBase,
        provider_id: providerId,
        session_mode: 'ad_hoc' as const,
        tariff_plan_id: null,
        plan_selection_id: null,
        price_snapshot: {
          label: 'Ad-Hoc',
          kWhPrice: pricePerKwh,
          sessionFee,
          blockingFee: otherFeesAmount,
        },
        pricing_context: 'ad_hoc' as const,
        ad_hoc_pricing: {
          cpoName: values.cpo_name?.trim() || null,
          pricePerKwh,
          pricePerSession: sessionFee,
          receiptUrl: values.ad_hoc_receipt_url || null,
          notes: values.notes || null,
          otherFees: otherFeesAmount == null
            ? undefined
            : [{ label: 'Other fees', amount: otherFeesAmount }],
        },
      };
      const session = existingSession
        ? prepareSessionEdit(existingSession, input)
        : prepareSession(input);
      await onSubmit(session);
```

Move provider existence validation into the deliberate plan-change branch and the ad-hoc branch. An unchanged historical plan edit must not require an active provider row.

- [ ] **Step 5: Run the targeted form test**

Run: `npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx`

Expected: PASS for edit constraints, historical fallbacks, plan-selection behavior, submit errors, and existing create coverage.

- [ ] **Step 6: Commit**

```bash
git add src/features/charging-sessions/components/SessionForm.tsx src/features/charging-sessions/components/SessionForm.test.tsx
git commit -m "feat(sessions): make session form edit aware"
```

### Task 4: Accessible History Activation

**Files:**
- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`

- [ ] **Step 1: Write failing activation tests**

```ts
  it('emits the selected session from an accessible card button', async () => {
    // Arrange: render and persist one visible session.
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(<ChargingHistory onSelectSession={onSelectSession} />);
    expect(await screen.findByText('No Sessions Yet')).toBeInTheDocument();
    const session = buildSession('session-edit', '2026-05-30T10:00:00.000Z');
    await act(async () => {
      await saveSession(session);
    });

    // Act: focus with Tab and activate with Enter.
    await user.tab();
    const trigger = await screen.findByRole('button', {
      name: 'Edit session Tesla 30.05.2026',
    });
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');

    // Assert: native button behavior emits the exact selected session.
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-edit',
    }));
  });
```

Add `userEvent` to the test imports.

- [ ] **Step 2: Run the targeted history test**

Run: `npm run test -- --run src/features/charging-sessions/components/ChargingHistory.test.tsx`

Expected: FAIL because cards are not buttons and no callback exists.

- [ ] **Step 3: Implement the native button card**

Import `ChargingSession` and add:

```ts
interface ChargingHistoryProps {
  /** Opens the selected persisted session for editing. */
  onSelectSession?: (session: ChargingSession) => void;
}

function buildSessionEditLabel(session: ChargingSession): string {
  const providerName = session.provider_name_snapshot || 'Unknown provider';
  const sessionDate = new Date(session.session_timestamp).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `Edit session ${providerName} ${sessionDate}`;
}

export const ChargingHistory: React.FC<ChargingHistoryProps> = ({ onSelectSession }) => {
```

Replace the complete existing session-card `Slab` with:

```tsx
<Slab key={session.id} className="p-0">
  <button
    type="button"
    onClick={() => onSelectSession?.(session)}
    aria-label={buildSessionEditLabel(session)}
    className="group w-full min-h-[44px] rounded-[inherit] p-6 text-left cursor-pointer transition-colors hover:bg-secondary/5 active:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
  >
    <div className="flex justify-between items-center">
      <div className="space-y-1.5">
        <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-secondary">
          <Calendar className="w-3 h-3 mr-1.5" />
          {new Date(session.session_timestamp).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })}
        </div>
        <h3 className="text-lg font-bold text-primary leading-tight">
          {session.provider_name_snapshot || 'Unknown Provider'}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-secondary font-medium">
            {(session.session_mode === 'ad_hoc'
              ? 'Ad-Hoc'
              : (session.price_snapshot?.label
                ?? session.charging_plan_name_snapshot
                ?? 'Charging Plan'))} • {session.charging_type}
          </p>
          {session.session_mode === 'ad_hoc' && (() => {
            const cpoName = session.ad_hoc_pricing?.cpoName?.trim();
            const providerName = (session.provider_name_snapshot || '').trim().toLowerCase();
            const shouldShowCpoName = cpoName != null
              && cpoName.toLowerCase() !== providerName;
            const metadataParts = [shouldShowCpoName ? cpoName : null].filter(Boolean);

            if (metadataParts.length === 0) {
              return null;
            }

            return (
              <p className="text-xs text-secondary/80 font-medium">
                {metadataParts.join(' • ')}
              </p>
            );
          })()}
          {(session.start_soc_percentage != null || session.end_soc_percentage != null) && (
            <p className="text-xs text-secondary/80 font-medium">
              SoC {session.start_soc_percentage != null
                ? `${session.start_soc_percentage}%`
                : '—'} → {session.end_soc_percentage != null
                ? `${session.end_soc_percentage}%`
                : '—'}
            </p>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="text-4xl font-semibold text-primary tabular-nums tracking-tight">
          {formatCurrency(session.total_cost)}
        </p>
        <div className="flex items-center justify-end text-lg font-medium text-secondary tabular-nums mt-1">
          <Zap className="w-4 h-4 mr-1 text-accent" />
          {formatCentsToDecimal(Math.round(session.kwh_billed * 100)).replace(',00', '')}
          <span className="text-sm ml-1">kWh</span>
        </div>
      </div>
    </div>
  </button>
</Slab>
```

- [ ] **Step 4: Run the targeted history test**

Run: `npm run test -- --run src/features/charging-sessions/components/ChargingHistory.test.tsx`

Expected: PASS for native keyboard activation and all existing grouping assertions.

- [ ] **Step 5: Commit**

```bash
git add src/features/charging-sessions/components/ChargingHistory.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx
git commit -m "feat(sessions): make history cards editable"
```

### Task 5: App-Level Create/Edit Flow

**Files:**
- Modify: `src/app/App.mobile-action-dock.test.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Replace the session feature mock**

Import `ChargingSession` in the test and use callback-aware doubles with
Vitest-hoisted fixtures:

```tsx
const {
  existingSession,
  submittedSession,
  mockSaveSession,
  mockUpdateSession,
} = vi.hoisted(() => {
  const timestamp = new Date('2026-06-01T08:00:00.000Z');
  const baseSession = {
    user_id: 'user-1',
    session_timestamp: timestamp,
    provider_id: 'provider-1',
    provider_name_snapshot: 'Provider',
    charging_plan_name_snapshot: 'Plan',
    charging_type: 'AC' as const,
    kwh_billed: 10,
    total_cost: 400,
    session_mode: 'plan' as const,
    tariff_plan_id: 'plan-1',
    plan_selection_id: 'selection-1',
    price_snapshot: { label: 'Provider Plan', kWhPrice: 40, sessionFee: 0 },
    pricing_context: 'standard' as const,
    applied_price_per_kwh: 40,
    applied_ac_price_per_kwh: 40,
    applied_dc_price_per_kwh: 60,
    applied_roaming_ac_price_per_kwh: 50,
    applied_roaming_dc_price_per_kwh: 70,
    applied_monthly_base_fee: 0,
    applied_session_fee: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };

  return {
    existingSession: { ...baseSession, id: 'session-existing' },
    submittedSession: {
      ...baseSession,
      id: 'session-existing',
      notes: 'Edited',
      updated_at: new Date('2026-06-02T08:00:00.000Z'),
    },
    mockSaveSession: vi.fn(),
    mockUpdateSession: vi.fn(),
  };
});

vi.mock('../features/charging-sessions', () => ({
  ChargingHistory: ({ onSelectSession }: {
    onSelectSession?: (session: ChargingSession) => void;
  }) => (
    <div>
      Charging History
      <button
        type="button"
        onClick={() => onSelectSession?.(existingSession as ChargingSession)}
      >
        Open Existing Session
      </button>
    </div>
  ),
  SessionForm: ({ onSubmit, onCancel, initialValues }: {
    onSubmit: (session: ChargingSession) => Promise<void>;
    onCancel: () => void;
    initialValues?: ChargingSession;
  }) => (
    <div>
      <div>{initialValues ? 'Edit Session Form' : 'Session Form'}</div>
      <button
        type="button"
        onClick={() => {
          void onSubmit(submittedSession as ChargingSession).catch(() => undefined);
        }}
      >
        Trigger Session Submit
      </button>
      <button type="button" onClick={onCancel}>Cancel Session Form</button>
    </div>
  ),
  saveSession: mockSaveSession,
  updateSession: mockUpdateSession,
}));
```

Cast `existingSession` to `ChargingSession` when passing it to
`onSelectSession`. The submitted session intentionally keeps the existing id:
the assertion proves `App` forwards the fully prepared form result without
rebuilding or replacing its identity.

- [ ] **Step 2: Add failing flow tests**

```ts
  it('opens the selected session and cancel returns to history without persistence', async () => {
    // Arrange: open edit mode.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));
    expect(screen.getByText('Edit Session Form')).toBeInTheDocument();

    // Act: cancel.
    await user.click(screen.getByRole('button', { name: 'Cancel Session Form' }));

    // Assert: history returns and no write occurs.
    expect(screen.getByText('Charging History')).toBeInTheDocument();
    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('saves an edited session through update and then opens a blank create form', async () => {
    // Arrange: open edit mode.
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));

    // Act: submit the prepared edit, return to history, then start create mode.
    await user.click(screen.getByRole('button', { name: 'Trigger Session Submit' }));
    await screen.findByText('Charging History');
    await user.click(screen.getByText('Add Session Pill'));

    // Assert: update receives the prepared session and edit state does not leak.
    expect(mockUpdateSession).toHaveBeenCalledWith(submittedSession);
    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(screen.getByText('Session Form')).toBeInTheDocument();
    expect(screen.queryByText('Edit Session Form')).not.toBeInTheDocument();
  });

  it('keeps edit mode open when the local update rejects', async () => {
    // Arrange: make the offline update transaction fail.
    const user = userEvent.setup();
    mockUpdateSession.mockRejectedValueOnce(new Error('Outbox failed'));
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open Existing Session' }));

    // Act: submit the edit.
    await user.click(screen.getByRole('button', { name: 'Trigger Session Submit' }));

    // Assert: App does not close edit mode after a rejected promise.
    expect(screen.getByText('Edit Session Form')).toBeInTheDocument();
    expect(screen.queryByText('Charging History')).not.toBeInTheDocument();
  });
```

The real `SessionForm` catches the rejection and renders the submit alert; this shell test verifies only that `App` does not close the form on failure.

- [ ] **Step 3: Run the app-shell test**

Run: `npm run test -- --run src/app/App.mobile-action-dock.test.tsx`

Expected: FAIL because `App` has only create/closed state.

- [ ] **Step 4: Implement closed/create/edit state**

```ts
type SessionFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; session: ChargingSession };
```

Replace the boolean state:

```ts
const [sessionFormState, setSessionFormState] = useState<SessionFormState>({ mode: 'closed' });
const isSessionFormOpen = sessionFormState.mode !== 'closed';
```

Import `updateSession`, then add handlers:

```ts
const handleOpenCreateSession = () => setSessionFormState({ mode: 'create' });
const handleOpenEditSession = (session: ChargingSession) => {
  setSessionFormState({ mode: 'edit', session });
};
const handleCloseSessionForm = () => setSessionFormState({ mode: 'closed' });

const handleSessionSubmit = async (session: ChargingSession) => {
  if (sessionFormState.mode === 'edit') {
    await updateSession(session);
  } else {
    await saveSession(session);
  }
  setSessionFormState({ mode: 'closed' });
};
```

Wire both add controls to `handleOpenCreateSession`. Render:

```tsx
{isSessionFormOpen ? (
  <SessionForm
    onSubmit={handleSessionSubmit}
    onCancel={handleCloseSessionForm}
    initialValues={sessionFormState.mode === 'edit' ? sessionFormState.session : undefined}
  />
) : (
  <ChargingHistory onSelectSession={handleOpenEditSession} />
)}
```

- [ ] **Step 5: Run the app-shell test**

Run: `npm run test -- --run src/app/App.mobile-action-dock.test.tsx`

Expected: PASS for create, edit, cancel, failure retention, and tariff-shell regressions.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/App.mobile-action-dock.test.tsx
git commit -m "feat(app): route session history into edit mode"
```

### Task 6: Design and Integration Verification

**Files:**
- Verify: `src/features/charging-sessions/index.ts`
- Verify: `docs/superpowers/specs/2026-05-16-Design-System-Sandbox-v2.0.html`
- Verify: `docs/superpowers/specs/2026-05-29-design-governance-checklist.md`

- [ ] **Step 1: Verify the feature barrel**

Confirm `src/features/charging-sessions/index.ts` still contains:

```ts
export * from './services/sessionService'
```

Expected: `App.tsx` imports `updateSession` through the feature public API. No file change is required when the star export is already present.

- [ ] **Step 2: Run focused regression tests**

Run:

```bash
npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts src/features/charging-sessions/components/SessionForm.test.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx src/app/App.mobile-action-dock.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Verify the UI in the browser**

Run: `npm run dev`

Open the local Vite URL with the Browser plugin and verify:

1. A history card has visible hover, pressed, and keyboard focus treatment.
2. The whole card activates edit mode with pointer and keyboard.
3. Edit mode shows `Pricing Source` as read-only with a 44px minimum control height.
4. Cancel returns to unchanged history.
5. Saving a usage-only edit preserves the displayed plan/provider history while updating totals.
6. Starting `Add Session` afterward shows create defaults and interactive pricing-source controls.
7. Mobile and desktop layouts retain the established slab spacing and thin-underline form treatment.

Expected: no console errors and no design-governance deviations. If a deviation is intentional, record `what deviates`, `why this improves UX`, and `decision: local exception` or `promote to master candidate` in the implementation handoff.

- [ ] **Step 4: Run repository verification**

Run: `npm run lint`

Expected: PASS.

Run: `npm run test -- --run`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Record handoff details**

The implementation handoff must include:

```text
Changed files: session edit preparation/persistence, form edit constraints, history activation, and app mode wiring.
Verification: focused tests, full lint, full test suite, build, and browser checks.
Risks: historical sessions with incomplete legacy snapshots now fail visibly instead of silently repricing.
Design governance: no deviation, or the required classified deviation note.
Suggested commit: feat(sessions): add offline-first session editing
```

Do not create an empty verification commit. Commit only if verification produces an actual tracked-file correction.
