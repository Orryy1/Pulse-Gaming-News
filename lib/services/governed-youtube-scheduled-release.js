"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const {
  assertExactDeferredGreenProof,
  assertExactDeferredRedReceipt,
} = require("./system-trace-youtube-studio-reconcile");

const VIDEO_PARTS = Object.freeze([
  "snippet",
  "status",
  "contentDetails",
  "processingDetails",
  "fileDetails",
]);
const REQUEST_OPTIONS = Object.freeze({ retry: false, timeout: 30_000 });

function clean(value) {
  return String(value ?? "").trim();
}

function canonicalTags(value) {
  return Array.isArray(value)
    ? value.map(clean).filter(Boolean).sort((a, b) => a.localeCompare(b))
    : [];
}

function normaliseIsoUtc(value) {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

function normaliseIntent(input = {}) {
  return {
    story_id: clean(input.story_id),
    video_id: clean(input.video_id),
    channel_id: clean(input.channel_id),
    publish_at_utc: clean(input.publish_at_utc),
    title: clean(input.title),
    description: clean(input.description),
    tags: canonicalTags(input.tags),
    category_id: clean(input.category_id),
    default_language: clean(input.default_language),
    default_audio_language: clean(input.default_audio_language),
    video_bytes: Number(input.video_bytes),
    contains_synthetic_media: input.contains_synthetic_media === true,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildGovernedYouTubeScheduleBinding(intent) {
  return sha256(Buffer.from(JSON.stringify(normaliseIntent(intent)), "utf8"));
}

function validateInput(intent, authority, now) {
  const blockers = [];
  for (const key of [
    "story_id",
    "video_id",
    "channel_id",
    "publish_at_utc",
    "title",
    "description",
    "category_id",
    "default_language",
    "default_audio_language",
  ]) {
    if (!clean(intent[key])) blockers.push(`${key}_required`);
  }
  if (!Number.isSafeInteger(intent.video_bytes) || intent.video_bytes <= 0) {
    blockers.push("video_bytes_invalid");
  }
  if (!intent.tags.length) blockers.push("tags_required");
  if (intent.contains_synthetic_media !== true) {
    blockers.push("synthetic_media_disclosure_required");
  }
  const publishAtMs = Date.parse(intent.publish_at_utc);
  if (
    !Number.isFinite(publishAtMs) ||
    !intent.publish_at_utc.endsWith("Z") ||
    new Date(publishAtMs).toISOString() !== intent.publish_at_utc
  ) {
    blockers.push("publish_at_must_be_exact_iso_utc");
  } else if (publishAtMs <= now.getTime()) {
    blockers.push("publish_at_must_be_future");
  }
  const expectedAction = `${intent.story_id}:youtube:schedule:${intent.publish_at_utc}`;
  if (
    authority?.verdict !== "GREEN" ||
    authority?.action_id !== expectedAction ||
    authority?.binding_sha256 !== buildGovernedYouTubeScheduleBinding(intent)
  ) {
    blockers.push("exact_green_schedule_authority_required");
  }
  if (blockers.length) {
    const error = new Error("governed_youtube_schedule_input_blocked");
    error.blockers = blockers;
    throw error;
  }
}

function observedVideo(video) {
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
    publish_at_utc: normaliseIsoUtc(video?.status?.publishAt),
    upload_status: clean(video?.status?.uploadStatus),
    processing_status: clean(video?.processingDetails?.processingStatus),
    licence: clean(video?.status?.license),
    embeddable: video?.status?.embeddable,
    public_stats_viewable: video?.status?.publicStatsViewable,
    self_declared_made_for_kids: video?.status?.selfDeclaredMadeForKids,
    captions_present:
      video?.contentDetails?.caption === true ||
      clean(video?.contentDetails?.caption).toLowerCase() === "true",
    file_size: clean(video?.fileDetails?.fileSize),
  };
}

function preflightBlockers(observed, intent, { scheduled = false } = {}) {
  const blockers = [];
  const exact = {
    id: intent.video_id,
    channel_id: intent.channel_id,
    title: intent.title,
    description: intent.description,
    tags: intent.tags,
    category_id: intent.category_id,
    default_language: intent.default_language,
    default_audio_language: intent.default_audio_language,
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (!isDeepStrictEqual(observed[key], expected)) blockers.push(`${key}_mismatch`);
  }
  if (observed.privacy_status !== "private") blockers.push("privacy_must_be_private");
  if (observed.upload_status !== "processed") blockers.push("upload_not_processed");
  if (observed.processing_status !== "succeeded") blockers.push("processing_not_succeeded");
  if (observed.licence !== "youtube") blockers.push("licence_mismatch");
  if (observed.embeddable !== true) blockers.push("embeddable_mismatch");
  if (observed.public_stats_viewable !== true) blockers.push("public_stats_mismatch");
  if (observed.self_declared_made_for_kids !== false) blockers.push("made_for_kids_mismatch");
  if (observed.captions_present !== true) blockers.push("captions_missing");
  if (observed.file_size !== String(intent.video_bytes)) blockers.push("file_size_mismatch");
  if (scheduled) {
    if (observed.publish_at_utc !== intent.publish_at_utc) {
      blockers.push("publish_at_mismatch");
    }
  } else if (
    observed.publish_at_utc !== null &&
    observed.publish_at_utc !== intent.publish_at_utc
  ) {
    blockers.push("different_schedule_already_present");
  }
  return blockers;
}

async function listVideo(client, intent) {
  const response = await client.videos.list(
    { part: [...VIDEO_PARTS], id: [intent.video_id] },
    { ...REQUEST_OPTIONS },
  );
  const items = response?.data?.items;
  if (!Array.isArray(items) || items.length !== 1) {
    throw new Error("governed_youtube_schedule_video_readback_not_unique");
  }
  return observedVideo(items[0]);
}

function receiptBase(intent, authority, generatedAt) {
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_scheduled_release",
    generated_at: generatedAt,
    story_id: intent.story_id,
    platform: "youtube",
    video_id: intent.video_id,
    channel_id: intent.channel_id,
    publish_at_utc: intent.publish_at_utc,
    authority: {
      action_id: authority.action_id,
      binding_sha256: authority.binding_sha256,
    },
    retry_allowed: false,
    request_scope: "videos.update:status_only",
  };
}

function scheduleRequest(intent) {
  return {
    part: ["status"],
    requestBody: {
      id: intent.video_id,
      status: {
        privacyStatus: "private",
        publishAt: intent.publish_at_utc,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
        license: "youtube",
        embeddable: true,
        publicStatsViewable: true,
      },
    },
  };
}

function resolveGovernedYouTubePrivateReadiness(input = {}) {
  const receipt = input.privateReceipt;
  const intent = input.intent || {};
  const expectedAction = `${clean(intent.story_id)}:youtube:private`;
  const greenIsExact =
    receipt?.schema_version === 1 &&
    receipt?.receipt_type === "governed_youtube_private_dispatch" &&
    receipt?.story_id === clean(intent.story_id) &&
    receipt?.platform === "youtube" &&
    receipt?.verdict === "GREEN" &&
    receipt?.status === "PRIVATE_VERIFIED" &&
    receipt?.retry_allowed === false &&
    receipt?.studio_ingest === true &&
    receipt?.platform_object?.video_id === clean(intent.video_id) &&
    receipt?.platform_object?.privacy_status === "private" &&
    receipt?.requests?.video?.media_sha256 === clean(intent.video_sha256).toLowerCase() &&
    receipt?.authority?.action_id === expectedAction &&
    receipt?.readback?.captions_present === true;
  if (greenIsExact) {
    return {
      verdict: "GREEN",
      status: "PRIVATE_VERIFIED",
      evidence_kind: "CANONICAL_PRIVATE_RECEIPT",
      video_id: clean(intent.video_id),
      receipt,
    };
  }

  if (receipt?.verdict !== "RED") {
    throw new Error("governed_youtube_private_readiness_blocked");
  }
  assertExactDeferredRedReceipt(
    receipt,
    intent,
    input.sourceReceiptSha256,
  );
  if (!input.reconciliationProof) {
    throw new Error("governed_youtube_private_readiness_blocked:reconciliation_required");
  }
  assertExactDeferredGreenProof(
    input.reconciliationProof,
    intent,
    input.sourceReceiptSha256,
  );
  return {
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    evidence_kind: "DEFERRED_RECONCILIATION",
    video_id: clean(intent.video_id),
    receipt: input.reconciliationProof,
    source_receipt: receipt,
  };
}

async function executeGovernedYouTubeScheduledRelease(input = {}) {
  const intent = normaliseIntent(input.intent);
  const authority = input.authority || {};
  const now = input.now instanceof Date ? input.now : new Date();
  const generatedAt = clean(input.generatedAt) || now.toISOString();
  validateInput(intent, authority, now);
  if (!input.client?.videos?.list || !input.client?.videos?.update) {
    throw new Error("trusted_youtube_client_required");
  }

  const before = await listVideo(input.client, intent);
  const beforeBlockers = preflightBlockers(before, intent);
  if (beforeBlockers.length) {
    const error = new Error("governed_youtube_schedule_preflight_blocked");
    error.blockers = beforeBlockers;
    throw error;
  }
  if (before.publish_at_utc === intent.publish_at_utc) {
    return {
      ...receiptBase(intent, authority, generatedAt),
      verdict: "GREEN",
      status: "SCHEDULE_ALREADY_VERIFIED",
      visibility_update_count: 0,
      readback: before,
    };
  }

  let updateError = null;
  try {
    await input.client.videos.update(scheduleRequest(intent), { ...REQUEST_OPTIONS });
  } catch (error) {
    updateError = error;
  }

  const configuredAttempts = Number(input.readbackAttempts);
  const readbackAttempts = Number.isSafeInteger(configuredAttempts) &&
    configuredAttempts >= 1 && configuredAttempts <= 12
    ? configuredAttempts
    : 12;
  const configuredInterval = Number(input.pollIntervalMs);
  const pollIntervalMs = Number.isFinite(configuredInterval) &&
    configuredInterval >= 0 && configuredInterval <= 60_000
    ? configuredInterval
    : 5_000;
  const wait = typeof input.wait === "function"
    ? input.wait
    : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let after = null;
  let afterBlockers = [];
  let readbackAttemptCount = 0;
  for (let attempt = 1; attempt <= readbackAttempts; attempt += 1) {
    readbackAttemptCount = attempt;
    try {
      after = await listVideo(input.client, intent);
      afterBlockers = preflightBlockers(after, intent, { scheduled: true });
    } catch (error) {
      afterBlockers = [`readback_failed:${clean(error?.message || error)}`];
    }
    if (!afterBlockers.length) break;
    if (attempt < readbackAttempts) await wait(pollIntervalMs);
  }

  if (!afterBlockers.length) {
    return {
      ...receiptBase(intent, authority, generatedAt),
      verdict: "GREEN",
      status: updateError
        ? "SCHEDULE_RECONCILED_AFTER_AMBIGUOUS_RESPONSE"
        : "SCHEDULE_VERIFIED",
      visibility_update_count: 1,
      update_response_ambiguous: Boolean(updateError),
      readback_attempt_count: readbackAttemptCount,
      readback: after,
    };
  }

  const error = new Error(
    updateError
      ? "governed_youtube_schedule_outcome_unknown"
      : "governed_youtube_schedule_readback_blocked",
  );
  error.blockers = afterBlockers;
  error.receipt = {
    ...receiptBase(intent, authority, generatedAt),
    verdict: "RED",
    status: updateError ? "SCHEDULE_OUTCOME_UNKNOWN" : "SCHEDULE_READBACK_FAILED",
    visibility_update_count: 1,
    update_response_ambiguous: Boolean(updateError),
    readback_attempt_count: readbackAttemptCount,
    readback: after || null,
    blockers: afterBlockers,
  };
  throw error;
}

function assertExactDeferredScheduleRedReceipt(receipt, intentInput, authority, sourceSha256) {
  const intent = normaliseIntent(intentInput);
  const blockers = [];
  if (!/^[a-f0-9]{64}$/.test(clean(sourceSha256).toLowerCase())) {
    blockers.push("source_receipt_sha256_invalid");
  }
  if (
    receipt?.schema_version !== 1 ||
    receipt?.receipt_type !== "governed_youtube_scheduled_release" ||
    receipt?.story_id !== intent.story_id ||
    receipt?.platform !== "youtube" ||
    receipt?.video_id !== intent.video_id ||
    receipt?.channel_id !== intent.channel_id ||
    normaliseIsoUtc(receipt?.publish_at_utc) !== intent.publish_at_utc ||
    receipt?.authority?.action_id !== authority.action_id ||
    receipt?.authority?.binding_sha256 !== authority.binding_sha256 ||
    receipt?.retry_allowed !== false ||
    receipt?.request_scope !== "videos.update:status_only" ||
    receipt?.verdict !== "RED" ||
    receipt?.status !== "SCHEDULE_READBACK_FAILED" ||
    receipt?.visibility_update_count !== 1 ||
    receipt?.update_response_ambiguous !== false ||
    !isDeepStrictEqual(receipt?.blockers, ["publish_at_mismatch"])
  ) blockers.push("source_receipt_identity_mismatch");
  if (
    !receipt?.readback ||
    !isDeepStrictEqual(
      preflightBlockers(receipt.readback, intent, { scheduled: true }),
      ["publish_at_mismatch"],
    )
  ) blockers.push("source_receipt_readback_mismatch");
  if (blockers.length) {
    const error = new Error("governed_youtube_schedule_deferred_source_receipt_blocked");
    error.blockers = blockers;
    throw error;
  }
}

function deferredScheduleProofBase(intent, authority, sourceSha256, generatedAt, readback) {
  return {
    ...receiptBase(intent, authority, generatedAt),
    receipt_type: "governed_youtube_schedule_reconciliation",
    verdict: "GREEN",
    status: "SCHEDULE_VERIFIED",
    verification_outcome: "DEFERRED_SCHEDULE_READBACK_VERIFIED",
    remote_mutation_count: 0,
    source_receipt: {
      sha256: clean(sourceSha256).toLowerCase(),
      verdict: "RED",
      status: "SCHEDULE_READBACK_FAILED",
      blocker: "publish_at_mismatch",
    },
    readback,
  };
}

function assertExactDeferredScheduleGreenProof(proof, intentInput, authority, sourceSha256) {
  const intent = normaliseIntent(intentInput);
  const blockers = [];
  if (
    proof?.schema_version !== 1 ||
    proof?.receipt_type !== "governed_youtube_schedule_reconciliation" ||
    proof?.story_id !== intent.story_id ||
    proof?.platform !== "youtube" ||
    proof?.video_id !== intent.video_id ||
    proof?.channel_id !== intent.channel_id ||
    normaliseIsoUtc(proof?.publish_at_utc) !== intent.publish_at_utc ||
    proof?.authority?.action_id !== authority.action_id ||
    proof?.authority?.binding_sha256 !== authority.binding_sha256 ||
    proof?.retry_allowed !== false ||
    proof?.request_scope !== "videos.update:status_only" ||
    proof?.verdict !== "GREEN" ||
    proof?.status !== "SCHEDULE_VERIFIED" ||
    proof?.verification_outcome !== "DEFERRED_SCHEDULE_READBACK_VERIFIED" ||
    proof?.remote_mutation_count !== 0 ||
    proof?.source_receipt?.sha256 !== clean(sourceSha256).toLowerCase() ||
    proof?.source_receipt?.verdict !== "RED" ||
    proof?.source_receipt?.status !== "SCHEDULE_READBACK_FAILED" ||
    proof?.source_receipt?.blocker !== "publish_at_mismatch"
  ) blockers.push("schedule_green_proof_identity_mismatch");
  if (
    !proof?.readback ||
    preflightBlockers(proof.readback, intent, { scheduled: true }).length
  ) blockers.push("schedule_green_proof_readback_mismatch");
  if (blockers.length) {
    const error = new Error("governed_youtube_schedule_deferred_green_proof_blocked");
    error.blockers = blockers;
    throw error;
  }
  return proof;
}

async function executeDeferredGovernedYouTubeScheduleReconciliation(input = {}) {
  const intent = normaliseIntent(input.intent);
  const authority = input.authority || {};
  validateInput(intent, authority, input.now instanceof Date ? input.now : new Date());
  assertExactDeferredScheduleRedReceipt(
    input.sourceReceipt,
    intent,
    authority,
    input.sourceReceiptSha256,
  );
  if (!input.client?.videos?.list) throw new Error("trusted_youtube_client_required");
  const readback = await listVideo(input.client, intent);
  const blockers = preflightBlockers(readback, intent, { scheduled: true });
  if (blockers.length) {
    const error = new Error("governed_youtube_schedule_deferred_exact_readback_blocked");
    error.blockers = blockers;
    throw error;
  }
  return deferredScheduleProofBase(
    intent,
    authority,
    input.sourceReceiptSha256,
    clean(input.generatedAt) || new Date().toISOString(),
    readback,
  );
}

module.exports = {
  assertExactDeferredScheduleGreenProof,
  assertExactDeferredScheduleRedReceipt,
  buildGovernedYouTubeScheduleBinding,
  executeDeferredGovernedYouTubeScheduleReconciliation,
  executeGovernedYouTubeScheduledRelease,
  resolveGovernedYouTubePrivateReadiness,
};
