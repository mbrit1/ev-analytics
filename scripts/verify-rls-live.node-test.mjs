import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createClient, parseArgs, resolveConfig, runVerification } from './verify-rls-live.mjs'

const user1 = { id: '11111111-1111-1111-1111-111111111111', token: 'owner-secret-token' }
const user2 = { id: '22222222-2222-2222-2222-222222222222', token: 'other-secret-token' }
const ids = {
  providers: ['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'],
  charging_plans: ['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002'],
  charging_sessions: ['60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002'],
}

function jsonResponse(status, json) {
  return { ok: status >= 200 && status < 300, status, json: async () => json }
}

/** Builds a deterministic RLS-aware REST mock with no network boundary. */
function createFetchMock() {
  const rows = new Map()
  const calls = []
  const next = new Map(Object.entries(ids).map(([table, values]) => [table, [...values]]))
  const tokenUser = new Map([[user1.token, user1.id], [user2.token, user2.id]])
  const foreignKeys = {
    charging_plans: ['provider_id'],
    provider_plan_selections: ['provider_id', 'tariff_plan_id'],
    charging_sessions: ['provider_id', 'tariff_plan_id', 'plan_selection_id'],
  }
  const rowFor = (table, id) => rows.get(table)?.get(id)
  const ownForeignKeys = (table, body) => (foreignKeys[table] || []).every((field) => {
    const value = body[field]
    if (!value) return true
    const sourceTable = field === 'provider_id' ? 'providers' : field === 'tariff_plan_id' ? 'charging_plans' : 'provider_plan_selections'
    return rowFor(sourceTable, value)?.user_id === body.user_id
  })

  return {
    calls,
    fetch: async (input, init = {}) => {
      const url = new URL(input)
      if (url.pathname === '/auth/v1/token') {
        const { email } = JSON.parse(init.body)
        const user = email === 'owner@example.test' ? user1 : user2
        calls.push({ kind: 'auth', email })
        return jsonResponse(200, { access_token: user.token, user: { id: user.id } })
      }
      const table = url.pathname.split('/').at(-1)
      const method = init.method || 'GET'
      const token = init.headers.Authorization?.replace('Bearer ', '')
      const actor = tokenUser.get(token)
      const id = url.searchParams.get('id')?.replace('eq.', '')
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ kind: 'rest', table, method, actor, id, body })
      if (!actor) return jsonResponse(401, { message: 'unauthenticated' })
      rows.set(table, rows.get(table) || new Map())
      if (method === 'POST') {
        const value = body[0]
        if (value.user_id !== actor || !ownForeignKeys(table, value)) return jsonResponse(403, { message: 'denied' })
        const row = { ...value, id: value.id || next.get(table).shift(), notes: value.notes }
        rows.get(table).set(row.id, row)
        return jsonResponse(201, [row])
      }
      const row = id ? rows.get(table).get(id) : undefined
      if (method === 'GET') return jsonResponse(200, row?.user_id === actor ? [row] : [])
      if (method === 'PATCH') {
        if (row?.user_id === actor) Object.assign(row, body)
        return jsonResponse(200, row?.user_id === actor ? [row] : [])
      }
      if (method === 'DELETE') {
        if (row?.user_id === actor) rows.get(table).delete(id)
        return jsonResponse(204, [])
      }
      throw new Error(`Unexpected method ${method}`)
    },
  }
}

