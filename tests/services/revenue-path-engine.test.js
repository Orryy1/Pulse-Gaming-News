"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  buildAffiliateLinkManifest,
  writeAffiliateLinkManifest,
} = require("../../lib/commercial-intelligence-engine");
const {
  buildCommercialLearningDigest,
} = require("../../lib/intelligence/commercial-learning-loop");
const {
  applyAffiliateAuditToStory,
} = require("../../affiliates");
const {
  buildRevenuePathDigest,
  buildRevenuePathManifest,
  renderRevenuePathDigestMarkdown,
  runRevenuePathEngine,
  writeRevenuePathManifest,
} = require("../../lib/revenue-path-engine");
const { parseArgs: parseRevenuePathArgs } = require("../../tools/revenue-paths");

test("Revenue Path Engine v2 builds an editorial path from Short to story page to tracked offer", () => {
  const story = {
    id: "forza-commercial",
    title: "Forza Horizon 6 Steam Numbers Skyrocket",
    full_script:
      "Forza Horizon 6 just hit 130,000 concurrent Steam players. The useful angle is setup: racing wheels, Xbox controllers and Game Pass routes.",
    youtube_post_id: "yt_forza",
    youtube_views: 1200,
  };
  const commercialManifest = buildAffiliateLinkManifest({
    story,
    tag: "pulsegaming-21",
    generatedAt: "2026-05-19T09:00:00.000Z",
  });
  const learningDigest = buildCommercialLearningDigest({
    clicks: [
      click("forza-commercial", commercialManifest.primary_link.id, "youtube", "story_page"),
      click("forza-commercial", commercialManifest.primary_link.id, "youtube", "story_page"),
      click("forza-commercial", commercialManifest.primary_link.id, "tiktok", "story_page"),
    ],
    manifests: [commercialManifest],
    stories: [story],
    generatedAt: "2026-05-19T10:00:00.000Z",
  });

  const manifest = buildRevenuePathManifest({
    story,
    commercialManifest,
    learningDigest,
    generatedAt: "2026-05-19T11:00:00.000Z",
  });

  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.engine, "revenue_path_engine_v2");
  assert.equal(manifest.story_id, "forza-commercial");
  assert.equal(manifest.audience_strategy.core_audience, "male_25_44_uk_us_mobile");
  assert.equal(manifest.path_gate.verdict, "pass");
  assert.equal(manifest.primary_path.path_type, "editorial_short_to_story_page_to_tracked_offer");
  assert.deepEqual(
    manifest.primary_path.stages.map((stage) => stage.stage),
    [
      "short",
      "story_page",
      "tracked_offer",
      "newsletter_capture",
      "evergreen_guide",
      "sponsor_readiness",
    ],
  );
  assert.ok(manifest.revenue_path_score >= 75);
  assert.equal(manifest.learning_signal.commercial_angle_lift, "positive");
  assert.match(manifest.next_render_adjustments[0].prompt_adjustment, /setup/i);
  assert.match(manifest.platform_ctas.youtube, /story page/i);
  assert.doesNotMatch(manifest.platform_ctas.youtube, /buy now|like and subscribe/i);
  assert.equal(manifest.tracking.landing_page_attribution.verdict, "pass");
  assert.match(manifest.tracking.platforms.youtube.landing_page_url, /utm_source=youtube/);
  assert.equal(manifest.safety.no_fantasy_revenue_projection, true);
  assert.equal(manifest.revenue_projection, null);
});

test("Revenue Path Engine v2 reviews tracked offers that lack landing-page attribution", () => {
  const story = {
    id: "forza-missing-attribution",
    title: "Forza Horizon 6 Steam Numbers Skyrocket",
    full_script: "Forza players are comparing racing wheel and Xbox controller setups.",
  };
  const commercialManifest = buildAffiliateLinkManifest({
    story,
    tag: "pulsegaming-21",
  });
  delete commercialManifest.landing_page_attribution;

  const manifest = buildRevenuePathManifest({
    story,
    commercialManifest,
  });

  assert.equal(manifest.path_gate.verdict, "review");
  assert.ok(manifest.path_gate.blockers.includes("missing_landing_page_attribution"));
});

