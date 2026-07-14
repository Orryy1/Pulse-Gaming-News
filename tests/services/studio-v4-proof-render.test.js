"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  buildOverlayLayout,
  buildClipScenePlan,
  buildSceneCompositeFilterParts,
  buildOverlayChain,
  overlayCardWindowsForStory,
  drawtextEscape,
  parseArgs,
  renderNarrationScriptText,
  resolveReadableMediaPath,
  resolveStoryMusicCueMix,
  subtitleWordsFromTimestampPayload,
  validateProofTimestampPayload,
  assertProofAudioSegmentLoudness,
  resolveStorySfxCueMix,
  resolveStorySfxPaths,
  directClipMaxScenes,
  directClipMaxVisibleDwellS,
  buildFinalSocialAudioMixFilter,
  scenePlanBlockerDiagnostic,
} = require("../../tools/studio-v4-proof-render");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../../lib/studio/v4/render-policy");
const { buildKineticAss } = require("../../lib/studio/v2/subtitle-layer-v2");
const proofRenderLib = require("../../lib/studio/v4/proof-render");

test("Studio V4 proof renderer plans motion-only scenes across full narration", () => {
  const plan = buildClipScenePlan({
    clips: ["a.mp4", "b.mp4", "c.mp4"],
    durationS: 18,
    xfadeS: 0.25,
  });

  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.segmentDurationS, 6.17);
  assert.deepEqual(plan.scenes.map((scene) => scene.path), ["a.mp4", "b.mp4", "c.mp4"]);
});

test("Studio V4 proof renderer refuses to repeat clips just to cap direct dwell", () => {
  const plan = buildClipScenePlan({
    clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4", "f.mp4", "g.mp4", "h.mp4"],
    durationS: 42.237,
    xfadeS: 0.25,
    maxSceneDurationS: 3,
  });

  assert.equal(plan.scenes.length, 8);
  assert.deepEqual(
    plan.scenes.map((scene) => scene.path),
    ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4", "f.mp4", "g.mp4", "h.mp4"],
  );
  assert.ok(plan.segmentDurationS > 3);
  assert.equal(plan.repeatFree, true);
  assert.equal(plan.requiredUniqueClipCount, 16);
  assert.equal(plan.availableUniqueClipCount, 8);
  assert.ok(plan.blockers.includes("direct_motion_clip_diversity_below_dwell_floor"));
});

test("Studio V4 proof renderer blocks 50s renders that would need looped direct clips", () => {
  const plan = buildClipScenePlan({
    clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4", "f.mp4", "g.mp4", "h.mp4"],
    durationS: 50.6,
    xfadeS: 0.25,
    maxSceneDurationS: 2.1,
  });

  assert.equal(plan.scenes.length, 8);
  assert.deepEqual(
    plan.scenes.map((scene) => scene.path),
    ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4", "f.mp4", "g.mp4", "h.mp4"],
  );
  assert.ok(plan.blockers.includes("direct_motion_clip_diversity_below_dwell_floor"));
  assert.equal(plan.repeatFree, true);
  assert.equal(plan.availableUniqueClipCount, 8);
  assert.ok(plan.requiredUniqueClipCount > 24);
});

test("Studio V4 proof renderer refuses repeated direct-video windows from one base source", () => {
  const clips = [36, 42, 48, 54, 60, 66, 72, 78].map((windowStart) => ({
    path: `gta-trailer-window-${windowStart}.mp4`,
    source_url: "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    base_source_family: "url:https://media.rockstargames.com/vi/downloads/videos/gtavi_trailer_2/gtavi_trailer_2.mp4",
    source_family: `rockstar_gta_vi_official_videos__media_02_gtavi_trailer_2_window_${windowStart}_5`,
    motion_family: `rockstar_gta_vi_official_videos__media_02_gtavi_trailer_2_window_${windowStart}_5`,
    media_kind: "direct_video",
    durationS: 5,
  }));

  const plan = buildClipScenePlan({
    clips,
    durationS: 36.96,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.scenes.length, 1);
  assert.ok(plan.blockers.includes("direct_motion_clip_diversity_below_dwell_floor"));
  assert.ok(plan.blockers.includes("approved_scene_duration_below_audio_duration"));
  assert.equal(plan.skippedDuplicateBaseSources.length, 7);
  assert.deepEqual(
    [...new Set(plan.skippedDuplicateBaseSources.map((entry) => entry.key))],
    ["media.rockstargames.com/vi/downloads/videos/gtavi_trailer_2/gtavi_trailer_2"],
  );
});

test("Studio V4 proof renderer blocks premium shorts dominated by one direct-video source", () => {
  const clips = [12, 18, 24, 30, 36, 42, 48].map((windowStart) => ({
    path: `sea-trailer-window-${windowStart}.mp4`,
    source_url: "https://cdn.example.com/sea-of-thieves/official-gameplay-trailer.mp4",
    source_family: `sea_of_thieves_official_gameplay_trailer_window_${windowStart}_5`,
    motion_family: `sea_of_thieves_official_gameplay_trailer_window_${windowStart}_5`,
    media_kind: "direct_video",
    durationS: 5,
  }));

  const plan = buildClipScenePlan({
    clips,
    durationS: 36.4,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.scenes.length, 1);
  assert.ok(plan.blockers.includes("direct_motion_clip_diversity_below_dwell_floor"));
  assert.ok(plan.blockers.includes("approved_scene_duration_below_audio_duration"));
  assert.equal(plan.skippedDuplicateBaseSources.length, 6);
});

test("Studio V4 proof renderer reports the exact concentrated source and coverage gap", () => {
  const diagnostic = scenePlanBlockerDiagnostic(
    {
      blockers: [
        "direct_motion_source_concentration_above_premium_floor",
        "approved_scene_duration_below_audio_duration",
      ],
      availableUniqueClipCount: 13,
      requiredUniqueClipCount: 13,
      coveredDurationS: 49.82,
      directMotionSourceConcentrationMetrics: {
        direct_motion_scene_count: 9,
        max_scenes_per_source_root: 2,
        max_source_concentration_ratio: 0.25,
        concentrated_sources: [
          { key: "youtube:xbox/paleo-pines-major-update", count: 3, ratio: 0.333 },
        ],
      },
    },
    { targetDurationS: 50 },
  );

  assert.match(diagnostic, /source=youtube:xbox\/paleo-pines-major-update/);
  assert.match(diagnostic, /count=3/);
  assert.match(diagnostic, /ratio=0\.333/);
  assert.match(diagnostic, /max_ratio=0\.25/);
  assert.match(diagnostic, /covered=49\.82/);
  assert.match(diagnostic, /target=50/);
  assert.match(diagnostic, /missing=0\.18/);
});

test("Studio V4 proof renderer allows balanced second windows when coverage needs them", () => {
  const roots = ["a", "b", "c", "d", "e", "f"];
  const directClips = [
    ...roots.map((root) => [root, 36]),
    ["b", 42],
    ["c", 42],
  ].map(([root, windowStart]) => ({
    path: `star-wars-${root}-window-${windowStart}.mp4`,
    source_url: `https://video.akamai.steamstatic.com/store_trailers/3936610/${root}/trailer/hls_264_master.m3u8`,
    source_type: "steam_movie",
    source_kind: "video_file",
    source_family: `steamstatic:/store_trailers/3936610/${root}/trailer_window_${windowStart}_5`,
    motion_family: `steamstatic:/store_trailers/3936610/${root}/trailer_window_${windowStart}_5`,
    media_kind: "direct_video",
    durationS: 5,
  }));
  const plan = buildClipScenePlan({
    clips: [
      ...directClips.slice(0, 4),
      {
        path: "output/generated-motion/star-wars/source-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_source_card",
        text: "SOURCE LOCKED",
        durationS: 12,
        minimum_readable_duration_s: 12,
      },
      ...directClips.slice(4),
    ],
    durationS: 42.028,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.equal(plan.blockers.includes("direct_motion_source_concentration_above_premium_floor"), false);
  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.skippedDuplicateBaseSources.length, 0);
  assert.equal(plan.scenes.filter((scene) => !scene.readableCardKind).length, 8);
  assert.equal(plan.scenes.filter((scene) => scene.readableCardKind).length, 1);
});

test("Studio V4 proof renderer defaults to readable non-repeating direct-motion cuts", () => {
  const previousDwell = process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S;
  const previousScenes = process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES;
  delete process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S;
  delete process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES;
  try {
    assert.equal(directClipMaxVisibleDwellS(), 7);
    assert.equal(directClipMaxScenes(), 40);

    const plan = buildClipScenePlan({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4", "f.mp4", "g.mp4", "h.mp4"],
      durationS: 46.344,
      xfadeS: 0.25,
      maxSceneDurationS: directClipMaxVisibleDwellS(),
      maxScenes: directClipMaxScenes(),
    });

    assert.equal(plan.scenes.length, 8);
    assert.equal(plan.repeatFree, true);
    assert.equal(plan.blockers.length, 0);
    assert.equal(plan.requiredUniqueClipCount, 8);
    assert.ok(plan.segmentDurationS < directClipMaxVisibleDwellS());
  } finally {
    if (previousDwell === undefined) delete process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S;
    else process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S = previousDwell;
    if (previousScenes === undefined) delete process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES;
    else process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES = previousScenes;
  }
});

test("Studio V4 proof renderer can explicitly plan legacy repeated clips for diagnostics only", () => {
  const plan = buildClipScenePlan({
    clips: ["a.mp4", "b.mp4", "c.mp4"],
    durationS: 12,
    xfadeS: 0.25,
    maxSceneDurationS: 2,
    allowClipReuse: true,
  });

  assert.equal(plan.repeatFree, false);
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(
    plan.scenes.map((scene) => scene.path),
    ["a.mp4", "b.mp4", "c.mp4", "a.mp4", "b.mp4", "c.mp4", "a.mp4"],
  );
});

test("Studio V4 proof renderer skips repeated base-source windows before render", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "sea-window-36.mp4",
        source_family: "steam_1172620_movie_418022350_window_36_5",
      },
      {
        path: "sea-window-42.mp4",
        source_family: "steam_1172620_movie_418022350_window_42_5",
      },
      {
        path: "sea-store-page.mp4",
        source_family: "sea_of_thieves_store_page_gameplay",
      },
    ],
    durationS: 12,
    xfadeS: 0.25,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.deepEqual(plan.repeatedBaseSources, []);
  assert.equal(plan.scenes.length, 2);
  assert.deepEqual(plan.skippedDuplicateBaseSources.map((entry) => entry.key), [
    "steam_1172620_movie_418022350",
  ]);
});

