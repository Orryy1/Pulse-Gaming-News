"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const {
  DIRECT_MOTION_VISUAL_SELECTOR_V5,
  assessDirectMotionSourceDiversity,
  filterPremiumDirectMotionClips,
  premiumSampleTimes,
  scoreDirectMotionVisualSamples,
} = require("../../lib/studio/v5/direct-motion-visual-selector");

test("V5 direct-motion selector rejects source clips with baked caption-heavy frames", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      text_overlay_likelihood: 0.08,
      trailer_frame_taste: { verdict: "pass", tags: ["gameplay_candidate"] },
    },
    {
      text_overlay_likelihood: 0.4,
      trailer_frame_taste: { verdict: "pass", tags: ["detail_rich", "text_heavy"] },
    },
  ]);

  assert.equal(report.version, DIRECT_MOTION_VISUAL_SELECTOR_V5.version);
  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_baked_caption_risk"));
});

test("V5 direct-motion selector preserves clean detailed gameplay", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      text_overlay_likelihood: 0.02,
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
    {
      text_overlay_likelihood: 0.23,
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
  ]);

  assert.equal(report.eligible, true);
  assert.deepEqual(report.reasons, []);
  assert.equal(report.metrics.text_heavy_sample_count, 0);
});

test("V5 direct-motion selector rejects sustained dark low-information source intervals", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      dark_pixel_ratio: 0.66,
      central_dark_pixel_ratio: 0.63,
      bright_pixel_ratio: 0.005,
      edge_density: 0.043,
      saturation_mean: 0.79,
      text_overlay_likelihood: 0,
      trailer_frame_taste: { verdict: "pass", tags: ["colourful"] },
    },
    {
      dark_pixel_ratio: 0.61,
      central_dark_pixel_ratio: 0.58,
      bright_pixel_ratio: 0.007,
      edge_density: 0.049,
      saturation_mean: 0.78,
      text_overlay_likelihood: 0,
      trailer_frame_taste: { verdict: "pass", tags: ["colourful"] },
    },
    {
      dark_pixel_ratio: 0.18,
      central_dark_pixel_ratio: 0.14,
      bright_pixel_ratio: 0.12,
      edge_density: 0.22,
      saturation_mean: 0.55,
      text_overlay_likelihood: 0,
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
  ]);

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_dark_low_information_risk"));
  assert.equal(report.metrics.dark_low_information_sample_count, 2);
});

test("V5 direct-motion selector rejects portrait-cropped embedded text without banning gameplay HUD", () => {
  const croppedTrailerText = scoreDirectMotionVisualSamples([
    {
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0.053,
      letterbox_bar_ratio: 0.096,
      border: {
        dark_edge_ratio: 0.666,
        bright_edge_ratio: 0.003,
        edge_touch_ratio: 0.018,
        text_cutoff_risk_score: 0.147,
      },
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
    {
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0.191,
      letterbox_bar_ratio: 0,
      border: {
        dark_edge_ratio: 0.123,
        bright_edge_ratio: 0.223,
        edge_touch_ratio: 0.053,
        text_cutoff_risk_score: 0.797,
      },
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
  ]);

  assert.equal(croppedTrailerText.eligible, false);
  assert.ok(
    croppedTrailerText.reasons.includes(
      "direct_motion_portrait_crop_embedded_text_truncation_risk",
    ),
  );
  assert.equal(croppedTrailerText.metrics.portrait_crop_text_risk_sample_count, 2);

  const gameplayHud = scoreDirectMotionVisualSamples([
    {
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0.23,
      letterbox_bar_ratio: 0,
      border: {
        dark_edge_ratio: 0.08,
        bright_edge_ratio: 0.03,
        edge_touch_ratio: 0.04,
        text_cutoff_risk_score: 0.2,
      },
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate", "hud_text"],
      },
    },
  ]);

  assert.equal(gameplayHud.eligible, true);
  assert.deepEqual(gameplayHud.reasons, []);
  assert.equal(gameplayHud.metrics.portrait_crop_text_risk_sample_count, 0);
});

test("V5 direct-motion selector rejects oversized cropped edge glyphs missed by text overlay scoring", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0,
      white_text_on_dark_likelihood: 0.526,
      border: {
        edge_touch_ratio: 0.159,
        bright_edge_ratio: 0.075,
        dark_edge_ratio: 0.448,
        text_cutoff_risk_score: 0.625,
      },
      trailer_frame_taste: {
        verdict: "warn",
        reason: "taste_borderline",
        tags: [],
      },
    },
  ]);

  assert.equal(report.eligible, false);
  assert.ok(
    report.reasons.includes(
      "direct_motion_portrait_crop_embedded_text_truncation_risk",
    ),
  );
  assert.equal(report.metrics.portrait_crop_text_risk_sample_count, 1);
});

