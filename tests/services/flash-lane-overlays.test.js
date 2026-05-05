"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  buildFlashLaneOverlayPlan,
  buildFlashLaneOverlayFilters,
  extractOverlayEntities,
} = require("../../lib/studio/v2/flash-lane-overlays");

const FONT_OPT = "fontfile='C\\:/Windows/Fonts/arial.ttf'";

test("Flash Lane overlay plan turns source and entity context into compact chips", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: {
      id: "marathon",
      title: "Marathon Drops To 15K Daily CCU Peak On Steam",
      source_type: "rss",
      subreddit: "GameSpot",
      top_comment: "RSS excerpt should not become a Reddit chip",
    },
    scenes: [
      { type: SCENE_TYPES.OPENER, isClipBacked: true, entity: "Marathon", duration: 4 },
      { type: SCENE_TYPES.CLIP, entity: "Marathon", duration: 4 },
      { type: SCENE_TYPES.CLIP_FRAME, entity: "Steam", duration: 4 },
    ],
    durationS: 66,
  });

  assert.equal(plan.verdict, "ready");
  assert.ok(plan.timeline.some((item) => item.kind === "source_chip" && item.label === "GAMESPOT"));
  assert.ok(plan.timeline.some((item) => item.kind === "entity_chip" && item.label === "MARATHON"));
  assert.equal(plan.comment_overlay.allowed, false);
  assert.equal(plan.comment_overlay.source_type, "rss_description_only");
  assert.doesNotMatch(JSON.stringify(plan), /u\/Redditor/i);
});

test("Flash Lane overlay filters are time-bound and never create full-screen cards", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: { title: "GTA trailer", source_type: "reddit", subreddit: "GamingLeaksAndRumours", top_comment: "Real comment" },
    scenes: [{ type: SCENE_TYPES.CLIP, entity: "GTA", duration: 4 }],
    durationS: 62,
  });
  const filters = buildFlashLaneOverlayFilters({
    plan,
    inputLabel: "base",
    outputLabel: "overlayed",
    fontOpt: FONT_OPT,
  });
  const joined = filters.join(";");

  assert.match(joined, /^\[base\]/);
  assert.doesNotMatch(joined, /\[base\],/);
  assert.match(joined, /\[overlayed\]$/);
  assert.match(joined, /enable='between\(t\\,/);
  assert.match(joined, /GTA/);
  assert.match(joined, /GAMINGLEAKSANDRUMOURS/);
  assert.doesNotMatch(joined, /w=iw:h=ih/);
});

test("extractOverlayEntities prefers scene entities and normalises Pokemon spelling", () => {
  const entities = extractOverlayEntities({
    story: { title: "Pokemon and Grand Theft Auto updates" },
    scenes: [{ entity: "Grand Theft Auto" }, { entity: "Pokemon" }, { entity: "Steam" }],
  });

  assert.deepEqual(entities, ["GTA", "Pokemon", "Steam"]);
});
