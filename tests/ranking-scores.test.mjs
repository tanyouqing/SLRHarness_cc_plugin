import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CONFIG,
  compareScoreRecords,
  computeCompositeScores,
  parseRankingConfig,
  recommendationTier,
  scoreConfidence,
  validateRankingMarkdown,
  validateScoreRecord,
} from "../scripts/validate-ranking-scores.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function dimension(score = 3, { imputed = false } = {}) {
  return { score, imputed, evidence: "Primary paper, section 4", rationale: "Evidence-backed reason." };
}

function record(overrides = {}) {
  const scores = {
    methodologicalRigor: dimension(3),
    validationBreadth: dimension(2),
    reproducibility: dimension(4),
    transparency: dimension(3),
    scopeRelevance: dimension(4),
    contributionCentrality: dimension(3),
    comparisonCompleteness: dimension(2),
    objectiveFit: dimension(4),
    ...(overrides.scores ?? {}),
  };
  const computed = computeCompositeScores(scores);
  const base = {
    scoreVersion: 1,
    sourceId: "S1",
    title: "Example Work",
    role: "eligible",
    evidenceTier: "peer-reviewed",
    publicationYear: 2025,
    verifiedCitationCount: 10,
    primarySourceVerified: true,
    scores,
    ...computed,
    tier: recommendationTier(computed.ors),
    confidence: "High",
    provisional: false,
    recommendationRationale: "Directly relevant with strong reproducibility.",
  };
  return { ...base, ...overrides, scores };
}

function markdown(item) {
  return `# Note\n\n## Ranking Scores\n\n\`\`\`slr-score\n${JSON.stringify(item, null, 2)}\n\`\`\`\n`;
}

test("computes ESS, RUS, ORS, tier, and deterministic ordering values", () => {
  const item = record();
  assert.deepEqual(
    { ess: item.ess, rus: item.rus, ors: item.ors, tier: item.tier },
    { ess: 73.8, rus: 83.8, ors: 79.3, tier: "B" },
  );
  assert.equal(recommendationTier(80), "A");
  assert.equal(recommendationTier(65), "B");
  assert.equal(recommendationTier(50), "C");
  assert.equal(recommendationTier(49.9), "D");
});

test("sorts by ORS, ESS, year, verified citations, then title", () => {
  const base = record();
  const items = [
    { ...base, sourceId: "S4", title: "Beta", publicationYear: 2024, verifiedCitationCount: 20 },
    { ...base, sourceId: "S3", title: "Alpha", publicationYear: 2024, verifiedCitationCount: 20 },
    { ...base, sourceId: "S2", title: "Older", publicationYear: 2023, verifiedCitationCount: 100 },
    { ...base, sourceId: "S1", title: "Highest", ors: base.ors + 1 },
  ];
  items.sort(compareScoreRecords);
  assert.deepEqual(items.map((item) => item.sourceId), ["S1", "S3", "S4", "S2"]);
});

test("accepts neutral imputation and lowers confidence without omitting a score", () => {
  const scores = {
    methodologicalRigor: dimension(2, { imputed: true }),
    validationBreadth: dimension(2, { imputed: true }),
    reproducibility: dimension(2, { imputed: true }),
  };
  const item = record({ scores });
  const computed = computeCompositeScores(item.scores);
  Object.assign(item, computed, {
    tier: recommendationTier(computed.ors),
    confidence: "Medium",
  });
  assert.equal(scoreConfidence(item), "Medium");
  assert.deepEqual(validateScoreRecord(item), []);
});

test("unverified primary evidence forces Low provisional confidence but retains the composite", () => {
  const item = record({ primarySourceVerified: false, confidence: "Low", provisional: true });
  assert.deepEqual(validateScoreRecord(item), []);
  assert.equal(typeof item.ors, "number");
});

test("rejects missing dimensions, missing rationales, invalid ranges, and wrong formulas", () => {
  const item = record();
  delete item.scores.objectiveFit;
  item.scores.scopeRelevance = { score: 5, imputed: false, evidence: "x", rationale: "" };
  item.ors = 99;
  const errors = validateScoreRecord(item).join("; ");
  assert.match(errors, /objectiveFit is required/);
  assert.match(errors, /scopeRelevance\.score/);
  assert.match(errors, /scopeRelevance\.rationale/);
  assert.match(errors, /ors must equal/);
});

