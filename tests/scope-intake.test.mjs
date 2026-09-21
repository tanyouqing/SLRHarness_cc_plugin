import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("new reviews resolve one batched intake before workspace creation", () => {
  const skill = read("skills", "review", "SKILL.md");
  const workflow = read("skills", "review", "references", "workflow.md");

  assert.match(skill, /four review\s+configuration items/);
  assert.match(workflow, /one `AskUserQuestion` call containing all missing\s+questions/);
  assert.match(workflow, /Do not ask again for a choice already explicit/);
  assert.match(workflow, /Do not create a\s+workspace, write state, or launch a scoper until all four choices are resolved/);
  assert.match(workflow, /Configuration answers do not count as scope approval/);
});

test("intake defaults and scope contract are complete", () => {
  const workflow = read("skills", "review", "references", "workflow.md");
  const scoping = read("skills", "review", "references", "scoping.md");

  for (const phrase of [
    "landscape mapping",
    "Maximum rounds",
    "academic plus authoritative grey literature",
    "scoper-recommended",
  ]) {
    assert.match(workflow, new RegExp(phrase, "i"));
  }
  assert.match(scoping, /## Review Configuration/);
  assert.match(scoping, /Maximum research rounds: <positive integer>/);
  assert.match(scoping, /It controls orchestration, not review depth/);
  assert.match(scoping, /evidence-tier labeling/);
  assert.match(scoping, /must equal state\s+`maxRounds`/);
});

test("approved configuration is frozen while source provenance remains explicit", () => {
  const manager = read("agents", "slr-manager.md");
  const worker = read("agents", "slr-worker.md");
  const scoper = read("agents", "slr-scoper.md");

  assert.match(manager, /Treat `Review Configuration` and output language as frozen/);
  assert.match(worker, /source type, provenance, and evidence\s+tier/);
  assert.match(worker, /academic-only coverage/);
  assert.match(scoper, /primary objective, source-coverage mode, and time strategy/);
  assert.match(scoper, /Never treat an informal web source as\s+equivalent to peer-reviewed evidence/);
});

test("legacy drafts receive a compatibility revision without migrating research", () => {
  const workflow = read("skills", "review", "references", "workflow.md");
  assert.match(workflow, /legacy workspace at `awaiting_scope_approval`/);
  assert.match(workflow, /create and commit one\s+compatibility scope revision, and ask for approval again/);
  assert.match(workflow, /Do not migrate workspaces\s+that are already researching or terminal/);
});
