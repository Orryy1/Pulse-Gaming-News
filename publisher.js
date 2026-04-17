const fs = require("fs-extra");
const dotenv = require("dotenv");
const sendDiscord = require("./notify");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const db = require("./lib/db");

dotenv.config({ override: true });

// Publish lock - prevents concurrent publishNextStory() calls from creating duplicates
let publishLock = false;

// Title similarity check (Jaccard > 0.5) - used for dedup across hunt + publish
function titlesSimilar(a, b) {
  if (!a || !b) return false;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size > 0.5;
}

/**
 * Phase 2C shadow check. Logs what lib/services/publish-dedupe would
 * decide for (story, platform) without changing any behaviour. Gated
 * on USE_CANONICAL_DEDUPE=shadow + USE_SQLITE=true. The idea is to run
 * this in prod for a few days, compare "shadow said block" vs what the
 * legacy code actually did, and only flip to active mode once the log
 * record proves parity (or reveals a fixable mismatch).
 *
 * Never throws. Never mutates story or repos. Safe to call on every
 * platform boundary. The whole block short-circuits when the flag is
 * unset/off — zero cost in the default config.
 */
function shadowCanonicalDedupe(story, platform, stories) {
  if (process.env.USE_CANONICAL_DEDUPE !== "shadow") return;
  if (process.env.USE_SQLITE !== "true") return;
  try {
    const { getRepos } = require("./lib/repositories");
    const { decidePublish } = require("./lib/services/publish-dedupe");
    const repos = getRepos();
    const decision = decidePublish(story, platform, repos, {
      legacyStoriesArray: stories,
    });
    const existingRef = decision.existing
      ? decision.existing.external_id ||
        decision.existing.story_id_ref ||
        decision.existing.story_id ||
        "-"
      : "-";
    console.log(
      `[dedupe-shadow] story=${story.id} platform=${platform} ` +
        `decision=${decision.decision} reason=${decision.reason || "-"} ` +
        `existing=${existingRef}`,
    );
  } catch (err) {
    console.log(
      `[dedupe-shadow] error story=${story.id} platform=${platform}: ${err.message}`,
    );
  }
}

/*
  Autonomous Publisher - 3x Daily Multi-Platform Posting

  Optimal publish windows (all times UTC / BST):
  - 12:00 UTC / 1:00 PM BST - lunch break + US morning (7-8am ET)
  - 17:00 UTC / 6:00 PM BST - post-work peak + US noon
  - 21:00 UTC / 10:00 PM BST - evening session + US afternoon (4-5pm ET)

  Strategy: 1 Short per window = 3 Shorts/day (algorithm favours frequency)

  This module handles:
  1. Auto-approval of high-confidence stories
  2. Full produce pipeline (affiliates → audio → images → assembly)
  3. publishNextStory() - single-story publish for each window
  4. publishToAllPlatforms() - batch publish (legacy/manual)
  5. Discord notifications at each stage
*/

// --- Auto-approval logic ---
//
// Prior to the Phase E cutover this module carried a `shouldAutoApprove()`
// helper that returned `true` for every story, which — via the for-loop in
// the old `autoApprove()` — quietly approved every hunted item in prod
// whenever `USE_SCORING_ENGINE` wasn't flipped on. That legacy shortcut
// is deleted. The 100-point editorial rubric in `lib/scoring.js` driven
// by `lib/decision-engine::runScoringPass` is now the canonical and only
// real approval path. `review`, `defer`, `reject` are persisted as
// `story_scores.decision` rows and surfaced in the hunt summary.
//
// Production behaviour
// --------------------
//   NODE_ENV=production AND USE_SQLITE=true  ->  scoring runs, decisions
//                                                apply. If scoring throws,
//                                                autoApprove rethrows — we
//                                                never silently approve.
//   NODE_ENV=production AND USE_SQLITE!=true ->  hard error. The legacy
//                                                JSON pipeline is not a
//                                                trusted editorial gate.
//
// Non-production dev
// ------------------
//   USE_SCORING_ENGINE!='false' + USE_SQLITE=true  ->  same scoring path.
//   USE_SCORING_ENGINE=='false'                    ->  explicit no-op
//                                                      fallback. NOTHING
//                                                      is approved. Use
//                                                      this when running
//                                                      unit/dev harness
//                                                      without a DB.
//   USE_SQLITE!=true + USE_SCORING_ENGINE!='false' ->  explicit no-op
//                                                      fallback with a
//                                                      loud warning.
//
// The no-op path ALWAYS returns a summary with skipped='reason', never
// approves. This is the one durable guarantee the refactor provides.
//
// Options (all optional — production callers pass nothing):
//   repos          inject a repositories bundle (tests use this to drive
//                  the scoring pass against an in-memory SQLite handle
//                  without touching the real repos singleton).
//   env            override process.env during tests. Defaults to the
//                  live process.env.
async function autoApprove({ repos: injectedRepos, env = process.env } = {}) {
  const isProd = env.NODE_ENV === "production";
  const sqliteOn = env.USE_SQLITE === "true";
  const scoringDisabled = env.USE_SCORING_ENGINE === "false";

  // Dev-only explicit opt-out. Must be set to literal 'false' — any other
  // value (including unset) keeps scoring on. Never honoured in prod.
  if (!isProd && scoringDisabled) {
    console.log(
      "[publisher] autoApprove: USE_SCORING_ENGINE=false in dev — no stories will be approved. " +
        "Unset the flag or set it to 'true' to re-enable the scoring engine.",
    );
    return emptyScoringSummary("dev_scoring_disabled");
  }

  if (!sqliteOn && !injectedRepos) {
    const msg =
      "autoApprove requires USE_SQLITE=true — the legacy JSON approve-everything " +
      "shortcut has been removed (Phase E cutover). " +
      "See docs/production-cutover-playbook.md.";
    if (isProd) {
      throw new Error(`[publisher] ${msg}`);
    }
    console.log(
      `[publisher] autoApprove: ${msg} Dev mode: returning empty summary without approving anything.`,
    );
    return emptyScoringSummary("dev_no_sqlite");
  }

  let repos = injectedRepos;
  if (!repos) {
    try {
      repos = require("./lib/repositories").getRepos();
    } catch (err) {
      if (isProd) throw err;
      console.log(
        `[publisher] autoApprove: repositories unavailable (${err.message}) — dev mode no-op.`,
      );
      return emptyScoringSummary("dev_repos_unavailable");
    }
  }

  const { runScoringPass } = require("./lib/decision-engine");
  const summary = runScoringPass({ repos });
  return summary;
}

