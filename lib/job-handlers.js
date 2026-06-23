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
const { spawn: defaultSpawn } = require("node:child_process");
const { skipAnthropicDependentJob } = require("./llm-key");

const ROOT = path.resolve(__dirname, "..");
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

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueClean(values = []) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function bindPlatformPostsForDb(db) {
  if (!db) return null;
  if (db.platformPosts) return db.platformPosts;
  if (typeof db.getDb !== "function") return null;
  try {
    return require("./repositories/platform_posts").bind(db.getDb());
  } catch {
    return null;
  }
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function killSwitchState(env = {}) {
  const explicit = clean(env.PULSE_EMERGENCY_KILL_SWITCH || env.PULSE_KILL_SWITCH);
  if (explicit) return explicit.toLowerCase();
  if (truthy(env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR)) return "clear";
  return "unknown";
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function appendTail(current, chunk, maxLength = 4000) {
  const next = `${current || ""}${chunk || ""}`;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

function streamLines(prefix, text, log) {
  if (typeof log !== "function") return;
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = clean(line);
    if (trimmed) log(`${prefix} ${trimmed}`);
  }
}

function runNodeJobChildProcess({
  label,
  args,
  childKind,
  timeoutEnvName,
  spawn = defaultSpawn,
  cwd = path.resolve(__dirname, ".."),
  env = process.env,
  log = null,
  timeoutMs = Number(env[timeoutEnvName] || 45 * 60 * 1000),
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutTail = "";
    let stderrTail = "";
    const child = spawn(process.execPath, args, {
      cwd,
      env: {
        ...env,
        PULSE_JOB_CHILD_KIND: childKind || label,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        if (typeof child.kill === "function") child.kill("SIGTERM");
      } catch {
        /* ignore kill errors */
      }
      finish(() =>
        reject(
          new Error(`${label} child process timed out after ${timeoutMs}ms`),
        ),
      );
    }, timeoutMs);

    if (child.stdout) {
      if (typeof child.stdout.setEncoding === "function") child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        const text = String(chunk || "");
        stdoutTail = appendTail(stdoutTail, text);
        streamLines(`[${label}-child]`, text, log);
      });
    }
    if (child.stderr) {
      if (typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        const text = String(chunk || "");
        stderrTail = appendTail(stderrTail, text);
        streamLines(`[${label}-child:err]`, text, log);
      });
    }

    child.on("error", (err) => {
      finish(() => reject(err));
    });

    child.on("close", (code, signal) => {
      finish(() => {
        const exitCode = Number.isInteger(code) ? code : null;
        if (exitCode === 0) {
          resolve({
            ok: true,
            mode: "child_process",
            exit_code: 0,
            signal: signal || null,
            stdout_tail: stdoutTail,
            stderr_tail: stderrTail,
          });
          return;
        }
        const detail = clean(stderrTail || stdoutTail || signal || "no output");
        const suffix = signal ? ` signal ${signal}` : `code ${exitCode}`;
        reject(new Error(`${label} child process failed with ${suffix}: ${detail}`));
      });
    });
  });
}

function runProduceChildProcess(options = {}) {
  return runNodeJobChildProcess({
    label: "produce",
    args: ["run.js", "produce"],
    childKind: "produce",
    timeoutEnvName: "PULSE_PRODUCE_CHILD_TIMEOUT_MS",
    ...options,
  });
}

function runAnalyticsChildProcess(options = {}) {
  return runNodeJobChildProcess({
    label: "analytics",
    args: ["analytics.js"],
    childKind: "analytics",
    timeoutEnvName: "PULSE_ANALYTICS_CHILD_TIMEOUT_MS",
    ...options,
  });
}

function guardedLivePublishArmed(env = process.env) {
  const killSwitch = killSwitchState(env);
  return (
    truthy(env.AUTO_PUBLISH) &&
    truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED) &&
    killSwitch === "clear"
  );
}

async function handleHunt(job, ctx) {
  const missingKey = skipAnthropicDependentJob("hunt");
  if (missingKey) {
    ctx.log &&
      ctx.log(
        `[hunt] skipped: ${missingKey.reason}; scheduler remains active for non-LLM jobs`,
      );
    return missingKey;
  }
  const hunter = lazy("../hunter");
  const { autoApprove } = require("../publisher");
  const processStories = require("../processor");
  const stories = await hunter();
  await processStories();
  // Phase E cutover: scoring engine is the canonical approval path.
  // autoApprove() is now a thin wrapper that always routes through
  // lib/decision-engine::runScoringPass (or returns an explicit no-op
  // summary in non-prod dev modes — never blanket-approves). The old
  // USE_SCORING_ENGINE=true branch is gone; see publisher.js::autoApprove
  // doc for the production / dev semantics.
  const summary = await autoApprove();
  return {
    fetched: Array.isArray(stories) ? stories.length : 0,
    scoring: summary,
  };
}

