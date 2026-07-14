"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const REQUIRED_PLATFORM_VISUALS = Object.freeze([
  "youtube_thumbnail",
  "youtube_shorts_cover",
  "instagram_reels_cover",
  "instagram_story",
  "facebook_reels_cover",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pass(value) {
  return String(value || "").trim().toLowerCase() === "pass";
}

function green(value) {
  return ["green", "pass"].includes(String(value || "").trim().toLowerCase());
}

function buildVisualCreativeUpgradeReport({
  renderProof = {},
  campaignProof = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const render = asObject(renderProof);
  const campaign = asObject(campaignProof);
  const decoded = asObject(render.decoded_visual_gate);
  const repetition = asObject(decoded.visual_repetition);
  const taste = asObject(decoded.rendered_frame_taste);
  const scenePlan = asObject(render.clip_scene_plan);
  const rhythm = asObject(scenePlan.premium_edit_rhythm);
  const rhythmMetrics = asObject(rhythm.metrics);
  const directSelection = asObject(scenePlan.direct_motion_visual_selection);
  const shell = asObject(render.hyperframes_premium_shell_gate);
  const shellChecks = Object.values(asObject(shell.checks));
  const outputs = asObject(campaign.outputs);
  const hero = asObject(campaign.hero_evidence);
  const blockers = [];
  const block = (condition, reason) => {
    if (condition) blockers.push(reason);
  };

  block(!render.story_id || render.story_id !== campaign.story_id, "story_identity_mismatch");
  block(render.creative_system_version !== "pulse_visual_identity_v5", "visual_identity_v5_missing");
  block(render.kinetic_typography_version !== "pulse_kinetic_typography_v5", "kinetic_typography_v5_missing");
  block(!pass(decoded.status) || decoded.decoded_media_evidence !== true, "decoded_visual_gate_not_passed");
  block(asArray(repetition.blackFrames).length > 0, "decoded_black_frames_present");
  block(!pass(repetition.verdict), "decoded_repetition_gate_not_passed");
  block(!pass(taste.verdict) || Number(taste.badFrameCount || 0) > 0, "rendered_frame_taste_not_passed");
  block(scenePlan.repeat_free !== true, "scene_plan_not_repeat_free");
  block(asArray(scenePlan.repeated_base_sources).length > 0, "repeated_base_sources_present");
  block(!pass(rhythm.status), "premium_edit_rhythm_not_passed");
  block(Number(rhythmMetrics.generated_card_scene_count || 0) > 3, "generated_card_count_above_v5_ceiling");
  block(Number(rhythmMetrics.generated_card_duration_ratio || 0) > 0.25, "generated_card_time_above_v5_ceiling");
  block(!pass(shell.verdict), "hyperframes_shell_gate_not_passed");
  block(shell.evidenceSource !== "selected_card_sidecars", "current_hyperframes_sidecar_evidence_missing");
  block(
    shellChecks.length === 0 ||
      shellChecks.some((entry) => {
        const evidence = asObject(entry?.evidence);
        return (
          !pass(entry?.verdict) ||
          !pass(evidence.checks?.check?.status) ||
          evidence.creativeIdentityContract?.evidence?.version !== "pulse_visual_identity_v5"
        );
      }),
    "selected_hyperframes_sidecar_not_v5_pass",
  );
  block(!green(campaign.verdict), "premium_visual_campaign_not_green");
  block(
    hero.rights_basis !== "official_direct_media" ||
      hero.mode !== "scored_official_direct_motion_frame_selection",
    "official_scored_hero_frame_missing",
  );
  const missingOutputs = REQUIRED_PLATFORM_VISUALS.filter((key) => {
    const output = asObject(outputs[key]);
    return !output.static_path || output.creative_identity?.version !== "pulse_visual_identity_v5";
  });
  block(missingOutputs.length > 0, `platform_visual_outputs_missing:${missingOutputs.join(",")}`);
  block(render.no_publish_side_effects !== true, "render_proof_publish_safety_missing");
  block(render.no_db_mutation !== true, "render_proof_db_safety_missing");
  block(campaign.safety?.no_publish_triggered !== true, "campaign_publish_safety_missing");
  block(campaign.safety?.no_db_mutation !== true, "campaign_db_safety_missing");

  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: render.story_id || campaign.story_id || null,
    verdict: uniqueBlockers.length ? "FAIL" : "PASS",
    blockers: uniqueBlockers,
    gates: {
      decoded_visual: pass(decoded.status) ? "PASS" : "FAIL",
      rendered_frame_taste: pass(taste.verdict) ? "PASS" : "FAIL",
      premium_edit_rhythm: pass(rhythm.status) ? "PASS" : "FAIL",
      current_hyperframes_sidecars:
        shell.evidenceSource === "selected_card_sidecars" && pass(shell.verdict) ? "PASS" : "FAIL",
      official_hero_frame:
        hero.rights_basis === "official_direct_media" &&
        hero.mode === "scored_official_direct_motion_frame_selection"
          ? "PASS"
          : "FAIL",
      platform_visual_campaign: green(campaign.verdict) && missingOutputs.length === 0 ? "PASS" : "FAIL",
    },
    metrics: {
      decoded_frame_count: Number(decoded.frame_count || 0),
      direct_motion_scene_count: Number(rhythmMetrics.direct_motion_scene_count || 0),
      generated_card_scene_count: Number(rhythmMetrics.generated_card_scene_count || 0),
      generated_card_duration_ratio: Number(rhythmMetrics.generated_card_duration_ratio || 0),
      direct_motion_clip_accept_count: Number(directSelection.accepted_count || 0),
      direct_motion_clip_reject_count: Number(directSelection.rejected_count || 0),
      decoded_repeat_pair_count: Number(repetition.repeatPairCount || 0),
      decoded_black_frame_count: asArray(repetition.blackFrames).length,
      rendered_bad_frame_count: Number(taste.badFrameCount || 0),
      selected_hyperframes_card_count: Number(shell.selectedCardCount || 0),
      platform_visual_output_count: REQUIRED_PLATFORM_VISUALS.length - missingOutputs.length,
      hero_candidate_count: Number(hero.candidate_count || 0),
      hero_winning_score: Number(hero.winning_score || 0),
    },
    identity: {
      visual: render.creative_system_version || null,
      kinetic_typography: render.kinetic_typography_version || null,
      premium_edit_rhythm: rhythm.version || null,
    },
    evidence: {
      final_mp4: render.output || null,
      decoded_visual_report: decoded.report_path || null,
      platform_visual_outputs: Object.fromEntries(
        REQUIRED_PLATFORM_VISUALS.map((key) => [key, outputs[key]?.static_path || null]),
      ),
      current_hyperframes_generated_at: shell.generatedAt || null,
      hero_source_path: hero.source_path || null,
    },
    safety: {
      local_proof_only: true,
      no_publish_triggered:
        render.no_publish_side_effects === true && campaign.safety?.no_publish_triggered === true,
      no_db_mutation:
        render.no_db_mutation === true && campaign.safety?.no_db_mutation === true,
      no_oauth_or_token_change: campaign.safety?.no_oauth_or_token_change === true,
    },
  };
}

