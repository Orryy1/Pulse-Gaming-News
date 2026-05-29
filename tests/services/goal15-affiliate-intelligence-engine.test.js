"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCORE_DIMENSIONS,
  buildGoal15AffiliateIntelligenceEngine,
  writeGoal15AffiliateIntelligenceEngine,
} = require("../../lib/goal15-affiliate-intelligence-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const title = overrides.title || "Steam Deck OLED Deal Still Holds Up";
  const subject = overrides.subject || "Steam Deck OLED";
  const route = `/p/${storyId}`;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: title,
    canonical_title: title,
    canonical_subject: subject,
    primary_source: { name: "Steam News", url: "https://store.steampowered.com/news/example" },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    outputs: {
      youtube_shorts: {
        cta: "Story sources and related links are on the story page.",
        disclosure_status: { required: true, type: "affiliate", caption: "Affiliate links may earn us a commission." },
      },
      x: {
        landing_page_link: route,
        hot_take_post: "Steam Deck OLED remains a useful handheld benchmark.",
        poll_candidate: "Would this change your handheld shortlist?",
      },
    },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), overrides.affiliate || safeAffiliate(storyId, route));
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), overrides.landing || safeLanding(storyId, route));
  return { story_id: storyId, artifact_dir: artifactDir };
}

function safeAffiliate(storyId, route) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    story_id: storyId,
    vertical: "gaming",
    commercial_intent_type: "hardware_interest",
    primary_link: {
      id: "amazon_uk_steam_deck_oled",
      merchant: "Amazon UK",
      label: "Steam Deck OLED accessories",
      url: "https://www.amazon.co.uk/s?k=steam+deck+oled+accessories&tag=pulsegaming-21",
      tracking_url: `${route}?utm_source=story_page&utm_medium=affiliate&utm_campaign=${storyId}`,
      product_category: "gaming_accessory",
      story_relevance: 92,
      audience_fit: 88,
      merchant_trust: 91,
      commission_value: 65,
      conversion_likelihood: 73,
      availability: 82,
      geography_fit: 86,
      platform_suitability: 84,
      compliance_risk: 8,
      repetition_risk: 12,
      link_status: "ok",
      availability_status: "available",
      affiliate_score: 78,
      platform_tracking_urls: {
        youtube: `${route}?utm_source=youtube&utm_medium=social&utm_campaign=${storyId}`,
        x: `${route}?utm_source=x&utm_medium=social&utm_campaign=${storyId}`,
        instagram: `${route}?utm_source=instagram&utm_medium=social&utm_campaign=${storyId}`,
      },
    },
    fallback_links: [],
    merchant: "Amazon UK",
    product_category: "gaming_accessory",
    relevance_score: 92,
    audience_fit_score: 88,
    trust_score: 91,
    compliance_risk_score: 8,
    disclosure_required: true,
    disclosure_copy: { short: disclosure, landing: disclosure },
    platform_disclosure: {
      youtube: { affiliate_disclosure_required: true, caption_copy: disclosure },
      x: { affiliate_disclosure_required: true, caption_copy: disclosure },
      instagram: { affiliate_disclosure_required: true, caption_copy: disclosure },
    },
    platform_specific_ctas: {
      youtube: "Sources and related links are on the story page.",
      x: "Story page has sources and related links.",
      instagram: "Story page in bio.",
    },
    affiliate_tracking_map: {
      story_id: storyId,
      primary_offer_id: "amazon_uk_steam_deck_oled",
      story_page: `${route}?utm_source=story_page&utm_medium=affiliate&utm_campaign=${storyId}`,
      platforms: {
        youtube: `${route}?utm_source=youtube&utm_medium=social&utm_campaign=${storyId}`,
        x: `${route}?utm_source=x&utm_medium=social&utm_campaign=${storyId}`,
        instagram: `${route}?utm_source=instagram&utm_medium=social&utm_campaign=${storyId}`,
      },
    },
    landing_page_attribution: {
      story_id: storyId,
      verdict: "pass",
      platforms: {
        youtube: {
          tracking_key: `${storyId}:youtube:story_page`,
          landing_page_url: `${route}?utm_source=youtube&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
        x: {
          tracking_key: `${storyId}:x:story_page`,
          landing_page_url: `${route}?utm_source=x&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
        instagram: {
          tracking_key: `${storyId}:instagram:story_page`,
          landing_page_url: `${route}?utm_source=instagram&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
      },
    },
    revenue_attribution: {
      story_id: storyId,
      primary_offer_id: "amazon_uk_steam_deck_oled",
      platform_clicks: { youtube: 0, x: 0, instagram: 0 },
      landing_page_visits: 0,
      conversions: 0,
      revenue: { amount: 0, currency: "GBP", source: "waiting_for_affiliate_network_reporting" },
    },
    commercial_opportunity_score: 78,
    rejection_reasons: [],
  };
}

function safeLanding(storyId, route) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    story_id: storyId,
    landing_page_route: route,
    link_pack: {
      primary_link: null,
      fallback_links: [],
      source_links: [{ label: "Steam News", url: "https://store.steampowered.com/news/example" }],
    },
    disclosure_block: {
      required: true,
      copy: { short: disclosure, landing: disclosure },
      source_first: true,
    },
    attribution_manifest: {
      story_id: storyId,
      verdict: "pass",
      platforms: {
        youtube: {
          tracking_key: `${storyId}:youtube:story_page`,
          landing_page_url: `${route}?utm_source=youtube&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
        x: {
          tracking_key: `${storyId}:x:story_page`,
          landing_page_url: `${route}?utm_source=x&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
        instagram: {
          tracking_key: `${storyId}:instagram:story_page`,
          landing_page_url: `${route}?utm_source=instagram&utm_medium=social&utm_campaign=${storyId}`,
          disclosure_required: true,
          disclosure_copy: disclosure,
        },
      },
    },
  };
}

function blockedSocialReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["upstream:goal13_multi_platform_publisher_blocked"],
      },
    ],
  };
}

function readySocialReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "ready",
        blockers: [],
      },
    ],
  };
}

test("Goal 15 blocks full readiness when Goal 14 is blocked but preserves safe affiliate intelligence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-upstream-blocked-"));
  const story = await makeStoryPackage(root, "story-commercial");

  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [story],
    upstreamSocialReport: blockedSocialReport("story-commercial"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T02:06:35.510Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_affiliate_verdict, "PASS");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.direct_affiliate_pass_story_count, 1);
  assert.equal(report.summary.affiliate_ready_story_count, 0);
  assert.equal(report.summary.commercial_score_story_count, 1);
  assert.ok(report.stories[0].blockers.includes("upstream:goal14_social_derivatives_blocked"));
  assert.deepEqual(Object.keys(report.commercial_opportunity_score.stories[0].score_parts), SCORE_DIMENSIONS);
  assert.ok(report.affiliate_tracking_map.stories[0].platforms.youtube);
  assert.equal(report.disclosure_manifest.verdict, "pass");
  assert.equal(report.revenue_attribution.mode, "LOCAL_PROOF");
  assert.equal(report.revenue_attribution.stories[0].revenue.amount, 0);
  assert.equal(report.safety.no_network_link_checking, true);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);
});

test("Goal 15 hard-fails unsafe affiliate evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-hard-fail-"));
  const route = "/p/story-risk";
  const affiliate = safeAffiliate("story-risk", route);
  affiliate.vertical = "crypto";
  affiliate.relevance_score = 12;
  affiliate.primary_link.merchant = "Sketchy Casino";
  affiliate.primary_link.url = "ftp://dead.example/coin";
  affiliate.primary_link.story_relevance = 10;
  affiliate.primary_link.merchant_trust = 15;
  affiliate.primary_link.availability = 0;
  affiliate.primary_link.link_status = "dead";
  affiliate.primary_link.availability_status = "unavailable";
  affiliate.primary_link.relevance_verdict = "unrelated";
  affiliate.primary_link.cta = "Buy now with my link before this limited time deal disappears.";
  affiliate.primary_link.tracking_url = "";
  affiliate.primary_link.platform_tracking_urls = {};
  affiliate.disclosure_copy = { short: "", landing: "" };
  affiliate.platform_disclosure = {};
  affiliate.platform_specific_ctas = {
    youtube: "Buy now with my link.",
    x: "Shop now before the deal ends.",
  };
  affiliate.affiliate_tracking_map = { story_id: "story-risk", primary_offer_id: "unsafe", platforms: {} };
  await makeStoryPackage(root, "story-risk", { affiliate });

  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [{ story_id: "story-risk", artifact_dir: path.join(root, "story-risk") }],
    upstreamSocialReport: readySocialReport("story-risk"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T02:06:35.510Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].direct_affiliate_status, "blocked");
  for (const blocker of [
    "affiliate:unrelated_link",
    "affiliate:missing_disclosure",
    "affiliate:risky_merchant",
    "affiliate:dead_link",
    "affiliate:unavailable_product",
    "affiliate:finance_crypto_leakage",
    "affiliate:hard_sell_cta",
    "affiliate:missing_tracking",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
  }
  assert.equal(report.disclosure_manifest.verdict, "fail");
});

test("Goal 15 hard-fails stale affiliate offers that do not match the story subject", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-product-mismatch-"));
  const route = "/p/mario-rpg-deal";
  const affiliate = safeAffiliate("mario-rpg-deal", route);
  affiliate.commercial_intent_type = "racing_game_setup";
  affiliate.product_category = "racing wheel";
  affiliate.primary_link.id = "racing-wheel";
  affiliate.primary_link.label = "Racing wheel";
  affiliate.primary_link.query = "racing wheel PS5 Xbox PC";
  affiliate.primary_link.product_category = "racing wheel";
  affiliate.primary_link.category = "racing wheel";
  affiliate.primary_link.story_relevance = 92;
  affiliate.relevance_score = 92;

  await makeStoryPackage(root, "mario-rpg-deal", {
    title: "Super Mario RPG Drops To $15",
    subject: "Super Mario RPG",
    affiliate,
  });

  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [{ story_id: "mario-rpg-deal", artifact_dir: path.join(root, "mario-rpg-deal") }],
    upstreamSocialReport: readySocialReport("mario-rpg-deal"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-27T05:05:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].direct_affiliate_status, "blocked");
  assert.ok(report.stories[0].direct_affiliate_blockers.includes("affiliate:story_product_mismatch"));
  assert.equal(report.blocker_counts["affiliate:story_product_mismatch"], 1);
});

test("Goal 15 hard-fails racing offers caused only by incidental source-title wording", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-incidental-forza-"));
  const route = "/p/subnautica-leak";
  const affiliate = safeAffiliate("subnautica-leak", route);
  affiliate.commercial_intent_type = "racing_game_setup";
  affiliate.product_category = "racing wheel";
  affiliate.primary_link.id = "racing-wheel";
  affiliate.primary_link.label = "Racing wheel";
  affiliate.primary_link.query = "racing wheel PS5 Xbox PC";
  affiliate.primary_link.product_category = "racing wheel";
  affiliate.primary_link.category = "racing wheel";
  affiliate.primary_link.story_relevance = 92;
  affiliate.relevance_score = 92;

  await makeStoryPackage(root, "subnautica-leak", {
    title: "Subnautica 2 Reportedly Leaked Early",
    subject: "Subnautica 2",
    affiliate,
  });
  const canonicalPath = path.join(root, "subnautica-leak", "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  canonical.canonical_title =
    "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch";
  canonical.selected_title = "Subnautica 2 Reportedly Leaked Early";
  canonical.canonical_subject = "Subnautica 2";
  canonical.canonical_game = "Subnautica 2";
  canonical.canonical_angle = "racing_game_setup";
  canonical.confirmed_claims = ["Subnautica 2 reportedly appeared online before launch."];
  await fs.writeJson(canonicalPath, canonical, { spaces: 2 });

  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [{ story_id: "subnautica-leak", artifact_dir: path.join(root, "subnautica-leak") }],
    upstreamSocialReport: readySocialReport("subnautica-leak"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:50:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].direct_affiliate_status, "blocked");
  assert.ok(report.stories[0].direct_affiliate_blockers.includes("affiliate:story_product_mismatch"));
});

test("Goal 15 accepts link-level tracking when aggregate tracking maps are not backfilled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-link-level-tracking-"));
  const route = "/p/story-link-tracking";
  const affiliate = safeAffiliate("story-link-tracking", route);
  affiliate.affiliate_tracking_map = { story_id: "story-link-tracking", primary_offer_id: null, platforms: {} };
  await makeStoryPackage(root, "story-link-tracking", { affiliate });

  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [{ story_id: "story-link-tracking", artifact_dir: path.join(root, "story-link-tracking") }],
    upstreamSocialReport: readySocialReport("story-link-tracking"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T02:06:35.510Z",
  });

  assert.equal(report.direct_affiliate_verdict, "PASS");
  assert.equal(report.blocker_counts["affiliate:missing_tracking"], undefined);
  assert.equal(report.affiliate_tracking_map.stories[0].story_page, affiliate.primary_link.tracking_url);
  assert.ok(report.affiliate_tracking_map.stories[0].platforms.youtube);
});

test("Goal 15 excludes upstream-skipped stories from active affiliate blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-skipped-"));
  const readyStory = await makeStoryPackage(root, "story-ready");
  const skippedStory = await makeStoryPackage(root, "story-skipped", {
    affiliate: null,
  });

  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [readyStory, skippedStory],
    upstreamSocialReport: {
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [] },
        {
          story_id: "story-skipped",
          status: "skipped",
          skipped_status: "visual_source_deferred",
          skipped_reason: "defer_until_rights_backed_media_available",
          blockers: [],
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T00:30:00.000Z",
  });

  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_affiliate_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.affiliate_ready_story_count, 1);
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
  assert.equal(report.disclosure_manifest.stories.length, 1);
  assert.equal(report.affiliate_link_manifest.stories.length, 1);
});

test("Goal 15 writes required affiliate intelligence artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal15AffiliateIntelligenceEngine({
    storyPackages: [story],
    upstreamSocialReport: blockedSocialReport("story-write"),
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T02:06:35.510Z",
  });

  const written = await writeGoal15AffiliateIntelligenceEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.affiliateLinkManifest), true);
  assert.equal(await fs.pathExists(written.commercialOpportunityScore), true);
  assert.equal(await fs.pathExists(written.disclosureManifest), true);
  assert.equal(await fs.pathExists(written.affiliateTrackingMap), true);
  assert.equal(await fs.pathExists(written.revenueAttribution), true);
});
