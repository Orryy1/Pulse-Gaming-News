"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal18-finance-crypto-firewall");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Gets Real Footage",
    canonical_subject: "Forza Horizon 6",
    description: "Xbox showed source-backed Forza Horizon 6 footage.",
    narration_script: "Xbox showed source-backed Forza Horizon 6 footage.",
    commercial_intelligence: { vertical: "gaming", disclosure_required: true },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    outputs: {
      youtube_shorts: { title: "Forza Horizon 6 Gets Real Footage", description: `/p/${storyId}` },
      tiktok: { caption: "Source: Xbox." },
      x: { hot_take_post: "Forza Horizon 6 finally has real footage." },
    },
    governance_gates: {
      finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    finance_crypto_firewall: { verdict: "pass", failures: [], warnings: [], vertical: "non_financial" },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    vertical: "gaming",
    disclosure_required: true,
    primary_link: null,
    fallback_links: [],
    disclosure_copy: { short: "Affiliate links may earn us a commission.", landing: "Affiliate links may earn us a commission." },
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_route: `/p/${storyId}`,
    disclosure_block: { required: true, copy: { short: "Affiliate links may earn us a commission." }, source_first: true },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 18 CLI parses finance firewall inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-policy-report",
    "output/goal-17/goal17_readiness_report.json",
    "--out-dir",
    "output/goal-18",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T03:37:04.203Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamPolicyReportPath, "output/goal-17/goal17_readiness_report.json");
  assert.equal(args.outDir, "output/goal-18");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T03:37:04.203Z");
  assert.equal(args.json, true);
});

test("Goal 18 CLI writes finance firewall artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal18-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal17.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["upstream:goal16_landing_page_engine_blocked"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-policy-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T03:37:04.203Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal18_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "finance_crypto_risk_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "approved_wording.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "blocked_claims.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "compliance_required_actions.json")), true);
});

test("Goal 18 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal18-finance-crypto-firewall"],
    "node tools/goal18-finance-crypto-firewall.js",
  );
});
