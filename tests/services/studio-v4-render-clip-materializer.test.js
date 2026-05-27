"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeStudioV4BridgeClips,
} = require("../../lib/studio/v4/render-clip-materializer");

test("Studio V4 clip materializer cuts safe direct media into local render clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-materializer-"));
  const directUrl =
    "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/qksvu_H_ODjUC4em.mp4?tag=14";
  const calls = [];
  const result = await materializeStudioV4BridgeClips({
    root,
    story: { id: "forza-v4" },
    bridge: {
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [
        {
          id: "clip-1",
          source_family: "forza_official_x",
          path: directUrl,
          mediaStartS: 7.77,
          durationS: 2.85,
        },
      ],
    },
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(result.readiness.status, "materialized");
  assert.equal(result.bridge.readiness.status, "bridge_ready");
  assert.equal(result.bridge.video_clips.length, 1);
  assert.equal(result.bridge.video_clips[0].source_url, directUrl);
  assert.match(result.bridge.video_clips[0].path, /output[\\/]+video_cache[\\/]+forza-v4_v4_clip_1_clip-1_[a-f0-9]{12}\.mp4$/);
  assert.equal(calls[0].args[calls[0].args.indexOf("-i") + 1], directUrl);
  assert.equal(calls[0].args.indexOf("-i") < calls[0].args.indexOf("-ss"), true);
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf("-ss"), calls[0].args.indexOf("-ss") + 4), [
    "-ss",
    "7.77",
    "-t",
    "2.85",
  ]);
});

test("Studio V4 clip materializer refreshes stale cache entries when source timing changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-materializer-"));
  const firstUrl =
    "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/qksvu_H_ODjUC4em.mp4?tag=14";
  const secondUrl =
    "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14";
  const calls = [];
  const execFileSync = (bin, args) => {
    calls.push({ bin, args });
    fs.outputFileSync(args[args.length - 1], `render-${calls.length}`);
  };
  const ffprobeDuration = (filePath) => (fs.existsSync(filePath) ? 2.85 : null);

  await materializeStudioV4BridgeClips({
    root,
    story: { id: "forza-v4" },
    bridge: {
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [
        {
          id: "clip-1",
          source_family: "forza_official_x",
          path: firstUrl,
          mediaStartS: 7.77,
          durationS: 2.85,
        },
      ],
    },
    execFileSync,
    ffprobeDuration,
  });
  const second = await materializeStudioV4BridgeClips({
    root,
    story: { id: "forza-v4" },
    bridge: {
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [
        {
          id: "clip-1",
          source_family: "forza_official_x",
          path: secondUrl,
          mediaStartS: 17.4,
          durationS: 2.95,
        },
      ],
    },
    execFileSync,
    ffprobeDuration,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].args[calls[1].args.indexOf("-i") + 1], secondUrl);
  assert.equal(second.bridge.video_clips[0].source_url, secondUrl);
  assert.equal(second.bridge.video_clips[0].materialized_media_start_s, 17.4);
});

test("Studio V4 clip materializer gives duplicate clip ids unique output paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-materializer-"));
  const firstUrl =
    "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282";
  const secondUrl =
    "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/dash_h264.mpd?t=1470853282";
  const result = await materializeStudioV4BridgeClips({
    root,
    story: { id: "steam-controller" },
    bridge: {
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [
        {
          id: "v4_motion_4_steam_353370_37301",
          source_family: "steam_353370_37301",
          path: firstUrl,
          mediaStartS: 36,
          durationS: 5,
        },
        {
          id: "v4_motion_4_steam_353370_37301",
          source_family: "steam_353370_37301",
          path: secondUrl,
          mediaStartS: 42,
          durationS: 5,
        },
      ],
    },
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(result.readiness.status, "materialized");
  assert.equal(result.bridge.video_clips.length, 2);
  assert.notEqual(result.bridge.video_clips[0].path, result.bridge.video_clips[1].path);
  assert.equal(new Set(result.materialized.map((clip) => clip.path)).size, 2);
});

test("Studio V4 clip materializer preserves existing local render clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-materializer-"));
  const localClip = path.join(root, "clip.mp4");
  await fs.outputFile(localClip, "fake");
  let execCount = 0;

  const result = await materializeStudioV4BridgeClips({
    root,
    story: { id: "local-v4" },
    bridge: {
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [
        {
          id: "local",
          source_family: "steam",
          path: localClip,
          durationS: 3,
        },
      ],
    },
    execFileSync: () => {
      execCount++;
    },
    ffprobeDuration: () => 3,
  });

  assert.equal(result.readiness.status, "materialized");
  assert.equal(result.bridge.video_clips[0].path, localClip);
  assert.equal(execCount, 0);
});

test("Studio V4 clip materializer blocks unsafe or non-direct media URLs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v4-materializer-"));
  const result = await materializeStudioV4BridgeClips({
    root,
    story: { id: "unsafe-v4" },
    bridge: {
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [
        {
          id: "watch-page",
          source_family: "youtube",
          path: "https://www.youtube.com/watch?v=abc123",
          durationS: 3,
        },
      ],
    },
    execFileSync: () => {
      throw new Error("should not execute ffmpeg");
    },
  });

  assert.equal(result.readiness.status, "materialization_blocked");
  assert.equal(result.bridge.readiness.status, "bridge_blocked");
  assert.deepEqual(result.bridge.readiness.blockers, ["v4_clip_materialization_failed"]);
  assert.equal(result.rejected[0].reason, "unsafe_direct_media_url");
});
