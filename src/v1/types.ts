/**
 * @YOUR_TURN — This file has intentional gaps for you to fill in.
 *
 * Each field uses the `TODO` placeholder type below. Replace each `TODO`
 * with the correct TypeScript type. The JSDoc comments and examples are your hints.
 *
 * When you're done, `tsc --noEmit` should still pass — TODO is just `any` under the hood,
 * so replacing it with a more specific type will only improve type safety, never break it.
 */

/** Placeholder for types you need to fill in. Replace with the real type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TODO = any

// ---------------------------------------------------------------------------
// Raw JSONL record shapes (what we read off disk)
// ---------------------------------------------------------------------------

/**
 * A single content block inside an assistant message.
 * Claude returns an array of these — we only care about type "text".
 *
 * @example From an actual assistant record in a EXAMPLE session:
 * { "type": "text", "text": "I'll set up the Zustand store with...", "citations": null }
 * { "type": "thinking", "thinking": "Let me consider the tradeoffs..." }
 * { "type": "tool_use", "id": "toolu_vrtx_01...", "name": "Bash", "input": { "command": "..." } }
 */
export type ContentBlock = {
  /** Discriminant: "text" | "thinking" | "tool_use" — we filter on this */
  type: TODO // @YOUR_TURN
  /** Only present when type === "text" */
  text?: TODO // @YOUR_TURN
  /** Only present when type === "tool_use" — e.g. "Read", "Edit", "Bash" */
  name?: string
  /** Only present when type === "tool_use" — the tool's arguments (file_path, command, etc.) */
  input?: Record<string, unknown>
}

/**
 * A parsed line from a session JSONL file.
 * Each line is one of several record types — we only extract "user" and "assistant".
 *
 * @example User record (abbreviated):
 * {
 *   "type": "user",
 *   "timestamp": "2026-08-31T14:26:11.042Z",
 *   "cwd": "/Sites/example-site",
 *   "message": { "role": "user", "content": "write an async function..." }
 * }
 *
 * @example Assistant record (abbreviated):
 * {
 *   "type": "assistant",
 *   "timestamp": "2026-08-31T14:27:03.811Z",
 *   "message": {
 *     "role": "assistant",
 *     "content": [{ "type": "text", "text": "I'll set up an async consumer..." }]
 *   }
 * }
 */
export type RawRecord = {
  /** Discriminant for the record — "user" | "assistant" | "queue-operation" | etc. */
  type: TODO // @YOUR_TURN
  /** ISO8601 — present on user and assistant records */
  timestamp?: TODO // @YOUR_TURN
  /** Working directory — only present on "user" records */
  cwd?: TODO // @YOUR_TURN
  message?: {
    role: TODO // @YOUR_TURN
    /** String for simple messages; ContentBlock[] for structured assistant output */
    content: TODO // @YOUR_TURN
  }
}

// ---------------------------------------------------------------------------
// Extracted / processed shapes (what the pipeline works with)
// ---------------------------------------------------------------------------

/**
 * One user↔assistant exchange after extraction and truncation.
 * This is the atom of analysis — we group these by project and feed them to Claude.
 *
 * @example Example exchange:
 * {
 *   "project": "EXAMPLE",
 *   "timestamp": "2026-08-31T14:26:11.042Z",
 *   "userText": "write an example async consumer...",
 *   "assistantText": "I'll set up an async consumer using aio-pika. First let me look at..."
 * }
 */
export type Exchange = {
  /** Basename of cwd — e.g. "PROJECTS, PROJECT_1, PROJECT_2" */
  project: TODO // @YOUR_TURN
  /** ISO8601 from the user JSONL record */
  timestamp: TODO // @YOUR_TURN
  /** User's message content, flattened to plain text and truncated to 600 chars */
  userText: TODO // @YOUR_TURN
  /** Joined assistant text blocks, truncated to 1200 chars */
  assistantText: TODO // @YOUR_TURN
}

// ---------------------------------------------------------------------------
// Analysis output shapes (what Claude returns, what the report renders)
// ---------------------------------------------------------------------------

/**
 * A Tier 1 architectural interrogation question.
 *
 * @example
 * {
 *   "question": "Why use aio-pika over pika for the RabbitMQ consumer?",
 *   "context": "Claude chose aio-pika when wiring the NLP pipeline to RabbitMQ in EXAMPLE"
 * }
 */
export type ArchitecturalQuestion = {
  /** The open-ended question probing judgment or tradeoff reasoning */
  question: TODO // @YOUR_TURN
  /** One sentence of context — which session/project prompted this */
  context: TODO // @YOUR_TURN
}

/**
 * A watch list finding — something Claude handled autonomously
 * that the engineer should practice to avoid skill atrophy.
 *
 * @example
 * {
 *   "observation": "Claude designed retry backoff with exponential delay and jitter...",
 *   "whyItMatters": "If you can't reason about retry storms in a code review...",
 *   "microExercise": "Open a blank file and implement exponential backoff with jitter..."
 * }
 */
export type WatchListItem = {
  /** What Claude did that the engineer didn't engage with */
  observation: TODO // @YOUR_TURN
  /** Why this skill gap matters in practice */
  whyItMatters: TODO // @YOUR_TURN
  /** Concrete 10–15 min exercise to practice this skill */
  microExercise: TODO // @YOUR_TURN
}

/**
 * The full result returned by the analyze step.
 * This is what report.ts renders into markdown.
 */
export type AnalysisResult = {
  sessionWindow: {
    /** ISO8601 — earliest session timestamp in the window */
    from: TODO // @YOUR_TURN
    /** ISO8601 — latest session timestamp in the window */
    to: TODO // @YOUR_TURN
    /** Total number of JSONL files analyzed */
    sessionCount: TODO // @YOUR_TURN
    /** Unique project names (cwd basenames) seen in the window */
    projects: TODO // @YOUR_TURN
  }
  /** High-level work categories, e.g. "API integration", "debugging", "refactoring" */
  categories: TODO // @YOUR_TURN
  /** Technologies and concepts exercised, e.g. "RabbitMQ", "Python async", "Zustand" */
  skills: TODO // @YOUR_TURN
  /** Things Claude handled autonomously — with micro-exercises to stay sharp */
  watchList: TODO // @YOUR_TURN
  /** Architecture interrogation questions */
  architecturalQuestions: TODO // @YOUR_TURN
}
