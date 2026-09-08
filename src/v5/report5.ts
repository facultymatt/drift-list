import fs from 'node:fs/promises'
import path from 'node:path'
import type { DecisionLog, RenderOutput, Decision } from './pipeline5.js'

export type Report5Meta = {
  start: Date
  end: Date
  sessionCount: number
  cwds: string[]
}

export type Report5Options = {
  reportDir: string
  log: DecisionLog
  render: RenderOutput
  meta: Report5Meta
}

/**
 * Write three artifacts to reportDir (which must already exist):
 *   decisions.json — the neutral decision log (phase 1)
 *   render.json    — watch list and questions (phase 2)
 *   report.md      — human-readable
 */
export async function writeReport5(opts: Report5Options): Promise<void> {
  const { reportDir, log, render, meta } = opts

  await Promise.all([
    fs.writeFile(path.join(reportDir, 'decisions.json'), JSON.stringify(log, null, 2), 'utf-8'),
    fs.writeFile(path.join(reportDir, 'render.json'), JSON.stringify(render, null, 2), 'utf-8'),
    fs.writeFile(path.join(reportDir, 'report.md'), renderMarkdown(log, render, meta), 'utf-8'),
  ])
}

/**
 * Escape model-supplied prose before it goes into markdown.
 *
 * Phase 1 evidence quotes transcript text verbatim, and that transcript is
 * often about writing HTML or CSS. A quote containing `<style>` is emitted as a
 * real style tag by any renderer that allows inline HTML, which silently
 * swallows the rest of the document — `<pre>` does the same to whitespace.
 * Escaping the angle brackets keeps the quote readable and inert.
 *
 * Only `<` is escaped. A bare `>` is harmless mid-line, and leaving it alone
 * avoids mangling arrows and comparisons that read fine as-is.
 */
function md(text: string): string {
  return text.replace(/</g, '&lt;')
}

function renderMarkdown(log: DecisionLog, render: RenderOutput, meta: Report5Meta): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const byId = new Map<string, Decision>(log.decisions.map(d => [d.id, d]))
  const s: string[] = []

  s.push('# Skill Drift — Session Analysis (v5)')
  s.push(
    `> ${fmt(meta.start)} → ${fmt(meta.end)} · ${meta.sessionCount} session${meta.sessionCount === 1 ? '' : 's'} · ${meta.cwds.join(', ')}`
  )
  // Provenance line — exact window and the command that produced this report.
  if (log.run) {
    s.push(`>`)
    s.push(`> \`${log.run.start}\` → \`${log.run.end}\``)
    s.push(`> \`${log.run.command}\``)
  }
  s.push('')

  // Reproduce block — the resolved window as copy-paste flags, so the reader can
  // re-run this exact range later. Just the flags, not a full command: the window
  // is the only non-reproducible part (an --hours run re-anchors to now), and the
  // reader already knows how they invoke the tool. --start/--end are always the
  // resolved ISO pair even when the original run used --hours.
  if (log.run) {
    s.push('**To re-run this exact time range later, use these flags:**')
    s.push('')
    s.push('```sh')
    s.push(`--start ${log.run.start} --end ${log.run.end}`)
    s.push('```')
    s.push('')
  }

  // --- Watch list ---------------------------------------------------------
  s.push('## Watch List — Where Claude Did the Driving')
  s.push('')

  if (render.watch_list.length === 0) {
    s.push('_Nothing surfaced in this window._')
    s.push('')
  }

  for (const item of render.watch_list) {
    const d = byId.get(item.id)
    s.push(`### ${md(item.title)}`)
    if (d) s.push(`*${d.kind}${d.surface === 'subagent' ? ' · via subagent' : ''}*`)
    s.push('')
    s.push(`**Why it matters:** ${md(item.why_it_matters)}`)
    s.push('')
    if (item.evidence) {
      s.push(`**Evidence:** ${md(item.evidence)}`)
      s.push('')
    }
    if (item.exercise) {
      s.push(`**Exercise:** ${md(item.exercise)}`)
    } else {
      s.push(`**Exercise:** *(omitted — ${md(item.exercise_omitted_because ?? 'no reason given')})*`)
    }
    s.push('')
  }

  // --- Questions ----------------------------------------------------------
  if (render.questions.length > 0) {
    s.push('## Architectural Questions')
    s.push('')
    render.questions.forEach((q, i) => {
      s.push(`**Q${i + 1}: ${md(q.question)}**`)
      s.push(`*${md(q.context)}*`)
      s.push('')
    })
  }

  // --- Concepts -----------------------------------------------------------
  if (render.concepts.length > 0) {
    s.push('## Concepts Touched')
    s.push('')
    s.push(render.concepts.join(' · '))
    s.push('')
  }

  // --- Constraints --------------------------------------------------------
  if (log.stated_constraints.length > 0) {
    s.push('## Constraints You Stated')
    s.push('')
    s.push('_These shaped how the findings above were weighted._')
    s.push('')
    for (const c of log.stated_constraints) {
      s.push(`- ${md(c.constraint)} (*"${md(c.quote)}"*)`)
    }
    s.push('')
  }

  // --- Full log -----------------------------------------------------------
  // Plain heading rather than a <details> block: raw HTML directly after a
  // markdown list gets absorbed into the list by some renderers, which indents
  // everything that follows.
  s.push('## Full Decision Log')
  s.push('')
  s.push('_Everything phase 1 recorded, including entries that did not make the watch list._')
  s.push('')
  for (const d of log.decisions) {
    s.push(`### ${d.id}`)
    s.push('')
    s.push(`${d.kind}${d.surface === 'subagent' ? ' · via subagent' : ''} · driver: ${d.driver} · engagement: ${d.engagement}`)
    s.push('')
    s.push(md(d.what))
    s.push('')
    if (d.skill_behind_it) {
      s.push(`Skill behind it: ${md(d.skill_behind_it)}`)
      s.push('')
    }
    if (d.alternatives_visible) {
      s.push(`Alternatives in the record: ${md(d.alternatives_visible)}`)
      s.push('')
    }
    if (d.concepts?.length) {
      s.push(`Concepts: ${d.concepts.join(', ')}`)
      s.push('')
    }
  }

  s.push('---')
  s.push(`*Generated by skill-drift (v5) · ${new Date().toISOString()}*`)

  return s.join('\n')
}