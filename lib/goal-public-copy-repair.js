"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { normaliseText } = require("./text-hygiene");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { runScriptCoherenceQa, EXACT_CTA } = require("./script-coherence-qa");
const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const { PROTECTED_NAMES, runBrandNameQa } = require("./brand-name-qa");
const { mediaSourceUrlKindFields } = require("./media-source-url-kind");
const {
  groupIntoPhrases,
  prepareSubtitleWords,
  realignTimestampsToScript,
} = require("./studio/v2/subtitle-layer-v2");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return normaliseText(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

const ROUTE_OR_URL_RE = /(https?:\/\/\S+|\/(?:p|go)\/[^\s,.]+)/gi;

function normalisePublicTextSegment(value) {
  if (typeof value !== "string") return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const middleEnd = value.length - trailing.length;
  const middle = value.slice(leading.length, middleEnd);
  if (!middle) return value;
  return `${leading}${normaliseText(middle)}${trailing}`;
}

function normaliseProtectedNamesTextSegment(value) {
  if (typeof value !== "string") return value;
  let output = normalisePublicTextSegment(value);
  for (const entry of PROTECTED_NAMES) {
    for (const pattern of [...entry.damaged, ...entry.nonCanonical]) {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      output = output.replace(new RegExp(pattern.source, flags), entry.canonical);
    }
  }
  return output;
}

function normaliseProtectedNamesText(value) {
  if (typeof value !== "string") return value;
  let output = "";
  let lastIndex = 0;
  for (const match of value.matchAll(ROUTE_OR_URL_RE)) {
    const index = match.index ?? 0;
    output += normaliseProtectedNamesTextSegment(value.slice(lastIndex, index));
    output += match[0];
    lastIndex = index + match[0].length;
  }
  output += normaliseProtectedNamesTextSegment(value.slice(lastIndex));
  return output;
}

function normaliseProtectedNamesArray(values = []) {
  return asArray(values).map((item) => normaliseProtectedNamesText(item));
}

function normaliseProtectedNamesInManifest(manifest = {}) {
  const fields = [
    "canonical_subject",
    "canonical_game",
    "canonical_title",
    "selected_title",
    "short_title",
    "thumbnail_headline",
    "thumbnail_text",
    "first_spoken_line",
    "narration_hook",
    "narration_script",
    "full_script",
    "tts_script",
    "description",
    "pinned_comment",
  ];
  const updated = { ...manifest };
  for (const field of fields) {
    if (typeof updated[field] === "string") updated[field] = normaliseProtectedNamesText(updated[field]);
  }
  if (Array.isArray(updated.confirmed_claims)) {
    updated.confirmed_claims = normaliseProtectedNamesArray(updated.confirmed_claims);
  }
  if (Array.isArray(updated.allowed_public_wording)) {
    updated.allowed_public_wording = normaliseProtectedNamesArray(updated.allowed_public_wording);
  }
  if (Array.isArray(updated.title_candidates)) {
    updated.title_candidates = normaliseProtectedNamesArray(updated.title_candidates);
  }
  return normaliseProtectedNamesDeep(updated);
}

function shouldPreservePublicCopyKey(key = "") {
  return /(?:^id$|_id$|url$|href$|path$|route$|slug$|link$)/i.test(key);
}

function normaliseProtectedNamesDeep(value, key = "") {
  if (typeof value === "string") {
    return shouldPreservePublicCopyKey(key) ? value : normaliseProtectedNamesText(value);
  }
  if (Array.isArray(value)) return value.map((item) => normaliseProtectedNamesDeep(item, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      normaliseProtectedNamesDeep(childValue, childKey),
    ]),
  );
}

function sentenceList(value) {
  return clean(value)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bRead more\b.*$/i, "")
    .replace(/\bView Images\b.*$/i, "")
    .replace(/\bSource:\s*[^.]+\.?$/i, "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => clean(item))
    .filter(Boolean);
}

function storyText(manifest = {}) {
  return clean(
    [
      manifest.canonical_title,
      manifest.selected_title,
      manifest.short_title,
      manifest.description,
      manifest.narration_script,
      asArray(manifest.confirmed_claims).join(" "),
      manifest.primary_source_url,
    ].join(" "),
  );
}

const ADVERTISER_RISK_RE = /\b(?:porn|pornography|gambling|casino|betting|wagering|crypto)\b/i;

function sourceName(manifest = {}) {
  const source = clean(
    typeof manifest.primary_source === "string"
      ? manifest.primary_source
      : manifest.primary_source?.name,
  );
  const label = source || clean(manifest.source_card_label);
  if (sourceUrlSuggestsSteam(manifest)) return "Steam";
  const official = inferredOfficialSourceName(manifest);
  if (isMalformedSourceLabel(label) && official) return official;
  if (isPlatformHostSource(label, manifest) && official) return official;
  return label || official || "the source";
}

function sourceUrlForManifest(manifest = {}) {
  return clean(
    manifest.primary_source_url ||
      manifest.source_url ||
      manifest.article_url ||
      (manifest.primary_source && typeof manifest.primary_source === "object"
        ? manifest.primary_source.url || manifest.primary_source.source_url || manifest.primary_source.href
        : ""),
  );
}

function isPlatformHostSource(label = "", manifest = {}) {
  const sourceLabel = clean(label);
  const url = sourceUrlForManifest(manifest);
  return /^(?:youtube|youtu|youtu\.be)$/i.test(sourceLabel) && /(?:youtube\.com|youtu\.be)/i.test(url);
}

function sourceUrlSuggestsSteam(manifest = {}) {
  const url = sourceUrlForManifest(manifest);
  const text = storyText(manifest);
  return /(?:store\.steampowered\.com|steamcommunity\.com)/i.test(url) ||
    /\bavailable now on steam\b/i.test(text);
}

function isMalformedSourceLabel(label = "") {
  return /^(?:store|image|i|source|unknown|unknown source|reddit image|imgur|youtu|youtube|the phrasemaker|the shortmaker)$/i.test(
    clean(label),
  );
}

function inferredOfficialSourceName(manifest = {}) {
  const text = clean(
    [
      manifest.canonical_company,
      manifest.official_source,
      manifest.official_confirmation_source,
      manifest.canonical_title,
      manifest.description,
      asArray(manifest.confirmed_claims).join(" "),
    ].join(" "),
  );
  if (sourceUrlSuggestsSteam(manifest)) return "Steam";
  if (/\bxbox\b|\bmicrosoft\b|\bxbox partner preview\b/i.test(text)) return "Xbox";
  if (/\bplaystation\b|\bstate of play\b|\bsony\b/i.test(text)) return "PlayStation";
  if (/\bnintendo\b|\bnintendo direct\b/i.test(text)) return "Nintendo";
  if (/\bsteam\b|\bvalve\b/i.test(text)) return "Steam";
  return "";
}

const REPORTING_SOURCE_PREFIX_RE =
  /^(?:IGN|GameSpot|Eurogamer|PC Gamer|GamesRadar\+?|VGC|Video Games Chronicle|Kotaku|Polygon|Rock Paper Shotgun|RPS|PlayStation Blog|Xbox Wire|Nintendo|Steam|The Verge|Windows Central)\s+(?:reports?|says|confirms|claims|reveals|notes|writes)\s+(?:that\s+)?/i;

const SOURCE_ATTRIBUTION_ALIASES = [
  { key: "ign", aliases: ["IGN"] },
  { key: "gamespot", aliases: ["GameSpot"] },
  { key: "eurogamer", aliases: ["Eurogamer"] },
  { key: "pcgamer", aliases: ["PC Gamer"] },
  { key: "gamesradar", aliases: ["GamesRadar", "GamesRadar+"] },
  { key: "vgc", aliases: ["VGC", "Video Games Chronicle"] },
  { key: "kotaku", aliases: ["Kotaku"] },
  { key: "polygon", aliases: ["Polygon"] },
  { key: "rockpapershotgun", aliases: ["Rock Paper Shotgun", "RPS"] },
  { key: "playstationblog", aliases: ["PlayStation Blog"] },
  { key: "xboxwire", aliases: ["Xbox Wire"] },
  { key: "nintendo", aliases: ["Nintendo"] },
  { key: "steam", aliases: ["Steam"] },
  { key: "theverge", aliases: ["The Verge"] },
  { key: "windowscentral", aliases: ["Windows Central"] },
];

const SOURCE_ATTRIBUTION_SOURCE_TYPES = new Set([
  "reliable_publication_article",
  "review_aggregator",
  "official_game_page",
  "official_publisher_statement",
  "official_platform_storefront",
]);

const STANDALONE_PLATFORM_PACK_FILES = {
  "youtube_publish_pack.json": "youtube_shorts",
  "tiktok_publish_pack.json": "tiktok",
  "instagram_publish_pack.json": "instagram_reels",
  "facebook_publish_pack.json": "facebook_reels",
  "x_publish_pack.json": "x",
  "threads_publish_pack.json": "threads",
  "pinterest_publish_pack.json": "pinterest",
  "platform_variant_scorecard.json": null,
};

function stripReportingSourcePrefix(value = "") {
  return clean(value).replace(REPORTING_SOURCE_PREFIX_RE, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceKey(value = "") {
  const compact = clean(typeof value === "string" ? value : value?.name || value?.source_name || value?.label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!compact) return "";
  for (const source of SOURCE_ATTRIBUTION_ALIASES) {
    if (source.aliases.some((alias) => compact.includes(alias.toLowerCase().replace(/[^a-z0-9]+/g, "")))) {
      return source.key;
    }
  }
  return compact;
}

function isRedditSourceLabelOrUrl(label = "", url = "") {
  return /^(?:reddit|r\/[a-z0-9_]+|reddit review thread)$/i.test(clean(label)) ||
    /(?:^|\/\/)(?:www\.)?reddit\.com\//i.test(clean(url));
}

function sourceAttributionUrlIsImageOnly(url = "", label = "") {
  const text = clean(url);
  const sourceLabel = clean(label);
  if (!text) return false;
  if (/^(?:i|image|imgur|reddit image|image post)$/i.test(sourceLabel)) return true;
  if (mediaSourceUrlKindFields(text).source_url_kind === "image") return true;
  try {
    const host = new URL(text).hostname.toLowerCase().replace(/^www\./, "");
    return /^(?:i\.redd\.it|preview\.redd\.it|i\.imgur\.com|imgur\.com)$/.test(host);
  } catch {
    return false;
  }
}

function sourceTypeIsOfficial(type = "") {
  return /^official_/i.test(clean(type));
}

function hasOfficialAttribution(manifest = {}) {
  return sourceTypeIsOfficial(manifest.source_attribution_repair?.applied_source?.source_type) ||
    (clean(manifest.official_source) && !isRedditSourceLabelOrUrl(manifest.official_source));
}

function textMentionsSubject(value = "", subject = "") {
  const haystack = titleFingerprint(value);
  const anchors = subjectAnchors(subject);
  return !subject || anchors.some((anchor) => haystack.includes(anchor));
}

function normaliseSourceAttributionEntries(entries = []) {
  return asArray(entries)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const sourceNameText = clean(entry.source_name || entry.name || entry.primary_source);
      const sourceUrlText = clean(entry.source_url || entry.url || entry.primary_source_url);
      const sourceTypeText = clean(entry.source_type || "reliable_publication_article");
      const supportedClaim = clean(entry.supported_claim || entry.claim || entry.confirmed_claim);
      return {
        ...entry,
        story_id: clean(entry.story_id),
        source_name: sourceNameText,
        source_url: sourceUrlText,
        source_type: sourceTypeText,
        source_title: clean(entry.source_title || entry.title),
        supported_claim: supportedClaim,
        evidence_notes: clean(entry.evidence_notes || entry.evidence || entry.notes),
        secondary_sources: asArray(entry.secondary_sources).map((source) => ({
          name: clean(source.name || source.source_name || source.label),
          url: clean(source.url || source.source_url || source.href),
        })).filter((source) => source.name && source.url && !isRedditSourceLabelOrUrl(source.name, source.url)),
      };
    })
    .filter(Boolean);
}

function sourceAttributionEntryForStory(entries = [], storyId = "") {
  const id = clean(storyId);
  return normaliseSourceAttributionEntries(entries).find((entry) => entry.story_id === id) || null;
}

function validateSourceAttributionEntry(entry = {}, manifest = {}) {
  const failures = [];
  const subject = inferSubject(manifest);
  if (!entry.story_id) failures.push("source_attribution:missing_story_id");
  if (!entry.source_name) failures.push("source_attribution:missing_source_name");
  if (!entry.source_url) failures.push("source_attribution:missing_source_url");
  if (!entry.supported_claim) failures.push("source_attribution:missing_supported_claim");
  if (entry.source_type && !SOURCE_ATTRIBUTION_SOURCE_TYPES.has(entry.source_type)) {
    failures.push("source_attribution:unsupported_source_type");
  }
  try {
    const parsed = new URL(entry.source_url);
    if (!/^https?:$/.test(parsed.protocol)) failures.push("source_attribution:unsupported_url_protocol");
  } catch {
    failures.push("source_attribution:invalid_source_url");
  }
  if (isRedditSourceLabelOrUrl(entry.source_name, entry.source_url)) {
    failures.push("source_attribution:reddit_source_not_allowed_as_repair");
  }
  if (sourceAttributionUrlIsImageOnly(entry.source_url, entry.source_name)) {
    failures.push("source_attribution:image_only_source_not_allowed");
  }
  const evidenceText = [
    entry.source_name,
    entry.source_url,
    entry.source_title,
    entry.supported_claim,
    entry.evidence_notes,
  ].join(" ");
  if (!textMentionsSubject(evidenceText, subject)) {
    failures.push("source_attribution:subject_evidence_missing");
  }
  return failures;
}

