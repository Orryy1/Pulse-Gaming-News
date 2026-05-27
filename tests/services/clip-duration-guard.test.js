"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  protectClipSceneDurationsFromFreezes,
} = require("../../lib/studio/v2/clip-duration-guard");
const { buildSceneInput } = require("../../lib/studio/ffmpeg-scene-renderer");

test("clip duration guard caps short validated clip windows and redistributes to stills", () => {
  const result = protectClipSceneDurationsFromFreezes(
    [
      {
        type: SCENE_TYPES.CLIP,
        label: "short_official_clip",
        duration: 4.2,
        clipDurationS: 2.35,
      },
      {
        type: SCENE_TYPES.STILL,
        label: "ken_burns_still",
        duration: 3.8,
      },
      {
        type: SCENE_TYPES.PUNCH,
        label: "short_punch",
        duration: 4,
        clipDurationS: 2.5,
      },
    ],
    { targetDurationS: 12 },
  );

  assert.equal(result.adjusted, true);
  assert.equal(result.scenes[0].duration, 2.17);
  assert.equal(result.scenes[0].clipDurationCapped, true);
  assert.equal(result.scenes[2].duration, 2.32);
  assert.equal(result.scenes[2].clipDurationCapped, true);
  assert.equal(result.scenes[1].duration, 7.51);
  assert.equal(
    Number(result.scenes.reduce((sum, scene) => sum + scene.duration, 0).toFixed(3)),
    12,
  );
});

test("scene input reads a small remote clip margin while visible output stays capped", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.CLIP,
    source: "https://video.akamai.steamstatic.com/store_trailers/forza/hls_264_master.m3u8",
    mediaStartS: 36.45,
    duration: 2.35,
    clipDurationS: 2.35,
  });

  assert.match(input, /-ss 36\.45/);
  assert.match(input, /-t 2\.60/);
});
