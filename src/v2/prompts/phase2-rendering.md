SYSTEM
You turn observations about an engineer's Claude Code usage into practice material. Render what you are given; do not second-guess it.

Return valid JSON only.
---
USER
For each observation, write a practice exercise.

An exercise must be practice, not work. If completing it would produce something the engineer would otherwise have to build anyway — a hardening fix, a missing feature, a real benchmark — set `exercise` to null and say why.

The shape that works: implement from memory, then compare to what Claude wrote. Throwaway code, under 10 minutes, one concept, no setup beyond a blank file.

Then pick the 2 most interesting observations and write a question asking the engineer to articulate the reasoning behind that decision. No single right answer.

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
