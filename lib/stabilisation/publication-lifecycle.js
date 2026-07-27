"use strict";

const LIFECYCLE_STATES = Object.freeze([
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

const EXCEPTION_STATES = Object.freeze([
  "DISPATCH_FAILED_BEFORE_CREATE",
  "PLATFORM_CREATED_CONFIRMATION_FAILED",
  "PLATFORM_CREATED_METADATA_FAILED",
  "PUBLISHED_QA_INCIDENT",
  "RECONCILIATION_REQUIRED",
  "RETRACTED",
]);

const transitions = new Map();

for (let index = 0; index < LIFECYCLE_STATES.length - 1; index += 1) {
  transitions.set(
    LIFECYCLE_STATES[index],
    new Set([LIFECYCLE_STATES[index + 1]]),
  );
}

function allow(from, ...to) {
  const allowed = transitions.get(from) || new Set();
  for (const state of to) allowed.add(state);
  transitions.set(from, allowed);
}

allow("DISPATCH_STARTED", "DISPATCH_FAILED_BEFORE_CREATE");
allow("DISPATCH_STARTED", "RECONCILIATION_REQUIRED");
allow(
  "PLATFORM_OBJECT_CREATED",
  "PLATFORM_CREATED_CONFIRMATION_FAILED",
  "PLATFORM_CREATED_METADATA_FAILED",
);
allow(
  "DISPATCH_FAILED_BEFORE_CREATE",
  "RECONCILIATION_REQUIRED",
  "SCHEDULED",
);
allow(
  "PLATFORM_CREATED_CONFIRMATION_FAILED",
  "RECONCILIATION_REQUIRED",
);
allow("PLATFORM_CREATED_METADATA_FAILED", "RECONCILIATION_REQUIRED");
allow(
  "RECONCILIATION_REQUIRED",
  "PLATFORM_CONFIRMED",
  "PUBLISHED",
  "RETRACTED",
);
allow("PUBLISHED", "PUBLISHED_QA_INCIDENT", "RETRACTED");
allow("PUBLISHED_QA_INCIDENT", "RECONCILIATION_REQUIRED", "RETRACTED");
allow("ANALYTICS_PENDING", "PUBLISHED_QA_INCIDENT", "RETRACTED");
allow("ANALYTICS_COLLECTED", "PUBLISHED_QA_INCIDENT", "RETRACTED");
transitions.set("RETRACTED", new Set());

function knownState(state) {
  return LIFECYCLE_STATES.includes(state) || EXCEPTION_STATES.includes(state);
}

function canTransition(from, to) {
  if (!knownState(from) || !knownState(to) || from === to) return false;
  return !!transitions.get(from)?.has(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(
      `invalid_publication_lifecycle_transition:${String(from)}->${String(to)}`,
    );
  }
  return { from, to, valid: true };
}

module.exports = {
  EXCEPTION_STATES,
  LIFECYCLE_STATES,
  assertTransition,
  canTransition,
  knownState,
};
