"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "20_anti_spam_and_uniqueness_engine";

const REQUIRED_UNIQUENESS_CHECKS = [
  "repeated_title_structures",
  "repeated_thumbnails",
  "repeated_first_lines",
  "repeated_ctas",
  "reused_footage",
  "repeated_layouts",
  "repeated_transitions",
  "repeated_sfx",
  "repeated_affiliate_offers",
  "repeated_post_structures",
  "x_thread_uniqueness",
  "instagram_carousel_formats",
];

const HARD_CHECKS = new Set([
  "repeated_title_structures",
  "repeated_thumbnails",
  "repeated_first_lines",
  "reused_footage",
  "x_thread_uniqueness",
  "instagram_carousel_formats",
]);

const DUPLICATE_DEFERRABLE_CHECKS = new Set([
  "repeated_title_structures",
  "repeated_thumbnails",
  "repeated_first_lines",
  "reused_footage",
  "x_thread_uniqueness",
  "instagram_carousel_formats",
]);

const STRUCTURAL_TITLE_MARKERS = new Set([
  "adds",
  "added",
  "back",
  "becomes",
  "bigger",
  "broke",
  "calls",
  "changes",
  "crushed",
  "finally",
  "gets",
  "got",
  "hit",
  "just",
  "review",
  "reviews",
  "scores",
  "shows",
  "showed",
  "tops",
  "under",
  "weird",
]);

const STOP_WORDS = new Set(["a", "an", "and", "are", "for", "in", "is", "of", "on", "the", "to", "with"]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function objectText(value) {
  return cleanText(collectStrings(value).join(" "));
}

function normaliseText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return normaliseText(value).split(/\s+/).filter(Boolean);
}

function signature(values = []) {
  return unique(asArray(values).map(normaliseText)).filter(Boolean).sort().join("|");
}

function orderedSignature(values = []) {
  return asArray(values).map(normaliseText).filter(Boolean).join(">");
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function normaliseStatus(value) {
  return cleanText(value).toLowerCase();
}

function statusPasses(value) {
  return ["pass", "passed", "green", "ready", "clear", "ok"].includes(normaliseStatus(value));
}

function failuresFrom(...values) {
  const failures = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    failures.push(
      ...asArray(value.failures),
      ...asArray(value.blockers),
      ...asArray(value.publish_blockers),
      ...asArray(value.reason_codes),
      ...asArray(value.errors),
    );
  }
  return unique(failures);
}

function warningsFrom(...values) {
  const warnings = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    warnings.push(...asArray(value.warnings));
  }
  return unique(warnings);
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function firstSentence(value) {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text.split(/\n/)[0]);
}

function titleStructure(value) {
  const words = tokens(value);
  const markerIndex = words.findIndex((word) => STRUCTURAL_TITLE_MARKERS.has(word));
  if (markerIndex >= 0) return ["subject", ...words.slice(markerIndex)].join(" ");
  return [
    "unmarked",
    ...words
      .filter((word) => !STOP_WORDS.has(word))
      .map((word) => (/^\d+$/.test(word) ? "num" : word)),
  ].join(" ");
}

function thumbnailStructure(value) {
  const words = tokens(value).filter((word) => !STOP_WORDS.has(word));
  const markerIndex = words.findIndex((word) => STRUCTURAL_TITLE_MARKERS.has(word));
  if (markerIndex >= 0) return ["subject", ...words.slice(markerIndex)].join(" ");
  return words.join(" ");
}

function textShape(value) {
  return tokens(value)
    .map((word) => {
      if (/^#/.test(word)) return "hashtag";
      if (/^\d+$/.test(word)) return "num";
      if (STOP_WORDS.has(word) || STRUCTURAL_TITLE_MARKERS.has(word)) return word;
      return "x";
    })
    .join(" ");
}

function valuesByPath(value, keys = []) {
  const found = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (keys.includes(key)) found.push(child);
      visit(child);
    }
  }
  visit(value);
  return found;
}

function footageFamilies(footage = {}, directorPlan = {}) {
  const families = [];
  for (const asset of asArray(footage.assets || footage.visual_deck || footage.items)) {
    families.push(asset.source_family, asset.asset_id, asset.duplicate_hash, asset.source_url);
  }
  for (const clip of asArray(footage.materialised_motion_clips || footage.motion_clips || directorPlan.shot_plan)) {
    families.push(clip.source_family, clip.motion_pack_clip_id, clip.asset_id, clip.media_path);
  }
  return unique(families.map(normaliseText)).filter(Boolean);
}

function sfxFamilies(sfxManifest = {}, directorPlan = {}) {
  const selectedAssets = [
    ...asArray(sfxManifest.selected_assets),
    ...asArray(sfxManifest.source_plan?.selected_assets),
    ...asArray(sfxManifest.sourcePlan?.selectedAssets),
  ];
  const selectedSignature = unique(
    selectedAssets
      .map((asset) => {
        const role = cleanText(asset.role || asset.sfx_role || asset.family || asset.category);
        const id = cleanText(asset.asset_id || asset.id || asset.source_url || asset.path || asset.file_path);
        return role && id ? `${role}:${id}` : id;
      })
      .map(normaliseText),
  ).filter(Boolean);
  if (selectedSignature.length) return selectedSignature;

  const cues = [
    ...asArray(sfxManifest.cues),
    ...asArray(sfxManifest.sfx_cues),
    ...asArray(directorPlan.sound_transition_plan?.sfx?.cues),
  ];
  return unique(cues.map((cue) => normaliseText(cue.family || cue.source_family || cue.id || cue.path))).filter(Boolean);
}

