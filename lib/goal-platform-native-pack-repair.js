"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { buildPlatformNativePublishPacks } = require("./goal-proof-package");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { buildPulseMediaHouseScore } = require("./pulse-media-house-score");

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
    youtube_cover_headline: cleanText(outputs.youtube_shorts?.cover_frame?.headline),
    youtube_disclosure_required: outputs.youtube_shorts?.disclosure_status?.required === true,
    youtube_disclosure_type: cleanText(outputs.youtube_shorts?.disclosure_status?.type),
    youtube_landing_cta: cleanText(outputs.youtube_shorts?.profile_or_landing_page_cta),
    youtube_description_route: cleanText(outputs.youtube_shorts?.description),
    tiktok_hook_overlay_text: cleanText(outputs.tiktok?.hook_overlay_text),
    tiktok_caption: cleanText(outputs.tiktok?.caption),
    tiktok_disclosure_flag: cleanText(outputs.tiktok?.disclosure_flag),
    tiktok_product_link_eligibility: cleanText(outputs.tiktok?.product_link_eligibility),
    instagram_cover_overlay_text: cleanText(outputs.instagram_reels?.cover_overlay_text),
    instagram_caption: cleanText(outputs.instagram_reels?.caption),
    instagram_bio_link_cta: cleanText(outputs.instagram_reels?.bio_link_cta),
    facebook_page_caption: cleanText(outputs.facebook_reels?.page_caption),
    pinterest_disclosure: cleanText(outputs.pinterest?.disclosure),
  };
}

function snapshotsDiffer(left = {}, right = {}) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function mediaHouseScoreSnapshot(score = {}) {
  if (!score || typeof score !== "object" || Array.isArray(score)) {
    return {
      verdict: null,
      status: null,
      scores: {},
      hard_failures: [],
    };
  }
  return {
    verdict: cleanText(score.verdict),
    status: cleanText(score.status),
    scores: score.scores || {},
    hard_failures: asArray(score.hard_failures).map(cleanText).filter(Boolean),
  };
}

function canonicalWithNativeCopy(canonical = {}, { coverHeadline = "", title = "" } = {}) {
  const headline = cleanText(coverHeadline);
  const publicTitle = cleanText(title);
  if (!headline && !publicTitle) return canonical;
  return {
    ...canonical,
    ...(publicTitle
      ? {
          selected_title: publicTitle,
          canonical_title: publicTitle,
          title: publicTitle,
          public_title: publicTitle,
        }
      : {}),
    ...(headline
      ? {
          thumbnail_headline: headline,
          thumbnail_text: headline,
          suggested_thumbnail_text: headline,
          first_frame_text: headline,
        }
      : {}),
  };
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
  const renderManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"))
    : {};
  const currentMediaHouseScore = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "pulse_media_house_score.json"), null)
    : null;

  if (!Object.keys(canonical).length) blockers.push("canonical_manifest_missing");
  const platformManifestMissing = !Object.keys(platformManifest).length;

  const durationSeconds = numericDuration(
    canonical.duration_seconds ??
      canonical.rendered_duration_s ??
      renderManifest.duration_seconds ??
      renderManifest.rendered_duration_s ??
      renderManifest.renderedDurationSeconds,
  );
  const platformOutputs = withPlatformDuration(platformManifest.outputs || {}, durationSeconds);

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
      duration_seconds: durationSeconds,
      affiliate_link_manifest: affiliateManifest,
    },
    canonical,
    platformOutputs,
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
  const targetCoverHeadline = cleanText(native.outputs?.youtube_shorts?.cover_frame?.headline);
  const targetTitle = cleanText(native.outputs?.youtube_shorts?.title);
  const targetMediaHouseScore = artifactDir
    ? buildPulseMediaHouseScore({
        story_id: storyId,
        canonical: canonicalWithNativeCopy(canonical, {
          coverHeadline: targetCoverHeadline,
          title: targetTitle,
        }),
        scriptScorecard: await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
        visualQuality: await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {}),
        director: await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
        audio: await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
        loudness: await readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), {}),
        affiliate: affiliateManifest,
        platformManifest: targetPlatformManifest,
        benchmark: await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {}),
        uniqueness: await readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {}),
        competitorSimilarity: await readJsonIfPresent(path.join(artifactDir, "competitor_similarity_report.json"), {}),
        generatedAt,
      })
    : null;
  const mediaHouseScoreStale = snapshotsDiffer(
    mediaHouseScoreSnapshot(currentMediaHouseScore),
    mediaHouseScoreSnapshot(targetMediaHouseScore),
  );
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
    platformManifestMissing ||
    !hasAllNativeOutputs ||
    native.platformNativeEvidence.verdict !== "pass" ||
    formatSignatureMissingOrStale ||
    affiliateOutputStale ||
    currentPlatformFailures.length > 0 ||
    publicPlaceholderLeak ||
    mediaHouseScoreStale;

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
    media_house_score_stale: mediaHouseScoreStale,
    current_media_house_verdict: currentMediaHouseScore?.verdict || null,
    target_media_house_verdict: targetMediaHouseScore?.verdict || null,
    current_media_house_hard_failures: asArray(currentMediaHouseScore?.hard_failures).map(cleanText).filter(Boolean),
    target_media_house_hard_failures: asArray(targetMediaHouseScore?.hard_failures).map(cleanText).filter(Boolean),
    current_shorts_attention_status: cleanText(currentMediaHouseScore?.shorts_attention_report?.status) || null,
    target_shorts_attention_status: cleanText(targetMediaHouseScore?.shorts_attention_report?.status) || null,
    current_shorts_attention_blockers:
      asArray(currentMediaHouseScore?.shorts_attention_report?.blockers).map(cleanText).filter(Boolean),
    target_shorts_attention_blockers:
      asArray(targetMediaHouseScore?.shorts_attention_report?.blockers).map(cleanText).filter(Boolean),
    current_affiliate_output: affiliateOutputSnapshot(platformManifest.outputs || {}),
    target_affiliate_output: affiliateOutputSnapshot(native.outputs || {}),
    target_outputs: native.outputs,
    target_evidence: native.platformNativeEvidence,
    generated_at: generatedAt,
  };
}

function numericDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function withPlatformDuration(outputs = {}, durationSeconds = null) {
  if (!durationSeconds) return outputs;
  const next = { ...outputs };
  for (const platform of ["youtube_shorts", "tiktok", "instagram_reels", "facebook_reels"]) {
    next[platform] = {
      ...(next[platform] || {}),
      duration_seconds: next[platform]?.duration_seconds || durationSeconds,
    };
  }
  return next;
}

async function backupIfPresent(filePath, backupDir) {
  if (!(await fs.pathExists(filePath))) return null;
  await fs.ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(filePath));
  await fs.copy(filePath, backupPath, { overwrite: true });
  return backupPath;
}

async function refreshPulseMediaHouseScore({
  artifactDir,
  storyId,
  generatedAt = new Date().toISOString(),
} = {}) {
  const [
    canonical,
    scriptScorecard,
    visualQuality,
    director,
    audio,
    loudness,
    affiliate,
    platformManifest,
    benchmark,
    uniqueness,
    competitorSimilarity,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "competitor_similarity_report.json"), {}),
  ]);

  return buildPulseMediaHouseScore({
    story_id: storyId,
    canonical,
    scriptScorecard,
    visualQuality,
    director,
    audio,
    loudness,
    affiliate,
    platformManifest,
    benchmark,
    uniqueness,
    competitorSimilarity,
    generatedAt,
  });
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
    canonical_story_manifest: await backupIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), backupDir),
    platform_publish_manifest: await backupIfPresent(platformManifestPath, backupDir),
    platform_variant_scorecard: await backupIfPresent(variantScorecardPath, backupDir),
    pulse_media_house_score: await backupIfPresent(path.join(artifactDir, "pulse_media_house_score.json"), backupDir),
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

  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath);
  const targetCoverHeadline = cleanText(item.target_outputs?.youtube_shorts?.cover_frame?.headline);
  const targetTitle = cleanText(item.target_outputs?.youtube_shorts?.title);
  if (Object.keys(canonical).length && (targetCoverHeadline || targetTitle)) {
    await fs.writeJson(
      canonicalPath,
      {
        ...canonicalWithNativeCopy(canonical, {
          coverHeadline: targetCoverHeadline,
          title: targetTitle,
        }),
        platform_native_thumbnail_repaired_at: generatedAt,
      },
      { spaces: 2 },
    );
  }

  for (const [platform, basename] of Object.entries(PLATFORM_PACK_FILES)) {
    const filePath = path.join(artifactDir, basename);
    backupFiles[platform] = await backupIfPresent(filePath, backupDir);
    await fs.writeJson(filePath, item.target_outputs[platform] || {}, { spaces: 2 });
  }

  const mediaHouseScorePath = path.join(artifactDir, "pulse_media_house_score.json");
  const mediaHouseScore = await refreshPulseMediaHouseScore({
    artifactDir,
    storyId: item.story_id,
    generatedAt,
  });
  await fs.writeJson(mediaHouseScorePath, mediaHouseScore, { spaces: 2 });

  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    backup_dir: backupDir,
    backup_files: backupFiles,
    repaired_files: [
      platformManifestPath,
      variantScorecardPath,
      mediaHouseScorePath,
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
      media_house_score_stale: item.media_house_score_stale,
      current_media_house_verdict: item.current_media_house_verdict,
      target_media_house_verdict: item.target_media_house_verdict,
      current_media_house_hard_failures: item.current_media_house_hard_failures,
      target_media_house_hard_failures: item.target_media_house_hard_failures,
      current_shorts_attention_status: item.current_shorts_attention_status,
      target_shorts_attention_status: item.target_shorts_attention_status,
      current_shorts_attention_blockers: item.current_shorts_attention_blockers,
      target_shorts_attention_blockers: item.target_shorts_attention_blockers,
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
