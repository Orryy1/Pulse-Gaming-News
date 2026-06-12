"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoalProofPackage,
  writeGoalProofPackageArtifacts,
} = require("./goal-proof-package");
const { PRIMARY_PULSE_CTA } = require("./pulse-cta");
const { sourceNameFromUrl } = require("./source-bound-script-writer");
const { buildStoryManifest } = require("./public-output-manifest");
const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const {
  isGeneratedMotionAsset,
  isRealMediaAsset,
} = require("./visual-evidence-classifier");
const ADVERTISER_UNFRIENDLY_PUBLIC_RE =
  /\b(?:porn|pornography|gambling|casino|betting|wagering)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanId(value) {
  return String(value || "story")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "story";
}

function hostFromUrl(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isRedditUrl(url) {
  return /(?:^|\.)redd(?:it\.com|\.it)$/i.test(hostFromUrl(url));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanObjectText(value, keys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of keys) {
    const candidate = cleanText(value[key]);
    if (candidate) return candidate;
  }
  return "";
}

function sourceValueUrl(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return cleanObjectText(value, ["url", "href", "source_url", "article_url", "canonical_url"]);
}

function sourceValueName(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return cleanText(value);
  const named = cleanObjectText(value, ["name", "label", "source_name", "publisher", "outlet"]);
  return named || sourceNameFromUrl(sourceValueUrl(value));
}

function subjectLooksGeneric(value = "") {
  const clean = cleanText(value);
  if (!clean) return true;
  if (/^(?:this|the)\s+(?:story|game|update|headline)$/i.test(clean)) return true;
  if (/^(?:source|story|update|headline)$/i.test(clean)) return true;
  return false;
}

function titleCaseEntity(value = "") {
  return cleanText(value)
    .split(/\s+/)
    .map((word) => {
      if (/^(?:ii|iii|iv|vi|ps5|ps4|pc|vr|rpg|fps|dlc|xbox)$/i.test(word)) {
        return word.toUpperCase() === "XBOX" ? "Xbox" : word.toUpperCase();
      }
      if (/^40,?000$/i.test(word)) return "40,000";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/\bPsn\b/g, "PSN")
    .replace(/\bPc\b/g, "PC")
    .trim();
}

function subjectFromTitle(title = "") {
  const clean = cleanText(title);
  if (!clean) return "";
  if (/\bhalo\s+remake\b/i.test(clean)) return "Halo: Campaign Evolved";
  const known = clean.match(
    /\b(Dragon['’]s\s+Dogma\s+2|Gears\s+Of\s+War:?\s*E[- ]Day|The\s+Elder\s+Scrolls\s+6|Halo:\s*Campaign\s+Evolved|Quake\s+Champions|RuneScape:\s*Dragonwilds|Mario\s+Kart\s+World|Valorant|Hades\s+II|Helldivers\s+2|Forza\s+Horizon\s+6|PlayStation\s+Plus|PlayStation|Xbox|Nintendo|Steam|Valve|Riot|Warhammer\s+40,?000|Boltgun\s+2|Subnautica\s+2|GTA\s+6|GTA\s+5|Assassin's\s+Creed(?:\s+Black\s+Flag)?|Black\s+Flag|Fable|Star\s+Fox|Final\s+Fantasy\s+7\s+Rebirth|Kingdom\s+Come|Destiny\s+2|Lego\s+Batman|Paranormal\s+Activity)\b/i,
  );
  if (known) return titleCaseEntity(known[1]);
  const possessive = clean.match(/^([A-Z][A-Za-z0-9'.:+&-]*(?:\s+[A-Z0-9][A-Za-z0-9'.:+&-]*){0,4})'s\b/);
  if (possessive) return titleCaseEntity(possessive[1]);
  const colon = clean.match(/^([A-Z][^:]{1,58}):\s+/);
  if (colon) return titleCaseEntity(colon[1]);
  const leading = clean.match(
    /^([A-Z][A-Za-z0-9'.:+&-]*(?:\s+[A-Z0-9][A-Za-z0-9'.:+&-]*){0,4})\s+(?:is|has|just|gets|get|getting|announces|announced|returns|drops|becomes|won't|will|may|can|looks|seems|already|developer|dev)\b/i,
  );
  if (leading && !/^(?:in|according|what|why|how|the|a|an)\b/i.test(leading[1])) {
    return titleCaseEntity(leading[1]);
  }
  return "";
}

function canonicalSubjectForProof(story = {}) {
  const manifestSubject = buildStoryManifest(story).canonical_subject;
  const titleSubject = cleanText(subjectFromTitle(story.title || story.suggested_title || story.public_title));
  const explicitSubject = cleanText(story.canonical_subject || story.canonical_game || story.game_title || story.primary_entity);
  if (
    titleSubject &&
    explicitSubject &&
    !subjectLooksGeneric(explicitSubject) &&
    titleSubject.length > explicitSubject.length &&
    containsSubject(titleSubject, explicitSubject)
  ) {
    return titleSubject;
  }
  const candidates = [
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.primary_entity,
    titleSubject,
    manifestSubject,
  ].map(cleanText);
  return candidates.find((candidate) => candidate && !subjectLooksGeneric(candidate)) || "This Game";
}

function storyUrl(story = {}) {
  return cleanText(
    story.article_url ||
      story.primary_source_url ||
      sourceValueUrl(story.primary_source) ||
      sourceValueUrl(story.source) ||
      story.linked_url ||
      story.url,
  );
}

function sourceBackedForProof(story = {}) {
  const sourceType = cleanText(story.source_type).toLowerCase();
  if (["rss", "official", "publisher", "storefront", "press_kit"].includes(sourceType)) return true;
  const url = storyUrl(story);
  return Boolean(/^https?:\/\//i.test(url) && !isRedditUrl(url));
}

function sourceNameForProof(story = {}) {
  return sourceValueName(story.primary_source) ||
    sourceValueName(story.source) ||
    cleanText(story.source_name || story.publisher || story.outlet) ||
    sourceNameFromUrl(storyUrl(story)) ||
    cleanText(story.subreddit) ||
    "Source";
}

function revenueManifestFor(pathRow = {}) {
  return pathRow.revenue_manifest ||
    pathRow.revenuePathManifest ||
    pathRow.manifest ||
    pathRow.full_manifest ||
    {};
}

function titleCaseSlugWord(word = "") {
  const clean = cleanText(word);
  if (!clean) return "";
  if (/^(?:xbox|nintendo|playstation|steam|pc|ps5|ps4|fps|rpg|dlc|vr|ai)$/i.test(clean)) {
    return clean.toUpperCase() === "PC" ? "PC" : clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function titleFromRouteSlug(route = "") {
  const cleanRoute = cleanText(route).split(/[?#]/)[0];
  const slug = cleanRoute
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/?p\//i, "")
    .split("/")
    .filter(Boolean)
    .pop();
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map(titleCaseSlugWord)
    .join(" ")
    .replace(/\bXbox S\b/g, "Xbox's")
    .replace(/\bPlaystation\b/g, "PlayStation")
    .replace(/\bGamepass\b/g, "Game Pass")
    .trim();
}

function revenueTitleLooksThin(title = "") {
  const clean = cleanText(title);
  if (!clean) return true;
  if (titleLooksGeneric(clean)) return true;
  const words = clean.split(/\s+/);
  if (words.length <= 3 && !/\b(?:review|leak|deal|sale|date|launch|patch|delist|lawsuit)\b/i.test(clean)) {
    return true;
  }
  return false;
}

function bestRevenueTitle(pathRow = {}) {
  const manifest = revenueManifestFor(pathRow);
  const candidates = [
    manifest.title,
    pathRow.public_title,
    pathRow.selected_title,
    pathRow.suggested_title,
    titleFromRouteSlug(manifest.landing_page?.route || pathRow.route),
    pathRow.title,
  ].map(cleanText);
  return candidates.find((title) => title && !revenueTitleLooksThin(title)) ||
    candidates.find(Boolean) ||
    cleanText(pathRow.story_id);
}

function revenueSourceLinks(pathRow = {}) {
  const manifest = revenueManifestFor(pathRow);
  return [
    ...asArray(pathRow.source_links),
    ...asArray(manifest.source_links),
    ...asArray(manifest.landing_page?.source_links),
  ].map((source) => ({
    label: cleanText(source.label || source.name || source.source_name),
    url: cleanText(source.url || source.source_url || source.href),
  })).filter((source) => /^https?:\/\//i.test(source.url));
}

function primaryRevenueSource(pathRow = {}) {
  const links = revenueSourceLinks(pathRow);
  const primary = links.find((source) => !isRedditUrl(source.url)) || links[0] || null;
  if (!primary) return { name: "", url: "", links };
  const sourceName = cleanText(primary.label) && !/^source$/i.test(primary.label)
    ? primary.label
    : sourceNameFromUrl(primary.url);
  return {
    name: cleanText(sourceName || "Source"),
    url: primary.url,
    links,
  };
}

function affiliateManifestFromRevenuePath(pathRow = {}) {
  const manifest = revenueManifestFor(pathRow);
  const primaryOffer = pathRow.primary_offer || manifest.offer_stack?.primary_offer || null;
  const disclosure = manifest.disclosure || {};
  const disclosureRequired = Boolean(primaryOffer || disclosure.required);
  return {
    story_id: cleanText(pathRow.story_id),
    vertical: "gaming",
    disclosure_required: disclosureRequired,
    primary_link: primaryOffer,
    fallback_links: asArray(manifest.offer_stack?.fallback_offers),
    disclosure_copy: disclosure.copy || (disclosureRequired
      ? {
          short: "Affiliate links may earn us a commission.",
          landing: "Affiliate links may earn us a commission.",
        }
      : null),
  };
}

function exactCtaCount(script = "") {
  const normalised = cleanText(script).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const cta = PRIMARY_PULSE_CTA.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  let count = 0;
  let index = normalised.indexOf(cta);
  while (index !== -1) {
    count += 1;
    index = normalised.indexOf(cta, index + cta.length);
  }
  return count;
}

function ensurePulseCta(script = "") {
  let text = cleanText(script)
    .replace(/\bFollow Pulse Gaming so you never miss a drop\.?/gi, "")
    .replace(/\bFollow for the gaming stories behind the headline\.?/gi, "")
    .replace(/\bFollow Pulse Gaming for the gaming stories behind the headline\.?/gi, "")
    .trim();
  if (!text) return "";
  if (exactCtaCount(text) > 1) {
    const first = text.toLowerCase().indexOf(PRIMARY_PULSE_CTA.toLowerCase());
    text = text.slice(0, first).trim();
  }
  if (exactCtaCount(text) === 0) {
    text = `${text.replace(/[.\s]*$/, ".")} ${PRIMARY_PULSE_CTA}.`;
  }
  return cleanText(text);
}

function firstSentence(text = "") {
  return (cleanText(text).match(/[^.!?]+[.!?]?/) || [""])[0].trim();
}

function normaliseForSubject(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsSubject(value, subject) {
  const haystack = normaliseForSubject(value);
  const needle = normaliseForSubject(subject);
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;
  const first = needle.split(/\s+/).find((part) => part.length >= 4);
  return Boolean(first && haystack.includes(first));
}

function containsDistinctiveSubjectToken(value, subject) {
  const haystack = normaliseForSubject(value);
  const tokens = normaliseForSubject(subject)
    .split(/\s+/)
    .filter((part) => part.length >= 4 && !/^(?:game|edition|remake|plus)$/i.test(part));
  return Boolean(haystack && tokens.some((part) => haystack.includes(part)));
}

function ensureSubjectOpening(script = "", subject = "") {
  const cleanScript = cleanText(script);
  const cleanSubject = cleanText(subject);
  if (!cleanScript || !cleanSubject || containsSubject(firstSentence(cleanScript), cleanSubject)) {
    return cleanScript;
  }
  return cleanText(`${cleanSubject} is the name to watch here. ${cleanScript}`);
}

function titleClaimForProof(story = {}, subject = "") {
  const title = cleanText(story.title || story.suggested_title || subject)
    .replace(/\s+-\s+[A-Z][A-Z0-9 .&+-]{2,}$/i, "")
    .replace(/\s+\|\s+.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return `${subject || "The story"} has a new detail players can judge`;
  return title.length > 140 ? `${title.slice(0, 137).trim()}...` : title;
}

function safeClaimForProof(story = {}, subject = "") {
  const claim = titleClaimForProof(story, subject);
  if (!ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(claim)) return claim;
  if (/\b(?:hire|hiring|chief strategy|leadership|executive|officer)\b/i.test(claim)) {
    return `${subject} has made another leadership move`;
  }
  return `${subject} has a new update with player impact`;
}

function compactSubject(subject = "") {
  return cleanText(subject)
    .replace(/\s+(?:official|gameplay|trailer|review|release|date|reveal)\b.*$/i, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

function titleLooksRaw(value = "") {
  const title = cleanText(value);
  return title.split(/\s+/).length > 12 || /\s+\|\s+|\s+-\s+|:/.test(title);
}

function titleLooksGeneric(value = "") {
  return /\bhas one detail players should notice\b|\bjust got a real update\b|\bsource[-\s]?backed update\b/i.test(
    cleanText(value),
  );
}

function titleLooksPublishReady(value = "") {
  const title = cleanText(value);
  if (!title || titleLooksGeneric(title) || ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(title)) return false;
  const words = title.split(/\s+/);
  if (words.length > 12) return false;
  if (/\s+\|\s+|\s+-\s+/.test(title)) return false;
  return true;
}

function storyLooksLikeCuratedFreshIntake(story = {}) {
  const sourceType = cleanText(story.source_type || story.primary_source?.type).toLowerCase();
  return cleanText(story.freshness_gate).toLowerCase() === "pass" &&
    sourceBackedForProof(story) &&
    (
      sourceType.includes("official") ||
      sourceType.includes("platform") ||
      sourceType.includes("publisher") ||
      Boolean(sourceValueName(story.primary_source))
    );
}

function publicTitleForProof(story = {}, subject = "") {
  const curatedExplicit = [
    story.public_title,
    story.selected_title,
    storyLooksLikeCuratedFreshIntake(story) ? story.title : "",
  ].map(cleanText).find(titleLooksPublishReady) || "";
  const explicit = cleanText(story.public_title || story.suggested_title || asArray(story.title_options)[0] || story.title);
  const base = compactSubject(subject) || "This Game";
  const candidateScript = cleanText(story.full_script || story.tts_script);
  const scriptSafeForTitle =
    candidateScript &&
    !scriptLooksUnsafeForGoalProof(candidateScript) &&
    !scriptLooksCrossStoryContaminated(candidateScript, story, subject) &&
    !ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(candidateScript);
  const text = cleanText(
    [
      story.title,
      story.source_title,
      story.article_title,
      story.canonical_angle,
      safeClaimForProof(story, subject),
      scriptSafeForTitle ? candidateScript : "",
    ].filter(Boolean).join(" "),
  );
  if (/\b(?:valorant|vanguard)\b/i.test(text) && /\b(?:anti[-\s]?cheat|cheat|cheater|bricking|paperweight)\b/i.test(text)) {
    return `${base}'s Vanguard Trust Problem`;
  }
  if (curatedExplicit) return curatedExplicit;
  if (
    explicit &&
    !titleLooksRaw(explicit) &&
    !titleLooksGeneric(explicit) &&
    (subjectLooksGeneric(subject) || containsDistinctiveSubjectToken(explicit, subject))
  ) {
    return explicit;
  }
  if (/\b(?:price|cost|expensive|increase|subscription|pass)\b/i.test(text)) {
    return `${base} Just Got More Expensive`;
  }
  if (/\b(?:deal|sale|discount|off|\$|£|save)\b/i.test(text)) {
    return `${base} Deal Has One Catch`;
  }
  if (/\b(?:cancelled|canceled|done for good|walks away|final content|end of content|shutting down|delisted|delisting)\b/i.test(text)) {
    return `${base} Just Hit Its Endgame`;
  }
  if (/\b(?:law|legal|violate|violation|regulator|lawsuit)\b/i.test(text)) {
    return `${base} May Have A Legal Problem`;
  }
  if (/\b(?:alien|scare|scary|horror|fear|cannot fake|prologue)\b/i.test(text) && /\balien\b/i.test(base)) {
    return `${base} Has One Fear Test`;
  }
  if (/\b(?:reveal looks imminent|reveal tease|teases? a|teaser|looks imminent)\b/i.test(text)) {
    return `${base} Just Got A Reveal Tease`;
  }
  if (/\b(?:warbond|crossover|collab|collaboration)\b/i.test(text)) {
    return `${base} Just Got A Crossover Push`;
  }
  if (/\b(?:announced|officially revealed|confirmed)\b/i.test(text)) {
    return `${base} Just Became Official`;
  }
  if (/\b(?:roadmap|interview|year 1|playable factions)\b/i.test(text)) {
    return `${base} Just Laid Out Its Roadmap`;
  }
  if (/\b(?:trailer|gameplay|footage|preview)\b/i.test(text)) {
    return `${base} Finally Shows Real Gameplay`;
  }
  if (/\b(?:release date|launch|coming|delayed|delay)\b/i.test(text)) {
    return `${base} Just Got A Date`;
  }
  if (/\b(?:teased|clue|hint|director|creator|producer|chief|developer says|dev says)\b/i.test(text)) {
    return `${base} Just Dropped A New Clue`;
  }
  if (/\b(?:patch|updates?|new pve mission|content update|last content)\b/i.test(text)) {
    return `${base} Just Got A Content Push`;
  }
  if (/\b(?:review|score|metacritic|opencritic)\b/i.test(text)) {
    return `${base} Reviews Just Sent A Signal`;
  }
  return `${base} Just Got A New Signal`;
}

function scriptLooksUnsafeForGoalProof(script = "") {
  return /\b(?:source-backed update|clean read|this gaming story|this story finally has something specific to judge|something specific to judge|finally has something concrete to judge|concrete detail players can argue|players can argue with|floating headline|has a clock on it|platform,\s*price or gameplay detail|the useful question|the player angle is simple|before you spend|wait-and-see column|named source confirms|is the name to watch here|paid crowd just sent a loud warning|posted a major Steam player spike|cheap wave lands)\b/i.test(
    cleanText(script),
  );
}

const CROSS_STORY_ENTITY_TERMS = [
  "Forza Horizon 6",
  "Forza",
  "GTA 5",
  "GTA 6",
  "Dragon's Dogma 2",
  "The Elder Scrolls 6",
  "Gears Of War",
  "Halo: Campaign Evolved",
  "Quake Champions",
];

function scriptLooksCrossStoryContaminated(script = "", story = {}, subject = "") {
  const cleanScript = cleanText(script);
  if (!cleanScript) return false;
  const trustedContext = cleanText([
    subject,
    story.title,
    story.original_title,
    story.source_title,
    story.article_title,
    story.article_url,
    story.url,
  ].filter(Boolean).join(" "));

  return CROSS_STORY_ENTITY_TERMS.some((term) => {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return re.test(cleanScript) && !re.test(trustedContext);
  });
}

const REPEATED_TITLE_VARIANTS = {
  "Just Got A Content Push": [
    "Just Got A Content Push",
    "Just Changed The Watchlist",
    "Now Has A Player-Facing Catch",
    "Just Got A New Reason To Watch",
    "Just Raised The Stakes",
    "Is Starting To Look Different",
  ],
  "Just Got A New Signal": [
    "Just Got A New Signal",
    "Just Changed The Watchlist",
    "Now Has A Real Question",
    "Just Got A New Reason To Watch",
    "Is Worth Watching Again",
    "Just Raised The Stakes",
  ],
};

function splitTitlePattern(title = "") {
  const clean = cleanText(title);
  const match = clean.match(/\b(Deal .+|Just .+|Finally .+|May .+)$/);
  if (!match) return null;
  const suffix = match[1];
  return {
    prefix: clean.slice(0, clean.length - suffix.length).trim(),
    suffix,
  };
}

function diversifyRepeatedPublicTitles(stories = []) {
  const counts = new Map();
  return stories.map((story) => {
    const parts = splitTitlePattern(story.public_title || story.suggested_title || "");
    if (!parts || !REPEATED_TITLE_VARIANTS[parts.suffix]) return story;
    const count = counts.get(parts.suffix) || 0;
    counts.set(parts.suffix, count + 1);
    const variants = REPEATED_TITLE_VARIANTS[parts.suffix];
    const suffix = count < 3
      ? parts.suffix
      : variants[((count - 3) % (variants.length - 1)) + 1];
    if (suffix === parts.suffix) return story;
    const publicTitle = cleanText(`${parts.prefix} ${suffix}`);
    return {
      ...story,
      public_title: publicTitle,
      suggested_title: publicTitle,
    };
  });
}

function thumbnailTextForProof(story = {}, subject = "") {
  const explicit = cleanText(story.thumbnail_text || story.suggested_thumbnail_text || story.thumbnail_headline);
  const compact = compactSubject(subject).toUpperCase().split(/\s+/).slice(0, 3).join(" ");
  const contaminatedExplicit =
    /\b(?:paid players|xbox needed this|gta 6 waiting room)\b/i.test(explicit) &&
    !containsDistinctiveSubjectToken(explicit, subject);
  if (explicit && !contaminatedExplicit && explicit.split(/\s+/).length <= 5) {
    if (
      !containsSubject(explicit, subject) &&
      !containsDistinctiveSubjectToken(explicit, subject) &&
      compact &&
      explicit.split(/\s+/).length <= 4
    ) {
      return cleanText(`${compact} ${explicit.toUpperCase()}`).split(/\s+/).slice(0, 5).join(" ");
    }
    return explicit;
  }
  return compact;
}

function buildProofScript(story = {}, { subject, sourceName } = {}) {
  const claim = safeClaimForProof(story, subject);
  const source = sourceName || "The source";
  const candidateScript = cleanText(story.full_script || story.tts_script);
  const scriptSafeForBranch =
    candidateScript &&
    !scriptLooksUnsafeForGoalProof(candidateScript) &&
    !scriptLooksCrossStoryContaminated(candidateScript, story, subject) &&
    !ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(candidateScript);
  const combined = cleanText(
    [
      story.title,
      story.source_title,
      story.article_title,
      story.canonical_angle,
      claim,
      scriptSafeForBranch ? candidateScript : "",
    ].filter(Boolean).join(" "),
  );
  if (/\b(?:valorant|vanguard)\b/i.test(combined) && /\b(?:anti[-\s]?cheat|cheat|cheater|bricking|paperweight)\b/i.test(combined)) {
    return cleanText(
      `${subject}'s Vanguard update has a nasty trust problem. ` +
        `${source} reports the anti-cheat drama centres on cheaters claiming bricked PCs, with Riot firing back using the paperweight line. ` +
        `The headline is funny, but the real story is heavier: Vanguard runs deep enough that every scare becomes a trust test for legitimate players too. ` +
        `${PRIMARY_PULSE_CTA}.`,
    );
  }
  let lead = `${subject} just picked up a player-facing detail worth watching.`;
  let impact = "The important bit is whether this changes what people buy, play, wait for or skip.";
  let payoff = `${subject} only matters here if the update changes a real decision, not because it fills another news slot.`;
  if (/\b(?:scalper|scalpers|buying restriction|restrictions?|playtime rule|eligibility)\b/i.test(combined)) {
    lead = `${subject} is turning demand into an eligibility test.`;
    impact = `The argument is whether these rules help real fans get hardware, or punish players who did not have enough playtime before pre-orders opened.`;
    payoff = `That means Switch 2 buyers now face a checkout queue that is part loyalty check and part scalper filter.`;
  } else if (/\bdragon['’]s\s+dogma\s+2\b/i.test(subject) || /\b(?:dark arisen|major updates?|fast travel|pawns?)\b/i.test(combined)) {
    lead = `${subject} is getting the kind of update that only matters if it fixes everyday friction.`;
    impact = `Major updates sound big, but players will judge the boring pain points first: travel, quest flow and whether returning now feels less punishing.`;
    payoff = `If the patch does that, Dark Arisen stops being nostalgia bait and becomes a reason to reinstall.`;
  } else if (/\belder\s+scrolls\s+6\b/i.test(subject) || /\b(?:xbox chief|disappointing update|years away|still waiting)\b/i.test(combined)) {
    lead = `${subject} just got the update fans hate most: new words, no real reveal.`;
    impact = `For players, the issue is not impatience; it is whether another executive quote gives them any reason to trust the game is closer.`;
    payoff = `That means the argument moves from hype to proof: keep waiting, write it off, or treat every Xbox comment as delay evidence.`;
  } else if (/\bgears\s+of\s+war\b/i.test(subject) || /\b(?:e[- ]day|big exclusive|prequel)\b/i.test(combined)) {
    lead = `${subject} is carrying Xbox's most awkward exclusive question into 2026.`;
    impact = `The point is not that it exists; it is whether a prequel can make Gears feel urgent again before the platform debate swallows it.`;
    payoff = `Every combat detail now has to answer one thing: is this a comeback, or just another safe return?`;
  } else if (/\bquake\s+champions\b/i.test(subject) || /\b(?:free battle pass|battle pass|arena shooter)\b/i.test(combined)) {
    lead = `${subject} is not dead; it is trying to make lapsed players reinstall with free rewards.`;
    impact = `The free battle pass lowers the excuse to come back, but the real test is whether matchmaking still has enough people to fight.`;
    payoff = `That means arena shooter fans can treat this as a comeback check, not a routine patch note.`;
  } else if (/\b(?:trailer|gameplay|footage|preview|demo)\b/i.test(combined)) {
    lead = `${subject} has the one kind of reveal fans cannot hand-wave: actual play.`;
    impact = `Players can finally judge the specifics on screen: camera distance, attack timing and whether fights stay readable when they get busy.`;
    payoff = /\bhalo\b/i.test(subject)
      ? `For Halo fans, that is the remake deal: if the rifle rhythm and enemy dance feel off, prettier levels will not save it.`
      : `That is what separates a promising trailer from something players can trust at launch.`;
  } else if (/\b(?:price|cost|deal|sale|discount|subscription|pass)\b/i.test(combined)) {
    lead = `${subject} just changed the value question players were already asking.`;
    impact = `The real test is whether the new route feels like a better deal, or just a different wrapper around the same spend.`;
    payoff = `That matters because price stories only land when they change timing: buy now, wait or ignore it completely.`;
  } else if (/\b(?:review|score|metacritic|opencritic)\b/i.test(combined)) {
    lead = `${subject} just put a score in front of the hype.`;
    impact = `${subject} now has pressure on the details behind the number: performance, structure and whether more outlets agree.`;
    payoff = `A high score can start the argument, but player trust only follows if the wider verdict holds.`;
  } else if (/\b(?:date|launch|coming|delayed|delay)\b/i.test(combined)) {
    lead = `${subject} just blinked in one of the year's most crowded release windows.`;
    impact = /\bfable\b/i.test(subject)
      ? `For Fable fans, avoiding GTA 6 is not just schedule management; it is a chance to judge the reboot without Rockstar taking all the air.`
      : "Short delays normally sound boring, but this one says the calendar itself is now a threat.";
    payoff = /\bfable\b/i.test(subject)
      ? `That means the debate is whether the delay protects the game, or proves Xbox still cannot land its fantasy reset cleanly.`
      : `The argument is no longer only quality; it is whether the date lets the game be seen at all.`;
  } else if (/\bsales|copies|milestone|demand|passes\b/i.test(combined)) {
    lead = `${subject} just put a hard number behind its momentum.`;
    impact = "The useful part is not the bragging rights. It is whether that demand survives after launch-week curiosity fades.";
    payoff = `That is the difference between a spike people share and a player base that actually stays.`;
  } else if (/\b(?:patch|updates?|content update|roadmap|year 1|playable factions)\b/i.test(combined)) {
    lead = `${subject} is getting a content push that has to prove it is more than maintenance.`;
    impact = `Players will judge the practical change first: what feels better, what lasts longer and what gives them a reason to come back now.`;
    payoff = `If the update does not change that loop, the headline fades before the patch notes do.`;
  }
  return cleanText(
    `${lead} ` +
      `${source} says ${claim}. ` +
      `${impact} ` +
      `${payoff} ` +
      `${PRIMARY_PULSE_CTA}.`,
  );
}

function generatedMotionClipsForStory(story = {}) {
  const safeId = cleanId(story.id || story.title || "story");
  const families = [
    "hook_slam",
    "source_proof",
    "subject_motion",
    "timeline_push",
    "context_cut",
    "impact_card",
    "proof_reveal",
    "cta_sting",
  ];
  return families.map((family, index) => ({
    id: `${safeId}-owned-motion-${index + 1}`,
    type: "motion_clip",
    source_family: `${safeId}_${family}`,
    path: `output/generated-motion/${safeId}/${family}.mp4`,
    source_url: `local://pulse-generated-motion/${safeId}/${family}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    durationS: index === 0 ? 3.1 : 2.8,
    validated: true,
    transformation_notes: "Owned animated editorial proof beat generated from the story manifest, not gameplay footage.",
  }));
}

function rightsForGeneratedClip(clip = {}) {
  return {
    asset_id: clip.id,
    path: clip.path,
    source_url: clip.source_url,
    source_type: clip.source_type,
    rights_risk_class: clip.rights_risk_class,
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
    commercial_use_allowed: true,
    risk_score: 0.03,
    evidence_file: "rights/pulse-generated-motion.json",
  };
}

function normaliseStory(story = {}) {
  return {
    ...story,
    video_clips: asArray(parseMaybeJson(story.video_clips, story.video_clips || [])),
    visual_v4_local_motion_clips: asArray(parseMaybeJson(
      story.visual_v4_local_motion_clips,
      story.visual_v4_local_motion_clips || [],
    )),
    downloaded_images: asArray(parseMaybeJson(story.downloaded_images, story.downloaded_images || [])),
    game_images: asArray(parseMaybeJson(story.game_images, story.game_images || [])),
    affiliate_link_manifest:
      parseMaybeJson(story.affiliate_link_manifest, story.affiliate_link_manifest || null) ||
      story.commercial_intelligence ||
      null,
  };
}

function looksLikeRealMotionClip(clip = {}) {
  const pathValue = cleanText(clip.path || clip.local_path || clip.source_url || clip.url);
  return /\.(?:mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(pathValue) &&
    !isGeneratedMotionAsset(clip) &&
    isRealMediaAsset(clip);
}

function firstExistingPath(paths = []) {
  for (const candidate of asArray(paths).map(cleanText)) {
    if (!candidate || /^https?:\/\//i.test(candidate)) continue;
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return "";
}

function readJsonSyncIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && fs.existsSync(filePath)) return fs.readJsonSync(filePath);
  } catch {}
  return fallback;
}

function metadataMatchesClip(meta = {}, clip = {}) {
  const sourceUrl = cleanText(clip.source_url || clip.path || clip.url);
  if (!sourceUrl || cleanText(meta.source_url) !== sourceUrl) return false;
  const wantedStart = Number(clip.mediaStartS ?? clip.media_start_s);
  const actualStart = Number(meta.media_start_s ?? meta.mediaStartS);
  if (!Number.isFinite(wantedStart) || !Number.isFinite(actualStart)) return true;
  return Math.abs(wantedStart - actualStart) <= 0.15;
}

function cachedClipPathFor({ clip = {}, storyId = "", videoCacheDir = path.join(process.cwd(), "output", "video_cache") } = {}) {
  const direct = firstExistingPath([
    clip.local_materialized_path,
    clip.local_path,
    clip.resolved_path,
    clip.file_path,
    clip.path,
  ]);
  if (direct) return direct;
  const safeId = cleanId(storyId || clip.story_id || "story");
  try {
    const files = fs.readdirSync(videoCacheDir)
      .filter((name) => name.startsWith(`${safeId}_v4_clip_`) && name.endsWith(".mp4.json"))
      .sort();
    for (const name of files) {
      const metaPath = path.join(videoCacheDir, name);
      const meta = readJsonSyncIfPresent(metaPath, {});
      if (!metadataMatchesClip(meta, clip)) continue;
      const mp4 = metaPath.replace(/\.json$/i, "");
      if (fs.existsSync(mp4)) return mp4;
    }
  } catch {}
  return "";
}

function clipsFromVisualV4MotionPack(
  motionPack = {},
  { storyId = "", videoCacheDir = path.join(process.cwd(), "output", "video_cache") } = {},
) {
  if (cleanText(motionPack.readiness?.status) !== "v4_motion_ready") return [];
  return asArray(motionPack.handoff?.visual_v4_local_motion_clips || motionPack.clips)
    .filter(looksLikeRealMotionClip)
    .map((clip, index) => {
      const localPath = cachedClipPathFor({ clip, storyId, videoCacheDir });
      const originalSourceUrl = cleanText(clip.source_url || clip.url || (/^https?:\/\//i.test(cleanText(clip.path)) ? clip.path : ""));
      return {
        ...clip,
        id: cleanText(clip.id || clip.clip_id || `${cleanId(storyId)}_v4_motion_${index + 1}`),
        type: "motion_clip",
        source_family: cleanText(clip.source_family || clip.family || `v4_motion_family_${index + 1}`),
        path: localPath || cleanText(clip.path),
        source_url: originalSourceUrl || cleanText(clip.source_url),
        source_type: cleanText(clip.source_type || "official_reference_clip"),
        rights_risk_class: cleanText(clip.rights_risk_class || "official_reference_only"),
        allowed_render_use: cleanText(clip.allowed_render_use || "reference_only_by_default"),
        validated: clip.validated !== false,
        local_materialized_path: localPath || clip.local_materialized_path || null,
        source_restore: {
          source: "visual_v4_motion_pack_hydration",
          local_cache_hit: Boolean(localPath),
        },
      };
    })
    .filter((clip) => cleanText(clip.path));
}

function hydrateStoryWithMotionPack(story = {}, motionPack = {}, options = {}) {
  const normalised = normaliseStory(story);
  const existingRealMotion = [
    ...asArray(normalised.video_clips),
    ...asArray(normalised.visual_v4_local_motion_clips),
    ...asArray(normalised.motion_clips),
  ].filter(looksLikeRealMotionClip);
  if (existingRealMotion.length) {
    return {
      ...normalised,
      video_clips: existingRealMotion,
      visual_v4_local_motion_clips: existingRealMotion,
    };
  }
  const restoredClips = clipsFromVisualV4MotionPack(motionPack, {
    storyId: normalised.id || normalised.story_id,
    videoCacheDir: options.videoCacheDir,
  });
  if (!restoredClips.length) return normalised;
  return {
    ...normalised,
    video_clips: restoredClips,
    visual_v4_local_motion_clips: restoredClips,
    visual_v4_motion_pack: motionPack,
    visual_v4_motion_pack_status: motionPack.readiness?.status || "unknown",
    visual_v4_motion_pack_clip_count: restoredClips.length,
    rich_visual_restore: {
      source: "visual_v4_motion_pack",
      restored_clip_count: restoredClips.length,
      local_cache_clip_count: restoredClips.filter((clip) => clip.source_restore?.local_cache_hit).length,
    },
  };
}

function prepareStoryForGoalProof(story = {}, options = {}) {
  const normalised = normaliseStory(story);
  const sourceName = sourceNameForProof(normalised);
  const canonicalSubject = canonicalSubjectForProof(normalised);
  const existingMotion = [
    ...asArray(normalised.video_clips),
    ...asArray(normalised.visual_v4_local_motion_clips),
    ...asArray(normalised.motion_clips),
  ].filter(looksLikeRealMotionClip);
  const shouldGenerateOwnedMotion =
    options.allowOwnedMotionFallback === true &&
    existingMotion.length === 0 &&
    sourceBackedForProof(normalised) &&
    cleanText(normalised.full_script || normalised.tts_script);
  const generatedMotion = shouldGenerateOwnedMotion ? generatedMotionClipsForStory(normalised) : [];
  const initialScript = ensureSubjectOpening(
    ensurePulseCta(normalised.full_script || normalised.tts_script || ""),
    canonicalSubject,
  );
  const initialScriptScore = initialScript
    ? buildViralScriptIntelligence({
        story: { ...normalised, canonical_subject: canonicalSubject, source_name: sourceName },
        script: initialScript,
      })
    : null;
  const shouldRewriteScript =
    sourceBackedForProof(normalised) &&
    (!initialScript ||
      initialScriptScore.verdict === "rewrite_required" ||
      asArray(initialScriptScore.blockers).length ||
      scriptLooksUnsafeForGoalProof(initialScript) ||
      scriptLooksCrossStoryContaminated(initialScript, normalised, canonicalSubject) ||
      ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(initialScript));
  const script = shouldRewriteScript
    ? buildProofScript(normalised, { subject: canonicalSubject, sourceName })
    : initialScript;
  const scriptFirstSentence = firstSentence(script);
  const affiliateDisclosureRequired = Boolean(
    normalised.affiliate_url ||
      normalised.affiliate_link_manifest?.disclosure_required ||
      normalised.affiliate_link_manifest?.primary_link,
  );
  const affiliateDisclosure = affiliateDisclosureRequired
    ? "Affiliate links may earn us a commission."
    : normalised.affiliate_disclosure;
  const publicTitle = publicTitleForProof(normalised, canonicalSubject);
  const thumbnailText = thumbnailTextForProof(normalised, canonicalSubject);
  const sourceDescription = cleanText(normalised.description || normalised.seo_description);
  const defaultDescription = safeClaimForProof(normalised, canonicalSubject);
  const descriptionWithSubject = sourceDescription && containsSubject(sourceDescription, canonicalSubject)
    ? sourceDescription
    : `${canonicalSubject}: ${sourceDescription || defaultDescription}`;
  const prepared = {
    ...normalised,
    canonical_subject: canonicalSubject,
    canonical_game: !subjectLooksGeneric(normalised.canonical_game || normalised.game_title)
      ? cleanText(normalised.canonical_game || normalised.game_title)
      : canonicalSubject,
    primary_source: sourceName,
    source_name: sourceName,
    source_card_label: cleanText(normalised.source_card_label || sourceName),
    thumbnail_source_label: cleanText(normalised.thumbnail_source_label || sourceName),
    article_url: storyUrl(normalised),
    public_title: publicTitle,
    suggested_title: publicTitle,
    suggested_thumbnail_text: thumbnailText,
    thumbnail_headline: thumbnailText,
    thumbnail_text: thumbnailText,
    hook: scriptFirstSentence,
    narration_hook: scriptFirstSentence,
    first_spoken_line: scriptFirstSentence,
    body: shouldRewriteScript ? "" : normalised.body,
    loop: shouldRewriteScript ? "" : normalised.loop,
    allowed_public_wording: [publicTitle, scriptFirstSentence].filter(Boolean),
    title_candidates: [publicTitle, normalised.title].filter(Boolean),
    full_script: script,
    tts_script: script,
    description: `${descriptionWithSubject} Source: ${sourceName}.`,
    pinned_comment: affiliateDisclosureRequired
      ? `${affiliateDisclosure} Source: ${sourceName}.`
      : `Source: ${sourceName}.`,
    affiliate_disclosure: affiliateDisclosure,
    manual_caption_generated: cleanText(script) ? true : normalised.manual_caption_generated,
    clean_manual_captions: cleanText(script) ? true : normalised.clean_manual_captions,
    transformative_edit_evidence:
      existingMotion.length > 0 || generatedMotion.length > 0 ? true : normalised.transformative_edit_evidence,
    video_clips: existingMotion.length ? existingMotion : generatedMotion,
    visual_v4_local_motion_clips: existingMotion.length ? existingMotion : asArray(normalised.visual_v4_local_motion_clips),
  };

  if (generatedMotion.length > 0) {
    prepared.downloaded_images = [];
    prepared.game_images = [];
    delete prepared.image_path;
  }

  const generatedRights = generatedMotion.map(rightsForGeneratedClip);
  prepared.rights_ledger = [
    ...asArray(parseMaybeJson(normalised.rights_ledger, normalised.rights_ledger || [])),
    ...generatedRights,
  ];

  if (affiliateDisclosureRequired) {
    prepared.affiliate_link_manifest = {
      ...(normalised.affiliate_link_manifest || {}),
      story_id: normalised.id || null,
      vertical: normalised.affiliate_link_manifest?.vertical || "gaming",
      disclosure_required: true,
      disclosure_copy: {
        short: affiliateDisclosure,
        landing: affiliateDisclosure,
      },
    };
  }

  return prepared;
}

function augmentStoriesWithRevenuePaths(stories = [], revenuePathDigest = {}, limit = 30) {
  const out = asArray(stories).map(normaliseStory);
  const seen = new Set(out.map((story) => String(story.id || "")));
  for (const pathRow of asArray(revenuePathDigest.top_paths)) {
    if (out.length >= limit) break;
    const id = String(pathRow.story_id || "").trim();
    if (!id || seen.has(id)) continue;
    const manifest = revenueManifestFor(pathRow);
    const title = bestRevenueTitle(pathRow);
    const source = primaryRevenueSource(pathRow);
    const sourceType = source.url && !isRedditUrl(source.url) ? "rss" : "revenue_path_candidate";
    seen.add(id);
    out.push(normaliseStory({
      id,
      title: title || pathRow.title || pathRow.route || id,
      suggested_title: title || pathRow.title || "",
      public_title: title || pathRow.title || "",
      canonical_subject: pathRow.title || title || "",
      canonical_angle: pathRow.commercial_intent_type || "revenue_path_candidate",
      source_type: sourceType,
      source_name: source.name,
      primary_source: source.name,
      source_card_label: source.name,
      thumbnail_source_label: source.name,
      article_url: source.url,
      url: source.url,
      source_links: source.links,
      description: cleanText(manifest.description || manifest.summary || title),
      full_script: "",
      affiliate_link_manifest: affiliateManifestFromRevenuePath(pathRow),
    }));
  }
  return out.slice(0, limit);
}

function rightsLedgerForStory(story = {}, explicit = []) {
  const existing = [
    ...asArray(parseMaybeJson(story.rights_ledger, story.rights_ledger || [])),
    ...asArray(parseMaybeJson(story.rights_records, story.rights_records || [])),
    ...asArray(explicit),
  ];
  if (story.audio_path && !existing.some((record) => record.path === story.audio_path)) {
    existing.push({
      asset_id: `${story.id || "story"}_audio_path`,
      path: story.audio_path,
      source_type: "local_tts_voice",
      licence_basis: "owned_local_voice_model",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.05,
      evidence_file: "rights/local-tts.json",
    });
  }
  return existing;
}

function buildGoalBatchPackages({
  stories = [],
  limit = 30,
  rightsLedgerByStory = {},
  motionPackByStory = {},
  videoCacheDir = path.join(process.cwd(), "output", "video_cache"),
  allowOwnedMotionFallback = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const selected = asArray(stories)
    .map((story) => hydrateStoryWithMotionPack(
      story,
      motionPackByStory[story.id || story.story_id],
      { videoCacheDir },
    ))
    .map((story) => prepareStoryForGoalProof(story, { allowOwnedMotionFallback }))
    .filter((story) => story.id && story.title)
    .slice(0, limit);
  const diversified = diversifyRepeatedPublicTitles(selected);
  const packages = diversified.map((story) => buildGoalProofPackage({
    story,
    rightsLedger: rightsLedgerForStory(story, rightsLedgerByStory[story.id]),
    generatedAt,
  }));
  const storyPackages = packages.map((pack) => pack.acceptance_entry);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    summary: {
      story_count: storyPackages.length,
      green_count: storyPackages.filter((entry) => entry.verdict === "GREEN").length,
      red_count: storyPackages.filter((entry) => entry.verdict === "RED").length,
    },
    packages,
    story_packages: storyPackages,
    safety: {
      local_only: true,
      no_publishing_side_effects: true,
      production_db_mutated: false,
      oauth_triggered: false,
    },
  };
}

async function writeGoalBatchPackages(batch = {}, { outputDir, contractOutDir } = {}) {
  if (!outputDir) throw new Error("writeGoalBatchPackages requires outputDir");
  if (!contractOutDir) throw new Error("writeGoalBatchPackages requires contractOutDir");
  const outDir = path.resolve(outputDir);
  const materialisedStoryPackages = [];
  for (const pack of asArray(batch.packages)) {
    const storyOutDir = path.join(outDir, cleanId(pack.story_id));
    await writeGoalProofPackageArtifacts(pack, {
      outputDir: storyOutDir,
    });
    materialisedStoryPackages.push({
      ...(pack.acceptance_entry || {}),
      artifact_dir: storyOutDir,
    });
  }
  await fs.ensureDir(contractOutDir);
  const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
  const batchReportPath = path.join(contractOutDir, "story-packages-report.json");
  const storyPackages = materialisedStoryPackages.length
    ? materialisedStoryPackages
    : batch.story_packages || [];
  await fs.writeJson(storyPackagesPath, storyPackages, { spaces: 2 });
  await fs.writeJson(batchReportPath, {
    schema_version: batch.schema_version,
    generated_at: batch.generated_at,
    summary: {
      ...batch.summary,
      materialised_story_count: storyPackages.length,
    },
    safety: batch.safety,
  }, { spaces: 2 });
  return { outputDir: outDir, storyPackagesPath, batchReportPath };
}

module.exports = {
  augmentStoriesWithRevenuePaths,
  buildGoalBatchPackages,
  clipsFromVisualV4MotionPack,
  hydrateStoryWithMotionPack,
  prepareStoryForGoalProof,
  writeGoalBatchPackages,
};
