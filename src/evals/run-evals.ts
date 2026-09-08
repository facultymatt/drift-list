/**
 * Eval suite runner.
 *
 * Runs the analyzer over a set of fixed reference windows, applies the
 * deterministic checks, and collates everything into one directory you can zip
 * and hand to a reviewer — human or model.
 *
 *   npx tsx src/evals/run-evals.ts
 *   npx tsx src/evals/run-evals.ts --only timer-part1,timer-part2
 *   npx tsx src/evals/run-evals.ts --repeat 3        # variance
 *   npx tsx src/evals/run-evals.ts --reuse <dir>     # re-check a prior suite run
 *   npx tsx src/evals/run-evals.ts --checks-only     # grade existing artifacts, free
 *   npx tsx src/evals/run-evals.ts --label concepts-last
 *
 * Exit code is non-zero if any `fail`-severity check fails, so this drops into
 * CI unchanged. `--repeat` never fails the build: variance is being measured,
 * not asserted.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { CASES, type EvalCase } from './cases.js'
import { runAllChecks, checkRecall, type CheckResult } from './checks.js'
import { discoverSessions } from '../v6/discover6.js'
import { extractWindowExchanges } from '../v6/extract6.js'
import type { DecisionLog, RenderOutput } from '../v6/pipeline6.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ANALYZER = path.join('src', 'v6', 'analyze6.ts')

interface Args {
  only?: string[]
  repeat: number
  reuse?: string
  label?: string
  outDir?: string
  /**
   * Never invoke the analyzer. Grades artifacts already on disk, taken from
   * each case's `artifactDir` (or from --reuse). Costs nothing, so it is the
   * mode to use while iterating on the checks themselves.
   */
  checksOnly: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repeat: 1, checksOnly: false }
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--only' && value) {
      args.only = value.split(',').map(s => s.trim()).filter(Boolean)
      i++
    } else if (flag === '--repeat' && value) {
      args.repeat = Math.max(1, Number(value))
      i++
    } else if (flag === '--reuse' && value) {
      args.reuse = value
      i++
    } else if (flag === '--checks-only') {
      args.checksOnly = true
    } else if (flag === '--label' && value) {
      args.label = value
      i++
    } else if (flag === '--out' && value) {
      args.outDir = value
      i++
    } else if (flag === '--help') {
      console.log('See the header of src/evals/run-evals.ts for usage.')
      process.exit(0)
    } else {
      console.error(`Unrecognised argument "${flag}".`)
      process.exit(1)
    }
  }
  return args
}

function log(msg: string): void {
  process.stderr.write(`[evals] ${msg}\n`)
}

/** Run the analyzer as a subprocess so the eval harness tests the real CLI. */
function runAnalyzer(c: EvalCase, outputPath: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const argv = [
      ANALYZER,
      '--start', c.start,
      '--end', c.end,
      '--output', outputPath,
      ...(c.flags ?? []),
    ]
    const child = spawn('npx', ['tsx', ...argv], { cwd: REPO_ROOT })
    let captured = ''
    child.stdout.on('data', d => { captured += d.toString() })
    child.stderr.on('data', d => { captured += d.toString() })
    child.on('close', code => resolve({ ok: code === 0, output: captured }))
    child.on('error', err => resolve({ ok: false, output: String(err) }))
  })
}

interface CaseRun {
  case: EvalCase
  attempt: number
  dir: string
  ok: boolean
  log?: DecisionLog
  render?: RenderOutput
  checks: CheckResult[]
  error?: string
}

async function loadArtifacts(dir: string): Promise<{ log: DecisionLog; render: RenderOutput }> {
  const [log, render] = await Promise.all([
    fs.readFile(path.join(dir, 'decisions.json'), 'utf-8').then(JSON.parse),
    fs.readFile(path.join(dir, 'render.json'), 'utf-8').then(JSON.parse),
  ])
  return { log, render }
}

