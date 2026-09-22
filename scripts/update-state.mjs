import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATE_STAGES = Object.freeze([
  "drafting_scope",
  "awaiting_scope_approval",
  "researching",
  "blocked",
  "completed",
  "completed_with_limitations",
]);

const TERMINAL = new Set(["completed", "completed_with_limitations"]);
const TRANSITIONS = Object.freeze({
  drafting_scope: new Set(["drafting_scope", "awaiting_scope_approval"]),
  awaiting_scope_approval: new Set(["awaiting_scope_approval", "researching", "blocked"]),
  researching: new Set(["researching", "blocked", "completed", "completed_with_limitations"]),
  blocked: new Set(["blocked", "researching", "completed_with_limitations"]),
  completed: new Set(["completed"]),
  completed_with_limitations: new Set(["completed_with_limitations"]),
});

const REQUIRED_KEYS = [
  "schemaVersion",
  "updateId",
  "reviewId",
  "baselineRef",
  "language",
  "stage",
  "scopeRevision",
  "coverageStart",
  "coverageEnd",
  "currentRound",
  "maxRounds",
  "maxWorkers",
  "consecutiveLowYieldRounds",
  "retryLimit",
  "completionReason",
  "createdAt",
  "updatedAt",
];
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, "lastError", "roundMetrics"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isIsoTimestamp = (value) => typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
function isDate(value) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateUpdateState(state) {
  const errors = [];
  if (!isObject(state)) return ["update state must be a JSON object"];

  for (const key of REQUIRED_KEYS) if (!(key in state)) errors.push(`missing required key: ${key}`);
  for (const key of Object.keys(state)) if (!ALLOWED_KEYS.has(key)) errors.push(`unknown key: ${key}`);

  if (state.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof state.updateId !== "string" || !/^update-\d{3}$/.test(state.updateId)) {
    errors.push("updateId must match update-NNN");
  }
  if (typeof state.reviewId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.reviewId)) {
    errors.push("reviewId must be a lowercase ASCII hyphenated slug");
  }
  if (
    typeof state.baselineRef !== "string" ||
    !/^(?:slr-complete|update-\d{3}-complete)$/.test(state.baselineRef)
  ) {
    errors.push("baselineRef must be slr-complete or update-NNN-complete");
  }
  if (typeof state.language !== "string" || state.language.trim() === "") errors.push("language must be non-empty");
  if (!UPDATE_STAGES.includes(state.stage)) errors.push(`invalid stage: ${state.stage}`);
  if (!isDate(state.coverageStart)) errors.push("coverageStart must be YYYY-MM-DD");
  if (!isDate(state.coverageEnd)) errors.push("coverageEnd must be YYYY-MM-DD");
  if (isDate(state.coverageStart) && isDate(state.coverageEnd) && state.coverageStart > state.coverageEnd) {
    errors.push("coverageStart must not follow coverageEnd");
  }

  for (const key of ["scopeRevision", "currentRound", "consecutiveLowYieldRounds"]) {
    if (!isNonNegativeInteger(state[key])) errors.push(`${key} must be a non-negative integer`);
  }
  for (const key of ["maxRounds", "maxWorkers", "retryLimit"]) {
    if (!isPositiveInteger(state[key])) errors.push(`${key} must be a positive integer`);
  }
  if (state.completionReason !== null && (typeof state.completionReason !== "string" || state.completionReason.trim() === "")) {
    errors.push("completionReason must be null or a non-empty string");
  }
  if (!isIsoTimestamp(state.createdAt)) errors.push("createdAt must be an ISO-8601 timestamp");
  if (!isIsoTimestamp(state.updatedAt)) errors.push("updatedAt must be an ISO-8601 timestamp");
  if (isIsoTimestamp(state.createdAt) && isIsoTimestamp(state.updatedAt) && Date.parse(state.updatedAt) < Date.parse(state.createdAt)) {
    errors.push("updatedAt must not precede createdAt");
  }
  if (state.lastError !== undefined && (typeof state.lastError !== "string" || state.lastError.trim() === "")) {
    errors.push("lastError must be non-empty when present");
  }

  if (state.roundMetrics !== undefined) {
    if (!isObject(state.roundMetrics)) {
      errors.push("roundMetrics must be an object when present");
    } else {
      for (const key of [
        "round",
        "dispatched",
        "validatedNotes",
        "newEligibleSources",
        "versionUpdates",
        "backfills",
        "acceptedNewTasks",
        "failedWorkers",
      ]) {
        if (!isNonNegativeInteger(state.roundMetrics[key])) errors.push(`roundMetrics.${key} must be a non-negative integer`);
      }
      if (isNonNegativeInteger(state.roundMetrics.round) && state.roundMetrics.round !== state.currentRound) {
        errors.push("roundMetrics.round must equal currentRound");
      }
    }
  }

  if (["awaiting_scope_approval", "researching", "blocked", ...TERMINAL].includes(state.stage) && state.scopeRevision < 1) {
    errors.push(`${state.stage} requires scopeRevision >= 1`);
  }
  if (state.currentRound > state.maxRounds) errors.push("currentRound cannot exceed maxRounds");
  if (state.stage === "blocked" && state.lastError === undefined) errors.push("blocked stage requires lastError");
  if (TERMINAL.has(state.stage) && state.completionReason === null) errors.push("terminal stages require completionReason");
  return errors;
}

export function validateUpdateTransition(previous, next) {
  const errors = [
    ...validateUpdateState(previous).map((error) => `previous: ${error}`),
    ...validateUpdateState(next).map((error) => `next: ${error}`),
  ];
  if (errors.length > 0) return errors;
  if (!TRANSITIONS[previous.stage].has(next.stage)) errors.push(`illegal stage transition: ${previous.stage} -> ${next.stage}`);
  for (const key of ["schemaVersion", "updateId", "reviewId", "baselineRef", "language", "createdAt"]) {
    if (previous[key] !== next[key]) errors.push(`${key} is immutable`);
  }
  if (next.scopeRevision < previous.scopeRevision) errors.push("scopeRevision cannot decrease");
  if (next.currentRound < previous.currentRound) errors.push("currentRound cannot decrease");
  if (next.currentRound > next.maxRounds) errors.push("currentRound cannot exceed maxRounds");
  if (!new Set(["drafting_scope", "awaiting_scope_approval"]).has(previous.stage)) {
    for (const key of ["coverageStart", "coverageEnd", "maxRounds", "maxWorkers", "retryLimit"]) {
      if (previous[key] !== next[key]) errors.push(`${key} is immutable after update-scope approval`);
    }
  }
  return errors;
}

export function parseAndValidateUpdateState(text, previous = null) {
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    return { state: null, errors: [`invalid JSON: ${error.message}`] };
  }
  return {
    state,
    errors: previous ? validateUpdateTransition(previous, state) : validateUpdateState(state),
  };
}

async function cli() {
  const [command, file] = process.argv.slice(2);
  if (command !== "validate" || !file) {
    console.error("Usage: node scripts/update-state.mjs validate <state.json>");
    process.exitCode = 2;
    return;
  }
  const result = parseAndValidateUpdateState(fs.readFileSync(path.resolve(file), "utf8"));
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url).toLowerCase() === invokedPath.toLowerCase()) await cli();
