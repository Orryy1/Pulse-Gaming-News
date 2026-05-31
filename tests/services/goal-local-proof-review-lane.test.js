"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalLocalProofReviewLane,
  writeGoalLocalProofReviewLane,
} = require("../../lib/goal-local-proof-review-lane");

const ROOT = path.resolve(__dirname, "..", "..");

async function reviewQueueFixture(root) {
  const artifactDir = path.join(root, "story-one");
  await fs.ensureDir(artifactDir);
  const videoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const captionsPath = path.join(artifactDir, "captions.srt");
  await fs.outputFile(videoPath, Buffer.alloc(2048, 1));
  await fs.outputFile(captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  return {
    schema_version: 1,
    generated_at: "2026-05-29T05:00:00.000Z",
    mode: "HUMAN_REVIEW",
    review_items: [
      {
        story_id: "story-one",
        artifact_dir: artifactDir,
        full_platform_verdict: "AMBER",
        enabled_review_platforms: ["youtube_shorts", "instagram_reels"],
        deferred_platforms: ["tiktok", "x"],
        public_copy: {
          title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
          thumbnail_headline: "FORZA STEAM BET",
          first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
          script_excerpt: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
        },
        source_list: {
          primary: { name: "Eurogamer", url: "https://www.eurogamer.net/forza-horizon-6-steam" },
        },
        evidence: {
          video_path: videoPath,
          captions_path: captionsPath,
          first_frame_source: videoPath,
          canonical_manifest_path: path.join(artifactDir, "canonical_story_manifest.json"),
          platform_publish_manifest_path: path.join(artifactDir, "platform_publish_manifest.json"),
        },
      },
    ],
    blocked_items: [],
  };
}

test("local proof review lane packages review videos as non-publish artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-proof-review-"));
  const queue = await reviewQueueFixture(root);
  const report = await buildGoalLocalProofReviewLane({
    humanReviewQueue: queue,
    generatedAt: "2026-05-29T05:01:00.000Z",
  });

  assert.equal(report.mode, "LOCAL_PROOF_REVIEW");
  assert.equal(report.summary.review_video_count, 1);
  assert.equal(report.summary.blocked_video_count, 0);
  assert.equal(report.safe_publish_plan.can_publish_from_local_proof, false);
  assert.equal(report.local_test_video_manifest.videos[0].story_id, "story-one");
  assert.equal(report.local_test_video_manifest.videos[0].publish_status, "not_publishable_local_proof");
  assert.equal(report.test_render_review_pack.items[0].operator_checks.includes("watch_video_before_any_publish_approval"), true);
  assert.equal(report.test_render_qa_report.items[0].status, "pass");
  assert.equal(report.test_render_qa_report.items[0].file_evidence.video_exists, true);
  assert.deepEqual(report.operator_feedback_log.decisions, []);
  assert.equal(report.safety.no_live_publish, true);
});

test("local proof review lane blocks missing review video files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-proof-missing-"));
  const queue = await reviewQueueFixture(root);
  await fs.remove(queue.review_items[0].evidence.video_path);

  const report = await buildGoalLocalProofReviewLane({
    humanReviewQueue: queue,
    generatedAt: "2026-05-29T05:02:00.000Z",
  });

  assert.equal(report.summary.review_video_count, 0);
  assert.equal(report.summary.blocked_video_count, 1);
  assert.equal(report.test_render_qa_report.items[0].status, "blocked");
  assert.ok(report.test_render_qa_report.items[0].blockers.includes("local_proof_video_missing"));
});

