"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  editorialSfxScore,
  minimumScoreForRole,
} = require("./studio/v4/sfx-source-registry");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const ACTIVE_RENDER_SFX_TARGET_KINDS = new Set([
  "context_caveat",
  "hook_slam",
  "motion_clip",
  "pattern_interrupt",
  "price_snap",
  "proof_card",
  "source_lock",
  "review_score_card",
  "steam_chart",
]);

const ROLE_BY_CUE_FAMILY = {
  boom: "sub_hit",
  cash_snap: "impact",
  chart_tick: "ui_tick",
  glitch: "glitch",
  impact: "impact",
  reveal: "riser",
  riser: "riser",
  source_tick: "ui_tick",
  sub_hit: "sub_hit",
  tick: "ui_tick",
  transition_hit: "transition",
  whoosh: "transition",
};

function normaliseCueToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function normalisePlan(sourcePlan = {}) {
  return {
    ...sourcePlan,
    selected_assets: asArray(sourcePlan.selected_assets),
    readiness: {
      status: cleanText(sourcePlan.readiness?.status || "blocked"),
      blockers: asArray(sourcePlan.readiness?.blockers),
      warnings: asArray(sourcePlan.readiness?.warnings),
    },
  };
}

function packageEntriesFromStoryPackages(storyPackages = []) {
  return asArray(storyPackages)
    .map((entry) => ({
      story_id: cleanText(entry.story_id || entry.id),
      artifact_dir: cleanText(entry.artifact_dir || entry.acceptance_entry?.artifact_dir || entry.artifacts?.artifact_dir),
    }))
    .filter((entry) => entry.story_id && entry.artifact_dir);
}

async function discoverPackageEntries({ root = process.cwd(), storyPackagesPath = null, packageRoot = null } = {}) {
  const packageManifestPath = storyPackagesPath
    ? path.resolve(root, storyPackagesPath)
    : path.join(root, "output", "goal-contract", "story-packages.json");
  const storyPackages = await readJsonIfPresent(packageManifestPath, null);
  if (Array.isArray(storyPackages)) return packageEntriesFromStoryPackages(storyPackages);

  const dir = packageRoot ? path.resolve(root, packageRoot) : path.join(root, "output", "goal-proof", "batch");
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      story_id: entry.name,
      artifact_dir: path.join(dir, entry.name),
    }));
}

function mergeRightsRecords(existing = {}, sfxRights = {}) {
  const existingRecords = Array.isArray(existing)
    ? existing
    : asArray(existing.records);
  const byId = new Map(
    existingRecords.map((record) => [cleanText(record.asset_id || record.id || record.path || record.source_url), record]),
  );
  for (const record of asArray(sfxRights.records || sfxRights)) {
    const key = cleanText(record.asset_id || record.id || record.path || record.source_url);
    if (!key || byId.has(key)) continue;
    byId.set(key, record);
  }
  return {
    ...(Array.isArray(existing) ? {} : existing),
    records: Array.from(byId.values()),
  };
}

function selectedSfxRightsRecords(selectedAssets = [], sfxRights = {}) {
  const selectedIds = new Set(
    asArray(selectedAssets)
      .map((asset) => cleanText(asset.asset_id || asset.id))
      .filter(Boolean),
  );
  const selectedSources = new Set(
    asArray(selectedAssets)
      .map((asset) => cleanText(asset.source_url || asset.path || asset.file_path))
      .filter(Boolean),
  );
  const rightsRecords = asArray(sfxRights.records || sfxRights);
  const matched = rightsRecords.filter((record) => {
    const id = cleanText(record.asset_id || record.id);
    const source = cleanText(record.source_url || record.path || record.file_path);
    return (id && selectedIds.has(id)) || (source && selectedSources.has(source));
  });
  const matchedIds = new Set(matched.map((record) => cleanText(record.asset_id || record.id)).filter(Boolean));
  const fallbackRecords = asArray(selectedAssets)
    .filter((asset) => {
      const id = cleanText(asset.asset_id || asset.id);
      return id && !matchedIds.has(id);
    })
    .map((asset) => ({
      asset_id: cleanText(asset.asset_id || asset.id),
      asset_type: "sfx",
      role: roleForAsset(asset),
      family: cleanText(asset.family || asset.category || roleForAsset(asset)),
      provider_id: cleanText(asset.provider_id || asset.provider),
      source_url: cleanText(asset.source_url || asset.path || asset.file_path),
      licence_basis: cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis),
      rights_basis: cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis),
      evidence_reference: cleanText(asset.licence_evidence_url || asset.evidence_reference),
      commercial_use_allowed: asset.commercial_use_allowed !== false,
      approval_status: cleanText(asset.approval_status || "approved_for_commercial_editorial_use"),
      raw_redistribution_allowed: false,
    }));
  return [...matched, ...fallbackRecords];
}

