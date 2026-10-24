# Workspace contracts (schemaVersion 2)

The main session owns .slr/state.json via pipeline.mjs. It contains review identity,
approval hash/user message, stage, global budgets/round, topics/tasks, canonical
papers, runtime bindings, worker leases and chapter review events. Use status to
inspect the authoritative state. Human-readable files do not independently change it.

## Layout and ownership

- SCOPE_DRAFT.md, SCOPE_ORIGINAL.md, SCOPE.md, scoping.md: main session.
- topics/<topic-id>/plan.json, chapter.md, synthesis.md, acceptance.json: bound Manager.
- topics/<topic-id>/tasks/<task-id>/{search.md,candidates.json,result.json}: bound Worker.
- papers/<paper-id>/{metadata.json,note.md}: unique registered owning Worker task.
- .slr/requests/*.json and .slr/paper-bindings.json: main session.
- paper/main.tex, paper/references.bib: bound Paper Agent; other delivery files: main.

## Manager plan

plan.json is {"topicId":"slug","tasks":[{"id":"slug","question":"...",
"boundary":"...","rationale":"initial decomposition or evidenced gap"}]}.
Task IDs are unique within a topic. Existing tasks are immutable; propose new tasks
and explicit retirements to the main session for split/merge changes. Subtopics and
final subsection structure need not be identical. acceptance.json is an array of
{"paperId":"p-...","checked":true,"rationale":"source checks and limitations"}.

## Discovery

candidates.json is {"candidates":[{"title":"...","authors":[],"year":null,
"venue":null,"doi":null,"arxivId":null,"canonicalUrl":"https://...",
"sourceVersion":null,"evidence":"metadata source/location","rationale":"..."}],
"noEvidenceReason":null}. Only the main session registers identities and writes
paper ownership. Conflicting identifiers/versions require explicit resolution,
not silent merge. A title-only alias requires identityConfirmed=true plus identityEvidence documenting source verification. A known work can be shared across topics via its stable ID.

## Paper metadata and note

metadata.json has paperId, title, authors (array), year (integer or null), venue,
doi, arxivId, canonicalUrl, sourceVersion, verification. verification is one of
metadata_verified, fulltext_verified, abstract_only, unavailable. Retain actual
version and provenance; use null for unknown optional metadata. The note is one
paper only, with the following non-empty sections (fixed headings for checking;
body prose uses the review language):

# <Exact paper title> — <paper-id>
## Research Question
## Method
## Study Setting
## Findings
## Comparison Conditions
## Limitations
## Evidence Locations
## Open Questions

Evidence Locations maps individual claims to page/section/table/figure and canonical
source. Unknown/not applicable values require explanation. No minimum source count
per note; the target paper is its evidence source. result.json records processed and
reused paper IDs, limitations, and requested supplements. Final acceptance and
fingerprints live in the registry, not mutable note frontmatter.

## Chapter handoff

chapter.md begins with the actual major topic title and uses subtopic subsections.
Cite papers as [@p-<12 hex digits>]. synthesis.md has Background and Terms, Problem
and Significance, Taxonomy Relations, Comparison Conditions, Conflicts, Challenges
and Directions. Each substantive item carries [@paper-id], source location and
conditions; separate source claims from synthesis/inference. Both files require
accepted evidence citations. Missing coverage must be disclosed, not invented.

## Review response

Checker returns {"verdict":"passed|revision_required","fingerprint":"supplied",
"issues":[{"location":"...","evidence":"...","severity":"major|minor",
"action":"..."}],"limitations":[]}. Main attaches checkerId and topicId.
A passed verdict cannot contain major issues. First review plus two repairs is the
limit. A changed chapter, synthesis or accepted source invalidates prior acceptance.

## Legacy

schemaVersion 1 is read-only research. Completed final topic notes may still feed
legacy paper generation; draft notes are excluded. Preserve all historical files.
Do not expose the old topic-note template as a new writing contract.

The reusable single-paper note skeleton is paper-note.md. Manuscript runtime bindings live in .slr/paper-bindings.json. Paper writing uses self-proofreading; schema-2 compiled candidates then enter the distinct final Reviewer workflow. Historical review sidecars remain untouched and are ignored.


## Final review and controlled revisions

Main owns .slr/final-review.json and paper/reviews/submission-NNNN/. Each submission
contains immutable snapshot/, manifest.json, research-state.json, assessment.json,
assessment.md, comparison.md and scoper.md/manager.md/worker.md candidate advice.
The exact assessment envelope and rubric are in the paper skill references.
Reviewer runtime bindings use role reviewer plus submissionId in paper-bindings.json;
Checker bindings continue to use role checker and checkerId in chapter requests.

Final-review control tracks status, rubricVersion, submissions, revisions, batchStart,
pause and activeRevisionId. A repair context in research state has id, sourceSubmission,
issueIds, topicIds, coordinatorTopicId, roundsUsed (0 or 1) and active. Only main's
final-review begin-revision can reopen terminal research. Tasks added in repair carry
revisionId. The initial currentRound/maxRounds and saturation history remain intact.
Shared supplements extend topicIds; unrelated Managers cannot write. Fresh chapter
acceptance is required before finalize deactivates the context. Original slr-complete
is preserved; later evidence commits are supplied to submission as evidenceRef.

Read-phase result.json uses cumulative arrays processedPaperIds, reusedPaperIds, remainingPaperIds, missingEvidence and supplementRequests. A batch with remainingPaperIds is partial; keep the same lease until all assigned owned papers are complete. See handback.md for bounded recovery and result validation.