test("imputed dimensions must use the selected neutral score 2", () => {
  const item = record({
    scores: { methodologicalRigor: dimension(1, { imputed: true }) },
  });
  assert.match(validateScoreRecord(item).join("; "), /imputed dimensions must use the neutral score 2/);
});

test("accepts a verified explicit absence scored 0 when the reason is recorded", () => {
  const item = record({
    scores: {
      reproducibility: {
        score: 0,
        imputed: false,
        evidence: "The artifact statement explicitly says code and data are unavailable.",
        rationale: "Verified absence of reproducibility artifacts.",
      },
    },
  });
  const computed = computeCompositeScores(item.scores);
  Object.assign(item, computed, { tier: recommendationTier(computed.ors) });
  assert.deepEqual(validateScoreRecord(item), []);
});

test("validates machine-readable score blocks and explicit no-evidence notes", () => {
  const valid = validateRankingMarkdown(markdown(record()));
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.records.length, 1);

  const empty = validateRankingMarkdown(
    "# Note\n\n## Ranking Scores\n\nNo eligible evidence items; no scores computed.\n",
  );
  assert.deepEqual(empty.errors, []);

  const missing = validateRankingMarkdown("# Note\n\n## Ranking Scores\n");
  assert.match(missing.errors.join("; "), /no score blocks found/);
});

test("reads an approved custom rubric and validates scores against its weights", () => {
  const custom = {
    scoreVersion: 1,
    dimensions: {
      rigor: { label: "Rigor", group: "ess", weight: 1 },
      relevance: { label: "Relevance", group: "rus", weight: 1 },
    },
    overallWeights: { ess: 0.5, rus: 0.5 },
    scale: { min: 0, max: 4, neutralImputation: 2 },
  };
  const parsed = parseRankingConfig(`## Scoring rubric\n\n\`\`\`slr-ranking-config\n${JSON.stringify(custom)}\n\`\`\``);
  assert.deepEqual(parsed.errors, []);
  const scores = { rigor: dimension(4), relevance: dimension(2) };
  const computed = computeCompositeScores(scores, custom);
  const item = {
    scoreVersion: 1,
    sourceId: "S-custom",
    title: "Custom Rubric Work",
    role: "eligible",
    evidenceTier: "preprint",
    publicationYear: null,
    verifiedCitationCount: null,
    primarySourceVerified: true,
    scores,
    ...computed,
    tier: recommendationTier(computed.ors),
    confidence: "High",
    provisional: false,
    recommendationRationale: "Strong evidence but partial relevance.",
  };
  assert.deepEqual(validateScoreRecord(item, custom), []);
  assert.notDeepEqual(custom, DEFAULT_CONFIG);
});

test("rejects missing or malformed approved ranking configurations", () => {
  assert.match(parseRankingConfig("# Scope").errors.join("; "), /exactly one/);
  const invalid = {
    ...DEFAULT_CONFIG,
    dimensions: {
      ...DEFAULT_CONFIG.dimensions,
      methodologicalRigor: { ...DEFAULT_CONFIG.dimensions.methodologicalRigor, weight: 0.5 },
    },
  };
  assert.match(
    parseRankingConfig(`\`\`\`slr-ranking-config\n${JSON.stringify(invalid)}\n\`\`\``).errors.join("; "),
    /ESS dimension weights must sum to 1/,
  );
});

test("CLI validates a scope config before approval and then validates a note", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slr-ranking-"));
  const scope = path.join(directory, "SCOPE.md");
  const note = path.join(directory, "note.md");
  fs.writeFileSync(
    scope,
    `# Scope\n\n\`\`\`slr-ranking-config\n${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n\`\`\`\n`,
    "utf8",
  );
  fs.writeFileSync(note, markdown(record()), "utf8");
  const script = path.join(root, "scripts", "validate-ranking-scores.mjs");
  assert.match(execFileSync("node", [script, "config", scope], { encoding: "utf8" }), /validated ranking config/);
  assert.match(execFileSync("node", [script, scope, note], { encoding: "utf8" }), /validated 1 eligible/);
});
