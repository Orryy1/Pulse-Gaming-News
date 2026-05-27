"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal17-platform-policy-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  const disclosure = "Affiliate links may earn us a commission.";
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Gets Real Footage",
    canonical_subject: "Forza Horizon 6",
    description: "Xbox showed source-backed Forza Horizon 6 footage.",
    narration_script: "Xbox showed source-backed Forza Horizon 6 footage.",
    confirmed_claims: ["Xbox showed Forza Horizon 6 footage."],
    unconfirmed_claims: [],
    prohibited_claims: [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    outputs: {
      youtube_shorts: {
        title: "Forza Horizon 6 Gets Real Footage",
        description: `Source-backed story page: /p/${storyId}`,
        disclosure_status: { required: true, type: "affiliate", caption: disclosure },
        profile_or_landing_page_cta: `/p/${storyId}`,
        link_strategy: "profile_link_or_related_video_for_shorts",
      },
      tiktok: {
        conversational_hook: "Forza Horizon 6 finally has real footage.",
        caption: "Source: Xbox.",
        disclosure_flag: "commercial_content_disclosure_required",
        commercial_content_setting_recommendation: "required_for_affiliate_or_brand_promotion",
        product_link_eligibility: "not_used",
      },
      instagram_reels: { caption: "Source: Xbox.", disclosure_status: { required: true, type: "affiliate", caption: disclosure } },
      facebook_reels: { page_caption: "Source: Xbox.", disclosure_status: { required: true, type: "affiliate", caption: disclosure } },
      x: { hot_take_post: "Forza Horizon 6 finally has real footage.", landing_page_link: `/p/${storyId}`, auto_reply_enabled: false },
      threads: { discussion_post: "Forza Horizon 6 finally has real footage. Xbox has the source page.", landing_page_link: `/p/${storyId}` },
      pinterest: { pin_title: "Forza Horizon 6 Gets Real Footage", disclosure, landing_page_link: `/p/${storyId}` },
    },
    platform_native_evidence: { verdict: "pass", blind_duplicate_pairs: [] },
    governance_gates: {
      platform_policy_gate: { verdict: "pass", failures: [], warnings: [] },
      affiliate_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: true },
      ai_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: false },
      reused_content_risk_gate: { verdict: "pass", failures: [], warnings: [] },
      anti_spam_uniqueness_gate: { verdict: "pass", failures: [], warnings: [] },
      finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    platform_policy_gate: { verdict: "pass", failures: [], warnings: [] },
    affiliate_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: true },
    ai_disclosure_gate: { verdict: "pass", failures: [], warnings: [], disclosure_required: false },
    reused_content_risk_gate: { verdict: "pass", failures: [], warnings: [] },
    anti_spam_uniqueness_gate: { verdict: "pass", failures: [], warnings: [] },
    finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    vertical: "gaming",
    disclosure_required: true,
    primary_link: null,
    fallback_links: [],
    disclosure_copy: { short: disclosure, landing: disclosure },
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_route: `/p/${storyId}`,
    disclosure_block: { required: true, copy: { short: disclosure, landing: disclosure }, source_first: true },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    assets: [],
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 17 CLI parses platform policy inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-landing-report",
    "output/goal-16/goal16_readiness_report.json",
    "--out-dir",
    "output/goal-17",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T03:06:52.032Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamLandingReportPath, "output/goal-16/goal16_readiness_report.json");
  assert.equal(args.outDir, "output/goal-17");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T03:06:52.032Z");
  assert.equal(args.json, true);
});

test("Goal 17 CLI writes platform policy artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal17-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal16.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["upstream:goal15_affiliate_intelligence_blocked"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-landing-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T03:06:52.032Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal17_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_policy_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "disclosure_requirements.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "publish_blockers.json")), true);
});

test("Goal 17 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal17-platform-policy"],
    "node tools/goal17-platform-policy-engine.js",
  );
});
