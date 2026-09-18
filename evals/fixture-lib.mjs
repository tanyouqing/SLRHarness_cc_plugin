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
- Semantic Scholar
## Depth and Assumptions
- Targeted review.
`;

const reportTemplate = `
# Literature Review: Evaluation topic
## Overview
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

export function scaffold(kind) {
  if (kind === "ambiguous" || kind === "revision") {
    const id = "eval-ambiguous";
    write(`workspaces/${id}/SCOPE_DRAFT.md`, draft);
    write(`workspaces/${id}/.slr/state.json`, state({ reviewId: id, topic: "RAG for long-document question answering", stage: "awaiting_scope_approval" }));
    initGit(id, "scope-draft-1");
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
