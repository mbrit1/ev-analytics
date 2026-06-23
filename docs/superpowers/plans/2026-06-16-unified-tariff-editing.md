# Unified Tariff Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate tariff detail and permanent-price-change surfaces with one unified tariff editor that reuses the `New Tariff` UI, preserves long-list context like session editing, updates the current version in place when `Valid From` is unchanged, and creates a successor version when `Valid From` changes.

**Architecture:** Keep tariff list versus form mode at the app-shell boundary, following the sessions flow. Reuse `TariffForm` as the single create/edit UI, branch edit persistence in `planService` based on whether the submitted `valid_from` changed from the current effective version, and preserve launch/restore context through a one-shot tariffs restoration request modeled after `ChargingHistory`.

**Tech Stack:** React 19, TypeScript, React Hook Form, Zod, Dexie, dexie-react-hooks, Vitest, React Testing Library, fake IndexedDB, Vite

---

## File Map

- Modify: `src/app/App.tsx`
  - Own tariff create/edit/closed mode plus restoration request state.
- Create: `src/app/App.tariff-editing.test.tsx`
  - Cover tariff list/form mode switching and restore-on-save/discard behavior.
- Modify: `src/features/charging-plans/components/TariffList.tsx`
  - Render either list mode or promotion/delete flows based on app-owned props, remove separate details/permanent-change surfaces, and restore scroll/card focus for long lists.
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
  - Cover unified edit flow, hidden list during edit, action-menu changes, and restoration behavior.
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.tsx`
  - Reduce overflow actions to promotion and delete.
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`
  - Update menu expectations and callbacks.
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
  - Remove `details` mode, support locked-provider edit mode, and emit explicit edit intent metadata.
- Modify: `src/features/charging-plans/components/TariffForm.test.tsx`
  - Cover locked provider, editable tariff name, and unchanged-vs-changed `Valid From` submit intent.
- Modify: `src/features/charging-plans/components/TariffFormLoader.tsx`
  - Keep lazy loader aligned with the narrowed unified form props.
- Modify: `src/features/charging-plans/hooks/useChargingPlans.ts`
  - Replace old details/permanent-change mutations with unified edit mutations.
- Modify: `src/features/charging-plans/services/planService.ts`
  - Add explicit service functions for current-version edits and successor creation while preserving logical identity/history rules.
- Modify: `src/features/charging-plans/services/chargingPlanService.test.ts`
  - Cover unchanged current-version edits, changed-date successor creation, name correction behavior, and preserved session snapshots.
- Modify: `src/features/charging-plans/index.ts`
  - Export any new tariff edit input types needed by the app/components.

## Required Invariants

1. The tariffs tab shows either the list or the unified form surface, never both at once.
2. `Provider` is editable in create mode and read-only in edit mode.
3. `Tariff Name` remains editable text in edit mode.
4. If submitted `valid_from` matches the current effective version’s original start date, saving updates the current version in place.
5. If submitted `valid_from` differs from the original start date, saving creates a successor version and preserves a continuous non-overlapping history.
6. Name corrections on unchanged `valid_from` keep the logical tariff grouped consistently under the updated normalized name.
7. Historical charging sessions keep their saved snapshots and are never repriced by tariff edits.
8. Saving or discarding tariff edit returns the user to the same scroll/card context they launched from.

## Task 1: Move Tariff Form Mode Ownership To `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/app/App.tariff-editing.test.tsx`

- [ ] **Step 1: Write the failing app-level tariff mode test**

Create `src/app/App.tariff-editing.test.tsx` with a focused shell test that mirrors the existing session-mode behavior:

