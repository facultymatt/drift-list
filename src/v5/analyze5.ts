import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { discoverSessions } from './discover5.js'
import { extractWindowExchanges } from './extract5.js'
import { runDecisionLog, runRender } from './pipeline5.js'
import { writeReport5 } from './report5.js'
import type { DecisionLog } from './pipeline5.js'

const REPORTS_DIR = path.join(os.homedir(), '.drift-list', 'session-reports')

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

type Args3 = {
  start?: Date
  end?: Date
  hours?: number
  outputPath?: string
  skipLog?: string
}

function parseArgs3(argv: string[]): Args3 {
  const args: Args3 = {}

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
    } else if (flag === '--skip-log' && value) {
      args.skipLog = value
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

/**
 * Best-effort reconstruction of how this run was invoked. Node does not
 * preserve the original shell string (the shell tokenizes and strips quotes
 * before we ever run), so this rebuilds from argv rather than claiming to be
 * verbatim. argv[0] is the runtime binary, argv[1] the script; the rest are
 * the user's args. Spaces are re-quoted so the line stays copy-pasteable.
 */
function reconstructCommand(argv: string[]): string {
  const quote = (a: string) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)
  const runner = path.basename(argv[0] ?? 'node')   // node | tsx | bun | ...
  const script = argv[1] ? path.basename(argv[1]) : ''
  const rest = argv.slice(2).map(quote)
  return [runner, script, ...rest].filter(Boolean).join(' ')
}

