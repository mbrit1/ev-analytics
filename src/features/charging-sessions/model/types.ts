import type { AdHocPricingSnapshot, ChargingSession } from '../../../infra/db';

type SessionPreparationBaseInput = Omit<
  ChargingSession,
  | 'id'
  | 'provider_name_snapshot'
  | 'charging_plan_name_snapshot'
  | 'total_cost'
  | 'applied_price_per_kwh'
  | 'applied_ac_price_per_kwh'
  | 'applied_dc_price_per_kwh'
  | 'applied_roaming_ac_price_per_kwh'
  | 'applied_roaming_dc_price_per_kwh'
  | 'applied_monthly_base_fee'
  | 'applied_session_fee'
  | 'created_at'
  | 'updated_at'
  | 'tariff_plan_id'
  | 'ad_hoc_pricing'
> & {
  tariff_plan_id?: string | null;
  ad_hoc_pricing?: AdHocPricingSnapshot | null;
};

export type ChargingPlanSessionPreparationInput = SessionPreparationBaseInput & {
  session_mode: 'plan';
  tariff_plan_id: string;
};

export type AdHocSessionPreparationInput = SessionPreparationBaseInput & {
  session_mode: 'ad_hoc';
  tariff_plan_id?: string | null;
  ad_hoc_pricing: AdHocPricingSnapshot;
};

export type SessionPreparationInput =
  | ChargingPlanSessionPreparationInput
  | AdHocSessionPreparationInput;

export type { ChargingSession };
export { sortSessionsNewestFirst } from './sortSessionsNewestFirst';
export type { SessionMonthGroup } from './groupSessionsByMonth';
export { groupSessionsByMonth } from './groupSessionsByMonth';
