const fs = require("fs-extra");
const sendDiscord = require("./notify");
const dotenv = require("dotenv");
const {
  loadDotenvOnce,
} = require("./lib/stabilisation/runtime-config");

loadDotenvOnce({ dotenv, env: process.env });

const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");
const {
  buildProduceCompletionSummary,
  normaliseExportPath,
  shouldSendProduceCompletionDiscord,
} = require("./lib/ops/produce-notification");

/*
  Pulse Gaming Pipeline v2 -Autonomous Operations

  Modes:
    hunt      -One-off Reddit + RSS fetch + script generation
    produce   -Generate audio, images, assemble videos
              Optional: --story-id <id> or --story <id>
    publish   -Upload to YouTube, TikTok, Instagram
              Optional: --story-id <id> or --story <id>
    schedule  -Start the authoritative queue-backed scheduler
    full      -Run complete autonomous cycle once
    approve   -Run auto-approval pass only

  Autonomous Schedule (all times GMT):
  ┌──────────┬──────────────────────────────────────────────────┐
  │ Time     │ Action                                           │
  ├──────────┼──────────────────────────────────────────────────┤
  │ 06:00    │ Morning hunt -catch overnight US leaks          │
  │ 10:00    │ Mid-morning hunt -embargo lifts, announcements  │
  │ 14:00    │ Afternoon hunt -Nintendo Direct timing window   │
  │ 17:00    │ Evening hunt -US morning announcements          │
  │ 19:00    │ PUBLISH WINDOW -YouTube Shorts optimal time     │
  │ 20:00    │ (staggered) TikTok upload                       │
  │ 21:00    │ (staggered) Instagram Reels upload               │
  │ 22:00    │ Late hunt -catch PS State of Play window        │
  └──────────┴──────────────────────────────────────────────────┘

  Research basis:
  - Gaming announcements peak: 14:00 GMT (Nintendo), 17:00 GMT (embargoes),
    22:00 GMT (PlayStation), 18:00 GMT (Xbox)
  - Reddit leak surfacing peaks: 00:00-04:00 GMT (US evening)
  - YouTube Shorts engagement peaks: 19:00 GMT (UK evening = 2PM ET)
  - TikTok engagement peaks: 20:00 GMT
  - Instagram Reels peaks: 21:00 GMT
  - Friday is statistically the best day for short-form gaming content
*/

async function runHunt() {
  console.log("[run] === HUNT MODE ===");

  const hunt = require("./hunter");
  const process_stories = require("./processor");

  // Load existing stories to preserve their state (approval, audio, video paths)
  const existingStories = await db.getStories();
  const existingIds = new Set(existingStories.map((s) => s.id));

  console.log("[run] Step 1: Multi-source hunting (Reddit + RSS)...");
  const stories = await hunt();

  // Only process genuinely new stories
  const newPosts = stories.filter((p) => !existingIds.has(p.id));
  console.log(
    `[run] ${stories.length} fetched, ${newPosts.length} new (${existingStories.length} existing preserved)`,
  );

  if (newPosts.length > 0) {
    // Write only new posts for processor
    await fs.writeJson(
      "pending_news.json",
      { timestamp: new Date().toISOString(), stories: newPosts },
      { spaces: 2 },
    );

    console.log("[run] Step 2: Processing scripts...");
    await process_stories();

    // Merge: newly processed stories + existing (preserves approval/production state)
    const processed = await db.getStories();
    const processedIds = new Set(processed.map((s) => s.id));
    const toMerge = existingStories.filter((s) => !processedIds.has(s.id));
    const merged = [...processed, ...toMerge];
    await db.saveStories(merged);
    console.log(
      `[run] Merged: ${processed.length} new + ${existingStories.length} existing = ${merged.length} total`,
    );
  } else {
    console.log("[run] No new stories -skipping processor");
  }

  const titles = newPosts.map((s) => `- ${s.title}`).join("\n");
  await sendDiscord(
    `**Pulse Gaming Hunt Complete**\n${newPosts.length} new stories:\n${titles || "(none)"}`,
  );

  console.log("[run] Hunt complete");
}

