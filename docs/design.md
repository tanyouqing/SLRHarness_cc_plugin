# SLR Harness plugin design

## Goal

SLR Harness converts a vague topic into a reproducible literature-review workspace.
The main session first resolves missing review configuration interactively, then
enforces one mandatory human gate: the user must explicitly approve the generated
scope before formal research. The plugin keeps orchestration in the main Claude
Code session and delegates bounded work to native subagents.

## Components

| Component | Responsibility | Important restrictions |
| --- | --- | --- |
| `review` skill | Routes new, revise, approve, resume, and status requests; orchestrates rounds | Must stop after every unapproved draft |
| `update` skill | Reviews scope and incrementally refreshes a terminal workspace | No search before update-scope approval; never reopens root state |
| `slr-scoper` | Performs two complementary scope reconnaissance passes | Read/Web only; no writes or agent delegation |
| `slr-manager` | Plans, validates, synthesizes, updates state, and maintains Git | No Web or agent tools; cannot modify `SCOPE_ORIGINAL.md` |
| `slr-worker` | Researches one narrow task and writes one assigned note | No shell, Git, agent tools, or control-file writes |
| `paper` skill | Optionally turns a terminal workspace into a formal review manuscript | Explicit invocation only; never changes review state or resumes research |
| `slr-paper-writer` | Synthesizes one manuscript from existing review artifacts | No Web, MCP, shell, agents, skills, or writes outside the fixed manuscript path |
| PreToolUse guard | Enforces path, state-transition, and Git-command policy | Immediately allows non-plugin agents |

The scopers run in parallel: one covers terminology, queries, and databases; the
other covers boundaries, prior reviews, comparison dimensions, and assumptions.
The main skill merges their evidence with the bundled scoping guidance.

New workspaces default to English output regardless of the topic's language. An
explicit request selects Chinese instead. The choice is visible in the draft,
recorded in state, may be revised before approval, and is frozen after approval.

Before either scoper starts, the main skill resolves primary objective, maximum
rounds, source coverage, and time coverage. Choices already present in the request
are not asked again; all missing choices are collected in one `AskUserQuestion`.
No workspace exists before this intake completes. The chosen maximum rounds uses
the existing state field, while the other choices are recorded in the scope and
translated into its question and eligibility criteria. This preserves the state
schema and formal research pipeline.

## Human-gated lifecycle

