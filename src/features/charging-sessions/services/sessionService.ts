import { db, type ChargingSession, type ChargingPlan, type Provider } from '../../../infra/db';
import type { SessionPreparationInput } from '../model/types';
import { sortSessionsNewestFirst } from '../model/types';
import {
  type SetActivePlanSelectionInput,
} from '../../charging-plans';

/**
 * Fully prepared session payload plus an optional plan-selection mutation that
 * must commit in the same local transaction.
 */
export interface SessionPersistenceRequest {
  session: ChargingSession;
  planSelectionChange?: SetActivePlanSelectionInput;
}

async function buildPlanSelectionMutationWithinSessionTransaction(
  input: SetActivePlanSelectionInput
): Promise<{
  nextSelection: {
    id: string;
    user_id: string;
    provider_id: string;
    tariff_plan_id: string;
    valid_from: Date;
    valid_to: null;
    price_snapshot: SetActivePlanSelectionInput['priceSnapshot'];
    created_at: Date;
    updated_at: Date;
  };
  currentUpdate?: {
    id: string;
    valid_to: Date;
    updated_at: Date;
  };
}> {
  const current = await db.provider_plan_selections
    .where('provider_id')
    .equals(input.providerId)
    .filter((row) => row.user_id === input.userId && !row.deleted_at && row.valid_to == null)
    .first();

  const now = new Date();
  const selectionId = crypto.randomUUID();
  return {
    currentUpdate: current
      ? {
        id: current.id,
        valid_to: input.validFrom,
        updated_at: now,
      }
      : undefined,
    nextSelection: {
    id: selectionId,
    user_id: input.userId,
    provider_id: input.providerId,
    tariff_plan_id: input.tariffPlanId,
    valid_from: input.validFrom,
    valid_to: null,
    price_snapshot: structuredClone(input.priceSnapshot),
    created_at: now,
    updated_at: now,
    },
  };
}

function assertChargingSessionInvariants(baseInput: SessionPreparationInput): void {
  if (!(baseInput.kwh_billed > 0)) {
    throw new Error('kwh_billed must be greater than 0');
  }
  if (baseInput.kwh_added != null && baseInput.kwh_added < 0) {
    throw new Error('kwh_added must be null or greater than or equal to 0');
  }
  if (
    baseInput.start_soc_percentage != null
    && baseInput.end_soc_percentage != null
    && baseInput.end_soc_percentage < baseInput.start_soc_percentage
  ) {
    throw new Error('end_soc_percentage must be greater than or equal to start_soc_percentage');
  }
}

/**
 * Prepares a complete ChargingSession object from user input and associated data.
 *
 * The session stores provider/tariff names and applied prices as snapshots so
 * historic charging costs remain stable even if the related tariff changes
 * later. Monetary values are stored as integer cents.
 *
 * @param input - User-entered charging session data without generated fields.
 * @param tariff - Tariff used to calculate and snapshot the session price.
 * @param provider - Provider used to snapshot the display name.
 * @returns A complete charging session ready to persist locally.
 */
