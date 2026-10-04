import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const GENERIC_IDENTITIES = new Set(['root', 'runner'])

function decodePublicationText(value) {
  let decoded = value
  // Four bounded passes cover three nested amp layers plus the terminal entity.
  for (let count = 0; count < 4; count += 1) {
    const next = decoded
      .replace(/&#(\d+);?/gi, (entity, number) => {
        const codePoint = Number(number)
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
      })
      .replace(/&#x([\da-f]+);?/gi, (entity, number) => {
        const codePoint = Number.parseInt(number, 16)
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
      })
      .replace(/&sol;/gi, '/')
      .replace(/&bsol;/gi, '\\')
      // Decode ampersands last so newly exposed entities wait for the next bounded pass.
      .replace(/&amp;/gi, '&')
    if (next === decoded) break
    decoded = next
  }

  for (let count = 0; count < 2; count += 1) {
    const next = decoded.replace(/(?:%[\da-f]{2})+/gi, (sequence) => {
      try {
        return decodeURIComponent(sequence)
      } catch {
        return sequence
      }
    })
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

const LOCAL_PATH_PATTERNS = [
  /(?:^|[\s(<"'`=:])\/(?:Users|home|private|tmp|var|Volumes|mnt|opt|etc|root|workspace(?:s)?|Library|Applications|usr)(?:\/|\b)/i,
  /(?:^|[\s(<"'`=:])~(?:[\w.-]+)?\//,
  /\$(?:HOME|\{HOME\})(?:\/|\\|\b)/i,
  /%USERPROFILE%(?:\/|\\|%5c)/i,
  /\b[A-Z]:[\\/](?:Users|Documents|Desktop|private|tmp|home)?/i,
  /(?:^|[\s(<"'`])(?:\\\\|\/\/)[^\s\\/]+[\\/][^\s]+/,
  /\bfile:\/\//i,
  /(?:^|[\s(<"'`=:])\.?\.codex\/(?:worktrees|visualizations)(?:\/|\b)/i,
]

function isLocalPath(value) {
  return LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(value))
}

function containsProtectedIdentity(value, tokens) {
  return tokens.some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(value)
  })
}

/** Scans publication text and returns only line numbers and generic categories. */
export function scanPublicationText(text, { protectedTokens = [] } = {}) {
  const tokens = [...new Set(protectedTokens.map((token) => String(token).trim()).filter(Boolean))]
  const findings = []

  text.split(/\r?\n/).forEach((line, index) => {
    const decoded = decodePublicationText(line)
    if (isLocalPath(decoded)) findings.push({ line: index + 1, category: 'local-path' })
    if (containsProtectedIdentity(decoded, tokens)) findings.push({ line: index + 1, category: 'protected-identity' })
  })
  return findings
}

function getProtectedTokens() {
  const values = [process.env.USER, process.env.LOGNAME]
  try {
    values.push(path.basename(os.homedir()))
  } catch {
    // Environment and userInfo identities remain available if the home lookup fails.
  }
  try {
    values.push(os.userInfo().username)
  } catch {
    // Environment identities remain available if the system account lookup fails.
  }
  const defaults = values.filter((value) => value && !GENERIC_IDENTITIES.has(value.toLowerCase()))
  const explicit = (process.env.GITHUB_PUBLICATION_PRIVATE_TOKENS ?? '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
  const tokens = [...new Set([...defaults, ...explicit])]
  if (tokens.length === 0) throw new Error('identity')
  return tokens
}

function parseArguments(args) {
  const files = []
  let stdin = false
  let commits
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--file') {
      const file = args[++index]
      if (!file || file.startsWith('--')) throw new Error('arguments')
      files.push(file)
    } else if (argument === '--stdin') {
      if (stdin) throw new Error('arguments')
      stdin = true
    } else if (argument === '--commits') {
      if (commits !== undefined) throw new Error('arguments')
      commits = args[++index]
      if (!commits || commits.startsWith('--')) throw new Error('arguments')
    } else {
      throw new Error('arguments')
    }
  }
  if (files.length === 0 && !stdin && commits === undefined) throw new Error('arguments')
  return { files, stdin, commits }
}

async function getCommitMessages(range) {
  const match = range.includes('...') ? null : range.match(/^([A-Za-z0-9_./~^{}-]+)\.\.([A-Za-z0-9_./~^{}-]+)$/)
  if (!match || match[1].startsWith('-') || match[2].startsWith('-')) throw new Error('source')
  const [, base, head] = match
  const resolve = async (ref) => {
    const result = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { maxBuffer: 1024 * 1024 })
    return result.stdout.trim()
  }
  const [baseCommit, headCommit] = await Promise.all([resolve(base), resolve(head)])
  if (baseCommit === headCommit) throw new Error('source')
  const { stdout: count } = await execFileAsync('git', ['rev-list', '--count', `${baseCommit}..${headCommit}`], { maxBuffer: 1024 * 1024 })
  if (Number(count.trim()) === 0) throw new Error('source')
  const { stdout } = await execFileAsync('git', ['log', '--format=%B', `${baseCommit}..${headCommit}`], { maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

async function readStdin() {
  let content = ''
  for await (const chunk of process.stdin) content += chunk
  return content
}

async function run(args, stdinContent) {
  let options
  try {
    options = parseArguments(args)
  } catch {
    return { ok: false, errors: [{ ordinal: 0, line: 0, category: 'arguments' }] }
  }

  const sources = []
  for (const file of options.files) {
    try {
      sources.push(await readFile(file, 'utf8'))
    } catch {
      sources.push(null)
    }
  }
  if (options.stdin) sources.push(stdinContent)
  if (options.commits !== undefined) {
    try {
      sources.push(await getCommitMessages(options.commits))
    } catch {
      sources.push(null)
    }
  }

  const errors = []
  const tokens = getProtectedTokens()
  sources.forEach((source, index) => {
    if (source === null) {
      errors.push({ ordinal: index + 1, line: 0, category: 'source' })
      return
    }
    for (const finding of scanPublicationText(source, { protectedTokens: tokens })) {
      errors.push({ ordinal: index + 1, ...finding })
    }
  })
  return { ok: errors.length === 0, errors }
}

async function main() {
  try {
    const args = process.argv.slice(2)
    const options = parseArguments(args)
    const result = await run(args, options.stdin ? await readStdin() : undefined)
    if (result.ok) {
      console.log('GitHub publication privacy check passed.')
      return
    }
    console.error('GitHub publication privacy check failed:')
    for (const { ordinal, line, category } of result.errors) {
      console.error(`source ${ordinal}, line ${line}: ${category}`)
    }
    process.exitCode = 1
  } catch {
    console.error('GitHub publication privacy check failed:')
    console.error('source 0, line 0: source')
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
