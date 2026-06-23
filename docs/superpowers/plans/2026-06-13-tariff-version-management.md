# Tariff Version Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build logical tariff version management so users can schedule permanent price changes and temporary promotions while sessions automatically use the tariff version effective on the session date.

**Architecture:** Persist each effective period as a `charging_plans` row, while deriving logical tariffs from provider plus normalized tariff name. Multi-row mutations validate the complete requested timeline before writing and then update plans plus outbox entries in one Dexie transaction. The UI selects logical tariffs, but persisted sessions and provider-plan selections continue to store the effective raw `ChargingPlan.id`.

**Tech Stack:** React 19, TypeScript, React Hook Form, Zod, Dexie, dexie-react-hooks, Vitest, React Testing Library, fake IndexedDB, Vite

---

## Required Invariants

1. Validity periods use half-open UTC date ranges: `valid_from <= date < valid_to`.
2. User-facing end dates are inclusive; persistence stores the following UTC day as `valid_to`.
3. A logical tariff has at most one effective version on any date.
4. Permanent changes and promotions never create gaps or overlaps in a previously continuous history.
5. A logical-tariff mutation writes all affected plans and outbox entries atomically or writes nothing.
6. Existing session edits preserve their saved raw plan ID and price snapshot unless provider, logical tariff, date, or charging rate deliberately changes.
7. New and deliberately repriced sessions persist the raw version effective on the chosen session date.
8. Logical deletion soft-deletes every version in one transaction and never changes historical session snapshots.

## File Map

- Create: `src/features/charging-plans/model/logicalTariffs.ts`
  - Normalize identity, resolve effective versions, classify promotion chains, and build overview/history models.
- Create: `src/features/charging-plans/model/logicalTariffs.test.ts`
  - Cover grouping, effective boundaries, promotion/restoration labels, and gaps.
- Create: `src/features/charging-plans/hooks/useUtcToday.ts`
  - Provide a UTC calendar-day value that updates after UTC midnight.
- Create: `src/features/charging-plans/hooks/useUtcToday.test.ts`
  - Verify midnight rollover with fake timers.
- Modify: `src/features/charging-plans/services/planService.ts`
  - Add exported input types and atomic logical-tariff mutations.
- Modify: `src/features/charging-plans/services/chargingPlanService.test.ts`
  - Cover successful scheduling, conflicts, rollback/outbox behavior, identity edits, and logical deletion.
- Modify: `src/features/charging-plans/hooks/useChargingPlans.ts`
  - Expose fresh logical-tariff state and mutation operations.
- Modify: `src/features/charging-plans/index.ts`
  - Export model and service types required across feature boundaries.
- Modify: `src/features/charging-plans/components/TariffList.tsx`
  - Render logical cards and manage edit, schedule, promotion, history, and deletion surfaces.
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
  - Cover grouped cards and complete action workflows.
- Create: `src/features/charging-plans/components/TariffVersionActionMenu.tsx`
- Create: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`
- Create: `src/features/charging-plans/components/PermanentPriceChangeForm.tsx`
- Create: `src/features/charging-plans/components/PermanentPriceChangeForm.test.tsx`
- Create: `src/features/charging-plans/components/TemporaryPromotionForm.tsx`
- Create: `src/features/charging-plans/components/TemporaryPromotionForm.test.tsx`
- Create: `src/features/charging-plans/components/TariffVersionHistorySheet.tsx`
- Create: `src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx`
- Create: `src/features/charging-plans/components/DeleteLogicalTariffDialog.tsx`
- Create: `src/features/charging-plans/components/DeleteLogicalTariffDialog.test.tsx`
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
  - Add a type-safe descriptive-details mode.
- Modify: `src/features/charging-plans/components/TariffForm.test.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
  - Keep logical selection separate from persisted raw plan IDs.
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`
  - Cover date resolution, hydration, retired plans, and unchanged edits.
- Modify: `src/features/charging-sessions/services/sessionService.ts`
  - Reuse the shared effective-version resolver.
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`

## Task 1: Logical Tariff Domain Model

**Files:**
- Create: `src/features/charging-plans/model/logicalTariffs.ts`
- Create: `src/features/charging-plans/model/logicalTariffs.test.ts`

- [ ] **Step 1: Write failing model tests**

Create fixtures and tests for these exact cases:

