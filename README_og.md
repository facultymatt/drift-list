# Drift List

**Claude writes the code. Drift List tells you which engineering judgments you stopped making.**

It reads your own Claude Code session transcripts and produces a drift list: the decisions
that got made on your behalf, without you weighing them.

<!-- TODO: animated GIF here.
     Narrative: Claude Code finishes a task, tests passing -> nudge appears ->
     brief thinking beat -> drift list item referencing the code just written ->
     "dive in" call to action. -->

---

## Why

The goal is to keep two things: fluency in the craft, and the judgment that makes an
engineer good at directing a model. They are not separate concerns. If you no longer
remember how `useReducer` works, you will not weigh it against `useState` — not because you
considered it and declined, but because it never surfaced as an option. Rusty technique
quietly narrows the set of decisions you are capable of making.

Neither is obviously safe. Anthropic's own research finds coding agents are where
delegation concentrates, that cognitive dependency is among the most common fears people
hold about AI, and that the specific worry is a crutch "stifling the development of
foundational skills needed to support higher-order thinking."
([The research](#the-research), below.)




<!-- TODO: Matt to re-voice the next two paragraphs. -->

**Where this is going:** an editor extension that watches your Claude Code activity and
intervenes at the right moment — a nudge after a long stretch of delegation, a short
exercise drawn from the code Claude just wrote, an architectural question about the thing
that just got automated.

**What exists today:** the analysis engine that makes any of that possible, as a CLI. It
reads local session transcripts and produces the drift list. The intervention layer is not
built yet.

---

## What it does

Point it at a time range. It reads the Claude Code session logs in `~/.claude`, builds a
decision log of what got decided and by whom, and renders your drift list.

Every item names a decision Claude made, who drove it, whether you engaged, and what skill
sits behind it — plus a concrete exercise where one is worth doing.

```
- Claude implemented the timer state machine with useState managing four states
  (idle, running, paused, done). Whether useReducer would clarify the transitions
  or add ceremony went undiscussed.

  kind: pattern - driver: claude - engagement: none
  concepts: react-state, async-scheduling

  Exercise: Write a timer state machine from memory using useState with four
  states: idle, running, paused, done. Add start, pause, resume and reset
  actions. Now rewrite it with useReducer. Which version made illegal states
  harder to represent?
```

It also generates architectural questions — for the judgment calls that have no kata:

> The timer turns orange at 50% and red with pulse at 25%. If you were designing this for
> a 2-minute timer versus a 20-minute timer, would you keep the same thresholds, and what
> heuristic would you use to decide?

The distinction is deliberate: **techniques with a shape to rehearse become exercises;
judgment calls become conversations.**

<!-- TODO: stills of the dive-in surfaces (code view, conversation view) -->

## What it is not

- Not a linter. It has no opinion on whether the code is good.
- Not a judgment of Claude. Claude making a sound decision unprompted is still a rep you
  did not take.
- Not a productivity tracker. Volume of delegation is not the signal; *unexamined*
  delegation is.

See [THESIS.md](./THESIS.md) for the full framing — what counts as a rep not taken, and the
three axes it splits into (production, judgment, supervision).

---

## Setup

Drift List uses the same environment variables as Claude Code, so if you have already
configured Claude Code for a custom endpoint, it should work with no further setup.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token for gateways that issue their own credentials, such as AskSage. Checked first. |
| `ANTHROPIC_API_KEY` | Your Anthropic API key. Used if no auth token is set. |
| `ANTHROPIC_BASE_URL` | Point requests at a gateway or proxy instead of Anthropic directly. |
| `MENTOR_MODEL_PHASE1` | Override the decision-log model. Optional. |
| `MENTOR_MODEL_PHASE2` | Override the render model. Optional. |

<!-- TODO: MENTOR_ prefix is left over from the old name. Rename to DRIFT_LIST_MODEL_*. -->

Using a corporate gateway such as AskSage:

```sh
export ANTHROPIC_BASE_URL="https://your-gateway/anthropic"
export ANTHROPIC_AUTH_TOKEN="your-gateway-token"
```

### Where to put credentials

In order of preference:

1. **A credential helper.** If you have `apiKeyHelper` configured in
   `~/.claude/settings.json`, Drift List uses it — the same script Claude Code already
   calls to fetch your key. Nothing more to configure.
   <!-- TODO: implement apiKeyHelper support. Not built yet. -->
2. **Exported from your shell profile.** Put the exports in `~/.zshrc` or `~/.bashrc`.
   Works everywhere, including `npx`.
3. **A `.env` file** in the project root, for local development against a clone.

**Do not put the key inline on the command line.** `ANTHROPIC_API_KEY=sk-... npx drift-list`
writes your key into shell history and exposes it in `ps` output to anything running as
your user. Export it or use a helper.

## Usage

```sh
# analyse the last two hours
npm run drift-list -- --hours 2

# or an explicit window
npm run drift-list -- --start 2026-09-05T04:45:00Z --end 2026-09-05T04:55:00Z
```

Reports are written to `~/.drift-list/runs/<timestamp>/`, containing `decisions.json` (the
decision log), `render.json` (the drift list) and `report.md` (the readable version).
Override with `--output ./somewhere`.

Runs are flat rather than grouped by project. The project a run covers is recorded in the
`run` block inside the artifacts, which is a more reliable place to put it than a directory
name derived from a path.

Reports deliberately do not live under `~/.claude`. That directory belongs to Claude Code,
and anything written there can be read back into a later session — which would mean Claude
eventually reading its own assessment of how much you delegated.

## Model and token usage

Drift List makes two model calls per run: one to build the decision log, one to render the
drift list. The decision log call dominates, because it carries the transcript window.

- **Phase 1 (decision log):** `claude-sonnet-4-5-20250929`, `max_tokens` 8192. Input scales
  with the size of the window you select.
- **Phase 2 (render):** `claude-sonnet-4-5-20250929`, `max_tokens` 8192. Input is the
  decision log rather than the transcript, so it stays roughly constant.

Override either with `MENTOR_MODEL_PHASE1` and `MENTOR_MODEL_PHASE2`.

<!-- TODO: phase 2 reads structured JSON, not transcripts, and is the obvious candidate for
     a cheaper model. Test Haiku there and change the default if it holds up. -->

That should be enough to estimate spend against
[Anthropic's current rates](https://www.anthropic.com/pricing). Rates are not reproduced
here because they change.

---

## Status

The vision is an editor extension across many languages. The current scope is deliberately
narrower on both axes: TypeScript and React, because those are what I work in, and the
analysis engine rather than the intervention layer, because analysis is the hard part.

Getting a model to reliably distinguish "the engineer decided this" from "Claude decided
this and the engineer said ok" fails in interesting ways and cannot be verified by unit
tests. Most of the work here is in the prompts, the schema and the evals — including an
eval harness that caught the analyzer confidently grading a window containing none of my
own turns. Six versions of the analyzer exist in this repo, and the number is the point:
the eval suite is what makes iterating on prompts something other than guesswork.

Working: the two-phase analysis pipeline, the drift list, exercises and architectural
questions, a concept taxonomy for cross-run matching, and the eval suite.

Not built yet: the editor extension, the intervention layer, dive-in surfaces, persistent
drift list history and recurrence detection.

---

## Privacy

Drift List reads the Claude Code session logs already on your machine and sends a window of
them to the Anthropic API — the same place that conversation went in the first place. It
writes only to the output directory, and never modifies your logs or your code. The
analysis is one file; read it if you want to know exactly what leaves your machine.

---

## The research

Anthropic's analysis of coding usage found that
[Claude Code conversations were 79% automation, versus 49% on Claude.ai][impact], with
fully directive conversations — task completed with minimal user interaction — at 43.8%
against 27.5% in chat. The agentic surface is where delegation concentrates. And the trend
moves: by [September 2025][eci-sept], the share of directive conversations had risen from
27% to 39% in eight months, taking that share from task iteration and learning.

Engineers already feel this. In Anthropic's [first Public Record survey][record] of ~52,000
Americans, cognitive dependency ranked as the second most common fear at 56%, behind only
job loss. Their qualitative study of 81,000 Claude users found it as a tension inside the
same person: those who valued AI most for learning were roughly three times more likely to
also worry about cognitive atrophy. Anthropic's [education research][education] put the
concern plainly — that AI may act as a crutch, "stifling the development of foundational
skills needed to support higher-order thinking."

[impact]: https://www.anthropic.com/research/impact-software-development
[eci-sept]: https://www.anthropic.com/research/anthropic-economic-index-september-2025-report
[record]: https://www.anthropic.com/news/anthropic-public-record
[education]: https://www.anthropic.com/news/anthropic-education-report-how-university-students-use-claude


------

Other examples to consider from reports

# The recursive implementation has no cycle detection. A tree with a circular reference would cause a stack overflow rather than returning an error or partial result.
pattern

Why it matters: A reusable library that crashes on malformed input rather than failing gracefully makes debugging harder for callers.

Evidence: Code shows unbounded recursion with no visited-node tracking; no discussion of cycle handling.

Exercise: Create a tree where a child's children array includes a reference back to the root. Call findNodes on it. What happens? Now add a Set to track visited nodes by reference and skip any node already seen. Does it return the matches it found before hitting the cycle?



> just a thought on an example, it might be hard to find a good one that really satisfies everybody. Somebody might read the recursive one with the specifics and think who cares I don't need to know the details of recursive and that's what tests are for. Someone might need it we need an example about caught. I'm automatically setting up ESL and TS Link can fix for you and think who cares I don't need to set that stuff up an somebody might read the one about you state first use reducer and think who cares if Claude writes it and it's tested and it passes who cares the implementation detail. Coming up with a good example is maybe harder than I can think of here maybe I'm overthinking it though and a simple react example maybe as a good one. 




<!-- markco-comments
{
  "version": 2,
  "comments": [
    {
      "id": "d25029db-20d1-40d7-8fcd-e312cdf0bb47",
      "anchor": {
        "text": "> The timer turns orange at 50% and red with pulse at 25%. If you were designing this for\n> a 2-minute timer versus a 20-minute timer, would you keep the same thresholds, and what\n> heuristic would you use to decide?",
        "startLine": 68,
        "startChar": 0,
        "endLine": 70,
        "endChar": 36
      },
      "content": "So I'm not sure I think this is a decent enough example, but I think it might be more helpful to like have an example that correlates to the Timer state one at the top or just prior to this\n\nI also I think that I think the Tyrone's a good example as far as the design distinction between when it turns 20 verse 25",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T20:03:05.526Z",
      "orphaned": false
    },
    {
      "id": "2d23ac2b-9894-41d5-a9ba-b0d8de68b6ea",
      "anchor": {
        "text": "It reads your own Claude Code session transcripts and produces a drift list: the decisions\nthat got made on your behalf, without you weighing them.",
        "startLine": 4,
        "startChar": 0,
        "endLine": 5,
        "endChar": 56
      },
      "content": "I like this statement but needs reword to sound less LLM y",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:47:29.206Z",
      "replies": [
        {
          "id": "4a78472c-01a1-490b-8599-9db093915159",
          "content": "I will narrate in my own voice",
          "author": "Matt Miller",
          "createdAt": "2026-09-06T21:47:52.574Z"
        }
      ]
    },
    {
      "id": "06389237-73f6-4420-99cd-ded5d8214351",
      "anchor": {
        "text": "They are not separate concerns. If you no longer\nremember how `useReducer` works, you will not weigh it against `useState` — not because you\nconsidered it and declined, but because it never surfaced as an option.",
        "startLine": 17,
        "startChar": 36,
        "endLine": 19,
        "endChar": 71
      },
      "content": "So I think similar to the other example this one needs to be more generally applicable like or you know not react specific maybe a recursive function here is like a good point cause every what's something that every software engineers done that wouldn't be type scripture react, specific and something where you know you could kind of argue like I don't need to do this anymore called code. Write it for me or even before Claud code like I just google search and copy paste it from stack overflow, but you could also argue that understanding and having written this written this from type of thing from scratch beforeis you know valuable experience to have had and maybe helps you understand some of the pitfalls of the specific function and then allows you to better understand when it's the right fit when you're prompting a model who may or may may or may not be using that pattern. Like that's the kind of example I think that it needs to be highlighted in the read me to be relatable to a broad audience of software engineering.",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:49:49.919Z"
    },
    {
      "id": "00c11016-3b90-4c10-ab89-807f5dc868dc",
      "anchor": {
        "text": "cognitive",
        "startLine": 23,
        "startChar": 30,
        "endLine": 23,
        "endChar": 39
      },
      "content": "so I have the sources cited here maybe you could point me to the kind of the specific lines or\n\nAround this statement, I guess delegation does concentrate around coding agents that make sense. Is that compared to other uses of large language, models or Claude?",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:50:45.642Z"
    },
    {
      "id": "e20b72dd-1b5b-48eb-a763-96047221f318",
      "anchor": {
        "text": "([The research](#the-research), below.",
        "startLine": 26,
        "startChar": 0,
        "endLine": 26,
        "endChar": 38
      },
      "content": "I know I linked to the research here which is great and and I think I cited in the research block site of my sources, but I think for these three lines it would be beneficial to add citations whether it's the whole block from the same paper or other I want to have three separate citations, cause these are three really bold claims to be making right upfront\n\nFirst that Anthropic research points to delegation, concentrating in AI assisted coded agents and as being the highest place where delegation to the model happens\n\nSecond that cognitive dependencies is among the most common fears people hold about AI is that really true? Is that just within researching domain is that in general public definitely citing that source here\n\nAnd then this again, the specific worry of this crutch stifling the development of fundamental skills needed to support higher order thinking I mean it is a great line. I should cite where that comes from here in this short bit, as well as as in the full research section in the read me.",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:52:22.813Z"
    },
    {
      "id": "c93b30ef-3e50-4345-a135-a1188a955bb4",
      "anchor": {
        "text": "you cannot review what you have never had to\n  decide.",
        "startLine": 31,
        "startChar": 45,
        "endLine": 32,
        "endChar": 9
      },
      "content": "I'm not even sure this flourish line is needed. You cannot review what you have never had to decide. It seems a little editorial, having read a lot of stuff that Claude has generated recently. And I think the first part of the sentence before the M – really holds the weight.\n\nSo the statements here is that engineers early in their careers may never build the judgment that makes senior engineers effective at directing models, and engineers later in their career may quietly lose this judgment one route delegated decision at a time, although while their output is going up",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:53:50.056Z",
      "orphaned": true
    },
    {
      "id": "07445685-3265-4070-8c77-360d3f1b9ab7",
      "anchor": {
        "text": "Neither shows up in your commit history. Both show up in your transcripts.\n",
        "startLine": 36,
        "startChar": 0,
        "endLine": 37,
        "endChar": 0
      },
      "content": "This is another sentence. I will word a little bit more in my own narrative. Sounds like LLM nail. Something like \"neither of these is reflected in your commit history, but can be reasoned from your Claude code transcripts.\"",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:54:37.333Z",
      "orphaned": true
    },
    {
      "id": "aac747a5-11bc-4644-b34d-2aa10fd07255",
      "anchor": {
        "text": "the analysis engine that makes any of that possible, as a CLI",
        "startLine": 38,
        "startChar": 23,
        "endLine": 38,
        "endChar": 84
      },
      "content": "all reword to something like the analytical foundation that makes this possible runnable as a CLI tool. I don't think the rest of its needed like maybe saying that it outputs Jason and markdown files. And that this data will later be used for the VS code extension.",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:56:05.207Z",
      "orphaned": false
    },
    {
      "id": "716dab2b-3079-4848-a6cc-e3818607204d",
      "anchor": {
        "text": "Point it at a time range. It reads the Claude Code session logs in `~/.claude`, builds a\ndecision log of what got decided and by whom, and renders your drift list.\n\nEvery item names a decision Claude made, who drove it, whether you engaged, and what skill\nsits behind it — plus a concrete exercise where one is worth doing.",
        "startLine": 46,
        "startChar": 0,
        "endLine": 50,
        "endChar": 67
      },
      "content": "I think you're having a little mermaid diagram that shows the pipeline would be helpful so you know reading Claude code session logs either you know between a specific time range second block is building a decision. Log third block is a render function and then the fourth block the output is the markdown reportas well as the Jason files. It might be worth highlighting the decision block also outputs Jason on file.",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:57:16.832Z",
      "replies": [
        {
          "id": "5548909f-df5d-4312-acf7-305c9c8a6c2a",
          "content": "Here the sentence \"Every item names a decision Claude made, who drove it, whether you engaged, and what skill\nsits behind it — plus a concrete exercise where one is worth doing.\" I think works well. And is a nice lead in to the example",
          "author": "Matt Miller",
          "createdAt": "2026-09-06T21:57:56.412Z"
        }
      ],
      "orphaned": false
    },
    {
      "id": "f9eebe56-5797-4f8f-a03b-67220e67b9ac",
      "anchor": {
        "text": "Claude implemented the timer state machine with useState managing four states\n  (idle, running, paused, done). Whether useReducer would clarify the transitions\n  or add ceremony went undiscussed.\n\n  kind: pattern - driver: claude - engagement: none\n  concepts: react-state, async-scheduling\n\n  Exercise: Write a timer state machine from memory using useState with four\n  states: idle, running, paused, done. Add start, pause, resume and reset\n  actions. Now rewrite it with useReducer. Which version made illegal states\n  harder to represent?",
        "startLine": 53,
        "startChar": 2,
        "endLine": 63,
        "endChar": 22
      },
      "content": "this should probably relate to the example that's used throughout the read me. I would be interesting from Claude's perspective. If multiple examples help tell the story or if the three examples here should be kind of of the same same thing related. It's tempting to write something like this from scratch, but I think I should either pull from my existing reports or maybe do kind of a clean exercise and run a report on it. In that case, probably the recursive or the react clean runs would be good.",
      "author": "Matt Miller",
      "createdAt": "2026-09-06T21:59:03.066Z",
      "orphaned": false
    }
  ]
}
-->