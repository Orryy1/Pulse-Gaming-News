"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildPackagePublishVerdict,
  buildPlatformNativePublishPacks,
  finalPublishEvidenceBlockers,
} = require("./goal-proof-package");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { validateFinalAvReviewFile } = require("./goal-final-av-review");
const { inspectStoryPackage: inspectRightsStoryPackage } = require("./goal06-rights-ledger");
const { buildPulseMediaHouseScore } = require("./pulse-media-house-score");
const { ffprobeDuration } = require("./studio/media-acquisition");

const DEFAULT_ENABLED_RIGHTS_PLATFORMS = Object.freeze([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);

function normaliseRightsPlatforms(platforms = DEFAULT_ENABLED_RIGHTS_PLATFORMS) {
  const aliases = {
    youtube_shorts: "youtube",
    youtube: "youtube",
    instagram_reels: "instagram",
    instagram_reel: "instagram",
    instagram: "instagram",
    facebook_reels: "facebook",
    facebook_reel: "facebook",
    facebook: "facebook",
    twitter: "x",
    x: "x",
  };
  return [
    ...new Set(
      asArray(platforms)
        .map((platform) => cleanText(platform).toLowerCase())
        .filter(Boolean)
        .map((platform) => aliases[platform] || platform),
    ),
  ];
}

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
const MIN_FINAL_PUBLISH_RENDER_BYTES = 500000;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function statusLabel(value) {
  return cleanText(value).toUpperCase();
}

function pathIsWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function rightsPublishBlockers(report = {}) {
  if (report.status === "ready" && !asArray(report.blockers).length) return [];
  const blockers = asArray(report.blockers).map(cleanText).filter(Boolean);
  return blockers.length
    ? [...new Set(blockers.map((blocker) => blocker.startsWith("rights:")
      ? blocker
      : `rights:${blocker}`))]
    : ["rights:evidence_incomplete"];
}

async function inspectFinalPublishRender(artifactDir = "", renderManifest = {}) {
  const blockers = [];
  const finalFlag =
    renderManifest.final_publish_render === true ||
    renderManifest.finalPublishRender === true;
  const declaredPath = cleanText(
    renderManifest.output_path ||
      renderManifest.outputPath ||
      renderManifest.output ||
      renderManifest.render_path ||
      renderManifest.renderPath,
  );
  if (!finalFlag) blockers.push("render:final_publish_render_flag_missing");
  if (!declaredPath) blockers.push("render:final_publish_render_path_missing");

  const resolvedRoot = artifactDir ? path.resolve(artifactDir) : "";
  const resolvedPath = declaredPath
    ? path.isAbsolute(declaredPath)
      ? path.resolve(declaredPath)
      : path.resolve(resolvedRoot, declaredPath)
    : "";
  if (resolvedPath && (!resolvedRoot || !pathIsWithin(resolvedPath, resolvedRoot))) {
    blockers.push("render:final_publish_render_path_outside_artifact_dir");
  }

  let actualBytes = 0;
  let canonicalPath = "";
  if (resolvedPath && !blockers.includes("render:final_publish_render_path_outside_artifact_dir")) {
    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) throw new Error("not a file");
      canonicalPath = await fs.realpath(resolvedPath);
      if (!pathIsWithin(canonicalPath, resolvedRoot)) {
        blockers.push("render:final_publish_render_symlink_outside_artifact_dir");
      } else {
        actualBytes = stat.size;
      }
    } catch {
      blockers.push("render:final_publish_render_file_missing");
    }
  }

  const declaredBytes = Number(
    renderManifest.file_size_bytes ??
      renderManifest.output_bytes ??
      renderManifest.size_bytes,
  );
  if (!Number.isFinite(declaredBytes) || declaredBytes <= 0) {
    blockers.push("render:final_publish_render_size_evidence_missing");
  } else if (actualBytes > 0 && declaredBytes !== actualBytes) {
    blockers.push("render:final_publish_render_size_mismatch");
  }
  if (actualBytes > 0 && actualBytes < MIN_FINAL_PUBLISH_RENDER_BYTES) {
    blockers.push("render:final_publish_render_placeholder_or_too_small");
  }

  let measuredDurationSeconds = null;
  if (canonicalPath && actualBytes >= MIN_FINAL_PUBLISH_RENDER_BYTES) {
    try {
      const measured = Number(ffprobeDuration(canonicalPath, { timeoutMs: 15000 }));
      if (Number.isFinite(measured) && measured > 0) measuredDurationSeconds = measured;
    } catch {
      // The blocker below records the failed decode probe.
    }
  }
  if (canonicalPath && measuredDurationSeconds === null) {
    blockers.push("render:final_publish_render_not_decodable");
  }
  const declaredDurationSeconds = numericDuration(
    renderManifest.rendered_duration_s ??
      renderManifest.duration_seconds ??
      renderManifest.duration_s ??
      renderManifest.duration,
  );
  if (
    measuredDurationSeconds !== null &&
    declaredDurationSeconds !== null &&
    Math.abs(measuredDurationSeconds - declaredDurationSeconds) > 0.35
  ) {
    blockers.push("render:final_publish_render_duration_mismatch");
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    ready: uniqueBlockers.length === 0,
    path: canonicalPath || resolvedPath || null,
    actual_bytes: actualBytes || null,
    declared_bytes: Number.isFinite(declaredBytes) ? declaredBytes : null,
    measured_duration_seconds: measuredDurationSeconds,
    declared_duration_seconds: declaredDurationSeconds,
    blockers: uniqueBlockers,
  };
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
    facebook_explanatory_framing: cleanText(outputs.facebook_reels?.explanatory_framing),
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

