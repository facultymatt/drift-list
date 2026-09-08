/**
 * extract-fixtures — carve a time window out of your Claude Code session logs
 * and write it to a directory you can point tests at.
 *
 * Reads ~/.claude/projects, keeps every JSONL record whose `timestamp` falls in
 * [start, end], and mirrors the surviving records into an output directory under
 * the same relative paths. The result is a miniature ~/.claude that discover6
 * and extract6 can walk unchanged.
 *
 * Deliberately does NOT apply the read-only-subagent filter that discoverSessions
 * applies. Fixtures should be raw, so the filtering logic itself can be tested
 * against them.
 *
 *   npm run extract-fixtures -- --start 2026-09-05T04:45:00Z --end 2026-09-05T04:55:00Z --output ./fixtures/timer-part1
 *   npm run extract-fixtures -- --hours 2 --output ./fixtures/scratch
 *   npm run extract-fixtures -- --hours 2 --dry-run
 */

import fs from 'node:fs/promises'
import readline from 'node:readline'
import { createReadStream, type Dirent } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

/** Synthetic records Claude Code injects on compaction. Not real user turns. */
const COMPACTION_PREFIX = 'This session is being continued from a previous'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Args = {
  start?: Date
  end?: Date
  hours?: number
  output?: string
  dryRun?: boolean
}

type FileStat = {
  /** Path relative to ~/.claude/projects */
  relPath: string
  isAgent: boolean
  totalRecords: number
  keptRecords: number
  /** Records with no parseable timestamp. Always dropped; surfaced so you know. */
  untimestamped: number
  /** Real user turns in the kept window, excluding compaction stubs. */
  userTurns: number
  firstTimestamp: string | null
  lastTimestamp: string | null
}

type Manifest = {
  generatedAt: string
  window: { start: string; end: string }
  sourceDir: string
  totals: {
    filesScanned: number
    filesWritten: number
    recordsKept: number
    userTurns: number
  }
  files: FileStat[]
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  const args: Args = {}

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]

    if (flag === '--start' && value) {
      args.start = parseDate(value)
      i++
    } else if (flag === '--end' && value) {
      args.end = parseDate(value)
      i++
    } else if (flag === '--hours' && value) {
      args.hours = Number(value)
      i++
    } else if (flag === '--output' && value) {
      args.output = value
      i++
    } else if (flag === '--dry-run') {
      args.dryRun = true
    } else if (flag === '--help') {
      printHelp()
      process.exit(0)
    } else {
      fail(`unrecognised argument "${flag}". Run with --help for usage.`)
    }
  }

  return args
}

function parseDate(value: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) fail(`could not parse date "${value}".`)
  return d
}

function resolveWindow(args: Args): { start: Date; end: Date } {
  if (args.start && args.end) {
    if (args.start >= args.end) fail('--start must be before --end.')
    return { start: args.start, end: args.end }
  }
  if (args.hours !== undefined) {
    if (!Number.isFinite(args.hours) || args.hours <= 0) fail('--hours must be a positive number.')
    const end = new Date()
    return { start: new Date(end.getTime() - args.hours * 3600_000), end }
  }
  fail('specify either --start and --end, or --hours N.')
}

