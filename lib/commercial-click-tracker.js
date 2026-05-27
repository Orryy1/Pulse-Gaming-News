"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { normaliseAffiliateUrl } = require("./affiliate-targeting");

const DEFAULT_CLICK_LOG_PATH = path.join(process.cwd(), "data", "commercial_clicks.jsonl");
const DEFAULT_MANIFEST_DIRS = [path.join(process.cwd(), "output", "commercial")];
const PLATFORM_ALLOWLIST = new Set([
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "story_page",
  "landing",
  "unknown",
]);

function slugify(value, fallback = "story") {
  const slug = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function manifestPathFor(dir, storyId) {
  return path.join(dir, `${slugify(storyId)}_affiliate_link_manifest.json`);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function linksFromManifest(manifest = {}) {
  return [
    manifest.primary_link,
    ...(Array.isArray(manifest.fallback_links) ? manifest.fallback_links : []),
    ...(Array.isArray(manifest.candidate_links) ? manifest.candidate_links : []),
  ]
    .filter(Boolean)
    .filter((link, index, arr) => arr.findIndex((other) => other.id === link.id) === index);
}

async function findTrackedCommercialLink({
  storyId,
  offerId,
  manifestDirs = DEFAULT_MANIFEST_DIRS,
} = {}) {
  const safeStoryId = String(storyId || "").trim();
  const safeOfferId = String(offerId || "").trim();
  if (!safeStoryId || !safeOfferId) return null;

  for (const dir of manifestDirs) {
    const manifest = await readJsonIfExists(manifestPathFor(dir, safeStoryId));
    if (!manifest) continue;
    if (String(manifest.story_id || "") !== safeStoryId) continue;

    const link = linksFromManifest(manifest).find((item) => item.id === safeOfferId);
    if (!link) continue;
    const url = normaliseAffiliateUrl(link.url);
    if (!url) return null;
    return {
      manifest,
      link: { ...link, url },
    };
  }

  return null;
}

function safePlatform(value) {
  const platform = String(value || "unknown").toLowerCase().trim();
  return PLATFORM_ALLOWLIST.has(platform) ? platform : "unknown";
}

function referrerHost(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function shortHash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

async function recordCommercialClick({
  storyId,
  offerId,
  platform = "unknown",
  ctaVariant = "unknown",
  videoId = null,
  outputPath = DEFAULT_CLICK_LOG_PATH,
  now = new Date(),
  referrer = null,
  userAgent = null,
} = {}) {
  const entry = {
    event_type: "commercial_click",
    timestamp: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    story_id: String(storyId || ""),
    offer_id: String(offerId || ""),
    platform: safePlatform(platform),
    cta_variant: String(ctaVariant || "unknown").slice(0, 80),
    video_id: videoId ? String(videoId).slice(0, 120) : null,
    referrer_host: referrerHost(referrer),
    user_agent_hash: shortHash(userAgent),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.appendFile(outputPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

async function resolveCommercialRedirect({
  storyId,
  offerId,
  query = {},
  headers = {},
  manifestDirs = DEFAULT_MANIFEST_DIRS,
  clickLogPath = DEFAULT_CLICK_LOG_PATH,
  now = new Date(),
} = {}) {
  const found = await findTrackedCommercialLink({ storyId, offerId, manifestDirs });
  if (!found) {
    return {
      ok: false,
      status: 404,
      error: "commercial_link_not_found",
    };
  }

  const click = await recordCommercialClick({
    storyId,
    offerId,
    platform: query.platform,
    ctaVariant: query.cta || query.cta_variant,
    videoId: query.video_id || query.videoId || found.manifest.tracking_utm?.video_id || null,
    outputPath: clickLogPath,
    now,
    referrer: headers.referer || headers.referrer || null,
    userAgent: headers["user-agent"] || null,
  });

  return {
    ok: true,
    status: 302,
    url: found.link.url,
    click,
    manifest: found.manifest,
    link: found.link,
  };
}

module.exports = {
  DEFAULT_CLICK_LOG_PATH,
  DEFAULT_MANIFEST_DIRS,
  findTrackedCommercialLink,
  recordCommercialClick,
  resolveCommercialRedirect,
};
