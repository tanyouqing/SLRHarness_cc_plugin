import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG = Object.freeze({
  scoreVersion: 1,
  dimensions: {
    methodologicalRigor: { label: "Methodological rigor", group: "ess", weight: 0.35 },
    validationBreadth: { label: "Validation breadth", group: "ess", weight: 0.25 },
    reproducibility: { label: "Reproducibility", group: "ess", weight: 0.20 },
    transparency: { label: "Transparency", group: "ess", weight: 0.20 },
    scopeRelevance: { label: "Scope relevance", group: "rus", weight: 0.35 },
    contributionCentrality: { label: "Contribution centrality", group: "rus", weight: 0.25 },
    comparisonCompleteness: { label: "Comparison completeness", group: "rus", weight: 0.20 },
    objectiveFit: { label: "Objective fit", group: "rus", weight: 0.20 },
  },
  overallWeights: { ess: 0.45, rus: 0.55 },
  scale: { min: 0, max: 4, neutralImputation: 2 },
});

export const DIMENSIONS = DEFAULT_CONFIG.dimensions;

const NO_ELIGIBLE_MARKER = "No eligible evidence items; no scores computed.";

function roundOne(value) {
  return Math.round((value + 1e-9) * 10) / 10;
}

export function recommendationTier(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function scoreConfidence(record) {
  if (record.primarySourceVerified !== true) return "Low";
  const imputed = Object.values(record.scores ?? {}).filter((item) => item?.imputed === true).length;
  if (imputed <= 1) return "High";
  if (imputed <= 3) return "Medium";
  return "Low";
}

export function computeCompositeScores(scores, config = DEFAULT_CONFIG) {
  let essRaw = 0;
  let rusRaw = 0;
  for (const [key, contract] of Object.entries(config.dimensions)) {
    const value = Number(scores?.[key]?.score);
    if (contract.group === "ess") essRaw += value * contract.weight;
    else rusRaw += value * contract.weight;
  }
  const ess = roundOne(essRaw * 25);
  const rus = roundOne(rusRaw * 25);
  const ors = roundOne(config.overallWeights.ess * ess + config.overallWeights.rus * rus);
  return { ess, rus, ors };
}

function descendingNullable(left, right) {
  const a = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
  const b = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
  return b - a;
}

export function compareScoreRecords(left, right) {
  return (
    descendingNullable(left.ors, right.ors) ||
    descendingNullable(left.ess, right.ess) ||
    descendingNullable(left.publicationYear, right.publicationYear) ||
    descendingNullable(left.verifiedCitationCount, right.verifiedCitationCount) ||
    String(left.title ?? "").localeCompare(String(right.title ?? ""), "en")
  );
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sameScore(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) < 0.051;
}

export function validateRankingConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return ["ranking config must be one JSON object"];
  if (config.scoreVersion !== 1) errors.push("ranking config scoreVersion must be 1");
  if (!config.dimensions || typeof config.dimensions !== "object" || Array.isArray(config.dimensions)) {
    errors.push("ranking config dimensions must be an object");
  }
  const totals = { ess: 0, rus: 0 };
  const counts = { ess: 0, rus: 0 };
  for (const [key, item] of Object.entries(config.dimensions ?? {})) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key)) errors.push(`invalid dimension key: ${key}`);
    if (!nonEmpty(item?.label)) errors.push(`${key}.label must be non-empty`);
    if (!new Set(["ess", "rus"]).has(item?.group)) errors.push(`${key}.group must be ess or rus`);
    if (typeof item?.weight !== "number" || !Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 1) {
      errors.push(`${key}.weight must be greater than 0 and at most 1`);
    } else if (new Set(["ess", "rus"]).has(item.group)) {
      totals[item.group] += item.weight;
      counts[item.group] += 1;
    }
  }
  for (const group of ["ess", "rus"]) {
    if (counts[group] === 0) errors.push(`ranking config requires at least one ${group.toUpperCase()} dimension`);
    if (Math.abs(totals[group] - 1) > 1e-9) errors.push(`${group.toUpperCase()} dimension weights must sum to 1`);
  }
  const overall = config.overallWeights;
  if (
    !overall ||
    typeof overall.ess !== "number" ||
    typeof overall.rus !== "number" ||
    overall.ess <= 0 ||
    overall.rus <= 0 ||
    Math.abs(overall.ess + overall.rus - 1) > 1e-9
  ) {
    errors.push("overallWeights.ess and overallWeights.rus must be positive and sum to 1");
  }
  if (
    config.scale?.min !== 0 ||
    config.scale?.max !== 4 ||
    config.scale?.neutralImputation !== 2
  ) {
    errors.push("ranking scale must remain integer 0-4 with neutralImputation 2");
  }
  return errors;
}

