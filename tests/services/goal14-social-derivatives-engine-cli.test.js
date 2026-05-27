"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal14-social-derivatives-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "The Expanse Shows Real Gameplay",
    canonical_subject: "The Expanse: Osiris Reborn",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    primary_source: "Xbox Wire",
    suggested_thumbnail_text: "EXPANSE GAMEPLAY",
  });
  await fs.outputJson(path.join(artifactDir, "x_publish_pack.json"), {
    hot_take_post: "The Expanse Shows Real Gameplay. The useful next beat is hands-on proof.",
    source_safe_post: "The Expanse Shows Real Gameplay\n\nSource: Xbox Wire.",
    thread_posts: ["The Expanse Shows Real Gameplay", "Gameplay finally appeared.", "Source: Xbox Wire."],
    poll_candidate: "Buy now or wait for reviews?",
    landing_page_link: "/p/story-cli",
  });
  await fs.outputJson(path.join(artifactDir, "instagram_publish_pack.json"), {
    cover_frame: { headline: "EXPANSE GAMEPLAY", source_label: "Xbox Wire" },
    caption: "The Expanse finally showed real gameplay. Source: Xbox Wire.",
    carousel_companion: { required: true, cards: ["cover", "source", "context"] },
    story_poll_idea: "Does this change your watchlist?",
    bio_link_cta: "Story page in bio: /p/story-cli",
  });
  await fs.outputJson(path.join(artifactDir, "threads_publish_pack.json"), {
    discussion_post: "The Expanse finally showed real gameplay, and the next useful proof is hands-on footage.",
    duplicate_x_wording_allowed: false,
    tone: "discussion-led",
    landing_page_link: "/p/story-cli",
    automated_replies_allowed: false,
  });
  await fs.outputJson(path.join(artifactDir, "image_card_manifest.json"), {
    platforms: ["x", "instagram", "threads"],
    headline: "EXPANSE GAMEPLAY",
  });
  await fs.outputJson(path.join(artifactDir, "carousel_manifest.json"), {
    platform: "instagram",
    cards: ["cover", "source", "impact", "related_links"],
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 14 CLI parses local social derivative inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-publisher-report",
    "output/goal-13/goal13_readiness_report.json",
    "--out-dir",
    "output/goal-14",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T01:36:27.172Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamPublisherReportPath, "output/goal-13/goal13_readiness_report.json");
  assert.equal(args.outDir, "output/goal-14");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T01:36:27.172Z");
  assert.equal(args.json, true);
});

test("Goal 14 CLI writes social derivative artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal13.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["upstream:goal12_experimentation_engine_blocked"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-publisher-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T01:36:27.172Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal14_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "x_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "instagram_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "threads_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "image_card_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "carousel_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "engagement_risk_report.json")), true);
});

test("Goal 14 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal14-social-derivatives"],
    "node tools/goal14-social-derivatives-engine.js",
  );
});
