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

test("paper writer is isolated from research and source artifacts", () => {
  const agent = fs.readFileSync(path.join(root, "agents", "slr-paper-writer.md"), "utf8");
  const frontmatter = agent.split("---", 3)[1];
  const skill = fs.readFileSync(path.join(root, "skills", "paper", "SKILL.md"), "utf8");
  const template = fs.readFileSync(
    path.join(root, "skills", "paper", "references", "paper-template.md"),
    "utf8",
  );

  assert.match(frontmatter, /tools: Read, Glob, Grep, Write, Edit/);
  assert.match(frontmatter, /disallowedTools: WebSearch, WebFetch, Bash, PowerShell, Agent, Skill/);
  assert.match(agent, /including every topic note/);
  assert.match(agent, /Do not use general model memory/);
  assert.match(agent, /only the exact delegated `paper\/REVIEW_PAPER\.md`/);
  assert.match(skill, /independent of `\/slr-harness:review`/);
  assert.match(skill, /Only `completed` and `completed_with_limitations` are eligible/);
  assert.match(skill, /Do not change state/);
  assert.match(skill, /Create no tag/);
  assert.match(template, /Do not mention AI assistance or automated generation/);
});

test("paper template requires a complete scholarly manuscript", () => {
  const template = fs.readFileSync(
    path.join(root, "skills", "paper", "references", "paper-template.md"),
    "utf8",
  );
  const headings = [
    "## Abstract",
    "## Keywords",
    "## 1. Introduction",
    "## 2. Scope, Terminology and Conceptual Foundations",
    "## 3. Review Methodology",
    "## 4. Taxonomy / Research Landscape",
    "## 5. Thematic Evidence Synthesis",
    "## 6. Comparative Analysis",
    "## 7. Cross-Cutting Discussion",
    "## 8. Challenges, Open Questions and Future Directions",
    "## 9. Limitations",
    "## 10. Conclusion",
    "## References",
  ];
  let cursor = -1;
  for (const heading of headings) {
    const index = template.indexOf(heading);
    assert.ok(index > cursor, `${heading} must appear in order`);
    cursor = index;
  }
  assert.match(template, /Only notes whose frontmatter has `status: final`/);
  assert.match(template, /Every in-text citation must resolve to exactly one reference entry/);
  assert.match(template, /Do not claim PRISMA compliance/);
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
