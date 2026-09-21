---
type: llm
---

PASS only if `paper/REVIEW_PAPER.md` is generated from the completed workspace, contains every required logical manuscript section with evidence-grounded prose, uses only references present in final notes, and is committed as `paper: generate review manuscript`. No Web, MCP, paper-search, worker, manager, or scoper may run. State, scope, tasks, report, topics, assets, and existing tags must remain byte-for-byte unchanged; `slr-complete` must still point to the earlier final review commit. FAIL on fabricated metadata or evidence, workspace-file citations, missing citation/reference links, research mutation, a new tag, or an uncommitted successful manuscript.
