"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { APPROVED_AFFILIATE_PROGRAMMES } = require("./commercial-intelligence-engine");

const GOAL_ID = "15_affiliate_intelligence_engine";

const PLATFORM_KEYS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const SCORE_DIMENSIONS = [
  "relevance",
  "audience_fit",
  "merchant_trust",
  "commission",
  "conversion_likelihood",
  "availability",
  "geography",
  "platform_suitability",
  "compliance_risk",
  "repetition_risk",
];

const APPROVED_MERCHANT_RE = /\b(?:amazon|steam|humble|fanatical|green\s*man\s*gaming|awin|impact|sovrn|official|playstation|xbox|nintendo)\b/i;
const RISKY_MERCHANT_RE = /\b(?:casino|gambling|betting|crypto|forex|loan|payday|binary\s+option|adult|sketchy)\b/i;
const HARD_SELL_RE =
  /\b(?:buy\s+now\s+(?:with|using|through|from|before|today|here|via|and|get|to)|shop\s+now|must\s+buy|best\s+deal|grab\s+yours|limited\s+time|use\s+my\s+link|do\s+not\s+miss|before\s+(?:the\s+)?deal\s+ends)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
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

function buildSocialIndex(upstreamSocialReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamSocialReport.stories || upstreamSocialReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, socialIndex = new Map()) {
  const row = socialIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal14_social_derivatives_missing"];
  const status = cleanText(row.status || row.verdict).toLowerCase();
  if (["ready", "pass", "passed", "green"].includes(status)) return [];
  return unique(["upstream:goal14_social_derivatives_blocked", ...asArray(row.blockers)]);
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    if (value && typeof value === "object") {
      for (const key of ["score", "value", "amount", "percentage", "percent"]) {
        const nested = firstNumber(value[key]);
        if (Number.isFinite(nested)) return nested;
      }
    }
  }
  return null;
}

