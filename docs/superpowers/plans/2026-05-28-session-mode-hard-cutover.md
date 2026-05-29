# Session Mode Hard Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy session pricing fields with strict `sessionMode` invariants, introduce immutable `ProviderPlanSelection` history rows with unique IDs and snapshots, and require `planSelectionId` for plan-mode sessions.

**Architecture:** Perform a single hard cutover across domain types, services, form validation, Dexie schema, Supabase schema, and sync payloads because production has no data. Keep `TariffPlan` as reusable catalog data while `ProviderPlanSelection` becomes the temporal contract-history record referenced by sessions.

**Tech Stack:** React 19, TypeScript, Dexie, Supabase, Vitest, React Testing Library, MSW.

---

### Task 1: Add failing domain/service tests for session-mode invariants and selection linkage

**Files:**
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`

- [ ] **Step 1: Add failing test for plan mode requiring `planSelectionId`**

```ts
it('requires planSelectionId for plan mode sessions', () => {
  const input = {
    user_id: 'u1',
    session_timestamp: new Date('2026-05-28T00:00:00Z'),
    provider_id: 'p1',
    tariff_plan_id: 'tp1',
    session_mode: 'plan' as const,
    pricing_context: 'standard' as const,
    charging_type: 'AC' as const,
    kwh_billed: 10,
  };

  expect(() => prepareSession(input as never, mockPlan, mockProvider)).toThrow(
    'plan_selection_id is required for plan mode'
  );
});
```

- [ ] **Step 2: Add failing test for ad-hoc mode forbidding plan linkage**

```ts
it('forbids tariffPlanId and planSelectionId for ad_hoc mode', () => {
  const input = {
    user_id: 'u1',
    session_timestamp: new Date('2026-05-28T00:00:00Z'),
    provider_id: 'p1',
    session_mode: 'ad_hoc' as const,
    tariff_plan_id: 'tp1',
    plan_selection_id: 'ps1',
    charging_type: 'AC' as const,
    kwh_billed: 10,
    price_snapshot: { label: 'Ad-Hoc', kWhPrice: 59 },
  };

  expect(() => prepareSession(input as never)).toThrow(
    'tariff_plan_id and plan_selection_id are forbidden for ad_hoc mode'
  );
});
```

- [ ] **Step 3: Run targeted service tests to confirm red state**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`
Expected: FAIL on new invariant tests before implementation.

- [ ] **Step 4: Commit test additions**

```bash
git add src/features/charging-sessions/services/sessionService.test.ts
git commit -m "test(sessions): define sessionMode and planSelection invariants"
```

### Task 2: Add failing tests for provider-plan selection history behavior

**Files:**
- Create: `src/features/charging-plans/services/providerPlanSelectionService.test.ts`
- Modify: `src/infra/db/db.test.ts`

- [ ] **Step 1: Create tests for history rows with unique IDs and snapshots**

```ts
it('creates a new selection row with unique id when switching plans', async () => {
  await setActivePlanSelection({ providerId: 'p1', tariffPlanId: 't-l', validFrom: new Date('2026-01-01'), priceSnapshot: lSnapshot });
  await setActivePlanSelection({ providerId: 'p1', tariffPlanId: 't-m', validFrom: new Date('2026-05-28'), priceSnapshot: mSnapshot });

  const rows = await getProviderPlanSelections('p1');
  expect(rows).toHaveLength(2);
  expect(rows[0].id).not.toBe(rows[1].id);
  expect(rows[0].validTo).toEqual(new Date('2026-05-28'));
  expect(rows[1].validTo).toBeNull();
});
```

- [ ] **Step 2: Add test for returning to same tariff creating a new row**

```ts
it('creates a third row when switching back to a prior tariff plan', async () => {
  await setActivePlanSelection({ providerId: 'p1', tariffPlanId: 't-l', validFrom: new Date('2026-01-01'), priceSnapshot: lOld });
  await setActivePlanSelection({ providerId: 'p1', tariffPlanId: 't-m', validFrom: new Date('2026-05-28'), priceSnapshot: mSnapshot });
  await setActivePlanSelection({ providerId: 'p1', tariffPlanId: 't-l', validFrom: new Date('2026-08-10'), priceSnapshot: lNew });

  const rows = await getProviderPlanSelections('p1');
  expect(rows).toHaveLength(3);
  expect(rows[2].tariffPlanId).toBe('t-l');
  expect(rows[2].priceSnapshot).toEqual(lNew);
});
```

- [ ] **Step 3: Add DB schema test expecting `provider_plan_selections` table presence**

