"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal20-anti-spam-uniqueness-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Adds A Fresh Weather Detail",
    thumbnail_headline: "FORZA WEATHER DETAIL",
    narration_script: "Forza adds a fresh weather detail. The rest of the script stays source-backed.",
    pinned_comment: "Follow Pulse Gaming for Forza context.",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: {
        title: "Forza Adds A Fresh Weather Detail",
        cover_frame: { headline: "FORZA WEATHER DETAIL" },
        cta: "Follow Pulse Gaming for Forza context.",
      },
      x: { hot_take_post: "Forza adds a fresh weather detail." },
      threads: { discussion_post: "Forza weather has a new source-backed detail.", duplicate_x_wording_allowed: false },
      instagram_reels: { carousel_companion: { cards: ["cover", "source", "weather"] } },
    },
    platform_native_evidence: { blind_duplicate_pairs: [] },
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    assets: [{ kind: "video", source_family: `family-${storyId}` }],
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    layout_template: `layout-${storyId}`,
    transition_plan: { transitions: [`transition-${storyId}`] },
    sound_transition_plan: { sfx: { cues: [{ id: `cue-${storyId}`, family: `sfx-${storyId}` }] } },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    cues: [{ id: `cue-${storyId}`, family: `sfx-${storyId}` }],
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    primary_link: { label: `Offer ${storyId}`, merchant: `Merchant ${storyId}` },
  });
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), { verdict: "pass", failures: [], warnings: [] });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 20 CLI parses anti-spam inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-control-tower-report",
    "output/goal-19/goal19_readiness_report.json",
    "--upstream-social-derivatives-report",
    "output/goal-14/goal14_readiness_report.json",
    "--out-dir",
    "output/goal-20",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T04:37:23.858Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamControlTowerReportPath, "output/goal-19/goal19_readiness_report.json");
  assert.equal(args.upstreamSocialDerivativesReportPath, "output/goal-14/goal14_readiness_report.json");
  assert.equal(args.outDir, "output/goal-20");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T04:37:23.858Z");
  assert.equal(args.deferDuplicateCandidates, true);
  assert.equal(args.json, true);
});

test("Goal 20 CLI writes anti-spam artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal20-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal19.json");
  const socialPath = path.join(root, "goal14.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", verdict: "RED", blockers: ["upstream:goal18_finance_crypto_firewall_blocked"] }],
  });
  await fs.outputJson(socialPath, {
    carousel_manifest: {
      stories: [{ story_id: "story-cli", format_signature: "cover>source_proof>quote_card>story_prompt" }],
    },
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-control-tower-report",
    upstreamPath,
    "--upstream-social-derivatives-report",
    socialPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T04:37:23.858Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal20_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "uniqueness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "repetition_risk_score.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "variation_recommendations.json")), true);
});

test("Goal 20 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal20-anti-spam-uniqueness"],
    "node tools/goal20-anti-spam-uniqueness-engine.js",
  );
});
