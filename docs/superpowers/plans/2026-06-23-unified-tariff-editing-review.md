# Unified Tariff Editing Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the next focused review branch after PR 3 by replacing the separate tariff details, permanent price change, and history surfaces with one app-owned tariff create/edit form flow.

**Architecture:** Start from `origin/main` after PR 3 (`30755d3`) and keep this PR scoped to the unified edit UX. `App.tsx` owns whether the tariffs tab is in list mode, create mode, or edit mode; `TariffList` renders the appropriate tariff form surface and delegates save completion back to the shell. Existing tariff-version services (`updateCurrentTariffVersion` and `createSuccessorTariffVersion`) remain the persistence boundary.

**Tech Stack:** React 19, TypeScript, Vite, React Hook Form, Zod, Dexie, Vitest, React Testing Library, fake IndexedDB

---

## Branch Scope

Create branch: `review/tariff-unified-editing`

Base: `origin/main`

Source reference: `feat/tariff-version-management`

Include these functional changes:

- App-owned tariff create/edit/list mode switching.
- Unified `TariffForm` create/edit submit contract.
- Edit-mode provider lock with editable tariff name.
- Save behavior that updates current version when `Valid From` is unchanged.
- Save behavior that creates a successor when `Valid From` changes.
- Tariff list restoration after cancel/save.
- Removal of tariff details, permanent price change, and history UI entry points.

Do not include these leftovers in this PR:

- `src/app/bootstrap.ts`, `src/app/bootstrap.test.ts`, `src/main.tsx`, `vite.config.ts`, or `vitest.config.ts` dev bootstrap changes.
- `src/mocks/seed-data.ts` or `src/mocks/seed-data.test.ts` mock scenario changes.
- `docs/superpowers/specs/*` and older branch plan/handoff files.
- `package.json`, `package-lock.json`, `.nvmrc`, or `.github/workflows/ci.yml` dependency/runtime changes unless the branch cannot verify without them.

## File Map

- Modify: `src/app/App.tsx`
  - Own `TariffFormState` and restoration requests.
  - Replace `isCreatingTariff` with create/edit/closed form state.
- Create: `src/app/App.tariff-editing.test.tsx`
  - Cover app-shell mode switching, list hiding, cancel restoration, and save restoration after rename.
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
  - Replace the current `details` mode with one `create | edit` form.
  - Return a submit envelope that identifies `create`, `update_current`, or `create_successor`.
  - Disable provider selection in edit mode.
- Modify: `src/features/charging-plans/components/TariffFormLoader.tsx`
  - Align lazy props with the narrowed form API.
- Modify: `src/features/charging-plans/components/TariffForm.test.tsx`
  - Update existing create expectations for the submit envelope.
  - Add edit-mode tests for provider lock and intent selection.
- Modify: `src/features/charging-plans/components/TariffList.tsx`
  - Accept app-owned tariff form state and restoration props.
  - Remove permanent-change and history surfaces from the main list workflow.
  - Keep temporary promotion and delete surfaces.
  - Route edit saves to `updateCurrentVersion` or `createSuccessorVersion`.
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
  - Cover hidden list during app-owned edit, promotion/delete still available, save dispatch, and restoration.
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.tsx`
  - Remove `Edit details` and `Change price permanently`.
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`
  - Assert only promotion and delete remain.
- Delete: `src/features/charging-plans/components/TariffVersionHistorySheet.tsx`
- Delete: `src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx`
  - The version history link is removed in this PR.
- Modify: `src/features/charging-plans/services/chargingPlanService.test.ts`
  - Add/adjust service-level coverage for unchanged-date current edits and changed-date successor edits if existing tests do not already cover these exact shell-driven semantics.

## Required Invariants

