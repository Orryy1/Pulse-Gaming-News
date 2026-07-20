"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const { runPlatformVideoQa } = require("./services/platform-video-qa");
const {
  validateTemporalVideoQaReport,
} = require("./services/video-qa");
const { verifyFinalRenderInputLineage } = require("./goal-contract");
const { validateFinalAvReviewFile } = require("./goal-final-av-review");
const {
  officialYoutubeTransformativeRightsBlockers,
} = require("./rights-evidence-policy");
const {
  resolveTemporalQaReportPath,
} = require("./candidate-authority-refresh");

const GOAL_ID = "19_autonomy_control_tower";
const DEFAULT_LIVE_PLATFORM_RIGHTS_FAMILIES = ["youtube", "instagram", "facebook"];

const REQUIRED_CONTROL_INPUTS = [
  "story_package_authority",
  "canonical_story_manifest",
  "claim_inventory",
  "script_scorecard",
  "footage_inventory",
  "rights_ledger",
  "director_plan",
  "render_qa",
  "temporal_video_qa",
  "final_av_review",
  "benchmark_report",
  "pulse_media_house_score",
  "policy_report",
  "affiliate_disclosure_report",
  "platform_pack",
  "analytics_risk",
  "anti_spam_report",
  "package_summary",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function objectText(value) {
  return cleanText(collectStrings(value).join(" "));
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function inspectCriticalFinalMedia(
  renderManifest = {},
  workspaceRoot = process.cwd(),
  artifactDir = "",
) {
  const declaredPath = cleanText(
    renderManifest.output_path || renderManifest.output || renderManifest.final_video_path,
  );
  const candidatePaths = unique([
    declaredPath && artifactDir ? resolveWorkspacePath(artifactDir, declaredPath) : "",
    declaredPath ? resolveWorkspacePath(workspaceRoot, declaredPath) : "",
  ]);
  const evidence = {
    declared_path: declaredPath || null,
    resolved_path: candidatePaths[0] || null,
    output_exists: false,
    output_readable: false,
    output_decodable: false,
    output_bytes: null,
    output_sha256: null,
    media_qa_status: "fail",
    media_qa_failures: [],
    media_qa_warnings: [],
  };
  for (const resolvedPath of candidatePaths) {
    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) continue;
      evidence.resolved_path = resolvedPath;
      evidence.output_exists = true;
      evidence.output_bytes = stat.size;
      await fs.access(resolvedPath, fs.constants.R_OK);
      evidence.output_readable = true;
      const fingerprint = await hashReadableFile([resolvedPath]);
      evidence.output_sha256 = fingerprint?.sha256 || null;
      const mediaQa = await runPlatformVideoQa(resolvedPath, { platform: "youtube_shorts" });
      const rawMediaQaStatus = cleanText(mediaQa.result).toLowerCase() || "fail";
      evidence.media_qa_status = rawMediaQaStatus === "skip" ? "fail" : rawMediaQaStatus;
      evidence.media_qa_failures = asArray(mediaQa.failures);
      if (rawMediaQaStatus === "skip") {
        evidence.media_qa_failures.push(`media_probe_unavailable_or_unreadable:${cleanText(mediaQa.reason) || "unknown"}`);
      }
      evidence.media_qa_warnings = asArray(mediaQa.warnings);
      evidence.output_decodable = ["pass", "warn"].includes(evidence.media_qa_status);
      return evidence;
    } catch {
      // Keep trying candidate paths; the evidence object remains fail-closed.
    }
  }
  return evidence;
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function statusPasses(value) {
  return ["pass", "passed", "green", "ready", "clear", "ok", "approved"].includes(normaliseStatus(value));
}

function statusFails(value) {
  const status = normaliseStatus(value);
  if (/^(?:held|hold)(?:_|$)/.test(status)) return true;
  return [
    "fail",
    "failed",
    "red",
    "blocked",
    "blocked_for_review",
    "director_blocked",
    "rewrite_required",
    "high_risk",
  ].includes(status) || /(?:^|_)(?:red|fail|failed|blocked)$/.test(status);
}

function statusAdvisory(value) {
  const status = normaliseStatus(value);
  return [
    "amber",
    "warn",
    "warning",
    "review",
    "human_review",
    "needs_review",
    "needs_human_review",
    "pending",
    "partial",
  ].includes(status) || /(?:^|_)(?:amber|warn|warning|review|pending)(?:$|_)/.test(status);
}

function statusCandidates(value = {}) {
  return [
    value.verdict,
    value.result,
    value.status,
    value.overall_verdict,
    value.final_verdict,
    value.publish_status,
    value.quality_gate_status,
  ].filter((candidate) => cleanText(candidate));
}

function statusFrom(value = {}) {
  const candidates = statusCandidates(value);
  return (
    candidates.find((candidate) => statusFails(candidate)) ||
    candidates.find((candidate) => statusAdvisory(candidate)) ||
    candidates[0] ||
    null
  );
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.reasons),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function warningsFrom(...values) {
  const warnings = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    warnings.push(
      ...asArray(value.warnings),
      ...asArray(value.warning_codes),
      ...asArray(value.advisories),
    );
  }
  return unique(warnings);
}

function applyCriticalWarnings(check = {}, ...values) {
  const authoritativeStatuses = values.map((value) => statusFrom(value)).filter(Boolean);
  const authoritativeRedPresent = authoritativeStatuses.some(statusFails);
  const advisoryStatusPresent = values.some((value) => statusAdvisory(statusFrom(value)));
  const warnings = unique([
    ...asArray(check.warnings),
    ...warningsFrom(...values),
    ...(advisoryStatusPresent ? ["control:critical_input_amber"] : []),
  ]);
  return {
    ...check,
    status: authoritativeRedPresent
      ? "fail"
      : check.status === "pass" && warnings.length
        ? "amber"
        : check.status,
    blockers: unique([
      ...asArray(check.blockers),
      ...(authoritativeRedPresent ? ["control:critical_input_red"] : []),
    ]),
    warnings,
    evidence: {
      ...(check.evidence || {}),
      authoritative_statuses: authoritativeStatuses,
    },
  };
}

function gatePasses(value = {}) {
  if (!hasObject(value)) return false;
  const status = statusFrom(value);
  return !failuresFrom(value).length && (statusPasses(status) || statusAdvisory(status));
}

