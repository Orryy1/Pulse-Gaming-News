"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildLandingPageAttribution,
} = require("./commercial-intelligence-engine");

const PLATFORM_PACK_FILES = [
  "youtube_publish_pack.json",
  "tiktok_publish_pack.json",
  "instagram_publish_pack.json",
  "facebook_publish_pack.json",
  "x_publish_pack.json",
  "threads_publish_pack.json",
  "pinterest_publish_pack.json",
  "platform_variant_scorecard.json",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value, fallback = "story") {
  const slug = cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function isPlaceholderSlug(value = "") {
  const slug = slugify(cleanText(value).replace(/^\/?p\//i, ""));
  return /^this-story(?:-|$)/.test(slug) || /^story(?:-|$)/.test(slug) || /^placeholder(?:-|$)/.test(slug);
}

function safeTimestamp(value = new Date().toISOString()) {
  return String(value).replace(/[:.]/g, "-");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function routeFrom({ canonical = {}, landing = {}, affiliate = {}, storyId = "story" } = {}) {
  const explicit =
    affiliate.landing_page_route ||
    landing.landing_page_route ||
    landing.route ||
    asArray(landing.routes)[0];
  if (explicit && !isPlaceholderSlug(explicit)) return cleanText(explicit);
  return `/p/${slugify(canonical.selected_title || canonical.canonical_subject || storyId, storyId)}`;
}

function slugFromRoute(route = "", fallback = "story") {
  return slugify(cleanText(route).replace(/^\/p\//, ""), fallback);
}

function storyFromCanonical(canonical = {}, storyId = "story") {
  return {
    id: storyId,
    title: canonical.selected_title || canonical.canonical_title || canonical.title || canonical.canonical_subject || storyId,
    canonical_subject: canonical.canonical_subject || null,
    canonical_game: canonical.canonical_game || canonical.canonical_subject || null,
    full_script: canonical.narration_script || canonical.first_spoken_line || "",
    youtube_post_id: canonical.youtube_post_id || canonical.youtube_id || null,
  };
}

function targetAttribution({ storyId, canonical, landing, affiliate }) {
  const route = routeFrom({ canonical, landing, affiliate, storyId });
  const explicitSlug = affiliate.landing_page_slug || landing.landing_page_slug || landing.slug;
  const slug = explicitSlug && !isPlaceholderSlug(explicitSlug)
    ? slugify(explicitSlug, storyId)
    : slugFromRoute(route, storyId);
  return buildLandingPageAttribution({
    story: storyFromCanonical(canonical, storyId),
    storyId,
    slug,
    route,
    primaryLink: affiliate.primary_link || null,
    disclosureRequired: Boolean(affiliate.disclosure_required || affiliate.primary_link),
    disclosureCopy: affiliate.disclosure_copy || {
      short: affiliate.disclosure_required ? "Affiliate links may earn us a commission." : null,
    },
  });
}

function objectContainsPlaceholderLandingRoute(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (/\/p\/(?:this-story|story|placeholder)(?:-|$)/i.test(current)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (current && typeof current === "object") {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return false;
}

function objectContainsInvalidOfferTrackingUrl(value) {
  if (!value || typeof value !== "object") return false;
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (/\/go\/\/undefined\b|\/go\/[^/?#]+\/undefined\b/i.test(current)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (current && typeof current === "object") {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return false;
}

function collectPlaceholderLandingTokens(...objects) {
  const tokens = new Set();
  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      const routeMatches = value.match(/\/p\/(?:this-story|story|placeholder)[a-z0-9-]*/gi) || [];
      for (const route of routeMatches) {
        tokens.add(route);
        tokens.add(route.replace(/^\/p\//i, ""));
      }
      if (isPlaceholderSlug(value)) {
        const slug = slugify(value.replace(/^\/?p\//i, ""));
        tokens.add(slug);
        tokens.add(`/p/${slug}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const object of objects) visit(object);
  return Array.from(tokens).filter(Boolean).sort((a, b) => b.length - a.length);
}

function replaceLandingTokens(value, placeholderTokens = [], attribution = {}) {
  if (!placeholderTokens.length) return value;
  if (typeof value === "string") {
    let text = value;
    for (const token of placeholderTokens) {
      const replacement = token.startsWith("/p/")
        ? attribution.landing_page_route
        : attribution.landing_page_slug;
      text = text.split(token).join(replacement);
    }
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceLandingTokens(item, placeholderTokens, attribution));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceLandingTokens(item, placeholderTokens, attribution),
      ]),
    );
  }
  return value;
}

async function inspectArtifact(storyPackage = {}, { generatedAt = new Date().toISOString() } = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
  const storyId = storyPackage.story_id || storyPackage.id || "unknown";
  const blockers = [];
  if (!artifactDir) blockers.push("missing_artifact_dir");
  if (artifactDir && !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");

  const canonical = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"))
    : {};
  const affiliate = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"))
    : {};
  const landing = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"))
    : {};
  const platform = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"))
    : {};

  if (!Object.keys(canonical).length) blockers.push("canonical_manifest_missing");
  if (!Object.keys(landing).length) blockers.push("landing_page_manifest_missing");
  if (!Object.keys(platform).length) blockers.push("platform_manifest_missing");

  const target = targetAttribution({ storyId, canonical, landing, affiliate });
  const current = landing.attribution_manifest || affiliate.landing_page_attribution || platform.landing_page_attribution || null;
  const needsRepair =
    !current ||
    current.verdict !== "pass" ||
    Object.keys(current.platforms || {}).length < 7 ||
    platform.landing_page_attribution?.verdict !== "pass" ||
    isPlaceholderSlug(landing.landing_page_slug || landing.landing_page_route || landing.route || "") ||
    isPlaceholderSlug(affiliate.landing_page_slug || affiliate.landing_page_route || "") ||
    objectContainsPlaceholderLandingRoute(platform) ||
    objectContainsInvalidOfferTrackingUrl(affiliate) ||
    objectContainsInvalidOfferTrackingUrl(landing) ||
    objectContainsInvalidOfferTrackingUrl(platform);

  return {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    status: blockers.length ? "blocked" : needsRepair ? "repairable" : "already_attributed",
    blockers,
    current_attribution_verdict: current?.verdict || "missing",
    target_attribution_verdict: target.verdict,
    target_attribution: target,
    generated_at: generatedAt,
  };
}

async function backupIfPresent(filePath, backupDir) {
  if (!(await fs.pathExists(filePath))) return null;
  await fs.ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(filePath));
  await fs.copy(filePath, backupPath, { overwrite: true });
  return backupPath;
}

async function applyRepair(item = {}, { generatedAt = new Date().toISOString(), backupRoot = "" } = {}) {
  const artifactDir = item.artifact_dir;
  const backupDir = backupRoot
    ? path.join(path.resolve(backupRoot), item.story_id)
    : path.join(artifactDir, ".landing-attribution-backup", safeTimestamp(generatedAt));
  const affiliatePath = path.join(artifactDir, "affiliate_link_manifest.json");
  const landingPath = path.join(artifactDir, "landing_page_manifest.json");
  const platformPath = path.join(artifactDir, "platform_publish_manifest.json");
  const affiliate = await readJsonIfPresent(affiliatePath);
  const landing = await readJsonIfPresent(landingPath);
  const platform = await readJsonIfPresent(platformPath);
  const attribution = item.target_attribution;
  const platformPackPaths = PLATFORM_PACK_FILES.map((fileName) => path.join(artifactDir, fileName));
  const platformPacks = {};
  for (const packPath of platformPackPaths) {
    if (await fs.pathExists(packPath)) {
      platformPacks[packPath] = await readJsonIfPresent(packPath);
    }
  }
  const placeholderTokens = collectPlaceholderLandingTokens(affiliate, landing, platform, ...Object.values(platformPacks));
  const repairedAffiliate = replaceLandingTokens(affiliate, placeholderTokens, attribution);
  const repairedLanding = replaceLandingTokens(landing, placeholderTokens, attribution);
  const repairedPlatform = replaceLandingTokens(platform, placeholderTokens, attribution);
  const backupFiles = {
    affiliate_link_manifest: await backupIfPresent(affiliatePath, backupDir),
    landing_page_manifest: await backupIfPresent(landingPath, backupDir),
    platform_publish_manifest: await backupIfPresent(platformPath, backupDir),
  };
  const repairedPackPaths = [];
  for (const packPath of Object.keys(platformPacks)) {
    await backupIfPresent(packPath, backupDir);
    await fs.writeJson(packPath, replaceLandingTokens(platformPacks[packPath], placeholderTokens, attribution), { spaces: 2 });
    repairedPackPaths.push(packPath);
  }

  await fs.writeJson(affiliatePath, {
    ...repairedAffiliate,
    landing_page_slug: attribution.landing_page_slug,
    landing_page_route: attribution.landing_page_route,
    landing_page_attribution: attribution,
    attribution_repaired_at: generatedAt,
  }, { spaces: 2 });

  await fs.writeJson(landingPath, {
    ...repairedLanding,
    story_id: item.story_id,
    landing_page_slug: attribution.landing_page_slug,
    landing_page_route: attribution.landing_page_route,
    attribution_manifest: attribution,
    link_pack: {
      ...(repairedLanding.link_pack || {}),
      primary_link: repairedAffiliate.primary_link || null,
      fallback_links: asArray(repairedAffiliate.fallback_links),
      source_links: asArray(repairedAffiliate.source_links),
      affiliate_tracking_map: repairedAffiliate.affiliate_tracking_map || null,
    },
    disclosure_block: {
      ...(repairedLanding.disclosure_block || {}),
      required: Boolean(repairedAffiliate.disclosure_required),
      copy: repairedAffiliate.disclosure_copy || null,
      source_first: true,
    },
    attribution_repaired_at: generatedAt,
    safety: {
      ...(landing.safety || {}),
      story_page_before_offer: true,
      no_direct_social_posting: true,
    },
  }, { spaces: 2 });

  await fs.writeJson(platformPath, {
    ...repairedPlatform,
    landing_page_attribution: attribution,
    landing_page_attribution_repaired_at: generatedAt,
    no_publish_triggered: true,
  }, { spaces: 2 });

  return {
    story_id: item.story_id,
    artifact_dir: artifactDir,
    backup_dir: backupDir,
    backup_files: backupFiles,
    repaired_files: [affiliatePath, landingPath, platformPath, ...repairedPackPaths],
  };
}

async function repairGoalLandingAttribution({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  apply = false,
  backupRoot = "",
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectArtifact(storyPackage, { generatedAt }));
  }
  const repairable = inspected.filter((item) => item.status === "repairable");
  const repairs = [];
  if (apply) {
    for (const item of repairable) {
      repairs.push(await applyRepair(item, { generatedAt, backupRoot }));
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "APPLY_LANDING_ATTRIBUTION_REPAIR" : "DRY_RUN_LANDING_ATTRIBUTION_REPAIR",
    summary: {
      story_count: inspected.length,
      repairable_count: repairable.length,
      repaired_count: repairs.length,
      already_attributed_count: inspected.filter((item) => item.status === "already_attributed").length,
      blocked_count: inspected.filter((item) => item.status === "blocked").length,
    },
    items: inspected.map((item) => ({
      story_id: item.story_id,
      artifact_dir: item.artifact_dir,
      status: item.status,
      blockers: item.blockers,
      current_attribution_verdict: item.current_attribution_verdict,
      target_attribution_verdict: item.target_attribution_verdict,
    })),
    repairs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      local_artifact_files_only: true,
    },
  };
}

module.exports = {
  repairGoalLandingAttribution,
};
