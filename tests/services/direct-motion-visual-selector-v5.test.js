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

test("V5 direct-motion selector fails closed when no decoded samples exist", () => {
  const report = scoreDirectMotionVisualSamples([]);

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_visual_samples_missing"));
});

test("V5 direct-motion selector samples densely enough to catch sub-second transition slates", () => {
  const times = premiumSampleTimes(5);
  const gaps = times.slice(1).map((time, index) => time - times[index]);

  assert.equal(times.length >= 8, true);
  assert.equal(Math.max(...gaps) <= 0.7, true);
  assert.equal(times[0] <= 0.5, true);
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
    [
      ...sharedWindows,
      {
        path: "C:\\clips\\official_gameplay_capture_window_24_5.mp4",
        source_family: "official_gameplay_capture_window_24_5",
        base_source_family: "official_gameplay_capture",
        source_url: "https://publisher.example/official-gameplay-capture.mp4",
      },
    ],
    { ...options, policyTier: "ultimate_professional" },
  );

  assert.equal(multiSource.source_diversity.strict_pass, true);
  assert.equal(multiSource.professional_source_diversity.status, "pass");
  assert.deepEqual(multiSource.blockers, []);
});
