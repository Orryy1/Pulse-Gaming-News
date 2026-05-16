"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

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
  CARD_TYPES,
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

test("studio editorial keeps Pokemon hooks complete and removes duplicate opening narration", () => {
  const previousBudget = process.env.STUDIO_EDITORIAL_MAX_WORDS;
  process.env.STUDIO_EDITORIAL_MAX_WORDS = "125";
  try {
    const result = editorial.buildStudioEditorial({
      title:
        "Mega Mewtwo's Pokémon Go debut finally announced and Go Fest Global is free for all players",
      hook:
        "Mega Mewtwo's finally coming to Pokémon Go, and Niantic just made a move nobody expected.",
      full_script:
        "Mega Mewtwo's finally coming to Pokémon Go, and Niantic just destroyed their entire paywall. According to Eurogamer, both Mega Mewtwo X and Y will debut during Go Fest 2026 on July 11th and 12th. That's the game's biggest annual celebration, and this year it's completely free. No premium ticket. No paywall. Every player gets access to the Special Research quest and the increased spawn rates that make legendary hunts actually worth your time. Niantic's decision to open Go Fest Global to all players signals a seismic shift in their monetisation strategy. They're recapturing players who walked away when ticket prices climbed into absurdity. Mega Mewtwo is the franchise's most iconic legendary. Dropping it behind a free event means millions will hunt.",
    });

    assert.equal(
      result.hook,
      "Mega Mewtwo is finally coming to Pokémon Go for free.",
    );
    assert.equal(result.hook.includes(" made a."), false);
    assert.equal(result.body.startsWith("Mega Mewtwo's finally coming"), false);
    assert.ok(result.wordCount <= 125);
    assert.match(result.scriptForCaption, /Pokémon Go/);
  } finally {
    if (previousBudget === undefined) delete process.env.STUDIO_EDITORIAL_MAX_WORDS;
    else process.env.STUDIO_EDITORIAL_MAX_WORDS = previousBudget;
  }
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

test("sound layer preserves repaired segment timing provenance when merging local voice", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sound-merge-"));
  const seg = path.join(tmp, "segment.mp3");
  const ts = path.join(tmp, "segment_timestamps.json");
  await fs.writeFile(seg, Buffer.from("not real mp3"));
  await fs.writeJson(ts, {
    characters: Array.from("Follow Pulse Gaming"),
    character_start_times_seconds: Array.from(
      { length: "Follow Pulse Gaming".length },
      (_, i) => i * 0.05,
    ),
    character_end_times_seconds: Array.from(
      { length: "Follow Pulse Gaming".length },
      (_, i) => i * 0.05 + 0.04,
    ),
    meta: {
      timestampRepair: {
        repaired: true,
        reason: "max_gap_too_large",
        strategy: "synthetic_full_duration",
        repairedInspection: { usable: true, reason: "usable" },
      },
    },
  });

  try {
    const merged = await sound.mergeSegmentAlignments([seg]);
    assert.equal(merged.meta.timestampRepair.reason, "segment_timestamp_repair");
    assert.equal(merged.meta.segmentTimestampRepairs.length, 1);
    assert.equal(
      merged.meta.segmentTimestampRepairs[0].strategy,
      "synthetic_full_duration",
    );
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
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
  assert.ok(
    result.scenes.some((scene) =>
      ["card_context", "card_timeline", "card_known_unknowns"].includes(scene.label),
    ),
  );
  assert.ok(result.scenes.some((scene) => scene.dateLabel === "NO DATE YET"));
});

test("studio composer does not pad thin media with repeated known-unknown cards", () => {
  const mediaPlan = {
    clips: [{ path: "clip-a.mp4" }, { path: "clip-b.mp4" }],
    trailerFrames: [{ path: "frame-1.jpg" }],
    articleHeroes: [],
    publisherAssets: [],
    stockFillers: [],
  };
  const result = composeStudioSlate({
    story: {
      title: "Pokemon Go Fest adds Mega Mewtwo",
      subreddit: "Eurogamer",
    },
    media: mediaPlan,
    audioDurationS: 76,
    opts: { allowStockFiller: false },
  });
  const knownUnknowns = result.scenes.filter(
    (scene) => scene.label === "card_known_unknowns",
  );
  const adjacentSameTypeCards = result.scenes.filter(
    (scene, index) =>
      index > 0 &&
      scene.type === result.scenes[index - 1].type &&
      scene.type.startsWith("card."),
  );

  assert.ok(result.scenes.length < 16);
  assert.ok(knownUnknowns.length <= 1);
  assert.equal(adjacentSameTypeCards.length, 0);
  assert.ok(
    result.scenes.every((scene) => scene.duration >= 3 && scene.duration <= 8),
  );
});

test("studio composer rotates card backdrops across enriched still decks", () => {
  const mediaPlan = {
    clips: [],
    trailerFrames: [],
    articleHeroes: Array.from({ length: 10 }, (_, i) => ({
      path: `verified-store-still-${i + 1}.jpg`,
    })),
    publisherAssets: [],
    stockFillers: [],
  };
  const result = composeStudioSlate({
    story: {
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      subreddit: "Games",
    },
    media: mediaPlan,
    audioDurationS: 63,
    opts: { allowStockFiller: false },
  });
  const cardBackdrops = result.scenes
    .filter((scene) => CARD_TYPES.has(scene.type) && scene.backgroundSource)
    .map((scene) => scene.backgroundSource);
  const uniqueBackdrops = new Set(cardBackdrops);
  const maxRepeat = Math.max(
    0,
    ...[...uniqueBackdrops].map(
      (source) => cardBackdrops.filter((item) => item === source).length,
    ),
  );

  assert.ok(uniqueBackdrops.size >= 4);
  assert.ok(maxRepeat <= 2);
});

test("studio composer labels RSS source cards as publishers, not subreddits", () => {
  const result = composeStudioSlate({
    story: {
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      source_type: "rss",
      subreddit: "GameSpot",
    },
    media: {
      clips: [],
      trailerFrames: [{ path: "gta-frame.jpg" }],
      articleHeroes: [{ path: "gta-hero.jpg" }],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 63,
    opts: { allowStockFiller: false },
  });

  const source = result.scenes.find((scene) => scene.label === "card_source");
  assert.equal(source.sourceLabel, "GameSpot");
});

test("studio composer carries exact entity labels into visual scenes for in-image popups", () => {
  const result = composeStudioSlate({
    story: { title: "Take-Two legacy franchise story" },
    audioDurationS: 61,
    media: {
      clips: [{ path: "gta-trailer.m3u8", entity: "GTA", sourceType: "steam_movie", mediaStartS: 28.5 }],
      trailerFrames: [{ path: "red-dead-frame.jpg", entity: "Red Dead", sourceType: "official_trailer_frame" }],
      articleHeroes: [{ path: "bioshock.jpg", entity: "BioShock", sourceType: "steam_header" }],
      publisherAssets: [],
      stockFillers: [],
    },
  });

  const visualScenes = result.scenes.filter((scene) =>
    [SCENE_TYPES.OPENER, SCENE_TYPES.CLIP, SCENE_TYPES.CLIP_FRAME, SCENE_TYPES.STILL].includes(scene.type),
  );

  assert.ok(visualScenes.some((scene) => scene.entity === "GTA"));
  assert.ok(visualScenes.some((scene) => scene.entity === "Red Dead"));
  assert.ok(visualScenes.some((scene) => scene.entity === "BioShock"));
  assert.equal(visualScenes.find((scene) => scene.entity === "GTA").mediaStartS, 28.5);
});

test("studio composer preserves validated official clip timing windows", () => {
  const result = composeStudioSlate({
    story: { title: "Marathon trailer proof" },
    audioDurationS: 66,
    media: {
      clips: [
        {
          path: "marathon-trailer.m3u8",
          entity: "Marathon",
          sourceType: "steam_movie",
          mediaStartS: 42.45,
          durationS: 2.85,
          provenance: {
            clip_start_policy: "validated_trimmed_segment_window",
            segment_trim_recommended: true,
            segment_original_start_s: 42,
            segment_original_duration_s: 5,
            segment_recommended_start_s: 42.45,
            segment_recommended_duration_s: 2.85,
          },
        },
      ],
      trailerFrames: [{ path: "marathon-frame.jpg", entity: "Marathon" }],
      articleHeroes: [],
      publisherAssets: [],
      stockFillers: [],
    },
    opts: { allowStockFiller: false, flashLane: true },
  });

  const opener = result.scenes.find((scene) => scene.type === SCENE_TYPES.OPENER);

  assert.equal(opener.mediaStartS, 42.45);
  assert.equal(opener.clipDurationS, 2.85);
  assert.equal(
    opener.clipTimingProvenance.clip_start_policy,
    "validated_trimmed_segment_window",
  );
  assert.equal(opener.clipTimingProvenance.segment_recommended_duration_s, 2.85);
});

test("studio composer does not present RSS excerpts as Reddit comments", () => {
  const result = composeStudioSlate({
    story: {
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      source_type: "rss",
      subreddit: "GameSpot",
      top_comment:
        "Take-Two boss Strauss Zelnick has shared a story about passing on making a sequel.",
    },
    media: {
      clips: [],
      trailerFrames: [{ path: "gta-frame.jpg" }],
      articleHeroes: [{ path: "gta-hero.jpg" }],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 63,
    opts: { allowStockFiller: false },
  });

  assert.equal(
    result.scenes.some((scene) => scene.type === SCENE_TYPES.CARD_QUOTE),
    false,
  );
});

test("studio composer avoids no-date release cards on non-release publisher stories", () => {
  const result = composeStudioSlate({
    story: {
      title:
        "GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One",
      source_type: "rss",
      subreddit: "GameSpot",
      classification: "News",
    },
    media: {
      clips: [],
      trailerFrames: [{ path: "gta-frame.jpg" }, { path: "red-dead-frame.jpg" }],
      articleHeroes: [{ path: "gta-hero.jpg" }, { path: "bioshock-hero.jpg" }],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 63,
    opts: { allowStockFiller: false },
  });

  assert.equal(
    result.scenes.some((scene) => scene.dateLabel === "NO DATE YET"),
    false,
  );
});

test("studio composer builds a footage-led Flash Lane slate from official clip refs", () => {
  const result = composeStudioSlate({
    story: {
      title:
        "GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One",
      source_type: "rss",
      subreddit: "GameSpot",
    },
    media: {
      clips: [
        { path: "gta-trailer.m3u8", entity: "GTA", sourceType: "steam_movie", mediaStartS: 28.5 },
        { path: "bioshock-trailer.m3u8", entity: "BioShock", sourceType: "steam_movie", mediaStartS: 24 },
        { path: "red-dead-trailer.m3u8", entity: "Red Dead", sourceType: "steam_movie", mediaStartS: 30 },
        { path: "gta-trailer.m3u8", entity: "GTA", sourceType: "steam_movie", mediaStartS: 34.5 },
        { path: "bioshock-trailer.m3u8", entity: "BioShock", sourceType: "steam_movie", mediaStartS: 36 },
        { path: "red-dead-trailer.m3u8", entity: "Red Dead", sourceType: "steam_movie", mediaStartS: 38 },
        { path: "gta-trailer.m3u8", entity: "GTA", sourceType: "steam_movie", mediaStartS: 42 },
        { path: "bioshock-trailer.m3u8", entity: "BioShock", sourceType: "steam_movie", mediaStartS: 48 },
      ],
      trailerFrames: [
        { path: "gta-frame.jpg", entity: "GTA" },
        { path: "bioshock-frame.jpg", entity: "BioShock" },
        { path: "red-dead-frame.jpg", entity: "Red Dead" },
      ],
      articleHeroes: [{ path: "gta-hero.jpg", entity: "GTA", sourceType: "steam_header" }],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 63,
    opts: { allowStockFiller: false, flashLane: true },
  });

  const actualClipScenes = result.scenes.filter(
    (scene) =>
      scene.type === SCENE_TYPES.CLIP ||
      scene.type === SCENE_TYPES.PUNCH ||
      scene.type === SCENE_TYPES.SPEED_RAMP ||
      scene.type === SCENE_TYPES.FREEZE_FRAME ||
      (scene.type === SCENE_TYPES.OPENER && scene.isClipBacked === true),
  );
  const clipRatio = actualClipScenes.length / result.scenes.length;
  const mediaStarts = new Set(actualClipScenes.map((scene) => scene.mediaStartS));
  const approvedStarts = new Set([28.5, 24, 30, 34.5, 36, 38, 42, 48]);
  const sourceCardIndex = result.scenes.findIndex((scene) => scene.type === SCENE_TYPES.CARD_SOURCE);
  const coverStillScenes = result.scenes.filter(
    (scene) => scene.type === SCENE_TYPES.STILL && /(?:header|hero|cover|capsule)/i.test(scene.sourceType || ""),
  );
  const maxClipSourceUse = Math.max(
    0,
    ...[...new Set(actualClipScenes.map((scene) => scene.source))].map(
      (source) => actualClipScenes.filter((scene) => scene.source === source).length,
    ),
  );

  assert.ok(result.scenes.length >= 12);
  assert.ok(clipRatio >= 0.5, `expected Flash clip ratio >= .5, got ${clipRatio}`);
  assert.ok(mediaStarts.size >= 3);
  assert.ok([...mediaStarts].every((start) => approvedStarts.has(start)));
  assert.ok(sourceCardIndex > 2, `expected Flash source card after hook section, got ${sourceCardIndex}`);
  assert.equal(coverStillScenes.length, 0);
  assert.ok(maxClipSourceUse <= 3, `expected no clip source over 3 uses, got ${maxClipSourceUse}`);
  assert.equal(actualClipScenes.length, 8);
  assert.ok(result.scenes.some((scene) => scene.type === SCENE_TYPES.PUNCH));
  assert.ok(result.scenes.some((scene) => scene.type === SCENE_TYPES.SPEED_RAMP));
  assert.ok(result.scenes.some((scene) => scene.type === SCENE_TYPES.FREEZE_FRAME && scene.caption));
  assert.ok(
    result.scenes
      .filter((scene) => CARD_TYPES.has(scene.type))
      .every((scene) => scene.cardTreatment === "flash_lane"),
  );
});

test("studio composer keeps Flash Lane takeaway as the final card", () => {
  const result = composeStudioSlate({
    story: {
      title: "LEGO Batman PC specs revealed",
      source_type: "reddit",
      subreddit: "GamingLeaksAndRumours",
      top_comment: "The specs sheet is the real story here.",
    },
    media: {
      clips: Array.from({ length: 11 }, (_, index) => ({
        path: `lego-trailer-${index}.m3u8`,
        entity: "LEGO Batman",
        sourceType: "steam_movie",
        mediaStartS: 40 + index * 4,
      })),
      trailerFrames: Array.from({ length: 6 }, (_, index) => ({
        path: `lego-frame-${index + 1}.jpg`,
        entity: "LEGO Batman",
      })),
      articleHeroes: [],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 66,
    opts: {
      allowStockFiller: false,
      flashLane: true,
      sourceCardMode: "overlay",
    },
  });

  assert.equal(result.scenes.at(-1).type, SCENE_TYPES.CARD_TAKEAWAY);
  assert.notEqual(sourceId(result.scenes.at(-1)), sourceId(result.scenes.at(-2)));
});

test("studio composer does not stretch too few Flash Lane clips past the reuse budget", () => {
  const result = composeStudioSlate({
    story: {
      title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
      source_type: "rss",
      subreddit: "GameSpot",
    },
    media: {
      clips: [
        { path: "gta-trailer.m3u8", entity: "GTA", sourceType: "steam_movie", mediaStartS: 28.5 },
        { path: "bioshock-trailer.m3u8", entity: "BioShock", sourceType: "steam_movie", mediaStartS: 24 },
      ],
      trailerFrames: [
        { path: "gta-frame.jpg", entity: "GTA" },
        { path: "bioshock-frame.jpg", entity: "BioShock" },
        { path: "red-dead-frame.jpg", entity: "Red Dead" },
      ],
      articleHeroes: [{ path: "gta-hero.jpg", entity: "GTA" }],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 66,
    opts: { allowStockFiller: false, flashLane: true },
  });
  const actualClipScenes = result.scenes.filter(
    (scene) =>
      scene.type === SCENE_TYPES.CLIP ||
      scene.type === SCENE_TYPES.PUNCH ||
      scene.type === SCENE_TYPES.SPEED_RAMP ||
      scene.type === SCENE_TYPES.FREEZE_FRAME ||
      (scene.type === SCENE_TYPES.OPENER && scene.isClipBacked === true),
  );

  assert.ok(actualClipScenes.length <= 6);
});

test("studio composer can move Flash source proof to overlay mode instead of a full-screen source card", () => {
  const baseArgs = {
    story: {
      title: "Marathon Drops To 15K Daily CCU Peak On Steam",
      source_type: "rss",
      subreddit: "GameSpot",
    },
    media: {
      clips: Array.from({ length: 8 }, (_, index) => ({
        path: `marathon-${index}.mp4`,
        entity: "Marathon",
        sourceType: "steam_movie",
        mediaStartS: 42 + index * 4,
      })),
      trailerFrames: [
        { path: "marathon-frame-a.jpg", entity: "Marathon" },
        { path: "marathon-frame-b.jpg", entity: "Marathon" },
      ],
      articleHeroes: [],
      publisherAssets: [],
      stockFillers: [],
    },
    audioDurationS: 64,
  };
  const defaultResult = composeStudioSlate({
    ...baseArgs,
    opts: { allowStockFiller: false, flashLane: true },
  });
  const result = composeStudioSlate({
    ...baseArgs,
    opts: {
      allowStockFiller: false,
      flashLane: true,
      sourceCardMode: "overlay",
    },
  });

  assert.equal(result.scenes.some((scene) => scene.type === SCENE_TYPES.CARD_SOURCE), false);
  assert.ok(result.metrics.clipCount >= 6);
  assert.equal(defaultResult.scenes.some((scene) => scene.type === SCENE_TYPES.CARD_SOURCE), true);
  assert.ok(result.metrics.cardCount < defaultResult.metrics.cardCount);
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
