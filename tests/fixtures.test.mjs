import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateState } from "../scripts/state.mjs";
import { validateUpdateState } from "../scripts/update-state.mjs";

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
    "legacy-scope": "eval-legacy-scope",
    "paper-ready": "eval-paper-ready",
    "paper-limited": "eval-paper-limited",
    "paper-revision": "eval-paper-revision",
    "update-awaiting": "eval-update-awaiting",
    "update-researching": "eval-update-researching",
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

test("update fixtures contain valid independent update state", () => {
  for (const [kind, reviewId, stage] of [
    ["update-awaiting", "eval-update-awaiting", "awaiting_scope_approval"],
    ["update-researching", "eval-update-researching", "researching"],
  ]) {
    withFixture(kind, (directory) => {
      const update = JSON.parse(readFileSync(
        path.join(directory, "workspaces", reviewId, ".slr", "updates", "update-001", "state.json"),
        "utf8",
      ));
      assert.deepEqual(validateUpdateState(update), []);
      assert.equal(update.stage, stage);
      const root = JSON.parse(readFileSync(path.join(directory, "workspaces", reviewId, ".slr", "state.json"), "utf8"));
      assert.ok(["completed", "completed_with_limitations"].includes(root.stage));
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
  withFixture("legacy-scope", (directory) => {
    const root = path.join(directory, "workspaces", "eval-legacy-scope");
    const draft = readFileSync(path.join(root, "SCOPE_DRAFT.md"), "utf8");
    const state = JSON.parse(readFileSync(path.join(root, ".slr", "state.json"), "utf8"));
    assert.doesNotMatch(draft, /## Review Configuration/);
    assert.equal(state.maxRounds, 8);
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
  withFixture("paper-ready", (directory) => {
    const root = path.join(directory, "workspaces", "eval-paper-ready");
    const tagged = execFileSync("git", ["-C", root, "rev-list", "-n", "1", "slr-complete"], { encoding: "utf8" });
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
    assert.equal(tagged.trim(), head.trim());
    assert.ok(existsSync(path.join(root, "topics", "methods", "evidence.md")));
  });
  withFixture("paper-revision", (directory) => {
    const root = path.join(directory, "workspaces", "eval-paper-revision");
    const subject = execFileSync("git", ["-C", root, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    const tagged = execFileSync("git", ["-C", root, "rev-list", "-n", "1", "slr-complete"], { encoding: "utf8" });
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
    assert.equal(subject.trim(), "paper: generate review manuscript");
    assert.notEqual(tagged.trim(), head.trim());
  });
});
