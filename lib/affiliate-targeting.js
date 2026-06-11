"use strict";

const DEFAULT_MAX_LINKS = 4;
const AMAZON_ASSOCIATE_DISCLOSURE =
  "As an Amazon Associate I earn from qualifying purchases.";

const PLATFORM_RULES = [
  {
    id: "ps5",
    match: /\b(?:ps5|playstation\s*5|playstation)\b/i,
    links: [
      { label: "PlayStation 5 games", query: "PlayStation 5 games", category: "games" },
      { label: "DualSense controller", query: "PS5 DualSense controller", category: "controller" },
      { label: "PS5 storage upgrade", query: "PS5 SSD storage upgrade", category: "storage" },
    ],
  },
  {
    id: "xbox",
    match: /\b(?:xbox|series\s*x|series\s*s|game\s*pass)\b/i,
    links: [
      { label: "Xbox games", query: "Xbox Series X games", category: "games" },
      { label: "Xbox controller", query: "Xbox wireless controller", category: "controller" },
      { label: "Xbox storage card", query: "Xbox storage expansion card", category: "storage" },
    ],
  },
  {
    id: "switch2",
    match: /\b(?:switch\s*2|nintendo\s*switch\s*2)\b/i,
    links: [
      { label: "Nintendo Switch 2 games", query: "Nintendo Switch 2 games", category: "games" },
      { label: "Switch 2 accessories", query: "Nintendo Switch 2 accessories", category: "accessories" },
      { label: "Nintendo controllers", query: "Nintendo Switch controller", category: "controller" },
    ],
  },
  {
    id: "switch",
    match: /\b(?:nintendo|switch)\b/i,
    links: [
      { label: "Nintendo Switch games", query: "Nintendo Switch games", category: "games" },
      { label: "Switch accessories", query: "Nintendo Switch accessories", category: "accessories" },
      { label: "Nintendo controller", query: "Nintendo Switch Pro Controller", category: "controller" },
    ],
  },
  {
    id: "pc",
    match: /\b(?:pc|steam|steam\s*deck|windows)\b/i,
    links: [
      { label: "PC gaming gear", query: "PC gaming accessories", category: "accessories" },
      { label: "Gaming mouse", query: "gaming mouse", category: "peripheral" },
      { label: "NVMe game storage", query: "NVMe SSD gaming", category: "storage" },
    ],
  },
];

