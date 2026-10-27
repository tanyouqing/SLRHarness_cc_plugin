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
uses the current writing-phase binding. Keep status read-only. The background sync
worker is a separate process started by the operator, not an Agent-owned shell.

## Retrieval rules

Only Worker searches/reads papers. Only worker, manager, scoper and paper search/read
strategies, with their own role filter. Checker/Reviewer never read KB, including
its cache. Main and delegated Agents never call submit_* or get_job.

Use `mcp__survey-kb__search_papers`, `mcp__survey-kb__search_strategies`, and
`mcp__survey-kb__read`. Selected records must be read at the retrieved revision.
Search defaults are five papers or three strategies. Strategies use scope_planning,
task_planning, paper_discovery, paper_reading, topic_synthesis or paper_writing as
appropriate. Manager can query task_planning/paper_reading/topic_synthesis; other
roles' stages follow their current assignment.

PostToolUse saves full responses, then replaces model-visible output with bounded
views. A cache-hit denial supplies the existing view path; read that instead of
repeating the call. Additional slices use the role-scoped helper in Agent prompts.
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
The sync service snapshots accepted notes; main never retypes or uploads the text.

## Final handoff

Reviewer score units receive their own prior-experiences.json, never upstream
research artifacts or KB strategies. The final successful report is the consolidated
experience version. Null/blank optional values are omitted only on outbound upload.
After verified final completion, deliver normally and let the Stop hook capture the
success handoff. Failed/paused runs do not upload trajectories or review experience.
Accepted paper submissions may already have occurred independently.

To show synchronization status without reading payloads:

```sh
node "<plugin>/scripts/kb-sync.mjs" status "<workspace>"
```

Report pending/failed sync separately from research success. Do not await distillation
before delivery, reset successful research, or restart a failed KB job by reuploading.
