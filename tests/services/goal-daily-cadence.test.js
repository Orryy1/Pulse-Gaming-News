"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalDailyCadencePlan,
  writeGoalDailyCadencePlan,
} = require("../../lib/goal-daily-cadence");

const ROOT = path.resolve(__dirname, "..", "..");

async function makeReviewItem(root, storyId, quality = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const title = quality.title || `${storyId} Strong Gaming Angle`;
  const canonicalSubject = quality.canonicalSubject || storyId;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: canonicalSubject,
    selected_title: title,
    thumbnail_headline: `${canonicalSubject.toUpperCase()} ANGLE`,
    first_spoken_line: `${canonicalSubject} starts fast with a clear player consequence.`,
    narration_script: `${canonicalSubject} starts fast with a clear player consequence. The source points to a clear signal worth watching today.`,
    description: `${canonicalSubject} has a source-safe gaming angle. Source: Eurogamer.`,
    primary_source: { name: "Eurogamer", url: "https://www.eurogamer.net/example" },
    discovery_source: { name: "RSS", url: "https://www.eurogamer.net/feed" },
    ...(quality.canonical || {}),
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: quality.publishVerdict || "GREEN",
    can_auto_publish: true,
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), {
    viral_score: quality.scriptScore ?? 84,
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: {
      media_house_polish_score: quality.visualScore ?? 92,
      first_3_seconds_hook_score: quality.firstThreeScore ?? 88,
      motion_density_score: quality.motionScore ?? 95,
    },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    scores: {
      first_3_seconds_hook_score: quality.firstThreeScore ?? 88,
      motion_density_score: quality.motionScore ?? 95,
    },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "coherence_report.json"), {
    result: quality.coherence || "pass",
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), {
    verdict: quality.uniqueness || "pass",
    failures: [],
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    full_platform_verdict: "AMBER",
    enabled_platform_verdict: quality.enabledVerdict || "GREEN",
    publish_now_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    deferred_platforms: ["tiktok", "x"],
    public_copy: {
      title,
      thumbnail_headline: `${storyId.toUpperCase()} ANGLE`,
      first_spoken_line: `${storyId} starts fast.`,
    },
    approval: {
      operator_approval_required: true,
      live_publish_allowed_before_approval: false,
    },
  };
}

test("daily cadence plans three reviewed V4 stories into canonical windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cadence-"));
  const reviewItems = [
    await makeReviewItem(root, "story-a", { scriptScore: 82, visualScore: 90 }),
    await makeReviewItem(root, "story-b", { scriptScore: 88, visualScore: 94 }),
    await makeReviewItem(root, "story-c", { scriptScore: 80, visualScore: 91 }),
    await makeReviewItem(root, "story-d", { scriptScore: 78, visualScore: 88 }),
  ];

  const plan = await buildGoalDailyCadencePlan({
    humanReviewQueue: { review_items: reviewItems },
    generatedAt: "2026-05-22T08:00:00.000Z",
    targetDailyShorts: 3,
  });

  assert.equal(plan.daily_content_plan.planned_story_count, 3);
  assert.equal(plan.publish_schedule.length, 3);
  assert.deepEqual(
    plan.publish_schedule.map((slot) => slot.scheduled_for_utc),
    [
      "2026-05-22T09:00:00.000Z",
      "2026-05-22T14:00:00.000Z",
      "2026-05-22T19:00:00.000Z",
    ],
  );
  assert.equal(plan.publish_schedule[0].operating_mode, "HUMAN_REVIEW");
  assert.equal(plan.publish_schedule[0].requires_operator_approval, true);
  assert.deepEqual(plan.publish_schedule[0].counted_delivery_platforms, [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ]);
  assert.deepEqual(plan.publish_schedule[0].deferred_platforms_not_counted, ["tiktok", "x"]);
  assert.equal(plan.cadence_quality_report.verdict, "AMBER");
  assert.equal(plan.cadence_quality_report.autonomous_publish_ready, false);
  assert.ok(plan.cadence_quality_report.gates.no_disabled_platform_counted_as_delivered);
});

