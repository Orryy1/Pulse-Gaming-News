"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { buildPlatformNativePublishPacks } = require("./goal-proof-package");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");

const PLATFORM_PACK_FILES = {
  youtube_shorts: "youtube_publish_pack.json",
  tiktok: "tiktok_publish_pack.json",
  instagram_reels: "instagram_publish_pack.json",
  facebook_reels: "facebook_publish_pack.json",
  x: "x_publish_pack.json",
  threads: "threads_publish_pack.json",
  pinterest: "pinterest_publish_pack.json",
};

const PUBLIC_PLACEHOLDER_RE = /\b(?:source_locked_update|source locked update|practical catch)\b/i;
const PLATFORM_PUBLIC_COPY_FAILURE_RE =
  /^public_copy:platform_(?:copy_missing_canonical_subject|source_label_mismatch)$/;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function safeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, "-");
}

function affiliateOutputSnapshot(outputs = {}) {
  return {
    youtube_disclosure_required: outputs.youtube_shorts?.disclosure_status?.required === true,
    youtube_disclosure_type: cleanText(outputs.youtube_shorts?.disclosure_status?.type),
    youtube_landing_cta: cleanText(outputs.youtube_shorts?.profile_or_landing_page_cta),
    youtube_description_route: cleanText(outputs.youtube_shorts?.description),
    tiktok_disclosure_flag: cleanText(outputs.tiktok?.disclosure_flag),
    tiktok_product_link_eligibility: cleanText(outputs.tiktok?.product_link_eligibility),
    instagram_bio_link_cta: cleanText(outputs.instagram_reels?.bio_link_cta),
    pinterest_disclosure: cleanText(outputs.pinterest?.disclosure),
  };
}

function snapshotsDiffer(left = {}, right = {}) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

async function inspectArtifact(storyPackage = {}, { generatedAt = new Date().toISOString() } = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
  const storyId = storyPackage.story_id || storyPackage.id || "unknown";
  const blockers = [];
  if (!artifactDir) blockers.push("missing_artifact_dir");
  if (artifactDir && !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");

  const canonical = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"))
    : {};
  const platformManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"))
    : {};
  const affiliateManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"))
    : {};
  const landingPage = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"))
    : {};

  if (!Object.keys(canonical).length) blockers.push("canonical_manifest_missing");
  if (!Object.keys(platformManifest).length) blockers.push("platform_manifest_missing");

  const native = buildPlatformNativePublishPacks({
    story: {
      id: storyId,
      canonical_subject: canonical.canonical_subject,
      canonical_game: canonical.canonical_game,
      canonical_angle: canonical.canonical_angle,
      public_title: canonical.selected_title || canonical.canonical_title || canonical.title,
      suggested_thumbnail_text: canonical.thumbnail_headline,
      primary_source: canonical.primary_source,
      source_name: canonical.primary_source?.name || canonical.primary_source,
      hook: canonical.first_spoken_line,
      full_script: canonical.narration_script || canonical.first_spoken_line || "",
      affiliate_link_manifest: affiliateManifest,
    },
    canonical,
    platformOutputs: platformManifest.outputs || {},
    affiliateManifest,
    landingPage,
  });

  const currentPublicCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    platform_publish_manifest: platformManifest,
    landing_page_manifest: landingPage,
  });
  const targetPlatformManifest = {
    ...platformManifest,
    outputs: native.outputs,
    platform_native_evidence: native.platformNativeEvidence,
  };
  const targetPublicCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    platform_publish_manifest: targetPlatformManifest,
    landing_page_manifest: landingPage,
  });
  const currentPlatformFailures = asArray(currentPublicCopyQa.failures).filter((failure) =>
    PLATFORM_PUBLIC_COPY_FAILURE_RE.test(failure),
  );
  const targetPlatformFailures = asArray(targetPublicCopyQa.failures).filter((failure) =>
    PLATFORM_PUBLIC_COPY_FAILURE_RE.test(failure),
  );
  if (targetPlatformFailures.length) {
    blockers.push("target_platform_public_copy_still_fails");
  }

  const evidence = platformManifest.platform_native_evidence || {};
  const hasAllNativeOutputs = Object.keys(PLATFORM_PACK_FILES).every((platform) =>
    Boolean(platformManifest.outputs?.[platform]),
  );
  const currentPublicOutputText = JSON.stringify(platformManifest.outputs || {});
  const publicPlaceholderLeak = PUBLIC_PLACEHOLDER_RE.test(currentPublicOutputText);
  const formatSignatureMissingOrStale =
    !cleanText(evidence.format_signature) ||
    cleanText(evidence.format_signature) !== cleanText(native.platformNativeEvidence.format_signature);
  const affiliateOutputStale = snapshotsDiffer(
    affiliateOutputSnapshot(platformManifest.outputs || {}),
    affiliateOutputSnapshot(native.outputs || {}),
  );
  const needsRepair =
    evidence.verdict !== "pass" ||
    !hasAllNativeOutputs ||
    native.platformNativeEvidence.verdict !== "pass" ||
    formatSignatureMissingOrStale ||
    affiliateOutputStale ||
    currentPlatformFailures.length > 0 ||
    publicPlaceholderLeak;

  return {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    status: blockers.length ? "blocked" : needsRepair ? "repairable" : "already_native",
    blockers,
    current_native_verdict: evidence.verdict || "missing",
    target_native_verdict: native.platformNativeEvidence.verdict,
    current_public_copy_verdict: currentPublicCopyQa.verdict,
    target_public_copy_verdict: targetPublicCopyQa.verdict,
    current_public_copy_failures: currentPlatformFailures,
    target_public_copy_failures: targetPlatformFailures,
    public_placeholder_leak: publicPlaceholderLeak,
    current_format_signature: cleanText(evidence.format_signature) || null,
    target_format_signature: cleanText(native.platformNativeEvidence.format_signature) || null,
    affiliate_output_stale: affiliateOutputStale,
    current_affiliate_output: affiliateOutputSnapshot(platformManifest.outputs || {}),
    target_affiliate_output: affiliateOutputSnapshot(native.outputs || {}),
    target_outputs: native.outputs,
    target_evidence: native.platformNativeEvidence,
    generated_at: generatedAt,
  };
}