export function parseRankingConfig(markdown) {
  const matches = [...markdown.matchAll(/```slr-ranking-config\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) {
    return { config: null, errors: ["scope must contain exactly one slr-ranking-config block"] };
  }
  try {
    const config = JSON.parse(matches[0][1]);
    return { config, errors: validateRankingConfig(config) };
  } catch (error) {
    return { config: null, errors: [`ranking config is invalid JSON: ${error.message}`] };
  }
}

export function validateScoreRecord(record, config = DEFAULT_CONFIG) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return ["score block must contain one JSON object"];
  }
  if (record.scoreVersion !== 1) errors.push("scoreVersion must be 1");
  if (!nonEmpty(record.sourceId)) errors.push("sourceId must be a non-empty string");
  if (!nonEmpty(record.title)) errors.push("title must be a non-empty string");
  if (record.role !== "eligible") errors.push("role must be eligible");
  if (!nonEmpty(record.evidenceTier)) errors.push("evidenceTier must be a non-empty string");
  if (
    record.publicationYear !== null &&
    (!Number.isInteger(record.publicationYear) || record.publicationYear < 1800 || record.publicationYear > 2200)
  ) {
    errors.push("publicationYear must be null or an integer from 1800 through 2200");
  }
  if (
    record.verifiedCitationCount !== null &&
    (!Number.isInteger(record.verifiedCitationCount) || record.verifiedCitationCount < 0)
  ) {
    errors.push("verifiedCitationCount must be null or a non-negative integer");
  }
  if (typeof record.primarySourceVerified !== "boolean") {
    errors.push("primarySourceVerified must be true or false");
  }
  if (!record.scores || typeof record.scores !== "object" || Array.isArray(record.scores)) {
    errors.push("scores must be an object");
  }

  for (const key of Object.keys(config.dimensions)) {
    const item = record.scores?.[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${key} is required`);
      continue;
    }
    if (!Number.isInteger(item.score) || item.score < 0 || item.score > 4) {
      errors.push(`${key}.score must be an integer from 0 through 4`);
    }
    if (typeof item.imputed !== "boolean") errors.push(`${key}.imputed must be true or false`);
    if (item.imputed === true && item.score !== config.scale.neutralImputation) {
      errors.push(`${key}: imputed dimensions must use the neutral score ${config.scale.neutralImputation}`);
    }
    if (!nonEmpty(item.evidence)) errors.push(`${key}.evidence must explain the evidence location or absence`);
    if (!nonEmpty(item.rationale)) errors.push(`${key}.rationale must explain the score`);
  }

  const extraDimensions = Object.keys(record.scores ?? {}).filter((key) => !(key in config.dimensions));
  if (extraDimensions.length > 0) errors.push(`unexpected score dimensions: ${extraDimensions.join(", ")}`);

  const computed = computeCompositeScores(record.scores, config);
  for (const key of ["ess", "rus", "ors"]) {
    if (Number.isFinite(Number(record[key])) && Math.abs(Number(record[key]) * 10 - Math.round(Number(record[key]) * 10)) > 1e-9) {
      errors.push(`${key} must use at most one decimal place`);
    }
    if (!sameScore(Number(record[key]), computed[key])) {
      errors.push(`${key} must equal ${computed[key].toFixed(1)}`);
    }
  }
  const expectedTier = recommendationTier(computed.ors);
  if (record.tier !== expectedTier) errors.push(`tier must be ${expectedTier}`);
  const expectedConfidence = scoreConfidence(record);
  if (record.confidence !== expectedConfidence) errors.push(`confidence must be ${expectedConfidence}`);
  if (record.provisional !== (expectedConfidence === "Low")) {
    errors.push(`provisional must be ${expectedConfidence === "Low"}`);
  }
  if (!nonEmpty(record.recommendationRationale)) {
    errors.push("recommendationRationale must be a non-empty string");
  }
  return errors;
}