1. Tariffs tab shows either list mode or tariff form mode, never both.
2. `Provider` is editable only in create mode.
3. `Tariff Name` stays editable in edit mode.
4. In edit mode, unchanged `valid_from` calls `updateCurrentVersion`.
5. In edit mode, changed `valid_from` calls `createSuccessorVersion`.
6. Temporary promotion remains a dedicated workflow.
7. Delete remains available from the overflow menu.
8. Historical charging sessions keep stored snapshots.
9. Cancel returns to the launch scroll position and focuses the original card.
10. Save returns focus to the post-save logical tariff key, including rename cases.

## Task 1: Prepare the Review Branch

**Files:**
- No file edits in this task.

- [ ] **Step 1: Verify the clean baseline**

Run:

```bash
git status --short --branch
git fetch --all --prune
git switch -c review/tariff-unified-editing origin/main
git status --short --branch
```

Expected:

```text
## review/tariff-unified-editing
```

with no modified files.

- [ ] **Step 2: Confirm PR 3 is already present**

Run:

```bash
git log --oneline --max-count=5
```

Expected: the top history includes the merged PR 3 commits, including:

```text
fix(tariffs): show zero-valued roaming prices
test(tariffs): cover upcoming tariff visibility states
feat(tariffs): render contextual upcoming version visibility
fix(tariffs): hide empty optional price rows
```

## Task 2: Add App-Owned Tariff Form Mode

**Files:**
- Create: `src/app/App.tariff-editing.test.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Write failing app-shell tests**

Create `src/app/App.tariff-editing.test.tsx` with a suite-level JSDoc block and two tests:

```tsx
/**
 * Test suite for app-owned tariff create/edit mode.
 *
 * Verifies tariff editing replaces the list surface and restores list context
 * after cancel or save.
 */
describe('App tariff editing', () => {
  it('hides the tariff list while edit mode is active and restores it on cancel', async () => {
    // Arrange: render the authenticated app, switch to tariffs, and capture scroll.
    // Act: click "Edit Ionity Lidl", then click "Cancel".
    // Assert: "Edit Tariff" replaces "Tariffs", then "Tariffs" returns and focus is restored.
  })

  it('restores focus to the renamed tariff after save completes', async () => {
    // Arrange: render tariffs with a logical tariff named "Lidl".
    // Act: open edit and submit a mocked form payload that renames it to "Lidl Plus".
    // Assert: list mode returns and focus lands on "Edit Ionity Lidl Plus".
  })
})
```

Use the existing app test mocking style. Mock `TariffFormLoader` so it renders `Edit Tariff`, `Save Tariff`, and `Cancel`, and calls `onSubmit` with a `TariffFormSubmit` envelope.

- [ ] **Step 2: Run the app tests and verify failure**

Run:

```bash
npm run test -- --run src/app/App.tariff-editing.test.tsx
```

Expected: FAIL because `App.tsx` only owns create mode via `isCreatingTariff`.

- [ ] **Step 3: Add shell-owned tariff state to `App.tsx`**

Add these local types near the existing session restore types:

```ts
type TariffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; logicalTariffKey: string }

type TariffRestoreRequest =
  | { type: 'position'; scrollY: number; focusTariffKey?: string | null }
  | { type: 'tariff'; tariffKey: string }