```tsx
/**
 * Test suite for tariff list/form mode ownership in the app shell.
 *
 * Verifies unified tariff editing replaces the list surface and restores it on
 * save or discard.
 */
describe('App tariff editing', () => {
  it('hides the tariff list while edit mode is active and restores it on cancel', async () => {
    // Arrange: render the authenticated app on the tariffs tab with one logical tariff.
    renderAuthenticatedApp({ activeTab: 'tariffs' })
    await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }))

    // Assert: the edit form is the only active tariffs surface.
    expect(screen.getByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tariffs' })).not.toBeInTheDocument()

    // Act: discard the edit.
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // Assert: the list returns.
    expect(screen.getByRole('heading', { name: 'Tariffs' })).toBeInTheDocument()
  })
})
```

Use the same auth/runtime mocks as the existing app tests and stub `TariffList` only if the current harness makes the real lazy import too expensive. Include Arrange, Act, Assert comments.

- [ ] **Step 2: Run the new app test and verify failure**

Run: `npm run test -- --run src/app/App.tariff-editing.test.tsx`

Expected: FAIL because `App.tsx` still drives tariffs with `isCreatingTariff` and cannot represent edit mode or hide the list header during unified edit.

- [ ] **Step 3: Add explicit tariff form state and restoration state to `App.tsx`**

Replace the create-only tariff state with an explicit mode union and a restoration request, following the same shape as session editing:

```ts
type TariffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; logicalTariffKey: string }

type TariffRestoreRequest =
  | { type: 'position'; scrollY: number; focusTariffKey?: string | null }
  | { type: 'tariff'; tariffKey: string }

const [tariffFormState, setTariffFormState] = useState<TariffFormState>({ mode: 'closed' })
const [tariffRestoreRequest, setTariffRestoreRequest] = useState<TariffRestoreRequest | null>(null)
const tariffScrollSnapshotRef = useRef(0)
```

Replace these usages:

```ts
const [isCreatingTariff, setIsCreatingTariff] = useState(false)
const isMobileContextActionVisible =
  (activeTab === 'sessions' && !isSessionFormOpen) ||
  (activeTab === 'tariffs' && !isCreatingTariff && !isTariffFormOpen)
```

with:

```ts
const isTariffFormVisible = tariffFormState.mode !== 'closed'
const isMobileContextActionVisible =
  (activeTab === 'sessions' && !isSessionFormOpen) ||
  (activeTab === 'tariffs' && !isTariffFormVisible && !isTariffFormOpen)
```

- [ ] **Step 4: Add tariff open/close/save handlers in `App.tsx`**

Implement app-shell handlers matching the session pattern:

```ts
const handleOpenCreateTariff = () => {
  tariffScrollSnapshotRef.current = window.scrollY
  setTariffRestoreRequest(null)
  setTariffFormState({ mode: 'create' })
}

const handleOpenEditTariff = (logicalTariffKey: string) => {
  tariffScrollSnapshotRef.current = window.scrollY
  setTariffRestoreRequest(null)
  setTariffFormState({ mode: 'edit', logicalTariffKey })
}

const handleCloseTariffForm = () => {
  const focusTariffKey = tariffFormState.mode === 'edit'
    ? tariffFormState.logicalTariffKey
    : null

  setTariffFormState({ mode: 'closed' })
  setTariffRestoreRequest({
    type: 'position',
    scrollY: tariffScrollSnapshotRef.current,
    focusTariffKey,
  })
}

const handleTariffSaveComplete = (logicalTariffKey: string) => {
  setTariffFormState({ mode: 'closed' })
  setTariffRestoreRequest({ type: 'tariff', tariffKey: logicalTariffKey })
}
```

Update the tariffs render branch to pass these props into `TariffList`:

```tsx
<TariffList
  tariffFormState={tariffFormState}
  restorationRequest={tariffRestoreRequest ?? undefined}
  onCreateTariff={handleOpenCreateTariff}
  onEditTariff={handleOpenEditTariff}
  onCloseForm={handleCloseTariffForm}
  onSaveComplete={handleTariffSaveComplete}
  onRestorationComplete={() => setTariffRestoreRequest(null)}
  onFormOpenChange={setIsTariffFormOpen}
/>
```

- [ ] **Step 5: Run the app test and confirm it passes**

Run: `npm run test -- --run src/app/App.tariff-editing.test.tsx`

