"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFacebookGraphError,
  normaliseFacebookGraphError,
} = require("../../lib/platforms/facebook-graph-error");

function graphFailure({ status = 400, error = {} } = {}) {
  const failure = new Error("Request failed with status code 400");
  failure.response = {
    status,
    data: {
      error: {
        message: "The video could not be processed",
        type: "OAuthException",
        code: 352,
        error_subcode: 1363026,
        is_transient: false,
        error_user_title: "Video upload failed",
        error_user_msg: "Use a supported MP4 and try again.",
        fbtrace_id: "TRACE-123",
        ...error,
      },
    },
    config: {
      headers: { Authorization: "OAuth SECRET_TOKEN" },
    },
  };
  return failure;
}

test("normaliseFacebookGraphError preserves actionable Graph fields without response secrets", () => {
  const details = normaliseFacebookGraphError(graphFailure(), {
    stage: "reel_binary_upload",
  });

  assert.deepEqual(details, {
    platform: "facebook",
    stage: "reel_binary_upload",
    http_status: 400,
    type: "OAuthException",
    code: 352,
    subcode: 1363026,
    transient: false,
    message: "The video could not be processed",
    user_title: "Video upload failed",
    user_message: "Use a supported MP4 and try again.",
    trace_id: "TRACE-123",
  });
  assert.doesNotMatch(JSON.stringify(details), /SECRET_TOKEN/);
});

test("buildFacebookGraphError makes terminal Graph 400s non-retriable and stage-specific", () => {
  const wrapped = buildFacebookGraphError(graphFailure(), {
    stage: "reel_finish",
  });

  assert.equal(wrapped.name, "FacebookGraphApiError");
  assert.equal(wrapped.retriable, false);
  assert.equal(wrapped.graph.code, 352);
  assert.equal(wrapped.networkAttempted, true);
  assert.match(wrapped.message, /Facebook Graph reel_finish failed/);
  assert.match(wrapped.message, /HTTP 400/);
  assert.match(wrapped.message, /code=352/);
  assert.match(wrapped.message, /subcode=1363026/);
  assert.match(wrapped.message, /Video upload failed/);
  assert.doesNotMatch(wrapped.message, /SECRET_TOKEN/);
});

test("buildFacebookGraphError keeps transient Graph errors retriable", () => {
  const wrapped = buildFacebookGraphError(
    graphFailure({
      status: 503,
      error: { code: 2, error_subcode: undefined, is_transient: true },
    }),
    { stage: "reel_start" },
  );

  assert.equal(wrapped.retriable, true);
  assert.match(wrapped.message, /transient=true/);
});

test("buildFacebookGraphError classifies rate limits as retriable even without is_transient", () => {
  const wrapped = buildFacebookGraphError(
    graphFailure({
      status: 429,
      error: { code: 4, is_transient: undefined },
    }),
    { stage: "reel_status" },
  );

  assert.equal(wrapped.retriable, true);
});
