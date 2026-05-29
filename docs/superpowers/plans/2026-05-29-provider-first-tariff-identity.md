# Provider-First Tariff Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tariff cards provider-first, make tariff name optional as a variant label, and enforce one unnamed tariff per provider.

**Architecture:** Keep the existing charging-plan persistence model and enforce the unnamed-variant invariant in the charging-plan save path. Render provider name as the tariff card title and show tariff name only when present after trimming. Align form validation and submit normalization with the same invariant so list, form, and save behavior stay consistent offline-first.

**Tech Stack:** React 19, TypeScript, Dexie, React Hook Form, Zod, Vitest, React Testing Library

---

### Task 1: Provider-first card identity in tariff list

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Test: `src/features/charging-plans/components/TariffList.test.tsx`

- [ ] **Step 1: Write failing list tests for provider-first card identity**
```ts
it('renders provider name as tariff card title', () => {
  // Arrange: mock plans + providers so provider_id resolves to provider name.
  // Act: render TariffList.
  // Assert: title equals provider name and plan_name is not used as title.
});

it('renders variant subtitle only when plan_name has trimmed content', () => {
  // Arrange: one plan with plan_name "Premium", one with "   ".
  // Act: render TariffList.
  // Assert: "Premium" shown as subtitle, blank variant subtitle omitted.
});

it('does not render static "Tariff" subtitle', () => {
  // Arrange: render with any plan.
  // Assert: text "Tariff" is absent from card subtitle area.
});
```

- [ ] **Step 2: Run list tests to verify failure first**
Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`  
Expected: FAIL on missing provider-title and subtitle behavior.

- [ ] **Step 3: Implement provider-name resolution and subtitle rules**
```ts
// TariffList.tsx (core logic)
const { providers } = useProviders();
const providerNameById = new Map(providers.map((provider) => [provider.id, provider.name]));

// For each plan:
const providerName = providerNameById.get(plan.provider_id) ?? 'Unknown provider';
const variantName = (plan.plan_name ?? '').trim();

// Render:
// <h2>{providerName}</h2>
// {variantName ? <p>{variantName}</p> : null}
```

- [ ] **Step 4: Re-run list tests to verify pass**
Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit list identity changes**
```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx
git commit -m "feat(tariffs): render provider-first card identity"
```

---

### Task 2: Make tariff name optional in form and normalize on submit

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Test: `src/features/charging-plans/components/TariffForm.test.tsx`

- [ ] **Step 1: Write failing form tests for optional tariff name**
```ts
it('submits when tariff name is empty and provider is selected', async () => {
  // Arrange: fill provider and required fields, leave tariff name empty.
  // Act: submit form.
  // Assert: onSubmit called once.
});

it('normalizes whitespace tariff name to empty string', async () => {
  // Arrange: input plan_name as "   ".
  // Act: submit form.
  // Assert: onSubmit payload contains plan_name: ''.
});
```

- [ ] **Step 2: Run form tests to verify failure first**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: FAIL because `plan_name` is currently required and unnormalized.

- [ ] **Step 3: Update form schema and normalization**
```ts
// zod schema
plan_name: z.string().optional()

// submit normalization
const normalizedPlanName = (values.plan_name ?? '').trim();

await onSubmit({
  ...,
  plan_name: normalizedPlanName,
  ...
});
```

- [ ] **Step 4: Update field copy to reflect optionality**
```tsx
<ThinInput label="Tariff Name (Optional)" ... />
```

- [ ] **Step 5: Re-run form tests to verify pass**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit form optional-name changes**
```bash
git add src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffForm.test.tsx
git commit -m "refactor(tariffs): make tariff name optional and normalize blank names"
```

---

### Task 3: Enforce one unnamed tariff per provider in save service

**Files:**
- Modify: `src/features/charging-plans/services/planService.ts`
- Create (if missing) or Modify: `src/features/charging-plans/services/planService.test.ts`

- [ ] **Step 1: Write failing service tests for unnamed-variant invariant**
```ts
it('allows the first unnamed tariff for a provider', async () => {
  // Arrange: no existing unnamed tariff for provider.
  // Assert: save resolves.
});

it('rejects creating a second unnamed tariff for the same provider', async () => {
  // Arrange: existing active unnamed tariff same provider.
  // Assert: save rejects with invariant error.
});

it('allows named and unnamed tariffs together for same provider', async () => {
  // Arrange: existing unnamed + new named (or vice versa).
  // Assert: save resolves.
});