Expected: PASS with the tariffs branch now able to enter create/edit form mode and restore list mode on close.

## Task 2: Unify `TariffForm` Around Create/Edit Modes

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Modify: `src/features/charging-plans/components/TariffFormLoader.tsx`
- Modify: `src/features/charging-plans/components/TariffForm.test.tsx`

- [ ] **Step 1: Write failing unified-form tests**

Add tests that lock down the approved UX and submit contract:

```tsx
it('locks provider and keeps tariff name editable in edit mode', () => {
  // Arrange: render edit mode with an existing logical tariff current version.
  render(
    <TariffForm
      mode="edit"
      onSubmit={mockOnSubmit}
      onCancel={mockOnCancel}
      initialValues={{ id: 'plan-1', provider_id: 'p1', name: 'Supercharger Standard Only' }}
    />
  )

  // Assert: provider is visible but disabled, while tariff name remains editable text.
  expect(screen.getByLabelText(/^provider$/i)).toBeDisabled()
  expect(screen.getByLabelText(/tariff name/i)).not.toBeDisabled()
})

it('submits update_current intent when valid from is unchanged', async () => {
  // Arrange: render edit mode with a persisted current start date.
  render(
    <TariffForm
      mode="edit"
      onSubmit={mockOnSubmit}
      onCancel={mockOnCancel}
      initialValues={{ id: 'plan-1', provider_id: 'p1', name: 'Lidl', valid_from: new Date('2026-01-01T00:00:00.000Z') }}
    />
  )
  fireEvent.change(screen.getByLabelText(/tariff name/i), { target: { value: 'Lidl Corrected' } })
  fireEvent.click(screen.getByRole('button', { name: /save tariff/i }))

  // Assert: unchanged start date emits update_current intent.
  await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      intent: 'update_current',
      logicalIdentity: { providerId: 'p1', name: 'Lidl' },
    })
  ))
})

it('submits create_successor intent when valid from changes', async () => {
  // Arrange: edit an existing tariff and move the start date forward.
  render(
    <TariffForm
      mode="edit"
      onSubmit={mockOnSubmit}
      onCancel={mockOnCancel}
      initialValues={{ id: 'plan-1', provider_id: 'p1', name: 'Lidl', valid_from: new Date('2026-01-01T00:00:00.000Z') }}
    />
  )
  fireEvent.change(screen.getByLabelText(/valid from/i), { target: { value: '2026-08-15' } })
  fireEvent.click(screen.getByRole('button', { name: /save tariff/i }))

  // Assert: changed start date emits successor intent.
  await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      intent: 'create_successor',
      logicalIdentity: { providerId: 'p1', name: 'Lidl' },
      originalValidFrom: new Date('2026-01-01T00:00:00.000Z'),
    })
  ))
})
```

Remove the existing `details`-mode assertions only after these new tests are in place. Keep Arrange, Act, Assert comments in every new test.

- [ ] **Step 2: Run the tariff form test and verify failure**

Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`

Expected: FAIL because `TariffForm` still supports `details` mode, allows provider changes in edit mode, and only submits a raw `ChargingPlan`.

- [ ] **Step 3: Replace the old props with a single create/edit submit contract**

Refactor `TariffForm.tsx` to remove `DetailsTariffFormProps` and introduce one explicit result type:

```ts
export interface TariffFormSubmit {
  intent: 'create' | 'update_current' | 'create_successor'
  plan: ChargingPlan
  logicalIdentity?: {
    providerId: string
    name: string
  }
  originalValidFrom?: Date
}

interface TariffFormProps {
  mode?: 'create' | 'edit'
  onSubmit: (data: TariffFormSubmit) => Promise<void>
  onCancel: () => void
  initialValues?: Partial<ChargingPlan>
}
```

Inside `handleFormSubmit`, derive the intent from the original edit baseline:

```ts
const originalValidFrom = initialValues?.valid_from ? coerceDate(initialValues.valid_from) : null
const submittedValidFrom = parseDateInputAsUtc(values.valid_from)
const isEditMode = resolvedMode === 'edit'
const validFromChanged = isEditMode
  && originalValidFrom != null
  && submittedValidFrom.getTime() !== originalValidFrom.getTime()

