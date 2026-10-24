# Research tiers and shared paper targets

## Interpret the original request

Main interprets the user's original review request semantically; do not implement
keyword-only classification. Explicit tier takes precedence over depth wording.
Use low / 30 papers for simple, brief or small-scale reviews; medium / 60 for
standard reviews or absent depth instructions; high / 90 for deep reviews.
Handle negation, quotations and what a modifier describes. “不要深度调研，简单了解即可”
means low; “深入研究过的模型” alone does not request high. Unresolved contradictory
depth instructions select medium with a disclosed reason. Do not ask intake questions.
An explicit paper count overrides the tier's default count; it remains a soft target.
Do not reinterpret an explicit hard user constraint as permission to exceed it.

Pass researchProfile in init config, for example:
```json
{"tier":"high","targetPapers":90,"source":"inferred","targetSource":"tier","rationale":"User requested a deep review of this topic."}
```
source is default, explicit, inferred or conflict (default and conflict require
medium). targetSource is tier or explicit; explicit allows any
positive integer targetPapers. Record a concise truthful rationale (max 1000 chars).
Omitted init profile defaults to medium / 60. Main alone can call
`pipeline.mjs configure-research <workspace> <input.json>` with {researchProfile}
before approval. After changing it, update and re-present SCOPE_DRAFT.md; never reuse
approval for an older configuration. Scope approval freezes the profile.

Display effective tier, target, inference reason and unchanged budgets before
reconnaissance; include them in Review Configuration in the scope draft. Scope human
approval remains mandatory. Five initial rounds, nine concurrent Workers, retries,
chapter checks and final review budgets are identical across tiers. Low tier keeps
the same evidence quality requirements. No automatic change to manuscript length.

## Allocate once for the whole workspace

Scoper checks feasibility and proposes reading allocations for 3–5 substantive
topics, with rationale. Include shared foundations and related surveys needed by
global chapters. Main coordinates allocations as contributions to ONE global target,
not 30/60/90 per Manager. Do not require equal topic sizes. Record allocations and
adjustments in scope/plans and handoffs; shared papers contribute once globally.

Managers subdivide their allocation into task-sized discovery/reading requests.
Before planning more discovery, use manager-control query {collection:"scale"} for
live global counts. Main uses status/recovery's researchScale. Successful request
receipts are historical, so query fresh counts after a restart or scheduling pass.
accepted counts unique registry entries with status final; pending counts registered
entries awaiting acceptance. remainingAfterPending subtracts BOTH from the target.
Search hits and unregistered candidates are not counted. A Scoper/Reviewer reference
survey counts only if formally registered, read and accepted. shared is a subset of
registered, not an extra addition. Counts do not prove source fingerprints or coverage.

Main reviews all Managers' plans before releasing dispatch and coordinates new
reading across topics. Count existing pending papers before assigning incremental
allocations; do not allocate the entire remaining target independently to each topic.
Workers put only selected, eligible papers intended for formal reading in
candidates.json; keep additional hits, screening decisions and deferred candidates
in search.md. Explain relevance/coverage without literature scores or rankings.
Workers follow the Manager's task allocation, never the global target as their own.
Do not silently drop candidates or truncate a submitted discovery file in control code.

When coverage is sufficient near the target, stop quantity-only discovery and write
chapters; let active tasks finish normally. Low/medium may moderately exceed their
targets to resolve necessary gaps. High can expand beyond 90 for uncovered method
families, conflicts or comparison conditions. Record a concrete gap rationale in
the task plan for all extra work. Once registered count reaches the target, the
script requires a rationale for new tasks even in round one. This is not a hard cap
or a semantic guarantee that a supplied rationale is sound. Managers/main remain
responsible for justified expansion before that point and for simultaneous plans.

## Finish and recover

Do not pad a corpus, weaken acceptance or reopen passed chapters just to reach a
number. Sparse literature, access limitations, saturation or exhausted budgets may
justify a smaller corpus. Existing completion and Checker rules still apply; target
attainment never skips evidence checks. For a count differing from the target,
`finalize` takes {scaleReason:"Specific reason for the actual count"} (1–1000 chars).
The controller saves scaleCompletion with target, accepted/pending counts and signed
difference. This requires an explanation, not additional papers. Main records these
facts in REPORT.md. Paper delivery separately reports unique actually cited keys
from validated LaTeX; do not equate bibliography entries with citations or require
every accepted paper to be cited. Reviewer must not deduct points solely for missing
the soft target; judge approved coverage and evidence.

Reviewer-driven repairs add only issue-driven evidence within the independent
supplemental budget. Never restart a full tier-sized corpus in a repair. Finalize
each repair with an updated scaleReason where needed. Resume uses persisted profile
and counts, never reinterprets “continue” as a new intake. Old schema-2 workspaces
without researchProfile retain their original no-target behavior, including on
resume/context enable; status is read-only. Schema 1 behavior stays unchanged.
