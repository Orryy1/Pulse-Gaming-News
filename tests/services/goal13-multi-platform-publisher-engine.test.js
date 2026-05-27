"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_PLATFORMS,
  buildGoal13MultiPlatformPublisherEngine,
  writeGoal13MultiPlatformPublisherEngine,
} = require("../../lib/goal13-multi-platform-publisher-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const title = overrides.title || "The Expanse Shows Real Gameplay";
  const subject = overrides.subject || "The Expanse: Osiris Reborn";
  const route = overrides.route === false ? "" : `/p/${storyId}`;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: title,
    canonical_title: title,
    canonical_subject: subject,
    first_spoken_line: `${subject} finally showed real gameplay.`,
    primary_source: { name: "Xbox Wire", url: "https://news.xbox.com/example" },
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: storyId,
    disclosure_required: overrides.disclosureRequired !== false,
    relevance_verdict: overrides.affiliateRelevance || "pass",
    primary_link: overrides.affiliateLink || null,
    disclosure_copy: {
      short: "Affiliate links may earn us a commission.",
      landing: "Affiliate links may earn us a commission.",
    },
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: storyId,
    landing_page_slug: route ? storyId : "",
    landing_page_route: route,
    attribution_manifest: overrides.tracking === false
      ? { verdict: "missing", platforms: {} }
      : {
          verdict: "pass",
          platforms: Object.fromEntries(
            [
              ["youtube", "youtube"],
              ["tiktok", "tiktok"],
              ["instagram", "instagram"],
              ["facebook", "facebook"],
              ["x", "x"],
              ["threads", "threads"],
              ["pinterest", "pinterest"],
            ].map(([key, source]) => [
              key,
              {
                platform: key,
                tracking_key: `${storyId}:${source}:story_page`,
                landing_page_url: `/p/${storyId}?utm_source=${source}&utm_medium=social&utm_campaign=${storyId}`,
                disclosure_required: overrides.disclosureRequired !== false,
                disclosure_copy: "Affiliate links may earn us a commission.",
              },
            ]),
          ),
        },
    disclosure_block: {
      required: overrides.disclosureRequired !== false,
      copy: { short: "Affiliate links may earn us a commission." },
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    status: overrides.policyStatus || "pass",
    risks: overrides.policyRisk ? [{ severity: "high", reason: "policy risk" }] : [],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    platform_native_evidence: overrides.nativeEvidence || {
      verdict: "pass",
      blind_duplicate_pairs: [],
      platforms: REQUIRED_PLATFORMS.map((platform) => ({ platform, verdict: "pass" })),
    },
    outputs: overrides.outputs || nativeOutputs({ title, subject, route }),
  });
  return { story_id: storyId, artifact_dir: artifactDir, title };
}

function nativeOutputs({ title, subject, route }) {
  const disclosureStatus = {
    required: true,
    type: "affiliate",
    caption: "Affiliate links may earn us a commission.",
  };
  return {
    youtube_shorts: {
      title,
      description: `${subject} finally showed real gameplay. Source and links: ${route}`,
      hashtags: ["#GamingNews", "#PulseGaming"],
      cover_frame: { headline: "EXPANSE GAMEPLAY", subject },
      captions: { file: "captions.srt" },
      disclosure_status: disclosureStatus,
      profile_or_landing_page_cta: `Story page: ${route}`,
    },
    tiktok: {
      conversational_hook: `${subject} finally showed real gameplay.`,
      caption: `${subject} finally showed real gameplay. Source: Xbox Wire.`,
      hashtags: ["#GamingTok", "#PulseGaming"],
      disclosure_flag: "commercial_content_disclosure_required",
      commercial_content_setting_recommendation: "required_for_affiliate_or_brand_promotion",
    },
    instagram_reels: {
      cover_frame: { headline: "EXPANSE GAMEPLAY", subject },
      caption: `${subject} finally showed real gameplay. Source: Xbox Wire.`,
      carousel_companion: { required: true, cards: ["cover", "source", "context"] },
      story_poll_idea: "Does this change your watchlist?",
      bio_link_cta: `Story page in bio: ${route}`,
      disclosure_status: disclosureStatus,
    },
    facebook_reels: {
      explanatory_framing: "Xbox Wire showed the gameplay proof.",
      page_caption: `${subject} finally showed real gameplay. Source: Xbox Wire.`,
      link_routing_strategy: `page_caption_or_comment_link:${route}`,
      disclosure_status: disclosureStatus,
    },
    x: {
      hot_take_post: `${title}. The useful next beat is what players can actually play.`,
      source_safe_post: `${title}\n\nSource: Xbox Wire.`,
      thread_posts: [title, `${subject} finally showed real gameplay.`, "Source: Xbox Wire."],
      poll_candidate: "Is this a buy-now story or a wait-for-reviews story?",
      landing_page_link: route,
    },
    threads: {
      discussion_post: `${subject} finally showed real gameplay. Xbox Wire has the report, and the next useful proof is hands-on footage.`,
      duplicate_x_wording_allowed: false,
      tone: "discussion-led and source-safe",
      landing_page_link: route,
      disclosure_status: disclosureStatus,
    },
    pinterest: {
      pin_title: title,
      pin_description: `${subject} finally showed real gameplay. Source: Xbox Wire.`,
      evergreen_only: true,
      disclosure: "Affiliate links may earn us a commission.",
      landing_page_required: true,
      landing_page_link: route,
    },
  };
}

function blockedExperimentReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["experiment:variant_metrics_missing"],
      },
    ],
  };
}

function readyExperimentReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "ready",
        blockers: [],
      },
    ],
  };
}

test("Goal 13 blocks full readiness when Goal 12 is blocked but preserves dry-run platform plans", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal13-upstream-blocked-"));
  const story = await makeStoryPackage(root, "story-blocked");

  const report = await buildGoal13MultiPlatformPublisherEngine({
    storyPackages: [story],
    upstreamExperimentReport: blockedExperimentReport("story-blocked"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T01:06:16.330Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.platform_package_plan_story_count, 1);
  assert.equal(report.summary.direct_platform_pass_story_count, 1);
  assert.equal(report.summary.platform_ready_story_count, 0);
  assert.equal(report.platform_publish_manifest.mode, "DRY_RUN_PUBLISH");
  assert.equal(report.scheduled_posts.publish_now_count, 0);
  assert.equal(report.scheduled_posts.posts[0].status, "blocked_by_upstream");
  assert.ok(report.stories[0].blockers.includes("upstream:goal12_experimentation_engine_blocked"));
  assert.deepEqual(
    Object.keys(report.platform_publish_manifest.stories[0].platform_outputs).sort(),
    [...REQUIRED_PLATFORMS].sort(),
  );
  assert.equal(report.analytics_ingest_plan.status, "blocked_until_publish_and_upstream_ready");
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_external_posting, true);
  assert.equal(report.safety.dry_run_publish_only, true);
});

test("Goal 13 hard-fails duplicate, disclosure, title, affiliate, policy, tracking and landing risks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal13-hard-fails-"));
  const duplicateOutputs = nativeOutputs({
    title: "This Gaming Story",
    subject: "This gaming story",
    route: "",
  });
  duplicateOutputs.x.source_safe_post = "This gaming story needs a look.";
  duplicateOutputs.x.hot_take_post = "This gaming story needs a look.";
  duplicateOutputs.x.landing_page_link = "";
  duplicateOutputs.threads.discussion_post = "This gaming story needs a look.";
  duplicateOutputs.threads.landing_page_link = "";
  duplicateOutputs.youtube_shorts.disclosure_status = null;
  duplicateOutputs.instagram_reels.disclosure_status = null;
  duplicateOutputs.facebook_reels.disclosure_status = null;
  duplicateOutputs.tiktok.disclosure_flag = "";
  duplicateOutputs.tiktok.commercial_content_setting_recommendation = "";
  duplicateOutputs.pinterest.disclosure = "";
  duplicateOutputs.pinterest.landing_page_link = "";
  await makeStoryPackage(root, "story-risk", {
    title: "This Gaming Story",
    subject: "This gaming story",
    route: false,
    tracking: false,
    affiliateRelevance: "unrelated",
    policyStatus: "fail",
    policyRisk: true,
    nativeEvidence: {
      verdict: "fail",
      blind_duplicate_pairs: [["x", "threads"]],
      platforms: [],
    },
    outputs: duplicateOutputs,
  });

  const report = await buildGoal13MultiPlatformPublisherEngine({
    storyPackages: [{ story_id: "story-risk", artifact_dir: path.join(root, "story-risk") }],
    upstreamExperimentReport: readyExperimentReport("story-risk"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T01:06:16.330Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].direct_platform_status, "blocked");
  for (const blocker of [
    "platform:blind_duplicate",
    "platform:missing_disclosure",
    "platform:generic_title",
    "platform:unrelated_affiliate_link",
    "platform:policy_risk",
    "platform:anti_spam_risk",
    "platform:missing_tracking",
    "platform:missing_landing_page",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
  }
  assert.ok(report.platform_risk_report.risks.length >= 8);
});

test("Goal 13 writes required publisher artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal13-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal13MultiPlatformPublisherEngine({
    storyPackages: [story],
    upstreamExperimentReport: blockedExperimentReport("story-write"),
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T01:06:16.330Z",
  });

  const written = await writeGoal13MultiPlatformPublisherEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.platformPublishManifest), true);
  assert.equal(await fs.pathExists(written.platformVariantScorecard), true);
  assert.equal(await fs.pathExists(written.scheduledPosts), true);
  assert.equal(await fs.pathExists(written.platformRiskReport), true);
  assert.equal(await fs.pathExists(written.analyticsIngestPlan), true);
  const scheduled = await fs.readJson(written.scheduledPosts);
  assert.equal(scheduled.mode, "DRY_RUN_PUBLISH");
  assert.equal(scheduled.publish_now_count, 0);
});
