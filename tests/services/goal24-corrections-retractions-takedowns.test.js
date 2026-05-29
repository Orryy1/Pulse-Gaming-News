"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSourceStatusReportFromStoryPackages,
  buildGoal24CorrectionsRetractionsTakedowns,
  writeGoal24CorrectionsRetractionsTakedowns,
} = require("../../lib/goal24-corrections-retractions-takedowns");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || `Story ${storyId}`,
    canonical_subject: overrides.subject || "Mixtape",
    primary_source_url: overrides.sourceUrl || `https://example.com/${storyId}`,
    primary_source: "Example News",
  });
  await fs.outputJson(path.join(artifactDir, "source_manifest.json"), {
    story_id: storyId,
    primary_source_url: overrides.sourceUrl || `https://example.com/${storyId}`,
    primary_source: "Example News",
    source_confidence_score: 0.9,
  });
  await fs.outputJson(path.join(artifactDir, "claim_inventory.json"), {
    story_id: storyId,
    confirmed_claims: [overrides.claim || "Release timing changed"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      youtube_shorts: { title: overrides.title || `Story ${storyId}` },
      instagram_reels: { caption: overrides.title || `Story ${storyId}` },
    },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    primary_link: { id: "controller", url: "https://www.amazon.co.uk/s?k=controller&tag=pulsegaming-21" },
    disclosure_required: true,
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    path: `/stories/${storyId}`,
    affiliate_modules: ["controller"],
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: overrides.title || `Story ${storyId}`,
    youtube_post_id: overrides.youtubePostId || null,
    youtube_url: overrides.youtubeUrl || null,
    instagram_media_id: overrides.instagramMediaId || null,
  };
}

function readyGoal23(...storyIds) {
  return {
    verdict: "PASS",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "ready",
      blockers: [],
    })),
  };
}

function blockedGoal23(...storyIds) {
  return {
    verdict: "BLOCKED",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "blocked",
      blockers: ["security:token_rotation_plan_missing"],
    })),
  };
}

function mixedGoal23({ ready = [], skipped = [] } = {}) {
  return {
    verdict: "PASS",
    stories: [
      ...ready.map((storyId) => ({ story_id: storyId, status: "ready", blockers: [] })),
      ...skipped.map((storyId) => ({ story_id: storyId, status: "skipped", skipped_reason: "upstream_duplicate" })),
    ],
  };
}

test("Goal 24 preserves Goal 23 blockers while direct correction monitoring passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-upstream-"));
  const story = await makeStoryPackage(root, "story-a");

  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [story],
    upstreamSecurityReport: blockedGoal23("story-a"),
    sourceStatusReport: {
      generated_at: "2026-05-26T06:38:01.097Z",
      stories: [{ story_id: "story-a", source_status: "unchanged" }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_corrections_verdict, "PASS");
  assert.equal(report.summary.correction_ready_story_count, 0);
  assert.equal(report.summary.direct_corrections_pass_story_count, 1);
  assert.ok(report.stories[0].blockers.includes("upstream:goal23_security_secrets_deployment_safety_blocked"));
  assert.ok(report.stories[0].blockers.includes("security:token_rotation_plan_missing"));
  assert.equal(report.correction_queue.items.length, 0);
  assert.equal(report.takedown_response_log.entries.length, 0);
});

test("Goal 24 preserves Goal 23 skipped stories instead of turning them into blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-skipped-"));
  const ready = await makeStoryPackage(root, "ready-story");
  const skipped = await makeStoryPackage(root, "skipped-story");

  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [ready, skipped],
    upstreamSecurityReport: mixedGoal23({ ready: ["ready-story"], skipped: ["skipped-story"] }),
    sourceStatusReport: {
      generated_at: "2026-05-26T06:38:01.097Z",
      stories: [{ story_id: "ready-story", source_status: "unchanged" }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.correction_ready_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.summary.correction_queue_item_count, 0);
  const skippedStory = report.stories.find((story) => story.story_id === "skipped-story");
  assert.equal(skippedStory.status, "skipped");
  assert.equal(skippedStory.upstream_status, "skipped");
  assert.deepEqual(skippedStory.blockers, []);
});