test("Studio V4 proof renderer skips repeated base-source windows from string clip paths", () => {
  const plan = buildClipScenePlan({
    clips: [
      "motion/sea-of-thieves-trailer-window-36-5.mp4",
      "motion/sea-of-thieves-trailer-window-42-5.mp4",
      "motion/sea-of-thieves-store-page-gameplay.mp4",
    ],
    durationS: 12,
    xfadeS: 0.25,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.deepEqual(plan.repeatedBaseSources, []);
  assert.equal(plan.scenes.length, 2);
  assert.deepEqual(plan.skippedDuplicateBaseSources.map((entry) => entry.key), [
    "motion/sea-of-thieves-trailer",
  ]);
});

test("Studio V4 proof renderer blocks generated direct-motion segment variants from the same source clip", () => {
  const plan = buildClipScenePlan({
    clips: [
      "output/fresh-green-refill-20260619/goal-proof-batch/rss_story/rss_story_v4_clip_1_segment_direct_motion_1_a1b2c3d4.mp4",
      "output/fresh-green-refill-20260619/goal-proof-batch/rss_story/rss_story_v4_clip_1_segment_direct_motion_2_e5f6a7b8.mp4",
      "output/fresh-green-refill-20260619/goal-proof-batch/rss_story/rss_story_v4_clip_2_segment_direct_motion_1_c9d0e1f2.mp4",
    ],
    durationS: 18,
    xfadeS: 0.25,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.equal(plan.scenes.length, 2);
  assert.deepEqual(plan.repeatedBaseSources, []);
  assert.deepEqual(
    plan.skippedDuplicateBaseSources.map((entry) => entry.key),
    ["output/fresh-green-refill-20260619/goal-proof-batch/rss_story/rss_story_v4_clip_1"],
  );
});

test("Studio V4 proof renderer uses materialized sidecars to skip repeated source windows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-sidecar-repeat-"));
  try {
    const first = path.join(root, "halo_window_12.mp4");
    const second = path.join(root, "halo_window_18.mp4");
    const third = path.join(root, "halo_alt_source.mp4");
    for (const clipPath of [first, second, third]) {
      fs.writeFileSync(clipPath, Buffer.alloc(32, 1));
    }
    fs.writeFileSync(`${first}.json`, JSON.stringify({
      source_family: "halo_campaign_evolved_official_trailer_window_12_5",
      source_url: "https://cdn.example.com/halo/official-trailer.m3u8",
      duration_s: 4,
    }));
    fs.writeFileSync(`${second}.json`, JSON.stringify({
      source_family: "halo_campaign_evolved_official_trailer_window_18_5",
      source_url: "https://cdn.example.com/halo/official-trailer.m3u8",
      duration_s: 4,
    }));
    fs.writeFileSync(`${third}.json`, JSON.stringify({
      source_family: "halo_campaign_evolved_gameplay_demo",
      source_url: "https://cdn.example.com/halo/gameplay-demo.m3u8",
      duration_s: 4,
    }));

    const plan = buildClipScenePlan({
      clips: [first, second, third],
      durationS: 14,
      xfadeS: 0.25,
    });

    assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
    assert.deepEqual(plan.repeatedBaseSources, []);
    assert.equal(plan.scenes.length, 2);
    assert.deepEqual(plan.skippedDuplicateBaseSources.map((entry) => entry.key), [
      "halo_campaign_evolved_official_trailer",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Studio V4 proof renderer blocks repeated Steam trailer delivery variants", () => {
  const sameTrailerRoot =
    "steamstatic:/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626";
  const alternateTrailerRoot =
    "steamstatic:/store_trailers/3483510/387849926/60a658bbf5d52df79e13601620dd1ae0918b2c0a/1770160497";
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "elliot-hls.mp4",
        base_source_family: `${sameTrailerRoot}/hls_264_master.m3u8`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626/hls_264_master.m3u8?t=1781798240`,
        durationS: 5,
      },
      {
        path: "elliot-dash-av1.mp4",
        base_source_family: `${sameTrailerRoot}/dash_av1.mpd`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626/dash_av1.mpd?t=1781798240`,
        durationS: 5,
      },
      {
        path: "elliot-dash-h264.mp4",
        base_source_family: `${sameTrailerRoot}/dash_h264.mpd`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626/dash_h264.mpd?t=1781798240`,
        durationS: 5,
      },
      {
        path: "elliot-second-trailer.mp4",
        base_source_family: `${alternateTrailerRoot}/hls_264_master.m3u8`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/3483510/387849926/60a658bbf5d52df79e13601620dd1ae0918b2c0a/1770160497/hls_264_master.m3u8?t=1770306982`,
        durationS: 5,
      },
    ],
    durationS: 16,
    xfadeS: 0.25,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.deepEqual(plan.repeatedBaseSources, []);
  assert.equal(plan.scenes.length, 2);
  assert.deepEqual(
    [...new Set(plan.skippedDuplicateBaseSources.map((entry) => entry.key))],
    ["steam-trailer:3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626"],
  );
});

test("Studio V4 proof renderer blocks repeated Steam trailer variants across CDN hosts", () => {
  const appId = "2698940";
  const movieId = "1082526063";
  const assetHash = "a5bd121f2233915df96c4477cfac7a560042c4c6";
  const buildId = "1771353384";
  const secondMovieId = "280380145";
  const secondAssetHash = "e3bf535e04ad081b2e6503f5cb47c00240d6a5e0";
  const secondBuildId = "1772831298";
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "crew-fastly-dash.mp4",
        source_url: `https://video.fastly.steamstatic.com/store_trailers/${appId}/${movieId}/${assetHash}/${buildId}/dash_av1.mpd?t=1772640311`,
        source_family: `steam_2698940_the_crew_motorfest__media_03_dash_av1_window_36_5`,
        durationS: 5,
      },
      {
        path: "crew-akamai-hls.mp4",
        source_url: `https://video.akamai.steamstatic.com/store_trailers/${appId}/${movieId}/${assetHash}/${buildId}/hls_264_master.m3u8?t=1772640311`,
        source_family: `steamstatic:/store_trailers/${appId}/${movieId}/${assetHash}/${buildId}_window_48_5`,
        durationS: 5,
      },
      {
        path: "crew-second-trailer.mp4",
        source_url: `https://video.akamai.steamstatic.com/store_trailers/${appId}/${secondMovieId}/${secondAssetHash}/${secondBuildId}/hls_264_master.m3u8?t=1772833995`,
        source_family: `steamstatic:/store_trailers/${appId}/${secondMovieId}/${secondAssetHash}/${secondBuildId}_window_48_5`,
        durationS: 5,
      },
    ],
    durationS: 15,
    xfadeS: 0.25,
  });

  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.deepEqual(plan.repeatedBaseSources, []);
  assert.equal(plan.scenes.length, 2);
  assert.deepEqual(
    [...new Set(plan.skippedDuplicateBaseSources.map((entry) => entry.key))],
    [`steam-trailer:${appId}/${movieId}/${assetHash}/${buildId}`],
  );
});

test("Studio V4 proof renderer blocks short generated cards being stretched into looped scenes", () => {
  const clips = Array.from({ length: 13 }, (_, index) => ({
    path: `owned-card-${index + 1}.mp4`,
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_source_card_explainer_motion",
    media_kind: "owned_explainer_motion",
    source_family: `owned_card_${index + 1}`,
    durationS: 2.8,
  }));

  const plan = buildClipScenePlan({
    clips,
    durationS: 60,
    xfadeS: 0.25,
    maxSceneDurationS: 12,
  });

  assert.equal(plan.repeatFree, true);
  assert.ok(plan.blockers.includes("approved_scene_duration_below_audio_duration"));
  assert.equal(plan.sourceDurationOverruns.length, 0);
  assert.ok(plan.scenes.every((scene) => scene.durationS <= 2.8));
});

test("Studio V4 proof renderer reports readable owned-card scene windows", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "direct-trailer.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "direct_trailer_1",
        durationS: 5,
      },
      {
        path: "output/generated-motion/story/03_animated_quote_card.mp4",
        source_type: "internally_generated_motion_graphic",
        source_kind: "owned_source_card_explainer_motion",
        media_kind: "owned_explainer_motion",
        source_family: "story_animated_quote_card",
        asset_class: "animated_quote_card",
        readable_text: "THIS QUOTE CHANGES THE STORY",
        minimum_readable_duration_s: 7,
        durationS: 12,
      },
      {
        path: "output/generated-motion/story/07_platform_proof_card.mp4",
        source_type: "internally_generated_motion_graphic",
        source_kind: "owned_source_card_explainer_motion",
        media_kind: "owned_explainer_motion",
        source_family: "story_platform_proof_card",
        asset_class: "platform_proof_card",
        text: "SOURCE LOCKED",
        minimum_readable_duration_s: 12,
        durationS: 12,
      },
    ],
    durationS: 27,
    xfadeS: 0.25,
    maxSceneDurationS: 10,
  });

  assert.equal(plan.cardVisibleWindows.length, 2);
  assert.deepEqual(
    plan.cardVisibleWindows.map((window) => ({
      kind: window.kind,
      text: window.text,
      duration_s: window.duration_s,
      minimum_readable_duration_s: window.minimum_readable_duration_s,
    })),
    [
      {
        kind: "quote",
        text: "THIS QUOTE CHANGES THE STORY",
        duration_s: 10.5,
        minimum_readable_duration_s: 7,
      },
      {
        kind: "proof",
        text: "SOURCE LOCKED",
        duration_s: 12,
        minimum_readable_duration_s: 12,
      },
    ],
  );
});

test("Studio V4 proof renderer keeps generated cards readable within the final video duration", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "elliot-trailer-a.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_trailer_a",
        durationS: 12,
      },
      {
        path: "elliot-trailer-b.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_trailer_b",
        durationS: 12,
      },
      {
        path: "elliot-trailer-c.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_trailer_c",
        durationS: 12,
      },
      {
        path: "elliot-trailer-d.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_trailer_d",
        durationS: 12,
      },
      {
        path: "elliot-trailer-e.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_trailer_e",
        durationS: 12,
      },
      {
        path: "elliot-trailer-f.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_trailer_f",
        durationS: 12,
      },
      {
        path: "output/generated-motion/elliot/03_animated_quote_card.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_quote_card",
        durationS: 12,
        minimum_readable_duration_s: 12,
      },
      {
        path: "output/generated-motion/elliot/07_platform_proof_card.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_proof_card",
        durationS: 12,
        minimum_readable_duration_s: 12,
      },
      {
        path: "output/generated-motion/elliot/08_safe_article_screenshot_transform.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_screenshot_card",
        durationS: 12,
        minimum_readable_duration_s: 12,
      },
    ],
    durationS: 106,
    xfadeS: 0.25,
    maxSceneDurationS: 12,
  });

  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.blockers.includes("approved_scene_duration_exceeds_audio_duration"), false);
  assert.equal(plan.cardVisibleWindows.length, 3);
  assert.ok(plan.cardVisibleWindows.every((window) => window.duration_s >= 12));
  assert.ok(plan.cardVisibleWindows.every((window) => window.end_s <= 106 + 0.01));
});

