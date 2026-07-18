"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");

const SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER =
  "narration_and_render_regeneration_required_after_script_repair";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value || 0) * multiplier) / multiplier;
}

function resolvedPath(root, value) {
  const text = cleanText(value);
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function fileKey(root, value) {
  const resolved = resolvedPath(root, value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function restrictiveStatus(value) {
  return /(?:^|[_\s-])(red|blocked|denied|rejected|failed|unsafe|expired)(?:$|[_\s-])/i.test(
    cleanText(value),
  );
}

function ledgerPasses(ledger = {}) {
  const verdict = lowerText(ledger.verdict || ledger.status || ledger.result);
  return ["pass", "green", "approved", "ready"].includes(verdict) &&
    !asArray(ledger.blockers).filter(Boolean).length;
}

function ledgerAllowsPostScriptMotionRepair(ledger = {}) {
  const transition =
    ledger.script_repair_media_transition &&
    typeof ledger.script_repair_media_transition === "object"
      ? ledger.script_repair_media_transition
      : {};
  const blockers = asArray(ledger.blockers).map(cleanText).filter(Boolean);
  const failures = asArray(ledger.failures).filter(Boolean);
  return (
    lowerText(ledger.verdict) === "red" &&
    ["", "blocked"].includes(lowerText(ledger.status)) &&
    blockers.length === 1 &&
    blockers[0] === SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER &&
    failures.length === 0 &&
    transition.recognised === true &&
    transition.reconciliation_allowed === true &&
    transition.narration_fresh === true &&
    transition.render_fresh === false &&
    transition.motion_rights_reconciled === true &&
    cleanText(transition.status) === "awaiting_fresh_render" &&
    [undefined, false].includes(ledger.can_auto_publish)
  );
}

function clipRows(manifest = {}) {
  const rows = [
    ...asArray(manifest.clips),
    ...asArray(manifest.materialised_clips),
    ...asArray(manifest.materialized_clips),
  ];
  const byExactAlias = new Map();
  for (const row of rows) {
    const id = cleanText(row?.id || row?.clip_id || row?.asset_id);
    const localPath = lowerText(
      row?.path || row?.local_materialized_path || row?.local_materialised_path,
    );
    const hash = lowerText(
      row?.asset_sha256 ||
        row?.sha256 ||
        row?.materialized_file_evidence?.sha256 ||
        row?.materialised_file_evidence?.sha256,
    );
    const start = numberOrNull(
      row?.mediaStartS ??
        row?.media_start_s ??
        row?.source_media_start_s,
    );
    const duration = numberOrNull(
      row?.durationS ??
        row?.duration_s ??
        row?.source_window_duration_s,
    );
    const key = `${id}|${localPath}|${hash}|${start}|${duration}`;
    if (!byExactAlias.has(key)) byExactAlias.set(key, row);
  }
  return [...byExactAlias.values()];
}

function acceptedSelectorPathSet(root, selectorReport = {}) {
  const accepted = [
    ...asArray(selectorReport.accepted),
    ...asArray(selectorReport.clips).filter((row) => row?.eligible === true),
  ];
  return new Set(
    accepted
      .map((row) => fileKey(root, row?.path || row?.file_path || row?.local_materialized_path))
      .filter(Boolean),
  );
}

function rightsRowsForId(ledger = {}, clipId = "") {
  return asArray(ledger.records).filter(
    (row) => cleanText(row?.asset_id || row?.id || row?.clip_id) === clipId,
  );
}

function usedAssetRowsForId(ledger = {}, clipId = "") {
  return asArray(ledger.used_assets).filter(
    (row) => cleanText(row?.asset_id || row?.id || row?.clip_id) === clipId,
  );
}

function rightsRowComplete(row = {}) {
  const basis = cleanText(row.licence_basis || row.license_basis || row.rights_basis);
  const allowedUse = cleanText(row.allowed_use || row.usage_scope);
  return Boolean(
    basis &&
      allowedUse &&
      asArray(row.allowed_platforms).filter(Boolean).length &&
      typeof row.commercial_use_allowed === "boolean" &&
      typeof row.credit_required === "boolean" &&
      numberOrNull(row.risk_score) != null &&
      !restrictiveStatus(row.rights_verdict) &&
      !restrictiveStatus(row.rights_status) &&
      !restrictiveStatus(row.approval_status),
  );
}

function sourceIdentity(clip = {}) {
  const motionIdentity =
    clip.motion_source_identity && typeof clip.motion_source_identity === "object"
      ? clip.motion_source_identity
      : {};
  const provenance =
    clip.source_identity_provenance ||
    motionIdentity.source_identity_provenance ||
    {};
  return {
    canonical_source_url: cleanText(
      clip.canonical_source_url || motionIdentity.canonical_source_url,
    ),
    youtube_video_id: cleanText(clip.youtube_video_id || motionIdentity.youtube_video_id),
    source_master_sha256: lowerText(
      clip.source_master_sha256 || motionIdentity.source_master_sha256,
    ),
    sampled_visual_fingerprint: cleanText(
      clip.sampled_visual_fingerprint || motionIdentity.sampled_visual_fingerprint,
    ),
    base_source_asset_id: cleanText(
      clip.base_source_asset_id || motionIdentity.base_source_asset_id,
    ),
    base_source_identity_basis: cleanText(
      clip.base_source_identity_basis || motionIdentity.base_source_identity_basis,
    ),
    source_identity_provenance: provenance,
    source_identity_conflicts: [
      ...asArray(clip.source_identity_conflicts),
      ...asArray(motionIdentity.source_identity_conflicts),
    ].filter(Boolean),
  };
}

function canonicalSourceGroupKey(clip = {}) {
  const identity = sourceIdentity(clip);
  const youtubeId = lowerText(identity.youtube_video_id);
  if (youtubeId) return `youtube:${youtubeId}`;
  try {
    const url = new URL(identity.canonical_source_url);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      const pathId = host === "youtu.be"
        ? url.pathname.split("/").filter(Boolean)[0]
        : url.searchParams.get("v");
      if (pathId) return `youtube:${lowerText(pathId)}`;
    }
    if (identity.canonical_source_url) {
      url.hash = "";
      return `url:${url.toString().toLowerCase()}`;
    }
  } catch {}
  return identity.base_source_asset_id ||
    (identity.source_master_sha256 ? `sha256:${identity.source_master_sha256}` : "");
}

function exactRightsHash(row = {}) {
  return lowerText(
    row.asset_sha256 ||
      row.sha256 ||
      row.materialized_file_evidence?.sha256 ||
      row.materialised_file_evidence?.sha256,
  );
}

function exactRightsSize(row = {}) {
  return numberOrNull(
    row.asset_size_bytes ||
      row.size_bytes ||
      row.materialized_file_evidence?.size_bytes ||
      row.materialised_file_evidence?.size_bytes,
  );
}

function segmentFromClip(clip = {}, rights = {}) {
  const identity = sourceIdentity(clip);
  const validation =
    clip.validation_provenance ||
    clip.provenance ||
    {};
  const mediaStartS = numberOrNull(
    clip.mediaStartS ??
      clip.media_start_s ??
      clip.source_media_start_s ??
      clip.transformation_provenance?.media_start_s,
  );
  const durationS = numberOrNull(
    clip.durationS ??
      clip.duration_s ??
      clip.source_window_duration_s ??
      clip.transformation_provenance?.duration_s,
  );
  const sourceDurationS = numberOrNull(
    clip.source_duration_s ||
      validation.source_duration_s ||
      clip.transformation_provenance?.source_duration_s,
  );
  const licenceBasis = cleanText(
    rights.licence_basis ||
      rights.license_basis ||
      rights.rights_basis ||
      clip.licence_basis ||
      clip.license_basis ||
      clip.rights_basis,
  );
  const allowedUse = cleanText(
    rights.allowed_use ||
      rights.usage_scope ||
      clip.allowed_use ||
      clip.usage_scope,
  );
  return {
    id: cleanText(clip.id || clip.clip_id || clip.asset_id),
    story_id: cleanText(clip.story_id),
    entity: cleanText(clip.entity),
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    source_url: cleanText(
      clip.source_url ||
        clip.source_master_path ||
        clip.local_source_master_path,
    ),
    source_url_kind: "local_video_file",
    source_type: cleanText(clip.source_type || "official_youtube_channel_url"),
    provider: cleanText(clip.provider || "official_trailer_segment_validation"),
    base_source_family: cleanText(
      clip.base_source_family ||
        clip.transformation_provenance?.base_source_family,
    ),
    ...identity,
    source_owner: cleanText(clip.source_owner || clip.entity),
    media_start_s: mediaStartS,
    duration_s: durationS,
    source_duration_s: sourceDurationS,
    trusted_source_matched: true,
    licence_basis: licenceBasis,
    rights_risk_class: licenceBasis,
    allowed_render_use: allowedUse,
    allowed_use: allowedUse,
    allowed_platforms: [...asArray(rights.allowed_platforms || clip.allowed_platforms)],
    platform_restrictions:
      rights.platform_restrictions ||
      clip.platform_restrictions ||
      {},
    restricted_platforms: [
      ...asArray(rights.restricted_platforms || clip.restricted_platforms),
    ],
    commercial_use_allowed: rights.commercial_use_allowed,
    credit_required: rights.credit_required,
    risk_score: numberOrNull(rights.risk_score),
    evidence_reference: cleanText(
      rights.evidence_reference ||
        clip.evidence_reference ||
        clip.source_url,
    ),
    validation_reason: cleanText(
      validation.validation_reason || "independent_visual_selector_passed",
    ),
    validation_provenance: {
      ...validation,
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_duration_s: sourceDurationS,
    },
    provenance: {
      ...validation,
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_duration_s: sourceDurationS,
      base_source_family: cleanText(
        clip.base_source_family ||
          clip.transformation_provenance?.base_source_family,
      ),
      independent_visual_selector_passed: true,
    },
    quality_preselection: {
      policy: "pulse_direct_motion_visual_selector_v5",
      status: "pass",
    },
  };
}

async function composeGovernedMotionSegmentReport({
  root = process.cwd(),
  storyId = "",
  title = "",
  narrationDurationSeconds = 0,
  transitionDurationSeconds = 0.25,
  minClips = 1,
  minBaseSources = 1,
  maxScenesPerSource = 2,
  maxSourceShare = 0.25,
  bundles = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const targetStoryId = cleanText(storyId);
  const blockers = [];
  const selected = [];
  const seenClipIds = new Set();
  const seenClipPaths = new Set();
  const seenVisualFingerprints = new Set();
  const fileHashCache = new Map();
  const fileStatCache = new Map();
  const upstreamPublishHolds = new Set();

  const inspectFile = async (filePath) => {
    const key = fileKey(resolvedRoot, filePath);
    if (!key) return null;
    if (!fileStatCache.has(key)) {
      if (!(await fs.pathExists(key))) return null;
      fileStatCache.set(key, await fs.stat(key));
    }
    if (!fileHashCache.has(key)) fileHashCache.set(key, await sha256File(key));
    return {
      path: key,
      sha256: fileHashCache.get(key),
      size_bytes: fileStatCache.get(key).size,
    };
  };

  if (!targetStoryId) blockers.push("story_id_missing");
  if (!asArray(bundles).length) blockers.push("source_bundles_missing");

  for (const bundle of asArray(bundles)) {
    const manifest = bundle?.manifest || {};
    const rightsLedger = bundle?.rightsLedger || bundle?.rights_ledger || {};
    const selectorReport = bundle?.selectorReport || bundle?.selector_report || {};
    const requestedClipIds = asArray(bundle?.clipIds || bundle?.clip_ids)
      .map(cleanText)
      .filter(Boolean);
    const manifestStoryId = cleanText(manifest.story_id);
    const ledgerStoryId = cleanText(rightsLedger.story_id);

    if (manifestStoryId && targetStoryId && manifestStoryId !== targetStoryId) {
      blockers.push(`motion_manifest_story_mismatch:${manifestStoryId}`);
    }
    if (ledgerStoryId && targetStoryId && ledgerStoryId !== targetStoryId) {
      blockers.push(`rights_ledger_story_mismatch:${ledgerStoryId}`);
    }
    const rightsLedgerPasses = ledgerPasses(rightsLedger);
    const postScriptMotionRepair =
      ledgerAllowsPostScriptMotionRepair(rightsLedger);
    if (!rightsLedgerPasses && !postScriptMotionRepair) {
      blockers.push("rights_ledger_not_pass");
    }
    if (postScriptMotionRepair) {
      upstreamPublishHolds.add(SCRIPT_REPAIR_RIGHTS_TRANSITION_BLOCKER);
    }
    if (!asArray(rightsLedger.records).length || !asArray(rightsLedger.used_assets).length) {
      blockers.push("rights_ledger_used_asset_records_missing");
    }

    const selectorAccepted = acceptedSelectorPathSet(resolvedRoot, selectorReport);
    if (!selectorAccepted.size) blockers.push("independent_visual_selector_acceptance_missing");
    const manifestClips = clipRows(manifest);

    for (const clipId of requestedClipIds) {
      if (seenClipIds.has(clipId)) {
        blockers.push(`duplicate_selected_clip_id:${clipId}`);
        continue;
      }
      seenClipIds.add(clipId);
      const matches = manifestClips.filter(
        (clip) => cleanText(clip?.id || clip?.clip_id || clip?.asset_id) === clipId,
      );
      if (matches.length !== 1) {
        blockers.push(
          matches.length
            ? `duplicate_motion_manifest_clip:${clipId}`
            : `motion_manifest_clip_missing:${clipId}`,
        );
        continue;
      }
      const clip = matches[0];
      const clipPath = resolvedPath(
        resolvedRoot,
        clip.path || clip.local_materialized_path || clip.local_materialised_path,
      );
      const clipPathKey = fileKey(resolvedRoot, clipPath);
      if (!clipPath || seenClipPaths.has(clipPathKey)) {
        blockers.push(
          clipPath ? `duplicate_selected_clip_path:${clipId}` : `materialised_clip_path_missing:${clipId}`,
        );
        continue;
      }
      seenClipPaths.add(clipPathKey);
      if (!selectorAccepted.has(clipPathKey)) {
        blockers.push(`independent_visual_selector_acceptance_missing:${clipId}`);
      }

      const materialisedEvidence = await inspectFile(clipPath);
      if (!materialisedEvidence) {
        blockers.push(`materialised_clip_missing:${clipId}`);
        continue;
      }
      const declaredClipHash = lowerText(
        clip.asset_sha256 ||
          clip.sha256 ||
          clip.materialized_file_evidence?.sha256 ||
          clip.materialised_file_evidence?.sha256,
      );
      const declaredClipSize = numberOrNull(
        clip.asset_size_bytes ||
          clip.size_bytes ||
          clip.materialized_file_evidence?.size_bytes ||
          clip.materialised_file_evidence?.size_bytes,
      );
      if (!declaredClipHash || declaredClipHash !== materialisedEvidence.sha256) {
        blockers.push(`materialised_clip_hash_mismatch:${clipId}`);
      }
      if (declaredClipSize == null || declaredClipSize !== materialisedEvidence.size_bytes) {
        blockers.push(`materialised_clip_size_mismatch:${clipId}`);
      }

      const rightsRows = rightsRowsForId(rightsLedger, clipId);
      const usedAssetRows = usedAssetRowsForId(rightsLedger, clipId);
      if (rightsRows.length !== 1) {
        blockers.push(
          rightsRows.length
            ? `duplicate_rights_record:${clipId}`
            : `rights_record_missing:${clipId}`,
        );
        continue;
      }
      if (usedAssetRows.length !== 1) {
        blockers.push(
          usedAssetRows.length
            ? `duplicate_used_asset_record:${clipId}`
            : `used_asset_record_missing:${clipId}`,
        );
      }
      const rights = rightsRows[0];
      if (!rightsRowComplete(rights)) blockers.push(`rights_record_incomplete:${clipId}`);
      const rightsHash = exactRightsHash(rights);
      const rightsSize = exactRightsSize(rights);
      const usedAssetHash = exactRightsHash(usedAssetRows[0] || {});
      const usedAssetSize = exactRightsSize(usedAssetRows[0] || {});
      if (!rightsHash || rightsHash !== materialisedEvidence.sha256) {
        blockers.push(`rights_record_hash_mismatch:${clipId}`);
      }
      if (rightsSize == null || rightsSize !== materialisedEvidence.size_bytes) {
        blockers.push(`rights_record_size_mismatch:${clipId}`);
      }
      if (!usedAssetHash || usedAssetHash !== materialisedEvidence.sha256) {
        blockers.push(`used_asset_hash_mismatch:${clipId}`);
      }
      if (usedAssetSize == null || usedAssetSize !== materialisedEvidence.size_bytes) {
        blockers.push(`used_asset_size_mismatch:${clipId}`);
      }

      const identity = sourceIdentity(clip);
      if (
        !identity.canonical_source_url ||
        !identity.source_master_sha256 ||
        !identity.base_source_asset_id ||
        identity.source_identity_conflicts.length
      ) {
        blockers.push(`source_identity_incomplete:${clipId}`);
      }
      const sourcePath = resolvedPath(
        resolvedRoot,
        clip.source_url || clip.source_master_path || clip.local_source_master_path,
      );
      const sourceEvidence = await inspectFile(sourcePath);
      if (!sourceEvidence) {
        blockers.push(`source_master_missing:${clipId}`);
      } else if (
        !identity.source_master_sha256 ||
        identity.source_master_sha256 !== sourceEvidence.sha256
      ) {
        blockers.push(`source_master_hash_mismatch:${clipId}`);
      }

      const visualFingerprint = cleanText(
        clip.visual_content_fingerprint?.signature ||
          clip.sampled_visual_fingerprint,
      );
      if (!visualFingerprint) {
        blockers.push(`visual_fingerprint_missing:${clipId}`);
      } else if (seenVisualFingerprints.has(visualFingerprint)) {
        blockers.push(`duplicate_visual_fingerprint:${clipId}`);
      } else {
        seenVisualFingerprints.add(visualFingerprint);
      }

      const segment = segmentFromClip(
        {
          ...clip,
          story_id: targetStoryId,
          entity: cleanText(clip.entity || title),
        },
        rights,
      );
      if (
        segment.media_start_s == null ||
        segment.media_start_s < 0 ||
        segment.duration_s == null ||
        segment.duration_s < 0.5
      ) {
        blockers.push(`source_window_invalid:${clipId}`);
      }
      selected.push({
        clip,
        segment,
        materialisedEvidence,
        sourceEvidence,
      });
    }
  }

  const sourceGroups = new Map();
  for (const row of selected) {
    const sourceKey = canonicalSourceGroupKey(row.clip);
    if (!sourceKey) continue;
    if (!sourceGroups.has(sourceKey)) sourceGroups.set(sourceKey, []);
    sourceGroups.get(sourceKey).push(row);
  }
  for (const [sourceKey, rows] of sourceGroups.entries()) {
    const sorted = [...rows].sort(
      (a, b) => Number(a.segment.media_start_s || 0) - Number(b.segment.media_start_s || 0),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1].segment;
      const current = sorted[index].segment;
      if (
        Number(current.media_start_s) <
        Number(previous.media_start_s) + Number(previous.duration_s) - 0.05
      ) {
        blockers.push(`overlapping_source_windows:${sourceKey}`);
        break;
      }
    }
  }

  const clipCount = selected.length;
  const genuineBaseSourceCount = sourceGroups.size;
  const totalClipDuration = selected.reduce(
    (sum, row) => sum + Number(row.segment.duration_s || 0),
    0,
  );
  const transitionLoss = Math.max(0, clipCount - 1) * Number(transitionDurationSeconds || 0);
  const repeatFreeCoverage = Math.max(0, totalClipDuration - transitionLoss);
  const sourceSceneShares = [...sourceGroups.entries()].map(([source, rows]) => ({
    base_source_asset_id: source,
    scene_count: rows.length,
    scene_share: clipCount ? round(rows.length / clipCount, 4) : 0,
    clip_ids: rows.map((row) => cleanText(row.clip.id || row.clip.clip_id)),
  }));
  const concentratedSources = sourceSceneShares.filter(
    (row) =>
      row.scene_count > Number(maxScenesPerSource) &&
      row.scene_share > Number(maxSourceShare),
  );

  if (clipCount < Number(minClips)) blockers.push("motion_clip_minimum_not_met");
  if (genuineBaseSourceCount < Number(minBaseSources)) {
    blockers.push("genuine_base_source_minimum_not_met");
  }
  if (concentratedSources.length) {
    blockers.push("professional_motion_source_concentration_above_floor");
  }
  if (
    Number(narrationDurationSeconds) > 0 &&
    repeatFreeCoverage + 0.05 < Number(narrationDurationSeconds)
  ) {
    blockers.push("repeat_free_motion_coverage_below_narration");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const verdict = uniqueBlockers.length ? "RED" : "PASS";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GOVERNED_BALANCED_MOTION_SEGMENT_COMPOSITION",
    story_id: targetStoryId,
    title: cleanText(title),
    verdict,
    can_materialize: verdict === "PASS",
    story_publishable: false,
    upstream_publish_hold: upstreamPublishHolds.size
      ? {
          active: true,
          reason: [...upstreamPublishHolds][0],
          release_condition:
            "fresh_render_and_authoritative_post_render_rights_reconciliation",
        }
      : {
          active: false,
          reason: null,
          release_condition:
            "authoritative_post_render_control_tower_green",
        },
    blockers: uniqueBlockers,
    requirements: {
      min_clip_count: Number(minClips),
      min_genuine_base_source_count: Number(minBaseSources),
      narration_duration_seconds: round(narrationDurationSeconds),
      transition_duration_seconds: round(transitionDurationSeconds),
      max_scenes_per_source: Number(maxScenesPerSource),
      max_source_share: Number(maxSourceShare),
      source_concentration_operator:
        "scene_count > max_scenes_per_source AND scene_share > max_source_share",
    },
    metrics: {
      selected_clip_count: clipCount,
      genuine_base_source_count: genuineBaseSourceCount,
      total_clip_duration_seconds: round(totalClipDuration),
      transition_loss_seconds: round(transitionLoss),
      repeat_free_coverage_seconds: round(repeatFreeCoverage),
      distinct_visual_fingerprint_count: seenVisualFingerprints.size,
      source_scene_shares: sourceSceneShares,
      concentrated_source_count: concentratedSources.length,
      concentrated_sources: concentratedSources,
    },
    segments: selected.map((row) => row.segment),
    selected_clip_evidence: selected.map((row) => ({
      clip_id: cleanText(row.clip.id || row.clip.clip_id),
      path: row.materialisedEvidence?.path || null,
      sha256: row.materialisedEvidence?.sha256 || null,
      size_bytes: row.materialisedEvidence?.size_bytes || null,
      source_master_path: row.sourceEvidence?.path || null,
      source_master_sha256: row.sourceEvidence?.sha256 || null,
      independent_visual_selector_passed: true,
    })),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

async function linkOrCopyExactFile(sourcePath, destinationPath) {
  if (await fs.pathExists(destinationPath)) return "existing";
  await fs.ensureDir(path.dirname(destinationPath));
  try {
    await fs.link(sourcePath, destinationPath);
    return "hard_link";
  } catch {
    await fs.copy(sourcePath, destinationPath, {
      overwrite: false,
      errorOnExist: false,
    });
    return "copy";
  }
}

async function mirrorSegmentSourceMasters(report = {}, {
  root = process.cwd(),
  materializerRoot = "",
} = {}) {
  const sourceRoot = path.resolve(root);
  const destinationRoot = path.resolve(materializerRoot || "");
  if (!materializerRoot) throw new Error("mirrorSegmentSourceMasters requires materializerRoot");
  const mirrored = structuredClone(report);
  const blockers = [...asArray(mirrored.blockers)];
  if (cleanText(mirrored.verdict) !== "PASS" || mirrored.can_materialize !== true) {
    blockers.push("source_composition_not_pass");
  }
  const masterDirectory = path.join(
    destinationRoot,
    "test",
    "output",
    "governed-motion-source-masters",
  );
  const identityDirectory = path.join(
    destinationRoot,
    "test",
    "output",
    "governed-motion-source-identities",
  );
  const sourceMirrors = new Map();
  const identityMirrors = new Map();
  const mirrorEvidence = [];

  for (const segment of asArray(mirrored.segments)) {
    const clipId = cleanText(segment.id);
    const sourcePath = resolvedPath(sourceRoot, segment.source_url);
    const expectedHash = lowerText(segment.source_master_sha256);
    if (!sourcePath || !(await fs.pathExists(sourcePath))) {
      blockers.push(`source_master_missing:${clipId}`);
      continue;
    }
    const actualHash = await sha256File(sourcePath);
    if (!expectedHash || expectedHash !== actualHash) {
      blockers.push(`source_master_hash_mismatch:${clipId}`);
      continue;
    }
    let mirror = sourceMirrors.get(actualHash);
    if (!mirror) {
      const extension = path.extname(sourcePath).toLowerCase() || ".mp4";
      const destinationPath = path.join(masterDirectory, `${actualHash}${extension}`);
      const method = await linkOrCopyExactFile(sourcePath, destinationPath);
      const destinationHash = await sha256File(destinationPath);
      const stat = await fs.stat(destinationPath);
      if (destinationHash !== actualHash) {
        blockers.push(`mirrored_source_master_hash_mismatch:${clipId}`);
        continue;
      }
      mirror = {
        source_path: sourcePath,
        mirrored_path: destinationPath,
        sha256: destinationHash,
        size_bytes: stat.size,
        method,
      };
      sourceMirrors.set(actualHash, mirror);
      mirrorEvidence.push(mirror);
    }
    segment.source_url = mirror.mirrored_path;
    segment.source_url_kind = "local_video_file";
    if (
      !cleanText(segment.evidence_reference) ||
      fileKey(sourceRoot, segment.evidence_reference) === fileKey(sourceRoot, sourcePath)
    ) {
      segment.evidence_reference = mirror.mirrored_path;
    }

    const provenance =
      segment.source_identity_provenance &&
      typeof segment.source_identity_provenance === "object"
        ? segment.source_identity_provenance
        : null;
    const sidecarPath = resolvedPath(sourceRoot, provenance?.sidecar_path);
    const expectedSidecarHash = lowerText(provenance?.sidecar_sha256);
    if (sidecarPath && expectedSidecarHash && await fs.pathExists(sidecarPath)) {
      let identityMirror = identityMirrors.get(expectedSidecarHash);
      if (!identityMirror) {
        const actualSidecarHash = await sha256File(sidecarPath);
        if (actualSidecarHash !== expectedSidecarHash) {
          blockers.push(`source_identity_sidecar_hash_mismatch:${clipId}`);
        } else {
          const destinationPath = path.join(
            identityDirectory,
            `${expectedSidecarHash}${path.extname(sidecarPath).toLowerCase() || ".json"}`,
          );
          const method = await linkOrCopyExactFile(sidecarPath, destinationPath);
          const destinationHash = await sha256File(destinationPath);
          if (destinationHash !== expectedSidecarHash) {
            blockers.push(`mirrored_source_identity_sidecar_hash_mismatch:${clipId}`);
          } else {
            identityMirror = {
              source_path: sidecarPath,
              mirrored_path: destinationPath,
              sha256: destinationHash,
              size_bytes: (await fs.stat(destinationPath)).size,
              method,
            };
            identityMirrors.set(expectedSidecarHash, identityMirror);
          }
        }
      }
      if (identityMirror) provenance.sidecar_path = identityMirror.mirrored_path;
    }
  }

  const evidenceByClip = new Map(
    asArray(mirrored.selected_clip_evidence).map((row) => [cleanText(row.clip_id), row]),
  );
  for (const segment of asArray(mirrored.segments)) {
    const evidence = evidenceByClip.get(cleanText(segment.id));
    if (evidence) evidence.source_master_path = cleanText(segment.source_url);
  }

  const uniqueBlockers = [...new Set(blockers)];
  mirrored.blockers = uniqueBlockers;
  mirrored.verdict = uniqueBlockers.length ? "RED" : "PASS";
  mirrored.can_materialize = mirrored.verdict === "PASS";
  mirrored.materializer_source_mirroring = {
    materializer_root: destinationRoot,
    source_master_directory: masterDirectory,
    source_identity_directory: identityDirectory,
    source_masters: mirrorEvidence,
    identity_sidecars: [...identityMirrors.values()],
  };
  mirrored.metrics = {
    ...(mirrored.metrics || {}),
    mirrored_source_master_count: sourceMirrors.size,
    mirrored_source_identity_sidecar_count: identityMirrors.size,
  };
  return mirrored;
}

module.exports = {
  composeGovernedMotionSegmentReport,
  mirrorSegmentSourceMasters,
  _private: {
    acceptedSelectorPathSet,
    ledgerPasses,
    ledgerAllowsPostScriptMotionRepair,
    rightsRowComplete,
    segmentFromClip,
    canonicalSourceGroupKey,
    sourceIdentity,
  },
};
