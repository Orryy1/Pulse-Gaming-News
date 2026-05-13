const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTENT_QA = require.resolve("../../lib/services/content-qa");

function stubContentQa(result) {
  require.cache[CONTENT_QA] = {
    id: CONTENT_QA,
    filename: CONTENT_QA,
    loaded: true,
    exports: {
      async runContentQa() {
        return result;
      },
    },
  };
}

afterEach(() => {
  delete require.cache[CONTENT_QA];
});

test("storyIsBatchUploadCandidate: refuses failed or incomplete stories", () => {
  const {
    storyIsBatchUploadCandidate,
  } = require("../../lib/services/batch-upload-preflight");
  assert.equal(
    storyIsBatchUploadCandidate({ approved: true, exported_path: "x.mp4" }, "youtube_post_id"),
    true,
  );
  assert.equal(
    storyIsBatchUploadCandidate({ approved: true, exported_path: "x.mp4", qa_failed: true }, "youtube_post_id"),
    false,
  );
  assert.equal(
    storyIsBatchUploadCandidate({ approved: true, exported_path: "x.mp4", publish_status: "failed" }, "youtube_post_id"),
    false,
  );
  assert.equal(
    storyIsBatchUploadCandidate({ approved: true, exported_path: "x.mp4", youtube_post_id: "abc" }, "youtube_post_id"),
    false,
  );
});

test("assertBatchUploadPreflight: propagates content/voice QA failures", async () => {
  stubContentQa({
    result: "fail",
    failures: ["approved_voice:metadata_missing"],
    warnings: [],
  });
  const {
    assertBatchUploadPreflight,
  } = require("../../lib/services/batch-upload-preflight");

  await assert.rejects(
    assertBatchUploadPreflight({ id: "rss_old", exported_path: "x.mp4" }, { platform: "youtube" }),
    /batch_upload_preflight_failed:youtube:approved_voice:metadata_missing/,
  );
});

test("batch uploaders call shared content/voice preflight before upload", () => {
  const root = path.join(__dirname, "..", "..");
  for (const file of [
    "upload_youtube.js",
    "upload_instagram.js",
    "upload_facebook.js",
    "upload_tiktok.js",
    "upload_tiktok_browser.js",
  ]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(src, /assertBatchUploadPreflight/, `${file} must call batch preflight`);
    assert.match(src, /storyIsBatchUploadCandidate/, `${file} must filter failed rows`);
  }
});
