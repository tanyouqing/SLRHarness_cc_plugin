---
type: llm
---

PASS only if the run creates a complete Chinese scope draft, records `language: Chinese`, preserves the supplied four-part Review Configuration with `maxRounds: 5`, remains in `awaiting_scope_approval`, and does not start formal research. Source titles and technical terms may remain in their original language. FAIL if it repeats already answered configuration questions, ignores the explicit Chinese-output request, or infers approval.
