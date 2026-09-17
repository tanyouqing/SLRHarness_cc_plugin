# SLR Harness plugin design

## Goal

SLR Harness converts a vague topic into a reproducible literature-review workspace
with one mandatory human gate: the user must explicitly approve the generated scope
before formal research. The plugin keeps orchestration in the main Claude Code
session and delegates bounded work to native subagents.

## Components

| Component | Responsibility | Important restrictions |
| --- | --- | --- |
| `review` skill | Routes new, revise, approve, resume, and status requests; orchestrates rounds | Must stop after every unapproved draft |
| `slr-scoper` | Performs two complementary scope reconnaissance passes | Read/Web only; no writes or agent delegation |
| `slr-manager` | Plans, validates, synthesizes, updates state, and maintains Git | No Web or agent tools; cannot modify `SCOPE_ORIGINAL.md` |
| `slr-worker` | Researches one narrow task and writes one assigned note | No shell, Git, agent tools, or control-file writes |
| PreToolUse guard | Enforces path, state-transition, and Git-command policy | Immediately allows non-plugin agents |

The scopers run in parallel: one covers terminology, queries, and databases; the
other covers boundaries, prior reviews, comparison dimensions, and assumptions.
The main skill merges their evidence with the bundled scoping guidance.

## Human-gated lifecycle

```text
topic
  -> drafting_scope
  -> awaiting_scope_approval
       -> revise scope -> awaiting_scope_approval
       -> explicit approval -> researching
  -> completed | completed_with_limitations

researching <-> blocked (resume after the prerequisite is restored)
```

Only explicit approval intent opens the gate. Approval freezes the accepted draft
byte-for-byte as `SCOPE_ORIGINAL.md`, copies it to the living `SCOPE.md`, initializes
the formal artifacts, and tags `round-0`. During research, scope evolution is
append-only and recorded in `## Scope Evolution Log`.

## Research round

Each round has three sequential phases:

1. `slr-manager` in `plan` phase updates `TASKS.md`, assigns unique note paths, and
   commits `round-N-plan`.
2. The skill selects at most three pending tasks and launches one `slr-worker` per
   task in parallel. Each worker writes only its assigned note and related assets.
3. `slr-manager` in `review` phase validates notes, adds reciprocal links
   sequentially, updates tasks/state/report, commits `round-N-review`, and tags the
   round.

Centralizing cross-links in review avoids concurrent sibling-note edits. Notes must
contain a summary, findings, comparison data, ranking scores where applicable,
related topics, open questions, canonical sources, and full references. Unverified
evidence is explicitly marked; it is never completed by invention.

`REPORT.md` is updated after every review and contains Overview, Method & Coverage,
Comparison Table, Findings by Group, Cross-Cutting Themes, Gaps, Limitations,
References, and Notes Index.

## Completion policy

Research stops when any condition holds:

- no pending task remains;
- two consecutive rounds add neither an eligible source nor a valid task; or
- five rounds have completed.

The manager then runs `finalize`, revalidates the report and notes, records unresolved
work, commits the final state, and tags `slr-complete`. Any unresolved blocked work
produces `completed_with_limitations`, not `completed`.

## Persistent state and recovery

`.slr/state.json` is the routing authority. Its fixed fields and task/note schemas
are documented in `skills/review/references/workspace-schemas.md` and validated by
`scripts/state.mjs`. Every update is a complete atomic Write so the guard can reject
illegal transitions.

Within a session, the active workspace is reused. Across sessions, one unfinished
workspace is resumed automatically; multiple candidates require a user choice.
Existing slugs are never overwritten. A task is retried at most twice before moving
to Blocked.

## Safety model

`hooks/hooks.json` registers a dependency-free Node PreToolUse hook. It checks the
invoked plugin agent and:

- denies all writes from scopers;
- limits workers to `topics/` and `assets/` inside the delegated workspace;
- denies manager changes to `SCOPE_ORIGINAL.md` and `.git` internals;
- validates complete state writes and legal stage transitions;
- anchors workspace checks to `${CLAUDE_PROJECT_DIR}` while resolving relative
  targets from the agent's real cwd, so project-root and review-root execution are
  both safe and duplicated `workspaces/<slug>` prefixes are rejected;
- limits manager shell use to workspace-local directory creation and an explicit
  non-destructive Git allowlist;
- permits round/final tags only after the matching committed state and commit
  subject exist, with one guarded `tag -f round-N HEAD` repair path;
- passes through calls from every unrelated agent.

Node and Git are the only external runtime prerequisites. Optional scholarly MCP
servers can improve retrieval, but workers always have Claude Code WebSearch and
WebFetch and the plugin does not depend on a vendor.

## Verification

`npm test` covers legal and illegal state transitions, traversal, cross-workspace
writes, immutable scope, non-plugin pass-through, and Git allowlisting. `evals/`
contains model-level scope gate, ambiguous approval, status/resume, and bounded
end-to-end cases. Distribution requires strict plugin and marketplace validation.
