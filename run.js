const cron = require("node-cron");
const fs = require("fs-extra");
const sendDiscord = require("./notify");
const dotenv = require("dotenv");
const db = require("./lib/db");

dotenv.config({ override: true });

/*
  Pulse Gaming Pipeline v2 -Autonomous Operations

  Modes:
    hunt      -One-off Reddit + RSS fetch + script generation
    produce   -Generate audio, images, assemble videos
    publish   -Upload to YouTube, TikTok, Instagram
    schedule  -Start autonomous cron scheduler (recommended)
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

async function runProduce() {
  console.log("[run] === PRODUCE MODE ===");

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

  let exportedPaths = [];
  const stories = await db.getStories();
  exportedPaths = stories
    .filter((s) => s.exported_path)
    .map((s) => s.exported_path);

  await sendDiscord(
    `**Pulse Gaming Produce Complete**\n${exportedPaths.length} videos exported:\n${exportedPaths.join("\n")}`,
  );

  console.log("[run] Produce complete");
}

async function runPublish() {
  console.log("[run] === PUBLISH MODE ===");

  const { publishToAllPlatforms } = require("./publisher");
  const results = await publishToAllPlatforms();

  const total =
    results.youtube.length + results.tiktok.length + results.instagram.length;
  console.log(`[run] Published ${total} videos across all platforms`);
}

async function runFull() {
  console.log("[run] === FULL AUTONOMOUS CYCLE ===");

  const { fullAutonomousCycle } = require("./publisher");
  await fullAutonomousCycle();
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

  // Phase D: canonical queue is the default. lib/dispatch-mode enforces
  // that production always uses the queue (no legacy escape) and that
  // bootstrap failure in prod throws rather than silently arming the
  // legacy cron block below. USE_JOB_QUEUE=false in dev is the only
  // way to reach the legacy registry.
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
          `[run] FATAL: bootstrap-queue failed in production — refusing to start legacy cron fallback. ` +
            `Original error: ${err.message}`,
        );
        throw err;
      }
      console.error(
        `[run] bootstrap-queue failed in dev (${err.message}) — no scheduler will run. ` +
          `Set USE_JOB_QUEUE=false to intentionally use the legacy cron block for local dev.`,
      );
      return;
    }
  }

  // dispatch.mode === 'legacy_dev' — explicit dev opt-in only. Never reached in production.
  console.log(
    "[run] WARNING: legacy in-process cron registry active (USE_JOB_QUEUE=false, dev only). " +
      "This path is DEPRECATED — queue mode is canonical in production.",
  );
  await _registerLegacyDevCronRegistry();
}

// Quarantined pre-Phase-D cron registry. Do not call from production.
// Kept as an escape hatch for dev work against the legacy JSON pipeline
// (USE_SQLITE!=true). Contents unchanged from pre-Phase-D so diffs stay
// small; future cleanup can delete once the JSON path is retired.
async function _registerLegacyDevCronRegistry() {
  // --- HUNT CYCLES (4x daily at optimal news-breaking windows) ---

  // 06:00 GMT -Morning hunt: catches overnight US leaks + Reddit activity
  cron.schedule(
    "0 6 * * *",
    async () => {
      console.log("[schedule] 06:00 GMT -Morning hunt");
      try {
        await runHunt();
        const { autoApprove } = require("./publisher");
        await autoApprove();
      } catch (err) {
        console.log(`[schedule] Morning hunt error: ${err.message}`);
        await sendDiscord(`**ERROR** Morning hunt failed: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  // 10:00 GMT -Mid-morning: embargo lifts (typically 9AM-12PM ET = 14:00-17:00 GMT)
  cron.schedule(
    "0 10 * * *",
    async () => {
      console.log("[schedule] 10:00 GMT -Mid-morning hunt");
      try {
        await runHunt();
        const { autoApprove } = require("./publisher");
        await autoApprove();
      } catch (err) {
        console.log(`[schedule] Mid-morning hunt error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  // 14:00 GMT -Afternoon: Nintendo Direct window (2PM GMT), major announcements
  cron.schedule(
    "0 14 * * *",
    async () => {
      console.log(
        "[schedule] 14:00 GMT -Afternoon hunt (Nintendo/announcement window)",
      );
      try {
        await runHunt();
        const { autoApprove } = require("./publisher");
        await autoApprove();
      } catch (err) {
        console.log(`[schedule] Afternoon hunt error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  // 17:00 GMT -Evening: Xbox showcase window + US morning embargo lifts
  cron.schedule(
    "0 17 * * *",
    async () => {
      console.log("[schedule] 17:00 GMT -Evening hunt (Xbox/embargo window)");
      try {
        await runHunt();
        const { autoApprove } = require("./publisher");
        await autoApprove();
      } catch (err) {
        console.log(`[schedule] Evening hunt error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  // --- PRODUCE CYCLE (2x daily, before publish windows) ---

  // 18:00 GMT -Produce all approved stories (1hr before YouTube publish)
  cron.schedule(
    "0 18 * * *",
    async () => {
      console.log("[schedule] 18:00 GMT -Produce cycle");
      try {
        await runProduce();
      } catch (err) {
        console.log(`[schedule] Produce error: ${err.message}`);
        await sendDiscord(`**ERROR** Produce cycle failed: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  // --- PUBLISH CYCLE (1x daily at optimal engagement window) ---

  // 19:00 GMT -Publish to YouTube Shorts (peak engagement: 7PM GMT)
  // TikTok and Instagram are staggered by the publisher module (+60min each)
  cron.schedule(
    "0 19 * * *",
    async () => {
      console.log("[schedule] 19:00 GMT -PUBLISH WINDOW");
      try {
        if (process.env.AUTO_PUBLISH === "true") {
          await runPublish();
        } else {
          console.log("[schedule] AUTO_PUBLISH not enabled, skipping");
          await sendDiscord(
            "**Videos ready for upload** -Set AUTO_PUBLISH=true to enable autonomous posting",
          );
        }
      } catch (err) {
        console.log(`[schedule] Publish error: ${err.message}`);
        await sendDiscord(`**ERROR** Publish cycle failed: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  // --- LATE NIGHT HUNT (catches PlayStation State of Play @ 10PM GMT) ---
  cron.schedule(
    "0 22 * * *",
    async () => {
      console.log("[schedule] 22:00 GMT -Late hunt (PlayStation window)");
      try {
        await runHunt();
        const { autoApprove } = require("./publisher");
        await autoApprove();
      } catch (err) {
        console.log(`[schedule] Late hunt error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );

  console.log("[schedule] Cron jobs registered:");
  console.log("  06:00 UTC -Morning hunt (overnight US leaks)");
  console.log("  10:00 UTC -Mid-morning hunt (embargo lifts)");
  console.log("  14:00 UTC -Afternoon hunt (Nintendo Direct window)");
  console.log("  17:00 UTC -Evening hunt (Xbox/embargo window)");
  console.log("  18:00 UTC -Produce cycle (audio + images + video)");
  console.log("  19:00 UTC -PUBLISH (YouTube → TikTok → Instagram)");
  console.log("  22:00 UTC -Late hunt (PlayStation State of Play window)");
  console.log("");
  console.log(
    `[schedule] AUTO_PUBLISH: ${process.env.AUTO_PUBLISH === "true" ? "ENABLED" : "DISABLED"}`,
  );
  console.log("[schedule] Process will stay alive. Press Ctrl+C to exit.");

  // Run an immediate hunt on startup
  (async () => {
    console.log("[schedule] Running initial hunt on startup...");
    try {
      await runHunt();
      const { autoApprove } = require("./publisher");
      await autoApprove();
      await sendDiscord(
        "**Pulse Gaming Scheduler Started** -Running autonomously",
      );
    } catch (err) {
      console.log(`[schedule] Initial hunt error: ${err.message}`);
    }
  })();
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
    "  node run.js produce   -Generate audio, images and assemble videos",
  );
  console.log("  node run.js publish   -Upload to YouTube, TikTok, Instagram");
  console.log("  node run.js full      -Run complete autonomous cycle once");
  console.log("  node run.js approve   -Run auto-approval pass");
  console.log(
    "  node run.js watch     -Start breaking news watcher (continuous)",
  );
  console.log("  node run.js weekly    -Compile weekly longform roundup video");
  console.log(
    "  node run.js schedule  -Start autonomous cron scheduler (24/7)",
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
        await runProduce();
        break;
      case "publish":
        await runPublish();
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