test("V5 direct-motion selector rejects oversized embedded title bands cropped through portrait footage", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0.17,
      central_bright_pixel_ratio: 0.09,
      edge_density: 0.27,
      letterbox_bar_ratio: 0,
      white_text_on_dark_likelihood: 0,
      border: {
        edge_touch_ratio: 0.04,
        bright_edge_ratio: 0.05,
        dark_edge_ratio: 0.003,
        text_cutoff_risk_score: 0.24,
      },
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
  ]);

  assert.equal(report.eligible, false);
  assert.ok(
    report.reasons.includes(
      "direct_motion_portrait_crop_embedded_text_truncation_risk",
    ),
  );
  assert.equal(report.metrics.portrait_crop_text_risk_sample_count, 1);
});

test("V5 direct-motion selector fails closed when no decoded samples exist", () => {
  const report = scoreDirectMotionVisualSamples([]);

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_visual_samples_missing"));
});

test("V5 direct-motion selector samples the opening boundary and catches sub-second transition slates", () => {
  const times = premiumSampleTimes(5);
  const gaps = times.slice(1).map((time, index) => time - times[index]);

  assert.equal(times.length >= 20, true);
  assert.equal(Math.max(...gaps) <= 0.25, true);
  assert.equal(times[0] <= 0.1, true);
  assert.equal(times.at(-1) >= 4.5, true);
});

test("V5 direct-motion selector requires genuine base-source diversity for a strict pass", () => {
  const sharedTrailer = "rockstar_gta_vi_trailer_2";
  const trailerWindows = [12, 24, 36].map((start) => ({
    id: `${sharedTrailer}_window_${start}_5`,
    source_family: `${sharedTrailer}_window_${start}_5`,
    base_source_family: sharedTrailer,
    source_url: "https://media.rockstargames.com/videos/gta-vi-trailer-2.mp4",
  }));

  const singleSource = assessDirectMotionSourceDiversity(trailerWindows);

  assert.equal(singleSource.strict_pass, false);
  assert.ok(singleSource.reasons.includes("direct_motion_base_source_diversity_insufficient"));
  assert.equal(singleSource.diagnostic_tier, "single_base_source_multi_window");
  assert.equal(singleSource.metrics.distinct_clip_window_family_count, 3);
  assert.equal(singleSource.metrics.distinct_genuine_base_source_count, 1);
  assert.deepEqual(singleSource.genuine_base_sources, [
    "url:https://media.rockstargames.com/videos/gta-vi-trailer-2.mp4",
  ]);

  const mixedProvenance = assessDirectMotionSourceDiversity([
    trailerWindows[0],
    {
      id: trailerWindows[1].id,
      source_family: trailerWindows[1].source_family,
      source_url: trailerWindows[1].source_url,
    },
  ]);

  assert.equal(mixedProvenance.strict_pass, false);
  assert.equal(mixedProvenance.diagnostic_tier, "single_base_source_multi_window");
  assert.equal(mixedProvenance.metrics.distinct_genuine_base_source_count, 1);

  const pathOnlyWindows = assessDirectMotionSourceDiversity([
    "C:\\clips\\gta_vi_trailer_2_window_12_5.mp4",
    "C:\\clips\\gta_vi_trailer_2_window_24_5.mp4",
  ]);

  assert.equal(pathOnlyWindows.strict_pass, false);
  assert.equal(pathOnlyWindows.diagnostic_tier, "unresolved_base_source_multi_window");
  assert.equal(pathOnlyWindows.metrics.distinct_clip_window_family_count, 2);
  assert.equal(pathOnlyWindows.metrics.distinct_genuine_base_source_count, 0);

  const multiSource = assessDirectMotionSourceDiversity([
    ...trailerWindows,
    {
      id: "rockstar_gta_vi_gameplay_showcase_window_18_5",
      source_family: "rockstar_gta_vi_gameplay_showcase_window_18_5",
      base_source_family: "rockstar_gta_vi_gameplay_showcase",
      source_url: "https://media.rockstargames.com/videos/gta-vi-gameplay-showcase.mp4",
    },
  ]);

  assert.equal(multiSource.strict_pass, true);
  assert.deepEqual(multiSource.reasons, []);
  assert.equal(multiSource.diagnostic_tier, "elite_multi_source");
  assert.equal(multiSource.metrics.distinct_genuine_base_source_count, 2);
});

