"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildPulseMediaHouseScore,
  buildUpdatedControlTowerRules,
} = require("./pulse-media-house-score");

const GOAL_ID = "integrate_competitor_forensics_into_pulse_quality";
const MIN_FINAL_VIDEO_BYTES = 500000;
const MIN_FINAL_VIDEO_SECONDS = 10;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function inspectFinalVideoFile({ artifactDir, canonical = {}, director = {}, visualQuality = {}, platformManifest = {} } = {}) {
  const candidates = unique([
    canonical.final_render_path,
    canonical.exported_path,
    canonical.video_path,
    platformManifest.video_path,
    platformManifest.outputs?.youtube_shorts?.video_path,
    artifactDir ? path.join(artifactDir, "visual_v4_render.mp4") : "",
  ]).map((value) => resolveWorkspacePath("", value));
  let selectedPath = "";
  let bytes = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        selectedPath = candidate;
        bytes = stat.size;
        break;
      }
    } catch {
      // Keep trying candidate paths.
    }
  }
  const durationSeconds =
    numberOrNull(canonical.final_duration_seconds) ??
    numberOrNull(canonical.video_duration_seconds) ??
    numberOrNull(canonical.duration_seconds) ??
    numberOrNull(director.duration_s) ??
    numberOrNull(visualQuality.duration_seconds) ??
    numberOrNull(platformManifest.duration_seconds);
  const blockers = [];
  if (selectedPath && bytes !== null && bytes < MIN_FINAL_VIDEO_BYTES) {
    blockers.push("media_house:final_video_placeholder_or_too_short");
  }
  if (durationSeconds !== null && durationSeconds > 0 && durationSeconds < MIN_FINAL_VIDEO_SECONDS) {
    if (!blockers.includes("media_house:final_video_placeholder_or_too_short")) {
      blockers.push("media_house:final_video_placeholder_or_too_short");
    }
  }
  return {
    status: blockers.length ? "blocked" : selectedPath ? "pass" : "not_checked",
    path: selectedPath || null,
    bytes,
    duration_seconds: durationSeconds,
    minimum_bytes: MIN_FINAL_VIDEO_BYTES,
    minimum_duration_seconds: MIN_FINAL_VIDEO_SECONDS,
    blockers,
  };
}

function applyFinalVideoGate(score = {}, finalVideoReport = {}) {
  const blockers = asArray(finalVideoReport.blockers);
  if (!blockers.length) {
    return {
      ...score,
      final_video_report: finalVideoReport,
    };
  }
  const hardFailures = unique([...(score.hard_failures || []), ...blockers]);
  return {
    ...score,
    verdict: "RED",
    status: "fail",
    hard_failures: hardFailures,
    final_video_report: finalVideoReport,
    scores: {
      ...(score.scores || {}),
      overall_media_house_score: Math.min(Number(score.scores?.overall_media_house_score || 0), 40),
    },
    upgraded_quality_gate_report: {
      ...(score.upgraded_quality_gate_report || {}),
      verdict: "RED",
      status: "fail",
      hard_failures: hardFailures,
    },
  };
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function buildFootageEmpireIndex(report = {}) {
  const index = new Map();
  for (const row of asArray(report.rows || report.stories)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const storyId = storyIdFromPackage(storyPackage);
  const [
    canonical,
    scriptScorecard,
    visualQuality,
    director,
    audio,
    loudness,
    affiliate,
    platformManifest,
    benchmark,
    uniqueness,
    competitorSimilarity,
    distinctMotionFamily,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "competitor_similarity_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "distinct_motion_family_report.json"), {}),
  ]);
  const footageEmpireV2 = context.footageEmpireIndex instanceof Map ? context.footageEmpireIndex.get(storyId) || {} : {};

  const baseScore = buildPulseMediaHouseScore({
    story_id: storyId,
    canonical,
    scriptScorecard,
    visualQuality,
    director,
    audio,
    loudness,
    affiliate,
    platformManifest,
    benchmark,
    uniqueness,
    competitorSimilarity,
    footageEmpireV2,
    distinctMotionFamily,
    rulebook: context.rulebook || {},
    productionGrammar: context.productionGrammar || {},
    generatedAt: context.generatedAt,
  });
  const finalVideoReport = await inspectFinalVideoFile({
    artifactDir,
    canonical,
    director,
    visualQuality,
    platformManifest,
  });
  const score = applyFinalVideoGate(baseScore, finalVideoReport);

  if (artifactDir) {
    await fs.ensureDir(artifactDir);
    await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), score, { spaces: 2 });
  }

  return {
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.title || storyPackage.title),
    artifact_dir: artifactDir,
    status: score.verdict === "RED" ? "blocked" : score.verdict === "AMBER" ? "human_review" : "ready",
    final_verdict: score.verdict,
    blockers: asArray(score.hard_failures),
    pulse_media_house_score: score,
    source_material: {
      canonical_story_manifest_present: Object.keys(canonical).length > 0,
      script_scorecard_present: Object.keys(scriptScorecard).length > 0,
      visual_quality_report_present: Object.keys(visualQuality).length > 0,
      director_beat_map_present: Object.keys(director).length > 0,
      audio_manifest_present: Object.keys(audio).length > 0,
      loudness_report_present: Object.keys(loudness).length > 0,
      affiliate_manifest_present: Object.keys(affiliate).length > 0,
      platform_manifest_present: Object.keys(platformManifest).length > 0,
      footage_empire_v2_present: Object.keys(footageEmpireV2).length > 0,
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildAggregateScore(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    summary: report.summary || {},
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      title: story.title,
      verdict: story.pulse_media_house_score.verdict,
      status: story.pulse_media_house_score.status,
      scores: story.pulse_media_house_score.scores,
      hard_failures: story.pulse_media_house_score.hard_failures,
    })),
    safety: report.safety || {},
  };
}

function buildCompetitorParityReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    threshold: 72,
    stories: asArray(report.stories).map((story) => {
      const parity = story.pulse_media_house_score.competitor_parity_report;
      return {
        story_id: story.story_id,
        status: parity.status,
        score: parity.score,
        threshold: parity.threshold,
        blockers: parity.blockers,
      };
    }),
  };
}

function buildCompetitorSurpassReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    threshold: 68,
    stories: asArray(report.stories).map((story) => {
      const surpass = story.pulse_media_house_score.competitor_surpass_report;
      return {
        story_id: story.story_id,
        status: surpass.status,
        score: surpass.score,
        threshold: surpass.threshold,
        lift_targets: surpass.lift_targets,
      };
    }),
  };
}

function buildUpgradedQualityGateReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    verdict: report.verdict,
    blocker_counts: report.blocker_counts || {},
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      final_verdict: story.final_verdict,
      status: story.status,
      hard_failures: story.blockers,
      score_summary: story.pulse_media_house_score.scores,
    })),
    safety: report.safety || {},
  };
}

function buildIntegrationTestReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    checks: [
      {
        id: "weak_competitor_parity_video_fails",
        status: asArray(report.stories).some((story) => story.blockers.includes("media_house:competitor_parity_below_threshold")) ? "pass" : "not_observed_in_this_input",
      },
      {
        id: "strong_pulse_original_video_passes",
        status: asArray(report.stories).some((story) => story.final_verdict === "GREEN") ? "pass" : "not_observed_in_this_input",
      },
      {
        id: "copied_competitor_style_fails",
        status: asArray(report.stories).some((story) => story.blockers.includes("media_house:competitor_mimicry_risk")) ? "pass" : "not_observed_in_this_input",
      },
      {
        id: "generic_title_fails",
        status: asArray(report.stories).some((story) => story.blockers.includes("media_house:generic_title")) ? "pass" : "not_observed_in_this_input",
      },
      {
        id: "weak_hook_fails",
        status: asArray(report.stories).some((story) => story.blockers.includes("media_house:first_3_seconds_weak")) ? "pass" : "not_observed_in_this_input",
      },
      {
        id: "poor_sfx_audio_fails",
        status: asArray(report.stories).some((story) => story.blockers.includes("media_house:poor_sfx_audio")) ? "pass" : "not_observed_in_this_input",
      },
      {
        id: "story_relevant_commercial_route_passes",
        status: asArray(report.stories).some((story) => story.pulse_media_house_score.scores.commercial_trust_score >= 75) ? "pass" : "not_observed_in_this_input",
      },
    ],
    safety: {
      local_proof_only: true,
      no_live_publish: true,
      no_db_mutation: true,
    },
  };
}

