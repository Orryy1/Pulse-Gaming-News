const { test } = require("node:test");
const assert = require("node:assert");

const {
  classifyPlatformVideoQa,
  parseFfprobeJson,
  runPlatformVideoQa,
} = require("../../lib/services/platform-video-qa");

function probe({ video = {}, audio = {} } = {}) {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        profile: "High",
        pix_fmt: "yuv420p",
        width: 1080,
        height: 1920,
        ...video,
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        ...audio,
      },
    ],
    format: {},
  };
}

test("parseFfprobeJson parses valid ffprobe JSON", () => {
  assert.deepStrictEqual(parseFfprobeJson('{"streams":[]}'), { streams: [] });
});

test("parseFfprobeJson returns null for malformed output", () => {
  assert.strictEqual(parseFfprobeJson("not json"), null);
  assert.strictEqual(parseFfprobeJson(""), null);
});

test("classifyPlatformVideoQa accepts Meta-safe short-form MP4 metadata", () => {
  const result = classifyPlatformVideoQa(probe());
  assert.strictEqual(result.result, "pass");
  assert.deepStrictEqual(result.failures, []);
});

test("classifyPlatformVideoQa rejects yuv444p / High 4:4:4 renders before upload", () => {
  const result = classifyPlatformVideoQa(
    probe({
      video: {
        pix_fmt: "yuv444p",
        profile: "High 4:4:4 Predictive",
      },
    }),
  );
  assert.strictEqual(result.result, "fail");
  assert.ok(result.failures.includes("video_pixel_format_not_yuv420p (yuv444p)"));
  assert.ok(
    result.failures.some((f) => f.startsWith("video_h264_profile_unsupported")),
  );
});

test("classifyPlatformVideoQa rejects missing narration/audio stream", () => {
  const result = classifyPlatformVideoQa({
    streams: [probe().streams[0]],
  });
  assert.strictEqual(result.result, "fail");
  assert.ok(result.failures.includes("audio_stream_missing"));
});

test("classifyPlatformVideoQa rejects landscape videos for short-form publish", () => {
  const result = classifyPlatformVideoQa(
    probe({
      video: {
        width: 1920,
        height: 1080,
      },
    }),
  );
  assert.strictEqual(result.result, "fail");
  assert.ok(result.failures.includes("video_not_vertical (1920x1080)"));
});

test("classifyPlatformVideoQa rejects non-AAC MP4 audio", () => {
  const result = classifyPlatformVideoQa(
    probe({
      audio: {
        codec_name: "mp3",
      },
    }),
  );
  assert.strictEqual(result.result, "fail");
  assert.ok(result.failures.includes("audio_codec_not_aac (mp3)"));
});

test("runPlatformVideoQa resolves an existing file and classifies ffprobe JSON", async () => {
  const result = await runPlatformVideoQa("/tmp/video.mp4", {
    fs: {
      async pathExists(p) {
        return p === "/tmp/video.mp4";
      },
    },
    async execFile(file, args) {
      assert.strictEqual(file, "ffprobe");
      assert.ok(args.includes("/tmp/video.mp4"));
      return { stdout: JSON.stringify(probe()) };
    },
  });

  assert.strictEqual(result.result, "pass");
});

test("runPlatformVideoQa skips rather than fails when ffprobe is unavailable", async () => {
  const result = await runPlatformVideoQa("/tmp/video.mp4", {
    fs: {
      async pathExists(p) {
        return p === "/tmp/video.mp4";
      },
    },
    async execFile() {
      const err = new Error("spawn ffprobe ENOENT");
      err.code = "ENOENT";
      throw err;
    },
  });

  assert.strictEqual(result.result, "skip");
  assert.strictEqual(result.reason, "ffprobe_missing");
});
