"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");

const PUBLIC_PLATFORM_FIELDS = [
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "twitter_post_id",
  "x_post_id",
];

const BRIDGE_REPLACED_MEDIA_FIELDS = [
  "downloaded_images",
  "game_images",
  "downloaded_videos",
  "local_motion_clips",
  "motion_clips",
  "sfx_assets",
  "sound_effects",
  "music_assets",
  "image_path",
  "thumbnail_candidate_path",
  "hf_thumbnail_path",
  "music_path",
  "sfx_path",
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function realPlatformId(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^DUPE_/i.test(text)) return false;
  return !/^(blocked|disabled|skipped|failed|none|null|undefined)$/i.test(text);
}

function normaliseCandidates(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.candidates)) return value.candidates.filter(Boolean);
  if (Array.isArray(value?.scheduler_bridge_candidates)) {
    return value.scheduler_bridge_candidates.filter(Boolean);
  }
  return [];
}

function candidateById(candidateReport = {}) {
  const map = new Map();
  for (const candidate of normaliseCandidates(candidateReport)) {
    const id = cleanText(candidate?.id);
    if (id) map.set(id, candidate);
  }
  return map;
}

function storyById(stories = []) {
  const map = new Map();
  for (const story of Array.isArray(stories) ? stories : []) {
    const id = cleanText(story?.id);
    if (id) map.set(id, story);
  }
  return map;
}

function defaultPathExists(filePath) {
  if (!filePath) return false;
  try {
    const mediaPaths = require("./media-paths");
    const resolved = mediaPaths.resolveExistingSync(filePath);
    if (resolved && fs.pathExistsSync(resolved)) return true;
  } catch {
    // Fall through to direct checks.
  }
  return fs.pathExistsSync(filePath) || fs.pathExistsSync(path.resolve(process.cwd(), filePath));
}

function defaultFileSizeBytes(filePath) {
  if (!filePath) return 0;
  const attempts = [];
  try {
    const mediaPaths = require("./media-paths");
    const resolved = mediaPaths.resolveExistingSync(filePath);
    if (resolved) attempts.push(resolved);
  } catch {
    // Fall through to direct checks.
  }
  attempts.push(filePath, path.resolve(process.cwd(), filePath));
  for (const attempt of attempts) {
    try {
      if (attempt && fs.pathExistsSync(attempt)) return fs.statSync(attempt).size;
    } catch {
      // Try the next path.
    }
  }
  return 0;
}

function fileExistsSafe(filePath, fileExists) {
  if (!filePath) return false;
  if (typeof fileExists === "function") {
    try {
      return fileExists(filePath) === true;
    } catch {
      return false;
    }
  }
  return defaultPathExists(filePath);
}

function fileLooksUsable(filePath, fileExists, fileSizeBytes, minBytes = 1) {
  if (!fileExistsSafe(filePath, fileExists)) return false;
  if (typeof fileSizeBytes !== "function") return true;
  try {
    return Number(fileSizeBytes(filePath) || 0) >= minBytes;
  } catch {
    return false;
  }
}

function governanceIsGreen(candidate = {}) {
  const verdict = cleanText(candidate.governance_publish_status || candidate.publish_status);
  const publishVerdict = cleanText(candidate.publish_verdict?.verdict || candidate.publish_verdict?.status);
  return verdict === "GREEN" || publishVerdict === "GREEN";
}

function hasCleanCaptionPath(candidate = {}, fileExists) {
  return [candidate.manual_caption_path, candidate.caption_path, candidate.captions_path]
    .filter(Boolean)
    .some((filePath) => fileExistsSafe(filePath, fileExists));
}

function hasRightsLedger(candidate = {}) {
  const records = Array.isArray(candidate.rights_ledger) ? candidate.rights_ledger : [];
  if (records.length === 0) return false;
  const text = JSON.stringify(records).toLowerCase();
  return /audio|voice|tts|narration/.test(text) && /motion|video|render|visual|graphic/.test(text);
}

function firstSentence(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text);
}

function publicCopyManifest(candidate = {}) {
  const script = cleanText(candidate.narration_script || candidate.full_script || candidate.tts_script);
  return {
    canonical_subject: cleanText(candidate.canonical_subject || candidate.canonical_game),
    canonical_game: cleanText(candidate.canonical_game),
    selected_title: cleanText(
      candidate.selected_title ||
        candidate.public_title ||
        candidate.upload_title ||
        candidate.suggested_title ||
        candidate.title,
    ),
    first_spoken_line: cleanText(
      candidate.first_spoken_line ||
        candidate.narration_hook ||
        candidate.hook ||
        firstSentence(script),
    ),
    narration_script: script,
    full_script: cleanText(candidate.full_script),
    tts_script: cleanText(candidate.tts_script),
    description: cleanText(candidate.description),
  };
}

