"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inferHeadlineGameCandidates } = require("./game-title-inference");
const {
  isPlaceholderPublicTitle,
  isRawArticleTitleShape,
  titleWordCount,
} = require("./public-title");
const { sourceNameFromUrl } = require("./source-bound-script-writer");

const ROOT = path.resolve(__dirname, "..");

const PLACEHOLDER_TITLE_RE =
  /^(?:this\s+gaming\s+story|gaming\s+story|gaming\s+news\s+update|this\s+story|new\s+gaming\s+update)$/i;

const REDDIT_HOST_RE = /(?:^|\.)redd(?:it\.com|\.it)$/i;
const RAW_IMAGE_HOST_RE = /^(?:i\.redd\.it|preview\.redd\.it|i\.imgur\.com|imgur\.com)$/i;

const INTERNAL_QA_PHRASES = [
  {
    id: "source_backed_update",
    re: /\bsource[-\s]?backed update\b/i,
  },
  {
    id: "not_a_blank_check",
    re: /\bnot a blank (?:check|cheque)\b/i,
  },
  {
    id: "invent_extra_details",
    re: /\binvent extra details\b/i,
  },
  {
    id: "named_source_confirms",
    re: /\bnamed source confirms\b/i,
  },
  {
    id: "wait_and_see_column",
    re: /\bwait[-\s]and[-\s]see column\b/i,
  },
  {
    id: "reddit_reaction_into_evidence",
    re: /\bReddit reaction into evidence\b/i,
  },
];

const CAVEAT_DENSITY_RE =
  /\b(?:caveat|sourced update|source[-\s]?backed|not a blank (?:check|cheque)|invent extra details|over[-\s]?claim|treat the headline|confirmed only|named source|wait[-\s]and[-\s]see|Reddit reaction|source confirms|safest public version|does not provide)\b/i;

const ADVERTISER_UNFRIENDLY_PUBLIC_RE =
  /\b(?:porn|pornography|gambling|casino|betting|wagering)\b/i;

