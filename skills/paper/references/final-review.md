# Final manuscript review and repair

Main owns this workflow. Use only schema 2; legacy delivery keeps its current path.
The Reviewer searches/reads and returns judgments; it never edits evidence/manuscript or delegates. Context-enabled staged Reviewers may write only their assigned report draft. The
chapter Checker remains responsible for accepted research chapters. Paper writer
self-proofreading and compilation happen before this final stage.

## Commands and persistence

Use `node "${CLAUDE_PLUGIN_ROOT}/scripts/final-review.mjs" <action> <absolute-workspace> [absolute-input.json]`.
Main writes request JSON under `.slr/requests/`. Never edit control state directly.
`status` is read-only. State lives in `.slr/final-review.json`; actual runtime bindings
share `.slr/paper-bindings.json`. No future memory-store interface is introduced.

1. Verify current compilation and visually inspect the PDF. Commit the candidate
   sources/PDF and latest accepted evidence checkpoint with exact file paths. Keep
   `slr-complete` unchanged. Use the latest accepted evidence commit for `evidenceRef`
   (initially slr-complete); subsequent repair commits are new checkpoints.
2. `submit {evidenceRef}` freezes manuscript, style, PDF, scopes, registered notes,
   topic/task artifacts and registry under `paper/reviews/submission-NNNN/`. It binds
   actual content hashes and rubric version. Preserve `research-state.json`,
   `manifest.json` and `snapshot/` unchanged. A current completed submission is reused.
3. Launch one `slr-harness:slr-reviewer` with INITIALIZE/READY, then `bind {agentId}`.
   Resume with the frozen main.tex/references.bib/main.pdf paths, rubric.md,
   and snapshot/SCOPE.md,
   reviewer-input.md, assignment IDs and prior-issues.json. Do not send the full
   snapshot, role prompts or research artifacts. The Reviewer retrieves its own
   human-authored reference surveys matched to the approved scope. Main may cache reference full texts and render
   manuscript pages in the current submission's references/ and manuscript-pages/
   folders. Internal snapshots remain for main's recovery and repair only.
4. Main saves the exact returned envelope as a request and calls `record`. Correct
   malformed JSON/arithmetic by requesting a corrected response, never by changing
   substantive scores. Invalid records do not consume a revision. The helper saves
   assessment.json, assessment.md, comparison.md and experiences.json in that
   immutable submission folder. experiences.json contains the shared flat array;
   role is an enum, with no mandatory entry for each role. Keep comparison provenance
   in executionSummary and the comparison report.
5. `status.complete` requires >=70, completed comparison and current inputs/PDF.
   A passing score with no readable reference gives comparison_pending. Preserve
   the score and draft; `retry-comparison` creates a new attempt with the same frozen
   inputs, then bind a fresh Reviewer and request a full consistent assessment.

Snapshot hash checking is mechanical. Semantic support, author identity, full-text
reading and relevance still require actual Reviewer judgment and recorded evidence.

## Output contract

The single canonical Reviewer envelope and experience field definitions are in
reviewer-input.md. Pass that reference to Reviewer; main validates the returned
report through final-review.mjs rather than loading/copying its full schema into
its conversation. The six-dimension scoring criteria are in rubric.md.

## Below 70: controlled repair

Main returns the frozen original manuscript, assessment reasons, comparison and
role advice to the responsible Managers. Do not pass only a scalar score. If scope
must change, `pause {kind:"scope",reason}` and ask the user; continue only for a
within-approved-scope repair or start a separately approved new workspace. Never
rewrite SCOPE_ORIGINAL.md or silently expand SCOPE.md.
For an explicitly chosen within-scope remedy, pass begin-revision a scopeResolution
object with withinApprovedScope:true, explicitUserDecision:true, the actual userMessage
and concrete action, plus coordinatorTopicId. The decision is archived with the repair.
This permits narrowing unsupported claims while retaining the approved scope; actual
scope expansion requires a new separately approved workspace.

Main maps manuscript locations to topic IDs and calls `begin-revision
{issueRoutes:[{issueId,topicIds,reason}],coordinatorTopicId}`. Every topic/evidence
issue lacking historical IDs needs an explicit route. Choose an existing Manager
as coordinator for global/cross-topic issues. Never ask Reviewer for internal IDs.
It journals repair intent, reopens research and invalidates only assigned chapters.
Repeating this command recovers an interruption between intent and state writes.

- Managers revise chapter.md/synthesis.md and propose evidence needs. For global
  sections the coordinator supplies corrected background/comparison material to
  Paper writer; main dispatches the two-source rewrite after research is complete.
- Each revision has at most one additional global research round, independent of
  initial rounds/saturation. Use existing pipeline begin-round/plan/next/reserve,
  discovery, reading, acceptance and end-round commands. New tasks require explicit
  gap rationale; old failed/completed tasks are not reset. Shared maximum is nine
  Workers, each task gets two attempts per phase.
- Supplements invalidate every topic using the paper and expand authorized repair
  topics, including the unique owner. All affected Managers update and Checkers
  recheck chapters. Within a revision, chapter review retains initial check plus
  two repair cycles. Shared-paper updates cannot reset already used checks.