function transitionSignature(directorPlan = {}) {
  const transitions = [
    ...asArray(directorPlan.transition_plan?.transitions),
    ...asArray(directorPlan.transitions),
    ...valuesByPath(directorPlan, ["transition", "transition_type"]),
  ];
  return signature(transitions.map((item) => (typeof item === "string" ? item : item?.type || item?.id || objectText(item))));
}

function shotLayoutSignature(directorPlan = {}) {
  if (cleanText(directorPlan.format_signature)) return normaliseText(directorPlan.format_signature);
  const shots = [
    ...asArray(directorPlan.shot_plan),
    ...asArray(directorPlan.timeline_plan?.beats),
    ...asArray(directorPlan.beats),
  ];
  if (shots.length) {
    return orderedSignature(shots.map((shot) => {
      if (typeof shot === "string") return shot;
      return [
        shot.kind || shot.shot_type || shot.type,
        shot.label || shot.overlay_text || shot.headline || shot.retention_purpose,
      ].map(cleanText).filter(Boolean).join(":");
    }));
  }
  return normaliseText(directorPlan.layout_template || directorPlan.layout || directorPlan.execution_mode);
}

function carouselCardToken(card) {
  if (typeof card === "string") return card;
  return cleanText(card?.format_role || card?.role || card?.type || card?.label || objectText(card));
}

function carouselSignature(outputs = {}, socialDerivative = {}) {
  const carouselPlan = socialDerivative.carousel_plan || socialDerivative.carousel || {};
  const instagramDerivative = socialDerivative.instagram_derivative || socialDerivative.instagram || {};
  if (cleanText(carouselPlan.format_signature)) return normaliseText(carouselPlan.format_signature);
  if (cleanText(instagramDerivative.carousel_companion?.format_signature)) {
    return normaliseText(instagramDerivative.carousel_companion.format_signature);
  }
  const governedCards = [
    ...asArray(carouselPlan.cards),
    ...asArray(instagramDerivative.carousel_companion?.cards),
  ];
  if (governedCards.length) return orderedSignature(governedCards.map(carouselCardToken));
  const cards = outputs.instagram_reels?.carousel_companion?.cards || outputs.instagram_reels?.carousel_cards || [];
  return orderedSignature(asArray(cards).map(carouselCardToken));
}

function affiliateOfferSignature(affiliate = {}) {
  const offers = [affiliate.primary_link, ...asArray(affiliate.fallback_links), ...asArray(affiliate.offers)];
  return signature(offers.map((offer) => objectText([offer?.label, offer?.merchant, offer?.programme_id, offer?.category])));
}

function postStructureSignature(platformManifest = {}) {
  const outputs = platformOutputs(platformManifest);
  const evidence = platformManifest.platform_native_evidence || {};
  if (evidence.format_signature) return normaliseText(evidence.format_signature);
  return signature(Object.entries(outputs).map(([platform, output]) => {
    const keys = Object.keys(output || {}).filter((key) => /caption|cta|title|link|thread|carousel|cover|hashtag/i.test(key)).sort();
    return `${platform}:${keys.join(",")}`;
  }));
}

function isSourceOnlyLine(value = "") {
  return /^source\s*:\s*[^.?!]+\.?$/i.test(cleanText(value));
}

function ctaText(canonical = {}, outputs = {}) {
  const candidates = [
    outputs.youtube_shorts?.profile_or_landing_page_cta,
    outputs.instagram_reels?.bio_link_cta,
    outputs.x?.landing_page_link,
    outputs.threads?.landing_page_link,
    outputs.pinterest?.landing_page_link,
    canonical.pinned_comment,
    outputs.youtube_shorts?.cta,
    outputs.tiktok?.cta,
    outputs.instagram_reels?.cta,
    outputs.facebook_reels?.cta,
    outputs.x?.cta,
  ].map(cleanText).filter(Boolean);
  return candidates.find((candidate) => !isSourceOnlyLine(candidate)) || candidates[0] || "";
}

