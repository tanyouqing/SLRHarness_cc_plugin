# Context control validation — 0.8.0 (2026-10-24)

This section supersedes earlier counts below. The current 0.8.0 change is bounded
context/Manager control, not the previously reverted unified-Checker redesign.

- Deterministic suite: 76 tests passed. Includes competing Manager processes,
  nine-slot/two-attempt limits, shared canonical evidence, partial delivery refusal,
  idempotent requests, role-scoped controls, bounded summaries and pagination,
  immutable stage findings, fresh writer/reviewer assignments, old-workspace opt-in,
  and a synthetic three-topic/shared-paper 69-to-70 repair sequence.
- Static validation: plugin manifest and git diff --check pass.
- Real compilation: staged synthetic fixture built with latexmk/XeLaTeX/BibTeX;
  two pages visually inspected, no obvious clipping/missing glyphs, no layout warnings.
- Real Agent probe: attempted, not passed. One Manager initialized/bound, zero
  Worker launches before the requested 1 USD budget stopped the run. Host-estimated
  total was 1.031233 USD with unknown custom-model cost basis. Permission denials
  included PowerShell and non-allowlisted shell listing; no bypass was introduced.
- Not executed: live manual /compact with active siblings, successful real nested
  Worker delivery, and complete real-literature writing/review/repair.

See context-control.md and the two execution contracts for APIs, limits and recovery.

---

# Delivery compatibility patch (0.7.1) — 2026-10-24

The patch preserves the 0.7.0 schema, Manager evidence acceptance, Checker chapter
review and existing research/repair budgets. It permits native SubagentHandback
result transport before initialization binding and for failure reports. Other role
tool restrictions remain. Six role prompts and orchestration references now specify
native/text delivery, READY separation, exact review JSON, at-most-three-paper
reading batches and bounded recovery without substituting self-review.

Validation: 63 deterministic tests passed; plugin manifest validation and
`git diff --check` passed. New tests cover six-role READY, malformed handback
messages, unchanged JSON and read-only permissions, failed/paused reports, plus
prompt integration. Batch sizing and recovery are orchestration prompt contracts;
no automated scheduler or live Claude Agent handback test is claimed. No server
rerun, fresh scientific review or additional TeX run was performed for this patch.
The supplied server report's successful minimal test was not independently repeated.
See [analysis and server test procedure](subagent-handback.md).

---

# Hierarchical pipeline validation

Date: 2026-10-23 (Asia/Shanghai)

## Historical release: final Reviewer (0.7.0)

Final Reviewer is separate from the chapter Checker. It retrieves real authored
surveys, compares aligned scopes, and returns separate Scoper/Manager/Worker
candidate advice. The final manuscript rubric has twenty integer 0–5 items and
passes at >=70, without a critical-error cap/veto. Single-paper literature appraisal
remains removed. Legacy workspaces do not enter the new repair flow.

`final-review.mjs` snapshots manuscript/PDF and evidence, checks twenty-item arithmetic,
tracks independent comparison/quality completion, invalidates stale or modified
snapshots, and controls authorized repair. Each repair gets one extra research round,
with nine shared Worker slots and two attempts per task phase. Three completed failing
reassessments pause for explicit continuation. A journaled repair intent and immutable
submission files support interruption recovery. Existing slr-complete stays unchanged.

### Static and deterministic checks

**57 deterministic tests passed, 0 failed**. Tests cover 69/70, critical issues without
an extra veto, exact rubric IDs, matching/overlapping/adjacent references, adjacent
coverage rejection, missing references, uncertain attribution, empty advice lists,
current PDF/evidence hashes, snapshot tampering, scoped repairs after initial-budget
exhaustion, shared-note invalidation, nine-slot/two-attempt limits, three-repair pause,
user continuation, interrupted reopen/copy recovery, role permissions, scope decisions,
and legacy preservation. Plugin manifest validation and git diff --check passed.
These checks validate contracts and control flow; semantic scores are fixture inputs.

### Real compilation and visual inspection

Ran `node evals/final-review-smoke.mjs` into
`../../validation/final-review-20261023/`. The isolated fixture has three topics and
one shared paper. It received a supplied 69-point assessment, supplemented the shared
note, rechecked all three chapters, created a new accepted-evidence Git checkpoint,
rebuilt the manuscript, and recorded a supplied 70-point reassessment. The initial
slr-complete tag was unchanged. Both real latexmk/XeLaTeX/BibTeX builds succeeded,
with no layout warnings or unresolved citations/references. The final two-page PDF
was rendered with pdftoppm and inspected page by page: no obvious clipping or missing
glyphs. This run is English; earlier Chinese compilation below remains historical.

