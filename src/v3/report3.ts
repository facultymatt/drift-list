import fs from 'node:fs/promises'
import path from 'node:path'
import type { DecisionLog, RenderOutput, Decision } from './pipeline3.js'

export type Report3Meta = {
  start: Date
  end: Date
  sessionCount: number
  projects: string[]
}

export type Report3Options = {
  reportDir: string
  log: DecisionLog
  render: RenderOutput
  meta: Report3Meta
}

/**
 * Write three artifacts to reportDir (which must already exist):
 *   decisions.json — the neutral decision log (phase 1)
 *   render.json    — watch list and questions (phase 2)
 *   report.md      — human-readable
 */
export async function writeReport3(opts: Report3Options): Promise<void> {
  const { reportDir, log, render, meta } = opts

  await Promise.all([
    fs.writeFile(path.join(reportDir, 'decisions.json'), JSON.stringify(log, null, 2), 'utf-8'),
    fs.writeFile(path.join(reportDir, 'render.json'), JSON.stringify(render, null, 2), 'utf-8'),
    fs.writeFile(path.join(reportDir, 'report.md'), renderMarkdown(log, render, meta), 'utf-8'),
  ])
}

function renderMarkdown(log: DecisionLog, render: RenderOutput, meta: Report3Meta): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const byId = new Map<string, Decision>(log.decisions.map(d => [d.id, d]))
  const s: string[] = []

  s.push('# Drift List — Session Analysis (v3)')
  s.push(
    `> ${fmt(meta.start)} → ${fmt(meta.end)} · ${meta.sessionCount} session${meta.sessionCount === 1 ? '' : 's'} · ${meta.projects.join(', ')}`
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

  // Filter caveat — a filtered run sees less than the full window, so a thin
  // report may reflect the filter rather than the work. Surfaced here so a
  // reader of the artifact (not just the person who ran it) understands the scope.
  if (log.run?.projectFilter && log.run.projectFilter.length > 0) {
    s.push(
      `> ⚠️ **Filtered run** — only sessions touching ` +
      `\`${log.run.projectFilter.join('`, `')}\` were analyzed. ` +
      `Cross-project and whole-session design decisions may be under-reported. ` +
      `Re-run without \`--project\` for full coverage.`
    )
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
    s.push(`### ${item.title}`)
    if (d) s.push(`*${d.project} · ${d.kind}*`)
    s.push('')
    s.push(`**Why it matters:** ${item.why_it_matters}`)
    s.push('')
    if (item.evidence) {
      s.push(`**Evidence:** ${item.evidence}`)
      s.push('')
    }
    if (item.exercise) {
      s.push(`**Exercise:** ${item.exercise}`)
    } else {
      s.push(`**Exercise:** *(omitted — ${item.exercise_omitted_because ?? 'no reason given'})*`)
    }
    s.push('')
  }

  // --- Questions ----------------------------------------------------------
  if (render.questions.length > 0) {
    s.push('## Architectural Questions')
    s.push('')
    render.questions.forEach((q, i) => {
      s.push(`**Q${i + 1}: ${q.question}**`)
      s.push(`*${q.context}*`)
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
      s.push(`- **${c.project}** — ${c.constraint} (*"${c.quote}"*)`)
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
    s.push(`${d.project} · ${d.kind} · driver: ${d.driver} · engagement: ${d.engagement}`)
    s.push('')
    s.push(d.what)
    s.push('')
    if (d.skill_behind_it) {
      s.push(`Skill behind it: ${d.skill_behind_it}`)
      s.push('')
    }
    if (d.alternatives_visible) {
      s.push(`Alternatives in the record: ${d.alternatives_visible}`)
      s.push('')
    }
    if (d.concepts?.length) {
      s.push(`Concepts: ${d.concepts.join(', ')}`)
      s.push('')
    }
  }

  s.push('---')
  s.push(`*Generated by drift-list (v3) · ${new Date().toISOString()}*`)

  return s.join('\n')
}