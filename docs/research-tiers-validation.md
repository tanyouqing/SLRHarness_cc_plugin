# Research tier implementation and validation — 2026-10-25

New reviews infer low / medium / high from the original request, with shared soft
targets of 30 / 60 / 90 accepted unique papers. Medium is the default; explicit
counts override it. Main performs semantic interpretation; scripts validate and
persist the result, expose global accepted/pending counts, freeze the profile after
scope approval, and require a count-variance explanation at research finalization.
The live Manager query uses aggregate counts without opening other topics' records.
Pending work and shared papers inform scheduling; counts do not automatically select
papers, certify coverage, stop active Workers or change existing review budgets.

The detailed API and role responsibilities are in
[research-scale.md](../skills/review/references/research-scale.md). New state remains
schema 2; existing workspaces without a profile keep their previous no-target policy.
Current paper status also reports distinct actual citation keys, separately from
accepted research records; stale PDF status exposes no current citation count.

## Executed checks

- `node --test tests/*.test.mjs`: **87 passed, 0 failed**. Eleven new tests cover
  profiles, overrides, invalid input, approval freezing, recovery, legacy absence,
  shared identity, all three Managers' aggregate view, pending-count planning,
  justified expansion, count variance, Checker requirements, bounded responses,
  citation counting and static prompt/eval contracts.
- Existing tests still cover nine-slot concurrency, retry and round limits,
  staged writing, shared-evidence invalidation, and the synthetic 69-to-70 final
  review repair loop. Fixtures now supply honest synthetic scaleReason values.
- All `scripts/*.mjs` passed `node --check`.
- `claude plugin validate .`: passed.
- `git diff --check`: passed.

The sandbox initially prevented test child processes from starting (`spawn EPERM`).
The full suite passed after permitting local test subprocess execution. This was
an execution-environment limitation, not a test assertion failure.

## Not executed in this change

- Real Agent classification of the twelve Chinese/English cases in
  [research-tiers/cases.json](../evals/research-tiers/cases.json).
- Real Manager/Worker scheduling against the tier target, including model-generated
  allocation decisions and simultaneous discovery near the target.
- Complete real-literature reviews at 30, 60 or 90 papers, or a new real TeX/PDF run.

The semantic cases contain expected outputs, not measured model results. Current
compile-related tests use mock compiler output. No claim is made that deterministic
tests prove semantic interpretation, paper quality, or exact token expenditure.
