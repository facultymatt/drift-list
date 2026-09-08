/**
 * Session/cwd consistency check for Claude Code transcripts.
 *
 * Answers the questions blocking session-boundary chunking:
 *   1. Does every record carry `sessionId`, or do some need a fallback?
 *   2. Does a session ever span more than one `cwd`?
 *   3. Does the filename stem match the `sessionId` inside the file?
 *   4. How much of the corpus is subagent (`isSidechain`) records?
 *
 * Prints counts, ids and directory paths only — never transcript content.
 *
 *   npx tsx inspect-sessions.ts
 *   npx tsx inspect-sessions.ts --since 2026-09-01
 *   npx tsx inspect-sessions.ts --root ~/.claude/projects
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'

type FileReport = {
  file: string
  folder: string
  lines: number
  parsed: number
  unparsable: number
  withSessionId: number
  sessionIds: Set<string>
  cwds: Set<string>
  sidechain: number
  types: Map<string, number>
  filenameMatchesSessionId: boolean | null
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

async function inspect(file: string): Promise<FileReport> {
  const r: FileReport = {
    file: path.basename(file),
    folder: path.basename(path.dirname(file)),
    lines: 0,
    parsed: 0,
    unparsable: 0,
    withSessionId: 0,
    sessionIds: new Set(),
    cwds: new Set(),
    sidechain: 0,
    types: new Map(),
    filenameMatchesSessionId: null,
  }

  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    r.lines++
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(line)
    } catch {
      r.unparsable++
      continue
    }
    r.parsed++

    const type = typeof rec.type === 'string' ? rec.type : '<none>'
    r.types.set(type, (r.types.get(type) ?? 0) + 1)

    if (typeof rec.sessionId === 'string' && rec.sessionId) {
      r.withSessionId++
      r.sessionIds.add(rec.sessionId)
    }
    if (typeof rec.cwd === 'string' && rec.cwd) r.cwds.add(rec.cwd)
    if (rec.isSidechain === true) r.sidechain++
  }

  const stem = r.file.replace(/\.jsonl$/, '')
  if (r.sessionIds.size > 0) {
    r.filenameMatchesSessionId = r.sessionIds.has(stem)
  }
  return r
}

async function main(): Promise<void> {
  const { root, since } = parseArgs(process.argv)
  console.log(`Scanning ${root}${since ? ` (mtime >= ${since.toISOString()})` : ''}\n`)

  const files = await findJsonl(root, since)
  if (files.length === 0) {
    console.log('No .jsonl files found. Check --root.')
    return
  }

  const reports: FileReport[] = []
  for (const f of files) reports.push(await inspect(f))

  // ---- per-file table -----------------------------------------------------
  console.log('FILE                                     lines  noSid  sids  cwds  sidechain  nameOk')
  console.log('-'.repeat(92))
  for (const r of reports) {
    const noSid = r.parsed - r.withSessionId
    const nameOk = r.filenameMatchesSessionId === null ? '-' : r.filenameMatchesSessionId ? 'yes' : 'NO'
    console.log(
      r.file.slice(0, 40).padEnd(40) +
        String(r.lines).padStart(6) +
        String(noSid).padStart(7) +
        String(r.sessionIds.size).padStart(6) +
        String(r.cwds.size).padStart(6) +
        String(r.sidechain).padStart(11) +
        nameOk.padStart(8)
    )
  }

  // ---- aggregate ----------------------------------------------------------
  const totalLines = reports.reduce((a, r) => a + r.lines, 0)
  const totalParsed = reports.reduce((a, r) => a + r.parsed, 0)
  const totalUnparsable = reports.reduce((a, r) => a + r.unparsable, 0)
  const totalNoSid = reports.reduce((a, r) => a + (r.parsed - r.withSessionId), 0)
  const totalSidechain = reports.reduce((a, r) => a + r.sidechain, 0)

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`files: ${reports.length}   lines: ${totalLines}   parsed: ${totalParsed}   unparsable: ${totalUnparsable}`)
  console.log(`records missing sessionId: ${totalNoSid} (${((totalNoSid / Math.max(totalParsed, 1)) * 100).toFixed(1)}%)`)
  console.log(`sidechain records: ${totalSidechain} (${((totalSidechain / Math.max(totalParsed, 1)) * 100).toFixed(1)}%)`)

  // Q1 — fallback needed?
  console.log('\n[Q1] sessionId coverage')
  if (totalNoSid === 0) console.log('  OK — every record carries sessionId. No fallback needed.')
  else {
    console.log(`  ${totalNoSid} record(s) lack sessionId. Files affected:`)
    for (const r of reports) {
      const n = r.parsed - r.withSessionId
      if (n > 0) console.log(`    ${r.file}: ${n} of ${r.parsed}`)
    }
  }

  // Q2 — does a session span multiple cwds?
  console.log('\n[Q2] sessions spanning multiple cwds')
  const sessionCwds = new Map<string, Set<string>>()
  for (const r of reports) {
    for (const sid of r.sessionIds) {
      const set = sessionCwds.get(sid) ?? new Set<string>()
      for (const c of r.cwds) set.add(c)
      sessionCwds.set(sid, set)
    }
  }
  const spanning = [...sessionCwds.entries()].filter(([, c]) => c.size > 1)
  if (spanning.length === 0) {
    console.log('  OK — every session has exactly one cwd. Session and cwd boundaries agree.')
  } else {
    console.log(`  ${spanning.length} session(s) span >1 cwd — do NOT chunk by cwd:`)
    for (const [sid, cwds] of spanning) {
      console.log(`    ${sid}`)
      for (const c of cwds) console.log(`      ${c}`)
    }
  }

  // Q3 — filename as fallback
  console.log('\n[Q3] filename stem vs sessionId')
  const mismatched = reports.filter(r => r.filenameMatchesSessionId === false)
  const agentFiles = mismatched.filter(r => r.file.startsWith('agent-'))
  const otherMismatch = mismatched.filter(r => !r.file.startsWith('agent-'))
  console.log(`  agent-*.jsonl with non-matching stem: ${agentFiles.length} (expected — named by agentId)`)
  if (otherMismatch.length === 0) console.log('  OK — all other filenames match their sessionId. Usable as fallback.')
  else {
    console.log(`  ${otherMismatch.length} unexpected mismatch(es):`)
    for (const r of otherMismatch) console.log(`    ${r.file} -> ${[...r.sessionIds].join(', ')}`)
  }

  // Q4 — multiple sessions per file
  console.log('\n[Q4] files containing >1 sessionId')
  const multi = reports.filter(r => r.sessionIds.size > 1)
  if (multi.length === 0) console.log('  OK — one session per file. File is a safe chunk unit.')
  else for (const r of multi) console.log(`  ${r.file}: ${r.sessionIds.size} sessions`)

  // Q5 — sizing input for chunking
  console.log('\n[Q5] size distribution (for chunk budgeting)')
  const sizes = reports.map(r => r.lines).sort((a, b) => a - b)
  const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor((sizes.length - 1) * p))]
  console.log(`  min ${sizes[0]}  p50 ${pct(0.5)}  p90 ${pct(0.9)}  max ${sizes[sizes.length - 1]}`)
  console.log(`  largest files:`)
  for (const r of [...reports].sort((a, b) => b.lines - a.lines).slice(0, 5)) {
    console.log(`    ${r.lines} lines  ${r.file}`)
  }

  // record types seen, useful for spotting unhandled kinds
  const allTypes = new Map<string, number>()
  for (const r of reports) for (const [t, n] of r.types) allTypes.set(t, (allTypes.get(t) ?? 0) + n)
  console.log('\n[Q6] record types')
  for (const [t, n] of [...allTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`)
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})