// Shape that `runScoringPass` returns, plus a `skipped` reason for the
// no-op paths. Callers can switch on `summary.skipped` if they care.
function emptyScoringSummary(reason) {
  return {
    scored: 0,
    approved: 0,
    review: 0,
    defer: 0,
    reject: 0,
    hardStopped: 0,
    skipped: reason,
  };
}

// --- Full produce pipeline ---
async function produce() {
  console.log("[publisher] Running produce pipeline...");

  const affiliates = require("./affiliates");
  const audio = require("./audio");
  const images = require("./images");
  const assemble = require("./assemble");

  await affiliates();
  await audio();
  await images();
  await assemble();

  // Generate Instagram Story images for each produced video
  const { generateStoryImages } = require("./images_story");
  await generateStoryImages();

  console.log("[publisher] Produce pipeline complete");
}

// --- Staggered multi-platform upload ---
async function publishToAllPlatforms() {
  console.log("[publisher] === Multi-Platform Publish ===");

  const results = { youtube: [], tiktok: [], instagram: [] };

  // YouTube Shorts (first priority)
  try {
    const { uploadAll: ytUpload } = require("./upload_youtube");
    results.youtube = await ytUpload();
    console.log(`[publisher] YouTube: ${results.youtube.length} uploaded`);
  } catch (err) {
    console.log(`[publisher] YouTube upload skipped: ${err.message}`);
  }

  // Wait 60 minutes before TikTok (staggered posting for algorithm)
  if (process.env.STAGGER_UPLOADS !== "false") {
    console.log("[publisher] Waiting 60 min before TikTok upload...");
    await new Promise((r) => setTimeout(r, 60 * 60 * 1000));
  }

  // TikTok - try official API first, fall back to browser automation
  try {
    const { uploadAll: ttUpload } = require("./upload_tiktok");
    results.tiktok = await ttUpload();
    console.log(`[publisher] TikTok: ${results.tiktok.length} uploaded (API)`);
  } catch (err) {
    console.log(
      `[publisher] TikTok API failed: ${err.message}, trying browser fallback...`,
    );
    try {
      const { uploadAll: ttBrowserUpload } = require("./upload_tiktok_browser");
      results.tiktok = await ttBrowserUpload();
      console.log(
        `[publisher] TikTok: ${results.tiktok.length} uploaded (browser)`,
      );
    } catch (browserErr) {
      console.log(
        `[publisher] TikTok browser upload also failed: ${browserErr.message}`,
      );
    }
  }

  // Wait another 60 minutes before Instagram
  if (process.env.STAGGER_UPLOADS !== "false") {
    console.log("[publisher] Waiting 60 min before Instagram upload...");
    await new Promise((r) => setTimeout(r, 60 * 60 * 1000));
  }

  // Instagram Reels
  try {
    const { uploadAll: igUpload } = require("./upload_instagram");
    results.instagram = await igUpload();
    console.log(`[publisher] Instagram: ${results.instagram.length} uploaded`);
  } catch (err) {
    console.log(`[publisher] Instagram upload skipped: ${err.message}`);
  }

  return results;
}

