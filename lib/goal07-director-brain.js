"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "07_director_brain";
const CARD_KINDS = new Set([
  "proof_card",
  "source_lock",
  "review_score_card",
  "steam_chart",
  "price_snap",
  "context_caveat",
  "pattern_interrupt",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalise(value) {
  return cleanText(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function resolveWorkspacePath(workspaceRoot, value) {
  if (!value) return "";
  const raw = String(value);
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return path.resolve(workspaceRoot || process.cwd(), raw);
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function shotStart(shot = {}) {
  return numberOr(shot.startS ?? shot.start_s ?? shot.start, 0);
}

function shotDuration(shot = {}) {
  return numberOr(shot.durationS ?? shot.duration_s ?? shot.duration, 0);
}

function shotEnd(shot = {}) {
  return shotStart(shot) + shotDuration(shot);
}

function isCardOnlyShot(shot = {}) {
  const kind = cleanText(shot.kind);
  if (CARD_KINDS.has(kind)) return true;
  const treatment = normalise(shot.visual_treatment);
  return /\bcard\b/.test(treatment) && !/\bmotion\b/.test(treatment);
}

function isMotionShot(shot = {}) {
  if (cleanText(shot.kind) === "motion_clip") return true;
  return Boolean(cleanText(shot.media_path || shot.clip_path || shot.video_path));
}

function isStaleOfficialProductMotionBlocker(blocker) {
  return [
    "official_product_motion_clip_minimum_not_met",
    "official_product_motion_family_minimum_not_met",
  ].includes(cleanText(blocker));
}

function isStaleActualMotionBudgetBlocker(blocker) {
  return cleanText(blocker) === "actual_motion_clip_minimum_not_met";
}

function hasBudgetMotionEvidence(plan = {}, minMotion = 0, minFamilies = 0) {
  const availableMotion = Number(plan.shot_budget?.available_motion_clips);
  const availableFamilies = Number(plan.shot_budget?.available_distinct_motion_families);
  return (
    Number.isFinite(availableMotion) &&
    Number.isFinite(availableFamilies) &&
    availableMotion >= minMotion &&
    availableFamilies >= minFamilies
  );
}

function scoreMeetsThreshold(scores = {}, thresholds = {}, key, fallbackThreshold) {
  const score = Number(scores[key]);
  const threshold = Number(thresholds[key] ?? fallbackThreshold);
  return Number.isFinite(score) && Number.isFinite(threshold) && score >= threshold;
}

function hasCurrentDirectMotionBenchmarkEvidence(plan = {}, motionShots = [], minFamilies = 0) {
  const benchmark = plan.media_house_benchmark || {};
  const profile = benchmark.visual_evidence_profile || {};
  const result = cleanText(benchmark.result || benchmark.verdict).toLowerCase();
  const failures = asArray(benchmark.failures).map(cleanText).filter(Boolean);
  const profileBlockers = asArray(profile.blockers).map(cleanText).filter(Boolean);
  const scores = benchmark.scores || {};
  const thresholds = benchmark.thresholds || {};
  const directMotionCount = Number(profile.direct_video_motion_asset_count ?? profile.real_motion_asset_count);
  const directFamilyCount = Number(profile.direct_video_motion_family_count ?? profile.real_media_family_count);
  const realMotionCount = Number(profile.real_motion_asset_count ?? directMotionCount);
  const realFamilyCount = Number(profile.real_media_family_count ?? directFamilyCount);
  const availableMotion = Number(plan.shot_budget?.available_motion_clips);
  const strictDirectCoverage =
    directMotionCount >= motionShots.length &&
    directFamilyCount >= minFamilies;
  const officialHybridCoverage =
    directMotionCount >= 2 &&
    directFamilyCount >= 2 &&
    realMotionCount >= motionShots.length &&
    realFamilyCount >= minFamilies;

  return (
    (result === "pass" || result === "ready" || result === "green") &&
    failures.length === 0 &&
    profileBlockers.length === 0 &&
    profile.generated_only_motion_deck !== true &&
    Number.isFinite(directMotionCount) &&
    Number.isFinite(directFamilyCount) &&
    Number.isFinite(realMotionCount) &&
    Number.isFinite(realFamilyCount) &&
    Number.isFinite(availableMotion) &&
    availableMotion >= motionShots.length &&
    (strictDirectCoverage || officialHybridCoverage) &&
    scoreMeetsThreshold(scores, thresholds, "motion_density_score", 75) &&
    scoreMeetsThreshold(scores, thresholds, "media_house_polish_score", 75)
  );
}

function firstVisualChangeOk(shots = []) {
  const sorted = [...shots].sort((a, b) => shotStart(a) - shotStart(b));
  return sorted.some((shot) => {
    if (cleanText(shot.id) === "hook_slam" || cleanText(shot.kind) === "hook_slam") return false;
    return shotStart(shot) > 0 && shotStart(shot) <= 1.5;
  });
}

function first3Strength(shots = []) {
  const early = shots.filter((shot) => shotStart(shot) < 3);
  const hasHook = early.some((shot) => cleanText(shot.kind) === "hook_slam" && shotStart(shot) <= 0.25);
  const hasMotion = early.some((shot) => isMotionShot(shot) && shotStart(shot) <= 1.5);
  const hasSourceOrProof = early.some((shot) => ["source_lock", "proof_card", "steam_chart"].includes(cleanText(shot.kind)));
  if (hasHook && hasMotion && hasSourceOrProof) return "strong";
  if (hasHook && hasMotion) return "usable";
  return "weak";
}

function cardStats(shots = [], durationS = 0) {
  const cardSeconds = shots
    .filter(isCardOnlyShot)
    .reduce((sum, shot) => sum + Math.max(0, shotDuration(shot)), 0);
  const totalDuration = Math.max(durationS, ...shots.map(shotEnd), 1);
  return {
    card_seconds: round(cardSeconds, 3),
    card_ratio: round(cardSeconds / totalDuration, 3),
    total_duration_s: round(totalDuration, 3),
  };
}

function sourceLockReadable(plan = {}, shots = []) {
  if (plan.visual_obligations?.source_locks_must_be_readable !== true) return false;
  const sourceLocks = shots.filter((shot) => cleanText(shot.kind) === "source_lock");
  if (!sourceLocks.length) return false;
  return sourceLocks.every((shot) => {
    const text = `${shot.source || ""} ${shot.visual_treatment || ""}`;
    return cleanText(shot.source) && !/^source$/i.test(cleanText(shot.source)) && /readable|large/i.test(text);
  });
}

function captionSafe(plan = {}) {
  const policy = plan.caption_policy || {};
  return (
    policy.subtitles_last === true &&
    policy.clean_manual_captions === true &&
    policy.avoid_lower_third_collisions === true
  );
}

function transitionSafe(plan = {}) {
  const transitionPlan = plan.transition_plan || plan.sound_transition_plan?.transitions || {};
  const maxRun = numberOr(transitionPlan.max_same_transition_run ?? transitionPlan.max_same_family_run, 0);
  return maxRun <= 2;
}

function sfxAligned(plan = {}, shots = []) {
  const sfx = plan.sfx_plan || plan.sound_transition_plan?.sfx || {};
  const cues = asArray(sfx.cues);
  const cueTargets = new Set(cues.map((cue) => cleanText(cue.target || cue.target_id)));
  const requiredShots = shots.filter((shot) =>
    ["hook_slam", "motion_clip", "source_lock", "proof_card", "steam_chart", "pattern_interrupt"].includes(cleanText(shot.kind)),
  );
  const covered = requiredShots.filter((shot) => cueTargets.has(cleanText(shot.id))).length;
  const enoughCueCount = cues.length >= Math.min(shots.length, 5);
  const noSourceBlockers = !asArray(sfx.source_plan?.readiness?.blockers).length &&
    !asArray(plan.sound_transition_plan?.readiness?.blockers).length;
  return enoughCueCount && noSourceBlockers && covered >= Math.min(requiredShots.length, 5);
}

function durationSuitable(plan = {}, shots = []) {
  const duration = numberOr(
    plan.sound_transition_plan?.duration_s ??
      plan.sound_transition_plan?.durationS ??
      plan.duration_s ??
      plan.durationS,
    Math.max(...shots.map(shotEnd), 0),
  );
  return duration >= 20 && duration <= 90;
}

function validateDirectorPlan(plan = {}) {
  const blockers = [];
  const warnings = [];
  const readiness = plan.readiness || {};
  const shots = asArray(plan.shot_plan || plan.shots);
  const motionShots = shots.filter(isMotionShot);
  const distinctFamilies = new Set(motionShots.map((shot) => cleanText(shot.source_family)).filter(Boolean));
  const minMotion = numberOr(plan.shot_budget?.min_actual_motion_clips, 5);
  const minFamilies = numberOr(plan.shot_budget?.min_distinct_motion_families, 4);
  const currentMotionEvidencePasses =
    motionShots.length >= minMotion &&
    distinctFamilies.size >= minFamilies &&
    hasBudgetMotionEvidence(plan, minMotion, minFamilies);
  const currentDirectMotionBenchmarkPasses = hasCurrentDirectMotionBenchmarkEvidence(plan, motionShots, minFamilies);
  const duration = numberOr(
    plan.sound_transition_plan?.duration_s ??
      plan.sound_transition_plan?.durationS ??
      plan.duration_s ??
      plan.durationS,
    Math.max(...shots.map(shotEnd), 0),
  );

  if (!shots.length) blockers.push("director:shot_plan_missing");
  if (cleanText(readiness.status) && cleanText(readiness.status) !== "director_ready") {
    for (const blocker of asArray(readiness.blockers)) {
      if (isStaleOfficialProductMotionBlocker(blocker) && currentMotionEvidencePasses) continue;
      if (isStaleActualMotionBudgetBlocker(blocker) && currentDirectMotionBenchmarkPasses) continue;
      blockers.push(`director:${blocker}`);
    }
    if (!asArray(readiness.blockers).length) blockers.push("director:not_ready");
  }
  if (!firstVisualChangeOk(shots)) blockers.push("director:no_visual_change_first_1_5s");
  if (first3Strength(shots) === "weak") blockers.push("director:weak_first_3s");

  const cards = cardStats(shots, duration);
  const maxCardRatio = numberOr(plan.shot_budget?.max_static_card_ratio, 0.28);
  const maxCardSeconds = numberOr(plan.shot_budget?.max_static_card_seconds, 14);
  if (cards.card_ratio > maxCardRatio || cards.card_seconds > maxCardSeconds) {
    blockers.push("director:too_many_card_only_beats");
  }

  if (!sourceLockReadable(plan, shots)) blockers.push("director:source_lock_not_readable");
  if (!captionSafe(plan)) blockers.push("director:caption_overlay_conflict_risk");
  if (!transitionSafe(plan)) blockers.push("director:repeated_transition_family");
  if (!sfxAligned(plan, shots)) blockers.push("director:sfx_alignment_missing");
  if (!durationSuitable(plan, shots)) blockers.push("director:unsuitable_duration");
  if (plan.safety?.social_posting_triggered === true || plan.safety?.oauth_triggered === true || plan.safety?.production_db_mutated === true) {
    blockers.push("director:safety_boundary_violation");
  }

  if (motionShots.length < minMotion && !currentDirectMotionBenchmarkPasses) {
    blockers.push("director:actual_motion_clip_minimum_not_met");
  }
  if (distinctFamilies.size < minFamilies) blockers.push("director:distinct_motion_families_minimum_not_met");

  return {
    blockers: unique(blockers),
    warnings: unique(warnings),
    metrics: {
      shot_count: shots.length,
      motion_shot_count: motionShots.length,
      distinct_motion_family_count: distinctFamilies.size,
      duration_s: round(duration, 3),
      ...cards,
      first_1_5s_visual_change: firstVisualChangeOk(shots),
      first_3s_strength: first3Strength(shots),
      sfx_cue_count: asArray(plan.sfx_plan?.cues || plan.sound_transition_plan?.sfx?.cues).length,
    },
  };
}

function buildTimelineRows(plan = {}) {
  const shots = asArray(plan.shot_plan || plan.shots).sort((a, b) => shotStart(a) - shotStart(b));
  const transitions = asArray(plan.transition_plan?.planned || plan.sound_transition_plan?.transitions?.planned);
  const cues = asArray(plan.sfx_plan?.cues || plan.sound_transition_plan?.sfx?.cues);
  return shots.map((shot, index) => {
    const id = cleanText(shot.id || `shot_${index + 1}`);
    const cue = cues.find((item) => cleanText(item.target || item.target_id) === id);
    const transition = transitions.find((item) => cleanText(item.into) === id);
    return {
      id,
      kind: cleanText(shot.kind || "shot"),
      start_s: round(shotStart(shot), 3),
      end_s: round(shotEnd(shot), 3),
      duration_s: round(shotDuration(shot), 3),
      source_family: cleanText(shot.source_family) || null,
      label: cleanText(shot.label) || null,
      visual_treatment: cleanText(shot.visual_treatment) || null,
      transition_family: transition?.family || null,
      sfx_family: cue?.family || null,
    };
  });
}

function buildRetentionIntent(storyId, plan = {}, validation = {}) {
  const shots = asArray(plan.shot_plan || plan.shots);
  return {
    story_id: storyId,
    first_1_5s_visual_change: validation.metrics?.first_1_5s_visual_change === true,
    first_3s_strength: validation.metrics?.first_3s_strength || first3Strength(shots),
    hook_slam: shots.some((shot) => cleanText(shot.kind) === "hook_slam"),
    proof_beat: shots.some((shot) => ["proof_card", "source_lock", "steam_chart"].includes(cleanText(shot.kind))),
    motion_density: {
      motion_shot_count: validation.metrics?.motion_shot_count || 0,
      distinct_motion_family_count: validation.metrics?.distinct_motion_family_count || 0,
      card_ratio: validation.metrics?.card_ratio || 0,
    },
    retention_interrupts: shots
      .filter((shot) => cleanText(shot.kind) === "pattern_interrupt")
      .map((shot) => ({
        id: shot.id || null,
        start_s: round(shotStart(shot), 3),
        label: cleanText(shot.label) || null,
      })),
    blockers: validation.blockers || [],
  };
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const storyId = cleanText(storyPackage.story_id || storyPackage.id);
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir
    ? resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir)
    : "";
  const canonical = await readJsonIfPresent(artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : "", {});
  const directorPath = artifactDir ? path.join(artifactDir, "director_beat_map.json") : "";
  const plan = await readJsonIfPresent(directorPath, null);
  const title = cleanText(storyPackage.title || canonical?.selected_title || canonical?.canonical_title || canonical?.title);

  if (!plan) {
    return {
      story_id: storyId || "unknown",
      title,
      artifact_dir: artifactDir || null,
      director_beat_map_path: directorPath || null,
      status: "blocked",
      blockers: [directorPath ? "director:beat_map_missing" : "director:artifact_dir_missing"],
      metrics: {},
      timeline: [],
      retention_intent: {
        story_id: storyId || "unknown",
        first_1_5s_visual_change: false,
        first_3s_strength: "weak",
        blockers: [directorPath ? "director:beat_map_missing" : "director:artifact_dir_missing"],
      },
    };
  }

  const validation = validateDirectorPlan(plan);
  const blockers = validation.blockers;
  return {
    story_id: storyId || cleanText(plan.story_id) || "unknown",
    title,
    artifact_dir: artifactDir || null,
    director_beat_map_path: directorPath,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    warnings: validation.warnings,
    metrics: validation.metrics,
    timeline: buildTimelineRows(plan),
    retention_intent: buildRetentionIntent(storyId || cleanText(plan.story_id) || "unknown", plan, validation),
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of stories) {
    for (const blocker of asArray(story.blockers)) {
      counts[blocker] = (counts[blocker] || 0) + 1;
    }
  }
  return counts;
}

function buildAggregateDirectorBeatMap(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    story_count: report.summary?.story_count || 0,
    ready_story_count: report.summary?.ready_story_count || 0,
    blocked_story_count: report.summary?.blocked_story_count || 0,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      director_beat_map_path: story.director_beat_map_path,
      blockers: story.blockers || [],
      metrics: story.metrics || {},
    })),
    safety: report.safety || {},
  };
}

