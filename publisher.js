"use strict";

const dotenv = require("dotenv");
const {
  assertValidRuntimeConfig,
  loadDotenvOnce,
} = require("./lib/stabilisation/runtime-config");

loadDotenvOnce({ dotenv, env: process.env });
assertValidRuntimeConfig(process.env);

const fs = require("fs-extra");
const sendDiscord = require("./notify");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const db = require("./lib/db");
const { resolveFacebookReelsMode } = require("./lib/platforms/facebook-reels-mode");
const {
  isPublisherLeaseLostError,
  runWithPublisherLease,
} = require("./lib/services/publisher-lock");
const {
  resolveOperatingContract,
} = require("./lib/stabilisation/operating-contract");
const {
  YOUTUBE_PLATFORM_CONTRACT,
} = require("./lib/services/governed-publication-metadata");
const {
  ADMISSION_LATE_TOLERANCE_MS,
  ADMISSION_WINDOW_DRIFT_MS,
  validatePersistedOutsideCadenceAuthorisation,
} = require("./lib/services/publication-admission");
const {
  createYoutubeAuthTelemetry,
  normaliseYoutubeAuthTelemetry,
  sanitiseYoutubeError,
  sanitiseYoutubeErrorMessage,
} = require("./lib/services/youtube-safety");

// Publish lock - prevents concurrent publishNextStory() calls from creating duplicates
let publishLock = false;
const trustedYoutubeCreateBoundaryGates = new WeakSet();

function issueTrustedYoutubeCreateBoundaryGate(revalidate) {
  const gate = async function trustedYoutubeCreateBoundaryGate() {
    return revalidate();
  };
  trustedYoutubeCreateBoundaryGates.add(gate);
  return gate;
}

async function invokeTrustedYoutubeCreateBoundaryGate(gate) {
  if (
    typeof gate !== "function" ||
    !trustedYoutubeCreateBoundaryGates.has(gate)
  ) {
    throw publicationDispatchError(
      "youtube_create_boundary_guard_untrusted",
    );
  }
  return gate();
}

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
  Pulse v1 stabilisation publisher

  The governed automated scope is YouTube only, with two guarded UTC
  windows, human-reviewed scheduling evidence, a four-hour minimum gap
  and a hard maximum of two confirmed publications per rolling 24 hours.
  Secondary adapters remain for later controlled cutovers, but the
  stabilisation path returns before any of them can execute.
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
  const summary = runScoringPass({
    repos,
    humanReviewRequired: true,
  });
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

  const audio = require("./audio");
  const images = require("./images");
  const { generateEntityMentions } = require("./entities");

  // Commercial metadata remains frozen until the controlled audience
  // experiment proves intent. Affiliate generation is not a production stage.
  await audio();
  // Entity extraction runs between audio (needs word-level timestamps)
  // and the governed renderer, which consumes story.mentions to overlay
  // faces at spoken moments.
  await generateEntityMentions();
  await images();

  // Studio v2.1 is the sole standard renderer in the governed production
  // graph. Its candidate becomes the primary exported artefact under a
  // mandatory human-review hold. Any render, gauntlet or automatic-gate
  // failure aborts production; legacy assembly is migration-only and is
  // never a silent fallback.
  const {
    runStudioV21ReviewBatch,
  } = require("./lib/studio/v2/studio-v21-review-batch");
  const limit = Number(process.env.STUDIO_V21_BATCH_LIMIT || 5);
  const result = await runStudioV21ReviewBatch({
    db,
    limit,
    env: process.env,
  });
  console.log(
    `[publisher] Studio v2.1 governed batch complete: candidates=${result.candidates.length}, results=${result.results.length}`,
  );

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

  console.log("[publisher] Produce pipeline complete");
}