test("Studio V4 proof renderer blocks generated cards that would be squeezed below readable dwell", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "elliot-direct-a.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_direct_a",
        durationS: 5,
      },
      {
        path: "elliot-direct-b.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "elliot_direct_b",
        durationS: 5,
      },
      {
        path: "output/generated-motion/elliot/03_animated_quote_card.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_quote_card",
        durationS: 10,
        minimum_readable_duration_s: 7,
      },
      {
        path: "output/generated-motion/elliot/07_platform_proof_card.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_proof_card",
        durationS: 10,
        minimum_readable_duration_s: 7,
      },
      {
        path: "output/generated-motion/elliot/08_safe_article_screenshot_transform.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_screenshot_card",
        durationS: 10,
        minimum_readable_duration_s: 7,
      },
      {
        path: "output/generated-motion/elliot/04_stat_card.mp4",
        source_type: "internally_generated_motion_graphic",
        media_kind: "owned_explainer_motion",
        source_family: "elliot_stat_card",
        durationS: 5,
        minimum_readable_duration_s: 7,
      },
    ],
    durationS: 30,
    xfadeS: 0.25,
    maxSceneDurationS: 5,
  });

  assert.ok(plan.blockers.includes("readable_card_scene_duration_below_minimum"));
  assert.ok(plan.cardVisibleWindows.every((window) => window.minimum_readable_duration_s >= 7));
  assert.ok(
    plan.readableDurationUnderruns.some((entry) =>
      entry.path.endsWith("04_stat_card.mp4"),
    ),
  );
});

test("Studio V4 proof renderer blocks card-heavy decks with too little real motion", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "clip-a.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "clip_a",
        durationS: 5,
      },
      {
        path: "clip-b.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "clip_b",
        durationS: 5,
      },
      {
        path: "output/generated-motion/story/source-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_source_card",
        text: "SOURCE LOCKED",
        durationS: 10,
      },
      {
        path: "output/generated-motion/story/context-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_context_card",
        text: "WHY PLAYERS SHOULD CARE",
        durationS: 10,
      },
      {
        path: "output/generated-motion/story/takeaway-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_takeaway_card",
        text: "THE PAYOFF NEEDS SPACE",
        durationS: 10,
      },
    ],
    durationS: 35.5,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.ok(plan.blockers.includes("direct_motion_scene_count_below_premium_floor"));
  assert.ok(plan.blockers.includes("readable_card_duration_ratio_above_premium_floor"));
});

test("Studio V4 proof renderer blocks repeated HyperFrames card kinds", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "clip-a.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "clip_a",
        durationS: 8,
      },
      {
        path: "clip-b.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "clip_b",
        durationS: 8,
      },
      {
        path: "output/generated-motion/story/proof-card-a.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_proof_card_a",
        text: "SOURCE LOCKED",
        durationS: 10,
      },
      {
        path: "output/generated-motion/story/proof-card-b.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_proof_card_b",
        text: "PLAYER IMPACT",
        durationS: 10,
      },
    ],
    durationS: 34,
    xfadeS: 0.25,
    maxSceneDurationS: 8,
  });

  assert.ok(plan.blockers.includes("readable_card_kind_repeated"));
  assert.deepEqual(plan.repeatedReadableCardKinds, [{ kind: "proof", count: 2 }]);
});

test("Studio V4 proof renderer fits one readable HyperFrames card by trimming direct dwell", () => {
  const clips = [
    ...Array.from({ length: 5 }, (_, index) => ({
      path: `direct-${index + 1}.mp4`,
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `direct_family_${index + 1}`,
      durationS: 5,
    })),
    {
      path: "output/generated-motion/story/quote-card.mp4",
      source_type: "hyperframes_premium_shell_card",
      media_kind: "owned_editorial_motion_graphic",
      source_family: "hyperframes_quote_card",
      text: "SOURCE LOCKED",
      durationS: 12,
      minimum_readable_duration_s: 12,
    },
  ];

  const plan = buildClipScenePlan({
    clips,
    durationS: 34.6,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("approved_scene_duration_exceeds_audio_duration"), false);
  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.blockers.includes("readable_card_scene_duration_below_minimum"), false);
  assert.equal(plan.repeatFree, true);
  assert.equal(plan.scenes.length, 6);
  assert.equal(plan.scenes.filter((scene) => scene.readableCardKind).length, 1);
  assert.equal(plan.cardVisibleWindows[0].duration_s, 12);
  assert.ok(plan.scenes.filter((scene) => !scene.readableCardKind).every((scene) => scene.durationS < 5));
});