function collectStorySignals({
  storyId,
  storyPackage = {},
  canonical = {},
  platformManifest = {},
  footage = {},
  directorPlan = {},
  sfxManifest = {},
  affiliate = {},
  existingUniqueness = {},
  socialDerivative = {},
} = {}) {
  const outputs = platformOutputs(platformManifest);
  const xDerivative = socialDerivative.x_derivative || socialDerivative.x || {};
  const threadsDerivative = socialDerivative.threads_derivative || socialDerivative.threads || {};
  const title = cleanText(
    outputs.youtube_shorts?.title ||
      canonical.selected_title ||
      canonical.canonical_title ||
      canonical.title ||
      storyPackage.title,
  );
  const thumbnail = cleanText(
    canonical.thumbnail_headline ||
      canonical.thumbnail_text ||
      outputs.youtube_shorts?.cover_frame?.headline ||
      outputs.instagram_reels?.cover_frame?.headline,
  );
  const firstLine = firstSentence(
    canonical.narration_script ||
      canonical.full_script ||
      outputs.tiktok?.conversational_hook ||
      outputs.youtube_shorts?.description ||
      outputs.tiktok?.caption,
  );
  const xPost = cleanText(
    xDerivative.hot_take_post ||
      xDerivative.source_safe_post ||
      xDerivative.concise_news_post ||
      outputs.x?.hot_take_post ||
      outputs.x?.source_safe_post ||
      outputs.x?.post ||
      outputs.x?.text,
  );
  const threadsPost = cleanText(
    threadsDerivative.discussion_post ||
      threadsDerivative.post ||
      threadsDerivative.text ||
      outputs.threads?.discussion_post ||
      outputs.threads?.post ||
      outputs.threads?.text,
  );
  const families = footageFamilies(footage, directorPlan);
  return {
    story_id: storyId,
    title,
    title_structure: titleStructure(title),
    thumbnail,
    thumbnail_structure: thumbnailStructure(thumbnail),
    first_line: firstLine,
    first_line_signature: normaliseText(firstLine),
    cta: ctaText(canonical, outputs),
    cta_signature: normaliseText(ctaText(canonical, outputs)),
    footage_families: families,
    layout_signature: shotLayoutSignature(directorPlan) || normaliseText(platformManifest.visual_template),
    transition_signature: transitionSignature(directorPlan),
    sfx_signature: signature(sfxFamilies(sfxManifest, directorPlan)),
    affiliate_offer_signature: affiliateOfferSignature(affiliate),
    post_structure_signature: postStructureSignature(platformManifest),
    x_post: xPost,
    x_signature: normaliseText(xPost),
    threads_post: threadsPost,
    threads_signature: normaliseText(threadsPost),
    duplicate_x_wording_allowed: threadsDerivative.duplicate_x_wording_allowed === true || outputs.threads?.duplicate_x_wording_allowed === true,
    instagram_carousel_signature: carouselSignature(outputs, socialDerivative),
    existing_uniqueness_verdict: existingUniqueness.verdict || existingUniqueness.status || null,
    existing_uniqueness_failures: failuresFrom(existingUniqueness),
    existing_uniqueness_warnings: warningsFrom(existingUniqueness),
  };
}

function addToMap(map, key, storyId) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(storyId);
}

function batchIndex(stories = []) {
  const index = {
    title_structure: new Map(),
    thumbnail_structure: new Map(),
    first_line_signature: new Map(),
    cta_signature: new Map(),
    footage_family: new Map(),
    layout_signature: new Map(),
    transition_signature: new Map(),
    sfx_signature: new Map(),
    affiliate_offer_signature: new Map(),
    post_structure_signature: new Map(),
    x_signature: new Map(),
    instagram_carousel_signature: new Map(),
  };
  for (const story of asArray(stories)) {
    addToMap(index.title_structure, story.signals.title_structure, story.story_id);
    addToMap(index.thumbnail_structure, story.signals.thumbnail_structure, story.story_id);
    addToMap(index.first_line_signature, story.signals.first_line_signature, story.story_id);
    addToMap(index.cta_signature, story.signals.cta_signature, story.story_id);
    for (const family of story.signals.footage_families) addToMap(index.footage_family, family, story.story_id);
    addToMap(index.layout_signature, story.signals.layout_signature, story.story_id);
    addToMap(index.transition_signature, story.signals.transition_signature, story.story_id);
    addToMap(index.sfx_signature, story.signals.sfx_signature, story.story_id);
    addToMap(index.affiliate_offer_signature, story.signals.affiliate_offer_signature, story.story_id);
    addToMap(index.post_structure_signature, story.signals.post_structure_signature, story.story_id);
    addToMap(index.x_signature, story.signals.x_signature, story.story_id);
    addToMap(index.instagram_carousel_signature, story.signals.instagram_carousel_signature, story.story_id);
  }
  return index;
}

function duplicatesFor(map, key, storyId) {
  if (!key || !map.has(key)) return [];
  return unique(map.get(key)).filter((id) => id !== storyId);
}

function sharedFootageMatches(index, signals = {}) {
  const matches = [];
  for (const family of signals.footage_families) {
    for (const storyId of duplicatesFor(index.footage_family, family, signals.story_id)) {
      matches.push({ story_id: storyId, family });
    }
  }
  return matches;
}

function buildCheck({ status, blocker = null, warning = null, matches = [], evidence = {} } = {}) {
  const blockers = status === "fail" && blocker ? [blocker] : [];
  const warnings = status === "warn" && warning ? [warning] : [];
  return {
    status,
    blockers,
    warnings,
    matches,
    evidence,
  };
}

