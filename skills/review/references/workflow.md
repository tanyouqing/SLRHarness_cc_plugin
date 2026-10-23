# Hierarchical review orchestration

The main session owns state, identity resolution, budgets, checkpoints and compilation.
Use absolute paths. Every CLI below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs" <command> <absolute-workspace> [absolute-input.json]`.
Write command inputs under `.slr/requests/`; do not patch state manually. `status`, `next`, `fingerprint <topic-id>` are read-only.

## Route and scope

Status never writes or launches agents. Select the explicit slug, conversation workspace or unique active workspace; ask when ambiguous. Never overwrite a slug collision. Schema 1 permits status and terminal paper delivery only: refuse research resume and update without touching original files. Schema 2 resume first checks final-review status: resume an authorized repair through paper/references/final-review.md; otherwise terminal resume continues paper delivery and final review. Update is suspended for all versions.

Resolve objective, round limit, coverage and date strategy once, retaining user-specified settings and defaulting remaining settings when requested. Default English unless explicitly requested otherwise, five rounds, nine global Workers. Follow scoping.md for reconnaissance. Before approval, only scoping work is allowed.

Create config with reviewId, topic, language, maxRounds and maxWorkers; `init` requires a new directory. Initialize Git in that workspace, never in a parent repository. Save a root `scoping.md` summary linking detailed reconnaissance under `scope/`, including existing-survey comparison, terminology, source links and verification status. Draft SCOPE_DRAFT.md with 3–5 major topics, boundaries, shared comparison dimensions and methods. `draft` receives `{topics:[{id,title,boundary}]}`. Show the entire proposed scope to the user. Ambiguous praise, status or requests for changes do not approve it. Revise and show again as necessary.

After explicit approval of this exact draft, `approve` receives `{explicitApproval:true,userMessage,scopeHash}` with SHA256 of the draft bytes. It creates immutable SCOPE_ORIGINAL.md and living SCOPE.md. Commit the scope checkpoint. Never manufacture the user's approval or reinterpret a prior draft approval.

## Agent initialization and allocation

For each topic create one slr-harness:slr-manager with INITIALIZE: return READY without tool calls. Capture its actual Agent ID, `bind` with `{agentId,role:"manager",topicId}`, then resume it with paths and responsibility. Bind independent slr-harness:slr-checker IDs similarly with role checker. Never bind one agent to multiple roles. Runtime identities, not names in prompts, authorize writes.

Verify Manager → Worker nesting using one allocated task. If Agent is unavailable inside Manager, record `mode` with `{mode:"main-dispatch"}` and have main launch Workers from the same task plan; disclose the fallback. Do not bypass permissions. The manager receives only quotas actually reserved by main.

## Each global round