const intent: TariffFormSubmit['intent'] = !isEditMode
  ? 'create'
  : validFromChanged
    ? 'create_successor'
    : 'update_current'

await onSubmit({
  intent,
  plan: builtPlan,
  logicalIdentity: isEditMode
    ? { providerId: initialValues?.provider_id ?? '', name: initialValues?.name ?? '' }
    : undefined,
  originalValidFrom: isEditMode ? originalValidFrom ?? undefined : undefined,
})
```

- [ ] **Step 4: Lock provider in edit mode and keep tariff name editable**

Update `ProviderSelect` to accept a `disabled` flag:

```tsx
interface ProviderSelectProps {
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}

<select
  disabled={disabled}
  aria-disabled={disabled ? 'true' : 'false'}
  className={`w-full px-0 py-2 border-b border-secondary/20 focus:border-accent outline-none bg-transparent text-xl font-medium min-h-[44px] transition-colors ${
    disabled ? 'text-secondary/55 cursor-not-allowed' : 'text-primary'
  }`}
>
```

Then wire it from the standard form:

```tsx
<Controller
  name="provider_id"
  control={control}
  render={({ field }) => (
    <ProviderSelect
      value={field.value}
      onChange={field.onChange}
      error={errors.provider_id?.message}
      disabled={resolvedMode === 'edit'}
    />
  )}
/>
```

Delete `DetailsTariffForm` and the `props.mode === 'details'` branch entirely. `TariffFormLoader.tsx` should only forward the narrowed create/edit props.

- [ ] **Step 5: Run the tariff form test and confirm it passes**

Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`

Expected: PASS with one unified form contract, disabled provider in edit mode, and explicit submit intent branching.

## Task 3: Add Explicit Service Paths For Current-Version Edit vs Successor Creation

**Files:**
- Modify: `src/features/charging-plans/services/planService.ts`
- Modify: `src/features/charging-plans/services/chargingPlanService.test.ts`
- Modify: `src/features/charging-plans/hooks/useChargingPlans.ts`
- Modify: `src/features/charging-plans/index.ts`

- [ ] **Step 1: Write failing service tests**

Add tests that cover the two edit paths and name-correction behavior:

```ts
it('updates the current version in place when valid_from is unchanged', async () => {
  // Arrange: seed one open baseline logical tariff and one session snapshot that references it.
  await seedOpenBaseline({ id: 'baseline', name: 'Lidl' })
  await db.sessions.add(buildSession({ tariff_plan_id: 'baseline', charging_plan_name_snapshot: 'Lidl' }))

  // Act: update current-version fields without changing valid_from.
  await updateCurrentTariffVersion({
    userId: 'user-1',
    providerId: 'provider-1',
    name: 'Lidl',
    currentVersionId: 'baseline',
    nextName: 'Lidl Corrected',
    validFrom: utc('2026-01-01'),
    prices: buildPrices({ ac_price_per_kwh: 55 }),
    affiliation: 'member plus',
    notes: 'updated',
  })

  // Assert: the current row id is preserved, no successor row is created, and session snapshots stay unchanged.
  const plans = await getChargingPlans('user-1')
  expect(plans).toHaveLength(1)
  expect(plans[0]?.id).toBe('baseline')
  expect(plans[0]?.name).toBe('Lidl Corrected')
  expect((await db.sessions.get(buildSession().id))?.charging_plan_name_snapshot).not.toBe('Lidl Corrected')
})

it('creates a successor when valid_from changes', async () => {
  // Arrange: seed one open baseline version.
  await seedOpenBaseline({ id: 'baseline', valid_from: utc('2026-01-01'), valid_to: null })

  // Act: move valid_from forward.
  await createSuccessorTariffVersion({
    userId: 'user-1',
    providerId: 'provider-1',
    name: 'Lidl',
    effectiveFrom: utc('2026-08-15'),
    prices: buildPrices({ ac_price_per_kwh: 35 }),
    nextName: 'Lidl',
    affiliation: 'member',
    notes: 'fixture',
  })

  // Assert: baseline closes and successor starts on the new date.
  const plans = sortedLogicalRows(await db.charging_plans.toArray())
  expect(plans).toHaveLength(2)
  expect(plans[0]?.valid_to?.toISOString()).toBe('2026-08-15T00:00:00.000Z')
  expect(plans[1]?.valid_from.toISOString()).toBe('2026-08-15T00:00:00.000Z')
})
```

