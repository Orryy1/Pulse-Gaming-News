"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const DEFAULT_CLICK_LOG_PATH = path.join(process.cwd(), "data", "commercial_clicks.jsonl");
const DEFAULT_MANIFEST_DIRS = [path.join(process.cwd(), "output", "commercial")];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function increment(map, key, amount = 1) {
  const safeKey = cleanText(key) || "unknown";
  map.set(safeKey, (map.get(safeKey) || 0) + amount);
}

async function readCommercialClickLog(clickLogPath = DEFAULT_CLICK_LOG_PATH) {
  let raw = "";
  try {
    raw = await fs.readFile(clickLogPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { path: clickLogPath, entries: [], invalid_lines: 0, missing: true };
    }
    throw err;
  }

  const entries = [];
  let invalidLines = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidLines++;
      continue;
    }
    if (parsed?.event_type !== "commercial_click") continue;
    entries.push({
      event_type: "commercial_click",
      timestamp: cleanText(parsed.timestamp),
      story_id: cleanText(parsed.story_id),
      offer_id: cleanText(parsed.offer_id),
      platform: cleanText(parsed.platform || "unknown").toLowerCase(),
      cta_variant: cleanText(parsed.cta_variant || "unknown"),
      video_id: cleanText(parsed.video_id),
      referrer_host: cleanText(parsed.referrer_host),
      user_agent_hash: cleanText(parsed.user_agent_hash),
    });
  }
  return { path: clickLogPath, entries, invalid_lines: invalidLines, missing: false };
}