const FRANCHISE_RULES = [
  {
    id: "pokemon-go",
    match: /\b(?:pokemon|pok[e\u00e9]mon)\s+go\b/i,
    links: [
      { label: "Pok\u00e9mon Go Plus+", query: "Pokemon Go Plus Plus", category: "accessory" },
      { label: "Pok\u00e9mon TCG", query: "Pokemon TCG booster box", category: "merch" },
      { label: "Mobile power bank", query: "portable power bank phone", category: "accessory" },
    ],
  },
  {
    id: "pokemon",
    match: /\b(?:pokemon|pok[e\u00e9]mon)\b/i,
    links: [
      { label: "Pok\u00e9mon games", query: "Pokemon Nintendo Switch game", category: "game" },
      { label: "Pok\u00e9mon TCG", query: "Pokemon TCG booster box", category: "merch" },
      { label: "Pok\u00e9mon merch", query: "Pokemon merchandise", category: "merch" },
    ],
  },
  {
    id: "gta",
    match: /\b(?:gta|grand\s+theft\s+auto)\b/i,
    links: [
      { label: "Grand Theft Auto games", query: "Grand Theft Auto PS5 Xbox", category: "game" },
      { label: "Open-world gaming headset", query: "gaming headset PS5 Xbox", category: "headset" },
      { label: "PS5 controller", query: "PS5 DualSense controller", category: "controller" },
    ],
  },
  {
    id: "call-of-duty",
    match: /\b(?:call\s+of\s+duty|black\s+ops|warzone|cod)\b/i,
    links: [
      { label: "Call of Duty games", query: "Call of Duty PS5 Xbox", category: "game" },
      { label: "FPS headset", query: "gaming headset fps", category: "headset" },
      { label: "Pro controller", query: "pro controller PS5 Xbox", category: "controller" },
    ],
  },
  {
    id: "battlefield",
    match: /\bbattlefield\b/i,
    links: [
      { label: "Battlefield games", query: "Battlefield PS5 Xbox", category: "game" },
      { label: "FPS headset", query: "gaming headset fps", category: "headset" },
      { label: "Gaming keyboard", query: "gaming keyboard mechanical", category: "peripheral" },
    ],
  },
  {
    id: "elden-ring",
    match: /\belden\s+ring\b/i,
    links: [
      { label: "Elden Ring", query: "Elden Ring PS5 Xbox", category: "game" },
      { label: "Elden Ring merch", query: "Elden Ring merchandise", category: "merch" },
      { label: "RPG headset", query: "gaming headset RPG", category: "headset" },
    ],
  },
  {
    id: "zelda",
    match: /\b(?:zelda|tears\s+of\s+the\s+kingdom|breath\s+of\s+the\s+wild)\b/i,
    links: [
      { label: "Zelda games", query: "Legend of Zelda Nintendo Switch", category: "game" },
      { label: "Zelda merch", query: "Legend of Zelda merchandise", category: "merch" },
      { label: "Switch controller", query: "Nintendo Switch Pro Controller", category: "controller" },
    ],
  },
  {
    id: "mario",
    match: /\b(?:mario|mario\s+kart|super\s+mario)\b/i,
    links: [
      { label: "Mario games", query: "Super Mario Nintendo Switch", category: "game" },
      { label: "Mario merch", query: "Super Mario merchandise", category: "merch" },
      { label: "Switch controller", query: "Nintendo Switch Pro Controller", category: "controller" },
    ],
  },
  {
    id: "minecraft",
    match: /\bminecraft\b/i,
    links: [
      { label: "Minecraft", query: "Minecraft Nintendo Switch Xbox", category: "game" },
      { label: "Minecraft LEGO", query: "LEGO Minecraft", category: "merch" },
      { label: "Kids gaming headset", query: "kids gaming headset", category: "headset" },
    ],
  },
  {
    id: "resident-evil",
    match: /\bresident\s+evil\b/i,
    links: [
      { label: "Resident Evil games", query: "Resident Evil PS5 Xbox", category: "game" },
      { label: "Horror gaming headset", query: "gaming headset surround sound", category: "headset" },
      { label: "Resident Evil merch", query: "Resident Evil merchandise", category: "merch" },
    ],
  },
  {
    id: "final-fantasy",
    match: /\bfinal\s+fantasy\b/i,
    links: [
      { label: "Final Fantasy games", query: "Final Fantasy PS5", category: "game" },
      { label: "Final Fantasy merch", query: "Final Fantasy merchandise", category: "merch" },
      { label: "RPG headset", query: "gaming headset RPG", category: "headset" },
    ],
  },
  {
    id: "fortnite",
    match: /\bfortnite\b/i,
    links: [
      { label: "Fortnite V-Bucks card", query: "Fortnite V-Bucks gift card", category: "game-credit" },
      { label: "Fortnite merch", query: "Fortnite merchandise", category: "merch" },
      { label: "Battle royale headset", query: "gaming headset microphone", category: "headset" },
    ],
  },
  {
    id: "steam-deck",
    match: /\bsteam\s*deck\b/i,
    links: [
      { label: "Steam Deck dock", query: "Steam Deck dock", category: "accessory" },
      { label: "Steam Deck case", query: "Steam Deck case", category: "accessory" },
      { label: "Steam Deck storage", query: "microSD card Steam Deck", category: "storage" },
    ],
  },
];

const CONTEXT_RULES = [
  {
    id: "subscription",
    match: /\b(?:ps\s*plus|playstation\s+plus|game\s*pass|nintendo\s+switch\s+online)\b/i,
    links: [
      { label: "Gaming gift cards", query: "gaming gift card", category: "game-credit" },
      { label: "Extra controller", query: "gaming controller", category: "controller" },
    ],
  },
  {
    id: "vr",
    match: /\b(?:vr|psvr|ps\s*vr|quest\s*3|virtual\s+reality)\b/i,
    links: [
      { label: "VR headset", query: "VR headset gaming", category: "hardware" },
      { label: "VR accessories", query: "VR accessories", category: "accessories" },
    ],
  },
  {
    id: "racing",
    match: /\b(?:forza|gran\s+turismo|racing|f1\s*\d*)\b/i,
    links: [
      { label: "Racing wheel", query: "racing wheel PS5 Xbox PC", category: "peripheral" },
      { label: "Racing seat", query: "gaming racing seat", category: "peripheral" },
    ],
  },
];

function storyText(story = {}) {
  return [
    story.title,
    story.suggested_title,
    story.selected_title,
    story.short_title,
    story.canonical_title,
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.game_name,
    story.suggested_thumbnail_text,
    story.hook,
    story.body,
    story.full_script,
    story.company_name,
    story.subreddit,
  ]
    .filter(Boolean)
    .join(" ");
}

