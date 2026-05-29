"use strict";

const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const {
  editorialSfxScore,
  minimumScoreForRole,
} = require("./studio/v4/sfx-source-registry");
const { policyVersionBlockers } = require("./studio/v4/render-policy");

const BANNED_PUBLIC_PHRASES = [
  "source-backed update",
  "not a blank check",
  "not a blank cheque",
  "invent extra details",
  "named source confirms",
  "wait-and-see column",
  "Reddit reaction into evidence",
  "this gaming story",
  "the useful caveat is",
  "the safest public version is",
  "here is the hot take",
  "that is the useful part",
  "according to the named source",
  "the concrete claim",
  "the confirmed claim is simple",
  "source_locked_update",
];

const GENERIC_TITLE_PATTERNS = [
  /^\s*this gaming story\s*$/i,
  /^\s*(gaming news|gaming update|game update|news update)\s*$/i,
  /\bjust got a source-backed update\b/i,
  /\bgave players the update they needed\b/i,
];

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

const VISUAL_QUALITY_THRESHOLDS = {
  motion_density_score: 75,
  first_3_seconds_hook_score: 75,
  source_lock_quality_score: 65,
  caption_legibility_score: 70,
  card_hierarchy_score: 65,
  media_house_polish_score: 75,
};
const MAX_TEMPORAL_CLAIM_AGE_DAYS = 14;
const MONTH_INDEX = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].map((month, index) => [month, index]),
);
const CURRENT_NEWS_WORDING_RE =
  /\b(?:today|tonight|this week|this month|right now|out now|available now|just|finally|already|live|went up|drops?|is here|is out|new)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function words(value) {
  return clean(value).split(/\s+/).filter(Boolean);
}

function add(blockers, code) {
  if (code) blockers.add(code);
}

function sourceName(source) {
  if (!source) return "";
  if (typeof source === "string") return clean(source);
  return clean(source.name || source.source_name || source.label || source.title || source.url);
}

function sourceUrl(source) {
  if (!source || typeof source === "string") return "";
  return clean(source.url || source.source_url || source.href);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceKey(value) {
  const name = lower(sourceName(value) || value);
  if (!name) return "";
  const compact = name.replace(/[^a-z0-9]+/g, "");
  for (const source of SOURCE_ATTRIBUTION_ALIASES) {
    if (source.aliases.some((alias) => compact.includes(alias.toLowerCase().replace(/[^a-z0-9]+/g, "")))) {
      return source.key;
    }
  }
  return compact;
}

function namedSourceAttributions(text = "") {
  const haystack = clean(text);
  const found = new Set();
  for (const source of SOURCE_ATTRIBUTION_ALIASES) {
    for (const alias of source.aliases) {
      const escaped = escapeRegExp(alias);
      const reportingPattern = new RegExp(`\\b${escaped}\\s+(?:reports|says|confirms|claims|reveals|notes|writes)\\b`, "i");
      const sourceLabelPattern = new RegExp(`\\bsource:\\s*${escaped}\\b`, "i");
      if (reportingPattern.test(haystack) || sourceLabelPattern.test(haystack)) {
        found.add(source.key);
      }
    }
  }
  return Array.from(found);
}

function isDiscussionSource(source) {
  const name = lower(sourceName(source));
  const url = lower(sourceUrl(source));
  return (
    /^r\//.test(name) ||
    /\breddit\b/.test(name) ||
    /\bforum\b/.test(name) ||
    /\bdiscord\b/.test(name) ||
    /reddit\.com|discord\.com|discord\.gg/.test(url)
  );
}

function isLikelySource(source) {
  return Boolean(sourceName(source) || sourceUrl(source));
}

function hasSubject(text, subject) {
  const subjectText = clean(subject);
  if (!subjectText) return false;
  const haystack = lower(text);
  const subjectLower = lower(subjectText);
  if (haystack.includes(subjectLower)) return true;
  const importantTokens = words(subjectText)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 4);
  return importantTokens.length > 0 && importantTokens.some((token) => haystack.includes(token));
}