test("Studio V4 proof renderer keeps HyperFrames source cards momentum-friendly", () => {
  const plan = buildClipScenePlan({
    clips: [
      ...Array.from({ length: 8 }, (_, index) => ({
        path: `direct-${index + 1}.mp4`,
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: `direct_family_${index + 1}`,
        durationS: 5,
      })),
      {
        path: "output/generated-motion/story/source-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_source_card",
        text: "METACRITIC NEWS SOURCE",
        durationS: 2.8,
        minimum_readable_duration_s: 1.2,
      },
    ],
    durationS: 38.5,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("readable_card_scene_duration_below_minimum"), false);
  assert.equal(plan.cardVisibleWindows[0].kind, "source");
  assert.equal(plan.cardVisibleWindows[0].duration_s, 2.2);
  assert.equal(plan.cardVisibleWindows[0].minimum_readable_duration_s, 2.2);
});

test("Studio V4 proof renderer accepts current-policy readable cards without extending them to seven seconds", () => {
  const plan = buildClipScenePlan({
    clips: [
      ...Array.from({ length: 9 }, (_, index) => ({
        path: `direct-${index + 1}.mp4`,
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: `direct_family_${index + 1}`,
        durationS: 5,
      })),
      {
        path: "output/generated-motion/story/context-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_context_card",
        text: "PLAYER IMPACT",
        durationS: 4.1,
        minimum_readable_duration_s: 4.1,
      },
      {
        path: "output/generated-motion/story/quote-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_quote_card",
        text: "THE CONTROLS HAVE TO SELL IT",
        durationS: 4.1,
        minimum_readable_duration_s: 4.1,
      },
    ],
    durationS: 50.7,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("readable_card_scene_duration_below_minimum"), false);
  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.deepEqual(
    plan.cardVisibleWindows.map((window) => window.duration_s),
    [4.1, 4.1],
  );
});

test("Studio V4 proof renderer treats rounded readable card equality as pass", () => {
  const clips = [
    ...Array.from({ length: 8 }, (_, index) => ({
      path: `direct-${index + 1}.mp4`,
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `direct_family_${index + 1}`,
      durationS: 5,
    })),
    {
      path: "output/generated-motion/story/quote-card.mp4",
      source_type: "hyperframes_premium_shell_card",
      media_kind: "owned_editorial_motion_graphic",
      source_family: "hyperframes_quote_card",
      text: "SOURCE LOCKED",
      durationS: 12,
      minimum_readable_duration_s: 12,
    },
  ];

  const plan = buildClipScenePlan({
    clips,
    durationS: 51.5,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("readable_card_scene_duration_below_minimum"), false);
  assert.equal(plan.cardVisibleWindows[0].duration_s, 12);
  assert.equal(plan.cardVisibleWindows[0].minimum_readable_duration_s, 12);
});

test("Studio V4 proof renderer treats sub-frame readable card underrun as pass", () => {
  const clips = [
    ...Array.from({ length: 8 }, (_, index) => ({
      path: `direct-${index + 1}.mp4`,
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `direct_family_${index + 1}`,
      durationS: 5,
    })),
    {
      path: "output/generated-motion/story/context-card.mp4",
      source_type: "hyperframes_premium_shell_card",
      media_kind: "owned_editorial_motion_graphic",
      source_family: "hyperframes_context_card",
      text: "PLAYER IMPACT",
      durationS: 12,
      minimum_readable_duration_s: 12.02,
    },
  ];

  const plan = buildClipScenePlan({
    clips,
    durationS: 51.5,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("readable_card_scene_duration_below_minimum"), false);
  assert.equal(plan.cardVisibleWindows[0].duration_s, 12);
  assert.equal(plan.cardVisibleWindows[0].minimum_readable_duration_s, 12.02);
});

test("Studio V4 proof renderer blocks cramped HyperFrames decks instead of clipping readable cards", () => {
  const plan = buildClipScenePlan({
    clips: [
      {
        path: "clip-a.mp4",
        source_type: "official_platform_product_page",
        media_kind: "direct_video",
        source_family: "clip_a",
        durationS: 5,
      },
      {
        path: "output/generated-motion/story/source-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_source_card",
        text: "SOURCE LOCKED",
        durationS: 10,
        minimum_readable_duration_s: 12,
      },
      {
        path: "output/generated-motion/story/takeaway-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_takeaway_card",
        text: "THE PLAYER IMPACT NEEDS SPACE",
        durationS: 10,
        minimum_readable_duration_s: 12,
      },
    ],
    durationS: 13,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.ok(
    plan.cardVisibleWindows
      .filter((window) => window.kind !== "source")
      .every((window) => window.minimum_readable_duration_s >= 12),
  );
  assert.ok(plan.blockers.includes("approved_scene_duration_exceeds_audio_duration"));
  assert.equal(plan.repeatFree, true);
});

test("Studio V4 proof renderer accepts equal source and planned scene durations", () => {
  const clips = Array.from({ length: 6 }, (_, index) => ({
    path: `direct-clip-${index + 1}.mp4`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_family: `direct_family_${index + 1}`,
    durationS: 6,
  }));

  const plan = buildClipScenePlan({
    clips,
    durationS: 34.75,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("motion_scene_duration_exceeds_source_duration"), false);
  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.scenes.length, 6);
  assert.ok(plan.scenes.every((scene) => scene.durationS === 6));
});

test("Studio V4 proof renderer reduces crossfade for exact-fit short direct clips", () => {
  const clips = Array.from({ length: 8 }, (_, index) => ({
    path: `doom-direct-clip-${index + 1}.mp4`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_family: `doom_family_${index + 1}`,
    durationS: 5,
  }));

  const plan = buildClipScenePlan({
    clips,
    durationS: 38.82,
    xfadeS: 0.25,
    maxSceneDurationS: 8,
  });

  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.blockers.includes("motion_scene_duration_exceeds_source_duration"), false);
  assert.equal(plan.repeatFree, true);
  assert.equal(plan.scenes.length, 8);
  assert.equal(plan.xfadeS < 0.25, true);
  assert.equal(plan.coveredDurationS + 0.12 >= 38.82, true);
});

test("Studio V4 proof renderer can use two windows per official trailer when needed for audio coverage", () => {
  const clips = [
    ...Array.from({ length: 2 }, (_, index) => ({
      path: `palworld-trailer-a-window-${index + 1}.mp4`,
      source_url: "https://video.fastly.steamstatic.com/store_trailers/1623730/1468980435/a9fa32ad1a1c432d89b07ac9da9bee6de0bb0054/1765943351/hls_264_master.m3u8",
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `steamstatic:/store_trailers/1623730/1468980435_window_${36 + index * 12}_5`,
      motion_family: `steamstatic:/store_trailers/1623730/1468980435_window_${36 + index * 12}_5`,
      durationS: 5,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      path: `palworld-trailer-b-window-${index + 1}.mp4`,
      source_url: "https://video.fastly.steamstatic.com/store_trailers/1623730/1650163623/c2756f6081e07a1b01e2b6ee3ebcc50e4f220512/1765944104/hls_264_master.m3u8",
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `steamstatic:/store_trailers/1623730/1650163623_window_${36 + index * 12}_5`,
      motion_family: `steamstatic:/store_trailers/1623730/1650163623_window_${36 + index * 12}_5`,
      durationS: 5,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      path: `palworld-single-trailer-${index + 1}.mp4`,
      source_url: `https://video.fastly.steamstatic.com/store_trailers/1623730/${2000000000 + index}/abcdefabcdefabcdefabcdefabcdefabcdefabcd/1765944${index}04/hls_264_master.m3u8`,
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `steamstatic:/store_trailers/1623730/${2000000000 + index}_window_${42 + index * 6}_5`,
      motion_family: `steamstatic:/store_trailers/1623730/${2000000000 + index}_window_${42 + index * 6}_5`,
      durationS: 5,
    })),
  ];

  const plan = buildClipScenePlan({
    clips,
    durationS: 22.5,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.equal(plan.scenes.length >= 5, true);
});

test("Studio V4 proof renderer refuses to fill a premium Short from only two trailer roots", () => {
  const primaryTrailer =
    "https://video.akamai.steamstatic.com/store_trailers/2697940/1128286692/4b8d1e7d317c434d53a53138ae5ef8ad378e5b55/1783663477/hls_264_master.m3u8";
  const secondaryTrailer =
    "https://video.akamai.steamstatic.com/store_trailers/2697940/2004631958/2b2acd2262d934d78e7aaadb196be90ca89927a1/1774541422/hls_264_master.m3u8";
  const clips = [12, 24, 30, 36].map((windowStart, index) => ({
    path: `ascend-primary-window-${index + 1}.mp4`,
    source_url: primaryTrailer,
    source_type: "steam_movie",
    media_kind: "direct_video",
    source_family: `steamstatic:/store_trailers/2697940/1128286692/4b8d1e7d317c434d53a53138ae5ef8ad378e5b55/1783663477_window_${windowStart}_5`,
    mediaStartS: windowStart,
    durationS: 5,
    provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
  }));
  clips.splice(1, 0, {
    path: "ascend-secondary-window-1.mp4",
    source_url: secondaryTrailer,
    source_type: "steam_movie",
    media_kind: "direct_video",
    source_family:
      "steamstatic:/store_trailers/2697940/2004631958/2b2acd2262d934d78e7aaadb196be90ca89927a1/1774541422_window_12_5",
    mediaStartS: 12,
    durationS: 5,
    provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
  });

  const plan = buildClipScenePlan({
    clips,
    durationS: 24,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.availableUniqueClipCount, 3);
  assert.equal(plan.skippedDuplicateBaseSources.length, 2);
  assert.ok(plan.blockers.includes("direct_motion_clip_diversity_below_dwell_floor"));
  assert.ok(plan.blockers.includes("approved_scene_duration_below_audio_duration"));
});

test("Studio V4 proof renderer keeps separate official YouTube video IDs as independent sources", () => {
  const clips = Array.from({ length: 8 }, (_, index) => ({
    path: `albion-official-video-${index + 1}.mp4`,
    source_url: `https://www.youtube.com/watch?v=AlbionOfficial${Math.floor(index / 2) + 1}`,
    source_type: "official_youtube_channel",
    media_kind: "direct_video",
    source_family: `albion_official_youtube_${Math.floor(index / 2) + 1}`,
    mediaStartS: index % 2 === 0 ? 12 : 48,
    durationS: 5,
  }));

  const plan = buildClipScenePlan({
    clips,
    durationS: 38.8,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.scenes.length, 8);
  assert.equal(plan.availableUniqueClipCount, 8);
  assert.equal(plan.skippedDuplicateBaseSources.length, 0);
  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.blockers.includes("direct_motion_clip_diversity_below_dwell_floor"), false);
});

test("Studio V4 proof renderer uses extra short direct clips when source duration caps would under-cover audio", () => {
  const sourceIds = [
    "1468980435",
    "1650163623",
    "1835768144",
    "768837",
    "1468980435",
    "1650163623",
    "768837",
    "1650163623",
  ];
  const clips = sourceIds.map((sourceId, index) => {
    const windowStart = [36, 36, 48, 54, 48, 42, 60, 48][index];
    return {
      path: `palworld-window-${index + 1}.mp4`,
      source_url: `https://video.fastly.steamstatic.com/store_trailers/1623730/${sourceId}/hash/hls_264_master.m3u8`,
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_family: `steamstatic:/store_trailers/1623730/${sourceId}_window_${windowStart}_5`,
      motion_family: `steamstatic:/store_trailers/1623730/${sourceId}_window_${windowStart}_5`,
      durationS: 5,
    };
  });

  const plan = buildClipScenePlan({
    clips,
    durationS: 34.4,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.equal(plan.blockers.includes("approved_scene_duration_below_audio_duration"), false);
  assert.equal(plan.blockers.includes("motion_scene_duration_exceeds_source_duration"), false);
  assert.equal(plan.blockers.includes("direct_motion_base_source_repeated"), false);
  assert.equal(plan.scenes.length, 8);
});

test("Studio V4 proof renderer keeps distinct official trailer windows when readable cards are present", () => {
  const directClips = Array.from({ length: 10 }, (_, index) => {
    const sourceIndex = Math.floor(index / 2) + 1;
    const windowStart = index % 2 === 0 ? 36 : 42;
    return {
      path: `tokon-direct-${index + 1}.mp4`,
      source_url: `https://video.akamai.steamstatic.com/store_trailers/3787240/source-${sourceIndex}/hls_264_master.m3u8`,
      source_type: "steam_movie",
      source_kind: "video_file",
      media_kind: "direct_video",
      source_family: `steamstatic:/store_trailers/3787240/source-${sourceIndex}_window_${windowStart}_5`,
      motion_family: `steamstatic:/store_trailers/3787240/source-${sourceIndex}_window_${windowStart}_5`,
      durationS: 5,
    };
  });
  const plan = buildClipScenePlan({
    clips: [
      ...directClips.slice(0, 4),
      {
        path: "hf-source-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_source_card",
        text: "GAME SPOT NEWS SOURCE",
        durationS: 12,
        minimum_readable_duration_s: 12,
      },
      ...directClips.slice(4, 5),
      {
        path: "hf-quote-card.mp4",
        source_type: "hyperframes_premium_shell_card",
        media_kind: "owned_editorial_motion_graphic",
        source_family: "hyperframes_quote_card",
        text: "MARVEL GAME SPOT",
        durationS: 12.4,
        minimum_readable_duration_s: 12,
      },
      ...directClips.slice(5),
    ],
    durationS: 58.514,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.skippedDuplicateBaseSources.length, 0);
  assert.equal(plan.scenes.filter((scene) => !scene.readableCardKind).length, 10);
  assert.equal(plan.scenes.filter((scene) => scene.readableCardKind).length, 2);
  assert.equal(plan.readableCardSceneMetrics.readable_card_duration_ratio <= 0.42, true);
  assert.equal(plan.coveredDurationS >= 58.514 - 0.01, true);
});

test("Studio V4 proof renderer fits crossfades around readable cards without exceeding scheduler source-share limits", () => {
  const trailerUrls = [
    "https://video.akamai.steamstatic.com/store_trailers/3219010/release/hash/hls_264_master.m3u8",
    "https://video.akamai.steamstatic.com/store_trailers/3219010/announcement/hash/hls_264_master.m3u8",
    "https://www.youtube.com/watch?v=FogpiercerOfficialRelease",
    "https://cdn.trailers.xboxservices.com/trailers/fogpiercer/gameplay-AVS.m3u8?packagedStreaming=true",
  ];
  const directClips = trailerUrls.flatMap((sourceUrl, sourceIndex) =>
    [12, 36].map((windowStart, windowIndex) => ({
      path: `fogpiercer-${sourceIndex + 1}-${windowIndex + 1}.mp4`,
      source_url: sourceUrl,
      source_type: "steam_movie",
      source_kind: "video_file",
      media_kind: "direct_video",
      source_family: `steamstatic:/store_trailers/3219010/${sourceIndex + 1}_window_${windowStart}_5`,
      motion_family: `steamstatic:/store_trailers/3219010/${sourceIndex + 1}_window_${windowStart}_5`,
      mediaStartS: windowStart,
      durationS: 5,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    })),
  );
  const cards = [
    {
      path: "fogpiercer-source-card.mp4",
      source_type: "hyperframes_premium_shell_card",
      media_kind: "owned_editorial_motion_graphic",
      source_family: "hyperframes_source_card",
      text: "XBOX WIRE NEWS SOURCE",
      durationS: 2.2,
      minimum_readable_duration_s: 2.2,
    },
    {
      path: "fogpiercer-context-card.mp4",
      source_type: "hyperframes_premium_shell_card",
      media_kind: "owned_editorial_motion_graphic",
      source_family: "hyperframes_context_card",
      text: "YOUR TRAIN BECOMES THE DECK",
      durationS: 4.1,
      minimum_readable_duration_s: 4.1,
    },
    {
      path: "fogpiercer-quote-card.mp4",
      source_type: "hyperframes_premium_shell_card",
      media_kind: "owned_editorial_motion_graphic",
      source_family: "hyperframes_quote_card",
      text: "YOUR OPENING HAND IS A TRAIN",
      durationS: 4.9,
      minimum_readable_duration_s: 4.9,
    },
  ];

  const plan = buildClipScenePlan({
    clips: [
      ...directClips.slice(0, 4),
      cards[0],
      ...directClips.slice(4, 7),
      cards[1],
      ...directClips.slice(7),
      cards[2],
    ],
    durationS: 48.866,
    xfadeS: 0.25,
    maxSceneDurationS: 7,
  });

  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.scenes.filter((scene) => !scene.readableCardKind).length, 8);
  assert.equal(plan.scenes.filter((scene) => scene.readableCardKind).length, 3);
  const directScenes = plan.scenes.filter((scene) => !scene.readableCardKind);
  const sourceCounts = directScenes.reduce((counts, scene) => {
    counts.set(scene.sourceRootKey, (counts.get(scene.sourceRootKey) || 0) + 1);
    return counts;
  }, new Map());
  assert.ok([...sourceCounts.values()].every((count) => count <= 2));
  assert.ok([...sourceCounts.values()].every((count) => count / directScenes.length <= 0.25));
  assert.equal(plan.xfadeS < 0.25, true);
  assert.equal(plan.coveredDurationS >= 48.866 - 0.12, true);
});

test("Studio V4 proof renderer adds strong per-scene motion before composing quiet clips", () => {
  assert.equal(typeof buildSceneCompositeFilterParts, "function");

  const filters = buildSceneCompositeFilterParts({
    index: 3,
    durationS: 1.42,
  });
  const composite = filters.join(";");

  assert.match(composite, /scale=1260:2240:force_original_aspect_ratio=increase/);
  assert.match(composite, /crop=w=1080:h=1920:x='\(iw-1080\)\*\(0\.50\+0\.28\*sin\(t\*0\.24\+3\)\)'/);
  assert.match(composite, /overlay=x='\(W-w\)\/2\+sin\(t\*0\.53\+3\)\*16'/);
  assert.match(composite, /:y='\(H-h\)\/2\+cos\(t\*0\.41\+3\)\*10':eval=frame/);
  assert.match(composite, /noise=alls=4:allf=t\+u/);
  assert.match(composite, /trim=duration=1\.42/);
});

test("Studio V4 proof renderer accepts explicit direct-motion dwell overrides", () => {
  const previousDwell = process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S;
  const previousScenes = process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES;
  process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S = "1.25";
  process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES = "48";
  try {
    assert.equal(directClipMaxVisibleDwellS(), 1.25);
    assert.equal(directClipMaxScenes(), 48);
  } finally {
    if (previousDwell === undefined) delete process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S;
    else process.env.STUDIO_V4_DIRECT_CLIP_MAX_VISIBLE_DWELL_S = previousDwell;
    if (previousScenes === undefined) delete process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES;
    else process.env.STUDIO_V4_DIRECT_CLIP_MAX_SCENES = previousScenes;
  }
});

test("Studio V4 proof renderer final mix pins social audio to 48 kHz", () => {
  assert.equal(typeof buildFinalSocialAudioMixFilter, "function");

  const filter = buildFinalSocialAudioMixFilter(["[a_voice]", "[a_music]"]);

  assert.match(filter, /amix=inputs=2:duration=first/);
  assert.match(filter, /normalize=0/);
  assert.match(filter, /loudnorm=I=-16:TP=-2:LRA=6/);
  assert.match(filter, /alimiter=limit=0\.80:level=disabled/);
  assert.match(filter, /aresample=48000\[outa\]$/);
});

test("Studio V4 overlay chain adds temporal grain to prevent static-frame holds", () => {
  const chain = buildOverlayChain({
    story: {
      id: "anti-freeze",
      title: "Anti Freeze Test",
      primary_source: "Xbox Wire",
      canonical_subject: "Anti Freeze",
    },
    inputLabel: "base",
    outputLabel: "out",
    durationS: 42,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /noise=alls=10:allf=t\+u/);
  assert.match(chain, /trim=duration=42\.000,setpts=PTS-STARTPTS\[out\]/);
});

test("Studio V4 proof renderer reports readable overlay card windows", () => {
  const windows = overlayCardWindowsForStory({
    canonical_subject: "Street Fighter 6",
    primary_source: "Capcom",
    first_frame_text: "YASMINE PRESSURE",
    thumbnail_headline: "YASMINE PRESSURE",
    proof_card_primary: "RUSHDOWN PROBLEM",
    proof_card_secondary: "TOURNAMENT META",
  });

  assert.deepEqual(
    windows.map((window) => [window.id, window.kind, window.duration_s]),
    [
      ["opening_source_lock", "source_lock", 2.2],
      ["proof_primary", "proof_card", 2.6],
      ["proof_secondary", "proof_card", 2.6],
    ],
  );
  assert.ok(windows.every((window) => window.duration_s >= (window.kind === "source_lock" ? 1.9 : 2.6)));
  assert.ok(windows.every((window) => window.duration_s <= 4.2));
  assert.deepEqual(
    windows.filter((window) => window.id.startsWith("proof_")).map((window) => window.presentation_mode),
    ["compact_proof_overlay", "compact_proof_overlay"],
  );
});

test("Studio V4 proof renderer trims long HyperFrames card copy instead of holding momentum", () => {
  const windows = overlayCardWindowsForStory({
    canonical_subject: "GTA VI",
    primary_source: "Rockstar Games",
    first_frame_text: "GTA VI JUST MOVED",
    thumbnail_headline: "PREORDERS STILL NEED PRICE, EDITIONS AND PLATFORM DETAIL",
    proof_card_primary: "ROCKSTAR SHOWED THE ART BUT NOT THE BUYING DECISION",
    proof_card_secondary: "PLAYERS STILL NEED THE DATE, EDITIONS AND UPGRADE PATH",
  });
  const byId = Object.fromEntries(windows.map((window) => [window.id, window]));

  assert.match(byId.headline_card.text, /PREORDERS STILL NEED PRICE/);
  assert.equal(byId.headline_card.duration_s <= 5.8, true);
  assert.equal(byId.headline_card.presentation_mode, "compact_headline_overlay");
  assert.equal(byId.proof_primary.duration_s <= 5.8, true);
  assert.equal(byId.proof_secondary.duration_s <= 5.8, true);
  assert.equal(byId.headline_card.start_s >= byId.opening_source_lock.end_s + 0.1, true);
  assert.equal(byId.proof_primary.start_s >= byId.headline_card.end_s + 0.6, true);
  assert.equal(byId.proof_secondary.start_s >= byId.proof_primary.end_s + 0.6, true);
});

test("Studio V4 proof renderer omits unreadable overlay card windows that do not fit the render duration", () => {
  const windows = overlayCardWindowsForStory(
    {
      canonical_subject: "Granblue Fantasy: Relink",
      primary_source: "PlayStation Blog",
      first_frame_text: "GRANBLUE HAS A DEMO TEST",
      thumbnail_headline: "DEMO TEST",
      proof_card_primary: "PLAYERS CAN CHECK COMBAT FLOW BEFORE BUYING",
      proof_card_secondary: "THE PAYOFF IS WHETHER BOSSES FEEL READABLE",
    },
    { durationS: 34.6 },
  );

  assert.deepEqual(windows.map((window) => window.id), [
    "opening_source_lock",
    "headline_card",
    "proof_primary",
    "proof_secondary",
  ]);
  assert.equal(windows.every((window) => window.duration_s >= (window.kind === "source_lock" ? 1.6 : 2.6)), true);
  assert.equal(windows.every((window) => window.end_s <= 34.6), true);
});

test("Studio V4 proof renderer CLI stays local and story-json driven", () => {
  const args = parseArgs([
    "node",
    "tools/studio-v4-proof-render.js",
    "--story-json",
    "test/output/story.json",
    "--output",
    "test/output/out.mp4",
    "--json",
  ]);

  assert.equal(args.storyJson, "test/output/story.json");
  assert.equal(args.output, "test/output/out.mp4");
  assert.equal(args.json, true);
});

test("Studio V4 proof renderer prefers MEDIA_ROOT for absolute legacy output audio paths", async () => {
  assert.equal(typeof resolveReadableMediaPath, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-proof-media-root-"));
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-proof-media-root-cache-"));
  const previousMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const workspacePath = path.join(root, "output", "audio", "caption-drift_timestamps.json");
    const mediaPath = path.join(mediaRoot, "output", "audio", "caption-drift_timestamps.json");
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(workspacePath, JSON.stringify({ words: [{ word: "stale", start: 0, end: 0.2 }] }));
    fs.writeFileSync(mediaPath, JSON.stringify({ words: [{ word: "fresh", start: 0, end: 0.2 }] }));

    const resolved = await resolveReadableMediaPath(workspacePath);

    assert.equal(resolved, mediaPath);
  } finally {
    if (previousMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
  }
});

test("Studio V4 proof renderer converts percent signs before drawtext", () => {
  const escaped = drawtextEscape("Super Mario RPG - $15 (70% off)");

  assert.equal(escaped.includes("%"), false);
  assert.match(escaped, /70 percent off/);
});

test("Studio V4 proof renderer is exposed as a first-class library module", () => {
  assert.equal(typeof proofRenderLib.renderProof, "function");
  assert.equal(typeof proofRenderLib.buildClipScenePlan, "function");

  const plan = proofRenderLib.buildClipScenePlan({
    clips: ["one.mp4", "two.mp4"],
    durationS: 10,
  });

  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes[0].path, "one.mp4");
});

test("Studio V4 proof renderer prefers licensed creator-studio SFX over legacy placeholders", async () => {
  assert.equal(typeof resolveStorySfxPaths, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-render-"));
  const impact = path.join(root, "impact.wav");
  const transition = path.join(root, "transition.wav");
  const rejected = path.join(root, "rejected.wav");
  fs.writeFileSync(impact, Buffer.alloc(128, 1));
  fs.writeFileSync(transition, Buffer.alloc(128, 2));
  fs.writeFileSync(rejected, Buffer.alloc(128, 3));

  const paths = await resolveStorySfxPaths({
    sfx_asset_inventory: [
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(impact).href,
        approval_status: "approved_for_commercial_editorial_use",
        quality_tier: "creator_studio",
      },
      {
        role: "transition",
        provider_id: "boom_library",
        source_url: pathToFileURL(transition).href,
        approval_status: "approved_for_commercial_editorial_use",
        quality_tier: "creator_studio",
      },
      {
        role: "glitch",
        provider_id: "unknown",
        source_url: pathToFileURL(rejected).href,
        approval_status: "blocked",
      },
    ],
  });

  assert.deepEqual(paths, [transition]);
});

test("Studio V4 proof renderer schedules SFX by editorial role with narration-safe gains", async () => {
  assert.equal(typeof resolveStorySfxCueMix, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-mix-"));
  const files = {
    transition: path.join(root, "transition.wav"),
    impact: path.join(root, "impact.wav"),
    ui: path.join(root, "Rescopic Sound - User Interaction", "UIClick_Select Middle 29.wav"),
    sub: path.join(root, "sub.wav"),
  };
  for (const [index, file] of Object.values(files).entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "hook_slam", family: "impact", atS: 0 },
          { target_kind: "motion_clip", family: "whoosh", atS: 0.35 },
          { target_kind: "source_lock", family: "source_tick", atS: 2.75 },
          { target_kind: "price_snap", family: "cash_snap", atS: 24.6 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        role: "transition",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.transition).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.impact).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.ui).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "sub_hit",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.sub).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["ui_tick"]);
  assert.deepEqual(mix.map((cue) => cue.target_kind), ["source_lock"]);
  assert.deepEqual(mix.map((cue) => cue.path), [files.ui]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
  assert.deepEqual(mix.map((cue) => cue.delayMs), [2750]);
});

test("Studio V4 fallback SFX follows the category identity palette", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-identity-sfx-"));
  const files = {
    impact: path.join(root, "impact.wav"),
    ui: path.join(root, "ui.wav"),
    transition: path.join(root, "transition.wav"),
  };
  for (const [index, file] of Object.values(files).entries()) {
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }
  const inventory = Object.entries(files).map(([role, file]) => ({
    role: role === "ui" ? "ui_tick" : role,
    provider_id: "sonniss",
    source_url: pathToFileURL(file).href,
    approval_status: "approved_for_commercial_editorial_use",
    quality_tier: "creator_studio",
  }));

  const update = await resolveStorySfxCueMix({
    title: "Sea Of Thieves Season 18 Update Adds A New Voyage",
    sfx_asset_inventory: inventory,
  });
  const breaking = await resolveStorySfxCueMix({
    title: "Breaking GTA VI Trailer Released",
    breaking_score: 90,
    sfx_asset_inventory: inventory,
  });

  assert.deepEqual(update.map((cue) => cue.role), ["ui_tick"]);
  assert.deepEqual(breaking.map((cue) => cue.role), ["impact"]);
  assert.equal(update[0].identity_id, "game_update");
  assert.equal(breaking[0].identity_id, "breaking_alert");
});

test("Studio V4 proof renderer resolves Epidemic music beds and stings from the channel pack", async () => {
  assert.equal(typeof resolveStoryMusicCueMix, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-music-pack-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const bedA = path.join(epidemicRoot, "music", "bed_primary", "a.mp3");
  const bedB = path.join(epidemicRoot, "music", "bed_primary", "b.mp3");
  const breakingBed = path.join(epidemicRoot, "music", "bed_breaking", "breaking.mp3");
  const verifiedSting = path.join(epidemicRoot, "stings", "sting_verified", "verified.mp3");
  for (const file of [bedA, bedB, breakingBed, verifiedSting]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, 1));
  }

  const mix = await resolveStoryMusicCueMix(
    {
      id: "story-alpha",
      channel_id: "pulse-gaming",
      flair: "Verified",
    },
    {
      workspaceRoot: root,
      packConfigs: [
        {
          id: "pulse-gaming-epidemic-v1",
          channel_id: "pulse-gaming",
          root_path: "audio/epidemic",
          variants: {
            bed_primary: [
              { role: "bed_primary", filename: "music/bed_primary/a.mp3", provider_id: "epidemic_sound" },
              { role: "bed_primary", filename: "music/bed_primary/b.mp3", provider_id: "epidemic_sound" },
            ],
            bed_breaking: [
              { role: "bed_breaking", filename: "music/bed_breaking/breaking.mp3", provider_id: "epidemic_sound" },
            ],
            sting_verified: [
              { role: "sting_verified", filename: "stings/sting_verified/verified.mp3", provider_id: "epidemic_sound" },
            ],
          },
        },
      ],
    },
  );

  assert.equal(mix.provider_id, "epidemic_sound");
  assert.equal(mix.bed.role, "bed_primary");
  assert.match(mix.bed.path, /audio[\\/]epidemic[\\/]music[\\/]bed_primary[\\/][ab]\.mp3$/);
  assert.equal(mix.sting.role, "sting_verified");
  assert.equal(mix.policy.duck_under_narration, true);
  assert.equal(mix.policy.raw_bed_volume <= 0.12, true);
});

test("Studio V4 proof renderer gives update, review and rumour stories distinct audio identities", async () => {
  const update = await resolveStoryMusicCueMix({
    id: "update-story",
    title: "Sea Of Thieves Season 18 Update Adds A New Voyage",
  });
  const review = await resolveStoryMusicCueMix({
    id: "review-story",
    title: "Forza Horizon 6 Review Scores Split Critics",
  });
  const rumour = await resolveStoryMusicCueMix({
    id: "rumour-story",
    title: "Fable Release Reportedly Moved",
    flair: "Rumour",
  });

  assert.equal(update.content_identity.id, "game_update");
  assert.equal(review.content_identity.id, "review_verdict");
  assert.equal(rumour.content_identity.id, "rumour_watch");
  assert.notEqual(update.bed.path, review.bed.path);
  assert.notEqual(review.bed.path, rumour.bed.path);
  assert.notEqual(update.sting.path, rumour.sting.path);
  assert.equal(update.bed.identity_id, "game_update");
  assert.equal(review.sting.identity_id, "review_verdict");
});

test("Studio V4 overlay shell carries the same visible category identity as its soundscape", () => {
  const chain = buildOverlayChain({
    story: {
      id: "patch-identity",
      title: "Sea Of Thieves Season 18 Update Adds A New Voyage",
      primary_source: "Xbox Wire",
      hook: "Sea Of Thieves just changed its next voyage.",
    },
    inputLabel: "base",
    outputLabel: "out",
    durationS: 42,
    fontOpt: "font='DejaVu Sans'",
    metaFontOpt: "font='DejaVu Sans Mono'",
  });

  assert.match(chain, /0x64D2FF/);
  assert.match(chain, /PATCH PULSE/);
  assert.doesNotMatch(chain, /text='BREAKING PULSE'/);
});

test("Studio V4 proof renderer keeps flash captions above lower-third and bottom-edge risk", () => {
  const ass = buildKineticAss({
    story: { title: "Hades II Just Broke PlayStation's Silence" },
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "two", start: 0.22, end: 0.42 },
      { word: "lands", start: 0.5, end: 0.72 },
      { word: "on", start: 0.75, end: 0.86 },
      { word: "PlayStation", start: 0.9, end: 1.2 },
    ],
    duration: 2,
    scriptText: "Hades II lands on PlayStation.",
    captionCase: "upper",
    revealMode: "word",
    motionStyle: "flash",
  });

  assert.match(ass, /Style: Pop,Impact,82,/);
  assert.match(ass, /\\move\(540,1378,540,1342,0,130\)/);
  assert.doesNotMatch(ass, /\\move\(540,1484,540,1450,0,130\)/);
});

test("Studio V4 proof renderer masks baked-in source text zones before overlays", () => {
  const chain = buildOverlayChain({
    story: {
      id: "source-text-risk",
      title: "Hades II Just Broke PlayStation's Silence",
      canonical_subject: "Hades II",
      primary_source: "Xbox",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 30,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawbox=x=0:y=138:w=iw:h=164:color=black@0\.56:t=fill/);
  assert.match(chain, /drawbox=x=0:y=ih-430:w=iw:h=430:color=black@0\.52:t=fill/);
  assert.match(chain, /drawbox=x=0:y=ih-315:w=iw:h=315:color=black@0\.66:t=fill/);
});

test("Studio V4 proof renderer masks vertical frame edges before text audits", () => {
  const chain = buildOverlayChain({
    story: {
      id: "frame-edge-risk",
      title: "Subnautica 2 Reportedly Leaked Early",
      canonical_subject: "Subnautica 2",
      primary_source: "RespawnFirst",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 30,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawbox=x=0:y=0:w=44:h=ih:color=0x0B0F19@0\.72:t=fill/);
  assert.match(chain, /drawbox=x=iw-44:y=0:w=44:h=ih:color=0x0B0F19@0\.72:t=fill/);
  assert.doesNotMatch(chain, /drawbox=x=0:y=0:w=18:h=ih:color=0x0B0F19@0\.52:t=fill/);
});

test("Studio V4 proof renderer widens edge masks for safe-margin repair renders", () => {
  const chain = buildOverlayChain({
    story: {
      id: "frame-edge-safe-margin",
      title: "Star Wars Racer Date Leaked Early",
      canonical_subject: "Star Wars Racer",
      primary_source: "Game Rant",
      render_safe_text_margins: true,
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 30,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawbox=x=0:y=0:w=72:h=ih:color=0x0B0F19@0\.80:t=fill/);
  assert.match(chain, /drawbox=x=iw-72:y=0:w=72:h=ih:color=0x0B0F19@0\.80:t=fill/);
  assert.doesNotMatch(chain, /drawbox=x=0:y=0:w=44:h=ih:color=0x0B0F19@0\.72:t=fill/);
});

test("Studio V4 proof renderer unlocks richer SFX only for curated Epidemic packs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-epidemic-rich-"));
  const files = {
    impact: path.join(root, "audio", "epidemic", "sfx", "epidemic_impact_hit.wav"),
    transition: path.join(root, "audio", "epidemic", "sfx", "epidemic_transition_whoosh.wav"),
    ui: path.join(root, "audio", "epidemic", "sfx", "epidemic_ui_tick_ui-click-short.wav"),
    sub: path.join(root, "audio", "epidemic", "sfx", "epidemic_sub_hit_boom.wav"),
    glitch: path.join(root, "audio", "epidemic", "sfx", "epidemic_glitch_static.wav"),
  };
  for (const [index, file] of Object.values(files).entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "hook_slam", family: "impact", atS: 0 },
          { target_kind: "motion_clip", family: "whoosh", atS: 0.35 },
          { target_kind: "source_lock", family: "source_tick", atS: 2.75 },
          { target_kind: "proof_card", family: "sub_hit", atS: 4.5 },
          { target_kind: "pattern_interrupt", family: "glitch", atS: 12.1 },
        ],
      },
    },
    sfx_asset_inventory: [
      { asset_id: "epidemic-impact", role: "impact", provider_id: "epidemic_sound", source_url: pathToFileURL(files.impact).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-transition", role: "transition", provider_id: "epidemic_sound", source_url: pathToFileURL(files.transition).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-ui", role: "ui_tick", provider_id: "epidemic_sound", source_url: pathToFileURL(files.ui).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-sub", role: "sub_hit", provider_id: "epidemic_sound", source_url: pathToFileURL(files.sub).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-glitch", role: "glitch", provider_id: "epidemic_sound", source_url: pathToFileURL(files.glitch).href, approval_status: "approved_for_commercial_editorial_use" },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["impact", "transition", "ui_tick", "sub_hit", "glitch"]);
  assert.deepEqual(mix.map((cue) => cue.target_kind), ["hook_slam", "motion_clip", "source_lock", "proof_card", "pattern_interrupt"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.055));
  assert.ok(mix.find((cue) => cue.role === "ui_tick").volume <= 0.004);
  assert.ok(mix.every((cue) => cue.durationS <= 0.55));
});

test("Studio V4 proof renderer uses only source-lock ticks when cue timing is absent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-fallback-"));
  const impact = path.join(root, "impact.wav");
  const transition = path.join(root, "transition.wav");
  const ui = path.join(root, "Rescopic Sound - User Interaction", "UIClick_Select Middle 29.wav");
  const glitch = path.join(root, "glitch.wav");
  for (const [index, file] of [impact, transition, ui, glitch].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sfx_asset_inventory: [
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(impact).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "transition",
        provider_id: "sonniss",
        source_url: pathToFileURL(transition).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(ui).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "glitch",
        provider_id: "sonniss",
        source_url: pathToFileURL(glitch).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["ui_tick"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
});

test("Studio V4 proof renderer keeps source-lock SFX quiet and UI-only", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-subtle-"));
  const ui = path.join(root, "Rescopic Sound - User Interaction", "UIClick_Select Middle 29.wav");
  const impact = path.join(root, "impact.wav");
  fs.mkdirSync(path.dirname(ui), { recursive: true });
  fs.writeFileSync(ui, Buffer.alloc(128, 1));
  fs.writeFileSync(impact, Buffer.alloc(128, 2));

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.2 },
          { target_kind: "hook_slam", family: "impact", atS: 0.15 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(impact).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(ui).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["ui_tick"]);
  assert.deepEqual(mix.map((cue) => cue.target_kind), ["source_lock"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
});

test("Studio V4 proof renderer captions the canonical narration instead of stale instruction-like TTS fields", () => {
  assert.equal(typeof renderNarrationScriptText, "function");

  const script = renderNarrationScriptText({
    narration_script:
      "Warhammer 40,000: Boltgun 2 takes the retro FPS chaos outdoors. IGN previewed the new demo and the player question is whether bigger arenas make the sequel feel sharper.",
    full_script:
      "Before you spend, check the live price, the platform listing and whether the deal is still active. Treat the headline as a price check, not a victory lap.",
    tts_script:
      "The player angle is simple: check the price, access or platform details before you decide what to play next.",
  });

  assert.match(script, /Boltgun 2 takes the retro FPS chaos outdoors/);
  assert.doesNotMatch(script, /Before you spend|player angle is simple|platform details before you decide/i);
});

test("Studio V4 proof renderer prefers explicit word timestamps over rough character alignments", () => {
  assert.equal(typeof subtitleWordsFromTimestampPayload, "function");

  const words = subtitleWordsFromTimestampPayload({
    words: [
      { word: "Hades", start: 0.04, end: 0.28 },
      { word: "II", start: 0.31, end: 0.48 },
      { word: "lands", start: 0.55, end: 0.9 },
    ],
    alignment: {
      characters: Array.from("Wrong stale text"),
      character_start_times_seconds: Array.from("Wrong stale text", (_, index) => index * 0.5),
      character_end_times_seconds: Array.from("Wrong stale text", (_, index) => index * 0.5 + 0.2),
    },
  });

  assert.deepEqual(words.map((word) => word.word), ["Hades", "II", "lands"]);
  assert.equal(words[1].start, 0.31);
});

test("Studio V4 proof renderer blocks local preview renders without ASR-aligned timestamps", () => {
  assert.equal(typeof validateProofTimestampPayload, "function");

  assert.throws(
    () =>
      validateProofTimestampPayload({
        meta: {
          provider: "local",
          wordTimestampSource: "local_audio_silence_anchored",
        },
        words: [
          { word: "Hades", start: 0, end: 0.2 },
          { word: "sequel", start: 0.24, end: 0.5 },
        ],
      }),
    /proof render requires local_whisper_word_alignment timestamps/,
  );
});

test("Studio V4 proof renderer accepts strict local Whisper timestamps for review renders", () => {
  const result = validateProofTimestampPayload({
    meta: {
      provider: "local",
      wordTimestampSource: "local_whisper_word_alignment",
    },
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "sequel", start: 0.24, end: 0.5 },
    ],
  });

  assert.equal(result.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(result.local_timing_strict, true);
});

test("Studio V4 proof renderer accepts strict timestamp source supplied by render story", () => {
  const result = validateProofTimestampPayload(
    {
      meta: {
        provider: "local",
      },
      words: [
        { word: "Hades", start: 0, end: 0.2 },
        { word: "sequel", start: 0.24, end: 0.5 },
      ],
    },
    { wordTimestampSource: "local_whisper_word_alignment" },
  );

  assert.equal(result.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(result.local_timing_strict, true);
});

test("Studio V4 proof renderer blocks review MP4s with mid-render voice jumps", () => {
  assert.equal(typeof assertProofAudioSegmentLoudness, "function");

  assert.throws(
    () =>
      assertProofAudioSegmentLoudness({
        verdict: "fail",
        blockers: ["voice_segment_loudness_jump"],
      }),
    /proof render audio segment loudness failed: voice_segment_loudness_jump/,
  );
});

test("Studio V4 proof renderer accepts stable segment loudness evidence", () => {
  const result = assertProofAudioSegmentLoudness({
    verdict: "pass",
    blockers: [],
    metrics: { mean_range_db: 1.2 },
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.metrics.mean_range_db, 1.2);
});

test("Studio V4 proof renderer rejects misclassified field-recording and voice SFX at mix time", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-editorial-mix-"));
  const engine = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Cactuzz Sound - 1993 Suzuki VS 800 GL Intruder",
    "1993 Suzuki VS 800 GL Intruder, engine start, city cruise.wav",
  );
  const voice = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Cybernetix - Sci-Fi UI Voice",
    "Hostile Territory Detected.wav",
  );
  const activation = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Glitchedtones - Activation User Interface",
    "Activation_UI_Click_33.wav",
  );
  const cleanClick = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_Select Middle 29.wav",
  );
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.mkdirSync(path.dirname(voice), { recursive: true });
  fs.mkdirSync(path.dirname(activation), { recursive: true });
  fs.mkdirSync(path.dirname(cleanClick), { recursive: true });
  fs.writeFileSync(engine, Buffer.alloc(128, 1));
  fs.writeFileSync(voice, Buffer.alloc(128, 2));
  fs.writeFileSync(activation, Buffer.alloc(128, 3));
  fs.writeFileSync(cleanClick, Buffer.alloc(128, 4));

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.2 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "engine-misfiled-as-ui",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(engine).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "voice-misfiled-as-ui",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(voice).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "activation-click-too-harsh",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(activation).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-user-interaction-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(cleanClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["clean-user-interaction-click"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
});

test("Studio V4 proof renderer rejects alert and activation clicks for source locks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-source-lock-tight-"));
  const alert = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIAlert_Confirm Middle 12_RSCPC_USIN.wav",
  );
  const activation = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "CB Sounddesign",
    "Activation_UI_Click_33.wav",
  );
  const cleanClick = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_Select Middle 29_RSCPC_USIN.wav",
  );
  for (const [index, file] of [alert, activation, cleanClick].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.4 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "alert-confirm-too-editorial",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(alert).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "activation-click-too-harsh",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(activation).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-select-tick",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(cleanClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["clean-select-tick"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.01));
  assert.ok(mix.every((cue) => cue.durationS <= 0.1));
});

