# Analyzer Versions

Evolution of the session analyzer. Each version is a prompt and/or pipeline change, with the observed effect on output where a run exists.

Metrics are from runs over overlapping windows on the same projects. They are indicative, not controlled — windows differ between some runs, so counts should be read as trends rather than measurements.

> Note this document is largely written by and maintained by Claude as the versions progressed from v1 to v6. It's intended as context for future Claude as versions are iterated on. It has not had a detailed human review. In some cases it was created during feature changes and in others it was created post change.

**Read the v1–v3 numbers with more suspicion than they were originally recorded with.** A variance baseline was not established until v6. Two runs of identical code on the same window (v3c and v3d) differ by 4 on concepts and 3 on engineer-driver. Every single-run comparison below with a delta smaller than that is indistinguishable from noise. Several conclusions drawn in the v3 sections were probably over-read. See "Measuring this thing" at the end.

## v1 — tiered report / three independent prompts

Single pipeline, multiple LLM calls. Produced categories, skills, a watch list of flat strings, Tier 1 architectural questions, Tier 2 generated katas with tests and progressive hints, Tier 3 `@YOUR_TURN` scaffolds redacted from real session code, and Tier 4 nudge cadence.

**Dropped:** generated katas. Test files called unimplemented functions and hallucinated imports. Reliable generation needs a generate → run → verify → redact loop, which is a multi-step agentic pipeline rather than a single prompt. Parked for a later phase.

**Kept from this era:** the observation that watch list items framed as "a skill gap risk, not a criticism" read better than assertive ones. That line was dropped in v1 and the items got more accusatory as a result.

**More details**

`analysis.md`, `architectural.md`, `system.md`. Three separate LLM calls over the
same transcript. Watch list items gained `whyItMatters` and `microExercise`
fields.

**Output:** 8 watch list items, 5 architectural questions.

**Annotated by hand.** Roughly 7 of 8 watch list items and 7 of 7 questions
across two runs were judged genuinely useful. The quota was not manufacturing
false positives — it was finding real items.

**Known problems:**

- Field names presupposed a gap (`what the engineer didn't engage with`), with no
  schema path for "they engaged fine". Combined with a 5–8 quota, this produced
  confident claims about the engineer's state of mind.
- No evidence field, so items were unverifiable against the transcript.
- Micro-exercises drifted to 30–45 minutes, several of them production hardening
  work rather than skill practice.
- Architectural questions and watch list items were derived independently from the
  same input, so they duplicated heavily — 4 of 5 questions in one run had a watch
  list twin.
- Applied production standards to throwaway dev scripts. Four of eight annotations
  amounted to "early dev tool, don't care."


## v2 — two-phase observation and rendering

New pipeline alongside v1, not replacing it. Phase 1 finds observations from the transcript; phase 2 renders them into exercises and questions. Intermediate `phase1.json` written to disk so phase 2 can be re-run without re-analyzing.

**Added:** `evidence` field. Anti-quota framing ("fewer is normal, zero isvalid"). A suppression rule: exclude anything the engineer discussed or pushed back on. Exercise rule: practice, not work.

**Output:** 3 observations, 2 questions, 1 exercise omitted.

**Regressed.** The suppression rule cut most of the interesting material, and phase 2 could only be thin because phase 1 handed it three things. Titles became
changelog entries ("Created extractExchangesInWindow in analyze2.ts") rather than narrative. Both questions duplicated watch list items, because deferrals were the only material available.

**Retained from v2:** the `evidence` field, which was the one clear win, and the two-phase architecture itself.

> **The core mistake:** phase 1 filtered. "Observations" was defined as deferrals, so anything not matching that shape was gone before phase 2 could see it.


## v3 — neutral decision log

Phase 1 stops judging. It now extracts a decision log: what was decided, by whom, with how much discussion, as observable facts.

**Added:**