test("V5 premium direct-motion filter reports professional diversity without changing normal readiness", async () => {
  const sharedBase = "official_trailer_main";
  const sharedWindows = [8, 16].map((start) => ({
    path: `C:\\clips\\official_trailer_main_window_${start}_5.mp4`,
    source_family: `${sharedBase}_window_${start}_5`,
    base_source_family: sharedBase,
    source_url: "https://publisher.example/official-trailer-main.mp4",
  }));
  const inspectClip = async (clip) => ({
    path: clip.path,
    eligible: true,
    reasons: [],
    metrics: { decoded_sample_count: 8 },
  });
  const options = {
    outputDir: path.join(os.tmpdir(), "pulse-direct-motion-selector-v5-test"),
    inspectClip,
  };

  const normalSingleSource = await filterPremiumDirectMotionClips(sharedWindows, options);

  assert.equal(normalSingleSource.accepted.length, 2);
  assert.equal(normalSingleSource.source_diversity.strict_pass, false);
  assert.equal(normalSingleSource.policy_tier, "normal_strict_green");
  assert.deepEqual(normalSingleSource.blockers, []);

  const professionalSingleSource = await filterPremiumDirectMotionClips(sharedWindows, {
    ...options,
    policyTier: "ultimate_professional",
  });

  assert.equal(professionalSingleSource.policy_tier, "ultimate_professional");
  assert.ok(
    professionalSingleSource.blockers.includes(
      "professional_genuine_base_source_minimum_not_met",
    ),
  );

  const multiSource = await filterPremiumDirectMotionClips(
    ["trailer", "gameplay", "systems", "launch"].map((source, index) => ({
      path: `C:\\clips\\official_${source}_window_${(index + 1) * 8}_5.mp4`,
      source_family: `official_${source}_window_${(index + 1) * 8}_5`,
      base_source_family: `official_${source}`,
      source_url: `https://publisher.example/official-${source}.mp4`,
    })),
    { ...options, policyTier: "ultimate_professional" },
  );

  assert.equal(multiSource.source_diversity.strict_pass, true);
  assert.equal(multiSource.professional_source_diversity.status, "pass");
  assert.equal(
    multiSource.professional_source_diversity.observed_genuine_base_source_count,
    4,
  );
  assert.deepEqual(multiSource.blockers, []);
});

test("V5 ultimate selector fails when decoded-frame rejections concentrate the surviving source pool", async () => {
  const sourceHash = (character) => character.repeat(64);
  const clips = [
    ...[1, 2, 3].map((index) => ({
      id: `arcane_${index}`,
      path: `C:\\clips\\arcane-window-${index}.mp4`,
      source_master_sha256: sourceHash("a"),
      youtube_video_id: "Y4vHLIBS600",
      source_family: `arcane_window_${index}`,
      visually_eligible: true,
    })),
    ...[1, 2].map((index) => ({
      id: `homecoming_${index}`,
      path: `C:\\clips\\homecoming-window-${index}.mp4`,
      source_master_sha256: sourceHash("b"),
      youtube_video_id: "xxURfVAVSfE",
      source_family: `homecoming_window_${index}`,
      visually_eligible: true,
    })),
    ...["c", "d", "e"].map((character, index) => ({
      id: `other_${index + 1}`,
      path: `C:\\clips\\other-window-${index + 1}.mp4`,
      source_master_sha256: sourceHash(character),
      source_family: `other_window_${index + 1}`,
      visually_eligible: true,
    })),
    ...["f", "1"].map((character, index) => ({
      id: `rejected_${index + 1}`,
      path: `C:\\clips\\rejected-window-${index + 1}.mp4`,
      source_master_sha256: sourceHash(character),
      source_family: `rejected_window_${index + 1}`,
      visually_eligible: false,
    })),
  ];
  const report = await filterPremiumDirectMotionClips(clips, {
    outputDir: path.join(os.tmpdir(), "pulse-direct-motion-selector-v5-concentration-test"),
    policyTier: "ultimate_professional",
    inspectClip: async (clip) => ({
      path: clip.path,
      eligible: clip.visually_eligible === true,
      reasons: clip.visually_eligible === true ? [] : ["direct_motion_frame_taste_failed"],
      metrics: { decoded_sample_count: 20 },
    }),
  });

  assert.equal(report.accepted.length, 8);
  assert.equal(report.professional_source_diversity.status, "blocked");
  assert.ok(
    report.blockers.includes("professional_motion_source_concentration_above_floor"),
  );
  assert.deepEqual(
    report.professional_source_diversity.concentrated_sources.map((source) => ({
      count: source.scene_count,
      share: source.scene_share,
    })),
    [{ count: 3, share: 0.375 }],
  );
});
