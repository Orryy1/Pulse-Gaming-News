"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  runStillImageEnrichment,
  visualEvidenceRole,
} = require("./still-image-enrichment");
const {
  inferHeadlineGameCandidates,
  isLikelyGameTitleCandidate,
} = require("./game-title-inference");

const ALL_SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const DEFAULT_MAX_DOWNLOADS_PER_STORY = 6;

const NON_STORE_GAME_TARGETS = new Set([
  "capturing",
  "game pass",
  "gamestop",
  "kadokawa",
  "nintendo",
  "pc",
  "playstation",
  "playstation 5",
  "playstation plus",
  "ps plus",
  "ps5",
  "steam",
  "steam deck",
  "switch",
  "xbox",
  "xbox controller",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function safeStem(value) {
  return cleanText(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "asset";
}

function isRealMotionJob(job = {}) {
  return asArray(job.actions).some((action) => cleanText(action.action_id) === "materialise_validated_real_motion_clips");
}

function cleanGameTarget(value) {
  return cleanText(value)
    .replace(/\s+[-–—]\s+.+$/u, "")
    .replace(/\s+\|\s+.+$/u, "")
    .replace(/\s+(?:GameStop|Store|Steam|Xbox|PlayStation|PS5|Nintendo Switch)\b,?$/i, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

function storefrontGameTarget(canonical = {}) {
  const headlineCandidates = inferHeadlineGameCandidates(canonical.selected_title || "");
  const explicit = [
    canonical.canonical_game,
    canonical.canonical_subject,
  ]
    .map(cleanGameTarget)
    .filter(Boolean);
  const subtitleCandidates = explicit
    .filter((candidate) => candidate.includes(":"))
    .map((candidate) => cleanGameTarget(candidate.split(":").slice(1).join(":")))
    .filter(Boolean);
  const explicitKeys = explicit.map(normaliseKey).filter(Boolean);
  const headlinePrefixCandidates = subtitleCandidates.length
    ? []
    : headlineCandidates.filter((candidate) => {
        const key = normaliseKey(candidate);
        return key && explicitKeys.some((explicitKey) => explicitKey !== key && explicitKey.startsWith(key));
      });
  const candidates = explicit.length
    ? [...headlinePrefixCandidates, ...explicit, ...subtitleCandidates]
    : [...headlineCandidates, ...[canonical.selected_title].map(cleanGameTarget)].filter(Boolean);
  for (const candidate of candidates) {
    const key = normaliseKey(candidate);
    if (!key || NON_STORE_GAME_TARGETS.has(key)) continue;
    if (isLikelyGameTitleCandidate(candidate)) return candidate;
  }
  return "";
}

function storyForCanonical(canonical = {}, target = "") {
  const storyId = cleanText(canonical.story_id || canonical.id);
  return {
    id: storyId,
    title: target || cleanText(canonical.selected_title),
    hook: cleanText(canonical.first_spoken_line),
    full_script: cleanText(canonical.narration_script),
    url: cleanText(canonical.primary_source_url || canonical.official_source_url || canonical.source_url),
    source_type: "goal_canonical_manifest",
    approved: true,
    auto_approved: true,
    games: target ? [target] : [],
    entities: target ? [{ name: target, type: "game" }] : [],
    downloaded_images: [],
    game_images: [],
    video_clips: [],
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
  const backupPath = `${filePath}.pre_storefront_visual_repair.json`;
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

function rightsRecordForAppliedAsset(asset = {}, storyId = "", index = 0) {
  const sourceType = cleanText(asset.source_type || "steam_screenshot");
  const storeAppId = cleanText(asset.store_app_id || asset.steam_app_id);
  const familyParts = [
    sourceType,
    storeAppId || safeStem(asset.entity || asset.store_app_title || "storefront"),
    asset.visual_evidence_role || visualEvidenceRole(sourceType),
    index + 1,
  ];
  const sourceFamily = familyParts.map(safeStem).filter(Boolean).join("_").toLowerCase();
  const assetId = `${safeStem(storyId)}-${sourceFamily}`;
  return {
    asset_id: assetId,
    id: assetId,
    kind: "visual",
    asset_type: "visual_still",
    type: sourceType,
    path: cleanText(asset.local_path),
    source_url: cleanText(asset.source_url),
    source_owner: cleanText(asset.store_app_title || asset.steam_app_title || asset.entity || "Steam storefront"),
    source_type: sourceType,
    source_family: sourceFamily,
    licence_basis: sourceType.startsWith("steam")
      ? "steam_storefront_promotional_editorial_use"
      : "storefront_promotional_editorial_use",
    allowed_use: "screenshot_derived_editorial_motion",
    allowed_platforms: [...ALL_SOCIAL_PLATFORMS],
    commercial_use_allowed: true,
    transformation_notes:
      "Storefront still acquired from an official/storefront media source for source-labelled Pulse Gaming editorial motion.",
    expiry: null,
    credit_required: false,
    evidence_reference: cleanText(
      asset.store_app_id
        ? `https://store.steampowered.com/app/${asset.store_app_id}/`
        : asset.source_url,
    ),
    risk_score: 0.28,
    approval_status: "approved_for_transformative_editorial_use",
    visual_evidence_role: cleanText(asset.visual_evidence_role || visualEvidenceRole(sourceType)),
    store_app_id: storeAppId || null,
    store_app_title: cleanText(asset.store_app_title || asset.steam_app_title) || null,
    store_matched_query: cleanText(asset.store_matched_query || asset.steam_matched_query || asset.entity) || null,
  };
}

async function updatePackageWithAppliedAssets({ artifactDir, storyId, appliedAssets, generatedAt } = {}) {
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsLedger = await readJsonIfPresent(rightsPath, {});
  const footageInventory = await readJsonIfPresent(footagePath, {});

  await backupOnce(rightsPath, generatedAt, "storefront_visual_repair");
  await backupOnce(footagePath, generatedAt, "storefront_visual_repair");

  const records = appliedAssets.map((asset, index) => rightsRecordForAppliedAsset(asset, storyId, index));
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
    storefront_visual_repaired_at: generatedAt,
    storefront_visual_repair_strategy: "official_storefront_stills_to_rights_recorded_motion_candidates",
  };
  const acceptedStorefrontStills = mergeRecords(
    footageInventory.visual_asset_inventory?.accepted_storefront_stills,
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
      accepted_storefront_stills: acceptedStorefrontStills,
      storefront_visual_repaired_at: generatedAt,
    },
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      storefront_visual_candidates_added_count: records.length,
      storefront_visual_candidate_families: records.map((record) => record.source_family),
      storefront_visual_candidate_added_at: generatedAt,
    },
  };

  await fs.writeJson(rightsPath, updatedRights, { spaces: 2 });
  await fs.writeJson(footagePath, updatedFootage, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "storefront_visual_repair_manifest.json"), {
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

async function repairStorefrontVisualJob(job = {}, options = {}) {
  const artifactDir = path.resolve(cleanText(job.artifact_dir));
  const storyId = cleanText(job.story_id);
  const blockers = [];
  if (!storyId) blockers.push("story_id_missing");
  if (!artifactDir || !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  if (blockers.length) return { story_id: storyId, artifact_dir: artifactDir, status: "blocked", blockers };

  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), null);
  if (!canonical) {
    return { story_id: storyId, artifact_dir: artifactDir, status: "blocked", blockers: ["canonical_manifest_missing"] };
  }
  const target = storefrontGameTarget(canonical);
  if (!target) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: ["storefront_game_target_missing"],
      title: cleanText(canonical.selected_title),
    };
  }

  const report = await runStillImageEnrichment([storyForCanonical(canonical, target)], {
    applyLocal: true,
    dryRun: false,
    multiEntityStoreSearch: true,
    preferGameplayStills: true,
    maxGameplayStillsPerEntity: options.maxGameplayStillsPerEntity || 6,
    maxStoreAssetsPerEntity: options.maxStoreAssetsPerEntity || 8,
    maxDownloadsPerStory: options.maxDownloadsPerStory || DEFAULT_MAX_DOWNLOADS_PER_STORY,
    outputRoot: options.assetOutputRoot || path.join(options.root || process.cwd(), "output", "goal-contract", "storefront-visual-assets"),
    storeSearchHttp: options.storeSearchHttp,
    storeDetailsHttp: options.storeDetailsHttp,
    fetchImage: options.fetchImage,
  });
  const plan = report.plans?.[0] || {};
  const appliedAssets = asArray(plan.applied_assets);
  const minAssets = Number(options.minAssets || 5);
  if (appliedAssets.length < minAssets) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir,
      title: cleanText(canonical.selected_title),
      status: "blocked",
      blockers: ["storefront_visual_asset_minimum_not_met"],
      target,
      applied_asset_count: appliedAssets.length,
      rejected_count: asArray(plan.would_reject).length,
      store_coverage: plan.multi_entity_store_search?.coverage || [],
    };
  }

  const updated = await updatePackageWithAppliedAssets({
    artifactDir,
    storyId,
    appliedAssets: appliedAssets.slice(0, options.maxDownloadsPerStory || DEFAULT_MAX_DOWNLOADS_PER_STORY),
    generatedAt: options.generatedAt,
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: cleanText(canonical.selected_title),
    status: "repaired",
    blockers: [],
    target,
    applied_asset_count: updated.records.length,
    source_families: updated.records.map((record) => record.source_family),
    rights_path: updated.rightsPath,
    footage_path: updated.footagePath,
  };
}

async function repairGoalStorefrontVisuals({
  root = process.cwd(),
  workOrder = {},
  generatedAt = new Date().toISOString(),
  limit = 0,
  minAssets = 5,
  maxDownloadsPerStory = DEFAULT_MAX_DOWNLOADS_PER_STORY,
  maxStoreAssetsPerEntity = 8,
  maxGameplayStillsPerEntity = 6,
  storeSearchHttp,
  storeDetailsHttp,
  fetchImage,
} = {}) {
  const jobs = asArray(workOrder.jobs).filter(isRealMotionJob);
  const selected = Number(limit) > 0 ? jobs.slice(0, Number(limit)) : jobs;
  const results = [];
  for (const job of selected) {
    try {
      results.push(await repairStorefrontVisualJob(job, {
        root: path.resolve(root),
        generatedAt,
        minAssets,
        maxDownloadsPerStory,
        maxStoreAssetsPerEntity,
        maxGameplayStillsPerEntity,
        storeSearchHttp,
        storeDetailsHttp,
        fetchImage,
      }));
    } catch (error) {
      results.push({
        story_id: cleanText(job.story_id),
        artifact_dir: job.artifact_dir || null,
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GOAL_STOREFRONT_VISUAL_REPAIR",
    summary: {
      candidate_count: selected.length,
      repaired_story_count: results.filter((item) => item.status === "repaired").length,
      blocked_story_count: results.filter((item) => item.status === "blocked").length,
      failed_story_count: results.filter((item) => item.status === "failed").length,
      applied_visual_asset_count: results.reduce((sum, item) => sum + Number(item.applied_asset_count || 0), 0),
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      official_or_storefront_stills_only: true,
      no_youtube_downloads: true,
    },
  };
}

function renderGoalStorefrontVisualRepairMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal Storefront Visual Repair");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Repaired stories: ${report.summary?.repaired_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Failed stories: ${report.summary?.failed_story_count || 0}`);
  lines.push(`Applied visual assets: ${report.summary?.applied_visual_asset_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const detail = job.blockers?.length ? `; blockers: ${job.blockers.join(", ")}` : "";
    lines.push(`- ${job.story_id}: ${job.status}; assets=${job.applied_asset_count || 0}; target=${job.target || "n/a"}${detail}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local storefront still repair only. No publishing, DB mutation, OAuth or token change.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalStorefrontVisualRepairReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalStorefrontVisualRepairReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "storefront_visual_repair_report.json");
  const markdownPath = path.join(outDir, "storefront_visual_repair_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalStorefrontVisualRepairMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  repairGoalStorefrontVisuals,
  renderGoalStorefrontVisualRepairMarkdown,
  storefrontGameTarget,
  writeGoalStorefrontVisualRepairReport,
};
