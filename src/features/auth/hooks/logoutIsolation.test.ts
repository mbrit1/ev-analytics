import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { clearLocalUserData, db, type ChargingPlan, type ChargingSession, type Provider } from '../../../infra/db';
import { getProviders, getChargingPlans, getProviderPlanSelections, setActivePlanSelection } from '../../charging-plans';
import { getSessions } from '../../charging-sessions';

/**
 * Test suite for logout-driven local data isolation.
 *
 * Verifies hard local purge semantics and cross-account visibility protections
 * for providers, charging plans, sessions, plan selections, and outbox rows.
 */
describe('logoutIsolation', () => {
  beforeEach(async () => {
    await db.providers.clear();
    await db.charging_plans.clear();
    await db.provider_plan_selections.clear();
    await db.sessions.clear();
    await db.sync_outbox.clear();
  });

  it('clears cached domain tables and outbox on logout purge', async () => {
    const providerA: Provider = {
      id: 'provider-a',
      user_id: 'user-a',
      name: 'Provider A',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const planA: ChargingPlan = {
      id: 'plan-a',
      user_id: 'user-a',
      provider_id: 'provider-a',
      name: 'Plan A',
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      valid_to: null,
      ac_price_per_kwh: 49,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const sessionA: ChargingSession = {
      id: 'session-a',
      user_id: 'user-a',
      session_timestamp: new Date('2026-01-02T00:00:00.000Z'),
      provider_id: 'provider-a',
      provider_name_snapshot: 'Provider A',
      charging_plan_name_snapshot: 'Plan A',
      charging_type: 'AC',
      kwh_billed: 10,
      total_cost: 490,
      session_mode: 'plan',
      tariff_plan_id: 'plan-a',
      plan_selection_id: null,
      price_snapshot: { label: 'Plan A', kWhPrice: 49 },
      applied_price_per_kwh: 49,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.providers.add(providerA);
    await db.charging_plans.add(planA);
    await db.sessions.add(sessionA);
    await setActivePlanSelection({
      userId: 'user-a',
      providerId: 'provider-a',
      tariffPlanId: 'plan-a',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      priceSnapshot: { label: 'Plan A', kWhPrice: 49 }
    });
    await db.sync_outbox.add({
      table_name: 'sessions',
      action: 'INSERT',
      payload: sessionA,
      timestamp: new Date(),
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });

    await clearLocalUserData();

    expect(await db.providers.count()).toBe(0);
    expect(await db.charging_plans.count()).toBe(0);
    expect(await db.provider_plan_selections.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('prevents User B from seeing User A data after logout transition', async () => {
    const providerA: Provider = {
      id: 'provider-a',
      user_id: 'user-a',
      name: 'Provider A',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const planA: ChargingPlan = {
      id: 'plan-a',
      user_id: 'user-a',
      provider_id: 'provider-a',
      name: 'Plan A',
      valid_from: new Date('2026-01-01T00:00:00.000Z'),
      valid_to: null,
      ac_price_per_kwh: 49,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const sessionA: ChargingSession = {
      id: 'session-a',
      user_id: 'user-a',
      session_timestamp: new Date('2026-01-02T00:00:00.000Z'),
      provider_id: 'provider-a',
      provider_name_snapshot: 'Provider A',
      charging_plan_name_snapshot: 'Plan A',
      charging_type: 'AC',
      kwh_billed: 10,
      total_cost: 490,
      session_mode: 'plan',
      tariff_plan_id: 'plan-a',
      plan_selection_id: null,
      price_snapshot: { label: 'Plan A', kWhPrice: 49 },
      applied_price_per_kwh: 49,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.providers.add(providerA);
    await db.charging_plans.add(planA);
    await db.sessions.add(sessionA);
    await setActivePlanSelection({
      userId: 'user-a',
      providerId: 'provider-a',
      tariffPlanId: 'plan-a',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      priceSnapshot: { label: 'Plan A', kWhPrice: 49 }
    });

    // Simulate logout between users in a shared browser profile.
    await clearLocalUserData();
    expect(await db.sync_outbox.count()).toBe(0);

    // User B signs in and creates fresh local rows.
    const providerB: Provider = {
      id: 'provider-b',
      user_id: 'user-b',
      name: 'Provider B',
      created_at: new Date(),
      updated_at: new Date(),
    };
    const planB: ChargingPlan = {
      id: 'plan-b',
      user_id: 'user-b',
      provider_id: 'provider-b',
      name: 'Plan B',
      valid_from: new Date('2026-02-01T00:00:00.000Z'),
      valid_to: null,
      ac_price_per_kwh: 59,
      monthly_base_fee: 0,
      session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const sessionB: ChargingSession = {
      id: 'session-b',
      user_id: 'user-b',
      session_timestamp: new Date('2026-02-02T00:00:00.000Z'),
      provider_id: 'provider-b',
      provider_name_snapshot: 'Provider B',
      charging_plan_name_snapshot: 'Plan B',
      charging_type: 'AC',
      kwh_billed: 11,
      total_cost: 649,
      session_mode: 'plan',
      tariff_plan_id: 'plan-b',
      plan_selection_id: null,
      price_snapshot: { label: 'Plan B', kWhPrice: 59 },
      applied_price_per_kwh: 59,
      applied_session_fee: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.providers.add(providerB);
    await db.charging_plans.add(planB);
    await db.sessions.add(sessionB);
    await setActivePlanSelection({
      userId: 'user-b',
      providerId: 'provider-b',
      tariffPlanId: 'plan-b',
      validFrom: new Date('2026-02-01T00:00:00.000Z'),
      priceSnapshot: { label: 'Plan B', kWhPrice: 59 }
    });

    const providersForUserB = await getProviders('user-b');
    const plansForUserB = await getChargingPlans('user-b');
    const sessionsForUserB = await getSessions('user-b');
    const selectionsForUserB = await getProviderPlanSelections('provider-b', 'user-b');

    expect(providersForUserB).toHaveLength(1);
    expect(providersForUserB[0].id).toBe('provider-b');
    expect(plansForUserB).toHaveLength(1);
    expect(plansForUserB[0].id).toBe('plan-b');
    expect(sessionsForUserB).toHaveLength(1);
    expect(sessionsForUserB[0].id).toBe('session-b');
    expect(selectionsForUserB).toHaveLength(1);
    expect(selectionsForUserB[0].user_id).toBe('user-b');
  });
});
