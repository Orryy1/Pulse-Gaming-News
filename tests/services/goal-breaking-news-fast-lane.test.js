"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");

const {
  buildGoalBreakingNewsFastLanePlan,
  writeGoalBreakingNewsFastLanePlan,
} = require("../../lib/goal-breaking-news-fast-lane");

function officialStory(overrides = {}) {
  return {
    story_id: "breaking-state-of-play",
    canonical_subject: "State of Play",
    canonical_game: "State of Play",
    canonical_company: "PlayStation",
    selected_title: "PlayStation Locks Its Next State Of Play",
    thumbnail_headline: "STATE OF PLAY LOCKED",
    first_spoken_line: "PlayStation just put State of Play back on the calendar.",
    narration_script:
      "PlayStation just put State of Play back on the calendar. The official post gives players a date and keeps the rest tight. That makes this a watch-now story, not a rumour cycle.",
    description: "PlayStation has announced the next State of Play. Source: PlayStation Blog.",
    primary_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/state-of-play",
      type: "official",
      reliability: "official",
    },
    official_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/state-of-play",
    },
    secondary_sources: [
      {
        name: "Gematsu",
        url: "https://www.gematsu.com/state-of-play",
        reliability: "reliable_publication",
      },
    ],
    source_confidence_score: 94,
    confirmed_claims: ["PlayStation announced a new State of Play."],
    unconfirmed_claims: [],
    prohibited_claims: [],
    breaking_news_flag: true,
    urgency_level: "high",
    vertical: "gaming",
    ...overrides,
  };
}

test("breaking fast lane builds source-safe native packs and defers disabled platforms", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory(),
    platformState: {
      platforms: {
        x: { operational_state: "disabled" },
        threads: { operational_state: "ready" },
        instagram_reels: { operational_state: "ready" },
        facebook_reels: { operational_state: "ready" },
      },
    },
    generatedAt: "2026-05-22T17:05:00.000Z",
  });

  assert.equal(plan.breaking_news_manifest.verdict, "AMBER");
  assert.equal(plan.breaking_news_manifest.safe_to_fast_publish_now, false);
  assert.deepEqual(plan.fast_publish_pack.publish_now_platforms, [
    "threads",
    "instagram_story_card",
    "facebook_card",
  ]);
  assert.deepEqual(plan.fast_publish_pack.deferred_platforms, ["x"]);
  assert.equal(plan.fast_publish_pack.platform_posts.threads.claim_boundary, "confirmed_only");
  assert.equal(plan.follow_up_v4_plan.required_before_video_publish.includes("materialised_motion_clips"), true);
  assert.equal(plan.correction_watch.enabled, true);
  assert.equal(plan.safety.no_network_uploads, true);
});

test("breaking fast lane blocks Reddit-only and low-confidence rumour stories", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory({
      story_id: "reddit-only-rumour",
      selected_title: "Switch 2 Shadow Drop Rumour Spreads",
      primary_source: {
        name: "Reddit",
        url: "https://www.reddit.com/r/GamingLeaksAndRumours/comments/example",
        type: "discussion",
        reliability: "community_discussion",
      },
      official_source: null,
      secondary_sources: [],
      source_confidence_score: 52,
      confirmed_claims: [],
      unconfirmed_claims: ["A Reddit post claims Nintendo is planning a shadow drop."],
    }),
    platformState: { platforms: { threads: { operational_state: "ready" } } },
  });

  assert.equal(plan.breaking_news_manifest.verdict, "RED");
  assert.equal(plan.breaking_news_manifest.safe_to_fast_publish_now, false);
  assert.equal(plan.fast_publish_pack.publish_now_platforms.length, 0);
  assert.equal(plan.rejection_reasons.includes("breaking_source_confidence_below_threshold"), true);
  assert.equal(plan.rejection_reasons.includes("reddit_or_discussion_source_not_confirmation"), true);
});

test("breaking fast lane accepts 0-1 source confidence scores as percentages", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory({
      source_confidence_score: 0.9,
      primary_source: {
        name: "Eurogamer",
        url: "https://www.eurogamer.net/playstation-store-pricing",
        reliability: "reliable_publication",
      },
      official_source: null,
      secondary_sources: [],
    }),
    platformState: { platforms: { threads: { operational_state: "ready" } } },
  });

  assert.equal(plan.breaking_news_manifest.verdict, "AMBER");
  assert.equal(plan.rejection_reasons.includes("breaking_source_confidence_below_threshold"), false);
  assert.equal(plan.breaking_news_manifest.source_strength.source_confidence_score, 90);
});

