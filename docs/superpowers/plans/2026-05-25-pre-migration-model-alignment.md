# Pre-Migration Model Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Supabase schema, Dexie model, services, sync, UI, and tests with the new tariff/session/fixed-cost model before the separate Apple Numbers migration session.

**Architecture:** Extend the existing offline-first pipeline instead of introducing parallel data paths. Add the new domain fields and `fixed_tariff_costs` entity end-to-end (types -> Dexie -> services -> outbox/sync -> UI) while preserving idempotent sync and historical snapshot correctness. Keep deletion for fixed costs soft-delete only.

**Tech Stack:** React 19, TypeScript, Dexie, Supabase/PostgreSQL, Vitest, React Testing Library

---

### Task 1: Supabase Schema Migration (Tariffs, Sessions, Fixed Costs)

**Files:**

- Create: `supabase/migrations/2026-05-25-pre-migration-model-alignment.sql`
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Write the migration SQL file**

```sql
-- Tariffs
alter table tariffs
  add column if not exists tariff_kind text not null default 'standard',
  add column if not exists roaming_ac_price_per_kwh integer null,
  add column if not exists roaming_dc_price_per_kwh integer null,
  add column if not exists monthly_base_fee integer null;

alter table tariffs
  alter column ac_price_per_kwh drop not null,
  alter column dc_price_per_kwh drop not null;

-- Sessions
alter table sessions
  add column if not exists pricing_context text not null default 'standard',
  add column if not exists applied_price_per_kwh integer null,
  add column if not exists applied_ac_price_per_kwh integer null,
  add column if not exists applied_dc_price_per_kwh integer null,
  add column if not exists applied_roaming_ac_price_per_kwh integer null,
  add column if not exists applied_roaming_dc_price_per_kwh integer null,
  add column if not exists applied_monthly_base_fee integer null,
  add column if not exists applied_tariff_kind text not null default 'standard';

alter table sessions
  alter column start_soc_percentage drop not null,
  alter column end_soc_percentage drop not null;

-- Fixed costs
create table if not exists fixed_tariff_costs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cost_date timestamptz not null,
  provider_id uuid not null references providers(id),
  provider_name text not null,
  tariff_id uuid null references tariffs(id),
  tariff_name text null,
  amount integer not null,
  cost_type text not null,
  notes text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz null
);
```

- [ ] **Step 2: Add constraints and indexes in the same migration**

```sql
alter table tariffs
  add constraint tariffs_tariff_kind_check
  check (tariff_kind in ('standard', 'subscription', 'ad_hoc'));

alter table tariffs
  add constraint tariffs_non_negative_prices_check
  check (
    (ac_price_per_kwh is null or ac_price_per_kwh >= 0) and
    (dc_price_per_kwh is null or dc_price_per_kwh >= 0) and
    (roaming_ac_price_per_kwh is null or roaming_ac_price_per_kwh >= 0) and
    (roaming_dc_price_per_kwh is null or roaming_dc_price_per_kwh >= 0) and
    session_fee >= 0 and
    (monthly_base_fee is null or monthly_base_fee >= 0)
  );

alter table sessions
  add constraint sessions_pricing_context_check
  check (pricing_context in ('standard', 'roaming', 'ad_hoc'));

alter table sessions
  add constraint sessions_applied_tariff_kind_check
  check (applied_tariff_kind in ('standard', 'subscription', 'ad_hoc'));

alter table sessions
  add constraint sessions_optional_soc_range_check
  check (
    (start_soc_percentage is null or (start_soc_percentage between 0 and 100)) and
    (end_soc_percentage is null or (end_soc_percentage between 0 and 100))
  );

alter table fixed_tariff_costs
  add constraint fixed_tariff_costs_amount_non_negative_check check (amount >= 0),
  add constraint fixed_tariff_costs_cost_type_check
  check (cost_type in ('subscription', 'card_fee', 'activation_fee', 'roaming_fee', 'other'));

create index if not exists fixed_tariff_costs_user_cost_date_idx on fixed_tariff_costs(user_id, cost_date);
create index if not exists fixed_tariff_costs_provider_id_idx on fixed_tariff_costs(provider_id);
create index if not exists fixed_tariff_costs_tariff_id_idx on fixed_tariff_costs(tariff_id);
create index if not exists fixed_tariff_costs_deleted_at_idx on fixed_tariff_costs(deleted_at);
```

- [ ] **Step 3: Add RLS policies for `fixed_tariff_costs`**

```sql
alter table fixed_tariff_costs enable row level security;

create policy "Users can select own fixed tariff costs"
  on fixed_tariff_costs for select using (auth.uid() = user_id);
create policy "Users can insert own fixed tariff costs"
  on fixed_tariff_costs for insert with check (auth.uid() = user_id);
create policy "Users can update own fixed tariff costs"
  on fixed_tariff_costs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own fixed tariff costs"
  on fixed_tariff_costs for delete using (auth.uid() = user_id);
```

