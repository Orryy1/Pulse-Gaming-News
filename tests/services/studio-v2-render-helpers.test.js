"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  appendStudioOutro,
  boostMotionDensityForShorts,
  replaceFallbackReleaseCardsWithMotion,
  resolveMainNarrationDurationS,
  resolveSubtitleScriptText,
  sumSceneDurations,
} = require("../../tools/studio-v2-render");

function pulseStory(overrides = {}) {
  return {
    id: "render-helper-story",
    title: "Xbox changes Game Pass",
    editorial_lane_id: "platform_pulse",
    hook_type: "direct",
    duration_band_id: "platform_pulse_short_30_36",
    cta: "",
    ...overrides,
  };
}

test("fallback release cards become authored motion beats when HyperFrames lane is rich", () => {
  const scenes = [
    {
      type: SCENE_TYPES.CARD_SOURCE,
      label: "card_source",
      duration: 5,
      premiumLane: "hyperframes",
      prerenderedMp4: "hf_source.mp4",
    },
    {
      type: SCENE_TYPES.CARD_RELEASE,
      label: "card_known_unknowns",
      duration: 5,
      backgroundSource: "backdrop.jpg",
    },
    {
      type: SCENE_TYPES.CARD_RELEASE,
      label: "card_release",
      duration: 5,
      backgroundSource: "backdrop.jpg",
    },
    {
      type: SCENE_TYPES.CARD_TAKEAWAY,
      label: "card_takeaway",
      duration: 5,
      premiumLane: "hyperframes",
      prerenderedMp4: "hf_takeaway.mp4",
    },
  ];

  const result = replaceFallbackReleaseCardsWithMotion({
    scenes,
    story: {
      title:
        "Mega Mewtwo's Pokemon Go debut finally announced and Go Fest Global is free for all players",
    },
    mediaClips: [{ path: "C:\\clips\\clip_A.mp4" }, { path: "C:\\clips\\clip_B.mp4" }],
    hyperframesCardCount: 5,
  });

  assert.equal(result.replacements.length, 2);
  assert.equal(result.scenes[1].sceneType, "freeze-frame");
  assert.equal(result.scenes[1].authored, true);
  assert.match(result.scenes[1].caption, /FREE GLOBAL/i);
  assert.equal(result.scenes[2].sceneType, "freeze-frame");
  assert.match(result.scenes[2].caption, /NO PREMIUM/i);
  assert.equal(
    result.scenes.filter((scene) => scene.type === SCENE_TYPES.CARD_RELEASE)
      .length,
    0,
  );
});

test("fallback release replacement is skipped when there are not enough clips", () => {
  const result = replaceFallbackReleaseCardsWithMotion({
    scenes: [
      {
        type: SCENE_TYPES.CARD_RELEASE,
        label: "card_release",
        duration: 5,
      },
    ],
    story: { title: "Story" },
    mediaClips: [],
    hyperframesCardCount: 5,
  });

  assert.equal(result.replacements.length, 0);
  assert.equal(result.scenes[0].type, SCENE_TYPES.CARD_RELEASE);
});

test("motion density boost splits a long motion scene without changing duration", () => {
  const scenes = [
    { type: SCENE_TYPES.CLIP, label: "clip_a", source: "C:\\clips\\a.mp4", duration: 8 },
    { type: SCENE_TYPES.CARD_SOURCE, label: "card_source", duration: 5 },
    { type: "outro", label: "outro", duration: 4 },
  ];

  const result = boostMotionDensityForShorts({
    scenes,
    mediaClips: [{ path: "C:\\clips\\a.mp4" }, { path: "C:\\clips\\b.mp4" }],
    audioDurationS: 60,
    minPerMinute: 3,
  });

  assert.equal(result.applied.length, 1);
  assert.equal(result.scenes.length, 4);
  assert.equal(sumSceneDurations(result.scenes), sumSceneDurations(scenes));
  assert.equal(result.scenes[0].sceneType, "punch");
  assert.equal(result.scenes[1].sceneType, "punch");
});

test("studio brand close reserves the tail without extending the selected duration band", () => {
  const scenes = [
    { type: "opener", label: "opener", duration: 20 },
    { type: SCENE_TYPES.CARD_TAKEAWAY, label: "card_takeaway", duration: 13 },
  ];

  const result = appendStudioOutro({
    scenes,
    story: pulseStory({ id: "rss_ca673f22ddbbbdfc" }),
    root: "C:\\repo",
    brandCloseDurationS: 3,
    voiceDurationS: 33,
    hfOutroPath: "C:\\repo\\test\\output\\hf_outro_card_rss_ca673f22ddbbbdfc.mp4",
  });

  assert.equal(result.appended, true);
  assert.equal(result.outroScene.type, "brand_close");
  assert.equal(result.outroScene.premiumLane, "hyperframes");
  assert.equal(result.outroScene.prerenderedMp4.endsWith("hf_outro_card_rss_ca673f22ddbbbdfc.mp4"), true);
  assert.equal(result.outroScene.duration, 3);
  assert.equal(sumSceneDurations(result.scenes), 33);
});

test("studio brand close keeps an in-band longer slate at its original duration", () => {
  const result = appendStudioOutro({
    scenes: [{ type: "opener", label: "opener", duration: 48 }],
    story: pulseStory({
      id: "story-1",
      editorial_lane_id: "trailer_truth_check",
      duration_band_id: "trailer_truth_standard_38_48",
    }),
    root: "C:\\repo",
    brandCloseDurationS: 3,
    voiceDurationS: 48,
  });

  assert.equal(result.appended, true);
  assert.equal(result.outroScene.duration, 3);
  assert.equal(sumSceneDurations(result.scenes), 48);
});

test("studio brand close fails closed when narration is outside the selected band", () => {
  assert.throws(
    () =>
      appendStudioOutro({
        scenes: [{ type: "opener", label: "opener", duration: 40 }],
        story: pulseStory(),
        voiceDurationS: 40,
      }),
    /audio_duration_above_selected_band/,
  );
});

test("studio brand close fails closed without explicit editorial metadata", () => {
  assert.throws(
    () =>
      appendStudioOutro({
        scenes: [{ type: "opener", label: "opener", duration: 33 }],
        story: { id: "metadata-missing" },
        voiceDurationS: 33,
      }),
    /pulse_editorial_contract_metadata_missing/,
  );
});

test("main slate duration always follows the complete governed narration", () => {
  assert.equal(
    resolveMainNarrationDurationS({
      audioDurationS: 60.2,
      voice: { outroStartS: 54.7 },
    }),
    60.2,
  );
  assert.equal(
    resolveMainNarrationDurationS({
      audioDurationS: 60.2,
      voice: { outroStartS: 61 },
    }),
    60.2,
  );
});

test("subtitle script text follows the actual governed voice transcript", () => {
  const text = resolveSubtitleScriptText({
    voice: { editorialScriptAppliedToAudio: true },
    tsData: {
      meta: {
        text: "Mega Mewtwo is coming. Would the free event bring you back?",
      },
    },
    editorial: { scriptForCaption: "Mega Mewtwo is coming." },
    spokenTranscript: "Mega Mewtwo is coming.",
  });

  assert.match(text, /Would the free event bring you back/);
  assert.doesNotMatch(text, /\b(?:follow|subscribe)\b/i);
});
