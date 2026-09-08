/**
 * Print the Bash commands inside agent transcripts that a mutation heuristic
 * flags, so the heuristic itself can be judged.
 *
 * Context: check-agent-types.ts reported 12 of 31 agent files as
 * "bash-mutating" while finding ZERO Edit/Write/MultiEdit calls anywhere. That
 * combination is suspicious — the likely cause is `2>/dev/null`, which a naive
 * `>` match treats as a write. This script separates the two so you can see
 * which it is.
 *
 * Read-only: readdir, stat and a streaming read. Nothing is written or deleted.
 *
 *   npx tsx check-agent-bash.ts --since 2026-09-01
 *   npx tsx check-agent-bash.ts --since 2026-09-01 --all   (print every command)
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'

/** Redirects that do not write to the filesystem. */
const BENIGN_REDIRECT = /2>\s*&?1|2>\s*\/dev\/null|>\s*\/dev\/null/g

/** Commands that genuinely modify the filesystem or repo state. */
const MUTATING_CMD = /(^|[\s;&|(])(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|tee|dd|truncate)\s/
const MUTATING_SED = /\bsed\s+(-[a-zA-Z]*i|--in-place)/
const MUTATING_PKG = /\b(npm|yarn|pnpm)\s+(install|add|remove|uninstall|update)\b|\bpip\s+install\b/
const MUTATING_GIT = /\bgit\s+(commit|checkout|apply|push|reset|revert|merge|rebase|stash|add|rm|mv|clean)\b/

function parseArgs(argv: string[]): { root: string; since?: Date; all: boolean } {
  let root = path.join(os.homedir(), '.claude', 'projects')
  let since: Date | undefined
  let all = false
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
    } else if (flag === '--all') {
      all = true
    }
  }
  return { root, since, all }
}

async function findAgentFiles(root: string, since?: Date): Promise<string[]> {
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
      else if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) {
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

type Verdict = 'writes' | 'redirect-to-file' | 'benign'

function classify(cmd: string): { verdict: Verdict; reason: string } {
  if (MUTATING_SED.test(cmd)) return { verdict: 'writes', reason: 'in-place sed' }
  if (MUTATING_PKG.test(cmd)) return { verdict: 'writes', reason: 'package install' }
  if (MUTATING_GIT.test(cmd)) return { verdict: 'writes', reason: 'git state change' }
  if (MUTATING_CMD.test(cmd)) return { verdict: 'writes', reason: 'filesystem command' }

  // Strip redirects that go nowhere, then see if any real redirect remains.
  const stripped = cmd.replace(BENIGN_REDIRECT, '')
  if (/>>?\s*[^\s&|]/.test(stripped)) return { verdict: 'redirect-to-file', reason: 'writes to a file' }

  return { verdict: 'benign', reason: '' }
}

async function main(): Promise<void> {
  const { root, since, all } = parseArgs(process.argv)
  console.log(`Scanning agent files under ${root}${since ? ` (mtime >= ${since.toISOString()})` : ''}\n`)

  const files = await findAgentFiles(root, since)
  if (files.length === 0) {
    console.log('No agent-*.jsonl files found.')
    return
  }

  let total = 0
  const buckets: Record<Verdict, string[]> = { writes: [], 'redirect-to-file': [], benign: [] }
  const benignRedirectOnly: string[] = []

  for (const file of files) {
    const name = path.basename(file)
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
      const content = r?.message?.content
      if (!Array.isArray(content)) continue
      for (const b of content) {
        if (b?.type !== 'tool_use' || b?.name !== 'Bash') continue
        const cmd = String(b?.input?.command ?? '').replace(/\s+/g, ' ').trim()
        if (!cmd) continue
        total++
        const { verdict, reason } = classify(cmd)
        const row = `  [${name.slice(6, 14)}] ${cmd.slice(0, 150)}${reason ? `   <- ${reason}` : ''}`
        buckets[verdict].push(row)
        if (verdict === 'benign' && BENIGN_REDIRECT.test(cmd)) benignRedirectOnly.push(row)
      }
    }
  }

  console.log(`Bash calls across ${files.length} agent file(s): ${total}\n`)

  console.log('='.repeat(70))
  console.log(`GENUINELY MUTATING: ${buckets.writes.length}`)
  console.log('='.repeat(70))
  if (buckets.writes.length === 0) console.log('  none')
  else buckets.writes.slice(0, 40).forEach(r => console.log(r))
  if (buckets.writes.length > 40) console.log(`  ... and ${buckets.writes.length - 40} more`)

  console.log('\n' + '='.repeat(70))
  console.log(`REDIRECTS TO A FILE: ${buckets['redirect-to-file'].length}`)
  console.log('='.repeat(70))
  if (buckets['redirect-to-file'].length === 0) console.log('  none')
  else buckets['redirect-to-file'].slice(0, 40).forEach(r => console.log(r))

  console.log('\n' + '='.repeat(70))
  console.log(`BENIGN: ${buckets.benign.length}`)
  console.log(`  of which contain only a /dev/null or 2>&1 redirect: ${benignRedirectOnly.length}`)
  console.log('='.repeat(70))
  if (all) buckets.benign.forEach(r => console.log(r))
  else {
    benignRedirectOnly.slice(0, 15).forEach(r => console.log(r))
    console.log('  (run with --all to print every benign command)')
  }

  console.log('\n' + '='.repeat(60))
  console.log('VERDICT')
  console.log('='.repeat(60))
  const realWrites = buckets.writes.length + buckets['redirect-to-file'].length
  if (realWrites === 0) {
    console.log('  Explore agents are read-only. The earlier "bash-mutating" flag was a')
    console.log('  false positive from stderr redirects. Filtering agent files by type is safe.')
  } else {
    console.log(`  ${realWrites} command(s) genuinely modify state. Review the lists above —`)
    console.log('  if these are incidental (temp files, /tmp scratch), filtering is still safe.')
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})