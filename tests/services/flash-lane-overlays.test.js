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

test("extractOverlayEntities prefers scene entities and normalises Pokemon spelling with accent", () => {
  const entities = extractOverlayEntities({
    story: { title: "Pokemon and Grand Theft Auto updates" },
    scenes: [{ entity: "Grand Theft Auto" }, { entity: "Pokemon" }, { entity: "Steam" }],
  });

  assert.deepEqual(entities, ["GTA", "Pok\u00e9mon", "Steam"]);
});

test("Flash Lane overlay plan adds story-specific beat chips for multi-game mystery stories", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: {
      title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One",
      source_type: "rss",
      subreddit: "GameSpot",
      full_script: [
        "Take-Two killed a legacy sequel, but the company will not say which one.",
        "The conversation points straight at GTA, Red Dead and BioShock speculation.",
        "No release date, platforms or launch window were shared.",
      ].join(" "),
    },
    scenes: [
      { type: SCENE_TYPES.CLIP, entity: "GTA", duration: 4 },
      { type: SCENE_TYPES.CLIP, entity: "Red Dead", duration: 4 },
      { type: SCENE_TYPES.CLIP, entity: "BioShock", duration: 4 },
    ],
    durationS: 66,
  });

  const beatLabels = plan.timeline
    .filter((item) => item.kind === "beat_chip")
    .map((item) => item.label);

  assert.ok(beatLabels.includes("SEQUEL VETO"));
  assert.ok(beatLabels.includes("MULTI-GAME MYSTERY"));
  assert.ok(beatLabels.includes("NO DATE YET"));
  assert.ok(plan.timeline.some((item) => item.kind === "hook_chip" && item.label === "WAIT, WHICH GAME?"));
  assert.ok(plan.timeline.some((item) => item.kind === "micro_takeaway" && item.label === "NO DATE YET"));
});

test("Flash Lane overlay plan keeps creator chip labels mobile-safe and non-repeating", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: {
      title: "New York's new age verification law will ban anyone under the age of 18 from parts of online gaming",
      source_type: "rss",
      publisher: "IGN",
      full_script:
        "New York's age verification law could lock under-18 players out of gaming features unless platforms adapt fast.",
    },
    scenes: [
      { type: SCENE_TYPES.CLIP_FRAME, entity: "Xbox", duration: 4 },
      { type: SCENE_TYPES.CLIP_FRAME, entity: "PlayStation", duration: 4 },
    ],
    durationS: 64,
  });

  const labels = plan.timeline.map((item) => item.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => label.length <= 24), labels.join(", "));
  assert.ok(plan.timeline.some((item) => item.kind === "beat_chip" && item.label === "AGE GATE"));
});
