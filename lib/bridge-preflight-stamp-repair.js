"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const REPAIRABLE_FAILURE_PATTERNS = [
  /^script_too_short \(\d+ words, min 80\)$/i,
  /^approved_voice:spoken_outro_missing$/i,
  /^script_coherence:missing_exact_cta_in_script$/i,
  /^public_output:title_missing_canonical_subject$/i,
  /^gold_standard:first_3_seconds_hook_below_reference$/i,
  /^gold_standard:card_hierarchy_below_reference$/i,
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
  } catch {
    return trimmed
      .split(/[,|]\s*/)
      .map(cleanText)
      .filter(Boolean);
  }
}

function cloneStory(story = {}) {
  if (!story || typeof story !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(story));
  } catch {
    return { ...story };
  }
}

function qaFailureList(story = {}) {
  return [
    ...parseList(story.qa_failures),
    ...parseList(story.content_qa_failures),
    ...parseList(story.video_qa_failures),
  ];
}

function isRepairableFailure(reason) {
  const text = cleanText(reason);
  return REPAIRABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasOnlyRepairableFailures(story = {}) {
  const failures = qaFailureList(story);
  if (!failures.length) return false;
  return failures.every(isRepairableFailure);
}

function isBridgePromotedRetentionShort(story = {}) {
  return (
    story &&
    story.qa_failed === true &&
    story.visual_v4_render_bridge_status === "promoted_to_live_state" &&
    story.render_lane === "visual_v4_production" &&
    story.render_quality_class === "premium" &&
    story.duration_lane === "pulse_retention_short" &&
    story.allow_retention_short_video === true &&
    story.governance_publish_status === "GREEN"
  );
}

function summariseGate(result = {}) {
  if (!result || typeof result !== "object") {
    return { result: "fail", failures: ["gate_result_missing"], warnings: [] };
  }
  return {
    result: result.result || result.status || "unknown",
    failures: Array.isArray(result.failures) ? result.failures.map(cleanText).filter(Boolean) : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.map(cleanText).filter(Boolean) : [],
  };
}

function gateIsPass(result = {}) {
  return summariseGate(result).result === "pass";
}

async function runCurrentGates(story = {}, deps = {}) {
  const runContentQa = deps.runContentQa || require("./services/content-qa").runContentQa;
  const runVideoQa = deps.runVideoQa || require("./services/video-qa").runVideoQa;
  const buildVideoQaOptionsForStory =
    deps.buildVideoQaOptionsForStory ||
    require("./services/video-qa").buildVideoQaOptionsForStory;
  const runPlatformVideoQa =
    deps.runPlatformVideoQa || require("./services/platform-video-qa").runPlatformVideoQa;
  const runStudioGovernancePreflight =
    deps.runStudioGovernancePreflight ||
    require("./services/studio-governance-preflight").runStudioGovernancePreflight;

  const contentStory = cloneStory(story);
  const videoStory = cloneStory(story);
  const platformStory = cloneStory(story);
  const governanceStory = cloneStory(story);
  const content = await runContentQa(contentStory, { blockThinVisuals: true });
  const video = videoStory.exported_path
    ? await runVideoQa(
        videoStory.exported_path,
        buildVideoQaOptionsForStory(videoStory, deps.videoQaOptions || {}),
      )
    : { result: "fail", failures: ["exported_path_missing"], warnings: [] };
  const platform = platformStory.exported_path
    ? await runPlatformVideoQa(platformStory.exported_path, deps.platformVideoQaOptions || {})
    : { result: "fail", failures: ["exported_path_missing"], warnings: [] };
  const governance = await runStudioGovernancePreflight(
    governanceStory,
    deps.studioGovernanceOptions || {},
  );
  return {
    content: summariseGate(content),
    video: summariseGate(video),
    platform: summariseGate(platform),
    governance: summariseGate(governance),
  };
}

function currentGateBlockers(gates = {}) {
  const blockers = [];
  for (const [name, gate] of Object.entries(gates)) {
    if (!gateIsPass(gate)) {
      blockers.push(`${name}:${gate.failures?.[0] || gate.result || "failed"}`);
    }
  }
  return blockers;
}

function buildRepairedStory(story = {}, generatedAt = new Date().toISOString()) {
  const next = cloneStory(story);
  const originalFailures = qaFailureList(story);
  next.qa_failed = false;
  next.qa_failures = [];
  next.content_qa_failures = [];
  next.video_qa_failures = [];
  next.qa_warnings = [];
  if (cleanText(story.publish_status) === "failed") next.publish_status = null;
  if (/^qa_blocked:/i.test(cleanText(story.publish_error))) next.publish_error = null;
  next.bridge_preflight_stamp_repaired_at = generatedAt;
  next.bridge_preflight_stamp_repair_reason =
    "current_gates_pass_after_stale_bridge_preflight_stamp";
  next.bridge_preflight_stamp_original_failures = originalFailures;
  return next;
}

async function buildBridgePreflightStampRepairPlan({
  stories = [],
  generatedAt = new Date().toISOString(),
  limit = Infinity,
  storyId = "",
  deps = {},
} = {}) {
  const requestedId = cleanText(storyId);
  const candidates = (Array.isArray(stories) ? stories : [])
    .filter((story) => story && story.qa_failed === true)
    .filter((story) => !requestedId || cleanText(story.id) === requestedId)
    .slice(0, Number.isFinite(Number(limit)) ? Number(limit) : undefined);
  const eligible = [];
  const blocked = [];

  for (const story of candidates) {
    const reasons = [];
    if (!isBridgePromotedRetentionShort(story)) reasons.push("not_bridge_promoted_retention_short_v4");
    if (!hasOnlyRepairableFailures(story)) reasons.push("qa_failures_not_in_repairable_stamp_set");
    let gates = null;
    if (!reasons.length) {
      try {
        gates = await runCurrentGates(story, deps);
        reasons.push(...currentGateBlockers(gates));
      } catch (err) {
        reasons.push(`current_gate_exception:${err.code || err.name || "unknown"}`);
      }
    }
    if (reasons.length) {
      blocked.push({
        story_id: cleanText(story.id) || null,
        title: cleanText(story.title).slice(0, 180),
        reasons,
        original_failures: qaFailureList(story),
      });
      continue;
    }
    eligible.push({
      story_id: cleanText(story.id),
      title: cleanText(story.title),
      repaired_story: buildRepairedStory(story, generatedAt),
      evidence: {
        original_failures: qaFailureList(story),
        current_gates: gates,
        render_lane: story.render_lane,
        render_quality_class: story.render_quality_class,
        duration_lane: story.duration_lane,
        exported_path: story.exported_path || null,
      },
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "bridge_preflight_stamp_repair",
    status: eligible.length > 0 ? "ready_for_operator_confirmed_apply" : "blocked",
    safety: {
      dry_run_by_default: true,
      requires_operator_confirmed: true,
      db_mutation_on_apply: true,
      posting: false,
      oauth: false,
      token_printing: false,
      safety_gates_weakened: false,
    },
    summary: {
      qa_failed_rows_seen: candidates.length,
      eligible_count: eligible.length,
      blocked_count: blocked.length,
      applied_count: 0,
    },
    eligible_repairs: eligible,
    blocked_repairs: blocked,
  };
}

function backupFileName(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `pulse-pre-bridge-preflight-stamp-repair-${safeDate.toISOString().replace(/[:.]/g, "-")}.db`;
}

async function applyBridgePreflightStampRepairPlan(plan = {}, {
  db,
  operatorConfirmed = false,
  ensureDir = fs.ensureDir,
  backupPath = "",
  now = new Date(),
} = {}) {
  if (operatorConfirmed !== true) {
    throw new Error("bridge_preflight_stamp_repair_requires_operator_confirmed");
  }
  if (!db || typeof db.upsertStory !== "function") {
    throw new Error("bridge_preflight_stamp_repair_requires_db_adapter");
  }
  const repairs = Array.isArray(plan.eligible_repairs) ? plan.eligible_repairs : [];
  if (!repairs.length) {
    throw new Error("bridge_preflight_stamp_repair_has_no_eligible_repairs");
  }
  const dbPath = db.DB_PATH || "";
  const backupDir = dbPath ? path.join(path.dirname(dbPath), "backups") : "";
  const targetBackupPath = backupPath || (backupDir ? path.join(backupDir, backupFileName(now)) : "");
  if (targetBackupPath) {
    await ensureDir(path.dirname(targetBackupPath));
    const rawDb = typeof db.getDb === "function" ? db.getDb() : null;
    if (rawDb && typeof rawDb.backup === "function") {
      await rawDb.backup(targetBackupPath);
    }
  }
  for (const repair of repairs) {
    await db.upsertStory(repair.repaired_story);
  }
  return {
    status: "applied",
    applied_count: repairs.length,
    backup_path: targetBackupPath || null,
    db_mutation: true,
    posting: false,
    oauth: false,
    token_printing: false,
    safety_gates_weakened: false,
    story_ids: repairs.map((repair) => repair.story_id),
  };
}

module.exports = {
  REPAIRABLE_FAILURE_PATTERNS,
  applyBridgePreflightStampRepairPlan,
  backupFileName,
  buildBridgePreflightStampRepairPlan,
  buildRepairedStory,
  currentGateBlockers,
  hasOnlyRepairableFailures,
  isBridgePromotedRetentionShort,
  qaFailureList,
  runCurrentGates,
};