function buildStoryChecks(story = {}, index = {}) {
  const signals = story.signals;
  const titleMatches = duplicatesFor(index.title_structure, signals.title_structure, story.story_id);
  const thumbnailMatches = duplicatesFor(index.thumbnail_structure, signals.thumbnail_structure, story.story_id);
  const firstLineMatches = duplicatesFor(index.first_line_signature, signals.first_line_signature, story.story_id);
  const ctaMatches = duplicatesFor(index.cta_signature, signals.cta_signature, story.story_id);
  const footageMatches = sharedFootageMatches(index, signals);
  const layoutMatches = duplicatesFor(index.layout_signature, signals.layout_signature, story.story_id);
  const transitionMatches = duplicatesFor(index.transition_signature, signals.transition_signature, story.story_id);
  const sfxMatches = duplicatesFor(index.sfx_signature, signals.sfx_signature, story.story_id);
  const affiliateMatches = duplicatesFor(index.affiliate_offer_signature, signals.affiliate_offer_signature, story.story_id);
  const postStructureMatches = duplicatesFor(index.post_structure_signature, signals.post_structure_signature, story.story_id);
  const xMatches = duplicatesFor(index.x_signature, signals.x_signature, story.story_id);
  const carouselMatches = duplicatesFor(index.instagram_carousel_signature, signals.instagram_carousel_signature, story.story_id);
  const xThreadsDuplicate =
    signals.x_signature &&
    signals.threads_signature &&
    signals.x_signature === signals.threads_signature &&
    !signals.duplicate_x_wording_allowed;
  const existingFailure = signals.existing_uniqueness_failures.length > 0 ||
    ["fail", "failed", "red", "blocked"].includes(normaliseStatus(signals.existing_uniqueness_verdict));
  const existingWarning = signals.existing_uniqueness_warnings.length > 0 ||
    ["warn", "warning", "amber", "review"].includes(normaliseStatus(signals.existing_uniqueness_verdict));

  const checks = {
    repeated_title_structures: buildCheck({
      status: titleMatches.length ? "fail" : "pass",
      blocker: "anti_spam:repeated_title_structure",
      matches: titleMatches.map((id) => ({ story_id: id, signature: signals.title_structure })),
      evidence: { title: signals.title, title_structure: signals.title_structure },
    }),
    repeated_thumbnails: buildCheck({
      status: thumbnailMatches.length ? "fail" : "pass",
      blocker: "anti_spam:repeated_thumbnail_structure",
      matches: thumbnailMatches.map((id) => ({ story_id: id, signature: signals.thumbnail_structure })),
      evidence: { thumbnail: signals.thumbnail, thumbnail_structure: signals.thumbnail_structure },
    }),
    repeated_first_lines: buildCheck({
      status: firstLineMatches.length ? "fail" : "pass",
      blocker: "anti_spam:repeated_first_line",
      matches: firstLineMatches.map((id) => ({ story_id: id, first_line: signals.first_line })),
      evidence: { first_line: signals.first_line },
    }),
    repeated_ctas: buildCheck({
      status: ctaMatches.length ? "warn" : "pass",
      warning: "anti_spam:cta_reused",
      matches: ctaMatches.map((id) => ({ story_id: id, cta: signals.cta })),
      evidence: { cta: signals.cta },
    }),
    reused_footage: buildCheck({
      status: footageMatches.length ? "fail" : "pass",
      blocker: "anti_spam:reused_footage_family",
      matches: footageMatches,
      evidence: { footage_families: signals.footage_families },
    }),
    repeated_layouts: buildCheck({
      status: layoutMatches.length ? "warn" : "pass",
      warning: "anti_spam:layout_reused",
      matches: layoutMatches.map((id) => ({ story_id: id, signature: signals.layout_signature })),
      evidence: { layout_signature: signals.layout_signature },
    }),
    repeated_transitions: buildCheck({
      status: transitionMatches.length ? "warn" : "pass",
      warning: "anti_spam:transition_pattern_reused",
      matches: transitionMatches.map((id) => ({ story_id: id, signature: signals.transition_signature })),
      evidence: { transition_signature: signals.transition_signature },
    }),
    repeated_sfx: buildCheck({
      status: sfxMatches.length ? "warn" : "pass",
      warning: "anti_spam:sfx_pattern_reused",
      matches: sfxMatches.map((id) => ({ story_id: id, signature: signals.sfx_signature })),
      evidence: { sfx_signature: signals.sfx_signature },
    }),
    repeated_affiliate_offers: buildCheck({
      status: affiliateMatches.length ? "warn" : "pass",
      warning: "anti_spam:affiliate_offer_reused",
      matches: affiliateMatches.map((id) => ({ story_id: id, signature: signals.affiliate_offer_signature })),
      evidence: { affiliate_offer_signature: signals.affiliate_offer_signature },
    }),
    repeated_post_structures: buildCheck({
      status: postStructureMatches.length ? "warn" : "pass",
      warning: "anti_spam:post_structure_reused",
      matches: postStructureMatches.map((id) => ({ story_id: id, signature: signals.post_structure_signature })),
      evidence: { post_structure_signature: signals.post_structure_signature },
    }),
    x_thread_uniqueness: buildCheck({
      status: xThreadsDuplicate || xMatches.length ? "fail" : "pass",
      blocker: xThreadsDuplicate ? "anti_spam:duplicate_x_thread_copy" : "anti_spam:repeated_x_post",
      matches: [
        ...(xThreadsDuplicate ? [{ story_id: story.story_id, scope: "same_story_x_threads" }] : []),
        ...xMatches.map((id) => ({ story_id: id, signature: signals.x_signature })),
      ],
      evidence: { x_post: signals.x_post, threads_post: signals.threads_post },
    }),
    instagram_carousel_formats: buildCheck({
      status: carouselMatches.length ? "fail" : "pass",
      blocker: "anti_spam:repeated_instagram_carousel_format",
      matches: carouselMatches.map((id) => ({ story_id: id, signature: signals.instagram_carousel_signature })),
      evidence: { instagram_carousel_signature: signals.instagram_carousel_signature },
    }),
  };

  if (existingFailure) {
    checks.existing_uniqueness_gate = buildCheck({
      status: "fail",
      blocker: "anti_spam:existing_uniqueness_gate_failed",
      matches: [],
      evidence: {
        verdict: signals.existing_uniqueness_verdict,
        failures: signals.existing_uniqueness_failures,
      },
    });
  } else if (existingWarning) {
    checks.existing_uniqueness_gate = buildCheck({
      status: "warn",
      warning: "anti_spam:existing_uniqueness_gate_warning",
      matches: [],
      evidence: {
        verdict: signals.existing_uniqueness_verdict,
        warnings: signals.existing_uniqueness_warnings,
      },
    });
  }
  return checks;
}