function applySourceAttributionRepair(manifest = {}, entry = {}, { generatedAt = new Date().toISOString() } = {}) {
  const failures = validateSourceAttributionEntry(entry, manifest);
  if (failures.length) {
    return { manifest, failures, changed: false };
  }
  const previousSecondary = asArray(manifest.secondary_sources).filter(
    (source) => !isRedditSourceLabelOrUrl(source?.name || source?.source_name || source, source?.url || source?.source_url),
  );
  const sourceRecord = {
    name: entry.source_name,
    url: entry.source_url,
    source_type: entry.source_type,
    evidence_notes: entry.evidence_notes || null,
  };
  const secondarySources = [
    ...entry.secondary_sources,
    ...previousSecondary,
  ];
  const updated = {
    ...manifest,
    primary_source: entry.source_name,
    primary_source_url: entry.source_url,
    source_card_label: entry.source_name,
    secondary_sources: secondarySources,
    official_source: sourceTypeIsOfficial(entry.source_type) ? entry.source_name : null,
    official_confirmation_source: sourceTypeIsOfficial(entry.source_type)
      ? entry.source_url
      : clean(manifest.official_confirmation_source) || null,
    confirmed_claims: [entry.supported_claim],
    claim_inventory: {
      ...(manifest.claim_inventory && typeof manifest.claim_inventory === "object" ? manifest.claim_inventory : {}),
      confirmed: [entry.supported_claim],
    },
    source_confidence_score: Math.max(Number(manifest.source_confidence_score || 0), Number(entry.confidence_score || 0.86)),
    source_attribution_repaired_at: generatedAt,
    source_attribution_repair: {
      applied_source: sourceRecord,
      previous_primary_source: manifest.primary_source || null,
      previous_primary_source_url: manifest.primary_source_url || null,
      repair_reason: "reddit_discovery_label_used_as_primary_source",
    },
  };
  return {
    manifest: updated,
    failures: [],
    changed: JSON.stringify(manifest) !== JSON.stringify(updated),
  };
}

function namedReportingSources(text = "") {
  const haystack = clean(text);
  const found = new Set();
  for (const source of SOURCE_ATTRIBUTION_ALIASES) {
    for (const alias of source.aliases) {
      const escaped = escapeRegExp(alias);
      const reportingPattern = new RegExp(`\\b${escaped}\\s+(?:reports|says|confirms|claims|reveals|notes|writes)\\b`, "i");
      const sourceLabelPattern = new RegExp(`\\bsource:\\s*${escaped}\\b`, "i");
      if (reportingPattern.test(haystack) || sourceLabelPattern.test(haystack)) found.add(source.key);
    }
  }
  return Array.from(found);
}

function sourceAttributionFailuresForManifest(manifest = {}) {
  const allowed = new Set([
    sourceKey(manifest.primary_source),
    sourceKey(manifest.official_source),
    ...asArray(manifest.secondary_sources).map(sourceKey),
  ].filter(Boolean));
  if (!allowed.size) return [];
  const publicText = [
    manifest.narration_script,
    manifest.description,
    manifest.pinned_comment,
    asArray(manifest.confirmed_claims).join(" "),
  ].join(" ");
  return namedReportingSources(publicText).some((source) => !allowed.has(source))
    ? ["public_copy:source_label_mismatch"]
    : [];
}

function descriptionSubjectFailuresForManifest(manifest = {}) {
  const subject = inferSubject(manifest);
  const description = clean(manifest.description);
  if (!subject || !description) return [];
  const haystack = description
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const needle = clean(subject)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!needle || haystack.includes(needle)) return [];
  const firstSubjectToken = needle.split(/[^a-z0-9]+/).find((part) => part.length >= 5);
  return firstSubjectToken && !haystack.includes(firstSubjectToken)
    ? ["public_output:description_missing_canonical_subject"]
    : [];
}

function scriptCoherenceFailuresForManifest(manifest = {}) {
  const qa = runScriptCoherenceQa(
    {
      title: manifest.selected_title || manifest.short_title || manifest.canonical_title,
      full_script: manifest.narration_script || manifest.full_script || manifest.tts_script,
      tts_script: manifest.tts_script,
      hook: manifest.first_spoken_line || manifest.narration_hook,
      body: manifest.body,
      loop: manifest.loop,
      cta: manifest.cta,
      source_type: manifest.source_type,
      subreddit: manifest.subreddit,
      article_url: manifest.primary_source_url || manifest.article_url || manifest.source_url,
    },
    { requireCtaField: false, requireFullScriptCta: false },
  );
  return asArray(qa.failures);
}

function publicOutputRiskFailuresForManifest(manifest = {}) {
  const failures = [];
  if (ADVERTISER_RISK_RE.test(clean(manifest.narration_script || manifest.full_script || manifest.tts_script))) {
    failures.push("public_output:advertiser_unfriendly_narration");
  }
  if (ADVERTISER_RISK_RE.test(clean(manifest.description))) {
    failures.push("public_output:advertiser_unfriendly_description");
  }
  return failures;
}

function staleRevenueThumbnailFailuresForManifest(manifest = {}) {
  const title = clean(manifest.selected_title || manifest.short_title || manifest.canonical_title);
  if (!/Forza Horizon 6 Premium/i.test(title) || !/\$?140M|\$140\s*Million|140\s*Million/i.test(title)) {
    return [];
  }
  const expected = subjectAnchoredThumbnailHeadline(title, inferSubject(manifest));
  const current = clean(manifest.thumbnail_headline || manifest.thumbnail_text);
  return current && current !== expected ? ["public_copy:stale_revenue_thumbnail_headline"] : [];
}

function protectedBrandNameFailuresForManifest(manifest = {}) {
  const qa = runBrandNameQa({
    title: manifest.selected_title || manifest.short_title || manifest.canonical_title || "",
    thumbnail_headline: manifest.thumbnail_headline || manifest.thumbnail_text || "",
    first_spoken_line: manifest.first_spoken_line || manifest.narration_hook || "",
    full_script: manifest.narration_script || manifest.full_script || manifest.tts_script || "",
    description: manifest.description || "",
  });
  return [
    ...asArray(qa.failures).map((failure) => `public_copy:${failure}`),
    ...asArray(qa.warnings).map((warning) => `public_copy:${warning}`),
  ];
}

function canonicalEntityMismatchFailuresForManifest(manifest = {}) {
  const inferredSubject = inferSubject(manifest);
  const currentSubject = clean(manifest.canonical_subject);
  const currentGame = clean(manifest.canonical_game);
  const title = clean(manifest.selected_title || manifest.short_title || manifest.canonical_title);
  const failures = [];
  if (
    inferredSubject &&
    currentSubject &&
    currentSubject !== inferredSubject &&
    titleMentionsSubject(title, inferredSubject)
  ) {
    failures.push("public_copy:canonical_subject_mismatch");
  }
  if (
    inferredSubject &&
    currentGame &&
    currentGame !== inferredSubject &&
    (currentGame === currentSubject || titleMentionsSubject(title, inferredSubject))
  ) {
    failures.push("public_copy:canonical_game_mismatch");
  }
  return [...new Set(failures)];
}

function packageRepairFailures(manifest = {}, copyQa = evaluateGoalPublicCopy(manifest)) {
  return [
    ...asArray(copyQa.failures),
    ...descriptionSubjectFailuresForManifest(manifest),
    ...scriptCoherenceFailuresForManifest(manifest),
    ...publicOutputRiskFailuresForManifest(manifest),
    ...sourceAttributionFailuresForManifest(manifest),
    ...staleRevenueThumbnailFailuresForManifest(manifest),
    ...protectedBrandNameFailuresForManifest(manifest),
    ...canonicalEntityMismatchFailuresForManifest(manifest),
  ];
}

