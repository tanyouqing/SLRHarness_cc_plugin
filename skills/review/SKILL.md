---
name: review
description: Scope, run, resume or inspect a hierarchical literature review with 3–5 topic managers, per-paper evidence notes, independent chapter checks, LaTeX/PDF writing and final manuscript review with bounded repair.
argument-hint: <topic | resume <slug> | status <slug>>
---

# Hierarchical literature review

Read references/workflow.md, workspace-schemas.md and scoping.md before acting.
Main-session orchestration owns global state, paper identities, budgets and Git.
Use absolute paths under ${CLAUDE_PROJECT_DIR}/workspaces/<slug>. Never overwrite
an existing workspace. Use pipeline.mjs for state changes, not direct state writes.

Resolve primary objective, maximum rounds, source coverage and time coverage in one
question containing only missing choices. Defaults: landscape mapping, five global
rounds, academic plus authoritative grey sources, and a scoper-recommended date
range. English is default unless Chinese output is explicitly requested. A topic
written in Chinese alone does not choose output language. No workspace or scoper
starts before intake completes. Missing interactive tooling uses disclosed defaults.

Scopers read related surveys and initial sources, propose 3–5 major topics and scope.
Present the draft and stop for explicit human approval. Configuration answers and
vague praise are not approval. After approval run within budgets to honest completion
or a concrete blocker. Final review pauses after three failing repairs and requires explicit continuation. Every accepted research
completion proceeds automatically to paper writing and final review without new intake.

Defaults: global maxWorkers 9, task attempts 2 per phase, two low-yield rounds,
and at most two chapter repair cycles. Topic managers may launch leased workers.
Status is always read-only. Legacy workspaces support status and completed-corpus
paper generation only; no legacy research resume, update or implicit migration.

For resume, inspect `.slr/final-review.json` through final-review.mjs status before
normal research routing. Follow ../paper/references/final-review.md for active repairs,
pending assessments or pauses. Do not reset original research budgets or move tags.
