import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateHook } from "../scripts/guard-agent-actions.mjs";

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "slr-guard-"));
  const workspace = path.join(cwd, "workspaces", "test-review");
  fs.mkdirSync(path.join(workspace, ".slr"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "topics"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "assets"), { recursive: true });
  return { cwd, workspace };
}

function hook({ cwd, projectRoot = cwd, agent = "slr-harness:slr-worker", tool = "Write", toolInput = {} }) {
  return evaluateHook({
    cwd,
    project_dir: projectRoot,
    agent_type: agent,
    tool_name: tool,
    tool_input: toolInput,
  });
}

function validState(overrides = {}) {
  return {
    schemaVersion: 1,
    reviewId: "test-review",
    topic: "Test review",
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

test("worker may write its topic note", () => {
  const { cwd, workspace } = fixture();
  const decision = hook({ cwd, toolInput: { file_path: path.join(workspace, "topics", "a.md"), content: "x" } });
  assert.equal(decision.allowed, true);
});

test("worker paths work from either the project root or review root", () => {
  const { cwd: projectRoot, workspace } = fixture();

  const projectRelative = hook({
    cwd: projectRoot,
    projectRoot,
    toolInput: { file_path: path.join("workspaces", "test-review", "topics", "project-relative.md"), content: "x" },
  });
  assert.equal(projectRelative.allowed, true);

  const reviewRelative = hook({
    cwd: workspace,
    projectRoot,
    toolInput: { file_path: path.join("topics", "review-relative.md"), content: "x" },
  });
  assert.equal(reviewRelative.allowed, true);

  const absolute = hook({
    cwd: workspace,
    projectRoot,
    toolInput: { file_path: path.join(workspace, "topics", "absolute.md"), content: "x" },
  });
  assert.equal(absolute.allowed, true);
});

test("manager control files work when cwd is the review root", () => {
  const { cwd: projectRoot, workspace } = fixture();
  const decision = hook({
    cwd: workspace,
    projectRoot,
    agent: "slr-harness:slr-manager",
    toolInput: { file_path: "REPORT.md", content: "# Report" },
  });
  assert.equal(decision.allowed, true);
});

test("project root is inferred from a workspace cwd when hook metadata is absent", () => {
  const { workspace } = fixture();
  const previous = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  try {
    const decision = evaluateHook({
      cwd: workspace,
      agent_type: "slr-harness:slr-worker",
      tool_name: "Write",
      tool_input: { file_path: path.join("topics", "inferred-root.md"), content: "x" },
    });
    assert.equal(decision.allowed, true);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = previous;
  }
});

test("duplicate workspace prefixes are denied from a review cwd", () => {
  const { cwd: projectRoot, workspace } = fixture();
  const decision = hook({
    cwd: workspace,
    projectRoot,
    toolInput: {
      file_path: path.join("workspaces", "test-review", "topics", "nested.md"),
      content: "x",
    },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /duplicate workspace prefix/);
});

test("worker may not write control files", () => {
  const { cwd, workspace } = fixture();
  const decision = hook({ cwd, toolInput: { file_path: path.join(workspace, "REPORT.md"), content: "x" } });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /topics\/ or assets/);
});

test("worker path traversal is denied", () => {
  const { cwd, workspace } = fixture();
  const decision = hook({
    cwd,
    toolInput: { file_path: path.join(workspace, "topics", "..", "..", "outside.md"), content: "x" },
  });
  assert.equal(decision.allowed, false);
});

test("scoper is read-only", () => {
  const { cwd, workspace } = fixture();
  const decision = hook({
    cwd,
    agent: "slr-harness:slr-scoper",
    toolInput: { file_path: path.join(workspace, "topics", "a.md"), content: "x" },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /read-only/);
});

test("non-plugin agents are unaffected", () => {
  const { cwd } = fixture();
  const decision = hook({
    cwd,
    agent: "other-plugin:worker",
    toolInput: { file_path: path.join(cwd, "anything.md"), content: "x" },
  });
  assert.equal(decision.allowed, true);
});

test("manager cannot modify the original scope", () => {
  const { cwd, workspace } = fixture();
  const decision = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Edit",
    toolInput: { file_path: path.join(workspace, "SCOPE_ORIGINAL.md") },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /immutable/);
});

test("manager state writes are schema checked", () => {
  const { cwd, workspace } = fixture();
  const statePath = path.join(workspace, ".slr", "state.json");
  const decision = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    toolInput: { file_path: statePath, content: JSON.stringify({ stage: "researching" }) },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /invalid state update/);
});

test("manager state writes must use Write and legal transitions", () => {
  const { cwd, workspace } = fixture();
  const statePath = path.join(workspace, ".slr", "state.json");
  fs.writeFileSync(statePath, JSON.stringify(validState()), "utf8");

  const editDecision = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Edit",
    toolInput: { file_path: statePath },
  });
  assert.equal(editDecision.allowed, false);

  const writeDecision = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    toolInput: {
      file_path: statePath,
      content: JSON.stringify(
        validState({
          stage: "completed",
          completionReason: "all_tasks_complete",
          updatedAt: "2026-09-17T00:03:00.000Z",
        }),
      ),
    },
  });
  assert.equal(writeDecision.allowed, true);
});

test("manager Git allowlist accepts status and rejects destructive commands", () => {
  const { cwd, workspace } = fixture();
  const status = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C \"${workspace}\" status --short` },
  });
  assert.equal(status.allowed, true);

  const checkpoint = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C "${workspace}" commit --allow-empty -m "round-2-plan: saturated"` },
  });
  assert.equal(checkpoint.allowed, true);

  const reset = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C \"${workspace}\" reset --hard` },
  });
  assert.equal(reset.allowed, false);

  const deleteTag = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C "${workspace}" tag -d round-1` },
  });
  assert.equal(deleteTag.allowed, false);

  const arbitraryForce = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C "${workspace}" tag -f round-1 HEAD~1` },
  });
  assert.equal(arbitraryForce.allowed, false);

  const amend = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C "${workspace}" commit --amend -m changed` },
  });
  assert.equal(amend.allowed, false);

  const outputFile = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C "${workspace}" diff --output=outside.patch` },
  });
  assert.equal(outputFile.allowed, false);
});

test("manager shell chaining is rejected", () => {
  const { cwd, workspace } = fixture();
  const decision = hook({
    cwd,
    agent: "slr-harness:slr-manager",
    tool: "Bash",
    toolInput: { command: `git -C \"${workspace}\" status && echo bad` },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /chaining/);
});
