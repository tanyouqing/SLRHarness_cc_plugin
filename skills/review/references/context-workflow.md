# Bounded context and topic-local control

Read this before research dispatch. This policy is active when
.slr/context-policy.json exists. New pipeline init creates it. For an old schema 2
workspace, only explicit resume may call context-control enable, after old live
leases have been resolved. Status never enables or migrates. Schema 1 is unchanged.

## Bounded interfaces

All commands use absolute workspace/plugin paths. pipeline and final-review CLI
mutations/status now return summaries, not the complete state. Add --full only for
explicit diagnosis, never the normal loop. In-process function returns are unchanged.
Use `pipeline.mjs query <workspace> <input.json>` with collection topics, tasks,
papers, leases, bindings or reviewEvents; optional id/topicId, offset (default 0),
limit (default 20, maximum 100). Continue via nextOffset. A large single item returns
its ID and source path; use bounded character reads, not a full dump.
Use `context-control.mjs read <workspace> <input.json>` with {file,offset,limit};
file is relative, offset counts characters, limit defaults to 24000 and cannot exceed
it. Native Read offsets count lines: choose smaller line ranges when denied.
`context-control bibliography` pages accepted metadata without inventing facts.
Final-review query supports submissions/revisions/items/issues/priorIssueChecks/
references/differences and optional submissionId/id/offset/limit.

Control summaries, Manager handbacks and recovery summaries are at most 8000
characters. Review evidence units and writing-handoff.md are also capped at 8000.
Text slices default to 24000 characters; PDF reads must specify 1–5 pages. These
are input-size controls, not a guarantee about the provider's token window.
Main should pass paths and exact assignments, not complete papers or reports.

## Manager request API

Main binds Managers, begins the global round and runs an all-topic planning pass.
Managers write their own `topics/<id>/requests/<request-id>.json`:
{"requestId":"stable-unique-id","action":"reserve","args":{"taskId":"first"}}
They call exactly:
`node "<plugin>/scripts/manager-control.mjs" "<workspace>" "<runtime-manager-id>" "topics/<id>/requests/<request-id>.json"`
The hook checks runtime identity. This helper is the only additional shell permission;
no direct state writes, arbitrary commands, shell chaining or cross-topic requests.

Actions:
- query reads only your tasks, leases or papers (collection, optional id/offset/limit). It never writes a receipt or state.
- plan reads this topic's plan.json (same existing schema).
- reserve chooses a ready task in the shared round-robin window. Optional taskId;
  response supplies leaseId. Wait on no slot/lock without consuming an attempt.
- bind-worker takes leaseId and actual agentId after INITIALIZE/READY.
- finish-discovery takes leaseId and reads that task's candidates.json and search.md.
- finish-read takes leaseId; requires all owned records and cumulative result.json
  with processedPaperIds/reusedPaperIds/remainingPaperIds/missingEvidence/
  supplementRequests. remainingPaperIds must be empty; Manager checks substantive
  limitations and requests supplements, never invents evidence to finish a batch.
- accept-paper takes paperId; reads the matching checked:true entry in acceptance.json.
- fail takes leaseId and reason; close-task takes taskId and reason.
Finish-discovery, finish-read and fail also require stopped:true and runtimeEvidence
explaining authoritative stopped status. This records Manager's runtime observation;
the filesystem validator cannot independently prove host process liveness.

Requests are idempotent by runtime Manager ID plus requestId, with state and receipt
committed atomically. A changed request with the same ID is rejected. Waiting is not
committed as success, so the same request may be retried on the next scheduling event.
Runtime limits, identities, source versions and unique ownership use the existing
validators. Escalate conflicts/cross-topic supplements to main; do not silently merge.
Never end a Manager invocation while descendants remain unresolved. On unsupported
nesting, main launches from descriptors, Managers still own evidence acceptance.

## Checkpoints and compact recovery

Main runs context-control checkpoint-scope after committing the approved scope.
Successful review-topic automatically saves a topic checkpoint with current evidence
fingerprint; no task is stopped just because another topic finishes. After successful
build and actual PDF inspection main runs checkpoint-paper with
{sourceHash,pdfHash,pdfChecked:true,inspection:"pages checked and observations"}.
Failed build saves progress only, never a successful paper event.
Events are immutable and deduplicated by kind/fingerprint in .slr/checkpoints/.
Context-control summary reads live state; save updates .slr/recovery.json.

PreCompact saves a short recovery index. SessionStart (including compact) loads an
index of enabled workspaces. Hooks never trigger /compact or block it on a lock
failure. At each successful major-stage event, provide an optional compact hint
without pausing work. Real host auto-compaction remains enabled independently.
On resume, inspect current bounded summary, stage records and paged active leases.
IDs from another session are historical; main must verify stopped/live status before
rebind/relaunch. No speculative lease release, duplicate dispatch or budget reset.

Research scale: status/recovery include researchScale (profile, registered, accepted,
pending, shared, remaining, remainingAfterPending, targetReached). Manager query
collection scale returns the same aggregate view without other-topic records. Read
research-scale.md. Resume retains stored settings; context enable does not add a
profile to historical workspaces. Receipt counts describe the original action; use
a fresh query before planning more work.
