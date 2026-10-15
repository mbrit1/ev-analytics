import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { validateStackEndpoints } from './supabase-stack-experiment.mjs'

const stackStatus = (apiPort, dbPort) => ({
  env: {
    API_URL: `http://127.0.0.1:${apiPort}`,
    DB_URL: `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`,
    ANON_KEY: 'publishable-test-key',
    SERVICE_ROLE_KEY: 'service-test-key',
  },
})

/** Covers the endpoint safety gate before a local stack harness can make requests. */
describe('supabase-stack-experiment endpoint validation', () => {
  it('accepts two complete loopback stacks with four distinct ports', () => {
    // Arrange: Supply the standard Supabase CLI status JSON env map.
    const statuses = [stackStatus(54321, 54322), stackStatus(55321, 55322)]

    // Act: Validate both API and database endpoints as one pair.
    const endpoints = validateStackEndpoints(...statuses)

    // Assert: The validated API origins are available for the later harness calls.
    assert.deepEqual(endpoints.map(({ apiUrl }) => apiUrl), [
      'http://127.0.0.1:54321',
      'http://127.0.0.1:55321',
    ])
    assert.equal(endpoints[0].dbUrl, 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
  })

  it('rejects a missing or incomplete status env map', () => {
    // Arrange: Omit the database endpoint from one otherwise local status.
    const incomplete = { env: { API_URL: 'http://127.0.0.1:54321' } }

    // Act and assert: Missing endpoint data fails validation.
    assert.throws(() => validateStackEndpoints(incomplete, stackStatus(55321, 55322)), /status|endpoint/i)
  })

  it('rejects non-loopback hosts even when the URL uses HTTP', () => {
    // Arrange: Replace one API host with a network-reachable hostname.
    const remote = stackStatus(54321, 54322)
    remote.env.API_URL = 'http://localhost:54321'

    // Act and assert: Hostnames do not satisfy the literal loopback requirement.
    assert.throws(() => validateStackEndpoints(remote, stackStatus(55321, 55322)), /loopback/i)
  })

  it('rejects a non-loopback database host and credentials in the API URL', () => {
    // Arrange: Put the database on a network hostname, then put credentials in the API URL.
    const remoteDatabase = stackStatus(54321, 54322)
    remoteDatabase.env.DB_URL = 'postgresql://postgres:secret@db.example.test:54322/postgres'
    const authenticatedApi = stackStatus(55321, 55322)
    authenticatedApi.env.API_URL = 'http://user:secret@127.0.0.1:55321'

    // Act and assert: Neither endpoint can cross the local-only boundary.
    assert.throws(() => validateStackEndpoints(remoteDatabase, stackStatus(55321, 55322)), /loopback/i)
    assert.throws(() => validateStackEndpoints(authenticatedApi, stackStatus(54321, 54322)), /credentials/i)
  })

  it('rejects HTTPS endpoints and malformed endpoint URLs', () => {
    // Arrange: Create a remote-scheme API endpoint and an invalid database URL.
    const secure = stackStatus(54321, 54322)
    secure.env.API_URL = 'https://127.0.0.1:54321'
    const malformed = stackStatus(55321, 55322)
    malformed.env.DB_URL = 'not a database URL'

    // Act and assert: Both endpoint forms are rejected before any network request.
    assert.throws(() => validateStackEndpoints(secure, stackStatus(55321, 55322)), /HTTP|loopback/i)
    assert.throws(() => validateStackEndpoints(stackStatus(54321, 54322), malformed), /endpoint|URL/i)
  })

  it('requires each stack API port to differ from its database port', () => {
    // Arrange: Give stack A the same API and database port.
    const colliding = stackStatus(54321, 54321)

    // Act and assert: A single stack cannot share its endpoint port.
    assert.throws(() => validateStackEndpoints(colliding, stackStatus(55321, 55322)), /distinct|port/i)
  })

  it('requires all four API and database ports to be distinct across both stacks', () => {
    // Arrange: Reuse stack A's database port for stack B's database endpoint.
    const colliding = stackStatus(55321, 54322)

    // Act and assert: Port reuse across stacks is rejected as well.
    assert.throws(() => validateStackEndpoints(stackStatus(54321, 54322), colliding), /distinct|port/i)
  })

  it('uses a bounded timeout and rejects redirects for every fetch', async () => {
    // Arrange: Wrap a request recorder in the harness fetch boundary.
    const { createBoundedFetch } = await import('./supabase-stack-experiment.mjs')
    let requestOptions
    const fetchWithPolicy = createBoundedFetch(async (_input, options) => {
      requestOptions = options
      return { status: 200 }
    })

    // Act: Run one request through the wrapper.
    await fetchWithPolicy('http://127.0.0.1:54321/auth/v1/admin/users')

    // Assert: Credential-bearing requests cannot follow redirects and cannot hang indefinitely.
    assert.equal(requestOptions.redirect, 'error')
    assert.ok(requestOptions.signal instanceof AbortSignal)
    assert.equal(requestOptions.signal.aborted, false)
  })
})

function runProvisioningFailureScenario({ failCleanup, missingUserId = false }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'supabase-stack-test-'))
  const statusA = join(tempDir, 'a.json')
  const statusB = join(tempDir, 'b.json')
  const cleanupLog = join(tempDir, 'cleanup.log')
  writeFileSync(statusA, JSON.stringify(stackStatus(54321, 54322)))
  writeFileSync(statusB, JSON.stringify(stackStatus(55321, 55322)))

  // The preload substitutes network calls before the CLI captures global fetch.
  const preload = `
    import { appendFileSync } from 'node:fs';
    const logPath = process.env.CLEANUP_LOG;
    const creations = new Map();
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      if (method === 'POST' && url.pathname.endsWith('/auth/v1/admin/users')) {
        const count = (creations.get(url.port) ?? 0) + 1;
        creations.set(url.port, count);
        if (url.port === '55321' && count === 1 && process.env.MISSING_USER_ID === 'true') {
          return Response.json({ email: 'owner@example.test' });
        }
        if (url.port === '55321' && count === 2) {
          return Response.json({ error: 'secret provisioning response body' }, { status: 503 });
        }
        return Response.json({ id: (url.port === '54321' ? 'A-' : 'B-') + count });
      }
      if (method === 'DELETE') {
        const userId = decodeURIComponent(url.pathname.split('/').at(-1));
        appendFileSync(logPath, userId + '\\n');
        if (process.env.FAIL_CLEANUP === 'true') {
          if (userId === 'B-1') return Response.json({ error: 'secret cleanup body' }, { status: 502 });
          if (userId === 'A-2') throw new Error('network failure with authorization secret');
          if (userId === 'A-1') return Response.json({ error: 'secret response body' }, { status: 504 });
        }
        return new Response(null, { status: 204 });
      }
      throw new Error('Unexpected fake request');
    };
  `
  const preloadUrl = `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`
  try {
    const result = spawnSync(process.execPath, [
      '--import', preloadUrl,
      fileURLToPath(new URL('./supabase-stack-experiment.mjs', import.meta.url)),
      statusA,
      statusB,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLEANUP_LOG: cleanupLog,
        FAIL_CLEANUP: String(failCleanup),
        MISSING_USER_ID: String(missingUserId),
      },
    })
    const cleanupAttempts = readFileSync(cleanupLog, 'utf8').trim().split('\n').filter(Boolean)
    return { result, cleanupAttempts }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/** Covers cleanup reporting when stack B provisioning fails after stack A is provisioned. */
