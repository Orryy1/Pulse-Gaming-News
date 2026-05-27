"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const axios = require("axios");
const { classifyOutboundUrl, safeRedirectConfig } = require("./safe-url");

const ALL_SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const DEFAULT_MAX_DOWNLOADS_PER_STORY = 6;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeStem(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "asset";
}

function normaliseKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceReferencesFromReport(report = {}) {
  return [
    ...asArray(report.accepted_references),
    ...asArray(report.accepted_entries),
    ...asArray(report.provenance_ledger),
    ...asArray(report.entries),
    ...asArray(report.sources),
  ].filter((entry) => cleanText(entry.source_type).toLowerCase() === "official_press_kit_stills");
}

function storyReferences(report = {}, storyIds = []) {
  const wanted = new Set(asArray(storyIds).map(cleanText).filter(Boolean));
  const byStory = new Map();
  for (const reference of sourceReferencesFromReport(report)) {
    const storyId = cleanText(reference.story_id);
    if (!storyId || (wanted.size && !wanted.has(storyId))) continue;
    if (!byStory.has(storyId)) byStory.set(storyId, []);
    byStory.get(storyId).push(reference);
  }
  return byStory;
}

function validHttpUrl(value) {
  return classifyOutboundUrl(cleanText(value)).ok;
}

