import { db, type ChargingPlan, type SyncPayload } from '../../../infra/db';

function assertIntegerCents(value: number, fieldName: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer number of cents`);
  }
}

function assertNonNegative(value: number, fieldName: string): void {
  if (value < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
}

function assertNonNegativeNullable(value: number | undefined, fieldName: string): void {
  if (value == null) return;
  assertIntegerCents(value, fieldName);
  assertNonNegative(value, fieldName);
}

function validatePlan(plan: ChargingPlan): void {
  assertNonNegativeNullable(plan.ac_price_per_kwh, 'ac_price_per_kwh');
  assertNonNegativeNullable(plan.dc_price_per_kwh, 'dc_price_per_kwh');
  assertNonNegativeNullable(plan.roaming_ac_price_per_kwh, 'roaming_ac_price_per_kwh');
  assertNonNegativeNullable(plan.roaming_dc_price_per_kwh, 'roaming_dc_price_per_kwh');
  assertIntegerCents(plan.monthly_base_fee, 'monthly_base_fee');
  assertNonNegative(plan.monthly_base_fee, 'monthly_base_fee');
  assertIntegerCents(plan.session_fee, 'session_fee');
  assertNonNegative(plan.session_fee, 'session_fee');

  const hasMeaningfulPricing = [
    plan.ac_price_per_kwh,
    plan.dc_price_per_kwh,
    plan.roaming_ac_price_per_kwh,
    plan.roaming_dc_price_per_kwh
  ].some((value) => value != null)
    || plan.monthly_base_fee > 0
    || plan.session_fee > 0;

  if (!hasMeaningfulPricing) {
    throw new Error('charging plan requires at least one price or fee value');
  }
}

function dateToComparableMs(value: Date | null | undefined): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  return value.getTime();
}

function periodsOverlap(
  leftStart: Date,
  leftEnd: Date | null | undefined,
  rightStart: Date,
  rightEnd: Date | null | undefined
): boolean {
  return leftStart.getTime() < dateToComparableMs(rightEnd)
    && rightStart.getTime() < dateToComparableMs(leftEnd);
}

export async function saveChargingPlan(plan: ChargingPlan): Promise<void> {
  validatePlan(plan);

  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const existing = await db.charging_plans.get(plan.id);
    const now = new Date();
    const normalizedPlanName = (plan.name ?? '').trim();
    const normalizedPlanNameLower = normalizedPlanName.toLowerCase();

    const overlappingTariffVersion = await db.charging_plans
      .where('provider_id')
      .equals(plan.provider_id)
      .filter((candidate) => (
        !candidate.deleted_at
        && candidate.id !== plan.id
        && candidate.user_id === plan.user_id
        && (candidate.name ?? '').trim().toLowerCase() === normalizedPlanNameLower
        && periodsOverlap(plan.valid_from, plan.valid_to, candidate.valid_from, candidate.valid_to)
      ))
      .first();

    if (overlappingTariffVersion) {
      throw new Error('Tariff validity overlaps with an existing active version for this provider and name');
    }

    const planToSave: ChargingPlan = {
      ...plan,
      name: normalizedPlanName,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.charging_plans.put(planToSave);
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: existing ? 'UPDATE' : 'INSERT',
      payload: planToSave as SyncPayload,
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}

export async function getChargingPlans(userId: string): Promise<ChargingPlan[]> {
  return db.charging_plans
    .filter((plan) => plan.user_id === userId && !plan.deleted_at)
    .toArray();
}

export async function deleteChargingPlan(id: string): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const plan = await db.charging_plans.get(id);
    if (!plan || plan.deleted_at) return;

    const now = new Date();
    const deletedPlan: ChargingPlan = {
      ...plan,
      deleted_at: now,
      updated_at: now
    };

    await db.charging_plans.put(deletedPlan);
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'DELETE',
      payload: deletedPlan as SyncPayload,
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}
