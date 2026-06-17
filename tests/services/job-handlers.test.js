"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  guardedPublishFailureMessage,
  guardedPublishResultShouldFailJob,
} = require("../../lib/job-handlers");

test("guarded publish result fails the job when a window has no upload", () => {
  assert.equal(
    guardedPublishResultShouldFailJob({
      guarded_live_dispatch: true,
      status: "green",
      action_id: "story-1:youtube_shorts",
      outcome: "new_upload",
      upload_attempt_count: 0,
    }),
    true,
  );
});

test("guarded publish result fails the job for red or blocked windows", () => {
  for (const status of ["red", "failed", "blocked"]) {
    assert.equal(
      guardedPublishResultShouldFailJob({
        guarded_live_dispatch: true,
        status,
        action_id: `story-1:${status}`,
        upload_attempt_count: 1,
      }),
      true,
      status,
    );
  }
});

test("guarded publish result allows successful upload windows", () => {
  assert.equal(
    guardedPublishResultShouldFailJob({
      guarded_live_dispatch: true,
      status: "green",
      action_id: "story-1:youtube_shorts",
      outcome: "new_upload",
      upload_attempt_count: 1,
    }),
    false,
  );
});

test("guarded publish failure message includes the action and reason", () => {
  assert.equal(
    guardedPublishFailureMessage({
      guarded_live_dispatch: true,
      status: "red",
      action_id: "story-1:instagram_reels",
      outcome: "failed",
    }),
    "guarded_publish_window_failed:story-1:instagram_reels:failed",
  );
});