function buildTimelinePlan(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      timeline: story.timeline || [],
      blockers: story.blockers || [],
    })),
  };
}

function buildRetentionIntentMap(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => story.retention_intent),
  };
}

async function buildGoal07DirectorBrain({
  storyPackages = [],
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal07DirectorBrain requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, outputDir: outDir }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
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
      ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      timeline_story_count: stories.filter((story) => asArray(story.timeline).length > 0).length,
      first_1_5s_ready_story_count: stories.filter((story) => story.metrics?.first_1_5s_visual_change === true).length,
      strong_first_3s_story_count: stories.filter((story) => story.metrics?.first_3s_strength === "strong").length,
    },
    blocker_counts: blockerCounts(stories),
    upstream_blockers: {
      goal04_owned_motion_materialiser: "BLOCKED/PARTIAL on operator source input if recorded in campaign status",
      goal06_rights_ledger: "PARTIAL/BLOCKED on rights repair if recorded in campaign status",
      note: "Goal 07 validates director planning and derives timeline and retention maps. It does not publish, render or invent missing footage.",
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
  report.director_beat_map = buildAggregateDirectorBeatMap(report);
  report.timeline_plan = buildTimelinePlan(report);
  report.retention_intent_map = buildRetentionIntentMap(report);
  return report;
}

