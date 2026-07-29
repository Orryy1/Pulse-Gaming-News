"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createYoutubeAuthTelemetry,
  normaliseYoutubeAuthTelemetry,
  sanitiseYoutubeError,
  sanitiseYoutubeErrorMessage,
} = require("../../lib/services/youtube-safety");

test("YouTube error sanitisation removes every supported credential form", () => {
  const unsafe =
    "401 Bearer bearer-secret access_token=access-secret " +
    "refresh_token=refresh-secret client_secret=client-secret " +
    "api_key=api-secret&next=1";
  const safe = sanitiseYoutubeErrorMessage(unsafe);

  for (const secret of [
    "bearer-secret",
    "access-secret",
    "refresh-secret",
    "client-secret",
    "api-secret",
  ]) {
    assert.equal(safe.includes(secret), false, secret);
  }
  assert.match(safe, /\[REDACTED\]/);
});

test("sanitised YouTube errors retain control-flow identity but no secret payload", () => {
  class BoundaryError extends Error {}
  const error = new BoundaryError(
    "request rejected: Bearer bearer-secret refresh_token=refresh-secret",
  );
  error.code = "youtube_request_failed";
  error.response = { data: { access_token: "access-secret" } };

  const safe = sanitiseYoutubeError(error);

  assert.equal(safe, error);
  assert.ok(safe instanceof BoundaryError);
  assert.equal(safe.code, "youtube_request_failed");
  assert.equal(safe.message.includes("bearer-secret"), false);
  assert.equal(safe.message.includes("refresh-secret"), false);
  assert.equal(safe.response, undefined);
});

test("YouTube auth telemetry is whitelist-only and distinguishes durable mutation from ephemeral refresh", () => {
  const initial = createYoutubeAuthTelemetry();
  assert.deepEqual(initial, {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  });

  const normalised = normaliseYoutubeAuthTelemetry({
    ...initial,
    access_token: "must-not-survive",
    refresh_token: "must-not-survive",
    ephemeral_access_token_refresh: {
      attempted: true,
      succeeded: false,
      failed: true,
      error: "must-not-survive",
    },
  });
  assert.deepEqual(normalised, {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: true,
      succeeded: false,
      failed: true,
    },
  });
});