function validateBridgeCandidate({ bridgeCandidate = {}, reportCandidate = null, fileExists, fileSizeBytes }) {
  const reasons = [];
  const id = cleanText(bridgeCandidate.id);
  if (!id) reasons.push("story_id_missing");
  if (!reportCandidate) {
    reasons.push("candidate_report_missing");
  } else {
    if (reportCandidate.status !== "publish_ready") {
      reasons.push(`candidate_not_publish_ready:${reportCandidate.status || "unknown"}`);
    }
    const preflightStatus = reportCandidate.preflight_qa?.status || "missing";
    if (preflightStatus !== "pass") reasons.push(`preflight_not_pass:${preflightStatus}`);
    if (Array.isArray(reportCandidate.preflight_qa?.blockers) && reportCandidate.preflight_qa.blockers.length) {
      reasons.push(`preflight_blockers:${reportCandidate.preflight_qa.blockers.join(",")}`);
    }
  }
  if (bridgeCandidate.approved !== true) reasons.push("approved_not_true");
  if (bridgeCandidate.auto_approved !== true) reasons.push("auto_approved_not_true");
  if (!governanceIsGreen(bridgeCandidate)) reasons.push("governance_not_green");
  if (!cleanText(bridgeCandidate.title) || /^this gaming story$/i.test(cleanText(bridgeCandidate.title))) {
    reasons.push("title_missing_or_placeholder");
  }
  if (!cleanText(bridgeCandidate.canonical_subject)) reasons.push("canonical_subject_missing");
  if (!fileLooksUsable(bridgeCandidate.exported_path, fileExists, fileSizeBytes, 1024)) {
    reasons.push("exported_path_missing_on_disk");
  }
  if (!hasCleanCaptionPath(bridgeCandidate, fileExists)) reasons.push("clean_manual_captions_missing");
  if (!hasRightsLedger(bridgeCandidate)) reasons.push("rights_ledger_missing");
  const publicCopyQa = evaluateGoalPublicCopy(publicCopyManifest(bridgeCandidate));
  reasons.push(...publicCopyQa.failures);
  return reasons;
}

function buildUpdateStory({ liveStory = {}, bridgeCandidate = {}, generatedAt = new Date().toISOString() }) {
  const update = {
    ...liveStory,
    ...bridgeCandidate,
  };
  update.id = cleanText(bridgeCandidate.id || liveStory.id);
  update.title = cleanText(bridgeCandidate.title || bridgeCandidate.suggested_title || liveStory.title);
  update.suggested_title = cleanText(bridgeCandidate.suggested_title || bridgeCandidate.title || liveStory.suggested_title);
  update.approved = true;
  update.auto_approved = true;
  update.approved_at = bridgeCandidate.approved_at || liveStory.approved_at || generatedAt;
  update.publish_status = null;
  update.publish_error = null;
  update.qa_failed = false;
  update.qa_failures = [];
  update.video_qa_failures = [];
  update.content_qa_failures = [];
  update.script_generation_status = "approved";
  update.script_review_reason = "";
  update.visual_v4_render_bridge_status = "promoted_to_live_state";
  update.scheduler_bridge_promoted_at = generatedAt;
  update.scheduler_bridge_promotion_source = "bridge_candidate_promotion";
  update.governance_publish_status = bridgeCandidate.governance_publish_status || "GREEN";
  const canonicalPublicScript = cleanText(
    bridgeCandidate.narration_script ||
      bridgeCandidate.full_script ||
      bridgeCandidate.tts_script ||
      liveStory.narration_script ||
      liveStory.full_script ||
      liveStory.tts_script,
  );
  if (canonicalPublicScript) {
    update.narration_script = canonicalPublicScript;
    update.full_script = canonicalPublicScript;
    update.tts_script = canonicalPublicScript;
  }

  for (const field of BRIDGE_REPLACED_MEDIA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(bridgeCandidate, field)) continue;
    update[field] = Array.isArray(liveStory[field]) ? [] : null;
  }

  for (const field of PUBLIC_PLATFORM_FIELDS) {
    if (realPlatformId(liveStory[field])) update[field] = liveStory[field];
    else if (Object.prototype.hasOwnProperty.call(liveStory, field)) update[field] = liveStory[field] || "";
    else delete update[field];
  }

  return update;
}

