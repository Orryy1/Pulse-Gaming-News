"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function clean(value) {
  return String(value ?? "").trim();
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(JSON.stringify(value) ?? "undefined"))
    .digest("hex");
}

function exactSettingsDocument(plan) {
  return {
    video_insert: {
      operation: plan?.video_insert?.operation,
      part: structuredClone(plan?.video_insert?.part),
      params: structuredClone(plan?.video_insert?.params),
      requestBody: structuredClone(plan?.video_insert?.requestBody),
      media_sha256: plan?.video_insert?.media_sha256,
    },
    thumbnail_set: plan?.thumbnail_set
      ? {
          operation: plan.thumbnail_set.operation,
          params: structuredClone(plan.thumbnail_set.params),
          media_sha256: plan.thumbnail_set.media_sha256,
          mime_type: plan.thumbnail_set.mime_type,
        }
      : null,
    caption_insert: {
      operation: plan?.caption_insert?.operation,
      part: structuredClone(plan?.caption_insert?.part),
      requestBody: structuredClone(plan?.caption_insert?.requestBody),
      media_sha256: plan?.caption_insert?.media_sha256,
    },
  };
}

function buildDispatchBinding(plan, proof) {
  return {
    request_plan_fingerprint_sha256: fingerprint(plan),
    validation_report_sha256: fingerprint(proof),
    settings_sha256: fingerprint(exactSettingsDocument(plan)),
    video_sha256: plan?.video_insert?.media_sha256 || null,
    captions_sha256: plan?.caption_insert?.media_sha256 || null,
    thumbnail_sha256: plan?.thumbnail_set?.media_sha256 || null,
  };
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function authorityError(blockers) {
  const error = new Error("system_trace_youtube_authority_blocked");
  error.blockers = [...new Set(blockers)];
  return error;
}

function buildSystemTraceYouTubeAuthorities(input = {}) {
  const manifest = input.manifest || {};
  const rights = input.rightsLedger || {};
  const proofs = input.proofs || {};
  const receiptRoot = path.resolve(clean(input.receiptRoot));
  const generatedAt = new Date(input.generatedAt).toISOString();
  const blockers = [];
  const episodes = Array.isArray(manifest.episodes) ? manifest.episodes : [];
  const defaultExpectedPublishAtUtc = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2026, 7, 15 + index, 19, 0, 0, 0)).toISOString(),
  );
  const expectedPublishAtUtc = Array.isArray(input.expectedPublishAtUtc)
    ? input.expectedPublishAtUtc.map((value) => clean(value))
    : defaultExpectedPublishAtUtc;

  if (
    expectedPublishAtUtc.length !== 7 ||
    expectedPublishAtUtc.some((value) => {
      const parsed = Date.parse(value);
      return !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value;
    }) ||
    new Set(expectedPublishAtUtc).size !== 7
  ) blockers.push("exact_seven_publish_slots_required");

  if (
    manifest.schema_version !== 1 ||
    manifest.schema !== "pulse_system_trace_youtube_buffer_v1" ||
    manifest.platform !== "youtube_shorts" ||
    manifest.timezone !== "UTC" ||
    manifest.cadence !== "one_per_day" ||
    manifest.initial_privacy_status !== "private" ||
    manifest.notify_subscribers_on_upload !== false ||
    manifest.synthetic_media_disclosure !== true ||
    clean(manifest?.channel?.id).length === 0 ||
    episodes.length !== 7
  ) blockers.push("closed_seven_episode_manifest_required");

  if (!isSha256(input.manifestSha256)) blockers.push("manifest_sha256_required");
  if (!isSha256(input.rightsLedgerSha256)) blockers.push("rights_ledger_sha256_required");
  if (!path.isAbsolute(receiptRoot)) blockers.push("absolute_receipt_root_required");

  if (
    rights.schema_version !== 1 ||
    rights.schema !== "pulse_system_trace_buffer_rights_ledger_v1" ||
    rights?.scope?.episode_count !== 7 ||
    rights?.scope?.platform !== "youtube_shorts" ||
    rights?.scope?.finished_editorial_video_only !== true ||
    rights?.visuals?.verdict !== "GREEN" ||
    rights?.visuals?.third_party_visual_assets_embedded !== false ||
    rights?.narration?.verdict !== "GREEN" ||
    rights?.narration?.synthetic_media !== true ||
    rights?.narration?.disclosure_setting !== "YES" ||
    rights?.music?.verdict !== "GREEN" ||
    rights?.music?.commercial_use_allowed !== true ||
    rights?.music?.planned_episode_placements !== 7 ||
    rights?.music?.reuse_limit_pass !== true ||
    rights?.sound_effects?.verdict !== "GREEN" ||
    rights?.fonts?.verdict !== "GREEN" ||
    rights?.placement_verdict !== "GREEN" ||
    !Array.isArray(rights.blockers) ||
    rights.blockers.length !== 0 ||
    rights.public_release_scope !== "exact rendered seven-episode System Trace buffer only"
  ) blockers.push("exact_green_series_rights_ledger_required");

  const seenStories = new Set();
  const seenDays = new Set();
  for (const [index, episode] of episodes.entries()) {
    const storyId = clean(episode?.story_id);
    const publishAtMs = Date.parse(episode?.publish_at_utc);
    const expectedMs = Date.parse(expectedPublishAtUtc[index]);
    if (!storyId || seenStories.has(storyId)) blockers.push("unique_story_ids_required");
    seenStories.add(storyId);
    if (!Number.isFinite(publishAtMs) || publishAtMs !== expectedMs) {
      blockers.push("exact_manifest_bound_daily_schedule_required");
    }
    const policyDay = Number.isFinite(publishAtMs)
      ? new Date(publishAtMs).toISOString().slice(0, 10)
      : "invalid";
    if (seenDays.has(policyDay)) blockers.push("one_release_per_utc_day_required");
    seenDays.add(policyDay);

    const proof = proofs[storyId];
    const plan = proof?.request_plan;
    if (
      proof?.schema_version !== 1 ||
      proof?.story_id !== storyId ||
      proof?.verdict !== "NOT_EVALUATED" ||
      proof?.request_shape_verdict !== "PASS" ||
      proof?.publish_allowed !== false ||
      proof?.publish_authority !== "NOT_EVALUATED" ||
      !Array.isArray(proof?.blockers) ||
      proof.blockers.length !== 0 ||
      proof?.mock_dry_run?.verdict !== "REQUEST_SHAPE_PASS" ||
      proof?.mock_dry_run?.request_shape_verdict !== "PASS" ||
      proof?.mock_dry_run?.publish_authority !== "NOT_EVALUATED" ||
      plan?.story_id !== storyId ||
      plan?.verdict !== "REQUEST_SHAPE_PASS" ||
      plan?.request_shape_verdict !== "PASS" ||
      plan?.can_publish !== false ||
      plan?.publish_authority !== "NOT_EVALUATED" ||
      plan?.source_of_truth !== "closed_governed_package" ||
      plan?.video_insert?.params?.notifySubscribers !== false ||
      plan?.video_insert?.requestBody?.status?.privacyStatus !== "private" ||
      plan?.video_insert?.requestBody?.status?.containsSyntheticMedia !== true ||
      !isSha256(plan?.video_insert?.media_sha256) ||
      !isSha256(plan?.caption_insert?.media_sha256)
    ) blockers.push(`closed_request_shape_proof_required:${storyId}`);
  }

  if (blockers.length) throw authorityError(blockers);

  const operatorDecision = Object.freeze({
    schema_version: 1,
    operator_id: "MORR",
    operator_role: "channel_owner_operator",
    trusted_context: "current_authenticated_codex_thread",
    materialised_at: generatedAt,
    quote_timestamp_available: false,
    exact_quotes: [
      "I don't mind it having publication authority if it's good to go.",
      "I am about to run out of usage for many days and I need videos autonomously posting consistently right through the period - make sure this happens",
    ],
    authority_scope: "seven exact private-first uploads followed only by the manifest-bound YouTube native schedules",
    general_autonomous_publication_authority: false,
  });

  const authorities = episodes.map((episode) => {
    const storyId = clean(episode.story_id);
    const proof = proofs[storyId];
    const receiptPath = path.join(receiptRoot, `${storyId}-private-upload-receipt.json`);
    const publishAt = new Date(episode.publish_at_utc).toISOString();
    const privateUpload = {
      schema_version: 1,
      platform: "youtube",
      story_id: storyId,
      verdict: "GREEN",
      publish_allowed: true,
      control_tower: {
        verdict: "GREEN",
        blockers: [],
        scope: "EXACT_PRIVATE_FIRST_UPLOAD_ONLY",
      },
      ...buildDispatchBinding(proof.request_plan, proof),
      dispatch: {
        action_id: `${storyId}:youtube:private`,
        mode: "PRIVATE_FIRST",
        single_use: true,
        receipt_path: receiptPath,
      },
      operator_decision: operatorDecision,
      evidence_binding: {
        manifest_sha256: clean(input.manifestSha256).toLowerCase(),
        rights_ledger_sha256: clean(input.rightsLedgerSha256).toLowerCase(),
      },
    };
    return {
      story_id: storyId,
      private_upload: privateUpload,
      release: {
        verdict: "GREEN",
        authority_scope: "EXACT_YOUTUBE_NATIVE_SCHEDULE_ONLY",
        channel_id: manifest.channel.id,
        publish_at_utc: publishAt,
        public_schedule_allowed: true,
        auto_publish_general_allowed: false,
        notify_subscribers: false,
        action_id: `${storyId}:youtube:schedule:${publishAt}`,
      },
    };
  });

  return {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_authority_v1",
    generated_at: generatedAt,
    verdict: "GREEN",
    blockers: [],
    channel: structuredClone(manifest.channel),
    episode_count: authorities.length,
    operator_decision: operatorDecision,
    evidence_binding: {
      manifest_sha256: clean(input.manifestSha256).toLowerCase(),
      rights_ledger_sha256: clean(input.rightsLedgerSha256).toLowerCase(),
    },
    authorities,
  };
}

module.exports = {
  buildDispatchBinding,
  buildSystemTraceYouTubeAuthorities,
};