function containsBannedPublicPhrase(text) {
  const haystack = lower(text);
  return BANNED_PUBLIC_PHRASES.some((phrase) => haystack.includes(phrase.toLowerCase()));
}

function titleLooksGeneric(title) {
  const text = clean(title);
  if (!text) return true;
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

function platformNativeEvidenceFailed(platformManifest = {}) {
  const evidence =
    platformManifest.platform_native_evidence ||
    platformManifest.platform_variant_scorecard ||
    platformManifest.platform_native_report ||
    null;
  if (!evidence) return true;
  const verdict = lower(evidence.verdict || evidence.status || evidence.result);
  if (["pass", "passed", "green"].includes(verdict)) return false;
  if (Array.isArray(evidence.failures) && evidence.failures.length) return true;
  if (Array.isArray(evidence.blockers) && evidence.blockers.length) return true;
  return verdict ? !["pass", "passed", "green"].includes(verdict) : true;
}

function affiliateDisclosureMissing({ affiliateManifest = {}, policyReport = {}, landingPageManifest = {} } = {}) {
  const affiliateLinks = [
    affiliateManifest.primary_link,
    affiliateManifest.affiliate_url,
    affiliateManifest.link,
    ...asArray(affiliateManifest.links),
    ...asArray(affiliateManifest.affiliate_links),
    ...asArray(affiliateManifest.fallback_links),
    ...asArray(affiliateManifest.candidate_links).filter((link) => {
      if (!link || !link.url) return false;
      return !asArray(link.rejection_reasons).length;
    }),
  ].filter(Boolean);
  const affiliateRequired =
    affiliateManifest.disclosure_required === true ||
    affiliateLinks.length > 0 ||
    policyReport.disclosure_requirements?.affiliate === true ||
    policyReport.disclosures?.affiliate === true;
  if (!affiliateRequired) return false;
  const disclosureText = clean(
      affiliateManifest.disclosure ||
      affiliateManifest.disclosure_text ||
      affiliateManifest.disclosure_copy?.short ||
      affiliateManifest.disclosure_copy?.landing ||
      affiliateManifest.disclosure_copy?.video ||
      landingPageManifest.disclosure ||
      landingPageManifest.disclosure_block ||
      policyReport.disclosure_text,
  );
  return disclosureText.length < 10;
}

function disclosureTextFor({ affiliateManifest = {}, policyReport = {}, landingPageManifest = {} } = {}) {
  return clean(
    affiliateManifest.disclosure ||
    affiliateManifest.disclosure_text ||
    affiliateManifest.disclosure_copy?.short ||
    landingPageManifest.disclosure ||
      landingPageManifest.disclosure_block ||
      policyReport.disclosure_text ||
      policyReport.disclosure_requirements?.disclosure_text,
  );
}

function flattenObjectValues(value, out = []) {
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      flattenObjectValues(child, out);
    } else {
      out.push({ key: clean(key).toLowerCase(), value: child });
    }
  }
  return out;
}

function hasAppliedPlatformDisclosure(disclosureObjects = []) {
  return disclosureObjects.some((disclosure) =>
    flattenObjectValues(disclosure).some(({ key, value }) => {
      if (value !== true) return false;
      return /(?:disclos|toggle|paid_promotion|ai|synthetic|altered|commercial|branded)/i.test(key);
    }),
  );
}

