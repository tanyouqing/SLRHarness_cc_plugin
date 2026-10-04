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

test("update skill gates retrieval and preserves the longitudinal evidence base", () => {
  const skill = fs.readFileSync(path.join(root, "skills", "update", "SKILL.md"), "utf8");
  const workflow = fs.readFileSync(
    path.join(root, "skills", "update", "references", "workflow.md"),
    "utf8",
  );
  const schemas = fs.readFileSync(
    path.join(root, "skills", "update", "references", "update-schemas.md"),
    "utf8",
  );
  assert.match(skill, /first update request[\s\S]*Do not create files, search, or invoke any agent/);
  assert.match(skill, /explicit approval/);
  assert.match(workflow, /freshness reconnaissance/i);
  assert.match(workflow, /scope-delta reconnaissance/i);
  assert.match(workflow, /legacy-note change or\s+deletion blocks finalization/);
  assert.match(workflow, /Never create, delete, or move `slr-complete`/);
  assert.match(schemas, /EVIDENCE_BASELINE\.json/);
  assert.match(schemas, /Historical Evidence Outside Current Update Scope/);
});

test("agents distinguish update lanes and preserve legacy artifacts", () => {
  const manager = fs.readFileSync(path.join(root, "agents", "slr-manager.md"), "utf8");
  const worker = fs.readFileSync(path.join(root, "agents", "slr-worker.md"), "utf8");
  const scoper = fs.readFileSync(path.join(root, "agents", "slr-scoper.md"), "utf8");
  assert.match(manager, /baselineRef.*exact byte-for-byte prefix/s);
  assert.match(manager, /never modify.*pre-existing topic note/is);
  assert.match(worker, /new\s+source, version update, duplicate, or backfill/);
  assert.match(worker, /topics\/updates\/<update-id>/);
  assert.match(scoper, /Freshness reconnaissance/i);
  assert.match(scoper, /Scope-delta reconnaissance/i);
});

test("workers and managers require complete evidence-grounded recommendation scores", () => {
  const worker = fs.readFileSync(path.join(root, "agents", "slr-worker.md"), "utf8");
  const manager = fs.readFileSync(path.join(root, "agents", "slr-manager.md"), "utf8");
  const schema = fs.readFileSync(
    path.join(root, "skills", "review", "references", "workspace-schemas.md"),
    "utf8",
  );

  assert.match(worker, /one `slr-score` JSON block for every eligible evidence item/);
  assert.match(worker, /Use 2\/4 with `imputed: true`/);
  assert.match(manager, /validate-ranking-scores\.mjs/);
  assert.match(manager, /missing dimension, reason, eligible item/);
  assert.match(manager, /ESS, RUS, ORS, tier,[\s\S]*confidence/);
  assert.match(schema, /Recommendation Rationale/);
  assert.match(schema, /```slr-score/);
});

test("legacy updates backfill only core report works and preserve legacy notes", () => {
  const workflow = fs.readFileSync(
    path.join(root, "skills", "update", "references", "workflow.md"),
    "utf8",
  );
  const manager = fs.readFileSync(path.join(root, "agents", "slr-manager.md"), "utf8");
  assert.match(workflow, /Comparison Table or named as principal subjects in Findings by\s+Group/);
  assert.match(workflow, /Do not include works that appear only in References/);
  assert.match(manager, /new update notes, never legacy notes/);
  assert.match(manager, /Update Ranking Table/);
});
