import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ChargingPlan, type ChargingSession } from '../../../infra/db'
import {
  createSuccessorTariffVersion,
  deleteChargingPlan,
  deleteLogicalTariff,
  getChargingPlans,
  getChargingPlanVersions,
  getEffectiveChargingPlanAt,
  saveChargingPlan,
  schedulePermanentTariffVersion,
  scheduleTemporaryPromotion,
  updateCurrentTariffVersion,
  updateLogicalTariffDetails,
} from './planService'
import 'fake-indexeddb/auto'

const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`)

const buildPrices = (overrides: Partial<{
  ac_price_per_kwh: number
  dc_price_per_kwh: number
  roaming_ac_price_per_kwh: number
  roaming_dc_price_per_kwh: number
  monthly_base_fee: number
  session_fee: number
}> = {}) => ({
  monthly_base_fee: 0,
  session_fee: 0,
  ...overrides,
})

const buildPlan = (overrides: Partial<ChargingPlan> = {}): ChargingPlan => ({
  id: crypto.randomUUID(),
  user_id: 'user-1',
  provider_id: 'provider-1',
  name: 'Lidl',
  valid_from: utc('2026-01-01'),
  valid_to: null,
  ac_price_per_kwh: 49,
  dc_price_per_kwh: 59,
  roaming_ac_price_per_kwh: 69,
  roaming_dc_price_per_kwh: 79,
  monthly_base_fee: 0,
  session_fee: 0,
  affiliation: 'member',
  notes: 'fixture',
  created_at: utc('2026-01-01'),
  updated_at: utc('2026-01-01'),
  ...overrides,
})

const seedOpenBaseline = async (overrides: Partial<ChargingPlan> = {}): Promise<ChargingPlan> => {
  const baseline = buildPlan({
    id: 'baseline',
    valid_from: utc('2026-01-01'),
    valid_to: null,
    ...overrides,
  })

  await db.charging_plans.add(baseline)
  return baseline
}

const seedBaselineAndScheduledSuccessor = async (): Promise<void> => {
  await db.charging_plans.bulkAdd([
    buildPlan({ id: 'base', valid_from: utc('2026-01-01'), valid_to: utc('2026-09-01') }),
    buildPlan({ id: 'scheduled', valid_from: utc('2026-09-01'), valid_to: null, ac_price_per_kwh: 35 }),
  ])
}

const buildSession = (overrides: Partial<ChargingSession> = {}): ChargingSession => ({
  id: crypto.randomUUID(),
  user_id: 'user-1',
  session_timestamp: utc('2026-06-01'),
  provider_id: 'provider-1',
  provider_name_snapshot: 'Lidl',
  charging_plan_name_snapshot: 'Lidl',
  charging_type: 'AC',
  kwh_billed: 10,
  total_cost: 490,
  session_mode: 'plan',
  tariff_plan_id: 'plan-1',
  applied_session_fee: 0,
  created_at: utc('2026-06-01'),
  updated_at: utc('2026-06-01'),
  ...overrides,
})

const sortedLogicalRows = (plans: ChargingPlan[]): ChargingPlan[] =>
  [...plans].sort((left, right) => left.valid_from.getTime() - right.valid_from.getTime())

/**
 * Test suite for charging-plan persistence and logical tariff-version services.
 *
 * Verifies local tariff writes, logical version management expectations,
 * sync outbox creation, active tariff filtering, and soft-delete behavior
 * used by offline sync.
 */
describe('planService', () => {
  beforeEach(async () => {
    // Keep local charging-plan and outbox state isolated between fake IndexedDB tests.
    await db.charging_plans.clear()
    await db.provider_plan_selections.clear()
    await db.sessions.clear()
    await db.sync_outbox.clear()
  })

  it('schedules a permanent successor and queues two atomic outbox mutations', async () => {
    // Arrange: Seed an open baseline logical tariff version.
    await seedOpenBaseline()

    // Act: Schedule a permanent successor starting on the requested boundary date.
    await schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: buildPrices({ ac_price_per_kwh: 35 }),
    })

    // Assert: The baseline closes, the successor opens, and two outbox rows are queued atomically.
    const plans = sortedLogicalRows(await db.charging_plans.toArray())
    expect(plans).toHaveLength(2)
    expect(plans.map((plan) => [plan.valid_from.toISOString(), plan.valid_to?.toISOString() ?? null])).toEqual([
      ['2026-01-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z'],
      ['2026-08-15T00:00:00.000Z', null],
    ])

    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(2)
    expect(outbox.map((entry) => [entry.action, (entry.payload as ChargingPlan).id])).toEqual([
      ['UPDATE', 'baseline'],
      ['INSERT', plans[1]?.id],
    ])
    expect(outbox.every((entry) => entry.retry_count === 0)).toBe(true)
    expect(outbox.every((entry) => entry.last_attempt_at === undefined)).toBe(true)
    expect(outbox.every((entry) => entry.next_attempt_at === undefined)).toBe(true)
    expect(outbox.every((entry) => entry.last_error === undefined)).toBe(true)
  })

  it('creates one bounded promotion and one restored successor', async () => {
    // Arrange: Seed an open baseline logical tariff version.
    await seedOpenBaseline()

    // Act: Schedule a temporary promotion and its restored successor.
    await scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-31'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })

    // Assert: The baseline closes, the promotion is bounded, and restoration reopens the original pricing.
    const plans = sortedLogicalRows(await db.charging_plans.toArray())
    expect(plans).toHaveLength(3)
    expect(plans.map((plan) => [plan.valid_from.toISOString(), plan.valid_to?.toISOString() ?? null, plan.ac_price_per_kwh])).toEqual([
      ['2026-01-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z', 49],
      ['2026-08-10T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 24],
      ['2026-09-01T00:00:00.000Z', null, 49],
    ])

    expect(await db.sync_outbox.count()).toBe(3)
  })

  it('schedules a promotion when persisted rows were hydrated from ISO strings', async () => {
    // Arrange: Seed a baseline row the way mock sync can hydrate it from JSON.
    await db.charging_plans.add({
      ...buildPlan({
        id: 'baseline',
        valid_from: utc('2026-01-01'),
        valid_to: null,
        created_at: utc('2026-01-01'),
        updated_at: utc('2026-01-01'),
      }),
      valid_from: '2026-01-01T00:00:00.000Z' as unknown as Date,
      created_at: '2026-01-01T00:00:00.000Z' as unknown as Date,
      updated_at: '2026-01-01T00:00:00.000Z' as unknown as Date,
    })

    // Act: Schedule a temporary promotion against the hydrated baseline row.
    await scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-31'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })

    // Assert: String-backed rows are normalized before version arithmetic runs.
    const plans = sortedLogicalRows(await getChargingPlanVersions('user-1'))
    expect(plans.map((plan) => [plan.valid_from.toISOString(), plan.valid_to?.toISOString() ?? null, plan.ac_price_per_kwh])).toEqual([
      ['2026-01-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z', 49],
      ['2026-08-10T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 24],
      ['2026-09-01T00:00:00.000Z', null, 49],
    ])
  })

  it('saves a new tariff when an existing logical version was hydrated from ISO strings', async () => {
    // Arrange: Seed an existing tariff row using serialized date fields from local sync.
    await db.charging_plans.add({
      ...buildPlan({
        id: 'existing-plan',
        name: 'Serialized Tariff',
        valid_from: utc('2026-01-01'),
        valid_to: utc('2026-03-01'),
        created_at: utc('2026-01-01'),
        updated_at: utc('2026-01-01'),
      }),
      valid_from: '2026-01-01T00:00:00.000Z' as unknown as Date,
      valid_to: '2026-03-01T00:00:00.000Z' as unknown as Date,
      created_at: '2026-01-01T00:00:00.000Z' as unknown as Date,
      updated_at: '2026-01-01T00:00:00.000Z' as unknown as Date,
    })

    // Act: Save a non-overlapping successor for the same provider and name.
    await saveChargingPlan(buildPlan({
      id: 'new-plan',
      name: 'Serialized Tariff',
      valid_from: utc('2026-03-01'),
      valid_to: null,
      ac_price_per_kwh: 35,
    }))

    // Assert: The save path hydrates existing date strings before overlap checks.
    const plans = sortedLogicalRows(await getChargingPlanVersions('user-1'))
    expect(plans).toHaveLength(2)
    expect(plans.map((plan) => [plan.id, plan.valid_from.toISOString(), plan.valid_to?.toISOString() ?? null])).toEqual([
      ['existing-plan', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
      ['new-plan', '2026-03-01T00:00:00.000Z', null],
    ])
  })

  it('getEffectiveChargingPlanAt resolves both sides of a boundary', async () => {
    // Arrange: Seed adjacent versions that meet at a half-open boundary.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'base', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'next', valid_from: utc('2026-08-15'), valid_to: null, ac_price_per_kwh: 35 }),
    ])

    // Act: Resolve the effective version before and on the boundary date.
    const beforeBoundary = await getEffectiveChargingPlanAt('user-1', 'provider-1', 'Lidl', utc('2026-08-14'))
    const onBoundary = await getEffectiveChargingPlanAt('user-1', 'provider-1', 'Lidl', utc('2026-08-15'))

    // Assert: The effective version switches exactly at the successor start date.
    expect(beforeBoundary?.id).toBe('base')
    expect(onBoundary?.id).toBe('next')
  })

  it('rejects a permanent change before an existing scheduled version without writing', async () => {
    // Arrange: Seed a baseline plus a future scheduled successor.
    await seedBaselineAndScheduledSuccessor()
    const plansBefore = await db.charging_plans.toArray()

    // Act/Assert: A conflicting permanent change is rejected and writes nothing.
    await expect(schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('Cannot schedule tariff change because version starting 2026-09-01 already exists')

    expect(await db.charging_plans.toArray()).toEqual(plansBefore)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects a promotion crossed by a scheduled version without writing', async () => {
    // Arrange: Seed a baseline plus a future scheduled successor that lands inside the promotion window.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'base', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-20') }),
      buildPlan({ id: 'scheduled', valid_from: utc('2026-08-20'), valid_to: null, ac_price_per_kwh: 35 }),
    ])
    const plansBefore = await db.charging_plans.toArray()

    // Act/Assert: A crossed promotion window is rejected atomically.
    await expect(scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-31'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('Cannot schedule promotion because version starting 2026-08-20 already exists')

    expect(await db.charging_plans.toArray()).toEqual(plansBefore)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects a promotion when a version starts exactly on the restore boundary', async () => {
    // Arrange: Seed a baseline plus a future version that starts exactly when restoration would begin.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'base', valid_from: utc('2026-01-01'), valid_to: utc('2026-09-01') }),
      buildPlan({ id: 'scheduled', valid_from: utc('2026-09-01'), valid_to: null, ac_price_per_kwh: 35 }),
    ])
    const plansBefore = await db.charging_plans.toArray()

    // Act/Assert: The restore boundary is still part of the forbidden range.
    await expect(scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-31'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('Cannot schedule promotion because version starting 2026-09-01 already exists')

    expect(await db.charging_plans.toArray()).toEqual(plansBefore)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects a promotion that would outlive a bounded baseline with no restoration window', async () => {
    // Arrange: Seed a bounded baseline that ends before promotion restoration could begin.
    await db.charging_plans.add(
      buildPlan({ id: 'base', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-20') })
    )
    const plansBefore = await db.charging_plans.toArray()

    // Act/Assert: Promotions must leave time to restore the original baseline before it ends.
    await expect(scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-31'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('Promotion must leave time to restore the baseline before it ends')

    expect(await db.charging_plans.toArray()).toEqual(plansBefore)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects permanent effectiveFrom equal to the baseline first day', async () => {
    // Arrange: Seed the baseline version that would otherwise be split.
    await seedOpenBaseline({ id: 'base' })

    // Act/Assert: Scheduling on the baseline start date is invalid.
    await expect(schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-01-01'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('effectiveFrom must be after the current baseline start date')
    expect(await db.charging_plans.count()).toBe(1)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects promotion end before start', async () => {
    // Arrange: Seed a baseline version for the promotion attempt.
    await seedOpenBaseline({ id: 'base' })

    // Act/Assert: Promotion end must not precede its start.
    await expect(scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-08-10'),
      promoEndInclusive: utc('2026-08-09'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('promoEndInclusive must be on or after promoStart')
    expect(await db.charging_plans.count()).toBe(1)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects promotion start equal to the baseline first day', async () => {
    // Arrange: Seed a baseline version for the promotion attempt.
    await seedOpenBaseline({ id: 'base' })

    // Act/Assert: Promotions require a preceding persisted baseline before the promo starts.
    await expect(scheduleTemporaryPromotion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      promoStart: utc('2026-01-01'),
      promoEndInclusive: utc('2026-01-05'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('promoStart must be after the current baseline start date')
    expect(await db.charging_plans.count()).toBe(1)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects invalid money in logical mutations', async () => {
    // Arrange: Seed a baseline version for the mutation attempt.
    await seedOpenBaseline({ id: 'base' })

    // Act/Assert: Logical mutation pricing enforces non-negative cents values.
    await expect(schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: buildPrices({ ac_price_per_kwh: -1 }),
    })).rejects.toThrow('ac_price_per_kwh must be non-negative')
    expect(await db.charging_plans.count()).toBe(1)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects non-integer money in logical mutations', async () => {
    // Arrange: Seed a baseline version for the mutation attempt.
    await seedOpenBaseline({ id: 'base' })

    // Act/Assert: Logical mutation pricing still enforces integer cents validation.
    await expect(schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: buildPrices({ ac_price_per_kwh: 24.5 }),
    })).rejects.toThrow('ac_price_per_kwh must be an integer number of cents')
    expect(await db.charging_plans.count()).toBe(1)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rejects missing baseline', async () => {
    // Arrange: Leave the logical tariff timeline empty.

    // Act/Assert: Missing baseline versions are rejected before any write.
    await expect(schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: buildPrices({ ac_price_per_kwh: 24 }),
    })).rejects.toThrow('No active tariff baseline exists for provider-1::lidl')
    expect(await db.charging_plans.count()).toBe(0)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('rolls back logical tariff writes when queueing an atomic mutation fails', async () => {
    // Arrange: Seed a baseline and force the first outbox write to fail mid-transaction.
    await seedOpenBaseline({ id: 'base' })
    const plansBefore = await db.charging_plans.toArray()
    const addSpy = vi.spyOn(db.sync_outbox, 'add').mockRejectedValueOnce(new Error('outbox failure'))

    // Act/Assert: The logical mutation rejects and leaves both plans and outbox unchanged.
    await expect(schedulePermanentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      prices: buildPrices({ ac_price_per_kwh: 35 }),
    })).rejects.toThrow('outbox failure')

    expect(await db.charging_plans.toArray()).toEqual(plansBefore)
    expect(await db.sync_outbox.count()).toBe(0)

    addSpy.mockRestore()
  })

  it('updates the current version in place when valid_from is unchanged', async () => {
    // Arrange: Seed one open logical tariff baseline and a historical session snapshot.
    await seedOpenBaseline({ id: 'baseline', name: 'Lidl' })
    await db.sessions.add(buildSession({
      id: 'session-1',
      tariff_plan_id: 'baseline',
      charging_plan_name_snapshot: 'Lidl',
    }))

    // Act: Update the current version without changing its original start date.
    await updateCurrentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      currentVersionId: 'baseline',
      validFrom: utc('2026-01-01'),
      nextName: 'Lidl Corrected',
      prices: buildPrices({
        ac_price_per_kwh: 55,
        dc_price_per_kwh: 65,
        roaming_ac_price_per_kwh: 75,
        roaming_dc_price_per_kwh: 85,
      }),
      affiliation: 'member plus',
      notes: 'updated current version',
    })

    // Assert: The current row id is preserved, no successor row is created, and the session snapshot stays unchanged.
    const plans = sortedLogicalRows(await getChargingPlans('user-1'))
    expect(plans).toHaveLength(1)
    expect(plans[0]?.id).toBe('baseline')
    expect(plans[0]?.name).toBe('Lidl Corrected')
    expect(plans[0]?.ac_price_per_kwh).toBe(55)
    expect(plans[0]?.affiliation).toBe('member plus')
    expect(plans[0]?.notes).toBe('updated current version')
    expect(await db.sync_outbox.count()).toBe(1)
    expect((await db.sessions.get('session-1'))?.charging_plan_name_snapshot).toBe('Lidl')
  })

  it('preserves existing affiliation and notes when current-version fields are omitted', async () => {
    // Arrange: Seed one open logical tariff baseline with descriptive metadata.
    await seedOpenBaseline({
      id: 'baseline',
      name: 'Lidl',
      affiliation: 'member',
      notes: 'keep me',
    })

    // Act: Update only the current version pricing and name.
    await updateCurrentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      currentVersionId: 'baseline',
      validFrom: utc('2026-01-01'),
      nextName: 'Lidl Corrected',
      prices: buildPrices({
        ac_price_per_kwh: 55,
        dc_price_per_kwh: 65,
        roaming_ac_price_per_kwh: 75,
        roaming_dc_price_per_kwh: 85,
      }),
    })

    // Assert: Omitted descriptive fields are preserved on the current version.
    const [plan] = sortedLogicalRows(await getChargingPlanVersions('user-1'))
    expect(plan?.affiliation).toBe('member')
    expect(plan?.notes).toBe('keep me')
  })

  it('updates valid_to when editing the current tariff version', async () => {
    // Arrange: Seed an open logical tariff baseline.
    await seedOpenBaseline({ id: 'baseline', valid_from: utc('2026-01-01'), valid_to: null })

    // Act: Save a current-version edit with an explicit end date.
    await updateCurrentTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      currentVersionId: 'baseline',
      validFrom: utc('2026-01-01'),
      validTo: utc('2026-12-31'),
      nextName: 'Lidl',
      prices: buildPrices({ ac_price_per_kwh: 55 }),
    })

    // Assert: The edited current row persists the submitted validity end date.
    const [plan] = sortedLogicalRows(await getChargingPlanVersions('user-1'))
    expect(plan?.valid_to?.toISOString()).toBe('2026-12-31T00:00:00.000Z')
  })

  it('creates a successor when valid_from changes', async () => {
    // Arrange: Seed an open logical tariff baseline.
    await seedOpenBaseline({ id: 'baseline', valid_from: utc('2026-01-01'), valid_to: null })

    // Act: Move the next tariff version boundary forward.
    await createSuccessorTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      nextName: 'Lidl Plus',
      prices: buildPrices({ ac_price_per_kwh: 35 }),
      affiliation: 'vip',
      notes: 'renamed successor',
    })

    // Assert: The baseline closes and a renamed successor opens on the requested date.
    const plans = sortedLogicalRows(await db.charging_plans.toArray())
    expect(plans).toHaveLength(2)
    expect(plans[0]?.id).toBe('baseline')
    expect(plans[0]?.valid_to?.toISOString()).toBe('2026-08-15T00:00:00.000Z')
    expect(plans[1]?.id).not.toBe('baseline')
    expect(plans[1]?.name).toBe('Lidl Plus')
    expect(plans[1]?.valid_from.toISOString()).toBe('2026-08-15T00:00:00.000Z')
    expect(plans[1]?.affiliation).toBe('vip')
    expect(plans[1]?.notes).toBe('renamed successor')
  })

  it('uses submitted valid_to when creating a successor tariff version', async () => {
    // Arrange: Seed an open logical tariff baseline.
    await seedOpenBaseline({ id: 'baseline', valid_from: utc('2026-01-01'), valid_to: null })

    // Act: Create a successor with an explicit end date from the unified edit form.
    await createSuccessorTariffVersion({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      effectiveFrom: utc('2026-08-15'),
      validTo: utc('2026-12-31'),
      nextName: 'Lidl Plus',
      prices: buildPrices({ ac_price_per_kwh: 35 }),
    })

    // Assert: The successor receives the submitted validity end instead of silently staying open.
    const plans = sortedLogicalRows(await db.charging_plans.toArray())
    expect(plans[1]?.valid_to?.toISOString()).toBe('2026-12-31T00:00:00.000Z')
  })

  it('updates provider, name, affiliation, and notes on every version', async () => {
    // Arrange: Seed a logical tariff timeline with two versions.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'base', provider_id: 'provider-1', name: 'Lidl', affiliation: 'member', notes: 'old', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'next', provider_id: 'provider-1', name: 'Lidl', affiliation: 'member', notes: 'old', valid_from: utc('2026-08-15'), valid_to: null }),
    ])

    // Act: Change the logical tariff identity details.
    await updateLogicalTariffDetails({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      nextProviderId: 'provider-2',
      nextName: 'Lidl Plus',
      affiliation: 'vip',
      notes: 'updated',
    })

    // Assert: Every version is updated consistently and each row is queued for sync.
    const plans = sortedLogicalRows(await db.charging_plans.toArray())
    expect(plans).toHaveLength(2)
    expect(plans.every((plan) => plan.provider_id === 'provider-2')).toBe(true)
    expect(plans.every((plan) => plan.name === 'Lidl Plus')).toBe(true)
    expect(plans.every((plan) => plan.affiliation === 'vip')).toBe(true)
    expect(plans.every((plan) => plan.notes === 'updated')).toBe(true)
    expect(await db.sync_outbox.count()).toBe(2)
  })

  it('preserves existing affiliation and notes when omitted from logical detail updates', async () => {
    // Arrange: Seed a logical tariff timeline with existing descriptive fields.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'base', provider_id: 'provider-1', name: 'Lidl', affiliation: 'member', notes: 'keep me', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'next', provider_id: 'provider-1', name: 'Lidl', affiliation: 'member', notes: 'keep me', valid_from: utc('2026-08-15'), valid_to: null }),
    ])

    // Act: Change only the logical tariff identity fields.
    await updateLogicalTariffDetails({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      nextProviderId: 'provider-2',
      nextName: 'Lidl Plus',
    })

    // Assert: Omitted descriptive fields remain unchanged on every version.
    const plans = sortedLogicalRows(await db.charging_plans.toArray())
    expect(plans).toHaveLength(2)
    expect(plans.every((plan) => plan.provider_id === 'provider-2')).toBe(true)
    expect(plans.every((plan) => plan.name === 'Lidl Plus')).toBe(true)
    expect(plans.every((plan) => plan.affiliation === 'member')).toBe(true)
    expect(plans.every((plan) => plan.notes === 'keep me')).toBe(true)
  })

  it('rejects changing identity to one that overlaps an existing logical tariff with no writes', async () => {
    // Arrange: Seed source versions and an overlapping destination logical tariff.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'source', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-01-01'), valid_to: null }),
      buildPlan({ id: 'destination', provider_id: 'provider-2', name: 'Lidl Plus', valid_from: utc('2026-06-01'), valid_to: null }),
    ])
    const plansBefore = await db.charging_plans.toArray()

    // Act/Assert: Overlapping destination periods block the identity move.
    await expect(updateLogicalTariffDetails({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      nextProviderId: 'provider-2',
      nextName: 'Lidl Plus',
      affiliation: 'vip',
      notes: 'updated',
    })).rejects.toThrow('Tariff identity overlaps an existing active logical tariff for provider-2::lidl plus')

    expect(await db.charging_plans.toArray()).toEqual(plansBefore)
    expect(await db.sync_outbox.count()).toBe(0)
  })

  it('deleting a logical tariff soft-deletes all versions', async () => {
    // Arrange: Seed two logical tariff versions plus unrelated tariffs and sessions.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'target-base', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'target-next', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-08-15'), valid_to: null }),
      buildPlan({ id: 'other', provider_id: 'provider-9', name: 'Other Plan', valid_from: utc('2026-01-01'), valid_to: null }),
    ])
    await db.sessions.bulkAdd([
      buildSession({ id: 'session-1', tariff_plan_id: 'target-base' }),
      buildSession({ id: 'session-2', provider_id: 'provider-9', provider_name_snapshot: 'Other Provider', charging_plan_name_snapshot: 'Other Plan', tariff_plan_id: 'other' }),
    ])

    // Act: Delete the logical tariff identity.
    await deleteLogicalTariff({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
    })

    // Assert: Every target version is soft-deleted, unrelated data stays untouched, and each delete is queued.
    const targetPlans = sortedLogicalRows((await db.charging_plans.toArray()).filter((plan) => plan.provider_id === 'provider-1'))
    expect(targetPlans).toHaveLength(2)
    expect(targetPlans.every((plan) => plan.deleted_at instanceof Date)).toBe(true)
    expect(targetPlans[0]?.updated_at.toISOString()).toBe(targetPlans[1]?.updated_at.toISOString())
    expect(targetPlans[0]?.deleted_at?.toISOString()).toBe(targetPlans[1]?.deleted_at?.toISOString())
  })

  it('soft-deletes a logical tariff even when one stored version is legacy-invalid', async () => {
    // Arrange: Seed one legacy-invalid version and one valid successor for the same logical tariff.
    await db.charging_plans.bulkAdd([
      {
        ...buildPlan({
          id: 'target-invalid',
          provider_id: 'provider-1',
          name: 'Lidl',
          valid_from: utc('2026-01-01'),
          valid_to: utc('2026-08-15'),
        }),
        ac_price_per_kwh: undefined,
        dc_price_per_kwh: undefined,
        roaming_ac_price_per_kwh: undefined,
        roaming_dc_price_per_kwh: undefined,
        monthly_base_fee: 0,
        session_fee: 0,
      },
      buildPlan({ id: 'target-next', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-08-15'), valid_to: null }),
    ])

    // Act: Delete the logical tariff identity.
    await deleteLogicalTariff({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
    })

    // Assert: Both versions are still soft-deleted and delete outbox rows are queued.
    const targetPlans = sortedLogicalRows((await db.charging_plans.toArray()).filter((plan) => plan.provider_id === 'provider-1'))
    expect(targetPlans).toHaveLength(2)
    expect(targetPlans.every((plan) => plan.deleted_at instanceof Date)).toBe(true)
    const outbox = await db.sync_outbox.toArray()
    expect(outbox.filter((entry) => entry.action === 'DELETE' && entry.table_name === 'charging_plans')).toHaveLength(2)
  })

  it('queues one DELETE outbox entry per version when deleting a logical tariff', async () => {
    // Arrange: Seed a logical tariff with two versions to delete.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'target-base', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'target-next', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-08-15'), valid_to: null }),
    ])

    // Act: Delete the logical tariff identity.
    await deleteLogicalTariff({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
    })

    // Assert: Each deleted version produces its own DELETE outbox mutation.
    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(2)
    expect(outbox.every((entry) => entry.action === 'DELETE')).toBe(true)
  })

  it('leaves unrelated tariffs and all sessions unchanged when deleting a logical tariff', async () => {
    // Arrange: Seed target versions, one unrelated tariff, and sessions tied to both.
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'target-base', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-01-01'), valid_to: utc('2026-08-15') }),
      buildPlan({ id: 'target-next', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-08-15'), valid_to: null }),
      buildPlan({ id: 'other', provider_id: 'provider-9', name: 'Other Plan', valid_from: utc('2026-01-01'), valid_to: null }),
    ])
    await db.sessions.bulkAdd([
      buildSession({ id: 'session-1', tariff_plan_id: 'target-base' }),
      buildSession({ id: 'session-2', provider_id: 'provider-9', provider_name_snapshot: 'Other Provider', charging_plan_name_snapshot: 'Other Plan', tariff_plan_id: 'other' }),
    ])
    const sessionsBefore = await db.sessions.toArray()

    // Act: Delete the target logical tariff identity.
    await deleteLogicalTariff({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
    })

    // Assert: Unrelated tariffs stay active and every session row remains unchanged.

    const unrelatedPlan = await db.charging_plans.get('other')
    expect(unrelatedPlan?.deleted_at).toBeUndefined()

    const sessions = await db.sessions.toArray()
    expect(sessions).toEqual(sessionsBefore)
  })

  it('updates provider plan selections when moving a logical tariff to another provider', async () => {
    // Arrange: Seed a logical tariff version plus an active selection row that references it.
    await db.charging_plans.add(
      buildPlan({ id: 'target-base', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-01-01'), valid_to: null })
    )
    await db.provider_plan_selections.add({
      id: 'selection-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      tariff_plan_id: 'target-base',
      valid_from: utc('2026-01-01'),
      valid_to: null,
      price_snapshot: { label: 'Lidl', kWhPrice: 49 },
      created_at: utc('2026-01-01'),
      updated_at: utc('2026-01-01'),
    })

    // Act: Move the logical tariff identity to another provider.
    await updateLogicalTariffDetails({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
      nextProviderId: 'provider-2',
      nextName: 'Lidl Plus',
    })

    // Assert: Referencing provider selection rows are updated to the new provider as part of the same change.
    const selection = await db.provider_plan_selections.get('selection-1')
    expect(selection?.provider_id).toBe('provider-2')
    const outbox = await db.sync_outbox.toArray()
    expect(outbox.some((entry) => entry.table_name === 'provider_plan_selections' && entry.action === 'UPDATE')).toBe(true)
  })

  it('soft-deletes provider plan selections that point at a deleted logical tariff', async () => {
    // Arrange: Seed a logical tariff version plus an active selection row that references it.
    await db.charging_plans.add(
      buildPlan({ id: 'target-base', provider_id: 'provider-1', name: 'Lidl', valid_from: utc('2026-01-01'), valid_to: null })
    )
    await db.provider_plan_selections.add({
      id: 'selection-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      tariff_plan_id: 'target-base',
      valid_from: utc('2026-01-01'),
      valid_to: null,
      price_snapshot: { label: 'Lidl', kWhPrice: 49 },
      created_at: utc('2026-01-01'),
      updated_at: utc('2026-01-01'),
    })

    // Act: Delete the logical tariff identity.
    await deleteLogicalTariff({
      userId: 'user-1',
      providerId: 'provider-1',
      name: 'Lidl',
    })

    // Assert: Referencing selection rows are also soft-deleted so active-selection state cannot go stale.
    const selection = await db.provider_plan_selections.get('selection-1')
    expect(selection?.deleted_at).toBeInstanceOf(Date)
    const outbox = await db.sync_outbox.toArray()
    expect(outbox.some((entry) => entry.table_name === 'provider_plan_selections' && entry.action === 'DELETE')).toBe(true)
  })

  it('should save a charging plan and create an outbox entry', async () => {
    // Arrange: Build a charging plan with cents-based pricing.
    const planData: ChargingPlan = {
      id: 'plan-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Supercharger',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 45,
      dc_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0 ,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save the charging plan through the service transaction.
    await saveChargingPlan(planData)

    // Assert: The charging plan and matching sync outbox item are persisted.
    const plan = await db.charging_plans.get('plan-1')
    expect(plan).toBeDefined()
    expect(plan?.name).toBe('Supercharger')

    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].table_name).toBe('charging_plans')
    expect(outbox[0]).toMatchObject({
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    })
  })

  it('should list all non-deleted charging plans', async () => {
    // Arrange: Seed one active charging plan and one soft-deleted charging plan.
    const p1: ChargingPlan = {
      id: 'p1', user_id: 'u1', provider_id: 'provider-1', name: 'Plan 1',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 50,
      dc_price_per_kwh: 50 ,
      monthly_base_fee: 0,
      session_fee: 0 ,
      created_at: new Date(), updated_at: new Date()
    }
    const p2: ChargingPlan = {
      id: 'p2', user_id: 'u1', provider_id: 'provider-1', name: 'Plan 2',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 60,
      dc_price_per_kwh: 60 ,
      monthly_base_fee: 0,
      session_fee: 0 ,
      created_at: new Date(), updated_at: new Date(),
      deleted_at: new Date()
    }

    await db.charging_plans.bulkAdd([p1, p2])

    // Act: Query active charging plans through the service.
    const plans = await getChargingPlans('u1')
    // Assert: Soft-deleted charging plans are excluded from active results.
    expect(plans).toHaveLength(1)
    expect(plans[0].id).toBe('p1')
  })

  it('returns only the current effective version for each logical tariff in the legacy plans view', async () => {
    // Arrange: Seed one past, current, and future version around the real current day.
    const now = new Date()
    const daysFromNow = (days: number): Date => new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    await db.charging_plans.bulkAdd([
      buildPlan({ id: 'past', user_id: 'u1', provider_id: 'provider-1', name: 'Plan 1', valid_from: daysFromNow(-180), valid_to: daysFromNow(-30) }),
      buildPlan({ id: 'current', user_id: 'u1', provider_id: 'provider-1', name: 'Plan 1', valid_from: daysFromNow(-30), valid_to: daysFromNow(30) }),
      buildPlan({ id: 'future', user_id: 'u1', provider_id: 'provider-1', name: 'Plan 1', valid_from: daysFromNow(30), valid_to: null }),
      buildPlan({ id: 'other-current', user_id: 'u1', provider_id: 'provider-1', name: 'Plan 2', valid_from: daysFromNow(-15), valid_to: null }),
    ])

    // Act: Read the legacy-safe plans view.
    const plans = await getChargingPlans('u1')

    // Assert: Only the effective current version for each logical tariff is returned.
    expect(plans.map((plan) => plan.id)).toEqual(['current', 'other-current'])
  })

  it('should soft delete a charging plan and create a DELETE outbox entry', async () => {
    // Arrange: Seed a charging plan that can be deleted.
    const plan: ChargingPlan = {
      id: 'plan-delete', user_id: 'u1', provider_id: 'provider-1', name: 'To Delete',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 50,
      dc_price_per_kwh: 50 ,
      monthly_base_fee: 0,
      session_fee: 0 ,
      created_at: new Date(), updated_at: new Date()
    }
    await db.charging_plans.add(plan)

    // Act: Soft-delete the charging plan through the service.
    await deleteChargingPlan('plan-delete')

    // Assert: The charging plan is marked deleted and a DELETE outbox item is queued.
    const retrieved = await db.charging_plans.get('plan-delete')
    expect(retrieved?.deleted_at).toBeDefined()

    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].action).toBe('DELETE')
    expect(outbox[0]).toMatchObject({
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    })
  })

  it('should soft delete an invalid stored charging plan without revalidating it', async () => {
    // Arrange: Seed a legacy invalid plan that should still be deletable.
    const plan: ChargingPlan = {
      id: 'plan-invalid-delete',
      user_id: 'u1',
      provider_id: 'provider-1',
      name: 'Legacy Invalid',
      valid_from: new Date(),
      valid_to: null,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }
    await db.charging_plans.add(plan)

    // Act: Soft-delete the stored plan.
    await deleteChargingPlan('plan-invalid-delete')

    // Assert: Deletion still succeeds and queues a delete mutation.
    const deleted = await db.charging_plans.get('plan-invalid-delete')
    expect(deleted?.deleted_at).toBeDefined()

    const outbox = await db.sync_outbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.action).toBe('DELETE')
  })

  it('should allow optional domestic prices and save roaming and fee based charging plan', async () => {
    // Arrange: Create a charging plan using nullable core prices with other meaningful fees.
    const planData: ChargingPlan = {
      id: 'plan-subscription-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Subscription Plan',
      valid_from: new Date(),
          valid_to: null,
      roaming_ac_price_per_kwh: 89,
      roaming_dc_price_per_kwh: 99 ,
      monthly_base_fee: 1199,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save and read back.
    await saveChargingPlan(planData)
    const saved = await db.charging_plans.get('plan-subscription-1')

    // Assert: Optional and new pricing fields are persisted.
    expect(saved).toBeDefined()
    expect(saved?.ac_price_per_kwh).toBeUndefined()
    expect(saved?.dc_price_per_kwh).toBeUndefined()
    expect(saved?.roaming_ac_price_per_kwh).toBe(89)
    expect(saved?.roaming_dc_price_per_kwh).toBe(99)
    expect(saved?.monthly_base_fee).toBe(1199)
  })

  it('should reject negative monetary values', async () => {
    // Arrange: Build a charging plan with an invalid negative fee.
    const planData: ChargingPlan = {
      id: 'plan-negative-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Invalid Plan',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 45,
      dc_price_per_kwh: 55 ,
      monthly_base_fee: 0,
      session_fee: -1 ,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Validation should reject negative cents values.
    await expect(saveChargingPlan(planData)).rejects.toThrow('session_fee must be non-negative')
  })

  it('should reject non-integer money values', async () => {
    // Arrange: Build a charging plan with a decimal cents field.
    const planData: ChargingPlan = {
      id: 'plan-invalid-cents-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Invalid Cents Plan',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 45.5,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Validation should reject non-integer cents values.
    await expect(saveChargingPlan(planData)).rejects.toThrow('ac_price_per_kwh must be an integer number of cents')
  })

  it('should reject plan without meaningful pricing or fees', async () => {
    // Arrange: Create a plan with no price and no fee signals.
    const planData: ChargingPlan = {
      id: 'plan-empty-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Empty Plan',
      valid_from: new Date(),
          valid_to: null,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Validation should reject meaningless plan payloads.
    await expect(saveChargingPlan(planData)).rejects.toThrow('charging plan requires at least one price or fee value')
  })

  it('should allow plan payload without non-core fee fields', async () => {
    // Arrange: Core pricing only payload.
    const planData: ChargingPlan = {
      id: 'plan-other-fee-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Other Fee Plan',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 12 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Save succeeds with core fields only.
    await expect(saveChargingPlan(planData)).resolves.toBeUndefined()
  })

  it('should allow first unnamed tariff for a provider', async () => {
    // Arrange: Build an unnamed tariff for a provider with no existing unnamed tariff.
    const planData: ChargingPlan = {
      id: 'plan-unnamed-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '   ',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save the first unnamed tariff.
    await saveChargingPlan(planData)

    // Assert: Save succeeds and normalized name is persisted as empty string.
    const saved = await db.charging_plans.get('plan-unnamed-1')
    expect(saved?.name).toBe('')
  })

  it('should reject overlapping unnamed tariff versions for the same provider', async () => {
    // Arrange: Seed an existing unnamed active tariff for the same provider.
    const firstUnnamed: ChargingPlan = {
      id: 'plan-unnamed-existing',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 40 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }
    await saveChargingPlan(firstUnnamed)

    const secondUnnamed: ChargingPlan = {
      id: 'plan-unnamed-new',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '   ',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 50 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Overlapping unnamed versions are rejected.
    await expect(saveChargingPlan(secondUnnamed)).rejects.toThrow('Tariff validity overlaps with an existing active version for this provider and name')
  })

  it('should allow named and unnamed tariffs for the same provider', async () => {
    // Arrange: Seed one unnamed tariff for the provider.
    const unnamed: ChargingPlan = {
      id: 'plan-mixed-unnamed',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 40 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }
    await saveChargingPlan(unnamed)

    const named: ChargingPlan = {
      id: 'plan-mixed-named',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Fast DC',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 55 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save a named tariff for the same provider.
    await saveChargingPlan(named)

    // Assert: Named + unnamed combination is allowed.
    const savedNamed = await db.charging_plans.get('plan-mixed-named')
    expect(savedNamed?.name).toBe('Fast DC')
  })

  it('should allow unnamed tariffs for different providers', async () => {
    // Arrange: Save an unnamed tariff for provider-1.
    const providerOneUnnamed: ChargingPlan = {
      id: 'plan-provider-one-unnamed',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 40 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }
    await saveChargingPlan(providerOneUnnamed)

    const providerTwoUnnamed: ChargingPlan = {
      id: 'plan-provider-two-unnamed',
      user_id: 'user-1',
      provider_id: 'provider-2',
      name: '  ',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 60 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save unnamed tariff for a different provider.
    await saveChargingPlan(providerTwoUnnamed)

    // Assert: Unnamed tariffs are allowed across different providers.
    const saved = await db.charging_plans.get('plan-provider-two-unnamed')
    expect(saved?.name).toBe('')
  })

  it('should reject overlapping named tariff versions case-insensitively for same user and provider', async () => {
    // Arrange: Seed an active named tariff.
    const existingNamed: ChargingPlan = {
      id: 'plan-named-existing',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Mobility+ M',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }
    await saveChargingPlan(existingNamed)

    const duplicateNamed: ChargingPlan = {
      id: 'plan-named-duplicate',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '  mobility+ m ',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 49 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Case-insensitive overlap is blocked.
    await expect(saveChargingPlan(duplicateNamed)).rejects.toThrow('Tariff validity overlaps with an existing active version for this provider and name')
  })

  it('should allow same named tariff for different providers', async () => {
    // Arrange: Seed named tariff for provider-1.
    await saveChargingPlan({
      id: 'plan-provider-a',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Eco Plan',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 45 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Act: Save same effective name for different provider.
    await saveChargingPlan({
      id: 'plan-provider-b',
      user_id: 'user-1',
      provider_id: 'provider-2',
      name: '  eco plan ',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 55 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Assert: Different providers can reuse the same name.
    const saved = await db.charging_plans.get('plan-provider-b')
    expect(saved?.name).toBe('eco plan')
  })

  it('should allow non-overlapping versions for the same provider and name', async () => {
    // Arrange: Save first bounded version.
    await saveChargingPlan({
      id: 'plan-version-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Flex',
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      valid_to: new Date('2026-02-01T00:00:00.000Z'),
      ac_price_per_kwh: 45,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Act: Save successor version starting exactly at previous end.
    await saveChargingPlan({
      id: 'plan-version-2',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: ' flex ',
      valid_from: new Date('2026-02-01T00:00:00.000Z'),
      valid_to: null,
      ac_price_per_kwh: 49,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Assert: Boundary-touching versions are allowed.
    const saved = await db.charging_plans.get('plan-version-2')
    expect(saved?.name).toBe('flex')
  })

  it('should allow overlapping periods for different names under the same provider', async () => {
    // Arrange: Save first plan version.
    await saveChargingPlan({
      id: 'plan-overlap-a',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Mobility+',
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      valid_to: null,
      ac_price_per_kwh: 45,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Act: Save overlapping period with different name.
    await saveChargingPlan({
      id: 'plan-overlap-b',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Viellader',
      valid_from: new Date('2026-01-15T00:00:00.000Z'),
      valid_to: null,
      ac_price_per_kwh: 55,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Assert: Different logical tariffs may overlap.
    const saved = await db.charging_plans.get('plan-overlap-b')
    expect(saved?.name).toBe('Viellader')
  })

  it('should allow reusing named tariff when conflicting record is soft-deleted', async () => {
    // Arrange: Seed a soft-deleted named tariff.
    await db.charging_plans.add({
      id: 'plan-deleted',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: 'Night Saver',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 35 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date()
    })

    // Act: Save an active replacement with same effective name.
    await saveChargingPlan({
      id: 'plan-active-replacement',
      user_id: 'user-1',
      provider_id: 'provider-1',
      name: '  night saver ',
      valid_from: new Date(),
          valid_to: null,
      ac_price_per_kwh: 39 ,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Assert: Soft-deleted rows are ignored by uniqueness checks.
    const saved = await db.charging_plans.get('plan-active-replacement')
    expect(saved?.name).toBe('night saver')
  })
})
