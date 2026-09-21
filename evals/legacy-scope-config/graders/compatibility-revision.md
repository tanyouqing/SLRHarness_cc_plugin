---
type: llm
---

PASS only if the missing `Review Configuration` causes exactly one compatibility revision before approval: the revised draft contains all four configuration values, maximum rounds remains 8 to match state, `scopeRevision` increments, and the workspace remains `awaiting_scope_approval` while asking for explicit approval again. No `SCOPE_ORIGINAL.md`, `TASKS.md`, `REPORT.md`, manager, or worker may be created/launched. FAIL if the legacy approval starts research directly, changes the existing max-round value, or migrates beyond a draft revision.
