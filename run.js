"use strict";

const dotenv = require("dotenv");
const {
  assertValidRuntimeConfig,
  loadDotenvOnce,
} = require("./lib/stabilisation/runtime-config");

loadDotenvOnce({ dotenv, env: process.env });
assertValidRuntimeConfig(process.env);

const cron = require("node-cron");
const fs = require("fs-extra");
const sendDiscord = require("./notify");
const db = require("./lib/db");
/*
  Pulse Gaming News — controlled release pipeline

  The durable queue is the only scheduler. Stabilisation mode hunts, scores
  and renders candidates but holds every upload for named human review.
  YouTube is the only enabled publication destination for this release.
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
    `**Pulse Gaming News hunt complete**\n${newPosts.length} new stories:\n${titles || "(none)"}`,
  );

  console.log("[run] Hunt complete");
}

async function runProduce() {
  console.log("[run] === GOVERNED PRODUCE MODE ===");
  const { produce } = require("./publisher");
  await produce();

  const stories = await db.getStories();
  const exportedPaths = stories
    .filter((s) => s.exported_path)
    .map((s) => s.exported_path);

  await sendDiscord(
    `**Pulse Gaming News production complete**\n${exportedPaths.length} governed candidates exported and held for human review.`,
  );

  console.log(
    `[run] Governed production complete: ${exportedPaths.length} candidates held`,
  );
}

async function runPublish() {
  console.log("[run] === GOVERNED YOUTUBE PUBLISH MODE ===");

  const { publishNextStory } = require("./publisher");
  const result = await publishNextStory();

  if (!result) {
    console.log("[run] No governed YouTube candidate is due");
    return null;
  }
  if (result.publish_dispatch_blocked) {
    console.log(`[run] Publish held: ${result.top_reason}`);
    return result;
  }
  console.log(
    `[run] YouTube outcome: ${result.platform_outcomes?.youtube || "unknown"}`,
  );
  return result;
}

async function runFull() {
  console.log("[run] === GOVERNED PREPARATION CYCLE ===");

  const { fullAutonomousCycle } = require("./publisher");
  return fullAutonomousCycle();
}

async function runApprove() {
  console.log("[run] === HUMAN-REVIEW QUEUE SCORING MODE ===");

  const { autoApprove } = require("./publisher");
  const summary = await autoApprove();
  if (summary.skipped) {
    console.log(`[run] Scoring skipped: ${summary.skipped}`);
  } else {
    console.log(
      `[run] Scored ${summary.scored} — held=${summary.review} defer=${summary.defer} reject=${summary.reject}`,
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
  console.log("[run] PULSE GAMING NEWS GOVERNED SCHEDULER");
  console.log("[run] ==========================================");
  console.log("[run] All times are GMT/UTC");
  console.log("");

  // The canonical durable queue is the only operational scheduler.
  // Bootstrap failure never falls through to the archived cron registry.
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
        `[run] bootstrap-queue failed in dev (${err.message}) — no scheduler will run.`,
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

  // Archived cron registry: even if called directly, its publication window
  // can only issue a human-review reminder.
  cron.schedule(
    "0 19 * * *",
    async () => {
      console.log("[schedule] 19:00 GMT - HUMAN-REVIEW WINDOW");
      await sendDiscord(
        "**Pulse Gaming News review window** — candidates remain held until a named operator approves governed YouTube dispatch.",
      );
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
  console.log("  19:00 UTC -Human-review window (YouTube only)");
  console.log("  22:00 UTC -Late hunt (PlayStation State of Play window)");
  console.log("");
  console.log("[schedule] Live dispatch: HUMAN REVIEW REQUIRED");
  console.log("[schedule] Process will stay alive. Press Ctrl+C to exit.");

  // Run an immediate hunt on startup
  (async () => {
    console.log("[schedule] Running initial hunt on startup...");
    try {
      await runHunt();
      const { autoApprove } = require("./publisher");
      await autoApprove();
      await sendDiscord(
        "**Pulse Gaming News scheduler started** — durable queue active, uploads held for human review.",
      );
    } catch (err) {
      console.log(`[schedule] Initial hunt error: ${err.message}`);
    }
  })();
}

const mode = process.argv[2];

if (!mode) {
  console.log("Pulse Gaming News controlled release pipeline");
  console.log("============================================");
  console.log("Usage:");
  console.log(
    "  node run.js hunt      -Fetch Reddit + RSS stories and generate scripts",
  );
  console.log(
    "  node run.js produce   -Generate audio, images and assemble videos",
  );
  console.log("  node run.js publish   -Request governed YouTube dispatch");
  console.log("  node run.js full      -Run governed preparation once");
  console.log("  node run.js approve   -Score the human-review queue");
  console.log(
    "  node run.js watch     -Start breaking news watcher (continuous)",
  );
  console.log("  node run.js weekly    -Compile weekly longform roundup video");
  console.log(
    "  node run.js schedule  -Start the governed durable queue",
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
