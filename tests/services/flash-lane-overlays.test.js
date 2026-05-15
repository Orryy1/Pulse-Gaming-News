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
const FRAME = { width: 1080, height: 1920 };

function numericExpression(value, frame = FRAME) {
  if (/^\d+$/.test(value)) return Number(value);
  const widthOffset = value.match(/^w-(\d+)$/);
  if (widthOffset) return frame.width - Number(widthOffset[1]);
  const heightOffset = value.match(/^h-(\d+)$/);
  if (heightOffset) return frame.height - Number(heightOffset[1]);
  throw new Error(`Unsupported drawbox expression: ${value}`);
}

function drawboxBounds(filters) {
  return filters
    .join(";")
    .split(";")
    .flatMap((filter) => filter.split(","))
    .map((filter) => filter.replace(/^\[[^\]]+\]/, ""))
    .filter((filter) => filter.startsWith("drawbox="))
    .filter((filter) => /:color=black@/.test(filter))
    .map((filter) => {
      const match = filter.match(/drawbox=x=([^:]+):y=([^:]+):w=(\d+):h=(\d+)/);
      assert.ok(match, `Expected parseable drawbox filter: ${filter}`);
      const [, x, y, width, height] = match;
      return {
        x: numericExpression(x),
        y: numericExpression(y),
        width: Number(width),
        height: Number(height),
        rawX: x,
      };
    });
}

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

test("Flash Lane upper-left chips reserve space below scene entity badges", () => {
  const plan = {
    timeline: [
      {
        kind: "source_chip",
        label: "GAMESPOT",
        at_s: 3,
        duration_s: 2.6,
        anchor: "upper_left",
      },
    ],
  };
  const filters = buildFlashLaneOverlayFilters({
    plan,
    inputLabel: "base",
    outputLabel: "overlayed",
    fontOpt: FONT_OPT,
  }).join(";");

  assert.match(filters, /drawbox=x=64:y=388:w=/);
  assert.doesNotMatch(filters, /drawbox=x=64:y=128:w=/);
  assert.doesNotMatch(filters, /text='SOURCE'[^,]*:x=64\+28:y=128\+11/);
});

test("Flash Lane chip anchors fit inside a 1080x1920 frame", () => {
  const plan = {
    timeline: [
      {
        kind: "source_chip",
        label: "VERY LONG SOURCE NAME FOR GEOMETRY",
        at_s: 1,
        duration_s: 2.6,
        anchor: "upper_left",
      },
      {
        kind: "entity_chip",
        label: "VERY LONG ENTITY NAME FOR GEOMETRY",
        at_s: 4,
        duration_s: 2.4,
        anchor: "upper_right",
      },
      {
        kind: "beat_chip",
        label: "VERY LONG BEAT CHIP FOR GEOMETRY",
        at_s: 7,
        duration_s: 2.45,
        anchor: "lower_left",
      },
      {
        kind: "micro_takeaway",
        label: "WHY IT MATTERS",
        at_s: 10,
        duration_s: 2.8,
        anchor: "mid_left",
      },
    ],
  };

  const bounds = drawboxBounds(buildFlashLaneOverlayFilters({
    plan,
    inputLabel: "base",
    outputLabel: "overlayed",
    fontOpt: FONT_OPT,
  }));

  assert.equal(bounds.length, plan.timeline.length);
  for (const box of bounds) {
    assert.ok(box.x >= 0, `${box.rawX} starts off-frame`);
    assert.ok(box.y >= 0, `${box.rawX} starts above frame`);
    assert.ok(box.x + box.width <= FRAME.width, `${box.rawX}+${box.width} exceeds frame width`);
    assert.ok(box.y + box.height <= FRAME.height, `${box.rawX}+${box.height} exceeds frame height`);
  }
});

