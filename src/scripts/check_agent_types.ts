/**
 * What kinds of subagents run, and do any of them write code?
 *
 * Decides whether agent transcripts can be filtered by type. If every agent is
 * read-only exploration, its findings resurface on the main thread and the
 * transcript adds little. If some write files, dropping them loses real work —
 * which is what appeared to happen when v4 skipped sidechain records and lost
 * esc-to-close, the download helper and click-outside.
 *
 * Reads agentType from two places, since it may live in either:
 *   - a top-level field on agent records
 *   - the input of a `Task` tool_use call on the MAIN thread
 *
 * Read-only: readdir, stat and a streaming read. Nothing is written or deleted.
 *
 *   npx tsx check-agent-types.ts
 *   npx tsx check-agent-types.ts --since 2026-09-01
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'

/** Tools that modify the filesystem. Anything here means the agent wrote. */
const WRITE_TOOLS = new Set([
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Update', 'Create', 'str_replace', 'create_file',
])
/** Tools that only observe. */
const READ_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'view', 'NotebookRead',
])

type AgentFile = {
  name: string
  records: number
  sessionIds: Set<string>
  agentIds: Set<string>
  declaredTypes: Set<string>
  toolCalls: Map<string, number>
  writes: number
  reads: number
  bash: number
  /** Bash commands that look mutating, since Bash can write without Edit */
  mutatingBash: number
}

type TaskDispatch = {
  fromFile: string
  agentType: string
  description: string
}

function parseArgs(argv: string[]): { root: string; since?: Date } {
  let root = path.join(os.homedir(), '.claude', 'projects')
  let since: Date | undefined
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--root' && value) {
      root = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value
      i++
    } else if (flag === '--since' && value) {
      const d = new Date(value)
      if (isNaN(d.getTime())) throw new Error(`Invalid --since date: ${value}`)
      since = d
      i++
    }
  }
  return { root, since }
}

async function findJsonl(root: string, since?: Date): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        if (since) {
          const st = await fs.stat(full)
          if (st.mtime < since) continue
        }
        out.push(full)
      }
    }
  }
  await walk(root)
  return out.sort()
}

function looksMutating(cmd: string): boolean {
  return /(^|[\s;&|])(rm|mv|cp|mkdir|touch|sed\s+-i|tee|npm\s+install|git\s+(commit|checkout|apply|push))\b/.test(cmd)
    || />>?/.test(cmd)
}

async function scan(file: string, agents: AgentFile[], dispatches: TaskDispatch[]): Promise<void> {
  const name = path.basename(file)
  const isAgent = name.startsWith('agent-')

  const info: AgentFile = {
    name,
    records: 0,
    sessionIds: new Set(),
    agentIds: new Set(),
    declaredTypes: new Set(),
    toolCalls: new Map(),
    writes: 0,
    reads: 0,
    bash: 0,
    mutatingBash: 0,
  }

  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let r: any
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    info.records++
    if (typeof r.sessionId === 'string') info.sessionIds.add(r.sessionId)
    if (typeof r.agentId === 'string') info.agentIds.add(r.agentId)
    if (typeof r.agentType === 'string') info.declaredTypes.add(r.agentType)

    const content = r?.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (block?.type !== 'tool_use') continue
      const tool = typeof block.name === 'string' ? block.name : '<unknown>'
      info.toolCalls.set(tool, (info.toolCalls.get(tool) ?? 0) + 1)

      // A Task dispatch names the agent type it is launching.
      if (tool === 'Task' || tool === 'Agent') {
        const input = block.input ?? {}
        const t = input.agentType ?? input.subagent_type ?? '<unnamed>'
        dispatches.push({
          fromFile: name,
          agentType: String(t),
          description: String(input.description ?? '').slice(0, 70),
        })
      }

      if (WRITE_TOOLS.has(tool)) info.writes++
      else if (READ_TOOLS.has(tool)) info.reads++
      else if (tool === 'Bash') {
        info.bash++
        const cmd = String(block.input?.command ?? '')
        if (looksMutating(cmd)) info.mutatingBash++
      }
    }
  }

  if (isAgent) agents.push(info)
}