async function handleProduce(job, ctx) {
  ctx.log && ctx.log("[produce] starting isolated child process");
  return runProduceChildProcess({ log: ctx.log });
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
      `**Pulse Gaming Publish Attempt**${jobId ? ` (job #${jobId})` : ""}`,
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

  if (result.publish_window_blocked) {
    const dispatch = result.publish_dispatch || {};
    const lines = [
      `**Pulse Gaming Publish Attempt**${jobId ? ` (job #${jobId})` : ""}`,
      `Status:    blocked`,
      `Publish blocked by schedule-window policy.`,
      `Source: ${dispatch.dispatchSource || "unknown"}`,
      `Nearest window: ${dispatch.nearestWindowUtc || "unknown"} UTC`,
      `Distance: ${
        typeof dispatch.minutesFromWindow === "number"
          ? `${dispatch.minutesFromWindow} minutes`
          : "unknown"
      }`,
      `Reason: ${result.top_reason || "publish_window_blocked"}`,
    ];
    return { message: lines.join("\n"), status: "failed" };
  }

  if (result.publish_dispatch_blocked) {
    const dispatch = result.publish_dispatch || {};
    const lines = [
      `**Pulse Gaming Publish Attempt**${jobId ? ` (job #${jobId})` : ""}`,
      `Status:    blocked`,
      `Publish blocked by dispatch policy.`,
      `Source: ${dispatch.dispatchSource || "unknown"}`,
      `AUTO_PUBLISH: ${dispatch.autoPublish ? "true" : "false"}`,
      `Reason: ${result.top_reason || "publish_dispatch_blocked"}`,
    ];
    return { message: lines.join("\n"), status: "failed" };
  }

  if (result.publish_cooldown_blocked) {
    const dispatch = result.publish_dispatch || {};
    const cooldown = dispatch.cooldown || {};
    const lines = [
      `**Pulse Gaming Publish Attempt**${jobId ? ` (job #${jobId})` : ""}`,
      `Status:    blocked`,
      `Publish blocked by cooldown policy.`,
      `Source: ${dispatch.dispatchSource || "unknown"}`,
      `Last post: ${cooldown.lastStoryTitle || "unknown"}`,
      `Last post time: ${cooldown.lastPublishedAt || "unknown"}`,
      `Spacing: ${
        typeof cooldown.minutesSinceLastPost === "number"
          ? `${cooldown.minutesSinceLastPost} minutes since last post`
          : "unknown"
      }`,
      `Minimum gap: ${cooldown.minGapMinutes || "unknown"} minutes`,
      `Reason: ${result.top_reason || "publish_cooldown_blocked"}`,
    ];
    return { message: lines.join("\n"), status: "failed" };
  }

  if (result.publish_daily_cap_blocked) {
    const dispatch = result.publish_dispatch || {};
    const dailyCap = dispatch.daily_cap || {};
    const lines = [
      `**Pulse Gaming Publish Attempt**${jobId ? ` (job #${jobId})` : ""}`,
      `Status:    blocked`,
      `Publish blocked by daily volume policy.`,
      `Source: ${dispatch.dispatchSource || "unknown"}`,
      `Posts in window: ${dailyCap.publicPostCount ?? "unknown"}`,
      `Daily cap: ${dailyCap.maxPublicPosts || "unknown"}`,
      `Window: ${dailyCap.windowHours || 24}h`,
      `Reason: ${result.top_reason || "publish_daily_cap_blocked"}`,
    ];
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
    `**Pulse Gaming Published**${jobId ? ` (job #${jobId})` : ""}`,
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

function renderGuardedLiveDispatchSummary(report = {}, { jobId, actionId, actionIds = [] } = {}) {
  const actions = Array.isArray(report.actions) ? report.actions.filter(Boolean) : [];
  const blockedActions = Array.isArray(report.blocked_actions) ? report.blocked_actions.filter(Boolean) : [];
  const action = actions.length
    ? actions[0]
    : blockedActions.length
      ? blockedActions[0]
      : null;
  const selectedIds = Array.isArray(actionIds)
    ? actionIds.map(clean).filter(Boolean)
    : [];
  const lines = [
    `**Pulse Gaming Guarded Publish**${jobId ? ` (job #${jobId})` : ""}`,
    `Status:    ${String(report.verdict || "unknown").toLowerCase()}`,
  ];
  if (selectedIds.length > 1) {
    lines.push(`Actions:   ${selectedIds.length}`);
    for (const item of [...actions, ...blockedActions].slice(0, 5)) {
      const label = clean(item.action_id) || "unknown";
      const outcome = clean(item.outcome) || (Array.isArray(item.blockers) && item.blockers.length ? "blocked" : "unknown");
      const external = clean(item.external_id);
      lines.push(`- ${label}: ${outcome}${external ? ` (${external})` : ""}`);
    }
  } else {
    lines.push(`Action:    ${actionId || selectedIds[0] || action?.action_id || "none"}`);
  }
  if (action && selectedIds.length <= 1) {
    lines.push(`Outcome:   ${action.outcome || "unknown"}`);
    if (action.external_id) lines.push(`External:  ${action.external_id}`);
    if (Array.isArray(action.blockers) && action.blockers.length) {
      lines.push(`Blockers:  ${action.blockers.join(", ")}`);
    }
  }
  lines.push(`Uploads:   ${report.summary?.upload_attempt_count || 0}`);
  lines.push(`DB writes:  ${report.summary?.db_mutation_count || 0}`);
  return {
    status: String(report.verdict || "unknown").toLowerCase(),
    message: lines.join("\n"),
  };
}

function renderGuardedLiveDispatchSkippedSummary(selection = {}, { jobId } = {}) {
  const skipped = Array.isArray(selection.skipped_actions)
    ? selection.skipped_actions.filter(Boolean)
    : [];
  const lines = [
    `**Pulse Gaming Guarded Publish Held**${jobId ? ` (job #${jobId})` : ""}`,
    "Publish held before upload.",
    `Reason:    ${clean(selection.reason) || "no_unpublished_guarded_actions"}`,
    `Skipped:   ${skipped.length}`,
  ];
  for (const item of skipped.slice(0, 3)) {
    const id = clean(item.action_id) || guardedActionId(item);
    const reason = clean(item.reason) || "unknown";
    const blockers = Array.isArray(item.blockers)
      ? item.blockers.map(clean).filter(Boolean)
      : [];
    lines.push(`- ${id}: ${reason}`);
    if (blockers.length) lines.push(`  blockers: ${blockers.slice(0, 3).join("; ")}`);
  }
  return lines.join("\n");
}

function guardedPublishResultShouldFailJob(result = {}) {
  if (!result || result.guarded_live_dispatch !== true) return false;
  if (result.skipped === true) return true;
  const status = clean(result.status).toLowerCase();
  if (["red", "failed", "blocked"].includes(status)) return true;
  if (Number(result.upload_attempt_count || 0) <= 0) return true;
  return false;
}

function guardedPublishFailureMessage(result = {}) {
  const action = clean(result.action_id) || clean(result.story_id) || "none";
  const reason =
    clean(result.reason) ||
    clean(result.outcome) ||
    clean(result.status) ||
    "guarded_publish_window_without_upload";
  return `guarded_publish_window_failed:${action}:${reason}`;
}

function guardedActionId(action = {}) {
  const storyId = String(action.story_id || "").trim();
  const platform = String(action.platform || "").trim();
  return String(action.action_id || "").trim() || `${storyId}:${platform}`;
}

function dispatchActionToExecutorHandoff(action = {}) {
  return {
    action_id: guardedActionId(action),
    story_id: String(action.story_id || "").trim(),
    platform: String(action.platform || "").trim(),
    title: String(action.title || "").trim(),
    video_path: String(action.video_path || "").trim(),
    captions_path: String(action.captions_path || "").trim(),
    first_frame_source: String(action.first_frame_source || "").trim(),
    canonical_manifest_path: String(action.canonical_manifest_path || "").trim(),
    platform_publish_manifest_path: String(action.platform_publish_manifest_path || "").trim(),
    story_image_path: String(action.story_image_path || action.image_path || "").trim(),
    image_path: String(action.image_path || action.story_image_path || "").trim(),
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  };
}

function guardedDispatchPlanSafetyOk(plan = {}) {
  const safety = plan.safety || {};
  return (
    plan.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function planGeneratedAtMs(plan = {}) {
  const value = String(plan.generated_at || "").trim();
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function schedulerActionId(action = {}) {
  return `${clean(action.action_id) || `${clean(action.story_id)}:${clean(action.platform)}`}`;
}

function executorPlanCoversGuardedDispatchPlan(executorPlan = {}, guardedDispatchPlan = {}) {
  const dispatchActionIds = new Set(
    (Array.isArray(guardedDispatchPlan.dispatch_ready_actions)
      ? guardedDispatchPlan.dispatch_ready_actions
      : [])
      .map(schedulerActionId)
      .filter(Boolean),
  );
  if (!dispatchActionIds.size) return true;
  const executorActionIds = new Set(
    (Array.isArray(executorPlan.handoff_ready_actions)
      ? executorPlan.handoff_ready_actions
      : [])
      .map(schedulerActionId)
      .filter(Boolean),
  );
  for (const id of dispatchActionIds) {
    if (!executorActionIds.has(id)) return false;
  }
  return true;
}

function guardedDispatchPlanReadyForScheduler(plan = {}) {
  return (
    plan.mode === "GUARDED_DISPATCH_PREFLIGHT" &&
    plan.ready_for_guarded_dispatch === true &&
    guardedDispatchPlanSafetyOk(plan)
  );
}

function buildSchedulerScopedExecutorPlan(guardedDispatchPlan = {}, generatedAt = new Date().toISOString()) {
  const dispatchReadyActions = Array.isArray(guardedDispatchPlan.dispatch_ready_actions)
    ? guardedDispatchPlan.dispatch_ready_actions.filter(Boolean)
    : [];
  const handoffReadyActions = dispatchReadyActions.map(dispatchActionToExecutorHandoff);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    source_mode: "scheduler_scoped_guarded_dispatch_plan",
    source_generated_at: guardedDispatchPlan.generated_at || null,
    ready_for_live_executor_handoff: handoffReadyActions.length > 0,
    live_publish_allowed_from_this_tool: false,
    required_next_step: handoffReadyActions.length
      ? "run_guarded_live_dispatch_executor"
      : "record_operator_approved_actions_before_guarded_dispatch",
    handoff_ready_action_count: handoffReadyActions.length,
    blocked_selected_action_count: 0,
    handoff_ready_actions: handoffReadyActions,
    blocked_selected_actions: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function readGuardedLiveExecutorPlanForScheduler(executorPlanPath, generatedAt = new Date().toISOString()) {
  let executorPlan = null;
  let executorHasActions = false;
  if (await fs.pathExists(executorPlanPath)) {
    executorPlan = await fs.readJson(executorPlanPath);
    executorHasActions = Array.isArray(executorPlan.handoff_ready_actions) && executorPlan.handoff_ready_actions.length > 0;
  }

  const guardedDispatchPlanPath = process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH ||
    path.join(__dirname, "..", "output", "goal-contract", "guarded_dispatch_plan.json");
  if (!await fs.pathExists(guardedDispatchPlanPath)) {
    return executorPlan || {
      mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
      ready_for_live_executor_handoff: false,
      live_publish_allowed_from_this_tool: false,
      required_next_step: "record_operator_approved_actions_before_guarded_dispatch",
      handoff_ready_actions: [],
      blocked_selected_actions: [],
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
      source_missing: guardedDispatchPlanPath,
    };
  }

  const guardedDispatchPlan = await fs.readJson(guardedDispatchPlanPath);
  const guardedDispatchPlanReady = guardedDispatchPlanReadyForScheduler(guardedDispatchPlan);
  if (executorHasActions) {
    if (guardedDispatchPlanReady) {
      const executorGeneratedAt = planGeneratedAtMs(executorPlan);
      const dispatchGeneratedAt = planGeneratedAtMs(guardedDispatchPlan);
      const executorCoversDispatch = executorPlanCoversGuardedDispatchPlan(executorPlan, guardedDispatchPlan);
      if (
        !executorCoversDispatch ||
        (dispatchGeneratedAt !== null && (executorGeneratedAt === null || dispatchGeneratedAt > executorGeneratedAt))
      ) {
        return buildSchedulerScopedExecutorPlan(guardedDispatchPlan, generatedAt);
      }
    }
    return executorPlan;
  }
  if (!guardedDispatchPlanReady) {
    return executorPlan || buildSchedulerScopedExecutorPlan({}, generatedAt);
  }
  return buildSchedulerScopedExecutorPlan(guardedDispatchPlan, generatedAt);
}

async function handleGuardedLiveDispatchPublish(job, ctx) {
  const executorPlanPath = process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH ||
    path.join(__dirname, "..", "output", "goal-contract", "guarded_dispatch_executor_plan.json");

  const {
    selectNextGuardedLiveAction,
    runGuardedLiveDispatchExecutor,
    writeGuardedLiveDispatchExecutorReport,
  } = require("./goal-guarded-live-dispatch-executor");
  const db = require("./db");
  const generatedAt = new Date().toISOString();
  const executorPlan = await readGuardedLiveExecutorPlanForScheduler(executorPlanPath, generatedAt);
  const stories = await db.getStories();
  const platformPosts = bindPlatformPostsForDb(db);
  const selection = await selectNextGuardedLiveAction({
    executorPlan,
    stories,
    platformPosts,
  });

  if (selection.exhausted) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(renderGuardedLiveDispatchSkippedSummary(selection, { jobId: job.id }));
    } catch (err) {
      ctx.log && ctx.log(`notify error: ${err.message}`);
    }
    const result = {
      guarded_live_dispatch: true,
      skipped: true,
      status: "blocked",
      reason: selection.reason || "no_unpublished_guarded_actions",
      skipped_action_count: selection.skipped_actions?.length || 0,
      skipped_actions: Array.isArray(selection.skipped_actions)
        ? selection.skipped_actions.map((item) => ({
            action_id: clean(item.action_id) || guardedActionId(item),
            story_id: clean(item.story_id),
            platform: clean(item.platform),
            reason: clean(item.reason) || "unknown",
            blockers: Array.isArray(item.blockers)
              ? item.blockers.map(clean).filter(Boolean)
              : [],
          }))
        : [],
    };
    throw new Error(guardedPublishFailureMessage(result));
  }

  const selectedActionIds = Array.isArray(selection.selected_action_ids) &&
    selection.selected_action_ids.length
    ? selection.selected_action_ids.map(clean).filter(Boolean)
    : [selection.action_id].map(clean).filter(Boolean);

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan,
    stories,
    actionIds: selectedActionIds,
    apply: true,
    maxActions: selectedActionIds.length || 1,
    env: process.env,
    db,
    platformPosts,
    generatedAt,
  });
  await writeGuardedLiveDispatchExecutorReport(report, {
    outputDir: process.env.PULSE_GUARDED_EXECUTOR_OUTPUT_DIR ||
      path.join(__dirname, "..", "output", "goal-contract"),
  });

  const summary = renderGuardedLiveDispatchSummary(report, {
    jobId: job.id,
    actionId: selection.action_id,
    actionIds: selectedActionIds,
  });
  try {
    const sendDiscord = require("../notify");
    await sendDiscord(summary.message);
  } catch (err) {
    ctx.log && ctx.log(`notify error: ${err.message}`);
  }

  const completedActions = Array.isArray(report.actions) ? report.actions.filter(Boolean) : [];
  const blockedActions = Array.isArray(report.blocked_actions) ? report.blocked_actions.filter(Boolean) : [];
  const reportActions = [...completedActions, ...blockedActions];
  const action = completedActions.length
    ? completedActions[0]
    : blockedActions.length
      ? blockedActions[0]
      : null;
  const result = {
    guarded_live_dispatch: true,
    status: summary.status,
    action_id: selection.action_id,
    action_ids: selectedActionIds,
    story_id: action?.story_id || selection.action?.story_id || null,
    platform: action?.platform || selection.action?.platform || null,
    platforms: uniqueClean(reportActions.map((item) => item.platform)),
    outcome: action?.outcome || null,
    outcomes: reportActions.map((item) => ({
      action_id: clean(item.action_id),
      platform: clean(item.platform),
      outcome: clean(item.outcome) || (Array.isArray(item.blockers) && item.blockers.length ? "blocked" : "unknown"),
      external_id: clean(item.external_id),
    })),
    upload_attempt_count: report.summary?.upload_attempt_count || 0,
    db_mutation_count: report.summary?.db_mutation_count || 0,
  };
  if (guardedPublishResultShouldFailJob(result)) {
    throw new Error(guardedPublishFailureMessage(result));
  }
  return result;
}

function formatPublishWindowBlockedMessage(report = {}, { jobId } = {}) {
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const lines = [
    `**Pulse Gaming Publish Held**${jobId ? ` (job #${jobId})` : ""}`,
    "Publish held before upload.",
    `Reason:    publish_window_watchdog_${String(report.verdict || "unknown").toLowerCase()}`,
    `Safe:      ${report.safe_to_publish_window === true ? "yes" : "no"}`,
  ];
  if (blockers.length) lines.push(`Blockers:  ${blockers.slice(0, 3).join("; ")}`);
  lines.push(`Next:      ${report.next_action || "hold_scheduler_and_diagnose_pre_window_blockers"}`);
  return lines.join("\n");
}

async function runLastSecondPublishWatchdog(job, ctx) {
  try {
    const { runPublishWindowWatchdog } = require("./ops/publish-window-watchdog");
    return await runPublishWindowWatchdog({
      windowLabel: "live_publish_job",
      postDiscord: false,
      notifyGreen: false,
      env: process.env,
    });
  } catch (err) {
    const report = {
      verdict: "red",
      safe_to_publish_window: false,
      hold_scheduler_or_dispatch: true,
      blockers: [`publish_window_watchdog: ${err.message}`],
      next_action: "hold_scheduler_and_diagnose_pre_window_watchdog_failure",
    };
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(formatPublishWindowBlockedMessage(report, { jobId: job.id }));
    } catch (notifyErr) {
      ctx.log && ctx.log(`watchdog notify error: ${notifyErr.message}`);
    }
    return report;
  }
}

async function handlePublishWindowWatchdog(job, ctx) {
  const {
    runPublishWindowWatchdog,
    watchdogNeedsRunwayRepair,
  } = require("./ops/publish-window-watchdog");
  const report = await runPublishWindowWatchdog({
    windowLabel: job.payload?.window_label || job.name || "next_publish_window",
    postDiscord: true,
    notifyGreen: true,
    env: process.env,
  });
  let repairEnqueued = false;
  let repairEnqueueError = null;
  const payload = job.payload || {};
  if (
    watchdogNeedsRunwayRepair(report) &&
    payload.enqueue_repair_on_runway !== false &&
    ctx?.repos?.jobs
  ) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const label = clean(report.window_label || payload.window_label || "publish_window")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .slice(0, 80);
      ctx.repos.jobs.enqueue({
        kind: "safe_auto_repair_runner",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          limit: Number(payload.repair_limit || 8),
          execute: payload.repair_execute !== false,
          reason: "publish_window_watchdog_runway_refill",
          source_window_label: report.window_label || payload.window_label || null,
        },
        priority: 69,
        idempotency_key: `publish_window_watchdog_repair:${date}:${label}`,
      });
      repairEnqueued = true;
    } catch (err) {
      repairEnqueueError = err.message;
      ctx.log && ctx.log(`[publish_window_watchdog] safe repair enqueue failed: ${err.message}`);
    }
  }
  ctx.log &&
    ctx.log(
      `[publish_window_watchdog] ${report.window_label || "window"} verdict=${report.verdict} safe=${report.safe_to_publish_window}`,
    );
  return {
    status: String(report.verdict || "unknown").toLowerCase(),
    safe_to_publish_window: report.safe_to_publish_window === true,
    runtime_verdict: report.runtime_verdict,
    queue_verdict: report.queue_verdict,
    publish_readiness_verdict: report.publish_readiness_verdict,
    enabled_dry_run_action_count: report.enabled_dry_run_action_count || 0,
    executor_handoff_action_count: report.executor_handoff_action_count || 0,
    enabled_dry_run_story_count: report.enabled_dry_run_story_count || 0,
    executor_handoff_story_count: report.executor_handoff_story_count || 0,
    runway: report.action_runway || null,
    repair_enqueued: repairEnqueued,
    repair_enqueue_error: repairEnqueueError,
    blocker_count: Array.isArray(report.blockers) ? report.blockers.length : 0,
    next_action: report.next_action || null,
  };
}

async function handlePublish(job, ctx) {
  if (guardedLivePublishArmed(process.env)) {
    const watchdog = await runLastSecondPublishWatchdog(job, ctx);
    if (watchdog.safe_to_publish_window !== true) {
      try {
        const sendDiscord = require("../notify");
        await sendDiscord(formatPublishWindowBlockedMessage(watchdog, { jobId: job.id }));
      } catch (err) {
        ctx.log && ctx.log(`notify error: ${err.message}`);
      }
      const blockedResult = {
        publish_window_blocked: true,
        status: "blocked",
        top_reason: `publish_window_watchdog_${String(watchdog.verdict || "unknown").toLowerCase()}`,
        blockers: Array.isArray(watchdog.blockers) ? watchdog.blockers : [],
        next_action: watchdog.next_action || "hold_scheduler_and_diagnose_pre_window_blockers",
      };
      throw new Error(
        `publish_window_watchdog_blocked:${blockedResult.top_reason}`,
      );
    }
    return handleGuardedLiveDispatchPublish(job, ctx);
  }

  const { publishNextStory } = require("../publisher");
  const result = await publishNextStory({
    dispatchSource: "scheduler_job",
    jobId: job.id,
  });
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

  if (result.publish_window_blocked) {
    return {
      publish_window_blocked: true,
      status: "blocked",
      top_reason: result.top_reason || "publish_window_blocked",
      publish_dispatch: result.publish_dispatch || null,
    };
  }

  if (result.publish_dispatch_blocked) {
    return {
      publish_dispatch_blocked: true,
      status: result.status || "blocked",
      top_reason: result.top_reason || "publish_dispatch_blocked",
      publish_dispatch: result.publish_dispatch || null,
    };
  }

  if (result.publish_cooldown_blocked) {
    return {
      publish_cooldown_blocked: true,
      status: "blocked",
      top_reason: result.top_reason || "publish_cooldown_blocked",
      publish_dispatch: result.publish_dispatch || null,
    };
  }

  if (result.publish_daily_cap_blocked) {
    return {
      publish_daily_cap_blocked: true,
      status: "blocked",
      top_reason: result.top_reason || "publish_daily_cap_blocked",
      publish_dispatch: result.publish_dispatch || null,
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

async function handleEngage(job, ctx) {
  const { engageRecent } = require("../engagement");
  await engageRecent();
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
    try {
      await engageFirstHour(story.youtube_post_id, story);
    } catch (err) {
      ctx.log && ctx.log(`engageFirstHour error ${story.id}: ${err.message}`);
    }
  }
  return { processed: recent.length };
}

async function handleAnalytics(job, ctx) {
  ctx.log && ctx.log("[analytics] starting isolated child process");
  return runAnalyticsChildProcess({ log: ctx.log });
}

async function handleStudioAnalyticsLoop(job, ctx) {
  // Studio v2 feedback loop. Reads metrics stamped by the analytics
  // handler, tries the configured local/remote analyst and falls back
  // to deterministic findings if the model is unavailable or returns
  // malformed output.
  const days = (job.payload && job.payload.days) || 14;
  const dry = !!(job.payload && job.payload.dry);
  const { main } = require("../tools/studio-v2-analytics-loop");
  const result = await main({ days, dry });
  return {
    ok: true,
    days,
    usedFallback: result?.usedFallback === true,
    findingsPath: result?.findingsPath || null,
  };
}

async function handleRoundupWeekly(job, ctx) {
  const { _private: weeklyControls } = require("../weekly_compile");
  if (
    !weeklyControls.shouldRunWeeklyJob({
      env: process.env,
      payload: job.payload || {},
    })
  ) {
    const reason = "weekly_roundup_job_not_enabled";
    ctx.log &&
      ctx.log(
        `[roundup_weekly] skipped: ${reason}; set WEEKLY_ROUNDUP_JOB_ENABLED=true or pass operator_approved payload after longform QA`,
      );
    return { skipped: true, reason };
  }

  const missingKey = skipAnthropicDependentJob("roundup_weekly");
  if (missingKey) {
    ctx.log && ctx.log(`[roundup_weekly] skipped: ${missingKey.reason}`);
    return missingKey;
  }
  // Phase 6b: if the scoring engine is on, precompute the week's
  // selection + chapter plan into the roundups table before handing
  // off to compileWeekly. The render pipeline can then read either
  // the legacy virality ranking or the scored selection depending on
  // USE_SCORED_ROUNDUP — keeping both paths alive while the new
  // editorial flow stabilises.
  let scoringPlan = null;
  if (process.env.USE_SCORING_ENGINE === "true") {
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
  }

  const { compileWeekly } = require("../weekly_compile");
  const result = await compileWeekly();
  if (!result) return { skipped: true };
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

  // Phase 7: fan out the finished roundup into derivative rows + jobs.
  // Only runs when the scoring engine already produced a roundup row;
  // the legacy weekly_compile doesn't write to the roundups table.
  if (
    process.env.USE_SCORING_ENGINE === "true" &&
    scoringPlan &&
    !scoringPlan.skipped &&
    scoringPlan.roundup_id
  ) {
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
  }

  return {
    story_count: result.story_count,
    duration_seconds: result.duration_seconds,
    youtube_url: result.youtube_url || null,
    roundup_id: scoringPlan ? scoringPlan.roundup_id : null,
  };
}

async function handleRoundupMonthlyTopics(job, ctx) {
  const missingKey = skipAnthropicDependentJob("roundup_monthly_topics");
  if (missingKey) {
    ctx.log && ctx.log(`[roundup_monthly_topics] skipped: ${missingKey.reason}`);
    return missingKey;
  }
  const {
    identifyCompilableTopics,
    compileByTopic,
  } = require("../weekly_compile");
  const topics = await identifyCompilableTopics(30);
  const top3 = topics.slice(0, 3);
  if (!top3.length) return { skipped: true };
  const completed = [];
  for (const topic of top3) {
    try {
      const r = await compileByTopic(topic.keyword);
      completed.push({ keyword: topic.keyword, ok: true, ...r });
    } catch (err) {
      completed.push({ keyword: topic.keyword, ok: false, error: err.message });
    }
  }
  return { completed };
}

async function handleBlogRebuild(job, ctx) {
  const { build } = require("../blog/build");
  await build();
  return { ok: true };
}

async function handleDbBackup(job, ctx) {
  const { backupDatabase } = require("./db_backup");
  await backupDatabase();
  return { ok: true };
}

async function handleTimingReanalysis(job, ctx) {
  const { getTimingReport } = require("../optimal_timing");
  const report = await getTimingReport();
  try {
    const sendDiscord = require("../notify");
    await sendDiscord("**Weekly Timing Report**\n" + report);
  } catch {
    /* ignore */
  }
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
  await seedTokenFromEnv();
  if (!(await fs.pathExists(tokenPath))) return { skipped: "no_token_file" };
  const tokenData = await fs.readJson(tokenPath);
  const daysLeft = Math.round(
    (tokenData.expires_at - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (daysLeft < 30) {
    await refreshToken(tokenData.access_token);
    return { refreshed: true, daysLeft };
  }
  return { refreshed: false, daysLeft };
}

// ── Overnight workshop handlers ───────────────────────────────────
// All four return enabled=false when OVERNIGHT_WORKSHOP_ENABLED!=true.
async function handleOvernightProduceSweep(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  return w.runOvernightProduceSweep({ log });
}

async function handleOvernightAnalyticsBackfill(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  return w.runOvernightAnalyticsBackfill({ log });
}

async function handleOvernightClaudeAnalyst(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  return w.runOvernightClaudeAnalyst({ log });
}

async function handleOvernightMorningDigest(job, ctx) {
  const w = require("./intelligence/overnight-workshop");
  const log = (ctx && ctx.log) || console.log;
  return w.runOvernightMorningDigest({ log });
}

// ── Live continuous-analysis model ────────────────────────────────
// Runs every 30 minutes. Returns enabled=false when LIVE_ANALYST_ENABLED!=true.
async function handleLivePerformanceAnalyst(job, ctx) {
  const a = require("./intelligence/live-performance-analyst");
  const log = (ctx && ctx.log) || console.log;
  return a.runLiveAnalystPass({ log });
}

async function handleContinuousLearningLoop(job, ctx) {
  const { runContinuousLearningLoop } = require("./intelligence/continuous-learning-loop");
  const log = (ctx && ctx.log) || console.log;
  const payload = (job && job.payload) || {};
  const result = await runContinuousLearningLoop({
    log,
    limit: payload.limit || 12,
    maxAgeDays: payload.maxAgeDays || 45,
    dry: payload.dry === true,
  });
  return {
    ok: true,
    status: result.summary.status,
    targets: result.summary.target_count,
    visual_v3_files:
      result.summary.learning_surfaces.visual_v3_feedback.retention_files_written,
    blockers: result.summary.blockers,
  };
}

async function handleCandidateSupplyMonitor(job, ctx) {
  const {
    buildCandidateSupplyReport,
    candidateSupplyMonitorNeedsFreshIntake,
    candidateSupplyMonitorNeedsRepair,
    candidateSupplyMonitorNeedsTranscriptRepair,
    formatCandidateSupplyMonitorDiscord,
    formatCandidateSupplyMarkdown,
    shouldNotifyCandidateSupplyMonitor,
  } = require("./ops/candidate-supply");
  const { buildFreshCandidateReport } = require("../tools/candidate-supply-engine");
  const channelConfig = require("../channels/pulse-gaming");
  const payload = (job && job.payload) || {};
  const limit = Number(payload.limit || 30);
  const outDir = path.join(__dirname, "..", "output", "candidate-supply");
  const { report: candidateReport, stories } = await buildFreshCandidateReport({ limit });
  let transcriptAudienceReport = null;
  if (payload.include_transcript_audience_audit !== false) {
    try {
      const {
        auditGeneratedTranscripts,
        writeTranscriptAudienceAudit,
      } = require("./ops/transcript-audience-audit");
      transcriptAudienceReport = await auditGeneratedTranscripts({ root: path.join(__dirname, "..") });
      await writeTranscriptAudienceAudit(transcriptAudienceReport, {
        outputDir: path.join(__dirname, "..", "output", "transcript-audience-audit"),
      });
    } catch (err) {
      const generatedAt = new Date().toISOString();
      transcriptAudienceReport = {
        generated_at: generatedAt,
        summary: { total: 0, pass: 0, rewrite_required: 0 },
        stories: [],
        error: err.message || "transcript_audience_audit_failed",
      };
    }
  }
  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    transcriptAudienceReport,
    channelConfig,
    now: new Date(),
  });
  await fs.ensureDir(outDir);
  await Promise.all([
    fs.writeJson(path.join(outDir, "candidate_supply_report.json"), report, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "candidate_supply_report.md"), formatCandidateSupplyMarkdown(report), "utf8"),
    fs.writeJson(path.join(outDir, "official_source_watchlist.json"), report.official_source_watchlist, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "fresh_candidate_queue.json"), candidateReport, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "story_priority_scorecard.json"), { generated_at: report.generated_at, scorecards: report.priority_scorecards }, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "dedupe_report.json"), { generated_at: report.generated_at, ...report.dedupe }, { spaces: 2 }),
  ]);
  const needsRepair = candidateSupplyMonitorNeedsRepair(report);
  const needsFreshIntake = candidateSupplyMonitorNeedsFreshIntake(report);
  const needsTranscriptRepair = candidateSupplyMonitorNeedsTranscriptRepair(report);
  const needsFreshReviewScriptRepair = needsTranscriptRepair || needsRepair || needsFreshIntake;
  let freshIntakeEnqueued = false;
  let freshIntakeEnqueueError = null;
  if (needsFreshIntake && payload.enqueue_hunt_on_runway_gap !== false && ctx?.repos?.jobs) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const hour = String(generatedAt.getUTCHours()).padStart(2, "0");
      const runway = report.candidate_buffer?.publish_window_runway || {};
      ctx.repos.jobs.enqueue({
        kind: "hunt",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          reason: "candidate_supply_monitor_fresh_intake",
          source: "candidate_supply_monitor",
          source_runway_status: runway.status || null,
          source_green_ready_candidates: report.summary?.green_ready_candidates || 0,
          source_durable_green_ready_candidates: report.summary?.durable_green_ready_candidates || 0,
        },
        priority: Number(payload.hunt_priority || 41),
        idempotency_key: `candidate_supply_hunt:${date}:${hour}`,
      });
      freshIntakeEnqueued = true;
    } catch (err) {
      freshIntakeEnqueueError = err.message;
      const log = (ctx && ctx.log) || console.log;
      log(`[candidate-supply-monitor] fresh intake enqueue failed: ${err.message}`);
    }
  }
  let freshReviewScriptRepairEnqueued = false;
  let freshReviewScriptRepairEnqueueError = null;
  if (
    needsFreshReviewScriptRepair &&
    payload.enqueue_fresh_review_script_repair !== false &&
    ctx?.repos?.jobs
  ) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const hour = String(generatedAt.getUTCHours()).padStart(2, "0");
      ctx.repos.jobs.enqueue({
        kind: "fresh_review_script_repair",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          limit: Number(payload.fresh_review_script_repair_limit || 6),
          execute: payload.fresh_review_script_repair_execute !== false,
          reason: "candidate_supply_monitor_fresh_review_script_repair",
          source_green_ready_candidates: report.summary?.green_ready_candidates || 0,
          source_durable_green_ready_candidates: report.summary?.durable_green_ready_candidates || 0,
          source_transcript_backlog_current_candidates: report.summary?.transcript_backlog_current_candidates || 0,
          source_transcript_clean_green_ready_candidates: report.summary?.transcript_clean_green_ready_candidates || 0,
          source_runway_status: report.candidate_buffer?.publish_window_runway?.status || null,
        },
        priority: 68,
        idempotency_key: `candidate_supply_fresh_review_script_repair:${date}:${hour}`,
      });
      freshReviewScriptRepairEnqueued = true;
    } catch (err) {
      freshReviewScriptRepairEnqueueError = err.message;
      const log = (ctx && ctx.log) || console.log;
      log(`[candidate-supply-monitor] fresh review script repair enqueue failed: ${err.message}`);
    }
  }
  let freshProductionRefillEnqueued = false;
  let freshProductionRefillEnqueueError = null;
  if (
    needsFreshIntake &&
    payload.enqueue_fresh_production_refill !== false &&
    ctx?.repos?.jobs
  ) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const hour = String(generatedAt.getUTCHours()).padStart(2, "0");
      const outputStamp = `${date}-${hour}`;
      const runway = report.candidate_buffer?.publish_window_runway || {};
      ctx.repos.jobs.enqueue({
        kind: "fresh_production_refill",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          limit: Number(payload.fresh_production_refill_limit || 12),
          rss_per_feed: Number(payload.fresh_production_refill_rss_per_feed || 4),
          out_dir: `output/candidate-supply/fresh-production-refill/${outputStamp}/goal-proof-batch`,
          contract_out_dir: `output/candidate-supply/fresh-production-refill/${outputStamp}/goal-contract`,
          reason: "candidate_supply_monitor_fresh_production_refill",
          source_runway_status: runway.status || null,
          source_green_ready_candidates: report.summary?.green_ready_candidates || 0,
          source_durable_green_ready_candidates: report.summary?.durable_green_ready_candidates || 0,
        },
        priority: Number(payload.fresh_production_refill_priority || 67),
        idempotency_key: `candidate_supply_fresh_production_refill:${date}:${hour}`,
      });
      freshProductionRefillEnqueued = true;
    } catch (err) {
      freshProductionRefillEnqueueError = err.message;
      const log = (ctx && ctx.log) || console.log;
      log(`[candidate-supply-monitor] fresh production refill enqueue failed: ${err.message}`);
    }
  }
  let repairEnqueued = false;
  let repairEnqueueError = null;
  if (needsRepair && payload.enqueue_repair_on_amber !== false && ctx?.repos?.jobs) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const hour = String(generatedAt.getUTCHours()).padStart(2, "0");
      ctx.repos.jobs.enqueue({
        kind: "safe_auto_repair_runner",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          limit: Number(payload.repair_limit || 8),
          execute: payload.repair_execute !== false,
          reason: "candidate_supply_monitor_reserve_refill",
        },
        priority: 69,
        idempotency_key: `candidate_supply_repair:${date}:${hour}`,
      });
      repairEnqueued = true;
    } catch (err) {
      repairEnqueueError = err.message;
      const log = (ctx && ctx.log) || console.log;
      log(`[candidate-supply-monitor] safe repair enqueue failed: ${err.message}`);
    }
  }
  if (shouldNotifyCandidateSupplyMonitor(report, payload)) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(formatCandidateSupplyMonitorDiscord(report));
    } catch (err) {
      const log = (ctx && ctx.log) || console.log;
      log(`[candidate-supply-monitor] discord notify failed: ${err.message}`);
    }
  }
  return {
    status: report.verdict,
    fresh_source_backed_24h: report.summary?.fresh_source_backed_stories_24h || 0,
    green_ready_candidates: report.summary?.green_ready_candidates || 0,
    source_safe_candidates: report.summary?.source_safe_candidates || 0,
    v4_ready_candidates: report.summary?.v4_ready_candidates || 0,
    runway: report.candidate_buffer?.publish_window_runway || null,
    repair_needed: needsRepair,
    repair_enqueued: repairEnqueued,
    repair_enqueue_error: repairEnqueueError,
    transcript_repair_needed: needsTranscriptRepair,
    transcript_backlog_current_candidates: report.summary?.transcript_backlog_current_candidates || 0,
    transcript_clean_green_ready_candidates: report.summary?.transcript_clean_green_ready_candidates || 0,
    fresh_review_script_repair_needed: needsFreshReviewScriptRepair,
    fresh_review_script_repair_enqueued: freshReviewScriptRepairEnqueued,
    fresh_review_script_repair_enqueue_error: freshReviewScriptRepairEnqueueError,
    fresh_production_refill_needed: needsFreshIntake,
    fresh_production_refill_enqueued: freshProductionRefillEnqueued,
    fresh_production_refill_enqueue_error: freshProductionRefillEnqueueError,
    fresh_intake_needed: needsFreshIntake,
    fresh_intake_enqueued: freshIntakeEnqueued,
    fresh_intake_enqueue_error: freshIntakeEnqueueError,
    blockers: report.blockers || [],
    warnings: report.warnings || [],
  };
}

