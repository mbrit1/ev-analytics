import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { findActiveMarkdownFiles, findDocumentationProblems, slugifyHeading } from './check-docs.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createTemporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'ev-analytics-docs-'))
  temporaryRoots.push(root)
  await mkdir(path.join(root, 'docs'), { recursive: true })
  await mkdir(path.join(root, '.github'), { recursive: true })
  return root
}

/**
 * Test suite for the dependency-free active-document checker.
 *
 * Verifies local paths and anchors pass while broken links and known stale
 * references produce actionable failures.
 */
describe('check-docs', () => {
  it('includes all permanent Markdown documentation and excludes temporary trackers', async () => {
    // Arrange: Create permanent documents in root and nested documentation folders.
    const root = await createTemporaryRoot()
    await mkdir(path.join(root, 'docs', 'design'), { recursive: true })
    await writeFile(path.join(root, 'README.md'), '# README\n')
    await writeFile(path.join(root, 'docs', 'architecture.md'), '# Architecture\n')
    await writeFile(path.join(root, 'docs', 'design', 'governance-checklist.md'), '# Checklist\n')
    await writeFile(path.join(root, 'docs', 'TEMP-tracker.md'), '# Temporary tracker\n')

    // Act: Discover the active documentation set.
    const files = await findActiveMarkdownFiles(root)

    // Assert: Nested permanent documentation is checked while temporary work is not.
    assert.deepEqual(files, [
      'README.md',
      'docs/architecture.md',
      'docs/design/governance-checklist.md',
    ])
  })

  it('accepts valid local document links and generated anchors', async () => {
    // Arrange: Create two active documents connected through a valid heading anchor.
    const root = await createTemporaryRoot()
    await writeFile(path.join(root, 'README.md'), '[Architecture](./docs/architecture.md#data-flow)\n')
    await writeFile(path.join(root, 'docs', 'architecture.md'), '# Architecture\n\n## Data Flow\n')

    // Act: Check the controlled active-document set.
    const problems = await findDocumentationProblems(root, ['README.md', 'docs/architecture.md'])

    // Assert: Valid paths and GitHub-style anchors produce no failures.
    assert.deepEqual(problems, [])
    assert.equal(slugifyHeading('Data Flow'), 'data-flow')
  })

  it('reports broken paths, missing anchors, and stale active references', async () => {
    // Arrange: Create active documentation containing each protected failure mode.
    const root = await createTemporaryRoot()
    await writeFile(
      path.join(root, 'README.md'),
      '[Missing](./docs/missing.md)\n[Bad anchor](./docs/architecture.md#missing)\nSee GEMINI.md and src/features/tariffs.\n',
    )
    await writeFile(path.join(root, 'docs', 'architecture.md'), '# Architecture\n')

    // Act: Run the checker over the intentionally invalid documents.
    const problems = await findDocumentationProblems(root, ['README.md', 'docs/architecture.md'])

    // Assert: Every failure category is reported with enough context to repair it.
    assert.ok(problems.some((problem) => problem.includes('broken local link ./docs/missing.md')))
    assert.ok(problems.some((problem) => problem.includes('missing anchor #missing')))
    assert.ok(problems.some((problem) => problem.includes('removed GEMINI.md')))
    assert.ok(problems.some((problem) => problem.includes('obsolete src/features/tariffs path')))
  })
})