async function buildCompetitorInformedQualityGate({
  storyPackages = [],
  rulebook = {},
  productionGrammar = {},
  footageEmpireReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (outputDir) await fs.ensureDir(path.resolve(outputDir));
  const stories = [];
  const footageEmpireIndex = buildFootageEmpireIndex(footageEmpireReport);
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, {
      workspaceRoot,
      rulebook,
      productionGrammar,
      footageEmpireIndex,
      generatedAt,
    }));
  }
  const green = stories.filter((story) => story.final_verdict === "GREEN");
  const amber = stories.filter((story) => story.final_verdict === "AMBER");
  const red = stories.filter((story) => story.final_verdict === "RED");
  const verdict = !stories.length
    ? "FAIL"
    : red.length && (green.length || amber.length)
      ? "PARTIAL"
      : red.length
        ? "BLOCKED"
        : amber.length
          ? "PARTIAL"
          : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      story_count: stories.length,
      green_story_count: green.length,
      amber_story_count: amber.length,
      red_story_count: red.length,
      scored_story_count: stories.length,
    },
    blocker_counts: blockerCounts(stories),
    source_lock_summary: {
      footage_empire_v2_story_count: footageEmpireIndex.size,
      blocked_by_source_lock_count: stories.filter((story) => story.blockers.includes("media_house:source_lock_not_verified")).length,
    },
    stories,
    safety: {
      local_proof_only: true,
      no_live_publish: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_mutation: true,
      no_competitor_assets_copied: true,
      no_gate_weakened: true,
    },
  };
  report.pulse_media_house_score = buildAggregateScore(report);
  report.competitor_parity_report = buildCompetitorParityReport(report);
  report.competitor_surpass_report = buildCompetitorSurpassReport(report);
  report.upgraded_quality_gate_report = buildUpgradedQualityGateReport(report);
  report.updated_control_tower_rules = buildUpdatedControlTowerRules();
  report.integration_test_report = buildIntegrationTestReport(report);
  return report;
}

function renderCompetitorInformedQualityGateMarkdown(report = {}) {
  const lines = [];
  lines.push("# Competitor-Informed Quality Gate");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`GREEN: ${report.summary?.green_story_count || 0}`);
  lines.push(`AMBER: ${report.summary?.amber_story_count || 0}`);
  lines.push(`RED: ${report.summary?.red_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This gate wrote score artefacts but did not publish, post externally, mutate DB rows, touch OAuth/token settings or copy competitor assets.");
  return `${lines.join("\n")}\n`;
}

async function writeCompetitorInformedQualityGate(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeCompetitorInformedQualityGate requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const files = {
    pulseMediaHouseScore: path.join(outDir, "pulse_media_house_score.json"),
    competitorParityReport: path.join(outDir, "competitor_parity_report.json"),
    competitorSurpassReport: path.join(outDir, "competitor_surpass_report.json"),
    upgradedQualityGateReport: path.join(outDir, "upgraded_quality_gate_report.json"),
    updatedControlTowerRules: path.join(outDir, "updated_control_tower_rules.json"),
    integrationTestReport: path.join(outDir, "integration_test_report.json"),
    reportJson: path.join(outDir, "competitor_informed_quality_gate_report.json"),
    reportMarkdown: path.join(outDir, "competitor_informed_quality_gate_report.md"),
  };
  await fs.writeJson(files.pulseMediaHouseScore, report.pulse_media_house_score || buildAggregateScore(report), { spaces: 2 });
  await fs.writeJson(files.competitorParityReport, report.competitor_parity_report || buildCompetitorParityReport(report), { spaces: 2 });
  await fs.writeJson(files.competitorSurpassReport, report.competitor_surpass_report || buildCompetitorSurpassReport(report), { spaces: 2 });
  await fs.writeJson(files.upgradedQualityGateReport, report.upgraded_quality_gate_report || buildUpgradedQualityGateReport(report), { spaces: 2 });
  await fs.writeJson(files.updatedControlTowerRules, report.updated_control_tower_rules || buildUpdatedControlTowerRules(), { spaces: 2 });
  await fs.writeJson(files.integrationTestReport, report.integration_test_report || buildIntegrationTestReport(report), { spaces: 2 });
  await fs.writeJson(files.reportJson, report, { spaces: 2 });
  await fs.writeFile(files.reportMarkdown, renderCompetitorInformedQualityGateMarkdown(report), "utf8");
  return files;
}

module.exports = {
  GOAL_ID,
  buildCompetitorInformedQualityGate,
  buildCompetitorParityReport,
  buildCompetitorSurpassReport,
  buildFootageEmpireIndex,
  buildIntegrationTestReport,
  buildUpgradedQualityGateReport,
  inspectStoryPackage,
  renderCompetitorInformedQualityGateMarkdown,
  writeCompetitorInformedQualityGate,
};