/** Test suite for the dependency-aware, live RLS authorization verifier. */
describe('verify-rls-live', () => {
  it('schedules the full authorization matrix with owner-scoped foreign-key probes and reverse cleanup', async () => {
    // Arrange: Use a deterministic in-memory HTTP boundary for two authenticated users.
    const mock = createFetchMock()
    const logs = []
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })

    // Act: Exercise every request and assertion path without network access.
    await runVerification({ config, fetchImpl: mock.fetch, log: (message) => logs.push(message), idFactory: (() => {
      const values = ['50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002']
      return () => values.shift()
    })() })

    // Assert: Each domain table receives anonymous, owner, cross-user, and spoofing probes.
    for (const table of ['providers', 'charging_plans', 'provider_plan_selections', 'charging_sessions']) {
      const calls = mock.calls.filter((call) => call.kind === 'rest' && call.table === table)
      assert.ok(calls.some((call) => call.method === 'GET' && !call.actor), `${table} lacks anonymous read`)
      assert.ok(calls.some((call) => call.method === 'PATCH' && call.actor === user1.id), `${table} lacks owner update`)
      assert.ok(calls.some((call) => call.method === 'DELETE' && call.actor === user1.id), `${table} lacks owner delete`)
      assert.ok(calls.some((call) => call.method === 'GET' && call.actor === user2.id), `${table} lacks cross-user read`)
      assert.ok(calls.some((call) => call.method === 'PATCH' && call.actor === user2.id), `${table} lacks cross-user update`)
      assert.ok(calls.some((call) => call.method === 'DELETE' && call.actor === user2.id), `${table} lacks cross-user delete`)
      assert.ok(calls.some((call) => call.method === 'POST' && call.actor === user1.id && call.body[0].user_id === user2.id), `${table} lacks spoofed ownership insert`)
    }
    const crossOwner = mock.calls.filter((call) => call.kind === 'rest' && call.method === 'POST' && call.actor === user1.id && call.body[0].user_id === user1.id)
    const ownerPlan = crossOwner.find((call) => call.table === 'charging_plans' && call.body[0].provider_id === ids.providers[0])
    const ownerSelection = crossOwner.find((call) => call.table === 'provider_plan_selections' && call.body[0].provider_id === ids.providers[0] && call.body[0].tariff_plan_id === ids.charging_plans[0])
    const ownerSession = crossOwner.find((call) => call.table === 'charging_sessions' && call.body[0].provider_id === ids.providers[0] && call.body[0].tariff_plan_id === ids.charging_plans[0])
    assert.deepEqual(ownerPlan.body[0].affiliation, { source: 'rls-verifier' })
    assert.deepEqual(ownerSelection.body[0].price_snapshot, { ac_price_per_kwh: 45, session_fee: 0 })
    assert.equal(ownerSession.body[0].session_mode, 'plan')
    assert.equal(ownerSession.body[0].applied_session_fee, 0)
    assert.ok(crossOwner.some((call) => call.table === 'charging_plans' && call.body[0].provider_id === ids.providers[1]))
    assert.ok(crossOwner.some((call) => call.table === 'provider_plan_selections' && call.body[0].tariff_plan_id === ids.charging_plans[1]))
    assert.ok(crossOwner.some((call) => call.table === 'charging_sessions' && call.body[0].plan_selection_id === '50000000-0000-0000-0000-000000000002'))
    const cleanup = mock.calls.filter((call) => call.kind === 'rest' && call.method === 'DELETE' && call.actor === user1.id).slice(-4).map((call) => call.table)
    assert.deepEqual(cleanup, ['charging_sessions', 'provider_plan_selections', 'charging_plans', 'providers'])
    assert.ok(logs.some((line) => line.includes('foreign keys reject')))
    assert.ok(logs.every((line) => !line.includes(user1.token) && !line.includes(user2.token)))
  })

  it('keeps CLI and environment parsing compatible without exposing secrets in configuration failures', async () => {
    // Arrange: Provide the established flag spellings and a deliberately secret-looking value.
    const args = parseArgs(['node', 'verify-rls-live.mjs', '--url', 'https://example.test', '--key', 'secret-key', '--email', 'a@example.test', '--password', 'secret-password', '--other-email', 'b@example.test', '--other-password', 'other-secret'])

    // Act: Resolve the values through the public parsing seam.
    const config = resolveConfig(args, {})

    // Assert: All legacy inputs resolve, while user-facing failures contain no values.
    assert.equal(config.anonKey, 'secret-key')
    assert.equal(config.user2Email, 'b@example.test')
    await assert.rejects(runVerification({ config: { ...config, supabaseUrl: undefined } }), (error) => !error.message.includes('secret'))
  })

  it('redacts authentication response bodies from expected failures', async () => {
    // Arrange: Return a response body that deliberately contains a token-like value.
    const client = createClient({
      supabaseUrl: 'https://example.test',
      anonKey: 'publishable-key',
      fetchImpl: async () => jsonResponse(401, { access_token: 'response-secret-token', message: 'bad password' }),
    })

    // Act and assert: The boundary reports only a safe status-based failure.
    await assert.rejects(client.signIn('owner@example.test', 'owner-password'), (error) => {
      assert.equal(error.message, 'Sign-in failed: status=401')
      return true
    })
  })
})
