"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  appendStudioOutro,
  assertStudioV2VoiceAllowedForRender,
  boostMotionDensityForShorts,
  replaceFallbackReleaseCardsWithMotion,
  resolveMainNarrationDurationS,
  resolveSubtitleScriptText,
  sumSceneDurations,
} = require("../../tools/studio-v2-render");

const ACCEPTED_SLEEPY_LIAM = {
  id: "pulse-sleepy-liam-20260502",
  fileName: "pulse_liam_sleepy.wav",
  referencePresent: true,
  referenceHash: "d".repeat(40),
};

function proofAudioPath(name = "studio-v2-render-helper.mp3") {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(process.cwd(), "test", "output", "tmp-studio-v2-render-helpers");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "fake studio v2 voice bytes");
  return file;
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

test("studio outro extends short renders beyond the TikTok one-minute floor", () => {
  const scenes = [
    { type: "opener", label: "opener", duration: 30 },
    { type: SCENE_TYPES.CARD_TAKEAWAY, label: "card_takeaway", duration: 24.79 },
  ];

  const result = appendStudioOutro({
    scenes,
    storyId: "rss_ca673f22ddbbbdfc",
    root: "C:\\repo",
    minRuntimeS: 61,
    minOutroDurationS: 4,
    hfOutroPath: "C:\\repo\\test\\output\\hf_outro_card_rss_ca673f22ddbbbdfc.mp4",
  });

  assert.equal(result.appended, true);
  assert.equal(result.outroScene.type, "outro");
  assert.equal(result.outroScene.premiumLane, "hyperframes");
  assert.equal(result.outroScene.prerenderedMp4.endsWith("hf_outro_card_rss_ca673f22ddbbbdfc.mp4"), true);
  assert.ok(sumSceneDurations(result.scenes) >= 61);
});

test("studio outro still adds a branded end beat when the slate is already long", () => {
  const result = appendStudioOutro({
    scenes: [{ type: "opener", label: "opener", duration: 64 }],
    storyId: "story-1",
    root: "C:\\repo",
    minRuntimeS: 61,
    minOutroDurationS: 4,
  });

  assert.equal(result.appended, true);
  assert.equal(result.outroScene.duration, 4);
  assert.equal(sumSceneDurations(result.scenes), 68);
});

test("studio outro covers a spoken voice tail even when the one-minute floor is lower", () => {
  const result = appendStudioOutro({
    scenes: [{ type: "opener", label: "opener", duration: 54 }],
    storyId: "story-1",
    root: "C:\\repo",
    minRuntimeS: 57,
    minOutroDurationS: 2,
    voiceDurationS: 60.2,
  });

  assert.equal(result.outroScene.duration, 6.2);
  assert.equal(sumSceneDurations(result.scenes), 60.2);
});

test("main slate duration ends before the spoken outro when voice metadata exposes it", () => {
  assert.equal(
    resolveMainNarrationDurationS({
      audioDurationS: 60.2,
      voice: { outroStartS: 54.7 },
    }),
    54.7,
  );
  assert.equal(
    resolveMainNarrationDurationS({
      audioDurationS: 60.2,
      voice: { outroStartS: 61 },
    }),
    60.2,
  );
});

test("subtitle script text follows the actual voice transcript including outro", () => {
  const text = resolveSubtitleScriptText({
    voice: { editorialScriptAppliedToAudio: true },
    tsData: {
      meta: {
        text: "Mega Mewtwo is coming. Follow Pulse Gaming so you never miss a beat.",
      },
    },
    editorial: { scriptForCaption: "Mega Mewtwo is coming." },
    spokenTranscript: "Mega Mewtwo is coming.",
  });

  assert.match(text, /Follow Pulse Gaming/);
});

test("studio-v2 render voice assertion rejects local audio without accepted Sleepy Liam reference", () => {
  assert.throws(
    () =>
      assertStudioV2VoiceAllowedForRender({
        voice: {
          provider: "local",
          source: "local-production-voxcpm-path",
          audioPath: proofAudioPath("missing-reference.mp3"),
        },
        tsData: {
          meta: {
            text: "A clean update. Follow Pulse Gaming so you never miss a beat.",
            acoustic: { medianPitchHz: 118 },
          },
        },
        spokenTranscript: "A clean update. Follow Pulse Gaming so you never miss a beat.",
        env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
      }),
    /accepted Sleepy Liam voice reference/i,
  );
});

test("studio-v2 render voice assertion rejects accepted local audio without acoustic proof", () => {
  assert.throws(
    () =>
      assertStudioV2VoiceAllowedForRender({
        voice: {
          provider: "local",
          source: "local-production-voxcpm-path",
          audioPath: proofAudioPath("missing-acoustic.mp3"),
          acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
        },
        tsData: {
          meta: {
            text: "A clean update. Follow Pulse Gaming so you never miss a beat.",
            acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
          },
        },
        spokenTranscript: "A clean update. Follow Pulse Gaming so you never miss a beat.",
        env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
      }),
    /missing pitch or spoken-outro verification/i,
  );
});

test("studio-v2 render voice assertion allows approved Sleepy Liam evidence before render", () => {
  const narration = assertStudioV2VoiceAllowedForRender({
    voice: {
      provider: "local",
      source: "local-production-voxcpm-path",
      audioPath: proofAudioPath("approved-sleepy-liam.mp3"),
      acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
    },
    tsData: {
      meta: {
        text: "A clean update. Follow Pulse Gaming so you never miss a beat.",
        acoustic: { medianPitchHz: 118 },
        acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
      },
    },
    spokenTranscript: "A clean update. Follow Pulse Gaming so you never miss a beat.",
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "true" },
  });

  assert.equal(narration.provider, "local");
  assert.equal(narration.acceptedLocalVoice.id, "pulse-sleepy-liam-20260502");
  assert.equal(narration.acoustic.medianPitchHz, 118);
});

test("studio-v2 render calls voice assertion before sound-layer/ffmpeg input construction", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-render.js"),
    "utf8",
  );

  assert.match(src, /assertNarrationAllowedForProof/);
  assert.ok(
    src.indexOf("const voiceRenderNarration = assertStudioV2VoiceAllowedForRender") >
      src.indexOf("const spokenTranscript = scriptFromTimestampAlignment"),
  );
  assert.ok(
    src.indexOf("const voiceRenderNarration = assertStudioV2VoiceAllowedForRender") <
      src.indexOf("const renderStory ="),
  );
  assert.ok(
    src.indexOf("const voiceRenderNarration = assertStudioV2VoiceAllowedForRender") <
      src.indexOf("buildSoundLayerV2({"),
  );
});
