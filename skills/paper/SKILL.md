---
name: paper
description: Generate, resume or revise a NeurIPS-style LaTeX survey and PDF from completed SLR Harness evidence. Also runs automatically after research finalization and routes v2 manuscripts through final review and bounded research repair.
argument-hint: <slug> | resume <slug> | revise <slug> <feedback>
---

# Template-based survey delivery

This workflow follows research completion and may also be invoked explicitly.
Read references/paper-template.md completely and use template/neurips_2026.tex.
Pass the scope's initial reconnaissance-based Survey Outline and recorded refinements
to the writer. Topic count is unconstrained by template placeholders. Require one
selected heading each for Background OR Preliminaries and Taxonomy OR Unified Framework.
Use absolute paths rooted at ${CLAUDE_PROJECT_DIR}/workspaces/<slug>; never cd.
Run Git as git -C <absolute-workspace>. The main session owns preparation,
validation, compilation and commits; the writer owns only two manuscript sources.

## 1. Select and check evidence

For schema 2 read references/final-review.md and rubric.md completely. Check
`final-review.mjs status` before routing: an existing repair must resume through
that workflow, even if research is nonterminal. Status requests never write or
launch agents. Legacy schema 1 does not enter final review or Manager repair.

Prefer an explicit slug or the active workspace; otherwise choose the single
terminal workspace or ask which one when several exist. Only `completed` and
`completed_with_limitations` are eligible. Initial writing requires completed research; only the explicit final-review repair entry may reopen v2 research. Scope approval is never inferred here.
Require original/living scope, valid terminal state and slr-complete. For schema 2 require all accepted topic chapters, syntheses, paper registry and referenced canonical records; for legacy require final notes and report.
Read completed updates and their approved scopes, notes and completion refs in
order. A non-terminal legacy update blocks manuscript work; report this limitation without offering update execution.
Outside authorized final-review repair, do not change research state or artifacts. Never move existing tags. Capture their Git status
and the slr-complete target before writing, and verify preservation before committing.

Inspect git status --porcelain --untracked-files=all. Permit recoverable changes
only to paper/main.tex, references.bib, neurips_2026.sty, main.pdf, build.json and
paper/.gitignore. Paper orchestration sidecars under .slr/paper-* and .slr/final-review.json plus explicit paper/reviews/ snapshot/result paths are allowed and committed separately from research checkpoints. During authorized repair, commit only assigned research changes as a new evidence checkpoint; use that commit instead of the initial slr-complete as the writer input. Other dirty files, including a modified legacy REVIEW_PAPER.md,
are a blocker. Never stage unrelated changes. A committed legacy Markdown paper
is preserved byte-for-byte and may serve only as a rechecked draft for migration.

## 2. Route and configure

- Automatic delivery after review: use invocation=automatic and the active slug.
- Explicit paper <slug>: generate if LaTeX sources are absent; if a valid committed
  LaTeX/PDF delivery exists, preserve it. For v2 return it as final only when final-review status.complete is true; otherwise continue final-review.md. Request revise for unsolicited edits.
- paper resume <slug>: continue incomplete source writing or compilation without
  reopening research. Existing complete sources need only validation/build recovery.
- paper revise <slug> <feedback>: require existing LaTeX or legacy Markdown. Migrate
  legacy-only work into LaTeX and apply feedback, without overwriting the old file.

Use `node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-build.mjs" status <absolute-paper-dir>`
to inspect source/PDF freshness. current=true checks source and PDF hashes only;
it does not establish factual quality or coverage of later evidence updates.
An already committed current paper is left unchanged by automatic/generate/resume; for v2 still complete any pending final Reviewer workflow;
explicit revise may incorporate completed updates. A successful but uncommitted
build must still pass the manuscript checks and be committed, not silently skipped.
If inputs are incomplete or an interrupted draft fails validation, continue the
writer with the existing source; never reinitialize or overwrite it with a skeleton.

Automatic invocation inherits review language and uses any explicitly supplied
paper settings, otherwise domain researchers, 6,000–9,000 words excluding references,
and author-year citations. Do not ask another configuration question automatically.
For explicit first generation, ask once for missing audience, length and citation
style; use these defaults if requested or interactive questions are unavailable.
Language inherits state unless explicitly overridden for the manuscript only.
Resume/revise preserve existing settings unless feedback changes them. Author and
affiliation are empty unless supplied by the user. Do not impose conference page limits.

