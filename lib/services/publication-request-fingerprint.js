"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function canonicalPublicationRequest(
  story,
  {
    channelId,
    platform = "youtube",
    mediaSha256,
    channel = null,
    publicationEvidence = null,
  } = {},
) {
  return stableValue({
    contract_version: 2,
    story_id: String(story?.id || "").trim(),
    channel_id: String(channelId || "").trim(),
    platform: String(platform || "").trim(),
    media_sha256: String(mediaSha256 || "").trim(),
    title: story?.title || null,
    suggested_title: story?.suggested_title || null,
    title_variants: story?.title_variants || null,
    selected_title: story?.selected_title || null,
    full_script: story?.full_script || null,
    hook: story?.hook || null,
    body: story?.body || null,
    loop: story?.loop || null,
    pinned_comment: story?.pinned_comment || null,
    pinned_comment_approval: story?.pinned_comment_approval || null,
    affiliate_url: story?.affiliate_url || null,
    source_url: story?.url || null,
    classification: story?.classification || null,
    flair: story?.flair || null,
    content_pillar: story?.content_pillar || null,
    disclosure: story?.synthetic_media_disclosure || null,
    publication_evidence: publicationEvidence || null,
    channel_contract: channel
      ? {
          id: channel.id || null,
          name: channel.name || null,
          niche: channel.niche || null,
          tagline: channel.tagline || null,
          cta: channel.cta || null,
          youtube_category: channel.youtubeCategory || null,
        }
      : null,
  });
}

async function fingerprintPublicationRequest(
  story,
  {
    channelId,
    platform = "youtube",
    resolveMediaPath = null,
    channel = null,
    publicationEvidence = null,
  } = {},
) {
  const storyId = String(story?.id || "").trim();
  const normalisedChannelId = String(channelId || "").trim();
  const storedPath = String(story?.exported_path || "").trim();
  if (!storyId) throw new Error("publication_fingerprint_story_required");
  if (!normalisedChannelId) {
    throw new Error("publication_fingerprint_channel_required");
  }
  if (!storedPath) throw new Error("publication_fingerprint_media_required");
  const resolvedPath =
    typeof resolveMediaPath === "function"
      ? await resolveMediaPath(storedPath)
      : storedPath;
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error("publication_fingerprint_media_not_found");
  }
  const mediaSha256 = await sha256File(resolvedPath);
  const request = canonicalPublicationRequest(story, {
    channelId: normalisedChannelId,
    platform,
    mediaSha256,
    channel,
    publicationEvidence,
  });
  const canonicalJson = JSON.stringify(request);
  return {
    request,
    canonical_json: canonicalJson,
    request_fingerprint: sha256Text(canonicalJson),
    media_sha256: mediaSha256,
    script_sha256: sha256Text(story.full_script || ""),
  };
}

module.exports = {
  canonicalPublicationRequest,
  fingerprintPublicationRequest,
  sha256File,
  sha256Text,
  stableValue,
};