export function parseScoreBlocks(markdown) {
  const records = [];
  const errors = [];
  const pattern = /```slr-score\s*\r?\n([\s\S]*?)\r?\n```/g;
  let match;
  let index = 0;
  while ((match = pattern.exec(markdown)) !== null) {
    index += 1;
    try {
      records.push(JSON.parse(match[1]));
    } catch (error) {
      errors.push(`score block ${index} is invalid JSON: ${error.message}`);
    }
  }
  return { records, errors };
}

export function validateRankingMarkdown(markdown, config = DEFAULT_CONFIG) {
  const errors = [];
  if (!/^## Ranking Scores\s*$/m.test(markdown)) errors.push("missing ## Ranking Scores section");
  const parsed = parseScoreBlocks(markdown);
  errors.push(...parsed.errors);
  if (parsed.records.length === 0) {
    if (!markdown.includes(NO_ELIGIBLE_MARKER)) {
      errors.push("no score blocks found; use the explicit no-eligible-evidence marker only when applicable");
    }
    return { records: [], errors };
  }
  if (markdown.includes(NO_ELIGIBLE_MARKER)) {
    errors.push("the no-eligible-evidence marker cannot appear with score blocks");
  }
  const sourceIds = new Set();
  for (const record of parsed.records) {
    const id = nonEmpty(record?.sourceId) ? record.sourceId.trim() : "<missing-sourceId>";
    if (sourceIds.has(id)) errors.push(`duplicate sourceId: ${id}`);
    sourceIds.add(id);
    errors.push(...validateScoreRecord(record, config).map((error) => `${id}: ${error}`));
  }
  return { records: parsed.records, errors };
}

function main(argv) {
  const configOnly = argv.length === 2 && argv[0] === "config";
  if (!(configOnly || argv.length === 2)) {
    console.error("usage: node validate-ranking-scores.mjs config <scope.md> | <approved-scope.md> <topic-note.md>");
    return 2;
  }
  const scopeFile = path.resolve(configOnly ? argv[1] : argv[0]);
  const noteFile = configOnly ? null : path.resolve(argv[1]);
  let scope;
  try {
    scope = fs.readFileSync(scopeFile, "utf8");
  } catch (error) {
    console.error(`${scopeFile}: cannot read scope: ${error.message}`);
    return 1;
  }
  const parsedConfig = parseRankingConfig(scope);
  if (parsedConfig.errors.length > 0) {
    for (const error of parsedConfig.errors) console.error(`${scopeFile}: ${error}`);
    return 1;
  }
  if (configOnly) {
    console.log(`validated ranking config in ${scopeFile}`);
    return 0;
  }
  let total = 0;
  const failures = [];
  let markdown;
  try {
    markdown = fs.readFileSync(noteFile, "utf8");
  } catch (error) {
    failures.push(`${noteFile}: cannot read note: ${error.message}`);
  }
  if (markdown !== undefined) {
    const result = validateRankingMarkdown(markdown, parsedConfig.config);
    total += result.records.length;
    failures.push(...result.errors.map((error) => `${noteFile}: ${error}`));
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    return 1;
  }
  console.log(`validated ${total} eligible evidence score record(s) in ${noteFile}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
