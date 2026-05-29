import { db, type ChargingSession, type ChargingPlan, type Provider } from '../../../infra/db';
import type { SessionPreparationInput } from '../model/types';

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
  chargingPlan?: ChargingPlan,
  provider?: Provider
): ChargingSession {
  const nextModeInput = input as SessionPreparationInput & {
    session_mode?: 'plan' | 'adHoc';
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
      throw new Error('tariff_plan_id is required for plan mode');
    }
    if (!nextModeInput.plan_selection_id) {
      throw new Error('plan_selection_id is required for plan mode');
    }
  }

  if (nextModeInput.session_mode === 'adHoc') {
    if (nextModeInput.tariff_plan_id || nextModeInput.plan_selection_id) {
      throw new Error('tariff_plan_id and plan_selection_id are forbidden for adHoc mode');
    }
    if (!nextModeInput.price_snapshot && !input.ad_hoc_pricing) {
      throw new Error('price_snapshot is required for adHoc mode');
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
  const assertChargingSessionInvariants = (baseInput: SessionPreparationInput): void => {
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
  };
  const assertNonNegativeTotalCost = (totalCost: number): number => {
    if (totalCost < 0) {
      throw new Error('total_cost must be greater than or equal to 0');
    }
    return totalCost;
  };

  assertChargingSessionInvariants(input);

  if (input.pricing_source === 'chargingPlan') {
    if (!input.provider_id) {
      throw new Error('provider_id is required for chargingPlan pricing');
    }
    if (!input.charging_plan_id) {
      throw new Error('charging_plan_id is required for chargingPlan pricing');
    }
    if (!provider) {
      throw new Error('Provider is required for chargingPlan pricing');
    }
    if (!chargingPlan) {
      throw new Error('Charging plan is required for chargingPlan pricing');
    }

    const resolveAppliedPricePerKwh = (): number => {
      if (input.pricing_context === 'roaming') {
        const roamingPrice = input.charging_type === 'AC'
          ? chargingPlan.roaming_ac_price_per_kwh
          : chargingPlan.roaming_dc_price_per_kwh;
        if (roamingPrice == null) {
          throw new Error(`No matching roaming ${input.charging_type} price for selected charging plan`);
        }
        return roamingPrice;
      }

      const domesticPrice = input.charging_type === 'AC'
        ? chargingPlan.ac_price_per_kwh
        : chargingPlan.dc_price_per_kwh;
      if (domesticPrice == null) {
        throw new Error(`No matching domestic ${input.charging_type} price for selected charging plan`);
      }
      return domesticPrice;
    };

    const appliedPricePerKwh = resolveAppliedPricePerKwh();
    const appliedDomesticAc = assertOptionalIntegerCents(
      chargingPlan.ac_price_per_kwh,
      'chargingPlan.ac_price_per_kwh'
    );
    const appliedDomesticDc = assertOptionalIntegerCents(
      chargingPlan.dc_price_per_kwh,
      'chargingPlan.dc_price_per_kwh'
    );
    const appliedRoamingAc = assertOptionalIntegerCents(
      chargingPlan.roaming_ac_price_per_kwh,
      'chargingPlan.roaming_ac_price_per_kwh'
    );
    const appliedRoamingDc = assertOptionalIntegerCents(
      chargingPlan.roaming_dc_price_per_kwh,
      'chargingPlan.roaming_dc_price_per_kwh'
    );
    const appliedMonthlyBaseFee = assertOptionalIntegerCents(
      chargingPlan.monthly_base_fee,
      'chargingPlan.monthly_base_fee'
    );
    const appliedSessionFee = assertOptionalIntegerCents(
      chargingPlan.session_fee,
      'chargingPlan.session_fee'
    ) ?? 0;
    const normalizedAppliedPricePerKwh = assertIntegerCents(appliedPricePerKwh, 'applied_price_per_kwh');
    const totalCost = assertNonNegativeTotalCost(
      Math.round(input.kwh_billed * normalizedAppliedPricePerKwh) + appliedSessionFee
    );

    return {
      ...input,
      id: crypto.randomUUID(),
      session_mode: 'plan',
      tariff_plan_id: input.charging_plan_id,
      plan_selection_id: nextModeInput.plan_selection_id,
      price_snapshot: nextModeInput.price_snapshot ?? {
        label: `${provider.name} ${chargingPlan.plan_name}`,
        kWhPrice: normalizedAppliedPricePerKwh,
        sessionFee: appliedSessionFee
      },
      provider_name_snapshot: provider.name,
      provider_id: input.provider_id,
      charging_plan_id: input.charging_plan_id,
      charging_plan_name_snapshot: chargingPlan.plan_name,
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
    throw new Error('ad_hoc_pricing is required for adHoc pricing');
  }
  if (!input.provider_id) {
    throw new Error('provider_id is required for adHoc pricing');
  }
  if (input.charging_plan_id != null) {
    throw new Error('charging_plan_id must be null for adHoc pricing');
  }
  if (!input.ad_hoc_pricing.cpoName?.trim()) {
    throw new Error('ad_hoc_pricing.cpoName is required for adHoc pricing');
  }

  const adHocSnapshot: ChargingSession['ad_hoc_pricing'] = structuredClone(input.ad_hoc_pricing);
  const cpoNameRaw = adHocSnapshot.cpoName;
  if (!cpoNameRaw?.trim()) {
    throw new Error('ad_hoc_pricing.cpoName is required for adHoc pricing');
  }
  const pricePerKwh = adHocSnapshot.pricePerKwh == null
    ? null
    : assertIntegerCents(adHocSnapshot.pricePerKwh, 'ad_hoc_pricing.pricePerKwh');
  const pricePerMinute = adHocSnapshot.pricePerMinute != null
    ? assertIntegerCents(adHocSnapshot.pricePerMinute, 'ad_hoc_pricing.pricePerMinute')
    : undefined;
  if (pricePerMinute != null) {
    throw new Error('ad_hoc_pricing.pricePerMinute is not currently supported without a billed-duration field');
  }
  const pricePerSession = adHocSnapshot.pricePerSession != null
    ? assertIntegerCents(adHocSnapshot.pricePerSession, 'ad_hoc_pricing.pricePerSession')
    : undefined;
  const perKwhCost = pricePerKwh == null ? 0 : Math.round(input.kwh_billed * pricePerKwh);
  const sessionCost = pricePerSession ?? 0;
  const otherFeesTotal = adHocSnapshot.otherFees?.reduce((sum, fee) => {
    return sum + assertIntegerCents(fee.amount, `ad_hoc_pricing.otherFees.${fee.label}.amount`);
  }, 0) ?? 0;
  const cpoName = cpoNameRaw.trim();

  const totalCost = assertNonNegativeTotalCost(perKwhCost + sessionCost + otherFeesTotal);

  return {
    ...input,
    id: crypto.randomUUID(),
    session_mode: 'adHoc',
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
    charging_plan_id: null,
    charging_plan_name_snapshot: 'Ad-Hoc',
    total_cost: totalCost,
    ad_hoc_pricing: adHocSnapshot,
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
    // Save locally first so the UI can update immediately from IndexedDB.
    await db.sessions.put(session);

    // Queue the same payload for the sync engine to replay remotely later.
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
  });
}

/**
 * Fetches all charging sessions from the local database, ordered by timestamp descending.
 *
 * Soft-deleted sessions are omitted so history views only show active records.
 *
 * @returns Active charging sessions sorted from newest to oldest.
 */
export async function getSessions(): Promise<ChargingSession[]> {
  return db.sessions
    .filter(s => !s.deleted_at)
    .reverse()
    .sortBy('session_timestamp');
}