function printHelp(): void {
  console.log(`
drift-list v3 — neutral decision log, then rendering

Phase 1 extracts a decision log from the transcript without judging it.
Phase 2 turns that log into a watch list, exercises and questions.

Usage:
  npx tsx src/analyze3.ts [options]

Options:
  --hours N          Analyze sessions from the last N hours
  --start DATE       Start of window (YYYY-MM-DD or ISO 8601)
  --end DATE         End of window
  --output PATH      Write report to PATH instead of ~/.drift-list/session-reports/
  --skip-log PATH    Skip phase 1, read an existing decisions.json
  --help             Print this help

Environment:
  MENTOR_MODEL_PHASE1   Override the model used for the decision log
  MENTOR_MODEL_PHASE2   Override the model used for rendering

Examples:
  npx tsx src/analyze3.ts --hours 4
  npx tsx src/analyze3.ts --start 2026-09-02T22:07:33.489Z --end 2026-09-03T02:06:17.000Z

  # Iterate on the phase 2 prompt without paying for phase 1 again:
  npx tsx src/analyze3.ts --start 2026-09-02 --end 2026-09-03 --output /tmp/v3-a
  npx tsx src/analyze3.ts --skip-log /tmp/v3-a/decisions.json --output /tmp/v3-b \\
    --start 2026-09-02 --end 2026-09-03
`.trim())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main3(): Promise<void> {
  const args = parseArgs3(process.argv)

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

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const reportDir = args.outputPath ?? path.join(REPORTS_DIR, `report-v3-${timestamp}`)
  await fs.mkdir(reportDir, { recursive: true })

  // 1. Discover
  log('Discovering session files...')
  const sessions = await discoverSessions({ cutoff: start })
  if (sessions.length === 0) {
    log('No sessions found in the given time window.')
    process.exit(1)
  }
  log(`Found ${sessions.length} session file(s).`)

  // 2. Extract
  log('Extracting exchanges...')
  const { exchanges, engineerExchanges, subagentExchanges } = await extractWindowExchanges(sessions, start, end, log)
  if (exchanges.length === 0) {
    log('No exchanges found in the given time window.')
    process.exit(1)
  }

  log(
    `${engineerExchanges} engineer exchange(s), ${subagentExchanges} subagent exchange(s) ` +
    `— subagent turns are labelled for phase 1, not credited to the engineer.`
  )

  const cwds = [...new Set(exchanges.map(e => e.cwd))].filter(Boolean).sort()
  // Count sessions that actually contributed an in-window exchange, not files
  // discovered. Discovery is a cheap mtime pre-filter and admits candidates the
  // window then discards, so sessions.length overstates how much was analyzed.
  const contributingSessions = new Set(exchanges.map(e => e.sessionId)).size
  log(
    `${exchanges.length} exchange(s) from ${contributingSessions} of ${sessions.length} session file(s), ` +
    `across ${cwds.length} working director${cwds.length === 1 ? 'y' : 'ies'}: ${cwds.join(', ')}`
  )

  // 3. Phase 1 — decision log
  let decisionLog: DecisionLog

  if (args.skipLog) {
    log(`Skipping phase 1 — reading decision log from ${args.skipLog}`)
    decisionLog = JSON.parse(await fs.readFile(args.skipLog, 'utf-8')) as DecisionLog
    log(`Loaded ${decisionLog.decisions.length} decision(s).`)
  } else {
    log('Running phase 1 (decision log)...')
    decisionLog = await runDecisionLog(exchanges)
    log(
      `Phase 1 complete — ${decisionLog.decisions.length} decision(s), ` +
      `${decisionLog.concepts.length} concept(s), ` +
      `${decisionLog.stated_constraints.length} stated constraint(s).`
    )

    // Write immediately so --skip-log can reuse it if phase 2 fails
    await fs.writeFile(
      path.join(reportDir, 'decisions.json'),
      JSON.stringify(decisionLog, null, 2),
      'utf-8'
    )
    log(`decisions.json saved to ${reportDir}`)
  }

  // Attach run provenance so the artifacts are self-describing: the window and
  // the exact command. This is added by the CLI, not the
  // model. Re-write decisions.json so the on-disk copy includes it (the report
  // writer will write it again, but --skip-log reads this file directly).
  decisionLog.run = {
    start: start.toISOString(),
    end: end.toISOString(),
    generatedAt: new Date().toISOString(),
    command: reconstructCommand(process.argv),
    cwdsSeen: cwds,
    sessionCount: contributingSessions,
  }
  await fs.writeFile(
    path.join(reportDir, 'decisions.json'),
    JSON.stringify(decisionLog, null, 2),
    'utf-8'
  )

  logLogShape(decisionLog)

  // 4. Phase 2 — rendering
  log('Running phase 2 (rendering)...')
  const render = await runRender(decisionLog)
  log(
    `Phase 2 complete — ${render.watch_list.length} watch list item(s), ` +
    `${render.questions.length} question(s).`
  )

  const withExercise = render.watch_list.filter(i => i.exercise).length
  log(`${withExercise}/${render.watch_list.length} item(s) have an exercise.`)

  // 5. Write
  log('Writing report...')
  await writeReport5({
    reportDir,
    log: decisionLog,
    render,
    meta: { start, end, sessionCount: contributingSessions, cwds },
  })

  console.log(reportDir)
  log(`Done. Report: ${reportDir}/report.md`)
}

/** Print the engagement/driver distribution — useful for spotting a phase 1 that is over- or under-reporting. */
function logLogShape(decisionLog: DecisionLog): void {
  const count = <T extends string>(items: T[]): string => {
    const tally = new Map<T, number>()
    for (const i of items) tally.set(i, (tally.get(i) ?? 0) + 1)
    return [...tally.entries()].map(([k, v]) => `${k}=${v}`).join(' ')
  }
  log(`  kinds:       ${count(decisionLog.decisions.map(d => d.kind))}`)
  log(`  drivers:     ${count(decisionLog.decisions.map(d => d.driver))}`)
  log(`  engagement:  ${count(decisionLog.decisions.map(d => d.engagement))}`)
}

function log(msg: string): void {
  process.stderr.write(`[skill-drift-v5] ${msg}\n`)
}

main3().catch(err => {
  process.stderr.write(
    `[skill-drift-v5] Error: ${err instanceof Error ? err.message : String(err)}\n`
  )
  process.exit(1)
})
