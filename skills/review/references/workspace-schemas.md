# Workspace schemas

All paths below are relative to `workspaces/<reviewId>/`.

## `.slr/state.json`

Write the complete file for every state update; do not patch it with Edit.

```json
{
  "schemaVersion": 1,
  "reviewId": "ascii-hyphenated-slug",
  "topic": "Original user topic",
  "language": "Language used for scope, notes, and report",
  "stage": "drafting_scope",
  "scopeRevision": 0,
  "currentRound": 0,
  "maxRounds": 5,
  "maxWorkers": 3,
  "consecutiveLowYieldRounds": 0,
  "retryLimit": 2,
  "completionReason": null,
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

`lastError` is optional and must be a non-empty string when present. Valid stages:

`drafting_scope`, `awaiting_scope_approval`, `researching`, `blocked`, `completed`,
`completed_with_limitations`.

During research, also maintain:

```json
"roundMetrics": {
  "round": 1,
  "dispatched": 3,
  "validatedNotes": 3,
  "newEligibleSources": 11,
  "acceptedNewTasks": 1,
  "failedWorkers": 0
}
```

Omit `roundMetrics` before the first review pass.

## `TASKS.md`

```markdown
# Tasks: <theme>

## Round <N>

### Pending
- [ ] topics/<group>/<note>.md — <one narrow task> <!-- attempts: 0 -->

### Blocked

## Completed
- [x] topics/<group>/<note>.md — <description> (round N)

## Backlog
```

Only `slr-manager` writes this file. A worker failure increments the attempts marker.
After `retryLimit`, move the task to Blocked with the last concrete failure reason.

## `REPORT.md`

```markdown
# Literature Review: <theme>

## Overview
## Method & Coverage
## Comparison Table
## Findings by Group
## Cross-Cutting Themes
## Gaps & Open Questions
## Limitations
## References
## Index of Topic Notes
```

The report is an evolving synthesis, not a concatenation of notes. Every substantive
claim needs an inline citation that resolves to the References section. Rows and
sections follow the approved ranking/grouping rules.

## Topic note

```markdown
---
title: "<narrow topic>"
tags: ["<theme>", "<group>"]
status: draft
round: <N>
---

# <Narrow Topic>

> Workspace context: [SCOPE](../../SCOPE.md) · [TASKS](../../TASKS.md) · [REPORT](../../REPORT.md)

## Summary
## Search & Screening
## Key Findings
## Comparison Data
| Dimension | Value | Evidence |
| --- | --- | --- |

## Ranking Scores
<!-- Required only when SCOPE.md defines a scoring rubric. -->

## Related Topics
<!-- Worker suggests links; manager makes reciprocal edits during review. -->

## Open Questions
## Sources
<!-- Canonical paper, project, code, and dataset links; use "none found" explicitly. -->

## References
<!-- Every cited work, with authors, year, title, venue when known, and canonical URL. -->

## Proposed Additions
<!-- Optional, evidence-based scope/task additions. -->
```

Workers must record queries/databases used, screening decisions, at least three real
sources when evidence permits, and `not reported`/`not applicable` instead of guesses.
