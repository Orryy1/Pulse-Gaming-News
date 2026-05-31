"use strict";

const {
  loadGoldStandardReferenceLibrary,
  REQUIRED_REFERENCE_PACKS,
} = require("./gold-standard-reference-library");
const { buildStoryManifest } = require("./public-output-manifest");
const { visualEvidenceProfile } = require("./visual-evidence-classifier");

const SCORE_KEYS = [
  "motion_density_score",
  "first_3_seconds_hook_score",
  "source_lock_quality_score",
  "caption_legibility_score",
  "card_hierarchy_score",
  "transition_energy_score",
  "sfx_impact_score",
  "rights_risk_score",
  "stale_wording_risk",
  "media_house_polish_score",
];

const THRESHOLDS = {
  motion_density_score: 75,
  first_3_seconds_hook_score: 75,
  source_lock_quality_score: 65,
  caption_legibility_score: 70,
  card_hierarchy_score: 65,
  transition_energy_score: 65,
  sfx_impact_score: 65,
  rights_risk_score: 70,
  stale_wording_risk: 30,
  media_house_polish_score: 75,
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value) {
  const text = cleanText(value);
  return text ? text.split(/\s+/).length : 0;
}

function words(value) {
  return cleanText(value).split(/\s+/).filter(Boolean);
}

