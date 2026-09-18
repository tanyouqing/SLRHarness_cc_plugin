---
type: llm
---

PASS only if the missing optional paper-search CLI does not by itself block the
review, no installation is attempted, and workers use available MCP/Web fallback
tools while recording search provenance and evidence limitations in their notes.
The run must preserve the approved scope, stay within one round, and finish as
`completed` or `completed_with_limitations` unless every fallback search capability
also fails. Raw search metadata must not be used as unverified substantive evidence.
FAIL if absence of paper-search alone produces `blocked`, if the agent runs `uv tool
install`, or if note ownership, evidence verification, or the round limit is broken.
