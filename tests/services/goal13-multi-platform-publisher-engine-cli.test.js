"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../../package.json");
process.env.PULSE_SKIP_DOTENV = "true";
const { main, parseArgs } = require("../../tools/goal13-multi-platform-publisher-engine");

async function makeStory(root, storyId) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "The Expanse Shows Real Gameplay",
    canonical_subject: "The Expanse: Osiris Reborn",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    disclosure_required: true,
    relevance_verdict: "pass",
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_route: `/p/${storyId}`,
    attribution_manifest: {
      verdict: "pass",
      platforms: Object.fromEntries(
        ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"].map((platform) => [
          platform,
          {
            tracking_key: `${storyId}:${platform}:story_page`,
            landing_page_url: `/p/${storyId}?utm_source=${platform}`,
            disclosure_copy: "Affiliate links may earn us a commission.",
          },
        ]),
      ),
    },
    disclosure_block: {
      required: true,
      copy: { short: "Affiliate links may earn us a commission." },
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    status: "pass",
    risks: [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    operating_mode: "DRY_RUN_PUBLISH",
    platform_native_evidence: {
      verdict: "pass",
      blind_duplicate_pairs: [],
    },
    outputs: {
      youtube_shorts: {
        title: "The Expanse Shows Real Gameplay",
        description: "Source and links: /p/story-cli",
        cover_frame: { headline: "EXPANSE GAMEPLAY" },
        captions: { file: "captions.srt" },
        disclosure_status: { required: true, caption: "Affiliate links may earn us a commission." },
        profile_or_landing_page_cta: "Story page: /p/story-cli",
      },
      tiktok: {
        conversational_hook: "The Expanse finally showed real gameplay.",
        caption: "The Expanse finally showed real gameplay.",
        hashtags: ["#GamingNews"],
        disclosure_flag: "commercial_content_disclosure_required",
        commercial_content_setting_recommendation: "required_for_affiliate_or_brand_promotion",
      },
      instagram_reels: {
        cover_frame: { headline: "EXPANSE GAMEPLAY" },
        caption: "The Expanse finally showed real gameplay.",
        carousel_companion: { required: true },
        story_poll_idea: "Does this change your watchlist?",
        bio_link_cta: "Story page in bio: /p/story-cli",
        disclosure_status: { required: true, caption: "Affiliate links may earn us a commission." },
      },
      facebook_reels: {
        explanatory_framing: "Xbox Wire showed the gameplay proof.",
        page_caption: "The Expanse finally showed real gameplay.",
        link_routing_strategy: "comment_link:/p/story-cli",
        disclosure_status: { required: true, caption: "Affiliate links may earn us a commission." },
      },
      x: {
        hot_take_post: "The Expanse finally showed real gameplay.",
        source_safe_post: "The Expanse Shows Real Gameplay\n\nSource: Xbox Wire.",
        thread_posts: ["The Expanse Shows Real Gameplay", "Source: Xbox Wire."],
        poll_candidate: "Buy now or wait?",
        landing_page_link: "/p/story-cli",
      },
      threads: {
        discussion_post: "The Expanse finally showed real gameplay, and the next useful proof is hands-on footage.",
        duplicate_x_wording_allowed: false,
        tone: "discussion-led",
        landing_page_link: "/p/story-cli",
        disclosure_status: { required: true, caption: "Affiliate links may earn us a commission." },
      },
      pinterest: {
        pin_title: "The Expanse Shows Real Gameplay",
        pin_description: "The Expanse finally showed real gameplay.",
        disclosure: "Affiliate links may earn us a commission.",
        landing_page_link: "/p/story-cli",
        evergreen_only: true,
      },
    },
  });
  return { story_id: storyId, artifact_dir: artifactDir };
}

test("Goal 13 CLI parses dry-run publisher inputs", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--upstream-experiment-report",
    "output/goal-12/goal12_readiness_report.json",
    "--out-dir",
    "output/goal-13",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-26T01:06:16.330Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.upstreamExperimentReportPath, "output/goal-12/goal12_readiness_report.json");
  assert.equal(args.outDir, "output/goal-13");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-26T01:06:16.330Z");
  assert.equal(args.json, true);
});

test("Goal 13 CLI writes publisher artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal13-cli-"));
  const story = await makeStory(root, "story-cli");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const upstreamPath = path.join(root, "goal12.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(storyPackagesPath, [story]);
  await fs.outputJson(upstreamPath, {
    stories: [{ story_id: "story-cli", status: "blocked", blockers: ["experiment:variant_metrics_missing"] }],
  });

  const result = await main([
    "--story-packages",
    storyPackagesPath,
    "--upstream-experiment-report",
    upstreamPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-26T01:06:16.330Z",
  ]);

  assert.equal(result.report.verdict, "BLOCKED");
  assert.equal(await fs.pathExists(path.join(outDir, "goal13_readiness_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_publish_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_variant_scorecard.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "scheduled_posts.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "platform_risk_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "analytics_ingest_plan.json")), true);
});

test("Goal 13 operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:goal13-multi-platform-publisher"],
    "node tools/goal13-multi-platform-publisher-engine.js",
  );
});
