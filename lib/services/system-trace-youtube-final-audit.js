"use strict";

const { isDeepStrictEqual } = require("node:util");
const {
  assertExactDeferredGreenProof,
  assertExactDeferredRedReceipt,
} = require("./system-trace-youtube-studio-reconcile");

const EXPECTED_MANIFEST_SHA256 =
  "fbedcf8e143ddfe9930ccdd4d56f19a2391a85562b2a985ee4021a26e78ab123";
const EXPECTED_CHANNEL_ID = "UCvgNDjtTezrpxL8oUe6mYwA";
const EXPECTED_EPISODES = Object.freeze([
  ["system-trace-frame-pacing", "2026-08-15T19:00:00.000Z"],
  ["system-trace-shader-compilation", "2026-08-16T19:00:00.000Z"],
  ["system-trace-temporal-upscaling", "2026-08-17T19:00:00.000Z"],
  ["system-trace-spatial-headphone-audio", "2026-08-18T19:00:00.000Z"],
  ["system-trace-texture-streaming", "2026-08-19T19:00:00.000Z"],
  ["system-trace-ray-tracing-bvh", "2026-08-20T19:00:00.000Z"],
  ["system-trace-render-queue-latency", "2026-08-21T19:00:00.000Z"],
]);
const VIDEO_PARTS = Object.freeze([
  "snippet",
  "status",
  "contentDetails",
  "processingDetails",
  "paidProductPlacementDetails",
]);
const REQUEST_OPTIONS = Object.freeze({ retry: false, timeout: 30_000 });
const TRUSTED_SCHEDULE_STATUSES = new Set([
  "SCHEDULE_VERIFIED",
  "SCHEDULE_ALREADY_VERIFIED",
  "SCHEDULE_RECONCILED_AFTER_AMBIGUOUS_RESPONSE",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function canonicalTags(tags) {
  return Array.isArray(tags)
    ? tags.map(clean).filter(Boolean).sort((left, right) => left.localeCompare(right))
    : [];
}

function exactUtc(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "";
}

function safeError(error) {
  return clean(error?.code || error?.message || error).slice(0, 300);
}

function sha256Hex(value) {
  return /^[a-f0-9]{64}$/.test(clean(value).toLowerCase());
}

function receiptArtifact(value) {
  if (value?.document && typeof value.document === "object") {
    return {
      document: value.document,
      sha256: clean(value.sha256).toLowerCase(),
    };
  }
  return { document: value, sha256: "" };
}

function exactPackageCaptionBinding(episode, packageEvidence) {
  const blockers = [];
  const canonical = packageEvidence?.canonical_manifest;
  const pack = packageEvidence?.publish_pack;
  const request = pack?.youtube_upload_request;
  const captionRequest = request?.captions;
  const captionsSha256 = clean(packageEvidence?.captions_sha256).toLowerCase();
  const captionsBytes = Number(packageEvidence?.captions_bytes);
  const publishAt = exactUtc(episode?.publish_at_utc);
  const expectedProjectDir = `videos/${episode?.story_id}`;
  if (
    episode?.project_dir !== expectedProjectDir ||
    canonical?.schema_version !== 1 ||
    canonical?.schema !== "pulse_system_trace_canonical_story_manifest_v1" ||
    canonical?.story_id !== episode?.story_id ||
    canonical?.project_id !== episode?.story_id ||
    canonical?.destination?.platform !== "youtube_shorts" ||
    canonical?.destination?.channel_id !== EXPECTED_CHANNEL_ID ||
    exactUtc(canonical?.destination?.publish_at_utc) !== publishAt ||
    canonical?.rights_placement_verdict !== "GREEN" ||
    canonical?.publish_authorised !== true
  ) blockers.push("exact_canonical_package_manifest_required");
  if (
    pack?.schema_version !== 1 ||
    pack?.schema !== "pulse_system_trace_youtube_publish_pack_v1" ||
    pack?.story_id !== episode?.story_id ||
    pack?.project_id !== episode?.story_id ||
    pack?.platform !== "youtube_shorts" ||
    pack?.title !== episode?.title ||
    pack?.description !== episode?.description ||
    !isDeepStrictEqual(pack?.tags, episode?.tags) ||
    exactUtc(pack?.scheduled_publish_at_utc) !== publishAt ||
    pack?.scheduler_authorised !== true ||
    pack?.public_publish_authorised !== true ||
    pack?.rights_placement_verdict !== "GREEN"
  ) blockers.push("exact_youtube_publish_pack_required");
  if (
    request?.closed !== true ||
    request?.notifySubscribers !== false ||
    request?.video_sha256 !== canonical?.final_container?.sha256 ||
    request?.snippet?.title !== episode?.title ||
    request?.snippet?.description !== episode?.description ||
    !isDeepStrictEqual(request?.snippet?.tags, episode?.tags) ||
    request?.snippet?.categoryId !== "20" ||
    request?.snippet?.defaultLanguage !== "en-GB" ||
    request?.snippet?.defaultAudioLanguage !== "en-GB" ||
    request?.status?.privacyStatus !== "private" ||
    request?.status?.selfDeclaredMadeForKids !== false ||
    request?.status?.containsSyntheticMedia !== true ||
    request?.status?.license !== "youtube" ||
    request?.status?.embeddable !== true ||
    request?.status?.publicStatsViewable !== true ||
    request?.paidProductPlacementDetails?.hasPaidProductPlacement !== false
  ) blockers.push("exact_youtube_upload_request_required");
  if (
    pack?.captions?.file !== "captions.srt" ||
    pack?.captions?.sha256 !== captionsSha256 ||
    pack?.captions?.clean_manual_captions_required !== true ||
    captionRequest?.file !== "captions.srt" ||
    captionRequest?.sha256 !== captionsSha256 ||
    captionRequest?.language !== "en-GB" ||
    captionRequest?.name !== "English (United Kingdom)" ||
    captionRequest?.isDraft !== false ||
    canonical?.captions?.path !== "captions.srt" ||
    canonical?.captions?.sha256 !== captionsSha256 ||
    canonical?.captions?.bytes !== captionsBytes ||
    !sha256Hex(captionsSha256) ||
    !Number.isSafeInteger(captionsBytes) ||
    captionsBytes <= 0
  ) blockers.push("exact_manual_caption_content_binding_required");
  if (
    !sha256Hex(canonical?.final_container?.sha256) ||
    !Number.isSafeInteger(canonical?.final_container?.bytes) ||
    canonical.final_container.bytes <= 0
  ) blockers.push("exact_video_content_binding_required");
  return {
    blockers,
    intent: {
      story_id: episode?.story_id,
      channel_id: EXPECTED_CHANNEL_ID,
      title: episode?.title,
      description: episode?.description,
      tags: episode?.tags,
      category_id: "20",
      default_language: "en-GB",
      default_audio_language: "en-GB",
      video_bytes: canonical?.final_container?.bytes,
      video_sha256: canonical?.final_container?.sha256,
      authority_action_id: `${episode?.story_id}:youtube:private`,
    },
    expectedCaption: {
      language: "en-GB",
      name: "English (United Kingdom)",
      is_draft: false,
      track_kind: "standard",
      is_auto_synced: false,
      content_sha256: captionsSha256 || null,
      content_bytes: Number.isSafeInteger(captionsBytes) ? captionsBytes : null,
    },
  };
}

function manifestBlockers(manifest, manifestSha256) {
  const blockers = [];
  if (clean(manifestSha256).toLowerCase() !== EXPECTED_MANIFEST_SHA256) {
    blockers.push("exact_manifest_sha256_required");
  }
  if (
    manifest?.schema_version !== 1 ||
    manifest?.schema !== "pulse_system_trace_youtube_buffer_v1" ||
    manifest?.platform !== "youtube_shorts" ||
    manifest?.timezone !== "UTC" ||
    manifest?.cadence !== "one_per_day" ||
    manifest?.initial_privacy_status !== "private" ||
    manifest?.notify_subscribers_on_upload !== false ||
    manifest?.synthetic_media_disclosure !== true ||
    manifest?.channel?.id !== EXPECTED_CHANNEL_ID ||
    manifest?.channel?.title !== "Pulse Gaming" ||
    !Array.isArray(manifest?.episodes) ||
    manifest.episodes.length !== EXPECTED_EPISODES.length
  ) {
    blockers.push("exact_closed_buffer_manifest_required");
  }
  for (const [index, expected] of EXPECTED_EPISODES.entries()) {
    const episode = manifest?.episodes?.[index];
    if (
      episode?.story_id !== expected[0] ||
      exactUtc(episode?.publish_at_utc) !== expected[1] ||
      !clean(episode?.title) ||
      !clean(episode?.description) ||
      !Array.isArray(episode?.tags) ||
      episode.tags.length === 0
    ) {
      blockers.push(`exact_manifest_episode_required:${expected[0]}`);
    }
  }
  return blockers;
}

function receiptBlockers(
  episode,
  privateReceiptInput,
  reconciliationInput,
  scheduleReceipt,
  packageEvidence,
) {
  const blockers = [];
  const storyId = episode.story_id;
  const publishAt = exactUtc(episode.publish_at_utc);
  const privateArtifact = receiptArtifact(privateReceiptInput);
  const reconciliationArtifact = receiptArtifact(reconciliationInput);
  const privateReceipt = privateArtifact.document;
  const videoId = clean(privateReceipt?.platform_object?.video_id);
  let captionId = null;
  let receiptEvidenceKind = null;
  let expectedCaption = null;

  if (privateReceipt?.receipt_type === "governed_youtube_dispatch") {
    const captionIntent = privateReceipt?.requests?.captions?.request_body?.snippet;
    captionId = clean(privateReceipt?.platform_object?.caption_id) || null;
    receiptEvidenceKind = "GOVERNED_DISPATCH";
    expectedCaption = {
      language: "en-GB",
      name: "English (United Kingdom)",
      is_draft: false,
      track_kind: "standard",
      is_auto_synced: false,
      content_sha256: null,
      content_bytes: null,
    };
    if (
      privateReceipt?.schema_version !== 1 ||
      privateReceipt?.story_id !== storyId ||
      privateReceipt?.platform !== "youtube" ||
      privateReceipt?.verdict !== "GREEN" ||
      privateReceipt?.status !== "PRIVATE_VERIFIED" ||
      privateReceipt?.retry_allowed !== false ||
      privateReceipt?.platform_object?.privacy_status !== "private" ||
      !videoId ||
      !captionId
    ) blockers.push("exact_green_private_receipt_required");
    if (
      captionIntent?.videoId !== videoId ||
      captionIntent?.language !== expectedCaption.language ||
      captionIntent?.name !== expectedCaption.name ||
      captionIntent?.isDraft !== expectedCaption.is_draft
    ) blockers.push("exact_caption_intent_required");
  } else if (privateReceipt?.receipt_type === "governed_youtube_private_dispatch") {
    receiptEvidenceKind = "DEFERRED_RECONCILIATION";
    const binding = exactPackageCaptionBinding(episode, packageEvidence);
    blockers.push(...binding.blockers);
    expectedCaption = binding.expectedCaption;
    const intent = { ...binding.intent, video_id: videoId };
    if (!sha256Hex(privateArtifact.sha256)) {
      blockers.push("canonical_private_receipt_sha256_required");
    }
    if (!sha256Hex(reconciliationArtifact.sha256)) {
      blockers.push("private_reconciliation_sha256_required");
    }
    if (!binding.blockers.length) {
      try {
        assertExactDeferredRedReceipt(
          privateReceipt,
          intent,
          privateArtifact.sha256,
        );
      } catch {
        blockers.push("exact_immutable_studio_red_receipt_required");
      }
      try {
        assertExactDeferredGreenProof(
          reconciliationArtifact.document,
          intent,
          privateArtifact.sha256,
        );
      } catch {
        blockers.push("exact_linked_studio_green_reconciliation_required");
      }
    }
    if (
      scheduleReceipt?.private_readiness?.evidence_kind !==
        "DEFERRED_RECONCILIATION" ||
      scheduleReceipt?.private_readiness?.canonical_receipt_sha256 !==
        privateArtifact.sha256 ||
      scheduleReceipt?.private_readiness?.reconciliation_sha256 !==
        reconciliationArtifact.sha256
    ) blockers.push("schedule_private_evidence_chain_mismatch");
  } else {
    blockers.push("supported_private_receipt_required");
  }

  if (
    scheduleReceipt?.schema_version !== 1 ||
    scheduleReceipt?.receipt_type !== "governed_youtube_scheduled_release" ||
    scheduleReceipt?.story_id !== storyId ||
    scheduleReceipt?.platform !== "youtube" ||
    scheduleReceipt?.video_id !== videoId ||
    scheduleReceipt?.channel_id !== EXPECTED_CHANNEL_ID ||
    exactUtc(scheduleReceipt?.publish_at_utc) !== publishAt ||
    scheduleReceipt?.verdict !== "GREEN" ||
    !TRUSTED_SCHEDULE_STATUSES.has(scheduleReceipt?.status) ||
    scheduleReceipt?.retry_allowed !== false
  ) blockers.push("exact_green_schedule_receipt_required");

  return {
    blockers: [...new Set(blockers)],
    videoId,
    captionId,
    receiptEvidenceKind,
    expectedCaption,
  };
}

function observeVideo(video) {
  return {
    id: clean(video?.id),
    channel_id: clean(video?.snippet?.channelId),
    title: clean(video?.snippet?.title),
    description: clean(video?.snippet?.description),
    tags: canonicalTags(video?.snippet?.tags),
    category_id: clean(video?.snippet?.categoryId),
    default_language: clean(video?.snippet?.defaultLanguage),
    default_audio_language: clean(video?.snippet?.defaultAudioLanguage),
    privacy_status: clean(video?.status?.privacyStatus),
    publish_at_utc: exactUtc(video?.status?.publishAt),
    upload_status: clean(video?.status?.uploadStatus),
    processing_status: clean(video?.processingDetails?.processingStatus),
    licence: clean(video?.status?.license),
    embeddable: video?.status?.embeddable,
    public_stats_viewable: video?.status?.publicStatsViewable,
    self_declared_made_for_kids: video?.status?.selfDeclaredMadeForKids,
    contains_synthetic_media: video?.status?.containsSyntheticMedia,
    captions_present:
      video?.contentDetails?.caption === true ||
      clean(video?.contentDetails?.caption).toLowerCase() === "true",
    has_paid_product_placement:
      video?.paidProductPlacementDetails?.hasPaidProductPlacement,
  };
}

function observeCaption(caption) {
  return {
    id: clean(caption?.id),
    video_id: clean(caption?.snippet?.videoId),
    language: clean(caption?.snippet?.language),
    name: clean(caption?.snippet?.name),
    is_draft: caption?.snippet?.isDraft,
    track_kind: clean(caption?.snippet?.trackKind),
    is_auto_synced: caption?.snippet?.isAutoSynced,
    status: clean(caption?.snippet?.status),
  };
}

function videoChecks(observed, episode, videoId) {
  const publishAt = exactUtc(episode.publish_at_utc);
  return {
    video_id_exact: observed.id === videoId,
    channel_id_exact: observed.channel_id === EXPECTED_CHANNEL_ID,
    title_exact: observed.title === episode.title,
    description_exact: observed.description === episode.description,
    tags_exact: isDeepStrictEqual(observed.tags, canonicalTags(episode.tags)),
    category_id_exact: observed.category_id === "20",
    languages_exact:
      observed.default_language === "en-GB" &&
      observed.default_audio_language === "en-GB",
    private_schedule_exact:
      observed.privacy_status === "private" && observed.publish_at_utc === publishAt,
    upload_processed: observed.upload_status === "processed",
    processing_succeeded: observed.processing_status === "succeeded",
    captions_flag_present: observed.captions_present === true,
    standard_licence: observed.licence === "youtube",
    embedding_enabled: observed.embeddable === true,
    public_stats_enabled: observed.public_stats_viewable === true,
    not_made_for_kids: observed.self_declared_made_for_kids === false,
    synthetic_media_disclosed: observed.contains_synthetic_media === true,
    no_paid_product_placement: observed.has_paid_product_placement === false,
  };
}

function captionChecks(observed, videoId, captionId, expectedCaption) {
  return {
    caption_identity_exact:
      (!captionId || observed.id === captionId) &&
      observed.video_id === videoId &&
      observed.language === expectedCaption.language &&
      observed.name === expectedCaption.name &&
      observed.is_draft === expectedCaption.is_draft &&
      observed.track_kind === expectedCaption.track_kind &&
      observed.is_auto_synced === expectedCaption.is_auto_synced,
    caption_manual_track_unique: true,
    captions_serving: observed.status === "serving",
    ...(expectedCaption.content_sha256
      ? { caption_content_binding_exact: true }
      : {}),
  };
}

function isExpectedManualCaption(observed, videoId, expectedCaption) {
  return (
    observed.video_id === videoId &&
    observed.language === expectedCaption.language &&
    observed.name === expectedCaption.name &&
    observed.is_draft === expectedCaption.is_draft &&
    observed.track_kind === expectedCaption.track_kind &&
    observed.is_auto_synced === expectedCaption.is_auto_synced
  );
}

function failedChecks(checks) {
  return Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
}

async function auditEpisode(
  client,
  episode,
  privateReceipt,
  privateReconciliation,
  scheduleReceipt,
  packageEvidence,
) {
  const storyId = episode.story_id;
  const receipt = receiptBlockers(
    episode,
    privateReceipt,
    privateReconciliation,
    scheduleReceipt,
    packageEvidence,
  );
  const blockers = [...receipt.blockers];
  const videoId = receipt.videoId;
  const captionId = receipt.captionId;
  const expectedCaption = receipt.expectedCaption;
  const result = {
    story_id: storyId,
    video_id: videoId || null,
    caption_id: captionId || null,
    receipt_evidence_kind: receipt.receiptEvidenceKind,
    publish_at_utc: exactUtc(episode.publish_at_utc),
    verdict: "RED",
    blockers,
    checks: {},
    observed: { video: null, caption: null },
    expected_caption: expectedCaption,
  };
  if (blockers.length) return { result, requestCount: 0 };

  let videoResponse;
  try {
    videoResponse = await client.videos.list(
      { part: [...VIDEO_PARTS], id: [videoId] },
      { ...REQUEST_OPTIONS },
    );
  } catch (error) {
    blockers.push(`videos_list_failed:${safeError(error)}`);
  }
  const matchingVideos = (videoResponse?.data?.items || []).filter(
    (candidate) => clean(candidate?.id) === videoId,
  );
  if (videoResponse && matchingVideos.length !== 1) {
    blockers.push("youtube_video_readback_not_unique");
  } else if (matchingVideos.length === 1) {
    result.observed.video = observeVideo(matchingVideos[0]);
    Object.assign(result.checks, videoChecks(result.observed.video, episode, videoId));
  }

  let captionResponse;
  try {
    captionResponse = await client.captions.list(
      { part: ["snippet"], videoId },
      { ...REQUEST_OPTIONS },
    );
  } catch (error) {
    blockers.push(`captions_list_failed:${safeError(error)}`);
  }
  const observedCaptions = (captionResponse?.data?.items || []).map(observeCaption);
  const matchingCaptions = observedCaptions.filter((candidate) =>
    isExpectedManualCaption(candidate, videoId, expectedCaption),
  );
  if (captionResponse && matchingCaptions.length === 0) {
    blockers.push("youtube_manual_caption_track_missing");
    result.checks.caption_manual_track_unique = false;
  } else if (captionResponse && matchingCaptions.length > 1) {
    blockers.push("youtube_manual_caption_track_duplicate");
    result.checks.caption_manual_track_unique = false;
  } else if (matchingCaptions.length === 1) {
    result.observed.caption = matchingCaptions[0];
    result.caption_id = matchingCaptions[0].id || null;
    Object.assign(
      result.checks,
      captionChecks(result.observed.caption, videoId, captionId, expectedCaption),
    );
  }

  blockers.push(...failedChecks(result.checks));
  result.blockers = [...new Set(blockers)];
  result.verdict = result.blockers.length === 0 ? "GREEN" : "RED";
  return { result, requestCount: 2 };
}

async function auditSystemTraceYouTubeBuffer(input = {}) {
  const blockers = manifestBlockers(input.manifest, input.manifestSha256);
  if (blockers.length) {
    const error = new Error("system_trace_youtube_final_audit_input_blocked");
    error.blockers = blockers;
    throw error;
  }
  if (!input.client?.videos?.list || !input.client?.captions?.list) {
    throw new Error("read_only_youtube_client_required");
  }
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const episodes = [];
  let requestCount = 0;
  for (const episode of input.manifest.episodes) {
    const audited = await auditEpisode(
      input.client,
      episode,
      input.privateReceipts?.[episode.story_id],
      input.privateReconciliations?.[episode.story_id],
      input.scheduleReceipts?.[episode.story_id],
      input.packages?.[episode.story_id],
    );
    episodes.push(audited.result);
    requestCount += audited.requestCount;
  }
  const reportBlockers = episodes.flatMap((entry) =>
    entry.blockers.map((blocker) => `${entry.story_id}:${blocker}`),
  );
  return {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_final_audit_v1",
    generated_at: generatedAt,
    verdict: reportBlockers.length === 0 ? "GREEN" : "RED",
    blockers: reportBlockers,
    channel: { id: EXPECTED_CHANNEL_ID, title: "Pulse Gaming" },
    manifest_sha256: EXPECTED_MANIFEST_SHA256,
    episode_count: episodes.length,
    remote_read_request_count: requestCount,
    remote_mutation_request_count: 0,
    retry_allowed: false,
    safety: {
      api_operations: ["youtube.videos.list", "youtube.captions.list"],
      upload_requests: 0,
      update_requests: 0,
      oauth_mutations: 0,
      token_file_mutations: 0,
      database_mutations: 0,
    },
    episodes,
  };
}

module.exports = {
  EXPECTED_CHANNEL_ID,
  EXPECTED_EPISODES,
  EXPECTED_MANIFEST_SHA256,
  auditSystemTraceYouTubeBuffer,
};
