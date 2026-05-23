/**
 * Seed providers returned by MSW when local mock mode hydrates Supabase data.
 */
export const mockProviders = [
  { id: 'p1', user_id: 'mock-user-id', name: 'Tesla', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'p2', user_id: 'mock-user-id', name: 'EnBW', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

/**
 * Seed charging plans mirror nested pricing/fees payloads persisted in Supabase.
 */
export const mockChargingPlans = [
  {
    id: 'cp1',
    user_id: 'mock-user-id',
    provider_id: 'p1',
    plan_name: 'Supercharger',
    validity: { from: new Date('2023-01-01').toISOString() },
    prices: { domestic: { ac: 45, dc: 45 } },
    fees: { sessionFixed: 0 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'cp2',
    user_id: 'mock-user-id',
    provider_id: 'p2',
    plan_name: 'mobility+ ADAC',
    validity: { from: new Date('2023-01-01').toISOString() },
    prices: { domestic: { ac: 51, dc: 61 }, roaming: { ac: 59, dc: 69 } },
    fees: { sessionFixed: 0 },
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
    provider_name: 'Tesla',
    charging_plan_id: 'cp1',
    charging_plan_name: 'Supercharger',
    charging_type: 'DC',
    kwh_billed: 45.2,
    total_cost: 2034,
    session_mode: 'plan',
    tariff_plan_id: 'cp1',
    plan_selection_id: 'ps1',
    price_snapshot: { label: 'Tesla Supercharger', kWhPrice: 45, sessionFee: 0 },
    pricing_source: 'chargingPlan',
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
    provider_name: 'EnBW',
    charging_plan_id: null,
    charging_plan_name: null,
    charging_type: 'AC',
    kwh_billed: 20,
    total_cost: 1020,
    session_mode: 'adHoc',
    tariff_plan_id: null,
    plan_selection_id: null,
    price_snapshot: { label: 'Ad-Hoc', kWhPrice: 51, sessionFee: 0 },
    pricing_source: 'adHoc',
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