test("Revenue Path Engine v2 throttles commercial framing when retention is below channel targets", () => {
  const story = {
    id: "forza-retention-first",
    title: "Forza Horizon 6 Steam Numbers Skyrocket",
    full_script:
      "Forza Horizon 6 just hit 130,000 concurrent Steam players. The setup angle is racing wheels, Xbox controllers and Game Pass routes.",
  };
  const commercialManifest = buildAffiliateLinkManifest({
    story,
    tag: "pulsegaming-21",
    generatedAt: "2026-05-20T04:20:00.000Z",
  });

  const manifest = buildRevenuePathManifest({
    story,
    commercialManifest,
    retentionIntelligence: {
      verdict: "needs_render_adjustment",
      hook: { score: 66 },
      visual_pacing: { score: 63 },
      channel_pressure: {
        status: "retention_baseline_under_target",
        baseline: {
          stayed_to_watch: 39.3,
          swiped_away: 60.7,
          avg_watch_seconds_estimate: 10.8,
          mobile_share: 71.4,
        },
      },
    },
    generatedAt: "2026-05-20T04:21:00.000Z",
  });

  assert.equal(manifest.path_gate.verdict, "pass");
  assert.equal(manifest.retention_commercial_policy.status, "retention_first");
  assert.equal(manifest.retention_commercial_policy.short_commercial_posture, "editorial_only");
  assert.equal(manifest.retention_commercial_policy.story_page_offer_position, "below_sources");
  assert.ok(manifest.retention_commercial_policy.reasons.includes("channel_retention_under_target"));
  assert.ok(manifest.revenue_path_score < 90);
  assert.match(manifest.next_render_adjustments[0].prompt_adjustment, /commercial path on the story page/i);
  assert.doesNotMatch(manifest.platform_ctas.youtube, /buy now|deal/i);
});

test("Revenue Path Engine v2 keeps policy and crypto stories source-first", () => {
  const policyManifest = buildAffiliateLinkManifest({
    story: {
      id: "xbox-policy",
      title: "Xbox account verification policy changes",
      full_script:
        "Xbox account verification policy changed without a product, hardware, subscription or game purchase angle.",
    },
    tag: "pulsegaming-21",
  });

  const policyPath = buildRevenuePathManifest({
    story: { id: "xbox-policy", title: "Xbox account verification policy changes" },
    commercialManifest: policyManifest,
  });

  assert.equal(policyPath.path_gate.verdict, "review");
  assert.ok(policyPath.path_gate.blockers.includes("no_tracked_affiliate_offer"));
  assert.equal(policyPath.primary_path.path_type, "editorial_short_to_story_page_to_newsletter");
  assert.equal(policyPath.offer_stack.primary_offer, null);
  assert.match(policyPath.platform_ctas.youtube, /sources and context/i);

  const cryptoManifest = buildAffiliateLinkManifest({
    story: {
      id: "crypto-risk",
      title: "Bitcoin leverage exchange promotion claims guaranteed upside",
      full_script:
        "A crypto exchange is pushing leverage and price prediction hype. The story needs source links and risk notes, not a buy or sell recommendation.",
      channel_id: "stacked",
    },
    tag: "pulsegaming-21",
  });

  const cryptoPath = buildRevenuePathManifest({
    story: { id: "crypto-risk", title: "Bitcoin leverage exchange promotion claims guaranteed upside" },
    commercialManifest: cryptoManifest,
  });

  assert.equal(cryptoPath.path_gate.verdict, "blocked_for_compliance");
  assert.ok(cryptoPath.path_gate.blockers.includes("finance_or_crypto_compliance_review_required"));
  assert.equal(cryptoPath.offer_stack.primary_offer, null);
  assert.match(cryptoPath.platform_ctas.youtube, /No buy\/sell recommendation/);
});