function renderGoal07DirectorBrainMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 07 Director Brain");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Ready: ${report.summary?.ready_story_count || 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Strong first 3 seconds: ${report.summary?.strong_first_3s_story_count || 0}`);
  lines.push("");
  lines.push("## Stories");
  const stories = asArray(report.stories);
  if (!stories.length) lines.push("- none");
  for (const story of stories) {
    const blockers = asArray(story.blockers);
    const blockerText = blockers.length ? `; blockers: ${blockers.join(", ")}` : "";
    lines.push(`- ${story.story_id}: ${story.status}${blockerText}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This audit did not render, publish, upload, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal07DirectorBrain(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal07DirectorBrain requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal07_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal07_readiness_report.md");
  const directorBeatMap = path.join(outDir, "director_beat_map.json");
  const timelinePlan = path.join(outDir, "timeline_plan.json");
  const retentionIntentMap = path.join(outDir, "retention_intent_map.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal07DirectorBrainMarkdown(report), "utf8");
  await fs.writeJson(directorBeatMap, report.director_beat_map || buildAggregateDirectorBeatMap(report), { spaces: 2 });
  await fs.writeJson(timelinePlan, report.timeline_plan || buildTimelinePlan(report), { spaces: 2 });
  await fs.writeJson(retentionIntentMap, report.retention_intent_map || buildRetentionIntentMap(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    directorBeatMap,
    timelinePlan,
    retentionIntentMap,
  };
}

module.exports = {
  buildAggregateDirectorBeatMap,
  buildGoal07DirectorBrain,
  buildRetentionIntentMap,
  buildTimelinePlan,
  inspectStoryPackage,
  renderGoal07DirectorBrainMarkdown,
  validateDirectorPlan,
  writeGoal07DirectorBrain,
};
