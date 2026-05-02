"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  buildSceneInput,
  dispatchSceneFilter,
} = require("../../lib/studio/ffmpeg-scene-renderer");

test("visual scenes get compact entity popups instead of anonymous cover slides", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { title: "Take-Two legacy franchise story" },
    scene: {
      type: SCENE_TYPES.CLIP_FRAME,
      duration: 4,
      source: "frame.jpg",
      entity: "BioShock",
      sourceType: "official_trailer_frame",
    },
  });

  assert.match(filter, /BIOSHOCK/);
  assert.match(filter, /OFFICIAL FRAME/);
  assert.match(filter, /box=1:boxcolor=black@0\.46/);
  assert.match(filter, /alpha='if\(lt\(t\\,0\.12\)/);
  assert.doesNotMatch(filter, /drawbox=x=52:y=108:w=420:h=74/);
});

test("opener hook overlay is compact and avoids the old full-width top slab", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { hook: "Take-Two killed a legacy sequel. They will not say which one." },
    scene: {
      type: SCENE_TYPES.OPENER,
      duration: 4,
      source: "gta-trailer.m3u8",
      isClipBacked: true,
      entity: "GTA",
      sourceType: "steam_movie",
    },
  });

  assert.doesNotMatch(filter, /h=172:color=black@0\.86/);
  assert.match(filter, /w=760:h=118:color=black@0\.58/);
  assert.match(filter, /GTA/);
});

test("official clip inputs seek to the selected trailer beat instead of trailer start", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.CLIP,
    duration: 4,
    source: "https://video.example/trailer.m3u8",
    mediaStartS: 31.2,
  });

  assert.match(input, /^-ss 31\.20 -t 5\.00 -i "https:\/\/video\.example\/trailer\.m3u8"$/);
});
