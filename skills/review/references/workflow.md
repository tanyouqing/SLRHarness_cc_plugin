# Workflow and orchestration

This file defines the executable behavior of `/slr-harness:review`.

## 1. Route the request

Inspect `${CLAUDE_PROJECT_DIR}/workspaces/*/.slr/state.json` when the request is a
revision, approval, resume, status request, or omits a new topic.

- An explicit `status <slug>` reads state and reports progress without mutation.
- An explicit `resume <slug>` resumes that workspace from its recorded stage.
- In the same conversation, prefer the workspace already named in the conversation.
- In a new conversation, if exactly one non-terminal workspace exists, use it.
- If several non-terminal workspaces exist and the user did not identify one, list
  their slugs, topics, and stages and ask the user to choose. Do not mutate any.
- A completed workspace is read-only unless the user explicitly asks for a new
  review or an incremental update. Incremental update is outside v1; create a new
  slug instead.
- For every existing workspace, treat `.slr/state.json.language` as authoritative.
  Do not infer a different language from the current message or silently translate
  an approved review.

Terminal stages are `completed` and `completed_with_limitations`.

## 2. Start a new scope

Derive a lowercase ASCII hyphenated slug from the topic. If it is empty, ask for a
usable topic. If `workspaces/<slug>` already exists, do not overwrite it: offer
resume when it is non-terminal or ask for a distinct slug when it is terminal.

Choose the output language before writing state or launching scopers. Use `English`
by default, including for a topic written in Chinese. Use `Chinese` only when the
user explicitly asks for Chinese output; mentioning Chinese sources, language, or a
Chinese-domain topic is not sufficient. Record exactly `English` or `Chinese` in
state and use it for every generated artifact while preserving source titles and
technical terms in their original language.

Create the workspace and initialize an independent Git repository on branch `main`.
Do not enter the workspace with `cd`: create and access every file by absolute path
under `${CLAUDE_PROJECT_DIR}/workspaces/<slug>` and initialize Git with `git -C`.
If Git has no usable author identity, set workspace-local `user.name` to
`SLR Harness` and `user.email` to `slr-harness@local.invalid`; never modify global
Git configuration. Create `.slr/state.json` with `stage: drafting_scope` using the
schema reference and validate it with the bundled state validator.

Launch two `slr-harness:slr-scoper` agents in parallel:

1. **Vocabulary/database reconnaissance**: terminology, synonyms, controlled
   vocabulary, likely Boolean query blocks, and domain-appropriate databases.
2. **Boundary/evidence reconnaissance**: likely scope boundaries, existing review
   landscape, comparison dimensions, feasibility, and risks of a scope that is too
   broad or too narrow.

Tell both agents to return concise evidence-grounded advice and never write files.
Use built-in WebSearch/WebFetch. If relevant academic MCP tools are already
available, the scopers may use them; never require a particular provider. Include
the selected output language in both delegations.

Synthesize the reports with `scoping.md` into `SCOPE_DRAFT.md`. Do not put review
findings or a handpicked included-paper list into the scope. Convert uncertainty
into explicit assumptions for human review.

Set the state to `awaiting_scope_approval`, set `scopeRevision` to 1, and commit:

```text
scope-draft-1: create initial review scope
```

Show the research question, important boundaries, databases, depth, and assumptions
in chat, link the draft path, ask for explicit approval or revision, and stop.

## 3. Revise a scope

Only revise a workspace whose stage is `awaiting_scope_approval`.

- Apply the user's feedback to `SCOPE_DRAFT.md` without silently weakening an
  unrelated criterion.
- If and only if the user explicitly requests a language change, update
  `.slr/state.json.language` and rewrite the complete draft in that language. A
  Chinese revision message without such a request does not change the language.
- Re-run a scoper only when the feedback introduces a domain, term, database, or
  boundary that requires fresh evidence.
- Increment `scopeRevision`, update `updatedAt`, keep the stage unchanged, and commit
  `scope-draft-N: revise review scope`.
- Present the changed decisions and ask for explicit approval or more changes. Stop.

## 4. Approve a scope

Approval must be explicit and the stage must be `awaiting_scope_approval`.
Validate every item in the scoping checklist before freezing. If the draft became
invalid through user edits, explain the concrete defect and remain at the approval
gate instead of starting research.

On successful approval:

1. Copy the accepted draft byte-for-byte to both `SCOPE_ORIGINAL.md` and `SCOPE.md`.
2. Create `TASKS.md`, `REPORT.md`, `topics/`, and `assets/` from the schema reference.
3. Remove `SCOPE_DRAFT.md`; Git history retains every draft.
4. Transition state to `researching`; set `currentRound` to 0, clear errors and
   completion reason, and update the timestamp.
