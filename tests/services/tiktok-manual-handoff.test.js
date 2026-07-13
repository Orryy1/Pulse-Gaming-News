"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildTikTokManualHandoff,
  writeTikTokManualHandoff,
} = require("../../lib/platforms/tiktok-manual-handoff");
const {
  parseArgs,
} = require("../../tools/tiktok-manual-handoff");

test("TikTok manual handoff stays usable when Content Posting API permission is unavailable", () => {
  const handoff = buildTikTokManualHandoff({
    action: {
      story_id: "story-1",
      platform: "tiktok",
      title: "Fallback title",
      video_path: "story-1.mp4",
      captions_path: "story-1.srt",
      video_duration_s: 64.2,
      blockers: [],
      disclosure_requirements: { ai_generated: true },
    },
    publishPack: {
      conversational_hook: "This is the governed hook.",
      caption: "This is the governed TikTok caption.",
      hashtags: ["#GamingNews", "#PulseGaming"],
      disclosure_flag: "ai_generated_content_label_required",
      commercial_content_setting_recommendation: "not_required_unless_brand_or_product_promoted",
    },
    contentPostingApiStatus: "permission_unavailable",
    assetEvidence: { video_exists: true, captions_exist: true },
    now: new Date("2026-07-13T10:00:00.000Z"),
  });

  assert.equal(handoff.status, "ready_for_operator_upload");
  assert.equal(handoff.route, "tiktok_studio_web_or_mobile");
  assert.equal(handoff.copy.caption, "This is the governed TikTok caption.");
  assert.deepEqual(handoff.copy.hashtags, ["#GamingNews", "#PulseGaming"]);
  assert.equal(handoff.creator_rewards.eligible, true);
  assert.equal(handoff.platform_control.auto_publish_enabled, false);
  assert.equal(handoff.platform_control.platform_state, "deferred_operator_handoff");
  assert.equal(handoff.platform_control.content_posting_api_status, "permission_unavailable");
  assert.equal(handoff.safety.posts_to_tiktok, false);
});

test("TikTok manual handoff writer emits hashed, operator-ready proof without network activity", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-manual-"));
  t.after(() => fs.remove(root));
  const artifactDir = path.join(root, "story-1");
  const outDir = path.join(root, "handoff");
  const videoPath = path.join(artifactDir, "tiktok-61s.mp4");
  const captionsPath = path.join(artifactDir, "captions.srt");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const planPath = path.join(root, "dry_run_publish_plan.json");
  await fs.ensureDir(artifactDir);
  await fs.writeFile(videoPath, "governed-video", "utf8");
  await fs.writeFile(captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nHello\n", "utf8");
  await fs.writeJson(canonicalPath, { story_id: "story-1" });
  await fs.writeJson(path.join(artifactDir, "tiktok_publish_pack.json"), {
    conversational_hook: "A specific hook.",
    caption: "A governed caption.",
    hashtags: ["#GamingNews", "#PulseGaming"],
    disclosure_flag: "not_required",
    commercial_content_setting_recommendation: "not_required_unless_brand_or_product_promoted",
  });
  await fs.writeJson(planPath, {
    actions: [
      {
        story_id: "story-1",
        platform: "tiktok",
        title: "Full uncut story title",
        video_path: videoPath,
        captions_path: captionsPath,
        canonical_manifest_path: canonicalPath,
        video_duration_s: 58.4,
        blockers: [],
      },
    ],
  });

  const result = await writeTikTokManualHandoff({
    planPath,
    outDir,
    contentPostingApiStatus: "permission_unavailable",
    now: new Date("2026-07-13T10:00:00.000Z"),
  });

  assert.equal(result.report.summary.total, 1);
  assert.equal(result.report.summary.ready, 1);
  assert.match(result.report.items[0].fingerprints.video_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.report.items[0].fingerprints.captions_sha256, /^[a-f0-9]{64}$/);
  assert.equal(await fs.pathExists(result.paths.json), true);
  assert.equal(await fs.pathExists(result.paths.markdown), true);
  assert.equal(await fs.pathExists(result.paths.caption), true);
  assert.equal(await fs.pathExists(result.paths.receipt), true);
  assert.equal(await fs.pathExists(result.paths.creatorRewardsWorkOrder), true);
  const workOrder = await fs.readJson(result.paths.creatorRewardsWorkOrder);
  assert.equal(workOrder.jobs.length, 1);
  assert.equal(workOrder.jobs[0].status, "needs_tiktok_creator_rewards_variant");
  assert.match(await fs.readFile(result.paths.caption, "utf8"), /A governed caption/);
});

test("TikTok manual handoff CLI accepts explicit proof paths and permission status", () => {
  assert.deepEqual(
    parseArgs([
      "--plan",
      "plan.json",
      "--out-dir",
      "handoff",
      "--story",
      "story-1",
      "--api-status",
      "permission_unavailable",
      "--json",
    ]),
    {
      planPath: "plan.json",
      outDir: "handoff",
      storyId: "story-1",
      contentPostingApiStatus: "permission_unavailable",
      json: true,
    },
  );
});
