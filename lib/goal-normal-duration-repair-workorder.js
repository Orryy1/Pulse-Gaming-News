"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  NORMAL_PRODUCTION_TARGET_SECONDS,
} = require("./goal-duration-variant-repair");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function round(value, places = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function normalDurationBlocker(blockers = []) {
  return asArray(blockers)
    .map(cleanText)
    .find((blocker) => /^normal_production_duration_below_quality_floor:/i.test(blocker));
}

function normalDurationCeilingBlocker(blockers = []) {
  return asArray(blockers)
    .map(cleanText)
    .find((blocker) =>
      /(?:audio_duration_too_long|video:duration_too_long|video_duration_too_long|duration_above_target)/i.test(blocker),
    );
}

function normalDurationContentBlocker(blockers = []) {
  return asArray(blockers)
    .map(cleanText)
    .find((blocker) =>
      /(?:pulse_gaming_no_gaming_topic_signal|approved_voice:spoken_outro_missing|spoken_outro_missing)/i.test(blocker),
    );
}

function allowedDurationRepairBlocker(blocker = "") {
  const text = cleanText(blocker);
  if (!text) return true;
  if (normalDurationBlocker([text])) return true;
  if (normalDurationCeilingBlocker([text])) return true;
  if (normalDurationContentBlocker([text])) return true;
  return /^preflight_candidate_(?:missing|not_publish_ready:review)$/i.test(text);
}

function hasDurationRepairSignal(blockers = []) {
  return Boolean(
    normalDurationBlocker(blockers) ||
      normalDurationCeilingBlocker(blockers) ||
      normalDurationContentBlocker(blockers),
  );
}

function hasNonDurationRepairBlockers(blockers = []) {
  const cleanBlockers = asArray(blockers).map(cleanText).filter(Boolean);
  if (!hasDurationRepairSignal(cleanBlockers)) return false;
  return cleanBlockers.some((blocker) => !allowedDurationRepairBlocker(blocker));
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function buildNormalDurationRepairJob(blockedStory = {}, {
  generatedAt = new Date().toISOString(),
  targetDurationSeconds = NORMAL_PRODUCTION_TARGET_SECONDS,
} = {}) {
  const artifactDir = path.resolve(blockedStory.artifact_dir || "");
  const [canonical, renderManifest] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json")),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json")),
  ]);
  const manifestDuration = round(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s,
  );
  let floorBlocker = normalDurationBlocker(blockedStory.blockers);
  let ceilingBlocker = normalDurationCeilingBlocker(blockedStory.blockers);
  const contentBlocker = normalDurationContentBlocker(blockedStory.blockers);
  const candidateMissing = asArray(blockedStory.blockers)
    .map(cleanText)
    .some((blocker) => blocker === "preflight_candidate_missing");
  if (!floorBlocker && !ceilingBlocker && !contentBlocker && candidateMissing && manifestDuration != null) {
    if (manifestDuration > Number(targetDurationSeconds.max)) {
      ceilingBlocker = `manifest_duration_above_target:${manifestDuration}`;
    } else if (manifestDuration < Number(targetDurationSeconds.min)) {
      floorBlocker = `manifest_duration_below_target:${manifestDuration}`;
    }
  }
  const blocker = floorBlocker || ceilingBlocker || contentBlocker;
  if (!blocker) return null;
  const currentDuration = round(
    manifestDuration ||
      blocker.split(":").pop(),
  );
  const coBlockers = asArray(blockedStory.blockers)
    .map(cleanText)
    .filter((blockerText) => blockerText && !allowedDurationRepairBlocker(blockerText));
  const hasCoBlockers = coBlockers.length > 0;
  return {
    story_id: cleanText(blockedStory.story_id || canonical.story_id),
    title: cleanText(
      canonical.selected_title ||
        canonical.short_title ||
        blockedStory.incident_guard?.evidence?.title ||
        blockedStory.story_id,
    ),
    artifact_dir: artifactDir,
    status: "needs_duration_variant_rerender",
    repair_lane: floorBlocker
      ? "normal_production_duration_floor"
      : ceilingBlocker
        ? "normal_production_duration_ceiling"
        : "normal_production_content_signal_repair",
    current_duration_s: currentDuration,
    target_duration_seconds: { ...targetDurationSeconds },
    minimum_extension_seconds: round(Number(targetDurationSeconds.min) - Number(currentDuration)),
    duration_reduction_required_seconds: ceilingBlocker
      ? round(Number(currentDuration) - Number(targetDurationSeconds.max))
      : 0,
    source_blockers: asArray(blockedStory.blockers),
    co_blockers: coBlockers,
    has_non_duration_blockers: hasCoBlockers,
    source_hold_reasons: asArray(blockedStory.hold_reasons).map(cleanText).filter(Boolean),
    generated_at: generatedAt,
    actions: [
      "extend_canonical_script_source_safely",
      "regenerate_audio_and_word_timestamps",
      "rerender_visual_v4_platform_variants",
      "rerun_content_video_platform_governance_preflight",
    ],
    publish_gate: hasCoBlockers
      ? "do_not_publish_until_normal_duration_rerender_strict_dry_run_and_remaining_non_duration_blockers_clear"
      : "do_not_publish_until_normal_duration_rerender_and_strict_dry_run_pass",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_gate_weakened: true,
    },
  };
}

