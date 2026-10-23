# SLR Harness

A Claude Code plugin for human-approved, hierarchical literature reviews. Scopers establish scope and 3–5 major topics. Each topic Manager decomposes its work into subtopics and schedules Workers. Workers produce one metadata card and one note per paper; Managers synthesize reviewed chapter drafts. A Paper Agent assembles the survey in the bundled NeurIPS preprint template, followed by writer proofreading, compilation and a final Reviewer. The Reviewer compares real authored surveys, produces role-specific candidate advice, and scores the manuscript out of 100.

## Use

Load locally with `claude --plugin-dir <absolute-plugin-directory>`, or install `slr-harness@rail-research` from your configured marketplace. Node.js 18+, Git and Claude Code are required; this checkout is tested against the installed version recorded in docs/pipeline-validation.md. PDF delivery uses latexmk, XeLaTeX and BibTeX. Optional paper-search metadata discovery falls back to available web/MCP retrieval; the plugin never installs tools during a review.

- `/slr-harness:review <topic>` starts scope reconnaissance and waits for explicit approval.
- `/slr-harness:review status <slug>` is read-only.
- `/slr-harness:review resume <slug>` resumes schema-2 research, pending final review or its authorized repair.
- `/slr-harness:paper <slug>`, `paper resume <slug>` and `paper revise <slug> <feedback>` support independent delivery and revision.
- `/slr-harness:update` currently performs no updates. Start a new review for new evidence.

New workspaces use schema 2. Historical schema-1 workspaces retain status and completed-corpus paper delivery; research resume and incremental update are disabled. There is no automatic migration. Existing historical artifacts remain untouched.

## Evidence and execution

Main owns scope approval, global state, canonical identity/ownership, Git and compilation. Managers own topic plans, chapter.md and synthesis.md. Workers own assigned task logs and canonical paper metadata.json/note.md. Independent Checkers read chapter evidence and return issues. The final Reviewer may search and read reference surveys, but cannot edit or delegate. The Paper Agent writes only paper/main.tex and references.bib. Runtime Agent IDs and task leases constrain writes through PreToolUse hooks; no global permission bypass is needed.

Default budgets: five shared research rounds, at most nine concurrent Workers across all Managers, two attempts per task phase, stop after two low-yield rounds. Chapter review allows an initial review plus two repair cycles. Writing uses nonblocking self-proofreading. After compilation the final Reviewer applies 20 items (0–5 each): coverage 15, taxonomy 15, evidence 25, synthesis 20, critique 15, presentation 10. A total >=70 passes without additional vetoes. Each low-score repair allows one extra research round; three failed reassessments pause for explicit continuation. Nested Manager → Worker dispatch is probed on the host; main-session dispatch uses identical plans and leases if nesting is unavailable.

Every substantive synthesis claim links a stable paper ID and original location. Shared papers have one formal record. Version/identifier conflicts require resolution before reuse. Acceptance fingerprints detect stale chapters after evidence changes. Fact verification and review verdicts determine whether evidence supports prose; literature order follows taxonomy, method relationships and narrative needs.

Final delivery: paper/main.tex, references.bib, neurips_2026.sty and main.pdf, plus versioned assessment/comparison and scoper.md, manager.md, worker.md under paper/reviews/submission-NNNN/. Compiled drafts remain available below 70. Overall completion requires both a passing current assessment and a completed reference comparison. Background OR Preliminaries and Taxonomy OR Unified Framework each use one suitable title. The 3–5 major topics become directly named sections. Default English, author–year, 6,000–9,000 words; authors only from supplied information. Build artifacts remain in paper/.build/. A failed build never presents an old PDF as current. Controlled final-review repairs retain the initial slr-complete checkpoint and create new evidence checkpoints.

## Development

`node --test tests/*.test.mjs` runs deterministic tests. See [design](docs/design.md), [validation](docs/pipeline-validation.md), [eval scenarios](evals/README.md) and [workflow](skills/review/references/workflow.md). Deterministic acceptance, real Agent dispatch, semantic review and a complete scientific literature review are separate validation levels.

Read [final review and repair](skills/paper/references/final-review.md) and the
[fixed rubric](skills/paper/references/rubric.md) for command contracts and score anchors.
Reference surveys are comparison evidence; their bibliographies do not automatically
become read manuscript sources. Candidate advice is stored as Markdown only; no
cross-task experience library is implemented in this release.
