import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateState } from "../scripts/state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.resolve(here, "../evals/fixture-runner.mjs");

function withFixture(kind, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "slr-eval-fixture-"));
  try {
    const result = spawnSync(process.execPath, [runner, kind], {
      cwd: directory,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("every generated fixture contains valid persisted state", () => {
  const expectations = {
    ambiguous: "eval-ambiguous",
    revision: "eval-ambiguous",
    status: "eval-status",
    "one-round": "eval-one-round",
    collision: "existing-review",
    "partial-failure": "eval-partial-failure",
    saturation: "eval-saturation",
    "retry-exhausted": "eval-retry-exhausted",
    "max-rounds": "eval-max-rounds",
    "question-triage": "eval-question-triage",
    blocked: "eval-blocked",
  };
  for (const [kind, reviewId] of Object.entries(expectations)) {
    withFixture(kind, (directory) => {
      const statePath = path.join(directory, "workspaces", reviewId, ".slr", "state.json");
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      assert.deepEqual(validateState(state), []);
    });
  }
});

test("multiple-active fixture creates two valid unfinished reviews", () => {
  withFixture("multiple", (directory) => {
    for (const reviewId of ["review-alpha", "review-beta"]) {
      const state = JSON.parse(
        readFileSync(path.join(directory, "workspaces", reviewId, ".slr", "state.json"), "utf8"),
      );
      assert.deepEqual(validateState(state), []);
      assert.equal(state.stage, "awaiting_scope_approval");
    }
  });
});

test("git-backed fixtures contain their expected checkpoints", () => {
  withFixture("ambiguous", (directory) => {
    const root = path.join(directory, "workspaces", "eval-ambiguous");
    const subject = execFileSync("git", ["-C", root, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    assert.equal(subject.trim(), "scope-draft-1");
  });
  withFixture("max-rounds", (directory) => {
    const root = path.join(directory, "workspaces", "eval-max-rounds");
    const tags = execFileSync("git", ["-C", root, "tag", "--list"], { encoding: "utf8" });
    assert.match(tags, /(?:^|\n)round-5(?:\n|$)/);
    assert.ok(existsSync(path.join(root, "TASKS.md")));
  });
  withFixture("question-triage", (directory) => {
    const root = path.join(directory, "workspaces", "eval-question-triage");
    const subject = execFileSync("git", ["-C", root, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    assert.equal(subject.trim(), "round-1-plan: assign evidence synthesis");
    const status = execFileSync("git", ["-C", root, "status", "--short", "--untracked-files=all"], { encoding: "utf8" });
    assert.match(status, /topics\/methods\/current-note\.md/);
  });
});
