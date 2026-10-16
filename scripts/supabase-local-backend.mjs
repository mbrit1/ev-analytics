#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBoundedFetch, runStackVerification, validateStackEndpoints } from './supabase-stack-experiment.mjs'

export const CONTRACT = 'baseline-crud-v1'
export const CLI_VERSION = '2.120.0'
export const ARCHIVE_SHA256 = '3b8546cc61aeabab6fd1f68edc7f664ebdfa96bdd6a9b18d8d612708f430ae28'
export const CLI_START_TIMEOUT_MS = 600_000
export const CLI_OTHER_TIMEOUT_MS = 60_000
export const CLI_TIMEOUT_OVERRIDE_ENV = 'SUPABASE_STACK_EXPERIMENT_COMMAND_TIMEOUT_MS'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATABASE_TOOLS = ['execute_sql', 'list_extensions', 'list_migrations', 'list_tables']
const METADATA_QUERY = `select current_database() as database_name,
  current_setting('server_version') as server_version,
  count(*)::integer as domain_tables
from information_schema.tables
where table_schema = 'public'
  and table_name in ('providers', 'charging_plans', 'provider_plan_selections', 'charging_sessions')`

// Only errors constructed here may contribute text to public verification evidence.
class ValidationError extends Error {
  constructor(message, stage) {
    super(message)
    this.stage = stage
  }
}

function check(condition, message) {
  if (!condition) throw new ValidationError(message)
}

/** Enforces the existing native platform and repository Node support before allocation. */
export function validatePrerequisites({ platform, architecture, macosVersion, nodeVersion }) {
  check(platform === 'darwin' && architecture === 'arm64', 'This opt-in runner requires macOS arm64 and the pinned native runtime.')
  check(/^\d+\.\d+(?:\.\d+)?$/.test(macosVersion) && Number(macosVersion.split('.')[0]) >= 14,
    'The pinned native runtime requires macOS 14 or later.')
  const version = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion)
  const [major, minor, patch] = version ? version.slice(1).map(Number) : []
  check(version && (major >= 26 || (major === 24 && minor >= 15)
    || (major === 22 && (minor > 22 || (minor === 22 && patch >= 2)))),
  'Supported Node versions are 22.x >=22.22.2, 24.x >=24.15.0, or 26+.')
}

/** Requires a deliberate schema revision and an explicit supported verification contract. */
export function parseOptions(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    check(['--schema-ref', '--schema-path', '--contract'].includes(flag), 'Unsupported argument. See --help.')
    check(!values.has(flag) && value && !value.startsWith('-'), 'Arguments require one non-option value and cannot be repeated.')
    values.set(flag, value)
  }
  check(values.has('--schema-ref'), 'An explicit --schema-ref is required.')
  check(values.get('--contract') === CONTRACT, `Explicit --contract ${CONTRACT} is required.`)
  const schemaPath = values.get('--schema-path') ?? 'supabase/schema.sql'
  check(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.sql$/.test(schemaPath)
    && !schemaPath.split('/').some((part) => part === '..' || part === '.'), 'Schema path must be a repository-relative SQL file.')
  return { schemaRef: values.get('--schema-ref'), schemaPath, contract: CONTRACT }
}

