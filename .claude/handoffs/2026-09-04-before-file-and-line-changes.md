# Skill Drift — handoff for next session

Working tree: `drift-list copy/` (the zip you uploaded). `npx tsc --noEmit`
passes on the current state. Two files were changed and verified this session
(`src/v1/discover.ts`, `src/v3/report3.ts`) — apply those first if you haven't,
then tackle the items below.

The order below is deliberate: the big change (item 1) wants a clean slate and a
verification run, so do it first while context is fresh. Items 2–3 are isolated
prompt edits. Items 4+ are backlog.

---

## Already done this session (for context)

- **`discover.ts`** — mtime pre-filter widened by a 24h margin. mtime is triage
  only; the real in-window cut is per-message in `extractWindowExchanges`. The
  margin can only admit extra candidate files, never wrongly drop one.
- **`report3.ts`** — added a "re-run this exact time range later" block showing
  the resolved `--start`/`--end`. Built from `log.run.start`/`.end`, not by
  editing the command string, so an `--hours` run still yields a reproducible
  window. Verified against a real render.

---

## 1. Replace project labeling with real file paths  ← START HERE

**Why:** the project label is derived from directory conventions
(`WORKSPACE_ROOTS`) and is wrong on machines whose layout doesn't match — e.g.
everything came back tagged `EXAMPLE` because that's where Claude Code was
launched, not where the work happened. There is no clever derivation that
survives arbitrary layouts. The fix is to stop deriving a label and reference
the actual files an observation came from — ground truth that can't collapse.

**Design (agreed):**
- Drop project derivation entirely. Delete `WORKSPACE_ROOTS`, `repoSegment`,
  `projectFromPaths`, `sessionProject` in `src/v2/extract2.ts`.
  - Note: `WORKSPACE_ROOTS` also has a latent bug — `src` is in the set, so
    `/home/me/acme/src/components/Foo.tsx` yields `components` as the project.
    Deleting the whole mechanism removes this.
- `Exchange.project` becomes `Exchange.files` (string[]) — the paths that
  session/exchange touched, from the tool_use blocks already extracted via
  `toolFilePaths`.
- Replace `--project NAME` (substring over derived label) with `--filter `
  — a **session-level** glob over real paths. Keep a session whole if ANY of its
  edited paths match the glob. Session-level (not exchange-level) is deliberate:
  exchange-level shreds the surrounding planning/discussion, which is what made
  the filtered "run 2" degenerate.
  - Expand `~` yourself before matching (globs don't do tilde).
  - Dependency question to decide: `picomatch`/`minimatch` (real globs, new dep)
    vs. a plain path-prefix `startsWith` (zero dep, covers the actual use case
    `--filter ~/Sites/EXAMPLE`). Given the papa-parse "avoid heavy deps"
    constraint this tool itself surfaced, lean toward the zero-dep prefix unless
    real glob semantics are needed.
- Pure-discussion decisions have no path → `files: []`, shown as an "unfiled"
  bucket. The filter inherently can't catch these; that's acknowledged and fine
  for a focusing tool.

**The four coordinated edits (skipping any one leaves a dangling ref):**
1. `src/v2/extract2.ts` — delete the derivation machinery; populate `files`;
   rewrite the filter block (currently lines ~104–121) as session-level glob.
2. `src/v3/prompts/phase1-decisions.md` — line 11 says "grouped by project";
   schema lines 78 & 87 emit a `"project"` field. Decide files population:
   **recommended = extractor-derived, not model-emitted.** The model can
   hallucinate a path; the extractor can't invent one. Coarse-but-real beats
   precise-but-hallucinable for a ground-truth signal. This needs a
   decision→exchange link (see WRINKLE below).
3. `src/v3/pipeline3.ts` — `project` on `Exchange` (line 27) and `Decision`
   (line 34). **Lines ~198–205 group exchanges into `### Project: X` prompt
   sections** — this is the only substantive change. Removing it means
   exchanges go chronologically instead. That's arguably more honest (shows real
   interleaving) but changes what the model sees, so it NEEDS A VERIFICATION RUN.
   - Reassurance: until the extraction fix, everything went under a single
     `EXAMPLE` header anyway — effectively no grouping — and v1–v3e results were
     good. So grouping isn't doing much work; dropping it is low-risk. Still,
     verify.