function gateFails(value = {}) {
  if (!hasObject(value)) return true;
  return failuresFrom(value).length > 0 || statusFails(statusFrom(value));
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function platformVariantReference(output = {}) {
  return cleanText(
    output.variant_video_path ||
      output.platform_video_path ||
      output.video_path ||
      output.platform_variant_render?.output_path ||
      output.platform_variant_render?.video_path,
  );
}

function governanceGate(platformManifest = {}, name) {
  return platformManifest.governance_gates?.[name] || {};
}

function buildCheck({ passed, advisory = false, blocker, requirement, evidence = {}, warnings = [] } = {}) {
  return {
    status: passed ? (advisory ? "amber" : "pass") : "fail",
    blockers: passed ? [] : [blocker],
    warnings: unique(warnings),
    requirement,
    evidence,
  };
}

function checkCanonical(canonical = {}) {
  const passed =
    hasObject(canonical) &&
    Boolean(cleanText(canonical.story_id || canonical.id || canonical.selected_title || canonical.canonical_title || canonical.title)) &&
    Boolean(objectText([canonical.narration_script, canonical.full_script, canonical.selected_title, canonical.canonical_title]));
  return buildCheck({
    passed,
    blocker: "control:canonical_story_manifest_missing",
    requirement: "A canonical story manifest with public title and narration evidence must exist.",
    evidence: {
      present: hasObject(canonical),
      has_public_title: Boolean(cleanText(canonical.selected_title || canonical.canonical_title || canonical.title)),
      has_script: Boolean(objectText([canonical.narration_script, canonical.full_script])),
    },
  });
}

function normaliseClaimList(value) {
  return unique(asArray(value).map(cleanText).filter(Boolean)).sort();
}

function checkClaimInventory(canonical = {}, claimInventory = {}) {
  const canonicalStoryId = cleanText(canonical.story_id || canonical.id);
  const sidecarStoryId = cleanText(claimInventory.story_id || claimInventory.id);
  const canonicalClaims = {
    confirmed: normaliseClaimList(
      canonical.claim_inventory?.confirmed || canonical.confirmed_claims,
    ),
    unconfirmed: normaliseClaimList(
      canonical.claim_inventory?.unconfirmed || canonical.unconfirmed_claims,
    ),
    prohibited: normaliseClaimList(
      canonical.claim_inventory?.prohibited || canonical.prohibited_claims,
    ),
  };
  const sidecarClaims = {
    confirmed: normaliseClaimList(claimInventory.confirmed),
    unconfirmed: normaliseClaimList(claimInventory.unconfirmed),
    prohibited: normaliseClaimList(claimInventory.prohibited),
  };
  const mismatchedFields = Object.keys(canonicalClaims).filter(
    (key) => JSON.stringify(canonicalClaims[key]) !== JSON.stringify(sidecarClaims[key]),
  );
  const passed =
    hasObject(claimInventory) &&
    Boolean(canonicalStoryId) &&
    sidecarStoryId === canonicalStoryId &&
    canonicalClaims.confirmed.length > 0 &&
    mismatchedFields.length === 0;
  return buildCheck({
    passed,
    blocker: "control:claim_inventory_inconsistent",
    requirement:
      "The claim inventory sidecar must identify the same story and exactly match the canonical confirmed, unconfirmed and prohibited claims.",
    evidence: {
      present: hasObject(claimInventory),
      canonical_story_id: canonicalStoryId || null,
      sidecar_story_id: sidecarStoryId || null,
      story_id_matches: Boolean(canonicalStoryId) && sidecarStoryId === canonicalStoryId,
      canonical_confirmed_count: canonicalClaims.confirmed.length,
      sidecar_confirmed_count: sidecarClaims.confirmed.length,
      mismatched_fields: mismatchedFields,
    },
  });
}

function checkScriptScorecard(scorecard = {}) {
  const status = statusFrom(scorecard);
  const viralScore = numeric(scorecard.viral_score, null);
  const localPassStatus =
    ["viral_ready"].includes(normaliseStatus(status)) &&
    Number.isFinite(viralScore) &&
    viralScore >= 75;
  const passed =
    hasObject(scorecard) &&
    !failuresFrom(scorecard).length &&
    !statusFails(status) &&
    (statusPasses(status) || localPassStatus);
  return buildCheck({
    passed,
    blocker: "control:script_scorecard_not_pass",
    requirement: "The script scorecard must be pass/green with no rewrite requirement.",
    evidence: {
      present: hasObject(scorecard),
      status: status || null,
      failures: failuresFrom(scorecard),
      viral_score: viralScore,
    },
  });
}

function materialisedMotionClips(footage = {}) {
  return [
    ...asArray(footage.motion_inventory?.accepted_local_clips),
    ...asArray(footage.materialised_motion_clips),
    ...asArray(footage.motion_clips),
    ...asArray(footage.motion_assets),
  ].filter((clip) => clip && typeof clip === "object");
}

function motionFamilyCount(footage = {}, clips = []) {
  const explicitFamilies = [
    ...asArray(footage.distinct_motion_families),
    ...asArray(footage.distinct_source_families),
  ].map((family) => cleanText(family.id || family.name || family.source_family || family)).filter(Boolean);
  const clipFamilies = clips
    .map((clip) => cleanText(clip.source_family || clip.motion_family || clip.family || clip.sourceFamily || clip.rights_family))
    .filter(Boolean);
  return new Set([...explicitFamilies, ...clipFamilies]).size;
}

function finalVisualMotionPasses({ visualQuality = {}, renderManifest = {}, requiredMotionCount = 1, requiredFamilyCount = 1 } = {}) {
  const profile = visualQuality.visual_evidence_profile || {};
  const visualFailures = unique([...failuresFrom(visualQuality), ...asArray(profile.blockers)]);
  const visualStatus = statusFrom(visualQuality);
  const renderIsFinal = renderManifest.final_publish_render === true;
  const postRenderSource = /actual_materialised_motion_clips|post_render/i.test(
    objectText([visualQuality.benchmark_source, visualQuality.report_type]),
  );
  const motionCount = numeric(
    profile.real_motion_asset_count ||
      profile.direct_video_motion_asset_count ||
      profile.motion_asset_count,
  );
  const familyCount = numeric(
    profile.real_media_family_count ||
      profile.direct_video_motion_family_count ||
      profile.generated_motion_family_count,
  );
  return Boolean(
    renderIsFinal &&
      postRenderSource &&
      hasObject(visualQuality) &&
      !visualFailures.length &&
      statusPasses(visualStatus) &&
      profile.generated_only_motion_deck !== true &&
      motionCount >= requiredMotionCount &&
      familyCount >= requiredFamilyCount,
  );
}

function checkFootageInventory(footage = {}, visualQuality = {}, renderManifest = {}) {
  const status = statusFrom(footage);
  const clips = materialisedMotionClips(footage);
  const motionCount = numeric(
    footage.motion_asset_count ||
      footage.motion_assets?.length ||
      clips.length ||
      footage.real_motion_asset_count ||
      footage.visual_evidence_profile?.motion_asset_count,
  );
  const materialisedFamilyCount = motionFamilyCount(footage, clips);
  const familyCount = numeric(
    footage.distinct_motion_family_count ||
      footage.distinct_motion_families?.length ||
      materialisedFamilyCount ||
      footage.real_media_family_count ||
      footage.visual_evidence_profile?.real_media_family_count,
  );
  const requiredMotionCount = Math.max(1, numeric(footage.motion_budget?.required_motion_scenes, 1));
  const requiredFamilyCount = Math.max(1, numeric(footage.motion_budget?.required_distinct_families, 1));
  const hasTrustedReferences = clips.some((clip) => cleanText(clip.source_url || clip.rights_basis || clip.source_type || clip.source_family));
  const finalMotionPasses = finalVisualMotionPasses({ visualQuality, renderManifest, requiredMotionCount, requiredFamilyCount });
  const blockers = unique([...failuresFrom(footage), ...asArray(footage.readiness?.blockers)]).filter((blocker) => {
    if (blocker === "actual_motion_clip_minimum_not_met" && (motionCount >= requiredMotionCount || finalMotionPasses)) return false;
    if (blocker === "distinct_motion_families_minimum_not_met" && (familyCount >= requiredFamilyCount || finalMotionPasses)) return false;
    if (blocker === "no_trusted_footage_references_for_story" && hasTrustedReferences) return false;
    return true;
  });
  const countEvidencePasses = (motionCount >= requiredMotionCount && familyCount >= requiredFamilyCount) || finalMotionPasses;
  const passed =
    hasObject(footage) &&
    !blockers.length &&
    (statusPasses(status) || (!statusFails(status) && countEvidencePasses));
  return buildCheck({
    passed,
    blocker: "control:footage_inventory_not_pass",
    requirement: "Footage inventory must have usable motion evidence and no source blockers.",
    evidence: {
      present: hasObject(footage),
      status: status || null,
      blockers,
      motion_asset_count: motionCount,
      distinct_motion_family_count: familyCount,
      required_motion_asset_count: requiredMotionCount,
      required_distinct_motion_family_count: requiredFamilyCount,
      final_post_render_motion_evidence_passed: finalMotionPasses,
    },
  });
}

function rightsLedgerRecords(rightsLedger = {}) {
  const records = [
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.rights_ledger),
    ...asArray(rightsLedger.rights_records),
  ].filter((record) => record && typeof record === "object");
  const seen = new Set();
  return records.filter((record) => {
    const identity = JSON.stringify({
      asset_id: assetMatchKey(record.asset_id || record.id || record.clip_id),
      path: assetMatchKey(record.path || record.local_path || record.file || record.output_path),
      source_url: assetMatchKey(record.source_url || record.url),
      licence_basis: assetMatchKey(record.licence_basis || record.license_basis || record.rights_basis),
      evidence: assetMatchKey(
        record.evidence_file ||
          record.evidence_reference ||
          record.licence_evidence ||
          record.license_evidence ||
          record.permission_evidence,
      ),
      allowed_platforms: asArray(record.allowed_platforms || record.platforms)
        .map(platformRightsFamily)
        .sort(),
      commercial_use_allowed: record.commercial_use_allowed === true,
    });
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function assetMatchKey(value) {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function usedMotionAssets(footage = {}, { requireExplicitSelection = false } = {}) {
  return materialisedMotionClips(footage)
    .filter((asset) => requireExplicitSelection
      ? asset.used_in_final_render === true || asset.selected_for_render === true
      : asset.used_in_final_render !== false && asset.selected_for_render !== false)
    .map((asset, index) => ({
      asset_id: cleanText(asset.asset_id || asset.id || asset.clip_id) || `motion_asset_${index + 1}`,
      path: cleanText(asset.path || asset.local_path || asset.file || asset.output_path),
      source_url: cleanText(asset.source_url || asset.url),
    }));
}

function usedRenderedMotionAssets(renderManifest = {}) {
  return asArray(renderManifest.clip_scene_plan?.scenes)
    .filter((scene) => cleanText(scene.path || scene.local_path || scene.media_path))
    .map((scene, index) => ({
      asset_id: cleanText(scene.asset_id || scene.id || scene.clip_id) || `render_scene_${index + 1}`,
      path: cleanText(scene.path || scene.local_path || scene.media_path),
      source_url: cleanText(scene.source_url || scene.url),
    }));
}

function usedRendererSelectedAssets(renderManifest = {}) {
  return asArray(renderManifest.selected_input_assets?.assets)
    .filter((asset) => cleanText(
      asset.path ||
        asset.local_materialized_path ||
        asset.local_materialised_path ||
        asset.file_path,
    ))
    .map((asset, index) => ({
      asset_id: cleanText(asset.asset_id || asset.id) || `renderer_selected_asset_${index + 1}`,
      path: cleanText(
        asset.path ||
          asset.local_materialized_path ||
          asset.local_materialised_path ||
          asset.file_path,
      ),
      source_url: cleanText(asset.source_url || asset.url),
    }));
}

function declaredUsedRightsAssets(rightsLedger = {}) {
  return asArray(rightsLedger.used_assets)
    .filter((asset) => asset && typeof asset === "object")
    .map((asset, index) => ({
      asset_id: cleanText(asset.asset_id || asset.id || asset.clip_id) ||
        `declared_used_asset_${index + 1}`,
      path: cleanText(
        asset.path ||
          asset.local_path ||
          asset.local_materialized_path ||
          asset.local_materialised_path ||
          asset.file ||
          asset.output_path,
      ),
      source_url: cleanText(asset.source_url || asset.url),
    }));
}

function usedRenderedNarrationAssets(renderManifest = {}) {
  const inputEvidence = renderManifest.input_evidence || {};
  const narrationPath = cleanText(
    inputEvidence.resolved_narration_audio_path ||
      inputEvidence.narration_audio_path ||
      renderManifest.resolved_narration_audio_path ||
      renderManifest.narration_audio_path,
  );
  if (!narrationPath) return [];
  const storyId = cleanText(renderManifest.story_id);
  return [{
    asset_id: storyId ? `${storyId}_audio_path` : "final_narration_audio",
    path: narrationPath,
    source_url: "",
  }];
}

function usedSfxAssets(sfxManifest = {}, { requireExplicitSelection = false } = {}) {
  return asArray(sfxManifest.source_plan?.selected_assets)
    .filter((asset) =>
      asset &&
      typeof asset === "object" &&
      (requireExplicitSelection
        ? asset.used_in_final_render === true
        : asset.used_in_final_render !== false))
    .map((asset, index) => ({
      asset_id: cleanText(asset.asset_id || asset.id) || `selected_sfx_${index + 1}`,
      path: cleanText(asset.path || asset.local_path || asset.file),
      source_url: cleanText(asset.source_url || asset.url),
    }));
}

function usedPlatformNativeAssets(platformManifest = {}) {
  const requiredFamilies = new Set(requiredRightsPlatforms(platformManifest));
  return Object.entries(platformOutputs(platformManifest))
    .map(([platform, output]) => {
      const platformOutput = output && typeof output === "object" ? output : {};
      const variantPath = platformVariantReference(platformOutput);
      if (!variantPath || !requiredFamilies.has(platformRightsFamily(platform))) return null;
      return {
        asset_id: cleanText(
          platformOutput.asset_id ||
            platformOutput.platform_variant_render?.asset_id ||
            `platform-native-${platform}`,
        ),
        path: variantPath,
        source_url: "",
        platform,
      };
    })
    .filter(Boolean);
}

function usedAssetIdentity(asset = {}) {
  const pathKey = assetMatchKey(asset.path);
  if (pathKey) return `path:${pathKey}`;
  const assetId = assetMatchKey(asset.asset_id);
  if (assetId) return `id:${assetId}`;
  const sourceUrl = assetMatchKey(asset.source_url);
  return sourceUrl ? `source:${sourceUrl}` : "";
}

function usedRightsAssets(
  footage = {},
  rightsLedger = {},
  renderManifest = {},
  sfxManifest = {},
  platformManifest = {},
) {
  const renderedMotionAssets = usedRenderedMotionAssets(renderManifest);
  const rendererSelectedInputsAreAuthoritative =
    renderManifest.selected_input_assets?.authoritative === true;
  const rendererSelectedSfxCount = asArray(renderManifest.selected_input_assets?.assets)
    .filter((asset) => /sfx|sound_effect/i.test(cleanText(asset.kind || asset.asset_type)))
    .length;
  const legacySfxCueCount = Math.max(
    numeric(sfxManifest.cue_count, 0),
    asArray(sfxManifest.cues).length,
  );
  const legacyManifestDefinesFinalSfx =
    rendererSelectedInputsAreAuthoritative &&
    rendererSelectedSfxCount === 0 &&
    legacySfxCueCount > 0;
  const declaredAssets = asArray(rightsLedger.assets)
    .filter((asset) => asset && typeof asset === "object" && asset.used_in_final_render === true)
    .map((asset, index) => ({
      asset_id: cleanText(asset.asset_id || asset.id || asset.clip_id) || `ledger_asset_${index + 1}`,
      path: cleanText(asset.path || asset.local_path || asset.file || asset.output_path),
      source_url: cleanText(asset.source_url || asset.url),
    }));
  const seen = new Set();
  return [
    ...usedMotionAssets(footage, { requireExplicitSelection: renderedMotionAssets.length > 0 }),
    ...usedRendererSelectedAssets(renderManifest),
    ...renderedMotionAssets,
    ...usedRenderedNarrationAssets(renderManifest),
    ...usedSfxAssets(sfxManifest, {
      requireExplicitSelection:
        rendererSelectedInputsAreAuthoritative &&
        !legacyManifestDefinesFinalSfx,
    }),
    ...usedPlatformNativeAssets(platformManifest),
    ...declaredAssets,
  ].filter((asset) => {
    const key = usedAssetIdentity(asset);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rightsRecordMatchesAsset(record = {}, asset = {}) {
  const recordKeys = [record.asset_id, record.id, record.path, record.local_path, record.source_url, record.url]
    .map(assetMatchKey)
    .filter(Boolean);
  const assetKeys = [asset.asset_id, asset.path, asset.source_url].map(assetMatchKey).filter(Boolean);
  return recordKeys.some((key) => assetKeys.includes(key));
}

function rightsRecordMatchScore(record = {}, asset = {}) {
  const assetId = assetMatchKey(asset.asset_id);
  const assetPath = assetMatchKey(asset.path);
  const assetSourceUrl = assetMatchKey(asset.source_url);
  const recordIds = [record.asset_id, record.id, record.clip_id].map(assetMatchKey).filter(Boolean);
  const recordPaths = [record.path, record.local_path, record.file, record.output_path]
    .map(assetMatchKey)
    .filter(Boolean);
  const recordSourceUrls = [record.source_url, record.url].map(assetMatchKey).filter(Boolean);

  if (assetId && recordIds.includes(assetId)) return 3;
  if (assetPath && recordPaths.includes(assetPath)) return 2;
  if (assetSourceUrl && recordSourceUrls.includes(assetSourceUrl)) return 1;
  return 0;
}

function assignRightsRecords(usedAssets = [], records = []) {
  const assignments = [];
  const assignedAssets = new Set();
  const assignedRecords = new Set();
  const candidates = usedAssets.flatMap((asset, assetIndex) =>
    records.map((record, recordIndex) => ({
      asset,
      assetIndex,
      record,
      recordIndex,
      score: rightsRecordMatchScore(record, asset),
    })),
  )
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) =>
      right.score - left.score || left.assetIndex - right.assetIndex || left.recordIndex - right.recordIndex,
    );

  for (const candidate of candidates) {
    if (assignedAssets.has(candidate.assetIndex) || assignedRecords.has(candidate.recordIndex)) continue;
    assignments.push(candidate);
    assignedAssets.add(candidate.assetIndex);
    assignedRecords.add(candidate.recordIndex);
  }

  return {
    assignments,
    missingAssets: usedAssets.filter((asset, index) => !assignedAssets.has(index)),
  };
}

function platformRightsFamily(value) {
  const platform = normaliseStatus(value);
  if (/^youtube(?:_|$)/.test(platform)) return "youtube";
  if (/^instagram(?:_|$)/.test(platform)) return "instagram";
  if (/^facebook(?:_|$)/.test(platform)) return "facebook";
  if (/^tiktok(?:_|$)/.test(platform)) return "tiktok";
  if (/^(?:x|twitter)(?:_|$)/.test(platform)) return "x";
  if (/^threads(?:_|$)/.test(platform)) return "threads";
  if (/^pinterest(?:_|$)/.test(platform)) return "pinterest";
  return platform;
}

function platformKey(value) {
  if (value && typeof value === "object") {
    return value.platform || value.platform_key || value.key || value.name || value.id;
  }
  return value;
}

function requiredRightsPlatforms(platformManifest = {}) {
  const explicit = unique([
    ...asArray(platformManifest.enabled_platforms),
    ...asArray(platformManifest.live_enabled_platforms),
    ...asArray(platformManifest.publishable_platforms),
  ].map((value) => platformRightsFamily(platformKey(value))).filter(Boolean));
  if (explicit.length) return explicit;

  const outputFamilies = unique(Object.keys(platformOutputs(platformManifest)).map(platformRightsFamily));
  const liveCore = outputFamilies.filter((platform) =>
    DEFAULT_LIVE_PLATFORM_RIGHTS_FAMILIES.includes(platform),
  );
  return liveCore.length ? liveCore : outputFamilies;
}

function incompleteRightsRecordReasons(record = {}, platformManifest = {}) {
  const reasons = [];
  reasons.push(
    ...officialYoutubeTransformativeRightsBlockers(record).map(
      (reason) => `rights:${reason}`,
    ),
  );
  const approvalStatus = normaliseStatus(record.approval_status).replace(/[\s-]+/g, "_");
  const recordVerdict = normaliseStatus(record.verdict).replace(/[\s-]+/g, "_");
  if (!cleanText(record.asset_id || record.id)) reasons.push("rights:asset_id_missing");
  if (!approvalStatus && !recordVerdict) reasons.push("rights:positive_decision_missing");
  if (approvalStatus && !/^approved(?:_|$)/.test(approvalStatus)) {
    reasons.push("rights:approval_status_not_approved");
  }
  if (recordVerdict && !/^(?:green|pass|passed)$/.test(recordVerdict)) {
    reasons.push("rights:verdict_not_pass");
  }
  if (!cleanText(record.licence_basis || record.license_basis || record.rights_basis)) {
    reasons.push("rights:licence_basis_missing");
  }
  if (record.commercial_use_allowed !== true) reasons.push("rights:commercial_use_unclear_or_not_allowed");
  const allowedPlatforms = asArray(record.allowed_platforms || record.platforms).map(platformRightsFamily);
  const requiredPlatforms = requiredRightsPlatforms(platformManifest);
  if (!allowedPlatforms.length) reasons.push("rights:platform_scope_missing");
  else if (requiredPlatforms.some((platform) => !allowedPlatforms.includes(platform))) {
    reasons.push("rights:platform_not_allowed");
  }
  if (!cleanText(
    record.evidence_file ||
      record.evidence_reference ||
      record.licence_evidence ||
      record.license_evidence ||
      record.permission_evidence,
  )) {
    reasons.push("rights:evidence_missing");
  }
  return unique(reasons);
}

function rightsEvidencePathCandidates(value, artifactDir, workspaceRoot) {
  const declared = cleanText(value);
  if (!declared) return [];
  if (path.isAbsolute(declared)) return [path.resolve(declared)];
  return unique([
    artifactDir ? resolveWorkspacePath(artifactDir, declared) : "",
    resolveWorkspacePath(workspaceRoot, declared),
  ]);
}

async function hashReadableFile(candidatePaths = [], cache = new Map()) {
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) continue;
    if (cache.has(candidatePath)) return cache.get(candidatePath);
    try {
      const stat = await fs.stat(candidatePath);
      if (!stat.isFile()) continue;
      await fs.access(candidatePath, fs.constants.R_OK);
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(candidatePath);
      for await (const chunk of stream) hash.update(chunk);
      const result = {
        path: candidatePath,
        sha256: hash.digest("hex"),
        size_bytes: stat.size,
      };
      cache.set(candidatePath, result);
      return result;
    } catch {
      // Try the next artifact/workspace-relative candidate.
    }
  }
  return null;
}

async function inspectRenderRightsReconciliation(
  renderManifest = {},
  artifactDir = "",
  workspaceRoot = process.cwd(),
  cache = new Map(),
) {
  const reconciliation = renderManifest.rights_reconciliation;
  if (!hasObject(reconciliation)) {
    return {
      present: false,
      status: null,
      failures: [],
      warnings: [],
      evidence: {},
    };
  }

  const failures = failuresFrom(reconciliation).map((failure) =>
    `render_rights_reconciliation:${failure}`);
  const warnings = warningsFrom(reconciliation).map((warning) =>
    `render_rights_reconciliation:${warning}`);
  const status = statusFrom(reconciliation);
  if (!status) failures.push("render_rights_reconciliation:status_missing");
  else if (statusFails(status)) failures.push("render_rights_reconciliation:not_green");
  else if (statusAdvisory(status) && !warnings.length) {
    warnings.push("render_rights_reconciliation:critical_status_amber");
  }

  const appliedLedgerStatus = cleanText(reconciliation.applied_ledger_verdict);
  if (appliedLedgerStatus && statusFails(appliedLedgerStatus)) {
    failures.push("render_rights_reconciliation:applied_ledger_not_green");
  } else if (appliedLedgerStatus && statusAdvisory(appliedLedgerStatus)) {
    warnings.push("render_rights_reconciliation:applied_ledger_amber");
  }
  if (reconciliation.final_state_verified !== true) {
    failures.push("render_rights_reconciliation:final_state_not_verified");
  }

  const canonicalLedgerPath = artifactDir
    ? path.resolve(artifactDir, "rights_ledger.json")
    : "";
  const declaredLedgerPath = cleanText(reconciliation.rights_ledger_path);
  const declaredPathCandidates = rightsEvidencePathCandidates(
    declaredLedgerPath,
    artifactDir,
    workspaceRoot,
  );
  if (!declaredLedgerPath) {
    failures.push("render_rights_reconciliation:ledger_path_missing");
  } else if (!declaredPathCandidates.some((candidate) =>
    assetMatchKey(candidate) === assetMatchKey(canonicalLedgerPath))) {
    failures.push("render_rights_reconciliation:ledger_path_mismatch");
  }

  const ledgerFile = await hashReadableFile(
    canonicalLedgerPath ? [canonicalLedgerPath] : declaredPathCandidates,
    cache,
  );
  const expectedLedgerHash = cleanText(reconciliation.applied_ledger_sha256)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  const expectedLedgerSize = numeric(reconciliation.applied_ledger_size_bytes, 0);
  if (!ledgerFile) failures.push("render_rights_reconciliation:ledger_file_missing");
  if (!/^[a-f0-9]{64}$/.test(expectedLedgerHash)) {
    failures.push("render_rights_reconciliation:ledger_hash_missing_or_invalid");
  } else if (ledgerFile && ledgerFile.sha256 !== expectedLedgerHash) {
    failures.push("render_rights_reconciliation:ledger_hash_mismatch");
  }
  if (expectedLedgerSize <= 0) {
    failures.push("render_rights_reconciliation:ledger_size_missing_or_invalid");
  } else if (ledgerFile && ledgerFile.size_bytes !== expectedLedgerSize) {
    failures.push("render_rights_reconciliation:ledger_size_mismatch");
  }

  const usedAssetCount = numeric(reconciliation.used_asset_count, 0);
  const reconciledRecordCount = numeric(reconciliation.reconciled_record_count, 0);
  if (usedAssetCount <= 0) {
    failures.push("render_rights_reconciliation:used_asset_count_missing");
  }
  if (reconciledRecordCount <= 0) {
    failures.push("render_rights_reconciliation:record_count_missing");
  } else if (usedAssetCount > 0 && reconciledRecordCount !== usedAssetCount) {
    failures.push("render_rights_reconciliation:coverage_incomplete");
  }
  if (numeric(reconciliation.duplicate_record_count_after, 0) > 0) {
    failures.push("render_rights_reconciliation:duplicate_records");
  }
  if (statusPasses(status) && reconciliation.can_auto_publish !== true) {
    failures.push("render_rights_reconciliation:auto_publish_not_approved");
  }

  return {
    present: true,
    status,
    failures: unique(failures),
    warnings: unique(warnings),
    evidence: {
      final_state_verified: reconciliation.final_state_verified === true,
      rights_ledger_path: ledgerFile?.path || canonicalLedgerPath || null,
      rights_ledger_sha256: ledgerFile?.sha256 || null,
      rights_ledger_size_bytes: ledgerFile?.size_bytes || 0,
      declared_ledger_sha256: expectedLedgerHash || null,
      declared_ledger_size_bytes: expectedLedgerSize || null,
      used_asset_count: usedAssetCount || null,
      reconciled_record_count: reconciledRecordCount || null,
    },
  };
}

async function inspectRendererSelectedInputs(
  renderManifest = {},
  artifactDir = "",
  workspaceRoot = process.cwd(),
  cache = new Map(),
) {
  const selected = renderManifest.selected_input_assets;
  const failures = [];
  const assets = asArray(selected?.assets);
  if (!hasObject(selected)) {
    failures.push("renderer_selected_inputs:missing");
  } else {
    if (numeric(selected.schema_version, 0) < 2) {
      failures.push("renderer_selected_inputs:schema_not_hash_bound");
    }
    if (selected.authoritative !== true) {
      failures.push("renderer_selected_inputs:not_authoritative");
    }
    if (selected.complete !== true) {
      failures.push("renderer_selected_inputs:not_complete");
    }
    for (const blocker of asArray(selected.blockers)) {
      failures.push(`renderer_selected_inputs:${cleanText(blocker)}`);
    }
    if (!assets.length) failures.push("renderer_selected_inputs:asset_inventory_missing");
    if (numeric(selected.asset_count, 0) !== assets.length) {
      failures.push("renderer_selected_inputs:asset_count_mismatch");
    }
  }

  const rows = [];
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const [index, asset] of assets.entries()) {
    const assetId = cleanText(asset.asset_id || asset.id) ||
      `renderer_selected_asset_${index + 1}`;
    const identity = assetMatchKey(assetId);
    const declaredPath = cleanText(
      asset.path ||
        asset.local_materialized_path ||
        asset.local_materialised_path ||
        asset.file_path,
    );
    const pathCandidates = rightsEvidencePathCandidates(
      declaredPath,
      artifactDir,
      workspaceRoot,
    );
    const pathIdentity = pathCandidates.map(assetMatchKey).find(Boolean) || "";
    if (!identity) failures.push(`renderer_selected_inputs:asset_id_missing:${index + 1}`);
    else if (seenIds.has(identity)) {
      failures.push(`renderer_selected_inputs:asset_id_duplicate:${assetId}`);
    } else {
      seenIds.add(identity);
    }
    if (!declaredPath) {
      failures.push(`renderer_selected_inputs:asset_path_missing:${assetId}`);
    } else if (pathIdentity && seenPaths.has(pathIdentity)) {
      failures.push(`renderer_selected_inputs:asset_path_duplicate:${assetId}`);
    } else if (pathIdentity) {
      seenPaths.add(pathIdentity);
    }
    const current = await hashReadableFile(pathCandidates, cache);
    const expectedHash = cleanText(
      asset.asset_sha256 || asset.sha256 || asset.content_sha256,
    ).replace(/^sha256:/i, "").toLowerCase();
    const expectedSize = numeric(
      asset.asset_size_bytes || asset.size_bytes || asset.file_size_bytes,
      0,
    );
    if (!current) {
      failures.push(`renderer_selected_inputs:asset_file_missing_or_unreadable:${assetId}`);
    }
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      failures.push(`renderer_selected_inputs:asset_hash_missing_or_invalid:${assetId}`);
    } else if (current && current.sha256 !== expectedHash) {
      failures.push(`renderer_selected_inputs:asset_hash_mismatch:${assetId}`);
    }
    if (expectedSize <= 0) {
      failures.push(`renderer_selected_inputs:asset_size_missing_or_invalid:${assetId}`);
    } else if (current && current.size_bytes !== expectedSize) {
      failures.push(`renderer_selected_inputs:asset_size_mismatch:${assetId}`);
    }
    rows.push({
      asset_id: assetId,
      kind: cleanText(asset.kind) || null,
      declared_path: declaredPath || null,
      resolved_path: current?.path || null,
      expected_sha256: expectedHash || null,
      current_sha256: current?.sha256 || null,
      expected_size_bytes: expectedSize || null,
      current_size_bytes: current?.size_bytes || null,
      verified: Boolean(
        current &&
          expectedHash === current.sha256 &&
          expectedSize === current.size_bytes
      ),
    });
  }

  const selectedPathKeys = new Set(
    rows.map((row) => assetMatchKey(row.resolved_path || row.declared_path)).filter(Boolean),
  );
  for (const required of [
    ...usedRenderedMotionAssets(renderManifest),
    ...usedRenderedNarrationAssets(renderManifest),
  ]) {
    const requiredPaths = rightsEvidencePathCandidates(
      required.path,
      artifactDir,
      workspaceRoot,
    ).map(assetMatchKey);
    if (!requiredPaths.some((candidate) => selectedPathKeys.has(candidate))) {
      failures.push(
        `renderer_selected_inputs:render_asset_coverage_missing:${required.asset_id}`,
      );
    }
  }

  return {
    present: hasObject(selected),
    status: failures.length ? "fail" : "pass",
    failures: unique(failures),
    evidence: {
      schema_version: numeric(selected?.schema_version, 0) || null,
      authoritative: selected?.authoritative === true,
      complete: selected?.complete === true,
      declared_asset_count: numeric(selected?.asset_count, 0),
      verified_asset_count: rows.filter((row) => row.verified).length,
      assets: rows,
    },
  };
}

async function inspectRightsAssignment(
  assignment = {},
  artifactDir = "",
  workspaceRoot = process.cwd(),
  cache = new Map(),
) {
  const record = assignment.record || {};
  const asset = assignment.asset || {};
  const selectedAssetPath = cleanText(asset.path);
  const recordAssetPath = cleanText(record.path || record.local_path || record.file || record.output_path);
  const assetDeclaredPath = selectedAssetPath || recordAssetPath;
  const evidenceDeclaredPath = cleanText(
    record.evidence_file || record.licence_evidence || record.license_evidence || record.permission_evidence,
  );
  const expectedAssetHash = cleanText(record.asset_sha256 || record.sha256).toLowerCase();
  const expectedAssetSize = numeric(record.asset_size_bytes || record.size_bytes, 0);
  const expectedEvidenceHash = cleanText(record.evidence_sha256).toLowerCase();
  const expectedEvidenceSize = numeric(record.evidence_size_bytes, 0);
  const selectedAssetPathCandidates = rightsEvidencePathCandidates(
    selectedAssetPath,
    artifactDir,
    workspaceRoot,
  );
  const recordAssetPathCandidates = rightsEvidencePathCandidates(
    recordAssetPath,
    artifactDir,
    workspaceRoot,
  );
  const selectedPathKeys = new Set(selectedAssetPathCandidates.map(assetMatchKey));
  const recordPathMatchesSelected = !selectedAssetPath || recordAssetPathCandidates
    .map(assetMatchKey)
    .some((candidate) => selectedPathKeys.has(candidate));
  const assetFile = await hashReadableFile(
    selectedAssetPath ? selectedAssetPathCandidates : recordAssetPathCandidates,
    cache,
  );
  const evidenceFile = await hashReadableFile(
    rightsEvidencePathCandidates(evidenceDeclaredPath, artifactDir, workspaceRoot),
    cache,
  );
  const reasons = [];

  if (selectedAssetPath && !recordPathMatchesSelected) reasons.push("rights:asset_path_mismatch");
  if (!assetDeclaredPath) reasons.push("rights:asset_path_missing");
  else if (!assetFile) reasons.push("rights:asset_file_missing_or_unreadable");
  if (!/^[a-f0-9]{64}$/.test(expectedAssetHash)) reasons.push("rights:asset_hash_missing_or_invalid");
  else if (assetFile && assetFile.sha256 !== expectedAssetHash) reasons.push("rights:asset_hash_mismatch");
  if (expectedAssetSize <= 0) reasons.push("rights:asset_size_missing_or_invalid");
  else if (assetFile && assetFile.size_bytes !== expectedAssetSize) reasons.push("rights:asset_size_mismatch");

  if (!evidenceDeclaredPath) reasons.push("rights:evidence_file_missing");
  else if (!evidenceFile) reasons.push("rights:evidence_file_missing_or_unreadable");
  if (!/^[a-f0-9]{64}$/.test(expectedEvidenceHash)) reasons.push("rights:evidence_hash_missing_or_invalid");
  else if (evidenceFile && evidenceFile.sha256 !== expectedEvidenceHash) reasons.push("rights:evidence_hash_mismatch");
  if (expectedEvidenceSize <= 0) reasons.push("rights:evidence_size_missing_or_invalid");
  else if (evidenceFile && evidenceFile.size_bytes !== expectedEvidenceSize) {
    reasons.push("rights:evidence_size_mismatch");
  }

  return {
    asset_id: cleanText(asset.asset_id),
    record_asset_id: cleanText(record.asset_id || record.id || record.clip_id),
    asset_path: assetFile?.path || assetDeclaredPath || null,
    evidence_path: evidenceFile?.path || evidenceDeclaredPath || null,
    asset_hash_verified: Boolean(assetFile && expectedAssetHash === assetFile.sha256),
    asset_size_verified: Boolean(assetFile && expectedAssetSize === assetFile.size_bytes),
    evidence_hash_verified: Boolean(evidenceFile && expectedEvidenceHash === evidenceFile.sha256),
    evidence_size_verified: Boolean(evidenceFile && expectedEvidenceSize === evidenceFile.size_bytes),
    reasons: unique(reasons),
  };
}

async function checkRightsLedger(
  rightsLedger = {},
  platformManifest = {},
  footage = {},
  renderManifest = {},
  sfxManifest = {},
  workspaceRoot = process.cwd(),
  artifactDir = "",
) {
  const gate = governanceGate(platformManifest, "rights_ledger");
  const records = rightsLedgerRecords(rightsLedger);
  const usedAssets = usedRightsAssets(
    footage,
    rightsLedger,
    renderManifest,
    sfxManifest,
    platformManifest,
  );
  const sfxCueCount = Math.max(numeric(sfxManifest.cue_count), asArray(sfxManifest.cues).length);
  const selectedSfxAssets = usedSfxAssets(sfxManifest);
  const requiredPlatforms = requiredRightsPlatforms(platformManifest);
  const { assignments, missingAssets } = assignRightsRecords(usedAssets, records);
  const matchedRecords = assignments.map(({ record }) => record);
  const staticIncompleteRecordReasons = unique(
    matchedRecords.flatMap((record) => incompleteRightsRecordReasons(record, platformManifest)),
  );
  const fileCache = new Map();
  const materialEvidence = await Promise.all(assignments.map((assignment) =>
    inspectRightsAssignment(assignment, artifactDir, workspaceRoot, fileCache)));
  const renderRightsReconciliation = await inspectRenderRightsReconciliation(
    renderManifest,
    artifactDir,
    workspaceRoot,
    fileCache,
  );
  const rendererSelectedInputs = await inspectRendererSelectedInputs(
    renderManifest,
    artifactDir,
    workspaceRoot,
    fileCache,
  );
  const rendererSelectedAssets = usedRendererSelectedAssets(renderManifest);
  const declaredUsedAssets = declaredUsedRightsAssets(rightsLedger);
  const strictUsedAssetDeclarationRequired =
    numeric(rightsLedger.schema_version, 0) >= 2 ||
    Array.isArray(rightsLedger.used_assets);
  const declaredUsedAssignments = assignRightsRecords(
    rendererSelectedAssets,
    declaredUsedAssets,
  );
  const assignedDeclaredIndexes = new Set(
    declaredUsedAssignments.assignments.map((assignment) => assignment.recordIndex),
  );
  const extraneousDeclaredUsedAssets = declaredUsedAssets.filter(
    (_asset, index) => !assignedDeclaredIndexes.has(index),
  );
  const declaredUsedAssetSetMismatch =
    strictUsedAssetDeclarationRequired &&
    (
      declaredUsedAssignments.missingAssets.length > 0 ||
      extraneousDeclaredUsedAssets.length > 0
    );
  const materialEvidenceReasons = unique(materialEvidence.flatMap((item) => item.reasons));
  const incompleteRecordReasons = unique([
    ...staticIncompleteRecordReasons,
    ...materialEvidenceReasons,
  ]);
  const failures = unique([
    ...failuresFrom(rightsLedger),
    ...failuresFrom(gate),
    ...renderRightsReconciliation.failures,
    ...rendererSelectedInputs.failures,
    ...(usedAssets.length ? [] : ["rights:used_asset_inventory_missing"]),
    ...(sfxCueCount > 0 && !selectedSfxAssets.length
      ? ["rights:sfx_selected_asset_inventory_missing"]
      : []),
    ...(strictUsedAssetDeclarationRequired && !declaredUsedAssets.length
      ? ["rights:declared_used_asset_inventory_missing"]
      : []),
    ...(declaredUsedAssetSetMismatch
      ? ["rights:declared_used_asset_set_mismatch"]
      : []),
    ...(missingAssets.length ? ["rights:no_rights_record"] : []),
    ...incompleteRecordReasons,
  ]);
  const passed =
    hasObject(rightsLedger) &&
    records.length > 0 &&
    usedAssets.length > 0 &&
    !failures.length &&
    (gatePasses(rightsLedger) || gatePasses(gate));
  return buildCheck({
    passed,
    advisory: renderRightsReconciliation.warnings.length > 0,
    blocker: "control:rights_ledger_not_pass",
    requirement: "Rights ledger must pass and carry no unresolved rights failures.",
    warnings: renderRightsReconciliation.warnings,
    evidence: {
      present: hasObject(rightsLedger),
      status: statusFrom(rightsLedger) || statusFrom(gate) || null,
      rights_record_count: records.length,
      used_asset_count: usedAssets.length,
      matched_asset_count: usedAssets.length - missingAssets.length,
      sfx_cue_count: sfxCueCount,
      selected_sfx_asset_count: selectedSfxAssets.length,
      required_platforms: requiredPlatforms,
      missing_asset_ids: missingAssets.map((asset) => asset.asset_id),
      renderer_selected_asset_count: rendererSelectedAssets.length,
      declared_used_asset_count: declaredUsedAssets.length,
      missing_declared_used_asset_ids:
        declaredUsedAssignments.missingAssets.map((asset) => asset.asset_id),
      extraneous_declared_used_asset_ids:
        extraneousDeclaredUsedAssets.map((asset) => asset.asset_id),
      incomplete_record_reasons: incompleteRecordReasons,
      materially_verified_asset_count: materialEvidence.filter((item) =>
        item.asset_hash_verified &&
        item.asset_size_verified &&
        item.evidence_hash_verified &&
        item.evidence_size_verified).length,
      material_evidence: materialEvidence,
      render_rights_reconciliation: renderRightsReconciliation,
      renderer_selected_inputs: rendererSelectedInputs,
      failures,
    },
  });
}

function checkDirectorPlan(directorPlan = {}, visualQuality = {}, renderManifest = {}) {
  const readiness = directorPlan.readiness || {};
  const status = statusFrom(readiness) || statusFrom(directorPlan);
  const requiredMotionCount = Math.max(1, numeric(directorPlan.shot_budget?.min_actual_motion_clips, 1));
  const requiredFamilyCount = Math.max(1, numeric(directorPlan.shot_budget?.min_distinct_motion_families, 1));
  const finalMotionPasses = finalVisualMotionPasses({ visualQuality, renderManifest, requiredMotionCount, requiredFamilyCount });
  const blockers = unique([...failuresFrom(directorPlan), ...failuresFrom(readiness)]).filter((blocker) => {
    if (blocker === "actual_motion_clip_minimum_not_met" && finalMotionPasses) return false;
    if (blocker === "distinct_motion_families_minimum_not_met" && finalMotionPasses) return false;
    return true;
  });
  const hasPlan = asArray(directorPlan.shot_plan || directorPlan.beats || directorPlan.plan).length > 0;
  const passed =
    hasObject(directorPlan) &&
    hasPlan &&
    !blockers.length &&
    (statusPasses(status) || !statusFails(status) || finalMotionPasses);
  return buildCheck({
    passed,
    blocker: "control:director_plan_not_pass",
    requirement: "Director plan must be ready and include an executable shot plan.",
    evidence: {
      present: hasObject(directorPlan),
      status: status || null,
      shot_count: asArray(directorPlan.shot_plan || directorPlan.beats || directorPlan.plan).length,
      blockers,
      final_post_render_motion_evidence_passed: finalMotionPasses,
    },
  });
}

function checkRenderQa(
  renderManifest = {},
  visualQuality = {},
  finalMedia = {},
  inputLineage = {},
) {
  const renderStatus = statusFrom(renderManifest);
  const visualStatus = statusFrom(visualQuality);
  const finalRender = renderManifest.final_publish_render === true;
  const premiumShellStatus = normaliseStatus(
    renderManifest.premium_shell_verdict || renderManifest.premium_shell_status,
  );
  const premiumShellBlockers = unique(
    asArray(renderManifest.premium_shell_blockers).map(cleanText).filter(Boolean),
  );
  const premiumShellFails =
    ["thin", "placeholder", "legacy", "fallback"].includes(premiumShellStatus) ||
    statusFails(premiumShellStatus) ||
    premiumShellBlockers.length > 0;
  const sceneCount = asArray(renderManifest.clip_scene_plan?.scenes).length;
  const inputEvidence = renderManifest.input_evidence || {};
  const narrationInputPresent = Boolean(cleanText(
    inputEvidence.resolved_narration_audio_path ||
      inputEvidence.narration_audio_path ||
      renderManifest.resolved_narration_audio_path ||
      renderManifest.narration_audio_path,
  ));
  const timestampInputPresent = Boolean(cleanText(
    inputEvidence.resolved_word_timestamps_path ||
      inputEvidence.word_timestamps_path ||
      renderManifest.resolved_word_timestamps_path ||
      renderManifest.word_timestamps_path,
  ));
  const failures = unique([
    ...failuresFrom(renderManifest),
    ...failuresFrom(visualQuality),
    ...(premiumShellFails
      ? [`render:premium_shell_not_green:${premiumShellStatus || "blocked"}`]
      : []),
    ...premiumShellBlockers,
    ...(finalRender && sceneCount === 0 ? ["render:final_scene_inventory_missing"] : []),
    ...(finalRender && !narrationInputPresent ? ["audio:final_narration_input_missing"] : []),
    ...(finalRender && !timestampInputPresent ? ["captions:final_word_timestamps_input_missing"] : []),
    ...(finalRender ? asArray(inputLineage.blockers) : []),
  ]);
  const hasOutput = Boolean(cleanText(renderManifest.output_path || renderManifest.output || renderManifest.final_video_path));
  const visualQualityPasses = hasObject(visualQuality)
    ? gatePasses(visualQuality)
    : statusPasses(renderStatus);
  const passed =
    hasObject(renderManifest) &&
    finalRender &&
    hasOutput &&
    finalMedia.output_exists === true &&
    finalMedia.output_readable === true &&
    finalMedia.output_decodable === true &&
    inputLineage.pass === true &&
    visualQualityPasses &&
    !failures.length;
  return buildCheck({
    passed,
    blocker: "control:render_qa_not_pass",
    requirement: "Render manifest must represent a final publish render with passing QA evidence.",
    evidence: {
      present: hasObject(renderManifest),
      final_publish_render: finalRender,
      final_scene_count: sceneCount,
      narration_input_present: narrationInputPresent,
      word_timestamps_input_present: timestampInputPresent,
      output_present: hasOutput,
      output_exists: finalMedia.output_exists === true,
      output_readable: finalMedia.output_readable === true,
      output_decodable: finalMedia.output_decodable === true,
      output_bytes: finalMedia.output_bytes ?? null,
      resolved_output_path: finalMedia.resolved_path || null,
      media_qa_status: finalMedia.media_qa_status || "fail",
      media_qa_failures: asArray(finalMedia.media_qa_failures),
      media_qa_warnings: asArray(finalMedia.media_qa_warnings),
      input_lineage_passed: inputLineage.pass === true,
      input_lineage_blockers: asArray(inputLineage.blockers),
      input_lineage_evidence: inputLineage.evidence || null,
      render_status: renderStatus || null,
      visual_quality_status: visualStatus || null,
      premium_shell_status: premiumShellStatus || null,
      premium_shell_blockers: premiumShellBlockers,
      failures,
    },
  });
}

function checkFinalAvReview(validation = {}) {
  const passed = validation.valid === true && validation.verdict === "GREEN";
  return {
    status: passed ? "pass" : "fail",
    blockers: passed
      ? []
      : unique(["control:final_av_review_not_pass", ...asArray(validation.blockers)]),
    warnings: unique(asArray(validation.warnings)),
    requirement:
      validation.requirement ||
      "A current independent final AV review must pass before Goal 19 can return GREEN.",
    evidence: validation.evidence || {},
  };
}

function checkTemporalVideoQa(validation = {}) {
  const passed = validation.valid === true && validation.verdict === "GREEN";
  return {
    status: passed ? "pass" : validation.verdict === "AMBER" ? "amber" : "fail",
    blockers: passed
      ? []
      : unique([
          "control:temporal_video_qa_not_pass",
          ...asArray(validation.blockers),
        ]),
    warnings: unique(asArray(validation.warnings)),
    requirement:
      "A current hash-bound temporal QA report must prove full audio-video decode, complete timeline coverage, zero repeated motion and clean cadence.",
    evidence: validation.evidence || {},
  };
}

function checkBenchmarkReport(benchmark = {}) {
  const passed = gatePasses(benchmark);
  return buildCheck({
    passed,
    blocker: "control:benchmark_report_not_pass",
    requirement: "Benchmark report must pass with no reference-pack failures.",
    evidence: {
      present: hasObject(benchmark),
      status: statusFrom(benchmark) || null,
      failures: failuresFrom(benchmark),
      warnings: asArray(benchmark.warnings),
    },
  });
}

function checkPulseMediaHouseScore(score = {}) {
  const scores = score.scores || {};
  const hardFailures = asArray(score.hard_failures);
  const status = cleanText(statusFrom(score));
  const overall = numeric(scores.overall_media_house_score, 0);
  const parity = numeric(scores.competitor_parity_score, 0);
  const firstThree = numeric(scores.first_3_seconds_score, 0);
  const sourceLock = numeric(scores.source_lock_score, 0);
  const advisoryWarnings = unique([
    ...asArray(score.warnings),
    ...(status.toUpperCase() === "AMBER" ? ["control:pulse_media_house_score_amber"] : []),
  ]);
  const passed =
    hasObject(score) &&
    hardFailures.length === 0 &&
    ["GREEN", "AMBER", "PASS", "PASSED", "READY"].includes(status.toUpperCase()) &&
    overall >= 78 &&
    parity >= 72 &&
    firstThree >= 70 &&
    sourceLock >= 70;
  return buildCheck({
    passed,
    advisory: passed && advisoryWarnings.length > 0,
    warnings: advisoryWarnings,
    blocker: "control:pulse_media_house_score_not_pass",
    requirement: "Pulse Media-House Score must pass competitor-informed quality thresholds before GREEN.",
    evidence: {
      present: hasObject(score),
      status: status || null,
      overall_media_house_score: overall,
      competitor_parity_score: parity,
      competitor_surpass_score: numeric(scores.competitor_surpass_score, 0),
      first_3_seconds_score: firstThree,
      source_lock_score: sourceLock,
      hard_failures: hardFailures,
    },
  });
}

function checkPolicyReport(policyReport = {}, platformManifest = {}) {
  const gate = governanceGate(platformManifest, "platform_policy_gate");
  const publishBlockers = asArray(policyReport.publish_blockers);
  const failures = unique([...failuresFrom(policyReport), ...failuresFrom(gate), ...publishBlockers]);
  const status = statusFrom(policyReport) || statusFrom(gate);
  const passed =
    !failures.length &&
    ((hasObject(policyReport) && statusPasses(status)) ||
      gatePasses(gate) ||
      (hasObject(policyReport) && !publishBlockers.length && !statusFails(status)));
  return buildCheck({
    passed,
    blocker: "control:policy_report_not_pass",
    requirement: "Policy report must pass and expose no publish blockers.",
    evidence: {
      present: hasObject(policyReport) || hasObject(gate),
      status: status || null,
      publish_blockers: publishBlockers,
      failures,
    },
  });
}

function disclosureRequired(affiliate = {}, platformManifest = {}) {
  return Boolean(
    affiliate.disclosure_required === true ||
      affiliate.affiliate_disclosure_required === true ||
      /affiliate|commission|paid promotion|commercial content/i.test(objectText(platformManifest)),
  );
}

function disclosurePresent(affiliate = {}, platformManifest = {}) {
  return Boolean(
    objectText(affiliate.disclosure_copy).length ||
      objectText(affiliate.disclosure).length ||
      objectText(platformOutputs(platformManifest)).match(/affiliate links may earn|paid promotion|commercial content/i),
  );
}

function checkAffiliateDisclosure(affiliate = {}, platformManifest = {}) {
  const required = disclosureRequired(affiliate, platformManifest);
  const present = disclosurePresent(affiliate, platformManifest);
  const failures = failuresFrom(affiliate, governanceGate(platformManifest, "affiliate_disclosure_gate"));
  const passed = !failures.length && (!required || (hasObject(affiliate) && present));
  return buildCheck({
    passed,
    blocker: "control:affiliate_disclosure_not_pass",
    requirement: "Affiliate or commercial disclosure must be present wherever required.",
    evidence: {
      present: hasObject(affiliate),
      disclosure_required: required,
      disclosure_present: present,
      failures,
    },
  });
}

function platformVariantExpectedHash(output = {}) {
  return cleanText(
    output.variant_sha256 ||
      output.video_sha256 ||
      output.output_sha256 ||
      output.platform_variant_render?.sha256 ||
      output.platform_variant_render?.output_sha256,
  ).toLowerCase();
}

function platformVariantExpectedSize(output = {}) {
  return numeric(
    output.variant_size_bytes ||
      output.video_size_bytes ||
      output.output_size_bytes ||
      output.size_bytes ||
      output.platform_variant_render?.size_bytes ||
      output.platform_variant_render?.output_size_bytes,
    0,
  );
}

function platformVariantSourceRenderHash(output = {}) {
  return cleanText(
    output.source_render_sha256 ||
      output.source_video_sha256 ||
      output.parent_render_sha256 ||
      output.final_render_sha256 ||
      output.platform_variant_render?.source_render_sha256 ||
      output.platform_variant_render?.source_video_sha256 ||
      output.platform_variant_render?.parent_render_sha256,
  ).toLowerCase();
}

function enabledPlatformOutputEntries(platformManifest = {}) {
  const outputs = platformOutputs(platformManifest);
  const explicitlyEnabled = [
    ...asArray(platformManifest.enabled_platforms),
    ...asArray(platformManifest.live_enabled_platforms),
    ...asArray(platformManifest.publishable_platforms),
  ].map(platformKey).map(cleanText).filter(Boolean);
  const required = explicitlyEnabled.length ? unique(explicitlyEnabled) : Object.keys(outputs);
  return required.map((platform) => {
    const exact = outputs[platform];
    if (exact && typeof exact === "object") return [platform, exact];
    const family = platformRightsFamily(platform);
    const match = Object.entries(outputs).find(([key]) => platformRightsFamily(key) === family);
    return [platform, match?.[1] && typeof match[1] === "object" ? match[1] : {}];
  });
}

async function inspectPlatformVariant(
  platform,
  output = {},
  finalMedia = {},
  workspaceRoot = process.cwd(),
  artifactDir = "",
) {
  const failures = [];
  const warnings = [];
  const declaredPath = platformVariantReference(output);
  if (!declaredPath) {
    failures.push(`platform_pack:${platform}:variant_path_missing`);
    return {
      platform,
      declared_path: null,
      resolved_path: null,
      decodable: false,
      failures,
      warnings,
    };
  }

  const candidatePaths = unique([
    artifactDir ? resolveWorkspacePath(artifactDir, declaredPath) : "",
    resolveWorkspacePath(workspaceRoot, declaredPath),
  ]);
  const fingerprint = await hashReadableFile(candidatePaths);
  const expectedHash = platformVariantExpectedHash(output);
  const expectedSize = platformVariantExpectedSize(output);
  const sourceRenderHash = platformVariantSourceRenderHash(output);
  const currentRenderHash = cleanText(finalMedia.output_sha256).toLowerCase();

  if (!fingerprint) failures.push(`platform_pack:${platform}:variant_missing_or_unreadable`);
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    failures.push(`platform_pack:${platform}:variant_hash_missing_or_invalid`);
  } else if (fingerprint && fingerprint.sha256 !== expectedHash) {
    failures.push(`platform_pack:${platform}:variant_hash_mismatch`);
  }
  if (expectedSize <= 0) {
    failures.push(`platform_pack:${platform}:variant_size_missing_or_invalid`);
  } else if (fingerprint && fingerprint.size_bytes !== expectedSize) {
    failures.push(`platform_pack:${platform}:variant_size_mismatch`);
  }
  if (!/^[a-f0-9]{64}$/.test(sourceRenderHash)) {
    failures.push(`platform_pack:${platform}:source_render_hash_missing_or_invalid`);
  } else if (!currentRenderHash || sourceRenderHash !== currentRenderHash) {
    failures.push(`platform_pack:${platform}:source_render_hash_mismatch`);
  }

  let mediaQa = null;
  let decodable = false;
  if (fingerprint) {
    try {
      mediaQa = await runPlatformVideoQa(fingerprint.path, { platform });
      const qaStatus = normaliseStatus(mediaQa.result);
      decodable = ["pass", "warn"].includes(qaStatus);
      if (!decodable) {
        failures.push(
          `platform_pack:${platform}:variant_not_decodable:${cleanText(mediaQa.reason) || qaStatus || "unknown"}`,
        );
      }
      warnings.push(...asArray(mediaQa.warnings).map((warning) =>
        `platform_pack:${platform}:${warning}`));
      failures.push(...asArray(mediaQa.failures).map((failure) =>
        `platform_pack:${platform}:${failure}`));
    } catch (error) {
      failures.push(
        `platform_pack:${platform}:variant_not_decodable:${cleanText(error?.message) || "probe_failed"}`,
      );
    }
  }

  return {
    platform,
    declared_path: declaredPath,
    resolved_path: fingerprint?.path || candidatePaths[0] || null,
    actual_sha256: fingerprint?.sha256 || null,
    expected_sha256: expectedHash || null,
    actual_size_bytes: fingerprint?.size_bytes || null,
    expected_size_bytes: expectedSize || null,
    source_render_sha256: sourceRenderHash || null,
    current_render_sha256: currentRenderHash || null,
    decodable,
    media_qa_result: mediaQa?.result || null,
    failures: unique(failures),
    warnings: unique(warnings),
  };
}

