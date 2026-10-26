---
name: review
description: Scope, run, resume or inspect a hierarchical literature review with 3–5 topic managers, per-paper evidence notes, independent chapter checks, LaTeX/PDF writing and final manuscript review with bounded repair.
argument-hint: <topic | resume <slug> | status <slug>>
---

# Hierarchical literature review

Read references/workflow.md, workspace-schemas.md and scoping.md before acting.
Main-session orchestration owns global state, paper identities, budgets and Git.
Use absolute paths under ${CLAUDE_PROJECT_DIR}/workspaces/<slug>. Never overwrite
an existing workspace. Use pipeline.mjs for state changes, not direct state writes.

Do not ask initial configuration questions. Retain settings explicitly supplied by
the user and apply defaults to missing settings. Briefly disclose the effective
configuration, then start scoping without waiting for a configuration response.
Defaults: a professional synthesis for domain researchers covering taxonomy, method
relationships, conditional comparisons and limitations; five global research rounds;
academic papers and verifiable preprints as research evidence, with authoritative
technical documentation for background and supplementary explanation; a date range
chosen by the Scoper for the topic, with rationale and search cutoff recorded.
English is default unless Chinese output is explicitly requested. A topic written
in Chinese alone does not choose output language. Infer a research tier from the original request: low ~30 papers, medium ~60
(default), high ~90 with evidence-driven expansion. These are soft targets, with no
default hard limit on paper count. Read references/research-scale.md before init;
record researchProfile and coordinate one shared target across all Managers.
Explicit paper counts override tier defaults. Keep existing execution budgets.
Record effective settings in SCOPE_DRAFT.md and the scoping handoff. These defaults
do not remove the explicit human scope approval below.

Scopers read related surveys and initial sources, propose 3–5 research topics and scope.
Separate the full manuscript outline from the topic registry. Register and assign
Managers only to research topic chapters. Abstract, Introduction, Background OR
Preliminaries, Taxonomy OR Unified Framework, cross-topic comparison, Challenges
and Future Directions and Conclusion belong to Paper Agent and never count as topics.
Managers supply evidence for those global sections through synthesis.md. Before
scope approval and Manager dispatch, check this ownership split in the draft.
Present the draft and stop for explicit human approval. Configuration answers and
vague praise are not approval. After approval run within budgets to honest completion
or a concrete blocker. Final review pauses after three failing repairs and requires explicit continuation. Every accepted research
completion proceeds automatically to paper writing and final review without new intake.

Defaults: global maxWorkers 9, task attempts 2 per phase, two low-yield rounds,
and at most two chapter repair cycles. Topic managers may launch leased workers.
Status is always read-only. Legacy workspaces support status and completed-corpus
paper generation only; no legacy research resume, update or implicit migration.

For resume, inspect `.slr/final-review.json` through final-review.mjs status before
normal research routing. Follow ../paper/references/final-review.md for active repairs,
pending assessments or pauses. Do not reset original research budgets or move tags.

Before any Agent invocation, read references/handback.md. Apply its READY/native transport, artifact validation, bounded recovery and reading-batch rules. Never replace a missing independent review with self-review.

Read context-workflow.md (under references/ from SKILL.md) for bounded output,
Manager-owned Worker control and compact recovery. Manager requests live only in
topics/<id>/requests/. Scripts atomically maintain state and request receipts.
Additional sidecars: .slr/context-policy.json, .slr/recovery.json, .slr/checkpoints/,
.slr/work-stages.json. Staged writer also owns paper/writing-handoff.md; staged
Reviewer owns only its currently assigned paper/reviews/<submission>/drafts/<unit>.json.
Default control responses never include the full registry or historical reports.

## Conference configuration

For new pipeline init, include paperConfig only when the initial prompt explicitly
selects a conference/template/year; otherwise the controller persists NeurIPS.
NIPS is an alias. Set manuscript language to the research language. No template
question or submission-vs-template intent split. Record resolved version in scope.
See ../paper/references/conference-format.md (from review skill root). Existing
workspaces without this sidecar keep legacy behavior. Resume never re-infers the
selection. Before final Reviewer, configured papers require current official format
audit (passed or explicitly official_unverified) after every manuscript revision.