function publishVerdictSnapshot(verdict = {}) {
  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) {
    return {
      verdict: null,
      can_auto_publish: false,
      reason_codes: [],
      blockers: [],
    };
  }
  return {
    verdict: cleanText(verdict.verdict),
    can_auto_publish: verdict.can_auto_publish === true,
    reason_codes: asArray(verdict.reason_codes).map(cleanText).filter(Boolean).sort(),
    blockers: asArray(verdict.blockers).map(cleanText).filter(Boolean).sort(),
  };
}

function canonicalWithNativeCopy(canonical = {}, { coverHeadline = "", title = "", description = "" } = {}) {
  const headline = cleanText(coverHeadline);
  const publicTitle = cleanText(title);
  const publicDescription = cleanText(description);
  if (!headline && !publicTitle && !publicDescription) return canonical;
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
    ...(publicDescription
      ? {
          description: publicDescription,
          public_description: publicDescription,
        }
      : {}),
  };
}

async function inspectArtifact(storyPackage = {}, {
  generatedAt = new Date().toISOString(),
  finalAvReviewValidator = validateFinalAvReviewFile,
  rightsPlatforms = DEFAULT_ENABLED_RIGHTS_PLATFORMS,
} = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
  const resolvedArtifactDir = artifactDir ? path.resolve(artifactDir) : "";
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
  const publishVerdict = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"))
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
  const finalRenderEvidence = resolvedArtifactDir
    ? await inspectFinalPublishRender(resolvedArtifactDir, renderManifest)
    : {
        ready: false,
        path: null,
        actual_bytes: null,
        declared_bytes: null,
        measured_duration_seconds: null,
        declared_duration_seconds: null,
        blockers: ["render:final_publish_render_artifact_dir_missing"],
      };
  const targetRightsReport = resolvedArtifactDir
    ? await inspectRightsStoryPackage(
        {
          story_id: storyId,
          artifact_dir: resolvedArtifactDir,
        },
        {
          workspaceRoot: process.cwd(),
          platforms: normaliseRightsPlatforms(rightsPlatforms),
        },
      )
    : {
        status: "blocked",
        blockers: ["rights_ledger_missing"],
      };
  const targetRightsBlockers = rightsPublishBlockers(targetRightsReport);
  const declaredFinalMp4 = cleanText(
    renderManifest.output_path || renderManifest.output || renderManifest.render_path,
  );
  const finalAvReview = resolvedArtifactDir
    ? await finalAvReviewValidator(path.join(resolvedArtifactDir, "final_av_review.json"), {
        artifactDir: resolvedArtifactDir,
        storyId,
        finalMp4Path: declaredFinalMp4,
      })
    : {
        valid: false,
        verdict: "RED",
        can_auto_publish: false,
        blockers: ["final_av_review_story_artifact_dir_invalid"],
      };
  const finalAvReviewGreen =
    finalAvReview.valid === true &&
    statusLabel(finalAvReview.verdict || finalAvReview.status) === "GREEN" &&
    finalAvReview.can_auto_publish === true;
  const finalAvReviewBlockers = finalAvReviewGreen
    ? []
    : asArray(finalAvReview.blockers).map(cleanText).filter(Boolean);
  if (!finalAvReviewGreen && !finalAvReviewBlockers.length) {
    finalAvReviewBlockers.push("final_av_review_not_green");
  }
  const targetPublishControl = finalAvReviewGreen
    ? {
        verdict: "GREEN",
        can_auto_publish: true,
        reason_codes: [],
        blockers: [],
      }
    : {
        verdict: "RED",
        can_auto_publish: false,
        reason_codes: finalAvReviewBlockers.map((blocker) => `control:${blocker}`),
        blockers: finalAvReviewBlockers.map((blocker) => `control:${blocker}`),
      };

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
  const currentPublishStatus = statusLabel(platformManifest.publish_status);
  const targetCoverHeadline = cleanText(native.outputs?.youtube_shorts?.cover_frame?.headline);
  const targetTitle = cleanText(native.outputs?.youtube_shorts?.title);
  const targetDescription = cleanText(native.outputs?.youtube_shorts?.description);
  const targetCanonical = canonicalWithNativeCopy(canonical, {
    coverHeadline: targetCoverHeadline,
    title: targetTitle,
    description: targetDescription,
  });
  const targetMediaHouseScore = artifactDir
    ? await refreshPulseMediaHouseScore({
        artifactDir,
        storyId,
        generatedAt,
        canonicalOverride: targetCanonical,
        platformManifestOverride: targetPlatformManifest,
      })
    : null;
  const targetMediaHouseGreen =
    (statusLabel(targetMediaHouseScore?.verdict) === "GREEN" ||
      statusLabel(targetMediaHouseScore?.status) === "PASS") &&
    !asArray(targetMediaHouseScore?.hard_failures).length;
  const mediaHouseScoreStale = snapshotsDiffer(
    mediaHouseScoreSnapshot(currentMediaHouseScore),
    mediaHouseScoreSnapshot(targetMediaHouseScore),
  );
  const [
    targetScriptScorecard,
    targetAudioManifest,
    targetFootageInventory,
    targetDirectorBeatMap,
    targetBenchmarkReport,
    targetMaterialisedMotionEvidence,
  ] = artifactDir
    ? await Promise.all([
        readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {}),
        readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
      ])
    : [{}, {}, {}, {}, {}, {}];
  const targetPublishVerdict = buildPackagePublishVerdict({
    publishControlTower: targetPublishControl,
    scriptScorecard: targetScriptScorecard,
    audioManifest: targetAudioManifest,
    footageInventory: targetFootageInventory,
    directorBeatMap: targetDirectorBeatMap,
    benchmarkReport: targetBenchmarkReport,
    platformNativeEvidence: targetPlatformManifest.platform_native_evidence,
    mediaHouseScore: targetMediaHouseScore,
    finalPublishBlockers: [
      ...finalPublishEvidenceBlockers({
        story: {
          render_manifest: renderManifest,
          exported_path: renderManifest.output_path || renderManifest.output,
        },
        audioManifest: targetAudioManifest,
      }),
      ...finalRenderEvidence.blockers,
      ...targetRightsBlockers,
    ],
    materialisedMotionEvidence: targetMaterialisedMotionEvidence,
  });
  const targetPackageGreen =
    statusLabel(targetPublishVerdict.verdict || targetPublishVerdict.status) === "GREEN" &&
    targetPublishVerdict.can_auto_publish === true &&
    !asArray(targetPublishVerdict.blockers).length;
  const targetCanAutoPublish =
    targetPackageGreen &&
    finalRenderEvidence.ready === true &&
    targetRightsReport.status === "ready" &&
    targetMediaHouseGreen &&
    native.platformNativeEvidence.verdict === "pass" &&
    finalAvReviewGreen;
  const targetPublishStatus = targetCanAutoPublish ? "GREEN" : "RED";
  const publishVerdictStale = snapshotsDiffer(
    publishVerdictSnapshot(publishVerdict),
    publishVerdictSnapshot(targetPublishVerdict),
  );
  const targetPublicCopyQa = evaluateGoalPublicCopy({
    ...targetCanonical,
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
  const canonicalPublicCopyStale = snapshotsDiffer(
    {
      title: cleanText(canonical.selected_title || canonical.canonical_title || canonical.title),
      description: cleanText(canonical.description || canonical.public_description),
      cover_headline: cleanText(
        canonical.thumbnail_headline ||
          canonical.thumbnail_text ||
          canonical.suggested_thumbnail_text ||
          canonical.first_frame_text,
      ),
    },
    {
      title: cleanText(targetCanonical.selected_title || targetCanonical.canonical_title || targetCanonical.title),
      description: cleanText(targetCanonical.description || targetCanonical.public_description),
      cover_headline: cleanText(
        targetCanonical.thumbnail_headline ||
          targetCanonical.thumbnail_text ||
          targetCanonical.suggested_thumbnail_text ||
          targetCanonical.first_frame_text,
      ),
    },
  );
  const publishStatusStale = Boolean(targetPublishStatus) && currentPublishStatus !== targetPublishStatus;
  const canAutoPublishStale = (platformManifest.can_auto_publish === true) !== targetCanAutoPublish;
  const needsRepair =
    evidence.verdict !== "pass" ||
    platformManifestMissing ||
    !hasAllNativeOutputs ||
    native.platformNativeEvidence.verdict !== "pass" ||
    formatSignatureMissingOrStale ||
    affiliateOutputStale ||
    publishStatusStale ||
    canAutoPublishStale ||
    currentPlatformFailures.length > 0 ||
    publicPlaceholderLeak ||
    canonicalPublicCopyStale ||
    mediaHouseScoreStale ||
    publishVerdictStale;

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
    canonical_public_copy_stale: canonicalPublicCopyStale,
    media_house_score_stale: mediaHouseScoreStale,
    publish_verdict_stale: publishVerdictStale,
    current_media_house_verdict: currentMediaHouseScore?.verdict || null,
    target_media_house_verdict: targetMediaHouseScore?.verdict || null,
    current_publish_verdict: publishVerdictSnapshot(publishVerdict),
    target_publish_verdict: publishVerdictSnapshot(targetPublishVerdict),
    target_final_render_ready: finalRenderEvidence.ready === true,
    target_final_render_blockers: finalRenderEvidence.blockers,
    target_final_render_evidence: finalRenderEvidence,
    target_rights_status: targetRightsReport.status || "blocked",
    target_rights_blockers: targetRightsBlockers,
    final_av_review_verdict: cleanText(finalAvReview.verdict || finalAvReview.status) || "RED",
    final_av_review_blockers: finalAvReviewBlockers,
    target_publish_control: targetPublishControl,
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
    current_publish_status: currentPublishStatus || null,
    target_publish_status: targetPublishStatus || null,
    target_can_auto_publish: targetCanAutoPublish,
    publish_status_stale: publishStatusStale,
    can_auto_publish_stale: canAutoPublishStale,
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
  canonicalOverride = null,
  platformManifestOverride = null,
} = {}) {
  const [
    storedCanonical,
    scriptScorecard,
    visualQuality,
    director,
    audio,
    loudness,
    affiliate,
    storedPlatformManifest,
    benchmark,
    uniqueness,
    competitorSimilarity,
    renderManifest,
    captionManifest,
    materialisedMotionClips,
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
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
  ]);
  const canonical = canonicalOverride && Object.keys(canonicalOverride).length
    ? canonicalOverride
    : storedCanonical;
  const platformManifest = platformManifestOverride && Object.keys(platformManifestOverride).length
    ? platformManifestOverride
    : storedPlatformManifest;
  const captionEvidenceVerified =
    ["pass", "ready", "green"].includes(cleanText(captionManifest.status || captionManifest.verdict).toLowerCase()) &&
    captionManifest.checks?.caption_file_verified === true &&
    captionManifest.checks?.display_script_verified === true &&
    captionManifest.checks?.display_alignment_exact === true;
  const captionQa = captionEvidenceVerified
    ? {
        ...captionManifest,
        display_text: cleanText(
          captionManifest.display_text ||
            captionManifest.transcript ||
            canonical.caption_display_text ||
            canonical.display_script ||
            canonical.narration_script,
        ),
      }
    : {};
  const professionalSourceDiversity = materialisedMotionClips.professional_source_diversity || {};

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
    renderManifest,
    captionQa,
    materialisedMotionClips,
    source_diversity_tier: professionalSourceDiversity.policy_tier,
    professional_source_diversity: professionalSourceDiversity,
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
    publish_verdict: await backupIfPresent(path.join(artifactDir, "publish_verdict.json"), backupDir),
  };

  const repairedPlatformManifest = {
    ...platformManifest,
    ...(item.target_publish_status ? { publish_status: item.target_publish_status } : {}),
    can_auto_publish: item.target_can_auto_publish === true,
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
  const targetDescription = cleanText(item.target_outputs?.youtube_shorts?.description);
  let canonicalRepaired = false;
  if (Object.keys(canonical).length && (targetCoverHeadline || targetTitle || targetDescription)) {
    await fs.writeJson(
      canonicalPath,
      {
        ...canonicalWithNativeCopy(canonical, {
          coverHeadline: targetCoverHeadline,
          title: targetTitle,
          description: targetDescription,
        }),
        platform_native_thumbnail_repaired_at: generatedAt,
      },
      { spaces: 2 },
    );
    canonicalRepaired = true;
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

  const publishVerdictPath = path.join(artifactDir, "publish_verdict.json");
  const [
    scriptScorecard,
    audioManifest,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    renderManifest,
    materialisedMotionEvidence,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
  ]);
  const publishVerdict = buildPackagePublishVerdict({
    publishControlTower: item.target_publish_control || {
      verdict: "RED",
      can_auto_publish: false,
      blockers: ["control:final_av_review_not_validated"],
      reason_codes: ["control:final_av_review_not_validated"],
    },
    scriptScorecard,
    audioManifest,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    platformNativeEvidence: repairedPlatformManifest.platform_native_evidence,
    mediaHouseScore,
    finalPublishBlockers: finalPublishEvidenceBlockers({
      story: {
        render_manifest: renderManifest,
        exported_path: renderManifest.output_path || renderManifest.output,
      },
      audioManifest,
    }),
    materialisedMotionEvidence,
  });
  await fs.writeJson(publishVerdictPath, publishVerdict, { spaces: 2 });

  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    backup_dir: backupDir,
    backup_files: backupFiles,
    repaired_files: [
      platformManifestPath,
      variantScorecardPath,
      ...(canonicalRepaired ? [canonicalPath] : []),
      mediaHouseScorePath,
      publishVerdictPath,
      ...Object.values(PLATFORM_PACK_FILES).map((basename) => path.join(artifactDir, basename)),
    ],
  };
}