function platformDisclosureMissing({
  platformManifest = {},
  policyReport = {},
  affiliateManifest = {},
  landingPageManifest = {},
} = {}) {
  const requirements = {
    ...(policyReport.disclosure_requirements || {}),
    ...(policyReport.disclosures || {}),
    ...(platformManifest.disclosure_requirements || {}),
    ...(platformManifest.disclosures || {}),
  };
  const platformRequired = Object.entries(requirements).some(([key, value]) => {
    if (value !== true) return false;
    if (/affiliate/i.test(key)) return false;
    return /(?:platform|commercial|paid|promotion|ai|synthetic|altered|branded)/i.test(key);
  });
  if (!platformRequired) return false;
  if (
    hasAppliedPlatformDisclosure([
      policyReport.platform_disclosure,
      policyReport.platform_disclosures,
      platformManifest.platform_disclosure,
      platformManifest.platform_disclosures,
      affiliateManifest.platform_disclosure,
    ])
  ) {
    return false;
  }
  return disclosureTextFor({ affiliateManifest, policyReport, landingPageManifest }).length < 10;
}

function commercialDealDetected(text = "") {
  const value = clean(text);
  return (
    /\b\d{1,3}%\s*off\b/i.test(value) ||
    /\bfor\s+(?:[$£€]\s*)?\d+(?:[.,]\d{2})?\b/i.test(value) ||
    /\b(?:[$£€]\s*)\d+(?:[.,]\d{2})?\b/i.test(value) ||
    /\b(?:best buy|amazon|walmart|currys|argos)\b/i.test(value) ||
    /\b(?:power bank|controller deal|headset deal|keyboard deal|mouse deal|monitor deal|console deal|bundle deal)\b/i.test(value)
  );
}

function commercialDealDetectedStrict(text = "") {
  const value = clean(text);
  const hasPercentOff = /\b\d{1,3}%\s*off\b/i.test(value);
  const hasMerchant = /\b(?:best buy|amazon|walmart|currys|argos)\b/i.test(value);
  const hasSaleLanguage =
    /\b(?:deal|on sale|sale|discount|coupon|promo code|price drop|memorial day|black friday|cyber monday|clearance|markdown|save)\b/i.test(
      value,
    );
  const hasProductContext =
    /\b(?:gamesir|power bank|controller|headset|keyboard|mouse|monitor|console|bundle|ssd|storage|dock|charger|capture card|racing wheel|subscription deal)\b/i.test(
      value,
    );
  const hasMoney = /(?:[$£€]\s*\d|\b\d+(?:[.,]\d{2})?\s*(?:dollars|pounds|euros)\b)/i.test(value);
  return (
    hasPercentOff ||
    (hasSaleLanguage && (hasProductContext || hasMerchant || hasMoney)) ||
    (hasMerchant && (hasProductContext || hasMoney))
  );
}

function commercialDealDisclosureMissing({
  publicText = "",
  affiliateManifest = {},
  policyReport = {},
  landingPageManifest = {},
} = {}) {
  if (!commercialDealDetectedStrict(publicText)) return false;
  const platformDisclosure =
    policyReport.disclosure_requirements?.affiliate === true ||
    policyReport.disclosure_requirements?.commercial === true ||
    policyReport.disclosure_requirements?.paid_promotion === true ||
    policyReport.disclosures?.affiliate === true ||
    policyReport.disclosures?.commercial === true;
  const affiliateDisclosure =
    affiliateManifest.disclosure_required === true ||
    Boolean(affiliateManifest.affiliate_url || affiliateManifest.link || affiliateManifest.links?.length);
  if (!platformDisclosure && !affiliateDisclosure) return true;
  return disclosureTextFor({ affiliateManifest, policyReport, landingPageManifest }).length < 10;
}

function parseMentionedDates(text = "") {
  const value = clean(text);
  const dates = [];
  const pattern =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/gi;
  let match;
  while ((match = pattern.exec(value))) {
    const month = MONTH_INDEX.get(String(match[1] || "").toLowerCase());
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    const at = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    if (Number.isNaN(at.getTime())) continue;
    dates.push({
      iso_date: at.toISOString().slice(0, 10),
      matched_text: match[0],
      timestamp_ms: at.getTime(),
    });
  }
  return dates;
}