- [ ] **Step 4: Update canonical schema snapshot**

Run: `npm run build`
Expected: build succeeds and generated types/schema references stay consistent.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-05-25-pre-migration-model-alignment.sql supabase/schema.sql
git commit -m "feat(db): align tariffs sessions and fixed tariff costs schema"
```

### Task 2: Domain Types + Dexie Schema Upgrade

**Files:**

- Modify: `src/features/tariffs/model/types.ts`
- Modify: `src/features/charging-sessions/model/types.ts`
- Modify: `src/features/offline-sync/model/types.ts`
- Modify: `src/infra/db/db.ts`
- Test: `src/infra/db/db.test.ts`

- [ ] **Step 1: Write failing Dexie/type tests for new fields and outbox table union**

```ts
expectTypeOf<SyncOutboxEntry['table_name']>().toEqualTypeOf<
  'providers' | 'tariffs' | 'sessions' | 'fixed_tariff_costs'
>();

expect(session.start_soc_percentage).toBeUndefined();
expect(session.end_soc_percentage).toBeUndefined();
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `npm run test -- --run src/infra/db/db.test.ts`
Expected: FAIL on missing `fixed_tariff_costs` store or missing new fields.

- [ ] **Step 3: Implement type updates and Dexie version bump/migration**

```ts
this.version(NEXT_VERSION).stores({
  tariffs: 'id, user_id, provider_id, tariff_name, tariff_kind, valid_from, valid_to, deleted_at',
  sessions: 'id, user_id, session_timestamp, provider_id, tariff_id, pricing_context, charging_type, deleted_at',
  fixed_tariff_costs: 'id, user_id, cost_date, provider_id, tariff_id, cost_type, deleted_at',
  syncOutbox: '++id, table_name, action, timestamp, next_attempt_at'
}).upgrade(async (tx) => {
  await tx.table('tariffs').toCollection().modify((t) => { t.tariff_kind ??= 'standard'; });
  await tx.table('sessions').toCollection().modify((s) => {
    s.pricing_context ??= 'standard';
    s.applied_tariff_kind ??= 'standard';
  });
});
```

- [ ] **Step 4: Re-run targeted tests**

Run: `npm run test -- --run src/infra/db/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tariffs/model/types.ts src/features/charging-sessions/model/types.ts src/features/offline-sync/model/types.ts src/infra/db/db.ts src/infra/db/db.test.ts
git commit -m "feat(db): add new tariff session and fixed-cost domain fields"
```

### Task 3: Tariff Service Validation and Behavior

**Files:**

- Modify: `src/features/tariffs/services/tariffService.ts`
- Test: `src/features/tariffs/services/tariffService.test.ts`

- [ ] **Step 1: Add failing tests for optional prices, non-negative rules, and tariff kind**

```ts
it('accepts nullable ac/dc prices and roaming prices', async () => {
  const result = await tariffService.createTariff({
    tariff_kind: 'subscription',
    ac_price_per_kwh: null,
    dc_price_per_kwh: null,
    roaming_ac_price_per_kwh: null,
    roaming_dc_price_per_kwh: null,
    monthly_base_fee: 1199,
    session_fee: 0,
  });
  expect(result.monthly_base_fee).toBe(1199);
});
```

- [ ] **Step 2: Run tariff service tests to verify failure**

Run: `npm run test -- --run src/features/tariffs/services/tariffService.test.ts`
Expected: FAIL on validation mismatch.

- [ ] **Step 3: Implement service validation updates**

```ts
const validKinds = ['standard', 'subscription', 'ad_hoc'] as const;
if (!validKinds.includes(input.tariff_kind)) throw new Error('Invalid tariff kind');

assertNonNegativeNullable(input.ac_price_per_kwh);
assertNonNegativeNullable(input.dc_price_per_kwh);
assertNonNegativeNullable(input.roaming_ac_price_per_kwh);
assertNonNegativeNullable(input.roaming_dc_price_per_kwh);
assertNonNegativeNullable(input.monthly_base_fee);
assertNonNegative(input.session_fee);

const hasMeaningfulPricing = [
  input.ac_price_per_kwh,
  input.dc_price_per_kwh,
  input.roaming_ac_price_per_kwh,
  input.roaming_dc_price_per_kwh,
  input.monthly_base_fee,
  input.session_fee,
].some((v) => v != null && v >= 0);
if (!hasMeaningfulPricing) throw new Error('Tariff requires at least one price or fee');
```

- [ ] **Step 4: Re-run tariff tests**

Run: `npm run test -- --run src/features/tariffs/services/tariffService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tariffs/services/tariffService.ts src/features/tariffs/services/tariffService.test.ts
git commit -m "feat(tariffs): support tariff kinds roaming prices and base fee validation"
```