function cleanOfferText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/[^\w\s:'+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactGameTitle(value) {
  const cleaned = cleanOfferText(value)
    .replace(/\s*:\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
}

function explicitGameTitleFromStory(story = {}) {
  const direct = [
    story.canonical_game,
    story.game_title,
    story.game_name,
    story.canonical_subject,
  ]
    .map(compactGameTitle)
    .find((value) => value && !genericSubject(value));
  if (direct) return direct;

  const title = cleanOfferText(
    story.selected_title ||
      story.short_title ||
      story.canonical_title ||
      story.title ||
      story.suggested_title,
  );
  if (!title) return "";

  const tokens = title.split(/\s+/);
  const out = [];
  const stop = /^(?:xbox|playstation|ps5|ps4|nintendo|switch|pc|steam|trailer|gameplay|reveal|reveals|revealed|release|released|launch|launches|date|dates|demo|dlc|edition|editions|preorder|pre-order|price|deal|sale|review|preview|leak|leaks|leaked|rumour|rumor|report|reports|reported|says|shows|showed|turns|makes|gets|has|is|are|just|finally|confirms|confirmed|announced|returns|puts|starts|ends|gives|could|might|will|new|free)$/i;

  for (const token of tokens) {
    const cleaned = token.replace(/^[^\w]+|[^\w:+-]+$/g, "");
    if (!cleaned) continue;
    if (out.length >= 2 && stop.test(cleaned)) break;
    if (out.length === 0 && stop.test(cleaned)) return "";
    out.push(cleaned.replace(/:$/, ""));
    if (out.length >= 6) break;
  }

  const candidate = compactGameTitle(out.join(" "));
  return genericSubject(candidate) ? "" : candidate;
}

function genericSubject(value) {
  return /^(?:xbox|playstation|ps5|ps4|nintendo|switch|pc|steam|gaming|game|games|trailer|story|news)$/i.test(
    String(value || "").trim(),
  );
}

function detectedPlatforms(text) {
  const haystack = String(text || "");
  const platforms = [];
  const add = (id, label, queryTerm) => {
    if (!platforms.some((item) => item.id === id)) platforms.push({ id, label, queryTerm });
  };
  if (/\b(?:xbox|series\s*x|series\s*s|game\s*pass)\b/i.test(haystack)) add("xbox", "Xbox", "Xbox");
  if (/\b(?:ps5|playstation\s*5)\b/i.test(haystack)) add("ps5", "PS5", "PS5");
  else if (/\bplaystation\b/i.test(haystack)) add("playstation", "PlayStation", "PlayStation");
  if (/\b(?:switch\s*2|nintendo\s*switch\s*2)\b/i.test(haystack)) add("switch2", "Switch 2", "Nintendo Switch 2");
  else if (/\b(?:nintendo|switch)\b/i.test(haystack)) add("switch", "Switch", "Nintendo Switch");
  if (/\b(?:pc|steam|steam\s*deck|windows)\b/i.test(haystack)) add("pc", "PC", "PC");
  return platforms;
}

function hasStorySpecificCommercialContext(text) {
  return /\b(?:trailer|gameplay|release|launch|date|edition|editions|preorder|pre-order|pre order|price|deal|sale|discount|physical|digital|collector|deluxe|standard|dlc|expansion|demo|wishlist|store|steam|game\s*pass|ps5|playstation|xbox|nintendo|switch|pc)\b/i.test(
    String(text || ""),
  );
}

function amazonSearchUrl(query, tag) {
  const safeTag = String(tag || "placeholder").trim() || "placeholder";
  return `https://www.amazon.co.uk/s?k=${encodeURIComponent(query)}&tag=${encodeURIComponent(safeTag)}`;
}

function normaliseAffiliateUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAmazonUk =
    hostname === "www.amazon.co.uk" || hostname === "amazon.co.uk";
  if (parsed.protocol !== "https:" || !isAmazonUk) return null;
  if (!parsed.searchParams.get("tag")) return null;

  return parsed.toString();
}

function addLinks(out, seenQueries, links, tag, reason) {
  for (const link of links) {
    const query = String(link.query || "").trim();
    if (!query) continue;
    const key = query.toLowerCase();
    if (seenQueries.has(key)) continue;
    seenQueries.add(key);
    out.push({
      label: link.label || query,
      query,
      url: amazonSearchUrl(query, tag),
      category: link.category || "related",
      reason,
      specificity: link.specificity || "contextual_search",
      confidence: Number.isFinite(link.confidence) ? link.confidence : 60,
      exact_product_claim: link.exact_product_claim === true,
    });
  }
}

