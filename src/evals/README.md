# Evals

A test suite for a pipeline whose output is prose. There is no assertion that
catches "this watch list item is boring," so the suite splits the problem: check
mechanically what can be checked mechanically, and hand everything else to a
reviewer in one artifact.

Method follows the error-analysis playbook from Hamel Husain and Shreya
Shankar's evals course — open coding, then a failure taxonomy, then code-based
evaluators for objective failures and human or LLM judgement for subjective
ones. The failure taxonomy for this project already exists in the Open items
section of `../README.md`; it came out of real annotation rather than guesswork.

---

## Quick start

```bash
# run every case, write a report
npx tsx src/evals/run-evals.ts

# just two cases
npx tsx src/evals/run-evals.ts --only timer-part1,timer-part2

# three runs of each, to measure variance rather than assert
npx tsx src/evals/run-evals.ts --repeat 3

# re-run the CHECKS over an existing results directory — no API calls
npx tsx src/evals/run-evals.ts --reuse src/evals/results/2026-09-05T07-26-43

# grade artifacts you already have — free, no API calls at all
npx tsx src/evals/run-evals.ts --checks-only

# tag a run so prompt variants are comparable later
npx tsx src/evals/run-evals.ts --label concepts-last
```

Output lands in `src/evals/results/<timestamp>[-label]/`:

```
EVAL-REPORT.md      the artifact — read this, or zip the directory and share it
results.json        same data, machine-readable, for diffing runs
<case-id>/          the analyzer's own decisions.json / render.json / report.md
```

Exit code is non-zero if any hard check fails, so `npx tsx src/evals/run-evals.ts`
works as a CI step unchanged. `--repeat` always exits 0 — it is measuring
variance, not asserting a bar.

---

## Adding a case

A case is a fixed window over your real session logs. Because logs are
append-only and the window is pinned by timestamp, a case is reproducible: the
same case run next month reads the same exchanges.

```ts
{
  id: 'timer-part2',
  description: 'Engineer-requested refactor to a useReducer state machine, plus tests.',
  start: '2026-09-05T05:00:00.000Z',
  end:   '2026-09-05T05:30:00.000Z',
  groundTruth: [
    'Engineer asked for the refactor — at least one decision should be driver: engineer.',
    'Expected finding: the hook public API was unchanged across the refactor.',
  ],
}
```

`groundTruth` is not checked mechanically. It is context for whoever reads the
report, and it is the highest-value field in the file — a case where you know
the answer is worth ten where you are reconstructing it from memory.

**The best cases are deliberately built.** The timer app took ten minutes and is
the most useful fixture here, because the ground truth is not in dispute: two
prompts, sixty words, everything else delegated. Vary how much you direct versus
defer and you get cases that probe the driver/engagement axis directly.

To find a window's timestamps, run the analyzer once and read the `run` block in
`decisions.json`, or take them from the re-run flags block in a report header.

### Recall cases

Set `shouldContainFindingsFrom` when one case's window contains others:

```ts
{
  id: 'timer-combined',
  start: '2026-09-05T04:45:00.000Z',
  end:   '2026-09-05T05:30:00.000Z',
  shouldContainFindingsFrom: ['timer-part1', 'timer-part2'],
}
```

The runner then checks that every finding the narrow cases produced also appears
in the wide one. This is the phase 1 recall measurement, and it is the single
most useful number the suite produces — see below.

Matching is on evidence quotes, not ids. Slugs churn between runs even when the
finding is identical; two runs sharing roughly sixteen findings had four matching
ids. Comparing on ids badly understates overlap and would make this check noise.

---

## Free mode

None of the checks call a model — they are all assertions over JSON. The cost in
a normal run is the *analyzer*: two API calls per case.

`--checks-only` never invokes the analyzer. It grades artifacts already on disk,
which makes it the mode to use while iterating on the checks themselves. Point a
case at an existing run with `artifactDir`:

```ts
{
  id: 'timer-part1',
  description: 'Timer app built from a two-sentence brief.',
  start: '2026-09-05T04:45:00.000Z',
  end:   '2026-09-05T04:55:00.000Z',
  artifactDir: 'src/v6/examples/react-timer',   // relative to repo root
}
```

Every example run already in the repo can be graded this way for nothing. It is
also the fastest way to check whether a new check is useful or just noisy,
because you can run it across a dozen historical outputs in seconds.

**Checks degrade rather than fail when the logs are gone.** Evidence grounding,
constraint extraction and concept grounding all need the original exchanges. If
the session files for a window are no longer on disk — or the window predates
your current logs — those checks report `SKIP` and are excluded from the pass
count. This matters: 0 of 16 quotes traceable against an empty corpus means "no
data", not "everything was fabricated", and treating it as a failure would make
the suite cry wolf on every old window.

