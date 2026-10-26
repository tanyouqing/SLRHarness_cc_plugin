# Staged writing and review

For context-enabled schema 2 use the following protocol. Main owns all work-stages
commands and .slr/work-stages.json. All input files go in .slr/requests/. Commands:
`node "<plugin>/scripts/work-stages.mjs" <action> "<workspace>" "<input.json>"`.
Status/query are read-only; query pages phases or submission units via offset/limit.
Unenabled and schema 1 workspaces retain their existing writing/review contracts.

## Writer

Prepare template only when files are missing. Initialize a fresh Paper Agent,
bind-paper, then writer-start {agentId}. It chooses the next phase and returns
phase, inputHash and allowed outputs. Only that Agent may write main.tex,
references.bib and writing-handoff.md until main closes the phase. New calls start
fresh contexts, not forks or resumption of earlier writing history.

Phases: outline; each approved research topic; introduction; background; taxonomy;
comparison; challenges; conclusion; abstract; polish. They are sequential.
Outline establishes the existing single-file structure, terminology and source
navigation. Topic phases translate one accepted chapter. Global phases use selected
synthesis entries and targeted notes. All phases preserve other sections and source
keys; use targeted edits. Handoff is at most 8000 characters, with paths/source
locations rather than complete chapter prose. Main pages metadata via bibliography.
No final-pass instruction may require loading all research materials together.

After authoritative stopped status, main calls writer-finish
{agentId,phase,inputHash,stopped:true,runtimeEvidence}. Partial output/interruption:
writer-abandon {agentId,stopped:true,runtimeEvidence,reason}, preserving sources.
Next attempt uses a fresh ID. Unknown liveness does not authorize abandonment.
Evidence changes create a new generation on next start; old records are retained.
An intentional manuscript-only revision uses newRevision:true and reason on start.
For a focused compilation/layout correction after a complete generation with unchanged evidence, use newRevision:true, reason and phaseIds:["polish"]. It preserves the manuscript and reruns only polish. Other intentional source-only edits may list affected existing phase IDs; polish is always appended. Do not use a new generation to hide an unfinished phase or reset the three compilation-repair attempts.
Build/submit require completed phases, matching accepted evidence and last output
hash. A source edit after a finished generation requires an explicit revision.
Initial/partial sources are never delivered as a complete manuscript.

## Reviewer

After complete writer phases, compile, run conference-format.md for configured
workspaces, inspect the resulting PDF and save checkpoint-paper. Format checks directly repair sources using fresh Paper Agent IDs with exclusive
writer access; no format report is created. Main owns minimal format control. A repaired source updates writing output hashes before recompilation.
Submit freezes evidence internally for main's recovery. Reviewer receives only
main.tex, references.bib, main.pdf, rubric.md, reviewer-input.md,
retrieved human surveys, and approved snapshot/SCOPE.md. No other
scope files, chapter, synthesis, notes, metadata cards or evidence chain. Own
current findings and prior-issues.json support staged continuation. Main renders
PDF pages under the current submission/manuscript-pages/ and caches reference
surveys under its references/. Never pass the full snapshot or other role prompts. For every review unit initialize a
fresh Reviewer, bind it to the pending submission, then review-start
{submissionId,agentId}. It returns exactly one artifact path and input fingerprint.
Bounded scope units come first and retain scope clauses/search framing
in their <=8000-character findings. Units then
cover all main.tex/references.bib characters in chunks of at most 24000,
then reference-comparison, pdf-layout and score. Read the assigned slice via the
bounded reader or native line ranges; the limit does not authorize whole-file reads.

Each non-score unit writes only its assigned JSON:
{unitId,fingerprint,locations:["specific section/page/source"],findings:"observations, evidence, limits and unresolved questions"}.
It must remain under 8000 characters. Main review-finish requires the actual stopped
Agent ID, stopped:true and runtimeEvidence. Completed units are immutable to later
Reviewers. Interrupted units use review-abandon with the same stopped proof and reason.

For large reference surveys or PDFs, main splits a pending reference-comparison or
pdf-layout unit using review-split {submissionId,unitId,parts:["exact page/section coverage instructions",...]}.
Splitting requires no active reviewer. If needed, abandon an interrupted unit first;
keep its saved draft as diagnostic history, but require all replacement parts.
Read a reference survey in full across bounded parts, retaining identity/version and
coverage provenance. Main renders PDF pages in batches of at most five and supplies
the resulting paths. No available visual tooling means a recorded operational blocker,
not a fabricated inspection. Findings must include source locations and uncertainty.

Score is last. It reads every completed findings file incrementally plus prior issues,
performs targeted verification and judges all six dimensions anew. It writes
`drafts/score.json` with the original exact final-review envelope plus unitId:"score".
Never average unit scores. Main review-finish, then `final-review.mjs record-file
<workspace>` loads this exact file, verifies complete coverage records, frozen
fingerprint, recorded output hashes and scorer identity, and applies the rubric
validator. Main receives only score/count/path summary, not the report body.
Missing or altered units cannot produce a valid assessment. Semantic review and
full-text-reading claims remain the Reviewer's responsibility; coverage records
are not proof that those judgments are correct. Existing 69/70 and repair rules apply.