async function runProduce({ storyId = null } = {}) {
  console.log("[run] === PRODUCE MODE ===");

  if (storyId) {
    process.env.PRODUCE_STORY_IDS = storyId;
    delete process.env.PRODUCE_STORY_LIMIT;
    console.log(`[run] Targeting story id: ${storyId}`);
  }

  const produceStartedAtMs = Date.now();
  const beforeStories = await db.getStories();

  const affiliates = require("./affiliates");
  const audio = require("./audio");
  const images = require("./images");
  const assemble = require("./assemble");

  console.log("[run] Step 1: Affiliates...");
  await affiliates();

  console.log("[run] Step 2: Audio generation...");
  await audio();

  console.log("[run] Step 3: Professional image generation...");
  await images();

  console.log("[run] Step 4: Video assembly (multi-image Ken Burns)...");
  await assemble();

  console.log("[run] Step 5: Instagram Story images...");
  const { generateStoryImages } = require("./images_story");
  await generateStoryImages();

  console.log("[run] Step 6: Thumbnail candidates...");
  try {
    const {
      buildThumbnailsForApprovedStories,
    } = require("./lib/studio/v2/hf-thumbnail-builder");
    await buildThumbnailsForApprovedStories();
  } catch (err) {
    console.log(`[run] Thumbnail candidate batch failed (non-fatal): ${err.message}`);
  }

  const stories = await db.getStories();
  const recentlyTouchedExportPaths = await findRecentlyTouchedExportPaths(
    stories,
    produceStartedAtMs,
  );
  const summary = buildProduceCompletionSummary({
    beforeStories,
    afterStories: stories,
    recentlyTouchedExportPaths,
  });

  if (shouldSendProduceCompletionDiscord(summary)) {
    await sendDiscord(summary.message);
  }
  console.log(`[run] ${summary.message.replace(/\n/g, " | ")}`);

  console.log("[run] Produce complete");
}

async function findRecentlyTouchedExportPaths(stories = [], startedAtMs = Date.now()) {
  const recentPaths = [];
  const seen = new Set();
  const mtimeSlackMs = 5000;

  for (const story of stories || []) {
    const exportedPath = normaliseExportPath(story && story.exported_path);
    if (!exportedPath || seen.has(exportedPath)) continue;
    seen.add(exportedPath);

    try {
      const resolved = await mediaPaths.resolveExisting(exportedPath);
      if (!resolved) continue;
      const stat = await fs.stat(resolved);
      if (stat.mtimeMs >= startedAtMs - mtimeSlackMs) {
        recentPaths.push(exportedPath);
      }
    } catch {
      // Missing or unreadable exports are handled by publish readiness/QA.
    }
  }

  return recentPaths;
}

function parsePublishStoryIdArg(argv = process.argv.slice(3)) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story-id" || arg === "--story") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a story id`);
      }
      return value;
    }
    if (arg.startsWith("--story-id=")) {
      const value = arg.slice("--story-id=".length);
      if (!value) throw new Error("--story-id requires a story id");
      return value;
    }
    if (arg.startsWith("--story=")) {
      const value = arg.slice("--story=".length);
      if (!value) throw new Error("--story requires a story id");
      return value;
    }
  }
  return null;
}

async function runPublish({ storyId = null } = {}) {
  console.log("[run] === PUBLISH MODE ===");

  if (storyId) {
    process.env.PUBLISH_STORY_IDS = storyId;
    console.log(`[run] Targeting story id: ${storyId}`);
  }

  const { publishToAllPlatforms } = require("./publisher");
  const results = await publishToAllPlatforms({
    dispatchSource: "cli_publish",
    storyId,
  });

  const total =
    results.youtube.length + results.tiktok.length + results.instagram.length;
  console.log(`[run] Published ${total} videos across all platforms`);
}

async function runFull() {
  console.log("[run] === FULL AUTONOMOUS CYCLE ===");

  const { fullAutonomousCycle } = require("./publisher");
  await fullAutonomousCycle({ dispatchSource: "cli_full" });
}

async function runApprove() {
  console.log("[run] === AUTO-APPROVE MODE ===");

  const { autoApprove } = require("./publisher");
  const summary = await autoApprove();
  if (summary.skipped) {
    console.log(`[run] Auto-approve skipped: ${summary.skipped}`);
  } else {
    console.log(
      `[run] Scored ${summary.scored} — auto=${summary.approved} review=${summary.review} defer=${summary.defer} reject=${summary.reject}`,
    );
  }
}

function runWatch() {
  console.log("[run] === WATCH MODE -CONTINUOUS BREAKING NEWS MONITOR ===");
  console.log("[run] Polls Reddit /new every 90s, RSS every 5min");
  console.log(
    "[run] Breaking threshold: 120 | Velocity: 500 upvotes in 30 min",
  );
  console.log("[run] Press Ctrl+C to stop.");
  console.log("");

  const { startWatching } = require("./watcher");
  const { queueBreaking, getQueueStatus } = require("./breaking_queue");

  const emitter = startWatching();

  emitter.on("breaking", async (story) => {
    console.log(
      `[run] >>> BREAKING: ${story.title} (score: ${story.breaking_score})`,
    );
    const result = await queueBreaking(story);
    if (result.queued) {
      console.log(`[run] Queued at position ${result.position}`);
    } else {
      console.log(`[run] Not queued: ${result.reason}`);
    }
  });

  // Periodic status log every 5 minutes
  setInterval(
    () => {
      const { getStatus } = require("./watcher");
      const ws = getStatus();
      const qs = getQueueStatus();
      console.log(
        `[run] Watcher: ${ws.storiesChecked} checked, ${ws.breakingEmitted} breaking | Queue: ${qs.queueLength} pending, cooldown: ${qs.cooldownRemainingMin}min`,
      );
    },
    5 * 60 * 1000,
  );
}

