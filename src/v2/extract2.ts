import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { SessionFile } from '../v1/discover.js'
import type { Exchange, RawRecord, ContentBlock } from '../v1/types.js'

// User turns carry the task brief, where constraints and design intent live —
// often past the first paragraph. Assistant turns carry reasoning. Both caps
// are generous enough to keep a full brief or a full rationale; the length
// distribution shows almost every turn is far shorter, so the token cost of
// the higher ceiling is small and falls only on the rare long, dense turn.
const MAX_USER_CHARS = 2000
const MAX_ASSISTANT_CHARS = 2000
// @note was previously - might be worth using larger model? 
// const MAX_USER_CHARS = 600
// const MAX_ASSISTANT_CHARS = 1200

// Claude Code writes this synthetic user record immediately after a compaction.
// It contains a summarized transcript, not a real user prompt.
const COMPACTION_PREFIX = 'This session is being continued from a previous conversation that ran out of context.'

/**
 * Extract exchanges from session files that fall within [start, end].
 *
 * Unlike extractExchanges(), this function:
 * - Accepts an explicit end date rather than a single cutoff
 * - Has no exchange cap (needed for historical windows where newest-first
 *   ordering would otherwise fill the cap with out-of-window exchanges)
 * - Optionally filters by project: the project is derived from the file paths
 *   Claude actually edited (not from cwd), so "--project example" matches a
 *   session whose edits landed under .../Sites/EXAMPLE/... even when Claude
 *   Code was launched from a different directory.
 */
export async function extractWindowExchanges(
  sessions: SessionFile[],
  start: Date,
  end: Date,
  onProgress?: (msg: string) => void,
  projects?: string[],
): Promise<Exchange[]> {
  const all: Exchange[] = []

  for (const session of sessions) {
    onProgress?.(`Parsing ${path.basename(session.filePath)}...`)
    const exchanges = await parseSession(session.filePath, projects)
    const inWindow = exchanges.filter(e => {
      const ts = new Date(e.timestamp)
      return ts >= start && ts <= end
    })
    all.push(...inWindow)
  }

  return all
}

async function parseSession(filePath: string, projects?: string[]): Promise<Exchange[]> {
  const records = await readJsonlFile(filePath)
  const exchanges: Exchange[] = []

  // Collect every file path Claude touched across the whole session, so the
  // project can be derived from where the work actually happened rather than
  // from cwd (which is just wherever Claude Code was launched from).
  const sessionFilePaths: string[] = []
  for (const record of records) {
    if (record.type === 'assistant') {
      sessionFilePaths.push(...toolFilePaths(record))
    }
  }
  const sessionProject = projectFromPaths(sessionFilePaths)

  let pendingUser: { text: string; cwd: string; timestamp: string } | null = null

  for (const record of records) {
    if (record.type === 'user') {
      const text = extractUserText(record)
      if (text.startsWith(COMPACTION_PREFIX)) continue
      const cwd = record.cwd ?? ''
      pendingUser = {
        text,
        cwd,
        timestamp: record.timestamp ?? new Date().toISOString(),
      }
    } else if (record.type === 'assistant' && pendingUser) {
      const assistantText = extractAssistantText(record)
      const activity = toolActivityDigest(record)
      // Keep the exchange if Claude either said something or did something.
      // Implementation-heavy turns are mostly tool calls with little prose;
      // dropping them (as the old text-only filter did) is exactly how the
      // interesting work in an implementation session went missing.
      if (assistantText.length === 0 && activity.length === 0) continue

      const combined = [
        assistantText.slice(0, MAX_ASSISTANT_CHARS),
        activity.length > 0 ? `\n\n[actions]\n${activity}` : '',
      ].join('')

      exchanges.push({
        project: sessionProject,
        timestamp: pendingUser.timestamp,
        userText: pendingUser.text.slice(0, MAX_USER_CHARS),
        assistantText: combined,
      })
      pendingUser = null
    }
  }

  // Project filtering runs on the derived project (from edited file paths),
  // not on cwd, so "--project example" matches where the edits landed.
  //
  // LIMITATION — filtering is lossy in a way that is not obvious. It is applied
  // per session: a session is kept only if its edited files place it in a wanted
  // project. But a single design decision often spans a whole session, and its
  // reasoning can begin in planning turns that don't yet touch the filtered
  // project's files. Those turns — and the engineer-driven design decisions in
  // them — are dropped before phase 1 sees them. The net effect is a filtered
  // run biases toward mechanical, in-file patterns and away from cross-cutting
  // judgment. This is inherent to filtering on file paths, not a bug: you cannot
  // both scope to one project and keep reasoning that lives outside it. Treat
  // --project as a deliberate focusing tool for testing or narrowing; all
  // projects (no filter) is the truthful default for a real skill-drift report.
  if (projects && projects.length > 0) {
    const wanted = projects.map(p => p.toLowerCase())
    if (!wanted.some(p => sessionProject.toLowerCase().includes(p))) return []
  }

  return exchanges
}

