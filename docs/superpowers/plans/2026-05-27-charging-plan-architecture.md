# Charging Plan Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Tariffs into an internal ChargingPlan architecture with renamed persistence, composable plan pricing, and v1 ad-hoc session pricing.

**Architecture:** Keep the user-facing Tariffs navigation while moving internal code, storage, sync, and Supabase naming to `ChargingPlan`/`charging_plans`. Charging plans represent reusable commercial relationships; ad-hoc pricing is stored only as a session-owned snapshot.

**Tech Stack:** React 19, TypeScript, Vite, Dexie, Supabase, Vitest, React Testing Library, MSW, fake IndexedDB.

---

## Reference Spec

Read first: `docs/superpowers/specs/2026-05-27-charging-plan-architecture-design.md`

## Task 1: Rename Persistence Model And Sync Surface

**Files:**
- Modify: `src/infra/db/db.ts`
- Modify: `src/features/offline-sync/model/types.ts`
- Modify: `src/features/offline-sync/services/syncEngine.ts`
- Modify: `src/features/offline-sync/hooks/useSyncStatus.ts`
- Modify: `src/features/offline-sync/**/*.test.ts`

- [ ] **Step 1: Write failing sync/model tests**

Update tests so they expect:
- `db.charging_plans` exists and `db.tariffs` does not drive app data.
- `SyncOutbox.table_name` supports `charging_plans` and no longer supports `fixed_tariff_costs`.
- `processOutbox()` uploads plan payloads to Supabase table `charging_plans`.
- `initialSync()` hydrates `providers`, `charging_plans`, and `sessions` only.
- sync status pending counts include `charging_plans` instead of `tariffs`/`fixed_tariff_costs`.

Run:

```bash
npm run test -- --run src/features/offline-sync/services/syncEngine.test.ts src/features/offline-sync/hooks/useSyncStatus.test.ts src/features/offline-sync/components/SyncStatusIndicator.test.tsx
```

Expected: fail on missing `charging_plans` store/table routing and outdated table-count expectations.

- [ ] **Step 2: Implement Dexie and sync model changes**

In `src/infra/db/db.ts`:
- Rename interface `Tariff` to `ChargingPlan`.
- Remove `FixedTariffCost`.
- Add `AdHocPricingSnapshot`.
- Change `ChargingSession` from `tariff_id`, `tariff_name`, and `pricing_context` to `tariff_plan_id`, `charging_plan_name`, and `session_mode`.
- Add nested `ChargingPlan` fields from the spec: `validity`, `prices`, `fees`, optional `affiliation`, optional `notes`.
- Rename table property `tariffs` to `charging_plans`.
- Remove table property `fixed_tariff_costs`.
- Update `SyncPayload` and `SyncOutbox.table_name`.
- Add Dexie version 4 stores for `providers`, `charging_plans`, `sessions`, and `sync_outbox`; because production has no data, make the upgrade clear obsolete local stores instead of preserving tariff/fixed-cost rows.

In offline-sync files:
- Route `charging_plans` outbox items to Supabase `charging_plans`.
- Remove `fixed_tariff_costs` sync and initial hydration.
- Update pending-count defaults and UI labels to `charging_plans`.

- [ ] **Step 3: Verify targeted tests pass**

Run:

```bash
npm run test -- --run src/features/offline-sync/services/syncEngine.test.ts src/features/offline-sync/hooks/useSyncStatus.test.ts src/features/offline-sync/components/SyncStatusIndicator.test.tsx src/infra/db/db.test.ts
```

Expected: all targeted tests pass.

## Task 2: Replace Tariff Feature With Charging Plan Domain

