import fs from 'node:fs/promises'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { SessionFile } from './discover.js'
import type { Exchange, RawRecord, ContentBlock } from './types.js'

const MAX_USER_CHARS = 600
const MAX_ASSISTANT_CHARS = 1200
const MAX_EXCHANGES = 100

export type ExtractOptions = {
  sessions: SessionFile[]
  cutoff: Date
  onProgress?: (msg: string) => void
}

/**
 * Parse all session JSONL files and return Exchange[] — user/assistant pairs
 * with project context derived from the cwd field.
 *
 * Caps output at MAX_EXCHANGES (newest first) to keep API token usage bounded.
 */
export async function extractExchanges(opts: ExtractOptions): Promise<Exchange[]> {
  const all: Exchange[] = []

  for (const session of opts.sessions) {
    if (all.length >= MAX_EXCHANGES) break
    const exchanges = await parseSession(session.filePath)
    // Filter by exchange timestamp, not just file mtime — a single session file can
    // span many hours (append-only log), so file mtime alone isn't a reliable window.
    const inWindow = exchanges.filter(e => new Date(e.timestamp) >= opts.cutoff)
    all.push(...inWindow)
  }

  return all.slice(0, MAX_EXCHANGES)
}

async function parseSession(filePath: string): Promise<Exchange[]> {
  const records = await readJsonlFile(filePath)
  const exchanges: Exchange[] = []

  let pendingUser: { text: string; cwd: string; timestamp: string } | null = null

  for (const record of records) {
    if (record.type === 'user') {
      pendingUser = {
        text: extractUserText(record),
        cwd: record.cwd ?? '',
        timestamp: record.timestamp ?? new Date().toISOString(),
      }
    } else if (record.type === 'assistant' && pendingUser) {
      const assistantText = extractAssistantText(record)
      if (assistantText.length === 0) continue  // skip tool-only turns

      exchanges.push({
        project: projectFromCwd(pendingUser.cwd),
        timestamp: pendingUser.timestamp,
        userText: pendingUser.text.slice(0, MAX_USER_CHARS),
        assistantText: assistantText.slice(0, MAX_ASSISTANT_CHARS),
      })
      pendingUser = null
    }
  }

  return exchanges
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
      // Skip malformed lines
    }
  }

  return records
}

function extractUserText(record: RawRecord): string {
  const content = record.message?.content
  if (!content) return ''
  if (typeof content === 'string') return content

  // Content is an array — flatten text parts (skip image/file attachments)
  return (content as ContentBlock[])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
    .join('\n')
    .trim()
}

function extractAssistantText(record: RawRecord): string {
  const content = record.message?.content
  if (!content || typeof content === 'string') return ''

  // Skip thinking and tool_use blocks — only keep type === "text"
  return (content as ContentBlock[])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
    .join('\n')
    .trim()
}

function projectFromCwd(cwd: string): string {
  if (!cwd) return 'unknown'
  return path.basename(cwd)
}
