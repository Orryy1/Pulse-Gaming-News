"use strict";

/**
 * lib/intelligence/tiktok-strategy.js — Session 3 (intelligence pass).
 *
 * Read-only strategy ranker. Encodes the five TikTok automation
 * routes the prompt asks Pulse to evaluate, with structured ratings
 * across the dimensions that matter operationally (same-day
 * breaking-news suitability, mobile confirmation requirement,
 * account risk, etc.).
 *
 * No posting, no OAuth, no browser automation. This module is text
 * only — it produces a ranked recommendation that an operator reads.
 */

const ROUTES = [
  {
    id: "official_api_reapply_business",
    label: "Re-apply to TikTok official API as a media/business app",
    sameDayBreakingNews: "yes (auto-publish)",
    personalAccountCompatible: "no — requires migration to Business",
    creatorRewardsImplications:
      "Business accounts are not eligible for Creator Rewards in many regions. Confirm with TikTok before migrating.",
    sixtySecPlusSupport: "yes",
    mobileConfirmationRequired: "no for Business; yes for Personal",
    accountRisk: "low (sanctioned route)",
    cost: "free, plus the time cost of the audit cycle",
    reliability: "high once approved",
    pulseFeed: "Existing render output; reuses upload_tiktok.js scaffold",
    blockers: [
      "Pulse Gaming was rejected as personal-use. The re-apply must be from a registered business or media entity, with a public-facing site/app.",
      "Audit cycles take weeks.",
    ],
    rank: 1,
    rationale:
      "If Pulse can reasonably present as a media/news entity with a public site (PulseGaming.news / blog), this is the only durable path.",
  },
  {
    id: "third_party_scheduler_with_auto_publish",
    label: "Third-party scheduler with TRUE auto-publish (no manual confirm)",
    sameDayBreakingNews: "yes (depends on the tool)",
    personalAccountCompatible:
      "varies by tool — Buffer, Sprinklr, Sprout, Loomly, Metricool",
    creatorRewardsImplications:
      "Same as direct posting — being inside the Creator Rewards programme is independent of who pushes the post.",
    sixtySecPlusSupport: "yes (most tools)",
    mobileConfirmationRequired: "no",
    accountRisk:
      "low/medium — depends on whether the tool holds an audited TikTok app",
    cost: "varies — Buffer free tier limited, paid tiers $5-$15/mo per channel typically",
    reliability: "medium-high",
    pulseFeed: "Render output uploaded via the tool's API or scheduled UI",
    blockers: [
      "Buffer's developer API is closed for new accounts (Session 1 §E).",
      "Other vendors must be evaluated per-channel for genuine no-confirmation auto-publish — many quietly fall back to mobile-confirm.",
      "Vendor lock-in.",
    ],
    rank: 2,
    rationale:
      "Realistic short-term route while the official audit progresses. Specifically check whether the vendor's Personal-account flow truly auto-publishes without a phone tap.",
  },
  {
    id: "phone_friendly_approval_dispatch",
    label:
      "Phone-friendly approval/dispatch — Pulse renders, operator approves on mobile",
    sameDayBreakingNews: "yes if operator is reachable; otherwise breaks SLA",
    personalAccountCompatible: "yes",
    creatorRewardsImplications: "compatible (Personal account)",
    sixtySecPlusSupport: "yes",
    mobileConfirmationRequired: "yes (one tap to publish)",
    accountRisk: "very low (operator initiates)",
    cost: "operator time only",
    reliability: "high when operator is reachable",
    pulseFeed:
      "Render output served from Pulse via signed URL; operator opens link on phone, confirms, posts via TikTok app.",
    blockers: [
      "Operator availability — breaks if the operator is offline.",
      "Daily volume cap — phone friction limits throughput.",
    ],
    rank: 3,
    rationale:
      "Practical fallback when the operator can spend 30 seconds on approving. Pairs well with route #1 or #2 as a safety net.",
  },
  {
    id: "browser_rpa_automation",
    label: "Browser/RPA automation against the TikTok web creator UI",
    sameDayBreakingNews: "yes — but UI brittleness means failures",
    personalAccountCompatible: "yes (it IS a Personal-account flow)",
    creatorRewardsImplications:
      "compatible if it doesn't trip TikTok's bot detection",
    sixtySecPlusSupport: "yes",
    mobileConfirmationRequired: "no (it's a desktop browser flow)",
    accountRisk:
      "high — TikTok's terms forbid automated access; account suspension possible",
    cost: "engineering + a persistent browser profile + a hosted browser",
    reliability: "low-medium; UI changes break selectors",
    pulseFeed: "Render output → scripted UI flow",
    blockers: [
      "Account ban risk.",
      "Brave/Chrome profile requirement (Session 1 § confirmed Pulse has this locally only).",
      "TikTok bot detection has been increasingly aggressive.",
    ],
    rank: 4,
    rationale:
      "Research-only. Do not build for daily breaking-news cadence. If used at all, run against a burner account, never the main channel.",
  },
  {
    id: "virtual_assistant",
    label: "Virtual assistant manually posting renders to the TikTok app",
    sameDayBreakingNews: "yes if VA is on shift",
    personalAccountCompatible: "yes",
    creatorRewardsImplications: "compatible",
    sixtySecPlusSupport: "yes",
    mobileConfirmationRequired: "yes",
    accountRisk: "very low",
    cost: "$8-$25/hr depending on region; ~10-20 minutes per video",
    reliability: "high during VA hours, zero outside",
    pulseFeed: "Render output → shared drive → VA picks up + posts",
    blockers: [
      "Cost.",
      "Latency.",
      "Account-sharing concerns — VA needs login access to the TikTok account.",
    ],
    rank: 5,
    rationale: "Last resort. Only justifiable if every other route is blocked.",
  },
];

