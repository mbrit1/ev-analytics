import { http, HttpResponse, delay } from 'msw'
import { isMockMode, MOCK_SUPABASE_URL } from '../infra/mocks'
import { MOCK_AUTH_CREDENTIALS, MOCK_AUTH_SESSION, MOCK_AUTH_USER } from '../infra/mocks/mockAuth'
import { mockProviders, mockChargingPlans, mockSessions } from './seed-data'

const SUPABASE_URL = isMockMode()
  ? MOCK_SUPABASE_URL
  : import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'

type MockRow = Record<string, unknown>

/** Apply the PostgREST filter operators used by the synchronization reads. */
export function applyPostgrestFilters<T extends MockRow>(rows: readonly T[], request: Request): T[] {
  const params = new URL(request.url).searchParams
  return rows.filter((row) => Array.from(params.entries()).every(([column, expression]) => {
    if (column === 'select' || column.startsWith('order') || column.startsWith('limit')) return true
    if (expression.startsWith('eq.')) return String(row[column]) === expression.slice(3)
    if (expression.startsWith('in.(') && expression.endsWith(')')) {
      return expression.slice(4, -1).split(',').includes(String(row[column]))
    }
    if (expression === 'is.null') return row[column] == null
    return true
  }))
}

/**
 * MSW handlers that emulate the small Supabase surface used in local mock mode.
 *
 * The handlers preserve auth, REST reads, and write acknowledgements so the
 * offline-first UI can be exercised without a live Supabase project.
 */
export const handlers = [
  // Verify the structurally valid mock session before returning the mock user.
  http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
    if (request.headers.get('authorization') !== `Bearer ${MOCK_AUTH_CREDENTIALS.access_token}`) {
      return HttpResponse.json({ message: 'Invalid mock access token' }, { status: 401 })
    }
    return HttpResponse.json(MOCK_AUTH_USER)
  }),

  // Mock password-auth token exchange.
  http.post(`${SUPABASE_URL}/auth/v1/token`, async () => {
    await delay(500)
    return HttpResponse.json(MOCK_AUTH_SESSION)
  }),

  // Accept generic database writes so outbox replay can complete in mock mode.
  http.post(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(800)
    return new HttpResponse(null, { status: 201 })
  }),

  // Return seeded rows for initialSync hydration.
  http.get(`${SUPABASE_URL}/rest/v1/providers`, async ({ request }) => {
    await delay(300)
    return HttpResponse.json(applyPostgrestFilters(mockProviders, request))
  }),
  http.get(`${SUPABASE_URL}/rest/v1/charging_plans`, async ({ request }) => {
    await delay(300)
    return HttpResponse.json(applyPostgrestFilters(mockChargingPlans, request))
  }),
  http.get(`${SUPABASE_URL}/rest/v1/provider_plan_selections`, async ({ request }) => {
    await delay(300)
    return HttpResponse.json(applyPostgrestFilters([], request))
  }),
  http.get(`${SUPABASE_URL}/rest/v1/charging_sessions`, async ({ request }) => {
    await delay(300)
    return HttpResponse.json(applyPostgrestFilters(mockSessions, request))
  }),
  
  // Unknown tables return an empty collection rather than failing development.
  http.get(`${SUPABASE_URL}/rest/v1/*`, async () => {
    await delay(300)
    return HttpResponse.json([])
  }),
]
