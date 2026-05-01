const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyShortDuration,
  estimateVideoDurationFromAudio,
  DEFAULT_MIN_SHORT_VIDEO_SECONDS,
  DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
} = require("../../lib/services/short-duration-contract");

test("estimateVideoDurationFromAudio adds the render breathing room", () => {
  assert.equal(estimateVideoDurationFromAudio(61), 62);
  assert.equal(estimateVideoDurationFromAudio(61.234), 62.234);
});

test("classifyShortDuration accepts the TikTok-safe Shorts window", () => {
  const result = classifyShortDuration({ audioDurationSeconds: 63 });

  assert.equal(result.result, "pass");
  assert.deepEqual(result.failures, []);
  assert.equal(result.estimatedVideoDurationSeconds, 64);
});

test("classifyShortDuration blocks runaway audio before render", () => {
  const result = classifyShortDuration({ audioDurationSeconds: 125.86 });

  assert.equal(result.result, "fail");
  assert.ok(
    result.failures.some((failure) =>
      failure.startsWith("audio_duration_too_long"),
    ),
    result.failures.join(", "),
  );
});

test("classifyShortDuration blocks explicit overlong video duration", () => {
  const result = classifyShortDuration({ videoDurationSeconds: 137.5 });

  assert.equal(result.result, "fail");
  assert.ok(
    result.failures.some((failure) =>
      failure.startsWith("video_duration_too_long"),
    ),
    result.failures.join(", "),
  );
});

test("duration defaults match the current publish QA contract", () => {
  assert.equal(DEFAULT_MIN_SHORT_VIDEO_SECONDS, 61);
  assert.equal(DEFAULT_MAX_SHORT_VIDEO_SECONDS, 75);
  assert.equal(DEFAULT_RENDER_BREATHING_ROOM_SECONDS, 1);
});