```ts
/**
 * Test suite for logical tariff grouping and date-derived version roles.
 *
 * Verifies normalized identity, half-open validity, promotion restoration,
 * history labels, and missing-version gaps.
 */
describe('logicalTariffs', () => {
  it('groups provider plus normalized name and resolves the effective boundary', () => {
    const versions = [
      buildPlan({ id: 'base', name: ' Lidl ', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'next', name: 'lidl', valid_from: utc('2026-08-15'), valid_to: null }),
    ]

    expect(getLogicalTariffKey(versions[0])).toBe('provider-1::lidl')
    expect(resolveEffectivePlanForDate(versions, utc('2026-08-14'))?.id).toBe('base')
    expect(resolveEffectivePlanForDate(versions, utc('2026-08-15'))?.id).toBe('next')
    expect(buildLogicalTariffs(versions, utc('2026-08-15'))).toHaveLength(1)
  })

  it('classifies promotion and restoration independently of current date', () => {
    const versions = buildPromotionChain()
    const [logical] = buildLogicalTariffs(versions, utc('2026-08-20'))

    expect(logical.badge).toEqual({
      kind: 'promo',
      date: '2026-08-31',
      label: 'Promo until 31 Aug',
    })
    expect(logical.history.find((row) => row.plan.id === 'promo')?.labels).toEqual(['Promotion', 'Current'])
    expect(logical.history.find((row) => row.plan.id === 'restore')?.labels).toEqual(['Restored', 'Scheduled'])
  })

  it('labels an active restored version as restored and current', () => {
    const [logical] = buildLogicalTariffs(buildPromotionChain(), utc('2026-09-02'))

    expect(logical.history.find((row) => row.plan.id === 'restore')?.labels).toEqual(['Restored', 'Current'])
  })

  it('returns no effective version for a gap', () => {
    const versions = [
      buildPlan({ id: 'early', valid_from: utc('2026-01-01'), valid_to: utc('2026-03-01') }),
      buildPlan({ id: 'late', valid_from: utc('2026-05-01'), valid_to: null }),
    ]

    expect(resolveEffectivePlanForDate(versions, utc('2026-04-01'))).toBeNull()
  })

  it('keeps an unnamed tariff as a valid provider-scoped identity', () => {
    const versions = [
      buildPlan({ id: 'unnamed', provider_id: 'provider-1', name: '   ' }),
    ]

    expect(getLogicalTariffKey(versions[0])).toBe('provider-1::')
    expect(buildLogicalTariffs(versions, utc('2026-06-13'))[0].name).toBe('')
  })
})
```

Use `utc(date: string) => new Date(`${date}T00:00:00.000Z`)` and a complete `ChargingPlan` fixture. Include Arrange, Act, Assert comments in every test.

- [ ] **Step 2: Run the model test and verify failure**

Run: `npm run test -- --run src/features/charging-plans/model/logicalTariffs.test.ts`

Expected: FAIL because `logicalTariffs.ts` does not exist.

- [ ] **Step 3: Implement the model**

Create these exported contracts:

```ts
export type LogicalTariffHistoryLabel =
  | 'Current'
  | 'Scheduled'
  | 'Promotion'
  | 'Past'
  | 'Restored'

export interface LogicalTariffBadge {
  kind: 'promo' | 'upcoming_change'
  date: string
  label: string
}

export interface LogicalTariffHistoryRow {
  plan: ChargingPlan
  labels: LogicalTariffHistoryLabel[]
  startDate: string
  endDateInclusive: string | null
}

export interface LogicalTariff {
  key: string
  providerId: string
  name: string
  versions: ChargingPlan[]
  currentVersion: ChargingPlan | null
  nextVersion: ChargingPlan | null
  badge?: LogicalTariffBadge
  history: LogicalTariffHistoryRow[]
}
```

Implement and export:

```ts
export function normalizeTariffName(name: string): string
export function getLogicalTariffKey(
  plan: Pick<ChargingPlan, 'provider_id' | 'name'>
): string
export function addUtcDays(date: Date, days: number): Date
export function formatUtcDate(date: Date): string
export function parseUtcDateInput(value: string): Date
export function resolveEffectivePlanForDate(
  versions: ChargingPlan[],
  at: Date
): ChargingPlan | null
export function buildLogicalTariffs(
  plans: ChargingPlan[],
  today: Date
): LogicalTariff[]
```

Use these algorithms:

```ts
export function resolveEffectivePlanForDate(
  versions: ChargingPlan[],
  at: Date
): ChargingPlan | null {
  return versions
    .filter((plan) => !plan.deleted_at)
    .sort((left, right) => left.valid_from.getTime() - right.valid_from.getTime())
    .find((plan) => (
      plan.valid_from.getTime() <= at.getTime()
      && (plan.valid_to == null || at.getTime() < plan.valid_to.getTime())
    )) ?? null
}

function isPromotionAt(sorted: ChargingPlan[], index: number): boolean {
  const previous = sorted[index - 1]
  const candidate = sorted[index]
  const restore = sorted[index + 1]
  return Boolean(
    previous
    && candidate?.valid_to
    && restore
    && restore.valid_from.getTime() === candidate.valid_to.getTime()
    && hasSamePriceStructure(previous, restore)
  )
}
```

Build a `Set<number>` of promotion indexes and restoration indexes before creating history rows. History labels are role first (`Promotion` or `Restored`) followed by temporal state (`Current`, `Scheduled`, or `Past`). Derive the promo badge only when the current version index is a promotion index. Otherwise derive the nearest future version badge. Sort logical tariffs by provider ID and normalized name for deterministic rendering.

- [ ] **Step 4: Run the model test**