The result JSON, initial/final snapshots, role advice and final PDF are retained in
that validation directory. Scores and reference comparisons are explicitly synthetic;
this is not a real model review or a scientific survey. Only the isolated evaluation
repository received fixture commits; the plugin repository was not committed/pushed.

### Live Agent and complete scientific run

**Not executed in this change:** live Reviewer retrieval/full-text reading, actual
rubric judgment, Manager/Worker/Paper/Reviewer model orchestration, and a complete
scientific review with real low-score revision. `evals/final-review-live/` provides the
manual live scenario and grader, requiring an actual completed research workspace.
No model-generated score or semantic reliability claim is reported. The earlier
Claude nesting probe limitation is recorded below and remains unresolved.

## Historical adjustment: nine Workers and lightweight paper proofreading

The global Worker default and hard maximum are now 9. Each ready subtopic task may receive one Worker per phase; excess tasks queue under the shared lease limit. Existing workspace budgets are preserved rather than silently rewriting an approved scope.

Paper delivery no longer requires an independent manuscript verdict, review fingerprint or repair-cycle reset. The writer fixes minor wording, transitions and inconsistencies directly, qualifies uncertain statements and discloses residual concerns for later dedicated review. Historical manuscript review sidecars are preserved and ignored. Research-stage chapter review remains in place. Source-format checks and compiler/PDF freshness checks remain active.

Verification at that time: **39 deterministic tests passed**, including ninth-slot allocation, tenth-slot rejection, lease refill, no-verdict compilation and ignored historical rejection. `claude plugin validate .` and `git diff --check` passed. No new live Agent or real TeX run was performed for this adjustment; earlier compiler results below are historical.

Chapter inspection role naming is now consistently Checker: agent file/name slr-checker, runtime role checker, and request field checkerId. Role instructions, guard permissions, fixtures, tests and active documentation use this name. The former blanket token scan was subsequently replaced by role-separation tests when the distinct final Reviewer was added. Original conference checklist prose and historical generated workspaces are outside this role rename.

## Earlier implementation and checks (before this adjustment)

The plugin now uses schema 2, 3–5 major topics, per-topic Managers, dynamically planned Worker tasks, canonical per-paper metadata/notes, chapter/synthesis handoffs, independent chapter and whole-manuscript review, and LaTeX/PDF delivery. Stable identities, unique ownership, leased concurrency, bounded retries/rounds, stale-evidence detection and read-only legacy research are implemented in the control scripts and role contracts. Incremental update execution is disabled. Retired literature appraisal scripts, prompts, current fixtures and runtime permissions were removed; historical research archives were left intact.

## Deterministic validation

`node --test tests/*.test.mjs`: **37 passed, 0 failed**. Covers explicit scope/hash approval, three-topic shared-paper flow, one Worker producing multiple separate records, identity/version rejection, title-only confirmation, per-role paths, one launch per Worker lease, shared concurrency, two attempts, reload/recovery, low-yield and maximum-round stop, chapter rejection/repair, source invalidation, legacy mutation rejection, manuscript revision archival and compile failure preservation.

`claude plugin validate .`: passed on installed Claude Code **2.1.274**.
`git diff --check`: passed. Active plugin/fixture/document scan has no retired protocol references; the negative regression assertion intentionally names forbidden tokens. Historical archived files are excluded from cleanup. Schema checks and a supplied review verdict are structural evidence, not proof that a model accurately reviewed scientific claims.

## Real compiler and visual validation

`node evals/compile-smoke.mjs <new-absolute-output-directory>` completed the deterministic three-topic shared-paper fixture, including a rejected-then-repaired chapter, and compiled English and Chinese minimal manuscripts with real **latexmk + XeLaTeX + BibTeX**. Both produced current PDFs with no unresolved citations/references, missing glyphs or overfull-box warnings. Shell escape and latexmk rc loading were disabled. PDF pages were rendered with pdftoppm and all four pages inspected: readable headings, Chinese body text, complete citations/references and no obvious clipping.

Artifacts: `../../validation/hierarchical-final-20261023/{english,chinese}/paper/` contains main.tex, references.bib, style, build.json, main.pdf and isolated build logs. The adjacent page PNGs record rendering. These short manuscripts explicitly identify themselves as synthetic pipeline demonstrations. They do not test 6,000–9,000-word layout, large comparison tables or scientific synthesis quality. The underlying test verdicts are deterministic inputs, not real Checker opinions.

## Real Agent dispatch boundary