function inferSubject(manifest = {}) {
  const text = storyText(manifest);
  const current = clean(manifest.canonical_subject || manifest.canonical_game);
  const currentLooksGeneric = /^(?:this (?:story|gaming story)|rumou?r|gaming story|game story|story|news|update)$/i.test(current);
  if (/\bkadokawa\b/i.test(text) && /\boasis management\b|\bsony\b/i.test(text)) return "Kadokawa";
  if (/\bv rising\b/i.test(text) && /\bvampire game\b/i.test(text)) return "V Rising";
  if (/\bps5\b|\bplaystation 5\b/i.test(text) && /\bprice hike|price increase|more expensive\b/i.test(text)) return "PS5";
  if (/\bthe expanse:\s*osiris reborn\b/i.test(text)) return "The Expanse: Osiris Reborn";
  if (/\bcrimson desert\b/i.test(text)) return "Crimson Desert";
  if (/\bnew xbox ceo\b|\bxbox ceo\b|\bexclusive games\b|\bxbox player voice\b/i.test(text)) return "Xbox";
  if (/\bpok[eé]mon professor\b/i.test(text) && /\bnintendo\b/i.test(text)) return "Nintendo";
  if (/\bsuper mario rpg\b/i.test(text)) return "Super Mario RPG";
  if (/\bsteam controller\b/i.test(text) && /\b(?:release date|release timing|date may have leaked|leaked online)\b/i.test(text)) {
    return "Steam Controller";
  }
  if (/\bstar wars:\s*galactic racer\b/i.test(text)) return "Star Wars: Galactic Racer";
  if (/\bkickstarter\b/i.test(text)) return "Kickstarter";
  if (/\bspellcasters chronicles\b/i.test(text)) return "Spellcasters Chronicles";
  if (/\blego batman\b/i.test(text)) return "Lego Batman";
  if (/\bdestiny 2\b/i.test(text)) return "Destiny 2";
  if (/\bdawn of war (?:iv|4)\b/i.test(text)) return "Warhammer 40,000: Dawn of War 4";
  if (/\bspace marine 2\b/i.test(text)) return "Warhammer 40,000: Space Marine 2";
  if (/\btotal war:\s*warhammer 40,?000\b/i.test(text)) return "Total War: Warhammer 40,000";
  if (/\bboltgun 2\b/i.test(text)) return "Warhammer 40,000: Boltgun 2";
  if (/\bboltgun boom\b/i.test(text)) return "Warhammer 40,000: Boltgun Boom";
  if (/\bdeathmaster\b/i.test(text)) return "Warhammer Age Of Sigmar: Deathmaster";
  if (/\bhelldivers 2\b/i.test(text)) return "Helldivers 2";
  if (/\b007 first light\b/i.test(text)) return "007 First Light";
  if (/\bmodern warfare 4\b/i.test(text)) return "Modern Warfare 4";
  if (/\bplaystation plus\b/i.test(text)) return "PlayStation Plus";
  if (/\bplaystation store\b/i.test(text)) return "PlayStation Store";
  if (/\bsubnautica 2\b/i.test(text)) return "Subnautica 2";
  if (/\bassassin'?s creed black flag\b/i.test(text)) return "Assassin's Creed Black Flag";
  if (/\bparanormal activity\b/i.test(text)) return "Paranormal Activity: Threshold";
  if (/\bgamesir g7 pro\b/i.test(text)) return "GameSir G7 Pro";
  if (/\bxbox wireless controller\b|\bxbox controller\b/i.test(text)) return "Xbox Controller";
  if (/\bstar fox\b/i.test(text)) return "Star Fox";
  if (/^xbox$/i.test(current)) return "Xbox";
  if (current && !currentLooksGeneric) return current.replace(/\s+/g, " ").replace(/[":]+$/g, "").trim();
  return "Gaming Story";
}

function titleFromHeuristics(subject, manifest = {}) {
  const text = storyText(manifest);
  if (subject === "Kadokawa" && /\boasis management\b|\bsony\b/i.test(text)) return "Kadokawa Stake Just Passed Sony";
  if (subject === "V Rising" && /\bvampire game\b/i.test(text)) return "V Rising Devs Are Making Another Vampire Game";
  if (subject === "Super Mario RPG" && /\b(?:\d{1,3}%\s*off|discount|sale|deal|lowest price|\$15)\b/i.test(text)) {
    return "Super Mario RPG Drops To $15";
  }
  if (subject === "PS5" && /\bprice hike|price increase|more expensive\b/i.test(text)) {
    return hasOfficialAttribution(manifest)
      ? "PS5 Prices Went Up In Europe"
      : "PS5 Price Hike Rumour Hits Europe";
  }
  if (subject === "The Expanse: Osiris Reborn") return "The Expanse Shows Real Gameplay";
  if (subject === "Xbox" && /\bexclusive games\b|\bnew xbox ceo\b/i.test(text)) return "Xbox Exclusives Are Back Under Review";
  if (subject === "Crimson Desert" && /\b(?:launch|release|march 19|global launch)\b/i.test(text)) {
    return "Crimson Desert Is Already Live";
  }
  if (subject === "Nintendo" && /\bpok[eé]mon professor\b/i.test(text)) return "Nintendo Professor Lawsuit Just Got Weird";
  if (subject === "Star Wars: Galactic Racer") return "Star Wars Racer Date Leaked Early";
  if (subject === "Star Wars Zero Company") return "Star Wars Zero Company Is More Than XCOM";
  if (subject === "Deus Ex") return "Deus Ex Composer Says The Jobs Vanished";
  if (subject === "Pragmata" && /\bAI generated|AI-generated|new york stage\b/i.test(text)) {
    return "Pragmata's AI-Look Stage Was Handmade";
  }
  if (subject === "STRANGER THAN HEAVEN Five Eras") return "Stranger Than Heaven Shows Five Eras";
  if (subject === "Forza Horizon 6" && /\breview\b/i.test(text) && /\bpc gamer\b/i.test(text)) {
    return "Forza Horizon 6 Scores 84 On PC Gamer";
  }
  if (subject === "Forza Horizon 6" && /\breview thread\b/i.test(text)) {
    return "Forza Horizon 6 Reviews Are In";
  }
  if (subject === "Forza Horizon 6" && /\bsteam record|concurrent players\b/i.test(text)) {
    return "Forza Horizon 6 Crushed Its Steam Record";
  }
  if (subject === "Forza Horizon 6" && /\bmetacritic|highest rated\b/i.test(text)) {
    return "Forza Horizon 6 Tops Metacritic This Year";
  }
  if (subject === "Forza Horizon 6" && /\bavailable now on steam\b/i.test(text)) {
    return "Forza Horizon 6 Finally Hit Steam";
  }
  if (subject === "Forza Horizon 6" && /\bpremium edition|premium\b/i.test(text) && /\b(?:140 million|\$140m|\$140 million|revenue|made over)\b/i.test(text)) {
    return "Forza Horizon 6 Premium Already Made $140M";
  }
  if (subject === "Forza Horizon 6" && /\bsteam ceiling|massive success|steam\b/i.test(text)) {
    return "Forza Horizon 6 Broke Xbox's Steam Ceiling";
  }
  if (subject === "Subnautica 2" && /\b(?:pirates|leaking the game|life choices)\b/i.test(text)) {
    return "Subnautica 2 Dev Calls Out Leakers";
  }
  if (subject === "Subnautica 2" && /\b250 million|bonus\b/i.test(text)) {
    return "Subnautica 2 Bonus Fight Got Bigger";
  }
  if (subject === "Subnautica 2" && /\b(?:leaked|leak|48 hours|ahead of launch|before launch)\b/i.test(text)) {
    return "Subnautica 2 Reportedly Leaked Early";
  }
  if (subject === "Xbox" && /\bplayer voice|demand exclusives\b/i.test(text)) {
    return "Xbox Fans Used Feedback To Demand Exclusives";
  }
  if (subject === "Steam Controller" && /\bsteam controller|release date|release timing|leaked online\b/i.test(text)) {
    return "Steam Controller Date May Have Leaked";
  }
  if (/^pok[eé]mon go$/i.test(subject) && /\bmega mewtwo\b/i.test(text)) {
    return "Mega Mewtwo Is Finally Coming To Pokemon Go";
  }
  if (subject === "Kickstarter") return "Kickstarter Just Walked Back Its Rules";
  if (subject === "Spellcasters Chronicles") return "Spellcasters Chronicles Is Shutting Down";
  if (subject === "Destiny 2") return "Destiny 2 Is Getting Its Final Update";
  if (subject === "Warhammer 40,000: Boltgun 2") return "Boltgun 2 Leaves The Corridors";
  if (subject === "Warhammer 40,000: Dawn of War 4" && /\brelease date|17th september\b/i.test(text)) {
    return "Dawn Of War 4 Has A Date";
  }
  if (subject === "Warhammer 40,000: Dawn of War 4") return "Dawn Of War 4 Already Has A Roadmap";
  if (subject === "Warhammer 40,000: Space Marine 2") return "Space Marine 2 Got Its Purgation Update";
  if (subject === "Total War: Warhammer 40,000") return "Total War Is Going Full Warhammer 40K";
  if (subject === "Warhammer 40,000: Boltgun Boom") return "Warhammer 40K Is Getting A Mobile Boom";
  if (subject === "Warhammer Age Of Sigmar: Deathmaster") return "Deathmaster Makes Warhammer A Stealth Game";
  if (subject === "Helldivers 2") return "Helldivers 2 Is Getting Warhammer Gear";
  if (subject === "Lego Batman" && /\barkham\b/i.test(text)) return "Lego Batman Is Chasing Arkham";
  if (subject === "Lego Batman") return "Lego Batman Is Packed With Deep Cuts";
  if (subject === "007 First Light") return "007 First Light's Watch Costs More Than A Console";
  if (subject === "Modern Warfare 4") return "Modern Warfare 4 Just Teased Its Reveal";
  if (subject === "PlayStation Plus") return "PlayStation Plus Just Got More Expensive";
  if (subject === "PlayStation Store") return "PlayStation's Pricing Test Has A Legal Problem";
  if (subject === "Subnautica 2") return "Subnautica 2 Is Keeping Its Peaceful Rule";
  if (subject === "Assassin's Creed Black Flag") return "Black Flag Resync Is Real";
  if (subject === "Paranormal Activity: Threshold") return "Paranormal Activity Game Is Done";
  if (subject === "GameSir G7 Pro") return "GameSir G7 Pro Deal Has One Catch";
  if (subject === "Xbox Controller") return "Xbox Controller Deal Has One Catch";
  if (subject === "Star Fox") return "Star Fox Just Got A Switch 2 Route";
  if (subject === "Xbox" && /\b(?:chief strategy officer|strategy officer|leadership revamp|hires? analyst)\b/i.test(text)) {
    return "Xbox Just Made A Strategy Hire";
  }
  if (/\bprice|expensive|increase\b/i.test(text)) return `${subject} Just Got More Expensive`;
  if (/\bdeal|sale|discount|code\b/i.test(text)) return `${subject} Deal Has One Catch`;
  if (/\btrailer|revealed?|announced?|showcase\b/i.test(text)) return `${subject} Just Got A Real Reveal`;
  if (/\bshutdown|closing|done for good|coming to an end\b/i.test(text)) return `${subject} Is Shutting Down`;
  return `${subject} Has One Player Question`;
}

function isWeakRepairTitle(title = "") {
  return /\b(?:has one player question|already feels loud|just got a real reveal|just got a new signal|secret problem|won'?t admit)\b/i.test(clean(title));
}

function titleFingerprint(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectAnchors(subject = "") {
  const text = clean(subject).toLowerCase();
  const tokens = text
    .replace(/[^\p{L}\p{N}\s:]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const anchors = [];
  const afterColon = text.split(":").pop();
  if (afterColon && afterColon !== text) {
    anchors.push(...afterColon.split(/\s+/).filter(Boolean));
  }
  anchors.push(...tokens);
  const weak = new Set(["age", "and", "game", "games", "of", "the", "threshold"]);
  return [...new Set(anchors.filter((token) => !weak.has(token) && (token.length >= 4 || /\d/.test(token))))];
}

function titleMentionsSubject(title = "", subject = "") {
  const fingerprint = titleFingerprint(title);
  if (!fingerprint) return false;
  const anchors = subjectAnchors(subject);
  if (!anchors.length) return true;
  return anchors.some((anchor) => fingerprint.includes(anchor));
}

function titleCandidatePool(subject, manifest = {}) {
  const text = storyText(manifest);
  const candidates = [
    titleFromHeuristics(subject, manifest),
    ...asArray(manifest.title_candidates),
    manifest.selected_title,
    manifest.short_title,
  ];
  if (subject === "Helldivers 2" && /\bspace marines\b/i.test(text)) {
    candidates.unshift("Helldivers 2 Won't Get Space Marines");
  }
  if (subject === "Warhammer Age Of Sigmar: Deathmaster" && /\bpc and consoles|console\b/i.test(text)) {
    candidates.unshift("Deathmaster Brings Stealth To Consoles");
  }
  if (subject === "Destiny 2" && /\bnext games|focus turns|bungie\b/i.test(text) && !/\bfinal (?:content )?update\b/i.test(text)) {
    candidates.unshift("Destiny 2 Is Losing Bungie's Focus");
  }
  if (subject === "Warhammer 40,000: Dawn of War 4" && /\bgameplay\b/i.test(text)) {
    candidates.unshift("Dawn Of War 4 Finally Shows Gameplay");
  }
  return [...new Set(candidates.map(clean).filter(Boolean))];
}

function choosePublicTitle(subject, manifest = {}, usedTitleFingerprints = new Set()) {
  const candidates = titleCandidatePool(subject, manifest);
  for (const candidate of candidates) {
    const fingerprint = titleFingerprint(candidate);
    if (!fingerprint || usedTitleFingerprints.has(fingerprint)) continue;
    if (!titleMentionsSubject(candidate, subject)) continue;
    if (isWeakRepairTitle(candidate)) continue;
    if (candidate.split(/\s+/).filter(Boolean).length > 12) continue;
    return candidate;
  }
  return candidates.find((candidate) => !isWeakRepairTitle(candidate) && !usedTitleFingerprints.has(titleFingerprint(candidate)))
    || titleFromHeuristics(subject, manifest);
}

function firstLineForTitle(title, subject, manifest = {}) {
  const text = storyText(manifest);
  if (subject === "Kickstarter") return "Kickstarter just walked back its adult content rules after creator backlash.";
  if (subject === "Destiny 2") return "Destiny 2 is now heading towards its final live-service update.";
  if (subject === "Spellcasters Chronicles") return "Spellcasters Chronicles is shutting down only months after early access.";
  if (subject === "Subnautica 2" && /\b250 million|bonus\b/i.test(text)) {
    return "Subnautica 2's bonus fight now looks bigger than the sequel hype.";
  }
  if (subject === "Subnautica 2" && /\b(?:pirates|leaking the game|life choices|stolen build)\b/i.test(text)) {
    return "Subnautica 2's developer is already fighting leaked builds.";
  }
  if (subject === "Subnautica 2" && /\b(?:leaked|leak|48 hours|ahead of launch|before launch)\b/i.test(text)) {
    return "Subnautica 2 reportedly leaked before launch.";
  }
  if (subject === "Subnautica 2") return "Subnautica 2 is keeping one of its strangest survival rules.";
  if (subject === "PS5" && hasOfficialAttribution(manifest)) {
    return "PS5 prices went up, but the problem is how wide Sony made the list.";
  }
  if (subject === "PS5" && /\b(?:announced|recommended retail prices|effective april|prices? went up|price increase)\b/i.test(text)) {
    return "PS5 prices went up, but the problem is how wide Sony made the list.";
  }
  if (subject === "PS5") return "PS5 price hike rumours are back in Europe.";
  if (subject === "PlayStation Plus") return "PlayStation Plus just got more expensive for new customers.";
  if (subject === "PlayStation Store") return "PlayStation Store dynamic pricing may have a legal problem in Europe.";
  if (subject === "Super Mario RPG" && /\b(?:\d{1,3}%\s*off|discount|sale|deal|lowest price|\$15)\b/i.test(text)) {
    return "Super Mario RPG just dropped to $15 at GameStop.";
  }
  if (
    subject === "Hades II" &&
    /\bxbox\b/i.test(text) &&
    /\bplaystation\b/i.test(text) &&
    (/\bapril\s*14(?:th)?\b/i.test(text) || /\bcoming\s+april\b/i.test(text))
  ) {
    return "Hades II just put PlayStation and Xbox players on the same April countdown.";
  }
  if (subject === "Hades II") return "Hades II just turned its console launch into a same-day fight.";
  if (subject === "Warhammer 40,000: Boltgun 2") {
    return "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces.";
  }
  if (subject === "Warhammer 40,000: Dawn of War 4" && /Date/i.test(title)) {
    return "Warhammer 40,000: Dawn of War 4 finally has a release date.";
  }
  if (subject === "Warhammer 40,000: Dawn of War 4") {
    return "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap.";
  }
  if (subject === "Warhammer 40,000: Space Marine 2") {
    return "Warhammer 40,000: Space Marine 2 just got its Purgation update.";
  }
  if (subject === "Warhammer Age Of Sigmar: Deathmaster") {
    return "Warhammer Age Of Sigmar: Deathmaster brings stealth to consoles next year.";
  }
  if (subject === "Assassin's Creed Black Flag") {
    return "Assassin's Creed Black Flag Resync is real and starting to look strange.";
  }
  if (subject === "007 First Light") return "007 First Light now has a real Omega watch with a very unreal price.";
  if (subject === "Xbox Controller") return "Xbox controller deals are getting aggressive, but the catch is the retailer.";
  if (subject === "Kadokawa") return "Kadokawa's activist investor now has a bigger stake than Sony.";
  if (subject === "V Rising") return "V Rising's next vampire game has a catch: the original is moving into maintenance.";
  if (subject === "The Expanse: Osiris Reborn") return "The Expanse: Osiris Reborn finally showed real gameplay.";
  if (subject === "Star Wars: Galactic Racer") return "Star Wars: Galactic Racer may have leaked its own release date.";
  if (subject === "Star Wars Zero Company") return "Star Wars Zero Company is trying to be more than Star Wars XCOM.";
  if (subject === "Deus Ex") return "A Deus Ex composer says the games job market has gone brutally quiet.";
  if (subject === "Pragmata") return "Pragmata's AI-looking stage was actually handmade by developers.";
  if (subject === "STRANGER THAN HEAVEN Five Eras") return "Stranger Than Heaven just showed its five-era setup.";
  if (subject === "Crimson Desert" && /\b(?:already live|out now|launched|released|march 19)\b/i.test(text)) {
    return "Crimson Desert is past the trailer hype, and the risk is the real build.";
  }
  if (subject === "Crimson Desert") return "Crimson Desert has a clearer launch signal after years of glossy showcase footage.";
  if (subject === "Steam Controller") return "Steam Controller may have leaked early, but the date has one catch.";
  if (subject === "Xbox" && /\b(?:chief strategy officer|strategy officer|leadership revamp|hires? analyst)\b/i.test(text)) {
    return "Xbox just made a strategy hire that says a lot about where gaming is going.";
  }
  if (subject === "Xbox" && /\bplayer voice|demand exclusives\b/i.test(text)) {
    return "Xbox asked for feedback and immediately got the exclusives argument.";
  }
  if (subject === "Xbox" && /\bexclusive games\b|\bnew xbox ceo\b/i.test(text)) {
    return "Xbox exclusives are back under review at the top.";
  }
  if (subject === "GameSir G7 Pro") return "GameSir G7 Pro has a cheaper route, but it comes through AliExpress.";
  if (subject === "Forza Horizon 6" && /\breviews?\s+thread\b|\breviews?\s+(?:are|were|now|finally)/i.test(text)) {
    return "The Forza Horizon 6 review wave has a catch: it cannot prove launch demand yet.";
  }
  if (subject === "Forza Horizon 6" && /\breviews?\b/i.test(text)) {
    return "Forza Horizon 6 just landed strong reviews, but the catch is launch demand.";
  }
  if (subject === "Forza Horizon 6" && /\bsteam record|concurrent players\b/i.test(text)) {
    return "Forza Horizon 6 just smashed its Steam launch signal.";
  }
  if (subject === "Forza Horizon 6" && /\bpremium edition|premium\b/i.test(text) && /\b(?:140 million|\$140m|\$140 million|revenue|made over)\b/i.test(text)) {
    return "Forza Horizon 6 Premium Edition is already turning early access into the real launch story.";
  }
  if (subject === "Forza Horizon 6" && /\bsteam ceiling|massive success|steam\b/i.test(text)) {
    return "Forza Horizon 6 just turned its Steam launch into an Xbox signal.";
  }
  if (/^pok[eé]mon go$/i.test(subject) && /\bmega mewtwo\b/i.test(text)) {
    return "Mega Mewtwo is finally coming to Pokemon Go.";
  }
  if (subject === "Subnautica 2" && /\b(?:pirates|leaking the game|life choices)\b/i.test(text)) {
    return "Subnautica 2's developer just called out leaked builds.";
  }
  if (subject === "Subnautica 2" && /\b250 million|bonus\b/i.test(text)) {
    return "Subnautica 2's bonus fight now looks even bigger.";
  }
  if (subject === "Subnautica 2" && /\b(?:leaked|leak|48 hours|ahead of launch|before launch)\b/i.test(text)) {
    return "Subnautica 2 reportedly appeared online before launch.";
  }
  if (/\bwarhammer\b/i.test(subject) && /\btrailer|showcase|revealed?|confirmed\b/i.test(text)) {
    return `${subject} finally showed up at Warhammer Skulls.`;
  }
  if (/Deal Has One Catch/i.test(title)) return `${subject} has a deal worth checking before you buy.`;
  if (/More Expensive/i.test(title)) return `${subject} just got more expensive for players.`;
  if (/Reveal/i.test(title)) return `${subject} just gave players a clearer reveal signal.`;
  if (/Shutting Down|Game Is Done/i.test(title)) return `${subject} is now moving towards the end of its current run.`;
  return `${title}.`;
}

function deterministicClaim(subject, manifest = {}) {
  const text = storyText(manifest);
  if (subject === "Kickstarter") return "Kickstarter apologised after changing its content rules.";
  if (subject === "Paranormal Activity: Threshold") return "The licensed Paranormal Activity game is technically done for good.";
  if (subject === "Hades II" && /\bxbox\b/i.test(text) && /\bplaystation\b/i.test(text)) {
    if (/\bapril\s*14(?:th)?\b|\bcoming\s+april\b/i.test(text)) {
      return "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.";
    }
    return "Xbox showed Hades II for Xbox and PlayStation.";
  }
  if (subject === "Warhammer 40,000: Boltgun 2") {
    return "Warhammer 40,000: Boltgun 2 is moving its retro FPS combat into bigger outdoor spaces.";
  }
  if (
    subject === "PlayStation Plus" &&
    /\b(?:ps plus|playstation plus)\b/i.test(text) &&
    /\b(?:price hike|more expensive|premium|extra)\b/i.test(text)
  ) {
    return "PlayStation Plus Premium and Extra tiers are now more expensive too.";
  }
  if (subject === "Xbox" && /\b(?:chief strategy officer|strategy officer|leadership revamp|hires? analyst)\b/i.test(text)) {
    return "Xbox hired an analyst as chief strategy officer after another leadership revamp.";
  }
  if (subject === "Warhammer 40,000: Dawn of War 4" && /\bgameplay\b/i.test(text)) {
    return "Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing.";
  }
  if (subject === "Warhammer 40,000: Dawn of War 4") {
    return "Dawn of War 4 has a Year 1 roadmap and new playable factions.";
  }
  if (subject === "Warhammer 40,000: Space Marine 2") {
    return "Space Marine 2 received the Purgation update, Patch 13 and a new PvE mission.";
  }
  if (subject === "Forza Horizon 6" && /\breview thread\b/i.test(text)) {
    const attributedClaim = asArray(manifest.confirmed_claims)
      .map(clean)
      .find((claim) => /forza horizon 6/i.test(claim) && !/^['"]?forza horizon 6['"]?\s*-\s*review thread$/i.test(claim));
    if (attributedClaim) return attributedClaim;
    return "Forza Horizon 6 reviews are now in.";
  }
  if (subject === "Forza Horizon 6" && /\bavailable now on steam\b/i.test(text)) {
    return "Forza Horizon 6 is available now on Steam.";
  }
  if (subject === "Forza Horizon 6" && /\bsteam ceiling|massive success|steam\b/i.test(text)) {
    return "Forza Horizon 6 is already being framed as a major Steam success for Xbox.";
  }
  if (subject === "Forza Horizon 6" && /\bpremium edition|premium\b/i.test(text) && /\b(?:140 million|\$140m|\$140 million|revenue|made over)\b/i.test(text)) {
    return "Forza Horizon 6 Premium Edition has made more than $140 million.";
  }
  if (subject === "Super Mario RPG" && /\b(?:\d{1,3}%\s*off|discount|sale|deal|lowest price|\$15)\b/i.test(text)) {
    return "GameStop lists Super Mario RPG at $15, 70% off its listed price.";
  }
  if (subject === "Subnautica 2" && /\b(?:pirates|leaking the game|life choices|stolen build)\b/i.test(text)) {
    return "A Subnautica 2 developer responded after leaked builds started spreading before launch.";
  }
  if (subject === "Subnautica 2" && /\b250 million|bonus\b/i.test(text)) {
    return "Subnautica 2's developers appear to be in line for a $250 million bonus.";
  }
  if (subject === "Subnautica 2" && /\b(?:leaked|leak|48 hours|ahead of launch|before launch)\b/i.test(text)) {
    return "Subnautica 2 reportedly appeared online before launch.";
  }
  if (subject === "The Expanse: Osiris Reborn") {
    return "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.";
  }
  if (subject === "Pragmata" && /\bAI generated|AI-generated|new york stage\b/i.test(text)) {
    return "Pragmata's New York stage was handmade by developers to look AI generated.";
  }
  if (subject === "STRANGER THAN HEAVEN Five Eras") {
    return "Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview.";
  }
  if (subject === "Crimson Desert" && /\b(?:launch|release|march 19|global launch)\b/i.test(text)) {
    return "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing.";
  }
  return "";
}

function stripFormulaicRepairResidue(value = "") {
  return sentenceList(value)
    .filter((sentence) => {
      return !/\b(?:the practical question is whether|gives the story enough shape|the headline gets attention|the confirmed bit\b|follow[- ]through decides|question is whether players should|headline turns into a real player decision|next question is whether players should act|the important part is the named change|source behind it|the number only matters|the real test is whether .+ changes play|patch note sounds (?:big|bigger)|a useful update should fix a real friction point|update the story before treating it as settled|the change hits the version people actually buy|core detail plainly|keep the claim tight|anything outside the report should stay out of (?:the )?(?:narration|script)|fake certainty|decision filter|the useful version is narrow|if the source is right|the useful take is not blind hype|cleaner test|marketing line|the news is simple|title[- ]card promise|player watchlist story|first gameplay cut|another logo reveal|changes the version people were actually|clearer public hook|bit players will argue over|lawsuit,\s*the rejection and the named companies involved|odd filing to clearer dispute)\b/i.test(sentence);
    })
    .join(" ");
}

function weakClaimCandidate(candidate) {
  const text = clean(candidate);
  if (!text || text.length < 32) return true;
  if (/^["']/.test(text)) return true;
  if (/^[^a-z0-9]*(honestly|actually)\?/i.test(text)) return true;
  return false;
}

function cleanClaim(manifest = {}, subject = "") {
  const deterministic = deterministicClaim(subject, manifest);
  if (deterministic) return deterministic;
  const candidates = [
    ...asArray(manifest.confirmed_claims),
    manifest.description,
    manifest.canonical_title,
  ];
  for (const candidate of candidates) {
    const first = stripReportingSourcePrefix(sentenceList(stripFormulaicRepairResidue(candidate))[0]);
    if (first && first.length <= 260 && !/^i[' ]?ve\b/i.test(first) && !weakClaimCandidate(first) && !ADVERTISER_RISK_RE.test(first)) {
      return first;
    }
  }
  return clean(manifest.canonical_title || manifest.selected_title || "");
}

function subjectAnchoredClaim(claim = "", subject = "") {
  const claimText = clean(claim).replace(/\s*Source:\s*[^.]+\.?$/i, "");
  const subjectText = clean(subject);
  if (!claimText || !subjectText) return claimText;
  const normalClaim = claimText.toLowerCase();
  const normalSubject = subjectText.toLowerCase();
  if (normalClaim.includes(normalSubject)) return claimText;
  const firstSubjectToken = normalSubject.split(/[^a-z0-9]+/).find((part) => part.length >= 5);
  if (firstSubjectToken && normalClaim.includes(firstSubjectToken)) return claimText;
  const suffix = clean(subjectText.split(":").pop());
  if (suffix && normalClaim.startsWith(suffix.toLowerCase())) {
    return `${subjectText}${claimText.slice(suffix.length)}`;
  }
  return `${subjectText}: ${claimText}`;
}

function descriptionFor(manifest, claim, source, subject = inferSubject(manifest)) {
  const cleanClaimText = subjectAnchoredClaim(claim, subject);
  const sentence = cleanClaimText.endsWith(".") ? cleanClaimText : `${cleanClaimText}.`;
  const description = clean(`${sentence} Source: ${source}.`);
  if (description.length <= 420) return description;
  return `${description.slice(0, 420).replace(/\s+\S*$/, "").replace(/\.$/, "")}.`;
}

function playerValueLine(subject = "", title = "", claim = "") {
  const joined = `${subject} ${title} ${claim}`;
  if (/forza horizon 6/i.test(joined) && /review/i.test(joined)) {
    return "That means fence-sitters get a cleaner signal, but review scores still do not prove the wider launch holds.";
  }
  if (/forza horizon 6/i.test(joined) && /steam|xbox/i.test(joined)) {
    return "If Steam is where Forza takes off, Xbox has a different launch story on its hands.";
  }
  if (/forza horizon 6/i.test(joined) && /premium|\$140m|made/i.test(joined)) {
    return "The awkward part is the business model: early access is becoming the launch window.";
  }
  if (/hades ii/i.test(joined)) {
    return "The feel is the pressure point: laggy dodges would blunt Hades II.";
  }
  if (/boltgun 2/i.test(joined)) {
    return "Those bigger arenas need to make the sequel feel less boxed in, not just louder.";
  }
  if (/subnautica 2/i.test(joined) && /bonus|\$140m|\$250m|\$250 million|payout/i.test(joined)) {
    return "Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier.";
  }
  if (/subnautica 2/i.test(joined) && /leak|leaked|leakers|pirates|stolen build/i.test(joined)) {
    return "Rough leaked material can travel faster than the official build, and that is brutal for a sequel still trying to set its own tone.";
  }
  if (/crimson desert/i.test(joined)) {
    return "But now the shipped build has to carry the spectacle: combat, performance and scale, not just trailer shots.";
  }
  if (/star wars zero company/i.test(joined)) {
    return "The Mass Effect comparison is the hook: tactics with crew pressure, not just another grid battle.";
  }
  if (/pragmata/i.test(joined)) {
    return "That twist makes the strange texture feel intentional, not like a machine shortcut.";
  }
  if (/v rising/i.test(joined)) {
    return "That shifts the fan question from the next patch to how far Stunlock can stretch its vampire world.";
  }
  if (/stranger than heaven/i.test(joined)) {
    return "Five eras gives the pitch a real structure, not just another moody crime trailer.";
  }
  if (/steam controller/i.test(joined)) {
    return "But the catch is timing: if that date holds, Valve's next hardware push suddenly looks much closer.";
  }
  if (/xbox/i.test(joined) && /player voice|feedback|demand exclusives|exclusives argument/i.test(joined)) {
    return "The uncomfortable part is that fans skipped the survey framing and went straight to Xbox's platform promise.";
  }
  if (/xbox/i.test(joined) && /exclusive games|new xbox ceo|reevaluating|under review/i.test(joined)) {
    return "The awkward part is timing: every Xbox leadership quote now gets filtered through the exclusives question.";
  }
  if (/(?:nintendo|pokemon|pokémon).{0,120}(?:professor|lawsuit|denied)|(?:professor|lawsuit|denied).{0,120}(?:nintendo|pokemon|pokémon)/i.test(joined)) {
    return "The odd part is the target: a fan programme rejection, not Nintendo's usual fight over ROMs or clone games.";
  }
  if (/kadokawa|oasis management|sony stake|activist investor/i.test(joined)) {
    return "The player-facing part is control: ownership pressure can change which projects get funded, delayed or pushed wider.";
  }
  if (/mega mewtwo|pokemon go|pokémon go/i.test(joined)) {
    return "The free Go Fest detail matters because this is one of Pokemon Go's biggest locked-away debuts.";
  }
  if (/super mario rpg/i.test(joined) && /\b(?:\d{1,3}%\s*off|discount|sale|deal|lowest price|\$15)\b/i.test(joined)) {
    return "For anyone who skipped the physical Switch copy, that is a real pickup point while the listing holds.";
  }
  if (/deus ex|unreal|composer|job market|jobs vanished|resume|interview/i.test(joined)) {
    return "The story is the talent squeeze behind the games people still recognise years later.";
  }
  if (/\bps5\b|\bplaystation 5\b/i.test(joined) && /\b(?:price hike|more expensive|prices? went up|recommended retail prices|price increase)\b/i.test(joined)) {
    return "That means new buyers take the hit first in markets where the console was already a premium purchase.";
  }
  if (/price|expensive|deal|cost/i.test(joined)) {
    return "The catch matters as much as the saving, because platform and seller details can change the value fast.";
  }
  if (/shutdown|done|final update|coming to an end/i.test(joined)) {
    return "The important detail is what still works before support disappears.";
  }
  if (/the expanse:?\s*osiris reborn/i.test(joined)) {
    return "Now the camera, gunfights and scale are on screen instead of hidden behind a logo.";
  }
  if (/reveal|trailer|gameplay|showcase/i.test(joined)) {
    return "Now players can see the pace, camera and combat instead of reading another announcement.";
  }
  return `${subject} now changes the next question fans ask, which makes this more than background noise.`;
}

function curiosityGapLine({ subject = "", title = "", claim = "" } = {}) {
  const joined = `${subject} ${title} ${claim}`;
  if (/subnautica 2/i.test(joined) && /bonus|\$140m|\$250m|\$250 million|payout/i.test(joined)) {
    return "The catch is what this changes for the game itself: the business fight is now part of the launch story.";
  }
  if (/subnautica 2/i.test(joined) && /leak|leaked|leakers|pirates|stolen build/i.test(joined)) {
    return "The catch is what this changes: rough footage can shape expectations before the official build gets a fair look.";
  }
  if (/forza horizon 6/i.test(joined) && /review|score|rated|metacritic|pc gamer/i.test(joined)) {
    return "The catch is whether that score still means as much once the wider player base arrives.";
  }
  if (/forza horizon 6/i.test(joined) && /steam|xbox|concurrent/i.test(joined)) {
    return "The catch is whether that Steam spike proves real launch demand or just early-access heat.";
  }
  if (/price|expensive|deal|cost|discount|\$15/i.test(joined)) {
    return "The catch is what matters: platform, seller and timing can change the value before players act.";
  }
  if (/shutdown|done|final update|coming to an end/i.test(joined)) {
    return "The catch is what matters once support starts moving on: what players keep, lose or need to finish.";
  }
  if (/lawsuit|legal|professor|denied/i.test(joined)) {
    return "The catch is why this small dispute is being pushed into a much bigger legal fight.";
  }
  if (/reveal|trailer|gameplay|showcase|real gameplay/i.test(joined)) {
    return "The catch is what matters after the reveal cut: whether the full mission flow can match it.";
  }
  if (/xbox|playstation|nintendo|steam/i.test(joined) && /exclusive|platform|hardware|controller/i.test(joined)) {
    return "The catch is what this changes for the platform story after the headline fades.";
  }
  return "The catch is what this changes for players after the headline fades.";
}

function thumbnailHeadline(title) {
  const text = clean(title);
  if (/hades ii/i.test(text) && /playstation|xbox|silence|console|april/i.test(text)) {
    return "HADES II CONSOLE DATE";
  }
  if (/dawn of war (?:iv|4)/i.test(text) && /gameplay/i.test(text)) {
    return "DAWN OF WAR 4 GAMEPLAY";
  }
  if (/dawn of war (?:iv|4)/i.test(text) && /roadmap|factions/i.test(text)) {
    return "DAWN OF WAR 4 ROADMAP";
  }
  if (/v rising/i.test(text) && /(?:another|new).{0,40}vampire game/i.test(text)) {
    return "V RISING VAMPIRE GAME";
  }
  if (/stranger than heaven/i.test(text) && /five eras?/i.test(text)) {
    return "STRANGER FIVE ERAS";
  }
  if (/subnautica\s*2/i.test(text) && /calls? out leakers?/i.test(text)) {
    return "SUBNAUTICA LEAKERS CALLED OUT";
  }
  if (/forza horizon 6/i.test(text) && /steam ceiling|steam launch|xbox/i.test(text)) {
    return "FORZA STEAM CEILING";
  }
  if (/forza horizon 6/i.test(text) && /hit steam|steam/i.test(text)) {
    return "FORZA HIT STEAM";
  }
  if (/Forza Horizon 6 Premium/i.test(text) && /\$?140M|\$140\s*Million|140\s*Million/i.test(text)) {
    return "FORZA PREMIUM $140M";
  }
  if (/super mario rpg/i.test(text) && /\$15|deal|drops/i.test(text)) return "SUPER MARIO RPG $15 DEAL";
  if (/More Expensive/i.test(text)) return "PRICES WENT UP";
  if (/Deal Has One Catch/i.test(text)) return "DEAL HAS A CATCH";
  if (/Shutting Down|Game Is Done/i.test(text)) return "SHUTTING DOWN";
  if (/Legal Problem/i.test(text)) return "LEGAL PROBLEM";
  if (/Final Update/i.test(text)) return "FINAL UPDATE";
  if (/Warhammer Gear/i.test(text)) return "WARHAMMER GEAR";
  if (/mega mewtwo|pok[eé]mon go/i.test(text)) return "POKEMON GO MEGA MEWTWO";
  if (/kickstarter/i.test(text) && /walked back/i.test(text)) return "KICKSTARTER RULE WALKBACK";
  if (/deus ex/i.test(text) && /jobs vanished/i.test(text)) return "DEUS EX JOBS VANISHED";
  if (/star wars zero company/i.test(text) && /xcom/i.test(text)) return "ZERO COMPANY XCOM";
  if (/xbox exclusives/i.test(text) && /review/i.test(text)) return "XBOX EXCLUSIVES REVIEW";
  const words = text.split(/\s+/).filter(Boolean);
  const dangling = /^(?:a|an|and|are|as|at|by|for|from|got|had|has|have|in|is|its|may|of|on|or|says|should|than|the|to|under|will|with|would)$/i;
  const original = words.slice(0, 5);
  while (original.length > 2 && /'s$/i.test(original[original.length - 1] || "")) {
    original.pop();
  }
  if (!dangling.test(original[original.length - 1] || "")) {
    return original.join(" ").toUpperCase();
  }
  const filler = new Set([
    "a",
    "an",
    "are",
    "as",
    "back",
    "has",
    "have",
    "had",
    "is",
    "its",
    "just",
    "may",
    "more",
    "of",
    "reports",
    "reveals",
    "says",
    "than",
    "the",
    "under",
    "was",
    "were",
  ]);
  const compact = words
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean)
    .filter((word) => !filler.has(word.toLowerCase()))
    .slice(0, 5);
  const sliced = compact.length >= 3 ? compact : words.slice(0, 5);
  while (sliced.length > 2 && dangling.test(sliced[sliced.length - 1] || "")) {
    sliced.pop();
  }
  return sliced.join(" ").toUpperCase();
}

function compactSubjectForThumbnail(subject = "") {
  const text = clean(subject);
  if (/nintendo switch 2/i.test(text)) return "SWITCH 2";
  if (/playstation plus/i.test(text)) return "PS PLUS";
  if (/playstation store/i.test(text)) return "PS STORE";
  if (/destiny 2/i.test(text)) return "DESTINY 2";
  if (/helldivers 2/i.test(text)) return "HELLDIVERS 2";
  if (/gamesir g7 pro/i.test(text)) return "GAMESIR G7 PRO";
  if (/xbox wireless controller|xbox controller/i.test(text)) return "XBOX CONTROLLER";
  if (/space marine 2/i.test(text)) return "SPACE MARINE 2";
  if (/dawn of war (?:iv|4)/i.test(text)) return "DAWN OF WAR 4";
  if (/total war/i.test(text)) return "TOTAL WAR";
  if (/boltgun/i.test(text)) return "BOLTGUN";
  if (/deathmaster/i.test(text)) return "DEATHMASTER";
  if (/star fox/i.test(text)) return "STAR FOX";
  if (/subnautica 2/i.test(text)) return "SUBNAUTICA 2";
  if (/007 first light/i.test(text)) return "007 FIRST LIGHT";
  if (/lego batman/i.test(text)) return "LEGO BATMAN";
  if (/kickstarter/i.test(text)) return "KICKSTARTER";
  const tokens = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !/^(the|and|of|for|with)$/i.test(token));
  return tokens.slice(0, 3).join(" ").toUpperCase() || "GAME";
}

function subjectAnchoredThumbnailHeadline(title, subject) {
  const text = clean(title);
  const compactSubject = compactSubjectForThumbnail(subject);
  if (/the expanse:?\s*osiris reborn|the expanse/i.test(`${text} ${subject}`) && /gameplay/i.test(text)) {
    return "EXPANSE GAMEPLAY REVEAL";
  }
  if (/Price Hike|Prices? (?:Went|Go(?:es)?) Up|Price Jump|More Expensive/i.test(text)) return `${compactSubject} PRICE JUMP`;
  if (/More Expensive/i.test(text)) return `${compactSubject} PRICE JUMP`;
  if (/Deal Has One Catch/i.test(text)) return `${compactSubject} CATCH`;
  if (/Shutting Down|Game Is Done/i.test(text)) return `${compactSubject} SHUTDOWN`;
  if (/Legal Problem/i.test(text)) return `${compactSubject} LEGAL RISK`;
  if (/Final Update/i.test(text)) return `${compactSubject} FINAL UPDATE`;
  if (/Warhammer Gear/i.test(text)) return `${compactSubject} WARHAMMER GEAR`;
  const headline = thumbnailHeadline(title);
  return titleMentionsSubject(headline, subject)
    ? headline
    : `${compactSubject} ${headline.split(/\s+/).slice(0, 3).join(" ")}`.trim();
}

function thumbnailMentionsSubject(manifest = {}) {
  const subject = clean(manifest.canonical_subject || manifest.canonical_game || inferSubject(manifest));
  const headline = clean(manifest.thumbnail_headline || manifest.thumbnail_text);
  return !subject || !headline || titleMentionsSubject(headline, subject);
}

function buildNarrationScript({ firstLine, claim, source, subject, title }) {
  const cleanClaimText = clean(claim).replace(/[.]+$/g, "");
  const sourceLine = sourceLineForNarration({ source, claim: cleanClaimText });
  const curiosityLine = curiosityGapLine({ subject, title, claim: cleanClaimText });
  return clean(
    [
      firstLine,
      sourceLine,
      curiosityLine,
      playerValueLine(subject, title, cleanClaimText),
      `${EXACT_CTA}.`,
    ].join(" "),
  );
}

function sourceLineForNarration({ source = "", claim = "" } = {}) {
  const sourceText = clean(source);
  const claimText = clean(claim).replace(/[.]+$/g, "");
  if (!claimText) return sourceText ? `The report comes from ${sourceText}.` : "";
  if (/^steam$/i.test(sourceText) && /\bavailable now on steam\b/i.test(claimText)) {
    return "Steam lists Forza Horizon 6 as available now.";
  }
  if (sourceText && new RegExp(`^${sourceText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(claimText)) {
    return `${claimText}.`;
  }
  return `${sourceText || "The source"} reports ${claimText}.`;
}

function stableLandingRoute(route = "") {
  const value = clean(route);
  const match = value.match(/^\/p\/(.+)$/i);
  if (!match) return value;
  const slug = match[1]
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `/p/${slug}` : value;
}

function sourceLandingRoute(manifest = {}, platformOutput = {}) {
  const candidates = [
    manifest.landing_page_url,
    manifest.landing_page_path,
    manifest.landing_page_slug,
    manifest.link_pack?.landing_page_url,
    platformOutput.profile_or_landing_page_cta,
    platformOutput.bio_link_cta,
    platformOutput.description,
    platformOutput.caption,
  ];
  for (const candidate of candidates) {
    const match = clean(candidate).match(/(?:^|\s)(\/p\/[^\s,.]+)/i);
    if (match) return stableLandingRoute(match[1]);
  }
  return "";
}

function platformDescription(manifest = {}, platformOutput = {}) {
  const base = clean(manifest.description);
  const landing = sourceLandingRoute(manifest, platformOutput);
  return landing ? clean(`${base} Sources and related links: ${landing}`) : base;
}

function platformCaption(manifest = {}, platformName = "") {
  const source = sourceName(manifest);
  const firstLine = clean(manifest.first_spoken_line);
  if (/tiktok/i.test(platformName)) return clean(`${firstLine} Source: ${source}.`);
  if (/instagram/i.test(platformName)) return clean(`${firstLine} Source: ${source}.`);
  if (/facebook/i.test(platformName)) return clean(`${firstLine} Source: ${source}.`);
  if (/threads/i.test(platformName)) return clean(`${firstLine} Source: ${source}.`);
  if (/pinterest/i.test(platformName)) return clean(`${firstLine} Source: ${source}.`);
  return clean(`${firstLine} Source: ${source}.`);
}

function descriptionWithoutSource(manifest = {}) {
  return clean(manifest.description).replace(/\s*Source:\s*[^.]+\.?$/i, "").trim();
}

function sourceSafePost(manifest = {}, platformOutput = {}) {
  const title = clean(manifest.selected_title || manifest.short_title);
  const source = sourceName(manifest);
  const landing = sourceLandingRoute(manifest, platformOutput);
  return [
    title,
    [clean(`Source: ${source}.`), landing ? `Full source list: ${landing}` : ""].filter(Boolean).join(" "),
  ].filter(Boolean).join("\n\n");
}

function xThreadPosts(manifest = {}, platformOutput = {}) {
  const title = clean(manifest.selected_title || manifest.short_title);
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook);
  const source = sourceName(manifest);
  const landing = sourceLandingRoute(manifest, platformOutput);
  const claim = descriptionWithoutSource(manifest) || firstLine;
  return [
    title,
    firstLine,
    claim,
    landing ? `Source: ${source}. Full source list: ${landing}` : `Source: ${source}.`,
  ].filter(Boolean);
}

function xHotTakePost(manifest = {}) {
  const subject = clean(manifest.canonical_subject || manifest.canonical_game);
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook);
  if (/forza horizon 6/i.test(subject) && /review/i.test(firstLine + " " + manifest.selected_title)) {
    return "Forza Horizon 6 reviews are in, and now the argument is whether another familiar Horizon is still enough.";
  }
  return `${firstLine} I want the next official beat to show whether this actually changes the game, the launch or the platform plan.`;
}

function threadsDiscussionPost(manifest = {}) {
  const subject = clean(manifest.canonical_subject || manifest.canonical_game);
  const source = sourceName(manifest);
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook);
  if (/forza horizon 6/i.test(subject) && /review/i.test(firstLine + " " + manifest.selected_title)) {
    return `Forza Horizon 6 reviews are in. ${source} is one of the early reads, and I'm watching whether the praise is enough for players who wanted a bigger jump.`;
  }
  if (!subject) return firstLine;
  return `${firstLine} ${source} has the report. For ${subject}, the next useful proof is the thing players can actually see, play or price-check.`;
}

function syncCoverFrame(coverFrame = {}, manifest = {}) {
  if (!coverFrame || typeof coverFrame !== "object" || Array.isArray(coverFrame)) return coverFrame;
  return {
    ...coverFrame,
    headline: clean(manifest.thumbnail_headline || manifest.thumbnail_text || thumbnailHeadline(manifest.selected_title)),
    subject: clean(manifest.canonical_subject || manifest.canonical_game),
    source_label: sourceName(manifest),
  };
}

function syncPlatformOutput(platformName, output = {}, manifest = {}) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const updated = { ...output };
  const title = clean(manifest.selected_title || manifest.short_title);
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook);
  const headline = clean(manifest.thumbnail_headline || manifest.thumbnail_text || thumbnailHeadline(title));
  const source = sourceName(manifest);

  if ("title" in updated) updated.title = title;
  if ("cta" in updated) updated.cta = `${EXACT_CTA}.`;
  if ("description" in updated) updated.description = platformDescription(manifest, updated);
  if ("caption" in updated) updated.caption = platformCaption(manifest, platformName);
  if ("page_caption" in updated) updated.page_caption = platformCaption(manifest, platformName);
  if ("explanatory_framing" in updated) updated.explanatory_framing = descriptionWithoutSource(manifest) || firstLine;
  if ("conversational_hook" in updated) updated.conversational_hook = firstLine;
  if ("opening_line" in updated) updated.opening_line = firstLine;
  if ("first_spoken_line" in updated) updated.first_spoken_line = firstLine;
  if ("thumbnail_headline" in updated) updated.thumbnail_headline = headline;
  if ("thumbnail_text" in updated) updated.thumbnail_text = headline;
  if ("headline" in updated && /(?:card|image|carousel|cover|pin|story)/i.test(platformName)) {
    updated.headline = headline;
  }
  if ("cover_frame" in updated) updated.cover_frame = syncCoverFrame(updated.cover_frame, manifest);
  if ("source_label" in updated) updated.source_label = source;
  if ("profile_or_landing_page_cta" in updated) {
    const landing = sourceLandingRoute(manifest, updated);
    updated.profile_or_landing_page_cta = landing
      ? `Story sources and related links: ${landing}`
      : "Story sources are listed in the description.";
  }
  if ("bio_link_cta" in updated) {
    const landing = sourceLandingRoute(manifest, updated);
    updated.bio_link_cta = landing ? `Story page in bio: ${landing}` : "Story source link in bio.";
  }
  if (/^x$/i.test(platformName)) {
    if ("hot_take_post" in updated) updated.hot_take_post = xHotTakePost(manifest);
    if ("source_safe_post" in updated) updated.source_safe_post = sourceSafePost(manifest, updated);
    if ("concise_news_post" in updated) updated.concise_news_post = firstLine;
    if (Array.isArray(updated.thread_posts)) updated.thread_posts = xThreadPosts(manifest, updated);
  }
  if (/^threads$/i.test(platformName) && "discussion_post" in updated) {
    updated.discussion_post = threadsDiscussionPost(manifest);
  }
  if (/^pinterest$/i.test(platformName)) {
    if ("pin_title" in updated) updated.pin_title = title;
    if ("pin_description" in updated) updated.pin_description = platformCaption(manifest, platformName);
  }
  return normaliseProtectedNamesDeep(updated);
}

const PLATFORM_COPY_FINGERPRINT_FIELDS = {
  youtube_shorts: ["title", "description", "profile_or_landing_page_cta"],
  tiktok: ["conversational_hook", "caption"],
  instagram_reels: ["caption", "story_poll_idea"],
  facebook_reels: ["page_caption", "explanatory_framing"],
  x: ["hot_take_post", "source_safe_post"],
  threads: ["discussion_post"],
  pinterest: ["pin_title", "pin_description"],
};

function valueAtPath(value = {}, fieldPath = "") {
  return clean(fieldPath)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), value);
}

function copyFingerprintForPlatform(platformName = "", output = {}) {
  return asArray(PLATFORM_COPY_FINGERPRINT_FIELDS[platformName])
    .map((field) => clean(valueAtPath(output, field)))
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/p\/[a-z0-9-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function refreshPlatformNativeEvidence(evidence = null, outputs = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return evidence;
  if (!Array.isArray(evidence.platforms)) return evidence;
  return {
    ...evidence,
    platforms: evidence.platforms.map((platformEvidence) => {
      const platformName = clean(platformEvidence?.platform);
      const fingerprint = copyFingerprintForPlatform(platformName, outputs[platformName] || {});
      return fingerprint
        ? { ...platformEvidence, copy_fingerprint: fingerprint }
        : platformEvidence;
    }),
  };
}

function syncPlatformPublishManifest(platformManifest = {}, manifest = {}, { generatedAt = new Date().toISOString() } = {}) {
  if (!platformManifest || typeof platformManifest !== "object" || Array.isArray(platformManifest)) {
    return platformManifest;
  }
  const outputs = {};
  for (const [platformName, output] of Object.entries(platformManifest.outputs || {})) {
    outputs[platformName] = syncPlatformOutput(platformName, output, manifest);
  }
  return {
    ...platformManifest,
    public_copy_synced_at: generatedAt,
    public_copy_sync_source: "canonical_story_manifest",
    selected_title: clean(manifest.selected_title || manifest.short_title),
    canonical_subject: clean(manifest.canonical_subject || manifest.canonical_game),
    thumbnail_headline: clean(manifest.thumbnail_headline || manifest.thumbnail_text),
    outputs,
    platform_native_evidence: refreshPlatformNativeEvidence(platformManifest.platform_native_evidence, outputs),
  };
}

function syncRenderStoryPublicCopy(renderStory = {}, manifest = {}, { generatedAt = new Date().toISOString() } = {}) {
  if (!renderStory || typeof renderStory !== "object" || Array.isArray(renderStory)) return renderStory;
  const title = clean(manifest.selected_title || manifest.short_title || renderStory.title);
  const headline = clean(manifest.thumbnail_headline || manifest.thumbnail_text || thumbnailHeadline(title));
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook || renderStory.mobile_hook_text);
  const script = clean(manifest.narration_script || manifest.full_script || renderStory.narration_script);
  return {
    ...renderStory,
    title,
    selected_title: title,
    short_title: title,
    canonical_subject: clean(manifest.canonical_subject || manifest.canonical_game || renderStory.canonical_subject),
    thumbnail_headline: headline,
    thumbnail_text: headline,
    first_frame_text: headline,
    mobile_hook_text: firstLine,
    first_spoken_line: firstLine,
    narration_script: script,
    full_script: script,
    tts_script: script,
    description: clean(manifest.description || renderStory.description),
    primary_source: sourceName(manifest),
    public_copy_synced_at: generatedAt,
    public_copy_sync_source: "canonical_story_manifest",
  };
}

async function syncRenderStoryFile(artifactDir = "", manifest = {}, { generatedAt = new Date().toISOString() } = {}) {
  if (!artifactDir) return false;
  const filePath = path.join(artifactDir, "visual_v4_render_story.json");
  const renderStory = await readJsonIfPresent(filePath, null);
  if (!renderStory || typeof renderStory !== "object") return false;
  const synced = syncRenderStoryPublicCopy(renderStory, manifest, { generatedAt });
  if (JSON.stringify(renderStory) === JSON.stringify(synced)) return false;
  await fs.writeJson(filePath, synced, { spaces: 2 });
  return true;
}

async function readStandalonePlatformPacks(artifactDir = "") {
  const packs = [];
  if (!artifactDir) return packs;
  for (const [fileName, platformName] of Object.entries(STANDALONE_PLATFORM_PACK_FILES)) {
    const filePath = path.join(artifactDir, fileName);
    const pack = await readJsonIfPresent(filePath, null);
    if (pack && typeof pack === "object") packs.push({ filePath, fileName, platformName, pack });
  }
  return packs;
}

function syncStandalonePlatformPack(pack = {}, platformName = null, manifest = {}, { generatedAt = new Date().toISOString() } = {}) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) return pack;
  if (pack.outputs && typeof pack.outputs === "object") {
    return syncPlatformPublishManifest(pack, manifest, { generatedAt });
  }
  const synced = platformName ? syncPlatformOutput(platformName, pack, manifest) : pack;
  return {
    ...synced,
    public_copy_synced_at: generatedAt,
    public_copy_sync_source: "canonical_story_manifest",
  };
}

function standalonePlatformPacksNeedSync(standalonePacks = [], manifest = {}, { generatedAt = new Date().toISOString() } = {}) {
  const source = sourceName(manifest);
  for (const item of standalonePacks) {
    const outputText = JSON.stringify(item.pack || {});
    if (STALE_PLATFORM_PUBLIC_COPY_RE.test(outputText)) return true;
    if (!isRedditSourceLabelOrUrl(source) && /\bsource\s*:\s*reddit\b/i.test(outputText)) return true;
    const synced = syncStandalonePlatformPack(item.pack, item.platformName, manifest, { generatedAt });
    if (JSON.stringify(item.pack) !== JSON.stringify(synced)) return true;
  }
  return false;
}

async function syncStandalonePlatformPacks(artifactDir = "", manifest = {}, { generatedAt = new Date().toISOString() } = {}) {
  const packs = await readStandalonePlatformPacks(artifactDir);
  let changedCount = 0;
  for (const item of packs) {
    const synced = syncStandalonePlatformPack(item.pack, item.platformName, manifest, { generatedAt });
    if (JSON.stringify(item.pack) !== JSON.stringify(synced)) {
      await fs.writeJson(item.filePath, synced, { spaces: 2 });
      changedCount += 1;
    }
  }
  return changedCount;
}

async function syncPublicCopyOutputArtifacts({
  artifactDir = "",
  platformManifestPath = "",
  platformManifest = null,
  manifest = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  let platformManifestSynced = false;
  if (platformManifest) {
    await fs.writeJson(
      platformManifestPath,
      syncPlatformPublishManifest(platformManifest, manifest, { generatedAt }),
      { spaces: 2 },
    );
    platformManifestSynced = true;
  }
  const standalonePackSyncedCount = await syncStandalonePlatformPacks(artifactDir, manifest, { generatedAt });
  const renderStorySynced = await syncRenderStoryFile(artifactDir, manifest, { generatedAt });
  return {
    platformManifestSynced,
    standalonePackSyncedCount,
    renderStorySynced,
  };
}

const STALE_PLATFORM_PUBLIC_COPY_RE =
  /\b(?:already feels loud|source_locked_update|practical catch|the player angle is simple|check the price,\s*access or platform details|racing_game_setup|follow(?:\s+pulse\s+gaming)?\s+for\s+the\s+gaming\s+stories\s+behind\s+the\s+headline)\b/i;

function copyRepairRequiresAudioRerender(item = {}) {
  return !["platform_pack_synced", "description_subject_synced"].includes(clean(item.status));
}

function publicCopyRegenerationPending(manifest = {}) {
  const repairedAt = clean(manifest.public_copy_repaired_at);
  if (!repairedAt) return false;
  const completedAt = clean(manifest.public_copy_regeneration_completed_at);
  const renderedAt = clean(manifest.public_copy_final_render_regenerated_at);
  if (!completedAt || !renderedAt) return true;
  const repairedTime = Date.parse(repairedAt);
  const completedTime = Date.parse(completedAt);
  const renderedTime = Date.parse(renderedAt);
  if (![repairedTime, completedTime, renderedTime].every(Number.isFinite)) return true;
  return completedTime < repairedTime || renderedTime < repairedTime;
}

function scriptScorecardForManifest(manifest = {}) {
  return buildViralScriptIntelligence({
    story: {
      id: clean(manifest.story_id || manifest.id),
      title: clean(manifest.selected_title || manifest.short_title || manifest.canonical_title || manifest.title),
      source_name: sourceName(manifest),
    },
    script: clean(manifest.narration_script || manifest.full_script || manifest.tts_script),
  });
}

function scriptScorecardNeedsRepair(scorecard = null) {
  if (!scorecard || typeof scorecard !== "object") return false;
  const verdict = clean(scorecard.verdict).toLowerCase();
  const score = Number(scorecard.viral_score ?? scorecard.score ?? scorecard.total_score);
  const curiosityGap = Number(scorecard.scores?.curiosity_gap ?? scorecard.curiosity_gap);
  const warnings = asArray(scorecard.warnings).map(clean);
  return (
    verdict === "rewrite_required" ||
    verdict === "blocked" ||
    verdict === "fail" ||
    asArray(scorecard.blockers).length > 0 ||
    warnings.includes("no_curiosity_marker") ||
    (Number.isFinite(curiosityGap) && curiosityGap < 70) ||
    (Number.isFinite(score) && score < 75)
  );
}

function scriptScorecardPasses(scorecard = {}) {
  const verdict = clean(scorecard.verdict).toLowerCase();
  const score = Number(scorecard.viral_score ?? scorecard.score ?? scorecard.total_score);
  const curiosityGap = Number(scorecard.scores?.curiosity_gap ?? scorecard.curiosity_gap);
  const warnings = asArray(scorecard.warnings).map(clean);
  return (
    asArray(scorecard.blockers).length === 0 &&
    !warnings.includes("no_curiosity_marker") &&
    Number.isFinite(score) &&
    score >= 75 &&
    (!Number.isFinite(curiosityGap) || curiosityGap >= 70) &&
    !["rewrite_required", "blocked", "fail", "reject"].includes(verdict)
  );
}

function scriptScorecardFailureCodes(scorecard = {}) {
  const verdict = clean(scorecard.verdict).toLowerCase();
  const score = Number(scorecard.viral_score ?? scorecard.score ?? scorecard.total_score);
  const curiosityGap = Number(scorecard.scores?.curiosity_gap ?? scorecard.curiosity_gap);
  const failures = [];
  for (const blocker of asArray(scorecard.blockers).map(clean).filter(Boolean)) {
    failures.push(`script_scorecard:${blocker}`);
  }
  for (const warning of asArray(scorecard.warnings).map(clean).filter(Boolean)) {
    if (warning === "no_curiosity_marker") failures.push("script_scorecard:no_curiosity_marker");
  }
  if (Number.isFinite(score) && score < 75) failures.push("script_scorecard:script_score_below_threshold");
  if (Number.isFinite(curiosityGap) && curiosityGap < 70) failures.push("script_scorecard:curiosity_gap_below_threshold");
  if (["rewrite_required", "blocked", "fail", "reject"].includes(verdict)) {
    failures.push(`script_scorecard:script_verdict_${verdict}`);
  }
  if (!failures.length && scorecard && typeof scorecard === "object") {
    failures.push("script_scorecard:scorecard_did_not_clear_publish_threshold");
  }
  return [...new Set(failures)];
}

function unchangedStatusForManifest(manifest = {}) {
  return publicCopyRegenerationPending(manifest)
    ? "unchanged_pending_public_copy_regeneration"
    : "unchanged";
}

function repairItemsNeedingAudioRerender(repairReport = {}) {
  return [
    ...asArray(repairReport.changed),
    ...asArray(repairReport.unchanged).filter(
      (item) => clean(item.status) === "unchanged_pending_public_copy_regeneration",
    ),
  ].filter(copyRepairRequiresAudioRerender);
}

function platformManifestNeedsSync(platformManifest = {}, manifest = {}) {
  if (!platformManifest || typeof platformManifest !== "object") return false;
  const title = clean(manifest.selected_title || manifest.short_title);
  const firstLine = clean(manifest.first_spoken_line || manifest.narration_hook);
  const headline = clean(manifest.thumbnail_headline || manifest.thumbnail_text || thumbnailHeadline(title));
  const outputs = platformManifest.outputs || {};
  const outputText = JSON.stringify(outputs);
  const evidenceText = JSON.stringify(platformManifest.platform_native_evidence || {});
  const source = sourceName(manifest);
  if (STALE_PLATFORM_PUBLIC_COPY_RE.test(outputText)) return true;
  if (!isRedditSourceLabelOrUrl(source) && /\bsource\s*:\s*reddit\b/i.test(outputText)) return true;
  if (!isRedditSourceLabelOrUrl(source) && /\bsource\s*reddit\b/i.test(evidenceText)) return true;
  for (const output of Object.values(outputs)) {
    if (!output || typeof output !== "object") continue;
    if (output.title && clean(output.title) !== title) return true;
    if (output.conversational_hook && clean(output.conversational_hook) !== firstLine) return true;
    if (output.first_spoken_line && clean(output.first_spoken_line) !== firstLine) return true;
    if (output.opening_line && clean(output.opening_line) !== firstLine) return true;
    if (output.cover_frame?.headline && clean(output.cover_frame.headline) !== headline) return true;
    if (output.thumbnail_headline && clean(output.thumbnail_headline) !== headline) return true;
    if (output.thumbnail_text && clean(output.thumbnail_text) !== headline) return true;
  }
  return false;
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function timestampWordsFromOptions(options = {}) {
  const raw =
    options.words ||
    options.word_timestamps ||
    options.timestamps?.words ||
    options.timestampPayload?.words;
  return asArray(raw)
    .map((word) => ({
      word: clean(word.word || word.text),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start);
}

function buildTimedCaptionSrt(script = "", durationS = 28, options = {}) {
  const words = timestampWordsFromOptions(options);
  if (!words.length) return "";
  const wordDuration = Math.max(...words.map((word) => Number(word.end) || 0), 0);
  const duration = wordDuration > 0 ? wordDuration : Number(durationS) > 0 ? Number(durationS) : 0;
  const realigned = realignTimestampsToScript(script, words);
  const prepared = prepareSubtitleWords({
    words: realigned,
    duration,
    scriptText: script,
    strictEndCoverage: false,
  });
  const phrases = groupIntoPhrases(prepared, {
    maxWordsPerPhrase: Number(options.maxWordsPerPhrase) || 3,
    maxPhraseChars: Number(options.maxPhraseChars) || 24,
    maxPhraseDurationS: Number(options.maxPhraseDurationS) || 1.6,
    avoidDanglingWords: true,
    danglingMergeMaxWords: Number(options.danglingMergeMaxWords) || 3,
  }).filter((phrase) => asArray(phrase.words).length && Number.isFinite(Number(phrase.start)) && Number.isFinite(Number(phrase.end)));
  if (!phrases.length) return "";
  return `${phrases.map((phrase, index) => {
    const text = asArray(phrase.words).map((word) => clean(word.word)).filter(Boolean).join(" ");
    return [
      String(index + 1),
      `${formatSrtTime(phrase.start)} --> ${formatSrtTime(phrase.end)}`,
      text,
    ].join("\n");
  }).join("\n\n")}\n`;
}

function buildCaptionSrt(script = "", durationS = 28, options = {}) {
  const timed = buildTimedCaptionSrt(script, durationS, options);
  if (timed) return timed;
  const lines = sentenceList(script).slice(0, 8);
  const segment = Math.max(1.4, durationS / Math.max(1, lines.length));
  return `${lines.map((line, index) => {
    const start = index * segment;
    const end = Math.min(durationS, start + segment);
    return [String(index + 1), `${formatSrtTime(start)} --> ${formatSrtTime(end)}`, line].join("\n");
  }).join("\n\n")}\n`;
}

function publicCopyFingerprint(manifest = {}) {
  const fields = [
    "canonical_subject",
    "canonical_game",
    "selected_title",
    "short_title",
    "thumbnail_headline",
    "thumbnail_text",
    "first_spoken_line",
    "narration_hook",
    "narration_script",
    "full_script",
    "tts_script",
    "description",
    "pinned_comment",
  ];
  const value = {};
  for (const field of fields) value[field] = clean(manifest[field]);
  value.allowed_public_wording = asArray(manifest.allowed_public_wording).map(clean);
  return JSON.stringify(value);
}

const THUMBNAIL_ONLY_PUBLIC_COPY_FAILURES = new Set([
  "public_copy:thumbnail_headline_dangles",
  "public_copy:thumbnail_headline_repeated_token",
  "public_copy:thumbnail_semantically_truncated",
]);

function thumbnailOnlyPublicCopyRepair(before = {}) {
  const failures = asArray(before.failures).map(clean).filter(Boolean);
  return failures.length > 0 && failures.every((failure) => THUMBNAIL_ONLY_PUBLIC_COPY_FAILURES.has(failure));
}

function repairGoalPublicCopyManifest(manifest = {}, { generatedAt = new Date().toISOString(), usedTitles = null } = {}) {
  const before = evaluateGoalPublicCopy(manifest);
  const subject = inferSubject(manifest);
  const title = choosePublicTitle(subject, manifest, usedTitles || new Set());
  const source = sourceName(manifest);
  const claim = cleanClaim(manifest, subject);
  const firstLine = firstLineForTitle(title, subject, manifest);
  const preserveExistingNarration = thumbnailOnlyPublicCopyRepair(before);
  const existingNarrationScript = clean(manifest.narration_script || manifest.full_script || manifest.tts_script);
  const narrationScript = preserveExistingNarration && existingNarrationScript
    ? existingNarrationScript
    : buildNarrationScript({ firstLine, claim, source, subject, title });
  const fullScript = preserveExistingNarration && clean(manifest.full_script || narrationScript)
    ? clean(manifest.full_script || narrationScript)
    : narrationScript;
  const ttsScript = preserveExistingNarration && clean(manifest.tts_script || narrationScript)
    ? clean(manifest.tts_script || narrationScript)
    : narrationScript;
  const officialSource = sourceTypeIsOfficial(manifest.source_attribution_repair?.applied_source?.source_type)
    ? source
    : clean(manifest.official_source) && !isRedditSourceLabelOrUrl(manifest.official_source)
      ? clean(manifest.official_source)
      : null;
  const updated = normaliseProtectedNamesInManifest({
    ...manifest,
    canonical_subject: subject,
    canonical_game: manifest.canonical_game && manifest.canonical_game !== manifest.canonical_subject ? manifest.canonical_game : subject,
    primary_source: source,
    source_card_label: source,
    official_source: officialSource,
    selected_title: title,
    short_title: title,
    title_candidates: [title, ...asArray(manifest.title_candidates).filter((item) => clean(item) !== title)].slice(0, 5),
    thumbnail_headline: subjectAnchoredThumbnailHeadline(title, subject),
    thumbnail_text: subjectAnchoredThumbnailHeadline(title, subject),
    first_spoken_line: firstLine,
    narration_hook: firstLine,
    narration_script: narrationScript,
    full_script: fullScript,
    tts_script: ttsScript,
    description: descriptionFor(manifest, claim, source, subject),
    pinned_comment: `Source: ${source}.`,
    confirmed_claims: [claim],
    allowed_public_wording: [title, firstLine],
    public_copy_repaired_at: generatedAt,
    public_copy_repair_strategy: "deterministic_source_safe_rewrite",
  });
  if (manifest.platform_publish_manifest) {
    updated.platform_publish_manifest = syncPlatformPublishManifest(
      manifest.platform_publish_manifest,
      updated,
      { generatedAt },
    );
  }
  if (manifest.platform_manifest) {
    updated.platform_manifest = syncPlatformPublishManifest(
      manifest.platform_manifest,
      updated,
      { generatedAt },
    );
  }
  const after = evaluateGoalPublicCopy(updated);
  if (after.verdict === "pass" && usedTitles) usedTitles.add(titleFingerprint(title));
  return {
    changed: JSON.stringify(manifest) !== JSON.stringify(updated),
    before,
    after,
    manifest: updated,
  };
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath).catch(() => fallback);
}

function asrExhaustedStoryIds(audioWorkbench = {}) {
  const ids = new Set();
  for (const job of asArray(audioWorkbench.jobs)) {
    const storyId = clean(job.story_id || job.id);
    if (!storyId) continue;
    const asrStatus = clean(job.asr_failure?.status);
    const asrReason = clean(job.asr_failure?.reason);
    const audioReason = clean(job.audio?.reason || job.audio_evidence?.reason);
    const timestampReason = clean(job.timestamps?.reason || job.timestamp_evidence?.reason);
    const reasonText = [asrStatus, asrReason, audioReason, timestampReason].join(" ");
    if (
      /\bexhausted_requires_narration_regeneration\b/i.test(asrStatus) ||
      /\basr_alignment_exhausted_regenerate_narration\b/i.test(reasonText) ||
      (
        /\basr_inserted_words_regenerate_narration\b/i.test(reasonText) &&
        /\basr_inserted_words_above_threshold\b/i.test(reasonText)
      )
    ) {
      ids.add(storyId);
    }
  }
  return ids;
}

async function repairGoalPublicCopyPackages({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  sourceAttributionEntries = [],
  audioWorkbench = {},
  reservedTitles = [],
} = {}) {
  const changed = [];
  const unchanged = [];
  const blocked = [];
  const usedTitles = new Set();
  for (const title of asArray(reservedTitles)) {
    const fingerprint = titleFingerprint(title);
    if (fingerprint) usedTitles.add(fingerprint);
  }
  const asrExhaustedIds = asrExhaustedStoryIds(audioWorkbench);
  for (const storyPackage of asArray(storyPackages)) {
    const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir;
    const storyId = storyPackage.story_id || "unknown";
    if (!artifactDir) {
      blocked.push({ story_id: storyId, status: "blocked", blockers: ["missing_artifact_dir"] });
      continue;
    }
    const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
    const loadedManifest = await readJsonIfPresent(manifestPath, null);
    if (!loadedManifest) {
      blocked.push({ story_id: storyId, artifact_dir: artifactDir, status: "blocked", blockers: ["missing_canonical_manifest"] });
      continue;
    }
    const attributionEntry = sourceAttributionEntryForStory(sourceAttributionEntries, storyPackage.story_id || loadedManifest.story_id || storyId);
    const attributionRepair = attributionEntry
      ? applySourceAttributionRepair(loadedManifest, attributionEntry, { generatedAt })
      : { manifest: loadedManifest, failures: [], changed: false };
    if (attributionRepair.failures.length) {
      blocked.push({
        story_id: storyPackage.story_id || loadedManifest.story_id || storyId,
        artifact_dir: artifactDir,
        status: "blocked",
        blockers: attributionRepair.failures,
      });
      continue;
    }
    const manifest = attributionRepair.manifest;
    const resolvedStoryId = clean(storyPackage.story_id || manifest.story_id || storyId);
    const forceAsrSafeRewrite = asrExhaustedIds.has(resolvedStoryId);
    const before = evaluateGoalPublicCopy(manifest);
    const beforeFailures = packageRepairFailures(manifest, before);
    const descriptionSubjectFailures = descriptionSubjectFailuresForManifest(manifest);
    const nonDescriptionSubjectFailures = beforeFailures.filter(
      (failure) => failure !== "public_output:description_missing_canonical_subject",
    );
    const platformManifestPath = path.join(artifactDir, "platform_publish_manifest.json");
    const platformManifest = await readJsonIfPresent(platformManifestPath, null);
    const standalonePlatformPacks = await readStandalonePlatformPacks(artifactDir);
    const platformNeedsSync =
      platformManifestNeedsSync(platformManifest, manifest) ||
      standalonePlatformPacksNeedSync(standalonePlatformPacks, manifest, { generatedAt });
    const currentTitleFingerprint = titleFingerprint(manifest.selected_title || manifest.short_title || manifest.canonical_title);
    const scriptScorecardPath = path.join(artifactDir, "script_scorecard.json");
    const existingScriptScorecard = await readJsonIfPresent(scriptScorecardPath, null);
    const scriptScorecardRepairNeeded = scriptScorecardNeedsRepair(existingScriptScorecard);
    if (
      !forceAsrSafeRewrite &&
      attributionRepair.changed &&
      before.verdict === "pass" &&
      beforeFailures.length === 0 &&
      thumbnailMentionsSubject(manifest) &&
      currentTitleFingerprint &&
      !usedTitles.has(currentTitleFingerprint)
    ) {
      const repair = repairGoalPublicCopyManifest(manifest, { generatedAt, usedTitles });
      const afterFailures = packageRepairFailures(repair.manifest, repair.after);
      if (repair.after.verdict !== "pass" || afterFailures.length > 0) {
        blocked.push({
          story_id: storyPackage.story_id || manifest.story_id || storyId,
          artifact_dir: artifactDir,
          status: "blocked",
          blockers: afterFailures,
        });
        continue;
      }
      const pendingRegeneration = publicCopyRegenerationPending(repair.manifest);
      await fs.writeJson(manifestPath, repair.manifest, { spaces: 2 });
      await syncPublicCopyOutputArtifacts({
        artifactDir,
        platformManifestPath,
        platformManifest,
        manifest: repair.manifest,
        generatedAt,
      });
      changed.push({
        story_id: storyPackage.story_id || repair.manifest.story_id || storyId,
        title: repair.manifest.selected_title,
        artifact_dir: artifactDir,
        before_failures: beforeFailures,
        after_warnings: repair.after.warnings,
        status: pendingRegeneration
          ? "source_attribution_synced_pending_public_copy_regeneration"
          : "source_attribution_synced",
        public_copy_regeneration_pending: pendingRegeneration,
      });
      continue;
    }
    if (
      !forceAsrSafeRewrite &&
      before.verdict === "pass" &&
      beforeFailures.length === 0 &&
      thumbnailMentionsSubject(manifest) &&
      scriptScorecardRepairNeeded &&
      currentTitleFingerprint &&
      !usedTitles.has(currentTitleFingerprint)
    ) {
      const currentScorecard = scriptScorecardForManifest(manifest);
      if (scriptScorecardPasses(currentScorecard)) {
        usedTitles.add(currentTitleFingerprint);
        await fs.writeJson(scriptScorecardPath, currentScorecard, { spaces: 2 });
        await syncPublicCopyOutputArtifacts({
          artifactDir,
          platformManifestPath,
          platformManifest,
          manifest,
          generatedAt,
        });
        changed.push({
          story_id: storyPackage.story_id || manifest.story_id || storyId,
          title: manifest.selected_title,
          artifact_dir: artifactDir,
          before_failures: beforeFailures,
          after_warnings: before.warnings,
          status: "script_scorecard_refreshed",
          public_copy_regeneration_pending: publicCopyRegenerationPending(manifest),
        });
        continue;
      }

      const repair = repairGoalPublicCopyManifest(manifest, { generatedAt, usedTitles });
      const afterFailures = packageRepairFailures(repair.manifest, repair.after);
      const repairedScorecard = scriptScorecardForManifest(repair.manifest);
      if (
        repair.after.verdict !== "pass" ||
        afterFailures.length > 0 ||
        !scriptScorecardPasses(repairedScorecard)
      ) {
        const scriptFailures = scriptScorecardFailureCodes(repairedScorecard);
        blocked.push({
          story_id: storyPackage.story_id || manifest.story_id || storyId,
          artifact_dir: artifactDir,
          status: "blocked",
          blockers: [
            ...afterFailures,
            ...scriptFailures,
          ],
        });
        continue;
      }
      await fs.writeJson(manifestPath, repair.manifest, { spaces: 2 });
      await fs.writeJson(scriptScorecardPath, repairedScorecard, { spaces: 2 });
      await syncPublicCopyOutputArtifacts({
        artifactDir,
        platformManifestPath,
        platformManifest,
        manifest: repair.manifest,
        generatedAt,
      });
      await fs.writeFile(path.join(artifactDir, "captions.srt"), buildCaptionSrt(repair.manifest.narration_script), "utf8");
      changed.push({
        story_id: storyPackage.story_id || repair.manifest.story_id || storyId,
        title: repair.manifest.selected_title,
        artifact_dir: artifactDir,
        before_failures: beforeFailures,
        after_warnings: repair.after.warnings,
        status: "script_scorecard_repaired",
        public_copy_regeneration_pending: true,
      });
      continue;
    }
    if (
      !forceAsrSafeRewrite &&
      before.verdict === "pass" &&
      descriptionSubjectFailures.length > 0 &&
      nonDescriptionSubjectFailures.length === 0 &&
      thumbnailMentionsSubject(manifest) &&
      currentTitleFingerprint &&
      !usedTitles.has(currentTitleFingerprint)
    ) {
      usedTitles.add(currentTitleFingerprint);
      const subject = inferSubject(manifest);
      const source = sourceName(manifest);
      const claim = cleanClaim(manifest, subject);
      const updatedManifest = {
        ...manifest,
        canonical_subject: subject,
        description: descriptionFor(manifest, claim, source, subject),
        description_subject_synced_at: generatedAt,
        public_copy_metadata_synced_at: generatedAt,
      };
      await fs.writeJson(manifestPath, updatedManifest, { spaces: 2 });
      await syncPublicCopyOutputArtifacts({
        artifactDir,
        platformManifestPath,
        platformManifest,
        manifest: updatedManifest,
        generatedAt,
      });
      changed.push({
        story_id: storyPackage.story_id || manifest.story_id || storyId,
        title: updatedManifest.selected_title,
        artifact_dir: artifactDir,
        before_failures: beforeFailures,
        after_warnings: before.warnings,
        status: "description_subject_synced",
      });
      continue;
    }
    if (
      !forceAsrSafeRewrite &&
      before.verdict === "pass" &&
      beforeFailures.length === 0 &&
      thumbnailMentionsSubject(manifest) &&
      platformNeedsSync &&
      currentTitleFingerprint &&
      !usedTitles.has(currentTitleFingerprint)
    ) {
      usedTitles.add(currentTitleFingerprint);
      const pendingRegeneration = publicCopyRegenerationPending(manifest);
      await syncPublicCopyOutputArtifacts({
        artifactDir,
        platformManifestPath,
        platformManifest,
        manifest,
        generatedAt,
      });
      changed.push({
        story_id: storyPackage.story_id || manifest.story_id || storyId,
        title: manifest.selected_title,
        artifact_dir: artifactDir,
        before_failures: beforeFailures,
        after_warnings: before.warnings,
        status: pendingRegeneration
          ? "platform_pack_synced_pending_public_copy_regeneration"
          : "platform_pack_synced",
        public_copy_regeneration_pending: pendingRegeneration,
      });
      continue;
    }
    if (
      !forceAsrSafeRewrite &&
      before.verdict === "pass" &&
      beforeFailures.length === 0 &&
      thumbnailMentionsSubject(manifest) &&
      !platformNeedsSync &&
      currentTitleFingerprint &&
      !usedTitles.has(currentTitleFingerprint)
    ) {
      usedTitles.add(currentTitleFingerprint);
      unchanged.push({
        story_id: storyPackage.story_id || manifest.story_id || storyId,
        title: manifest.selected_title,
        artifact_dir: artifactDir,
        status: unchangedStatusForManifest(manifest),
      });
      continue;
    }
    const beforeFingerprint = publicCopyFingerprint(manifest);
    const repair = repairGoalPublicCopyManifest(manifest, { generatedAt, usedTitles });
    const afterFailures = packageRepairFailures(repair.manifest, repair.after);
    if (repair.after.verdict !== "pass" || afterFailures.length > 0) {
      blocked.push({
        story_id: storyPackage.story_id || manifest.story_id || storyId,
        artifact_dir: artifactDir,
        status: "blocked",
        blockers: afterFailures,
      });
      continue;
    }
    const afterFingerprint = publicCopyFingerprint(repair.manifest);
    if (beforeFingerprint === afterFingerprint) {
      if (platformNeedsSync) {
        const pendingRegeneration = publicCopyRegenerationPending(repair.manifest);
        await syncPublicCopyOutputArtifacts({
          artifactDir,
          platformManifestPath,
          platformManifest,
          manifest: repair.manifest,
          generatedAt,
        });
        changed.push({
          story_id: storyPackage.story_id || manifest.story_id || storyId,
          title: repair.manifest.selected_title,
          artifact_dir: artifactDir,
          before_failures: beforeFailures,
          after_warnings: repair.after.warnings,
          status: pendingRegeneration
            ? "platform_pack_synced_pending_public_copy_regeneration"
            : "platform_pack_synced",
          public_copy_regeneration_pending: pendingRegeneration,
        });
        continue;
      }
      unchanged.push({
        story_id: storyPackage.story_id || manifest.story_id || storyId,
        title: repair.manifest.selected_title,
        artifact_dir: artifactDir,
        status: unchangedStatusForManifest(repair.manifest),
      });
      continue;
    }
    await fs.writeJson(manifestPath, repair.manifest, { spaces: 2 });
    await syncPublicCopyOutputArtifacts({
      artifactDir,
      platformManifestPath,
      platformManifest,
      manifest: repair.manifest,
      generatedAt,
    });
    await fs.writeFile(path.join(artifactDir, "captions.srt"), buildCaptionSrt(repair.manifest.narration_script), "utf8");
    changed.push({
      story_id: storyPackage.story_id || manifest.story_id || storyId,
      title: repair.manifest.selected_title,
      artifact_dir: artifactDir,
      before_failures: beforeFailures,
      after_warnings: repair.after.warnings,
      status: forceAsrSafeRewrite
        ? "changed_asr_exhausted_rewrite"
        : repair.changed ? "changed" : "rewritten_same",
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PUBLIC_COPY_REPAIR",
    summary: {
      package_count: asArray(storyPackages).length,
      changed_count: changed.length,
      unchanged_count: unchanged.length,
      blocked_count: blocked.length,
    },
    changed,
    unchanged,
    blocked,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      audio_and_render_must_be_regenerated_after_copy_repair: true,
    },
  };
}

function selectedRepairTtsProvider({ localTts = {}, elevenlabsTts = {}, providerPreference = "auto" } = {}) {
  const preference = clean(providerPreference || "auto").toLowerCase();
  if (preference === "local") return localTts.ready === true ? "local" : null;
  if (preference === "elevenlabs") return elevenlabsTts.ready === true ? "elevenlabs" : null;
  if (localTts.ready === true) return "local";
  if (elevenlabsTts.ready === true) return "elevenlabs";
  return null;
}

function buildAudioRegenerationWorkbench(
  repairReport = {},
  { localTts = {}, elevenlabsTts = null, providerPreference = "auto" } = {},
) {
  const selectedProvider = selectedRepairTtsProvider({ localTts, elevenlabsTts: elevenlabsTts || {}, providerPreference });
  const jobs = repairItemsNeedingAudioRerender(repairReport)
    .map((item) => ({
    story_id: item.story_id,
    title: item.title,
    artifact_dir: item.artifact_dir,
    status: "requires_audio_timestamp_generation",
    ...(selectedProvider ? { tts_provider: selectedProvider } : {}),
    missing: ["regenerated_narration_audio", "regenerated_word_timestamps"],
    audio: { usable: false, reason: "public_copy_repaired" },
    timestamps: { usable: false, reason: "public_copy_repaired" },
    local_tts: localTts,
    ...(elevenlabsTts ? { elevenlabs_tts: elevenlabsTts } : {}),
    next_actions: ["regenerate_narration_audio_with_word_timestamps", "rerender_visual_v4_production"],
  }));
  const ttsBlocked = selectedProvider ? 0 : jobs.length;
  return {
    schema_version: 1,
    generated_at: repairReport.generated_at || new Date().toISOString(),
    mode: "LOCAL_AUDIO_TIMESTAMP_WORKBENCH",
    source_work_order_generated_at: repairReport.generated_at || null,
    summary: {
      story_count: jobs.length,
      ready_audio_timestamp_pair_count: 0,
      blocked_local_tts_count: !selectedProvider && localTts.ready === false ? jobs.length : 0,
      blocked_tts_count: ttsBlocked,
      elevenlabs_generation_count: jobs.filter((job) => job.tts_provider === "elevenlabs").length,
      requires_generation_count: jobs.length,
    },
    local_tts: localTts,
    elevenlabs_tts: elevenlabsTts || null,
    provider_preference: providerPreference,
    jobs,
    safety: {
      no_tts_generation_triggered: true,
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

async function buildProductionRerenderWorkOrder(repairReport = {}) {
  const jobs = [];
  for (const item of repairItemsNeedingAudioRerender(repairReport)) {
    const renderStory = await readJsonIfPresent(path.join(item.artifact_dir, "visual_v4_render_story.json"), {});
    const clips = asArray(renderStory.video_clips);
    const blockers = clips.length ? [] : ["materialised_motion_clip_paths_missing"];
    jobs.push({
      story_id: item.story_id,
      title: item.title,
      artifact_dir: item.artifact_dir,
      status: blockers.length ? "blocked_on_render_inputs" : "ready_for_final_render_job",
      blockers,
      evidence: {
        narration_audio_path: `output/audio/${item.story_id}.mp3`,
        word_timestamps_path: `output/audio/${item.story_id}_timestamps.json`,
        materialised_motion_clip_paths: clips,
      },
      actions: [
        {
          action_id: "run_visual_v4_production_render",
          status: blockers.length ? "blocked_missing_materialised_motion" : "ready_after_public_copy_repair",
          target_render_manifest: {
            output_path: path.join(item.artifact_dir, "visual_v4_render.mp4"),
            manifest_path: path.join(item.artifact_dir, "render_manifest.json"),
          },
        },
      ],
    });
  }
  return {
    schema_version: 1,
    generated_at: repairReport.generated_at || new Date().toISOString(),
    mode: "LOCAL_RENDER_INPUT_WORK_ORDER",
    source_cutover_generated_at: repairReport.generated_at || null,
    summary: {
      story_count: jobs.length,
      ready_for_final_render_job_count: jobs.filter((job) => job.status === "ready_for_final_render_job").length,
      blocked_on_render_inputs_count: jobs.filter((job) => job.status === "blocked_on_render_inputs").length,
      audio_timestamp_jobs: 0,
      owned_motion_materialisation_jobs: jobs.filter((job) => job.status === "blocked_on_render_inputs").length,
    },
    jobs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function safeFilePart(value = "") {
  return clean(value).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "story";
}

function buildSourceAttributionRepairWorkOrder(repairReport = {}) {
  const jobs = asArray(repairReport.blocked)
    .filter((item) =>
      asArray(item.blockers).some((blocker) =>
        [
          "public_copy:reddit_discovery_label_used_as_primary_source",
          "public_copy:non_news_image_post_source",
        ].includes(blocker),
      ),
    )
    .map((item) => {
      const storyId = clean(item.story_id || "unknown");
      const safeStoryId = safeFilePart(storyId);
      const artifactDir = clean(item.artifact_dir);
      const blockerType = asArray(item.blockers).find((blocker) =>
        [
          "public_copy:reddit_discovery_label_used_as_primary_source",
          "public_copy:non_news_image_post_source",
        ].includes(blocker),
      ) || "public_copy:reddit_discovery_label_used_as_primary_source";
      const intakePath = `output/goal-contract/source-attribution-repair/${safeStoryId}_official_source_entries.json`;
      const reportPath = `output/goal-contract/source-attribution-repair/${safeStoryId}_official_source_intake_report.json`;
      return {
        story_id: storyId,
        artifact_dir: artifactDir,
        blocker_type: blockerType,
        repair_lane: "official_source_intake_required",
        exact_missing_input: blockerType === "public_copy:non_news_image_post_source"
          ? "A non-image primary source, official source or reliable publication source that supports the public claim."
          : "A non-Reddit primary source, official source or reliable publication source that supports the public claim.",
        recommended_command:
          `node tools/official-source-intake.js --story-json "${path.join(artifactDir, "canonical_story_manifest.json")}" --input "${intakePath}" --output-json "${reportPath}" --json`,
        expected_output: [
          "official_source_intake_report.json with at least one accepted reference for this story",
          "canonical_story_manifest.json updated so primary_source/source_card_label no longer use Reddit as a confirmed primary source",
          "platform_publish_manifest.json regenerated with the corrected source label",
          "final narration, word timestamps and final render regenerated after copy changes",
        ],
        db_mutation_required: false,
        operator_approval_required: true,
        post_repair_validation_command:
          "npm run ops:goal-dry-run-publish -- --story-packages output/goal-contract/production_cutover_story_packages.json --candidate-report test/output/next_publish_candidates.json --platform-status output/goal-contract/platform_status_matrix.json --motion-pack-root output/studio-v4/motion-packs --out-dir output/goal-contract --json",
      };
    });

  return {
    schema_version: 1,
    generated_at: repairReport.generated_at || new Date().toISOString(),
    mode: "SOURCE_ATTRIBUTION_REPAIR_WORK_ORDER",
    summary: {
      story_count: jobs.length,
      official_source_intake_required_count: jobs.length,
    },
    jobs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

module.exports = {
  repairGoalPublicCopyManifest,
  repairGoalPublicCopyPackages,
  buildAudioRegenerationWorkbench,
  buildProductionRerenderWorkOrder,
  buildSourceAttributionRepairWorkOrder,
  buildCaptionSrt,
  platformManifestNeedsSync,
  syncPlatformPublishManifest,
  publicCopyRegenerationPending,
  repairItemsNeedingAudioRerender,
};