test("Studio V4 proof renderer picks a compact newsroom click for source locks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-plain-click-"));
  const longSelect = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_Select Middle 29_RSCPC_USIN.wav",
  );
  const plainClick = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_UI Click Short 03_RSCPC_USIN.wav",
  );
  const highTechBeep = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "BluezoneCorp - Futuristic User Interface",
    "Bluezone_BC0303_futuristic_user_interface_high_tech_beep_038.wav",
  );
  for (const [index, file] of [longSelect, plainClick, highTechBeep].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.6 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "long-select-middle",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(longSelect).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-user-interaction-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(plainClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "high-tech-beep",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(highTechBeep).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["clean-user-interaction-click"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.004));
  assert.ok(mix.every((cue) => cue.durationS <= 0.07));
});

test("Studio V4 proof renderer accepts clean Epidemic interface clicks for source locks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-epidemic-source-lock-"));
  const cleanClick = path.join(
    root,
    "audio",
    "epidemic",
    "sfx",
    "epidemic_ui_tick_03_user-interface-click-standard-short-clean-variations-epidemic-sound.mp3",
  );
  const alertClick = path.join(
    root,
    "audio",
    "epidemic",
    "sfx",
    "epidemic_ui_tick_alert-notification-confirm-positive-epidemic-sound.mp3",
  );
  for (const [index, file] of [alertClick, cleanClick].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.75 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "epidemic-alert-confirm",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "epidemic_sound",
        source_url: pathToFileURL(alertClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "epidemic-clean-interface-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "epidemic_sound",
        source_url: pathToFileURL(cleanClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["epidemic-clean-interface-click"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.004));
  assert.ok(mix.every((cue) => cue.durationS <= 0.07));
});

