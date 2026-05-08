"use strict";

const {
  buildAffiliateStack,
  normaliseAffiliateUrl,
} = require("../affiliate-targeting");
const { repairMojibake } = require("../text-hygiene");
const { buildMonetisationSnapshot } = require("./monetisation-tracker");

const SPONSOR_REQUIRED_METRICS = [
  "subscribers",
  "shorts_views_90d",
  "average_view_duration_seconds",
  "average_view_percentage",
  "comments_per_view",
];

function words(value) {
  return normaliseSearchText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function normaliseSearchText(value) {
  return repairMojibake(String(value || ""))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function searchQueryFromAmazonUrl(url) {
  try {
    return new URL(url).searchParams.get("k") || "";
  } catch {
    return "";
  }
}

function storySpecificScore(story, link, expectedLinks) {
  const storyWords = new Set(words(`${story?.title || ""} ${story?.full_script || ""}`));
  const queryWords = words(link.query || searchQueryFromAmazonUrl(link.url));
  const expectedQueries = new Set(
    expectedLinks.flatMap((item) => words(`${item.query || ""} ${item.label || ""}`)),
  );
  let score = 0;
  for (const word of queryWords) {
    if (storyWords.has(word)) score += 2;
    if (expectedQueries.has(word)) score += 1;
  }
  if (/fallback:/i.test(link.reason || "")) score -= 3;
  return score;
}

function naturallySupportsAffiliate(story) {
  const text = normaliseSearchText(`${story?.title || ""} ${story?.full_script || ""}`).toLowerCase();
  const policyOnly = /\b(policy|law|account|verification|privacy|regulation|quarter|earnings|ceo)\b/.test(text);
  const productAngle =
    /\b(release|launch|price|deal|sale|discount|hardware|console|controller|accessory|peripheral|headset|storage|download|pokemon\s+go|steam deck|game pass)\b/.test(
      text,
    );
  return !policyOnly || productAngle;
}

function auditAffiliateTargeting({ story = {}, existingLinks = null, tag = null } = {}) {
  const generated = buildAffiliateStack(story, { tag: tag || process.env.AMAZON_AFFILIATE_TAG || "placeholder" });
  const sourceLinks = Array.isArray(existingLinks) ? existingLinks : generated;
  const links = [];
  const rejections = [];
  const naturalAffiliate = naturallySupportsAffiliate(story);

  for (const raw of sourceLinks) {
    const safeUrl = normaliseAffiliateUrl(raw && raw.url);
    if (!safeUrl) {
      rejections.push({
        label: raw?.label || "unknown",
        url: raw?.url || null,
        reason: "unsafe_or_missing_affiliate_tag",
      });
      continue;
    }
    const candidate = {
      label: raw.label || "Related",
      url: safeUrl,
      query: raw.query || searchQueryFromAmazonUrl(safeUrl),
      category: raw.category || "related",
      reason: raw.reason || "existing",
    };
    const score = storySpecificScore(story, candidate, generated);
    const storySpecific = score > 0 && !/^fallback:/i.test(candidate.reason);
    if (!storySpecific) {
      rejections.push({
        label: candidate.label,
        url: candidate.url,
        reason: "not_story_specific",
      });
    }
    links.push({
      ...candidate,
      story_specific: storySpecific,
      relevance_score: score,
    });
  }

  if (!naturalAffiliate && links.length > 0) {
    rejections.push({
      label: "story",
      url: null,
      reason: "story_does_not_naturally_support_affiliate",
    });
  }

  const verdict = rejections.length === 0 && links.length > 0 ? "pass" : "review";
  return {
    story_id: story?.id || null,
    title: story?.title || "",
    verdict,
    disclosure_required: links.length > 0,
    disclosure_text: links.length > 0 ? "Disclosure: some links may be affiliate links." : null,
    links,
    rejections,
    generated_reference_links: generated,
  };
}

function buildSponsorMediaKitDraft(snapshot = {}) {
  const missing = SPONSOR_REQUIRED_METRICS.filter(
    (key) => snapshot[key] === undefined || snapshot[key] === null,
  );
  const ready =
    missing.length === 0 &&
    Number(snapshot.subscribers || 0) >= 5000 &&
    Number(snapshot.average_view_duration_seconds || 0) >= 28;
  return {
    ready_for_outreach: ready,
    headline: "Pulse Gaming - verified gaming news Shorts and future longform",
    public_metrics: {
      subscribers: snapshot.subscribers ?? null,
      shorts_views_90d: snapshot.shorts_views_90d ?? null,
      average_view_duration_seconds: snapshot.average_view_duration_seconds ?? null,
      average_view_percentage: snapshot.average_view_percentage ?? null,
      comments_per_view: snapshot.comments_per_view ?? null,
    },
    missing_metrics: missing,
    suitable_sponsor_categories: [
      "game launches",
      "hardware and peripherals",
      "gaming accessories",
      "storefront or subscription products",
    ],
    unsuitable_until_later: [
      "guaranteed CPM promises",
      "paid endorsements without disclosure",
      "sponsors that conflict with verified-news credibility",
    ],
    estimated_revenue: null,
  };
}

function firstYppBlocker(snapshotReport) {
  const blockers =
    snapshotReport.summary.ypp_early_access_blockers?.length
      ? snapshotReport.summary.ypp_early_access_blockers
      : snapshotReport.summary.ypp_blockers || [];
  return blockers[0] || "YPP subscriber threshold";
}

function buildRevenuePathReport(snapshot = {}) {
  const monetisation = buildMonetisationSnapshot(snapshot);
  const yppEligible = monetisation.summary.ypp_eligible;
  const yppEarlyAccessEligible = monetisation.summary.ypp_early_access_eligible;
  const affiliateLive = Boolean(snapshot.amazon_affiliate_tag);
  return {
    current_stage: yppEligible
      ? "full_ypp_ready_for_operator_review"
      : yppEarlyAccessEligible
        ? "expanded_ypp_ready_for_operator_review"
        : "pre_monetisation",
    next_monetisable_milestone: yppEligible
      ? "Operator full YPP review"
      : yppEarlyAccessEligible
        ? "Full YPP ad-revenue thresholds"
      : firstYppBlocker(monetisation),
    current_safe_paths: [
      ...(affiliateLive ? ["targeted affiliate links with disclosure"] : []),
      "newsletter waitlist",
      "blog SEO groundwork",
    ],
    what_not_to_monetise_yet: [
      "random affiliate links",
      "undisclosed sponsor claims",
      "TikTok Creator Rewards claims before account eligibility",
      "longform ads before YPP eligibility",
    ],
    risks: [
      "TikTok posting route still depends on platform approval or manual inbox workflow",
      "YouTube deep analytics requires the correct readonly scope before stronger learning claims",
      "Affiliate links must remain story-specific and disclosed",
    ],
    revenue_projection: null,
  };
}

function buildMonetisationReadiness({
  snapshot = {},
  stories = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const milestoneSnapshot = buildMonetisationSnapshot(snapshot);
  const affiliateAudits = stories.map((story) =>
    auditAffiliateTargeting({ story, tag: snapshot.amazon_affiliate_tag || "placeholder" }),
  );
  const sponsorMediaKit = buildSponsorMediaKitDraft(snapshot);
  const revenuePath = buildRevenuePathReport(snapshot);
  return {
    generated_at: generatedAt,
    sections: milestoneSnapshot.sections,
    summary: milestoneSnapshot.summary,
    affiliate_audits: affiliateAudits,
    sponsor_media_kit: sponsorMediaKit,
    revenue_path_report: revenuePath,
    safety: {
      no_fantasy_revenue_projection: true,
      no_live_account_changes: true,
      no_affiliate_links_published: true,
      no_sponsor_outreach_sent: true,
    },
  };
}

function renderMonetisationReadinessMarkdown(readiness) {
  const lines = [];
  lines.push("# Monetisation Overnight Report");
  lines.push("");
  lines.push(`Generated: ${readiness.generated_at}`);
  lines.push(`Cleared milestones: ${readiness.summary.cleared}/${readiness.summary.total_milestones}`);
  lines.push(`YPP eligible: ${readiness.summary.ypp_eligible}`);
  lines.push("");
  lines.push("## Revenue Path");
  lines.push("");
  lines.push(`Current stage: ${readiness.revenue_path_report.current_stage}`);
  lines.push(`Next milestone: ${readiness.revenue_path_report.next_monetisable_milestone}`);
  lines.push("Revenue projection: none. No fantasy revenue projection.");
  lines.push("");
  lines.push("## Affiliate Readiness");
  lines.push("");
  for (const audit of readiness.affiliate_audits) {
    lines.push(`- ${audit.title || audit.story_id}: ${audit.verdict}, links=${audit.links.length}, rejected=${audit.rejections.length}`);
  }
  lines.push("");
  lines.push("## Sponsor Media Kit");
  lines.push("");
  lines.push(`Ready for outreach: ${readiness.sponsor_media_kit.ready_for_outreach}`);
  lines.push(`Missing metrics: ${readiness.sponsor_media_kit.missing_metrics.join(", ") || "none"}`);
  lines.push("");
  lines.push("## What Not To Monetise Yet");
  lines.push("");
  for (const item of readiness.revenue_path_report.what_not_to_monetise_yet) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No live account changes");
  lines.push("- No affiliate links published by this report");
  lines.push("- No sponsor outreach sent");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  auditAffiliateTargeting,
  buildSponsorMediaKitDraft,
  buildRevenuePathReport,
  buildMonetisationReadiness,
  renderMonetisationReadinessMarkdown,
};
