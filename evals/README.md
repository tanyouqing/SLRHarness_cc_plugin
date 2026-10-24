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