export function prepareSession(
  input: SessionPreparationInput,
  plan?: ChargingPlan,
  provider?: Provider
): ChargingSession {
  const nextModeInput = input as SessionPreparationInput & {
    session_mode?: 'plan' | 'ad_hoc';
    tariff_plan_id?: string | null;
    plan_selection_id?: string | null;
    price_snapshot?: {
      label: string;
      kWhPrice: number;
      sessionFee?: number;
      blockingFee?: number;
    };
  };

  if (nextModeInput.session_mode === 'plan') {
    if (!nextModeInput.tariff_plan_id) {
      throw new Error('tariff_plan_id is required for plan pricing');
    }
  }

  if (nextModeInput.session_mode === 'ad_hoc') {
    if (nextModeInput.tariff_plan_id) {
      throw new Error('tariff_plan_id must be null for ad_hoc pricing');
    }
    if (nextModeInput.plan_selection_id) {
      throw new Error('plan_selection_id must be null for ad_hoc pricing');
    }
  }

  const now = new Date();
  const assertIntegerCents = (value: number, label: string): number => {
    if (!Number.isInteger(value)) {
      throw new Error(`${label} must be an integer cent amount`);
    }
    return value;
  };
  const assertOptionalIntegerCents = (value: number | undefined, label: string): number | undefined => {
    if (value == null) {
      return undefined;
    }
    return assertIntegerCents(value, label);
  };
  const assertNonNegativeTotalCost = (totalCost: number): number => {
    if (totalCost < 0) {
      throw new Error('total_cost must be greater than or equal to 0');
    }
    return totalCost;
  };

  assertChargingSessionInvariants(input);

  if (input.session_mode === 'plan') {
    if (!input.provider_id) {
      throw new Error('provider_id is required for plan pricing');
    }
    if (!input.tariff_plan_id) {
      throw new Error('tariff_plan_id is required for plan pricing');
    }
    if (!provider) {
      throw new Error('Provider is required for plan pricing');
    }
    if (!plan) {
      throw new Error('Charging plan is required for plan pricing');
    }

    const resolveAppliedPricePerKwh = (): number => {
      if (input.pricing_context === 'roaming') {
        const roamingPrice = input.charging_type === 'AC'
          ? plan.roaming_ac_price_per_kwh
          : plan.roaming_dc_price_per_kwh;
        if (roamingPrice == null) {
          throw new Error(`No matching roaming ${input.charging_type} price for selected charging plan`);
        }
        return roamingPrice;
      }

      const domesticPrice = input.charging_type === 'AC'
        ? plan.ac_price_per_kwh
        : plan.dc_price_per_kwh;
      if (domesticPrice == null) {
        throw new Error(`No matching domestic ${input.charging_type} price for selected charging plan`);
      }
      return domesticPrice;
    };

    const appliedPricePerKwh = resolveAppliedPricePerKwh();
    const appliedDomesticAc = assertOptionalIntegerCents(
      plan.ac_price_per_kwh,
      'plan.ac_price_per_kwh'
    );
    const appliedDomesticDc = assertOptionalIntegerCents(
      plan.dc_price_per_kwh,
      'plan.dc_price_per_kwh'
    );
    const appliedRoamingAc = assertOptionalIntegerCents(
      plan.roaming_ac_price_per_kwh,
      'plan.roaming_ac_price_per_kwh'
    );
    const appliedRoamingDc = assertOptionalIntegerCents(
      plan.roaming_dc_price_per_kwh,
      'plan.roaming_dc_price_per_kwh'
    );
    const appliedMonthlyBaseFee = assertOptionalIntegerCents(
      plan.monthly_base_fee,
      'plan.monthly_base_fee'
    );
    const appliedSessionFee = assertOptionalIntegerCents(
      plan.session_fee,
      'plan.session_fee'
    ) ?? 0;
    const normalizedAppliedPricePerKwh = assertIntegerCents(appliedPricePerKwh, 'applied_price_per_kwh');
    const totalCost = assertNonNegativeTotalCost(
      Math.round(input.kwh_billed * normalizedAppliedPricePerKwh) + appliedSessionFee
    );

    return {
      ...input,
      id: crypto.randomUUID(),
      session_mode: 'plan',
      tariff_plan_id: input.tariff_plan_id,
      plan_selection_id: nextModeInput.plan_selection_id,
      price_snapshot: nextModeInput.price_snapshot ?? {
        label: `${provider.name} ${plan.name}`,
        kWhPrice: normalizedAppliedPricePerKwh,
        sessionFee: appliedSessionFee
      },
      provider_name_snapshot: provider.name,
      provider_id: input.provider_id,
      charging_plan_name_snapshot: plan.name,
      total_cost: totalCost,
      applied_price_per_kwh: normalizedAppliedPricePerKwh,
      applied_ac_price_per_kwh: appliedDomesticAc,
      applied_dc_price_per_kwh: appliedDomesticDc,
      applied_roaming_ac_price_per_kwh: appliedRoamingAc,
      applied_roaming_dc_price_per_kwh: appliedRoamingDc,
      applied_monthly_base_fee: appliedMonthlyBaseFee,
      applied_session_fee: appliedSessionFee,
      ad_hoc_pricing: undefined,
      created_at: now,
      updated_at: now
    };
  }

  if (!input.ad_hoc_pricing) {
    throw new Error('ad_hoc_pricing is required for ad_hoc pricing');
  }
  if (!input.provider_id) {
    throw new Error('provider_id is required for ad_hoc pricing');
  }
  if (input.tariff_plan_id != null) {
    throw new Error('tariff_plan_id must be null for ad_hoc pricing');
  }
  if (!input.ad_hoc_pricing.cpoName?.trim()) {
    throw new Error('ad_hoc_pricing.cpoName is required for ad_hoc pricing');
  }

  const ad_hocSnapshot: ChargingSession['ad_hoc_pricing'] = structuredClone(input.ad_hoc_pricing);
  const cpoNameRaw = ad_hocSnapshot.cpoName;
  if (!cpoNameRaw?.trim()) {
    throw new Error('ad_hoc_pricing.cpoName is required for ad_hoc pricing');
  }
  const pricePerKwh = ad_hocSnapshot.pricePerKwh == null
    ? null
    : assertIntegerCents(ad_hocSnapshot.pricePerKwh, 'ad_hoc_pricing.pricePerKwh');
  const pricePerMinute = ad_hocSnapshot.pricePerMinute != null
    ? assertIntegerCents(ad_hocSnapshot.pricePerMinute, 'ad_hoc_pricing.pricePerMinute')
    : undefined;
  if (pricePerMinute != null) {
    throw new Error('ad_hoc_pricing.pricePerMinute is not currently supported without a billed-duration field');
  }
  const pricePerSession = ad_hocSnapshot.pricePerSession != null
    ? assertIntegerCents(ad_hocSnapshot.pricePerSession, 'ad_hoc_pricing.pricePerSession')
    : undefined;
  const perKwhCost = pricePerKwh == null ? 0 : Math.round(input.kwh_billed * pricePerKwh);
  const sessionCost = pricePerSession ?? 0;
  const otherFeesTotal = ad_hocSnapshot.otherFees?.reduce((sum, fee) => {
    return sum + assertIntegerCents(fee.amount, `ad_hoc_pricing.otherFees.${fee.label}.amount`);
  }, 0) ?? 0;
  const cpoName = cpoNameRaw.trim();

  const totalCost = assertNonNegativeTotalCost(perKwhCost + sessionCost + otherFeesTotal);

  return {
    ...input,
    id: crypto.randomUUID(),
    session_mode: 'ad_hoc',
    tariff_plan_id: null,
    plan_selection_id: null,
    price_snapshot: nextModeInput.price_snapshot ?? {
      label: 'Ad-Hoc',
      kWhPrice: pricePerKwh ?? 0,
      sessionFee: sessionCost,
      blockingFee: otherFeesTotal > 0 ? otherFeesTotal : undefined
    },
    provider_id: input.provider_id,
    provider_name_snapshot: cpoName,
    charging_plan_name_snapshot: 'Ad-Hoc',
    total_cost: totalCost,
    ad_hoc_pricing: ad_hocSnapshot,
    applied_price_per_kwh: pricePerKwh ?? undefined,
    applied_ac_price_per_kwh: undefined,
    applied_dc_price_per_kwh: undefined,
    applied_roaming_ac_price_per_kwh: undefined,
    applied_roaming_dc_price_per_kwh: undefined,
    applied_monthly_base_fee: undefined,
    applied_session_fee: sessionCost,
    created_at: now,
    updated_at: now
  };
}

