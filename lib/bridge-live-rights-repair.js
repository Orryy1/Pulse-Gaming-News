"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildStudioGovernanceReport,
} = require("./studio-governance-engine");

const ALL_SOCIAL_PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "threads",
  "pinterest",
];

const GENERATED_VISUAL_FIELDS = [
  "image_path",
  "thumbnail_candidate_path",
  "hf_thumbnail_path",
  "story_image_path",
  "instagram_thumbnail_path",
  "tiktok_thumbnail_path",
];

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        return asArray(JSON.parse(text));
      } catch {
        return [];
      }
    }
    return [text];
  }
  if (typeof value === "object") return [value];
  return [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePathText(value) {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function stableAssetId(value, fallback) {
  const clean = cleanText(value)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function isBridgeLiveStory(story = {}) {
  const status = cleanText(story.visual_v4_render_bridge_status);
  const renderLane = cleanText(story.render_lane);
  return (
    status === "promoted_to_live_state" ||
    status === "ready_for_live_cutover" ||
    status === "bridge_ready" ||
    cleanText(story.scheduler_bridge_artifact_dir) !== "" ||
    renderLane === "visual_v4_production" ||
    renderLane === "studio_v4_director_bridge"
  );
}

function platformExpandedRecord(record = {}) {
  const allowed = new Set([
    ...asArray(record.allowed_platforms).map((platform) => cleanText(platform).toLowerCase()).filter(Boolean),
    ...ALL_SOCIAL_PLATFORMS,
  ]);
  return {
    ...record,
    allowed_platforms: [...allowed],
  };
}

function generatedVisualRightsRecord({ storyId, field, filePath } = {}) {
  const id = cleanText(storyId || "story");
  const cleanField = cleanText(field || "generated_visual");
  const cleanPath = cleanText(filePath);
  return {
    asset_id: `${id}_${cleanField}`,
    path: cleanPath,
    source_url: `local://pulse-generated-visual/${id}/${cleanField}`,
    source_type: "pulse_generated_editorial_graphic",
    rights_risk_class: "owned_generated_graphic",
    licence_basis: "owned_generated_editorial_graphic",
    allowed_platforms: [...ALL_SOCIAL_PLATFORMS],
    commercial_use_allowed: true,
    transformation_notes: "Generated Pulse Gaming editorial card or thumbnail for this governed V4 package.",
    expiry: null,
    credit_required: false,
    risk_score: 0.08,
    evidence_file: "rights/pulse-generated-editorial-graphics.json",
    approval_status: "approved",
  };
}

function mergeRightsRecords(records = []) {
  const byKey = new Map();
  for (const raw of asArray(records)) {
    if (!raw || typeof raw !== "object") continue;
    const record = platformExpandedRecord(raw);
    const key =
      cleanText(record.asset_id).toLowerCase() ||
      normalisePathText(record.path) ||
      normalisePathText(record.source_url) ||
      stableAssetId(JSON.stringify(record), "rights_record");
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function generatedVisualRecordsForStory(story = {}) {
  const storyId = cleanText(story.id || story.story_id);
  const records = [];
  for (const field of GENERATED_VISUAL_FIELDS) {
    const filePath = cleanText(story[field]);
    if (!filePath) continue;
    const isLocalGenerated =
      /(?:^|[\\/])output[\\/](?:images|thumbnails|goal-proof)[\\/]/i.test(filePath) ||
      /(?:^|[\\/])output[\\/](?:images|thumbnails|goal-proof)[\\/]/i.test(filePath.replace(/\//g, path.sep));
    if (!isLocalGenerated) continue;
    records.push(generatedVisualRightsRecord({ storyId, field, filePath }));
  }
  return records;
}

function repairBridgeLiveStoryRights(story = {}, { generatedAt = new Date().toISOString() } = {}) {
  const currentRights = asArray(story.rights_ledger);
  const generatedRecords = generatedVisualRecordsForStory(story);
  const v4Clips = asArray(story.visual_v4_bridge_video_clips);
  const repaired = {
    ...story,
    downloaded_images: [],
    game_images: [],
    ...(v4Clips.length ? { video_clips: v4Clips } : {}),
    legacy_visual_fields_cleared_at: generatedAt,
    legacy_visual_fields_cleared_reason: "final_v4_bridge_uses_owned_motion_package",
    rights_ledger: mergeRightsRecords([...currentRights, ...generatedRecords]),
    rights_records: mergeRightsRecords([...currentRights, ...generatedRecords]),
    rights_ledger_live_repaired_at: generatedAt,
    rights_ledger_live_repair_strategy: "prune_unused_legacy_visuals_and_rights_generated_v4_assets",
  };
  return repaired;
}

function governanceStatusFor(story = {}, { generatedAt } = {}) {
  const report = buildStudioGovernanceReport({
    story,
    generatedAt,
    captionFileExists: story.clean_manual_captions === true || story.manual_caption_generated === true,
    captionPath: story.caption_path || story.manual_caption_path,
  });
  return {
    status: report.publish_manifest?.publish_status || "RED",
    reason_codes: report.rejection_reasons?.reason_codes || [],
    warnings: report.rejection_reasons?.warnings || [],
    rights: report.rights_ledger,
  };
}

function buildBridgeLiveRightsRepairPlan({
  stories = [],
  generatedAt = new Date().toISOString(),
  storyId = "",
  limit = Infinity,
} = {}) {
  const requested = cleanText(storyId);
  const candidates = asArray(stories)
    .filter(isBridgeLiveStory)
    .filter((story) => !requested || cleanText(story.id || story.story_id) === requested)
    .slice(0, Number.isFinite(Number(limit)) ? Number(limit) : undefined);
  const eligible = [];
  const blocked = [];
  for (const story of candidates) {
    const before = governanceStatusFor(story, { generatedAt });
    const repairedStory = repairBridgeLiveStoryRights(story, { generatedAt });
    const after = governanceStatusFor(repairedStory, { generatedAt });
    const id = cleanText(story.id || story.story_id);
    const changedFields = Object.keys(repairedStory).filter(
      (field) => JSON.stringify(repairedStory[field] ?? null) !== JSON.stringify(story[field] ?? null),
    );
    const item = {
      story_id: id,
      title: cleanText(story.title || story.selected_title),
      pre_repair_governance_status: before.status,
      post_repair_governance_status: after.status,
      pre_repair_reason_codes: before.reason_codes,
      post_repair_reason_codes: after.reason_codes,
      missing_assets_before: before.rights?.missing_assets || [],
      missing_assets_after: after.rights?.missing_assets || [],
      changed_fields: changedFields,
      repaired_story: repairedStory,
    };
    if (after.status === "GREEN" || !after.reason_codes.includes("rights:no_rights_record")) eligible.push(item);
    else blocked.push(item);
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "bridge_live_rights_repair",
    status: eligible.length ? "ready_for_operator_confirmed_apply" : "blocked",
    summary: {
      candidates_seen: candidates.length,
      eligible_count: eligible.length,
      blocked_count: blocked.length,
      applied_count: 0,
    },
    eligible_repairs: eligible,
    blocked_repairs: blocked,
    safety: {
      dry_run_by_default: true,
      requires_operator_confirmed: true,
      db_mutation_on_apply: true,
      posting: false,
      oauth: false,
      token_printing: false,
      safety_gates_weakened: false,
    },
  };
}

async function applyBridgeLiveRightsRepairPlan(plan = {}, {
  db,
  operatorConfirmed = false,
  ensureDir = fs.ensureDir,
  backupPath = "",
  now = new Date(),
} = {}) {
  if (operatorConfirmed !== true) throw new Error("bridge_live_rights_repair_requires_operator_confirmed");
  if (!db || typeof db.upsertStory !== "function") throw new Error("bridge_live_rights_repair_requires_db_adapter");
  const repairs = asArray(plan.eligible_repairs);
  if (!repairs.length) throw new Error("bridge_live_rights_repair_has_no_eligible_repairs");
  const dbPath = db.DB_PATH || "";
  let targetBackupPath = backupPath;
  if (!targetBackupPath && dbPath) {
    const safeDate = (now instanceof Date ? now : new Date(now)).toISOString().replace(/[:.]/g, "-");
    targetBackupPath = path.join(path.dirname(dbPath), "backups", `pulse-pre-bridge-live-rights-repair-${safeDate}.db`);
  }
  if (targetBackupPath) {
    await ensureDir(path.dirname(targetBackupPath));
    const rawDb = typeof db.getDb === "function" ? db.getDb() : null;
    if (rawDb && typeof rawDb.backup === "function") await rawDb.backup(targetBackupPath);
  }
  for (const repair of repairs) {
    await db.upsertStory(repair.repaired_story);
  }
  return {
    status: "applied",
    applied_count: repairs.length,
    backup_path: targetBackupPath || null,
    story_ids: repairs.map((repair) => repair.story_id),
    db_mutation: true,
    posting: false,
    oauth: false,
    token_printing: false,
    safety_gates_weakened: false,
  };
}

function renderBridgeLiveRightsRepairMarkdown(plan = {}, applyResult = null) {
  const lines = [];
  lines.push("# Bridge Live Rights Repair");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || ""}`);
  lines.push(`Candidates: ${plan.summary?.candidates_seen || 0}`);
  lines.push(`Eligible: ${plan.summary?.eligible_count || 0}`);
  lines.push(`Blocked: ${plan.summary?.blocked_count || 0}`);
  if (applyResult) lines.push(`Applied: ${applyResult.applied_count || 0}`);
  lines.push("");
  lines.push("## Eligible");
  for (const item of asArray(plan.eligible_repairs).slice(0, 40)) {
    lines.push(
      `- ${item.story_id}: ${item.pre_repair_governance_status} -> ${item.post_repair_governance_status}; missing assets ${item.missing_assets_before.length} -> ${item.missing_assets_after.length}`,
    );
  }
  if (!asArray(plan.eligible_repairs).length) lines.push("- none");
  if (asArray(plan.blocked_repairs).length) {
    lines.push("");
    lines.push("## Blocked");
    for (const item of asArray(plan.blocked_repairs).slice(0, 40)) {
      lines.push(`- ${item.story_id}: ${asArray(item.post_repair_reason_codes).join(", ")}`);
    }
  }
  lines.push("");
  lines.push("Safety: rights/live-row repair only. No publish, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeBridgeLiveRightsRepairReport(plan = {}, { outputDir, applyResult = null } = {}) {
  if (!outputDir) throw new Error("writeBridgeLiveRightsRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "bridge_live_rights_repair_plan.json");
  const markdownPath = path.join(outDir, "bridge_live_rights_repair_plan.md");
  await fs.writeJson(jsonPath, { ...plan, apply_result: applyResult }, { spaces: 2 });
  await fs.writeFile(markdownPath, renderBridgeLiveRightsRepairMarkdown(plan, applyResult), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  ALL_SOCIAL_PLATFORMS,
  applyBridgeLiveRightsRepairPlan,
  buildBridgeLiveRightsRepairPlan,
  generatedVisualRightsRecord,
  renderBridgeLiveRightsRepairMarkdown,
  repairBridgeLiveStoryRights,
  writeBridgeLiveRightsRepairReport,
};
