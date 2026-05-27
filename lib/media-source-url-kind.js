"use strict";

const path = require("node:path");

const DIRECT_VIDEO_EXT_RE = /\.(?:mp4|webm|mov)(?:$|[?#])/i;
const HLS_MANIFEST_EXT_RE = /\.m3u8(?:$|[?#])/i;
const DASH_MANIFEST_EXT_RE = /\.mpd(?:$|[?#])/i;
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i;

function parseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hostWithoutWww(parsed) {
  return String(parsed?.hostname || "").toLowerCase().replace(/^www\./, "");
}

function isYouTubeHost(host) {
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

function youtubeKind(parsed) {
  const host = hostWithoutWww(parsed);
  const pathName = String(parsed?.pathname || "").toLowerCase();
  if (host === "youtu.be") return "youtube_watch";
  if (pathName.startsWith("/shorts/")) return "youtube_short";
  if (pathName.startsWith("/embed/")) return "youtube_embed";
  if (pathName === "/watch" || parsed.searchParams.has("v")) return "youtube_watch";
  return "youtube_page";
}

function classifyMediaSourceUrl(value) {
  const rawText = String(value || "").trim();
  const looksLikeLocalPath =
    rawText &&
    (path.isAbsolute(rawText) ||
      path.win32.isAbsolute(rawText) ||
      !/^[a-z][a-z0-9+.-]*:/i.test(rawText));
  if (looksLikeLocalPath) {
    if (DIRECT_VIDEO_EXT_RE.test(rawText)) {
      return {
        source_url_kind: "local_video_file",
        segment_validation_eligible: true,
        segment_validation_ineligible_reason: null,
      };
    }
  }

  const parsed = parseUrl(value);
  if (!parsed) {
    return {
      source_url_kind: "invalid_or_missing",
      segment_validation_eligible: false,
      segment_validation_ineligible_reason: "segment_source_url_invalid",
    };
  }

  const href = parsed.href;
  const host = hostWithoutWww(parsed);
  if (isYouTubeHost(host)) {
    return {
      source_url_kind: youtubeKind(parsed),
      segment_validation_eligible: false,
      segment_validation_ineligible_reason: "segment_source_is_youtube_reference",
    };
  }

  if (HLS_MANIFEST_EXT_RE.test(href)) {
    return {
      source_url_kind: "hls_manifest",
      segment_validation_eligible: true,
      segment_validation_ineligible_reason: null,
    };
  }
  if (DASH_MANIFEST_EXT_RE.test(href)) {
    return {
      source_url_kind: "dash_manifest",
      segment_validation_eligible: true,
      segment_validation_ineligible_reason: null,
    };
  }
  if (DIRECT_VIDEO_EXT_RE.test(href)) {
    return {
      source_url_kind: "direct_video",
      segment_validation_eligible: true,
      segment_validation_ineligible_reason: null,
    };
  }
  if (IMAGE_EXT_RE.test(href)) {
    return {
      source_url_kind: "image",
      segment_validation_eligible: false,
      segment_validation_ineligible_reason: "segment_source_is_image_reference",
    };
  }

  return {
    source_url_kind: "html_or_unknown_page",
    segment_validation_eligible: false,
    segment_validation_ineligible_reason: "segment_source_url_not_direct_media",
  };
}

function mediaSourceUrlKindFields(value) {
  const classification = classifyMediaSourceUrl(value);
  return {
    source_url_kind: classification.source_url_kind,
    segment_validation_eligible: classification.segment_validation_eligible,
    segment_validation_ineligible_reason: classification.segment_validation_ineligible_reason,
  };
}

module.exports = {
  classifyMediaSourceUrl,
  mediaSourceUrlKindFields,
};
