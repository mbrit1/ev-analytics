/**
 * Seed providers returned by MSW when local mock mode hydrates Supabase data.
 */
export const mockProviders = [
  { id: 'p1', user_id: 'mock-user-id', name: 'Tesla', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'p2', user_id: 'mock-user-id', name: 'EnBW', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

/**
 * Seed charging plans mirror flattened pricing columns persisted in Supabase.
 */
export const mockChargingPlans = [
  {
    id: 'cp1',
    user_id: 'mock-user-id',
    provider_id: 'p1',
    name: 'Supercharger',
    valid_from: new Date(),
    valid_to: null,
    ac_price_per_kwh: 45,
    dc_price_per_kwh: 45,
    roaming_ac_price_per_kwh: null,
    roaming_dc_price_per_kwh: null,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'cp2',
    user_id: 'mock-user-id',
    provider_id: 'p2',
    name: 'mobility+ ADAC',
    valid_from: new Date(),
    valid_to: null,
    ac_price_per_kwh: 51,
    dc_price_per_kwh: 61,
    roaming_ac_price_per_kwh: 59,
    roaming_dc_price_per_kwh: 69,
    monthly_base_fee: 0,
    session_fee: 0,
    affiliation: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

/**
 * Seed charging sessions include charging-plan/ad-hoc snapshots so history and sync flows
 * behave like production data during local development.
 */
export const mockSessions = [
  {
    id: 's1',
    user_id: 'mock-user-id',
    session_timestamp: new Date().toISOString(),
    provider_id: 'p1',
    provider_name_snapshot: 'Tesla',
    tariff_plan_id: 'cp1',
    charging_plan_name_snapshot: 'Supercharger',
    charging_type: 'DC',
    kwh_billed: 45.2,
    total_cost: 2034,
    session_mode: 'plan',
    plan_selection_id: 'ps1',
    price_snapshot: { label: 'Tesla Supercharger', kWhPrice: 45, sessionFee: 0 },
    start_soc_percentage: 15,
    end_soc_percentage: 80,
    applied_ac_price_per_kwh: 45,
    applied_dc_price_per_kwh: 45,
    applied_session_fee: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 's2',
    user_id: 'mock-user-id',
    session_timestamp: new Date().toISOString(),
    provider_id: 'p2',
    provider_name_snapshot: 'EnBW',
    tariff_plan_id: null,
    charging_plan_name_snapshot: null,
    charging_type: 'AC',
    kwh_billed: 20,
    total_cost: 1020,
    session_mode: 'ad_hoc',
    plan_selection_id: null,
    price_snapshot: { label: 'Ad-Hoc', kWhPrice: 51, sessionFee: 0 },
    ad_hoc_pricing: {
      cpoName: 'EnBW',
      pricePerKwh: 51
    },
    applied_price_per_kwh: 51,
    applied_session_fee: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];
