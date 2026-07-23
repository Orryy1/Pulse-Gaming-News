"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const axios = require("axios");
const { classifyOutboundUrl, safeRedirectConfig } = require("./safe-url");

const DEFAULT_MAX_DOWNLOADS_PER_STORY = 6;
const LIVE_PUBLISH_HOLD_CODES = new Set([
  "rights:live_publish_not_allowed",
  "rights:human_legal_review_required_before_publish",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseFocalPoint(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sourceReferencesFromReport(report = {}) {
  const references = [
    ...asArray(report.accepted_references),
    ...asArray(report.accepted_entries),
    ...asArray(report.provenance_ledger),
    ...asArray(report.entries),
    ...asArray(report.sources),
  ].filter((entry) => cleanText(entry.source_type).toLowerCase() === "official_press_kit_stills");
  const byIdentity = new Map();
  for (const reference of references) {
    const sourceUrl = cleanText(
      reference.source_url ||
        reference.direct_media_url_if_available ||
        reference.official_source_url ||
        reference.canonical_source_url,
    ).toLowerCase();
    const key = [
      cleanText(reference.story_id).toLowerCase(),
      sourceUrl || cleanText(reference.source_family).toLowerCase(),
    ].join("|");
    if (!byIdentity.has(key)) byIdentity.set(key, reference);
  }
  return [...byIdentity.values()];
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

function contentTypeFromPath(filePath) {
  const ext = path.extname(cleanText(filePath)).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function pathIsWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readLocalSourceCapture({ root, reference }) {
  const configuredPath = cleanText(
    reference.local_source_path || reference.source_asset_path || reference.captured_asset_path,
  );
  if (!configuredPath) return null;

  const rootPath = await fs.realpath(path.resolve(root));
  const candidatePath = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(rootPath, configuredPath);
  if (!pathIsWithinRoot(rootPath, candidatePath) || !(await fs.pathExists(candidatePath))) {
    return { rejected: true, reason: "official_still_local_source_missing_or_outside_root" };
  }
  const realCandidatePath = await fs.realpath(candidatePath);
  if (!pathIsWithinRoot(rootPath, realCandidatePath)) {
    return { rejected: true, reason: "official_still_local_source_missing_or_outside_root" };
  }
  return {
    buffer: await fs.readFile(realCandidatePath),
    contentType: contentTypeFromPath(realCandidatePath),
    sourceEvidencePath: realCandidatePath,
  };
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
  const localCapture = await readLocalSourceCapture({ root, reference });
  if (localCapture?.rejected) {
    return { status: "rejected", reason: localCapture.reason, source_url: sourceUrl };
  }
  const result = localCapture || await fetchImage(sourceUrl, reference);
  const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || []);
  if (buffer.length < 1024) {
    return { status: "rejected", reason: "official_still_download_too_small", source_url: sourceUrl };
  }
  const expectedSha256 = cleanText(
    reference.source_asset_sha256 || reference.asset_sha256,
  ).toLowerCase();
  const actualSha256 = sha256(buffer);
  if (/^[a-f0-9]{64}$/.test(expectedSha256) && actualSha256 !== expectedSha256) {
    return {
      status: "rejected",
      reason: "official_still_source_hash_mismatch",
      source_url: sourceUrl,
      expected_sha256: expectedSha256,
      actual_sha256: actualSha256,
    };
  }
  const expectedSizeBytes = Number(reference.source_asset_size_bytes || reference.asset_size_bytes);
  if (Number.isFinite(expectedSizeBytes) && expectedSizeBytes > 0 && buffer.length !== expectedSizeBytes) {
    return {
      status: "rejected",
      reason: "official_still_source_size_mismatch",
      source_url: sourceUrl,
      expected_size_bytes: expectedSizeBytes,
      actual_size_bytes: buffer.length,
    };
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
    source_evidence_path: result.sourceEvidencePath || null,
    source_family: sourceFamily,
    sha256: actualSha256,
    size_bytes: buffer.length,
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

async function findFreshGoalContractPackageDir(root, storyId) {
  const goalContractDir = path.join(path.resolve(root), "output", "goal-contract");
  const storyDirName = safeStem(storyId);
  if (!(await fs.pathExists(goalContractDir))) return null;
  const matches = [];
  for (const entry of await fs.readdir(goalContractDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(goalContractDir, entry.name, "packages", storyDirName);
    if (!(await fs.pathExists(candidate))) continue;
    const stat = await fs.stat(candidate);
    matches.push({ path: candidate, mtimeMs: stat.mtimeMs });
  }
  return matches.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path || null;
}

async function resolveArtifactDir(root, storyId) {
  const legacyDir = path.join(path.resolve(root), "output", "goal-proof", "batch", safeStem(storyId));
  if (await fs.pathExists(legacyDir)) return legacyDir;
  return (await findFreshGoalContractPackageDir(root, storyId)) || legacyDir;
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

function normalisedRightsList(value) {
  return asArray(value).map(normaliseKey).filter(Boolean).sort();
}

function normalisedDecisionScalar(value) {
  if (typeof value === "boolean") return value;
  if (value == null) return null;
  return normaliseKey(value);
}

function equivalentOfficialStillRightsDecision(existing = {}, refreshed = {}) {
  const scalarFields = [
    "source_url",
    "licence_basis",
    "allowed_use",
    "commercial_use_allowed",
    "local_materialization_allowed",
    "live_publish_allowed",
    "requires_human_legal_review_before_publish",
    "approval_status",
    "rights_status",
    "required_rules_link",
    "required_public_notice",
  ];
  if (scalarFields.some((field) => (
    normalisedDecisionScalar(existing[field]) !==
      normalisedDecisionScalar(refreshed[field])
  ))) {
    return false;
  }
  if (
    JSON.stringify(normalisedRightsList(existing.allowed_platforms)) !==
      JSON.stringify(normalisedRightsList(refreshed.allowed_platforms)) ||
    JSON.stringify(normalisedRightsList(existing.restricted_platforms)) !==
      JSON.stringify(normalisedRightsList(refreshed.restricted_platforms))
  ) {
    return false;
  }
  return Number(existing.risk_score) === Number(refreshed.risk_score);
}

function rebindEquivalentOfficialStillEvidence(existing = [], additions = []) {
  const byKey = new Map(asArray(existing).map((record) => [recordKey(record), record]));
  for (const refreshed of asArray(additions)) {
    const key = recordKey(refreshed);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, refreshed);
      continue;
    }
    if (!equivalentOfficialStillRightsDecision(current, refreshed)) continue;
    byKey.set(key, {
      ...current,
      evidence_reference: refreshed.evidence_reference,
      evidence_file: refreshed.evidence_file,
      rights_evidence_file: refreshed.rights_evidence_file,
      evidence_sha256: refreshed.evidence_sha256,
      rights_evidence_sha256: refreshed.rights_evidence_sha256,
      evidence_size_bytes: refreshed.evidence_size_bytes,
      rights_evidence_size_bytes: refreshed.rights_evidence_size_bytes,
      evidence_kind: refreshed.evidence_kind,
      focal_point_x: refreshed.focal_point_x,
      focal_point_y: refreshed.focal_point_y,
    });
  }
  return [...byKey.values()];
}

function rightsRecordForOfficialStill({ storyId, reference, downloaded, index }) {
  const sourceFamily = cleanText(downloaded.source_family || reference.source_family) ||
    `official_still_${index + 1}`;
  const assetId = `${safeStem(storyId)}-${safeStem(sourceFamily).toLowerCase()}`;
  const allowedPlatforms = asArray(reference.allowed_platforms).map(cleanText).filter(Boolean);
  const livePublishAllowed = reference.live_publish_allowed === true;
  const requiresHumanLegalReview =
    reference.requires_human_legal_review_before_publish === false
      ? false
      : true;
  return {
    asset_id: assetId,
    id: assetId,
    kind: "visual",
    asset_type: "visual_still",
    type: "official_press_kit_stills",
    path: cleanText(downloaded.path),
    source_url: cleanText(downloaded.source_url || reference.source_url || reference.official_source_url),
    source_evidence_path: cleanText(downloaded.source_evidence_path) || undefined,
    source_owner: cleanText(reference.source_owner || reference.entity || "official source"),
    source_type: "official_press_kit_stills",
    source_family: sourceFamily,
    durationS: Math.max(1.5, Number(reference.durationS || reference.duration_s) || 3),
    focal_point_x: normaliseFocalPoint(
      reference.focal_point_x ?? reference.focalPointX ?? reference.framing?.focal_point_x,
    ),
    focal_point_y: normaliseFocalPoint(
      reference.focal_point_y ?? reference.focalPointY ?? reference.framing?.focal_point_y,
    ),
    licence_basis: cleanText(
      reference.licence_basis ||
        reference.license_basis ||
        "official_press_kit_reference_pending_human_rights_review",
    ),
    allowed_use: cleanText(reference.allowed_use || "local_transformative_editorial_proof"),
    allowed_platforms: allowedPlatforms,
    restricted_platforms: asArray(reference.restricted_platforms).map(cleanText).filter(Boolean),
    platform_restrictions:
      reference.platform_restrictions && typeof reference.platform_restrictions === "object"
        ? structuredClone(reference.platform_restrictions)
        : undefined,
    commercial_use_allowed: reference.commercial_use_allowed === true,
    local_materialization_allowed: reference.local_materialization_allowed !== false,
    live_publish_allowed: livePublishAllowed,
    requires_human_legal_review_before_publish: requiresHumanLegalReview,
    transformation_notes:
      "Official still transformed into a source-labelled Pulse Gaming editorial motion beat; not used as copied competitor output.",
    expiry: null,
    credit_required: false,
    evidence_reference: cleanText(reference.reference_page_url || reference.official_source_url || reference.source_url),
    risk_score: Number.isFinite(Number(reference.risk_score)) ? Number(reference.risk_score) : 0.45,
    approval_status: cleanText(reference.approval_status) || "approved_for_local_materialization_only",
    rights_status:
      cleanText(reference.rights_status) || "official_source_identity_verified_rights_unresolved",
    usage_status: cleanText(reference.usage_status) || undefined,
    required_public_notice: cleanText(reference.required_public_notice) || undefined,
    required_rules_link: cleanText(reference.required_rules_link) || undefined,
    visual_evidence_role: "official_story_still",
    entity: cleanText(reference.entity) || null,
  };
}

async function attachRightsEvidence({ storyId, record, reference, downloaded, generatedAt }) {
  const assetBytes = await fs.readFile(downloaded.path);
  const sidecarPath = `${downloaded.path}.rights.json`;
  await fs.writeJson(sidecarPath, {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: cleanText(storyId) || null,
    asset_id: record.asset_id,
    decision: {
      approval_status: record.approval_status,
      rights_status: record.rights_status || null,
      licence_basis: record.licence_basis,
      allowed_use: record.allowed_use,
      allowed_platforms: record.allowed_platforms,
      restricted_platforms: record.restricted_platforms,
      commercial_use_allowed: record.commercial_use_allowed,
      local_materialization_allowed: record.local_materialization_allowed,
      live_publish_allowed:
        typeof record.live_publish_allowed === "boolean"
          ? record.live_publish_allowed
          : null,
      requires_human_legal_review_before_publish:
        record.requires_human_legal_review_before_publish === true,
      risk_score: record.risk_score,
    },
    source: {
      source_url: record.source_url,
      source_evidence_path: record.source_evidence_path || null,
      reference_page_url: cleanText(reference.reference_page_url) || null,
      source_owner: record.source_owner,
      source_family: record.source_family,
      local_path: downloaded.path,
      sha256: sha256(assetBytes),
      size_bytes: assetBytes.length,
      content_type: downloaded.content_type || null,
      product_page_evidence_path: cleanText(reference.product_page_evidence_path) || null,
      product_page_evidence_sha256: cleanText(reference.product_page_evidence_sha256) || null,
      product_page_evidence_size_bytes: Number(reference.product_page_evidence_size_bytes) || null,
      framing: {
        focal_point_x: record.focal_point_x ?? null,
        focal_point_y: record.focal_point_y ?? null,
      },
    },
    policy: {
      evidence_reference: record.evidence_reference || null,
      required_rules_link: record.required_rules_link || null,
      required_public_notice: record.required_public_notice || null,
      policy_evidence_path: cleanText(reference.policy_evidence_path) || null,
      policy_evidence_sha256: cleanText(reference.policy_evidence_sha256) || null,
      policy_evidence_size_bytes: Number(reference.policy_evidence_size_bytes) || null,
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  }, { spaces: 2 });
  const evidenceBytes = await fs.readFile(sidecarPath);
  return {
    ...record,
    asset_sha256: sha256(assetBytes),
    asset_size_bytes: assetBytes.length,
    evidence_file: sidecarPath,
    rights_evidence_file: sidecarPath,
    evidence_sha256: sha256(evidenceBytes),
    rights_evidence_sha256: sha256(evidenceBytes),
    evidence_size_bytes: evidenceBytes.length,
    rights_evidence_size_bytes: evidenceBytes.length,
    evidence_kind: "hash_bound_official_still_rights_sidecar",
  };
}

async function updatePackageWithOfficialStills({ artifactDir, storyId, references, downloaded, generatedAt }) {
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsLedger = await readJsonIfPresent(rightsPath, {});
  const footageInventory = await readJsonIfPresent(footagePath, {});

  await backupOnce(rightsPath, generatedAt, "official_still_visual_repair");
  await backupOnce(footagePath, generatedAt, "official_still_visual_repair");

  const records = [];
  for (const [index, item] of downloaded.entries()) {
    const record = rightsRecordForOfficialStill({
      storyId,
      reference: references[index] || {},
      downloaded: item,
      index,
    });
    records.push(await attachRightsEvidence({
      storyId,
      record,
      reference: references[index] || {},
      downloaded: item,
      generatedAt,
    }));
  }
  const inheritedHoldFailures = asArray(rightsLedger.failures)
    .map(cleanText)
    .filter((failure) => LIVE_PUBLISH_HOLD_CODES.has(failure));
  const remainingFailures = asArray(rightsLedger.failures).filter((failure) => {
    const code = cleanText(failure);
    return code !== "rights:no_rights_record" && !LIVE_PUBLISH_HOLD_CODES.has(code);
  });
  const publishHoldCodes = [
    ...inheritedHoldFailures,
    ...(records.some((record) => record.live_publish_allowed === false)
      ? ["rights:live_publish_not_allowed"]
      : []),
    ...(records.some((record) => record.requires_human_legal_review_before_publish === true)
      ? ["rights:human_legal_review_required_before_publish"]
      : []),
  ];
  const publishBlockers = [...new Set([
    ...asArray(rightsLedger.publish_blockers).map(cleanText),
    ...publishHoldCodes,
  ].filter(Boolean))];
  const hasPublishHold = publishBlockers.some((blocker) => LIVE_PUBLISH_HOLD_CODES.has(blocker));
  const verdict = remainingFailures.length ? "fail" : hasPublishHold ? "warn" : "pass";
  const updatedRights = {
    ...rightsLedger,
    verdict,
    result: remainingFailures.length ? "FAIL" : hasPublishHold ? "AMBER" : "PASS",
    status: remainingFailures.length
      ? "blocked"
      : hasPublishHold
        ? "local_materialization_only"
        : "ready",
    can_auto_publish: hasPublishHold || remainingFailures.length
      ? false
      : rightsLedger.can_auto_publish,
    not_publishable: hasPublishHold || remainingFailures.length > 0,
    failures: remainingFailures,
    publish_blockers: publishBlockers,
    assets: rebindEquivalentOfficialStillEvidence(rightsLedger.assets, records),
    records: rebindEquivalentOfficialStillEvidence(
      rightsLedger.records || rightsLedger.rights_ledger,
      records,
    ),
    rights_ledger: rebindEquivalentOfficialStillEvidence(
      rightsLedger.rights_ledger || rightsLedger.records,
      records,
    ),
    matched_assets: mergeRecords(rightsLedger.matched_assets, records.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      source_family: record.source_family,
      focal_point_x: record.focal_point_x,
      focal_point_y: record.focal_point_y,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
      live_publish_allowed: record.live_publish_allowed,
      requires_human_legal_review_before_publish:
        record.requires_human_legal_review_before_publish === true,
      evidence_file: record.evidence_file,
      evidence_sha256: record.evidence_sha256,
      evidence_size_bytes: record.evidence_size_bytes,
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
      focal_point_x: record.focal_point_x,
      focal_point_y: record.focal_point_y,
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

async function repairOfficialStillStory({
  root,
  artifactDir: explicitArtifactDir = null,
  storyId,
  references,
  generatedAt,
  minAssets,
  maxDownloadsPerStory,
  fetchImage,
}) {
  const artifactDir = explicitArtifactDir
    ? path.resolve(explicitArtifactDir)
    : await resolveArtifactDir(root, storyId);
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
  artifactDir = null,
  intakeReport = {},
  storyIds = [],
  generatedAt = new Date().toISOString(),
  minAssets = 5,
  maxDownloadsPerStory = DEFAULT_MAX_DOWNLOADS_PER_STORY,
  fetchImage,
} = {}) {
  const grouped = storyReferences(intakeReport, storyIds);
  if (artifactDir && grouped.size !== 1) {
    throw new Error("artifact_dir_requires_exactly_one_story");
  }
  const jobs = [];
  for (const [storyId, references] of grouped.entries()) {
    jobs.push(await repairOfficialStillStory({
      root,
      artifactDir,
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