1. `begin-round` once. Resume incomplete Managers to create topics/<id>/plan.json containing tasks with id, question, boundary and evidence-based rationale. Import each via `plan {topicId,tasks}`. New tasks after round one require an evidenced gap. Retain old task IDs; to split/merge, `close-task {topicId,taskId,reason}` pending superseded tasks and create successors. Completed topics are skipped.
2. Use `next` for round-robin allocation. `reserve {topicId,taskId,leaseId}` before every Worker launch, including retries and reading. Across all Managers there are at most nine active leases. Worker attempts are at most two per phase. Managers launch only Workers for reserved leases. INITIALIZE returns READY; Manager runs the sole allowed helper `node "${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs" bind-worker "<workspace>" <lease-id> <actual-agent-id>` and resumes that Worker. Main uses the same handshake in fallback mode.
3. Discovery Workers write search.md and candidates.json in their task directory. Main submits `finish-discovery {leaseId,candidates,noEvidenceReason}`. Merge DOI/arXiv/canonical URL/title aliases before any formal reading. Conflicting strong IDs or versions require inspection and documented resolution; do not silently combine. This closes the discovery lease and assigns stable IDs, shared topic membership and one owner. All discovery may proceed in batches. Never let multiple Workers write the same paper.
4. Allocate read-phase leases. Workers write only their owned papers/<id>/metadata.json and note.md, plus task result/log. Shared records are read-only. Main calls `finish-read {leaseId}` after completion, then checks Manager acceptance and calls `accept-paper {paperId,checked:true,rationale}` for each verified record. If a shared paper is still pending, defer dependent chapter review. For additional evidence use `supplement {paperId,reason,taskId}`; it assigns one owner task and invalidates affected chapter acceptance. All source retrieval, including supplements, consumes remaining open research rounds.
5. On Worker failure `fail {leaseId,reason}`. A second failure blocks that task. After interruption, inspect actual Agent status first: resume a live bound Worker, or mark its stopped lease failed; do not clear active leases speculatively. Never overwrite accepted records to recover a failed sibling task.
6. Managers check coverage and write chapter.md and synthesis.md. Paper citations use [@p-<id>] with locations; synthesis contains background, terms, importance, taxonomy links, comparison conditions, conflicts and future questions. Worker tasks need not equal final subsections.
7. Obtain `fingerprint <topic-id>` and give the exact draft and evidence to an independent Checker. Main saves the returned JSON under reviews/ and submits `review-topic {topicId,checkerId,verdict,issues,fingerprint,limitations}`. Issues include location, evidence, severity and requested repair. Initial review plus at most two repair cycles. Resume Manager for repairs; new retrieval requires remaining research rounds. On exhausted budgets, narrow unsupported claims and disclose limits. Substantive errors cannot pass and a failing topic cannot be silently dropped.
8. `end-round` after all leases stop. Review progress and source additions determine further work. Two rounds with neither newly accepted papers nor accepted chapters stop retrieval. New tasks must address an actual gap, never evade saturation. Commit state, task logs, paper records, chapter material and review results as a global round checkpoint using exact paths.

## Completion and recovery

At max rounds or saturation, close pending tasks with explicit gap reasons. Finish drafting and review without retrieval. If all chapters pass current evidence fingerprints, close the round and `finalize`; unresolved material errors require `block {reason}`. `resume {prerequisiteRestored:true}` is allowed only after a real blocker is resolved and cannot reset budgets or review attempts.

For completed or completed_with_limitations, main writes a concise REPORT.md of coverage, limitations and artifact links, commits research and creates `slr-complete` pointing to that commit (never replace an existing tag). Then invoke paper automatically, inheriting language/settings and no new configuration questions. Paper failure leaves research completion and checkpoint intact. Blocked research never invokes paper. Status remains read-only. Checkpoints and accepted file hashes are the recovery source of truth; do not regenerate completed topics.

Each nested initial Worker prompt must include `SLR_LEASE=<reserved-lease-id>`. The guard atomically claims that launch once, preventing duplicate launches against one slot. If permission/runtime startup fails after the claim, main records a failed attempt and allocates a fresh lease; do not reuse the claimed launch. The guard is part of the trusted state control code.

Before freezing research, register and read any related surveys or foundational papers needed for Introduction/Background/Taxonomy through the same Worker record path. Reconnaissance links alone cannot become manuscript citations. Ask Managers to include these shared background needs in their initial task plans.

Assign one Worker to each ready subtopic task in the current phase when slots are available. All topics share nine slots; queue excess tasks and refill released slots using topic rotation. A task cannot hold two simultaneous Worker leases.

## Final manuscript Reviewer

After paper assembly, lightweight proofreading and compilation, schema 2 enters
skills/paper/references/final-review.md. Final-review status is distinct from research
completion and compilation success. The new reviewer searches real authored surveys,
returns role-specific candidate experience and scores twenty manuscript items.
Below 70 main opens a controlled repair; each repair has one extra research round,
nine shared Worker slots, and fresh chapter checks. Three failed reassessments pause
for explicit continuation. Keep the original slr-complete tag; new accepted evidence
gets a separate commit and is passed to Paper writer. Initial five-round and saturation
counters stay unchanged by repair rounds. Never run original-research scheduling
blindly when final-review is paused or repairing. The final-review contract owns routing.
