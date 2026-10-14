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

function makeIdFactory(values = []) {
  let fallback = 0
  return () => values.shift() || `70000000-0000-0000-0000-${String(++fallback).padStart(12, '0')}`
}

/** Builds a deterministic RLS-aware REST mock with no network boundary. */
function createFetchMock({ crossUserPatchTable, overrideRequest } = {}) {
  const rows = new Map()
  const calls = []
  const next = new Map(Object.entries(ids).map(([table, values]) => [table, [...values]]))
  const tokenUser = new Map([[user1.token, user1.id], [user2.token, user2.id]])
  const foreignKeys = {
    charging_plans: ['provider_id'],
    provider_plan_selections: ['provider_id', 'tariff_plan_id'],
    charging_sessions: ['provider_id', 'tariff_plan_id', 'plan_selection_id'],
  }
  const foreignKeyConstraints = {
    charging_plans: { provider_id: 'charging_plans_user_provider_fkey' },
    provider_plan_selections: {
      provider_id: 'provider_plan_selections_user_provider_fkey',
      tariff_plan_id: 'provider_plan_selections_user_tariff_plan_fkey',
    },
    charging_sessions: {
      provider_id: 'sessions_user_provider_fkey',
      tariff_plan_id: 'sessions_user_tariff_plan_fkey',
      plan_selection_id: 'sessions_user_plan_selection_fkey',
    },
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
      const request = { kind: 'rest', table, method, actor, id, body, headers: init.headers || {} }
      calls.push(request)
      const override = overrideRequest?.(request)
      if (override) return override
      if (!actor) return jsonResponse(401, { message: 'unauthenticated' })
      rows.set(table, rows.get(table) || new Map())
      if (method === 'POST') {
        const value = body[0]
        if (value.user_id !== actor) return jsonResponse(403, { code: '42501', message: 'new row violates row-level security policy' })
        if (!ownForeignKeys(table, value)) {
          const field = foreignKeys[table].find((candidate) => {
            const value = body[0][candidate]
            if (!value) return false
            const sourceTable = candidate === 'provider_id' ? 'providers' : candidate === 'tariff_plan_id' ? 'charging_plans' : 'provider_plan_selections'
            return rowFor(sourceTable, value)?.user_id !== body[0].user_id
          })
          return jsonResponse(409, {
            code: '23503',
            message: `insert or update violates foreign key constraint "${foreignKeyConstraints[table][field]}"`,
          })
        }
        const row = { ...value, id: value.id || next.get(table).shift() }
        if (rows.get(table).has(row.id)) return jsonResponse(409, { code: '23505', message: `duplicate key violates primary key constraint "${table}_pkey"` })
        rows.get(table).set(row.id, row)
        return jsonResponse(201, [row])
      }
      const row = id ? rows.get(table).get(id) : undefined
      if (method === 'GET') return jsonResponse(200, row?.user_id === actor ? [row] : [])
      if (method === 'PATCH') {
        const mutableFields = {
          providers: ['name'],
          charging_plans: ['notes'],
          provider_plan_selections: ['price_snapshot'],
          charging_sessions: ['notes'],
        }[table] || []
        if (Object.keys(body).some((field) => !mutableFields.includes(field))) {
          return jsonResponse(400, { message: 'column does not exist' })
        }
        if (row?.user_id === actor || (table === crossUserPatchTable && actor === user2.id)) Object.assign(row, body)
        return jsonResponse(200, row?.user_id === actor ? [row] : [])
      }
      if (method === 'DELETE') {
        if (row?.user_id === actor) {
          rows.get(table).delete(id)
          return jsonResponse(200, [row])
        }
        return jsonResponse(200, [])
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
    await runVerification({ config, fetchImpl: mock.fetch, log: (message) => logs.push(message), idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) })

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
    const updateCalls = mock.calls.filter((call) => call.kind === 'rest' && call.method === 'PATCH')
    const ownerUpdates = Object.fromEntries(updateCalls.filter((call) => call.actor === user1.id).map((call) => [call.table, call.body]))
    const otherUpdates = Object.fromEntries(updateCalls.filter((call) => call.actor === user2.id).map((call) => [call.table, call.body]))
    assert.deepEqual(ownerUpdates, {
      providers: { name: 'RLS probe owner provider updated' },
      charging_plans: { notes: 'owner update charging_plans' },
      provider_plan_selections: { price_snapshot: { ac_price_per_kwh: 46, session_fee: 0 } },
      charging_sessions: { notes: 'owner update charging_sessions' },
    })
    assert.deepEqual(otherUpdates, {
      providers: { name: 'RLS probe other provider updated' },
      charging_plans: { notes: 'cross-user update charging_plans' },
      provider_plan_selections: { price_snapshot: { ac_price_per_kwh: 47, session_fee: 0 } },
      charging_sessions: { notes: 'cross-user update charging_sessions' },
    })
    assert.ok(logs.some((line) => line.includes('foreign keys reject')))
    assert.ok(logs.every((line) => !line.includes(user1.token) && !line.includes(user2.token)))
  })

  it('requires spoofed inserts to fail with the authenticated RLS permission error', async () => {
    // Arrange: Replace only the owner's spoofed provider insert with unrelated failures.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    for (const denial of [
      { status: 500, body: { code: 'XX000', message: 'internal error' } },
      { status: 403, body: { code: 'PGRST301', message: 'JWT claim invalid' } },
    ]) {
      const base = createFetchMock()
      const fetchImpl = async (input, init = {}) => {
        if (new URL(input).pathname === '/rest/v1/providers' && init.method === 'POST'
          && init.headers?.Authorization === `Bearer ${user1.token}`) {
          const value = JSON.parse(init.body)[0]
          if (value.user_id === user2.id) return jsonResponse(denial.status, denial.body)
        }
        return base.fetch(input, init)
      }

      // Act and assert: Generic failures cannot stand in for an RLS denial.
      await assert.rejects(runVerification({ config, fetchImpl, idFactory: makeIdFactory([
        '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
      ]) }), /Spoofed ownership insert into providers/)
    }
  })

  it('requires each cross-owner reference to fail with its matching foreign-key violation', async () => {
    // Arrange: Return unrelated SQLSTATE and constraint failures for the provider reference probe.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    for (const failure of [
      { status: 500, body: { code: 'XX000', message: 'internal error' } },
      { status: 409, body: { code: '23505', message: 'duplicate key violates primary key constraint "charging_plans_pkey"' } },
      { status: 409, body: { code: '23503', message: 'foreign key violation for constraint "charging_plans_pkey"' } },
    ]) {
      const mock = createFetchMock({ overrideRequest: (request) => {
        if (request.table === 'charging_plans' && request.method === 'POST' && request.actor === user1.id
          && request.body[0].provider_id === ids.providers[1]) return jsonResponse(failure.status, failure.body)
        return undefined
      } })

      // Act and assert: A PK conflict or the wrong FK does not prove ownership scoping.
      await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
        '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
      ]) }), /Cross-owner foreign key \(charging_plans provider\)/)
    }
  })

  it('uses fresh unique ids for every negative insert even when the selection id ends in e or f', async () => {
    // Arrange: Choose a valid selection id that collides with one of the old derived probe ids.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const ownerSelectionId = '50000000-0000-0000-0000-00000000000e'
    const otherSelectionId = '50000000-0000-0000-0000-00000000000f'
    const mock = createFetchMock()

    // Act: Run the full matrix with the collision-prone selection ids.
    await runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([ownerSelectionId, otherSelectionId]) })

    // Assert: Each explicit selection id in a negative insert is distinct from created rows and sibling probes.
    const ownerSelectionIds = mock.calls
      .filter((call) => call.method === 'POST' && call.body?.[0]?.user_id === user1.id)
      .map((call) => call.body[0].id)
      .filter(Boolean)
    const allExplicitSelectionIds = mock.calls
      .filter((call) => call.method === 'POST' && call.table === 'provider_plan_selections')
      .map((call) => call.body[0].id)
    assert.equal(new Set(allExplicitSelectionIds).size, allExplicitSelectionIds.length)
    assert.ok(ownerSelectionIds.includes(ownerSelectionId))
    assert.ok(allExplicitSelectionIds.includes(otherSelectionId))
  })

  it('fails closed when the selection id factory returns a malformed or repeated UUID', async () => {
    // Arrange: Use valid authenticated users while returning invalid allocator values.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })

    // Act and assert: Invalid identifiers fail before any REST writes are issued.
    for (const [idFactory, message] of [
      [() => 'malformed-id', /malformed UUID/],
      [(() => { let count = 0; return () => count++ === 0
        ? '50000000-0000-0000-0000-00000000000e'
        : '50000000-0000-0000-0000-00000000000e'.toUpperCase() })(), /duplicate UUID/],
    ]) {
      const mock = createFetchMock()
      await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory }), message)
      assert.equal(mock.calls.filter((call) => call.kind === 'rest').length, 0)
    }
  })

  it('requires cross-user mutation requests to succeed with an empty representation', async () => {
    // Arrange: Fail the cross-user PATCH request despite preserving the owner's row.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const mock = createFetchMock({ overrideRequest: (request) => {
      if (request.table === 'providers' && request.method === 'PATCH' && request.actor === user2.id) {
        return jsonResponse(500, { message: 'server failure' })
      }
      if (request.method === 'DELETE' && request.actor === user1.id) return jsonResponse(500, { message: 'cleanup failure' })
      return undefined
    } })
    // Act and assert: A request error cannot be interpreted as successful RLS filtering.
    await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Cross-user update request for providers.*Probe cleanup also failed/)
    assert.ok(mock.calls.some((call) => call.method === 'DELETE' && call.actor === user2.id), 'Other-owner cleanup was not attempted after owner cleanup failed.')
  })

  it('rejects a successful cross-user PATCH that returns a row', async () => {
    // Arrange: Return a representation for the other user's PATCH of the owner row.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const mock = createFetchMock({ overrideRequest: (request) => request.table === 'providers'
      && request.method === 'PATCH' && request.actor === user2.id
      ? jsonResponse(200, [{ id: request.id }]) : undefined })

    // Act and assert: Successful RLS-filtered updates must return no rows.
    await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Cross-user update of providers returned a row/)
  })

  it('requires cross-user deletes to succeed with the expected empty representation', async () => {
    // Arrange: Fail the cross-user DELETE request while leaving the owner's row untouched.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const mock = createFetchMock({ overrideRequest: (request) => request.table === 'providers'
      && request.method === 'DELETE' && request.actor === user2.id && request.id === ids.providers[0]
      ? jsonResponse(500, { message: 'server failure' }) : undefined })
    // Act and assert: A failed request cannot count as successful RLS filtering.
    await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Cross-user delete request for providers/)
  })

  it('rejects a successful cross-user DELETE that returns a row', async () => {
    // Arrange: Return a representation for the other user's DELETE of the owner row.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const mock = createFetchMock({ overrideRequest: (request) => request.table === 'providers'
      && request.method === 'DELETE' && request.actor === user2.id && request.id === ids.providers[0]
      ? jsonResponse(200, [{ id: request.id }]) : undefined })

    // Act and assert: Successful RLS-filtered deletes must return no rows.
    await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Cross-user delete of providers returned a row/)
  })

  it('requires owner cleanup to return the deleted row and leave it absent', async () => {
    // Arrange: Return an empty successful representation for the owner cleanup delete.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const mock = createFetchMock({ overrideRequest: (request) => request.table === 'charging_sessions'
      && request.method === 'DELETE' && request.actor === user1.id
      ? jsonResponse(200, []) : undefined })
    // Act and assert: Cleanup must prove it removed the owner row.
    await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Cleanup delete from charging_sessions did not return the deleted row/)
    const deleteIndex = mock.calls.findIndex((call) => call.table === 'charging_sessions'
      && call.method === 'DELETE' && call.actor === user1.id)
    assert.ok(mock.calls.slice(deleteIndex + 1).some((call) => call.table === 'charging_sessions'
      && call.method === 'GET' && call.actor === user1.id && call.id === ids.charging_sessions[0]),
    'Cleanup did not verify the owner row was absent after the delete response.')
  })

  it('rejects cleanup that returns a deleted row while leaving it present', async () => {
    // Arrange: Return a plausible deleted row without removing it from the fake database.
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const mock = createFetchMock({ overrideRequest: (request) => request.table === 'charging_sessions'
      && request.method === 'DELETE' && request.actor === user1.id
      ? jsonResponse(200, [{ id: request.id }]) : undefined })

    // Act and assert: The follow-up owner read must prove cleanup removed the row.
    await assert.rejects(runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Cleanup left the charging_sessions probe row behind/)
  })

  it('detects cross-user changes to each table-specific owner mutation field', async () => {
    // Arrange: Make one cross-user update bypass the mock policy for each domain table.
    const values = ['50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002']
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })

    // Act and assert: Every table-specific equality check detects a changed owner value.
    for (const [table, valueField] of [
      ['providers', 'name'],
      ['charging_plans', 'notes'],
      ['provider_plan_selections', 'price_snapshot'],
      ['charging_sessions', 'notes'],
    ]) {
      const mock = createFetchMock({ crossUserPatchTable: table })
      await assert.rejects(
        runVerification({ config, fetchImpl: mock.fetch, idFactory: makeIdFactory(values) }),
        new RegExp(`Cross-user update changed the ${table} owner row\\.`),
        `${table}.${valueField} should be checked after a cross-user update`,
      )
      values.push('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002')
    }
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

  it('accepts an anonymous read denied with PostgreSQL insufficient_privilege code 42501', async () => {
    // Arrange: Deny only the anonymous REST read with PostgreSQL's permission error.
    const mock = createFetchMock()
    const logs = []
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const fetchImpl = async (input, init = {}) => {
      const url = new URL(input)
      if (url.pathname === '/rest/v1/providers' && !init.headers?.Authorization) {
        return jsonResponse(403, { code: '42501', message: 'permission denied for table providers' })
      }
      return mock.fetch(input, init)
    }

    // Act: Run the normal verifier with that single expected-denial response.
    await runVerification({ config, fetchImpl, log: (message) => logs.push(message), idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) })

    // Assert: The verifier accepts the grant-level denial and continues its matrix.
    assert.ok(logs.some((line) => line.includes('[ok] providers: anonymous denial')))
    assert.ok(logs.some((line) => line.includes('[ok] charging_sessions: anonymous denial')))
  })

  it('rejects an anonymous 403 that does not carry code 42501', async () => {
    // Arrange: Return an unrelated authorization failure for the anonymous read.
    const mock = createFetchMock()
    const config = resolveConfig({}, {
      SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
      RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
      RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
    })
    const fetchImpl = async (input, init = {}) => {
      const url = new URL(input)
      if (url.pathname === '/rest/v1/providers' && !init.headers?.Authorization) {
        return jsonResponse(403, { code: 'PGRST301', message: 'JWT claim invalid' })
      }
      return mock.fetch(input, init)
    }

    // Act and assert: An unrelated 403 must remain a failed authorization check.
    await assert.rejects(runVerification({ config, fetchImpl, idFactory: makeIdFactory([
      '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
    ]) }), /Unauthenticated read exposed providers rows\./)
  })

  it('accepts an empty 200 anonymous read and rejects a nonempty 200 response', async () => {
    // Arrange: Run the verifier with a chosen response for its anonymous providers read.
    const runWithAnonymousResponse = async (anonymousResponse) => {
      const mock = createFetchMock()
      const logs = []
      const config = resolveConfig({}, {
        SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'publishable-test-key',
        RLS_USER1_EMAIL: 'owner@example.test', RLS_USER1_PASSWORD: 'owner-password',
        RLS_USER2_EMAIL: 'other@example.test', RLS_USER2_PASSWORD: 'other-password',
      })
      const fetchImpl = async (input, init = {}) => {
        const url = new URL(input)
        if (url.pathname === '/rest/v1/providers' && !init.headers?.Authorization) return anonymousResponse
        return mock.fetch(input, init)
      }
      await runVerification({ config, fetchImpl, log: (message) => logs.push(message), idFactory: makeIdFactory([
        '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
      ]) })
      return logs
    }

    // Act: Verify both empty and row-bearing successful HTTP responses.
    const logs = await runWithAnonymousResponse(jsonResponse(200, []))

    // Assert: Empty results pass, while any exposed anonymous row fails verification.
    assert.ok(logs.some((line) => line.includes('[ok] providers: anonymous denial')))
    await assert.rejects(
      runWithAnonymousResponse(jsonResponse(200, [{ id: 'unexpected-row' }])),
      /Unauthenticated read exposed providers rows\./,
    )
  })
})