function renderVisualCreativeUpgradeMarkdown(report = {}) {
  const metrics = asObject(report.metrics);
  const lines = [
    "# Pulse Gaming Visual Creative Upgrade V5",
    "",
    `Generated: ${report.generated_at || ""}`,
    `Story: ${report.story_id || ""}`,
    `Verdict: ${report.verdict || "FAIL"}`,
    "",
    "## Proof",
    `- Direct-motion scenes: ${metrics.direct_motion_scene_count || 0}`,
    `- Full-screen cards: ${metrics.generated_card_scene_count || 0}`,
    `- Card-time ratio: ${metrics.generated_card_duration_ratio || 0}`,
    `- Decoded frames inspected: ${metrics.decoded_frame_count || 0}`,
    `- Black frames: ${metrics.decoded_black_frame_count || 0}`,
    `- Bad frames: ${metrics.rendered_bad_frame_count || 0}`,
    `- Platform visual outputs: ${metrics.platform_visual_output_count || 0}`,
    "",
    "## Gates",
    ...Object.entries(asObject(report.gates)).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Blockers",
    ...(asArray(report.blockers).length ? asArray(report.blockers).map((item) => `- ${item}`) : ["- none"]),
    "",
    "Safety: local proof only. No publish, database, token or OAuth mutation was triggered.",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeVisualCreativeUpgradeReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeVisualCreativeUpgradeReport requires outputDir");
  const resolvedOutputDir = path.resolve(outputDir);
  await fs.ensureDir(resolvedOutputDir);
  const jsonPath = path.join(resolvedOutputDir, "visual_creative_upgrade_report.json");
  const markdownPath = path.join(resolvedOutputDir, "visual_creative_upgrade_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderVisualCreativeUpgradeMarkdown(report), "utf8");
  return { outputDir: resolvedOutputDir, jsonPath, markdownPath };
}

module.exports = {
  REQUIRED_PLATFORM_VISUALS,
  buildVisualCreativeUpgradeReport,
  renderVisualCreativeUpgradeMarkdown,
  writeVisualCreativeUpgradeReport,
};
