import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateHook } from "../scripts/guard-agent-actions.mjs";

function git(workspace, ...args) {
  return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" }).trim();
}

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    reviewId: "cwd-regression",
    topic: "CWD regression",
    language: "English",
    stage: "researching",
    scopeRevision: 1,
    currentRound: 0,
    maxRounds: 5,
    maxWorkers: 3,
    consecutiveLowYieldRounds: 0,
    retryLimit: 2,
    completionReason: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

function guarded(projectRoot, cwd, agent, tool, toolInput) {
  return evaluateHook({
    cwd,
    project_dir: projectRoot,
    agent_type: `slr-harness:${agent}`,
    tool_name: tool,
    tool_input: toolInput,
  });
}

test("workspace cwd stays flat and round tags land on review commits", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slr-round-regression-"));
  const workspace = path.join(projectRoot, "workspaces", "cwd-regression");
  const statePath = path.join(workspace, ".slr", "state.json");
  try {
    fs.mkdirSync(path.join(workspace, ".slr"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "topics"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "assets"), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state(), null, 2));
    fs.writeFileSync(path.join(workspace, "TASKS.md"), "# Tasks\n");
    fs.writeFileSync(path.join(workspace, "REPORT.md"), "# Report\n");

    git(workspace, "init", "-q");
    git(workspace, "config", "user.name", "SLR Test");
    git(workspace, "config", "user.email", "slr-test@example.invalid");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "round-1-plan: assign task");
    git(workspace, "tag", "round-1");

    const prematureTag = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag round-1`,
    });
    assert.equal(prematureTag.allowed, false);
    assert.match(prematureTag.reason, /round-1-review/);

    const noteTarget = path.join("topics", "note.md");
    const noteWrite = guarded(projectRoot, workspace, "slr-worker", "Write", {
      file_path: noteTarget,
      content: "# Note",
    });
    assert.equal(noteWrite.allowed, true);
    fs.writeFileSync(path.resolve(workspace, noteTarget), "# Note\n");

    const nestedWrite = guarded(projectRoot, workspace, "slr-worker", "Write", {
      file_path: path.join("workspaces", "cwd-regression", "topics", "nested.md"),
      content: "bad",
    });
    assert.equal(nestedWrite.allowed, false);
    assert.match(nestedWrite.reason, /duplicate workspace prefix/);
    assert.equal(fs.existsSync(path.join(workspace, "workspaces")), false);

    fs.writeFileSync(
      statePath,
      JSON.stringify(
        state({
          currentRound: 1,
          updatedAt: "2026-09-17T01:00:00.000Z",
          roundMetrics: {
            round: 1,
            dispatched: 1,
            validatedNotes: 1,
            newEligibleSources: 3,
            acceptedNewTasks: 0,
            failedWorkers: 0,
          },
        }),
        null,
        2,
      ),
    );
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "round-1-review: validate note");

    const repairTag = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag -f round-1 HEAD`,
    });
    assert.equal(repairTag.allowed, true, repairTag.reason);
    git(workspace, "tag", "-f", "round-1", "HEAD");
    assert.equal(git(workspace, "rev-list", "-n", "1", "round-1"), git(workspace, "rev-parse", "HEAD"));
    assert.match(git(workspace, "show", "-s", "--format=%s", "round-1"), /^round-1-review:/);

    const wrongRound = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag round-2`,
    });
    assert.equal(wrongRound.allowed, false);

    const earlyFinal = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag slr-complete`,
    });
    assert.equal(earlyFinal.allowed, false);

    fs.writeFileSync(
      statePath,
      JSON.stringify(
        state({
          stage: "completed_with_limitations",
          currentRound: 1,
          completionReason: "max_rounds",
          updatedAt: "2026-09-17T02:00:00.000Z",
          roundMetrics: {
            round: 1,
            dispatched: 1,
            validatedNotes: 1,
            newEligibleSources: 3,
            acceptedNewTasks: 0,
            failedWorkers: 0,
          },
        }),
        null,
        2,
      ),
    );
    git(workspace, "add", "-A");
    git(workspace, "commit", "-q", "-m", "final: complete literature review");
    const finalTag = guarded(projectRoot, workspace, "slr-manager", "Bash", {
      command: `git -C "${workspace}" tag slr-complete`,
    });
    assert.equal(finalTag.allowed, true, finalTag.reason);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