test("Goal 24 source-status report clears unpublished active stories without clearing skipped rows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-source-status-"));
  const ready = await makeStoryPackage(root, "ready-story");
  const skipped = await makeStoryPackage(root, "skipped-story");
  const sourceStatusReport = await buildSourceStatusReportFromStoryPackages({
    storyPackages: [ready, skipped],
    upstreamSecurityReport: mixedGoal23({ ready: ["ready-story"], skipped: ["skipped-story"] }),
    workspaceRoot: root,
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(sourceStatusReport.stories.length, 1);
  assert.equal(sourceStatusReport.summary.current_count, 1);
  assert.equal(sourceStatusReport.summary.skipped_story_count, 1);
  assert.equal(sourceStatusReport.stories[0].story_id, "ready-story");
  assert.equal(sourceStatusReport.stories[0].source_status, "current");
  assert.equal(sourceStatusReport.stories[0].monitor_status, "baseline_from_locked_source");

  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [ready, skipped],
    upstreamSecurityReport: mixedGoal23({ ready: ["ready-story"], skipped: ["skipped-story"] }),
    sourceStatusReport,
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.correction_ready_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
});

test("Goal 24 source-status report does not auto-clear already public stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-public-source-status-"));
  const story = await makeStoryPackage(root, "public-story", {
    youtubePostId: "yt-123",
    youtubeUrl: "https://youtube.example/watch?v=yt-123",
  });
  const sourceStatusReport = await buildSourceStatusReportFromStoryPackages({
    storyPackages: [story],
    upstreamSecurityReport: readyGoal23("public-story"),
    workspaceRoot: root,
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(sourceStatusReport.stories[0].source_status, "unknown");
  assert.equal(sourceStatusReport.stories[0].monitor_status, "live_public_source_check_required");

  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [story],
    upstreamSecurityReport: readyGoal23("public-story"),
    sourceStatusReport,
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].direct_corrections_blockers.includes("corrections:source_status_unknown"));
});

test("Goal 24 turns debunked source signals into draft-only correction and takedown plans", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-debunked-"));
  const story = await makeStoryPackage(root, "story-b", {
    title: "Mixtape Release Date Changed",
    youtubePostId: "yt-123",
    youtubeUrl: "https://youtube.example/watch?v=yt-123",
    instagramMediaId: "ig-123",
  });

  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [story],
    upstreamSecurityReport: readyGoal23("story-b"),
    sourceStatusReport: {
      generated_at: "2026-05-26T06:38:01.097Z",
      stories: [
        {
          story_id: "story-b",
          source_status: "debunked",
          severity: "high",
          reason: "Publisher denied the reported release window.",
          affected_claims: ["Release timing changed"],
          evidence_url: "https://example.com/correction",
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_corrections_verdict, "BLOCKED");
  assert.ok(report.stories[0].direct_corrections_blockers.includes("corrections:human_authorisation_required"));
  assert.equal(report.affected_content_report.affected_items.length, 1);
  assert.equal(report.affected_content_report.affected_items[0].recommended_public_status, "escalate_unlist_review");
  assert.equal(report.correction_queue.items[0].status, "needs_operator_review");
  assert.ok(report.correction_plan.description_updates.length >= 1);
  assert.ok(report.correction_plan.pinned_comment_corrections.length >= 1);
  assert.ok(report.correction_plan.landing_page_changes.length >= 1);
  assert.ok(report.correction_plan.affiliate_disablements.length >= 1);
  assert.equal(report.takedown_response_log.entries[0].status, "draft_not_sent");
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 24 blocks missing source-status evidence instead of faking clear corrections", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-missing-"));
  const story = await makeStoryPackage(root, "story-c");

  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [story],
    upstreamSecurityReport: readyGoal23("story-c"),
    sourceStatusReport: {},
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_corrections_verdict, "BLOCKED");
  assert.ok(report.stories[0].direct_corrections_blockers.includes("corrections:source_status_signal_missing"));
  assert.equal(report.correction_queue.items[0].action, "collect_current_source_status");
});

test("Goal 24 writes all required correction artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal24-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const report = await buildGoal24CorrectionsRetractionsTakedowns({
    storyPackages: [story],
    upstreamSecurityReport: readyGoal23("story-write"),
    sourceStatusReport: {
      generated_at: "2026-05-26T06:38:01.097Z",
      stories: [{ story_id: "story-write", source_status: "unchanged" }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T06:38:01.097Z",
  });
  const written = await writeGoal24CorrectionsRetractionsTakedowns(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.correctionQueue), true);
  assert.equal(await fs.pathExists(written.affectedContentReport), true);
  assert.equal(await fs.pathExists(written.correctionPlan), true);
  assert.equal(await fs.pathExists(written.takedownResponseLog), true);
});
