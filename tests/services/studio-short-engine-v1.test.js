"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const editorial = require("../../lib/studio/editorial-layer");
const media = require("../../lib/studio/media-acquisition");
const premium = require("../../lib/studio/premium-card-lane");
const subtitles = require("../../lib/studio/subtitle-layer");
const sound = require("../../lib/studio/sound-layer");
const gate = require("../../lib/studio/quality-gate");
const {
  composeStudioSlate,
  sourceId,
  STILL_TYPES,
  SCENE_TYPES,
} = require("../../lib/scene-composer");

test("studio editorial builds a tighter Metro 2039 script", () => {
  const result = editorial.buildStudioEditorial({
    title: "METRO 2039 | Official Reveal Trailer",
    full_script:
      "So, this changes everything. But here is where it gets interesting. Follow Pulse Gaming so you never miss a beat.",
  });
  assert.equal(result.hookScore.pass, true);
  assert.equal(result.removedGenericCta, true);
  assert.ok(result.wordCount >= 120 && result.wordCount <= 150);
  assert.match(result.scriptForTTS, /twenty thirty-nine/);
});

test("media acquisition plans trailer slices and frame extraction", () => {
  const clipPlan = media.buildClipSlicePlan({
    trailerPath: "trailer.mp4",
    storyId: "abc",
    outputDir: "cache",
  });
  const framePlan = media.buildFrameExtractionPlan({
    trailerPath: "trailer.mp4",
    storyId: "abc",
    outputDir: "cache",
  });
  assert.equal(clipPlan.length, 3);
  assert.equal(framePlan.length, 6);
  assert.ok(clipPlan[0].output.includes("abc_clip_A.mp4"));
  assert.ok(framePlan[0].output.includes("abc_trailerframe_1.jpg"));
});

test("premium card lane converts duplicate source cards to context", () => {
  const scenes = [
    { type: SCENE_TYPES.CARD_SOURCE, label: "source_a", duration: 4 },
    { type: SCENE_TYPES.CARD_SOURCE, label: "source_b", duration: 4 },
  ];
  const result = premium.applyPremiumCardLane({
    scenes,
    story: { title: "METRO 2039 | Official Reveal Trailer" },
    root: "Z:/not-real",
  });
  assert.equal(result.scenes[0].type, SCENE_TYPES.CARD_SOURCE);
  assert.equal(result.scenes[1].type, SCENE_TYPES.CARD_STAT);
  assert.equal(result.premiumLane.duplicateSourceCardsConverted, 1);
});

test("subtitle inspection flags caption blackouts", () => {
  const ass = [
    "Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,Hello",
    "Dialogue: 0,0:00:05.50,0:00:06.00,Caption,,0,0,0,,Again",
  ].join("\n");
  const result = subtitles.inspectAss(ass, 10);
  assert.equal(result.blackoutRisk, true);
  assert.equal(result.status, "blackout-risk");
});

test("sound layer trims timestamp alignment at the CTA", () => {
  const alignment = {
    characters: Array.from("Story ends. Follow Pulse Gaming"),
    character_start_times_seconds: Array.from(
      { length: "Story ends. Follow Pulse Gaming".length },
      (_, i) => i * 0.1,
    ),
    character_end_times_seconds: Array.from(
      { length: "Story ends. Follow Pulse Gaming".length },
      (_, i) => i * 0.1 + 0.08,
    ),
  };
  const cutoff = sound.findCtaCutoff(alignment, 10);
  const trimmed = sound.trimAlignment(alignment, cutoff);
  assert.ok(cutoff < 2);
  assert.equal(trimmed.characters.join(""), "Story ends.");
});

test("sound layer converts fresh char alignment to word timestamps", () => {
  const alignment = {
    characters: Array.from("Metro twenty thirty-nine is real."),
    character_start_times_seconds: Array.from(
      { length: "Metro twenty thirty-nine is real.".length },
      (_, i) => i * 0.05,
    ),
    character_end_times_seconds: Array.from(
      { length: "Metro twenty thirty-nine is real.".length },
      (_, i) => i * 0.05 + 0.04,
    ),
  };
  const words = sound.wordsFromAlignment(alignment);
  assert.deepEqual(
    words.map((w) => w.word),
    ["Metro", "twenty", "thirty-nine", "is", "real."],
  );
});

test("studio composer uses an editorial card instead of repeating a still", () => {
  const mediaPlan = {
    clips: [
      { path: "clip-a.mp4" },
      { path: "clip-b.mp4" },
      { path: "clip-c.mp4" },
    ],
    trailerFrames: Array.from({ length: 6 }, (_, i) => ({
      path: `frame-${i + 1}.jpg`,
    })),
    articleHeroes: [{ path: "article-hero.jpg" }],
    publisherAssets: [],
    stockFillers: [],
  };
  const result = composeStudioSlate({
    story: { title: "METRO 2039 | Official Reveal Trailer", subreddit: "Games" },
    media: mediaPlan,
    audioDurationS: 63,
    opts: { allowStockFiller: false },
  });
  const seen = new Map();
  for (const scene of result.scenes) {
    if (!STILL_TYPES.has(scene.type)) continue;
    const id = sourceId(scene);
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  assert.equal([...seen.values()].some((count) => count > 1), false);
  assert.ok(result.scenes.some((scene) => scene.label === "card_known_unknowns"));
  assert.ok(result.scenes.some((scene) => scene.dateLabel === "NO DATE YET"));
});

test("quality gate reports non-slideshow when clips and cards carry the edit", () => {
  const scenes = [
    { type: "opener", isClipBacked: true, source: "a.mp4" },
    { type: "clip", source: "b.mp4" },
    { type: "clip", source: "c.mp4" },
    { type: "clip.frame", source: "f1.jpg" },
    { type: "card.source" },
    { type: "card.stat" },
    { type: "card.takeaway" },
  ];
  const report = gate.buildQualityReport({
    storyId: "x",
    branch: "test",
    output: { durationS: 55 },
    scenes,
    editorial: { hookScore: { pass: true, wordCount: 9 }, wordCount: 136 },
    mediaDiversity: { sourceMixScore: 90 },
    voice: { source: "local-liam-voxcpm-fixture" },
    subtitles: { status: "aligned", inspection: { blackoutRisk: false } },
    premiumLane: { verdict: "pass", hyperframesCardCount: 2 },
  });
  assert.equal(report.slideshowLikeVerdict, "not-slideshow-like");
  assert.equal(report.premiumLaneVerdict, "pass");
});