Run: `npm run test -- --run src/features/charging-plans/model/logicalTariffs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the domain model**

```bash
git add src/features/charging-plans/model/logicalTariffs.ts src/features/charging-plans/model/logicalTariffs.test.ts
git commit -m "feat(tariffs): derive logical tariff histories"
```

## Task 2: Atomic Version Management Services

**Files:**
- Modify: `src/features/charging-plans/services/planService.ts`
- Modify: `src/features/charging-plans/services/chargingPlanService.test.ts`

- [ ] **Step 1: Write failing success-path tests**

Add tests for:

```ts
it('schedules a permanent successor and queues two atomic outbox mutations', async () => {
  await seedOpenBaseline()

  await schedulePermanentTariffVersion({
    userId: 'user-1',
    providerId: 'provider-1',
    name: 'Lidl',
    effectiveFrom: utc('2026-08-15'),
    prices: buildPrices({ ac_price_per_kwh: 35 }),
  })

  const rows = await sortedLogicalRows()
  expect(rows.map(({ id, valid_from, valid_to }) => ({ id, valid_from, valid_to }))).toEqual([
    { id: 'baseline', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') },
    { id: expect.any(String), valid_from: utc('2026-08-15'), valid_to: null },
  ])
  expect(await db.sync_outbox.count()).toBe(2)
  expect(await db.sync_outbox.toArray()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined,
    }),
  ]))
})

it('creates one bounded promotion and one restored successor', async () => {
  await seedOpenBaseline()

  await scheduleTemporaryPromotion({
    userId: 'user-1',
    providerId: 'provider-1',
    name: 'Lidl',
    promoStart: utc('2026-08-10'),
    promoEndInclusive: utc('2026-08-31'),
    prices: buildPrices({ ac_price_per_kwh: 24 }),
  })

  const rows = await sortedLogicalRows()
  expect(rows).toHaveLength(3)
  expect(rows[0].valid_to).toEqual(utc('2026-08-10'))
  expect(rows[1]).toEqual(expect.objectContaining({
    valid_from: utc('2026-08-10'),
    valid_to: utc('2026-09-01'),
    ac_price_per_kwh: 24,
  }))
  expect(rows[2]).toEqual(expect.objectContaining({
    valid_from: utc('2026-09-01'),
    valid_to: null,
    ac_price_per_kwh: 29,
  }))
  expect(await db.sync_outbox.count()).toBe(3)
})
```

Also test that `getEffectiveChargingPlanAt(...)` resolves both sides of a boundary.

- [ ] **Step 2: Write failing conflict and rollback tests**

Add these cases:

```ts
it('rejects a permanent change before an existing scheduled version without writing', async () => {
  await seedBaselineAndScheduledSuccessor(utc('2026-09-01'))
  const plansBefore = await db.charging_plans.toArray()
  await db.sync_outbox.clear()

  await expect(schedulePermanentTariffVersion({
    userId: 'user-1',
    providerId: 'provider-1',
    name: 'Lidl',
    effectiveFrom: utc('2026-08-15'),
    prices: buildPrices({ ac_price_per_kwh: 35 }),
  })).rejects.toThrow('scheduled change on 2026-09-01')

  expect(await db.charging_plans.toArray()).toEqual(plansBefore)
  expect(await db.sync_outbox.count()).toBe(0)
})

it('rejects a promotion crossed by a scheduled version without writing', async () => {
  await seedBaselineAndScheduledSuccessor(utc('2026-08-20'))
  const plansBefore = await db.charging_plans.toArray()
  await db.sync_outbox.clear()

  await expect(scheduleTemporaryPromotion({
    userId: 'user-1',
    providerId: 'provider-1',
    name: 'Lidl',
    promoStart: utc('2026-08-10'),
    promoEndInclusive: utc('2026-08-31'),
    prices: buildPrices({ ac_price_per_kwh: 24 }),
  })).rejects.toThrow('scheduled change on 2026-08-20')

  expect(await db.charging_plans.toArray()).toEqual(plansBefore)
  expect(await db.sync_outbox.count()).toBe(0)
})
```

Add validation tests for:
- permanent `effectiveFrom` equal to the baseline first day,
- promotion end before start,
- promotion start equal to the baseline first day, which cannot retain a preceding baseline required for derived promotion classification,
- invalid/non-integer money,
- missing baseline.

- [ ] **Step 3: Write failing identity-edit and logical-delete tests**

Verify that:
- provider/name/affiliation/notes update every version,
- changing identity to one that overlaps an existing logical tariff is rejected with no writes,
- deleting a logical tariff soft-deletes all versions,
- one `DELETE` outbox entry is queued per version,
- unrelated tariffs and all sessions remain unchanged.

- [ ] **Step 4: Run service tests and verify failure**

Run: `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`

Expected: FAIL because the logical service exports do not exist.

- [ ] **Step 5: Add exported service contracts**

Add these exported interfaces:

```ts
export interface LogicalTariffIdentityInput {
  userId: string
  providerId: string
  name: string
}

export interface TariffPriceInput {
  ac_price_per_kwh?: number
  dc_price_per_kwh?: number
  roaming_ac_price_per_kwh?: number
  roaming_dc_price_per_kwh?: number
  monthly_base_fee: number
  session_fee: number
}

export interface SchedulePermanentTariffVersionInput
  extends LogicalTariffIdentityInput {
  effectiveFrom: Date
  prices: TariffPriceInput
}