/** Resolves once and reads only the selected SQL blob, never target code or a checkout. */
export function resolveSchema(options, { cwd = ROOT } = {}) {
  const git = (args) => spawnSync('git', args, { cwd, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
  const revision = git(['rev-parse', '--verify', '--end-of-options', `${options.schemaRef}^{commit}`])
  check(!revision.error && revision.status === 0, 'Schema revision cannot be resolved to a local commit.')
  const commit = revision.stdout.toString().trim()
  check(/^[a-f0-9]{40,64}$/.test(commit), 'Schema revision did not resolve to an immutable commit.')
  const object = `${commit}:${options.schemaPath}`
  const type = git(['cat-file', '-t', object])
  check(type.status === 0 && type.stdout.toString().trim() === 'blob', 'Selected schema path is missing or is not a file.')
  const result = git(['show', object])
  check(!result.error && result.status === 0 && result.stdout.length > 0, 'Selected schema cannot be read or is empty.')
  check(!/^\s*\\/m.test(result.stdout.toString()), 'Selected schema contains unsupported psql metacommands.')
  // Reject symbolic-link blobs as schema sources as well as missing paths.
  const tree = git(['ls-tree', commit, '--', options.schemaPath])
  check(tree.status === 0 && /^100(?:644|755) blob /.test(tree.stdout.toString()), 'Selected schema must be a regular Git file.')
  return { ...options, commit, sha256: createHash('sha256').update(result.stdout).digest('hex'), schema: result.stdout }
}

function mcpEndpoint(value) {
  let url
  try { url = new URL(value) } catch { throw new ValidationError('MCP endpoint is invalid.') }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  check(url.protocol === 'http:' && (/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) || host === '::1'), 'MCP endpoint must use HTTP literal loopback.')
  check(url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp', 'MCP endpoint must specify a port and /mcp without credentials, query or fragment.')
  return url
}

/** Validates stack port isolation, permitting MCP on its own stack API port. */
export function validateEndpoints(statuses) {
  check(Array.isArray(statuses) && statuses.length === 2, 'Exactly two stack statuses are required.')
  const endpoints = validateStackEndpoints(...statuses)
  const mcpUrls = statuses.map((status) => mcpEndpoint((status.env ?? status).MCP_URL))
  for (let index = 0; index < mcpUrls.length; index += 1) {
    const port = Number(mcpUrls[index].port)
    check(!endpoints.some(({ dbPort }) => dbPort === port)
      && endpoints[1 - index].apiPort !== port && Number(mcpUrls[1 - index].port) !== port,
    'MCP endpoints must use distinct stack ports and cannot collide with databases.')
  }
  return { endpoints, mcpUrls }
}

function parseEnvelope(raw, id) {
  let envelope
  try {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
    envelope = JSON.parse(data.length ? data.join('\n') : raw)
  } catch { throw new ValidationError('MCP returned invalid JSON.') }
  check(!envelope?.error, 'MCP JSON-RPC request failed.')
  check(envelope?.jsonrpc === '2.0' && envelope.id === id && envelope.result, 'MCP returned an invalid response envelope.')
  check(envelope.result.isError !== true, 'MCP tool execution failed.')
  return envelope.result
}

function metadataRows(result) {
  // execute_sql wraps its JSON rows in an explicitly marked untrusted-data block.
  let text = result.content?.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  check(typeof text === 'string', 'MCP metadata omitted text content.')
  // execute_sql's output schema serializes its boundary text as { result: string }.
  let output
  try { output = JSON.parse(text) } catch { /* Direct boundary text is handled below. */ }
  if (output && !Array.isArray(output) && typeof output === 'object') {
    check(typeof output.result === 'string', 'MCP metadata result wrapper is invalid.')
    text = output.result
  }
  // The official wrapper also mentions its tag in prose; only standalone lines delimit rows.
  const lines = text.split(/\r?\n/)
  const boundaries = lines.flatMap((line, index) => {
    const match = line.trim().match(/^<(\/?)untrusted-data-([A-Za-z0-9-]+)>$/)
    return match ? [{ index, closing: match[1] === '/', id: match[2] }] : []
  })
  check(boundaries.length === 0 || (boundaries.length === 2
    && !boundaries[0].closing && boundaries[1].closing && boundaries[0].id === boundaries[1].id),
  'MCP metadata boundaries are invalid or ambiguous.')
  const payload = boundaries.length ? lines.slice(boundaries[0].index + 1, boundaries[1].index).join('\n') : text
  let rows
  try { rows = JSON.parse(payload) } catch { throw new ValidationError('MCP metadata rows are invalid.') }
  check(Array.isArray(rows) && rows.length === 1 && rows[0].database_name === 'postgres'
    && rows[0].domain_tables === 4 && /^\d+(?:\.\d+)*(?:[ .()-][A-Za-z0-9 .()-]*)?$/.test(rows[0].server_version),
  'MCP metadata did not confirm the four-table baseline database.')
  return rows[0]
}

/** Requires database-only discovery and real metadata; rejects HTTP, RPC and tool errors. */
export async function verifyMcp(value, { fetchImpl = fetch } = {}) {
  const url = mcpEndpoint(value)
  url.search = '?features=database&read_only=true'
  const boundedFetch = createBoundedFetch(fetchImpl)
  let sessionId
  const request = async (id, method, params) => {
    let response
    try {
      response = await boundedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json,text/event-stream',
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      })
    } catch { throw new ValidationError(`MCP ${method} request failed.`) }
    check(response.ok, `MCP ${method} failed: HTTP ${response.status}.`)
    sessionId = response.headers.get('mcp-session-id') ?? sessionId
    const result = parseEnvelope(await response.text(), id)
    return result
  }
  const initialized = await request(1, 'initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ev-local-backend', version: '1' },
  })
  check(typeof initialized.serverInfo?.version === 'string' && /^[A-Za-z0-9._-]+$/.test(initialized.serverInfo.version), 'MCP initialization omitted a valid version.')
  const listing = await request(2, 'tools/list', {})
  const names = listing.tools?.map((tool) => tool.name).sort()
  check(JSON.stringify(names) === JSON.stringify(DATABASE_TOOLS), 'MCP discovery returned an unexpected tool set.')
  const rows = metadataRows(await request(3, 'tools/call', { name: 'execute_sql', arguments: { query: METADATA_QUERY } }))
  return { mcpVersion: initialized.serverInfo.version, serverVersion: rows.server_version, domainTables: rows.domain_tables, tools: names }
}

