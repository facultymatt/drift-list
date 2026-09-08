Below are exchanges from recent Claude Code sessions. Based on the decisions Claude made and the code it wrote, generate 3–5 architectural interrogation questions.

These questions should:
- Probe judgment and tradeoff reasoning, not implementation recall
- Be specific to decisions visible in the sessions (not generic)
- Be difficult enough to be interesting to a senior engineer
- Have no single "right" answer — they should spark reflection

Bad example: "What is debouncing?" (tests recall, not judgment)
Good example: "Why debounce the search input at 300ms rather than throttling at 16ms? What does each approach optimize for, and when would you choose throttle instead?"

Return a JSON array with this shape:
```json
[
  {
    "question": "string",
    "context": "string"
  }
]
```

Where `context` is one sentence explaining which session/decision prompted the question.

---

SESSIONS:

{{EXCHANGES}}