A real `claude -p` probe requested root → probe-manager → probe-worker using only Agent, with a USD 1 budget cap and **no permission bypass**. The process did not return within 95 seconds and was terminated by the timeout. Nested invocation and its cause of failure could not be established. No usable model transcript was returned. This is **unverified**, not evidence that nesting is unsupported.

The production workflow includes an explicit `main-dispatch` fallback, using the same Manager task plans, leases and paper ownership; its state/permission paths are tested deterministically. A successful live nested or fallback dispatch with plugin hooks remains unverified. The probe result is recorded in `../../validation/nesting-probe-20261023.json`.

## Not executed

A full model-driven review with actual searches, full-text reading, independent semantic review and final research manuscript was **not executed**. Checker's ability to detect real unsupported claims, incomparable experiments or hidden limitations remains a live eval requirement; review-repair and hierarchical-live scenarios specify it. No cross-task literature library, experience memory or RL work is included. No repository commit or push was performed.

## Current implementation: six dimensions and shared experience JSON — 2026-10-26

The only supported rubric has six direct integer dimensions (15/15/25/20/15/10),
with >=70 passing. Its identifier protects fingerprints from stale scores; no old
scoring definitions or continuation dispatcher remain. Each dimension has one set
of locations, evidence and rationale. Unsupported scores are not converted.

Only approved frozen SCOPE.md is added to Reviewer scientific inputs. It must match
SCOPE_ORIGINAL.md and the approval hash. Bounded scope units precede manuscript units;
reference selection and coverage judgment use approved scope. Ordinary coverage
repairs preserve scope; actual scope changes require user approval. Notes, chapter
materials, task logs and internal state remain unavailable to Reviewer.

experiences.json contains exactly an experiences array. Required fields: sourceType,
role, executionSummary and strategy. Roles: paper/manager/scoper/worker. The shared
validator accepts review/trajectory; Reviewer emits review only. Optional stage,
task and applicability may be omitted, null or empty. executionSummary briefly
records comparison evidence (1–3 sentences); strategy states transferable actions.
No per-role quota, experience Markdown, trajectory extractor or memory store is added.
Historical workspace files and official upstream templates remain untouched.

Pre-push review corrected stale main-workflow/schema instructions, outdated library
readmes and repeated host entries. The canonical Reviewer envelope is maintained
only in reviewer-input.md. Writing and format checks share one source hash function.

Final cleanup verification: **111 deterministic tests passed, 0 failed**
(`node --test tests/*.test.mjs`, transcript `../output/auto-survey-prepush-tests.txt`).
All script/eval syntax checks, git diff checks and `claude plugin validate .` passed.
All 38 unique upstream files and six writing guides matched their recorded hashes.
Active prompts/contracts contain no retired scoring or advice-output path. Historical
release notes remain explicitly historical. No generated workspace/output is committed.
Real Agent format verification, scope-based reference selection, semantic scoring,
strategy transfer and a complete live repair run have not been executed. Fixtures
validate control behavior and schema only; actual TeX/PDF evidence is documented
separately in conference-format-validation.md.

## 2026-10-27 — Sprint2-B Survey KB integration (0.9.0)

Implemented against 6c7b214 with current staged writing, conference-format checking,
Manager paper acceptance, Checker chapter checks and Reviewer isolation preserved.
New per-run optional KB setting, role/task guards, full response cache with bounded
MCP output, provenance-aware imports, frozen accepted submissions, final experiences,
native JSONL collection and durable serial synchronization are implemented. KB
service/database/interfaces are unchanged.

Final offline suite: **130 passed, 0 failed** (111 baseline + 19 KB tests). Script/eval
syntax checks, generated probe-hook syntax, plugin validation and diff check passed.
No real database, Embedding, model, cloud deployment or native model probe was run.
See [implementation evidence](sprint2-b-validation.md) and the
[Chinese deployment manual](survey-kb-deployment.zh-CN.md) for cloud-only acceptance.

## 2026-10-27 — Success-only one-shot synchronization (0.9.1)

Supersedes the resident synchronizer in 0.9.0. All three submission types now wait
for current whole-research success and the Stop handoff. Accepted papers freeze
locally during execution. kb-sync once drains a finite batch; resume retries failed
items without resubmitting known jobs. kb-run waits for normal Claude exit before
processing handoffs completed during that invocation. No watch command or systemd
template remains; KB's own distillation worker is unchanged.

Offline coverage totals 140 tests; current report and cloud-only checks are in
[sprint2-b-validation.md](sprint2-b-validation.md). No real models, databases or
cloud connections were used for verification.