test("Studio V4 overlay chain uses story-specific proof cards instead of hardcoded benchmark copy", () => {
  assert.equal(typeof buildOverlayChain, "function");

  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Lego Batman",
      primary_source: "GameSpot",
      first_frame_text: "LEGO BATMAN",
      thumbnail_headline: "ARKHAM DNA",
      proof_card_primary: "ROCKSTEADY LISTED",
      proof_card_secondary: "ARKHAM-LITE COMBAT",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /LEGO BATMAN/);
  assert.match(chain, /ARKHAM DNA/);
  assert.match(chain, /ROCKSTEADY LISTED/);
  assert.match(chain, /ARKHAM-LITE COMBAT/);
  assert.doesNotMatch(chain, /STEAMDB PEAK|MORE THAN 3X FH5 PEAK|OPTIMISED\. NO DENUVO/);
});

test("Studio V4 overlay chain avoids raw straight apostrophes inside ffmpeg drawtext strings", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Assassin's Creed Black Flag",
      primary_source: "Eurogamer",
      first_frame_text: "Assassin's Creed Black Flag",
      thumbnail_headline: "Assassin's Creed Black Flag",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /ASSASSIN\u2019S CREED/);
  assert.doesNotMatch(chain, /ASSASSIN\\'S|ASSASSIN'S/);
});

