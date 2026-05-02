"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  buildSourceCardFilter,
} = require("../../lib/scenes/source-card");
const {
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
