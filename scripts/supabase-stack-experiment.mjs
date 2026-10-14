#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient, runVerification } from './verify-rls-live.mjs'

const USER_EMAILS = ['rls-stack-owner@example.test', 'rls-stack-other@example.test']
const MARKER_NAME = 'RLS local stack isolation marker'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function statusEnv(status) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return undefined
  const env = status.env && typeof status.env === 'object' && !Array.isArray(status.env) ? status.env : status
  return env
}

function endpointUrl(value, label, allowedProtocols, { allowCredentials = false } = {}) {
  assert(typeof value === 'string' && value.length > 0, `Status is missing ${label}.`)
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Status contains an invalid ${label} URL.`)
  }
  assert(allowedProtocols.includes(url.protocol), `${label} must use ${allowedProtocols.join(' or ')}.`)
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  const ipVersion = isIP(hostname)
  const isLoopback = ipVersion === 4
    ? Number(hostname.split('.')[0]) === 127
    : ipVersion === 6 && hostname.toLowerCase() === '::1'
  assert(isLoopback, `${label} must use a literal loopback IP address.`)
  assert(url.port.length > 0, `${label} must specify a port.`)
  if (!allowCredentials) assert(url.username.length === 0 && url.password.length === 0, `${label} must not contain credentials.`)
  assert(url.search.length === 0 && url.hash.length === 0, `${label} must not contain a query or fragment.`)
  return url
}

/**
 * Validates both CLI status files before the harness makes any network request.
 * Accepts the Supabase CLI `{ env: ... }` JSON shape and a flat environment map.
 *
 * @param {Record<string, unknown>} firstStatus First stack status JSON.
 * @param {Record<string, unknown>} secondStatus Second stack status JSON.
 * @returns {Array<{ apiUrl: string, apiPort: number, dbUrl: string, dbPort: number, anonKey: string, serviceKey: string }>} Validated endpoint and credential configuration.
 */
export function validateStackEndpoints(firstStatus, secondStatus) {
  const statuses = [firstStatus, secondStatus]
  const endpoints = statuses.map((status, index) => {
    const label = `Stack ${index + 1}`
    const env = statusEnv(status)
    assert(env, `${label} status must be a JSON object.`)
    const api = endpointUrl(env.API_URL, `${label} API endpoint`, ['http:'])
    const db = endpointUrl(env.DB_URL, `${label} database endpoint`, ['postgres:', 'postgresql:'], { allowCredentials: true })
    assert(db.username.length > 0 && db.password.length > 0 && db.pathname.length > 1,
      `${label} database endpoint must include a user, password, and database name.`)
    const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY
    const serviceKey = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY
    assert(typeof anonKey === 'string' && anonKey.length > 0, `${label} status is missing its anon or publishable key.`)
    assert(typeof serviceKey === 'string' && serviceKey.length > 0, `${label} status is missing its service-role or secret key.`)
    return {
      apiUrl: api.origin,
      apiPort: Number(api.port),
      dbUrl: db.href,
      dbPort: Number(db.port),
      anonKey,
      serviceKey,
    }
  })
  const ports = endpoints.flatMap(({ apiPort, dbPort }) => [apiPort, dbPort])
  assert(new Set(ports).size === ports.length, 'Both stacks must use four distinct API and database ports.')
  return endpoints
}

/** Adds a finite request deadline and prevents credentials from following redirects. */
export function createBoundedFetch(fetchImpl = fetch) {
  return (input, init = {}) => fetchImpl(input, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
}

const localFetch = createBoundedFetch()

function randomPassword() {
  return randomBytes(32).toString('base64url')
}

async function responseJson(response) {
  return response.json().catch(() => null)
}

async function createLocalUser(endpoint, email) {
  const password = randomPassword()
  const response = await localFetch(`${endpoint.apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: endpoint.serviceKey,
      Authorization: `Bearer ${endpoint.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const result = await responseJson(response)
  if (!response.ok) throw new Error(`Local user provisioning failed: status=${response.status}`)
  const userId = result?.user?.id ?? result?.id
  assert(typeof userId === 'string' && userId.length > 0, 'Local user provisioning response omitted the user id.')
  return { email, password, userId }
}

async function deleteLocalUser(endpoint, userId) {
  const response = await localFetch(`${endpoint.apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: {
      apikey: endpoint.serviceKey,
      Authorization: `Bearer ${endpoint.serviceKey}`,
    },
  })
  if (!response.ok) throw new Error(`Local user cleanup failed: status=${response.status}`)
}

