"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isRetriable } = require("../../lib/retry");

test("isRetriable treats Instagram media-processing rejects as terminal", () => {
  assert.equal(
    isRetriable(
      new Error(
        "Instagram processing failed: status_code=ERROR status=Error: Media upload has failed with error code 2207076",
      ),
    ),
    false,
  );

  assert.equal(
    isRetriable(
      new Error(
        "Instagram URL processing failed: status_code=ERROR status=Error: unsupported codec",
      ),
    ),
    false,
  );
});

test("isRetriable honours explicit non-retriable Meta processing errors", () => {
  const err = new Error(
    'Instagram binary upload failed (400): {"debug_info":{"retriable":false,"type":"ProcessingFailedError","message":"Request processing failed"}}',
  );

  assert.equal(isRetriable(err), false);
});

test("isRetriable still retries transient transport failures", () => {
  assert.equal(
    isRetriable(new Error("Instagram binary upload failed (500): upstream timeout")),
    true,
  );
});
