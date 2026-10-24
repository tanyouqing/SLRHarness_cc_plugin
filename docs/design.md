# Hierarchical survey pipeline

Schema 2 is defined in scripts/pipeline.mjs and skills/review/references/workspace-schemas.md. Main is the only state writer; mutations use a serialized lock, a validated transition and atomic JSON replacement. Existing schema-1 state remains readable via state.mjs and the read-only evidence baseline utility. The update skill has no mutation route.

The approved scope defines 3–5 stable major topics. Managers choose subtopics dynamically, preserving task IDs and recording supersession reasons. Discovery and reading are separate phases: main resolves aliases and versions before assigning stable paper IDs and one writing owner. Sharing across topics reuses those IDs. Supplements return to one assigned owner and invalidate dependent chapter acceptance.

Runtime Agent IDs are bound after a READY handshake. Main reserves global Worker leases before Managers can delegate. The guard permits only the allocated Worker type and precise write paths; Managers may invoke only the narrow bind-worker shell helper. Worker shell access is limited to read-only paper-search. Checker and writer cannot retrieve or delegate. Main dispatch is the explicit fallback if host nesting is unavailable. This is a cooperative orchestration boundary, not an operating-system sandbox for untrusted code.

Five rounds, nine concurrent Workers and two attempts per phase are defaults. Low yield means no newly accepted papers or chapters. New task creation cannot reset saturation. Pending work can be closed only with a recorded reason. Checkers return evidence-linked major/minor issues; passing with substantive errors is forbidden. At most two repair cycles follow an initial chapter review. No failed topic is silently omitted.

Managers write chapter.md plus synthesis.md to provide introductory terminology, scope relationships, comparison conditions and open questions without forcing the Paper Agent to load every note. Paper reads these materials and selectively checks primary notes. All major topics are assembled into the LaTeX template; the writer directly proofreads wording, transitions and minor inconsistencies before compilation. Remaining concerns are passed to the final Reviewer after compilation. Writer proofreading stays lightweight; final Reviewer separately compares authored surveys and scores the complete manuscript.

Initial completion creates immutable slr-complete before automatic paper handoff. A failing final assessment may authorize a scoped research revision while preserving that original checkpoint. Paper sidecars track writer bindings without mutating research state. Build uses isolated directories, disabled shell escape and source/PDF hashes. Failure preserves sources and historical PDF bytes but marks delivery non-current. Historical Markdown is retained. Authored evidence claims and visual quality still require model/human review; schema and build validation cannot establish scientific correctness.


## Final manuscript assessment

scripts/final-review.mjs owns a separate state machine: not_started → awaiting_review
→ passed, comparison_pending or revision_required. Three completed failing repairs
pause; explicit continuation opens another batch. Operational pauses retain the
active revision and do not count as a completed reassessment. Status is read-only.

Each submission snapshots exact sources, style, PDF, scopes, task/plan material,
canonical records and registry with content hashes. Results are immutable; changed
inputs invalidate acceptance. The fixed survey-1 rubric has twenty integer 0–5
items. Arithmetic and 70-point threshold are checked deterministically; semantic
scores and full-text relevance remain model judgments. Critical issues do not add
an extra veto. Comparison validity and quality passing are recorded separately.

Main opens an issue-derived revision through final-review control under the shared
workspace lock. A persisted repair intent supports recovery before the research
state write. revisionContext authorizes affected topics and one extra round without
changing initial counters. Unique paper ownership, nine active leases and two task
attempts continue to apply. Shared supplements expand affected topics and invalidate
chapter checks. Old task attempts are not reset. Fresh accepted evidence is committed
before Paper writer rebuilds the manuscript; the initial completion tag never moves.

The final Reviewer can use read-only scholarly retrieval and return results, with no
workspace writes or delegation. Main persists separate Scoper/Manager/Worker candidate
advice with source-linked differences, conditional actions and attribution uncertainty.
Reference match may be same, overlapping or adjacent; adjacent surveys cannot justify
field-specific coverage deductions. Historical workspaces do not enter this repair loop.

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