async function checkPlatformPack(
  platformManifest = {},
  publishVerdict = {},
  finalMedia = {},
  workspaceRoot = process.cwd(),
  artifactDir = "",
) {
  const outputs = platformOutputs(platformManifest);
  const manifestStatus = cleanText(statusFrom(platformManifest));
  const verdictStatus = cleanText(statusFrom(publishVerdict));
  const authoritativeRed = statusFails(manifestStatus) || statusFails(verdictStatus);
  const authoritativeAmber = statusAdvisory(manifestStatus) || statusAdvisory(verdictStatus);
  const status = authoritativeRed
    ? "RED"
    : authoritativeAmber
      ? "AMBER"
      : manifestStatus || verdictStatus;
  const outputCount = Object.keys(outputs || {}).length;
  const requiredOutputs = enabledPlatformOutputEntries(platformManifest);
  const variantEvidence = await Promise.all(
    requiredOutputs.map(([platform, output]) =>
      inspectPlatformVariant(
        platform,
        output,
        finalMedia,
        workspaceRoot,
        artifactDir,
      )),
  );
  const failures = unique([
    ...failuresFrom(platformManifest, publishVerdict),
    ...variantEvidence.flatMap((row) => row.failures),
    ...(requiredOutputs.length ? [] : ["platform_pack:no_enabled_platform_outputs"]),
    ...(platformManifest.can_auto_publish === true
      ? []
      : ["platform_pack:manifest_auto_publish_not_approved"]),
    ...(publishVerdict.can_auto_publish === true
      ? []
      : ["platform_pack:verdict_auto_publish_not_approved"]),
  ]);
  const warnings = unique(variantEvidence.flatMap((row) => row.warnings));
  const passed =
    hasObject(platformManifest) &&
    hasObject(publishVerdict) &&
    outputCount > 0 &&
    requiredOutputs.length > 0 &&
    !authoritativeRed &&
    manifestStatus.toUpperCase() === "GREEN" &&
    verdictStatus.toUpperCase() === "GREEN" &&
    !failures.length;
  return buildCheck({
    passed,
    advisory: passed && warnings.length > 0,
    blocker: "control:platform_pack_not_green",
    requirement:
      "Every enabled platform must have a GREEN, materialised, decodable native video variant bound by current hashes to the final render.",
    evidence: {
      present: hasObject(platformManifest),
      status: status || null,
      output_count: outputCount,
      required_platform_count: requiredOutputs.length,
      verified_variant_count: variantEvidence.filter((row) =>
        row.decodable && !row.failures.length).length,
      variants: variantEvidence,
      can_auto_publish:
        platformManifest.can_auto_publish === true &&
        publishVerdict.can_auto_publish === true,
      failures,
    },
    warnings,
  });
}

