"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal14SocialDerivativesEngine,
  writeGoal14SocialDerivativesEngine,
} = require("../../lib/goal14-social-derivatives-engine");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  const title = overrides.title || "The Expanse Shows Real Gameplay";
  const subject = overrides.subject || "The Expanse: Osiris Reborn";
  const route = `/p/${storyId}`;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: title,
    canonical_title: title,
    canonical_subject: subject,
    first_spoken_line: `${subject} finally showed real gameplay.`,
    primary_source: { name: "Xbox Wire", url: "https://news.xbox.com/example" },
    suggested_thumbnail_text: "EXPANSE GAMEPLAY",
  });
  const outputs = overrides.outputs || socialOutputs({ title, subject, route });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    outputs: {
      x: outputs.x,
      instagram_reels: outputs.instagram,
      threads: outputs.threads,
    },
  });
  await fs.outputJson(path.join(artifactDir, "x_publish_pack.json"), outputs.x);
  await fs.outputJson(path.join(artifactDir, "instagram_publish_pack.json"), outputs.instagram);
  await fs.outputJson(path.join(artifactDir, "threads_publish_pack.json"), outputs.threads);
  await fs.outputJson(path.join(artifactDir, "image_card_manifest.json"), overrides.imageCards || {
    story_id: storyId,
    platforms: ["x", "instagram", "threads"],
    headline: "EXPANSE GAMEPLAY",
  });
  await fs.outputJson(path.join(artifactDir, "carousel_manifest.json"), overrides.carousel || {
    platform: "instagram",
    story_id: storyId,
    cards: ["cover", "source", "impact", "related_links"],
  });
  return { story_id: storyId, artifact_dir: artifactDir, title };
}

function socialOutputs({ title, subject, route }) {
  return {
    x: {
      hot_take_post: `${title}. The useful next beat is what players can actually play.`,
      source_safe_post: `${title}\n\nSource: Xbox Wire.`,
      concise_news_post: `${subject} finally showed real gameplay.`,
      thread_posts: [title, `${subject} finally showed real gameplay.`, "Source: Xbox Wire."],
      poll_candidate: "Is this a buy-now story or a wait-for-reviews story?",
      landing_page_link: route,
    },
    instagram: {
      cover_frame: { headline: "EXPANSE GAMEPLAY", subject, source_label: "Xbox Wire" },
      caption: `${subject} finally showed real gameplay. Source: Xbox Wire.`,
      carousel_companion: { required: true, cards: ["cover", "source", "context"] },
      story_poll_idea: "Does this change your watchlist?",
      bio_link_cta: `Story page in bio: ${route}`,
    },
    threads: {
      discussion_post: `${subject} finally showed real gameplay. Xbox Wire has the report, and the next useful proof is hands-on footage.`,
      duplicate_x_wording_allowed: false,
      tone: "discussion-led and source-safe",
      landing_page_link: route,
      automated_replies_allowed: false,
    },
  };
}

function blockedPublisherReport(storyId) {
  return {
    stories: [
      {
        story_id: storyId,
        status: "blocked",
        blockers: ["upstream:goal12_experimentation_engine_blocked"],
      },
    ],
  };
}

function readyPublisherReport(storyId) {
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

test("Goal 14 prepares social derivatives but blocks full readiness when Goal 13 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-upstream-blocked-"));
  const story = await makeStoryPackage(root, "story-blocked");

  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [story],
    upstreamPublisherReport: blockedPublisherReport("story-blocked"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T01:36:27.172Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.direct_derivative_pass_story_count, 1);
  assert.equal(report.summary.social_derivative_ready_story_count, 0);
  assert.equal(report.summary.x_pack_story_count, 1);
  assert.equal(report.summary.instagram_pack_story_count, 1);
  assert.equal(report.summary.threads_pack_story_count, 1);
  assert.equal(report.x_publish_pack.stories[0].thread_posts.length, 3);
  assert.ok(report.x_publish_pack.stories[0].poll_candidate);
  assert.ok(report.carousel_manifest.stories[0].cards.some((card) => card.type === "quote_card"));
  assert.ok(report.carousel_manifest.stories[0].cards.some((card) => card.type === "stat_card"));
  assert.ok(report.carousel_manifest.stories[0].cards.some((card) => card.type === "story_prompt"));
  assert.equal(report.engagement_risk_report.verdict, "pass");
  assert.ok(report.stories[0].blockers.includes("upstream:goal13_multi_platform_publisher_blocked"));
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_external_posting, true);
});

