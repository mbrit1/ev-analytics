import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir, homedir, userInfo } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { scanPublicationText } from './check-github-publication.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'publication-check-'))
  temporaryRoots.push(root)
  return root
}

function cli(args, options = {}) {
  return spawnSync(process.execPath, [new URL('./check-github-publication.mjs', import.meta.url).pathname, ...args], {
    encoding: 'utf8',
    input: options.input,
    env: {
      ...process.env,
      GITHUB_PUBLICATION_PRIVATE_TOKENS: options.skipPrivateTokens ? '' : options.privateTokens ?? 'synthetic-private-token',
      ...options.env,
    },
    cwd: options.cwd,
  })
}

/** Test suite for the dependency-free GitHub publication privacy gate. */
describe('check-github-publication', () => {
  it('allows repository paths, URLs, and measurement units', () => {
    // Arrange: Use typical public references and a domain unit.
    const content = 'See src/features/analytics and docs/architecture.md, https://example.test/a/b?x=1&amp;y=2, and 17 €/kWh.'

    // Act: Scan the publication text.
    const findings = scanPublicationText(content, { protectedTokens: ['private-person'] })

    // Assert: Benign public text has no findings.
    assert.deepEqual(findings, [])
  })

  it('catches local path forms and escaped spellings', () => {
    // Arrange: Cover machine paths, worktree markers, and escaped separators.
    const content = [
      '/Users/example/private.txt', '~/Documents/private.txt', '~someone/Documents/private.txt',
      '$HOME/private.txt', '${HOME}/private.txt', '%USERPROFILE%\\private.txt',
      'C:\\Users\\someone\\private.txt', '\\\\host\\share\\private.txt',
      'file:///private/tmp/private.txt', '.codex/worktrees/example/file',
      '%2FUsers%2Fexample%2Fprivate.txt', '%252FUsers%252Fexample%252Fprivate.txt',
      '&#47;Users&#47;example&#47;private.txt',
      '&amp;#47;Users&amp;#47;example', '100% %2FUsers%2Fexample', '</Users/example/private.txt>',
      '<~/Documents/private.txt>', '"\\\\host\\share\\private.txt"',
      '<.codex/worktrees/example/file>',
      '&amp;sol;Users&amp;sol;example&amp;sol;private.txt',
      '&amp;bsol;&amp;bsol;host&amp;bsol;share&amp;bsol;private.txt',
      '&amp;#x2f;Users&amp;#x2f;example',
      '&amp;amp;#47;Users&amp;amp;#47;example',
      '&amp;amp;amp;sol;Users&amp;amp;amp;sol;example',
      '&amp;amp;amp;bsol;&amp;amp;amp;bsol;host&amp;amp;amp;bsol;share',
      '/workspace/private.txt', '/Library/private.txt', '/Applications/private.txt', '/usr/local/private.txt',
      '&#999999999999;',
    ].join('\n')

    // Act: Scan the publication text.
    const findings = scanPublicationText(content, { protectedTokens: [] })

    // Assert: Every suspicious line is blocked without returning its content.
    assert.equal(findings.length, content.split('\n').length - 1)
    assert.ok(findings.filter(({ category }) => category === 'local-path').length === findings.length)
    assert.ok(findings.every(({ line }) => line > 0))
    assert.ok(findings.every((finding) => !('text' in finding)))
  })

  it('leaves malformed entity text safe and does not expose decoded content', () => {
    // Arrange: Include malformed numeric and named entities alongside public documentation.
    const content = 'Malformed &#xZZ;Users text; see docs/architecture.md and https://example.test/path.'

    // Act: Scan the text with no additional protected identities.
    const findings = scanPublicationText(content, { protectedTokens: [] })

    // Assert: Malformed entity text does not throw or create a false local-path finding.
    assert.deepEqual(findings, [])
  })

  it('derives protected names and detects configured private tokens case-insensitively', () => {
    // Arrange: Build values from the current runtime instead of storing an identity in the test.
    const identities = [path.basename(homedir()), userInfo().username].filter((value) => value.length > 2)
    const privateName = identities.find((value) => !['root', 'runner'].includes(value.toLowerCase())) ?? 'synthetic-default-identity'
    const content = `Contributor ${privateName.toUpperCase()} and synthetic-private-token`

    // Act: Use the production identity collector and an explicit test token.
    const findings = scanPublicationText(content, { protectedTokens: [...identities, 'synthetic-private-token'] })

    // Assert: Both protected values are reported only by line and category.
    assert.ok(findings.length >= 1)
    assert.ok(findings.every(({ category, line }) => category === 'protected-identity' && line === 1))
    assert.ok(scanPublicationText('runner\nroot', { protectedTokens: ['runner', 'root'] }).length === 2)
    assert.equal(scanPublicationText('synthetic-name.log\nsynthetic-name_more\nlongsynthetic-name', {
      protectedTokens: ['synthetic-name'],
    }).length, 2)

    // Act: Run the CLI using the runtime-derived identities.
    const derived = cli(['--stdin'], {
      input: 'synthetic-default-identity\n',
      env: { USER: 'synthetic-default-identity', LOGNAME: 'synthetic-default-identity' },
    })

    // Assert: The private identity is found without appearing in the diagnostic.
    assert.equal(derived.status, 1)
    assert.doesNotMatch(`${derived.stdout}${derived.stderr}`, new RegExp(privateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(`${derived.stdout}${derived.stderr}`, /synthetic-default-identity/)

    // Act: Exercise short and generic explicitly configured tokens through the CLI.
    const explicit = cli(['--stdin'], {
      input: 'xy\nroot\nrunner\n',
      privateTokens: 'xy\nroot\nrunner',
    })

    // Assert: Explicit tokens remain protected even when short or generic.
    assert.equal(explicit.status, 1)
    assert.match(`${explicit.stdout}${explicit.stderr}`, /line 1: protected-identity/)
    assert.match(`${explicit.stdout}${explicit.stderr}`, /line 2: protected-identity/)
    assert.match(`${explicit.stdout}${explicit.stderr}`, /line 3: protected-identity/)

    // Act: Exercise a two-character runtime identity without configured tokens.
    const shortDefault = cli(['--stdin'], {
      input: 'xy\n',
      skipPrivateTokens: true,
      env: { USER: 'xy', LOGNAME: 'xy' },
    })

    // Assert: Short runtime identities are protected by the CLI.
    assert.equal(shortDefault.status, 1)
    assert.match(`${shortDefault.stdout}${shortDefault.stderr}`, /line 1: protected-identity/)
  })

  it('supports file, stdin, and commit sources while keeping failure output redacted', async () => {
    // Arrange: Prepare a file and a temporary repository with a safe and blocked commit.
    const root = await makeTempRoot()
    const file = path.join(root, 'publication.txt')
    await writeFile(file, 'Public summary\n')
    const safe = cli(['--file', file])
    const stdin = cli(['--stdin'], { input: 'Public stdin\n' })

    // Act: Exercise a bad file and an invalid argument through the actual CLI.
    const badFile = path.join(root, 'private-name.txt')
    await writeFile(badFile, 'synthetic-private-token is private\n')
    const blocked = cli(['--file', badFile])
    const unknown = cli(['--unknown-secret-option'])
    const missing = cli(['--file', path.join(root, 'missing-private-file.txt')])
    const missingValue = cli(['--file'])
    const noSources = cli([])
    const secondSourceBlocked = cli(['--file', file, '--file', badFile])
    const npmBlocked = spawnSync('npm', ['run', '--silent', 'github:check', '--', '--file', badFile], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_PUBLICATION_PRIVATE_TOKENS: 'synthetic-private-token' },
    })

    // Assert: Sources pass, blocked content is never echoed, and malformed use fails closed.
    assert.equal(safe.status, 0)
    assert.equal(stdin.status, 0)
    assert.equal(blocked.status, 1)
    assert.doesNotMatch(`${blocked.stdout}${blocked.stderr}`, /synthetic-private-token|private-name/)
    assert.equal(unknown.status, 1)
    assert.doesNotMatch(`${unknown.stdout}${unknown.stderr}`, /unknown-secret-option/)
    assert.equal(missing.status, 1)
    assert.doesNotMatch(`${missing.stdout}${missing.stderr}`, /missing-private-file/)
    assert.equal(missingValue.status, 1)
    assert.equal(noSources.status, 1)
    assert.equal(secondSourceBlocked.status, 1)
    assert.match(`${secondSourceBlocked.stdout}${secondSourceBlocked.stderr}`, /source 2, line 1: protected-identity/)
    assert.doesNotMatch(`${secondSourceBlocked.stdout}${secondSourceBlocked.stderr}`, /source 1/)
    assert.equal(npmBlocked.status, 1)
    assert.doesNotMatch(`${npmBlocked.stdout}${npmBlocked.stderr}`, /synthetic-private-token|private-name/)
  })

  it('validates commit messages from a two-dot range', async () => {
    // Arrange: Create two commits whose messages can be checked without a shell.
    const root = await makeTempRoot()
    await mkdir(path.join(root, '.git'), { recursive: true })
    const runGit = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(runGit(['init', '-q']).status, 0)
    assert.equal(runGit(['config', 'user.email', 'test@example.test']).status, 0)
    assert.equal(runGit(['config', 'user.name', 'Test Contributor']).status, 0)
    await writeFile(path.join(root, 'note.txt'), 'safe')
    assert.equal(runGit(['add', 'note.txt']).status, 0)
    assert.equal(runGit(['commit', '-qm', 'Safe summary']).status, 0)
    const base = runGit(['rev-parse', 'HEAD']).stdout.trim()
    await writeFile(path.join(root, 'note.txt'), 'still safe')
    assert.equal(runGit(['add', 'note.txt']).status, 0)
    assert.equal(runGit(['commit', '-qm', 'Another safe summary']).status, 0)
    const safeHead = runGit(['rev-parse', 'HEAD']).stdout.trim()
    await writeFile(path.join(root, 'note.txt'), 'next')
    assert.equal(runGit(['add', 'note.txt']).status, 0)
    assert.equal(runGit(['commit', '-qm', 'synthetic-private-token']).status, 0)

    // Act: Check the commit range and an empty range.
    const blocked = cli(['--commits', `${base}..HEAD`], { cwd: root })
    const safe = cli(['--commits', `${base}..${safeHead}`], { cwd: root })
    const empty = cli(['--commits', 'HEAD..HEAD'], { cwd: root })
    const missingRef = cli(['--commits', 'missing-ref..HEAD'], { cwd: root })
    const threeDot = cli(['--commits', `${base}...HEAD`], { cwd: root })

    // Assert: The commit message is blocked and an empty range is rejected.
    assert.equal(blocked.status, 1)
    assert.doesNotMatch(`${blocked.stdout}${blocked.stderr}`, /synthetic-private-token/)
    assert.equal(safe.status, 0)
    assert.equal(empty.status, 1)
    assert.equal(missingRef.status, 1)
    assert.equal(threeDot.status, 1)
  })
})
