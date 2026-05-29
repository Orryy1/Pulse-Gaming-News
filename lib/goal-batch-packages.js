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

function storyUrl(story = {}) {
  return cleanText(story.article_url || story.primary_source_url || story.linked_url || story.url);
}

function sourceBackedForProof(story = {}) {
  const sourceType = cleanText(story.source_type).toLowerCase();
  if (["rss", "official", "publisher", "storefront", "press_kit"].includes(sourceType)) return true;
  const url = storyUrl(story);
  return Boolean(/^https?:\/\//i.test(url) && !isRedditUrl(url));
}

function sourceNameForProof(story = {}) {
  return cleanText(story.primary_source || story.source_name || story.publisher || story.outlet) ||
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
    .replace(/\s+(?:official|gameplay|trailer|review|release|date)\b.*$/i, "")
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

function publicTitleForProof(story = {}, subject = "") {
  const explicit = cleanText(story.public_title || story.suggested_title || asArray(story.title_options)[0] || story.title);
  if (explicit && !titleLooksRaw(explicit) && !titleLooksGeneric(explicit)) return explicit;
  const base = compactSubject(subject) || "This Game";
  const text = `${story.title || ""} ${story.full_script || ""}`;
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
  if (/\b(?:patch|update|new pve mission|content update|last content)\b/i.test(text)) {
    return `${base} Just Got A Content Push`;
  }
  if (/\b(?:trailer|gameplay|footage|preview)\b/i.test(text)) {
    return `${base} Finally Shows Real Gameplay`;
  }
  if (/\b(?:release date|launch|coming|delayed|delay)\b/i.test(text)) {
    return `${base} Just Got A Date`;
  }
  if (/\b(?:teased|clue|hint|director|creator|producer|developer says|dev says)\b/i.test(text)) {
    return `${base} Just Dropped A New Clue`;
  }
  if (/\b(?:review|score|metacritic|opencritic)\b/i.test(text)) {
    return `${base} Reviews Just Sent A Signal`;
  }
  return `${base} Just Got A New Signal`;
}

function scriptLooksUnsafeForGoalProof(script = "") {
  return /\b(?:source-backed update|clean read|this gaming story|the useful question|the player angle is simple|before you spend|wait-and-see column|named source confirms)\b/i.test(
    cleanText(script),
  );
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
  const explicit = cleanText(story.thumbnail_text || story.suggested_thumbnail_text);
  if (explicit && explicit.split(/\s+/).length <= 5) return explicit;
  return compactSubject(subject).toUpperCase().split(/\s+/).slice(0, 3).join(" ");
}

function buildProofScript(story = {}, { subject, sourceName } = {}) {
  const claim = safeClaimForProof(story, subject);
  const source = sourceName || "The source";
  const combined = cleanText(`${story.title || ""} ${story.full_script || ""} ${claim}`);
  let impact = `${subject} now has a concrete detail players can argue with, instead of another floating headline.`;
  if (/\b(?:trailer|gameplay|footage|preview|demo)\b/i.test(combined)) {
    impact = `${subject} now has footage to judge: pace, readability and whether the moment-to-moment play has weight.`;
  } else if (/\b(?:price|cost|deal|sale|discount|subscription|pass)\b/i.test(combined)) {
    impact = `${subject} now has a value question attached, and that only works if the listing still matches the headline.`;
  } else if (/\b(?:review|score|metacritic|opencritic)\b/i.test(combined)) {
    impact = `${subject} now has pressure on the details behind the number: performance, structure and whether more outlets agree.`;
  } else if (/\b(?:date|launch|coming|delayed|delay)\b/i.test(combined)) {
    impact = `${subject} now has a clock on it, which makes the next platform, price or gameplay detail matter more.`;
  }
  return cleanText(
    `${subject} finally has something specific to judge. ` +
      `${source} says ${claim}. ` +
      `${impact} ` +
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
  const canonicalSubject = cleanText(
    normalised.canonical_subject ||
      normalised.canonical_game ||
      normalised.game_title ||
      normalised.primary_entity ||
      buildStoryManifest(normalised).canonical_subject,
  );
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
  const script =
    sourceBackedForProof(normalised) &&
    (!initialScript ||
      initialScriptScore.verdict === "rewrite_required" ||
      asArray(initialScriptScore.blockers).length ||
      scriptLooksUnsafeForGoalProof(initialScript) ||
      ADVERTISER_UNFRIENDLY_PUBLIC_RE.test(initialScript))
      ? buildProofScript(normalised, { subject: canonicalSubject, sourceName })
      : initialScript;
  const affiliateDisclosureRequired = Boolean(
    normalised.affiliate_url ||
      normalised.affiliate_link_manifest?.disclosure_required ||
      normalised.affiliate_link_manifest?.primary_link,
  );
  const affiliateDisclosure = affiliateDisclosureRequired
    ? "Affiliate links may earn us a commission."
    : normalised.affiliate_disclosure;
  const publicTitle = publicTitleForProof(normalised, canonicalSubject);
  const sourceDescription = cleanText(normalised.description || normalised.seo_description);
  const defaultDescription = safeClaimForProof(normalised, canonicalSubject);
  const descriptionWithSubject = sourceDescription && containsSubject(sourceDescription, canonicalSubject)
    ? sourceDescription
    : `${canonicalSubject}: ${sourceDescription || defaultDescription}`;
  const prepared = {
    ...normalised,
    canonical_subject: canonicalSubject,
    canonical_game: cleanText(normalised.canonical_game || normalised.game_title || canonicalSubject),
    primary_source: sourceName,
    source_name: sourceName,
    source_card_label: cleanText(normalised.source_card_label || sourceName),
    thumbnail_source_label: cleanText(normalised.thumbnail_source_label || sourceName),
    article_url: storyUrl(normalised),
    public_title: publicTitle,
    suggested_title: publicTitle,
    suggested_thumbnail_text: thumbnailTextForProof(normalised, canonicalSubject),
    full_script: script,
    tts_script: script,
    description: `${descriptionWithSubject} Source: ${sourceName}.`,
    pinned_comment: affiliateDisclosureRequired
      ? `${affiliateDisclosure} Source: ${sourceName}.`
      : cleanText(normalised.pinned_comment || `Source: ${sourceName}.`),
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
