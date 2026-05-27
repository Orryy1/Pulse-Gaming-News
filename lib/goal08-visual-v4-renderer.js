"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { policyVersionBlockers } = require("./studio/v4/render-policy");

const GOAL_ID = "08_visual_v4_creator_renderer";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreValue(scores = {}, key) {
  return numberOr(scores?.[key], 0);
}

function thresholdValue(thresholds = {}, key, fallback) {
  return numberOr(thresholds?.[key], fallback);
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

function buildUpstreamDirectorIndex(upstreamDirectorReport = {}) {
  const index = new Map();
  for (const story of asArray(upstreamDirectorReport.stories)) {
    index.set(cleanText(story.story_id || story.id), story);
  }
  return index;
}

function shotStart(shot = {}) {
  return numberOr(shot.start_s ?? shot.startS ?? shot.start, 0);
}

function shotDuration(shot = {}) {
  return numberOr(shot.duration_s ?? shot.durationS ?? shot.duration, 0);
}

function isCardShot(shot = {}) {
  const kind = cleanText(shot.kind);
  if (["proof_card", "source_lock", "review_score_card", "steam_chart", "price_snap", "quote_card"].includes(kind)) {
    return true;
  }
  return /\bcard\b/i.test(cleanText(shot.visual_treatment)) && !/\bmotion\b/i.test(cleanText(shot.visual_treatment));
}

function transitionFamilies(director = {}) {
  return asArray(director.transition_plan?.planned || director.sound_transition_plan?.transitions?.planned)
    .map((entry) => cleanText(entry.family || entry.transition_family))
    .filter(Boolean);
}

function hasRepeatedRhythm(director = {}, qualityReport = {}) {
  const transitionEnergy = scoreValue(qualityReport.scores, "transition_energy_score");
  const transitionFloor = thresholdValue(qualityReport.thresholds, "transition_energy_score", 65);
  if (transitionEnergy > 0 && transitionEnergy < transitionFloor) return true;

  let run = 1;
  const families = transitionFamilies(director);
  for (let index = 1; index < families.length; index += 1) {
    run = families[index] === families[index - 1] ? run + 1 : 1;
    if (run >= 3) return true;
  }
  return false;
}

function cardRatio(director = {}) {
  const shots = asArray(director.shot_plan || director.shots);
  const duration = Math.max(
    numberOr(director.sound_transition_plan?.duration_s ?? director.duration_s ?? director.durationS, 0),
    ...shots.map((shot) => shotStart(shot) + shotDuration(shot)),
    1,
  );
  const cardSeconds = shots.filter(isCardShot).reduce((sum, shot) => sum + Math.max(0, shotDuration(shot)), 0);
  return Number((cardSeconds / duration).toFixed(3));
}

async function outputFileState(renderManifest = {}, artifactDir = "") {
  const outputPath = resolveWorkspacePath(artifactDir, renderManifest.output_path || renderManifest.output || "visual_v4_render.mp4");
  if (!outputPath || !(await fs.pathExists(outputPath))) {
    return { path: outputPath || null, exists: false, size_bytes: 0 };
  }
  const stat = await fs.stat(outputPath);
  return { path: outputPath, exists: stat.isFile(), size_bytes: stat.size };
}

function visualQualityBlockers(qualityReport = {}, director = {}) {
  const blockers = [];
  const scores = qualityReport.scores || {};
  const thresholds = qualityReport.thresholds || {};

  if (cleanText(qualityReport.result || qualityReport.verdict || qualityReport.status) !== "pass") {
    blockers.push("visual:quality_not_pass");
  }
  for (const failure of asArray(qualityReport.failures)) {
    blockers.push(`visual:${failure}`);
  }
  if (scoreValue(scores, "motion_density_score") < thresholdValue(thresholds, "motion_density_score", 75)) {
    blockers.push("visual:weak_motion_density");
  }
  if (scoreValue(scores, "first_3_seconds_hook_score") < thresholdValue(thresholds, "first_3_seconds_hook_score", 75)) {
    blockers.push("visual:unclear_first_frame");
  }
  if (scoreValue(scores, "card_hierarchy_score") < thresholdValue(thresholds, "card_hierarchy_score", 65)) {
    blockers.push("visual:poor_text_hierarchy");
  }
  if (scoreValue(scores, "caption_legibility_score") < thresholdValue(thresholds, "caption_legibility_score", 70)) {
    blockers.push("visual:tiny_or_illegible_captions");
  }
  if (scoreValue(scores, "source_lock_quality_score") < thresholdValue(thresholds, "source_lock_quality_score", 65)) {
    blockers.push("visual:illegible_source_lock");
  }
  if (scoreValue(scores, "media_house_polish_score") < thresholdValue(thresholds, "media_house_polish_score", 75)) {
    blockers.push("visual:template_looking_output");
  }
  if (scoreValue(scores, "rights_risk_score") < thresholdValue(thresholds, "rights_risk_score", 70)) {
    blockers.push("visual:rights_risk_above_reference");
  }
  if (scoreValue(scores, "stale_wording_risk") > thresholdValue(thresholds, "stale_wording_risk", 30)) {
    blockers.push("visual:stale_public_wording_risk");
  }
  if (hasRepeatedRhythm(director, qualityReport)) blockers.push("visual:repeated_rhythm");
  if (cardRatio(director) > 0.34) blockers.push("visual:dense_overlays");
  if (qualityReport.visual_evidence_profile?.generated_only_motion_deck === true) {
    blockers.push("visual:generated_only_motion_deck");
  }
  for (const blocker of asArray(qualityReport.visual_evidence_profile?.blockers)) {
    blockers.push(`visual:${blocker}`);
  }
  return unique(blockers);
}

function renderManifestBlockers(renderManifest = {}, fileState = {}) {
  const blockers = [];
  if (
    cleanText(renderManifest.renderer) !== "visual_v4_production" ||
    cleanText(renderManifest.visual_tier) !== "production_v4_motion" ||
    renderManifest.final_publish_render !== true
  ) {
    blockers.push("render:not_final_visual_v4_production");
  }
  if (!fileState.exists) blockers.push("render:output_missing");
  else if (fileState.size_bytes < 1024) blockers.push("render:output_too_small");
  if (renderManifest.safety?.no_publish_triggered === false) blockers.push("render:safety_publish_side_effect");
  if (renderManifest.safety?.no_db_mutation === false) blockers.push("render:safety_db_mutation_side_effect");
  if (renderManifest.safety?.no_oauth_or_token_change === false) blockers.push("render:safety_oauth_side_effect");
  for (const blocker of policyVersionBlockers(renderManifest)) blockers.push(`render:${blocker}`);
  return unique(blockers);
}

function upstreamBlockers(storyId, upstreamDirectorIndex = new Map()) {
  const row = upstreamDirectorIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal07_director_brain_missing"];
  if (cleanText(row.status) === "ready") return [];
  return unique(["upstream:goal07_director_brain_blocked", ...asArray(row.blockers)]);
}

function readabilityStatus(story = {}) {
  const blockers = asArray(story.blockers).filter((blocker) =>
    [
      "visual:tiny_or_illegible_captions",
      "visual:poor_text_hierarchy",
      "visual:illegible_source_lock",
      "visual:dense_overlays",
    ].includes(blocker),
  );
  return blockers.length ? "blocked" : "pass";
}

function frameStatus(story = {}) {
  const blockers = asArray(story.blockers).filter((blocker) =>
    ["visual:unclear_first_frame", "visual:weak_motion_density", "render:output_missing", "render:output_too_small"].includes(blocker),
  );
  return blockers.length ? "blocked" : "pass";
}

function repetitionStatus(story = {}) {
  const blockers = asArray(story.blockers).filter((blocker) =>
    ["visual:repeated_rhythm", "visual:template_looking_output", "visual:generated_only_motion_deck"].includes(blocker),
  );
  return blockers.length ? "blocked" : "pass";
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const storyId = cleanText(storyPackage.story_id || storyPackage.id);
  const artifactDir = resolveWorkspacePath(
    workspaceRoot,
    storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir,
  );
  const title = cleanText(storyPackage.title);
  const [renderManifest, qualityReport, director] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), null),
    readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), null),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
  ]);
  const missing = [];
  if (!renderManifest) missing.push("render:manifest_missing");
  if (!qualityReport) missing.push("visual:quality_report_missing");

  const fileState = renderManifest ? await outputFileState(renderManifest, artifactDir) : { exists: false, size_bytes: 0 };
  const directBlockers = unique([
    ...missing,
    ...(renderManifest ? renderManifestBlockers(renderManifest, fileState) : []),
    ...(qualityReport ? visualQualityBlockers(qualityReport, director) : []),
  ]);
  const upstream = upstreamBlockers(storyId, options.upstreamDirectorIndex);
  const blockers = unique([...upstream, ...directBlockers]);
  const directVisualStatus = directBlockers.length ? "blocked" : "pass";
  return {
    story_id: storyId || "unknown",
    title,
    artifact_dir: artifactDir || null,
    status: blockers.length ? "blocked" : "ready",
    direct_visual_status: directVisualStatus,
    blockers,
    direct_visual_blockers: directBlockers,
    upstream_blockers: upstream,
    render: {
      manifest_path: artifactDir ? path.join(artifactDir, "render_manifest.json") : null,
      output_path: fileState.path || null,
      output_exists: fileState.exists,
      output_size_bytes: fileState.size_bytes,
      renderer: cleanText(renderManifest?.renderer),
      visual_tier: cleanText(renderManifest?.visual_tier),
      final_publish_render: renderManifest?.final_publish_render === true,
      rendered_duration_s: renderManifest?.rendered_duration_s ?? null,
      clips: renderManifest?.clips ?? null,
    },
    quality: {
      report_path: artifactDir ? path.join(artifactDir, "visual_quality_report.json") : null,
      result: cleanText(qualityReport?.result || qualityReport?.verdict || qualityReport?.status),
      scores: qualityReport?.scores || {},
      thresholds: qualityReport?.thresholds || {},
      failures: asArray(qualityReport?.failures),
      warnings: asArray(qualityReport?.warnings),
    },
    director: {
      report_path: artifactDir ? path.join(artifactDir, "director_beat_map.json") : null,
      card_ratio: cardRatio(director),
      transition_families: transitionFamilies(director),
      repeated_rhythm: hasRepeatedRhythm(director, qualityReport || {}),
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) {
      counts[blocker] = (counts[blocker] || 0) + 1;
    }
  }
  return counts;
}

function buildVisualRenderManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    story_count: report.summary?.story_count || 0,
    ready_story_count: report.summary?.visual_ready_story_count || 0,
    direct_visual_pass_story_count: report.summary?.direct_visual_pass_story_count || 0,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      direct_visual_status: story.direct_visual_status,
      blockers: story.blockers,
      render: story.render,
    })),
    safety: report.safety || {},
  };
}

function buildFrameQualityReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: frameStatus(story),
      first_3_seconds_hook_score: scoreValue(story.quality?.scores, "first_3_seconds_hook_score"),
      motion_density_score: scoreValue(story.quality?.scores, "motion_density_score"),
      blockers: asArray(story.blockers).filter((blocker) =>
        ["visual:unclear_first_frame", "visual:weak_motion_density", "render:output_missing", "render:output_too_small"].includes(blocker),
      ),
    })),
  };
}

function buildMobileReadabilityReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: readabilityStatus(story),
      caption_legibility_score: scoreValue(story.quality?.scores, "caption_legibility_score"),
      source_lock_quality_score: scoreValue(story.quality?.scores, "source_lock_quality_score"),
      card_hierarchy_score: scoreValue(story.quality?.scores, "card_hierarchy_score"),
      card_ratio: story.director?.card_ratio ?? null,
      blockers: asArray(story.blockers).filter((blocker) =>
        [
          "visual:tiny_or_illegible_captions",
          "visual:poor_text_hierarchy",
          "visual:illegible_source_lock",
          "visual:dense_overlays",
        ].includes(blocker),
      ),
    })),
  };
}

function buildVisualRepetitionReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: repetitionStatus(story),
      transition_energy_score: scoreValue(story.quality?.scores, "transition_energy_score"),
      media_house_polish_score: scoreValue(story.quality?.scores, "media_house_polish_score"),
      transition_families: story.director?.transition_families || [],
      repeated_rhythm: story.director?.repeated_rhythm === true,
      blockers: asArray(story.blockers).filter((blocker) =>
        ["visual:repeated_rhythm", "visual:template_looking_output", "visual:generated_only_motion_deck"].includes(blocker),
      ),
    })),
  };
}

async function buildGoal08VisualV4Renderer({
  storyPackages = [],
  upstreamDirectorReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal08VisualV4Renderer requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const upstreamDirectorIndex = buildUpstreamDirectorIndex(upstreamDirectorReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, upstreamDirectorIndex }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directVisualPassStories = stories.filter((story) => story.direct_visual_status === "pass");
  const directVisualBlockedStories = stories.filter((story) => story.direct_visual_status === "blocked");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      story_count: stories.length,
      visual_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_visual_pass_story_count: directVisualPassStories.length,
      direct_visual_blocked_story_count: directVisualBlockedStories.length,
      final_visual_v4_render_count: stories.filter((story) => story.render.final_publish_render === true).length,
      frame_quality_pass_story_count: stories.filter((story) => frameStatus(story) === "pass").length,
      mobile_readability_pass_story_count: stories.filter((story) => readabilityStatus(story) === "pass").length,
      visual_repetition_pass_story_count: stories.filter((story) => repetitionStatus(story) === "pass").length,
    },
    blocker_counts: blockerCounts(stories),
    upstream_blockers: {
      goal07_director_brain: "Goal 08 requires a ready Goal 07 director plan before a render can count as ready.",
      note: "This gate validates existing local render evidence. It does not rerender, publish or promote blocked upstream work.",
    },
    stories,
    safety: {
      read_only_audit: true,
      no_render_triggered: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.visual_render_manifest = buildVisualRenderManifest(report);
  report.frame_quality_report = buildFrameQualityReport(report);
  report.mobile_readability_report = buildMobileReadabilityReport(report);
  report.visual_repetition_report = buildVisualRepetitionReport(report);
  return report;
}

function renderGoal08VisualV4RendererMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 08 Visual V4 Creator Studio renderer");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Visual-ready stories: ${report.summary?.visual_ready_story_count || 0}`);
  lines.push(`Direct visual pass stories: ${report.summary?.direct_visual_pass_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const counts = report.blocker_counts || {};
  const blockers = Object.keys(counts).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This audit did not render, publish, upload, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal08VisualV4Renderer(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal08VisualV4Renderer requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal08_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal08_readiness_report.md");
  const visualRenderManifest = path.join(outDir, "visual_render_manifest.json");
  const frameQualityReport = path.join(outDir, "frame_quality_report.json");
  const mobileReadabilityReport = path.join(outDir, "mobile_readability_report.json");
  const visualRepetitionReport = path.join(outDir, "visual_repetition_report.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal08VisualV4RendererMarkdown(report), "utf8");
  await fs.writeJson(visualRenderManifest, report.visual_render_manifest || buildVisualRenderManifest(report), { spaces: 2 });
  await fs.writeJson(frameQualityReport, report.frame_quality_report || buildFrameQualityReport(report), { spaces: 2 });
  await fs.writeJson(mobileReadabilityReport, report.mobile_readability_report || buildMobileReadabilityReport(report), { spaces: 2 });
  await fs.writeJson(visualRepetitionReport, report.visual_repetition_report || buildVisualRepetitionReport(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    visualRenderManifest,
    frameQualityReport,
    mobileReadabilityReport,
    visualRepetitionReport,
  };
}

module.exports = {
  buildFrameQualityReport,
  buildGoal08VisualV4Renderer,
  buildMobileReadabilityReport,
  buildVisualRenderManifest,
  buildVisualRepetitionReport,
  inspectStoryPackage,
  renderGoal08VisualV4RendererMarkdown,
  writeGoal08VisualV4Renderer,
};