function clampScore(value, fallback = 0) {
  const number = firstNumber(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function storyTitle(canonical = {}, storyPackage = {}) {
  return cleanText(
    canonical.selected_title ||
      canonical.short_title ||
      canonical.canonical_title ||
      canonical.title ||
      storyPackage.title ||
      canonical.canonical_subject,
  );
}

function storySubject(canonical = {}, title = "") {
  return cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.subject || title);
}

function affiliateStoryText(canonical = {}, storyPackage = {}) {
  return cleanText([
    canonical.selected_title,
    canonical.short_title,
    canonical.canonical_title,
    canonical.title,
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.description,
    canonical.narration_script,
    storyPackage.title,
    storyPackage.subject,
    ...asArray(canonical.confirmed_claims),
  ].filter(Boolean).join(" ")).toLowerCase();
}

function offerLinks(affiliate = {}) {
  return [affiliate.primary_link, ...asArray(affiliate.fallback_links)].filter((link) => link && typeof link === "object");
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

function validUrlish(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (text.startsWith("/")) return true;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function linkIsDead(link = {}) {
  const status = cleanText(link.link_status || link.status || link.health || link.availability_status).toLowerCase();
  if (/\b(?:dead|broken|unreachable|404|expired|invalid)\b/.test(status)) return true;
  const url = cleanText(link.url);
  const trackingUrl = cleanText(link.tracking_url);
  if (url && !validUrlish(url)) return true;
  if (!url && trackingUrl && !validUrlish(trackingUrl)) return true;
  return !url && !trackingUrl;
}

function productUnavailable(link = {}) {
  const status = cleanText(link.availability_status || link.product_status || link.stock_status).toLowerCase();
  if (/\b(?:unavailable|out_of_stock|out-of-stock|expired|discontinued|not_available)\b/.test(status)) return true;
  const availability = firstNumber(link.availability, link.availability_score, link.stock_score);
  return Number.isFinite(availability) && availability <= 0;
}

function merchantName(affiliate = {}, link = {}) {
  return cleanText(link.merchant || affiliate.merchant || link.programme || link.program || affiliate.programme || affiliate.program);
}

function merchantTrustScore(affiliate = {}, link = {}) {
  const approved = APPROVED_AFFILIATE_PROGRAMMES.find((programme) =>
    merchantName(affiliate, link).toLowerCase().includes(programme.id.replace(/_/g, " ")) ||
    merchantName(affiliate, link).toLowerCase().includes(programme.name.toLowerCase().split(" ")[0]),
  );
  return clampScore(link.merchant_trust || affiliate.trust_score || approved?.trust_score, 0);
}

function merchantRisky(affiliate = {}, link = {}) {
  const name = merchantName(affiliate, link);
  const status = cleanText(link.merchant_status || affiliate.merchant_status || link.programme_status).toLowerCase();
  const trust = merchantTrustScore(affiliate, link);
  if (RISKY_MERCHANT_RE.test(name)) return true;
  if (/\b(?:risky|blocked|unapproved|unknown|blacklist|blacklisted)\b/.test(status)) return true;
  if (trust > 0 && trust < 50) return true;
  return Boolean(name && !APPROVED_MERCHANT_RE.test(name) && trust < 60);
}

function disclosureCopyPresent(affiliate = {}, landing = {}) {
  const affiliateCopy = collectStrings(affiliate.disclosure_copy).join(" ");
  const platformCopy = collectStrings(affiliate.platform_disclosure).join(" ");
  const landingCopy = collectStrings(landing.disclosure_block?.copy || landing.disclosure_copy).join(" ");
  return {
    affiliate: Boolean(cleanText(affiliateCopy) || cleanText(platformCopy)),
    landing: Boolean(cleanText(landingCopy)),
    any: Boolean(cleanText(affiliateCopy) || cleanText(platformCopy) || cleanText(landingCopy)),
  };
}

function disclosureMissing(affiliate = {}, landing = {}, links = []) {
  const required = affiliate.disclosure_required === true || landing.disclosure_block?.required === true || links.length > 0;
  if (!required) return false;
  const copy = disclosureCopyPresent(affiliate, landing);
  if (links.length > 0) return !copy.affiliate;
  return !copy.any;
}

function hardSellPresent(affiliate = {}) {
  const text = collectStrings({
    platform_specific_ctas: affiliate.platform_specific_ctas,
    public_cta: affiliate.public_cta,
    primary_link_cta: affiliate.primary_link?.cta,
    fallback_links: asArray(affiliate.fallback_links).map((link) => link.cta),
  }).join(" ");
  return HARD_SELL_RE.test(text);
}

function financeCryptoLeakage(affiliate = {}, links = []) {
  const vertical = cleanText(affiliate.vertical).toLowerCase();
  if (!["finance", "crypto"].includes(vertical)) return false;
  if (links.length > 0) return true;
  const text = collectStrings(affiliate.platform_specific_ctas).join(" ");
  return /\b(?:buy|sell|invest|trade|yield|coin|token|wallet)\b/i.test(text);
}

function linkUnrelated(affiliate = {}, link = {}) {
  const verdict = cleanText(link.relevance_verdict || affiliate.relevance_verdict || affiliate.intent_verdict).toLowerCase();
  if (/\b(?:unrelated|mismatch|irrelevant)\b/.test(verdict)) return true;
  const reasons = asArray(affiliate.rejection_reasons).join(" ");
  if (/\b(?:unrelated|mismatch|irrelevant)\b/i.test(reasons)) return true;
  const relevance = firstNumber(link.story_relevance, link.relevance_score, affiliate.relevance_score);
  return Number.isFinite(relevance) && relevance > 0 && relevance < 40;
}

function linkMismatchesStorySubject({ canonical = {}, storyPackage = {}, link = {}, affiliate = {} } = {}) {
  const storyText = affiliateStoryText(canonical, storyPackage);
  const offerText = cleanText([
    link.label,
    link.query,
    link.product_category,
    link.category,
    affiliate.commercial_intent_type,
    affiliate.primary_affiliate_angle,
  ].filter(Boolean).join(" ")).toLowerCase();
  if (/\b(?:racing wheel|racing seat|racing monitor|racing_game_setup)\b/.test(offerText)) {
    return !/\b(?:forza|gran turismo|racing|f1\s*\d*|sim racing|wheel)\b/.test(storyText);
  }
  return false;
}

function linkLevelPlatformTracking(links = []) {
  return links.reduce((out, link) => {
    for (const [platform, url] of Object.entries(link.platform_tracking_urls || {})) {
      if (cleanText(url)) out[platform] = url;
    }
    return out;
  }, {});
}

function attributionLinkTracking(affiliate = {}, landing = {}) {
  return asArray(affiliate.landing_page_attribution?.link_tracking || landing.attribution_manifest?.link_tracking);
}

function trackingMissing(affiliate = {}, landing = {}, links = []) {
  if (!links.length) return false;
  const trackingMap = affiliate.affiliate_tracking_map || {};
  const platformMap = trackingMap.platforms || {};
  if (cleanText(trackingMap.story_page)) return false;
  if (links.some((link) => cleanText(link.tracking_url))) return false;
  if (Object.values(platformMap).some((value) => cleanText(value))) return false;
  if (Object.values(linkLevelPlatformTracking(links)).some((value) => cleanText(value))) return false;
  if (attributionLinkTracking(affiliate, landing).some((row) => cleanText(row.offer_tracking_url))) return false;
  return true;
}

function platformTrackingCount(affiliate = {}, landing = {}) {
  const direct = affiliate.affiliate_tracking_map?.platforms || {};
  const attribution = affiliate.landing_page_attribution?.platforms || landing.attribution_manifest?.platforms || {};
  const keys = unique([...Object.keys(direct), ...Object.keys(attribution)]);
  return keys.filter((key) => {
    const directValue = direct[key];
    const attributionValue = attribution[key];
    return cleanText(directValue) || cleanText(attributionValue?.landing_page_url) || cleanText(attributionValue?.tracking_key);
  }).length;
}

function scoreParts(affiliate = {}, landing = {}) {
  const links = offerLinks(affiliate);
  const primary = links[0] || {};
  const platformScore = Math.min(100, Math.round((platformTrackingCount(affiliate, landing) / PLATFORM_KEYS.length) * 100));
  const scores = {};
  scores.relevance = clampScore(affiliate.relevance_score ?? primary.story_relevance ?? primary.relevance_score, 0);
  scores.audience_fit = clampScore(affiliate.audience_fit_score ?? primary.audience_fit ?? primary.audience_fit_score, 0);
  scores.merchant_trust = merchantTrustScore(affiliate, primary);
  scores.commission = clampScore(primary.commission_value ?? affiliate.commission_score ?? affiliate.commission_estimate, 0);
  scores.conversion_likelihood = clampScore(primary.conversion_likelihood ?? affiliate.conversion_likelihood_score, 0);
  scores.availability = clampScore(primary.availability ?? affiliate.availability_score, links.length ? 0 : 0);
  scores.geography = clampScore(primary.geography_fit ?? affiliate.geography_score, links.length ? inferredGeographyScore(primary) : 0);
  scores.platform_suitability = clampScore(primary.platform_suitability ?? affiliate.platform_suitability_score, platformScore);
  scores.compliance_risk = clampScore(affiliate.compliance_risk_score ?? primary.compliance_risk, 0);
  scores.repetition_risk = clampScore(primary.repetition_risk ?? affiliate.repetition_risk_score, 0);
  return SCORE_DIMENSIONS.reduce((out, dimension) => {
    out[dimension] = scores[dimension];
    return out;
  }, {});
}

function inferredGeographyScore(link = {}) {
  const text = collectStrings(link).join(" ");
  if (/amazon\.co\.uk|amazon uk|gbp|united kingdom|uk\b/i.test(text)) return 86;
  if (/amazon\.com|usd|united states|us\b/i.test(text)) return 70;
  return 60;
}

function overallCommercialScore(parts = {}, links = []) {
  if (!links.length) return 0;
  const positive = [
    parts.relevance,
    parts.audience_fit,
    parts.merchant_trust,
    parts.commission,
    parts.conversion_likelihood,
    parts.availability,
    parts.geography,
    parts.platform_suitability,
    100 - parts.compliance_risk,
    100 - parts.repetition_risk,
  ];
  return Math.round(positive.reduce((sum, value) => sum + clampScore(value), 0) / positive.length);
}

function buildOpportunity(story, affiliate = {}, landing = {}) {
  const links = offerLinks(affiliate);
  const parts = scoreParts(affiliate, landing);
  const score = clampScore(affiliate.commercial_opportunity_score ?? affiliate.revenue_score, overallCommercialScore(parts, links));
  return {
    story_id: story.story_id,
    status: links.length ? "offer_scored" : "no_direct_offer_safe",
    primary_offer_id: affiliate.primary_link?.id || null,
    commercial_intent_type: cleanText(affiliate.commercial_intent_type || "unknown"),
    score_parts: parts,
    overall_score: links.length ? score || overallCommercialScore(parts, links) : 0,
    no_offer_reason: links.length ? null : cleanText(asArray(affiliate.rejection_reasons)[0] || "no_safe_direct_affiliate_offer"),
  };
}

function buildDisclosureRow(story, affiliate = {}, landing = {}, directBlockers = []) {
  const copy = disclosureCopyPresent(affiliate, landing);
  return {
    story_id: story.story_id,
    disclosure_required: affiliate.disclosure_required === true || landing.disclosure_block?.required === true || offerLinks(affiliate).length > 0,
    affiliate_disclosure_present: copy.affiliate,
    landing_disclosure_present: copy.landing,
    platform_disclosure_present: Boolean(Object.keys(affiliate.platform_disclosure || {}).length),
    status: directBlockers.includes("affiliate:missing_disclosure") ? "fail" : "pass",
    disclosure_copy: affiliate.disclosure_copy || landing.disclosure_block?.copy || null,
  };
}

function buildTrackingRow(story, affiliate = {}, landing = {}, directBlockers = []) {
  const links = offerLinks(affiliate);
  const directPlatforms = affiliate.affiliate_tracking_map?.platforms || {};
  const linkPlatforms = linkLevelPlatformTracking(links);
  const attributionPlatforms = affiliate.landing_page_attribution?.platforms || landing.attribution_manifest?.platforms || {};
  const storyPage =
    affiliate.affiliate_tracking_map?.story_page ||
    links.find((link) => cleanText(link.tracking_url))?.tracking_url ||
    null;
  return {
    story_id: story.story_id,
    primary_offer_id: affiliate.affiliate_tracking_map?.primary_offer_id || affiliate.primary_link?.id || null,
    story_page: storyPage,
    platforms: { ...linkPlatforms, ...directPlatforms, ...attributionPlatforms },
    link_tracking: attributionLinkTracking(affiliate, landing),
    status: directBlockers.includes("affiliate:missing_tracking")
      ? "fail"
      : links.length
        ? "tracked"
        : "not_required_without_direct_offer",
  };
}

function zeroRevenueRow(story, affiliate = {}) {
  const existing = affiliate.revenue_attribution || {};
  return {
    story_id: story.story_id,
    primary_offer_id: existing.primary_offer_id || affiliate.primary_link?.id || null,
    platform_clicks: existing.platform_clicks || PLATFORM_KEYS.reduce((out, platform) => {
      out[platform] = 0;
      return out;
    }, {}),
    landing_page_visits: 0,
    conversions: 0,
    revenue: {
      amount: 0,
      currency: existing.revenue?.currency || "GBP",
      source: existing.revenue?.source || "waiting_for_affiliate_network_reporting",
    },
    attribution_status: "local_proof_zeroed_no_network_reporting",
  };
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const affiliate = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), null);
  const landing = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const upstream = upstreamBlockers(storyId, context.socialIndex);
  const directBlockers = [];
  const risks = [];
  const title = storyTitle(canonical, storyPackage);
  const subject = storySubject(canonical, title);
  const affiliateManifest = affiliate || {};
  const links = offerLinks(affiliateManifest);

  function addBlocker(blocker, detail) {
    if (!directBlockers.includes(blocker)) directBlockers.push(blocker);
    risks.push({
      story_id: storyId,
      category: blocker,
      severity: "hard_fail",
      detail: detail || blocker,
    });
  }

  if (!affiliate) {
    addBlocker("affiliate:manifest_missing", "affiliate_link_manifest.json is required for affiliate intelligence.");
  }

  for (const link of links) {
    if (linkUnrelated(affiliateManifest, link)) {
      addBlocker("affiliate:unrelated_link", "Commercial link relevance is below the hard-fail threshold or marked unrelated.");
    }
    if (linkMismatchesStorySubject({ canonical, storyPackage, affiliate: affiliateManifest, link })) {
      addBlocker("affiliate:story_product_mismatch", "Commercial link product category does not match the story subject.");
    }
    if (merchantRisky(affiliateManifest, link)) {
      addBlocker("affiliate:risky_merchant", "Commercial link merchant is risky, unapproved or below trust threshold.");
    }
    if (linkIsDead(link)) {
      addBlocker("affiliate:dead_link", "Commercial link is marked dead or has an invalid URL.");
    }
    if (productUnavailable(link)) {
      addBlocker("affiliate:unavailable_product", "Commercial link product is unavailable or out of stock.");
    }
  }

  if (disclosureMissing(affiliateManifest, landing, links)) {
    addBlocker("affiliate:missing_disclosure", "Required affiliate disclosure copy is missing.");
  }
  if (financeCryptoLeakage(affiliateManifest, links)) {
    addBlocker("affiliate:finance_crypto_leakage", "Finance or crypto story has a commercial link or buy/sell style commercial CTA.");
  }
  if (hardSellPresent(affiliateManifest)) {
    addBlocker("affiliate:hard_sell_cta", "Hard-sell commercial CTA language is present.");
  }
  if (trackingMissing(affiliateManifest, landing, links)) {
    addBlocker("affiliate:missing_tracking", "Direct affiliate offer is missing story-page or platform tracking.");
  }

  const story = {
    story_id: storyId,
    title,
    subject,
    artifact_dir: artifactDir,
  };
  const blockers = unique([...upstream, ...directBlockers]);
  return {
    ...story,
    status: blockers.length ? "blocked" : "ready",
    direct_affiliate_status: directBlockers.length ? "blocked" : "pass",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_affiliate_blockers: directBlockers,
    risks,
    affiliate_link_manifest: {
      story_id: storyId,
      vertical: cleanText(affiliateManifest.vertical || "unknown"),
      commercial_intent_type: cleanText(affiliateManifest.commercial_intent_type || "unknown"),
      primary_link: affiliateManifest.primary_link || null,
      fallback_links: asArray(affiliateManifest.fallback_links),
      merchant: affiliateManifest.merchant || affiliateManifest.primary_link?.merchant || null,
      product_category: affiliateManifest.product_category || affiliateManifest.primary_link?.product_category || null,
      disclosure_required: affiliateManifest.disclosure_required === true || landing.disclosure_block?.required === true,
      landing_page_route: affiliateManifest.landing_page_route || landing.landing_page_route || null,
      rejection_reasons: asArray(affiliateManifest.rejection_reasons),
      direct_affiliate_status: directBlockers.length ? "blocked" : "pass",
      blockers: directBlockers,
      source_file_present: Boolean(affiliate),
    },
    commercial_opportunity_score: buildOpportunity(story, affiliateManifest, landing),
    disclosure_row: buildDisclosureRow(story, affiliateManifest, landing, directBlockers),
    tracking_row: buildTrackingRow(story, affiliateManifest, landing, directBlockers),
    revenue_row: zeroRevenueRow(story, affiliateManifest),
    source_material: {
      affiliate_manifest_present: Boolean(affiliate),
      landing_manifest_present: Boolean(Object.keys(landing || {}).length),
      platform_manifest_present: Boolean(Object.keys(platformManifest || {}).length),
      direct_offer_count: links.length,
      platform_tracking_count: platformTrackingCount(affiliateManifest, landing),
    },
    safety: {
      local_proof_only: true,
      no_network_link_checking: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
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
    for (const blocker of asArray(story.direct_affiliate_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildAffiliateLinkManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => story.affiliate_link_manifest),
    safety: {
      local_proof_only: true,
      no_live_link_mutation: true,
      no_external_posting: true,
    },
  };
}

function buildCommercialOpportunityScore(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    required_dimensions: SCORE_DIMENSIONS,
    stories: asArray(report.stories).map((story) => story.commercial_opportunity_score),
    safety: {
      no_network_link_checking: true,
      no_affiliate_network_reporting_pull: true,
    },
  };
}

function buildDisclosureManifest(report = {}) {
  const rows = asArray(report.stories).map((story) => story.disclosure_row);
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    verdict: rows.some((row) => row.status === "fail") ? "fail" : "pass",
    stories: rows,
    hard_fail_categories: ["affiliate:missing_disclosure"],
    safety: {
      no_disclosure_toggle_mutation: true,
      no_external_posting: true,
    },
  };
}

function buildAffiliateTrackingMap(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    stories: asArray(report.stories).map((story) => story.tracking_row),
    safety: {
      no_click_redirect_mutation: true,
      no_external_posting: true,
      no_network_link_checking: true,
    },
  };
}

