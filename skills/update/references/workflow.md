# Incremental update workflow

## 1. Route and validate

Resolve the requested slug. `status` is read-only. `resume` selects the named update
or the sole non-terminal update. If several non-terminal updates exist, stop and
report invalid state rather than guessing.

Require all of the following before starting a new update:

- root review state is `completed` or `completed_with_limitations`;
- `SCOPE_ORIGINAL.md`, `SCOPE.md`, `TASKS.md`, `REPORT.md`, and `topics/` exist;
- `slr-complete` resolves;
- Git is clean;
- no non-terminal update exists.

Existing `paper/REVIEW_PAPER.md` is allowed and remains untouched.

Choose the highest-numbered completed update whose `update-NNN-complete` tag
resolves as baseline; otherwise use `slr-complete`. Choose the corresponding
approved update scope as the current effective scope; otherwise use root `SCOPE.md`.

## 2. First scope-review gate

On the first request, do not write, search, or delegate. Read the current effective
scope, original scope, report gaps, root state, latest update state if any, and the
baseline commit date. Present a compact but complete scope review:

- research question and objective;
- concepts and field boundaries;
- inclusion/exclusion and source coverage;
- existing and proposed time coverage;
- comparison dimensions and grouping/ranking;
- the active ESS/RUS/ORS rubric, or the proposed default rubric plus core-item
  backfill when the effective scope predates mandatory scoring;
- unresolved actionable gaps;
- differences from the original scope;
- proposed default three rounds.

Ask the user to keep or revise the scope, choose coverage dates, and optionally
override rounds. This answer is not approval unless it explicitly both keeps the
displayed scope and approves the update.

## 3. Draft and revision

Allocate the next update ID only when processing the user's response. Create the
update directories, state, and a complete `SCOPE_DRAFT.md`. Do not run scopers: no
retrieval is allowed before approval. Explain every scope difference under Added,
Modified, Narrowed, or Unchanged.

If the effective scope has no mandatory scoring rubric, add the default rubric as a
compatible scope delta. Define core backfill as unique works already present in the
baseline REPORT Comparison Table or named as principal subjects in Findings by
Group. Do not include works that appear only in References. This scoring addition
still requires explicit update-scope approval.

Reject a revision that replaces the core population/interest/context or changes the
review into a materially different question. Recommend `/slr-harness:review` with a
new slug instead. Compatible revisions increment `scopeRevision`, keep the update at
`awaiting_scope_approval`, commit `update-NNN-scope-draft-R`, present the draft, and
stop. Vague approval keeps the gate closed.

## 4. Approval and baseline

After explicit approval:

1. Validate the accepted draft's `slr-ranking-config`, then copy it byte-for-byte to
   `SCOPE_APPROVED.md`; never modify it later. Invalid scoring JSON or weights keep
   the update at the approval gate.
2. Set update state to `researching`, leaving root state unchanged.
3. Build `EVIDENCE_BASELINE.json` with the bundled script from all final notes and
   report references. Stop if generation or JSON parsing fails.
4. Create the empty update task file and note directory.
5. Record hashes of all pre-existing topic files. They must remain unchanged.
6. Invoke the first manager `plan`. Before editing tasks, the manager validates and
   commits the prepared approval/baseline artifacts as
   `update-NNN-start: approve incremental scope and baseline`, then creates the
   guarded `update-NNN-start` tag. It then continues the normal plan phase.

Only now may search or agent delegation begin.

## 5. Delta reconnaissance and rounds

Invoke two `slr-scoper` agents in parallel after approval:

- freshness reconnaissance uses inherited concepts and only the approved incremental
  date window;
- scope-delta reconnaissance covers newly added terms, source types, boundaries, or
  dimensions across their approved full range.

Pass both results to `slr-manager` with `runKind: update`, absolute paths, update ID,
baseline ref, approved update scope, update tasks/state, baseline index, round, and
the absolute plugin root for the fixed read-only ranking-score validator.

For each round from `currentRound + 1` through update `maxRounds`:

1. On the first call, manager `plan` first creates the start checkpoint described
   above. It then writes only update tasks and commits
   `update-NNN-round-R-plan: <summary>`. Every task is freshness, scope-delta, or
   backfill and has a unique update-note path. When scoring was newly added, create
   core-scoring backfill tasks without reopening broad search; use existing reports
   and notes, and apply neutral 2/4 imputation where evidence is absent.
2. Dispatch at most three Pending tasks in parallel to `slr-worker`. Delegations
   include update mode, approved scope, baseline index, lane, and exact output path.
3. Manager `review` validates new notes, classifies candidates as new source,
   version update, duplicate, or backfill, updates update tasks/state, and writes a
   complete REPORT whose baseline prefix is unchanged. It commits
   `update-NNN-round-R-review: <summary>` and tags `update-NNN-round-R`.
4. Run the bundled baseline script's `verify` command. Any legacy-note change or
   deletion blocks finalization and must be restored from the baseline commit before
   research can continue.

An existing DOI, base arXiv ID, normalized title, or canonical URL is not a new
source. A newer arXiv version is a version update. Re-extraction of a newly approved
dimension is a backfill. Duplicates do not contribute to yield.

## 6. Stop and finalize

Use the existing priority within this update: blocked external prerequisite; no
pending tasks; two consecutive low-yield rounds; maximum rounds. Do not continue an
extra round.

Manager `finalize` verifies the baseline report is an exact prefix, legacy notes are
unchanged, new notes are final or traceably blocked, all update questions have a
disposition, all new and core-backfilled eligible items have validated scores and
rationales, and report update references resolve. It sets update state to:

- `completed` only when all actionable update work is resolved;
- `completed_with_limitations` otherwise.

Commit `update-NNN-final: complete incremental review` and tag
`update-NNN-complete`. Never create, delete, or move `slr-complete`.

If a formal manuscript exists, report that it is now stale and offer the explicit
`/slr-harness:paper revise <slug> incorporate update-NNN` command. Never run it
automatically.

## 7. Resume

Resume from the update state's recorded stage. Awaiting approval shows the current
draft and stops. Blocked resumes only after its prerequisite is available. Research
continues at `currentRound + 1`; never repeat a completed round, overwrite a new
note, rebuild a baseline after research starts, or allocate a new update ID.