function maxTokenLength(value) {
  return words(value).reduce((max, word) => {
    const cleaned = word.replace(/[^A-Za-z0-9]/g, "");
    return Math.max(max, cleaned.length);
  }, 0);
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function storyText(story = {}) {
  return [
    story.title,
    story.suggested_title,
    story.hook,
    story.body,
    story.full_script,
    story.tts_script,
    story.source_card_label,
    story.publisher,
    story.outlet,
  ]
    .filter(Boolean)
    .join(" ");
}

function directorPlanFor(story = {}, options = {}) {
  return (
    asObject(options.directorPlan) ||
    asObject(story.visual_director_plan) ||
    asObject(story.visual_v4_director_plan) ||
    asObject(story.director_plan) ||
    asObject(story._extra?.visual_director_plan)
  );
}

function shotPlanFor(directorPlan = {}) {
  return asArray(directorPlan.shot_plan || directorPlan.shots);
}

function transitionPlanFor(directorPlan = {}) {
  return (
    asObject(directorPlan.transition_plan) ||
    asObject(directorPlan.sound_transition_plan?.transitions) ||
    {}
  );
}

function sfxPlanFor(directorPlan = {}) {
  return (
    asObject(directorPlan.sound_transition_plan?.sfx) ||
    asObject(directorPlan.sfx_plan) ||
    {}
  );
}

function captionPolicyFor(story = {}, directorPlan = {}) {
  const policy = { ...asObject(directorPlan.caption_policy) };
  for (const key of [
    "subtitle_timing_source",
    "subtitle_timing_inspection",
    "clean_manual_captions",
    "manual_caption_generated",
  ]) {
    if (story[key] !== undefined && story[key] !== null) {
      policy[key] = story[key];
    }
  }
  return policy;
}

function uniqueMotionFamilies(shots = [], clips = []) {
  const families = new Set();
  for (const shot of shots) {
    if (shot?.kind !== "motion_clip") continue;
    const family = cleanText(shot.source_family || shot.media_path || shot.id);
    if (family) families.add(family);
  }
  for (const clip of clips) {
    const family = cleanText(
      clip.source_family || clip.source_url || clip.path || clip.id,
    );
    if (family) families.add(family);
  }
  return families;
}

function motionDensityScore({ story = {}, shots = [], visualProfile = null }) {
  const clips = asArray(story.video_clips);
  const motionShotCount = shots.filter((shot) => shot?.kind === "motion_clip").length;
  const familyCount = uniqueMotionFamilies(shots, clips).size;
  const motionCount = Math.max(motionShotCount, clips.length, familyCount);
  const cardLed = story.card_led === true || story.render_mode === "card_led";
  const target = cardLed ? 4 : 8;
  const base = (motionCount / target) * 100;
  const staticCards = shots.filter((shot) => /card|source_lock|context/i.test(shot?.kind || "")).length;
  const staticPenalty = shots.length > 0 ? Math.max(0, (staticCards / shots.length - 0.35) * 60) : 15;
  let score = clampScore(base - staticPenalty);
  const profile = visualProfile || visualEvidenceProfile({ story, directorPlan: { shot_plan: shots } });
  if (profile.generated_only_motion_deck) score = Math.min(score, 35);
  else if (profile.motion_asset_count >= 5 && profile.real_media_asset_count === 0) {
    score = Math.min(score, 45);
  } else if (
    profile.motion_asset_count >= 5 &&
    profile.generated_motion_asset_count / profile.motion_asset_count > 0.65 &&
    profile.real_media_family_count < 2
  ) {
    score = Math.min(score, 60);
  }
  return clampScore(score);
}

function firstWords(text, count = 16) {
  return cleanText(text).split(/\s+/).slice(0, count).join(" ");
}

const SUBJECT_MATCH_STOPWORDS = new Set([
  "game",
  "games",
  "news",
  "story",
  "update",
  "edition",
  "official",
  "release",
  "launch",
  "trailer",
  "the",
  "and",
  "for",
  "with",
]);

function normaliseSubjectMatchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectMatchAliases(subject) {
  const raw = cleanText(subject);
  const normalised = normaliseSubjectMatchText(raw);
  if (!normalised || normalised === "this story") return [];

  const aliases = new Set([normalised]);
  const colonParts = raw.split(":").map(normaliseSubjectMatchText).filter(Boolean);
  if (colonParts.length > 1) aliases.add(colonParts[colonParts.length - 1]);

  const tokens = normalised.split(/\s+/).filter(Boolean);
  for (let start = 0; start < tokens.length; start++) {
    for (let length = 2; length <= Math.min(4, tokens.length - start); length++) {
      const phraseTokens = tokens.slice(start, start + length);
      const hasDistinctiveToken = phraseTokens.some(
        (token) => token.length >= 4 && !SUBJECT_MATCH_STOPWORDS.has(token),
      );
      if (hasDistinctiveToken) aliases.add(phraseTokens.join(" "));
    }
  }

  for (const token of tokens) {
    if (token.length >= 4 && !SUBJECT_MATCH_STOPWORDS.has(token)) {
      aliases.add(token);
    }
  }

  return [...aliases].sort((a, b) => b.length - a.length);
}

function hasNamedSubject(text, subject) {
  const haystack = normaliseSubjectMatchText(text);
  const needle = normaliseSubjectMatchText(subject);
  if (!haystack || !needle || needle === "this story") return false;
  if (haystack.includes(needle)) return true;
  return subjectMatchAliases(subject).some((alias) => haystack.includes(alias));
}

function isGenericTitle(title) {
  return /^(?:gaming news update|this gaming story|this story|new gaming update)$/i.test(
    cleanText(title),
  );
}

function first3SecondsHookScore({ story = {}, shots = [], manifest = {} }) {
  const hook = firstWords(story.hook || story.full_script || story.tts_script || "");
  const title = story.suggested_title || story.public_title || story.title || "";
  let score = 0;
  if (shots.some((shot) => Number(shot.startS ?? shot.start_s ?? 99) <= 0.35)) score += 28;
  if (hasNamedSubject(hook, manifest.canonical_subject)) score += 25;
  if (!/^(?:here'?s|here is|today|so|welcome|in this video)\b/i.test(hook)) score += 17;
  if (!isGenericTitle(title) && hasNamedSubject(title, manifest.canonical_subject)) score += 18;
  if (/\b(?:problem|risk|trap|exploded?|skyrocket|dodged|avoided|exposed|beats?|biggest|ridiculous|won't vanish)\b/i.test(`${hook} ${title}`)) {
    score += 12;
  }
  return clampScore(score);
}

function sourceLockQualityScore({ story = {}, shots = [], manifest = {} }) {
  const source = cleanText(story.source_card_label || manifest.primary_source);
  let score = 0;
  if (shots.some((shot) => shot?.kind === "source_lock" && Number(shot.startS ?? 99) <= 4.5)) score += 35;
  if (source && !/^r\//i.test(source) && source !== "Unknown source") score += 35;
  if (!/\b(?:qa|internal|source[-\s]?backed|wait[-\s]and[-\s]see|reddit reaction)\b/i.test(source)) score += 15;
  if (!(String(story.source_type || "").toLowerCase() === "reddit" && /^r\//i.test(source) && story.article_url)) score += 15;
  return clampScore(score);
}

function captionLegibilityScore({ story = {}, directorPlan = {} }) {
  const policy = captionPolicyFor(story, directorPlan);
  let score = 0;
  if (policy.clean_manual_captions || policy.manual_caption_generated || policy.subtitle_timing_source === "timestamps") score += 45;
  if (policy.snap_to_local_word_timing !== false) score += 20;
  if (Number(policy.max_caption_desync_ms || 120) <= 120) score += 20;
  if (policy.avoid_lower_third_collisions !== false) score += 15;
  if (/synthetic|fallback/i.test(cleanText(policy.subtitle_timing_source))) score -= 35;
  if (policy.subtitle_timing_inspection?.usable === false) score -= 45;
  return clampScore(score);
}

function cardHierarchyScore({ story = {}, shots = [], directorPlan = {} }) {
  const thumbWords = wordCount(story.thumbnail_text || story.suggested_thumbnail_text);
  const hasDataCard = shots.some((shot) =>
    /steam_chart|review_score_card|price_snap|chart|score/i.test(shot?.kind || ""),
  );
  const hasProofCard = shots.some((shot) =>
    /proof_card|quote_card|screenshot_callout|source_proof|gameplay_proof/i.test(shot?.kind || ""),
  );
  const rules = {
    ...asObject(directorPlan.visual_obligations),
    ...asObject(directorPlan.transition_plan?.rules),
  };
  let score = 0;
  if (thumbWords > 0 && thumbWords <= 5) score += 30;
  else if (thumbWords <= 8) score += 18;
  if (hasDataCard) score += 25;
  if (hasProofCard) score += 25;
  if (/\b(?:\d{1,3}(?:,\d{3})+|\$\d+|metacritic|steam|score)\b/i.test(storyText(story))) score += 15;
  if (rules.forbid_text_on_text || rules.no_text_on_text || rules.no_text_over_text_wipes) score += 15;
  if (rules.chart_numbers_must_be_large || rules.cards_are_context_only) score += 15;
  if (thumbWords > 8) score -= 30;
  return clampScore(score);
}

function buildFrameRules({ story = {}, directorPlan = {}, scores = {}, manifest = {} } = {}) {
  const thumbnailText = cleanText(
    story.thumbnail_text ||
      story.suggested_thumbnail_text ||
      story.thumbnail_headline ||
      story.title,
  );
  const sourceLabel = cleanText(
    story.source_card_label ||
      story.primary_source ||
      manifest.primary_source,
  );
  const captionPolicy = captionPolicyFor(story, directorPlan);
  const thumbnailWordCount = wordCount(thumbnailText);
  const thumbnailLongestToken = maxTokenLength(thumbnailText);
  const sourceWordCount = wordCount(sourceLabel);
  const sourceLongestToken = maxTokenLength(sourceLabel);
  const textObjectsWithinSafeBounds =
    thumbnailWordCount > 0 &&
    thumbnailWordCount <= 8 &&
    thumbnailLongestToken <= 18;
  const sourceLabelsMobileReadable =
    !!sourceLabel &&
    sourceLabel.length <= 42 &&
    sourceWordCount <= 6 &&
    sourceLongestToken <= 18;
  const captionOverlayClear = captionPolicy.avoid_lower_third_collisions !== false;
  const sourceLocksReadable =
    scores.source_lock_quality_score == null ||
    scores.source_lock_quality_score >= THRESHOLDS.source_lock_quality_score;

  return {
    text_objects_within_safe_bounds: textObjectsWithinSafeBounds,
    source_labels_mobile_readable: sourceLabelsMobileReadable,
    caption_overlay_clear: captionOverlayClear,
    source_locks_readable: sourceLocksReadable,
    thumbnail_word_count: thumbnailWordCount,
    thumbnail_longest_token_chars: thumbnailLongestToken,
    source_label_length_chars: sourceLabel.length,
    source_label_word_count: sourceWordCount,
    source_label_longest_token_chars: sourceLongestToken,
    ruleset: "studio_v4_frame_layout_v1",
  };
}

function frameRuleFailures(frameRules = {}) {
  const failures = [];
  if (frameRules.text_objects_within_safe_bounds === false) {
    failures.push("gold_standard:text_safe_bounds_below_reference");
  }
  if (frameRules.source_labels_mobile_readable === false) {
    failures.push("gold_standard:source_label_mobile_readability_below_reference");
  }
  if (frameRules.caption_overlay_clear === false) {
    failures.push("gold_standard:caption_overlay_collision_risk");
  }
  if (frameRules.source_locks_readable === false) {
    failures.push("gold_standard:source_lock_below_reference");
  }
  return failures;
}

function transitionEnergyScore({ transitionPlan = {} }) {
  const planned = asArray(transitionPlan.planned);
  const families = new Set(planned.map((item) => cleanText(item.family)).filter(Boolean));
  let score = Math.min(45, planned.length * 5);
  score += Math.min(30, families.size * 6);
  if (Number(transitionPlan.max_same_transition_run || transitionPlan.max_same_family_run || 1) <= 2) score += 15;
  if (planned.some((item) => /speed_ramp|whip_pan|chart_slam|source_wipe|wipe/i.test(item.family || ""))) score += 10;
  return clampScore(score);
}

function sfxImpactScore({ sfxPlan = {} }) {
  const cues = asArray(sfxPlan.cues);
  const cueCount = Number(sfxPlan.cue_count || cues.length || 0);
  const families = new Set(cues.map((cue) => cleanText(cue.family)).filter(Boolean));
  let score = Math.min(45, cueCount * 5);
  if (families.has("impact")) score += 15;
  if ([...families].some((family) => /whoosh|transition_hit|riser|chart_tick/.test(family))) score += 20;
  if (Number(sfxPlan.max_same_family_run || 1) <= 2) score += 10;
  if (sfxPlan.mastering?.limiter && Number(sfxPlan.mastering?.target_peak_db || -1.5) <= -1) score += 10;
  if (cleanText(sfxPlan.source_plan?.readiness?.status) === "blocked") {
    score = Math.min(score, 45);
  }
  return clampScore(score);
}

function sfxSourceFailures(sfxPlan = {}) {
  const readiness = sfxPlan.source_plan?.readiness;
  if (!readiness || cleanText(readiness.status) !== "blocked") return [];
  return ["gold_standard:sfx_source_quality_below_reference"];
}

function rightRiskClass(asset = {}) {
  return cleanText(
    asset.rights_risk_class ||
      asset.licence_basis ||
      asset.rights_status ||
      asset.licence_scope ||
      asset.approval_status ||
      asset.source_type,
  );
}

function numericRiskScore(asset = {}) {
  const score = Number(asset.risk_score ?? asset.rights_risk_score);
  return Number.isFinite(score) ? score : null;
}

function isApprovedRightsAsset(asset = {}) {
  if (!asset || typeof asset !== "object") return false;
  if (asset.commercial_use_allowed === false) return false;
  const text = [
    asset.approval_status,
    asset.licence_basis,
    asset.license_basis,
    asset.allowed_use,
    asset.asset_type,
    asset.transformation_notes,
    asset.source_type,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();
  const risk = numericRiskScore(asset);
  return (
    /approved/.test(text) &&
    /(?:source_documented_transformative_editorial_use|screenshot_derived_editorial_motion|screenshot_derived_motion_clip|official|storefront|steam|publisher|licensed)/i.test(text) &&
    (risk === null || risk <= 0.5)
  );
}

function assetKey(asset = {}) {
  if (typeof asset === "string") return cleanText(asset).replace(/\\/g, "/").toLowerCase();
  return cleanText(
    asset.path ||
      asset.local_path ||
      asset.media_path ||
      asset.file_path ||
      asset.source_url ||
      asset.url,
  )
    .replace(/\\/g, "/")
    .toLowerCase();
}

function rightsLedgerByAssetKey(story = {}) {
  const byKey = new Map();
  for (const record of asArray(story.rights_ledger)) {
    const keys = [
      assetKey(record),
      cleanText(record.asset_id).toLowerCase(),
      cleanText(record.source_family).toLowerCase(),
    ].filter(Boolean);
    for (const key of keys) {
      const current = byKey.get(key);
      if (!current || rightsRecordPriority(record) > rightsRecordPriority(current)) {
        byKey.set(key, record);
      }
    }
  }
  return byKey;
}

function rightsRecordPriority(record = {}) {
  if (!record || typeof record !== "object") return 0;
  const text = [
    record.approval_status,
    record.licence_basis,
    record.license_basis,
    record.allowed_use,
    record.source_type,
    record.rights_risk_class,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();
  let score = 0;
  if (/approved/.test(text)) score += 4;
  if (/owned|official|storefront|steam|publisher|licensed|source_documented/.test(text)) score += 4;
  if (record.commercial_use_allowed === true) score += 2;
  if (numericRiskScore(record) !== null) score += 1;
  if (cleanText(record.source_url || record.url)) score += 1;
  if (cleanText(record.licence_basis || record.license_basis)) score += 1;
  if (!cleanText(record.rights_risk_class) && cleanText(record.source_type).toLowerCase() === "video") score -= 2;
  return score;
}

function assetWithRightsRecord(asset, ledgerByKey) {
  if (!ledgerByKey || ledgerByKey.size === 0) return asset;
  const key = assetKey(asset);
  if (key && ledgerByKey.has(key)) return ledgerByKey.get(key);
  if (asset && typeof asset === "object") {
    const id = cleanText(asset.asset_id || asset.id).toLowerCase();
    const family = cleanText(asset.source_family).toLowerCase();
    return ledgerByKey.get(id) || ledgerByKey.get(family) || asset;
  }
  return asset;
}

function rightsRiskScore(story = {}) {
  const ledgerByKey = rightsLedgerByAssetKey(story);
  const videoClipAssets = asArray(story.video_clips).map((asset) =>
    assetWithRightsRecord(asset, ledgerByKey),
  );
  const assets = [
    ...asArray(story.downloaded_images),
    ...videoClipAssets,
    ...asArray(story.media_provenance),
    ...(videoClipAssets.length === 0 ? asArray(story.rights_ledger) : []),
  ];
  if (assets.length === 0) return 55;
  let safe = 0;
  let risky = 0;
  let missing = 0;
  for (const asset of assets) {
    const klass = rightRiskClass(asset);
    if (
      isApprovedRightsAsset(asset) ||
      /owned|official|storefront|publisher|steam|igdb|licensed_creator_clip|creative_commons|source_documented_transformative_editorial_use/i.test(klass)
    ) {
      safe += 1;
    } else if (/random|unlicensed|unknown|youtube_fallback|repost|missing/i.test(klass) || !klass) {
      risky += 1;
      if (!asset.source_url && !asset.path) missing += 1;
    }
  }
  return clampScore((safe / assets.length) * 100 - risky * 18 - missing * 12);
}

function staleWordingRisk(story = {}) {
  const text = storyText(story);
  let risk = 0;
  if (/\b(?:today|yesterday|tomorrow|this week|currently|at the moment|right now)\b/i.test(text)) risk += 20;
  if (/\b(?:developing|more details could arrive soon|wait and see|watching this space)\b/i.test(text)) risk += 25;
  if (/\b(?:gaming news update|this gaming story|here is what happened)\b/i.test(text)) risk += 25;
  if (/\b(?:latest|new)\b/i.test(text) && !/\b(?:source|date|reported|confirmed)\b/i.test(text)) risk += 10;
  return clampScore(risk);
}

function selectReferencePacks({ story = {}, shots = [], transitionPlan = {}, sfxPlan = {} }) {
  const text = storyText(story);
  const packs = new Set(["Gaming News Core"]);
  if (
    asArray(story.video_clips).length > 0 ||
    shots.some((shot) => shot?.kind === "motion_clip") ||
    /\b(?:trailer|gameplay|reveal|playstation|xbox|nintendo|publisher)\b/i.test(text)
  ) {
    packs.add("Official Publisher Motion");
  }
  if (
    shots.some((shot) => /chart|score|price/i.test(shot?.kind || "")) ||
    /\b(?:steam|metacritic|score|\d{1,3}(?:,\d{3})+|\$\d+|why it matters)\b/i.test(text)
  ) {
    packs.add("Explainer / Data Graphics");
  }
  if (
    /\b(?:reuters|associated press|ap news|bbc|bloomberg|nowthis|washington post|cnbc|business insider)\b/i.test(text)
  ) {
    packs.add("Social-First News");
  }
  if (asArray(transitionPlan.planned).length > 0 || Number(sfxPlan.cue_count || 0) > 0) {
    packs.add("Pacing / Retention / Impact");
  }
  if (/\b(?:documentary|premium visual|awe shot|process footage|natgeo|nasa)\b/i.test(text)) {
    packs.add("Premium Visual Texture");
  }
  return REQUIRED_REFERENCE_PACKS.filter((pack) => packs.has(pack));
}

function buildFailures(scores = {}) {
  const failures = [];
  if (scores.motion_density_score < THRESHOLDS.motion_density_score) {
    failures.push("gold_standard:motion_density_below_reference");
  }
  if (scores.first_3_seconds_hook_score < THRESHOLDS.first_3_seconds_hook_score) {
    failures.push("gold_standard:first_3_seconds_hook_below_reference");
  }
  if (scores.source_lock_quality_score < THRESHOLDS.source_lock_quality_score) {
    failures.push("gold_standard:source_lock_below_reference");
  }
  if (scores.caption_legibility_score < THRESHOLDS.caption_legibility_score) {
    failures.push("gold_standard:caption_legibility_below_reference");
  }
  if (scores.card_hierarchy_score < THRESHOLDS.card_hierarchy_score) {
    failures.push("gold_standard:card_hierarchy_below_reference");
  }
  if (scores.transition_energy_score < THRESHOLDS.transition_energy_score) {
    failures.push("gold_standard:transition_energy_below_reference");
  }
  if (scores.sfx_impact_score < THRESHOLDS.sfx_impact_score) {
    failures.push("gold_standard:sfx_impact_below_reference");
  }
  if (scores.rights_risk_score < THRESHOLDS.rights_risk_score) {
    failures.push("gold_standard:rights_risk_above_reference");
  }
  if (scores.stale_wording_risk > THRESHOLDS.stale_wording_risk) {
    failures.push("gold_standard:stale_wording_risk_above_reference");
  }
  if (scores.media_house_polish_score < THRESHOLDS.media_house_polish_score) {
    failures.push("gold_standard:media_house_polish_below_reference");
  }
  return failures;
}

function runMediaHouseBenchmark(options = {}) {
  const story = options.story || {};
  const directorPlan = directorPlanFor(story, options);
  const shots = shotPlanFor(directorPlan);
  const transitionPlan = transitionPlanFor(directorPlan);
  const sfxPlan = sfxPlanFor(directorPlan);
  const manifest = options.manifest || buildStoryManifest(story, options);
  const library = options.library || loadGoldStandardReferenceLibrary(options);
  const visualProfile = visualEvidenceProfile({
    story,
    rightsLedger: story.rights_ledger || options.rightsLedger,
    footageInventory: story.footage_inventory || options.footageInventory,
    directorPlan,
  });

  const scores = {
    motion_density_score: motionDensityScore({ story, shots, visualProfile }),
    first_3_seconds_hook_score: first3SecondsHookScore({ story, shots, manifest }),
    source_lock_quality_score: sourceLockQualityScore({ story, shots, manifest }),
    caption_legibility_score: captionLegibilityScore({ story, directorPlan }),
    card_hierarchy_score: cardHierarchyScore({ story, shots, directorPlan }),
    transition_energy_score: transitionEnergyScore({ transitionPlan }),
    sfx_impact_score: sfxImpactScore({ sfxPlan }),
    rights_risk_score: rightsRiskScore(story),
    stale_wording_risk: staleWordingRisk(story),
  };

  const positive =
    scores.motion_density_score * 0.17 +
    scores.first_3_seconds_hook_score * 0.17 +
    scores.source_lock_quality_score * 0.12 +
    scores.caption_legibility_score * 0.12 +
    scores.card_hierarchy_score * 0.12 +
    scores.transition_energy_score * 0.12 +
    scores.sfx_impact_score * 0.1 +
    scores.rights_risk_score * 0.08;
  scores.media_house_polish_score = clampScore(positive - scores.stale_wording_risk * 0.25);
  if (visualProfile.generated_only_motion_deck) {
    scores.media_house_polish_score = Math.min(scores.media_house_polish_score, 40);
  } else if (visualProfile.motion_asset_count >= 5 && visualProfile.real_media_asset_count === 0) {
    scores.media_house_polish_score = Math.min(scores.media_house_polish_score, 55);
  }

  const frameRules = buildFrameRules({ story, directorPlan, scores, manifest });
  const failures = buildFailures(scores);
  failures.push(...frameRuleFailures(frameRules));
  failures.push(...sfxSourceFailures(sfxPlan));
  for (const blocker of visualProfile.blockers) failures.push(`gold_standard:${blocker}`);
  const requireGate =
    options.requireGate === true ||
    story.require_gold_standard_benchmark === true ||
    story.media_house_benchmark_required === true;
  const warnings = requireGate ? [] : failures.map((failure) => `${failure}:warn`);

  return {
    schema_version: 1,
    benchmark_library: {
      workbook_path: library.workbook_path,
      reference_count: library.references.length,
      rule_count: library.codex_rules.length,
      legal_rule: library.summary.core_legal_rule || null,
    },
    reference_pack_used: selectReferencePacks({ story, shots, transitionPlan, sfxPlan }),
    scores,
    thresholds: THRESHOLDS,
    result: requireGate && failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: requireGate ? failures : [],
    warnings,
    extraction_targets: SCORE_KEYS,
    frame_rules: frameRules,
    visual_evidence_profile: visualProfile,
  };
}

module.exports = {
  SCORE_KEYS,
  THRESHOLDS,
  runMediaHouseBenchmark,
  _private: {
    selectReferencePacks,
    staleWordingRisk,
  },
};
