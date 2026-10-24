# Hierarchical review orchestration

Main coordinates global rounds, conflicts, checkpoints and compilation. Restricted
Manager helpers apply topic-local state operations under the same global lock.
Use absolute paths. Every CLI below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs" <command> <absolute-workspace> [absolute-input.json]`.
Write command inputs under `.slr/requests/`; do not patch state manually. `status`, `next`, `fingerprint <topic-id>` are read-only.

## Route and scope

Status never writes or launches agents. Select the explicit slug, conversation workspace or unique active workspace; ask when ambiguous. Never overwrite a slug collision. Schema 1 permits status and terminal paper delivery only: refuse research resume and update without touching original files. Schema 2 resume first checks final-review status: resume an authorized repair through paper/references/final-review.md; otherwise terminal resume continues paper delivery and final review. Update is suspended for all versions.

Do not ask initial configuration questions. Preserve explicit user settings; apply the defaults in review/SKILL.md to missing settings, briefly display the effective configuration and immediately start reconnaissance. Default English unless explicitly requested otherwise, five rounds, nine global Workers. Use a professional synthesis objective, academic papers and verifiable preprints as research evidence, and authoritative technical documentation only for background or supplementary explanation. Let the Scoper choose and justify dates and record the search cutoff. Infer low ~30, medium ~60 (default), or high ~90 from the original request using research-scale.md. These are shared soft targets, with no default hard limit on paper count; explicit counts override defaults. Arrange coverage within the existing execution budgets. Record all effective settings in the scoping handoff and SCOPE_DRAFT.md. Follow scoping.md for reconnaissance. Before explicit human scope approval, only scoping work is allowed.

Create config with reviewId, topic, language, maxRounds, maxWorkers and researchProfile (see research-scale.md); `init` requires a new directory. Initialize Git in that workspace, never in a parent repository. Save a root `scoping.md` summary linking detailed reconnaissance under `scope/`, including existing-survey comparison, terminology, source links and verification status. Draft SCOPE_DRAFT.md with 3–5 major topics, boundaries, shared comparison dimensions and methods. `draft` receives `{topics:[{id,title,boundary}]}`. Show the entire proposed scope to the user. Ambiguous praise, status or requests for changes do not approve it. Revise and show again as necessary.

After explicit approval of this exact draft, `approve` receives `{explicitApproval:true,userMessage,scopeHash}` with SHA256 of the draft bytes. It creates immutable SCOPE_ORIGINAL.md and living SCOPE.md. Commit the scope checkpoint, then run context-control checkpoint-scope; save its optional /compact hint without waiting for compaction. Never manufacture the user's approval or reinterpret a prior draft approval.

## Scope ownership check before approval and dispatch

Read scoping.md and the paper-template.md writing contract before forming draft.topics.
Display the full outline with owners, but pass only the 3–5 research-topic entries
into `draft`. Paper Agent owns Abstract, Introduction, Background OR Preliminaries,
Taxonomy OR Unified Framework, cross-topic comparison, Challenges and Future
Directions and Conclusion. No dedicated Managers or topic IDs for these sections.
Managers own substantive topic chapters and supply global-section evidence in synthesis.md.
Check responsibilities and boundaries, including renamed global sections, before
presenting the scope for human approval and again before binding Managers. The CLI
validates topic shape/count, not semantic ownership; main must perform this check.
If the draft mixes global sections into topics, correct it before requesting approval.
If an already approved or resumed scope has that problem, preserve existing artifacts,
report the mismatch and ask the user to resolve the changed topic boundaries. Do not
silently rewrite frozen scope/state, delete Managers' work or fabricate approval.
Use the existing scope-change policy; a changed core question requires a new review.

## Agent initialization and allocation

For each topic create one slr-harness:slr-manager with INITIALIZE: deliver READY without task tool calls (native result transport is allowed). Capture its actual Agent ID, `bind` with `{agentId,role:"manager",topicId}`, then resume it with paths and responsibility. Bind independent slr-harness:slr-checker IDs similarly with role checker. Never bind one agent to multiple roles. Runtime identities, not names in prompts, authorize writes.

