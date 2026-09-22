import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function write(relative, content) {
  const target = path.join(cwd, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content.trim()}\n`, "utf8");
}

function state(overrides) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      reviewId: overrides.reviewId,
      topic: overrides.topic,
      language: overrides.language ?? "English",
      stage: overrides.stage,
      scopeRevision: overrides.scopeRevision ?? 1,
      currentRound: overrides.currentRound ?? 0,
      maxRounds: overrides.maxRounds ?? 5,
      maxWorkers: overrides.maxWorkers ?? 3,
      consecutiveLowYieldRounds: overrides.consecutiveLowYieldRounds ?? 0,
      retryLimit: 2,
      completionReason: overrides.completionReason ?? null,
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: overrides.updatedAt ?? "2026-09-17T00:00:00.000Z",
      ...(overrides.lastError ? { lastError: overrides.lastError } : {}),
      ...(overrides.roundMetrics ? { roundMetrics: overrides.roundMetrics } : {}),
    },
    null,
    2,
  );
}

function updateState(overrides = {}) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      updateId: overrides.updateId ?? "update-001",
      reviewId: overrides.reviewId,
      baselineRef: overrides.baselineRef ?? "slr-complete",
      language: overrides.language ?? "English",
      stage: overrides.stage ?? "awaiting_scope_approval",
      scopeRevision: overrides.scopeRevision ?? 1,
      coverageStart: overrides.coverageStart ?? "2026-09-18",
      coverageEnd: overrides.coverageEnd ?? "2026-09-22",
      currentRound: overrides.currentRound ?? 0,
      maxRounds: overrides.maxRounds ?? 3,
      maxWorkers: 3,
      consecutiveLowYieldRounds: overrides.consecutiveLowYieldRounds ?? 0,
      retryLimit: 2,
      completionReason: overrides.completionReason ?? null,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: overrides.updatedAt ?? "2026-09-22T00:00:00.000Z",
      ...(overrides.lastError ? { lastError: overrides.lastError } : {}),
      ...(overrides.roundMetrics ? { roundMetrics: overrides.roundMetrics } : {}),
    },
    null,
    2,
  );
}

function initGit(reviewId, message, tag = null) {
  const root = path.join(cwd, "workspaces", reviewId);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "SLR Eval");
  git("config", "user.email", "slr-eval@example.invalid");
  git("add", "-A");
  git("commit", "-q", "-m", message);
  if (tag) git("tag", tag);
}

const draft = `
# Scope: RAG for long-document question answering

## Output Language
English

## Review Configuration
- Primary objective: landscape mapping
- Maximum research rounds: 5
- Source coverage: Academic + authoritative grey literature
- Time coverage: 2020-01-01 through 2026-09-17

## Research Questions
- Which retrieval and context-management methods are used?

## Concepts and Synonyms
- retrieval-augmented generation; RAG; long-context QA

## Inclusion and Exclusion Criteria
- Include peer-reviewed or authoritative technical sources with evaluated methods.
- Exclude uncited opinion pieces.

## Comparison Dimensions
- retrieval unit, context strategy, dataset, metric, limitations

## Ranking and Grouping
- Group by retrieval architecture; compare evidence strength before headline score.

## Databases
- Semantic Scholar, OpenAlex, ACL Anthology, arXiv

## Depth and Assumptions
- Medium-depth review; English sources; through 2026-09-17.
`;

const approvedScope = `
# Scope: Evaluation topic
## Output Language
English
## Review Configuration
- Primary objective: landscape mapping
- Maximum research rounds: 5
- Source coverage: Academic + authoritative grey literature
- Time coverage: No date limit
## Research Questions
- What is known?
## Concepts and Synonyms
- evaluation
## Inclusion and Exclusion Criteria
- Include verifiable studies; exclude unsupported claims.
## Comparison Dimensions
- method, evidence, limitation
## Ranking and Grouping
- Group by method and rank by evidence strength.
## Databases
- Semantic Scholar, OpenAlex
## Depth and Assumptions
- Targeted review.
`;

const reportTemplate = `
# Literature Review: Evaluation topic
## Overview
## Terminology, Conceptual Distinctions & Field Boundaries
### Core Terminology
| Term | Operational Definition | Commonly Confused With | Key Distinction | Evidence |
| --- | --- | --- | --- | --- |
### Field Boundaries
| Boundary | In Scope | Out of Scope / Adjacent | Rationale | Evidence |
| --- | --- | --- | --- | --- |
## Significance & Upstream/Downstream Impact
### Why the Field Matters
### Upstream Dependencies
| Upstream Area or Capability | Relationship | Why It Matters | Evidence |
| --- | --- | --- | --- |
### Downstream Tasks and Systems
| Downstream Task or System | Impact Mechanism | Expected Consequence | Evidence Strength | Evidence |
| --- | --- | --- | --- | --- |
## Method & Coverage
## Comparison Table
## Findings by Group
## Cross-Cutting Themes
## Gaps & Open Questions
| Question | Origin / Evidence | Disposition | Why Unresolved | Next Step |
| --- | --- | --- | --- | --- |
## Limitations
## References
## Index of Topic Notes
`;

const paperScope = `
# Scope: Retrieval and long-context methods for long-document QA
## Output Language
English
## Review Configuration
- Primary objective: method comparison
- Maximum research rounds: 1
- Source coverage: Academic only
- Time coverage: Through 2026-09-17
## Research Questions
- How do retrieval-augmented and long-context approaches differ in long-document question answering evidence?
## Concepts and Synonyms
- retrieval-augmented generation; RAG; long-context language model; long-document QA
## Inclusion and Exclusion Criteria
- Include verifiable papers with evaluated retrieval or long-context methods.
- Exclude unsupported commentary and studies without relevant evaluation.
## Comparison Dimensions
- method family, context strategy, benchmark, reported result, limitation
## Ranking and Grouping
- Group by method family and compare evidence strength without a composite ranking.
## Databases
- Semantic Scholar, arXiv, ACL Anthology
## Depth and Assumptions
- Targeted review; English-language evidence.
`;

const paperReport = `
# Literature Review: Retrieval and long-context methods for long-document QA
## Overview
The evidence set contrasts retrieval-augmented generation with evaluations of long-context behavior [Lewis et al., 2020; Liu et al., 2024; Bai et al., 2023].
## Terminology, Conceptual Distinctions & Field Boundaries
RAG retrieves external passages before generation, whereas long-context evaluation studies how models use supplied context.
## Significance & Upstream/Downstream Impact
Both method families affect evidence access and long-document question answering evaluation.
## Method & Coverage
The review used the approved targeted scope and screened scholarly sources recorded in the topic notes.
## Comparison Table
| Family | Evidence | Limitation |
| --- | --- | --- |
| Retrieval augmented | RAG formulation and evaluated tasks | Long-document comparison is incomplete |
| Long context | Position and benchmark evaluations | Cross-benchmark robustness is incomplete |
## Findings by Group
Retrieval and long-context approaches address different parts of evidence access and use.
## Cross-Cutting Themes
Evaluation design and position sensitivity complicate direct comparison.
## Gaps & Open Questions
| Question | Origin / Evidence | Disposition | Why Unresolved | Next Step |
| --- | --- | --- | --- | --- |
| How robust are results across long-document datasets? | final note | blocked/limitation | Evidence set is small | Independent evaluation |
## Limitations
The targeted evidence set is small and does not support exhaustive conclusions.
## References
- Lewis et al. 2020; Liu et al. 2024; Bai et al. 2023.
## Index of Topic Notes
- topics/methods/evidence.md
`;

const paperFinalNote = `
---
title: "Retrieval and long-context evidence"
tags: ["rag", "long-context"]
status: final
round: 1
---
# Retrieval and long-context evidence
## Summary
The eligible evidence describes retrieval-augmented generation and controlled evaluations of long-context behavior [Lewis et al., 2020; Liu et al., 2024; Bai et al., 2023].
## Search & Screening
Semantic Scholar, arXiv, and ACL Anthology were searched. Unsupported commentary was excluded.
## Key Findings
- RAG combines parametric generation with retrieved non-parametric memory [Lewis et al., 2020].
- Relevant information position affects long-context task performance in the reported evaluation [Liu et al., 2024].
- LongBench provides a bilingual multitask benchmark for long-context understanding [Bai et al., 2023].
## Comparison Data
| Dimension | Value | Evidence |
| --- | --- | --- |
| method family | retrieval augmented | Lewis et al., 2020 |
| context strategy | long supplied context | Liu et al., 2024 |
| benchmark | bilingual multitask | Bai et al., 2023 |
| limitation | direct cross-family comparison not reported | all three sources |
## Related Topics
- none
## Open Questions
- **Question:** How robust are comparisons across long-document datasets?
  - Evidence trigger: No common cross-family dataset is reported.
  - Why unresolved: The sources evaluate different settings.
  - Next search/action: Independent evaluation on shared datasets.
  - Scope status: in-scope
## Sources
- https://arxiv.org/abs/2005.11401
- https://arxiv.org/abs/2307.03172
- https://arxiv.org/abs/2308.14508
## References
- Lewis, P. et al. 2020. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. NeurIPS. https://arxiv.org/abs/2005.11401
- Liu, N. F. et al. 2024. Lost in the Middle: How Language Models Use Long Contexts. TACL. https://arxiv.org/abs/2307.03172
- Bai, Y. et al. 2023. LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding. arXiv. https://arxiv.org/abs/2308.14508
`;

function scaffoldPaperWorkspace(id, { limited = false, existingPaper = false } = {}) {
  write(`workspaces/${id}/SCOPE_ORIGINAL.md`, paperScope);
  write(`workspaces/${id}/SCOPE.md`, `${paperScope}\n## Scope Evolution Log\n- Round 1: no changes.`);
  write(`workspaces/${id}/TASKS.md`, `
# Tasks: Retrieval and long-context methods
## Round 1
### Pending
### Blocked
${limited ? "- [ ] topics/gaps/cross-dataset.md — evidence unavailable <!-- attempts: 2 -->" : ""}
## Completed
- [x] topics/methods/evidence.md — compare eligible evidence (round 1)
## Backlog
`);
  write(`workspaces/${id}/REPORT.md`, paperReport);
  write(`workspaces/${id}/topics/methods/evidence.md`, paperFinalNote);
  if (limited) {
    write(`workspaces/${id}/topics/gaps/unvalidated.md`, `
---
title: "Unvalidated claim"
tags: ["gap"]
status: draft
round: 1
---
# Unvalidated claim
## Summary
The fictional Zeta benchmark proves every retrieval method fails. This statement has no eligible source and must not enter the paper.
`);
  }
  write(`workspaces/${id}/.slr/state.json`, state({
    reviewId: id,
    topic: "Retrieval and long-context methods for long-document QA",
    stage: limited ? "completed_with_limitations" : "completed",
    scopeRevision: 1,
    currentRound: 1,
    maxRounds: 1,
    completionReason: limited ? "max_rounds" : "all_tasks_complete",
    updatedAt: "2026-09-17T06:00:00.000Z",
    roundMetrics: {
      round: 1,
      dispatched: 1,
      validatedNotes: 1,
      newEligibleSources: 3,
      acceptedNewTasks: limited ? 1 : 0,
      failedWorkers: 0,
    },
  }));
  mkdirSync(path.join(cwd, "workspaces", id, "assets"), { recursive: true });
  initGit(id, "final: complete literature review", "slr-complete");

  if (existingPaper) {
    write(`workspaces/${id}/paper/REVIEW_PAPER.md`, `
# Retrieval and Long-Context Methods: A Review
## Abstract
This draft synthesizes three eligible sources.
## Keywords
retrieval-augmented generation; long context; question answering
## 1. Introduction
The evidence concerns retrieval and long-context evaluation (Lewis et al., 2020).
## 2. Scope, Terminology and Conceptual Foundations
The scope contrasts retrieval with supplied-context use.
## 3. Review Methodology
The targeted review follows the recorded eligibility criteria.
## 4. Taxonomy / Research Landscape
The evidence separates retrieval-augmented and long-context families.
## 5. Thematic Evidence Synthesis
RAG combines generation with retrieval (Lewis et al., 2020).
## 6. Comparative Analysis
Direct comparison is limited.
## 7. Cross-Cutting Discussion
Evaluation design affects interpretation.
## 8. Challenges, Open Questions and Future Directions
Shared-dataset evaluation remains open.
## 9. Limitations
The evidence base is small.
## 10. Conclusion
The approaches are related but not interchangeable.
## References
- Lewis, P. et al. 2020. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. NeurIPS. https://arxiv.org/abs/2005.11401
`);
    const root = path.join(cwd, "workspaces", id);
    execFileSync("git", ["-C", root, "add", "paper/REVIEW_PAPER.md"], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "paper: generate review manuscript"], { stdio: "ignore" });
  }
}