/** Runs the current runner's strict Auth/JWT/RLS and direct-database isolation harness. */
export async function verifyRound(statuses, { harness = runStackVerification, mcp = verifyMcp, log = () => {}, onStage = () => {} } = {}) {
  const { mcpUrls } = validateEndpoints(statuses)
  try {
    await harness(statuses, { log })
  } catch {
    throw new ValidationError(`Auth/CRUD/direct-database isolation verification failed for ${CONTRACT}: selected schema must support direct authenticated CRUD, owner RLS, and named owner-scoped foreign keys; no contract fallback is supported.`, 'harness')
  }
  onStage({ stage: 'harness', result: 'passed' })
  const backends = []
  for (let index = 0; index < mcpUrls.length; index += 1) {
    try {
      backends.push(await mcp(mcpUrls[index].href))
    } catch (error) {
      const diagnostic = error instanceof ValidationError ? error.message : 'MCP request or response failed.'
      throw new ValidationError(`Backend ${index + 1}: ${diagnostic}`, 'mcp')
    }
    onStage({ stage: 'mcp', backend: index + 1, result: 'passed' })
  }
  return { contract: CONTRACT, authJwtPostgrest: 'passed', directDatabaseIsolation: 'passed', backends }
}

/** Stages immutable bytes in the Bash wrapper's registered private tools directory. */
export async function stageInput(directory) {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const payload = JSON.parse(raw)
  const schema = Buffer.from(payload.schemaBase64, 'base64')
  check(createHash('sha256').update(schema).digest('hex') === payload.provenance.sha256, 'Staged schema digest does not match provenance.')
  await writeFile(join(directory, 'schema.sql'), schema, { mode: 0o600, flag: 'wx' })
  await writeFile(join(directory, 'provenance.json'), JSON.stringify(payload.provenance), { mode: 0o600, flag: 'wx' })
}

/** Reads generated status documents with safe errors. */
export async function readStatuses(paths) {
  try { return await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8')))) }
  catch { throw new Error('Unable to read private stack status JSON.') }
}

/** Imports only the staged bytes; psql receives credentials through its environment. */
export async function importSchemas(paths, schemaPath, provenancePath) {
  const statuses = await readStatuses(paths)
  const { endpoints } = validateEndpoints(statuses)
  const schema = await readFile(schemaPath)
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
  check(createHash('sha256').update(schema).digest('hex') === provenance.sha256, 'Schema digest changed before import.')
  for (const endpoint of endpoints) {
    const db = new URL(endpoint.dbUrl)
    const result = spawnSync('psql', ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--command', `BEGIN;\n${schema.toString('utf8')}\nCOMMIT;`], {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PG'))), PGCONNECT_TIMEOUT: '5', PGHOST: db.hostname.replace(/^\[|\]$/g, ''), PGPORT: db.port,
        PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: decodeURIComponent(db.pathname.slice(1)) },
    })
    check(!result.error && result.status === 0, `Schema import failed for ${CONTRACT}; no contract fallback is supported.`)
  }
}

/** Uses only an allowlisted stack identity, never a raw status string in lifecycle arguments. */
export async function stackId(path) {
  const [status] = await readStatuses([path])
  check(typeof status.identity?.id === 'string' && /^[A-Za-z0-9._-]+$/.test(status.identity.id), 'Stack status omitted a safe identity.')
  process.stdout.write(status.identity.id)
}