// Migration-only diagnostic retained for explicit operator tooling. It is not
// part of the governed produce graph because its legacy runtime recommendations
// conflict with the canonical Pulse editorial experiment matrix.
async function logFormatRecommendationsForApprovedStories() {
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) return;
  const { applyProduceSelection } = require("./lib/produce-selection");
  const targets = applyProduceSelection(
    stories.filter((s) => s.approved === true && s.exported_path),
    { stage: "format-catalogue", log: console.log },
  );
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
    const runtime = recommendRuntime(inv, { story });
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
  const { applyProduceSelection } = require("./lib/produce-selection");
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
  const selectedStories = applyProduceSelection(stories, {
    stage: "publisher:self-heal",
    log: console.log,
  });
  for (const s of selectedStories) {
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
async function _publishToAllPlatformsUnlocked(assertLeaseHealthy) {
  assertLeaseHealthy();
  return {
    youtube: [],
    tiktok: [],
    instagram: [],
    publish_dispatch_blocked: true,
    status: "blocked",
    top_reason:
      "legacy_batch_publish_disabled_use_durable_single_story_queue",
  };
}

// --- Compatibility entrypoint: hunt → review queue → governed production hold ---
async function publishToAllPlatforms(options = {}) {
  const leases =
    options.leases ||
    (typeof db.useSqlite === "function" && db.useSqlite()
      ? require("./lib/repositories").getRepos().runtimeLeases
      : null);
  const result = await runWithPublisherLease({
    leases,
    channelId: options.channelId || process.env.CHANNEL || "pulse-gaming",
    operation: "publish_batch",
    leaseMs: options.leaseMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    log: (message) => console.log(message),
    task: ({ assertHealthy }) =>
      _publishToAllPlatformsUnlocked(assertHealthy),
  });
  if (result?.publish_dispatch_blocked) {
    return {
      ...result,
      youtube: [],
      tiktok: [],
      instagram: [],
    };
  }
  return result;
}

async function fullAutonomousCycle() {
  const startTime = Date.now();
  console.log("[publisher] ========================================");
  console.log("[publisher] GOVERNED PREPARATION CYCLE STARTED");
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
        `**🔎 Pulse Gaming News hunt complete**\n${newPosts.length} new stories found`,
      );
    } else {
      console.log("[publisher] No new stories found");
    }

    // Step 2: Score candidates into the mandatory human-review queue.
    addBreadcrumb("Scoring stories for human review", "pipeline");
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
          const { getPublicUrl } = require("./lib/deployment-mode");
          const dashUrl = getPublicUrl();
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

    // Step 4: Stabilisation mode never dispatches. Production candidates
    // remain held until a named operator completes the governed review.
    const hold = {
      status: "held_for_human_review",
      reason: "stabilisation_human_review_required",
    };
    addBreadcrumb("Holding candidates for human review", "pipeline");
    console.log(
      `[publisher] Step 4/4: ${hold.status} (${hold.reason})`,
    );
    await sendDiscord(
      "**Pulse Gaming News preparation complete**\nCandidates are held for named human review. No upload was dispatched.",
    );

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[publisher] Governed preparation complete in ${elapsed}s`);
    return {
      ...hold,
      elapsed_seconds: elapsed,
      scoring: scoringSummary,
    };
  } catch (err) {
    captureException(err, { step: "fullAutonomousCycle" });
    console.log(`[publisher] CYCLE ERROR: ${err.message}`);
    await sendDiscord(
      `**Pulse Gaming News error**\nPreparation cycle failed: ${err.message}`,
    );
    return {
      status: "failed",
      reason: "preparation_cycle_error",
      error: err.message,
    };
  }
}

// --- Legacy publish-only entrypoint (hard-held during stabilisation) ---
async function publishOnlyCycle() {
  const hold = {
    status: "held_for_human_review",
    reason: "stabilisation_human_review_required",
  };
  console.log(
    `[publisher] Legacy publish-only cycle blocked: ${hold.reason}`,
  );
  await sendDiscord(
    "**Pulse Gaming News publish window held**\nA named human review and governed YouTube dispatch are required.",
  );
  return hold;
}

// --- Governed dispatch of a single reviewed YouTube candidate ---
// Secondary-platform adapters remain visible but frozen by the operating contract.
async function _publishNextStoryWithMemoryLock(
  assertLeaseHealthy,
  runtime = {},
) {
  // Prevent concurrent publish calls from uploading the same story twice
  if (publishLock) {
    console.log("[publisher] Publish already in progress, skipping");
    return null;
  }
  publishLock = true;

  try {
    assertLeaseHealthy();
    return await _publishNextStoryInner(assertLeaseHealthy, runtime);
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
async function publishNextStory(options = {}) {
  const runtimeEnv = options.env || process.env;
  const trustedClock = createTrustedPublisherClock(options, runtimeEnv);
  const operatingContract = resolveOperatingContract({
    env: runtimeEnv,
  });
  if (!operatingContract.live_mutation_allowed) {
    const topReason =
      operatingContract.blockers[0] || "live_guarded_mode_required";
    console.log(
      `[publisher] Live dispatch blocked by operating contract: ${topReason}`,
    );
    return {
      publish_dispatch_blocked: true,
      status: "blocked",
      top_reason: topReason,
      operating_mode: operatingContract.mode,
      blockers: operatingContract.blockers,
    };
  }
  let exactDispatchBinding;
  try {
    if (
      options.exactDispatchBinding === undefined ||
      options.exactDispatchBinding === null
    ) {
      throw publicationDispatchError(
        "guarded_exact_dispatch_binding_required",
      );
    }
    exactDispatchBinding = normaliseExactDispatchBinding(
      options.exactDispatchBinding,
    );
  } catch (error) {
    const topReason =
      error?.code ||
      error?.message ||
      "guarded_exact_dispatch_binding_invalid";
    console.log(
      `[publisher] Live dispatch blocked by exact authority: ${topReason}`,
    );
    return {
      publish_dispatch_blocked: true,
      status: "blocked",
      top_reason: topReason,
      operating_mode: operatingContract.mode,
    };
  }
  const resolvedRepos =
    options.repos ||
    (typeof db.useSqlite === "function" && db.useSqlite()
      ? require("./lib/repositories").getRepos()
      : null);
  const leases = options.leases || resolvedRepos?.runtimeLeases || null;
  return runWithPublisherLease({
    leases,
    channelId: options.channelId || process.env.CHANNEL || "pulse-gaming",
    operation: "publish_next_story",
    leaseMs: options.leaseMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    log: (message) => console.log(message),
    task: async ({ assertHealthy }) => {
      assertHealthy();
      if (!resolvedRepos?.db) {
        return {
          publish_dispatch_blocked: true,
          status: "blocked",
          top_reason: "publication_cadence_database_required",
        };
      }
      const cadenceEvaluator =
        options.cadenceEvaluator ||
        require("./lib/scheduler").evaluateStabilisationPublishCadence;
      const cadence = cadenceEvaluator({
        db: resolvedRepos.db,
        now: trustedClock(),
        excludeJobId: options.currentJobId || null,
      });
      if (!cadence?.allowed) {
        return {
          publish_dispatch_blocked: true,
          status: "blocked",
          top_reason:
            cadence?.reason || "stabilisation_publish_cadence_blocked",
          cadence,
        };
      }
      assertHealthy();
      return _publishNextStoryWithMemoryLock(assertHealthy, {
        ...options,
        exactDispatchBinding,
        env: runtimeEnv,
        repos: resolvedRepos,
        trustedClock,
      });
    },
  });
}

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

function isRealPlatformPostId(id) {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    !id.startsWith("DUPE_")
  );
}

function publicationDispatchError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createTrustedPublisherClock(options = {}, env = process.env) {
  const allowTestClock =
    String(env.NODE_ENV || "").trim().toLowerCase() === "test";
  const injected = allowTestClock ? options.now : null;
  return function trustedPublisherNow() {
    const value =
      typeof injected === "function"
        ? injected()
        : injected instanceof Date
          ? new Date(injected.getTime())
          : injected ?? new Date();
    const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(now.getTime())) {
      throw publicationDispatchError("scheduled_dispatch_clock_invalid");
    }
    return now;
  };
}

function normaliseExactDispatchBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw publicationDispatchError("guarded_exact_dispatch_binding_invalid");
  }
  const scheduled = new Date(value.scheduledFor);
  const binding = {
    storyId: String(value.storyId || "").trim(),
    platform: String(value.platform || "").trim(),
    scheduledFor: Number.isNaN(scheduled.getTime())
      ? ""
      : scheduled.toISOString(),
    scheduledEventId: String(value.scheduledEventId ?? "").trim(),
    dispatchIdempotencyKey: String(
      value.dispatchIdempotencyKey || "",
    ).trim(),
    requestFingerprint: String(value.requestFingerprint || "")
      .trim()
      .toLowerCase(),
    databaseDataVersion: Number(value.databaseDataVersion),
  };
  if (
    !binding.storyId ||
    binding.platform !== "youtube" ||
    !binding.scheduledFor ||
    !binding.scheduledEventId ||
    !binding.dispatchIdempotencyKey ||
    !/^[a-f0-9]{64}$/.test(binding.requestFingerprint) ||
    !Number.isSafeInteger(binding.databaseDataVersion) ||
    binding.databaseDataVersion < 1
  ) {
    throw publicationDispatchError("guarded_exact_dispatch_binding_invalid");
  }
  return Object.freeze(binding);
}

function readPublisherSqliteDataVersion(db) {
  if (!db || typeof db.pragma !== "function") {
    throw publicationDispatchError(
      "guarded_database_data_version_unavailable",
    );
  }
  let value;
  try {
    value = db.pragma("data_version", { simple: true });
  } catch {
    throw publicationDispatchError(
      "guarded_database_data_version_unavailable",
    );
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw publicationDispatchError(
      "guarded_database_data_version_invalid",
    );
  }
  return value;
}

function assertExactDatabaseDataVersion(
  db,
  binding,
  mismatchCode,
) {
  if (!binding) return;
  if (
    readPublisherSqliteDataVersion(db) !==
    binding.databaseDataVersion
  ) {
    throw publicationDispatchError(mismatchCode);
  }
}

function assertExactDispatchBinding(binding, storyId, scheduled) {
  if (!binding) return;
  const comparisons = [
    [
      String(storyId || "").trim(),
      binding.storyId,
      "guarded_exact_dispatch_story_mismatch",
    ],
    [
      "youtube",
      binding.platform,
      "guarded_exact_dispatch_platform_mismatch",
    ],
    [
      String(scheduled?.scheduledFor || "").trim(),
      binding.scheduledFor,
      "guarded_exact_dispatch_schedule_mismatch",
    ],
    [
      String(scheduled?.event?.id ?? "").trim(),
      binding.scheduledEventId,
      "guarded_exact_dispatch_event_mismatch",
    ],
    [
      String(scheduled?.idempotencyKey || "").trim(),
      binding.dispatchIdempotencyKey,
      "guarded_exact_dispatch_key_mismatch",
    ],
    [
      String(scheduled?.requestFingerprint || "")
        .trim()
        .toLowerCase(),
      binding.requestFingerprint,
      "guarded_exact_dispatch_fingerprint_mismatch",
    ],
  ];
  for (const [actual, expected, code] of comparisons) {
    if (actual !== expected) throw publicationDispatchError(code);
  }
}

function assertSameScheduledDispatchTicket(initial, current) {
  const comparisons = [
    [
      String(current?.scheduledFor || "").trim(),
      String(initial?.scheduledFor || "").trim(),
    ],
    [
      String(current?.event?.id ?? "").trim(),
      String(initial?.event?.id ?? "").trim(),
    ],
    [
      String(current?.idempotencyKey || "").trim(),
      String(initial?.idempotencyKey || "").trim(),
    ],
    [
      String(current?.requestFingerprint || "").trim().toLowerCase(),
      String(initial?.requestFingerprint || "").trim().toLowerCase(),
    ],
  ];
  if (comparisons.some(([actual, expected]) => actual !== expected)) {
    throw publicationDispatchError(
      "scheduled_dispatch_ticket_changed_before_create",
    );
  }
}

function readScheduledPublicationEvidence(evidence) {
  const publicationEvidence = evidence?.publication_evidence;
  if (
    !publicationEvidence ||
    typeof publicationEvidence !== "object" ||
    Array.isArray(publicationEvidence) ||
    publicationEvidence.schema_version !==
      "pulse-publication-evidence-v1"
  ) {
    throw publicationDispatchError(
      "scheduled_publication_evidence_required",
    );
  }
  for (const field of [
    "source_evidence_sha256",
    "qa_report_sha256",
    "rights_ledger_sha256",
    "renderer_manifest_sha256",
  ]) {
    if (
      !/^[a-f0-9]{64}$/i.test(
        String(publicationEvidence[field] || ""),
      )
    ) {
      throw publicationDispatchError(
        `scheduled_publication_${field}_required`,
      );
    }
  }
  const publicationMetadataSha = String(
    publicationEvidence.publication_metadata_sha256 || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(publicationMetadataSha)) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_sha256_required",
    );
  }
  const publicationMetadata = publicationEvidence.publication_metadata;
  if (
    !publicationMetadata ||
    typeof publicationMetadata !== "object" ||
    Array.isArray(publicationMetadata)
  ) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_required",
    );
  }
  const boundMetadataSha = String(
    publicationMetadata.sha256 || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(boundMetadataSha)) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_binding_sha256_required",
    );
  }
  if (boundMetadataSha !== publicationMetadataSha) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_sha256_mismatch",
    );
  }
  if (!String(publicationMetadata.path || "").trim()) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_path_required",
    );
  }
  if (
    String(publicationMetadata.platform || "").trim() !==
    YOUTUBE_PLATFORM_CONTRACT.reviewedMetadataPlatform
  ) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_platform_invalid",
    );
  }
  if (!String(publicationMetadata.title || "").trim()) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_title_required",
    );
  }
  if (!String(publicationMetadata.description || "").trim()) {
    throw publicationDispatchError(
      "scheduled_publication_metadata_description_required",
    );
  }
  const transformation =
    publicationEvidence.originality_transformation;
  if (
    !["STRONG", "ADEQUATE"].includes(
      String(transformation?.verdict || "").trim().toUpperCase(),
    ) ||
    !String(transformation?.rationale || "").trim() ||
    !String(transformation?.evidence_ref || "").trim() ||
    !/^[a-f0-9]{64}$/i.test(
      String(transformation?.evidence_sha256 || ""),
    )
  ) {
    throw publicationDispatchError(
      "scheduled_originality_transformation_evidence_required",
    );
  }
  const renderer = publicationEvidence.renderer;
  if (
    !String(renderer?.id || "").trim() ||
    !String(renderer?.role || "").trim() ||
    !String(renderer?.version || "").trim()
  ) {
    throw publicationDispatchError(
      "scheduled_renderer_identity_required",
    );
  }
  const disclosure =
    publicationEvidence.synthetic_media_disclosure;
  const disclosureDecision = String(disclosure?.decision || "")
    .trim()
    .toUpperCase();
  const reviewedAt = new Date(disclosure?.reviewed_at);
  const expectedYoutubeField =
    disclosureDecision === "DISCLOSE"
      ? true
      : disclosureDecision === "NO_DISCLOSURE_REQUIRED"
        ? false
        : null;
  if (
    typeof disclosure?.contains_synthetic_media !== "boolean" ||
    !["DISCLOSE", "NO_DISCLOSURE_REQUIRED"].includes(
      disclosureDecision,
    ) ||
    !String(disclosure?.rationale || "").trim() ||
    (disclosureDecision === "DISCLOSE" &&
      !String(disclosure?.disclosure_text || "").trim()) ||
    typeof disclosure?.youtube_field_value !== "boolean" ||
    disclosure.youtube_field_value !== expectedYoutubeField ||
    !disclosure?.reviewed_at ||
    Number.isNaN(reviewedAt.getTime()) ||
    (disclosure?.contains_synthetic_media === true &&
      disclosureDecision === "NO_DISCLOSURE_REQUIRED" &&
      !String(disclosure?.policy_basis || "").trim())
  ) {
    throw publicationDispatchError(
      "scheduled_synthetic_disclosure_decision_required",
    );
  }
  return publicationEvidence;
}

const SCHEDULED_DISPATCH_EARLY_TOLERANCE_MS = 60 * 1000;
const SCHEDULED_DISPATCH_LATE_TOLERANCE_MS = 15 * 60 * 1000;

function readScheduledDispatchEvidence(
  publicationGovernance,
  storyId,
  platform,
  at = new Date(),
  channelId = null,
) {
  if (
    !publicationGovernance ||
    typeof publicationGovernance.getLatestLifecycleEvent !== "function"
  ) {
    throw publicationDispatchError(
      "publication_governance_repository_required",
    );
  }
  const event = publicationGovernance.getLatestLifecycleEvent(
    storyId,
    platform,
    "SCHEDULED",
  );
  if (!event) {
    throw publicationDispatchError("scheduled_dispatch_evidence_required");
  }
  if (
    String(event.story_id || "").trim() !== String(storyId || "").trim() ||
    String(event.platform || "").trim() !== String(platform || "").trim()
  ) {
    throw publicationDispatchError(
      "scheduled_dispatch_event_identity_mismatch",
    );
  }
  let evidence;
  try {
    evidence =
      typeof event.evidence_json === "string"
        ? JSON.parse(event.evidence_json)
        : event.evidence;
  } catch {
    throw publicationDispatchError("scheduled_dispatch_evidence_invalid");
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw publicationDispatchError("scheduled_dispatch_evidence_invalid");
  }
  const idempotencyKey = String(
    evidence.dispatch_idempotency_key || "",
  ).trim();
  const requestFingerprint = String(
    evidence.request_fingerprint || "",
  ).trim();
  if (!idempotencyKey) {
    throw publicationDispatchError(
      "scheduled_dispatch_idempotency_key_required",
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(requestFingerprint)) {
    throw publicationDispatchError(
      "scheduled_dispatch_request_fingerprint_required",
    );
  }
  const publicationEvidence =
    readScheduledPublicationEvidence(evidence);
  const scheduledFor = new Date(evidence.scheduled_for);
  const effectiveNow =
    at instanceof Date
      ? new Date(at.getTime())
      : new Date(typeof at === "function" ? at() : at);
  if (
    !String(evidence.scheduled_for || "").trim() ||
    Number.isNaN(scheduledFor.getTime())
  ) {
    throw publicationDispatchError(
      "scheduled_dispatch_time_required",
    );
  }
  if (Number.isNaN(effectiveNow.getTime())) {
    throw publicationDispatchError("scheduled_dispatch_clock_invalid");
  }
  const normalCadence =
    [9, 19].includes(scheduledFor.getUTCHours()) &&
    scheduledFor.getUTCMinutes() === 0 &&
    scheduledFor.getUTCSeconds() === 0 &&
    scheduledFor.getUTCMilliseconds() === 0;
  if (!normalCadence) {
    if (
      scheduledFor.getUTCSeconds() !== 0 ||
      scheduledFor.getUTCMilliseconds() !== 0
    ) {
      throw publicationDispatchError(
        "scheduled_dispatch_guarded_window_required",
      );
    }
    const outsideCadenceBlockers =
      validatePersistedOutsideCadenceAuthorisation(
        evidence.outside_cadence_authorisation,
        {
          storyId,
          channelId,
          platform,
          scheduledFor: scheduledFor.toISOString(),
          authorisedNoEarlierThan: new Date(
            scheduledFor.getTime() - ADMISSION_WINDOW_DRIFT_MS,
          ).toISOString(),
          authorisedNoLaterThan: new Date(
            scheduledFor.getTime() + ADMISSION_LATE_TOLERANCE_MS,
          ).toISOString(),
          now: effectiveNow.toISOString(),
          dispatchIdempotencyKey: idempotencyKey,
          requestFingerprint,
        },
      );
    if (outsideCadenceBlockers.length) {
      throw publicationDispatchError(outsideCadenceBlockers[0]);
    }
  }
  const scheduleDeltaMs =
    effectiveNow.getTime() - scheduledFor.getTime();
  if (scheduleDeltaMs < -SCHEDULED_DISPATCH_EARLY_TOLERANCE_MS) {
    throw publicationDispatchError(
      "scheduled_dispatch_window_not_open",
    );
  }
  if (scheduleDeltaMs > SCHEDULED_DISPATCH_LATE_TOLERANCE_MS) {
    throw publicationDispatchError(
      "scheduled_dispatch_window_expired",
    );
  }
  return {
    event,
    evidence,
    idempotencyKey,
    requestFingerprint,
    publicationEvidence,
    scheduledFor: scheduledFor.toISOString(),
  };
}

function isGovernanceDispatchError(error) {
  const code = String(error?.code || error?.message || "");
  return (
    code === "platform_dispatch_reschedule_required" ||
    code.startsWith("scheduled_") ||
    code.startsWith("dispatch_requires_") ||
    code.startsWith("publication_governance_") ||
    code.startsWith("publication_dispatch_") ||
    code.startsWith("publication_fingerprint_") ||
    code.startsWith("governed_dispatch_") ||
    code.startsWith("guarded_database_")
  );
}

async function finaliseStabilisationYoutubeOnly(
  story,
  result,
  assertLeaseHealthy,
) {
  const secondary = [
    ["tiktok", "tiktok_post_id"],
    ["instagram", "instagram_media_id"],
    ["facebook", "facebook_post_id"],
    ["twitter", "twitter_post_id"],
    ["instagram_story", "instagram_story_id"],
    ["facebook_card", "facebook_story_id"],
    ["twitter_image", "twitter_image_tweet_id"],
  ];
  result.publish_scope = "stabilisation_youtube_only";
  for (const [outcomeKey, storyField] of secondary) {
    if (isRealPlatformPostId(story[storyField])) {
      result.platform_outcomes[outcomeKey] = "already_published";
    } else {
      result.platform_outcomes[outcomeKey] = "operator_disabled";
      result.skipped[outcomeKey] = "stabilisation_secondary_platform_freeze";
    }
  }

  if (isRealPlatformPostId(story.youtube_post_id)) {
    story.publish_status = "published";
    story.published_at =
      story.published_at || story.youtube_published_at || new Date().toISOString();
  } else if (result.platform_outcomes.youtube === "failed") {
    story.publish_status = "failed";
  } else {
    story.publish_status = "held";
  }

  assertLeaseHealthy();
  await db.upsertStory(story);
  assertLeaseHealthy();
  return result;
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
 * QA helpers throwing is a hard, persisted refusal. A missing safety
 * verdict is not evidence that the asset passed, so the story remains
 * held until an operator repairs the QA lane and reschedules it.
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
      `[publisher] content-qa unavailable for ${story.id}: ${qaErr.message}`,
    );
    captureException(qaErr, {
      step: "publishNextStory.content_qa",
      storyId: story.id,
    });
    return {
      pass: false,
      failures: ["content_qa_unavailable"],
      warnings: warnings.slice(),
      source: "content",
    };
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
      `[publisher] video-qa unavailable for ${story.id}: ${qaErr.message}`,
    );
    captureException(qaErr, {
      step: "publishNextStory.video_qa",
      storyId: story.id,
    });
    return {
      pass: false,
      failures: ["video_qa_unavailable"],
      warnings: warnings.slice(),
      source: "video",
    };
  }

  // Platform video QA — stream metadata that social APIs reject after upload.
  // This catches old yuv444p / High 4:4:4 renders, missing audio and non-vertical
  // MP4s before any platform receives the file.
  try {
    const { runPlatformVideoQa } = require("./lib/services/platform-video-qa");
    const pvqa = story.exported_path
      ? await runPlatformVideoQa(story.exported_path)
      : { result: "skip", reason: "no_exported_path" };
    if (pvqa.result === "warn" && Array.isArray(pvqa.warnings)) {
      console.log(
        `[publisher] platform video QA warnings (${story.id}): ${pvqa.warnings.join(", ")}`,
      );
      warnings.push(...pvqa.warnings);
    }
    if (pvqa.result === "fail") {
      console.log(
        `[publisher] platform video QA FAIL (${story.id}): ${pvqa.failures.join(", ")}`,
      );
      return {
        pass: false,
        failures: pvqa.failures,
        warnings: warnings.slice(),
        source: "platform_video",
      };
    }
    if (pvqa.result === "skip") {
      console.log(
        `[publisher] platform video QA skipped for ${story.id}: ${pvqa.reason || "unknown"}`,
      );
    }
  } catch (qaErr) {
    console.log(
      `[publisher] platform-video-qa unavailable for ${story.id}: ${qaErr.message}`,
    );
    captureException(qaErr, {
      step: "publishNextStory.platform_video_qa",
      storyId: story.id,
    });
    return {
      pass: false,
      failures: ["platform_video_qa_unavailable"],
      warnings: warnings.slice(),
      source: "platform_video",
    };
  }

  return { pass: true, warnings };
}

async function _publishNextStoryInner(
  assertLeaseHealthy,
  runtime = {},
) {
  const runtimeEnv = runtime.env || process.env;
  const sqliteOn = runtimeEnv.USE_SQLITE === "true";
  const requestedChannelId =
    runtime.channelId || runtimeEnv.CHANNEL || "pulse-gaming";
  const authenticatedChannelId =
    runtimeEnv.CHANNEL || "pulse-gaming";
  const trustedClock =
    typeof runtime.trustedClock === "function"
      ? runtime.trustedClock
      : createTrustedPublisherClock(runtime, runtimeEnv);
  const dispatchNow = trustedClock();
  const exactDispatchBinding = normaliseExactDispatchBinding(
    runtime.exactDispatchBinding,
  );
  if (requestedChannelId !== authenticatedChannelId) {
    return {
      publish_dispatch_blocked: true,
      status: "blocked",
      top_reason: "youtube_authenticated_channel_mismatch",
      requested_channel_id: requestedChannelId,
      authenticated_channel_id: authenticatedChannelId,
    };
  }
  let pubRepos = runtime.repos || null;
  if (sqliteOn && !pubRepos) {
    try {
      pubRepos = require("./lib/repositories").getRepos();
    } catch (err) {
      console.log(`[publisher] publish: repos unavailable: ${err.message}`);
    }
  }
  try {
    assertExactDatabaseDataVersion(
      pubRepos?.db,
      exactDispatchBinding,
      "guarded_database_data_version_changed_before_publisher_entry",
    );
  } catch (error) {
    return {
      publish_dispatch_blocked: true,
      status: "blocked",
      top_reason: error.code || error.message,
      story_id: exactDispatchBinding?.storyId || null,
    };
  }
  const stories = await db.getStories();
  assertLeaseHealthy();

  // Stabilisation has one automated public target: YouTube. A story that
  // already has a real YouTube ID must not consume another publish window
  // merely because a frozen secondary platform is still empty.
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
    const storyChannelId = s.channel_id || "pulse-gaming";
    if (storyChannelId !== requestedChannelId) return false;
    if (
      exactDispatchBinding &&
      s.id !== exactDispatchBinding.storyId
    ) {
      return false;
    }
    if (!s.approved || !s.exported_path) return false;
    if (s.qa_failed === true) return false;
    if (s.publish_status === "failed") return false;
    return !isRealPlatformPostId(s.youtube_post_id);
  });

  if (ready.length === 0) {
    console.log("[publisher] No stories need publishing");
    return exactDispatchBinding
      ? {
          publish_dispatch_blocked: true,
          status: "blocked",
          top_reason: "guarded_exact_story_not_ready",
          story_id: exactDispatchBinding.storyId,
        }
      : null;
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

  // A scheduled lifecycle event is the human-reviewed admission ticket for
  // this window. Filter before applying the QA cap so an arbitrary number of
  // unscheduled high-score stories cannot starve the approved candidate.
  const governanceSkipped = [];
  const scheduledCandidates = [];
  for (const candidate of ready) {
    try {
      const canonicalPost =
        typeof pubRepos?.platformPosts?.getByStoryPlatform === "function"
          ? pubRepos.platformPosts.getByStoryPlatform(
              candidate.id,
              "youtube",
            )
          : null;
      if (
        canonicalPost &&
        (canonicalPost.external_id ||
          ["blocked", "published", "pending", "uploading"].includes(
            canonicalPost.status,
          ))
      ) {
        throw publicationDispatchError(
          canonicalPost.external_id
            ? "canonical_platform_object_requires_reconciliation"
            : `canonical_platform_post_${canonicalPost.status}`,
        );
      }
      const scheduled = readScheduledDispatchEvidence(
          pubRepos?.publicationGovernance,
          candidate.id,
          "youtube",
          dispatchNow,
          candidate.channel_id || requestedChannelId,
        );
      assertExactDispatchBinding(
        exactDispatchBinding,
        candidate.id,
        scheduled,
      );
      scheduledCandidates.push({
        candidate,
        scheduled,
      });
    } catch (error) {
      governanceSkipped.push({
        id: candidate.id,
        title: candidate.title,
        reason: error.code || error.message,
      });
    }
  }

  if (scheduledCandidates.length === 0) {
    const top = governanceSkipped[0] || null;
    console.log(
      `[publisher] No governed YouTube candidate is scheduled (${governanceSkipped.length} held)`,
    );
    return {
      publish_dispatch_blocked: true,
      status: "blocked",
      top_reason: top?.reason || "no_scheduled_youtube_candidate",
      governance_skipped_count: governanceSkipped.length,
      governance_skipped: governanceSkipped,
    };
  }

  // Multi-candidate loop. We'll walk up to
  // MAX_PUBLISH_CANDIDATES_PER_WINDOW stories and take the first
  // one that passes preflight QA. Each QA-failing candidate is
  // persisted so it's skipped in all future windows too.
  const candidates = scheduledCandidates.slice(
    0,
    MAX_PUBLISH_CANDIDATES_PER_WINDOW,
  );
  const qaSkipped = []; // structured {id, title, reason, source, failures}
  let story = null;
  let scheduledDispatch = null;
  let isRetry = false;
  let preflightWarnings = [];

  for (let i = 0; i < candidates.length; i++) {
    const { candidate, scheduled } = candidates[i];
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
      scheduledDispatch = scheduled;
      isRetry = true;
      break;
    }

    const qa = await runPreflightQa(candidate);
    assertLeaseHealthy();
    if (qa.pass) {
      story = candidate;
      scheduledDispatch = scheduled;
      isRetry = false;
      preflightWarnings = qa.warnings || [];
      break;
    }

    // Hard-fail: persist and continue.
    assertLeaseHealthy();
    const skipped = await persistQaFail(candidate, {
      failures: qa.failures,
      warnings: qa.warnings,
      source: qa.source,
    });
    assertLeaseHealthy();
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

  let youtubeAuthTelemetry = createYoutubeAuthTelemetry();
  const result = {
    title: story.title,
    story_id: story.id,
    dispatch_idempotency_key: scheduledDispatch?.idempotencyKey || null,
    request_fingerprint: scheduledDispatch?.requestFingerprint || null,
    // --- Render-quality metadata for Discord summary (audit P1) ---
    // Exposes the assemble.js-stamped fields so the operator sees per-
    // publish render quality without diving into the DB. Falls back
    // to "(unstamped)" for stories that pre-date 2026-04-29.
    render_lane: story.render_lane || null,
    render_quality_class: story.render_quality_class || null,
    distinct_visual_count:
      typeof story.distinct_visual_count === "number"
        ? story.distinct_visual_count
        : typeof story.qa_visual_count === "number"
          ? story.qa_visual_count
          : null,
    outro_present:
      typeof story.outro_present === "boolean" ? story.outro_present : null,
    // 2026-04-30: forensic stamp captured by assemble.js when the
    // multi-image render graph errored out and the renderer dropped
    // to single-image fallback. Surfaces in Discord summary so the
    // operator can see WHY a render fell back, not just that it did.
    render_fallback_reason: story.render_fallback_reason || null,
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
    safety: {
      youtube_auth: youtubeAuthTelemetry,
    },
  };
  const reportYoutubeAuthTelemetry = (value) => {
    youtubeAuthTelemetry = normaliseYoutubeAuthTelemetry(value);
    result.safety.youtube_auth = youtubeAuthTelemetry;
    if (typeof runtime.onYoutubeAuthTelemetry === "function") {
      runtime.onYoutubeAuthTelemetry(youtubeAuthTelemetry);
    }
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
  const pubChannelId =
    requestedChannelId;

  // 2026-04-30 audit P0 #2: Render contract evaluation.
  // Compute the per-story contract verdict (premium/standard/fallback/
  // reject) before kicking off any platform uploads. The verdict is
  // stamped on the result so Discord summary, control room, and
  // analytics all see the same truth.
  //
  // Hard reject (no MP4, no script, topicality reject, zero visuals,
  // title hygiene fail) → refuse this window, mark skipped, emit a
  // Discord summary with the reject reason. Stays additive — produce
  // is unchanged.
  //
  // Below-floor (fallback when CONTRACT_FLOOR=standard, or anything
  // below "premium" when CONTRACT_FLOOR=premium) → only blocked when
  // BLOCK_BELOW_CONTRACT=true. Default-OFF, exactly the same release-
  // valve pattern the audit suggested for BLOCK_THIN_VISUALS.
  try {
    const renderDecision = require("./lib/render-decision");
    const decision = await renderDecision.decideForStory(story);
    assertLeaseHealthy();
    result.render_contract = decision.verdict;
    result.render_contract_gate = decision.gate;
    if (!decision.gate.allowed) {
      console.log(
        `[publisher] Render contract gate refused: ${decision.gate.reason}. ` +
          `class=${decision.verdict.class}, missing=${(decision.verdict.missing || []).join(",")}, ` +
          `reasons=${(decision.verdict.reasons || []).join(",")}`,
      );
      result.platform_outcomes = result.platform_outcomes || {};
      result.skipped = result.skipped || {};
      result.platform_outcomes.youtube = "governance_blocked";
      result.skipped.youtube = `contract_gate:${decision.verdict.class}`;
      result.errors.contract = decision.gate.reason;
      // Persist the verdict on the story so subsequent passes see it.
      try {
        assertLeaseHealthy();
        story.render_contract_class = decision.verdict.class;
        story.render_contract_blocked = true;
        await db.upsertStory(story);
        assertLeaseHealthy();
      } catch (err) {
        if (isPublisherLeaseLostError(err)) throw err;
        console.log(
          `[publisher] contract upsert failed (non-fatal): ${err.message}`,
        );
      }
      return finaliseStabilisationYoutubeOnly(
        story,
        result,
        assertLeaseHealthy,
      );
    }
    // Allowed — still stamp the class on the story for analytics.
    // Keep the accepted verdict in memory until final outcome persistence.
    // A write here through lib/db's singleton uses a different SQLite
    // connection from the guard-bound repository and would make our own
    // legitimate commit look like an external data_version race.
    story.render_contract_class = decision.verdict.class;
    story.render_contract_blocked = false;
  } catch (err) {
    if (isPublisherLeaseLostError(err)) throw err;
    console.log(
      `[publisher] render contract evaluation unavailable: ${err.message}`,
    );
    captureException(err, {
      step: "publishNextStory.render_contract",
      storyId: story.id,
    });
    result.platform_outcomes.youtube = "governance_blocked";
    result.skipped.youtube = "render_contract_evaluation_unavailable";
    result.errors.contract = "render_contract_evaluation_unavailable";
    story.render_contract_blocked = true;
    return finaliseStabilisationYoutubeOnly(
      story,
      result,
      assertLeaseHealthy,
    );
  }

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
  } else {
    assertLeaseHealthy();
    try {
      if (!pubRepos?.db || !pubRepos?.platformPosts) {
        throw publicationDispatchError(
          "publication_dispatch_repositories_required",
        );
      }
      const scheduled =
        scheduledDispatch ||
        readScheduledDispatchEvidence(
          pubRepos.publicationGovernance,
          story.id,
          "youtube",
          dispatchNow,
          pubChannelId,
        );
      assertExactDispatchBinding(
        exactDispatchBinding,
        story.id,
        scheduled,
      );
      const governedDispatch =
        runtime.governedDispatch ||
        require("./lib/services/governed-platform-dispatch")
          .dispatchGovernedPlatform;
      const verifyYoutubePublic =
        runtime.verifyYoutubePublic ||
        require("./lib/services/youtube-public-object-verifier")
          .createYoutubePublicObjectVerifier({
            apiKey: runtimeEnv.YOUTUBE_API_KEY,
          });
      const fingerprintPublicationRequest =
        runtime.fingerprintPublicationRequest ||
        require("./lib/services/publication-request-fingerprint")
          .fingerprintPublicationRequest;
      const currentFingerprint = await fingerprintPublicationRequest(
        story,
        {
          channelId: pubChannelId,
          platform: "youtube",
          resolveMediaPath:
            runtime.resolveMediaPath ||
            require("./lib/media-paths").resolveExisting,
          channel:
            runtime.channel ||
            require("./channels").getChannel(pubChannelId),
          publicationEvidence: scheduled.publicationEvidence,
        },
      );
      if (
        currentFingerprint.request_fingerprint !==
        scheduled.requestFingerprint
      ) {
        throw publicationDispatchError(
          "scheduled_request_fingerprint_mismatch",
        );
      }
      const { uploadShort } = require("./upload_youtube");
      const uploadStory = {
        ...story,
        synthetic_media_disclosure:
          scheduled.publicationEvidence.synthetic_media_disclosure,
        governed_publication_metadata_sha256:
          scheduled.publicationEvidence.publication_metadata_sha256,
        governed_publication_metadata:
          scheduled.publicationEvidence.publication_metadata,
      };
      const dispatchResult = await governedDispatch({
        db: pubRepos.db,
        platformPosts: pubRepos.platformPosts,
        governance: pubRepos.publicationGovernance,
        storyId: story.id,
        channelId: pubChannelId,
        platform: "youtube",
        idempotencyKey: scheduled.idempotencyKey,
        requestFingerprint: currentFingerprint.request_fingerprint,
        dispatchEvidence: {
          ...scheduled.evidence,
          scheduled_lifecycle_event_id: scheduled.event.id || null,
          current_media_sha256: currentFingerprint.media_sha256,
          current_script_sha256: currentFingerprint.script_sha256,
          current_request_fingerprint:
            currentFingerprint.request_fingerprint,
        },
        actorId: runtime.actorId || null,
        assertLeaseHealthy,
        upload: async ({ markCreateAttemptStarted }) => {
          if (ytTitleDupe) {
            return {
              blocked: true,
              reason: `title-skip: ${ytTitleDupe.title}`,
            };
          }
          const assertYoutubeCreateBoundary =
            issueTrustedYoutubeCreateBoundaryGate(async () => {
              assertLeaseHealthy();
              const currentScheduled = readScheduledDispatchEvidence(
                pubRepos.publicationGovernance,
                story.id,
                "youtube",
                trustedClock(),
                pubChannelId,
              );
              assertSameScheduledDispatchTicket(
                scheduled,
                currentScheduled,
              );
              assertExactDispatchBinding(
                exactDispatchBinding,
                story.id,
                currentScheduled,
              );
              assertExactDatabaseDataVersion(
                pubRepos.db,
                exactDispatchBinding,
                "guarded_database_data_version_changed_before_create",
              );
              assertLeaseHealthy();
            });
          const ytResult = await uploadShort(uploadStory, {
            governedDispatch: true,
            markCreateAttemptStarted,
            assertYoutubeCreateBoundary,
            reportAuthTelemetry: reportYoutubeAuthTelemetry,
            expectedMediaSha256: currentFingerprint.media_sha256,
          });
          if (ytResult?.blocked) {
            return {
              blocked: true,
              reason: ytResult.reason || "blocked",
            };
          }
          return {
            externalId: ytResult?.videoId,
            externalUrl: ytResult?.url,
          };
        },
        verifyPublic: async (input) => {
          try {
            return await verifyYoutubePublic(input);
          } catch (error) {
            throw sanitiseYoutubeError(error, runtimeEnv);
          }
        },
      });
      assertLeaseHealthy();
      if (dispatchResult?.status === "blocked") {
        console.log(
          `[publisher] YouTube: BLOCKED - ${dispatchResult.reason || "blocked"}`,
        );
        result.youtube = false;
        result.platform_outcomes.youtube = "duplicate_blocked";
        result.errors.youtube =
          `dupe-blocked: ${dispatchResult.reason || "blocked"}`;
      } else if (
        dispatchResult?.status === "published" &&
        dispatchResult.externalId
      ) {
        assertLeaseHealthy();
        story.youtube_post_id = dispatchResult.externalId;
        story.youtube_url = dispatchResult.externalUrl;
        story.youtube_published_at =
          dispatchResult.verification?.verifiedAt ||
          new Date().toISOString();
        console.log(`[publisher] YouTube: ${dispatchResult.externalUrl}`);
        result.youtube = true;
        result.platform_outcomes.youtube = "new_upload";
      } else {
        throw publicationDispatchError(
          "governed_dispatch_published_evidence_required",
        );
      }

      if (story.title_variants && story.title_variants.length > 1) {
        story.title_check_at = Date.now() + 2 * 60 * 60 * 1000;
      }
    } catch (err) {
      if (isPublisherLeaseLostError(err)) throw err;
      err = sanitiseYoutubeError(err, runtimeEnv);
      const governanceState =
        typeof pubRepos?.publicationGovernance?.getState === "function"
          ? pubRepos.publicationGovernance.getState(story.id, "youtube")
          : null;
      const requiresReconciliation =
        err?.code === "platform_dispatch_reconciliation_required" ||
        governanceState?.lifecycle_state === "RECONCILIATION_REQUIRED" ||
        governanceState?.verification_status === "requires_reconciliation";
      if (requiresReconciliation) {
        console.log(
          `[publisher] YouTube dispatch requires reconciliation: ${sanitiseYoutubeErrorMessage(err.message, runtimeEnv)}`,
        );
        story.youtube_error = err.message;
        result.errors.youtube = err.message;
        result.platform_outcomes.youtube = "reconciliation_required";
      } else if (isGovernanceDispatchError(err)) {
        console.log(
          `[publisher] YouTube dispatch blocked by governance: ${sanitiseYoutubeErrorMessage(err.message, runtimeEnv)}`,
        );
        result.errors.youtube = err.message;
        result.platform_outcomes.youtube = "governance_blocked";
      } else {
        console.log(
          `[publisher] YouTube upload failed: ${sanitiseYoutubeErrorMessage(err.message, runtimeEnv)}`,
        );
        story.youtube_error = err.message;
        result.errors.youtube = err.message;
        result.platform_outcomes.youtube = "failed";
      }
    }
  }

  // Pulse v1 stabilisation deliberately has one automated public target:
  // YouTube. Secondary adapters remain visible in the result, but are
  // frozen so the controlled experiment produces interpretable analytics
  // and no hidden fallback can create a second public object.
  return finaliseStabilisationYoutubeOnly(
    story,
    result,
    assertLeaseHealthy,
  );

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
    assertLeaseHealthy();
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
    assertLeaseHealthy();
    await db.upsertStory(story);
  } else {
    assertLeaseHealthy();
    try {
      const { uploadShort: ttUpload } = require("./upload_tiktok");
      const ttResult = await ttUpload(story);
      assertLeaseHealthy();
      story.tiktok_post_id = ttResult.publishId;
      story.tiktok_error = null;
      result.tiktok = true;
      result.platform_outcomes.tiktok = "new_upload";
      console.log(`[publisher] TikTok: uploaded (API)`);
      assertLeaseHealthy();
      await db.upsertStory(story);
    } catch (err) {
      if (isPublisherLeaseLostError(err)) throw err;
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
          assertLeaseHealthy();
          const captionTitle =
            story.suggested_title ||
            story.suggested_thumbnail_text ||
            story.title;
          const tags = (story.suggested_hashtags || []).concat([
            "#Shorts",
            "#fyp",
            "#viral",
          ]);
          assertLeaseHealthy();
          const bufferResult = await publishToTiktokViaBuffer({
            videoPath: exportedAbs,
            caption: String(captionTitle || "").slice(0, 1500),
            hashtags: tags,
          });
          assertLeaseHealthy();
          if (bufferResult.ok) {
            story.tiktok_post_id = `buffer:${bufferResult.updateId}`;
            story.tiktok_error = null;
            result.tiktok = true;
            result.platform_outcomes.tiktok = "new_upload_via_buffer";
            console.log(
              `[publisher] TikTok: queued via Buffer update ${bufferResult.updateId}`,
            );
            assertLeaseHealthy();
            await db.upsertStory(story);
            // Buffer succeeded — skip browser fallback entirely.
            return result;
          }
          console.log(
            `[publisher] Buffer not viable: ${bufferResult.reason}${bufferResult.note ? " — " + bufferResult.note : ""}`,
          );
        }
      } catch (bufferErr) {
        if (isPublisherLeaseLostError(bufferErr)) throw bufferErr;
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
        assertLeaseHealthy();
        try {
          const {
            uploadShort: ttBrowserUpload,
          } = require("./upload_tiktok_browser");
          const ttResult = await ttBrowserUpload(story);
          assertLeaseHealthy();
          story.tiktok_post_id = ttResult.publishId;
          story.tiktok_error = null;
          result.tiktok = true;
          result.platform_outcomes.tiktok = "new_upload";
          console.log(`[publisher] TikTok: uploaded (browser)`);
          assertLeaseHealthy();
          await db.upsertStory(story);
        } catch (browserErr) {
          if (isPublisherLeaseLostError(browserErr)) throw browserErr;
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
    assertLeaseHealthy();
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
    assertLeaseHealthy();
    await db.upsertStory(story);
  } else {
    assertLeaseHealthy();
    try {
      const {
        uploadShort: igUpload,
        uploadReelViaUrl: igUrlUpload,
        isInstagramPendingProcessingTimeout,
        shouldAttemptInstagramUrlFallback,
      } = require("./upload_instagram");
      let igResult;
      try {
        assertLeaseHealthy();
        igResult = await igUpload(story);
        assertLeaseHealthy();
      } catch (reelErr) {
        if (isPublisherLeaseLostError(reelErr)) throw reelErr;
        assertLeaseHealthy();
        if (isInstagramPendingProcessingTimeout(reelErr)) {
          console.log(
            `[publisher] Instagram Reel still processing after local wait: ${reelErr.message}. ` +
              "Not starting URL fallback; schedule/read-only verify later.",
          );
          story.instagram_error = reelErr.message;
          result.errors.instagram = reelErr.message;
          result.platform_outcomes.instagram = "accepted_processing";
          assertLeaseHealthy();
          await db.upsertStory(story);
          igResult = null;
        } else {
          if (!shouldAttemptInstagramUrlFallback(reelErr)) {
            throw reelErr;
          }
          console.log(
            `[publisher] Instagram binary upload transport failed: ${reelErr.message}, trying URL fallback...`,
          );
          assertLeaseHealthy();
          try {
            igResult = await igUrlUpload(story);
            assertLeaseHealthy();
          } catch (urlErr) {
            if (isPublisherLeaseLostError(urlErr)) throw urlErr;
            assertLeaseHealthy();
            if (isInstagramPendingProcessingTimeout(urlErr)) {
              console.log(
                `[publisher] Instagram URL Reel still processing after local wait: ${urlErr.message}. ` +
                  "Not retrying; schedule/read-only verify later.",
              );
              story.instagram_error = urlErr.message;
              result.errors.instagram = urlErr.message;
              result.platform_outcomes.instagram = "accepted_processing";
              assertLeaseHealthy();
              await db.upsertStory(story);
              igResult = null;
            } else {
              throw urlErr;
            }
          }
        }
      }
      if (igResult) {
        assertLeaseHealthy();
        story.instagram_media_id = igResult.mediaId;
        story.instagram_error = null;
        result.instagram = true;
        result.platform_outcomes.instagram = "new_upload";
        console.log(`[publisher] Instagram: uploaded`);
        assertLeaseHealthy();
        await db.upsertStory(story);
      }
    } catch (err) {
      if (isPublisherLeaseLostError(err)) throw err;
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
  // This env flag lets the operator pause FB Reel attempts if Meta
  // regresses the Page surface. 2026-05-02 API proof showed that
  // Reels can publish when the finish phase uses video_state=PUBLISHED,
  // but we keep the explicit switch so FB Card fallback remains safe.
  const fbReelsMode = resolveFacebookReelsMode(process.env);
  const fbReelsEnabled = fbReelsMode.enabled;
  if (story.facebook_post_id) {
    result.facebook = true;
    result.platform_outcomes.facebook = "already_published";
    console.log(
      `[publisher] Facebook: already published (${story.facebook_post_id})`,
    );
  } else if (!fbReelsEnabled) {
    result.facebook = true;
    result.platform_outcomes.facebook = "operator_disabled";
    console.log(
      `[publisher] Facebook Reel: SKIPPED (${fbReelsMode.reason}) — ` +
        `FB Card fallback continues.`,
    );
  } else if (fbPrior && fbPrior.status === "blocked") {
    result.facebook = true;
    result.platform_outcomes.facebook = "duplicate_blocked";
    console.log(
      `[publisher] Facebook: already blocked (${fbPrior.block_reason || "unknown"})`,
    );
  } else if (fbTitleDupe) {
    result.platform_outcomes.facebook = "duplicate_blocked";
    assertLeaseHealthy();
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
    assertLeaseHealthy();
    await db.upsertStory(story);
  } else {
    assertLeaseHealthy();
    try {
      const {
        uploadShort: fbUpload,
        uploadReelViaUrl,
      } = require("./upload_facebook");
      let fbResult;
      try {
        assertLeaseHealthy();
        fbResult = await fbUpload(story);
        assertLeaseHealthy();
      } catch (reelErr) {
        if (isPublisherLeaseLostError(reelErr)) throw reelErr;
        assertLeaseHealthy();
        console.log(
          `[publisher] Facebook Reel binary upload failed: ${reelErr.message}, trying URL fallback...`,
        );
        assertLeaseHealthy();
        fbResult = await uploadReelViaUrl(story);
        assertLeaseHealthy();
      }
      assertLeaseHealthy();
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
      assertLeaseHealthy();
      await db.upsertStory(story);
    } catch (err) {
      if (isPublisherLeaseLostError(err)) throw err;
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
    assertLeaseHealthy();
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
    assertLeaseHealthy();
    await db.upsertStory(story);
  } else {
    assertLeaseHealthy();
    try {
      const { uploadShort: twUpload } = require("./upload_twitter");
      const twResult = await twUpload(story);
      assertLeaseHealthy();
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
        assertLeaseHealthy();
        await db.upsertStory(story);
      }
    } catch (err) {
      if (isPublisherLeaseLostError(err)) throw err;
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
      assertLeaseHealthy();
      try {
        const {
          uploadStoryImage: igStory,
          isInstagramPendingProcessingTimeout,
        } = require("./upload_instagram");
        const igStoryResult = await igStory(story);
        assertLeaseHealthy();
        story.instagram_story_id = igStoryResult.mediaId;
        result.fallbacks.instagram_story = true;
        result.platform_outcomes.instagram_story = "new_upload";
        console.log(
          `[publisher] Instagram Story: uploaded (${igStoryResult.mediaId})`,
        );
      } catch (err) {
        if (isPublisherLeaseLostError(err)) throw err;
        console.log(
          `[publisher] Instagram Story upload failed: ${err.message}`,
        );
        result.errors.instagram_story = err.message;
        result.platform_outcomes.instagram_story =
          isInstagramPendingProcessingTimeout(err)
            ? "accepted_processing"
            : "failed";
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
      assertLeaseHealthy();
      try {
        const { uploadStoryImage: fbStory } = require("./upload_facebook");
        const fbStoryResult = await fbStory(story);
        assertLeaseHealthy();
        story.facebook_story_id = fbStoryResult.storyId;
        result.fallbacks.facebook_card = true;
        result.platform_outcomes.facebook_card = "new_upload";
        console.log(
          `[publisher] Facebook Story: uploaded (${fbStoryResult.storyId})`,
        );
      } catch (err) {
        if (isPublisherLeaseLostError(err)) throw err;
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
      assertLeaseHealthy();
      try {
        const { postImageTweet } = require("./upload_twitter");
        const twImgResult = await postImageTweet(story);
        assertLeaseHealthy();
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
        if (isPublisherLeaseLostError(err)) throw err;
        console.log(`[publisher] Twitter image tweet failed: ${err.message}`);
        result.errors.twitter_image = err.message;
        result.platform_outcomes.twitter_image = "failed";
      }
    }
  }

  // First-hour engagement is handled by the separately leased
  // engage_first_hour_sweep scheduler job. A detached timer here would
  // outlive this publisher lease and could duplicate work after takeover.

  // Post to Discord channels, video drops only (news already posted by processor.js).
  //
  // Migration 012 replaces the old `!isRetry` derived-state guard with
  // durable per-story markers so a re-render that clears platform ids
  // cannot re-trigger #video-drops or #polls.
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
      assertLeaseHealthy();
      const msg = await postVideoUpload(story);
      assertLeaseHealthy();
      if (msg) {
        markVideoDropPosted(story);
        postedVideoDropNow = true;
      }
    }

    let postedPollNow = false;
    if (shouldPostStoryPoll(story)) {
      assertLeaseHealthy();
      const pollMsg = await postStoryPoll(story);
      assertLeaseHealthy();
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
    if (isPublisherLeaseLostError(err)) throw err;
    console.log(`[publisher] Discord post skipped: ${err.message}`);
  }

  // Save updated story (upsert to avoid wiping other stories)
  try {
    assertLeaseHealthy();
    await db.upsertStory(story);
    assertLeaseHealthy();
  } catch (err) {
    if (isPublisherLeaseLostError(err)) throw err;
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
  invokeTrustedYoutubeCreateBoundaryGate,
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
