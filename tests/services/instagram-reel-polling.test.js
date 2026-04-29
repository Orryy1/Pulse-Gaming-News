"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  INSTAGRAM_CONTAINER_STATUS_FIELDS,
  formatInstagramContainerStatus,
  formatInstagramStatusCheckError,
  redactInstagramLogValue,
  summariseInstagramContainerStatus,
  summariseInstagramGraphError,
} = require("../../upload_instagram");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "upload_instagram.js"),
  "utf8",
);

test("Instagram Reel polling requests accepted Graph container status fields", () => {
  assert.equal(INSTAGRAM_CONTAINER_STATUS_FIELDS, "status_code,status");
  assert.doesNotMatch(
    INSTAGRAM_CONTAINER_STATUS_FIELDS,
    /error_code|error_subcode|error_message/,
    "Graph rejects error_code/error_subcode/error_message as requested media container fields; detailed errors come from exception payload logging",
  );
  const occurrences = (
    SRC.match(/fields:\s*INSTAGRAM_CONTAINER_STATUS_FIELDS/g) || []
  ).length;
  assert.ok(
    occurrences >= 3,
    `expected Reel binary, Reel URL and Story polling paths to use INSTAGRAM_CONTAINER_STATUS_FIELDS, got ${occurrences}`,
  );
});

test("formatInstagramContainerStatus includes error_code, error_subcode and error_message", () => {
  const summary = summariseInstagramContainerStatus({
    status_code: "ERROR",
    status: "Failed",
    error_code: 2207008,
    error_subcode: 2207027,
    error_message: "Video processing failed",
  });
  assert.deepEqual(summary, {
    status_code: "ERROR",
    status: "Failed",
    error_code: 2207008,
    error_subcode: 2207027,
    error_message: "Video processing failed",
  });
  const formatted = formatInstagramContainerStatus(summary);
  assert.match(formatted, /status_code=ERROR/);
  assert.match(formatted, /error_code=2207008/);
  assert.match(formatted, /error_subcode=2207027/);
  assert.match(formatted, /error_message=Video processing failed/);
});

test("Instagram timeout/ERROR messages preserve the last polled status fields", () => {
  // Defensive Production Pass: timeout used to drop the error fields
  // ("status: IN_PROGRESS"), making 2207076 et al. invisible in
  // story.instagram_error. Both binary and URL paths now thread the
  // last polled summary through formatInstagramContainerStatus before
  // throwing.
  const timeoutThrows = SRC.match(/processing timed out:[^"`'\n]*/g) || [];
  assert.ok(
    timeoutThrows.length >= 2,
    `expected both binary and URL timeout messages to use the new "timed out: <fields>" form, got ${timeoutThrows.length}`,
  );
  assert.match(SRC, /lastSummary\s*=\s*summariseInstagramContainerStatus/);
  // ERROR branch must not JSON.stringify the raw response any more —
  // every documented field is already covered by the formatter.
  assert.doesNotMatch(SRC, /processing failed:\s*\$\{JSON\.stringify/);
  assert.doesNotMatch(SRC, /URL processing failed:\s*\$\{JSON\.stringify/);
});

test("Instagram Graph status-check exceptions preserve actionable error fields", () => {
  const err = new Error("Request failed with status code 400");
  err.response = {
    status: 400,
    data: {
      error: {
        message: "Media ID is not available",
        type: "OAuthException",
        code: 100,
        error_subcode: 2207008,
        fbtrace_id: "A1B2C3",
      },
    },
  };

  assert.deepEqual(summariseInstagramGraphError(err), {
    http_status: 400,
    message: "Request failed with status code 400",
    code: 100,
    error_subcode: 2207008,
    type: "OAuthException",
    fbtrace_id: "A1B2C3",
    graph_message: "Media ID is not available",
  });

  const formatted = formatInstagramStatusCheckError(err);
  assert.match(formatted, /http_status=400/);
  assert.match(formatted, /code=100/);
  assert.match(formatted, /error_subcode=2207008/);
  assert.match(formatted, /type=OAuthException/);
  assert.match(formatted, /message=Media ID is not available/);
  assert.match(formatted, /fbtrace_id=A1B2C3/);
});

test("Instagram status-check formatter redacts token-shaped values", () => {
  const err = new Error("Request failed with access_token=supersecret");
  err.response = {
    status: 400,
    data: {
      error: {
        message: "Bad token Bearer abc.def.ghi access_token=supersecret",
        code: 190,
      },
    },
  };

  const formatted = formatInstagramStatusCheckError(err);
  assert.doesNotMatch(formatted, /abc\.def\.ghi/);
  assert.doesNotMatch(formatted, /supersecret/);
  assert.match(formatted, /\[REDACTED\]/);
  assert.equal(
    redactInstagramLogValue("https://x.test/?access_token=secret&ok=1"),
    "https://x.test/?access_token=[REDACTED]&ok=1",
  );
});

test("Instagram binary, URL and Story status-check catch blocks log formatted Graph errors", () => {
  assert.match(
    SRC,
    /Status check error: \$\{formatInstagramStatusCheckError\(err\)\}/,
  );
  assert.match(
    SRC,
    /URL status check error: \$\{formatInstagramStatusCheckError\(err\)\}/,
  );
  assert.match(
    SRC,
    /Story status check error: \$\{formatInstagramStatusCheckError\(err\)\}/,
  );
  assert.doesNotMatch(SRC, /Status check error: \$\{err\.message\}/);
  assert.doesNotMatch(SRC, /Story status check error: \$\{err\.message\}/);
});
