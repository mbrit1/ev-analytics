import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, writeFileSync, existsSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helperPath = path.join(repoRoot, 'scripts/supabase-stack-experiment-cleanup.sh')
const docsPath = path.join(repoRoot, 'docs/experiments/supabase-local-stack.md')
const fixtures = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function makeFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'supabase-stack-cleanup-test-')))
  fixtures.push(root)
  const tools = path.join(root, 'tools')
  const runtime = path.join(root, 'runtime')
  const home = path.join(runtime, 'supabase-home')
  const a = path.join(root, 'worktree-a')
  const b = path.join(root, 'worktree-b')
  const log = path.join(root, 'fake-cli.log')
  const template = path.join(root, 'config-template.toml')
  mkdirSync(path.join(a, 'supabase'), { recursive: true })
  mkdirSync(path.join(b, 'supabase'), { recursive: true })
  writeFileSync(template, 'project_id = "isolated-test"\n')

  const cli = path.join(root, 'fake-supabase')
  writeFileSync(cli, `#!/usr/bin/env bash
set -u
printf '%s|%s|%s|%s\\n' "\${SUPABASE_HOME-}" "$*" "\${FAKE_FAIL-}" "\${SUPABASE_EXPERIMENTAL_STACK-}" >>"\${FAKE_CLI_LOG}"
fail_when_requested() {
  if [[ " \${FAKE_FAIL-} " == *" $1 "* ]]; then
    printf '%s\\n' 'private CLI stderr sentinel postgres://private' >&2
    return 1
  fi
}
case "$*" in
  'stack stop --stack-id stack-a') fail_when_requested stop-a || exit 1 ;;
  'stack destroy --stack-id stack-a --yes') fail_when_requested destroy-a || exit 1 ;;
  'stack stop --stack-id stack-b') fail_when_requested stop-b || exit 1 ;;
  'stack destroy --stack-id stack-b --yes') fail_when_requested destroy-b || exit 1 ;;
  'stack list --output-format json')
    fail_when_requested list || exit 19
    printf '%s\\n' "$FAKE_STACK_LIST_JSON"
    ;;
  *) exit 64 ;;
esac
`)
  // The fake CLI is an executable fixture and never starts a real service.
  chmodSync(cli, 0o700)

  return { root, tools, runtime, home, a, b, log, template, cli }
}

