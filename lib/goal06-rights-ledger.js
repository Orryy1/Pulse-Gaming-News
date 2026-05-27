"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "06_rights_ledger";
const DEFAULT_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const HIGH_RISK_THRESHOLD = 0.65;
const PROHIBITED_SOURCE_RE =
  /\b(?:copied[_\s-]?competitor|competitor[_\s-]?rip|fan[_\s-]?reupload|random[_\s-]?youtube|youtube[_\s-]?compilation|reaction[_\s-]?video|social[_\s-]?media[_\s-]?repost|unofficial[_\s-]?mirror|browser[_\s-]?scrape)\b/i;
const TRUSTED_LOCAL_RE = /\b(?:owned|local|pulse|generated|tts|voice|sonniss|font|brand|editorial)\b/i;

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return asArray(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return [trimmed];
  }
  if (typeof value === "object") return [value];
  return [];
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseText(value) {
  return cleanText(value)
    .replace(/\\/g, "/")
    .toLowerCase()
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function safeId(value) {
  return cleanText(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
}

function lowerPlatformList(value) {
  return asArray(value)
    .map((item) => normaliseText(item).replace(/^twitter$/, "x"))
    .filter(Boolean);
}

function resolveWorkspacePath(workspaceRoot, value) {
  if (!value) return "";
  const text = String(value);
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function assetKeyParts(item = {}) {
  return [
    item.asset_id,
    item.id,
    item.clip_id,
    item.image_id,
    item.rights_record_id,
    item.path,
    item.local_path,
    item.file,
    item.source_url,
    item.url,
  ].map(cleanText).filter(Boolean);
}

function normaliseAsset(raw = {}, index = 0, fallbackKind = "asset") {
  const asset = typeof raw === "string" ? { path: raw } : raw && typeof raw === "object" ? raw : {};
  const id = cleanText(asset.asset_id || asset.id || asset.clip_id || asset.image_id || asset.rights_record_id);
  const pathValue = cleanText(asset.path || asset.local_path || asset.file || asset.output_path || "");
  const sourceUrl = cleanText(asset.source_url || asset.url || asset.evidence_reference || "");
  const sourceType = cleanText(asset.source_type || asset.type || asset.source || "");
  return {
    ...asset,
    asset_id: id || safeId(pathValue || sourceUrl || `${fallbackKind}_${index + 1}`),
    kind: cleanText(asset.kind || fallbackKind || "asset"),
    path: pathValue,
    source_url: sourceUrl,
    source_type: sourceType,
    rights_risk_class: cleanText(asset.rights_risk_class || asset.rights_status || ""),
  };
}

function normaliseRecord(raw = {}, index = 0) {
  const record = raw && typeof raw === "object" ? raw : {};
  const licenceBasis = cleanText(
    record.licence_basis ||
      record.license_basis ||
      record.rights_basis ||
      record.licence_scope ||
      record.allowed_use ||
      "",
  );
  return {
    ...record,
    asset_id: cleanText(record.asset_id || record.id || record.source_id || record.path) ||
      `rights_record_${index + 1}`,
    kind: cleanText(record.kind || record.asset_type || ""),
    path: cleanText(record.path || record.local_path || record.file || ""),
    source_url: cleanText(record.source_url || record.url || record.evidence_reference || ""),
    source_type: cleanText(record.source_type || record.type || record.source || ""),
    source_owner: cleanText(record.source_owner || record.owner || record.provider_name || ""),
    licence_basis: licenceBasis,
    allowed_platforms: lowerPlatformList(record.allowed_platforms || record.platforms),
    commercial_use_allowed: record.commercial_use_allowed,
    risk_score: Number.isFinite(Number(record.risk_score)) ? Number(record.risk_score) : null,
    evidence_file: cleanText(
      record.evidence_file ||
        record.evidence_reference ||
        record.licence_evidence ||
        record.license_evidence ||
        record.licence_evidence_url ||
        record.permission_evidence ||
        record.permission_evidence_url ||
        "",
    ),
    rights_risk_class: cleanText(record.rights_risk_class || record.rights_status || ""),
    approval_status: cleanText(record.approval_status || ""),
  };
}

function dedupeByKey(rows = [], fallbackKind = "asset") {
  const seen = new Set();
  const out = [];
  rows.forEach((row, index) => {
    const item = fallbackKind === "record" ? normaliseRecord(row, index) : normaliseAsset(row, index, fallbackKind);
    const key = assetKeyParts(item).map(normaliseText).join("|") || `${fallbackKind}_${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function collectLedgerAssets(ledger = {}) {
  return dedupeByKey(
    [
      ...asArray(ledger.assets),
      ...asArray(ledger.missing_assets),
      ...asArray(ledger.matched_assets).map((row) => ({
        asset_id: row.asset_id,
        kind: row.kind,
        path: row.path,
        source_url: row.source_url,
        source_type: row.source_type,
      })),
    ],
    "asset",
  );
}

function collectLedgerRecords(ledger = {}) {
  return dedupeByKey(
    [
      ...asArray(ledger.records),
      ...asArray(ledger.rights_ledger),
      ...asArray(ledger.rights_records),
    ],
    "record",
  );
}

function recordMatchesAsset(record = {}, asset = {}) {
  const recordKeys = assetKeyParts(record).map(normaliseText);
  const assetKeys = assetKeyParts(asset).map(normaliseText);
  return recordKeys.some((key) => key && assetKeys.includes(key));
}

function missingAssetKeys(ledger = {}) {
  return new Set(asArray(ledger.missing_assets).flatMap((asset) => assetKeyParts(asset).map(normaliseText)));
}

function hasEvidence(record = {}) {
  return Boolean(
    cleanText(record.evidence_file) ||
      cleanText(record.permission_evidence) ||
      cleanText(record.licence_evidence_url),
  );
}

function sourceLooksTrusted(record = {}) {
  const text = [
    record.source_type,
    record.source_owner,
    record.source_url,
    record.rights_risk_class,
    record.licence_basis,
    record.approval_status,
  ].map(cleanText).join(" ").replace(/[_-]+/g, " ");
  if (PROHIBITED_SOURCE_RE.test(text)) return false;
  return Boolean(cleanText(record.source_url) || TRUSTED_LOCAL_RE.test(text));
}

function validateRecord(record = {}, targetPlatforms = DEFAULT_PLATFORMS) {
  const blockers = [];
  if (!cleanText(record.asset_id)) blockers.push("rights:asset_id_missing");
  if (!cleanText(record.licence_basis)) blockers.push("rights:licence_basis_missing");
  if (record.commercial_use_allowed !== true) {
    blockers.push(record.commercial_use_allowed === false ? "rights:commercial_use_not_allowed" : "rights:commercial_use_unclear");
  }
  if (!record.allowed_platforms.length) {
    blockers.push("rights:platform_scope_missing");
  } else {
    const missingPlatform = targetPlatforms.find((platform) => !record.allowed_platforms.includes(platform));
    if (missingPlatform) blockers.push("rights:platform_not_allowed");
  }
  if (!hasEvidence(record)) blockers.push("rights:evidence_missing");
  if (Number(record.risk_score) >= HIGH_RISK_THRESHOLD) blockers.push("rights:risk_score_high");
  if (!sourceLooksTrusted(record)) blockers.push("rights:unverified_or_prohibited_source");
  return unique(blockers);
}

function rejectionForAsset({ storyId, asset, blockers, requiredAction }) {
  return {
    story_id: storyId,
    asset_id: asset.asset_id || null,
    kind: asset.kind || null,
    path: asset.path || null,
    source_url: asset.source_url || null,
    source_type: asset.source_type || null,
    reason_codes: unique(blockers),
    required_action: requiredAction,
  };
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const storyId = cleanText(storyPackage.story_id || storyPackage.id);
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir
    ? resolveWorkspacePath(workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir)
    : "";
  const canonical = await readJsonIfPresent(artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : "", {});
  const title = cleanText(storyPackage.title || canonical?.selected_title || canonical?.canonical_title || canonical?.title);
  const rightsPath = artifactDir ? path.join(artifactDir, "rights_ledger.json") : "";
  const ledger = await readJsonIfPresent(rightsPath, null);
  if (!ledger) {
    const blocker = rightsPath ? "rights_ledger_missing" : "artifact_dir_missing";
    return {
      story_id: storyId || "unknown",
      title,
      artifact_dir: artifactDir || null,
      rights_ledger_path: rightsPath || null,
      status: "blocked",
      blockers: [blocker],
      asset_count: 0,
      rights_record_count: 0,
      matched_asset_count: 0,
      missing_asset_count: 0,
      rejected_assets: [
        rejectionForAsset({
          storyId: storyId || "unknown",
          asset: { asset_id: storyId || "unknown", kind: "package", path: rightsPath },
          blockers: [blocker],
          requiredAction: "Generate a rights_ledger.json file for this story package before render or publish readiness can advance.",
        }),
      ],
    };
  }

  const assets = collectLedgerAssets(ledger);
  const records = collectLedgerRecords(ledger);
  const blockers = [];
  const rejectedAssets = [];
  const missingKeys = missingAssetKeys(ledger);
  const declaredMissingCount = Number(ledger.metrics?.missing_asset_count || 0);

  if (cleanText(ledger.verdict).toLowerCase() === "pass" && (declaredMissingCount > 0 || asArray(ledger.missing_assets).length > 0)) {
    blockers.push("rights:stale_pass_with_missing_assets");
  }

  for (const asset of assets) {
    const matchedRecord = records.find((record) => recordMatchesAsset(record, asset));
    const explicitlyMissing = assetKeyParts(asset).map(normaliseText).some((key) => missingKeys.has(key));
    if (!matchedRecord || explicitlyMissing) {
      blockers.push("rights:no_rights_record");
      rejectedAssets.push(
        rejectionForAsset({
          storyId: storyId || "unknown",
          asset,
          blockers: explicitlyMissing
            ? ["rights:no_rights_record", "rights:declared_missing_asset"]
            : ["rights:no_rights_record"],
          requiredAction: "Attach a rights record with licence basis, platform scope, commercial permission and evidence for this asset.",
        }),
      );
    }
  }

  for (const record of records) {
    const recordBlockers = validateRecord(record, options.platforms || DEFAULT_PLATFORMS);
    if (!recordBlockers.length) continue;
    blockers.push(...recordBlockers);
    rejectedAssets.push(
      rejectionForAsset({
        storyId: storyId || "unknown",
        asset: record,
        blockers: recordBlockers,
        requiredAction: "Replace or complete this rights record before it can support public output.",
      }),
    );
  }

  const uniqueBlockers = unique(blockers);
  const matchedAssetCount = assets.filter((asset) => records.some((record) => recordMatchesAsset(record, asset))).length;
  return {
    story_id: storyId || "unknown",
    title,
    artifact_dir: artifactDir || null,
    rights_ledger_path: rightsPath,
    status: uniqueBlockers.length ? "blocked" : "ready",
    blockers: uniqueBlockers,
    ledger_verdict: cleanText(ledger.verdict) || null,
    asset_count: assets.length,
    rights_record_count: records.length,
    matched_asset_count: matchedAssetCount,
    missing_asset_count: asArray(ledger.missing_assets).length || declaredMissingCount || Math.max(0, assets.length - matchedAssetCount),
    rejected_assets: rejectedAssets,
    metrics: {
      original_asset_count: Number(ledger.metrics?.asset_count || assets.length),
      original_rights_record_count: Number(ledger.metrics?.rights_record_count || records.length),
      original_missing_asset_count: declaredMissingCount,
    },
  };
}

function buildRiskReport(report = {}) {
  const stories = asArray(report.stories);
  const blockerCounts = {};
  for (const story of stories) {
    for (const blocker of asArray(story.blockers)) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    verdict: report.verdict || "UNKNOWN",
    target_platforms: report.target_platforms || DEFAULT_PLATFORMS,
    summary: report.summary || {},
    blocker_counts: blockerCounts,
    blocked_stories: stories
      .filter((story) => story.status === "blocked")
      .map((story) => ({
        story_id: story.story_id,
        title: story.title || null,
        blockers: story.blockers || [],
        rights_ledger_path: story.rights_ledger_path || null,
      })),
    human_operator_required: stories.some((story) => asArray(story.blockers).length > 0),
  };
}

function buildAssetRejectionReasons(report = {}) {
  const rejectedAssets = asArray(report.stories).flatMap((story) => asArray(story.rejected_assets));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    rejected_asset_count: rejectedAssets.length,
    rejected_assets: rejectedAssets,
  };
}

function buildRightsLedgerManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    target_platforms: report.target_platforms || DEFAULT_PLATFORMS,
    story_count: report.summary?.story_count || 0,
    ready_story_count: report.summary?.ready_story_count || 0,
    blocked_story_count: report.summary?.blocked_story_count || 0,
    stories: asArray(report.stories).map((story) => ({
      story_id: story.story_id,
      status: story.status,
      rights_ledger_path: story.rights_ledger_path,
      asset_count: story.asset_count,
      rights_record_count: story.rights_record_count,
      matched_asset_count: story.matched_asset_count,
      missing_asset_count: story.missing_asset_count,
      blockers: story.blockers || [],
    })),
    safety: report.safety || {},
  };
}

async function buildGoal06RightsLedger({
  storyPackages = [],
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
  platforms = DEFAULT_PLATFORMS,
} = {}) {
  if (!outputDir) throw new Error("buildGoal06RightsLedger requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const targetPlatforms = lowerPlatformList(platforms.length ? platforms : DEFAULT_PLATFORMS);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(
      await inspectStoryPackage(storyPackage, {
        workspaceRoot,
        outputDir: outDir,
        generatedAt,
        platforms: targetPlatforms,
      }),
    );
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
    target_platforms: targetPlatforms,
    summary: {
      story_count: stories.length,
      ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      asset_count: stories.reduce((sum, story) => sum + Number(story.asset_count || 0), 0),
      rights_record_count: stories.reduce((sum, story) => sum + Number(story.rights_record_count || 0), 0),
      rejected_asset_count: stories.reduce((sum, story) => sum + asArray(story.rejected_assets).length, 0),
    },
    upstream_blockers: {
      goal04_owned_motion_materialiser: "BLOCKED/PARTIAL on operator source input if recorded in campaign status",
      note: "Goal 06 validates rights evidence already present in story packages. It does not create source permissions, publish externally or override upstream motion holds.",
    },
    stories,
    safety: {
      read_only_audit: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.rights_ledger = buildRightsLedgerManifest(report);
  report.rights_risk_report = buildRiskReport(report);
  report.asset_rejection_reasons = buildAssetRejectionReasons(report);
  return report;
}

function renderGoal06RightsLedgerMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 06 Rights Ledger");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Ready: ${report.summary?.ready_story_count || 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Rejected assets: ${report.summary?.rejected_asset_count || 0}`);
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
  lines.push("LOCAL_PROOF only. This audit did not publish, upload, mutate the database, touch OAuth or expose token values.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal06RightsLedger(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal06RightsLedger requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal06_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal06_readiness_report.md");
  const rightsLedger = path.join(outDir, "rights_ledger.json");
  const rightsRiskReport = path.join(outDir, "rights_risk_report.json");
  const assetRejectionReasons = path.join(outDir, "asset_rejection_reasons.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal06RightsLedgerMarkdown(report), "utf8");
  await fs.writeJson(rightsLedger, report.rights_ledger || buildRightsLedgerManifest(report), { spaces: 2 });
  await fs.writeJson(rightsRiskReport, report.rights_risk_report || buildRiskReport(report), { spaces: 2 });
  await fs.writeJson(
    assetRejectionReasons,
    report.asset_rejection_reasons || buildAssetRejectionReasons(report),
    { spaces: 2 },
  );
  return {
    readinessJson,
    readinessMarkdown,
    rightsLedger,
    rightsRiskReport,
    assetRejectionReasons,
  };
}

module.exports = {
  DEFAULT_PLATFORMS,
  buildAssetRejectionReasons,
  buildGoal06RightsLedger,
  buildRightsLedgerManifest,
  buildRiskReport,
  inspectStoryPackage,
  renderGoal06RightsLedgerMarkdown,
  writeGoal06RightsLedger,
};