- Four entry kinds: `decision`, `pattern`, `reversal`, `bug`. `pattern` covers choices embedded in code that generated no conversation.
- `driver` (claude / engineer / joint) and `engagement` (none / acknowledged / questioned / directed) as separate observable fields. "Deferral" becomes a query in phase 2 rather than something phase 1 decides.
- `stated_constraints`, so phase 2 can weigh consequence by what the code is for.
- Prose titles restored, with the changelog-entry failure spelled out as a bad example.
- Exercise rule: estimation exercises are worthless, measurement exercises are good.
- `--skip-log` to re-render from a cached decision log.

**Output:** 16 decisions (10 decision / 2 pattern / 3 bug / 1 reversal), 27 concepts, 2 constraints, 8 watch list items, 3 with exercises, 5 questions.

**Wins:** the boolean-filter item appeared — a `pattern` entry that no amount of transcript analysis would have surfaced, and one independently spotted in the UI. Question overlap essentially solved.

**Problems:**

- Phase 2 selected watch list items on `driver: claude` AND
  `engagement: none|acknowledged`, so asking a single question disqualified an entry. This deleted the shader item — the engineer's clearest self-identified skill gap.
- Only 3 of 8 items carried an exercise. The list filled with project work.
- Three items present in v1 were missing entirely: ag-Grid imperative renderers, parallel SDK calls and rate limits, JSONL malformed-input handling. All are properties of code rather than moments of decision, so they never entered the log.
- Constraint extraction picked up Claude's completion summaries rather than engineer statements.
- `driver` returned 14 claude / 2 joint / 0 engineer — defaulting.


## v3b — patterns, taxonomy, skill-based selection

**Added:**

- `prompts/concepts.md` — a ~45-bucket concept taxonomy across React, TypeScript, async, data, APIs, rendering, tooling and cross-cutting concerns. Labels borrowed from the React docs and TypeScript handbook structure. Injected into phase 1 via `{{TAXONOMY}}`, since tagging has to happen at extraction.
- `skill_behind_it` on every decision entry — the transferable capability the entry rests on. This became phase 2's primary selection signal.
- Expanded `pattern` description with six concrete categories and a floor of three pattern entries when there is substantial code.
- Volume raised to 12–18 entries.
- Explicit "do not default everything to claude" on `driver`.
- Constraints restricted to User turns only.

**Changed:** phase 2 no longer filters on `engagement`. Selection now runs on whether a durable skill sits behind the entry; `engagement` only shapes phrasing. Added the note that someone asking "is there a library for this?" is usually
revealing unfamiliarity rather than demonstrating engagement.

**Fixed:** markdown indentation bug. The `<details>` block sat immediately after a bullet list, and raw HTML in that position gets absorbed into the list by some renderers, indenting everything after. Replaced with a plain `## Full Decision Log`
heading and per-entry subheadings — no raw HTML in the output at all.

**Output:** 19 decisions (10 / 6 pattern / 2 bug / 1 reversal), 13 concepts, 1
constraint, 8 watch list items, **5 with exercises**, 4 questions. Drivers: 13 claude / 3 engineer / 3 joint.

**Wins:** patterns tripled. Exercises took the right shape — measurement rather than estimation. Drivers stopped defaulting. Zero question overlap.

**Problems:**

- Concepts dropped to 13. The taxonomy constrained labels correctly but the model read it as a problem list rather than a coverage list, omitting areas where nothing went wrong.
- One exercise slipped the estimation net by being phrased as a list rather than an estimate ("write down three conditions under which you'd fork the file").
- All eight titles closed with the same construction.

**Note on the `### Decisions` restructure in this version:** splitting the "What to record" paragraph into per-kind headers was cosmetic. Both v3 and v3b returned exactly 10 decision-kind entries, seven of them the same finding under a different slug. All gains came from the `pattern` expansion and the `driver` line.


## v3c — constraints, coverage, routing

**Changed:**

- `stated_constraints` narrowed to quality bar and lifespan only — how good the code needs to be and how long it needs to last. Pasted plans and task specifications explicitly excluded. Zero declared the normal answer, since a wrong constraint miscalibrates everything downstream.
- `concepts` declared a coverage list, not a problem list. Target 15–25; under 12 means areas were skipped because nothing was wrong with them.
- Titles told to vary their closing construction, with four alternatives given.
- Exercises must produce something runnable or observable. Written-reasoning prompts get **routed to `questions`** rather than discarded, with `exercise_omitted_because` noting the routing.

