import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["slr-scoper", "slr-worker"]) {
  test(`${name} receives the optional paper-search policy`, () => {
    const content = fs.readFileSync(path.join(root, "agents", `${name}.md`), "utf8");
    const frontmatter = content.split("---", 3)[1];

    assert.doesNotMatch(frontmatter, /\bBash\b/);
    assert.doesNotMatch(frontmatter, /\bPowerShell\b/);
    assert.match(content, /paper-search sources/);
    assert.match(content, /paper-search search/);
    assert.match(content, /never install the CLI/);
    assert.match(content, /Fall back immediately to WebSearch\/WebFetch/);
    assert.match(content, /absence alone\s+as a blocker/);
  });
}

test("manager remains isolated from paper-search and web research", () => {
  const content = fs.readFileSync(path.join(root, "agents", "slr-manager.md"), "utf8");
  assert.doesNotMatch(content, /paper-search/);
  assert.match(content, /disallowedTools: WebSearch, WebFetch, Agent, Skill/);
});

test("report framing sections are evidence-backed and maintained by the manager", () => {
  const schema = fs.readFileSync(
    path.join(root, "skills", "review", "references", "workspace-schemas.md"),
    "utf8",
  );
  const manager = fs.readFileSync(path.join(root, "agents", "slr-manager.md"), "utf8");

  const overview = schema.indexOf("## Overview");
  const terminology = schema.indexOf("## Terminology, Conceptual Distinctions & Field Boundaries");
  const significance = schema.indexOf("## Significance & Upstream/Downstream Impact");
  const method = schema.indexOf("## Method & Coverage");

  assert.ok(overview < terminology && terminology < significance && significance < method);
  assert.match(schema, /Operational Definition/);
  assert.match(schema, /Impact Mechanism/);
  assert.match(schema, /Evidence Strength/);
  assert.match(manager, /scope conventions as literature\s+consensus/);
  assert.match(manager, /do not use general model knowledge/);
  assert.match(manager, /Never promote an unverified\s+scope assumption into a finding/);
});