function printHelp(): void {
  process.stdout.write(`
extract-fixtures — carve a time window out of your Claude Code logs

Usage:
  extract-fixtures --start ISO --end ISO --output DIR
  extract-fixtures --hours N --output DIR

Options:
  --start ISO       Window start (inclusive).
  --end ISO         Window end (inclusive).
  --hours N         Window ending now, N hours wide. Convenient, and a trap:
                    it can open after your last prompt and capture only Claude
                    working. Prefer explicit --start/--end for real fixtures.
  --output DIR      Where to write. Records land under DIR/projects/...
  --dry-run         Report what would be written without writing it.
  --help            This.

Output:
  DIR/projects/<original relative path>   filtered JSONL, structure preserved
  DIR/manifest.json                       window, per-file counts, timestamps

`)
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

async function walkJsonl(dir: string, base: string): Promise<string[]> {
  let results: string[] = []

  let entries: Dirent<string>[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' })
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // memory/ holds markdown, not transcripts.
      if (entry.name === 'memory') continue
      results = results.concat(await walkJsonl(fullPath, base))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(path.relative(base, fullPath))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

type FilterResult = { lines: string[]; stat: FileStat }

/**
 * Stream one transcript and keep the records inside the window.
 *
 * Records without a usable timestamp are dropped rather than guessed at. That
 * is the honest default for a fixture: an undated record cannot be attributed
 * to a window. The count is reported so a surprising number is visible.
 */
async function filterFile(
  absPath: string,
  relPath: string,
  start: Date,
  end: Date,
): Promise<FilterResult> {
  const stat: FileStat = {
    relPath,
    isAgent: path.basename(relPath).startsWith('agent-'),
    totalRecords: 0,
    keptRecords: 0,
    untimestamped: 0,
    userTurns: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  }

  const lines: string[] = []
  const rl = readline.createInterface({
    input: createReadStream(absPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    stat.totalRecords++

    let record: { timestamp?: string; type?: string; message?: { content?: unknown } }
    try {
      record = JSON.parse(line)
    } catch {
      // A malformed line is not a fixture-worthy record. Count it as untimed.
      stat.untimestamped++
      continue
    }

    if (typeof record.timestamp !== 'string') {
      stat.untimestamped++
      continue
    }
    const ts = new Date(record.timestamp)
    if (Number.isNaN(ts.getTime())) {
      stat.untimestamped++
      continue
    }
    if (ts < start || ts > end) continue

    lines.push(line)
    stat.keptRecords++
    if (stat.firstTimestamp === null) stat.firstTimestamp = record.timestamp
    stat.lastTimestamp = record.timestamp

    if (record.type === 'user' && !isCompactionStub(record)) stat.userTurns++
  }

  return { lines, stat }
}

/**
 * Compaction stubs are `type: 'user'` but were written by Claude Code, not by
 * the engineer. Counting them as user turns is what makes an empty window look
 * populated.
 */
function isCompactionStub(record: { message?: { content?: unknown } }): boolean {
  const content = record?.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? (content as Array<{ type?: string; text?: string }>)
            .filter(b => b?.type === 'text' && typeof b.text === 'string')
            .map(b => b.text)
            .join('')
        : ''
  return text.trimStart().startsWith(COMPACTION_PREFIX)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const { start, end } = resolveWindow(args)

  if (!args.output && !args.dryRun) fail('--output DIR is required (or use --dry-run).')

  const relPaths = await walkJsonl(PROJECTS_DIR, PROJECTS_DIR)
  if (relPaths.length === 0) {
    fail(`no .jsonl transcripts found under ${PROJECTS_DIR}.`)
  }

  const files: FileStat[] = []
  const writes: Array<{ relPath: string; lines: string[] }> = []

  for (const relPath of relPaths) {
    const absPath = path.join(PROJECTS_DIR, relPath)
    const { lines, stat } = await filterFile(absPath, relPath, start, end)
    if (stat.keptRecords === 0) continue
    files.push(stat)
    writes.push({ relPath, lines })
  }

  const recordsKept = files.reduce((n, f) => n + f.keptRecords, 0)
  const userTurns = files.reduce((n, f) => n + f.userTurns, 0)

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
    sourceDir: PROJECTS_DIR,
    totals: {
      filesScanned: relPaths.length,
      filesWritten: writes.length,
      recordsKept,
      userTurns,
    },
    files: files.sort((a, b) => (a.firstTimestamp ?? '').localeCompare(b.firstTimestamp ?? '')),
  }

  if (!args.dryRun && args.output) {
    const outRoot = path.resolve(args.output)
    for (const { relPath, lines } of writes) {
      const dest = path.join(outRoot, 'projects', relPath)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, lines.join('\n') + '\n', 'utf-8')
    }
    await fs.mkdir(outRoot, { recursive: true })
    await fs.writeFile(
      path.join(outRoot, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8',
    )
  }

  report(manifest, args.dryRun === true, args.output)
}

function report(m: Manifest, dryRun: boolean, output?: string): void {
  const w = (s: string) => process.stderr.write(s + '\n')

  w('')
  w(`window     ${m.window.start} → ${m.window.end}`)
  w(`scanned    ${m.totals.filesScanned} transcripts`)
  w(`matched    ${m.totals.filesWritten} files, ${m.totals.recordsKept} records`)
  w(`user turns ${m.totals.userTurns}`)
  w('')

  for (const f of m.files) {
    const tag = f.isAgent ? 'agent' : 'main '
    const untimed = f.untimestamped > 0 ? `  (${f.untimestamped} untimed)` : ''
    w(`  ${tag}  ${String(f.keptRecords).padStart(5)} rec  ${String(f.userTurns).padStart(3)} usr  ${f.relPath}${untimed}`)
  }
  w('')

  if (m.totals.userTurns === 0) {
    w('WARNING: this window contains no engineer turns — only Claude working.')
    w('An analysis run over it will look clean and mean nothing. Widen the window')
    w('backwards until it captures a prompt.')
    w('')
  }

  if (dryRun) {
    w('Dry run — nothing written.')
  } else if (output) {
    w(`Written to ${path.resolve(output)}`)
  }
  w('')
}

function fail(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`)
  process.exit(1)
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})