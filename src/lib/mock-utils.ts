export const MOCK_SUPABASE_URL = 'https://mock.supabase.co';

export const isMockMode = (): boolean => {
  return (
    import.meta.env.DEV && 
    import.meta.env.VITE_ENABLE_MOCKS === 'true'
  );
};
