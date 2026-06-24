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

function uniqueValues(values = []) {
  return Array.from(new Set(asArray(values)));
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

function recordsFromMaybeJson(value, fallback = []) {
  const parsed = parseMaybeJson(value, fallback);
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  return [
    ...asArray(parsed.records),
    ...asArray(parsed.assets),
    ...asArray(parsed.rights_records),
    ...asArray(parsed.rightsLedger),
  ];
}

function assetsFromMaybeJson(value, fallback = []) {
  const parsed = parseMaybeJson(value, fallback);
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  return [
    ...asArray(parsed.asset_inventory),
    ...asArray(parsed.installed_assets),
    ...asArray(parsed.assets),
    ...asArray(parsed.selected_assets),
  ];
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

function decodeCommonHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&#8211;|&#x2013;/gi, "-")
    .replace(/&\s*8211\s*;?/gi, "-")
    .replace(/&#8212;|&#x2014;/gi, "-")
    .replace(/&#8216;|&#x2018;/gi, "'")
    .replace(/&#8217;|&#x2019;/gi, "'")
    .replace(/&#8220;|&#x201c;/gi, "\"")
    .replace(/&#8221;|&#x201d;/gi, "\"")
    .replace(/&#163;|&#xa3;/gi, "GBP");
}

function cleanText(value) {
  return decodeCommonHtmlEntities(value).replace(/\s+/g, " ").trim();
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
  if (/^(?:source|story|update|headline|it|it's|there|here)$/i.test(clean)) return true;
  if (
    /\b(?:price\s+timing\s+risk|moves\s+forward|my\s+favorite\s+baseball\s+team)\b/i.test(clean) ||
    /\bcan$/i.test(clean) ||
    /^(?:data\s+analyst|analyst|researcher|study|report)\s+(?:finds|found|says|claims|reports)\b/i.test(clean)
  ) {
    return true;
  }
  if (
    /^(?:how|why|what|while|pay attention to|everything we know|today'?s top deals)\b/i.test(clean) ||
    /\b(?:game|games|demo|story|update|trailer|article|guide)\s+(?:where|that|which|about)\b/i.test(clean) ||
    /\b(?:demo|preview)$/i.test(clean) ||
    /^(?:mobile studio hoping|5\s+zelda characters)\b/i.test(clean) ||
    /\b(?:demand|now)\s*$/i.test(clean)
  ) {
    return true;
  }
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
  if (/\bai\s+stigma\b[\s\S]{0,120}\bsteam\b|\bsteam\b[\s\S]{0,120}\bai\s+stigma\b/i.test(clean)) {
    return "AI stigma on Steam";
  }
  if (/\bthe\s+expanse\s*:?\s*osiris\s+reborn\b/i.test(clean)) return "The Expanse: Osiris Reborn";
  if (/\bgranblue\s+fantasy\s*:?\s*relink\b/i.test(clean)) return "Granblue Fantasy: Relink";
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(clean)) return "Star Wars: Galactic Racer";
  if (/\bsteam\s+controller\b/i.test(clean)) return "Steam Controller";
  if (/\bpubg\b/i.test(clean)) return "PUBG";
  if (/\bea\s+sports\s+fc\s*26\b/i.test(clean)) return "EA Sports FC 26";
  if (/\bdave\s+the\s+diver\b/i.test(clean)) return "Dave The Diver";
  if (/\bthe\s+adventures\s+of\s+elliot\b/i.test(clean)) return "The Adventures Of Elliot";
  if (/\bthe\s+planet\s+crafter\b/i.test(clean)) return "The Planet Crafter";
  if (/\bdeus\s+ex\b[\s\S]{0,120}\b(?:unreal\s+)?composer\b/i.test(clean)) return "Deus Ex Composer";
  if (/^nintendo,\s+you\s+better\b/i.test(clean)) return "Nintendo";
  if (/\bhalo\s+remake\b/i.test(clean)) return "Halo: Campaign Evolved";
  if (/\bresident\s+evil\b[\s\S]{0,80}\bcode\s*:?\s*veronica\b/i.test(clean)) {
    return "Resident Evil Code: Veronica";
  }
  if (/\bseptember\s+is\s+so\s+busy\b[\s\S]{0,120}\bone\s+of\s+them\b[\s\S]{0,120}\bdelayed\b/i.test(clean)) {
    return "Valor Mortis";
  }
  if (/\bvalor\s+mortis\b/i.test(clean)) return "Valor Mortis";
  if (/\bone\s+more\s+level\b[\s\S]{0,80}\bvalor\b/i.test(clean)) return "Valor Mortis";
  if (/\brunescape\s*:?\s*dragonwilds\b|\bdragonwilds\b/i.test(clean)) return "RuneScape: Dragonwilds";
  if (/\bgears\s+of\s+war\s*:?\s*e[-\s]?day\b/i.test(clean)) return "Gears Of War: E-Day";
  const known = clean.match(
    /\b(Dragon['’]s\s+Dogma\s+2|Gears\s+Of\s+War:?\s*E[- ]Day|The\s+Elder\s+Scrolls\s+6|Halo:\s*Campaign\s+Evolved|Quake\s+Champions|RuneScape:\s*Dragonwilds|Mario\s+Kart\s+World|Valorant|Hades\s+II|Helldivers\s+2|Forza\s+Horizon\s+6|PlayStation\s+Plus|PlayStation|Xbox|Nintendo|Steam|Valve|Riot|Warhammer\s+40,?000|Boltgun\s+2|Subnautica\s+2|GTA\s+6|GTA\s+5|Assassin's\s+Creed(?:\s+Black\s+Flag)?|Black\s+Flag|Fable|Star\s+Fox|Final\s+Fantasy\s+7\s+Rebirth|Kingdom\s+Come|Destiny\s+2|Lego\s+Batman|Paranormal\s+Activity)\b/i,
  );
  if (known) return titleCaseEntity(known[1]);
  const possessive = clean.match(/^([A-Z][A-Za-z0-9'.:+&-]*(?:\s+[A-Z0-9][A-Za-z0-9'.:+&-]*){0,4})'s\b/);
  if (possessive) return titleCaseEntity(possessive[1]);
  const colon = clean.match(/^([A-Z][^:]{1,58}):\s+/);
  if (colon) return titleCaseEntity(colon[1].replace(/\s+preview$/i, ""));
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
  const titleSubject = cleanText(subjectFromTitle([
    story.title,
    story.suggested_title,
    story.public_title,
    story.description,
    story.top_comment,
    story.hook,
    story.body,
    story.canonical_angle,
  ].filter(Boolean).join(" ")));
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

function scriptSentences(text = "") {
  return cleanText(text)
    .replace(new RegExp(`\\b${PRIMARY_PULSE_CTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?`, "gi"), "")
    .match(/[^.!?]+[.!?]+/g)
    ?.map((sentence) => cleanText(sentence))
    .filter(Boolean) || [];
}

function publicDescriptionDetailSentence(sentences = [], lead = "", payoff = "") {
  return asArray(sentences).find((sentence) =>
    sentence !== lead &&
    sentence !== payoff &&
    !/\b(?:says|reports)\b/i.test(sentence) &&
    /\b(?:players?|fans?|you|owners?|buyers?|subscribers?|pc players?|xbox|playstation|nintendo|steam|game pass)\b/i.test(sentence) &&
    /\b(?:try|judge|decide|test|play|download|buy|wait|skip|return|reinstall|wishlist|combat|boss|builds?|mode|map|campaign|storage|price|demo|date|score|handling|driving|nostalgia)\b/i.test(sentence)
  ) || "";
}

function publicDescriptionForProof({ story = {}, subject = "", sourceName = "", script = "" } = {}) {
  const sentences = scriptSentences(script);
  const lead = sentences.find((sentence) => containsSubject(sentence, subject)) || firstSentence(script);
  const payoff = sentences
    .slice()
    .reverse()
    .find((sentence) =>
      sentence !== lead &&
      !/^source:/i.test(sentence) &&
      !/\b(?:says|reports)\b/i.test(sentence)
    );
  const detail = publicDescriptionDetailSentence(sentences, lead, payoff);
  const fallback = safeClaimForProof(story, subject);
  const body = cleanText(uniqueValues([lead || fallback, detail, payoff]).filter(Boolean).join(" "));
  return cleanText(`${body || fallback} Source: ${sourceName || "Official source"}.`);
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

function proofScript(sentences = []) {
  return cleanText([...asArray(sentences), `${PRIMARY_PULSE_CTA}.`].join(" "));
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
  const evidenceText = cleanText([story.title, story.source_title, story.article_title, story.description, story.full_script, story.tts_script].join(" "));
  if (
    /\bsuper\s+yooka[-\s]?laylee\s+kart\b/i.test(cleanText(subject) + " " + evidenceText) &&
    /\b(?:diddy\s+kong\s+racing|handling|driving|nostalgia)\b/i.test(evidenceText)
  ) {
    return `${subject} needs handling that proves nostalgia is not doing the Diddy Kong Racing work`;
  }
  if (
    subject &&
    normaliseForSubject(claim) === normaliseForSubject(subject)
  ) {
    return `${subject} has a new player-facing detail to judge`;
  }
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
  return title.split(/\s+/).length > 12 ||
    /\s+\|\s+|\s+-\s+|:/.test(title) ||
    /\b(?:demand|now)\s+just\s+(?:got|changed|turned)\b/i.test(title);
}

function titleLooksGeneric(value = "") {
  return /\bhas one detail players should notice\b|\bjust got a real update\b|\bsource[-\s]?backed update\b|^why\s+.+\s+could\s+split\s+players\b/i.test(
    cleanText(value),
  );
}

function titleLooksMalformedGenerated(value = "") {
  const title = cleanText(value);
  if (!title) return false;
  return (
    /\bcan\s+has\b/i.test(title) ||
    /\b\w+\s+to\s+could\b/i.test(title) ||
    /(?:^|\s)&\s*8211\s*(?:$|\s)/i.test(title) ||
    /\bhas\s+a\s+price\s+timing\s+risk\b/i.test(title) ||
    /\b(?:data\s+analyst\s+finds|my\s+favorite\s+baseball\s+team)\b/i.test(title) ||
    /"[^"]*"\s+\w+\s+"[^"]*\s+has\s+a\b/i.test(title)
  );
}

function titleLooksPublishReady(value = "") {
  const title = cleanText(value);
  if (
    !title ||
    titleLooksGeneric(title) ||
    titleLooksMalformedGenerated(title) ||
    ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(title)
  ) return false;
  const words = title.split(/\s+/);
  if (words.length > 12) return false;
  if (/\b(?:demand|now)\s+just\s+(?:got|changed|turned)\b/i.test(title)) return false;
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

function concretePriceOrAccessSignal(value = "") {
  const text = cleanText(value);
  return /\b(?:\$|£|€|\d+\s*%\s*off|\d+\s*percent\s*off|price\s+(?:cut|drop|increase|rise|reduction|hike)|costs?\s+\d|drops?\s+to\s+(?:\$|£|€)?\d|sale|discount|deal|save\s+\d|pre[- ]?order|preorder|reservation|reserved|subscription|game\s+pass|ps\s+plus|ea\s+play|free[- ]access|free\s+weekend|free\s+trial)\b/i.test(
    text,
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
  if (/\belder\s+scrolls\s+6\b[\s\S]{0,120}\b(?:disappointing\s+update|xbox\s+chief|words?\s+without\s+proof|re[-\s]?reveal)\b/i.test(text)) {
    return "The Elder Scrolls 6 Just Dropped A New Clue";
  }
  if (/\bai\s+stigma\b/i.test(text) && /\bsteam\b/i.test(text) && /\breviews?\b/i.test(text)) {
    return "Steam's AI Label Has A Review Problem";
  }
  if (curatedExplicit) return curatedExplicit;
  if (/\bresident\s+evil\b[\s\S]{0,80}\bcode\s*:?\s*veronica\b/i.test(text)) {
    return "Code Veronica Just Answered The Camera Question";
  }
  if (/\bvalor\s+mortis\b/i.test(text) || /\bseptember\b[\s\S]{0,80}\bdelayed\b/i.test(text)) {
    return "Valor Mortis Just Dodged September";
  }
  if (/\b(?:gta\s*5|grand\s+theft\s+auto\s+v)\b[\s\S]{0,80}\bsubscription\b/i.test(text)) {
    return "GTA 5 Became The GTA 6 Waiting Room";
  }
  if (/\b(?:lost|losing|wipe|wiped|reset)\b[\s\S]{0,80}\b(?:save|progress)\b|\b(?:save|progress)\b[\s\S]{0,80}\b(?:lost|losing|wipe|wiped|reset)\b/i.test(text)) {
    return `${base} Has A Save-Wipe Warning`;
  }
  if (/\brunescape\s*:?\s*dragonwilds\b|\bdragonwilds\b/i.test(text)) {
    return "Dragonwilds Has One Last Early Access Test";
  }
  if (/\bgears\s+of\s+war\s*:?\s*e[-\s]?day\b/i.test(text)) {
    return "Gears E-Day Is Xbox's Comeback Test";
  }
  if (/\bfable\b[\s\S]{0,120}\b(?:delay|delayed|avoiding\s+gta\s*6)\b/i.test(text)) {
    return "Fable Delay Is Xbox's GTA 6 Problem";
  }
  if (/\bdragon['â€™]?s\s+dogma\s+2\b/i.test(text)) {
    return "Dragon's Dogma 2 Has One Dark Arisen Test";
  }
  if (/\bquake\s+champions\b/i.test(text)) {
    return "Quake Champions Is Testing A Comeback";
  }
  if (/\bsea\s+of\s+thieves\b/i.test(text) && /\b(?:custom\s+seas|keys\s+to\s+the\s+seas|private\s+server|private\s+seas)\b/i.test(text)) {
    return "Sea Of Thieves Is Letting Crews Set The Rules";
  }
  if (/\bplaystation\s+plus\b|\bps\s+plus\b/i.test(text) && /\b(?:leaving|library|july)\b/i.test(text)) {
    return "PlayStation Plus Is Taking Games Away In July";
  }
  if (/\bxbox\b/i.test(text) && /\b(?:exclusive\s+label|exclusivity|console\s+dashboard)\b/i.test(text)) {
    return "Xbox's New Exclusive Label Has One Problem";
  }
  if (/\bghost\s+at\s+dawn\b/i.test(text)) {
    return "Ghost At Dawn Turns Fear Into A Choice";
  }
  if (/\bend\s+of\s+abyss\b/i.test(text)) {
    return "End Of Abyss Has One Combat Test";
  }
  if (/\bgungrave\s+g\.?o\.?r\.?e\.?\s+blood\s+heat\b/i.test(text)) {
    return "Gungrave Blood Heat Has A Gameplay Test";
  }
  if (/\bhalo\b[\s\S]{0,80}\b(?:remake|campaign\s+evolved)\b/i.test(text)) {
    return "Halo Campaign Evolved Has One Real Test";
  }
  if (/\b(?:valorant|vanguard)\b/i.test(text) && /\b(?:anti[-\s]?cheat|cheat|cheater|bricking|paperweight)\b/i.test(text)) {
    return `${base}'s Vanguard Trust Problem`;
  }
  if (/\bgranblue\s+fantasy\s*:?\s*relink\b/i.test(text)) {
    return "Granblue Fantasy Relink Has A Demo Test";
  }
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(text) && /\b(?:podracing|roguelite)\b/i.test(text)) {
    return "Star Wars Podracing Has A Roguelite Risk";
  }
  if (/\bsuper\s+yooka[-\s]?laylee\s+kart\b/i.test(text)) {
    return "Yooka-Laylee Kart Has A Diddy Kong Risk";
  }
  if (/\b(?:genai|generative\s+ai|ai)\b/i.test(text) && /\b(?:team\s*mates?|teammates?|squadmate|companion)\b/i.test(text)) {
    return `${base} Has An AI Teammate Risk`;
  }
  if (/\bea\s+sports\s+fc\s*26\b/i.test(text) && /\bea\s+play\b/i.test(text)) {
    return "EA Sports FC 26 Just Became Easier To Trial";
  }
  if (/\bdave\s+the\s+diver\b/i.test(text) && /\bjungle\b/i.test(text)) {
    return "Dave The Diver Has A Jungle Test";
  }
  if (/\bthe\s+adventures\s+of\s+elliot\b/i.test(text)) {
    return "Elliot Is Square Enix's Retro Test";
  }
  if (/\bthe\s+planet\s+crafter\b/i.test(text)) {
    return "The Planet Crafter Is Testing PS5 Survival Fans";
  }
  if (
    explicit &&
    !titleLooksRaw(explicit) &&
    !titleLooksGeneric(explicit) &&
    !titleLooksMalformedGenerated(explicit) &&
    (subjectLooksGeneric(subject) || containsDistinctiveSubjectToken(explicit, subject))
  ) {
    return explicit;
  }
  if (
    concretePriceOrAccessSignal(text) &&
    /\b(?:price|cost|expensive|increase|subscription|pass|game\s+pass|ps\s+plus|ea\s+play)\b/i.test(text)
  ) {
    return `${base} Just Got More Expensive`;
  }
  if (concretePriceOrAccessSignal(text) && /\b(?:deal|sale|discount|off|\$|£|€|save)\b/i.test(text)) {
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
  return /\b(?:source-backed update|clean read|this gaming story|this story finally has something specific to judge|something specific to judge|finally has something concrete to judge|needs one concrete player-facing detail|more than a feed item|what players,\s*creators or the wider community|footage,\s*release timing,\s*price|if the next proof gives that answer|stays a watch item|concrete detail players can argue|players can argue with|floating headline|has a clock on it|platform,\s*price or gameplay detail|the useful question|the player angle is simple|before you spend|wait-and-see column|named source confirms|is the name to watch here|paid crowd just sent a loud warning|posted a major Steam player spike|cheap wave lands)\b/i.test(
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
  const evidenceText = cleanText([subject, story.title, story.source_title, story.article_title, story.description].join(" "));
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(evidenceText) && /\b(?:podracing|roguelite)\b/i.test(evidenceText)) {
    return "STAR WARS ROGUELITE RISK";
  }
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
  if (subjectLooksGeneric(subject)) {
    return cleanText(
      `This game story needs a clearer name before the take is worth trusting. ` +
        `${source} says ${claim}. ` +
        `That may be real news, but players need the actual game, studio or platform before the headline means anything useful. ` +
        `Until that missing name is clear, this is a caution flag, not a hype moment. ` +
        `${PRIMARY_PULSE_CTA}.`,
    );
  }
  if (/\bresident\s+evil\b[\s\S]{0,80}\bcode\s*:?\s*veronica\b/i.test(combined)) {
    return proofScript([
      "Resident Evil Code: Veronica just answered the camera question fans were arguing about.",
      `${source} says Capcom has confirmed the remake is third-person and is taking its cue from Resident Evil 2, despite the first-person trailer debate.`,
      "That choice changes the whole promise: slower positioning, resource panic and enemies you can actually read before they overwhelm you.",
      "The debate now is whether Capcom is protecting the classic feel, or playing it too safe for a remake that needs to justify itself.",
    ]);
  }
  if (/\bvalor\s+mortis\b/i.test(combined) || /\bseptember\b[\s\S]{0,120}\bdelayed\b/i.test(combined)) {
    return proofScript([
      "Valor Mortis just admitted the release calendar is part of the boss fight.",
      `${source} says One More Level moved the game from September 24 to October 13 after September became a crowded release window.`,
      "That is only a short delay, but the message is loud: even confident games can get buried when Wolverine, Fire Emblem, Control and Minecraft all crowd the same month.",
      "The hot take is uncomfortable. Looking scared now might be smarter than launching bravely into a week nobody has room for.",
    ]);
  }
  if (/\b(?:gta\s*5|grand\s+theft\s+auto\s+v)\b[\s\S]{0,120}\bsubscription\b/i.test(combined)) {
    return proofScript([
      "GTA 5 just became Rockstar's GTA 6 waiting room.",
      `${source} says GTA 5 has joined the GTA+ library before GTA 6 lands in November.`,
      "Lapsed players now have a lower-friction reason to reinstall, while Rockstar keeps Los Santos busy during the sequel build-up.",
      "Subscription access still is not ownership, and one nostalgic session does not prove people are properly back.",
      "That is the argument worth having: jump back in because it is bundled, or save the appetite for GTA 6.",
    ]);
  }
  if (/\bai\s+stigma\b[\s\S]{0,120}\bsteam\b/i.test(combined) && /(?:53%|\bfewer\s+reviews\b|\breview\s+volume\b|\bmore\s+negative\b)/i.test(combined)) {
    return proofScript([
      "AI labels on Steam might already be changing player behaviour.",
      `${source} says an analysis found games disclosing AI content can receive around 53% fewer reviews, with the reviews they do get skewing more negative.`,
      "That matters because review count is not just noise on Steam. It affects trust, visibility and whether a curious player gives the game a chance at all.",
      "The debate is bigger than one tag: should AI disclosure be a warning label, or are players punishing games before they even see the work?",
    ]);
  }
  if (/\b(?:lost|losing|wipe|wiped|reset)\b[\s\S]{0,100}\b(?:save|progress)\b|\b(?:save|progress)\b[\s\S]{0,100}\b(?:lost|losing|wipe|wiped|reset)\b/i.test(combined)) {
    return proofScript([
      `${subject} has the kind of bug players do not forgive quickly.`,
      `${source} says players are being told to apply a new patch to avoid losing save data and progress.`,
      "That is bigger than a normal hotfix because progress loss attacks the one thing racing games ask for most: time.",
      "The useful test is simple. If the patch stops the wipe, this becomes a scary week. If it does not, every garage, tune and rare unlock feels less safe.",
    ]);
  }
  if (/\brunescape\s*:?\s*dragonwilds\b|\bdragonwilds\b/i.test(combined)) {
    return proofScript([
      "RuneScape: Dragonwilds is trying to make one last Early Access impression before its 1.0 launch.",
      `${source} says the survival spin-off is getting another major update later this month ahead of that launch.`,
      "Patch size is the boring part. What matters is whether gathering, crafting and combat still feel good in the tenth hour, not just the first trailer minute.",
      "If this update lands, Dragonwilds gets momentum before 1.0. If it does not, launch day has to do all the convincing by itself.",
    ]);
  }
  if (/\bgears\s+of\s+war\s*:?\s*e[-\s]?day\b/i.test(combined)) {
    return proofScript([
      "Gears Of War: E-Day has to make Xbox's safest franchise feel dangerous again.",
      `${source} says the 2026 prequel brings Marcus and Dom back before the first game, with campaign, co-op and multiplayer all in the package.`,
      "That sounds comfortable, which is exactly the problem. Xbox does not just need another recognisable exclusive; it needs one that feels urgent in a year where every platform argument is louder.",
      "The payoff is brutal: if E-Day feels like a comeback, Xbox gets a flagship. If it feels like nostalgia management, the chainsaw will not hide it.",
    ]);
  }
  if (/\bfable\b[\s\S]{0,120}\b(?:delay|delayed|avoiding\s+gta\s*6)\b/i.test(combined)) {
    return proofScript([
      "Fable's delay is starting to look less like weakness and more like survival.",
      `${source} says the reboot's move was disappointing for developers, but avoiding GTA 6 makes sense.`,
      "That is the player angle: nobody wants Xbox's fantasy reset judged in a release window where Rockstar eats every headline.",
      "The risk is obvious too. Every delay makes fans ask whether Fable is being protected, or whether Xbox still cannot land one of its biggest promises cleanly.",
      "The debate now is whether patience gives Fable room to breathe, or just raises the bar again.",
    ]);
  }
  if (/\bdragon['â€™]?s\s+dogma\s+2\b/i.test(combined)) {
    return proofScript([
      "Dragon's Dogma 2 is getting the kind of update that only matters if it fixes everyday friction.",
      `${source} says the first of two major updates is arriving ahead of Dark Arisen DLC.`,
      "Players will not judge that by the patch-note headline. They will judge travel, quest flow, pawn behaviour and whether returning now feels less punishing than it did at launch.",
      "That is the useful argument: Dark Arisen can be nostalgia bait, or it can become the excuse to reinstall if Capcom fixes the pain first.",
    ]);
  }
  if (/\bquake\s+champions\b/i.test(combined)) {
    return proofScript([
      "Quake Champions is not dead; it is trying to pull lapsed arena-shooter fans back into the conversation.",
      `${source} says the game has a huge anniversary update and a free battle pass for Quake's 30th birthday.`,
      "Free rewards make the reinstall easier to justify, but they also create a sharper test: can an old-school shooter turn one celebration into actual momentum?",
      "If this lands, Quake Champions gets more than a birthday patch. It gets a reason for old players to check whether the arena still has teeth.",
    ]);
  }
  if (/\belder\s+scrolls\s+6\b/i.test(subject) || /\b(?:xbox chief|disappointing update|years away|still waiting)\b/i.test(combined)) {
    return proofScript([
      "The Elder Scrolls 6 just got the update fans hate most: words without proof.",
      `${source} says Xbox's latest comment keeps the game in motion, but still does not give players a proper re-reveal.`,
      "That is why the frustration is bigger than impatience. Bethesda announced this game years ago, and every vague answer now gets judged like proof the wait is still nowhere near over.",
      "Fans do not need another reassurance loop; they need one screen, one date, or one reason to believe the silence is ending.",
    ]);
  }
  if (/\bhalo\b[\s\S]{0,120}\b(?:remake|campaign\s+evolved)\b/i.test(combined)) {
    return proofScript([
      "Halo: Campaign Evolved has the one remake test that cannot be solved with prettier levels.",
      `${source} compared the new gameplay with the original, which is exactly where the pressure lives.`,
      "For Halo fans, the rifle rhythm, enemy dance and movement speed matter more than any shiny lighting pass.",
      "If those details feel wrong, nostalgia turns against the remake fast. If they feel right, Xbox has a cleaner way to sell the same campaign to people who know every corridor already.",
    ]);
  }
  if (/\b(?:valorant|vanguard)\b/i.test(combined) && /\b(?:anti[-\s]?cheat|cheat|cheater|bricking|paperweight)\b/i.test(combined)) {
    return cleanText(
      `${subject}'s Vanguard update has a nasty trust problem. ` +
        `${source} reports the anti-cheat drama centres on cheaters claiming bricked PCs, with Riot firing back using the paperweight line. ` +
        `The headline is funny, but the real story is heavier: Vanguard runs deep enough that every scare becomes a trust test for legitimate players too. ` +
        `${PRIMARY_PULSE_CTA}.`,
    );
  }
  if (/\bgranblue\s+fantasy\s*:?\s*relink\b/i.test(combined)) {
    return proofScript([
      "Granblue Fantasy: Relink just made its next update much harder to ignore.",
      `${source} says Endless Ragnarok now has a playable demo after a new hands-on preview.`,
      "That matters because this is not another trailer promise. Players can try the combat rhythm, party builds and boss pressure, then decide whether the grind is worth coming back for.",
      "The payoff is simple: if the demo makes the endgame loop feel sharper, Relink gets a second wind. If it feels like more of the same, fans find out before spending the time.",
    ]);
  }
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(combined) && /\b(?:podracing|roguelite)\b/i.test(combined)) {
    return proofScript([
      "Star Wars: Galactic Racer is turning podracing into something harsher than a nostalgia lap.",
      `${source} says the new reveal frames it as a roguelite racer, where each run has to survive changing hazards, upgrades and wipeout pressure.`,
      "Players have to decide whether to wishlist it for that repeat-run risk, or wait for one uncut race before trusting the pitch.",
      "If the handling makes every crash feel like a new route, this becomes a genuine wishlist fight; if it is only a familiar logo on repeat, fans will skip before lap two.",
    ]);
  }
  if (/\bsuper\s+yooka[-\s]?laylee\s+kart\b/i.test(combined)) {
    return proofScript([
      "Super Yooka-Laylee Kart is going after one of racing's most dangerous comparisons.",
      `${source} says ex-Rare developers are aiming to revive the spirit of Diddy Kong Racing.`,
      "That is bigger than a cute mascot pitch. Diddy Kong Racing worked because it felt like an adventure first and a racer second.",
      "The catch is handling. Players have to decide whether to wishlist this as a real kart rival, or wait until the handling proves nostalgia is not doing all the work.",
      "That is the pressure on Playtonic now. Tracks, items and character charm have to feel like discovery, not cosplay.",
      "If the handling has bite, this becomes a serious nostalgia upset. If it feels floaty, the comparison eats it alive.",
    ]);
  }
  if (/\bai\s+stigma\b/i.test(combined) && /\bsteam\b/i.test(combined) && /\breviews?\b/i.test(combined)) {
    return proofScript([
      "Steam's AI label is becoming a trust problem before some games even launch.",
      `${source} says a data analyst found games disclosing AI content can receive around 53% fewer Steam reviews, with the reviews they do get skewing more negative.`,
      "That matters because Steam reviews are visibility fuel. Fewer reviews can mean fewer chances to surface, fewer wishlist nudges and less confidence on the store page.",
      "The uncomfortable bit is that the label may be doing the damage before players even press install.",
    ]);
  }
  if (/\bsea\s+of\s+thieves\b/i.test(combined) && /\b(?:custom\s+seas|keys\s+to\s+the\s+seas|private\s+server|private\s+seas)\b/i.test(combined)) {
    return proofScript([
      "Sea of Thieves is testing a risky idea: safer seas.",
      `${source} says Custom Seas will let players shape private sessions instead of living entirely inside the normal public sandbox.`,
      "Players now have to decide what they actually want from the pirate fantasy: safer story nights, practice runs and creator events, or the messy danger of open seas.",
      "Rare now has to prove private seas can protect the magic without draining the chaos that made the game work.",
    ]);
  }
  if (/\bplaystation\s+plus\b|\bps\s+plus\b/i.test(combined) && /\b(?:leaving|library|july)\b/i.test(combined)) {
    return proofScript([
      "PlayStation Plus has the update subscribers ignore until it suddenly costs them.",
      `${source} says another batch of games is leaving the PS Plus library in July.`,
      "Subscribers have to decide what to finish, download or abandon before the library changes, because a backlog can become a buy-it-or-drop-it decision overnight.",
      "The useful move is simple: check the leaving list before starting something huge, because a save file is not much help if the game disappears first.",
    ]);
  }
  if (/\bxbox\b/i.test(combined) && /\b(?:exclusive\s+label|exclusivity|console\s+dashboard)\b/i.test(combined)) {
    return proofScript([
      "Xbox's new exclusive label is trying to solve a problem Xbox created for itself.",
      `${source} says the dashboard is now using an EXCLUSIVE tag after years of muddy messaging around what actually stays on Xbox.`,
      "That label might help casual players, but it also invites a harsher question: exclusive for how long, on which console and what happens when PC or PlayStation enters the conversation?",
      "The payoff is the trust test. A label only works if players believe the promise behind it.",
    ]);
  }
  if (/\bghost\s+at\s+dawn\b/i.test(combined)) {
    return proofScript([
      "Ghost at Dawn is selling horror on something more interesting than jump scares.",
      `${source} says the game is built around fear, empathy and questionable choices.`,
      "Players have to decide whether those choices feel personal, because horror games are easy to market with monsters and much harder to make memorable with regret.",
      "If those choices actually change how the story feels, Ghost at Dawn has a hook. If not, it risks becoming another eerie trailer with no bite.",
    ]);
  }
  if (/\bend\s+of\s+abyss\b/i.test(combined)) {
    return proofScript([
      "End of Abyss has the kind of combat pitch that only works if the screen stays readable.",
      `${source} says the hands-on build mixes exploration, pressure and Little Nightmare energy inside a hostile facility.`,
      "Players have to judge whether movement, enemy tells and resource pressure stay clear once the action gets messy, not just whether the world looks strange.",
      "If that loop clicks, End of Abyss becomes a real watchlist game. If it does not, the atmosphere will be doing too much of the work.",
    ]);
  }
  if (/\bgungrave\s+g\.?o\.?r\.?e\.?\s+blood\s+heat\b/i.test(combined)) {
    return proofScript([
      "Gungrave Gore Blood Heat has to prove the action is cleaner, not just louder.",
      `${source} says the preview points to a remake trying to refine the original's combat foundation.`,
      "Fans have to decide whether camera distance, hit feedback and enemy readability make the spectacle feel good after the first minute.",
      "If those basics land, Blood Heat gets a comeback angle. If they do not, the style is only hiding the same old problem.",
    ]);
  }
  if (/\b(?:hire|hiring|chief\s+strategy|leadership|executive|officer)\b/i.test(combined)) {
    return proofScript([
      `${subject} just made a leadership move that says where the platform fight is heading.`,
      `${source} says ${claim}.`,
      "The job title is not the useful part for players. The useful part is whether strategy changes lead to clearer exclusives, cleaner pricing and first-party games that arrive without mixed messages.",
      "If the next year still feels confused, leadership reshuffles will look like noise. If the games get clearer, this becomes one of the first signs the plan changed.",
    ]);
  }
  if (/\bea\s+sports\s+fc\s*26\b/i.test(combined) && /\bea\s+play\b/i.test(combined)) {
    return proofScript([
      "EA Sports FC 26 just became a much easier yes-or-no test.",
      `${source} says the game is now available through EA Play.`,
      "That changes the value question for football fans who skipped launch, because the risk moves from full-price regret to a subscription trial.",
      "If late access pulls casual players back before the next annual reset, FC 26 gets a second life. If it does not, the annual cycle has already moved on.",
    ]);
  }
  if (/\bdave\s+the\s+diver\b/i.test(combined) && /\bjungle\b/i.test(combined)) {
    return proofScript([
      "Dave The Diver just took its cosy loop somewhere riskier.",
      `${source} says the new In The Jungle DLC is out now.`,
      "That is a strong test for players who love one brilliant routine: dive, serve, upgrade, repeat, then decide whether the next biome is worth another run.",
      "If the jungle makes that loop feel fresh again, Dave gets a smart second act. If it does not, the ocean was always the real star.",
    ]);
  }
  if (/\bthe\s+adventures\s+of\s+elliot\b/i.test(combined)) {
    return proofScript([
      "The Adventures Of Elliot is making Square Enix's retro pitch more specific.",
      `${source} breaks down how its exploration, combat and discovery are meant to work together.`,
      "That matters because nostalgia alone is cheap. Players need to know whether the old-school look is carrying modern choices, readable fights and a world worth poking at.",
      "If those pieces click, Elliot becomes more than a throwback. If they do not, the style does all the talking and the adventure fades fast.",
    ]);
  }
  if (/\bthe\s+planet\s+crafter\b/i.test(combined)) {
    return proofScript([
      "The Planet Crafter is about to find out whether its survival loop works on PS5.",
      `${source} says the terraforming survival game launches on PlayStation 5 on July 21.`,
      "Console players can try the slower fantasy that made it stand out on PC: turning a dead planet into somewhere livable piece by piece.",
      "If the controls, pacing and base-building feel right on a pad, this becomes a quiet comfort grind. If they do not, the planet stays easier to admire than to live on.",
    ]);
  }
  let lead = `${subject} has one clear detail players can check before the hype gets ahead of it.`;
  let sourceBeat = `${source} says ${claim}.`;
  let impact = "The player test is simple: does this change what people install, wishlist, finish or ignore?";
  let payoff = "If it changes that decision, the story earns attention. If it does not, it is background noise.";
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
  } else if (concretePriceOrAccessSignal(combined) && /\b(?:price|cost|deal|sale|discount|subscription|pass)\b/i.test(combined)) {
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
  return cleanText(`${lead} ${sourceBeat} ${impact} ${payoff} ${PRIMARY_PULSE_CTA}.`);
}

function generatedMotionClipsForStory(story = {}) {
  const safeId = cleanId(story.id || story.title || "story");
  const readableCardDurationS = 4.2;
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
    source_kind: "owned_source_card_explainer_motion",
    media_kind: "owned_explainer_motion",
    rights_risk_class: "owned_generated_motion",
    durationS: readableCardDurationS,
    validated: true,
    owned_explainer_visual_plan: true,
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

function restoredMotionClipHasRightsBasis(clip = {}) {
  if (!looksLikeRealMotionClip(clip)) return false;
  if (clip.validated === false || clip.segmentValidationPassed === false) return false;
  const sourceText = [
    clip.source_type,
    clip.source_kind,
    clip.source_url_kind,
    clip.rights_risk_class,
    clip.allowed_render_use,
    clip.provider,
    clip.provenance?.source,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();
  return /official|licensed_direct_media|steam|platform_storefront|playstation|xbox|nintendo/.test(sourceText);
}

function rightsForRestoredMotionClip(clip = {}) {
  if (!restoredMotionClipHasRightsBasis(clip)) return null;
  const assetId = cleanText(clip.id || clip.clip_id || clip.source_family || clip.path || clip.source_url);
  return {
    asset_id: assetId,
    path: cleanText(clip.local_materialized_path || clip.path),
    source_url: cleanText(clip.source_url || clip.url),
    source_type: cleanText(clip.source_type || "official_reference_clip"),
    source_family: cleanText(clip.source_family || clip.motion_family),
    base_source_family: cleanText(clip.base_source_family || clip.provenance?.base_source_family),
    rights_risk_class: cleanText(clip.rights_risk_class || "official_reference_only"),
    licence_basis: cleanText(
      clip.licence_basis ||
        clip.license_basis ||
        clip.allowed_render_use ||
        "official_source_documented_transformative_editorial_use",
    ),
    allowed_use: cleanText(clip.allowed_render_use || "transformative_editorial_short_form"),
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
    commercial_use_allowed: true,
    risk_score: Number.isFinite(Number(clip.risk_score)) ? Number(clip.risk_score) : 0.28,
    evidence_file: cleanText(clip.evidence_file || clip.provenance?.source_report || "visual_v4_motion_pack_manifest"),
    approval_status: "approved_for_transformative_editorial_use",
  };
}

function dedupeRightsRecords(records = []) {
  const out = [];
  const seen = new Set();
  for (const record of asArray(records)) {
    const key = cleanText(record.asset_id) || cleanText(record.path) || cleanText(record.source_url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function dedupeAssetRecords(records = []) {
  const out = [];
  const seen = new Set();
  for (const record of asArray(records)) {
    const key = cleanText(record.asset_id || record.id) || cleanText(record.source_url || record.path || record.file_path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function normaliseStory(story = {}) {
  const sfxAssetInventory = dedupeAssetRecords([
    ...assetsFromMaybeJson(story.sfx_asset_inventory, story.sfx_asset_inventory || []),
    ...assetsFromMaybeJson(story.sfx_assets, story.sfx_assets || []),
  ]);
  const sfxRightsLedger = dedupeRightsRecords([
    ...recordsFromMaybeJson(story.sfx_rights_ledger, story.sfx_rights_ledger || []),
    ...recordsFromMaybeJson(story.sfx_rights_records, story.sfx_rights_records || []),
  ]);
  return {
    ...story,
    video_clips: asArray(parseMaybeJson(story.video_clips, story.video_clips || [])),
    visual_v4_local_motion_clips: asArray(parseMaybeJson(
      story.visual_v4_local_motion_clips,
      story.visual_v4_local_motion_clips || [],
    )),
    downloaded_images: asArray(parseMaybeJson(story.downloaded_images, story.downloaded_images || [])),
    game_images: asArray(parseMaybeJson(story.game_images, story.game_images || [])),
    sfx_asset_inventory: sfxAssetInventory,
    sfx_assets: sfxAssetInventory,
    sfx_rights_ledger: sfxRightsLedger,
    affiliate_link_manifest:
      parseMaybeJson(story.affiliate_link_manifest, story.affiliate_link_manifest || null) ||
      story.commercial_intelligence ||
      null,
  };
}

function hydrateStoryWithSharedSfx(story = {}, { sfxAssetInventory = [], sfxRightsLedger = [] } = {}) {
  const sharedAssets = assetsFromMaybeJson(sfxAssetInventory, sfxAssetInventory);
  const sharedRights = recordsFromMaybeJson(sfxRightsLedger, sfxRightsLedger);
  if (!sharedAssets.length && !sharedRights.length) return story;
  const storyAssets = assetsFromMaybeJson(story.sfx_asset_inventory || story.sfx_assets, story.sfx_asset_inventory || story.sfx_assets || []);
  const storyRights = recordsFromMaybeJson(story.sfx_rights_ledger || story.sfx_rights_records, story.sfx_rights_ledger || story.sfx_rights_records || []);
  const mergedAssets = dedupeAssetRecords([...storyAssets, ...sharedAssets]);
  const mergedRights = dedupeRightsRecords([...storyRights, ...sharedRights]);
  return {
    ...story,
    sfx_asset_inventory: mergedAssets,
    sfx_assets: mergedAssets,
    sfx_rights_ledger: mergedRights,
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

function objectSource(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstCleanField(sources = [], fields = []) {
  for (const source of sources.map(objectSource)) {
    for (const field of fields) {
      const value = cleanText(source[field]);
      if (value) return value;
    }
  }
  return "";
}

function firstPositiveNumberField(sources = [], fields = []) {
  for (const source of sources.map(objectSource)) {
    for (const field of fields) {
      const value = Number(source[field]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

function hydrateStoryWithExistingGoalArtifacts(story = {}, { existingArtifactRoot = "" } = {}) {
  const normalised = normaliseStory(story);
  if (!existingArtifactRoot) return normalised;
  const storyId = normalised.id || normalised.story_id;
  if (!storyId) return normalised;
  const artifactDir = path.join(path.resolve(existingArtifactRoot), cleanId(storyId));
  if (!fs.existsSync(artifactDir)) return normalised;
  const renderManifest = readJsonSyncIfPresent(path.join(artifactDir, "render_manifest.json"), null);
  const audioManifest = readJsonSyncIfPresent(path.join(artifactDir, "audio_manifest.json"), null);
  const narrationManifest = readJsonSyncIfPresent(path.join(artifactDir, "narration_manifest.json"), null);
  const captionManifest = readJsonSyncIfPresent(path.join(artifactDir, "caption_manifest.json"), null);
  const finalRenderPath = path.join(artifactDir, "visual_v4_render.mp4");
  const hydrated = {
    ...normalised,
    goal_proof_artifact_dir: artifactDir,
  };

  if (renderManifest && renderManifest.final_publish_render === true) {
    hydrated.render_manifest = {
      ...renderManifest,
      output_path: cleanText(renderManifest.output_path) || finalRenderPath,
    };
    hydrated.exported_path = hydrated.render_manifest.output_path;
    hydrated.final_publish_render = true;
  }

  const audioEvidenceSources = [
    audioManifest,
    narrationManifest,
    captionManifest,
    objectSource(renderManifest).input_evidence,
    renderManifest,
  ];
  const narrationPath = firstCleanField(audioEvidenceSources, [
    "resolved_narration_audio_path",
    "narration_audio_path",
    "resolved_audio_path",
    "audio_path",
    "approved_audio_path",
  ]);
  const timestampPath = firstCleanField(audioEvidenceSources, [
    "resolved_word_timestamps_path",
    "word_timestamps_path",
    "resolved_timestamps_path",
    "timestamps_path",
  ]);
  const timestampSource = firstCleanField(audioEvidenceSources, [
    "word_timestamp_source",
    "timestamp_source",
    "word_timestamp_alignment_required",
  ]);
  const timestampCount = firstPositiveNumberField(audioEvidenceSources, [
    "word_timestamp_count",
    "word_count",
  ]);
  const voiceStatus = firstCleanField(audioEvidenceSources, [
    "voice_status",
    "audio_status",
    "status",
  ]);
  if (audioManifest && typeof audioManifest === "object" || narrationPath || timestampPath || timestampSource || timestampCount) {
    const recoveredAudioManifest = {
      ...objectSource(audioManifest),
    };
    if (narrationPath) {
      recoveredAudioManifest.narration_audio_path = narrationPath;
      recoveredAudioManifest.resolved_narration_audio_path = recoveredAudioManifest.resolved_narration_audio_path || narrationPath;
      hydrated.audio_path = narrationPath;
      hydrated.narration_audio_path = narrationPath;
    }
    if (timestampPath) {
      recoveredAudioManifest.word_timestamps_path = timestampPath;
      recoveredAudioManifest.resolved_word_timestamps_path = recoveredAudioManifest.resolved_word_timestamps_path || timestampPath;
      hydrated.timestamps_path = timestampPath;
      hydrated.word_timestamps_path = timestampPath;
    }
    if (timestampSource) {
      recoveredAudioManifest.word_timestamp_source = timestampSource;
      hydrated.word_timestamp_source = timestampSource;
    }
    if (timestampCount) {
      recoveredAudioManifest.word_timestamp_count = timestampCount;
      hydrated.word_timestamp_count = timestampCount;
    }
    if (voiceStatus || narrationPath) {
      recoveredAudioManifest.voice_status = voiceStatus || recoveredAudioManifest.voice_status || "materialized_existing_pair";
      hydrated.voice_status = recoveredAudioManifest.voice_status;
    }
    hydrated.audio_manifest = recoveredAudioManifest;
  }

  return hydrated;
}

function canonicalMotionSourceUrl(value = "") {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (/^video\.(?:akamai|fastly)\.steamstatic\.com$/.test(host) || host === "video.steamstatic.com") {
      return `https://video.steamstatic.com${url.pathname}`;
    }
  } catch {}
  return raw;
}

function metadataMatchesClip(meta = {}, clip = {}) {
  const sourceUrl = cleanText(clip.source_url || clip.path || clip.url);
  const metaSourceUrl = cleanText(meta.source_url);
  if (!sourceUrl || canonicalMotionSourceUrl(metaSourceUrl) !== canonicalMotionSourceUrl(sourceUrl)) return false;
  const wantedStart = Number(clip.mediaStartS ?? clip.media_start_s);
  const actualStart = Number(meta.media_start_s ?? meta.mediaStartS);
  if (!Number.isFinite(wantedStart) || !Number.isFinite(actualStart)) return true;
  return Math.abs(wantedStart - actualStart) <= 0.15;
}

function clipWindowNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed.toFixed(2);
  }
  return "";
}

function dedupeMotionClipsByWindow(clips = []) {
  const out = [];
  const seen = new Set();
  for (const clip of asArray(clips)) {
    const source = canonicalMotionSourceUrl(cleanText(clip.source_url || clip.path || clip.url));
    const family = cleanText(clip.source_family || clip.family || clip.motion_family);
    const start = clipWindowNumber(clip.mediaStartS, clip.media_start_s, clip.start_seconds, clip.startS);
    const end = clipWindowNumber(clip.mediaEndS, clip.media_end_s, clip.end_seconds, clip.endS);
    const duration = clipWindowNumber(clip.durationS, clip.duration_s, clip.duration_seconds);
    const key = [source, family, start, end, duration].join("|");
    if (!source || seen.has(key)) continue;
    seen.add(key);
    out.push(clip);
  }
  return out;
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
  return dedupeMotionClipsByWindow(asArray(motionPack.handoff?.visual_v4_local_motion_clips || motionPack.clips))
    .map((clip, index) => {
      const localPath = cachedClipPathFor({ clip, storyId, videoCacheDir });
      const hydratedClip = localPath
        ? { ...clip, path: localPath, local_materialized_path: localPath }
        : clip;
      if (!looksLikeRealMotionClip(hydratedClip)) return null;
      const originalSourceUrl = cleanText(clip.source_url || clip.url || (/^https?:\/\//i.test(cleanText(clip.path)) ? clip.path : ""));
      return {
        ...clip,
        id: cleanText(clip.id || clip.clip_id || `${cleanId(storyId)}_v4_motion_${index + 1}`),
        type: "motion_clip",
        source_family: cleanText(clip.source_family || clip.family || `v4_motion_family_${index + 1}`),
        path: cleanText(hydratedClip.path),
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
    .filter((clip) => clip && cleanText(clip.path));
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
  const rawScript = ensurePulseCta(normalised.full_script || normalised.tts_script || "");
  const rawScriptScore = rawScript
    ? buildViralScriptIntelligence({
        story: { ...normalised, canonical_subject: canonicalSubject, source_name: sourceName },
        script: rawScript,
      })
    : null;
  const rawScriptUsable =
    Boolean(rawScript) &&
    rawScriptScore?.verdict !== "rewrite_required" &&
    !asArray(rawScriptScore?.blockers).length &&
    !scriptLooksUnsafeForGoalProof(rawScript) &&
    !scriptLooksCrossStoryContaminated(rawScript, normalised, canonicalSubject) &&
    !ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(rawScript);
  const initialScript = rawScriptUsable ? rawScript : ensureSubjectOpening(rawScript, canonicalSubject);
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
  const publicDescription = publicDescriptionForProof({
    story: normalised,
    subject: canonicalSubject,
    sourceName,
    script,
  });
  const safeConfirmedClaim = safeClaimForProof({ ...normalised, full_script: script }, canonicalSubject);
  const confirmedClaims = uniqueValues([
    ...asArray(normalised.confirmed_claims),
    ...asArray(normalised.claim_inventory?.confirmed),
    safeConfirmedClaim,
  ].filter(Boolean));
  const claimInventory = {
    ...(normalised.claim_inventory && typeof normalised.claim_inventory === "object" ? normalised.claim_inventory : {}),
    confirmed: confirmedClaims,
    unconfirmed: asArray(normalised.claim_inventory?.unconfirmed || normalised.unconfirmed_claims),
    prohibited: asArray(normalised.claim_inventory?.prohibited || normalised.prohibited_claims),
  };
  const prepared = {
    ...normalised,
    canonical_subject: canonicalSubject,
    canonical_game: (() => {
      const existingGame = cleanText(normalised.canonical_game || normalised.game_title);
      if (
        existingGame &&
        !subjectLooksGeneric(existingGame) &&
        containsSubject(canonicalSubject, existingGame)
      ) {
        return existingGame;
      }
      return canonicalSubject;
    })(),
    primary_source: sourceName,
    source_name: sourceName,
    source_card_label: cleanText(normalised.source_card_label || sourceName),
    thumbnail_source_label: cleanText(normalised.thumbnail_source_label || sourceName),
    article_url: storyUrl(normalised),
    title: publicTitle,
    public_title: publicTitle,
    selected_title: publicTitle,
    canonical_title: publicTitle,
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
    confirmed_claims: confirmedClaims,
    claim_inventory: claimInventory,
    full_script: script,
    tts_script: script,
    description: publicDescription,
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
  const restoredMotionRights = existingMotion.map(rightsForRestoredMotionClip).filter(Boolean);
  prepared.rights_ledger = dedupeRightsRecords([
    ...asArray(parseMaybeJson(normalised.rights_ledger, normalised.rights_ledger || [])),
    ...generatedRights,
    ...restoredMotionRights,
  ]);

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

function augmentStoriesWithRevenuePaths(stories = [], revenuePathDigest = {}, limit = 30, options = {}) {
  const out = asArray(stories).map(normaliseStory);
  if (options.fillRevenuePaths === false) {
    return out.slice(0, limit);
  }
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
    ...recordsFromMaybeJson(story.rights_ledger, story.rights_ledger || []),
    ...recordsFromMaybeJson(story.rights_records, story.rights_records || []),
    ...recordsFromMaybeJson(story.sfx_rights_ledger, story.sfx_rights_ledger || []),
    ...recordsFromMaybeJson(story.sfx_rights_records, story.sfx_rights_records || []),
    ...recordsFromMaybeJson(explicit, explicit),
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
  sfxAssetInventory = [],
  sfxRightsLedger = [],
  videoCacheDir = path.join(process.cwd(), "output", "video_cache"),
  existingArtifactRoot = "",
  allowOwnedMotionFallback = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const selected = asArray(stories)
    .map((story) => hydrateStoryWithExistingGoalArtifacts(story, { existingArtifactRoot }))
    .map((story) => hydrateStoryWithMotionPack(
      story,
      motionPackByStory[story.id || story.story_id],
      { videoCacheDir },
    ))
    .map((story) => hydrateStoryWithSharedSfx(story, { sfxAssetInventory, sfxRightsLedger }))
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
