# Drift List — README revision notes

Suggestions from our review session, ordered roughly by impact. Nothing here is a
code change; see `engineering-todos.md` for those.

Where a point came from your own inline comments, it's marked **(your comment)**.

---

## 1. Example selection

### The decision

Lead with **setInterval drift** (react-timer run) as the watch-list item and exercise.
Pair it with **Q1 from the recursive run** as the architectural question.

### Why this pair

The filter for a headline example is not "would every engineer have done this?" — it's
**"would not weighing this have cost you something?"** Universality was the wrong axis
**(your comment, on the useState/useReducer line)**; stakes is the right one.

- `useState` vs `useReducer` fails the stakes test. Both ship, both pass tests, and
  "who cares, the tests are green" is a legitimate reader response.
- `setInterval` drift passes it. Every engineer has written a countdown. The exercise
  takes five minutes, produces a number, and the number surprises people. "Tests pass"
  is no defence — the tests do pass and the timer is still wrong after five minutes.

The pair also demonstrates the exercise/question split instead of asserting it: the
exercise has one measurable answer; the question has none, only a heuristic that depends
on who calls your library.

### Suggested heading rewrite

The current heading changes grammatical shape mid-sentence (statement → question).
Every other item in your reports leads with a declarative finding. Proposed:

> The countdown runs on `setInterval`. Whether drift accumulates over a long timer, and
> whether `setTimeout` recursion or `requestAnimationFrame` would behave differently,
> never came up.

Drops "five-minute" from the heading since the exercise sets its own duration.

### Suggested question rewrite

Strip the function name so the reader doesn't need the recursive project's context:

> Where should input validation live in a reusable library? If the function throws on
> null input, every caller has to guard. If it returns an empty array instead, a typo at
> the call site goes unnoticed. What's your heuristic for when to throw and when to
> coerce?

Introduce it with one clause — "from a different run, on a small tree-search utility" —
and no more. Two examples from two runs quietly shows the tool works across projects
rather than on one toy; the cost is a context switch, and one clause pays for it.

### Markdown detail

`###` headings inside the sample will pollute the README's own document outline and
GitHub's sidebar. Put the sample in a fenced block or use bold text.

---

## 2. The sample report has a problem you should know about before you publish it

Verified against the session log you sent: **the react-timer window contains zero
engineer turns.** All 15 `type: "user"` records are tool_results with no text. The
manifest reports `userTurns: 15` because it counts record type rather than records with
content.

This is exactly the `checkWindowHasEngineerTurns` case you list under Open Items, and
it's live in the report you were about to feature.

The consequence: every entry in that report reads `driver: claude · engagement: none`.
That looks like a finding about total delegation. It's actually the analyzer having
nothing to attribute anything to.

**Options:**

- **Re-run the timer example on a window that includes your prompts.** Best outcome —
  the setInterval item should survive, and you get at least one non-`none` engagement
  value in the sample.
- **Keep it and say so.** Less good, but honest, and it makes the Open Item concrete.

What you should *not* do is publish it silently. If a reader asks how the tool tells
directed work from delegated work, that sample can't show them — and that distinction is
the engineering claim your Status section rests on.

Related: the recursive run *does* have engineer turns and a "Constraints You Stated"
block quoting your prompts. If you want one sample that demonstrates the driver
distinction firing, that's the one.

---

## 3. Describe what the pipeline actually reads — it's a stronger claim than you're making

Verified in `extract6.ts`. Phase 1 receives:

- user text blocks, capped at 2000 chars
- assistant text blocks, capped at 2000 chars (including any code Claude pasted into prose)
- one line per tool call: name + file path, or 120 chars of a bash command / grep pattern

It does **not** receive: file contents (`input.content` is discarded), thinking blocks
(`extractAssistantText` filters to `type === 'text'`), tool results (same filter on the
user side), or bash output. The pipeline never opens a project file — the only `fs` calls
read `.jsonl` logs and your own prompt files.

Two things follow.

**The privacy claim is stronger than the README states.** Your source code does not leave
your machine unless Claude pasted it into chat. Most tools in this space can't say that.
Worth stating explicitly rather than leaving implied.

**The current privacy wording is wrong for gateway users.** "the same place that
conversation went in the first place" doesn't hold if someone's Claude Code runs through
AskSage and Drift List isn't pointed at the same gateway. You mentioned you're comfortable
adjusting this framing — the accurate version is roughly: Drift List sends a transcript
window to whatever endpoint you configure, which should be the same one Claude Code uses;
set `ANTHROPIC_BASE_URL` accordingly.

If you later ingest `toolUseResult` content, both of these change. Note that in the
README when you do.

---

## 4. Evidence lines

The react-timer report's evidence lines are honest — they quote Claude's summary, which
is genuinely what the analyzer saw.

The recursive report's are not the same shape:

