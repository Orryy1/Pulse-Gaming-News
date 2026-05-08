"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  auditAffiliateTargeting,
  buildSponsorMediaKitDraft,
  buildRevenuePathReport,
  buildMonetisationReadiness,
  renderMonetisationReadinessMarkdown,
} = require("../../lib/intelligence/monetisation-readiness");
const {
  FIXTURE_STATE,
  renderMonetisationMarkdown,
} = require("../../tools/intelligence/run-monetisation-snapshot");

test("affiliate audit accepts relevant Amazon links with disclosure", () => {
  const audit = auditAffiliateTargeting({
    story: {
      id: "pokemon-go",
      title: "Mega Mewtwo's Pokémon Go debut gets a confirmed date",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(audit.verdict, "pass");
  assert.equal(audit.disclosure_required, true);
  assert.ok(audit.links.length > 0);
  assert.ok(audit.links.every((link) => link.url.includes("tag=pulsegaming-21")));
  assert.ok(audit.links.every((link) => link.story_specific));
});

test("affiliate audit rejects unsafe and random links", () => {
  const audit = auditAffiliateTargeting({
    story: { id: "policy", title: "Platform policy update changes account rules" },
    existingLinks: [
      { label: "Random", url: "https://www.amazon.co.uk/s?k=coffee&tag=pulse-21" },
      { label: "Unsafe", url: "javascript:alert(1)" },
    ],
  });

  assert.equal(audit.verdict, "review");
  assert.ok(audit.rejections.some((item) => item.reason === "not_story_specific"));
  assert.ok(audit.rejections.some((item) => item.reason === "unsafe_or_missing_affiliate_tag"));
});

test("affiliate audit keeps platform policy stories in review without a product angle", () => {
  const audit = auditAffiliateTargeting({
    story: {
      id: "policy",
      title: "Xbox platform policy update changes account rules",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(audit.verdict, "review");
  assert.ok(audit.rejections.some((item) => item.reason === "story_does_not_naturally_support_affiliate"));
});

test("sponsor media-kit draft marks missing metrics instead of inventing them", () => {
  const draft = buildSponsorMediaKitDraft({
    subscribers: 320,
    shorts_views_90d: 28000,
  });

  assert.ok(draft.missing_metrics.includes("average_view_duration_seconds"));
  assert.ok(draft.missing_metrics.includes("average_view_percentage"));
  assert.equal(draft.ready_for_outreach, false);
  assert.equal(draft.estimated_revenue, null);
});

test("revenue path report names the next milestone without fantasy projections", () => {
  const report = buildRevenuePathReport({
    subscribers: 320,
    shorts_views_90d: 28000,
    longform_watch_hours_12m: 4,
    amazon_affiliate_tag: "pulsegaming-21",
  });

  assert.equal(report.current_stage, "pre_monetisation");
  assert.match(report.next_monetisable_milestone, /Expanded YPP 500 subscribers|YPP subscriber threshold|Shorts 10M/);
  assert.ok(report.what_not_to_monetise_yet.includes("random affiliate links"));
  assert.equal(report.revenue_projection, null);
});

test("monetisation readiness report includes all required sections", () => {
  const readiness = buildMonetisationReadiness({
    snapshot: {
      subscribers: 320,
      shorts_views_90d: 28000,
      longform_watch_hours_12m: 4,
      amazon_affiliate_tag: "pulsegaming-21",
      tiktok_followers: 0,
      tiktok_views_30d: 0,
    },
    stories: [
      { id: "pokemon-go", title: "Pokemon Go Plus update confirmed" },
      { id: "gta6", title: "GTA 6 trailer evidence still unconfirmed" },
    ],
    generatedAt: "2026-05-06T22:05:00.000Z",
  });
  const markdown = renderMonetisationReadinessMarkdown(readiness);

  assert.ok(readiness.sections.youtube_partner_programme);
  assert.ok(readiness.affiliate_audits.length >= 2);
  assert.ok(readiness.sponsor_media_kit);
  assert.match(markdown, /Monetisation Overnight Report/);
  assert.match(markdown, /No fantasy revenue projection/);
});

test("monetisation snapshot markdown is encoding-clean and keeps Pokémon spelling", () => {
  const snapshot = {
    generated_at: "2026-05-06T23:00:00.000Z",
    summary: {
      cleared: 1,
      total_milestones: 12,
      ypp_eligible: false,
      ypp_blockers: ["YPP subscriber threshold"],
    },
    sections: {
      affiliate: {
        items: [
          {
            milestone_label: "Pokémon affiliate disclosure",
            current_value: 1,
            threshold_value: 1,
            progress_percent: 100,
            cleared: true,
            unlock_path: "affiliate_amazon",
            notes: ["Pokémon Go links require disclosure"],
          },
        ],
      },
    },
  };
  const tiktok = {
    primaryRecommendation: { label: "Official inbox", rationale: "Safe manual completion." },
    fallback: { label: "Phone workflow", rationale: "No browser automation." },
    rejected: [],
    notes: ["No live post"],
  };
  const markdown = renderMonetisationMarkdown(snapshot, tiktok);

  assert.equal(FIXTURE_STATE.amazon_affiliate_tag, "pulsegaming-21");
  assert.match(markdown, /Pokémon/);
  assert.doesNotMatch(markdown, /â|Â|PokÃ/);
});