type PlanPricingIdentityInput = Pick<
  SessionPreparationInput,
  'provider_id' | 'session_timestamp' | 'charging_type'
> & {
  tariff_plan_id?: string | null;
  pricing_context?: ChargingSession['pricing_context'];
};

/**
 * Returns whether a plan edit deliberately changes the fields that define its
 * historical price source.
 */
export function hasPlanPricingIdentityChanged(
  existing: ChargingSession,
  input: PlanPricingIdentityInput
): boolean {
  return existing.provider_id !== input.provider_id
    || existing.tariff_plan_id !== input.tariff_plan_id
    || existing.session_timestamp.getTime() !== input.session_timestamp.getTime()
    || existing.charging_type !== input.charging_type
    || (existing.pricing_context ?? 'standard') !== (input.pricing_context ?? 'standard');
}

/**
 * Prepares an edited session while preserving historical pricing unless the
 * user deliberately changes its pricing identity.
 */
export function prepareSessionEdit(
  existing: ChargingSession,
  input: SessionPreparationInput,
  plan?: ChargingPlan,
  provider?: Provider
): ChargingSession {
  if ((existing.session_mode ?? 'plan') !== input.session_mode) {
    throw new Error('Pricing source cannot be changed while editing a session');
  }

  if (
    input.session_mode === 'plan'
    && !hasPlanPricingIdentityChanged(existing, input)
  ) {
    assertChargingSessionInvariants(input);

    const appliedPrice = existing.applied_price_per_kwh ?? existing.price_snapshot?.kWhPrice;
    if (appliedPrice == null) {
      throw new Error('Historical plan price is unavailable for this session');
    }
    const appliedSessionFee = existing.applied_session_fee
      ?? existing.price_snapshot?.sessionFee
      ?? 0;

    return {
      ...existing,
      ...input,
      id: existing.id,
      user_id: existing.user_id,
      session_mode: existing.session_mode,
      provider_name_snapshot: existing.provider_name_snapshot,
      charging_plan_name_snapshot: existing.charging_plan_name_snapshot,
      plan_selection_id: existing.plan_selection_id,
      price_snapshot: structuredClone(existing.price_snapshot),
      applied_price_per_kwh: appliedPrice,
      applied_ac_price_per_kwh: existing.applied_ac_price_per_kwh,
      applied_dc_price_per_kwh: existing.applied_dc_price_per_kwh,
      applied_roaming_ac_price_per_kwh: existing.applied_roaming_ac_price_per_kwh,
      applied_roaming_dc_price_per_kwh: existing.applied_roaming_dc_price_per_kwh,
      applied_monthly_base_fee: existing.applied_monthly_base_fee,
      applied_session_fee: appliedSessionFee,
      total_cost: Math.round(input.kwh_billed * appliedPrice) + appliedSessionFee,
      created_at: existing.created_at,
      updated_at: new Date(),
      deleted_at: existing.deleted_at,
    };
  }

  const repricingInput = input.session_mode === 'plan'
    ? { ...input, price_snapshot: undefined }
    : input;
  const prepared = prepareSession(repricingInput, plan, provider);
  return {
    ...prepared,
    id: existing.id,
    user_id: existing.user_id,
    created_at: existing.created_at,
    deleted_at: existing.deleted_at,
  };
}