async function backupIfPresent(filePath, backupDir) {
  if (!(await fs.pathExists(filePath))) return null;
  await fs.ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(filePath));
  await fs.copy(filePath, backupPath, { overwrite: true });
  return backupPath;
}

async function applyRepair(item = {}, { generatedAt = new Date().toISOString(), backupRoot = "" } = {}) {
  const artifactDir = item.artifact_dir;
  const backupDir = backupRoot
    ? path.join(path.resolve(backupRoot), item.story_id)
    : path.join(artifactDir, ".native-pack-backup", safeTimestamp(generatedAt));
  const platformManifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const variantScorecardPath = path.join(artifactDir, "platform_variant_scorecard.json");
  const platformManifest = await readJsonIfPresent(platformManifestPath);
  const variantScorecard = await readJsonIfPresent(variantScorecardPath);
  const backupFiles = {
    platform_publish_manifest: await backupIfPresent(platformManifestPath, backupDir),
    platform_variant_scorecard: await backupIfPresent(variantScorecardPath, backupDir),
  };

  const repairedPlatformManifest = {
    ...platformManifest,
    outputs: item.target_outputs,
    platform_native_evidence: item.target_evidence,
    platform_native_repaired_at: generatedAt,
    no_publish_triggered: true,
  };
  const repairedVariantScorecard = {
    ...variantScorecard,
    outputs: item.target_outputs,
    platform_native_evidence: item.target_evidence,
    platform_native_repaired_at: generatedAt,
  };

  await fs.writeJson(platformManifestPath, repairedPlatformManifest, { spaces: 2 });
  await fs.writeJson(variantScorecardPath, repairedVariantScorecard, { spaces: 2 });

  for (const [platform, basename] of Object.entries(PLATFORM_PACK_FILES)) {
    const filePath = path.join(artifactDir, basename);
    backupFiles[platform] = await backupIfPresent(filePath, backupDir);
    await fs.writeJson(filePath, item.target_outputs[platform] || {}, { spaces: 2 });
  }

  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    backup_dir: backupDir,
    backup_files: backupFiles,
    repaired_files: [
      platformManifestPath,
      variantScorecardPath,
      ...Object.values(PLATFORM_PACK_FILES).map((basename) => path.join(artifactDir, basename)),
    ],
  };
}

async function repairPlatformNativePacks({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  apply = false,
  backupRoot = "",
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectArtifact(storyPackage, { generatedAt }));
  }
  const repairable = inspected.filter((item) => item.status === "repairable");
  const repairs = [];
  if (apply) {
    for (const item of repairable) {
      repairs.push(await applyRepair(item, { generatedAt, backupRoot }));
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "APPLY_NATIVE_PACK_REPAIR" : "DRY_RUN_NATIVE_PACK_REPAIR",
    summary: {
      story_count: inspected.length,
      repairable_count: repairable.length,
      repaired_count: repairs.length,
      already_native_count: inspected.filter((item) => item.status === "already_native").length,
      blocked_count: inspected.filter((item) => item.status === "blocked").length,
    },
    items: inspected.map((item) => ({
      story_id: item.story_id,
      artifact_dir: item.artifact_dir,
      status: item.status,
      blockers: item.blockers,
      current_native_verdict: item.current_native_verdict,
      target_native_verdict: item.target_native_verdict,
      current_public_copy_verdict: item.current_public_copy_verdict,
      target_public_copy_verdict: item.target_public_copy_verdict,
      current_public_copy_failures: item.current_public_copy_failures,
      target_public_copy_failures: item.target_public_copy_failures,
      public_placeholder_leak: item.public_placeholder_leak,
      affiliate_output_stale: item.affiliate_output_stale,
      current_affiliate_output: item.current_affiliate_output,
      target_affiliate_output: item.target_affiliate_output,
      current_format_signature: item.current_format_signature,
      target_format_signature: item.target_format_signature,
    })),
    repairs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      local_artifact_files_only: true,
    },
  };
}

module.exports = {
  PLATFORM_PACK_FILES,
  repairPlatformNativePacks,
};
