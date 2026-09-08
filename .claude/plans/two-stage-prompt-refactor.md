# Plan: Two-phase analyzer, run alongside existing pipeline

## Goal

Add a second analysis pipeline that can be run against the same session data as
the existing one, so the two can be compared on identical input. Do **not**
modify or remove the existing pipeline — it is the control.

The purpose is evaluation, not replacement. Success is being able to run both
against a frozen date range and read the outputs side by side.

## Context

The current pipeline makes three independent LLM calls (analysis, architectural
questions, katas) and produces a markdown report. Two problems have been
observed in its output:

1. **False positives.** The prompt asks for 5–8 watch list items with field names
   that presuppose a gap (`what the engineer didn't engage with`). With a quota
   and no path for "they engaged fine", it reports items the engineer
   demonstrably did reason about.
2. **Exercise drift.** Micro-exercises have grown into 30–45 minute tasks, several
   of which are production hardening work (atomic writes, cleanup strategies,
   progress indicators) rather than skill practice.

The new pipeline splits observation from rendering and removes the quota.

## What to build

### 1. New CLI command

Add a command alongside the existing one — e.g. `analyze2` or
`analyze --pipeline=two-phase`. Implementer's choice, but it must:

- Accept the same time-window arguments as the existing command
- Accept an explicit date range (start and end), not just `--hours N`, so the
  same window can be replayed repeatedly
- Write output to a distinct path so runs don't overwrite each other

### 2. Phase 1 — observation

One LLM call. Input: session exchanges. Output: JSON only.

**System prompt:**

```
You analyze Claude Code transcripts to find decisions Claude made that the
engineer did not engage with.

You are reading a partial record. The engineer thinks about things you cannot
see. Absence of discussion is weak evidence of absence of thought.

Frame findings as risk, not criticism.

Return valid JSON only. No markdown fences, no prose outside the JSON.
```

**User prompt:**

```
Find decisions Claude made in these sessions that the engineer accepted without
examining.

Before reporting an observation, ask whether the engineer discussed alternatives,
asked why, or pushed back. If so, leave it out.

Report at most 5. Fewer is normal. Zero is a valid and useful result — do not
fill space.

{
  "observations": [
    {
      "id": "short-slug",
      "what_claude_did": "the specific decision",
      "what_was_not_examined": "the tradeoff that went unaddressed",
      "evidence": "the request that led to it, quoted or paraphrased"
    }
  ]
}

---

SESSIONS:

{{EXCHANGES}}
```

### 3. Phase 2 — rendering

Second LLM call. Input: **only** phase 1 output. Do not pass the session
exchanges again.

**System prompt:**

```
You turn observations about an engineer's Claude Code usage into practice
material. Render what you are given; do not second-guess it.

Return valid JSON only.
```

**User prompt:**

```
For each observation, write a practice exercise.

An exercise must be practice, not work. If completing it would produce something
the engineer would otherwise have to build anyway — a hardening fix, a missing
feature, a real benchmark — set `exercise` to null and say why.

The shape that works: implement from memory, then compare to what Claude wrote.
Throwaway code, under 10 minutes, one concept, no setup beyond a blank file.

Then pick the 2 most interesting observations and write a question asking the
engineer to articulate the reasoning behind that decision. No single right answer.

{
  "items": [
    {
      "id": "",
      "why_it_matters": "one sentence, concrete consequence",
      "exercise": "or null",
      "omitted_because": "only if null"
    }
  ],
  "questions": [
    { "id": "", "question": "" }
  ]
}

---

OBSERVATIONS:

{{PHASE_1_OUTPUT}}
```

### 4. Artifacts

Write all three to the output directory:

- `phase1.json` — raw observation output
- `phase2.json` — raw rendering output
- `report.md` — human-readable, joining items to their observations by `id`

Keeping phase 1 output on disk matters: it allows phase 2 to be re-run and
iterated on without paying for the expensive transcript analysis again. Consider
a flag that skips phase 1 and reads an existing `phase1.json`.

## Constraints

- **Do not modify the existing pipeline.** New files, new command. Shared code
  (session loading, JSONL parsing, time filtering) can be reused as-is but not
  changed.
- **No taxonomy, no prior-item history, no kata index.** These are planned but
  deliberately out of scope. The point of this build is to test whether the
  simplified prompts produce honest observations. Adding the other machinery
  now makes it impossible to tell what caused what.
- **Prompts live in files**, not string literals, so they can be edited without
  a code change.
- Phase 2 should run on a cheaper model than phase 1 if that's easy to
  configure — rendering a known observation is a much smaller task than finding
  one. Not required for a first pass.

## How this will be evaluated

After implementation, both pipelines will be run against the same frozen date
ranges. The comparison is manual and looks for:

1. **False positives.** Does the new pipeline still report things the engineer
   visibly reasoned about in the transcript?
2. **Item count.** Does it ever return fewer than 5, or zero? If it always
   returns exactly 5, the ceiling is being read as a quota.
3. **Exercise realism.** Are exercises actually under 10 minutes? Is `exercise`
   ever null, and are the omission reasons sound?
4. **Question overlap.** Do the 2 questions duplicate the watch list items, or
   do they surface something distinct?

Note that a known limitation remains: reasoning that happened outside Claude
Code — in the web app, in another tool, or in the engineer's head — is invisible
to both pipelines. Some apparent false positives will be this, not a prompt
defect.