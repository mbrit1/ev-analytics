#!/usr/bin/env node

import { fileURLToPath } from 'node:url'

/**
 * Parses the verifier's established command-line flags without interpreting values.
 *
 * @param {string[]} argv Process-style argument list.
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv) {
  const out = {}
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      out[key] = true
      continue
    }
    out[key] = value
    index += 1
  }
  return out
}

/** @param {(message: string) => void} log */
export function printHelp(log = console.log) {
  log(`
verify-rls-live.mjs

Runs destructive authorization probes against a disposable Supabase test project.
Never point this command at production.

Required (args or env):
  --url                 (or SUPABASE_URL)
  --key                 (or SUPABASE_KEY / SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY)
  --email               (or RLS_USER1_EMAIL)
  --password            (or RLS_USER1_PASSWORD)

Optional second user (required for the complete cross-user verification matrix):
  --other-email         (or RLS_USER2_EMAIL)
  --other-password      (or RLS_USER2_PASSWORD)
`)
}

/**
 * Resolves the established CLI and environment configuration surface.
 *
 * @param {Record<string, string | boolean>} args
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveConfig(args, env) {
  return {
    supabaseUrl: args.url || env.SUPABASE_URL,
    anonKey: args.key || env.SUPABASE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY,
    user1Email: args.email || env.RLS_USER1_EMAIL,
    user1Password: args.password || env.RLS_USER1_PASSWORD,
    user2Email: args['other-email'] || env.RLS_USER2_EMAIL,
    user2Password: args['other-password'] || env.RLS_USER2_PASSWORD,
  }
}

/** @param {ReturnType<typeof resolveConfig>} config */
export function assertRequiredConfig(config) {
  if (!config.supabaseUrl) throw new Error('Provide --url or SUPABASE_URL')
  if (!config.anonKey) {
    throw new Error('Provide --key or SUPABASE_KEY/SUPABASE_ANON_KEY/VITE_SUPABASE_PUBLISHABLE_KEY')
  }
  if (!config.user1Email || !config.user1Password) {
    throw new Error('Provide --email/--password (or RLS_USER1_EMAIL/RLS_USER1_PASSWORD)')
  }
  if (Boolean(config.user2Email) !== Boolean(config.user2Password)) {
    throw new Error('Provide both --other-email and --other-password (or both RLS_USER2 values)')
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function safeFailure(operation, response) {
  return `${operation} failed: status=${response.status}`
}

function probePayloads(userId, ids, suffix) {
  const marker = `RLS probe ${suffix}`
  return {
    providers: { user_id: userId, name: `${marker} provider` },
    charging_plans: {
      user_id: userId,
      provider_id: ids.providerId,
      name: `${marker} plan`,
      valid_from: '2025-01-01',
      ac_price_per_kwh: 45,
      dc_price_per_kwh: 55,
      monthly_base_fee: 0,
      session_fee: 0,
      affiliation: { source: 'rls-verifier' },
    },
    provider_plan_selections: {
      id: ids.selectionId,
      user_id: userId,
      provider_id: ids.providerId,
      tariff_plan_id: ids.planId,
      valid_from: '2025-01-02T00:00:00.000Z',
      price_snapshot: { ac_price_per_kwh: 45, session_fee: 0 },
    },
    charging_sessions: {
      user_id: userId,
      session_timestamp: '2025-01-03T12:00:00.000Z',
      provider_id: ids.providerId,
      provider_name_snapshot: `${marker} provider`,
      charging_plan_name_snapshot: `${marker} plan`,
      charging_type: 'AC',
      kwh_billed: 12.5,
      kwh_added: 12.5,
      total_cost: 563,
      session_mode: 'plan',
      tariff_plan_id: ids.planId,
      plan_selection_id: ids.selectionId,
      price_snapshot: { ac_price_per_kwh: 45, session_fee: 0 },
      applied_price_per_kwh: 45,
      applied_ac_price_per_kwh: 45,
      applied_monthly_base_fee: 0,
      applied_session_fee: 0,
    },
  }
}

/**
 * Creates a transport that never logs or includes response bodies in errors.
 *
 * @param {{ supabaseUrl: string, anonKey: string, fetchImpl: typeof fetch }} options
 */
export function createClient({ supabaseUrl, anonKey, fetchImpl }) {
  const baseHeaders = { apikey: anonKey, 'Content-Type': 'application/json' }
  return {
    async signIn(email, password) {
      const response = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: baseHeaders, body: JSON.stringify({ email, password }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(`Sign-in failed: status=${response.status}`)
      return { accessToken: json?.access_token, userId: json?.user?.id }
    },
    async rest(path, { method = 'GET', token, headers = {}, body } = {}) {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, {
        method,
        headers: { ...baseHeaders, ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await response.json().catch(() => null)
      return { ok: response.ok, status: response.status, json }
    },
  }
}

async function readOne(client, table, id, token, message) {
  const response = await client.rest(`${table}?select=*&id=eq.${id}`, { token })
  assert(response.ok, safeFailure(message, response))
  assert(Array.isArray(response.json) && response.json.length === 1, message)
  return response.json[0]
}

async function assertOwnerRowUnchanged(client, table, id, token, expectedNotes) {
  const row = await readOne(client, table, id, token, `Owner could not read ${table} after cross-user mutation attempt.`)
  assert(row.notes === expectedNotes, `Cross-user update changed the ${table} owner row.`)
}

async function insertProbe(client, table, body, token) {
  const response = await client.rest(table, {
    method: 'POST', token, headers: { Prefer: 'return=representation' }, body: [body],
  })
  assert(response.ok, safeFailure(`Owner insert into ${table}`, response))
  assert(Array.isArray(response.json) && response.json.length === 1, `Owner insert into ${table} did not return one row.`)
  assert(response.json[0].id, `Owner insert into ${table} returned no id.`)
  return response.json[0]
}

async function verifyTableMatrix(client, table, owner, other, payload, ownerRow, log) {
  const id = ownerRow.id
  const anonymous = await client.rest(`${table}?select=id&limit=1`)
  assert(anonymous.status === 401 || (Array.isArray(anonymous.json) && anonymous.json.length === 0), `Unauthenticated read exposed ${table} rows.`)

  await readOne(client, table, id, owner.accessToken, `Owner could not read own ${table} row.`)
  const ownerUpdate = await client.rest(`${table}?id=eq.${id}`, {
    method: 'PATCH', token: owner.accessToken, headers: { Prefer: 'return=representation' }, body: { notes: `owner update ${table}` },
  })
  assert(ownerUpdate.ok, safeFailure(`Owner update of ${table}`, ownerUpdate))
  await assertOwnerRowUnchanged(client, table, id, owner.accessToken, `owner update ${table}`)

  const spoofed = { ...payload, user_id: other.userId }
  const spoofInsert = await client.rest(table, {
    method: 'POST', token: owner.accessToken, headers: { Prefer: 'return=representation' }, body: [spoofed],
  })
  assert(!spoofInsert.ok, `Spoofed ownership insert into ${table} was not rejected.`)

  const otherRead = await client.rest(`${table}?select=id&id=eq.${id}`, { token: other.accessToken })
  assert(otherRead.ok, safeFailure(`Cross-user read request for ${table}`, otherRead))
  assert(Array.isArray(otherRead.json) && otherRead.json.length === 0, `Cross-user read exposed ${table} row.`)

  await client.rest(`${table}?id=eq.${id}`, {
    method: 'PATCH', token: other.accessToken, headers: { Prefer: 'return=representation' }, body: { notes: `cross-user update ${table}` },
  })
  await assertOwnerRowUnchanged(client, table, id, owner.accessToken, `owner update ${table}`)

  await client.rest(`${table}?id=eq.${id}`, { method: 'DELETE', token: other.accessToken })
  await assertOwnerRowUnchanged(client, table, id, owner.accessToken, `owner update ${table}`)
  log(`[ok] ${table}: anonymous denial, owner CRUD, and cross-user denial verified`)
}

async function verifyCrossOwnerForeignKeys(client, owner, other, ownerPayloads, otherIds, log) {
  const attempts = [
    ['charging_plans provider', 'charging_plans', { ...ownerPayloads.charging_plans, provider_id: otherIds.providerId }],
    ['selection provider', 'provider_plan_selections', { ...ownerPayloads.provider_plan_selections, id: `${ownerPayloads.provider_plan_selections.id.slice(0, -1)}f`, provider_id: otherIds.providerId }],
    ['selection plan', 'provider_plan_selections', { ...ownerPayloads.provider_plan_selections, id: `${ownerPayloads.provider_plan_selections.id.slice(0, -1)}e`, tariff_plan_id: otherIds.planId }],
    ['session provider', 'charging_sessions', { ...ownerPayloads.charging_sessions, provider_id: otherIds.providerId }],
    ['session plan', 'charging_sessions', { ...ownerPayloads.charging_sessions, tariff_plan_id: otherIds.planId }],
    ['session selection', 'charging_sessions', { ...ownerPayloads.charging_sessions, plan_selection_id: otherIds.selectionId }],
  ]
  for (const [label, table, body] of attempts) {
    const response = await client.rest(table, { method: 'POST', token: owner.accessToken, body: [body] })
    assert(!response.ok, `Cross-owner foreign key (${label}) was accepted.`)
  }
  log('[ok] ownership-scoped foreign keys reject cross-user references')
}

async function cleanup(client, records, owner, log) {
  for (const { table, id } of [...records].reverse()) {
    const response = await client.rest(`${table}?id=eq.${id}`, { method: 'DELETE', token: owner.accessToken })
    assert(response.ok, safeFailure(`Cleanup delete from ${table}`, response))
  }
  log('[ok] probe cleanup succeeded in reverse dependency order')
}

/**
 * Executes the live verification. Tests inject fetchImpl to keep all checks local.
 *
 * @param {{ config: ReturnType<typeof resolveConfig>, fetchImpl?: typeof fetch, log?: (message: string) => void, idFactory?: () => string }} options
 */
export async function runVerification({ config, fetchImpl = fetch, log = console.log, idFactory = crypto.randomUUID }) {
  assertRequiredConfig(config)
  const client = createClient({ supabaseUrl: config.supabaseUrl, anonKey: config.anonKey, fetchImpl })
  const user1 = await client.signIn(config.user1Email, config.user1Password)
  assert(user1.userId && user1.accessToken, 'User1 auth response is missing an id or access token.')
  if (!config.user2Email) throw new Error('Complete RLS verification requires the second user credentials.')
  const user2 = await client.signIn(config.user2Email, config.user2Password)
  assert(user2.userId && user2.accessToken, 'User2 auth response is missing an id or access token.')
  assert(user1.userId !== user2.userId, 'Users must be different for RLS verification.')

  const ownerIds = { providerId: undefined, planId: undefined, selectionId: idFactory(), sessionId: undefined }
  const otherIds = { providerId: undefined, planId: undefined, selectionId: idFactory(), sessionId: undefined }
  let ownerPayloads = probePayloads(user1.userId, ownerIds, 'owner')
  let otherPayloads = probePayloads(user2.userId, otherIds, 'other')
  const ownerRecords = []
  const otherRecords = []

  try {
    const ownerProvider = await insertProbe(client, 'providers', ownerPayloads.providers, user1.accessToken)
    ownerIds.providerId = ownerProvider.id
    ownerRecords.push({ table: 'providers', id: ownerProvider.id })
    const otherProvider = await insertProbe(client, 'providers', otherPayloads.providers, user2.accessToken)
    otherIds.providerId = otherProvider.id
    otherRecords.push({ table: 'providers', id: otherProvider.id })

    ownerPayloads = probePayloads(user1.userId, ownerIds, 'owner')
    otherPayloads = probePayloads(user2.userId, otherIds, 'other')
    const ownerPlan = await insertProbe(client, 'charging_plans', ownerPayloads.charging_plans, user1.accessToken)
    ownerIds.planId = ownerPlan.id
    ownerRecords.push({ table: 'charging_plans', id: ownerPlan.id })
    const otherPlan = await insertProbe(client, 'charging_plans', otherPayloads.charging_plans, user2.accessToken)
    otherIds.planId = otherPlan.id
    otherRecords.push({ table: 'charging_plans', id: otherPlan.id })

    ownerPayloads = probePayloads(user1.userId, ownerIds, 'owner')
    otherPayloads = probePayloads(user2.userId, otherIds, 'other')
    const ownerSelection = await insertProbe(client, 'provider_plan_selections', ownerPayloads.provider_plan_selections, user1.accessToken)
    ownerRecords.push({ table: 'provider_plan_selections', id: ownerSelection.id })
    const otherSelection = await insertProbe(client, 'provider_plan_selections', otherPayloads.provider_plan_selections, user2.accessToken)
    otherRecords.push({ table: 'provider_plan_selections', id: otherSelection.id })

    ownerPayloads = probePayloads(user1.userId, ownerIds, 'owner')
    otherPayloads = probePayloads(user2.userId, otherIds, 'other')
    const ownerSession = await insertProbe(client, 'charging_sessions', ownerPayloads.charging_sessions, user1.accessToken)
    ownerRecords.push({ table: 'charging_sessions', id: ownerSession.id })
    const otherSession = await insertProbe(client, 'charging_sessions', otherPayloads.charging_sessions, user2.accessToken)
    otherRecords.push({ table: 'charging_sessions', id: otherSession.id })

    for (const [table, payload, row] of [
      ['providers', ownerPayloads.providers, ownerProvider],
      ['charging_plans', ownerPayloads.charging_plans, ownerPlan],
      ['provider_plan_selections', ownerPayloads.provider_plan_selections, ownerSelection],
      ['charging_sessions', ownerPayloads.charging_sessions, ownerSession],
    ]) await verifyTableMatrix(client, table, user1, user2, payload, row, log)

    await verifyCrossOwnerForeignKeys(client, user1, user2, ownerPayloads, otherIds, log)
  } finally {
    if (ownerRecords.length) await cleanup(client, ownerRecords, user1, log)
    if (otherRecords.length) await cleanup(client, otherRecords, user2, log)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv)
  if (args.help) printHelp()
  else runVerification({ config: resolveConfig(args, process.env) }).then(() => console.log('== RLS live verification passed ==')).catch((error) => {
    console.error(`RLS live verification failed: ${error.message}`)
    process.exitCode = 1
  })
}
