import { afterEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.hoisted(() => vi.fn(() => ({ auth: {}, from: vi.fn() })));
const isMockModeMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

vi.mock('../mocks', () => ({
  isMockMode: isMockModeMock,
  MOCK_SUPABASE_URL: 'https://mock.supabase.co',
}));

/**
 * Test suite for Supabase client bootstrap configuration.
 *
 * Ensures non-mock environments fail closed when credentials are missing and
 * mock mode uses deterministic local-only defaults.
 */
describe('supabase client bootstrap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    isMockModeMock.mockReturnValue(false);
  });

  it('throws outside mock mode when URL is missing', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-key');
    isMockModeMock.mockReturnValue(false);

    await expect(import('./client')).rejects.toThrow(
      'Missing Supabase configuration: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required outside mock mode.'
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('throws outside mock mode when publishable key is missing', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    isMockModeMock.mockReturnValue(false);

    await expect(import('./client')).rejects.toThrow(
      'Missing Supabase configuration: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required outside mock mode.'
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('creates client with configured URL and key outside mock mode', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-key');
    isMockModeMock.mockReturnValue(false);

    const module = await import('./client');

    expect(module.supabase).toBeDefined();
    expect(createClientMock).toHaveBeenCalledWith('https://project.supabase.co', 'public-key');
  });

  it('uses mock defaults in mock mode when env vars are missing', async () => {
    vi.unstubAllEnvs();
    isMockModeMock.mockReturnValue(true);

    const module = await import('./client');

    expect(module.supabase).toBeDefined();
    expect(createClientMock).toHaveBeenCalledWith('https://mock.supabase.co', 'mock-key');
  });
});