```ts
it('exposes provider_plan_selections table in current schema', () => {
  expect(db.provider_plan_selections).toBeDefined();
});
```

- [ ] **Step 4: Run targeted tests to confirm red state**

Run:
- `npm run test -- --run src/features/charging-plans/services/providerPlanSelectionService.test.ts`
- `npm run test -- --run src/infra/db/db.test.ts`
Expected: FAIL until table/service implementation exists.

- [ ] **Step 5: Commit failing tests**

```bash
git add src/features/charging-plans/services/providerPlanSelectionService.test.ts src/infra/db/db.test.ts
git commit -m "test(charging-plans): define provider plan selection history behavior"
```

### Task 3: Implement domain model cutover types and mappings

**Files:**
- Modify: `src/infra/db/db.ts`
- Modify: `src/features/charging-sessions/model/types.ts`
- Modify: `src/features/charging-plans/model/types.ts`

- [ ] **Step 1: Introduce canonical types and fields**

```ts
export type SessionMode = 'plan' | 'ad_hoc';

export interface TariffPriceSnapshot {
  label: string;
  kWhPrice: number;
  sessionFee?: number;
  blockingFee?: number;
}

export interface ProviderPlanSelection {
  id: string;
  user_id: string;
  provider_id: string;
  tariff_plan_id: string;
  valid_from: Date;
  valid_to?: Date | null;
  price_snapshot: TariffPriceSnapshot;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}
```

- [ ] **Step 2: Update `ChargingSession` type fields to cutover names**

```ts
session_mode: SessionMode;
tariff_plan_id?: string | null;
plan_selection_id?: string | null;
price_snapshot: TariffPriceSnapshot;
```

- [ ] **Step 3: Remove deprecated aliases from type-level APIs**

```ts
// remove legacy session_mode / tariff_plan_id compatibility fields from domain-facing types
```

- [ ] **Step 4: Run typecheck-oriented validation**

Run: `npm run build`
Expected: FAIL may remain until dependent files are updated; ensure failures are in expected downstream callsites.

### Task 4: Implement Dexie schema hard cutover

**Files:**
- Modify: `src/infra/db/db.ts`
- Modify: `src/infra/db/db.test.ts`

- [ ] **Step 1: Bump Dexie version and define new table/index shapes**

```ts
this.version(5).stores({
  providers: 'id, user_id, name, deleted_at',
  charging_plans: 'id, user_id, provider_id, plan_name, deleted_at',
  provider_plan_selections: 'id, user_id, provider_id, tariff_plan_id, valid_from, valid_to, deleted_at',
  sessions: 'id, user_id, session_timestamp, provider_id, session_mode, tariff_plan_id, plan_selection_id, charging_type, deleted_at',
  sync_outbox: '++id, table_name, record_id, action, created_at, synced'
});
```

- [ ] **Step 2: Extend DB class properties**

```ts
provider_plan_selections!: Table<ProviderPlanSelection>;
```

- [ ] **Step 3: Update DB tests for schema presence and table-name unions**

```ts
type TableName = 'providers' | 'charging_plans' | 'provider_plan_selections' | 'sessions';
```

- [ ] **Step 4: Run DB test suite**

