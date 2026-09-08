import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import type { Exchange } from './types6.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = path.join(__dirname, 'prompts')

/**
 * Phase 1 does the hard reasoning over a long transcript; phase 2 renders a
 * much smaller structured input. Override either with MENTOR_MODEL_PHASE1 /
 * MENTOR_MODEL_PHASE2 to test cheaper models on the rendering half.
 */
const MODEL_PHASE1 = process.env.MENTOR_MODEL_PHASE1 ?? 'claude-sonnet-4-5-20250929'
const MODEL_PHASE2 = process.env.MENTOR_MODEL_PHASE2 ?? 'claude-sonnet-4-5-20250929'

// ---------------------------------------------------------------------------
// Phase 1 — decision log
// ---------------------------------------------------------------------------

export type DecisionKind = 'decision' | 'pattern' | 'reversal' | 'bug'
export type Driver = 'claude' | 'engineer' | 'joint'
export type Engagement = 'none' | 'acknowledged' | 'questioned' | 'directed'

export interface StatedConstraint {
  constraint: string
  quote: string
}

export interface Decision {
  id: string
  kind: DecisionKind
  what: string
  alternatives_visible: string | null
  driver: Driver
  engagement: Engagement
  skill_behind_it: string | null
  evidence: string
  concepts: string[]
  related_ids?: string[]
}

/**
 * Provenance for one analysis run. Attached by the CLI after phase 1 returns —
 * NOT produced by the model. Captures how this artifact was generated so a
 * report can be reproduced or audited later: the window and the exact command.
 */
export interface RunMeta {
  /** ISO 8601 — start of the analysis window */
  start: string
  /** ISO 8601 — end of the analysis window */
  end: string
  /** ISO 8601 — when this run was executed */
  generatedAt: string
  /** The full CLI invocation, reconstructed from argv */
  command: string
  /** Distinct working directories seen in the extracted window, verbatim from the logs */
  cwdsSeen: string[]
  /** Number of session files read */
  sessionCount: number
}

export interface DecisionLog {
  concepts: string[]
  stated_constraints: StatedConstraint[]
  decisions: Decision[]
  /** Run provenance — attached by the CLI, absent on the raw model output. */
  run?: RunMeta
}

// ---------------------------------------------------------------------------
// Phase 2 — rendered output
// ---------------------------------------------------------------------------

export interface WatchListItem {
  id: string
  title: string
  why_it_matters: string
  evidence: string
  exercise: string | null
  exercise_omitted_because?: string
}

export interface RenderedQuestion {
  id: string
  question: string
  context: string
}

export interface RenderOutput {
  concepts: string[]
  watch_list: WatchListItem[]
  questions: RenderedQuestion[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type DecisionLogOptions = {
  /**
   * Emit a `### Session N` header at each session boundary.
   *
   * v3 grouped exchanges under `### Project: NAME` headers. v4 removed that
   * because the project label was derived by guessing which path segment was
   * the repo root — but removing it deleted two things at once: the wrong label
   * AND the section boundaries. This restores the boundaries without the
   * inference, keyed on sessionId, which is stated in the data.
   *
   * Under test: on the multi-directory window, v3 found 18-22 concepts and
   * v4-v6 found 15-16. If boundaries were carrying that, this recovers it.
   */
  sessionHeaders?: boolean
}

export async function runDecisionLog(
  exchanges: Exchange[],
  opts: DecisionLogOptions = {},
): Promise<DecisionLog> {
  const client = createClient()
  const { system, user } = await readPrompt('phase1-decisions.md')
  const taxonomy = await readTaxonomy()
  const userPrompt = user
    .replace('{{TAXONOMY}}', taxonomy)
    .replace('{{EXCHANGES}}', formatExchanges(exchanges, opts.sessionHeaders === true))
  return callClaude<DecisionLog>(client, MODEL_PHASE1, system, userPrompt, 8192, 'phase 1')
}

export async function runRender(log: DecisionLog): Promise<RenderOutput> {
  const client = createClient()
  const { system, user } = await readPrompt('phase2-render.md')
  const userPrompt = user.replace('{{DECISION_LOG}}', JSON.stringify(log, null, 2))
  return callClaude<RenderOutput>(client, MODEL_PHASE2, system, userPrompt, 8192, 'phase 2')
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

/** Where progress messages go. The CLI overrides this; default is stderr. */
let logFn: (msg: string) => void = msg => process.stderr.write(`${msg}\n`)

export function setPipelineLogger(fn: (msg: string) => void): void {
  logFn = fn
}

async function callClaude<T>(
  client: Anthropic,
  model: string,
  system: string,
  userPrompt: string,
  maxTokens: number,
  label = 'call',
): Promise<T> {
  // Prefill the assistant turn with an opening brace. Asking for JSON in the
  // system prompt is a request; starting the response mid-object is a
  // constraint — the model can only continue the object it is already inside.
  // Without this, a window whose transcripts contain markdown documents (e.g.
  // sessions spent working on this tool) can pull the model into imitating
  // those documents instead of following the schema.
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    // Extraction, not composition — the same transcript should yield the same
    // decisions. Note this parameter is deprecated on Claude 4.7 and later and
    // returns a 400 there, so it will need removing when the model moves up.
    temperature: 0,
    system,
    messages: [
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: '{' },
    ],
  })

