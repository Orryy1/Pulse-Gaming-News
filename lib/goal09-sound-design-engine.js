"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
} = require("./studio/v4/render-policy");
const {
  editorialSfxScore,
  minimumScoreForRole,
} = require("./studio/v4/sfx-source-registry");

const GOAL_ID = "09_sound_design_engine";

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

function buildUpstreamVisualIndex(upstreamVisualReport = {}) {
  const index = new Map();
  for (const story of asArray(upstreamVisualReport.stories)) {
    index.set(cleanText(story.story_id || story.id), story);
  }
  return index;
}

function readinessStatus(manifest = {}) {
  return cleanText(
    manifest.source_plan?.readiness?.status ||
      manifest.readiness?.status ||
      manifest.status,
  );
}

function readinessBlockers(manifest = {}) {
  return [
    ...asArray(manifest.source_plan?.readiness?.blockers),
    ...asArray(manifest.readiness?.blockers),
  ];
}

function selectedSfxAssets(sfxManifest = {}) {
  return asArray(
    sfxManifest.source_plan?.selected_assets ||
      sfxManifest.selected_assets ||
      sfxManifest.assets,
  );
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredSfxRoles(sfxManifest = {}) {
  return asArray(sfxManifest.source_plan?.required_roles);
}

function coveredSfxRoles(sfxManifest = {}) {
  return new Set(asArray(sfxManifest.source_plan?.covered_roles).map(cleanText));
}

function directorSoundPlan(director = {}) {
  return director.sound_transition_plan || {
    sfx: director.sfx_plan || {},
    transitions: director.transition_plan || {},
    readiness: {},
  };
}

function soundCues(director = {}) {
  const plan = directorSoundPlan(director);
  return asArray(plan.sfx?.cues);
}

function maxCueFamilyRun(cues = []) {
  let max = 0;
  let run = 0;
  let previous = "";
  for (const cue of asArray(cues)) {
    const family = cleanText(cue.family || cue.role);
    if (family && family === previous) run += 1;
    else {
      previous = family;
      run = family ? 1 : 0;
    }
    max = Math.max(max, run);
  }
  return max;
}

function sfxAssetTasteBlockers(selectedAssets = []) {
  const blockers = [];
  for (const asset of asArray(selectedAssets)) {
    const role = cleanText(asset.role || asset.sfx_role || asset.family || "transition");
    const explicitScore = finiteNumberOrNull(asset.editorial_sfx_score);
    const score = explicitScore === null ? editorialSfxScore(asset, undefined, role) : explicitScore;
    const floor = minimumScoreForRole(role);
    if (score < floor) blockers.push(`sound:sfx_asset_below_editorial_floor:${role}`);
  }
  return unique(blockers);
}

function loudnessBlockers(loudnessReport = {}) {
  const blockers = [];
  if (cleanText(loudnessReport.verdict || loudnessReport.status) !== "pass") {
    blockers.push("sound:loudness_failed");
  }
  for (const blocker of asArray(loudnessReport.blockers)) {
    blockers.push(`loudness:${blocker}`);
  }
  const metrics = loudnessReport.metrics || {};
  if (numberOr(metrics.valid_segment_count, 0) < 3) blockers.push("sound:loudness_unverified");
  if (metrics.max_peak_db !== null && metrics.max_peak_db !== undefined && numberOr(metrics.max_peak_db, -99) > -0.8) {
    blockers.push("sound:unsafe_loudness_peak");
  }
  if (metrics.mean_range_db !== null && metrics.mean_range_db !== undefined && numberOr(metrics.mean_range_db, 0) > 5) {
    blockers.push("sound:buried_or_jumping_voice");
  }
  if (metrics.max_adjacent_rise_db !== null && metrics.max_adjacent_rise_db !== undefined && numberOr(metrics.max_adjacent_rise_db, 0) > 4) {
    blockers.push("sound:late_voice_loudness_jump");
  }
  if (loudnessReport.safety?.mutates_media === true ||
    loudnessReport.safety?.mutates_production_db === true ||
    loudnessReport.safety?.mutates_tokens === true ||
    loudnessReport.safety?.posts_to_platforms === true) {
    blockers.push("sound:loudness_audit_safety_side_effect");
  }
  return unique(blockers);
}

function audioManifestBlockers(audioManifest = {}) {
  const blockers = [];
  if (!cleanText(audioManifest.narration_audio_path)) blockers.push("sound:narration_audio_missing");
  if (!cleanText(audioManifest.word_timestamps_path)) blockers.push("sound:word_timestamps_missing");
  if (cleanText(audioManifest.voice_status) !== "materialized") blockers.push("sound:voice_not_materialized");
  if (numberOr(audioManifest.word_timestamp_count, 0) <= 0) blockers.push("sound:word_timestamps_empty");
  const rules = audioManifest.mix_rules || {};
  if (rules.narration_priority !== true) blockers.push("sound:narration_priority_missing");
  if (rules.duck_under_narration !== true) blockers.push("sound:sidechain_ducking_missing");
  if (rules.limiter !== true) blockers.push("sound:limiter_missing");
  if (audioManifest.safety?.no_publishing_side_effects === false ||
    audioManifest.safety?.oauth_triggered === true ||
    audioManifest.safety?.production_db_mutated === true) {
    blockers.push("sound:audio_manifest_safety_side_effect");
  }
  return unique(blockers);
}

function sfxManifestBlockers(sfxManifest = {}, director = {}) {
  const blockers = [];
  if (readinessStatus(sfxManifest) !== "pass") blockers.push("sound:sfx_source_plan_not_pass");
  for (const blocker of readinessBlockers(sfxManifest)) blockers.push(`sfx:${blocker}`);

  const selectedAssets = selectedSfxAssets(sfxManifest);
  const requiredRoles = requiredSfxRoles(sfxManifest).map(cleanText).filter(Boolean);
  if (!selectedAssets.length || (!requiredRoles.length && selectedAssets.length < 3)) {
    blockers.push("sound:sfx_selected_assets_missing");
  }
  for (const role of requiredRoles) {
    if (!coveredSfxRoles(sfxManifest).has(cleanText(role))) {
      blockers.push(`sound:sfx_role_not_covered:${cleanText(role)}`);
    }
  }
  if (selectedAssets.some((asset) => /(?:blocked|rejected|unapproved)/i.test(cleanText(asset.approval_status)))) {
    blockers.push("sound:unapproved_sfx_asset");
  }
  if (selectedAssets.some((asset) => cleanText(asset.provider_id || asset.provider).toLowerCase() === "pulse_generated")) {
    blockers.push("sound:generated_sfx_only");
  }
  blockers.push(...sfxAssetTasteBlockers(selectedAssets));

  const plan = directorSoundPlan(director);
  const cues = soundCues(director);
  const cueCount = numberOr(plan.sfx?.cue_count, cues.length);
  if (cueCount < 4) blockers.push("sound:too_few_sfx_cues");
  if (numberOr(plan.sfx?.max_same_family_run, maxCueFamilyRun(cues)) > 2 || maxCueFamilyRun(cues) > 2) {
    blockers.push("sound:repeated_sfx_pattern");
  }
  if (plan.sfx?.mastering?.narration_priority === false ||
    plan.sfx?.mastering?.duck_under_narration === false) {
    blockers.push("sound:mastering_does_not_prioritise_voice");
  }
  return unique(blockers);
}

function renderPolicyBlockers(renderManifest = {}) {
  const blockers = [];
  if (cleanText(renderManifest.sfx_mix_policy_version) !== STUDIO_V4_SFX_MIX_POLICY_VERSION) {
    blockers.push("sound:sfx_mix_policy_stale");
  }
  if (cleanText(renderManifest.voice_mix_policy_version) !== STUDIO_V4_VOICE_MIX_POLICY_VERSION) {
    blockers.push("sound:voice_mix_policy_stale");
  }
  if (renderManifest.final_publish_render !== true) blockers.push("sound:not_final_mixed_render");
  if (renderManifest.safety?.no_publish_triggered === false ||
    renderManifest.safety?.no_db_mutation === false ||
    renderManifest.safety?.no_oauth_or_token_change === false) {
    blockers.push("sound:render_manifest_safety_side_effect");
  }
  return unique(blockers);
}

function upstreamBlockers(storyId, upstreamVisualIndex = new Map()) {
  const row = upstreamVisualIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal08_visual_v4_renderer_missing"];
  if (cleanText(row.status) === "ready") return [];
  return unique(["upstream:goal08_visual_v4_renderer_blocked", ...asArray(row.blockers)]);
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const storyId = cleanText(storyPackage.story_id || storyPackage.id);
  const artifactDir = resolveWorkspacePath(
    workspaceRoot,
    storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir,
  );
  const [audioManifest, sfxManifest, loudnessReport, director, renderManifest] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), null),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), null),
    readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), null),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
  ]);
  const missing = [];
  if (!audioManifest) missing.push("sound:audio_manifest_missing");
  if (!sfxManifest) missing.push("sound:sfx_manifest_missing");
  if (!loudnessReport) missing.push("sound:loudness_report_missing");

  const directBlockers = unique([
    ...missing,
    ...(audioManifest ? audioManifestBlockers(audioManifest) : []),
    ...(sfxManifest ? sfxManifestBlockers(sfxManifest, director) : []),
    ...(loudnessReport ? loudnessBlockers(loudnessReport) : []),
    ...renderPolicyBlockers(renderManifest),
  ]);
  const upstream = upstreamBlockers(storyId, options.upstreamVisualIndex);
  const blockers = unique([...upstream, ...directBlockers]);
  const cues = soundCues(director);
  return {
    story_id: storyId || "unknown",
    title: cleanText(storyPackage.title),
    artifact_dir: artifactDir || null,
    status: blockers.length ? "blocked" : "ready",
    direct_sound_status: directBlockers.length ? "blocked" : "pass",
    blockers,
    direct_sound_blockers: directBlockers,
    upstream_blockers: upstream,
    audio: {
      manifest_path: artifactDir ? path.join(artifactDir, "audio_manifest.json") : null,
      narration_audio_path: cleanText(audioManifest?.narration_audio_path),
      word_timestamps_path: cleanText(audioManifest?.word_timestamps_path),
      voice_status: cleanText(audioManifest?.voice_status),
      word_timestamp_count: numberOr(audioManifest?.word_timestamp_count, 0),
      mix_rules: audioManifest?.mix_rules || {},
    },
    sfx: {
      manifest_path: artifactDir ? path.join(artifactDir, "sfx_manifest.json") : null,
      status: readinessStatus(sfxManifest || {}),
      cue_count: numberOr(directorSoundPlan(director).sfx?.cue_count, cues.length),
      source_manifest_cue_count: numberOr(sfxManifest?.cue_count, 0),
      selected_asset_count: selectedSfxAssets(sfxManifest || {}).length,
      required_roles: requiredSfxRoles(sfxManifest || {}),
      covered_roles: asArray(sfxManifest?.source_plan?.covered_roles),
      max_same_family_run: numberOr(directorSoundPlan(director).sfx?.max_same_family_run, maxCueFamilyRun(cues)),
      families: unique(cues.map((cue) => cleanText(cue.family || cue.role))),
    },
    loudness: {
      report_path: artifactDir ? path.join(artifactDir, "audio_segment_loudness_report.json") : null,
      verdict: cleanText(loudnessReport?.verdict || loudnessReport?.status),
      blockers: asArray(loudnessReport?.blockers),
      metrics: loudnessReport?.metrics || {},
    },
    render_policy: {
      sfx_mix_policy_version: cleanText(renderManifest?.sfx_mix_policy_version),
      voice_mix_policy_version: cleanText(renderManifest?.voice_mix_policy_version),
      final_publish_render: renderManifest?.final_publish_render === true,
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

function buildAudioPlan(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    ready_story_count: report.summary?.sound_ready_story_count || 0,
    direct_sound_pass_story_count: report.summary?.direct_sound_pass_story_count || 0,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      direct_sound_status: story.direct_sound_status,
      blockers: story.blockers,
      audio: story.audio,
      render_policy: story.render_policy,
    })),
    safety: report.safety || {},
  };
}

function buildAggregateSfxManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: asArray(story.direct_sound_blockers).some((blocker) => blocker.startsWith("sound:sfx") || blocker.startsWith("sfx:"))
        ? "blocked"
        : "pass",
      sfx: story.sfx,
      blockers: asArray(story.direct_sound_blockers).filter((blocker) => blocker.startsWith("sound:sfx") || blocker.startsWith("sfx:")),
    })),
  };
}

function buildLoudnessReport(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: asArray(story.direct_sound_blockers).some((blocker) => blocker.startsWith("sound:loudness") || blocker.startsWith("loudness:") || blocker.startsWith("sound:unsafe") || blocker.startsWith("sound:buried") || blocker.startsWith("sound:late"))
        ? "blocked"
        : "pass",
      loudness: story.loudness,
      blockers: asArray(story.direct_sound_blockers).filter((blocker) => blocker.startsWith("sound:loudness") || blocker.startsWith("loudness:") || blocker.startsWith("sound:unsafe") || blocker.startsWith("sound:buried") || blocker.startsWith("sound:late")),
    })),
  };
}

function buildAudioQualityScorecard(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.direct_sound_status === "pass" ? "pass" : "blocked",
      score: Math.max(0, 100 - asArray(story.direct_sound_blockers).length * 12),
      direct_sound_blockers: story.direct_sound_blockers,
      upstream_blockers: story.upstream_blockers,
      checks: {
        audio_manifest: !asArray(story.direct_sound_blockers).some((blocker) => blocker.includes("audio_manifest") || blocker.includes("narration") || blocker.includes("word_timestamps") || blocker.includes("sidechain") || blocker.includes("limiter")),
        sfx_manifest: !asArray(story.direct_sound_blockers).some((blocker) => blocker.startsWith("sound:sfx") || blocker.startsWith("sfx:")),
        loudness: !asArray(story.direct_sound_blockers).some((blocker) => blocker.startsWith("sound:loudness") || blocker.startsWith("loudness:") || blocker.startsWith("sound:unsafe") || blocker.startsWith("sound:buried") || blocker.startsWith("sound:late")),
        current_mix_policy: !asArray(story.direct_sound_blockers).some((blocker) => blocker.includes("mix_policy")),
      },
    })),
  };
}

