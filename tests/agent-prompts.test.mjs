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