async function loadCommercialManifests(manifestDirs = DEFAULT_MANIFEST_DIRS) {
  const manifests = [];
  for (const dir of asArray(manifestDirs)) {
    let files = [];
    try {
      files = (await fs.readdir(dir)).filter((file) =>
        /_affiliate_link_manifest\.json$/i.test(file),
      );
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    for (const file of files) {
      try {
        manifests.push(await fs.readJson(path.join(dir, file)));
      } catch {
        // A corrupt report should not stop the learning pass.
      }
    }
  }
  return manifests;
}

function linkRowsForManifest(manifest = {}) {
  return [
    manifest.primary_link,
    ...(Array.isArray(manifest.fallback_links) ? manifest.fallback_links : []),
    ...(Array.isArray(manifest.candidate_links) ? manifest.candidate_links : []),
  ]
    .filter(Boolean)
    .filter((link, index, arr) => arr.findIndex((item) => item.id === link.id) === index);
}

function buildStoryIndex(stories = []) {
  const out = new Map();
  for (const story of asArray(stories)) {
    if (!story?.id) continue;
    out.set(String(story.id), story);
  }
  return out;
}

function buildManifestIndex(manifests = []) {
  const out = new Map();
  for (const manifest of asArray(manifests)) {
    if (!manifest?.story_id) continue;
    out.set(String(manifest.story_id), manifest);
  }
  return out;
}

function findLink(manifest, offerId) {
  return linkRowsForManifest(manifest).find((link) => link.id === offerId) || null;
}

function storyViews(story = {}) {
  const direct =
    safeNumber(story.youtube_views) ??
    safeNumber(story.views) ??
    safeNumber(story.total_views);
  if (direct !== null) return direct;
  const byPlatform =
    (safeNumber(story.youtube_stats?.views) || 0) +
    (safeNumber(story.tiktok_stats?.views) || 0) +
    (safeNumber(story.instagram_stats?.views) || 0);
  return byPlatform || null;
}

function toBreakdownObject(map) {
  const out = {};
  for (const [key, clicks] of map.entries()) out[key] = { clicks };
  return out;
}

function clickRate(clicks, views) {
  if (!views || views <= 0) return null;
  return Number((clicks / views).toFixed(6));
}

function commercialAngleLift(clicks, views) {
  if (clicks >= 3) return "positive";
  if (clicks > 0) return "early_signal";
  if (views && views >= 1000) return "weak";
  return "unknown";
}

function buildCommercialLearningDigest({
  generatedAt = new Date().toISOString(),
  clicks = [],
  manifests = [],
  stories = [],
} = {}) {
  const safeClicks = asArray(clicks).filter((click) => click?.story_id && click?.offer_id);
  const storyIndex = buildStoryIndex(stories);
  const manifestIndex = buildManifestIndex(manifests);
  const platformMap = new Map();
  const ctaMap = new Map();
  const verticalMap = new Map();
  const offerMap = new Map();
  const byStory = new Map();

  for (const click of safeClicks) {
    const manifest = manifestIndex.get(click.story_id);
    const link = findLink(manifest, click.offer_id);
    const storyBucket = byStory.get(click.story_id) || {
      story_id: click.story_id,
      clicks: 0,
      offer_clicks: new Map(),
      platforms: new Map(),
      ctas: new Map(),
      manifest,
    };
    storyBucket.clicks++;
    increment(storyBucket.offer_clicks, click.offer_id);
    increment(storyBucket.platforms, click.platform);
    increment(storyBucket.ctas, click.cta_variant);
    byStory.set(click.story_id, storyBucket);

    increment(platformMap, click.platform);
    increment(ctaMap, click.cta_variant);
    increment(verticalMap, manifest?.vertical || "unknown");
    const offerKey = click.offer_id;
    const existingOffer = offerMap.get(offerKey) || {
      offer_id: offerKey,
      label: link?.label || offerKey,
      product_category: link?.product_category || link?.category || "unknown",
      merchant: link?.merchant || null,
      story_ids: new Set(),
      clicks: 0,
    };
    existingOffer.clicks++;
    existingOffer.story_ids.add(click.story_id);
    offerMap.set(offerKey, existingOffer);
  }

  const topStories = [...byStory.values()]
    .map((bucket) => {
      const story = storyIndex.get(bucket.story_id) || {};
      const manifest = bucket.manifest || manifestIndex.get(bucket.story_id) || {};
      const topOfferEntry = [...bucket.offer_clicks.entries()].sort((a, b) => b[1] - a[1])[0];
      const topLink = topOfferEntry ? findLink(manifest, topOfferEntry[0]) : null;
      const views = storyViews(story);
      const rate = clickRate(bucket.clicks, views);
      return {
        story_id: bucket.story_id,
        title: story.title || manifest.short_title || manifest.story_entities?.[0] || bucket.story_id,
        vertical: manifest.vertical || "unknown",
        commercial_intent_type: manifest.commercial_intent_type || "unknown",
        landing_page_route: manifest.landing_page_route || null,
        clicks: bucket.clicks,
        views,
        affiliate_click_rate: rate,
        offer_fit_score: topLink
          ? Math.min(100, Math.round((topLink.story_relevance || topLink.relevance_score || 60) + bucket.clicks * 4))
          : null,
        platform_commercial_score: Math.min(100, 50 + bucket.clicks * 8),
        commercial_angle_lift: commercialAngleLift(bucket.clicks, views),
        top_offer: topOfferEntry
          ? {
              offer_id: topOfferEntry[0],
              label: topLink?.label || topOfferEntry[0],
              product_category: topLink?.product_category || topLink?.category || null,
              clicks: topOfferEntry[1],
            }
          : null,
        platforms: toBreakdownObject(bucket.platforms),
        cta_variants: toBreakdownObject(bucket.ctas),
      };
    })
    .sort((a, b) => b.clicks - a.clicks);

  const offerBreakdown = [...offerMap.values()]
    .map((offer) => ({
      offer_id: offer.offer_id,
      label: offer.label,
      product_category: offer.product_category,
      merchant: offer.merchant,
      clicks: offer.clicks,
      story_count: offer.story_ids.size,
    }))
    .sort((a, b) => b.clicks - a.clicks);

  const recommendations = buildRecommendations({
    clicks: safeClicks,
    topStories,
    offerBreakdown,
    verticalBreakdown: toBreakdownObject(verticalMap),
  });
  const nextRenderAdjustments = topStories.slice(0, 10).map((story) => ({
    story_id: story.story_id,
    commercial_angle_lift: story.commercial_angle_lift,
    prompt_adjustment:
      story.commercial_angle_lift === "positive"
        ? `Keep the ${story.top_offer?.product_category || "related setup"} angle in the story page CTA.`
        : "Keep the CTA source-first until more commercial clicks come in.",
    landing_page_cta:
      story.commercial_angle_lift === "positive"
        ? "Put the best related setup link above secondary offers."
        : "Lead with sources and keep offers lower on the page.",
  }));

  const blockers = [];
  if (!safeClicks.length) blockers.push("no_commercial_clicks_recorded");
  if (!asArray(manifests).length) blockers.push("no_affiliate_manifests_found");

  return {
    schema_version: 1,
    generated_at: generatedAt,
    status: safeClicks.length ? "commercial_learning_active" : "waiting_for_click_data",
    totals: {
      clicks: safeClicks.length,
      clicked_stories: byStory.size,
      clicked_offers: offerMap.size,
      manifests: asArray(manifests).length,
    },
    top_stories: topStories,
    offer_breakdown: offerBreakdown,
    platform_breakdown: toBreakdownObject(platformMap),
    cta_breakdown: toBreakdownObject(ctaMap),
    vertical_breakdown: toBreakdownObject(verticalMap),
    recommendations,
    next_render_adjustments: nextRenderAdjustments,
    blockers,
    safety: {
      no_story_rows_mutated: true,
      no_social_posting_triggered: true,
      raw_user_agents_stored: false,
      ip_addresses_stored: false,
      recommendations_only: true,
    },
  };
}

function buildRecommendations({ clicks, topStories, offerBreakdown }) {
  if (!clicks.length) {
    return [
      {
        type: "collect_more_data",
        priority: "normal",
        text: "No commercial clicks recorded yet. Keep collecting click data before changing story selection.",
      },
    ];
  }
  const out = [];
  const topOffer = offerBreakdown[0];
  if (topOffer && topOffer.clicks >= 2) {
    out.push({
      type: "double_down_offer_fit",
      priority: "high",
      offer_id: topOffer.offer_id,
      product_category: topOffer.product_category,
      text: `${topOffer.label} is getting clicks. Use that angle again when the story genuinely supports it.`,
    });
  }
  const topStory = topStories[0];
  if (topStory) {
    out.push({
      type: "story_page_cta",
      priority: topStory.commercial_angle_lift === "positive" ? "high" : "normal",
      story_id: topStory.story_id,
      text:
        topStory.commercial_angle_lift === "positive"
          ? `Keep ${topStory.title} style pages product-specific, with the best setup offer above generic links.`
          : `Keep ${topStory.title} source-first until the CTA gets more clicks.`,
    });
  }
  if (!out.length) {
    out.push({
      type: "collect_more_data",
      priority: "normal",
      text: "Commercial signal is still thin. Keep gathering clicks before changing the format.",
    });
  }
  return out;
}

function renderCommercialLearningMarkdown(digest = {}) {
  const lines = [];
  lines.push("# Commercial Learning Loop");
  lines.push("");
  lines.push(`Generated: ${digest.generated_at || ""}`);
  lines.push(`Status: ${digest.status || "unknown"}`);
  lines.push(`Clicks: ${digest.totals?.clicks || 0}`);
  lines.push("");
  lines.push("## Top stories");
  if (!asArray(digest.top_stories).length) {
    lines.push("- No commercial clicks recorded yet.");
  } else {
    for (const story of digest.top_stories.slice(0, 5)) {
      const rate =
        story.affiliate_click_rate === null || story.affiliate_click_rate === undefined
          ? "n/a"
          : `${(story.affiliate_click_rate * 100).toFixed(2)}%`;
      lines.push(
        `- ${story.title}: ${story.clicks} click(s), CTR ${rate}, lift ${story.commercial_angle_lift}`,
      );
    }
  }
  lines.push("");
  lines.push("## Recommendations");
  for (const rec of asArray(digest.recommendations)) {
    lines.push(`- [${rec.priority || "normal"}] ${rec.text}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- No story rows were mutated.");
  lines.push("- No social posting was triggered.");
  lines.push("- No raw user agents or IP addresses are stored.");
  return `${lines.join("\n")}\n`;
}

async function runCommercialLearningLoop({
  generatedAt = new Date().toISOString(),
  clickLogPath = DEFAULT_CLICK_LOG_PATH,
  manifestDirs = DEFAULT_MANIFEST_DIRS,
  outputDir = path.join(process.cwd(), "data", "learning", "commercial"),
  stories = [],
} = {}) {
  const clickLog = await readCommercialClickLog(clickLogPath);
  const manifests = await loadCommercialManifests(manifestDirs);
  const digest = buildCommercialLearningDigest({
    generatedAt,
    clicks: clickLog.entries,
    manifests,
    stories,
  });
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "commercial-learning.json");
  const mdPath = path.join(outputDir, "commercial-learning.md");
  await fs.writeJson(jsonPath, digest, { spaces: 2 });
  await fs.writeFile(mdPath, renderCommercialLearningMarkdown(digest), "utf8");
  return {
    digest,
    click_log: clickLog,
    artefacts: { jsonPath, mdPath },
  };
}

module.exports = {
  DEFAULT_CLICK_LOG_PATH,
  DEFAULT_MANIFEST_DIRS,
  buildCommercialLearningDigest,
  loadCommercialManifests,
  readCommercialClickLog,
  renderCommercialLearningMarkdown,
  runCommercialLearningLoop,
};
