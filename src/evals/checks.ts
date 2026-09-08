/**
 * Code-based evaluators.
 *
 * These are assertions, not judgements: fast, deterministic, no model call.
 * They cover the failure modes that are objectively checkable, which is most of
 * the ones that have actually bitten this project — a schema field silently
 * disappearing, an evidence quote the transcript does not contain, duplicate
 * watch-list ids. Anything requiring taste (is this watch item worth an
 * engineer's attention?) is left to the human or an LLM judge reading the
 * collated artifact.
 */

import type { Decision, DecisionLog, RenderOutput } from '../v6/pipeline6.js'
import type { Exchange } from '../v6/types6.js'

export type Severity = 'fail' | 'warn'

export interface CheckResult {
  check: string
  severity: Severity
  passed: boolean
  /**
   * True when the check could not run — usually because the session logs for
   * this window are no longer on disk, so evidence has nothing to match
   * against. A skipped check must never read as a failure: 0/16 quotes
   * traceable against an empty corpus means "no data", not "all fabricated".
   */
  skipped?: boolean
  /** One line for the summary table */
  summary: string
  /** Specific offending items, for the detail section */
  details: string[]
}

const DRIVERS = new Set(['engineer', 'claude', 'joint'])
const ENGAGEMENTS = new Set(['directed', 'questioned', 'acknowledged', 'none'])
const KINDS = new Set(['decision', 'pattern', 'reversal', 'bug'])

/**
 * Normalise text for quote matching. Models reflow whitespace and swap straight
 * quotes for curly ones when echoing a transcript, so a raw substring test
 * produces false failures.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[`'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip a leading speaker label: `Claude: '...'` -> `...` */
function stripSpeaker(evidence: string): string {
  return evidence.replace(/^\s*(claude|engineer|user|subagent)\s*(\(to subagent\))?\s*:\s*/i, '')
}

/**
 * Phase 1 sometimes returns a citation sentence rather than a bare quote:
 * `Claude noted 'X' in the summary.` The narration is not in the transcript, so
 * matching the whole field fails on evidence that is perfectly well grounded.
 * Prefer the longest quoted span when one is present.
 */
function extractQuotedSpan(evidence: string): string {
  const spans = [...evidence.matchAll(/['"\u2018\u201c]([^'"\u2019\u201d]{12,})['"\u2019\u201d]/g)]
    .map(m => m[1])
    .sort((a, b) => b.length - a.length)
  return spans[0] ?? evidence
}

/** Longest run of words from `needle` that appears in `haystack`. */
function longestRunRatio(needle: string, haystack: string): number {
  const words = needle.split(' ').filter(Boolean)
  if (words.length === 0) return 0
  let best = 0
  for (let start = 0; start < words.length; start++) {
    for (let end = words.length; end > start + best; end--) {
      const phrase = words.slice(start, end).join(' ')
      if (phrase.length > 8 && haystack.includes(phrase)) {
        best = Math.max(best, end - start)
        break
      }
    }
  }
  return best / words.length
}

/**
 * Every evidence quote should be traceable to an exchange phase 1 was given.
 *
 * This is the fabrication detector. Three separate incidents in this project
 * were the model supplying reasoning the record did not contain — a decision
 * asserting code had no error handling, a question inventing a build-overhead
 * tradeoff, a watch item claiming a design encoded two dimensions when it
 * encoded one. Each would have shown up here as an unmatched quote.
 *
 * Matched loosely on purpose: the model paraphrases lightly and truncates. A
 * quote sharing a long contiguous run with some exchange is doing its job.
 */
