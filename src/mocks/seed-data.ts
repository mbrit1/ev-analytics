/**
 * Seed providers returned by MSW when local mock mode hydrates Supabase data.
 */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function withUtcTime(date: Date, hours: number, minutes: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes
  ));
}

const MOCK_TODAY = startOfUtcDay(new Date());
const MOCK_NOW_ISO = withUtcTime(MOCK_TODAY, 9, 0).toISOString();
const ACTIVE_PLAN_VALID_FROM = addUtcDays(MOCK_TODAY, -60);
const PROMO_BASELINE_START = addUtcDays(MOCK_TODAY, -45);
const PROMO_START = addUtcDays(MOCK_TODAY, -5);
const PROMO_END_EXCLUSIVE = addUtcDays(MOCK_TODAY, 5);
const PROMO_RESTORE_START = PROMO_END_EXCLUSIVE;

function buildSessionTimestamp(dayOffset: number, hours: number, minutes: number): string {
  return withUtcTime(addUtcDays(MOCK_TODAY, dayOffset), hours, minutes).toISOString();
}

export const mockProviders = [
  { id: 'p1', user_id: 'mock-user-id', name: 'Tesla', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO },
  { id: 'p2', user_id: 'mock-user-id', name: 'EnBW', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO },
  { id: 'p3', user_id: 'mock-user-id', name: 'FastCharge', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO },
  { id: 'p4', user_id: 'mock-user-id', name: 'DC Only Energy', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO },
  { id: 'p5', user_id: 'mock-user-id', name: 'AC Only Energy', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO },
  { id: 'p6', user_id: 'mock-user-id', name: 'Mixed Null Energy', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO },
  { id: 'p7', user_id: 'mock-user-id', name: 'PromoCharge', created_at: MOCK_NOW_ISO, updated_at: MOCK_NOW_ISO }
];

/**
 * Seed charging plans mirror flattened pricing columns persisted in Supabase.
 */
export const mockChargingPlans = [
  {
    id: 'cp1',
    user_id: 'mock-user-id',
    provider_id: 'p1',
    name: 'Supercharger Standard Only',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: 45,
    dc_price_per_kwh: 45,
    roaming_ac_price_per_kwh: null,
    roaming_dc_price_per_kwh: null,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp2',
    user_id: 'mock-user-id',
    provider_id: 'p2',
    name: 'mobility+ ADAC Full',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: 51,
    dc_price_per_kwh: 61,
    roaming_ac_price_per_kwh: 59,
    roaming_dc_price_per_kwh: 69,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp6',
    user_id: 'mock-user-id',
    provider_id: 'p2',
    name: 'mobility+ ADAC Flex',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: 49,
    dc_price_per_kwh: 59,
    roaming_ac_price_per_kwh: 57,
    roaming_dc_price_per_kwh: 67,
    monthly_base_fee: 499,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp3',
    user_id: 'mock-user-id',
    provider_id: 'p3',
    name: 'FastCharge Roaming Only',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: null,
    dc_price_per_kwh: null,
    roaming_ac_price_per_kwh: 55,
    roaming_dc_price_per_kwh: 75,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp4',
    user_id: 'mock-user-id',
    provider_id: 'p4',
    name: 'DC Only Flex',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: null,
    dc_price_per_kwh: 63,
    roaming_ac_price_per_kwh: null,
    roaming_dc_price_per_kwh: 73,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp5',
    user_id: 'mock-user-id',
    provider_id: 'p5',
    name: 'AC Only Flex',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: 47,
    dc_price_per_kwh: null,
    roaming_ac_price_per_kwh: 57,
    roaming_dc_price_per_kwh: null,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp7',
    user_id: 'mock-user-id',
    provider_id: 'p6',
    name: 'Mixed Null Standard A',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: 42,
    dc_price_per_kwh: null,
    roaming_ac_price_per_kwh: null,
    roaming_dc_price_per_kwh: 72,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp8',
    user_id: 'mock-user-id',
    provider_id: 'p6',
    name: 'Mixed Null Standard B',
    valid_from: ACTIVE_PLAN_VALID_FROM,
    valid_to: null,
    ac_price_per_kwh: null,
    dc_price_per_kwh: 62,
    roaming_ac_price_per_kwh: 52,
    roaming_dc_price_per_kwh: null,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp9',
    user_id: 'mock-user-id',
    provider_id: 'p7',
    name: 'PromoDrive Flex',
    valid_from: PROMO_BASELINE_START,
    valid_to: PROMO_START,
    ac_price_per_kwh: 48,
    dc_price_per_kwh: 58,
    roaming_ac_price_per_kwh: 56,
    roaming_dc_price_per_kwh: 68,
    monthly_base_fee: 199,
    session_fee: 0,
    affiliation: 'member',
    notes: 'Baseline before the active promo window.',
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp10',
    user_id: 'mock-user-id',
    provider_id: 'p7',
    name: 'PromoDrive Flex',
    valid_from: PROMO_START,
    valid_to: PROMO_END_EXCLUSIVE,
    ac_price_per_kwh: 39,
    dc_price_per_kwh: 49,
    roaming_ac_price_per_kwh: 47,
    roaming_dc_price_per_kwh: 59,
    monthly_base_fee: 99,
    session_fee: 0,
    affiliation: 'member',
    notes: 'Active promotion window for local mock mode.',
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  },
  {
    id: 'cp11',
    user_id: 'mock-user-id',
    provider_id: 'p7',
    name: 'PromoDrive Flex',
    valid_from: PROMO_RESTORE_START,
    valid_to: null,
    ac_price_per_kwh: 48,
    dc_price_per_kwh: 58,
    roaming_ac_price_per_kwh: 56,
    roaming_dc_price_per_kwh: 68,
    monthly_base_fee: 199,
    session_fee: 0,
    affiliation: 'member',
    notes: 'Restored baseline after the active promo window.',
    created_at: MOCK_NOW_ISO,
    updated_at: MOCK_NOW_ISO
  }
];