async function main(): Promise<void> {
  const { root, since } = parseArgs(process.argv)
  console.log(`Scanning ${root}${since ? ` (mtime >= ${since.toISOString()})` : ''}\n`)

  const files = await findJsonl(root, since)
  if (files.length === 0) {
    console.log('No .jsonl files found. Check --root.')
    return
  }

  const agents: AgentFile[] = []
  const dispatches: TaskDispatch[] = []
  for (const f of files) await scan(f, agents, dispatches)

  // ---- 1. agent types dispatched from main threads -------------------------
  console.log('[1] AGENT TYPES DISPATCHED (from Task tool calls on main threads)')
  if (dispatches.length === 0) {
    console.log('  No Task dispatches found. agentType may live elsewhere — see section 2.')
  } else {
    const byType = new Map<string, number>()
    for (const d of dispatches) byType.set(d.agentType, (byType.get(d.agentType) ?? 0) + 1)
    for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${t}: ${n}`)
    }
    console.log('\n  sample descriptions:')
    for (const d of dispatches.slice(0, 12)) {
      console.log(`    [${d.agentType}] ${d.description}`)
    }
  }

  // ---- 2. types declared on agent records themselves -----------------------
  console.log('\n[2] AGENT TYPES DECLARED ON AGENT RECORDS')
  const declared = new Map<string, number>()
  for (const a of agents) for (const t of a.declaredTypes) declared.set(t, (declared.get(t) ?? 0) + 1)
  if (declared.size === 0) console.log('  none — agent records carry no agentType field')
  else for (const [t, n] of declared) console.log(`  ${t}: ${n} file(s)`)

  // ---- 3. per-agent-file read vs write behaviour ---------------------------
  console.log('\n[3] DO AGENT TRANSCRIPTS WRITE FILES?')
  console.log('AGENT FILE                        recs  reads  WRITES  bash  mutBash  verdict')
  console.log('-'.repeat(88))
  let writers = 0
  for (const a of agents.sort((x, y) => y.writes - x.writes)) {
    const verdict = a.writes > 0 ? 'WRITES CODE' : a.mutatingBash > 0 ? 'bash-mutating' : 'read-only'
    if (a.writes > 0 || a.mutatingBash > 0) writers++
    console.log(
      a.name.slice(0, 32).padEnd(32) +
        String(a.records).padStart(6) +
        String(a.reads).padStart(7) +
        String(a.writes).padStart(8) +
        String(a.bash).padStart(6) +
        String(a.mutatingBash).padStart(9) +
        '  ' + verdict
    )
  }

  // ---- 4. verdict ----------------------------------------------------------
  console.log('\n' + '='.repeat(60))
  console.log('VERDICT')
  console.log('='.repeat(60))
  console.log(`agent files: ${agents.length}   that write (Edit/Write or mutating Bash): ${writers}`)
  if (agents.length > 0 && writers === 0) {
    console.log('\n  => All agent transcripts are read-only exploration.')
    console.log('     Filtering them out is low risk: findings resurface on the main thread.')
    console.log('     NOTE: if v4 lost implementation detail when skipping these, the loss came')
    console.log('     from exploration REPORTS describing main-thread code, not from agent writes.')
  } else if (writers > 0) {
    console.log('\n  => Some agents write files. Dropping all agent transcripts loses real work.')
    console.log('     Filter by type/behaviour rather than wholesale.')
  }

  // ---- 5. tool inventory ---------------------------------------------------
  console.log('\n[5] TOOL CALLS ACROSS ALL AGENT FILES')
  const allTools = new Map<string, number>()
  for (const a of agents) for (const [t, n] of a.toolCalls) allTools.set(t, (allTools.get(t) ?? 0) + n)
  for (const [t, n] of [...allTools.entries()].sort((a, b) => b[1] - a[1])) {
    const kind = WRITE_TOOLS.has(t) ? ' (write)' : READ_TOOLS.has(t) ? ' (read)' : ''
    console.log(`  ${t}: ${n}${kind}`)
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})