Keep the existing permanent-change and logical-details tests until the new service behavior is passing, then replace them with the new expectations. Include Arrange, Act, Assert comments in every new test.

- [ ] **Step 2: Run the service test and verify failure**

Run: `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`

Expected: FAIL because `planService.ts` only exposes `schedulePermanentTariffVersion` and `updateLogicalTariffDetails`.

- [ ] **Step 3: Add unified edit service inputs and implementations**

Introduce two new service inputs:

```ts
export interface UpdateCurrentTariffVersionInput extends LogicalTariffIdentityInput {
  currentVersionId: string
  validFrom: Date
  nextName: string
  prices: TariffPriceInput
  affiliation?: string
  notes?: string
}

export interface CreateSuccessorTariffVersionInput extends LogicalTariffIdentityInput {
  effectiveFrom: Date
  nextName: string
  prices: TariffPriceInput
  affiliation?: string
  notes?: string
}
```

Implement `updateCurrentTariffVersion` with these exact rules:

```ts
export async function updateCurrentTariffVersion(
  input: UpdateCurrentTariffVersionInput
): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const versions = await loadLogicalVersionsFromTable(db.charging_plans, input.userId, input.providerId, input.name)
    const current = versions.find((version) => version.id === input.currentVersionId)
    if (!current) {
      throw new Error('Current tariff version no longer exists')
    }
    if (current.valid_from.getTime() !== input.validFrom.getTime()) {
      throw new Error('Current tariff update requires an unchanged valid_from date')
    }

    const now = new Date()
    const normalizedNextName = trimPlanName(input.nextName)
    const renamedVersions = versions.map((version) => ({
      id: version.id,
      user_id: version.user_id,
      provider_id: version.provider_id,
      name: normalizedNextName,
      valid_from: version.valid_from,
      valid_to: version.valid_to,
      ac_price_per_kwh: version.ac_price_per_kwh,
      dc_price_per_kwh: version.dc_price_per_kwh,
      roaming_ac_price_per_kwh: version.roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh: version.roaming_dc_price_per_kwh,
      monthly_base_fee: version.monthly_base_fee,
      session_fee: version.session_fee,
      affiliation: version.affiliation,
      notes: version.notes,
      created_at: version.created_at,
      name: normalizedNextName,
      updated_at: now,
      deleted_at: version.deleted_at,
    }))
    const updatedCurrent = {
      id: current.id,
      user_id: current.user_id,
      provider_id: current.provider_id,
      name: normalizedNextName,
      valid_from: current.valid_from,
      valid_to: current.valid_to,
      ac_price_per_kwh: input.prices.ac_price_per_kwh,
      dc_price_per_kwh: input.prices.dc_price_per_kwh,
      roaming_ac_price_per_kwh: input.prices.roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh: input.prices.roaming_dc_price_per_kwh,
      monthly_base_fee: input.prices.monthly_base_fee,
      session_fee: input.prices.session_fee,
      affiliation: input.affiliation,
      notes: input.notes,
      created_at: current.created_at,
      updated_at: now,
      deleted_at: current.deleted_at,
    }

    for (const version of renamedVersions) {
      await putPlanAndQueue(
        db.charging_plans,
        db.sync_outbox,
        version.id === updatedCurrent.id ? updatedCurrent : version,
        'UPDATE',
        now
      )
    }
  })
}
```