function pruneUnselectedSfxRights(existing = {}, selectedAssets = []) {
  const selectedIds = new Set(
    asArray(selectedAssets)
      .map((asset) => cleanText(asset.asset_id || asset.id))
      .filter(Boolean),
  );
  const existingRecords = Array.isArray(existing)
    ? existing
    : asArray(existing.records);
  const records = existingRecords.filter((record) => {
    const type = cleanText(record.asset_type || record.type || record.media_kind).toLowerCase();
    const role = cleanText(record.role || record.sfx_role || record.family).toLowerCase();
    const id = cleanText(record.asset_id || record.id);
    const isSfxRecord = type === "sfx" || ["impact", "transition", "riser", "ui_tick", "sub_hit", "glitch"].includes(role);
    return !isSfxRecord || selectedIds.has(id);
  });
  return Array.isArray(existing) ? records : { ...existing, records };
}

function selectedAssetIds(value = {}) {
  return asArray(value.selected_assets || value.source_plan?.selected_assets)
    .map((asset) => cleanText(asset.asset_id || asset.id))
    .filter(Boolean)
    .sort();
}

function sameSelectedAssets(a = {}, b = {}) {
  const left = selectedAssetIds(a);
  const right = selectedAssetIds(b);
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function rightsRecordKeys(value = {}) {
  const records = Array.isArray(value) ? value : asArray(value.records);
  return records
    .map((record) => [
      cleanText(record.asset_id || record.id),
      cleanText(record.asset_type || record.type),
      cleanText(record.role || record.sfx_role),
      cleanText(record.source_url || record.path || record.file_path),
    ].join("|"))
    .sort();
}

function sameRightsRecords(a = {}, b = {}) {
  const left = rightsRecordKeys(a);
  const right = rightsRecordKeys(b);
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index]);
}

function stableVariantIndex(value = "", modulo = 1) {
  if (modulo <= 1) return 0;
  const digest = crypto.createHash("sha1").update(cleanText(value)).digest("hex").slice(0, 8);
  return parseInt(digest, 16) % modulo;
}

function selectedSfxSignature(selectedAssets = []) {
  return asArray(selectedAssets)
    .map((asset) => {
      const role = roleForAsset(asset);
      const id = cleanText(asset.asset_id || asset.id || asset.source_url || asset.path || asset.file_path);
      return role && id ? `${role}:${id}` : id;
    })
    .filter(Boolean)
    .sort()
    .join("|");
}

function roleForAsset(asset = {}) {
  return cleanText(asset.role || asset.sfx_role || asset.family || asset.category);
}

function roleForCue(cue = {}) {
  const directRole = normaliseCueToken(cue.role || cue.sfx_role || cue.sfxRole);
  if (directRole) return ROLE_BY_CUE_FAMILY[directRole] || directRole;
  const family = normaliseCueToken(cue.family || cue.category || cue.sound_family || cue.soundFamily);
  return ROLE_BY_CUE_FAMILY[family] || family;
}

function directorSfxCues(director = {}) {
  return [
    ...asArray(director.sound_transition_plan?.sfx?.cues),
    ...asArray(director.sfx_plan?.cues),
    ...asArray(director.soundTransitionPlan?.sfx?.cues),
  ];
}

function activeRenderRequiredRolesFromDirector(director = {}) {
  const roles = directorSfxCues(director)
    .filter((cue) => {
      const targetKind = normaliseCueToken(cue.target_kind || cue.targetKind || cue.kind);
      return ACTIVE_RENDER_SFX_TARGET_KINDS.has(targetKind);
    })
    .map(roleForCue)
    .filter(Boolean);
  return Array.from(new Set(roles)).sort();
}

function filterSourcePlanBlockersForRequiredRoles(blockers = [], requiredRoles = []) {
  const required = new Set(asArray(requiredRoles).map(cleanText).filter(Boolean));
  return asArray(blockers).filter((blocker) => {
    const text = cleanText(blocker);
    const match = text.match(/^sfx_source:missing_role:(.+)$/);
    return !match || required.has(cleanText(match[1]));
  });
}