```text
topic
  -> interactive configuration (only when settings are missing)
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

The approved `Review Configuration` is frozen with the scope. Academic-only mode
admits papers and preprints as evidence; the default additionally admits authoritative
technical reports, standards, official documentation, white papers, and official
research/engineering blogs. Broad-web mode can include expert blogs, project posts,
and social discussion only with explicit provenance, evidence tier, and
cross-verification. These modes change screening policy, not the worker-note or
report templates.

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
contain a summary, findings, comparison data, mandatory per-source ranking scores,
related topics, open questions, canonical sources, and full references. Unverified
evidence is explicitly marked; it is never completed by invention.

Every eligible evidence item receives eight integer 0–4 component scores. ESS
combines rigor, validation breadth, reproducibility, and transparency; RUS combines
scope relevance, contribution centrality, comparison completeness, and objective
fit; ORS combines ESS and RUS. Missing evidence is neutrally imputed at 2/4 with a
reason and lower confidence, never omitted. A bundled read-only Node validator
recomputes composites during manager review without adding a pipeline phase.

Open questions are evidence-driven rather than quota-filled. Workers normally
produce two to five structured questions or explain why none are material. During
the existing review phase, the manager deduplicates every question, proposal,
material conflict, and decision-relevant missing value. Actionable in-scope gaps
become pending tasks; all other items receive a traceable disposition in the report.
This does not add a pipeline phase or relax the round limit.

`REPORT.md` is updated after every review and contains Overview, evidence-backed
Terminology/Conceptual Distinctions/Field Boundaries, Significance and
Upstream/Downstream Impact, Method & Coverage, Comparison Table, Findings by Group,
Cross-Cutting Themes, Gaps, Limitations, References, and Notes Index.
The comparison table exposes ESS, RUS, ORS, tier, confidence, and a concise
recommendation rationale; full dimension-level reasons remain in topic notes.

## Optional manuscript workflow

The paper workflow is a separate post-completion branch, not a fourth research
phase. It is reachable only through `/slr-harness:paper` after state is `completed`
or `completed_with_limitations` and `slr-complete` resolves. It does not invoke the
review skill, manager, worker, or scoper and does not mutate state, scope, tasks,
report, notes, assets, or review tags.

One `slr-paper-writer` reads the immutable scope, living scope, every topic note,
the report, tasks, and state. Final notes are the only factual evidence; draft notes
can expose limitations but cannot support conclusions. The writer produces only
`paper/REVIEW_PAPER.md`, with formal sections for abstract, foundations, documented
methodology, taxonomy, thematic synthesis, comparison, discussion, open questions,
limitations, conclusion, and original-source references. It cannot search or add
facts from model memory.

The public skill validates manuscript structure, citation/reference consistency,
evidence boundaries, and a paper-only Git diff. Successful generation or revision
creates a `paper:` commit after the existing `slr-complete` commit. No paper tag or
new persistent state is introduced, so the research lifecycle remains unchanged.

## Incremental update workflow

`/slr-harness:update` is a separate post-completion branch. Its first invocation is
read-only and shows the latest effective scope, original-scope differences, evidence
cutoff, unresolved gaps, and proposed update limits. Compatible scope changes are
saved in an update-local draft and require the same explicit approval semantics as
the original review. A new core research question is routed to a new review.

Each `update-NNN` owns an approved scope, evidence baseline, task registry, state,
and notes under `topics/updates/update-NNN/`. Root state, both root scope files, root
tasks, and all legacy notes remain unchanged. A deterministic Node helper indexes
final-note and report references by DOI, base arXiv ID, normalized title, and
canonical URL so workers can distinguish new sources, version updates, duplicates,
and backfill.

After approval, two read-only scopers cover freshness and scope-delta lanes. The
existing manager/worker round architecture then runs with update-local paths and a
default limit of three rounds. REPORT is rewritten only as its complete baseline
text plus an update suffix; the guard verifies the baseline tag's REPORT is an exact
prefix. Corrections, superseded findings, and historical items outside the latest
scope are additive annotations rather than deletions.

When a legacy effective scope lacks scoring, update approval adds the default rubric
as a compatible delta and backfills only works already in the baseline comparison
table or named as principal Findings-by-Group subjects. Scores and reasons live in
new update notes and the additive report suffix; legacy notes remain immutable.

The original `slr-complete` tag never moves. Updates use `update-NNN-start`,
`update-NNN-round-N`, and `update-NNN-complete`, and can resume independently from
their persisted update state.

## Completion policy

Research stops when any condition holds:

- no pending task remains;
- two consecutive rounds add neither an eligible source nor a valid task; or
- the configured maximum number of rounds has completed (5 by default).

The manager then runs `finalize`, revalidates the report and notes, records unresolved
work, commits the final state, and tags `slr-complete`. Any unresolved blocked work
or actionable in-scope question produces `completed_with_limitations`, not
`completed`.

## Persistent state and recovery

`.slr/state.json` is the routing authority. Its fixed fields and task/note schemas
are documented in `skills/review/references/workspace-schemas.md` and validated by
`scripts/state.mjs`. Every update is a complete atomic Write so the guard can reject
illegal transitions.

Within a session, the active workspace is reused. Across sessions, one unfinished
workspace is resumed automatically; multiple candidates require a user choice.
Existing slugs are never overwritten. A task is retried at most twice before moving
to Blocked.

Update recovery uses `.slr/updates/update-NNN/state.json`; it does not alter the
root review state or consume the original review's round budget.

## Safety model

`hooks/hooks.json` registers a dependency-free Node PreToolUse hook. It checks the
invoked plugin agent and:

- denies all writes from scopers;
- limits workers to `topics/` and `assets/` inside the delegated workspace;
- while an update is active, narrows worker writes to that update's topics/assets
  subtree and manager writes to update-local controls plus REPORT;
- validates update state and update Git checkpoints, and requires REPORT writes to
  preserve the exact baseline report prefix;
- limits the paper writer to exactly `paper/REVIEW_PAPER.md` and denies it all shell access;
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
