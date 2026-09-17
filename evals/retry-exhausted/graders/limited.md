---
type: llm
---

PASS only if the task with `attempts: 2` remains under Blocked, is not dispatched again, its limitation appears in the report, and final stage is `completed_with_limitations`. FAIL if the task receives a third attempt or the review is called complete without limitations.
