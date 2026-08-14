"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

function clean(value) {
  return String(value ?? "").trim();
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function slash(value) {
  return value.split(path.sep).join("/");
}

async function readRegularJson(file, label) {
  const requested = path.resolve(file);
  const stat = await fs.lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  const realPath = await fs.realpath(requested);
  let document;
  try {
    document = JSON.parse(await fs.readFile(realPath, "utf8"));
  } catch {
    throw new Error(`${label}_must_be_valid_json`);
  }
  return { document, realPath };
}

async function inspectRegularFile(file, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  const bytes = await fs.readFile(file);
  return {
    bytes,
    size: stat.size,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function srtTranscript(bytes) {
  const raw = bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!raw) throw new Error("captions_srt_empty");
  const parts = [];
  for (const block of raw.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timeline = lines.findIndex((line) => line.includes("-->"));
    if (timeline < 0 || !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}$/.test(lines[timeline])) {
      throw new Error("captions_srt_invalid");
    }
    const text = lines.slice(timeline + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("captions_srt_invalid");
    parts.push(text);
  }
  return parts.join(" ");
}

async function materialiseSystemTraceYouTubePackage(input = {}) {
  const packageRoot = await fs.realpath(path.resolve(input.packageRoot));
  const manifestInput = await readRegularJson(input.manifestPath, "buffer_manifest");
  const storyId = clean(input.storyId);
  const manifest = manifestInput.document;
  const episode = manifest?.episodes?.find((candidate) => candidate?.story_id === storyId);
  if (
    manifest?.schema_version !== 1 ||
    manifest?.schema !== "pulse_system_trace_youtube_buffer_v1" ||
    !episode ||
    !clean(manifest?.channel?.id)
  ) throw new Error("system_trace_buffer_manifest_story_invalid");
  const repoRoot = path.dirname(path.dirname(manifestInput.realPath));
  if (!samePath(packageRoot, path.resolve(repoRoot, episode.project_dir))) {
    throw new Error("package_root_manifest_mismatch");
  }
  if (!clean(episode.title) || !clean(episode.description) || !Array.isArray(episode.tags) || !episode.tags.length) {
    throw new Error("episode_metadata_incomplete");
  }
  const publishAtMs = Date.parse(episode.publish_at_utc);
  if (!Number.isFinite(publishAtMs) || !clean(episode.publish_at_utc).endsWith("Z")) {
    throw new Error("episode_publish_at_invalid");
  }

  const videoRelative = slash(path.join("renders", `${storyId}.mp4`));
  const captionsRelative = "captions.srt";
  const video = await inspectRegularFile(path.join(packageRoot, videoRelative), "final_video");
  const captions = await inspectRegularFile(path.join(packageRoot, captionsRelative), "captions");
  const narrationScript = srtTranscript(captions.bytes);

  const request = {
    schema_version: 1,
    closed: true,
    authority_scope: "EXACT_PRIVATE_FIRST_SCHEDULE_REQUEST_SHAPE_ONLY",
    publish_authority: "EXTERNALLY_EVALUATED",
    video_file: videoRelative,
    video_sha256: video.sha256,
    notifySubscribers: false,
    snippet: {
      title: episode.title,
      description: episode.description,
      tags: [...episode.tags],
      categoryId: "20",
      defaultLanguage: "en-GB",
      defaultAudioLanguage: "en-GB",
    },
    status: {
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      license: "youtube",
      embeddable: true,
      publicStatsViewable: true,
    },
    paidProductPlacementDetails: { hasPaidProductPlacement: false },
    captions: {
      file: captionsRelative,
      sha256: captions.sha256,
      language: "en-GB",
      name: "English (United Kingdom)",
      isDraft: false,
    },
    cover_selection: {
      selection_mode: "in_video_frame",
      frame_time_seconds: 1.5,
      custom_thumbnail_upload_allowed: false,
      application_status: "NOT_APPLIED",
    },
  };

  const publishPack = {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_publish_pack_v1",
    story_id: storyId,
    project_id: storyId,
    platform: "youtube_shorts",
    review_scope: "PRIVATE_FIRST_SCHEDULED_PUBLICATION",
    title: episode.title,
    description: episode.description,
    tags: [...episode.tags],
    captions: {
      file: captionsRelative,
      sha256: captions.sha256,
      clean_manual_captions_required: true,
    },
    synthetic_media_required: true,
    altered_synthetic_disclosure_required: true,
    altered_synthetic_disclosure_setting: "YES",
    public_publish_authorised: true,
    unlisted_publish_authorised: false,
    scheduler_authorised: true,
    database_mutation_authorised: false,
    playlist_mutation_authorised: false,
    thumbnail_upload_authorised: false,
    rights_status: "ORIGINAL_VISUALS_AND_GOVERNED_AUDIO",
    rights_placement_verdict: "GREEN",
    rights_placement_blocker_count: 0,
    rights_clearance_claimed: false,
    scheduled_publish_at_utc: new Date(publishAtMs).toISOString(),
    youtube_upload_request: request,
  };

  const canonicalManifest = {
    schema_version: 1,
    schema: "pulse_system_trace_canonical_story_manifest_v1",
    story_id: storyId,
    project_id: storyId,
    narration_script: narrationScript,
    final_container: {
      path: videoRelative,
      sha256: video.sha256,
      bytes: video.size,
    },
    captions: {
      path: captionsRelative,
      sha256: captions.sha256,
      bytes: captions.size,
    },
    destination: {
      platform: "youtube_shorts",
      channel_id: manifest.channel.id,
      publish_at_utc: new Date(publishAtMs).toISOString(),
    },
    rights_status: "ORIGINAL_VISUALS_AND_GOVERNED_AUDIO",
    rights_placement_verdict: "GREEN",
    publish_authorised: true,
  };

  const canonicalPath = path.join(packageRoot, "canonical_story_manifest.json");
  const packPath = path.join(packageRoot, "youtube_publish_pack.json");
  if (await fs.pathExists(canonicalPath) || await fs.pathExists(packPath)) {
    throw new Error("governed_package_artefact_must_not_exist");
  }
  await fs.writeFile(canonicalPath, `${JSON.stringify(canonicalManifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await fs.writeFile(packPath, `${JSON.stringify(publishPack, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  return {
    publishPack,
    canonicalManifest,
    artefacts: {
      publish_pack_path: packPath,
      canonical_manifest_path: canonicalPath,
    },
  };
}

module.exports = { materialiseSystemTraceYouTubePackage };
