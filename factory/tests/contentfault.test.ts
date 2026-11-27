import { test } from "node:test";
import assert from "node:assert/strict";
import { isContentFault } from "../src/pipeline.ts";

test("a fact-check failure is a content fault, so it never pauses every lane", () => {
  assert.equal(isContentFault('fact-check still failing after a rewrite: Fact-check: "GameSpot\'s review called the gameplay very repetitive."'), true);
  assert.equal(isContentFault("QA failed: Frame 3 contains suggestive imagery"), true);
});

test("a real platform fault is not a content fault", () => {
  assert.equal(isContentFault("invalid_grant: Token has been expired or revoked"), false);
  assert.equal(isContentFault("quotaExceeded: The request cannot be completed"), false);
});
