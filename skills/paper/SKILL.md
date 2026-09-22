---
name: paper
description: Generate or revise a formal review-paper manuscript from an already completed SLR Harness workspace. Use only when the user explicitly asks to turn completed review artifacts into a paper or manuscript; never trigger during the normal review workflow.
argument-hint: <slug> | revise <slug> <feedback>
---

# Optional review-paper writer

This workflow is independent of `/slr-harness:review`. It must never start
automatically after review finalization and must never resume, extend, or otherwise
change the research pipeline. The user's text after the command is `$ARGUMENTS`.

Treat `${CLAUDE_PROJECT_DIR}` as the stable project root. Never run `cd`. Use one
absolute workspace path `${CLAUDE_PROJECT_DIR}/workspaces/<slug>` and run Git only
as `git -C <absolute-workspace> ...`.

Before acting, read
[paper-template.md](${CLAUDE_SKILL_DIR}/references/paper-template.md) completely.

## 1. Select the workspace

- Prefer an explicit slug, then a workspace already named in this conversation.
- If neither is available and exactly one terminal workspace exists, use it.
- If several terminal workspaces exist, list their slug, topic, and terminal stage
  and ask the user to choose. Do not write anything yet.
- Only `completed` and `completed_with_limitations` are eligible. For every other
  stage, explain that formal review must finish through `/slr-harness:review` and
  stop. Do not resume it from this skill.

Read and validate `.slr/state.json`. Require `SCOPE_ORIGINAL.md`, `SCOPE.md`,
`TASKS.md`, `REPORT.md`, `topics/`, and a resolvable `slr-complete` tag. The tag is
the immutable research-completion checkpoint and must never be moved.

When completed `.slr/updates/update-NNN/state.json` files exist, also read every
corresponding approved update scope, update task registry, and update note. Treat
only final update notes as evidence. A non-terminal update is a blocker because the
evidence corpus is changing; tell the user to resume or finish `/slr-harness:update`.

Inspect `git -C <absolute-workspace> status --porcelain --untracked-files=all`.
Proceed only when the tree is clean or every dirty entry resolves to the single
path `paper/REVIEW_PAPER.md`, which represents a recoverable prior paper attempt.
Any source-artifact or unrelated change is a blocker; report it without mutation.

## 2. Route generate or revise

- `/slr-harness:paper <slug>` generates a first manuscript. If a committed
  `paper/REVIEW_PAPER.md` already exists, do not overwrite it; tell the user to use
  `revise` with feedback.
- `/slr-harness:paper revise <slug> <feedback>` requires an existing manuscript.
  Preserve its evidence boundary and apply only the requested editorial or
  structural changes. If feedback would require new evidence, explain the limit and
  revise only what the existing corpus supports.
- An uncommitted manuscript from a prior failed attempt may be completed and
  revalidated by either form; do not delete it automatically.

For first generation, extract any explicit paper settings and resolve exactly:

1. **Audience**: domain researchers (default), interdisciplinary researchers, or
   mixed research and engineering.
2. **Target length excluding references**: 3,000–5,000; 6,000–9,000 (default);
   10,000–15,000 words; or a custom positive range.
3. **Citation style**: author–year (default) or numeric.

Ask once with `AskUserQuestion` for only missing settings. If the user says to use
defaults or that tool is unavailable, use the defaults above. Paper language
inherits `.slr/state.json.language`; override it only when the user explicitly asks
for a different manuscript language. Do not change state.

Revisions preserve the existing manuscript's language, audience, length class, and
citation style unless the user explicitly requests a change; do not repeat intake.

## 3. Delegate the manuscript

Create `paper/` if necessary, without entering the workspace. Invoke exactly one
`slr-harness:slr-paper-writer` in the foreground. Provide:

- absolute project root and workspace path;
- absolute output path `paper/REVIEW_PAPER.md`;
- generate or revise mode and the complete revision feedback;
- terminal stage and the commit resolved by `slr-complete`;
- absolute paths for every completed update's approved scope, state, and task file,
  plus its `update-NNN-complete` ref; omit this item when no update exists;
- paper language, audience, target length, and citation style;
- absolute path to the paper-template reference.

State that cwd is untrusted, no search or new evidence is allowed, and only the
supplied output file may be changed. The writer must read every topic note, complete
its evidence plan and self-check before writing, and return only a terse status.

## 4. Validate and commit

After the writer returns, inspect the manuscript and Git diff. Do not commit unless:

- every required logical section from the template is present and non-empty;
- the prose contains no citations to REPORT, SCOPE, TASKS, or topic-note paths;
- every in-text citation resolves to References and every reference is cited;
- no author, date, venue, DOI, URL, result, count, or method step was invented;
- `completed_with_limitations` evidence gaps are visible in limitations and future
  directions rather than presented as resolved;
- Git changes are limited to `paper/REVIEW_PAPER.md`; and
- `.slr/state.json`, both scope files, TASKS, REPORT, topics, assets, existing tags,
  and the `slr-complete` target are unchanged.

If validation fails, leave the manuscript uncommitted for recovery, explain the
specific defects, and stop. Never fill gaps with a search or model memory.

If the file has no diff, report that no commit was needed. Otherwise stage exactly
`paper/REVIEW_PAPER.md` and commit:

- generate: `paper: generate review manuscript`
- revise: `paper: revise review manuscript`

Create no tag. Finish by reporting the manuscript path, commit hash, language,
target audience and length, citation style, terminal review stage, and any evidence
limitations carried into the paper.