async function handleFreshReviewScriptRepair(job, ctx) {
  const payload = (job && job.payload) || {};
  const limit = Math.max(1, Math.min(20, Number(payload.limit || 6) || 6));
  const execute = payload.execute !== false;
  const outDir = path.join(__dirname, "..", "output", "candidate-supply", "fresh-review-script-repair");
  const { runFreshReviewScriptRepair } = require("../tools/fresh-review-script-repair");
  const result = await runFreshReviewScriptRepair({
    limit,
    execute,
    maxAgeHours: Number(payload.max_age_hours || 7 * 24),
    minScore: Number(payload.min_score || 65),
    outDir,
  });
  const log = (ctx && ctx.log) || console.log;
  log(
    `[fresh-review-script-repair] selected=${result.plan_summary?.selected_count || 0} executed=${result.execution_summary?.executed || 0} no_effect=${result.execution_summary?.no_effect || 0}`,
  );
  return result;
}

function freshRefillSafeSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "source";
}

function officialFreshRefillSourceType(sourceName, sourceUrl) {
  const name = clean(sourceName).toLowerCase();
  let host = "";
  let pathname = "";
  try {
    const parsed = new URL(clean(sourceUrl));
    host = String(parsed.hostname || "").toLowerCase().replace(/^www\./, "");
    pathname = String(parsed.pathname || "").toLowerCase();
  } catch {
    host = "";
    pathname = "";
  }
  if (name === "xbox wire" || host === "news.xbox.com") return "official_game_site_news_page";
  if (name === "playstation blog" || host === "blog.playstation.com") return "official_game_site_news_page";
  if (/^nintendo(?:\s+(?:news|direct|official))?$/.test(name) || /(?:^|\.)nintendo\.com$/i.test(host)) {
    return "official_game_site_news_page";
  }
  if ((name === "steam" || name === "steam store") && host === "store.steampowered.com") {
    return "platform_storefront";
  }
  if (/^(?:xbox|microsoft store|xbox store)$/.test(name) || (host === "xbox.com" || host === "microsoft.com") && /(?:games|store)/.test(pathname)) {
    return "official_platform_product_page";
  }
  if (
    /^(?:playstation store|playstation)$/.test(name) ||
    (host === "store.playstation.com" || host === "playstation.com") && /games/.test(pathname)
  ) {
    return "official_platform_product_page";
  }
  if (
    /^(?:ea|electronic arts|ubisoft|capcom|sega|bandai namco|square enix|bethesda|blizzard|rockstar|2k)$/.test(name) &&
    /(?:^|\.)((ea|ubisoft|capcom|sega|bandainamcoent|square-enix-games|bethesda|blizzard|rockstargames|2k)\.com)$/i.test(host)
  ) {
    return "official_game_site_news_page";
  }
  return null;
}

