"use strict";

const fs = require("fs-extra");

function reportAssetsForPlan(plan) {
  return [
    ...(Array.isArray(plan?.applied_assets) ? plan.applied_assets : []),
    ...(Array.isArray(plan?.visual_deck?.items) ? plan.visual_deck.items : []),
    ...(Array.isArray(plan?.would_fetch) ? plan.would_fetch : []),
    ...(Array.isArray(plan?.provenance) ? plan.provenance : []),
  ].filter(Boolean);
}

function assetKey(asset) {
  return [
    asset?.source_url || asset?.url || asset?.local_path || "",
    asset?.store_app_id || "",
    asset?.entity || "",
    asset?.source_type || asset?.type || "",
  ].join("|");
}

function dedupeAssets(assets) {
  const seen = new Set();
  const deduped = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const key = assetKey(asset);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    deduped.push(asset);
  }
  return deduped;
}

function buildStillsAssetMapFromReports(entries = []) {
  const map = new Map();
  const sources = [];

  for (const entry of entries) {
    const report = entry?.report;
    if (!report || !Array.isArray(report.plans)) continue;
    if (entry.filePath) sources.push(entry.filePath);

    for (const plan of report.plans) {
      if (!plan?.story_id) continue;
      const existing = map.get(plan.story_id) || [];
      map.set(plan.story_id, dedupeAssets([...existing, ...reportAssetsForPlan(plan)]));
    }
  }

  return {
    map,
    sources,
    source: sources[0] || null,
  };
}

async function readJsonIfExists(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

async function loadStillsAssetMapFromFiles(filePaths = []) {
  const entries = [];
  for (const filePath of filePaths) {
    const report = await readJsonIfExists(filePath);
    if (!report) continue;
    entries.push({ filePath, report });
  }
  return buildStillsAssetMapFromReports(entries);
}

module.exports = {
  assetKey,
  buildStillsAssetMapFromReports,
  dedupeAssets,
  loadStillsAssetMapFromFiles,
  reportAssetsForPlan,
};