```

Replace `isCreatingTariff` state with:

```ts
const [tariffFormState, setTariffFormState] = useState<TariffFormState>({ mode: 'closed' })
const [tariffRestoreRequest, setTariffRestoreRequest] = useState<TariffRestoreRequest | null>(null)
const tariffScrollSnapshotRef = useRef(0)
const isTariffFormVisible = tariffFormState.mode !== 'closed'
```

- [ ] **Step 4: Add app-shell open, close, and save handlers**

Add:

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

- [ ] **Step 5: Wire `TariffList` from `App.tsx`**

Replace the old props:

```tsx
isCreatingTariff={isCreatingTariff}
onCreateTariffChange={setIsCreatingTariff}
```

with:

```tsx
tariffFormState={tariffFormState}
restorationRequest={tariffRestoreRequest ?? undefined}
onCreateTariff={handleOpenCreateTariff}
onEditTariff={handleOpenEditTariff}
onCloseForm={handleCloseTariffForm}
onSaveComplete={handleTariffSaveComplete}
onRestorationComplete={() => setTariffRestoreRequest(null)}
```

Update mobile context visibility to use `!isTariffFormVisible`.

- [ ] **Step 6: Run the app tests**

Run:

```bash
npm run test -- --run src/app/App.tariff-editing.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/app/App.tsx src/app/App.tariff-editing.test.tsx
git commit -m "feat(tariffs): move tariff edit mode to app shell"
```

## Task 3: Narrow the Tariff Form API

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Modify: `src/features/charging-plans/components/TariffFormLoader.tsx`
- Modify: `src/features/charging-plans/components/TariffForm.test.tsx`

- [ ] **Step 1: Add failing form tests**

In `TariffForm.test.tsx`, update create assertions to expect:

```ts
expect.objectContaining({
  intent: 'create',
  plan: expect.objectContaining({
    name: 'Travel Tariff',
    provider_id: 'p1',
  }),
})
```

Add edit tests for:

```tsx
it('locks provider and keeps tariff name editable in edit mode', () => {
  // Arrange: render mode="edit" with provider_id "p1" and name "Lidl".
  // Assert: Provider is disabled and Tariff Name is enabled.
})

it('submits update_current when valid from is unchanged', async () => {
  // Arrange: initial valid_from is 2026-01-01.
  // Act: change name only and save.
  // Assert: onSubmit receives intent "update_current".
})

it('submits create_successor when valid from changes', async () => {
  // Arrange: initial valid_from is 2026-01-01.
  // Act: change Valid From to 2026-08-15 and save.
  // Assert: onSubmit receives intent "create_successor".
})
```

- [ ] **Step 2: Run form tests and verify failure**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx
```

Expected: FAIL because create still submits a bare `ChargingPlan` and `details` mode still exists.

- [ ] **Step 3: Define the new submit contract**

In `TariffForm.tsx`, replace the prop union with:

```ts
export type TariffFormSubmit =
  | { intent: 'create'; plan: ChargingPlan }
  | {
      intent: 'update_current'
      plan: ChargingPlan
      logicalIdentity: { providerId: string; name: string }
      originalValidFrom: Date
    }
  | {
      intent: 'create_successor'
      plan: ChargingPlan
      logicalIdentity: { providerId: string; name: string }
      originalValidFrom: Date
    }

export interface TariffFormProps {
  mode?: 'create' | 'edit'
  onSubmit: (data: TariffFormSubmit) => Promise<void>
  onCancel: () => void
  initialValues?: Partial<ChargingPlan>
}
```

Delete `LogicalTariffDetailsValues`, `DetailsTariffFormProps`, `tariffDetailsSchema`, `TariffDetailsSchemaValues`, and `DetailsTariffForm`.

- [ ] **Step 4: Add provider disable support**

Extend `ProviderSelectProps`:

```ts
interface ProviderSelectProps {
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}
```

Pass `disabled` to the `<select>` and add `disabled:opacity-70` to its class list.

In `StandardTariffForm`, use:

```tsx
<ProviderSelect
  value={field.value}
  onChange={field.onChange}
  error={errors.provider_id?.message}
  disabled={resolvedMode === 'edit'}
/>
```

- [ ] **Step 5: Emit submit intents**

In `handleFormSubmit`, build the `ChargingPlan` exactly once. For create mode, submit:

```ts
await onSubmit({ intent: 'create', plan })
```

For edit mode, compare `plan.valid_from.getTime()` with `coerceDate(initialValues?.valid_from)?.getTime()` and submit:

```ts
await onSubmit({
  intent: isSameValidFrom ? 'update_current' : 'create_successor',
  plan,
  logicalIdentity: {
    providerId: initialValues?.provider_id ?? plan.provider_id,
    name: initialValues?.name ?? '',
  },
  originalValidFrom,
})
```

