"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal16-landing-page-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const disclosure = "Affiliate links may earn us a commission.";
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 May Be Close",
    canonical_subject: "Forza Horizon 6",
    description: "Forza Horizon 6 has a source-backed update.",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/example",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    output: "visual_v4_render.mp4",
    final_publish_render: false,
  });
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), "local proof mp4 placeholder");
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    primary_link: null,
    fallback_links: [],
    source_links: [{ label: "Xbox Wire", url: "https://news.xbox.com/example" }],
    disclosure_required: true,
    disclosure_copy: { short: disclosure, landing: disclosure },
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_slug: storyId,
    landing_page_route: `/p/${storyId}`,
    newsletter_capture: true,
    link_pack: { source_links: [{ label: "Xbox Wire", url: "https://news.xbox.com/example" }] },
    disclosure_block: { required: true, copy: { short: disclosure, landing: disclosure }, source_first: true },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 16 CLI parses local landing-page inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-affiliate-report",
    "output/goal-15/goal15_readiness_report.json",
    "--out-dir",
    "output/goal-16",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T02:36:43.754Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamAffiliateReportPath, "output/goal-15/goal15_readiness_report.json");
  assert.equal(args.outDir, "output/goal-16");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T02:36:43.754Z");
  assert.equal(args.json, true);
});

test("Goal 16 CLI writes landing-page artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal16-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal15.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["upstream:goal14_social_derivatives_blocked"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-affiliate-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T02:36:43.754Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal16_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "landing_page_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "link_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "disclosure_block.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "revenue_tracking.json")), true);
});

test("Goal 16 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal16-landing-pages"],
    "node tools/goal16-landing-page-engine.js",
  );
});