/**
 * Re-extract the exchanges phase 1 was given, so evidence quotes can be checked
 * against their actual source. Uses the same discovery and extraction the
 * analyzer uses, so the corpus matches what the model saw.
 */
async function exchangesFor(c: EvalCase) {
  const { sessions } = await discoverSessions({
    cutoff: new Date(c.start),
    dropReadOnlyAgents: !(c.flags ?? []).includes('--keep-readonly-agents'),
  })
  const { exchanges } = await extractWindowExchanges(sessions, new Date(c.start), new Date(c.end))
  return exchanges
}

function renderMarkdown(runs: CaseRun[], recall: Map<string, CheckResult>, args: Args): string {
  const s: string[] = []
  const failed = runs.filter(r => r.checks.some(c => c.severity === 'fail' && !c.passed) || !r.ok)

  s.push('# Skill Drift — eval run')
  s.push('')
  s.push(`> ${new Date().toISOString()}${args.label ? ` · ${args.label}` : ''}`)
  s.push(`> ${runs.length} run(s) across ${new Set(runs.map(r => r.case.id)).size} case(s)`)
  s.push(`> ${failed.length === 0 ? 'All hard checks passed.' : `${failed.length} run(s) with failures.`}`)
  s.push('')
  s.push('Deterministic checks only. Whether the watch list is *worth reading* is a')
  s.push('judgement call — that is what a reviewer of this artifact is for.')
  s.push('')

  s.push('## Summary')
  s.push('')
  s.push('| case | run | decisions | concepts | constraints | hard checks |')
  s.push('| --- | --- | --- | --- | --- | --- |')
  for (const r of runs) {
    const hard = r.checks.filter(c => c.severity === 'fail' && !c.skipped)
    const bad = hard.filter(c => !c.passed).length
    const skipped = r.checks.filter(c => c.skipped).length
    s.push(
      `| ${r.case.id} | ${r.attempt} | ${r.log?.decisions.length ?? '—'} | ` +
      `${r.log?.concepts.length ?? '—'} | ${r.log?.stated_constraints.length ?? '—'} | ` +
      `${r.ok ? (bad === 0 ? `${hard.length}/${hard.length} pass${skipped ? ` (${skipped} skipped)` : ''}` : `${bad} FAIL`) : 'run failed'} |`
    )
  }
  s.push('')

  if (recall.size > 0) {
    s.push('## Recall — wide windows vs their sub-windows')
    s.push('')
    s.push('A wide window that loses findings its own sub-windows produced is compressing.')
    s.push('Nothing downstream can recover them: `--skip-log` re-renders from `decisions.json`.')
    s.push('')
    for (const [caseId, result] of recall) {
      s.push(`**${caseId}** — ${result.summary}`)
      s.push('')
      if (result.details.length > 0) {
        s.push('Findings present in a narrow window but absent here:')
        s.push('')
        for (const d of result.details) s.push(`- ${d}`)
        s.push('')
      }
    }
  }

  s.push('## Per-case detail')
  s.push('')
  for (const r of runs) {
    s.push(`### ${r.case.id}${runs.filter(x => x.case.id === r.case.id).length > 1 ? ` (run ${r.attempt})` : ''}`)
    s.push('')
    s.push(r.case.description)
    s.push('')
    s.push(`\`${r.case.start}\` → \`${r.case.end}\`${r.case.flags?.length ? ` · flags: \`${r.case.flags.join(' ')}\`` : ''}`)
    s.push('')
    // Which artifact this assessment is OF. Without it a reviewer cannot find
    // the full report, and the eval report is an assessment, not a substitute.
    s.push(`Artifact: \`${path.relative(REPO_ROOT, r.dir)}\``)
    s.push('')

    if (!r.ok) {
      s.push('**The analyzer failed on this case.**')
      s.push('')
      s.push('```')
      s.push((r.error ?? '').slice(-1500))
      s.push('```')
      s.push('')
      continue
    }

    if (r.case.groundTruth?.length) {
      s.push('**Known ground truth**')
      s.push('')
      for (const g of r.case.groundTruth) s.push(`- ${g}`)
      s.push('')
    }

    for (const c of r.checks) {
      const icon = c.check === 'distribution'
        ? ''
        : c.skipped
          ? 'SKIP — '
          : c.passed ? 'PASS — ' : c.severity === 'fail' ? 'FAIL — ' : 'WARN — '
      s.push(`**${icon}${c.check}**: ${c.summary}`)
      s.push('')
      if (c.details.length > 0) {
        for (const d of c.details.slice(0, 20)) s.push(`- ${d}`)
        if (c.details.length > 20) s.push(`- …and ${c.details.length - 20} more`)
        s.push('')
      }
    }

    if (r.render) {
      // The four things a reviewer actually reads. Deliberately NOT evidence,
      // skill labels or why_it_matters — those are the workings, and they live
      // in the analyzer's own report with the context around them. Duplicating
      // them here produces a second document that drifts from the first.
      s.push('**Watch list**')
      s.push('')
      for (const item of r.render.watch_list) {
        const d = r.log?.decisions.find(x => x.id === item.id)
        s.push(`- **${item.title}**`)
        s.push(`    - ${d ? `kind: ${d.kind} · driver: ${d.driver} · engagement: ${d.engagement}` : 'unresolved id'}`)
        if (d?.concepts?.length) s.push(`    - concepts: ${d.concepts.join(', ')}`)
        s.push(
          item.exercise
            ? `    - exercise: ${item.exercise}`
            : `    - exercise: *(omitted — ${item.exercise_omitted_because ?? 'no reason given'})*`,
        )
      }
      s.push('')

      s.push('**Questions**')
      s.push('')
      for (const q of r.render.questions) s.push(`- ${q.question}`)
      s.push('')
    }
  }

  s.push('---')
  s.push('')
  s.push('## For a reviewer')
  s.push('')
  s.push('The checks above cover what is mechanically verifiable. What they cannot judge:')
  s.push('')
  s.push('- Is each watch item a skill worth practising, or mechanical detail padding the list?')
  s.push('- Do the questions have real answers, or do they invent a tradeoff to justify asking?')
  s.push('- Is the driver/engagement split honest against the ground truth above?')
  s.push('- Which findings would you have wanted that appear nowhere?')
  s.push('')
  s.push('Evidence, skill labels and the reasoning behind each item are in the')
  s.push('analyzer\'s own `report.md` at the artifact path above — read that when an')
  s.push('answer here looks wrong and you want to know why.')
  s.push('')

  return s.join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const selected = args.only ? CASES.filter(c => args.only!.includes(c.id)) : CASES

  if (selected.length === 0) {
    log('No cases selected.')
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = args.outDir ?? path.join(REPO_ROOT, 'src', 'evals', 'results', `${stamp}${args.label ? `-${args.label}` : ''}`)
  await fs.mkdir(outDir, { recursive: true })

  const runs: CaseRun[] = []

  for (const c of selected) {
    for (let attempt = 1; attempt <= args.repeat; attempt++) {
      const suffix = args.repeat > 1 ? `-run${attempt}` : ''
      const caseDir = args.reuse
        ? path.join(args.reuse, `${c.id}${suffix}`)
        : path.join(outDir, `${c.id}${suffix}`)

      let ok = true
      let error: string | undefined

      // Resolve where this run's artifacts live. --checks-only never spawns the
      // analyzer, so it needs them to exist already.
      const artifactDir = args.reuse
        ? caseDir
        : c.artifactDir
          ? path.resolve(REPO_ROOT, c.artifactDir)
          : caseDir

      if (args.checksOnly) {
        log(`checking ${c.id}${suffix} from ${artifactDir} (no API calls)`)
        try {
          await fs.access(path.join(artifactDir, 'decisions.json'))
        } catch {
          ok = false
          error =
            `--checks-only: no decisions.json at ${artifactDir}. ` +
            `Set artifactDir on this case, or run without --checks-only.`
        }
      } else if (!args.reuse) {
        log(`running ${c.id}${suffix}...`)
        const res = await runAnalyzer(c, caseDir)
        ok = res.ok
        if (!ok) error = res.output
      } else {
        log(`re-checking ${c.id}${suffix} from ${caseDir}`)
      }

      const run: CaseRun = { case: c, attempt, dir: artifactDir, ok, checks: [], error }

      if (ok) {
        try {
          const { log: decisionLog, render } = await loadArtifacts(artifactDir)
          const exchanges = await exchangesFor(c).catch(() => [])
          if (exchanges.length === 0) {
            log(`  no exchanges for ${c.id} — evidence checks will be skipped`)
          }
          run.log = decisionLog
          run.render = render
          run.checks = runAllChecks(decisionLog, render, exchanges)
        } catch (err) {
          run.ok = false
          run.error = err instanceof Error ? err.message : String(err)
        }
      }

      runs.push(run)
    }
  }

  // Recall: only meaningful on the first attempt of each case.
  const recall = new Map<string, CheckResult>()
  for (const c of selected) {
    if (!c.shouldContainFindingsFrom?.length) continue
    const wide = runs.find(r => r.case.id === c.id && r.attempt === 1)?.log
    if (!wide) continue
    const narrow = c.shouldContainFindingsFrom
      .map(id => ({ caseId: id, log: runs.find(r => r.case.id === id && r.attempt === 1)?.log }))
      .filter((n): n is { caseId: string; log: DecisionLog } => Boolean(n.log))
    if (narrow.length === 0) {
      log(`skipping recall for ${c.id}: sub-window cases were not run`)
      continue
    }
    recall.set(c.id, checkRecall(wide, narrow))
  }

  const markdown = renderMarkdown(runs, recall, args)
  await fs.writeFile(path.join(outDir, 'EVAL-REPORT.md'), markdown, 'utf-8')
  await fs.writeFile(
    path.join(outDir, 'results.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        label: args.label ?? null,
        repeat: args.repeat,
        node: process.version,
        platform: `${os.platform()} ${os.release()}`,
        runs: runs.map(r => ({
          case: r.case.id,
          attempt: r.attempt,
          ok: r.ok,
          decisions: r.log?.decisions.length ?? null,
          concepts: r.log?.concepts.length ?? null,
          constraints: r.log?.stated_constraints.length ?? null,
          checks: r.checks.map(c => ({
            check: c.check, severity: c.severity, passed: c.passed, skipped: c.skipped ?? false,
            summary: c.summary, details: c.details,
          })),
        })),
        recall: [...recall.entries()].map(([id, r]) => ({
          case: id, summary: r.summary, missing: r.details,
        })),
      },
      null,
      2,
    ),
    'utf-8',
  )

  const hardFailures = runs.filter(
    r => !r.ok || r.checks.some(c => c.severity === 'fail' && !c.passed && !c.skipped),
  )
  const recallFailures = [...recall.values()].filter(r => !r.passed)

  log('')
  log(`report: ${path.join(outDir, 'EVAL-REPORT.md')}`)
  log(`zip this directory to share: ${outDir}`)
  for (const [id, r] of recall) log(`recall ${id}: ${r.summary}`)

  if (args.repeat > 1) {
    log('repeat mode — measuring variance, not asserting. Exit 0.')
    process.exit(0)
  }
  if (hardFailures.length > 0 || recallFailures.length > 0) {
    log(`${hardFailures.length} run(s) with hard failures, ${recallFailures.length} recall failure(s).`)
    process.exit(1)
  }
  log('all hard checks passed.')
}

main().catch(err => {
  console.error('[evals] Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