If `originalValidFrom` is missing in edit mode, surface `Unable to resolve the original tariff start date.` through `setError('root.submit', ...)`.

- [ ] **Step 6: Update `TariffFormLoader.tsx`**

Ensure the lazy component props accept only the new `TariffFormProps` type from `TariffForm.tsx`.

- [ ] **Step 7: Run form tests**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffFormLoader.tsx src/features/charging-plans/components/TariffForm.test.tsx
git commit -m "feat(tariffs): unify tariff form submit flow"
```

## Task 4: Update Tariff List Workflow

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
- Modify: `src/features/charging-plans/services/chargingPlanService.test.ts`

- [ ] **Step 1: Add failing list tests**

Add tests that assert:

```tsx
it('opens app-owned edit mode from the primary edit action', async () => {
  // Arrange: render TariffList with tariffFormState closed and onEditTariff spy.
  // Act: click "Edit Ionity Lidl".
  // Assert: onEditTariff receives the logical tariff key.
})

it('hides the list while app-owned edit form is visible', () => {
  // Arrange: render TariffList with tariffFormState { mode: 'edit', logicalTariffKey: 'provider-1::lidl' }.
  // Assert: "Edit Tariff" is visible and the tariff card is not visible.
})

it('dispatches updateCurrentVersion when edit submit keeps valid from unchanged', async () => {
  // Arrange: render edit mode with a mocked TariffFormLoader submission intent "update_current".
  // Assert: updateCurrentVersion receives currentVersionId, validFrom, prices, nextName, affiliation, and notes.
})

it('dispatches createSuccessorVersion when edit submit changes valid from', async () => {
  // Arrange: render edit mode with a mocked TariffFormLoader submission intent "create_successor".
  // Assert: createSuccessorVersion receives effectiveFrom, prices, nextName, affiliation, and notes.
})
```

- [ ] **Step 2: Run list tests and verify failure**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx
```

Expected: FAIL because `TariffList` still uses `details`, `permanent_change`, and `history` surfaces.

- [ ] **Step 3: Replace `TariffListProps`**

Use:

```ts
type TariffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; logicalTariffKey: string }

type TariffRestoreRequest =
  | { type: 'position'; scrollY: number; focusTariffKey?: string | null }
  | { type: 'tariff'; tariffKey: string }

interface TariffListProps {
  tariffFormState: TariffFormState
  restorationRequest?: TariffRestoreRequest
  onCreateTariff: () => void
  onEditTariff: (logicalTariffKey: string) => void
  onCloseForm: () => void
  onSaveComplete: (logicalTariffKey: string) => void
  onRestorationComplete: () => void
  onFormOpenChange?: (isOpen: boolean) => void
}
```

- [ ] **Step 4: Remove obsolete surfaces**

Change `TariffSurface` to:

```ts
type TariffSurface =
  | { kind: 'none' }
  | { kind: 'promotion'; key: string }
  | { kind: 'delete'; key: string }
```

Remove imports and render blocks for `PermanentPriceChangeForm` and `TariffVersionHistorySheet`.

- [ ] **Step 5: Render create/edit form from app state**

Use `tariffFormState.mode` to decide form visibility:

```ts
const isShellOwnedFormVisible = tariffFormState.mode !== 'closed'
const isCreateOpen = tariffFormState.mode === 'create'
const activeEditLogicalTariff = tariffFormState.mode === 'edit'
  ? logicalTariffsByKey.get(tariffFormState.logicalTariffKey) ?? null
  : null
```

Render `TariffFormLoader` in create mode and edit mode. Create mode should call `addChargingPlan({ ...submission.plan, user_id: user?.id ?? submission.plan.user_id })`. Edit mode should map `submission.plan` into `prices` and call the appropriate hook mutation based on `submission.intent`.

- [ ] **Step 6: Restore list context**

