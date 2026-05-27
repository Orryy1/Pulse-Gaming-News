"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_POLICY_CHECKS,
  buildGoal17PlatformPolicyEngine,
  writeGoal17PlatformPolicyEngine,
} = require("../../lib/goal17-platform-policy-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || "Forza Horizon 6 Gets Real Footage",
    canonical_subject: overrides.subject || "Forza Horizon 6",
    canonical_angle: "Confirmed Drop",
    description: "Xbox showed source-backed Forza Horizon 6 footage.",
    narration_script: "Xbox showed source-backed Forza Horizon 6 footage. Players can judge the camera, handling and release clues from the official source.",
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
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), overrides.rightsLedger || {
    story_id: storyId,
    verdict: "pass",
    assets: [{ asset_id: "official-footage", kind: "video", source_family: "official_trailer", rights_risk_class: "low" }],
  });
  return { story_id: storyId, artifact_dir: artifactDir, title: overrides.title || "Forza Horizon 6 Gets Real Footage" };
}

function safePlatformManifest(storyId) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: {
        title: "Forza Horizon 6 Gets Real Footage",
        description: `Source-backed story page: /p/${storyId}`,
        captions: { file: "captions.srt" },
        cover_frame: { headline: "FORZA HORIZON 6", source_label: "Xbox" },
        disclosure_status: { required: true, type: "affiliate", caption: disclosure },
        profile_or_landing_page_cta: `Story sources and related links: /p/${storyId}`,
        link_strategy: "profile_link_or_related_video_for_shorts",
      },
      tiktok: {
        conversational_hook: "Forza Horizon 6 finally has real footage.",
        caption: "Forza Horizon 6 finally has real footage. Source: Xbox.",
        hashtags: ["#GamingNews", "#PulseGaming"],
        disclosure_flag: "commercial_content_disclosure_required",
        commercial_content_setting_recommendation: "required_for_affiliate_or_brand_promotion",
        product_link_eligibility: "not_used",
      },
      instagram_reels: {
        cover_frame: { headline: "FORZA HORIZON 6" },
        caption: "Forza Horizon 6 finally has real footage. Source: Xbox.",
        carousel_companion: { required: true },
        story_poll_idea: "Does this change your watchlist?",
        bio_link_cta: `Story page in bio: /p/${storyId}`,
        disclosure_status: { required: true, type: "affiliate", caption: disclosure },
      },
      facebook_reels: {
        explanatory_framing: "Xbox showed source-backed Forza Horizon 6 footage.",
        page_caption: "Forza Horizon 6 finally has real footage. Source: Xbox.",
        link_routing_strategy: "page_caption_or_comment_link",
        disclosure_status: { required: true, type: "affiliate", caption: disclosure },
      },
      x: {
        hot_take_post: "Forza Horizon 6 finally has real footage. The next official beat should prove the launch plan.",
        source_safe_post: "Forza Horizon 6 finally has real footage.\n\nSource: Xbox.",
        thread_posts: ["Forza Horizon 6 finally has real footage.", "Source: Xbox."],
        poll_candidate: "Does this change your watchlist?",
        landing_page_link: `/p/${storyId}`,
        auto_reply_enabled: false,
      },
      threads: {
        discussion_post: "Forza Horizon 6 finally has real footage. Xbox has the source.",
        duplicate_x_wording_allowed: false,
        tone: "discussion-led and source-safe",
        landing_page_link: `/p/${storyId}`,
        disclosure_status: { required: true, type: "affiliate", caption: disclosure },
      },
      pinterest: {
        pin_title: "Forza Horizon 6 Gets Real Footage",
        pin_description: "Forza Horizon 6 finally has real footage. Source: Xbox.",
        evergreen_only: true,
        disclosure,
        affiliate_disclosure_required: true,
        landing_page_link: `/p/${storyId}`,
      },
    },
    platform_native_evidence: {
      verdict: "pass",
      blind_duplicate_pairs: [],
    },
    governance_gates: {
      platform_policy_gate: { verdict: "pass", failures: [], warnings: [] },
      affiliate_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: true },
      ai_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: false, disclosure_present: false },
      reused_content_risk_gate: { verdict: "pass", failures: [], warnings: [], risky_assets: [] },
      anti_spam_uniqueness_gate: { verdict: "pass", failures: [], warnings: [], matches: [] },
      finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
    },
  };
}