function scaffoldUpdateWorkspace(id, { stage = "awaiting_scope_approval" } = {}) {
  scaffoldPaperWorkspace(id);
  const updateId = "update-001";
  write(`workspaces/${id}/updates/${updateId}/SCOPE_DRAFT.md`, `${paperScope}
## Update Identity
- Update ID: ${updateId}
- Baseline ref: slr-complete
## Changes from Previous Scope
### Added
- Evidence published after 2026-09-17.
### Modified
- None.
### Narrowed
- None.
### Unchanged
- Core research question and comparison dimensions.
## Incremental Search Lanes
### Freshness Lane
- Search 2026-09-18 through 2026-09-22.
### Scope-Delta Lane
- None.
### Backfill Policy
- No backfill unless an approved dimension is missing.
`);
  write(`workspaces/${id}/.slr/updates/${updateId}/state.json`, updateState({
    reviewId: id,
    stage,
  }));
  if (stage === "researching") {
    write(`workspaces/${id}/updates/${updateId}/SCOPE_APPROVED.md`, `${paperScope}
## Update Identity
- Update ID: ${updateId}
- Baseline ref: slr-complete
`);
    write(`workspaces/${id}/updates/${updateId}/EVIDENCE_BASELINE.json`, JSON.stringify({ schemaVersion: 1, reviewId: id, sourceCount: 3, sources: [] }, null, 2));
    write(`workspaces/${id}/updates/${updateId}/TASKS.md`, `# Update Tasks: ${updateId}
## Round 1
### Pending
- [ ] topics/updates/${updateId}/freshness.md — [freshness] find new evidence <!-- attempts: 0 -->
### Blocked
## Completed
## Backlog
`);
  }
  const root = path.join(cwd, "workspaces", id);
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", stage === "researching"
    ? `${updateId}-start: approve incremental scope and baseline`
    : `${updateId}-scope-draft-1`], { stdio: "ignore" });
  if (stage === "researching") execFileSync("git", ["-C", root, "tag", `${updateId}-start`], { stdio: "ignore" });
}