function collectTemporalFreshnessBlockers({
  canonical = {},
  publicText = "",
  generatedAt = null,
  maxAgeDays = MAX_TEMPORAL_CLAIM_AGE_DAYS,
} = {}) {
  const now = new Date(generatedAt || Date.now()).getTime();
  const claimText = [
    ...asArray(canonical.confirmed_claims),
    ...asArray(canonical.claim_inventory?.confirmed),
    ...asArray(canonical.allowed_public_wording),
    publicText,
  ].join(" ");
  const datedClaims = parseMentionedDates(claimText).map((date) => ({
    ...date,
    age_days: Number.isFinite(now)
      ? Math.floor((now - date.timestamp_ms) / 86_400_000)
      : null,
  }));
  const staleDatedClaims = datedClaims.filter((date) => Number.isFinite(date.age_days) && date.age_days > maxAgeDays);
  const staleWordRisks = asArray(canonical.stale_wording_risks).map(clean).filter(Boolean);
  const currentNewsWording = CURRENT_NEWS_WORDING_RE.test(publicText);
  const blockers = [];
  if (staleWordRisks.length) blockers.push("incident:stale_wording_risk");
  if (staleDatedClaims.length) blockers.push("incident:stale_temporal_claim");
  if (staleDatedClaims.length && currentNewsWording) blockers.push("incident:current_wording_on_old_event");
  return {
    max_temporal_claim_age_days: maxAgeDays,
    current_news_wording_detected: currentNewsWording,
    dated_claims: datedClaims.map(({ timestamp_ms, ...date }) => date),
    stale_dated_claims: staleDatedClaims.map(({ timestamp_ms, ...date }) => date),
    stale_wording_risks: staleWordRisks,
    oldest_temporal_claim_age_days: staleDatedClaims.length
      ? Math.max(...staleDatedClaims.map((date) => date.age_days))
      : null,
    blockers,
  };
}

