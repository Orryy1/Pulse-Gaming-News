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

  // Pre-pass: self-heal stale path fields across all stories. If
  // exported_path / audio_path / image_path / story_image_path are
  // set but the file is gone (typical after a Railway redeploy
  // before MEDIA_ROOT was configured), NULL the field so the
  // appropriate stage below re-generates it. We DO NOT touch
  // platform post ids — partial-retry semantics depend on them
  // being preserved (otherwise we'd republish and create dup
  // public posts).
  //
  // Runs once at the top of produce so every stage that follows
  // sees a consistent "path set ⇔ file present" invariant.
  await selfHealStaleMediaPaths();

  const affiliates = require("./affiliates");
  const audio = require("./audio");
  const images = require("./images");
  const assemble = require("./assemble");
  const { generateEntityMentions } = require("./entities");

  await affiliates();
  await audio();
  // Entity extraction runs between audio (needs word-level timestamps)
  // and assemble (consumes story.mentions to overlay faces at spoken
  // moments). Safe to skip — assemble treats missing mentions as no-op.
  await generateEntityMentions();
  await images();
  await assemble();

  // Generate Instagram Story images for each produced video
  const { generateStoryImages } = require("./images_story");
  await generateStoryImages();

  // Studio v2: build per-story YouTube thumbnails (1280×720 JPEG) for
  // every approved+exported story that doesn't yet have one. Best-
  // effort — failures are logged and skipped, the produce pipeline
  // continues regardless. The JPEG path is stamped onto
  // story.hf_thumbnail_path for upload_youtube.js to pick up via
  // youtube.thumbnails.set.
  try {
    const {
      buildThumbnailsForApprovedStories,
    } = require("./lib/studio/v2/hf-thumbnail-builder");
    await buildThumbnailsForApprovedStories();
  } catch (err) {
    console.log(
      `[publisher] HF thumbnail batch errored (non-fatal): ${err.message}`,
    );
  }

  // Session 2 — warn-only format-catalogue routing. For every
  // approved+exported story, score the media inventory and surface
  // the recommended format. We deliberately do NOT change render
  // behaviour from this hook yet; the goal is to (a) populate
  // observability so an operator can see which stories are being
  // padded into Shorts when they should be Briefing items or blog-
  // only, and (b) prove the classifier against real production
  // stories before promoting it. Anything off here is informational
  // — failures are non-fatal.
  try {
    await logFormatRecommendationsForApprovedStories();
  } catch (err) {
    console.log(
      `[publisher] format-catalogue warn-only pass errored (non-fatal): ${err.message}`,
    );
  }

  console.log("[publisher] Produce pipeline complete");
}

async function logFormatRecommendationsForApprovedStories() {
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) return;
  const targets = stories.filter((s) => s.approved === true && s.exported_path);
  if (targets.length === 0) return;
  const {
    scoreStoryMediaInventory,
  } = require("./lib/creative/media-inventory-scorer");
  const { recommendRuntime } = require("./lib/creative/runtime-recommender");
  const { selectFormatForStory } = require("./lib/creative/format-catalogue");

  const counts = {
    premium_video: 0,
    standard_video: 0,
    short_only: 0,
    briefing_item: 0,
    blog_only: 0,
    reject_visuals: 0,
  };
  const downgrades = [];
  for (const story of targets) {
    let inv;
    try {
      inv = scoreStoryMediaInventory(story);
    } catch (err) {
      console.log(
        `[publisher] inventory scorer errored for ${story.id} (non-fatal): ${err.message}`,
      );
      continue;
    }
    counts[inv.classification] = (counts[inv.classification] || 0) + 1;
    const runtime = recommendRuntime(inv);
    const fmt = selectFormatForStory(story, inv);
    const fmtId = fmt?.format?.id || "unknown";
    if (
      inv.classification === "blog_only" ||
      inv.classification === "reject_visuals" ||
      inv.classification === "briefing_item"
    ) {
      downgrades.push({
        id: story.id,
        title: (story.title || "").slice(0, 80),
        class: inv.classification,
        recommended_format: fmtId,
        should_render: runtime.shouldRender,
        reasons: inv.classificationReasons,
      });
    }
    console.log(
      `[publisher] format-recommend ${story.id}: class=${inv.classification} ` +
        `format=${fmtId} render=${runtime.shouldRender} ` +
        `runtime=${runtime.runtimeSeconds ? `${runtime.runtimeSeconds.min}-${runtime.runtimeSeconds.max}s` : "n/a"}`,
    );
  }
  console.log(
    `[publisher] format-catalogue summary: ${Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ")} (warn-only — no render change)`,
  );
  if (downgrades.length > 0) {
    console.log(
      `[publisher] format-catalogue downgrade candidates: ${downgrades.length} stories below standard_video bar`,
    );
    for (const d of downgrades.slice(0, 5)) {
      console.log(
        `[publisher]   - ${d.id} (${d.class}) → ${d.recommended_format}: ${d.reasons.join(", ")}`,
      );
    }
  }
}