**Output:** 18 decisions (10 / 6 pattern / 1 bug / 1 reversal), **22 concepts**, **0 constraints**, 8 watch list items, **3 with exercises**, 4 questions. Drivers: 12 claude / 6 joint / 0 engineer.

**Wins:** concepts fixed, with `tooling-build`, `prompt-engineering` and `cross-platform` now appearing. Constraints correctly empty. Five distinct title closings. Routing worked — both routed items appear in `questions`.

**Best result to date on the shader item:** it made the watch list with a real exercise (write a fragment shader from memory that draws diagonal stripes). This is the entry the engineer independently identified as their clearest gap, and it
took three revisions to stop the pipeline deleting it.

**Regressed:** exercises fell to 3 of 8. Two entries that had produced good exercises in v3b were now omitted:

- `mtime-prefilter` — v3b produced the touch-the-timestamp experiment. v3c described the same experiment and treated "synthetically touching files" as the disqualifying factor.
- `status-field-derivation` — v3b produced the 500-row useMemo profiling exercise. v3c called it a design decision rooted in store structure.

Meanwhile the runnable rule was applied backwards on one item: a fully written exercise ("open analyze.ts and pipeline2.ts, list the reimplemented functions, write down what would need to change") survived because naming real files made it look concrete. 

`driver` lost its engineer entries again — `joint` appears to be absorbing them.


## v3d — synthetic setups, omission forcing function

Prompt-only changes. No pipeline or report changes.

**Phase 2:**

- **Synthetic setups declared not disqualifying.** Creating fake files, touching timestamps, rendering dummy rows, standing up a throwaway scene — constructing an artificial situation to observe real behaviour is what a good exercise does. "This would require synthetic data" is now a reason to write the exercise, not to omit it. This directly targets the v3c regression.
- **Three worked examples added for calibration**, all taken from v3b output that was judged good: the mtime touch experiment, the 500-row useMemo profile, and the fragment shader from memory. Calibrating against known-good output rather than a description of good.
- **Experiment preferred over routing.** Route to a question only when nothing in the entry is observable at all.
- **Written-exercise leak closed** with the exact case that slipped through. Reading code and writing down conclusions never qualifies, regardless of how specific the named files are.
- **`exercise_omitted_because` must name a rejected candidate experiment.** "This is project work" alone is insufficient — it has to say what it would have asked for and what stops that working. Makes lazy omission more expensive than writing the exercise, and gives a better tuning signal.

**Phase 1:**

- **`driver` given explicit rules.** `engineer` when the choice appears in the User turn before Claude proposed anything, even if Claude implemented it. `joint` called out as the easy wrong answer, with the specific correction that approving something Claude proposed is `claude` + `engagement: acknowledged`, not `joint`.

**Not yet run.** Targets for the next run: exercises back to 5+ of 8, every omission reason naming a candidate, and engineer entries recovered in `driver`.

## v3e — closing the last exercise leaks

Prompt-only changes to phase 2. No pipeline changes, no phase 1 changes.

**Fixed the "described a valid exercise then omitted anyway" leak.** The v3d
forcing function required every omission to name a rejected candidate, which
worked in that it made the model articulate its reasoning — but the model then
took the articulation as sufficient and omitted with a full exercise written
inside the reason field. The clearest example came from the previous run:
`new-historical-extractor` said "synthetic: write a script that creates 5000
session files with 50 exchanges each, then profile" and then set exercise to
null. The prompt now says: if the candidate you named is under 15 minutes,
synthetic, and produces an observable result, that IS the exercise — use it. The
forcing function was there to catch lazy omissions, not to be satisfied with a
paragraph.

