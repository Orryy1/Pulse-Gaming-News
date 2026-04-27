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
    occurrences >= 2,
    `expected both binary and URL Reel polling paths to use INSTAGRAM_CONTAINER_STATUS_FIELDS, got ${occurrences}`,
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