// --- Full autonomous cycle: hunt → approve → produce → publish ---
async function fullAutonomousCycle() {
  const startTime = Date.now();
  console.log("[publisher] ========================================");
  console.log("[publisher] FULL AUTONOMOUS CYCLE STARTED");
  console.log(`[publisher] ${new Date().toISOString()}`);
  console.log("[publisher] ========================================");

  try {
    // Step 1: Hunt for news
    addBreadcrumb("Starting hunt for news", "pipeline");
    console.log("[publisher] Step 1/4: Hunting for news...");
    const hunt = require("./hunter");
    const process_stories = require("./processor");

    const existingStories = await db.getStories();
    const existingIds = new Set(existingStories.map((s) => s.id));

    const posts = await hunt();

    const accepted = []; // Track titles accepted in this batch for within-batch dedup
    const newPosts = posts.filter((p) => {
      if (existingIds.has(p.id)) return false;
      // Check against existing stories in DB
      const similar = existingStories.find((e) =>
        titlesSimilar(e.title, p.title),
      );
      if (similar) {
        console.log(
          `[publisher] Dedup (vs existing): "${p.title}" ~ "${similar.title}"`,
        );
        return false;
      }
      // Check against other posts already accepted in THIS batch
      const batchDupe = accepted.find((a) => titlesSimilar(a, p.title));
      if (batchDupe) {
        console.log(
          `[publisher] Dedup (within batch): "${p.title}" ~ "${batchDupe}"`,
        );
        return false;
      }
      accepted.push(p.title);
      return true;
    });

    if (newPosts.length > 0) {
      await fs.writeJson(
        "pending_news.json",
        {
          timestamp: new Date().toISOString(),
          stories: newPosts,
        },
        { spaces: 2 },
      );

      await process_stories();

      // Merge new with existing
      const processed = await db.getStories();
      if (existingStories.length > 0) {
        const processedIds = new Set(processed.map((s) => s.id));
        const toMerge = existingStories.filter((s) => !processedIds.has(s.id));
        const merged = [...processed, ...toMerge];
        await db.saveStories(merged);
      }

      await sendDiscord(
        `**🔎 Pulse Gaming Hunt Complete**\n${newPosts.length} new stories found`,
      );
    } else {
      console.log("[publisher] No new stories found");
    }

    // Step 2: Auto-approve (scoring engine; see autoApprove() doc above).
    addBreadcrumb("Auto-approving stories", "pipeline");
    console.log("[publisher] Step 2/4: Running editorial scoring pass...");
    const scoringSummary = await autoApprove();

    if (scoringSummary.skipped) {
      await sendDiscord(
        `**⚠️ Scoring skipped**: ${scoringSummary.skipped} — no stories approved this cycle.`,
      );
    } else if (scoringSummary.scored > 0) {
      await sendDiscord(
        `**🧠 Editorial pass**\n` +
          `scored ${scoringSummary.scored} · ` +
          `auto ${scoringSummary.approved} · ` +
          `review ${scoringSummary.review} · ` +
          `defer ${scoringSummary.defer} · ` +
          `reject ${scoringSummary.reject}` +
          (scoringSummary.hardStopped
            ? ` · hard_stops ${scoringSummary.hardStopped}`
            : ""),
      );
    }

    // Notify about stories needing human review. Previously this summed
    // every unapproved story (including rejects + deferrals + never-scored
    // noise). Post Phase E we join story_scores so only decision='review'
    // rows surface — reject/defer don't need a human prompt.
    if (!scoringSummary.skipped && scoringSummary.review > 0) {
      try {
        const repos = require("./lib/repositories").getRepos();
        const reviewRows = repos.db
          .prepare(
            `SELECT s.id, s.title, s.flair, s.breaking_score,
                    latest.total AS score_total
             FROM stories s
             JOIN (
               SELECT story_id, MAX(scored_at) AS scored_at, decision, total
               FROM story_scores
               GROUP BY story_id
             ) latest ON latest.story_id = s.id
             WHERE latest.decision = 'review'
               AND (s.approved IS NULL OR s.approved = 0)
             ORDER BY latest.total DESC
             LIMIT 8`,
          )
          .all();
        if (reviewRows.length) {
          const dashUrl =
            process.env.RAILWAY_PUBLIC_URL || "http://localhost:3001";
          const storyList = reviewRows
            .map(
              (s) =>
                `• [${s.flair || "?"}] (rubric:${s.score_total}) ${s.title}`,
            )
            .join("\n");
          await sendDiscord(
            `**⚠️ ${scoringSummary.review} stories flagged for review**\n` +
              `${storyList}\n\n` +
              `👉 Review & approve: ${dashUrl}`,
          );
        }
      } catch (err) {
        console.log(`[publisher] review summary skipped (${err.message})`);
      }
    }

    // Step 3: Produce (audio, images, video)
    addBreadcrumb("Producing assets", "pipeline");
    console.log("[publisher] Step 3/4: Producing assets...");
    await produce();

    // Step 4: Publish to all platforms
    if (process.env.AUTO_PUBLISH === "true") {
      addBreadcrumb("Publishing to all platforms", "pipeline");
      console.log("[publisher] Step 4/4: Publishing to all platforms...");
      const results = await publishToAllPlatforms();

      const totalUploaded =
        results.youtube.length +
        results.tiktok.length +
        results.instagram.length;
      await sendDiscord(
        `**Pulse Gaming Auto-Publish Complete**\n` +
          `YouTube: ${results.youtube.length} | TikTok: ${results.tiktok.length} | Instagram: ${results.instagram.length}\n` +
          `Total: ${totalUploaded} uploads across all platforms`,
      );
    } else {
      console.log(
        "[publisher] Step 4/4: AUTO_PUBLISH not enabled, skipping uploads",
      );
      await sendDiscord(
        "**Pulse Gaming Produce Complete** - Videos ready. Set AUTO_PUBLISH=true to enable uploads.",
      );
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[publisher] Autonomous cycle complete in ${elapsed}s`);
  } catch (err) {
    captureException(err, { step: "fullAutonomousCycle" });
    console.log(`[publisher] CYCLE ERROR: ${err.message}`);
    await sendDiscord(
      `**Pulse Gaming ERROR**\nAutonomous cycle failed: ${err.message}`,
    );
  }
}

// --- Publish-only cycle (for the evening optimal posting window) ---
async function publishOnlyCycle() {
  console.log("[publisher] === PUBLISH-ONLY CYCLE ===");

  try {
    // Auto-approve any remaining stories
    await autoApprove();

    // Produce any unapproved assets
    await produce();

    // Publish
    if (process.env.AUTO_PUBLISH === "true") {
      const results = await publishToAllPlatforms();
      const total =
        results.youtube.length +
        results.tiktok.length +
        results.instagram.length;
      await sendDiscord(
        `**Evening Publish Complete** - ${total} videos posted across platforms`,
      );
    }
  } catch (err) {
    console.log(`[publisher] Publish cycle error: ${err.message}`);
    await sendDiscord(`**Publish Cycle ERROR**: ${err.message}`);
  }
}

// --- Publish a single next-available story across all platforms ---
// Used by the 3x daily publish windows to spread content through the day
async function publishNextStory() {
  // Prevent concurrent publish calls from uploading the same story twice
  if (publishLock) {
    console.log("[publisher] Publish already in progress, skipping");
    return null;
  }
  publishLock = true;

  try {
    return await _publishNextStoryInner();
  } finally {
    publishLock = false;
  }
}

async function _publishNextStoryInner() {
  const stories = await db.getStories();

  // Find stories that still need publishing to at least one platform.
  // This includes brand-new stories AND partially-published ones (e.g. YT succeeded but IG/FB failed).
  const ready = stories.filter((s) => {
    if (!s.approved || !s.exported_path) return false;
    const platformsDone = [
      s.youtube_post_id,
      s.tiktok_post_id,
      s.instagram_media_id,
      s.facebook_post_id,
      s.twitter_post_id,
    ].filter(Boolean).length;
    return platformsDone < 5;
  });

  if (ready.length === 0) {
    console.log("[publisher] No stories need publishing");
    return null;
  }

  // Prioritise: unpublished stories first (0 platforms), then partial, then by score
  ready.sort((a, b) => {
    const aDone = [
      a.youtube_post_id,
      a.tiktok_post_id,
      a.instagram_media_id,
      a.facebook_post_id,
      a.twitter_post_id,
    ].filter(Boolean).length;
    const bDone = [
      b.youtube_post_id,
      b.tiktok_post_id,
      b.instagram_media_id,
      b.facebook_post_id,
      b.twitter_post_id,
    ].filter(Boolean).length;
    if (aDone !== bDone) return aDone - bDone; // fewer platforms done = higher priority
    return (
      (b.breaking_score || b.score || 0) - (a.breaking_score || a.score || 0)
    );
  });

  const story = ready[0];
  const isRetry = !!(
    story.youtube_post_id ||
    story.tiktok_post_id ||
    story.instagram_media_id ||
    story.facebook_post_id ||
    story.twitter_post_id
  );
  console.log(
    `[publisher] Publishing${isRetry ? " (retry)" : ""}: "${story.title}" (score: ${story.breaking_score || story.score || 0})`,
  );

  const result = {
    title: story.title,
    youtube: false,
    tiktok: false,
    instagram: false,
    facebook: false,
    twitter: false,
    errors: {},
  };

  // Sentinel-cleanup cutover: block/skip outcomes for every platform in
  // this function persist to platform_posts as structured rows
  // (status='blocked', block_reason=<text>, external_id=NULL) instead of
  // polluting story.<platform>_post_id with "DUPE_BLOCKED" / "DUPE_SKIPPED"
  // sentinel strings. The denormalised columns stay NULL for new blocks;
  // readers that still grep for sentinels only see them from historical
  // pre-cutover data. The batch path in upload_youtube.js::uploadAll is
  // the only remaining sentinel writer after this cutover (tracked by
  // the follow-up inventory).
  const {
    recordPlatformBlock,
    getPlatformStatus,
  } = require("./lib/services/publish-block");
  const sqliteOn = process.env.USE_SQLITE === "true";
  let pubRepos = null;
  if (sqliteOn) {
    try {
      pubRepos = require("./lib/repositories").getRepos();
    } catch (err) {
      console.log(`[publisher] publish: repos unavailable: ${err.message}`);
    }
  }
  const pubChannelId = story.channel_id || process.env.CHANNEL || null;

  // YouTube - skip if already published or if a similar title was already uploaded
  shadowCanonicalDedupe(story, "youtube", stories);
  const ytTitleDupe = stories.find(
    (s) =>
      s.id !== story.id &&
      s.youtube_post_id &&
      titlesSimilar(s.title, story.title),
  );
  const ytPrior = getPlatformStatus({
    repos: pubRepos,
    storyId: story.id,
    platform: "youtube",
  });
  if (story.youtube_post_id) {
    result.youtube = true;
    console.log(
      `[publisher] YouTube: already published (${story.youtube_post_id})`,
    );
  } else if (ytPrior && ytPrior.status === "blocked") {
    // Structured record from a prior attempt — treat as "already handled"
    // so we don't re-run uploadShort and burn an API call.
    result.youtube = true;
    console.log(
      `[publisher] YouTube: already blocked (${ytPrior.block_reason || "unknown"})`,
    );
  } else if (ytTitleDupe) {
    result.youtube = true;
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "youtube",
      reason: `title-skip: ${ytTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      // Legacy fallback ONLY when platform_posts is unreachable (dev
      // without SQLite). Keeps the old sentinel contract for the dev
      // loop — never hit in production per dispatch-mode.
      story.youtube_post_id = "DUPE_SKIPPED";
    }
    console.log(
      `[publisher] YouTube: SKIPPED duplicate title ~ "${ytTitleDupe.title}" ` +
        `(persisted=${blockResult.persisted})`,
    );
  } else {
    try {
      const { uploadShort } = require("./upload_youtube");
      const ytResult = await uploadShort(story);
      if (ytResult.blocked) {
        const blockResult = recordPlatformBlock({
          repos: pubRepos,
          storyId: story.id,
          platform: "youtube",
          reason: `remote-dupe: ${ytResult.reason || "blocked"}`,
          channelId: pubChannelId,
        });
        if (!blockResult.persisted) {
          story.youtube_post_id = "DUPE_BLOCKED"; // legacy dev fallback
        }
        console.log(
          `[publisher] YouTube: BLOCKED duplicate - ${ytResult.reason} ` +
            `(persisted=${blockResult.persisted})`,
        );
        result.youtube = false;
        result.errors.youtube = `dupe-blocked: ${ytResult.reason}`;
      } else {
        story.youtube_post_id = ytResult.videoId;
        story.youtube_url = ytResult.url;
        story.youtube_published_at = new Date().toISOString();
        console.log(`[publisher] YouTube: ${ytResult.url}`);
        result.youtube = true;
      }
      // Save immediately so concurrent calls see this story as published
      await db.upsertStory(story);

      if (story.title_variants && story.title_variants.length > 1) {
        story.title_check_at = Date.now() + 2 * 60 * 60 * 1000;
      }
    } catch (err) {
      console.log(`[publisher] YouTube upload failed: ${err.message}`);
      story.youtube_error = err.message;
      result.errors.youtube = err.message;
    }
  }

  // TikTok - skip if already published or near-duplicate title already uploaded
  shadowCanonicalDedupe(story, "tiktok", stories);
  const ttTitleDupe = stories.find(
    (s) =>
      s.id !== story.id &&
      s.tiktok_post_id &&
      titlesSimilar(s.title, story.title),
  );
  const ttPrior = getPlatformStatus({
    repos: pubRepos,
    storyId: story.id,
    platform: "tiktok",
  });
  if (story.tiktok_post_id) {
    result.tiktok = true;
    console.log(
      `[publisher] TikTok: already published (${story.tiktok_post_id})`,
    );
  } else if (ttPrior && ttPrior.status === "blocked") {
    result.tiktok = true;
    console.log(
      `[publisher] TikTok: already blocked (${ttPrior.block_reason || "unknown"})`,
    );
  } else if (ttTitleDupe) {
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "tiktok",
      reason: `title-skip: ${ttTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.tiktok_post_id = "DUPE_SKIPPED"; // legacy dev fallback only
    }
    console.log(
      `[publisher] TikTok: SKIPPED duplicate title ~ "${ttTitleDupe.title}" ` +
        `(persisted=${blockResult.persisted})`,
    );
    await db.upsertStory(story);
  } else {
    try {
      const { uploadShort: ttUpload } = require("./upload_tiktok");
      const ttResult = await ttUpload(story);
      story.tiktok_post_id = ttResult.publishId;
      story.tiktok_error = null;
      result.tiktok = true;
      console.log(`[publisher] TikTok: uploaded (API)`);
      await db.upsertStory(story);
    } catch (err) {
      console.log(
        `[publisher] TikTok API failed: ${err.message}, trying browser fallback...`,
      );
      try {
        const {
          uploadShort: ttBrowserUpload,
        } = require("./upload_tiktok_browser");
        const ttResult = await ttBrowserUpload(story);
        story.tiktok_post_id = ttResult.publishId;
        story.tiktok_error = null;
        result.tiktok = true;
        console.log(`[publisher] TikTok: uploaded (browser)`);
        await db.upsertStory(story);
      } catch (browserErr) {
        console.log(
          `[publisher] TikTok browser also failed: ${browserErr.message}`,
        );
        story.tiktok_error = browserErr.message;
        result.errors.tiktok = browserErr.message;
      }
    }
  }

  // Instagram - skip if already published or near-duplicate title already uploaded
  shadowCanonicalDedupe(story, "instagram_reel", stories);
  const igTitleDupe = stories.find(
    (s) =>
      s.id !== story.id &&
      s.instagram_media_id &&
      titlesSimilar(s.title, story.title),
  );
  const igPrior = getPlatformStatus({
    repos: pubRepos,
    storyId: story.id,
    platform: "instagram_reel",
  });
  if (story.instagram_media_id) {
    result.instagram = true;
    console.log(
      `[publisher] Instagram: already published (${story.instagram_media_id})`,
    );
  } else if (igPrior && igPrior.status === "blocked") {
    result.instagram = true;
    console.log(
      `[publisher] Instagram: already blocked (${igPrior.block_reason || "unknown"})`,
    );
  } else if (igTitleDupe) {
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "instagram_reel",
      reason: `title-skip: ${igTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.instagram_media_id = "DUPE_SKIPPED"; // legacy dev fallback only
    }
    console.log(
      `[publisher] Instagram: SKIPPED duplicate title ~ "${igTitleDupe.title}" ` +
        `(persisted=${blockResult.persisted})`,
    );
    await db.upsertStory(story);
  } else {
    try {
      const {
        uploadShort: igUpload,
        uploadReelViaUrl: igUrlUpload,
      } = require("./upload_instagram");
      let igResult;
      try {
        igResult = await igUpload(story);
      } catch (reelErr) {
        console.log(
          `[publisher] Instagram binary upload failed: ${reelErr.message}, trying URL fallback...`,
        );
        igResult = await igUrlUpload(story);
      }
      story.instagram_media_id = igResult.mediaId;
      story.instagram_error = null;
      result.instagram = true;
      console.log(`[publisher] Instagram: uploaded`);
      await db.upsertStory(story);
    } catch (err) {
      console.log(`[publisher] Instagram upload failed: ${err.message}`);
      story.instagram_error = err.message;
      result.errors.instagram = err.message;
    }
  }

  // Facebook Reels - skip if already published or near-duplicate title already uploaded
  shadowCanonicalDedupe(story, "facebook_reel", stories);
  const fbTitleDupe = stories.find(
    (s) =>
      s.id !== story.id &&
      s.facebook_post_id &&
      titlesSimilar(s.title, story.title),
  );
  const fbPrior = getPlatformStatus({
    repos: pubRepos,
    storyId: story.id,
    platform: "facebook_reel",
  });
  if (story.facebook_post_id) {
    result.facebook = true;
    console.log(
      `[publisher] Facebook: already published (${story.facebook_post_id})`,
    );
  } else if (fbPrior && fbPrior.status === "blocked") {
    result.facebook = true;
    console.log(
      `[publisher] Facebook: already blocked (${fbPrior.block_reason || "unknown"})`,
    );
  } else if (fbTitleDupe) {
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "facebook_reel",
      reason: `title-skip: ${fbTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.facebook_post_id = "DUPE_SKIPPED"; // legacy dev fallback only
    }
    console.log(
      `[publisher] Facebook: SKIPPED duplicate title ~ "${fbTitleDupe.title}" ` +
        `(persisted=${blockResult.persisted})`,
    );
    await db.upsertStory(story);
  } else {
    try {
      const {
        uploadShort: fbUpload,
        uploadReelViaUrl,
      } = require("./upload_facebook");
      let fbResult;
      try {
        fbResult = await fbUpload(story);
      } catch (reelErr) {
        console.log(
          `[publisher] Facebook Reel binary upload failed: ${reelErr.message}, trying URL fallback...`,
        );
        fbResult = await uploadReelViaUrl(story);
      }
      story.facebook_post_id = fbResult.videoId;
      story.facebook_error = null;
      result.facebook = true;
      console.log(`[publisher] Facebook: uploaded`);
      await db.upsertStory(story);
    } catch (err) {
      console.log(`[publisher] Facebook upload failed: ${err.message}`);
      story.facebook_error = err.message;
      result.errors.facebook = err.message;
    }
  }

  // X/Twitter - skip if already published or near-duplicate title already uploaded
  shadowCanonicalDedupe(story, "twitter_video", stories);
  const twTitleDupe = stories.find(
    (s) =>
      s.id !== story.id &&
      s.twitter_post_id &&
      titlesSimilar(s.title, story.title),
  );
  const twPrior = getPlatformStatus({
    repos: pubRepos,
    storyId: story.id,
    platform: "twitter_video",
  });
  if (story.twitter_post_id) {
    result.twitter = true;
    console.log(
      `[publisher] Twitter: already published (${story.twitter_post_id})`,
    );
  } else if (twPrior && twPrior.status === "blocked") {
    result.twitter = true;
    console.log(
      `[publisher] Twitter: already blocked (${twPrior.block_reason || "unknown"})`,
    );
  } else if (twTitleDupe) {
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "twitter_video",
      reason: `title-skip: ${twTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.twitter_post_id = "DUPE_SKIPPED"; // legacy dev fallback only
    }
    console.log(
      `[publisher] Twitter: SKIPPED duplicate title ~ "${twTitleDupe.title}" ` +
        `(persisted=${blockResult.persisted})`,
    );
    await db.upsertStory(story);
  } else {
    try {
      const { uploadShort: twUpload } = require("./upload_twitter");
      const twResult = await twUpload(story);
      story.twitter_post_id = twResult.tweetId;
      story.twitter_error = null;
      result.twitter = true;
      console.log(`[publisher] Twitter: uploaded`);
      await db.upsertStory(story);
    } catch (err) {
      console.log(`[publisher] Twitter upload failed: ${err.message}`);
      story.twitter_error = err.message;
      result.errors.twitter = err.message;
    }
  }

  // Set publish status based on total platforms done (including previously successful ones)
  const totalDone = [
    story.youtube_post_id,
    story.tiktok_post_id,
    story.instagram_media_id,
    story.facebook_post_id,
    story.twitter_post_id,
  ].filter(Boolean).length;
  if (totalDone >= 5) {
    story.publish_status = "published";
  } else if (totalDone > 0) {
    story.publish_status = "partial";
  } else {
    story.publish_status = "failed";
  }
  if (!story.published_at && totalDone > 0) {
    story.published_at = new Date().toISOString();
  }

  // --- Story card image distribution ---
  // Each platform is gated on its own post-id field so a partial failure
  // followed by a retry only re-tries the platforms that actually failed.
  // The old `!isRetry` guard checked only Reels IDs which meant that when
  // assemble.js cleared Reel IDs for a re-render, Stories got posted a
  // second time with no idempotency check. Individual-field gates fix that.
  if (story.story_image_path) {
    // Instagram Stories
    if (story.instagram_story_id) {
      console.log(
        `[publisher] Instagram Story: already posted (${story.instagram_story_id})`,
      );
    } else {
      try {
        const { uploadStoryImage: igStory } = require("./upload_instagram");
        const igStoryResult = await igStory(story);
        story.instagram_story_id = igStoryResult.mediaId;
        console.log(
          `[publisher] Instagram Story: uploaded (${igStoryResult.mediaId})`,
        );
      } catch (err) {
        console.log(
          `[publisher] Instagram Story upload failed: ${err.message}`,
        );
        result.errors.instagram_story = err.message;
      }
    }

    // Facebook Stories
    if (story.facebook_story_id) {
      console.log(
        `[publisher] Facebook Story: already posted (${story.facebook_story_id})`,
      );
    } else {
      try {
        const { uploadStoryImage: fbStory } = require("./upload_facebook");
        const fbStoryResult = await fbStory(story);
        story.facebook_story_id = fbStoryResult.storyId;
        console.log(
          `[publisher] Facebook Story: uploaded (${fbStoryResult.storyId})`,
        );
      } catch (err) {
        console.log(`[publisher] Facebook Story upload failed: ${err.message}`);
        result.errors.facebook_story = err.message;
      }
    }

    // Twitter/X image tweet
    if (story.twitter_image_tweet_id) {
      console.log(
        `[publisher] Twitter image tweet: already posted (${story.twitter_image_tweet_id})`,
      );
    } else {
      try {
        const { postImageTweet } = require("./upload_twitter");
        const twImgResult = await postImageTweet(story);
        story.twitter_image_tweet_id = twImgResult.tweetId;
        console.log(
          `[publisher] Twitter image tweet: posted (${twImgResult.tweetId})`,
        );
      } catch (err) {
        console.log(`[publisher] Twitter image tweet failed: ${err.message}`);
        result.errors.twitter_image = err.message;
      }
    }
  }

  // Schedule first-hour engagement pass (only on first successful YT publish)
  if (story.youtube_post_id && !isRetry) {
    setTimeout(
      async () => {
        try {
          const { engageFirstHour } = require("./engagement");
          await engageFirstHour(story.youtube_post_id, story);
        } catch (err) {
          console.log(
            `[publisher] First-hour engagement failed: ${err.message}`,
          );
        }
      },
      5 * 60 * 1000,
    );
    console.log(
      `[publisher] First-hour engagement scheduled for ${story.youtube_post_id} in 5 min`,
    );
  }

  // Generate poll/engagement pinned comment (only on first publish, not retries)
  if (!isRetry) {
    try {
      const {
        generatePollComment,
        pinComment: pinEngagement,
      } = require("./engagement");
      const pollComment = await generatePollComment(story);
      if (pollComment && story.youtube_post_id) {
        const commentId = await pinEngagement(
          story.youtube_post_id,
          pollComment,
        );
        if (commentId) {
          story.engagement_comment_id = commentId;
          console.log(`[publisher] Engagement comment pinned: ${commentId}`);
        }
      }
    } catch (err) {
      console.log(`[publisher] Engagement comment skipped: ${err.message}`);
    }
  }

  // Generate blog post (only on first publish)
  if (!isRetry) {
    try {
      const { generateAndSaveBlogPost } = require("./blog/generator");
      await generateAndSaveBlogPost(story);
    } catch (err) {
      console.log("[publisher] Blog generation skipped: " + err.message);
    }
  }

  // Post to Discord channels, video drops only (news already posted by processor.js).
  //
  // Migration 012 replaces the old `!isRetry` derived-state guard with
  // durable per-story markers so a re-render that clears platform ids
  // cannot re-trigger #video-drops or #polls. isRetry is still used for
  // the YouTube engagement pass / blog gen / pinned comment above — that
  // logic is correctly "only on first successful publish" and doesn't
  // have the re-render-resets-ids failure mode that Discord did.
  try {
    const { postVideoUpload, postStoryPoll } = require("./discord/auto_post");
    const {
      shouldPostVideoDrop,
      shouldPostStoryPoll,
      markVideoDropPosted,
      markStoryPollPosted,
    } = require("./lib/services/discord-post-gate");

    let postedVideoDropNow = false;
    if (shouldPostVideoDrop(story)) {
      const msg = await postVideoUpload(story);
      if (msg) {
        markVideoDropPosted(story);
        postedVideoDropNow = true;
      }
    }

    let postedPollNow = false;
    if (shouldPostStoryPoll(story)) {
      const pollMsg = await postStoryPoll(story);
      if (pollMsg) {
        markStoryPollPosted(story);
        postedPollNow = true;
      }
    }

    if (postedVideoDropNow || postedPollNow) {
      console.log(
        `[publisher] Discord: video-drops=${postedVideoDropNow} poll=${postedPollNow}`,
      );
    } else {
      console.log(
        `[publisher] Discord: skipped (video_drop_marker=${!!story.discord_video_drop_posted_at} poll_marker=${!!story.discord_story_poll_posted_at})`,
      );
    }
  } catch (err) {
    console.log(`[publisher] Discord post skipped: ${err.message}`);
  }

  // Save updated story (upsert to avoid wiping other stories)
  try {
    await db.upsertStory(story);
  } catch (err) {
    console.log(
      `[publisher] CRITICAL: Failed to save story state after publishing: ${err.message}`,
    );
    captureException(err, {
      step: "publishNextStory.upsertStory",
      storyId: story.id,
    });
  }
  return result;
}

module.exports = {
  autoApprove,
  produce,
  publishToAllPlatforms,
  publishNextStory,
  fullAutonomousCycle,
  publishOnlyCycle,
};

if (require.main === module) {
  const mode = process.argv[2] || "full";

  if (mode === "full") {
    fullAutonomousCycle().catch(console.error);
  } else if (mode === "publish") {
    publishOnlyCycle().catch(console.error);
  } else if (mode === "approve") {
    autoApprove().catch(console.error);
  } else {
    console.log("Usage: node publisher.js [full|publish|approve]");
  }
}
