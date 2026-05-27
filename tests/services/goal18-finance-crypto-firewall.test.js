"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_FIREWALL_CHECKS,
  buildGoal18FinanceCryptoFirewall,
  writeGoal18FinanceCryptoFirewall,
} = require("../../lib/goal18-finance-crypto-firewall");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || "Forza Horizon 6 Gets Real Footage",
    canonical_subject: overrides.subject || "Forza Horizon 6",
    canonical_angle: "Confirmed Drop",
    thumbnail_text: overrides.thumbnail || "FORZA HORIZON 6",
    description: "Xbox showed source-backed Forza Horizon 6 footage.",
    narration_script: "Xbox showed source-backed Forza Horizon 6 footage. Players can judge the camera and release clues from the official source.",
    confirmed_claims: ["Xbox showed Forza Horizon 6 footage."],
    unconfirmed_claims: [],
    prohibited_claims: [],
    commercial_intelligence: { vertical: "gaming", disclosure_required: true },
    ...(overrides.canonical || {}),
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), overrides.platformManifest || safePlatformManifest(storyId));
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), overrides.platformPolicyReport || safePolicyReport(storyId));
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), overrides.affiliate || safeAffiliate(storyId));
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), overrides.landing || safeLanding(storyId));
  return { story_id: storyId, artifact_dir: artifactDir, title: overrides.title || "Forza Horizon 6 Gets Real Footage" };
}

function safePlatformManifest(storyId) {
  return {
    story_id: storyId,
    outputs: {
      youtube_shorts: {
        title: "Forza Horizon 6 Gets Real Footage",
        description: `Source-backed story page: /p/${storyId}`,
        cover_frame: { headline: "FORZA HORIZON 6" },
      },
      tiktok: { caption: "Forza Horizon 6 finally has real footage. Source: Xbox." },
      instagram_reels: { caption: "Forza Horizon 6 finally has real footage. Source: Xbox." },
      facebook_reels: { page_caption: "Forza Horizon 6 finally has real footage. Source: Xbox." },
      x: { hot_take_post: "Forza Horizon 6 finally has real footage.", landing_page_link: `/p/${storyId}` },
      threads: { discussion_post: "Forza Horizon 6 finally has real footage. Xbox has the source.", landing_page_link: `/p/${storyId}` },
      pinterest: { pin_title: "Forza Horizon 6 Gets Real Footage", pin_description: "Source: Xbox.", landing_page_link: `/p/${storyId}` },
    },
    governance_gates: {
      finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
    },
  };
}

function safePolicyReport(storyId) {
  return {
    schema_version: 1,
    story_id: storyId,
    finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
    publish_blockers: [],
  };
}

function safeAffiliate(storyId) {
  return {
    story_id: storyId,
    vertical: "gaming",
    disclosure_required: true,
    primary_link: null,
    fallback_links: [{ label: "Xbox controller", tracking_url: `/go/${storyId}/controller?platform=story_page` }],
    disclosure_copy: { short: "Affiliate links may earn us a commission.", landing: "Affiliate links may earn us a commission." },
  };
}

function safeLanding(storyId) {
  return {
    story_id: storyId,
    landing_page_route: `/p/${storyId}`,
    disclosure_block: {
      required: true,
      copy: { short: "Affiliate links may earn us a commission.", landing: "Affiliate links may earn us a commission." },
      source_first: true,
    },
  };
}

function blockedPolicyReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["upstream:goal16_landing_page_engine_blocked"],
      },
    ],
  };
}

function readyPolicyReport(storyId) {
  return {
    stories: [{ story_id: storyId, status: "ready", blockers: [] }],
  };
}

test("Goal 18 preserves Goal 17 blockers while direct finance checks pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal18-upstream-blocked-"));
  const story = await makeStoryPackage(root, "story-gaming");

  const report = await buildGoal18FinanceCryptoFirewall({
    storyPackages: [story],
    upstreamPolicyReport: blockedPolicyReport("story-gaming"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T03:37:04.203Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_finance_crypto_verdict, "PASS");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.direct_finance_crypto_pass_story_count, 1);
  assert.equal(report.summary.finance_crypto_ready_story_count, 0);
  assert.ok(report.stories[0].blockers.includes("upstream:goal17_platform_policy_engine_blocked"));
  for (const check of REQUIRED_FIREWALL_CHECKS) {
    assert.equal(report.stories[0].firewall_checks[check].status, "pass", check);
  }
  assert.equal(report.finance_crypto_risk_report.stories[0].status, "clear");
  assert.equal(report.blocked_claims.stories[0].blocked_claims.length, 0);
  assert.equal(report.compliance_required_actions.safety.no_publish_action, true);
});