function packageSummaryStatusObjects(packageSummary = {}) {
  return [
    packageSummary,
    packageSummary.publish_verdict,
    packageSummary.package_verdict,
    packageSummary.control_tower,
    packageSummary.readiness,
  ].filter((value) => hasObject(value));
}

function checkPackageSummary(packageSummary = {}) {
  if (!hasObject(packageSummary)) {
    return buildCheck({
      passed: true,
      blocker: "control:package_summary_red",
      requirement: "A present package summary must never contradict downstream GREEN evidence.",
      evidence: { present: false, status: null, failures: [] },
    });
  }
  const statusObjects = packageSummaryStatusObjects(packageSummary);
  const statuses = statusObjects.map((value) => statusFrom(value)).filter(Boolean);
  const failures = unique(statusObjects.flatMap((value) => failuresFrom(value)));
  const red = statuses.some(statusFails) || failures.length > 0;
  const amber = !red && statuses.some(statusAdvisory);
  return buildCheck({
    passed: !red,
    advisory: amber,
    warnings: amber ? ["control:package_summary_amber"] : [],
    blocker: "control:package_summary_red",
    requirement: "A present package summary must never contradict downstream GREEN evidence.",
    evidence: {
      present: true,
      status: red ? "RED" : amber ? "AMBER" : statuses[0] || null,
      statuses,
      failures,
    },
  });
}

