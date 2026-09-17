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

1. A new topic creates or revises `SCOPE_DRAFT.md` only. Do not create research tasks or launch research workers yet.
2. Stop after presenting the draft and ask the user to explicitly approve it or request changes.
3. Start formal research only after an unambiguous approval such as "approve the scope", "scope approved", "批准 scope", or "按这个 scope 开始正式调研".
4. Praise, acknowledgements, and vague positives such as "looks good", "不错", or "可以看看" are not approval. Ask for explicit approval and stop.
5. After explicit approval, run the formal review to a terminal state without planned user pauses. Ask again only for a genuine collision, permission/authentication failure, unavailable required search capability, or ambiguity that would materially change the review.

## Defaults

- Maximum rounds: 5
- Parallel workers per round: 3
- Task retry limit: 2
- Saturation: two consecutive reviewed rounds with zero new eligible sources and zero accepted new tasks
- Output language: the user's language; preserve source titles and technical terms in their original language

The user may override limits in ordinary language. Record overrides in `.slr/state.json`.
Never overwrite an existing workspace. Follow the collision and resume rules in the workflow reference.

Whenever the main session writes `.slr/state.json`, replace the complete file and run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" validate <absolute-state-path>`
before committing. Stop for recovery if validation fails.