## What the checks cover

| check | severity | catches |
| --- | --- | --- |
| decision schema valid | fail | missing or invalid fields, duplicate ids |
| evidence grounded in transcript | fail | quotes the session logs do not contain |
| related_ids resolve | fail | links to entries that do not exist |
| watch list ids unique | fail | the known duplicate-id bug |
| exercises do not name the method | warn | an exercise giving away its own answer |
| constraints extracted when present | warn | empty `stated_constraints` on a window full of them |
| concept labels grounded | warn | taxonomy-forced miscues — a label whose subject is absent |
| distribution | — | driver/engagement/kind counts, never fails |

**Evidence grounding is the important one.** Three separate incidents in this
project were the model supplying reasoning the record did not contain: a watch
item claiming a design encoded two dimensions when it encoded one, a decision
asserting code had no error handling from code it never read, and a question
inventing a CSS Modules build-overhead tradeoff that does not exist under Vite.
Each would surface here as an unmatched quote.

Matching is deliberately loose — normalised whitespace and quote characters,
and a quote passes if it shares a long contiguous run with some exchange. The
model paraphrases lightly and truncates; exact matching would produce noise.

**Concept grounding catches taxonomy gaps, not just bad labels.** A standalone
recursive tree utility came back tagged `react-performance` and
`react-composition` on a project containing no React. The model must tag every
entry; the taxonomy had nothing for recursion, traversal or complexity, so those
entries landed on the nearest available label. Five labels were added in
response (`algo-recursion`, `algo-traversal`, `algo-complexity`,
`data-structures`, `defensive-design`). When this check fires, ask whether the
label is wrong or whether the right one does not exist yet.

Only labels with a plausible literal keyword are checked; abstract ones are
skipped. It is a warning because some labels are legitimately about an absence —
a decision *not* to add error handling is still `error-handling`.

**Schema validity is the cheap insurance.** The `project` field drifted out of
the model's output silently in v3 and printed `undefined` across 37 report lines
before anyone noticed. `surface` did the same in v5. Both were model-emitted
fields that nothing validated. This check is the alarm those needed.

---

## Reading the report

**Hard checks first.** A failure here is a bug, not a judgement call.

**Then recall.** A wide window that loses findings its own sub-windows produced
is compressing, and nothing downstream recovers them — `--skip-log` re-renders
from `decisions.json`, so a finding phase 1 never wrote is gone. Measured at 36%
on the timer combined window, matching on evidence quotes.

**Then the distribution.** Against a case with known ground truth, this is where
attribution problems show. A session that was total delegation should be nearly
all `driver: claude` / `engagement: none`; a session where you directed a
refactor should not be.

**Then the parts no check covers.** The report ends with these, and they are the
reason to read it rather than just the exit code:

- Is each watch item a skill worth practising, or mechanical detail padding the list?
- Do the questions have real answers, or invent a tradeoff to justify asking?
- Is the driver/engagement split honest against the ground truth?
- Which findings would you have wanted that appear nowhere?

That last one is the hardest and most valuable. A check can tell you a recorded
finding is wrong; only a reader who knows what happened can tell you a finding is
missing.

---

## Working with a reviewer

Zip the results directory and hand it over. The report is self-describing: it
carries the ground truth per case, what each check covers, and the open
questions. Marking it up first with your own notes — the way the `[Me]`
annotations worked on the v2 report — makes the review sharper, but the artifact
stands alone without it.

That markup is open coding, in the sense the evals literature means. Doing it
consistently, then grouping the critiques, is how the next few entries in the
failure taxonomy get found. Aim for under ten primary failure modes; the goal is
a taxonomy you can act on, not an exhaustive list.

---

## What this suite does not do

**No LLM-as-judge yet.** That needs a labelled dataset split into train, dev and
held-out test sets, and judged on true positive and true negative rate rather
than accuracy — on a case that is 16 of 16 `driver: claude`, a judge that always
answers "claude" scores 100% and detects nothing. Worth building once the
failure taxonomy is stable; premature before that.

**No regression bar.** The suite reports numbers, it does not fail a build for a
decision count moving. Given the measured variance — two runs of identical code
on the same window differing by 4 on concepts and 3 on driver counts — a
threshold on those numbers would fire on noise. Use `--repeat 3` and compare
distributions.

**No cost tracking.** Each case is two model calls. A full suite run at `--repeat 3`
is six calls per case; worth knowing before pointing CI at it on every commit.
Nightly, or on changes to `prompts/`, is the sane trigger.
