import { db, type ChargingPlan, type SyncPayload } from '../../../infra/db';

/**
 * Enforces integer-cents currency representation for monetary fields.
 *
 * @param value - Candidate amount to validate.
 * @param fieldName - Field name used for error context.
 */
function assertIntegerCents(value: number, fieldName: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer number of cents`);
  }
}

/**
 * Ensures a monetary value is not negative.
 *
 * @param value - Candidate amount to validate.
 * @param fieldName - Field name used for error context.
 */
function assertNonNegative(value: number, fieldName: string): void {
  if (value < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
}

/**
 * Validates optional monetary fields when present.
 *
 * @param value - Optional amount in integer cents.
 * @param fieldName - Field name used for error context.
 */
function assertNonNegativeNullable(value: number | undefined, fieldName: string): void {
  if (value == null) return;
  assertIntegerCents(value, fieldName);
  assertNonNegative(value, fieldName);
}

/**
 * Validates charging-plan domain constraints for pricing and fee fields.
 *
 * Rules:
 * - Monetary values must be integer cents and non-negative.
 * - At least one meaningful price/fee signal must be present.
 *
 * @param chargingPlan - Charging plan payload to validate before persistence.
 */
function validateChargingPlan(chargingPlan: ChargingPlan): void {
  assertNonNegativeNullable(chargingPlan.ac_price_per_kwh, 'ac_price_per_kwh');
  assertNonNegativeNullable(chargingPlan.dc_price_per_kwh, 'dc_price_per_kwh');
  assertNonNegativeNullable(chargingPlan.roaming_ac_price_per_kwh, 'roaming_ac_price_per_kwh');
  assertNonNegativeNullable(chargingPlan.roaming_dc_price_per_kwh, 'roaming_dc_price_per_kwh');
  assertIntegerCents(chargingPlan.monthly_base_fee, 'monthly_base_fee');
  assertNonNegative(chargingPlan.monthly_base_fee, 'monthly_base_fee');
  assertIntegerCents(chargingPlan.session_fee, 'session_fee');
  assertNonNegative(chargingPlan.session_fee, 'session_fee');

  const hasMeaningfulPricing = [
    chargingPlan.ac_price_per_kwh,
    chargingPlan.dc_price_per_kwh,
    chargingPlan.roaming_ac_price_per_kwh,
    chargingPlan.roaming_dc_price_per_kwh
  ].some((value) => value != null)
    || chargingPlan.monthly_base_fee > 0
    || chargingPlan.session_fee > 0;

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
  // Half-open intervals [start, end) allow right.start === left.end.
  return leftStart.getTime() < dateToComparableMs(rightEnd)
    && rightStart.getTime() < dateToComparableMs(leftEnd);
}

/**
 * Saves a charging plan to the local database and creates a sync outbox entry.
 *
 * Tariff prices and fees are stored as integer cents. The local write and sync
 * outbox entry are created in one transaction so offline changes can be replayed
 * remotely without losing their corresponding local state.
 *
 * @param chargingPlan - Charging plan record to insert or update.
 */
export async function saveChargingPlan(chargingPlan: ChargingPlan): Promise<void> {
  validateChargingPlan(chargingPlan);

  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const existing = await db.charging_plans.get(chargingPlan.id);
    const now = new Date();
    const normalizedPlanName = (chargingPlan.plan_name ?? '').trim();

    const normalizedPlanNameLower = normalizedPlanName.toLowerCase();
    const overlappingTariffVersion = await db.charging_plans
      .where('provider_id')
      .equals(chargingPlan.provider_id)
      .filter((plan) => (
        !plan.deleted_at
        && plan.id !== chargingPlan.id
        && plan.user_id === chargingPlan.user_id
        && (plan.plan_name ?? '').trim().toLowerCase() === normalizedPlanNameLower
        && periodsOverlap(chargingPlan.valid_from, chargingPlan.valid_to, plan.valid_from, plan.valid_to)
      ))
      .first();

    if (overlappingTariffVersion) {
      throw new Error('Tariff validity overlaps with an existing active version for this provider and name');
    }
    
    // Preserve the original creation timestamp on edits while refreshing the
    // modification timestamp for conflict/audit visibility.
    const chargingPlanToSave: ChargingPlan = {
      ...chargingPlan,
      plan_name: normalizedPlanName,
      created_at: existing?.created_at || now,
      updated_at: now
    };

    await db.charging_plans.put(chargingPlanToSave);
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      // Existing local records become UPDATE syncs; new records become INSERTs.
      action: existing ? 'UPDATE' : 'INSERT',
      payload: chargingPlanToSave as SyncPayload,
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}

/**
 * Returns all charging plans that have not been soft-deleted.
 *
 * @returns Active local tariffs available for forms and charging sessions.
 */
export async function getChargingPlans(): Promise<ChargingPlan[]> {
  // Simple filter is efficient enough for single-user plan counts
  return db.charging_plans
    .filter((chargingPlan) => !chargingPlan.deleted_at)
    .toArray();
}

/**
 * Soft deletes a charging plan locally and creates a DELETE outbox entry.
 *
 * Retrieval is inside the transaction to prevent race conditions. The record is
 * retained locally with `deleted_at` so the deletion can still sync remotely
 * and historical charging sessions can keep their tariff snapshots intact.
 *
 * @param id - Charging plan id to mark deleted.
 */
export async function deleteChargingPlan(id: string): Promise<void> {
  await db.transaction('rw', db.charging_plans, db.sync_outbox, async () => {
    const chargingPlan = await db.charging_plans.get(id);
    if (!chargingPlan || chargingPlan.deleted_at) return;

    const now = new Date();
    const deletedChargingPlan: ChargingPlan = {
      ...chargingPlan,
      deleted_at: now,
      updated_at: now
    };

    await db.charging_plans.put(deletedChargingPlan);
    await db.sync_outbox.add({
      table_name: 'charging_plans',
      action: 'DELETE',
      payload: deletedChargingPlan as SyncPayload,
      timestamp: now,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}