> Evidence: Code shows unbounded recursion with no visited-node tracking
> Evidence: Implementation shows root is passed through recursion as the current level's array

I flagged these as confabulated and I want to be precise about what's established: the
pipeline can't read files, so it didn't observe those directly. But I don't have the
recursive run's logs, and if Claude pasted code into its prose it would have landed inside
the 2000-char assistant text. **Unverified, not proven.** Worth checking before you cite
that report anywhere.

The general problem stands regardless: nothing in the output distinguishes "I read this in
the transcript" from "I inferred this." The fix is a schema change, not a README change —
see the todos.

Until it's fixed, prefer the react-timer item in the README, whose evidence line is
demonstrably grounded.

---

## 5. Citations for the three claims in "Why" **(your comment)**

You were right to flag these, and two of the three are stated wider than the data
supports.

| Claim as written | Problem | Suggested scoping |
| --- | --- | --- |
| "coding agents are where delegation concentrates" | The comparison is Claude Code vs Claude.ai — two Anthropic surfaces, not a claim about AI use generally | "In Anthropic's own usage data, Claude Code conversations were 79% automation against 49% on Claude.ai" |
| "cognitive dependency is among the most common fears people hold about AI" | Rests on one survey; "people" is doing a lot of work | Name the survey and the population: ~52,000 Americans, Public Record survey, second at 56% |
| the "crutch / stifling foundational skills" line | This one is fine — it's a direct quote and you have the source | Cite inline to the education report |

Three separate inline citations, as you suggested. All three sources are already in your
research block, so this is a link-placement change, not new research.

I can pull the specific supporting lines from each source if you want the citations
anchored precisely rather than to the page.

---

## 6. Voice **(your comments)**

Your instinct is right, but the tell isn't any single sentence — it's the frequency.
Nearly every section closes on a short aphoristic beat:

- "Neither is obviously safe."
- "you cannot review what you have never had to decide."
- "Neither shows up in your commit history. Both show up in your transcripts."
- "and the number is the point"
- "Volume of delegation is not the signal; *unexamined* delegation is."
- "techniques with a shape to rehearse become exercises; judgment calls become conversations."

Any one of these is fine. Six reads as a house style. Keep the two carrying real content
(the last two do actual work) and flatten the rest to plain sentences.

Specific agreements with your comments:

- **Cut** "you cannot review what you have never had to decide." The clause before the
  em-dash holds the weight, as you said.
- **Re-voice** the opening two-line description and the commit-history line yourself. Your
  proposed rewrite of the latter — "neither of these is reflected in your commit history,
  but can be reasoned from your Claude Code transcripts" — is better than what's there.
- **Reword** "the analysis engine that makes any of that possible, as a CLI" per your note:
  the analytical foundation, runnable as a CLI, outputting JSON and markdown, feeding the
  future VS Code extension.

---

## 7. Structure

- **Move Usage above Setup.** Right now a reader sees two screens of credential
  configuration before learning what running the thing looks like. Show
  `npm run drift-list -- --hours 2` first.
- **Add the mermaid pipeline diagram (your comment).** transcripts → decision log (JSON) →
  render (JSON) → report.md. Lets you cut some of the prose describing the pipeline, and
  makes the two-phase structure legible at a glance.
- **Keep** "Every item names a decision Claude made, who drove it, whether you engaged, and
  what skill sits behind it — plus a concrete exercise where one is worth doing." **(your
  comment)** — it works and leads into the example well.

---

## 8. Corrections and hygiene

- **`apiKeyHelper` is listed as preference #1 and isn't implemented.** A reader following
  your recommended path hits a wall. Either drop it to Open Items or mark it inline as not
  yet available.
- **`MENTOR_` env prefix** → `DRIFT_LIST_MODEL_*`, per your own TODO. If you rename, keep
  reading the old names for one version.
- **Naming collision.** "Drift List" is both the product and the output artifact
  ("produces a drift list", "your drift list"). Minor, but worth one pass to see whether
  the artifact wants a different word.
- **Model versions in the token section.** The README documents
  `claude-sonnet-4-5-20250929` for both phases; your sample session log ran
  `claude-sonnet-4-6`. Worth confirming the documented defaults match what ships.
- **Concept taxonomy bug.** The recursive report tags `react-performance` on
  `short-circuit-optimization` and `three-function-api`, in a project with no React in it.
  Fix before anyone reads that report closely.

---

## 9. One thing worth adding that isn't there now

The most interesting thing that came out of this session wasn't a report item — it was the
argument about whether the matcher's second parameter should exist at all, and what it
should be bound to. That's your "judgment calls become conversations" claim actually
happening rather than being asserted.

If you want the README to show why the architectural questions matter, a short worked
example of a question leading somewhere would do more than the question alone. It's also
the honest version of the pitch: the tool surfaces the finding, the value is in the ten
minutes that follow.