function buildRevenueAttribution(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => story.revenue_row),
    safety: {
      no_affiliate_network_reporting_pull: true,
      no_production_db_mutation: true,
      local_zeroed_attribution_only: true,
    },
  };
}

async function buildGoal15AffiliateIntelligenceEngine({
  storyPackages = [],
  upstreamSocialReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal15AffiliateIntelligenceEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const socialIndex = buildSocialIndex(upstreamSocialReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, socialIndex }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_affiliate_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_affiliate_status !== "pass");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directAffiliateVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_affiliate_verdict: directAffiliateVerdict,
    summary: {
      story_count: stories.length,
      affiliate_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_affiliate_pass_story_count: directPassStories.length,
      direct_affiliate_blocked_story_count: directBlockedStories.length,
      commercial_score_story_count: stories.filter((story) => story.commercial_opportunity_score).length,
      disclosure_story_count: stories.filter((story) => story.disclosure_row).length,
      tracking_story_count: stories.filter((story) => story.tracking_row).length,
      direct_offer_story_count: stories.filter((story) => story.source_material.direct_offer_count > 0).length,
    },
    blocker_counts: blockerCounts(stories),
    direct_risk_counts: directRiskCounts(stories),
    upstream_blockers: {
      goal14_social_derivatives_engine:
        "Goal 15 can validate commercial safety and prepare affiliate intelligence, but readiness requires Goal 14 and its upstream gates to be ready first.",
      note:
        "This gate creates local proof artefacts only. It does not check live links over the network, post externally, mutate DB rows, inspect secrets or touch OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      no_network_link_checking: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_platform_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.affiliate_link_manifest = buildAffiliateLinkManifest(report);
  report.commercial_opportunity_score = buildCommercialOpportunityScore(report);
  report.disclosure_manifest = buildDisclosureManifest(report);
  report.affiliate_tracking_map = buildAffiliateTrackingMap(report);
  report.revenue_attribution = buildRevenueAttribution(report);
  return report;
}

function renderGoal15AffiliateIntelligenceEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 15 Affiliate Intelligence Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct affiliate verdict: ${report.direct_affiliate_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Full affiliate-ready stories: ${report.summary?.affiliate_ready_story_count || 0}`);
  lines.push(`Direct affiliate-pass stories: ${report.summary?.direct_affiliate_pass_story_count || 0}`);
  lines.push(`Direct offer stories: ${report.summary?.direct_offer_story_count || 0}`);
  lines.push(`Commercial score stories: ${report.summary?.commercial_score_story_count || 0}`);
  lines.push(`Disclosure stories: ${report.summary?.disclosure_story_count || 0}`);
  lines.push(`Tracking stories: ${report.summary?.tracking_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Direct Affiliate Hard Fails");
  const direct = Object.keys(report.direct_risk_counts || {}).sort();
  if (!direct.length) lines.push("- none");
  for (const blocker of direct) lines.push(`- ${blocker}: ${report.direct_risk_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not publish, post externally, check live links over the network, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal15AffiliateIntelligenceEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal15AffiliateIntelligenceEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal15_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal15_readiness_report.md");
  const affiliateLinkManifest = path.join(outDir, "affiliate_link_manifest.json");
  const commercialOpportunityScore = path.join(outDir, "commercial_opportunity_score.json");
  const disclosureManifest = path.join(outDir, "disclosure_manifest.json");
  const affiliateTrackingMap = path.join(outDir, "affiliate_tracking_map.json");
  const revenueAttribution = path.join(outDir, "revenue_attribution.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal15AffiliateIntelligenceEngineMarkdown(report), "utf8");
  await fs.writeJson(affiliateLinkManifest, report.affiliate_link_manifest || buildAffiliateLinkManifest(report), { spaces: 2 });
  await fs.writeJson(commercialOpportunityScore, report.commercial_opportunity_score || buildCommercialOpportunityScore(report), { spaces: 2 });
  await fs.writeJson(disclosureManifest, report.disclosure_manifest || buildDisclosureManifest(report), { spaces: 2 });
  await fs.writeJson(affiliateTrackingMap, report.affiliate_tracking_map || buildAffiliateTrackingMap(report), { spaces: 2 });
  await fs.writeJson(revenueAttribution, report.revenue_attribution || buildRevenueAttribution(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    affiliateLinkManifest,
    commercialOpportunityScore,
    disclosureManifest,
    affiliateTrackingMap,
    revenueAttribution,
  };
}

module.exports = {
  GOAL_ID,
  PLATFORM_KEYS,
  SCORE_DIMENSIONS,
  buildAffiliateLinkManifest,
  buildAffiliateTrackingMap,
  buildCommercialOpportunityScore,
  buildDisclosureManifest,
  buildGoal15AffiliateIntelligenceEngine,
  buildRevenueAttribution,
  inspectStoryPackage,
  renderGoal15AffiliateIntelligenceEngineMarkdown,
  writeGoal15AffiliateIntelligenceEngine,
};
