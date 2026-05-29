"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_DASHBOARD_FIELDS,
  buildGoal21ObservabilityDashboard,
  writeGoal21ObservabilityDashboard,
} = require("../../lib/goal21-observability-dashboard");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || `Story ${storyId}`,
    primary_source: overrides.primarySource || "Xbox",
    source_confidence_score: overrides.sourceConfidence ?? 0.91,
    canonical_angle: "Confirmed Drop",
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), {
    story_id: storyId,
    verdict: "pass",
    viral_score: 84,
    scores: {
      hook_strength: overrides.hookScore ?? 88,
      retention_pacing: 82,
      source_safety: 90,
    },
    blockers: [],
    warnings: [],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    render_time_ms: overrides.renderTimeMs,
    rendered_duration_s: 44.8,
    generated_at: "2026-05-26T05:07:35.093Z",
    no_publish_triggered: true,
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    story_id: storyId,
    result: "pass",
    scores: {
      motion_density_score: 91,
      first_3_seconds_hook_score: 86,
      media_house_polish_score: 90,
    },
    failures: [],
    warnings: [],
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    story_id: storyId,
    result: "pass",
    scores: {
      motion_density_score: 91,
      first_3_seconds_hook_score: 86,
      media_house_polish_score: 90,
    },
    failures: [],
    warnings: [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    story_id: storyId,
    verdict: "pass",
    failures: [],
    warnings: [],
    risk_score: 8,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    failures: [],
    warnings: [],
    rights_risk_score: 12,
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    verdict: "pass",
    failures: [],
    warnings: [],
    disclosure_required: true,
    affiliate_risk_score: 5,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: { title: `Story ${storyId}` },
      tiktok: { caption: `Story ${storyId}` },
      instagram_reels: { caption: `Story ${storyId}` },
    },
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
    warnings: [],
    safety: { no_publish_triggered: true },
  });

  if (overrides.liveMetrics !== false) {
    await fs.outputJson(path.join(artifactDir, "analytics_performance_report.json"), {
      story_id: storyId,
      platform_performance: {
        youtube_shorts: { views: 1000, likes: 44, comments: 6, shares: 20 },
      },
      retention: {
        average_view_duration_seconds: 32.5,
        retention_curve: [1, 0.82, 0.69, 0.55, 0.43],
        first_3_second_drop_off: 0.12,
      },
      views: 1000,
      followers: 14,
      comments: 6,
      shares: 20,
      clicks: 31,
    });
  }

  if (overrides.revenueMetrics !== false) {
    await fs.outputJson(path.join(artifactDir, "revenue_attribution_report.json"), {
      story_id: storyId,
      currency: "GBP",
      cost: { amount: 7.25, source: "local_cost_fixture" },
      revenue: { amount: 18.5, source: "local_revenue_fixture" },
      profit: { amount: 11.25, source: "computed_fixture" },
    });
  }

  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: overrides.title || `Story ${storyId}`,
  };
}

function readyGoal20(...storyIds) {
  return {
    verdict: "PASS",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "ready",
      direct_uniqueness_status: "pass",
      blockers: [],
      warnings: [],
    })),
  };
}

function blockedGoal20(...storyIds) {
  return {
    verdict: "BLOCKED",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "blocked",
      direct_uniqueness_status: "blocked",
      blockers: ["anti_spam:repeated_title_structure"],
      warnings: ["anti_spam:layout_reused"],
    })),
  };
}

function skippedGoal20(storyId) {
  return {
    verdict: "PARTIAL",
    stories: [
      {
        story_id: storyId,
        status: "skipped",
        skipped_status: "anti_spam_duplicate_deferred",
        skipped_reason: "deferred_by_goal20_duplicate_cluster",
        blockers: [],
        warnings: [],
      },
    ],
  };
}

test("Goal 21 preserves Goal 20 blockers while complete observability checks pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-upstream-"));
  const story = await makeStoryPackage(root, "story-a", { renderTimeMs: 18342 });

  const report = await buildGoal21ObservabilityDashboard({
    storyPackages: [story],
    upstreamAntiSpamReport: blockedGoal20("story-a"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:07:35.093Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_observability_verdict, "PASS");
  assert.equal(report.summary.observability_ready_story_count, 0);
  assert.equal(report.summary.direct_observability_pass_story_count, 1);
  assert.equal(report.summary.publish_now_count, 0);
  assert.ok(report.stories[0].blockers.includes("upstream:goal20_anti_spam_uniqueness_blocked"));
  assert.ok(report.stories[0].blockers.includes("anti_spam:repeated_title_structure"));
  for (const field of REQUIRED_DASHBOARD_FIELDS) {
    assert.ok(Object.hasOwn(report.dashboard_model.summary, field), field);
  }
  assert.equal(report.dashboard_model.stories[0].metrics.views.value, 1000);
  assert.equal(report.revenue_report.stories[0].profit.value, 11.25);
  assert.equal(report.blocked_content_report.stories[0].story_id, "story-a");
});