/**
 * Seed charging sessions include charging-plan/ad-hoc snapshots so history and sync flows
 * behave like production data during local development.
 */
export const mockSessions = [
  {
    id: 's7',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-1, 13, 5),
    provider_id: 'p7',
    provider_name_snapshot: 'PromoCharge',
    tariff_plan_id: 'cp10',
    charging_plan_name_snapshot: 'PromoDrive Flex',
    charging_type: 'DC',
    kwh_billed: 22,
    total_cost: 1078,
    session_mode: 'plan',
    pricing_context: 'standard',
    plan_selection_id: 'ps7',
    price_snapshot: { label: 'PromoCharge PromoDrive Flex', kWhPrice: 49, sessionFee: 0 },
    applied_price_per_kwh: 49,
    applied_ac_price_per_kwh: 39,
    applied_dc_price_per_kwh: 49,
    applied_roaming_ac_price_per_kwh: 47,
    applied_roaming_dc_price_per_kwh: 59,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-1, 13, 10),
    updated_at: buildSessionTimestamp(-1, 13, 10)
  },
  {
    id: 's1',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-2, 8, 15),
    provider_id: 'p1',
    provider_name_snapshot: 'Tesla',
    tariff_plan_id: 'cp1',
    charging_plan_name_snapshot: 'Supercharger Standard Only',
    charging_type: 'DC',
    kwh_billed: 45.2,
    total_cost: 2034,
    session_mode: 'plan',
    pricing_context: 'standard',
    plan_selection_id: 'ps1',
    price_snapshot: { label: 'Tesla Supercharger Standard Only', kWhPrice: 45, sessionFee: 0 },
    start_soc_percentage: 15,
    end_soc_percentage: 80,
    applied_ac_price_per_kwh: 45,
    applied_dc_price_per_kwh: 45,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-2, 8, 20),
    updated_at: buildSessionTimestamp(-2, 8, 20)
  },
  {
    id: 's5',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-3, 17, 20),
    provider_id: 'p2',
    provider_name_snapshot: 'EnBW',
    tariff_plan_id: 'cp2',
    charging_plan_name_snapshot: 'mobility+ ADAC Full',
    charging_type: 'AC',
    kwh_billed: 16,
    total_cost: 816,
    session_mode: 'plan',
    pricing_context: 'standard',
    plan_selection_id: 'ps5',
    price_snapshot: { label: 'EnBW mobility+ ADAC Full', kWhPrice: 51, sessionFee: 0 },
    applied_price_per_kwh: 51,
    applied_ac_price_per_kwh: 51,
    applied_dc_price_per_kwh: 61,
    applied_roaming_ac_price_per_kwh: 59,
    applied_roaming_dc_price_per_kwh: 69,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-3, 17, 25),
    updated_at: buildSessionTimestamp(-3, 17, 25)
  },
  {
    id: 's2',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-4, 18, 45),
    provider_id: 'p2',
    provider_name_snapshot: 'EnBW',
    tariff_plan_id: null,
    charging_plan_name_snapshot: null,
    charging_type: 'AC',
    kwh_billed: 20,
    total_cost: 1020,
    session_mode: 'ad_hoc',
    pricing_context: 'ad_hoc',
    plan_selection_id: null,
    price_snapshot: { label: 'Ad-Hoc', kWhPrice: 51, sessionFee: 0 },
    ad_hoc_pricing: {
      cpoName: 'EnBW',
      pricePerKwh: 51
    },
    applied_price_per_kwh: 51,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-4, 18, 50),
    updated_at: buildSessionTimestamp(-4, 18, 50)
  },
  {
    id: 's6',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-6, 19, 10),
    provider_id: 'p2',
    provider_name_snapshot: 'EnBW',
    tariff_plan_id: 'cp2',
    charging_plan_name_snapshot: 'mobility+ ADAC Full',
    charging_type: 'DC',
    kwh_billed: 14,
    total_cost: 966,
    session_mode: 'plan',
    pricing_context: 'roaming',
    plan_selection_id: 'ps6',
    price_snapshot: { label: 'EnBW mobility+ ADAC Full', kWhPrice: 69, sessionFee: 0 },
    applied_price_per_kwh: 69,
    applied_ac_price_per_kwh: 51,
    applied_dc_price_per_kwh: 61,
    applied_roaming_ac_price_per_kwh: 59,
    applied_roaming_dc_price_per_kwh: 69,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-6, 19, 15),
    updated_at: buildSessionTimestamp(-6, 19, 15)
  },
  {
    id: 's4',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-10, 12, 30),
    provider_id: 'p2',
    provider_name_snapshot: 'EnBW',
    tariff_plan_id: 'cp6',
    charging_plan_name_snapshot: 'mobility+ ADAC Flex',
    charging_type: 'DC',
    kwh_billed: 12,
    total_cost: 708,
    session_mode: 'plan',
    pricing_context: 'standard',
    plan_selection_id: 'ps4',
    price_snapshot: { label: 'EnBW mobility+ ADAC Flex', kWhPrice: 59, sessionFee: 0 },
    applied_price_per_kwh: 59,
    applied_ac_price_per_kwh: 49,
    applied_dc_price_per_kwh: 59,
    applied_roaming_ac_price_per_kwh: 57,
    applied_roaming_dc_price_per_kwh: 67,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-10, 12, 35),
    updated_at: buildSessionTimestamp(-10, 12, 35)
  },
  {
    id: 's3',
    user_id: 'mock-user-id',
    session_timestamp: buildSessionTimestamp(-20, 7, 5),
    provider_id: 'p3',
    provider_name_snapshot: 'FastCharge',
    tariff_plan_id: 'cp3',
    charging_plan_name_snapshot: 'FastCharge Roaming Only',
    charging_type: 'DC',
    kwh_billed: 18,
    total_cost: 1350,
    session_mode: 'plan',
    pricing_context: 'roaming',
    plan_selection_id: 'ps3',
    price_snapshot: { label: 'FastCharge FastCharge Roaming Only', kWhPrice: 75, sessionFee: 0 },
    applied_price_per_kwh: 75,
    applied_roaming_ac_price_per_kwh: 55,
    applied_roaming_dc_price_per_kwh: 75,
    applied_session_fee: 0,
    created_at: buildSessionTimestamp(-20, 7, 10),
    updated_at: buildSessionTimestamp(-20, 7, 10)
  }
];