function riskScoreFor(checks = {}) {
  const weights = {
    repeated_title_structures: 25,
    repeated_thumbnails: 12,
    repeated_first_lines: 18,
    repeated_ctas: 8,
    reused_footage: 20,
    repeated_layouts: 6,
    repeated_transitions: 5,
    repeated_sfx: 5,
    repeated_affiliate_offers: 8,
    repeated_post_structures: 5,
    x_thread_uniqueness: 15,
    instagram_carousel_formats: 10,
    existing_uniqueness_gate: 20,
  };
  let score = 0;
  for (const [name, check] of Object.entries(checks)) {
    if (check.status === "fail") score += weights[name] || 10;
    else if (check.status === "warn") score += Math.ceil((weights[name] || 6) / 2);
  }
  return Math.min(100, score);
}

function recommendationFor(code) {
  if (code.includes("title_structure")) return "Rewrite the public title around a different verb pattern and story consequence.";
  if (code.includes("thumbnail")) return "Change thumbnail wording and hierarchy so it does not repeat the same headline shape.";
  if (code.includes("first_line")) return "Open with a different first spoken sentence and avoid generic setup.";
  if (code.includes("footage")) return "Swap in distinct source families or document why shared footage is necessary.";
  if (code.includes("x_thread")) return "Rewrite X and Threads as separate native posts.";
  if (code.includes("carousel")) return "Change the Instagram carousel card order and card roles.";
  if (code.includes("cta")) return "Rotate the CTA while keeping it short and platform-native.";
  if (code.includes("layout")) return "Use a different layout treatment or beat order.";
  if (code.includes("transition")) return "Change transition rhythm and avoid repeating the same motion language.";
  if (code.includes("sfx")) return "Use a different SFX cue family or spacing.";
  if (code.includes("affiliate_offer")) return "Rotate related product offers or route to a source-first page.";
  if (code.includes("post_structure")) return "Vary platform post shape, hashtags and link placement.";
  return "Repair the repeated pattern and rerun Goal 20.";
}

function buildGoal19Index(upstreamControlTowerReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamControlTowerReport.stories || upstreamControlTowerReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamSkippedInfo(storyId, controlIndex = new Map()) {
  const row = controlIndex.get(cleanText(storyId));
  if (!row) return null;
  const status = normaliseStatus(row.status || row.verdict || row.final_verdict);
  if (status !== "skipped") return null;
  return {
    status: cleanText(row.skipped_status || row.status || "skipped"),
    reason: cleanText(row.skipped_reason || row.reason || "upstream skipped before Goal 20"),
  };
}

function upstreamBlockers(storyId, controlIndex = new Map()) {
  const row = controlIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal19_autonomy_control_tower_missing"];
  const status = normaliseStatus(row.verdict || row.final_verdict || row.status);
  if (["ready", "pass", "passed", "green"].includes(status) && !asArray(row.blockers).length) return [];
  return unique(["upstream:goal19_autonomy_control_tower_blocked", ...asArray(row.blockers)]);
}

function addSocialDerivativeRow(index, row = {}, field) {
  const storyId = cleanText(row.story_id || row.id);
  if (!storyId) return;
  if (!index.has(storyId)) index.set(storyId, {});
  index.get(storyId)[field] = row;
}

function buildSocialDerivativeIndex(upstreamSocialDerivativesReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamSocialDerivativesReport.carousel_manifest?.stories)) {
    addSocialDerivativeRow(index, row, "carousel_plan");
  }
  for (const row of asArray(upstreamSocialDerivativesReport.x_publish_pack?.stories)) {
    addSocialDerivativeRow(index, row, "x_derivative");
  }
  for (const row of asArray(upstreamSocialDerivativesReport.instagram_publish_pack?.stories)) {
    addSocialDerivativeRow(index, row, "instagram_derivative");
  }
  for (const row of asArray(upstreamSocialDerivativesReport.threads_publish_pack?.stories)) {
    addSocialDerivativeRow(index, row, "threads_derivative");
  }
  for (const row of asArray(upstreamSocialDerivativesReport.stories)) {
    const storyId = cleanText(row.story_id || row.id);
    if (!storyId) continue;
    if (!index.has(storyId)) index.set(storyId, {});
    const existing = index.get(storyId);
    if (row.x_derivative) existing.x_derivative = row.x_derivative;
    if (row.carousel_plan) existing.carousel_plan = row.carousel_plan;
    if (row.instagram_derivative) existing.instagram_derivative = row.instagram_derivative;
    if (row.threads_derivative) existing.threads_derivative = row.threads_derivative;
  }
  return index;
}