4. `src/v3/report3.ts` — `project` shown at lines 44, 79, 121, 137. Print
   home-relative file paths instead. Grouping (if wanted) becomes a display-time
   `groupBy` on a path prefix, not stored data.
   - Also update `analyze3.ts` line 96 help text (still says "cwd contains NAME")
     and the projects-seen metadata / `--project` handling (lines ~48, 96, 162,
     171).

**WRINKLE (the one bit of new plumbing):** decisions come back from the model as
a flat list with no pointer to the source exchange, but the file paths live in
the exchanges. To attach `files` mechanically, each decision needs to carry the
index of the exchange it came from — have phase 1 emit an `exchange_index` per
decision (an index is far harder to hallucinate meaningfully than a path), then
the extractor looks up that exchange's `files`. Alternative is a fuzzy post-hoc
match, but the index is cleaner.

**`types.ts` BOUNDARY — decide before editing:** `src/v1/types.ts` is the
`@YOUR_TURN` teaching file; `Exchange.project` (line 93) is an intentional `TODO`
placeholder for Matt to fill in. Prior patches deliberately left these TODOs
alone (only `ContentBlock.name?`/`input?` were added). Renaming `project`→`files`
here touches that boundary. Ask Matt whether to (a) edit the teaching field, or
(b) keep the TODO and handle the rename around it. Don't cross this silently.

**Verification after building:** run against the uploaded transcript
(`e57e5c33-…jsonl`, 366 lines) and confirm the EXAMPLE/example decisions come
back tagged with real example paths, and the CSS-module *discussion* decision
comes back with `files: []`. Check the chronological-ordering change didn't drop
decision count or engineer-driver share vs. the last good run (run 4: 22
decisions, 10 engineer).

### 1b. What `files`/citation data is FOR — and the edit-diff feature

The point of attaching paths is NOT grouping or filtering anymore (grouping is
gone; filtering is a glob over paths). It is **traceability**: a watch-list item
like "moved an inline ref that ran every render into a useEffect" is only
actionable if the reader can jump to where it happened. Frame `files` as a
**citation for the reader**, not metadata for the pipeline. This raises the
accuracy bar and is another reason for **extractor-derived, not model-emitted**:
a wrong citation sends Matt to the wrong place in his own code and erodes trust
in every citation. Real-but-coarse (this file was touched) beats
precise-but-fabricated (this exact line, maybe).

**Line numbers: demote to optional-if-free.** They point at the *after* state,
which is the weak version of traceability. Grab a line number only if it falls
out of the tool block cleanly; never chase it. Do not fabricate precision.