### Task 4: Session Service Pricing Context + Snapshot Fields

**Files:**

- Modify: `src/features/charging-sessions/services/sessionService.ts`
- Test: `src/features/charging-sessions/services/sessionService.test.ts`

- [ ] **Step 1: Add failing tests for pricing-context resolution and optional SoC**

```ts
it('resolves roaming AC price when pricing_context is roaming', async () => {
  const session = await createSession({ charging_type: 'AC', pricing_context: 'roaming' });
  expect(session.applied_price_per_kwh).toBe(59);
  expect(session.applied_roaming_ac_price_per_kwh).toBe(59);
});

it('throws when roaming price is selected but unavailable', async () => {
  await expect(createSession({ charging_type: 'DC', pricing_context: 'roaming' })).rejects.toThrow(
    'Selected roaming pricing but tariff has no matching roaming price'
  );
});
```

- [ ] **Step 2: Run session service tests to verify failure**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`
Expected: FAIL on missing pricing-context behavior.

- [ ] **Step 3: Implement resolver and snapshot mapping**

```ts
function resolveAppliedPricePerKwh(tariff: Tariff, chargingType: ChargingType, pricingContext: PricingContext): number {
  if (pricingContext === 'roaming') {
    if (chargingType === 'AC' && tariff.roaming_ac_price_per_kwh != null) return tariff.roaming_ac_price_per_kwh;
    if (chargingType === 'DC' && tariff.roaming_dc_price_per_kwh != null) return tariff.roaming_dc_price_per_kwh;
    throw new Error('Selected roaming pricing but tariff has no matching roaming price');
  }

  if (chargingType === 'AC' && tariff.ac_price_per_kwh != null) return tariff.ac_price_per_kwh;
  if (chargingType === 'DC' && tariff.dc_price_per_kwh != null) return tariff.dc_price_per_kwh;
  throw new Error('Tariff has no matching standard/ad-hoc price');
}
```

- [ ] **Step 4: Re-run session service tests**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/charging-sessions/services/sessionService.ts src/features/charging-sessions/services/sessionService.test.ts
git commit -m "feat(sessions): add pricing context resolution and new snapshot fields"
```

### Task 5: FixedTariffCost Service (CRUD + Soft Delete + Outbox)

**Files:**

- Create: `src/features/tariffs/services/fixedTariffCostService.ts`
- Create: `src/features/tariffs/services/fixedTariffCostService.test.ts`
- Modify: `src/features/tariffs/index.ts`

- [ ] **Step 1: Write failing tests for create/update/soft-delete and validation**

```ts
it('creates fixed tariff cost and writes outbox entry', async () => {
  const row = await fixedTariffCostService.createFixedTariffCost(validInput);
  expect(row.deleted_at).toBeUndefined();
  expect(outboxEntry.table_name).toBe('fixed_tariff_costs');
});

it('soft deletes fixed tariff cost', async () => {
  await fixedTariffCostService.softDeleteFixedTariffCost(id);
  expect((await db.fixed_tariff_costs.get(id))?.deleted_at).toBeInstanceOf(Date);
});
```

- [ ] **Step 2: Run new service tests to verify failure**

Run: `npm run test -- --run src/features/tariffs/services/fixedTariffCostService.test.ts`
Expected: FAIL (file/function missing).

- [ ] **Step 3: Implement service**

```ts
export async function softDeleteFixedTariffCost(id: string): Promise<void> {
  await db.transaction('rw', db.fixed_tariff_costs, db.syncOutbox, async () => {
    await db.fixed_tariff_costs.update(id, { deleted_at: new Date(), updated_at: new Date() });
    await enqueueOutbox('fixed_tariff_costs', 'update', id);
  });
}
```

- [ ] **Step 4: Re-run fixed-cost service tests**

Run: `npm run test -- --run src/features/tariffs/services/fixedTariffCostService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tariffs/services/fixedTariffCostService.ts src/features/tariffs/services/fixedTariffCostService.test.ts src/features/tariffs/index.ts
git commit -m "feat(tariffs): add fixed tariff cost service with soft delete"
```

### Task 6: Sync Engine Support for `fixed_tariff_costs`

**Files:**

- Modify: `src/features/offline-sync/services/syncEngine.ts`
- Test: `src/features/offline-sync/services/syncEngine.test.ts`

- [ ] **Step 1: Add failing sync tests for insert/update/soft-delete replay**

```ts
it('replays fixed_tariff_costs insert', async () => {
  await enqueueOutbox('fixed_tariff_costs', 'insert', fixedCost.id);
  await processOutboxOnce();
  expect(mockSupabase.from).toHaveBeenCalledWith('fixed_tariff_costs');
});
```

- [ ] **Step 2: Run sync engine tests to verify failure**