test("breaking fast lane treats official string primary sources with URL fallbacks as source-strong", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory({
      story_id: "xbox-official-trailer",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      canonical_company: "Xbox",
      selected_title: "The Expanse Shows Real Gameplay",
      first_spoken_line: "The Expanse: Osiris Reborn finally has real gameplay on screen.",
      primary_source: "Xbox",
      primary_source_url: "https://www.youtube.com/watch?v=official",
      official_source: "Xbox",
      secondary_sources: [],
      source_confidence_score: 0.9,
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview."],
      breaking_news_flag: true,
      urgency_level: "high",
    }),
    platformState: { platforms: { threads: { operational_state: "ready" } } },
  });

  assert.equal(plan.breaking_news_manifest.verdict, "AMBER");
  assert.equal(plan.rejection_reasons.includes("insufficient_breaking_source_pattern"), false);
  assert.equal(plan.breaking_news_manifest.source_strength.has_official_source, true);
  assert.equal(plan.breaking_news_manifest.source_strength.primary_source_reliability, "official");
  assert.equal(plan.breaking_news_manifest.source_strength.reliable_independent_source_count, 1);
  assert.equal(plan.follow_up_v4_plan.source_lock.url, "https://www.youtube.com/watch?v=official");
  assert.equal(plan.correction_watch.watch_sources[0].url, "https://www.youtube.com/watch?v=official");
  assert.equal(plan.correction_watch.watch_sources.length, 1);
});

test("breaking fast lane treats ready_now assumed-enabled platforms as reviewable", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory(),
    platformState: {
      platforms: {
        threads: { status: "ready_now", operational_state: "assumed_enabled" },
        x: { status: "deferred_until_platform_enabled", operational_state: "disabled" },
      },
    },
  });

  assert.equal(plan.fast_publish_pack.publish_now_platforms.includes("threads"), true);
  assert.equal(plan.fast_publish_pack.deferred_platforms.includes("x"), true);
});

test("breaking fast lane public post text does not leak internal production language", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory(),
    platformState: { platforms: { x: { operational_state: "ready" }, threads: { operational_state: "ready" } } },
  });

  const publicText = Object.values(plan.fast_publish_pack.platform_posts)
    .map((post) => typeof post.text === "string" ? post.text : JSON.stringify(post.text))
    .join(" ");
  assert.equal(/\b(v4|qa|rights ledger|control tower)\b/i.test(publicText), false);
});

test("breaking fast lane blocks affiliate CTAs before facts stabilise", async () => {
  const plan = await buildGoalBreakingNewsFastLanePlan({
    story: officialStory({
      affiliate_pack_id: "headset-offer-1",
      platform_ctas: {
        x: "Buy the headset now while the news is hot.",
      },
      commercial_intent: "affiliate",
    }),
    platformState: { platforms: { threads: { operational_state: "ready" } } },
  });

  assert.equal(plan.breaking_news_manifest.verdict, "RED");
  assert.equal(plan.rejection_reasons.includes("affiliate_cta_not_allowed_in_breaking_fast_post"), true);
});

test("breaking fast lane writes required artefacts and exposes a CLI", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-breaking-fast-lane-"));
  const storyPath = path.join(root, "story.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(storyPath, officialStory(), { spaces: 2 });

  const cli = spawnSync(
    process.execPath,
    ["tools/goal-breaking-news-fast-lane.js", "--story", storyPath, "--out-dir", outDir, "--json"],
    { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
  );

  assert.equal(cli.status, 0, cli.stderr);
  const stdout = JSON.parse(cli.stdout);
  assert.equal(stdout.breaking_news_manifest.story_id, "breaking-state-of-play");
  assert.equal(await fs.pathExists(path.join(outDir, "breaking_news_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "fast_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "follow_up_v4_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "correction_watch.json")), true);

  const pkg = await fs.readJson(path.resolve(__dirname, "../../package.json"));
  assert.equal(pkg.scripts["ops:goal-breaking-news"], "node tools/goal-breaking-news-fast-lane.js");
});
