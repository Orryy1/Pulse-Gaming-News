"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  evaluateOwnedMotionRightsEvidence,
} = require("../owned-motion-rights-evidence");
const {
  evaluateOwnedProceduralDiversity,
} = require("../owned-procedural-diversity");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseSha256(value) {
  return clean(value).replace(/^sha256:/i, "").toLowerCase();
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function ownedAssets(manifest = {}) {
  return uniqueByAssetId([
    ...asArray(manifest.assets),
    ...asArray(manifest.materialised_clips),
    ...asArray(manifest.materialized_clips),
  ]).filter(
    (asset) =>
      clean(asset.generator_design_role) === "primary_procedural_motion",
  );
}

function uniqueByAssetId(rows = []) {
  const result = [];
  const seen = new Set();
  for (const row of asArray(rows)) {
    const key = clean(
      row.asset_id ||
        row.id ||
        row.path ||
        row.local_materialized_path,
    );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function proceduralProjectsFromAssets(assets = []) {
  const groups = new Map();
  for (const asset of asArray(assets)) {
    const projectId = clean(asset.generator_project_id);
    if (!projectId) continue;
    const group = groups.get(projectId) || [];
    group.push(asset);
    groups.set(projectId, group);
  }
  return [...groups.entries()].map(([projectId, projectAssets]) => {
    const representative = projectAssets[0] || {};
    return {
      generator_project_id: projectId,
      generator_master_sha256: normaliseSha256(
        representative.generator_master_sha256,
      ),
      sampled_visual_fingerprint: normaliseSha256(
        representative.sampled_visual_fingerprint,
      ),
      design_grammar_identity: clean(
        representative.generator_design_grammar ||
          representative.design_grammar_identity,
      ),
      source_type: "owned_procedural_motion",
      rights: {
        rights_grant: "wholly_owned_procedural_motion",
        owned: true,
        allowed_platforms: asArray(
          representative.allowed_platforms,
        ).map(clean),
      },
      outputs: projectAssets.map((asset) => ({
        path: clean(asset.path || asset.local_materialized_path),
        sha256: normaliseSha256(
          asset.materialised_output_sha256 ||
            asset.materialized_output_sha256 ||
            asset.asset_sha256,
        ),
        size_bytes: Number(
          asset.materialised_output_size_bytes ||
            asset.materialized_output_size_bytes ||
            asset.asset_size_bytes ||
            0,
        ),
      })),
    };
  });
}

function statusIsBlocked(value) {
  return /^(?:red|blocked|failed|missing|partial)$/i.test(clean(value));
}

async function evaluateStoryEvidence({
  story = {},
  requiredPlatforms = [],
  workspaceRoot = process.cwd(),
} = {}) {
  const storyId = clean(story.story_id || story.id);
  const artifactDir = clean(story.artifact_dir);
  const blockers = [];
  if (!storyId) blockers.push("owned_motion_story_id_missing");
  if (!artifactDir) blockers.push("owned_motion_artifact_dir_missing");
  if (statusIsBlocked(story.status)) {
    blockers.push("owned_motion_materialization_story_blocked");
  }
  blockers.push(
    ...asArray(story.blockers).map(clean),
    ...asArray(story.rejection_reasons).map(clean),
  );

  const ownedManifest = artifactDir
    ? await readJsonIfPresent(
        path.join(artifactDir, "owned_motion_manifest.json"),
      )
    : null;
  const materialisedMotion = artifactDir
    ? await readJsonIfPresent(
        path.join(artifactDir, "materialised_motion_clips.json"),
      )
    : null;
  const rightsLedger = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"))
    : null;

  if (!ownedManifest) blockers.push("owned_motion_manifest_missing_or_unreadable");
  else if (statusIsBlocked(ownedManifest.status)) {
    blockers.push("owned_motion_manifest_not_ready");
  }
  if (!materialisedMotion) {
    blockers.push("owned_motion_materialised_clips_missing_or_unreadable");
  } else if (statusIsBlocked(materialisedMotion.status)) {
    blockers.push("owned_motion_materialised_clips_not_ready");
  }
  if (!rightsLedger) blockers.push("owned_motion_rights_ledger_missing_or_unreadable");

  const assets = ownedAssets(ownedManifest || {});
  const projects = proceduralProjectsFromAssets(assets);
  const diversity = await evaluateOwnedProceduralDiversity({
    projects,
    workspaceRoot,
    requiredPlatforms,
  });
  if (diversity.verdict !== "GREEN") {
    blockers.push("owned_motion_procedural_diversity_invalid");
  }

  const records = asArray(
    rightsLedger?.records ||
      rightsLedger?.rights_ledger ||
      rightsLedger?.assets,
  );
  const recordById = new Map(
    records.map((record) => [clean(record.asset_id || record.id), record]),
  );
  const rightsResults = [];
  for (const asset of assets) {
    const assetId = clean(asset.asset_id || asset.id);
    const record = recordById.get(assetId);
    if (!record) {
      rightsResults.push({
        asset_id: assetId || null,
        status: "fail",
        blockers: ["owned_motion_rights_record_missing"],
      });
      continue;
    }
    const allowedPlatforms = asArray(record.allowed_platforms).map(clean);
    const missingRequiredPlatforms = requiredPlatforms.filter(
      (platform) => !allowedPlatforms.includes(platform),
    );
    const evaluation = await evaluateOwnedMotionRightsEvidence({
      record,
      required_platforms: allowedPlatforms,
    });
    rightsResults.push({
      asset_id: assetId,
      ...evaluation,
      blockers: unique([
        ...asArray(evaluation.blockers),
        ...(missingRequiredPlatforms.length
          ? ["required_enabled_platform_rights_missing"]
          : []),
      ]),
    });
  }
  const invalidRights = rightsResults.filter(
    (result) => result.status !== "pass" || asArray(result.blockers).length,
  );
  if (!assets.length || invalidRights.length) {
    blockers.push("owned_motion_rights_evidence_invalid");
  }
  const uniqueBlockers = unique(blockers);
  return {
    story_id: storyId || null,
    artifact_dir: artifactDir || null,
    strict_ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    diversity,
    rights: {
      status: assets.length > 0 && invalidRights.length === 0 ? "pass" : "fail",
      asset_count: assets.length,
      evaluated_record_count: rightsResults.length,
      invalid_record_count: invalidRights.length,
      invalid_records: invalidRights,
    },
  };
}

async function evaluateFreshRefillOwnedMotionFallbackEvidence({
  reportPath,
  requiredPlatforms = [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ],
  workspaceRoot = process.cwd(),
} = {}) {
  const report = await readJsonIfPresent(reportPath);
  if (!report) {
    return {
      schema_version: 1,
      status: "blocked",
      ready_story_ids: [],
      blocked_story_ids: [],
      blockers: ["owned_motion_materialization_report_missing_or_unreadable"],
      stories: [],
    };
  }
  const stories = [];
  for (const story of asArray(report.stories)) {
    stories.push(
      await evaluateStoryEvidence({
        story,
        requiredPlatforms,
        workspaceRoot,
      }),
    );
  }
  const readyStoryIds = stories
    .filter((story) => story.strict_ready)
    .map((story) => story.story_id)
    .filter(Boolean);
  const blockedStoryIds = stories
    .filter((story) => !story.strict_ready)
    .map((story) => story.story_id)
    .filter(Boolean);
  const blockers = unique(stories.flatMap((story) => story.blockers));
  if (!stories.length) blockers.push("owned_motion_materialization_report_empty");
  return {
    schema_version: 1,
    status:
      stories.length > 0 && blockedStoryIds.length === 0 ? "ready" : "blocked",
    ready_story_ids: readyStoryIds,
    blocked_story_ids: blockedStoryIds,
    blockers: unique(blockers),
    stories,
  };
}

module.exports = {
  evaluateFreshRefillOwnedMotionFallbackEvidence,
  proceduralProjectsFromAssets,
};