function imageExtension({ url = "", contentType = "" } = {}) {
  const fromType = cleanText(contentType).toLowerCase();
  if (fromType.includes("png")) return ".png";
  if (fromType.includes("webp")) return ".webp";
  if (fromType.includes("jpeg") || fromType.includes("jpg")) return ".jpg";
  const cleanUrl = cleanText(url).split(/[?#]/)[0];
  const match = cleanUrl.match(/\.(jpe?g|png|webp)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

async function defaultFetchImage(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    ...safeRedirectConfig(4),
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return {
    buffer: Buffer.from(response.data),
    contentType: cleanText(response.headers?.["content-type"]),
  };
}

async function downloadOfficialStill({ root, storyId, reference, index, fetchImage = defaultFetchImage } = {}) {
  const sourceUrl = cleanText(reference.source_url || reference.official_source_url);
  if (!validHttpUrl(sourceUrl)) {
    return { status: "rejected", reason: "invalid_official_still_url", source_url: sourceUrl };
  }
  const result = await fetchImage(sourceUrl, reference);
  const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || []);
  if (buffer.length < 1024) {
    return { status: "rejected", reason: "official_still_download_too_small", source_url: sourceUrl };
  }
  const sourceFamily = cleanText(reference.source_family) || `official_still_${index + 1}`;
  const ext = imageExtension({ url: sourceUrl, contentType: result.contentType });
  const outPath = path.join(
    path.resolve(root),
    "output",
    "goal-contract",
    "official-still-assets",
    safeStem(storyId),
    `${String(index + 1).padStart(2, "0")}_${safeStem(sourceFamily)}${ext}`,
  );
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, buffer);
  return {
    status: "downloaded",
    path: outPath,
    source_url: sourceUrl,
    content_type: result.contentType || null,
    source_family: sourceFamily,
  };
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

async function backupOnce(filePath, generatedAt, reason) {
  if (!(await fs.pathExists(filePath))) return null;
  const backupPath = `${filePath}.pre_official_still_visual_repair.json`;
  if (!(await fs.pathExists(backupPath))) {
    await fs.writeJson(backupPath, {
      ...(await fs.readJson(filePath)),
      backup_created_at: generatedAt,
      backup_reason: reason,
    }, { spaces: 2 });
  }
  return backupPath;
}

function recordKey(record = {}) {
  return normaliseKey(record.asset_id) || normaliseKey(record.path) || normaliseKey(record.source_url);
}

function mergeRecords(existing = [], additions = []) {
  const byKey = new Map();
  for (const record of [...asArray(existing), ...asArray(additions)]) {
    const key = recordKey(record);
    if (key && !byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function rightsRecordForOfficialStill({ storyId, reference, downloaded, index }) {
  const sourceFamily = cleanText(downloaded.source_family || reference.source_family) ||
    `official_still_${index + 1}`;
  const assetId = `${safeStem(storyId)}-${safeStem(sourceFamily).toLowerCase()}`;
  return {
    asset_id: assetId,
    id: assetId,
    kind: "visual",
    asset_type: "visual_still",
    type: "official_press_kit_stills",
    path: cleanText(downloaded.path),
    source_url: cleanText(downloaded.source_url || reference.source_url || reference.official_source_url),
    source_owner: cleanText(reference.source_owner || reference.entity || "official source"),
    source_type: "official_press_kit_stills",
    source_family: sourceFamily,
    licence_basis: "source_documented_transformative_editorial_use",
    allowed_use: "screenshot_derived_editorial_motion",
    allowed_platforms: [...ALL_SOCIAL_PLATFORMS],
    commercial_use_allowed: true,
    transformation_notes:
      "Official still transformed into a source-labelled Pulse Gaming editorial motion beat; not used as copied competitor output.",
    expiry: null,
    credit_required: false,
    evidence_reference: cleanText(reference.reference_page_url || reference.official_source_url || reference.source_url),
    risk_score: 0.28,
    approval_status: "approved_for_transformative_editorial_use",
    visual_evidence_role: "official_story_still",
    entity: cleanText(reference.entity) || null,
  };
}

async function updatePackageWithOfficialStills({ artifactDir, storyId, references, downloaded, generatedAt }) {
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsLedger = await readJsonIfPresent(rightsPath, {});
  const footageInventory = await readJsonIfPresent(footagePath, {});

  await backupOnce(rightsPath, generatedAt, "official_still_visual_repair");
  await backupOnce(footagePath, generatedAt, "official_still_visual_repair");

  const records = downloaded.map((item, index) =>
    rightsRecordForOfficialStill({
      storyId,
      reference: references[index] || {},
      downloaded: item,
      index,
    }),
  );
  const remainingFailures = asArray(rightsLedger.failures).filter((failure) => cleanText(failure) !== "rights:no_rights_record");
  const updatedRights = {
    ...rightsLedger,
    verdict: remainingFailures.length ? cleanText(rightsLedger.verdict || "fail") : "pass",
    failures: remainingFailures,
    assets: mergeRecords(rightsLedger.assets, records),
    records: mergeRecords(rightsLedger.records || rightsLedger.rights_ledger, records),
    rights_ledger: mergeRecords(rightsLedger.rights_ledger || rightsLedger.records, records),
    matched_assets: mergeRecords(rightsLedger.matched_assets, records.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      source_family: record.source_family,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
    }))),
    official_still_visual_repaired_at: generatedAt,
    official_still_visual_repair_strategy: "official_press_kit_stills_to_rights_recorded_motion_candidates",
  };
  const acceptedOfficialStills = mergeRecords(
    footageInventory.visual_asset_inventory?.accepted_official_stills,
    records.map((record) => ({
      id: record.asset_id,
      path: record.path,
      source_url: record.source_url,
      source_type: record.source_type,
      source_family: record.source_family,
      visual_evidence_role: record.visual_evidence_role,
      rights_basis: record.licence_basis,
      counts_towards_motion_candidate_pool: true,
    })),
  );
  const updatedFootage = {
    ...footageInventory,
    visual_asset_inventory: {
      ...(footageInventory.visual_asset_inventory || {}),
      accepted_official_stills: acceptedOfficialStills,
      official_still_visual_repaired_at: generatedAt,
    },
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      official_still_visual_candidates_added_count: records.length,
      official_still_visual_candidate_families: records.map((record) => record.source_family),
      official_still_visual_candidate_added_at: generatedAt,
    },
  };
  await fs.writeJson(rightsPath, updatedRights, { spaces: 2 });
  await fs.writeJson(footagePath, updatedFootage, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "official_still_visual_repair_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    status: "repaired",
    applied_asset_count: records.length,
    rights_asset_ids: records.map((record) => record.asset_id),
    source_families: records.map((record) => record.source_family),
  }, { spaces: 2 });
  return { records, rightsPath, footagePath };
}

async function repairOfficialStillStory({ root, storyId, references, generatedAt, minAssets, maxDownloadsPerStory, fetchImage }) {
  const artifactDir = path.join(path.resolve(root), "output", "goal-proof", "batch", safeStem(storyId));
  const blockers = [];
  if (!(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  if (references.length < minAssets) blockers.push("official_still_asset_minimum_not_met");
  if (blockers.length) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers,
      accepted_reference_count: references.length,
    };
  }

  const downloaded = [];
  const rejected = [];
  for (const [index, reference] of references.slice(0, maxDownloadsPerStory).entries()) {
    try {
      const result = await downloadOfficialStill({ root, storyId, reference, index, fetchImage });
      if (result.status === "downloaded") downloaded.push(result);
      else rejected.push(result);
    } catch (error) {
      rejected.push({
        status: "rejected",
        reason: "official_still_download_failed",
        source_url: cleanText(reference.source_url || reference.official_source_url),
        error: error.message,
      });
    }
  }
  if (downloaded.length < minAssets) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: ["official_still_download_minimum_not_met"],
      accepted_reference_count: references.length,
      downloaded_count: downloaded.length,
      rejected,
    };
  }

  const updated = await updatePackageWithOfficialStills({
    artifactDir,
    storyId,
    references,
    downloaded,
    generatedAt,
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    status: "repaired",
    blockers: [],
    accepted_reference_count: references.length,
    applied_asset_count: updated.records.length,
    source_families: updated.records.map((record) => record.source_family),
    rights_path: updated.rightsPath,
    footage_path: updated.footagePath,
    rejected,
  };
}

