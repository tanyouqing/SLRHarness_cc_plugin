---
name: review
description: Plan, run, resume, or inspect a structured literature review. Use when the user asks for a literature review, related-work survey, systematic/scoping review, research landscape, review scope, or wants to revise or approve an SLR Harness scope.
argument-hint: <topic | resume <slug> | status <slug>>
---

# SLR Harness workflow

Operate a two-gate literature-review workflow rooted at `${CLAUDE_PROJECT_DIR}/workspaces/`.
The user's text after the command is: `$ARGUMENTS`.

Treat `${CLAUDE_PROJECT_DIR}` as an immutable project root. Never run `cd` or rely
on the session's current working directory. Derive one absolute workspace path as
`${CLAUDE_PROJECT_DIR}/workspaces/<slug>`, use absolute paths for every Read/Write/Edit,
and run Git only as `git -C <absolute-workspace> ...`.

Before taking action, read all of:

- [workflow.md](${CLAUDE_SKILL_DIR}/references/workflow.md) for routing, approval semantics, orchestration, recovery, and stopping rules.
- [workspace-schemas.md](${CLAUDE_SKILL_DIR}/references/workspace-schemas.md) before creating or changing workspace files.
- [scoping.md](${CLAUDE_SKILL_DIR}/references/scoping.md) before drafting or revising a scope.

## Non-negotiable gates

1. Before creating a new workspace or launching a scoper, resolve the four review
   configuration items in the workflow reference. Ask once for only the items the
   user has not already specified.
2. A completed configuration answer is not scope approval. A new topic then creates
   or revises `SCOPE_DRAFT.md` only. Do not create research tasks or launch research
   workers yet.
3. Stop after presenting the draft and ask the user to explicitly approve it or request changes.
4. Start formal research only after an unambiguous approval such as "approve the scope", "scope approved", "批准 scope", or "按这个 scope 开始正式调研".
5. Praise, acknowledgements, and vague positives such as "looks good", "不错", or "可以看看" are not approval. Ask for explicit approval and stop.
6. After explicit approval, run the formal review to a terminal state without planned user pauses. Ask again only for a genuine collision, permission/authentication failure, unavailable required search capability, or ambiguity that would materially change the review.

## Defaults

- Primary objective: landscape mapping
- Maximum rounds: 5 (standard; alternatives offered during intake are 3 quick and
  8 deep, with a custom positive integer allowed)
- Source coverage: academic sources plus authoritative grey literature
- Time coverage: let the scopers recommend a range
- Parallel workers per round: 3
- Task retry limit: 2
- Saturation: two consecutive reviewed rounds with zero new eligible sources and zero accepted new tasks
- Output language: English unless the user explicitly asks for Chinese output.
  A topic written in Chinese is not by itself a request for Chinese output. Preserve
  source titles and technical terms in their original language.

The user may override limits in ordinary language. Record the chosen maximum rounds
in `.slr/state.json`; record the other intake choices in `SCOPE_DRAFT.md` without
adding state fields.
Never overwrite an existing workspace. Follow the collision and resume rules in the workflow reference.
Choose and record the output language when creating the scope. It may change through
an explicit scope revision before approval, but is frozen after approval. When
resuming, keep the workspace's recorded language.

Whenever the main session writes `.slr/state.json`, replace the complete file and run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" validate <absolute-state-path>`
before committing. Stop for recovery if validation fails.