test("Flash Lane upper-right chips use computed chip width in FFmpeg x expression", () => {
  const plan = {
    timeline: [
      {
        kind: "source_chip",
        label: "VERY LONG SOURCE NAME FOR GEOMETRY",
        at_s: 1,
        duration_s: 2.6,
        anchor: "upper_right",
      },
    ],
  };

  const filters = buildFlashLaneOverlayFilters({
    plan,
    inputLabel: "base",
    outputLabel: "overlayed",
    fontOpt: FONT_OPT,
  }).join(";");

  assert.match(filters, /drawbox=x=w-470:y=128:w=470:h=72/);
  assert.doesNotMatch(filters, /drawbox=x=w-420:y=128:w=470:h=72/);
});

test("Flash Lane upper-left chips reserve space below source-card safe zone", () => {
  const plan = {
    timeline: [
      {
        kind: "source_chip",
        label: "EUROGAMER",
        at_s: 3,
        duration_s: 2.6,
        anchor: "upper_left",
      },
    ],
  };
  const filters = buildFlashLaneOverlayFilters({
    plan,
    inputLabel: "base",
    outputLabel: "overlayed",
    fontOpt: FONT_OPT,
  }).join(";");

  assert.doesNotMatch(filters, /drawbox=x=64:y=2(?:[0-9]{2}|50):w=/);
  assert.match(filters, /drawbox=x=64:y=388:w=/);
});

test("Flash Lane upper-left chips move away from active card scenes", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: {
      title: "Xbox CEO responds to revenue pressure",
      source_type: "rss",
      publisher: "IGN",
    },
    scenes: [
      { type: SCENE_TYPES.CARD_STAT, duration: 8 },
      { type: SCENE_TYPES.CLIP, entity: "Xbox", duration: 4 },
    ],
    durationS: 12,
  });

  const sourceChip = plan.timeline.find((item) => item.kind === "source_chip");
  assert.equal(sourceChip.anchor, "mid_left");

  const filters = buildFlashLaneOverlayFilters({
    plan,
    inputLabel: "base",
    outputLabel: "overlayed",
    fontOpt: FONT_OPT,
  }).join(";");

  assert.match(filters, /drawbox=x=64:y=980:w=/);
  assert.doesNotMatch(filters, /drawbox=x=64:y=388:w=/);
});

test("Flash Lane upper-left chips also reserve space during card-like opener scenes", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: {
      title: "GTA trailer timing update",
      source_type: "rss",
      publisher: "IGN",
    },
    scenes: [
      { type: SCENE_TYPES.OPENER, isClipBacked: false, duration: 4 },
      { type: SCENE_TYPES.CLIP, entity: "GTA", duration: 4 },
    ],
    durationS: 10,
  });

  const sourceChip = plan.timeline.find((item) => item.kind === "source_chip");
  assert.equal(sourceChip.anchor, "mid_left");
  assert.equal(sourceChip.anchor_note, "moved_from_upper_left_to_avoid_card_scene");
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

test("Flash Lane overlay plan deconflicts same-anchor chips after bounded timing collapse", () => {
  const plan = buildFlashLaneOverlayPlan({
    story: {
      title: "GTA and Red Dead trailer update",
      source_type: "rss",
      publisher: "IGN",
    },
    scenes: [
      { type: SCENE_TYPES.CLIP, entity: "GTA", duration: 2 },
      { type: SCENE_TYPES.CLIP_FRAME, entity: "Red Dead", duration: 2 },
    ],
    durationS: 4,
  });

  const byAnchor = new Map();
  for (const item of plan.timeline) {
    const items = byAnchor.get(item.anchor) || [];
    items.push(item);
    byAnchor.set(item.anchor, items);
  }

  for (const items of byAnchor.values()) {
    const sorted = items.slice().sort((a, b) => a.at_s - b.at_s);
    for (let index = 1; index < sorted.length; index++) {
      const previousEnd = sorted[index - 1].at_s + sorted[index - 1].duration_s;
      assert.ok(
        sorted[index].at_s >= previousEnd - 0.001,
        `${sorted[index - 1].kind} overlaps ${sorted[index].kind} at ${sorted[index].anchor}`,
      );
    }
  }
});