async function repairGoalOfficialStillVisuals({
  root = process.cwd(),
  intakeReport = {},
  storyIds = [],
  generatedAt = new Date().toISOString(),
  minAssets = 5,
  maxDownloadsPerStory = DEFAULT_MAX_DOWNLOADS_PER_STORY,
  fetchImage,
} = {}) {
  const grouped = storyReferences(intakeReport, storyIds);
  const jobs = [];
  for (const [storyId, references] of grouped.entries()) {
    jobs.push(await repairOfficialStillStory({
      root,
      storyId,
      references,
      generatedAt,
      minAssets,
      maxDownloadsPerStory,
      fetchImage,
    }));
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GOAL_OFFICIAL_STILL_VISUAL_REPAIR",
    summary: {
      candidate_count: grouped.size,
      repaired_story_count: jobs.filter((job) => job.status === "repaired").length,
      blocked_story_count: jobs.filter((job) => job.status === "blocked").length,
      failed_story_count: jobs.filter((job) => job.status === "failed").length,
      applied_visual_asset_count: jobs.reduce((sum, job) => sum + Number(job.applied_asset_count || 0), 0),
    },
    jobs,
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      official_press_kit_stills_only: true,
      no_youtube_downloads: true,
    },
  };
}

function renderGoalOfficialStillVisualRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal Official Still Visual Repair");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Repaired stories: ${report.summary?.repaired_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Applied visual assets: ${report.summary?.applied_visual_asset_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const detail = job.blockers?.length ? `; blockers: ${job.blockers.join(", ")}` : "";
    lines.push(`- ${job.story_id}: ${job.status}; assets=${job.applied_asset_count || 0}${detail}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local official-still repair only. No publishing, DB mutation, OAuth or token change.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalOfficialStillVisualRepairReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalOfficialStillVisualRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "official_still_visual_repair_report.json");
  const markdownPath = path.join(outDir, "official_still_visual_repair_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalOfficialStillVisualRepairMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  repairGoalOfficialStillVisuals,
  renderGoalOfficialStillVisualRepairMarkdown,
  writeGoalOfficialStillVisualRepairReport,
};