function normaliseSfxAsset(asset = {}) {
  const rightsBasis = cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis);
  const role = roleForAsset(asset);
  const computedEditorialScore = editorialSfxScore(asset, null, role);
  const suppliedEditorialScore = Number(asset.editorial_sfx_score);
  const editorialScore = Number.isFinite(suppliedEditorialScore)
    ? Math.min(suppliedEditorialScore, computedEditorialScore)
    : computedEditorialScore;
  return {
    asset_id: cleanText(asset.asset_id || asset.id),
    role,
    family: cleanText(asset.family || asset.category || role),
    provider_id: cleanText(asset.provider_id || asset.provider),
    provider_name: cleanText(asset.provider_name || asset.source_owner),
    source_url: cleanText(asset.source_url || asset.path || asset.file_path),
    rights_basis: rightsBasis,
    licence_evidence_url: cleanText(asset.licence_evidence_url || asset.evidence_reference),
    quality_tier: cleanText(asset.quality_tier || "creator_studio"),
    editorial_sfx_score: editorialScore,
    commercial_use_allowed: asset.commercial_use_allowed !== false,
    approval_status: cleanText(asset.approval_status || "approved_for_commercial_editorial_use"),
  };
}

function isApprovedSfxAsset(asset = {}) {
  const text = [
    asset.approval_status,
    asset.rights_basis,
    asset.licence_basis,
    asset.license_basis,
    asset.allowed_use,
  ].map(cleanText).join(" ").toLowerCase();
  if (asset.commercial_use_allowed === false) return false;
  return /approved|licensed|commercial|media_license|subscription_license|bundle_license/.test(text);
}

function passesRoleEditorialFloor(asset = {}) {
  const role = roleForAsset(asset);
  if (!role) return false;
  const score = Number(asset.editorial_sfx_score ?? editorialSfxScore(asset, null, role));
  return Number.isFinite(score) && score >= minimumScoreForRole(role);
}

function buildStoryVariantSourcePlan({
  storyId = "",
  sourcePlan = {},
  sfxRightsLedger = {},
  requiredRoles: suppliedRequiredRoles = [],
  avoidSignatures = new Set(),
} = {}) {
  const base = normalisePlan(sourcePlan);
  const records = asArray(sfxRightsLedger.records || sfxRightsLedger)
    .map(normaliseSfxAsset)
    .filter((asset) => asset.asset_id && asset.role && isApprovedSfxAsset(asset) && passesRoleEditorialFloor(asset));
  const requiredRoles = asArray(suppliedRequiredRoles).length
    ? asArray(suppliedRequiredRoles).map(cleanText)
    : asArray(base.required_roles).length
    ? asArray(base.required_roles).map(cleanText)
    : Array.from(new Set(asArray(base.selected_assets).map(roleForAsset).filter(Boolean)));
  const selectedByRole = new Map(asArray(base.selected_assets).map((asset) => {
    const normalised = normaliseSfxAsset(asset);
    return [roleForAsset(normalised), normalised];
  }));
  let selected = [];
  const candidatePoolSizeByRole = {};
  const candidatePoolsByRole = new Map();
  const skippedStaleFallbackRoles = [];
  const fallbackRoles = [];
  let collisionAvoided = false;

  for (const role of requiredRoles) {
    const rankedCandidates = records
      .filter((asset) => asset.role === role)
      .sort((a, b) =>
        b.editorial_sfx_score - a.editorial_sfx_score ||
        a.asset_id.localeCompare(b.asset_id),
      );
    const topScore = Number(rankedCandidates[0]?.editorial_sfx_score || 0);
    const topTierFloor = Math.max(minimumScoreForRole(role), topScore - 0.14);
    const candidates = rankedCandidates
      .filter((asset) => Number(asset.editorial_sfx_score || 0) >= topTierFloor)
      .slice(0, 5);
    candidatePoolSizeByRole[role] = candidates.length;
    candidatePoolsByRole.set(role, candidates);
    if (candidates.length) {
      selected.push(candidates[stableVariantIndex(`${storyId}:${role}`, candidates.length)]);
    } else if (selectedByRole.has(role)) {
      const fallback = selectedByRole.get(role);
      if (fallback && isApprovedSfxAsset(fallback) && passesRoleEditorialFloor(fallback)) {
        selected.push(fallback);
        fallbackRoles.push(role);
      } else {
        skippedStaleFallbackRoles.push(role);
      }
    }
  }
  let selectedSignature = selectedSfxSignature(selected);
  if (selectedSignature && avoidSignatures.has(selectedSignature)) {
    for (const role of requiredRoles) {
      const candidates = candidatePoolsByRole.get(role) || [];
      if (candidates.length <= 1) continue;
      const currentIndex = selected.findIndex((asset) => roleForAsset(asset) === role);
      if (currentIndex < 0) continue;
      const currentId = cleanText(selected[currentIndex].asset_id || selected[currentIndex].id);
      const baseIndex = Math.max(0, candidates.findIndex((asset) => cleanText(asset.asset_id || asset.id) === currentId));
      for (let offset = 1; offset < candidates.length; offset += 1) {
        const trial = selected.slice();
        trial[currentIndex] = candidates[(baseIndex + offset) % candidates.length];
        const trialSignature = selectedSfxSignature(trial);
        if (trialSignature && !avoidSignatures.has(trialSignature)) {
          selected = trial;
          selectedSignature = trialSignature;
          collisionAvoided = true;
          break;
        }
      }
      if (collisionAvoided) break;
    }
  }
  const coveredRoles = Array.from(new Set(selected.map((asset) => asset.role))).sort();
  const missingRoles = requiredRoles.filter((role) => !coveredRoles.includes(role));
  const blockers = [
    ...filterSourcePlanBlockersForRequiredRoles(base.readiness?.blockers, requiredRoles),
    ...missingRoles.map((role) => `sfx_source:missing_role:${role}`),
  ];
  const warnings = [
    ...asArray(base.readiness?.warnings),
    ...fallbackRoles.map((role) => `sfx_source:fallback_asset_used:${role}`),
    ...skippedStaleFallbackRoles.map((role) => `sfx_source:stale_selected_asset_rejected:${role}`),
  ];

  return {
    ...base,
    required_roles: requiredRoles,
    selected_assets: selected,
    covered_roles: coveredRoles,
    anti_repetition: {
      variant_source: "story_id_hash",
      candidate_pool_size_by_role: candidatePoolSizeByRole,
      selected_signature: selectedSignature,
      collision_avoidance: collisionAvoided ? "batch_signature_rotation" : "not_needed",
    },
    readiness: {
      status: blockers.length === 0 ? "pass" : "blocked",
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
    },
  };
}

