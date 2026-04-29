const { test } = require("node:test");
const assert = require("node:assert");

const { verifyMedia } = require("../../lib/ops/media-verify");
const {
  buildPlatformOperationalConfig,
  buildPlatformStatus,
  renderPlatformStatusMarkdown,
} = require("../../lib/ops/platform-status");
const { buildDbBackupDryRun } = require("../../lib/ops/db-backup-dry-run");
const {
  buildMediaInventoryReport,
  classifyStoryVisualInventory,
  renderMediaInventoryMarkdown,
} = require("../../lib/media-inventory");
const {
  ROUTE_ORDER,
  buildTikTokDispatchManifest,
  buildTikTokDispatchPack,
} = require("../../lib/platforms/tiktok-dispatch");
const { buildMonthlyReleaseRadar } = require("../../lib/formats/release-radar");

function fakeFs(existing = {}) {
  return {
    async pathExists(p) {
      return Object.prototype.hasOwnProperty.call(existing, p);
    },
    async stat(p) {
      if (!Object.prototype.hasOwnProperty.call(existing, p)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return { size: existing[p] };
    },
  };
}

test("media verifier flags zero-byte and tiny MP4 artefacts", async () => {
  const report = await verifyMedia({
    fs: fakeFs({
      "/tmp/ok.png": 10_000,
      "/tmp/tiny.mp4": 10_000,
      "/tmp/zero.jpg": 0,
    }),
    stories: [
      {
        id: "s1",
        exported_path: "/tmp/tiny.mp4",
        image_path: "/tmp/ok.png",
        downloaded_images: [{ path: "/tmp/zero.jpg", type: "hero" }],
      },
    ],
  });
  assert.strictEqual(report.verdict, "fail");
  assert.ok(report.issues.some((i) => i.issue === "tiny_mp4"));
  assert.ok(report.issues.some((i) => i.issue === "zero_byte"));
});

test("platform status summarises story platform fields", () => {
  const report = buildPlatformStatus({
    stories: [
      { id: "a", youtube_post_id: "yt1", youtube_url: "https://youtu.be/x" },
      { id: "b", tiktok_error: "403" },
    ],
    platformConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "enabled", reason: "direct_post_approved" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "enabled", reason: "x_video_enabled" },
    },
  });
  assert.strictEqual(report.counts.youtube.published, 1);
  assert.strictEqual(report.counts.tiktok.failed, 1);
});

