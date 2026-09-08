# Drift List — session handoff

Written 2026-09-06. Covers the README rewrite session and the code changes it implies but
that were **not** made. No source files were modified in this session.

Repo: `/SITES/drift-list`

---

## What happened this session

The project was renamed **Skill Drift → Drift List**, and the project-level README was
rewritten from scratch against that name. The README is the only deliverable; it describes
several behaviours the code does not yet have.

Deliverable: `drift-list-README-draft.md`.

Superseded: `skill-drift-README-draft.md` (earlier draft, old name).

---

## Code changes the README now claims but the code does not do

These are the gap. Everything here is documented as working in the README and is not.

### 1. Output directory moves out of `~/.claude`

**Why:** `~/.claude` belongs to Claude Code, which manages and cleans up that tree. Two
risks: a future Claude Code release colliding with the path, and — the sharper one — Claude
reading drift reports back in as session context, which would mean the model reading its own
assessment of how much you delegated.

**Current state:** `src/v6/analyze6.ts:11`

```ts
const REPORTS_DIR = path.join(os.homedir(), '.drift-list', 'session-reports')
```

**Change to:**

```ts
const REPORTS_DIR = path.join(os.homedir(), '.drift-list', 'runs')
```

**Also touch:**

- `analyze6.ts:~183` — `const reportDir = args.outputPath ?? path.join(REPORTS_DIR, ...)`
- `analyze6.ts:~314` — the `--skip-log` path builds `reportDir` a second time, with the
  timestamp logic duplicated inline. Extract a single `defaultReportDir()` helper and call
  it from both places rather than fixing the string twice.
- `analyze6.ts:~109` — help text still says `~/.claude/session-reports/`.

**Runs stay flat.** Do not group by project slug. Slug derivation from Claude Code's
encoded cwd paths was a problem in earlier versions and is not worth reviving. Project
identity belongs in the `run` block inside the artifacts, where recurrence detection can
group on it later without the filesystem being load-bearing.

Directory name suggestion is `~/.drift-list/runs/report-v6-<timestamp>/`, keeping the
existing timestamp format.

### 2. `apiKeyHelper` support

**Why:** Claude Code supports an `apiKeyHelper` setting in `~/.claude/settings.json` — a
path to a script whose stdout is used as the credential. Corporate users with a gateway have
usually configured it already, because it is how you avoid a plaintext key on disk. Drift
List already reads `~/.claude`, so reading that one setting gives those users zero-config
auth.

**Current state:** `src/v6/pipeline6.ts:142`

```ts
const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY
```

**Intended precedence:**

1. `apiKeyHelper` from `~/.claude/settings.json` (execute, take stdout, trim)
2. `ANTHROPIC_AUTH_TOKEN`
3. `ANTHROPIC_API_KEY`
4. `.env` via `dotenv/config`, already imported at `analyze6.ts:1`

Reference: https://code.claude.com/docs/en/authentication — Claude Code calls the helper
after 5 minutes or on a 401. Drift List makes two calls per run and does not need refresh
logic; call it once at client construction.

**The README currently describes this as working.** Either implement it or move that item
from Setup down into Open Items before publishing.

### 3. `MENTOR_` prefix is stale

`src/v6/pipeline6.ts:15-16` uses `MENTOR_MODEL_PHASE1` / `MENTOR_MODEL_PHASE2`, left over
from the Drift List name. Rename to `DRIFT_LIST_MODEL_PHASE1` / `_PHASE2`. The README
currently documents the old names, accurately — update both together.

### 4. `npm run drift-list` alias

`package.json` currently exposes `v1`…`v6`. Add:

```json
"drift-list": "tsx src/v6/analyze6.ts"
```

Keep the numbered scripts for posterity; new users should only ever run the alias.

---

## Open items carried into the README

These are written into the README's Open Items section and need no further capture, but
listing here so nothing depends on that file surviving:

- **Windows with no engineer turns.** `--hours N` counts backwards from now, so a window can
  open *after* your last prompt and contain only Claude working. The report then looks clean
  and means nothing — and it happens most often in exactly the long autonomous stretches the
  tool exists to catch. Promote the existing `checkWindowHasEngineerTurns` eval check to
  runtime: either refuse with a clear message, or extend the window start backwards until it
  captures a prompt. The second is friendlier and makes `--hours` behave the way people
  already expect.
- **Publish to npm** so the tool runs as `npx drift-list` with no clone.
- **Record token usage in the `run` block** alongside model and endpoint. Record the
  endpoint host, never the token.

---

## Naming cleanup still outstanding

The rename landed only in the new README.

| File | Occurrences |
| --- | --- |
| `THESIS.md` | "Skill Drift" ×1, "watch list" ×3 |
| `src/README.md` | "watch list" ×13 |
| `src/v6/report6.ts` | report headings — not yet audited |
| `src/v6/types6.ts` | `WatchListItem` type — not yet audited |
| phase-2 prompt | "watch list" in instructions and examples — not yet audited |
| `src/evals/cases.ts` | fixtures may contain the old vocabulary |

Decision made this session: the output is called **the drift list**, not a watch list. The
tool being named after its artifact is an advantage, so use one word for both.

Caveat on `src/README.md`: it is an engineering log describing versions where the type
genuinely was `WatchListItem`. Rename the prose, leave code identifiers alone until the type
itself is renamed, or the log stops being accurate about what the code said at the time.

Watch for the model reproducing old vocabulary out of the phase-2 prompt examples. Grep the
eval fixtures too.

---

## Model and cost facts (verified against the code this session)

- Both phases: `claude-sonnet-4-5-20250929`, `max_tokens` 8192 — `pipeline6.ts:15-16,127,134`
- Phase 2 reads structured JSON rather than transcripts and is the obvious candidate for a
  cheaper model. The code comment at `pipeline6.ts:12-13` already anticipates this. Test
  Haiku there and change the default if quality holds.
- The README deliberately does not print prices. Rates change; token counts and model names
  do not.

---

## Still outstanding on the README itself

- Animated GIF near the top. Narrative is captured as an HTML comment in the file: Claude
  Code finishing a task with tests passing → nudge interrupts → brief thinking beat → drift
  list item referencing the code just written → "dive in" call to action.
- Stills for the dive-in surfaces.
- Two paragraphs marked for Matt to re-voice (the "where this is going" / "what exists
  today" pair).
- No primary anthropic.com URL was found for the 81,000-person "light and shade" study. It
  is referenced in the research section without a link; secondary coverage exists (Euronews,
  Psychology Today, Forbes). Worth finding — it is the strongest single line in that section.
- Decide how directly to state the Anthropic job-application context, if at all. The current
  draft does not mention it.
- The Why section now names both layers — fluency and judgment — with fluency framed as
  upstream of judgment. This aligns the README with THESIS.md, which already splits into
  production / judgment / supervision, and it motivates the exercise half of the
  exercise-versus-question split. Check the wording reads as yours.

---

## Engineering items carried from earlier sessions

Not touched this session, listed so they do not fall off:

- Fix `timer-part1` in `src/evals/cases.ts` to the `04:45:00`→`04:55:00` window and
  **regenerate** the artifact rather than running `--checks-only`. Highest priority: it is
  the first run where phase 1 sees the engineer's TypeScript exchange, and it tests whether
  `checkWindowHasEngineerTurns`'s non-empty-`userText` proxy actually works.
- Fill real windows for `timer-part2` and `timer-combined`.
- Run the recall measurement properly.
- Validate `checkExerciseLeaks`.
- Session-based chunking of phase 1.
- Decide on the v6b volume prompt change.
- Tighten `evidence` to verbatim spans plus `evidence_speaker`. Design this together with
  the tool-activity-as-evidence prompt change, since tightening may lose the file-creation
  citations.
- Duplicate watch ids (handoff item 2) and exercise wording (handoff item 3).
- Strip example directories before publishing.
- Retry with backoff on 429/500/502/503.