**Softened the "at least half must have exercises" target.** The controlled
comparison between v0 and v3d over the same window changed the read on this.
Some entries genuinely have no drillable skill behind them — product judgement
about a tool's own design, schema-versioning strategy, format-design tradeoffs.
Forcing an exercise on those is how v0 ended up with "trace every import
through the codebase, write down which files would break" as a supposed
practice task. The prompt now says the omission reasons themselves are how you
tell whether the ratio is honest: if each omission names a candidate that
correctly fails the rules, a lower ratio is fine. If it names one that should
have been kept, or names nothing, that's the signal to try again.

**Output on the same window that produced v3d:** 15 decisions (8 decision /
6 pattern / 1 bug / 0 reversal), 12 concepts, 0 constraints, 8 watch list items,
**5 with exercises**, 5 questions. Drivers: 9 claude / 6 engineer / 0 joint.

**Wins.** The exercise leak is closed — all three omissions in this run are
honest, arguing the underlying skill itself is not measurable in ten minutes
(schema versioning has no ground truth, format-design tradeoffs produce no
observable surprise, prompt behaviour needs an integration test). Not
"synthetic experiment described then discarded". The driver distribution is the
cleanest in the sequence — `joint` went from 6 to 0 across two runs after the
"easy wrong answer" line landed. Every target that was open at the end of v3d
was met.

**Notes.** Zero `reversal` entries this window; the previous same-window run
had two. Probably phase 1 variance rather than a defect, but worth watching if
it repeats. Concepts at 12 is on the "under 12 means you skipped areas"
threshold from the coverage instruction — could be honest for a narrow window,
or the taxonomy could be doing more work.

## v3f — Exclude compaction messages

Previously compaction records were being considered by the pipeline. This could lead to misleading results because the compaction record contains summarizations and fragments of user and claude conversations. 

## v3g — Better characterize constraints, process tool_use

Slight changes to prompts to better characterize constraints the user provides to claude, eg: "Don't use any third part libs" or "make sure to consider Aria accessibility". Also extract tool_use and tool activity for use down pipeline.   


## v4 — remove derived project grouping

The `project` label was never in the logs. It was inferred by guessing which
path segment of an edited file was the repo root, against a fixed
`WORKSPACE_ROOTS` set. On any layout that didn't match the convention it was
wrong — and because `src` was in the set, `/home/me/acme/src/components/Foo.tsx`
produced project `components`.

**Changed.** Deleted `WORKSPACE_ROOTS`, `projectFromPaths`, `repoSegment` and
the `--project` filter (~60 lines of inference). `Exchange.project` became
`Exchange.cwd`, recorded verbatim — every record carries `cwd`, so it is stated
rather than derived. Phase 1 exchanges are a flat chronological stream; the
`### Project: NAME` headers are gone. Subagent records (`isSidechain`) skipped.
Added an assistant-turn `{` prefill to force JSON, markdown escaping of
model-supplied text, and contributing-session counts.

**Wins.** Grouping removal cost nothing on coverage: 26 decisions with and
without on the React window, the same work re-slugged. The prefill fixed a hard
failure — a window containing sessions spent working on this tool pulled the
model into imitating the report markdown it was reading, and phase 1 returned a
document instead of JSON. Escaping fixed reports being silently truncated by a
`<style>` tag quoted verbatim from a transcript.

**Note.** v3 run on a 23-session window emitted no `project` field at all, and
`report3.ts` interpolated it anyway — 37 instances of `*undefined · pattern*`.
The field was already failing at scale, unvalidated, before it was removed. This
is the first of two model-emitted fields to drift silently.

## v5 — label subagent exchanges (abandoned)

v4 dropped subagent records entirely, which also dropped the work. v5 kept them
and labelled them instead: `Engineer:` vs `Claude (to subagent):` in the prompt,
attribution rules forbidding engineer credit for a dispatch turn, and a
model-emitted `surface: direct | subagent` field per decision.