test("Goal 21 treats unpublished live metrics as unavailable without faking zero revenue or profit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-missing-"));
  const story = await makeStoryPackage(root, "story-b", {
    liveMetrics: false,
    revenueMetrics: false,
  });

  const report = await buildGoal21ObservabilityDashboard({
    storyPackages: [story],
    upstreamAntiSpamReport: readyGoal20("story-b"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:07:35.093Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_observability_verdict, "PASS");
  assert.deepEqual(report.stories[0].direct_observability_blockers, []);
  assert.equal(report.stories[0].metrics.views.status, "not_available");
  assert.equal(report.stories[0].metrics.revenue.value, null);
  assert.equal(report.stories[0].metrics.profit.value, null);
  assert.equal(report.revenue_report.totals.revenue.status, "not_available");
  assert.equal(report.revenue_report.totals.revenue.value, null);
});

test("Goal 21 uses aggregate platform policy evidence when per-story policy files are absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-policy-index-"));
  const story = await makeStoryPackage(root, "story-policy", {
    liveMetrics: false,
    revenueMetrics: false,
  });
  await fs.remove(path.join(story.artifact_dir, "platform_policy_report.json"));

  const report = await buildGoal21ObservabilityDashboard({
    storyPackages: [story],
    upstreamAntiSpamReport: readyGoal20("story-policy"),
    upstreamPlatformPolicyReport: {
      stories: [
        {
          story_id: "story-policy",
          status: "pass",
          blockers: [],
          checks: {
            affiliate_disclosure: { status: "pass", blockers: [] },
            x_automation_spam: { status: "pass", blockers: [] },
          },
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T02:34:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_observability_verdict, "PASS");
  assert.equal(report.stories[0].metrics.policy_risk.status, "available");
  assert.equal(report.stories[0].metrics.policy_risk.value.verdict, "pass");
  assert.deepEqual(report.blocker_counts, {});
});

test("Goal 21 excludes upstream-skipped stories from active observability blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-skipped-"));
  const story = await makeStoryPackage(root, "story-skipped", {
    liveMetrics: false,
    revenueMetrics: false,
  });

  const report = await buildGoal21ObservabilityDashboard({
    storyPackages: [story],
    upstreamAntiSpamReport: skippedGoal20("story-skipped"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T02:21:00.000Z",
  });

  assert.equal(report.verdict, "FAIL");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.active_story_count, 0);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.stories[0].status, "skipped");
  assert.equal(report.stories[0].skipped_status, "anti_spam_duplicate_deferred");
  assert.deepEqual(report.blocker_counts, {});
});

test("Goal 21 aggregates recurring failure reasons into blocked-content reporting", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-aggregate-"));
  const storyA = await makeStoryPackage(root, "story-a", { liveMetrics: false, revenueMetrics: false });
  const storyB = await makeStoryPackage(root, "story-b", { renderTimeMs: 10000 });

  const report = await buildGoal21ObservabilityDashboard({
    storyPackages: [storyA, storyB],
    upstreamAntiSpamReport: {
      verdict: "PARTIAL",
      stories: [
        ...readyGoal20("story-a").stories,
        ...blockedGoal20("story-b").stories,
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:07:35.093Z",
  });

  assert.equal(report.blocked_content_report.summary.blocked_story_count, 1);
  assert.equal(report.recurring_failure_reasons["observability:views_missing"], undefined);
  assert.equal(report.recurring_failure_reasons["upstream:goal20_anti_spam_uniqueness_blocked"], 1);
  assert.equal(report.recurring_failure_reasons["anti_spam:repeated_title_structure"], 1);
});

test("Goal 21 writes required observability artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal21-write-"));
  const story = await makeStoryPackage(root, "story-write", { renderTimeMs: 12000 });
  const report = await buildGoal21ObservabilityDashboard({
    storyPackages: [story],
    upstreamAntiSpamReport: readyGoal20("story-write"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T05:07:35.093Z",
  });
  const written = await writeGoal21ObservabilityDashboard(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.dashboardModel), true);
  assert.equal(await fs.pathExists(written.reportingEndpoints), true);
  assert.equal(await fs.pathExists(written.dailyStudioReport), true);
  assert.equal(await fs.pathExists(written.weeklyPerformanceReport), true);
  assert.equal(await fs.pathExists(written.blockedContentReport), true);
  assert.equal(await fs.pathExists(written.revenueReport), true);
});