async function buildGoal09SoundDesignEngine({
  storyPackages = [],
  upstreamVisualReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal09SoundDesignEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const upstreamVisualIndex = buildUpstreamVisualIndex(upstreamVisualReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, upstreamVisualIndex }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directSoundPassStories = stories.filter((story) => story.direct_sound_status === "pass");
  const directSoundBlockedStories = stories.filter((story) => story.direct_sound_status === "blocked");
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
      sound_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_sound_pass_story_count: directSoundPassStories.length,
      direct_sound_blocked_story_count: directSoundBlockedStories.length,
      sfx_source_pass_story_count: stories.filter((story) => story.sfx.status === "pass").length,
      loudness_pass_story_count: stories.filter((story) => story.loudness.verdict === "pass").length,
      current_sound_policy_story_count: stories.filter((story) =>
        story.render_policy.sfx_mix_policy_version === STUDIO_V4_SFX_MIX_POLICY_VERSION &&
        story.render_policy.voice_mix_policy_version === STUDIO_V4_VOICE_MIX_POLICY_VERSION,
      ).length,
    },
    blocker_counts: blockerCounts(stories),
    upstream_blockers: {
      goal08_visual_v4_creator_renderer: "Goal 09 requires a ready Visual V4 renderer gate before a mixed sound plan can count as ready.",
      note: "This gate validates existing local audio, SFX and loudness evidence. It does not remix, render, publish or mutate media.",
    },
    stories,
    safety: {
      read_only_audit: true,
      no_audio_mix_triggered: true,
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
  report.audio_plan = buildAudioPlan(report);
  report.sfx_manifest = buildAggregateSfxManifest(report);
  report.loudness_report = buildLoudnessReport(report);
  report.audio_quality_scorecard = buildAudioQualityScorecard(report);
  return report;
}

function renderGoal09SoundDesignEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 09 Sound Design Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Sound-ready stories: ${report.summary?.sound_ready_story_count || 0}`);
  lines.push(`Direct sound pass stories: ${report.summary?.direct_sound_pass_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This audit did not mix audio, render video, publish, upload, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal09SoundDesignEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal09SoundDesignEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal09_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal09_readiness_report.md");
  const audioPlan = path.join(outDir, "audio_plan.json");
  const sfxManifest = path.join(outDir, "sfx_manifest.json");
  const loudnessReport = path.join(outDir, "loudness_report.json");
  const audioQualityScorecard = path.join(outDir, "audio_quality_scorecard.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal09SoundDesignEngineMarkdown(report), "utf8");
  await fs.writeJson(audioPlan, report.audio_plan || buildAudioPlan(report), { spaces: 2 });
  await fs.writeJson(sfxManifest, report.sfx_manifest || buildAggregateSfxManifest(report), { spaces: 2 });
  await fs.writeJson(loudnessReport, report.loudness_report || buildLoudnessReport(report), { spaces: 2 });
  await fs.writeJson(audioQualityScorecard, report.audio_quality_scorecard || buildAudioQualityScorecard(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    audioPlan,
    sfxManifest,
    loudnessReport,
    audioQualityScorecard,
  };
}

module.exports = {
  buildAggregateSfxManifest,
  buildAudioPlan,
  buildAudioQualityScorecard,
  buildGoal09SoundDesignEngine,
  buildLoudnessReport,
  inspectStoryPackage,
  renderGoal09SoundDesignEngineMarkdown,
  writeGoal09SoundDesignEngine,
};
