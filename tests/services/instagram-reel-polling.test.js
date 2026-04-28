"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  INSTAGRAM_CONTAINER_STATUS_FIELDS,
  formatInstagramContainerStatus,
  summariseInstagramContainerStatus,
} = require("../../upload_instagram");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "upload_instagram.js"),
  "utf8",
);

test("Instagram Reel polling requests Graph error fields", () => {
  assert.equal(
    INSTAGRAM_CONTAINER_STATUS_FIELDS,
    "status_code,status,error_code,error_subcode,error_message",
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