async function repairPlatformNativePacks({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  apply = false,
  backupRoot = "",
  finalAvReviewValidator = validateFinalAvReviewFile,
  rightsPlatforms = DEFAULT_ENABLED_RIGHTS_PLATFORMS,
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectArtifact(storyPackage, {
      generatedAt,
      finalAvReviewValidator,
      rightsPlatforms,
    }));
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
      canonical_public_copy_stale: item.canonical_public_copy_stale,
      media_house_score_stale: item.media_house_score_stale,
      publish_verdict_stale: item.publish_verdict_stale,
      current_media_house_verdict: item.current_media_house_verdict,
      target_media_house_verdict: item.target_media_house_verdict,
      current_publish_verdict: item.current_publish_verdict,
      target_publish_verdict: item.target_publish_verdict,
      target_final_render_ready: item.target_final_render_ready,
      target_final_render_blockers: item.target_final_render_blockers,
      target_final_render_evidence: item.target_final_render_evidence,
      target_rights_status: item.target_rights_status,
      target_rights_blockers: item.target_rights_blockers,
      final_av_review_verdict: item.final_av_review_verdict,
      final_av_review_blockers: item.final_av_review_blockers,
      current_media_house_hard_failures: item.current_media_house_hard_failures,
      target_media_house_hard_failures: item.target_media_house_hard_failures,
      current_shorts_attention_status: item.current_shorts_attention_status,
      target_shorts_attention_status: item.target_shorts_attention_status,
      current_shorts_attention_blockers: item.current_shorts_attention_blockers,
      target_shorts_attention_blockers: item.target_shorts_attention_blockers,
      current_affiliate_output: item.current_affiliate_output,
      target_affiliate_output: item.target_affiliate_output,
      target_youtube_title: cleanText(item.target_outputs?.youtube_shorts?.title) || null,
      target_youtube_description: cleanText(item.target_outputs?.youtube_shorts?.description) || null,
      target_youtube_cover_headline: cleanText(item.target_outputs?.youtube_shorts?.cover_frame?.headline) || null,
      target_instagram_caption: cleanText(item.target_outputs?.instagram_reels?.caption) || null,
      target_facebook_page_caption: cleanText(item.target_outputs?.facebook_reels?.page_caption) || null,
      current_publish_status: item.current_publish_status,
      target_publish_status: item.target_publish_status,
      target_can_auto_publish: item.target_can_auto_publish,
      publish_status_stale: item.publish_status_stale,
      can_auto_publish_stale: item.can_auto_publish_stale,
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

async function refreshStoryPackageEntriesFromArtifacts(storyPackages = [], {
  storyIds = [],
  persistArtifactSummaries = false,
  artifactSummaryBackupRoot = "",
  finalAvReviewValidator = validateFinalAvReviewFile,
  rightsPlatforms = DEFAULT_ENABLED_RIGHTS_PLATFORMS,
} = {}) {
  const requested = new Set(asArray(storyIds).map(cleanText).filter(Boolean));
  let updatedCount = 0;
  let persistedArtifactSummaryCount = 0;
  const rows = [];
  const refreshed = [];
  for (const storyPackage of asArray(storyPackages)) {
    const storyId = cleanText(storyPackage.story_id || storyPackage.id);
    if (!storyId || (requested.size && !requested.has(storyId))) {
      refreshed.push(storyPackage);
      continue;
    }
    const artifactDir = cleanText(storyPackage.artifact_dir);
    const resolvedArtifactDir = artifactDir ? path.resolve(artifactDir) : "";
    const publishVerdict = resolvedArtifactDir
      ? await readJsonIfPresent(path.join(resolvedArtifactDir, "publish_verdict.json"), {})
      : {};
    const platformManifest = resolvedArtifactDir
      ? await readJsonIfPresent(path.join(resolvedArtifactDir, "platform_publish_manifest.json"), {})
      : {};
    const mediaHouseScore = resolvedArtifactDir
      ? await readJsonIfPresent(path.join(resolvedArtifactDir, "pulse_media_house_score.json"), {})
      : {};
    const renderManifest = resolvedArtifactDir
      ? await readJsonIfPresent(path.join(resolvedArtifactDir, "render_manifest.json"), {})
      : {};
    const finalRenderEvidence = resolvedArtifactDir
      ? await inspectFinalPublishRender(resolvedArtifactDir, renderManifest)
      : {
          ready: false,
          path: null,
          blockers: ["render:final_publish_render_artifact_dir_missing"],
        };
    const rightsReport = resolvedArtifactDir
      ? await inspectRightsStoryPackage(
          {
            story_id: storyId,
            artifact_dir: resolvedArtifactDir,
          },
          {
            workspaceRoot: process.cwd(),
            platforms: normaliseRightsPlatforms(rightsPlatforms),
          },
        )
      : {
          status: "blocked",
          blockers: ["rights_ledger_missing"],
        };
    const rightsBlockers = rightsPublishBlockers(rightsReport);
    const finalAvReview = resolvedArtifactDir
      ? await finalAvReviewValidator(
          path.join(resolvedArtifactDir, "final_av_review.json"),
          {
            artifactDir: resolvedArtifactDir,
            storyId,
            finalMp4Path: finalRenderEvidence.path || "",
          },
        )
      : {
          valid: false,
          verdict: "RED",
          can_auto_publish: false,
          blockers: ["final_av_review_story_artifact_dir_invalid"],
        };
    const finalAvReviewGreen =
      finalAvReview.valid === true &&
      statusLabel(finalAvReview.verdict || finalAvReview.status) === "GREEN" &&
      finalAvReview.can_auto_publish === true;
    const finalAvReviewBlockers = finalAvReviewGreen
      ? []
      : asArray(finalAvReview.blockers).length
        ? asArray(finalAvReview.blockers).map((blocker) => {
            const value = cleanText(blocker);
            return value.startsWith("control:") ? value : `control:${value}`;
          })
        : ["control:final_av_review_not_green"];
    const targetVerdict = statusLabel(publishVerdict.verdict || publishVerdict.status || platformManifest.publish_status);
    const reasonCodes = [
      ...new Set(asArray(publishVerdict.reason_codes).map(cleanText).filter(Boolean)),
    ];
    const reportedBlockers = [
      ...new Set([
        ...asArray(publishVerdict.blockers),
        ...reasonCodes,
        ...asArray(mediaHouseScore.hard_failures),
      ].map(cleanText).filter(Boolean)),
    ];
    const platformNativePass =
      cleanText(platformManifest.platform_native_evidence?.verdict).toLowerCase() === "pass" ||
      cleanText(platformManifest.platformNativeEvidence?.verdict).toLowerCase() === "pass";
    const mediaHouseGreen =
      statusLabel(mediaHouseScore.verdict || mediaHouseScore.status) === "GREEN" &&
      !asArray(mediaHouseScore.hard_failures).length;
    const evidenceBlockers = [
      ...new Set([
        ...reportedBlockers,
        ...finalRenderEvidence.blockers,
        ...rightsBlockers,
        ...finalAvReviewBlockers,
        ...(!targetVerdict ? ["publish_verdict:missing"] : []),
        ...(targetVerdict && targetVerdict !== "GREEN"
          ? [`publish_verdict:${targetVerdict.toLowerCase()}`]
          : []),
        ...(targetVerdict === "GREEN" && publishVerdict.can_auto_publish !== true
          ? ["publish_verdict:can_auto_publish_false"]
          : []),
        ...(!platformNativePass ? ["platform_native:not_pass"] : []),
        ...(!mediaHouseGreen ? ["media_house:not_green"] : []),
      ].map(cleanText).filter(Boolean)),
    ];
    const canPromoteGreen =
      targetVerdict === "GREEN" &&
      publishVerdict.can_auto_publish === true &&
      evidenceBlockers.length === 0 &&
      platformNativePass &&
      mediaHouseGreen &&
      finalRenderEvidence.ready === true &&
      rightsReport.status === "ready" &&
      finalAvReviewGreen;
    const criticalEvidenceReady =
      platformNativePass &&
      mediaHouseGreen &&
      finalRenderEvidence.ready === true &&
      rightsReport.status === "ready" &&
      finalAvReviewGreen;
    const resolvedVerdict = canPromoteGreen
      ? "GREEN"
      : targetVerdict === "AMBER" && criticalEvidenceReady
        ? "AMBER"
        : "RED";
    let candidate = storyPackage;
    if (canPromoteGreen) {
      candidate = {
        ...storyPackage,
        verdict: "GREEN",
        blockers: [],
        publish_verdict: {
          verdict: "GREEN",
          can_auto_publish: publishVerdict.can_auto_publish === true,
          reason_codes: [],
          blockers: [],
        },
      };
    } else if (targetVerdict || evidenceBlockers.length) {
      candidate = {
        ...storyPackage,
        verdict: resolvedVerdict,
        blockers: evidenceBlockers,
        publish_verdict: {
          verdict: resolvedVerdict,
          can_auto_publish: false,
          reason_codes: [...new Set([...reasonCodes, ...evidenceBlockers])],
          blockers: evidenceBlockers,
        },
      };
    }
    const next = JSON.stringify(candidate) === JSON.stringify(storyPackage)
      ? storyPackage
      : candidate;
    if (next !== storyPackage) updatedCount += 1;
    let artifactSummaryUpdated = false;
    let artifactSummaryPath = null;
    let artifactSummaryBackupPath = null;
    if (persistArtifactSummaries && artifactDir) {
      artifactSummaryPath = path.join(artifactDir, "goal_package_summary.json");
      const localSummary = { ...next };
      delete localSummary.artifact_dir;
      delete localSummary.output_dir;
      delete localSummary.package_dir;
      const currentLocalSummary = await readJsonIfPresent(artifactSummaryPath, {});
      if (JSON.stringify(currentLocalSummary) !== JSON.stringify(localSummary)) {
        if (artifactSummaryBackupRoot && await fs.pathExists(artifactSummaryPath)) {
          const backupDir = path.join(path.resolve(artifactSummaryBackupRoot), storyId);
          await fs.ensureDir(backupDir);
          artifactSummaryBackupPath = path.join(backupDir, "goal_package_summary.json");
          await fs.copy(artifactSummaryPath, artifactSummaryBackupPath, { overwrite: true });
        }
        await fs.writeJson(artifactSummaryPath, localSummary, { spaces: 2 });
        artifactSummaryUpdated = true;
        persistedArtifactSummaryCount += 1;
      }
    }
    rows.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      package_verdict_before: storyPackage.verdict || null,
      package_verdict_after: next.verdict || null,
      package_blockers_before: asArray(storyPackage.blockers).map(cleanText).filter(Boolean),
      package_blockers_after: asArray(next.blockers).map(cleanText).filter(Boolean),
      publish_verdict: publishVerdict.verdict || null,
      platform_native_verdict: platformManifest.platform_native_evidence?.verdict || null,
      media_house_verdict: mediaHouseScore.verdict || null,
      final_render_ready: finalRenderEvidence.ready === true,
      final_render_blockers: finalRenderEvidence.blockers,
      rights_status: rightsReport.status || "blocked",
      rights_blockers: rightsBlockers,
      final_av_review_verdict: cleanText(finalAvReview.verdict || finalAvReview.status) || "RED",
      final_av_review_blockers: finalAvReviewBlockers,
      updated: next !== storyPackage,
      artifact_summary_updated: artifactSummaryUpdated,
      artifact_summary_path: artifactSummaryPath,
      artifact_summary_backup_path: artifactSummaryBackupPath,
    });
    refreshed.push(next);
  }
  return {
    story_packages: refreshed,
    summary: {
      story_count: refreshed.length,
      updated_count: updatedCount,
      persisted_artifact_summary_count: persistedArtifactSummaryCount,
    },
    rows,
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
  DEFAULT_ENABLED_RIGHTS_PLATFORMS,
  PLATFORM_PACK_FILES,
  repairPlatformNativePacks,
  refreshStoryPackageEntriesFromArtifacts,
};