function freshRefillStoryId(row) {
  return clean(row?.story_id || row?.id || row?.storyId);
}

function freshRefillArtifactDir(row, root) {
  const raw = clean(row?.artifact_dir || row?.artifactDir);
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
}

function canonicalSubjectFromFreshRefill(canonical = {}, sourceManifest = {}) {
  return clean(
    canonical.canonical_subject ||
      canonical.canonical_game ||
      canonical.selected_title ||
      canonical.canonical_title ||
      sourceManifest.title,
  );
}

async function readFreshRefillEvidenceRows(storyPackagesPath) {
  const payload = await readJsonIfPresent(storyPackagesPath, []);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.stories)) return payload.stories;
  if (Array.isArray(payload?.packages)) return payload.packages;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir }) {
  const root = path.resolve(__dirname, "..");
  const rows = await readFreshRefillEvidenceRows(storyPackagesPath);
  const stories = [];
  const entries = [];

  for (const row of rows) {
    const storyId = freshRefillStoryId(row);
    const artifactDir = freshRefillArtifactDir(row, root);
    if (!storyId || !artifactDir) continue;
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
    const sourceManifest = await readJsonIfPresent(path.join(artifactDir, "source_manifest.json"), {});
    const primarySource = sourceManifest.primary_source || {};
    const sourceName = clean(primarySource.name || canonical.primary_source || canonical.discovery_source);
    const sourceUrl = clean(primarySource.url || canonical.primary_source_url);
    const entity = canonicalSubjectFromFreshRefill(canonical, sourceManifest);
    const sourceType = officialFreshRefillSourceType(sourceName, sourceUrl);
    if (!sourceType || !sourceUrl || !entity) continue;

    const story = {
      ...canonical,
      id: storyId,
      story_id: storyId,
      title: clean(canonical.selected_title || canonical.canonical_title || entity),
      canonical_subject: entity,
      canonical_game: clean(canonical.canonical_game || entity),
      primary_source: sourceName,
      primary_source_url: sourceUrl,
      full_script: canonical.narration_script,
    };
    stories.push(story);
    entries.push({
      story_id: storyId,
      entity,
      source_type: sourceType,
      official_source_url: sourceUrl,
      direct_media_url_if_available: "",
      source_title: clean(canonical.canonical_title || canonical.selected_title || `${entity} official source`),
      source_owner: `${sourceName} official source`,
      source_family: freshRefillSafeSlug(`${sourceName}_${entity}_${storyId}`),
      evidence_of_officialness: `${sourceName} is the official/platform source recorded in this story package source manifest.`,
      entity_match_notes: `Story entity is ${entity}; source manifest and public title concern the same story.`,
      downloads_allowed: false,
    });
  }

  await fs.ensureDir(outputDir);
  const candidateStoriesPath = path.join(outputDir, "official_source_candidate_stories.json");
  const officialSourceEntriesPath = path.join(outputDir, "official_source_entries.json");
  await fs.writeJson(candidateStoriesPath, stories, { spaces: 2 });
  await fs.writeJson(officialSourceEntriesPath, entries, { spaces: 2 });

  const {
    buildOfficialSourceIntakeReport,
    renderOfficialSourceIntakeMarkdown,
  } = require("./official-source-intake");
  const officialSourceIntakeReport = buildOfficialSourceIntakeReport({ stories, entries });
  const officialSourceIntakeMarkdown = renderOfficialSourceIntakeMarkdown(officialSourceIntakeReport);
  const officialSourceIntakeJsonPath = path.join(outputDir, "official_source_intake_report.json");
  const officialSourceIntakeMdPath = path.join(outputDir, "official_source_intake_report.md");
  await fs.writeJson(officialSourceIntakeJsonPath, officialSourceIntakeReport, { spaces: 2 });
  await fs.writeFile(officialSourceIntakeMdPath, officialSourceIntakeMarkdown, "utf8");

  return {
    story_count: stories.length,
    official_source_entries_count: entries.length,
    accepted_official_source_count: officialSourceIntakeReport.summary?.accepted || 0,
    rejected_official_source_count: officialSourceIntakeReport.summary?.rejected || 0,
    candidateStoriesPath,
    officialSourceEntriesPath,
    officialSourceIntakeJsonPath,
    officialSourceIntakeMdPath,
  };
}