async function loadStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const skipped = upstreamSkippedInfo(storyId, context.controlIndex);
  if (skipped) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir,
      title: cleanText(storyPackage.title),
      status: "skipped",
      direct_uniqueness_status: "skipped",
      upstream_status: "skipped",
      skipped_status: skipped.status,
      skipped_reason: skipped.reason,
      blockers: [],
      upstream_blockers: [],
      direct_uniqueness_blockers: [],
      warnings: [],
      uniqueness_checks: {},
      repetition_risk: {
        story_id: storyId,
        risk_score: 0,
        risk_level: "skipped",
        blockers: [],
        warnings: [],
      },
      matches: [],
      signals: {},
      source_material: {
        canonical_story_manifest_present: false,
        platform_publish_manifest_present: false,
        footage_inventory_present: false,
        director_plan_present: false,
        sfx_manifest_present: false,
        affiliate_manifest_present: false,
        existing_uniqueness_report_present: false,
      },
      safety: {
        local_proof_only: true,
        dry_run_publish_only: true,
        no_publish_triggered: true,
        no_external_posting: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_secret_values_exposed: true,
      },
    };
  }
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const footage = await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {});
  const directorPlan = await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {});
  const sfxManifest = await readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {});
  const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const existingUniqueness = await readJsonIfPresent(path.join(artifactDir, "uniqueness_report.json"), {});
  const socialDerivative = context.socialDerivativeIndex?.get(storyId) || {};
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: cleanText(canonical.selected_title || canonical.canonical_title || storyPackage.title),
    signals: collectStorySignals({
      storyId,
      storyPackage,
      canonical,
      platformManifest,
      footage,
      directorPlan,
      sfxManifest,
      affiliate,
      existingUniqueness,
      socialDerivative,
    }),
    source_material: {
      canonical_story_manifest_present: hasObject(canonical),
      platform_publish_manifest_present: hasObject(platformManifest),
      footage_inventory_present: hasObject(footage),
      director_plan_present: hasObject(directorPlan),
      sfx_manifest_present: hasObject(sfxManifest),
      affiliate_manifest_present: hasObject(affiliate),
      existing_uniqueness_report_present: hasObject(existingUniqueness),
    },
  };
}

function finaliseStory(story = {}, index = {}, controlIndex = new Map()) {
  if (story.status === "skipped") return story;
  const checks = buildStoryChecks(story, index);
  const directBlockers = unique(Object.values(checks).flatMap((check) => asArray(check.blockers)));
  const warnings = unique(Object.values(checks).flatMap((check) => asArray(check.warnings)));
  const upstream = upstreamBlockers(story.story_id, controlIndex);
  const riskScore = riskScoreFor(checks);
  const directStatus = directBlockers.length ? "blocked" : warnings.length ? "review" : "pass";
  const blockers = unique([...upstream, ...directBlockers]);
  const status = blockers.length ? "blocked" : directStatus === "review" ? "review" : "ready";
  return {
    ...story,
    status,
    direct_uniqueness_status: directStatus,
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_uniqueness_blockers: directBlockers,
    warnings,
    uniqueness_checks: checks,
    repetition_risk: {
      story_id: story.story_id,
      risk_score: riskScore,
      risk_level: riskScore >= 70 ? "high" : riskScore >= 25 ? "medium" : riskScore > 0 ? "low" : "clear",
      blockers: directBlockers,
      warnings,
    },
    matches: Object.entries(checks)
      .flatMap(([check, row]) => asArray(row.matches).map((match) => ({ check, ...match }))),
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function duplicateDeferredIds(stories = []) {
  const order = new Map();
  asArray(stories).forEach((story, index) => {
    order.set(story.story_id, index);
  });
  const deferred = new Set();
  for (const story of asArray(stories)) {
    if (story.status === "skipped") continue;
    for (const [checkName, check] of Object.entries(story.uniqueness_checks || {})) {
      if (!DUPLICATE_DEFERRABLE_CHECKS.has(checkName) || check.status !== "fail") continue;
      for (const match of asArray(check.matches)) {
        const matchedId = cleanText(match.story_id);
        if (!matchedId || matchedId === story.story_id || !order.has(matchedId)) continue;
        const storyOrder = order.get(story.story_id);
        const matchOrder = order.get(matchedId);
        deferred.add(storyOrder > matchOrder ? story.story_id : matchedId);
      }
    }
  }
  return deferred;
}

function duplicateDeferredStory(story = {}, firstPassStory = {}) {
  return {
    ...story,
    status: "skipped",
    direct_uniqueness_status: "skipped",
    upstream_status: "skipped",
    skipped_status: "anti_spam_duplicate_deferred",
    skipped_reason: "deferred_by_goal20_duplicate_cluster",
    duplicate_deferred: true,
    deferred_blockers: asArray(firstPassStory.direct_uniqueness_blockers),
    deferred_warnings: asArray(firstPassStory.warnings),
    deferred_matches: asArray(firstPassStory.matches),
    blockers: [],
    upstream_blockers: [],
    direct_uniqueness_blockers: [],
    warnings: [],
    uniqueness_checks: firstPassStory.uniqueness_checks || {},
    repetition_risk: {
      story_id: story.story_id,
      risk_score: 0,
      risk_level: "skipped",
      blockers: [],
      warnings: [],
    },
    matches: [],
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_uniqueness_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
    for (const warning of asArray(story.warnings)) counts[warning] = (counts[warning] || 0) + 1;
  }
  return counts;
}

function buildSignatureCounts(stories = []) {
  const counts = {};
  for (const key of [
    "title_structure",
    "thumbnail_structure",
    "first_line_signature",
    "cta_signature",
    "layout_signature",
    "transition_signature",
    "sfx_signature",
    "affiliate_offer_signature",
    "post_structure_signature",
    "instagram_carousel_signature",
  ]) {
    counts[key] = {};
    for (const story of asArray(stories)) {
      const value = story.signals?.[key];
      if (value) counts[key][value] = (counts[key][value] || 0) + 1;
    }
  }
  return counts;
}

function buildUniquenessReport(report = {}) {
  const activeStories = asArray(report.stories).filter((story) => story.status !== "skipped");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    verdict: report.direct_uniqueness_verdict || "UNKNOWN",
    required_checks: REQUIRED_UNIQUENESS_CHECKS,
    stories: activeStories.map((story) => ({
      story_id: story.story_id,
      verdict: story.direct_uniqueness_status === "blocked" ? "fail" : story.direct_uniqueness_status === "review" ? "warn" : "pass",
      failures: story.direct_uniqueness_blockers,
      warnings: story.warnings,
      matches: story.matches,
      checks: story.uniqueness_checks,
    })),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
    },
  };
}

