"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  INSTAGRAM_CONTAINER_STATUS_FIELDS,
  IG_REEL_PROCESSING_MAX_ATTEMPTS,
  IG_REEL_PROCESSING_POLL_MS,
  IG_STORY_PROCESSING_MAX_ATTEMPTS,
  IG_STORY_PROCESSING_POLL_MS,
  buildInstagramPendingProcessingTimeoutError,
  formatInstagramContainerStatus,
  formatInstagramStatusCheckError,
  isInstagramPendingProcessingTimeout,
  redactInstagramLogValue,
  summariseInstagramContainerStatus,
  summariseInstagramGraphError,
} = require("../../upload_instagram");
const { renderPublishSummary } = require("../../lib/job-handlers");

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
  // story.instagram_error. Pending processing now throws a typed
  // pending_processing_timeout with the container/creation id and last
  // polled status, so publisher.js can schedule a later verifier instead
  // of starting a duplicate fallback upload.
  assert.match(SRC, /pending_processing_timeout/);
  assert.match(SRC, /buildInstagramPendingProcessingTimeoutError/);
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

test("Instagram processing timeout is classified as pending_processing_timeout with container identity", () => {
  assert.equal(IG_REEL_PROCESSING_MAX_ATTEMPTS, 60);
  assert.equal(IG_REEL_PROCESSING_POLL_MS, 10000);
  assert.equal(IG_STORY_PROCESSING_MAX_ATTEMPTS, 30);
  assert.equal(IG_STORY_PROCESSING_POLL_MS, 5000);

  const err = buildInstagramPendingProcessingTimeoutError({
    containerId: "17890000000000000",
    phase: "instagram_reel",
    attempts: 60,
    pollMs: 10000,
    statusSummary: { status_code: "IN_PROGRESS", status: "Processing" },
  });

  assert.equal(err.code, "pending_processing_timeout");
  assert.equal(err.pendingProcessing, true);
  assert.equal(err.containerId, "17890000000000000");
  assert.equal(err.creationId, "17890000000000000");
  assert.equal(isInstagramPendingProcessingTimeout(err), true);
  assert.match(err.message, /container_id=17890000000000000/);
  assert.match(err.message, /creation_id=17890000000000000/);
  assert.match(err.message, /status_code=IN_PROGRESS/);
  assert.match(err.message, /verify_later=true/);
});

test("publish summary renders IG pending processing as pending, not generic failure", () => {
  const summary = renderPublishSummary({
    title: "Instagram pending",
    youtube: true,
    tiktok: true,
    instagram: false,
    facebook: false,
    twitter: false,
    errors: {
      instagram:
        "instagram_reel pending_processing_timeout: container_id=1789 status_code=IN_PROGRESS verify_later=true",
      instagram_story:
        "instagram_story pending_processing_timeout: container_id=1790 status_code=IN_PROGRESS verify_later=true",
    },
    skipped: { twitter: "twitter_disabled" },
    fallbacks: {},
    platform_outcomes: {
      youtube: "new_upload",
      tiktok: "new_upload",
      instagram: "accepted_processing",
      facebook: "page_not_eligible",
      twitter: "skipped",
      facebook_card: "new_upload",
      instagram_story: "accepted_processing",
      twitter_image: "not_attempted",
    },
  });

  assert.equal(summary.status, "degraded");
  assert.match(summary.message, /IG Reel/);
  assert.match(summary.message, /pending_processing_timeout/);
  assert.match(summary.message, /IG Story/);
  assert.match(summary.message, /container_id=1790/);
  assert.match(summary.message, /FB Reel/);
  assert.match(summary.message, /page_not_eligible/);
});
