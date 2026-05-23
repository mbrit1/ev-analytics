import { describe, it, expect, beforeEach } from 'vitest'
import { db, type ChargingPlan } from '../../../infra/db'
import { saveChargingPlan, getChargingPlans, deleteChargingPlan } from './chargingPlanService'
import 'fake-indexeddb/auto'

/**
 * Test suite for charging-plan persistence services.
 *
 * Verifies local tariff writes, sync outbox creation, active tariff filtering,
 * and soft-delete behavior used by offline sync.
 */
describe('chargingPlanService', () => {
  beforeEach(async () => {
    // Keep local charging-plan and outbox state isolated between fake IndexedDB tests.
    await db.charging_plans.clear()
    await db.sync_outbox.clear()
  })

  it('should save a charging plan and create an outbox entry', async () => {
    // Arrange: Build a charging plan with cents-based pricing.
    const chargingPlanData: ChargingPlan = {
      id: 'plan-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      plan_name: 'Supercharger',
      validity: { from: new Date() },
      prices: { domestic: { ac: 45, dc: 45 } },
      fees: { sessionFixed: 0 },
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save the charging plan through the service transaction.
    await saveChargingPlan(chargingPlanData)

    // Assert: The charging plan and matching sync outbox item are persisted.
    const chargingPlan = await db.charging_plans.get('plan-1')
    expect(chargingPlan).toBeDefined()
    expect(chargingPlan?.plan_name).toBe('Supercharger')

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
      id: 'p1', user_id: 'u1', provider_id: 'provider-1', plan_name: 'Plan 1',
      validity: { from: new Date() },
      prices: { domestic: { ac: 50, dc: 50 } },
      fees: { sessionFixed: 0 },
      created_at: new Date(), updated_at: new Date()
    }
    const p2: ChargingPlan = {
      id: 'p2', user_id: 'u1', provider_id: 'provider-1', plan_name: 'Plan 2',
      validity: { from: new Date() },
      prices: { domestic: { ac: 60, dc: 60 } },
      fees: { sessionFixed: 0 },
      created_at: new Date(), updated_at: new Date(),
      deleted_at: new Date()
    }

    await db.charging_plans.bulkAdd([p1, p2])

    // Act: Query active charging plans through the service.
    const chargingPlans = await getChargingPlans()
    // Assert: Soft-deleted charging plans are excluded from active results.
    expect(chargingPlans).toHaveLength(1)
    expect(chargingPlans[0].id).toBe('p1')
  })

  it('should soft delete a charging plan and create a DELETE outbox entry', async () => {
    // Arrange: Seed a charging plan that can be deleted.
    const chargingPlan: ChargingPlan = {
      id: 'plan-delete', user_id: 'u1', provider_id: 'provider-1', plan_name: 'To Delete',
      validity: { from: new Date() },
      prices: { domestic: { ac: 50, dc: 50 } },
      fees: { sessionFixed: 0 },
      created_at: new Date(), updated_at: new Date()
    }
    await db.charging_plans.add(chargingPlan)

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
    const chargingPlanData: ChargingPlan = {
      id: 'plan-subscription-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      plan_name: 'Subscription Plan',
      validity: { from: new Date() },
      prices: {
        domestic: {},
        roaming: { ac: 89, dc: 99 }
      },
      fees: {
        subscriptionMonthly: 1199,
        sessionFixed: 0
      },
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act: Save and read back.
    await saveChargingPlan(chargingPlanData)
    const saved = await db.charging_plans.get('plan-subscription-1')

    // Assert: Optional and new pricing fields are persisted.
    expect(saved).toBeDefined()
    expect(saved?.prices.domestic.ac).toBeUndefined()
    expect(saved?.prices.domestic.dc).toBeUndefined()
    expect(saved?.prices.roaming?.ac).toBe(89)
    expect(saved?.prices.roaming?.dc).toBe(99)
    expect(saved?.fees.subscriptionMonthly).toBe(1199)
  })

  it('should reject negative monetary values', async () => {
    // Arrange: Build a charging plan with an invalid negative fee.
    const chargingPlanData: ChargingPlan = {
      id: 'plan-negative-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      plan_name: 'Invalid Plan',
      validity: { from: new Date() },
      prices: { domestic: { ac: 45, dc: 55 } },
      fees: { sessionFixed: -1 },
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Validation should reject negative cents values.
    await expect(saveChargingPlan(chargingPlanData)).rejects.toThrow('fees.sessionFixed must be non-negative')
  })

  it('should reject non-integer money values', async () => {
    // Arrange: Build a charging plan with a decimal cents field.
    const chargingPlanData: ChargingPlan = {
      id: 'plan-invalid-cents-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      plan_name: 'Invalid Cents Plan',
      validity: { from: new Date() },
      prices: { domestic: { ac: 45.5 } },
      fees: { sessionFixed: 0 },
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Validation should reject non-integer cents values.
    await expect(saveChargingPlan(chargingPlanData)).rejects.toThrow('prices.domestic.ac must be an integer number of cents')
  })

  it('should reject plan without meaningful pricing or fees', async () => {
    // Arrange: Create a plan with no price and no fee signals.
    const chargingPlanData: ChargingPlan = {
      id: 'plan-empty-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      plan_name: 'Empty Plan',
      validity: { from: new Date() },
      prices: { domestic: {} },
      fees: {},
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Validation should reject meaningless plan payloads.
    await expect(saveChargingPlan(chargingPlanData)).rejects.toThrow('charging plan requires at least one price or fee value')
  })

  it('should reject other fees missing required fields', async () => {
    // Arrange: Build an other-fee entry without notes.
    const chargingPlanData: ChargingPlan = {
      id: 'plan-other-fee-1',
      user_id: 'user-1',
      provider_id: 'provider-1',
      plan_name: 'Other Fee Plan',
      validity: { from: new Date() },
      prices: { domestic: { ac: 12 } },
      fees: {
        other: [{ label: 'Parking', amount: 100, notes: '' }]
      },
      created_at: new Date(),
      updated_at: new Date()
    }

    // Act/Assert: Other fee entries require label, amount, and notes.
    await expect(saveChargingPlan(chargingPlanData)).rejects.toThrow('fees.other entries require label, amount, and notes')
  })
})
