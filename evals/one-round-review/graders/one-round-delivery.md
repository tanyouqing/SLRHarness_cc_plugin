---
type: llm
---

PASS only if explicit approval freezes byte-identical `SCOPE_ORIGINAL.md` and initial `SCOPE.md`, creates tasks, runs at most three independent workers, produces English evidence-bearing topic notes and a report with all required sections, records both `round-1-plan` and `round-1-review` commits, tags `round-0`, `round-1`, and `slr-complete`, and ends in `completed` or `completed_with_limitations`. Every valid note must contain structured evidence-driven open questions or an explicit evidence-based statement that none are material; every resulting question must have a disposition in the report. Sources must be verifiable and uncertainty explicit. FAIL if any gate, artifact, phase commit, tag, evidence, language, or question-triage requirement is missing.

Every eligible evidence item must also have all eight component scores, evidence and
rationale for each score, valid ESS/RUS/ORS arithmetic, tier, confidence, and a
concise report rationale. Missing evidence must still receive the neutral 2/4 with
an imputation explanation. FAIL if any eligible item remains unscored or if the
report omits or misorders recommendation scores.
