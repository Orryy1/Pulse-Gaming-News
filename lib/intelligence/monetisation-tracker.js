"use strict";

/**
 * lib/intelligence/monetisation-tracker.js — Session 3 (intelligence pass).
 *
 * Milestone-based monetisation tracker. NO fantasy revenue numbers.
 * Each milestone is a gate the channel either has or has not crossed,
 * with an evidence pointer and a clearly-stated unlock path.
 *
 * Monetisation is grouped into:
 *
 *   1. YouTube Partner Programme (YPP) — subscriber + Shorts and
 *      long-form watch-hour paths. Three trackers; ONE of the two
 *      watch paths needs to clear, plus the subscriber threshold.
 *   2. Affiliate readiness — already live (Amazon UK).
 *   3. Newsletter readiness — Beehiiv/Substack live.
 *   4. Blog/SEO readiness — emerging.
 *   5. Sponsorship/media-kit readiness — gated on retention + AVD,
 *      not raw views.
 *   6. TikTok Creator Rewards — gated on the TikTok-account-route
 *      decision (Session 1 said the API path is dead).
 */

const YPP_THRESHOLDS = {
  subscribers: { value: 1000, path: "youtube_partner_programme" },
  shorts_views_90d: {
    value: 10_000_000,
    path: "youtube_partner_programme_shorts",
  },
  longform_watch_hours_12m: {
    value: 4_000,
    path: "youtube_partner_programme_longform",
  },
};

const TIKTOK_CREATOR_REWARDS = {
  followers: { value: 10_000, path: "tiktok_creator_rewards" },
  views_30d: { value: 100_000, path: "tiktok_creator_rewards" },
  videos_min: 1,
};

function milestone({
  key,
  label,
  current,
  threshold,
  unit = null,
  unlockPath,
  notes = [],
  blockers = [],
}) {
  const c = Number(current || 0);
  const t = Number(threshold || 0);
  const ratio = t > 0 ? c / t : 0;
  return {
    milestone_key: key,
    milestone_label: label,
    threshold_kind: unit || "count",
    current_value: c,
    threshold_value: t,
    progress_ratio: Number(ratio.toFixed(3)),
    progress_percent: Math.min(100, Math.round(ratio * 100)),
    cleared: c >= t && t > 0,
    unlock_path: unlockPath,
    notes,
    blockers,
  };
}

function trackYPP(snapshot = {}) {
  const subs = snapshot.subscribers ?? 0;
  const shorts = snapshot.shorts_views_90d ?? 0;
  const longform = snapshot.longform_watch_hours_12m ?? 0;
  const items = [
    milestone({
      key: "ypp_subscribers",
      label: "YPP subscriber threshold",
      current: subs,
      threshold: YPP_THRESHOLDS.subscribers.value,
      unit: "subscribers",
      unlockPath: YPP_THRESHOLDS.subscribers.path,
      notes: [
        "YPP requires the subscriber threshold AND ONE of the watch-path thresholds (Shorts 10M/90d OR long-form 4,000 watch hours/12m).",
      ],
    }),
    milestone({
      key: "ypp_shorts_path",
      label: "Shorts 10M views / 90 days",
      current: shorts,
      threshold: YPP_THRESHOLDS.shorts_views_90d.value,
      unit: "views",
      unlockPath: YPP_THRESHOLDS.shorts_views_90d.path,
      notes: [
        "Tracker reads from snapshot.shorts_views_90d. Real ingestion is fixture mode until yt-analytics.readonly scope is granted.",
      ],
    }),
    milestone({
      key: "ypp_longform_path",
      label: "Long-form 4,000 watch hours / 12 months",
      current: longform,
      threshold: YPP_THRESHOLDS.longform_watch_hours_12m.value,
      unit: "hours",
      unlockPath: YPP_THRESHOLDS.longform_watch_hours_12m.path,
      notes: [
        "Daily Briefing and Weekly Roundup formats from the Session 2 catalogue feed this path.",
      ],
    }),
  ];
  const subsCleared = items[0].cleared;
  const watchCleared = items[1].cleared || items[2].cleared;
  return {
    items,
    yppEligible: subsCleared && watchCleared,
    blockers: [
      ...(subsCleared ? [] : [items[0].milestone_label]),
      ...(watchCleared
        ? []
        : [`${items[1].milestone_label} OR ${items[2].milestone_label}`]),
    ],
  };
}

