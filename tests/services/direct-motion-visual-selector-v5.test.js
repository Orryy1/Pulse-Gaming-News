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
  resolveDirectMotionFrameDir,
  scoreDirectMotionVisualSamples,
} = require("../../lib/studio/v5/direct-motion-visual-selector");

test("V5 direct-motion selector uses a compact persistent frame directory for Windows-long output paths", () => {
  const outputDir = path.join(
    "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\output",
    "fresh-green-refill",
    "black-flag-three-million-20260719-v32-render-workspace",
    "motion-materialization-v32",
    "premium-motion-visual-selection",
    "official_black_flag_three_million_20260717",
    "repaired-frame-samples",
  );
  const filePath = path.join(
    outputDir,
    "footer-crop-repairs",
    "black_flag_v32_worldwide_showcase_window_5_5.footer-crop.mp4",
  );

  const resolved = resolveDirectMotionFrameDir(filePath, outputDir, {
    cwd: "C:\\Users\\MORR\\gaming-studio\\pulse-gaming",
    platform: "win32",
  });

  assert.equal(resolved.compacted, true);
  assert.ok(
    resolved.frame_dir.startsWith(
      path.join(
        "C:\\Users\\MORR\\gaming-studio\\pulse-gaming",
        "output",
        "qa",
        "direct-motion-v5-frames",
      ),
    ),
  );
  assert.ok(path.join(resolved.frame_dir, "frame_20.jpg").length < 240);
  assert.equal(resolved.requested_frame_dir.length >= 240, true);
});

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

test("V5 direct-motion selector bypasses only fully evidenced owned support cards", async () => {
  const hash = (value) => value.repeat(64);
  const directClip = {
    id: "official-window-1",
    path: "C:\\clips\\official-window-1.mp4",
    source_url: "https://publisher.example/official-window-1.mp4",
    source_master_sha256: hash("a"),
  };
  const governedCard = {
    id: "owned-source-card",
    path: "C:\\clips\\owned-source-card.mp4",
    media_kind: "owned_explainer_motion",
    source_type: "internally_generated_motion_graphic",
    generator_design_role: "support_card",
    hyperframes_card: true,
    readable_card_kind: "source",
    card_kind: "source",
    generator_project_id: "pulse.motion.editorial-support.v1",
    generator_master_sha256: hash("b"),
    materialised_output_sha256: hash("c"),
    evidence_file_sha256: hash("d"),
    rights_evidence_file_sha256: hash("e"),
    materialized: true,
    counts_towards_motion_readiness: true,
    source_safety_blocked: false,
    owned_rights_evaluation: {
      status: "pass",
      verified: true,
      blockers: [],
    },
    owned_generated_rights_grant: {
      grant_type: "owned_generated",
      allowed_use: "commercial_editorial_and_platform_native_derivatives",
      commercial_use_allowed: true,
      derivative_use_allowed: true,
    },
  };
  const inspected = [];

  const report = await filterPremiumDirectMotionClips([directClip, governedCard], {
    inspectClip: async (clip) => {
      inspected.push(clip.id);
      return {
        path: clip.path,
        eligible: true,
        reasons: [],
        metrics: { decoded_sample_count: 20 },
      };
    },
  });

  assert.deepEqual(inspected, [directClip.id]);
  assert.deepEqual(report.clips.map((clip) => clip.id), [directClip.id, governedCard.id]);
  assert.deepEqual(report.blockers, []);
});

test("V5 direct-motion selector inspects a forged owned support-card claim", async () => {
  const forgedCard = {
    id: "forged-owned-card",
    path: "C:\\clips\\forged-owned-card.mp4",
    media_kind: "owned_explainer_motion",
    source_type: "internally_generated_motion_graphic",
    generator_design_role: "support_card",
    readable_card_kind: "source",
    card_kind: "source",
  };
  let inspectionCount = 0;

  const report = await filterPremiumDirectMotionClips([forgedCard], {
    inspectClip: async () => {
      inspectionCount += 1;
      return {
        path: forgedCard.path,
        eligible: false,
        reasons: ["direct_motion_frame_taste_failed"],
        metrics: { decoded_sample_count: 20 },
      };
    },
  });

  assert.equal(inspectionCount, 1);
  assert.deepEqual(report.clips, []);
  assert.equal(report.rejected[0].clip_id, forgedCard.id);
  assert.ok(report.blockers.includes("premium_direct_motion_missing"));
});

