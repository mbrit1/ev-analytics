import type {
  AdHocPricingSnapshot,
  ChargingSession,
  TariffPriceSnapshot,
} from '../../../infra/db';

/** User-supplied session measurements shared by both pricing sources. */
interface SessionPreparationBaseInput {
  user_id: string;
  session_timestamp: Date;
  charging_type: 'AC' | 'DC';
  kwh_billed: number;
  kwh_added?: number;
  odometer_km?: number;
  start_soc_percentage?: number;
  end_soc_percentage?: number;
  notes?: string;
}

/** Input accepted when preparing a session linked to a saved charging plan. */
export type ChargingPlanSessionPreparationInput = SessionPreparationBaseInput & {
  session_mode: 'plan';
  provider_id: string;
  tariff_plan_id: string;
  plan_selection_id?: string | null;
  price_snapshot?: TariffPriceSnapshot;
  pricing_context?: 'standard' | 'roaming';
  ad_hoc_pricing?: never;
};

/** Pricing values entered for a one-off session before snapshot normalization. */
export type AdHocPricingInput = Omit<AdHocPricingSnapshot, 'cpoName'>;

/** Input accepted when preparing an unlinked one-off charging session. */
export type AdHocSessionPreparationInput = SessionPreparationBaseInput & {
  session_mode: 'ad_hoc';
  billing_provider_name: string;
  cpo_name?: string | null;
  provider_id?: never;
  tariff_plan_id?: string | null;
  plan_selection_id?: null;
  price_snapshot?: TariffPriceSnapshot;
  pricing_context?: 'ad_hoc';
  ad_hoc_pricing: AdHocPricingInput;
};

/** Validated user-input variants accepted by session preparation. */
export type SessionPreparationInput =
  | ChargingPlanSessionPreparationInput
  | AdHocSessionPreparationInput;

export type { ChargingSession };
export { sortSessionsNewestFirst } from './sortSessionsNewestFirst';
export type { SessionMonthGroup } from './groupSessionsByMonth';
export { groupSessionsByMonth } from './groupSessionsByMonth';
