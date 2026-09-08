import fs from 'node:fs/promises'
import { type Dirent } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

export type DiscoverOptions = {
  cutoff: Date
}

export type SessionFile = {
  filePath: string
  mtime: Date
}

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

export async function discoverSessions(opts: DiscoverOptions): Promise<SessionFile[]> {
  const entries = await walkJsonl(PROJECTS_DIR)
  const floor = new Date(opts.cutoff.getTime() - MTIME_MARGIN_MS)
  const filtered = entries.filter(e => e.mtime >= floor)
  return filtered.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
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
      results.push({ filePath: fullPath, mtime: stat.mtime })
    }
  }

  return results
}