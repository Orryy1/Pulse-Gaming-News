"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

const {
  applySegmentValidationToClipRefs,
  exhaustedSourceFamiliesFromReport,
  filterExhaustedSourceFamilyClipRefs,
  filterPreviouslySampledClipRefs,
  filterSegmentsForStoryIds,
  guardSegmentSample,
  mergeOfficialTrailerSegmentReports,
  renderOfficialTrailerSegmentValidationMarkdown,
  runOfficialTrailerSegmentValidation,
  segmentKeyForClipRef,
  VALIDATOR_RULESET_VERSION,
} = require("../../lib/studio/v2/official-trailer-segment-validator");
const {
  balanceClipRefsAcrossStories,
  buildClipRefsFromReport,
  reportOutputTargets,
} = require("../../tools/official-trailer-segment-validator");

function clip(overrides = {}) {
  return {
    path: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
    source: "official-trailer-reference",
    sourceType: "steam_movie",
    entity: "GTA",
    storyId: "rss_5b3abe925b27a199",
    durationS: 5,
    mediaStartS: 42,
    provenance: {
      requires_segment_validation: true,
      segment_validated: false,
      allowed_for_flash_lane: false,
    },
    ...overrides,
  };
}

function tempOutputRoot(name) {
  return path.join(process.cwd(), "test", "output", "tmp-segment-validator", name);
}

function referencePlan(storyId, sourceUrl) {
  return {
    story_id: storyId,
    references: [
      {
        source_url: sourceUrl,
        source_type: "steam_storefront_video_reference",
        source_family: `steam_${storyId}`,
        entity: storyId,
        provider: "steam",
        store_app_id: "12345",
        movie_id: storyId,
        duration_seconds: 78,
        segment_validation_eligible: true,
      },
    ],
  };
}

async function cleanTempRoot(root) {
  if (root.includes(`${path.sep}test${path.sep}output${path.sep}`)) {
    await fs.remove(root);
  }
}

async function fakeExtractor({ outputPath }) {
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, Buffer.from("fake-segment-frame"));
  return { outputPath };
}

function passingQa(outputPath) {
  return {
    local_path: outputPath,
    file_size: 100,
    content_hash: path.basename(outputPath),
    width: 1280,
    height: 720,
    thumbnail_safe: true,
    likely_has_face: false,
    black_frame: false,
    blur_verdict: "pass",
    verdict: "pass",
    warnings: [],
    failures: [],
    prescan: {
      likely_is_logo: false,
      text_overlay_likelihood: 0.1,
      edge_density: 0.22,
      saturation_mean: 0.45,
    },
  };
}

test("official trailer segment validator defaults to dry-run and performs no writes", async () => {
  const outputRoot = tempOutputRoot("dry-run");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    outputRoot,
    extractor: async () => {
      extractorCalls++;
      throw new Error("extractor should not run in dry-run");
    },
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.summary.segments_would_validate, 1);
  assert.equal(report.summary.samples_would_extract, 3);
  assert.equal(extractorCalls, 0);
  assert.equal(await fs.pathExists(outputRoot), false);
});

test("official trailer segment validator reports source provenance for each sampled segment", async () => {
  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        provenance: {
          provider: "steam",
          movie_name: "RDR2 Launch Trailer",
          store_app_title: "Red Dead Redemption 2",
        },
      }),
    ],
    { outputRoot: tempOutputRoot("provenance-dry-run") },
  );

  assert.equal(report.segments[0].provider, "steam");
  assert.equal(report.segments[0].reference_title, "RDR2 Launch Trailer");
  assert.equal(report.segments[0].store_app_title, "Red Dead Redemption 2");
});

test("segment validator CLI scopes batch clip refs from explicit reference reports", () => {
  const refs = buildClipRefsFromReport(
    {
      plans: [
        {
          story_id: "stale-frame-story",
          frames: [
            {
              status: "accepted",
              entity: "Stale Game",
              source_url:
                "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/stale.mp4?tag=14",
              source_type: "official_trailer",
              target_time_seconds: 42,
              qa: {
                verdict: "pass",
                prescan: {
                  edge_density: 0.24,
                  saturation_mean: 0.42,
                  text_overlay_likelihood: 0.05,
                },
              },
            },
          ],
        },
      ],
    },
    {
      plans: [
        referencePlan(
          "story-a",
          "https://video.akamai.steamstatic.com/store_trailers/12345/1001/hash/hls_264_master.m3u8",
        ),
        referencePlan(
          "story-b",
          "https://video.akamai.steamstatic.com/store_trailers/12345/1002/hash/hls_264_master.m3u8",
        ),
      ],
    },
    null,
    {
      includeExploratoryWindows: true,
      exploratoryStartSeconds: [36],
      candidateWindowsPerSource: 1,
      maxSegments: 8,
    },
  );

  const storyIds = [...new Set(refs.map((ref) => ref.story_id).filter(Boolean))].sort();
  assert.deepEqual(storyIds, ["story-a", "story-b"]);
  assert.equal(refs.some((ref) => ref.story_id === "stale-frame-story"), false);
});

test("segment validator CLI balances batch clip refs across stories before segment caps", () => {
  const refs = [
    clip({ story_id: "story-a", storyId: "story-a", mediaStartS: 36 }),
    clip({ story_id: "story-a", storyId: "story-a", mediaStartS: 42 }),
    clip({ story_id: "story-a", storyId: "story-a", mediaStartS: 48 }),
    clip({ story_id: "story-b", storyId: "story-b", mediaStartS: 36 }),
    clip({ story_id: "story-b", storyId: "story-b", mediaStartS: 42 }),
    clip({ story_id: "story-c", storyId: "story-c", mediaStartS: 36 }),
  ];

  const balanced = balanceClipRefsAcrossStories(refs);

  assert.deepEqual(
    balanced.slice(0, 3).map((ref) => ref.story_id),
    ["story-a", "story-b", "story-c"],
  );
  assert.deepEqual(
    balanced.map((ref) => `${ref.story_id}:${ref.mediaStartS}`),
    ["story-a:36", "story-b:36", "story-c:36", "story-a:42", "story-b:42", "story-a:48"],
  );
});

test("segment validator CLI writes story-scoped report aliases for one-story runs", () => {
  const targets = reportOutputTargets({
    applyLocal: true,
    storyId: "1s4e2ws",
  });
  const relativeJsonPaths = targets.map((target) => path.relative(process.cwd(), target.json));

  assert.ok(
    relativeJsonPaths.includes(
      path.join("test", "output", "official_trailer_segment_validation_apply_local.json"),
    ),
  );
  assert.ok(
    relativeJsonPaths.includes(
      path.join(
        "test",
        "output",
        "official_trailer_segment_validation_story_1s4e2ws_apply_local.json",
      ),
    ),
  );
});

