"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSceneTimeline,
  planHeroMomentsV21,
  buildHeroMomentOverlayFilter,
} = require("../../lib/studio/v2/hero-moments-v21");

test("buildSceneTimeline uses beat-aware transition offsets", () => {
  const timeline = buildSceneTimeline(
    [
      { type: "opener", duration: 2 },
      { type: "card.source", duration: 4 },
      { type: "card.timeline", duration: 4 },
    ],
    [{ offset: 1.9 }, { offset: 6.1 }],
  );
  assert.equal(timeline[0].startS, 0);
  assert.equal(timeline[1].startS, 1.9);
  assert.equal(timeline[2].startS, 6.1);
});

test("planHeroMomentsV21 picks sparse story-aware card beats", () => {
  const plan = planHeroMomentsV21({
    story: { id: "1sn9xhe", title: "Metro 2039 reveal trailer" },
    scenes: [
      { type: "opener", duration: 2 },
      {
        type: "card.source",
        duration: 4,
        label: "source",
        prerenderedMp4: "test/output/hf_source_card_1sn9xhe.mp4",
      },
      { type: "clip.frame", duration: 4 },
      {
        type: "card.timeline",
        duration: 4,
        label: "timeline",
        premiumLane: "hyperframes",
      },
      { type: "card.quote", duration: 4 },
      { type: "card.takeaway", duration: 4 },
    ],
    transitions: [
      { offset: 2 },
      { offset: 6 },
      { offset: 10 },
      { offset: 14 },
      { offset: 18 },
    ],
  });
  assert.equal(plan.momentCount, 3);
  assert.deepEqual(
    plan.moments.map((moment) => moment.type),
    ["source_slam", "context_reframe", "quote_impact"],
  );
  assert.equal(plan.moments[0].hyperframesUsed, true);
});

test("planHeroMomentsV21 falls back to end lock when no quote card exists", () => {
  const plan = planHeroMomentsV21({
    scenes: [
      { type: "opener", duration: 2 },
      { type: "card.source", duration: 4 },
      { type: "card.timeline", duration: 4 },
      { type: "card.takeaway", duration: 4 },
    ],
    transitions: [{ offset: 2 }, { offset: 6 }, { offset: 10 }],
  });
  assert.deepEqual(
    plan.moments.map((moment) => moment.type),
    ["source_slam", "context_reframe", "end_lock"],
  );
});

test("buildHeroMomentOverlayFilter emits edge-safe ffmpeg drawboxes", () => {
  const filter = buildHeroMomentOverlayFilter({
    inputLabel: "base",
    outputLabel: "hero",
    plan: {
      moments: [
        {
          type: "source_slam",
          overlayKind: "edge-slam",
          targetTimestampS: 2,
          pulseDurationS: 0.36,
        },
        {
          type: "context_reframe",
          overlayKind: "reframe-bracket",
          targetTimestampS: 10,
          pulseDurationS: 0.62,
        },
      ],
    },
  });
  assert.match(filter, /^\[base\]/);
  assert.match(filter, /\[hero\]$/);
  assert.match(filter, /drawbox=x=0:y=0/);
  assert.match(filter, /between\(t\\,2\.00\\,2\.36\)/);
  assert.match(filter, /drawbox=x=68:y=142/);
});
