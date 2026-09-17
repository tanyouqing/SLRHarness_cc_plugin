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
      language: overrides.language ?? "zh-CN",
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