test("V5 direct-motion selector fails closed when a decoded sample could not be analysed", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      edge_density: 0.24,
      text_overlay_likelihood: 0,
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "gameplay_candidate"],
      },
    },
    {
      width: null,
      height: null,
      edge_density: null,
      text_overlay_likelihood: null,
      trailer_frame_taste: null,
      error: "sharp_decode:Input file is missing",
      border_error: "border_scan:Input file is missing",
    },
  ]);

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_visual_analysis_failed"));
  assert.equal(report.metrics.analysis_error_sample_count, 1);
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

test("V5 direct-motion selector rejects sustained colourful but empty portrait crops", () => {
  const emptySeaFrames = Array.from({ length: 7 }, () => ({
    width: 540,
    height: 960,
    aspect_ratio: 0.5625,
    dark_pixel_ratio: 0.12,
    central_dark_pixel_ratio: 0.1,
    bright_pixel_ratio: 0.08,
    edge_density: 0.04,
    saturation_mean: 0.72,
    text_overlay_likelihood: 0,
    trailer_frame_taste: { verdict: "pass", tags: ["colourful"] },
  }));
  const detailedGameplay = {
    width: 540,
    height: 960,
    aspect_ratio: 0.5625,
    dark_pixel_ratio: 0.16,
    central_dark_pixel_ratio: 0.12,
    bright_pixel_ratio: 0.14,
    edge_density: 0.24,
    saturation_mean: 0.58,
    text_overlay_likelihood: 0,
    trailer_frame_taste: {
      verdict: "pass",
      tags: ["detail_rich", "colourful", "gameplay_candidate"],
    },
  };

  const report = scoreDirectMotionVisualSamples([
    ...emptySeaFrames,
    detailedGameplay,
  ]);

  assert.equal(report.eligible, false);
  assert.ok(
    report.reasons.includes("direct_motion_portrait_low_information_risk"),
  );
  assert.equal(report.metrics.portrait_low_information_sample_count, 7);
  assert.equal(report.metrics.longest_portrait_low_information_run, 7);
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

test("V5 direct-motion selector rejects persistent letterbox bars without requiring embedded text", () => {
  const report = scoreDirectMotionVisualSamples(
    Array.from({ length: 6 }, () => ({
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0,
      letterbox_bar_ratio: 0.096,
      dark_pixel_ratio: 0.1,
      central_dark_pixel_ratio: 0.08,
      bright_pixel_ratio: 0.12,
      edge_density: 0.22,
      border: {
        dark_edge_ratio: 0.66,
        bright_edge_ratio: 0.01,
        edge_touch_ratio: 0.01,
        text_cutoff_risk_score: 0.12,
      },
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    })),
  );

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_persistent_letterbox_risk"));
  assert.equal(report.metrics.letterbox_sample_count, 6);
  assert.equal(report.metrics.longest_letterbox_run, 6);
});

test("V5 direct-motion selector rejects a persistent thin lower-band footer", () => {
  const report = scoreDirectMotionVisualSamples(
    Array.from({ length: 5 }, () => ({
      width: 540,
      height: 960,
      aspect_ratio: 0.5625,
      text_overlay_likelihood: 0,
      lower_band_overlay_likelihood: 0.034,
      lower_band_overlay_span_rows: 3,
      lower_band_overlay_analysed_rows: 88,
      lower_band_overlay_max_row_ratio: 0.22,
      letterbox_bar_ratio: 0,
      dark_pixel_ratio: 0.12,
      central_dark_pixel_ratio: 0.1,
      bright_pixel_ratio: 0.12,
      edge_density: 0.24,
      border: {
        dark_edge_ratio: 0.18,
        bright_edge_ratio: 0.01,
        edge_touch_ratio: 0.04,
        text_cutoff_risk_score: 0.14,
      },
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    })),
  );

  assert.equal(report.eligible, false);
  assert.ok(
    report.reasons.includes("direct_motion_persistent_lower_band_overlay_risk"),
  );
  assert.equal(report.metrics.lower_band_overlay_sample_count, 5);
  assert.equal(report.metrics.longest_lower_band_overlay_run, 5);
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

test("V5 direct-motion filter preserves exact clip and source identity in repair evidence", async () => {
  const clip = {
    id: "official-gameplay-window-42",
    path: "C:\\clips\\official-gameplay-window-42.mp4",
    source_url: "https://www.youtube.com/watch?v=example42",
    source_family: "official_gameplay_window_42",
    base_source_family: "youtube:example42",
    asset_sha256: "a".repeat(64),
    source_master_sha256: "b".repeat(64),
  };

  const report = await filterPremiumDirectMotionClips([clip], {
    outputDir: path.join(os.tmpdir(), "pulse-direct-motion-selector-v5-evidence-test"),
    inspectClip: async () => ({
      path: clip.path,
      eligible: false,
      reasons: ["direct_motion_dark_low_information_risk"],
      metrics: { decoded_sample_count: 20 },
    }),
  });

  assert.deepEqual(
    {
      clip_id: report.rejected[0].clip_id,
      source_url: report.rejected[0].source_url,
      source_family: report.rejected[0].source_family,
      base_source_family: report.rejected[0].base_source_family,
      asset_sha256: report.rejected[0].asset_sha256,
      source_master_sha256: report.rejected[0].source_master_sha256,
    },
    {
      clip_id: clip.id,
      source_url: clip.source_url,
      source_family: clip.source_family,
      base_source_family: clip.base_source_family,
      asset_sha256: clip.asset_sha256,
      source_master_sha256: clip.source_master_sha256,
    },
  );
});

test("V5 direct-motion filter repairs footer-only overlays and rechecks the derivative", async () => {
  const clip = {
    id: "official-gameplay-window-footer",
    path: "C:\\clips\\official-gameplay-window-footer.mp4",
    source_url: "https://www.youtube.com/watch?v=footer42",
    source_family: "official_gameplay_window_footer",
    base_source_family: "youtube:footer42",
    source_master_sha256: "a".repeat(64),
  };
  const repairedClip = {
    ...clip,
    path: "C:\\repairs\\official-gameplay-window-footer.footer-crop.mp4",
    local_materialized_path:
      "C:\\repairs\\official-gameplay-window-footer.footer-crop.mp4",
    asset_sha256: "b".repeat(64),
    visual_repair: {
      kind: "crop_legal_footer_bottom_10_percent",
      source_path: clip.path,
    },
  };
  const inspectedPaths = [];
  const report = await filterPremiumDirectMotionClips([clip], {
    outputDir: path.join(os.tmpdir(), "pulse-direct-motion-selector-v5-footer-repair-test"),
    inspectClip: async (candidate) => {
      inspectedPaths.push(candidate.path);
      if (candidate.path === clip.path) {
        return {
          path: candidate.path,
          eligible: false,
          reasons: ["direct_motion_frame_taste_failed"],
          samples: [
            {
              trailer_frame_taste: {
                verdict: "fail",
                reason: "lower_band_text_overlay",
                tags: ["detail_rich", "lower_band_text_overlay"],
              },
            },
          ],
          metrics: {
            decoded_sample_count: 20,
            failed_taste_sample_count: 1,
          },
        };
      }
      return {
        path: candidate.path,
        eligible: true,
        reasons: [],
        samples: [
          {
            trailer_frame_taste: {
              verdict: "pass",
              reason: "taste_passed",
              tags: ["detail_rich", "gameplay_candidate"],
            },
          },
        ],
        metrics: {
          decoded_sample_count: 20,
          failed_taste_sample_count: 0,
        },
      };
    },
    repairClip: async (candidate, repairContext) => {
      assert.equal(candidate.path, clip.path);
      assert.equal(repairContext.repair_kind, "crop_legal_footer_bottom_10_percent");
      return repairedClip;
    },
  });

  assert.deepEqual(inspectedPaths, [clip.path, repairedClip.path]);
  assert.equal(report.accepted.length, 1);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.clips[0].path, repairedClip.path);
  assert.equal(report.accepted[0].path, repairedClip.path);
  assert.equal(report.accepted[0].visual_repair.status, "pass");
  assert.equal(
    report.accepted[0].visual_repair.kind,
    "crop_legal_footer_bottom_10_percent",
  );
  assert.equal(report.repairs.length, 1);
  assert.equal(report.repairs[0].status, "pass");
});

test("V5 direct-motion filter repairs a temporally persistent thin footer", async () => {
  const clip = {
    id: "official-gameplay-window-thin-footer",
    path: "C:\\clips\\official-gameplay-window-thin-footer.mp4",
    source_url: "https://www.youtube.com/watch?v=thin-footer-42",
    source_family: "official_gameplay_window_thin_footer",
    base_source_family: "youtube:thin-footer-42",
    source_master_sha256: "a".repeat(64),
  };
  const repairedClip = {
    ...clip,
    path: "C:\\repairs\\official-gameplay-window-thin-footer.footer-crop.mp4",
    local_materialized_path:
      "C:\\repairs\\official-gameplay-window-thin-footer.footer-crop.mp4",
    asset_sha256: "b".repeat(64),
    visual_repair: {
      kind: "crop_legal_footer_bottom_10_percent",
      source_path: clip.path,
    },
  };
  const report = await filterPremiumDirectMotionClips([clip], {
    inspectClip: async (candidate) =>
      candidate.path === clip.path
        ? {
            path: candidate.path,
            eligible: false,
            reasons: [
              "direct_motion_frame_taste_failed",
              "direct_motion_persistent_lower_band_overlay_risk",
            ],
            samples: Array.from({ length: 5 }, () => ({
              lower_band_overlay_likelihood: 0.034,
              trailer_frame_taste: {
                verdict: "fail",
                reason: "lower_band_text_overlay",
                tags: [
                  "detail_rich",
                  "gameplay_candidate",
                  "lower_band_text_overlay",
                ],
              },
            })),
            metrics: {
              decoded_sample_count: 5,
              lower_band_overlay_sample_count: 5,
              longest_lower_band_overlay_run: 5,
            },
          }
        : {
            path: candidate.path,
            eligible: true,
            reasons: [],
            samples: [],
            metrics: {
              decoded_sample_count: 5,
              lower_band_overlay_sample_count: 0,
              longest_lower_band_overlay_run: 0,
            },
          },
    repairClip: async () => repairedClip,
  });

  assert.equal(report.accepted.length, 1);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.clips[0].path, repairedClip.path);
  assert.equal(report.repairs[0].status, "pass");
  assert.equal(
    report.repairs[0].kind,
    "crop_legal_footer_bottom_10_percent",
  );
});

test("V5 direct-motion filter retries a transient repaired-frame analysis failure", async () => {
  const clip = {
    id: "official-gameplay-window-footer-analysis-retry",
    path: "C:\\clips\\official-gameplay-window-footer-analysis-retry.mp4",
    source_url: "https://www.youtube.com/watch?v=footer-analysis-retry",
    source_family: "official_gameplay_window_footer_analysis_retry",
    base_source_family: "youtube:footer-analysis-retry",
    source_master_sha256: "a".repeat(64),
  };
  const repairedClip = {
    ...clip,
    path: "C:\\repairs\\official-gameplay-window-footer-analysis-retry.footer-crop.mp4",
    local_materialized_path:
      "C:\\repairs\\official-gameplay-window-footer-analysis-retry.footer-crop.mp4",
    asset_sha256: "b".repeat(64),
    visual_repair: {
      kind: "crop_legal_footer_bottom_10_percent",
      source_path: clip.path,
    },
  };
  const inspectedPaths = [];
  let repairedInspectionCount = 0;
  const report = await filterPremiumDirectMotionClips([clip], {
    outputDir: path.join(
      os.tmpdir(),
      "pulse-direct-motion-selector-v5-footer-analysis-retry-test",
    ),
    inspectClip: async (candidate) => {
      inspectedPaths.push(candidate.path);
      if (candidate.path === clip.path) {
        return {
          path: candidate.path,
          eligible: false,
          reasons: ["direct_motion_frame_taste_failed"],
          samples: [{
            trailer_frame_taste: {
              verdict: "fail",
              reason: "lower_band_text_overlay",
              tags: ["detail_rich", "lower_band_text_overlay"],
            },
          }],
          metrics: { decoded_sample_count: 20, failed_taste_sample_count: 20 },
        };
      }
      repairedInspectionCount += 1;
      if (repairedInspectionCount === 1) {
        return {
          path: candidate.path,
          eligible: false,
          reasons: ["direct_motion_visual_analysis_failed"],
          samples: [{ error: "transient_frame_scan_failure" }],
          metrics: { decoded_sample_count: 20, analysis_error_sample_count: 1 },
        };
      }
      return {
        path: candidate.path,
        eligible: true,
        reasons: [],
        samples: [{
          trailer_frame_taste: {
            verdict: "pass",
            reason: "taste_passed",
            tags: ["detail_rich", "gameplay_candidate"],
          },
        }],
        metrics: { decoded_sample_count: 20, analysis_error_sample_count: 0 },
      };
    },
    repairClip: async () => repairedClip,
  });

  assert.deepEqual(inspectedPaths, [
    clip.path,
    repairedClip.path,
    repairedClip.path,
  ]);
  assert.equal(report.accepted.length, 1);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.clips[0].path, repairedClip.path);
  assert.equal(report.accepted[0].visual_repair.inspection_attempts, 2);
  assert.equal(report.repairs[0].inspection_attempts, 2);
});

test("V5 direct-motion filter reports a failed derivative inspection even when materialisation succeeded", async () => {
  const clip = {
    id: "official-gameplay-window-footer-still-bad",
    path: "C:\\clips\\official-gameplay-window-footer-still-bad.mp4",
    source_url: "https://www.youtube.com/watch?v=footer-bad",
    source_family: "official_gameplay_window_footer_still_bad",
    base_source_family: "youtube:footer-bad",
    source_master_sha256: "a".repeat(64),
  };
  const repairedClip = {
    ...clip,
    path: "C:\\repairs\\official-gameplay-window-footer-still-bad.footer-crop.mp4",
    local_materialized_path:
      "C:\\repairs\\official-gameplay-window-footer-still-bad.footer-crop.mp4",
    asset_sha256: "b".repeat(64),
    visual_repair: {
      status: "pass",
      kind: "crop_legal_footer_bottom_10_percent",
      source_path: clip.path,
    },
  };
  const report = await filterPremiumDirectMotionClips([clip], {
    outputDir: path.join(
      os.tmpdir(),
      "pulse-direct-motion-selector-v5-footer-repair-failed-test",
    ),
    inspectClip: async (candidate) => ({
      path: candidate.path,
      eligible: false,
      reasons: ["direct_motion_frame_taste_failed"],
      samples: [
        {
          trailer_frame_taste: {
            verdict: "fail",
            reason: "lower_band_text_overlay",
            tags: ["detail_rich", "lower_band_text_overlay"],
          },
        },
      ],
      metrics: {
        decoded_sample_count: 20,
        failed_taste_sample_count: 1,
      },
    }),
    repairClip: async () => repairedClip,
  });

  assert.equal(report.accepted.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.equal(report.repairs.length, 1);
  assert.equal(report.repairs[0].status, "failed");
  assert.equal(report.rejected[0].visual_repair.status, "failed");
  assert.deepEqual(report.repairs[0].post_repair_reasons, [
    "direct_motion_frame_taste_failed",
  ]);
});

test("V5 direct-motion filter never auto-crops unrelated visual failures", async () => {
  const clip = {
    id: "official-gameplay-dark-window",
    path: "C:\\clips\\official-gameplay-dark-window.mp4",
    source_url: "https://www.youtube.com/watch?v=dark42",
    source_master_sha256: "c".repeat(64),
  };
  let repairCalls = 0;
  const report = await filterPremiumDirectMotionClips([clip], {
    outputDir: path.join(os.tmpdir(), "pulse-direct-motion-selector-v5-no-repair-test"),
    inspectClip: async () => ({
      path: clip.path,
      eligible: false,
      reasons: [
        "direct_motion_frame_taste_failed",
        "direct_motion_dark_low_information_risk",
      ],
      samples: [
        {
          trailer_frame_taste: {
            verdict: "fail",
            reason: "dark_low_information_frame",
            tags: ["dark_low_information"],
          },
        },
      ],
      metrics: {
        decoded_sample_count: 20,
        failed_taste_sample_count: 1,
      },
    }),
    repairClip: async () => {
      repairCalls += 1;
      return clip;
    },
  });

  assert.equal(repairCalls, 0);
  assert.equal(report.accepted.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.equal(report.repairs.length, 0);
  assert.deepEqual(report.rejected[0].reasons, [
    "direct_motion_frame_taste_failed",
    "direct_motion_dark_low_information_risk",
  ]);
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

test("V5 ultimate selector blocks three scenes from one source even at exactly 25 percent share", async () => {
  const sourceHash = (character) => character.repeat(64);
  const clips = ["a", "b", "c", "d"].flatMap((character, sourceIndex) =>
    [1, 2, 3].map((sceneIndex) => ({
      id: `source_${sourceIndex + 1}_scene_${sceneIndex}`,
      path: `C:\\clips\\source-${sourceIndex + 1}-scene-${sceneIndex}.mp4`,
      source_master_sha256: sourceHash(character),
      source_family: `source_${sourceIndex + 1}_scene_${sceneIndex}`,
    })),
  );

  const report = await filterPremiumDirectMotionClips(clips, {
    outputDir: path.join(os.tmpdir(), "pulse-direct-motion-selector-v5-exact-share-test"),
    policyTier: "ultimate_professional",
    inspectClip: async (clip) => ({
      path: clip.path,
      eligible: true,
      reasons: [],
      metrics: { decoded_sample_count: 20 },
    }),
  });

  assert.equal(report.accepted.length, 12);
  assert.equal(report.professional_source_diversity.status, "blocked");
  assert.ok(
    report.blockers.includes("professional_motion_source_concentration_above_floor"),
  );
  assert.deepEqual(
    report.professional_source_diversity.concentrated_sources.map((source) => ({
      count: source.scene_count,
      share: source.scene_share,
    })),
    [
      { count: 3, share: 0.25 },
      { count: 3, share: 0.25 },
      { count: 3, share: 0.25 },
      { count: 3, share: 0.25 },
    ],
  );
});
