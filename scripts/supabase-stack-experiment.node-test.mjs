import assert from 'node:assert/strict'
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