  // Report how the model stopped and how close it came to the ceiling. Without
  // this, hitting max_tokens truncates the JSON mid-object and surfaces as a
  // parse failure — which looks identical to the model ignoring the schema, and
  // sends you debugging the prompt instead of raising the budget.
  const used = response.usage?.output_tokens ?? 0
  const pct = maxTokens > 0 ? Math.round((used / maxTokens) * 100) : 0
  logFn(
    `${label}: stop_reason=${response.stop_reason} ` +
    `output_tokens=${used}/${maxTokens} (${pct}%) ` +
    `input_tokens=${response.usage?.input_tokens ?? '?'}`
  )
  if (response.stop_reason === 'max_tokens') {
    logFn(
      `WARNING: ${label} hit the ${maxTokens}-token output ceiling. The JSON is ` +
      `truncated and will fail to parse. Raise max_tokens, or narrow the window.`
    )
  } else if (pct >= 85) {
    logFn(`Note: ${label} used ${pct}% of its output budget — close to truncation.`)
  }

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('')

  // The prefilled '{' is not echoed back in the response, so put it back.
  const cleaned = ('{' + text)
    .replace(/```$/m, '')
    .trim()

  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    const truncated = response.stop_reason === 'max_tokens'
    throw new Error(
      `Model did not return valid JSON (${model}, ${label}, stop_reason=${response.stop_reason}).\n` +
      (truncated
        ? `The response was CUT OFF at the ${maxTokens}-token ceiling — this is a budget ` +
          `problem, not a prompt problem. Raise max_tokens or narrow the window.\n`
        : '') +
      `First 400 chars:\n${cleaned.slice(0, 400)}\n\nLast 200 chars:\n${cleaned.slice(-200)}`
    )
  }
}

/**
 * Read a prompt file that has a SYSTEM section and a USER section separated by
 * the FIRST occurrence of "\n---\n". Later "---" lines inside the user section
 * are left alone, so prompts can use horizontal rules freely below the split.
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

/** The concept taxonomy is injected into phase 1 so tags stay consistent across runs. */
async function readTaxonomy(): Promise<string> {
  return fs.readFile(path.join(PROMPTS_DIR, 'concepts.md'), 'utf-8')
}

/**
 * Render exchanges for phase 1 in the order the extractor produced them —
 * session by session, chronological within each session. No grouping: v3
 * grouped by a derived project label, which both mislabelled arbitrary layouts
 * and imposed an ordering the transcripts never had.
 */
function formatExchanges(exchanges: Exchange[], sessionHeaders: boolean): string {
  const sections: string[] = []

  // Number sessions in the order they first appear rather than exposing the
  // raw uuid: the model needs to know where one piece of work ends, not which
  // file it came from. Exchange order is untouched either way.
  const sessionNumber = new Map<string, number>()
  let current: string | null = null

  if (sessionHeaders) {
    sections.push(
      'Exchanges are grouped under `### Session N` headers. Each session is one ' +
      'continuous working session; separate sessions are usually unrelated work. ' +
      'Order within and across sessions is chronological.'
    )
    sections.push('')
  }

  for (const ex of exchanges) {
    if (sessionHeaders) {
      if (!sessionNumber.has(ex.sessionId)) {
        sessionNumber.set(ex.sessionId, sessionNumber.size + 1)
      }
      if (ex.sessionId !== current) {
        current = ex.sessionId
        if (sections.length > 0) sections.push('')
        sections.push(`### Session ${sessionNumber.get(ex.sessionId)}`)
        sections.push('')
      }
    }
    sections.push(`**[${ex.timestamp}]**`)
    sections.push(`User: ${ex.userText}`)
    sections.push(`Claude: ${ex.assistantText}`)
    sections.push('')
  }

  return sections.join('\n')
}