function buildRepetitionRiskScore(report = {}) {
  const activeStories = asArray(report.stories).filter((story) => story.status !== "skipped");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    batch_signature_counts: buildSignatureCounts(activeStories),
    stories: activeStories.map((story) => story.repetition_risk),
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
    },
  };
}

function buildVariationRecommendations(report = {}) {
  const activeStories = asArray(report.stories).filter((story) => story.status !== "skipped");
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: activeStories.map((story) => {
      const codes = unique([...story.direct_uniqueness_blockers, ...story.warnings]);
      return {
        story_id: story.story_id,
        status: story.direct_uniqueness_blockers.length
          ? "blocked_until_variation_repair"
          : story.warnings.length
            ? "variation_recommended"
            : "no_variation_required",
        risk_score: story.repetition_risk.risk_score,
        recommendations: codes.map((code) => ({
          code,
          action: recommendationFor(code),
        })),
        upstream_blocked: story.upstream_blockers.length > 0,
      };
    }),
    safety: {
      no_public_copy_mutation: true,
      no_publish_triggered: true,
    },
  };
}

async function buildGoal20AntiSpamUniquenessEngine({
  storyPackages = [],
  upstreamControlTowerReport = {},
  upstreamSocialDerivativesReport = {},
  deferDuplicateCandidates = false,
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal20AntiSpamUniquenessEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const controlIndex = buildGoal19Index(upstreamControlTowerReport);
  const socialDerivativeIndex = buildSocialDerivativeIndex(upstreamSocialDerivativesReport);
  const loadedStories = [];
  for (const storyPackage of asArray(storyPackages)) {
    loadedStories.push(await loadStoryPackage(storyPackage, { workspaceRoot, controlIndex, socialDerivativeIndex }));
  }
  const activeLoadedStories = loadedStories.filter((story) => story.status !== "skipped");
  const index = batchIndex(activeLoadedStories);
  let stories = loadedStories.map((story) => finaliseStory(story, index, controlIndex));
  const duplicateDeferred = deferDuplicateCandidates ? duplicateDeferredIds(stories) : new Set();
  if (duplicateDeferred.size) {
    const firstPassById = new Map(stories.map((story) => [story.story_id, story]));
    const activeAfterDeferral = loadedStories
      .filter((story) => story.status !== "skipped" && !duplicateDeferred.has(story.story_id));
    const deferralIndex = batchIndex(activeAfterDeferral);
    stories = loadedStories.map((story) => {
      if (story.status === "skipped") return story;
      if (duplicateDeferred.has(story.story_id)) return duplicateDeferredStory(story, firstPassById.get(story.story_id));
      return finaliseStory(story, deferralIndex, controlIndex);
    });
  }
  const activeStories = stories.filter((story) => story.status !== "skipped");
  const skippedStories = stories.filter((story) => story.status === "skipped");
  const duplicateDeferredStories = skippedStories.filter((story) => story.duplicate_deferred);
  const readyStories = activeStories.filter((story) => story.status === "ready");
  const reviewStories = activeStories.filter((story) => story.status === "review");
  const blockedStories = activeStories.filter((story) => story.status === "blocked");
  const directPassStories = activeStories.filter((story) => story.direct_uniqueness_status === "pass");
  const directReviewStories = activeStories.filter((story) => story.direct_uniqueness_status === "review");
  const directBlockedStories = activeStories.filter((story) => story.direct_uniqueness_status === "blocked");
  const upstreamBlockedStories = activeStories.filter((story) => story.upstream_status === "blocked");
  const verdict = !activeStories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length + reviewStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : reviewStories.length
          ? "PARTIAL"
          : "PASS";
  const directUniquenessVerdict = !activeStories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length + directReviewStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : directReviewStories.length
          ? "PARTIAL"
          : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_uniqueness_verdict: directUniquenessVerdict,
    summary: {
      story_count: stories.length,
      active_story_count: activeStories.length,
      skipped_story_count: skippedStories.length,
      duplicate_deferred_story_count: duplicateDeferredStories.length,
      uniqueness_ready_story_count: readyStories.length,
      review_story_count: reviewStories.length,
      blocked_story_count: blockedStories.length,
      direct_uniqueness_pass_story_count: directPassStories.length,
      direct_uniqueness_review_story_count: directReviewStories.length,
      direct_uniqueness_blocked_story_count: directBlockedStories.length,
      upstream_blocked_story_count: upstreamBlockedStories.length,
      publish_now_count: 0,
    },
    required_uniqueness_checks: REQUIRED_UNIQUENESS_CHECKS,
    blocker_counts: blockerCounts(activeStories),
    direct_risk_counts: directRiskCounts(activeStories),
    upstream_blockers: {
      goal19_autonomy_control_tower:
        "Goal 20 can inspect repetition locally, but readiness requires Goal 19 and earlier campaign gates to be ready first.",
      goal14_social_derivatives_engine:
        "When present, governed Goal 14 social derivative artefacts are used for carousel and platform derivative uniqueness before stale per-story companions.",
      note:
        "This gate emits LOCAL_PROOF only. It does not publish, post externally, mutate production rows, inspect secrets or change OAuth/token state.",
    },
    stories,
    duplicate_deferred_stories: duplicateDeferredStories.map((story) => ({
      story_id: story.story_id,
      title: story.title,
      skipped_status: story.skipped_status,
      skipped_reason: story.skipped_reason,
      deferred_blockers: story.deferred_blockers,
      deferred_matches: story.deferred_matches,
    })),
    safety: {
      local_proof_only: true,
      dry_run_publish_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.uniqueness_report = buildUniquenessReport(report);
  report.repetition_risk_score = buildRepetitionRiskScore(report);
  report.variation_recommendations = buildVariationRecommendations(report);
  return report;
}

function renderGoal20AntiSpamUniquenessMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 20 Anti-Spam and Uniqueness Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct uniqueness verdict: ${report.direct_uniqueness_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Active stories: ${report.summary?.active_story_count || 0}`);
  lines.push(`Skipped stories: ${report.summary?.skipped_story_count || 0}`);
  lines.push(`Duplicate-deferred stories: ${report.summary?.duplicate_deferred_story_count || 0}`);
  lines.push(`Ready stories: ${report.summary?.uniqueness_ready_story_count || 0}`);
  lines.push(`Review stories: ${report.summary?.review_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Direct pass stories: ${report.summary?.direct_uniqueness_pass_story_count || 0}`);
  lines.push(`Direct review stories: ${report.summary?.direct_uniqueness_review_story_count || 0}`);
  lines.push(`Direct blocked stories: ${report.summary?.direct_uniqueness_blocked_story_count || 0}`);
  lines.push(`Upstream-blocked stories: ${report.summary?.upstream_blocked_story_count || 0}`);
  lines.push(`Publish-now actions: ${report.summary?.publish_now_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct repetition risks");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF and DRY_RUN_PUBLISH only. This run did not publish, post externally, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal20AntiSpamUniquenessEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal20AntiSpamUniquenessEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal20_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal20_readiness_report.md");
  const uniquenessReport = path.join(outDir, "uniqueness_report.json");
  const repetitionRiskScore = path.join(outDir, "repetition_risk_score.json");
  const variationRecommendations = path.join(outDir, "variation_recommendations.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal20AntiSpamUniquenessMarkdown(report), "utf8");
  await fs.writeJson(uniquenessReport, report.uniqueness_report || buildUniquenessReport(report), { spaces: 2 });
  await fs.writeJson(repetitionRiskScore, report.repetition_risk_score || buildRepetitionRiskScore(report), { spaces: 2 });
  await fs.writeJson(variationRecommendations, report.variation_recommendations || buildVariationRecommendations(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    uniquenessReport,
    repetitionRiskScore,
    variationRecommendations,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_UNIQUENESS_CHECKS,
  buildGoal20AntiSpamUniquenessEngine,
  buildRepetitionRiskScore,
  buildUniquenessReport,
  buildVariationRecommendations,
  renderGoal20AntiSpamUniquenessMarkdown,
  writeGoal20AntiSpamUniquenessEngine,
};