it('allows unnamed tariffs on different providers', async () => {
  // Arrange: unnamed for provider A exists.
  // Assert: unnamed save for provider B resolves.
});
```

- [ ] **Step 2: Run service tests to verify failure first**
Run: `npm run test -- --run src/features/charging-plans/services/planService.test.ts`  
Expected: FAIL because invariant is not enforced.

- [ ] **Step 3: Implement unnamed-variant validation in save path**
```ts
const normalizedPlanName = (plan.plan_name ?? '').trim();
const isUnnamed = normalizedPlanName.length === 0;

if (isUnnamed) {
  const duplicateUnnamed = await db.charging_plans
    .where('provider_id')
    .equals(plan.provider_id)
    .filter((plan) => !plan.deleted_at && plan.id !== plan.id && (plan.plan_name ?? '').trim().length === 0)
    .first();

  if (duplicateUnnamed) {
    throw new Error('Only one unnamed tariff is allowed per provider');
  }
}

// Persist with normalized plan_name
plan_name: normalizedPlanName,
```

- [ ] **Step 4: Re-run service tests to verify pass**
Run: `npm run test -- --run src/features/charging-plans/services/planService.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit service invariant changes**
```bash
git add src/features/charging-plans/services/planService.ts src/features/charging-plans/services/planService.test.ts
git commit -m "feat(tariffs): enforce single unnamed tariff per provider"
```

---

### Task 4: Surface invariant errors in the tariff form UX

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Modify: `src/features/charging-plans/components/TariffList.tsx` (only if error state is owned there)
- Test: `src/features/charging-plans/components/TariffForm.test.tsx`

- [ ] **Step 1: Write failing UX test for duplicate unnamed tariff error**
```ts
it('shows duplicate unnamed tariff error when save rejects with invariant message', async () => {
  // Arrange: mock onSubmit rejection with invariant error message.
  // Act: submit unnamed tariff.
  // Assert: error text is visible and inputs remain populated.
});
```

- [ ] **Step 2: Run form tests to verify failure first**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: FAIL because invariant message is not surfaced.

- [ ] **Step 3: Implement user-facing error handling**
```ts
// TariffForm submit wrapper
try {
  await onSubmit(payload);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unable to save tariff';
  setSubmitError(message);
}

// Render submit error block
{submitError ? <p role="alert">{submitError}</p> : null}
```

- [ ] **Step 4: Re-run form tests to verify pass**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit form error-surfacing changes**
```bash
git add src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/components/TariffList.tsx
git commit -m "feat(tariffs): surface unnamed variant validation errors in form"
```

---

### Task 5: End-to-end verification and handoff notes

**Files:**
- Modify: none

- [ ] **Step 1: Run targeted tariff suite**
Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/services/planService.test.ts`  
Expected: PASS.

- [ ] **Step 2: Run required project gates**
Run: `npm run lint && npm run test -- --run && npm run build`  
Expected: PASS.

- [ ] **Step 3: Record manual browser verification**
Run app and verify:
- provider displayed as card title,
- optional variant subtitle behavior,
- duplicate unnamed tariff blocked with user-visible error.

- [ ] **Step 4: Prepare handoff summary**
Include:
- changed files,
- test/build results,
- risks (fallback `Unknown provider` indicates data integrity issue),
- suggested final commit summary.

- [ ] **Step 5: Optional bundle analysis if impact concern appears**
Run: `npm run build:analyze`  
Expected: `dist/bundle-stats.json` generated; note meaningful deltas only.

## Public Interfaces and Contract Changes
- Form behavior: `plan_name` moves from required input semantics to optional input semantics.
- Save contract: `plan_name` is normalized by trimming before persistence.
- Domain invariant: per-provider active tariffs may include at most one unnamed (`plan_name === ''`) record.
- List identity contract: card title uses provider name; tariff variant name is optional subtitle.

## Self-Review Notes
- Spec coverage: list identity, optional name, invariant enforcement, and error surfacing are each mapped to dedicated tasks.
- Placeholder scan: no TODO/TBD markers or abstract instructions remain.
- Type consistency: `plan_name` normalization and invariant logic use the same trimmed-empty definition across form/service/list.

## Assumptions
- `saveChargingPlan` in `planService` is the canonical write path for tariff create/update.
- Active records are defined as records without `deleted_at`.
- No schema migration is required for this change.
