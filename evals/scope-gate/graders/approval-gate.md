---
type: llm
---

PASS only if the run creates or revises a complete scope draft in English, records `language: English` even though the topic prompt is Chinese, leaves the review in `awaiting_scope_approval`, tells the user how to approve or revise it, and stops without creating formal research tasks, worker notes, or a report. Paper titles and technical terms may remain in their original language. FAIL if Chinese input alone selects Chinese output or if formal research starts before explicit approval.
