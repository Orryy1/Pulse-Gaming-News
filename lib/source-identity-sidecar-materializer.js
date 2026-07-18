"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("fs-extra");

const SCHEMA = "pulse_motion_source_identity_sidecar_v1";
const PRODUCER = "pulse_source_identity_oembed_verifier_v1";
const STEAM_PRODUCER = "pulse_official_platform_source_verifier_v1";

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function clean(value) {
  return String(value || "").trim();
}

function steamAppIdFromUrl(value, { requireProductPage = false } = {}) {
  try {
    const parsed = new URL(clean(value));
    if (parsed.protocol !== "https:") return "";
    const hostname = parsed.hostname.toLowerCase();
    if (requireProductPage) {
      if (hostname !== "store.steampowered.com") return "";
      return clean(parsed.pathname.match(/^\/app\/(\d+)(?:\/|$)/i)?.[1]);
    }
    if (!hostname.endsWith("steamstatic.com")) return "";
    return clean(parsed.pathname.match(/\/(?:apps|store_trailers)\/(\d+)(?:\/|$)/i)?.[1]);
  } catch {
    return "";
  }
}

async function writeSidecar(masterPath, sidecar) {
  const parsed = path.parse(masterPath);
  const sidecarPath = path.join(parsed.dir, `${parsed.name}.source-identity.json`);
  const temporaryPath = `${sidecarPath}.${process.pid}.tmp`;
  await fs.writeJson(temporaryPath, sidecar, { spaces: 2 });
  await fs.move(temporaryPath, sidecarPath, { overwrite: true });
  return {
    status: "materialized",
    sidecar_path: sidecarPath,
    sidecar_sha256: sha256Bytes(await fs.readFile(sidecarPath)),
    source_master_sha256: sidecar.source_master_sha256,
    rights_grant: false,
  };
}

async function materializeSourceIdentitySidecar({
  masterPath,
  youtubeVideoId,
  oembedPath,
  verifiedAt = new Date().toISOString(),
} = {}) {
  const resolvedMaster = path.resolve(clean(masterPath));
  const resolvedOembed = path.resolve(clean(oembedPath));
  const videoId = clean(youtubeVideoId);
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new Error("youtube_video_id_invalid");
  }
  if (!(await fs.pathExists(resolvedMaster))) throw new Error("source_master_missing");
  if (!(await fs.pathExists(resolvedOembed))) throw new Error("oembed_snapshot_missing");

  const masterBytes = await fs.readFile(resolvedMaster);
  const oembedBytes = await fs.readFile(resolvedOembed);
  const oembed = JSON.parse(oembedBytes.toString("utf8"));
  const authorName = clean(oembed.author_name);
  const authorUrl = clean(oembed.author_url);
  const title = clean(oembed.title);
  if (
    !authorName ||
    !/^https:\/\/www\.youtube\.com\/@[^/]+$/i.test(authorUrl) ||
    !title ||
    clean(oembed.provider_name).toLowerCase() !== "youtube"
  ) {
    throw new Error("oembed_identity_incomplete");
  }

  const sidecar = {
    schema: SCHEMA,
    schema_version: 1,
    producer: PRODUCER,
    canonical_source_url: `https://www.youtube.com/watch?v=${videoId}`,
    youtube_video_id: videoId,
    channel_identity: {
      author_name: authorName,
      author_url: authorUrl,
    },
    source_master_sha256: sha256Bytes(masterBytes),
    identity_scope: "source_identity_only",
    rights_grant: false,
    evidence: {
      provider: "youtube_oembed",
      verified_at: new Date(verifiedAt).toISOString(),
      title,
      oembed_snapshot_path: resolvedOembed,
      oembed_snapshot_sha256: sha256Bytes(oembedBytes),
    },
  };
  return {
    ...(await writeSidecar(resolvedMaster, sidecar)),
    oembed_snapshot_sha256: sidecar.evidence.oembed_snapshot_sha256,
  };
}

async function materializeSteamSourceIdentitySidecar({
  masterPath,
  canonicalSourceUrl,
  sourceOwner,
  sourceType,
  steamAppId,
  referenceUrl,
  verifiedAt = new Date().toISOString(),
} = {}) {
  const resolvedMaster = path.resolve(clean(masterPath));
  const sourceUrl = clean(canonicalSourceUrl);
  const owner = clean(sourceOwner);
  const type = clean(sourceType);
  const appId = clean(steamAppId);
  const productUrl = clean(referenceUrl);
  if (!(await fs.pathExists(resolvedMaster))) throw new Error("source_master_missing");
  if (!/^\d{4,12}$/.test(appId)) throw new Error("steam_app_id_invalid");
  if (steamAppIdFromUrl(sourceUrl) !== appId) throw new Error("steam_source_media_app_id_mismatch");
  if (steamAppIdFromUrl(productUrl, { requireProductPage: true }) !== appId) {
    throw new Error("steam_source_reference_app_id_mismatch");
  }
  if (!owner) throw new Error("steam_source_owner_missing");
  if (type !== "official_platform_product_page") {
    throw new Error("steam_source_type_invalid");
  }
  const masterBytes = await fs.readFile(resolvedMaster);
  const sidecar = {
    schema: SCHEMA,
    schema_version: 1,
    producer: STEAM_PRODUCER,
    platform: "steam",
    canonical_source_url: sourceUrl,
    source_master_sha256: sha256Bytes(masterBytes),
    source_owner: owner,
    source_type: type,
    identity_scope: "source_identity_only",
    rights_grant: false,
    evidence: {
      steam_app_id: appId,
      reference_url: productUrl,
      verified_at: new Date(verifiedAt).toISOString(),
    },
  };
  return writeSidecar(resolvedMaster, sidecar);
}

module.exports = {
  PRODUCER,
  SCHEMA,
  STEAM_PRODUCER,
  materializeSourceIdentitySidecar,
  materializeSteamSourceIdentitySidecar,
};