Run: `npm run test -- --run src/features/offline-sync/services/syncEngine.test.ts`
Expected: FAIL on unknown table handling.

- [ ] **Step 3: Implement sync routing and retry parity**

```ts
if (entry.table_name === 'fixed_tariff_costs') {
  return replayFixedTariffCostEntry(entry);
}
```

- [ ] **Step 4: Re-run sync engine tests**

Run: `npm run test -- --run src/features/offline-sync/services/syncEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/offline-sync/services/syncEngine.ts src/features/offline-sync/services/syncEngine.test.ts
git commit -m "feat(sync): replay fixed tariff costs entries"
```

### Task 7: UI Updates (Tariff, Session, Fixed Cost CRUD)

**Files:**

- Modify: `src/features/tariffs/components/TariffForm.tsx`
- Test: `src/features/tariffs/components/TariffForm.test.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
- Test: `src/features/charging-sessions/components/SessionForm.test.tsx`
- Modify: `src/features/charging-sessions/components/ChargingHistory.tsx`
- Create: `src/features/tariffs/components/FixedTariffCostList.tsx`
- Create: `src/features/tariffs/components/FixedTariffCostForm.tsx`
- Create: `src/features/tariffs/components/FixedTariffCostList.test.tsx`

- [ ] **Step 1: Add failing component tests for new fields and optional SoC rendering**

```tsx
expect(screen.getByLabelText(/Pricing Context/i)).toBeInTheDocument();
expect(screen.queryByText('0 %')).not.toBeInTheDocument();
expect(screen.getByLabelText(/Monthly Base Fee/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run component tests to verify failure**

Run: `npm run test -- --run src/features/tariffs/components/TariffForm.test.tsx src/features/charging-sessions/components/SessionForm.test.tsx`
Expected: FAIL on missing inputs/behavior.

- [ ] **Step 3: Implement form updates and fixed-cost CRUD components**

```tsx
<select value={pricingContext} onChange={onPricingContextChange}>
  <option value="standard">Standard</option>
  <option value="roaming">Roaming</option>
  <option value="ad_hoc">Ad-hoc</option>
</select>

<ThinInput
  label="Monthly Base Fee (ct)"
  value={monthlyBaseFee ?? ''}
  onChange={setMonthlyBaseFee}
/>
```

- [ ] **Step 4: Re-run updated component tests**

Run: `npm run test -- --run src/features/tariffs/components/TariffForm.test.tsx src/features/charging-sessions/components/SessionForm.test.tsx src/features/tariffs/components/FixedTariffCostList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tariffs/components/TariffForm.tsx src/features/tariffs/components/TariffForm.test.tsx src/features/charging-sessions/components/SessionForm.tsx src/features/charging-sessions/components/SessionForm.test.tsx src/features/charging-sessions/components/ChargingHistory.tsx src/features/tariffs/components/FixedTariffCostList.tsx src/features/tariffs/components/FixedTariffCostForm.tsx src/features/tariffs/components/FixedTariffCostList.test.tsx
git commit -m "feat(ui): support new pricing model and fixed tariff cost CRUD"
```

### Task 8: Full Verification and Handoff Notes

**Files:**

- Modify: `README.md` (if user-facing model changes are documented there)
- Modify: `IMPLEMENTATION_PLAN.md` (if project requires mirrored status notes)

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Run full test suite once**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: (Performance-sensitive check) run bundle analyze for notable deltas**

Run: `npm run build:analyze`
Expected: PASS and `dist/bundle-stats.json` generated.

- [ ] **Step 5: Final commit for docs/handoff (only if files changed)**

```bash
git add README.md IMPLEMENTATION_PLAN.md
git commit -m "docs: update pre-migration model alignment notes"
```

## Spec Coverage Check

- Supabase tariff/session/fixed-cost schema: covered in Task 1.
- TypeScript + Dexie alignment and defaults: covered in Task 2.
- Tariff validation and optional pricing: covered in Task 3.
- Session context pricing + snapshots + optional SoC: covered in Task 4.
- Fixed cost local CRUD + soft delete + outbox: covered in Task 5.
- Sync replay support with retries: covered in Task 6.
- Minimum UI including fixed cost Create/Edit/Delete: covered in Task 7.
- Required verification commands from AGENTS.md: covered in Task 8.
- Explicit non-goal (no Apple Numbers import): preserved in plan scope.

## Placeholder Scan

- No TBD/TODO placeholders remain.
- All implementation steps include concrete file paths, code snippets, and exact commands.

## Type Consistency Check

- Uses only new snapshot fields (`applied_*_per_kwh`) consistently.
- `pricing_context` and `applied_tariff_kind` values are consistent across schema/types/services.
- `fixed_tariff_costs` soft delete behavior is consistent across service/sync/UI tasks.
