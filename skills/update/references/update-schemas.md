# Incremental update schemas

All paths are relative to one completed `workspaces/<reviewId>/` repository.

## Layout

```text
updates/update-001/
├─ SCOPE_DRAFT.md
├─ SCOPE_APPROVED.md
├─ EVIDENCE_BASELINE.json
└─ TASKS.md

.slr/updates/update-001/state.json
topics/updates/update-001/<note>.md
```

Use the next unused three-digit sequential update ID. Never reuse an ID, even if a
prior attempt is blocked. Only one non-terminal update may exist per workspace.

## Update state

Replace the entire file for every transition:

```json
{
  "schemaVersion": 1,
  "updateId": "update-001",
  "reviewId": "review-slug",
  "baselineRef": "slr-complete",
  "language": "English",
  "stage": "awaiting_scope_approval",
  "scopeRevision": 1,
  "coverageStart": "2026-07-01",
  "coverageEnd": "2026-09-22",
  "currentRound": 0,
  "maxRounds": 3,
  "maxWorkers": 3,
  "consecutiveLowYieldRounds": 0,
  "retryLimit": 2,
  "completionReason": null,
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

Stages are `drafting_scope`, `awaiting_scope_approval`, `researching`, `blocked`,
`completed`, and `completed_with_limitations`. `lastError` is required only while
blocked. During reviewed rounds include:

```json
"roundMetrics": {
  "round": 1,
  "dispatched": 3,
  "validatedNotes": 3,
  "newEligibleSources": 8,
  "versionUpdates": 1,
  "backfills": 2,
  "acceptedNewTasks": 1,
  "failedWorkers": 0
}
```

The original `.slr/state.json` is never changed. `baselineRef` is `slr-complete`
for the first update and the latest `update-NNN-complete` tag thereafter.

## Update scope

`SCOPE_DRAFT.md` and `SCOPE_APPROVED.md` are complete executable scopes, not patches.
Use the review scope shape and add these sections near the top:

```markdown
## Update Identity
- Update ID: update-001
- Baseline ref: slr-complete
- Prior effective scope: <path>

## Changes from Previous Scope
### Added
### Modified
### Narrowed
### Unchanged

## Incremental Search Lanes
### Freshness Lane
### Scope-Delta Lane
### Backfill Policy
```

The approved file is immutable. A compatible revision may expand or refine terms,
local boundaries, source coverage, time coverage, comparison dimensions, grouping,
or ranking. It must preserve the core research question. A fundamentally different
question requires a new review.

`EVIDENCE_BASELINE.json` contains normalized source identifiers plus a SHA-256 hash
for every topic file that existed at update approval. The manager uses those hashes
to reject any modification, rename, or deletion of legacy notes.

## Update tasks

```markdown
# Update Tasks: update-001

## Round <N>
### Pending
- [ ] topics/updates/update-001/<note>.md — [freshness|scope-delta|backfill] <task> <!-- attempts: 0 -->
### Blocked
## Completed
## Backlog
```

Each task has exactly one lane. Backfill may revisit a known source only to extract
a newly approved dimension and never counts as a new eligible source.

## Update note additions

Use the normal topic-note schema and add this frontmatter:

```yaml
update: update-001
lane: freshness | scope-delta | backfill
```

Under `## Search & Screening`, record each accepted candidate as `new source`,
`version update`, or `backfill`, plus the baseline key checked. Existing legacy
notes remain byte-for-byte unchanged.

## Report suffix

The report content at `baselineRef` is an immutable prefix. Append or revise only a
suffix shaped as:

```markdown
## Evidence Updates

### update-001
#### Scope and Coverage
#### Changes from Previous Scope
#### New Evidence and Version Updates
#### Backfilled Comparisons
#### Updated Findings and Corrections
#### Historical Evidence Outside Current Update Scope
#### Update Gaps and Limitations
#### Update References
#### Update Notes Index
#### Update Metrics and Git Reference
```

Keep all baseline text and references. If new evidence changes an earlier finding,
describe the earlier statement and append a `superseded` or `corrected` annotation
in the update suffix. If an old finding is outside the approved update scope, list
it under the historical-evidence subsection without deleting it from the report.
