import fs from 'node:fs/promises'
import readline from 'node:readline'
import { createReadStream, type Dirent } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

export type DiscoverOptions = {
  cutoff: Date
  /**
   * Drop subagent transcripts that never wrote a file. Default true.
   *
   * Read-only subagents are reconnaissance — they report on code that already
   * exists. Including them adds mechanical observations AND measurably degrades
   * attribution of the surrounding real decisions: with them present, decisions
   * the engineer drove get read as Claude's, because Claude is visibly busy
   * around them. Subagents that DO write are kept: that is delegated work.
   */
  dropReadOnlyAgents?: boolean
}

export type DiscoverResult = {
  sessions: SessionFile[]
  /** Read-only agent transcripts excluded */
  droppedAgents: number
  /** Agent transcripts kept because they wrote files */
  keptAgents: number
}

export type SessionFile = {
  filePath: string
  mtime: Date
  /**
   * True for agent-*.jsonl — a subagent transcript rather than a main thread.
   * Set from the filename, which is the only reliable marker: agent files are
   * named by agentId and carry no agentType field.
   */
  isAgent: boolean
  /**
   * Count of file-writing tool calls in this transcript. Only populated for
   * agent files. Zero means the subagent only read.
   */
  writeToolCalls: number
}

/**
 * Tools that modify files. Presence of any one of these is what separates a
 * subagent that did work from one that only looked around.
 *
 * Deliberately NOT inferred from agentType: the type lives in the dispatching
 * `Task` call on the main thread, and there is no field joining that call back
 * to the agent file it spawned. Across a full history only a fraction of agent
 * files can be matched to a dispatch at all. Tool calls are stated inside the
 * file itself, so this classification needs no join and survives changes to
 * Claude Code's agent roster.
 */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Walk ~/.claude/projects recursively, return all .jsonl files
 * modified at or after `cutoff`, sorted newest-first.
 *
 * Skips memory/ subdirectories (those contain markdown, not session transcripts).
 */
// mtime is only a cheap pre-filter to avoid parsing obviously-old files. It is
// NOT the authority on whether a session has in-window messages — that decision
// is made per-message in extractWindowExchanges, against real message timestamps.
// mtime equals the last message's timestamp *only if* Claude Code appends on
// every message; a compaction pass, metadata rewrite, or external sync can move
// it. So we widen the cutoff by a margin: this can only admit extra candidate
// files (extraction trims them), never wrongly drop one whose mtime drifted
// below the window start. Correctness lives downstream; this is just triage.
const MTIME_MARGIN_MS = 24 * 60 * 60 * 1000 // 24h

export async function discoverSessions(opts: DiscoverOptions): Promise<DiscoverResult> {
  const entries = await walkJsonl(PROJECTS_DIR)
  const floor = new Date(opts.cutoff.getTime() - MTIME_MARGIN_MS)
  const inWindow = entries.filter(e => e.mtime >= floor)

  const drop = opts.dropReadOnlyAgents !== false
  const kept: SessionFile[] = []
  let droppedAgents = 0
  let keptAgents = 0

  for (const entry of inWindow) {
    if (!entry.isAgent) {
      kept.push(entry)
      continue
    }
    entry.writeToolCalls = await countWriteToolCalls(entry.filePath)
    if (entry.writeToolCalls > 0) {
      keptAgents++
      kept.push(entry)
    } else if (drop) {
      droppedAgents++
    } else {
      kept.push(entry)
    }
  }

  kept.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  return { sessions: kept, droppedAgents, keptAgents }
}

/**
 * Count file-writing tool calls in a transcript, streaming so a large file is
 * not held in memory. Bash is deliberately NOT counted: a shell command can
 * write, but distinguishing `sed -i` from `find ... 2>/dev/null` by pattern is
 * unreliable in both directions, and across a full history every genuine
 * subagent write showed up as an explicit Edit or Write call.
 */
async function countWriteToolCalls(filePath: string): Promise<number> {
  let count = 0
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line.trim()) continue
    // Cheap pre-check before paying for JSON.parse on every record.
    if (!line.includes('tool_use')) continue
    let record: { message?: { content?: unknown } }
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const content = record?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content as Array<{ type?: string; name?: string }>) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && WRITE_TOOLS.has(block.name)) {
        count++
      }
    }
  }
  return count
}

async function walkJsonl(dir: string): Promise<SessionFile[]> {
  let results: SessionFile[] = []

  let entries: Dirent<string>[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' })
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip memory directories — they contain markdown files, not JSONL transcripts
      if (entry.name === 'memory') continue
      results = results.concat(await walkJsonl(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const stat = await fs.stat(fullPath)
      results.push({
        filePath: fullPath,
        mtime: stat.mtime,
        isAgent: entry.name.startsWith('agent-'),
        writeToolCalls: 0,
      })
    }
  }

  return results
}