export interface ScheduleTemporaryPromotionInput
  extends LogicalTariffIdentityInput {
  promoStart: Date
  promoEndInclusive: Date
  prices: TariffPriceInput
}

export interface UpdateLogicalTariffDetailsInput
  extends LogicalTariffIdentityInput {
  nextProviderId: string
  nextName: string
  affiliation?: string
  notes?: string
}
```

- [ ] **Step 6: Implement transaction-local persistence helpers**

Keep `saveChargingPlan` and `deleteChargingPlan` public behavior unchanged. Extract validation and add helpers that accept transaction tables:

```ts
type PlanTable = Table<ChargingPlan, string>
type OutboxTable = Table<SyncOutbox, number>

async function putPlanAndQueue(
  plans: PlanTable,
  outbox: OutboxTable,
  plan: ChargingPlan,
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  now: Date
): Promise<void> {
  validatePlan(plan)
  await plans.put(plan)
  await outbox.add({
    table_name: 'charging_plans',
    action,
    payload: plan,
    timestamp: now,
    retry_count: 0,
    last_attempt_at: undefined,
    next_attempt_at: undefined,
    last_error: undefined,
  })
}
```

Do not call `saveChargingPlan` or `deleteChargingPlan` from a logical mutation. Each logical operation must open exactly one top-level transaction and use `putPlanAndQueue`.

- [ ] **Step 7: Implement complete-timeline validation**

Load all versions once, sort them, and validate before the first write:

```ts
function findFirstVersionStartingWithin(
  versions: ChargingPlan[],
  startInclusive: Date,
  endExclusive?: Date
): ChargingPlan | undefined {
  return versions.find((version) => (
    version.valid_from.getTime() >= startInclusive.getTime()
    && (endExclusive == null || version.valid_from.getTime() < endExclusive.getTime())
  ))
}
```

Permanent scheduling:
1. Resolve the baseline effective on `effectiveFrom`.
2. Reject when no baseline exists.
3. Reject when `effectiveFrom <= baseline.valid_from`.
4. Find the first other version starting on or after `effectiveFrom`; reject and include its `YYYY-MM-DD` date.
5. Close the baseline and insert the successor in one transaction.

Promotion scheduling:
1. Validate `promoEndInclusive >= promoStart`.
2. Resolve the baseline effective on `promoStart`, not the previous day.
3. Reject when no baseline exists.
4. Reject when `promoStart <= baseline.valid_from`, because a preceding persisted baseline is required for derived promotion classification.
5. Set `restoreFrom = addUtcDays(promoEndInclusive, 1)`.
6. Reject the first other version whose start lies in `[promoStart, restoreFrom]`, including a version beginning exactly on `restoreFrom`.
7. Close baseline, insert promotion, and insert restoration in one transaction.

Identity edits:
1. Load source versions and potential destination versions before writing.
2. For every source period, reject if it overlaps an active destination period.
3. Update every source row and queue every outbox entry in one transaction.

Logical deletion:
1. Load all active versions.
2. Apply the same `deleted_at` and `updated_at` timestamp to each.
3. Queue every `DELETE` in the same transaction.

- [ ] **Step 8: Run service tests**

Run: `npm run test -- --run src/features/charging-plans/services/chargingPlanService.test.ts`

Expected: PASS, including zero outbox rows after rejected conflicts.

- [ ] **Step 9: Commit service behavior**

```bash
git add src/features/charging-plans/services/planService.ts src/features/charging-plans/services/chargingPlanService.test.ts
git commit -m "feat(tariffs): add atomic version management"
```

## Task 3: UTC Day Rollover And Hook Surface

**Files:**
- Create: `src/features/charging-plans/hooks/useUtcToday.ts`
- Create: `src/features/charging-plans/hooks/useUtcToday.test.ts`
- Modify: `src/features/charging-plans/hooks/useChargingPlans.ts`
- Modify: `src/features/charging-plans/index.ts`

- [ ] **Step 1: Write a failing midnight-rollover test**

```ts
/**
 * Test suite for the UTC calendar-day hook.
 *
 * Verifies date-derived tariff state refreshes without requiring a plan write.
 */
