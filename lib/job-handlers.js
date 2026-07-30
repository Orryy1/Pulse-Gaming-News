/**
 * lib/job-handlers.js — the kind → function map consumed by JobsRunner.
 *
 * Each handler is an async (job, ctx) => any. The whole point of the
 * Phase 3 refactor is that the actual business logic stays where it
 * already lives (publisher.js, hunter.js, engagement.js, ...) — we
 * just adapt them to the job-row signature here.
 *
 * Handlers MUST:
 *   - Be idempotent with respect to the idempotency_key where possible
 *     (the jobs table already dedupes on that key, but external side
 *     effects like "upload to YouTube" need their own idempotency —
 *     platform_posts rows + tokens/*.json are the authoritative guard).
 *   - Throw on failure. The runner converts throws to
 *     jobs.fail(), which triggers backoff + retry.
 *   - Return a small JSON-serialisable result on success (stored in
 *     job_runs.log_excerpt for observability).
 *
 * A handler that wants to fan out multiple child jobs should do so via
 * ctx.repos.jobs.enqueue(...) before returning.
 */

const path = require("path");
const fs = require("fs-extra");
const crypto = require("node:crypto");

const DATA_FILE = path.join(__dirname, "..", "daily_news.json");

function lazy(modulePath, exportName) {
  // Defer the require until the handler actually runs. Keeps jobs-runner
  // cold-start fast and avoids pulling in ffmpeg/anthropic clients for
  // kinds we never see in this process.
  return async (...args) => {
    const mod = require(modulePath);
    const fn = exportName ? mod[exportName] : mod;
    if (typeof fn !== "function") {
      throw new Error(
        `handler ${modulePath}::${exportName || "default"} is not a function`,
      );
    }
    return fn(...args);
  };
}

function resolveJobEditorialClient(ctx = {}) {
  const {
    resolveEditorialMessagesClient,
  } = require("./services/governed-editorial-client");
  const injectedClient =
    ctx.editorialMessagesClient ||
    ctx.editorialClient ||
    ctx.anthropicClient ||
    null;
  const injectedProvider =
    !ctx.editorialMessagesClient &&
    !ctx.editorialClient &&
    ctx.anthropicClient
      ? "anthropic"
      : "";
  return resolveEditorialMessagesClient({
    env: process.env,
    injectedClient,
    injectedProvider,
  });
}

function editorialInventoryStoryFromCanonical(
  story = {},
  payload = {},
) {
  const extra = parseStoryExtra(story);
  const primarySourceUrl = String(
    payload.primary_source_url ||
      extra.primary_source_url ||
      story.primary_source_url ||
      story.article_url ||
      story.url ||
      "",
  ).trim();
  let host = "";
  try {
    host = new URL(primarySourceUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const platformFamily =
    host === "news.xbox.com" || host.endsWith(".xbox.com")
      ? { platform: "Xbox Series X|S", franchise: "Xbox" }
      : host === "blog.playstation.com" ||
          host.endsWith(".playstation.com")
        ? { platform: "PlayStation 5", franchise: "PlayStation" }
        : host.endsWith(".nintendo.com")
          ? {
              platform: "Nintendo Switch",
              franchise: "Nintendo",
            }
          : host === "store.steampowered.com"
            ? { platform: "PC", franchise: "PC Gaming" }
            : {};
  const subjectIds = Array.isArray(story.subject_ids)
    ? story.subject_ids
    : Array.isArray(extra.subject_ids)
      ? extra.subject_ids
      : [];
  return {
    id: String(story.id || payload.breaking_story_id || "").trim(),
    title: String(story.title || payload.title || "").trim(),
    franchise: String(
      story.franchise ||
        story.game_name ||
        story.game_title ||
        extra.franchise ||
        extra.game_name ||
        extra.game_title ||
        extra.evergreen_pitch?.franchise ||
        platformFamily.franchise ||
        "",
    ).trim(),
    platform: String(
      story.platform ||
        extra.platform ||
        extra.target_platform ||
        platformFamily.platform ||
        "",
    ).trim(),
    topic_key: String(
      story.topic_key ||
        extra.topic_key ||
        subjectIds[0] ||
        "",
    ).trim(),
    published_at:
      story.published_at ||
      story.timestamp ||
      story.created_at ||
      payload.generated_at ||
      new Date().toISOString(),
    primary_source_url: primarySourceUrl,
    verification_status: String(
      payload.verification_status ||
        extra.verification_status ||
        story.verification_status ||
        "",
    )
      .trim()
      .toUpperCase(),
    subject_ids: subjectIds,
  };
}

async function handleHunt(job, ctx) {
  const hunter = ctx.hunter || lazy("../hunter");
  const autoApprove =
    ctx.autoApprove || require("../publisher").autoApprove;
  const processStories = ctx.processStories || require("../processor");
  ctx.assertLeaseHealthy?.();
  const stories = await hunter();
  ctx.assertLeaseHealthy?.();
  ctx.assertLeaseHealthy?.();
  await processStories();
  ctx.assertLeaseHealthy?.();
  // Phase E cutover: scoring engine is the canonical approval path.
  // autoApprove() is now a thin wrapper that always routes through
  // lib/decision-engine::runScoringPass (or returns an explicit no-op
  // summary in non-prod dev modes — never blanket-approves). The old
  // USE_SCORING_ENGINE=true branch is gone; see publisher.js::autoApprove
  // doc for the production / dev semantics.
  ctx.assertLeaseHealthy?.();
  const summary = await autoApprove();
  ctx.assertLeaseHealthy?.();
  let followupPlanJob = null;
  let editorialInventoryJob = null;
  const governedStoryFanout = {
    assessed: 0,
    breaking_queued: 0,
    editorial_queued: 0,
    held: 0,
  };
  const breakingFingerprint = String(
    job?.payload?.breaking_event_fingerprint_sha256 || "",
  ).toLowerCase();
  if (
    /^[a-f0-9]{64}$/.test(breakingFingerprint) &&
    ctx.repos?.jobs?.enqueue
  ) {
    followupPlanJob = ctx.repos.jobs.enqueue({
      kind: "governed_multi_lane_plan",
      channel_id:
        job.channel_id || process.env.CHANNEL || "pulse-gaming",
      payload: {
        breaking_story_id:
          String(job?.payload?.breaking_story_id || "").trim() ||
          null,
        breaking_event_fingerprint_sha256: breakingFingerprint,
        verification_status:
          String(job?.payload?.verification_status || "")
            .trim()
            .toUpperCase() || null,
        primary_source_url:
          String(job?.payload?.primary_source_url || "").trim() ||
          null,
        source_evidence_sha256:
          String(
            job?.payload?.source_evidence_sha256 || "",
          )
            .trim()
            .toLowerCase() || null,
        source_evidence_path:
          String(
            job?.payload?.source_evidence_path || "",
          ).trim() || null,
        source_evidence_file_sha256:
          String(
            job?.payload?.source_evidence_file_sha256 || "",
          )
            .trim()
            .toLowerCase() || null,
        live_publish_enabled: false,
        human_admission_required: true,
      },
      priority: 7,
      requires_gpu: false,
      idempotency_key:
        `breaking-plan-after-hunt:${breakingFingerprint}`,
    });
    const breakingStoryId = String(
      job?.payload?.breaking_story_id || "",
    ).trim();
    const canonicalStory =
      breakingStoryId && ctx.repos?.stories?.get
        ? ctx.repos.stories.get(breakingStoryId)
        : null;
    const sourceEvidencePath = String(
      job?.payload?.source_evidence_path || "",
    ).trim();
    const sourceEvidenceFileSha256 = String(
      job?.payload?.source_evidence_file_sha256 || "",
    )
      .trim()
      .toLowerCase();
    const sourceEvidenceCanonicalSha256 = String(
      job?.payload?.source_evidence_sha256 || "",
    )
      .trim()
      .toLowerCase();
    if (
      canonicalStory &&
      sourceEvidencePath &&
      /^[a-f0-9]{64}$/.test(sourceEvidenceFileSha256) &&
      /^[a-f0-9]{64}$/.test(sourceEvidenceCanonicalSha256)
    ) {
      editorialInventoryJob = ctx.repos.jobs.enqueue({
        kind: "prepare_editorial_inventory",
        channel_id:
          job.channel_id || process.env.CHANNEL || "pulse-gaming",
        story_id: breakingStoryId,
        payload: {
          story: editorialInventoryStoryFromCanonical(
            canonicalStory,
            job.payload,
          ),
          breaking_source_evidence: {
            path: sourceEvidencePath,
            file_sha256: sourceEvidenceFileSha256,
            canonical_sha256:
              sourceEvidenceCanonicalSha256,
          },
          publish_authority: false,
          human_review_required: true,
          live_publish_enabled: false,
        },
        priority: 22,
        requires_gpu: false,
        max_attempts: 2,
        idempotency_key:
          `editorial-inventory:${breakingStoryId}:` +
          sourceEvidenceCanonicalSha256,
      });
    }
  }
  if (
    !/^[a-f0-9]{64}$/.test(breakingFingerprint) &&
    Array.isArray(stories) &&
    ctx.repos?.jobs?.enqueue &&
    ctx.repos?.stories?.get &&
    ctx.repos?.scoring?.latest
  ) {
    const {
      assessGovernedEditorialEvidenceCandidate,
      enqueueGovernedEditorialEvidence,
    } = require("./services/governed-editorial-evidence-ingress");
    const {
      enqueueBreakingEvent,
    } = require("./services/breaking-event-ingress");
    const now =
      job?.payload?.now || new Date().toISOString();
    const channelId =
      job.channel_id ||
      process.env.CHANNEL ||
      "pulse-gaming";
    const seen = new Set();
    for (const discovered of stories) {
      const storyId = String(discovered?.id || "").trim();
      if (!storyId || seen.has(storyId)) continue;
      seen.add(storyId);
      const canonical =
        ctx.repos.stories.get(storyId) || discovered;
      const latestDecision =
        ctx.repos.scoring.latest(storyId);
      governedStoryFanout.assessed += 1;
      const assessment =
        assessGovernedEditorialEvidenceCandidate({
          story: canonical,
          latestDecision,
          now,
        });
      if (!assessment.eligible) {
        governedStoryFanout.held += 1;
        continue;
      }
      const effectiveBreakingScore = Math.max(
        Number(canonical.breaking_score || 0),
        Number(latestDecision?.total || 0),
      );
      if (effectiveBreakingScore >= 80) {
        const ingress = enqueueBreakingEvent({
          story: {
            ...canonical,
            article_url:
              assessment.story.source_url,
            url: assessment.story.source_url,
            timestamp:
              assessment.story.published_at,
            breaking_score: effectiveBreakingScore,
          },
          jobs: ctx.repos.jobs,
          now,
          channelId,
        });
        if (ingress.queued) {
          governedStoryFanout.breaking_queued += 1;
        } else {
          governedStoryFanout.held += 1;
        }
        continue;
      }
      const ingress = enqueueGovernedEditorialEvidence({
        story: canonical,
        latestDecision,
        jobs: ctx.repos.jobs,
        now,
      });
      if (ingress.queued) {
        governedStoryFanout.editorial_queued += 1;
      } else {
        governedStoryFanout.held += 1;
      }
    }
  }
  return {
    fetched: Array.isArray(stories) ? stories.length : 0,
    scoring: summary,
    governed_story_fanout: governedStoryFanout,
    ...(followupPlanJob
      ? { followup_plan_job_id: followupPlanJob.id }
      : {}),
    ...(editorialInventoryJob
      ? {
          editorial_inventory_job_id:
            editorialInventoryJob.id,
        }
      : {}),
  };
}

async function handleProduce(job, ctx) {
  const { produce } = require("../publisher");
  ctx.assertLeaseHealthy?.();
  const result = await produce();
  ctx.assertLeaseHealthy?.();
  return result || { ok: true };
}

// Core platforms carry the commercial model — a failure here is worth
// alerting on. TikTok is core (not optional) per the 2026-04-19 priority
// reset. Twitter/X is explicitly optional because the free API tier
// cannot post videos and the paid tiers are expensive.
//
// The labels in `CORE_LABEL` refer to the Reel/Short video upload per
// platform, NOT any static card / Story variant that posts alongside.
// See `FALLBACK_POSTS` for the card/Story variants (FB Card, IG Story,
// X image tweet).
const CORE_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"];
const OPTIONAL_PLATFORMS = ["twitter"];

// Fallback / complementary posts that live ALONGSIDE the Reel/Short —
// static card images posted to IG Stories, FB Stories, and Twitter as
// an image tweet. These post regardless of whether the Reel succeeded,
// and they have materially lower reach, so they render on a separate
// "Fallbacks:" line and do NOT weigh in on the overall status.
const FALLBACK_POSTS = [
  { key: "facebook_card", label: "FB Card", errorKey: "facebook_story" },
  { key: "instagram_story", label: "IG Story", errorKey: "instagram_story" },
  { key: "twitter_image", label: "X Card", errorKey: "twitter_image" },
];

/**
 * Render the publish result into a Discord-friendly summary and compute
 * an overall status ("ok" / "degraded" / "failed") driven by CORE Reel
 * outcomes only. Optional platforms (Twitter/X) and static fallback
 * cards (FB Card / IG Story / X Card) render on their own lines and
 * cannot make the publish look broken.
 *
 * Exported for unit testing so the shape stays stable.
 */
function renderPublishSummary(result, { jobId } = {}) {
  if (!result) return null;

  if (result.publish_dispatch_blocked) {
    const reason = result.top_reason || "durable_publish_dispatch_blocked";
    return {
      message: [
        `**Pulse Gaming News publish deferred**${jobId ? ` (job #${jobId})` : ""}`,
        "Status:    deferred",
        `Reason: ${reason}`,
      ].join("\n"),
      status: "deferred",
    };
  }

  // --- No-safe-candidate path (2026-04-22 multi-candidate fallback) ---
  // The publisher walked through up to MAX_PUBLISH_CANDIDATES_PER_WINDOW
  // produced stories and every single one failed preflight QA. No
  // upload happened. Discord needs to say so clearly — "skipped" /
  // "unknown" don't cut it at 09/14/19 UTC when the operator is
  // waiting for the day's post to ship.
  if (result.no_safe_candidate) {
    const tried = result.candidates_tried || 0;
    const n = result.qa_skipped_count || 0;
    const top = result.top_reason || "unknown";
    const qaSkipped = Array.isArray(result.qa_skipped) ? result.qa_skipped : [];
    const lines = [
      `**Pulse Gaming News publish attempt**${jobId ? ` (job #${jobId})` : ""}`,
      `Status:    failed`,
      `No safe publish candidate passed QA.`,
      `Candidates tried: ${tried}`,
      `Skipped QA-failed candidates: ${n}`,
      `Top reason: ${top}`,
    ];
    // Include up to the first 3 skipped candidates' titles + reasons
    // so operators can eyeball what broke without hitting the DB.
    // Truncate titles to keep the summary under Discord's 2000-char cap.
    const sample = qaSkipped.slice(0, 3);
    if (sample.length > 0) {
      lines.push("Failed candidates:");
      for (const c of sample) {
        const t = String(c.title || "(untitled)").slice(0, 80);
        const r = c.source
          ? `${c.source}_qa: ${c.reason}`
          : c.reason || "unknown";
        lines.push(`• ${t} — ${r}`);
      }
    }
    return { message: lines.join("\n"), status: "failed" };
  }

  const skipped = result.skipped || {};
  const errors = result.errors || {};
  const fallbacks = result.fallbacks || {};
  // Truthful per-platform outcomes. When the publisher populated this
  // map (new shape from 2026-04-23), we render from it verbatim so
  // `already_published` can't masquerade as a fresh `new_upload`.
  // If the field is absent (old callers, hand-constructed test
  // fixtures), fall back to the legacy boolean-and-skipped shape.
  const outcomes = result.platform_outcomes || null;

  // CORE: Reel / Short upload per platform. Labels include "Reel" for
  // IG and FB so the summary can't be mistaken for the static card
  // success (which posts separately — see FALLBACK_POSTS).
  const label = {
    youtube: "YT",
    tiktok: "TT",
    instagram: "IG Reel",
    facebook: "FB Reel",
    twitter: "X",
  };

  // Glyph for an outcome enum value. Renders the same way for any
  // platform (core, optional, fallback) so one update lands in one
  // place when the semantics evolve.
  const glyphFor = (outcome, { skippedReason } = {}) => {
    switch (outcome) {
      case "new_upload":
        return "✅";
      case "public_verified":
        // Stronger than new_upload — caller polled/fetched the
        // published URL after upload and confirmed it's live. FB's
        // verifyReelPublished + any future YT/IG/TikTok verifier
        // can flip new_upload → public_verified on confirmation.
        return "✅ verified";
      case "already_published":
        return "↩ already";
      case "duplicate_blocked":
        return "⊘ dup";
      case "accepted_processing":
        return "⏳";
      case "failed":
        return "❌";
      case "skipped":
        return skippedReason ? `⏸ ${skippedReason}` : "⏸";
      case "page_not_eligible":
        // Renders the same way as a deliberate skip — the platform
        // has a Page-side eligibility gate (e.g. FB Reels on a new
        // 0-follower Page) that no code-side change can clear. The
        // operator flips an env var when Meta enables Reels for
        // the Page.
        return "⏸ page_not_eligible";
      case "operator_disabled":
        return "⏸ operator_disabled";
      case "not_attempted":
        return "—";
      default:
        return "?";
    }
  };

  const detailFor = (value) => {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  };

  const renderPlatform = (p) => {
    if (outcomes) {
      return `${label[p]} ${glyphFor(outcomes[p], { skippedReason: skipped[p] })}`;
    }
    // Legacy fallback — pre-2026-04-23 callers and hand-built test
    // fixtures that don't carry platform_outcomes.
    if (result[p]) return `${label[p]} ✅`;
    if (skipped[p]) return `${label[p]} ⏸ ${skipped[p]}`;
    return `${label[p]} ❌`;
  };

  // Status derivation. With platform_outcomes present we compute
  // from the truthful enum:
  //   `ok`             — every core is new_upload
  //   `degraded`       — some core new_upload, some failed/blocked
  //   `no_new_post`    — zero core new_upload, at least one
  //                      already_published (partial retry where
  //                      nothing shipped this window)
  //   `failed`         — zero core new_upload, zero already_published,
  //                      everything else failed/blocked
  //
  // Without platform_outcomes we preserve the historical derivation
  // so tests that build results by hand keep passing.
  let status;
  if (outcomes) {
    const coreOutcomes = CORE_PLATFORMS.map(
      (p) => outcomes[p] || "not_attempted",
    );
    const count = (v) => coreOutcomes.filter((o) => o === v).length;
    // `public_verified` is a strict-superset of `new_upload` — it
    // means the post was uploaded AND independently confirmed live
    // via a follow-up HTTP fetch or Graph API status poll. For
    // status derivation both count as "fresh new public post".
    const newCnt = count("new_upload") + count("public_verified");
    const alreadyCnt = count("already_published");
    const attemptedFail = coreOutcomes.filter(
      (o) => o === "failed" || o === "duplicate_blocked",
    ).length;

    if (newCnt === CORE_PLATFORMS.length) {
      status = "ok";
    } else if (newCnt > 0) {
      status = "degraded";
    } else if (alreadyCnt > 0) {
      // Zero fresh uploads; some platforms were already published.
      // This is the exact shape of today's ghost-success windows.
      status = "no_new_post";
    } else if (attemptedFail > 0) {
      status = "failed";
    } else {
      status = "degraded"; // mix of skipped/not_attempted
    }
  } else {
    const coreResults = CORE_PLATFORMS.map((p) => ({
      platform: p,
      ok: !!result[p],
      skipped: !!skipped[p],
      failed: !result[p] && !skipped[p],
    }));
    const coreAttempted = coreResults.filter((r) => !r.skipped);
    const coreOk = coreAttempted.filter((r) => r.ok);
    const coreFailed = coreAttempted.filter((r) => r.failed);
    const ytFailed = !result.youtube && !skipped.youtube;
    const ttFailed = !result.tiktok && !skipped.tiktok;
    if (coreAttempted.length === 0) status = "degraded";
    else if (coreOk.length === coreAttempted.length) status = "ok";
    else if (
      coreFailed.length === coreAttempted.length ||
      (ytFailed && ttFailed)
    )
      status = "failed";
    else status = "degraded";
  }

  const corePlatformsLine = CORE_PLATFORMS.map(renderPlatform).join(" · ");
  const optionalPlatformsLine =
    OPTIONAL_PLATFORMS.map(renderPlatform).join(" · ");

  // Fallbacks line — show `already` / `✅` / `❌` distinctly when
  // platform_outcomes is present, same legacy behaviour otherwise.
  const fallbackEntries = FALLBACK_POSTS.map(
    ({ key, label: flabel, errorKey }) => {
      if (outcomes) {
        const o = outcomes[key];
        if (!o || o === "not_attempted") return null;
        if (o === "skipped") {
          const r = skipped[errorKey] || skipped[key] || "skipped";
          return `${flabel} ⏸ ${r}`;
        }
        if (
          (o === "failed" || o === "accepted_processing") &&
          errors[errorKey]
        ) {
          return `${flabel} ${glyphFor(o)} (${detailFor(errors[errorKey])})`;
        }
        return `${flabel} ${glyphFor(o)}`;
      }
      if (fallbacks[key]) return `${flabel} ✅`;
      if (errors[errorKey]) return `${flabel} ❌`;
      return null;
    },
  ).filter(Boolean);
  const fallbacksLine =
    fallbackEntries.length > 0 ? fallbackEntries.join(" · ") : null;

  // Only CORE errors are surfaced in the details block — Twitter 402s
  // and static-card failures live on their own lines and shouldn't
  // pollute the main summary.
  const coreErrorDetails = CORE_PLATFORMS.filter((p) => errors[p])
    .map((p) => `${label[p]}: ${errors[p]}`)
    .join("\n");

  const lines = [
    `**Pulse Gaming News published**${jobId ? ` (job #${jobId})` : ""}`,
    `"${result.title || "(untitled)"}"`,
    `Core:      ${corePlatformsLine}`,
  ];
  if (fallbacksLine) lines.push(`Fallbacks: ${fallbacksLine}`);
  lines.push(`Optional:  ${optionalPlatformsLine}`);
  lines.push(`Status:    ${status}`);

  // 2026-04-29 audit P1: surface render-quality metadata so the
  // operator sees per-publish render lane + visual count without
  // grepping the DB. Stamp-less rows render as "(unstamped)" so
  // the absence is visible rather than hidden.
  const renderBits = [];
  if (result.render_lane) renderBits.push(`lane=${result.render_lane}`);
  if (result.render_quality_class) {
    renderBits.push(`class=${result.render_quality_class}`);
  }
  if (typeof result.distinct_visual_count === "number") {
    const visEmoji = result.distinct_visual_count < 3 ? " ⚠ thin" : "";
    renderBits.push(`visuals=${result.distinct_visual_count}${visEmoji}`);
  }
  if (result.outro_present === false) renderBits.push("outro=missing ⚠");
  if (result.render_fallback_reason) {
    // Truncate to first 80 chars so Discord summary stays readable.
    // Full reason is persisted on the story row for the
    // ops:publish-readiness audit trail.
    const trimmed = String(result.render_fallback_reason).slice(0, 80);
    renderBits.push(`fallback_reason="${trimmed}…"`);
  }
  if (renderBits.length > 0) {
    lines.push(`Render:    ${renderBits.join(" · ")}`);
  } else if (
    result.render_lane === null &&
    result.distinct_visual_count === null
  ) {
    lines.push("Render:    (unstamped — pre-2026-04-29 row)");
  }

  // 2026-04-30 audit P0 #2: render contract verdict line. Surfaces
  // the premium/standard/fallback/reject classification so Discord
  // shows the operator-facing render-quality grade per publish.
  if (result.render_contract && result.render_contract.class) {
    try {
      const { formatContractLine } = require("../lib/render-contract");
      const line = formatContractLine(result.render_contract);
      if (line) lines.push(`Contract:  ${line}`);
    } catch {
      /* contract module not loadable — skip the line */
    }
  }
  // Multi-candidate fallback signal: if the publisher walked past
  // one or more QA-failed candidates before landing on this one,
  // tell the operator so they know the window nearly burned.
  if (
    typeof result.qa_skipped_count === "number" &&
    result.qa_skipped_count > 0
  ) {
    lines.push(`Skipped QA-failed candidates: ${result.qa_skipped_count}`);
  }
  if (coreErrorDetails) lines.push(coreErrorDetails);

  return { message: lines.join("\n"), status };
}

function stabilisationPublishJobBlocker(job = {}) {
  const payload =
    job.payload && typeof job.payload === "object" ? job.payload : {};
  if (payload.scheduler_profile !== "stabilisation_30d") {
    return "publish_job_outside_stabilisation_profile";
  }
  if (payload.target_platform !== "youtube") {
    return "publish_job_target_outside_stabilisation_scope";
  }
  if (!/^publish:\d{4}-\d{2}-\d{2}:(09|19)$/.test(
    String(job.idempotency_key || ""),
  )) {
    return "publish_job_outside_guarded_window";
  }
  return null;
}

async function handlePublish(job, ctx) {
  const payloadBlocker = stabilisationPublishJobBlocker(job);
  if (payloadBlocker) {
    return {
      skipped: true,
      status: "held",
      reason: payloadBlocker,
    };
  }
  let exactDispatchBinding;
  try {
    const {
      resolveExactScheduledDispatchBinding,
    } = require("./services/scheduled-dispatch-binding");
    exactDispatchBinding = resolveExactScheduledDispatchBinding({
      db: ctx.repos?.db,
      now: typeof ctx.now === "function" ? ctx.now() : ctx.now,
    });
  } catch (error) {
    return {
      skipped: true,
      status: "held",
      reason:
        error?.code ||
        error?.message ||
        "scheduled_dispatch_binding_unavailable",
    };
  }
  const publishNextStory =
    ctx.publishNextStory || require("../publisher").publishNextStory;
  ctx.assertLeaseHealthy?.();
  const result = await publishNextStory({
    channelId: job.channel_id || process.env.CHANNEL || "pulse-gaming",
    currentJobId: job.id,
    repos: ctx.repos,
    cadenceEvaluator: ctx.cadenceEvaluator,
    now: typeof ctx.now === "function" ? ctx.now() : ctx.now,
    exactDispatchBinding,
  });
  ctx.assertLeaseHealthy?.();
  if (result?.publish_dispatch_blocked) {
    const reason = result.top_reason || "durable_publish_dispatch_blocked";
    return {
      deferred: true,
      status: "held",
      reason,
      cadence: result.cadence || null,
    };
  }
  if (!result) return { skipped: true };
  const summary = renderPublishSummary(result, { jobId: job.id });
  try {
    const sendDiscord = require("../notify");
    if (summary) await sendDiscord(summary.message);
  } catch (err) {
    ctx.log && ctx.log(`notify error: ${err.message}`);
  }

  // No-safe-candidate path: every candidate in the window's top N
  // hit a hard-fail QA block. Record that structurally so the jobs
  // row's result_summary makes the failure legible without having
  // to read Discord.
  if (result.no_safe_candidate) {
    return {
      no_safe_candidate: true,
      status: "failed",
      candidates_tried: result.candidates_tried || 0,
      qa_skipped_count: result.qa_skipped_count || 0,
      top_reason: result.top_reason || "unknown",
    };
  }

  return {
    title: result.title,
    status: summary ? summary.status : "unknown",
    platforms: {
      youtube: !!result.youtube,
      tiktok: !!result.tiktok,
      instagram: !!result.instagram,
      facebook: !!result.facebook,
      twitter: !!result.twitter,
    },
    skipped: result.skipped || {},
    qa_skipped_count: result.qa_skipped_count || 0,
  };
}

function liveGuardedHandlerBlockers(
  payload = {},
  env = process.env,
  authorityField,
) {
  const {
    resolveOperatingContract,
  } = require("./stabilisation/operating-contract");
  const contract = resolveOperatingContract({ env });
  const blockers = [];
  if (payload?.[authorityField] !== true) {
    blockers.push(`exact_${authorityField}_required`);
  }
  if (
    contract.mode !== "LIVE_GUARDED" ||
    contract.valid !== true ||
    contract.live_mutation_allowed !== true
  ) {
    blockers.push("live_guarded_operating_contract_required");
    blockers.push(...contract.blockers);
  }
  if (String(payload.platform || "").trim() !== "youtube") {
    blockers.push("governed_youtube_platform_required");
  }
  return {
    blockers: [...new Set(blockers)],
    contract,
  };
}

function exactScheduledPayloadBlockers(payload, binding) {
  const blockers = [];
  const scheduledFor = (() => {
    const parsed = Date.parse(String(payload.scheduled_for || ""));
    return Number.isFinite(parsed)
      ? new Date(parsed).toISOString()
      : null;
  })();
  const comparisons = [
    [
      String(payload.story_id || "").trim(),
      binding.storyId,
      "scheduled_story_id_mismatch",
    ],
    [
      String(payload.platform || "").trim(),
      binding.platform,
      "scheduled_platform_mismatch",
    ],
    [
      Number(payload.scheduled_event_id),
      binding.scheduledEventId,
      "scheduled_event_id_mismatch",
    ],
    [
      scheduledFor,
      binding.scheduledFor,
      "scheduled_time_mismatch",
    ],
    [
      String(payload.dispatch_idempotency_key || "").trim(),
      binding.dispatchIdempotencyKey,
      "scheduled_dispatch_idempotency_key_mismatch",
    ],
    [
      String(payload.request_fingerprint || "")
        .trim()
        .toLowerCase(),
      binding.requestFingerprint,
      "scheduled_request_fingerprint_mismatch",
    ],
  ];
  for (const [actual, expected, code] of comparisons) {
    if (actual !== expected) blockers.push(code);
  }
  return blockers;
}

async function handleGovernedPublicationDispatch(job, ctx) {
  const payload = job?.payload || {};
  if (governedRunwayRequired(payload, ctx)) {
    return {
      status: "held",
      blockers: [
        "legacy_t0_upload_dispatch_forbidden_use_public_verifier",
      ],
      story_id:
        String(payload.story_id || "").trim() || null,
      external_post_attempted: false,
      upload_attempted: false,
      public_verification_only: true,
    };
  }
  const env = ctx.env || process.env;
  const runtime = liveGuardedHandlerBlockers(
    payload,
    env,
    "guarded_dispatch_authority",
  );
  if (runtime.blockers.length) {
    return {
      status: "held",
      blockers: runtime.blockers,
      story_id: String(payload.story_id || "").trim() || null,
      external_post_attempted: false,
    };
  }

  const nowValue =
    typeof ctx.now === "function" ? ctx.now() : ctx.now;
  const effectiveNow =
    nowValue === undefined
      ? new Date()
      : nowValue instanceof Date
        ? nowValue
        : new Date(nowValue);
  let runwayEnvelope = null;
  let freshControl = null;
  if (governedRunwayRequired(payload, ctx)) {
    try {
      runwayEnvelope = await loadGovernedRunwayEnvelope({
        scheduledFor: payload.scheduled_for,
        payload,
        ctx,
      });
    } catch (error) {
      return {
        status: "held",
        blockers: [
          error?.code ||
            error?.message ||
            "runway_lock_artifact_required",
        ],
        story_id: String(payload.story_id || "").trim() || null,
        external_post_attempted: false,
      };
    }
    const runwayBlockers = [
      ...runwayEnvelope.blockers,
    ];
    if (
      String(payload.runway_lock_sha256 || "")
        .trim()
        .toLowerCase() !==
      String(runwayEnvelope.lock.lock_sha256)
    ) {
      runwayBlockers.push(
        "runway_dispatch_payload_lock_sha256_mismatch",
      );
    }
    const resolveFreshControl =
      ctx.resolveRunwayFreshControl ||
      (({ now }) => {
        const {
          deriveMultiLaneRuntimeControl,
        } = require("./services/multi-lane-runtime-control");
        const control = deriveMultiLaneRuntimeControl({
          payload: {
            scheduler_profile: "governed_multi_lane",
          },
          repos: ctx.repos,
          env,
          now,
          operatingContract: runtime.contract,
        });
        return {
          verdict:
            control.kill_switch_healthy === true &&
            control.operating_contract_valid === true &&
            control.scheduler_owner_healthy === true
              ? "GREEN"
              : "HOLD",
          checked_at: now.toISOString(),
          kill_switch_healthy:
            control.kill_switch_healthy === true,
          operating_contract_valid:
            control.operating_contract_valid === true,
          scheduler_owner_healthy:
            control.scheduler_owner_healthy === true,
          evidence: control.evidence,
        };
      });
    freshControl = await resolveFreshControl({
      now: effectiveNow,
      payload,
      repos: ctx.repos,
      env,
      operatingContract: runtime.contract,
    });
    if (
      freshControl?.verdict !== "GREEN" ||
      freshControl?.kill_switch_healthy !== true ||
      freshControl?.operating_contract_valid !== true ||
      freshControl?.scheduler_owner_healthy !== true
    ) {
      runwayBlockers.push(
        "runway_t0_fresh_control_not_green",
      );
    }
    if (runwayBlockers.length) {
      const incident = {
        schema_version:
          "pulse-governed-youtube-runway-incident-v1",
        phase: "T0",
        scheduled_for: payload.scheduled_for,
        classification: "HELD_POLICY",
        verdict: "HOLD",
        blockers: [...new Set(runwayBlockers)],
        runway_lock_sha256:
          runwayEnvelope.lock.lock_sha256,
        publish_authority: false,
        catch_up_allowed: false,
        generated_at: effectiveNow.toISOString(),
      };
      const incidentPath = path.join(
        runwayEnvelope.window_dir,
        "incident-t0.json",
      );
      await atomicWriteRunwayJson(incidentPath, incident);
      await notifyGovernedRunwayIncident(ctx, incident);
      return {
        status: "held",
        blockers: incident.blockers,
        story_id: String(payload.story_id || "").trim() || null,
        runway_lock_sha256:
          runwayEnvelope.lock.lock_sha256,
        incident_json: incidentPath,
        external_post_attempted: false,
      };
    }
  }

  let exactDispatchBinding;
  try {
    const bindingService = require(
      "./services/scheduled-dispatch-binding"
    );
    exactDispatchBinding = runwayEnvelope
      ? bindingService.resolveExactScheduledDispatchBindingWithFreshControl(
          {
            db: ctx.repos?.db,
            now: effectiveNow,
            fresh_control: freshControl,
          },
        )
      : bindingService.resolveExactScheduledDispatchBinding({
          db: ctx.repos?.db,
          now: effectiveNow,
        });
  } catch (error) {
    return {
      status: "held",
      blockers: [
        error?.code ||
          error?.message ||
          "scheduled_dispatch_binding_unavailable",
      ],
      story_id: String(payload.story_id || "").trim() || null,
      external_post_attempted: false,
    };
  }
  const bindingBlockers = exactScheduledPayloadBlockers(
    payload,
    exactDispatchBinding,
  );
  if (bindingBlockers.length) {
    return {
      status: "held",
      blockers: bindingBlockers,
      story_id: String(payload.story_id || "").trim() || null,
      external_post_attempted: false,
    };
  }
  let runwayDispatchVerification = null;
  let t0EvidencePath = null;
  if (runwayEnvelope) {
    const {
      verifyGovernedYoutubeLockedDispatch,
    } = require("./services/governed-youtube-release-runway");
    runwayDispatchVerification =
      verifyGovernedYoutubeLockedDispatch({
        now: effectiveNow,
        lock: runwayEnvelope.lock,
        scheduled_binding: {
          ...exactDispatchBinding,
          runwayLockSha256:
            exactDispatchBinding.runwayLockSha256,
        },
      });
    t0EvidencePath = path.join(
      runwayEnvelope.window_dir,
      "t0-dispatch-verification.json",
    );
    await atomicWriteRunwayJson(t0EvidencePath, {
      ...runwayDispatchVerification,
      fresh_control_evidence:
        exactDispatchBinding.freshControlEvidence,
      fresh_control_sha256:
        exactDispatchBinding.freshControlSha256,
      scheduled_event_id:
        exactDispatchBinding.scheduledEventId,
      dispatch_idempotency_key:
        exactDispatchBinding.dispatchIdempotencyKey,
      request_fingerprint:
        exactDispatchBinding.requestFingerprint,
      external_post_attempted: false,
    });
    if (runwayDispatchVerification.verdict !== "GREEN") {
      return {
        status: "held",
        blockers: runwayDispatchVerification.blockers,
        story_id: exactDispatchBinding.storyId,
        runway_lock_sha256:
          runwayEnvelope.lock.lock_sha256,
        t0_evidence_json: t0EvidencePath,
        external_post_attempted: false,
      };
    }
  }

  const publishNextStory =
    ctx.publishNextStory || require("../publisher").publishNextStory;
  ctx.assertLeaseHealthy?.();
  const result = await publishNextStory({
    channelId:
      job.channel_id || process.env.CHANNEL || "pulse-gaming",
    currentJobId: job.id,
    repos: ctx.repos,
    cadenceEvaluator: ctx.cadenceEvaluator,
    now: typeof ctx.now === "function" ? ctx.now() : ctx.now,
    exactDispatchBinding,
    env,
  });
  ctx.assertLeaseHealthy?.();
  if (result?.publish_dispatch_blocked) {
    return {
      status: "held",
      blockers: [
        result.top_reason || "durable_publish_dispatch_blocked",
      ],
      story_id: exactDispatchBinding.storyId,
      external_post_attempted: true,
      publisher_result: result,
    };
  }
  return {
    status: "dispatched",
    story_id: exactDispatchBinding.storyId,
    scheduled_event_id:
      exactDispatchBinding.scheduledEventId,
    runway_lock_sha256:
      runwayEnvelope?.lock?.lock_sha256 || null,
    t0_evidence_json: t0EvidencePath,
    external_post_attempted: true,
    publisher_result: result || null,
  };
}

const AUTONOMOUS_OFFICIAL_ADMISSION_TYPE =
  "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const AUTONOMOUS_OFFICIAL_ADMISSION_SCOPE =
  "PUBLICATION_ADMISSION_ONLY";
const AUTONOMOUS_OFFICIAL_AUTHORITY_TTL_MS = 60 * 1000;

function exactAutonomousAdmissionPacketBlockers(
  payload = {},
  now = new Date(),
) {
  const packet = payload.admission;
  if (
    !packet ||
    typeof packet !== "object" ||
    Array.isArray(packet)
  ) {
    return ["exact_autonomous_admission_packet_required"];
  }
  const blockers = [];
  if (
    packet.approval_type !==
      AUTONOMOUS_OFFICIAL_ADMISSION_TYPE ||
    packet.human_admission_required !== false ||
    payload.human_admission_required === true
  ) {
    blockers.push("exact_autonomous_approval_type_required");
  }
  if (
    [
      "human_review_status",
      "actor_id",
      "reason",
      "human_review_audit_id",
      "humanReviewAuditId",
      "operator",
    ].some(
      (field) =>
        Object.hasOwn(packet, field) ||
        Object.hasOwn(payload, field),
    )
  ) {
    blockers.push(
      "exact_autonomous_human_approval_conflation",
    );
  }
  if (
    String(packet.confirmation_story_id || "").trim() !==
    String(payload.story_id || "").trim()
  ) {
    blockers.push(
      "exact_autonomous_story_confirmation_required",
    );
  }
  if (
    !Number.isFinite(
      Date.parse(String(packet.scheduled_for || "")),
    )
  ) {
    blockers.push("exact_autonomous_schedule_required");
  }
  const authority = packet.autonomous_publication_authority;
  if (
    !authority ||
    typeof authority !== "object" ||
    Array.isArray(authority)
  ) {
    blockers.push(
      "exact_autonomous_publication_authority_required",
    );
    return blockers;
  }
  const current =
    now instanceof Date ? new Date(now) : new Date(now);
  const issuedAt = new Date(authority.issued_at);
  const validUntil = new Date(authority.valid_until);
  const sourceValidUntil = new Date(
    authority.source_report?.valid_until,
  );
  if (
    Number.isNaN(current.getTime()) ||
    Number.isNaN(issuedAt.getTime()) ||
    Number.isNaN(validUntil.getTime()) ||
    issuedAt.getTime() > current.getTime() ||
    validUntil.getTime() <= current.getTime() ||
    validUntil.getTime() - issuedAt.getTime() >
      AUTONOMOUS_OFFICIAL_AUTHORITY_TTL_MS
  ) {
    blockers.push(
      "exact_autonomous_authority_fresh_at_t75_required",
    );
  }
  if (
    Number.isNaN(sourceValidUntil.getTime()) ||
    sourceValidUntil.getTime() <= current.getTime()
  ) {
    blockers.push(
      "exact_autonomous_source_report_fresh_at_t75_required",
    );
  }
  if (
    authority.authority_type !==
      AUTONOMOUS_OFFICIAL_ADMISSION_TYPE ||
    authority.authority_scope !==
      AUTONOMOUS_OFFICIAL_ADMISSION_SCOPE ||
    authority.decision !== "APPROVED" ||
    authority.human_approval !== false ||
    authority.may_impersonate_human !== false ||
    authority.operational_publish_authority !== false ||
    authority.dispatch_authorised !== false ||
    authority.external_publish_authorised !== false
  ) {
    blockers.push("exact_autonomous_authority_scope_invalid");
  }
  if (
    String(authority.story_id || "").trim() !==
      String(payload.story_id || "").trim() ||
    String(authority.channel_id || "").trim() !==
      String(payload.channel_id || "pulse-gaming").trim() ||
    String(authority.lane_id || "").trim() !==
      String(payload.lane_id || "").trim() ||
    String(authority.platform || "").trim() !== "youtube" ||
    String(authority.scheduled_for || "").trim() !==
      String(packet.scheduled_for || "").trim()
  ) {
    blockers.push(
      "exact_autonomous_authority_binding_invalid",
    );
  }
  if (
    String(packet.autonomous_authority_id || "").trim() !==
      String(authority.authority_id || "").trim() ||
    validRunwaySha256(
      packet.autonomous_authority_sha256,
    ) !== validRunwaySha256(authority.authority_sha256) ||
    String(
      packet.autonomous_authority_valid_until || "",
    ).trim() !== String(authority.valid_until || "").trim() ||
    validRunwaySha256(
      packet.autonomous_source_report_sha256,
    ) !==
      validRunwaySha256(
        authority.source_report?.report_sha256,
      ) ||
    String(
      packet.autonomous_source_report_valid_until || "",
    ).trim() !==
      String(authority.source_report?.valid_until || "").trim()
  ) {
    blockers.push(
      "exact_autonomous_admission_authority_mismatch",
    );
  }
  if (
    !packet.publication_evidence ||
    typeof packet.publication_evidence !== "object" ||
    Array.isArray(packet.publication_evidence)
  ) {
    blockers.push(
      "exact_autonomous_publication_evidence_required",
    );
  }
  return blockers;
}

function exactAutonomousJitAdmissionIntentBlockers(
  payload = {},
  now = new Date(),
) {
  const packet = payload.admission;
  if (
    !packet ||
    typeof packet !== "object" ||
    Array.isArray(packet)
  ) {
    return ["exact_autonomous_jit_admission_intent_required"];
  }
  const blockers = [];
  if (
    payload.autonomous_jit_materialisation_required !== true ||
    payload.human_admission_required !== false ||
    packet.approval_type !==
      AUTONOMOUS_OFFICIAL_ADMISSION_TYPE ||
    packet.human_admission_required !== false
  ) {
    blockers.push(
      "exact_autonomous_jit_materialisation_intent_required",
    );
  }
  if (
    [
      "human_review_status",
      "actor_id",
      "reason",
      "human_review_audit_id",
      "humanReviewAuditId",
      "operator",
      "autonomous_publication_authority",
    ].some(
      (field) =>
        Object.hasOwn(packet, field) ||
        Object.hasOwn(payload, field),
    )
  ) {
    blockers.push(
      "autonomous_jit_human_or_preissued_authority_forbidden",
    );
  }
  const storyId = String(payload.story_id || "").trim();
  if (
    !storyId ||
    String(packet.confirmation_story_id || "").trim() !==
      storyId ||
    !Number.isFinite(
      Date.parse(String(packet.scheduled_for || "")),
    )
  ) {
    blockers.push("exact_autonomous_jit_story_window_required");
  }
  const preparation = packet.jit_preparation;
  let validatedPreparation = null;
  try {
    const {
      validateAutonomousOfficialJitPreparationManifest,
    } = require(
      "./services/autonomous-official-jit-admission-packet"
    );
    validatedPreparation =
      validateAutonomousOfficialJitPreparationManifest(
        preparation,
      );
  } catch (error) {
    blockers.push(
      error?.code ||
        "exact_autonomous_jit_preparation_invalid",
    );
  }
  if (
    validatedPreparation &&
    (validatedPreparation.story_id !== storyId ||
      validatedPreparation.channel_id !==
        String(
          payload.channel_id ||
            payload.channelId ||
            "pulse-gaming",
        ).trim() ||
      validatedPreparation.lane_id !==
        String(payload.lane_id || "").trim() ||
      validatedPreparation.platform !== "youtube" ||
      validatedPreparation.scheduled_for !==
        String(packet.scheduled_for || "").trim() ||
      validatedPreparation.role !== "PRIMARY" ||
      validatedPreparation.candidate_revision_sha256 !==
        String(
          payload.candidate_revision_sha256 || "",
        )
          .trim()
          .toLowerCase() ||
      validatedPreparation.preparation_sha256 !==
        validRunwaySha256(
          packet.jit_preparation_sha256,
        ))
  ) {
    blockers.push(
      "exact_autonomous_jit_preparation_binding_mismatch",
    );
  }
  const attestation =
    packet.autonomous_window_eligibility_attestation;
  if (validatedPreparation) {
    try {
      const {
        validateAutonomousWindowEligibilityAttestation,
      } = require(
        "./services/governed-youtube-release-runway"
      );
      const validatedAttestation =
        validateAutonomousWindowEligibilityAttestation(
          attestation,
          {
            now,
            expected: {
              story_id: storyId,
              channel_id: "pulse-gaming",
              lane_id: String(payload.lane_id || "").trim(),
              platform: "youtube",
              scheduled_for:
                validatedPreparation.scheduled_for,
              role: "PRIMARY",
              jit_preparation: validatedPreparation,
            },
          },
        );
      if (
        validRunwaySha256(
          packet.autonomous_eligibility_attestation_sha256,
        ) !==
        validRunwaySha256(
          validatedAttestation.attestation_sha256,
        )
      ) {
        blockers.push(
          "exact_autonomous_jit_attestation_summary_mismatch",
        );
      }
    } catch (error) {
      blockers.push(
        error?.code ||
          "exact_autonomous_jit_eligibility_attestation_invalid",
      );
    }
  }
  return [...new Set(blockers)];
}

function exactAdmissionPacketBlockers(
  payload = {},
  now = new Date(),
) {
  const packet = payload.admission;
  const autonomous =
    packet?.approval_type ===
      AUTONOMOUS_OFFICIAL_ADMISSION_TYPE ||
    payload.human_admission_required === false;
  if (autonomous) {
    return exactAutonomousAdmissionPacketBlockers(
      payload,
      now,
    );
  }
  if (
    !packet ||
    typeof packet !== "object" ||
    Array.isArray(packet)
  ) {
    return ["exact_human_admission_packet_required"];
  }
  const blockers = [];
  if (
    String(packet.human_review_status || "")
      .trim()
      .toLowerCase() !== "approved"
  ) {
    blockers.push("exact_human_review_status_required");
  }
  if (!String(packet.actor_id || "").trim()) {
    blockers.push("exact_human_review_actor_required");
  }
  if (!String(packet.reason || "").trim()) {
    blockers.push("exact_human_review_reason_required");
  }
  if (
    String(packet.confirmation_story_id || "").trim() !==
    String(payload.story_id || "").trim()
  ) {
    blockers.push("exact_human_story_confirmation_required");
  }
  if (
    !Number.isFinite(
      Date.parse(String(packet.scheduled_for || "")),
    )
  ) {
    blockers.push("exact_human_schedule_required");
  }
  if (
    !packet.evidence ||
    typeof packet.evidence !== "object" ||
    Array.isArray(packet.evidence)
  ) {
    blockers.push("exact_human_publication_evidence_required");
  }
  return blockers;
}

async function handleGovernedPublicationAdmission(job, ctx) {
  const payload = job?.payload || {};
  const initialPacket = payload.admission;
  const autonomousJit =
    payload.autonomous_jit_materialisation_required === true &&
    initialPacket?.approval_type ===
      AUTONOMOUS_OFFICIAL_ADMISSION_TYPE;
  const checkpointNow = governedRunwayNow(payload, ctx);
  const checkpointTimingHold =
    await governedRunwayCheckpointTimingHold({
      job,
      payload,
      ctx,
      now: checkpointNow,
    });
  if (checkpointTimingHold) return checkpointTimingHold;
  const env = ctx.env || process.env;
  const runtime = liveGuardedHandlerBlockers(
    payload,
    env,
    "guarded_admission_authority",
  );
  const packetBlockers = autonomousJit
    ? exactAutonomousJitAdmissionIntentBlockers(
        payload,
        checkpointNow,
      )
    : exactAdmissionPacketBlockers(payload, checkpointNow);
  const blockers = [
    ...runtime.blockers,
    ...packetBlockers,
  ];
  if (blockers.length) {
    return {
      status: "held",
      blockers: [...new Set(blockers)],
      story_id: String(payload.story_id || "").trim() || null,
      lifecycle_mutation_attempted: false,
      no_external_posting: true,
    };
  }
  const packet = payload.admission;
  const autonomous =
    packet.approval_type ===
    AUTONOMOUS_OFFICIAL_ADMISSION_TYPE;
  let runwayEnvelope = null;
  if (autonomousJit || governedRunwayRequired(payload, ctx)) {
    try {
      const loadRunway =
        ctx.loadGovernedRunwayEnvelope ||
        loadGovernedRunwayEnvelope;
      runwayEnvelope = await loadRunway({
        scheduledFor: packet.scheduled_for,
        payload,
        ctx,
      });
    } catch (error) {
      return {
        status: "held",
        blockers: [
          error?.code ||
            error?.message ||
            "runway_lock_artifact_required",
        ],
        story_id: String(payload.story_id).trim(),
        lifecycle_mutation_attempted: false,
        no_external_posting: true,
      };
    }
    const primaryJob =
      runwayEnvelope.lock.primary_admission_job || {};
    const admissionRunwayBlockers = [
      ...runwayEnvelope.blockers,
    ];
    if (
      String(runwayEnvelope.lock.primary?.story_id || "") !==
        String(payload.story_id).trim() ||
      Number(primaryJob.job_id) !== Number(job.id) ||
      String(primaryJob.idempotency_key || "") !==
        String(job.idempotency_key || "") ||
      String(primaryJob.candidate_revision_sha256 || "") !==
        String(payload.candidate_revision_sha256 || "") ||
      String(primaryJob.scheduled_for || "") !==
        new Date(packet.scheduled_for).toISOString()
    ) {
      admissionRunwayBlockers.push(
        "runway_primary_admission_job_binding_mismatch",
      );
    }
    if (
      autonomous &&
      !autonomousJit &&
      validRunwaySha256(
        packet.autonomous_publication_authority
          ?.runway_lock_sha256,
      ) !==
        validRunwaySha256(
          runwayEnvelope.lock.lock_sha256,
        )
    ) {
      admissionRunwayBlockers.push(
        "runway_autonomous_authority_lock_mismatch",
      );
    }
    if (admissionRunwayBlockers.length) {
      return {
        status: "held",
        blockers: [
          ...new Set(admissionRunwayBlockers),
        ],
        story_id: String(payload.story_id).trim(),
        runway_lock_sha256:
          runwayEnvelope.lock.lock_sha256,
        lifecycle_mutation_attempted: false,
        no_external_posting: true,
      };
    }
  }
  const admissionService = require(
    "./services/publication-admission"
  );
  const admitPublication = autonomous
    ? ctx.admitAutonomousOfficialPublication ||
      admissionService.admitAutonomousOfficialPublication
    : ctx.admitPublication || admissionService.admitPublication;
  const nowValue =
    typeof ctx.now === "function" ? ctx.now() : ctx.now;
  ctx.assertLeaseHealthy?.();
  const currentTime =
    nowValue === undefined
      ? new Date()
      : nowValue instanceof Date
        ? nowValue
        : new Date(nowValue);
  const dispatchJobSpec = {
    laneId: String(payload.lane_id || "").trim(),
    priority:
      payload.lane_id === "breaking_short"
        ? 6
        : payload.lane_id === "evergreen_short"
          ? 18
          : 28,
    maxAttempts: 3,
  };
  const commonAdmissionOptions = {
    repos: ctx.repos,
    storyId: String(payload.story_id).trim(),
    channelId:
      job.channel_id || process.env.CHANNEL || "pulse-gaming",
    platform: "youtube",
    scheduledFor: packet.scheduled_for,
    env,
    resolveMediaPath:
      ctx.resolveMediaPath ||
      (async (storedPath) => storedPath),
    channel:
      ctx.channel ||
      require("../channels").getChannel(
        job.channel_id ||
          process.env.CHANNEL ||
          "pulse-gaming",
      ),
    runwayLockSha256:
      runwayEnvelope?.lock?.lock_sha256 ||
      packet.autonomous_publication_authority
        ?.runway_lock_sha256 ||
      null,
    dispatchJob: dispatchJobSpec,
    transactionBoundaryCheck:
      ctx.transactionBoundaryCheck || null,
  };
  let result;
  if (autonomousJit) {
    const {
      materialiseAutonomousOfficialJitAdmissionPacket:
        defaultMaterialiseAutonomousOfficialJitAdmissionPacket,
    } = require(
      "./services/autonomous-official-jit-admission-packet"
    );
    const {
      runWithPublisherLease: defaultRunWithPublisherLease,
    } = require("./services/publisher-lock");
    const materialiseJitPacket =
      ctx.materialiseAutonomousOfficialJitAdmissionPacket ||
      defaultMaterialiseAutonomousOfficialJitAdmissionPacket;
    const runWithPublisherLease =
      ctx.runWithPublisherLease ||
      defaultRunWithPublisherLease;
    const workspaceRoot = path.resolve(
      String(
        ctx.autonomousWorkspaceRoot ||
          env.PULSE_AUTONOMOUS_WORKSPACE_ROOT ||
          process.cwd(),
      ),
    );
    const attemptOutputRoot = path.resolve(
      workspaceRoot,
      "output",
      "autonomous-jit",
      `admission-${Number(job.id) || "unknown"}`,
    );
    const leased = await runWithPublisherLease({
      leases: ctx.repos?.runtimeLeases,
      channelId: commonAdmissionOptions.channelId,
      operation: "autonomous_t75_jit_admission",
      metadata: {
        story_id: commonAdmissionOptions.storyId,
        scheduled_for: packet.scheduled_for,
        job_id: Number(job.id) || null,
      },
      task: async ({ assertHealthy, lease }) => {
        ctx.assertLeaseHealthy?.();
        assertHealthy();
        const jitResult = await materialiseJitPacket(
          {
            runway_lock: runwayEnvelope.lock,
            runway_binding: runwayEnvelope.lock.primary,
            eligibility_attestation:
              packet.autonomous_window_eligibility_attestation,
            preparation_manifest: packet.jit_preparation,
            repos: ctx.repos,
            env,
            workspace_root: workspaceRoot,
            attempt_output_root: attemptOutputRoot,
            publisher_lease: lease,
            resolve_media_path:
              commonAdmissionOptions.resolveMediaPath,
            channel: commonAdmissionOptions.channel,
          },
          {
            clock: () => new Date(currentTime),
            fileSystem: ctx.autonomousJitFileSystem,
            fetchCapture: ctx.autonomousJitFetchCapture,
          },
        );
        assertHealthy();
        ctx.assertLeaseHealthy?.();
        if (
          jitResult?.verdict !== "GREEN" ||
          !jitResult.admission_packet ||
          jitResult.role !== "PRIMARY" ||
          jitResult.runway_lock_sha256 !==
            runwayEnvelope.lock.lock_sha256 ||
          jitResult.admission_packet.authority
            ?.valid_until === undefined
        ) {
          const error = new Error(
            "autonomous_t75_jit_admission_packet_invalid",
          );
          error.code =
            "autonomous_t75_jit_admission_packet_invalid";
          throw error;
        }
        const admissionResult = await admitPublication({
          ...jitResult.admission_packet,
          repos: ctx.repos,
          env,
          clock: () => new Date(currentTime),
          resolveMediaPath:
            commonAdmissionOptions.resolveMediaPath,
          channel: commonAdmissionOptions.channel,
          dispatchJob: dispatchJobSpec,
          transactionBoundaryCheck:
            ctx.transactionBoundaryCheck || null,
          transactionCompletionCheck:
            ctx.transactionCompletionCheck || null,
        });
        assertHealthy();
        ctx.assertLeaseHealthy?.();
        return {
          admission_result: admissionResult,
          jit_preparation_sha256:
            packet.jit_preparation.preparation_sha256,
          eligibility_attestation_sha256:
            packet.autonomous_window_eligibility_attestation
              .attestation_sha256,
        };
      },
    });
    if (leased?.publish_dispatch_blocked) {
      return {
        status: "held",
        blockers: [
          leased.top_reason ||
            "autonomous_t75_publisher_lease_unavailable",
        ],
        story_id: String(payload.story_id).trim(),
        lifecycle_mutation_attempted: false,
        no_external_posting: true,
      };
    }
    result = leased?.admission_result;
  } else {
    result = await admitPublication(
      autonomous
        ? {
            ...commonAdmissionOptions,
            laneId: String(payload.lane_id || "").trim(),
            authority:
              packet.autonomous_publication_authority,
            requestFingerprint:
              packet.autonomous_publication_authority
                .request_fingerprint,
            publicationEvidence:
              packet.publication_evidence,
            clock: () => new Date(currentTime),
            transactionCompletionCheck:
              ctx.transactionCompletionCheck || null,
          }
        : {
            ...commonAdmissionOptions,
            actorId: packet.actor_id,
            reason: packet.reason,
            confirmationStoryId:
              packet.confirmation_story_id,
            evidence: packet.evidence,
            now: currentTime,
            outsideCadenceAuthorisation:
              packet.outside_cadence_authorisation || null,
          },
    );
  }
  ctx.assertLeaseHealthy?.();
  if (!result?.admitted) {
    return {
      status: "held",
      blockers: result?.blockers || [
        "canonical_publication_admission_held",
      ],
      story_id: String(payload.story_id).trim(),
      lifecycle_mutation_attempted: true,
      no_external_posting: true,
    };
  }
  const scheduledFor = new Date(
    result.scheduled_for || packet.scheduled_for,
  ).toISOString();
  const dispatchJob = result.dispatch_job || null;
  const exactDispatchBinding = dispatchJob?.payload || {};
  const dispatchBindingBlockers = [];
  if (
    exactDispatchBinding.story_id !==
    String(payload.story_id).trim()
  ) {
    dispatchBindingBlockers.push(
      "admitted_dispatch_story_id_mismatch",
    );
  }
  if (
    dispatchJob?.kind !==
      "verify_governed_youtube_release_t0" ||
    exactDispatchBinding.platform !== "youtube" ||
    exactDispatchBinding.scheduled_for !== scheduledFor ||
    exactDispatchBinding.dispatch_idempotency_key !==
      result.dispatch_idempotency_key ||
    exactDispatchBinding.request_fingerprint !==
      result.request_fingerprint
  ) {
    dispatchBindingBlockers.push(
      "admitted_dispatch_binding_mismatch",
    );
  }
  if (
    !Number.isInteger(
      Number(exactDispatchBinding.scheduled_event_id),
    ) ||
      Number(exactDispatchBinding.scheduled_event_id) <= 0
  ) {
    dispatchBindingBlockers.push(
      "admitted_dispatch_event_id_invalid",
    );
  }
  if (dispatchBindingBlockers.length) {
    return {
      status: "held",
      blockers: [...new Set(dispatchBindingBlockers)],
      story_id: String(payload.story_id).trim(),
      lifecycle_mutation_attempted: true,
      no_external_posting: true,
    };
  }
  return {
    status: "scheduled",
    story_id: result.story_id,
    lifecycle_state: result.lifecycle_state,
    scheduled_for: scheduledFor,
    dispatch_idempotency_key:
      result.dispatch_idempotency_key || null,
    dispatch_job_id: dispatchJob.id,
    dispatch_job_run_at: scheduledFor,
    lifecycle_mutation_attempted: true,
    no_external_posting: true,
  };
}

async function handleEngage(job, ctx) {
  const { engageRecent } = require("../engagement");
  ctx.assertLeaseHealthy?.();
  await engageRecent();
  ctx.assertLeaseHealthy?.();
  return { ok: true };
}

async function handleEngageFirstHour(job, ctx) {
  // Task 6 (2026-04-21): moved from daily_news.json to the
  // canonical SQLite store. The JSON file is a fallback mirror
  // that can be stale or absent on fresh deploys; reading it here
  // meant a valid-but-recent publish could get skipped because
  // the mirror hadn't been rewritten. Go straight to the DB.
  const db = require("./db");
  let news = [];
  try {
    news =
      db.useSqlite && db.useSqlite()
        ? db.getStoriesSync()
        : await db.getStories();
  } catch (err) {
    // If the DB read throws, fail the job so the runner records
    // the error and retries. Previously the JSON fallback
    // swallowed errors and silently returned an empty list,
    // which meant a broken read looked identical to "no stories"
    // — no alert, no retry. That's the exact silent-skip class
    // of bug the Task 6 brief is asking us to close.
    throw new Error(`engage_first_hour: DB read failed: ${err.message || err}`);
  }
  if (!Array.isArray(news)) news = [];
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const recent = news.filter((s) => {
    if (!s || !s.youtube_post_id) return false;
    // Sentinel guard — DUPE_* rows are pre-2026-04-19 block
    // markers, not real post ids.
    if (String(s.youtube_post_id).startsWith("DUPE_")) return false;
    if (s.publish_status !== "published") return false;
    const t = s.published_at || s.timestamp;
    return t && new Date(t).getTime() >= cutoff;
  });
  if (!recent.length) return { skipped: true };
  const { engageFirstHour } = require("../engagement");
  for (const story of recent) {
    ctx.assertLeaseHealthy?.();
    try {
      await engageFirstHour(story.youtube_post_id, story);
    } catch (err) {
      ctx.log && ctx.log(`engageFirstHour error ${story.id}: ${err.message}`);
    }
    ctx.assertLeaseHealthy?.();
  }
  return { processed: recent.length };
}

async function handleAnalytics(job, ctx) {
  const { runAnalytics } = require("../analytics");
  ctx.assertLeaseHealthy?.();
  await runAnalytics();
  ctx.assertLeaseHealthy?.();
  return { ok: true };
}

async function handleYouTubeAnalyticsSnapshot(job, ctx) {
  const {
    createYouTubeAnalyticsReadonlyAdapter,
  } = require("./services/youtube-analytics-readonly-adapter");
  const {
    createYouTubeAnalyticsIngestionService,
  } = require("./services/youtube-analytics-ingestion");
  const {
    classifyYouTubeAnalyticsSnapshotCompleteness,
    createLiveYouTubeAnalyticsQueryReports,
  } = require("./services/youtube-analytics-snapshot-jobs");
  const payload = job?.payload || {};
  const queryReports =
    ctx.queryYoutubeAnalyticsReports ||
    createLiveYouTubeAnalyticsQueryReports();
  const analyticsAdapter =
    createYouTubeAnalyticsReadonlyAdapter({
      queryReports,
    });
  const now =
    typeof ctx.now === "function"
      ? ctx.now
      : () => ctx.now || new Date();
  const ingestion = createYouTubeAnalyticsIngestionService({
    snapshots:
      ctx.repos?.youtubeAnalyticsExperimentSnapshots,
    analyticsAdapter,
    now,
  });
  ctx.assertLeaseHealthy?.();
  const result = await ingestion.ingestSnapshot({
    experimentId: payload.experimentId,
    channelId: payload.channelId,
    youtubeChannelId: payload.youtubeChannelId,
    storyId: payload.storyId,
    videoId: payload.videoId,
    snapshotWindow: payload.snapshotWindow,
    publishedAt: payload.publishedAt,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  ctx.assertLeaseHealthy?.();
  const completenessOutcome =
    classifyYouTubeAnalyticsSnapshotCompleteness({
      ingestionResult: result,
      job,
      snapshotWindow: payload.snapshotWindow,
    });
  if (completenessOutcome) {
    return {
      ...completenessOutcome,
      snapshot_window: payload.snapshotWindow,
      story_id: payload.storyId,
      video_id: payload.videoId,
      snapshot_id: null,
      no_external_posting: true,
      no_oauth_or_token_change: true,
    };
  }
  return {
    status: result.status,
    persisted: result.persisted === true,
    completeness_status: result.completeness_status,
    warnings: Array.isArray(result.warnings)
      ? result.warnings
      : [],
    snapshot_window: payload.snapshotWindow,
    story_id: payload.storyId,
    video_id: payload.videoId,
    snapshot_id: result.snapshot?.id || null,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handleStudioAnalyticsLoop(job, ctx) {
  // Studio v2 LLM-driven feedback loop. Reads metrics stamped by the
  // analytics handler, hands the window to Claude Haiku, writes
  // findings to data/analytics_findings.md and posts a Discord
  // summary. Wrapped here so a runtime error surfaces as a job
  // failure (with retry + Sentry capture) rather than a silent skip.
  const days = (job.payload && job.payload.days) || 14;
  const dry = !!(job.payload && job.payload.dry);
  const { main } = require("../tools/studio-v2-analytics-loop");
  ctx.assertLeaseHealthy?.();
  await main({ days, dry });
  ctx.assertLeaseHealthy?.();
  return { ok: true, days };
}

function renderBreakingDiscoveryMarkdown(report) {
  return [
    "# Pulse Gaming Breaking Story Discovery",
    "",
    `Generated: ${report.generated_at}`,
    `Verdict: ${report.verdict}`,
    `Story: ${report.story?.title || "unresolved"}`,
    `Story ID: ${report.story?.id || "unresolved"}`,
    `Breaking score: ${report.story?.breaking_score ?? 0}`,
    `Verified for planning: ${report.verified_for_production ? "yes" : "no"}`,
    `Downstream job: ${report.downstream_job?.kind || "none"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers?.length
      ? report.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "This discovery artefact grants no publication authority.",
    "",
  ].join("\n");
}

function renderEditorialEvidenceDiscoveryMarkdown(report) {
  return [
    "# Pulse Gaming Governed Editorial Evidence Discovery",
    "",
    `Generated: ${report.generated_at}`,
    `Verdict: ${report.verdict}`,
    `Story: ${report.story?.title || "unresolved"}`,
    `Story ID: ${report.story?.id || "unresolved"}`,
    `Verified for inventory: ${report.verified_for_inventory ? "yes" : "no"}`,
    `Downstream job: ${report.downstream_job?.kind || "none"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers?.length
      ? report.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "This evidence artefact creates no breaking classification or publication authority.",
    "",
  ].join("\n");
}

async function handleBreakingStoryDiscovery(job, ctx) {
  const payload = job?.payload || {};
  const {
    buildBreakingEventEnvelope,
  } = require("./services/breaking-event-ingress");
  ctx.assertLeaseHealthy?.();
  const editorialEvidenceOnly =
    job?.kind === "governed_editorial_evidence_discovery" ||
    payload.scope === "governed_editorial_inventory_supply";
  let editorialAssessment = null;
  let expectedEditorialFingerprint = null;
  let envelope;
  if (editorialEvidenceOnly) {
    const {
      assessGovernedEditorialEvidenceCandidate,
      governedEditorialEvidenceFingerprint,
    } = require("./services/governed-editorial-evidence-ingress");
    editorialAssessment =
      assessGovernedEditorialEvidenceCandidate({
        story: payload.story || {},
        latestDecision:
          payload.latest_governed_decision || {},
        now:
          payload.generated_at ||
          new Date().toISOString(),
        sourcePolicy:
          ctx.breakingSourcePolicy || undefined,
      });
    expectedEditorialFingerprint =
      governedEditorialEvidenceFingerprint({
        story: editorialAssessment.story,
        latest_decision:
          editorialAssessment.latest_decision,
      });
    const sourceUrl =
      editorialAssessment.story.source_url;
    const sanitised = buildBreakingEventEnvelope({
      story: {
        ...editorialAssessment.story,
        article_url: sourceUrl,
        url: sourceUrl,
        timestamp:
          editorialAssessment.story.published_at,
        source_name:
          editorialAssessment.story.source_name,
      },
      now: editorialAssessment.generated_at,
    });
    envelope = {
      schema_version:
        "pulse-governed-editorial-evidence-discovery-v1",
      generated_at: editorialAssessment.generated_at,
      verdict: editorialAssessment.eligible
        ? "DISCOVERY_ONLY"
        : "HOLD",
      blockers: editorialAssessment.blockers,
      story: sanitised.story,
      lane_id: "editorial_evidence",
      priority: "NORMAL",
      publish_authority: false,
      fingerprint_sha256:
        expectedEditorialFingerprint,
      latest_governed_decision:
        editorialAssessment.latest_decision,
      governed_source: editorialAssessment.source,
      safety: {
        breaking_classification_created: false,
        no_external_posting_authority: true,
        human_review_required: true,
      },
    };
  } else {
    envelope = buildBreakingEventEnvelope({
      story: payload.story || {},
      now: payload.generated_at || new Date().toISOString(),
    });
  }
  const suppliedFingerprint = String(
    editorialEvidenceOnly
      ? payload.evidence_fingerprint_sha256 || ""
      : payload.fingerprint_sha256 || "",
  ).toLowerCase();
  const blockers = editorialEvidenceOnly
    ? [...envelope.blockers]
    : envelope.blockers.filter(
        (blocker) =>
          blocker !== "primary_source_verification_required" &&
          blocker !== "source_evidence_sha256_required",
      );
  if (editorialEvidenceOnly) {
    if (!/^[a-f0-9]{64}$/.test(suppliedFingerprint)) {
      blockers.push(
        "governed_editorial_evidence_fingerprint_required",
      );
    } else if (
      suppliedFingerprint !== expectedEditorialFingerprint
    ) {
      blockers.push(
        "governed_editorial_evidence_fingerprint_mismatch",
      );
    }
    if (
      payload.schema_version !==
        "pulse-governed-editorial-evidence-ingress-v1" ||
      payload.requested_action !==
        "capture_governed_editorial_evidence" ||
      payload.publish_authority !== false ||
      payload.external_posting_authorised !== false ||
      payload.oauth_mutation_authorised !== false ||
      payload.human_review_required !== true
    ) {
      blockers.push(
        "governed_editorial_evidence_safety_envelope_required",
      );
    }
  } else if (
    suppliedFingerprint &&
    suppliedFingerprint !== envelope.fingerprint_sha256
  ) {
    blockers.push("breaking_ingress_fingerprint_mismatch");
  }
  const outDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        editorialEvidenceOnly
          ? "editorial-evidence"
          : "breaking-discovery",
        envelope.story.id || "unresolved",
      ),
  );
  await fs.ensureDir(outDir);

  const breakingSourcePolicy =
    ctx.breakingSourcePolicy ||
    require("./services/breaking-source-policy")
      .BREAKING_SOURCE_POLICY;
  let corroboratorDiscovery = null;
  let corroboratorDiscoveryJson = null;
  let corroboratorDiscoveryErrorCode = null;
  let corroboratorSearchIndex =
    ctx.breakingCorroboratorSearchIndex || null;
  if (!corroboratorSearchIndex && ctx.repos?.db) {
    try {
      corroboratorSearchIndex =
        require("./services/breaking-repository-search-index")
          .createBreakingRepositorySearchIndex({
            repos: ctx.repos,
          });
    } catch {
      corroboratorSearchIndex = null;
    }
  }
  if (corroboratorSearchIndex) {
    try {
      const discoverBreakingCorroborators =
        ctx.discoverBreakingCorroborators ||
        require("./services/breaking-corroborator-discovery")
          .discoverBreakingCorroborators;
      ctx.assertLeaseHealthy?.();
      corroboratorDiscovery =
        await discoverBreakingCorroborators({
          story: {
            id: envelope.story.id,
            title: envelope.story.title,
            subject_ids: envelope.story.subject_ids || [],
            source_candidates:
              envelope.story.source_candidates || [],
            primary_source_url:
              envelope.story.primary_source_url || null,
            article_url: envelope.story.article_url || null,
            url: envelope.story.discovery_url || null,
          },
          sourcePolicy: breakingSourcePolicy,
          searchIndex: corroboratorSearchIndex,
          maxCandidates:
            payload.corroborator_max_candidates,
          maxSearchResults:
            payload.corroborator_max_search_results,
          now: envelope.generated_at,
        });
      ctx.assertLeaseHealthy?.();
      corroboratorDiscoveryJson = path.join(
        outDir,
        "breaking_corroborator_discovery.json",
      );
      await fs.writeJson(
        corroboratorDiscoveryJson,
        corroboratorDiscovery,
        { spaces: 2 },
      );
    } catch (error) {
      corroboratorDiscoveryErrorCode =
        /^[A-Z][A-Z0-9_]{2,79}$/.test(
          String(error?.code || ""),
        )
          ? String(error.code)
          : "BREAKING_CORROBORATOR_DISCOVERY_FAILED";
    }
  }
  const sourceCandidates = [
    ...new Set(
      [
        ...(envelope.story.source_candidates || []),
        ...(corroboratorDiscovery?.candidate_urls || []),
        envelope.story.primary_source_url,
        envelope.story.article_url,
        envelope.story.discovery_url,
      ].filter(Boolean),
    ),
  ].slice(0, 8);

  const breakingEvidenceService = require(
    "./services/breaking-source-evidence",
  );
  const captureBreakingSourceEvidence =
    ctx.captureBreakingSourceEvidence ||
    breakingEvidenceService.captureBreakingSourceEvidence;
  const hasInjectedFetchCapture =
    typeof ctx.breakingFetchCapture === "function";
  const hasInjectedClaimExtractor =
    typeof ctx.breakingClaimExtractor === "function";
  let breakingFetchCapture = hasInjectedFetchCapture
    ? ctx.breakingFetchCapture
    : null;
  let breakingClaimExtractor = hasInjectedClaimExtractor
    ? ctx.breakingClaimExtractor
    : null;
  if (!hasInjectedFetchCapture && !hasInjectedClaimExtractor) {
    const client = resolveJobEditorialClient(ctx);
    if (client) {
      const {
        editorialModelFor,
      } = require("./services/governed-editorial-client");
      const {
        createAnthropicBreakingClaimExtractor,
        createSafeHttpsFetchCapture,
      } = require("./services/breaking-source-adapters");
      const claimExtractorFactory =
        ctx.createBreakingClaimExtractor ||
        createAnthropicBreakingClaimExtractor;
      const fetchCaptureFactory =
        ctx.createBreakingFetchCapture ||
        createSafeHttpsFetchCapture;
      const requestedModel = String(
        payload.generator_model ||
          process.env.PULSE_BREAKING_EVIDENCE_MODEL ||
          process.env.ANTHROPIC_MODEL ||
          "claude-haiku-4-5-20251001",
      ).trim();
      breakingClaimExtractor =
        claimExtractorFactory({
          client,
          model: editorialModelFor(client, requestedModel),
        });
      breakingFetchCapture = fetchCaptureFactory({
        archiveRoot: path.join(outDir, "source-bytes"),
      });
    }
  }
  let sourceEvidence;
  let captureErrorCode = null;
  const defaultCaptureDeadlineMs = editorialEvidenceOnly
    ? 90_000
    : 30_000;
  const maximumCaptureDeadlineMs = editorialEvidenceOnly
    ? 120_000
    : 45_000;
  const configuredDeadlineMs = Number(
    payload.capture_deadline_ms ||
      (editorialEvidenceOnly
        ? process.env
            .PULSE_EDITORIAL_EVIDENCE_CAPTURE_DEADLINE_MS
        : null) ||
      process.env.PULSE_BREAKING_CAPTURE_DEADLINE_MS ||
      defaultCaptureDeadlineMs,
  );
  const captureDeadlineMs =
    Number.isSafeInteger(configuredDeadlineMs) &&
    configuredDeadlineMs >= 1_000 &&
    configuredDeadlineMs <= maximumCaptureDeadlineMs
      ? configuredDeadlineMs
      : defaultCaptureDeadlineMs;
  ctx.assertLeaseHealthy?.();
  try {
    let deadlineHandle = null;
    const deadline = new Promise((_, reject) => {
      deadlineHandle = setTimeout(() => {
        const error = new Error(
          "breaking_source_evidence_capture_deadline_exceeded",
        );
        error.code =
          "BREAKING_SOURCE_EVIDENCE_CAPTURE_DEADLINE_EXCEEDED";
        reject(error);
      }, captureDeadlineMs);
      deadlineHandle.unref?.();
    });
    try {
      sourceEvidence = await Promise.race([
        captureBreakingSourceEvidence({
          story: {
            id: envelope.story.id,
            title: envelope.story.title,
            subject_ids: envelope.story.subject_ids || [],
            source_candidates: sourceCandidates,
            primary_source_url:
              envelope.story.primary_source_url || null,
            article_url: envelope.story.article_url || null,
            url: envelope.story.discovery_url || null,
          },
          sourcePolicy: breakingSourcePolicy,
          fetchCapture: breakingFetchCapture,
          extractClaims: breakingClaimExtractor,
          now: envelope.generated_at,
          stopAfterOfficialConfirmation: true,
          stopAfterEvidenceConfirmation: true,
        }),
        deadline,
      ]);
    } finally {
      clearTimeout(deadlineHandle);
    }
  } catch (error) {
    captureErrorCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(
      String(error?.code || ""),
    )
      ? String(error.code)
      : "BREAKING_SOURCE_EVIDENCE_CAPTURE_FAILED";
    sourceEvidence =
      breakingEvidenceService.buildFailedBreakingSourceEvidencePacket(
        {
          storyId: envelope.story.id,
          now: envelope.generated_at,
          blockers: [captureErrorCode.toLowerCase()],
        },
      );
  }
  ctx.assertLeaseHealthy?.();
  const evidenceValidation =
    breakingEvidenceService.validateBreakingSourceEvidencePacket(
      sourceEvidence,
    );
  if (!evidenceValidation.valid) {
    blockers.push(...evidenceValidation.blockers);
  }
  if (sourceEvidence?.verified_for_planning !== true) {
    blockers.push(
      ...(Array.isArray(sourceEvidence?.blockers)
        ? sourceEvidence.blockers
        : ["fresh_breaking_source_evidence_required"]),
    );
  }
  const plannerEvidence =
    sourceEvidence?.planner_evidence &&
    typeof sourceEvidence.planner_evidence === "object"
      ? sourceEvidence.planner_evidence
      : {};
  const evidenceSha256 = String(
    sourceEvidence?.packet_sha256 ||
      sourceEvidence?.source_evidence_sha256 ||
      "",
  ).toLowerCase();
  if (
    sourceEvidence?.verified_for_planning === true &&
    !/^[a-f0-9]{64}$/.test(evidenceSha256)
  ) {
    blockers.push("fresh_source_evidence_sha256_required");
  }

  let persistedEvidence = null;
  if (evidenceValidation.valid) {
    try {
      persistedEvidence =
        await breakingEvidenceService.persistBreakingSourceEvidencePacket({
          packet: sourceEvidence,
          outputDir: outDir,
        });
    } catch (error) {
      captureErrorCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(
        String(error?.code || ""),
      )
        ? String(error.code)
        : "BREAKING_SOURCE_EVIDENCE_PERSIST_FAILED";
      blockers.push("breaking_source_evidence_persist_failed");
    }
  }
  if (
    sourceEvidence?.verified_for_planning === true &&
    !persistedEvidence
  ) {
    blockers.push("persisted_breaking_source_evidence_required");
  }

  let downstreamJob = null;
  if (
    sourceEvidence?.verified_for_planning === true &&
    evidenceValidation.valid &&
    persistedEvidence &&
    blockers.length === 0 &&
    !blockers.includes("breaking_ingress_fingerprint_mismatch") &&
    ctx.repos?.jobs?.enqueue
  ) {
    if (editorialEvidenceOnly) {
      const canonicalStory =
        ctx.repos?.stories?.get?.(envelope.story.id) ||
        payload.story ||
        {};
      downstreamJob = ctx.repos.jobs.enqueue({
        kind: "prepare_editorial_inventory",
        channel_id:
          job.channel_id ||
          process.env.CHANNEL ||
          "pulse-gaming",
        story_id: envelope.story.id,
        payload: {
          story: editorialInventoryStoryFromCanonical(
            canonicalStory,
            {
              primary_source_url:
                plannerEvidence.primary_source_url,
              verification_status:
                plannerEvidence.verification_status,
              generated_at: envelope.generated_at,
            },
          ),
          breaking_source_evidence: {
            path: persistedEvidence.path,
            file_sha256:
              persistedEvidence.file_sha256,
            canonical_sha256: evidenceSha256,
          },
          governed_editorial_decision:
            editorialAssessment?.latest_decision || null,
          governed_editorial_evidence_fingerprint_sha256:
            expectedEditorialFingerprint,
          publish_authority: false,
          human_review_required: true,
          live_publish_enabled: false,
        },
        priority: 22,
        requires_gpu: false,
        max_attempts: 2,
        idempotency_key:
          `editorial-inventory:${envelope.story.id}:` +
          evidenceSha256,
      });
    } else {
      downstreamJob = ctx.repos.jobs.enqueue({
        kind: "hunt",
        channel_id:
          job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          reason: "governed_breaking_event",
          breaking_story_id: envelope.story.id,
          breaking_event_fingerprint_sha256:
            envelope.fingerprint_sha256,
          verification_status:
            plannerEvidence.verification_status || null,
          confirmation_basis:
            plannerEvidence.confirmation_basis || null,
          primary_source_url:
            plannerEvidence.primary_source_url || null,
          source_evidence_sha256:
            evidenceSha256,
          source_evidence_path: persistedEvidence.path,
          source_evidence_file_sha256:
            persistedEvidence.file_sha256,
          corroborator_discovery_sha256:
            corroboratorDiscovery?.discovery_sha256 || null,
          publish_authority: false,
        },
        priority: 4,
        requires_gpu: false,
        max_attempts: 3,
        idempotency_key:
          `breaking-rehunt:${envelope.story.id}:${envelope.fingerprint_sha256}`,
      });
    }
  }

  const report = {
    ...envelope,
    verdict:
      blockers.length > 0
        ? "HOLD"
        : editorialEvidenceOnly
          ? "READY_FOR_INVENTORY"
          : "READY_FOR_PLANNING",
    verified_for_production:
      sourceEvidence?.verified_for_planning === true &&
      blockers.length === 0,
    verified_for_inventory:
      editorialEvidenceOnly &&
      sourceEvidence?.verified_for_planning === true &&
      blockers.length === 0,
    blockers: [...new Set(blockers)],
    source_evidence: sourceEvidence,
    source_evidence_validation: evidenceValidation,
    source_evidence_persistence: persistedEvidence,
    corroborator_discovery: corroboratorDiscovery,
    corroborator_discovery_path: corroboratorDiscoveryJson,
    corroborator_discovery_error_code:
      corroboratorDiscoveryErrorCode,
    capture_error_code: captureErrorCode,
    capture_deadline_ms: captureDeadlineMs,
    downstream_job: downstreamJob
      ? {
          id: downstreamJob.id,
          kind: downstreamJob.kind,
          idempotency_key: downstreamJob.idempotency_key,
        }
      : null,
  };
  const sourceEvidenceJson = persistedEvidence?.path || null;
  const reportJson = path.join(
    outDir,
    editorialEvidenceOnly
      ? "governed_editorial_evidence.json"
      : "breaking_event.json",
  );
  const reportMarkdown = path.join(
    outDir,
    editorialEvidenceOnly
      ? "governed_editorial_evidence.md"
      : "breaking_event.md",
  );
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(
    reportMarkdown,
    editorialEvidenceOnly
      ? renderEditorialEvidenceDiscoveryMarkdown(report)
      : renderBreakingDiscoveryMarkdown(report),
    "utf8",
  );
  ctx.assertLeaseHealthy?.();
  ctx.log?.(
    `[${
      editorialEvidenceOnly
        ? "editorial-evidence"
        : "breaking-ingress"
    }] story=${envelope.story.id || "unresolved"} verdict=${report.verdict}`,
  );
  return {
    ok: true,
    verdict: report.verdict,
    downstream_job_id: downstreamJob?.id || null,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    source_evidence_json: sourceEvidenceJson,
    corroborator_discovery_json: corroboratorDiscoveryJson,
    blockers: report.blockers,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handlePrepareEditorialInventory(job, ctx) {
  const payload = job?.payload || {};
  const story =
    payload.story &&
    typeof payload.story === "object" &&
    !Array.isArray(payload.story)
      ? structuredClone(payload.story)
      : {};
  const evidence =
    payload.breaking_source_evidence &&
    typeof payload.breaking_source_evidence === "object" &&
    !Array.isArray(payload.breaking_source_evidence)
      ? structuredClone(payload.breaking_source_evidence)
      : {};
  const evidenceRevisionSha256 = String(
    evidence.canonical_sha256 || "",
  )
    .trim()
    .toLowerCase();
  const repoRoot = path.resolve(
    payload.root_dir || path.join(__dirname, ".."),
  );
  const defaultOutputDir = path.join(
    repoRoot,
    "output",
    "editorial-inventory",
    safeOutputSegment(story.id || job?.story_id),
    "revisions",
    /^[a-f0-9]{64}$/.test(evidenceRevisionSha256)
      ? evidenceRevisionSha256
      : "unresolved",
  );
  const requestedOutputDir = path.resolve(
    payload.out_dir || defaultOutputDir,
  );
  const relativeOutput = path.relative(repoRoot, requestedOutputDir);
  const outputDir =
    relativeOutput !== ".." &&
    !relativeOutput.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeOutput)
      ? requestedOutputDir
      : defaultOutputDir;
  const blockers = [];
  for (const [field, code] of [
    [story.id, "editorial_inventory_story_id_required"],
    [story.title, "editorial_inventory_story_title_required"],
    [story.franchise, "editorial_inventory_story_franchise_required"],
    [story.platform, "editorial_inventory_story_platform_required"],
  ]) {
    if (!String(field || "").trim()) blockers.push(code);
  }
  if (
    String(story.verification_status || "").toUpperCase() !==
    "CONFIRMED"
  ) {
    blockers.push(
      "editorial_inventory_story_confirmation_required",
    );
  }
  if (!String(evidence.path || "").trim()) {
    blockers.push("breaking_source_evidence_path_required");
  }
  if (
    !/^[a-f0-9]{64}$/.test(
      String(evidence.file_sha256 || "").toLowerCase(),
    )
  ) {
    blockers.push(
      "breaking_source_evidence_file_sha256_required",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(evidenceRevisionSha256)) {
    blockers.push(
      "breaking_source_evidence_canonical_sha256_required",
    );
  }
  if (
    payload.publish_authority !== false ||
    payload.human_review_required !== true
  ) {
    blockers.push(
      "editorial_inventory_nonpublication_safety_envelope_required",
    );
  }
  if (outputDir !== requestedOutputDir) {
    blockers.push("editorial_inventory_output_outside_root");
  }

  const generatedAt =
    payload.now ||
    payload.generated_at ||
    story.published_at ||
    new Date().toISOString();
  const env = ctx.env || process.env;
  const killSwitchEngaged =
    /^(1|true|yes|on)$/i.test(
      String(env.PULSE_EMERGENCY_KILL_SWITCH || ""),
    ) ||
    /^(1|true|yes|on)$/i.test(
      String(env.PULSE_KILL_SWITCH || ""),
    );
  const safety = {
    schema_version:
      "pulse-autonomous-local-proof-job-safety-v1",
    mode: "LOCAL_PROOF",
    scope:
      "governed_editorial_inventory_draft_materialisation",
    local_proof_only: true,
    human_review_required: true,
    publish_authority: false,
    external_posting_authorised: false,
    network_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    scheduler_authority_created: false,
    auto_publish: false,
    guarded_live_dispatch_enabled: false,
    emergency_kill_switch_engaged: killSwitchEngaged,
  };

  let workflow = null;
  if (blockers.length === 0) {
    const runGovernedEditorialInventoryWorkflow =
      ctx.runGovernedEditorialInventoryWorkflow ||
      require("./services/governed-editorial-inventory-workflow")
        .runGovernedEditorialInventoryWorkflow;
    try {
      ctx.assertLeaseHealthy?.();
      workflow =
        await runGovernedEditorialInventoryWorkflow({
          story,
          breaking_source_evidence: evidence,
          safety,
          output_dir: outputDir,
          root_dir: repoRoot,
          advertiser_safety:
            payload.advertiser_safety || undefined,
          now: generatedAt,
        });
      ctx.assertLeaseHealthy?.();
    } catch (error) {
      blockers.push(
        ...(
          Array.isArray(error?.blockers) &&
          error.blockers.length
            ? error.blockers
            : ["governed_editorial_inventory_workflow_failed"]
        ),
      );
    }
  }
  const workflowRevisionSha256 = String(
    workflow?.report?.workflow_revision_sha256 || "",
  )
    .trim()
    .toLowerCase();
  if (
    workflow?.verdict === "READY" &&
    !/^[a-f0-9]{64}$/.test(workflowRevisionSha256)
  ) {
    blockers.push(
      "governed_editorial_inventory_workflow_revision_sha256_required",
    );
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  const status =
    workflow?.verdict === "READY" &&
    uniqueBlockers.length === 0
      ? "READY"
      : "HOLD";
  const followupJobs = [];
  if (
    status === "READY" &&
    ctx.repos?.jobs?.enqueue
  ) {
    const channelId =
      job.channel_id ||
      process.env.CHANNEL ||
      "pulse-gaming";
    const commonPayload = {
      scheduler_profile: "governed_multi_lane",
      governed_multi_lane: true,
      planning_only: true,
      inventory_root_dir: outputDir,
      inventory_allowed_roots: [outputDir],
      inventory_trigger_story_id:
        String(story.id || job?.story_id || "").trim(),
      inventory_evidence_revision_sha256:
        evidenceRevisionSha256,
      inventory_workflow_revision_sha256:
        workflowRevisionSha256,
      live_publish_enabled: false,
      publish_authority: false,
      human_admission_required: true,
      human_review_required: true,
    };
    for (const definition of [
      {
        kind: "evergreen_candidate_builder",
        priority: 20,
      },
      {
        kind: "plan_weekly_longform",
        priority: 30,
      },
    ]) {
      const request = {
        kind: definition.kind,
        channel_id: channelId,
        payload: { ...commonPayload },
        priority: definition.priority,
        requires_gpu: false,
        max_attempts: 3,
        idempotency_key:
          `inventory-ready:${commonPayload.inventory_trigger_story_id}:` +
          `${workflowRevisionSha256}:${definition.kind}`,
      };
      const queued = ctx.repos.jobs.enqueue(request);
      followupJobs.push({
        id: queued?.id || null,
        kind: definition.kind,
        idempotency_key: request.idempotency_key,
      });
    }
  }
  await fs.ensureDir(outputDir);
  const handlerReport = {
    schema_version:
      "pulse-governed-editorial-inventory-job-v1",
    generated_at: new Date(generatedAt).toISOString(),
    mode: "LOCAL_PROOF",
    status,
    story_id: String(story.id || job?.story_id || "").trim() || null,
    evidence_revision_sha256:
      /^[a-f0-9]{64}$/.test(evidenceRevisionSha256)
        ? evidenceRevisionSha256
        : null,
    blockers: uniqueBlockers,
    workflow_report:
      workflow?.paths?.report || null,
    workflow_revision_sha256:
      workflowRevisionSha256 || null,
    inventory_registry:
      workflow?.paths?.inventory || null,
    followup_jobs: followupJobs,
    safety: {
      network_used: false,
      database_mutated: followupJobs.length > 0,
      database_jobs_enqueued: followupJobs.length,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
      human_review_required: true,
    },
  };
  const reportJson = path.join(
    outputDir,
    "editorial-inventory-job.json",
  );
  const reportMarkdown = path.join(
    outputDir,
    "editorial-inventory-job.md",
  );
  await fs.writeJson(reportJson, handlerReport, { spaces: 2 });
  await fs.writeFile(
    reportMarkdown,
    [
      "# Pulse Editorial Inventory Job",
      "",
      `Generated: ${handlerReport.generated_at}`,
      `Status: ${status}`,
      `Story ID: ${handlerReport.story_id || "unresolved"}`,
      "",
      "## Blockers",
      "",
      ...(uniqueBlockers.length
        ? uniqueBlockers.map((blocker) => `- ${blocker}`)
        : ["- None"]),
      "",
      "This job creates local editorial evidence only and grants no publishing authority.",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    status,
    story_id: handlerReport.story_id,
    evidence_revision_sha256:
      handlerReport.evidence_revision_sha256,
    blockers: uniqueBlockers,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    workflow_report_json:
      workflow?.paths?.report || null,
    inventory_registry_json:
      workflow?.paths?.inventory || null,
    followup_jobs: followupJobs,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
    no_database_mutation: followupJobs.length === 0,
  };
}

async function handleGovernedEditorialEvidenceBackfill(job, ctx) {
  const payload = job?.payload || {};
  const generatedAt = new Date(
    payload.now || new Date().toISOString(),
  );
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error(
      "governed_editorial_evidence_backfill_time_invalid",
    );
  }
  const now = generatedAt.toISOString();
  const blockers = [];
  if (
    payload.scheduler_profile !== "governed_multi_lane" ||
    payload.governed_multi_lane !== true ||
    payload.planning_only !== true ||
    payload.live_publish_enabled !== false ||
    payload.publish_authority !== false ||
    payload.human_admission_required !== true ||
    payload.human_review_required !== true
  ) {
    blockers.push(
      "governed_editorial_evidence_backfill_safety_envelope_required",
    );
  }
  if (!ctx.repos?.jobs?.enqueue) {
    blockers.push(
      "governed_editorial_evidence_backfill_jobs_repository_required",
    );
  }

  let stories = Array.isArray(payload.stories)
    ? payload.stories
    : null;
  if (!stories) {
    if (!ctx.repos?.db?.prepare) {
      blockers.push(
        "governed_editorial_evidence_backfill_database_required",
      );
      stories = [];
    } else {
      const cutoff = new Date(
        generatedAt.getTime() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      try {
        stories = ctx.repos.db
          .prepare(`
            SELECT *
            FROM stories
            WHERE datetime(COALESCE(published_at, timestamp, created_at))
                    >= datetime(?)
              AND datetime(COALESCE(published_at, timestamp, created_at))
                    <= datetime(?)
              AND COALESCE(youtube_post_id, '') = ''
              AND COALESCE(publish_status, '') NOT IN (
                'failed',
                'canonical_projection_consumed'
              )
            ORDER BY
              COALESCE(breaking_score, 0) DESC,
              COALESCE(score, 0) DESC,
              datetime(COALESCE(published_at, timestamp, created_at)) DESC
            LIMIT 250
          `)
          .all(cutoff, now);
      } catch {
        blockers.push(
          "governed_editorial_evidence_backfill_story_query_failed",
        );
        stories = [];
      }
    }
  }
  let latestDecisions = Array.isArray(
    payload.latest_decisions,
  )
    ? payload.latest_decisions
    : null;
  if (!latestDecisions) {
    if (!ctx.repos?.scoring?.latest) {
      blockers.push(
        "governed_editorial_evidence_backfill_scoring_repository_required",
      );
      latestDecisions = [];
    } else {
      latestDecisions = stories
        .map((story) =>
          ctx.repos.scoring.latest(
            String(story?.id || "").trim(),
          ),
        )
        .filter(Boolean);
    }
  }
  const evidenceRefreshBucketHours = 6;
  const recentAttemptWindowHours = 5;
  let recentAttemptedStoryIds = Array.isArray(
    payload.recent_attempted_story_ids,
  )
    ? payload.recent_attempted_story_ids
    : null;
  const operationalWarnings = [];
  if (!recentAttemptedStoryIds) {
    recentAttemptedStoryIds = [];
    if (ctx.repos?.db?.prepare) {
      const recentAttemptCutoff = new Date(
        generatedAt.getTime() -
          recentAttemptWindowHours * 60 * 60 * 1000,
      ).toISOString();
      try {
        recentAttemptedStoryIds = ctx.repos.db
          .prepare(`
            SELECT DISTINCT story_id
            FROM jobs
            WHERE kind = 'governed_editorial_evidence_discovery'
              AND COALESCE(story_id, '') <> ''
              AND (
                status IN ('pending', 'claimed', 'running')
                OR (
                  datetime(COALESCE(updated_at, created_at))
                        >= datetime(?)
                  AND datetime(COALESCE(updated_at, created_at))
                        <= datetime(?)
                )
              )
            ORDER BY story_id ASC
          `)
          .all(recentAttemptCutoff, now)
          .map((row) => String(row?.story_id || "").trim())
          .filter(Boolean);
      } catch {
        operationalWarnings.push(
          "governed_editorial_evidence_recent_attempt_query_failed",
        );
      }
    }
  }

  const {
    enqueueGovernedEditorialEvidence,
    selectGovernedEditorialEvidenceBackfill,
  } = require("./services/governed-editorial-evidence-ingress");
  const selectionInput = {
    stories,
    latestDecisions,
    recentAttemptedStoryIds,
    requestedLimit: payload.limit,
    now,
    sourcePolicy:
      ctx.breakingSourcePolicy || undefined,
  };
  const selection =
    selectGovernedEditorialEvidenceBackfill(selectionInput);
  const queued = [];
  const enqueueAttempts = [];
  const attemptedStoryIds = new Set();
  const rotationExclusions = new Set(
    recentAttemptedStoryIds
      .map((storyId) => String(storyId || "").trim())
      .filter(Boolean),
  );
  const selectionPasses = [
    {
      pass: 1,
      requested_limit: selection.limit,
      selected_story_ids: selection.selected.map(
        (item) => item.story.id,
      ),
      summary: selection.summary,
    },
  ];
  if (blockers.length === 0) {
    let currentSelection = selection;
    while (
      queued.length < selection.limit &&
      currentSelection.selected.length > 0
    ) {
      for (const selected of currentSelection.selected) {
        const storyId = String(selected.story?.id || "").trim();
        if (!storyId || attemptedStoryIds.has(storyId)) continue;
        attemptedStoryIds.add(storyId);
        rotationExclusions.add(storyId);
        const result = enqueueGovernedEditorialEvidence({
          story: selected.story,
          latestDecision: selected.latest_decision,
          jobs: ctx.repos.jobs,
          now,
          attemptRevisionHours:
            evidenceRefreshBucketHours,
          sourcePolicy:
            ctx.breakingSourcePolicy || undefined,
        });
        enqueueAttempts.push({
          story_id: storyId,
          source_id: selected.source_id,
          queued: result.queued === true,
          reason: result.reason || null,
          fingerprint_sha256:
            result.fingerprint_sha256 || null,
          attempt_revision_sha256:
            result.attempt_revision_sha256 || null,
          job_id: result.job?.id || null,
          idempotency_key:
            result.job?.idempotency_key || null,
        });
        if (result.queued) {
          queued.push({
            id: result.job?.id || null,
            story_id: storyId,
            source_id: selected.source_id,
            idempotency_key:
              result.job?.idempotency_key || null,
          });
        }
        if (queued.length >= selection.limit) break;
      }
      if (queued.length >= selection.limit) break;
      const nextSelection =
        selectGovernedEditorialEvidenceBackfill({
          ...selectionInput,
          recentAttemptedStoryIds: [...rotationExclusions],
          requestedLimit: selection.limit - queued.length,
        });
      if (nextSelection.selected.length === 0) break;
      selectionPasses.push({
        pass: selectionPasses.length + 1,
        requested_limit: nextSelection.limit,
        selected_story_ids: nextSelection.selected.map(
          (item) => item.story.id,
        ),
        summary: nextSelection.summary,
      });
      currentSelection = nextSelection;
    }
  }

  const alreadyScheduledCount = enqueueAttempts.filter(
    (attempt) =>
      attempt.reason ===
      "governed_editorial_evidence_already_scheduled",
  ).length;
  const status =
    blockers.length > 0
      ? "HOLD"
      : queued.length > 0
        ? "READY"
        : enqueueAttempts.length > 0 &&
            alreadyScheduledCount === enqueueAttempts.length
          ? "ALREADY_SCHEDULED"
          : "HOLD";
  const outDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "editorial-evidence-backfill",
        "current",
      ),
  );
  await fs.ensureDir(outDir);
  const report = {
    schema_version:
      "pulse-governed-editorial-evidence-backfill-job-v1",
    generated_at: now,
    mode: "LOCAL_PROOF",
    status,
    blockers: [...new Set(blockers)].sort(),
    operational_warnings: [
      ...new Set(operationalWarnings),
    ].sort(),
    rotation: {
      evidence_refresh_bucket_hours:
        evidenceRefreshBucketHours,
      recent_attempt_window_hours:
        recentAttemptWindowHours,
      recent_attempted_story_ids: [
        ...new Set(recentAttemptedStoryIds),
      ].sort(),
      enqueue_attempted_story_ids: [
        ...attemptedStoryIds,
      ].sort(),
    },
    selection,
    selection_passes: selectionPasses,
    enqueue_attempts: enqueueAttempts,
    enqueue_summary: {
      attempted_count: enqueueAttempts.length,
      already_scheduled_count: alreadyScheduledCount,
      queued_count: queued.length,
      queue_limit: selection.limit,
    },
    queued,
    safety: {
      database_jobs_enqueued: queued.length,
      breaking_classification_created: false,
      external_posting_authorised: false,
      oauth_mutation_authorised: false,
      publish_authority_created: false,
    },
  };
  const reportJson = path.join(
    outDir,
    "governed_editorial_evidence_backfill.json",
  );
  const reportMarkdown = path.join(
    outDir,
    "governed_editorial_evidence_backfill.md",
  );
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(
    reportMarkdown,
    [
      "# Pulse Governed Editorial Evidence Backfill",
      "",
      `Generated: ${now}`,
      `Status: ${status}`,
      `Selected: ${selection.summary.selected_count}`,
      `Attempted: ${enqueueAttempts.length}`,
      `Already scheduled: ${alreadyScheduledCount}`,
      `Queued: ${queued.length}`,
      `Deferred: ${selection.summary.deferred_count}`,
      "",
      "## Blockers",
      "",
      ...(report.blockers.length
        ? report.blockers.map((blocker) => `- ${blocker}`)
        : ["- None"]),
      "",
      "This bounded backfill creates evidence-capture jobs only. It grants no publication authority.",
      "",
    ].join("\n"),
    "utf8",
  );
  ctx.log?.(
    `[editorial-backfill] status=${status} selected=${selection.summary.selected_count} queued=${queued.length}`,
  );
  return {
    status,
    queued_count: queued.length,
    queued,
    enqueue_attempts: enqueueAttempts,
    enqueue_summary: report.enqueue_summary,
    blockers: report.blockers,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handleReconcileEditorialInventory(job, ctx) {
  const payload = job?.payload || {};
  const repoRoot = path.resolve(
    payload.root_dir || path.join(__dirname, ".."),
  );
  const contained = (candidate) => {
    const relative = path.relative(repoRoot, candidate);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };
  const breakingDiscoveryRoot = path.resolve(
    payload.breaking_discovery_root ||
      path.join(repoRoot, "output", "breaking-discovery"),
  );
  const inventoryRoot = path.resolve(
    payload.inventory_root_dir ||
      path.join(repoRoot, "output", "editorial-inventory"),
  );
  const requestedOutputDir = path.resolve(
    payload.out_dir ||
      path.join(
        repoRoot,
        "output",
        "editorial-inventory-reconciliation",
        "current",
      ),
  );
  const outputDir = contained(requestedOutputDir)
    ? requestedOutputDir
    : path.join(
        repoRoot,
        "output",
        "editorial-inventory-reconciliation",
        "current",
      );
  const generatedAt = new Date(
    payload.now || new Date().toISOString(),
  ).toISOString();
  const blockers = [];
  if (
    payload.scheduler_profile !== "governed_multi_lane" ||
    payload.governed_multi_lane !== true ||
    payload.planning_only !== true ||
    payload.live_publish_enabled !== false ||
    payload.publish_authority !== false ||
    payload.human_admission_required !== true ||
    payload.human_review_required !== true
  ) {
    blockers.push(
      "governed_editorial_inventory_reconciliation_safety_envelope_required",
    );
  }
  if (!contained(breakingDiscoveryRoot)) {
    blockers.push("breaking_discovery_root_outside_repository");
  }
  if (!contained(inventoryRoot)) {
    blockers.push("editorial_inventory_root_outside_repository");
  }
  if (!contained(requestedOutputDir)) {
    blockers.push(
      "editorial_inventory_reconciliation_output_outside_repository",
    );
  }
  if (
    !ctx.repos?.jobs?.enqueue ||
    !ctx.repos?.stories?.get
  ) {
    blockers.push(
      "editorial_inventory_reconciliation_repositories_required",
    );
  }

  let inventoryReport = null;
  let reconciliation = null;
  if (blockers.length === 0) {
    await fs.ensureDir(breakingDiscoveryRoot);
    await fs.ensureDir(inventoryRoot);
    const scanGovernedEditorialInventory =
      ctx.scanGovernedEditorialInventory ||
      require("./services/governed-editorial-inventory-registry")
        .scanGovernedEditorialInventory;
    const reconcileBreakingEditorialInventory =
      ctx.reconcileBreakingEditorialInventory ||
      require("./services/breaking-editorial-inventory-reconciliation")
        .reconcileBreakingEditorialInventory;
    ctx.assertLeaseHealthy?.();
    inventoryReport = await scanGovernedEditorialInventory({
      rootDir: inventoryRoot,
      allowedRoots: [repoRoot],
      maximumManifests: payload.maximum_inventory_manifests,
    });
    ctx.assertLeaseHealthy?.();
    reconciliation =
      await reconcileBreakingEditorialInventory({
        breakingDiscoveryRoot,
        governedInventoryReport: inventoryReport,
        maximumEntries: payload.maximum_entries,
        maximumEvidenceFiles:
          payload.maximum_evidence_files,
        maximumDepth: payload.maximum_depth,
        now: generatedAt,
      });
    ctx.assertLeaseHealthy?.();
    if (
      reconciliation?.schema_version !==
        "pulse-breaking-editorial-inventory-reconciliation-v1" ||
      reconciliation?.mode !== "LOCAL_PROOF" ||
      !Array.isArray(reconciliation?.work_items) ||
      reconciliation?.safety?.read_only !== true ||
      reconciliation?.safety?.network_used !== false ||
      reconciliation?.safety?.database_mutated !== false ||
      reconciliation?.safety?.oauth_mutated !== false ||
      reconciliation?.safety?.platform_contacted !== false ||
      reconciliation?.safety?.publish_authority_created !== false
    ) {
      blockers.push(
        "breaking_editorial_inventory_reconciliation_report_invalid",
      );
      reconciliation = null;
    }
  }

  const queued = [];
  const held = [];
  for (const item of reconciliation?.work_items || []) {
    const storyId = String(item?.story_id || "").trim();
    const evidence =
      item?.breaking_source_evidence &&
      typeof item.breaking_source_evidence === "object" &&
      !Array.isArray(item.breaking_source_evidence)
        ? item.breaking_source_evidence
        : {};
    const fileSha256 = String(
      evidence.file_sha256 || "",
    ).toLowerCase();
    const canonicalSha256 = String(
      evidence.canonical_sha256 || "",
    ).toLowerCase();
    if (
      !storyId ||
      !String(evidence.path || "").trim() ||
      !/^[a-f0-9]{64}$/.test(fileSha256) ||
      !/^[a-f0-9]{64}$/.test(canonicalSha256)
    ) {
      held.push({
        story_id: storyId || null,
        blocker: "reconciliation_work_item_invalid",
      });
      continue;
    }
    const canonicalStory = ctx.repos.stories.get(storyId);
    if (!canonicalStory) {
      held.push({
        story_id: storyId,
        blocker: "canonical_story_not_found",
      });
      continue;
    }
    const prepared = ctx.repos.jobs.enqueue({
      kind: "prepare_editorial_inventory",
      channel_id:
        job.channel_id ||
        process.env.CHANNEL ||
        "pulse-gaming",
      story_id: storyId,
      payload: {
        story: editorialInventoryStoryFromCanonical(
          canonicalStory,
          {
            verification_status: "CONFIRMED",
            generated_at: generatedAt,
          },
        ),
        breaking_source_evidence: {
          path: String(evidence.path).trim(),
          file_sha256: fileSha256,
          canonical_sha256: canonicalSha256,
        },
        publish_authority: false,
        human_review_required: true,
        live_publish_enabled: false,
      },
      priority: 22,
      requires_gpu: false,
      max_attempts: 2,
      idempotency_key:
        `editorial-inventory:${storyId}:${canonicalSha256}`,
    });
    queued.push({
      id: prepared?.id || null,
      story_id: storyId,
      idempotency_key:
        `editorial-inventory:${storyId}:${canonicalSha256}`,
    });
  }

  const reconciliationBlockers = Array.isArray(
    reconciliation?.blockers,
  )
    ? reconciliation.blockers
    : [];
  const rejectedCount = Array.isArray(reconciliation?.rejected)
    ? reconciliation.rejected.length
    : 0;
  const status =
    queued.length > 0 &&
    blockers.length === 0 &&
    reconciliationBlockers.length === 0 &&
    rejectedCount === 0 &&
    held.length === 0
      ? "READY"
      : queued.length > 0
        ? "PARTIAL"
        : blockers.length === 0 &&
            held.length === 0 &&
            (reconciliation?.skipped?.length || 0) > 0 &&
            reconciliationBlockers.length === 0 &&
            rejectedCount === 0
          ? "UP_TO_DATE"
          : "HOLD";
  await fs.ensureDir(outputDir);
  const report = {
    schema_version:
      "pulse-governed-editorial-inventory-reconciliation-job-v1",
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status,
    blockers: [
      ...new Set([...blockers, ...reconciliationBlockers]),
    ].sort(),
    queued,
    held,
    inventory_scan: inventoryReport,
    reconciliation,
    safety: {
      database_jobs_enqueued: queued.length > 0,
      network_used: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
    },
  };
  const reportJson = path.join(
    outputDir,
    "editorial-inventory-reconciliation-job.json",
  );
  const reportMarkdown = path.join(
    outputDir,
    "editorial-inventory-reconciliation-job.md",
  );
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(
    reportMarkdown,
    [
      "# Pulse Editorial Inventory Reconciliation",
      "",
      `Generated: ${generatedAt}`,
      `Status: ${status}`,
      `Queued preparations: ${queued.length}`,
      `Held work items: ${held.length}`,
      `Already current: ${reconciliation?.skipped?.length || 0}`,
      "",
      "## Blockers",
      "",
      ...(report.blockers.length
        ? report.blockers.map((blocker) => `- ${blocker}`)
        : ["- None"]),
      "",
      "This job may enqueue local inventory preparation only. It creates no approval or publishing authority.",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    status,
    queued_count: queued.length,
    queued,
    held,
    blockers: report.blockers,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function laneProductionBlockers(
  story,
  laneId,
  { localProofReviewDraft = false } = {},
) {
  const blockers = [];
  const extra = parseStoryExtra(story);
  if (
    !(story?.approved === true || story?.approved === 1) &&
    localProofReviewDraft !== true
  ) {
    blockers.push("story_not_approved_for_production");
  }
  if (!String(story?.full_script || "").trim()) {
    blockers.push("final_script_required");
  }
  if (
    story?.qa_failed === true ||
    String(story?.publish_status || "").toLowerCase() === "failed"
  ) {
    blockers.push("story_has_terminal_qa_failure");
  }

  if (laneId === "breaking_short") {
    if (Number(story?.breaking_score || 0) < 80) {
      blockers.push("breaking_score_below_80");
    }
    const verificationStatus = String(
      extra.verification_status ||
        story?.verification_status ||
        "",
    ).toUpperCase();
    const primarySourceUrl = String(
      extra.primary_source_url ||
        story?.primary_source_url ||
        "",
    ).trim();
    if (
      verificationStatus !== "CONFIRMED" ||
      !/^https?:\/\//i.test(primarySourceUrl)
    ) {
      blockers.push("confirmed_primary_source_required");
    }
    const sourceEvidenceSha256 = String(
      extra.source_evidence_sha256 ||
        story?.source_evidence_sha256 ||
        "",
    ).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sourceEvidenceSha256)) {
      blockers.push("source_evidence_sha256_required");
    }
  } else if (laneId === "evergreen_short") {
    const explicitFormat = String(
      extra.editorial_format ||
        extra.format_intent ||
        extra.format_id ||
        story?.editorial_format ||
        "",
    )
      .trim()
      .toLowerCase();
    if (explicitFormat !== "evergreen_verdict_short") {
      blockers.push("evergreen_verdict_format_required");
    }
    if (
      !extra.evergreen_pitch ||
      typeof extra.evergreen_pitch !== "object" ||
      Array.isArray(extra.evergreen_pitch)
    ) {
      blockers.push("evergreen_pitch_required");
    } else {
      const {
        assessEvergreenVerdictCandidate,
      } = require("./formats/evergreen-verdict-short");
      const assessment = assessEvergreenVerdictCandidate(
        extra.evergreen_pitch,
      );
      if (assessment.verdict !== "READY_FOR_PRODUCTION") {
        blockers.push(
          ...assessment.blockers.map(
            (blocker) => `evergreen:${blocker}`,
          ),
        );
      }
    }
  } else {
    blockers.push("unsupported_exact_short_production_lane");
  }

  return [...new Set(blockers)];
}

function safeOutputSegment(value, fallback = "unresolved") {
  const normalised = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalised || fallback;
}

function storyWithPlanningEvidence(story, payload, laneId) {
  const extra = parseStoryExtra(story);
  const suppliedPitch =
    payload?.evergreen_pitch &&
    typeof payload.evergreen_pitch === "object" &&
    !Array.isArray(payload.evergreen_pitch)
      ? payload.evergreen_pitch
      : null;
  const mergedExtra = {
    ...extra,
    ...(payload?.verification_status
      ? { verification_status: payload.verification_status }
      : {}),
    ...(payload?.verified_for_planning === true
      ? { verified_for_planning: true }
      : {}),
    ...(payload?.primary_source_url
      ? { primary_source_url: payload.primary_source_url }
      : {}),
    ...(payload?.source_evidence_sha256
      ? {
          source_evidence_sha256:
            payload.source_evidence_sha256,
        }
      : {}),
    ...(payload?.source_evidence_path
      ? {
          source_evidence_path:
            payload.source_evidence_path,
        }
      : {}),
    ...(payload?.source_evidence_file_sha256
      ? {
          source_evidence_file_sha256:
            payload.source_evidence_file_sha256,
        }
      : {}),
    ...(payload?.rights_ledger_path
      ? { rights_ledger_path: payload.rights_ledger_path }
      : {}),
    ...(payload?.rights_ledger_file_sha256
      ? {
          rights_ledger_file_sha256:
            payload.rights_ledger_file_sha256,
        }
      : {}),
    ...(payload?.rights_ledger_canonical_sha256
      ? {
          rights_ledger_canonical_sha256:
            payload.rights_ledger_canonical_sha256,
        }
      : {}),
    ...(payload?.source_evidence_ref &&
    typeof payload.source_evidence_ref === "object" &&
    !Array.isArray(payload.source_evidence_ref)
      ? {
          source_evidence_ref:
            structuredClone(payload.source_evidence_ref),
        }
      : {}),
    ...(payload?.rights_ledger_ref &&
    typeof payload.rights_ledger_ref === "object" &&
    !Array.isArray(payload.rights_ledger_ref)
      ? {
          rights_ledger_ref:
            structuredClone(payload.rights_ledger_ref),
        }
      : {}),
    ...(payload?.governed_editorial_inventory_ref &&
    typeof payload.governed_editorial_inventory_ref === "object" &&
    !Array.isArray(payload.governed_editorial_inventory_ref)
      ? {
          governed_editorial_inventory_ref: structuredClone(
            payload.governed_editorial_inventory_ref,
          ),
        }
      : {}),
    ...(payload?.governed_source_evidence &&
    typeof payload.governed_source_evidence === "object" &&
    !Array.isArray(payload.governed_source_evidence)
      ? {
          governed_source_evidence: structuredClone(
            payload.governed_source_evidence,
          ),
        }
      : {}),
    ...(laneId === "evergreen_short" &&
    (suppliedPitch ||
      (extra.evergreen_pitch &&
        typeof extra.evergreen_pitch === "object"))
      ? {
          editorial_format: "evergreen_verdict_short",
          evergreen_pitch:
            suppliedPitch || extra.evergreen_pitch || null,
        }
      : {}),
  };
  return {
    ...story,
    _extra: JSON.stringify(mergedExtra),
  };
}

async function governedInventorySourceBindingBlockers({
  payload = {},
  storyId,
  laneId,
} = {}) {
  const inventoryRef = payload.governed_editorial_inventory_ref;
  const sourceRef = payload.source_evidence_ref;
  const sourceEvidence = payload.governed_source_evidence;
  const isObject = (value) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value);
  const declaresInventoryBinding =
    isObject(inventoryRef) ||
    isObject(sourceEvidence) ||
    Boolean(
      String(
        payload.candidate_revision
          ?.editorial_inventory_sha256 || "",
      ).trim(),
    );
  if (!declaresInventoryBinding) return [];
  if (!isObject(inventoryRef)) {
    return ["governed_source_evidence_binding_mismatch"];
  }

  const object = (value) =>
    isObject(value)
      ? value
      : null;
  const exactSha256 = (value) => {
    const normalised = String(value || "")
      .trim()
      .toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalised)
      ? normalised
      : null;
  };
  const exactHttpsUrl = (value) => {
    const url = String(value || "").trim();
    try {
      return new URL(url).protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  };
  const inventory = object(inventoryRef);
  const source = object(sourceRef);
  const evidence = object(sourceEvidence);
  const mismatch = [
    inventory,
    source,
    evidence,
  ].some((value) => !value);
  if (mismatch) {
    return ["governed_source_evidence_binding_mismatch"];
  }

  const inventoryFileSha256 = exactSha256(inventory.sha256);
  const inventoryCanonicalSha256 = exactSha256(
    inventory.canonical_sha256,
  );
  const sourceFileSha256 = exactSha256(source.sha256);
  const sourceCanonicalSha256 = exactSha256(
    source.canonical_sha256,
  );
  const primarySourceUrl = exactHttpsUrl(
    evidence.primary_source_url,
  );
  if (
    !String(inventory.path || "").trim() ||
    !inventoryFileSha256 ||
    !inventoryCanonicalSha256 ||
    String(inventory.story_id || "").trim() !== storyId ||
    String(inventory.lane_id || "").trim() !== laneId ||
    !String(source.path || "").trim() ||
    !sourceFileSha256 ||
    !sourceCanonicalSha256 ||
    String(source.story_id || "").trim() !== storyId ||
    String(source.lane_id || "").trim() !== laneId ||
    String(evidence.verification_status || "").toUpperCase() !==
      "CONFIRMED" ||
    evidence.verified_for_planning !== true ||
    !primarySourceUrl ||
    exactSha256(evidence.source_evidence_sha256) !==
      sourceCanonicalSha256 ||
    String(evidence.path || "").trim() !==
      String(source.path).trim() ||
    exactSha256(evidence.file_sha256) !== sourceFileSha256 ||
    String(payload.verification_status || "").toUpperCase() !==
      "CONFIRMED" ||
    payload.verified_for_planning !== true ||
    String(payload.primary_source_url || "").trim() !==
      primarySourceUrl ||
    exactSha256(payload.source_evidence_sha256) !==
      sourceCanonicalSha256 ||
    String(payload.source_evidence_path || "").trim() !==
      String(source.path).trim() ||
    exactSha256(payload.source_evidence_file_sha256) !==
      sourceFileSha256 ||
    (payload.candidate_revision?.source_evidence_sha256 &&
      exactSha256(
        payload.candidate_revision.source_evidence_sha256,
      ) !== sourceCanonicalSha256)
  ) {
    return ["governed_source_evidence_binding_mismatch"];
  }

  try {
    const bytes = await fs.readFile(String(source.path).trim());
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !==
      sourceFileSha256
    ) {
      return ["governed_source_evidence_binding_mismatch"];
    }
    const packet = JSON.parse(bytes.toString("utf8"));
    const {
      validateBreakingSourceEvidencePacket,
    } = require("./services/breaking-source-evidence");
    const validation =
      validateBreakingSourceEvidencePacket(packet);
    if (
      !validation.valid ||
      validation.packet_sha256 !== sourceCanonicalSha256 ||
      String(packet.story_id || "").trim() !== storyId ||
      packet.verification_status !== "CONFIRMED" ||
      packet.verified_for_planning !== true ||
      !["OFFICIAL_CONFIRMED", "CORROBORATED"].includes(
        packet.verdict,
      ) ||
      !Array.isArray(packet.blockers) ||
      packet.blockers.length > 0 ||
      String(packet.primary_source_url || "").trim() !==
        primarySourceUrl
    ) {
      return ["governed_source_evidence_binding_mismatch"];
    }
  } catch {
    return ["governed_source_evidence_binding_mismatch"];
  }

  return [];
}

function evergreenProductionInputRefs({
  payload = {},
  extra = {},
  storyId,
  laneId,
} = {}) {
  const exactRef = (field, fallback = null) => {
    const supplied =
      payload[field] &&
      typeof payload[field] === "object" &&
      !Array.isArray(payload[field])
        ? payload[field]
        : extra[field] &&
            typeof extra[field] === "object" &&
            !Array.isArray(extra[field])
          ? extra[field]
          : fallback;
    return supplied
      ? suppliedReviewRef(supplied, storyId, laneId)
      : null;
  };
  return {
    source_evidence_ref: exactRef(
      "source_evidence_ref",
      payload.source_evidence_path ||
        extra.source_evidence_path
        ? {
            path:
              payload.source_evidence_path ||
              extra.source_evidence_path,
            sha256:
              payload.source_evidence_file_sha256 ||
              extra.source_evidence_file_sha256,
            canonical_sha256:
              payload.source_evidence_sha256 ||
              extra.source_evidence_sha256,
          }
        : null,
    ),
    rights_ledger_ref: exactRef(
      "rights_ledger_ref",
      payload.rights_ledger_path || extra.rights_ledger_path
        ? {
            path:
              payload.rights_ledger_path ||
              extra.rights_ledger_path,
            sha256:
              payload.rights_ledger_file_sha256 ||
              extra.rights_ledger_file_sha256 ||
              payload.rights_ledger_sha256 ||
              extra.rights_ledger_sha256,
            canonical_sha256:
              payload.rights_ledger_canonical_sha256 ||
              extra.rights_ledger_canonical_sha256 ||
              payload.rights_ledger_sha256 ||
              extra.rights_ledger_sha256,
          }
        : null,
    ),
    originality_transformation_ref: exactRef(
      "originality_transformation_ref",
    ),
    synthetic_disclosure_proposal_ref: exactRef(
      "synthetic_disclosure_proposal_ref",
    ),
  };
}

function renderExactShortWorkOrderMarkdown(workOrder) {
  return [
    `# ${workOrder.title || "Pulse Gaming Exact Short"} Work Order`,
    "",
    `Generated: ${workOrder.generated_at}`,
    `Lane: ${workOrder.lane_id}`,
    `Story ID: ${workOrder.story_id}`,
    `Status: ${workOrder.status}`,
    `Format: ${workOrder.format_family}`,
    "",
    "## Exact bindings",
    "",
    `- Script SHA-256: ${workOrder.script_sha256 || "missing"}`,
    `- Primary source: ${workOrder.primary_source_url || "not applicable"}`,
    `- Source evidence SHA-256: ${
      workOrder.source_evidence_sha256 || "not applicable"
    }`,
    `- Evergreen candidate: ${
      workOrder.evergreen_pitch?.id || "not applicable"
    }`,
    "",
    "## Blockers",
    "",
    ...(workOrder.blockers.length
      ? workOrder.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "This work order grants production planning authority only.",
    "It grants no publication, OAuth or production-database authority.",
    "",
  ].join("\n");
}

const GOVERNED_REVIEW_REF_FIELDS = Object.freeze([
  "production_work_order_ref",
  "final_media_ref",
  "renderer_manifest_ref",
  "qa_ref",
  "source_evidence_ref",
  "rights_ledger_ref",
  "originality_transformation_ref",
  "synthetic_disclosure_proposal_ref",
]);

const GOVERNED_REVIEW_LANE_BY_KIND = Object.freeze({
  review_breaking_short: "breaking_short",
  review_evergreen_short: "evergreen_short",
  review_weekly_longform: "weekly_longform",
});

function suppliedReviewRef(value, storyId, laneId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const output = { ...value };
  if (!Object.hasOwn(output, "story_id")) output.story_id = storyId;
  if (!Object.hasOwn(output, "lane_id")) output.lane_id = laneId;
  return output;
}

function stableReviewValue(value) {
  if (Array.isArray(value)) return value.map(stableReviewValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableReviewValue(value[key])]),
    );
  }
  return value;
}

function exactReviewContainer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  for (const field of [
    "governed_lane_review_evidence",
    "review_evidence",
  ]) {
    const container = value[field];
    if (
      container &&
      typeof container === "object" &&
      !Array.isArray(container)
    ) {
      return container;
    }
  }
  return {};
}

function firstSuppliedReviewRef(
  sources,
  field,
  storyId,
  laneId,
) {
  for (const source of sources) {
    const value = source?.[field];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return suppliedReviewRef(value, storyId, laneId);
    }
  }
  return null;
}

function governedReviewEvidenceFromSources({
  payload = {},
  production = null,
  story = null,
  storyId,
  laneId,
} = {}) {
  const storyExtra = parseStoryExtra(story || {});
  const sources = [
    exactReviewContainer(payload),
    payload,
    exactReviewContainer(production),
    exactReviewContainer(production?.render),
    exactReviewContainer(storyExtra),
    storyExtra,
  ];
  const evidence = Object.fromEntries(
    GOVERNED_REVIEW_REF_FIELDS.map((field) => [
      field,
      firstSuppliedReviewRef(
        sources,
        field,
        storyId,
        laneId,
      ),
    ]),
  );

  if (
    !evidence.source_evidence_ref &&
    (payload.source_evidence_path ||
      payload.source_evidence_file_sha256)
  ) {
    evidence.source_evidence_ref = suppliedReviewRef(
      {
        path: payload.source_evidence_path || null,
        sha256: payload.source_evidence_file_sha256 || null,
        canonical_sha256:
          payload.source_evidence_sha256 || null,
      },
      storyId,
      laneId,
    );
  }
  if (
    !evidence.final_media_ref &&
    (story?.exported_path || story?.studio_v21_output_sha256)
  ) {
    evidence.final_media_ref = suppliedReviewRef(
      {
        path: story.exported_path || null,
        sha256: story.studio_v21_output_sha256 || null,
      },
      storyId,
      laneId,
    );
  }

  // These weekly production records have exact, documented semantics.
  // Deliberately do not relabel same-run reports, gate reports or generic
  // manifests as renderer, source, originality or disclosure evidence.
  if (laneId === "weekly_longform" && production?.artifacts) {
    if (!evidence.final_media_ref) {
      evidence.final_media_ref = suppliedReviewRef(
        production.artifacts.master,
        storyId,
        laneId,
      );
    }
    // Generic decode/codec QA is not native renderer QA. The weekly review
    // lane must receive an explicit hash-bound qa_ref from the production
    // result and may not relabel decoded_qa_input to fill that semantic gap.
    if (!evidence.rights_ledger_ref) {
      evidence.rights_ledger_ref = suppliedReviewRef(
        production.artifacts.rights_lineage_input,
        storyId,
        laneId,
      );
    }
  }
  return evidence;
}

function governedReviewRevision({
  laneId,
  storyId,
  upstreamRevisionSha256,
  reviewEvidence,
} = {}) {
  const exactBindings = Object.fromEntries(
    GOVERNED_REVIEW_REF_FIELDS.map((field) => {
      const ref = reviewEvidence?.[field] || null;
      return [
        field,
        ref
          ? {
              path: String(ref.path || "").trim() || null,
              sha256:
                String(ref.sha256 || ref.file_sha256 || "")
                  .trim()
                  .toLowerCase() || null,
              canonical_sha256:
                String(ref.canonical_sha256 || "")
                  .trim()
                  .toLowerCase() || null,
            }
          : null,
      ];
    }),
  );
  const bindings = {
    schema_version: "pulse-governed-lane-review-revision-v1",
    lane_id: laneId,
    story_id: storyId,
    upstream_revision_sha256:
      String(upstreamRevisionSha256 || "").trim().toLowerCase() ||
      null,
    artifacts: exactBindings,
  };
  return {
    bindings,
    sha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(stableReviewValue(bindings)))
      .digest("hex"),
  };
}

function enqueueGovernedLaneReview({
  job,
  ctx,
  laneId,
  storyId,
  generatedAt,
  reviewEvidence,
  upstreamRevisionSha256,
} = {}) {
  if (!ctx.repos?.jobs?.enqueue) return null;
  const reviewKind = {
    breaking_short: "review_breaking_short",
    evergreen_short: "review_evergreen_short",
    weekly_longform: "review_weekly_longform",
  }[laneId];
  if (!reviewKind) return null;
  const revision = governedReviewRevision({
    laneId,
    storyId,
    upstreamRevisionSha256,
    reviewEvidence,
  });
  return ctx.repos.jobs.enqueue({
    kind: reviewKind,
    channel_id:
      job.channel_id || process.env.CHANNEL || "pulse-gaming",
    story_id: storyId,
    payload: {
      lane_id: laneId,
      story_id: storyId,
      generated_at: generatedAt,
      review_revision_sha256: revision.sha256,
      review_revision: revision.bindings,
      review_evidence: reviewEvidence,
      output_dir: path.join(
        __dirname,
        "..",
        "output",
        "lane-reviews",
        safeOutputSegment(laneId),
        safeOutputSegment(storyId),
        revision.sha256,
      ),
      publish_authority: false,
      human_review_required: true,
      approval_inferred: false,
      external_posting_authorised: false,
    },
    priority:
      laneId === "breaking_short"
        ? 7
        : laneId === "evergreen_short"
          ? 19
          : 35,
    requires_gpu: false,
    max_attempts: 2,
    idempotency_key:
      `review:${laneId}:${storyId}:${revision.sha256}`,
  });
}

async function handleGovernedLaneReview(job, ctx) {
  const payload = job?.payload || {};
  const expectedLane =
    GOVERNED_REVIEW_LANE_BY_KIND[String(job?.kind || "").trim()] ||
    "";
  const laneId = String(expectedLane || payload.lane_id || "").trim();
  const storyId = String(
    payload.story_id || payload.run_id || "",
  ).trim();
  const generatedAt = new Date(
    payload.generated_at ||
      payload.now ||
      new Date().toISOString(),
  ).toISOString();
  const story = ctx.repos?.stories?.get?.(storyId) || null;
  const reviewEvidence = governedReviewEvidenceFromSources({
    payload,
    production: payload.production_result || null,
    story,
    storyId,
    laneId,
  });
  const outputDir = path.resolve(
    payload.output_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "lane-reviews",
        safeOutputSegment(laneId),
        safeOutputSegment(storyId),
      ),
  );
  const materialize =
    ctx.materializeGovernedLaneReviewPacket ||
    require("./services/governed-lane-review-packet")
      .materializeGovernedLaneReviewPacket;
  ctx.assertLeaseHealthy?.();
  const materialized = await materialize({
    lane_id: laneId,
    story_id: storyId,
    generated_at: generatedAt,
    output_dir: outputDir,
    ...reviewEvidence,
  });
  ctx.assertLeaseHealthy?.();
  return {
    status: materialized.packet.verdict,
    blockers: materialized.packet.blockers,
    lane_id: laneId,
    story_id: storyId,
    immutable_fingerprint_sha256:
      materialized.packet.immutable_fingerprint_sha256,
    review_packet_json: materialized.paths.json,
    review_packet_markdown: materialized.paths.markdown,
    review_packet_json_sha256: materialized.sha256.json,
    review_packet_markdown_sha256:
      materialized.sha256.markdown,
    human_review_required: true,
    publish_authority: false,
    approval_inferred: false,
    admission_created: false,
    scheduling_created: false,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
    no_database_mutation: true,
  };
}

async function handleExactShortPlanning(job, ctx) {
  const crypto = require("node:crypto");
  const payload = job?.payload || {};
  const kind = String(job?.kind || "").trim();
  const laneId = String(
    payload.lane_id ||
      (kind === "plan_evergreen_short"
        ? "evergreen_short"
        : kind === "plan_breaking_short"
          ? "breaking_short"
          : ""),
  ).trim();
  const storyId = String(payload.story_id || "").trim();
  const allowedLanes = new Set([
    "breaking_short",
    "evergreen_short",
  ]);
  const initialBlockers = [];
  if (!storyId) initialBlockers.push("exact_story_id_required");
  if (!allowedLanes.has(laneId)) {
    initialBlockers.push("unsupported_exact_short_planning_lane");
  }
  const story =
    storyId && ctx.repos?.stories?.get
      ? ctx.repos.stories.get(storyId)
      : null;
  if (storyId && !story) {
    initialBlockers.push("exact_story_not_found");
  }
  const plannedStory = story
    ? storyWithPlanningEvidence(story, payload, laneId)
    : null;
  let evergreenGovernance = null;
  if (plannedStory && laneId === "evergreen_short") {
    const {
      buildEvergreenVerdictProductionWorkOrder,
    } = require("./services/evergreen-verdict-production-work-order");
    const evergreenExtra = parseStoryExtra(plannedStory);
    evergreenGovernance =
      buildEvergreenVerdictProductionWorkOrder({
        story: {
          id: plannedStory.id,
          title: plannedStory.title,
          url:
            plannedStory.url ||
            plannedStory.article_url ||
            plannedStory.primary_source_url ||
            evergreenExtra.primary_source_url ||
            "",
          source_confidence:
            plannedStory.source_confidence ||
            evergreenExtra.source_confidence ||
            evergreenExtra.verification_status ||
            plannedStory.verification_status ||
            "",
        },
        evergreen_pitch:
          evergreenExtra.evergreen_pitch || null,
        history: Array.isArray(payload.history)
          ? payload.history
          : [],
        policy: payload.policy,
        now: payload.now || new Date().toISOString(),
      });
  }
  const blockers = [
    ...initialBlockers,
    ...(plannedStory
      ? laneProductionBlockers(plannedStory, laneId, {
          localProofReviewDraft:
            payload.publish_authority === false &&
            payload.human_review_required === true,
        })
      : []),
    ...(evergreenGovernance?.blockers || []).map(
      (blocker) => `evergreen_work_order:${blocker}`,
    ),
  ];
  const extra = parseStoryExtra(plannedStory || {});
  const governedEvergreenScript = String(
    evergreenGovernance?.work_order?.script_contract
      ?.full_script || "",
  ).trim();
  const script = String(plannedStory?.full_script || "").trim();
  if (
    governedEvergreenScript &&
    script.replace(/\s+/g, " ") !==
      governedEvergreenScript.replace(/\s+/g, " ")
  ) {
    blockers.push(
      "evergreen_work_order:materialised_script_not_bound_to_story",
    );
  }
  const uniqueBlockers = [...new Set(blockers)];
  const scriptSha256 = script
    ? crypto.createHash("sha256").update(script).digest("hex")
    : null;
  const generatedAt = new Date(
    payload.now || new Date().toISOString(),
  ).toISOString();
  const productionInputRefs = evergreenProductionInputRefs({
    payload,
    extra,
    storyId,
    laneId,
  });
  const status = uniqueBlockers.length
    ? "HOLD"
    : "READY_FOR_EXACT_PRODUCTION";
  const workOrder = {
    schema_version: "pulse-exact-short-work-order-v1",
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    status,
    lane_id: laneId || null,
    format_family:
      laneId === "evergreen_short"
        ? "evergreen_verdict_short"
        : laneId === "breaking_short"
          ? "breaking_news_short"
          : null,
    story_id: storyId || null,
    title: plannedStory?.title || null,
    script_sha256: scriptSha256,
    primary_source_url: extra.primary_source_url || null,
    source_evidence_sha256:
      extra.source_evidence_sha256 || null,
    source_evidence: {
      path: extra.source_evidence_path || null,
      file_sha256:
        extra.source_evidence_file_sha256 || null,
      canonical_sha256:
        extra.source_evidence_sha256 || null,
    },
    evergreen_pitch:
      laneId === "evergreen_short"
        ? extra.evergreen_pitch || null
        : null,
    evergreen_governance: evergreenGovernance,
    production_input_refs: productionInputRefs,
    blockers: uniqueBlockers,
    exact_story_scope: storyId ? [storyId] : [],
    human_review_required: true,
    publish_authority: false,
    external_posting_authorised: false,
    oauth_mutation_authorised: false,
    database_mutation_authorised: false,
  };
  const outDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "lane-work-orders",
        safeOutputSegment(laneId),
        safeOutputSegment(storyId),
      ),
  );
  await fs.ensureDir(outDir);
  const workOrderJson = path.join(
    outDir,
    "exact-short-work-order.json",
  );
  const workOrderMarkdown = path.join(
    outDir,
    "exact-short-work-order.md",
  );
  await fs.writeJson(workOrderJson, workOrder, { spaces: 2 });
  await fs.writeFile(
    workOrderMarkdown,
    renderExactShortWorkOrderMarkdown(workOrder),
    "utf8",
  );
  const workOrderFileSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(workOrderJson))
    .digest("hex");
  const productionWorkOrderRef = {
    path: workOrderJson,
    sha256: workOrderFileSha256,
    story_id: storyId,
    lane_id: laneId,
  };
  const revisionWorkOrder = structuredClone(workOrder);
  delete revisionWorkOrder.generated_at;
  const {
    buildCandidateRevision,
  } = require("./services/multi-lane-job-routing");
  const productionRevision = buildCandidateRevision({
    stage: "PRODUCTION_READY",
    source_evidence_sha256:
      extra.source_evidence_sha256 || null,
    script_sha256: scriptSha256,
    media_sha256:
      extra.media_sha256 ||
      extra.preflight_evidence?.media_sha256 ||
      null,
    rights_ledger_sha256:
      extra.rights_ledger_canonical_sha256 ||
      extra.rights_ledger_sha256 ||
      extra.preflight_evidence?.rights_ledger_sha256 ||
      null,
    evergreen_pitch:
      laneId === "evergreen_short"
        ? extra.evergreen_pitch || null
        : null,
    work_order: revisionWorkOrder,
  });

  let productionJob = null;
  if (!uniqueBlockers.length && ctx.repos?.jobs?.enqueue) {
    const produceKind =
      laneId === "evergreen_short"
        ? "produce_evergreen_short"
        : "produce_breaking_short";
    productionJob = ctx.repos.jobs.enqueue({
      kind: produceKind,
      channel_id:
        job.channel_id || process.env.CHANNEL || "pulse-gaming",
      story_id: storyId,
      payload: {
        lane_id: laneId,
        story_id: storyId,
        generated_at: generatedAt,
        script_sha256: scriptSha256,
        production_work_order_ref: productionWorkOrderRef,
        candidate_revision_sha256:
          productionRevision.sha256,
        candidate_revision: productionRevision.bindings,
        ...(extra.primary_source_url
          ? { primary_source_url: extra.primary_source_url }
          : {}),
        ...(extra.verification_status
          ? {
              verification_status:
                extra.verification_status,
            }
          : {}),
        ...(extra.verified_for_planning === true
          ? { verified_for_planning: true }
          : {}),
        ...(extra.source_evidence_sha256
          ? {
              source_evidence_sha256:
                extra.source_evidence_sha256,
            }
          : {}),
        ...(extra.source_evidence_path
          ? {
              source_evidence_path:
                extra.source_evidence_path,
            }
          : {}),
        ...(extra.source_evidence_file_sha256
          ? {
              source_evidence_file_sha256:
                extra.source_evidence_file_sha256,
            }
          : {}),
        ...(extra.rights_ledger_path
          ? { rights_ledger_path: extra.rights_ledger_path }
          : {}),
        ...(extra.rights_ledger_file_sha256
          ? {
              rights_ledger_file_sha256:
                extra.rights_ledger_file_sha256,
            }
          : {}),
        ...(extra.rights_ledger_canonical_sha256
          ? {
              rights_ledger_canonical_sha256:
                extra.rights_ledger_canonical_sha256,
              rights_ledger_sha256:
                extra.rights_ledger_canonical_sha256,
            }
          : {}),
        ...productionInputRefs,
        ...(extra.governed_editorial_inventory_ref &&
        typeof extra.governed_editorial_inventory_ref ===
          "object" &&
        !Array.isArray(
          extra.governed_editorial_inventory_ref,
        )
          ? {
              governed_editorial_inventory_ref:
                structuredClone(
                  extra.governed_editorial_inventory_ref,
                ),
            }
          : {}),
        ...(extra.governed_source_evidence &&
        typeof extra.governed_source_evidence === "object" &&
        !Array.isArray(extra.governed_source_evidence)
          ? {
              governed_source_evidence:
                structuredClone(
                  extra.governed_source_evidence,
                ),
            }
          : {}),
        ...(laneId === "evergreen_short"
          ? {
              evergreen_pitch: extra.evergreen_pitch,
              ...(payload.production_out_dir
                ? {
                    production_out_dir:
                      payload.production_out_dir,
                  }
                : {}),
            }
          : {}),
        publish_authority: false,
        human_review_required: true,
      },
      priority: laneId === "breaking_short" ? 6 : 18,
      requires_gpu: false,
      max_attempts: 3,
      idempotency_key:
        `produce:${laneId}:${storyId}:` +
        productionRevision.sha256,
    });
  }
  ctx.assertLeaseHealthy?.();
  return {
    status,
    story_id: storyId || null,
    lane_id: laneId || null,
    blockers: uniqueBlockers,
    production_job_id: productionJob?.id || null,
    work_order_json: workOrderJson,
    work_order_markdown: workOrderMarkdown,
    work_order_sha256: workOrderFileSha256,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function resolveAutonomousProductionStoryBinding({
  builderResult,
  payloadStoryId,
  databaseStoryId,
}) {
  if (builderResult.story_id !== payloadStoryId) {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_production_identity_mismatch",
      ],
    };
  }
  if (!builderResult.story_id.startsWith("official_")) {
    return {
      storyLookupId: builderResult.story_id,
      blockers: [],
    };
  }

  const lockedIntake =
    builderResult.production_request.locked_intake;
  const {
    canonicalHash,
    canonicalUrl,
  } = require("./services/url-canonical");
  const canonicalIdentityUrl = canonicalUrl(
    lockedIntake.canonical_identity_url,
  );
  if (
    !canonicalIdentityUrl ||
    `official_${canonicalHash(
      lockedIntake.canonical_identity_url,
    )}` !== builderResult.story_id
  ) {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_production_identity_mismatch",
      ],
    };
  }

  const inventoryPath = path.resolve(
    lockedIntake.inventory_path,
  );
  const inventoryRoot = path.resolve(
    lockedIntake.inventory_root,
  );
  const allowedRoots = lockedIntake.allowed_roots.map((root) =>
    path.resolve(root),
  );
  if (
    !pathIsWithin(inventoryRoot, inventoryPath) ||
    !allowedRoots.some((root) =>
      pathIsWithin(root, inventoryPath),
    )
  ) {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_inventory_path_outside_locked_root",
      ],
    };
  }

  let stat;
  let bytes;
  try {
    stat = await fs.lstat(inventoryPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > 512 * 1024
    ) {
      throw new Error("invalid_inventory_file");
    }
    bytes = await fs.readFile(inventoryPath);
  } catch {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_locked_inventory_invalid",
      ],
    };
  }
  const observedSha256 = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  if (
    observedSha256 !==
    lockedIntake.inventory_file_sha256
  ) {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_locked_inventory_sha256_mismatch",
      ],
    };
  }

  let inventory;
  try {
    inventory = JSON.parse(bytes.toString("utf8"));
  } catch {
    inventory = null;
  }
  const inventoryStoryId = String(
    inventory?.story?.id || "",
  ).trim();
  const exactOfficialIdentity =
    inventoryStoryId === builderResult.story_id;
  const exactLegacyInventoryIdentity =
    !inventoryStoryId.startsWith("official_") &&
    canonicalUrl(inventory?.story?.primary_source_url) ===
      canonicalIdentityUrl;
  if (
    inventory?.schema_version !==
      "pulse-governed-editorial-inventory-v1" ||
    inventory?.verdict !== "READY" ||
    !Array.isArray(inventory?.blockers) ||
    inventory.blockers.length !== 0 ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(inventoryStoryId) ||
    (!exactOfficialIdentity &&
      !exactLegacyInventoryIdentity)
  ) {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_locked_inventory_registry_invalid",
      ],
    };
  }
  let databaseStoryBinding;
  try {
    const {
      validateGovernedAutonomousDatabaseStoryBinding,
    } = require("./services/governed-autonomous-database-story-binding");
    databaseStoryBinding =
      validateGovernedAutonomousDatabaseStoryBinding(
        lockedIntake.database_story_binding,
        {
          canonical_story_id: builderResult.story_id,
          database_story_id: inventoryStoryId,
          canonical_identity_url:
            lockedIntake.canonical_identity_url,
          inventory_file_sha256:
            lockedIntake.inventory_file_sha256,
          final_script_sha256:
            lockedIntake.final_script_sha256,
        },
      );
  } catch {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_database_story_binding_invalid",
      ],
    };
  }
  if (
    String(databaseStoryId || "").trim() &&
    String(databaseStoryId).trim() !==
      databaseStoryBinding.database_story_id
  ) {
    return {
      storyLookupId: null,
      blockers: [
        "governed_autonomous_database_story_job_binding_mismatch",
      ],
    };
  }
  return {
    storyLookupId:
      databaseStoryBinding.database_story_id,
    blockers: [],
  };
}

async function handleExactShortProduction(job, ctx) {
  const crypto = require("node:crypto");
  const payload = job?.payload || {};
  const laneId = String(payload.lane_id || "").trim();
  const storyId = String(payload.story_id || "").trim();
  if (!storyId) {
    return {
      status: "held",
      blockers: ["exact_story_id_required"],
      no_publish: true,
    };
  }
  const autonomousRequested =
    laneId === "breaking_short" &&
    payload.autonomous_production_job !== undefined;
  let autonomousJob = null;
  let builderResult = null;
  let storyLookupId = storyId;
  if (autonomousRequested) {
    autonomousJob = payload.autonomous_production_job;
    const autonomousPayloadFields = [
      "builder_result",
      "schema_version",
    ];
    const suppliedFields =
      autonomousJob &&
      typeof autonomousJob === "object" &&
      !Array.isArray(autonomousJob)
        ? Object.keys(autonomousJob).sort()
        : [];
    if (
      !autonomousJob ||
      autonomousJob.schema_version !==
        "pulse-governed-autonomous-production-job-payload-v1" ||
      suppliedFields.length !== autonomousPayloadFields.length ||
      suppliedFields.some(
        (field, index) =>
          field !== [...autonomousPayloadFields].sort()[index],
      )
    ) {
      return {
        status: "held",
        story_id: storyId,
        lane_id: laneId,
        blockers: [
          "governed_autonomous_production_job_payload_invalid",
        ],
        human_review_required: false,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }
    try {
      const {
        validateGovernedAutonomousProductionRequestBuild,
      } = require("./services/governed-autonomous-production-request-builder");
      builderResult =
        validateGovernedAutonomousProductionRequestBuild(
          autonomousJob.builder_result,
        );
    } catch (error) {
      return {
        status: "held",
        story_id: storyId,
        lane_id: laneId,
        blockers: [
          String(
            error?.code ||
              "governed_autonomous_production_builder_invalid",
          ),
        ],
        human_review_required: false,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }
    const binding =
      await resolveAutonomousProductionStoryBinding({
        builderResult,
        payloadStoryId: storyId,
        databaseStoryId: job?.story_id,
      });
    if (binding.blockers.length) {
      return {
        status: "held",
        story_id: storyId,
        lane_id: laneId,
        blockers: binding.blockers,
        human_review_required: false,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }
    storyLookupId = binding.storyLookupId;
  }
  const story =
    ctx.repos?.stories?.get?.(storyLookupId) || null;
  if (!story) {
    return {
      status: "held",
      story_id: storyId,
      blockers: ["exact_story_not_found"],
      no_publish: true,
    };
  }
  if (autonomousRequested) {
    const storyExtra = parseStoryExtra(story);
    if (
      String(story.publish_status || "")
        .trim()
        .toLowerCase() ===
        "canonical_projection_consumed" ||
      storyExtra.governed_autonomous_canonical_projection
        ?.role === "LEGACY_ALIAS_CONSUMED"
    ) {
      return {
        status: "held",
        story_id: storyId,
        lane_id: laneId,
        blockers: [
          "governed_autonomous_database_story_projection_consumed",
        ],
        human_review_required: false,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }
  }
  const governedStory = storyWithPlanningEvidence(
    story,
    payload,
    laneId,
  );
  const blockers = laneProductionBlockers(governedStory, laneId, {
    localProofReviewDraft:
      payload.publish_authority === false &&
      payload.human_review_required === true,
  });
  if (laneId === "breaking_short") {
    blockers.push(
      ...(await governedInventorySourceBindingBlockers({
        payload,
        storyId: storyLookupId,
        laneId,
      })),
    );
  }
  const expectedScriptSha = String(
    payload.script_sha256 || "",
  )
    .trim()
    .toLowerCase();
  const observedScriptSha = crypto
    .createHash("sha256")
    .update(String(governedStory.full_script || "").trim())
    .digest("hex");
  if (
    expectedScriptSha &&
    (!/^[a-f0-9]{64}$/.test(expectedScriptSha) ||
      expectedScriptSha !== observedScriptSha)
  ) {
    blockers.push("exact_story_script_sha256_mismatch");
  }
  if (laneId === "evergreen_short") {
    const extra = parseStoryExtra(governedStory);
    const {
      buildEvergreenVerdictProductionWorkOrder,
    } = require("./services/evergreen-verdict-production-work-order");
    const governance = buildEvergreenVerdictProductionWorkOrder({
      story: {
        id: governedStory.id,
        title: governedStory.title,
        url:
          governedStory.url ||
          governedStory.article_url ||
          extra.primary_source_url ||
          "",
        source_confidence:
          governedStory.source_confidence ||
          extra.source_confidence ||
          extra.verification_status ||
          governedStory.verification_status ||
          "",
      },
      evergreen_pitch: extra.evergreen_pitch || null,
      history: Array.isArray(payload.history)
        ? payload.history
        : [],
      policy: payload.policy,
      now: payload.now || new Date().toISOString(),
    });
    blockers.push(
      ...(governance.blockers || []).map(
        (blocker) => `evergreen_work_order:${blocker}`,
      ),
    );
    const governedScript = String(
      governance.work_order?.script_contract?.full_script || "",
    ).replace(/\s+/g, " ");
    if (
      governedScript &&
      governedScript !==
        String(governedStory.full_script || "")
          .trim()
          .replace(/\s+/g, " ")
    ) {
      blockers.push(
        "evergreen_work_order:materialised_script_not_bound_to_story",
      );
    }
    const workOrderRef = payload.production_work_order_ref;
    if (
      !workOrderRef ||
      typeof workOrderRef !== "object" ||
      Array.isArray(workOrderRef)
    ) {
      blockers.push(
        "evergreen_production_work_order_ref_required",
      );
    }
  }
  const uniqueBlockers = [...new Set(blockers)];
  if (uniqueBlockers.length) {
    return {
      status: "held",
      story_id: storyId,
      lane_id: laneId,
      blockers: uniqueBlockers,
      no_publish: true,
      no_external_posting: true,
    };
  }

  const generatedAt = new Date(
    payload.generated_at ||
      payload.now ||
      new Date().toISOString(),
  ).toISOString();
  if (autonomousRequested) {
    const trustedWorkspaceRoot = path.resolve(
      ctx.autonomousProductionWorkspaceRoot ||
        ctx.workspaceRoot ||
        process.cwd(),
    );
    const exactScript = String(
      governedStory.full_script || "",
    ).trim();
    const lockedScript = String(
      builderResult.production_request?.locked_intake
        ?.final_script || "",
    ).trim();
    const payloadCandidateRevision = String(
      payload.candidate_revision_sha256 || "",
    )
      .trim()
      .toLowerCase();
    const builderCandidateRevision = String(
      builderResult.production_request
        ?.candidate_revision_sha256 || "",
    )
      .trim()
      .toLowerCase();
    const autonomousBindingBlockers = [];
    if (
      builderResult.story_id !== storyId ||
      path.resolve(
        builderResult.production_request?.workspace_root,
      ) !==
        trustedWorkspaceRoot
    ) {
      autonomousBindingBlockers.push(
        "governed_autonomous_production_identity_mismatch",
      );
    }
    if (
      !exactScript ||
      lockedScript !== exactScript ||
      builderResult.production_request?.locked_intake
        ?.final_script_sha256 !== observedScriptSha
    ) {
      autonomousBindingBlockers.push(
        "governed_autonomous_production_script_mismatch",
      );
    }
    if (
      payloadCandidateRevision &&
      payloadCandidateRevision !== builderCandidateRevision
    ) {
      autonomousBindingBlockers.push(
        "governed_autonomous_production_revision_mismatch",
      );
    }
    if (autonomousBindingBlockers.length) {
      return {
        status: "held",
        story_id: storyId,
        lane_id: laneId,
        blockers: [...new Set(autonomousBindingBlockers)],
        human_review_required: false,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }

    const candidateWorkspace = path.resolve(
      trustedWorkspaceRoot,
      ...String(
        builderResult.production_request
          .candidate_workspace_relative_root,
      ).split("/"),
    );
    const runAutonomousProductionJob =
      ctx.runGovernedAutonomousProductionJob ||
      require("./services/governed-autonomous-production-job-runner")
        .runGovernedAutonomousProductionJob;
    let autonomousDependencies =
      ctx.governedAutonomousProductionJobDependencies;
    let runtimeCapabilities = null;
    if (!autonomousDependencies) {
      let runtime = null;
      try {
        const buildRuntime =
          ctx.buildGovernedAutonomousProductionRuntime ||
          require("./services/governed-autonomous-production-runtime")
            .buildGovernedAutonomousProductionRuntime;
        runtime = await buildRuntime({
          builderResult,
          env: ctx.env || process.env,
        });
      } catch (error) {
        return {
          status: "held",
          story_id: storyId,
          lane_id: laneId,
          blockers: [
            String(
              error?.code ||
                "governed_autonomous_production_runtime_invalid",
            ),
          ],
          human_review_required: false,
          no_publish: true,
          no_external_posting: true,
          no_oauth_or_token_change: true,
          no_database_mutation: true,
        };
      }
      runtimeCapabilities = runtime?.capabilities || null;
      if (runtimeCapabilities?.ready !== true) {
        return {
          status: "held",
          story_id: storyId,
          lane_id: laneId,
          blockers:
            Array.isArray(runtimeCapabilities?.blockers) &&
            runtimeCapabilities.blockers.length
              ? [...new Set(runtimeCapabilities.blockers)]
              : [
                  "governed_autonomous_production_runtime_not_ready",
                ],
          runtime_capabilities: runtimeCapabilities,
          human_review_required: false,
          no_publish: true,
          no_external_posting: true,
          no_oauth_or_token_change: true,
          no_database_mutation: true,
        };
      }
      if (!ctx.repos?.db || !runtime?.dependencies) {
        return {
          status: "held",
          story_id: storyId,
          lane_id: laneId,
          blockers: [
            !ctx.repos?.db
              ? "governed_autonomous_production_database_required"
              : "governed_autonomous_production_runtime_dependencies_required",
          ],
          runtime_capabilities: runtimeCapabilities,
          human_review_required: false,
          no_publish: true,
          no_external_posting: true,
          no_oauth_or_token_change: true,
        };
      }
      const {
        materialiseGovernedAutonomousOfficialCandidate,
      } = require("./services/governed-autonomous-production-coordinator");
      const {
        materialiseGovernedAutonomousCandidateCompletionReceipt,
      } = require("./services/governed-autonomous-candidate-completion-receipt");
      const {
        indexGovernedAutonomousCandidateCompletionReceipt,
      } = require("./services/governed-autonomous-candidate-completion-receipt-index");
      autonomousDependencies = {
        materialiseGovernedAutonomousOfficialCandidate,
        materialiseGovernedAutonomousCandidateCompletionReceipt,
        indexGovernedAutonomousCandidateCompletionReceipt,
        productionDependencies: runtime.dependencies,
        db: ctx.repos.db,
      };
    }
    ctx.assertLeaseHealthy?.();
    const production = await runAutonomousProductionJob(
      {
        schema_version:
          "pulse-governed-autonomous-production-job-runner-request-v1",
        mode: "LOCAL_PROOF",
        workspace_root: trustedWorkspaceRoot,
        builder_result: builderResult,
        coordinator_result_output_path: path.join(
          candidateWorkspace,
          "governed-autonomous-coordinator-result.json",
        ),
        completion_receipt_output_path: path.join(
          candidateWorkspace,
          "governed-autonomous-completion-receipt.json",
        ),
      },
      autonomousDependencies,
    );
    ctx.assertLeaseHealthy?.();
    if (
      production?.status !==
        "AUTONOMOUS_CANDIDATE_MATERIALISED" ||
      production?.verdict !== "GREEN"
    ) {
      return {
        status: "held",
        story_id: storyId,
        lane_id: laneId,
        blockers:
          Array.isArray(production?.blockers) &&
          production.blockers.length
            ? production.blockers
            : [
                "governed_autonomous_production_not_materialised",
              ],
        production,
        human_review_required: false,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }
    return {
      status: "autonomous_candidate_materialised",
      story_id: storyId,
      lane_id: laneId,
      production,
      ...(runtimeCapabilities
        ? { runtime_capabilities: runtimeCapabilities }
        : {}),
      human_review_required: false,
      no_publish: true,
      no_external_posting: true,
      no_oauth_or_token_change: true,
    };
  }
  if (laneId === "evergreen_short") {
    const runGovernedEvergreenVerdictProduction =
      ctx.runGovernedEvergreenVerdictProduction ||
      require("./services/evergreen-verdict-production-runner")
        .runGovernedEvergreenVerdictProduction;
    const productionRuntime =
      ctx.evergreenProductionRuntime ||
      (
        ctx.buildGovernedEvergreenProductionRuntime ||
        require("./services/evergreen-verdict-production-runtime")
          .buildGovernedEvergreenProductionRuntime
      )({
        env: ctx.env || process.env,
        dependencies:
          ctx.evergreenProductionDependencies || {},
        executablePaths:
          ctx.evergreenProductionExecutablePaths,
        processRunner:
          ctx.evergreenProductionProcessRunner,
      });
    const productionOutputDir = path.resolve(
      payload.production_out_dir ||
        path.join(
          path.dirname(
            payload.production_work_order_ref.path,
          ),
          "production",
        ),
    );
    ctx.assertLeaseHealthy?.();
    const production =
      await runGovernedEvergreenVerdictProduction({
        productionWorkOrderRef:
          payload.production_work_order_ref,
        outputDir: productionOutputDir,
        generatedAt,
        adapters:
          ctx.evergreenProductionAdapters ||
          productionRuntime.adapters ||
          {},
      });
    production.runtime_capabilities =
      productionRuntime.capabilities || null;
    ctx.assertLeaseHealthy?.();
    if (
      production?.status !==
      "AWAITING_HUMAN_REVIEW"
    ) {
      return {
        status: "held",
        ...(production?.retryable === true
          ? {
              job_outcome: "RETRY",
              retryable: true,
              retry_after_seconds: Number(
                production.retry_after_seconds || 60,
              ),
            }
          : {}),
        story_id: storyId,
        lane_id: laneId,
        blockers:
          production?.blockers?.length
            ? production.blockers
            : ["evergreen_production_not_review_ready"],
        production,
        human_review_required: true,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
        no_database_mutation: true,
      };
    }
    const reviewEvidence = governedReviewEvidenceFromSources({
      payload,
      production,
      story: governedStory,
      storyId,
      laneId,
    });
    const reviewJob = enqueueGovernedLaneReview({
      job,
      ctx,
      laneId,
      storyId,
      generatedAt,
      reviewEvidence,
      upstreamRevisionSha256:
        production.result_sha256 ||
        payload.candidate_revision_sha256,
    });
    return {
      status: "prepared_for_human_review",
      story_id: storyId,
      lane_id: laneId,
      production,
      review_job_id: reviewJob?.id || null,
      human_review_required: true,
      no_publish: true,
      no_external_posting: true,
      no_oauth_or_token_change: true,
      no_database_mutation: true,
    };
  }

  const produceExactStory =
    ctx.produceExactStory || require("../publisher").produce;
  ctx.assertLeaseHealthy?.();
  const production = await produceExactStory({
    storyIds: [storyId],
    laneId,
  });
  ctx.assertLeaseHealthy?.();
  const postProductionStory =
    ctx.repos?.stories?.get?.(storyId) || governedStory;
  const reviewEvidence = governedReviewEvidenceFromSources({
    payload,
    production,
    story: postProductionStory,
    storyId,
    laneId,
  });
  const reviewJob = enqueueGovernedLaneReview({
    job,
    ctx,
    laneId,
    storyId,
    generatedAt,
    reviewEvidence,
    upstreamRevisionSha256:
      payload.candidate_revision_sha256,
  });
  return {
    status: "prepared_for_human_review",
    story_id: storyId,
    lane_id: laneId,
    production,
    review_job_id: reviewJob?.id || null,
    human_review_required: true,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function collectEvergreenCandidateInputs(repos) {
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") {
    return {
      stories: [],
      history: [],
      advertiser_safety_scores: [],
    };
  }
  let stories = [];
  try {
    stories = db
      .prepare(`
        SELECT *
        FROM stories
        ORDER BY COALESCE(updated_at, created_at) DESC
        LIMIT 250
      `)
      .all();
  } catch {
    return {
      stories: [],
      history: [],
      advertiser_safety_scores: [],
    };
  }
  let advertiserSafetyScores = [];
  try {
    const rows = db
      .prepare(`
        SELECT *
        FROM story_scores
        ORDER BY scored_at DESC, id DESC
        LIMIT 1000
      `)
      .all();
    const storyIds = new Set(stories.map((story) => String(story.id)));
    const seen = new Set();
    advertiserSafetyScores = rows.filter((row) => {
      const storyId = String(row?.story_id || "");
      if (
        !storyIds.has(storyId) ||
        seen.has(storyId)
      ) {
        return false;
      }
      seen.add(storyId);
      return true;
    });
  } catch {
    advertiserSafetyScores = [];
  }
  const history = stories
    .map((story) => {
      const extra = parseStoryExtra(story);
      return {
        story_id: story.id,
        lane_id:
          String(
            extra.editorial_format ||
              extra.format_intent ||
              extra.format_id ||
              "",
          ).toLowerCase() === "evergreen_verdict_short"
            ? "evergreen_short"
            : null,
        editorial_format:
          extra.editorial_format || extra.format_intent || null,
        franchise: extra.evergreen_pitch?.franchise || null,
        published_at: story.published_at || null,
        scheduled_for: extra.scheduled_for || null,
      };
    })
    .filter(
      (item) =>
        item.lane_id === "evergreen_short" &&
        (item.published_at || item.scheduled_for),
    );
  return {
    stories,
    history,
    advertiser_safety_scores: advertiserSafetyScores,
  };
}

function mergeEditorialInventoryStories(
  canonicalStories = [],
  inventoryStories = [],
) {
  const merged = new Map();
  for (const story of canonicalStories) {
    const id = String(story?.id || "").trim();
    if (id) merged.set(id, { ...story });
  }
  for (const inventoryStory of inventoryStories) {
    const id = String(inventoryStory?.id || "").trim();
    if (!id) continue;
    const canonical = merged.get(id) || {};
    merged.set(id, {
      ...canonical,
      ...inventoryStory,
      _extra: JSON.stringify({
        ...parseStoryExtra(canonical),
        ...parseStoryExtra(inventoryStory),
      }),
    });
  }
  return [...merged.values()];
}

function mergeWeeklyLongformCandidates(
  canonicalCandidates = [],
  inventoryCandidates = [],
) {
  const merged = new Map();
  for (const candidate of canonicalCandidates) {
    const id = weeklyCandidateId(candidate);
    if (id) merged.set(id, { ...candidate });
  }
  for (const inventoryCandidate of inventoryCandidates) {
    const id = weeklyCandidateId(inventoryCandidate);
    if (!id) continue;
    const canonical = merged.get(id) || {};
    merged.set(id, {
      ...canonical,
      ...inventoryCandidate,
      weekly_priority_score: Math.max(
        Number(canonical.weekly_priority_score || 0),
        Number(inventoryCandidate.weekly_priority_score || 0),
      ),
    });
  }
  return [...merged.values()];
}

async function scanEditorialInventoryForJob({
  ctx,
  payload,
  outputDir,
  now,
} = {}) {
  const scanGovernedEditorialInventory =
    ctx.scanGovernedEditorialInventory ||
    require("./services/governed-editorial-inventory-registry")
      .scanGovernedEditorialInventory;
  const repoRoot = path.join(__dirname, "..");
  const outputRoot = path.join(repoRoot, "output");
  let report;
  try {
    ctx.assertLeaseHealthy?.();
    report = await scanGovernedEditorialInventory({
      rootDir:
        payload.inventory_root_dir ||
        path.join(outputRoot, "editorial-inventory"),
      allowedRoots: Array.isArray(payload.inventory_allowed_roots)
        ? payload.inventory_allowed_roots
        : [outputRoot],
      maximumManifests: payload.inventory_maximum_manifests,
    });
    ctx.assertLeaseHealthy?.();
  } catch (error) {
    report = {
      schema_version:
        "pulse-governed-editorial-inventory-registry-v1",
      generated_at: new Date(now).toISOString(),
      mode: "LOCAL_PROOF",
      verdict: "HOLD",
      blockers: ["governed_editorial_inventory_scan_failed"],
      entries: [],
      rejected: [],
      evergreen_stories: [],
      weekly_longform_candidates: [],
      summary: {
        registry_count: 0,
        ready_count: 0,
        rejected_count: 0,
      },
      failure_code:
        /^[A-Z][A-Z0-9_]{2,79}$/.test(
          String(error?.code || ""),
        )
          ? String(error.code)
          : "GOVERNED_EDITORIAL_INVENTORY_SCAN_FAILED",
      safety: {
        read_only: true,
        network_used: false,
        database_mutated: false,
        oauth_mutated: false,
        platform_contacted: false,
        publish_authority_created: false,
      },
    };
  }
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(
    outputDir,
    "governed_editorial_inventory_scan.json",
  );
  const markdownPath = path.join(
    outputDir,
    "governed_editorial_inventory_scan.md",
  );
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# Pulse Governed Editorial Inventory Scan",
      "",
      `Generated: ${report.generated_at || new Date(now).toISOString()}`,
      `Verdict: ${report.verdict || "HOLD"}`,
      `Ready entries: ${report.summary?.ready_count || 0}`,
      `Rejected entries: ${report.summary?.rejected_count || 0}`,
      "",
      "## Blockers",
      "",
      ...(report.blockers?.length
        ? report.blockers.map((blocker) => `- ${blocker}`)
        : ["- None"]),
      "",
      "This scan is read-only and creates no publishing authority.",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    report,
    json_path: jsonPath,
    markdown_path: markdownPath,
  };
}

function renderEvergreenAutonomousInputAdapterMarkdown(report) {
  const rejected = Array.isArray(report?.rejected_inputs)
    ? report.rejected_inputs
    : [];
  return [
    "# Pulse Evergreen Autonomous Input Evidence",
    "",
    `Generated: ${report?.generated_at || "unknown"}`,
    `Verdict: ${report?.verdict || "HOLD"}`,
    `Accepted: ${report?.summary?.accepted_count || 0}`,
    `Rejected: ${report?.summary?.rejected_count || 0}`,
    "",
    "## Blockers",
    "",
    ...(report?.blockers?.length
      ? report.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "## Rejected inputs",
    "",
    ...(rejected.length
      ? rejected.map(
          (entry) =>
            `- ${
              entry.origin?.story_id ||
              entry.origin?.manifest_id ||
              "unknown"
            }: ${(entry.blockers || []).join(", ") || "held"}`,
        )
      : ["- None"]),
    "",
    "This read-only adapter grants no publishing authority.",
    "",
  ].join("\n");
}

function resolveEvergreenDiscoveryGenerator(ctx, payload) {
  if (typeof ctx.evergreenDiscoveryGenerator === "function") {
    return ctx.evergreenDiscoveryGenerator;
  }
  const client = resolveJobEditorialClient(ctx);
  if (!client) return null;
  const {
    editorialModelFor,
  } = require("./services/governed-editorial-client");
  const {
    createAnthropicEvergreenDiscoveryJsonGenerator,
  } = require("./services/evergreen-autonomous-discovery");
  const requestedModel = String(
    payload.discovery_generator_model ||
      process.env.PULSE_EVERGREEN_DISCOVERY_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      "claude-haiku-4-5-20251001",
  ).trim();
  return createAnthropicEvergreenDiscoveryJsonGenerator({
    client,
    model: editorialModelFor(client, requestedModel),
    max_tokens: Number(
      payload.discovery_generator_max_tokens ||
        process.env.PULSE_EVERGREEN_DISCOVERY_MAX_TOKENS ||
        (client.editorial_identity?.provider === "google"
          ? 8192
          : 4096),
    ),
  });
}

async function persistEvergreenMotionRepairWorkOrders({
  discovery,
  outDir,
  now,
} = {}) {
  const {
    hasValidEvergreenMotionRepairWorkOrderHash,
  } = require("./services/evergreen-motion-repair-work-order");
  const workOrders = Array.isArray(
    discovery?.motion_repair_work_orders,
  )
    ? discovery.motion_repair_work_orders
    : [];
  if (workOrders.length === 0) {
    return {
      work_orders: [],
      rejected_work_orders: [],
      index_json: null,
    };
  }

  const persisted = [];
  const rejected = [];
  for (const workOrder of workOrders) {
    const storyId = String(workOrder?.story_id || "").trim();
    const candidateId = String(
      workOrder?.candidate_id || "",
    ).trim();
    const workOrderSha256 = String(
      workOrder?.work_order_sha256 || "",
    )
      .trim()
      .toLowerCase();
    const blockers = [];
    if (
      workOrder?.schema_version !==
      "pulse-evergreen-motion-coverage-repair-work-order-v1"
    ) {
      blockers.push("motion_repair_work_order_schema_invalid");
    }
    if (!storyId) {
      blockers.push("motion_repair_work_order_story_id_required");
    }
    if (!candidateId) {
      blockers.push(
        "motion_repair_work_order_candidate_id_required",
      );
    }
    if (!/^[a-f0-9]{64}$/.test(workOrderSha256)) {
      blockers.push(
        "motion_repair_work_order_sha256_required",
      );
    } else if (
      !hasValidEvergreenMotionRepairWorkOrderHash(workOrder)
    ) {
      blockers.push(
        "motion_repair_work_order_sha256_mismatch",
      );
    }
    if (blockers.length > 0) {
      rejected.push({
        story_id: storyId || null,
        candidate_id: candidateId || null,
        work_order_sha256: workOrderSha256 || null,
        blockers,
      });
      continue;
    }

    const workOrderDir = path.join(
      outDir,
      "motion-repair",
      safeOutputSegment(storyId),
      workOrderSha256,
    );
    const workOrderPath = path.join(
      workOrderDir,
      "evergreen-motion-coverage-repair-work-order.json",
    );
    const completionManifestPath = path.join(
      workOrderDir,
      "evergreen-motion-coverage-completion.json",
    );
    await fs.ensureDir(workOrderDir);
    if (await fs.pathExists(workOrderPath)) {
      const existing = await fs.readJson(workOrderPath);
      if (
        JSON.stringify(existing) !== JSON.stringify(workOrder)
      ) {
        throw new Error(
          "evergreen_motion_repair_work_order_immutable_conflict",
        );
      }
    } else {
      await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
    }
    const bytes = await fs.readFile(workOrderPath);
    persisted.push({
      story_id: storyId,
      candidate_id: candidateId,
      work_order_sha256: workOrderSha256,
      path: workOrderPath,
      file_sha256: crypto
        .createHash("sha256")
        .update(bytes)
        .digest("hex"),
      completion_manifest_path: completionManifestPath,
    });
  }

  const index = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-index-v1",
    generated_at: new Date(now).toISOString(),
    mode: "LOCAL_PROOF",
    discovery_schema_version:
      discovery?.schema_version || null,
    discovery_generated_at: discovery?.generated_at || null,
    summary: {
      requested_count: workOrders.length,
      persisted_count: persisted.length,
      rejected_count: rejected.length,
    },
    work_orders: persisted,
    rejected_work_orders: rejected,
    safety: {
      local_proof_only: true,
      database_mutated: false,
      oauth_mutated: false,
      external_platform_contacted: false,
      publish_authority_created: false,
    },
  };
  const indexJson = path.join(
    outDir,
    "evergreen_motion_repair_work_orders.json",
  );
  await fs.writeJson(indexJson, index, { spaces: 2 });
  return {
    work_orders: persisted,
    rejected_work_orders: rejected,
    index_json: indexJson,
  };
}

async function handleEvergreenCandidateBuilder(job, ctx) {
  const payload = job?.payload || {};
  const {
    buildEvergreenVerdictCandidateReport,
    renderEvergreenVerdictCandidateReportMarkdown,
  } = require("./services/evergreen-verdict-candidate-builder");
  ctx.assertLeaseHealthy?.();
  let collected =
    Array.isArray(payload.stories) || Array.isArray(payload.history)
      ? {
          stories: Array.isArray(payload.stories)
            ? payload.stories
            : [],
          history: Array.isArray(payload.history)
            ? payload.history
            : [],
        }
      : collectEvergreenCandidateInputs(ctx.repos);
  const now = payload.now || new Date().toISOString();
  const outDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "evergreen-verdict-candidates",
        "current",
      ),
  );
  await fs.ensureDir(outDir);
  let editorialInventoryScan = null;
  if (
    !Array.isArray(payload.stories) &&
    payload.scan_editorial_inventory !== false
  ) {
    editorialInventoryScan = await scanEditorialInventoryForJob({
      ctx,
      payload,
      outputDir: outDir,
      now,
    });
    collected = {
      ...collected,
      stories: mergeEditorialInventoryStories(
        collected.stories,
        editorialInventoryScan.report.evergreen_stories,
      ),
    };
  }
  let autonomousInputAdapter = null;
  let autonomousInputAdapterJson = null;
  let autonomousInputAdapterMarkdown = null;
  let discoveryStories = [];
  let discoverySourceManifests = [];
  if (ctx.prevalidatedEvergreenDiscoveryInputs === true) {
    discoveryStories = Array.isArray(payload.discovery_stories)
      ? payload.discovery_stories
      : [];
    discoverySourceManifests = Array.isArray(
      payload.discovery_manifests,
    )
      ? payload.discovery_manifests
      : [];
  } else {
    const rawDiscoveryStories = Array.isArray(
      payload.discovery_stories,
    )
      ? payload.discovery_stories
      : collected.stories;
    const rawDiscoveryManifests = Array.isArray(
      payload.discovery_manifests,
    )
      ? payload.discovery_manifests
      : Array.isArray(collected.discovery_manifests)
        ? collected.discovery_manifests
        : [];
    const buildEvergreenAutonomousDiscoveryInputs =
      ctx.buildEvergreenAutonomousDiscoveryInputs ||
      require("./services/evergreen-autonomous-input-adapter")
        .buildEvergreenAutonomousDiscoveryInputs;
    ctx.assertLeaseHealthy?.();
    try {
      autonomousInputAdapter =
        await buildEvergreenAutonomousDiscoveryInputs({
          stories: rawDiscoveryStories,
          manifests: rawDiscoveryManifests,
          advertiser_safety_scores: Array.isArray(
            payload.advertiser_safety_scores,
          )
            ? payload.advertiser_safety_scores
            : collected.advertiser_safety_scores || [],
          root_dir:
            payload.evidence_root_dir ||
            path.join(__dirname, ".."),
          now,
        });
    } catch (error) {
      autonomousInputAdapter = {
        schema_version:
          "pulse-evergreen-autonomous-input-adapter-v1",
        generated_at: new Date(now).toISOString(),
        mode: "LOCAL_PROOF",
        verdict: "HOLD",
        blockers: [
          "evergreen_autonomous_input_adapter_failed",
        ],
        discovery_inputs: {
          stories: [],
          manifests: [],
        },
        accepted_inputs: [],
        rejected_inputs: [],
        summary: {
          input_count:
            rawDiscoveryStories.length +
            rawDiscoveryManifests.length,
          accepted_count: 0,
          rejected_count:
            rawDiscoveryStories.length +
            rawDiscoveryManifests.length,
        },
        failure_code:
          /^[A-Z][A-Z0-9_]{2,79}$/.test(
            String(error?.code || ""),
          )
            ? String(error.code)
            : "EVERGREEN_AUTONOMOUS_INPUT_ADAPTER_FAILED",
        safety: {
          read_only: true,
          network_used: false,
          database_mutated: false,
          oauth_mutated: false,
          publish_authority_created: false,
        },
      };
    }
    ctx.assertLeaseHealthy?.();
    discoveryStories =
      autonomousInputAdapter.discovery_inputs?.stories || [];
    discoverySourceManifests =
      autonomousInputAdapter.discovery_inputs?.manifests || [];
    autonomousInputAdapterJson = path.join(
      outDir,
      "evergreen_autonomous_inputs.json",
    );
    autonomousInputAdapterMarkdown = path.join(
      outDir,
      "evergreen_autonomous_inputs.md",
    );
    await fs.writeJson(
      autonomousInputAdapterJson,
      autonomousInputAdapter,
      { spaces: 2 },
    );
    await fs.writeFile(
      autonomousInputAdapterMarkdown,
      renderEvergreenAutonomousInputAdapterMarkdown(
        autonomousInputAdapter,
      ),
      "utf8",
    );
  }
  let discovery = null;
  let discoveryJson = null;
  let discoveryMarkdown = null;
  let motionRepairProof = {
    work_orders: [],
    rejected_work_orders: [],
    index_json: null,
  };
  let motionRepairExecutionProof = {
    queued: [],
    reused: [],
    done: [],
    held: [],
  };
  let motionRepairExecutionQueueJson = null;
  if (
    discoveryStories.length > 0 ||
    discoverySourceManifests.length > 0
  ) {
    const {
      discoverEvergreenVerdictPitches,
      renderEvergreenAutonomousDiscoveryMarkdown,
    } = require("./services/evergreen-autonomous-discovery");
    const runDiscovery =
      ctx.discoverEvergreenVerdictPitches ||
      discoverEvergreenVerdictPitches;
    const renderDiscoveryMarkdown =
      ctx.renderEvergreenAutonomousDiscoveryMarkdown ||
      renderEvergreenAutonomousDiscoveryMarkdown;
    ctx.assertLeaseHealthy?.();
    discovery = await runDiscovery({
      stories: discoveryStories,
      manifests: discoverySourceManifests,
      history: collected.history,
      reference_titles: Array.isArray(payload.reference_titles)
        ? payload.reference_titles
        : [],
      policy: payload.discovery_policy,
      generator: resolveEvergreenDiscoveryGenerator(ctx, payload),
      now,
    });
    ctx.assertLeaseHealthy?.();
    discoveryJson = path.join(
      outDir,
      "evergreen_autonomous_discovery.json",
    );
    discoveryMarkdown = path.join(
      outDir,
      "evergreen_autonomous_discovery.md",
    );
    await fs.writeJson(discoveryJson, discovery, { spaces: 2 });
    await fs.writeFile(
      discoveryMarkdown,
      renderDiscoveryMarkdown(discovery),
      "utf8",
    );
    motionRepairProof =
      await persistEvergreenMotionRepairWorkOrders({
        discovery,
        outDir,
        now,
      });
    if (motionRepairProof.work_orders.length > 0) {
      const {
        enqueueEvergreenMotionRepairExecutions,
      } = require("./services/evergreen-motion-repair-execution");
      motionRepairExecutionProof =
        await enqueueEvergreenMotionRepairExecutions({
          workOrders: motionRepairProof.work_orders,
          jobs: ctx.repos?.jobs,
          channelId:
            job.channel_id ||
            process.env.CHANNEL ||
            "pulse-gaming",
          now,
        });
      motionRepairExecutionQueueJson = path.join(
        outDir,
        "evergreen_motion_repair_execution_queue.json",
      );
      await fs.writeJson(
        motionRepairExecutionQueueJson,
        motionRepairExecutionProof,
        { spaces: 2 },
      );
    }
  }
  const candidateManifests = [
    ...(Array.isArray(payload.manifests)
      ? payload.manifests
      : []),
    ...(Array.isArray(discovery?.candidate_manifests)
      ? discovery.candidate_manifests
      : []),
  ];
  const report = buildEvergreenVerdictCandidateReport({
    stories: collected.stories,
    history: collected.history,
    manifests: candidateManifests,
    policy: payload.policy,
    now,
  });

  const queued = [];
  if (ctx.repos?.jobs?.enqueue) {
    for (const selected of report.selected_candidates) {
      const storyId = String(
        (selected.origin?.kind === "story_extra"
          ? selected.origin.id
          : selected.candidate?.origin_story_id) || "",
      ).trim();
      const candidateId = String(
        selected.candidate?.id || "",
      ).trim();
      if (!storyId || !candidateId) continue;
      const hasMaterialisedEditorial =
        selected.candidate?.script_material &&
        typeof selected.candidate.script_material === "object" &&
        !Array.isArray(selected.candidate.script_material) &&
        Array.isArray(selected.candidate?.visual_beats) &&
        selected.candidate.visual_beats.length > 0;
      const nextKind = hasMaterialisedEditorial
        ? "plan_evergreen_short"
        : "enrich_evergreen_short";
      const planned = ctx.repos.jobs.enqueue({
        kind: nextKind,
        channel_id:
          job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          lane_id: "evergreen_short",
          story_id: storyId,
          candidate_id: candidateId,
          evergreen_pitch: selected.candidate,
          candidate_assessment: selected.assessment,
          publish_authority: false,
        },
        priority: 12,
        requires_gpu: false,
        max_attempts: 3,
        idempotency_key:
          `${
            hasMaterialisedEditorial ? "plan" : "enrich"
          }:evergreen_short:${storyId}:${candidateId}`,
      });
      queued.push({
        id: planned.id,
        kind: planned.kind,
        story_id: storyId,
      });
    }
  }
  const reportJson = path.join(
    outDir,
    "evergreen_candidate_report.json",
  );
  const reportMarkdown = path.join(
    outDir,
    "evergreen_candidate_report.md",
  );
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(
    reportMarkdown,
    renderEvergreenVerdictCandidateReportMarkdown(report),
    "utf8",
  );
  ctx.assertLeaseHealthy?.();
  ctx.log?.(
    `[evergreen] assessed=${report.summary.explicit_pitch_count} selected=${report.summary.selected_candidate_count}`,
  );
  return {
    ok: true,
    selected_candidate_count:
      report.summary.selected_candidate_count,
    queued_planning_jobs: queued,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    discovery_json: discoveryJson,
    discovery_markdown: discoveryMarkdown,
    discovery_verdict: discovery?.verdict || null,
    motion_repair_work_order_count:
      motionRepairProof.work_orders.length,
    motion_repair_work_orders:
      motionRepairProof.work_orders,
    rejected_motion_repair_work_orders:
      motionRepairProof.rejected_work_orders,
    motion_repair_work_order_index_json:
      motionRepairProof.index_json,
    motion_repair_execution_jobs:
      motionRepairExecutionProof.queued,
    reused_motion_repair_execution_jobs:
      motionRepairExecutionProof.reused,
    completed_motion_repair_execution_jobs:
      motionRepairExecutionProof.done,
    held_motion_repair_executions:
      motionRepairExecutionProof.held,
    motion_repair_execution_queue_json:
      motionRepairExecutionQueueJson,
    autonomous_input_adapter_json:
      autonomousInputAdapterJson,
    autonomous_input_adapter_markdown:
      autonomousInputAdapterMarkdown,
    autonomous_input_adapter_verdict:
      autonomousInputAdapter?.verdict || null,
    editorial_inventory_scan_json:
      editorialInventoryScan?.json_path || null,
    editorial_inventory_scan_markdown:
      editorialInventoryScan?.markdown_path || null,
    editorial_inventory_ready_count:
      editorialInventoryScan?.report?.summary?.ready_count || 0,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handleMaterializeEvergreenMotionRepair(job, ctx) {
  const payload = job?.payload || {};
  const blockers = [];
  if (
    payload.schema_version !==
      "pulse-evergreen-motion-repair-materialization-job-v1" ||
    payload.apply_local_authorised !== true ||
    payload.human_review_required !== true ||
    payload.publish_authority !== false ||
    payload.external_posting_authorised !== false ||
    payload.oauth_mutation_authorised !== false
  ) {
    blockers.push(
      "motion_repair_materialization_job_safety_envelope_invalid",
    );
  }
  if (
    String(job?.story_id || "").trim() !==
      String(payload.story_id || "").trim() ||
    !String(payload.candidate_id || "").trim()
  ) {
    blockers.push(
      "motion_repair_materialization_job_identity_mismatch",
    );
  }
  const {
    inspectEvergreenMotionRepairExecutionRequest,
  } = require("./services/evergreen-motion-repair-execution");
  ctx.assertLeaseHealthy?.();
  const inspection =
    await inspectEvergreenMotionRepairExecutionRequest({
      workOrderRecord: payload.work_order,
    });
  blockers.push(...inspection.blockers);
  const executionRequestRef =
    payload.execution_request &&
    typeof payload.execution_request === "object" &&
    !Array.isArray(payload.execution_request)
      ? payload.execution_request
      : {};
  if (
    path.resolve(
      String(executionRequestRef.path || ""),
    ) !== path.resolve(inspection.request_path || "") ||
    String(
      executionRequestRef.file_sha256 || "",
    ).toLowerCase() !==
      String(
        inspection.request_file_sha256 || "",
      ).toLowerCase() ||
    String(
      executionRequestRef.request_sha256 || "",
    ).toLowerCase() !==
      String(
        inspection.request?.request_sha256 || "",
      ).toLowerCase()
  ) {
    blockers.push(
      "motion_repair_execution_request_job_binding_mismatch",
    );
  }
  if (
    inspection.request &&
    (String(inspection.request.story_id || "").trim() !==
      String(payload.story_id || "").trim() ||
      String(inspection.request.candidate_id || "").trim() !==
        String(payload.candidate_id || "").trim())
  ) {
    blockers.push(
      "motion_repair_execution_request_job_identity_mismatch",
    );
  }
  if (blockers.length > 0) {
    return {
      status: "HOLD",
      blockers: [...new Set(blockers)].sort(),
      receipt_path: null,
      no_publish: true,
      no_external_posting: true,
      no_oauth_or_token_change: true,
    };
  }

  const materializeEvergreenMotionRepair =
    ctx.materializeEvergreenMotionRepair ||
    require("./services/evergreen-motion-repair-materializer")
      .materializeEvergreenMotionRepair;
  ctx.assertLeaseHealthy?.();
  const result = await materializeEvergreenMotionRepair({
    work_order_path:
      inspection.execution.work_order_path,
    source_video_path:
      inspection.execution.source_video_path,
    source_video_sha256:
      inspection.execution.source_video_sha256,
    source_media_url:
      inspection.execution.source_media_url,
    segments: inspection.execution.segments,
    output_dir: inspection.execution.output_dir,
    apply_local: true,
    now:
      inspection.request.generated_at ||
      payload.generated_at ||
      new Date().toISOString(),
  });
  ctx.assertLeaseHealthy?.();
  const receiptPath = path.resolve(
    String(result?.receipt_path || ""),
  );
  const receiptFileSha256 = String(
    result?.receipt_file_sha256 || "",
  ).toLowerCase();
  const resultSafety = result?.safety || {};
  if (
    result?.schema_version !==
      "pulse-evergreen-motion-materialisation-v1" ||
    result?.verdict !== "MATERIALISED" ||
    String(result?.story_id || "").trim() !==
      String(payload.story_id || "").trim() ||
    String(result?.candidate_id || "").trim() !==
      String(payload.candidate_id || "").trim() ||
    String(result?.work_order_sha256 || "").toLowerCase() !==
      String(
        payload.work_order?.work_order_sha256 || "",
      ).toLowerCase() ||
    !/^[a-f0-9]{64}$/.test(receiptFileSha256) ||
    !(await fs.pathExists(receiptPath)) ||
    crypto
      .createHash("sha256")
      .update(await fs.readFile(receiptPath))
      .digest("hex") !== receiptFileSha256 ||
    resultSafety.network_used !== false ||
    resultSafety.database_mutated !== false ||
    resultSafety.oauth_mutated !== false ||
    resultSafety.external_platform_contacted !== false ||
    resultSafety.publish_authority_created !== false
  ) {
    throw new Error(
      "evergreen_motion_repair_materializer_result_invalid",
    );
  }
  return {
    status: "MATERIALISED_AWAITING_COMPLETION",
    blockers: [
      "motion_repair_completion_manifest_required",
    ],
    story_id: payload.story_id,
    candidate_id: payload.candidate_id,
    work_order_sha256:
      payload.work_order.work_order_sha256,
    receipt_path: receiptPath,
    receipt_file_sha256: receiptFileSha256,
    completion_manifest_path: path.join(
      path.dirname(
        inspection.execution.work_order_path,
      ),
      "evergreen-motion-coverage-completion.json",
    ),
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function bindEvergreenPitchEvidence(pitch, storyId) {
  const crypto = require("node:crypto");
  const value =
    pitch && typeof pitch === "object" && !Array.isArray(pitch)
      ? structuredClone(pitch)
      : {};
  value.story_id = String(storyId || "").trim();
  value.claims = (Array.isArray(value.claims) ? value.claims : []).map(
    (claim, index) => {
      if (
        claim &&
        typeof claim === "object" &&
        String(claim.id || "").trim()
      ) {
        return claim;
      }
      const material = JSON.stringify({
        text: String(claim?.text || claim?.claim || "").trim(),
        source_url: String(claim?.source_url || "").trim(),
        index,
      });
      return {
        ...(claim || {}),
        id:
          "claim-" +
          crypto
            .createHash("sha256")
            .update(material)
            .digest("hex")
            .slice(0, 16),
      };
    },
  );
  return value;
}

function resolveEvergreenPitchGenerator(ctx, payload) {
  if (Object.hasOwn(ctx, "evergreenPitchGenerator")) {
    return typeof ctx.evergreenPitchGenerator === "function"
      ? ctx.evergreenPitchGenerator
      : null;
  }
  const {
    createAnthropicEvergreenJsonGenerator,
  } = require("./services/evergreen-verdict-pitch-enrichment");
  const client = resolveJobEditorialClient(ctx);
  if (!client) return null;
  const {
    editorialModelFor,
  } = require("./services/governed-editorial-client");
  const requestedModel = String(
    payload.generator_model ||
      process.env.PULSE_EVERGREEN_GENERATOR_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      "claude-haiku-4-5-20251001",
  ).trim();
  return createAnthropicEvergreenJsonGenerator({
    client,
    model: editorialModelFor(client, requestedModel),
    max_tokens: Number(
      payload.generator_max_tokens ||
        process.env.PULSE_EVERGREEN_GENERATOR_MAX_TOKENS ||
        4096,
    ),
  });
}

function normaliseScriptForExactComparison(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleEvergreenShortEnrichment(job, ctx) {
  const crypto = require("node:crypto");
  const payload = job?.payload || {};
  const storyId = String(payload.story_id || "").trim();
  const blockers = [];
  if (!storyId) blockers.push("exact_story_id_required");
  const story =
    storyId && ctx.repos?.stories?.get
      ? ctx.repos.stories.get(storyId)
      : null;
  if (storyId && !story) blockers.push("exact_story_not_found");
  const suppliedPitch =
    payload.evergreen_pitch &&
    typeof payload.evergreen_pitch === "object" &&
    !Array.isArray(payload.evergreen_pitch)
      ? payload.evergreen_pitch
      : parseStoryExtra(story || {}).evergreen_pitch;
  if (
    !suppliedPitch ||
    typeof suppliedPitch !== "object" ||
    Array.isArray(suppliedPitch)
  ) {
    blockers.push("explicit_evergreen_pitch_required");
  }
  const now = new Date(
    payload.now || new Date().toISOString(),
  ).toISOString();
  const outDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "evergreen-verdict-enrichment",
        safeOutputSegment(storyId),
      ),
  );
  await fs.ensureDir(outDir);
  const resultJson = path.join(
    outDir,
    "evergreen-pitch-enrichment.json",
  );
  const resultMarkdown = path.join(
    outDir,
    "evergreen-pitch-enrichment.md",
  );
  let enrichment = null;
  if (!blockers.length) {
    const governedPitch = bindEvergreenPitchEvidence(
      suppliedPitch,
      storyId,
    );
    const {
      assessEvergreenVerdictCandidate,
    } = require("./formats/evergreen-verdict-short");
    const assessment = assessEvergreenVerdictCandidate(
      governedPitch,
      {
        history: Array.isArray(payload.history)
          ? payload.history
          : [],
        policy: payload.policy,
        now,
      },
    );
    const enrichEvergreenVerdictPitch =
      ctx.enrichEvergreenVerdictPitch ||
      require("./services/evergreen-verdict-pitch-enrichment")
        .enrichEvergreenVerdictPitch;
    const generator = resolveEvergreenPitchGenerator(ctx, payload);
    ctx.assertLeaseHealthy?.();
    enrichment = await enrichEvergreenVerdictPitch({
      story: {
        id: story.id,
        title: story.title,
        url:
          story.url ||
          story.article_url ||
          parseStoryExtra(story).primary_source_url ||
          "",
        source_confidence:
          story.source_confidence ||
          parseStoryExtra(story).source_confidence ||
          parseStoryExtra(story).verification_status ||
          story.verification_status ||
          "",
      },
      evergreen_pitch: governedPitch,
      assessment,
      generator,
      history: Array.isArray(payload.history)
        ? payload.history
        : [],
      policy: payload.policy,
      now,
    });
    ctx.assertLeaseHealthy?.();
    blockers.push(...(enrichment.blockers || []));
  }
  const proposalScript = String(
    enrichment?.work_order_result?.work_order?.script_contract
      ?.full_script || "",
  ).trim();
  const currentScript = String(story?.full_script || "").trim();
  const proposedScriptSha256 = proposalScript
    ? crypto
        .createHash("sha256")
        .update(proposalScript)
        .digest("hex")
    : null;
  const currentScriptSha256 = currentScript
    ? crypto
        .createHash("sha256")
        .update(currentScript)
        .digest("hex")
    : null;
  const exactScriptAlreadyAdmitted =
    Boolean(proposalScript) &&
    Boolean(story?.approved === true || story?.approved === 1) &&
    normaliseScriptForExactComparison(currentScript) ===
      normaliseScriptForExactComparison(proposalScript);
  const proof = {
    ...(enrichment || {
      schema_version: "pulse-evergreen-pitch-enrichment-v1",
      generated_at: now,
      mode: "LOCAL_PROOF",
      verdict: "BLOCKED",
      blockers: [...new Set(blockers)],
      enriched_pitch: null,
      work_order_result: null,
    }),
    editorial_admission: {
      story_id: storyId || null,
      proposed_script_sha256: proposedScriptSha256,
      current_script_sha256: currentScriptSha256,
      exact_script_already_admitted: exactScriptAlreadyAdmitted,
      human_script_admission_required:
        Boolean(proposalScript) && !exactScriptAlreadyAdmitted,
      story_approved: Boolean(
        story?.approved === true || story?.approved === 1,
      ),
      database_mutated: false,
      publish_authority_created: false,
    },
  };
  await fs.writeJson(resultJson, proof, { spaces: 2 });
  const renderMarkdown =
    ctx.renderEvergreenVerdictPitchEnrichmentMarkdown ||
    require("./services/evergreen-verdict-pitch-enrichment")
      .renderEvergreenVerdictPitchEnrichmentMarkdown;
  const admissionMarkdown = [
    renderMarkdown(proof).trimEnd(),
    "",
    "## Exact script admission",
    "",
    `- Proposed script SHA-256: ${
      proposedScriptSha256 || "not materialised"
    }`,
    `- Current script SHA-256: ${
      currentScriptSha256 || "not present"
    }`,
    `- Exact script already admitted: ${
      exactScriptAlreadyAdmitted ? "yes" : "no"
    }`,
    "",
    "No database or publication mutation was performed.",
    "",
  ].join("\n");
  await fs.writeFile(resultMarkdown, admissionMarkdown, "utf8");

  let planningJob = null;
  if (
    !blockers.length &&
    exactScriptAlreadyAdmitted &&
    ctx.repos?.jobs?.enqueue
  ) {
    const enrichedPitch = enrichment.enriched_pitch;
    const storyExtra = parseStoryExtra(story || {});
    const revisionWorkOrder = structuredClone(
      enrichment?.work_order_result?.work_order || {},
    );
    delete revisionWorkOrder.generated_at;
    const {
      buildCandidateRevision,
    } = require("./services/multi-lane-job-routing");
    const planningRevision = buildCandidateRevision({
      stage: "PLANNING",
      source_evidence_sha256:
        payload.source_evidence_sha256 ||
        storyExtra.source_evidence_sha256 ||
        null,
      script_sha256: proposedScriptSha256,
      media_sha256:
        storyExtra.media_sha256 ||
        storyExtra.preflight_evidence?.media_sha256 ||
        null,
      rights_ledger_sha256:
        storyExtra.rights_ledger_canonical_sha256 ||
        storyExtra.rights_ledger_sha256 ||
        storyExtra.preflight_evidence?.rights_ledger_sha256 ||
        null,
      evergreen_pitch: enrichedPitch,
      work_order: revisionWorkOrder,
    });
    planningJob = ctx.repos.jobs.enqueue({
      kind: "plan_evergreen_short",
      channel_id:
        job.channel_id || process.env.CHANNEL || "pulse-gaming",
      story_id: storyId,
      payload: {
        lane_id: "evergreen_short",
        story_id: storyId,
        candidate_id: enrichedPitch.id,
        evergreen_pitch: enrichedPitch,
        script_sha256: proposedScriptSha256,
        candidate_revision_sha256:
          planningRevision.sha256,
        candidate_revision: planningRevision.bindings,
        publish_authority: false,
        human_review_required: true,
      },
      priority: 12,
      requires_gpu: false,
      max_attempts: 3,
      idempotency_key:
        `plan:evergreen_short:${storyId}:` +
        planningRevision.sha256,
    });
  }
  const status = blockers.length
    ? "HOLD"
    : exactScriptAlreadyAdmitted
      ? "READY_FOR_EXACT_PLANNING"
      : "AWAITING_HUMAN_SCRIPT_ADMISSION";
  return {
    status,
    story_id: storyId || null,
    candidate_id:
      enrichment?.enriched_pitch?.id ||
      String(suppliedPitch?.id || "").trim() ||
      null,
    blockers: [...new Set(blockers)],
    proposed_script_sha256: proposedScriptSha256,
    exact_script_already_admitted: exactScriptAlreadyAdmitted,
    planning_job_id: planningJob?.id || null,
    enrichment_json: resultJson,
    enrichment_markdown: resultMarkdown,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
    no_database_mutation: true,
  };
}

function longformEvidenceOptions(payload = {}) {
  return {
    runId:
      payload.run_id || process.env.PULSE_LONGFORM_RUN_ID || "",
    generatedAt:
      payload.now ||
      payload.generated_at ||
      new Date().toISOString(),
    packagePath:
      payload.package_path ||
      process.env.PULSE_LONGFORM_PACKAGE_PATH ||
      "",
    scriptPath:
      payload.script_path ||
      process.env.PULSE_LONGFORM_SCRIPT_PATH ||
      "",
    audioPath:
      payload.audio_path ||
      process.env.PULSE_LONGFORM_AUDIO_PATH ||
      "",
    masterPath:
      payload.master_path ||
      process.env.PULSE_LONGFORM_MASTER_PATH ||
      "",
    timestampsPath:
      payload.timestamps_path ||
      process.env.PULSE_LONGFORM_TIMESTAMPS_PATH ||
      "",
    rightsPath:
      payload.rights_path ||
      process.env.PULSE_LONGFORM_RIGHTS_PATH ||
      "",
    platformVariantsPath:
      payload.platform_variants_path ||
      process.env.PULSE_LONGFORM_PLATFORM_VARIANTS_PATH ||
      "",
    decodedQaPath:
      payload.decoded_qa_path ||
      process.env.PULSE_LONGFORM_DECODED_QA_PATH ||
      "",
    outputDir: path.resolve(
      payload.out_dir ||
        process.env.PULSE_LONGFORM_EVIDENCE_OUTPUT_DIR ||
        path.join(
          __dirname,
          "..",
          "output",
          "longform-evidence",
          "current",
        ),
    ),
  };
}

function renderLongformRefreshMarkdown(report) {
  return [
    "# Pulse Gaming Longform Evidence Refresh",
    "",
    `Generated: ${report.generated_at}`,
    `Status: ${report.status}`,
    `Run ID: ${report.run_id || "missing"}`,
    "",
    "## Blockers",
    "",
    ...(report.blockers?.length
      ? report.blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "No publication, OAuth or production database authority is granted.",
    "",
  ].join("\n");
}

async function handleLongformEvidenceRefresh(job, ctx) {
  const options = longformEvidenceOptions(job?.payload || {});
  const required = [
    ["runId", "longform_run_id_required"],
    [
      "packagePath",
      "longform_production_package_path_required",
    ],
    ["scriptPath", "longform_script_path_required"],
    ["audioPath", "longform_audio_path_required"],
    ["masterPath", "longform_master_path_required"],
  ];
  const blockers = required
    .filter(([field]) => !String(options[field] || "").trim())
    .map(([, code]) => code);
  await fs.ensureDir(options.outputDir);
  if (blockers.length) {
    const report = {
      schema_version: "pulse-longform-evidence-refresh-v1",
      generated_at: new Date(options.generatedAt).toISOString(),
      run_id: options.runId || null,
      mode: "LOCAL_PROOF",
      status: "BLOCKED",
      blockers,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    };
    const reportJson = path.join(
      options.outputDir,
      "longform-evidence-refresh.json",
    );
    const reportMarkdown = path.join(
      options.outputDir,
      "longform-evidence-refresh.md",
    );
    await fs.writeJson(reportJson, report, { spaces: 2 });
    await fs.writeFile(
      reportMarkdown,
      renderLongformRefreshMarkdown(report),
      "utf8",
    );
    return {
      status: "BLOCKED",
      blockers,
      report_json: reportJson,
      report_markdown: reportMarkdown,
      no_publish: true,
      no_external_posting: true,
      no_oauth_or_token_change: true,
    };
  }

  const {
    materializeLongformSameRunEvidence,
  } = require("./services/longform-same-run-evidence");
  ctx.assertLeaseHealthy?.();
  const result = await materializeLongformSameRunEvidence(options);
  ctx.assertLeaseHealthy?.();
  return {
    status: result.report.status,
    blockers: result.report.blockers,
    report_json: result.paths.report,
    report_markdown: result.paths.summary,
    human_review_packet: result.paths.humanReviewPacket,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function weeklyRunId(now = new Date()) {
  const value = now instanceof Date ? new Date(now) : new Date(now);
  if (Number.isNaN(value.getTime())) {
    throw new Error("weekly_longform_generated_at_invalid");
  }
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(
    Date.UTC(value.getUTCFullYear(), 0, 1),
  );
  const week = Math.ceil(
    ((value - yearStart) / 86_400_000 + 1) / 7,
  );
  return (
    `weekly-flagship-${value.getUTCFullYear()}-W` +
    String(week).padStart(2, "0")
  );
}

function collectWeeklyLongformCandidates(repos) {
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") return [];
  let rows = [];
  try {
    rows = db
      .prepare(`
        SELECT *
        FROM stories
        ORDER BY COALESCE(published_at, created_at) DESC,
                 COALESCE(breaking_score, 0) DESC
        LIMIT 250
      `)
      .all();
  } catch {
    return [];
  }
  return rows.map((row) => {
    const extra = parseStoryExtra(row);
    return {
      id: row.id,
      title: row.title,
      published_at:
        row.published_at || row.timestamp || row.created_at,
      primary_source_url:
        extra.primary_source_url ||
        row.primary_source_url ||
        row.article_url ||
        row.url ||
        null,
      verification_status:
        extra.verification_status ||
        row.verification_status ||
        null,
      weekly_priority_score: Math.max(
        Number(extra.weekly_priority_score || 0),
        Number(row.breaking_score || 0),
        Number(row.virality_score || 0),
        Number(row.score || 0),
      ),
      source_evidence:
        extra.source_evidence ||
        (extra.source_evidence_path
          ? {
              path: extra.source_evidence_path,
              sha256: extra.source_evidence_sha256,
            }
          : null),
      rights_ledger:
        extra.rights_ledger ||
        (extra.rights_ledger_path
          ? {
              path: extra.rights_ledger_path,
              sha256: extra.rights_ledger_sha256,
            }
          : null),
      weekly_longform_pitch:
        extra.weekly_longform_pitch || null,
    };
  });
}

const LONGFORM_PRODUCTION_ONLY_BLOCKERS = new Set([
  "final_narration_evidence_required",
  "real_word_alignment_evidence_required",
  "final_master_evidence_required",
  "human_av_review_pending",
]);

function weeklyCandidateId(candidate = {}) {
  return String(candidate.id || candidate.story_id || "").trim();
}

function resolveWeeklyLongformEditorialGenerator(ctx, payload) {
  if (
    typeof ctx.weeklyLongformEditorialGenerator === "function"
  ) {
    return ctx.weeklyLongformEditorialGenerator;
  }
  const client = resolveJobEditorialClient(ctx);
  if (!client) return null;
  const {
    editorialModelFor,
  } = require("./services/governed-editorial-client");
  const {
    createAnthropicWeeklyLongformJsonGenerator,
  } = require("./services/weekly-longform-editorial-enrichment");
  const requestedModel = String(
    payload.generator_model ||
      process.env.PULSE_LONGFORM_GENERATOR_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      "claude-haiku-4-5-20251001",
  ).trim();
  const requestedMaxTokens =
    payload.generator_max_tokens ||
    process.env.PULSE_LONGFORM_GENERATOR_MAX_TOKENS ||
    null;
  return createAnthropicWeeklyLongformJsonGenerator({
    client,
    model: editorialModelFor(client, requestedModel),
    ...(requestedMaxTokens != null
      ? { max_tokens: Number(requestedMaxTokens) }
      : {}),
  });
}

async function handleWeeklyLongformPlanning(job, ctx) {
  const payload = job?.payload || {};
  const generatedAt = new Date(
    payload.now || new Date().toISOString(),
  ).toISOString();
  const runId =
    String(payload.run_id || "").trim() ||
    weeklyRunId(generatedAt);
  let candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : collectWeeklyLongformCandidates(ctx.repos);
  const editorialFrame =
    payload.editorial_frame &&
    typeof payload.editorial_frame === "object" &&
    !Array.isArray(payload.editorial_frame)
      ? payload.editorial_frame
      : {};
  const outputDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "weekly-longform",
        safeOutputSegment(runId),
      ),
  );
  let editorialInventoryScan = null;
  if (
    !Array.isArray(payload.candidates) &&
    payload.scan_editorial_inventory !== false
  ) {
    editorialInventoryScan = await scanEditorialInventoryForJob({
      ctx,
      payload,
      outputDir,
      now: generatedAt,
    });
    candidates = mergeWeeklyLongformCandidates(
      candidates,
      editorialInventoryScan.report.weekly_longform_candidates,
    );
  }
  const materializeWeeklyLongformWorkOrder =
    ctx.materializeWeeklyLongformWorkOrder ||
    require("./services/weekly-longform-work-order")
      .materializeWeeklyLongformWorkOrder;
  ctx.assertLeaseHealthy?.();
  const materialized =
    await materializeWeeklyLongformWorkOrder({
      outputDir,
      runId,
      generatedAt,
      candidates,
      editorialFrame,
      productionEvidence: payload.production_evidence || null,
    });
  ctx.assertLeaseHealthy?.();
  const workOrder = materialized.workOrder;
  const editorialBlockers = (workOrder.blockers || []).filter(
    (blocker) => !LONGFORM_PRODUCTION_ONLY_BLOCKERS.has(blocker),
  );
  const readyForProduction =
    editorialBlockers.length === 0 &&
    workOrder.selection?.selected?.length >= 4 &&
    Boolean(workOrder.script?.full_script) &&
    Number(workOrder.script?.estimated_duration_seconds) >= 480 &&
    Number(workOrder.script?.estimated_duration_seconds) <= 720 &&
    Number(workOrder.visual_beat_plan?.beat_count) > 0;
  let productionJob = null;
  let editorialEnrichmentJob = null;
  if (readyForProduction && ctx.repos?.jobs?.enqueue) {
    productionJob = ctx.repos.jobs.enqueue({
      kind: "produce_weekly_longform",
      channel_id:
        job.channel_id || process.env.CHANNEL || "pulse-gaming",
      payload: {
        lane_id: "weekly_longform",
        run_id: runId,
        generated_at: generatedAt,
        work_order_path: materialized.paths.json,
        work_order_sha256: materialized.json_sha256,
        publish_authority: false,
        human_review_required: true,
      },
      priority: 34,
      requires_gpu: false,
      max_attempts: 2,
      idempotency_key:
        `produce:weekly_longform:${runId}:` +
        String(materialized.json_sha256).slice(0, 16),
    });
  } else if (
    !readyForProduction &&
    Number(workOrder.selection?.selected?.length || 0) >= 4 &&
    ctx.repos?.jobs?.enqueue
  ) {
    const selectedStoryIds = new Set(
      (workOrder.selection?.selected || [])
        .map((candidate) => weeklyCandidateId(candidate))
        .filter(Boolean),
    );
    const selectedCandidates = candidates.filter((candidate) =>
      selectedStoryIds.has(weeklyCandidateId(candidate)),
    );
    if (
      selectedCandidates.length === selectedStoryIds.size &&
      selectedCandidates.length >= 4 &&
      selectedCandidates.length <= 6
    ) {
      editorialEnrichmentJob = ctx.repos.jobs.enqueue({
        kind: "enrich_weekly_longform",
        channel_id:
          job.channel_id ||
          process.env.CHANNEL ||
          "pulse-gaming",
        payload: {
          lane_id: "weekly_longform",
          run_id: runId,
          candidates: selectedCandidates,
          out_dir: outputDir,
          source_work_order_path: materialized.paths.json,
          source_work_order_sha256:
            materialized.json_sha256,
          publish_authority: false,
          human_review_required: true,
        },
        priority: 33,
        requires_gpu: false,
        max_attempts: 2,
        idempotency_key:
          `enrich:weekly_longform:${runId}:` +
          String(materialized.json_sha256).slice(0, 16),
      });
    }
  }
  return {
    status: readyForProduction
      ? "READY_FOR_LONGFORM_PRODUCTION"
      : editorialEnrichmentJob
        ? "READY_FOR_LONGFORM_EDITORIAL_ENRICHMENT"
        : "HOLD",
    run_id: runId,
    blockers: editorialBlockers,
    selected_story_count:
      workOrder.selection?.selected?.length || 0,
    production_job_id: productionJob?.id || null,
    editorial_enrichment_job_id:
      editorialEnrichmentJob?.id || null,
    work_order_json: materialized.paths.json,
    work_order_markdown: materialized.paths.markdown,
    work_order_sha256: materialized.json_sha256,
    editorial_inventory_scan_json:
      editorialInventoryScan?.json_path || null,
    editorial_inventory_scan_markdown:
      editorialInventoryScan?.markdown_path || null,
    editorial_inventory_ready_count:
      editorialInventoryScan?.report?.summary?.ready_count || 0,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handleWeeklyLongformEditorialEnrichment(job, ctx) {
  const payload = job?.payload || {};
  const generatedAt = new Date(
    payload.now || new Date().toISOString(),
  ).toISOString();
  const runId = String(payload.run_id || "").trim();
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];
  const outputDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "weekly-longform",
        safeOutputSegment(runId || "unresolved"),
      ),
  );
  await fs.ensureDir(outputDir);
  const {
    enrichWeeklyLongformEditorial,
    renderWeeklyLongformEditorialEnrichmentJson,
    renderWeeklyLongformEditorialEnrichmentMarkdown,
  } = require("./services/weekly-longform-editorial-enrichment");
  const enrichmentRunner =
    ctx.enrichWeeklyLongformEditorial ||
    enrichWeeklyLongformEditorial;
  const generator =
    resolveWeeklyLongformEditorialGenerator(ctx, payload);
  let enrichment;
  if (!runId || candidates.length < 4 || candidates.length > 6) {
    enrichment = {
      schema_version:
        "pulse-weekly-longform-editorial-enrichment-v1",
      generated_at: generatedAt,
      run_id: runId || null,
      mode: "LOCAL_PROOF",
      verdict: "BLOCKED",
      blockers: [
        ...(!runId
          ? ["weekly_longform_run_id_required"]
          : []),
        ...(candidates.length < 4 || candidates.length > 6
          ? ["weekly_verified_candidate_count_must_be_4_to_6"]
          : []),
      ],
      editorial_frame: null,
      enriched_candidates: null,
      safety: {
        publish_authority_created: false,
        database_authority_created: false,
      },
    };
  } else {
    ctx.assertLeaseHealthy?.();
    enrichment = await enrichmentRunner({
      runId,
      generatedAt,
      candidates,
      generator,
      generator_identity:
        payload.generator_identity || {},
    });
    ctx.assertLeaseHealthy?.();
  }
  const reportJson = path.join(
    outputDir,
    "weekly-longform-editorial-enrichment.json",
  );
  const reportMarkdown = path.join(
    outputDir,
    "weekly-longform-editorial-enrichment.md",
  );
  await fs.writeFile(
    reportJson,
    renderWeeklyLongformEditorialEnrichmentJson(
      enrichment,
    ),
    "utf8",
  );
  await fs.writeFile(
    reportMarkdown,
    renderWeeklyLongformEditorialEnrichmentMarkdown(
      enrichment,
    ),
    "utf8",
  );

  let productionJob = null;
  let finalWorkOrder = null;
  if (
    enrichment?.verdict === "READY_FOR_LOCAL_PRODUCTION" &&
    Array.isArray(enrichment.enriched_candidates) &&
    enrichment.editorial_frame &&
    ctx.repos?.jobs?.enqueue
  ) {
    const materializeWeeklyLongformWorkOrder =
      ctx.materializeWeeklyLongformWorkOrder ||
      require("./services/weekly-longform-work-order")
        .materializeWeeklyLongformWorkOrder;
    ctx.assertLeaseHealthy?.();
    finalWorkOrder =
      await materializeWeeklyLongformWorkOrder({
        outputDir: path.join(outputDir, "editorial-final"),
        runId,
        generatedAt,
        candidates: enrichment.enriched_candidates,
        editorialFrame: enrichment.editorial_frame,
      });
    ctx.assertLeaseHealthy?.();
    const admitted =
      finalWorkOrder.workOrder?.production_runner_admission
        ?.status === "READY" &&
      finalWorkOrder.workOrder?.safety
        ?.external_publish_authorised === false;
    if (admitted) {
      productionJob = ctx.repos.jobs.enqueue({
        kind: "produce_weekly_longform",
        channel_id:
          job.channel_id ||
          process.env.CHANNEL ||
          "pulse-gaming",
        payload: {
          lane_id: "weekly_longform",
          run_id: runId,
          generated_at: generatedAt,
          work_order_path: finalWorkOrder.paths.json,
          work_order_sha256: finalWorkOrder.json_sha256,
          publish_authority: false,
          human_review_required: true,
        },
        priority: 34,
        requires_gpu: false,
        max_attempts: 2,
        idempotency_key:
          `produce:weekly_longform:${runId}:` +
          String(finalWorkOrder.json_sha256).slice(0, 16),
      });
    }
  }
  const ready = Boolean(productionJob);
  return {
    status: ready
      ? "READY_FOR_LONGFORM_PRODUCTION"
      : "HOLD",
    run_id: runId || null,
    blockers: ready
      ? []
      : [
          ...new Set([
            ...(enrichment?.blockers || []),
            ...(
              finalWorkOrder?.workOrder
                ?.production_runner_admission?.blockers || []
            ),
            ...(
              enrichment?.verdict ===
                "READY_FOR_LOCAL_PRODUCTION" &&
              finalWorkOrder &&
              finalWorkOrder.workOrder
                ?.production_runner_admission?.status !== "READY"
                ? ["weekly_enriched_work_order_not_admitted"]
                : []
            ),
          ]),
        ],
    production_job_id: productionJob?.id || null,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    work_order_json:
      finalWorkOrder?.paths?.json || null,
    work_order_sha256:
      finalWorkOrder?.json_sha256 || null,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handleWeeklyLongformProduction(job, ctx) {
  const crypto = require("node:crypto");
  const payload = job?.payload || {};
  const workOrderPath = path.resolve(
    String(payload.work_order_path || ""),
  );
  const expectedSha = String(
    payload.work_order_sha256 || "",
  )
    .trim()
    .toLowerCase();
  const blockers = [];
  if (!String(payload.run_id || "").trim()) {
    blockers.push("weekly_longform_run_id_required");
  }
  if (!String(payload.work_order_path || "").trim()) {
    blockers.push("weekly_longform_work_order_path_required");
  } else if (!(await fs.pathExists(workOrderPath))) {
    blockers.push("weekly_longform_work_order_missing");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    blockers.push("weekly_longform_work_order_sha256_required");
  }
  let bytes = null;
  let workOrder = null;
  if (!blockers.length) {
    bytes = await fs.readFile(workOrderPath);
    const observedSha = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");
    if (observedSha !== expectedSha) {
      blockers.push(
        "weekly_longform_work_order_sha256_mismatch",
      );
    } else {
      try {
        workOrder = JSON.parse(bytes.toString("utf8"));
      } catch {
        blockers.push("weekly_longform_work_order_json_invalid");
      }
    }
  }
  if (workOrder) {
    if (
      workOrder.schema_version !==
      "pulse-weekly-longform-work-order-v1"
    ) {
      blockers.push("weekly_longform_work_order_schema_invalid");
    }
    if (
      String(workOrder.run_id || "") !==
      String(payload.run_id || "")
    ) {
      blockers.push("weekly_longform_run_id_mismatch");
    }
    if (
      workOrder.safety?.external_publish_authorised !== false ||
      workOrder.safety?.database_mutation_authorised !== false ||
      workOrder.safety?.oauth_mutation_authorised !== false
    ) {
      blockers.push("weekly_longform_safety_contract_invalid");
    }
  }
  if (blockers.length) {
    return {
      status: "HOLD",
      blockers: [...new Set(blockers)],
      run_id: String(payload.run_id || "").trim() || null,
      no_publish: true,
      no_external_posting: true,
    };
  }
  const productionOutputDir = path.resolve(
    payload.out_dir ||
      path.join(
        path.dirname(workOrderPath),
        "production",
      ),
  );
  let runWeeklyLongformProduction =
    ctx.runWeeklyLongformProduction;
  let productionAdapters = ctx.longformProductionAdapters;
  let runtimeStack = null;
  let runtimeCapabilitiesJson = null;
  if (!runWeeklyLongformProduction) {
    const buildWeeklyLongformRuntimeStack =
      ctx.buildWeeklyLongformRuntimeStack ||
      require("./services/weekly-longform-runtime-factory")
        .buildWeeklyLongformRuntimeStack;
    try {
      runtimeStack = buildWeeklyLongformRuntimeStack({
        env: process.env,
        httpClient: ctx.weeklyLongformHttpClient,
        axiosInstance: ctx.weeklyLongformAxios,
        processRunner: ctx.longformProcessRunner,
        renderLongform: ctx.weeklyLongformRender,
        rendererCapabilities:
          ctx.weeklyLongformRendererCapabilities,
        executablePaths:
          ctx.weeklyLongformExecutablePaths,
        hyperframesRuntime:
          ctx.weeklyLongformHyperframesRuntime,
      });
    } catch {
      runtimeStack = {
        capabilities: {
          schema_version:
            "pulse-weekly-longform-runtime-stack-v1",
          ready: false,
          blockers: [
            "weekly_longform_runtime_stack_unavailable",
          ],
          safety: {
            external_publish_authority: false,
            database_mutation_authority: false,
            oauth_mutation_authority: false,
          },
        },
        runtime_capabilities: null,
        renderer_capabilities: null,
        adapter_capabilities: null,
        adapters: {},
      };
    }
    await fs.ensureDir(productionOutputDir);
    const capabilityReport = {
      schema_version:
        "pulse-weekly-longform-runtime-admission-v1",
      generated_at: new Date(
        payload.now ||
          payload.generated_at ||
          new Date().toISOString(),
      ).toISOString(),
      run_id: payload.run_id,
      mode: "LOCAL_PROOF",
      capabilities: runtimeStack.capabilities,
      runtime_capabilities:
        runtimeStack.runtime_capabilities,
      renderer_capabilities:
        runtimeStack.renderer_capabilities,
      adapter_capabilities:
        runtimeStack.adapter_capabilities,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    };
    runtimeCapabilitiesJson = path.join(
      productionOutputDir,
      "weekly-longform-runtime-capabilities.json",
    );
    await fs.writeJson(
      runtimeCapabilitiesJson,
      capabilityReport,
      { spaces: 2 },
    );
    if (runtimeStack.capabilities?.ready !== true) {
      return {
        status: "HOLD",
        blockers: [
          ...new Set([
            "weekly_longform_runtime_not_ready",
            ...(runtimeStack.capabilities?.blockers || []),
          ]),
        ],
        run_id: payload.run_id,
        runtime_capabilities_json:
          runtimeCapabilitiesJson,
        runtime_capabilities:
          runtimeStack.capabilities,
        no_publish: true,
        no_external_posting: true,
        no_oauth_or_token_change: true,
      };
    }
    productionAdapters = runtimeStack.adapters;
    try {
      runWeeklyLongformProduction =
        ctx.governedWeeklyLongformProductionRunner ||
        require("./services/weekly-longform-production-runner")
          .runGovernedWeeklyLongformProduction;
    } catch {
      return {
        status: "HOLD",
        blockers: [
          "weekly_longform_production_runner_unavailable",
        ],
        run_id: payload.run_id,
        runtime_capabilities_json:
          runtimeCapabilitiesJson,
        no_publish: true,
        no_external_posting: true,
      };
    }
  }
  ctx.assertLeaseHealthy?.();
  const result = await runWeeklyLongformProduction({
    workOrder,
    workOrderPath,
    outputDir: productionOutputDir,
    generatedAt:
      payload.now ||
      payload.generated_at ||
      new Date().toISOString(),
    adapters: productionAdapters,
    materializeDerivatives:
      runtimeStack?.materializeDerivatives ||
      ctx.weeklyLongformDerivativeMaterializer,
  });
  ctx.assertLeaseHealthy?.();
  const runId = String(payload.run_id || "").trim();
  const generatedAt = new Date(
    payload.generated_at ||
      payload.now ||
      workOrder.generated_at ||
      new Date().toISOString(),
  ).toISOString();
  const productionWorkOrderRef = {
    path: workOrderPath,
    sha256: expectedSha,
    story_id: runId,
    lane_id: "weekly_longform",
  };
  const postProductionWorkOrderRef =
    result?.review_evidence
      ?.production_work_order_ref &&
    typeof result.review_evidence
      .production_work_order_ref === "object" &&
    !Array.isArray(
      result.review_evidence
        .production_work_order_ref,
    )
      ? result.review_evidence
          .production_work_order_ref
      : productionWorkOrderRef;
  const reviewEvidence = governedReviewEvidenceFromSources({
    payload: {
      ...payload,
      production_work_order_ref:
        postProductionWorkOrderRef,
    },
    production: result,
    storyId: runId,
    laneId: "weekly_longform",
  });
  const reviewJob = enqueueGovernedLaneReview({
    job,
    ctx,
    laneId: "weekly_longform",
    storyId: runId,
    generatedAt,
    reviewEvidence,
    upstreamRevisionSha256:
      result?.result_sha256 || expectedSha,
  });
  return {
    status: result?.status || "HOLD",
    blockers: result?.blockers || [],
    run_id: payload.run_id,
    production: result || null,
    review_job_id: reviewJob?.id || null,
    runtime_capabilities_json:
      runtimeCapabilitiesJson,
    runtime_capabilities:
      runtimeStack?.capabilities || null,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function parseStoryExtra(row = {}) {
  try {
    const parsed = JSON.parse(row._extra || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function latestSafeGovernedEditorialScoreLookup(db) {
  if (!db || typeof db.prepare !== "function") {
    return () => null;
  }
  let latestStatement;
  try {
    latestStatement = db.prepare(`
      SELECT
        total,
        decision,
        hard_stops,
        scored_at
      FROM story_scores
      WHERE story_id = ?
      ORDER BY scored_at DESC, id DESC
      LIMIT 1
    `);
  } catch {
    return () => null;
  }
  return (storyId) => {
    let row;
    try {
      row = latestStatement.get(String(storyId || "").trim());
    } catch {
      return null;
    }
    if (!row) return null;
    const score = Number(row.total);
    const decision = String(row.decision || "")
      .trim()
      .toLowerCase();
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      !["auto", "review"].includes(decision)
    ) {
      return null;
    }
    let hardStops = [];
    if (row.hard_stops != null && String(row.hard_stops).trim()) {
      try {
        hardStops = Array.isArray(row.hard_stops)
          ? row.hard_stops
          : JSON.parse(String(row.hard_stops));
      } catch {
        return null;
      }
      if (!Array.isArray(hardStops)) return null;
    }
    if (hardStops.length) return null;
    return {
      score,
      decision,
      scored_at: row.scored_at || null,
    };
  };
}

function multiLaneIdForStory(row = {}, extra = {}) {
  const explicit = String(
    extra.editorial_format ||
      extra.format_intent ||
      extra.format_id ||
      extra.format_route ||
      "",
  )
    .trim()
    .toLowerCase();
  if (
    [
      "weekly_roundup",
      "weekly_roundup_item",
      "monthly_release_radar",
      "monthly_release_radar_item",
      "pulse_briefing_longform",
      "longform",
    ].includes(explicit)
  ) {
    return "weekly_longform";
  }
  if (explicit === "evergreen_verdict_short") {
    return "evergreen_short";
  }
  if (
    extra.breaking_fast_track === true ||
    extra.breaking === true ||
    Number(row.breaking_score || 0) >= 80 ||
    /\bbreaking\b/i.test(
      `${row.classification || ""} ${row.flair || ""}`,
    )
  ) {
    return "breaking_short";
  }
  return null;
}

function scheduledPublicationForStory(db, storyId) {
  if (!db || typeof db.prepare !== "function") return null;
  try {
    const row = db
      .prepare(`
        SELECT
          state.lifecycle_state,
          event.id AS scheduled_event_id,
          event.evidence_json
        FROM platform_publication_state AS state
        JOIN publication_lifecycle_events AS event
          ON event.id = (
            SELECT candidate.id
            FROM publication_lifecycle_events AS candidate
            WHERE candidate.story_id = state.story_id
              AND candidate.platform = state.platform
              AND candidate.to_state = 'SCHEDULED'
            ORDER BY candidate.id DESC
            LIMIT 1
          )
        WHERE state.story_id = ?
          AND state.platform = 'youtube'
          AND state.lifecycle_state = 'SCHEDULED'
        LIMIT 1
      `)
      .get(storyId);
    if (!row) return null;
    const evidence = JSON.parse(row.evidence_json || "{}");
    return {
      platform: "youtube",
      lifecycle_state: row.lifecycle_state,
      scheduled_event_id: Number(row.scheduled_event_id),
      scheduled_for: evidence.scheduled_for,
      dispatch_idempotency_key:
        evidence.dispatch_idempotency_key,
      request_fingerprint: evidence.request_fingerprint,
      control_tower_verdict: evidence.control_tower_verdict,
    };
  } catch {
    return null;
  }
}

function usableMultiLaneScript(row = {}) {
  const script = String(row.full_script || "").trim();
  if (
    /^script generation failed\.?\s*manual edit required\.?$/i.test(
      script,
    )
  ) {
    return "";
  }
  const normalisedScript = script
    .replace(/\s+/g, " ")
    .toLowerCase();
  const normalisedTitle = String(row.title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (
    normalisedTitle &&
    normalisedScript === normalisedTitle
  ) {
    return "";
  }
  return script;
}

function multiLaneStage(row = {}, extra = {}, publication = null) {
  if (publication) return "SCHEDULED";
  if (
    String(extra?.admission?.approval_type || "")
      .trim()
      .toUpperCase() === AUTONOMOUS_OFFICIAL_ADMISSION_TYPE
  ) {
    return "AUTONOMOUS_ELIGIBLE";
  }
  if (
    [
      extra.human_review_status,
      extra.render_review_status,
      extra.operator_review_status,
    ].some((value) => String(value || "").toLowerCase() === "approved")
  ) {
    return "HUMAN_APPROVED";
  }
  if (
    extra.qa_passed === true ||
    String(extra.qa_status || "").toUpperCase() === "GREEN"
  ) {
    return "QA_PASSED";
  }
  if (row.exported_path && row.audio_path) return "PRODUCTION_READY";
  if (usableMultiLaneScript(row)) return "SCRIPT_READY";
  return "PLANNING";
}

function collectMultiLaneCandidates(
  repos,
  { urgentStoryId = null } = {},
) {
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") return [];
  let rows = [];
  try {
    rows = db
      .prepare(`
        SELECT *
        FROM stories
        WHERE COALESCE(youtube_post_id, '') = ''
          AND COALESCE(publish_status, '') NOT IN (
            'failed',
            'canonical_projection_consumed'
          )
        ORDER BY
          datetime(COALESCE(published_at, timestamp, created_at)) DESC,
          breaking_score DESC,
          score DESC,
          created_at DESC
        LIMIT 100
      `)
      .all();
  } catch {
    return [];
  }
  const exactUrgentStoryId = String(
    urgentStoryId || "",
  ).trim();
  if (
    exactUrgentStoryId &&
    !rows.some(
      (row) =>
        String(row?.id || "").trim() === exactUrgentStoryId,
    )
  ) {
    try {
      const exactUrgentRow = db
        .prepare(`
          SELECT *
          FROM stories
          WHERE id = ?
            AND COALESCE(youtube_post_id, '') = ''
            AND COALESCE(publish_status, '') NOT IN (
              'failed',
              'canonical_projection_consumed'
            )
          LIMIT 1
        `)
        .get(exactUrgentStoryId);
      if (exactUrgentRow) rows.unshift(exactUrgentRow);
    } catch {
      // The bounded candidate set remains usable if an older schema
      // cannot service the exact urgent lookup.
    }
  }
  const governedEditorialScoreFor =
    latestSafeGovernedEditorialScoreLookup(db);
  return rows
    .map((row) => {
      const extra = parseStoryExtra(row);
      const laneId = multiLaneIdForStory(row, extra);
      if (!laneId) return null;
      const governedEditorialScore =
        governedEditorialScoreFor(row.id);
      const publication = scheduledPublicationForStory(db, row.id);
      const persistedAdmission =
        extra.admission &&
        typeof extra.admission === "object" &&
        !Array.isArray(extra.admission)
          ? structuredClone(extra.admission)
          : null;
      const fullScript = usableMultiLaneScript(row);
      const declaredScriptSha256 = String(
        extra.script_sha256 || row.script_sha256 || "",
      )
        .trim()
        .toLowerCase();
      const scriptSha256 =
        fullScript
          ? /^[a-f0-9]{64}$/.test(declaredScriptSha256)
            ? declaredScriptSha256
            : crypto
                .createHash("sha256")
                .update(fullScript)
                .digest("hex")
          : null;
      return {
        lane_id: laneId,
        story_id: row.id,
        title: row.title,
        published_at:
          row.published_at ||
          row.timestamp ||
          row.created_at ||
          null,
        freshness:
          extra.freshness &&
          typeof extra.freshness === "object" &&
          !Array.isArray(extra.freshness)
            ? structuredClone(extra.freshness)
            : null,
        score: Math.max(
          Number(row.breaking_score || 0),
          Number(row.virality_score || 0),
          Number(row.quality_score || 0),
          Number(row.score || 0),
          Number(governedEditorialScore?.score || 0),
        ),
        governed_editorial_score:
          governedEditorialScore?.score ?? null,
        governed_editorial_decision:
          governedEditorialScore?.decision ?? null,
        governed_editorial_scored_at:
          governedEditorialScore?.scored_at ?? null,
        stage: multiLaneStage(row, extra, publication),
        approval_type:
          extra.approval_type ||
          persistedAdmission?.approval_type ||
          null,
        publication,
        admission: persistedAdmission,
        verification_status:
          extra.verification_status ||
          row.verification_status ||
          null,
        verified_for_planning:
          extra.verified_for_planning === true,
        primary_source_url:
          extra.primary_source_url ||
          row.primary_source_url ||
          row.article_url ||
          row.url ||
          null,
        source_evidence_sha256:
          extra.source_evidence_sha256 ||
          row.source_evidence_sha256 ||
          null,
        source_evidence_path:
          extra.source_evidence_path ||
          row.source_evidence_path ||
          null,
        source_evidence_file_sha256:
          extra.source_evidence_file_sha256 ||
          row.source_evidence_file_sha256 ||
          null,
        script_sha256: scriptSha256,
        media_sha256:
          extra.media_sha256 ||
          extra.preflight_evidence?.media_sha256 ||
          row.media_sha256 ||
          null,
        rights_ledger_sha256:
          extra.rights_ledger_canonical_sha256 ||
          extra.rights_ledger_sha256 ||
          extra.preflight_evidence?.rights_ledger_sha256 ||
          row.rights_ledger_sha256 ||
          null,
        qa_report_sha256:
          extra.qa_report_sha256 ||
          extra.preflight_evidence?.qa_report_sha256 ||
          persistedAdmission?.evidence?.qa_report_sha256 ||
          row.qa_report_sha256 ||
          null,
        eligibility_verdict:
          extra.runway_eligibility_verdict ||
          extra.eligibility_verdict ||
          null,
        standby_authorised:
          extra.runway_standby_authorised === true ||
          extra.standby_authorised === true,
        human_review_evidence_sha256:
          extra.human_review_evidence_sha256 || null,
        human_review_event_id:
          extra.human_review_event_id || null,
        admission_evidence_sha256:
          extra.admission_evidence_sha256 || null,
        admission_event_id:
          extra.admission_event_id || null,
        candidate_revision_sha256:
          extra.candidate_revision_sha256 || null,
        candidate_binding_sha256:
          extra.candidate_binding_sha256 || null,
        request_fingerprint:
          extra.request_fingerprint || null,
        autonomous_eligibility_attestation_sha256:
          extra
            .autonomous_eligibility_attestation_sha256 ||
          persistedAdmission
            ?.autonomous_eligibility_attestation_sha256 ||
          null,
        pitch_sha256:
          extra.pitch_sha256 ||
          extra.evergreen_pitch_sha256 ||
          null,
        evergreen_pitch:
          extra.evergreen_pitch &&
          typeof extra.evergreen_pitch === "object" &&
          !Array.isArray(extra.evergreen_pitch)
            ? structuredClone(extra.evergreen_pitch)
            : null,
        evergreen_pitch_manifest:
          extra.evergreen_pitch_manifest &&
          typeof extra.evergreen_pitch_manifest === "object" &&
          !Array.isArray(extra.evergreen_pitch_manifest)
            ? structuredClone(
                extra.evergreen_pitch_manifest,
              )
            : null,
        evidence_provenance:
          (extra.evidence_provenance ||
            extra.evergreen_evidence_provenance) &&
          typeof (
            extra.evidence_provenance ||
            extra.evergreen_evidence_provenance
          ) === "object" &&
          !Array.isArray(
            extra.evidence_provenance ||
              extra.evergreen_evidence_provenance,
          )
            ? structuredClone(
                extra.evidence_provenance ||
                  extra.evergreen_evidence_provenance,
              )
            : null,
        work_order_sha256:
          extra.work_order_sha256 ||
          extra.weekly_longform_work_order_sha256 ||
          null,
        work_order:
          (extra.work_order ||
            extra.weekly_longform_work_order) &&
          typeof (
            extra.work_order ||
            extra.weekly_longform_work_order
          ) === "object" &&
          !Array.isArray(
            extra.work_order ||
              extra.weekly_longform_work_order,
          )
            ? structuredClone(
                extra.work_order ||
                  extra.weekly_longform_work_order,
              )
            : null,
        work_order_path:
          extra.work_order_path ||
          extra.weekly_longform_work_order_path ||
          null,
        weekly_longform_work_order_ref:
          extra.weekly_longform_work_order_ref &&
          typeof extra.weekly_longform_work_order_ref ===
            "object" &&
          !Array.isArray(
            extra.weekly_longform_work_order_ref,
          )
            ? structuredClone(
                extra.weekly_longform_work_order_ref,
              )
            : null,
      };
    })
    .filter(Boolean);
}

const MULTI_LANE_POOL_BY_KIND = Object.freeze({
  breaking_story_discovery: "breaking_planning",
  governed_editorial_evidence_backfill:
    "critical_planning",
  governed_editorial_evidence_discovery:
    "editorial_evidence_capture",
  reconcile_editorial_inventory: "editorial_preparation",
  prepare_editorial_inventory: "editorial_preparation",
  hunt: "critical_planning",
  governed_multi_lane_plan: "critical_planning",
  plan_governed_autonomous_window_production:
    "critical_planning",
  governed_youtube_window_inventory_monitor:
    "critical_planning",
  prime_governed_youtube_window_checkpoints:
    "critical_planning",
  prepare_governed_autonomous_pre_t90_window:
    "window_deadline",
  governed_youtube_runway_t90: "window_deadline",
  governed_youtube_runway_t60:
    "critical_publication",
  governed_youtube_runway_slo_monitor:
    "critical_planning",
  governed_youtube_runway_tplus15:
    "critical_publication",
  evergreen_candidate_builder: "critical_planning",
  plan_breaking_short: "breaking_planning",
  plan_evergreen_short: "critical_planning",
  plan_weekly_longform: "critical_planning",
  produce_breaking_short: "breaking_production",
  enrich_evergreen_short: "evergreen_production",
  materialize_evergreen_motion_repair:
    "evergreen_production",
  produce_evergreen_short: "evergreen_production",
  enrich_weekly_longform: "longform_production",
  produce_weekly_longform: "longform_production",
  longform_evidence_refresh: "longform_production",
  review_breaking_short: "governed_review",
  review_evergreen_short: "governed_review",
  review_weekly_longform: "governed_review",
  admit_governed_publication: "critical_publication",
  dispatch_governed_publication: "critical_publication",
  prestage_governed_youtube_release:
    "critical_publication",
  verify_governed_youtube_release_tminus15:
    "critical_publication",
  verify_governed_youtube_release_t0:
    "critical_publication",
  publish: "critical_publication",
  external_creative_critic_queue_reconcile: "maintenance",
});

function jobPayloadObject(row = {}) {
  if (
    row.payload &&
    typeof row.payload === "object" &&
    !Array.isArray(row.payload)
  ) {
    return row.payload;
  }
  try {
    const parsed = JSON.parse(row.payload || "{}");
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function laneForActiveJob(row = {}, payload = {}) {
  const explicit = String(payload.lane_id || "").trim();
  if (explicit) return explicit;
  const kind = String(row.kind || "").trim();
  if (kind.includes("breaking")) return "breaking_short";
  if (kind.includes("evergreen")) return "evergreen_short";
  if (
    kind.includes("longform") ||
    kind === "roundup_weekly"
  ) {
    return "weekly_longform";
  }
  return null;
}

function collectMultiLaneQueueState(
  repos,
  supplied = null,
  { excludeJobId = null } = {},
) {
  if (
    supplied &&
    typeof supplied === "object" &&
    (supplied.inflight_by_pool ||
      supplied.inflight_by_lane ||
      supplied.active_idempotency_keys)
  ) {
    return {
      inflight_by_pool: supplied.inflight_by_pool || {},
      inflight_by_lane: supplied.inflight_by_lane || {},
      active_idempotency_keys:
        supplied.active_idempotency_keys || [],
      inflight_by_worker_class:
        supplied.inflight_by_worker_class || {},
    };
  }
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") {
    return {
      inflight_by_pool: {},
      inflight_by_lane: {},
      active_idempotency_keys: [],
      inflight_by_worker_class: {},
    };
  }
  let activeRows = [];
  try {
    activeRows = db
      .prepare(`
        SELECT id, kind, payload, idempotency_key, status
        FROM jobs
        WHERE status IN ('pending', 'claimed', 'running')
        ORDER BY priority ASC, id ASC
      `)
      .all();
  } catch {
    activeRows = [];
  }
  const inflightByPool = {};
  const inflightByLane = {};
  const activeIdempotencyKeys = [];
  for (const row of activeRows) {
    if (
      excludeJobId !== null &&
      Number(row.id) === Number(excludeJobId)
    ) {
      continue;
    }
    const payload = jobPayloadObject(row);
    const pool = String(
      payload.worker_pool ||
        MULTI_LANE_POOL_BY_KIND[row.kind] ||
        "maintenance_analytics",
    ).trim();
    const lane = laneForActiveJob(row, payload);
    inflightByPool[pool] =
      Number(inflightByPool[pool] || 0) + 1;
    if (lane) {
      inflightByLane[lane] =
        Number(inflightByLane[lane] || 0) + 1;
    }
    const key = String(row.idempotency_key || "").trim();
    if (key) activeIdempotencyKeys.push(key);
  }
  return {
    inflight_by_pool: inflightByPool,
    inflight_by_lane: inflightByLane,
    active_idempotency_keys: activeIdempotencyKeys,
    inflight_by_worker_class: {
      shorts_production:
        Number(inflightByPool.breaking_production || 0) +
        Number(inflightByPool.evergreen_production || 0),
      longform_production: Number(
        inflightByPool.longform_production || 0,
      ),
      critical_dispatch: Number(
        inflightByPool.critical_publication || 0,
      ),
    },
  };
}

function renderMultiLanePlanMarkdown(plan) {
  const lines = [
    "# Pulse Gaming Governed Multi-Lane Plan",
    "",
    `Generated: ${plan.generated_at}`,
    `Verdict: ${plan.verdict}`,
    `GREEN lanes: ${plan.green_lane_count}/${plan.lane_count}`,
    "",
  ];
  for (const lane of plan.lanes) {
    lines.push(`## ${lane.label}`);
    lines.push("");
    lines.push(`- Status: ${lane.verdict}`);
    lines.push(`- Priority: ${lane.priority}`);
    lines.push(`- Stage: ${lane.stage}`);
    lines.push(
      `- Candidate: ${lane.candidate?.story_id || "none"}`,
    );
    lines.push(
      `- Next job: ${lane.jobs.next?.kind || "held"}`,
    );
    lines.push(
      `- Blockers: ${lane.blockers.join(", ") || "none"}`,
    );
    lines.push("");
  }
  lines.push("## Routed jobs");
  lines.push("");
  lines.push(
    ...(plan.enqueued_jobs?.length
      ? plan.enqueued_jobs.map(
          (item) =>
            `- ${item.kind}: ${item.story_id} via ${item.worker_pool}`,
        )
      : ["- None"]),
  );
  lines.push("");
  lines.push(
    "External posting is not authorised by this planning artefact.",
  );
  lines.push("");
  return lines.join("\n");
}

function bindUrgentBreakingEvidence(candidates, payload = {}) {
  const storyId = String(
    payload.breaking_story_id || "",
  ).trim();
  if (!storyId) return candidates;
  const verificationStatus = String(
    payload.verification_status || "",
  )
    .trim()
    .toUpperCase();
  const primarySourceUrl = String(
    payload.primary_source_url || "",
  ).trim();
  const sourceEvidenceSha256 = String(
    payload.source_evidence_sha256 || "",
  )
    .trim()
    .toLowerCase();
  const sourceEvidencePath = String(
    payload.source_evidence_path || "",
  ).trim();
  const sourceEvidenceFileSha256 = String(
    payload.source_evidence_file_sha256 || "",
  )
    .trim()
    .toLowerCase();
  return candidates.map((candidate) => {
    if (
      candidate?.lane_id !== "breaking_short" ||
      String(candidate?.story_id || "").trim() !== storyId
    ) {
      return candidate;
    }
    return {
      ...candidate,
      ...(verificationStatus
        ? { verification_status: verificationStatus }
        : {}),
      ...(primarySourceUrl
        ? { primary_source_url: primarySourceUrl }
        : {}),
      ...(/^[a-f0-9]{64}$/.test(sourceEvidenceSha256)
        ? { source_evidence_sha256: sourceEvidenceSha256 }
        : {}),
      ...(sourceEvidencePath
        ? { source_evidence_path: sourceEvidencePath }
        : {}),
      ...(/^[a-f0-9]{64}$/.test(sourceEvidenceFileSha256)
        ? {
            source_evidence_file_sha256:
              sourceEvidenceFileSha256,
          }
        : {}),
    };
  });
}

function governedRunwayWindowDirectory({
  scheduledFor,
  root,
}) {
  if (!String(root || "").trim() || !path.isAbsolute(root)) {
    throw new Error("runway_durable_root_required");
  }
  const scheduledAt = new Date(scheduledFor);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("runway_scheduled_time_invalid");
  }
  return path.join(
    root,
    scheduledAt.toISOString().slice(0, 10),
    `${String(scheduledAt.getUTCHours()).padStart(2, "0")}00`,
  );
}

function governedRunwayRoot(payload = {}, ctx = {}) {
  const explicitRoot = String(
    payload.runway_root || "",
  ).trim();
  if (explicitRoot) {
    if (!path.isAbsolute(explicitRoot)) {
      throw new Error("runway_durable_root_must_be_absolute");
    }
    return path.resolve(explicitRoot);
  }
  const stateRoot = String(
    ctx.env?.PULSE_STATE_ROOT ||
      process.env.PULSE_STATE_ROOT ||
      "",
  ).trim();
  if (!stateRoot || !path.isAbsolute(stateRoot)) {
    throw new Error("runway_pulse_state_root_required");
  }
  return path.join(
    path.resolve(stateRoot),
    "governed-youtube-runway",
  );
}

function containedRunwayPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(
    resolvedRoot,
    resolvedTarget,
  );
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("runway_path_outside_durable_root");
  }
  return resolvedTarget;
}

async function atomicWriteRunwayJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.ensureDir(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.` +
      `${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  await fs.writeJson(temporary, value, { spaces: 2 });
  if (await fs.pathExists(filePath)) {
    const [existing, proposed] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(temporary),
    ]);
    await fs.remove(temporary);
    if (!existing.equals(proposed)) {
      throw new Error("runway_immutable_artifact_conflict");
    }
    return;
  }
  await fs.rename(temporary, filePath);
}

async function atomicWriteRunwayText(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.ensureDir(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.` +
      `${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  await fs.writeFile(temporary, value, "utf8");
  if (await fs.pathExists(filePath)) {
    const [existing, proposed] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(temporary),
    ]);
    await fs.remove(temporary);
    if (!existing.equals(proposed)) {
      throw new Error("runway_immutable_artifact_conflict");
    }
    return;
  }
  await fs.rename(temporary, filePath);
}

function governedRunwayRequired(payload = {}, ctx = {}) {
  const profile = String(
    payload.scheduler_profile ||
      ctx.env?.PULSE_SCHEDULER_PROFILE ||
      process.env.PULSE_SCHEDULER_PROFILE ||
      "",
  )
    .trim()
    .toLowerCase();
  return (
    payload.runway_lock_required === true ||
    profile === "governed_multi_lane"
  );
}

async function loadGovernedRunwayEnvelope({
  scheduledFor,
  payload = {},
  ctx = {},
}) {
  const root = governedRunwayRoot(payload, ctx);
  const windowDir = containedRunwayPath(
    root,
    governedRunwayWindowDirectory({
      scheduledFor,
      root,
    }),
  );
  const evidencePath = path.join(
    windowDir,
    "t90-evidence.json",
  );
  const lockPath = path.join(windowDir, "runway-lock.json");
  if (
    !(await fs.pathExists(evidencePath)) ||
    !(await fs.pathExists(lockPath))
  ) {
    const error = new Error("runway_lock_artifact_required");
    error.code = "runway_lock_artifact_required";
    throw error;
  }
  const [evidence, lock] = await Promise.all([
    fs.readJson(evidencePath),
    fs.readJson(lockPath),
  ]);
  const {
    validateLock,
  } = require("./services/governed-youtube-release-runway");
  const blockers = validateLock(lock);
  if (
    evidence?.lock?.lock_sha256 !== lock.lock_sha256 ||
    evidence?.scheduled_for !== lock.scheduled_for ||
    new Date(lock.scheduled_for).toISOString() !==
      new Date(scheduledFor).toISOString()
  ) {
    blockers.push("runway_evidence_lock_binding_mismatch");
  }
  if (evidence?.verdict !== "GREEN") {
    blockers.push(
      ...(Array.isArray(evidence?.blockers) &&
      evidence.blockers.length
        ? evidence.blockers
        : ["runway_t90_verdict_not_green"]),
    );
  }
  if (
    lock?.reserve_failover?.verdict !== "GREEN" ||
    lock?.reserve_failover?.promotion_authority !== true
  ) {
    blockers.push("runway_reserve_failover_not_armed");
  }
  return {
    root,
    window_dir: windowDir,
    evidence_path: evidencePath,
    lock_path: lockPath,
    evidence,
    lock,
    blockers: [...new Set(blockers)],
  };
}

function governedRunwayNow(payload = {}, ctx = {}) {
  const value =
    payload.now ||
    (typeof ctx.now === "function" ? ctx.now() : ctx.now) ||
    new Date();
  const now = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(now.getTime())) {
    throw new Error("runway_time_invalid");
  }
  return now;
}

function governedRunwayAdmissionJobs(payload, repos) {
  if (Array.isArray(payload.admission_jobs)) {
    return structuredClone(payload.admission_jobs);
  }
  if (typeof repos?.jobs?.listPending === "function") {
    return repos.jobs
      .listPending()
      .filter(
        (job) => job.kind === "admit_governed_publication",
      );
  }
  if (repos?.db && typeof repos.db.prepare === "function") {
    try {
      return repos.db
        .prepare(
          `SELECT *
           FROM jobs
           WHERE kind = 'admit_governed_publication'
             AND status = 'pending'
           ORDER BY id`,
        )
        .all()
        .map((job) => {
          try {
            return {
              ...job,
              payload: JSON.parse(job.payload || "{}"),
            };
          } catch {
            return job;
          }
        });
    } catch {
      return [];
    }
  }
  return [];
}

function validRunwaySha256(value) {
  const normalised = String(value || "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalised)
    ? normalised
    : null;
}

function hashRunwayEvidence(value) {
  return crypto
    .createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(value ?? null),
    )
    .digest("hex");
}

function canonicalRunwayReviewBinding(
  db,
  storyId,
  admissionJob,
  fallbackAdmission = null,
  fallbackCandidate = null,
  now = new Date(),
) {
  if (!db || typeof db.prepare !== "function") return null;
  const queuedAdmission =
    admissionJob?.payload?.admission &&
    typeof admissionJob.payload.admission === "object" &&
    !Array.isArray(admissionJob.payload.admission)
      ? admissionJob.payload.admission
      : null;
  const persistedAdmission =
    fallbackAdmission &&
    typeof fallbackAdmission === "object" &&
    !Array.isArray(fallbackAdmission)
      ? fallbackAdmission
      : null;
  const autonomousAdmission =
    queuedAdmission?.approval_type ===
      AUTONOMOUS_OFFICIAL_ADMISSION_TYPE
      ? queuedAdmission
      : persistedAdmission?.approval_type ===
            AUTONOMOUS_OFFICIAL_ADMISSION_TYPE
        ? persistedAdmission
        : null;
  if (autonomousAdmission) {
    try {
      const {
        canonicalSha256: canonicalRunwaySha256,
        validateAutonomousWindowEligibilityAttestation,
      } = require(
        "./services/governed-youtube-release-runway"
      );
      const {
        validateAutonomousOfficialJitPreparationManifest,
      } = require(
        "./services/autonomous-official-jit-admission-packet"
      );
      if (
        (queuedAdmission &&
          queuedAdmission.approval_type !==
            AUTONOMOUS_OFFICIAL_ADMISSION_TYPE) ||
        (persistedAdmission &&
          persistedAdmission.approval_type !==
            AUTONOMOUS_OFFICIAL_ADMISSION_TYPE) ||
        (queuedAdmission &&
          persistedAdmission &&
          canonicalRunwaySha256(queuedAdmission) !==
            canonicalRunwaySha256(persistedAdmission))
      ) {
        return null;
      }
      const forbiddenHumanFields = [
        "human_review_status",
        "human_review_event_id",
        "human_review_evidence_sha256",
        "human_review_audit_id",
        "humanReviewAuditId",
        "operator",
        "actor_id",
        "reason",
      ];
      if (
        autonomousAdmission.human_admission_required !== false ||
        Object.hasOwn(
          autonomousAdmission,
          "autonomous_publication_authority",
        ) ||
        forbiddenHumanFields.some(
          (field) =>
            Object.hasOwn(autonomousAdmission, field) ||
            (Object.hasOwn(
              fallbackCandidate || {},
              field,
            ) &&
              fallbackCandidate?.[field] !== null &&
              fallbackCandidate?.[field] !== undefined &&
              String(fallbackCandidate[field]).trim() !== ""),
        )
      ) {
        return null;
      }
      const preparation =
        validateAutonomousOfficialJitPreparationManifest(
          autonomousAdmission.jit_preparation,
        );
      const revision =
        validRunwaySha256(
          admissionJob?.payload?.candidate_revision_sha256,
        ) ||
        validRunwaySha256(
          fallbackCandidate?.candidate_revision_sha256,
        );
      const laneId = String(
        fallbackCandidate?.lane_id || "",
      ).trim();
      const scheduledFor = String(
        autonomousAdmission.scheduled_for || "",
      ).trim();
      const role =
        fallbackCandidate?.standby_authorised === true
          ? "STANDBY"
          : "PRIMARY";
      const hashes = {
        media_sha256: validRunwaySha256(
          fallbackCandidate?.media_sha256,
        ),
        script_sha256: validRunwaySha256(
          fallbackCandidate?.script_sha256,
        ),
        qa_report_sha256: validRunwaySha256(
          fallbackCandidate?.qa_report_sha256,
        ),
        rights_ledger_sha256: validRunwaySha256(
          fallbackCandidate?.rights_ledger_sha256 ||
            fallbackCandidate?.rights_ledger_canonical_sha256,
        ),
        source_evidence_sha256: validRunwaySha256(
          fallbackCandidate?.source_evidence_sha256,
        ),
      };
      if (
        !revision ||
        Object.values(hashes).some((value) => !value) ||
        String(autonomousAdmission.confirmation_story_id || "")
          .trim() !== storyId ||
        !Number.isFinite(Date.parse(scheduledFor)) ||
        preparation.story_id !== storyId ||
        preparation.channel_id !== "pulse-gaming" ||
        preparation.lane_id !== laneId ||
        preparation.platform !== "youtube" ||
        preparation.scheduled_for !== scheduledFor ||
        preparation.role !== role ||
        preparation.candidate_revision_sha256 !== revision ||
        preparation.request_fingerprint !==
          validRunwaySha256(
            fallbackCandidate?.request_fingerprint,
          )
      ) {
        return null;
      }
      const attestation =
        validateAutonomousWindowEligibilityAttestation(
          autonomousAdmission
            .autonomous_window_eligibility_attestation,
          {
            now,
            expected: {
              story_id: storyId,
              channel_id: "pulse-gaming",
              lane_id: laneId,
              platform: "youtube",
              scheduled_for: scheduledFor,
              role,
              evidence_hashes: hashes,
              jit_preparation: preparation,
            },
          },
        );
      if (
        validRunwaySha256(
          autonomousAdmission
            .autonomous_eligibility_attestation_sha256,
        ) !== attestation.attestation_sha256 ||
        validRunwaySha256(
          autonomousAdmission.jit_preparation_sha256,
        ) !== preparation.preparation_sha256 ||
        validRunwaySha256(
          fallbackCandidate
            ?.autonomous_eligibility_attestation_sha256,
        ) !== attestation.attestation_sha256 ||
        validRunwaySha256(
          fallbackCandidate?.candidate_binding_sha256,
        ) !== attestation.candidate_binding_sha256
      ) {
        return null;
      }
      return {
        ...hashes,
        stage: "AUTONOMOUS_ELIGIBLE",
        approval_type:
          AUTONOMOUS_OFFICIAL_ADMISSION_TYPE,
        eligibility_verdict: "GREEN",
        candidate_revision_sha256: revision,
        candidate_binding_sha256:
          attestation.candidate_binding_sha256,
        request_fingerprint:
          preparation.request_fingerprint,
        autonomous_eligibility_attestation_sha256:
          attestation.attestation_sha256,
        admission_event_id:
          admissionJob?.id === undefined
            ? null
            : String(admissionJob.id),
        admission_evidence_sha256:
          canonicalRunwaySha256(autonomousAdmission),
        standby_authorised:
          fallbackCandidate?.standby_authorised === true,
        admission: structuredClone(autonomousAdmission),
      };
    } catch {
      return null;
    }
  }
  try {
    const review = db
      .prepare(
        `SELECT *
         FROM operator_audit_log
         WHERE target_type = 'story'
           AND target_id = ?
           AND action = 'governed_publication_review'
           AND decision = 'HUMAN_RENDER_APPROVED'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(storyId);
    if (!review) return null;
    const evidence = parseRunwayEvidence(review.evidence_json);
    let standby = null;
    try {
      standby = db
        .prepare(
          `SELECT *
           FROM operator_audit_log
           WHERE target_type = 'story'
             AND target_id = ?
             AND action =
               'governed_youtube_runway_standby'
             AND decision = 'APPROVED'
           ORDER BY id DESC
           LIMIT 1`,
        )
        .get(storyId);
    } catch {
      standby = null;
    }
    const standbyEvidence = parseRunwayEvidence(
      standby?.evidence_json,
    );
    const exactStandbySchema =
      standbyEvidence.schema_version ===
      "pulse-governed-youtube-window-candidate-authority-v1";
    const standbyAuthorityBody = {
      ...standbyEvidence,
    };
    delete standbyAuthorityBody.authority_binding_sha256;
    const {
      canonicalSha256: canonicalRunwaySha256,
    } = require(
      "./services/governed-youtube-release-runway"
    );
    const {
      canonicalHumanRenderApprovalAuditSha256,
    } = require(
      "./services/governed-youtube-window-candidate-authority"
    );
    const primaryAuthorityReference =
      admissionJob?.payload?.window_candidate_authority &&
      typeof admissionJob.payload.window_candidate_authority ===
        "object" &&
      !Array.isArray(
        admissionJob.payload.window_candidate_authority,
      )
        ? admissionJob.payload.window_candidate_authority
        : null;
    const exactPrimaryAuthorityClaimed =
      primaryAuthorityReference !== null;
    const primaryAuthority = exactPrimaryAuthorityClaimed
      ? db
          .prepare(
            `SELECT *
             FROM operator_audit_log
             WHERE id = ?
             LIMIT 1`,
          )
          .get(Number(primaryAuthorityReference.audit_id))
      : null;
    const primaryAuthorityEvidence = parseRunwayEvidence(
      primaryAuthority?.evidence_json,
    );
    const primaryAuthorityBody = {
      ...primaryAuthorityEvidence,
    };
    delete primaryAuthorityBody.authority_binding_sha256;
    const primaryAuthorityBaseValid =
      exactPrimaryAuthorityClaimed &&
      primaryAuthority?.action ===
        "governed_youtube_window_primary" &&
      primaryAuthority?.decision === "APPROVED" &&
      primaryAuthority?.target_type === "story" &&
      primaryAuthority?.target_id === storyId &&
      primaryAuthorityEvidence.schema_version ===
        "pulse-governed-youtube-window-candidate-authority-v1" &&
      primaryAuthorityEvidence.platform === "youtube" &&
      primaryAuthorityEvidence.role === "PRIMARY" &&
      primaryAuthorityEvidence.story_id === storyId &&
      primaryAuthorityEvidence.standby_authorised === false &&
      Number(primaryAuthorityEvidence.human_review_audit_id) ===
        Number(review.id) &&
      validRunwaySha256(
        primaryAuthorityEvidence.human_review_audit_sha256,
      ) === canonicalHumanRenderApprovalAuditSha256(review) &&
      validRunwaySha256(
        primaryAuthorityEvidence.human_review_evidence_sha256,
      ) === hashRunwayEvidence(review.evidence_json) &&
      validRunwaySha256(
        primaryAuthorityEvidence.authority_binding_sha256,
      ) === canonicalRunwaySha256(primaryAuthorityBody) &&
      Number(primaryAuthorityReference.audit_id) ===
        Number(primaryAuthority?.id) &&
      primaryAuthorityReference.action ===
        primaryAuthority?.action &&
      primaryAuthorityReference.decision ===
        primaryAuthority?.decision &&
      primaryAuthorityReference.idempotency_key ===
        primaryAuthority?.idempotency_key &&
      validRunwaySha256(
        primaryAuthorityReference.authority_binding_sha256,
      ) ===
        validRunwaySha256(
          primaryAuthorityEvidence.authority_binding_sha256,
        );
    const standbyAuthorityBound =
      exactStandbySchema &&
      standbyEvidence.platform === "youtube" &&
      standbyEvidence.role === "STANDBY" &&
      standbyEvidence.story_id === storyId &&
      standbyEvidence.standby_authorised === true &&
      Number(standbyEvidence.human_review_audit_id) ===
        Number(review.id) &&
      validRunwaySha256(
        standbyEvidence.human_review_audit_sha256,
      ) === canonicalHumanRenderApprovalAuditSha256(review) &&
      validRunwaySha256(
        standbyEvidence.human_review_evidence_sha256,
      ) === hashRunwayEvidence(review.evidence_json) &&
      validRunwaySha256(
        standbyEvidence.authority_binding_sha256,
      ) === canonicalRunwaySha256(standbyAuthorityBody);
    const persistedAdmission =
      fallbackAdmission &&
      typeof fallbackAdmission === "object" &&
      !Array.isArray(fallbackAdmission)
        ? fallbackAdmission
        : {};
    const queuedAdmission =
      admissionJob?.payload?.admission &&
      typeof admissionJob.payload.admission === "object" &&
      !Array.isArray(admissionJob.payload.admission)
        ? admissionJob.payload.admission
        : {};
    const standbyAdmission =
      standbyAuthorityBound &&
      standbyEvidence.admission &&
      typeof standbyEvidence.admission === "object" &&
      !Array.isArray(standbyEvidence.admission)
        ? standbyEvidence.admission
        : {};
    const admission =
      Object.keys(persistedAdmission).length ||
      Object.keys(queuedAdmission).length ||
      Object.keys(standbyAdmission).length
        ? {
            ...standbyAdmission,
            ...persistedAdmission,
            ...queuedAdmission,
            evidence: {
              ...(standbyAdmission.evidence || {}),
              ...(persistedAdmission.evidence || {}),
              ...(queuedAdmission.evidence || {}),
            },
          }
        : null;
    const revision =
      validRunwaySha256(
        admissionJob?.payload?.candidate_revision_sha256,
      ) ||
      (standbyAuthorityBound
        ? validRunwaySha256(
            standbyEvidence.candidate_revision_sha256,
          )
        : null) ||
      hashRunwayEvidence({
        review_id: Number(review.id),
        review_evidence: evidence,
      });
    const scheduledFor = String(
      admission?.scheduled_for || "",
    ).trim();
    const scheduledTime = Date.parse(scheduledFor);
    const standbyScheduledTime = Date.parse(
      standbyEvidence.scheduled_for,
    );
    const hashes = {
      media_sha256: validRunwaySha256(
        evidence.media_sha256 ||
          evidence.final_mp4?.sha256,
      ),
      script_sha256: validRunwaySha256(
        evidence.script_sha256,
      ),
      qa_report_sha256: validRunwaySha256(
        evidence.qa_report?.sha256,
      ),
      rights_ledger_sha256: validRunwaySha256(
        evidence.rights_ledger?.canonical_sha256,
      ),
      source_evidence_sha256: validRunwaySha256(
        evidence.source_evidence?.sha256,
      ),
    };
    const standbyEvidenceHashes =
      standbyEvidence.evidence_hashes &&
      typeof standbyEvidence.evidence_hashes === "object" &&
      !Array.isArray(standbyEvidence.evidence_hashes)
        ? standbyEvidence.evidence_hashes
        : {};
    const primaryEvidenceHashes =
      primaryAuthorityEvidence.evidence_hashes &&
      typeof primaryAuthorityEvidence.evidence_hashes ===
        "object" &&
      !Array.isArray(
        primaryAuthorityEvidence.evidence_hashes,
      )
        ? primaryAuthorityEvidence.evidence_hashes
        : {};
    const exactPrimaryBindingValid =
      !exactPrimaryAuthorityClaimed ||
      (primaryAuthorityBaseValid &&
        primaryAuthorityReference.role === "PRIMARY" &&
        primaryAuthorityReference.story_id === storyId &&
        primaryAuthorityReference.scheduled_for ===
          scheduledFor &&
        validRunwaySha256(
          primaryAuthorityReference.candidate_revision_sha256,
        ) === revision &&
        primaryAuthorityEvidence.scheduled_for ===
          scheduledFor &&
        validRunwaySha256(
          primaryAuthorityEvidence.candidate_revision_sha256,
        ) === revision &&
        primaryAuthorityEvidence
          .admission_job_idempotency_key ===
          admissionJob?.idempotency_key &&
        Object.entries(hashes).every(
          ([field, value]) =>
            value &&
            validRunwaySha256(
              primaryEvidenceHashes[field],
            ) === value,
        ) &&
        canonicalRunwaySha256(
          primaryAuthorityEvidence.admission || {},
        ) === canonicalRunwaySha256(queuedAdmission));
    const exactStandbyBindingValid =
      standbyAuthorityBound &&
      Object.entries(hashes).every(
        ([field, value]) =>
          value &&
          validRunwaySha256(
            standbyEvidenceHashes[field],
          ) === value,
      ) &&
      String(
        standbyEvidence.admission?.confirmation_story_id ||
          "",
      ).trim() === storyId &&
      String(
        standbyEvidence.admission?.scheduled_for || "",
      ).trim() === scheduledFor;
    const standbyAuthorised =
      standbyEvidence.standby_authorised === true &&
      validRunwaySha256(
        standbyEvidence.candidate_revision_sha256,
      ) === revision &&
      Number.isFinite(scheduledTime) &&
      Number.isFinite(standbyScheduledTime) &&
      standbyScheduledTime === scheduledTime &&
      (exactStandbySchema
        ? exactStandbyBindingValid
        : true);
    const green =
      Object.values(hashes).every(Boolean) &&
      String(admission?.human_review_status || "")
        .trim()
        .toLowerCase() === "approved" &&
      String(admission?.confirmation_story_id || "").trim() ===
        storyId &&
      Number.isFinite(Date.parse(scheduledFor)) &&
      exactPrimaryBindingValid;
    return {
      ...hashes,
      stage: "HUMAN_APPROVED",
      human_review_status: "approved",
      eligibility_verdict: green ? "GREEN" : "HOLD",
      candidate_revision_sha256: revision,
      human_review_event_id: String(review.id),
      human_review_evidence_sha256: hashRunwayEvidence(
        review.evidence_json,
      ),
      admission_event_id:
        admissionJob?.id === undefined
          ? null
          : String(admissionJob.id),
      admission_evidence_sha256: admission
        ? hashRunwayEvidence(admission)
        : null,
      standby_authorised: standbyAuthorised,
      standby_authorisation_event_id:
        standbyAuthorised ? String(standby.id) : null,
      standby_authorisation_sha256:
        standbyAuthorised
          ? hashRunwayEvidence({
              event_id: Number(standby.id),
              action: standby.action,
              decision: standby.decision,
              evidence: standbyEvidence,
            })
          : null,
      admission: admission
        ? structuredClone(admission)
        : null,
    };
  } catch {
    return null;
  }
}

function governedRunwayCandidates(
  payload,
  repos,
  admissionJobs,
  now = new Date(),
) {
  if (Array.isArray(payload.candidates)) {
    return structuredClone(payload.candidates);
  }
  return collectMultiLaneCandidates(repos).map((candidate) => {
    const admissionJob = admissionJobs.find(
      (job) =>
        String(
          job.story_id || job.payload?.story_id || "",
        ).trim() === String(candidate.story_id || "").trim(),
    );
    const canonical = canonicalRunwayReviewBinding(
      repos?.db,
      String(candidate.story_id || "").trim(),
      admissionJob,
      candidate.admission || null,
      candidate,
      now,
    );
    const admission = candidate.admission || {};
    const evidence = admission.evidence || {};
    return {
      ...candidate,
      ...(canonical || {}),
      ...(canonical?.stage === "AUTONOMOUS_ELIGIBLE"
        ? {}
        : {
            human_review_status:
              canonical?.human_review_status ||
              admission.human_review_status ||
              null,
          }),
      eligibility_verdict:
        canonical?.eligibility_verdict ||
        candidate.eligibility_verdict ||
        null,
      qa_report_sha256:
        canonical?.qa_report_sha256 ||
        candidate.qa_report_sha256 ||
        evidence.qa_report_sha256 ||
        null,
      candidate_revision_sha256:
        canonical?.candidate_revision_sha256 ||
        admissionJob?.payload?.candidate_revision_sha256 ||
        candidate.candidate_revision_sha256 ||
        null,
      standby_authorised:
        canonical
          ? canonical.standby_authorised === true
          : candidate.standby_authorised === true,
    };
  });
}

function renderGovernedRunwayMarkdown(evidence) {
  const lines = [
    "# Governed YouTube release runway",
    "",
    `Phase: ${evidence.phase}`,
    `Scheduled: ${evidence.scheduled_for || "unknown"}`,
    `Verdict: ${evidence.verdict || evidence.classification}`,
    `Blockers: ${(evidence.blockers || []).join(", ") || "none"}`,
    "",
    "No catch-up publication or publish authority is created by this evidence.",
    "",
  ];
  return lines.join("\n");
}

async function notifyGovernedRunwayIncident(
  ctx,
  incident,
) {
  if (typeof ctx.notifyRunwayIncident === "function") {
    await ctx.notifyRunwayIncident(incident);
    return true;
  }
  const notify = require("../notify");
  await notify(
    [
      `Pulse Gaming runway incident: ${incident.phase}`,
      `Window: ${incident.scheduled_for || "unknown"}`,
      `Classification: ${incident.classification || incident.verdict}`,
      `Blockers: ${(incident.blockers || []).join(", ") || "unknown"}`,
      "Catch-up publishing remains disabled.",
    ].join("\n"),
  );
  return true;
}

function handlePrimeGovernedYoutubeWindowCheckpoints(
  job,
  ctx,
) {
  const payload = job?.payload || {};
  const now =
    payload.now ||
    (typeof ctx?.now === "function" ? ctx.now() : ctx?.now) ||
    new Date();
  const {
    primeGovernedYoutubeWindowCheckpoints,
  } = require("./services/governed-youtube-window-checkpoint-primer");
  return primeGovernedYoutubeWindowCheckpoints({
    jobs: ctx?.repos?.jobs,
    schedulerProfile: payload.scheduler_profile,
    now,
    horizonHours: payload.horizon_hours || 36,
  });
}

function governedAutonomousWindowPlanningSafety() {
  return {
    human_approval_dependency: false,
    story_approval_mutated: false,
    network_used: false,
    platform_contacted: false,
    oauth_or_tokens_mutated: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting: false,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

function governedAutonomousWindowPlanningCounts() {
  return {
    inventory_ready: 0,
    inventory_rejected: 0,
    db_rows_found: 0,
    db_rows_missing: 0,
    db_rows_approval_rejected: 0,
    hydrated: 0,
    hydration_rejected: 0,
    compilation_succeeded: 0,
    compilation_rejected: 0,
    stale_rejected: 0,
    eligible: 0,
    queued_jobs: 0,
  };
}

function governedAutonomousWindowPlanningHold({
  blockers,
  counts,
  rejected = [],
  evidence = {},
}) {
  return {
    status: "held",
    verdict: "HOLD",
    blockers: [
      ...new Set(
        (Array.isArray(blockers) ? blockers : []).filter(Boolean),
      ),
    ],
    counts,
    rejected: [...rejected].sort(
      (left, right) =>
        String(left?.story_id || "").localeCompare(
          String(right?.story_id || ""),
        ) ||
        String(left?.blockers?.[0] || "").localeCompare(
          String(right?.blockers?.[0] || ""),
        ),
    ),
    ...evidence,
    ...governedAutonomousWindowPlanningSafety(),
  };
}

function autonomousWindowPlanningAuthorityBlockers(
  value,
  blockers = [],
) {
  if (!value || typeof value !== "object") return blockers;
  if (Array.isArray(value)) {
    for (const child of value) {
      autonomousWindowPlanningAuthorityBlockers(
        child,
        blockers,
      );
    }
    return blockers;
  }
  const authorityFields = new Set([
    "approval",
    "approved",
    "auto_publish",
    "dispatch_authorised",
    "external_posting",
    "external_publish_authorised",
    "human_approval",
    "human_approval_required",
    "human_review_required",
    "live_publish_attempted",
    "oauth_authority",
    "platform_contacted",
    "publish_authority",
    "publish_now",
    "scheduler_authority",
    "upload_authority",
  ]);
  for (const [field, child] of Object.entries(value)) {
    if (
      authorityFields.has(field) &&
      child !== false &&
      child !== null &&
      child !== undefined
    ) {
      blockers.push(
        "governed_autonomous_window_planning_authority_forbidden",
      );
    }
    autonomousWindowPlanningAuthorityBlockers(
      child,
      blockers,
    );
  }
  return blockers;
}

function defaultGovernedAutonomousBreakingRuntimePolicy(
  env = {},
) {
  const voiceId = String(
    env.ELEVENLABS_VOICE_ID || "",
  ).trim();
  if (!voiceId) return null;
  const safeLocalModel = (value, fallback) => {
    const model = String(value || fallback).trim();
    return /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(
      model,
    )
      ? model
      : null;
  };
  const primaryVisualModel = safeLocalModel(
    env.PULSE_VISUAL_QA_PRIMARY_MODEL,
    "gemma3:12b",
  );
  const secondaryVisualModel = safeLocalModel(
    env.PULSE_VISUAL_QA_SECONDARY_MODEL,
    "qwen3.5:27b",
  );
  if (
    !primaryVisualModel ||
    !secondaryVisualModel ||
    primaryVisualModel.toLowerCase() ===
      secondaryVisualModel.toLowerCase()
  ) {
    return null;
  }
  return {
    narration: {
      provider: "elevenlabs",
      voice_id: voiceId,
      model_id:
        String(
          env.ELEVENLABS_MODEL_ID ||
            "eleven_multilingual_v2",
        ).trim() || "eleven_multilingual_v2",
      speed: 1,
    },
    visual_qa: {
      reviewers: [
        {
          provider: "ollama",
          model: primaryVisualModel,
          endpoint_origin: "http://127.0.0.1:11434",
        },
        {
          provider: "ollama",
          model: secondaryVisualModel,
          endpoint_origin: "http://127.0.0.1:11434",
        },
      ],
    },
    disclosure_policy: {
      policy_id: "pulse-youtube-synthetic-media",
      policy_version: "1",
    },
  };
}

async function handleGovernedAutonomousWindowProductionPlan(
  job,
  ctx,
) {
  const payload = job?.payload || {};
  const counts = governedAutonomousWindowPlanningCounts();
  const rejected = [];
  const inputBlockers = autonomousWindowPlanningAuthorityBlockers(
    payload,
  );
  if (
    payload.mode !== undefined &&
    payload.mode !== "LOCAL_PROOF"
  ) {
    inputBlockers.push(
      "governed_autonomous_window_planning_local_proof_only",
    );
  }
  const scheduledFor = String(
    payload.scheduled_for || "",
  ).trim();
  const scheduledTimestamp = Date.parse(scheduledFor);
  const generatedAt = String(
    payload.generated_at ||
      payload.now ||
      (typeof ctx.now === "function" ? ctx.now() : ctx.now) ||
      new Date().toISOString(),
  ).trim();
  const generatedTimestamp = Date.parse(generatedAt);
  const scheduledDate = new Date(scheduledTimestamp);
  if (
    !scheduledFor ||
    !Number.isFinite(scheduledTimestamp) ||
    scheduledDate.toISOString() !== scheduledFor ||
    ![9, 19].includes(scheduledDate.getUTCHours()) ||
    scheduledDate.getUTCMinutes() !== 0 ||
    scheduledDate.getUTCSeconds() !== 0 ||
    scheduledDate.getUTCMilliseconds() !== 0
  ) {
    inputBlockers.push(
      "governed_autonomous_window_planning_window_invalid",
    );
  }
  if (
    !generatedAt ||
    !Number.isFinite(generatedTimestamp) ||
    new Date(generatedTimestamp).toISOString() !== generatedAt ||
    (Number.isFinite(scheduledTimestamp) &&
      generatedTimestamp >=
        scheduledTimestamp - 90 * 60 * 1000)
  ) {
    inputBlockers.push(
      "governed_autonomous_window_planning_must_precede_t90",
    );
  }
  if (
    typeof ctx.repos?.stories?.get !== "function" ||
    typeof ctx.repos?.jobs?.enqueueBatch !== "function"
  ) {
    inputBlockers.push(
      "governed_autonomous_window_planning_repositories_required",
    );
  }
  if (inputBlockers.length) {
    return governedAutonomousWindowPlanningHold({
      blockers: inputBlockers,
      counts,
      rejected,
    });
  }

  const workspaceRoot = path.resolve(
    ctx.autonomousProductionWorkspaceRoot ||
      ctx.workspaceRoot ||
      process.cwd(),
  );
  const outputRoot = path.join(workspaceRoot, "output");
  const inventoryRoot = path.resolve(
    ctx.governedEditorialInventoryRoot ||
      path.join(outputRoot, "editorial-inventory"),
  );
  const allowedRoots = (
    Array.isArray(
      ctx.governedEditorialInventoryAllowedRoots,
    ) &&
    ctx.governedEditorialInventoryAllowedRoots.length
      ? ctx.governedEditorialInventoryAllowedRoots
      : [outputRoot]
  ).map((root) => path.resolve(root));
  if (
    !allowedRoots.some((root) =>
      pathIsWithin(root, inventoryRoot),
    )
  ) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        "governed_autonomous_window_inventory_root_untrusted",
      ],
      counts,
      rejected,
    });
  }

  const scanGovernedEditorialInventory =
    ctx.scanGovernedEditorialInventory ||
    require("./services/governed-editorial-inventory-registry")
      .scanGovernedEditorialInventory;
  let inventoryReport;
  try {
    ctx.assertLeaseHealthy?.();
    inventoryReport =
      await scanGovernedEditorialInventory({
        rootDir: inventoryRoot,
        allowedRoots,
        maximumManifests:
          payload.inventory_maximum_manifests,
      });
    ctx.assertLeaseHealthy?.();
  } catch (error) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        String(
          error?.code ||
            "governed_autonomous_window_inventory_scan_failed",
        ),
      ],
      counts,
      rejected,
    });
  }
  if (
    inventoryReport?.schema_version !==
      "pulse-governed-editorial-inventory-registry-v1" ||
    inventoryReport?.mode !== "LOCAL_PROOF" ||
    !Array.isArray(inventoryReport?.entries) ||
    !Array.isArray(inventoryReport?.rejected) ||
    inventoryReport?.safety?.read_only !== true ||
    inventoryReport?.safety?.network_used !== false ||
    inventoryReport?.safety?.database_mutated !== false ||
    inventoryReport?.safety?.oauth_mutated !== false ||
    inventoryReport?.safety?.platform_contacted !== false ||
    inventoryReport?.safety?.publish_authority_created !== false
  ) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        "governed_autonomous_window_inventory_scan_invalid",
      ],
      counts,
      rejected,
    });
  }
  counts.inventory_rejected =
    inventoryReport.rejected.length;
  for (const entry of inventoryReport.rejected) {
    rejected.push({
      story_id: String(entry?.story?.id || "").trim() || null,
      blockers:
        Array.isArray(entry?.blockers) &&
        entry.blockers.length
          ? [...entry.blockers]
          : [
              "governed_autonomous_window_inventory_rejected",
            ],
    });
  }

  const exactReadyEntries = [];
  for (const entry of inventoryReport.entries) {
    const storyId = String(entry?.story?.id || "").trim();
    const registryPath = String(
      entry?.registry_path || "",
    ).trim();
    const registrySha256 = String(
      entry?.registry_file_sha256 || "",
    )
      .trim()
      .toLowerCase();
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/.test(storyId) ||
      !path.isAbsolute(registryPath) ||
      !pathIsWithin(inventoryRoot, path.resolve(registryPath)) ||
      !/^[a-f0-9]{64}$/.test(registrySha256) ||
      !Array.isArray(entry?.blockers) ||
      entry.blockers.length !== 0 ||
      String(
        entry?.story?.verification_status || "",
      ).toUpperCase() !== "CONFIRMED"
    ) {
      counts.inventory_rejected += 1;
      rejected.push({
        story_id: storyId || null,
        blockers: [
          "governed_autonomous_window_inventory_entry_invalid",
        ],
      });
      continue;
    }
    exactReadyEntries.push(entry);
  }
  exactReadyEntries.sort((left, right) =>
    left.story.id.localeCompare(right.story.id),
  );
  counts.inventory_ready = exactReadyEntries.length;

  const storyById = new Map();
  const candidateSeeds = [];
  for (const entry of exactReadyEntries) {
    const storyId = entry.story.id;
    const story =
      (await Promise.resolve(
        ctx.repos.stories.get(storyId),
      )) || null;
    if (!story || String(story.id || "").trim() !== storyId) {
      counts.db_rows_missing += 1;
      rejected.push({
        story_id: storyId,
        blockers: [
          "governed_autonomous_window_db_story_missing",
        ],
      });
      continue;
    }
    const approvalBlockers = [];
    if (story.approved !== true && story.approved !== 1) {
      approvalBlockers.push(
        "governed_autonomous_window_db_story_not_approved",
      );
    }
    if (
      story.auto_approved !== true &&
      story.auto_approved !== 1
    ) {
      approvalBlockers.push(
        "governed_autonomous_window_db_story_not_auto_approved",
      );
    }
    if (approvalBlockers.length) {
      counts.db_rows_approval_rejected += 1;
      rejected.push({
        story_id: storyId,
        blockers: approvalBlockers,
      });
      continue;
    }
    if (
      String(story.youtube_post_id || "").trim() ||
      [
        "canonical_projection_consumed",
        "failed",
        "published",
        "uploaded",
      ].includes(
        String(story.publish_status || "")
          .trim()
          .toLowerCase(),
      )
    ) {
      rejected.push({
        story_id: storyId,
        blockers: [
          "governed_autonomous_window_db_story_not_publishable",
        ],
      });
      continue;
    }
    counts.db_rows_found += 1;
    storyById.set(storyId, story);
    const extra = parseStoryExtra(story);
    candidateSeeds.push({
      lane_id: "breaking_short",
      story_id: storyId,
      stage: "PLANNING",
      supplemental_official_sources:
        Array.isArray(
          extra.supplemental_official_sources,
        )
          ? structuredClone(
              extra.supplemental_official_sources,
            )
          : [],
    });
  }

  let hydration = {
    candidates: [],
    hydrated: [],
    rejected: [],
    skipped: [],
  };
  if (candidateSeeds.length) {
    const hydrateGovernedEditorialInventoryCandidates =
      ctx.hydrateGovernedEditorialInventoryCandidates ||
      require("./services/governed-editorial-inventory-candidate-hydrator")
        .hydrateGovernedEditorialInventoryCandidates;
    try {
      ctx.assertLeaseHealthy?.();
      hydration =
        await hydrateGovernedEditorialInventoryCandidates({
          candidates: candidateSeeds,
          inventoryRoot,
          allowedRoots,
          maximumManifests:
            payload.inventory_maximum_manifests,
        });
      ctx.assertLeaseHealthy?.();
    } catch (error) {
      return governedAutonomousWindowPlanningHold({
        blockers: [
          String(
            error?.code ||
              "governed_autonomous_window_inventory_hydration_failed",
          ),
        ],
        counts,
        rejected,
        evidence: { inventory_report: inventoryReport },
      });
    }
    if (
      !Array.isArray(hydration?.candidates) ||
      !Array.isArray(hydration?.hydrated) ||
      !Array.isArray(hydration?.rejected) ||
      !Array.isArray(hydration?.skipped) ||
      hydration?.safety?.read_only !== true ||
      hydration?.safety?.network_used !== false ||
      hydration?.safety?.database_mutated !== false ||
      hydration?.safety?.oauth_mutated !== false ||
      hydration?.safety?.platform_contacted !== false ||
      hydration?.safety?.publish_authority_created !== false
    ) {
      return governedAutonomousWindowPlanningHold({
        blockers: [
          "governed_autonomous_window_inventory_hydration_invalid",
        ],
        counts,
        rejected,
        evidence: { inventory_report: inventoryReport },
      });
    }
  }
  const hydratedIds = new Set(
    hydration.hydrated.map((entry) =>
      String(entry?.story_id || "").trim(),
    ),
  );
  counts.hydrated = hydratedIds.size;
  counts.hydration_rejected =
    hydration.rejected.length + hydration.skipped.length;
  for (const entry of [
    ...hydration.rejected,
    ...hydration.skipped,
  ]) {
    rejected.push({
      story_id: String(entry?.story_id || "").trim() || null,
      blockers:
        Array.isArray(entry?.blockers) &&
        entry.blockers.length
          ? [...entry.blockers]
          : [
              String(entry?.reason || "").trim() ||
                "governed_autonomous_window_inventory_not_hydrated",
            ],
    });
  }
  const hydratedById = new Map(
    hydration.candidates
      .filter((candidate) =>
        hydratedIds.has(
          String(candidate?.story_id || "").trim(),
        ),
      )
      .map((candidate) => [
        String(candidate.story_id).trim(),
        candidate,
      ]),
  );

  const runtimePolicy =
    ctx.governedAutonomousBreakingRuntimePolicy ||
    defaultGovernedAutonomousBreakingRuntimePolicy(
      ctx.env || process.env,
    );
  if (!runtimePolicy) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        "governed_autonomous_window_runtime_policy_unavailable",
      ],
      counts,
      rejected,
      evidence: { inventory_report: inventoryReport },
    });
  }
  const {
    REQUEST_SCHEMA_VERSION:
      COMPILER_REQUEST_SCHEMA_VERSION,
    compileGovernedAutonomousBreakingCandidateContract:
      defaultCompileCandidate,
  } = require("./services/governed-autonomous-breaking-candidate-contract-compiler");
  const compileCandidate =
    ctx.compileGovernedAutonomousBreakingCandidateContract ||
    defaultCompileCandidate;
  const compiledCandidates = [];
  const maximumEvidenceAgeMs = Number.isFinite(
    Number(
      ctx.governedAutonomousMaximumEvidenceAgeMs,
    ),
  )
    ? Math.max(
        1,
        Number(
          ctx.governedAutonomousMaximumEvidenceAgeMs,
        ),
      )
    : 6 * 60 * 60 * 1000;
  for (const storyId of [...hydratedIds].sort()) {
    const candidate = hydratedById.get(storyId);
    const story = storyById.get(storyId);
    if (!candidate || !story) {
      counts.compilation_rejected += 1;
      rejected.push({
        story_id: storyId,
        blockers: [
          "governed_autonomous_window_exact_hydrated_candidate_missing",
        ],
      });
      continue;
    }
    let compiled;
    try {
      ctx.assertLeaseHealthy?.();
      compiled = await compileCandidate({
        schema_version: COMPILER_REQUEST_SCHEMA_VERSION,
        mode: "LOCAL_PROOF",
        generated_at: generatedAt,
        scheduled_for: scheduledFor,
        workspace_root: workspaceRoot,
        inventory_root: inventoryRoot,
        allowed_roots: allowedRoots,
        candidate,
        story,
        runtime_policy: runtimePolicy,
      });
      ctx.assertLeaseHealthy?.();
      counts.compilation_succeeded += 1;
    } catch (error) {
      counts.compilation_rejected += 1;
      rejected.push({
        story_id: storyId,
        blockers: [
          String(
            error?.code ||
              "governed_autonomous_window_candidate_compilation_failed",
          ),
        ],
      });
      continue;
    }
    const verifiedTimestamp = Date.parse(
      compiled?.verified_at,
    );
    if (
      !Number.isFinite(verifiedTimestamp) ||
      verifiedTimestamp > generatedTimestamp ||
      generatedTimestamp - verifiedTimestamp >
        maximumEvidenceAgeMs
    ) {
      counts.stale_rejected += 1;
      rejected.push({
        story_id: storyId,
        blockers: [
          "governed_autonomous_window_source_evidence_stale",
        ],
      });
      continue;
    }
    if (
      compiled?.eligibility_verdict !== "GREEN" ||
      compiled?.scheduled_for !== scheduledFor
    ) {
      counts.compilation_rejected += 1;
      rejected.push({
        story_id: storyId,
        blockers: [
          "governed_autonomous_window_compiled_candidate_invalid",
        ],
      });
      continue;
    }
    compiledCandidates.push(compiled);
  }
  const distinctCandidates = new Map();
  for (const candidate of compiledCandidates) {
    const canonicalStoryId = String(
      candidate?.story_id || "",
    ).trim();
    if (
      !/^official_[a-f0-9]{12}$/.test(
        canonicalStoryId,
      ) ||
      distinctCandidates.has(canonicalStoryId)
    ) {
      counts.compilation_rejected += 1;
      rejected.push({
        story_id: canonicalStoryId || null,
        blockers: [
          "governed_autonomous_window_compiled_identity_invalid",
        ],
      });
      continue;
    }
    distinctCandidates.set(canonicalStoryId, candidate);
  }
  const eligible = [...distinctCandidates.values()];
  counts.eligible = eligible.length;
  if (eligible.length < 2) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        "governed_autonomous_window_two_compilable_candidates_required",
      ],
      counts,
      rejected,
      evidence: {
        inventory_report: inventoryReport,
        hydration_report: {
          schema_version: hydration.schema_version || null,
          verdict: hydration.verdict || "HOLD",
          hydrated: hydration.hydrated,
          rejected: hydration.rejected,
          skipped: hydration.skipped,
          safety: hydration.safety || null,
        },
      },
    });
  }

  const windowDir = path.join(
    workspaceRoot,
    "output",
    "governed-autonomous-production-plans",
    scheduledFor.slice(0, 10),
    `${String(scheduledDate.getUTCHours()).padStart(2, "0")}00`,
  );
  const {
    REQUEST_SCHEMA_VERSION: PLANNER_REQUEST_SCHEMA_VERSION,
    planGovernedAutonomousWindowProduction:
      defaultPlanWindowProduction,
  } = require("./services/governed-autonomous-window-production-planner");
  const planWindowProduction =
    ctx.planGovernedAutonomousWindowProduction ||
    defaultPlanWindowProduction;
  let planResult;
  try {
    ctx.assertLeaseHealthy?.();
    planResult = await planWindowProduction(
      {
        schema_version: PLANNER_REQUEST_SCHEMA_VERSION,
        mode: "LOCAL_PROOF",
        generated_at: generatedAt,
        scheduled_for: scheduledFor,
        workspace_root: workspaceRoot,
        reservation_output_path: path.join(
          windowDir,
          "reservation-set.json",
        ),
        plan_output_path: path.join(
          windowDir,
          "production-plan.json",
        ),
        candidates: eligible,
      },
      {
        ...(ctx.governedAutonomousWindowProductionPlannerOptions ||
          {}),
        jobs: ctx.repos.jobs,
      },
    );
    ctx.assertLeaseHealthy?.();
  } catch (error) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        String(
          error?.code ||
            "governed_autonomous_window_production_planning_failed",
        ),
      ],
      counts,
      rejected,
      evidence: {
        inventory_report: inventoryReport,
      },
    });
  }
  if (
    !["CREATED", "REPLAYED"].includes(planResult?.status) ||
    planResult?.plan?.verdict !== "QUEUED_LOCAL_PROOF" ||
    planResult?.plan?.story_approval_mutated !== false ||
    planResult?.plan?.human_approval_dependency !== false ||
    planResult?.plan?.platform_contacted !== false ||
    planResult?.plan?.oauth_or_tokens_mutated !== false ||
    planResult?.plan?.publish_authority_created !== false ||
    planResult?.plan?.scheduler_authority_created !== false ||
    planResult?.plan?.external_posting !== false ||
    !Array.isArray(planResult?.plan?.production_jobs) ||
    planResult.plan.production_jobs.length !== 2
  ) {
    return governedAutonomousWindowPlanningHold({
      blockers: [
        "governed_autonomous_window_production_plan_invalid",
      ],
      counts,
      rejected,
      evidence: { plan_result: planResult || null },
    });
  }
  counts.queued_jobs =
    planResult.plan.production_jobs.length;
  return {
    status: "autonomous_window_production_planned",
    verdict: "GREEN",
    blockers: [],
    scheduled_for: scheduledFor,
    counts,
    rejected: [...rejected].sort((left, right) =>
      String(left?.story_id || "").localeCompare(
        String(right?.story_id || ""),
      ),
    ),
    plan_result: planResult,
    database_scope: "DURABLE_JOB_QUEUE_ONLY",
    ...governedAutonomousWindowPlanningSafety(),
  };
}

async function handleGovernedAutonomousPreT90Window(
  job,
  ctx,
) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const timingHold =
    await governedRunwayCheckpointTimingHold({
      job,
      payload,
      ctx,
      now,
    });
  if (timingHold) return timingHold;

  const scheduledFor = String(
    payload.scheduled_for || "",
  ).trim();
  const scheduledAt = new Date(scheduledFor);
  if (
    !scheduledFor ||
    Number.isNaN(scheduledAt.getTime()) ||
    scheduledAt.toISOString() !== scheduledFor ||
    ![9, 19].includes(scheduledAt.getUTCHours()) ||
    scheduledAt.getUTCMinutes() !== 0 ||
    scheduledAt.getUTCSeconds() !== 0 ||
    scheduledAt.getUTCMilliseconds() !== 0
  ) {
    return {
      status: "held",
      verdict: "HOLD",
      blockers: [
        "governed_autonomous_pre_t90_window_invalid",
      ],
      publish_authority_created: false,
      no_external_posting: true,
      catch_up_allowed: false,
    };
  }
  const workspaceRoot = path.resolve(
    ctx.autonomousProductionWorkspaceRoot ||
      ctx.workspaceRoot ||
      process.cwd(),
  );
  const attemptLeaf = `attempt-${String(
    job?.id ||
      job?.idempotency_key ||
      scheduledFor.replace(/[^0-9A-Za-z._-]+/g, "-"),
  )
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .slice(0, 120)}`;
  const attemptOutputRoot = path.join(
    workspaceRoot,
    "output",
    "governed-autonomous-pre-t90",
    scheduledFor.slice(0, 10),
    `${String(scheduledAt.getUTCHours()).padStart(2, "0")}00`,
    attemptLeaf,
  );
  const runPreparation =
    ctx.runGovernedAutonomousPreT90WindowPreparation ||
    require("./services/governed-autonomous-pre-t90-window-runner")
      .runGovernedAutonomousPreT90WindowPreparation;
  const clock = () => {
    const observed =
      payload.now ||
      (typeof ctx.now === "function"
        ? ctx.now()
        : ctx.now) ||
      new Date();
    return observed instanceof Date
      ? new Date(observed.getTime())
      : new Date(observed);
  };
  ctx.assertLeaseHealthy?.();
  const preparation = await runPreparation(
    {
      schema_version:
        "pulse-governed-autonomous-pre-t90-window-runner-request-v1",
      mode: "LOCAL_PROOF",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: scheduledFor,
      attempt_output_root: attemptOutputRoot,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    {
      workspaceRoot,
      repos: ctx.repos,
      env: ctx.env || process.env,
      clock,
      ...(ctx.governedAutonomousPreT90Dependencies || {}),
    },
  );
  ctx.assertLeaseHealthy?.();
  if (
    preparation?.verdict !== "GREEN" ||
    preparation?.publish_authority_created !== false ||
    preparation?.external_posting !== false
  ) {
    return {
      status: "held",
      verdict: "HOLD",
      blockers:
        Array.isArray(preparation?.blockers) &&
        preparation.blockers.length
          ? preparation.blockers
          : [
              "governed_autonomous_pre_t90_preparation_not_green",
            ],
      preparation,
      publish_authority_created: false,
      no_external_posting: true,
      catch_up_allowed: false,
    };
  }
  return {
    status: "pre_t90_window_prepared",
    verdict: "GREEN",
    blockers: [],
    scheduled_for: scheduledFor,
    preparation,
    publish_authority_created: false,
    no_external_posting: true,
    catch_up_allowed: false,
  };
}

async function handleGovernedYoutubeWindowInventoryMonitor(
  job,
  ctx,
) {
  const run =
    ctx.runGovernedYoutubeWindowInventoryMonitor ||
    require(
      "./services/governed-youtube-window-inventory-handler"
    ).runGovernedYoutubeWindowInventoryMonitor;
  ctx.assertLeaseHealthy?.();
  const result = await run({
    payload: job?.payload || {},
    repos: ctx.repos,
    ...(typeof ctx.readGovernedYoutubeWindowInventoryReport ===
    "function"
      ? {
          readReport:
            ctx.readGovernedYoutubeWindowInventoryReport,
        }
      : {}),
    ...(typeof ctx.notifyWindowInventory === "function"
      ? { notify: ctx.notifyWindowInventory }
      : {}),
  });
  ctx.assertLeaseHealthy?.();
  return result;
}

async function governedRunwayCheckpointTimingHold({
  job,
  payload,
  ctx,
  now,
}) {
  if (!String(job?.run_at || "").trim()) return null;
  const {
    evaluateGovernedYoutubeCheckpointExecutionTime,
  } = require("./services/governed-youtube-window-checkpoint-primer");
  const timing =
    evaluateGovernedYoutubeCheckpointExecutionTime({
      kind: job.kind,
      runAt: job.run_at,
      now,
    });
  if (timing.execute_checkpoint) return null;

  const checkpoint = {
    prepare_governed_autonomous_pre_t90_window: {
      phase: "T-94",
      offset_minutes: -94,
      incident: "incident-t94-timing.json",
    },
    governed_youtube_runway_t90: {
      phase: "T-90",
      offset_minutes: -90,
      incident: "incident-t90-timing.json",
    },
    admit_governed_publication: {
      phase: "T-75",
      offset_minutes: -75,
      incident: "incident-t75-timing.json",
    },
    governed_youtube_runway_t60: {
      phase: "T-60",
      offset_minutes: -60,
      incident: "incident-t60-timing.json",
    },
    prestage_governed_youtube_release: {
      phase: "T-70",
      offset_minutes: -70,
      incident: "incident-t70-timing.json",
    },
    verify_governed_youtube_release_tminus15: {
      phase: "T-15",
      offset_minutes: -15,
      incident: "incident-tminus15-timing.json",
    },
    verify_governed_youtube_release_t0: {
      phase: "T0",
      offset_minutes: 0,
      incident: "incident-t0-timing.json",
    },
    governed_youtube_runway_tplus15: {
      phase: "T+15",
      offset_minutes: 15,
      incident: "incident-tplus15-timing.json",
    },
  }[job.kind];
  if (!checkpoint) {
    throw new Error("runway_checkpoint_kind_invalid");
  }
  const phase = checkpoint.phase;
  const dueAt = new Date(timing.due_at);
  const scheduledAt = new Date(
    dueAt.getTime() -
      checkpoint.offset_minutes * 60 * 1000,
  );
  const durableRoot = payload.out_dir
    ? path.resolve(payload.out_dir)
    : governedRunwayRoot(payload, ctx);
  const outDir = containedRunwayPath(
    durableRoot,
    payload.out_dir
      ? durableRoot
      : governedRunwayWindowDirectory({
          scheduledFor: scheduledAt,
          root: durableRoot,
        }),
  );
  await fs.ensureDir(outDir);
  const incidentJson = path.join(
    outDir,
    checkpoint.incident,
  );
  const alreadyExists = await fs.pathExists(incidentJson);
  const classification = "MISSED_INTERNAL";
  const blocker =
    timing.status === "NOT_DUE"
      ? `runway_checkpoint_not_due:${phase}:${timing.due_at}`
      : `runway_checkpoint_late:${phase}:${timing.due_at}`;
  const incident = alreadyExists
    ? await fs.readJson(incidentJson)
    : {
        schema_version:
          "pulse-governed-youtube-runway-incident-v1",
        phase,
        scheduled_for: scheduledAt.toISOString(),
        checkpoint_due_at: timing.due_at,
        classification,
        verdict: "HOLD",
        blockers: [blocker],
        lateness_ms: timing.lateness_ms,
        maximum_lateness_ms: timing.maximum_lateness_ms,
        generated_at: timing.evaluated_at,
        publish_authority: false,
        external_posting: false,
        catch_up_allowed: false,
        retry_allowed: false,
      };
  if (!alreadyExists) {
    await atomicWriteRunwayJson(incidentJson, incident);
  }
  const notificationSent = alreadyExists
    ? false
    : await notifyGovernedRunwayIncident(ctx, incident);
  return {
    status: "held",
    verdict: "HOLD",
    classification,
    phase,
    scheduled_for: scheduledAt.toISOString(),
    checkpoint_due_at: timing.due_at,
    blockers: incident.blockers,
    lateness_ms: incident.lateness_ms,
    maximum_lateness_ms: incident.maximum_lateness_ms,
    incident_json: incidentJson,
    notification_sent: notificationSent,
    checkpoint_executed: false,
    no_external_posting: true,
    publish_authority_created: false,
    catch_up_allowed: false,
    retry_allowed: false,
  };
}

function releaseCheckpointOutDir(payload, ctx) {
  const scheduledFor = payload.scheduled_for;
  const durableRoot = payload.out_dir
    ? path.resolve(payload.out_dir)
    : governedRunwayRoot(payload, ctx);
  return containedRunwayPath(
    durableRoot,
    payload.out_dir
      ? durableRoot
      : governedRunwayWindowDirectory({
          scheduledFor,
          root: durableRoot,
        }),
  );
}

function releaseCheckpointExactIdentity({
  payload,
  detail = {},
}) {
  const text = (value) =>
    String(value || "").trim() || null;
  const hash = (value) =>
    String(value || "").trim().toLowerCase() || null;
  const integer = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0
      ? number
      : null;
  };
  return {
    story_id:
      text(detail.story_id) ||
      text(detail.selected_story_id) ||
      text(payload.story_id),
    selected_role:
      text(detail.selected_role) ||
      text(payload.selected_role),
    selected_story_id:
      text(detail.selected_story_id) ||
      text(detail.story_id) ||
      text(payload.story_id),
    scheduled_event_id:
      integer(detail.scheduled_event_id) ||
      integer(payload.scheduled_event_id),
    external_id:
      text(detail.external_id) ||
      text(payload.external_id),
    dispatch_idempotency_key:
      text(detail.dispatch_idempotency_key) ||
      text(payload.dispatch_idempotency_key),
    request_fingerprint:
      hash(detail.request_fingerprint) ||
      hash(payload.request_fingerprint),
    promotion_sha256:
      hash(detail.promotion_sha256) ||
      hash(payload.promotion_sha256),
    runway_lock_sha256:
      hash(payload.runway_lock_sha256),
    media_sha256:
      hash(detail.media_sha256) ||
      hash(payload.media_sha256),
    script_sha256:
      hash(detail.script_sha256) ||
      hash(payload.script_sha256),
  };
}

function releaseCheckpointIdentityMatches(
  evidence,
  expected,
) {
  const actual = releaseCheckpointExactIdentity({
    payload: evidence || {},
    detail: evidence || {},
  });
  return Object.keys(expected).every(
    (field) => actual[field] === expected[field],
  );
}

async function writeReleaseCheckpointEvidence({
  phase,
  filename,
  payload,
  ctx,
  now,
  verdict,
  blockers = [],
  detail = {},
  incidentRequired = verdict === "HOLD",
}) {
  const outDir = releaseCheckpointOutDir(payload, ctx);
  await fs.ensureDir(outDir);
  const evidencePath = path.join(outDir, filename);
  const exactIdentity = releaseCheckpointExactIdentity({
    payload,
    detail,
  });
  if (await fs.pathExists(evidencePath)) {
    const existing = await fs.readJson(evidencePath);
    if (
      existing.phase !== phase ||
      existing.scheduled_for !==
        new Date(payload.scheduled_for).toISOString() ||
      !releaseCheckpointIdentityMatches(
        existing,
        exactIdentity,
      )
    ) {
      throw new Error(
        "runway_checkpoint_immutable_binding_conflict",
      );
    }
    if (
      existing.verdict === "GREEN" &&
      verdict === "HOLD"
    ) {
      const revocationPath = evidencePath.replace(
        /\.json$/i,
        ".revocation.json",
      );
      const revocation = {
        schema_version:
          "pulse-governed-youtube-release-checkpoint-revocation-v1",
        phase,
        generated_at: now.toISOString(),
        scheduled_for: new Date(
          payload.scheduled_for,
        ).toISOString(),
        ...exactIdentity,
        verdict: "HOLD",
        blockers: [...new Set(blockers)],
        previous_verdict: existing.verdict,
        revoked_evidence_path: evidencePath,
        catch_up_allowed: false,
        publish_authority: false,
        ...detail,
      };
      if (await fs.pathExists(revocationPath)) {
        const existingRevocation =
          await fs.readJson(revocationPath);
        if (
          existingRevocation.phase !== phase ||
          !releaseCheckpointIdentityMatches(
            existingRevocation,
            exactIdentity,
          )
        ) {
          throw new Error(
            "runway_checkpoint_revocation_binding_conflict",
          );
        }
        return {
          evidence: existingRevocation,
          evidence_path: evidencePath,
          revocation_path: revocationPath,
          incident_path: null,
          notification_sent: false,
          reused: true,
        };
      }
      await atomicWriteRunwayJson(
        revocationPath,
        revocation,
      );
      return {
        evidence: revocation,
        evidence_path: evidencePath,
        revocation_path: revocationPath,
        incident_path: null,
        notification_sent: false,
        reused: false,
      };
    }
    if (existing.verdict !== verdict) {
      throw new Error(
        "runway_checkpoint_immutable_verdict_conflict",
      );
    }
    const phaseSlug = phase
      .toLowerCase()
      .replace("+", "plus")
      .replace("-", "minus");
    const existingIncidentPath = path.join(
      outDir,
      `incident-${phaseSlug}.json`,
    );
    return {
      evidence: existing,
      evidence_path: evidencePath,
      incident_path: (await fs.pathExists(
        existingIncidentPath,
      ))
        ? existingIncidentPath
        : null,
      notification_sent: false,
      reused: true,
    };
  }
  const evidence = {
    schema_version:
      "pulse-governed-youtube-release-checkpoint-v1",
    phase,
    generated_at: now.toISOString(),
    scheduled_for: new Date(
      payload.scheduled_for,
    ).toISOString(),
    ...exactIdentity,
    verdict,
    blockers: [...new Set(blockers)],
    catch_up_allowed: false,
    publish_authority: false,
    ...detail,
  };
  await atomicWriteRunwayJson(evidencePath, evidence);
  let incidentPath = null;
  let notificationSent = false;
  if (incidentRequired) {
    const phaseSlug = phase
      .toLowerCase()
      .replace("+", "plus")
      .replace("-", "minus");
    incidentPath = path.join(
      outDir,
      `incident-${phaseSlug}.json`,
    );
    const incident = {
      schema_version:
        "pulse-governed-youtube-runway-incident-v1",
      ...evidence,
      classification:
        detail.classification || "HELD_POLICY",
      retry_allowed: false,
      external_posting: false,
    };
    const exists = await fs.pathExists(incidentPath);
    if (!exists) {
      await atomicWriteRunwayJson(incidentPath, incident);
      notificationSent =
        await notifyGovernedRunwayIncident(ctx, incident);
    }
  }
  return {
    evidence,
    evidence_path: evidencePath,
    incident_path: incidentPath,
    notification_sent: notificationSent,
  };
}

async function governedReleaseEnvelope(payload, ctx) {
  try {
    const envelope = await loadGovernedRunwayEnvelope({
      scheduledFor: payload.scheduled_for,
      payload,
      ctx,
    });
    const blockers = [...envelope.blockers];
    if (
      String(payload.runway_lock_sha256 || "")
        .trim()
        .toLowerCase() !==
      String(envelope.lock?.lock_sha256 || "")
        .trim()
        .toLowerCase()
    ) {
      blockers.push("runway_release_lock_binding_mismatch");
    }
    const promotion =
      canonicalRunwayPromotionEvidence(
        envelope.lock,
        ctx,
      );
    blockers.push(...promotion.blockers);
    const selectedStoryId = promotion.promotion
      ? envelope.lock?.reserve?.story_id
      : envelope.lock?.primary?.story_id;
    const isT60SelectionCheckpoint =
      payload.phase === "T-60" &&
      payload.readiness_verification_authority === true;
    if (
      !isT60SelectionCheckpoint &&
      String(payload.story_id || "").trim() !==
        String(selectedStoryId || "").trim()
    ) {
      blockers.push("runway_release_story_binding_mismatch");
    }
    if (
      new Date(payload.scheduled_for).toISOString() !==
      new Date(envelope.lock?.scheduled_for).toISOString()
    ) {
      blockers.push("runway_release_window_binding_mismatch");
    }
    return {
      ...envelope,
      selected_role: promotion.promotion
        ? "reserve"
        : "primary",
      reserve_promotion: promotion.promotion,
      blockers: [...new Set(blockers)],
    };
  } catch (error) {
    return {
      lock: null,
      blockers: [
        error?.code ||
          error?.message ||
          "runway_release_lock_unavailable",
      ],
    };
  }
}

function publicReleaseVerifier(ctx, now) {
  if (typeof ctx.verifyYoutubePublicObject === "function") {
    return ctx.verifyYoutubePublicObject;
  }
  if (ctx.youtubeClient) {
    return require(
      "./services/youtube-public-object-verifier"
    ).createYoutubePublicObjectVerifier({
      youtubeClient: ctx.youtubeClient,
      now: () => new Date(now),
    });
  }
  const apiKey = String(
    ctx.env?.YOUTUBE_API_KEY ||
      process.env.YOUTUBE_API_KEY ||
      "",
  ).trim();
  if (apiKey) {
    try {
      return require(
        "./services/youtube-public-object-verifier"
      ).createYoutubePublicObjectVerifier({
        apiKey,
        now: () => new Date(now),
      });
    } catch {
      // Fall through to an authenticated production client.
    }
  }
  let verifierPromise = null;
  return async (candidate) => {
    verifierPromise ||= (async () => {
      const { google } = require("googleapis");
      const { getAuthClient } = require("../upload_youtube");
      const auth = await getAuthClient({
        reportAuthTelemetry:
          typeof ctx.reportYoutubeAuthTelemetry === "function"
            ? ctx.reportYoutubeAuthTelemetry
            : () => {},
      });
      return require(
        "./services/youtube-public-object-verifier"
      ).createYoutubePublicObjectVerifier({
        youtubeClient: google.youtube({
          version: "v3",
          auth,
        }),
        now: () => new Date(now),
      });
    })();
    const verifier = await verifierPromise;
    return verifier(candidate);
  };
}

async function governedYoutubeFreshControl(
  ctx,
  payload,
  now,
  operatingContract,
) {
  if (typeof ctx.resolveRunwayFreshControl === "function") {
    return ctx.resolveRunwayFreshControl({
      now,
      payload,
      repos: ctx.repos,
      env: ctx.env || process.env,
      operatingContract,
    });
  }
  const {
    deriveMultiLaneRuntimeControl,
  } = require("./services/multi-lane-runtime-control");
  const control = deriveMultiLaneRuntimeControl({
    payload: {
      ...payload,
      scheduler_profile: "governed_multi_lane",
      live_publish_enabled: true,
    },
    repos: ctx.repos,
    env: ctx.env || process.env,
    now,
    operatingContract,
  });
  return {
    verdict:
      control.kill_switch_healthy === true &&
      control.operating_contract_valid === true &&
      control.scheduler_owner_healthy === true &&
      control.live_publish_enabled === true
        ? "GREEN"
        : "HOLD",
    checked_at: now.toISOString(),
    kill_switch_healthy:
      control.kill_switch_healthy === true,
    operating_contract_valid:
      control.operating_contract_valid === true,
    scheduler_owner_healthy:
      control.scheduler_owner_healthy === true,
    live_publish_enabled:
      control.live_publish_enabled === true,
    evidence: control.evidence,
  };
}

function freshControlBlockers(control, prefix, now = new Date()) {
  const blockers = [];
  if (
    control?.verdict !== "GREEN" ||
    control?.kill_switch_healthy !== true ||
    control?.operating_contract_valid !== true ||
    control?.scheduler_owner_healthy !== true ||
    control?.live_publish_enabled !== true
  ) {
    blockers.push(`${prefix}_fresh_control_not_green`);
  }
  const checkedAt = Date.parse(control?.checked_at);
  if (
    !Number.isFinite(checkedAt) ||
    Math.abs(new Date(now).getTime() - checkedAt) > 60 * 1000
  ) {
    blockers.push(`${prefix}_fresh_control_stale`);
  }
  return blockers;
}

function runwayLifecycleEvidence(event) {
  return parseRunwayEvidence(event?.evidence_json);
}

function canonicalRunwayPromotionEvidence(lock, ctx) {
  const db = ctx.repos?.db;
  const blockers = [];
  if (!lock) {
    return {
      promotion: null,
      blockers: ["runway_release_lock_unavailable"],
    };
  }
  let promotion = null;
  if (db && typeof db.prepare === "function") {
    try {
      const row = db
        .prepare(
          `SELECT *
           FROM operator_audit_log
           WHERE action = 'governed_youtube_reserve_promotion'
             AND target_type = 'youtube_runway_window'
             AND target_id = ?
             AND decision = 'APPROVED'
           ORDER BY id DESC
           LIMIT 1`,
        )
        .get(lock.window_id);
      if (row) {
        const parsed = parseRunwayEvidence(
          row.evidence_json,
        );
        promotion =
          parsed.promotion &&
          typeof parsed.promotion === "object"
            ? parsed.promotion
            : parsed;
        const {
          validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
          validateGovernedYoutubeReservePromotionEvidence,
        } = require(
          "./services/governed-youtube-release-runway"
        );
        blockers.push(
          ...(promotion?.authority_type ===
          "CONFIRMED_DISARM_FAILOVER"
            ? validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence(
                {
                  lock,
                  promotion,
                },
              )
            : validateGovernedYoutubeReservePromotionEvidence({
                lock,
                promotion,
              })),
        );
      }
    } catch (error) {
      blockers.push(
        error?.code ||
          error?.message ||
          "runway_reserve_promotion_evidence_read_failed",
      );
    }
  }
  return {
    promotion,
    blockers: [...new Set(blockers)],
  };
}

function canonicalRunwaySelectedRelease(envelope, ctx) {
  const blockers = [];
  if (!envelope?.lock) {
    return {
      selected_role: "primary",
      selected: null,
      exact_binding: {
        story_id: "",
        channel_id:
          String(
            ctx.channel?.id ||
              process.env.CHANNEL ||
              "pulse-gaming",
          ).trim(),
        platform: "youtube",
        scheduled_event_id: null,
        scheduled_for: "",
        dispatch_idempotency_key: "",
        request_fingerprint: "",
        runway_lock_sha256: "",
        media_sha256: "",
        script_sha256: "",
      },
      promotion: null,
      scheduled_event: null,
      blockers: ["runway_release_lock_unavailable"],
    };
  }
  const promotionEvidence =
    canonicalRunwayPromotionEvidence(
      envelope.lock,
      ctx,
    );
  blockers.push(...promotionEvidence.blockers);
  const promotion = promotionEvidence.promotion;
  const selectedRole =
    promotion && blockers.length === 0
      ? "reserve"
      : "primary";
  const selected = envelope.lock[selectedRole];
  const storyId = String(
    selected?.story_id || "",
  ).trim();
  const governance = ctx.repos?.publicationGovernance;
  const scheduledEvent =
    governance?.getLatestLifecycleEvent?.(
      storyId,
      "youtube",
      "SCHEDULED",
    ) || null;
  const evidence = runwayLifecycleEvidence(
    scheduledEvent,
  );
  const publicationState =
    governance?.getState?.(storyId, "youtube") || null;
  const platformPost =
    ctx.repos?.platformPosts?.getByStoryPlatform?.(
      storyId,
      "youtube",
    ) || null;
  const stateExternalId = String(
    publicationState?.external_id || "",
  ).trim();
  const postExternalId = String(
    platformPost?.external_id || "",
  ).trim();
  if (
    stateExternalId &&
    postExternalId &&
    stateExternalId !== postExternalId
  ) {
    blockers.push(
      "runway_selected_external_id_projection_mismatch",
    );
  }
  const exact = {
    story_id: storyId,
    channel_id:
      String(
        ctx.channel?.id ||
          process.env.CHANNEL ||
          "pulse-gaming",
      ).trim(),
    platform: "youtube",
    scheduled_event_id:
      Number(scheduledEvent?.id) || null,
    scheduled_for:
      String(evidence.scheduled_for || "").trim(),
    dispatch_idempotency_key:
      String(
        evidence.dispatch_idempotency_key || "",
      ).trim(),
    request_fingerprint:
      String(evidence.request_fingerprint || "")
        .trim()
        .toLowerCase(),
    runway_lock_sha256:
      String(evidence.runway_lock_sha256 || "")
        .trim()
        .toLowerCase(),
    media_sha256:
      String(selected?.media_sha256 || "")
        .trim()
        .toLowerCase(),
    script_sha256:
      String(selected?.script_sha256 || "")
        .trim()
        .toLowerCase(),
    external_id: stateExternalId || postExternalId || null,
  };
  if (!scheduledEvent) {
    blockers.push("runway_selected_scheduled_event_required");
  }
  if (
    exact.scheduled_for !== envelope.lock.scheduled_for ||
    exact.runway_lock_sha256 !== envelope.lock.lock_sha256
  ) {
    blockers.push(
      "runway_selected_scheduled_binding_mismatch",
    );
  }
  if (
    !Number.isInteger(exact.scheduled_event_id) ||
    exact.scheduled_event_id <= 0 ||
    !exact.dispatch_idempotency_key ||
    !/^[a-f0-9]{64}$/.test(
      exact.request_fingerprint,
    )
  ) {
    blockers.push(
      "runway_selected_scheduled_identity_invalid",
    );
  }
  return {
    selected_role: selectedRole,
    selected,
    exact_binding: exact,
    promotion,
    scheduled_event: scheduledEvent,
    blockers: [...new Set(blockers)],
  };
}

function runwayControlledExperimentObservation(selection) {
  const scheduledEvidence = runwayLifecycleEvidence(
    selection?.scheduled_event,
  );
  const publicationEvidence =
    scheduledEvidence?.publication_evidence;
  return publicationEvidence &&
    typeof publicationEvidence === "object" &&
    !Array.isArray(publicationEvidence)
    ? publicationEvidence.controlled_experiment_observation ||
        null
    : null;
}

function runwayControlledExperimentExpectedEvidence(
  selection,
  observation,
) {
  return {
    expectedIdentity: {
      story_id: selection.exact_binding.story_id,
      channel_id: selection.exact_binding.channel_id,
    },
    expectedBindings: {
      ...observation.bindings,
      media_sha256:
        selection.exact_binding.media_sha256,
      script_sha256:
        selection.exact_binding.script_sha256,
    },
  };
}

function runwayControlledExperimentNotEligible(selection) {
  return {
    schema_version:
      "pulse-controlled-experiment-assignment-binding-v1",
    status: "NOT_ELIGIBLE",
    experiment_eligible: false,
    ineligibility_reason:
      "breaking_short_contract_is_not_in_controlled_matrix",
    story_id: selection.exact_binding.story_id,
    channel_id: selection.exact_binding.channel_id,
  };
}

async function resolveRunwayControlledExperimentRuntimeIdentity(
  ctx,
) {
  const resolver =
    ctx.resolveControlledExperimentRuntimeIdentity ||
    require(
      "./services/controlled-experiment-runtime-identity"
    ).resolveControlledExperimentRuntimeIdentity;
  return resolver({
    env: ctx.env || process.env,
    cwd: ctx.runtimeCwd || process.cwd(),
    ...(ctx.liveGuardedProfilePath
      ? { profilePath: ctx.liveGuardedProfilePath }
      : {}),
  });
}

async function assignRunwayControlledExperimentAtT60({
  selection,
  state,
  ctx,
}) {
  const observation =
    runwayControlledExperimentObservation(selection);
  if (
    !observation &&
    String(selection?.selected?.lane_id || "").trim() ===
      "breaking_short"
  ) {
    return runwayControlledExperimentNotEligible(
      selection,
    );
  }
  if (!observation) {
    throw new Error(
      "controlled_experiment_observation_required",
    );
  }
  const expected =
    runwayControlledExperimentExpectedEvidence(
      selection,
      observation,
    );
  const runtimeIdentity =
    observation.experiment?.eligible === true
      ? await resolveRunwayControlledExperimentRuntimeIdentity(
          ctx,
        )
      : null;
  const assign =
    ctx.assignControlledExperimentAtT60 ||
    require(
      "./services/controlled-experiment-runway-binding"
    ).assignControlledExperimentAtT60;
  return assign({
    controlledExperiments:
      ctx.repos?.controlledExperiments,
    observation,
    ...expected,
    videoId: String(state?.external_id || "").trim(),
    scheduledFor:
      selection.exact_binding.scheduled_for,
    runtimeIdentity,
  });
}

async function verifyRunwayControlledExperimentAtT15({
  selection,
  externalId,
  payload,
  ctx,
}) {
  const observation =
    runwayControlledExperimentObservation(selection);
  if (
    !observation &&
    String(selection?.selected?.lane_id || "").trim() ===
      "breaking_short"
  ) {
    return runwayControlledExperimentNotEligible(
      selection,
    );
  }
  if (!observation) {
    throw new Error(
      "controlled_experiment_observation_required",
    );
  }
  const expected =
    runwayControlledExperimentExpectedEvidence(
      selection,
      observation,
    );
  if (observation.experiment?.eligible !== true) {
    const verify =
      ctx.verifyControlledExperimentAtT15 ||
      require(
        "./services/controlled-experiment-runway-binding"
      ).verifyControlledExperimentAtT15;
    return verify({
      controlledExperiments:
        ctx.repos?.controlledExperiments,
      observation,
      ...expected,
      videoId: externalId,
      scheduledFor:
        selection.exact_binding.scheduled_for,
      runtimeIdentity: null,
      assignmentBinding: null,
    });
  }
  const t60Path = path.join(
    releaseCheckpointOutDir(payload, ctx),
    "t60-readiness.json",
  );
  if (!(await fs.pathExists(t60Path))) {
    throw new Error(
      "controlled_experiment_t60_checkpoint_required",
    );
  }
  const t60 = await fs.readJson(t60Path);
  if (
    t60?.phase !== "T-60" ||
    t60?.verdict !== "GREEN" ||
    t60?.scheduled_for !==
      selection.exact_binding.scheduled_for ||
    t60?.runway_lock_sha256 !==
      selection.exact_binding.runway_lock_sha256 ||
    t60?.story_id !==
      selection.exact_binding.story_id ||
    String(t60?.external_id || "").trim() !==
      String(externalId || "").trim()
  ) {
    throw new Error(
      "controlled_experiment_t60_checkpoint_binding_mismatch",
    );
  }
  const runtimeIdentity =
    await resolveRunwayControlledExperimentRuntimeIdentity(
      ctx,
    );
  const verify =
    ctx.verifyControlledExperimentAtT15 ||
    require(
      "./services/controlled-experiment-runway-binding"
    ).verifyControlledExperimentAtT15;
  return verify({
    controlledExperiments:
      ctx.repos?.controlledExperiments,
    observation,
    ...expected,
    videoId: externalId,
    scheduledFor:
      selection.exact_binding.scheduled_for,
    runtimeIdentity,
    assignmentBinding:
      t60.controlled_experiment_assignment,
  });
}

function governedYoutubeVerificationClock(ctx) {
  return typeof ctx.irreversibleBoundaryNow === "function"
    ? ctx.irreversibleBoundaryNow
    : () => new Date();
}

function governedYoutubeConvergenceWindow({
  phase,
  scheduledFor,
}) {
  const scheduledAt = new Date(scheduledFor);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error(
      "youtube_verification_convergence_window_invalid",
    );
  }
  if (phase === "T-60") {
    return {
      startedAt: new Date(
        scheduledAt.getTime() - 60 * 60 * 1000,
      ).toISOString(),
      cutoffAt: new Date(
        scheduledAt.getTime() - 15 * 60 * 1000,
      ).toISOString(),
      maxAttempts: 46,
    };
  }
  if (phase === "T0") {
    return {
      startedAt: scheduledAt.toISOString(),
      cutoffAt: new Date(
        scheduledAt.getTime() + 15 * 60 * 1000,
      ).toISOString(),
      maxAttempts: 16,
    };
  }
  throw new Error(
    "youtube_verification_convergence_phase_invalid",
  );
}

function governedYoutubeConvergenceStateDir({
  phase,
  payload,
  selection,
  ctx,
}) {
  const storyId = String(
    selection.exact_binding.story_id || "",
  ).trim();
  const safeStory = storyId
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const storyHash = crypto
    .createHash("sha256")
    .update(storyId)
    .digest("hex")
    .slice(0, 12);
  const role = selection.selected_role;
  const phaseDirectory =
    phase === "T-60"
      ? "t60-verification-convergence"
      : "t0-verification-convergence";
  return path.join(
    releaseCheckpointOutDir(payload, ctx),
    phaseDirectory,
    `${role}-${safeStory || "story"}-${storyHash}`,
  );
}

function governedYoutubeConvergenceArtifactHashValid(value) {
  if (!value || typeof value !== "object") return false;
  const body = { ...value };
  const claimed = String(
    body.artifact_sha256 || "",
  )
    .trim()
    .toLowerCase();
  delete body.artifact_sha256;
  const canonical = (candidate) => {
    if (Array.isArray(candidate)) {
      return candidate.map(canonical);
    }
    if (!candidate || typeof candidate !== "object") {
      return candidate;
    }
    return Object.fromEntries(
      Object.keys(candidate)
        .sort()
        .map((key) => [key, canonical(candidate[key])]),
    );
  };
  const actual = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
  return /^[a-f0-9]{64}$/.test(claimed) &&
    actual === claimed;
}

function governedYoutubeTransientVerificationReason(
  phase,
  reason,
) {
  const value = String(reason || "").trim();
  const transient =
    phase === "T-60"
      ? new Set([
          "youtube_api_check_error",
          "youtube_api_response_invalid",
          "youtube_private_object_not_found",
          "youtube_private_object_upload_not_processed",
          "youtube_private_object_processing_not_succeeded",
          "private_unscheduled_not_yet_verified",
          "verification_pending",
        ])
      : new Set([
          "youtube_api_check_error",
          "youtube_api_response_invalid",
          "youtube_object_not_found",
          "youtube_privacy_not_public",
          "youtube_upload_not_processed",
          "public_release_not_verified",
          "verification_pending",
        ]);
  return transient.has(value);
}

function governedYoutubeVerificationOutcome({
  phase,
  observation,
  externalId,
  alreadyFinalised = false,
}) {
  const reason = String(
    observation?.reason ||
      observation?.verification?.reason ||
      "",
  ).trim();
  const evidence =
    observation?.evidence ||
    observation?.verification?.evidence ||
    null;
  const observedExternalId = String(
    observation?.externalId ||
      observation?.external_id ||
      "",
  ).trim();
  const privateGreen =
    phase === "T-60" &&
    (observation?.confirmed === true ||
      observation?.status === "private_object_verified") &&
    observation?.scheduled !== true &&
    observation?.releaseArmed !== true &&
    observation?.releaseCommitmentConfirmed !== true &&
    (
      evidence == null ||
      (
        evidence.privacy_status === "private" &&
        evidence.upload_status === "processed" &&
        evidence.processing_status === "succeeded" &&
        evidence.release_armed !== true &&
        evidence.publish_at == null
      )
    );
  const publicGreen =
    phase === "T0" &&
    (observation?.confirmed === true ||
      observation?.published === true ||
      observation?.status === "published") &&
    (
      evidence == null ||
      (
        evidence.public === true &&
        evidence.privacy_status === "public" &&
        evidence.upload_status === "processed"
      )
    );
  if (
    (privateGreen || publicGreen) &&
    observedExternalId === externalId
  ) {
    return {
      outcome: "CONFIRMED",
      reason:
        phase === "T-60"
          ? "youtube_private_unscheduled_processed"
          : "youtube_public_processed",
      blockers: [],
      evidence: {
        external_id: externalId,
        verifier_result: observation,
        already_finalised: alreadyFinalised,
      },
    };
  }
  const finalReason =
    reason ||
    (phase === "T-60"
      ? "youtube_private_unscheduled_not_confirmed"
      : "youtube_public_release_not_confirmed");
  return {
    outcome: governedYoutubeTransientVerificationReason(
      phase,
      finalReason,
    )
      ? "RETRYABLE"
      : "TERMINAL",
    reason: finalReason,
    blockers: [finalReason],
    evidence: {
      external_id: observedExternalId || externalId,
      verifier_result: observation || null,
      already_finalised: alreadyFinalised,
    },
  };
}

function governedYoutubeVerificationErrorOutcome({
  phase,
  error,
  externalId,
}) {
  const reason = String(
    error?.code || error?.message || "",
  ).trim() || "youtube_verification_read_failed";
  const validationFailure =
    /(required|invalid|mismatch|forbidden|conflict|authority)/i.test(
      reason,
    );
  const transient =
    !validationFailure &&
    (
      governedYoutubeTransientVerificationReason(
        phase,
        reason,
      ) ||
      /(^|_)(timeout|timed_out|temporar|rate_limit|econn|enotfound|eai_again|429|5\d\d)/i.test(
        reason,
      )
    );
  return {
    outcome: transient ? "RETRYABLE" : "TERMINAL",
    reason,
    blockers: [reason],
    evidence: {
      external_id: externalId,
      verification_error: {
        code: String(error?.code || "").trim() || null,
        message: String(error?.message || "").trim() || null,
        compensation_required:
          error?.compensationRequired === true,
        compensation_attempted:
          error?.compensationAttempted === true,
        compensation_confirmed:
          error?.compensationConfirmed === true,
        remote_disarm_required:
          error?.remoteDisarmRequired === true,
        remote_containment_required:
          error?.remoteContainmentRequired === true,
      },
    },
  };
}

async function governedYoutubeReadOnlyVerifier({
  phase,
  selection,
  ctx,
  clock,
}) {
  const injected =
    phase === "T-60"
      ? ctx.verifyYoutubePrivateObject
      : ctx.verifyYoutubePublicObject;
  if (typeof injected === "function") {
    return async (verificationContext) => {
      const observation = await injected(
        {
          platform: "youtube",
          storyId: selection.exact_binding.story_id,
          externalId:
            selection.exact_binding.external_id,
        },
        {
          signal: verificationContext.signal,
          maxAttempts: 1,
        },
      );
      return governedYoutubeVerificationOutcome({
        phase,
        observation,
        externalId:
          selection.exact_binding.external_id,
      });
    };
  }

  const legacy =
    phase === "T-60"
      ? ctx.verifyExactGovernedYoutubePrivatePrestage
      : ctx.confirmExactGovernedYoutubeScheduledRelease;
  if (typeof legacy === "function") {
    return async () => {
      const observation =
        phase === "T-60"
          ? await legacy({
              exactStagedBinding:
                selection.exact_binding,
              channelId:
                selection.exact_binding.channel_id,
              repos: ctx.repos,
              env: ctx.env || process.env,
              now: clock,
              irreversibleBoundaryNow: clock,
              ownerId: ctx.workerId || null,
            })
          : await legacy({
              exactStagedBinding:
                selection.exact_binding,
              channelId:
                selection.exact_binding.channel_id,
              repos: ctx.repos,
              now: clock,
              ownerId: ctx.workerId || null,
            });
      return governedYoutubeVerificationOutcome({
        phase,
        observation,
        externalId:
          selection.exact_binding.external_id,
        alreadyFinalised: true,
      });
    };
  }

  let verifierPromise = null;
  return async (verificationContext) => {
    verifierPromise ||= (async () => {
      const createAuthenticatedYoutubeClient =
        ctx.createAuthenticatedYoutubeClient ||
        require(
          "./services/governed-youtube-publisher-adapter"
        ).createAuthenticatedYoutubeClient;
      const youtubeClient =
        ctx.youtubeClient ||
        (await createAuthenticatedYoutubeClient({
          reportAuthTelemetry:
            ctx.reportYoutubeAuthTelemetry,
        }));
      const readOnlyYoutubeClient = Object.freeze({
        videos: Object.freeze({
          list: (...args) =>
            youtubeClient.videos.list(...args),
        }),
      });
      const factory =
        phase === "T-60"
          ? ctx.createYoutubePrivateObjectVerifier ||
            require(
              "./services/youtube-private-object-verifier"
            ).createYoutubePrivateObjectVerifier
          : ctx.createYoutubePublicObjectVerifier ||
            require(
              "./services/youtube-public-object-verifier"
            ).createYoutubePublicObjectVerifier;
      return factory({
        youtubeClient: readOnlyYoutubeClient,
        now: clock,
        maxAttempts: 1,
        pollIntervalMs: 0,
      });
    })();
    const verifier = await verifierPromise;
    const observation = await verifier(
      {
        platform: "youtube",
        storyId: selection.exact_binding.story_id,
        externalId:
          selection.exact_binding.external_id,
      },
      {
        signal: verificationContext.signal,
        maxAttempts: 1,
      },
    );
    return governedYoutubeVerificationOutcome({
      phase,
      observation,
      externalId: selection.exact_binding.external_id,
    });
  };
}

async function readGovernedYoutubeConvergenceObservation(
  convergence,
  stateDir,
) {
  const relativePath =
    convergence?.final?.decisive_attempt_evidence;
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim()
  ) {
    return null;
  }
  const expectedRoot = path.resolve(stateDir);
  const attemptPath = path.resolve(
    expectedRoot,
    relativePath,
  );
  if (
    attemptPath !== expectedRoot &&
    !attemptPath.startsWith(`${expectedRoot}${path.sep}`)
  ) {
    throw new Error(
      "youtube_verification_convergence_attempt_path_invalid",
    );
  }
  const attempt = await fs.readJson(attemptPath);
  return attempt?.evidence || null;
}

async function runGovernedYoutubeVerificationConvergence({
  phase,
  payload,
  selection,
  ctx,
}) {
  const externalId = String(
    selection.exact_binding.external_id || "",
  ).trim();
  if (!externalId) {
    return {
      status: "RETRY_SCHEDULED",
      terminal: false,
      retry_after_seconds: 60,
      reason: "youtube_verification_external_id_pending",
      blockers: ["youtube_verification_external_id_pending"],
      final: null,
      observation: null,
    };
  }
  const clock = governedYoutubeVerificationClock(ctx);
  const stateDir = governedYoutubeConvergenceStateDir({
    phase,
    payload,
    selection,
    ctx,
  });
  const window = governedYoutubeConvergenceWindow({
    phase,
    scheduledFor: payload.scheduled_for,
  });
  const verifyReadOnly =
    await governedYoutubeReadOnlyVerifier({
      phase,
      selection,
      ctx,
      clock,
    });
  const run =
    ctx.runBoundedVerificationConvergence ||
    require(
      "./services/bounded-verification-convergence"
    ).runBoundedVerificationConvergence;
  const convergence = await run({
    phase,
    identity: {
      story_id: selection.exact_binding.story_id,
      selected_role: selection.selected_role,
      selected_story_id:
        selection.exact_binding.story_id,
      scheduled_for:
        selection.exact_binding.scheduled_for,
      scheduled_event_id:
        selection.exact_binding.scheduled_event_id,
      external_id: externalId,
      dispatch_idempotency_key:
        selection.exact_binding
          .dispatch_idempotency_key,
      request_fingerprint:
        selection.exact_binding.request_fingerprint,
      promotion_sha256:
        selection.selected_role === "reserve"
          ? selection.promotion?.promotion_sha256
          : null,
      runway_lock_sha256:
        selection.exact_binding.runway_lock_sha256,
      media_sha256:
        selection.exact_binding.media_sha256,
      script_sha256:
        selection.exact_binding.script_sha256,
    },
    stateDir,
    startedAt: window.startedAt,
    cutoffAt: window.cutoffAt,
    retryIntervalMs: 60 * 1000,
    attemptTimeoutMs: 45 * 1000,
    maxAttempts: window.maxAttempts,
    now: clock,
    verifyReadOnly,
    classifyVerificationError: (error) =>
      governedYoutubeVerificationErrorOutcome({
        phase,
        error,
        externalId,
      }),
  });
  return {
    ...convergence,
    state_dir: stateDir,
    observation:
      convergence.terminal === true
        ? await readGovernedYoutubeConvergenceObservation(
            convergence,
            stateDir,
          )
        : null,
  };
}

function governedYoutubeConvergenceRetry(
  phase,
  convergence,
) {
  return {
    status: "held",
    verdict: "HOLD",
    terminal: false,
    job_outcome: "RETRY",
    retryable: true,
    retry_after_seconds: Math.max(
      1,
      Number(convergence.retry_after_seconds) || 60,
    ),
    blockers: [
      String(
        convergence.reason ||
          convergence.status ||
          "youtube_verification_retry_pending",
      ),
    ],
    verification_phase: phase,
    verification_convergence_status:
      convergence.status,
    verification_convergence_state_dir:
      convergence.state_dir || null,
    upload_attempted: false,
    external_posting: false,
    catch_up_allowed: false,
    retry_allowed: true,
  };
}

async function attemptGovernedYoutubeRemoteDisarm({
  ctx,
  exactBinding,
  now,
  reason,
  emergencyContainment = false,
  containmentReason = null,
}) {
  let service =
    ctx.disarmExactGovernedYoutubeScheduledRelease;
  if (typeof service !== "function") {
    try {
      service =
        require("../publisher")
          .disarmExactGovernedYoutubeScheduledRelease;
    } catch {
      service = null;
    }
  }
  if (typeof service !== "function") {
    return {
      attempted: false,
      confirmed: false,
      reason:
        "youtube_remote_schedule_disarm_adapter_not_armed",
    };
  }
  try {
    const result = await service({
      exactStagedBinding: exactBinding,
      channelId: exactBinding.channel_id,
      repos: ctx.repos,
      now: () => new Date(now),
      ownerId: ctx.workerId || null,
      reason,
      emergencyContainment:
        emergencyContainment === true,
      containmentReason:
        emergencyContainment === true
          ? containmentReason || reason
          : null,
      leaseMs: 90 * 1000,
      heartbeatIntervalMs: 20 * 1000,
    });
    return {
      attempted: true,
      confirmed:
        result?.disarmed === true ||
        result?.confirmed === true,
      reason:
        result?.reason ||
        (result?.disarmed === true
          ? "youtube_remote_schedule_disarmed"
          : "youtube_remote_schedule_disarm_unconfirmed"),
      result,
    };
  } catch (error) {
    return {
      attempted: true,
      confirmed: false,
      reason:
        error?.code ||
        error?.message ||
        "youtube_remote_schedule_disarm_failed",
    };
  }
}

async function attemptConfirmedDisarmReservePromotion({
  job,
  ctx,
  envelope,
  now,
}) {
  try {
    const resolveCanonicalPrimaryConfirmedDisarm =
      ctx.resolveCanonicalPrimaryConfirmedDisarm ||
      require(
        "./services/governed-youtube-reserve-promotion"
      ).resolveCanonicalPrimaryConfirmedDisarm;
    const canonical =
      resolveCanonicalPrimaryConfirmedDisarm(
        ctx.repos,
        envelope.lock,
      );
    if (canonical.eligible !== true) {
      return {
        attempted: true,
        promoted: false,
        blockers:
          canonical.blockers || [
            "runway_primary_confirmed_disarm_state_required",
          ],
      };
    }
    const {
      buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
    } = require(
      "./services/governed-youtube-release-runway"
    );
    const built =
      buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence(
        {
          now,
          lock: envelope.lock,
          primary_disarm:
            canonical.primary_disarm,
        },
      );
    if (built.verdict !== "GREEN") {
      return {
        attempted: true,
        promoted: false,
        blockers:
          built.blockers || [
            "runway_confirmed_disarm_promotion_not_authorised",
          ],
      };
    }
    const reserveAdmissionPath = path.join(
      envelope.window_dir,
      "reserve-admission.json",
    );
    if (!(await fs.pathExists(reserveAdmissionPath))) {
      return {
        attempted: true,
        promoted: false,
        blockers: [
          "runway_reserve_admission_artifact_required",
        ],
      };
    }
    const reserveAdmissionArtifact =
      await fs.readJson(reserveAdmissionPath);
    const promote =
      ctx.promoteGovernedYoutubeReserveRelease ||
      require(
        "./services/governed-youtube-reserve-promotion"
      ).promoteGovernedYoutubeReserveRelease;
    const runWithPublisherLease =
      ctx.runWithPublisherLease ||
      require("./services/publisher-lock")
        .runWithPublisherLease;
    const result = await runWithPublisherLease({
      leases: ctx.repos?.runtimeLeases,
      channelId:
        job.channel_id ||
        process.env.CHANNEL ||
        "pulse-gaming",
      operation:
        "promote_confirmed_disarm_youtube_reserve_release",
      ownerId:
        `${ctx.workerId || "governed-runway"}:` +
        "confirmed-disarm-reserve-promotion",
      leaseMs: 90 * 1000,
      heartbeatIntervalMs: 20 * 1000,
      metadata: {
        story_id: envelope.lock.primary.story_id,
        reserve_story_id:
          envelope.lock.reserve.story_id,
        scheduled_for: envelope.lock.scheduled_for,
        runway_lock_sha256:
          envelope.lock.lock_sha256,
        external_id:
          canonical.primary_disarm.external_id,
        disarm_event_sha256:
          canonical.primary_disarm
            .disarm_event_sha256,
        disarm_ledger_event_sha256:
          canonical.primary_disarm
            .disarm_ledger_event_sha256,
        platform_contacted: true,
        remote_schedule_disarmed: true,
        external_create_authority:
          "confirmed_disarm_failover_only",
      },
      task: async ({ assertHealthy }) => {
        assertHealthy();
        const promoted = await promote({
          repos: ctx.repos,
          lock: envelope.lock,
          primaryDisarm:
            canonical.primary_disarm,
          promotion: built.promotion,
          reserveAdmissionArtifact,
          env: ctx.env || process.env,
          now,
          channelId:
            job.channel_id ||
            process.env.CHANNEL ||
            "pulse-gaming",
          resolveMediaPath: ctx.resolveMediaPath,
          channel: ctx.channel || null,
        });
        assertHealthy();
        return promoted;
      },
    });
    return {
      attempted: true,
      promoted: result?.promoted === true,
      blockers:
        result?.promoted === true
          ? []
          : result?.blockers || [
              "runway_confirmed_disarm_reserve_promotion_held",
            ],
      result,
      primary_disarm:
        canonical.primary_disarm,
    };
  } catch (error) {
    return {
      attempted: true,
      promoted: false,
      blockers: [
        error?.code ||
          error?.message ||
          "runway_confirmed_disarm_reserve_promotion_failed",
      ],
    };
  }
}

async function handleGovernedYoutubeRunwayT60(job, ctx) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const timingHold =
    Number(job?.attempt_count || 1) <= 1
      ? await governedRunwayCheckpointTimingHold({
          job,
          payload,
          ctx,
          now,
        })
      : null;
  if (timingHold) return timingHold;
  const envelope = await governedReleaseEnvelope(payload, ctx);
  const selection = canonicalRunwaySelectedRelease(
    envelope,
    ctx,
  );
  const runtime = liveGuardedHandlerBlockers(
    {
      ...payload,
      platform: "youtube",
      readiness_verification_authority:
        payload.readiness_verification_authority,
    },
    ctx.env || process.env,
    "readiness_verification_authority",
  );
  const blockers = [
    ...envelope.blockers,
    ...selection.blockers,
    ...runtime.blockers,
  ];
  if (typeof ctx.assertLeaseHealthy !== "function") {
    blockers.push(
      "youtube_t60_lease_assertion_required",
    );
  }
  let freshControl = null;
  if (!runtime.blockers.length) {
    freshControl = await governedYoutubeFreshControl(
      ctx,
      payload,
      now,
      runtime.contract,
    );
    blockers.push(
      ...freshControlBlockers(
        freshControl,
        "youtube_t60",
        now,
      ),
    );
  }
  let verification = null;
  let verificationError = null;
  let convergence = null;
  let convergenceObservation = null;
  let verificationAlreadyFinalised = false;
  if (!blockers.length) {
    convergence =
      await runGovernedYoutubeVerificationConvergence({
        phase: "T-60",
        payload,
        selection,
        ctx,
      });
    if (convergence.terminal !== true) {
      return governedYoutubeConvergenceRetry(
        "T-60",
        convergence,
      );
    }
    convergenceObservation = convergence.observation;
    verification =
      convergenceObservation?.verifier_result || null;
    verificationAlreadyFinalised =
      convergenceObservation?.already_finalised === true;
    const convergenceError =
      convergenceObservation?.verification_error || null;
    if (convergenceError) {
      verificationError = {
        code: convergenceError.code,
        message: convergenceError.message,
        compensationRequired:
          convergenceError.compensation_required === true,
        compensationAttempted:
          convergenceError.compensation_attempted === true,
        compensationConfirmed:
          convergenceError.compensation_confirmed === true,
        remoteDisarmRequired:
          convergenceError.remote_disarm_required === true,
        remoteContainmentRequired:
          convergenceError.remote_containment_required === true,
      };
    }
    if (convergence.status !== "GREEN") {
      blockers.push(
        ...(convergence.final?.blockers || [
          convergence.final?.reason ||
            "youtube_t60_private_object_verification_failed",
        ]),
      );
    }
  }
  if (
    !blockers.length &&
    !verificationAlreadyFinalised
  ) {
    try {
      const service =
        ctx.verifyExactGovernedYoutubePrivatePrestage ||
        require("../publisher")
          .verifyExactGovernedYoutubePrivatePrestage;
      verification = await service({
        exactStagedBinding:
          selection.exact_binding,
        channelId:
          selection.exact_binding.channel_id,
        repos: ctx.repos,
        env: ctx.env || process.env,
        now: () => new Date(now),
        irreversibleBoundaryNow:
          ctx.irreversibleBoundaryNow ||
          (() => new Date()),
        ownerId: ctx.workerId || null,
        leaseMs: 90 * 1000,
        heartbeatIntervalMs: 20 * 1000,
        reportAuthTelemetry:
          ctx.reportYoutubeAuthTelemetry,
        createAuthenticatedYoutubeClient:
          ctx.createAuthenticatedYoutubeClient,
        createYoutubePrivateObjectVerifier:
          () => async () => verification,
        privateVerifierOptions: {
          maxAttempts: 1,
          pollIntervalMs: 0,
        },
        createYoutubeScheduledObjectDisarmer:
          ctx.createYoutubeScheduledObjectDisarmer,
        disarmerOptions:
          ctx.youtubeScheduledObjectDisarmerOptions,
        containUnexpectedObject:
          ctx.containUnexpectedYoutubeObject,
      });
      if (
        verification?.status !==
          "private_object_verified" ||
        verification?.scheduled !== false ||
        verification?.releaseArmed !== false ||
        verification?.releaseCommitmentConfirmed === true
      ) {
        blockers.push(
          verification?.reason ||
            "youtube_t60_private_unscheduled_not_confirmed",
        );
      }
    } catch (error) {
      verificationError = error;
      blockers.push(
        error?.code ||
          error?.message ||
          "youtube_t60_private_object_verification_failed",
      );
    }
  }
  const state =
    ctx.repos?.publicationGovernance?.getState?.(
      selection.exact_binding.story_id,
      "youtube",
    ) || null;
  const emergencyContainmentConfirmed =
    verificationError?.compensationConfirmed === true;
  const remoteDisarmRequired =
    Boolean(String(state?.external_id || "").trim()) &&
    !emergencyContainmentConfirmed &&
    (verificationError?.remoteDisarmRequired === true ||
      verificationError?.remoteContainmentRequired === true ||
      verification?.releaseArmed === true ||
      verification?.evidence?.release_armed === true ||
      verification?.verification?.evidence?.release_armed === true ||
      state?.lifecycle_state === "RECONCILIATION_REQUIRED");
  let disarm = null;
  if (remoteDisarmRequired) {
    disarm = await attemptGovernedYoutubeRemoteDisarm({
      ctx,
      exactBinding: selection.exact_binding,
      now,
      reason: "t60_unexpected_remote_release_authority",
    });
    if (disarm.confirmed !== true) {
      blockers.push(
        disarm.reason ||
          "youtube_t60_remote_disarm_unconfirmed",
      );
    }
  }
  const confirmedDisarmFailoverEligible =
    selection.selected_role === "primary" &&
    remoteDisarmRequired === true &&
    disarm?.confirmed === true &&
    convergence?.status === "HOLD";
  let reserveRecovery = null;
  if (confirmedDisarmFailoverEligible) {
    reserveRecovery =
      await attemptConfirmedDisarmReservePromotion({
        job,
        ctx,
        envelope,
        now,
      });
    if (reserveRecovery.promoted === true) {
      return {
        ...governedYoutubeConvergenceRetry("T-60", {
          status: "RESERVE_PROMOTED",
          reason:
            "runway_confirmed_disarm_reserve_prestage_pending",
          retry_after_seconds: 60,
          state_dir: convergence?.state_dir || null,
        }),
        selected_role: "reserve",
        selected_story_id:
          envelope.lock.reserve.story_id,
        confirmed_disarm_failover_eligible: true,
        reserve_recovery_attempted: true,
        reserve_promoted: true,
        reserve_promotion:
          reserveRecovery.result || null,
        remote_disarm_required: true,
        remote_disarm_attempted: true,
        remote_disarm_confirmed: true,
      };
    }
    blockers.push(
      ...(reserveRecovery.blockers || [
        "runway_confirmed_disarm_reserve_promotion_held",
      ]),
    );
  }
  const privateUnscheduledGreen =
    blockers.length === 0 &&
    state?.lifecycle_state ===
      "PLATFORM_OBJECT_CREATED" &&
    state?.verification_status ===
      "private_unscheduled_processed" &&
    Boolean(state?.external_id) &&
    String(state.external_id) ===
      String(
        verification?.externalId ||
          state.external_id,
      );
  if (
    blockers.length === 0 &&
    !privateUnscheduledGreen
  ) {
    blockers.push(
      "youtube_t60_private_unscheduled_state_not_durable",
    );
  }
  let controlledExperimentAssignment = null;
  if (blockers.length === 0 && privateUnscheduledGreen) {
    try {
      controlledExperimentAssignment =
        await assignRunwayControlledExperimentAtT60({
          selection,
          state,
          ctx,
        });
    } catch (error) {
      blockers.push(
        error?.code ||
          error?.message ||
          "controlled_experiment_t60_assignment_failed",
      );
    }
  }
  const green = blockers.length === 0;
  const written = await writeReleaseCheckpointEvidence({
    phase: "T-60",
    filename: "t60-readiness.json",
    payload,
    ctx,
    now,
    verdict: green ? "GREEN" : "HOLD",
    blockers,
    detail: {
      classification: green ? null : "HELD_POLICY",
      story_id: selection.exact_binding.story_id,
      scheduled_event_id:
        selection.exact_binding.scheduled_event_id,
      dispatch_idempotency_key:
        selection.exact_binding.dispatch_idempotency_key,
      request_fingerprint:
        selection.exact_binding.request_fingerprint,
      selected_role: selection.selected_role,
      selected_story_id:
        selection.exact_binding.story_id,
      promotion_sha256:
        selection.promotion?.promotion_sha256 || null,
      media_sha256:
        selection.exact_binding.media_sha256,
      script_sha256:
        selection.exact_binding.script_sha256,
      private_unscheduled_verified: green,
      upload_processed: green,
      publish_at_absent: green,
      remote_schedule_verified: false,
      release_armed: false,
      release_commitment_confirmed: false,
      commitment_frozen_at: null,
      external_id: state?.external_id || null,
      controlled_experiment_assignment:
        controlledExperimentAssignment,
      platform_state:
        state?.lifecycle_state || null,
      fresh_control: freshControl,
      remote_disarm_required: remoteDisarmRequired,
      remote_disarm_attempted:
        disarm?.attempted === true,
      remote_disarm_confirmed:
        disarm?.confirmed === true,
      emergency_containment_confirmed:
        emergencyContainmentConfirmed,
      confirmed_disarm_failover_eligible:
        confirmedDisarmFailoverEligible,
      reserve_recovery_attempted:
        reserveRecovery?.attempted === true,
      reserve_promoted: false,
      reserve_promotion:
        reserveRecovery?.result || null,
      upload_attempted: false,
      public_release_authority_active: false,
    },
  });
  return {
    status: green ? "ready" : "held",
    verdict: green ? "GREEN" : "HOLD",
    blockers: written.evidence.blockers,
    readiness_json: written.evidence_path,
    incident_json: written.incident_path,
    notification_sent: written.notification_sent,
    selected_role: selection.selected_role,
    selected_story_id:
      selection.exact_binding.story_id,
    controlled_experiment_assignment:
      controlledExperimentAssignment,
    private_unscheduled_verified: green,
    upload_processed: green,
    publish_at_absent: green,
    release_armed: false,
    release_commitment_confirmed: false,
    remote_schedule_verified: false,
    remote_disarm_required: remoteDisarmRequired,
    remote_disarm_attempted:
      disarm?.attempted === true,
    remote_disarm_confirmed:
      disarm?.confirmed === true,
    emergency_containment_confirmed:
      emergencyContainmentConfirmed,
    reserve_recovery_attempted:
      reserveRecovery?.attempted === true,
    reserve_promoted: false,
    upload_attempted: false,
    no_public_upload_at_t0: true,
    catch_up_allowed: false,
    retry_allowed: false,
  };
}

function canonicalGovernedYoutubePreCreateFailure({
  payload,
  ctx,
  lock,
} = {}) {
  const blockers = [];
  const storyId = String(payload?.story_id || "").trim();
  if (
    !lock ||
    storyId !== String(lock.primary?.story_id || "").trim()
  ) {
    blockers.push(
      "runway_primary_failure_story_binding_mismatch",
    );
  }
  const state =
    ctx.repos?.publicationGovernance?.getState?.(
      storyId,
      "youtube",
    ) || null;
  if (
    state?.lifecycle_state !==
      "DISPATCH_FAILED_BEFORE_CREATE" ||
    String(state?.external_id || "").trim()
  ) {
    blockers.push(
      "runway_primary_decisive_pre_create_state_required",
    );
  }
  let ledger = null;
  try {
    ledger = ctx.repos?.db
      ?.prepare(
        `SELECT *
         FROM platform_dispatch_ledger
         WHERE id = ?
           AND story_id = ?
           AND platform = 'youtube'
           AND event_type =
             'DISPATCH_FAILED_BEFORE_CREATE'
         LIMIT 1`,
      )
      .get(Number(state?.last_event_id), storyId);
  } catch {
    ledger = null;
  }
  const ledgerEvidence = parseRunwayEvidence(
    ledger?.verification_evidence_json,
  );
  if (
    !ledger ||
    Number(state?.last_event_id) !== Number(ledger.id) ||
    ledgerEvidence.platform_contacted !== false ||
    ledgerEvidence.create_attempt_started !== false ||
    ledgerEvidence.uncertain_external_creation !== false ||
    ledgerEvidence.external_id !== null
  ) {
    blockers.push(
      "runway_primary_failure_zero_contact_ledger_required",
    );
  }
  if (blockers.length) {
    return {
      eligible: false,
      blockers: [...new Set(blockers)],
      state,
      ledger,
      primary_failure: null,
    };
  }
  const failureBody = {
    classification: "DISPATCH_FAILED_BEFORE_CREATE",
    story_id: storyId,
    platform: "youtube",
    scheduled_for: payload.scheduled_for,
    runway_lock_sha256: payload.runway_lock_sha256,
    ledger_event_id: Number(ledger.id),
    ledger_idempotency_key: ledger.idempotency_key,
    platform_contacted: false,
    create_attempt_started: false,
    uncertain_external_creation: false,
    external_id: null,
  };
  const {
    canonicalSha256,
  } = require("./services/governed-youtube-release-runway");
  return {
    eligible: true,
    blockers: [],
    state,
    ledger,
    primary_failure: {
      ...failureBody,
      failure_event_sha256:
        canonicalSha256(failureBody),
    },
  };
}

function terminalGovernedYoutubePromotionBlocker(value) {
  const blocker = String(value || "").trim();
  return [
    "runway_reserve_promotion_deadline_expired",
    "runway_reserve_promotion_not_authorised",
    "runway_reserve_promotion_rebuild_mismatch",
    "runway_reserve_admission_artifact_required",
    "runway_reserve_admission_artifact_binding_mismatch",
    "runway_reserve_admission_packet_sha256_mismatch",
    "runway_reserve_admission_artifact_sha256_mismatch",
    "runway_reserve_admission_packet_identity_mismatch",
    "runway_primary_decisive_pre_create_state_required",
    "runway_primary_failure_zero_contact_ledger_required",
    "runway_primary_failure_story_binding_mismatch",
    "runway_primary_exact_release_chain_required",
  ].includes(blocker);
}

async function handlePrestageGovernedYoutubeRelease(job, ctx) {
  const payload = job?.payload || {};
  const t70AttemptFilename =
    "t70-prestage-attempt-" +
    crypto
      .createHash("sha256")
      .update(String(payload.story_id || "missing"))
      .digest("hex")
      .slice(0, 12) +
    ".json";
  const now = governedRunwayNow(payload, ctx);
  const rawRunAt = String(job?.run_at || "").trim();
  const runAt = Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
      rawRunAt,
    )
      ? `${rawRunAt.replace(" ", "T")}Z`
      : rawRunAt,
  );
  const scheduledAt = Date.parse(
    String(payload.scheduled_for || ""),
  );
  const lateBeyondNormalT70Window =
    Number.isFinite(runAt) &&
    now.getTime() > runAt + 60 * 1000;
  let envelope = null;
  let canonicalFailure = null;
  if (
    lateBeyondNormalT70Window &&
    Number.isFinite(scheduledAt) &&
    now.getTime() < scheduledAt - 60 * 60 * 1000
  ) {
    envelope = await governedReleaseEnvelope(payload, ctx);
    canonicalFailure =
      canonicalGovernedYoutubePreCreateFailure({
        payload,
        ctx,
        lock: envelope.lock,
      });
  }
  const recoveryPromotionOnly =
    lateBeyondNormalT70Window &&
    canonicalFailure?.eligible === true;
  const timingHold = recoveryPromotionOnly
    ? null
    : await governedRunwayCheckpointTimingHold({
        job,
        payload,
        ctx,
        now,
      });
  if (timingHold) return timingHold;
  envelope ||= await governedReleaseEnvelope(payload, ctx);
  const selection = canonicalRunwaySelectedRelease(
    envelope,
    ctx,
  );
  const runtime = liveGuardedHandlerBlockers(
    payload,
    ctx.env || process.env,
    "private_prestage_authority",
  );
  const blockers = [
    ...envelope.blockers,
    ...selection.blockers,
    ...runtime.blockers,
  ];
  if (
    String(payload.story_id || "").trim() !==
    selection.exact_binding.story_id
  ) {
    blockers.push(
      "youtube_t70_selected_release_identity_mismatch",
    );
  }
  if (typeof ctx.assertLeaseHealthy !== "function") {
    blockers.push(
      "youtube_private_prestage_lease_assertion_required",
    );
  }
  let freshControl = null;
  if (!runtime.blockers.length) {
    freshControl = await governedYoutubeFreshControl(
      ctx,
      payload,
      now,
      runtime.contract,
    );
    blockers.push(
      ...freshControlBlockers(
        freshControl,
        "youtube_t70",
        now,
      ),
    );
  }
  for (const [value, blocker] of [
    [
      payload.private_prestage_authority === true,
      "youtube_private_prestage_authority_required",
    ],
    [
      Number.isInteger(Number(payload.scheduled_event_id)) &&
        Number(payload.scheduled_event_id) > 0,
      "youtube_private_prestage_scheduled_event_required",
    ],
    [
      /^[a-f0-9]{64}$/.test(
        String(payload.request_fingerprint || "")
          .trim()
          .toLowerCase(),
      ),
      "youtube_private_prestage_request_fingerprint_required",
    ],
  ]) {
    if (!value) blockers.push(blocker);
  }
  if (blockers.length) {
    const written = await writeReleaseCheckpointEvidence({
      phase: "T-70",
      filename: t70AttemptFilename,
      payload,
      ctx,
      now,
      verdict: "HOLD",
      blockers,
      detail: {
        classification: "HELD_POLICY",
        story_id: selection.exact_binding.story_id,
        selected_role: selection.selected_role,
        selected_story_id:
          selection.exact_binding.story_id,
        scheduled_event_id:
          selection.exact_binding.scheduled_event_id,
        dispatch_idempotency_key:
          selection.exact_binding
            .dispatch_idempotency_key,
        request_fingerprint:
          selection.exact_binding.request_fingerprint,
        promotion_sha256:
          selection.promotion?.promotion_sha256 || null,
        media_sha256:
          selection.exact_binding.media_sha256,
        script_sha256:
          selection.exact_binding.script_sha256,
        private_only: true,
        platform_contacted: false,
        upload_attempted: false,
        private_unscheduled_object_created: false,
        release_armed: false,
        scheduled_release_authority_created: false,
        release_commitment_confirmed: false,
        final_release_commitment: false,
        fresh_control: freshControl,
      },
    });
    return {
      status: "held",
      verdict: "HOLD",
      blockers: written.evidence.blockers,
      readiness_json: written.evidence_path,
      incident_json: written.incident_path,
      notification_sent: written.notification_sent,
      upload_attempted: false,
      no_public_upload_at_t0: true,
      private_unscheduled_object_created: false,
      release_armed: false,
      scheduled_release_authority_created: false,
      release_commitment_confirmed: false,
      final_release_commitment: false,
      catch_up_allowed: false,
      retry_allowed: false,
    };
  }
  let uploadAttempted = false;
  let platformContacted = false;
  let failure = null;
  let result;
  let state = canonicalFailure?.state || null;
  if (recoveryPromotionOnly) {
    failure = Object.assign(
      new Error(
        "recovering_decisive_pre_create_failure",
      ),
      {
        code: "DISPATCH_FAILED_BEFORE_CREATE",
        createAttemptStarted: false,
        platformContacted: false,
        externalId: null,
      },
    );
    result = {
      status: "held",
      scheduled: false,
      reason: "recovering_decisive_pre_create_failure",
      externalId: null,
    };
  } else {
    try {
      const service =
        ctx.prestageExactGovernedYoutubeRelease ||
        require("../publisher")
          .prestageExactGovernedYoutubeRelease;
      uploadAttempted = true;
      result = await service({
        exactStagedBinding: {
          ...payload,
          ...selection.exact_binding,
        },
        channelId:
          selection.exact_binding.channel_id,
        repos: ctx.repos,
        now: () => new Date(now),
        ownerId: ctx.workerId || null,
        leaseMs: 90 * 1000,
        heartbeatIntervalMs: 20 * 1000,
        resolveMediaPath: ctx.resolveMediaPath,
        channel: ctx.channel || null,
        reportAuthTelemetry:
          ctx.reportYoutubeAuthTelemetry,
      });
      platformContacted =
        result?.platformContacted === true ||
        result?.platform_contacted === true ||
        Boolean(result?.externalId);
    } catch (error) {
      failure = error;
      platformContacted =
        error?.platformContacted === true ||
        error?.platform_contacted === true;
      result = {
        status: "held",
        scheduled: false,
        reason:
          error?.code ||
          error?.message ||
          "youtube_private_prestage_failed",
        externalId: error?.externalId || null,
      };
    }
  }
  state ||=
    ctx.repos?.publicationGovernance?.getState?.(
      payload.story_id,
      "youtube",
    ) || null;
  const resultExternalId = String(
    result?.externalId || "",
  ).trim();
  const durableExternalId = String(
    state?.external_id || "",
  ).trim();
  const privateUnscheduledObjectCreated =
    result?.status === "platform_object_created" &&
    result?.releaseState === "private_unscheduled" &&
    result?.scheduled === false &&
    result?.releaseArmed === false &&
    Boolean(resultExternalId) &&
    state?.lifecycle_state ===
      "PLATFORM_OBJECT_CREATED" &&
    durableExternalId === resultExternalId;
  const green = privateUnscheduledObjectCreated;
  const platformObjectExists =
    Boolean(
      result?.externalId ||
        state?.external_id,
    ) ||
    [
      "PLATFORM_OBJECT_CREATED",
      "PLATFORM_SCHEDULED",
    ].includes(state?.lifecycle_state);
  const processingPending =
    !green &&
    platformObjectExists &&
    [
      "PLATFORM_OBJECT_CREATED",
      "PLATFORM_SCHEDULED",
    ].includes(state?.lifecycle_state);
  let reservePromotion = null;
  if (
    !green &&
    !platformObjectExists &&
    state?.lifecycle_state ===
      "DISPATCH_FAILED_BEFORE_CREATE" &&
    platformContacted === false &&
    failure?.createAttemptStarted !== true &&
    !failure?.externalId
  ) {
    try {
      const decisiveFailure =
        canonicalFailure?.eligible === true
          ? canonicalFailure
          : canonicalGovernedYoutubePreCreateFailure({
              payload,
              ctx,
              lock: envelope.lock,
            });
      if (decisiveFailure.eligible !== true) {
        throw new Error(
          decisiveFailure.blockers?.[0] ||
            "runway_primary_failure_ledger_binding_required",
        );
      }
      const {
        buildGovernedYoutubeReservePromotionEvidence,
      } = require(
        "./services/governed-youtube-release-runway"
      );
      const primaryFailure =
        decisiveFailure.primary_failure;
      const built =
        buildGovernedYoutubeReservePromotionEvidence({
          now,
          lock: envelope.lock,
          primary_failure: primaryFailure,
        });
      if (built.verdict !== "GREEN") {
        throw new Error(
          built.blockers[0] ||
            "runway_reserve_promotion_not_authorised",
        );
      }
      const reserveAdmissionPath = path.join(
        envelope.window_dir,
        "reserve-admission.json",
      );
      if (!(await fs.pathExists(reserveAdmissionPath))) {
        throw new Error(
          "runway_reserve_admission_artifact_required",
        );
      }
      const reserveAdmissionArtifact =
        await fs.readJson(reserveAdmissionPath);
      const promote =
        ctx.promoteGovernedYoutubeReserveRelease ||
        require(
          "./services/governed-youtube-reserve-promotion"
        ).promoteGovernedYoutubeReserveRelease;
      const runWithPublisherLease =
        ctx.runWithPublisherLease ||
        require("./services/publisher-lock")
          .runWithPublisherLease;
      reservePromotion = await runWithPublisherLease({
        leases: ctx.repos?.runtimeLeases,
        channelId:
          job.channel_id ||
          process.env.CHANNEL ||
          "pulse-gaming",
        operation:
          "promote_governed_youtube_reserve_release",
        ownerId:
          `${ctx.workerId || "governed-runway"}:reserve-promotion`,
        leaseMs: 90 * 1000,
        heartbeatIntervalMs: 20 * 1000,
        metadata: {
          story_id: payload.story_id,
          scheduled_for: payload.scheduled_for,
          runway_lock_sha256:
            payload.runway_lock_sha256,
          platform_contacted: false,
          external_create_authority: "none",
        },
        task: async ({ assertHealthy }) => {
          assertHealthy();
          const promoted = await promote({
            repos: ctx.repos,
            lock: envelope.lock,
            primaryFailure,
            promotion: built.promotion,
            reserveAdmissionArtifact,
            env: ctx.env || process.env,
            now,
            channelId:
              job.channel_id ||
              process.env.CHANNEL ||
              "pulse-gaming",
            resolveMediaPath: ctx.resolveMediaPath,
            channel: ctx.channel || null,
          });
          assertHealthy();
          return promoted;
        },
      });
      if (reservePromotion.promoted !== true) {
        const promotionBlocker =
          reservePromotion.blockers?.[0] ||
          reservePromotion.top_reason ||
          (reservePromotion.publish_dispatch_blocked === true
            ? "durable_publish_lock_unavailable"
            : null) ||
          "runway_reserve_promotion_held";
        const error = new Error(promotionBlocker);
        error.code = promotionBlocker;
        throw error;
      }
      await atomicWriteRunwayJson(
        path.join(
          envelope.window_dir,
          "reserve-promotion.json",
        ),
        {
          schema_version:
            "pulse-governed-youtube-reserve-promotion-proof-v1",
          scheduled_for: envelope.lock.scheduled_for,
          runway_lock_sha256:
            envelope.lock.lock_sha256,
          promotion: built.promotion,
          promotion_audit_id:
            reservePromotion.promotion_audit_id,
          cancelled_primary_jobs:
            reservePromotion.cancelled_primary_jobs,
          reserve_release_jobs:
            reservePromotion.reserve_release_jobs,
        },
      );
    } catch (promotionError) {
      const promotionBlocker =
        promotionError?.code ||
        promotionError?.message ||
        "runway_reserve_promotion_failed";
      const beforeT60 =
        Number.isFinite(scheduledAt) &&
        now.getTime() <
          scheduledAt - 60 * 60 * 1000;
      const stillDecisive =
        canonicalGovernedYoutubePreCreateFailure({
          payload,
          ctx,
          lock: envelope.lock,
        }).eligible === true;
      if (
        beforeT60 &&
        stillDecisive &&
        !terminalGovernedYoutubePromotionBlocker(
          promotionBlocker,
        )
      ) {
        promotionError.code =
          promotionBlocker ||
          "runway_reserve_promotion_retry_required";
        promotionError.retryable = true;
        promotionError.no_reupload = true;
        throw promotionError;
      }
      reservePromotion = {
        promoted: false,
        blockers: [promotionBlocker],
      };
    }
  }
  const promoted =
    reservePromotion?.promoted === true;
  const checkpointVerdict = green
    ? "GREEN"
    : promoted
      ? "AMBER"
    : processingPending
      ? "AMBER"
      : "HOLD";
  const written = await writeReleaseCheckpointEvidence({
    phase: "T-70",
    filename: t70AttemptFilename,
    payload,
    ctx,
    now,
    verdict: checkpointVerdict,
    blockers: green || promoted
      ? []
      : [
          result?.reason ||
            "youtube_private_unscheduled_object_not_anchored",
        ],
    detail: {
      classification: green
        ? null
        : promoted
          ? "RESERVE_PROMOTED"
        : processingPending
          ? "PROCESSING_PENDING"
          : platformContacted
          ? "EXTERNAL_FAILURE"
          : state?.lifecycle_state ===
                "DISPATCH_FAILED_BEFORE_CREATE"
            ? "DISPATCH_FAILED_BEFORE_CREATE"
            : "MISSED_INTERNAL",
      story_id: selection.exact_binding.story_id,
      selected_role: selection.selected_role,
      selected_story_id:
        selection.exact_binding.story_id,
      scheduled_event_id:
        selection.exact_binding.scheduled_event_id,
      dispatch_idempotency_key:
        selection.exact_binding
          .dispatch_idempotency_key,
      request_fingerprint:
        selection.exact_binding.request_fingerprint,
      promotion_sha256:
        selection.promotion?.promotion_sha256 || null,
      media_sha256:
        selection.exact_binding.media_sha256,
      script_sha256:
        selection.exact_binding.script_sha256,
      private_only: true,
      platform_contacted: platformContacted,
      upload_attempted: uploadAttempted,
      create_attempt_started:
        failure?.createAttemptStarted === true,
      external_id:
        result?.externalId || state?.external_id || null,
      platform_state:
        result?.governanceState?.lifecycle_state ||
        state?.lifecycle_state ||
        null,
      private_unscheduled_object_created:
        privateUnscheduledObjectCreated,
      release_armed: false,
      scheduled_release_authority_created: false,
      release_commitment_confirmed: false,
      final_release_commitment: false,
      commitment_boundary: null,
      commitment_frozen_at: null,
      release_commitment: null,
      fresh_control: freshControl,
      recovery_promotion_only:
        recoveryPromotionOnly,
      reserve_promoted: promoted,
      reserve_promotion_audit_id:
        reservePromotion?.promotion_audit_id || null,
      reserve_promotion_blockers:
        reservePromotion?.blockers || [],
    },
    incidentRequired:
      checkpointVerdict === "HOLD",
  });
  return {
    status: green
      ? "platform_object_created"
      : promoted
        ? "reserve_promoted"
      : processingPending
        ? "processing_pending"
        : "held",
    verdict: checkpointVerdict,
    blockers: written.evidence.blockers,
    readiness_json: written.evidence_path,
    incident_json: written.incident_path,
    notification_sent: written.notification_sent,
    upload_attempted: uploadAttempted,
    platform_contacted: platformContacted,
    private_unscheduled_object_created:
      written.evidence
        .private_unscheduled_object_created === true,
    release_armed: false,
    scheduled_release_authority_created: false,
    release_commitment_confirmed: false,
    final_release_commitment: false,
    commitment_frozen_at: null,
    recovery_promotion_only:
      recoveryPromotionOnly,
    reserve_promoted: promoted,
    reserve_promotion:
      reservePromotion || null,
    no_public_upload_at_t0: true,
    catch_up_allowed: false,
    retry_allowed: false,
  };
}

async function handleVerifyGovernedYoutubeReleaseTminus15(
  job,
  ctx,
) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const timingHold =
    await governedRunwayCheckpointTimingHold({
      job,
      payload,
      ctx,
      now,
    });
  if (timingHold) return timingHold;
  const envelope = await governedReleaseEnvelope(payload, ctx);
  const selection = canonicalRunwaySelectedRelease(
    envelope,
    ctx,
  );
  const runtime = liveGuardedHandlerBlockers(
    {
      ...payload,
      platform: "youtube",
      scheduled_release_authority:
        payload.scheduled_release_authority,
    },
    ctx.env || process.env,
    "scheduled_release_authority",
  );
  const blockers = [
    ...envelope.blockers,
    ...selection.blockers,
    ...runtime.blockers,
  ];
  if (payload.arm_private_schedule_once !== true) {
    blockers.push(
      "youtube_tminus15_one_shot_schedule_arm_authority_required",
    );
  }
  if (
    payload.official_source_revalidation_required !== true
  ) {
    blockers.push(
      "youtube_tminus15_official_source_revalidation_authority_required",
    );
  }
  if (
    payload.scheduled_release_verification_authority !==
    true
  ) {
    blockers.push(
      "youtube_tminus15_scheduled_verification_authority_required",
    );
  }
  if (typeof ctx.assertLeaseHealthy !== "function") {
    blockers.push(
      "youtube_tminus15_lease_assertion_required",
    );
  }
  let freshControl = null;
  if (!runtime.blockers.length) {
    freshControl = await governedYoutubeFreshControl(
      ctx,
      payload,
      now,
      runtime.contract,
    );
    blockers.push(
      ...freshControlBlockers(
        freshControl,
        "youtube_tminus15",
        now,
      ),
    );
  }
  const preState =
    ctx.repos?.publicationGovernance?.getState?.(
      selection.exact_binding.story_id,
      "youtube",
    ) || null;
  const anchoredExternalId = String(
    preState?.external_id || "",
  ).trim();
  if (!anchoredExternalId) {
    blockers.push("youtube_tminus15_external_id_required");
  }
  let controlledExperimentVerification = null;
  if (!blockers.length) {
    try {
      controlledExperimentVerification =
        await verifyRunwayControlledExperimentAtT15({
          selection,
          externalId: anchoredExternalId,
          payload,
          ctx,
        });
    } catch (error) {
      blockers.push(
        error?.code ||
          error?.message ||
          "controlled_experiment_tminus15_verification_failed",
      );
    }
  }
  let activation = null;
  let activationError = null;
  let replayCommitment = null;
  let replayRemoteVerification = null;
  const readDurableArmAttempt = () => {
    const reader =
      ctx.repos?.publicationGovernance
        ?.getScheduledPlatformArmAttempt;
    if (
      typeof reader !== "function" ||
      !anchoredExternalId
    ) {
      return null;
    }
    return reader.call(ctx.repos.publicationGovernance, {
      storyId: selection.exact_binding.story_id,
      channelId: selection.exact_binding.channel_id,
      platform: "youtube",
      idempotencyKey:
        selection.exact_binding
          .dispatch_idempotency_key,
      externalId: anchoredExternalId,
      scheduledFor:
        selection.exact_binding.scheduled_for,
      requestFingerprint:
        selection.exact_binding.request_fingerprint,
      runwayLockSha256:
        selection.exact_binding.runway_lock_sha256,
      now,
    });
  };
  let durableArmAttempt = null;
  try {
    durableArmAttempt = readDurableArmAttempt();
  } catch (error) {
    blockers.push(
      error?.code ||
        error?.message ||
        "youtube_tminus15_arm_attempt_evidence_invalid",
    );
  }
  if (
    preState?.lifecycle_state === "PLATFORM_SCHEDULED" &&
    anchoredExternalId
  ) {
    try {
      const assertCommitment =
        ctx.repos?.publicationGovernance
          ?.assertScheduledPlatformReleaseCommitment;
      if (typeof assertCommitment !== "function") {
        throw new Error(
          "release_commitment_assertion_required",
        );
      }
      replayCommitment = assertCommitment.call(
        ctx.repos.publicationGovernance,
        {
          storyId: selection.exact_binding.story_id,
          channelId:
            selection.exact_binding.channel_id,
          platform: "youtube",
          idempotencyKey:
            selection.exact_binding
              .dispatch_idempotency_key,
          externalId: anchoredExternalId,
          scheduledFor:
            selection.exact_binding.scheduled_for,
          requestFingerprint:
            selection.exact_binding.request_fingerprint,
          runwayLockSha256:
            selection.exact_binding.runway_lock_sha256,
          now,
        },
      );
      const commitmentEvidence =
        replayCommitment?.evidence || {};
      const verifyScheduledReplay =
        ctx.verifyExactGovernedYoutubeScheduledReplay ||
        require(
          "./services/governed-youtube-scheduled-replay-verifier"
        ).verifyExactGovernedYoutubeScheduledReplay;
      replayRemoteVerification =
        await verifyScheduledReplay({
          exactStagedBinding:
            selection.exact_binding,
          externalId: anchoredExternalId,
          channelId:
            selection.exact_binding.channel_id,
          repos: ctx.repos,
          env: ctx.env || process.env,
          now: () => new Date(now),
          ownerId: ctx.workerId || null,
          leaseMs: 90 * 1000,
          heartbeatIntervalMs: 20 * 1000,
          reportAuthTelemetry:
            ctx.reportYoutubeAuthTelemetry,
          runWithPublisherLease:
            ctx.runWithPublisherLease,
          createFreshYoutubeAccountBoundSession:
            ctx.createFreshYoutubeAccountBoundSession,
          createYoutubeScheduledObjectVerifier:
            ctx.createYoutubeScheduledObjectVerifier,
          validateYouTubeAccountBindingProof:
            ctx.validateYouTubeAccountBindingProof,
          validatePublicationEvidence:
            ctx.validateScheduledPublicationEvidence,
          scheduledVerifierOptions:
            ctx.scheduledVerifierOptions,
        });
      if (
        replayRemoteVerification?.confirmed !== true ||
        replayRemoteVerification?.scheduled !== true ||
        replayRemoteVerification?.releaseArmed !== true ||
        replayRemoteVerification?.side_effects
          ?.read_only_network_contacted !== true ||
        replayRemoteVerification?.side_effects
          ?.database_mutated !== false ||
        replayRemoteVerification?.side_effects
          ?.external_mutation_attempted !== false ||
        replayRemoteVerification?.side_effects
          ?.upload_attempted !== false ||
        String(
          replayRemoteVerification.externalId || "",
        ).trim() !== anchoredExternalId
      ) {
        throw new Error(
          "youtube_tminus15_scheduled_replay_remote_verification_required",
        );
      }
      activation = {
        status: "platform_scheduled",
        scheduled: true,
        releaseArmed: true,
        releaseCommitmentConfirmed: true,
        commitmentFrozenAt:
          commitmentEvidence.committed_at || null,
        externalId: anchoredExternalId,
        sourceRevalidation:
          commitmentEvidence.source_revalidation,
        armResult: {
          confirmed: true,
          evidence:
            commitmentEvidence.schedule_arm_proof,
        },
        verification:
          replayRemoteVerification.verification,
        youtubeAccountBindingProof:
          replayRemoteVerification
            .youtubeAccountBindingProof,
        remoteReplayVerified: true,
        releaseCommitment: replayCommitment,
        reused: true,
      };
    } catch (error) {
      activationError = error;
      blockers.push(
        error?.code ||
          error?.message ||
          "youtube_tminus15_release_commitment_replay_invalid",
      );
    }
  } else if (
    preState?.lifecycle_state !==
      "PLATFORM_OBJECT_CREATED" ||
    preState?.verification_status !==
      "private_unscheduled_processed"
  ) {
    blockers.push(
      "youtube_tminus15_private_processed_unscheduled_state_required",
    );
  }
  if (
    durableArmAttempt &&
    preState?.lifecycle_state !== "PLATFORM_SCHEDULED"
  ) {
    blockers.push(
      "youtube_tminus15_orphaned_schedule_arm_requires_disarm",
    );
  }
  if (!blockers.length && !activation) {
    try {
      const service =
        ctx.armExactGovernedYoutubeScheduledRelease ||
        require("../publisher")
          .armExactGovernedYoutubeScheduledRelease;
      activation = await service({
        exactStagedBinding:
          selection.exact_binding,
        channelId:
          selection.exact_binding.channel_id,
        repos: ctx.repos,
        env: ctx.env || process.env,
        now: () => new Date(now),
        irreversibleBoundaryNow:
          ctx.irreversibleBoundaryNow ||
          (() => new Date()),
        ownerId: ctx.workerId || null,
        leaseMs: 90 * 1000,
        heartbeatIntervalMs: 20 * 1000,
        reportAuthTelemetry:
          ctx.reportYoutubeAuthTelemetry,
        createAuthenticatedYoutubeClient:
          ctx.createAuthenticatedYoutubeClient,
        createYoutubeScheduledObjectArmer:
          ctx.createYoutubeScheduledObjectArmer,
        createYoutubeScheduledObjectVerifier:
          ctx.createYoutubeScheduledObjectVerifier,
        revalidateOfficialSource:
          ctx.revalidateOfficialSource,
        fetchOfficialSource:
          ctx.fetchOfficialSource,
        validateOfficialSourceRevalidationReceipt:
          ctx.validateOfficialSourceRevalidationReceipt,
        officialSourceRevalidatorOptions:
          ctx.officialSourceRevalidatorOptions,
        assertLiveControlHealthy:
          ctx.assertLiveControlHealthy,
        runWithPublisherLease:
          ctx.runWithPublisherLease,
      });
      if (
        activation?.status !==
          "platform_scheduled" ||
        activation?.scheduled !== true ||
        activation?.releaseArmed !== true ||
        activation?.releaseCommitmentConfirmed !==
          true ||
        String(activation?.externalId || "").trim() !==
          anchoredExternalId ||
        activation?.sourceRevalidation
          ?.official_source !== true ||
        activation?.sourceRevalidation?.unchanged !== true ||
        activation?.sourceRevalidation?.claims_match !==
          true ||
        activation?.armResult?.evidence
          ?.schedule_arm_confirmed !== true ||
        activation?.armResult?.evidence?.release_armed !==
          true ||
        String(
          activation?.armResult?.evidence?.publish_at ||
            "",
        ).trim() !==
          selection.exact_binding.scheduled_for
      ) {
        blockers.push(
          activation?.reason ||
            (activation?.scheduled === true
              ? "youtube_tminus15_release_commitment_not_confirmed"
              : "youtube_tminus15_schedule_arm_not_confirmed"),
        );
      }
    } catch (error) {
      activationError = error;
      blockers.push(
        error?.code ||
          error?.message ||
          "youtube_tminus15_schedule_arm_failed",
      );
    }
  }
  const postState =
    ctx.repos?.publicationGovernance?.getState?.(
      selection.exact_binding.story_id,
      "youtube",
    ) || null;
  const exactScheduledState =
    postState?.lifecycle_state ===
      "PLATFORM_SCHEDULED" &&
    String(postState?.external_id || "").trim() ===
      anchoredExternalId;
  if (
    blockers.length === 0 &&
    !exactScheduledState
  ) {
    blockers.push(
      "youtube_tminus15_scheduled_state_not_durable",
    );
  }
  if (!durableArmAttempt) {
    try {
      durableArmAttempt = readDurableArmAttempt();
    } catch (error) {
      blockers.push(
        error?.code ||
          error?.message ||
          "youtube_tminus15_arm_attempt_evidence_invalid",
      );
    }
  }
  const remoteContainmentRequired =
    activationError?.compensationRequired === true ||
    activationError?.remoteContainmentRequired === true ||
    activation?.compensationRequired === true ||
    activation?.remoteContainmentRequired === true;
  const containmentReason =
    String(
      activationError?.compensationReason ||
        activationError?.containmentReason ||
        activation?.compensationReason ||
        activation?.containmentReason ||
        "",
    ).trim() || null;
  const scheduleMutationMayExist =
    activationError?.updateAttemptStarted === true ||
    activationError?.remoteDisarmRequired === true ||
    activationError?.platformContacted === true ||
    remoteContainmentRequired ||
    activation?.updateAttemptStarted === true ||
    activation?.remoteDisarmRequired === true ||
    activation?.releaseArmed === true ||
    Boolean(durableArmAttempt) ||
    (blockers.length > 0 &&
      postState?.lifecycle_state === "PLATFORM_SCHEDULED");
  let disarm = null;
  if (blockers.length && scheduleMutationMayExist) {
    disarm = await attemptGovernedYoutubeRemoteDisarm({
      ctx,
      exactBinding: selection.exact_binding,
      now,
      reason: "tminus15_schedule_arm_not_green",
      emergencyContainment:
        remoteContainmentRequired,
      containmentReason:
        containmentReason ||
        "youtube_private_object_unexpected_publish_at",
    });
    if (disarm.confirmed !== true) {
      blockers.push(
        disarm.reason ||
          "youtube_tminus15_remote_disarm_unconfirmed",
      );
    }
  }
  const green = blockers.length === 0;
  const checkpointDetail = {
    classification: green
      ? null
      : scheduleMutationMayExist
        ? "EXTERNAL_FAILURE"
        : "HELD_POLICY",
    private_only: true,
    story_id: selection.exact_binding.story_id,
    scheduled_event_id:
      selection.exact_binding.scheduled_event_id,
    dispatch_idempotency_key:
      selection.exact_binding
        .dispatch_idempotency_key,
    request_fingerprint:
      selection.exact_binding.request_fingerprint,
    selected_role: selection.selected_role,
    selected_story_id:
      selection.exact_binding.story_id,
    promotion_sha256:
      selection.promotion?.promotion_sha256 || null,
    media_sha256:
      selection.exact_binding.media_sha256,
    script_sha256:
      selection.exact_binding.script_sha256,
    official_source_revalidated:
      green &&
      activation?.sourceRevalidation
        ?.official_source === true &&
      activation?.sourceRevalidation?.unchanged === true &&
      activation?.sourceRevalidation?.claims_match === true,
    source_revision_sha256:
      activation?.sourceRevalidation
        ?.source_revision_sha256 || null,
    source_revalidated_at:
      activation?.sourceRevalidation?.revalidated_at ||
      null,
    schedule_arm_confirmed:
      green &&
      activation?.armResult?.evidence
        ?.schedule_arm_confirmed === true,
    release_armed:
      green && activation?.releaseArmed === true,
    remote_schedule_verified: green,
    release_commitment_reverified: green,
    scheduled_replay_remote_verified:
      activation?.remoteReplayVerified === true,
    youtube_account_binding_proof_sha256:
      activation?.youtubeAccountBindingProof
        ?.proof_sha256 || null,
    release_commitment_confirmed:
      activation?.releaseCommitmentConfirmed === true,
    commitment_boundary:
      "official_source_revalidated_then_publish_at_armed",
    commitment_frozen_at:
      activation?.commitmentFrozenAt || null,
    external_id:
      activation?.externalId ||
      postState?.external_id ||
      anchoredExternalId ||
      null,
    controlled_experiment_verification:
      controlledExperimentVerification,
    platform_state:
      postState?.lifecycle_state || null,
    verification_reason:
      activation?.reason ||
      activationError?.code ||
      activationError?.message ||
      null,
    fresh_control: freshControl,
    remote_disarm_required:
      blockers.length > 0 &&
      scheduleMutationMayExist,
    remote_containment_required:
      blockers.length > 0 &&
      remoteContainmentRequired,
    containment_reason: containmentReason,
    remote_disarm_attempted:
      disarm?.attempted === true,
    remote_disarm_confirmed:
      disarm?.confirmed === true,
  };
  const retryablePreconditionHold =
    !green &&
    !scheduleMutationMayExist &&
    blockers.includes(
      "controlled_experiment_t60_checkpoint_required",
    );
  const checkpointFilename = retryablePreconditionHold
    ? `tminus15-precondition-attempt-${crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            scheduled_for:
              selection.exact_binding.scheduled_for,
            runway_lock_sha256:
              selection.exact_binding.runway_lock_sha256,
            story_id:
              selection.exact_binding.story_id,
            blockers: [...new Set(blockers)].sort(),
          }),
        )
        .digest("hex")
        .slice(0, 12)}.json`
    : "tminus15-readiness.json";
  const written = await writeReleaseCheckpointEvidence({
    phase: "T-15",
    filename: checkpointFilename,
    payload,
    ctx,
    now,
    verdict: green ? "GREEN" : "HOLD",
    blockers,
    detail: checkpointDetail,
  });
  let replayVerificationJson = null;
  if (
    checkpointDetail
      .scheduled_replay_remote_verified === true
  ) {
    const replayWritten =
      await writeReleaseCheckpointEvidence({
        phase: "T-15",
        filename:
          "tminus15-scheduled-replay-readback.json",
        payload,
        ctx,
        now,
        verdict: "GREEN",
        blockers: [],
        detail: checkpointDetail,
        incidentRequired: false,
      });
    replayVerificationJson =
      replayWritten.evidence_path;
  }
  return {
    status: green ? "ready" : "held",
    verdict: green ? "GREEN" : "HOLD",
    blockers: written.evidence.blockers,
    readiness_json: written.evidence_path,
    replay_verification_json:
      replayVerificationJson,
    incident_json: written.incident_path,
    notification_sent: written.notification_sent,
    upload_attempted: false,
    selected_role: selection.selected_role,
    selected_story_id:
      selection.exact_binding.story_id,
    official_source_revalidated:
      written.evidence.official_source_revalidated,
    source_revision_sha256:
      written.evidence.source_revision_sha256,
    schedule_arm_confirmed:
      written.evidence.schedule_arm_confirmed,
    release_armed:
      written.evidence.release_armed,
    remote_schedule_verified:
      written.evidence.remote_schedule_verified,
    release_commitment_confirmed:
      written.evidence.release_commitment_confirmed,
    scheduled_replay_remote_verified:
      checkpointDetail
        .scheduled_replay_remote_verified,
    youtube_account_binding_proof_sha256:
      checkpointDetail
        .youtube_account_binding_proof_sha256,
    remote_disarm_required:
      written.evidence.remote_disarm_required,
    remote_containment_required:
      written.evidence.remote_containment_required,
    containment_reason:
      written.evidence.containment_reason,
    remote_disarm_attempted:
      written.evidence.remote_disarm_attempted,
    remote_disarm_confirmed:
      written.evidence.remote_disarm_confirmed,
    no_public_upload_at_t0: true,
    catch_up_allowed: false,
    retry_allowed: false,
  };
}

function heldYouTubeAnalyticsSnapshotFanout(error) {
  const blocker = String(
    error?.code ||
      error?.message ||
      error ||
      "youtube_analytics_snapshot_fanout_failed",
  ).trim();
  return {
    schema_version: "pulse-youtube-analytics-snapshot-fanout-v1",
    verdict: "HOLD",
    blockers: [blocker],
    jobs: [],
    side_effects: {
      analytics_api_contacted: false,
      database_jobs_enqueued: false,
      external_posting: false,
      oauth_mutated: false,
    },
  };
}

function notApplicableYouTubeAnalyticsSnapshotFanout(
  reason,
) {
  return {
    schema_version:
      "pulse-youtube-analytics-snapshot-fanout-v1",
    verdict: "NOT_APPLICABLE",
    blockers: [],
    reason: String(reason || "").trim(),
    jobs: [],
    side_effects: {
      analytics_api_contacted: false,
      database_jobs_enqueued: false,
      external_posting: false,
      oauth_mutated: false,
    },
  };
}

function enqueueConfirmedRunwayYouTubeAnalytics({
  job,
  payload,
  selection,
  result,
  ctx,
}) {
  try {
    const {
      EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    } = require("./services/youtube-account-binding-verifier");
    const {
      enqueueConfirmedYouTubeAnalyticsSnapshotJobs,
    } = require("./services/youtube-analytics-snapshot-jobs");
    const storyId = String(
      selection?.exact_binding?.story_id ||
        payload.story_id ||
        job?.story_id ||
        "",
    ).trim();
    const publicationState =
      ctx.repos?.publicationGovernance?.getState?.(
        storyId,
        "youtube",
      ) || null;
    const observation =
      runwayControlledExperimentObservation(selection);
    if (
      !observation &&
      String(selection?.selected?.lane_id || "").trim() ===
        "breaking_short"
    ) {
      return notApplicableYouTubeAnalyticsSnapshotFanout(
        "breaking_short_contract_is_not_in_controlled_matrix",
      );
    }
    if (!observation) {
      throw new Error(
        "controlled_experiment_observation_required",
      );
    }
    const {
      validateControlledExperimentObservation,
    } = require(
      "./services/controlled-experiment-observation"
    );
    const validatedObservation =
      validateControlledExperimentObservation(
        observation,
        runwayControlledExperimentExpectedEvidence(
          selection,
          observation,
        ),
      ).observation;
    if (
      validatedObservation.experiment.eligible !== true
    ) {
      return notApplicableYouTubeAnalyticsSnapshotFanout(
        validatedObservation.experiment
          .ineligibility_reason,
      );
    }
    return enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
      jobs: ctx.repos?.jobs,
      controlledExperiments:
        ctx.repos?.controlledExperiments,
      publication: {
        confirmed: true,
        experimentId:
          validatedObservation.experiment.experiment_id,
        channelId: String(
          selection?.exact_binding?.channel_id ||
            job?.channel_id ||
            payload.channel_id ||
            "pulse-gaming",
        ).trim(),
        youtubeChannelId:
          EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
        storyId,
        videoId: String(
          result?.externalId ||
            result?.external_id ||
            selection?.exact_binding?.external_id ||
            publicationState?.external_id ||
            "",
        ).trim(),
        publishedAt: payload.scheduled_for,
      },
    });
  } catch (error) {
    return heldYouTubeAnalyticsSnapshotFanout(error);
  }
}

async function handleVerifyGovernedYoutubeReleaseT0(job, ctx) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const timingHold =
    Number(job?.attempt_count || 1) <= 1
      ? await governedRunwayCheckpointTimingHold({
          job,
          payload,
          ctx,
          now,
        })
      : null;
  if (timingHold) return timingHold;
  const envelope = await governedReleaseEnvelope(payload, ctx);
  const selection = canonicalRunwaySelectedRelease(
    envelope,
    ctx,
  );
  const blockers = [
    ...envelope.blockers,
    ...selection.blockers,
  ];
  if (
    payload.public_release_verification_authority !== true
  ) {
    blockers.push(
      "youtube_t0_public_release_verification_authority_required",
    );
  }
  if (typeof ctx.assertLeaseHealthy !== "function") {
    blockers.push("youtube_t0_lease_assertion_required");
  }
  let result = null;
  let convergence = null;
  let convergenceObservation = null;
  let confirmationAlreadyFinalised = false;
  if (!blockers.length) {
    convergence =
      await runGovernedYoutubeVerificationConvergence({
        phase: "T0",
        payload,
        selection,
        ctx,
      });
    if (convergence.terminal !== true) {
      return governedYoutubeConvergenceRetry(
        "T0",
        convergence,
      );
    }
    convergenceObservation = convergence.observation;
    result =
      convergenceObservation?.verifier_result || null;
    confirmationAlreadyFinalised =
      convergenceObservation?.already_finalised === true;
    if (convergence.status !== "GREEN") {
      blockers.push(
        ...(convergence.final?.blockers || [
          convergence.final?.reason ||
            "youtube_t0_public_verification_failed",
        ]),
      );
    }
  }
  if (
    !blockers.length &&
    !confirmationAlreadyFinalised
  ) {
    try {
      const service =
        ctx.confirmExactGovernedYoutubeScheduledRelease ||
        require("../publisher")
          .confirmExactGovernedYoutubeScheduledRelease;
      result = await service({
        exactStagedBinding: {
          ...payload,
          ...selection.exact_binding,
        },
        channelId:
          selection.exact_binding.channel_id,
        repos: ctx.repos,
        now: () => new Date(now),
        ownerId: ctx.workerId || null,
        verifyPublic: async () => result,
      });
      if (result?.published !== true) {
        blockers.push(
          result?.reason ||
            "youtube_t0_public_release_not_confirmed",
        );
      }
    } catch (error) {
      blockers.push(
        error?.code ||
          error?.message ||
          "youtube_t0_public_verification_failed",
      );
    }
  }
  const green = blockers.length === 0;
  const analyticsSnapshotFanout = green
    ? enqueueConfirmedRunwayYouTubeAnalytics({
        job,
        payload,
        selection,
        result,
        ctx,
      })
    : heldYouTubeAnalyticsSnapshotFanout(
        "youtube_publication_not_confirmed",
      );
  const written = await writeReleaseCheckpointEvidence({
    phase: "T0",
    filename: "t0-dispatch-verification.json",
    payload,
    ctx,
    now,
    verdict: green ? "GREEN" : "HOLD",
    blockers,
    detail: {
      classification: green ? null : "EXTERNAL_FAILURE",
      public_verification_only: true,
      story_id: selection.exact_binding.story_id,
      selected_role: selection.selected_role,
      selected_story_id:
        selection.exact_binding.story_id,
      scheduled_event_id:
        selection.exact_binding.scheduled_event_id,
      dispatch_idempotency_key:
        selection.exact_binding
          .dispatch_idempotency_key,
      request_fingerprint:
        selection.exact_binding.request_fingerprint,
      promotion_sha256:
        selection.promotion?.promotion_sha256 || null,
      media_sha256:
        selection.exact_binding.media_sha256,
      script_sha256:
        selection.exact_binding.script_sha256,
      upload_attempted: false,
      public_release_confirmed: green,
      external_id: result?.externalId || null,
      external_url: result?.externalUrl || null,
      release_commitment_required: true,
      release_commitment_asserted: green,
      commitment_boundary:
        "remote_private_publish_at_verified",
      live_control_rechecked: false,
      kill_switch_revocable_at_t0: false,
      remote_disarm_required: false,
      remote_disarm_attempted: false,
      remote_disarm_confirmed: false,
      analytics_snapshot_fanout:
        analyticsSnapshotFanout,
    },
  });
  return {
    status: green ? "published" : "held",
    verdict: green ? "GREEN" : "HOLD",
    blockers: written.evidence.blockers,
    t0_evidence_json: written.evidence_path,
    incident_json: written.incident_path,
    notification_sent: written.notification_sent,
    upload_attempted: false,
    public_verification_only: true,
    release_commitment_asserted:
      written.evidence.release_commitment_asserted,
    live_control_rechecked: false,
    kill_switch_revocable_at_t0: false,
    remote_disarm_required: false,
    remote_disarm_attempted: false,
    remote_disarm_confirmed: false,
    analytics_snapshot_fanout:
      analyticsSnapshotFanout,
    no_public_upload_at_t0: true,
    catch_up_allowed: false,
    retry_allowed: false,
  };
}

async function handleGovernedYoutubeRunwayT90(job, ctx) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const timingHold =
    await governedRunwayCheckpointTimingHold({
      job,
      payload,
      ctx,
      now,
    });
  if (timingHold) return timingHold;
  const admissionJobs = governedRunwayAdmissionJobs(
    payload,
    ctx.repos,
  );
  const candidates = governedRunwayCandidates(
    payload,
    ctx.repos,
    admissionJobs,
    now,
  );
  const {
    buildGovernedYoutubeRunwayLock,
  } = require("./services/governed-youtube-release-runway");
  const evidence = buildGovernedYoutubeRunwayLock({
    now,
    publish_hour_utc: payload.publish_hour_utc,
    candidates,
    admission_jobs: admissionJobs,
  });
  let reserveAdmissionArtifact = null;
  if (evidence.verdict === "GREEN" && evidence.lock) {
    const reserveCandidate = candidates.find(
      (candidate) =>
        String(candidate.story_id || "").trim() ===
        String(
          evidence.lock.reserve?.story_id || "",
        ).trim(),
    );
    const reserveAdmission =
      reserveCandidate?.admission &&
      typeof reserveCandidate.admission === "object" &&
      !Array.isArray(reserveCandidate.admission)
        ? structuredClone(reserveCandidate.admission)
        : null;
    const reserveAdmissionSha256 = reserveAdmission
      ? evidence.lock.reserve?.stage ===
        "AUTONOMOUS_ELIGIBLE"
        ? require(
            "./services/governed-youtube-release-runway"
          ).canonicalSha256(reserveAdmission)
        : hashRunwayEvidence(reserveAdmission)
      : null;
    if (
      !reserveAdmission ||
      reserveAdmissionSha256 !==
        evidence.lock.reserve
          ?.admission_evidence_sha256
    ) {
      evidence.blockers = [
        ...new Set([
          ...(evidence.blockers || []),
          "runway_reserve_admission_packet_binding_required",
        ]),
      ];
      evidence.verdict = "HOLD";
      evidence.incident = {
        required: true,
        code: evidence.blockers[0],
      };
    } else {
      const artifactBody = {
        schema_version:
          "pulse-governed-youtube-reserve-admission-packet-v1",
        scheduled_for: evidence.lock.scheduled_for,
        runway_lock_sha256:
          evidence.lock.lock_sha256,
        story_id:
          evidence.lock.reserve.story_id,
        candidate_revision_sha256:
          evidence.lock.reserve
            .candidate_revision_sha256,
        admission_packet_sha256:
          reserveAdmissionSha256,
        admission: reserveAdmission,
      };
      reserveAdmissionArtifact = {
        ...artifactBody,
        artifact_sha256:
          hashRunwayEvidence(artifactBody),
      };
    }
  }
  let t60Job = null;
  if (
    evidence.verdict === "GREEN" &&
    evidence.lock?.reserve_failover?.verdict === "GREEN" &&
    evidence.lock?.reserve_failover?.promotion_authority ===
      true
  ) {
    try {
      const {
        buildGovernedYoutubeT60PrestageJob,
      } = require(
        "./services/governed-youtube-window-checkpoint-primer"
      );
      const request = buildGovernedYoutubeT60PrestageJob({
        lock: evidence.lock,
        channelId: job.channel_id || null,
      });
      if (
        !ctx.repos?.jobs ||
        typeof ctx.repos.jobs.enqueue !== "function"
      ) {
        throw new Error(
          "runway_t60_durable_jobs_repository_required",
        );
      }
      const queued = ctx.repos.jobs.enqueue(request);
      t60Job = {
        id: Number(queued.id),
        kind: request.kind,
        status: queued.status || "pending",
        run_at: request.run_at,
        idempotency_key: request.idempotency_key,
        story_id: request.story_id,
        runway_lock_sha256:
          evidence.lock.lock_sha256,
      };
    } catch (error) {
      evidence.blockers = [
        ...new Set([
          ...(evidence.blockers || []),
          error?.code ||
            error?.message ||
            "runway_t60_durable_enqueue_failed",
        ]),
      ];
      evidence.verdict = "HOLD";
      evidence.incident = {
        required: true,
        code: evidence.blockers[0],
      };
    }
  }
  const durableRoot = payload.out_dir
    ? path.resolve(payload.out_dir)
    : governedRunwayRoot(payload, ctx);
  const outDir = containedRunwayPath(
    durableRoot,
    payload.out_dir
      ? durableRoot
      : governedRunwayWindowDirectory({
          scheduledFor: evidence.scheduled_for,
          root: durableRoot,
        }),
  );
  await fs.ensureDir(outDir);
  let reserveAdmissionJson = null;
  if (reserveAdmissionArtifact) {
    reserveAdmissionJson = path.join(
      outDir,
      "reserve-admission.json",
    );
    await atomicWriteRunwayJson(
      reserveAdmissionJson,
      reserveAdmissionArtifact,
    );
  }
  const evidenceJson = path.join(outDir, "t90-evidence.json");
  const evidenceMarkdown = path.join(
    outDir,
    "t90-evidence.md",
  );
  await atomicWriteRunwayJson(evidenceJson, evidence);
  await atomicWriteRunwayText(
    evidenceMarkdown,
    renderGovernedRunwayMarkdown(evidence),
  );
  let lockJson = null;
  if (evidence.lock) {
    lockJson = path.join(outDir, "runway-lock.json");
    if (await fs.pathExists(lockJson)) {
      const existing = await fs.readJson(lockJson);
      if (
        existing.lock_sha256 !== evidence.lock.lock_sha256
      ) {
        throw new Error("runway_lock_immutable_conflict");
      }
    } else {
      await atomicWriteRunwayJson(lockJson, evidence.lock);
    }
  }
  const finalBlockers = [...new Set(evidence.blockers || [])];
  const finalVerdict =
    finalBlockers.length > 0 ? "HOLD" : evidence.verdict;
  let incidentJson = null;
  let notificationSent = false;
  if (evidence.incident?.required) {
    incidentJson = path.join(outDir, "incident-t90.json");
    const incident = {
      schema_version:
        "pulse-governed-youtube-runway-incident-v1",
      phase: "T-90",
      scheduled_for: evidence.scheduled_for,
      verdict: finalVerdict,
      classification: "HELD_POLICY",
      blockers: finalBlockers,
      runway_lock_sha256:
        evidence.lock?.lock_sha256 || null,
      publish_authority: false,
      catch_up_allowed: false,
      generated_at: evidence.generated_at,
    };
    await atomicWriteRunwayJson(incidentJson, incident);
    notificationSent = await notifyGovernedRunwayIncident(
      ctx,
      incident,
    );
  }
  return {
    status: finalVerdict === "GREEN" ? "ready" : "held",
    verdict: finalVerdict,
    blockers: finalBlockers,
    candidates: evidence.candidates,
    scheduled_for: evidence.scheduled_for,
    lock: evidence.lock,
    runway_lock_sha256:
      evidence.lock?.lock_sha256 || null,
    evidence_json: evidenceJson,
    evidence_markdown: evidenceMarkdown,
    lock_json: lockJson,
    reserve_admission_json: reserveAdmissionJson,
    incident_json: incidentJson,
    notification_sent: notificationSent,
    t60_job: t60Job,
    downstream_release_chain:
      "t70_t15_t0_created_atomically_by_t75_admission",
    no_external_posting: true,
    publish_authority_created: false,
    catch_up_allowed: false,
  };
}

function parseRunwayEvidence(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function canonicalGovernedYoutubePublicationObservation(
  storyId,
  repos,
) {
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") return null;
  try {
    const state = db
      .prepare(
        `SELECT *
         FROM platform_publication_state
         WHERE story_id = ?
           AND platform = 'youtube'
         LIMIT 1`,
      )
      .get(storyId);
    if (!state) return null;
    const publishedLedger = state.last_event_id
      ? db
          .prepare(
            `SELECT *
             FROM platform_dispatch_ledger
             WHERE id = ?
               AND story_id = ?
               AND platform = 'youtube'
             LIMIT 1`,
          )
          .get(state.last_event_id, storyId)
      : null;
    const externalId = String(
      state.external_id || "",
    ).trim();
    const identityLedger = externalId
      ? db
          .prepare(
            `SELECT *
             FROM platform_dispatch_ledger
             WHERE story_id = ?
               AND platform = 'youtube'
               AND external_id = ?
             ORDER BY id DESC
             LIMIT 1`,
          )
          .get(storyId, externalId)
      : null;
    const platformPost = db
      .prepare(
        `SELECT *
         FROM platform_posts
         WHERE story_id = ?
           AND platform = 'youtube'
           AND status = 'published'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(storyId);
    const story =
      typeof repos?.stories?.get === "function"
        ? repos.stories.get(storyId)
        : db
            .prepare(
              `SELECT *
               FROM stories
               WHERE id = ?
               LIMIT 1`,
            )
            .get(storyId);
    const publishedEvidence = parseRunwayEvidence(
      publishedLedger?.verification_evidence_json,
    );
    const exactIdentity =
      Boolean(externalId) &&
      String(publishedEvidence.external_id || "").trim() ===
        externalId &&
      String(identityLedger?.external_id || "").trim() ===
        externalId &&
      String(platformPost?.external_id || "").trim() ===
        externalId &&
      String(story?.youtube_post_id || "").trim() ===
        externalId;
    const canonicalConfirmed =
      state.lifecycle_state === "PUBLISHED" &&
      String(state.verification_status || "").toLowerCase() ===
        "confirmed" &&
      publishedLedger?.event_type === "PUBLISHED" &&
      String(
        publishedLedger.verification_status || "",
      ).toLowerCase() === "confirmed" &&
      String(platformPost?.status || "").toLowerCase() ===
        "published" &&
      String(story?.publish_status || "").toLowerCase() ===
        "published" &&
      exactIdentity;
    const externalUrl =
      String(
        state.external_url ||
          platformPost?.external_url ||
          story?.youtube_url ||
          "",
      ).trim() ||
      (externalId
        ? `https://www.youtube.com/watch?v=${externalId}`
        : null);
    const publishedAt =
      story?.youtube_published_at ||
      platformPost?.published_at ||
      state.verified_at ||
      story?.published_at ||
      null;
    return {
      story_id: storyId,
      platform: "youtube",
      verification_status: canonicalConfirmed
        ? "confirmed"
        : "unverified",
      external_id: externalId || null,
      external_url: externalUrl,
      published_at: publishedAt,
      platform_contacted:
        Boolean(identityLedger) || Boolean(platformPost),
      dispatch_attempted: Boolean(publishedLedger),
      held_policy: false,
      policy_blockers: [],
      canonical_confirmation: {
        state_published:
          state.lifecycle_state === "PUBLISHED",
        state_verification_confirmed:
          String(
            state.verification_status || "",
          ).toLowerCase() === "confirmed",
        published_ledger_confirmed:
          publishedLedger?.event_type === "PUBLISHED" &&
          String(
            publishedLedger.verification_status || "",
          ).toLowerCase() === "confirmed",
        platform_post_identity_exact:
          String(platformPost?.external_id || "").trim() ===
          externalId,
        story_projection_identity_exact:
          String(story?.youtube_post_id || "").trim() ===
          externalId,
        exact_identity: exactIdentity,
      },
    };
  } catch {
    return null;
  }
}

function emptyGovernedRunwayObservation(storyId) {
  return {
    story_id: String(storyId || "").trim(),
    platform: "youtube",
    verification_status: "unverified",
    external_id: null,
    external_url: null,
    published_at: null,
    platform_contacted: false,
    dispatch_attempted: false,
    held_policy: false,
    policy_blockers: [],
  };
}

function legacyGovernedRunwayObservation(
  payload,
  storyId,
) {
  const supplied = [
    ...(Array.isArray(payload?.observations)
      ? payload.observations
      : []),
    ...(payload?.observation &&
    typeof payload.observation === "object"
      ? [payload.observation]
      : []),
  ];
  return (
    supplied.find(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        String(item.story_id || "").trim() ===
          String(storyId || "").trim(),
    ) || null
  );
}

async function governedRunwayObservations(
  lock,
  payload,
  repos,
  ctx = {},
  selection = null,
) {
  const observations = [];
  for (const [role, storyId] of [
    ["primary", lock?.primary?.story_id],
    ["reserve", lock?.reserve?.story_id],
  ]) {
    let canonical =
      canonicalGovernedYoutubePublicationObservation(
        storyId,
        repos,
      );
    if (!canonical) {
      const story =
        storyId &&
        typeof repos?.stories?.get === "function"
          ? repos.stories.get(storyId)
          : null;
      if (
        story &&
        String(story.youtube_post_id || "").trim() &&
        String(story.publish_status || "").toLowerCase() ===
          "published"
      ) {
        const extra = parseStoryExtra(story);
        canonical = {
          story_id: storyId,
          platform: "youtube",
          verification_status: "unverified",
          external_id: String(
            story.youtube_post_id,
          ).trim(),
          external_url:
            story.youtube_url ||
            `https://www.youtube.com/watch?v=${String(
              story.youtube_post_id,
            ).trim()}`,
          published_at:
            story.published_at ||
            extra.youtube_published_at,
          platform_contacted:
            extra.youtube_platform_contacted === true,
          dispatch_attempted:
            extra.youtube_dispatch_attempted === true,
          held_policy:
            extra.youtube_held_policy === true,
          policy_blockers:
            extra.youtube_policy_blockers || [],
        };
      }
    }
    const observation =
      canonical ||
      emptyGovernedRunwayObservation(storyId);
    const legacy = legacyGovernedRunwayObservation(
      payload,
      storyId,
    );
    if (legacy) {
      observation.platform_contacted =
        observation.platform_contacted === true ||
        legacy.platform_contacted === true;
      observation.dispatch_attempted =
        observation.dispatch_attempted === true ||
        legacy.dispatch_attempted === true;
      observation.held_policy =
        observation.held_policy === true ||
        legacy.held_policy === true;
      observation.policy_blockers = [
        ...new Set([
          ...(Array.isArray(observation.policy_blockers)
            ? observation.policy_blockers
            : []),
          ...(Array.isArray(legacy.policy_blockers)
            ? legacy.policy_blockers
            : []),
        ]),
      ];
      if (
        !observation.external_id &&
        String(legacy.external_id || "").trim()
      ) {
        observation.external_id = String(
          legacy.external_id,
        ).trim();
        observation.external_url =
          String(legacy.external_url || "").trim() ||
          `https://www.youtube.com/watch?v=${observation.external_id}`;
        observation.published_at =
          legacy.published_at || null;
      }
      if (!canonical) {
        observation.verification_status = "unverified";
      }
    }
    if (
      observation.external_id &&
      typeof ctx.verifyYoutubePublication === "function"
    ) {
      const independent = await ctx.verifyYoutubePublication({
        story_id: storyId,
        storyId,
        platform: "youtube",
        externalId: observation.external_id,
        scheduledFor: lock?.scheduled_for,
        selectedRole: selection?.selected_role || null,
        observedRole: role,
      });
      observation.independent_verification =
        independent || null;
      const independentlyConfirmed =
        independent?.confirmed === true &&
        String(independent?.externalId || "").trim() ===
          observation.external_id;
      if (
        observation.verification_status === "confirmed" &&
        !independentlyConfirmed
      ) {
        observation.verification_status = "unverified";
      } else if (
        observation.verification_status !== "confirmed" &&
        independentlyConfirmed &&
        role !== selection?.selected_role
      ) {
        observation.verification_status = "confirmed";
        observation.external_url =
          String(
            independent.externalUrl ||
              independent.external_url ||
              observation.external_url ||
              "",
          ).trim() || null;
        observation.published_at =
          independent.publishedAt ||
          independent.published_at ||
          independent.verifiedAt ||
          observation.published_at;
        observation.remote_wrong_role_confirmation =
          true;
      }
    }
    observations.push({
      ...observation,
      story_id: String(storyId || "").trim(),
      platform: "youtube",
      observed_role: role,
    });
  }
  return observations;
}

async function handleGovernedYoutubeRunwayTplus15(job, ctx) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const timingHold =
    await governedRunwayCheckpointTimingHold({
      job,
      payload,
      ctx,
      now,
    });
  if (timingHold) return timingHold;
  const scheduledFor = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Number(payload.publish_hour_utc),
    ),
  ).toISOString();
  const durableRoot = payload.out_dir
    ? path.resolve(payload.out_dir)
    : governedRunwayRoot(payload, ctx);
  const outDir = containedRunwayPath(
    durableRoot,
    payload.out_dir
      ? durableRoot
      : governedRunwayWindowDirectory({
          scheduledFor,
          root: durableRoot,
        }),
  );
  const lockPath = path.join(outDir, "runway-lock.json");
  const lock =
    payload.lock && typeof payload.lock === "object"
      ? structuredClone(payload.lock)
      : (await fs.pathExists(lockPath))
        ? await fs.readJson(lockPath)
        : null;
  const {
    classifyGovernedYoutubeWindowOutcome,
  } = require("./services/governed-youtube-release-runway");
  const selection = canonicalRunwaySelectedRelease(
    {
      lock,
      window_dir: outDir,
    },
    ctx,
  );
  const observations = await governedRunwayObservations(
    lock,
    payload,
    ctx.repos,
    ctx,
    selection,
  );
  const evidence = classifyGovernedYoutubeWindowOutcome({
    now,
    lock,
    selected_release: {
      role: selection.selected_role,
      story_id: selection.exact_binding.story_id,
    },
    observations,
  });
  await fs.ensureDir(outDir);
  const outcomeJson = path.join(
    outDir,
    "tplus15-outcome.json",
  );
  const outcomeMarkdown = path.join(
    outDir,
    "tplus15-outcome.md",
  );
  await atomicWriteRunwayJson(outcomeJson, evidence);
  await atomicWriteRunwayText(
    outcomeMarkdown,
    renderGovernedRunwayMarkdown(evidence),
  );
  let incidentJson = null;
  let notificationSent = false;
  if (evidence.incident.required) {
    incidentJson = path.join(
      outDir,
      "incident-tplus15.json",
    );
    const incident = {
      ...evidence.incident,
      schema_version:
        "pulse-governed-youtube-runway-incident-v1",
      phase: "T+15",
      scheduled_for: evidence.scheduled_for,
      blockers: evidence.blockers,
      runway_lock_sha256: evidence.runway_lock_sha256,
      publish_authority: false,
      catch_up_allowed: false,
      generated_at: evidence.generated_at,
    };
    await atomicWriteRunwayJson(incidentJson, incident);
    notificationSent = await notifyGovernedRunwayIncident(
      ctx,
      incident,
    );
  }
  return {
    status: evidence.verdict === "GREEN" ? "hit" : "held",
    verdict: evidence.verdict,
    classification: evidence.classification,
    blockers: evidence.blockers,
    publication: evidence.publication,
    outcome_json: outcomeJson,
    outcome_markdown: outcomeMarkdown,
    incident_json: incidentJson,
    notification_sent: notificationSent,
    no_external_posting: true,
    publish_authority_created: false,
    catch_up_allowed: false,
    retry_allowed: false,
  };
}

async function handleGovernedYoutubeRunwaySloMonitor(job, ctx) {
  const payload = job?.payload || {};
  const now = governedRunwayNow(payload, ctx);
  const root = governedRunwayRoot(payload, ctx);
  const findings = [];
  const {
    validateLock,
  } = require("./services/governed-youtube-release-runway");
  const {
    youtubeReleaseJobIdempotencyKey,
  } = require("./services/governed-publication-job-identity");
  const jobByKey = (key) => {
    if (
      typeof ctx.repos?.jobs?.getByIdempotencyKey ===
      "function"
    ) {
      return ctx.repos.jobs.getByIdempotencyKey(key);
    }
    try {
      return ctx.repos?.db
        ?.prepare(
          "SELECT * FROM jobs WHERE idempotency_key = ?",
        )
        .get(key);
    } catch {
      return null;
    }
  };
  const readJsonArtifact = async (artifactPath) => {
    if (!(await fs.pathExists(artifactPath))) {
      return { exists: false, document: null };
    }
    try {
      return {
        exists: true,
        document: await fs.readJson(artifactPath),
      };
    } catch {
      return { exists: true, document: null };
    }
  };
  const exactCheckpointBinding = ({
    evidence,
    phase,
    scheduledFor,
    lock,
    selection,
  }) => {
    const exact = selection?.exact_binding;
    if (!evidence || !lock || !exact) return false;
    const promotionSha256 =
      String(
        selection?.promotion?.promotion_sha256 || "",
      )
        .trim()
        .toLowerCase() || null;
    return Boolean(
      evidence.phase === phase &&
        evidence.scheduled_for === scheduledFor &&
        evidence.runway_lock_sha256 === lock.lock_sha256 &&
        evidence.verdict === "GREEN" &&
        Array.isArray(evidence.blockers) &&
        evidence.blockers.length === 0 &&
        evidence.story_id === exact.story_id &&
        evidence.selected_story_id === exact.story_id &&
        evidence.selected_role ===
          selection.selected_role &&
        Number(evidence.scheduled_event_id) ===
          Number(exact.scheduled_event_id) &&
        String(evidence.external_id || "").trim() ===
          String(exact.external_id || "").trim() &&
        evidence.dispatch_idempotency_key ===
          exact.dispatch_idempotency_key &&
        String(evidence.request_fingerprint || "")
          .trim()
          .toLowerCase() === exact.request_fingerprint &&
        (String(evidence.promotion_sha256 || "")
          .trim()
          .toLowerCase() || null) === promotionSha256 &&
        String(evidence.media_sha256 || "")
          .trim()
          .toLowerCase() === exact.media_sha256 &&
        String(evidence.script_sha256 || "")
          .trim()
          .toLowerCase() === exact.script_sha256,
    );
  };
  const exactConvergenceStartedWithinSlo = async ({
    phase,
    scheduledFor,
    windowDir,
    selection,
  }) => {
    const exact = selection?.exact_binding;
    if (
      !exact ||
      !String(exact.external_id || "").trim()
    ) {
      return false;
    }
    const phaseWindow =
      governedYoutubeConvergenceWindow({
        phase,
        scheduledFor,
      });
    if (
      now.getTime() >= Date.parse(phaseWindow.cutoffAt)
    ) {
      return false;
    }
    const stateDir =
      governedYoutubeConvergenceStateDir({
        phase,
        payload: { out_dir: windowDir },
        selection,
        ctx,
      });
    if (
      await fs.pathExists(path.join(stateDir, "final.json"))
    ) {
      return false;
    }
    const started = (
      await readJsonArtifact(
        path.join(
          stateDir,
          "attempts",
          "attempt-000001.started.json",
        ),
      )
    ).document;
    if (
      !started ||
      started.schema_version !==
        "pulse-bounded-verification-convergence-attempt-started-v1" ||
      started.phase !== phase ||
      started.verification_only !== true ||
      !governedYoutubeConvergenceArtifactHashValid(started)
    ) {
      return false;
    }
    const startedAt = Date.parse(started.started_at);
    const expectedStartedAt = Date.parse(
      phaseWindow.startedAt,
    );
    if (
      !Number.isFinite(startedAt) ||
      startedAt < expectedStartedAt ||
      startedAt > expectedStartedAt + 60 * 1000
    ) {
      return false;
    }
    const identity = started.identity || {};
    const promotionSha256 =
      selection.selected_role === "reserve"
        ? String(
            selection.promotion?.promotion_sha256 || "",
          )
            .trim()
            .toLowerCase()
        : null;
    return Boolean(
      identity.story_id === exact.story_id &&
        identity.selected_story_id === exact.story_id &&
        identity.selected_role ===
          selection.selected_role &&
        identity.scheduled_for === scheduledFor &&
        Number(identity.scheduled_event_id) ===
          Number(exact.scheduled_event_id) &&
        identity.external_id === exact.external_id &&
        identity.dispatch_idempotency_key ===
          exact.dispatch_idempotency_key &&
        String(identity.request_fingerprint || "")
          .trim()
          .toLowerCase() === exact.request_fingerprint &&
        (String(identity.promotion_sha256 || "")
          .trim()
          .toLowerCase() || null) === promotionSha256 &&
        String(identity.runway_lock_sha256 || "")
          .trim()
          .toLowerCase() ===
          exact.runway_lock_sha256 &&
        String(identity.media_sha256 || "")
          .trim()
          .toLowerCase() === exact.media_sha256 &&
        String(identity.script_sha256 || "")
          .trim()
          .toLowerCase() === exact.script_sha256,
    );
  };
  const exactCommittedCurrentState = ({
    evidence,
    selection,
    lifecycleState,
    allowPublishedReplay = false,
  }) => {
    const governance =
      ctx.repos?.publicationGovernance;
    const exact = selection?.exact_binding;
    if (
      !governance ||
      !exact ||
      typeof governance.getState !== "function" ||
      typeof governance
        .assertScheduledPlatformReleaseCommitment !==
        "function"
    ) {
      return false;
    }
    const state = governance.getState(
      exact.story_id,
      "youtube",
    );
    const lifecycleMatches =
      state?.lifecycle_state === lifecycleState ||
      (allowPublishedReplay === true &&
        lifecycleState === "PLATFORM_SCHEDULED" &&
        state?.lifecycle_state === "PUBLISHED");
    if (
      !lifecycleMatches ||
      String(state?.external_id || "").trim() !==
        String(evidence?.external_id || "").trim()
    ) {
      return false;
    }
    try {
      governance.assertScheduledPlatformReleaseCommitment({
        storyId: exact.story_id,
        channelId: exact.channel_id,
        platform: "youtube",
        externalId: state.external_id,
        idempotencyKey:
          exact.dispatch_idempotency_key,
        scheduledFor: exact.scheduled_for,
        requestFingerprint:
          exact.request_fingerprint,
        runwayLockSha256:
          exact.runway_lock_sha256,
        now,
        allowPublishedReplay,
      });
      return true;
    } catch {
      return false;
    }
  };
  const findingBlocker = ({
    phase,
    scheduledFor,
    artifactExists,
  }) =>
    `runway_checkpoint_${
      artifactExists ? "not_green" : "missing"
    }:${phase}:${scheduledFor}`;
  const hasExactT70Checkpoint = async (
    windowDir,
    scheduledFor,
    lock,
    selection,
  ) => {
    if (!lock) return false;
    let entries = [];
    try {
      entries = await fs.readdir(windowDir);
    } catch {
      return false;
    }
    const candidates = entries.filter((entry) =>
      /^t70-prestage-attempt-[a-f0-9]{12}\.json$/.test(
        entry,
      ),
    );
    for (const entry of candidates) {
      try {
        const revocationPath = path.join(
          windowDir,
          entry.replace(
            /\.json$/i,
            ".revocation.json",
          ),
        );
        if (await fs.pathExists(revocationPath)) {
          continue;
        }
        const evidence = await fs.readJson(
          path.join(windowDir, entry),
        );
        if (
          exactCheckpointBinding({
            evidence,
            phase: "T-70",
            scheduledFor,
            lock,
            selection,
          }) &&
          evidence.private_unscheduled_object_created === true &&
          evidence.release_armed === false &&
          evidence.scheduled_release_authority_created === false &&
          evidence.release_commitment_confirmed === false &&
          Boolean(String(evidence.external_id || "").trim())
        ) {
          return true;
        }
      } catch {
        // A malformed checkpoint is not durable evidence.
      }
    }
    return false;
  };
  for (const hour of [9, 19]) {
    const scheduledAt = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        hour,
      ),
    );
    const windowDir = governedRunwayWindowDirectory({
      scheduledFor: scheduledAt,
      root,
    });
    const scheduledFor = scheduledAt.toISOString();
    const lockPath = path.join(
      windowDir,
      "runway-lock.json",
    );
    const lockArtifact = await readJsonArtifact(lockPath);
    const lock =
      lockArtifact.document &&
      validateLock(lockArtifact.document).length === 0 &&
      lockArtifact.document.scheduled_for === scheduledFor &&
      lockArtifact.document.window_id ===
        `youtube:${scheduledFor}`
        ? lockArtifact.document
        : null;
    const selection = lock
      ? canonicalRunwaySelectedRelease(
          {
            lock,
            window_dir: windowDir,
          },
          ctx,
        )
      : null;
    const t90Due =
      scheduledAt.getTime() - 90 * 60 * 1000 + 5 * 60 * 1000;
    const t75Due =
      scheduledAt.getTime() - 75 * 60 * 1000 + 60 * 1000;
    const t70Due =
      scheduledAt.getTime() - 70 * 60 * 1000 + 60 * 1000;
    const t60Due =
      scheduledAt.getTime() - 60 * 60 * 1000 + 60 * 1000;
    const tminus15Due =
      scheduledAt.getTime() - 15 * 60 * 1000 + 60 * 1000;
    const t0Due = scheduledAt.getTime() + 60 * 1000;
    const tplus15Due =
      scheduledAt.getTime() + 15 * 60 * 1000 + 5 * 60 * 1000;
    const monitorHorizon =
      scheduledAt.getTime() + 60 * 60 * 1000;
    if (
      now.getTime() >= t90Due &&
      now.getTime() <= monitorHorizon
    ) {
      const t90EvidencePath = path.join(
        windowDir,
        "t90-evidence.json",
      );
      const t90Artifact =
        await readJsonArtifact(t90EvidencePath);
      const t90Evidence = t90Artifact.document;
      const t90Green =
        Boolean(lock) &&
        t90Evidence?.phase === "T-90" &&
        t90Evidence.scheduled_for === scheduledFor &&
        t90Evidence.window_id === `youtube:${scheduledFor}` &&
        t90Evidence.verdict === "GREEN" &&
        Array.isArray(t90Evidence.blockers) &&
        t90Evidence.blockers.length === 0 &&
        t90Evidence.lock?.lock_sha256 ===
          lock.lock_sha256 &&
        validateLock(t90Evidence.lock).length === 0;
      if (!t90Green) {
        findings.push({
          phase: "T-90",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T-90",
            scheduledFor,
            artifactExists:
              t90Artifact.exists || lockArtifact.exists,
          }),
        });
      }
    }
    if (
      now.getTime() >= t75Due &&
      now.getTime() <= monitorHorizon
    ) {
      let admissionComplete = false;
      if (lock) {
        try {
          const admissionJob = jobByKey(
            lock.primary_admission_job?.idempotency_key,
          );
          admissionComplete =
            admissionJob?.kind ===
              "admit_governed_publication" &&
            Number(admissionJob.id) ===
              Number(
                lock.primary_admission_job?.job_id,
              ) &&
            String(admissionJob.story_id || "") ===
              String(lock.primary?.story_id || "") &&
            String(admissionJob.idempotency_key || "") ===
              String(
                lock.primary_admission_job
                  ?.idempotency_key || "",
              ) &&
            String(admissionJob.status || "").toLowerCase() ===
              "done";
        } catch {
          admissionComplete = false;
        }
      }
      if (!admissionComplete) {
        findings.push({
          phase: "T-75",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T-75",
            scheduledFor,
            artifactExists:
              Boolean(lock) &&
              Boolean(
                jobByKey(
                  lock.primary_admission_job
                    ?.idempotency_key,
                ),
              ),
          }),
        });
      }
    }
    if (
      now.getTime() >= t70Due &&
      now.getTime() <= monitorHorizon
    ) {
      let t70ArtifactExists = false;
      try {
        t70ArtifactExists = (
          await fs.readdir(windowDir)
        ).some((entry) =>
          /^t70-prestage-attempt-[a-f0-9]{12}\.json$/.test(
            entry,
          ),
        );
      } catch {
        t70ArtifactExists = false;
      }
      if (
        !(await hasExactT70Checkpoint(
          windowDir,
          scheduledFor,
          lock,
          selection,
        ))
      ) {
        findings.push({
          phase: "T-70",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T-70",
            scheduledFor,
            artifactExists: t70ArtifactExists,
          }),
        });
      }
    }
    if (
      now.getTime() >= t60Due &&
      now.getTime() <= monitorHorizon
    ) {
      const t60Artifact = await readJsonArtifact(
        path.join(windowDir, "t60-readiness.json"),
      );
      const t60Revocation =
        await readJsonArtifact(
          path.join(
            windowDir,
            "t60-readiness.revocation.json",
          ),
        );
      const t60 = t60Artifact.document;
      const t60Green =
        Boolean(lock) &&
        !t60Revocation.exists &&
        exactCheckpointBinding({
          evidence: t60,
          phase: "T-60",
          scheduledFor,
          lock,
          selection,
        }) &&
        t60.private_unscheduled_verified === true &&
        t60.upload_processed === true &&
        t60.publish_at_absent === true &&
        t60.release_armed === false &&
        t60.release_commitment_confirmed === false &&
        t60.remote_disarm_confirmed === false &&
        Boolean(String(t60.external_id || "").trim());
      const t60ConvergenceInProgress =
        !t60Green &&
        !t60Artifact.exists &&
        Boolean(lock) &&
        (await exactConvergenceStartedWithinSlo({
          phase: "T-60",
          scheduledFor,
          windowDir,
          selection,
        }));
      if (!t60Green && !t60ConvergenceInProgress) {
        findings.push({
          phase: "T-60",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T-60",
            scheduledFor,
            artifactExists: t60Artifact.exists,
          }),
        });
      }
    }
    if (
      now.getTime() >= tminus15Due &&
      now.getTime() <= monitorHorizon
    ) {
      const readinessPath = path.join(
        windowDir,
        "tminus15-readiness.json",
      );
      const tminus15Artifact =
        await readJsonArtifact(readinessPath);
      const tminus15Revocation =
        await readJsonArtifact(
          path.join(
            windowDir,
            "tminus15-readiness.revocation.json",
          ),
        );
      const tminus15 = tminus15Artifact.document;
      const tminus15Green =
        Boolean(lock) &&
        !tminus15Revocation.exists &&
        exactCheckpointBinding({
          evidence: tminus15,
          phase: "T-15",
          scheduledFor,
          lock,
          selection,
        }) &&
        tminus15.official_source_revalidated === true &&
        tminus15.schedule_arm_confirmed === true &&
        tminus15.release_armed === true &&
        tminus15.remote_schedule_verified === true &&
        tminus15.release_commitment_confirmed === true &&
        tminus15.remote_disarm_confirmed === false &&
        Boolean(
          String(tminus15.external_id || "").trim(),
        ) &&
        exactCommittedCurrentState({
          evidence: tminus15,
          selection,
          lifecycleState: "PLATFORM_SCHEDULED",
          allowPublishedReplay: true,
        });
      if (!tminus15Green) {
        findings.push({
          phase: "T-15",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T-15",
            scheduledFor,
            artifactExists: tminus15Artifact.exists,
          }),
        });
      }
    }
    if (
      now.getTime() >= t0Due &&
      now.getTime() <= monitorHorizon
    ) {
      const t0EvidencePath = path.join(
        windowDir,
        "t0-dispatch-verification.json",
      );
      const t0Artifact =
        await readJsonArtifact(t0EvidencePath);
      const t0Revocation =
        await readJsonArtifact(
          path.join(
            windowDir,
            "t0-dispatch-verification.revocation.json",
          ),
        );
      let t0Satisfied = false;
      if (
        lock &&
        t0Artifact.document &&
        !t0Revocation.exists
      ) {
        try {
          const t0Evidence = t0Artifact.document;
          const verifierKey =
            youtubeReleaseJobIdempotencyKey({
              phase: "T0",
              scheduledEventId:
                t0Evidence.scheduled_event_id,
              requestFingerprint:
                t0Evidence.request_fingerprint,
            });
          const verifierJob = jobByKey(verifierKey);
          t0Satisfied =
            exactCheckpointBinding({
              evidence: t0Evidence,
              phase: "T0",
              scheduledFor,
              lock,
              selection,
            }) &&
            t0Evidence.public_release_confirmed === true &&
            t0Evidence.release_commitment_asserted === true &&
            t0Evidence.upload_attempted === false &&
            Boolean(
              String(t0Evidence.external_id || "").trim(),
            ) &&
            verifierJob?.kind ===
              "verify_governed_youtube_release_t0" &&
            verifierJob?.idempotency_key === verifierKey &&
            ["claimed", "running", "done"].includes(
              String(verifierJob?.status || "").toLowerCase(),
            ) &&
            exactCommittedCurrentState({
              evidence: t0Evidence,
              selection,
              lifecycleState: "PUBLISHED",
              allowPublishedReplay: true,
            });
        } catch {
          t0Satisfied = false;
        }
      }
      const t0ConvergenceInProgress =
        !t0Satisfied &&
        !t0Artifact.exists &&
        Boolean(lock) &&
        (await exactConvergenceStartedWithinSlo({
          phase: "T0",
          scheduledFor,
          windowDir,
          selection,
        }));
      if (!t0Satisfied && !t0ConvergenceInProgress) {
        findings.push({
          phase: "T0",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T0",
            scheduledFor,
            artifactExists: t0Artifact.exists,
          }),
        });
      }
    }
    if (
      now.getTime() >= tplus15Due &&
      now.getTime() <= monitorHorizon
    ) {
      const tplus15Artifact = await readJsonArtifact(
        path.join(windowDir, "tplus15-outcome.json"),
      );
      const outcome = tplus15Artifact.document;
      const publication = outcome?.publication;
      const externalId = String(
        publication?.external_id || "",
      ).trim();
      const lockedStoryIds = [
        String(lock?.primary?.story_id || "").trim(),
        String(lock?.reserve?.story_id || "").trim(),
      ];
      const hasExactLockedStoryScope = (storyIds) => {
        if (
          !Array.isArray(storyIds) ||
          storyIds.length !== lockedStoryIds.length
        ) {
          return false;
        }
        const normalised = storyIds.map((storyId) =>
          String(storyId || "").trim(),
        );
        return (
          normalised.every(Boolean) &&
          new Set(normalised).size ===
            lockedStoryIds.length &&
          lockedStoryIds.every((storyId) =>
            normalised.includes(storyId),
          )
        );
      };
      const observationScope =
        outcome?.locked_publication_observation_scope;
      const tplus15Green =
        Boolean(lock) &&
        Boolean(selection?.selected_role) &&
        Boolean(selection?.exact_binding?.story_id) &&
        Array.isArray(selection?.blockers) &&
        selection.blockers.length === 0 &&
        outcome?.phase === "T+15" &&
        outcome.scheduled_for === scheduledFor &&
        outcome.runway_lock_sha256 === lock.lock_sha256 &&
        outcome.verdict === "GREEN" &&
        outcome.classification === "HIT" &&
        Array.isArray(outcome.blockers) &&
        outcome.blockers.length === 0 &&
        outcome?.selected_release?.role ===
          selection.selected_role &&
        outcome?.selected_release?.story_id ===
          selection.exact_binding.story_id &&
        publication?.story_id ===
          selection.exact_binding.story_id &&
        outcome.selected_publication_identity_count === 1 &&
        observationScope?.complete === true &&
        hasExactLockedStoryScope(
          observationScope.required_story_ids,
        ) &&
        hasExactLockedStoryScope(
          observationScope.observed_story_ids,
        ) &&
        publication?.verification_status === "confirmed" &&
        Boolean(externalId) &&
        String(publication?.external_url || "").includes(
          externalId,
        ) &&
        Number.isFinite(
          Date.parse(publication?.published_at),
        );
      if (!tplus15Green) {
        findings.push({
          phase: "T+15",
          scheduled_for: scheduledFor,
          window_dir: windowDir,
          blocker: findingBlocker({
            phase: "T+15",
            scheduledFor,
            artifactExists: tplus15Artifact.exists,
          }),
        });
      }
    }
  }
  if (!findings.length) {
    return {
      status: "healthy",
      classification: null,
      missing_phases: [],
      notification_sent: false,
      publish_authority_created: false,
      catch_up_allowed: false,
    };
  }
  const incidentPaths = [];
  let notificationsSent = 0;
  for (const finding of findings) {
    await fs.ensureDir(finding.window_dir);
    const phaseSlug = finding.phase
      .toLowerCase()
      .replace("+", "plus")
      .replace("-", "minus");
    const incidentJson = path.join(
      finding.window_dir,
      `incident-slo-${phaseSlug}.json`,
    );
    const alreadyExists = await fs.pathExists(incidentJson);
    const incident = {
      schema_version:
        "pulse-governed-youtube-runway-incident-v1",
      phase: finding.phase,
      scheduled_for: finding.scheduled_for,
      classification: "MISSED_INTERNAL",
      verdict: "HOLD",
      blockers: [finding.blocker],
      generated_at: now.toISOString(),
      publish_authority: false,
      catch_up_allowed: false,
    };
    if (!alreadyExists) {
      await atomicWriteRunwayJson(incidentJson, incident);
      await notifyGovernedRunwayIncident(ctx, incident);
      notificationsSent += 1;
    }
    incidentPaths.push(incidentJson);
  }
  const missingPhases = [
    ...new Set(findings.map((entry) => entry.phase)),
  ];
  return {
    status: "held",
    classification: "MISSED_INTERNAL",
    missing_phases: missingPhases,
    blockers: findings.map((entry) => entry.blocker),
    incident_json: incidentPaths[0],
    incident_jsons: incidentPaths,
    notification_sent: notificationsSent > 0,
    notifications_sent: notificationsSent,
    publish_authority_created: false,
    catch_up_allowed: false,
  };
}

async function handleGovernedMultiLanePlan(job, ctx) {
  const payload = job?.payload || {};
  const {
    buildGovernedMultiLanePlan,
  } = require("./services/governed-multi-lane-plan");
  const {
    resolveOperatingContract,
  } = require("./stabilisation/operating-contract");
  ctx.assertLeaseHealthy?.();
  const runtimeEnv = ctx.env || process.env;
  const contract = resolveOperatingContract({ env: runtimeEnv });
  const now =
    payload.now || new Date().toISOString();
  let boundCandidates = bindUrgentBreakingEvidence(
    Array.isArray(payload.candidates)
      ? payload.candidates
      : collectMultiLaneCandidates(ctx.repos, {
          urgentStoryId: payload.breaking_story_id,
        }),
    payload,
  );
  let candidateHydration = null;
  if (ctx.prevalidatedMultiLaneCandidates !== true) {
    const hydrateGovernedEditorialInventoryCandidates =
      ctx.hydrateGovernedEditorialInventoryCandidates ||
      require(
        "./services/governed-editorial-inventory-candidate-hydrator"
      ).hydrateGovernedEditorialInventoryCandidates;
    const outputRoot = path.join(__dirname, "..", "output");
    try {
      const hydration =
        await hydrateGovernedEditorialInventoryCandidates({
          candidates: boundCandidates,
          inventoryRoot:
            ctx.governedEditorialInventoryRoot ||
            path.join(outputRoot, "editorial-inventory"),
          allowedRoots:
            ctx.governedEditorialInventoryAllowedRoots ||
            [outputRoot],
          maximumManifests:
            payload.inventory_maximum_manifests,
        });
      boundCandidates = hydration.candidates;
      const {
        candidates: _hydratedCandidates,
        ...hydrationEvidence
      } = hydration;
      candidateHydration = hydrationEvidence;
    } catch (error) {
      const rejectedBreakingCandidates =
        boundCandidates.filter(
          (candidate) =>
            candidate?.lane_id === "breaking_short",
        );
      boundCandidates = boundCandidates.filter(
        (candidate) =>
          candidate?.lane_id !== "breaking_short",
      );
      candidateHydration = {
        schema_version:
          "pulse-governed-editorial-inventory-candidate-hydration-v1",
        generated_at: new Date(now).toISOString(),
        verdict: "HOLD",
        hydrated: [],
        rejected: rejectedBreakingCandidates.map((candidate) => ({
          story_id: candidate.story_id || null,
          blockers: [
            "governed_editorial_inventory_hydration_failed",
          ],
        })),
        failure_code:
          /^[A-Z][A-Z0-9_]{2,79}$/.test(
            String(error?.code || ""),
          )
            ? String(error.code)
            : "GOVERNED_EDITORIAL_INVENTORY_HYDRATION_FAILED",
        safety: {
          read_only: true,
          network_used: false,
          database_mutated: false,
          oauth_mutated: false,
          platform_contacted: false,
          publish_authority_created: false,
        },
      };
    }
  }
  const candidateEligibility =
    ctx.prevalidatedMultiLaneCandidates === true
      ? {
          schema_version:
            "pulse-prevalidated-multi-lane-candidate-test-seam-v1",
          generated_at: new Date(now).toISOString(),
          verdict: boundCandidates.length
            ? "PREVALIDATED"
            : "HOLD",
          eligible_candidates: structuredClone(
            boundCandidates,
          ),
          rejected_candidates: [],
        }
      : require(
          "./services/governed-multi-lane-candidate-eligibility"
        ).governMultiLaneCandidates({
          candidates: boundCandidates,
          now,
          planner_payload: payload,
        });
  const candidates =
    candidateEligibility.eligible_candidates;
  const deriveMultiLaneRuntimeControl =
    ctx.deriveMultiLaneRuntimeControl ||
    require("./services/multi-lane-runtime-control")
      .deriveMultiLaneRuntimeControl;
  const runtimeControl =
    ctx.prevalidatedRuntimeControl === true &&
    payload.runtime_control &&
    typeof payload.runtime_control === "object"
      ? structuredClone(payload.runtime_control)
      : deriveMultiLaneRuntimeControl({
          payload,
          repos: ctx.repos,
          env: runtimeEnv,
          now,
          operatingContract: contract,
        });
  const queueState = collectMultiLaneQueueState(
    ctx.repos,
    payload.queue_state,
    { excludeJobId: job?.id },
  );
  const plan = buildGovernedMultiLanePlan({
    now,
    candidates,
    runtimeControl,
    queueState,
  });
  plan.runtime_control_evidence =
    runtimeControl.evidence || null;
  plan.safety.live_publish_enabled =
    runtimeControl.live_publish_enabled === true;
  plan.safety.human_admission_required = true;

  const {
    buildGovernedLaneRoutingPlan,
  } = require("./services/multi-lane-job-routing");
  const routing = buildGovernedLaneRoutingPlan({
    now,
    candidates,
    runtimeControl,
    queueState,
  });
  const enqueuedJobs = [];
  const routingExecutionBlockers = [];
  for (const lane of routing.lanes) {
    const next = lane.next_job;
    if (!next) continue;
    if (
      next.kind === "publish" ||
      next.kind === "produce" ||
      typeof handlers[next.kind] !== "function"
    ) {
      routingExecutionBlockers.push({
        lane_id: lane.lane_id,
        story_id: lane.candidate?.story_id || null,
        kind: next.kind,
        blocker:
          next.kind === "publish" || next.kind === "produce"
            ? "generic_pipeline_job_forbidden"
            : "registered_lane_handler_required",
      });
      continue;
    }
    if (!ctx.repos?.jobs?.enqueue) {
      routingExecutionBlockers.push({
        lane_id: lane.lane_id,
        story_id: lane.candidate?.story_id || null,
        kind: next.kind,
        blocker: "durable_job_repository_required",
      });
      continue;
    }
    const urgentBreakingEvidence =
      lane.lane_id === "breaking_short" &&
      String(payload.breaking_story_id || "").trim() ===
        String(next.payload.story_id || "").trim()
        ? {
            verification_status:
              String(payload.verification_status || "")
                .trim()
                .toUpperCase() || null,
            primary_source_url:
              String(payload.primary_source_url || "").trim() ||
              null,
            source_evidence_sha256:
              String(payload.source_evidence_sha256 || "")
                .trim()
                .toLowerCase() || null,
            source_evidence_path:
              String(payload.source_evidence_path || "").trim() ||
              null,
            source_evidence_file_sha256:
              String(
                payload.source_evidence_file_sha256 || "",
              )
                .trim()
                .toLowerCase() || null,
          }
        : null;
    const queued = ctx.repos.jobs.enqueue({
      kind: next.kind,
      channel_id:
        job.channel_id || process.env.CHANNEL || "pulse-gaming",
      story_id: next.payload.story_id,
      payload: {
        ...next.payload,
        ...(urgentBreakingEvidence || {}),
        worker_pool: next.worker_pool,
        publish_authority:
          next.worker_pool === "critical_publication",
      },
      priority:
        [
          "admit_governed_publication",
          "verify_governed_youtube_release_t0",
        ].includes(next.kind)
          ? 0
          : lane.lane_id === "breaking_short"
            ? 6
            : lane.lane_id === "evergreen_short"
              ? 18
              : 28,
      requires_gpu: false,
      max_attempts: 3,
      idempotency_key: next.idempotency_key,
      ...(next.run_at ? { run_at: next.run_at } : {}),
    });
    enqueuedJobs.push({
      id: queued.id,
      kind: next.kind,
      lane_id: lane.lane_id,
      story_id: next.payload.story_id,
      worker_pool: next.worker_pool,
    });
  }
  plan.routing = routing;
  plan.candidate_hydration = candidateHydration;
  plan.candidate_eligibility = candidateEligibility;
  plan.enqueued_jobs = enqueuedJobs;
  plan.routing_execution_blockers = routingExecutionBlockers;

  const outDir = path.resolve(
    payload.out_dir ||
      path.join(
        __dirname,
        "..",
        "output",
        "multi-lane-plans",
        "current",
      ),
  );
  await fs.ensureDir(outDir);
  const reportJson = path.join(
    outDir,
    "governed_multi_lane_plan.json",
  );
  const reportMarkdown = path.join(
    outDir,
    "governed_multi_lane_plan.md",
  );
  await fs.writeJson(reportJson, plan, { spaces: 2 });
  await fs.writeFile(
    reportMarkdown,
    renderMultiLanePlanMarkdown(plan),
    "utf8",
  );
  ctx.assertLeaseHealthy?.();
  ctx.log?.(
    `[multi-lane] verdict=${plan.verdict} green=${plan.green_lane_count}/${plan.lane_count}`,
  );
  return {
    ok: true,
    verdict: plan.verdict,
    green_lane_count: plan.green_lane_count,
    enqueued_jobs: enqueuedJobs,
    routing_execution_blockers: routingExecutionBlockers,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

async function handleRoundupWeekly(job, ctx) {
  // Phase 6b: if the scoring engine is on, precompute the week's
  // selection + chapter plan into the roundups table before handing
  // off to compileWeekly. The render pipeline can then read either
  // the legacy virality ranking or the scored selection depending on
  // USE_SCORED_ROUNDUP — keeping both paths alive while the new
  // editorial flow stabilises.
  let scoringPlan = null;
  if (process.env.USE_SCORING_ENGINE === "true") {
    ctx.assertLeaseHealthy?.();
    try {
      const { buildWeeklyRoundup } = require("./roundup");
      scoringPlan = buildWeeklyRoundup({
        repos: ctx.repos,
        log: {
          log: (m) => ctx.log && ctx.log(m),
          error: () => {},
        },
      });
      ctx.log &&
        ctx.log(
          `[roundup_weekly] scoring plan: ` +
            (scoringPlan.skipped
              ? `skipped (${scoringPlan.reason})`
              : `roundup #${scoringPlan.roundup_id}, ${scoringPlan.main_count} main + ${scoringPlan.quickfire_count} quickfire`),
        );
    } catch (err) {
      ctx.log &&
        ctx.log(`[roundup_weekly] scoring plan failed: ${err.message}`);
    }
    ctx.assertLeaseHealthy?.();
  }

  const { compileWeekly } = require("../weekly_compile");
  ctx.assertLeaseHealthy?.();
  const result = await compileWeekly();
  ctx.assertLeaseHealthy?.();
  if (!result) return { skipped: true };
  ctx.assertLeaseHealthy?.();
  try {
    const sendDiscord = require("../notify");
    await sendDiscord(
      `**Weekly Roundup Published**\n` +
        `${result.story_count} stories, ${Math.round((result.duration_seconds || 0) / 60)} min\n` +
        `${result.youtube_url || "Upload pending"}`,
    );
  } catch {
    /* ignore */
  }
  ctx.assertLeaseHealthy?.();

  // Phase 7: fan out the finished roundup into derivative rows + jobs.
  // Only runs when the scoring engine already produced a roundup row;
  // the legacy weekly_compile doesn't write to the roundups table.
  if (
    process.env.USE_SCORING_ENGINE === "true" &&
    scoringPlan &&
    !scoringPlan.skipped &&
    scoringPlan.roundup_id
  ) {
    ctx.assertLeaseHealthy?.();
    try {
      const { jobs } = ctx.repos;
      jobs.enqueue({
        kind: "roundup_fanout",
        idempotency_key: `roundup_fanout:${scoringPlan.roundup_id}`,
        payload: { roundup_id: scoringPlan.roundup_id },
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        priority: 45,
      });
      ctx.log &&
        ctx.log(
          `[roundup_weekly] enqueued fanout for roundup #${scoringPlan.roundup_id}`,
        );
    } catch (err) {
      ctx.log &&
        ctx.log(`[roundup_weekly] fanout enqueue failed: ${err.message}`);
    }
    ctx.assertLeaseHealthy?.();
  }

  return {
    story_count: result.story_count,
    duration_seconds: result.duration_seconds,
    youtube_url: result.youtube_url || null,
    roundup_id: scoringPlan ? scoringPlan.roundup_id : null,
  };
}

async function handleRoundupMonthlyTopics(job, ctx) {
  const {
    identifyCompilableTopics,
    compileByTopic,
  } = require("../weekly_compile");
  const topics = await identifyCompilableTopics(30);
  const top3 = topics.slice(0, 3);
  if (!top3.length) return { skipped: true };
  const completed = [];
  for (const topic of top3) {
    ctx.assertLeaseHealthy?.();
    try {
      const r = await compileByTopic(topic.keyword);
      completed.push({ keyword: topic.keyword, ok: true, ...r });
    } catch (err) {
      completed.push({ keyword: topic.keyword, ok: false, error: err.message });
    }
    ctx.assertLeaseHealthy?.();
  }
  return { completed };
}

async function handleBlogRebuild(job, ctx) {
  const { build } = require("../blog/build");
  ctx.assertLeaseHealthy?.();
  await build();
  ctx.assertLeaseHealthy?.();
  return { ok: true };
}

async function handleDbBackup(job, ctx) {
  const { backupDatabase } = require("./db_backup");
  ctx.assertLeaseHealthy?.();
  await backupDatabase();
  ctx.assertLeaseHealthy?.();
  return { ok: true };
}

async function handleTimingReanalysis(job, ctx) {
  const { getTimingReport } = require("../optimal_timing");
  const report = await getTimingReport();
  ctx.assertLeaseHealthy?.();
  try {
    const sendDiscord = require("../notify");
    await sendDiscord("**Weekly Timing Report**\n" + report);
  } catch {
    /* ignore */
  }
  ctx.assertLeaseHealthy?.();
  return { ok: true };
}

async function handleInstagramTokenRefresh(job, ctx) {
  const { seedTokenFromEnv, refreshToken } = require("../upload_instagram");
  const tokenPath = path.join(
    __dirname,
    "..",
    "tokens",
    "instagram_token.json",
  );
  ctx.assertLeaseHealthy?.();
  await seedTokenFromEnv();
  ctx.assertLeaseHealthy?.();
  if (!(await fs.pathExists(tokenPath))) return { skipped: "no_token_file" };
  const tokenData = await fs.readJson(tokenPath);
  const daysLeft = Math.round(
    (tokenData.expires_at - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (daysLeft < 30) {
    ctx.assertLeaseHealthy?.();
    await refreshToken(tokenData.access_token);
    ctx.assertLeaseHealthy?.();
    return { refreshed: true, daysLeft };
  }
  return { refreshed: false, daysLeft };
}

// ── Overnight workshop handlers ───────────────────────────────────
// All four return enabled=false when OVERNIGHT_WORKSHOP_ENABLED!=true.
async function handleOvernightProduceSweep(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  ctx.assertLeaseHealthy?.();
  const result = await w.runOvernightProduceSweep({ log });
  ctx.assertLeaseHealthy?.();
  return result;
}

async function handleOvernightAnalyticsBackfill(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  ctx.assertLeaseHealthy?.();
  const result = await w.runOvernightAnalyticsBackfill({ log });
  ctx.assertLeaseHealthy?.();
  return result;
}

async function handleOvernightClaudeAnalyst(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  ctx.assertLeaseHealthy?.();
  const result = await w.runOvernightClaudeAnalyst({ log });
  ctx.assertLeaseHealthy?.();
  return result;
}

async function handleOvernightMorningDigest(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  ctx.assertLeaseHealthy?.();
  const result = await w.runOvernightMorningDigest({ log });
  ctx.assertLeaseHealthy?.();
  return result;
}

// ── Live continuous-analysis model ────────────────────────────────
// Runs every 30 minutes. Returns enabled=false when LIVE_ANALYST_ENABLED!=true.
async function handleLivePerformanceAnalyst(job, ctx) {
  const a = require("./intelligence/live-performance-analyst");
  const log = (ctx && ctx.log) || console.log;
  ctx.assertLeaseHealthy?.();
  const result = await a.runLiveAnalystPass({ log });
  ctx.assertLeaseHealthy?.();
  return result;
}

// Daily render-health digest. Reads the render_lane / render_quality_class
// / outro_present / distinct_visual_count stamps from assemble.js and
// posts a Discord summary so the operator can see the per-day shape of
// rendering quality. Specifically used to drive the flip of
// BLOCK_THIN_VISUALS=true once the thin-visual rate is low enough.
async function handleRenderHealthDigest(job, ctx) {
  const {
    runRenderHealthDigest,
  } = require("./intelligence/render-health-digest");
  const { summary, markdown } = await runRenderHealthDigest({
    windowHours: 24,
  });
  if (markdown) ctx.assertLeaseHealthy?.();
  try {
    const sendDiscord = require("../notify");
    if (markdown) await sendDiscord(markdown);
  } catch (err) {
    (ctx && ctx.log ? ctx.log : console.log)(
      `[render-health-digest] discord notify failed: ${err.message}`,
    );
  }
  if (markdown) ctx.assertLeaseHealthy?.();
  return summary;
}

// Late-finishing Instagram Reels verifier. publisher.js stamps stories
// that timed out the in-process processing wait with
// `pending_processing_timeout` and outcome `accepted_processing`. Without
// this pass, those rows never get instagram_media_id stamped even if
// Meta finished processing the container 30 minutes later.
//
// Default-OFF: the handler is wired in but the module's runVerifyPass
// returns early when INSTAGRAM_PENDING_VERIFIER_ENABLED is not "true".
// Operator opts in via Railway env once they've watched a publish cycle
// produce the warn signal and confirmed the parser/regex behaves.
async function handleInstagramPendingVerify(job, ctx) {
  const verifier = require("./intelligence/instagram-pending-verifier");
  const log = (ctx && ctx.log) || console.log;
  ctx.assertLeaseHealthy?.();
  const summary = await verifier.runVerifyPass({ log });
  ctx.assertLeaseHealthy?.();
  if (!summary.enabled) {
    return { enabled: false, skipped: "verifier_disabled_by_env" };
  }
  // Discord notify only when something interesting happened so the
  // healthy idle path is silent.
  if (summary.finished > 0 || summary.expired_or_error > 0) {
    ctx.assertLeaseHealthy?.();
    try {
      const sendDiscord = require("../notify");
      const lines = [
        `**IG pending verifier** — checked ${summary.checked}`,
        `✅ finished: ${summary.finished}`,
        `⏳ still pending: ${summary.still_pending}`,
        `⚠ expired/terminal: ${summary.expired_or_error}`,
        `↻ transient: ${summary.transient}`,
      ];
      await sendDiscord(lines.join("\n"));
    } catch (err) {
      log(`[ig-pending-verifier] discord notify failed: ${err.message}`);
    }
    ctx.assertLeaseHealthy?.();
  }
  return summary;
}

// Proactive TikTok auth health check. Runs before the daily
// publish window so a dead/expired token gets flagged in Discord
// while there's still time for the operator to re-auth, rather than
// surfacing as a silent `TT ❌` at 19:00 UTC.
//
// Never logs access_token or refresh_token. Discord alert embeds
// only the reason enum, expiry metadata, and the /auth/tiktok URL.
async function handleTiktokAuthCheck(job, ctx) {
  const { inspectTokenStatus, getAccessToken } = require("../upload_tiktok");
  const { getPublicUrl } = require("./deployment-mode");
  const tiktokAuthUrl = `${getPublicUrl()}/auth/tiktok`;

  // Near-expiry threshold — if the token dies within this window
  // we attempt a refresh now. Conservative 3h so a flapping
  // refresh endpoint still has room for the 19:00 publish window.
  const REFRESH_IF_LESS_THAN_SECONDS = 3 * 60 * 60;

  const inspect = await inspectTokenStatus();
  const result = {
    initial_reason: inspect.reason,
    expires_in_seconds: inspect.expires_in_seconds,
    needs_reauth: inspect.needs_reauth,
    refresh_attempted: false,
    refresh_ok: false,
    refresh_error: null,
  };

  // Structured Discord alert lines. We build them up and only send
  // a message if alerting is actually warranted, so the healthy path
  // is silent (noisy green pings drown out real problems).
  const alerts = [];

  if (!inspect.ok) {
    // Broken state — token missing / invalid / expired with no
    // refresh path. Operator must re-auth.
    if (inspect.needs_reauth) {
      alerts.push(`⚠ **TikTok token broken** — reason: \`${inspect.reason}\``);
      alerts.push(
        `Operator action required: visit ${tiktokAuthUrl}`,
      );
    } else if (inspect.refresh_available) {
      // Expired or `expires_at_invalid` but with a refresh_token
      // on disk — try to repair.
      result.refresh_attempted = true;
      ctx.assertLeaseHealthy?.();
      try {
        await getAccessToken();
        result.refresh_ok = true;
      } catch (err) {
        result.refresh_error = err.message;
        alerts.push(
          `⚠ **TikTok token refresh failed** — reason: \`${inspect.reason}\``,
        );
        alerts.push(`Refresh error: ${err.message}`);
        alerts.push(
          `Operator action required: visit ${tiktokAuthUrl}`,
        );
      }
      ctx.assertLeaseHealthy?.();
    }
  } else if (
    typeof inspect.expires_in_seconds === "number" &&
    inspect.expires_in_seconds <= REFRESH_IF_LESS_THAN_SECONDS
  ) {
    // Token still valid but close to expiry — refresh now so the
    // publish window doesn't cross the boundary with a stale token.
    result.refresh_attempted = true;
    ctx.assertLeaseHealthy?.();
    try {
      await getAccessToken();
      result.refresh_ok = true;
    } catch (err) {
      result.refresh_error = err.message;
      alerts.push(
        `⚠ **TikTok proactive refresh failed** — token expires in ${inspect.expires_in_seconds}s`,
      );
      alerts.push(`Refresh error: ${err.message}`);
      alerts.push(
        `Operator action required: visit ${tiktokAuthUrl}`,
      );
    }
    ctx.assertLeaseHealthy?.();
  }

  if (alerts.length > 0) {
    ctx.assertLeaseHealthy?.();
    try {
      const sendDiscord = require("../notify");
      // Redact belt-and-braces: the alerts were built from enum
      // tags and a refresh error message. Our own code doesn't put
      // token values in those, but axios/TikTok error strings might
      // echo a URL that contains a code. Scrub any obvious bearer /
      // long-random-string patterns before sending.
      const scrubbed = alerts.map((line) =>
        line
          .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
          .replace(/access_token=[^\s&"']+/gi, "access_token=<redacted>")
          .replace(/refresh_token=[^\s&"']+/gi, "refresh_token=<redacted>"),
      );
      await sendDiscord(scrubbed.join("\n"));
    } catch (err) {
      if (ctx.log)
        ctx.log(`[tiktok_auth_check] discord alert failed: ${err.message}`);
    }
    ctx.assertLeaseHealthy?.();
  }

  return result;
}

async function handleJobsReap(job, ctx) {
  const { jobs } = ctx.repos;
  ctx.assertLeaseHealthy?.();
  const changed = jobs.reapStaleClaims();
  ctx.assertLeaseHealthy?.();
  return { reclaimed: changed };
}

async function handleExternalCreativeCriticQueueReconcile(
  job,
  ctx,
) {
  const env = ctx?.env || process.env;
  const enabled =
    String(
      env.PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED || "",
    )
      .trim()
      .toLowerCase() === "true";
  if (!enabled) {
    return {
      enabled: false,
      status: "DISABLED",
      publish_authority: false,
      external_posting: false,
    };
  }

  const stateRootValue = String(
    env.PULSE_STATE_ROOT || "",
  ).trim();
  if (
    !stateRootValue ||
    !path.isAbsolute(stateRootValue)
  ) {
    throw new Error("critic_queue_state_root_required");
  }
  const stateRoot = path.resolve(stateRootValue);
  const configuredQueueRoot = String(
    env.PULSE_EXTERNAL_CRITIC_QUEUE_ROOT || "",
  ).trim();
  const queueRoot = path.resolve(
    configuredQueueRoot ||
      path.join(
        stateRoot,
        "external-creative-critic",
      ),
  );
  const relative = path.relative(stateRoot, queueRoot);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "critic_queue_root_outside_state_root",
    );
  }

  const payload = job?.payload || {};
  const now =
    payload.now ||
    (typeof ctx?.now === "function"
      ? ctx.now()
      : ctx?.now) ||
    new Date().toISOString();
  const sweep =
    ctx?.sweepExternalCreativeCriticQueue ||
    require(
      "./services/external-creative-critic-queue"
    ).sweepExternalCreativeCriticQueue;
  ctx?.assertLeaseHealthy?.();
  const result = await sweep({
    queueRoot,
    allowedRoots: [stateRoot],
    now,
  });
  ctx?.assertLeaseHealthy?.();
  return {
    ...result,
    enabled: true,
    status: "RECONCILED",
    publish_authority: false,
    external_posting: false,
  };
}

async function handleScoringDigest(job, ctx) {
  const {
    getScoringDigest,
    buildScoringDigestMessage,
  } = require("./observability");
  const hours = (job.payload && job.payload.hours) || 24;
  const summary = getScoringDigest({ repos: ctx.repos, sinceHours: hours });
  ctx.assertLeaseHealthy?.();
  try {
    const sendDiscord = require("../notify");
    await sendDiscord(buildScoringDigestMessage(summary));
  } catch (err) {
    ctx.log && ctx.log(`scoring_digest notify error: ${err.message}`);
  }
  ctx.assertLeaseHealthy?.();
  return {
    scored: summary.scored,
    by_decision: summary.by_decision,
    avg_total: summary.avg_total,
  };
}

// Phase 7 derivative handlers — all delegate to lib/repurpose.runDerivative.
async function handleDerivative(job, ctx) {
  const { runDerivative } = require("./repurpose");
  ctx.assertLeaseHealthy?.();
  const result = await runDerivative(job, ctx);
  ctx.assertLeaseHealthy?.();
  return result;
}

// Fan out a just-published roundup into its derivative rows + jobs.
async function handleRoundupFanout(job, ctx) {
  const { fanoutRoundup } = require("./repurpose");
  const roundupId = job.payload && job.payload.roundup_id;
  if (!roundupId)
    throw new Error("[roundup_fanout] payload.roundup_id required");
  ctx.assertLeaseHealthy?.();
  const result = await fanoutRoundup({
    repos: ctx.repos,
    roundupId,
    channelId: job.channel_id || process.env.CHANNEL || "pulse-gaming",
    log: {
      log: (m) => ctx.log && ctx.log(m),
      error: (m) => ctx.log && ctx.log("ERROR: " + m),
    },
  });
  ctx.assertLeaseHealthy?.();
  return result;
}

const handlers = {
  hunt: handleHunt,
  produce: handleProduce,
  publish: handlePublish,
  admit_governed_publication:
    handleGovernedPublicationAdmission,
  dispatch_governed_publication:
    handleGovernedPublicationDispatch,
  engage: handleEngage,
  engage_first_hour: handleEngageFirstHour,
  analytics: handleAnalytics,
  youtube_analytics_snapshot:
    handleYouTubeAnalyticsSnapshot,
  studio_analytics_loop: handleStudioAnalyticsLoop,
  breaking_story_discovery: handleBreakingStoryDiscovery,
  governed_editorial_evidence_discovery:
    handleBreakingStoryDiscovery,
  governed_editorial_evidence_backfill:
    handleGovernedEditorialEvidenceBackfill,
  prepare_editorial_inventory: handlePrepareEditorialInventory,
  reconcile_editorial_inventory:
    handleReconcileEditorialInventory,
  evergreen_candidate_builder: handleEvergreenCandidateBuilder,
  materialize_evergreen_motion_repair:
    handleMaterializeEvergreenMotionRepair,
  enrich_evergreen_short: handleEvergreenShortEnrichment,
  longform_evidence_refresh: handleLongformEvidenceRefresh,
  plan_breaking_short: handleExactShortPlanning,
  plan_evergreen_short: handleExactShortPlanning,
  plan_weekly_longform: handleWeeklyLongformPlanning,
  produce_breaking_short: handleExactShortProduction,
  produce_evergreen_short: handleExactShortProduction,
  enrich_weekly_longform:
    handleWeeklyLongformEditorialEnrichment,
  produce_weekly_longform: handleWeeklyLongformProduction,
  review_breaking_short: handleGovernedLaneReview,
  review_evergreen_short: handleGovernedLaneReview,
  review_weekly_longform: handleGovernedLaneReview,
  governed_multi_lane_plan: handleGovernedMultiLanePlan,
  plan_governed_autonomous_window_production:
    handleGovernedAutonomousWindowProductionPlan,
  governed_youtube_window_inventory_monitor:
    handleGovernedYoutubeWindowInventoryMonitor,
  prime_governed_youtube_window_checkpoints:
    handlePrimeGovernedYoutubeWindowCheckpoints,
  prepare_governed_autonomous_pre_t90_window:
    handleGovernedAutonomousPreT90Window,
  governed_youtube_runway_t90:
    handleGovernedYoutubeRunwayT90,
  governed_youtube_runway_t60:
    handleGovernedYoutubeRunwayT60,
  prestage_governed_youtube_release:
    handlePrestageGovernedYoutubeRelease,
  verify_governed_youtube_release_tminus15:
    handleVerifyGovernedYoutubeReleaseTminus15,
  verify_governed_youtube_release_t0:
    handleVerifyGovernedYoutubeReleaseT0,
  governed_youtube_runway_tplus15:
    handleGovernedYoutubeRunwayTplus15,
  governed_youtube_runway_slo_monitor:
    handleGovernedYoutubeRunwaySloMonitor,
  roundup_weekly: handleRoundupWeekly,
  roundup_monthly_topics: handleRoundupMonthlyTopics,
  roundup_fanout: handleRoundupFanout,
  derivative_teaser_short: handleDerivative,
  derivative_community_post: handleDerivative,
  derivative_blog_post: handleDerivative,
  derivative_story_short: handleDerivative,
  blog_rebuild: handleBlogRebuild,
  db_backup: handleDbBackup,
  timing_reanalysis: handleTimingReanalysis,
  instagram_token_refresh: handleInstagramTokenRefresh,
  instagram_pending_verify: handleInstagramPendingVerify,
  render_health_digest: handleRenderHealthDigest,
  overnight_produce_sweep: handleOvernightProduceSweep,
  overnight_analytics_backfill: handleOvernightAnalyticsBackfill,
  overnight_claude_analyst: handleOvernightClaudeAnalyst,
  overnight_morning_digest: handleOvernightMorningDigest,
  live_performance_analyst: handleLivePerformanceAnalyst,
  tiktok_auth_check: handleTiktokAuthCheck,
  jobs_reap: handleJobsReap,
  external_creative_critic_queue_reconcile:
    handleExternalCreativeCriticQueueReconcile,
  scoring_digest: handleScoringDigest,
};

module.exports = {
  handlers,
  stabilisationPublishJobBlocker,
  renderPublishSummary,
  CORE_PLATFORMS,
  OPTIONAL_PLATFORMS,
  FALLBACK_POSTS,
};