test("Goal 14 hard-fails engagement bait, risky automated replies and weak derivative assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-risk-"));
  const outputs = socialOutputs({
    title: "The Expanse Shows Real Gameplay",
    subject: "The Expanse: Osiris Reborn",
    route: "/p/story-risk",
  });
  outputs.x.hot_take_post = "Smash like and retweet if you want part 2.";
  outputs.x.source_safe_post = "Smash like and retweet if you want part 2.";
  outputs.x.thread_posts = ["Smash like and retweet if you want part 2."];
  outputs.x.poll_candidate = "";
  outputs.threads.discussion_post = "Smash like and retweet if you want part 2.";
  outputs.threads.automated_replies_allowed = true;
  await makeStoryPackage(root, "story-risk", {
    outputs,
    imageCards: { story_id: "story-risk", platforms: ["instagram"], headline: "" },
    carousel: { platform: "instagram", story_id: "story-risk", cards: ["cover"] },
  });

  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [{ story_id: "story-risk", artifact_dir: path.join(root, "story-risk") }],
    upstreamPublisherReport: readyPublisherReport("story-risk"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T01:36:27.172Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].direct_derivative_status, "blocked");
  for (const blocker of [
    "social:engagement_bait",
    "social:risky_automated_reply",
    "social:threads_duplicates_x",
    "social:missing_x_thread",
    "social:missing_x_poll",
    "social:missing_image_card_asset",
    "social:missing_carousel_derivative",
  ]) {
    assert.ok(report.blocker_counts[blocker] >= 1, blocker);
  }
  assert.equal(report.engagement_risk_report.verdict, "fail");
});

test("Goal 14 social derivative fallbacks avoid source-backed update phrasing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-fallback-copy-"));
  const title = "Hades II Finally Shows Console Gameplay";
  const subject = "Hades II";
  await makeStoryPackage(root, "story-fallback-copy", {
    title,
    subject,
    outputs: {
      x: {},
      instagram: {},
      threads: {},
    },
  });

  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [{ story_id: "story-fallback-copy", artifact_dir: path.join(root, "story-fallback-copy") }],
    upstreamPublisherReport: readyPublisherReport("story-fallback-copy"),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-28T23:15:00.000Z",
  });

  const combined = [
    report.x_publish_pack.stories[0].concise_news_post,
    ...report.x_publish_pack.stories[0].thread_posts,
    report.instagram_publish_pack.stories[0].stat_card.stat,
    report.threads_publish_pack.stories[0].discussion_post,
  ].join(" ");

  assert.doesNotMatch(combined, /source-backed update/i);
  assert.match(combined, /Hades II/i);
});

test("Goal 14 varies Instagram carousel roles and order across stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-carousel-variation-"));
  const storyA = await makeStoryPackage(root, "story-score", {
    title: "Forza Horizon 6 Scores 84 On PC Gamer",
    subject: "Forza Horizon 6",
  });
  const storyB = await makeStoryPackage(root, "story-leak", {
    title: "Subnautica 2 Reportedly Leaked Early",
    subject: "Subnautica 2",
  });

  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [storyA, storyB],
    upstreamPublisherReport: {
      stories: [
        { story_id: "story-score", status: "ready", blockers: [] },
        { story_id: "story-leak", status: "ready", blockers: [] },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:31:00.000Z",
  });

  const scoreCarousel = report.carousel_manifest.stories.find((story) => story.story_id === "story-score");
  const leakCarousel = report.carousel_manifest.stories.find((story) => story.story_id === "story-leak");
  const scoreInstagram = report.instagram_publish_pack.stories.find((story) => story.story_id === "story-score");
  const leakInstagram = report.instagram_publish_pack.stories.find((story) => story.story_id === "story-leak");

  assert.equal(report.verdict, "PASS");
  assert.ok(scoreCarousel.format_signature);
  assert.ok(leakCarousel.format_signature);
  assert.notEqual(scoreCarousel.format_signature, leakCarousel.format_signature);
  assert.notDeepEqual(
    scoreCarousel.cards.map((card) => card.type),
    leakCarousel.cards.map((card) => card.type),
  );
  assert.equal(scoreInstagram.carousel_companion.format_signature, scoreCarousel.format_signature);
  assert.equal(leakInstagram.carousel_companion.format_signature, leakCarousel.format_signature);
});