5. Commit `round-0: approve scope and initialize review` and tag `round-0`.

The recorded language is frozen at this point. Formal-research prompts must carry it
forward; later messages do not switch artifact language within this workspace.

Then immediately enter the formal loop below in the same turn.

## 5. Formal review loop

Before planning another round, read state and tasks and apply the same termination
precedence used after review: an unresolved `blocked` stage stops; no pending tasks
finalizes as `all_tasks_complete`; `consecutiveLowYieldRounds >= 2` finalizes as
`saturation`; and `currentRound >= maxRounds` finalizes as `max_rounds`. Do not
dispatch another worker in any of these cases. For a blocked review, verify the
recorded prerequisite is now available before transitioning back to `researching`;
otherwise report the blocker and stop without mutation.

For `round = currentRound + 1` through `maxRounds`:

### Plan pass

Invoke `slr-harness:slr-manager` in the foreground. Include the absolute
`${CLAUDE_PROJECT_DIR}`, absolute workspace path, round number, and `phase: plan`.
Include the frozen output language. State that inherited cwd is not authoritative
and all tool paths must be absolute.
The agent must finish with a clean Git tree and a `round-N-plan` commit. It must not
create a round tag during plan.

Read the first `### Pending` section in `TASKS.md`. Ignore tasks under `### Blocked`,
`## Completed`, and `## Backlog`. If no pending task remains, invoke manager with
`phase: finalize` and reason `all_tasks_complete`, then stop.

### Worker pass

Select at most `maxWorkers` pending tasks in listed order. Launch one
`slr-harness:slr-worker` agent per task in parallel. Every delegation must contain:

- absolute `${CLAUDE_PROJECT_DIR}` project root;
- absolute workspace path;
- round number;
- frozen output language from state;
- exact task line and description;
- one unique absolute output path ending in `.md` under `topics/`;
- an instruction that cwd is not authoritative and every Read/Write/Edit target
  must use the supplied absolute workspace path.

Workers own only their assigned note. They must return a terse status containing
the output path, eligible-source count, and any failure; research detail belongs in
the file, not the parent context.

### Review pass

Invoke `slr-harness:slr-manager` in the foreground with `phase: review`, the round
number, frozen output language, absolute project/workspace roots, and the worker
statuses. The manager validates files, centralizes reciprocal links, updates task
attempts and REPORT, triages every evidence-grounded open question or proposal,
writes round metrics to state, and commits `round-N-review` before tagging `round-N`.
Actionable in-scope gaps become Pending tasks before the manager returns; other
questions remain in the report with an explicit disposition.
If an existing `round-N` tag points to an earlier plan commit, repair it only after
the review commit with `git -C <absolute-workspace> tag -f round-N HEAD`.

Read the new state and stop or continue according to this exact precedence:

1. `stage: blocked`: report the error and resume command; stop.
2. no pending tasks: finalize with `all_tasks_complete`.
3. `consecutiveLowYieldRounds >= 2`: finalize with `saturation`.
4. `currentRound >= maxRounds`: finalize with `max_rounds` and limitations.
5. otherwise start the next round.

### Finalize

Invoke `slr-harness:slr-manager` with `phase: finalize`, the reason, and the
frozen output language and absolute project/workspace roots. State again that cwd
is not authoritative. A fully resolved review becomes `completed`; saturation,
blocked tasks, unresolved actionable in-scope questions, or a round limit becomes
`completed_with_limitations`. Finalize classifies and reports unanswered legacy
questions but does not create a new phase or exceed `maxRounds`. The manager creates
a final commit, tags `slr-complete`, and leaves a clean tree.

Report the terminal stage, completion reason, rounds, validated note count, known
source count, blocked task count, and paths to `REPORT.md`, `topics/`, and the scope.

## 6. Failure and recovery

- A worker that produces no valid note remains pending and has its attempt count
  incremented in review. At two failed attempts, move it to `### Blocked`.
- Partial notes remain `status: draft` and are excluded from confident synthesis.
- If every dispatched worker fails because of network, authentication, permissions,
  or missing search tools, the review manager sets `stage: blocked`, preserves all
  work, records `lastError`, commits a recovery checkpoint, and stops.
- A resume clears `lastError` only after the failed prerequisite is available. It
  continues at the next safe phase inferred from Git and state; it never repeats a
  completed round or overwrites a note.
- If state and Git disagree, stop and report both. Never guess past an inconsistent
  checkpoint.