/** Emits selected provenance and versions, without endpoint credentials or raw CLI status. */
export async function recordRound(directory, statusPaths, { verificationOptions = {}, write = (line) => process.stdout.write(line) } = {}) {
  let provenance = {}
  const emit = (event) => write(`${JSON.stringify({ ...provenance, contract: CONTRACT, ...event })}\n`)
  try {
    provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'))
    const statuses = await readStatuses(statusPaths)
    const evidence = await verifyRound(statuses, {
      log: (message) => process.stderr.write(`${message}\n`),
      ...verificationOptions,
      onStage: (stage) => emit({ phase: 'verification-stage', ...stage }),
    })
    emit({ phase: 'verification-result', result: 'passed', verification: evidence })
  } catch (error) {
    const diagnostic = error instanceof ValidationError ? error.message : 'Verification request or response failed.'
    emit({ phase: 'verification-stage', stage: error instanceof ValidationError ? error.stage ?? 'preflight' : 'preflight', result: 'failed', diagnostic })
    throw error
  }
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: npm run backend:validate -- --schema-ref <local-git-revision> --contract baseline-crud-v1 [--schema-path supabase/schema.sql]')
    return
  }
  const selected = resolveSchema(parseOptions(args))
  check(process.platform === 'darwin' && process.arch === 'arm64', 'This opt-in runner requires macOS arm64 and the pinned native runtime.')
  const osVersion = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 10_000 })
  check(!osVersion.error && osVersion.status === 0, 'Unable to verify the required macOS 14 or later host.')
  const macosVersion = osVersion.stdout.trim()
  validatePrerequisites({ platform: process.platform, architecture: process.arch, macosVersion, nodeVersion: process.version })
  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8', timeout: 10_000 })
  check(!psql.error && psql.status === 0 && /^psql \(PostgreSQL\) [\d.]+/.test(psql.stdout), 'A local psql installation is required.')
  const provenance = { schemaCommit: selected.commit, schemaPath: selected.schemaPath, sha256: selected.sha256,
    contract: selected.contract, cliVersion: CLI_VERSION, archiveSha256: ARCHIVE_SHA256,
    runtime: 'native', platform: process.platform, architecture: process.arch, osRelease: release(), macosVersion, nodeVersion: process.version,
    psqlVersion: psql.stdout.trim() }
  console.log(JSON.stringify({ phase: 'selected-schema', ...provenance }))
  const child = spawn('/bin/bash', [join(ROOT, 'scripts/supabase-local-backend.sh')], {
    cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, BACKEND_RUNNER: import.meta.url, BACKEND_ROOT: ROOT },
  })
  // Forward cancellation to Bash so its ownership-aware signal traps clean both stacks.
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  child.stdin.on('error', () => {})
  child.stdin.end(JSON.stringify({ provenance, schemaBase64: selected.schema.toString('base64') }))
  try {
    const status = await new Promise((resolve, reject) => {
      child.on('error', () => reject(new Error('Unable to start the local backend lifecycle.')))
      child.on('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)))
    })
    console.log(JSON.stringify({ phase: 'lifecycle-result', ...provenance, result: status === 0 ? 'passed' : 'failed', exitStatus: status }))
    process.exitCode = status
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}

/** Runs one pinned CLI lifecycle command with a finite operation deadline. */
export async function runCliCommand(operation, executable, args, {
  env = process.env,
  spawnImpl = spawn,
  stderr = process.stderr,
} = {}) {
  const defaults = { start: CLI_START_TIMEOUT_MS, status: CLI_OTHER_TIMEOUT_MS,
    list: CLI_OTHER_TIMEOUT_MS, stop: CLI_OTHER_TIMEOUT_MS, destroy: CLI_OTHER_TIMEOUT_MS }
  if (!Object.hasOwn(defaults, operation) || !executable || !Array.isArray(args)) {
    stderr.write('Invalid Supabase CLI lifecycle command.\n')
    return 1
  }

  let timeoutMs = defaults[operation]
  if (Object.hasOwn(env, CLI_TIMEOUT_OVERRIDE_ENV)) {
    const override = env[CLI_TIMEOUT_OVERRIDE_ENV]
    if (!/^\d+$/.test(override) || Number(override) < 1 || Number(override) > timeoutMs) {
      stderr.write('Invalid Supabase CLI command deadline.\n')
      return 1
    }
    timeoutMs = Number(override)
  }

  return new Promise((resolve) => {
    let timedOut = false
    let settled = false
    let escalationTimer
    const child = spawnImpl(executable, args, { stdio: 'inherit', env })
    const deadlineTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      escalationTimer = setTimeout(() => child.kill('SIGKILL'), 1000)
      escalationTimer.unref?.()
    }, timeoutMs)
    const finish = (status) => {
      if (settled) return
      settled = true
      clearTimeout(deadlineTimer)
      if (escalationTimer) clearTimeout(escalationTimer)
      if (timedOut) stderr.write(`Supabase CLI ${operation} timed out after ${timeoutMs}ms.\n`)
      resolve(timedOut ? 124 : status)
    }
    child.once('error', () => finish(127))
    child.once('close', (code, signal) => finish(code ?? (signal ? 1 : 0)))
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  main(args).catch((error) => {
    console.error(`Local backend validation failed: ${error.message}`)
    process.exitCode = 1
  })
}