test("Goal 14 rewrites stale generic X hot takes into story-native posts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-x-variation-"));
  const first = socialOutputs({
    title: "Forza Horizon 6 Reviews Are In",
    subject: "Forza Horizon 6",
    route: "/p/story-forza",
  });
  const second = socialOutputs({
    title: "Subnautica 2 Dev Calls Out Leakers",
    subject: "Subnautica 2",
    route: "/p/story-subnautica",
  });
  first.x.hot_take_post = "Forza Horizon 6 reviews are in. I want the next official beat to show whether this actually changes the game, the launch or the platform plan.";
  second.x.hot_take_post = "Subnautica 2's developer is already fighting leaked builds. I want the next official beat to show whether this actually changes the game, the launch or the platform plan.";
  const storyA = await makeStoryPackage(root, "story-forza", {
    title: "Forza Horizon 6 Reviews Are In",
    subject: "Forza Horizon 6",
    outputs: first,
  });
  const storyB = await makeStoryPackage(root, "story-subnautica", {
    title: "Subnautica 2 Dev Calls Out Leakers",
    subject: "Subnautica 2",
    outputs: second,
  });

  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [storyA, storyB],
    upstreamPublisherReport: {
      stories: [
        { story_id: "story-forza", status: "ready", blockers: [] },
        { story_id: "story-subnautica", status: "ready", blockers: [] },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T01:52:00.000Z",
  });

  const xPosts = report.x_publish_pack.stories.map((story) => story.hot_take_post);
  assert.equal(report.verdict, "PASS");
  assert.equal(new Set(xPosts).size, 2);
  for (const post of xPosts) {
    assert.doesNotMatch(post, /I want the next official beat/i);
    assert.doesNotMatch(post, /useful next beat/i);
  }
});

test("Goal 14 excludes upstream-skipped stories from active derivative blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-skipped-"));
  const readyStory = await makeStoryPackage(root, "story-ready");
  const skippedStory = await makeStoryPackage(root, "story-skipped", {
    imageCards: { story_id: "story-skipped", platforms: [], headline: "" },
    carousel: { platform: "instagram", story_id: "story-skipped", cards: [] },
  });

  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [readyStory, skippedStory],
    upstreamPublisherReport: {
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [] },
        {
          story_id: "story-skipped",
          status: "skipped",
          skipped_status: "visual_source_deferred",
          skipped_reason: "defer_until_rights_backed_media_available",
          blockers: [],
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-29T00:22:00.000Z",
  });

  const ready = report.stories.find((story) => story.story_id === "story-ready");
  const skipped = report.stories.find((story) => story.story_id === "story-skipped");

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_derivative_verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.social_derivative_ready_story_count, 1);
  assert.equal(ready.status, "ready");
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
  assert.equal(report.engagement_risk_report.verdict, "pass");
  assert.equal(report.x_publish_pack.stories.length, 1);
  assert.equal(report.carousel_manifest.stories.length, 1);
});

test("Goal 14 writes required social derivative artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal14-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const outputDir = path.join(root, "out");
  const report = await buildGoal14SocialDerivativesEngine({
    storyPackages: [story],
    upstreamPublisherReport: blockedPublisherReport("story-write"),
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-26T01:36:27.172Z",
  });

  const written = await writeGoal14SocialDerivativesEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.xPublishPack), true);
  assert.equal(await fs.pathExists(written.instagramPublishPack), true);
  assert.equal(await fs.pathExists(written.threadsPublishPack), true);
  assert.equal(await fs.pathExists(written.imageCardManifest), true);
  assert.equal(await fs.pathExists(written.carouselManifest), true);
  assert.equal(await fs.pathExists(written.engagementRiskReport), true);
});
