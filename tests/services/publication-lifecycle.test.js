"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  EXCEPTION_STATES,
  LIFECYCLE_STATES,
  assertTransition,
  canTransition,
  knownState,
} = require("../../lib/stabilisation/publication-lifecycle");

test("publication lifecycle exposes every governed state", () => {
  assert.deepEqual(LIFECYCLE_STATES, [
    "DISCOVERED",
    "VERIFIED",
    "EDITORIALLY_APPROVED",
    "SCRIPT_READY",
    "ASSETS_CLEARED",
    "RENDERED",
    "QA_PASSED",
    "HUMAN_APPROVED",
    "SCHEDULED",
    "DISPATCH_STARTED",
    "PLATFORM_OBJECT_CREATED",
    "PLATFORM_CONFIRMED",
    "PUBLISHED",
    "ANALYTICS_PENDING",
    "ANALYTICS_COLLECTED",
  ]);
  assert.deepEqual(EXCEPTION_STATES, [
    "DISPATCH_FAILED_BEFORE_CREATE",
    "PLATFORM_CREATED_CONFIRMATION_FAILED",
    "PLATFORM_CREATED_METADATA_FAILED",
    "PUBLISHED_QA_INCIDENT",
    "RECONCILIATION_REQUIRED",
    "RETRACTED",
  ]);
  assert.equal(knownState("PUBLISHED"), true);
  assert.equal(knownState("unknown"), false);
});

test("canonical progress is adjacent and unsafe skips are refused", () => {
  assert.equal(canTransition("DISCOVERED", "VERIFIED"), true);
  assert.equal(canTransition("QA_PASSED", "HUMAN_APPROVED"), true);
  assert.equal(canTransition("QA_PASSED", "PUBLISHED"), false);
  assert.equal(canTransition("PUBLISHED", "PUBLISHED"), false);
  assert.throws(
    () => assertTransition("SCRIPT_READY", "PUBLISHED"),
    /invalid_publication_lifecycle_transition:SCRIPT_READY->PUBLISHED/,
  );
});

test("post-create uncertainty requires reconciliation and retraction is terminal", () => {
  assert.equal(
    canTransition(
      "PLATFORM_OBJECT_CREATED",
      "PLATFORM_CREATED_CONFIRMATION_FAILED",
    ),
    true,
  );
  assert.equal(
    canTransition(
      "PLATFORM_CREATED_CONFIRMATION_FAILED",
      "RECONCILIATION_REQUIRED",
    ),
    true,
  );
  assert.equal(canTransition("PUBLISHED", "PUBLISHED_QA_INCIDENT"), true);
  assert.equal(canTransition("PUBLISHED_QA_INCIDENT", "RETRACTED"), true);
  assert.equal(canTransition("RETRACTED", "PUBLISHED"), false);
});

test("analytics and published incident transitions are ordered and fail closed", () => {
  assert.equal(canTransition("PUBLISHED", "ANALYTICS_PENDING"), true);
  assert.equal(
    canTransition("ANALYTICS_PENDING", "ANALYTICS_COLLECTED"),
    true,
  );
  assert.equal(canTransition("PUBLISHED", "ANALYTICS_COLLECTED"), false);
  assert.equal(
    canTransition("ANALYTICS_COLLECTED", "PUBLISHED_QA_INCIDENT"),
    true,
  );
  assert.equal(
    canTransition("PUBLISHED_QA_INCIDENT", "ANALYTICS_PENDING"),
    false,
  );
  assert.equal(canTransition("ANALYTICS_PENDING", "RETRACTED"), true);
  assert.equal(canTransition("ANALYTICS_COLLECTED", "RETRACTED"), true);
});