function safePolicyReport(storyId) {
  return {
    schema_version: 1,
    story_id: storyId,
    platform_policy_gate: { verdict: "pass", failures: [], warnings: [] },
    affiliate_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: true },
    ai_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: false, disclosure_present: false },
    reused_content_risk_gate: { verdict: "pass", failures: [], warnings: [], risky_assets: [] },
    anti_spam_uniqueness_gate: { verdict: "pass", failures: [], warnings: [], matches: [] },
    finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
    publish_blockers: [],
  };
}

function safeAffiliate(storyId) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    story_id: storyId,
    vertical: "gaming",
    disclosure_required: true,
    primary_link: null,
    fallback_links: [{ label: "Xbox controller", tracking_url: `/go/${storyId}/controller?platform=story_page` }],
    disclosure_copy: { short: disclosure, landing: disclosure },
  };
}

function safeLanding(storyId) {
  const disclosure = "Affiliate links may earn us a commission.";
  return {
    story_id: storyId,
    landing_page_route: `/p/${storyId}`,
    disclosure_block: { required: true, copy: { short: disclosure, landing: disclosure }, source_first: true },
    attribution_manifest: {
      verdict: "pass",
      platforms: {
        youtube: { disclosure_required: true, disclosure_copy: disclosure },
        tiktok: { disclosure_required: true, disclosure_copy: disclosure },
        instagram: { disclosure_required: true, disclosure_copy: disclosure },
        facebook: { disclosure_required: true, disclosure_copy: disclosure },
        x: { disclosure_required: true, disclosure_copy: disclosure },
      },
    },
  };
}

function blockedLandingReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["upstream:goal15_affiliate_intelligence_blocked"],
      },
    ],
  };
}

function readyLandingReport(storyId) {
  return {
    stories: [{ story_id: storyId, status: "ready", blockers: [] }],
  };
}

test("Goal 17 checks platform policy but preserves upstream landing blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal17-upstream-blocked-"));
  const story = await makeStoryPackage(root, "story-policy");

  const report = await buildGoal17PlatformPolicyEngine({
    storyPackages: [story],
    upstreamLandingReport: blockedLandingReport("story-policy"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T03:06:52.032Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_policy_verdict, "PASS");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.direct_policy_pass_story_count, 1);
  assert.equal(report.summary.policy_ready_story_count, 0);
  assert.ok(report.stories[0].blockers.includes("upstream:goal16_landing_page_engine_blocked"));
  for (const check of REQUIRED_POLICY_CHECKS) {
    assert.equal(report.stories[0].policy_checks[check].status, "pass", check);
  }
  assert.equal(report.disclosure_requirements.stories[0].requirements.youtube.paid_promotion.required, false);
  assert.equal(report.disclosure_requirements.stories[0].requirements.tiktok.commercial.required, true);
  assert.equal(report.disclosure_requirements.stories[0].requirements.tiktok.commercial.present, true);
  assert.equal(report.disclosure_requirements.stories[0].requirements.affiliate.required, true);
  assert.equal(report.disclosure_requirements.stories[0].requirements.affiliate.present, true);
  assert.equal(report.publish_blockers.publish_allowed, false);
  assert.equal(report.publish_blockers.safety.no_publish_action, true);
});