export function scaffold(kind) {
  if (kind === "ambiguous" || kind === "revision") {
    const id = "eval-ambiguous";
    write(`workspaces/${id}/SCOPE_DRAFT.md`, draft);
    write(`workspaces/${id}/.slr/state.json`, state({ reviewId: id, topic: "RAG for long-document question answering", stage: "awaiting_scope_approval" }));
    initGit(id, "scope-draft-1");
    return;
  }

  if (kind === "legacy-scope") {
    const id = "eval-legacy-scope";
    const legacyDraft = draft.replace(
      /\n## Review Configuration\n[\s\S]*?\n## Research Questions/,
      "\n## Research Questions",
    );
    write(`workspaces/${id}/SCOPE_DRAFT.md`, legacyDraft);
    write(`workspaces/${id}/.slr/state.json`, state({
      reviewId: id,
      topic: "Legacy scope awaiting approval",
      stage: "awaiting_scope_approval",
      maxRounds: 8,
    }));
    initGit(id, "scope-draft-1");
    return;
  }

  if (kind === "paper-ready") {
    scaffoldPaperWorkspace("eval-paper-ready");
    return;
  }

  if (kind === "paper-limited") {
    scaffoldPaperWorkspace("eval-paper-limited", { limited: true });
    return;
  }

  if (kind === "paper-revision") {
    scaffoldPaperWorkspace("eval-paper-revision", { existingPaper: true });
    return;
  }

  if (kind === "update-awaiting") {
    scaffoldUpdateWorkspace("eval-update-awaiting");
    return;
  }

  if (kind === "update-researching") {
    scaffoldUpdateWorkspace("eval-update-researching", { stage: "researching" });
    return;
  }

  if (kind === "status") {
    write("workspaces/eval-status/.slr/state.json", state({ reviewId: "eval-status", topic: "Efficient multimodal document understanding", language: "en", stage: "researching", scopeRevision: 2, currentRound: 2, updatedAt: "2026-09-17T01:00:00.000Z" }));
    return;
  }

  if (kind === "one-round") {
    const id = "eval-one-round";
    write(`workspaces/${id}/SCOPE_DRAFT.md`, draft.replace("Medium-depth review", "Focused one-round evaluation review"));
    write(`workspaces/${id}/.slr/state.json`, state({ reviewId: id, topic: "Retrieval-augmented generation for long-document QA", stage: "awaiting_scope_approval" }));
    initGit(id, "scope-draft-1");
    return;
  }

  if (kind === "collision") {
    write("workspaces/existing-review/.slr/state.json", state({ reviewId: "existing-review", topic: "existing review", language: "en", stage: "completed", currentRound: 1, completionReason: "all_tasks_complete", updatedAt: "2026-09-17T01:00:00.000Z" }));
    write("workspaces/existing-review/REPORT.md", "sentinel-do-not-overwrite");
    return;
  }

  if (kind === "multiple") {
    for (const id of ["review-alpha", "review-beta"]) {
      write(`workspaces/${id}/.slr/state.json`, state({ reviewId: id, topic: `${id} topic`, stage: "awaiting_scope_approval" }));
    }
    return;
  }

  if (kind === "partial-failure") {
    const id = "eval-partial-failure";
    write(`workspaces/${id}/TASKS.md`, `
# Tasks: Partial failure
## Round 1
### Pending
- [ ] topics/retry/failed-worker.md — retry failed worker task <!-- attempts: 1 -->
### Blocked
## Completed
- [x] topics/done/note-a.md — completed task A (round 1)
- [x] topics/done/note-b.md — completed task B (round 1)
## Backlog
`);
    write(`workspaces/${id}/.slr/state.json`, state({
      reviewId: id,
      topic: "Partial worker failure",
      stage: "researching",
      currentRound: 1,
      updatedAt: "2026-09-17T01:00:00.000Z",
      roundMetrics: { round: 1, dispatched: 3, validatedNotes: 2, newEligibleSources: 7, acceptedNewTasks: 0, failedWorkers: 1 },
    }));
    return;
  }

  if (kind === "saturation" || kind === "retry-exhausted") {
    const id = kind === "saturation" ? "eval-saturation" : "eval-retry-exhausted";
    write(`workspaces/${id}/SCOPE_ORIGINAL.md`, approvedScope);
    write(`workspaces/${id}/SCOPE.md`, approvedScope);
    const taskBody = kind === "saturation"
      ? `### Pending\n- [ ] topics/pending/low-yield.md — unresolved low-yield gap <!-- attempts: 0 -->\n### Blocked`
      : `### Pending\n### Blocked\n- [ ] topics/blocked/exhausted.md — failed twice: unavailable evidence <!-- attempts: 2 -->`;
    write(`workspaces/${id}/TASKS.md`, `
# Tasks: Evaluation topic
## Round 2
${taskBody}
## Completed
## Backlog
`);
    write(`workspaces/${id}/REPORT.md`, reportTemplate);
    write(`workspaces/${id}/.slr/state.json`, state({
      reviewId: id,
      topic: "Evaluation topic",
      language: "en",
      stage: "researching",
      currentRound: 2,
      consecutiveLowYieldRounds: kind === "saturation" ? 2 : 0,
      updatedAt: "2026-09-17T02:00:00.000Z",
      roundMetrics: { round: 2, dispatched: 1, validatedNotes: 0, newEligibleSources: 0, acceptedNewTasks: 0, failedWorkers: kind === "retry-exhausted" ? 1 : 0 },
    }));
    initGit(id, "round-2-review: checkpoint", "round-2");
    return;
  }

  if (kind === "max-rounds") {
    const id = "eval-max-rounds";
    write(`workspaces/${id}/SCOPE_ORIGINAL.md`, approvedScope);
    write(`workspaces/${id}/SCOPE.md`, approvedScope);
    write(`workspaces/${id}/TASKS.md`, `
# Tasks: Evaluation topic
## Round 5
### Pending
- [ ] topics/pending/unresolved.md — unresolved evidence gap <!-- attempts: 1 -->
### Blocked
## Completed
## Backlog
`);
    write(`workspaces/${id}/REPORT.md`, reportTemplate);
    mkdirSync(path.join(cwd, "workspaces", id, "topics", "pending"), { recursive: true });
    mkdirSync(path.join(cwd, "workspaces", id, "assets"), { recursive: true });
    write(`workspaces/${id}/.slr/state.json`, state({
      reviewId: id,
      topic: "Evaluation topic",
      language: "en",
      stage: "researching",
      currentRound: 5,
      maxRounds: 5,
      updatedAt: "2026-09-17T05:00:00.000Z",
      roundMetrics: { round: 5, dispatched: 1, validatedNotes: 0, newEligibleSources: 0, acceptedNewTasks: 0, failedWorkers: 1 },
    }));
    initGit(id, "round-5-review: unresolved gap", "round-5");
    return;
  }

  if (kind === "question-triage") {
    const id = "eval-question-triage";
    write(`workspaces/${id}/SCOPE_ORIGINAL.md`, approvedScope);
    write(`workspaces/${id}/SCOPE.md`, approvedScope);
    write(`workspaces/${id}/TASKS.md`, `
# Tasks: Evaluation topic
## Round 1
### Pending
- [ ] topics/methods/current-note.md — synthesize current evaluation evidence <!-- attempts: 0 -->
### Blocked
## Completed
## Backlog
`);
    write(`workspaces/${id}/REPORT.md`, reportTemplate);
    write(`workspaces/${id}/.slr/state.json`, state({
      reviewId: id,
      topic: "Evaluation topic",
      language: "English",
      stage: "researching",
      currentRound: 0,
      maxRounds: 1,
      updatedAt: "2026-09-17T03:00:00.000Z",
    }));
    mkdirSync(path.join(cwd, "workspaces", id, "topics", "methods"), { recursive: true });
    mkdirSync(path.join(cwd, "workspaces", id, "assets"), { recursive: true });
    initGit(id, "round-1-plan: assign evidence synthesis");
    write(`workspaces/${id}/topics/methods/current-note.md`, `
---
title: "Current evaluation evidence"
tags: ["evaluation", "methods"]
status: draft
round: 1
---
# Current evaluation evidence
## Summary
The eligible evidence leaves domain-shift robustness incompletely characterized [Liu et al., 2024; Bai et al., 2023; Lewis et al., 2020].
## Search & Screening
Searched Semantic Scholar and arXiv for evaluated methods; excluded opinion pieces.
## Key Findings
- Independent domain-shift robustness is not reported consistently across long-context and retrieval evaluations [Liu et al., 2024; Bai et al., 2023; Lewis et al., 2020].
## Comparison Data
| Dimension | Value | Evidence |
| --- | --- | --- |
| method | long-context position analysis | Liu et al., 2024 |
| evidence | controlled benchmark results | Liu et al., 2024 |
| limitation | independent domain-shift robustness not reported | Liu et al., 2024 |
## Related Topics
- none yet
## Open Questions
- **Question:** How robust is the method across datasets?
  - Evidence trigger: Cross-dataset results are not reported by the eligible study.
  - Why unresolved: Only one dataset is evaluated.
  - Next search/action: Search for independent evaluations on other datasets.
  - Scope status: in-scope
- **Question:** Does the study establish its reported headline result?
  - Evidence trigger: The result is reported with a complete ablation.
  - Why unresolved: It is not unresolved; the cited ablation answers it.
  - Next search/action: None.
  - Scope status: in-scope
- **Question:** Which GPU has the lowest purchase price?
  - Evidence trigger: No hardware procurement data appears in the review evidence.
  - Why unresolved: Hardware purchasing is outside the approved research question.
  - Next search/action: None within this review.
  - Scope status: out-of-scope
## Sources
- **Liu et al. 2024**
  - Paper: https://arxiv.org/abs/2307.03172
  - Project page: none
  - Code: none
  - Dataset: none
  - Notes: Used for the evaluation and limitation claims.
- **Bai et al. 2023**
  - Paper: https://arxiv.org/abs/2308.14508
  - Project page: none
  - Code: none
  - Dataset: none
  - Notes: Used to contrast coverage across long-context tasks.
- **Lewis et al. 2020**
  - Paper: https://arxiv.org/abs/2005.11401
  - Project page: none
  - Code: none
  - Dataset: none
  - Notes: Used to contrast retrieval-augmented evaluation evidence.
## References
- [Liu et al., 2024. Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
- [Bai et al., 2023. LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding](https://arxiv.org/abs/2308.14508)
- [Lewis et al., 2020. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
`);
    return;
  }

  if (kind === "blocked") {
    write("workspaces/eval-blocked/.slr/state.json", state({
      reviewId: "eval-blocked",
      topic: "Evidence synthesis under network failure",
      stage: "blocked",
      currentRound: 1,
      updatedAt: "2026-09-17T01:00:00.000Z",
      lastError: "All workers failed: network and scholarly search authentication unavailable",
      roundMetrics: { round: 1, dispatched: 3, validatedNotes: 0, newEligibleSources: 0, acceptedNewTasks: 0, failedWorkers: 3 },
    }));
    return;
  }

  throw new Error(`unknown fixture kind: ${kind}`);
}