export function checkEvidenceGrounded(log: DecisionLog, exchanges: Exchange[]): CheckResult {
  const corpus = exchanges.map(e => normalise(`${e.userText} ${e.assistantText}`))
  if (corpus.length === 0) {
    return {
      check: 'evidence grounded in transcript',
      severity: 'fail',
      passed: true,
      skipped: true,
      summary: 'skipped — no exchanges available for this window',
      details: ['Session logs for this window are not on disk, so quotes cannot be verified.'],
    }
  }
  const unmatched: string[] = []

  for (const d of log.decisions) {
    if (!d.evidence) {
      unmatched.push(`${d.id}: no evidence field`)
      continue
    }
    const quote = normalise(stripSpeaker(extractQuotedSpan(d.evidence)))
    const hit = corpus.some(text => text.includes(quote) || longestRunRatio(quote, text) >= 0.5)
    if (!hit) unmatched.push(`${d.id}: ${d.evidence.slice(0, 110)}`)
  }

  return {
    check: 'evidence grounded in transcript',
    severity: 'fail',
    passed: unmatched.length === 0,
    summary: `${log.decisions.length - unmatched.length}/${log.decisions.length} evidence quotes traceable`,
    details: unmatched,
  }
}

/**
 * Required fields present and enum values valid.
 *
 * `project` drifted out of the schema silently in v3 and printed `undefined`
 * across 37 report lines before anyone noticed. This is that alarm.
 */
export function checkSchema(log: DecisionLog): CheckResult {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const d of log.decisions as Decision[]) {
    if (!d.id) problems.push('an entry has no id')
    else if (seen.has(d.id)) problems.push(`duplicate decision id: ${d.id}`)
    else seen.add(d.id)

    if (!d.what?.trim()) problems.push(`${d.id}: empty what`)
    if (!DRIVERS.has(d.driver)) problems.push(`${d.id}: bad driver "${d.driver}"`)
    if (!ENGAGEMENTS.has(d.engagement)) problems.push(`${d.id}: bad engagement "${d.engagement}"`)
    if (!KINDS.has(d.kind)) problems.push(`${d.id}: bad kind "${d.kind}"`)
    if (!Array.isArray(d.concepts) || d.concepts.length === 0) {
      problems.push(`${d.id}: no concepts`)
    }
  }

  return {
    check: 'decision schema valid',
    severity: 'fail',
    passed: problems.length === 0,
    summary: problems.length === 0 ? 'all fields present and valid' : `${problems.length} problem(s)`,
    details: problems,
  }
}

/** related_ids must resolve to entries in the same log. */
export function checkRelatedIds(log: DecisionLog): CheckResult {
  const ids = new Set(log.decisions.map(d => d.id))
  const dangling: string[] = []
  let total = 0

  for (const d of log.decisions) {
    for (const r of d.related_ids ?? []) {
      total++
      if (r === d.id) dangling.push(`${d.id} -> itself`)
      else if (!ids.has(r)) dangling.push(`${d.id} -> ${r} (no such entry)`)
    }
  }

  return {
    check: 'related_ids resolve',
    severity: 'fail',
    passed: dangling.length === 0,
    summary: `${total - dangling.length}/${total} links resolve`,
    details: dangling,
  }
}

