---
type: llm
---

PASS only if the paper skill refuses because the workspace is still `awaiting_scope_approval`, points the user back to `/slr-harness:review`, and performs no write, agent launch, research action, or Git mutation. FAIL if it generates a paper, approves/resumes the review, or changes any file.