async function persistSessionInsert(session: ChargingSession): Promise<void> {
  await db.sessions.put(session);
  await db.sync_outbox.add({
    table_name: 'sessions',
    action: 'INSERT',
    payload: session,
    timestamp: new Date(),
    retry_count: 0,
    last_attempt_at: undefined,
    next_attempt_at: undefined,
    last_error: undefined
  });
}

async function persistSessionUpdate(session: ChargingSession): Promise<void> {
  const existing = await db.sessions.get(session.id);
  if (!existing) {
    throw new Error(`Session not found: ${session.id}`);
  }

  const updatedAt = new Date();
  const updatedSession: ChargingSession = {
    ...session,
    id: existing.id,
    user_id: existing.user_id,
    created_at: existing.created_at,
    session_mode: existing.session_mode,
    deleted_at: existing.deleted_at,
    updated_at: updatedAt,
  };

  const updatedRows = await db.sessions.update(existing.id, updatedSession);
  if (updatedRows !== 1) {
    throw new Error(`Session not found: ${existing.id}`);
  }

  await db.sync_outbox.add({
    table_name: 'sessions',
    action: 'UPDATE',
    payload: updatedSession,
    timestamp: updatedAt,
    retry_count: 0,
    last_attempt_at: undefined,
    next_attempt_at: undefined,
    last_error: undefined
  });
}

