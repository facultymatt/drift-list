#!/usr/bin/env tsx
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { discoverSessions } from './discover6.js'
import { extractWindowExchanges } from './extract6.js'
import { runDecisionLog, runRender, setPipelineLogger } from './pipeline6.js'
import { writeReport6 } from './report6.js'
import type { DecisionLog } from './pipeline6.js'

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
  /** Keep read-only subagent transcripts that discovery would otherwise drop */
  keepReadOnlyAgents?: boolean
  /** Emit `### Session N` headers between sessions in the phase 1 prompt */
  sessionHeaders?: boolean
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
    } else if (flag === '--keep-readonly-agents') {
      args.keepReadOnlyAgents = true
    } else if (flag === '--session-headers') {
      args.sessionHeaders = true
    } else if (flag === '--help') {
      printHelp()
      process.exit(0)
    } else {
      // An unrecognised flag used to be ignored silently, so a typo like
      // `--ouput ./x` failed by writing to the default directory instead of
      // saying anything. Fail loudly instead.
      log(`Error: unrecognised argument "${flag}". Run with --help for usage.`)
      process.exit(1)
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
Drift List v6 — neutral decision log, then rendering

Phase 1 extracts a decision log from the transcript without judging it.
Phase 2 turns that log into a watch list, exercises and questions.

Usage:
  npm run v6 -- [options]

Options:
  --hours N                Analyze sessions from the last N hours (not with --start/--end)
  --start DATE             Start of window (YYYY-MM-DD or ISO 8601)
  --end DATE               End of window
  --output PATH            Write report to PATH instead of ~/.drift-list/session-reports/
  --skip-log PATH          Render from an existing decisions.json; skips discovery entirely
  --keep-readonly-agents   Keep subagent transcripts that never wrote a file
  --session-headers        Separate sessions with "### Session N" headers in the
                           phase 1 prompt (exchange order is unchanged)
  --help                   Print this help

Subagent transcripts:
  agent-*.jsonl files are classified by what they did, not what they were called.
  A transcript containing an Edit/Write/MultiEdit call is delegated work and is
  analyzed. One that only read is reconnaissance: it reports on code that already
  exists, and including it degrades attribution of the surrounding decisions.
  Those are dropped unless --keep-readonly-agents is passed.

Environment:
  MENTOR_MODEL_PHASE1   Override the model used for the decision log
  MENTOR_MODEL_PHASE2   Override the model used for rendering

Examples:
  npm run v6 -- --hours 4
  npm run v6 -- --start 2026-09-02T22:07:33.489Z --end 2026-09-03T02:06:17.000Z

  # Iterate on the phase 2 prompt without paying for phase 1 again:
  npm run v6 -- --start 2026-09-02 --end 2026-09-03 --output /tmp/v6-a
  npm run v6 -- --skip-log /tmp/v6-a/decisions.json --output /tmp/v6-b
`.trim())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main3(): Promise<void> {
  const args = parseArgs3(process.argv)
  setPipelineLogger(log)

  // --skip-log re-renders an existing decision log. It used to still resolve a
  // window, walk the projects directory and extract exchanges — all discarded —
  // and would exit if that window no longer had discoverable files. So
  // re-rendering an old report failed even though every input it needed was in
  // the file. Handle it before any of that runs.
  if (args.skipLog) {
    await renderFromExistingLog(args)
    return
  }

  if (args.hours !== undefined && (args.start || args.end)) {
    // --hours used to silently overwrite an explicit window, so a run could
    // analyse a different range than the command line asked for.
    log('Error: --hours cannot be combined with --start or --end. Pick one.')
    process.exit(1)
  }

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
  const reportDir = args.outputPath ?? path.join(REPORTS_DIR, `report-v6-${timestamp}`)
  await fs.mkdir(reportDir, { recursive: true })

  // 1. Discover
  log('Discovering session files...')
  const { sessions, droppedAgents, keptAgents } = await discoverSessions({
    cutoff: start,
    dropReadOnlyAgents: !args.keepReadOnlyAgents,
  })
  if (sessions.length === 0) {
    log('No sessions found in the given time window.')
    process.exit(1)
  }
  log(`Found ${sessions.length} session file(s).`)

  if (droppedAgents > 0) {
    log(`Dropped ${droppedAgents} read-only subagent transcript(s) — exploration, not delegated work.`)
  }
  if (keptAgents > 0) {
    // Surfaced deliberately: if delegation habits change and subagents start
    // writing code, that shows up here as a number rather than as work silently
    // absent from the report.
    log(`Kept ${keptAgents} subagent transcript(s) that wrote files — treated as delegated work.`)
  }

  // 2. Extract
  log('Extracting exchanges...')
  const { exchanges, subagentExchanges } = await extractWindowExchanges(sessions, start, end, log)
  if (exchanges.length === 0) {
    log('No exchanges found in the given time window.')
    process.exit(1)
  }
  if (subagentExchanges > 0) {
    log(`${subagentExchanges} of them come from write-capable subagent transcripts.`)
  }

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

  {
    log('Running phase 1 (decision log)...')
    decisionLog = await runDecisionLog(exchanges, { sessionHeaders: args.sessionHeaders === true })
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
  await writeReport6({
    reportDir,
    log: decisionLog,
    render,
    meta: { start, end, sessionCount: contributingSessions, cwds },
  })

  console.log(reportDir)
  log(`Done. Report: ${reportDir}/report.md`)
}

/**
 * Phase 2 only, from a decision log already on disk. Needs no session files:
 * the window and the directories come from the log's own `run` block, written
 * when phase 1 produced it.
 */
async function renderFromExistingLog(args: Args3): Promise<void> {
  log(`Skipping phase 1 — reading decision log from ${args.skipLog}`)

  let decisionLog: DecisionLog
  try {
    decisionLog = JSON.parse(await fs.readFile(args.skipLog!, 'utf-8')) as DecisionLog
  } catch (err) {
    log(`Error: could not read decision log at ${args.skipLog}`)
    log(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  log(`Loaded ${decisionLog.decisions.length} decision(s).`)

  const reportDir =
    args.outputPath ??
    path.join(REPORTS_DIR, `report-v6-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
  await fs.mkdir(reportDir, { recursive: true })

  // Provenance travels with the log. Older logs predate the `run` block, so
  // fall back rather than failing — the report just carries less detail.
  const run = decisionLog.run
  const start = run?.start ? new Date(run.start) : new Date(0)
  const end = run?.end ? new Date(run.end) : new Date()
  const cwds = run?.cwdsSeen ?? []
  const sessionCount = run?.sessionCount ?? 0
  if (!run) {
    log('Note: this decision log has no run block — window and directories will be blank in the report.')
  }

  logLogShape(decisionLog)

  log('Running phase 2 (rendering)...')
  const render = await runRender(decisionLog)
  log(
    `Phase 2 complete — ${render.watch_list.length} watch list item(s), ` +
    `${render.questions.length} question(s).`
  )

  log('Writing report...')
  await writeReport6({ reportDir, log: decisionLog, render, meta: { start, end, sessionCount, cwds } })

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
  process.stderr.write(`[drift-list-v6] ${msg}\n`)
}

main3().catch(err => {
  process.stderr.write(
    `[drift-list-v6] Error: ${err instanceof Error ? err.message : String(err)}\n`
  )
  process.exit(1)
})
