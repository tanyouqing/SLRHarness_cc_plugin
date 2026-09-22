import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildEvidenceBaseline,
  normalizeTitle,
  normalizeUrl,
  verifyLegacyTopicHashes,
} from "../scripts/build-evidence-baseline.mjs";

test("normalizes titles and canonical URLs deterministically", () => {
  assert.equal(normalizeTitle("A Study: Of RAG (2024)"), "a study of rag");
  assert.equal(normalizeUrl("https://example.org/paper/?utm_source=test#section"), "https://example.org/paper");
});

test("baseline indexes only final notes and deduplicates DOI, arXiv, title, and URL", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "slr-baseline-"));
  try {
    fs.mkdirSync(path.join(workspace, "topics", "group"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "topics", "group", "final.md"), `---
status: final
---
# Final
## Sources
- https://arxiv.org/abs/2307.03172v2
## References
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
- Example, 2024. A DOI Work. https://doi.org/10.1234/Example.1
`, "utf8");
    fs.writeFileSync(path.join(workspace, "topics", "group", "draft.md"), `---
status: draft
---
## References
- [Must Not Appear](https://example.org/draft)
`, "utf8");
    fs.writeFileSync(path.join(workspace, "REPORT.md"), `# Report
## References
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
- Example, 2024. A DOI Work. https://doi.org/10.1234/example.1
- [A DOI Work](https://example.org/doi-work) DOI: 10.1234/example.1
`, "utf8");

    const baseline = buildEvidenceBaseline(workspace);
    assert.equal(baseline.reviewId, path.basename(workspace));
    assert.ok(baseline.sources.some((source) => source.key === "arxiv:2307.03172"));
    assert.ok(baseline.sources.some((source) => source.key === "doi:10.1234/example.1"));
    assert.equal(baseline.sourceCount, 2);
    assert.equal(baseline.sources.some((source) => source.reference.includes("Must Not Appear")), false);
    assert.match(baseline.topicHashes["topics/group/final.md"], /^[a-f0-9]{64}$/);
    assert.match(baseline.topicHashes["topics/group/draft.md"], /^[a-f0-9]{64}$/);
    const arxiv = baseline.sources.find((source) => source.key === "arxiv:2307.03172");
    assert.deepEqual(arxiv.sourceFiles.sort(), ["REPORT.md", "topics/group/final.md"]);
    assert.deepEqual(verifyLegacyTopicHashes(workspace, baseline), []);
    fs.writeFileSync(path.join(workspace, "topics", "group", "final.md"), "changed", "utf8");
    assert.match(verifyLegacyTopicHashes(workspace, baseline).join("; "), /legacy topic changed/);
    fs.rmSync(path.join(workspace, "topics", "group", "draft.md"));
    assert.match(verifyLegacyTopicHashes(workspace, baseline).join("; "), /legacy topic is missing/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
