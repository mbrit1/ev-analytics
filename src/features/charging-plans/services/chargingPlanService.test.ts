import { describe, it, expect, beforeEach } from 'vitest'
import { db, type ChargingPlan } from '../../../infra/db'
import { saveChargingPlan, getChargingPlans, deleteChargingPlan } from './planService'
import 'fake-indexeddb/auto'

/**
 * Test suite for charging-plan persistence services.
 *
 * Verifies local tariff writes, sync outbox creation, active tariff filtering,
 * and soft-delete behavior used by offline sync.
 */
describe('planService', () => {
  beforeEach(async () => {
    // Keep local charging-plan and outbox state isolated between fake IndexedDB tests.
    await db.charging_plans.clear()
    await db.sync_outbox.clear()
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