test("Goal 17 hard-fails unsafe platform policy evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal17-hard-fail-"));
  const unsafePlatform = safePlatformManifest("story-risk");
  unsafePlatform.outputs.youtube_shorts.description = "Buy Bitcoin now: https://www.amazon.co.uk/s?k=crypto&tag=pulsegaming-21";
  unsafePlatform.outputs.youtube_shorts.paid_promotion_required = true;
  unsafePlatform.outputs.youtube_shorts.disclosure_status = { required: true, type: "affiliate", caption: "" };
  unsafePlatform.outputs.youtube_shorts.synthetic_media_required = true;
  unsafePlatform.outputs.tiktok.disclosure_flag = "";
  unsafePlatform.outputs.tiktok.commercial_content_setting_recommendation = "";
  unsafePlatform.outputs.tiktok.ai_generated_content_label = "";
  unsafePlatform.outputs.instagram_reels.disclosure_status = { required: true, type: "branded_content", caption: "" };
  unsafePlatform.outputs.instagram_reels.branded_content_required = true;
  unsafePlatform.outputs.facebook_reels.disclosure_status = { required: true, type: "branded_content", caption: "" };
  unsafePlatform.outputs.x.auto_reply_enabled = true;
  unsafePlatform.outputs.x.thread_posts = ["guaranteed return", "guaranteed return"];
  unsafePlatform.platform_native_evidence = { verdict: "fail", blind_duplicate_pairs: [["x", "threads"]] };
  unsafePlatform.governance_gates.reused_content_risk_gate = { verdict: "fail", failures: ["policy:reused_content_risk_high"], warnings: [] };
  unsafePlatform.governance_gates.anti_spam_uniqueness_gate = { verdict: "fail", failures: ["uniqueness:too_similar_recent_output"], warnings: [] };
  unsafePlatform.governance_gates.finance_crypto_firewall = { verdict: "fail", failures: ["finance_crypto:promotion_without_approval"], warnings: [], vertical: "crypto" };

  const story = await makeStoryPackage(root, "story-risk", {
    canonical: {
      selected_title: "Bitcoin Will Pump After This Game Token Deal",
      canonical_subject: "Bitcoin token deal",
      vertical: "crypto",
      description: "This will pump and the returns are guaranteed.",
      narration_script: "This will pump and the returns are guaranteed. Buy the token now.",
      unconfirmed_claims: ["The token price will pump."],
      prohibited_claims: ["Guaranteed returns."],
      synthetic_media_required: true,
    },
    platformManifest: unsafePlatform,
    platformPolicyReport: {
      platform_policy_gate: { verdict: "fail", failures: ["policy:youtube_paid_promotion_disclosure_missing"], warnings: [] },
      affiliate_disclosure_gate: { verdict: "fail", failures: ["commercial:affiliate_disclosure_required_missing"], warnings: [], disclosure_required: true },
      ai_disclosure_gate: { verdict: "fail", failures: ["policy:ai_disclosure_required_missing"], warnings: [], disclosure_required: true },
      reused_content_risk_gate: { verdict: "fail", failures: ["policy:reused_content_risk_high"], warnings: [] },
      anti_spam_uniqueness_gate: { verdict: "fail", failures: ["uniqueness:too_similar_recent_output"], warnings: [] },
      finance_crypto_firewall: { verdict: "fail", failures: ["finance_crypto:promotion_without_approval"], warnings: [], vertical: "crypto" },
      publish_blockers: ["policy:youtube_paid_promotion_disclosure_missing"],
    },
    affiliate: {
      story_id: "story-risk",
      vertical: "crypto",
      disclosure_required: true,
      primary_link: { url: "https://www.amazon.co.uk/s?k=crypto&tag=pulsegaming-21", tracking_url: "/go/story-risk/crypto" },
      disclosure_copy: { short: "", landing: "" },
    },
    landing: {
      story_id: "story-risk",
      landing_page_route: "/p/story-risk",
      disclosure_block: { required: true, copy: { short: "", landing: "" }, source_first: true },
    },
    rightsLedger: {
      story_id: "story-risk",
      verdict: "fail",
      assets: [{ asset_id: "grabbed-stream", kind: "video", source_type: "reupload", rights_risk_class: "high" }],
    },
  });

  const report = await buildGoal17PlatformPolicyEngine({
    storyPackages: [story],
    upstreamLandingReport: readyLandingReport("story-risk"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T03:06:52.032Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_policy_verdict, "BLOCKED");
  for (const blocker of [
    "policy:youtube_reused_content_risk",
    "policy:youtube_paid_promotion_disclosure_missing",
    "policy:youtube_altered_synthetic_disclosure_missing",
    "policy:youtube_shorts_link_limitation_unhandled",
    "policy:tiktok_commercial_disclosure_missing",
    "policy:tiktok_ai_disclosure_missing",
    "policy:meta_branded_content_disclosure_missing",
    "policy:x_automation_spam_risk",
    "policy:affiliate_disclosure_missing",
    "policy:finance_crypto_review_required",
    "policy:misinformation_risk",
    "policy:spam_repetitive_content",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
    assert.ok(report.direct_risk_counts[blocker] >= 1, blocker);
  }
  assert.equal(report.disclosure_requirements.stories[0].requirements.youtube.paid_promotion.present, false);
  assert.equal(report.disclosure_requirements.stories[0].requirements.tiktok.ai.present, false);
  assert.equal(report.publish_blockers.stories[0].publish_allowed, false);
});

test("Goal 17 writes required policy artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal17-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal17PlatformPolicyEngine({
    storyPackages: [story],
    upstreamLandingReport: blockedLandingReport("story-write"),
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T03:06:52.032Z",
  });

  const written = await writeGoal17PlatformPolicyEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.platformPolicyReport), true);
  assert.equal(await fs.pathExists(written.disclosureRequirements), true);
  assert.equal(await fs.pathExists(written.publishBlockers), true);
});
