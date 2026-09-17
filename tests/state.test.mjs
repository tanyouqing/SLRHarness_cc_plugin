import assert from "node:assert/strict";
import test from "node:test";

import { parseAndValidateState, validateState, validateTransition } from "../scripts/state.mjs";

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    reviewId: "test-review",
    topic: "Test review",
    language: "English",
    stage: "drafting_scope",
    scopeRevision: 0,
    currentRound: 0,
    maxRounds: 5,
    maxWorkers: 3,
    consecutiveLowYieldRounds: 0,
    retryLimit: 2,
    completionReason: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

test("accepts the initial state", () => {
  assert.deepEqual(validateState(state()), []);
});

test("requires a revision before awaiting approval", () => {
  const errors = validateState(state({ stage: "awaiting_scope_approval" }));
  assert.match(errors.join("\n"), /scopeRevision >= 1/);
});

test("accepts approval transition into research", () => {
  const previous = state({ stage: "awaiting_scope_approval", scopeRevision: 2 });
  const next = state({
    stage: "researching",
    scopeRevision: 2,
    updatedAt: "2026-09-17T00:01:00.000Z",
  });
  assert.deepEqual(validateTransition(previous, next), []);
});

test("rejects research that skips approval", () => {
  const errors = validateTransition(state(), state({ stage: "researching", scopeRevision: 1 }));
  assert.match(errors.join("\n"), /illegal stage transition/);
});

test("terminal reviews cannot be reopened", () => {
  const previous = state({ stage: "completed", scopeRevision: 1, completionReason: "all_tasks_complete" });
  const next = state({
    stage: "researching",
    scopeRevision: 1,
    completionReason: null,
    updatedAt: "2026-09-17T00:02:00.000Z",
  });
  assert.match(validateTransition(previous, next).join("\n"), /illegal stage transition/);
});

test("round metrics must describe the current round", () => {
  const errors = validateState(
    state({
      stage: "researching",
      scopeRevision: 1,
      currentRound: 2,
      roundMetrics: {
        round: 1,
        dispatched: 3,
        validatedNotes: 2,
        newEligibleSources: 5,
        acceptedNewTasks: 0,
        failedWorkers: 1,
      },
    }),
  );
  assert.match(errors.join("\n"), /must equal currentRound/);
});

test("reports malformed JSON", () => {
  assert.match(parseAndValidateState("{").errors[0], /invalid JSON/);
});

test("rejects unknown fields in the fixed state schema", () => {
  assert.match(validateState(state({ extra: true })).join("; "), /unknown key: extra/);
});

test("formal stages require approved scope and bounded rounds", () => {
  assert.match(
    validateState(state({ stage: "researching", scopeRevision: 0 })).join("; "),
    /approved scope revision/,
  );
  assert.match(validateState(state({ currentRound: 6, maxRounds: 5 })).join("; "), /cannot exceed/);
  assert.match(validateState(state({ stage: "blocked" })).join("; "), /requires lastError/);
});