Implement `createSuccessorTariffVersion` by adapting `schedulePermanentTariffVersion` so it can carry `nextName`, `affiliation`, and `notes` forward into the successor.

- [ ] **Step 4: Wire the new services through the charging-plans hook and index**

Replace the old hook exports:

```ts
updateLogicalTariffDetails?: (input: UpdateLogicalTariffDetailsInput) => Promise<void>
schedulePermanentChange?: (input: SchedulePermanentTariffVersionInput) => Promise<void>
```

with:

```ts
updateCurrentVersion?: (input: UpdateCurrentTariffVersionInput) => Promise<void>
createSuccessorVersion?: (input: CreateSuccessorTariffVersionInput) => Promise<void>
```

and export the new types from `src/features/charging-plans/index.ts`:

```ts
export type {
  CreateSuccessorTariffVersionInput,
  LogicalTariffIdentityInput,
  ScheduleTemporaryPromotionInput,
  TariffPriceInput,
  UpdateCurrentTariffVersionInput,
} from './services/planService'
```

- [ ] **Step 5: Run the service test and confirm it passes**

Run: `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`

Expected: PASS with unchanged-date edits updating the current row in place and changed-date edits creating a successor.

## Task 4: Replace Old Tariff Surfaces And Add List Restoration

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.tsx`
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`

- [ ] **Step 1: Write failing tariff-list tests**

Add tests that define the new end-to-end tariff UX:

```tsx
it('opens unified edit instead of details or permanent-change surfaces', async () => {
  // Arrange: render one logical tariff card.
  renderTariffListInEditCapableMode()

  // Act: trigger the visible edit action.
  await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }))

  // Assert: only the unified tariff form is shown.
  expect(screen.getByRole('heading', { name: 'Edit Tariff' })).toBeInTheDocument()
  expect(screen.queryByText('Permanent Price Change Form')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Tariffs' })).not.toBeInTheDocument()
})

it('restores the same tariff card after cancel', async () => {
  // Arrange: render list mode with restoration hooks and open edit for one tariff.
  renderTariffListInEditCapableMode()
  await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }))

  // Act: cancel edit.
  await user.click(screen.getByRole('button', { name: /cancel/i }))

  // Assert: list mode returns and focuses the originating logical tariff card.
  expect(await screen.findByRole('button', { name: /edit ionity lidl/i })).toBeInTheDocument()
})
```

Update `TariffVersionActionMenu.test.tsx` to expect only promotion and delete callbacks:

```tsx
expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument()
expect(screen.queryByRole('button', { name: /change price permanently/i })).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: /run temporary promotion/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /delete tariff/i })).toBeInTheDocument()
```

- [ ] **Step 2: Run the tariff list and action-menu tests and verify failure**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`

Expected: FAIL because the list still renders separate `details` and `permanent_change` surfaces and the overflow menu still exposes both old actions.

- [ ] **Step 3: Narrow the tariff action menu**

Refactor `TariffVersionActionMenu.tsx` to expose only promotion and delete:

```tsx
interface TariffVersionActionMenuProps {
  label: string
  onPromotion: () => void
  onDelete: () => void
}

<button
  type="button"
  onClick={(event) => runAction(event, onPromotion)}
>
  Run temporary promotion
</button>
<button
  type="button"
  onClick={(event) => runAction(event, onDelete)}
>
  Delete tariff
</button>
```

Delete the old `onEditDetails` and `onPermanentChange` props and update all call sites.

- [ ] **Step 4: Refactor `TariffList.tsx` to render unified form mode and restore list context**

Update the props and state shape so `TariffList` receives app-owned form/restoration context:

```ts
interface TariffListProps {
  tariffFormState: TariffFormState
  restorationRequest?: TariffRestoreRequest
  onCreateTariff: () => void
  onEditTariff: (logicalTariffKey: string) => void
  onCloseForm: () => void
  onSaveComplete: (logicalTariffKey: string) => void
  onRestorationComplete?: () => void
  onFormOpenChange?: (isOpen: boolean) => void
}
```

Adopt the same restoration pattern used in `ChargingHistory`:

```ts
const tariffCardRefs = useRef(new Map<string, HTMLElement>())