// Tool calls whose input carries a file path we can attribute to a project.
const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

function toolFilePaths(record: RawRecord): string[] {
  const content = record.message?.content
  if (!content || typeof content === 'string') return []
  const paths: string[] = []
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_use' || !block.name) continue
    if (!FILE_PATH_TOOLS.has(block.name)) continue
    const fp = block.input?.file_path ?? block.input?.notebook_path
    if (typeof fp === 'string' && fp.length > 0) paths.push(fp)
  }
  return paths
}

/**
 * A compact record of what Claude did in one assistant turn — tool name plus
 * its most identifying argument (file path, or the head of a bash command).
 * This is what makes tool-driven work visible to phase 1: the file that got
 * edited, the grep that checked whether a dependency was already present.
 */
function toolActivityDigest(record: RawRecord): string {
  const content = record.message?.content
  if (!content || typeof content === 'string') return ''
  const lines: string[] = []
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_use' || !block.name) continue
    const input = block.input ?? {}
    const fp = input.file_path ?? input.notebook_path
    if (typeof fp === 'string' && fp.length > 0) {
      lines.push(`${block.name} ${fp}`)
    } else if (typeof input.command === 'string') {
      lines.push(`${block.name} ${input.command.slice(0, 120)}`)
    } else if (typeof input.pattern === 'string') {
      lines.push(`${block.name} ${input.pattern.slice(0, 120)}`)
    } else {
      lines.push(block.name)
    }
  }
  return lines.join('\n')
}

/**
 * Derive a project label from the file paths touched in a session. Picks the
 * most frequently occurring known repo-root segment. The path immediately
 * under a well-known workspace root (e.g. .../Sites/<PROJECT>/...) is the
 * project; we count those and take the mode. Falls back to "unknown".
 */
function projectFromPaths(paths: string[]): string {
  if (paths.length === 0) return 'unknown'
  const counts = new Map<string, number>()
  for (const p of paths) {
    const seg = repoSegment(p)
    if (!seg) continue
    counts.set(seg, (counts.get(seg) ?? 0) + 1)
  }
  if (counts.size === 0) return 'unknown'
  let best = 'unknown'
  let bestN = -1
  for (const [seg, n] of counts) {
    if (n > bestN) {
      best = seg
      bestN = n
    }
  }
  return best
}

// Well-known workspace roots: the directory one level below any of these is
// treated as the project. Extend as needed.
const WORKSPACE_ROOTS = new Set(['sites', 'projects', 'code', 'repos', 'src', 'workspace', 'dev'])

function repoSegment(filePath: string): string | null {
  const parts = filePath.split('/').filter(Boolean)
  for (let i = 0; i < parts.length - 1; i++) {
    if (WORKSPACE_ROOTS.has(parts[i].toLowerCase())) {
      return parts[i + 1]
    }
  }
  // No known workspace root — fall back to the second-to-last dir if present.
  return parts.length >= 2 ? parts[parts.length - 2] : null
}

async function readJsonlFile(filePath: string): Promise<RawRecord[]> {
  const records: RawRecord[] = []
  const rl = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed) as RawRecord)
    } catch {
      // skip malformed lines
    }
  }

  return records
}

function extractUserText(record: RawRecord): string {
  const content = record.message?.content
  if (!content) return ''
  if (typeof content === 'string') return content
  return (content as ContentBlock[])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
    .join('\n')
    .trim()
}

function extractAssistantText(record: RawRecord): string {
  const content = record.message?.content
  if (!content || typeof content === 'string') return ''
  return (content as ContentBlock[])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
    .join('\n')
    .trim()
}