test("Goal 18 hard-blocks unsafe finance and crypto promotion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal18-hard-block-"));
  const unsafePlatform = safePlatformManifest("story-risk");
  unsafePlatform.outputs.youtube_shorts.title = "Bitcoin Game Token Will 100x";
  unsafePlatform.outputs.youtube_shorts.description = "Buy now through our exchange referral and use 100x leverage.";
  unsafePlatform.outputs.youtube_shorts.cover_frame = { headline: "100X PROFIT GUARANTEED" };
  unsafePlatform.outputs.tiktok.caption = "This token will pump. Hold now before the listing.";
  unsafePlatform.outputs.x.hot_take_post = "I would buy this token before it moons.";
  const story = await makeStoryPackage(root, "story-risk", {
    title: "Bitcoin Game Token Will Pump After Exchange Listing",
    thumbnail: "100X PROFIT GUARANTEED",
    canonical: {
      selected_title: "Bitcoin Game Token Will Pump After Exchange Listing",
      canonical_subject: "Bitcoin game token",
      vertical: "crypto",
      description: "This will pump and guaranteed returns are coming.",
      narration_script:
        "Buy this token now, hold through the listing and use the exchange referral bonus for 100x leverage. Bitcoin will hit 150k next month. This is financial advice for you.",
      pinned_comment: "Sponsored exchange referral: https://exchange.example/ref",
      commercial_intelligence: { vertical: "crypto", disclosure_required: false },
    },
    platformManifest: unsafePlatform,
    platformPolicyReport: {
      finance_crypto_firewall: { verdict: "fail", failures: ["finance_crypto:promotion_without_approval"], warnings: [], vertical: "crypto" },
    },
    affiliate: {
      story_id: "story-risk",
      vertical: "crypto",
      disclosure_required: false,
      primary_link: {
        label: "Crypto exchange",
        url: "https://exchange.example/ref",
        merchant: "Unapproved Exchange",
        programme_id: "crypto_exchange",
        tracking_url: "/go/story-risk/exchange",
      },
      fallback_links: [],
      disclosure_copy: { short: "", landing: "" },
    },
    landing: {
      story_id: "story-risk",
      landing_page_route: "/p/story-risk",
      disclosure_block: { required: false, copy: { short: "", landing: "" }, source_first: true },
    },
  });

  const report = await buildGoal18FinanceCryptoFirewall({
    storyPackages: [story],
    upstreamPolicyReport: readyPolicyReport("story-risk"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T03:37:04.203Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_finance_crypto_verdict, "BLOCKED");
  for (const blocker of [
    "finance_crypto:buy_sell_hold_call",
    "finance_crypto:guaranteed_return_claim",
    "finance_crypto:pump_claim",
    "finance_crypto:leverage_promotion",
    "finance_crypto:exchange_referral_without_approval",
    "finance_crypto:token_shilling",
    "finance_crypto:certainty_price_prediction",
    "finance_crypto:misleading_profit_thumbnail",
    "finance_crypto:undisclosed_incentive",
    "finance_crypto:personalised_investment_advice",
    "finance_crypto:unsafe_affiliate_routing",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
    assert.ok(report.direct_risk_counts[blocker] >= 1, blocker);
  }
  assert.ok(report.blocked_claims.stories[0].blocked_claims.length >= 10);
  assert.equal(report.approved_wording.stories[0].status, "blocked_until_claims_removed");
  assert.equal(report.compliance_required_actions.stories[0].actions.some((action) => action.action === "remove_blocked_finance_crypto_claims"), true);
});

test("Goal 18 allows non-advisory source-backed finance formats", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal18-safe-format-"));
  const story = await makeStoryPackage(root, "story-safe-finance", {
    title: "UK Regulator Updates Crypto Ad Rules",
    thumbnail: "CRYPTO AD RULES",
    canonical: {
      selected_title: "UK Regulator Updates Crypto Ad Rules",
      canonical_subject: "UK crypto advertising rules",
      vertical: "finance",
      description: "The FCA updated its rules for crypto adverts. This is a source-backed explainer, not financial advice.",
      narration_script:
        "The FCA updated its rules for crypto adverts. This is a source-backed explainer, not financial advice. There is no buy, sell or hold recommendation here. The practical point is how disclosure and risk warnings have to appear.",
      commercial_intelligence: { vertical: "finance", disclosure_required: false },
    },
    affiliate: {
      story_id: "story-safe-finance",
      vertical: "finance",
      disclosure_required: false,
      primary_link: null,
      fallback_links: [],
      disclosure_copy: { short: "No affiliate links are attached to this story.", landing: "No affiliate links are attached to this story." },
    },
    landing: {
      story_id: "story-safe-finance",
      landing_page_route: "/p/story-safe-finance",
      disclosure_block: {
        required: false,
        copy: { short: "No affiliate links are attached to this story.", landing: "No affiliate links are attached to this story." },
        source_first: true,
      },
    },
  });

  const report = await buildGoal18FinanceCryptoFirewall({
    storyPackages: [story],
    upstreamPolicyReport: readyPolicyReport("story-safe-finance"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T03:37:04.203Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_finance_crypto_verdict, "PASS");
  assert.equal(report.summary.finance_crypto_topic_story_count, 1);
  assert.equal(report.summary.safe_finance_format_story_count, 1);
  assert.equal(report.stories[0].finance_crypto_risk.status, "allowed_safe_format");
  assert.ok(report.approved_wording.stories[0].approved_wording.disclaimer.includes("not financial advice"));
  assert.equal(report.blocked_claims.stories[0].blocked_claims.length, 0);
});

test("Goal 18 writes required finance and crypto artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal18-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal18FinanceCryptoFirewall({
    storyPackages: [story],
    upstreamPolicyReport: blockedPolicyReport("story-write"),
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T03:37:04.203Z",
  });

  const written = await writeGoal18FinanceCryptoFirewall(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.financeCryptoRiskReport), true);
  assert.equal(await fs.pathExists(written.approvedWording), true);
  assert.equal(await fs.pathExists(written.blockedClaims), true);
  assert.equal(await fs.pathExists(written.complianceRequiredActions), true);
});
