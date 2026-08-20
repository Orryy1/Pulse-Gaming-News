"use strict";

const { isDeepStrictEqual } = require("node:util");

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

function canonicalTags(tags) {
  return Array.isArray(tags)
    ? tags
        .map((tag) => String(tag ?? ""))
        .filter((tag) => tag.length > 0)
        .sort((left, right) => left.localeCompare(right))
    : [];
}

function normaliseIntent(input = {}) {
  return {
    story_id: clean(input.story_id),
    video_id: clean(input.video_id),
    channel_id: clean(input.channel_id),
    title: String(input.title ?? ""),
    description: String(input.description ?? ""),
    tags: Array.isArray(input.tags)
      ? input.tags
          .map((tag) => String(tag ?? ""))
          .filter((tag) => tag.length > 0)
      : [],
    category_id: clean(input.category_id),
    default_language: clean(input.default_language),
    default_audio_language: clean(input.default_audio_language),
    video_bytes: Number(input.video_bytes),
    video_sha256: clean(input.video_sha256).toLowerCase(),
    authority_action_id: clean(input.authority_action_id),
  };
}

function validateIntent(intent) {
  const blockers = [];
  for (const key of [
    "story_id",
    "video_id",
    "channel_id",
    "title",
    "description",
    "category_id",
    "default_language",
    "default_audio_language",
    "authority_action_id",
  ]) {
    if (!clean(intent[key])) blockers.push(`${key}_required`);
  }
  if (!intent.tags.length) blockers.push("tags_required");
  if (!Number.isSafeInteger(intent.video_bytes) || intent.video_bytes <= 0) {
    blockers.push("video_bytes_invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(intent.video_sha256)) {
    blockers.push("video_sha256_invalid");
  }
  if (intent.authority_action_id !== `${intent.story_id}:youtube:private`) {
    blockers.push("authority_action_id_mismatch");
  }
  if (blockers.length) {
    const error = new Error(
      "system_trace_youtube_studio_reconcile_input_blocked",
    );
    error.blockers = blockers;
    throw error;
  }
}

function observedVideo(video) {
  return {
    id: clean(video?.id),
    channel_id: clean(video?.snippet?.channelId),
    title: String(video?.snippet?.title ?? ""),
    description: String(video?.snippet?.description ?? ""),
    tags: canonicalTags(video?.snippet?.tags),
    category_id: clean(video?.snippet?.categoryId),
    default_language: clean(video?.snippet?.defaultLanguage),
    default_audio_language: clean(video?.snippet?.defaultAudioLanguage),
    privacy_status: clean(video?.status?.privacyStatus),
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

function exactBlockers(observed, intent) {
  const blockers = [];
  const exact = {
    id: intent.video_id,
    channel_id: intent.channel_id,
    title: intent.title,
    description: intent.description,
    tags: canonicalTags(intent.tags),
    category_id: intent.category_id,
    default_audio_language: intent.default_audio_language,
  };
  for (const [key, expected] of Object.entries(exact)) {
    if (!isDeepStrictEqual(observed[key], expected))
      blockers.push(`${key}_mismatch`);
  }
  if (!observed.default_language) blockers.push("default_language_missing");
  else if (observed.default_language !== intent.default_language) {
    blockers.push("default_language_mismatch");
  }
  if (observed.privacy_status !== "private")
    blockers.push("privacy_status_mismatch");
  if (observed.upload_status !== "processed")
    blockers.push("upload_status_mismatch");
  if (observed.processing_status !== "succeeded")
    blockers.push("processing_status_mismatch");
  if (observed.licence !== "youtube") blockers.push("licence_mismatch");
  if (observed.embeddable !== true) blockers.push("embeddable_mismatch");
  if (observed.public_stats_viewable !== true)
    blockers.push("public_stats_mismatch");
  if (observed.self_declared_made_for_kids !== false)
    blockers.push("made_for_kids_mismatch");
  if (observed.captions_present !== true) blockers.push("captions_missing");
  if (observed.file_size !== String(intent.video_bytes))
    blockers.push("file_size_mismatch");
  return blockers;
}

async function readVideo(client, videoId) {
  const response = await client.videos.list(
    { part: [...VIDEO_PARTS], id: [videoId] },
    { ...REQUEST_OPTIONS },
  );
  const items = response?.data?.items;
  if (!Array.isArray(items) || items.length !== 1) {
    throw new Error("system_trace_youtube_studio_video_readback_not_unique");
  }
  return observedVideo(items[0]);
}

function snippetRepairRequest(intent) {
  return {
    part: ["snippet"],
    requestBody: {
      id: intent.video_id,
      snippet: {
        title: intent.title,
        description: intent.description,
        tags: [...intent.tags],
        categoryId: intent.category_id,
        defaultLanguage: intent.default_language,
        defaultAudioLanguage: intent.default_audio_language,
      },
    },
  };
}

function receiptBase(intent, generatedAt) {
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: generatedAt,
    story_id: intent.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: {
      video_id: intent.video_id,
      privacy_status: "private",
    },
    requests: {
      video: {
        media_sha256: intent.video_sha256,
      },
    },
    authority: {
      action_id: intent.authority_action_id,
    },
  };
}

async function executeSystemTraceYouTubeStudioReconcile(input = {}) {
  const intent = normaliseIntent(input.intent);
  validateIntent(intent);
  if (!input.client?.videos?.list || !input.client?.videos?.update) {
    throw new Error("trusted_youtube_client_required");
  }
  const generatedAt = clean(input.generatedAt) || new Date().toISOString();
  const before = await readVideo(input.client, intent.video_id);
  const blockers = exactBlockers(before, intent);

  if (!blockers.length) {
    return {
      ...receiptBase(intent, generatedAt),
      verification_outcome: "EXACT_STUDIO_INGEST_VERIFIED",
      snippet_update_count: 0,
      update_response_ambiguous: false,
      readback: before,
    };
  }

  if (!isDeepStrictEqual(blockers, ["default_language_missing"])) {
    const error = new Error("system_trace_youtube_studio_reconcile_blocked");
    error.blockers = blockers;
    error.receipt = {
      ...receiptBase(intent, generatedAt),
      verdict: "RED",
      status: "PRIVATE_RECONCILIATION_BLOCKED",
      verification_outcome: "REMOTE_MISMATCH_NO_MUTATION",
      snippet_update_count: 0,
      readback: before,
      blockers,
    };
    throw error;
  }

  let updateError = null;
  try {
    await input.client.videos.update(snippetRepairRequest(intent), {
      ...REQUEST_OPTIONS,
    });
  } catch (error) {
    updateError = error;
  }

  const readbackAttempts = input.pollReadback === true ? 12 : 1;
  const sleep =
    typeof input.sleep === "function"
      ? input.sleep
      : (milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds));
  let after = null;
  let afterBlockers = [];
  for (let attempt = 1; attempt <= readbackAttempts; attempt += 1) {
    try {
      after = await readVideo(input.client, intent.video_id);
      afterBlockers = exactBlockers(after, intent);
    } catch (error) {
      afterBlockers = [`readback_failed:${clean(error?.message || error)}`];
    }
    if (!afterBlockers.length || attempt === readbackAttempts) break;
    await sleep(500);
  }

  if (!afterBlockers.length) {
    return {
      ...receiptBase(intent, generatedAt),
      verification_outcome: updateError
        ? "RECONCILED_AFTER_AMBIGUOUS_LANGUAGE_UPDATE"
        : "LANGUAGE_REPAIRED_AND_VERIFIED",
      snippet_update_count: 1,
      update_response_ambiguous: Boolean(updateError),
      readback: after,
    };
  }

  const error = new Error(
    updateError
      ? "system_trace_youtube_studio_reconcile_outcome_unknown"
      : "system_trace_youtube_studio_reconcile_readback_blocked",
  );
  error.blockers = afterBlockers;
  error.receipt = {
    ...receiptBase(intent, generatedAt),
    verdict: "RED",
    status: updateError
      ? "PRIVATE_RECONCILIATION_OUTCOME_UNKNOWN"
      : "PRIVATE_RECONCILIATION_FAILED",
    verification_outcome: updateError
      ? "AMBIGUOUS_LANGUAGE_UPDATE_NOT_VERIFIED"
      : "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: Boolean(updateError),
    readback: after,
    blockers: afterBlockers,
  };
  throw error;
}

async function verifyExactSystemTraceYouTubeStudioVideo(input = {}) {
  const intent = normaliseIntent(input.intent);
  validateIntent(intent);
  if (!input.client?.videos?.list)
    throw new Error("trusted_youtube_client_required");
  const readback = await readVideo(input.client, intent.video_id);
  const blockers = exactBlockers(readback, intent);
  if (blockers.length) {
    const error = new Error(
      "system_trace_youtube_studio_exact_readback_blocked",
    );
    error.blockers = blockers;
    error.readback = readback;
    throw error;
  }
  return readback;
}

function assertExactDeferredRedReceipt(receipt, intent, sourceReceiptSha256) {
  const blockers = [];
  if (!/^[a-f0-9]{64}$/.test(clean(sourceReceiptSha256).toLowerCase())) {
    blockers.push("source_receipt_sha256_invalid");
  }
  const baseIdentityMatches =
    receipt?.schema_version === 1 &&
    receipt?.receipt_type === "governed_youtube_private_dispatch" &&
    receipt?.story_id === intent.story_id &&
    receipt?.platform === "youtube" &&
    receipt?.verdict === "RED" &&
    receipt?.retry_allowed === false &&
    receipt?.studio_ingest === true &&
    receipt?.platform_object?.video_id === intent.video_id &&
    receipt?.platform_object?.privacy_status === "private" &&
    receipt?.requests?.video?.media_sha256 === intent.video_sha256 &&
    receipt?.authority?.action_id === intent.authority_action_id;
  const exactLanguageFailure =
    receipt?.status === "PRIVATE_RECONCILIATION_FAILED" &&
    receipt?.verification_outcome === "LANGUAGE_REPAIR_NOT_VERIFIED" &&
    receipt?.snippet_update_count === 1 &&
    receipt?.update_response_ambiguous === false &&
    isDeepStrictEqual(receipt?.blockers, ["default_language_missing"]);
  const exactAuthPreflightFailure =
    receipt?.status === "STUDIO_RECONCILIATION_ATTEMPT_BLOCKED" &&
    isDeepStrictEqual(receipt?.blockers, [
      "youtube_auth_must_be_current_before_studio_reconcile",
    ]) &&
    receipt?.verification_outcome === undefined &&
    receipt?.snippet_update_count === undefined &&
    receipt?.update_response_ambiguous === undefined &&
    receipt?.readback === undefined;
  if (
    !baseIdentityMatches ||
    (!exactLanguageFailure && !exactAuthPreflightFailure)
  ) {
    blockers.push("source_receipt_identity_mismatch");
  }
  if (
    exactLanguageFailure &&
    (!receipt?.readback ||
      !isDeepStrictEqual(exactBlockers(receipt.readback, intent), [
        "default_language_missing",
      ]))
  )
    blockers.push("source_receipt_readback_mismatch");
  if (blockers.length) {
    const error = new Error(
      "system_trace_youtube_studio_deferred_source_receipt_blocked",
    );
    error.blockers = blockers;
    throw error;
  }
  return exactAuthPreflightFailure
    ? {
        authPreflight: true,
        status: "STUDIO_RECONCILIATION_ATTEMPT_BLOCKED",
        blocker: "youtube_auth_must_be_current_before_studio_reconcile",
        verificationOutcome: "DEFERRED_AUTH_PREFLIGHT_READBACK_VERIFIED",
      }
    : {
        authPreflight: false,
        status: "PRIVATE_RECONCILIATION_FAILED",
        blocker: "default_language_missing",
        verificationOutcome: "DEFERRED_LANGUAGE_READBACK_VERIFIED",
      };
}

async function executeDeferredSystemTraceYouTubeStudioReconciliation(
  input = {},
) {
  const intent = normaliseIntent(input.intent);
  validateIntent(intent);
  const sourceContract = assertExactDeferredRedReceipt(
    input.sourceReceipt,
    intent,
    input.sourceReceiptSha256,
  );
  let readback;
  let recovery;
  let verificationOutcome = sourceContract.verificationOutcome;
  let remoteMutationCount = 0;
  if (sourceContract.authPreflight) {
    const recovered = await executeSystemTraceYouTubeStudioReconcile({
      client: input.client,
      intent,
      generatedAt: clean(input.generatedAt) || new Date().toISOString(),
      pollReadback: input.pollReadback === true,
      sleep: input.sleep,
    });
    readback = recovered.readback;
    remoteMutationCount = recovered.snippet_update_count;
    recovery = {
      snippet_update_count: recovered.snippet_update_count,
      update_response_ambiguous: recovered.update_response_ambiguous,
    };
    if (remoteMutationCount === 1) {
      verificationOutcome = "DEFERRED_AUTH_PREFLIGHT_LANGUAGE_REPAIR_VERIFIED";
    }
  } else {
    readback = await verifyExactSystemTraceYouTubeStudioVideo({
      client: input.client,
      intent,
    });
  }
  return {
    ...receiptBase(
      intent,
      clean(input.generatedAt) || new Date().toISOString(),
    ),
    receipt_type: "governed_youtube_private_reconciliation",
    verification_outcome: verificationOutcome,
    remote_mutation_count: remoteMutationCount,
    source_receipt: {
      sha256: clean(input.sourceReceiptSha256).toLowerCase(),
      verdict: "RED",
      status: sourceContract.status,
      blocker: sourceContract.blocker,
    },
    ...(sourceContract.authPreflight ? { recovery } : {}),
    readback,
  };
}

function assertExactDeferredGreenProof(
  proof,
  intentInput,
  sourceReceiptSha256,
) {
  const intent = normaliseIntent(intentInput);
  validateIntent(intent);
  const sourceSha256 = clean(sourceReceiptSha256).toLowerCase();
  const blockers = [];
  const languageProof =
    proof?.verification_outcome === "DEFERRED_LANGUAGE_READBACK_VERIFIED" &&
    proof?.remote_mutation_count === 0 &&
    proof?.recovery === undefined &&
    proof?.source_receipt?.status === "PRIVATE_RECONCILIATION_FAILED" &&
    proof?.source_receipt?.blocker === "default_language_missing";
  const authPreflightReadbackProof =
    proof?.verification_outcome ===
      "DEFERRED_AUTH_PREFLIGHT_READBACK_VERIFIED" &&
    proof?.remote_mutation_count === 0 &&
    proof?.recovery?.snippet_update_count === 0 &&
    proof?.recovery?.update_response_ambiguous === false &&
    proof?.source_receipt?.status === "STUDIO_RECONCILIATION_ATTEMPT_BLOCKED" &&
    proof?.source_receipt?.blocker ===
      "youtube_auth_must_be_current_before_studio_reconcile";
  const authPreflightRepairProof =
    proof?.verification_outcome ===
      "DEFERRED_AUTH_PREFLIGHT_LANGUAGE_REPAIR_VERIFIED" &&
    proof?.remote_mutation_count === 1 &&
    proof?.recovery?.snippet_update_count === 1 &&
    typeof proof?.recovery?.update_response_ambiguous === "boolean" &&
    proof?.source_receipt?.status === "STUDIO_RECONCILIATION_ATTEMPT_BLOCKED" &&
    proof?.source_receipt?.blocker ===
      "youtube_auth_must_be_current_before_studio_reconcile";
  if (
    proof?.schema_version !== 1 ||
    proof?.receipt_type !== "governed_youtube_private_reconciliation" ||
    proof?.story_id !== intent.story_id ||
    proof?.platform !== "youtube" ||
    proof?.verdict !== "GREEN" ||
    proof?.status !== "PRIVATE_VERIFIED" ||
    proof?.retry_allowed !== false ||
    proof?.studio_ingest !== true ||
    proof?.platform_object?.video_id !== intent.video_id ||
    proof?.platform_object?.privacy_status !== "private" ||
    proof?.requests?.video?.media_sha256 !== intent.video_sha256 ||
    proof?.authority?.action_id !== intent.authority_action_id ||
    proof?.source_receipt?.sha256 !== sourceSha256 ||
    proof?.source_receipt?.verdict !== "RED" ||
    (!languageProof && !authPreflightReadbackProof && !authPreflightRepairProof)
  )
    blockers.push("deferred_green_proof_identity_mismatch");
  if (!proof?.readback || exactBlockers(proof.readback, intent).length) {
    blockers.push("deferred_green_proof_readback_mismatch");
  }
  if (blockers.length) {
    const error = new Error(
      "system_trace_youtube_studio_deferred_green_proof_blocked",
    );
    error.blockers = blockers;
    throw error;
  }
  return proof;
}

module.exports = {
  assertExactDeferredRedReceipt,
  assertExactDeferredGreenProof,
  executeDeferredSystemTraceYouTubeStudioReconciliation,
  executeSystemTraceYouTubeStudioReconcile,
  verifyExactSystemTraceYouTubeStudioVideo,
};
