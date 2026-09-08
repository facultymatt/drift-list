import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { SessionFile } from './discover6.js'
import type { Exchange, RawRecord, ContentBlock } from './types6.js'

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
 * Every exchange carries the session's cwd verbatim. Nothing is derived from
 * paths — v2 inferred a "project" label by guessing which path segment was the
 * repo root, which mislabelled any layout not matching the assumed convention.
 */
export async function extractWindowExchanges(
  sessions: SessionFile[],
  start: Date,
  end: Date,
  onProgress?: (msg: string) => void,
): Promise<ExtractResult> {
  const all: Exchange[] = []
  let subagentExchanges = 0

  for (const session of sessions) {
    onProgress?.(`Parsing ${path.basename(session.filePath)}...`)
    const exchanges = await parseSession(session.filePath)
    const inWindow = exchanges.filter(e => {
      const ts = new Date(e.timestamp)
      return ts >= start && ts <= end
    })
    if (session.isAgent) subagentExchanges += inWindow.length
    all.push(...inWindow)
  }

  return { exchanges: all, subagentExchanges }
}

/** What extraction found. */
export type ExtractResult = {
  exchanges: Exchange[]
  /**
   * Exchanges drawn from subagent transcripts that survived discovery — i.e.
   * subagents that wrote files. Read-only ones never reach this stage.
   */
  subagentExchanges: number
}

async function parseSession(filePath: string): Promise<Exchange[]> {
  const records = await readJsonlFile(filePath)
  const exchanges: Exchange[] = []

  let pendingUser: { text: string; cwd: string; sessionId: string; timestamp: string } | null = null

  for (const record of records) {
    if (record.type === 'user') {
      const text = extractUserText(record)
      if (text.startsWith(COMPACTION_PREFIX)) continue
      const cwd = record.cwd ?? ''
      pendingUser = {
        text,
        cwd,
        sessionId: record.sessionId ?? '',
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
        sessionId: pendingUser.sessionId,
        cwd: pendingUser.cwd,
        timestamp: pendingUser.timestamp,
        userText: pendingUser.text.slice(0, MAX_USER_CHARS),
        assistantText: combined,
      })
      pendingUser = null
    }
  }

  return exchanges
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

