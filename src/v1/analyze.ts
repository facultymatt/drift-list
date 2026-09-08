import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import type { Exchange, AnalysisResult, ArchitecturalQuestion, WatchListItem } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.join(__dirname, 'prompts')

const MODEL = 'claude-sonnet-4-5-20250929'

type CoreAnalysis = {
  categories: string[]
  skills: string[]
  watchList: WatchListItem[]
}

export type AnalyzeOptions = {
  exchanges: Exchange[]
  sessionWindow: AnalysisResult['sessionWindow']
  onProgress?: (msg: string) => void
}

/**
 * Call Claude API with the extracted exchanges and return a structured AnalysisResult.
 * Two calls run in parallel: core analysis (categories/skills/watchList) and architectural questions.
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const client = createClient()

  const [systemPrompt, analysisPrompt, architecturalPrompt] = await Promise.all([
    readPrompt('system.md'),
    readPrompt('analysis.md'),
    readPrompt('architectural.md'),
  ])

  const exchangeBlock = formatExchanges(opts.exchanges)

  opts.onProgress?.('Calling Claude API (2 parallel requests)...')

  const [coreAnalysis, architecturalQuestions] = await Promise.all([
    callClaude<CoreAnalysis>(client, systemPrompt, inject(analysisPrompt, exchangeBlock)),
    callClaude<ArchitecturalQuestion[]>(client, systemPrompt, inject(architecturalPrompt, exchangeBlock)),
  ])

  return {
    sessionWindow: opts.sessionWindow,
    categories: coreAnalysis.categories,
    skills: coreAnalysis.skills,
    watchList: coreAnalysis.watchList,
    architecturalQuestions,
  }
}

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

  return parseJsonResponse<T>(text)
}

function parseJsonResponse<T>(text: string): T {
  // Strip markdown fences if the model included them despite instructions
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  return JSON.parse(cleaned) as T
}

function inject(prompt: string, exchanges: string): string {
  return prompt.replace('{{EXCHANGES}}', exchanges)
}

function formatExchanges(exchanges: Exchange[]): string {
  // Group by project for readability
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

async function readPrompt(filename: string): Promise<string> {
  return fs.readFile(path.join(PROMPTS_DIR, filename), 'utf-8')
}
