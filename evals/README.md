# Pipeline evaluation

Run deterministic tests with `node --test tests/*.test.mjs`. Automated case directories include fixture.sh, prompt.md and a behavioral grader. final-review-live is a manual scenario requiring a real completed workspace; it deliberately does not fabricate a scientific fixture. Run fixtures in a fresh sandbox; existing workspaces are never overwritten.

Fixtures use synthetic evidence for control-flow validation. They do not establish scientific reliability. The three-topic case exercises shared paper identity, canonical ownership, chapter repair and completion. Paper cases cover legacy handling, limitations, revision, compilation failure and read-only status. Use hierarchical-live for real Manager/Worker dispatch and review-repair for semantic review behavior; these require model transcripts and must be reported separately.

Use `node evals/fixture-runner.mjs three-topic` from a fresh sandbox to seed a complete demonstration. The fixture imports helpers relative to the plugin path. `scaffold()` refuses collisions. Compiler tests use a mock unless a validation report explicitly records a real TeX invocation and visual PDF inspection.


Final-review deterministic cases are in tests/final-review.test.mjs. Run
`node evals/final-review-smoke.mjs <new-absolute-output-directory>` for the real-TeX
three-topic/shared-paper 69→70 control-flow demonstration. All scores, reference
comparisons and repairs in that demonstration are synthetic fixtures, not actual
model judgments. final-review-live specifies the independent live semantic eval;
record observed scores, sources and tool calls without forcing a passing result.

Research-tier deterministic coverage is in tests/research-profile.test.mjs.
research-tiers/cases.json and its README define a separate live semantic and
scheduling evaluation; expected labels are not evidence that a model was run.

## Multi-conference format adapters

Run `node evals/template-library-smoke.mjs <new-absolute-output-directory>` with
latexmk/pdfLaTeX/XeLaTeX/BibTeX on PATH. Optional third argument is a comma-separated
venue list for focused repairs. Verified profiles run through the production configure/prepare/build interfaces;
unverified profiles use raw candidate compilation without editing catalog flags; AAAI Chinese is explicitly unsupported. Read
results.json, final logs, then render and inspect every resulting PDF.

`tests/conference-format.test.mjs` exercises controlled offline/pass/repair/pause
states without format reports, configuration, immutable styles, snapshot inclusion
and scoped tools. Reviewer read isolation and main-only issue routing are tested.
These fixtures do not constitute an actual Paper Agent website audit. Live eval:
start a low-tier review with an explicit registered template, approve scope, run
through writing, independent official audit, at least one genuine format repair
if needed, and final Reviewer. Record real URLs, tool evidence, PDF inspection and
limitations; do not manufacture a defect or passing verdict to satisfy the test.

New final-review evals use survey-2 six-dimensional scoring, approved scope alignment
and transferable strategies. Deterministic checks cover six-dimension maxima, rejected unsupported rules,
read isolation, scope integrity and 69/70 transitions.
The final-review-live grader separately checks reference-selection relevance and
cross-topic transfer of strategies; fixtures cannot establish semantic quality.

The review experience artifact is experiences.json, using the shared experiences
array schema. Unit tests accept review/trajectory records in the shared validator
and enforce review-only origin at the final Reviewer boundary. Live evals inspect
strategy quality and truthful executionSummary observations separately from schema
validation. Trajectory extraction itself is not implemented or tested as a live flow.