## 3. Prepare and delegate

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-build.mjs" prepare <absolute-paper-dir>`.
It copies missing template sources and style only, preserves existing files and
ignores paper/.build/. Do not copy or enable the optional conference checklist.
Delegate one slr-harness:slr-paper-writer in the foreground with absolute project,
workspace, template, contract and both output paths; mode, settings, feedback,
slr-complete commit and completed-update scopes/states/refs. Use INITIALIZE/READY, bind the returned ID with pipeline.mjs bind-paper and {agentId,role:"paper"}, then resume. Require chapter/synthesis/index reading and targeted paper-note verification, writing only paper/main.tex and paper/references.bib.
The paper writer has no search, new-evidence, shell or research mutation permissions. Final Reviewer retrieval and authorized Manager/Worker repair follow their separate contracts. For an already
complete source awaiting compilation, skip delegation until diagnostics need repair.

## 4. Validate, compile and inspect

Review chapter responsibilities, factual support, source/version accuracy,
limitations, citation/reference bijection and no workspace-file citations. Use
`node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-build.mjs" validate <absolute-paper-dir>`
for basic structure and citation-key checks. It is not a semantic evidence validator.
Fix empty sections, placeholders and citation syntax before compilation. Address uncertain claims through careful wording and disclosed limitations.

The writing stage performs lightweight proofreading only. The writer fixes terms,
transitions, overstatements and minor inconsistencies in its two source files, then
continues compilation. Final Reviewer runs after a compiled candidate exists; do
not insert a manuscript Checker or let the writer assign itself an acceptance score.
Historical paper-review sidecars stay preserved and unused; the new final-review
control is separate. Compilation recovery remains independent of quality scoring.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-build.mjs" build <absolute-paper-dir>`.
This invokes latexmk, XeLaTeX and BibTeX with no shell escape or latexmk rc files.
Each attempt has a fresh paper/.build/ directory with logs. Only a successful build
with resolved citations/references and matching source hashes updates main.pdf.
The helper writes build.json with success/failure and source/PDF fingerprints.
Missing tools: preserve sources, report PDF unavailable and the required toolchain;
never install dependencies during the workflow. Failed builds leave any old PDF
untouched but invalid as a current delivery. Never link it as the new result.

For source/compilation failures, delegate focused repairs of the two owned files,
then recheck and rebuild. Allow at most three repair attempts after the initial
attempt. Stop immediately for missing dependencies or authentication/permission
failures. Preserve uncommitted sources and diagnostics for paper resume.
Inspect the successful PDF visually using available rendering/view tools: section
hierarchy, margins, tables, references, missing glyphs and clipping. Treat overfull
boxes as inspection targets; fix actual layout defects within the same repair budget.
If visual inspection is unavailable, report that boundary, not a passed visual check.

## 5. Commit candidate, review and return

For schema 2, a build is a candidate manuscript. Commit it, then execute
references/final-review.md through completion or an explicit recoverable pause.
On low scores main returns the frozen original plus guidance to Managers, invokes
only the authorized repair entry, then reassembles/recompiles for a fresh assessment.
Return a final delivery only when `final-review.mjs status` reports complete=true.
For legacy skip this new stage and retain existing source/PDF delivery behavior.

Commit after proofreading, source-format checks and build succeed. Verify the only changes
outside a documented repair are the paper source pair, bundled style, PDF, build.json, paper/.gitignore, named control sidecars and final-review snapshots/results;
legacy Markdown, research state, scopes, tasks, report, notes, assets and existing tags remain
unchanged. Stage exact delivery/review paths and named sidecars, never paper/ or .slr/ wholesale or .build/ logs. Commit authorized research repairs separately and retain every earlier checkpoint.
Use `paper: generate review manuscript` for first LaTeX delivery (including migration)
and `paper: revise review manuscript` for revision of existing LaTeX. Create no tag.
If no diff exists, do not create an empty commit. Compilation or writing failure
never changes the research terminal state or removes the slr-complete checkpoint.

Return main.tex, references.bib and the current main.pdf, commit if created, language,
settings and evidence limitations. Distinguish research completion, source readiness,
PDF build, visual inspection, final score and comparison completion. On compilation
failure return source paths, diagnostics and `/slr-harness:paper resume <slug>`;
explicitly say no current PDF was delivered. On a final-review pause, link the valid
compiled draft and review/advice files but identify it as not finally accepted.
