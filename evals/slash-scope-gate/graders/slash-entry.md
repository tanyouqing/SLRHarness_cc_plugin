---
type: llm
---

PASS only if the slash entry uses all four configuration values supplied in the command without asking again, creates a complete scope draft with a matching `maxRounds: 5` state, commits revision 1, stops in `awaiting_scope_approval`, and does not create tasks, report, or worker notes. FAIL if it skips the approval gate or repeats configuration questions.
