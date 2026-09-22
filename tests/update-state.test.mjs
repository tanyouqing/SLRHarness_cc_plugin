import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAndValidateUpdateState,
  validateUpdateState,
  validateUpdateTransition,
} from "../scripts/update-state.mjs";

function state(overrides = {}) {
  return {
    schemaVersion: 1,
    updateId: "update-001",
    reviewId: "test-review",
    baselineRef: "slr-complete",
    language: "English",
    stage: "drafting_scope",
    scopeRevision: 0,
    coverageStart: "2026-07-01",
    coverageEnd: "2026-09-22",
    currentRound: 0,
    maxRounds: 3,
    maxWorkers: 3,
    consecutiveLowYieldRounds: 0,
    retryLimit: 2,
    completionReason: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

test("accepts an initial incremental update state", () => {
  assert.deepEqual(validateUpdateState(state()), []);
});

test("requires a scope revision before approval or research", () => {
  assert.match(validateUpdateState(state({ stage: "awaiting_scope_approval" })).join("; "), /scopeRevision/);
  assert.match(validateUpdateState(state({ stage: "researching" })).join("; "), /scopeRevision/);
});

test("allows scope configuration changes only before approval", () => {
  const draft = state({ stage: "awaiting_scope_approval", scopeRevision: 1 });
  const revised = state({
    stage: "awaiting_scope_approval",
    scopeRevision: 2,
    coverageStart: "2026-06-01",
    maxRounds: 5,
    updatedAt: "2026-09-22T01:00:00.000Z",
  });
  assert.deepEqual(validateUpdateTransition(draft, revised), []);

  const researching = { ...revised, stage: "researching", updatedAt: "2026-09-22T02:00:00.000Z" };
  const changed = { ...researching, maxRounds: 6, updatedAt: "2026-09-22T03:00:00.000Z" };
  assert.match(validateUpdateTransition(researching, changed).join("; "), /immutable after update-scope approval/);
});

test("terminal updates cannot be reopened and original identifiers are immutable", () => {
  const complete = state({
    stage: "completed",
    scopeRevision: 1,
    completionReason: "all_tasks_complete",
  });
  const reopened = { ...complete, stage: "researching", completionReason: null, updatedAt: "2026-09-22T01:00:00.000Z" };
  assert.match(validateUpdateTransition(complete, reopened).join("; "), /illegal stage transition/);
  assert.match(validateUpdateState(state({ updateId: "refresh-one" })).join("; "), /update-NNN/);
  assert.match(validateUpdateState(state({ baselineRef: "HEAD" })).join("; "), /baselineRef/);
});

test("a later update may use the previous completed update as its baseline", () => {
  assert.deepEqual(validateUpdateState(state({
    updateId: "update-002",
    baselineRef: "update-001-complete",
  })), []);
});

test("update metrics distinguish new sources, versions, and backfills", () => {
  const errors = validateUpdateState(state({
    stage: "researching",
    scopeRevision: 1,
    currentRound: 1,
    roundMetrics: {
      round: 1,
      dispatched: 3,
      validatedNotes: 3,
      newEligibleSources: 4,
      versionUpdates: 1,
      backfills: 2,
      acceptedNewTasks: 0,
      failedWorkers: 0,
    },
  }));
  assert.deepEqual(errors, []);
});

test("reports malformed update JSON", () => {
  assert.match(parseAndValidateUpdateState("{").errors[0], /invalid JSON/);
});

test("rejects impossible or descending coverage dates", () => {
  assert.match(validateUpdateState(state({ coverageStart: "2026-02-30" })).join("; "), /coverageStart/);
  assert.match(validateUpdateState(state({ coverageStart: "2026-10-01", coverageEnd: "2026-09-22" })).join("; "), /must not follow/);
});
