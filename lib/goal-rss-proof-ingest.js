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

function attributesFromTag(tagText = "") {
  const out = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(String(tagText || ""))) !== null) {
    out[String(match[1] || "").toLowerCase()] = decodeEntities(match[2] || match[3] || "");
  }
  return out;
}

function linkFromBlock(block = "") {
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (atom) return decodeEntities(atom[1]);
  return firstTag(block, ["link"]);
}

function directMediaFromBlock(block = "") {
  const candidates = [];
  const tagRe = /<(enclosure|media:content|media:player|content)[^>]*>/gi;
  let match;
  while ((match = tagRe.exec(String(block || ""))) !== null) {
    const attrs = attributesFromTag(match[0]);
    const url = cleanText(attrs.url || attrs.href || attrs.src);
    if (!url) continue;
    const type = cleanText(attrs.type || attrs.medium || "");
    const materializable =
      /\.(?:mp4|mov|m4v|webm|m3u8|mpd)(?:[?#]|$)/i.test(url) ||
      /^video\//i.test(type) ||
      /\bvideo\b/i.test(type);
    if (!materializable) continue;
    candidates.push({
      direct_media_url: url,
      direct_media_url_if_available: url,
      source_type: match[1].toLowerCase() === "enclosure" ? "rss_video_enclosure" : "rss_media_content",
      mime_type: type || null,
    });
  }
  return candidates;
}

function parseRssProofItems(xml = "", {
  feed = {},
  maxItems = 12,
  offsetItems = 0,
} = {}) {
  const items = [];
  const offset = Math.max(0, Number(offsetItems || 0));
  let validItemIndex = 0;
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(String(xml || ""))) !== null && items.length < maxItems) {
    const block = match[1];
    const title = firstTag(block, ["title"]);
    const url = linkFromBlock(block);
    if (!title || !url) continue;
    if (validItemIndex < offset) {
      validItemIndex += 1;
      continue;
    }
    validItemIndex += 1;
    items.push({
      title,
      url,
      source_name: cleanText(feed.name) || "RSS",
      feed_url: cleanText(feed.url),
      description: firstTag(block, ["description", "summary", "content"]),
      timestamp: firstTag(block, ["pubDate", "published", "updated"]) || new Date().toISOString(),
      direct_media_candidates: directMediaFromBlock(block),
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

function isWeakFreshBufferStory(text = "") {
  const clean = cleanText(text);
  if (/\bshare of the week\b|\bpsshare\b|\bcommunity screenshots?\b/i.test(clean)) {
    return true;
  }
  if (/\bnext week on xbox\b|\bnew games for (?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i.test(clean)) {
    return true;
  }
  if (/\bbest\s+(?:ps5|xbox|switch|pc|fantasy|rpg|horror|co-?op|free|game pass)?\s*games\b/i.test(clean)) {
    return true;
  }
  if (/\b(?:evergreen|regularly updated)\s+list\b|\bour\s+(?:list|roundup)\s+of\b/i.test(clean)) {
    return true;
  }
  if (/\b(?:ex-?|former)\s*(?:ai\s+)?(?:boss|head|exec|executive)\b[\s\S]{0,120}\bgenerative ai\b/i.test(clean)) {
    return true;
  }
  if (/\b(?:official\s+playstation\s+podcast|podcast\s+episode|episode\s+\d{2,})\b/i.test(clean)) {
    return true;
  }
  return false;
}

function isGamingProofItem(item = {}) {
  const text = `${item.title || ""} ${item.description || ""}`;
  if (isWeakFreshBufferStory(text)) return false;
  if (/\beverything announced at\b|\ba packed day of game reveals\b|\bonly one games subscription service\b/i.test(text)) {
    return false;
  }
  if (/\btoday[’']?s top deals\b|\btop deals\b/i.test(text)) return false;
  if (/\b(?:dashcam|home gym|weight bench|memorial day sale|oled tv)\b/i.test(text)) {
    return /\b(?:xbox|playstation|nintendo|switch|steam|pc gaming|controller|headset|pokemon|star fox)\b/i.test(text);
  }
  return /\b(?:game|gaming|xbox|playstation|ps5|nintendo|switch|steam|pc gamer|pcgaming|trailer|gameplay|review|score|console|controller|headset|pokemon|destiny|bungie|warhammer|star fox|roguelike|rpg|fps|007 first light|james bond|valor mortis|crimson desert|runescape|dragonwilds|until dawn|shadow of the colossus|sea of thieves|granblue fantasy|relink|ghost at dawn|end of abyss|guild wars 3|pubg)\b/i.test(text);
}

function titleSubjectFallback(title = "") {
  const clean = cleanText(title)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/&#039;/g, "'")
    .replace(/\s+\|\s+.*$/g, "")
    .replace(/\s+-\s+(?:IGN|GameSpot|Eurogamer|PC Gamer|Polygon|Kotaku|Rock Paper Shotgun).*$/i, "");
  const special = [
    [/\bCastlevania:\s*Belmont(?:'|â€™|\u2019)?s Curse\b/i, "Castlevania: Belmont's Curse"],
    [/\bWarhammer 40,?000:\s*Dawn of War IV\b/i, "Warhammer 40,000: Dawn of War IV"],
    [/\bParanormal Activity\b/i, "Paranormal Activity"],
    [/\bPS Plus\b|\bPlayStation Plus\b/i, "PlayStation Plus"],
    [/\bSplinter Cell\b/i, "Splinter Cell"],
    [/\bHelldivers 2\b/i, "Helldivers 2"],
    [/\bResident Evil\b/i, "Resident Evil"],
    [/\bDune:?\s*Awakening\b/i, "Dune: Awakening"],
    [/\b007 First Light\b|\bJames Bond\b/i, "007 First Light"],
    [/\bValor Mortis\b/i, "Valor Mortis"],
    [/\bCrimson Desert\b/i, "Crimson Desert"],
    [/\bRuneScape:\s*Dragonwilds\b|\bDragonwilds\b/i, "RuneScape: Dragonwilds"],
    [/\bShadow of the Colossus\b/i, "Shadow of the Colossus"],
    [/\bUntil Dawn\b/i, "Until Dawn"],
    [/\bForza Horizon 6\b/i, "Forza Horizon 6"],
    [/\bGTA\s*5\b|\bGrand Theft Auto V\b/i, "GTA 5"],
    [/\bPath of Exile 2\b/i, "Path of Exile 2"],
    [/\bSteam Controller\b/i, "Steam Controller"],
    [/\bPUBG\b/i, "PUBG"],
    [/\bSea of Thieves\b/i, "Sea of Thieves"],
    [/\bGranblue Fantasy:?\s*Relink\b/i, "Granblue Fantasy: Relink"],
    [/\bGhost at Dawn\b/i, "Ghost at Dawn"],
    [/\bEnd of Abyss\b/i, "End of Abyss"],
    [/\bGuild Wars 3\b/i, "Guild Wars 3"],
    [/\bXbox\b/i, "Xbox"],
  ];
  for (const [pattern, subject] of special) {
    if (pattern.test(clean)) return subject;
  }
  const versionedGame = clean.match(
    /\bin\s+([A-Z][A-Za-z0-9:'-]+(?:\s+[A-Z][A-Za-z0-9:'-]+){0,3})\s+V\d+(?:\.\d+)*\b/,
  );
  if (versionedGame?.[1]) return versionedGame[1];
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

function sourceFamilySlug(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "rss";
}

function leadForItem({ subject = "", title = "" } = {}) {
  if (/\bquick resume|disable\b/i.test(title) && /Forza/i.test(title)) {
    return "Forza Horizon 6 has a launch problem Xbox players will feel immediately.";
  }
  if (/\bdelay|delayed|shifting|release date|avoid September|escape\b/i.test(title)) {
    return `${subject} just blinked in one of the year's most crowded release windows.`;
  }
  if (/\bsales|copies|milestone|demand|passes\b/i.test(title)) {
    return `${subject} just put a hard number behind its momentum.`;
  }
  if (/\bpreview|hands[- ]on|best part|boring stuff|gameplay\b/i.test(title)) {
    return `${subject} is making its strangest pitch the part players might remember.`;
  }
  if (/\bsubscription|joins\b/i.test(title)) {
    return `${subject} just became a value test, not just a catalogue listing.`;
  }
  if (/\bcharacters|look cursed|remake|movie\b/i.test(title)) {
    return `${subject} has a visual problem players are going to notice fast.`;
  }
  if (/\bsearch|secret|creator|director|responds\b/i.test(title)) {
    return `${subject} just turned an old fan mystery into a fresh conversation.`;
  }
  if (/\bupdate|patch|content\b/i.test(title)) {
    return `${subject} just added one more reason for players to check back in.`;
  }
  return `${subject} just picked up a player-facing detail worth watching.`;
}

function stakesForItem({ subject = "", title = "" } = {}) {
  if (/\bquick resume|disable\b/i.test(title) && /Forza/i.test(title)) {
    return "That is the kind of bug that turns a big launch into a support-thread story, because Quick Resume is supposed to make Xbox feel frictionless.";
  }
  if (/\bdelay|delayed|shifting|release date|avoid September|escape\b/i.test(title)) {
    return "Short delays normally sound boring, but this one says the calendar itself is now a threat.";
  }
  if (/\bsales|copies|milestone|demand|passes\b/i.test(title)) {
    return "The useful part is not the bragging rights. It is whether that demand survives after launch-week curiosity fades.";
  }
  if (/\bpreview|hands[- ]on|best part|boring stuff|gameplay\b/i.test(title)) {
    return "That matters because the best short-form stories are not just reveal trailers. They are the tiny design choices people can picture instantly.";
  }
  if (/\bsubscription|joins\b/i.test(title)) {
    return "The interesting question is whether this adds real value for players, or just gives a familiar game another place to sit.";
  }
  if (/\bcharacters|look cursed|remake|movie\b/i.test(title)) {
    return "That is not cosmetic nitpicking. If the faces feel wrong, the whole adaptation starts with a trust problem.";
  }
  if (/\bsearch|secret|creator|director|responds\b/i.test(title)) {
    return "The pull is simple: some games keep people searching years after the credits, even when the answer might be nothing.";
  }
  if (/\bupdate|patch|content\b/i.test(title)) {
    return "The test is whether the update changes what players do next, or just becomes another note in a crowded feed.";
  }
  return "The important bit is whether this changes what people buy, play, wait for or skip.";
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
    `${leadForItem({ subject, title })} ` +
      `${source} says ${claim}. ` +
      `${stakesForItem({ subject, title })} ` +
      "That is the gap to watch now: hype is easy, but the player consequence has to show up on screen. " +
      `${PRIMARY_PULSE_CTA}.`,
  );
}

function buildRssProofStories(items = []) {
  return items.filter(isGamingProofItem).map((item) => {
    const subject = subjectForItem(item);
    const directMediaCandidates = (Array.isArray(item.direct_media_candidates)
      ? item.direct_media_candidates
      : []
    )
      .map((candidate) => {
        const directUrl = cleanText(
          candidate.direct_media_url || candidate.direct_media_url_if_available || candidate.url,
        );
        if (!directUrl) return null;
        return {
          direct_media_url: directUrl,
          direct_media_url_if_available: directUrl,
          source_type: candidate.source_type || "rss_video_enclosure",
          source_family: candidate.source_family || `rss_video_enclosure_${sourceFamilySlug(item.source_name)}`,
          source_url: item.url,
        };
      })
      .filter(Boolean);
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
      direct_media_candidates: directMediaCandidates,
      official_direct_media_candidates: directMediaCandidates,
      approved_direct_media_url: directMediaCandidates[0]?.direct_media_url || undefined,
      direct_media_url_if_available: directMediaCandidates[0]?.direct_media_url || undefined,
    };
  });
}

async function fetchRssProofStories({
  feeds = [],
  perFeed = 8,
  offsetPerFeed = 0,
  timeoutMs = 15000,
} = {}) {
  const stories = [];
  for (const feed of feeds) {
    try {
      const response = await axios.get(feed.url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: timeoutMs,
        responseType: "text",
      });
      stories.push(...buildRssProofStories(parseRssProofItems(response.data, {
        feed,
        maxItems: perFeed,
        offsetItems: offsetPerFeed,
      })));
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
