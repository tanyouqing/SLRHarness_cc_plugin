import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateHook } from "../scripts/guard-agent-actions.mjs";

const git = (workspace, ...args) => execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" }).trim();

function rootState() {
  return {
    schemaVersion: 1,
    reviewId: "incremental-review",
    topic: "Incremental review",
    language: "English",
    stage: "completed",
    scopeRevision: 1,
    currentRound: 1,
    maxRounds: 1,
    maxWorkers: 3,
    consecutiveLowYieldRounds: 0,
    retryLimit: 2,
    completionReason: "all_tasks_complete",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T01:00:00.000Z",
    roundMetrics: {
      round: 1,
      dispatched: 1,
      validatedNotes: 1,
      newEligibleSources: 2,
      acceptedNewTasks: 0,
      failedWorkers: 0,
    },
  };
}

function updateState(overrides = {}) {
  return {
    schemaVersion: 1,
    updateId: "update-001",
    reviewId: "incremental-review",
    baselineRef: "slr-complete",
    language: "English",
    stage: "researching",
    scopeRevision: 1,
    coverageStart: "2026-07-02",
    coverageEnd: "2026-09-22",
    currentRound: 0,
    maxRounds: 3,
    maxWorkers: 3,
    consecutiveLowYieldRounds: 0,
    retryLimit: 2,
    completionReason: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

function guarded(projectRoot, workspace, agent, tool, toolInput) {
  return evaluateHook({
    cwd: workspace,
    project_dir: projectRoot,
    agent_type: `slr-harness:${agent}`,
    tool_name: tool,
    tool_input: toolInput,
  });
}

test("incremental update isolates legacy evidence and verifies update tags", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slr-update-regression-"));
  const workspace = path.join(projectRoot, "workspaces", "incremental-review");
  const updateId = "update-001";
  const updateRoot = path.join(workspace, "updates", updateId);
  const updateStatePath = path.join(workspace, ".slr", "updates", updateId, "state.json");
  const legacyNote = path.join(workspace, "topics", "legacy.md");
  const updateNote = path.join(workspace, "topics", "updates", updateId, "new.md");
  try {
    fs.mkdirSync(path.dirname(updateStatePath), { recursive: true });
    fs.mkdirSync(path.dirname(updateNote), { recursive: true });
    fs.mkdirSync(path.join(workspace, "assets"), { recursive: true });
    fs.mkdirSync(updateRoot, { recursive: true });
    fs.writeFileSync(path.join(workspace, ".slr", "state.json"), JSON.stringify(rootState(), null, 2));
    fs.writeFileSync(path.join(workspace, "REPORT.md"), "# Original Report\n\nLegacy finding and reference.\n");
    fs.writeFileSync(path.join(workspace, "SCOPE_ORIGINAL.md"), "# Original Scope\n");
    fs.writeFileSync(path.join(workspace, "SCOPE.md"), "# Living Scope\n");
    fs.writeFileSync(path.join(workspace, "TASKS.md"), "# Original Tasks\n");
    fs.writeFileSync(legacyNote, "# Legacy Note\n");
    git(workspace, "init", "-q");
    git(workspace, "config", "user.name", "SLR Test");
    git(workspace, "config", "user.email", "slr-test@example.invalid");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "final: complete literature review");
    git(workspace, "tag", "slr-complete");
    const originalComplete = git(workspace, "rev-parse", "slr-complete");

    fs.writeFileSync(updateStatePath, JSON.stringify(updateState(), null, 2));
    fs.writeFileSync(path.join(updateRoot, "SCOPE_APPROVED.md"), "# Approved Update Scope\n");
    fs.writeFileSync(path.join(updateRoot, "EVIDENCE_BASELINE.json"), "{\"schemaVersion\":1,\"sources\":[]}\n");
    fs.writeFileSync(path.join(updateRoot, "TASKS.md"), "# Update Tasks\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", `${updateId}-start: approve incremental scope and baseline`);

    const startTag = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag ${updateId}-start`,
    });
    assert.equal(startTag.allowed, true, startTag.reason);
    git(workspace, "tag", `${updateId}-start`);

    const updateStateWrite = guarded(projectRoot, workspace, "slr-manager", "Write", {
      file_path: updateStatePath,
      content: JSON.stringify(updateState({ updatedAt: "2026-09-22T00:30:00.000Z" })),
    });
    assert.equal(updateStateWrite.allowed, true, updateStateWrite.reason);
    const updateStateEdit = guarded(projectRoot, workspace, "slr-manager", "Edit", {
      file_path: updateStatePath,
      old_string: "x",
      new_string: "y",
    });
    assert.equal(updateStateEdit.allowed, false);

    const oldWorkerWrite = guarded(projectRoot, workspace, "slr-worker", "Write", {
      file_path: legacyNote,
      content: "changed",
    });
    assert.equal(oldWorkerWrite.allowed, false);
    assert.match(oldWorkerWrite.reason, /incremental topics\/assets subtree/);

    const newWorkerWrite = guarded(projectRoot, workspace, "slr-worker", "Write", {
      file_path: updateNote,
      content: "# New Note",
    });
    assert.equal(newWorkerWrite.allowed, true, newWorkerWrite.reason);

    const rootStateWrite = guarded(projectRoot, workspace, "slr-manager", "Write", {
      file_path: path.join(workspace, ".slr", "state.json"),
      content: JSON.stringify(rootState()),
    });
    assert.equal(rootStateWrite.allowed, false);

    const approvedScopeWrite = guarded(projectRoot, workspace, "slr-manager", "Write", {
      file_path: path.join(updateRoot, "SCOPE_APPROVED.md"),
      content: "changed",
    });
    assert.equal(approvedScopeWrite.allowed, false);

    const reportReplacement = guarded(projectRoot, workspace, "slr-manager", "Write", {
      file_path: path.join(workspace, "REPORT.md"),
      content: "# Replacement\n",
    });
    assert.equal(reportReplacement.allowed, false);
    assert.match(reportReplacement.reason, /exact slr-complete report as its prefix/);

    const reportEdit = guarded(projectRoot, workspace, "slr-manager", "Edit", {
      file_path: path.join(workspace, "REPORT.md"),
      old_string: "Legacy finding",
      new_string: "Deleted finding",
    });
    assert.equal(reportEdit.allowed, false);

    const reportAppend = guarded(projectRoot, workspace, "slr-manager", "Write", {
      file_path: path.join(workspace, "REPORT.md"),
      content: "# Original Report\n\nLegacy finding and reference.\n\n## Evidence Updates\n",
    });
    assert.equal(reportAppend.allowed, true, reportAppend.reason);

    git(workspace, "commit", "--allow-empty", "-q", "-m", `${updateId}-round-1-plan: assign delta task`);
    const prematureRound = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag ${updateId}-round-1`,
    });
    assert.equal(prematureRound.allowed, false);
    const prematureComplete = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag ${updateId}-complete`,
    });
    assert.equal(prematureComplete.allowed, false);
    const moveOriginalComplete = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag -f slr-complete HEAD`,
    });
    assert.equal(moveOriginalComplete.allowed, false);

    const reviewedState = updateState({
      currentRound: 1,
      updatedAt: "2026-09-22T01:00:00.000Z",
      roundMetrics: {
        round: 1,
        dispatched: 1,
        validatedNotes: 1,
        newEligibleSources: 1,
        versionUpdates: 0,
        backfills: 0,
        acceptedNewTasks: 0,
        failedWorkers: 0,
      },
    });
    fs.writeFileSync(updateStatePath, JSON.stringify(reviewedState, null, 2));
    fs.writeFileSync(updateNote, "# New Note\n");
    fs.writeFileSync(path.join(workspace, "REPORT.md"), "# Original Report\n\nLegacy finding and reference.\n\n## Evidence Updates\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", `${updateId}-round-1-review: validate delta evidence`);
    const roundTag = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag ${updateId}-round-1`,
    });
    assert.equal(roundTag.allowed, true, roundTag.reason);
    git(workspace, "tag", `${updateId}-round-1`);

    fs.writeFileSync(updateStatePath, JSON.stringify({
      ...reviewedState,
      stage: "completed",
      completionReason: "all_tasks_complete",
      updatedAt: "2026-09-22T02:00:00.000Z",
    }, null, 2));
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", `${updateId}-final: complete incremental review`);
    const completeTag = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag ${updateId}-complete`,
    });
    assert.equal(completeTag.allowed, true, completeTag.reason);
    git(workspace, "tag", `${updateId}-complete`);
    assert.equal(git(workspace, "rev-parse", "slr-complete"), originalComplete);
    assert.equal(fs.readFileSync(legacyNote, "utf8"), "# Legacy Note\n");
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
