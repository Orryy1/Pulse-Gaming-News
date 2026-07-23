"use strict";

const crypto = require("node:crypto");
const nativeFs = require("node:fs");
const path = require("node:path");
const fs = require("fs-extra");
const sharp = require("sharp");

const SHORTS_COVER_DURATION_S = 0.6;
const SHORTS_COVER_SELECTION_AT_S = 0.15;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseCoverHeadline(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = nativeFs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function campaignManifestCandidates({
  artifactDir,
  workspaceRoot,
  storyId,
  explicitManifestPath,
} = {}) {
  const candidates = [];
  if (cleanText(explicitManifestPath)) {
    candidates.push(path.resolve(workspaceRoot, explicitManifestPath));
  }
  candidates.push(
    path.join(artifactDir, "premium_visual_campaign", "premium_visual_campaign_manifest.json"),
    path.join(artifactDir, "premium_visual_campaign_manifest.json"),
  );
  if (cleanText(storyId)) {
    candidates.push(
      path.join(workspaceRoot, "output", "stories", storyId, "premium_visual_campaign_manifest.json"),
    );
  }
  return unique(candidates.map((candidate) => path.resolve(candidate)));
}

async function firstExistingPath(candidates = []) {
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  return "";
}

function unavailableResult(blocker = "youtube_shorts_cover_campaign_missing") {
  return {
    schema_version: 1,
    status: "unavailable",
    blockers: [blocker],
    youtube_custom_image_thumbnail_supported: false,
    youtube_mobile_frame_selection_required: true,
  };
}

async function resolveYouTubeShortsCoverFrame({
  artifactDir,
  workspaceRoot = process.cwd(),
  storyId,
  expectedHeadline = "",
  explicitManifestPath = "",
} = {}) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot || process.cwd());
  const resolvedArtifactDir = path.resolve(artifactDir || "");
  if (!artifactDir || !(await fs.pathExists(resolvedArtifactDir))) {
    return unavailableResult("youtube_shorts_cover_artifact_dir_missing");
  }
  const manifestPath = await firstExistingPath(campaignManifestCandidates({
    artifactDir: resolvedArtifactDir,
    workspaceRoot: resolvedWorkspaceRoot,
    storyId,
    explicitManifestPath,
  }));
  if (!manifestPath) return unavailableResult();

  const blockers = [];
  if (!isWithin(resolvedWorkspaceRoot, manifestPath)) {
    blockers.push("youtube_shorts_cover_manifest_outside_workspace");
  }
  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch {
    return {
      ...unavailableResult("youtube_shorts_cover_campaign_unreadable"),
      status: "blocked",
      campaign_manifest_path: manifestPath,
    };
  }

  const output = manifest.outputs?.youtube_shorts_cover || {};
  const rawCoverPath = cleanText(output.static_path || output.path || output.cover_frame_path);
  const coverPath = rawCoverPath
    ? path.isAbsolute(rawCoverPath)
      ? path.resolve(rawCoverPath)
      : path.resolve(path.dirname(manifestPath), rawCoverPath)
    : "";
  if (cleanText(manifest.verdict).toLowerCase() !== "green") {
    blockers.push("youtube_shorts_cover_campaign_not_green");
  }
  if (cleanText(manifest.story_id) !== cleanText(storyId)) {
    blockers.push("youtube_shorts_cover_story_id_mismatch");
  }
  const expected = normaliseCoverHeadline(expectedHeadline);
  const actual = normaliseCoverHeadline(output.headline || manifest.headline);
  if (expected && expected !== actual) blockers.push("youtube_shorts_cover_headline_stale");
  if (!coverPath || !(await fs.pathExists(coverPath))) {
    blockers.push("youtube_shorts_cover_file_missing");
  } else if (!isWithin(resolvedWorkspaceRoot, coverPath)) {
    blockers.push("youtube_shorts_cover_file_outside_workspace");
  }
  if (
    manifest.provenance?.derived_asset_only !== true ||
    !/^[a-f0-9]{64}$/i.test(cleanText(manifest.provenance?.hero_sha256))
  ) {
    blockers.push("youtube_shorts_cover_parent_visual_provenance_missing");
  }

  let metadata = {};
  if (coverPath && (await fs.pathExists(coverPath))) {
    try {
      metadata = await sharp(coverPath).metadata();
    } catch {
      blockers.push("youtube_shorts_cover_file_unreadable");
    }
  }
  const width = Number(metadata.width || output.width);
  const height = Number(metadata.height || output.height);
  if (
    Number(output.width) !== 1080 ||
    Number(output.height) !== 1920 ||
    width !== 1080 ||
    height !== 1920
  ) {
    blockers.push("youtube_shorts_cover_dimensions_invalid");
  }

  const campaignManifestSha256 = await fileSha256(manifestPath);
  const coverPresent = coverPath && (await fs.pathExists(coverPath));
  const coverFrameSha256 = coverPresent ? await fileSha256(coverPath) : null;
  const coverStat = coverPresent ? await fs.stat(coverPath) : null;
  const uniqueBlockers = unique(blockers);
  return {
    schema_version: 1,
    status: uniqueBlockers.length ? "blocked" : "ready",
    story_id: cleanText(storyId) || null,
    headline: cleanText(output.headline || manifest.headline) || null,
    source_asset: "premium_visual_campaign.youtube_shorts_cover",
    campaign_manifest_path: manifestPath,
    campaign_manifest_sha256: campaignManifestSha256,
    cover_frame_path: coverPath || null,
    cover_frame_sha256: coverFrameSha256,
    cover_frame_size_bytes: coverStat?.isFile() ? coverStat.size : null,
    parent_visual_sha256: cleanText(manifest.provenance?.hero_sha256) || null,
    parent_visual_rights_required: true,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    embed_start_s: 0,
    embed_duration_s: SHORTS_COVER_DURATION_S,
    fade_out_start_s: Number((SHORTS_COVER_DURATION_S - 0.15).toFixed(3)),
    fade_out_duration_s: 0.15,
    mobile_selection_at_s: SHORTS_COVER_SELECTION_AT_S,
    youtube_custom_image_thumbnail_supported: false,
    youtube_mobile_frame_selection_required: true,
    youtube_studio_frame_selection_supported: false,
    blockers: uniqueBlockers,
  };
}

module.exports = {
  SHORTS_COVER_DURATION_S,
  SHORTS_COVER_SELECTION_AT_S,
  campaignManifestCandidates,
  normaliseCoverHeadline,
  resolveYouTubeShortsCoverFrame,
};
