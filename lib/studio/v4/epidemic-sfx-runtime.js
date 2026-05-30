"use strict";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function keyForAsset(asset = {}) {
  return cleanText(asset.asset_id || asset.id || asset.source_url || asset.path || asset.file_path);
}

function flattenVariantAssets(manifest = {}) {
  const variants = manifest.variant_assets_by_role || manifest.variantAssetsByRole || {};
  return Object.values(variants).flatMap((items) => asArray(items));
}

function normaliseSfxAsset(asset = {}, rightsById = new Map()) {
  const id = keyForAsset(asset);
  const rights = rightsById.get(id) || {};
  const licenceBasis = cleanText(
    asset.licence_basis ||
      asset.license_basis ||
      asset.license ||
      asset.rights_basis ||
      rights.licence_basis ||
      rights.license_basis ||
      rights.rights_basis,
  );
  return {
    ...asset,
    ...rights,
    asset_id: cleanText(asset.asset_id || asset.id || rights.asset_id || rights.id),
    role: cleanText(asset.role || asset.sfx_role || rights.role),
    family: cleanText(asset.family || asset.category || rights.family || asset.role || rights.role),
    provider_id: cleanText(asset.provider_id || rights.provider_id || "epidemic_sound"),
    provider_name: cleanText(asset.provider_name || rights.provider_name || "Epidemic Sound"),
    source_url: cleanText(asset.source_url || rights.source_url || asset.path || asset.file_path),
    path: cleanText(asset.path || asset.file_path || rights.path),
    licence_basis: licenceBasis,
    rights_basis: cleanText(asset.rights_basis || rights.rights_basis || licenceBasis),
    approval_status: cleanText(
      asset.approval_status ||
        rights.approval_status ||
        "approved_for_commercial_editorial_use",
    ),
    commercial_use_allowed:
      asset.commercial_use_allowed !== undefined
        ? asset.commercial_use_allowed
        : rights.commercial_use_allowed,
    evidence_reference: cleanText(
      asset.evidence_reference ||
        asset.safelist_evidence ||
        rights.evidence_reference ||
        rights.safelist_evidence,
    ),
  };
}

function dedupeByAssetId(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of asArray(items)) {
    const key = keyForAsset(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sfxRuntimeAssetsFromManifest(manifest = {}) {
  const rightsRecords = asArray(manifest.rights_records || manifest.rightsLedger);
  const rightsById = new Map(rightsRecords.map((record) => [keyForAsset(record), record]));
  const assets = dedupeByAssetId([
    ...asArray(manifest.selected_assets || manifest.assets),
    ...flattenVariantAssets(manifest),
  ]).map((asset) => normaliseSfxAsset(asset, rightsById));
  return {
    assets,
    rightsRecords,
    sourcePlan: {
      schema_version: 1,
      generated_at: manifest.generated_at || null,
      required_roles: asArray(manifest.required_roles),
      covered_roles: asArray(manifest.covered_roles),
      selected_assets: asArray(manifest.selected_assets).map((asset) => normaliseSfxAsset(asset, rightsById)),
      readiness: {
        status: cleanText(manifest.readiness?.status) === "ready" ? "pass" : cleanText(manifest.readiness?.status || "blocked"),
        blockers: asArray(manifest.readiness?.blockers),
        warnings: asArray(manifest.readiness?.warnings),
      },
    },
  };
}

function mergeUniqueAssets(existing = [], incoming = []) {
  return dedupeByAssetId([...asArray(existing), ...asArray(incoming)]);
}

function applyEpidemicSfxRuntimeManifestToStory(story = {}, manifest = {}) {
  const readinessStatus = cleanText(manifest.readiness?.status);
  if (readinessStatus && readinessStatus !== "ready" && readinessStatus !== "pass") {
    return story;
  }
  const { assets, rightsRecords, sourcePlan } = sfxRuntimeAssetsFromManifest(manifest);
  if (!assets.length) return story;
  story.sfx_asset_inventory = mergeUniqueAssets(story.sfx_asset_inventory || story.sfx_assets, assets);
  story.sfx_assets = story.sfx_asset_inventory;
  story.sfx_rights_ledger = mergeUniqueAssets(story.sfx_rights_ledger || story.sfx_rights, rightsRecords);
  story.sfx_rights = story.sfx_rights_ledger;
  story.sfx_source_plan = story.sfx_source_plan || sourcePlan;
  story.sfx_manifest = story.sfx_manifest || {
    schema_version: 1,
    provider_id: manifest.provider_id || "epidemic_sound",
    source_plan: sourcePlan,
    selected_assets: sourcePlan.selected_assets,
    rights_records: story.sfx_rights_ledger,
  };
  story.sfx_runtime_manifest_source = story.sfx_runtime_manifest_source || "epidemic_sfx_runtime_manifest";
  return story;
}

module.exports = {
  applyEpidemicSfxRuntimeManifestToStory,
  sfxRuntimeAssetsFromManifest,
};