function checkStoryPackageAuthority(storyPackage = {}) {
  const status = statusFrom(storyPackage);
  const failures = failuresFrom(storyPackage);
  const reportedWarnings = warningsFrom(storyPackage);
  const red = statusFails(status) || failures.length > 0;
  const amber = !red && (statusAdvisory(status) || reportedWarnings.length > 0);
  return buildCheck({
    passed: !red,
    advisory: amber,
    warnings: amber
      ? unique([...reportedWarnings, ...(statusAdvisory(status) ? ["control:story_package_amber"] : [])])
      : [],
    blocker: "control:story_package_red",
    requirement: "The authoritative story-package row must not be RED, blocked or warning-bearing before GREEN.",
    evidence: {
      present: hasObject(storyPackage),
      status: red ? "RED" : amber ? "AMBER" : status || null,
      failures,
      warnings: reportedWarnings,
    },
  });
}

function checkAnalyticsRisk(analytics = {}) {
  const failures = failuresFrom(analytics);
  const status = statusFrom(analytics);
  const metricCount = asArray(analytics.required_metrics || analytics.metrics || analytics.metrics_required).length;
  const hasPlan = metricCount > 0 || hasObject(analytics.analytics_risk) || hasObject(analytics.metric_risk);
  const passed = hasObject(analytics) && hasPlan && !failures.length && !statusFails(status);
  return buildCheck({
    passed,
    blocker: "control:analytics_risk_missing",
    requirement: "Analytics risk or dry-run ingest plan must exist before final publish verdict.",
    evidence: {
      present: hasObject(analytics),
      status: status || null,
      metric_count: metricCount,
      dry_run_only: analytics.dry_run_only === true,
      failures,
    },
  });
}