/**
 * Self-heal stale media-path fields. Walks every story and, for
 * each path field it stores, NULLs the field if the referenced
 * file is missing on disk (resolved via lib/media-paths so
 * MEDIA_ROOT is honoured). Platform post ids are intentionally
 * NOT cleared — preserving them lets partial-retry logic only
 * re-upload the platforms that actually need a fresh MP4.
 *
 * Exported for unit tests. Safe to call multiple times — it's a
 * pure "path set but file missing → NULL" operation.
 */
async function selfHealStaleMediaPaths({ repos: _repos } = {}) {
  const fs = require("fs-extra");
  const mediaPaths = require("./lib/media-paths");
  const stories = await db.getStories();
  const fields = [
    "exported_path",
    "audio_path",
    "image_path",
    "story_image_path",
    "hf_thumbnail_path",
    "thumbnail_candidate_path",
  ];
  let healed = 0;
  for (const s of stories) {
    let changed = false;
    for (const field of fields) {
      const val = s[field];
      if (!val || typeof val !== "string") continue;
      try {
        const resolved = await mediaPaths.resolveExisting(val);
        const exists = resolved ? await fs.pathExists(resolved) : false;
        if (!exists) {
          console.log(
            `[self-heal] ${s.id}: ${field}=${val} missing on disk (checked ${resolved}) — clearing`,
          );
          s[field] = null;
          changed = true;
        }
      } catch (err) {
        console.log(
          `[self-heal] ${s.id}: error checking ${field}=${val}: ${err.message}`,
        );
      }
    }
    if (changed) {
      try {
        await db.upsertStory(s);
        healed++;
      } catch (err) {
        console.log(
          `[self-heal] ${s.id}: failed to persist self-heal: ${err.message}`,
        );
      }
    }
  }
  if (healed > 0) {
    console.log(`[self-heal] cleared stale media paths on ${healed} stories`);
  }
  return { healed };
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

  // TikTok - try official API first. Browser fallback is off by
  // default in production (Task 5) — see the per-story path below
  // for the full rationale. Opt in via TIKTOK_BROWSER_FALLBACK=true
  // from local dev only.
  try {
    const { uploadAll: ttUpload } = require("./upload_tiktok");
    results.tiktok = await ttUpload();
    console.log(`[publisher] TikTok: ${results.tiktok.length} uploaded (API)`);
  } catch (err) {
    const wantBrowserFallback =
      (process.env.TIKTOK_BROWSER_FALLBACK || "").toLowerCase() === "true";
    const safeMsg = String(err && err.message ? err.message : err)
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
      .replace(/access_token=[^\s&"']+/gi, "access_token=<redacted>");
    if (!wantBrowserFallback) {
      console.log(
        `[publisher] TikTok API failed: ${safeMsg} (browser fallback disabled — set TIKTOK_BROWSER_FALLBACK=true to enable)`,
      );
    } else {
      console.log(
        `[publisher] TikTok API failed: ${err.message}, trying browser fallback (TIKTOK_BROWSER_FALLBACK=true)...`,
      );
      try {
        const {
          uploadAll: ttBrowserUpload,
        } = require("./upload_tiktok_browser");
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

// Multi-candidate publish fallback cap (2026-04-22).
//
// Before this change, a single stale `exported_path` pointing at an
// already-deleted MP4 would burn the whole publish window: one
// QA-fail → return → no upload → wait 5 hours for the next window.
// Today (22 April) both 09:00 UTC and 14:00 UTC burned on the same
// single-candidate semantics even after the QA-fail deadlock fix.
//
// The selector now iterates up to MAX_PUBLISH_CANDIDATES_PER_WINDOW
// candidates; each QA-failing candidate is persisted and skipped,
// and the first QA-passing candidate is what actually uploads. One
// upload per window is still the rule — this cap is purely about
// how many bad candidates we'll burn past before giving up.
//
// Cap rationale: 5 is enough to tolerate a handful of stale-pointer
// stories in the backlog without risking a runaway QA loop on a
// day where the hunter/processor has shipped many broken items.
const MAX_PUBLISH_CANDIDATES_PER_WINDOW = 5;

/**
 * Count how many of the 5 tracked platform post ids the story has
 * already acquired. Used by the candidate ordering (fewest-done
 * first → highest priority) and by the `isRetry` check below.
 */
function countStoryPlatformsDone(s) {
  return [
    s.youtube_post_id,
    s.tiktok_post_id,
    s.instagram_media_id,
    s.facebook_post_id,
    s.twitter_post_id,
  ].filter(Boolean).length;
}

function storyIsRetry(s) {
  return !!(
    s.youtube_post_id ||
    s.tiktok_post_id ||
    s.instagram_media_id ||
    s.facebook_post_id ||
    s.twitter_post_id
  );
}

/**
 * Persist a QA hard-fail on the story row and return the structured
 * row suitable for the no-safe-candidate summary. Extracted so the
 * multi-candidate loop can call the same persistence path on each
 * failure without duplicating the store/notify invariants.
 *
 * The row:
 *   story.qa_failed = true          → the selector's skip predicate
 *   story.publish_status = "failed" → same (belt-and-braces)
 *   story.publish_error  = "qa_blocked: <first reason>"
 *   story.qa_failed_at   = now
 *   story.qa_failures    = full failure list
 *   story.qa_warnings    = full warning list (dedup'd via Set)
 *
 * The "source" argument ("content" / "video") is stored on the
 * error message so Discord can render "content_qa_blocked" vs
 * "video_qa_blocked" without inspecting the failures array.
 */
async function persistQaFail(story, { failures, warnings, source }) {
  const reason = failures && failures.length > 0 ? failures[0] : "unknown";
  story.qa_failed = true;
  story.qa_failures = Array.isArray(failures) ? failures : [];
  story.qa_warnings = Array.from(
    new Set([].concat(Array.isArray(warnings) ? warnings : [])),
  );
  story.qa_failed_at = new Date().toISOString();
  story.publish_status = "failed";
  story.publish_error = `qa_blocked: ${reason}`;
  try {
    await db.upsertStory(story);
  } catch (persistErr) {
    console.log(
      `[publisher] CRITICAL: failed to persist ${source}-QA fail state for ${story.id}: ${persistErr.message}`,
    );
    captureException(persistErr, {
      step: `publishNextStory.${source}_qa_persist`,
      storyId: story.id,
    });
  }
  return {
    id: story.id,
    title: story.title,
    reason,
    source,
    failures: story.qa_failures,
  };
}

/**
 * Run content-QA + video-QA against a candidate story. Returns
 *
 *   { pass: true,  warnings }
 *   { pass: false, failures, warnings, source: "content" | "video" }
 *
 * Pure / side-effect-free — caller is responsible for persistence
 * on fail and for deciding what to do with warnings on pass.
 *
 * QA helpers throwing is non-fatal: we log and treat as pass. A
 * broken QA module must NEVER freeze the daily publish cycle —
 * the operator gets the Discord summary either way.
 */
async function runPreflightQa(story) {
  const warnings = [];

  // Content QA — metadata + script + MP4 size / existence
  try {
    const { runContentQa } = require("./lib/services/content-qa");
    const cqa = await runContentQa(story);
    if (cqa.warnings && cqa.warnings.length > 0) {
      console.log(
        `[publisher] content QA warnings (${story.id}): ${cqa.warnings.join(", ")}`,
      );
      warnings.push(...cqa.warnings);
    }
    if (cqa.result === "fail") {
      console.log(
        `[publisher] content QA FAIL (${story.id}): ${cqa.failures.join(", ")}`,
      );
      return {
        pass: false,
        failures: cqa.failures,
        warnings: warnings.slice(),
        source: "content",
      };
    }
  } catch (qaErr) {
    console.log(
      `[publisher] content-qa error for ${story.id} (non-fatal): ${qaErr.message}`,
    );
  }

  // Video QA — duration + black-frame detection via ffprobe/ffmpeg
  try {
    const { runVideoQa } = require("./lib/services/video-qa");
    const vqa = story.exported_path
      ? await runVideoQa(story.exported_path)
      : { result: "skip", reason: "no_exported_path" };
    if (vqa.result === "warn" && Array.isArray(vqa.warnings)) {
      console.log(
        `[publisher] video QA warnings (${story.id}): ${vqa.warnings.join(", ")}`,
      );
      warnings.push(...vqa.warnings);
    }
    if (vqa.result === "fail") {
      console.log(
        `[publisher] video QA FAIL (${story.id}): ${vqa.failures.join(", ")}`,
      );
      return {
        pass: false,
        failures: vqa.failures,
        warnings: warnings.slice(),
        source: "video",
      };
    }
    if (vqa.result === "skip") {
      console.log(
        `[publisher] video QA skipped for ${story.id}: ${vqa.reason || "unknown"}`,
      );
    }
  } catch (qaErr) {
    console.log(
      `[publisher] video-qa error for ${story.id} (non-fatal): ${qaErr.message}`,
    );
  }

  return { pass: true, warnings };
}

async function _publishNextStoryInner() {
  const stories = await db.getStories();

  // Find stories that still need publishing to at least one platform.
  // This includes brand-new stories AND partially-published ones (e.g. YT succeeded but IG/FB failed).
  //
  // Exclusions (2026-04-21 QA-fail deadlock fix):
  //   - qa_failed === true      The pre-flight content / video QA
  //                              refused to publish this story on a
  //                              prior window. Without this skip, the
  //                              same story would be re-selected every
  //                              09/14/19 UTC window forever. The
  //                              operator must re-run the processor /
  //                              produce pipeline to regenerate the
  //                              artefact and clear the flag.
  //   - publish_status="failed" Either a fresh QA-fail (caught above)
  //                              or an all-4-core upload fail from a
  //                              prior window. Retrying on the same
  //                              schedule just burns attempts — needs
  //                              operator intervention.
  // Partial stories (publish_status="partial" with 1-3 core ids)
  // are NOT skipped — they legitimately retry only the missing
  // platforms at the next window.
  const ready = stories.filter((s) => {
    if (!s.approved || !s.exported_path) return false;
    if (s.qa_failed === true) return false;
    if (s.publish_status === "failed") return false;
    return countStoryPlatformsDone(s) < 5;
  });

  if (ready.length === 0) {
    console.log("[publisher] No stories need publishing");
    return null;
  }

  // Prioritise: unpublished stories first (0 platforms), then partial, then by score
  ready.sort((a, b) => {
    const aDone = countStoryPlatformsDone(a);
    const bDone = countStoryPlatformsDone(b);
    if (aDone !== bDone) return aDone - bDone;
    return (
      (b.breaking_score || b.score || 0) - (a.breaking_score || a.score || 0)
    );
  });

  // Multi-candidate loop. We'll walk up to
  // MAX_PUBLISH_CANDIDATES_PER_WINDOW stories and take the first
  // one that passes preflight QA. Each QA-failing candidate is
  // persisted so it's skipped in all future windows too.
  const candidates = ready.slice(0, MAX_PUBLISH_CANDIDATES_PER_WINDOW);
  const qaSkipped = []; // structured {id, title, reason, source, failures}
  let story = null;
  let isRetry = false;
  let preflightWarnings = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateIsRetry = storyIsRetry(candidate);
    console.log(
      `[publisher] Candidate ${i + 1}/${candidates.length}${candidateIsRetry ? " (retry)" : ""}: ` +
        `"${candidate.title}" (score: ${candidate.breaking_score || candidate.score || 0})`,
    );

    if (candidateIsRetry) {
      // Partial-retry stories bypass QA — they were already published
      // once, so the artefacts are known-good. Take this candidate
      // immediately.
      story = candidate;
      isRetry = true;
      break;
    }

    const qa = await runPreflightQa(candidate);
    if (qa.pass) {
      story = candidate;
      isRetry = false;
      preflightWarnings = qa.warnings || [];
      break;
    }

    // Hard-fail: persist and continue.
    const skipped = await persistQaFail(candidate, {
      failures: qa.failures,
      warnings: qa.warnings,
      source: qa.source,
    });
    qaSkipped.push(skipped);
  }

  if (!story) {
    // No candidate in the first MAX passed QA. Return a structured
    // no-safe-candidate result so the job handler / Discord summary
    // can render "Skipped QA-failed candidates: N" with the top
    // reason instead of a bland "skipped" / "unknown".
    const top = qaSkipped[0] || null;
    console.log(
      `[publisher] No safe publish candidate passed QA (tried ${candidates.length}, skipped ${qaSkipped.length})`,
    );
    return {
      no_safe_candidate: true,
      qa_skipped_count: qaSkipped.length,
      qa_skipped: qaSkipped,
      top_reason: top
        ? `${top.source}_qa: ${top.reason}`
        : "no_candidates_eligible",
      candidates_tried: candidates.length,
    };
  }

  console.log(
    `[publisher] Publishing${isRetry ? " (retry)" : ""}: "${story.title}" ` +
      `(score: ${story.breaking_score || story.score || 0}, qa_skipped_before=${qaSkipped.length})`,
  );

  const result = {
    title: story.title,
    // --- CORE (video) platforms: true iff a Reel/Short upload for
    // this platform is now considered "done" — that includes both
    // a fresh new upload AND an already-published state (partial
    // retry). This flag feeds publish_status computation (the
    // 4-core rule). It is NOT the signal for Discord rendering —
    // Discord renders from result.platform_outcomes below.
    youtube: false,
    tiktok: false,
    instagram: false,
    facebook: false,
    twitter: false,
    errors: {},
    skipped: {},
    fallbacks: {
      facebook_card: false,
      instagram_story: false,
      twitter_image: false,
    },
    // --- TRUTHFUL PLATFORM OUTCOMES (2026-04-23 forensic audit) ---
    //
    // Before this field, `result.youtube = true` on a partial-retry
    // story rendered `YT ✅` in Discord because the story already
    // had a youtube_post_id from a previous window — the Discord
    // operator couldn't tell a fresh upload from a 3-day-old one.
    //
    // platform_outcomes distinguishes every state the publisher
    // walks through:
    //
    //   "new_upload"          — uploader was called this window,
    //                           returned a fresh external id
    //   "already_published"   — story row already had a post id
    //                           from a prior window; we did NOT
    //                           call the uploader
    //   "duplicate_blocked"   — uploader refused (remote-dupe) or
    //                           title-similarity pre-check blocked
    //   "accepted_processing" — uploader returned an accepted/
    //                           processing response without a final
    //                           id (IG / FB Reel pending state)
    //   "failed"              — uploader was called and threw
    //   "skipped"             — optional platform declined (e.g.
    //                           Twitter disabled) — never counts
    //                           as failure or success
    //   "not_attempted"       — no code path touched the platform
    //                           (should not happen in steady state)
    //
    // lib/job-handlers.js::renderPublishSummary reads this map and
    // renders per-platform glyphs accordingly. Status is derived
    // from new_upload count — a window where every core platform
    // is "already_published" produces NO new public post and now
    // correctly renders `Status: no_new_post`.
    platform_outcomes: {
      youtube: "not_attempted",
      tiktok: "not_attempted",
      instagram: "not_attempted",
      facebook: "not_attempted",
      twitter: "not_attempted",
      facebook_card: "not_attempted",
      instagram_story: "not_attempted",
      twitter_image: "not_attempted",
    },
    // QA metadata — preflight warnings we didn't block on, and
    // the count/list of earlier candidates we QA-skipped before
    // landing on this one. renderPublishSummary surfaces both.
    qa_warnings: preflightWarnings,
    qa_skipped_count: qaSkipped.length,
    qa_skipped: qaSkipped,
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
    result.platform_outcomes.youtube = "already_published";
    console.log(
      `[publisher] YouTube: already published (${story.youtube_post_id})`,
    );
  } else if (ytPrior && ytPrior.status === "blocked") {
    result.youtube = true;
    result.platform_outcomes.youtube = "duplicate_blocked";
    console.log(
      `[publisher] YouTube: already blocked (${ytPrior.block_reason || "unknown"})`,
    );
  } else if (ytTitleDupe) {
    result.youtube = true;
    result.platform_outcomes.youtube = "duplicate_blocked";
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "youtube",
      reason: `title-skip: ${ytTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
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
          story.youtube_post_id = "DUPE_BLOCKED";
        }
        console.log(
          `[publisher] YouTube: BLOCKED duplicate - ${ytResult.reason} ` +
            `(persisted=${blockResult.persisted})`,
        );
        result.youtube = false;
        result.platform_outcomes.youtube = "duplicate_blocked";
        result.errors.youtube = `dupe-blocked: ${ytResult.reason}`;
      } else {
        story.youtube_post_id = ytResult.videoId;
        story.youtube_url = ytResult.url;
        story.youtube_published_at = new Date().toISOString();
        console.log(`[publisher] YouTube: ${ytResult.url}`);
        result.youtube = true;
        result.platform_outcomes.youtube = "new_upload";
      }
      await db.upsertStory(story);

      if (story.title_variants && story.title_variants.length > 1) {
        story.title_check_at = Date.now() + 2 * 60 * 60 * 1000;
      }
    } catch (err) {
      console.log(`[publisher] YouTube upload failed: ${err.message}`);
      story.youtube_error = err.message;
      result.errors.youtube = err.message;
      result.platform_outcomes.youtube = "failed";
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
    result.platform_outcomes.tiktok = "already_published";
    console.log(
      `[publisher] TikTok: already published (${story.tiktok_post_id})`,
    );
  } else if (ttPrior && ttPrior.status === "blocked") {
    result.tiktok = true;
    result.platform_outcomes.tiktok = "duplicate_blocked";
    console.log(
      `[publisher] TikTok: already blocked (${ttPrior.block_reason || "unknown"})`,
    );
  } else if (ttTitleDupe) {
    result.platform_outcomes.tiktok = "duplicate_blocked";
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "tiktok",
      reason: `title-skip: ${ttTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.tiktok_post_id = "DUPE_SKIPPED";
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
      result.platform_outcomes.tiktok = "new_upload";
      console.log(`[publisher] TikTok: uploaded (API)`);
      await db.upsertStory(story);
    } catch (err) {
      // --- Buffer fallback: cleanest path through TikTok audit ---
      //
      // Buffer (buffer.com) has completed TikTok's audit. When
      // USE_BUFFER_TIKTOK=true and BUFFER_ACCESS_TOKEN is set, route
      // the failed-direct-API job through Buffer's queue instead of
      // surfacing the 403. This unblocks audit-pending TikTok
      // posting without giving up direct API control once our own
      // audit clears.
      try {
        const {
          isEnabled: bufferEnabled,
          publishToTiktokViaBuffer,
        } = require("./lib/platforms/buffer-tiktok");
        if (bufferEnabled()) {
          console.log(
            `[publisher] TikTok API failed (${(err && err.message) || err}), trying Buffer queue...`,
          );
          const exportedAbs =
            (await mediaPaths.resolveExisting(story.exported_path)) ||
            story.exported_path;
          const captionTitle =
            story.suggested_title ||
            story.suggested_thumbnail_text ||
            story.title;
          const tags = (story.suggested_hashtags || []).concat([
            "#Shorts",
            "#fyp",
            "#viral",
          ]);
          const bufferResult = await publishToTiktokViaBuffer({
            videoPath: exportedAbs,
            caption: String(captionTitle || "").slice(0, 1500),
            hashtags: tags,
          });
          if (bufferResult.ok) {
            story.tiktok_post_id = `buffer:${bufferResult.updateId}`;
            story.tiktok_error = null;
            result.tiktok = true;
            result.platform_outcomes.tiktok = "new_upload_via_buffer";
            console.log(
              `[publisher] TikTok: queued via Buffer update ${bufferResult.updateId}`,
            );
            await db.upsertStory(story);
            // Buffer succeeded — skip browser fallback entirely.
            return result;
          }
          console.log(
            `[publisher] Buffer not viable: ${bufferResult.reason}${bufferResult.note ? " — " + bufferResult.note : ""}`,
          );
        }
      } catch (bufferErr) {
        console.log(
          `[publisher] Buffer fallback errored: ${bufferErr.message} — falling through to legacy paths`,
        );
      }

      // --- Browser fallback: off by default in production ---
      //
      // Task 5 (2026-04-21): the browser automation (Playwright
      // logged into the TikTok web creator) is a legacy escape
      // hatch from when the API was unreliable. In production it
      // (a) hides the real API error from Discord, and (b)
      // depends on a persistent Brave profile on /data that
      // doesn't exist on fresh deploys. Surface the real API
      // error by default; allow the fallback only when an
      // operator explicitly opts in with
      // TIKTOK_BROWSER_FALLBACK=true (typically local dev).
      const wantBrowserFallback =
        (process.env.TIKTOK_BROWSER_FALLBACK || "").toLowerCase() === "true";
      if (!wantBrowserFallback) {
        // Scrub any stray token/Bearer-shaped substring from the
        // error before we hand it to Discord / platform_posts.
        const safeMsg = String(err && err.message ? err.message : err)
          .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
          .replace(/access_token=[^\s&"']+/gi, "access_token=<redacted>");
        console.log(
          `[publisher] TikTok API failed: ${safeMsg} (browser fallback disabled — set TIKTOK_BROWSER_FALLBACK=true to enable)`,
        );
        story.tiktok_error = safeMsg;
        result.errors.tiktok = safeMsg;
        result.platform_outcomes.tiktok = "failed";
      } else {
        console.log(
          `[publisher] TikTok API failed: ${err.message}, trying browser fallback (TIKTOK_BROWSER_FALLBACK=true)...`,
        );
        try {
          const {
            uploadShort: ttBrowserUpload,
          } = require("./upload_tiktok_browser");
          const ttResult = await ttBrowserUpload(story);
          story.tiktok_post_id = ttResult.publishId;
          story.tiktok_error = null;
          result.tiktok = true;
          result.platform_outcomes.tiktok = "new_upload";
          console.log(`[publisher] TikTok: uploaded (browser)`);
          await db.upsertStory(story);
        } catch (browserErr) {
          console.log(
            `[publisher] TikTok browser also failed: ${browserErr.message}`,
          );
          story.tiktok_error = browserErr.message;
          result.errors.tiktok = browserErr.message;
          result.platform_outcomes.tiktok = "failed";
        }
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
    result.platform_outcomes.instagram = "already_published";
    console.log(
      `[publisher] Instagram: already published (${story.instagram_media_id})`,
    );
  } else if (igPrior && igPrior.status === "blocked") {
    result.instagram = true;
    result.platform_outcomes.instagram = "duplicate_blocked";
    console.log(
      `[publisher] Instagram: already blocked (${igPrior.block_reason || "unknown"})`,
    );
  } else if (igTitleDupe) {
    result.platform_outcomes.instagram = "duplicate_blocked";
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "instagram_reel",
      reason: `title-skip: ${igTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.instagram_media_id = "DUPE_SKIPPED";
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
      result.platform_outcomes.instagram = "new_upload";
      console.log(`[publisher] Instagram: uploaded`);
      await db.upsertStory(story);
    } catch (err) {
      console.log(`[publisher] Instagram upload failed: ${err.message}`);
      story.instagram_error = err.message;
      result.errors.instagram = err.message;
      result.platform_outcomes.instagram = "failed";
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
  // 2026-04-28: empirical evidence (Graph API probe via
  // tools/diagnostics/fb-page-content-probe.js) confirmed that
  // /{page_id}/videos and /{page_id}/video_reels both return ZERO
  // entries despite 3 publish summaries reporting FB Reel ✅
  // verified. Meta accepts the API request, returns happy-path
  // responses, then silently rejects the Reel before it reaches
  // any visible surface — a Page-eligibility gate for new pages.
  // This env flag lets the operator pause FB Reel attempts until
  // Meta enables Reels for the Page (default off until they prove
  // a Reel actually appears under /video_reels).
  const fbReelsEnabled = process.env.FACEBOOK_REELS_ENABLED === "true";
  if (story.facebook_post_id) {
    result.facebook = true;
    result.platform_outcomes.facebook = "already_published";
    console.log(
      `[publisher] Facebook: already published (${story.facebook_post_id})`,
    );
  } else if (!fbReelsEnabled) {
    result.facebook = true;
    result.platform_outcomes.facebook = "page_not_eligible";
    console.log(
      `[publisher] Facebook Reel: SKIPPED (FACEBOOK_REELS_ENABLED!=true) — ` +
        `Page reels-eligibility gate must clear before re-enabling. FB Card fallback continues.`,
    );
  } else if (fbPrior && fbPrior.status === "blocked") {
    result.facebook = true;
    result.platform_outcomes.facebook = "duplicate_blocked";
    console.log(
      `[publisher] Facebook: already blocked (${fbPrior.block_reason || "unknown"})`,
    );
  } else if (fbTitleDupe) {
    result.platform_outcomes.facebook = "duplicate_blocked";
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "facebook_reel",
      reason: `title-skip: ${fbTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.facebook_post_id = "DUPE_SKIPPED";
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
      // upload_facebook.js::uploadReel runs verifyReelPublished
      // (polls /video_reels status until video_status=ready AND
      // publishing_phase.status=published). A returned videoId
      // therefore means the Reel is actually live, not merely
      // accepted — promote to public_verified for Discord truth.
      result.platform_outcomes.facebook = "public_verified";
      console.log(`[publisher] Facebook: uploaded + verified live`);
      await db.upsertStory(story);
    } catch (err) {
      console.log(`[publisher] Facebook upload failed: ${err.message}`);
      story.facebook_error = err.message;
      result.errors.facebook = err.message;
      result.platform_outcomes.facebook = "failed";
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
    result.platform_outcomes.twitter = "already_published";
    console.log(
      `[publisher] Twitter: already published (${story.twitter_post_id})`,
    );
  } else if (twPrior && twPrior.status === "blocked") {
    result.twitter = true;
    result.platform_outcomes.twitter = "duplicate_blocked";
    console.log(
      `[publisher] Twitter: already blocked (${twPrior.block_reason || "unknown"})`,
    );
  } else if (twTitleDupe) {
    result.platform_outcomes.twitter = "duplicate_blocked";
    const blockResult = recordPlatformBlock({
      repos: pubRepos,
      storyId: story.id,
      platform: "twitter_video",
      reason: `title-skip: ${twTitleDupe.title}`,
      channelId: pubChannelId,
    });
    if (!blockResult.persisted) {
      story.twitter_post_id = "DUPE_SKIPPED";
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
      if (twResult && twResult.skipped) {
        result.skipped.twitter = twResult.reason || "skipped";
        result.platform_outcomes.twitter = "skipped";
        console.log(
          `[publisher] Twitter: skipped (${twResult.reason || "skipped"})`,
        );
      } else {
        story.twitter_post_id = twResult.tweetId;
        story.twitter_error = null;
        result.twitter = true;
        result.platform_outcomes.twitter = "new_upload";
        console.log(`[publisher] Twitter: uploaded`);
        await db.upsertStory(story);
      }
    } catch (err) {
      console.log(`[publisher] Twitter upload failed: ${err.message}`);
      story.twitter_error = err.message;
      result.errors.twitter = err.message;
      result.platform_outcomes.twitter = "failed";
    }
  }

  // --- Set publish_status from CORE video-platform outcomes only ---
  //
  // Task 4 (2026-04-21): story.publish_status counts only the four
  // core video platforms: YouTube, TikTok, Instagram Reel, Facebook
  // Reel. Twitter/X is OPTIONAL — its free API can't post video,
  // and the paid tier is expensive, so we gate it on
  // TWITTER_ENABLED=true and a skipped Twitter must never keep a
  // story in `partial` forever. Fallback cards (IG Story, FB Card,
  // X image) post on their own block below and never affect
  // publish_status either (they have materially lower reach than
  // Reels and should not dress a failed Reel as a success).
  //
  // A post id that starts with "DUPE_" is the legacy sentinel from
  // pre-2026-04-19 when the publisher wrote block-reason strings
  // into the *_post_id columns. Not a real publish; must not count
  // toward publish_status either.
  function isRealPostId(id) {
    return typeof id === "string" && id.length > 0 && !id.startsWith("DUPE_");
  }
  const coreIds = [
    story.youtube_post_id,
    story.tiktok_post_id,
    story.instagram_media_id,
    story.facebook_post_id,
  ];
  const coreDone = coreIds.filter(isRealPostId).length;
  const coreTotal = coreIds.length; // 4
  if (coreDone >= coreTotal) {
    story.publish_status = "published";
  } else if (coreDone > 0) {
    story.publish_status = "partial";
  } else {
    story.publish_status = "failed";
  }
  if (!story.published_at && coreDone > 0) {
    story.published_at = new Date().toISOString();
  }

  // --- Story card image distribution ---
  // Each platform is gated on its own post-id field so a partial failure
  // followed by a retry only re-tries the platforms that actually failed.
  // The old `!isRetry` guard checked only Reels IDs which meant that when
  // assemble.js cleared Reel IDs for a re-render, Stories got posted a
  // second time with no idempotency check. Individual-field gates fix that.
  if (story.story_image_path) {
    // Instagram Stories (static card, NOT a Reel — fallback post)
    if (story.instagram_story_id) {
      result.fallbacks.instagram_story = true;
      result.platform_outcomes.instagram_story = "already_published";
      console.log(
        `[publisher] Instagram Story: already posted (${story.instagram_story_id})`,
      );
    } else {
      try {
        const { uploadStoryImage: igStory } = require("./upload_instagram");
        const igStoryResult = await igStory(story);
        story.instagram_story_id = igStoryResult.mediaId;
        result.fallbacks.instagram_story = true;
        result.platform_outcomes.instagram_story = "new_upload";
        console.log(
          `[publisher] Instagram Story: uploaded (${igStoryResult.mediaId})`,
        );
      } catch (err) {
        console.log(
          `[publisher] Instagram Story upload failed: ${err.message}`,
        );
        result.errors.instagram_story = err.message;
        result.platform_outcomes.instagram_story = "failed";
      }
    }

    // Facebook Stories (static card, NOT a Reel — fallback post)
    if (story.facebook_story_id) {
      result.fallbacks.facebook_card = true;
      result.platform_outcomes.facebook_card = "already_published";
      console.log(
        `[publisher] Facebook Story: already posted (${story.facebook_story_id})`,
      );
    } else {
      try {
        const { uploadStoryImage: fbStory } = require("./upload_facebook");
        const fbStoryResult = await fbStory(story);
        story.facebook_story_id = fbStoryResult.storyId;
        result.fallbacks.facebook_card = true;
        result.platform_outcomes.facebook_card = "new_upload";
        console.log(
          `[publisher] Facebook Story: uploaded (${fbStoryResult.storyId})`,
        );
      } catch (err) {
        console.log(`[publisher] Facebook Story upload failed: ${err.message}`);
        result.errors.facebook_story = err.message;
        result.platform_outcomes.facebook_card = "failed";
      }
    }

    // Twitter/X image tweet
    if (story.twitter_image_tweet_id) {
      result.fallbacks.twitter_image = true;
      result.platform_outcomes.twitter_image = "already_published";
      console.log(
        `[publisher] Twitter image tweet: already posted (${story.twitter_image_tweet_id})`,
      );
    } else {
      try {
        const { postImageTweet } = require("./upload_twitter");
        const twImgResult = await postImageTweet(story);
        if (twImgResult && twImgResult.skipped) {
          result.skipped.twitter_image = twImgResult.reason || "skipped";
          result.platform_outcomes.twitter_image = "skipped";
          console.log(
            `[publisher] Twitter image tweet skipped (${twImgResult.reason || "skipped"})`,
          );
        } else {
          story.twitter_image_tweet_id = twImgResult.tweetId;
          result.fallbacks.twitter_image = true;
          result.platform_outcomes.twitter_image = "new_upload";
          console.log(
            `[publisher] Twitter image tweet: posted (${twImgResult.tweetId})`,
          );
        }
      } catch (err) {
        console.log(`[publisher] Twitter image tweet failed: ${err.message}`);
        result.errors.twitter_image = err.message;
        result.platform_outcomes.twitter_image = "failed";
      }
    }
  }

  // Schedule first-hour engagement pass (only on first successful YT publish)
  if (story.youtube_post_id && !isRetry) {
    // .unref() so this 5-minute timer doesn't keep the Node event
    // loop alive on its own — in production the Express server
    // keeps the process up, and under test we want the publisher
    // to return a Promise that actually settles the event loop.
    const t = setTimeout(
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
    if (t && typeof t.unref === "function") t.unref();
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
  selfHealStaleMediaPaths,
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
