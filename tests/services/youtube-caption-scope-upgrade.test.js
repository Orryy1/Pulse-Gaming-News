"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  CALLBACK_TIMEOUT_MS,
  REQUIRED_SCOPES,
  hasRequiredScopes,
  resolveAttemptPaths,
} = require("../../tools/youtube-caption-scope-upgrade");

test("caption scope upgrade requires the complete fixed YouTube grant", () => {
  assert.equal(hasRequiredScopes(REQUIRED_SCOPES), true);
  assert.equal(
    hasRequiredScopes(
      REQUIRED_SCOPES.filter((scope) => !scope.endsWith("youtube.force-ssl")),
    ),
    false,
  );
  assert.equal(
    hasRequiredScopes("https://www.googleapis.com/auth/youtube.upload"),
    false,
  );
});

test("caption scope upgrade permits only fixed separately sealed ceremonies", () => {
  assert.equal(CALLBACK_TIMEOUT_MS, 30 * 60 * 1000);
  assert.match(
    resolveAttemptPaths([]).urlPath,
    /oauth-authorisation-url\.txt$/,
  );
  assert.match(
    resolveAttemptPaths(["--attempt", "2"]).urlPath,
    /oauth-authorisation-url-attempt-2\.txt$/,
  );
  assert.match(
    resolveAttemptPaths(["--attempt", "2"]).statusPath,
    /oauth-scope-upgrade-status-attempt-2\.json$/,
  );
  const displayPipeline = resolveAttemptPaths([
    "--campaign",
    "display-pipeline",
  ]);
  assert.equal(displayPipeline.attempt, "display-pipeline");
  assert.equal(
    displayPipeline.evidenceRoot,
    path.resolve(
      "D:/pulse-evidence/system-trace-display-pipeline-oauth-20260820",
    ),
  );
  assert.equal(
    displayPipeline.urlPath,
    path.join(displayPipeline.evidenceRoot, "oauth-authorisation-url.txt"),
  );
  assert.equal(
    displayPipeline.statusPath,
    path.join(displayPipeline.evidenceRoot, "oauth-scope-upgrade-status.json"),
  );
  assert.equal(
    displayPipeline.receiptPath,
    path.join(displayPipeline.evidenceRoot, "oauth-scope-upgrade-receipt.json"),
  );
  assert.throws(() => resolveAttemptPaths(["--attempt", "3"]), /usage/);
  assert.throws(
    () => resolveAttemptPaths(["--campaign", "anything-else"]),
    /usage/,
  );
});