function checkAntiSpam(uniqueness = {}, platformManifest = {}) {
  const antiSpamGate = governanceGate(platformManifest, "anti_spam_uniqueness_gate");
  const failures = unique([...failuresFrom(uniqueness), ...failuresFrom(antiSpamGate)]);
  const passed = !failures.length && (gatePasses(uniqueness) || gatePasses(antiSpamGate));
  return buildCheck({
    passed,
    blocker: "control:anti_spam_not_pass",
    requirement: "Anti-spam and uniqueness report must pass.",
    evidence: {
      uniqueness_report_present: hasObject(uniqueness),
      gate_present: hasObject(antiSpamGate),
      status: statusFrom(uniqueness) || statusFrom(antiSpamGate) || null,
      failures,
    },
  });
}

function buildGoal18Index(upstreamFirewallReport = {}) {
  const rows = new Map();
  for (const row of asArray(upstreamFirewallReport.stories || upstreamFirewallReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) rows.set(storyId, row);
  }
  return {
    rows,
    report: {
      status: statusFrom(upstreamFirewallReport),
      blockers: failuresFrom(upstreamFirewallReport),
      warnings: warningsFrom(upstreamFirewallReport),
    },
  };
}

function upstreamRow(storyId, firewallIndex = {}) {
  const rows = firewallIndex instanceof Map ? firewallIndex : firewallIndex.rows;
  return rows instanceof Map ? rows.get(cleanText(storyId)) : null;
}