test("Studio V4 proof renderer keeps source footage inside a safe vertical compose", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.match(source, /split=2\[bgsrc\$\{i\}\]\[fgsrc\$\{i\}\]/);
  assert.match(source, /boxblur=32:1/);
  assert.match(source, /scale=1000:1760:force_original_aspect_ratio=decrease:in_range=pc:out_range=tv/);
  assert.match(source, /background_drift_ratio/);
  assert.match(source, /foreground_drift_x_px/);
  assert.match(source, /foreground_drift_y_px/);
  assert.match(source, /overlay=x='\(W-w\)\/2\+sin\(t\*\$\{depth\.foreground_rate_x\.toFixed\(2\)\}\+\$\{i\}\)\*\$\{depth\.foreground_drift_x_px\}'/);
  assert.doesNotMatch(source, /crop=1080:1920:\(iw-1080\)\/2:\(ih-1920\)\/2/);
  assert.match(source, /\[overlayBase\]ass=\$\{assPathFilter\(assPath\)\},format=yuv420p\[outv\]/);
  assert.match(source, /"-pix_fmt",\s*"yuv420p"/);
});

test("Studio V4 proof renderer strips input SFX metadata and chapters from final MP4s", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.match(source, /"-map_metadata",\s*"-1"/);
  assert.match(source, /"-map_chapters",\s*"-1"/);
});

