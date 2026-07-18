"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");

const {
  materializeSourceIdentitySidecar,
} = require("./source-identity-sidecar-materializer");

const DEFAULT_START_SECONDS = 5;
const DEFAULT_END_SECONDS = 75;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalise(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeSlug(value) {
  return normalise(value)
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "official_motion";
}

function youtubeVideoId(entry = {}) {
  const direct = clean(entry.youtube_video_id);
  if (/^[A-Za-z0-9_-]{6,20}$/.test(direct)) return direct;
  const sourceUrl = clean(
    entry.official_source_url || entry.reference_url || entry.source_url,
  );
  return clean(sourceUrl.match(/[?&]v=([A-Za-z0-9_-]{6,20})/)?.[1]);
}

function officialChannelUrl(entry = {}) {
  return clean(
    entry.official_channel_url ||
      entry.provenance?.official_channel ||
      entry.channel_url,
  ).replace(/\/+$/, "");
}

function sourceReferenceUrl(entry = {}) {
  const videoId = youtubeVideoId(entry);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function defaultDownloadVideo({
  outputPath,
  referenceUrl,
  startSeconds = DEFAULT_START_SECONDS,
  endSeconds = DEFAULT_END_SECONDS,
  ytDlpPath = process.env.YTDLP_PATH || "C:/yt-dlp/yt-dlp.exe",
  timeoutMs = 180000,
} = {}) {
  await fs.ensureDir(path.dirname(outputPath));
  await fs.remove(outputPath);
  await execFilePromise(
    path.resolve(ytDlpPath),
    [
      "--no-warnings",
      "--no-playlist",
      "--download-sections",
      `*${startSeconds}-${endSeconds}`,
      "--force-keyframes-at-cuts",
      "--merge-output-format",
      "mp4",
      "--format",
      "bv*[height<=1080]+ba/b[height<=1080]",
      "--output",
      outputPath,
      referenceUrl,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: Math.max(30000, Number(timeoutMs) || 180000),
      windowsHide: true,
    },
  );
  if (!(await fs.pathExists(outputPath))) {
    throw new Error("downloaded_motion_master_missing");
  }
  const stat = await fs.stat(outputPath);
  return {
    output_path: outputPath,
    bytes_written: stat.size,
  };
}

async function defaultFetchOembed(referenceUrl, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const url =
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(referenceUrl)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "PulseGamingOfficialMotionIdentity/1.0",
      },
    });
    if (!response.ok) throw new Error(`oembed_http_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultProbeVideo(
  filePath,
  { ffprobePath = process.env.FFPROBE_PATH || "ffprobe", timeoutMs = 30000 } = {},
) {
  const { stdout } = await execFilePromise(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: Math.max(5000, Number(timeoutMs) || 30000),
      windowsHide: true,
    },
  );
  const payload = JSON.parse(stdout);
  const video = (payload.streams || []).find(
    (stream) => stream.codec_type === "video",
  );
  const duration = Number(payload.format?.duration);
  return {
    decodable: Boolean(video && Number.isFinite(duration) && duration > 0),
    duration_s: duration,
    width: Number(video?.width) || null,
    height: Number(video?.height) || null,
    video_codec: clean(video?.codec_name) || null,
  };
}

function validateMetadataEntry(entry = {}) {
  const blockers = [];
  const videoId = youtubeVideoId(entry);
  const referenceUrl = sourceReferenceUrl(entry);
  const channelUrl = officialChannelUrl(entry);
  const entity = clean(entry.entity);
  const owner = clean(entry.source_owner);
  if (entry.source_verified !== true) blockers.push("source_not_verified");
  if (entry.downloads_allowed !== true) {
    blockers.push("official_youtube_download_not_operator_approved");
  }
  if (clean(entry.source_type) !== "official_youtube_channel_url") {
    blockers.push("source_type_not_official_youtube_channel_url");
  }
  if (!videoId || !referenceUrl) blockers.push("youtube_video_id_invalid");
  if (!/^https:\/\/(?:www\.)?youtube\.com\/@[^/]+$/i.test(channelUrl)) {
    blockers.push("official_channel_handle_invalid");
  }
  if (!entity) blockers.push("story_entity_missing");
  if (!owner) blockers.push("source_owner_missing");
  if (!clean(entry.source_title) || !normalise(entry.source_title).includes(normalise(entity))) {
    blockers.push("official_video_title_entity_mismatch");
  }
  return {
    blockers,
    video_id: videoId,
    reference_url: referenceUrl,
    official_channel: channelUrl,
  };
}

async function materializeEntry(
  entry,
  {
    outputDir,
    generatedAt,
    downloadVideo,
    fetchOembed,
    probeVideo,
    startSeconds,
    endSeconds,
    timeoutMs,
    ytDlpPath,
    ffprobePath,
  },
) {
  const validation = validateMetadataEntry(entry);
  if (validation.blockers.length) {
    return {
      story_id: clean(entry.story_id),
      status: "blocked",
      blockers: validation.blockers,
      output_entry: null,
    };
  }

  const storyId = clean(entry.story_id);
  const storyDir = path.join(
    path.resolve(outputDir),
    safeSlug(storyId),
    safeSlug(entry.source_family || validation.video_id),
  );
  const masterPath = path.join(storyDir, `${validation.video_id}.mp4`);
  const oembedPath = path.join(storyDir, `${validation.video_id}.oembed.json`);
  await fs.ensureDir(storyDir);

  try {
    const download = await downloadVideo({
      outputPath: masterPath,
      referenceUrl: validation.reference_url,
      videoId: validation.video_id,
      startSeconds,
      endSeconds,
      timeoutMs,
      ytDlpPath,
    });
    if (!(await fs.pathExists(masterPath))) {
      throw new Error("downloaded_motion_master_missing");
    }
    const oembed = await fetchOembed(validation.reference_url, { timeoutMs });
    if (
      normalise(oembed?.author_name) !== normalise(entry.source_owner) ||
      clean(oembed?.author_url).replace(/\/+$/, "") !== validation.official_channel
    ) {
      throw new Error("oembed_channel_identity_mismatch");
    }
    await fs.writeJson(oembedPath, oembed, { spaces: 2 });
    const probe = await probeVideo(masterPath, { ffprobePath, timeoutMs });
    const duration = Number(probe?.duration_s);
    if (
      probe?.decodable !== true ||
      !Number.isFinite(duration) ||
      duration < 20 ||
      duration > endSeconds - startSeconds + 3
    ) {
      throw new Error("downloaded_motion_master_probe_failed");
    }
    const identity = await materializeSourceIdentitySidecar({
      masterPath,
      youtubeVideoId: validation.video_id,
      oembedPath,
      verifiedAt: generatedAt,
    });
    const masterBytes = await fs.readFile(masterPath);
    const sourceSha256 = sha256Bytes(masterBytes);
    if (identity.source_master_sha256 !== sourceSha256) {
      throw new Error("source_identity_master_hash_mismatch");
    }
    return {
      story_id: storyId,
      status: "accepted",
      blockers: [],
      download,
      probe,
      output_entry: {
        ...entry,
        official_source_url: validation.reference_url,
        official_channel_url: validation.official_channel,
        youtube_video_id: validation.video_id,
        source_verified: true,
        local_operator_file_path: masterPath,
        direct_media_url_if_available: masterPath,
        source_url_kind: "local_video_file",
        segment_validation_eligible: true,
        downloads_allowed: true,
        autonomous_use_approved: false,
        licence_basis: "official_channel_identity_local_proof_only",
        allowed_render_use: "local_proof_only",
        allowed_platforms: [],
        commercial_use_allowed: false,
        credit_required: true,
        evidence_reference: identity.sidecar_path,
        rights_risk_class: "identity_verified_rights_unresolved",
        approval_status: "operator_rights_review_required",
        rights_status: "local_proof_only",
        rights_verdict: "RED",
        rights_grant: false,
        source_duration_s: duration,
        provenance: {
          ...(entry.provenance || {}),
          source: "official_youtube_channel_download",
          official_channel: validation.official_channel,
          reference_url: validation.reference_url,
          youtube_video_id: validation.video_id,
          source_sha256: sourceSha256,
          source_identity_path: identity.sidecar_path,
          source_identity_sha256: identity.sidecar_sha256,
          source_identity_scope: "identity_only_not_rights_grant",
          downloaded_section: {
            start_seconds: startSeconds,
            end_seconds: endSeconds,
          },
        },
      },
    };
  } catch (error) {
    return {
      story_id: storyId,
      status: "blocked",
      blockers: [clean(error?.code || error?.message || "materialization_failed")],
      output_entry: null,
    };
  }
}

async function materializeOfficialYoutubeMotionReferences({
  entries = [],
  outputDir,
  generatedAt = new Date().toISOString(),
  downloadVideo = defaultDownloadVideo,
  fetchOembed = defaultFetchOembed,
  probeVideo = defaultProbeVideo,
  startSeconds = DEFAULT_START_SECONDS,
  endSeconds = DEFAULT_END_SECONDS,
  timeoutMs = 180000,
  ytDlpPath = null,
  ffprobePath = null,
} = {}) {
  if (!outputDir) throw new Error("outputDir is required");
  const rows = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    rows.push(
      await materializeEntry(entry, {
        outputDir,
        generatedAt,
        downloadVideo,
        fetchOembed,
        probeVideo,
        startSeconds,
        endSeconds,
        timeoutMs,
        ytDlpPath: clean(ytDlpPath) || undefined,
        ffprobePath: clean(ffprobePath) || undefined,
      }),
    );
  }
  const acceptedEntries = rows
    .map((row) => row.output_entry)
    .filter(Boolean);
  const blocked = rows.filter((row) => row.status === "blocked").length;
  return {
    schema_version: 1,
    generated_at: new Date(generatedAt).toISOString(),
    execution_mode: "official_youtube_motion_materialization",
    verdict: acceptedEntries.length > 0 && blocked === 0 ? "AMBER" : "RED",
    materialization_verdict:
      acceptedEntries.length > 0 && blocked === 0 ? "PASS" : "FAIL",
    publish_readiness: "RED",
    can_auto_publish: false,
    summary: {
      requested: Array.isArray(entries) ? entries.length : 0,
      accepted: acceptedEntries.length,
      blocked,
    },
    safety: {
      local_media_materialized: acceptedEntries.length,
      bounded_downloads_only: true,
      production_db_mutated: false,
      oauth_or_tokens_mutated: false,
      social_posting_triggered: false,
      rights_grants_created: 0,
      local_proof_only: true,
    },
    rows,
    output_template: {
      schema_version: 1,
      generated_at: new Date(generatedAt).toISOString(),
      entries: acceptedEntries,
    },
  };
}

module.exports = {
  DEFAULT_END_SECONDS,
  DEFAULT_START_SECONDS,
  defaultDownloadVideo,
  defaultFetchOembed,
  defaultProbeVideo,
  materializeOfficialYoutubeMotionReferences,
  validateMetadataEntry,
};
