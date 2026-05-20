/**
 * Synthetic Supabase origin intercepted by MSW during local mock-mode runs.
 */
export const MOCK_SUPABASE_URL = 'https://mock.supabase.co';

/**
 * Indicates whether local mock auth/data handlers should replace real Supabase calls.
 *
 * Mock mode is intentionally limited to Vite development and an explicit env
 * flag so production builds cannot accidentally use seeded test data.
 */
export const isMockMode = (): boolean => {
  return (
    import.meta.env.DEV && 
    import.meta.env.VITE_ENABLE_MOCKS === 'true'
  );
};