test("official trailer segment validator apply-local marks clean sampled windows as Flash Lane allowed", async () => {
  const outputRoot = tempOutputRoot("clean");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => passingQa(outputPath),
  });

  assert.equal(report.mode, "apply_local");
  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].segment_validated, true);
  assert.equal(report.segments[0].story_id, "rss_5b3abe925b27a199");
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
  assert.equal(report.segments[0].validation_reason, "segment_samples_passed");
  assert.equal(report.segments[0].segment_motion_class, "gameplay_action");
  assert.ok(report.segments[0].action_score >= 70);
  assert.ok(report.segments[0].samples.every((sample) => sample.local_path.startsWith(outputRoot)));
});

test("official trailer segment validator rejects PEGI/ESRB/title-card-like windows", async () => {
  const outputRoot = tempOutputRoot("rating-card");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      prescan: {
        likely_is_logo: true,
        text_overlay_likelihood: 0.39,
        edge_density: 0.26,
        saturation_mean: 0.22,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_title_or_rating_card");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator rejects repeated visual rating-card samples", async () => {
  const outputRoot = tempOutputRoot("repeated-visual-rating-cards");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => {
      call += 1;
      return {
        ...passingQa(outputPath),
        content_hash: `rating-card-${call}`,
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.22,
          white_text_on_dark_likelihood: 0.05,
          edge_density: 0.38,
          saturation_mean: 0.38,
          bright_pixel_ratio: 0.48,
          dark_pixel_ratio: 0.08,
        },
      };
    },
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_title_or_rating_card");
  assert.equal(report.segments[0].action_sample_count, 0);
  assert.ok(
    report.segments[0].samples.every((sample) =>
      sample.qa.failures.includes("title_or_rating_card_frame"),
    ),
  );
  assert.deepEqual(report.segments[0].sample_rejection_reasons, ["title_or_rating_card_frame"]);
});

test("official trailer segment validator preflight-rejects rating-board references before extraction", async () => {
  const outputRoot = tempOutputRoot("rating-board-reference");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        movieName: "GTA Official PEGI Rating Trailer",
        provenance: {
          movie_name: "GTA Official PEGI Rating Trailer",
        },
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("rating-board reference should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_source_is_rating_board_reference");
  assert.equal(report.segments[0].segment_validated, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator preflight-rejects logo/title-only references", async () => {
  const outputRoot = tempOutputRoot("logo-only-reference");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        movieName: "Red Dead Redemption 2 Official Logo Loop",
        provenance: {
          movie_name: "Red Dead Redemption 2 Official Logo Loop",
        },
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("logo-only reference should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_source_is_logo_or_title_only_reference");
  assert.equal(report.segments[0].segment_validated, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator preflight-rejects localised non-English references", async () => {
  const outputRoot = tempOutputRoot("localised-non-english-reference");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        movieName: "RDR2 60 FPS Trailer (DE)",
        provenance: {
          movie_name: "RDR2 60 FPS Trailer (DE)",
        },
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("localised reference should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_source_is_localised_non_english_reference");
  assert.equal(report.segments[0].segment_validated, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator preflight-rejects subtitle-labelled references", async () => {
  const outputRoot = tempOutputRoot("embedded-subtitle-reference");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        movieName: "BioShock Infinite Launch Trailer Subtitles",
        provenance: {
          movie_name: "BioShock Infinite Launch Trailer Subtitles",
        },
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("subtitle reference should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_source_has_embedded_subtitle_reference");
  assert.equal(report.segments[0].segment_validated, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator preflight-rejects YouTube watch URLs before extraction", async () => {
  const outputRoot = tempOutputRoot("youtube-watch-reference");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://www.youtube.com/watch?v=officialRef",
        sourceType: "igdb_video",
        segment_validation_eligible: false,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("YouTube references should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].source_url_kind, "youtube_watch");
  assert.equal(report.segments[0].validation_reason, "segment_source_is_youtube_reference");
  assert.equal(report.segments[0].segment_validated, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator preflight-rejects publisher HTML URLs before extraction", async () => {
  const outputRoot = tempOutputRoot("publisher-html-reference");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://www.rockstargames.com/reddeadredemption2/videos",
        sourceType: "official_trailer",
        segment_validation_eligible: false,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("HTML references should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].source_url_kind, "html_or_unknown_page");
  assert.equal(report.segments[0].validation_reason, "segment_source_url_not_direct_media");
  assert.equal(report.segments[0].segment_validated, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator preflight-rejects official segments still inside intro material", async () => {
  const outputRoot = tempOutputRoot("intro-window");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        mediaStartS: 23,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async () => {
        extractorCalls += 1;
        throw new Error("intro segment should be rejected before extraction");
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.samples_extracted, 0);
  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_starts_in_trailer_intro_or_rating_window");
  assert.equal(report.segments[0].media_start_s, 23);
});

test("official trailer segment validator allows short trailer windows when 36s skip would exhaust input", async () => {
  const outputRoot = tempOutputRoot("short-trailer-window");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        mediaStartS: 12,
        sourceDurationS: 28,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async (args) => {
        extractorCalls += 1;
        return fakeExtractor(args);
      },
      inspectFrame: async (outputPath) => passingQa(outputPath),
    },
  );

  assert.equal(extractorCalls, 3);
  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "segment_samples_passed");
  assert.equal(report.segments[0].media_start_s, 12);
});

test("official trailer segment validator samples short official product page loops from the first frame", async () => {
  const outputRoot = tempOutputRoot("official-product-page-start-zero");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;
  let inspectCalls = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-hero.mp4",
        sourceType: "official_platform_product_page",
        sourceDurationS: 9.88,
        mediaStartS: 0,
        entity: "PS5",
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: async (args) => {
        extractorCalls += 1;
        return fakeExtractor(args);
      },
      inspectFrame: async (outputPath) => {
        inspectCalls += 1;
        const samples = [
          { edge_density: 0.031, saturation_mean: 0.74, score: 89.3, action: 67.8 },
          { edge_density: 0.047, saturation_mean: 0.75, score: 91.2, action: 69.7 },
          { edge_density: 0.03, saturation_mean: 0.71, score: 89.2, action: 67.7 },
        ];
        const sample = samples[inspectCalls - 1] || samples[0];
        return {
          ...passingQa(outputPath),
          content_hash: `official-product-start-zero-${inspectCalls}`,
          gameplay_action_score: sample.action,
          gameplay_action_candidate: false,
          gameplay_action_reason: "official_product_motion_not_gameplay",
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: sample.edge_density,
            saturation_mean: sample.saturation_mean,
            dark_pixel_ratio: 0.24,
            bright_pixel_ratio: 0.02,
            letterbox_bar_ratio: 0,
          },
          visual_taste: {
            verdict: "pass",
            reason: "taste_passed",
            score: sample.score,
            tags: ["product_motion", "colourful"],
          },
        };
      },
    },
  );

  assert.equal(extractorCalls, 3);
  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "official_product_motion_samples_passed");
  assert.equal(report.segments[0].media_start_s, 0);
});

test("official trailer segment validator rejects promo CTA card windows", async () => {
  const outputRoot = tempOutputRoot("promo-cta-card");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.03,
        white_text_on_dark_likelihood: 0.82,
        bright_pixel_ratio: 0.07,
        dark_pixel_ratio: 0.72,
        edge_density: 0.14,
        saturation_mean: 0.28,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_title_or_rating_card");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator accepts letterboxed cinematic gameplay samples", async () => {
  const outputRoot = tempOutputRoot("letterboxed-cinematic-gameplay");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        entity: "Red Dead",
        path: "https://video.akamai.steamstatic.com/store_trailers/reddead/hls_264_master.m3u8",
        mediaStartS: 36,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const samples = [
          { edge_density: 0.078, saturation_mean: 0.65, central_dark_pixel_ratio: 0.41 },
          { edge_density: 0.067, saturation_mean: 0.66, central_dark_pixel_ratio: 0.46 },
          { edge_density: 0.073, saturation_mean: 0.53, central_dark_pixel_ratio: 0.57 },
        ];
        const sample = samples[call - 1] || samples[0];
        return {
          ...passingQa(outputPath),
          content_hash: `letterboxed-red-dead-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: call === 3 ? 0 : 0.72,
            edge_density: sample.edge_density,
            saturation_mean: sample.saturation_mean,
            dark_pixel_ratio: 0.54,
            bright_pixel_ratio: 0.08,
            central_dark_pixel_ratio: sample.central_dark_pixel_ratio,
            central_bright_pixel_ratio: 0.1,
            letterbox_bar_ratio: 0.24,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.summary.segments_rejected, 0);
  assert.equal(report.segments[0].validation_reason, "segment_samples_passed");
  assert.equal(report.segments[0].segment_motion_class, "gameplay_action");
  assert.equal(report.segments[0].action_sample_count, 3);
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
});

test("official trailer segment validator rejects black-frame windows", async () => {
  const outputRoot = tempOutputRoot("black-frame");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      thumbnail_safe: false,
      black_frame: true,
      verdict: "fail",
      failures: ["black_frame"],
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_black_frame");
});

test("official trailer segment validator rejects low-detail blurry windows", async () => {
  const outputRoot = tempOutputRoot("low-detail");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.08,
        edge_density: 0.03,
        saturation_mean: 0.14,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_low_detail_frame");
});

test("official trailer segment validator downgrades low-detail colourful samples from action footage", async () => {
  const outputRoot = tempOutputRoot("low-detail-colourful-action-downgrade");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => {
      call += 1;
      return {
        ...passingQa(outputPath),
        content_hash: `soft-colour-${call}`,
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.02,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.145,
          saturation_mean: 0.64,
          bright_pixel_ratio: 0.12,
          dark_pixel_ratio: 0.14,
        },
      };
    },
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_lacks_gameplay_action_samples");
  assert.equal(report.segments[0].action_sample_count, 0);
  assert.equal(report.segments[0].samples[0].qa.gameplay_action_candidate, false);
  assert.equal(report.segments[0].samples[0].qa.gameplay_action_reason, "not_enough_visual_detail");
});

test("official trailer segment validator accepts clean official direct-media motion when high-score samples are edge-soft", async () => {
  const outputRoot = tempOutputRoot("official-direct-media-edge-soft-motion");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://cdn.trailers.xboxservices.com/trailers/official-oblivion-gameplay.m3u8",
        sourceType: "platform_storefront_video_reference",
        sourceDurationS: 156,
        mediaStartS: 36,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        return {
          ...passingQa(outputPath),
          content_hash: `official-clean-motion-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.12,
            saturation_mean: 0.61,
            dark_pixel_ratio: 0.32,
            bright_pixel_ratio: 0.01,
            letterbox_bar_ratio: 0.05,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "official_direct_media_clean_motion_samples_passed");
  assert.equal(report.segments[0].action_sample_count, 0);
  assert.ok(report.segments[0].action_score >= 76);
  assert.equal(report.segments[0].segment_motion_class, "gameplay_action");
});

test("official trailer segment validator accepts clean official Steam gameplay trailer motion when frames are cinematic", async () => {
  const outputRoot = tempOutputRoot("official-steam-gameplay-trailer-cinematic-motion");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://video.akamai.steamstatic.com/store_trailers/3727390/2016455987/hash/hls_264_master.m3u8",
        sourceType: "steam_movie",
        movieName: "Gameplay Trailer",
        sourceDurationS: 86,
        mediaStartS: 66,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const samples = [
          { edge_density: 0.09, saturation_mean: 0.36, score: 80, tags: ["colourful"] },
          { edge_density: 0.148, saturation_mean: 0.275, score: 83, tags: ["detail_rich"] },
          { edge_density: 0.132, saturation_mean: 0.369, score: 86, tags: ["colourful"] },
        ];
        const sample = samples[call - 1] || samples[0];
        return {
          ...passingQa(outputPath),
          content_hash: `steam-gameplay-trailer-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: sample.edge_density,
            saturation_mean: sample.saturation_mean,
            dark_pixel_ratio: 0.24,
            bright_pixel_ratio: 0.01,
            letterbox_bar_ratio: 0,
          },
          visual_taste: {
            verdict: "pass",
            reason: "taste_passed",
            score: sample.score,
            tags: sample.tags,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "official_storefront_trailer_motion_samples_passed");
  assert.equal(report.segments[0].action_sample_count, 0);
  assert.equal(report.segments[0].segment_motion_class, "gameplay_action");
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
});

test("official trailer segment validator labels official product page motion without pretending it is gameplay", async () => {
  const outputRoot = tempOutputRoot("official-product-motion");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-motion.mp4",
        sourceType: "official_platform_product_page",
        sourceDurationS: 9.88,
        mediaStartS: 4,
        entity: "PS5",
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        return {
          ...passingQa(outputPath),
          content_hash: `official-product-motion-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.18,
            saturation_mean: 0.62,
            dark_pixel_ratio: 0.28,
            bright_pixel_ratio: 0.02,
            letterbox_bar_ratio: 0.04,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "official_product_motion_samples_passed");
  assert.equal(report.segments[0].segment_motion_class, "official_product_motion");
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
  assert.ok(report.segments[0].action_score >= 76);
});

test("official trailer segment validator accepts polished official product motion with low gameplay edge density", async () => {
  const outputRoot = tempOutputRoot("official-product-polished-low-edge");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/ps5-product-hero.mp4",
        sourceType: "official_platform_product_page",
        sourceDurationS: 9.88,
        mediaStartS: 6.2,
        entity: "PS5",
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const samples = [
          { edge_density: 0.031, saturation_mean: 0.74, score: 89.3, action: 67.8 },
          { edge_density: 0.047, saturation_mean: 0.75, score: 91.2, action: 69.7 },
          { edge_density: 0.03, saturation_mean: 0.71, score: 89.2, action: 67.7 },
        ];
        const sample = samples[call - 1] || samples[0];
        return {
          ...passingQa(outputPath),
          content_hash: `official-product-polished-${call}`,
          gameplay_action_score: sample.action,
          gameplay_action_candidate: false,
          gameplay_action_reason: "official_product_motion_not_gameplay",
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: sample.edge_density,
            saturation_mean: sample.saturation_mean,
            dark_pixel_ratio: 0.24,
            bright_pixel_ratio: 0.02,
            letterbox_bar_ratio: 0,
          },
          visual_taste: {
            verdict: "pass",
            reason: "taste_passed",
            score: sample.score,
            tags: ["product_motion", "colourful"],
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "official_product_motion_samples_passed");
  assert.equal(report.segments[0].segment_motion_class, "official_product_motion");
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
  assert.ok(report.segments[0].action_score >= 67);
});

test("official trailer segment validator accepts official hardware lifestyle product motion", async () => {
  const outputRoot = tempOutputRoot("official-product-lifestyle-motion");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://gmedia.playstation.com/is/content/SIEPDC/global/portal/playstation-portal-lifestyle.mp4",
        sourceType: "official_platform_product_page",
        sourceDurationS: 10.24,
        mediaStartS: 4.3,
        entity: "PlayStation Portal",
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const samples = [
          { edge_density: 0.195, saturation_mean: 0.262, score: 88, action: 69.2 },
          { edge_density: 0.063, saturation_mean: 0.431, score: 80.3, action: 61.7 },
          { edge_density: 0.183, saturation_mean: 0.214, score: 84.2, action: 65.7 },
        ];
        const sample = samples[call - 1] || samples[0];
        return {
          ...passingQa(outputPath),
          content_hash: `official-product-lifestyle-${call}`,
          gameplay_action_score: sample.action,
          gameplay_action_candidate: false,
          gameplay_action_reason: "official_product_lifestyle_motion_not_gameplay",
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: sample.edge_density,
            saturation_mean: sample.saturation_mean,
            dark_pixel_ratio: 0.25,
            bright_pixel_ratio: 0.05,
            letterbox_bar_ratio: 0,
          },
          visual_taste: {
            verdict: "pass",
            reason: "taste_passed",
            score: sample.score,
            tags: ["product_motion", "hardware_lifestyle"],
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "official_product_motion_samples_passed");
  assert.equal(report.segments[0].segment_motion_class, "official_product_motion");
  assert.ok(report.segments[0].action_score >= 64);
});

test("official trailer segment validator rejects explicitly blurred windows", async () => {
  const outputRoot = tempOutputRoot("blurred-window");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      blur_verdict: "fail",
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.04,
        edge_density: 0.16,
        saturation_mean: 0.38,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_low_detail_frame");
  assert.ok(
    report.segments[0].samples.every((sample) =>
      sample.qa.failures.includes("low_detail_official_frame"),
    ),
  );
});

test("official trailer segment validator rejects poor-subject windows", async () => {
  const outputRoot = tempOutputRoot("poor-subject-framing");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.02,
        white_text_on_dark_likelihood: 0,
        edge_density: 0.118,
        saturation_mean: 0.27,
        dark_pixel_ratio: 0.67,
        bright_pixel_ratio: 0.04,
        central_dark_pixel_ratio: 0.72,
        central_bright_pixel_ratio: 0.035,
        letterbox_bar_ratio: 0.03,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_poor_subject_frame");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator rejects repetitive dead windows", async () => {
  const outputRoot = tempOutputRoot("repetitive");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      content_hash: "same-frame",
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_samples_too_repetitive");
});

test("official trailer segment validator rejects clean but text-heavy non-gameplay windows", async () => {
  const outputRoot = tempOutputRoot("text-heavy-clean");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      content_hash: path.basename(outputPath),
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.34,
        white_text_on_dark_likelihood: 0,
        edge_density: 0.19,
        saturation_mean: 0.38,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_lacks_gameplay_action_samples");
  assert.equal(report.segments[0].segment_motion_class, "non_gameplay_context");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator rechecks stale pass taste records for promo slates", async () => {
  const outputRoot = tempOutputRoot("stale-promo-slate");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => {
      call += 1;
      if (call < 3) {
        return {
          ...passingQa(outputPath),
          content_hash: `clean-${call}`,
        };
      }
      return {
        ...passingQa(outputPath),
        content_hash: "stale-promo-slate",
        visual_taste: {
          verdict: "pass",
          reason: "legacy_pass",
          score: 100,
          tags: ["gameplay_candidate"],
        },
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.01,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.26,
          saturation_mean: 0.37,
          bright_pixel_ratio: 0.36,
          dark_pixel_ratio: 0.05,
          central_bright_pixel_ratio: 0.34,
          central_dark_pixel_ratio: 0.06,
        },
      };
    },
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_title_or_rating_card");
  assert.equal(report.segments[0].trim_recommended, false);
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
  assert.equal(report.segments[0].samples[2].status, "rejected_qa");
  assert.ok(report.segments[0].samples[2].qa.failures.includes("title_or_rating_card_frame"));
});

test("official trailer segment validator requires at least two gameplay/action samples", async () => {
  const outputRoot = tempOutputRoot("one-action-sample");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => {
      call += 1;
      if (call === 1) {
        return {
          ...passingQa(outputPath),
          content_hash: `action-${call}`,
        };
      }
      return {
        ...passingQa(outputPath),
        content_hash: `context-${call}`,
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.05,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.11,
          saturation_mean: 0.25,
        },
      };
    },
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_lacks_gameplay_action_samples");
  assert.equal(report.segments[0].action_sample_count, 1);
});

test("official trailer segment validator accepts branded trailer gameplay when neighbouring frames are clean", async () => {
  const outputRoot = tempOutputRoot("branded-trailer-motion");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://media.gamereactor.dk/t_Forza_Horizon_6_Official_Launch_Trailer_806443.mp4",
        sourceType: "licensed_direct_media_url",
        sourceDurationS: 95.57,
        mediaStartS: 74.72,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const base = passingQa(outputPath);
        if (call === 1) {
          return {
            ...base,
            content_hash: "branded-motion-a",
            prescan: {
              likely_is_logo: false,
              text_overlay_likelihood: 0,
              white_text_on_dark_likelihood: 0,
              edge_density: 0.118,
              saturation_mean: 0.331,
              dark_pixel_ratio: 0.08,
              bright_pixel_ratio: 0.08,
            },
          };
        }
        if (call === 2) {
          return {
            ...base,
            content_hash: "branded-motion-b",
            prescan: {
              likely_is_logo: false,
              text_overlay_likelihood: 0,
              white_text_on_dark_likelihood: 0,
              edge_density: 0.113,
              saturation_mean: 0.477,
              dark_pixel_ratio: 0.22,
              bright_pixel_ratio: 0.07,
            },
          };
        }
        return {
          ...base,
          content_hash: "branded-motion-c",
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.187,
            saturation_mean: 0.586,
            dark_pixel_ratio: 0.004,
            bright_pixel_ratio: 0.015,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "branded_direct_media_motion_samples_passed");
  assert.equal(report.segments[0].action_sample_count, 1);
  assert.ok(report.segments[0].action_score >= 70);
  assert.equal(report.segments[0].segment_motion_class, "gameplay_action");
});

test("official trailer segment validator accepts short official detail-motion clips", async () => {
  const outputRoot = tempOutputRoot("short-detail-motion");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://video.twimg.com/amplify_video/2036120548040658944/vid/avc1/720x1280/detail.mp4",
        sourceType: "licensed_direct_media_url",
        sourceDurationS: 23.98,
        mediaStartS: 6.71,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const base = passingQa(outputPath);
        const samples = [
          { edge_density: 0.101, saturation_mean: 0.435 },
          { edge_density: 0.13, saturation_mean: 0.451 },
          { edge_density: 0.12, saturation_mean: 0.5 },
        ];
        return {
          ...base,
          content_hash: `short-detail-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            dark_pixel_ratio: 0.08,
            bright_pixel_ratio: 0.06,
            ...samples[call - 1],
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "short_direct_media_detail_motion_samples_passed");
  assert.equal(report.segments[0].action_sample_count, 0);
  assert.ok(report.segments[0].action_score >= 68);
});

test("official trailer segment validator keeps animated key art out of detail-motion fallback", async () => {
  const outputRoot = tempOutputRoot("animated-key-art-still-block");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://cdn.forza.net/strapi-uploads/assets/Forza_Horizon_6_Primary_Animated_Keyart_f0431e036f.webm",
        sourceType: "licensed_direct_media_url",
        sourceDurationS: 10,
        mediaStartS: 5.75,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        return {
          ...passingQa(outputPath),
          content_hash: `key-art-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.265,
            saturation_mean: 0.211,
            dark_pixel_ratio: 0.05,
            bright_pixel_ratio: 0.07,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_lacks_gameplay_action_samples");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator accepts clean short licensed direct media with one strong motion sample", async () => {
  const outputRoot = tempOutputRoot("short-direct-media-one-action-sample");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        path: "https://video.twimg.com/amplify_video/123/vid/avc1/720x1280/short.mp4",
        sourceType: "licensed_direct_media_url",
        sourceDurationS: 12,
        mediaStartS: 4,
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        if (call === 2) {
          return {
            ...passingQa(outputPath),
            content_hash: `action-${call}`,
          };
        }
        return {
          ...passingQa(outputPath),
          content_hash: `context-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0.04,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.15,
            saturation_mean: 0.45,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "short_direct_media_motion_samples_passed");
  assert.equal(report.segments[0].action_sample_count, 1);
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
});

test("official trailer segment validator rejects low-average action even with two action samples", async () => {
  const outputRoot = tempOutputRoot("low-average-action");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => {
      call += 1;
      const base = passingQa(outputPath);
      return {
        ...base,
        content_hash: `low-action-${call}`,
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0,
          white_text_on_dark_likelihood: 0,
          edge_density: call === 3 ? 0.13 : 0.17,
          saturation_mean: call === 3 ? 0.27 : 0.31,
        },
      };
    },
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_action_score_below_flash_threshold");
  assert.equal(report.segments[0].segment_motion_class, "non_gameplay_context");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
  assert.ok(report.segments[0].action_score < 70);
});

test("official trailer segment validator trims mixed-quality windows when two clean gameplay samples are strong", async () => {
  const outputRoot = tempOutputRoot("mixed-quality-window");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => {
      call += 1;
      const base = passingQa(outputPath);
      if (call <= 2) {
        return {
          ...base,
          content_hash: `strong-action-${call}`,
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.19,
            saturation_mean: 0.53,
            dark_pixel_ratio: 0.1,
            bright_pixel_ratio: 0.02,
          },
        };
      }
      return {
        ...base,
        content_hash: "weak-context-tail",
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.08,
          saturation_mean: 0.33,
          dark_pixel_ratio: 0.08,
          bright_pixel_ratio: 0.37,
        },
      };
    },
  });

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.summary.segments_rejected, 0);
  assert.equal(report.segments[0].status, "validated");
  assert.equal(report.segments[0].validation_reason, "trimmed_segment_samples_passed");
  assert.equal(report.segments[0].segment_validated, true);
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
  assert.equal(report.segments[0].segment_motion_class, "gameplay_action");
  assert.equal(report.segments[0].trim_recommended, true);
  assert.ok(report.segments[0].recommended_media_start_s >= 42);
  assert.ok(report.segments[0].recommended_duration_s > 0);
  assert.ok(report.segments[0].recommended_duration_s < 5);
  assert.deepEqual(report.segments[0].trim_sample_orders, [1, 2]);
  assert.equal(report.segments[0].action_sample_count, 2);
  assert.ok(report.segments[0].action_score >= 70);
});

test("official trailer segment validator trims high-detail official storefront windows without requiring colour-heavy samples", async () => {
  const outputRoot = tempOutputRoot("storefront-detail-trim");
  await cleanTempRoot(outputRoot);
  let call = 0;

  const report = await runOfficialTrailerSegmentValidation(
    [
      clip({
        sourceType: "steam_movie",
        source_type: "steam_movie",
        path: "https://video.akamai.steamstatic.com/store_trailers/3357650/307602564/hash/hls_264_master.m3u8",
        reference_title: "09_PRAGMATA_PV5_Multi_2K_EN_PEGI",
        movie_name: "09_PRAGMATA_PV5_Multi_2K_EN_PEGI",
        provider: "steam",
        store_app_id: "3357650",
        movie_id: "307602564",
      }),
    ],
    {
      applyLocal: true,
      outputRoot,
      extractor: fakeExtractor,
      inspectFrame: async (outputPath) => {
        call += 1;
        const base = passingQa(outputPath);
        if (call <= 2) {
          return {
            ...base,
            content_hash: `storefront-detail-${call}`,
            prescan: {
              likely_is_logo: false,
              text_overlay_likelihood: 0,
              white_text_on_dark_likelihood: 0,
              edge_density: call === 1 ? 0.28 : 0.27,
              saturation_mean: 0.11,
              dark_pixel_ratio: 0.02,
              bright_pixel_ratio: 0.01,
            },
          };
        }
        return {
          ...base,
          thumbnail_safe: false,
          content_hash: "washed-tail",
          verdict: "fail",
          failures: ["low_detail_official_frame"],
          prescan: {
            likely_is_logo: false,
            text_overlay_likelihood: 0,
            white_text_on_dark_likelihood: 0,
            edge_density: 0.01,
            saturation_mean: 0.02,
            dark_pixel_ratio: 0,
            bright_pixel_ratio: 0.92,
          },
        };
      },
    },
  );

  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].validation_reason, "trimmed_official_storefront_detail_motion_samples_passed");
  assert.equal(report.segments[0].trim_recommended, true);
  assert.deepEqual(report.segments[0].trim_sample_orders, [1, 2]);
  assert.ok(report.segments[0].recommended_duration_s < 5);
  assert.ok(report.segments[0].action_score >= 70);
});

test("segment validation report carries trimmed segment timing into Flash Lane clip refs", () => {
  const ref = clip();
  const report = {
    generated_at: "2026-05-02T22:00:00.000Z",
    segments: [
      {
        clip_key: segmentKeyForClipRef(ref),
        source_url: ref.path,
        source_type: ref.sourceType,
        entity: ref.entity,
        media_start_s: 42,
        duration_s: 5,
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "trimmed_segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        action_sample_count: 2,
        trim_recommended: true,
        recommended_media_start_s: 42.45,
        recommended_duration_s: 2.8,
        trim_sample_orders: [1, 2],
        samples: [{}, {}],
      },
    ],
  };

  const [upgraded] = applySegmentValidationToClipRefs([ref], report);

  assert.equal(upgraded.mediaStartS, 42.7);
  assert.equal(upgraded.durationS, 2.2);
  assert.equal(upgraded.provenance.segment_validated, true);
  assert.equal(upgraded.provenance.allowed_for_flash_lane, true);
  assert.equal(upgraded.provenance.segment_trim_recommended, true);
  assert.equal(upgraded.provenance.segment_original_start_s, 42);
  assert.equal(upgraded.provenance.segment_original_duration_s, 5);
  assert.equal(upgraded.provenance.segment_recommended_start_s, 42.45);
  assert.equal(upgraded.provenance.segment_recommended_duration_s, 2.8);
  assert.equal(upgraded.provenance.segment_render_start_s, 42.7);
  assert.equal(upgraded.provenance.segment_render_duration_s, 2.2);
  assert.equal(upgraded.provenance.segment_render_head_inset_s, 0.25);
  assert.equal(upgraded.provenance.segment_render_tail_inset_s, 0.35);
});

test("official trailer segment validator allows official game-character faces in segment samples", () => {
  const qa = guardSegmentSample(
    clip(),
    { seek_seconds: 44.4 },
    {
      thumbnail_safe: false,
      likely_has_face: true,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "fail",
      warnings: [],
      failures: ["unsafe_face_like_frame"],
      prescan: {
        likely_is_stock_person: false,
        likely_has_face: true,
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.42,
      },
    },
  );

  assert.equal(qa.thumbnail_safe, true);
  assert.equal(qa.failures.includes("unsafe_face_like_frame"), false);
  assert.ok(qa.warnings.includes("official_game_character_face_allowed"));
});

test("segment validation report upgrades only validated refs for Flash Lane use", () => {
  const ref = clip();
  const report = {
    generated_at: "2026-05-02T22:00:00.000Z",
    segments: [
      {
        clip_key: segmentKeyForClipRef(ref),
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 82,
        action_sample_count: 3,
        samples: [{}, {}, {}],
      },
    ],
  };

  const [upgraded] = applySegmentValidationToClipRefs([ref], report);

  assert.equal(upgraded.provenance.segment_validated, true);
  assert.equal(upgraded.provenance.allowed_for_flash_lane, true);
  assert.equal(upgraded.provenance.segment_validation_reason, "segment_samples_passed");
  assert.equal(upgraded.provenance.segment_validation_samples, 3);
});

test("segment validation report refuses legacy allowed segments without action proof", () => {
  const ref = clip();
  const report = {
    generated_at: "2026-05-02T22:00:00.000Z",
    segments: [
      {
        clip_key: segmentKeyForClipRef(ref),
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        samples: [{}, {}, {}],
      },
    ],
  };

  const [upgraded] = applySegmentValidationToClipRefs([ref], report);

  assert.equal(upgraded.provenance.segment_validated, true);
  assert.equal(upgraded.provenance.allowed_for_flash_lane, false);
  assert.equal(upgraded.provenance.segment_validation_reason, "segment_samples_passed");
  assert.equal(upgraded.provenance.segment_motion_class, null);
});

test("official trailer segment validator rejects apply-local outside test/output", async () => {
  await assert.rejects(
    () =>
      runOfficialTrailerSegmentValidation([clip()], {
        applyLocal: true,
        outputRoot: path.join(os.tmpdir(), "pulse-segment-validator-outside"),
      }),
    /apply-local segment validation output must stay under test\/output/i,
  );
});

test("segment validation resume filters clip refs already sampled in a previous report", () => {
  const clips = [
    clip({
      path: "https://video.example/gta.m3u8",
      mediaStartS: 36,
    }),
    clip({
      path: "https://video.example/gta.m3u8",
      mediaStartS: 72,
    }),
  ];

  const filtered = filterPreviouslySampledClipRefs(clips, {
    validator_ruleset_version: VALIDATOR_RULESET_VERSION,
    segments: [
      {
        clip_key: segmentKeyForClipRef(clips[0]),
        story_id: "rss_5b3abe925b27a199",
        status: "rejected",
        segment_validated: false,
      },
    ],
  });

  assert.deepEqual(filtered.map((item) => item.mediaStartS), [72]);
});

test("segment validation resume resamples stale previous reports from older rulesets", () => {
  const clips = [
    clip({
      path: "https://video.example/gta.m3u8",
      mediaStartS: 36,
    }),
  ];

  const filtered = filterPreviouslySampledClipRefs(clips, {
    validator_ruleset_version: VALIDATOR_RULESET_VERSION - 1,
    segments: [
      {
        clip_key: segmentKeyForClipRef(clips[0]),
        story_id: "rss_5b3abe925b27a199",
        status: "validated",
        segment_validated: true,
      },
    ],
  });

  assert.deepEqual(filtered.map((item) => item.mediaStartS), [36]);
});

test("segment validation resume ignores previous clips from other stories", () => {
  const marathonClip = clip({
    storyId: "1szzhy9",
    story_id: "1szzhy9",
    path: "https://video.example/shared-source.m3u8",
    entity: "Marathon",
    mediaStartS: 36,
    provenance: { story_id: "1szzhy9" },
  });
  const gtaClip = clip({
    storyId: "rss_5b3abe925b27a199",
    story_id: "rss_5b3abe925b27a199",
    path: marathonClip.path,
    entity: "Marathon",
    mediaStartS: 36,
    provenance: { story_id: "rss_5b3abe925b27a199" },
  });

  const filtered = filterPreviouslySampledClipRefs([marathonClip], {
    validator_ruleset_version: VALIDATOR_RULESET_VERSION,
    segments: [
      {
        ...gtaClip,
        clip_key: segmentKeyForClipRef(gtaClip),
        status: "rejected",
        segment_validated: false,
      },
    ],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].storyId, "1szzhy9");
});

test("segment validation merge can scope previous rows to the current story", () => {
  const previousReport = {
    apply_local: true,
    segments: [
      {
        story_id: "rss_5b3abe925b27a199",
        clip_key: "https://video.example/gta.m3u8|gta|36.00",
        source_url: "https://video.example/gta.m3u8",
        entity: "GTA",
        media_start_s: 36,
        status: "rejected",
        segment_validated: false,
      },
      {
        story_id: "1szzhy9",
        clip_key: "https://video.example/marathon.m3u8|marathon|36.00",
        source_url: "https://video.example/marathon.m3u8",
        entity: "Marathon",
        media_start_s: 36,
        status: "rejected",
        segment_validated: false,
      },
    ],
  };
  const currentReport = {
    apply_local: true,
    segments: [
      {
        story_id: "1szzhy9",
        clip_key: "https://video.example/marathon.m3u8|marathon|72.00",
        source_url: "https://video.example/marathon.m3u8",
        entity: "Marathon",
        media_start_s: 72,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    ],
  };

  const merged = mergeOfficialTrailerSegmentReports(previousReport, currentReport, {
    storyIds: ["1szzhy9"],
  });

  assert.deepEqual(merged.segments.map((segment) => segment.story_id), ["1szzhy9", "1szzhy9"]);
  assert.equal(merged.merge.previous_segment_count, 1);
  assert.equal(merged.merge.previous_unscoped_segment_count, 2);
  assert.deepEqual(merged.merge.scoped_story_ids, ["1szzhy9"]);
});

test("segment validation merge can preserve the global ledger while rendering a story scope", () => {
  const previousReport = {
    apply_local: true,
    output_root: tempOutputRoot("global-merge"),
    summary: {},
    segments: [
      {
        story_id: "rss_5b3abe925b27a199",
        clip_key: "https://video.example/gta.m3u8|gta|36.00",
        source_url: "https://video.example/gta.m3u8",
        entity: "GTA",
        media_start_s: 36,
        status: "rejected",
        segment_validated: false,
        allowed_for_flash_lane: false,
        samples: [{}, {}, {}],
      },
    ],
  };
  const currentReport = {
    apply_local: true,
    output_root: tempOutputRoot("global-merge"),
    summary: {},
    display_story_ids: ["1szzhy9"],
    segments: [
      {
        story_id: "1szzhy9",
        clip_key: "https://video.example/marathon.m3u8|marathon|42.00",
        source_url: "https://video.example/marathon.m3u8",
        entity: "Marathon",
        media_start_s: 42,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        segment_motion_class: "gameplay_action",
        validation_reason: "trimmed_segment_samples_passed",
        samples: [{}, {}, {}],
      },
    ],
  };

  const merged = mergeOfficialTrailerSegmentReports(previousReport, currentReport, {
    preserveUnscopedPrevious: true,
  });
  merged.display_story_ids = ["1szzhy9"];
  const markdown = renderOfficialTrailerSegmentValidationMarkdown(merged);

  assert.deepEqual(merged.segments.map((segment) => segment.story_id), [
    "rss_5b3abe925b27a199",
    "1szzhy9",
  ]);
  assert.match(markdown, /Displayed story scope: 1szzhy9/);
  assert.match(markdown, /Marathon/);
  assert.doesNotMatch(markdown, /\| GTA \|/);
});

test("segment validation merge keeps dry-run metadata honest when preserving apply-local ledger", () => {
  const previousReport = {
    mode: "apply_local",
    dry_run: false,
    apply_local: true,
    will_fetch_source_for_segment_samples: true,
    segments: [
      {
        story_id: "rss_5b3abe925b27a199",
        clip_key: "https://video.example/red-dead.m3u8|red-dead|72.00",
        source_url: "https://video.example/red-dead.m3u8",
        entity: "Red Dead",
        media_start_s: 72,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        segment_motion_class: "gameplay_action",
        samples: [{ status: "extracted" }],
      },
    ],
  };
  const currentReport = {
    mode: "dry_run",
    dry_run: true,
    apply_local: false,
    will_fetch_source_for_segment_samples: false,
    segments: [
      {
        story_id: "rss_5b3abe925b27a199",
        clip_key: "https://video.example/red-dead.m3u8|red-dead|84.00",
        source_url: "https://video.example/red-dead.m3u8",
        entity: "Red Dead",
        media_start_s: 84,
        status: "would_validate",
        segment_validated: false,
        allowed_for_flash_lane: false,
        segment_motion_class: "would_sample",
        samples: [{ status: "would_sample" }],
      },
    ],
  };

  const merged = mergeOfficialTrailerSegmentReports(previousReport, currentReport, {
    preserveUnscopedPrevious: true,
  });

  assert.equal(merged.mode, "dry_run");
  assert.equal(merged.dry_run, true);
  assert.equal(merged.apply_local, false);
  assert.equal(merged.will_fetch_source_for_segment_samples, false);
  assert.equal(merged.summary.samples_extracted, 1);
  assert.equal(merged.summary.samples_would_extract, 1);
  assert.equal(merged.merge.previous_apply_local, true);
  assert.equal(merged.merge.current_apply_local, false);
  assert.equal(merged.merge.preserved_previous_apply_local, true);
});

test("segment validation story filter excludes unscoped legacy rows for story-specific reports", () => {
  const scoped = filterSegmentsForStoryIds(
    [
      { story_id: "1szzhy9", entity: "Marathon" },
      { story_id: "rss_5b3abe925b27a199", entity: "GTA" },
      { entity: "legacy-no-story" },
    ],
    ["1szzhy9"],
  );

  assert.deepEqual(scoped.map((segment) => segment.entity), ["Marathon"]);
});

test("segment validation skips exhausted source families from previous local scans", () => {
  const previousSegments = Array.from({ length: 9 }, (_, index) => ({
    ...clip({
      path: "https://video.example/gta-exhausted.m3u8",
      mediaStartS: 36 + index * 6,
      provenance: {
        provider: "steam",
        movie_id: "gta-trailer-1",
        store_app_id: "3240220",
        story_id: "rss_5b3abe925b27a199",
      },
    }),
    story_id: "rss_5b3abe925b27a199",
    clip_key: `old-gta-${index}`,
    source_url: "https://video.example/gta-exhausted.m3u8",
    source_type: "steam_movie",
    provider: "steam",
    movie_id: "gta-trailer-1",
    store_app_id: "3240220",
    status: "rejected",
    segment_validated: false,
    allowed_for_flash_lane: false,
    validation_reason: index % 2 ? "segment_contains_black_frame" : "segment_samples_too_repetitive",
  }));
  const previousReport = { segments: previousSegments };
  const exhausted = exhaustedSourceFamiliesFromReport(previousReport);
  const nextClips = [
    clip({
      path: "https://video.example/gta-exhausted.m3u8",
      mediaStartS: 96,
      provenance: {
        provider: "steam",
        movie_id: "gta-trailer-1",
        store_app_id: "3240220",
        story_id: "rss_5b3abe925b27a199",
      },
    }),
    clip({
      path: "https://video.example/gta-alternate.m3u8",
      mediaStartS: 42,
      provenance: {
        provider: "steam",
        movie_id: "gta-trailer-2",
        store_app_id: "3240220",
        story_id: "rss_5b3abe925b27a199",
      },
    }),
  ];

  const filtered = filterExhaustedSourceFamilyClipRefs(nextClips, previousReport);

  assert.equal(exhausted.length, 1);
  assert.equal(exhausted[0].attempted_segments, 9);
  assert.equal(exhausted[0].validated_segments, 0);
  assert.equal(exhausted[0].top_rejection_reason, "segment_samples_too_repetitive");
  assert.deepEqual(filtered.clipRefs.map((item) => item.path), ["https://video.example/gta-alternate.m3u8"]);
  assert.equal(filtered.skipped.length, 1);
  assert.equal(filtered.skipped[0].attempted_segments, 9);
});

test("segment validation backfills Steam source families from legacy segment URLs", () => {
  const previousReport = {
    segments: Array.from({ length: 8 }, (_, index) => ({
      story_id: "rss_5b3abe925b27a199",
      entity: "GTA",
      source_url: "https://video.akamai.steamstatic.com/store_trailers/3240220/832632/4b8d5f06cf0a1/hls_264_master.m3u8",
      source_type: "steam_movie",
      media_start_s: 36 + index * 6,
      status: "rejected",
      segment_validated: false,
      allowed_for_flash_lane: false,
      validation_reason: "segment_samples_too_repetitive",
    })),
  };

  const [family] = exhaustedSourceFamiliesFromReport(previousReport);

  assert.equal(family.provider, "steam");
  assert.equal(family.store_app_id, "3240220");
  assert.equal(family.movie_id, "832632");
  assert.equal(family.reference_title, "Steam movie 832632");
  assert.equal(family.attempted_segments, 8);
});

test("segment validation does not skip source families with validated gameplay", () => {
  const ref = clip({
    path: "https://video.example/bioshock-good.m3u8",
    provenance: {
      provider: "steam",
      movie_id: "bioshock-trailer-1",
      store_app_id: "8870",
      story_id: "rss_5b3abe925b27a199",
    },
  });
  const previousReport = {
    segments: Array.from({ length: 9 }, (_, index) => ({
      ...ref,
      clip_key: `old-bioshock-${index}`,
      source_url: ref.path,
      story_id: "rss_5b3abe925b27a199",
      provider: "steam",
      movie_id: "bioshock-trailer-1",
      store_app_id: "8870",
      segment_validated: index === 8,
      allowed_for_flash_lane: index === 8,
      status: index === 8 ? "validated" : "rejected",
      validation_reason: index === 8 ? "segment_samples_passed" : "segment_lacks_gameplay_action_samples",
    })),
  };

  const filtered = filterExhaustedSourceFamilyClipRefs([ref], previousReport);

  assert.equal(exhaustedSourceFamiliesFromReport(previousReport).length, 0);
  assert.equal(filtered.clipRefs.length, 1);
  assert.equal(filtered.skipped.length, 0);
});

test("segment validation merge keeps previous validated clips and adds new scans without duplicates", () => {
  const oldValidated = {
    clip_key: "https://video.example/bioshock.m3u8|bioshock|42.00",
    source_url: "https://video.example/bioshock.m3u8",
    entity: "BioShock",
    media_start_s: 42,
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    segment_motion_class: "gameplay_action",
    action_score: 82,
    samples: [{}, {}, {}],
  };
  const oldRejected = {
    clip_key: "https://video.example/gta.m3u8|gta|36.00",
    source_url: "https://video.example/gta.m3u8",
    entity: "GTA",
    media_start_s: 36,
    status: "rejected",
    segment_validated: false,
    allowed_for_flash_lane: false,
    segment_motion_class: "rejected",
    action_score: 0,
    samples: [{}, {}, {}],
  };
  const newValidated = {
    clip_key: "https://video.example/gta.m3u8|gta|72.00",
    source_url: "https://video.example/gta.m3u8",
    entity: "GTA",
    media_start_s: 72,
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    segment_motion_class: "gameplay_action",
    action_score: 79,
    samples: [{}, {}, {}],
  };

  const merged = mergeOfficialTrailerSegmentReports(
    {
      generated_at: "2026-05-07T00:00:00.000Z",
      apply_local: true,
      mode: "apply_local",
      segments: [oldValidated, oldRejected],
    },
    {
      generated_at: "2026-05-07T01:00:00.000Z",
      apply_local: true,
      mode: "apply_local",
      segments: [newValidated, { ...oldRejected, validation_reason: "newer_duplicate_rejection" }],
    },
  );

  assert.deepEqual(
    merged.segments.map((segment) => `${segment.entity}:${segment.media_start_s}:${segment.validation_reason || ""}`),
    [
      "BioShock:42:",
      "GTA:36:newer_duplicate_rejection",
      "GTA:72:",
    ],
  );
  assert.equal(merged.summary.segments, 3);
  assert.equal(merged.summary.segments_validated, 2);
  assert.equal(merged.summary.segments_rejected, 1);
  assert.equal(merged.merge.previous_segment_count, 2);
  assert.equal(merged.merge.current_segment_count, 2);
  assert.equal(merged.merge.duplicate_segment_count, 1);
});

test("segment validation merge downgrades stale localised validated segments", () => {
  const previous = {
    apply_local: true,
    segments: [
      {
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.example/reddead-de.m3u8",
        entity: "Red Dead",
        reference_title: "RDR2 60 FPS Trailer (DE)",
        media_start_s: 36,
        duration_s: 5,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        segment_motion_class: "gameplay_action",
        action_score: 88,
      },
    ],
  };

  const merged = mergeOfficialTrailerSegmentReports(previous, {
    apply_local: true,
    segments: [],
  });

  assert.equal(merged.summary.segments_validated, 0);
  assert.equal(merged.summary.segments_rejected, 1);
  assert.equal(merged.segments[0].allowed_for_flash_lane, false);
  assert.equal(merged.segments[0].validation_reason, "segment_source_is_localised_non_english_reference");
});

test("segment validator CLI can consume Flash Lane acquisition plans without live side effects", () => {
  const tool = fs.readFileSync(
    path.join(process.cwd(), "tools", "official-trailer-segment-validator.js"),
    "utf8",
  );

  assert.match(tool, /buildOfficialTrailerClipsFromAcquisitionPlan/);
  assert.match(tool, /--acquisition-plan/);
  assert.match(tool, /flash_lane_footage_acquisition_v1\.json/);
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