describe('useUtcToday', () => {
  it('updates after UTC midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T23:59:59.000Z'))
    const { result } = renderHook(() => useUtcToday())

    expect(formatUtcDate(result.current)).toBe('2026-08-14')
    act(() => vi.advanceTimersByTime(1_100))
    expect(formatUtcDate(result.current)).toBe('2026-08-15')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Implement `useUtcToday`**

```ts
export function useUtcToday(): Date {
  const [today, setToday] = useState(() => startOfUtcDay(new Date()))

  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    ))
    const timer = window.setTimeout(
      () => setToday(startOfUtcDay(new Date())),
      nextMidnight.getTime() - now.getTime() + 50
    )
    return () => window.clearTimeout(timer)
  }, [today])

  return today
}
```

Define `startOfUtcDay` in the same file.

- [ ] **Step 3: Update `useChargingPlans`**

Use `useUtcToday()` and:

```ts
const logicalTariffs = useMemo(
  () => buildLogicalTariffs(plans ?? [], today),
  [plans, today]
)
```

Return:

```ts
{
  plans,
  logicalTariffs,
  isLoading,
  addChargingPlan,
  removeChargingPlan,
  updateLogicalTariffDetails,
  schedulePermanentChange,
  schedulePromotion,
  deleteLogicalTariff,
}
```

Use the exported service input types directly rather than `Parameters<typeof ...>[0]`.

- [ ] **Step 4: Export feature contracts**

Update `src/features/charging-plans/index.ts` to export:

```ts
export * from './model/logicalTariffs'
export type {
  LogicalTariffIdentityInput,
  SchedulePermanentTariffVersionInput,
  ScheduleTemporaryPromotionInput,
  TariffPriceInput,
  UpdateLogicalTariffDetailsInput,
} from './services/planService'
```

- [ ] **Step 5: Run hook and feature tests**

Run: `npm run test -- --run src/features/charging-plans/hooks/useUtcToday.test.ts src/features/charging-plans/services/chargingPlanService.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit hook surface**

```bash
git add src/features/charging-plans/hooks/useUtcToday.ts src/features/charging-plans/hooks/useUtcToday.test.ts src/features/charging-plans/hooks/useChargingPlans.ts src/features/charging-plans/index.ts
git commit -m "feat(tariffs): expose current logical tariffs"
```

## Task 4: Version Management Forms

**Files:**
- Modify: `src/features/charging-plans/components/TariffForm.tsx`
- Modify: `src/features/charging-plans/components/TariffForm.test.tsx`
- Create: `src/features/charging-plans/components/PermanentPriceChangeForm.tsx`
- Create: `src/features/charging-plans/components/PermanentPriceChangeForm.test.tsx`
- Create: `src/features/charging-plans/components/TemporaryPromotionForm.tsx`
- Create: `src/features/charging-plans/components/TemporaryPromotionForm.test.tsx`

- [ ] **Step 1: Write failing form tests**

Cover:
- details mode renders provider, name, affiliation, and notes only,
- details submit returns `nextProviderId`, `nextName`, `affiliation`, and `notes`,
- permanent form includes all six price/fee fields and effective date,
- promotion form includes all six price/fee fields and both dates,
- comma decimals convert to integer cents,
- negative/invalid money remains in the form and displays validation,
- promotion end before start displays a field error,
- service rejection appears as a root alert without clearing entered values.

Use suite-level JSDoc and Arrange, Act, Assert comments.

- [ ] **Step 2: Add type-safe details mode**

Use a discriminated prop union:

```ts
interface StandardTariffFormProps {
  mode?: 'create' | 'edit'
  onSubmit: (data: ChargingPlan) => Promise<void>
  onCancel: () => void
  initialValues?: Partial<ChargingPlan>
}

export interface LogicalTariffDetailsValues {
  nextProviderId: string
  nextName: string
  affiliation?: string
  notes?: string
}

interface DetailsTariffFormProps {
  mode: 'details'
  onSubmit: (data: LogicalTariffDetailsValues) => Promise<void>
  onCancel: () => void
  initialValues: Pick<ChargingPlan, 'provider_id' | 'name' | 'affiliation' | 'notes'>
}

export type TariffFormProps =
  | StandardTariffFormProps
  | DetailsTariffFormProps
```

Use a details-specific Zod schema so hidden pricing and validity fields are neither required nor submitted. Preserve the existing schema and payload for create/edit mode.

- [ ] **Step 3: Implement shared version-form values**

Each focused form owns its public submit type and receives the complete logical
history so the selected date determines the prefill:

```ts
export interface PermanentPriceChangeFormProps {
  versions: ChargingPlan[]
  onSubmit: (data: PermanentPriceChangeSubmit) => Promise<void>
  onCancel: () => void
}

export interface PermanentPriceChangeSubmit {
  effectiveFrom: Date
  prices: TariffPriceInput
}

export interface TemporaryPromotionFormProps {
  versions: ChargingPlan[]
  onSubmit: (data: TemporaryPromotionSubmit) => Promise<void>
  onCancel: () => void
}

export interface TemporaryPromotionSubmit {
  promoStart: Date
  promoEndInclusive: Date
  prices: TariffPriceInput
}
```

Define complete Zod schemas with:

```ts
const moneyField = z.string().refine(isValidMoneyInput, 'Enter a valid non-negative amount')

const priceFields = {
  ac_price: moneyField.optional(),
  dc_price: moneyField.optional(),
  roaming_ac_price: moneyField.optional(),
  roaming_dc_price: moneyField.optional(),
  monthly_base_fee: moneyField,
  session_fee: moneyField,
}
```

Define the money validator in each form or extract a feature-local helper used by
both:

```ts
function isValidMoneyInput(value?: string): boolean {
  if (value == null || value.trim() === '') return true
  return /^\d+(?:[.,]\d{1,2})?$/.test(value.trim())
}
```

Require at least one price or positive fee after conversion, matching
`planService` validation. Use `formatCentsToDecimal`, `parseDecimalToCents`,
`formatUtcDate`, and `parseUtcDateInput`.

- [ ] **Step 4: Implement complete focused forms**

Both forms use `Slab`, `ThinInput`, existing button styling, and these fields:

Permanent:
- `Effective From`
- `AC Price`
- `DC Price`
- `Roaming AC Price`
- `Roaming DC Price`
- `Monthly Base Fee`
- `Session Fee`
- submit label `Save permanent change`

Promotion:
- `Promo Start`
- `Promo End`
- the same six money fields
- helper text from the approved design
- submit label `Save promotion`

Watch `effective_from` or `promo_start` and resolve the baseline from `versions`:

```ts
const selectedStart = useWatch({ control, name: startFieldName })
const baseline = selectedStart
  ? resolveEffectivePlanForDate(versions, parseUtcDateInput(selectedStart))
  : null
```

When the selected start date changes to a different baseline version, use
`setValue` to prefill all six money fields from that version. Track the last
prefilled baseline ID in a ref so validation rerenders do not overwrite the
user's price edits. If no baseline applies, set a date-field error and disable
submission.

Catch `onSubmit` failures inside each form, set `root.submit`, and do not call `reset`.

- [ ] **Step 5: Run focused form tests**

Run: `npm run test -- --run src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/components/PermanentPriceChangeForm.test.tsx src/features/charging-plans/components/TemporaryPromotionForm.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit forms**

```bash
git add src/features/charging-plans/components/TariffForm.tsx src/features/charging-plans/components/TariffForm.test.tsx src/features/charging-plans/components/PermanentPriceChangeForm.tsx src/features/charging-plans/components/PermanentPriceChangeForm.test.tsx src/features/charging-plans/components/TemporaryPromotionForm.tsx src/features/charging-plans/components/TemporaryPromotionForm.test.tsx
git commit -m "feat(tariffs): add version management forms"
```

## Task 5: Grouped Overview, Reachable History, And Confirmed Deletion

**Files:**
- Modify: `src/features/charging-plans/components/TariffList.tsx`
- Modify: `src/features/charging-plans/components/TariffList.test.tsx`
- Create: `src/features/charging-plans/components/TariffVersionActionMenu.tsx`
- Create: `src/features/charging-plans/components/TariffVersionActionMenu.test.tsx`
- Create: `src/features/charging-plans/components/TariffVersionHistorySheet.tsx`
- Create: `src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx`
- Create: `src/features/charging-plans/components/DeleteLogicalTariffDialog.tsx`
- Create: `src/features/charging-plans/components/DeleteLogicalTariffDialog.test.tsx`

- [ ] **Step 1: Write failing overview workflow tests**

Cover:

```ts
it('renders one card for all versions and displays the current price', () => {
  mockLogicalTariff({ currentVersion: baseline, nextVersion: successor })
  renderTariffList()

  expect(screen.getAllByRole('button', { name: /edit ionity lidl/i })).toHaveLength(1)
  expect(screen.getByText('Upcoming change on 15 Aug')).toBeInTheDocument()
  expect(screen.getByText('0,29 €')).toBeInTheDocument()
})

it('opens reachable version history from the card', async () => {
  mockPromotionLogicalTariff()
  renderTariffList()

  await userEvent.click(screen.getByRole('button', { name: /view history for ionity lidl/i }))

  expect(screen.getByRole('heading', { name: /tariff history/i })).toBeInTheDocument()
  expect(screen.getByText('Promotion')).toBeInTheDocument()
  expect(screen.getByText('Restored')).toBeInTheDocument()
})

it('requires explicit confirmation before deleting the logical tariff', async () => {
  const deleteLogicalTariff = vi.fn()
  mockLogicalTariff({ deleteLogicalTariff })
  renderTariffList()

  await openMenuAndChoose('Delete tariff')
  expect(deleteLogicalTariff).not.toHaveBeenCalled()
  expect(screen.getByText(/all scheduled changes and promotions/i)).toBeInTheDocument()
  expect(screen.getByText(/historical charging sessions will keep their saved prices/i)).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /delete complete tariff/i }))
  expect(deleteLogicalTariff).toHaveBeenCalledTimes(1)
})
```

Also test menu labels and each form opening from its action.

- [ ] **Step 2: Implement the action menu**

Use `<details>` with a `summary` trigger and four required menu items:
- `Edit details`
- `Change price permanently`
- `Run temporary promotion`
- `Delete tariff`

Use governed tokens (`bg-surface`, `border-secondary/10`, `text-primary`) rather than hard-coded `bg-white`. Every control must be at least 44px.

- [ ] **Step 3: Implement history and deletion components**

`TariffVersionHistorySheet` props:

```ts
interface TariffVersionHistorySheetProps {
  logicalTariff: LogicalTariff
  providerName: string
  onClose: () => void
}
```

Render rows chronologically. Each row displays all `labels`, inclusive range, domestic/roaming prices when present, monthly fee, and session fee.

`DeleteLogicalTariffDialog` props:

```ts
interface DeleteLogicalTariffDialogProps {
  logicalTariffLabel: string
  isDeleting: boolean
  onConfirm: () => Promise<void>
  onCancel: () => void
}
```

Use `role="dialog"`, `aria-modal="true"`, a labelled heading, the required warning copy, `Cancel`, and `Delete complete tariff`. Keep the dialog open and show a root alert if deletion rejects.

- [ ] **Step 4: Implement `TariffList` state and wiring**

Use:

```ts
type TariffSurface =
  | { kind: 'none' }
  | { kind: 'details'; key: string }
  | { kind: 'permanent_change'; key: string }
  | { kind: 'promotion'; key: string }
  | { kind: 'history'; key: string }
  | { kind: 'delete'; key: string }
```

Render one card per `logicalTariffs` entry. The visible `Edit` action opens details mode. Add a low-emphasis `View history for <label>` button below the pricing grid; this is the explicit trigger for the secondary detail surface. The overflow `Edit details` action opens the same details surface.

Pass `logicalTariff.versions` to permanent and promotion forms. Those forms
resolve and prefill the applicable baseline whenever their selected start date
changes. The service repeats the same lookup and remains authoritative.

On successful mutation, close the surface. On failure, let the child form/dialog retain its values and show its error.

- [ ] **Step 5: Run overview tests**

Run: `npm run test -- --run src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx src/features/charging-plans/components/DeleteLogicalTariffDialog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit overview workflows**

```bash
git add src/features/charging-plans/components/TariffList.tsx src/features/charging-plans/components/TariffList.test.tsx src/features/charging-plans/components/TariffVersionActionMenu.tsx src/features/charging-plans/components/TariffVersionActionMenu.test.tsx src/features/charging-plans/components/TariffVersionHistorySheet.tsx src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx src/features/charging-plans/components/DeleteLogicalTariffDialog.tsx src/features/charging-plans/components/DeleteLogicalTariffDialog.test.tsx
git commit -m "feat(tariffs): add grouped version workflows"
```

## Task 6: Logical Selection With Raw Version Persistence

**Files:**
- Modify: `src/features/charging-sessions/components/SessionForm.tsx`
- Modify: `src/features/charging-sessions/components/SessionForm.test.tsx`
- Modify: `src/features/charging-sessions/services/sessionService.ts`
- Modify: `src/features/charging-sessions/services/sessionService.test.ts`

- [ ] **Step 1: Write failing effective-date tests**

Service test:

```ts
it('resolves baseline, promotion, and restoration on their effective dates', () => {
  const versions = buildPromotionChain()

  expect(resolveEffectivePlanForDate(versions, utc('2026-08-09'))?.id).toBe('baseline')
  expect(resolveEffectivePlanForDate(versions, utc('2026-08-10'))?.id).toBe('promo')
  expect(resolveEffectivePlanForDate(versions, utc('2026-08-31'))?.id).toBe('promo')
  expect(resolveEffectivePlanForDate(versions, utc('2026-09-01'))?.id).toBe('restore')
})
```

Import the shared resolver from `../../charging-plans`; do not create a second date-resolution implementation in `sessionService.ts`.

- [ ] **Step 2: Write failing form regression tests**

Add tests for:
- the plan selector renders one option per logical tariff,
- changing the date changes displayed rates and submitted raw `tariff_plan_id`,
- a gap displays `No tariff version applies on the selected date` and blocks save,
- a persisted raw version ID maps to its logical option after plans hydrate,
- a retired persisted plan remains represented by the historical fallback,
- unchanged editing preserves raw ID, snapshot, exact timestamp, and `plan_selection_id`,
- changing only billed kWh does not create `planSelectionChange`,
- changing the date resolves a new raw version and may create `planSelectionChange`,
- changing provider removes the prior historical fallback,
- legacy `tariff_id` continues to initialize edit mode.
- all behavior works with `navigator.onLine === false`; no service or form path
  calls Supabase or waits for connectivity.

- [ ] **Step 3: Separate browser selection from persistence identity**

Change the form schema:

```ts
logical_tariff_key: z.string().optional(),
```

Stop using `tariff_plan_id` as the select value. Keep raw plan IDs only in prepared domain input.

Add:

```ts
function resolveInitialLogicalKey(
  initialValues: LegacySessionInitialValues | undefined,
  plans: ChargingPlan[]
): string {
  const rawPlanId = initialValues?.tariff_plan_id ?? initialValues?.tariff_id
  if (!rawPlanId) return ''
  const plan = plans.find((candidate) => candidate.id === rawPlanId)
  return plan ? getLogicalTariffKey(plan) : `historical::${rawPlanId}`
}
```

Initialize the field to an empty string, then use an effect to set the mapped logical key when plans hydrate, provided the user has not changed provider or logical selection. Preserve `historical::<raw-id>` while the original provider remains selected.

- [ ] **Step 4: Derive effective plan without mutating edit identity**

Build logical options with the selected session date:

```ts
const logicalTariffsForProvider = useMemo(
  () => buildLogicalTariffs(
    plans.filter((plan) => plan.provider_id === selectedProviderId),
    parseUtcDateInput(selectedSessionDate)
  ),
  [plans, selectedProviderId, selectedSessionDate]
)

const selectedLogicalTariff = logicalTariffsForProvider.find(
  (logical) => logical.key === selectedLogicalTariffKey
)
const effectivePlan = selectedLogicalTariff?.currentVersion ?? null
```

For an unchanged existing plan session, continue using:
- `existingSession.tariff_plan_id`,
- existing snapshot,
- existing `plan_selection_id`,
- existing exact timestamp.

Treat the edit as unchanged only when provider, logical key, visible date, charging type, and pricing mode are unchanged. Otherwise require `effectivePlan`, pass `effectivePlan.id` to `prepareSessionEdit`, and build a fresh snapshot.

- [ ] **Step 5: Preserve provider-plan selection behavior explicitly**

For new or deliberately repriced sessions:

```ts
const activeSelection = await getActivePlanSelectionAt(
  providerId,
  user.id,
  planSelectionDate
)
const planSelectionChange = (
  !activeSelection
  || activeSelection.tariff_plan_id !== effectivePlan.id
) ? {
  userId: user.id,
  providerId,
  tariffPlanId: effectivePlan.id,
  validFrom: planSelectionDate,
  priceSnapshot: snapshot,
} satisfies SetActivePlanSelectionInput : undefined
```

This intentionally keeps the current persistence contract: provider-plan selection rows reference raw effective versions. Add an explanatory comment because logical tariff selection and raw selection-history persistence now differ.

- [ ] **Step 6: Run session tests**

Run: `npm run test -- --run src/features/charging-sessions/services/sessionService.test.ts src/features/charging-sessions/components/SessionForm.test.tsx`

Expected: PASS, including all existing session-edit regression tests.

- [ ] **Step 7: Commit effective-date session pricing**

```bash
git add src/features/charging-sessions/components/SessionForm.tsx src/features/charging-sessions/components/SessionForm.test.tsx src/features/charging-sessions/services/sessionService.ts src/features/charging-sessions/services/sessionService.test.ts
git commit -m "feat(sessions): select effective tariff versions"
```

## Task 7: Design Governance And Full Verification

**Files:**
- Modify only files needed to correct issues found by verification.

- [ ] **Step 1: Apply the design governance checklist**

Review every new/changed UI surface against:
- `docs/superpowers/specs/2026-05-16-Design-System-Sandbox-v2.0.html`
- `docs/superpowers/specs/2026-05-29-design-governance-checklist.md`

Confirm:
- token-backed surfaces and text colors,
- 44px touch targets,
- thin-input form treatment,
- stable labels and `aria-describedby`,
- keyboard-operable menu, dialog, and close controls,
- consistent action hierarchy.

Record any intentional deviation in the handoff as either `local exception` or `promote to master candidate`.

- [ ] **Step 2: Run focused tariff tests**

Run:

```bash
npm run test -- --run \
  src/features/charging-plans/model/logicalTariffs.test.ts \
  src/features/charging-plans/hooks/useUtcToday.test.ts \
  src/features/charging-plans/services/chargingPlanService.test.ts \
  src/features/charging-plans/components/TariffForm.test.tsx \
  src/features/charging-plans/components/PermanentPriceChangeForm.test.tsx \
  src/features/charging-plans/components/TemporaryPromotionForm.test.tsx \
  src/features/charging-plans/components/TariffList.test.tsx \
  src/features/charging-plans/components/TariffVersionActionMenu.test.tsx \
  src/features/charging-plans/components/TariffVersionHistorySheet.test.tsx \
  src/features/charging-plans/components/DeleteLogicalTariffDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused session tests**

Run:

```bash
npm run test -- --run \
  src/features/charging-sessions/services/sessionService.test.ts \
  src/features/charging-sessions/components/SessionForm.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run full quality verification**

Run:

```bash
npm run lint && npm run test -- --run && npm run build
```

Expected: all commands PASS.

- [ ] **Step 5: Run bundle analysis**

Run: `npm run build:analyze`

Compare `dist/bundle-stats.json` with the pre-change baseline if available. Record total bundle delta and the largest new/changed chunk drivers. No new runtime dependency is expected.

- [ ] **Step 6: Perform browser verification**

Run: `npm run dev`

Use the Browser plugin to verify:
1. multiple versions render as one card,
2. a seeded tariff whose change is effective today renders the successor and
   the automated fake-timer test covers rollover without a plan write,
3. history is reachable and shows `Promotion` plus `Restored`,
4. rejected conflicts retain form values,
5. deletion requires confirmation and removes every version,
6. sessions before, during, and after a promotion show and save the correct raw version price,
7. editing an unchanged historical session preserves its snapshot.

Capture screenshots for grouped overview, active promotion/history, and delete confirmation for PR handoff.

- [ ] **Step 7: Prepare handoff notes**

Include:
- changed files,
- verification commands and results,
- outbox atomicity/conflict tests,
- offline-first session and tariff mutation tests,
- bundle-size delta/top chunk drivers,
- design-governance result and any classified deviation,
- risks around raw `provider_plan_selections.tariff_plan_id` persistence,
- suggested commit message: `feat(tariffs): manage effective tariff versions`.

Do not push, create a PR, or merge without explicit human authorization.