function upstreamReport(firewallIndex = {}) {
  return firewallIndex instanceof Map ? {} : firewallIndex.report || {};
}

function upstreamSkippedInfo(storyId, firewallIndex = {}) {
  const row = upstreamRow(storyId, firewallIndex);
  if (normaliseStatus(statusFrom(row || {})) !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status) || "skipped",
    reason: cleanText(row.skipped_reason || row.reason) || "upstream_firewall_skipped",
  };
}

function upstreamBlockers(storyId, firewallIndex = {}) {
  const row = upstreamRow(storyId, firewallIndex);
  if (!row) return ["upstream:goal18_finance_crypto_firewall_missing"];
  const report = upstreamReport(firewallIndex);
  const rowStatus = statusFrom(row);
  const reportStatus = report.status;
  const blockers = unique([...asArray(row.blockers), ...asArray(report.blockers)]);
  if (
    blockers.length ||
    statusFails(rowStatus) ||
    statusFails(reportStatus) ||
    (!statusPasses(rowStatus) && !statusAdvisory(rowStatus))
  ) {
    return unique(["upstream:goal18_finance_crypto_firewall_blocked", ...blockers]);
  }
  return [];
}

function upstreamWarnings(storyId, firewallIndex = {}) {
  const row = upstreamRow(storyId, firewallIndex);
  if (!row) return [];
  const report = upstreamReport(firewallIndex);
  const rowStatus = statusFrom(row);
  const reportStatus = report.status;
  return unique([
    ...warningsFrom(row),
    ...asArray(report.warnings),
    ...(statusAdvisory(rowStatus) || statusAdvisory(reportStatus)
      ? ["upstream:goal18_finance_crypto_firewall_amber"]
      : []),
  ]);
}

function humanApproval({ canonical = {}, platformManifest = {}, publishVerdict = {}, storyPackage = {} } = {}) {
  const required = Boolean(
    storyPackage.human_review_required === true ||
      storyPackage.requires_human_review === true ||
      canonical.human_review_required === true ||
      platformManifest.human_review_required === true ||
      statusAdvisory(statusFrom(publishVerdict)) ||
      statusAdvisory(statusFrom(platformManifest)),
  );
  return {
    required,
    reason: cleanText(
      storyPackage.human_review_reason ||
        canonical.human_review_reason ||
        platformManifest.human_review_reason ||
        publishVerdict.human_review_reason ||
        "Human approval required before publishing.",
    ),
  };
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const skipped = upstreamSkippedInfo(storyId, context.firewallIndex);
  if (skipped) {
    return {
      story_id: storyId,
      title: cleanText(storyPackage.title),
      artifact_dir: artifactDir,
      final_verdict: "SKIPPED",
      status: "skipped",
      can_auto_publish: false,
      publish_action: "none_skipped",
      approval_required: false,
      approval_reason: null,
      direct_control_tower_status: "skipped",
      upstream_status: "skipped",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      blockers: [],
      upstream_blockers: [],
      direct_control_tower_blockers: [],
      control_inputs: {},
      risk_profile: {
        story_id: storyId,
        final_verdict: "SKIPPED",
        risk_level: "skipped",
        risk_categories: [],
        direct_blockers: [],
        upstream_blockers: [],
      },
      source_material: {},
      safety: {
        local_proof_only: true,
        dry_run_publish_only: true,
        no_publish_triggered: true,
        no_external_posting: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_secret_values_exposed: true,
      },
    };
  }
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const claimInventory = await readJsonIfPresent(path.join(artifactDir, "claim_inventory.json"), {});
  const scriptScorecard = await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {});
  const footageInventory = await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {});
  const rightsLedger = await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {});
  const directorPlan = await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const finalMedia = await inspectCriticalFinalMedia(
    renderManifest,
    context.workspaceRoot,
    artifactDir,
  );
  const temporalVideoQaReportPath = await resolveTemporalQaReportPath({
    artifactDir,
    storyId,
    renderFingerprint: {
      sha256: finalMedia.output_sha256 || "",
      size_bytes: finalMedia.output_bytes,
    },
  });
  const temporalVideoQaReport = await readJsonIfPresent(
    temporalVideoQaReportPath,
    {},
  );
  const sfxManifest = await readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {});
  const visualQuality = await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {});
  const benchmark = await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {});
  const pulseMediaHouseScore = await readJsonIfPresent(path.join(artifactDir, "pulse_media_house_score.json"), {});
  const policyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const analytics = await readJsonIfPresent(path.join(artifactDir, "analytics_ingest_plan.json"), {});
  const uniqueness = await readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {});
  const publishVerdict = await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"), {});
  const packageSummary = await readJsonIfPresent(path.join(artifactDir, "goal_package_summary.json"), {});
  const temporalVideoQa = validateTemporalVideoQaReport(
    temporalVideoQaReport,
    {
      storyId,
      renderSha256: finalMedia.output_sha256 || "",
      renderSizeBytes: finalMedia.output_bytes,
    },
  );
  const finalAvReview = await validateFinalAvReviewFile(path.join(artifactDir, "final_av_review.json"), {
    storyId,
    artifactDir,
    finalMp4Path: finalMedia.resolved_path || cleanText(
      renderManifest.output_path || renderManifest.output || renderManifest.final_video_path,
    ),
  });
  let inputLineage;
  try {
    inputLineage = verifyFinalRenderInputLineage(
      { ...storyPackage, artifact_dir: artifactDir },
      renderManifest,
    );
  } catch (error) {
    inputLineage = {
      pass: false,
      blockers: ["final_render_input_lineage_unreadable"],
      error: cleanText(error && error.message) || "unknown lineage verification error",
    };
  }

  const controlInputs = {
    story_package_authority: checkStoryPackageAuthority(storyPackage),
    canonical_story_manifest: checkCanonical(canonical),
    claim_inventory: checkClaimInventory(canonical, claimInventory),
    script_scorecard: checkScriptScorecard(scriptScorecard),
    footage_inventory: checkFootageInventory(footageInventory, visualQuality, renderManifest),
    rights_ledger: await checkRightsLedger(
      rightsLedger,
      platformManifest,
      footageInventory,
      renderManifest,
      sfxManifest,
      context.workspaceRoot,
      artifactDir,
    ),
    director_plan: checkDirectorPlan(directorPlan, visualQuality, renderManifest),
    render_qa: checkRenderQa(renderManifest, visualQuality, finalMedia, inputLineage),
    temporal_video_qa: checkTemporalVideoQa(temporalVideoQa),
    final_av_review: checkFinalAvReview(finalAvReview),
    benchmark_report: checkBenchmarkReport(benchmark),
    pulse_media_house_score: checkPulseMediaHouseScore(pulseMediaHouseScore),
    policy_report: checkPolicyReport(policyReport, platformManifest),
    affiliate_disclosure_report: checkAffiliateDisclosure(affiliate, platformManifest),
    platform_pack: await checkPlatformPack(
      platformManifest,
      publishVerdict,
      finalMedia,
      context.workspaceRoot,
      artifactDir,
    ),
    analytics_risk: checkAnalyticsRisk(analytics),
    anti_spam_report: checkAntiSpam(uniqueness, platformManifest),
    package_summary: checkPackageSummary(packageSummary),
  };
  controlInputs.canonical_story_manifest = applyCriticalWarnings(controlInputs.canonical_story_manifest, canonical);
  controlInputs.claim_inventory = applyCriticalWarnings(controlInputs.claim_inventory, claimInventory);
  controlInputs.script_scorecard = applyCriticalWarnings(controlInputs.script_scorecard, scriptScorecard);
  controlInputs.footage_inventory = applyCriticalWarnings(
    controlInputs.footage_inventory,
    footageInventory,
    footageInventory.readiness,
  );
  controlInputs.rights_ledger = applyCriticalWarnings(
    controlInputs.rights_ledger,
    rightsLedger,
    governanceGate(platformManifest, "rights_ledger"),
  );
  controlInputs.director_plan = applyCriticalWarnings(
    controlInputs.director_plan,
    directorPlan,
    directorPlan.readiness,
  );
  controlInputs.render_qa = applyCriticalWarnings(
    controlInputs.render_qa,
    renderManifest,
    visualQuality,
    { warnings: finalMedia.media_qa_warnings },
  );
  controlInputs.temporal_video_qa = applyCriticalWarnings(
    controlInputs.temporal_video_qa,
    temporalVideoQaReport,
  );
  controlInputs.benchmark_report = applyCriticalWarnings(controlInputs.benchmark_report, benchmark);
  controlInputs.pulse_media_house_score = applyCriticalWarnings(
    controlInputs.pulse_media_house_score,
    pulseMediaHouseScore,
  );
  controlInputs.policy_report = applyCriticalWarnings(
    controlInputs.policy_report,
    policyReport,
    governanceGate(platformManifest, "platform_policy_gate"),
  );
  controlInputs.affiliate_disclosure_report = applyCriticalWarnings(
    controlInputs.affiliate_disclosure_report,
    affiliate,
    governanceGate(platformManifest, "affiliate_disclosure_gate"),
  );
  controlInputs.platform_pack = applyCriticalWarnings(controlInputs.platform_pack, platformManifest, publishVerdict);
  controlInputs.analytics_risk = applyCriticalWarnings(controlInputs.analytics_risk, analytics);
  controlInputs.anti_spam_report = applyCriticalWarnings(
    controlInputs.anti_spam_report,
    uniqueness,
    governanceGate(platformManifest, "anti_spam_uniqueness_gate"),
  );
  controlInputs.package_summary = applyCriticalWarnings(
    controlInputs.package_summary,
    packageSummary,
    packageSummary.publish_verdict,
    packageSummary.package_verdict,
    packageSummary.control_tower,
    packageSummary.readiness,
  );
  const directBlockers = unique(Object.values(controlInputs).flatMap((check) => asArray(check.blockers)));
  const directWarnings = unique(
    Object.entries(controlInputs).flatMap(([name, check]) =>
      check.status === "amber"
        ? asArray(check.warnings).length
          ? asArray(check.warnings)
          : [`control:${name}_amber`]
        : [],
    ),
  );
  const upstream = upstreamBlockers(storyId, context.firewallIndex);
  const upstreamAdvisories = upstreamWarnings(storyId, context.firewallIndex);
  const approval = humanApproval({ canonical, platformManifest, publishVerdict, storyPackage });
  const finalVerdict = directBlockers.length || upstream.length
    ? "RED"
    : approval.required || directWarnings.length || upstreamAdvisories.length
      ? "AMBER"
      : "GREEN";
  const canAutoPublish =
    finalVerdict === "GREEN" &&
    platformManifest.can_auto_publish === true &&
    publishVerdict.can_auto_publish === true &&
    cleanText(statusFrom(platformManifest)).toUpperCase() === "GREEN" &&
    cleanText(statusFrom(publishVerdict)).toUpperCase() === "GREEN";
  const blockers = unique([...upstream, ...directBlockers]);

  return {
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || canonical.canonical_title || storyPackage.title),
    artifact_dir: artifactDir,
    final_verdict: finalVerdict,
    status: finalVerdict === "GREEN" ? "ready" : finalVerdict === "AMBER" ? "needs_human_review" : "blocked",
    can_auto_publish: canAutoPublish,
    publish_action: finalVerdict === "GREEN" ? "none_local_proof_dry_run_only" : finalVerdict === "AMBER" ? "none_human_review_required" : "none_blocked",
    approval_required: approval.required || finalVerdict !== "GREEN",
    approval_reason: approval.required
      ? approval.reason
      : upstreamAdvisories.length
        ? "Goal 18 upstream evidence requires review before publishing."
        : null,
    direct_control_tower_status: directBlockers.length ? "blocked" : directWarnings.length ? "amber" : "pass",
    upstream_status: upstream.length ? "blocked" : upstreamAdvisories.length ? "amber" : "ready",
    blockers,
    upstream_blockers: upstream,
    upstream_warnings: upstreamAdvisories,
    direct_control_tower_blockers: directBlockers,
    direct_control_tower_warnings: directWarnings,
    control_inputs: controlInputs,
    risk_profile: {
      story_id: storyId,
      final_verdict: finalVerdict,
      risk_level: finalVerdict === "RED" ? "high" : finalVerdict === "AMBER" ? "medium" : "low",
      risk_categories: unique([
        ...(upstream.length ? ["upstream_dependency"] : []),
        ...(upstreamAdvisories.length ? ["upstream_dependency_warning"] : []),
        ...(directBlockers.length ? ["control_input"] : []),
        ...(directWarnings.length ? ["control_input_warning"] : []),
        ...(approval.required ? ["human_approval"] : []),
      ]),
      direct_blockers: directBlockers,
      upstream_blockers: upstream,
      upstream_warnings: upstreamAdvisories,
    },
    source_material: {
      canonical_story_manifest_present: hasObject(canonical),
      script_scorecard_present: hasObject(scriptScorecard),
      footage_inventory_present: hasObject(footageInventory),
      rights_ledger_present: hasObject(rightsLedger),
      director_plan_present: hasObject(directorPlan),
      render_manifest_present: hasObject(renderManifest),
      temporal_video_qa_report_present: hasObject(temporalVideoQaReport),
      final_av_review_present: finalAvReview.evidence?.present === true,
      sfx_manifest_present: hasObject(sfxManifest),
      benchmark_report_present: hasObject(benchmark),
      pulse_media_house_score_present: hasObject(pulseMediaHouseScore),
      policy_report_present: hasObject(policyReport),
      affiliate_manifest_present: hasObject(affiliate),
      platform_publish_manifest_present: hasObject(platformManifest),
      analytics_ingest_plan_present: hasObject(analytics),
      uniqueness_report_present: hasObject(uniqueness),
    },
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function countBy(stories = [], key) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const value of asArray(story[key])) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_control_tower_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildPublishVerdict(report = {}) {
  const activeStories = asArray(report.stories).filter((story) => story.status !== "skipped");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "DRY_RUN_PUBLISH",
    overall_verdict: report.verdict || "UNKNOWN",
    publish_now_count: 0,
    green_story_count: report.summary?.green_story_count || 0,
    amber_story_count: report.summary?.amber_story_count || 0,
    red_story_count: report.summary?.red_story_count || 0,
    stories: activeStories.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      verdict: story.final_verdict,
      can_auto_publish: story.can_auto_publish === true,
      publish_action: story.publish_action,
      approval_required: story.approval_required === true,
      blockers: story.blockers,
      upstream_blockers: story.upstream_blockers,
      upstream_warnings: story.upstream_warnings,
      direct_control_tower_blockers: story.direct_control_tower_blockers,
      direct_control_tower_warnings: story.direct_control_tower_warnings,
    })),
    safety: {
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_production_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function buildRiskReport(report = {}) {
  const stories = asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => story.risk_profile);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    overall_risk_level:
      stories.some((story) => story.risk_level === "high") ? "high" : stories.some((story) => story.risk_level === "medium") ? "medium" : "low",
    risk_category_counts: countBy(stories, "risk_categories"),
    stories,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
    },
  };
}