test("platform status separates blocked and disabled platforms from not-published work", () => {
  const report = buildPlatformStatus({
    stories: [
      { id: "a", title: "A", youtube_post_id: "yt1", youtube_url: "https://youtu.be/x" },
      { id: "b", title: "B" },
    ],
    platformConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "disabled", reason: "facebook_page_reels_gate" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  assert.strictEqual(report.counts.youtube.published, 1);
  assert.strictEqual(report.counts.youtube.not_published, 1);
  assert.strictEqual(report.counts.tiktok.blocked_external, 2);
  assert.strictEqual(report.counts.facebook_reel.disabled, 2);
  assert.strictEqual(report.counts.twitter.disabled, 2);
  assert.strictEqual(report.counts.instagram_reel.not_published, 2);
});

test("platform status uses platform_posts rows as the newest structured truth", () => {
  const report = buildPlatformStatus({
    stories: [{ id: "story1", title: "Story 1" }],
    platformPosts: [
      {
        story_id: "story1",
        platform: "facebook_reel",
        status: "blocked",
        block_reason: "page_not_eligible",
      },
    ],
    platformConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  assert.strictEqual(report.recent[0].platforms.facebook_reel.status, "blocked");
  assert.strictEqual(report.recent[0].platforms.facebook_reel.reason, "page_not_eligible");
  assert.strictEqual(report.counts.facebook_reel.blocked, 1);
});

test("platform operational config reflects safe disabled/blocker defaults", () => {
  const config = buildPlatformOperationalConfig({
    INSTAGRAM_ACCESS_TOKEN: "present",
    INSTAGRAM_BUSINESS_ACCOUNT_ID: "present",
    FACEBOOK_REELS_ENABLED: "false",
    TWITTER_ENABLED: "false",
  });

  assert.strictEqual(config.youtube.state, "enabled");
  assert.strictEqual(config.instagram_reel.state, "enabled");
  assert.strictEqual(config.tiktok.state, "blocked_external");
  assert.strictEqual(config.facebook_reel.state, "disabled");
  assert.strictEqual(config.twitter.state, "disabled");
});

test("platform status markdown includes operational state", () => {
  const md = renderPlatformStatusMarkdown({
    generatedAt: "2026-04-29T00:00:00.000Z",
    storyCount: 1,
    operational: {
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
    },
    counts: {
      tiktok: { blocked_external: 1 },
    },
  });

  assert.match(md, /Operational State/);
  assert.match(md, /tiktok: blocked_external \(tiktok_direct_post_app_review\)/);
});

test("DB backup dry run reports intended target without mutation", async () => {
  const report = await buildDbBackupDryRun({ dbPath: "C:/definitely/not/here.db" });
  assert.strictEqual(report.dryRun, true);
  assert.strictEqual(report.mutationPerformed, false);
  assert.match(report.wouldWrite, /pulse_/);
});

test("media inventory downgrades weak visuals and rewards clip/game assets", () => {
  const weak = classifyStoryVisualInventory({
    id: "weak",
    title: "Weak story",
    downloaded_images: [{ path: "author-face.jpg", type: "portrait", human: true }],
  });
  assert.notStrictEqual(weak.className, "premium_video");
  assert.ok(weak.reasons.includes("unsafe_thumbnail_face"));

  const strong = classifyStoryVisualInventory({
    id: "strong",
    title: "Strong game story",
    downloaded_images: [
      { path: "game_key_art_steam.jpg", type: "key_art", source: "steam" },
      { path: "game_screenshot_steam.jpg", type: "screenshot", source: "steam" },
      { path: "platform_logo.png", type: "platform_logo", source: "logo" },
    ],
    video_clips: ["official_trailer_steam.mp4", "gameplay_trailer_steam.mp4"],
  });
  assert.strictEqual(strong.className, "premium_video");
});

test("media inventory report gives actionable next source work", () => {
  const report = buildMediaInventoryReport([
    {
      id: "thin",
      title: "Thin visual story",
      url: "https://example.com/story",
      downloaded_images: [],
      video_clips: [],
    },
    {
      id: "face",
      title: "Unknown person story",
      downloaded_images: [
        {
          path: "author-headshot.jpg",
          type: "portrait",
          source: "article",
          role: "author",
          human: true,
        },
      ],
    },
  ]);

  assert.strictEqual(report.counts.blog_only, 1);
  assert.strictEqual(report.counts.reject_visuals, 1);
  assert.strictEqual(
    report.items[0].nextBestAction,
    "fetch_official_trailer_or_store_clip",
  );
  assert.ok(report.items[1].reasons.includes("unsafe_thumbnail_face"));
  assert.ok(report.items[1].recommendations.includes("manual_editor_review_required"));

  const md = renderMediaInventoryMarkdown(report);
  assert.match(md, /Renderable as standalone video: 0/);
  assert.match(md, /Next: fetch_official_trailer_or_store_clip/);
  assert.match(md, /unsafeFaces=1/);
});

test("TikTok dispatch pack is upload-ready without posting", () => {
  const pack = buildTikTokDispatchPack(
    {
      id: "story1",
      title: "Metro 2039 reveal trailer",
      exported_path: "output/final/story1.mp4",
      thumbnail_candidate_path: "output/thumbnails/story1.png",
      flair: "Verified",
      breaking_score: 82,
    },
    { durationSeconds: 64, now: new Date("2026-04-28T10:00:00Z") },
  );
  assert.strictEqual(pack.eligibility.hasMp4, true);
  assert.strictEqual(pack.eligibility.creatorRewardsLengthEligible, true);
  assert.strictEqual(pack.status, "ready_for_operator_review");
  assert.ok(pack.hashtags.includes("#gaming"));
  assert.deepStrictEqual(pack.routePriority, ROUTE_ORDER);
  assert.strictEqual(pack.routePriority.at(-1), "va_last_resort");
  assert.match(pack.discordNotification, /TikTok Ready - HIGH PRIORITY/);
  assert.strictEqual(pack.schedulerReadyJson.requires_mobile_confirmation, false);
  assert.strictEqual(pack.compatibility.virtualAssistant, "last_resort_only");
});

test("TikTok dispatch manifest emits a scheduler queue and sample Discord notification", () => {
  const manifest = buildTikTokDispatchManifest(
    [
      {
        id: "story1",
        title: "Confirmed trailer update",
        exported_path: "out.mp4",
        image_path: "cover.png",
        flair: "Verified",
      },
    ],
    {
      durationByStoryId: { story1: 61.5 },
      now: new Date("2026-04-28T10:00:00Z"),
    },
  );
  assert.strictEqual(manifest.queue.length, 1);
  assert.strictEqual(manifest.queue[0].schedulerReadyJson.network, "tiktok");
  assert.match(manifest.sampleDiscordNotification, /Caption:/);
});

test("release radar gate rejects insufficient verified candidates", () => {
  const radar = buildMonthlyReleaseRadar({
    monthLabel: "May 2026",
    candidates: [
      {
        title: "A",
        releaseDate: "2026-05-01",
        platforms: ["PC"],
        publisherSource: "source",
        storeSource: "store",
        trailerUrl: "trailer",
        searchDemand: "high",
      },
    ],
  });
  assert.strictEqual(radar.top10.length, 1);
  assert.strictEqual(radar.factCheckGate.status, "insufficient_verified_candidates");
});
