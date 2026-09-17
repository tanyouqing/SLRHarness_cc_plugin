import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAGES = Object.freeze([
  "drafting_scope",
  "awaiting_scope_approval",
  "researching",
  "blocked",
  "completed",
  "completed_with_limitations",
]);

const TRANSITIONS = Object.freeze({
  drafting_scope: new Set(["drafting_scope", "awaiting_scope_approval"]),
  awaiting_scope_approval: new Set([
    "awaiting_scope_approval",
    "researching",
    "blocked",
  ]),
  researching: new Set([
    "researching",
    "blocked",
    "completed",
    "completed_with_limitations",
  ]),
  blocked: new Set(["blocked", "researching", "completed_with_limitations"]),
  completed: new Set(["completed"]),
  completed_with_limitations: new Set(["completed_with_limitations"]),
});

const REQUIRED_KEYS = [
  "schemaVersion",
  "reviewId",
  "topic",
  "language",
  "stage",
  "scopeRevision",
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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function validateState(state) {
  const errors = [];
  if (!isObject(state)) return ["state must be a JSON object"];

  for (const key of REQUIRED_KEYS) {
    if (!(key in state)) errors.push(`missing required key: ${key}`);
  }
  for (const key of Object.keys(state)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`unknown key: ${key}`);
  }

  if (state.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof state.reviewId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.reviewId)) {
    errors.push("reviewId must be a non-empty lowercase ASCII hyphenated slug");
  }
  if (typeof state.topic !== "string" || state.topic.trim() === "") {
    errors.push("topic must be a non-empty string");
  }
  if (typeof state.language !== "string" || state.language.trim() === "") {
    errors.push("language must be a non-empty string");
  }
  if (!STAGES.includes(state.stage)) errors.push(`invalid stage: ${state.stage}`);

  for (const key of ["scopeRevision", "currentRound", "consecutiveLowYieldRounds"]) {
    if (!isNonNegativeInteger(state[key])) errors.push(`${key} must be a non-negative integer`);
  }
  for (const key of ["maxRounds", "maxWorkers", "retryLimit"]) {
    if (!isPositiveInteger(state[key])) errors.push(`${key} must be a positive integer`);
  }
  if (
    state.completionReason !== null &&
    (typeof state.completionReason !== "string" || state.completionReason.trim() === "")
  ) {
    errors.push("completionReason must be null or a non-empty string");
  }
  if (!isIsoTimestamp(state.createdAt)) errors.push("createdAt must be an ISO-8601 timestamp");
  if (!isIsoTimestamp(state.updatedAt)) errors.push("updatedAt must be an ISO-8601 timestamp");
  if (isIsoTimestamp(state.createdAt) && isIsoTimestamp(state.updatedAt)) {
    if (Date.parse(state.updatedAt) < Date.parse(state.createdAt)) {
      errors.push("updatedAt must not precede createdAt");
    }
  }
  if (state.lastError !== undefined && (typeof state.lastError !== "string" || state.lastError.trim() === "")) {
    errors.push("lastError must be a non-empty string when present");
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
        "acceptedNewTasks",
        "failedWorkers",
      ]) {
        if (!isNonNegativeInteger(state.roundMetrics[key])) {
          errors.push(`roundMetrics.${key} must be a non-negative integer`);
        }
      }
      if (
        isNonNegativeInteger(state.roundMetrics.round) &&
        isNonNegativeInteger(state.currentRound) &&
        state.roundMetrics.round !== state.currentRound
      ) {
        errors.push("roundMetrics.round must equal currentRound");
      }
    }
  }

  if (state.stage === "awaiting_scope_approval" && state.scopeRevision < 1) {
    errors.push("awaiting_scope_approval requires scopeRevision >= 1");
  }
  if (
    ["researching", "blocked", "completed", "completed_with_limitations"].includes(state.stage) &&
    state.scopeRevision < 1
  ) {
    errors.push(`${state.stage} requires an approved scope revision`);
  }
  if (isNonNegativeInteger(state.currentRound) && isPositiveInteger(state.maxRounds) && state.currentRound > state.maxRounds) {
    errors.push("currentRound cannot exceed maxRounds");
  }
  if (state.stage === "blocked" && state.lastError === undefined) {
    errors.push("blocked stage requires lastError");
  }
  if (["completed", "completed_with_limitations"].includes(state.stage) && state.completionReason === null) {
    errors.push("terminal stages require completionReason");
  }

  return errors;
}

export function validateTransition(previous, next) {
  const errors = [
    ...validateState(previous).map((error) => `previous: ${error}`),
    ...validateState(next).map((error) => `next: ${error}`),
  ];
  if (errors.length > 0) return errors;

  if (!TRANSITIONS[previous.stage].has(next.stage)) {
    errors.push(`illegal stage transition: ${previous.stage} -> ${next.stage}`);
  }
  for (const key of ["schemaVersion", "reviewId", "topic", "createdAt"]) {
    if (previous[key] !== next[key]) errors.push(`${key} is immutable`);
  }
  if (next.scopeRevision < previous.scopeRevision) errors.push("scopeRevision cannot decrease");
  if (next.currentRound < previous.currentRound) errors.push("currentRound cannot decrease");
  if (next.currentRound > next.maxRounds) errors.push("currentRound cannot exceed maxRounds");
  if (next.stage === "researching" && previous.stage === "awaiting_scope_approval" && next.scopeRevision < 1) {
    errors.push("research cannot start without an approved scope revision");
  }
  return errors;
}

export function parseAndValidateState(text, previous = null) {
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    return { state: null, errors: [`invalid JSON: ${error.message}`] };
  }
  const errors = previous ? validateTransition(previous, state) : validateState(state);
  return { state, errors };
}

async function cli() {
  const [command, file] = process.argv.slice(2);
  if (command !== "validate" || !file) {
    console.error("Usage: node scripts/state.mjs validate <state.json>");
    process.exitCode = 2;
    return;
  }
  const absolute = path.resolve(file);
  const result = parseAndValidateState(fs.readFileSync(absolute, "utf8"));
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`valid state: ${absolute}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url).toLowerCase() === invokedPath.toLowerCase()) {
  await cli();
}