function trackTikTokCreatorRewards(snapshot = {}) {
  return {
    items: [
      milestone({
        key: "tt_followers",
        label: "TikTok 10k follower threshold",
        current: snapshot.tiktok_followers ?? 0,
        threshold: TIKTOK_CREATOR_REWARDS.followers.value,
        unit: "followers",
        unlockPath: TIKTOK_CREATOR_REWARDS.followers.path,
        notes: [
          "Pulse cannot yet auto-publish to TikTok — direct API was rejected at audit, Buffer's developer API is closed for new accounts (Session 1 §E). Tracker structurally exists; growth path requires manual posting until route resolves.",
        ],
      }),
      milestone({
        key: "tt_views_30d",
        label: "TikTok 100k views / 30 days",
        current: snapshot.tiktok_views_30d ?? 0,
        threshold: TIKTOK_CREATOR_REWARDS.views_30d.value,
        unit: "views",
        unlockPath: TIKTOK_CREATOR_REWARDS.views_30d.path,
        notes: ["Same posting blocker as the follower threshold."],
      }),
    ],
  };
}

function trackAffiliate(snapshot = {}) {
  const haveTag = !!snapshot.amazon_affiliate_tag;
  return {
    items: [
      milestone({
        key: "affiliate_amazon_uk",
        label: "Amazon UK affiliate tag live",
        current: haveTag ? 1 : 0,
        threshold: 1,
        unit: "binary",
        unlockPath: "affiliate_amazon",
        notes: [
          "Tag is appended to product links by the existing affiliates.js — see CLAUDE.md.",
          "The earnings rate depends on category, not tracked here.",
        ],
      }),
    ],
  };
}

function trackNewsletter(snapshot = {}) {
  return {
    items: [
      milestone({
        key: "newsletter_beehiiv",
        label: "Beehiiv newsletter live",
        current: snapshot.beehiiv_subscribers ?? 0,
        threshold: 100,
        unit: "subscribers",
        unlockPath: "newsletter_sponsorship",
        notes: [
          "Threshold is the practical floor for sponsor interest. Real subscribers count when an operator wires Beehiiv API into the pipeline.",
        ],
      }),
      milestone({
        key: "newsletter_substack",
        label: "Substack newsletter live",
        current: snapshot.substack_subscribers ?? 0,
        threshold: 100,
        unit: "subscribers",
        unlockPath: "newsletter_sponsorship",
        notes: ["Same threshold as Beehiiv."],
      }),
    ],
  };
}

function trackBlogSeo(snapshot = {}) {
  return {
    items: [
      milestone({
        key: "blog_indexed_pages",
        label: "Blog has indexed pages",
        current: snapshot.indexed_pages ?? 0,
        threshold: 30,
        unit: "pages",
        unlockPath: "search_traffic",
      }),
      milestone({
        key: "blog_monthly_pageviews",
        label: "Blog monthly pageviews",
        current: snapshot.blog_monthly_pageviews ?? 0,
        threshold: 5_000,
        unit: "pageviews",
        unlockPath: "search_ad_revenue",
      }),
    ],
  };
}

function trackSponsorship(snapshot = {}) {
  return {
    items: [
      milestone({
        key: "sponsor_avd",
        label: "Average view duration ≥ 28s on Shorts",
        current: snapshot.avd_seconds_shorts ?? 0,
        threshold: 28,
        unit: "seconds",
        unlockPath: "sponsorship_eligibility",
        notes: [
          "Sponsors care about completion, not raw views. 28s is a practical floor for 50s Shorts.",
        ],
      }),
      milestone({
        key: "sponsor_subscribers",
        label: "Subscribers ≥ 5,000 for first sponsor outreach",
        current: snapshot.subscribers ?? 0,
        threshold: 5_000,
        unit: "subscribers",
        unlockPath: "sponsorship_eligibility",
        notes: [
          "5k is conventional minimum for paid sponsorships in gaming. Below 5k, prefer affiliate revenue.",
        ],
      }),
    ],
  };
}

function buildMonetisationSnapshot(stateSnapshot = {}) {
  const sections = {
    youtube_partner_programme: trackYPP(stateSnapshot),
    affiliate: trackAffiliate(stateSnapshot),
    newsletter: trackNewsletter(stateSnapshot),
    blog_seo: trackBlogSeo(stateSnapshot),
    sponsorship: trackSponsorship(stateSnapshot),
    tiktok_creator_rewards: trackTikTokCreatorRewards(stateSnapshot),
  };
  const allItems = Object.values(sections).flatMap((s) => s.items);
  const cleared = allItems.filter((i) => i.cleared).length;
  return {
    sections,
    summary: {
      total_milestones: allItems.length,
      cleared,
      remaining: allItems.length - cleared,
      ypp_eligible: !!sections.youtube_partner_programme.yppEligible,
      ypp_blockers: sections.youtube_partner_programme.blockers,
    },
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildMonetisationSnapshot,
  trackYPP,
  trackAffiliate,
  trackNewsletter,
  trackBlogSeo,
  trackSponsorship,
  trackTikTokCreatorRewards,
  YPP_THRESHOLDS,
  TIKTOK_CREATOR_REWARDS,
};
