"use strict";

const crypto = require("node:crypto");
const axios = require("axios");

const { PRIMARY_PULSE_CTA } = require("./pulse-cta");
const { buildStoryManifest } = require("./public-output-manifest");

const USER_AGENT = "PulseGamingGoalProof/1.0 (+https://pulse.orryy.com)";
const ADVERTISER_UNFRIENDLY_PUBLIC_RE =
  /\b(?:porn|pornography|gambling|casino|betting|wagering)\b/i;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeEntities(value = "") {
  return cleanText(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripMarkup(value = "") {
  return decodeEntities(
    String(value || "")
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .replace(/<[^>]*>/g, " "),
  );
}

function firstTag(block = "", tagNames = []) {
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
    const match = block.match(re);
    if (match) return stripMarkup(match[1]);
  }
  return "";
}

function linkFromBlock(block = "") {
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (atom) return decodeEntities(atom[1]);
  return firstTag(block, ["link"]);
}

function parseRssProofItems(xml = "", { feed = {}, maxItems = 12 } = {}) {
  const items = [];
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(String(xml || ""))) !== null && items.length < maxItems) {
    const block = match[1];
    const title = firstTag(block, ["title"]);
    const url = linkFromBlock(block);
    if (!title || !url) continue;
    items.push({
      title,
      url,
      source_name: cleanText(feed.name) || "RSS",
      feed_url: cleanText(feed.url),
      description: firstTag(block, ["description", "summary", "content"]),
      timestamp: firstTag(block, ["pubDate", "published", "updated"]) || new Date().toISOString(),
    });
  }
  return items;
}

function stableRssId(item = {}) {
  const hash = crypto
    .createHash("sha256")
    .update(`${item.url || ""}|${item.title || ""}`)
    .digest("hex")
    .slice(0, 16);
  return `rss_${hash}`;
}

