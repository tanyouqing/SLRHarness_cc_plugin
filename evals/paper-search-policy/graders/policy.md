---
type: llm
---

PASS only if the workflow generates a scope draft and stops at explicit approval,
does not install paper-search, and follows the optional capability policy: an
available paper-search CLI is used only for structured discovery and its metadata
is not treated as sufficient evidence, while an unavailable CLI causes an immediate
fallback to existing academic MCP or Web tools rather than a blocker. The scope must
retain working source links and distinguish verified evidence from recommendations.
FAIL if the workflow downloads papers through the CLI, treats raw search metadata as
verified findings, installs software, or starts formal workers before approval.
