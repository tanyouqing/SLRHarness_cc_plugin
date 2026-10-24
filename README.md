# SLR Harness

A Claude Code plugin for human-approved, hierarchical literature reviews. Scopers establish scope and 3–5 major topics. Each topic Manager decomposes its work into subtopics and schedules Workers. Workers produce one metadata card and one note per paper; Managers synthesize reviewed chapter drafts. A Paper Agent assembles the survey in the bundled NeurIPS preprint template, followed by writer proofreading, compilation and a final Reviewer. The Reviewer compares real authored surveys, produces role-specific candidate advice, and scores the manuscript out of 100.

## Use

Load locally with `claude --plugin-dir <absolute-plugin-directory>`, or install `slr-harness@rail-research` from your configured marketplace. Node.js 18+, Git and Claude Code are required; this checkout is tested against the installed version recorded in docs/pipeline-validation.md. PDF delivery uses latexmk, XeLaTeX and BibTeX. Optional paper-search metadata discovery falls back to available web/MCP retrieval; the plugin never installs tools during a review.

- `/slr-harness:review <topic>` applies defaults to missing settings without an initial configuration questionnaire, starts scope reconnaissance, then waits for explicit human approval of the proposed scope.
- `/slr-harness:review status <slug>` is read-only.
- `/slr-harness:review resume <slug>` resumes schema-2 research, pending final review or its authorized repair.
- `/slr-harness:paper <slug>`, `paper resume <slug>` and `paper revise <slug> <feedback>` support independent delivery and revision.
- `/slr-harness:update` currently performs no updates. Start a new review for new evidence.

New workspaces use schema 2. Historical schema-1 workspaces retain status and completed-corpus paper delivery; research resume and incremental update are disabled. There is no automatic migration. Existing historical artifacts remain untouched.

## Evidence and execution

Main owns scope approval, global state, canonical identity/ownership, Git and compilation. Managers own topic plans, chapter.md and synthesis.md. Workers own assigned task logs and canonical paper metadata.json/note.md. Independent Checkers read chapter evidence and return issues. The final Reviewer may retrieve reference surveys and write only its assigned staged report draft; manuscript, evidence and state stay read-only and delegation is forbidden. Paper Agent writes main.tex, references.bib and its bounded writing-handoff.md. Runtime Agent IDs and task leases constrain writes through PreToolUse hooks; no global permission bypass is needed.

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

Subagent delivery uses native SubagentHandback when exposed, otherwise final text. READY is initialization only; missing reports receive bounded recovery and never substitute self-review. See [delivery repair](docs/subagent-handback.md) and [orchestration contract](skills/review/references/handback.md).

### Startup defaults

Explicit user settings take precedence. With no initial questionnaire, review defaults
to a professional synthesis for domain researchers (taxonomy, method relationships,
conditional comparisons and limitations), English, five research rounds and nine
concurrent Workers. Research evidence defaults to academic papers and verifiable
preprints; authoritative technical documentation supports background and supplementary
explanation. The Scoper selects the date range, records its rationale and search
cutoff, and proposes evidence-driven coverage. Research tiers are inferred from the
original request: low ~30 accepted unique papers (simple/brief review), medium ~60
(default), high ~90 (deep review, with justified expansion). Explicit counts override
these soft targets. All topics share one target; pending reading is considered before
new discovery. Tiers keep the same budgets and evidence standards. Effective settings
are displayed and recorded in the scope draft; see
[research-scale contract](skills/review/references/research-scale.md).
Human approval of that draft remains mandatory before research. Existing repair
and operational pauses, and the standalone paper configuration question, are unchanged.
Existing workspaces without researchProfile keep their prior no-target behavior on
resume. See [tier validation results](docs/research-tiers-validation.md) for executed
checks and outstanding real-Agent validation.

## Chapter ownership boundary

The full manuscript outline and the topic registry are different structures.
Only 3–5 substantive research topics enter the registry; each receives one Manager.
Global sections never count toward that number and receive no dedicated Manager:
Abstract, Introduction, Background OR Preliminaries, Taxonomy OR Unified Framework,
Comparative Analysis and Evaluation, Challenges and Future Directions, Conclusion.
Paper Agent writes these global sections from scope/scoping, accepted topic chapters,
synthesis.md and targeted primary notes, and assembles the Managers' topic chapters.
Scoper proposes the global outline and classification; it does not write final prose.
Managers provide supporting background, terms and taxonomy evidence in synthesis.md;
providing this evidence does not transfer global-section authorship to a Manager.
A topic may explain its own necessary background or local taxonomy within its chapter.
Classify by responsibility and scope, not title keywords: a renamed global section
such as "Unified Evolutionary Taxonomy" still must not become a registered topic.

### Context-controlled execution

New workspaces use bounded CLI summaries, paged queries and topic-local Manager
control. Managers request shared Worker slots, collect/validate their deliveries
and submit evidence acceptance through a restricted helper. Main coordinates
rounds, cross-topic conflicts, independent Checker results, Git and final delivery.
A real nesting probe is required; unsupported hosts use disclosed main-dispatch.

Scope approval, accepted topics and compiled/visually inspected paper versions
produce recovery checkpoints. PreCompact saves a bounded index and SessionStart
loads it. This does not automatically execute /compact or pause the pipeline.
Each writing phase and review unit uses a fresh, serialized role invocation; source
and evidence hashes prevent stale phases from becoming a current delivery.

See [context workflow](skills/review/references/context-workflow.md) and
[staged writing/review](skills/paper/references/staged-execution.md) for APIs and
recovery. Default summaries/handbacks are 8000 characters; text reads 24000
characters and PDF reads at most five pages. These limits are not token guarantees.
Existing schema 2 workspaces opt in only during explicit resume, after active
leases are resolved; historical files and budgets are preserved.
