---
name: update
description: Inspect the status of a historical literature-review update and explain that incremental update execution is currently unavailable. Does not modify evidence or resume research.
argument-hint: status <slug> [update-id]
---

# Incremental update availability

This version supports new hierarchical reviews and completed-corpus paper delivery.
Incremental update execution is suspended for both legacy and new workspaces.
For status, read the requested existing state and report it without writing or
launching agents. For create/resume/update requests, explain the limitation and
suggest a new review or paper revision using already completed evidence. Never
silently migrate, reopen root state, backfill old notes or invoke retired workflow
references. Existing update artifacts remain untouched; an unfinished historical
update prevents paper generation until handled outside this version.
