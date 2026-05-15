export const mockProviders = [
  { id: 'p1', user_id: 'mock-user-id', name: 'Tesla', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'p2', user_id: 'mock-user-id', name: 'EnBW', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

export const mockTariffs = [
  { id: 't1', user_id: 'mock-user-id', provider_id: 'p1', tariff_name: 'Supercharger', ac_price_per_kwh: 45, dc_price_per_kwh: 45, session_fee: 0, valid_from: new Date('2023-01-01').toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 't2', user_id: 'mock-user-id', provider_id: 'p2', tariff_name: 'mobility+ ADAC', ac_price_per_kwh: 51, dc_price_per_kwh: 51, session_fee: 0, valid_from: new Date('2023-01-01').toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];

export const mockSessions = [
  { id: 's1', user_id: 'mock-user-id', session_timestamp: new Date().toISOString(), provider_id: 'p1', provider_name: 'Tesla', tariff_id: 't1', tariff_name: 'Supercharger', location_type: 'Fast Charger', charging_type: 'DC', kwh_billed: 45.2, total_cost: 2034, start_soc_percentage: 15, end_soc_percentage: 80, applied_ac_price: 45, applied_dc_price: 45, applied_session_fee: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
];