function listRoutes() {
  return ROUTES.map((r) => ({ ...r }));
}

function rankRoutesForBreakingNews() {
  // Prioritise auto-publish routes, then mobile-friendly, then VA.
  return ROUTES.slice().sort((a, b) => a.rank - b.rank);
}

function recommend({
  canMigrateToBusiness = false,
  hasOperatorOnPhone = true,
} = {}) {
  const routes = rankRoutesForBreakingNews();
  const out = {
    primaryRecommendation: null,
    fallback: null,
    rejected: [],
    notes: [],
  };
  if (canMigrateToBusiness) {
    out.primaryRecommendation = routes.find(
      (r) => r.id === "official_api_reapply_business",
    );
    out.fallback = routes.find(
      (r) => r.id === "third_party_scheduler_with_auto_publish",
    );
    out.notes.push(
      "Confirm Creator Rewards status under Business account before migrating — the account-type change is one-way in some regions.",
    );
  } else if (hasOperatorOnPhone) {
    out.primaryRecommendation = routes.find(
      (r) => r.id === "third_party_scheduler_with_auto_publish",
    );
    out.fallback = routes.find(
      (r) => r.id === "phone_friendly_approval_dispatch",
    );
    out.notes.push(
      "Buffer's developer API is closed for new accounts. Evaluate Sprinklr/Sprout/Loomly/Metricool for true auto-publish on Personal accounts.",
    );
  } else {
    out.primaryRecommendation = routes.find(
      (r) => r.id === "phone_friendly_approval_dispatch",
    );
    out.fallback = routes.find((r) => r.id === "virtual_assistant");
    out.notes.push(
      "Without a reachable operator, the throughput floor drops by a factor of 5-10. Resolve operator availability before scaling cadence.",
    );
  }
  out.rejected = routes
    .filter(
      (r) =>
        r.id !== out.primaryRecommendation?.id &&
        r.id !== out.fallback?.id &&
        r.id !== "browser_rpa_automation",
    )
    .map((r) => ({
      id: r.id,
      reason: "lower rank for current operator profile",
    }));
  out.rejected.push({
    id: "browser_rpa_automation",
    reason:
      "TikTok's terms forbid automated access — account ban risk. Do not build for daily breaking news.",
  });
  return out;
}

module.exports = {
  ROUTES,
  listRoutes,
  rankRoutesForBreakingNews,
  recommend,
};