function buildStorySfxManifest({ storyId, sourcePlan = {}, audioManifest = {}, generatedAt } = {}) {
  const selectedAssets = asArray(sourcePlan.selected_assets);
  const cueCount = Number(audioManifest.sfx_cue_count || audioManifest.cue_count || selectedAssets.length || 0);
  return {
    schema_version: 1,
    story_id: storyId,
    generated_at: generatedAt,
    cue_count: cueCount,
    source_plan: sourcePlan,
    selected_assets: selectedAssets.map((asset) => ({
      asset_id: cleanText(asset.asset_id || asset.id),
      role: cleanText(asset.role),
      family: cleanText(asset.family || asset.role),
      provider_id: cleanText(asset.provider_id),
      source_url: cleanText(asset.source_url || asset.path),
      rights_basis: cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis),
      licence_evidence_url: cleanText(asset.licence_evidence_url),
      editorial_sfx_score: Number(asset.editorial_sfx_score || 0) || null,
    })),
    readiness: {
      status: sourcePlan.readiness?.status === "pass" ? "pass" : "blocked",
      blockers: asArray(sourcePlan.readiness?.blockers),
    },
    safety: {
      no_downloads_started: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_posting: true,
    },
  };
}

async function repairPackageSfxEvidence({
  storyId,
  artifactDir,
  sourcePlan,
  sfxRightsLedger,
  generatedAt,
  dryRun = false,
  avoidSignatures = new Set(),
} = {}) {
  const sfxManifestPath = path.join(artifactDir, "sfx_manifest.json");
  const sfxSourcePlanPath = path.join(artifactDir, "sfx_source_plan.json");
  const rightsLedgerPath = path.join(artifactDir, "rights_ledger.json");
  const audioManifestPath = path.join(artifactDir, "audio_manifest.json");
  const directorPath = path.join(artifactDir, "director_beat_map.json");
  const audioManifest = (await readJsonIfPresent(audioManifestPath, {})) || {};
  const director = (await readJsonIfPresent(directorPath, {})) || {};
  const existingSfxManifest = (await readJsonIfPresent(sfxManifestPath, {})) || {};
  const requiredRoles = activeRenderRequiredRolesFromDirector(director);
  const storySourcePlan = buildStoryVariantSourcePlan({
    storyId,
    sourcePlan,
    sfxRightsLedger,
    requiredRoles,
    avoidSignatures,
  });
  const alreadyPasses = existingSfxManifest.source_plan?.readiness?.status === "pass" &&
    sameSelectedAssets(existingSfxManifest, storySourcePlan);
  const writes = [];

  if (!alreadyPasses) {
    const sfxManifest = buildStorySfxManifest({
      storyId,
      sourcePlan: storySourcePlan,
      audioManifest,
      generatedAt,
    });
    writes.push({ path: sfxManifestPath, data: sfxManifest });
    writes.push({ path: sfxSourcePlanPath, data: storySourcePlan });
  }

  const originalRights = (await readJsonIfPresent(rightsLedgerPath, { records: [] })) || { records: [] };
  const currentRights = pruneUnselectedSfxRights(originalRights, storySourcePlan.selected_assets);
  const selectedSfxRights = {
    records: selectedSfxRightsRecords(storySourcePlan.selected_assets, sfxRightsLedger),
  };
  const mergedRights = mergeRightsRecords(currentRights, selectedSfxRights);
  if (!sameRightsRecords(originalRights, mergedRights)) {
    writes.push({ path: rightsLedgerPath, data: mergedRights });
  }

  if (!dryRun) {
    for (const write of writes) await fs.writeJson(write.path, write.data, { spaces: 2 });
  }

  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    status: writes.length ? (dryRun ? "planned" : "repaired") : "unchanged",
    wrote_files: writes.map((write) => write.path),
    sfx_manifest_was_already_pass: alreadyPasses,
    selected_sfx_signature: storySourcePlan.anti_repetition?.selected_signature || selectedSfxSignature(storySourcePlan.selected_assets),
  };
}