Verify Manager → Worker nesting using one allocated task. If Agent is unavailable inside Manager, record `mode` with `{mode:"main-dispatch"}` and have main launch Workers from the same task plan; disclose the fallback. Do not bypass permissions. Managers obtain slots through the restricted shared control entry; main supplies only permitted global budgets.

## Each global round

1. Main opens `begin-round`. Each Manager writes/imports its plan through manager-control. Main coordinates topic reading allocations against researchScale.accepted and researchScale.pending, counting shared papers once. Main completes a planning pass across all unfinished Managers before releasing dispatch, so one early Manager cannot consume all slots before others register work.
2. Managers request slots through `reserve`, launch/bind/resume their Workers, and own Worker deliveries. All requests use the global lock, shared round-robin cursor and nine-slot cap. Waiting does not consume retries; do not poll repeatedly. If a Manager has no live children and only queued work, it yields a bounded waiting report; main rotates to another Manager and resumes it on progress.
3. Managers submit discovery files through `finish-discovery`; the deterministic registry merges identities and assigns unique owners. Main handles strong-ID/version conflicts and cross-topic supplements, using targeted evidence only.
4. Managers assign at most three owned papers per read batch, validate cumulative result.json and all required metadata/note files, then submit `finish-read`. They check each paper's evidence and submit `accept-paper` using acceptance.json. Main does not reread the entire corpus to repeat Manager acceptance.
5. Managers confirm stopped runtime status before finish/fail, persist one bounded handback recovery per batch in their request files, and retain two attempts per task phase. Unknown liveness is an operational blocker, never permission to release a lease. Main handles any abandoned Manager with live descendants before rebind or redispatch.
6. Managers produce chapter.md and synthesis.md; main receives only status, counts, paths and unresolved conflicts. Validate artifacts mechanically through scripts. Main may inspect targeted content for a real unresolved issue.
7. Main launches an independent Checker with the topic fingerprint and paths. Save its exact verdict and submit `review-topic`. Initial review plus two repairs remains unchanged. Manager handles any Worker corrections. A passed chapter automatically records a topic checkpoint, even while other topics' Workers continue. Announce it briefly with an optional /compact hint; do not wait for compaction.
8. Main closes `end-round` only after all leases stop, evaluates five-round/two-low-yield stopping rules and commits the exact artifacts. Completed topics are skipped. New tasks must address actual evidence gaps.

## Completion and recovery

At max rounds or saturation, close pending tasks with explicit gap reasons. Finish drafting and review without retrieval. If all chapters pass current evidence fingerprints, close the round and `finalize {scaleReason}` explaining any difference from the soft target; unresolved material errors require `block {reason}`. `resume {prerequisiteRestored:true}` is allowed only after a real blocker is resolved and cannot reset budgets or review attempts.

For completed or completed_with_limitations, main writes a concise REPORT.md of coverage, limitations, tier/target, actual accepted and pending counts, count variance reasons and artifact links, commits research and creates `slr-complete` pointing to that commit (never replace an existing tag). Then invoke paper automatically, inheriting language/settings and no new configuration questions. Paper failure leaves research completion and checkpoint intact. Blocked research never invokes paper. Status remains read-only. Checkpoints and accepted file hashes are the recovery source of truth; do not regenerate completed topics.

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

Before any Agent invocation, read handback.md. Apply its READY/native transport, artifact validation, bounded recovery and reading-batch rules. Never replace a missing independent review with self-review.

Read context-workflow.md before dispatch. New CLI-created workspaces enable this
policy automatically. On explicit resume of older schema 2, resolve old active
leases before context-control enable; never migrate during status. Main reads the
bounded summary and targeted queries, not complete state JSON. Existing passed
deliveries need no opt-in or regeneration. Schema 1 remains unchanged.