function buildRejectionReasons(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    stories: asArray(report.stories).filter((story) => story.status !== "skipped").map((story) => ({
      story_id: story.story_id,
      final_verdict: story.final_verdict,
      rejected: story.final_verdict === "RED",
      direct_reasons: story.direct_control_tower_blockers,
      upstream_reasons: story.upstream_blockers,
      all_reasons: story.blockers,
      direct_warnings: story.direct_control_tower_warnings,
      upstream_warnings: story.upstream_warnings,
      all_warnings: unique([
        ...asArray(story.direct_control_tower_warnings),
        ...asArray(story.upstream_warnings),
      ]),
    })),
    safety: {
      no_public_output_mutation: true,
      no_publish_triggered: true,
    },
  };
}

function buildApprovalRequirements(report = {}) {
  const activeStories = asArray(report.stories).filter((story) => story.status !== "skipped");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    human_operator_required: activeStories.some((story) => story.final_verdict !== "GREEN"),
    stories: activeStories.map((story) => {
      if (story.final_verdict === "GREEN") {
        return {
          story_id: story.story_id,
          status: "no_approval_required",
          requirements: [],
        };
      }
      if (story.final_verdict === "AMBER") {
        return {
          story_id: story.story_id,
          status: "human_review_required",
          requirements: ["human_approval_required"],
          reason: story.approval_reason,
        };
      }
      return {
        story_id: story.story_id,
        status: "blocked_until_repairs",
        requirements: unique([
          ...(story.upstream_blockers.length ? ["resolve_goal18_and_upstream_campaign_blockers"] : []),
          ...(story.direct_control_tower_blockers.length ? ["repair_direct_control_tower_inputs"] : []),
          "rerun_goal19_autonomy_control_tower",
        ]),
        blockers: story.blockers,
      };
    }),
    safety: {
      no_approval_record_mutation: true,
      no_publish_triggered: true,
    },
  };
}

async function buildGoal19AutonomyControlTower({
  storyPackages = [],
  upstreamFirewallReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal19AutonomyControlTower requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const firewallIndex = buildGoal18Index(upstreamFirewallReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, firewallIndex }));
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const greenStories = activeStories.filter((story) => story.final_verdict === "GREEN");
  const amberStories = activeStories.filter((story) => story.final_verdict === "AMBER");
  const redStories = activeStories.filter((story) => story.final_verdict === "RED");
  const directPassStories = activeStories.filter((story) => story.direct_control_tower_status === "pass");
  const directAmberStories = activeStories.filter((story) => story.direct_control_tower_status === "amber");
  const directBlockedStories = activeStories.filter((story) => story.direct_control_tower_status === "blocked");
  const upstreamBlockedStories = activeStories.filter((story) => story.upstream_status === "blocked");
  const verdict = !activeStories.length
    ? "FAIL"
    : redStories.length && greenStories.length + amberStories.length
      ? "PARTIAL"
      : redStories.length
        ? "BLOCKED"
        : amberStories.length
          ? "PARTIAL"
          : "PASS";
  const directControlTowerVerdict = !activeStories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length + directAmberStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : directAmberStories.length
          ? "PARTIAL"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_control_tower_verdict: directControlTowerVerdict,
    final_verdict_contract: {
      GREEN: "safe to auto-publish after operator enables live publish controls",
      AMBER: "usable but requires human approval",
      RED: "blocked",
    },
    summary: {
      story_count: stories.length,
      active_story_count: activeStories.length,
      skipped_story_count: skippedStories.length,
      green_story_count: greenStories.length,
      amber_story_count: amberStories.length,
      red_story_count: redStories.length,
      control_ready_story_count: greenStories.length,
      blocked_story_count: redStories.length,
      human_review_story_count: amberStories.length,
      direct_control_tower_pass_story_count: directPassStories.length,
      direct_control_tower_amber_story_count: directAmberStories.length,
      direct_control_tower_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      publish_now_count: 0,
    },
    required_control_inputs: REQUIRED_CONTROL_INPUTS,
    blocker_counts: blockerCounts(activeStories),
    direct_risk_counts: directRiskCounts(activeStories),
    upstream_blockers: {
      goal18_finance_and_crypto_firewall:
        "Goal 19 can inspect final verdict inputs locally, but readiness requires Goal 18 and all earlier campaign gates to be ready first.",
      note:
        "This gate emits LOCAL_PROOF and DRY_RUN_PUBLISH artefacts only. It does not publish, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.publish_verdict = buildPublishVerdict(report);
  report.risk_report = buildRiskReport(report);
  report.rejection_reasons = buildRejectionReasons(report);
  report.approval_requirements = buildApprovalRequirements(report);
  return report;
}

function renderGoal19AutonomyControlTowerMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 19 Autonomy Control Tower");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct control tower verdict: ${report.direct_control_tower_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`GREEN stories: ${report.summary?.green_story_count || 0}`);
  lines.push(`AMBER stories: ${report.summary?.amber_story_count || 0}`);
  lines.push(`RED stories: ${report.summary?.red_story_count || 0}`);
  lines.push(`Direct control-pass stories: ${report.summary?.direct_control_tower_pass_story_count || 0}`);
  lines.push(`Direct control-blocked stories: ${report.summary?.direct_control_tower_blocked_story_count || 0}`);
  lines.push(`Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct control input blockers");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF and DRY_RUN_PUBLISH only. This run did not publish, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal19AutonomyControlTower(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal19AutonomyControlTower requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal19_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal19_readiness_report.md");
  const publishVerdict = path.join(outDir, "publish_verdict.json");
  const riskReport = path.join(outDir, "risk_report.json");
  const rejectionReasons = path.join(outDir, "rejection_reasons.json");
  const approvalRequirements = path.join(outDir, "approval_requirements.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal19AutonomyControlTowerMarkdown(report), "utf8");
  await fs.writeJson(publishVerdict, report.publish_verdict || buildPublishVerdict(report), { spaces: 2 });
  await fs.writeJson(riskReport, report.risk_report || buildRiskReport(report), { spaces: 2 });
  await fs.writeJson(rejectionReasons, report.rejection_reasons || buildRejectionReasons(report), { spaces: 2 });
  await fs.writeJson(approvalRequirements, report.approval_requirements || buildApprovalRequirements(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    publishVerdict,
    riskReport,
    rejectionReasons,
    approvalRequirements,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_CONTROL_INPUTS,
  buildApprovalRequirements,
  buildGoal19AutonomyControlTower,
  buildPublishVerdict,
  buildRejectionReasons,
  buildRiskReport,
  checkRightsLedger,
  checkFinalAvReview,
  inspectCriticalFinalMedia,
  inspectStoryPackage,
  renderGoal19AutonomyControlTowerMarkdown,
  writeGoal19AutonomyControlTower,
};
