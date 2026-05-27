"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal15-affiliate-intelligence-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const route = `/p/${storyId}`;
  const disclosure = "Affiliate links may earn us a commission.";
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Steam Deck OLED Deal Still Holds Up",
    canonical_subject: "Steam Deck OLED",
    primary_source: "Steam News",
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    vertical: "gaming",
    commercial_intent_type: "hardware_interest",
    primary_link: null,
    fallback_links: [],
    relevance_score: 0,
    audience_fit_score: 82,
    trust_score: 0,
    compliance_risk_score: 0,
    disclosure_required: true,
    disclosure_copy: { short: disclosure, landing: disclosure },
    platform_disclosure: {
      youtube: { affiliate_disclosure_required: true, caption_copy: disclosure },
      x: { affiliate_disclosure_required: true, caption_copy: disclosure },
    },
    platform_specific_ctas: {
      youtube: "Sources and related links are on the story page.",
      x: "Story page has sources and related links.",
    },
    affiliate_tracking_map: {
      story_id: storyId,
      primary_offer_id: null,
      story_page: null,
      platforms: {},
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
      },
    },
    revenue_attribution: {
      story_id: storyId,
      primary_offer_id: null,
      platform_clicks: { youtube: 0, x: 0 },
      landing_page_visits: 0,
      conversions: 0,
      revenue: { amount: 0, currency: "GBP", source: "waiting_for_affiliate_network_reporting" },
    },
    commercial_opportunity_score: 0,
    rejection_reasons: ["story_does_not_naturally_support_affiliate"],
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_route: route,
    disclosure_block: { required: true, copy: { short: disclosure, landing: disclosure }, source_first: true },
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
      },
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 15 CLI parses local affiliate intelligence inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-social-report",
    "output/goal-14/goal14_readiness_report.json",
    "--out-dir",
    "output/goal-15",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T02:06:35.510Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamSocialReportPath, "output/goal-14/goal14_readiness_report.json");
  assert.equal(args.outDir, "output/goal-15");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T02:06:35.510Z");
  assert.equal(args.json, true);
});

test("Goal 15 CLI writes affiliate intelligence artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal15-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal14.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["upstream:goal13_multi_platform_publisher_blocked"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-social-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T02:06:35.510Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal15_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "affiliate_link_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "commercial_opportunity_score.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "disclosure_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "affiliate_tracking_map.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "revenue_attribution.json")), true);
});

test("Goal 15 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal15-affiliate-intelligence"],
    "node tools/goal15-affiliate-intelligence-engine.js",
  );
});
