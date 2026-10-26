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
   Resume with absolute snapshot and contract paths, the four role prompts (Scoper, Manager, Worker and Paper writer),
   submission ID, fingerprint and previous assessment. Give access to original
   scholarly sources for independent retrieval and targeted verification. Main can
   render PDFs for the reviewer with available tools; never claim visual inspection
   that was unavailable. Unstaged Reviewer writes no files; staged draft permissions are defined in staged-execution.md.
4. Main saves the exact returned envelope as a request and calls `record`. Correct
   malformed JSON/arithmetic by requesting a corrected response, never by changing
   substantive scores. Invalid records do not consume a revision. The helper saves
   assessment.json, assessment.md, comparison.md and one experience.md in that
   immutable submission folder. experience.md groups executable candidate strategies
   by Scoper, Manager, Worker and Paper Agent, including empty sections. Keep both
   source locations, actions, conditions and acceptance tests linked.
5. `status.complete` requires >=70, completed comparison and current inputs/PDF.
   A passing score with no readable reference gives comparison_pending. Preserve
   the score and draft; `retry-comparison` creates a new attempt with the same frozen
   inputs, then bind a fresh Reviewer and request a full consistent assessment.

Snapshot hash checking is mechanical. Semantic support, author identity, full-text
reading and relevance still require actual Reviewer judgment and recorded evidence.

## Exact returned envelope

Return one JSON object with `submissionId`, `fingerprint`, `reviewerId` (main supplies
the actual runtime ID), and `report` with these fields:

```json
{
  "rubricVersion": "survey-1",
  "items": [{"id":"coverage.scope","score":3,"location":"Introduction, paragraph 2","evidence":"Specific observed content or source contradiction","reason":"Explain points gained and lost"}],
  "total": 0,
  "passed": false,
  "comparison": {
    "status":"complete",
    "searchLog":"Queries, candidates, exclusions and access outcomes",
    "alignment":"Both scopes, dates, audiences and lengths; justified comparison boundaries",
    "references":[{"id":"ref-1","title":"Real survey title","authors":["Verified author"],"year":2025,"url":"https://example.org/replace-with-verified-source","version":"Recorded version","fulltext":"fulltext_read","match":"same","reason":"Why selected","verification":"Identity/full-text checks and source locations"}],
    "differences":[{"id":"diff-1","referenceId":"ref-1","kind":"gap","dimension":"synthesis","manuscriptLocation":"Section and example","referenceLocation":"Section/page and example","observation":"Concrete difference, not causal speculation","conditions":"Why comparable and when relevant"}]
  },
  "suggestions": {
    "scoper": [],
    "manager": [{"role":"manager","differenceId":"diff-1","attribution":"hypothesis","attributionEvidence":"What task/chapter artifacts establish or leave uncertain","action":"Ordered operations on identified inputs, producing a specific artifact","conditions":"When applicable, prerequisites and when not to apply","expectedImprovement":"Expected outcome","acceptance":"Observable verification"}],
    "worker": [],
    "paper": []
  },
  "issues": [{"id":"issue-1","kind":"topic","severity":"major","topicIds":["actual-topic-id"],"location":"Exact location","evidence":"Reason and supporting source","action":"Repair instruction","acceptance":"Checkable completion criterion"}],
  "priorIssueChecks": []
}
```

This is a shape illustration, not a valid scored example: return all twenty exact
rubric IDs, correct total, real sources/locations and actual topic IDs. Never reuse
example authors/links. comparison.status is complete or unavailable; unavailable
requires unavailableReason and may have empty references/differences and empty
lists in all four suggestions roles; the four role keys are still required.
Reference match is same, overlapping or adjacent; fulltext is fulltext_read or
unavailable. Difference kind is gap, reasonable_difference, manuscript_strength or
insufficient_evidence; dimension is coverage, organization, synthesis, evidence or
critique. Adjacent references cannot support coverage-gap findings. Suggestion
attribution is supported or hypothesis. Issue kind is topic, global, evidence or
scope; severity is minor, major or critical. Topic/evidence issues require topic IDs;
global issues may have none. Failed assessments require actionable issues.
For reassessment, priorIssueChecks must cover every previous issue exactly once:
`{issueId,status:"resolved|partial|unresolved",evidence}`. Check current content;
record actual applied suggestions and task-specific outcomes in this evidence.

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

Call `begin-revision {coordinatorTopicId}`. The helper derives affected topics from
issues; choose an existing Manager as coordinator for global/cross-topic issues.
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
experience.md, repair count, remaining issues and current PDF. Separate compiled
draft availability from final review completion. Passing with outstanding issues is
allowed by the rubric; keep those issues visible. Missing comparison prevents overall
completion even when the quality score passes.

Apply ../../review/references/handback.md to writer and Reviewer initialization, result transport and operational recovery. Preserve JSON-only assessment envelopes; a delivery error never supplies a score or permits self-approval.

Research profiles remain frozen during repair. Add only issue-driven evidence within
the existing supplemental round; do not start a new tier-sized corpus. When calling
pipeline finalize, supply a current scaleReason if accepted count differs from target.
No-profile historical workspaces retain their previous behavior.

## Executable comparison-derived experience

Keep the JSON key suggestions for transport compatibility; its four required arrays
are scoper, manager, worker and paper. Each item.role must match its array. Read all
four role prompts before attribution. These entries are executable candidate
strategies extracted from actual comparison, not generic improvement suggestions.
Use action for ordered steps specifying inputs, transformations and an output
artifact; conditions for trigger, prerequisites and exclusions; acceptance for an
observable check on that artifact. Preserve attribution evidence and mark uncertain
causes as hypothesis. Ground every entry in a difference and both source locations.
Do not force entries for every role; four empty arrays are valid when unsupported.

Paper Agent strategies concern global-section writing, cross-topic synthesis,
terminology, transitions and whole-manuscript organization. Inspect accepted chapters,
synthesis material and the manuscript before attributing failures: a missing Worker
source or Manager synthesis input is not automatically a Paper Agent writing failure.
Do not recommend inventing evidence or taking over topic research. Main routes actual
global writing repairs through the existing Paper stages; candidate strategy creation
does not itself trigger repair or change the scoring rubric.

All four roles are grouped in one experience.md per submission. The helper renders
it from the validated report; Reviewer still writes only its assigned draft. Keep
assessment.md and comparison.md as separate existing reports. Historical three-role
reports and separate role files remain unchanged and readable; new reports must
include paper, even if empty. An already prepared old-format pending draft must be
completed by Reviewer with the new field, not silently padded by main.

These artifacts can inform later experience storage, but no storage/retrieval API,
experience database or automatic application is introduced here. Record actual
application and verification only in subsequent priorIssueChecks evidence when it
really occurred; identify the source submission and strategy (role/index). A single
verified repair establishes a task-specific result, not a universally proven rule.