test("Revenue Path Engine v2 writes manifests and reports without mutating publishing state", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-revenue-path-"));
  const manifestDir = path.join(tmp, "commercial");
  const outputDir = path.join(tmp, "revenue");
  const commercialManifest = buildAffiliateLinkManifest({
    story: {
      id: "steam-deck-oled",
      title: "Steam Deck OLED deal gets a useful storage catch",
      full_script: "Steam Deck OLED storage and microSD choices are the practical part.",
      youtube_views: 600,
    },
    tag: "pulsegaming-21",
  });
  await writeAffiliateLinkManifest(commercialManifest, { outputDir: manifestDir });

  const revenueManifest = buildRevenuePathManifest({
    story: { id: "steam-deck-oled", title: "Steam Deck OLED deal gets a useful storage catch" },
    commercialManifest,
  });
  const written = await writeRevenuePathManifest(revenueManifest, { outputDir });
  const parsed = await fs.readJson(written.path);

  assert.equal(path.basename(written.path), "steam-deck-oled_revenue_path_manifest.json");
  assert.equal(parsed.story_id, "steam-deck-oled");

  const result = await runRevenuePathEngine({
    commercialManifestDirs: [manifestDir],
    outputDir,
    stories: [{ id: "steam-deck-oled", title: "Steam Deck OLED deal gets a useful storage catch" }],
    generatedAt: "2026-05-19T12:00:00.000Z",
  });

  assert.equal(result.digest.schema_version, 2);
  assert.equal(result.digest.totals.paths, 1);
  assert.equal(result.digest.safety.no_story_rows_mutated, true);
  assert.match(await fs.readFile(result.artefacts.mdPath, "utf8"), /Revenue Path Engine v2/);
  assert.match(renderRevenuePathDigestMarkdown(result.digest), /No fantasy revenue projection/);
});

test("Revenue Path Engine v2 can apply retention intelligence from the operator runner", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-revenue-retention-"));
  const manifestDir = path.join(tmp, "commercial");
  const outputDir = path.join(tmp, "revenue");
  const story = {
    id: "forza-retention-runner",
    title: "Forza Horizon 6 Steam Numbers Skyrocket",
    full_script: "Forza players are comparing racing wheel and Xbox controller setups.",
  };
  const commercialManifest = buildAffiliateLinkManifest({
    story,
    tag: "pulsegaming-21",
  });
  await writeAffiliateLinkManifest(commercialManifest, { outputDir: manifestDir });

  const result = await runRevenuePathEngine({
    commercialManifestDirs: [manifestDir],
    outputDir,
    stories: [story],
    retentionIntelligenceByStory: {
      "forza-retention-runner": {
        verdict: "needs_render_adjustment",
        hook: { score: 61 },
        visual_pacing: { score: 68 },
        channel_pressure: {
          status: "retention_baseline_under_target",
          baseline: { stayed_to_watch: 39.3, swiped_away: 60.7 },
        },
      },
    },
    generatedAt: "2026-05-20T04:29:00.000Z",
  });

  assert.equal(result.manifests[0].retention_commercial_policy.status, "retention_first");
  assert.equal(result.manifests[0].revenue_path_score < 90, true);

  const args = parseRevenuePathArgs([
    "--retention-intelligence",
    "test/output/retention-intelligence/retention_intelligence.json",
  ]);
  assert.equal(
    args.retentionIntelligencePath,
    path.resolve("test/output/retention-intelligence/retention_intelligence.json"),
  );
});

test("affiliate pipeline attaches Revenue Path Engine v2 output to every selected story", () => {
  const story = {
    id: "forza-commercial",
    title: "Forza Horizon 6 Steam Numbers Skyrocket",
    full_script: "Forza players are comparing racing wheel and Xbox controller setups.",
  };

  const { revenuePathManifest } = applyAffiliateAuditToStory(story, "pulsegaming-21");

  assert.equal(story.revenue_path_manifest.schema_version, 2);
  assert.equal(revenuePathManifest.story_id, "forza-commercial");
  assert.equal(story.revenue_path_engine.version, "v2");
  assert.equal(story.revenue_path_engine.verdict, "pass");
});

test("Revenue Path Engine v2 is wired into operator tooling, API and dashboard", async () => {
  const serverSource = await fs.readFile(path.join(__dirname, "..", "..", "server.js"), "utf8");
  const analyticsSource = await fs.readFile(
    path.join(__dirname, "..", "..", "src", "pages", "Analytics.tsx"),
    "utf8",
  );

  assert.equal(packageJson.scripts["ops:revenue-paths"], "node tools/revenue-paths.js");
  assert.match(serverSource, /app\.get\(\s*["']\/api\/revenue\/paths["']/);
  assert.match(analyticsSource, /\/api\/revenue\/paths/);
  assert.match(analyticsSource, /Revenue Paths/);
});

function click(storyId, offerId, platform, ctaVariant) {
  return {
    event_type: "commercial_click",
    timestamp: "2026-05-19T10:00:00.000Z",
    story_id: storyId,
    offer_id: offerId,
    platform,
    cta_variant: ctaVariant,
    video_id: "yt_forza",
    referrer_host: "pulse.orryy.com",
    user_agent_hash: "1234567890abcdef",
  };
}
