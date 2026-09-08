import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { discoverSessions } from '../v1/discover.js'
import { extractWindowExchanges } from './extract2.js'
import { runPhase1, runPhase2 } from './pipeline2.js'
import { writeReport2 } from './report2.js'
import type { Phase1Output } from './pipeline2.js'

const REPORTS_DIR = path.join(os.homedir(), '.drift-list', 'session-reports')

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

type Args2 = {
  start?: Date
  end?: Date
  hours?: number
  outputPath?: string
  skipPhase1?: string
  projects?: string[]
}

function parseArgs2(argv: string[]): Args2 {
  const args: Args2 = {}

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
      args.outputPath = value
      i++
    } else if (flag === '--skip-phase1' && value) {
      args.skipPhase1 = value
      i++
    } else if (flag === '--project' && value) {
      args.projects = [...(args.projects ?? []), value]
      i++
    } else if (flag === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  return args
}

function parseDate(value: string): Date {
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    throw new Error(
      `Invalid date: "${value}". Use YYYY-MM-DD or ISO 8601 (e.g. 2026-09-02T22:07:33.489Z)`
    )
  }
  return d
}

function printHelp(): void {
  console.log(`
drift-list pipeline 2 — two-phase observation + rendering analyzer

Usage:
  npx tsx src/analyze2.ts [options]

Options:
  --hours N             Analyze sessions from the last N hours (sets start/end automatically)
  --start DATE          Start of analysis window (YYYY-MM-DD or ISO 8601 datetime)
  --end DATE            End of analysis window (YYYY-MM-DD or ISO 8601 datetime)
  --output PATH         Write report to PATH instead of ~/.drift-list/session-reports/
  --skip-phase1 PATH    Skip Phase 1, read observations from existing phase1.json at PATH
  --project NAME        Only include sessions whose cwd contains NAME (case-insensitive, repeatable)
  --help                Print this help and exit

Examples:
  npx tsx src/analyze2.ts --hours 4
  npx tsx src/analyze2.ts --start 2026-08-01 --end 2026-08-15
  npx tsx src/analyze2.ts --start 2026-09-02T22:07:33.489Z --end 2026-09-03T02:06:17.000Z
  npx tsx src/analyze2.ts --start 2026-08-01 --end 2026-08-15 --output /tmp/v2-test
  npx tsx src/analyze2.ts --start 2026-08-01 --end 2026-08-15 \\
    --skip-phase1 /tmp/v2-test/phase1.json --output /tmp/v2-test-b
`.trim())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main2(): Promise<void> {
  const args = parseArgs2(process.argv)

  if (args.hours !== undefined) {
    args.end = new Date()
    args.start = new Date(args.end.getTime() - args.hours * 60 * 60 * 1000)
  }

  if (!args.start || !args.end) {
    log('Error: provide --hours N or both --start and --end.')
    log('Run with --help for usage.')
    process.exit(1)
  }

  const { start, end } = args

  if (start >= end) {
    log('Error: --start must be before --end.')
    process.exit(1)
  }

  log(`Analyzing sessions from ${start.toISOString()} to ${end.toISOString()}...`)

  // Resolve output dir early so phase1.json can be written before phase 2 runs
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportDir = args.outputPath ?? path.join(REPORTS_DIR, `report-v2-${timestamp}`)
  await fs.mkdir(reportDir, { recursive: true })

  // 1. Discover — use start as cutoff for file-level mtime filter
  log('Discovering session files...')
  const sessions = await discoverSessions({ cutoff: start })
  if (sessions.length === 0) {
    log('No sessions found in the given time window.')
    process.exit(1)
  }
  log(`Found ${sessions.length} session file(s).`)

  // 2. Extract exchanges in [start, end] window (no cap — avoids newest-first cap starvation)
  log('Extracting exchanges...')
  const exchanges = await extractWindowExchanges(sessions, start, end, log, args.projects)
  if (exchanges.length === 0) {
    log('No exchanges found in the given time window.')
    process.exit(1)
  }

  const projects = [...new Set(exchanges.map(e => e.project))].sort()
  log(`${exchanges.length} exchange(s) across ${projects.length} project(s): ${projects.join(', ')}`)

  // 4. Phase 1 — observation
  let phase1: Phase1Output

  if (args.skipPhase1) {
    log(`Skipping Phase 1 — reading from ${args.skipPhase1}`)
    const raw = await fs.readFile(args.skipPhase1, 'utf-8')
    phase1 = JSON.parse(raw) as Phase1Output
    log(`Loaded ${phase1.observations.length} observation(s).`)
  } else {
    log('Running Phase 1 (observation)...')
    phase1 = await runPhase1(exchanges)
    log(`Phase 1 complete — ${phase1.observations.length} observation(s).`)

    // Write immediately so --skip-phase1 can reference it if phase 2 fails
    await fs.writeFile(path.join(reportDir, 'phase1.json'), JSON.stringify(phase1, null, 2), 'utf-8')
    log(`phase1.json saved to ${reportDir}`)
  }

  // 5. Phase 2 — rendering
  log('Running Phase 2 (rendering)...')
  const phase2 = await runPhase2(phase1)
  log(`Phase 2 complete — ${phase2.items.length} item(s), ${phase2.questions.length} question(s).`)

  // 6. Write all artifacts (phase1.json written again here is a no-op overwrite)
  log('Writing report...')
  await writeReport2({
    reportDir,
    phase1,
    phase2,
    meta: { start, end, sessionCount: sessions.length, projects },
  })

  console.log(reportDir)
  log(`Done. Report: ${reportDir}/report.md`)
}

function log(msg: string): void {
  process.stderr.write(`[drift-list-v2] ${msg}\n`)
}

main2().catch(err => {
  process.stderr.write(
    `[drift-list-v2] Error: ${err instanceof Error ? err.message : String(err)}\n`
  )
  process.exit(1)
})