async function repairGoalSfxEvidence({
  root = process.cwd(),
  storyPackagesPath = null,
  packageRoot = null,
  sfxSourcePlanPath = null,
  sfxRightsLedgerPath = null,
  generatedAt = new Date().toISOString(),
  dryRun = false,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const sourcePlan = normalisePlan(
    await readJsonIfPresent(
      sfxSourcePlanPath ? path.resolve(resolvedRoot, sfxSourcePlanPath) : path.join(resolvedRoot, "output", "goal-contract", "sfx_source_plan.json"),
      {},
    ),
  );
  const sfxRightsLedger = await readJsonIfPresent(
    sfxRightsLedgerPath ? path.resolve(resolvedRoot, sfxRightsLedgerPath) : path.join(resolvedRoot, "output", "goal-contract", "sfx_rights_ledger.json"),
    { records: [] },
  );
  const packageEntries = await discoverPackageEntries({ root: resolvedRoot, storyPackagesPath, packageRoot });
  const blockers = [];
  if (sourcePlan.readiness.status !== "pass" && !asArray(sourcePlan.selected_assets).length) {
    blockers.push("sfx_source_plan_not_pass");
    blockers.push(...sourcePlan.readiness.blockers);
  }
  if (!asArray(sfxRightsLedger.records || sfxRightsLedger).length) blockers.push("sfx_rights_ledger_missing");
  if (!packageEntries.length) blockers.push("story_packages_missing");

  const repaired = [];
  if (!blockers.length) {
    const usedSfxSignatures = new Set();
    for (const entry of packageEntries) {
      const result = await repairPackageSfxEvidence({
        storyId: entry.story_id,
        artifactDir: path.resolve(resolvedRoot, entry.artifact_dir),
        sourcePlan,
        sfxRightsLedger,
        generatedAt,
        dryRun,
        avoidSignatures: usedSfxSignatures,
      });
      if (result.selected_sfx_signature) usedSfxSignatures.add(result.selected_sfx_signature);
      repaired.push(result);
    }
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "goal_sfx_evidence_repair",
    dry_run: Boolean(dryRun),
    readiness: {
      status: blockers.length ? "blocked" : "pass",
      blockers,
    },
    summary: {
      package_count: packageEntries.length,
      repaired_count: repaired.filter((entry) => entry.status === "repaired").length,
      planned_count: repaired.filter((entry) => entry.status === "planned").length,
      unchanged_count: repaired.filter((entry) => entry.status === "unchanged").length,
    },
    repaired_packages: repaired,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function writeGoalSfxEvidenceRepairReport(report, { outputDir = path.join(process.cwd(), "output", "goal-contract") } = {}) {
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "sfx_evidence_repair_report.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  return { jsonPath };
}

module.exports = {
  activeRenderRequiredRolesFromDirector,
  buildStorySfxManifest,
  discoverPackageEntries,
  mergeRightsRecords,
  repairGoalSfxEvidence,
  repairPackageSfxEvidence,
  writeGoalSfxEvidenceRepairReport,
};