async function provisionStackUsers(endpoint) {
  const users = []
  try {
    for (const email of USER_EMAILS) users.push(await createLocalUser(endpoint, email))
    return users
  } catch (error) {
    const cleanupErrors = []
    for (const user of users.reverse()) {
      try {
        await deleteLocalUser(endpoint, user.userId)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length) throw new Error('Local user provisioning failed and partial user cleanup was incomplete.')
    throw error
  }
}

function verificationConfig(endpoint, users) {
  return {
    supabaseUrl: endpoint.apiUrl,
    anonKey: endpoint.anonKey,
    user1Email: users[0].email,
    user1Password: users[0].password,
    user2Email: users[1].email,
    user2Password: users[1].password,
  }
}

async function runMarkerIsolation(endpoints, users) {
  const [stackA, stackB] = endpoints
  const [usersA, usersB] = users
  const clientA = createClient({ supabaseUrl: stackA.apiUrl, anonKey: stackA.anonKey, fetchImpl: localFetch })
  const clientB = createClient({ supabaseUrl: stackB.apiUrl, anonKey: stackB.anonKey, fetchImpl: localFetch })
  const ownerA = await clientA.signIn(usersA[0].email, usersA[0].password)
  const ownerB = await clientB.signIn(usersB[0].email, usersB[0].password)
  assert(ownerA.userId && ownerA.accessToken, 'Stack A sign-in response omitted user credentials.')
  assert(ownerB.userId && ownerB.accessToken, 'Stack B sign-in response omitted user credentials.')

  const insert = await localFetch(`${stackA.apiUrl}/rest/v1/providers`, {
    method: 'POST',
    headers: {
      apikey: stackA.anonKey,
      Authorization: `Bearer ${ownerA.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([{ user_id: ownerA.userId, name: MARKER_NAME }]),
  })
  const insertedRows = await responseJson(insert)
  let markerId
  try {
    assert(insert.ok && Array.isArray(insertedRows) && insertedRows.length === 1 && insertedRows[0].id,
      `Marker insert in stack A failed: status=${insert.status}`)
    markerId = insertedRows[0].id
    assert(typeof markerId === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(markerId),
      'Marker insert returned an invalid UUID.')

    const filter = encodeURIComponent(`eq.${markerId}`)
    const ownerRead = await clientA.rest(`providers?select=id,user_id,name&id=${filter}`, { token: ownerA.accessToken })
    assert(ownerRead.ok && Array.isArray(ownerRead.json) && ownerRead.json.length === 1,
      `Stack A owner could not read the marker: status=${ownerRead.status}`)
    assert(ownerRead.json[0].user_id === ownerA.userId && ownerRead.json[0].name === MARKER_NAME,
      'Stack A owner read a marker with unexpected ownership or content.')

    const isolatedRead = await clientB.rest(`providers?select=id&id=${filter}`, { token: ownerB.accessToken })
    assert(isolatedRead.ok && Array.isArray(isolatedRead.json) && isolatedRead.json.length === 0,
      `Stack B exposed the stack A marker or rejected the authenticated query: status=${isolatedRead.status}`)

    const countA = countMarkerRows(stackA, markerId)
    const countB = countMarkerRows(stackB, markerId)
    assert(countA === 1, `Direct database check found ${countA} marker rows in stack A; expected one.`)
    assert(countB === 0, `Direct database check found ${countB} marker rows in stack B; expected none.`)
  } finally {
    if (insert.ok) {
      const cleanupUrl = new URL('/rest/v1/providers', stackA.apiUrl)
      if (typeof markerId === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(markerId)) {
        cleanupUrl.searchParams.set('id', `eq.${markerId}`)
      } else {
        cleanupUrl.searchParams.set('name', `eq.${MARKER_NAME}`)
        cleanupUrl.searchParams.set('user_id', `eq.${ownerA.userId}`)
      }
      const cleanup = await localFetch(cleanupUrl, {
        method: 'DELETE',
        headers: {
          apikey: stackA.anonKey,
          Authorization: `Bearer ${ownerA.accessToken}`,
        },
      })
      if (!cleanup.ok) throw new Error(`Marker cleanup in stack A failed: status=${cleanup.status}`)
    }
  }
}

function countMarkerRows(endpoint, markerId) {
  const db = new URL(endpoint.dbUrl)
  const hostname = db.hostname.startsWith('[') && db.hostname.endsWith(']')
    ? db.hostname.slice(1, -1)
    : db.hostname
  const database = decodeURIComponent(db.pathname.slice(1))
  const query = `SELECT count(*) FROM public.providers WHERE id = '${markerId}'::uuid;`
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--no-align',
    '--tuples-only',
    '--set=ON_ERROR_STOP=1',
    '--command',
    query,
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024,
    env: {
      ...process.env,
      PGHOST: hostname,
      PGPORT: String(endpoint.dbPort),
      PGUSER: decodeURIComponent(db.username),
      PGPASSWORD: decodeURIComponent(db.password),
      PGDATABASE: database,
    },
  })
  if (result.error || result.status !== 0) throw new Error('Direct database marker check failed.')
  const count = result.stdout.trim()
  if (!/^\d+$/.test(count)) throw new Error('Direct database marker check returned an invalid count.')
  return Number(count)
}

async function runExperiment(statusPaths, { log = console.log } = {}) {
  const statuses = await Promise.all(statusPaths.map(async (path) => {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      throw new Error('Unable to read valid stack status JSON.')
    }
  }))
  const endpoints = validateStackEndpoints(...statuses)
  const users = []
  const failures = []

  try {
    for (const endpoint of endpoints) users.push(await provisionStackUsers(endpoint))

    for (let index = 0; index < endpoints.length; index += 1) {
      try {
        await runVerification({
          config: verificationConfig(endpoints[index], users[index]),
          fetchImpl: localFetch,
          log,
          idFactory: randomUUID,
        })
        log(`[ok] stack ${index + 1}: existing RLS verification passed`)
      } catch (error) {
        failures.push(`stack ${index + 1} verifier failed: ${error.message}`)
      }
    }

    try {
      await runMarkerIsolation(endpoints, users)
      log('[ok] authenticated provider marker is isolated between stacks')
    } catch (error) {
      failures.push(`marker isolation failed: ${error.message}`)
    }
  } finally {
    const cleanupFailures = []
    for (let index = endpoints.length - 1; index >= 0; index -= 1) {
      for (const user of [...(users[index] ?? [])].reverse()) {
        try {
          await deleteLocalUser(endpoints[index], user.userId)
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
    }
    if (cleanupFailures.length) failures.push('local user cleanup failed for one or more stacks')
  }

  if (failures.length) throw new Error(failures.join('; '))
}

function printHelp(log = console.log) {
  log('Usage: node scripts/supabase-stack-experiment.mjs <stack-a-status.json> <stack-b-status.json>')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) printHelp()
  else if (args.length !== 2) {
    printHelp(console.error)
    process.exitCode = 1
  } else {
    runExperiment(args).then(() => console.log('== Supabase local stack experiment passed ==')).catch((error) => {
      console.error(`Supabase local stack experiment failed: ${error.message}`)
      process.exitCode = 1
    })
  }
}