**The stronger feature — show the edit diff inline (like Claude Code's own UI).**
The observation is usually about a *change*, and opening the file today shows the
resolved version, not the before/after being described. Claude Code already
captured the diff: `Edit` tool_use blocks carry `old_string` + `new_string`
verbatim (`MultiEdit` carries an array). That IS the before/after Claude Code
renders inline. So surfacing it is not new computation — it's picking up two more
fields in the same pass that grabs `file_path`. Copied straight from the tool
block, it's verbatim by construction → zero hallucination risk.

Tiers, degrading honestly by tool type:
- **`Edit` / `MultiEdit`** → real before/after diff. The good case.
- **`Write`** → whole-file `content`, no "before" (don't manufacture one).
- **`Read` / `Bash`** → file path (or command), no diff.
- **pure discussion** → nothing to show; `files: []`.
Present "here's the change" ONLY when there genuinely was an edit.

**Size wrinkle — keep diffs OUT of the phase-1 prompt.** `old_string`/`new_string`
can be large; feeding every edit's diff back through the model would eat the
context budget the widened truncation caps just reclaimed. Capture the diff in
the extractor and attach it to the decision as **report/UI data only** — the
model never sees it. (This also keeps it verbatim and hallucination-proof.)

### 1c. The join key — how diffs/files get attached without going through the model

Diffs (and `files`) must NOT flow through the model. Model emits observations →
report writer looks them up and attaches → phase-2 prompt never grows. The open
question is what to join on. This is the real design decision; discuss with Matt
before implementing (he wants to talk it through more first). Current direction:

- **File path alone is NOT a sufficient key.** One session may edit
  `TwoKiloDialog.tsx` across 15 separate `Edit` calls; a file-path join attaches
  all 15 diffs to every decision touching that file. A wall of diffs, not the one
  change the observation is about.
- **Session reference alone is worse** — every edit in the whole session.
- **Exchange index is the right grain.** Phase 1 sees exchanges in order; have
  each decision emit the `exchange_index` it came from. The report writer goes to
  that exchange's tool_use blocks and pulls exactly the diffs that produced the
  decision — usually 1–3 edits, about right.
- **This is the SAME key `files` needs** (the plumbing wrinkle from §1/§1b). Add
  `exchange_index` to each decision once; it serves both "which paths" and "which
  diffs." Don't pay for the key twice.
- **Exchange index over a per-edit id.** A per-edit id would let a decision cite
  one specific hunk, but the model would have to identify *which* edit —
  reintroducing a hallucination surface. An index is a number the model can't get
  creatively wrong; the deterministic extractor owns everything below it.

**Storage: sidecar file, not just in-memory.** Extractor keeps diffs keyed by
exchange index. Write them to a `diffs.json` next to `decisions.json` rather than
only holding them in memory. Reason: the `--skip-log` workflow re-renders phase 2
from a saved `decisions.json` WITHOUT re-extracting — in-memory diffs would be
gone, but a sidecar keyed by the same index is still there to join against. Given
Matt already uses `--skip-log` to iterate on phase 2 cheaply, the sidecar is the
safe call.

**Status: agreed direction, not yet locked.** Matt will refine with the next
session before implementing.

---

## 2. Duplicate watch-list entries (phase 2)

Phase 2 sometimes emits the same watch-list `id` twice — one copy omitting the
exercise, one providing it (a v3e change misfiring, leaving the rejected draft
in). The prompt already says at line 95 "Never duplicate a watch list item,
except where an exercise was explicitly routed here" — that carve-out is likely
what's being exploited. Two-part fix:
- Prompt: tighten to "Each `id` appears at most once in `watch_list`." Keep the
  routed-to-questions overlap (that's watch_list↔questions, a different thing).
- `src/v3/pipeline3.ts`: dedupe `watch_list` by `id` after phase 2, preferring
  the copy with a non-null `exercise`. Belt-and-suspenders so a prompt slip
  can't reach the report.

## 3. Exercise wording gives away the method

Exercises sometimes name the solution — e.g. "write a **filter** that removes
events where subtype equals compact_boundary" hands over `.filter()`. Fix in
`src/v3/prompts/phase2-render.md` (exercise section, ~lines 46–82): state the
goal and the constraint, never the method or the API to reach for. Add a line to
that effect and fix any worked example that violates it.

---

## 4. Backlog (not yet designed)

- **Line numbers / before-after code in watch-list items** — becomes easy once
  item 1 lands, since files (and tool_use line ranges) are on the decision.
- **Dismissal-with-reason flow** — Matt's most-requested feature by annotation
  count. Needs the VS Code UI, not the analyzer.
- **Prior-item history not passed in** — phase 1 doesn't see past reports, so it
  can't track a concept across runs. The concept taxonomy is the intended join
  key (decision ids are NOT stable across runs — slugs drift, e.g.
  `render-time-ref-to-useeffect` vs `render-time-ref-to-effect`).
- **Outdated React patterns undetected** (model cutoff). Recommendation:
  inject a knowledge-gap markdown into phase 1 rather than splitting models; if
  splitting, put the stronger model on phase 1.
- **Kata index** not implemented; **stable ids across runs** not solved.

---

## Standing guidance

- Not "v4." Fix bugs + small prompt tweaks, then let the VS Code extension's UI
  needs drive the next analyzer version. Most remaining annotations
  (dismiss-with-reason, see the code, line numbers, skip duplicates) are UI
  features, not analyzer changes.
- The target job is an **expert React role** — the React/UI layer is what most
  needs to shine in the public artifact.
- All-projects (no filter) is the truthful default. `--filter` is a focusing
  tool for testing/narrowing, and it's lossy by design (drops discussion-only
  material). Keep that caveat visible in the report when a filter is active.