test("Studio V4 proof renderer uses stable voice gain and final mixed loudness", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /dynaudnorm/);
  assert.match(source, /acompressor=threshold=-30dB:ratio=5\.5:attack=4:release=260:makeup=1/);
  assert.match(source, /alimiter=limit=0\.68:level=disabled/);
  assert.match(source, /amix=inputs=\$\{mixLabels\.length\}:duration=first:dropout_transition=0:normalize=0/);
  assert.match(source, /loudnorm=I=-17:TP=-2\.5:LRA=5/);
  assert.match(source, /loudnorm=I=-16:TP=-2:LRA=6/);
  assert.match(source, /atrim=duration=\$\{cueDuration\.toFixed\(3\)\},afade=t=in/);
});

test("Studio V4 proof renderer reports current SFX, voice and visual design policies", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.match(source, /sfx_mix_policy_version:\s*STUDIO_V4_SFX_MIX_POLICY_VERSION/);
  assert.match(source, /voice_mix_policy_version:\s*STUDIO_V4_VOICE_MIX_POLICY_VERSION/);
  assert.match(source, /visual_design_policy_version:\s*STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION/);
  assert.equal(STUDIO_V4_SFX_MIX_POLICY_VERSION, "source_lock_news_tick_v6");
  assert.equal(STUDIO_V4_VOICE_MIX_POLICY_VERSION, "local_voice_levelled_v2");
  assert.equal(STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION, "pulse_signature_repeat_free_v13");
});

test("Studio V4 overlay applies identity-aware living motion behind readable content", () => {
  const chain = buildOverlayChain({
    story: {
      id: "living-motion-proof",
      content_identity_id: "game_update",
      canonical_subject: "Halo: Campaign Evolved",
      primary_source: "Xbox",
      first_frame_text: "HALO CAMPAIGN CHANGES",
      thumbnail_headline: "HALO CAMPAIGN CHANGES",
      proof_card_primary: "CO-OP UPDATE",
      proof_card_secondary: "WHAT PLAYERS GET",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawtext=text='PATCH'/);
  assert.match(chain, /sin\(t\*/);
  assert.match(chain, /color=0x64D2FF@0\.0/);
  assert.match(chain, /PULSE \/\/ BRIEF/);
  assert.doesNotMatch(chain, /orb|bokeh|blob/i);
});

test("Studio V4 overlay chain brightens the opening instead of globally darkening first frames", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Steam Controller",
      primary_source: "Eurogamer",
      first_frame_text: "STEAM CONTROLLER DATE LEAK",
      thumbnail_headline: "STEAM CONTROLLER DATE LEAK",
      proof_card_primary: "DATE WINDOW WATCH",
      proof_card_secondary: "PRICE AND COMPATIBILITY",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /eq=brightness='if\(lt\(t\\,3\.3\)\\,0\.055\\,-0\.015\)':contrast=1\.10:saturation=1\.20:eval=frame/);
  assert.doesNotMatch(chain, /eq=brightness=-0\.045/);
});

test("Studio V4 overlay chain uses layered premium plates instead of flat orange blocks", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Forza Horizon 6",
      primary_source: "Insider Gaming",
      first_frame_text: "FORZA PRICE JUMP",
      thumbnail_headline: "PRICE CHECK",
      proof_card_primary: "STORE LISTING WATCH",
      proof_card_secondary: "BUY, WAIT OR SKIP",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /x=70:y=508:w=940:h=208:color=0xFF6B1A@0\.88:t=fill/);
  assert.match(chain, /color=0x111827@0\.58/);
  assert.match(chain, /shadowcolor=black@0\.82:shadowx=3:shadowy=3/);
  assert.match(chain, /mod\(t\*[0-9]+\\,1540\)/);
  assert.match(chain, /SOURCE LOCK/);
});

test("Studio V4 overlay chain adds newsroom-grade labels and layered glass rails", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Boltgun 2",
      primary_source: "IGN",
      first_frame_text: "BOLTGUN 2",
      thumbnail_headline: "LOUDER THAN EXPECTED",
      proof_card_primary: "DEMO IMPRESSIONS",
      proof_card_secondary: "WHY PLAYERS CARE",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /PULSE \/\/ NEWSWIRE/);
  assert.doesNotMatch(chain, /drawtext=text='VERIFY'/);
  assert.match(chain, /PULSE \/\/ BRIEF/);
  assert.match(chain, /PULSE PROOF/);
  assert.match(chain, /PLAYER IMPACT/);
  assert.match(chain, /color=0x0B0F19@0\.72/);
  assert.match(chain, /color=0xFF6B1A@0\.95/);
  assert.match(chain, /color=0x38BDF8@0\.78/);
  assert.doesNotMatch(chain, /color=0xFF6B1A@0\.88:t=fill/);
});

test("Studio V4 overlay chain keeps opening metadata below Instagram top chrome", () => {
  const story = {
    canonical_subject: "The Expanse: Osiris Reborn",
    primary_source: "Xbox",
    first_frame_text: "EXPANSE GAMEPLAY REVEAL",
    thumbnail_headline: "EXPANSE GAMEPLAY REVEAL",
  };
  const layout = buildOverlayLayout({ story });
  const chain = buildOverlayChain({
    story,
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.equal(layout.frame.instagram_top_chrome_safe_px, 240);
  for (const block of layout.text_blocks) {
    assert.ok(
      block.y >= layout.frame.instagram_top_chrome_safe_px,
      `${block.id} starts inside Instagram top chrome at ${block.y}`,
    );
  }
  assert.doesNotMatch(chain, /drawbox=x=42:y=44:w=996:h=98/);
  assert.doesNotMatch(chain, /drawtext=text='THE EXPANSE\\: OSIRIS REBORN'.*y=65/);
  assert.match(chain, /drawtext=text='PULSE \/\/ TRAILER TRUTH'.*y=268/);
  assert.match(chain, /drawtext=text='SOURCE LOCK\s+XBOX'.*y=268/);
});

test("Studio V4 overlay chain avoids large flat text cards over real footage", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Boltgun 2",
      primary_source: "IGN",
      first_frame_text: "BOLTGUN 2",
      thumbnail_headline: "LOUDER THAN EXPECTED",
      proof_card_primary: "DEMO IMPRESSIONS",
      proof_card_secondary: "BIGGER ARENAS",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /w=9[0-9]{2}:h=2[0-9]{2}:color=0x111827@0\.7[0-9]:t=fill/);
  assert.match(chain, /:t=2:enable='between\(t,0,2\.2\)'/);
  assert.match(chain, /0x38BDF8@0\.92/);
  assert.match(chain, /0xF8FAFC@0\.88/);
});

test("Studio V4 overlay layout keeps long mobile text inside safe frame bounds", () => {
  assert.equal(typeof buildOverlayLayout, "function");

  const layout = buildOverlayLayout({
    story: {
      canonical_subject: "Pokemon Go",
      primary_source: "Eurogamer",
      first_frame_text: "Pokemon Go Mega Mewtwo Is",
      thumbnail_headline: "Pokemon Go Mega Mewtwo Is",
      proof_card_primary: "Mega Mewtwo finally has a Pokemon Go route",
      proof_card_secondary: "Free Go Fest access changes the player ask",
    },
  });

  for (const block of layout.text_blocks) {
    assert.ok(
      block.estimated_right_px <= 1038,
      `${block.id} exceeds right safe bound at ${block.estimated_right_px}`,
    );
    assert.ok(
      block.estimated_bottom_px <= 1828,
      `${block.id} exceeds bottom safe bound at ${block.estimated_bottom_px}`,
    );
  }

  const headline = layout.text_blocks.find((block) => block.id === "headline_card");
  assert.deepEqual(headline.lines, ["POKEMON GO MEGA", "MEWTWO IS"]);
  assert.ok(headline.font_size_px <= 58);
  assert.ok(headline.lines.length >= 2);
});

test("Studio V4 overlay chain avoids duplicate story cards over owned generated motion decks", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Pokemon Go",
      primary_source: "Eurogamer",
      first_frame_text: "POKEMON GO MEGA MEWTWO IS",
      thumbnail_headline: "POKEMON GO MEGA MEWTWO IS",
      proof_card_primary: "MEWTWO ROUTE",
      proof_card_secondary: "FREE GO FEST",
      visual_v4_bridge_video_clips: Array.from({ length: 6 }, (_, index) => ({
        path: `output/generated-motion/rss_ca673f22ddbbbdfc/${String(index + 1).padStart(2, "0")}_card.mp4`,
        source_type: "internally_generated_motion_graphic",
      })),
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /PULSE \/\/ NEWSWIRE/);
  assert.doesNotMatch(chain, /SOURCE LOCK/);
  assert.match(chain, /PULSE GAMING/);
  assert.doesNotMatch(chain, /MEWTWO IS/);
  assert.doesNotMatch(chain, /PULSE PROOF|PLAYER IMPACT/);
  assert.doesNotMatch(chain, /x=50:y=248:w=980/);
  assert.doesNotMatch(chain, /x=64:y=520:w=956/);
});

test("Studio V4 overlay chain suppresses only the opening card during first-frame repair", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "GTA 6",
      primary_source: "Rockstar",
      first_frame_text: "GTA 6 PRICE RISK",
      thumbnail_headline: "GTA 6 PRICE RISK",
      proof_card_primary: "PREORDER WINDOW",
      proof_card_secondary: "PRICE RISK",
      visual_repair_lane: "visual_first_frame_rerender",
      suppress_opening_story_cards: true,
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /PULSE \/\/ WISHLIST CHECK/);
  assert.doesNotMatch(chain, /drawtext=text='SOURCE LOCK\s+ROCKSTAR'.*between\(t,0,3\.3\)/);
  assert.doesNotMatch(chain, /color=0x111827@0\.58:t=fill:enable='between\(t,0,3\.3\)'/);
  assert.doesNotMatch(chain, /drawtext=text='GTA 6 PRICE RISK'.*between\(t,0,3\.3\)/);
  assert.match(chain, /drawtext=text='GTA 6 PRICE RISK'.*between\(t,4\.0,8\.6\)/);
  assert.match(chain, /PULSE PROOF/);
  assert.match(chain, /PLAYER IMPACT/);
  assert.match(chain, /PULSE GAMING/);
});