- Editorial-only repair needs no new research round. Draft from accepted evidence,
  recheck all affected chapters, then pipeline finalize. If Checker cannot pass,
  preserve the blocker and report it; do not hide a topic to get a higher final score.
- Commit accepted evidence under a new checkpoint without moving slr-complete.
  Resume Paper writer to incorporate current chapters/syntheses, compile/inspect,
  commit the new candidate and submit it to a fresh Reviewer. Never replace sources
  with a fresh template, and never use a stale PDF as the current candidate.

Initial assessment is followed by at most three completed revisions/reassessments.
The helper pauses after the third failing reassessment. User continuation through
`resume {explicitUserContinue:true,userMessage}` opens another batch of three;
history/cumulative counts remain. A successful score is never forced.

For stopped tool/permission/compile failures, finish/fail active leases first, then
`pause {kind:"tool|permission|compile",reason}`. After verifying recovery, use
`resume {prerequisiteRestored:true}`. These failures consume no completed quality
reassessment; an already opened repair retains its one-round budget. Resume repair
research via normal pipeline recovery only after final-review pause is cleared.

## Delivery and recovery

Status is always read-only; it launches nobody. On resume inspect final-review
status before ordinary research routing: repairing resumes only its assigned work;
awaiting_review resumes the pending assessment; revision_required opens its repair;
paused requires the appropriate recovery; comparison_pending retries retrieval;
passed/current returns artifacts without regeneration. Stale passed material needs
a new submission. A failed stale submission cannot be silently replaced: restore
its reviewed inputs before opening the authorized repair.

Commit only explicit manuscript, review-result, snapshot, control and changed
authorized research paths; never stage .build/ or unrelated files. Preserve all
prior reviews. Report score and itemized reasons, comparison reference(s), candidate
experiences.json, repair count, remaining issues and current PDF. Separate compiled
draft availability from final review completion. Passing with outstanding issues is
allowed by the rubric; keep those issues visible. Missing comparison prevents overall
completion even when the quality score passes.

Apply ../../review/references/handback.md to writer and Reviewer initialization, result transport and operational recovery. Preserve JSON-only assessment envelopes; a delivery error never supplies a score or permits self-approval.

Research profiles remain frozen during repair. Add only issue-driven evidence within
the existing supplemental round; do not start a new tier-sized corpus. When calling
pipeline finalize, supply a current scaleReason if accepted count differs from target.
No-profile historical workspaces retain their previous behavior.

## Comparison-derived experience delivery

Use the flat experiences array and shared contract below. Main saves experiences.json
as {"experiences": report.experiences}, preserving field values exactly. Reviewer
still writes only its assigned draft. assessment.md and comparison.md remain separate
review outputs. Existing historical Markdown files are left untouched; do not create
new experience.md or per-role advice files. Comparison retries must not copy prior
experiences.json into the new submission; new conclusions belong to that submission.

Paper strategies concern global writing, cross-topic synthesis, terminology and
organization. Roles identify future recipients, not proven internal causes. Record
actual strategy application only in later priorIssueChecks evidence, identifying the
source submission and experiences array index. One successful repair establishes
only a task-specific result. No memory API or trajectory extractor is added here.

Configured manuscripts require current format-check canReview=true before each submit. Keep only format completion/fingerprint state; there is no format report or source-report snapshot to deliver. Final Reviewer sees neither this internal state nor process artifacts.

## Main-only issue routing

For new Reviewer issues with empty topicIds, main reads its own topic registry and
maps the paper location to the responsible Manager(s). Pass begin-revision
issueRoutes:[{issueId,topicIds:[...],reason}]. Every topic/evidence issue with no
existing route needs a nonempty valid mapping. Routes are stored in the revision
record and do not rewrite the immutable Reviewer assessment. Global issues still
require a coordinating Manager. Keep research snapshots for invalidation/recovery,
but never pass them to the Reviewer. Historical assessments with topic IDs remain
readable. Scope-change proposals are interpreted by main against the approved
scope; explicit user scope approval requirements remain unchanged.

## Experience contract reference

Use reviewer-input.md for the shared JSON field definitions and output example.
Main persists report.experiences as {"experiences":[...]} without converting values.
The shared validator is scripts/experiences.mjs; final-review.mjs additionally
requires sourceType review and an actual completed reference comparison.

## Current rubric and approved scope

Only the six-dimension rubric is supported, with maxima 15/15/25/20/15/10.
The survey-2 identifier protects score records and fingerprints from stale data.
Old rule definitions and continuation paths are removed; do not convert historical
scores or relabel them as current. Workspace history is not rewritten automatically.

Before submission, SCOPE.md must equal SCOPE_ORIGINAL.md and match the
recorded approval hash. Resolve mismatch before dispatch, without overwriting either
file or treating current manuscript drift as a new approved scope. Only frozen
SCOPE.md is passed to Reviewer; all other process artifacts stay private to main.
Scope mismatch in the manuscript is an ordinary topic/global repair. Only an actual
proposal to change the approved scope uses kind scope and user approval.
