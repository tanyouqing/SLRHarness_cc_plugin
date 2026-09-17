---
type: llm
---

PASS only if no plan or worker is launched after round 5, the manager finalizes with reason `max_rounds`, unresolved work is recorded as a limitation, stage becomes `completed_with_limitations`, and `slr-complete` is tagged. FAIL if round 6 starts or the result claims complete coverage.
