"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  buildSourceCardFilter,
} = require("../../lib/scenes/source-card");
const {
  buildClipFilter,
  buildSceneInput,
  buildFlashStatCardFilter,
  dispatchSceneFilter,
} = require("../../lib/studio/ffmpeg-scene-renderer");

const FONT_OPT = "fontfile='C\\:/Windows/Fonts/arial.ttf'";

test("Flash Lane source cards use a stronger creator-news treatment", () => {
  const filter = buildSourceCardFilter({
    slot: 0,
    duration: 4,
    sourceLabel: "GameSpot",
    sublabel: "News",
    treatment: "flash_lane",
    fontOpt: FONT_OPT,
  });

  assert.match(filter, /SOURCE CHECK/);
  assert.match(filter, /PULSE VERIFIED/);
  assert.match(filter, /saturation=0\.82/);
  assert.doesNotMatch(filter, /w=iw:h=ih:color=black@0\.[2-9]/);
  assert.match(filter, /FLASH SOURCE/);
  assert.doesNotMatch(filter, /drawbox=[^,]*:alpha=/);
});

test("standard source cards remain available outside Flash Lane", () => {
  const filter = buildSourceCardFilter({
    slot: 0,
    duration: 4,
    sourceLabel: "GameSpot",
    sublabel: "News",
    fontOpt: FONT_OPT,
  });

  assert.match(filter, /SOURCE/);
  assert.doesNotMatch(filter, /PULSE VERIFIED/);
});

test("Flash Lane clip badges use compact fading creator chips", () => {
  const filter = buildClipFilter({
    slot: 0,
    duration: 4,
    scene: {
      type: SCENE_TYPES.CLIP,
      entity: "GTA",
      sourceType: "steam_movie",
      source: "trailer.m3u8",
    },
    fontOpt: FONT_OPT,
  });

  assert.match(filter, /OFFICIAL CLIP/);
  assert.match(filter, /GTA/);
  assert.match(filter, /box=1:boxcolor=black@0\.46/);
  assert.match(filter, /alpha='if\(lt\(t\\,0\.12\)/);
  assert.doesNotMatch(filter, /drawbox=x=52:y=108:w=420:h=74/);
});

test("Flash Lane grammar clips render as punch, speed-ramp and freeze-frame beats", () => {
  const punch = dispatchSceneFilter({
    slot: 0,
    scene: { type: SCENE_TYPES.PUNCH, duration: 1.8, source: "clip.mp4", entity: "GTA" },
    story: {},
    fontOpt: FONT_OPT,
  });
  const speed = dispatchSceneFilter({
    slot: 1,
    scene: { type: SCENE_TYPES.SPEED_RAMP, duration: 3.8, source: "clip.mp4", entity: "GTA" },
    story: {},
    fontOpt: FONT_OPT,
  });
  const freeze = dispatchSceneFilter({
    slot: 2,
    scene: {
      type: SCENE_TYPES.FREEZE_FRAME,
      duration: 4,
      source: "clip.mp4",
      entity: "GTA",
      caption: "LEGACY SEQUEL AXED",
    },
    story: {},
    fontOpt: FONT_OPT,
  });

  assert.match(punch, /eq=brightness=0\.02:saturation=1\.12:contrast=1\.12/);
  assert.match(speed, /setpts='\(N\/30\/TB\)/);
  assert.match(freeze, /tpad=stop_mode=clone/);
  assert.match(freeze, /LEGACY SEQUEL AXED/);
});

test("Flash Lane grammar scene inputs seek the intended trailer section", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.SPEED_RAMP,
    source: "C:\\clips\\clip.mp4",
    mediaStartS: 42.4,
    duration: 4,
  });

  assert.match(input, /-ss 42\.40/);
  assert.match(input, /-t 8\.80/);
});

test("Flash Lane context cards do not fall back to plain release-date layout", () => {
  const filter = buildFlashStatCardFilter({
    slot: 1,
    scene: {
      type: SCENE_TYPES.CARD_STAT,
      label: "card_context",
      statLabel: "WHY IT MATTERS",
      sublabel: "This changes the next update",
      duration: 4,
      cardTreatment: "flash_lane",
    },
    fontOpt: FONT_OPT,
  });

  assert.match(filter, /MUST KNOW/);
  assert.match(filter, /KEEP WATCHING/);
  assert.match(filter, /WHY IT MATTERS/);
  assert.doesNotMatch(filter, /drawbox=[^,]*:alpha=/);
});

test("dispatchSceneFilter routes Flash Lane card treatment", () => {
  const source = dispatchSceneFilter({
    slot: 0,
    scene: {
      type: SCENE_TYPES.CARD_SOURCE,
      label: "card_source",
      duration: 4,
      sourceLabel: "GameSpot",
      cardTreatment: "flash_lane",
    },
    story: {},
    fontOpt: FONT_OPT,
  });
  const context = dispatchSceneFilter({
    slot: 1,
    scene: {
      type: SCENE_TYPES.CARD_STAT,
      label: "card_context",
      duration: 4,
      statLabel: "MUST KNOW",
      cardTreatment: "flash_lane",
    },
    story: {},
    fontOpt: FONT_OPT,
  });

  assert.match(source, /SOURCE CHECK/);
  assert.match(context, /KEEP WATCHING/);
});

test("Flash Lane takeaway card stays bright enough for end-frame QA", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    scene: {
      type: SCENE_TYPES.CARD_TAKEAWAY,
      label: "card_takeaway",
      duration: 4,
      text: "FOLLOW PULSE GAMING",
      cta: "NEVER MISS A BEAT",
      cardTreatment: "flash_lane",
    },
    story: {},
    fontOpt: FONT_OPT,
  });

  assert.match(filter, /NEVER MISS A BEAT/);
  assert.match(filter, /FOLLOW PULSE GAMING/);
  assert.match(filter, /eq=brightness=-0\.08:saturation=1\.08:contrast=1\.14/);
  assert.doesNotMatch(filter, /drawbox=x=0:y=0:w=iw:h=400:color=black@0\.55/);
  assert.doesNotMatch(filter, /drawbox=x=0:y=h-500:w=iw:h=500:color=black@0\.55/);
  assert.doesNotMatch(filter, /drawbox=[^,]*:alpha=/);
});
