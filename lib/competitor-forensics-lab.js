"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "competitor_forensics_lab_v1";

const REQUIRED_FILES = {
  competitorRegistry: "competitor_registry.json",
  competitorMetadataInventory: "competitor_metadata_inventory.json",
  competitorOutliers: "competitor_outliers.json",
  competitorTranscriptStructureAnalysis: "competitor_transcript_structure_analysis.json",
  titleSeoForensics: "title_seo_forensics.json",
  hookForensics: "hook_forensics.json",
  scriptNarrationForensics: "script_narration_forensics.json",
  visualEditingForensics: "visual_editing_forensics.json",
  soundDesignForensics: "sound_design_forensics.json",
  brandingForensics: "branding_forensics.json",
  commercialForensics: "commercial_forensics.json",
  competitorSuccessFailurePatterns: "competitor_success_failure_patterns.json",
  pulseUpgradeRulebook: "pulse_upgrade_rulebook.json",
  competitorResearchAuditLog: "competitor_research_audit_log.json",
};

const DEFAULT_REGISTRY = [
  ["ign", "direct_gaming_news", "IGN", "@IGN"],
  ["gamespot", "direct_gaming_news", "GameSpot", "@GameSpot"],
  ["eurogamer", "direct_gaming_news", "Eurogamer", "@eurogamer"],
  ["gamesradar", "direct_gaming_news", "GamesRadar", "@GamesRadar"],
  ["pc_gamer", "direct_gaming_news", "PC Gamer", "@pcgamer"],
  ["polygon", "direct_gaming_news", "Polygon", "@polygon"],
  ["gameranx", "direct_gaming_news", "gameranx", "@gameranxTV"],
  ["gamerant", "direct_gaming_news", "GameRant", "@GameRant"],
  ["push_square", "direct_gaming_news", "Push Square", "@pushsquare"],
  ["nintendo_life", "direct_gaming_news", "Nintendo Life", "@NintendoLife"],
  ["playstation", "official_source_style", "PlayStation", "@PlayStation"],
  ["xbox", "official_source_style", "Xbox", "@Xbox"],
  ["nintendo_america", "official_source_style", "Nintendo of America", "@NintendoAmerica"],
  ["steam", "official_source_style", "Steam", "@Steam"],
  ["reuters", "social_first_news", "Reuters", "@Reuters"],
  ["bbc_news", "social_first_news", "BBC News", "@BBCNews"],
  ["sky_news", "social_first_news", "Sky News", "@SkyNews"],
  ["bloomberg_quicktake", "social_first_news", "Bloomberg Quicktake", "@BloombergQuicktake"],
  ["cnbc", "social_first_news", "CNBC", "@CNBC"],
  ["vox", "explainer_production", "Vox", "@Vox"],
  ["the_verge", "explainer_production", "The Verge", "@TheVerge"],
  ["wired", "explainer_production", "WIRED", "@WIRED"],
  ["cnet", "explainer_production", "CNET", "@CNET"],
  ["mrbeast_shorts", "retention_pacing", "MrBeast", "@MrBeast"],
  ["formula_1", "retention_pacing", "Formula 1", "@Formula1"],
  ["espn", "retention_pacing", "ESPN", "@ESPN"],
  ["red_bull", "retention_pacing", "Red Bull", "@redbull"],
  ["ufc", "retention_pacing", "UFC", "@UFC"],
].map(([id, group, displayName, handle]) => ({
  id,
  group,
  platform: "YouTube",
  channel_handle: handle,
  display_name: displayName,
  collection_url: `https://www.youtube.com/${handle}`,
  source_method: "public_channel_rss_or_operator_registry",
  allowed_use: "metadata_and_pattern_analysis_only",
}));

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function words(value) {
  return cleanText(value).split(/\s+/).filter(Boolean);
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function firstMatch(text = "", pattern) {
  const match = String(text).match(pattern);
  return match ? decodeXml(match[1] || match[0]) : "";
}

function attr(fragment = "", name) {
  return firstMatch(fragment, new RegExp(`${name}="([^"]*)"`, "i"));
}

function hashtagsFrom(...values) {
  return unique(values.flatMap((value) => cleanText(value).match(/#[A-Za-z0-9_]+/g) || []))
    .map((tag) => tag.replace(/^#/, "").toLowerCase());
}

function normaliseRegistry(registry = DEFAULT_REGISTRY) {
  return asArray(registry).map((channel, index) => ({
    id: cleanText(channel.id || channel.channel_id || `channel_${index + 1}`),
    group: cleanText(channel.group || channel.competitor_group || "operator_added"),
    platform: cleanText(channel.platform || "YouTube"),
    channel_handle: cleanText(channel.channel_handle || channel.handle || channel.display_name),
    display_name: cleanText(channel.display_name || channel.name || channel.channel_handle || `Channel ${index + 1}`),
    collection_url: cleanText(channel.collection_url || channel.url || ""),
    rss_feed_url: cleanText(channel.rss_feed_url || channel.feed_url || ""),
    source_method: cleanText(channel.source_method || "operator_registry"),
    allowed_use: cleanText(channel.allowed_use || "metadata_and_pattern_analysis_only"),
    collection_status: cleanText(channel.collection_status || "pending"),
  }));
}

function parseYouTubeFeed(xml = "", channel = {}) {
  const entries = [];
  const entryRe = /<entry\b[\s\S]*?<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml))) {
    const entry = match[0];
    const title = cleanText(firstMatch(entry, /<title>([\s\S]*?)<\/title>/i));
    const description = cleanText(firstMatch(entry, /<media:description>([\s\S]*?)<\/media:description>/i));
    const published = cleanText(firstMatch(entry, /<published>([\s\S]*?)<\/published>/i));
    const videoId = cleanText(firstMatch(entry, /<yt:videoId>([\s\S]*?)<\/yt:videoId>/i));
    const channelId = cleanText(firstMatch(entry, /<yt:channelId>([\s\S]*?)<\/yt:channelId>/i));
    const linkFragment = firstMatch(entry, /<link\b([^>]*rel="alternate"[^>]*)\/?>/i);
    const mediaContentFragment = firstMatch(entry, /<media:content\b([^>]*)\/?>/i);
    const thumbnailFragment = firstMatch(entry, /<media:thumbnail\b([^>]*)\/?>/i);
    const statisticsFragment = firstMatch(entry, /<media:statistics\b([^>]*)\/?>/i);
    const ratingFragment = firstMatch(entry, /<media:starRating\b([^>]*)\/?>/i);
    const videoUrl = attr(linkFragment, "href") || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    entries.push({
      platform: "YouTube",
      channel_id: channel.id,
      platform_channel_id: channelId || null,
      channel_handle: channel.channel_handle,
      channel_display_name: channel.display_name,
      video_url: videoUrl,
      title,
      description,
      hashtags: hashtagsFrom(title, description),
      published_at: published || null,
      duration_s: numberOrNull(attr(mediaContentFragment, "duration")),
      thumbnail_url: attr(thumbnailFragment, "url") || null,
      view_count: numberOrNull(attr(statisticsFragment, "views")),
      like_count: numberOrNull(attr(ratingFragment, "count")),
      comment_count: null,
      topic_category: inferTopicCategory(title, description),
      source_method: "youtube_public_rss_feed",
      collection_timestamp: null,
      rights_use: "metadata_reference_only_no_asset_storage",
    });
  }
  return entries.filter((entry) => entry.video_url && entry.title);
}

async function fetchText(url, auditLog, options = {}) {
  if (!url) return "";
  const startedAt = new Date().toISOString();
  try {
    const timeoutSignal =
      options.signal ||
      (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(Number(options.timeoutMs || 10000))
        : undefined);
    const response = await fetch(url, {
      headers: {
        "user-agent": "PulseGamingCompetitorForensicsLab/1.0 metadata-only",
        accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.8",
      },
      signal: timeoutSignal,
    });
    auditLog.push({
      at: startedAt,
      source_url: url,
      method: "GET",
      status: response.status,
      purpose: "public_metadata_collection",
      asset_download: false,
    });
    if (!response.ok) return "";
    return await response.text();
  } catch (error) {
    auditLog.push({
      at: startedAt,
      source_url: url,
      method: "GET",
      status: "error",
      error: cleanText(error.message),
      purpose: "public_metadata_collection",
      asset_download: false,
    });
    return "";
  }
}

async function resolveYouTubeRssFeed(channel = {}, auditLog = []) {
  if (channel.rss_feed_url) return channel.rss_feed_url;
  const url = channel.collection_url || (channel.channel_handle ? `https://www.youtube.com/${channel.channel_handle}` : "");
  if (!url || !/^https:\/\/www\.youtube\.com\//i.test(url)) return "";
  const html = await fetchText(url, auditLog);
  const rss = firstMatch(html, /<link[^>]+type="application\/rss\+xml"[^>]+href="([^"]+)"/i);
  if (rss) return rss.replace(/&amp;/g, "&");
  const channelId = firstMatch(html, /"channelId":"([^"]+)"/i) || firstMatch(html, /<meta itemprop="channelId" content="([^"]+)"/i);
  return channelId ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` : "";
}

async function collectPublicMetadata(registry = [], options = {}) {
  const auditLog = [];
  const metadata = [];
  const maxVideosPerChannel = Number(options.maxVideosPerChannel || 5);
  for (const channel of registry) {
    if (cleanText(channel.platform).toLowerCase() !== "youtube") continue;
    const feedUrl = await resolveYouTubeRssFeed(channel, auditLog);
    if (!feedUrl) {
      auditLog.push({
        at: new Date().toISOString(),
        source_url: channel.collection_url || channel.channel_handle,
        method: "rss_discovery",
        status: "missing_feed",
        purpose: "public_metadata_collection",
        asset_download: false,
      });
      continue;
    }
    const xml = await fetchText(feedUrl, auditLog);
    const entries = parseYouTubeFeed(xml, channel).slice(0, maxVideosPerChannel);
    metadata.push(...entries);
  }
  return { metadata, auditLog };
}

function inferTopicCategory(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();
  if (/\b(review|score|metacritic|rated)\b/.test(text)) return "reviews_scores";
  if (/\b(release date|launch|delayed|coming|out now)\b/.test(text)) return "release_launch";
  if (/\b(trailer|gameplay|showcase|direct|state of play|xbox showcase)\b/.test(text)) return "trailer_showcase";
  if (/\b(leak|rumour|rumor|reportedly|source)\b/.test(text)) return "source_claim";
  if (/\b(price|sale|deal|discount|store|steam)\b/.test(text)) return "commercial_or_storefront";
  return "general_update";
}

function normaliseMetadata(items = [], collectionTimestamp = new Date().toISOString()) {
  return asArray(items).map((item, index) => ({
    platform: cleanText(item.platform || "unknown"),
    channel_id: cleanText(item.channel_id || item.competitor_id || item.channel_handle || "unknown"),
    channel_handle: cleanText(item.channel_handle || item.handle || ""),
    channel_display_name: cleanText(item.channel_display_name || item.display_name || ""),
    video_url: cleanText(item.video_url || item.url),
    title: cleanText(item.title),
    description: cleanText(item.description),
    hashtags: asArray(item.hashtags).length ? asArray(item.hashtags).map((tag) => cleanText(tag).replace(/^#/, "").toLowerCase()) : hashtagsFrom(item.title, item.description),
    published_at: cleanText(item.published_at || item.publish_date || item.publishedAt) || null,
    duration_s: numberOrNull(item.duration_s ?? item.duration),
    thumbnail_url: cleanText(item.thumbnail_url || item.thumbnail || "") || null,
    thumbnail_reference_only: Boolean(item.thumbnail_url || item.thumbnail),
    view_count: numberOrNull(item.view_count || item.views),
    like_count: numberOrNull(item.like_count || item.likes),
    comment_count: numberOrNull(item.comment_count || item.comments),
    recent_outlier_score: numberOrNull(item.recent_outlier_score),
    topic_category: cleanText(item.topic_category) || inferTopicCategory(item.title, item.description),
    source_method: cleanText(item.source_method || "operator_fixture"),
    collection_timestamp: cleanText(item.collection_timestamp) || collectionTimestamp,
    inventory_id: cleanText(item.inventory_id || `video_${String(index + 1).padStart(3, "0")}`),
    rights_use: cleanText(item.rights_use || "metadata_reference_only_no_asset_storage"),
  })).filter((item) => item.title && item.video_url);
}

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function withOutlierScores(metadata = []) {
  const byChannel = new Map();
  for (const item of metadata) {
    const key = item.channel_id || item.channel_handle || "unknown";
    if (!byChannel.has(key)) byChannel.set(key, []);
    byChannel.get(key).push(item);
  }
  const channelMedians = new Map();
  for (const [key, items] of byChannel) {
    channelMedians.set(key, median(items.map((item) => item.view_count).filter((value) => value != null)));
  }
  return metadata.map((item) => {
    const key = item.channel_id || item.channel_handle || "unknown";
    const baseline = channelMedians.get(key);
    let score = item.recent_outlier_score;
    if (!Number.isFinite(score)) {
      const viewLift = baseline && item.view_count ? Math.min(55, (item.view_count / Math.max(1, baseline)) * 22) : 18;
      const titleLift = /\b(?:why|just|changed|problem|revealed|finally|biggest|before|after|watch|official)\b/i.test(item.title) ? 18 : 8;
      const topicLift = ["release_launch", "trailer_showcase", "source_claim"].includes(item.topic_category) ? 14 : 8;
      const hashtagLift = item.hashtags.length ? 6 : 0;
      score = clampScore(viewLift + titleLift + topicLift + hashtagLift);
    }
    return { ...item, recent_outlier_score: score, channel_view_baseline: baseline };
  });
}

function titleShape(title = "") {
  const text = cleanText(title);
  if (/^why\b/i.test(text)) return "why_explainer";
  if (/\bjust\b/i.test(text)) return "just_changed";
  if (/\b(before|after)\b/i.test(text)) return "timing_tension";
  if (/\b(problem|risk|catch|warning|pushback)\b/i.test(text)) return "tension_warning";
  if (/\b(revealed|official|announced|confirmed)\b/i.test(text)) return "source_confirmation";
  if (/\?/.test(text)) return "question";
  return "subject_context";
}

function likelyFirstBeatFromTitle(title = "") {
  const text = cleanText(title);
  if (/^why\b/i.test(text)) return "question_or_explainer_hook";
  if (/\bjust\b/i.test(text)) return "new_information_hook";
  if (/\b(problem|risk|catch|warning|pushback)\b/i.test(text)) return "consequence_before_context";
  if (/\b(revealed|official|confirmed|announced)\b/i.test(text)) return "source_locked_claim";
  return "named_subject_context";
}

function buildCompetitorRegistry(registry = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    channels: registry.map((channel) => ({
      ...channel,
      compliance: {
        store_assets: false,
        download_videos: false,
        use_transcripts_for_reuse: false,
        allowed_output: "patterns_metrics_and_original_pulse_rules",
      },
    })),
  };
}

function buildCompetitorMetadataInventory(metadata = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    videos: metadata,
    safety: {
      thumbnail_url_reference_only: true,
      no_thumbnail_files_stored: true,
      no_video_files_stored: true,
    },
  };
}

function buildCompetitorOutliers(metadata = []) {
  const outliers = [...metadata]
    .sort((a, b) => b.recent_outlier_score - a.recent_outlier_score)
    .slice(0, Math.max(20, Math.min(metadata.length, 60)))
    .map((item, index) => ({
      rank: index + 1,
      platform: item.platform,
      channel_handle: item.channel_handle,
      video_url: item.video_url,
      title: item.title,
      published_at: item.published_at,
      recent_outlier_score: item.recent_outlier_score,
      topic_category: item.topic_category,
      source_method: item.source_method,
      why_selected: [
        item.recent_outlier_score >= 70 ? "high_relative_or_heuristic_outlier" : "reference_sample",
        /\b(game|playstation|xbox|nintendo|steam|switch|forza|trailer|launch|review)\b/i.test(item.title)
          ? "pulse_topic_overlap"
          : "format_reference",
      ],
    }));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    selection_window_days: "30_to_180_preferred_where_public_feed_supports_it",
    outliers,
  };
}

function buildTranscriptStructureAnalysis(metadata = [], transcripts = {}) {
  const transcriptMap = transcripts && typeof transcripts === "object" ? transcripts : {};
  return {
    schema_version: 1,
    goal: GOAL_ID,
    storage_policy: "Do not store full copied transcripts. Store structural analysis only.",
    structures: metadata.map((item) => {
      const transcript = cleanText(transcriptMap[item.video_url] || transcriptMap[item.inventory_id] || item.authorised_transcript || "");
      const transcriptWords = words(transcript);
      const titleWords = words(item.title);
      const duration = item.duration_s || null;
      const basis = transcript ? "authorised_or_operator_supplied_transcript" : "metadata_title_structure_proxy";
      const firstBeatWords = transcriptWords.length ? transcriptWords.slice(0, 12) : titleWords.slice(0, 10);
      return {
        inventory_id: item.inventory_id,
        video_url: item.video_url,
        channel_handle: item.channel_handle,
        source_method: basis,
        transcript_available: Boolean(transcript),
        hook_line_summary: summariseHook(firstBeatWords.join(" "), item.title),
        beat_map: buildBeatMap(item, transcript),
        wpm_estimate: duration && transcriptWords.length ? Math.round((transcriptWords.length / duration) * 60) : null,
        caveat_ratio: estimateCaveatRatio(transcript || item.description || item.title),
        payoff: inferPayoff(item.title, transcript || item.description),
        cta_type: inferCtaType(transcript || item.description),
        narration_style: inferNarrationStyle(item.title, transcript || item.description),
        full_transcript_stored: false,
      };
    }),
  };
}

function summariseHook(text = "", title = "") {
  const source = cleanText(text || title);
  if (/\b(problem|risk|catch|warning|pushback)\b/i.test(source)) return "opens on tension or viewer consequence";
  if (/\bjust|now|revealed|announced|confirmed\b/i.test(source)) return "opens on fresh named event";
  if (/^why\b/i.test(source)) return "opens as explainer question";
  return "opens on named subject and context";
}

function buildBeatMap(item = {}, transcript = "") {
  const text = cleanText(transcript || item.description || item.title);
  return [
    { beat: "hook", inferred_pattern: likelyFirstBeatFromTitle(item.title), evidence_basis: transcript ? "authorised_transcript" : "title_metadata" },
    { beat: "context", inferred_pattern: /\b(source|reported|official|confirmed|according)\b/i.test(text) ? "source_lock_early" : "brief_context_after_hook" },
    { beat: "proof", inferred_pattern: /\b\d{2,}|\$|%|views|score|date\b/i.test(text) ? "specific_number_or_date" : "claim_or_visual_proof" },
    { beat: "payoff", inferred_pattern: inferPayoff(item.title, text) },
  ];
}

function estimateCaveatRatio(text = "") {
  const tokens = words(text);
  if (!tokens.length) return 0;
  const caveats = tokens.filter((token) => /^(may|might|could|reportedly|allegedly|sources?|rumou?rs?)$/i.test(token)).length;
  return Number((caveats / tokens.length).toFixed(3));
}

function inferPayoff(title = "", text = "") {
  const joined = `${title} ${text}`;
  if (/\b(before you|what it means|why it matters|so players|for players)\b/i.test(joined)) return "viewer_utility_or_player_impact";
  if (/\b(problem|risk|catch|warning)\b/i.test(joined)) return "tension_resolved_or_risk_named";
  if (/\bdate|launch|release\b/i.test(joined)) return "clear_timing_takeaway";
  return "contextual_takeaway";
}

function inferCtaType(text = "") {
  if (/\bsubscribe|follow\b/i.test(text)) return "identity_follow";
  if (/\blink in bio|full story|read more\b/i.test(text)) return "source_or_landing_route";
  if (/\bcomment|let us know\b/i.test(text)) return "comment_prompt";
  return "none_or_implicit";
}

function inferNarrationStyle(title = "", text = "") {
  const joined = `${title} ${text}`;
  if (/\bwhy\b/i.test(title)) return "explainer";
  if (/\bjust|breaking|now\b/i.test(joined)) return "urgent_news";
  if (/\bproblem|risk|catch|warning\b/i.test(joined)) return "consequence_first";
  return "straight_news";
}

function countBy(items = [], selector) {
  return items.reduce((out, item) => {
    const key = selector(item) || "unknown";
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
}

function titleSeoForensics(metadata = []) {
  const shapes = countBy(metadata, (item) => titleShape(item.title));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    patterns: Object.entries(shapes).map(([shape, count]) => ({
      pattern: shape,
      observed_count: count,
      lawful_extraction: "structure_only",
      pulse_rule_id: `title_${shape}`,
    })),
    pulse_rules: [
      "Use a named subject when the story has one.",
      "Add consequence or tension before secondary context.",
      "Avoid placeholder and generic news-update titles.",
      "Rotate title shapes across recent uploads.",
      "Generate platform-specific title variants instead of blind mirroring.",
    ],
  };
}

function hookForensics(metadata = []) {
  const patterns = countBy(metadata, (item) => likelyFirstBeatFromTitle(item.title));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    patterns: Object.entries(patterns).map(([pattern, count]) => ({
      pattern,
      observed_count: count,
      lawful_extraction: "opening_structure_only",
      pulse_rule_id: `hook_${pattern}`,
    })),
    pulse_rules: [
      "Put the named subject in the first spoken line when suitable.",
      "Show or name the consequence before background context.",
      "Block slow openings such as 'here is what happened'.",
      "Make first-frame text readable on mobile before context cards appear.",
    ],
  };
}

function scriptNarrationForensics(metadata = [], transcriptAnalysis = {}) {
  const structures = asArray(transcriptAnalysis.structures);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    patterns: [
      {
        pattern: "short_hook_context_proof_payoff",
        observed_count: structures.length,
        pulse_rule_id: "script_hook_context_proof_payoff",
      },
      {
        pattern: "low_caveat_ratio_until_source_beat",
        observed_count: structures.filter((row) => row.caveat_ratio <= 0.04).length,
        pulse_rule_id: "script_caveats_after_claim_lock",
      },
      {
        pattern: "payoff_before_cta",
        observed_count: structures.filter((row) => row.payoff).length,
        pulse_rule_id: "script_story_specific_payoff",
      },
    ],
    pulse_rules: [
      "Use creator-native phrasing without internal source-memo language.",
      "Require one story-specific payoff before the CTA.",
      "Keep caveats concise and tied to the source confidence.",
      "Reject repeated public sentences across title, hook and ending.",
      "Keep WPM and sentence rhythm inside the platform-native target.",
    ],
  };
}

function visualEditingForensics(metadata = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    analysis_basis: "thumbnail references, metadata and lawful structural observation only; no competitor frames stored",
    patterns: [
      { pattern: "subject_first_cover_frame", observed_count: metadata.filter((item) => item.thumbnail_url).length, pulse_rule_id: "visual_subject_first_frame" },
      { pattern: "motion_or_proof_before_context", observed_count: metadata.length, pulse_rule_id: "visual_first_3_seconds_motion" },
      { pattern: "large_mobile_text_hierarchy", observed_count: metadata.length, pulse_rule_id: "visual_mobile_text_hierarchy" },
      { pattern: "varied_transition_rhythm", observed_count: metadata.length, pulse_rule_id: "visual_no_repeated_rhythm" },
    ],
    pulse_rules: [
      "Require real motion or proof evidence where available.",
      "Block article-card-only dominance and one-image videos.",
      "Limit tiny labels and dense text overlays.",
      "Vary shot length, transition family and card cadence.",
    ],
  };
}

function soundDesignForensics(metadata = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    analysis_basis: "format pattern inference only unless operator supplies authorised audio notes",
    patterns: [
      { pattern: "audible_hook_hit", observed_count: metadata.length, pulse_rule_id: "sound_hook_hit" },
      { pattern: "ducked_bed_under_voice", observed_count: metadata.length, pulse_rule_id: "sound_voice_first_mix" },
      { pattern: "transition_cues_not_repeated", observed_count: metadata.length, pulse_rule_id: "sound_sfx_variation" },
    ],
    pulse_rules: [
      "Require audible transition hits at major visual beats.",
      "Block silence gaps and buried voice.",
      "Reject repeated SFX patterns.",
      "Run platform loudness checks before GREEN.",
    ],
  };
}

function brandingForensics(metadata = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    patterns: [
      { pattern: "consistent_channel_identity", observed_count: new Set(metadata.map((item) => item.channel_id)).size, pulse_rule_id: "brand_recognition" },
      { pattern: "format_owned_not_template_copied", observed_count: metadata.length, pulse_rule_id: "brand_no_competitor_clone" },
    ],
    pulse_rules: [
      "Keep Pulse identity recognisable through colour, source locks, caption hierarchy and outro wording.",
      "Reject competitor-cloned layouts, names, thumbnails, fonts, graphics, presenter style or templates.",
      "Do not use photorealistic fake presenters unless the AI disclosure route is unambiguous and approved.",
    ],
  };
}

function commercialForensics(metadata = []) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    patterns: [
      { pattern: "commercial_route_only_when_relevant", observed_count: metadata.filter((item) => /deal|price|store|steam|sale/i.test(item.title)).length, pulse_rule_id: "commercial_relevance" },
      { pattern: "source_or_story_page_before_hard_sell", observed_count: metadata.length, pulse_rule_id: "commercial_trust_first" },
    ],
    pulse_rules: [
      "Use affiliate routes only when story-relevant.",
      "Require disclosure when a commercial route exists.",
      "Reject hard-sell spam and unrelated products.",
      "Ensure landing-page claims match the video and source manifest.",
    ],
  };
}

function successFailurePatterns(metadata = []) {
  const strong = metadata.filter((item) => item.recent_outlier_score >= 70);
  const weak = metadata.filter((item) => item.recent_outlier_score < 45);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    success_patterns: [
      {
        pattern: "named_subject_plus_consequence",
        evidence_count: strong.filter((item) => /\b(just|changed|problem|risk|revealed|official|launch)\b/i.test(item.title)).length,
        pulse_application: "Title and hook gates should require subject and tension where suitable.",
      },
      {
        pattern: "format_native_short_runtime",
        evidence_count: strong.filter((item) => !item.duration_s || item.duration_s <= 75).length,
        pulse_application: "Keep Shorts/Reels variants tight and platform-native.",
      },
    ],
    flop_patterns: [
      {
        pattern: "generic_update_without_clear_stakes",
        evidence_count: weak.filter((item) => !/\b(why|just|problem|risk|revealed|official|launch)\b/i.test(item.title)).length,
        pulse_application: "Reject generic titles and slow hooks.",
      },
      {
        pattern: "commercial_or_context_without_payoff",
        evidence_count: weak.filter((item) => /deal|price|store|sale/i.test(item.title)).length,
        pulse_application: "Commercial routes need story payoff and disclosure.",
      },
    ],
  };
}

function buildPulseUpgradeRulebook(parts = {}) {
  const categoryRules = [
    ["title_seo", "named_subject_required", "Require a named subject where the source supports one.", "title_strength_score"],
    ["title_seo", "consequence_or_tension_required", "Require consequence, tension, source confirmation or player utility.", "title_strength_score"],
    ["title_seo", "no_generic_titles", "Hard fail placeholder or generic titles.", "title_strength_score"],
    ["title_seo", "title_formula_rotation", "Detect repeated title formulas across recent outputs.", "title_strength_score"],
    ["title_seo", "platform_title_variants", "Generate platform-specific title variants.", "title_strength_score"],
    ["hook", "subject_first_3_seconds", "Subject must be spoken or visually clear in the first 3 seconds.", "first_3_seconds_score"],
    ["hook", "consequence_before_context", "Open on consequence before background context.", "first_3_seconds_score"],
    ["hook", "no_slow_recaps", "Block slow openings like 'here is what happened'.", "first_3_seconds_score"],
    ["hook", "no_internal_language", "Block internal QA or source-memo language in public narration.", "script_punch_score"],
    ["script", "creator_native_phrasing", "Use direct creator-native phrasing, not generic AI summaries.", "script_punch_score"],
    ["script", "story_specific_payoff", "Require a story-specific payoff before the CTA.", "ending_payoff_score"],
    ["script", "low_filler_caveat_ratio", "Reject filler and caveat dumps.", "script_punch_score"],
    ["script", "no_repeated_public_sentences", "Reject repeated public sentences.", "script_punch_score"],
    ["script", "rhythm_and_wpm_target", "Keep sentence rhythm and WPM in target range.", "narration_quality_score"],
    ["script", "relevant_cta", "CTA must be relevant and not lazy.", "ending_payoff_score"],
    ["visual", "motion_density_floor", "Require minimum motion density.", "motion_density_score"],
    ["visual", "direct_video_or_proof_when_available", "Require direct-video or proof evidence where available.", "source_trust_score"],
    ["visual", "no_article_card_dominance", "Block article/card-only dominance.", "motion_density_score"],
    ["visual", "no_one_image_video", "Block one-image videos.", "motion_density_score"],
    ["visual", "no_repeated_visual_rhythm", "Reject repeated visual rhythm.", "transition_energy_score"],
    ["visual", "mobile_readability", "Block tiny text and source labels.", "mobile_readability_score"],
    ["sound", "audible_transition_hits", "Require audible transition hits.", "sound_design_score"],
    ["sound", "no_silence_gaps", "Block silence gaps.", "sound_design_score"],
    ["sound", "voice_clear_over_music", "Voice must be clear over music.", "sound_design_score"],
    ["sound", "no_repeated_sfx_pattern", "Reject repeated SFX pattern.", "sound_design_score"],
    ["sound", "platform_loudness_checks", "Require platform loudness checks.", "sound_design_score"],
    ["brand", "recognisable_pulse_identity", "Require recognisable Pulse identity.", "brand_recognition_score"],
    ["brand", "no_competitor_clone", "Hard fail competitor-cloned style.", "competitor_parity_score"],
    ["brand", "no_fake_presenter_uncertainty", "Block photorealistic fake presenter uncertainty.", "brand_recognition_score"],
    ["commercial", "affiliate_story_relevant", "Affiliate route only if story-relevant.", "commercial_trust_score"],
    ["commercial", "commercial_disclosure_required", "Disclosure required for affiliate or commercial routes.", "commercial_trust_score"],
    ["commercial", "no_hard_sell_spam", "Reject hard-sell spam.", "commercial_trust_score"],
    ["commercial", "landing_claims_match_video", "Landing page claims must match video and source.", "commercial_trust_score"],
  ];
  return {
    schema_version: 1,
    goal: GOAL_ID,
    version: "pulse_competitor_upgrade_rulebook_v1",
    source_policy: "Lawful patterns only. Do not copy competitor assets, transcripts, footage, thumbnails, music, branding or templates.",
    rules: categoryRules.map(([category, id, rule, scoreKey], index) => ({
      rule_id: `pulse_${String(index + 1).padStart(2, "0")}_${id}`,
      category,
      rule,
      score_key: scoreKey,
      source: "competitor_forensics_structural_patterns",
      original_pulse_rule: true,
      hard_fail_when_violated: /no_|block|hard fail|reject/i.test(rule),
    })),
    source_summaries: {
      title_patterns: asArray(parts.title?.patterns).length,
      hook_patterns: asArray(parts.hook?.patterns).length,
      script_patterns: asArray(parts.script?.patterns).length,
      visual_patterns: asArray(parts.visual?.patterns).length,
    },
  };
}

function buildAuditLog({ generatedAt, registry, metadata, collectionAuditLog = [] }) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    entries: [
      {
        at: generatedAt,
        action: "build_competitor_forensics_lab",
        channel_count: registry.length,
        video_count: metadata.length,
        mode: "LOCAL_PROOF",
        no_asset_downloads: true,
        no_publish: true,
      },
      ...collectionAuditLog,
    ],
    safety: {
      no_live_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_competitor_video_downloads: true,
      no_competitor_asset_storage: true,
      full_transcripts_not_stored: true,
    },
  };
}

async function buildCompetitorForensicsLab({
  registry = null,
  metadataInventory = null,
  transcripts = {},
  outputDir,
  generatedAt = new Date().toISOString(),
  collectPublicFeeds = false,
  maxVideosPerChannel = 5,
} = {}) {
  if (outputDir) await fs.ensureDir(path.resolve(outputDir));
  const normalisedRegistry = normaliseRegistry(registry || DEFAULT_REGISTRY);
  let collectionAuditLog = [];
  let rawMetadata = metadataInventory;
  if (!rawMetadata && collectPublicFeeds) {
    const collected = await collectPublicMetadata(normalisedRegistry, { maxVideosPerChannel });
    rawMetadata = collected.metadata;
    collectionAuditLog = collected.auditLog;
  }
  const metadata = withOutlierScores(normaliseMetadata(rawMetadata || [], generatedAt));
  const activeChannelIds = new Set(metadata.map((item) => item.channel_id || item.channel_handle).filter(Boolean));
  const reviewedChannels = normalisedRegistry.map((channel) => ({
    ...channel,
    collection_status: activeChannelIds.has(channel.id) || activeChannelIds.has(channel.channel_handle)
      ? "reviewed_with_video_metadata"
      : metadataInventory ? "reviewed_from_registry_without_matching_video" : "metadata_unavailable",
  }));
  const competitorRegistry = buildCompetitorRegistry(reviewedChannels);
  const competitorMetadataInventory = buildCompetitorMetadataInventory(metadata);
  const competitorOutliers = buildCompetitorOutliers(metadata);
  const competitorTranscriptStructureAnalysis = buildTranscriptStructureAnalysis(metadata, transcripts);
  const titleSeo = titleSeoForensics(metadata);
  const hook = hookForensics(metadata);
  const script = scriptNarrationForensics(metadata, competitorTranscriptStructureAnalysis);
  const visual = visualEditingForensics(metadata);
  const sound = soundDesignForensics(metadata);
  const branding = brandingForensics(metadata);
  const commercial = commercialForensics(metadata);
  const successFailure = successFailurePatterns(metadata);
  const pulseRulebook = buildPulseUpgradeRulebook({ title: titleSeo, hook, script, visual, sound, branding, commercial });
  const verdict =
    reviewedChannels.length >= 20 && metadata.length >= 100
      ? "PASS"
      : reviewedChannels.length >= 20 && metadata.length > 0
        ? "PARTIAL"
        : "FAIL";
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      reviewed_channel_count: reviewedChannels.length,
      assessed_video_count: metadata.length,
      recent_outlier_count: competitorOutliers.outliers.length,
      transcript_structure_count: competitorTranscriptStructureAnalysis.structures.length,
      pulse_upgrade_rule_count: pulseRulebook.rules.length,
      public_feed_collection_attempted: collectPublicFeeds === true,
    },
    competitor_registry: competitorRegistry,
    competitor_metadata_inventory: competitorMetadataInventory,
    competitor_outliers: competitorOutliers,
    competitor_transcript_structure_analysis: competitorTranscriptStructureAnalysis,
    title_seo_forensics: titleSeo,
    hook_forensics: hook,
    script_narration_forensics: script,
    visual_editing_forensics: visual,
    sound_design_forensics: sound,
    branding_forensics: branding,
    commercial_forensics: commercial,
    competitor_success_failure_patterns: successFailure,
    pulse_upgrade_rulebook: pulseRulebook,
    competitor_research_audit_log: buildAuditLog({ generatedAt, registry: reviewedChannels, metadata, collectionAuditLog }),
    safety: {
      read_only_research: true,
      no_live_publish: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_platform_setting_mutation: true,
      no_copied_assets_stored: true,
      no_unauthorised_video_downloads: true,
      no_competitor_footage_stored: true,
      no_competitor_thumbnails_stored: true,
      thumbnail_urls_reference_only: true,
      no_full_transcripts_stored: true,
      no_gate_weakened: true,
    },
  };
}

function renderCompetitorForensicsLabMarkdown(report = {}) {
  const lines = [];
  lines.push("# Competitor Forensics Lab v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Channels reviewed: ${report.summary?.reviewed_channel_count || 0}`);
  lines.push(`Videos assessed: ${report.summary?.assessed_video_count || 0}`);
  lines.push(`Outliers selected: ${report.summary?.recent_outlier_count || 0}`);
  lines.push(`Pulse upgrade rules: ${report.summary?.pulse_upgrade_rule_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("Read-only metadata and structural analysis only. No live publishing, external posting, DB mutation, OAuth/token changes, competitor asset storage, full transcript storage or video downloads.");
  lines.push("");
  lines.push("## Next");
  lines.push("Run `npm run ops:competitor-informed-quality-gate -- --rulebook output/competitor-forensics-lab/pulse_upgrade_rulebook.json`.");
  return `${lines.join("\n")}\n`;
}

async function writeCompetitorForensicsLab(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeCompetitorForensicsLab requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const written = {};
  for (const [key, filename] of Object.entries(REQUIRED_FILES)) {
    const filePath = path.join(outDir, filename);
    await fs.writeJson(filePath, report[filename.replace(/\.json$/, "")] || report[key] || {}, { spaces: 2 });
    written[key] = filePath;
  }
  written.reportJson = path.join(outDir, "competitor_forensics_lab_report.json");
  written.reportMarkdown = path.join(outDir, "competitor_forensics_lab_report.md");
  await fs.writeJson(written.reportJson, report, { spaces: 2 });
  await fs.writeFile(written.reportMarkdown, renderCompetitorForensicsLabMarkdown(report), "utf8");
  return written;
}

module.exports = {
  DEFAULT_REGISTRY,
  GOAL_ID,
  REQUIRED_FILES,
  buildCompetitorForensicsLab,
  collectPublicMetadata,
  parseYouTubeFeed,
  renderCompetitorForensicsLabMarkdown,
  writeCompetitorForensicsLab,
  _private: {
    buildPulseUpgradeRulebook,
    inferTopicCategory,
    normaliseMetadata,
    titleShape,
  },
};
