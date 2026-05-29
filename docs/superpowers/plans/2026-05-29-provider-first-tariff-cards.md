# Provider-First Tariff Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show provider as the primary tariff-card identity, make tariff name optional as a variant label, and enforce only one unnamed tariff per provider.

**Architecture:** Keep persistence shape intact and enforce the unnamed-variant rule in application/service validation before writes. Update list rendering to resolve provider names and only show a variant subtitle when `plan_name` is non-empty. Align form validation with the same rule so user feedback is immediate and consistent.

**Tech Stack:** React 19, TypeScript, Vite, Dexie, Vitest, React Testing Library, Zod, React Hook Form

---

### Task 1: Add provider lookup in tariff list and switch to provider-first card identity

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Test: `src/features/charging-plans/components/TariffList.test.tsx`

- [ ] **Step 1: Write failing UI tests for provider-first identity**
```ts
it('shows provider name as card title and hides generic tariff subtitle', () => {
  // mock useChargingPlans + useProviders
  // assert provider name is visible
  // assert "Tariff" subtitle is absent
});

it('shows variant subtitle only when plan_name is non-empty', () => {
  // one plan with plan_name, one with ""
  // assert non-empty one shows subtitle
  // assert empty one does not
});
```

- [ ] **Step 2: Run test to verify failures**
Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`  
Expected: FAIL on missing provider-title behavior.

- [ ] **Step 3: Implement provider-first rendering**
```ts
// in TariffList.tsx
const { providers } = useProviders();
const providerNameById = new Map(providers.map((p) => [p.id, p.name]));
const trimmedPlanName = (plan.plan_name ?? '').trim();
const providerName = providerNameById.get(plan.provider_id) ?? 'Unknown provider';

// h2 => providerName
// optional subtitle => render only if trimmedPlanName.length > 0
// do not render static "Tariff" label
```

- [ ] **Step 4: Run test to verify pass**
Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx
git commit -m "feat(tariffs): show provider-first card identity with optional variant subtitle"
```

---

### Task 2: Make tariff name optional in form and trim/normalize value on submit

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Test: `src/features/charging-plans/components/TariffForm.test.tsx`

- [ ] **Step 1: Write failing form tests for optional tariff name**
```ts
it('allows submission without tariff name when provider is selected', async () => {
  // fill provider + required dates only
  // submit
  // expect onSubmit called
});

it('trims tariff name and omits subtitle semantics when blank', async () => {
  // input "   "
  // submit
  // expect payload plan_name normalized to ""
});
```

- [ ] **Step 2: Run tests and confirm failures**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: FAIL because `plan_name` currently required.

- [ ] **Step 3: Implement optional-name schema + normalization**
```ts
// zod schema: plan_name optional
plan_name: z.string().optional()

// default value still ''
// on submit:
const normalizedPlanName = (values.plan_name ?? '').trim();

// persist:
plan_name: normalizedPlanName
```

- [ ] **Step 4: Update form label/help copy**
```tsx
<ThinInput label="Tariff Name (Optional)" ... />
```

- [ ] **Step 5: Re-run tests**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffForm.test.tsx
git commit -m "refactor(tariffs): make tariff name optional and normalize blank values"
```

---

### Task 3: Enforce one unnamed tariff per provider in save path

**Files:**
- Modify: `src/features/charging-plans/services/chargingPlanService.ts`
- Test: `src/features/charging-plans/services/chargingPlanService.test.ts` (create if missing)

- [ ] **Step 1: Write failing service tests for unnamed-variant constraint**
```ts
it('allows first unnamed tariff for a provider', async () => {});

it('rejects second unnamed tariff for same provider', async () => {
  // expect throw with clear message
});

it('allows unnamed tariffs for different providers', async () => {});

it('allows named + unnamed tariffs for same provider', async () => {});
```

- [ ] **Step 2: Run tests and confirm failures**
Run: `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`  
Expected: FAIL on missing constraint.

- [ ] **Step 3: Implement validation before write**
```ts
// pseudo in saveChargingPlan
const normalizedPlanName = (plan.plan_name ?? '').trim();
const isUnnamed = normalizedPlanName.length === 0;

if (isUnnamed) {
  const existingUnnamed = await db.charging_plans
    .where('provider_id')
    .equals(plan.provider_id)
    .filter((p) => !p.deleted_at && p.id !== plan.id && (p.plan_name ?? '').trim().length === 0)
    .first();

  if (existingUnnamed) {
    throw new Error('Only one unnamed tariff is allowed per provider');
  }
}
```

- [ ] **Step 4: Ensure write uses normalized name**
```ts
plan_name: normalizedPlanName
```

- [ ] **Step 5: Re-run service tests**
Run: `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/features/charging-plans/services/chargingPlanService.ts src/features/charging-plans/services/chargingPlanService.test.ts
git commit -m "feat(tariffs): enforce single unnamed tariff per provider"
```

---

### Task 4: Surface unnamed-variant validation in form UX

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Modify: `src/features/charging-plans/components/TariffList.tsx` (if error handling lives there)
- Test: `src/features/charging-plans/components/TariffForm.test.tsx` (or list test if submit path handled there)

- [ ] **Step 1: Write failing UX test for duplicate unnamed variant error**
```ts
it('shows validation error when creating second unnamed tariff for provider', async () => {
  // mock save rejection error
  // submit unnamed tariff
  // expect visible error message
});
```

- [ ] **Step 2: Run target test and confirm failure**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: FAIL on absent error UI.

- [ ] **Step 3: Implement error presentation**
```tsx
// catch submit error and show:
"Only one unnamed tariff is allowed per provider"
// place at form-level and/or tariff-name field context
```

- [ ] **Step 4: Re-run target tests**
Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffForm.test.tsx
git commit -m "feat(tariffs): surface duplicate unnamed-variant validation in form"
```

---

### Task 5: Full verification and handoff

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run focused tariff tests**
Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/services/chargingPlanService.test.ts`  
Expected: PASS.

- [ ] **Step 2: Run required project checks**
Run: `npm run lint && npm run test -- --run && npm run build`  
Expected: PASS.

- [ ] **Step 3: Prepare handoff notes**
Include:
- changed files,
- verification results,
- risk notes (provider fallback to `Unknown provider`),
- suggested squash or final commit message stream.

- [ ] **Step 4: Optional performance check**
Run: `npm run build:analyze` (only if bundle-impact concern arises from new imports/logic).  
Expected: bundle stats generated without regressions of concern.

## Public API / Interface Notes
- Tariff form contract changes from “required `plan_name`” to “optional `plan_name` (normalized to trimmed string)”.
- Save behavior adds a domain invariant: one unnamed tariff per provider.
- List card identity changes: title is provider name; variant subtitle is optional.

## Assumptions
- `chargingPlanService` is the canonical write path for tariffs.
- No DB schema migration is needed; constraint is app-layer validation.
- Provider fallback text (`Unknown provider`) is acceptable as a defensive fallback even though missing-provider state is not expected.
