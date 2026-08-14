"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CALLBACK_TIMEOUT_MS,
  REQUIRED_SCOPES,
  hasRequiredScopes,
  resolveAttemptPaths,
} = require("../../tools/youtube-caption-scope-upgrade");

test("caption scope upgrade requires the complete fixed YouTube grant", () => {
  assert.equal(hasRequiredScopes(REQUIRED_SCOPES), true);
  assert.equal(hasRequiredScopes(REQUIRED_SCOPES.filter((scope) => !scope.endsWith("youtube.force-ssl"))), false);
  assert.equal(hasRequiredScopes("https://www.googleapis.com/auth/youtube.upload"), false);
});

test("caption scope upgrade permits one separately sealed timeout renewal", () => {
  assert.equal(CALLBACK_TIMEOUT_MS, 30 * 60 * 1000);
  assert.match(resolveAttemptPaths([]).urlPath, /oauth-authorisation-url\.txt$/);
  assert.match(resolveAttemptPaths(["--attempt", "2"]).urlPath, /oauth-authorisation-url-attempt-2\.txt$/);
  assert.match(resolveAttemptPaths(["--attempt", "2"]).statusPath, /oauth-scope-upgrade-status-attempt-2\.json$/);
  assert.throws(() => resolveAttemptPaths(["--attempt", "3"]), /usage/);
});