test("local proof review lane can build a first-seconds visual review manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-proof-visual-review-"));
  const queue = await reviewQueueFixture(root);
  const visualReviewDir = path.join(root, "visual-review");
  const extracted = [];
  const builtSheets = [];

  const report = await buildGoalLocalProofReviewLane({
    humanReviewQueue: queue,
    generatedAt: "2026-05-29T05:03:00.000Z",
    buildVisualReviewSheet: true,
    visualReviewDir,
    frameTimesS: [0, 1.5, 3],
    deps: {
      extractVideoFrame: async ({ inputPath, outputPath, timeS }) => {
        extracted.push({ inputPath, outputPath, timeS });
        await fs.outputFile(outputPath, Buffer.alloc(256, 2));
        return outputPath;
      },
      buildContactSheet: async ({ images, outPath }) => {
        builtSheets.push({ images, outPath });
        await fs.outputFile(outPath, Buffer.alloc(512, 3));
        return outPath;
      },
      analyseReviewFrame: async ({ framePath, storyId, timeS }) => ({
        story_id: storyId,
        time_s: timeS,
        path: framePath,
        verdict: "pass",
        blockers: [],
        risk_flags: [],
        metrics: {},
      }),
    },
  });

  assert.equal(report.summary.visual_review_frame_count, 3);
  assert.equal(report.visual_review_manifest.status, "ready");
  assert.equal(report.visual_review_manifest.contact_sheet_exists, true);
  assert.equal(report.visual_review_manifest.frames.length, 3);
  assert.deepEqual(report.visual_review_manifest.frame_times_s, [0, 1.5, 3]);
  assert.equal(extracted.length, 3);
  assert.equal(builtSheets[0].images.length, 3);
  assert.equal(report.visual_review_manifest.safety.live_publish_allowed, false);
});

test("local proof visual review blocks frame audit text-cutoff risks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-proof-frame-audit-"));
  const queue = await reviewQueueFixture(root);
  const visualReviewDir = path.join(root, "visual-review");

  const report = await buildGoalLocalProofReviewLane({
    humanReviewQueue: queue,
    generatedAt: "2026-05-29T05:04:00.000Z",
    buildVisualReviewSheet: true,
    visualReviewDir,
    frameTimesS: [0],
    deps: {
      extractVideoFrame: async ({ outputPath }) => {
        await fs.outputFile(outputPath, Buffer.alloc(256, 2));
        return outputPath;
      },
      buildContactSheet: async ({ outPath }) => {
        await fs.outputFile(outPath, Buffer.alloc(512, 3));
        return outPath;
      },
      analyseReviewFrame: async ({ framePath, storyId, timeS }) => ({
        story_id: storyId,
        time_s: timeS,
        path: framePath,
        verdict: "blocked",
        blockers: ["frame_text_cutoff_risk"],
        risk_flags: ["right_edge_bright_text"],
        metrics: { edge_bright_pixel_ratio: 0.08 },
      }),
    },
  });

  assert.equal(report.visual_review_manifest.status, "blocked");
  assert.ok(report.visual_review_manifest.blockers.includes("story-one:frame_text_cutoff_risk_t0"));
  assert.equal(report.visual_review_manifest.frame_audit[0].verdict, "blocked");
  assert.deepEqual(report.visual_review_manifest.frame_audit[0].risk_flags, ["right_edge_bright_text"]);
});

test("local proof review lane writes Goal 38 artefacts and CLI is registered", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-proof-write-"));
  const queue = await reviewQueueFixture(root);
  const queuePath = path.join(root, "human_review_queue.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(queuePath, queue);

  const report = await buildGoalLocalProofReviewLane({ humanReviewQueue: queue });
  const written = await writeGoalLocalProofReviewLane(report, { outputDir: outDir });
  assert.equal(await fs.pathExists(path.join(outDir, "local_test_video_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "test_render_review_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "operator_feedback_log.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "test_render_qa_report.json")), true);
  assert.equal(path.basename(written.localTestVideoManifestPath), "local_test_video_manifest.json");

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-local-proof-review-lane.js",
      "--human-review-queue",
      queuePath,
      "--out-dir",
      outDir,
      "--json",
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, PULSE_SKIP_DOTENV: "1" } },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.review_video_count, 1);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-local-proof-review"], "node tools/goal-local-proof-review-lane.js");
});