describe('supabase-stack-experiment user cleanup', () => {
  it('preserves provisioning and every cleanup failure while continuing owned user cleanup', () => {
    // Arrange: Stack B partially provisions; its cleanup and both stack A deletions fail differently.
    const scenario = runProvisioningFailureScenario({ failCleanup: true })

    // Act: Inspect the real CLI process result and cleanup trace.

    // Assert: All owned users were attempted and safe failure identifiers remain visible.
    assert.deepEqual(scenario.cleanupAttempts, ['B-1', 'A-2', 'A-1'])
    assert.notEqual(scenario.result.status, 0)
    assert.match(scenario.result.stderr, /status=503/)
    assert.match(scenario.result.stderr, /stack 2.*user 1.*status=502/i)
    assert.match(scenario.result.stderr, /stack 1.*user 2.*network/i)
    assert.match(scenario.result.stderr, /stack 1.*user 1.*status=504/i)
    assert.doesNotMatch(scenario.result.stderr, /secret|authorization/i)
  })

  it('cleans stack A after B provisioning fails even when cleanup itself succeeds', () => {
    // Arrange: Stack B creates one account, then returns a provisioning error.
    const scenario = runProvisioningFailureScenario({ failCleanup: false })

    // Act: Inspect the real CLI process result and cleanup trace.

    // Assert: Partial B cleanup and both A users are removed, while provisioning stays failed.
    assert.deepEqual(scenario.cleanupAttempts, ['B-1', 'A-2', 'A-1'])
    assert.notEqual(scenario.result.status, 0)
    assert.match(scenario.result.stderr, /status=503/)
    assert.doesNotMatch(scenario.result.stderr, /secret/i)
  })

  it('preserves the missing user id reason while reporting later cleanup failures', () => {
    // Arrange: Stack B returns a successful but malformed provisioning response; stack A cleanup fails.
    const scenario = runProvisioningFailureScenario({ failCleanup: true, missingUserId: true })

    // Act: Inspect the real CLI process result and cleanup trace.

    // Assert: The safe response reason and each later cleanup failure remain visible.
    assert.deepEqual(scenario.cleanupAttempts, ['A-2', 'A-1'])
    assert.notEqual(scenario.result.status, 0)
    assert.match(scenario.result.stderr, /response omitted the user id/i)
    assert.match(scenario.result.stderr, /stack 1.*user 2.*network request failed/i)
    assert.match(scenario.result.stderr, /stack 1.*user 1.*status=504/i)
    assert.doesNotMatch(scenario.result.stderr, /secret|authorization/i)
  })
})
