# Optional Survey KB integration

For NEW investigations, pass `surveyKb: {enabled: true}` to pipeline init by default.
An explicit request such as “这次不需要 survey kb” sets false. Persist once; resume
never re-infers the value. No old-workspace migration or mid-run switch is supported.
All research, acceptance, writing and review contracts remain the same.

## Main-session setup

Initialize the workspace BEFORE spawning the first Scoper. Then run exactly:

```sh
node "<plugin>/scripts/kb-control.mjs" attach "<workspace>"
```

The PreToolUse lifecycle hook attaches the host's actual session/transcript metadata.
On resume attach again; existing sessions keep their original boundary. If attachment
fails, report the KB integration warning and continue research without inventing IDs.
Main does not call MCP KB tools or read full cached evidence. Pass enabled and actual
workspace/plugin paths to delegated roles.

Initialize the Scoper with READY, capture its real runtime ID, and, when KB is on, run:

```sh
node "<plugin>/scripts/kb-control.mjs" bind-scoper "<workspace>" "<actual-agent-id>"
```

Then resume reconnaissance. Worker/Manager use existing research bindings; Paper
uses the current writing-phase binding. Keep status read-only. The Stop hook starts a detached one-shot sync after successful delivery.
The conversation may remain open; no exit or resident service is required.

## Retrieval rules

Only Worker searches/reads papers. Only worker, manager, scoper and paper search/read
strategies, with their own role filter. Checker/Reviewer never read KB, including
its cache. Main and delegated Agents never call submit_* or get_job.

Use `mcp__survey-kb__search_papers`, `mcp__survey-kb__search_strategies`, and
`mcp__survey-kb__read`. Selected records must be read at the retrieved revision.
Search defaults are five papers or three strategies. Strategies use scope_planning,
task_planning, paper_discovery, paper_reading, topic_synthesis or paper_writing as
appropriate. These are suggested names, not an enum. Stage filtering is optional:
omit it for broad retrieval or when uncertain; explicit descriptive values are
accepted. The guard never adds a stage filter. Actual task/phase still isolates
caches, independently of the optional query filter.

PostToolUse saves full responses, then replaces model-visible output with bounded
views. First use the role-scoped `kb-control cache-query` helper shown in Agent
prompts, with the intended method and JSON arguments. `hit:true` returns the cached
view normally; `hit:false` proceeds to MCP. Duplicate MCP calls are allowed and may
contact the server: PreToolUse cannot synthesize a successful tool response.
Additional slices use `cache-read`.
Never bypass it to read raw caches, trajectories, queues or another task's view.
An unavailable KB returns to ordinary work with a brief warning, not endless retries.

## Paper handoff

Worker discovers a KB paper, reads its full record and adds this optional candidate
field (alongside all existing candidate fields):

```json
{"knowledgeBase":{"id":"KB UUID","revision":2,"cacheKey":"64-character returned key"}}
```

Manager finish-discovery validates provenance and registers the usual stable local
ID/owner. Its kbImports result supplies the local ID and source reference. Keep that
reference in reading assignments. The raw imported note remains separate; Worker
writes the normal local metadata.json/note.md with local ID and required sections.
Reuse sufficient evidence directly and fill only genuine gaps. Missing metadata or
verification remains unknown. Manager accepts through the existing procedure.
Acceptance freezes notes locally; no upload occurs before whole-run success.
Main never retypes or uploads the text.

## Final handoff

Reviewer score units receive their own prior-experiences.json, never upstream
research artifacts or KB strategies. The final successful report is the consolidated
experience version. Null/blank optional values are omitted only on outbound upload.
After verified final completion, deliver normally. The Stop hook records the
run/review/fingerprint batch, freezes its native-trajectory boundary and starts a
detached finite sync. Do not ask the user to exit or await upload. Later chat is
excluded; repeated Stops do not restart a completed, failed or interrupted batch.
All papers, final experiences and trajectories wait for whole-run success. Failed/paused
runs upload none of them. Do not execute once/resume inside main or delegated Agent
sessions. The operator can explicitly recover with kb-sync once/resume.
Do not claim upload succeeded from research success alone; inspect kb-sync status.

To show synchronization status without reading payloads:

```sh
node "<plugin>/scripts/kb-sync.mjs" status "<workspace>"
```

Report pending/failed sync separately from research success. Do not await distillation
before delivery, reset successful research, or restart a failed KB job by reuploading.

## File searches and scholarly tools

For ordinary workspace discovery use explicit globs such as
`workspaces/*/SCOPE.md`; within a workspace search `papers/` or `topics/` directly.
Unfiltered recursive searches covering `.slr/kb` remain restricted. Grep's `pattern`
is a content regex, so use `glob` for a file filter. The guard resolves relative
paths using the tool cwd and refuses protected-cache symlink aliases.

Trusted scholarly services are listed once in `deploy/scholarly-mcp.json` (default:
`arxiv`, `tavily`, `scholar`). Their tool methods are not individually allowlisted:
search/fetch/extract/crawl/map/download/citation tools and new method names work
without guard changes. Clearly named mutation/execution operations remain blocked.
Only Worker, Scoper and Reviewer use these services; Reviewer keeps its current
submission/unit binding and isolated local inputs. New services need one service
entry and, for Reviewer, a tool wildcard in its frontmatter. This service trust
policy does not prove that every tool is internally read-only. Survey KB retains
its separate strict role/tool contract.
Manager's TaskOutput/TaskStop are limited to its own background Workers recorded
from host Agent output, within the same session/topic/lease. Unmapped old/native
tasks require main-session handling; task IDs in model text are not proof of ownership.


## Strategy feedback and state (Sprint2 governance)

Four executing roles may call `mcp__survey-kb__report_strategy_feedback` after observing
an actual problem with their own retrieved strategy. This is the sole additional
write-capable Agent tool; it records feedback, not a state change. Checker, Reviewer
and main remain excluded. Required input is strategy_id, used revision,
suggested_status, reason and concrete task context/evidence. No feedback on normal use.

Feedback is frozen before the MCP call and can be recovered independently of research
success. An operator uses `node <plugin>/scripts/kb-feedback.mjs status|resume <workspace>`.
Once a job_id exists, resume only queries that job; failed jobs require the KB admin
retry command. Neither recovery nor model processing should block research.

Only active strategies enter public search. Cached strategy query/read helpers perform
live status/version checks; they may return unavailable instead of stale content.
Direct reading of nonempty strategy view files is disallowed because it bypasses that
check. Paper caches retain their existing behavior. Active means no known confirmed
issue; it does not certify usefulness. Old feedback references remain preserved.