**Result: abandoned.** `surface` was unreliable — 6 of 18 on one window, 1 of 20
on another, and it marked as `direct` the very items that only existed because
subagent exchanges were fed back in. Same failure class as `project`: a
model-emitted value that nothing validates. The `driver` rules did hold (no
subagent exchange was credited to the engineer), but on the React window
engineer-driver fell 11 → 7 against v4-no-subagents, so labelling did not
protect attribution the way the prompt intended.

## v6 — classify subagents by behaviour

Investigation of the actual logs replaced the guesswork:

- All 45 `Task` dispatches in a month were `Explore`; across full history, 77
  `Explore` and 1 `Plan`.
- Agent type is **not usable as a filter**. It lives in the `Task` call on the
  main thread and nothing joins it to the agent file — only ~78 of 451 agent
  files can be matched to a dispatch at all.
- Subagents **do** write, but rarely: 61 `Edit` + 3 `Write` calls across all
  history, concentrated in 2 files of 451.
- Agent files reuse the **parent `sessionId`**, so they fold into their session.
- Sessions **span multiple cwds** (6 of 10 in one month), so cwd is not a
  grouping key. One session per file, so file = session.
- `file-history-snapshot` records carry no `sessionId`; every `user` and
  `assistant` record does.

**Changed.** Subagent transcripts are classified at discovery by what they did:
a file containing `Edit`/`Write`/`MultiEdit` is delegated work and is analyzed;
a read-only transcript is reconnaissance and is dropped (`--keep-readonly-agents`
overrides). No type lookup, no join key, no model judgment — and it keeps working
as Claude Code changes. `surface`, the subagent labels and the attribution rules
are gone; the phase 1 prompt is v4's. Added `--session-headers`,
`stop_reason` / token-budget logging, and CLI fixes: `--skip-log` now runs before
discovery (it previously required session files that no longer existed),
`--hours` errors when combined with `--start`/`--end` instead of silently
overriding, and unknown flags error instead of being ignored.

**Why read-only transcripts are dropped.** They are not delegated work — they
report on code that already exists. Including them adds mechanical observations
*and* measurably degrades attribution of the surrounding real decisions: with
them present, 6 of 10 shared decisions changed driver, mostly from `engineer` to
`claude`, because Claude is visibly busy around them.

## v6b — raise the phase 1 volume ceiling (rolled back)

Prompted by a controlled test. A throwaway React timer app was built from a
two-sentence brief, giving a session whose ground truth was known: the engineer
wrote ~60 words and Claude did everything else. The tool graded it 16/16
`driver: claude`, `engagement: none` — correct, and a useful negative control
after the attribution wobble on real work windows.

A follow-up refactor (engineer-requested `useReducer` state machine plus tests)
was then analyzed three ways: part 1 alone, part 2 alone, and both together.

**The finding: phase 1 is lossy on multi-task windows.** The combined run was not
a superset of either narrow run. Part 1 alone found 16 decisions, part 2 alone 12
— 28 between them — while part 1 + 2 found 18. Seven part-1 entries and five
part-2 entries had no counterpart in the combined log. This matters because
`--skip-log` re-renders from `decisions.json`: anything phase 1 does not record
cannot be recovered by re-rendering later.

**v6b changed the `## Volume` section** from "Aim for 12-18 entries" to an
explicit no-upper-limit instruction, plus a per-session re-read check. Results:

| window | old prompt | v6b |
| --- | --- | --- |
| part 1 | 16 | 20 |
| part 2 | 12 | 13 |
| part 1 + 2 | 18 | 22 |

The ceiling was real and instructed — the narrow window barely moved, the wide
one gained four. But the gain went entirely to the *later* task in the window;
part 1's share was unchanged. Two of five lost entries returned, both from part
2. And the four extra entries in the part-1-alone run were spent on finer grain
(`60-tick-marks`, `100ms-tick-interval`, `type-check-before-run`,
`health-check-curl`) rather than on the decisions that had gone missing.

**Rolled back** — not because it is wrong, but because validating it properly
means re-running every prior window, and the change alters entry grain enough
that old comparisons would not carry over. Recommended change preserved below.

**Two mechanisms were separated, and only one is about window size:**