function runCleanup(fixture, {
  originalStatus = 0,
  ids = ['stack-a', 'stack-b'],
  failures = '',
  preexistingA = false,
  preexistingTemplateA = false,
  preexistingSymlinkA = false,
  changedB = false,
  beforeTrapFailure = false,
  missingStatus = false,
  signal = '',
  stackListJson = '{"stacks":[{"id":"stack-a"},{"id":"stack-b"}]}',
  inheritedIds = false,
  replaceToolsWithSymlink = '',
  unsafeToolsRegistration = false,
  startAttempted = true,
  fakeCatMode = '',
  fakeRmFailPath = '',
} = {}) {
  const configs = [path.join(fixture.a, 'supabase/config.toml'), path.join(fixture.b, 'supabase/config.toml')]
  if (preexistingA) writeFileSync(configs[0], 'preexisting = true\n')
  if (preexistingTemplateA) writeFileSync(configs[0], readFileSync(fixture.template))
  if (preexistingSymlinkA) symlinkSync(path.join(fixture.root, 'missing-config-target'), configs[0])
  const startA = path.join(fixture.tools, 'start-a.json')
  const statusA = path.join(fixture.tools, 'status-a.json')
  const statusB = path.join(fixture.tools, 'status-b.json')
  const logs = path.join(fixture.tools, 'harness.log')
  const script = `
set -eu
source ${shellQuote(helperPath)}
[[ $(type -t supabase_stack_experiment_install_cleanup_traps) == function ]]
supabase_stack_experiment_install_cleanup_traps
if [[ \${BEFORE_TRAP_FAILURE:-0} == 1 ]]; then exit 23; fi
mkdir ${shellQuote(fixture.tools)}
SUPABASE_STACK_EXPERIMENT_CLI=${shellQuote(fixture.cli)}
SUPABASE_STACK_EXPERIMENT_TOOLS=${unsafeToolsRegistration ? "'/private/tmp'" : shellQuote(fixture.tools)}
supabase_stack_experiment_register_tools_dir "$SUPABASE_STACK_EXPERIMENT_TOOLS"
mkdir ${shellQuote(fixture.runtime)}
SUPABASE_STACK_EXPERIMENT_RUNTIME=${shellQuote(fixture.runtime)}
supabase_stack_experiment_register_runtime_dir "$SUPABASE_STACK_EXPERIMENT_RUNTIME"
mkdir -m 700 ${shellQuote(fixture.home)}
SUPABASE_STACK_EXPERIMENT_HOME=${shellQuote(fixture.home)}
supabase_stack_experiment_register_home "$SUPABASE_STACK_EXPERIMENT_HOME"
SUPABASE_STACK_EXPERIMENT_START_ATTEMPTED=${startAttempted ? 1 : 0}
${preexistingA || preexistingTemplateA || preexistingSymlinkA ? '' : `supabase_stack_experiment_create_config a ${shellQuote(configs[0])} ${shellQuote(fixture.template)}`}
supabase_stack_experiment_create_config b ${shellQuote(configs[1])} ${shellQuote(fixture.template)}
${changedB ? `printf '%s\\n' 'edited after creation = true' >${shellQuote(configs[1])}` : ''}
printf '%s\\n' '{"id":"stack-a"}' >${shellQuote(startA)}
${missingStatus ? '' : `printf '%s\\n' '{"id":"stack-a","env":{"DB_URL":"postgres://private"}}' >${shellQuote(statusA)}; printf '%s\\n' '{"id":"stack-b","env":{"DB_URL":"postgres://private"}}' >${shellQuote(statusB)}`}
printf '%s\\n' 'private diagnostics' >${shellQuote(logs)}
SUPABASE_STACK_EXPERIMENT_ID_A=${ids[0] ? shellQuote(ids[0]) : ''}
SUPABASE_STACK_EXPERIMENT_ID_B=${ids[1] ? shellQuote(ids[1]) : ''}
export SUPABASE_HOME=${shellQuote(fixture.home)} SUPABASE_EXPERIMENTAL_STACK=1 FAKE_CLI_LOG=${shellQuote(fixture.log)} FAKE_FAIL=${shellQuote(failures)}
export FAKE_STACK_LIST_JSON=${shellQuote(stackListJson)}
${replaceToolsWithSymlink ? `rm -rf ${shellQuote(fixture.tools)}; ln -s ${shellQuote(replaceToolsWithSymlink)} ${shellQuote(fixture.tools)}` : ''}
${signal ? `kill -${signal} "$$"` : ''}
exit ${originalStatus}
`
  const fakeBin = path.join(fixture.root, 'fake-bin')
  const useFakeBin = Boolean(fakeCatMode || fakeRmFailPath)
  if (fakeCatMode || fakeRmFailPath) {
    mkdirSync(fakeBin, { recursive: true })
  }
  if (fakeCatMode) {
    writeFileSync(path.join(fakeBin, 'cat'), `#!/bin/sh
mode=${shellQuote(fakeCatMode)}
count_file=${shellQuote(path.join(fixture.root, 'fake-cat-count'))}
count=0
if [ -f "$count_file" ]; then count=1; fi
printf '%s' x >>"$count_file"
if [ "$mode" = snapshot ] && [ "$count" = 0 ]; then exit 8; fi
if [ "$mode" = destination ] && [ "$count" = 1 ]; then printf '%s' partial-config; exit 9; fi
exec /bin/cat "$@"
`)
    chmodSync(path.join(fakeBin, 'cat'), 0o700)
  }
  if (fakeRmFailPath) {
    writeFileSync(path.join(fakeBin, 'rm'), `#!/bin/sh
for argument do
  if [ "$argument" = "$FAKE_RM_FAIL_PATH" ]; then exit 8; fi
done
exec /bin/rm "$@"
`)
    chmodSync(path.join(fakeBin, 'rm'), 0o700)
  }
  const result = spawnSync('bash', ['-c', script], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${useFakeBin ? `${fakeBin}:` : ''}${process.env.PATH}`,
      FAKE_RM_FAIL_PATH: fakeRmFailPath,
      BEFORE_TRAP_FAILURE: beforeTrapFailure ? '1' : '0',
      SUPABASE_STACK_EXPERIMENT_ID_A: inheritedIds ? 'foreign-a' : '',
      SUPABASE_STACK_EXPERIMENT_ID_B: inheritedIds ? 'foreign-b' : '',
    },
  })
  return { result, configs, startA, statusA, statusB, logs }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function calls(fixture) {
  return existsSync(fixture.log) ? readFileSync(fixture.log, 'utf8').trim().split('\n').map((line) => line.split('|')[1]) : []
}

function callModes(fixture) {
  return existsSync(fixture.log) ? readFileSync(fixture.log, 'utf8').trim().split('\n').map((line) => line.split('|')[3]) : []
}

function readFilesUnder(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? readFilesUnder(entryPath) : [readFileSync(entryPath, 'utf8')]
  })
}

function documentedHarnessWrapper() {
  const documentation = readFileSync(docsPath, 'utf8')
  const marker = '# Preserve the actual harness status so the EXIT trap receives it on failure.'
  const start = documentation.indexOf(marker)
  assert.notEqual(start, -1, 'documented harness wrapper marker exists')
  const end = documentation.indexOf('\nfi', start)
  assert.notEqual(end, -1, 'documented harness wrapper closes its status branch')
  return documentation.slice(start, end + 3).split('\n').slice(1).join('\n')
}

/**
 * Exercises sourceable cleanup lifecycle behavior with a fake CLI and private temporary fixtures.
 */
describe('Supabase stack experiment cleanup lifecycle', () => {
  it('does nothing when sourced until the explicit trap installer is called', () => {
    // Arrange: Source the helper without setting up any run-owned resources.
    const fixture = makeFixture()
    // Act: Load the sourceable helper in an isolated shell.
    const result = spawnSync('bash', ['-c', `set -e; source ${shellQuote(helperPath)}; [[ $(type -t supabase_stack_experiment_install_cleanup_traps) == function ]]; test ! -e ${shellQuote(fixture.log)}; test ! -e ${shellQuote(fixture.tools + '/removed')}`], { encoding: 'utf8' })
    // Assert: Sourcing alone does not run the CLI or remove files.
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(calls(fixture), [])
  })

  it('cleans both owned stacks, removes unchanged run-created configs and private directories on success', () => {
    // Arrange: Prepare both run-owned stacks and generated configs.
    const fixture = makeFixture()
    // Act: Exit normally so the installed EXIT trap performs cleanup.
    const { result, configs } = runCleanup(fixture)
    // Assert: Both stacks are stopped and destroyed before owned files are removed.
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(calls(fixture), [
      'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
      'stack stop --stack-id stack-b', 'stack destroy --stack-id stack-b --yes',
    ])
    assert.deepEqual(callModes(fixture), ['1', '1', '1', '1'])
    assert.ok(configs.every((file) => !existsSync(file)))
    assert.ok(!existsSync(fixture.tools), result.stderr)
    assert.ok(!existsSync(fixture.runtime))
  })

  it('preserves the original harness failure status while cleanup runs', () => {
    // Arrange: Simulate a harness failure after resources have been registered.
    const fixture = makeFixture()
    // Act: Exit with the harness status.
    const { result } = runCleanup(fixture, { originalStatus: 37 })
    // Assert: Cleanup runs without replacing the original failure status.
    assert.equal(result.status, 37, result.stderr)
    assert.equal(calls(fixture).length, 4)
  })

  it('runs the documented harness wrapper with its failure status reaching EXIT', () => {
    // Arrange: Make the documented node harness command fail with status 37.
    const fixture = makeFixture()
    const fakeBin = path.join(fixture.root, 'bin')
    mkdirSync(fakeBin)
    const fakeNode = path.join(fakeBin, 'node')
    writeFileSync(fakeNode, '#!/bin/sh\nexit 37\n')
    chmodSync(fakeNode, 0o700)
    const trapStatus = path.join(fixture.root, 'trap-status.txt')
    const wrapper = documentedHarnessWrapper()
    // Act: Execute the exact wrapper from the documentation with a recording EXIT trap.
    const script = `set -eu\ntrap 'printf "%s" "$?" >${shellQuote(trapStatus)}' EXIT\nPATH=${shellQuote(fakeBin)}:$PATH\nA=${shellQuote(fixture.root)}\nTOOLS=${shellQuote(fixture.root)}\n${wrapper}\n`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
    // Assert: The wrapper exits nonzero and the EXIT trap receives that status.
    assert.equal(result.status, 37, result.stderr)
    assert.equal(readFileSync(trapStatus, 'utf8'), '37')
  })

  it('recovers partial-start IDs from list output under the dedicated home when no status exists', () => {
    // Arrange: Simulate a failed start before status JSON was created.
    const fixture = makeFixture()
    // Act: Let cleanup recover IDs from the isolated stack list.
    const { result } = runCleanup(fixture, { ids: ['', ''], missingStatus: true })
    // Assert: Listing and cleanup use the fresh dedicated SUPABASE_HOME.
    assert.equal(result.status, 0, result.stderr)
    const entries = existsSync(fixture.log) ? readFileSync(fixture.log, 'utf8').trim().split('\n') : []
    assert.ok(entries.some((line) => line.includes(`${fixture.home}|stack list --output-format json`)))
    assert.ok(readFileSync(fixture.log, 'utf8').trim().split('\n').every((line) => line.split('|')[3] === '1'))
    assert.deepEqual(calls(fixture).slice(-4), [
      'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
      'stack stop --stack-id stack-b', 'stack destroy --stack-id stack-b --yes',
    ])
  })

  it('accepts the documented direct-array list shape and deduplicates recovered IDs', () => {
    // Arrange: A failed start left no status, and the isolated list repeats one ID.
    const fixture = makeFixture()
    // Act: Recover IDs from an explicit array-of-ID-objects response.
    const { result } = runCleanup(fixture, {
      ids: ['', ''],
      missingStatus: true,
      stackListJson: '[{"id":"stack-a"},{"id":"stack-a"}]',
    })
    // Assert: The owned ID is cleaned once; duplicate evidence is harmless.
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(calls(fixture).slice(-2), [
      'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
    ])
  })

  it('accepts an empty isolated list as evidence that no stack was created', () => {
    // Arrange: The start command was attempted but the isolated home contains no stacks.
    const fixture = makeFixture()
    // Act: Recover from a valid empty list.
    const { result } = runCleanup(fixture, { ids: ['', ''], missingStatus: true, stackListJson: '[]' })
    // Assert: No stop or destroy is issued, and successful cleanup removes private directories.
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(calls(fixture), ['stack list --output-format json'])
    assert.ok(!existsSync(fixture.tools))
    assert.ok(!existsSync(fixture.runtime))
  })

  it('attempts stop and destroy for both stacks after the first stop and destroy fail, then retains recovery evidence', () => {
    // Arrange: Make both cleanup operations for stack A fail.
    const fixture = makeFixture()
    // Act: Run cleanup for both registered stacks.
    const { result } = runCleanup(fixture, { failures: 'stop-a destroy-a' })
    // Assert: Failures do not prevent attempts for stack B or evidence retention.
    assert.notEqual(result.status, 0)
    assert.deepEqual(calls(fixture), [
      'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
      'stack stop --stack-id stack-b', 'stack destroy --stack-id stack-b --yes',
    ])
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
    assert.ok(existsSync(path.join(fixture.tools, 'harness.log')))
  })

  it('retains private recovery files when destroy or isolated list fails', () => {
    // Arrange: Exercise a destroy failure and an isolated-list failure separately.
    const destroyFixture = makeFixture()
    // Act: First fail stack B destruction.
    const destroyed = runCleanup(destroyFixture, { failures: 'destroy-b' })
    // Assert: Status JSON and diagnostics remain available for manual recovery.
    assert.notEqual(destroyed.result.status, 0)
    assert.deepEqual(calls(destroyFixture), [
      'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
      'stack stop --stack-id stack-b', 'stack destroy --stack-id stack-b --yes',
    ])
    assert.ok(existsSync(destroyFixture.tools))
    assert.ok(existsSync(destroyFixture.runtime))
    assert.ok(destroyed.result.stderr.includes(destroyFixture.home))
    assert.ok(destroyed.result.stderr.includes(destroyFixture.tools))
    assert.ok(existsSync(destroyed.statusA))
    assert.ok(existsSync(destroyed.logs))

    const listFixture = makeFixture()
    // Act: Then fail isolated ID recovery after a partial start.
    const listed = runCleanup(listFixture, { ids: ['', ''], missingStatus: true, failures: 'list' })
    // Assert: Start output and diagnostics remain available after list failure.
    assert.notEqual(listed.result.status, 0)
    assert.deepEqual(calls(listFixture), ['stack list --output-format json'])
    assert.ok(existsSync(listFixture.tools))
    assert.ok(existsSync(listFixture.runtime))
    assert.ok(existsSync(listed.startA))
    assert.ok(existsSync(listed.logs))
  })

  it('still cleans a known stack when partial-start ID recovery fails for the other stack', () => {
    // Arrange: Keep stack A status evidence while stack B start has no status and list fails.
    const fixture = makeFixture()
    // Act: Run cleanup with A's ID known and isolated recovery unavailable.
    const { result } = runCleanup(fixture, {
      ids: ['stack-a', ''],
      missingStatus: true,
      failures: 'list',
    })
    // Assert: A is stopped/destroyed despite B's recovery failure, with private evidence retained.
    assert.notEqual(result.status, 0)
    assert.deepEqual(calls(fixture), [
      'stack list --output-format json',
      'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
    ])
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
  })

  it('preserves preexisting configs and run-created configs edited after creation', () => {
    // Arrange: Make one config preexisting and edit the other after creation.
    const fixture = makeFixture()
    // Act: Complete stack cleanup successfully.
    const { result, configs } = runCleanup(fixture, { preexistingA: true, changedB: true })
    // Assert: Neither config is deleted when it is not an unchanged owned copy.
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(configs[0], 'utf8'), 'preexisting = true\n')
    assert.equal(readFileSync(configs[1], 'utf8'), 'edited after creation = true\n')
  })

  it('preserves a preexisting dangling config symlink', () => {
    // Arrange: Make worktree A's config a preexisting dangling symlink.
    const fixture = makeFixture()
    // Act: Complete stack cleanup with the symlink already present.
    const { result, configs } = runCleanup(fixture, { preexistingSymlinkA: true })
    // Assert: The link remains and cleanup does not claim ownership of it.
    assert.equal(result.status, 0, result.stderr)
    assert.equal(lstatSync(configs[0]).isSymbolicLink(), true)
    assert.equal(readlinkSync(configs[0]), path.join(fixture.root, 'missing-config-target'))
    assert.ok(readdirSync(path.dirname(configs[0])).includes('config.toml'))
  })

  it('preserves a preexisting config that happens to match the template', () => {
    // Arrange: Place a template-identical config before the experiment owns either path.
    const fixture = makeFixture()
    // Act: Complete stack cleanup without registering that existing config.
    const { result, configs } = runCleanup(fixture, { preexistingTemplateA: true })
    // Assert: Content equality alone does not confer ownership.
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(configs[0], 'utf8'), readFileSync(fixture.template, 'utf8'))
  })

  it('refuses to create over a preexisting template-identical config', () => {
    // Arrange: Create A's config before ownership registration with identical template bytes.
    const fixture = makeFixture()
    const config = path.join(fixture.a, 'supabase/config.toml')
    writeFileSync(config, readFileSync(fixture.template))
    // Act: Ask the helper to create the already-existing config inside an owned temp setup.
    const script = `set -eu\nsource ${shellQuote(helperPath)}\nsupabase_stack_experiment_install_cleanup_traps\nmkdir ${shellQuote(fixture.tools)}\nSUPABASE_STACK_EXPERIMENT_TOOLS=${shellQuote(fixture.tools)}\nsupabase_stack_experiment_register_tools_dir "$SUPABASE_STACK_EXPERIMENT_TOOLS"\nif supabase_stack_experiment_create_config a ${shellQuote(config)} ${shellQuote(fixture.template)}; then exit 99; fi\nexit 0\n`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
    // Assert: Existing bytes remain untouched and cleanup leaves the unowned config in place.
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(config, 'utf8'), readFileSync(fixture.template, 'utf8'))
  })

  it('retains private directories when exclusive config creation partially writes and fails', () => {
    // Arrange: Make the second template read emit partial config bytes and fail.
    const fixture = makeFixture()
    // Act: Fail during the first owned config destination write.
    const { result, configs } = runCleanup(fixture, { fakeCatMode: 'destination', startAttempted: false })
    // Assert: Partial run-owned config and private evidence remain for manual recovery.
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(configs[0], 'utf8'), 'partial-config')
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
  })

  it('cleans up after a private template snapshot write failure before config creation', () => {
    // Arrange: Fail the first copy, which saves the owned template snapshot.
    const fixture = makeFixture()
    // Act: Run setup with the snapshot writer failing immediately.
    const { result, configs } = runCleanup(fixture, { fakeCatMode: 'snapshot', startAttempted: false })
    // Assert: No config is created and temporary setup resources are cleaned.
    assert.notEqual(result.status, 0)
    assert.ok(configs.every((file) => !existsSync(file)))
    assert.ok(!existsSync(fixture.tools), result.stderr)
    assert.ok(!existsSync(fixture.runtime))
  })

  it('attempts both config removals and retains directories when one removal fails', () => {
    // Arrange: Make removal of config A fail while config B remains removable.
    const fixture = makeFixture()
    const configA = path.join(fixture.a, 'supabase/config.toml')
    const configB = path.join(fixture.b, 'supabase/config.toml')
    // Act: Complete stack cleanup with a single config unlink failure.
    const { result } = runCleanup(fixture, { fakeRmFailPath: configA })
    // Assert: The second config is still removed and private directories are retained.
    assert.notEqual(result.status, 0)
    assert.ok(existsSync(configA))
    assert.equal(existsSync(configB), false)
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
  })

  it('accepts mktemp directories through a symlinked TMPDIR after canonicalizing the root', () => {
    // Arrange: Point TMPDIR through an alias to the canonical fixture root.
    const fixture = makeFixture()
    const alias = path.join(fixture.root, 'tmp-alias')
    symlinkSync(fixture.root, alias, 'dir')
    const tools = path.join(fixture.root, 'created-through-alias')
    mkdirSync(tools)
    // Act: Register the physical directory while TMPDIR names its symlink alias.
    const script = `set -eu\nsource ${shellQuote(helperPath)}\nsupabase_stack_experiment_install_cleanup_traps\nSUPABASE_STACK_EXPERIMENT_TOOLS=${shellQuote(tools)}\nsupabase_stack_experiment_register_tools_dir "$SUPABASE_STACK_EXPERIMENT_TOOLS"\nexit 0\n`
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: alias },
    })
    // Assert: Canonical root ownership permits safe cleanup of the registered directory.
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(tools), false)
  })

  it('refuses to delete a registered directory replaced by a symlink', () => {
    // Arrange: Replace the registered tools directory after recording its identity.
    const fixture = makeFixture()
    const target = path.join(fixture.root, 'external-recovery')
    mkdirSync(target)
    writeFileSync(path.join(target, 'keep.txt'), 'recovery evidence\n')
    // Act: Replace the owned directory with a symlink immediately before exit.
    const { result } = runCleanup(fixture, { replaceToolsWithSymlink: target })
    // Assert: Cleanup fails closed and preserves the target and runtime evidence.
    assert.notEqual(result.status, 0)
    assert.deepEqual(calls(fixture), [])
    assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'recovery evidence\n')
    assert.deepEqual(readdirSync(target), ['keep.txt'])
    assert.ok(existsSync(fixture.runtime))
    assert.ok(result.stderr.includes(fixture.home))
    assert.ok(result.stderr.includes(fixture.tools))
  })

  it('rejects an owned-directory registration outside the recorded temporary root', () => {
    // Arrange: Create an unregistered local directory and propose /private/tmp as owned.
    const fixture = makeFixture()
    // Act: Attempt to register a path outside this process temporary root.
    const { result } = runCleanup(fixture, { unsafeToolsRegistration: true })
    // Assert: Registration fails before CLI use and the local directory remains untouched.
    assert.notEqual(result.status, 0)
    assert.deepEqual(calls(fixture), [])
    assert.ok(existsSync(fixture.tools))
    assert.ok(!existsSync(fixture.runtime))
  })

  it('preserves an early setup failure status and performs no CLI calls or allocation cleanup', () => {
    // Arrange: Install traps, then fail before allocating run-owned resources.
    const fixture = makeFixture()
    // Act: Exit with the setup error.
    const { result } = runCleanup(fixture, { beforeTrapFailure: true, inheritedIds: true })
    // Assert: The status survives and no CLI operation or removal occurs.
    assert.equal(result.status, 23, result.stderr)
    assert.deepEqual(calls(fixture), [])
    assert.ok(!existsSync(fixture.tools))
    assert.ok(!existsSync(fixture.runtime))
  })

  it('captures CLI stderr privately and does not print secrets or endpoint URLs', () => {
    // Arrange: Include a secret-bearing database URL in private status JSON.
    const fixture = makeFixture()
    // Act: Force cleanup diagnostics.
    const { result } = runCleanup(fixture, { failures: 'stop-a' })
    // Assert: Diagnostic output contains no status secret or endpoint.
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /private CLI stderr sentinel|postgres:\/\/private/)
    assert.ok(readFilesUnder(fixture.tools).some((contents) => contents.includes('private CLI stderr sentinel')))
  })

  it('fails closed and retains evidence for an unknown stack list JSON shape', () => {
    // Arrange: Return valid JSON with an unrecognized envelope.
    const fixture = makeFixture()
    // Act: Attempt partial-start recovery.
    const { result } = runCleanup(fixture, { ids: ['', ''], missingStatus: true, stackListJson: '{"items":[]}' })
    // Assert: Unknown ownership data cannot authorize cleanup or evidence deletion.
    assert.notEqual(result.status, 0)
    assert.deepEqual(calls(fixture), ['stack list --output-format json'])
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
  })

  it('validates the full list before cleanup when one recovered entry is invalid', () => {
    // Arrange: Return a valid first ID followed by an invalid entry.
    const fixture = makeFixture()
    // Act: Attempt to recover the partial-start stack set.
    const { result } = runCleanup(fixture, {
      ids: ['', ''],
      missingStatus: true,
      stackListJson: '{"stacks":[{"id":"stack-a"},{}]}',
    })
    // Assert: No partial set is acted upon and recovery data is retained.
    assert.notEqual(result.status, 0)
    assert.deepEqual(calls(fixture), ['stack list --output-format json'])
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
  })

  it('keeps malformed list JSON private and emits no raw parser diagnostics', () => {
    // Arrange: Return malformed JSON containing a credential-like value.
    const fixture = makeFixture()
    // Act: Attempt partial-start recovery.
    const { result } = runCleanup(fixture, {
      ids: ['', ''],
      missingStatus: true,
      stackListJson: '{"url":"postgres://private",}',
    })
    // Assert: Generic diagnostics are public while raw input and parser output stay private.
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /postgres:\/\/private|SyntaxError/)
    assert.ok(existsSync(fixture.tools))
    assert.ok(readFilesUnder(fixture.tools).some((contents) => contents.includes('postgres://private')))
  })

  it('preserves the original failure status when cleanup also fails', () => {
    // Arrange: Fail the harness and the first stack stop.
    const fixture = makeFixture()
    // Act: Let EXIT cleanup run after the harness failure.
    const { result } = runCleanup(fixture, { originalStatus: 37, failures: 'stop-a' })
    // Assert: Cleanup failure does not replace the original status.
    assert.equal(result.status, 37, result.stderr)
    assert.equal(calls(fixture).length, 4)
    assert.ok(existsSync(fixture.tools))
    assert.ok(existsSync(fixture.runtime))
  })

  for (const [signal, expectedStatus] of [['INT', 130], ['TERM', 143]]) {
    it(`runs cleanup exactly once when ${signal} triggers exit`, () => {
      // Arrange: Register both stack IDs before signaling the shell.
      const fixture = makeFixture()
      // Act: Trigger the signal; signal and EXIT handling must not duplicate cleanup.
      const { result } = runCleanup(fixture, { signal })
      // Assert: Both stacks receive one stop and one destroy attempt.
      assert.equal(result.status, expectedStatus, result.stderr)
      assert.deepEqual(calls(fixture), [
        'stack stop --stack-id stack-a', 'stack destroy --stack-id stack-a --yes',
        'stack stop --stack-id stack-b', 'stack destroy --stack-id stack-b --yes',
      ])
    })
  }
})