Run: `npm run test -- --run src/infra/db/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit DB cutover changes**

```bash
git add src/infra/db/db.ts src/infra/db/db.test.ts
git commit -m "feat(db): add provider plan selection table and session mode fields"
```

### Task 5: Implement provider-plan selection service

**Files:**
- Create: `src/features/charging-plans/services/providerPlanSelectionService.ts`
- Create: `src/features/charging-plans/services/providerPlanSelectionService.test.ts`
- Modify: `src/features/charging-plans/index.ts`

- [ ] **Step 1: Implement `setActivePlanSelection` with close-and-open behavior**

```ts
export async function setActivePlanSelection(input: SetActivePlanSelectionInput): Promise<ProviderPlanSelection> {
  return db.transaction('rw', db.provider_plan_selections, db.sync_outbox, async () => {
    const current = await db.provider_plan_selections
      .where({ provider_id: input.providerId })
      .filter(row => !row.deleted_at && row.valid_to == null)
      .first();

    if (current) {
      await db.provider_plan_selections.update(current.id, { valid_to: input.validFrom, updated_at: new Date() });
      await db.sync_outbox.add({ table_name: 'provider_plan_selections', record_id: current.id, action: 'update', created_at: new Date(), synced: 0 });
    }

    const next: ProviderPlanSelection = {
      id: crypto.randomUUID(),
      user_id: input.userId,
      provider_id: input.providerId,
      tariff_plan_id: input.tariffPlanId,
      valid_from: input.validFrom,
      valid_to: null,
      price_snapshot: structuredClone(input.priceSnapshot),
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.provider_plan_selections.add(next);
    await db.sync_outbox.add({ table_name: 'provider_plan_selections', record_id: next.id, action: 'create', created_at: new Date(), synced: 0 });

    return next;
  });
}
```

- [ ] **Step 2: Implement query helper by provider/date**

```ts
export async function getActivePlanSelectionAt(providerId: string, at: Date): Promise<ProviderPlanSelection | null> {
  const rows = await db.provider_plan_selections
    .where('provider_id')
    .equals(providerId)
    .filter(row => !row.deleted_at && row.valid_from <= at && (row.valid_to == null || row.valid_to > at))
    .toArray();

  return rows[0] ?? null;
}
```

- [ ] **Step 3: Export service from feature public API**

```ts
export * from './services/providerPlanSelectionService';
```

- [ ] **Step 4: Run targeted service tests**

Run: `npm run test -- --run src/features/charging-plans/services/providerPlanSelectionService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit service layer changes**

```bash
git add src/features/charging-plans/services/providerPlanSelectionService.ts src/features/charging-plans/services/providerPlanSelectionService.test.ts src/features/charging-plans/index.ts
git commit -m "feat(charging-plans): track active plan history with immutable selection rows"
```

### Task 6: Update session preparation and validation logic to new invariants

**Files:**
- Modify: `src/features/charging-sessions/services/sessionService.ts`
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`

- [ ] **Step 1: Replace legacy branches with `session_mode` branches**

```ts
if (input.session_mode === 'plan') {
  if (!input.tariff_plan_id) throw new Error('tariff_plan_id is required for plan mode');
  if (!input.plan_selection_id) throw new Error('plan_selection_id is required for plan mode');
  if (input.ad_hoc_pricing) throw new Error('ad_hoc_pricing is forbidden for plan mode');

  // derive and persist price_snapshot from selected plan + context
}

if (input.session_mode === 'ad_hoc') {
  if (input.tariff_plan_id || input.plan_selection_id) {
    throw new Error('tariff_plan_id and plan_selection_id are forbidden for ad_hoc mode');
  }
  if (!input.price_snapshot) throw new Error('price_snapshot is required for ad_hoc mode');
}
```

- [ ] **Step 2: Ensure returned session always contains `price_snapshot`**

```ts
return {
  ...,
  session_mode: input.session_mode,
  tariff_plan_id: input.session_mode === 'plan' ? input.tariff_plan_id : null,
  plan_selection_id: input.session_mode === 'plan' ? input.plan_selection_id : null,
  price_snapshot,
};
```

- [ ] **Step 3: Update tests to assert new error messages and fields**

```ts
expect(session.plan_selection_id).toBe('ps1');
expect(session.session_mode).toBe('plan');
expect(session.price_snapshot.label).toBe('EnBW L');
```

- [ ] **Step 4: Run targeted session service tests**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit session service cutover**

```bash
git add src/features/charging-sessions/services/sessionService.ts src/features/charging-sessions/services/sessionService.test.ts
git commit -m "feat(sessions): enforce session mode invariants and plan selection linkage"
```

### Task 7: Update session form to produce canonical payload

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`

- [ ] **Step 1: Rename form state fields and enforce mode-aware constraints**

```ts
session_mode: z.enum(['plan', 'ad_hoc']),
tariff_plan_id: z.string().optional(),
plan_selection_id: z.string().optional(),
```

- [ ] **Step 2: Keep plan selector hidden/cleared in ad_hoc mode and required in plan mode**

```ts
if (values.session_mode === 'ad_hoc') {
  setValue('tariff_plan_id', '');
  setValue('plan_selection_id', '');
}
```

- [ ] **Step 3: Resolve or create `planSelectionId` before submit for plan mode**

```ts
const activeSelection = await getActivePlanSelectionAt(values.provider_id, parseDateInputAsUtc(values.session_timestamp));
if (!activeSelection || activeSelection.tariff_plan_id !== values.tariff_plan_id) {
  const created = await setActivePlanSelection({
    userId: user.id,
    providerId: values.provider_id,
    tariffPlanId: values.tariff_plan_id,
    validFrom: parseDateInputAsUtc(values.session_timestamp),
    priceSnapshot: deriveTariffPriceSnapshot(chosenPlan, provider, values.pricing_mode),
  });
  planSelectionId = created.id;
} else {
  planSelectionId = activeSelection.id;
}
```

- [ ] **Step 4: Update component tests for canonical fields and validation**

```ts
expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
  session_mode: 'plan',
  tariff_plan_id: 't1',
  plan_selection_id: expect.any(String),
}));
```

- [ ] **Step 5: Run targeted form tests**

Run: `npm run test -- --run src/features/charging-sessions/components/SessionForm.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit form cutover**

```bash
git add src/features/charging-sessions/components/SessionForm.tsx src/features/charging-sessions/components/SessionForm.test.tsx
git commit -m "feat(session-form): emit planSelectionId and sessionMode payload"
```

### Task 8: Update sync engine/table unions and mocks for new table and session fields

**Files:**
- Modify: `src/features/offline-sync/...` (exact sync files discovered during implementation)
- Modify: `src/mocks/seed-data.ts`
- Modify: `src/mocks/handlers.ts`

- [ ] **Step 1: Add `provider_plan_selections` to sync table unions and mappings**

```ts
type SyncTable = 'providers' | 'charging_plans' | 'provider_plan_selections' | 'sessions';
```

- [ ] **Step 2: Align mock seed data with cutover session fields**

```ts
session_mode: 'plan',
tariff_plan_id: 'tp1',
plan_selection_id: 'ps1',
price_snapshot: { label: 'EnBW L', kWhPrice: 59 }
```

- [ ] **Step 3: Ensure handlers expose `provider_plan_selections` endpoint behavior**

```ts
http.get(`${SUPABASE_URL}/rest/v1/provider_plan_selections`, ...)
```

- [ ] **Step 4: Run sync and mock-related tests**

Run: `npm run test -- --run`
Expected: targeted sync/mock assertions PASS.

- [ ] **Step 5: Commit sync/mock cutover**

```bash
git add src/features/offline-sync src/mocks/seed-data.ts src/mocks/handlers.ts
git commit -m "feat(sync): add provider plan selection sync and session mode payloads"
```

### Task 9: Add Supabase migration for hard cutover schema

**Files:**
- Create: `supabase/migrations/2026-05-28-session-mode-hard-cutover.sql`

- [ ] **Step 1: Create table and constraints for `provider_plan_selections`**

```sql
create table if not exists public.provider_plan_selections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  tariff_plan_id uuid not null references public.charging_plans(id),
  valid_from timestamptz not null,
  valid_to timestamptz null,
  price_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
```

- [ ] **Step 2: Alter `charging_sessions` for canonical fields/checks**

```sql
alter table public.charging_sessions
  add column if not exists session_mode text not null default 'plan',
  add column if not exists tariff_plan_id uuid null references public.charging_plans(id),
  add column if not exists plan_selection_id uuid null references public.provider_plan_selections(id),
  add column if not exists price_snapshot jsonb not null default '{}'::jsonb;

alter table public.charging_sessions
  add constraint charging_sessions_session_mode_check
    check (session_mode in ('plan', 'ad_hoc'));

alter table public.charging_sessions
  add constraint charging_sessions_plan_mode_requirements
    check (
      (session_mode = 'plan' and tariff_plan_id is not null and plan_selection_id is not null)
      or
      (session_mode = 'ad_hoc' and tariff_plan_id is null and plan_selection_id is null)
    );
```

- [ ] **Step 3: Add RLS policies for new table mirroring private-single-user posture**

```sql
alter table public.provider_plan_selections enable row level security;
-- add authenticated user_id policies matching existing table pattern
```

- [ ] **Step 4: Commit migration**

```bash
git add supabase/migrations/2026-05-28-session-mode-hard-cutover.sql
git commit -m "feat(supabase): hard cutover schema for session mode and plan selection history"
```

### Task 10: Run full verification and produce handoff

**Files:**
- No new files expected unless fixes are needed.

- [ ] **Step 1: Run repository quality gates**

Run: `npm run lint && npm run test -- --run && npm run build && npm run build:analyze`
Expected: PASS.

- [ ] **Step 2: Manual sanity verification in app**

Run: `npm run dev`
Checklist:
- Plan mode enforces provider+plan.
- Ad-hoc mode forbids plan linkage and requires snapshot.
- Switching L -> M -> L creates three distinct `ProviderPlanSelection` rows.
- Session detail reflects stored snapshot label.

- [ ] **Step 3: Final handoff summary**

Include:
- changed files grouped by domain,
- verification output summary,
- explicit note of breaking schema cutover assumptions (no production data),
- residual risks (naming drift, selection overlap guards, snapshot mismatch risk),
- suggested final commit message for squash if desired.
