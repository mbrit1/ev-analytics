import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')
// Dated specs and plans are intentionally archival: their old paths and links
// describe the repository at the time and must not be rewritten as current.
const HISTORICAL_DIRECTORIES = [
  path.join('docs', 'superpowers', 'plans'),
  path.join('docs', 'superpowers', 'specs'),
]
const FORBIDDEN_ACTIVE_REFERENCES = [
  { pattern: /HUMAN_SETUP\.md/g, description: 'removed HUMAN_SETUP.md' },
  { pattern: /IMPLEMENTATION_PLAN\.md/g, description: 'removed IMPLEMENTATION_PLAN.md' },
  { pattern: /GEMINI\.md/g, description: 'removed GEMINI.md' },
  { pattern: /src\/features\/tariffs(?:\/|\b)/g, description: 'obsolete src/features/tariffs path' },
]

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function isHistorical(relativePath) {
  return HISTORICAL_DIRECTORIES.some(
    (directory) => relativePath === directory || relativePath.startsWith(`${directory}${path.sep}`),
  )
}

async function walkMarkdown(root, directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name)
    if (isHistorical(relativePath)) continue
    if (entry.isDirectory()) {
      files.push(...await walkMarkdown(root, relativePath))
    // Temporary trackers may name stale artifacts as cleanup work; permanent
    // active documents are the enforcement surface.
    } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('TEMP-')) {
      files.push(relativePath)
    }
  }

  return files
}

/** Returns Markdown files treated as active documentation by the checker. */
export async function findActiveMarkdownFiles(root = DEFAULT_ROOT) {
  const rootEntries = await readdir(root, { withFileTypes: true })
  const rootMarkdown = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('TEMP-'))
    .map((entry) => entry.name)

  return [
    ...rootMarkdown,
    ...await walkMarkdown(root, 'docs'),
    ...await walkMarkdown(root, '.github'),
  ].sort()
}

/** Produces the GitHub-style heading anchors needed by the repository's active docs. */
export function slugifyHeading(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

async function getAnchors(filePath, cache) {
  if (cache.has(filePath)) return cache.get(filePath)

  const content = await readFile(filePath, 'utf8')
  const counts = new Map()
  const anchors = new Set()

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (!match) continue
    const base = slugifyHeading(match[1])
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }

  cache.set(filePath, anchors)
  return anchors
}

function parseLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim()
  if (trimmed.startsWith('<')) {
    const closing = trimmed.indexOf('>')
    return closing === -1 ? trimmed.slice(1) : trimmed.slice(1, closing)
  }
  return trimmed.split(/\s+/, 1)[0]
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

/** Checks active documentation for broken local links/anchors and stale references. */
export async function findDocumentationProblems(root = DEFAULT_ROOT, suppliedFiles) {
  const files = suppliedFiles ?? await findActiveMarkdownFiles(root)
  const problems = []
  const anchorCache = new Map()

  for (const relativePath of files) {
    const absolutePath = path.resolve(root, relativePath)
    const content = await readFile(absolutePath, 'utf8')
    const displayPath = toPosix(relativePath)

    for (const rule of FORBIDDEN_ACTIVE_REFERENCES) {
      rule.pattern.lastIndex = 0
      if (rule.pattern.test(content)) {
        problems.push(`${displayPath}: references ${rule.description}`)
      }
    }

    const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g
    for (const match of content.matchAll(linkPattern)) {
      const target = parseLinkTarget(match[1])
      if (!target || /^(?:[a-z][a-z+.-]*:|\/\/)/i.test(target)) continue

      const [rawPath, rawFragment] = target.split('#', 2)
      let decodedPath
      let decodedFragment
      try {
        decodedPath = decodeURIComponent(rawPath)
        decodedFragment = rawFragment == null ? undefined : decodeURIComponent(rawFragment).toLowerCase()
      } catch {
        problems.push(`${displayPath}: contains invalid URL encoding in ${target}`)
        continue
      }

      const linkedPath = decodedPath
        ? path.resolve(path.dirname(absolutePath), decodedPath.split('?', 1)[0])
        : absolutePath

      if (!await pathExists(linkedPath)) {
        problems.push(`${displayPath}: broken local link ${target}`)
        continue
      }

      if (decodedFragment && path.extname(linkedPath).toLowerCase() === '.md') {
        const anchors = await getAnchors(linkedPath, anchorCache)
        if (!anchors.has(decodedFragment)) {
          problems.push(`${displayPath}: missing anchor #${decodedFragment} in ${toPosix(path.relative(root, linkedPath))}`)
        }
      }
    }
  }

  return problems
}

async function main() {
  const files = await findActiveMarkdownFiles(DEFAULT_ROOT)
  const problems = await findDocumentationProblems(DEFAULT_ROOT, files)

  if (problems.length > 0) {
    console.error(`Documentation check failed with ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`- ${problem}`)
    process.exitCode = 1
    return
  }

  console.log(`Documentation check passed for ${files.length} active Markdown files.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