function objectHasEvidence(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function reportVerdict(report = {}) {
  return lower(report.result || report.verdict || report.status || report.outcome);
}

function reportHasFailure(report = {}) {
  const verdict = reportVerdict(report);
  return (
    ["fail", "failed", "red", "blocked"].includes(verdict) ||
    asArray(report.failures).length > 0 ||
    asArray(report.blockers).length > 0
  );
}

function renderPolicyRequired(renderManifest = {}) {
  if (renderManifest.final_publish_render !== true) return false;
  const renderer = lower(renderManifest.renderer);
  const tier = lower(renderManifest.visual_tier);
  const invocationMode = lower(renderManifest.render_invocation_mode);
  return (
    renderer.includes("visual_v4_production") ||
    renderer.includes("studio_v4_production") ||
    tier === "production_v4_motion" ||
    invocationMode === "final_production_render"
  );
}

function scoreValue(report = {}, key) {
  const value =
    report.scores?.[key] ??
    report.scorecard?.[key] ??
    report.metrics?.[key] ??
    report[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function bestScore(reports = [], key) {
  const values = reports
    .map((report) => scoreValue(report, key))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return Math.max(...values);
}

function collectVisualQualityBlockers({
  visualQualityReport = {},
  benchmarkReport = {},
} = {}) {
  const blockers = [];
  const hasVisualQuality = objectHasEvidence(visualQualityReport);
  const hasBenchmark = objectHasEvidence(benchmarkReport);

  if (!hasVisualQuality) blockers.push("incident:post_render_visual_qa_missing");
  else if (reportHasFailure(visualQualityReport)) blockers.push("incident:post_render_visual_qa_failed");

  if (!hasBenchmark) blockers.push("incident:benchmark_qa_missing");
  else if (reportHasFailure(benchmarkReport)) blockers.push("incident:benchmark_qa_failed");

  const reports = [visualQualityReport, benchmarkReport].filter(objectHasEvidence);
  const motionDensity = bestScore(reports, "motion_density_score");
  if (motionDensity != null && motionDensity < VISUAL_QUALITY_THRESHOLDS.motion_density_score) {
    blockers.push("incident:motion_density_too_low");
  }
  const firstThreeSeconds = bestScore(reports, "first_3_seconds_hook_score");
  if (firstThreeSeconds != null && firstThreeSeconds < VISUAL_QUALITY_THRESHOLDS.first_3_seconds_hook_score) {
    blockers.push("incident:first_frame_weak");
  }
  const sourceLock = bestScore(reports, "source_lock_quality_score");
  if (sourceLock != null && sourceLock < VISUAL_QUALITY_THRESHOLDS.source_lock_quality_score) {
    blockers.push("incident:source_lock_unreadable");
  }
  const captionLegibility = bestScore(reports, "caption_legibility_score");
  if (captionLegibility != null && captionLegibility < VISUAL_QUALITY_THRESHOLDS.caption_legibility_score) {
    blockers.push("incident:captions_unreadable");
  }
  const hierarchy = bestScore(reports, "card_hierarchy_score");
  if (hierarchy != null && hierarchy < VISUAL_QUALITY_THRESHOLDS.card_hierarchy_score) {
    blockers.push("incident:text_hierarchy_weak");
  }
  const polish = bestScore(reports, "media_house_polish_score");
  if (polish != null && polish < VISUAL_QUALITY_THRESHOLDS.media_house_polish_score) {
    blockers.push("incident:below_benchmark_polish");
  }

  const frameRules = visualQualityReport.frame_rules || {};
  if (objectHasEvidence(frameRules) && frameRules.source_locks_readable === false) {
    blockers.push("incident:source_lock_unreadable");
  }

  return [...new Set(blockers)];
}

function collectSfxSourceBlockers(sfxManifest = {}) {
  if (!objectHasEvidence(sfxManifest)) return ["incident:sfx_manifest_missing"];
  const sourcePlan = sfxManifest.source_plan || sfxManifest.sourcePlan || sfxManifest.sourcing_plan;
  if (!objectHasEvidence(sourcePlan)) return ["incident:sfx_source_plan_missing"];
  const readiness = sourcePlan.readiness || {};
  const status = lower(readiness.status || sourcePlan.status || sourcePlan.verdict);
  const sourceBlockers = asArray(readiness.blockers || sourcePlan.blockers).map(clean);
  const selectedAssets = [
    ...asArray(sourcePlan.selected_assets || sourcePlan.selectedAssets),
    ...asArray(sfxManifest.selected_assets || sfxManifest.selectedAssets),
  ];
  const blockers = [];
  if (!["pass", "passed", "green", "ready"].includes(status)) {
    blockers.push("incident:sfx_source_quality_unresolved");
  }
  if (!selectedAssets.length) blockers.push("incident:sfx_source_assets_missing");
  const rejectedSelectedRoles = new Set();
  for (const asset of selectedAssets) {
    const role = clean(asset.role || asset.sfx_role || asset.family || asset.category || "unknown");
    const score = Number(editorialSfxScore(asset, null, role));
    const floor = minimumScoreForRole(role);
    if (!Number.isFinite(score) || score < floor) {
      blockers.push("incident:sfx_selected_asset_not_editorial");
      if (role) rejectedSelectedRoles.add(role);
    }
  }
  for (const role of rejectedSelectedRoles) blockers.push(`sfx_source:rejected_selected_asset:${role}`);
  return [...new Set([...blockers, ...sourceBlockers])];
}

function evaluateIncidentGuard({
  story_id = null,
  generated_at = null,
  canonical_story_manifest: canonical = {},
  render_manifest: renderManifest = {},
  visual_quality_report: visualQualityReport = {},
  benchmark_report: benchmarkReport = {},
  sfx_manifest: sfxManifest = {},
  publish_verdict: publishVerdict = {},
  platform_publish_manifest: platformManifest = {},
  platform_policy_report: policyReport = {},
  landing_page_manifest: landingPageManifest = {},
  affiliate_link_manifest: affiliateManifest = {},
  file_evidence: fileEvidence = {},
} = {}) {
  const blockers = new Set();
  const warnings = [];
  const canonicalSubject = clean(canonical.canonical_subject || canonical.canonical_game || canonical.canonical_company);
  const title = clean(canonical.selected_title || canonical.short_title || canonical.canonical_title || canonical.title);
  const thumbnailHeadline = clean(canonical.thumbnail_headline || canonical.thumbnail || canonical.cover_headline);
  const firstLine = clean(canonical.first_spoken_line || canonical.narration_hook || canonical.hook);
  const script = clean(canonical.narration_script || canonical.full_script || canonical.script);
  const fullScript = clean(canonical.full_script);
  const ttsScript = clean(canonical.tts_script);
  const description = clean(canonical.description);
  const publicText = [
    title,
    thumbnailHeadline,
    firstLine,
    script,
    fullScript,
    ttsScript,
    description,
    JSON.stringify(platformManifest.outputs || {}),
  ].join(" ");

  if (!canonicalSubject) add(blockers, "incident:canonical_subject_missing");
  if (titleLooksGeneric(title)) add(blockers, "incident:title_generic");
  if (/\bthis gaming story\b/i.test(title)) add(blockers, "incident:title_placeholder");
  if (canonicalSubject && !hasSubject(title, canonicalSubject)) {
    add(blockers, "incident:title_missing_canonical_subject");
  }
  if (canonicalSubject && !firstLine) {
    add(blockers, "incident:first_spoken_line_missing");
  } else if (canonicalSubject && !hasSubject(firstLine, canonicalSubject)) {
    add(blockers, "incident:first_line_missing_canonical_subject");
  }
  if (canonicalSubject && thumbnailHeadline && !hasSubject(thumbnailHeadline, canonicalSubject)) {
    add(blockers, "incident:thumbnail_title_script_mismatch");
  }
  if (containsBannedPublicPhrase(publicText)) add(blockers, "incident:internal_qa_language");

  const publicCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    platform_publish_manifest: platformManifest,
    landing_page_manifest: landingPageManifest,
  });
  for (const failure of asArray(publicCopyQa.failures)) add(blockers, failure);
  const temporalFreshness = collectTemporalFreshnessBlockers({
    canonical,
    publicText,
    generatedAt: generated_at,
  });
  for (const blocker of temporalFreshness.blockers) add(blockers, blocker);

  const primarySource = canonical.primary_source;
  const discoverySource = canonical.discovery_source;
  const secondarySources = asArray(canonical.secondary_sources);
  const officialSource = canonical.official_source;
  if (isDiscussionSource(primarySource) && (secondarySources.some(isLikelySource) || isLikelySource(officialSource))) {
    add(blockers, "incident:discovery_source_used_as_primary");
  }
  if (
    isLikelySource(primarySource) &&
    isLikelySource(discoverySource) &&
    isDiscussionSource(discoverySource) &&
    sourceName(primarySource) === sourceName(discoverySource) &&
    (secondarySources.some(isLikelySource) || isLikelySource(officialSource))
  ) {
    add(blockers, "incident:source_label_mismatch");
  }
  const allowedSourceKeys = new Set([
    sourceKey(primarySource),
    sourceKey(officialSource),
    ...secondarySources.map(sourceKey),
  ].filter(Boolean));
  for (const attributedSource of namedSourceAttributions(publicText)) {
    if (!allowedSourceKeys.has(attributedSource)) {
      add(blockers, "incident:source_label_mismatch");
    }
  }

  if (renderManifest.final_publish_render !== true) add(blockers, "incident:render_not_final_publish_ready");
  if (renderPolicyRequired(renderManifest)) {
    for (const blocker of policyVersionBlockers(renderManifest)) {
      add(blockers, `incident:${blocker}`);
    }
  }
  const renderLane = lower(renderManifest.render_lane || renderManifest.lane || renderManifest.renderer);
  if (renderLane.includes("legacy_multi_image") && renderManifest.emergency_fallback_approved !== true) {
    add(blockers, "incident:render_lane_legacy_unapproved");
  }
  const renderClass = lower(renderManifest.render_quality_class || renderManifest.quality_class || renderManifest.visual_tier);
  if (renderClass === "fallback" || renderClass === "standard") add(blockers, "incident:render_class_below_premium");
  const visualCount = Number(renderManifest.visual_count ?? renderManifest.visuals_count ?? renderManifest.asset_count);
  if (Number.isFinite(visualCount) && visualCount < 3) add(blockers, "incident:thin_visuals");

  if (fileEvidence.mp4_ready === false) add(blockers, "incident:mp4_missing");
  if (fileEvidence.captions_ready === false) add(blockers, "incident:captions_missing_or_dirty");
  if (fileEvidence.narration_ready === false) add(blockers, "incident:narration_missing");
  if (fileEvidence.word_timestamps_ready === false) add(blockers, "incident:word_timestamps_missing");
  if (fileEvidence.materialised_motion_ready === false) add(blockers, "incident:materialised_motion_missing");
  if (fileEvidence.distinct_motion_families_ready === false) add(blockers, "incident:distinct_motion_families_missing");
  if (fileEvidence.rights_ledger_ready === false) add(blockers, "incident:rights_ledger_missing");

  for (const blocker of collectVisualQualityBlockers({ visualQualityReport, benchmarkReport })) {
    add(blockers, blocker);
  }
  for (const blocker of collectSfxSourceBlockers(sfxManifest)) {
    add(blockers, blocker);
  }

  if (platformNativeEvidenceFailed(platformManifest)) add(blockers, "incident:platform_native_evidence_failed");
  const verdict = clean(publishVerdict.verdict || publishVerdict.status);
  if (!verdict) add(blockers, "incident:control_tower_verdict_missing");
  else if (verdict !== "GREEN") add(blockers, "incident:control_tower_verdict_not_green");
  if (affiliateDisclosureMissing({ affiliateManifest, policyReport, landingPageManifest })) {
    add(blockers, "incident:affiliate_disclosure_missing");
  }
  if (platformDisclosureMissing({ platformManifest, policyReport, affiliateManifest, landingPageManifest })) {
    add(blockers, "incident:platform_disclosure_missing");
  }
  if (commercialDealDisclosureMissing({ publicText, affiliateManifest, policyReport, landingPageManifest })) {
    add(blockers, "incident:commercial_deal_disclosure_missing");
  }

  const disasterUploadBlockers = Array.from(blockers);
  return {
    schema_version: 1,
    story_id: clean(story_id || canonical.story_id || canonical.id || "unknown"),
    verdict: disasterUploadBlockers.length ? "fail" : "pass",
    safe_to_publish_boolean: disasterUploadBlockers.length === 0,
    disaster_upload_blockers: disasterUploadBlockers,
    warnings,
    public_output_coherence_report: {
      verdict: disasterUploadBlockers.some((blocker) =>
        /title|thumbnail|first_line|internal_qa|source_label|discovery_source|public_copy/.test(blocker),
      )
        ? "fail"
        : "pass",
      blockers: disasterUploadBlockers.filter((blocker) =>
        /title|thumbnail|first_line|internal_qa|source_label|discovery_source|public_copy/.test(blocker),
      ),
    },
    evidence: {
      canonical_subject: canonicalSubject || null,
      title: title || null,
      render_final_publish_ready: renderManifest.final_publish_render === true,
      publish_verdict: verdict || null,
      file_evidence: fileEvidence,
      public_copy_qa: publicCopyQa,
      visual_quality_report_present: objectHasEvidence(visualQualityReport),
      benchmark_report_present: objectHasEvidence(benchmarkReport),
      sfx_source_plan_present: objectHasEvidence(sfxManifest.source_plan || sfxManifest.sourcePlan),
      temporal_freshness: temporalFreshness,
    },
  };
}

module.exports = {
  BANNED_PUBLIC_PHRASES,
  VISUAL_QUALITY_THRESHOLDS,
  evaluateIncidentGuard,
};