useEffect(() => {
  if (restorationRequest == null || isLoading) {
    return
  }

  if (restorationRequest.type === 'position') {
    const focusTarget = restorationRequest.focusTariffKey == null
      ? null
      : tariffCardRefs.current.get(restorationRequest.focusTariffKey)

    if (restorationRequest.focusTariffKey != null && focusTarget == null) {
      return
    }

    window.scrollTo({ top: restorationRequest.scrollY, behavior: 'auto' })
    focusTarget?.focus({ preventScroll: true })
    onRestorationComplete?.()
    return
  }

  const tariffCard = tariffCardRefs.current.get(restorationRequest.tariffKey)
  if (tariffCard == null) {
    return
  }

  tariffCard.scrollIntoView({ behavior: 'auto', block: 'center' })
  tariffCard.focus({ preventScroll: true })
  onRestorationComplete?.()
}, [isLoading, onRestorationComplete, restorationRequest])
```

Render list mode and form mode separately:

```tsx
const isFormVisible = tariffFormState.mode !== 'closed' || resolvedSurface.kind === 'promotion'

if (tariffFormState.mode === 'create') {
  return (
    <TariffFormLoader
      mode="create"
      onSubmit={handleUnifiedSubmit}
      onCancel={onCloseForm}
    />
  )
}

if (tariffFormState.mode === 'edit' && activeLogicalTariff) {
  return (
    <TariffFormLoader
      mode="edit"
      onSubmit={handleUnifiedSubmit}
      onCancel={onCloseForm}
      initialValues={activeLogicalTariff.currentVersion ?? activeLogicalTariff.versions[0]}
    />
  )
}
```

Keep promotion and delete as the only remaining secondary flows. Use `onSaveComplete(activeLogicalTariff.key)` after successful create/edit save.

- [ ] **Step 5: Run the tariff list and action-menu tests and confirm they pass**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`

Expected: PASS with the old edit surfaces removed, the list hidden during edit, and list restoration working after close.

## Task 5: Wire Unified Form Submit To The New Hook APIs And Run Full Verification

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Modify: `src/features/charging-plans/hooks/useChargingPlans.ts`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add a failing integration assertion for create vs update vs successor behavior**

Extend `TariffList.test.tsx` with one submit-routing assertion:

```tsx
it('routes unchanged valid_from edits to current-version update and changed valid_from edits to successor creation', async () => {
  // Arrange: render with hook spies for both unified edit mutations.
  const updateCurrentVersion = vi.fn().mockResolvedValue(undefined)
  const createSuccessorVersion = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useChargingPlans).mockReturnValue(buildHookValue({ updateCurrentVersion, createSuccessorVersion }))
  renderTariffListInEditCapableMode()

  // Act: open edit and save unchanged valid_from.
  await user.click(screen.getByRole('button', { name: /edit ionity lidl/i }))
  await user.click(screen.getByRole('button', { name: /save tariff/i }))

  // Assert: unchanged start date updates current version.
  await waitFor(() => expect(updateCurrentVersion).toHaveBeenCalledTimes(1))
  expect(createSuccessorVersion).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the targeted tariff list test and verify failure**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`

Expected: FAIL because `TariffList` does not yet branch on `TariffFormSubmit.intent`.

- [ ] **Step 3: Implement the submit router in `TariffList.tsx`**

Add one unified submit handler:

```ts
const handleUnifiedSubmit = async (submission: TariffFormSubmit) => {
  if (submission.intent === 'create') {
    await addChargingPlan({
      id: submission.plan.id,
      user_id: user?.id ?? submission.plan.user_id,
      provider_id: submission.plan.provider_id,
      name: submission.plan.name,
      valid_from: submission.plan.valid_from,
      valid_to: submission.plan.valid_to,
      ac_price_per_kwh: submission.plan.ac_price_per_kwh,
      dc_price_per_kwh: submission.plan.dc_price_per_kwh,
      roaming_ac_price_per_kwh: submission.plan.roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh: submission.plan.roaming_dc_price_per_kwh,
      monthly_base_fee: submission.plan.monthly_base_fee,
      session_fee: submission.plan.session_fee,
      affiliation: submission.plan.affiliation,
      notes: submission.plan.notes,
      created_at: submission.plan.created_at,
      updated_at: submission.plan.updated_at,
      deleted_at: submission.plan.deleted_at,
    })
    onSaveComplete(getLogicalTariffKey(submission.plan))
    return
  }

  if (!submission.logicalIdentity) {
    throw new Error('Existing tariff edits require logical identity context')
  }

  if (submission.intent === 'update_current') {
    await updateCurrentVersion?.({
      userId: user?.id ?? '',
      providerId: submission.logicalIdentity.providerId,
      name: submission.logicalIdentity.name,
      currentVersionId: submission.plan.id,
      validFrom: submission.plan.valid_from,
      nextName: submission.plan.name,
      prices: {
        ac_price_per_kwh: submission.plan.ac_price_per_kwh,
        dc_price_per_kwh: submission.plan.dc_price_per_kwh,
        roaming_ac_price_per_kwh: submission.plan.roaming_ac_price_per_kwh,
        roaming_dc_price_per_kwh: submission.plan.roaming_dc_price_per_kwh,
        monthly_base_fee: submission.plan.monthly_base_fee,
        session_fee: submission.plan.session_fee,
      },
      affiliation: submission.plan.affiliation,
      notes: submission.plan.notes,
    })
    onSaveComplete(getLogicalTariffKey({
      provider_id: submission.plan.provider_id,
      name: submission.plan.name,
    }))
    return
  }

  await createSuccessorVersion?.({
    userId: user?.id ?? '',
    providerId: submission.logicalIdentity.providerId,
    name: submission.logicalIdentity.name,
    effectiveFrom: submission.plan.valid_from,
    nextName: submission.plan.name,
    prices: {
      ac_price_per_kwh: submission.plan.ac_price_per_kwh,
      dc_price_per_kwh: submission.plan.dc_price_per_kwh,
      roaming_ac_price_per_kwh: submission.plan.roaming_ac_price_per_kwh,
      roaming_dc_price_per_kwh: submission.plan.roaming_dc_price_per_kwh,
      monthly_base_fee: submission.plan.monthly_base_fee,
      session_fee: submission.plan.session_fee,
    },
    affiliation: submission.plan.affiliation,
    notes: submission.plan.notes,
  })
  onSaveComplete(getLogicalTariffKey({
    provider_id: submission.plan.provider_id,
    name: submission.plan.name,
  }))
}
```

- [ ] **Step 4: Run focused verification, then repo-wide verification**

Run focused checks first:

Run: `npm run test -- --run src/app/App.tariff-editing.test.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx src/features/charging-plans/services/chargingPlanService.test.ts`

Expected: PASS

Then run full verification:

Run: `npm run lint`
Expected: PASS

Run: `npm run test -- --run`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit the unified tariff editing change**

Run:

```bash
git add src/app/App.tsx src/app/App.tariff-editing.test.tsx src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/components/TariffFormLoader.tsx src/features/charging-plans/hooks/useChargingPlans.ts src/features/charging-plans/services/planService.ts src/features/charging-plans/services/chargingPlanService.test.ts src/features/charging-plans/index.ts docs/superpowers/specs/2026-06-16-unified-tariff-editing-design.md docs/superpowers/plans/2026-06-16-unified-tariff-editing.md
git commit -m "feat(tariffs): unify create and edit tariff flows"
```

Expected: commit created with the unified editor, explicit version-edit branching, and restored long-list context.
