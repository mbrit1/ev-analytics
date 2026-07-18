import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Test suite for mock Supabase handler registration.
 *
 * Verifies explicit mock mode cannot be redirected by local live credentials.
 */
describe('mock Supabase handlers', () => {
  afterEach(() => {
    vi.doUnmock('../infra/mocks')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses the synthetic mock origin when live Supabase configuration exists', async () => {
    // Arrange: Simulate a developer with valid live credentials who explicitly enables mocks.
    vi.stubEnv('VITE_SUPABASE_URL', 'https://configured.supabase.test')
    vi.doMock('../infra/mocks', () => ({
      isMockMode: () => true,
      MOCK_SUPABASE_URL: 'https://mock.supabase.test',
    }))

    // Act: Register the handlers under that explicit mock-mode environment.
    const { handlers } = await import('./handlers')
    const paths = handlers.map((handler) => String(handler.info.path))

    // Assert: Every Supabase endpoint follows the same synthetic origin as the mock client.
    expect(paths).toContain('https://mock.supabase.test/rest/v1/providers')
    expect(paths).not.toContain('https://configured.supabase.test/rest/v1/providers')
  })
})