**Files:**
- Move/modify: `src/features/tariffs` to `src/features/charging-plans`
- Modify: `src/app/App.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
- Modify: `src/features/charging-sessions/services/sessionService.ts`
- Modify: related tests under `src/features/tariffs` and `src/features/charging-sessions`

- [ ] **Step 1: Write failing charging-plan service tests**

Create/update service tests to cover:
- `saveChargingPlan()` writes to `db.charging_plans` and queues a `charging_plans` outbox entry.
- validation rejects negative or non-integer money fields.
- validation rejects a plan with no meaningful price or fee.
- validation rejects `fees.other[]` entries without `label`, `amount`, and `notes`.
- `deleteChargingPlan()` soft-deletes a plan and queues a delete payload.

Run:

```bash
npm run test -- --run src/features/charging-plans/services/planService.test.ts
```

Expected: fail because the new feature/service does not exist yet.

- [ ] **Step 2: Implement charging-plan services and hooks**

Create `src/features/charging-plans` from the current tariff feature:
- `services/planService.ts`
- `hooks/useChargingPlans.ts`
- `hooks/useProviders.ts`
- `services/providerService.ts`
- `model/types.ts`
- `index.ts`

Rules:
- Keep provider behavior unchanged.
- Export `useChargingPlans`, `saveChargingPlan`, `getChargingPlans`, and `deleteChargingPlan`.
- Keep UI-facing strings as “Tariff” where the page/labels need EV-familiar wording.
- Remove `fixedTariffCostService` and its exports.

- [ ] **Step 3: Update imports**

Update all imports from `src/features/tariffs` to `src/features/charging-plans`.
Keep `App.tsx` lazy route/page title behavior visible as Tariffs.

- [ ] **Step 4: Verify targeted service tests pass**

Run:

```bash
npm run test -- --run src/features/charging-plans/services/planService.test.ts src/features/tariffs/services/tariffService.test.ts
```

Expected: new charging-plan tests pass; old tariff service test path should be removed or no longer exist.

## Task 3: Implement ChargingPlan And Ad-Hoc Session Pricing

**Files:**
- Modify: `src/features/charging-sessions/services/sessionService.ts`
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`
- Modify: `src/features/charging-sessions/model/types.ts`

- [ ] **Step 1: Write failing session pricing tests**

Cover:
- `session_mode = 'plan'` requires `tariff_plan_id`.
- charging-plan domestic AC/DC resolves from `plan.prices.domestic`.
- charging-plan roaming AC/DC resolves from `plan.prices.roaming`.
- `fees.sessionFixed` is added to plan session totals.
- `session_mode = 'ad_hoc'` requires `ad_hoc_pricing`.
- ad-hoc totals include `pricePerKwh`, optional `pricePerMinute`, optional `pricePerSession`, and `otherFees`.
- ad-hoc sessions do not require a saved charging plan.
- snapshots remain stable on the session record.

Run:

```bash
npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts
```

Expected: fail on old tariff/pricing-context assumptions.

- [ ] **Step 2: Update session preparation**

Change `prepareSession()` to accept:
- input with `session_mode`
- optional `ChargingPlan`
- required `Provider` for plan sessions
- ad-hoc snapshot for ad-hoc sessions

Implementation rules:
- For `plan`, require provider and plan; snapshot provider name, charging plan name, domestic/roaming prices, and plan fees.
- For `ad_hoc`, use `ad_hoc_pricing.cpoName` as the provider display fallback and `Ad-Hoc` as the plan display fallback.
- Persist `total_cost` as integer cents.
- Do not distribute subscription/monthly fees into individual sessions.

- [ ] **Step 3: Verify targeted session tests pass**

Run:

```bash
npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts src/features/charging-sessions/hooks/useSessions.test.ts
```

Expected: all targeted tests pass.

## Task 4: Update Tariffs Page UI For Charging Plans

**Files:**
- Modify/create: `src/features/charging-plans/components/ChargingPlanList.tsx`
- Modify/create: `src/features/charging-plans/components/ChargingPlanForm.tsx`
- Remove: `src/features/tariffs/components/FixedTariffCostForm.tsx`
- Remove: `src/features/tariffs/components/FixedTariffCostList.tsx`
- Modify tests for the plan list/form

- [ ] **Step 1: Write failing UI tests**

Cover:
- Tariffs page does not render “Fixed Tariff Costs”.
- plan cards always show domestic AC/DC pricing first.
- subscription and activation fees render when present.
- roaming pricing renders only when present.
- form renders sections: Identity, Charging Prices, Roaming Prices, Additional Fees, Advanced.
- form can create a valid nested `ChargingPlan` payload.

Run:

```bash
npm run test -- --run src/features/charging-plans/components/ChargingPlanList.test.tsx src/features/charging-plans/components/ChargingPlanForm.test.tsx
```

Expected: fail because renamed components and new form sections do not exist.

- [ ] **Step 2: Implement list and card redesign**

Use existing `Slab`, `ThinInput`, lucide icons, and the current Apple-style visual language.
Ensure all displayed monetary values use tabular numeric styling.
Remove fixed-cost UI entirely.

- [ ] **Step 3: Implement grouped form**

Use grouped sections:
- Identity: Plan Name, Provider, Valid From, Valid To.
- Charging Prices: AC Price, DC Price with strongest visual hierarchy.
- Roaming Prices: Roaming AC, Roaming DC.
- Additional Fees: Subscription, Activation Fee, Session Fee, Card Fee.
- Advanced: affiliation, other fees, notes.

Validation:
- localized decimal strings convert to integer cents.
- other fees require label, amount, and notes.
- valid from is required; valid to is optional.

- [ ] **Step 4: Verify targeted UI tests pass**