/** Watch-list ids must be unique. Known open bug — duplicates have shipped. */
export function checkWatchListIds(render: RenderOutput): CheckResult {
  const counts = new Map<string, number>()
  for (const item of render.watch_list) {
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  }
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`)

  return {
    check: 'watch list ids unique',
    severity: 'fail',
    passed: dupes.length === 0,
    summary: dupes.length === 0 ? `${render.watch_list.length} unique` : `${dupes.length} duplicate(s)`,
    details: dupes,
  }
}

/**
 * An exercise should not name the thing it is asking you to derive.
 *
 * Heuristic: backticked identifiers in the decision text are the answer. If one
 * appears in the exercise, the exercise gave it away. Warn rather than fail —
 * sometimes naming the API is the point.
 */
export function checkExerciseLeaks(log: DecisionLog, render: RenderOutput): CheckResult {
  const byId = new Map(log.decisions.map(d => [d.id, d]))
  const leaks: string[] = []

  for (const item of render.watch_list) {
    if (!item.exercise) continue
    const source = byId.get(item.id)
    const text = `${source?.what ?? ''} ${source?.skill_behind_it ?? ''}`
    const identifiers = [...text.matchAll(/`([A-Za-z_][\w.]{3,})`/g)].map(m => m[1])
    const exercise = item.exercise.toLowerCase()
    const given = [...new Set(identifiers)].filter(i => exercise.includes(i.toLowerCase()))
    if (given.length > 0) leaks.push(`${item.id}: names ${given.join(', ')}`)
  }

  return {
    check: 'exercises do not name the method',
    severity: 'warn',
    passed: leaks.length === 0,
    summary: leaks.length === 0 ? 'none give away the answer' : `${leaks.length} may give it away`,
    details: leaks,
  }
}

/**
 * Every recorded constraint must quote an ENGINEER turn.
 *
 * The previous version scanned for cue phrases ("best practice", "i want",
 * "must") and warned when none were recorded. That was a keyword list invented
 * without evidence, and it lost in both directions: "Needs to be TS and have
 * typing" matched none of the cues, and it could only ever fire on the empty
 * case, never on a constraint recorded wrongly.
 *
 * This version inverts it — verify what was recorded rather than guess at what
 * should have been. It catches misattribution (a constraint sourced from
 * Claude's own words) as well as fabrication, and needs no keyword list. It
 * cannot detect a MISSED constraint; that is what the human reviewer is for,
 * and a check that cannot see its own blind spot is worse than one that does
 * not pretend to.
 *
 * Note this cannot see constraints from CLAUDE.md / AGENTS.md at all — those
 * are injected into the system prompt, never appear in the transcript, and are
 * a known open gap.
 */
export function checkConstraintsGrounded(log: DecisionLog, exchanges: Exchange[]): CheckResult {
  if (exchanges.length === 0) {
    return {
      check: 'constraints quote engineer turns',
      severity: 'warn',
      passed: true,
      skipped: true,
      summary: `${log.stated_constraints.length} recorded — cannot check, no exchanges available`,
      details: [],
    }
  }

  const engineerText = exchanges
    .filter(e => e.userText.trim().length > 0)
    .map(e => normalise(e.userText))

  const problems: string[] = []
  for (const c of log.stated_constraints) {
    const quote = normalise(stripSpeaker(extractQuotedSpan(c.quote ?? '')))
    if (!quote) {
      problems.push(`"${(c.constraint ?? '').slice(0, 70)}" has no quote`)
      continue
    }
    const hit = engineerText.some(t => t.includes(quote) || longestRunRatio(quote, t) >= 0.5)
    if (!hit) problems.push(`not found in any engineer turn: ${(c.quote ?? '').slice(0, 90)}`)
  }

  return {
    check: 'constraints quote engineer turns',
    severity: 'warn',
    passed: problems.length === 0,
    summary:
      log.stated_constraints.length === 0
        ? 'none recorded (a miss here is invisible to this check — see the reviewer notes)'
        : `${log.stated_constraints.length - problems.length}/${log.stated_constraints.length} trace to an engineer turn`,
    details: problems,
  }
}

/**
 * A window containing no engineer-authored exchanges makes every attribution
 * number meaningless — and, worse, makes a broken run look clean.
 *
 * This is not hypothetical. The first timer example was generated with
 * `--hours 0.11`, which computes `start = now - N` and landed 74 seconds after
 * the engineer's last prompt. The run captured only Claude's implementation and
 * scored 16/16 `driver: claude` / `engagement: none`, which was initially read
 * as the tool correctly grading total delegation. It was the right answer to the
 * wrong question. `stated_constraints: 0` looked like an extraction bug for the
 * same reason.
 *
 * Hard failure: a clipped window invalidates the distribution, the constraints
 * check and the driver split all at once, and nothing else in the suite notices.
 */
export function checkWindowHasEngineerTurns(exchanges: Exchange[]): CheckResult {
  if (exchanges.length === 0) {
    return {
      check: 'window contains engineer turns',
      severity: 'fail',
      passed: true,
      skipped: true,
      summary: 'skipped — no exchanges available for this window',
      details: [],
    }
  }

  // v6's Exchange carries no author flag — read-only subagent transcripts are
  // dropped at discovery instead. What distinguishes an engineer turn here is
  // that it HAS user text: a tool_result record produces an exchange whose
  // userText is empty, because extraction keeps only `text` blocks.
  const engineer = exchanges.filter(e => e.userText.trim().length > 0)
  const passed = engineer.length > 0

  return {
    check: 'window contains engineer turns',
    severity: 'fail',
    passed,
    summary: passed
      ? `${engineer.length}/${exchanges.length} exchanges carry engineer text`
      : 'NO engineer text in this window — every attribution number is meaningless',
    details: passed
      ? []
      : [
          'The window opens after the engineer stopped typing, so it captures only',
          'Claude working. A distribution of all-claude/all-none here is an artifact',
          'of the window, not a finding. Widen the window to cover the first prompt.',
        ],
  }
}

/**
 * Every watch item must resolve to a decision in the same log.
 *
 * `WatchListItem.id` IS the decision id — the report relies on that to print
 * kind, driver, engagement and concepts. An unresolvable id does not error; the
 * metadata line silently disappears. Same failure shape as the known duplicate
 * watch-id bug, and this catches both.
 */
export function checkWatchItemsResolve(log: DecisionLog, render: RenderOutput): CheckResult {
  const ids = new Set(log.decisions.map(d => d.id))
  const orphans = render.watch_list.filter(i => !ids.has(i.id)).map(i => `${i.id}: ${i.title.slice(0, 80)}`)

  return {
    check: 'watch items resolve to decisions',
    severity: 'fail',
    passed: orphans.length === 0,
    summary: `${render.watch_list.length - orphans.length}/${render.watch_list.length} resolve`,
    details: orphans,
  }
}

/**
 * A concept label whose subject never appears in the window is a taxonomy-forced
 * miscue: the model must tag every entry, nothing fits, so it reaches for the
 * nearest available label.
 *
 * Caught exactly this on a standalone recursive tree utility with no React in
 * it, which came back tagged `react-performance` and `react-composition`. The
 * taxonomy had no label for recursion, traversal or complexity, so those entries
 * landed on the closest thing available.
 *
 * A warning, not a failure. Some labels are legitimately about an absence — a
 * decision NOT to add error handling is still `error-handling` — so this points
 * at where to look rather than asserting a bug. Only labels whose keyword should
 * plausibly appear as a literal string are listed; abstract ones are skipped.
 */
const CONCEPT_KEYWORDS: Record<string, string[]> = {
  'react-state': ['react', 'usestate', 'usereducer'],
  'react-effects': ['react', 'useeffect'],
  'react-context': ['react', 'context', 'provider'],
  'react-refs': ['react', 'useref'],
  'react-performance': ['react', 'memo', 'rerender', 're-render', 'virtualiz'],
  'react-portals': ['react', 'portal', 'modal', 'dialog'],
  'react-suspense': ['react', 'suspense', 'lazy', 'boundary'],
  'react-data-flow': ['react', 'fetch', 'query', 'cache'],
  'react-forms': ['react', 'form', 'input', 'controlled'],
  'react-composition': ['react', 'component', 'hook', 'children'],
  'react-server': ['react', 'ssr', 'hydrat', 'server component'],
  'rendering-graphics': ['canvas', 'webgl', 'shader', 'three'],
  'rendering-tables': ['table', 'grid', 'row', 'column'],
  'tooling-testing': ['test', 'spec', 'vitest', 'jest', 'assert'],
  'tooling-deploy': ['docker', 'deploy', 'container', 'helm', 'kubernetes'],
  'time-handling': ['time', 'date', 'timezone', 'duration', 'timestamp'],
  'algo-recursion': ['recurs', 'base case', 'stack'],
  'algo-traversal': ['travers', 'depth-first', 'breadth-first', 'visit'],
  'data-structures': ['tree', 'graph', 'node', 'cycle'],
}

export function checkConceptsGrounded(log: DecisionLog, exchanges: Exchange[]): CheckResult {
  if (exchanges.length === 0) {
    return {
      check: 'concept labels grounded',
      severity: 'warn',
      passed: true,
      skipped: true,
      summary: 'skipped — no exchanges available for this window',
      details: [],
    }
  }
  const corpus = normalise(exchanges.map(e => `${e.userText} ${e.assistantText}`).join(' '))
  const suspect: string[] = []

  for (const concept of log.concepts) {
    const keywords = CONCEPT_KEYWORDS[concept]
    if (!keywords) continue // abstract label, nothing literal to look for
    if (!keywords.some(k => corpus.includes(k))) {
      suspect.push(`${concept}: none of [${keywords.join(', ')}] appear in the window`)
    }
  }

  return {
    check: 'concept labels grounded',
    severity: 'warn',
    passed: suspect.length === 0,
    summary: suspect.length === 0
      ? `${log.concepts.length} labels plausible`
      : `${suspect.length} of ${log.concepts.length} label(s) look forced`,
    details: suspect,
  }
}

/** Distribution snapshot. Never fails — context for whoever reads the artifact. */
export function summariseDistribution(log: DecisionLog, render: RenderOutput): CheckResult {
  const count = (key: keyof Decision) => {
    const m = new Map<string, number>()
    for (const d of log.decisions) {
      const v = String(d[key])
      m.set(v, (m.get(v) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' ')
  }

  return {
    check: 'distribution',
    severity: 'warn',
    passed: true,
    summary:
      `${log.decisions.length} decisions, ${log.concepts.length} concepts, ` +
      `${log.stated_constraints.length} constraints, ${render.watch_list.length} watch, ` +
      `${render.questions.length} questions`,
    details: [
      `driver:     ${count('driver')}`,
      `engagement: ${count('engagement')}`,
      `kind:       ${count('kind')}`,
      `exercises:  ${render.watch_list.filter(i => i.exercise).length}/${render.watch_list.length}`,
      `skill_behind_it null: ${log.decisions.filter(d => !d.skill_behind_it).length}`,
    ],
  }
}

/**
 * Recall: does a wide window contain the findings its sub-windows produced?
 *
 * Matched on evidence quotes, not ids. Slugs churn between runs even when the
 * finding is identical — two runs sharing ~16 findings had 4 matching ids — so
 * id comparison badly understates overlap.
 */
export function checkRecall(
  wide: DecisionLog,
  narrow: { caseId: string; log: DecisionLog }[],
): CheckResult {
  const wideQuotes = wide.decisions.map(d => normalise(stripSpeaker(d.evidence ?? '')))
  const missing: string[] = []
  let total = 0

  for (const { caseId, log } of narrow) {
    for (const d of log.decisions) {
      total++
      const q = normalise(stripSpeaker(d.evidence ?? ''))
      if (!q) continue
      const hit = wideQuotes.some(w => w.includes(q) || q.includes(w) || longestRunRatio(q, w) >= 0.6)
      if (!hit) missing.push(`${caseId}/${d.id}: ${d.what.slice(0, 90)}`)
    }
  }

  const recovered = total - missing.length
  const pct = total > 0 ? Math.round((recovered / total) * 100) : 100

  return {
    check: 'recall vs narrow windows',
    severity: 'fail',
    passed: missing.length === 0,
    summary: `${recovered}/${total} findings present (${pct}% recall)`,
    details: missing,
  }
}

export function runAllChecks(
  log: DecisionLog,
  render: RenderOutput,
  exchanges: Exchange[],
): CheckResult[] {
  return [
    summariseDistribution(log, render),
    checkSchema(log),
    checkEvidenceGrounded(log, exchanges),
    checkRelatedIds(log),
    checkWatchListIds(render),
    checkWindowHasEngineerTurns(exchanges),
    checkWatchItemsResolve(log, render),
    checkExerciseLeaks(log, render),
    checkConstraintsGrounded(log, exchanges),
    checkConceptsGrounded(log, exchanges),
  ]
}