function buildStorySpecificLinks(story, tag) {
  const text = storyText(story);
  if (!hasStorySpecificCommercialContext(text)) return [];
  const gameTitle = explicitGameTitleFromStory(story);
  if (!gameTitle) return [];
  const platforms = detectedPlatforms(text);
  const targets = platforms.length
    ? platforms.slice(0, 2).map((platform) => ({
        label: `${gameTitle} on ${platform.label}`,
        query: `${gameTitle} ${platform.queryTerm}`,
        category: "game",
        platform: platform.id,
        confidence: 86,
      }))
    : [
        {
          label: `${gameTitle} game`,
          query: `${gameTitle} game`,
          category: "game",
          platform: null,
          confidence: 74,
        },
      ];

  const out = [];
  const seen = new Set();
  addLinks(
    out,
    seen,
    targets.map((target) => ({
      ...target,
      specificity: platforms.length ? "story_platform_search" : "story_game_search",
      exact_product_claim: false,
    })),
    tag,
    `story_game:${gameTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
  );
  return out;
}

function buildAffiliateStack(story, opts = {}) {
  const tag = opts.tag || process.env.AMAZON_AFFILIATE_TAG || "placeholder";
  const maxLinks = Math.max(1, Number(opts.maxLinks) || DEFAULT_MAX_LINKS);
  const text = storyText(story);
  const links = [];
  const seenQueries = new Set();
  const storySpecificLinks = buildStorySpecificLinks(story, tag);
  for (const link of storySpecificLinks) {
    const key = link.query.toLowerCase();
    seenQueries.add(key);
    links.push(link);
  }

  for (const rule of FRANCHISE_RULES) {
    if (rule.match.test(text)) {
      addLinks(links, seenQueries, rule.links, tag, `franchise:${rule.id}`);
      break;
    }
  }

  for (const rule of PLATFORM_RULES) {
    if (rule.match.test(text)) {
      const platformLinks = storySpecificLinks.length
        ? rule.links.filter((link) => link.category !== "games")
        : rule.links;
      addLinks(links, seenQueries, platformLinks, tag, `platform:${rule.id}`);
      break;
    }
  }

  for (const rule of CONTEXT_RULES) {
    if (rule.match.test(text)) {
      addLinks(links, seenQueries, rule.links, tag, `context:${rule.id}`);
      break;
    }
  }

  if (links.length === 0) {
    addLinks(
      links,
      seenQueries,
      [
        { label: "Gaming deals", query: "video game deals", category: "game" },
        { label: "Gaming headset", query: "gaming headset", category: "headset" },
      ],
      tag,
      "fallback:gaming",
    );
  }

  return links.slice(0, maxLinks);
}

function formatStorySource(story = {}) {
  const source = story.subreddit || story.source_type || "source";
  if (story.source_type === "reddit" && story.subreddit) return `r/${story.subreddit}`;
  if (/^r\//i.test(source)) return source;
  return source;
}

function buildPinnedComment(story, affiliateLinks) {
  const links = normaliseAffiliateLinks({ affiliate_links: affiliateLinks }).slice(0, 3);
  const related = links.length
    ? links.map((link) => `${link.label}: ${link.url}`).join(" | ")
    : "";
  const source = formatStorySource(story);
  return [
    links.length ? AMAZON_ASSOCIATE_DISCLOSURE : "",
    related,
    `Source: ${source}`,
    "Verified gaming news daily",
  ]
    .filter(Boolean)
    .join(" | ");
}

function affiliateDisclosureForLinks(links = []) {
  return normaliseAffiliateLinks({ affiliate_links: links }).length
    ? AMAZON_ASSOCIATE_DISCLOSURE
    : "";
}

function normaliseAffiliateLinks(story = {}) {
  if (Array.isArray(story.affiliate_links)) {
    return story.affiliate_links
      .map((link) => {
        const url = normaliseAffiliateUrl(link && link.url);
        if (!url) return null;
        return {
          label: link.label || story.affiliate_primary_label || "Related",
          url,
          category: link.category || "related",
        };
      })
      .filter(Boolean);
  }
  const legacyUrl = normaliseAffiliateUrl(story.affiliate_url);
  if (legacyUrl) {
    return [
      {
        label: story.affiliate_primary_label || "Related",
        url: legacyUrl,
        category: "related",
      },
    ];
  }
  return [];
}

module.exports = {
  DEFAULT_MAX_LINKS,
  AMAZON_ASSOCIATE_DISCLOSURE,
  amazonSearchUrl,
  buildAffiliateStack,
  buildPinnedComment,
  affiliateDisclosureForLinks,
  formatStorySource,
  normaliseAffiliateUrl,
  normaliseAffiliateLinks,
  buildStorySpecificLinks,
  storyText,
};
