import 'dotenv/config'
import { discoverSessions } from './discover.js'
import { extractExchanges } from './extract.js'
import { analyze } from './analyze.js'
import { writeReport } from './report.js'

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

type Args = {
  hours?: number
  days: number
  outputPath?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 7 }

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]

    if (flag === '--hours' && value) {
      args.hours = Number(value)
      i++
    } else if (flag === '--days' && value) {
      args.days = Number(value)
      i++
    } else if (flag === '--output' && value) {
      args.outputPath = value
      i++
    } else if (flag === '--help') {
      printHelp()
      process.exit(0)
    }
  }

  return args
}

function printHelp(): void {
  console.log(`
drift-list — analyze recent Claude Code sessions and surface practice exercises

Usage:
  npx tsx src/index.ts [options]

Options:
  --hours N     Analyze sessions from the last N hours (overrides --days)
  --days N      Analyze sessions from the last N days (default: 7)
  --output PATH Write report to PATH instead of ~/.drift-list/session-reports/

Examples:
  npx tsx src/index.ts --hours 2        # just the most recent session
  npx tsx src/index.ts --days 30        # last month
  npx tsx src/index.ts --output ./my-report.md
`.trim())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  const cutoff = new Date()
  if (args.hours !== undefined) {
    cutoff.setHours(cutoff.getHours() - args.hours)
    log(`Analyzing sessions from the last ${args.hours} hour(s)...`)
  } else {
    cutoff.setDate(cutoff.getDate() - args.days)
    log(`Analyzing sessions from the last ${args.days} day(s)...`)
  }

  // 1. Discover
  log('Discovering session files...')
  const sessions = await discoverSessions({ cutoff })
  if (sessions.length === 0) {
    log('No sessions found in the given time window. Try --days 30 or --hours 24.')
    process.exit(1)
  }
  log(`Found ${sessions.length} session file(s).`)

  // 2. Extract
  log('Extracting exchanges...')
  const exchanges = await extractExchanges({
    sessions,
    cutoff,
    onProgress: log,
  })
  if (exchanges.length === 0) {
    log('No user/assistant exchanges found. Sessions may be empty or all tool-only.')
    process.exit(1)
  }
  log(`Extracted ${exchanges.length} exchange(s) across ${new Set(exchanges.map(e => e.project)).size} project(s).`)

  // 3. Build session window metadata
  const timestamps = exchanges.map(e => e.timestamp).sort()
  const projects = [...new Set(exchanges.map(e => e.project))].sort()
  const sessionWindow = {
    from: timestamps[0],
    to: timestamps[timestamps.length - 1],
    sessionCount: sessions.length,
    projects,
  }

  // 4. Analyze
  const result = await analyze({
    exchanges,
    sessionWindow,
    onProgress: log,
  })

  // 5. Write report folder
  log('Writing report...')
  const reportDir = await writeReport({ result, outputPath: args.outputPath })

  // Print the path to stdout so it's easy to open / pipe
  console.log(reportDir)
  log(`Done. Report: ${reportDir}/report.md`)
}

function log(msg: string): void {
  process.stderr.write(`[drift-list] ${msg}\n`)
}

main().catch(err => {
  process.stderr.write(`[drift-list] Error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
