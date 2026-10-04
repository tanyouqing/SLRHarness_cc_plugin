---
name: update
description: Incrementally refresh a completed SLR Harness review with newly published or newly in-scope evidence. Use when the user explicitly asks to update, refresh, or extend an existing completed review; do not use for resuming an unfinished review or merely revising its manuscript.
argument-hint: <slug | resume <slug> [update-id] | status <slug> [update-id]>
---

# SLR Harness incremental update

Refresh one completed review in place while preserving its original state, notes,
references, report text, and `slr-complete` checkpoint. The user's text after the
command is `$ARGUMENTS`.

Treat `${CLAUDE_PROJECT_DIR}` as an immutable project root. Never run `cd`. Resolve
the review as `${CLAUDE_PROJECT_DIR}/workspaces/<slug>` and use absolute paths for
all file and Git operations.

Before acting, read:

- [workflow.md](${CLAUDE_SKILL_DIR}/references/workflow.md) for routing, scope review,
  orchestration, incremental lanes, recovery, and Git rules.
- [update-schemas.md](${CLAUDE_SKILL_DIR}/references/update-schemas.md) before
  creating or changing update files.
- The review skill's scoping reference at
  `${CLAUDE_PLUGIN_ROOT}/skills/review/references/scoping.md` when drafting or
  revising an update scope.

## Non-negotiable gates

1. Only a workspace whose root state is `completed` or
   `completed_with_limitations` is eligible. Never reopen or modify root state.
2. On the first update request, only read and present the current effective scope,
   prior coverage, unresolved questions, proposed coverage dates, and default three
   rounds. Do not create files, search, or invoke any agent. Stop for user input.
3. Compatible scope refinements are allowed. A materially different core research
   question requires a new `/slr-harness:review` workspace.
4. Scope feedback creates or revises only the update draft and update state. Stop
   after every unapproved draft.
5. Begin retrieval only after explicit approval such as "approve this update
   scope", "use the existing scope and approve", or "批准本次 update scope".
   Vague positives are not approval.
6. During research, retain every pre-update topic note and every byte of the report
   baseline. Add update synthesis after the preserved report; never delete or
   silently rewrite prior findings or references.

## Defaults

- Maximum update rounds: 3
- Parallel workers: 3
- Retry limit: 2
- Saturation: two consecutive reviewed rounds with zero new eligible sources and
  zero accepted new tasks
- Language, source mode, ranking, and evidence tiers: inherit the latest approved
  scope; if it predates mandatory scoring, propose the default ESS/RUS/ORS rubric
  and core-item backfill in the update draft
- Coverage end: today
- Coverage start: the latest explicit evidence cutoff; otherwise the most recent
  completion-tag date, disclosed as an assumption

Validate every update-state replacement with:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/update-state.mjs" validate <absolute-update-state-path>
```

Before approving an update scope, validate its rubric with:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-ranking-scores.mjs" config <absolute-update-scope-path>
```

Create the baseline after approval with:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-evidence-baseline.mjs" <absolute-workspace> <absolute-update-directory>/EVIDENCE_BASELINE.json
```

After every manager review and before finalization, verify legacy-note immutability:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-evidence-baseline.mjs" verify <absolute-workspace> <absolute-update-directory>/EVIDENCE_BASELINE.json
```

After approval, run without planned user pauses until the update is terminal. Stop
only for a real collision, permission/authentication failure, unavailable required
search capability, or ambiguity that would materially change the approved scope.