test("daily cadence rejects weak or non-GREEN review packets instead of filling slots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cadence-reject-"));
  const strong = await makeReviewItem(root, "strong-story", { scriptScore: 84, visualScore: 93 });
  const weakScript = await makeReviewItem(root, "weak-script", { scriptScore: 60, visualScore: 93 });
  const weakVisual = await makeReviewItem(root, "weak-visual", { scriptScore: 84, visualScore: 70 });
  const redEnabled = await makeReviewItem(root, "red-enabled", { scriptScore: 90, visualScore: 90, enabledVerdict: "RED" });

  const plan = await buildGoalDailyCadencePlan({
    humanReviewQueue: { review_items: [strong, weakScript, weakVisual, redEnabled] },
    generatedAt: "2026-05-22T08:00:00.000Z",
    targetDailyShorts: 3,
  });

  assert.equal(plan.daily_content_plan.planned_story_count, 1);
  assert.equal(plan.daily_content_plan.rejected_items.length, 3);
  assert.equal(plan.cadence_quality_report.verdict, "RED");
  assert.ok(
    plan.daily_content_plan.rejected_items.find((item) => item.story_id === "weak-script").blockers.includes("script_score_below_threshold"),
  );
  assert.ok(
    plan.daily_content_plan.rejected_items.find((item) => item.story_id === "weak-visual").blockers.includes("visual_score_below_threshold"),
  );
  assert.ok(
    plan.daily_content_plan.rejected_items.find((item) => item.story_id === "red-enabled").blockers.includes("enabled_platform_verdict_not_green"),
  );
});

test("daily cadence ignores stale failure arrays when current artefact verdicts and incident guard pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cadence-stale-reports-"));
  const item = await makeReviewItem(root, "stale-report-story", {
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    canonicalSubject: "Forza Horizon 6",
  });
  await fs.outputJson(path.join(item.artifact_dir, "visual_quality_report.json"), {
    result: "pass",
    scores: {
      media_house_polish_score: 92,
      first_3_seconds_hook_score: 88,
      motion_density_score: 95,
    },
    failures: ["old_visual_failure_before_refresh"],
  });
  await fs.outputJson(path.join(item.artifact_dir, "benchmark_report.json"), {
    result: "pass",
    scores: {
      first_3_seconds_hook_score: 88,
      motion_density_score: 95,
    },
    failures: ["old_benchmark_failure_before_refresh"],
  });
  await fs.outputJson(path.join(item.artifact_dir, "coherence_report.json"), {
    result: "fail",
    failures: ["old_thumbnail_subject_failure_before_public_copy_repair"],
  });

  const plan = await buildGoalDailyCadencePlan({
    humanReviewQueue: { review_items: [item] },
    generatedAt: "2026-05-26T08:30:00.000Z",
    targetDailyShorts: 1,
  });

  assert.equal(plan.daily_content_plan.planned_story_count, 1);
  assert.equal(plan.daily_content_plan.rejected_items.length, 0);
  assert.deepEqual(plan.daily_content_plan.planned_items[0].blockers, []);
});

test("daily cadence still rejects current public-copy coherence failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cadence-current-coherence-"));
  const item = await makeReviewItem(root, "bad-copy-story", {
    title: "This gaming story",
    canonicalSubject: "Forza Horizon 6",
    canonical: {
      selected_title: "This gaming story",
      thumbnail_headline: "BIG UPDATE",
      first_spoken_line: "This gaming story starts now.",
      narration_script: "This gaming story starts now. The safest public version is still being checked.",
    },
  });

  const plan = await buildGoalDailyCadencePlan({
    humanReviewQueue: { review_items: [item] },
    generatedAt: "2026-05-26T08:35:00.000Z",
    targetDailyShorts: 1,
  });

  assert.equal(plan.daily_content_plan.planned_story_count, 0);
  assert.equal(plan.daily_content_plan.rejected_items.length, 1);
  assert.ok(plan.daily_content_plan.rejected_items[0].blockers.includes("coherence_not_pass"));
  assert.ok(plan.daily_content_plan.rejected_items[0].blockers.includes("quality_report_failures_present"));
});

test("daily cadence writes required planning artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cadence-write-"));
  const item = await makeReviewItem(root, "story-a");
  const plan = await buildGoalDailyCadencePlan({
    humanReviewQueue: { review_items: [item] },
    generatedAt: "2026-05-22T08:00:00.000Z",
    targetDailyShorts: 1,
  });
  const written = await writeGoalDailyCadencePlan(plan, { outputDir: root });

  assert.equal(await fs.pathExists(path.join(root, "daily_content_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "publish_schedule.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "cadence_quality_report.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "daily_content_plan.md")), true);
  assert.equal(path.basename(written.dailyContentPlanPath), "daily_content_plan.json");
});

test("daily cadence CLI is registered and emits clean JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-cadence-cli-"));
  const item = await makeReviewItem(root, "story-a");
  const queuePath = path.join(root, "human_review_queue.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(queuePath, { review_items: [item] }, { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    ["tools/goal-daily-cadence.js", "--human-review-queue", queuePath, "--out-dir", outDir, "--target-daily-shorts", "1", "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trimStart().startsWith("{"), result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.daily_content_plan.planned_story_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "publish_schedule.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-daily-cadence"], "node tools/goal-daily-cadence.js");
});
