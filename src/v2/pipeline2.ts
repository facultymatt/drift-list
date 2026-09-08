import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import type { Exchange } from '../v1/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.join(__dirname, 'prompts')

const MODEL = 'claude-sonnet-4-5-20250929'

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface Observation {
  id: string
  what_claude_did: string
  what_was_not_examined: string
  evidence: string
}

export interface Phase1Output {
  observations: Observation[]
}

export interface RenderedItem {
  id: string
  why_it_matters: string
  exercise: string | null
  omitted_because?: string
}

export interface Phase2Output {
  items: RenderedItem[]
  questions: Array<{ id: string; question: string }>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runPhase1(exchanges: Exchange[]): Promise<Phase1Output> {
  const client = createClient()
  const { system, user } = await readPrompt('phase1-observation.md')
  const userPrompt = user.replace('{{EXCHANGES}}', formatExchanges(exchanges))
  return callClaude<Phase1Output>(client, system, userPrompt)
}

export async function runPhase2(phase1: Phase1Output): Promise<Phase2Output> {
  const client = createClient()
  const { system, user } = await readPrompt('phase2-rendering.md')
  const userPrompt = user.replace('{{PHASE_1_OUTPUT}}', JSON.stringify(phase1, null, 2))
  return callClaude<Phase2Output>(client, system, userPrompt)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY
  const baseURL = process.env.ANTHROPIC_BASE_URL

  if (!apiKey) {
    throw new Error(
      'No API key found. Set ANTHROPIC_AUTH_TOKEN (AskSage) or ANTHROPIC_API_KEY in your environment.'
    )
  }

  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
}

async function callClaude<T>(client: Anthropic, system: string, userPrompt: string): Promise<T> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('')

  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  return JSON.parse(cleaned) as T
}

/**
 * Read a prompt file that has a SYSTEM section and a USER section separated by
 * the first occurrence of "\n---\n". The section headers "SYSTEM\n" and "USER\n"
 * are stripped from the returned strings.
 */
async function readPrompt(filename: string): Promise<{ system: string; user: string }> {
  const content = await fs.readFile(path.join(PROMPTS_DIR, filename), 'utf-8')
  const idx = content.indexOf('\n---\n')
  if (idx === -1) {
    throw new Error(`Prompt file ${filename} is missing a "\\n---\\n" section separator`)
  }
  const system = content.slice(0, idx).replace(/^SYSTEM\n/, '').trim()
  const user = content.slice(idx + 5).replace(/^USER\n/, '').trim()
  return { system, user }
}

function formatExchanges(exchanges: Exchange[]): string {
  const byProject = new Map<string, Exchange[]>()
  for (const ex of exchanges) {
    const group = byProject.get(ex.project) ?? []
    group.push(ex)
    byProject.set(ex.project, group)
  }

  const sections: string[] = []
  for (const [project, exs] of byProject) {
    sections.push(`### Project: ${project}\n`)
    for (const ex of exs) {
      sections.push(`**[${ex.timestamp}]**`)
      sections.push(`User: ${ex.userText}`)
      sections.push(`Claude: ${ex.assistantText}`)
      sections.push('')
    }
  }

  return sections.join('\n')
}