function isGamingProofItem(item = {}) {
  const text = `${item.title || ""} ${item.description || ""}`;
  if (/\beverything announced at\b|\ba packed day of game reveals\b|\bonly one games subscription service\b/i.test(text)) {
    return false;
  }
  if (/\btoday[’']?s top deals\b|\btop deals\b/i.test(text)) return false;
  if (/\b(?:dashcam|home gym|weight bench|memorial day sale|oled tv)\b/i.test(text)) {
    return /\b(?:xbox|playstation|nintendo|switch|steam|pc gaming|controller|headset|pokemon|star fox)\b/i.test(text);
  }
  return /\b(?:game|gaming|xbox|playstation|ps5|nintendo|switch|steam|pc gamer|pcgaming|trailer|gameplay|review|score|console|controller|headset|pokemon|destiny|bungie|warhammer|star fox|roguelike|rpg|fps)\b/i.test(text);
}

function titleSubjectFallback(title = "") {
  const clean = cleanText(title)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/&#039;/g, "'")
    .replace(/\s+\|\s+.*$/g, "")
    .replace(/\s+-\s+(?:IGN|GameSpot|Eurogamer|PC Gamer|Polygon|Kotaku|Rock Paper Shotgun).*$/i, "");
  const special = [
    [/\bWarhammer 40,?000:\s*Dawn of War IV\b/i, "Warhammer 40,000: Dawn of War IV"],
    [/\bParanormal Activity\b/i, "Paranormal Activity"],
    [/\bPS Plus\b|\bPlayStation Plus\b/i, "PlayStation Plus"],
    [/\bSplinter Cell\b/i, "Splinter Cell"],
    [/\bHelldivers 2\b/i, "Helldivers 2"],
    [/\bResident Evil\b/i, "Resident Evil"],
    [/\b007 First Light\b|\bJames Bond\b/i, "007 First Light"],
    [/\bXbox\b/i, "Xbox"],
  ];
  for (const [pattern, subject] of special) {
    if (pattern.test(clean)) return subject;
  }
  const known = clean.match(
    /\b(?:Assassin's Creed Black Flag|Epic Games Store|Nintendo Switch 2|Steam Deck OLED|PlayStation Plus|PlayStation|Xbox Series X\|S|Xbox|Destiny 2|Warhammer 40,000 Boltgun 2|Boltgun 2|Hades II|Star Fox|Pokemon|Pokémon|Bungie)\b/i,
  );
  if (known) return known[0];
  const beforeVerb = clean
    .replace(
      /\s+\b(?:just|gets?|got|has|have|is|are|will|walks|takes|drops|coming|launches?|reveals?|revealed|shows?|showed|announces?|announced|reportedly|might|could|would|says?)\b.*$/i,
      "",
    )
    .replace(/\s+(?:resynced\s+)?(?:director|creator|producer|developer|dev|lead)\b.*$/i, "")
    .trim();
  const candidate = beforeVerb || clean.split(/[-:]/)[0].trim();
  const words = candidate
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(?:save|expand|stream|grab|this|the|a|an|i)$/i.test(word))
    .slice(0, 5);
  return words.join(" ");
}

function subjectForItem(item = {}) {
  const manifest = buildStoryManifest({
    id: stableRssId(item),
    title: item.title,
    url: item.url,
    article_url: item.url,
    source_type: "rss",
    source_name: item.source_name,
  });
  const manifestSubject = cleanText(manifest.canonical_subject);
  const manifestSubjectIsBad =
    manifestSubject.split(/\s+/).length > 5 ||
    /^(?:everything|it's not|the big|a packed day|honestly difficult|only one games subscription|xbox hires)\b/i.test(
      manifestSubject,
    ) ||
    /\bnext legendary warbond\b/i.test(manifestSubject);
  const subject = manifestSubject &&
    manifestSubject !== "This story" &&
    !manifestSubjectIsBad &&
    !/\b(?:director|creator|producer|developer|dev|lead)\b/i.test(manifestSubject) &&
    !/^here\b/i.test(manifestSubject)
    ? manifest.canonical_subject
    : titleSubjectFallback(item.title);
  return subject || "This story";
}

function thumbnailForSubject(subject = "") {
  return cleanText(subject).toUpperCase().split(/\s+/).slice(0, 3).join(" ");
}

function proofScriptForItem(item = {}) {
  const subject = subjectForItem(item);
  const source = cleanText(item.source_name) || "The source";
  const title = cleanText(item.title).replace(/\s+/g, " ");
  const claim = ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(title)
    ? /\b(?:hire|hiring|chief strategy|leadership|executive|officer)\b/i.test(title)
      ? `${subject} has made another leadership move`
      : `${subject} has a new update with player impact`
    : title;
  return cleanText(
    `${subject} just gave players the update they needed. ` +
      `${source} says ${claim}. ` +
      "That matters because it points to what players can buy, play or watch next, not just another vague rumour. " +
      "But the useful question is what changes for access, timing or platform plans once the official page catches up. " +
      `${PRIMARY_PULSE_CTA}.`,
  );
}

function buildRssProofStories(items = []) {
  return items.filter(isGamingProofItem).map((item) => {
    const subject = subjectForItem(item);
    return {
      id: stableRssId(item),
      title: item.title,
      url: item.url,
      article_url: item.url,
      primary_source_url: item.url,
      source_type: "rss",
      source_name: item.source_name,
      primary_source: item.source_name,
      subreddit: item.source_name,
      timestamp: item.timestamp,
      canonical_subject: subject,
      canonical_game: subject,
      suggested_title: `${subject} Has One Detail Players Should Notice`,
      suggested_thumbnail_text: thumbnailForSubject(subject),
      seo_description: item.description,
      full_script: proofScriptForItem(item),
      manual_caption_generated: true,
      clean_manual_captions: true,
    };
  });
}

async function fetchRssProofStories({ feeds = [], perFeed = 8, timeoutMs = 15000 } = {}) {
  const stories = [];
  for (const feed of feeds) {
    try {
      const response = await axios.get(feed.url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: timeoutMs,
        responseType: "text",
      });
      stories.push(...buildRssProofStories(parseRssProofItems(response.data, { feed, maxItems: perFeed })));
    } catch (error) {
      stories.push({
        id: `rss_fetch_failed_${stableRssId({ url: feed.url, title: feed.name }).slice(4)}`,
        title: `RSS fetch failed: ${feed.name}`,
        source_type: "rss_fetch_error",
        source_name: feed.name,
        url: feed.url,
        fetch_error: error.message,
      });
    }
  }
  const seen = new Set();
  return stories.filter((story) => {
    if (seen.has(story.id)) return false;
    seen.add(story.id);
    return story.source_type === "rss";
  });
}

module.exports = {
  buildRssProofStories,
  fetchRssProofStories,
  parseRssProofItems,
  _private: {
    isGamingProofItem,
    titleSubjectFallback,
  },
};