async function runWeekly() {
  console.log("[run] === WEEKLY COMPILATION MODE ===");

  const { compileWeekly } = require("./weekly_compile");
  const result = await compileWeekly();

  if (result) {
    console.log(
      `[run] Weekly compilation complete: ${result.story_count} stories, ${Math.round(result.duration_seconds / 60)} minutes`,
    );
    if (result.youtube_url) {
      console.log(`[run] YouTube: ${result.youtube_url}`);
    }
  } else {
    console.log("[run] Weekly compilation skipped (not enough stories)");
  }
}

async function runBlog() {
  console.log("[run] === BLOG BUILD MODE ===");

  const { build } = require("./blog/build");
  await build();

  console.log("[run] Blog build complete");
}

async function runSchedule() {
  console.log("[run] ==========================================");
  console.log("[run] PULSE GAMING AUTONOMOUS SCHEDULER v2");
  console.log("[run] ==========================================");
  console.log("[run] All times are GMT/UTC");
  console.log("");

  // Pulse v1 uses one queue-backed scheduler. There is no legacy cron
  // fallback in production or development.
  const { resolveDispatchMode } = require("./lib/dispatch-mode");
  const dispatch = resolveDispatchMode();
  console.log(
    `[run] dispatch mode=${dispatch.mode} strict=${dispatch.strict} reason=${dispatch.reason}`,
  );

  if (dispatch.mode === "queue") {
    try {
      const bootstrap = require("./lib/bootstrap-queue");
      await bootstrap.start({
        workerId: `run-${require("os").hostname()}-${process.pid}`,
        runScheduler: true,
        runRunner: true,
        autoSeed: true,
      });
      console.log(
        "[run] canonical scheduler up via bootstrap-queue (lib/scheduler.js + jobs-runner)",
      );
      console.log("[run] Press Ctrl+C to stop\n");
      return;
    } catch (err) {
      if (dispatch.strict) {
        console.error(
          `[run] FATAL: bootstrap-queue failed in production; no scheduler was started. ` +
            `Original error: ${err.message}`,
        );
        throw err;
      }
      console.error(
        `[run] bootstrap-queue failed in dev (${err.message}); no scheduler will run. Fix the queue bootstrap before retrying.`,
      );
      return;
    }
  }

  // Queue bootstrap is the only scheduler path. Failure leaves this process without a scheduler.
}

const mode = process.argv[2];

if (!mode) {
  console.log("Pulse Gaming Pipeline v2");
  console.log("========================");
  console.log("Usage:");
  console.log(
    "  node run.js hunt      -Fetch Reddit + RSS stories and generate scripts",
  );
  console.log(
    "  node run.js produce [--story-id <id>] -Generate audio, images and assemble videos",
  );
  console.log(
    "  node run.js publish [--story-id <id>] -Run the guarded YouTube publish path",
  );
  console.log("  node run.js full      -Run complete autonomous cycle once");
  console.log("  node run.js approve   -Run auto-approval pass");
  console.log(
    "  node run.js watch     -Start breaking news watcher (continuous)",
  );
  console.log("  node run.js weekly    -Compile weekly longform roundup video");
  console.log(
    "  node run.js schedule  -Start the authoritative queue-backed scheduler",
  );
  console.log(
    "  node run.js blog      -Rebuild static SEO blog from published stories",
  );
  process.exit(0);
}

(async () => {
  try {
    switch (mode) {
      case "hunt":
        await runHunt();
        break;
      case "produce":
        await runProduce({
          storyId: parsePublishStoryIdArg(process.argv.slice(3)),
        });
        break;
      case "publish":
        await runPublish({
          storyId: parsePublishStoryIdArg(process.argv.slice(3)),
        });
        break;
      case "full":
        await runFull();
        break;
      case "approve":
        await runApprove();
        break;
      case "watch":
        runWatch();
        break;
      case "weekly":
        await runWeekly();
        break;
      case "schedule":
        await runSchedule();
        break;
      case "blog":
        await runBlog();
        break;
      default:
        console.log(`[run] Unknown mode: ${mode}`);
        process.exit(1);
    }
  } catch (err) {
    console.log(`[run] FATAL: ${err.message}`);
    process.exit(1);
  }
})();