function buildBridgeCandidatePromotionPlan({
  bridgeCandidates = [],
  candidateReport = {},
  liveStories = [],
  fileExists = null,
  fileSizeBytes = null,
  generatedAt = new Date().toISOString(),
  limit = Infinity,
  storyId = "",
} = {}) {
  const reportMap = candidateById(candidateReport);
  const liveMap = storyById(liveStories);
  const requestedStoryId = cleanText(storyId);
  const candidates = normaliseCandidates(bridgeCandidates)
    .filter((candidate) => !requestedStoryId || cleanText(candidate.id) === requestedStoryId)
    .slice(0, Number.isFinite(Number(limit)) ? Number(limit) : undefined);
  const sizeFn = fileSizeBytes || (typeof fileExists === "function" ? null : defaultFileSizeBytes);
  const eligible = [];
  const blocked = [];

  for (const candidate of candidates) {
    const id = cleanText(candidate.id);
    const reportCandidate = reportMap.get(id) || null;
    const reasons = validateBridgeCandidate({
      bridgeCandidate: candidate,
      reportCandidate,
      fileExists,
      fileSizeBytes: sizeFn,
    });
    if (reasons.length > 0) {
      blocked.push({
        story_id: id || null,
        title: cleanText(candidate.title).slice(0, 180),
        reasons,
      });
      continue;
    }
    const liveStory = liveMap.get(id) || {};
    const updateStory = buildUpdateStory({
      liveStory,
      bridgeCandidate: candidate,
      generatedAt,
    });
    eligible.push({
      story_id: id,
      title: updateStory.title,
      update_story: updateStory,
      evidence: {
        candidate_report_status: reportCandidate.status,
        preflight_status: reportCandidate.preflight_qa?.status || "unknown",
        exported_path: candidate.exported_path || null,
        caption_path: candidate.manual_caption_path || candidate.caption_path || null,
        rights_ledger_records: Array.isArray(candidate.rights_ledger) ? candidate.rights_ledger.length : 0,
      },
      operator_review: {
        changed_fields: Object.keys(updateStory).filter(
          (field) => JSON.stringify(updateStory[field] ?? null) !== JSON.stringify((liveStory || {})[field] ?? null),
        ),
        public_platform_fields_preserved: PUBLIC_PLATFORM_FIELDS.filter((field) => realPlatformId(liveStory[field])),
      },
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "bridge_candidate_live_promotion",
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
      bridge_candidates_seen: candidates.length,
      eligible_count: eligible.length,
      blocked_count: blocked.length,
      applied_count: 0,
    },
    eligible_promotions: eligible,
    blocked_candidates: blocked,
  };
}

function backupFileName(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `pulse-pre-bridge-candidate-promotion-${safeDate.toISOString().replace(/[:.]/g, "-")}.db`;
}

async function applyBridgeCandidatePromotionPlan(plan = {}, {
  db,
  operatorConfirmed = false,
  ensureDir = fs.ensureDir,
  backupPath = "",
  now = new Date(),
} = {}) {
  if (operatorConfirmed !== true) {
    throw new Error("bridge_candidate_promotion_requires_operator_confirmed");
  }
  if (!db || typeof db.upsertStory !== "function") {
    throw new Error("bridge_candidate_promotion_requires_db_adapter");
  }
  const promotions = Array.isArray(plan.eligible_promotions) ? plan.eligible_promotions : [];
  if (promotions.length === 0) {
    throw new Error("bridge_candidate_promotion_has_no_eligible_promotions");
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
  for (const promotion of promotions) {
    await db.upsertStory(promotion.update_story);
  }
  return {
    status: "applied",
    applied_count: promotions.length,
    backup_path: targetBackupPath || null,
    db_mutation: true,
    posting: false,
    oauth: false,
    token_printing: false,
    safety_gates_weakened: false,
    story_ids: promotions.map((promotion) => promotion.story_id),
  };
}

module.exports = {
  PUBLIC_PLATFORM_FIELDS,
  applyBridgeCandidatePromotionPlan,
  backupFileName,
  buildBridgeCandidatePromotionPlan,
  buildUpdateStory,
  normaliseCandidates,
  validateBridgeCandidate,
};
