# Skill Drift — what this report is for

A statement of intent, to be argued with. Everything downstream — the phase 1
schema, the taxonomy, what phase 2 promotes to the watch list — should be
derivable from this. Where the tool and this document disagree, one of them is
wrong and it is worth deciding which.

---

## The premise

An engineer who delegates work to Claude ships more and practises less. The
practice loss is invisible: nothing fails, no test goes red, the code is often
better than what would have been written by hand. The cost shows up later, as an
inability to do or judge something that used to be routine.

**The report exists to make that loss visible while it is still cheap to
correct.** It is a record of reps not taken.

It is not a code review. It is not a quality audit of Claude's output. It is not
a changelog. Whether Claude's choice was *good* is almost beside the point — a
correct decision made on your behalf still costs you the rep.

---

## Three kinds of rep

These are distinct, they decay differently, and the report should name which one
is at stake.

### 1. Production — you did not write it

The mechanical skill of producing the code. Writing an interval cleanup, wiring
a `useEffect` dependency array, hand-rolling a CSV serializer, laying out an SVG
arc. This decays quietly and is only noticed under pressure: in an interview, on
a plane, in a codebase where the tool is unavailable.

*Every decision in the log carries this cost by default.* If Claude wrote it,
the rep was not taken. This does not need to be argued per entry — it needs to
be visible in aggregate, because the pattern matters more than the instance.

### 2. Judgement — you did not choose

The knowledge of the tradeoff space. `useState` vs `useReducer` vs a state
machine library. `setInterval` vs `requestAnimationFrame` with interpolation.
Procedural Web Audio vs a bundled asset. This decays faster than production
skill and is harder to notice, because you can read the resulting code, find it
reasonable, and never learn that three other options existed.

*This is what the current report captures best*, and correctly so — it is the
higher-value loss. But it should be labelled as one axis, not presented as the
whole finding.

### 3. Supervision — you did not review

The skill of noticing what changed. Claude overwriting `index.css` wholesale and
deleting the template's design tokens is not a bad decision; it is an unreviewed
one. The rep here is code review, not authorship, and it atrophies the same way.

*The current report does not capture this at all.* It reads the conversation and
does not evaluate what was written into the repo.

---

### An edge case: the inherited constraint

A convention written once and followed ever after — "prefer CSS Modules", "no
new dependencies without discussion" — sits awkwardly across all three.

The rep was taken, once, when the convention was written. Every application
since has been automatic. That is not obviously a loss: not re-deciding a
settled question is what conventions are *for*, and re-litigating CSS Modules
every session would be worse, not better.

But it is not obviously safe either. A convention you no longer examine is a
judgement you are no longer making, and the conditions that justified it may
have changed. The engineer who wrote "no styled-components, the runtime cost is
not worth it" in 2024 and still follows it in 2026 has stopped weighing a
tradeoff, not resolved it.

The practical problem is that these constraints live in `CLAUDE.md` and
`AGENTS.md`, which are injected into the system prompt rather than appearing in
the transcript. Phase 1 cannot see them, so it attributes the resulting choices
to Claude — `driver: claude`, `engagement: none` — when the engineer made them
in writing, in advance. The report is confidently wrong in exactly the projects
with the best-maintained conventions.

**Position, pending evidence:** an inherited constraint is not a rep not taken,
and should not be counted as one. It belongs in the report as *context* — the
constraint that shaped a decision — rather than as a finding. The separate
question of whether a standing convention has gone stale is real, but it is a
different product: it wants a review cadence, not a session log.

## The grading axis

`engagement` is the most important field in the schema, more than `kind` and
more than `driver`. It is the closest proxy for whether a rep was taken.

- **`directed`** — you specified it. Rep taken, or at least the judgement half.
- **`questioned`** — you interrogated it. Judgement rep taken; production rep not.
- **`acknowledged`** — you saw it go by and said nothing. Weakest possible rep.
- **`none`** — it happened and you never engaged. Full loss on both axes.

A session that is 16 of 16 `none` is not a failure of the tool. It is an
accurate description of total delegation, and it should read as alarming.

---

## What earns a place in the watch list

Ranked by what makes an entry worth an engineer's attention:

1. **A skill you are actively losing** — it recurs across sessions, or it sits
   near work you claim as your specialty. Recurrence data does not exist yet;
   this is the strongest argument for building it.
2. **A tradeoff space you did not know existed.** The Web Audio entry in the
   timer session is the model: you did not know the alternatives, and now you do.
3. **A choice with a real crossover point.** Not "X vs Y were options" but "X
   wins below N, Y wins above it, and here is what determines N."
4. **A pattern you accepted without a name.** You cannot search for something you
   cannot name. Naming the state machine you built by hand is worth more than
   critiquing it.
5. **A destructive or wide edit you did not review.** Supervision, per above.

What does **not** earn a place:

- Mechanical implementation detail with no transferable judgement — adding
  `= undefined` defaults to satisfy a linter, converting a `for...of` to
  `reduce`. These are noise; they crowd out the above.
- Anything phrased as "the alternatives were not weighed" where no interesting
  alternative exists. If the tool cannot name a real competitor with a real
  tradeoff, the entry is filler.
- Critique of Claude's code quality that is not tied to a rep the engineer
  would otherwise have taken.

---

## Standards for an entry

**Evidence must be quoted, not inferred.** An entry asserting something absent
from the transcript ("no error handling was discussed, and the code has no
try/catch") is the tool reasoning about code it never read. That is a different
product.

**Never claim the engineer did not consider something.** Reasoning that happened
in another window, in another tool, or in their head is invisible here. Phrase as
"does not appear in the record", not "you did not think about this".

**Do not invent a tradeoff to justify an entry.** If CSS Modules have no
meaningful build overhead under Vite, "at what point does the overhead outweigh
the convenience" is a fabricated question and it costs the report credibility.
Better to have four questions that survive scrutiny than five where one does not.

**An exercise must be genuinely doable in ten minutes and must not give away the
method.** If it cannot be, say so and say why — an honest omission beats a
synthetic setup.

---

## Deliberate non-goals

- **Not a linter.** Variable shadowing, unused imports, missing prop defaults —
  the toolchain already catches these and they carry no transferable judgement.
- **Not a quality judgement of Claude.** The tool assumes the output is fine.
  The question is what it cost you to not produce it.
- **Not a productivity tracker.** More delegation is not automatically worse.
  Delegating something you have done a thousand times is efficiency; delegating
  something you have never done is drift.
- **Not a backlog.** Watch list items are things to practise, not tickets.

---

## Open tensions

Worth deciding rather than leaving implicit.

**Should production loss be reported per entry, or only in aggregate?** Every
entry carries it, so per-entry it is noise. But aggregate alone loses the
specificity that makes it actionable. A per-entry flag for "you have not written
this by hand in N sessions" would need recurrence data.

**Is delegating something you already know well a loss at all?** Probably not,
and the tool cannot currently tell the difference. Dismissal-with-reason is the
only signal available for this, and it is unbuilt.

**Does supervision drift belong here, or is it a second product?** It requires
reading diffs rather than conversation, which was explicitly cut on privacy
grounds. The compromise may be flagging that a wide or destructive edit occurred
without quoting its contents.

**How much should the taxonomy encode?** Concepts are currently technology areas.
Cross-cutting concerns — accessibility, error handling, performance — behave
differently: they are not areas you work in, they are things you either
considered or did not. They may need their own axis rather than a taxonomy slot.