- *Positional crowding.* `interval-cleanup` vanished from the combined run and
  returned in part 1 alone. Later material outcompetes earlier material. This is
  what chunking fixes.
- *Invisible-in-conversation decisions.* `custom-hook-extraction` and
  `sound-utility-module` — the choice to extract `useTimer` into a hook and
  `playAlarm` into a utility — were absent from part 1 alone even at 20 entries
  with no volume ceiling. More room made them *less* likely, ruling out crowding.
  Nothing in the transcript discusses them; they exist only in the shape of the
  `Write` calls. The evidence-must-be-quoted rule has no purchase on them.

The second is the more interesting gap, because "when is a hook worth the
indirection" is exactly the kind of judgement the tool exists to surface.


## Experiments that did not pan out

Recorded so they are not re-run.

- **Session-boundary headers.** Hypothesis: removing `### Project:` headers in
  v4 deleted useful boundaries along with the bad label, costing concept
  coverage on multi-directory windows. Restoring them as `### Session N` moved
  concepts 16 → 15 on the window it should have helped, and 19 → 22 on the
  control window where it should have done nothing. Backwards on both. Flag
  retained (`--session-headers`, default off) since chunk borders should land on
  session edges if chunking is ever built.
- **`concepts` last in the output schema.** Hypothesis: with the `{` prefill the
  coverage list is emitted before any decision is written, so it cannot reflect
  what the analysis found. Moving it last gave 16 → 22 on the older window at
  temp 1 — but 19 → 17 on the React window at temp 0, and 17–21 across five
  React runs with no config reliably on top. One run supports it, one
  contradicts it. Defensible on principle (reason before summarizing), unproven
  in the numbers.
- **Chunking for prompt size.** Not needed at current scale. A full 142-exchange
  window costs **15,898 input tokens** and phase 1 uses ~65% of an 8,192 output
  budget. Prompt bulk was never the constraint it was assumed to be.

## Measuring this thing

**Variance is larger than most of the effects chased in this document.** v3c and
v3d — identical code, identical window — differ by 4 on concepts and 3 on
engineer-driver. Repeated v6 runs at identical settings produced 33 vs 29
decisions and 21 vs 14 claude-driver. Any single-run delta under ~4 on these
counts is not evidence.

- **Temperature is now 0** in `pipeline6.ts`. It narrows the distribution but
  does not make runs deterministic. Note this parameter is deprecated on Claude
  4.7 and later and returns a 400 there, so it must be removed when the model
  moves up.
- **Provider matters and was not recorded.** Runs through an API gateway looked
  noticeably noisier than the same model called directly. The `run` block records
  the window and command but *not* the model or endpoint — worth adding, since
  it made a whole class of comparison unanswerable from the artifacts.
- **Do not compare on decision `id`.** Slugs churn between runs even when
  findings match: two runs sharing ~16 identical findings had 4 literal id
  matches. Compare on evidence quotes instead.
- **`stop_reason` and `output_tokens` are now logged** per call. Truncation at
  the output ceiling previously surfaced as a JSON parse failure, which looks
  identical to the model ignoring the schema.

**The changes that actually improved this tool did not show up in these counts:**
deleting a label that was inferred wrong, filtering subagents by what they did,
escaping markdown so reports render, forcing JSON with a prefill, making
truncation visible, counting contributing sessions instead of discovered files.
Judge future changes on whether they fix something structurally wrong — an
unverifiable field, silently dropped work, a flag that lies — rather than on
count deltas.

**A recurring pattern worth naming.** Three fields were inferred rather than
recorded, and all three drifted silently: `project` (wrong on any non-conforming
layout, then absent entirely at scale), `surface` (near-random across windows),
and agent *type* (unjoinable to the file it describes). The values that have
never failed — `cwd`, `sessionId`, tool calls, `isSidechain` — are all stated in
the log. `related_ids` is the one model-emitted cross-reference that verifies
clean: 51 links across 7 runs, zero dangling, zero self-references — because the
ids it points at are in the same document. Prefer recorded over reconstructed,
and if a field must be model-emitted, make it checkable.