Store edit buttons by logical key:

```ts
const editButtonElementsRef = useRef<Record<string, HTMLButtonElement | null>>({})
```

When `restorationRequest` changes:

```ts
useEffect(() => {
  if (!restorationRequest) return

  if (restorationRequest.type === 'position') {
    window.scrollTo({ top: restorationRequest.scrollY, behavior: 'auto' })
    const focusKey = restorationRequest.focusTariffKey
    if (focusKey) {
      editButtonElementsRef.current[focusKey]?.focus()
    }
  }

  if (restorationRequest.type === 'tariff') {
    editButtonElementsRef.current[restorationRequest.tariffKey]?.focus()
  }

  onRestorationComplete()
}, [restorationRequest, onRestorationComplete])
```

- [ ] **Step 7: Run list and service tests**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/services/chargingPlanService.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/services/chargingPlanService.test.ts
git commit -m "feat(tariffs): route list edits through unified form"
```

## Task 5: Remove Obsolete Menu And History UI

**Files:**
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.tsx`
- Modify: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`
- Delete: `src/features/charging-plans/components/TariffVersionHistorySheet.tsx`
- Delete: `src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx`

- [ ] **Step 1: Update action menu tests**

Change the main menu test to assert only:

```ts
expect(screen.getByRole('button', { name: /run temporary promotion/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /delete tariff/i })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument()
expect(screen.queryByRole('button', { name: /change price permanently/i })).not.toBeInTheDocument()
```

- [ ] **Step 2: Run menu tests and verify failure**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffVersionActionMenu.test.tsx
```

Expected: FAIL because obsolete actions still render.

- [ ] **Step 3: Remove obsolete menu props and buttons**

Delete `onEditDetails` and `onPermanentChange` from `TariffVersionActionMenuProps` and remove their buttons.

- [ ] **Step 4: Delete history sheet files**

Run:

```bash
git rm src/features/charging-plans/components/TariffVersionHistorySheet.tsx src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx
```

- [ ] **Step 5: Run menu/list tests**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/TariffVersionActionMenu.test.tsx src/features/charging-plans/components/TariffList.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/features/charging-plans/components/TariffVersionActionMenu.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx
git add -u src/features/charging-plans/components/TariffVersionHistorySheet.tsx src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx
git commit -m "refactor(tariffs): remove separate tariff history and price-change actions"
```

## Task 6: Final Verification

**Files:**
- No intentional file edits.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm run test -- --run src/app/App.tariff-editing.test.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx src/features/charging-plans/services/chargingPlanService.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full required verification**

Run:

```bash
npm run lint && npm run test -- --run && npm run build
```

Expected: PASS.

- [ ] **Step 3: Review final scope**

Run:

```bash
git diff --stat origin/main..HEAD
git diff --name-status origin/main..HEAD
```

Expected: changes are limited to app shell, tariff form/list/menu/tests, and deleted history sheet files. No docs, mocks, bootstrap, package, or CI files should appear.

## Suggested PR

Title:

```text
feat(tariffs): unify tariff editing flow
```

Summary:

```markdown
## Summary
- replace separate tariff details/permanent-change/history surfaces with one create/edit tariff form
- move tariff edit mode ownership into the app shell so list and form mode are mutually exclusive
- route unchanged Valid From edits to current-version updates and changed Valid From edits to successor creation
- preserve list focus context after cancel/save, including renamed tariff keys

## Verification
- npm run lint
- npm run test -- --run
- npm run build
```

## Follow-Up PR After This

After this PR merges, create a final cleanup/support PR for:

- `src/app/bootstrap.ts` and `src/main.tsx` dev service-worker cleanup.
- `vite.config.ts` and `vitest.config.ts` local verification stability.
- `src/mocks/seed-data.ts` active promo tariff/session demo data.
- Superpowers specs/plans that should be retained as project documentation.
- Any dependency/runtime changes that remain necessary after the current `origin/main` state.
