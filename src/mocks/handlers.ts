import { http, HttpResponse, delay } from 'msw'
import { isMockMode, MOCK_SUPABASE_URL } from '../lib/mock-utils'
import { mockProviders, mockTariffs, mockSessions } from './seed-data'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || (isMockMode() ? MOCK_SUPABASE_URL : 'https://your-project.supabase.co')

/**
 * MSW handlers that emulate the small Supabase surface used in local mock mode.
 *
 * The handlers preserve auth, REST reads, and write acknowledgements so the
 * offline-first UI can be exercised without a live Supabase project.
 */
export const handlers = [
  // Mock password-auth token exchange.
  http.post(`${SUPABASE_URL}/auth/v1/token`, async () => {
    await delay(500)
    return HttpResponse.json({
      access_token: 'mock-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'mock-refresh-token',
      user: {
        id: 'mock-user-id',
        email: 'tester@local.dev',
        role: 'authenticated',
      },
    })
  }),

  // Accept generic database writes so outbox replay can complete in mock mode.
  http.post(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(800)
    return new HttpResponse(null, { status: 201 })
  }),

  // Return seeded rows for initialSync hydration.
  http.get(`${SUPABASE_URL}/rest/v1/providers`, async () => {
    await delay(300)
    return HttpResponse.json(mockProviders)
  }),
  http.get(`${SUPABASE_URL}/rest/v1/tariffs`, async () => {
    await delay(300)
    return HttpResponse.json(mockTariffs)
  }),
  http.get(`${SUPABASE_URL}/rest/v1/charging_sessions`, async () => {
    await delay(300)
    return HttpResponse.json(mockSessions)
  }),
  
  // Unknown tables return an empty collection rather than failing development.
  http.get(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(300)
    return HttpResponse.json([])
  }),
]