async function persistSessionRequest(
  request: SessionPersistenceRequest,
  mode: 'insert' | 'update'
): Promise<void> {
  await db.transaction('rw', db.sessions, db.provider_plan_selections, db.sync_outbox, async () => {
    let session = request.session;
    let planSelectionMutation: Awaited<ReturnType<typeof buildPlanSelectionMutationWithinSessionTransaction>> | undefined;

    if (request.planSelectionChange) {
      planSelectionMutation = await buildPlanSelectionMutationWithinSessionTransaction(request.planSelectionChange);
      session = {
        ...session,
        plan_selection_id: planSelectionMutation.nextSelection.id,
      };
    }

    if (mode === 'insert') {
      await persistSessionInsert(session);
    } else {
      await persistSessionUpdate(session);
    }

    if (!planSelectionMutation) {
      return;
    }

    if (planSelectionMutation.currentUpdate) {
      await db.provider_plan_selections.update(
        planSelectionMutation.currentUpdate.id,
        planSelectionMutation.currentUpdate
      );
      const updatedCurrent = await db.provider_plan_selections.get(planSelectionMutation.currentUpdate.id);
      if (updatedCurrent) {
        await db.sync_outbox.add({
          table_name: 'provider_plan_selections',
          action: 'UPDATE',
          payload: updatedCurrent,
          timestamp: planSelectionMutation.currentUpdate.updated_at,
          retry_count: 0,
          last_attempt_at: undefined,
          next_attempt_at: undefined,
          last_error: undefined
        });
      }
    }

    await db.provider_plan_selections.add(planSelectionMutation.nextSelection);
    await db.sync_outbox.add({
      table_name: 'provider_plan_selections',
      action: 'INSERT',
      payload: planSelectionMutation.nextSelection,
      timestamp: planSelectionMutation.nextSelection.created_at,
      retry_count: 0,
      last_attempt_at: undefined,
      next_attempt_at: undefined,
      last_error: undefined
    });
  });
}

/**
 * Saves a charging session to the local database and creates a sync outbox entry.
 *
 * The transaction keeps the local write and pending sync request atomic: either
 * both are committed, or neither is. That prevents a saved session from being
 * stranded without a corresponding sync entry.
 *
 * @param session - Fully prepared charging session to save and sync.
 */
export async function saveSession(session: ChargingSession): Promise<void> {
  await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
    await persistSessionInsert(session);
  });
}

/**
 * Saves a session and its related plan-selection change inside one local
 * transaction so offline history and outbox state cannot diverge.
 */
export async function saveSessionWithPlanSelection(request: SessionPersistenceRequest): Promise<void> {
  await persistSessionRequest(request, 'insert');
}

/**
 * Updates an existing charging session and atomically queues remote sync.
 *
 * Service-owned identity and lifecycle fields are preserved from the stored
 * row so an edit cannot mutate creation metadata, ownership, or deletion
 * state.
 *
 * @param session - Fully prepared charging session to update locally and sync.
 */
export async function updateSession(session: ChargingSession): Promise<void> {
  await db.transaction('rw', db.sessions, db.sync_outbox, async () => {
    await persistSessionUpdate(session);
  });
}

/**
 * Updates a stored session and any related plan-selection change atomically so
 * edit retries cannot leave cross-table local state out of sync.
 */
export async function updateSessionWithPlanSelection(request: SessionPersistenceRequest): Promise<void> {
  await persistSessionRequest(request, 'update');
}

/**
 * Fetches all charging sessions from the local database, ordered newest-first
 * by the session timestamp users expect to see in history.
 *
 * Soft-deleted sessions are omitted so history views only show active records.
 *
 * @returns Active charging sessions sorted from newest to oldest.
 */
export async function getSessions(userId: string): Promise<ChargingSession[]> {
  const sessions = await db.sessions
    .filter((session) => session.user_id === userId && !session.deleted_at)
    .toArray();

  return sortSessionsNewestFirst(sessions);
}
