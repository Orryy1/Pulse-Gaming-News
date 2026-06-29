"use strict";

const CORE_PLATFORM_ID_FIELDS = [
  "youtube_post_id",
  "instagram_media_id",
  "facebook_post_id",
];

function isRealPlatformPostId(value) {
  const text = String(value || "").trim();
  return text.length > 0 && !/^DUPE_/i.test(text);
}

function tiktokDisabledForPlatformStatus(env = process.env) {
  return /^(false|0|no|off)$/i.test(
    String(env.TIKTOK_ENABLED || env.TIKTOK_AUTO_UPLOAD_ENABLED || "").trim(),
  );
}

function corePlatformIdFields({ env = process.env } = {}) {
  const fields = [...CORE_PLATFORM_ID_FIELDS];
  if (!tiktokDisabledForPlatformStatus(env)) fields.splice(1, 0, "tiktok_post_id");
  return fields;
}

function derivePublishStatusFromPlatformEvidence(
  story = {},
  { env = process.env } = {},
) {
  const fields = corePlatformIdFields({ env });
  const done = fields.filter((field) => isRealPlatformPostId(story[field])).length;
  if (done <= 0) return null;
  return done >= fields.length ? "published" : "partial";
}

function hasPublicPlatformEvidence(story = {}, options = {}) {
  return Boolean(
    derivePublishStatusFromPlatformEvidence(story, options) ||
      story.published_at ||
      story.youtube_published_at,
  );
}

module.exports = {
  CORE_PLATFORM_ID_FIELDS,
  corePlatformIdFields,
  derivePublishStatusFromPlatformEvidence,
  hasPublicPlatformEvidence,
  isRealPlatformPostId,
  tiktokDisabledForPlatformStatus,
};