async function runFreshRefillRepairChild({ runChild, args, childKind, log, childProcesses }) {
  try {
    const result = await runChild({
      label: childKind,
      args,
      childKind,
      timeoutEnvName: "PULSE_FRESH_PRODUCTION_REFILL_REPAIR_TIMEOUT_MS",
      timeoutMs: Number(process.env.PULSE_FRESH_PRODUCTION_REFILL_REPAIR_TIMEOUT_MS || 15 * 60 * 1000),
      log,
    });
    childProcesses.push({
      child_kind: childKind,
      ok: true,
      args,
      stdout_tail: result?.stdout_tail || "",
      stderr_tail: result?.stderr_tail || "",
    });
    return true;
  } catch (err) {
    childProcesses.push({
      child_kind: childKind,
      ok: false,
      args,
      error: err.message,
    });
    return false;
  }
}

function renderFreshProductionRefillRepairMarkdown(report) {
  const lines = [];
  lines.push("# Fresh Production Refill Repair Evidence");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Status: ${report.status}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- story packages: ${report.summary.story_package_count}`);
  lines.push(`- official source entries: ${report.summary.official_source_entries_count}`);
  lines.push(`- accepted official references: ${report.summary.accepted_official_source_count}`);
  lines.push(`- child processes: ${report.summary.child_process_count}`);
  lines.push(`- failed child processes: ${report.summary.failed_child_process_count}`);
  lines.push("");
  lines.push("## Outputs");
  lines.push("");
  for (const [key, value] of Object.entries(report.outputs || {})) {
    if (value) lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Child Processes");
  lines.push("");
  for (const child of report.child_processes || []) {
    lines.push(`- ${child.child_kind}: ${child.ok ? "ok" : `failed (${child.error || "unknown"})`}`);
  }
  if (!report.child_processes?.length) lines.push("- none");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local proof and repair evidence only.");
  lines.push("- No manual publish, DB mutation, OAuth/token mutation or disabled-platform enablement.");
  return lines.join("\n") + "\n";
}

async function buildFreshRefillDirectMediaIntakeEvidence({
  sourceEvidence,
  directMediaTemplatePath,
  outputDir,
}) {
  const template = await readJsonIfPresent(directMediaTemplatePath, null);
  const entries = Array.isArray(template)
    ? template
    : Array.isArray(template?.entries)
      ? template.entries
      : [];
  if (!entries.length) {
    return {
      status: "skipped",
      reason: "direct_media_template_empty",
      report_path: null,
      markdown_path: null,
      accepted_count: 0,
      rejected_count: 0,
      entries_count: 0,
    };
  }

  const stories = await readJsonIfPresent(sourceEvidence.candidateStoriesPath, []);
  const {
    buildOfficialSourceIntakeReport,
    renderOfficialSourceIntakeMarkdown,
  } = require("./official-source-intake");
  const report = buildOfficialSourceIntakeReport({ stories, entries });
  const markdown = renderOfficialSourceIntakeMarkdown(report);
  const reportPath = path.join(outputDir, "official_direct_media_intake_report.json");
  const markdownPath = path.join(outputDir, "official_direct_media_intake_report.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, markdown, "utf8");

  return {
    status: "generated",
    report_path: reportPath,
    markdown_path: markdownPath,
    accepted_count: report.summary?.accepted || 0,
    rejected_count: report.summary?.rejected || 0,
    entries_count: report.summary?.entries || entries.length,
  };
}

async function buildFreshProductionRefillRepairEvidence({
  outputs,
  outDir,
  contractOutDir,
  redCount,
  runChild,
  log,
}) {
  const storyPackagesPath = clean(outputs?.storyPackagesPath);
  if (!redCount) return { status: "not_needed", reason: "no_red_packages" };
  if (!storyPackagesPath || !(await fs.pathExists(storyPackagesPath))) {
    return { status: "skipped", reason: "story_packages_missing", storyPackagesPath };
  }

  const contractDir = path.resolve(contractOutDir || path.dirname(storyPackagesPath));
  const repairDir = path.join(contractDir, "fresh_production_refill_repair");
  const motionPackDir = path.join(repairDir, "motion-packs");
  await fs.ensureDir(repairDir);
  await fs.ensureDir(motionPackDir);

  const childProcesses = [];
  const motionPackIndexPath = path.join(motionPackDir, "visual_v4_motion_packs.json");
  await runFreshRefillRepairChild({
    runChild,
    log,
    childProcesses,
    childKind: "fresh_refill_motion_pack",
    args: [
      "tools/studio-v4-motion-pack.js",
      "--stories",
      storyPackagesPath,
      "--out-dir",
      motionPackDir,
      "--json",
    ],
  });

  const sourceFamilyJsonPath = path.join(repairDir, "studio_v4_source_family_acquisition.json");
  const sourceFamilyMdPath = path.join(repairDir, "studio_v4_source_family_acquisition.md");
  await runFreshRefillRepairChild({
    runChild,
    log,
    childProcesses,
    childKind: "fresh_refill_source_family_acquisition",
    args: [
      "tools/studio-v4-source-family-acquisition.js",
      "--motion-pack-index",
      motionPackIndexPath,
      "--story-packages",
      storyPackagesPath,
      "--no-work-order",
      "--artifact-root",
      outDir,
      "--output-json",
      sourceFamilyJsonPath,
      "--output-md",
      sourceFamilyMdPath,
      "--json",
    ],
  });

  const sourceEvidence = await buildFreshRefillOfficialSourceEvidence({
    storyPackagesPath,
    outputDir: repairDir,
  });

  const directMediaJsonPath = path.join(repairDir, "official_direct_media_discovery.json");
  const directMediaMdPath = path.join(repairDir, "official_direct_media_discovery.md");
  const directMediaTemplatePath = path.join(repairDir, "official_direct_media_intake_template.json");
  let directMediaIntakeEvidence = {
    status: "not_needed",
    report_path: null,
    markdown_path: null,
    accepted_count: 0,
    rejected_count: 0,
    entries_count: 0,
  };
  let licensedDirectMediaJsonPath = null;
  let licensedDirectMediaMdPath = null;
  let licensedDirectMediaTemplatePath = null;
  let trailerReferenceJsonPath = null;
  let segmentValidationJsonPath = null;
  let segmentValidationOutputRoot = null;
  if (sourceEvidence.official_source_entries_count > 0) {
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_direct_media_discovery",
      args: [
        "tools/official-direct-media-discovery.js",
        "--input",
        sourceEvidence.officialSourceEntriesPath,
        "--output-json",
        directMediaJsonPath,
        "--output-md",
        directMediaMdPath,
        "--output-template",
        directMediaTemplatePath,
        "--timeout-ms",
        "15000",
        "--max-candidates-per-entry",
        "3",
        "--json",
      ],
    });

    directMediaIntakeEvidence = await buildFreshRefillDirectMediaIntakeEvidence({
      sourceEvidence,
      directMediaTemplatePath,
      outputDir: repairDir,
    });
    const trailerReferenceIntakeReport =
      directMediaIntakeEvidence.report_path || sourceEvidence.officialSourceIntakeJsonPath;
    trailerReferenceJsonPath = path.join(repairDir, "official_trailer_references_fresh_refill.json");
    licensedDirectMediaJsonPath = path.join(repairDir, "studio_v4_licensed_direct_media_acquisition.json");
    licensedDirectMediaMdPath = path.join(repairDir, "studio_v4_licensed_direct_media_acquisition.md");
    licensedDirectMediaTemplatePath = path.join(repairDir, "licensed_direct_media_intake_template.json");

    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_licensed_direct_media",
      args: [
        "tools/studio-v4-licensed-direct-media.js",
        "--source-family-report",
        sourceFamilyJsonPath,
        "--direct-media-report",
        directMediaJsonPath,
        "--output-json",
        licensedDirectMediaJsonPath,
        "--output-md",
        licensedDirectMediaMdPath,
        "--intake-template",
        licensedDirectMediaTemplatePath,
        "--json",
      ],
    });

    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_trailer_references",
      args: [
        "tools/official-trailer-reference-resolver.js",
        "--story-json",
        sourceEvidence.candidateStoriesPath,
        "--official-source-intake-report",
        trailerReferenceIntakeReport,
        "--output-dir",
        repairDir,
        "--output-basename",
        "official_trailer_references_fresh_refill",
        "--json",
      ],
    });

    segmentValidationJsonPath = path.join(ROOT, "test", "output", "official_trailer_segment_validation_apply_local.json");
    segmentValidationOutputRoot = path.join(
      ROOT,
      "test",
      "output",
      `fresh-refill-segment-validation-${Date.now()}`,
    );
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_segment_validation",
      args: [
        "tools/official-trailer-segment-validator.js",
        "--reference-report",
        licensedDirectMediaJsonPath,
        "--apply-local",
        "--output-root",
        segmentValidationOutputRoot,
        "--max-segments",
        "12",
        "--candidate-windows-per-source",
        "3",
        "--deep-scan",
        "--no-exhausted-source-family-filter",
        "--json",
      ],
    });

    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_motion_pack_after_segment_validation",
      args: [
        "tools/studio-v4-motion-pack.js",
        "--stories",
        storyPackagesPath,
        "--segment-report",
        segmentValidationJsonPath,
        "--trusted-footage-report",
        licensedDirectMediaJsonPath,
        "--out-dir",
        motionPackDir,
        "--no-preserve-existing",
        "--json",
      ],
    });
  }

  const failedChildProcessCount = childProcesses.filter((child) => !child.ok).length;
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: failedChildProcessCount ? "partial" : "generated",
    summary: {
      story_package_count: (await readFreshRefillEvidenceRows(storyPackagesPath)).length,
      official_source_entries_count: sourceEvidence.official_source_entries_count,
      accepted_official_source_count: sourceEvidence.accepted_official_source_count,
      rejected_official_source_count: sourceEvidence.rejected_official_source_count,
      direct_media_intake_entries_count: directMediaIntakeEvidence.entries_count,
      direct_media_intake_accepted_count: directMediaIntakeEvidence.accepted_count,
      direct_media_intake_rejected_count: directMediaIntakeEvidence.rejected_count,
      child_process_count: childProcesses.length,
      failed_child_process_count: failedChildProcessCount,
    },
    outputs: {
      story_packages: storyPackagesPath,
      motion_pack_index: motionPackIndexPath,
      source_family_report: sourceFamilyJsonPath,
      source_family_markdown: sourceFamilyMdPath,
      official_source_entries: sourceEvidence.officialSourceEntriesPath,
      official_source_intake_report: sourceEvidence.officialSourceIntakeJsonPath,
      official_source_intake_markdown: sourceEvidence.officialSourceIntakeMdPath,
      direct_media_discovery_report: sourceEvidence.official_source_entries_count > 0 ? directMediaJsonPath : null,
      direct_media_intake_report: directMediaIntakeEvidence.report_path,
      direct_media_intake_markdown: directMediaIntakeEvidence.markdown_path,
      licensed_direct_media_report: licensedDirectMediaJsonPath,
      licensed_direct_media_markdown: licensedDirectMediaMdPath,
      licensed_direct_media_intake_template: licensedDirectMediaTemplatePath,
      trailer_reference_report: trailerReferenceJsonPath,
      segment_validation_report: segmentValidationJsonPath,
      segment_validation_output_root: segmentValidationOutputRoot,
    },
    child_processes: childProcesses,
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
      gates_weakened: false,
    },
  };
  const reportPath = path.join(repairDir, "fresh_production_refill_repair_report.json");
  const markdownPath = path.join(repairDir, "fresh_production_refill_repair_report.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderFreshProductionRefillRepairMarkdown(report), "utf8");

  return {
    status: report.status,
    report_path: reportPath,
    markdown_path: markdownPath,
    official_source_entries_count: sourceEvidence.official_source_entries_count,
    accepted_official_source_count: sourceEvidence.accepted_official_source_count,
    child_processes: childProcesses,
    outputs: report.outputs,
  };
}

async function handleFreshProductionRefill(job, ctx) {
  const payload = (job && job.payload) || {};
  const limit = Math.max(1, Math.min(30, Number(payload.limit || 12) || 12));
  const rssPerFeed = Math.max(1, Math.min(10, Number(payload.rss_per_feed || 4) || 4));
  const generatedAt = new Date();
  const stamp = generatedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const outDir = clean(payload.out_dir) || `output/fresh-green-refill-${stamp}/goal-proof-batch`;
  const contractOutDir = clean(payload.contract_out_dir) || `output/fresh-green-refill-${stamp}/goal-contract`;
  const { main: runGoalBatchPackages } = require("../tools/goal-batch-packages");
  const args = [
    "--live-rss",
    "--rss-per-feed",
    String(rssPerFeed),
    "--limit",
    String(limit),
    "--out-dir",
    outDir,
    "--contract-out-dir",
    contractOutDir,
  ];
  let result = await runGoalBatchPackages(args);
  let summary = result?.batch?.summary || {};
  let outputs = result?.outputs || {};
  const log = (ctx && ctx.log) || console.log;
  log(
    `[fresh-production-refill] stories=${summary.story_count || 0} green=${summary.green_count || 0} red=${summary.red_count || 0}`,
  );
  const runChild = ctx?.runNodeJobChildProcess || runNodeJobChildProcess;
  const repairEvidence = payload.repair_evidence === false
    ? { status: "disabled", reason: "payload_repair_evidence_false" }
    : await buildFreshProductionRefillRepairEvidence({
        outputs,
        outDir,
        contractOutDir,
        redCount: Number(summary.red_count || 0),
        runChild,
        log,
      });
  let motionHydratedRefill = {
    status: "not_attempted",
    reason: "repair_motion_pack_unavailable",
  };
  const repairMotionPackIndex = clean(repairEvidence?.outputs?.motion_pack_index);
  if (
    repairEvidence &&
    !["disabled", "skipped", "not_needed"].includes(clean(repairEvidence.status)) &&
    repairMotionPackIndex
  ) {
    const repairMotionPackDir = path.dirname(repairMotionPackIndex);
    const hydratedArgs = [
      ...args,
      "--v4-motion-pack-dir",
      repairMotionPackDir,
    ];
    const hydratedResult = await runGoalBatchPackages(hydratedArgs);
    const hydratedSummary = hydratedResult?.batch?.summary || {};
    const hydratedOutputs = hydratedResult?.outputs || {};
    result = hydratedResult || result;
    summary = hydratedSummary;
    outputs = hydratedOutputs;
    motionHydratedRefill = {
      status: "completed",
      motion_pack_dir: repairMotionPackDir,
      story_count: Number(hydratedSummary.story_count || 0),
      green_count: Number(hydratedSummary.green_count || 0),
      red_count: Number(hydratedSummary.red_count || 0),
      outputs: hydratedOutputs,
    };
    log(
      `[fresh-production-refill] hydrated-motion stories=${motionHydratedRefill.story_count} green=${motionHydratedRefill.green_count} red=${motionHydratedRefill.red_count}`,
    );
  }
  return {
    status: "completed",
    story_count: Number(summary.story_count || 0),
    green_count: Number(summary.green_count || 0),
    red_count: Number(summary.red_count || 0),
    outputs,
    repair_evidence: repairEvidence,
    motion_hydrated_refill: motionHydratedRefill,
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
    },
  };
}

async function handleCompetitorForensicsLab(job, ctx) {
  const {
    buildCompetitorForensicsLab,
    writeCompetitorForensicsLab,
  } = require("./competitor-forensics-lab");
  const payload = (job && job.payload) || {};
  const outDir = path.join(__dirname, "..", "output", "competitor-forensics-lab");
  const report = await buildCompetitorForensicsLab({
    outputDir: outDir,
    collectPublicFeeds: payload.collect_public_feeds !== false,
    maxVideosPerChannel: Number(payload.max_videos_per_channel || 5),
    generatedAt: new Date().toISOString(),
  });
  await writeCompetitorForensicsLab(report, { outputDir: outDir });
  if (report.verdict === "FAIL") {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord([
        "**Pulse Competitor Forensics**",
        "Status: RED",
        `Channels reviewed: ${report.summary?.reviewed_channel_count || 0}`,
        `Videos assessed: ${report.summary?.assessed_video_count || 0}`,
        "Safety: metadata/pattern analysis only; no competitor assets copied.",
      ].join("\n"));
    } catch (err) {
      const log = (ctx && ctx.log) || console.log;
      log(`[competitor-forensics] discord notify failed: ${err.message}`);
    }
  }
  return {
    status: report.verdict,
    channels: report.summary?.reviewed_channel_count || 0,
    videos: report.summary?.assessed_video_count || 0,
    outliers: report.summary?.recent_outlier_count || 0,
    rules: report.summary?.pulse_upgrade_rule_count || 0,
  };
}

async function handleCompetitorQualityGate(job, ctx) {
  const {
    buildCompetitorInformedQualityGate,
    writeCompetitorInformedQualityGate,
  } = require("./competitor-informed-quality-gate");
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "output", "competitor-quality-gate");
  const storyPackages = await readJsonIfPresent(path.join(root, "output", "goal-contract", "story-packages.json"), []);
  const rulebook = await readJsonIfPresent(path.join(root, "output", "competitor-forensics-lab", "pulse_upgrade_rulebook.json"), {});
  const productionGrammar = await readJsonIfPresent(path.join(root, "output", "competitor-forensics-lab", "production_grammar_patterns.json"), {});
  const footageEmpireReport = await readJsonIfPresent(path.join(root, "output", "footage-empire-v2", "footage_empire_v2_report.json"), {});
  const report = await buildCompetitorInformedQualityGate({
    storyPackages: Array.isArray(storyPackages) ? storyPackages : [],
    rulebook,
    productionGrammar,
    footageEmpireReport,
    workspaceRoot: root,
    outputDir: outDir,
    generatedAt: new Date().toISOString(),
  });
  await writeCompetitorInformedQualityGate(report, { outputDir: outDir });
  if (report.verdict === "BLOCKED") {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord([
        "**Pulse Competitor Quality Gate**",
        "Status: RED",
        `Stories checked: ${report.summary?.story_count || 0}`,
        `GREEN: ${report.summary?.green_story_count || 0} | AMBER: ${report.summary?.amber_story_count || 0} | RED: ${report.summary?.red_story_count || 0}`,
        `Top blockers: ${Object.keys(report.blocker_counts || {}).slice(0, 4).join("; ") || "none"}`,
        "Safety: local proof only; no publish, no DB mutation, no copied competitor assets.",
      ].join("\n"));
    } catch (err) {
      const log = (ctx && ctx.log) || console.log;
      log(`[competitor-quality-gate] discord notify failed: ${err.message}`);
    }
  }
  return {
    status: report.verdict,
    green: report.summary?.green_story_count || 0,
    amber: report.summary?.amber_story_count || 0,
    red: report.summary?.red_story_count || 0,
    blockers: report.blocker_counts || {},
  };
}

async function handleCommercialLearningLoop(job, ctx) {
  const db = require("./db");
  const {
    runCommercialLearningLoop,
  } = require("./intelligence/commercial-learning-loop");
  const root = path.join(__dirname, "..");
  const stories = await db.getStories();
  const result = await runCommercialLearningLoop({
    clickLogPath: path.join(root, "data", "commercial_clicks.jsonl"),
    manifestDirs: [path.join(root, "output", "commercial")],
    outputDir: path.join(root, "data", "learning", "commercial"),
    stories,
  });
  return {
    status: result.digest.status,
    clicks: result.digest.totals?.clicks || 0,
    clicked_stories: result.digest.totals?.clicked_stories || 0,
    recommendations: Array.isArray(result.digest.recommendations)
      ? result.digest.recommendations.length
      : 0,
  };
}

async function handleAutonomousFeedbackMonitor(job, ctx) {
  const {
    formatAutonomousFeedbackDiscord,
    runAutonomousFeedbackMonitor,
  } = require("./ops/autonomous-feedback-monitor");
  const log = (ctx && ctx.log) || console.log;
  const payload = (job && job.payload) || {};
  const report = await runAutonomousFeedbackMonitor({
    postDiscord: false,
  });
  const followups = enqueueAutonomousFeedbackFollowups({
    report,
    job,
    ctx,
    payload,
  });
  const shouldNotify =
    payload.post_discord === true &&
    (process.env.AUTONOMOUS_FEEDBACK_DISCORD_ALWAYS === "true" ||
      report.verdict === "red" ||
      report.discord_feedback?.real_blocker_count > 0 ||
      report.ingested_discord_feedback?.summary?.blocking_count > 0 ||
      report.transcript_audience_feedback?.summary?.current_blocking_count > 0 ||
      report.post_window_feedback?.anomaly_count > 0);
  if (shouldNotify) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(formatAutonomousFeedbackDiscord(report));
    } catch (err) {
      log(`[autonomous-feedback-monitor] discord notify failed: ${err.message}`);
    }
  }
  return {
    status: report.verdict,
    action: report.current_action,
    ready_candidates: report.candidate_buffer.ready_candidates,
    discord_blockers: report.discord_feedback.real_blocker_count,
    post_window_anomalies: report.post_window_feedback.anomaly_count,
    next_window: report.scheduler.next_safe_publish_at_utc,
    followups_enqueued: followups.enqueued,
    followup_enqueue_errors: followups.errors,
  };
}

function enqueueAutonomousFeedbackFollowups({ report = {}, job = {}, ctx = {}, payload = {} } = {}) {
  const enqueued = [];
  const errors = [];
  if (payload.enqueue_followups === false || !ctx?.repos?.jobs) {
    return { enqueued, errors };
  }

  const generatedAt = new Date(report.generated_at || Date.now());
  const date = Number.isNaN(generatedAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : generatedAt.toISOString().slice(0, 10);
  const hour = Number.isNaN(generatedAt.getTime())
    ? String(new Date().getUTCHours()).padStart(2, "0")
    : String(generatedAt.getUTCHours()).padStart(2, "0");
  const channelId = job.channel_id || process.env.CHANNEL || "pulse-gaming";

  const readyCandidates = Number(report.candidate_buffer?.ready_candidates || 0);
  const sourceSafeCandidates = Number(report.candidate_buffer?.source_safe_candidates || 0);
  const v4ReadyCandidates = Number(report.candidate_buffer?.v4_ready_candidates || 0);
  const candidateSupplyVerdict = clean(report.market_intelligence?.candidate_supply?.verdict).toLowerCase();
  const candidateWarnings = Array.isArray(report.candidate_buffer?.warnings)
    ? report.candidate_buffer.warnings
    : [];
  const candidateNeedsRefill =
    readyCandidates < Number(payload.min_ready_candidates || 5) ||
    sourceSafeCandidates < Number(payload.min_source_safe_candidates || 3) ||
    v4ReadyCandidates < Number(payload.min_v4_ready_candidates || 3) ||
    candidateSupplyVerdict === "red" ||
    candidateSupplyVerdict === "amber" ||
    candidateWarnings.some((warning) => /below_target|runway|reserve|source_safe|v4_ready/i.test(String(warning)));

  const transcriptCurrentBlockers = Number(
    report.transcript_audience_feedback?.summary?.current_blocking_count ||
      report.transcript_audience_feedback?.summary?.current_candidate_rewrite_count ||
      0,
  );
  const ingestedBlocking = Number(report.ingested_discord_feedback?.summary?.blocking_count || 0);
  const directDiscordBlockers = Number(report.discord_feedback?.real_blocker_count || 0);
  const postWindowAnomalies = Number(report.post_window_feedback?.anomaly_count || 0);
  const repairableBacklog = Number(report.publish_runway_feedback?.repairable_backlog || 0);
  const safeRepairNeeded =
    ingestedBlocking > 0 ||
    directDiscordBlockers > 0 ||
    postWindowAnomalies > 0 ||
    repairableBacklog > 0 ||
    clean(report.current_action).startsWith("hold_scheduler");

  function enqueue(kind, itemPayload, priority, key) {
    try {
      ctx.repos.jobs.enqueue({
        kind,
        channel_id: channelId,
        payload: itemPayload,
        priority,
        idempotency_key: key,
      });
      enqueued.push({ kind, idempotency_key: key });
    } catch (err) {
      errors.push({ kind, idempotency_key: key, message: err.message });
      const log = (ctx && ctx.log) || console.log;
      log(`[autonomous-feedback-monitor] follow-up enqueue failed kind=${kind}: ${err.message}`);
    }
  }

  if (candidateNeedsRefill) {
    enqueue(
      "candidate_supply_monitor",
      {
        limit: Number(payload.candidate_supply_limit || 30),
        post_discord_on_amber: true,
        enqueue_repair_on_amber: true,
        enqueue_hunt_on_runway_gap: true,
        enqueue_fresh_review_script_repair: true,
        reason: "autonomous_feedback_monitor_candidate_supply_refill",
        source_ready_candidates: readyCandidates,
        source_safe_candidates: sourceSafeCandidates,
        source_v4_ready_candidates: v4ReadyCandidates,
      },
      64,
      `autonomous_feedback_candidate_supply:${date}:${hour}`,
    );
  }

  if (transcriptCurrentBlockers > 0 || ingestedBlocking > 0) {
    enqueue(
      "fresh_review_script_repair",
      {
        limit: Number(payload.fresh_review_script_repair_limit || 6),
        execute: payload.fresh_review_script_repair_execute !== false,
        reason: "autonomous_feedback_monitor_transcript_feedback",
        source_transcript_current_blockers: transcriptCurrentBlockers,
        source_ingested_discord_blockers: ingestedBlocking,
      },
      68,
      `autonomous_feedback_transcript_repair:${date}:${hour}`,
    );
  }

  if (safeRepairNeeded) {
    enqueue(
      "safe_auto_repair_runner",
      {
        limit: Number(payload.repair_limit || 8),
        execute: payload.repair_execute !== false,
        reason: "autonomous_feedback_monitor_safe_repair",
        source_repairable_backlog: repairableBacklog,
        source_post_window_anomalies: postWindowAnomalies,
        source_discord_blockers: directDiscordBlockers + ingestedBlocking,
      },
      69,
      `autonomous_feedback_safe_repair:${date}:${hour}`,
    );
  }

  return { enqueued, errors };
}

async function handleLocalTtsDoctor(job, ctx) {
  const payload = (job && job.payload) || {};
  const restart = payload.restart !== false;
  const prewarm = payload.prewarm !== false;
  const root = path.join(__dirname, "..");
  const resultPath = payload.result_path
    ? path.resolve(root, String(payload.result_path))
    : path.join(root, "test", "output", "local_tts_doctor.json");
  const args = ["tools/local-tts-doctor.js", "--json"];
  if (restart) args.push("--restart");
  if (prewarm) args.push("--prewarm");

  const runChild = ctx?.runNodeJobChildProcess || runNodeJobChildProcess;
  const childResult = await runChild({
    label: "local-tts-doctor",
    childKind: "local_tts_doctor",
    args,
    timeoutEnvName: "PULSE_LOCAL_TTS_DOCTOR_CHILD_TIMEOUT_MS",
    log: (ctx && ctx.log) || console.log,
  });

  const report = await readJsonIfPresent(resultPath, {});
  const status = clean(report.verdict || report.status || "completed").toLowerCase();
  return {
    status,
    restart_requested: restart,
    prewarm_requested: prewarm,
    ready: report.after?.status?.ready === true || report.ready === true,
    action: clean(report.action) || null,
    failure_code: clean(report.failure_code) || null,
    started_pid: report.started?.pid || null,
    prewarm_ok: report.prewarm?.ok === true,
    gpu_ok: report.gpu?.ok ?? null,
    report_path: resultPath,
    stdout_tail: clean(childResult?.stdout_tail).slice(-500),
    stderr_tail: clean(childResult?.stderr_tail).slice(-500),
  };
}

async function handleSafeAutoRepairRunner(job, ctx) {
  const payload = (job && job.payload) || {};
  const limit = Math.max(1, Math.min(20, Number(payload.limit || 5) || 5));
  const execute = payload.execute !== false;
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "output", "autonomous-feedback-monitor", "auto-repair-runner");
  const planPath = path.join(root, "test", "output", "publish_blocker_resolution.json");
  const resultPath = path.join(outDir, "auto_repair_run_results.json");
  const log = (ctx && ctx.log) || console.log;

  await runNodeJobChildProcess({
    label: "publish-blocker-resolution",
    childKind: "publish_blocker_resolution",
    args: ["tools/publish-blocker-resolution.js", "--json", "--limit", String(limit * 4)],
    timeoutEnvName: "PULSE_SAFE_AUTO_REPAIR_CHILD_TIMEOUT_MS",
    log,
  });

  const autoRepairArgs = [
    "tools/auto-repair-runner.js",
    "--plan",
    planPath,
    "--out-dir",
    outDir,
    "--limit",
    String(limit),
    "--json",
  ];
  if (execute) autoRepairArgs.push("--execute");

  await runNodeJobChildProcess({
    label: "safe-auto-repair-runner",
    childKind: "safe_auto_repair_runner",
    args: autoRepairArgs,
    timeoutEnvName: "PULSE_SAFE_AUTO_REPAIR_CHILD_TIMEOUT_MS",
    log,
  });

  const result = await readJsonIfPresent(resultPath, {});
  return {
    status: "completed",
    execution_requested: execute,
    limit,
    executed: result.summary?.executed || 0,
    no_effect: result.summary?.no_effect || 0,
    plan_generated: result.summary?.plan_generated || 0,
    failed: result.summary?.failed || 0,
    skipped_unsafe: result.summary?.skipped_unsafe || 0,
    safety: result.safety || {},
  };
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
  try {
    const sendDiscord = require("../notify");
    if (markdown) await sendDiscord(markdown);
  } catch (err) {
    (ctx && ctx.log ? ctx.log : console.log)(
      `[render-health-digest] discord notify failed: ${err.message}`,
    );
  }
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
  const summary = await verifier.runVerifyPass({ log });
  if (!summary.enabled) {
    return { enabled: false, skipped: "verifier_disabled_by_env" };
  }
  // Discord notify only when something interesting happened so the
  // healthy idle path is silent.
  if (summary.finished > 0 || summary.expired_or_error > 0) {
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
  const tiktokDisabled =
    /^(false|0|no|off)$/i.test(String(process.env.TIKTOK_ENABLED || "").trim()) ||
    /^(false|0|no|off)$/i.test(String(process.env.TIKTOK_AUTO_UPLOAD_ENABLED || "").trim());
  if (tiktokDisabled) {
    if (ctx.log) ctx.log("[tiktok_auth_check] skipped: operator_disabled");
    return {
      skipped: "operator_disabled",
      refresh_attempted: false,
      refresh_ok: false,
      needs_reauth: false,
    };
  }

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
    }
  } else if (
    typeof inspect.expires_in_seconds === "number" &&
    inspect.expires_in_seconds <= REFRESH_IF_LESS_THAN_SECONDS
  ) {
    // Token still valid but close to expiry — refresh now so the
    // publish window doesn't cross the boundary with a stale token.
    result.refresh_attempted = true;
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
  }

  if (alerts.length > 0) {
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
  }

  return result;
}

async function handleJobsReap(job, ctx) {
  const { jobs } = ctx.repos;
  const changed = jobs.reapStaleClaims();
  return { reclaimed: changed };
}

async function handleScoringDigest(job, ctx) {
  const {
    getScoringDigest,
    buildScoringDigestMessage,
  } = require("./observability");
  const hours = (job.payload && job.payload.hours) || 24;
  const summary = getScoringDigest({ repos: ctx.repos, sinceHours: hours });
  try {
    const sendDiscord = require("../notify");
    await sendDiscord(buildScoringDigestMessage(summary));
  } catch (err) {
    ctx.log && ctx.log(`scoring_digest notify error: ${err.message}`);
  }
  return {
    scored: summary.scored,
    by_decision: summary.by_decision,
    avg_total: summary.avg_total,
  };
}

// Phase 7 derivative handlers — all delegate to lib/repurpose.runDerivative.
async function handleDerivative(job, ctx) {
  const { runDerivative } = require("./repurpose");
  return runDerivative(job, ctx);
}

// Fan out a just-published roundup into its derivative rows + jobs.
async function handleRoundupFanout(job, ctx) {
  const { fanoutRoundup } = require("./repurpose");
  const roundupId = job.payload && job.payload.roundup_id;
  if (!roundupId)
    throw new Error("[roundup_fanout] payload.roundup_id required");
  return fanoutRoundup({
    repos: ctx.repos,
    roundupId,
    channelId: job.channel_id || process.env.CHANNEL || "pulse-gaming",
    log: {
      log: (m) => ctx.log && ctx.log(m),
      error: (m) => ctx.log && ctx.log("ERROR: " + m),
    },
  });
}

const handlers = {
  hunt: handleHunt,
  produce: handleProduce,
  publish: handlePublish,
  engage: handleEngage,
  engage_first_hour: handleEngageFirstHour,
  analytics: handleAnalytics,
  studio_analytics_loop: handleStudioAnalyticsLoop,
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
  publish_window_watchdog: handlePublishWindowWatchdog,
  render_health_digest: handleRenderHealthDigest,
  overnight_produce_sweep: handleOvernightProduceSweep,
  overnight_analytics_backfill: handleOvernightAnalyticsBackfill,
  overnight_claude_analyst: handleOvernightClaudeAnalyst,
  overnight_morning_digest: handleOvernightMorningDigest,
  live_performance_analyst: handleLivePerformanceAnalyst,
  continuous_learning_loop: handleContinuousLearningLoop,
  candidate_supply_monitor: handleCandidateSupplyMonitor,
  fresh_review_script_repair: handleFreshReviewScriptRepair,
  fresh_production_refill: handleFreshProductionRefill,
  competitor_forensics_lab: handleCompetitorForensicsLab,
  competitor_quality_gate: handleCompetitorQualityGate,
  commercial_learning_loop: handleCommercialLearningLoop,
  autonomous_feedback_monitor: handleAutonomousFeedbackMonitor,
  local_tts_doctor: handleLocalTtsDoctor,
  safe_auto_repair_runner: handleSafeAutoRepairRunner,
  tiktok_auth_check: handleTiktokAuthCheck,
  jobs_reap: handleJobsReap,
  scoring_digest: handleScoringDigest,
};

module.exports = {
  handlers,
  renderPublishSummary,
  renderGuardedLiveDispatchSummary,
  guardedPublishResultShouldFailJob,
  guardedPublishFailureMessage,
  guardedLivePublishArmed,
  readGuardedLiveExecutorPlanForScheduler,
  handlePublishWindowWatchdog,
  handleGuardedLiveDispatchPublish,
  runNodeJobChildProcess,
  runProduceChildProcess,
  runAnalyticsChildProcess,
  CORE_PLATFORMS,
  OPTIONAL_PLATFORMS,
  FALLBACK_POSTS,
};
