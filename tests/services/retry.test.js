"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isRetriable, withRetry } = require("../../lib/retry");

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

test("withRetry preserves structured platform error evidence after retries are exhausted", async () => {
  const graphError = new Error("Facebook Graph reel_status failed: HTTP 503 code=2");
  graphError.networkAttempted = true;
  graphError.retriable = true;
  graphError.graph = { stage: "reel_status", code: 2, http_status: 503 };

  await assert.rejects(
    withRetry(async () => {
      throw graphError;
    }, {
      maxAttempts: 2,
      delays: [0],
      label: "Facebook Reel status",
    }),
    (err) => {
      assert.equal(err, graphError);
      assert.equal(err.networkAttempted, true);
      assert.equal(err.retriable, true);
      assert.deepEqual(err.graph, { stage: "reel_status", code: 2, http_status: 503 });
      assert.match(err.message, /^Facebook Reel status failed after 2 attempts:/);
      return true;
    },
  );
});
