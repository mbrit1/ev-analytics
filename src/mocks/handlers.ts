import { http, HttpResponse, delay } from 'msw'
import { isMockMode, MOCK_SUPABASE_URL } from '../lib/mock-utils'
import { mockProviders, mockTariffs, mockSessions } from './seed-data'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || (isMockMode() ? MOCK_SUPABASE_URL : 'https://your-project.supabase.co')

export const handlers = [
  // Mock Auth Token Request
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

  // Mock Generic Database Insert/Update
  http.post(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(800)
    return new HttpResponse(null, { status: 201 })
  }),

  // Mock Database Fetch
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
  
  // Fallback Generic Database Fetch
  http.get(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(300)
    return HttpResponse.json([])
  }),
]
