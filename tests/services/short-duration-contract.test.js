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

test("classifyShortDuration keeps unplanned 85s videos out of the Flash Lane", () => {
  const result = classifyShortDuration({
    audioDurationSeconds: 84,
    videoDurationSeconds: 85,
  });

  assert.equal(result.result, "fail");
  assert.equal(result.durationLane, "pulse_flash_short");
  assert.ok(
    result.failures.some((failure) =>
      failure.startsWith("audio_duration_too_long"),
    ),
    result.failures.join(", "),
  );
});

test("classifyShortDuration allows a deliberate extended Short up to 90s", () => {
  const result = classifyShortDuration({
    audioDurationSeconds: 84,
    videoDurationSeconds: 85,
    lane: "pulse_extended_short",
  });

  assert.equal(result.result, "pass");
  assert.deepEqual(result.failures, []);
  assert.equal(result.durationLane, "pulse_extended_short");
  assert.equal(result.maxVideoSeconds, 90);
});

test("classifyShortDuration allows deliberate retention-short edits", () => {
  const result = classifyShortDuration({
    audioDurationSeconds: 35.2,
    videoDurationSeconds: 35.2,
    lane: "pulse_retention_short",
  });

  assert.equal(result.result, "pass");
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.durationLane, "pulse_retention_short");
  assert.equal(result.minVideoSeconds, 22);
});

test("classifyShortDuration blocks runaway audio even in the extended Short lane", () => {
  const result = classifyShortDuration({
    audioDurationSeconds: 124,
    videoDurationSeconds: 125,
    lane: "pulse_extended_short",
  });

  assert.equal(result.result, "fail");
  assert.equal(result.durationLane, "pulse_extended_short");
  assert.ok(
    result.failures.some((failure) =>
      failure.startsWith("audio_duration_too_long"),
    ),
    result.failures.join(", "),
  );
});

test("duration defaults match the current publish QA contract", () => {
  assert.equal(DEFAULT_MIN_SHORT_VIDEO_SECONDS, 61);
  assert.equal(DEFAULT_MAX_SHORT_VIDEO_SECONDS, 75);
  assert.equal(DEFAULT_RENDER_BREATHING_ROOM_SECONDS, 1);
});