async function buildNormalDurationRepairWorkOrder({
  dryRunPlan = {},
  cutoverPlan = {},
  generatedAt = new Date().toISOString(),
  targetDurationSeconds = NORMAL_PRODUCTION_TARGET_SECONDS,
} = {}) {
  const jobs = [];
  const skipped = [];
  const blockedStories = asArray(dryRunPlan.blocked_stories);
  const heldStories = asArray(dryRunPlan.held_stories);
  const cutoverQueueStories = asArray(cutoverPlan.queue);
  const repairCandidates = [];
  const seen = new Set();
  const addCandidate = (story = {}, source = "") => {
    const key = cleanText(story.story_id || story.id || story.artifact_dir);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    repairCandidates.push({ ...story, _normal_duration_source: source });
  };
  blockedStories.forEach((story) => addCandidate(story, "blocked"));
  heldStories.forEach((story) => addCandidate(story, "held"));
  cutoverQueueStories.forEach((story) => addCandidate(story, "cutover_queue"));
  for (const blockedStory of repairCandidates) {
    const job = await buildNormalDurationRepairJob(blockedStory, {
      generatedAt,
      targetDurationSeconds,
    });
    if (job) jobs.push(job);
    else skipped.push({
      story_id: cleanText(blockedStory.story_id),
      blockers: asArray(blockedStory.blockers),
      reason: "no_normal_duration_floor_blocker",
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "NORMAL_PRODUCTION_DURATION_REPAIR_WORK_ORDER",
    source_dry_run_generated_at: dryRunPlan.generated_at || null,
    source_cutover_generated_at: cutoverPlan.generated_at || null,
    target_duration_seconds: { ...targetDurationSeconds },
    summary: {
      blocked_story_count: blockedStories.length,
      held_story_count: heldStories.length,
      cutover_queue_story_count: cutoverQueueStories.length,
      repair_required_count: jobs.length,
      repair_with_remaining_blockers_count: jobs.filter((job) => job.has_non_duration_blockers).length,
      skipped_count: skipped.length,
    },
    jobs,
    skipped,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function renderNormalDurationRepairWorkOrderMarkdown(workOrder = {}) {
  const lines = [];
  lines.push("# Normal Production Duration Repair Work Order");
  lines.push("");
  lines.push(`Generated: ${workOrder.generated_at || ""}`);
  lines.push(`Target: ${workOrder.target_duration_seconds?.min || 35}-${workOrder.target_duration_seconds?.max || 59}s`);
  lines.push(`Repair jobs: ${workOrder.summary?.repair_required_count || 0}`);
  lines.push(`Skipped: ${workOrder.summary?.skipped_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(workOrder.jobs).slice(0, 60)) {
    lines.push(`- ${job.story_id}: ${job.current_duration_s}s -> ${job.target_duration_seconds.min}-${job.target_duration_seconds.max}s`);
  }
  if (!asArray(workOrder.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: work-order generation only. No publish, database, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeNormalDurationRepairWorkOrder(workOrder = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeNormalDurationRepairWorkOrder requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "normal_duration_repair_work_order.json");
  const markdownPath = path.join(outDir, "normal_duration_repair_work_order.md");
  await fs.writeJson(jsonPath, workOrder, { spaces: 2 });
  await fs.writeFile(markdownPath, renderNormalDurationRepairWorkOrderMarkdown(workOrder), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  buildNormalDurationRepairWorkOrder,
  renderNormalDurationRepairWorkOrderMarkdown,
  writeNormalDurationRepairWorkOrder,
};
