import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { createClient } from '@supabase/supabase-js'
import { MOCK_AUTH_CREDENTIALS } from '../infra/mocks/mockAuth'

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

  it('applies PostgREST equality and in filters to seeded reads', async () => {
    // Arrange: Register the handlers against an isolated local MSW server.
    vi.doMock('../infra/mocks', () => ({
      isMockMode: () => true,
      MOCK_SUPABASE_URL: 'https://mock.supabase.test',
    }))
    const { applyPostgrestFilters, handlers } = await import('./handlers')
    const server = setupServer(...handlers)
    server.listen({ onUnhandledRequest: 'error' })

    try {
      // Act: Use the same query syntax emitted by the Supabase client.
      const providersResponse = await fetch(
        'https://mock.supabase.test/rest/v1/providers?name=eq.Tesla',
      )
      const sessionsResponse = await fetch(
        'https://mock.supabase.test/rest/v1/charging_sessions?id=in.(s1,s5)',
      )
      const plansResponse = await fetch(
        'https://mock.supabase.test/rest/v1/charging_plans?provider_id=eq.p1',
      )
      const providersWithDeletedRow = applyPostgrestFilters([
        { id: 'active', deleted_at: null },
        { id: 'deleted', deleted_at: '2026-09-03T00:00:00.000Z' },
      ], new Request('https://mock.supabase.test/rest/v1/providers?deleted_at=is.null'))

      // Assert: Only matching rows are returned from each resource.
      expect(await providersResponse.json()).toEqual([
        expect.objectContaining({ id: 'p1', name: 'Tesla' }),
      ])
      expect(await sessionsResponse.json()).toEqual([
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ id: 's5' }),
      ])
      expect(await plansResponse.json()).toEqual([
        expect.objectContaining({ id: 'cp1', provider_id: 'p1' }),
      ])
      expect(providersWithDeletedRow).toEqual([{ id: 'active', deleted_at: null }])
    } finally {
      server.close()
    }
  })

  it('supports verified-user rechecks for the seeded mock session', async () => {
    // Arrange: Start the real Supabase client against the local MSW auth boundary.
    vi.doMock('../infra/mocks', () => ({
      isMockMode: () => true,
      MOCK_SUPABASE_URL: 'https://mock.supabase.test',
    }))
    const { handlers } = await import('./handlers')
    const server = setupServer(...handlers)
    server.listen({ onUnhandledRequest: 'error' })
    const client = createClient('https://mock.supabase.test', 'mock-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    try {
      // Act: Seed the client like AuthProvider, then perform the recovery preflight.
      const seeded = await client.auth.setSession(MOCK_AUTH_CREDENTIALS)
      const { data, error } = await client.auth.getUser()

      // Assert: A structurally valid JWT and user endpoint establish the shared identity.
      expect(seeded.error).toBeNull()
      expect(error).toBeNull()
      expect(data.user).toMatchObject({
        id: 'mock-user-id',
        email: 'tester@local.dev',
      })
    } finally {
      server.close()
    }
  })
})