Run:

```bash
npm run test -- --run src/features/charging-plans/components/ChargingPlanList.test.tsx src/features/charging-plans/components/ChargingPlanForm.test.tsx src/app/App.auth-gating.test.tsx
```

Expected: all targeted tests pass.

## Task 5: Update Session Form UI For Pricing Source

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
- Modify: `src/features/charging-sessions/components/ChargingHistory.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Cover:
- pricing source selector offers `Charging Plan` and `Ad-Hoc`.
- selecting `Charging Plan` shows provider/plan and domestic/roaming controls.
- selecting `Ad-Hoc` hides plan selector and shows ad-hoc pricing fields.
- ad-hoc submit calls `onSubmit` with `session_mode: 'ad_hoc'` and an `ad_hoc_pricing` snapshot.
- history displays ad-hoc sessions as `Ad-Hoc` with CPO/payment details when present.

Run:

```bash
npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: fail on missing pricing source UI.

- [ ] **Step 2: Implement pricing source UI**

Use `TactileMatrix` or the existing segmented-control style.
Keep zero-typing switch behavior:
- `Charging Plan`: provider, plan, charging type, domestic/roaming context, kWh fields.
- `Ad-Hoc`: CPO/operator, payment method, price per kWh, price per minute, session fee, source of price, notes, other fees.

- [ ] **Step 3: Update history rendering**

For plan sessions, show provider and charging plan name.
For ad-hoc sessions, show `Ad-Hoc` plus CPO/operator when available and display pricing components compactly.

- [ ] **Step 4: Verify targeted UI tests pass**

Run:

```bash
npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx src/features/charging-sessions/components/ChargingHistory.test.tsx
```

Expected: all targeted tests pass.

## Task 6: Update Supabase, Mocks, Seeds, And Docs

**Files:**
- Modify: `supabase/schema.sql`
- Add/modify: `supabase/migrations/2026-05-27-charging-plan-architecture.sql`
- Modify: `supabase/seed.sql`
- Modify: `src/mocks/seed-data.ts`
- Modify: `src/mocks/handlers.ts`
- Modify: `docs/adr/006-tariff-snapshots.md`
- Optionally add ADR: `docs/adr/007-charging-plan-architecture.md`

- [ ] **Step 1: Write or update failing mock/schema-adjacent tests**

Update existing tests that depend on seed/mocked tariff payloads so they expect charging-plan payloads and ad-hoc session snapshots.

Run:

```bash
npm run test -- --run src/test/smoke.test.ts src/features/charging-sessions/components/SessionForm.test.tsx src/features/offline-sync/services/syncEngine.test.ts
```

Expected: fail until mocks/schema-facing expectations are updated.

- [ ] **Step 2: Update Supabase schema and migration**

Use `charging_plans` table with:
- `id`, `user_id`, `provider_id`, `name`
- `validity` data as explicit columns or JSON only if the app model serializes it consistently
- `prices` and `fees` as JSONB if preserving the nested app model directly
- `affiliation` JSONB nullable
- `notes`, timestamps, soft-delete

Update `charging_sessions` to reference `charging_plans` through nullable `tariff_plan_id`; ad-hoc sessions must be valid without a plan id.
Drop `fixed_tariff_costs`.
Keep RLS authenticated single-user policies.

- [ ] **Step 3: Update mocks and docs**

Update mock providers/plans/sessions and MSW handlers.
Update ADR 006 to describe charging-plan snapshots and ad-hoc session snapshots.
Add ADR 007 if the schema choice needs a permanent decision record.

- [ ] **Step 4: Verify targeted tests pass**

Run:

```bash
npm run test -- --run src/test/smoke.test.ts src/features/offline-sync/services/syncEngine.test.ts
```

Expected: all targeted tests pass.

## Task 7: Full Verification And Cleanup

**Files:**
- Check all changed files.

- [ ] **Step 1: Search for obsolete names**

Run:

```bash
rg -n "FixedTariffCost|fixed_tariff_costs|tariff_kind|pricing_context|\\bTariff\\b|tariffs" src supabase docs
```

Expected: remaining `Tariff`/`tariffs` references are only user-facing labels, legacy docs intentionally retained, or comments explicitly explaining user-facing terminology.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm run test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 5: Run bundle analysis**

Run:

```bash
npm run build:analyze
```

Expected: build succeeds and `dist/bundle-stats.json` is generated. Include notable bundle-size deltas or top chunk drivers in handoff notes.

- [ ] **Step 6: Final handoff**

Summarize:
- changed files grouped by domain
- verification commands and results
- risks or follow-ups
- suggested commit message:

```bash
feat(charging-plans): refactor tariffs into charging plan architecture
```