class PublicOutputCoherenceError extends Error {
  constructor(failures, gate) {
    super(`Public output coherence failed: ${failures.join(", ")}`);
    this.name = "PublicOutputCoherenceError";
    this.code = "public_output_coherence_failed";
    this.failures = failures;
    this.gate = gate;
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function hostFromUrl(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isRedditUrl(url) {
  const host = hostFromUrl(url);
  return Boolean(host && REDDIT_HOST_RE.test(host));
}

function hasNonRedditArticle(story = {}) {
  const url = story.article_url || story.primary_source_url || story.source_url || "";
  if (!/^https?:\/\//i.test(String(url || ""))) return false;
  return !isRedditUrl(url);
}

function discoverySourceFor(story = {}) {
  const sourceType = String(story.source_type || "").toLowerCase();
  const subreddit = cleanText(story.subreddit || "");
  if (sourceType === "reddit" && subreddit) {
    return subreddit.toLowerCase().startsWith("r/") ? subreddit : `r/${subreddit}`;
  }
  return cleanText(story.discovery_source || story.source_name || "");
}

function articleUrlFor(story = {}) {
  return (
    story.primary_source_url ||
    story.article_url ||
    story.source_url ||
    (!isRedditUrl(story.url) ? story.url : "") ||
    ""
  );
}

function primarySourceFor(story = {}) {
  const explicit = cleanText(story.primary_source || story.primary_source_name);
  if (explicit && !/^r\//i.test(explicit)) return explicit;

  const articleUrl = articleUrlFor(story);
  if (articleUrl && !isRedditUrl(articleUrl)) {
    return sourceNameFromUrl(articleUrl) || hostFromUrl(articleUrl);
  }

  const sourceName = cleanText(story.publisher || story.outlet || story.source_name);
  if (sourceName && !/^r\//i.test(sourceName)) return sourceName;

  return discoverySourceFor(story) || "Unknown source";
}

function subjectFromTitle(title) {
  const clean = cleanText(title)
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+-\s+.*$/g, "")
    .replace(
      /\s+(?:will|won't|wont|has|have|is|are|was|were|just|gets?|got|says?|reports?|confirms?|reveals?|announces?|becomes?|became|hits?|hit|reaches?|passes?|launches?|delays?|dodged|avoided)\b.*$/i,
      "",
    )
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 6) return clean;
  return "";
}

function canonicalSubjectInfoFor(story = {}) {
  const explicit = cleanText(
    story.canonical_subject ||
      story.canonical_game ||
      story.game_title ||
      story.game ||
      story.primary_entity ||
      story.company_name,
  );
  if (explicit) return { value: explicit, confidence: "explicit" };

  const inferred = inferHeadlineGameCandidates(story.title || story.suggested_title || "");
  if (inferred.length > 0) return { value: inferred[0], confidence: "inferred" };

  return {
    value: subjectFromTitle(story.title || story.suggested_title || "") || "This story",
    confidence: "fallback",
  };
}

function canonicalSubjectFor(story = {}) {
  return canonicalSubjectInfoFor(story).value;
}

function isPlaceholderTitle(value) {
  const title = cleanText(value).replace(/[.!?]+$/g, "");
  return !title || PLACEHOLDER_TITLE_RE.test(title) || isPlaceholderPublicTitle(title);
}

function titleForManifest(story = {}) {
  const title = cleanText(
    story.public_title ||
      story.upload_title ||
      story.suggested_title ||
      story.selected_title ||
      story.short_title ||
      story.canonical_title ||
      story.title,
  );
  return title || "This gaming story";
}

function thumbnailTextFor(story = {}) {
  return cleanText(story.thumbnail_text || story.thumbnail_headline || story.suggested_thumbnail_text || "");
}

function scriptFor(story = {}) {
  return cleanText(
    story.narration_script ||
      story.full_script ||
      story.tts_script ||
      [story.hook, story.body, story.loop, story.cta].filter(Boolean).join(" "),
  );
}

function firstFiveSecondsText(script = "") {
  const text = cleanText(script);
  const firstSentence = (text.match(/[^.!?]+[.!?]?/) || [text])[0];
  const words = text.split(/\s+/).filter(Boolean).slice(0, 14).join(" ");
  return cleanText(firstSentence).length <= 120 ? cleanText(firstSentence) : words;
}

function textContainsSubject(text, subject) {
  const haystack = normaliseKey(text);
  const needle = normaliseKey(subject);
  if (!needle || needle === "this story") return true;
  if (!haystack) return false;
  if (haystack.includes(needle)) return true;
  return needle
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["this", "that", "with", "from"].includes(token))
    .some((token) => haystack.includes(token));
}

function sourceLabelIsReddit(label) {
  return /^r\//i.test(cleanText(label)) || /\breddit\b/i.test(cleanText(label));
}

function sourceLabelsMatch(a, b) {
  const left = normaliseKey(a);
  const right = normaliseKey(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function sentenceList(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function arrayify(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

function uniqueList(items = []) {
  return [...new Set(arrayify(items))];
}

function sourceConfidenceFor(story = {}, primarySource = "") {
  if (Number.isFinite(Number(story.source_confidence_score))) {
    return Math.max(0, Math.min(1, Number(story.source_confidence_score)));
  }
  if (primarySource && primarySource !== "Unknown source" && hasNonRedditArticle(story)) return 0.9;
  if (primarySource && primarySource !== "Unknown source") return 0.75;
  return 0.35;
}

function staleWordingRisksFor(story = {}, script = "", publicTitle = "") {
  const text = `${story.title || ""} ${publicTitle} ${script}`;
  const risks = [];
  const patterns = [
    { id: "today", re: /\btoday\b/i },
    { id: "tomorrow", re: /\btomorrow\b/i },
    { id: "yesterday", re: /\byesterday\b/i },
    { id: "this_week", re: /\bthis week\b/i },
    { id: "just_now", re: /\bjust now\b/i },
    { id: "latest", re: /\blatest\b/i },
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(text)) risks.push(pattern.id);
  }
  return uniqueList([...(story.stale_wording_risks || []), ...risks]);
}

function defaultPlatformCtas(story = {}) {
  const landingPage =
    cleanText(story.landing_page_route || story.landing_page_slug || story.story_page_url || "") ||
    "the story page";
  return {
    youtube: `Sources and setup links are on ${landingPage}.`,
    tiktok: `Sources and setup links are on ${landingPage}.`,
    instagram: `Sources and setup links are on ${landingPage}.`,
    facebook: `Sources and setup links are on ${landingPage}.`,
    x: `Sources and setup links are on ${landingPage}.`,
    threads: `Sources and setup links are on ${landingPage}.`,
    pinterest: `Sources and setup links are on ${landingPage}.`,
  };
}

function hasAdvertiserUnfriendlyPublicTerms(value) {
  return ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(cleanText(value));
}

function hasExternalSourceEvidence(story = {}, manifest = {}) {
  const secondarySources = [
    ...arrayify(story.secondary_sources),
    ...arrayify(manifest.secondary_sources),
  ];
  return Boolean(
    cleanText(story.official_source || story.official_confirmation_source) ||
      cleanText(manifest.official_source || manifest.official_confirmation_source) ||
      secondarySources.some((source) => source && !sourceLabelIsReddit(source)),
  );
}

function isRawImageSourceUrl(value = "") {
  const url = cleanText(value);
  if (!url) return false;
  const host = hostFromUrl(url);
  return RAW_IMAGE_HOST_RE.test(host) || /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(url);
}

function nonNewsImagePostSourceFailure(story = {}, manifest = {}) {
  if (hasExternalSourceEvidence(story, manifest)) return false;
  const label = cleanText(
    story.primary_source ||
      story.source_card_label ||
      manifest.primary_source ||
      manifest.source_card_label,
  );
  const url =
    story.primary_source_url ||
    story.article_url ||
    story.source_url ||
    story.url ||
    manifest.primary_source_url ||
    manifest.source_url ||
    "";
  return /^(?:i|image|imgur|i\.redd\.it|reddit image)$/i.test(label) || isRawImageSourceUrl(url);
}

function hasCommercialLinks(story = {}, manifest = {}) {
  const commercial =
    manifest.commercial_intelligence ||
    story.commercial_intelligence ||
    story.affiliate_link_manifest ||
    null;
  if (!commercial || typeof commercial !== "object") return false;
  if (commercial.primary_link) return true;
  if (arrayify(commercial.fallback_links).length > 0) return true;
  if (arrayify(commercial.affiliate_links).length > 0) return true;
  if (arrayify(commercial.candidate_links).some((link) => link && link.url)) return true;
  return false;
}

function safePublicDescription({
  story = {},
  script = "",
  publicTitle = "",
  canonicalSubject = "",
  primarySource = "",
} = {}) {
  const explicit = cleanText(story.description);
  if (explicit && !hasAdvertiserUnfriendlyPublicTerms(explicit)) return explicit;

  const candidates = [
    firstFiveSecondsText(script),
    cleanText(story.public_summary),
    cleanText(story.summary),
    publicTitle,
    "source-backed gaming update",
  ].filter(Boolean);
  const safeSummary =
    candidates.find((candidate) => !hasAdvertiserUnfriendlyPublicTerms(candidate)) ||
    "source-backed gaming update";
  const subject = cleanText(canonicalSubject) || "Pulse Gaming";
  const source =
    primarySource && primarySource !== "Unknown source" ? ` Source: ${primarySource}.` : "";
  const summary = safeSummary.replace(/[.!?]+$/g, "");
  return cleanText(`${subject}: ${summary}.${source}`).slice(0, 280);
}

function caveatMetrics(script = "") {
  const items = sentenceList(script);
  if (!items.length) return { caveatSentences: 0, totalSentences: 0, ratio: 0 };
  const caveats = items.filter((sentence) => CAVEAT_DENSITY_RE.test(sentence)).length;
  return {
    caveatSentences: caveats,
    totalSentences: items.length,
    ratio: Number((caveats / items.length).toFixed(3)),
  };
}

function resolveCaptionPath(value) {
  const captionPath = cleanText(value);
  if (!captionPath) return "";
  return path.isAbsolute(captionPath) ? captionPath : path.join(ROOT, captionPath);
}

function hasCleanCaptionEvidence({ story = {}, captionPath, captionFileExists }) {
  if (captionFileExists === true) return true;
  if (captionFileExists === false) return false;
  if (story.manual_caption_generated === true || story.clean_manual_captions === true) return true;

  const timingSource = cleanText(story.subtitle_timing_source);
  const timingInspection = story.subtitle_timing_inspection;
  if (timingSource === "timestamps" && (!timingInspection || timingInspection.usable !== false)) {
    return true;
  }
  if (timingSource && timingSource !== "timestamps") return false;
  if (timingInspection && timingInspection.usable === false) return false;

  const candidatePath = resolveCaptionPath(
    captionPath ||
      story.manual_caption_path ||
      story.caption_path ||
      story.captions_path ||
      story.subtitle_path,
  );
  if (candidatePath && fs.existsSync(candidatePath)) return true;
  if (candidatePath) return false;

  return true;
}

function buildStoryManifest(story = {}, options = {}) {
  const subjectInfo = canonicalSubjectInfoFor(story);
  const canonicalSubject = subjectInfo.value;
  const primarySource = primarySourceFor(story);
  const discoverySource = cleanText(story.discovery_source) || discoverySourceFor(story);
  const publicTitle = cleanText(options.publicTitle) || titleForManifest(story);
  const thumbnailText = thumbnailTextFor(story);
  const script = scriptFor(story);
  const sourceCardLabel = primarySource;
  const articleUrl = articleUrlFor(story);
  const referenceBenchmark =
    options.referenceBenchmark || story.media_house_benchmark || story.reference_benchmark || null;
  const commercialIntelligence =
    options.commercialIntelligence ||
    story.affiliate_link_manifest ||
    story.commercial_intelligence ||
    null;
  const narrationHook = cleanText(story.first_spoken_line || story.narration_hook || story.hook) || firstFiveSecondsText(script);
  const selectedTitle = publicTitle;
  const thumbnailHeadline = thumbnailText;
  const confirmedClaims = uniqueList(
    arrayify(story.confirmed_claims).length
      ? story.confirmed_claims
      : [cleanText(story.claim || story.canonical_title || story.title || selectedTitle)],
  );
  const unconfirmedClaims = uniqueList(story.unconfirmed_claims || []);
  const prohibitedClaims = uniqueList(story.prohibited_claims || []);
  const platformCtas = {
    ...defaultPlatformCtas(story),
    ...(story.platform_ctas || {}),
  };
  const rightsManifestId =
    cleanText(story.rights_manifest_id || story.rights_ledger_id || "") ||
    (story.id || story.story_id ? `${story.id || story.story_id}_rights_ledger` : null);
  const affiliatePackId =
    cleanText(
      story.affiliate_pack_id ||
        story.affiliate_link_manifest?.affiliate_pack_id ||
        story.affiliate_link_manifest?.id ||
        story.commercial_intelligence?.affiliate_pack_id ||
        story.commercial_intelligence?.id ||
        "",
    ) || null;
  const officialSource =
    cleanText(story.official_source || story.official_confirmation_source || "") || null;
  const officialConfirmationSource =
    cleanText(story.official_confirmation_source || story.official_source || "") || null;
  const sourceConfidenceScore = sourceConfidenceFor(story, primarySource);
  const staleWordingRisks = staleWordingRisksFor(story, script, selectedTitle);
  const allowedPublicWording = uniqueList(
    story.allowed_public_wording || [selectedTitle, narrationHook],
  );
  const description = safePublicDescription({
    story,
    script,
    publicTitle: selectedTitle,
    canonicalSubject,
    primarySource,
  });

  return {
    story_id: story.id || story.story_id || null,
    canonical_subject: canonicalSubject,
    canonical_subject_confidence: subjectInfo.confidence,
    canonical_game: cleanText(story.canonical_game || story.game_title || canonicalSubject),
    canonical_company: cleanText(story.canonical_company || story.company_name || story.publisher || ""),
    canonical_people: uniqueList(story.canonical_people || story.people || []),
    canonical_title: cleanText(story.canonical_title || story.title || publicTitle),
    canonical_angle:
      cleanText(story.canonical_angle || story.editorial_angle?.lane || "") ||
      (/music|licen[cs]e|delist/i.test(`${story.title || ""} ${script}`)
        ? "music_licence_preservation"
        : cleanText(story.content_pillar || "source_locked_update")),
    primary_source: primarySource,
    primary_source_url: articleUrl || null,
    secondary_sources: uniqueList(story.secondary_sources || story.sources?.secondary || []),
    discovery_source: discoverySource || null,
    official_source: officialSource,
    official_confirmation_source: officialConfirmationSource,
    source_confidence_score: sourceConfidenceScore,
    claim_inventory: {
      confirmed: confirmedClaims,
      unconfirmed: unconfirmedClaims,
      prohibited: prohibitedClaims,
    },
    confirmed_claims: confirmedClaims,
    unconfirmed_claims: unconfirmedClaims,
    prohibited_claims: prohibitedClaims,
    stale_wording_risks: staleWordingRisks,
    allowed_public_wording: allowedPublicWording,
    title_candidates: uniqueList(
      story.title_candidates || [
        selectedTitle,
        story.suggested_title,
        story.public_title,
        story.upload_title,
        story.title,
      ],
    ),
    selected_title: selectedTitle,
    thumbnail_text: thumbnailText,
    thumbnail_headline: thumbnailHeadline,
    short_title: publicTitle,
    narration_hook: narrationHook,
    first_spoken_line: narrationHook,
    narration_script: script,
    description,
    pinned_comment:
      cleanText(story.pinned_comment) ||
      (primarySource !== "Unknown source"
        ? `Source: ${primarySource}. Story links and setup notes are on the story page.`
        : "Story links and setup notes are on the story page."),
    platform_ctas: platformCtas,
    affiliate_pack_id: affiliatePackId,
    rights_manifest_id: rightsManifestId,
    publish_status: cleanText(story.publish_status || story.publish_verdict?.status || "") || "DRAFT",
    source_card_label: sourceCardLabel,
    reference_benchmark: referenceBenchmark,
    commercial_intelligence: commercialIntelligence,
  };
}

function subjectRequiresParity(manifest = {}) {
  return (
    cleanText(manifest.canonical_subject) &&
    cleanText(manifest.canonical_subject) !== "This story" &&
    manifest.canonical_subject_confidence !== "fallback"
  );
}

function runPublicOutputCoherenceGate(pack = {}, options = {}) {
  const story = pack.story || {};
  const manifest = pack.manifest || buildStoryManifest(story, pack);
  const publicTitle = cleanText(pack.publicTitle || options.publicTitle || manifest.short_title);
  const script = cleanText(pack.script || options.script || scriptFor(story));
  const thumbnailText = cleanText(pack.thumbnailText || options.thumbnailText || manifest.thumbnail_text);
  const description = cleanText(pack.description || options.description || manifest.description || story.description);
  const thumbnailSourceLabel = cleanText(
    pack.thumbnailSourceLabel || options.thumbnailSourceLabel || story.thumbnail_source_label || "",
  );
  const sourceCardLabel = cleanText(
    pack.sourceCardLabel || options.sourceCardLabel || story.source_card_label || manifest.source_card_label,
  );
  const requireCaptionEvidence =
    pack.requireCaptionEvidence !== undefined
      ? pack.requireCaptionEvidence !== false
      : options.requireCaptionEvidence !== false;
  const failures = [];
  const warnings = [];

  if (!script) failures.push("public_output:narration_script_missing");
  if (isPlaceholderTitle(publicTitle)) failures.push("public_output:placeholder_title");
  if (isRawArticleTitleShape(publicTitle)) failures.push("public_output:raw_article_title_shape");
  if (hasAdvertiserUnfriendlyPublicTerms(description)) {
    failures.push("public_output:advertiser_unfriendly_description");
  }
  if (hasAdvertiserUnfriendlyPublicTerms(script)) {
    failures.push("public_output:advertiser_unfriendly_narration");
  }
  const requireSubjectParity = subjectRequiresParity(manifest);
  if (requireSubjectParity && !textContainsSubject(publicTitle, manifest.canonical_subject)) {
    failures.push("public_output:title_missing_canonical_subject");
  }
  if (requireSubjectParity && !textContainsSubject(firstFiveSecondsText(script), manifest.canonical_subject)) {
    failures.push("public_output:first_five_seconds_missing_subject");
  }

  for (const phrase of INTERNAL_QA_PHRASES) {
    if (phrase.re.test(script)) {
      failures.push(`public_output:internal_qa_phrase:${phrase.id}`);
    }
  }

  if (
    String(story.source_type || "").toLowerCase() === "reddit" &&
    hasNonRedditArticle(story) &&
    sourceLabelIsReddit(sourceCardLabel)
  ) {
    failures.push("public_output:reddit_primary_source_conflict");
  }
  const rawImageSource = nonNewsImagePostSourceFailure(story, manifest);
  if (rawImageSource) failures.push("public_output:non_news_image_post_source");
  if (rawImageSource && hasCommercialLinks(story, manifest)) {
    failures.push("public_output:affiliate_on_non_news_image_post");
  }

  if (
    thumbnailSourceLabel &&
    !sourceLabelIsReddit(thumbnailSourceLabel) &&
    !sourceLabelsMatch(thumbnailSourceLabel, manifest.primary_source)
  ) {
    failures.push("public_output:thumbnail_source_mismatch");
  } else if (
    thumbnailSourceLabel &&
    sourceLabelIsReddit(thumbnailSourceLabel) &&
    hasNonRedditArticle(story)
  ) {
    failures.push("public_output:thumbnail_source_mismatch");
  }

  if (wordCount(thumbnailText) > 8) failures.push("public_output:thumbnail_text_too_long");
  if (
    requireSubjectParity &&
    thumbnailText &&
    !textContainsSubject(thumbnailText, manifest.canonical_subject)
  ) {
    failures.push("public_output:thumbnail_missing_canonical_subject");
  }

  const caveats = caveatMetrics(script);
  if (caveats.totalSentences > 0 && caveats.ratio > 0.2) {
    failures.push("public_output:caveat_density_high");
  }

  if (
    requireCaptionEvidence &&
    !hasCleanCaptionEvidence({
      story,
      captionPath: pack.captionPath || options.captionPath,
      captionFileExists: pack.captionFileExists ?? options.captionFileExists,
    })
  ) {
    failures.push("public_output:manual_captions_missing");
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: [...new Set(failures)],
    warnings,
    manifest,
    metrics: {
      thumbnail_word_count: wordCount(thumbnailText),
      public_title_word_count: titleWordCount(publicTitle),
      caveat_density: caveats,
      caption_evidence: hasCleanCaptionEvidence({
        story,
        captionPath: pack.captionPath || options.captionPath,
        captionFileExists: pack.captionFileExists ?? options.captionFileExists,
      }),
    },
  };
}

function assertPublicOutputCoherence(pack = {}, options = {}) {
  const gate = runPublicOutputCoherenceGate(pack, options);
  if (gate.failures.length > 0) {
    throw new PublicOutputCoherenceError(gate.failures, gate);
  }
  return true;
}

async function writeStoryManifest(story = {}, options = {}) {
  const outputDir = path.resolve(options.outputDir || path.join(ROOT, "output", "manifests"));
  const safeId = cleanText(story.id || "story")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "story";
  const manifest = buildStoryManifest(story, options);
  const outPath = path.join(outputDir, `${safeId}_story_manifest.json`);

  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { path: outPath, manifest };
}

module.exports = {
  INTERNAL_QA_PHRASES,
  PublicOutputCoherenceError,
  assertPublicOutputCoherence,
  buildStoryManifest,
  caveatMetrics,
  isRawArticleTitleShape,
  runPublicOutputCoherenceGate,
  writeStoryManifest,
};
