/**
 * Types for v5. Self-contained: v5 imports nothing from earlier versions, so
 * those stay frozen as a record of how the tool evolved.
 *
 * Unlike src/v1/types.ts, these are written out rather than left as exercises.
 */

// ---------------------------------------------------------------------------
// Raw JSONL shapes (what Claude Code writes to ~/.claude/projects)
// ---------------------------------------------------------------------------

/** One block inside a structured message's content array. */
export type ContentBlock = {
  type: 'text' | 'tool_use' | 'tool_result' | string
  /** Present on text blocks */
  text?: string
  /** Present on tool_use blocks — e.g. "Read", "Edit", "Bash" */
  name?: string
  /** Present on tool_use blocks — shape varies by tool */
  input?: {
    file_path?: string
    notebook_path?: string
    command?: string
    pattern?: string
    [key: string]: unknown
  }
}

/**
 * One line of a session JSONL file.
 *
 * Note on `cwd`: every record carries it, including tool_result records, and it
 * is stable for the life of a session. It is recorded verbatim and never parsed
 * for meaning — an earlier version inferred a "project" label from path
 * segments, which mislabelled any repo layout that didn't match the assumed
 * convention.
 */
export type RawRecord = {
  /** Discriminant — "user" | "assistant" | "queue-operation" | etc. */
  type: string
  /** ISO 8601 — present on user and assistant records */
  timestamp?: string
  /** Session this record belongs to; stable for the life of a session file */
  sessionId?: string
  /** Working directory the session ran in */
  cwd?: string
  /**
   * True when this record belongs to a subagent transcript rather than the main
   * thread. Subagent turns are Claude prompting Claude, so a `type: "user"`
   * record with this flag set is NOT something the engineer typed.
   */
  isSidechain?: boolean
  message?: {
    role: 'user' | 'assistant' | string
    /** String for simple messages; ContentBlock[] for structured output */
    content: string | ContentBlock[]
  }
}

// ---------------------------------------------------------------------------
// Extracted shapes (what the pipeline works with)
// ---------------------------------------------------------------------------

/**
 * One user↔assistant exchange after extraction and truncation.
 * This is the atom of analysis — these are fed to Claude in the order they
 * occurred, with no grouping imposed on top.
 */
/**
 * Who wrote the request half of an exchange.
 *
 * `engineer` — a turn the person actually typed.
 * `subagent` — a turn Claude wrote to dispatch a subagent. v4 dropped these
 *   entirely, which removed real work from the record: a delegated task is
 *   still a skill the engineer didn't exercise. v5 keeps them and labels them,
 *   so they can inform drift without being credited to the engineer.
 */
export type ExchangeSource = 'engineer' | 'subagent'

export type Exchange = {
  /** Who wrote the request half of this exchange */
  source: ExchangeSource
  /** Session this exchange came from, verbatim from the JSONL record */
  sessionId: string
  /** Working directory of the session, verbatim from the JSONL record */
  cwd: string
  /** ISO 8601 from the user JSONL record */
  timestamp: string
  /** User's message content, flattened to plain text and truncated */
  userText: string
  /** Joined assistant text blocks plus a tool-activity digest, truncated */
  assistantText: string
}
