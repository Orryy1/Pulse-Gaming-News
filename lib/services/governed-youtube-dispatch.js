"use strict";

const crypto = require("node:crypto");

function text(value) {
  return String(value || "").trim();
}

function packageFingerprint(story = {}) {
  return (
    text(story.final_render_sha256) ||
    text(story.exported_sha256) ||
    text(story.render_sha256) ||
    text(story.exported_path) ||
    text(story.id)
  );
}

function buildGovernedDispatchIdempotencyKey(story = {}) {
  if (!text(story.id)) throw new Error("story_id_required");
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        story_id: text(story.id),
        platform: "youtube",
        package_fingerprint: packageFingerprint(story),
      }),
    )
    .digest("hex");
  return `youtube:${text(story.id)}:${digest}`;
}

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 1000);
}

async function dispatchGovernedYouTube({
  story,
  governance,
  uploadShort,
  persistStory,
  channelId = "pulse-gaming",
  actorId = null,
  now = () => new Date(),
  log = () => {},
} = {}) {
  if (!story || !text(story.id)) throw new Error("story_required");
  if (!governance || typeof governance.prepareDispatch !== "function") {
    throw new Error("publication_governance_repository_required");
  }
  if (typeof uploadShort !== "function") {
    throw new Error("youtube_upload_adapter_required");
  }
  if (typeof persistStory !== "function") {
    throw new Error("legacy_projection_persist_function_required");
  }

  const idempotencyKey = buildGovernedDispatchIdempotencyKey(story);
  governance.prepareDispatch({
    storyId: story.id,
    platform: "youtube",
    channelId,
    idempotencyKey,
    actorId,
    requestFingerprint: packageFingerprint(story),
    evidence: {
      human_review_status:
        story.human_review_status ||
        story.render_review_status ||
        story.operator_review_status ||
        null,
      package_fingerprint_present: !!packageFingerprint(story),
    },
  });

  let adapterResult;
  try {
    adapterResult = await uploadShort(story);
  } catch (error) {
    governance.recordAmbiguousDispatchFailure({
      storyId: story.id,
      platform: "youtube",
      channelId,
      idempotencyKey,
      error,
    });
    log(
      `[publisher] YouTube adapter outcome is ambiguous; reconciliation is required before retry: ${safeError(error)}`,
    );
    return {
      status: "reconciliation_required",
      verified_published: false,
      platform_object_created: false,
      retry_allowed: false,
      idempotency_key: idempotencyKey,
      error: safeError(error),
    };
  }

  if (adapterResult?.blocked === true) {
    governance.recordAmbiguousDispatchFailure({
      storyId: story.id,
      platform: "youtube",
      channelId,
      idempotencyKey,
      error: new Error(
        `remote_duplicate_or_policy_block:${adapterResult.reason || "blocked"}`,
      ),
    });
    return {
      status: "blocked_reconciliation_required",
      verified_published: false,
      platform_object_created: false,
      retry_allowed: false,
      idempotency_key: idempotencyKey,
      reason: adapterResult.reason || "blocked",
    };
  }

  const videoId = text(adapterResult?.videoId);
  const url = text(adapterResult?.url);
  if (!videoId) {
    governance.recordAmbiguousDispatchFailure({
      storyId: story.id,
      platform: "youtube",
      channelId,
      idempotencyKey,
      error: new Error("youtube_adapter_returned_no_external_id"),
    });
    return {
      status: "reconciliation_required",
      verified_published: false,
      platform_object_created: false,
      retry_allowed: false,
      idempotency_key: idempotencyKey,
      error: "youtube_adapter_returned_no_external_id",
    };
  }

  try {
    governance.recordPlatformObjectCreated({
      storyId: story.id,
      platform: "youtube",
      channelId,
      idempotencyKey,
      externalId: videoId,
      externalUrl: url || null,
    });
  } catch (error) {
    // The platform has returned a real ID. Preserve it in the legacy
    // projection as a last-resort recovery breadcrumb, but never call the
    // outcome verified or allow an automatic retry.
    story.youtube_post_id = videoId;
    story.youtube_url = url || null;
    story.youtube_published_at = now().toISOString();
    try {
      await persistStory(story);
    } catch {
      /* both durable paths failed; the returned result retains the ID */
    }
    return {
      status: "reconciliation_required",
      verified_published: false,
      platform_object_created: true,
      retry_allowed: false,
      external_id: videoId,
      external_url: url || null,
      idempotency_key: idempotencyKey,
      error: `governance_object_record_failed:${safeError(error)}`,
    };
  }

  story.youtube_post_id = videoId;
  story.youtube_url = url || null;
  story.youtube_published_at = now().toISOString();
  try {
    await persistStory(story);
  } catch (error) {
    governance.recordPostCreateMetadataFailure({
      storyId: story.id,
      platform: "youtube",
      channelId,
      idempotencyKey,
      error,
    });
    return {
      status: "reconciliation_required",
      verified_published: false,
      platform_object_created: true,
      retry_allowed: false,
      external_id: videoId,
      external_url: url || null,
      idempotency_key: idempotencyKey,
      error: `legacy_projection_failed:${safeError(error)}`,
    };
  }

  governance.recordPlatformConfirmed({
    storyId: story.id,
    platform: "youtube",
    channelId,
    idempotencyKey,
    verificationEvidence: {
      adapter_returned_external_id: true,
      legacy_projection_persisted: true,
    },
  });
  governance.recordPublished({
    storyId: story.id,
    platform: "youtube",
    channelId,
    idempotencyKey,
    verifiedAt: now().toISOString(),
    verificationEvidence: {
      adapter_returned_external_id: true,
      external_url_present: !!url,
    },
  });

  return {
    status: "published",
    verified_published: true,
    platform_object_created: true,
    retry_allowed: false,
    external_id: videoId,
    external_url: url || null,
    idempotency_key: idempotencyKey,
  };
}

module.exports = {
  buildGovernedDispatchIdempotencyKey,
  dispatchGovernedYouTube,
  packageFingerprint,
};
