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
const { createHash } = require("node:crypto");
const fs = require("fs-extra");
const fsp = require("node:fs/promises");
const { spawn: defaultSpawn } = require("node:child_process");
const { skipAnthropicDependentJob } = require("./llm-key");
const { mediaSourceUrlKindFields } = require("./media-source-url-kind");
const {
  hasPublicPlatformEvidence,
} = require("./services/platform-evidence-status");
const {
  internalReadableHoldFloorS,
  MIN_HYPERFRAMES_READABLE_HOLD_S,
} = require("./studio/v2/premium-card-lane-v2");

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

function sha256Text(value) {
  return createHash("sha256").update(clean(value), "utf8").digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const FRESH_REFILL_HYPERFRAMES_CARD_KINDS = [
  "source",
  "context",
  "timeline",
  "quote",
  "takeaway",
  "outro",
];
const FRESH_REFILL_DIRECT_MEDIA_MAX_CANDIDATES_PER_ENTRY = 12;
const FRESH_REFILL_REAL_MOTION_MAX_CLIPS = 10;

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function childProcessExitCode(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const code = source.exit_code ?? source.exitCode ?? source.code;
    if (code === null || code === undefined || code === "") continue;
    const number = Number(code);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normaliseJobChildProcessEvidence({
  childKind,
  args = [],
  result = null,
  error = null,
} = {}) {
  const failedByError = Boolean(error);
  const ok = !failedByError && result?.ok !== false;
  const exitCode = childProcessExitCode(result, error);
  const signal = clean(result?.signal ?? error?.signal) || null;
  const timedOut = Boolean(
    result?.timed_out ||
      result?.timedOut ||
      result?.timeout ||
      error?.timed_out ||
      error?.timedOut ||
      error?.timeout,
  );
  const stdoutTail = clean(result?.stdout_tail ?? result?.stdoutTail ?? error?.stdout_tail ?? error?.stdoutTail).slice(-2000);
  const stderrTail = clean(result?.stderr_tail ?? result?.stderrTail ?? error?.stderr_tail ?? error?.stderrTail).slice(-2000);
  const errorMessage = clean(
    error?.message ||
      result?.error?.message ||
      result?.error,
  ).slice(0, 500);
  let failureReason = null;
  if (!ok) {
    if (timedOut) failureReason = "timed_out";
    else if (exitCode !== null) failureReason = `exit_code_${exitCode}`;
    else if (signal) failureReason = `signal_${signal}`;
    else if (errorMessage) failureReason = "error";
    else failureReason = "failed_without_process_detail";
  }

  return {
    child_kind: clean(childKind || result?.child_kind || error?.child_kind) || "unknown_child_process",
    ok,
    args: Array.isArray(args) ? args : [],
    exit_code: exitCode,
    signal,
    timed_out: timedOut,
    failure_reason: failureReason,
    actionable_diagnostic: !ok && failureReason !== "failed_without_process_detail",
    stdout_tail: stdoutTail,
    stderr_tail: stderrTail,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

function annotateChildProcessError(err, fields = {}) {
  if (!err || typeof err !== "object") return err;
  for (const [key, value] of Object.entries(fields)) {
    err[key] = value;
  }
  return err;
}

function internalHyperframesReadableHoldFloorS({ readableText = "", wordCount = null, kind = "context" } = {}) {
  const floor = internalReadableHoldFloorS({ readableText, wordCount, kind });
  return Number.isFinite(Number(floor))
    ? Number(floor)
    : MIN_HYPERFRAMES_READABLE_HOLD_S;
}

function channelSuffix(channelId = "pulse-gaming") {
  return channelId && channelId !== "pulse-gaming" ? `__${channelId}` : "";
}

function hyperframesCardPathForStory({ storyId, kind, channelId = "pulse-gaming" } = {}) {
  if (!storyId || !kind) return null;
  return path.join(
    ROOT,
    "test",
    "output",
    `hf_${kind}_card_${storyId}${channelSuffix(channelId)}.mp4`,
  );
}

function hyperframesShellSidecarPathForCard(cardPath) {
  if (!cardPath) return null;
  return cardPath.replace(/\.[^.]+$/i, ".shell.json");
}

function readabilityEvidenceFromHyperframesShell(shell = {}) {
  const contract =
    shell.readability_contract ||
    shell.card_readability_contract ||
    shell.readability ||
    {};
  const evidence = contract.evidence || contract || {};
  return {
    status: clean(contract.status || contract.verdict || ""),
    readable_text: clean(evidence.readable_text || evidence.text || ""),
    word_count: firstFiniteNumber(evidence.word_count),
    planned_visible_duration_s: firstFiniteNumber(
      evidence.planned_visible_duration_s,
      evidence.visible_duration_s,
      evidence.duration_s,
      evidence.durationS,
    ),
    minimum_visible_duration_s: firstFiniteNumber(
      evidence.minimum_visible_duration_s,
      evidence.minimum_readable_duration_s,
      evidence.min_duration_s,
    ),
    min_readable_card_duration_s: firstFiniteNumber(evidence.min_readable_card_duration_s),
    max_readable_card_duration_s: firstFiniteNumber(evidence.max_readable_card_duration_s),
  };
}

async function collectFreshRefillHyperframesCardStoryEvidence({
  storyId,
  channelId = "pulse-gaming",
} = {}) {
  const cards = [];
  const blockers = [];
  for (const kind of FRESH_REFILL_HYPERFRAMES_CARD_KINDS) {
    const cardPath = hyperframesCardPathForStory({ storyId, kind, channelId });
    const sidecarPath = hyperframesShellSidecarPathForCard(cardPath);
    const cardExists = cardPath ? await fs.pathExists(cardPath) : false;
    const sidecarExists = sidecarPath ? await fs.pathExists(sidecarPath) : false;
    let sidecar = null;
    if (sidecarExists) {
      sidecar = await readJsonIfPresent(sidecarPath, null);
    }
    const shell = sidecar?.hyperframes_premium_shell || sidecar?.premium_shell || {};
    const readability = readabilityEvidenceFromHyperframesShell(shell);
    const cardBlockers = [
      ...(!cardExists ? ["hyperframes_card_missing"] : []),
      ...(!sidecarExists ? ["hyperframes_premium_shell_sidecar_missing"] : []),
      ...(sidecarExists && !sidecar ? ["hyperframes_premium_shell_sidecar_unreadable"] : []),
      ...(Array.isArray(shell.blockers) ? shell.blockers : []),
    ];
    if (!readability.status) cardBlockers.push("hyperframes_readability_contract_missing");
    else if (readability.status && !/^pass(?:ed)?$/i.test(readability.status)) {
      cardBlockers.push("hyperframes_readability_contract_not_passed");
    }
    if (readability.planned_visible_duration_s == null) {
      cardBlockers.push("hyperframes_readable_hold_duration_missing");
    }
    if (readability.minimum_visible_duration_s == null) {
      cardBlockers.push("hyperframes_readable_hold_minimum_missing");
    }
    if (
      readability.planned_visible_duration_s != null &&
      readability.minimum_visible_duration_s != null &&
      readability.planned_visible_duration_s + 0.001 < readability.minimum_visible_duration_s
    ) {
      cardBlockers.push("hyperframes_readable_hold_too_short");
    }
    const internalHoldFloor = internalHyperframesReadableHoldFloorS({
      readableText: readability.readable_text,
      wordCount: readability.word_count,
      kind,
    });
    readability.internal_readable_hold_floor_s = internalHoldFloor;
    if (
      readability.planned_visible_duration_s != null &&
      readability.planned_visible_duration_s + 0.001 < internalHoldFloor
    ) {
      cardBlockers.push("hyperframes_readable_hold_below_internal_floor");
    }
    const uniqueCardBlockers = uniqueClean(cardBlockers);
    blockers.push(...uniqueCardBlockers.map((blocker) => `${kind}:${blocker}`));
    cards.push({
      kind,
      status: uniqueCardBlockers.length ? "fail" : "pass",
      card_path: cardPath ? path.relative(ROOT, cardPath).replace(/\\/g, "/") : null,
      sidecar_path: sidecarPath ? path.relative(ROOT, sidecarPath).replace(/\\/g, "/") : null,
      card_exists: cardExists,
      sidecar_exists: sidecarExists,
      readability,
      blockers: uniqueCardBlockers,
    });
  }
  const passingCards = cards.filter((card) => card.status === "pass");
  const visibleDurations = cards
    .map((card) => card.readability?.planned_visible_duration_s)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  const requiredDurations = cards
    .map((card) => card.readability?.minimum_visible_duration_s)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  return {
    story_id: storyId,
    status: blockers.length ? "blocked" : "completed",
    card_count: cards.length,
    passing_card_count: passingCards.length,
    failing_card_count: cards.length - passingCards.length,
    shortest_planned_visible_duration_s: visibleDurations.length
      ? Number(Math.min(...visibleDurations).toFixed(3))
      : null,
    longest_required_visible_duration_s: requiredDurations.length
      ? Number(Math.max(...requiredDurations).toFixed(3))
      : null,
    blockers: uniqueClean(blockers),
    cards,
  };
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

function freshRefillNarrationProviderPreference({ payload = {}, env = process.env } = {}) {
  const explicit = clean(
    payload.tts_provider_preference ||
      payload.tts_provider ||
      payload.narration_provider ||
      payload.audio_provider ||
      env.PULSE_FRESH_REFILL_TTS_PROVIDER,
  ).toLowerCase();
  if (explicit === "elevenlabs") return "elevenlabs";
  if (explicit === "local") return "local";
  if (
    truthy(payload.allow_elevenlabs_tts) ||
    truthy(env.PULSE_FRESH_REFILL_ALLOW_ELEVENLABS_TTS) ||
    truthy(env.PULSE_ALLOW_ELEVENLABS_TTS_FOR_REFILL)
  ) {
    return "elevenlabs";
  }
  return "local";
}

function freshRefillProviderCommand(command, provider) {
  const base = clean(command);
  const selected = clean(provider).toLowerCase();
  if (!base || !["elevenlabs", "local"].includes(selected)) return base || null;
  if (/\s--tts-provider(?:=|\s+)/.test(base)) return base;
  return `${base} --tts-provider ${selected}`;
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
          annotateChildProcessError(
            new Error(`${label} child process timed out after ${timeoutMs}ms`),
            {
              child_kind: childKind || label,
              timed_out: true,
              timeout_ms: timeoutMs,
              signal: "SIGTERM",
              stdout_tail: stdoutTail,
              stderr_tail: stderrTail,
            },
          ),
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
      finish(() =>
        reject(
          annotateChildProcessError(err, {
            child_kind: childKind || label,
            spawn_error: true,
            stdout_tail: stdoutTail,
            stderr_tail: stderrTail,
          }),
        ),
      );
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
        reject(
          annotateChildProcessError(
            new Error(`${label} child process failed with ${suffix}: ${detail}`),
            {
              child_kind: childKind || label,
              exit_code: exitCode,
              signal: signal || null,
              stdout_tail: stdoutTail,
              stderr_tail: stderrTail,
            },
          ),
        );
      });
    });
  });
}

function runProduceChildProcess(options = {}) {
  const storyId = clean(options.storyId);
  const childOptions = { ...options };
  delete childOptions.storyId;
  return runNodeJobChildProcess({
    label: "produce",
    args: [
      "run.js",
      "produce",
      ...(storyId ? ["--story-id", storyId] : []),
    ],
    childKind: "produce",
    timeoutEnvName: "PULSE_PRODUCE_CHILD_TIMEOUT_MS",
    ...childOptions,
  });
}

const DEFAULT_PRODUCE_STORY_MAX_AGE_HOURS = 72;
const DEFAULT_PRODUCE_CHAIN_MAX_STORIES = 5;
const RETRYABLE_PRODUCE_FAILURE_RE =
  /(?:audio_generation_failed|server_down|tts[^:]*timeout|timed?_out|econn(?:refused|reset)|gpu_(?:busy|unavailable)|worker_(?:lost|unavailable)|missing_(?:audio|image|video)|(?:audio|image|render)_generation_failed)/i;

function parseProduceStoryTime(value) {
  const raw = clean(value);
  if (!raw) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function produceStoryTimeMs(story = {}) {
  for (const value of [
    story.source_published_at,
    story.timestamp,
    story.created_at,
  ]) {
    const parsed = parseProduceStoryTime(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function produceStoryHasRetryableFailure(story = {}) {
  const failures = [
    story.publish_error,
    ...asArray(story.qa_failures),
  ]
    .map(clean)
    .filter(Boolean)
    .join(" | ");
  return RETRYABLE_PRODUCE_FAILURE_RE.test(failures);
}

function isTruthyStoryFlag(value) {
  return value === true || value === 1 || value === "1";
}

function selectNextProduceStory(
  stories,
  {
    now = new Date(),
    maxAgeHours = DEFAULT_PRODUCE_STORY_MAX_AGE_HOURS,
    excludedStoryIds = [],
    env = process.env,
  } = {},
) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const boundedNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const boundedMaxAgeHours =
    Number.isFinite(Number(maxAgeHours)) && Number(maxAgeHours) > 0
      ? Number(maxAgeHours)
      : DEFAULT_PRODUCE_STORY_MAX_AGE_HOURS;
  const oldestAllowedMs =
    boundedNowMs - boundedMaxAgeHours * 60 * 60 * 1000;
  const excluded = new Set(asArray(excludedStoryIds).map(clean).filter(Boolean));

  return (
    asArray(stories)
      .filter((story) => {
        if (!story || !clean(story.id) || excluded.has(clean(story.id))) {
          return false;
        }
        if (!isTruthyStoryFlag(story.approved)) return false;
        if (hasPublicPlatformEvidence(story, { env })) return false;
        if (clean(story.exported_path)) return false;
        if (
          !clean(
            story.tts_script ||
              story.full_script ||
              [story.hook, story.body, story.loop].filter(Boolean).join(" "),
          )
        ) {
          return false;
        }
        const sourceTimeMs = produceStoryTimeMs(story);
        if (sourceTimeMs === null || sourceTimeMs < oldestAllowedMs) {
          return false;
        }
        const failed =
          isTruthyStoryFlag(story.qa_failed) ||
          /^failed$/i.test(clean(story.publish_status));
        return !failed || produceStoryHasRetryableFailure(story);
      })
      .sort((left, right) => {
        const timeDelta =
          (produceStoryTimeMs(right) || 0) - (produceStoryTimeMs(left) || 0);
        if (timeDelta !== 0) return timeDelta;
        return clean(left.id).localeCompare(clean(right.id));
      })[0] || null
  );
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
  let storyId = clean(job?.story_id || job?.payload?.story_id);
  const queuedStory = Boolean(storyId);
  let selectionMode = "queued_story";
  const getStories =
    typeof ctx?.getStories === "function"
      ? ctx.getStories
      : require("./db").getStories;
  if (!storyId) {
    const stories = await getStories();
    const selected = selectNextProduceStory(stories, {
      now: ctx?.now || new Date(),
      maxAgeHours:
        Number(process.env.PULSE_PRODUCE_MAX_STORY_AGE_HOURS) ||
        DEFAULT_PRODUCE_STORY_MAX_AGE_HOURS,
      excludedStoryIds: job?.payload?.attempted_story_ids,
    });
    if (!selected) {
      ctx.log &&
        ctx.log(
          "[produce] skipped: no fresh approved unpublished story requires production",
        );
      return {
        ok: true,
        skipped: true,
        reason: "no_fresh_eligible_story",
      };
    }
    storyId = clean(selected.id);
    selectionMode = "fresh_scheduler_selection";
  }
  ctx.log &&
    ctx.log(
      `[produce] starting isolated child process for ${storyId} (${selectionMode})`,
    );
  const result = await runProduceChildProcess({ log: ctx.log, storyId });
  const configuredChainLimit = positiveInteger(
    process.env.PULSE_PRODUCE_CHAIN_MAX_STORIES,
    DEFAULT_PRODUCE_CHAIN_MAX_STORIES,
  );
  const chainRemaining = positiveInteger(
    job?.payload?.chain_remaining,
    queuedStory ? 1 : configuredChainLimit,
  );
  let continuationJob = null;
  if (
    chainRemaining > 1 &&
    ctx?.repos?.jobs &&
    typeof ctx.repos.jobs.enqueue === "function"
  ) {
    const attemptedStoryIds = uniqueClean([
      ...asArray(job?.payload?.attempted_story_ids),
      storyId,
    ]);
    const refreshedStories = await getStories();
    const nextStory = selectNextProduceStory(refreshedStories, {
      now: ctx?.now || new Date(),
      maxAgeHours:
        Number(process.env.PULSE_PRODUCE_MAX_STORY_AGE_HOURS) ||
        DEFAULT_PRODUCE_STORY_MAX_AGE_HOURS,
      excludedStoryIds: attemptedStoryIds,
    });
    if (nextStory) {
      const rootJobId =
        positiveInteger(job?.payload?.chain_root_job_id, null) || job?.id;
      const nextStoryId = clean(nextStory.id);
      continuationJob = ctx.repos.jobs.enqueue({
        kind: "produce",
        channel_id: job?.channel_id || null,
        story_id: nextStoryId,
        payload: {
          story_id: nextStoryId,
          chain_root_job_id: rootJobId,
          chain_remaining: chainRemaining - 1,
          attempted_story_ids: attemptedStoryIds,
          reason: "story_scoped_produce_continuation",
        },
        priority: Number.isFinite(Number(job?.priority))
          ? Number(job.priority)
          : 30,
        requires_gpu: Boolean(job?.requires_gpu),
        max_attempts: positiveInteger(job?.max_attempts, 3),
        idempotency_key: `produce:story-chain:${rootJobId}:${nextStoryId}`,
      });
      ctx.log &&
        ctx.log(
          `[produce] queued story-scoped continuation #${continuationJob.id} for ${nextStoryId}`,
        );
    }
  }
  return {
    ...result,
    story_id: storyId,
    selection_mode: selectionMode,
    continuation_job_id: continuationJob?.id || null,
    continuation_story_id: continuationJob?.story_id || null,
  };
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
    const safeError = safeFailureSummary(action.error);
    if (safeError) lines.push(`Error:     ${safeError}`);
    if (Array.isArray(action.blockers) && action.blockers.length) {
      lines.push(`Blockers:  ${action.blockers.join(", ")}`);
    }
  }
  const uploadAttempts = Number(report.summary?.upload_attempt_count || 0);
  const uploadSuccesses = Number(
    report.summary?.upload_success_count ?? report.summary?.upload_attempt_count ?? 0,
  );
  const networkAttempts = Number(
    report.summary?.network_attempt_count ?? report.summary?.upload_attempt_count ?? 0,
  );
  lines.push(`Attempts:  ${uploadAttempts}`);
  lines.push(`Uploads:   ${uploadSuccesses}`);
  lines.push(`Network:   ${networkAttempts}`);
  lines.push(`DB writes:  ${report.summary?.db_mutation_count || 0}`);
  return {
    status: String(report.verdict || "unknown").toLowerCase(),
    message: lines.join("\n"),
  };
}

function safeFailureSummary(value) {
  return clean(value)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(
      /\b(access_token|refresh_token|api_key|client_secret)\b\s*[:=]\s*["']?[^,\s&"'}]+["']?/gi,
      "$1=<redacted>",
    )
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "<redacted>")
    .replace(/\s+/g, " ")
    .slice(0, 400);
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

function safeFailureToken(value) {
  const redacted = clean(value)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(/\b(access_token|refresh_token|api_key|key|code)=[^\s&"']+/gi, "$1=<redacted>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>");
  if (!redacted) return "";
  return redacted
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
}

function guardedPublishFailureDetail(result = {}) {
  const direct = clean(result.failure_code) || clean(result.error) || clean(result.top_error);
  if (direct) return safeFailureToken(direct);
  const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
  for (const outcome of outcomes) {
    const detail = clean(outcome.failure_code) || clean(outcome.error);
    const token = safeFailureToken(detail);
    if (token) return token;
  }
  return "";
}

function guardedPublishFailureMessage(result = {}) {
  const action = clean(result.action_id) || clean(result.story_id) || "none";
  const reason =
    clean(result.reason) ||
    clean(result.outcome) ||
    clean(result.status) ||
    "guarded_publish_window_without_upload";
  const detail = guardedPublishFailureDetail(result);
  const reasonToken = safeFailureToken(reason) || "guarded_publish_window_without_upload";
  return `guarded_publish_window_failed:${action}:${reasonToken}${detail && detail !== reasonToken ? `:${detail}` : ""}`;
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

async function handleGuardedLiveDispatchPublish(job, ctx, options = {}) {
  const executorPlanPath = process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH ||
    path.join(__dirname, "..", "output", "goal-contract", "guarded_dispatch_executor_plan.json");

  const {
    selectNextGuardedLiveAction,
    runGuardedLiveDispatchExecutor,
    writeGuardedLiveDispatchExecutorReport,
  } = require("./goal-guarded-live-dispatch-executor");
  const db = require("./db");
  const generatedAt = new Date().toISOString();
  const executorPlan = options.executorPlan ||
    options.executor_plan ||
    await readGuardedLiveExecutorPlanForScheduler(executorPlanPath, generatedAt);
  if (
    options.requireImmutableRunway === true &&
    !options.executorPlan &&
    !options.executor_plan
  ) {
    throw new Error(
      "immutable_publish_runway_executor_plan_missing:mutable_global_fallback_forbidden",
    );
  }
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
      error: clean(item.error),
      failure_code: clean(item.failure_code),
    })),
    error: clean(action?.error),
    failure_code: clean(action?.failure_code),
    upload_attempt_count: report.summary?.upload_attempt_count || 0,
    db_mutation_count: report.summary?.db_mutation_count || 0,
    immutable_runway_generation_id:
      clean(
        options.immutableRunway?.generation?.generation_id ||
        options.immutable_runway?.generation?.generation_id,
      ) || null,
    mutable_global_fallback_used:
      options.requireImmutableRunway === true ? false : null,
  };
  if (guardedPublishResultShouldFailJob(result)) {
    throw new Error(guardedPublishFailureMessage(result));
  }
  return result;
}

function isStrictPublishRunwayDeficit(error) {
  if (clean(error?.code) !== "RUNWAY_RECONCILIATION_NOT_STRICT_GREEN") {
    return false;
  }
  const reconciliation = error?.reconciliation || {};
  return (
    Number(reconciliation.summary?.runway_shortfall || 0) > 0 ||
    Number(reconciliation.summary?.reserve_shortfall || 0) > 0
  );
}

function publishRunwayRecoveryWindowId({ job = {}, evidence = {} } = {}) {
  return clean(
    evidence.window?.window_id ||
      evidence.window?.id ||
      evidence.window_id ||
      job.payload?.window_id ||
      job.payload?.window_label,
  );
}

function publishRunwayRecoveryKeyPart(value) {
  return clean(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 120) || "unknown-window";
}

function queuedRecoveryState(job) {
  const status = clean(job?.status).toLowerCase();
  const knownActive = ["pending", "claimed", "running"].includes(status);
  return {
    active: Boolean(job?.id) && (!status || knownActive),
    verifiable: Boolean(job?.id) && knownActive,
  };
}

function boundedPublishRunwayMinutes(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.round(number)));
}

function publishRunwayRecoveryTiming(payload = {}, now = new Date()) {
  const requestedCompletion = clean(
    payload.candidate_recovery_expected_completion_at ||
      payload.fresh_production_refill_expected_completion_at ||
      payload.expected_production_completion_at,
  );
  const parsedCompletion = requestedCompletion
    ? new Date(requestedCompletion)
    : null;
  const recoveryMinutes = boundedPublishRunwayMinutes(
    payload.candidate_recovery_expected_duration_minutes ||
      payload.fresh_production_refill_expected_duration_minutes ||
      payload.expected_production_duration_minutes,
    45,
    120,
  );
  const expectedCompletion =
    parsedCompletion && Number.isFinite(parsedCompletion.getTime())
      ? parsedCompletion
      : new Date(now.getTime() + recoveryMinutes * 60_000);
  const verificationDelayMinutes = boundedPublishRunwayMinutes(
    payload.candidate_recovery_verification_delay_minutes,
    5,
    30,
  );
  const verificationAt = new Date(
    expectedCompletion.getTime() + verificationDelayMinutes * 60_000,
  );
  return {
    expected_production_completion_at: expectedCompletion.toISOString(),
    verification_run_at: verificationAt
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, ""),
  };
}

function enqueuePublishRunwayCandidateRecovery({
  job,
  ctx,
  phase,
  phaseScheduledAt,
  reason,
  shortfalls = {},
  windowId,
  legacyIdempotencyKey,
} = {}) {
  const payload = job?.payload || {};
  if (
    payload.enqueue_candidate_refill_on_runway === false ||
    !ctx?.repos?.jobs
  ) {
    return {
      active: false,
      job: null,
      verification_active: false,
      verification_error: null,
      verification_job: null,
      verification_run_at: null,
    };
  }
  const normalisedPhase = clean(phase).toUpperCase() || "T-180";
  const timing = publishRunwayRecoveryTiming(payload);
  const exactWindowKey = clean(windowId)
    ? `publish_window_candidate_recovery:${publishRunwayRecoveryKeyPart(windowId)}`
    : legacyIdempotencyKey;
  const recoveryJob = ctx.repos.jobs.enqueue({
    kind: "candidate_supply_monitor",
    channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
    payload: {
      limit: Number(payload.candidate_monitor_limit || 30),
      post_discord_on_red: true,
      post_discord_on_amber: true,
      enqueue_repair_on_amber: true,
      enqueue_hunt_on_runway_gap: true,
      enqueue_fresh_review_script_repair: true,
      enqueue_fresh_production_refill: true,
      enqueue_local_tts_retry_recovery: true,
      fresh_review_script_repair_limit: Number(
        payload.fresh_review_script_repair_limit || 6,
      ),
      fresh_production_refill_limit: Number(
        payload.fresh_production_refill_limit || 12,
      ),
      fresh_production_refill_rss_per_feed: Number(
        payload.fresh_production_refill_rss_per_feed || 4,
      ),
      fresh_production_refill_tts_provider:
        clean(payload.fresh_production_refill_tts_provider) || "elevenlabs",
      local_tts_retry_limit: Number(payload.local_tts_retry_limit || 6),
      local_tts_retry_apply_limit: Number(
        payload.local_tts_retry_apply_limit || 3,
      ),
      repair_limit: Number(payload.repair_limit || 8),
      reason,
      source_window_id: windowId || null,
      source_window_label: payload.window_label || null,
      source_phase: normalisedPhase,
      expected_production_completion_at:
        timing.expected_production_completion_at,
      source_runway_shortfall: Number(shortfalls.runway || 0),
      source_reserve_shortfall: Number(shortfalls.reserve || 0),
    },
    priority: 70,
    idempotency_key: exactWindowKey,
  });
  const state = queuedRecoveryState(recoveryJob);
  let verificationJob = null;
  let verificationError = null;
  if (state.verifiable) {
    try {
      const queuedTiming = publishRunwayRecoveryTiming({
        ...payload,
        candidate_recovery_expected_completion_at:
          recoveryJob.payload?.expected_production_completion_at ||
          timing.expected_production_completion_at,
      });
      verificationJob = ctx.repos.jobs.enqueue({
        kind:
          normalisedPhase === "T-180"
            ? "publish_runway_generate"
            : "publish_window_watchdog",
        channel_id:
          job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          ...payload,
          phase: normalisedPhase,
          phase_scheduled_at_utc:
            clean(payload.phase_scheduled_at_utc || phaseScheduledAt) || null,
          reason: "publish_window_candidate_recovery_verification",
          candidate_recovery_job_id: recoveryJob.id,
          expected_production_completion_at:
            queuedTiming.expected_production_completion_at,
          source_window_id: windowId || null,
          source_window_label: payload.window_label || null,
          enqueue_repair_on_runway: false,
          enqueue_candidate_refill_on_runway: false,
        },
        priority: Number(
          payload.candidate_recovery_verification_priority ||
            (normalisedPhase === "T-180" ? 14 : 15),
        ),
        max_attempts: 1,
        run_at: queuedTiming.verification_run_at,
        idempotency_key:
          `publish_window_candidate_recovery_verify:` +
          `${publishRunwayRecoveryKeyPart(windowId)}:` +
          publishRunwayRecoveryKeyPart(recoveryJob.id),
      });
      timing.verification_run_at = queuedTiming.verification_run_at;
    } catch (error) {
      verificationError = error.message;
    }
  }
  return {
    active: state.active,
    job: recoveryJob,
    verification_active: queuedRecoveryState(verificationJob).active,
    verification_error: verificationError,
    verification_job: verificationJob,
    verification_run_at: state.verifiable
      ? timing.verification_run_at
      : null,
  };
}

async function handlePublishRunwayGenerate(job, ctx) {
  const {
    generateRunwayForJob,
  } = require("./ops/publish-runway-job-runtime");
  let report;
  try {
    report = await generateRunwayForJob({
      job,
      env: process.env,
      repoRoot: path.join(__dirname, ".."),
    });
  } catch (error) {
    if (isStrictPublishRunwayDeficit(error)) {
      try {
        const reconciliation = error.reconciliation || {};
        const windowId = publishRunwayRecoveryWindowId({
          job,
          evidence: reconciliation,
        });
        const recovery = enqueuePublishRunwayCandidateRecovery({
          job,
          ctx,
          phase: "T-180",
          phaseScheduledAt: reconciliation.generated_at,
          reason: "publish_runway_strict_deficit_recovery",
          shortfalls: {
            runway: reconciliation.summary?.runway_shortfall,
            reserve: reconciliation.summary?.reserve_shortfall,
          },
          windowId,
        });
        if (recovery.job) {
          error.candidate_recovery_job_id = recovery.job.id || null;
          error.candidate_recovery_verification_job_id =
            recovery.verification_job?.id || null;
          if (recovery.verification_error) {
            error.candidate_recovery_verification_enqueue_error =
              recovery.verification_error;
          }
          ctx?.log &&
            ctx.log(
              `[publish_runway_generate] strict deficit recovery job=${recovery.job.id || "unknown"} ` +
              `verification=${recovery.verification_job?.id || "not_scheduled"}`,
            );
        }
      } catch (enqueueError) {
        error.candidate_recovery_enqueue_error = enqueueError.message;
        ctx?.log &&
          ctx.log(
            `[publish_runway_generate] strict deficit recovery enqueue failed: ${enqueueError.message}`,
          );
      }
    }
    throw error;
  }
  ctx.log &&
    ctx.log(
      `[publish_runway_generate] generation=${report.generation?.generation_id || "unknown"} verdict=${report.verdict || "unknown"}`,
    );
  const reserveTarget =
    report.reserve_target || report.runtime?.reserve_target || null;
  return {
    status: String(report.verdict || "unknown").toLowerCase(),
    phase: report.phase || "T-180",
    generation_id: report.generation?.generation_id || null,
    window_id: report.window?.window_id || null,
    selected_action_ids: report.selected_action_ids || [],
    reserve_story_ids: report.reserve_story_ids || [],
    reserve_target: reserveTarget,
    requested_reserve_story_count:
      reserveTarget?.requested_story_count ?? null,
    effective_reserve_story_count:
      reserveTarget?.effective_story_count ?? null,
    report_path: report.report_path || null,
    external_publish_attempted: false,
  };
}

async function handlePublishScheduleRecoveryMonitor(job, ctx) {
  const repos = ctx?.repos;
  if (
    !repos ||
    (!Array.isArray(ctx?.publishSchedules) &&
      (!repos.db || typeof repos.db.prepare !== "function"))
  ) {
    throw new Error("publish recovery monitor requires the queue database");
  }
  let newerActiveMonitor = null;
  if (typeof repos.jobs?.findNewerActiveByKind === "function") {
    newerActiveMonitor = repos.jobs.findNewerActiveByKind(
      "publish_schedule_recovery_monitor",
      Number(job?.id || 0),
    );
  } else if (repos.db && typeof repos.db.prepare === "function") {
    newerActiveMonitor = repos.db.prepare(`
      SELECT id, kind, status
      FROM jobs
      WHERE kind = ?
        AND id > ?
        AND status IN ('pending', 'claimed', 'running')
      ORDER BY id DESC
      LIMIT 1
    `).get("publish_schedule_recovery_monitor", Number(job?.id || 0));
  }
  if (newerActiveMonitor) {
    return {
      status: "superseded",
      superseded_by_job_id: newerActiveMonitor.id,
      superseded_by_job_status: newerActiveMonitor.status,
      prep_jobs_enqueued: 0,
      guarded_publish_recovery_enqueued: false,
      live_publish_bypass_used: false,
      external_publish_attempted: false,
    };
  }
  const reconcilePrep =
    ctx?.reconcileCriticalPublishSchedules ||
    require("./ops/critical-publish-schedule-reconciler")
      .reconcileCriticalPublishSchedules;
  const recoverPublish =
    ctx?.recoverMissedPublishWindows ||
    require("./ops/missed-publish-window-recovery")
      .recoverMissedPublishWindowsFromEnvironment;
  const schedules = Array.isArray(ctx?.publishSchedules)
    ? ctx.publishSchedules
    : repos.db.prepare(`
        SELECT *
        FROM schedules
        WHERE enabled = 1
          AND kind IN ('publish_runway_generate', 'publish_window_watchdog')
        ORDER BY priority ASC, id ASC
      `).all();
  const prep = await reconcilePrep({
    now: new Date(),
    schedules,
    repos,
    persist: true,
  });
  const publish = await recoverPublish({
    now: new Date(),
    schedules: require("./scheduler").activeSchedulesForEnvironment(
      require("./scheduler").DEFAULT_SCHEDULES,
      process.env,
    ),
    repos,
    env: process.env,
    persist: true,
    // The monitor runs every minute. Publish jobs emit their own outcome alert,
    // so repeated blocked-window scans must stay quiet.
    notify: false,
  });
  const recovered =
    Number(prep?.enqueued_count || 0) > 0 ||
    publish?.enqueued === true;
  ctx?.log &&
    ctx.log(
      `[publish_schedule_recovery_monitor] prep=${Number(prep?.enqueued_count || 0)} ` +
      `guarded_t0=${publish?.enqueued === true ? 1 : 0}`,
    );
  return {
    status: recovered ? "recovered" : "healthy",
    prep_jobs_enqueued: Number(prep?.enqueued_count || 0),
    guarded_publish_recovery_enqueued: publish?.enqueued === true,
    guarded_publish_recovery_job_id: publish?.queued_job_id || null,
    missed_publish_window_count: Number(publish?.missed_window_count || 0),
    live_publish_bypass_used: false,
    external_publish_attempted: false,
  };
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
  let runwayLock = null;
  let runwayLockError = null;
  const payload = job.payload || {};
  const phase = clean(payload.phase).toUpperCase();
  const runwayLockRequired =
    phase === "T-90" || payload.require_runway_lock === true;
  if (
    phase === "T-90" &&
    report.safe_to_publish_window === true
  ) {
    try {
      const {
        lockRunwayForJob,
      } = require("./ops/publish-runway-job-runtime");
      runwayLock = await lockRunwayForJob({
        job,
        env: process.env,
        repoRoot: path.join(__dirname, ".."),
      });
    } catch (error) {
      runwayLockError = error;
      report.verdict = "red";
      report.safe_to_publish_window = false;
      report.hold_scheduler_or_dispatch = true;
      report.blockers = uniqueClean([
        ...(Array.isArray(report.blockers) ? report.blockers : []),
        `immutable_runway_lock: ${error.message}`,
      ]);
      report.next_action =
        "repair_strict_green_runway_and_regenerate_before_publish_window";
      try {
        const sendDiscord = require("../notify");
        await sendDiscord(formatPublishWindowBlockedMessage(report, {
          jobId: job.id,
        }));
      } catch (notifyError) {
        ctx.log && ctx.log(`runway lock notify error: ${notifyError.message}`);
      }
    }
  }
  let repairEnqueued = false;
  let repairEnqueueError = null;
  let candidateRefillEnqueued = false;
  let candidateRefillEnqueueError = null;
  let candidateRefillJob = null;
  let candidateRefillVerificationEnqueued = false;
  let candidateRefillVerificationEnqueueError = null;
  let candidateRefillVerificationJob = null;
  let candidateRefillVerificationRunAt = null;
  const needsRunwayRepair = watchdogNeedsRunwayRepair(report);
  if (
    needsRunwayRepair &&
    payload.enqueue_repair_on_runway !== false &&
    ctx?.repos?.jobs
  ) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const label = clean(report.window_label || payload.window_label || "publish_window")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .slice(0, 80);
      const repairJob = ctx.repos.jobs.enqueue({
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
      repairEnqueued = queuedRecoveryState(repairJob).active;
    } catch (err) {
      repairEnqueueError = err.message;
      ctx.log && ctx.log(`[publish_window_watchdog] safe repair enqueue failed: ${err.message}`);
    }
  }
  if (
    needsRunwayRepair &&
    payload.enqueue_candidate_refill_on_runway === true &&
    ctx?.repos?.jobs
  ) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const label = clean(report.window_label || payload.window_label || "publish_window")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .slice(0, 80);
      const windowId = clean(
        runwayLock?.lock?.window_id ||
          runwayLock?.window?.window_id ||
          runwayLockError?.window_id ||
          report.window_id ||
          payload.window_id,
      );
      const recovery = enqueuePublishRunwayCandidateRecovery({
        job,
        ctx,
        phase: phase || "T-90",
        phaseScheduledAt: report.generated_at,
        reason: "publish_window_watchdog_candidate_refill",
        windowId,
        legacyIdempotencyKey:
          `publish_window_candidate_refill:${date}:${label}`,
      });
      candidateRefillJob = recovery.job;
      candidateRefillEnqueued = recovery.active;
      candidateRefillVerificationJob = recovery.verification_job;
      candidateRefillVerificationEnqueued =
        recovery.verification_active;
      candidateRefillVerificationRunAt = recovery.verification_run_at;
      candidateRefillVerificationEnqueueError =
        recovery.verification_error;
      if (candidateRefillVerificationEnqueueError) {
        ctx.log &&
          ctx.log(
            `[publish_window_watchdog] candidate refill verification enqueue failed: ${candidateRefillVerificationEnqueueError}`,
          );
      }
    } catch (err) {
      candidateRefillEnqueueError = err.message;
      ctx.log && ctx.log(`[publish_window_watchdog] candidate refill enqueue failed: ${err.message}`);
    }
  }
  ctx.log &&
    ctx.log(
      `[publish_window_watchdog] ${report.window_label || "window"} verdict=${report.verdict} safe=${report.safe_to_publish_window}`,
    );
  if (
    runwayLockRequired &&
    (!runwayLock ||
      String(runwayLock.verdict || "").trim().toUpperCase() !== "GREEN" ||
      !runwayLock.lock)
  ) {
    const reason =
      runwayLockError?.message ||
      runwayLock?.reason_codes?.[0] ||
      "verified immutable T-90 lock was not created";
    throw new Error(`PUBLISH_RUNWAY_LOCK_REQUIRED: ${reason}`);
  }
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
    runway_lock_status: runwayLock
      ? String(runwayLock.verdict || "unknown").toLowerCase()
      : runwayLockError
        ? "red"
        : "not_attempted",
    runway_generation_id: runwayLock?.generation?.generation_id || null,
    runway_window_id:
      runwayLock?.lock?.window_id ||
      runwayLock?.window?.window_id ||
      null,
    runway_lock_error: runwayLockError?.message || null,
    repair_enqueued: repairEnqueued,
    repair_enqueue_error: repairEnqueueError,
    candidate_refill_enqueued: candidateRefillEnqueued,
    candidate_refill_job_id: candidateRefillJob?.id || null,
    candidate_refill_job_status:
      clean(candidateRefillJob?.status).toLowerCase() || null,
    candidate_refill_enqueue_error: candidateRefillEnqueueError,
    candidate_refill_verification_enqueued:
      candidateRefillVerificationEnqueued,
    candidate_refill_verification_job_id:
      candidateRefillVerificationJob?.id || null,
    candidate_refill_verification_job_status:
      clean(candidateRefillVerificationJob?.status).toLowerCase() || null,
    candidate_refill_verification_run_at:
      candidateRefillVerificationRunAt,
    candidate_refill_verification_enqueue_error:
      candidateRefillVerificationEnqueueError,
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
      const watchdogVerdict = clean(watchdog.verdict || "unknown").toLowerCase();
      const watchdogBlockers = Array.isArray(watchdog.blockers) ? watchdog.blockers : [];
      const blockedResult = {
        publish_window_blocked: true,
        status: watchdogVerdict === "red" || watchdogBlockers.length ? "blocked" : "held",
        top_reason: `publish_window_watchdog_${watchdogVerdict}`,
        blockers: watchdogBlockers,
        advisory: Array.isArray(watchdog.advisory) ? watchdog.advisory : [],
        safe_to_publish_window: false,
        next_action: watchdog.next_action || "hold_scheduler_and_diagnose_pre_window_blockers",
      };
      if (blockedResult.status === "held") return blockedResult;
      throw new Error(`publish_window_watchdog_blocked:${blockedResult.top_reason}`);
    }
    const {
      immutableRunwayRequired,
      resolveRunwayForJob,
    } = require("./ops/publish-runway-job-runtime");
    const immutableRequired = immutableRunwayRequired(job, process.env);
    const immutableRunway = immutableRequired
      ? await resolveRunwayForJob({
          job,
          env: process.env,
          repoRoot: path.join(__dirname, ".."),
        })
      : null;
    return handleGuardedLiveDispatchPublish(job, ctx, {
      executorPlan: immutableRunway?.executor_plan,
      immutableRunway,
      requireImmutableRunway: immutableRequired,
    });
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

async function handleOAuthUptimeMaintenance(job, ctx) {
  const { main } = require("../tools/oauth-uptime-maintenance");
  const payload = (job && job.payload) || {};
  const args = ["--json"];
  if (payload.allow_token_refresh === true) args.push("--refresh");
  if (payload.out_dir) args.push("--out-dir", String(payload.out_dir));

  const result = await main(args);
  const report = result.report || {};
  if (ctx && ctx.log) {
    ctx.log(
      `[oauth_uptime_maintenance] verdict=${report.verdict || "UNKNOWN"} ` +
      `human_reauth=${report.requires_human_reauth === true}`,
    );
  }
  return {
    ok: report.requires_human_reauth !== true,
    verdict: report.verdict || "UNKNOWN",
    requires_human_reauth: report.requires_human_reauth === true,
    results: report.results || {},
    safety: report.safety || {
      social_posting_triggered: false,
      production_db_mutated: false,
      platform_enablement_changed: false,
      token_values_exposed: false,
    },
  };
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

async function handleGrowthAutopilot(job, ctx) {
  const {
    buildGrowthAutopilotPlan,
    writeGrowthAutopilotArtefacts,
  } = require("./ops/growth-autopilot");
  const { buildDefaultSnapshot } = require("../tools/growth-autopilot");
  const payload = (job && job.payload) || {};
  const generatedAt = clean(payload.generated_at) || new Date().toISOString();
  const snapshot = payload.snapshot_path
    ? await fs.readJson(path.resolve(ROOT, payload.snapshot_path))
    : await buildDefaultSnapshot({ generatedAt });
  snapshot.generated_at = generatedAt;
  const report = buildGrowthAutopilotPlan(snapshot);
  const outDir = payload.out_dir
    ? path.resolve(ROOT, payload.out_dir)
    : path.join(ROOT, "output", "growth-autopilot");
  const files = await writeGrowthAutopilotArtefacts({ report, outDir });
  const enqueued = [];

  if (payload.execute_safe_followups === true && ctx?.repos?.jobs) {
    const keySuffix = generatedAt.slice(0, 13).replace(/[^0-9T-]/g, "");
    if (report.next_action === "restore_scheduler_candidate") {
      const child = ctx.repos.jobs.enqueue({
        kind: "candidate_supply_monitor",
        channel_id: report.channel_id,
        priority: 35,
        idempotency_key: `growth-autopilot:candidate-supply:${keySuffix}`,
        payload: {
          limit: 30,
          enqueue_repair_on_amber: true,
          enqueue_hunt_on_runway_gap: true,
          enqueue_fresh_review_script_repair: true,
          enqueue_fresh_production_refill: true,
          no_publish: true,
          reason: "growth_autopilot_cadence_recovery",
        },
      });
      enqueued.push({ kind: "candidate_supply_monitor", id: child?.id || null });
    }
    if (
      report.incidents.some(
        (item) => item.code === "subscriber_conversion_unobserved",
      )
    ) {
      const child = ctx.repos.jobs.enqueue({
        kind: "continuous_learning_loop",
        channel_id: report.channel_id,
        priority: 60,
        idempotency_key: `growth-autopilot:learning:${keySuffix}`,
        payload: {
          limit: 12,
          maxAgeDays: 45,
          dry: true,
          no_publish: true,
          reason: "growth_autopilot_conversion_instrumentation",
        },
      });
      enqueued.push({ kind: "continuous_learning_loop", id: child?.id || null });
    }
  }

  const log = (ctx && ctx.log) || console.log;
  log(
    `[growth-autopilot] phase=${report.growth_phase} execution=${report.execution_status} next=${report.next_action}`,
  );
  return {
    ok: true,
    status: report.execution_status,
    growth_phase: report.growth_phase,
    next_action: report.next_action,
    enqueued,
    report_path: files.report_json,
    no_publish: true,
    no_external_posting: true,
    no_db_mutation: true,
    no_oauth_or_token_change: true,
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
  const {
    buildCurrentCandidateTranscriptAudienceReport,
    buildFreshCandidateReport,
    discoverMotionCapacityReportPaths,
    readMotionCapacityReports,
  } = require("../tools/candidate-supply-engine");
  const channelConfig = require("../channels/pulse-gaming");
  const payload = (job && job.payload) || {};
  const limit = Number(payload.limit || 30);
  const outDir = path.join(__dirname, "..", "output", "candidate-supply");
  const { report: candidateReport, stories } = await buildFreshCandidateReport({ limit });
  let transcriptAudienceReport = null;
  if (payload.include_transcript_audience_audit !== false) {
    try {
      const { writeTranscriptAudienceAudit } = require("./ops/transcript-audience-audit");
      transcriptAudienceReport = await buildCurrentCandidateTranscriptAudienceReport({
        candidateReport,
        root: path.join(__dirname, ".."),
      });
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
  const motionCapacityReportPaths = payload.motion_capacity_report_paths || payload.motion_capacity_reports || [];
  const discoveredMotionCapacityReportPaths = Array.isArray(motionCapacityReportPaths) && motionCapacityReportPaths.length
    ? motionCapacityReportPaths
    : await discoverMotionCapacityReportPaths({ root: path.join(__dirname, "..") });
  const motionCapacityReports = await readMotionCapacityReports(discoveredMotionCapacityReportPaths);
  const report = buildCandidateSupplyReport({
    stories,
    candidateReport,
    transcriptAudienceReport,
    motionCapacityReports,
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
  let localTtsRetryRecoveryEnqueued = false;
  let localTtsRetryRecoveryEnqueueError = null;
  if (
    needsFreshReviewScriptRepair &&
    payload.enqueue_local_tts_retry_recovery !== false &&
    ctx?.repos?.jobs
  ) {
    try {
      const generatedAt = new Date(report.generated_at || Date.now());
      const date = generatedAt.toISOString().slice(0, 10);
      const hour = String(generatedAt.getUTCHours()).padStart(2, "0");
      ctx.repos.jobs.enqueue({
        kind: "local_tts_retry_recovery",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          limit: Number(payload.local_tts_retry_limit || 6),
          apply_limit: Number(payload.local_tts_retry_apply_limit || 3),
          execute: payload.local_tts_retry_execute !== false,
          reason: "candidate_supply_monitor_local_tts_retry_recovery",
          source_green_ready_candidates: report.summary?.green_ready_candidates || 0,
          source_durable_green_ready_candidates: report.summary?.durable_green_ready_candidates || 0,
          source_runway_status: report.candidate_buffer?.publish_window_runway?.status || null,
        },
        priority: Number(payload.local_tts_retry_priority || 70),
        idempotency_key: `candidate_supply_local_tts_retry_recovery:${date}:${hour}`,
      });
      localTtsRetryRecoveryEnqueued = true;
    } catch (err) {
      localTtsRetryRecoveryEnqueueError = err.message;
      const log = (ctx && ctx.log) || console.log;
      log(`[candidate-supply-monitor] local TTS retry recovery enqueue failed: ${err.message}`);
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
      const refillPlan = report.refill_action_plan || {};
      const plannedRefillLimit = Number(refillPlan.recommended_refill_limit || 0) > 0
        ? Number(refillPlan.recommended_refill_limit)
        : Number(payload.fresh_production_refill_limit || 12);
      const plannedRssPerFeed = Number(refillPlan.recommended_rss_per_feed || 0) > 0
        ? Number(refillPlan.recommended_rss_per_feed)
        : Number(payload.fresh_production_refill_rss_per_feed || 4);
      const plannedRepairStoryLimit = Math.max(
        1,
        Math.min(
          10,
          Math.round(Number(
            payload.fresh_production_refill_repair_story_limit ||
              payload.repair_story_limit ||
              refillPlan.recommended_repair_story_limit ||
              refillPlan.minimum_new_green_candidates ||
              3,
          ) || 3),
        ),
      );
      const refillTtsProvider = freshRefillNarrationProviderPreference({
        payload: {
          tts_provider_preference:
            payload.fresh_production_refill_tts_provider ||
            payload.fresh_production_refill_tts_provider_preference ||
            payload.tts_provider_preference ||
            payload.tts_provider ||
            payload.narration_provider,
          allow_elevenlabs_tts: payload.allow_elevenlabs_tts,
        },
      });
      const sourceRefillCommandBase = clean(refillPlan.safe_refill_command);
      const sourceRefillCommandWithMode =
        sourceRefillCommandBase && !/\s--repair-evidence-mode(?:=|\s+)/.test(sourceRefillCommandBase)
          ? `${sourceRefillCommandBase} --repair-evidence-mode full`
          : sourceRefillCommandBase;
      const sourceRefillCommandWithLimit =
        sourceRefillCommandWithMode && !/\s--repair-story-limit(?:=|\s+)/.test(sourceRefillCommandWithMode)
          ? `${sourceRefillCommandWithMode} --repair-story-limit ${plannedRepairStoryLimit}`
          : sourceRefillCommandWithMode;
      const sourceRefillCommand = freshRefillProviderCommand(
        sourceRefillCommandWithLimit,
        refillTtsProvider,
      );
      ctx.repos.jobs.enqueue({
        kind: "fresh_production_refill",
        channel_id: job.channel_id || process.env.CHANNEL || "pulse-gaming",
        payload: {
          limit: plannedRefillLimit,
          rss_per_feed: plannedRssPerFeed,
          out_dir: `output/candidate-supply/fresh-production-refill/${outputStamp}/goal-proof-batch`,
          contract_out_dir: `output/candidate-supply/fresh-production-refill/${outputStamp}/goal-contract`,
          reason: "candidate_supply_monitor_fresh_production_refill",
          source_runway_status: runway.status || null,
          source_green_ready_candidates: report.summary?.green_ready_candidates || 0,
          source_durable_green_ready_candidates: report.summary?.durable_green_ready_candidates || 0,
          source_minimum_new_green_candidates: Number(refillPlan.minimum_new_green_candidates || 0),
          source_needed_fresh_youtube_candidates_for_24h: Number(refillPlan.needed_fresh_youtube_candidates_for_24h || 0),
          source_needed_fresh_youtube_candidates_for_reserve: Number(refillPlan.needed_fresh_youtube_candidates_for_reserve || 0),
          source_refill_command: sourceRefillCommand,
          tts_provider_preference: refillTtsProvider,
          repair_evidence_mode: "full",
          repair_story_limit: plannedRepairStoryLimit,
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
    motion_capacity_stories: report.summary?.motion_capacity_stories || 0,
    motion_capacity_repairable_candidates: report.summary?.motion_capacity_repairable_candidates || 0,
    motion_capacity_operator_required_candidates: report.summary?.motion_capacity_operator_required_candidates || 0,
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
    local_tts_retry_recovery_needed: needsFreshReviewScriptRepair,
    local_tts_retry_recovery_enqueued: localTtsRetryRecoveryEnqueued,
    local_tts_retry_recovery_enqueue_error: localTtsRetryRecoveryEnqueueError,
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

function freshRefillSourceFamilySlug(prefix, candidateFamily) {
  const prefixSlug = freshRefillSafeSlug(prefix);
  let familySlug = freshRefillSafeSlug(candidateFamily);
  if (!familySlug || familySlug === "source") return prefixSlug;
  if (familySlug.length > 90) familySlug = familySlug.slice(-90).replace(/^_+/, "") || familySlug.slice(0, 90);
  const combined = `${prefixSlug}_${familySlug}`;
  if (combined.length <= 120) return combined;
  const prefixLimit = Math.max(16, 119 - familySlug.length);
  const shortenedPrefix = prefixSlug.slice(0, prefixLimit).replace(/_+$/, "") || "source";
  return `${shortenedPrefix}_${familySlug}`.slice(0, 120).replace(/_+$/, "");
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
  if (
    /(?:^|\.)youtu\.be$|(?:^|\.)youtube\.com$/i.test(host) &&
    /\b(?:official|xbox|playstation|nintendo|steam|rockstar|ubisoft|capcom|sega|bandai|square[-\s]?enix|bethesda|ea|electronic\s+arts|konami)\b/i.test(name)
  ) {
    return "official_youtube_channel_url";
  }
  if (host === "news.xbox.com" || (!host && name === "xbox wire")) return "official_game_site_news_page";
  if (host === "blog.playstation.com" || (!host && name === "playstation blog")) return "official_game_site_news_page";
  if (/^nintendo(?:\s+(?:news|direct|official))?$/.test(name) && !host || /(?:^|\.)nintendo\.com$/i.test(host)) {
    return "official_game_site_news_page";
  }
  if ((name === "steam" || name === "steam store") && host === "store.steampowered.com") {
    return "platform_storefront";
  }
  if ((name === "steam" || name === "steam store") && /(?:^|\.)steamstatic\.com$/i.test(host) && /\/store_trailers\//.test(pathname)) {
    return "steam_storefront_video_reference";
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
    /(?:^|\.)(?:(?:ea|ubisoft|capcom|sega|bandainamcoent|square-enix-games|bethesda|blizzard|rockstargames|2k|callofduty|flightsimulator|elderscrollsonline|halowaypoint|devolverdigital)\.com|bethesda\.net)$/i.test(host)
  ) {
    return "official_game_site_news_page";
  }
  return null;
}

function majorMediaFreshRefillDiscoverySourceType({ sourceName = "", sourceUrl = "", title = "", subject = "" } = {}) {
  const name = clean(sourceName).toLowerCase();
  let host = "";
  try {
    host = String(new URL(clean(sourceUrl)).hostname || "").toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }
  const isMajorMedia =
    /\b(?:ign|kotaku|polygon|eurogamer|gamespot|pc\s*gamer|vgc|gamesradar|rock\s*paper\s*shotgun|the\s*verge)\b/i.test(name) ||
    /(?:^|\.)((ign|kotaku|polygon|eurogamer|gamespot|pcgamer|videogameschronicle|gamesradar|rockpapershotgun|theverge)\.com)$/i.test(host);
  if (!isMajorMedia) return null;
  const text = clean([title, subject].join(" "));
  const hasRevealSignal = /\b(?:trailer|gameplay|reveal|revealed|first\s+look|showcase|demo|release\s+date|launch\s+date|preview)\b/i.test(text);
  const hasGameContext =
    /\b(?:game|games|gaming|gameplay|playable|demo|steam|xbox|playstation|ps5|nintendo|switch|pc|console|developer|publisher|studio|rpg|shooter|platformer|roguelike|survival|multiplayer|single-player|open-world|dlc|patch|season|battle\s+pass|wishlist)\b/i.test(text) ||
    /\/(?:gaming|games|video-games|pc|playstation|xbox|nintendo|steam)\b/i.test(clean(sourceUrl));
  const hasNonGameEntertainmentContext =
    /\b(?:movie|film|cinema|theater|theatre|box\s+office|actor|actress|director|tv|television|streaming|hbo|max|netflix|disney|trailer\s+teases\s+big\s+changes\s+from\s+the\s+books)\b/i.test(text) ||
    /\/(?:movies|film|tv|television|entertainment)\b/i.test(clean(sourceUrl));
  if (hasRevealSignal && hasGameContext && !hasNonGameEntertainmentContext) {
    return "major_media_trailer_or_reveal_discovery";
  }
  return null;
}

const FRESH_REFILL_OFFICIAL_DIRECT_MEDIA_SOURCE_TYPES = new Set([
  "official_publisher_or_developer_trailer_page",
  "official_game_website_media_page",
  "official_game_site_news_page",
  "platform_storefront_video_reference",
  "steam_storefront_video_reference",
  "official_youtube_channel",
  "official_youtube_channel_url",
  "official_social_media_video",
]);

function hostFromUrl(value) {
  try {
    return String(new URL(clean(value)).hostname || "").toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function officialFreshRefillSourceOwner(sourceName, sourceUrl) {
  const host = hostFromUrl(sourceUrl);
  const ownersByHost = [
    [/(?:^|\.)news\.xbox\.com$/i, "Xbox Wire"],
    [/(?:^|\.)blog\.playstation\.com$/i, "PlayStation Blog"],
    [/(?:^|\.)nintendo\.com$/i, "Nintendo"],
    [/(?:^|\.)(?:steampowered|steamstatic)\.com$/i, "Steam"],
    [/(?:^|\.)rockstargames\.com$/i, "Rockstar Games"],
    [/(?:^|\.)callofduty\.com$/i, "Call of Duty"],
    [/(?:^|\.)flightsimulator\.com$/i, "Microsoft Flight Simulator"],
    [/(?:^|\.)elderscrollsonline\.com$/i, "The Elder Scrolls Online"],
    [/(?:^|\.)halowaypoint\.com$/i, "Halo"],
    [/(?:^|\.)ea\.com$/i, "Electronic Arts"],
    [/(?:^|\.)ubisoft\.com$/i, "Ubisoft"],
    [/(?:^|\.)capcom\.com$/i, "Capcom"],
    [/(?:^|\.)sega\.com$/i, "Sega"],
    [/(?:^|\.)bandainamcoent\.com$/i, "Bandai Namco"],
    [/(?:^|\.)square-enix-games\.com$/i, "Square Enix"],
    [/(?:^|\.)(?:bethesda\.com|bethesda\.net)$/i, "Bethesda"],
    [/(?:^|\.)blizzard\.com$/i, "Blizzard"],
    [/(?:^|\.)konami\.com$/i, "Konami"],
    [/(?:^|\.)devolverdigital\.com$/i, "Devolver Digital"],
  ];
  const match = ownersByHost.find(([pattern]) => pattern.test(host));
  if (match) return match[1];
  return clean(sourceName);
}

function freshRefillYoutubeVideoId(candidate = {}) {
  const explicit = clean(candidate.youtube_video_id || candidate.video_id);
  if (/^[A-Za-z0-9_-]{11}$/.test(explicit)) return explicit;

  for (const value of [
    candidate.official_source_url,
    candidate.reference_url,
    candidate.page_url,
    candidate.source_url,
  ]) {
    const text = clean(value);
    if (!text) continue;
    try {
      const parsed = new URL(text);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtube.com" || host === "m.youtube.com") {
        const videoId = clean(parsed.searchParams.get("v"));
        if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return videoId;
      }
      if (host === "youtu.be") {
        const videoId = clean(parsed.pathname.split("/").filter(Boolean)[0]);
        if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return videoId;
      }
    } catch {
      // Local materialised masters are handled below.
    }
  }

  for (const value of [
    candidate.local_operator_file_path,
    candidate.direct_media_url,
    candidate.direct_media_url_if_available,
    candidate.approved_direct_media_url,
  ]) {
    const text = clean(value);
    if (!text) continue;
    const fileName = path.win32.basename(text).replace(/\.[^.]+$/, "");
    if (/^[A-Za-z0-9_-]{11}$/.test(fileName)) return fileName;
    const fileNameToken = fileName
      .split("_")
      .reverse()
      .find((token) => /^[A-Za-z0-9-]{11}$/.test(token));
    if (fileNameToken) return fileNameToken;
    const terminalToken = fileName.match(/(?:^|_)([A-Za-z0-9_-]{11})$/);
    if (terminalToken) return terminalToken[1];
  }

  for (const value of [
    candidate.source_family,
    candidate.source_title,
    candidate.label,
  ]) {
    const match = clean(value).match(/youtube[:_]+([A-Za-z0-9_-]{11})(?:[_:]|$)/i);
    if (match) return match[1];
  }
  return "";
}

function freshRefillOfficialSourceUrl(candidate = {}) {
  for (const value of [
    candidate.official_source_url,
    candidate.reference_url,
    candidate.page_url,
  ]) {
    const text = clean(value);
    if (/^https?:\/\//i.test(text)) return text;
  }
  const sourceType = clean(candidate.source_type || candidate.type).toLowerCase();
  if (/^official_youtube_(?:reference|video|watch|channel|channel_url)$/.test(sourceType)) {
    const videoId = freshRefillYoutubeVideoId(candidate);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  }
  const directMediaUrl = clean(
    candidate.direct_media_url ||
      candidate.direct_media_url_if_available ||
      candidate.approved_direct_media_url,
  );
  return /^https?:\/\//i.test(directMediaUrl) ? directMediaUrl : "";
}

function ownerFromOfficialDirectMedia(candidate = {}) {
  const explicit = clean(candidate.source_owner || candidate.owner || candidate.source_name || candidate.publisher);
  if (explicit) return explicit;
  const host = hostFromUrl(candidate.direct_media_url);
  if (/(?:^|\.)rockstargames\.com$/i.test(host)) return "Rockstar Games";
  if (/(?:^|\.)callofduty\.com$/i.test(host)) return "Call of Duty";
  if (/(?:^|\.)xbox\.com$|(?:^|\.)microsoft\.com$|^assets\.xboxservices\.com$/i.test(host)) return "Xbox";
  if (/(?:^|\.)playstation\.com$|(?:^|\.)sony\.com$/i.test(host)) return "PlayStation";
  if (/(?:^|\.)nintendo\.com$/i.test(host)) return "Nintendo";
  if (/(?:^|\.)steampowered\.com$|(?:^|\.)steamstatic\.com$/i.test(host)) return "Steam";
  return "";
}

function officialDirectMediaSourceType(candidate = {}) {
  const candidateType = clean(candidate.source_type || candidate.type).toLowerCase();
  if (/^official_youtube_(?:reference|video|watch|channel|channel_url)$/.test(candidateType)) {
    return "official_youtube_channel_url";
  }
  if (FRESH_REFILL_OFFICIAL_DIRECT_MEDIA_SOURCE_TYPES.has(candidateType)) return candidateType;
  const owner = ownerFromOfficialDirectMedia(candidate);
  const directUrl = clean(candidate.direct_media_url);
  return officialFreshRefillSourceType(owner, directUrl);
}

function isFreshRefillReferenceOnlyYoutubeCandidate(candidate = {}) {
  const sourceType = clean(candidate.source_type || candidate.type).toLowerCase();
  const sourceKind = clean(candidate.source_url_kind || candidate.url_kind).toLowerCase();
  const url = clean(
    candidate.direct_media_url ||
      candidate.approved_direct_media_url ||
      candidate.media_url ||
      candidate.video_url ||
      candidate.path ||
      candidate.file_path ||
      candidate.url,
  );
  const isYoutubeReference =
    /^official_youtube_(?:reference|video|watch|channel_url)$/.test(sourceType) ||
    sourceKind.startsWith("youtube") ||
    /(?:^|\.)youtu\.be$|(?:^|\.)youtube\.com$/i.test(hostFromUrl(url));
  if (!isYoutubeReference) return false;
  if (candidate.segment_validation_eligible === true) return false;
  return !/\.(?:mp4|mov|m4v|webm|m3u8|mpd)(?:[?#].*)?$/i.test(url);
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
  const primary = clean(
    canonical.canonical_subject ||
      canonical.canonical_game ||
      canonical.selected_title ||
      canonical.canonical_title ||
      sourceManifest.title,
  );
  const claimText = clean([
    primary,
    canonical.canonical_game,
    canonical.canonical_title,
    canonical.selected_title,
    canonical.public_title,
    canonical.title,
    ...(asArray(canonical.confirmed_claims)),
    ...(asArray(canonical.claim_inventory?.confirmed)),
  ].join(" "));
  const pitOfGoblin = claimText.match(/\bpit\s+of\s+goblin\b/i);
  if (pitOfGoblin) return "Pit of Goblin";
  const flightSimulator = claimText.match(/\bmicrosoft\s+flight\s+simulator\b/i);
  if (flightSimulator) return "Microsoft Flight Simulator";
  const elderScrollsOnline = claimText.match(/\bthe\s+elder\s+scrolls\s+online\b/i);
  if (elderScrollsOnline) return "The Elder Scrolls Online";
  const inGameEntity = primary.match(/^in\s+([A-Z][A-Za-z0-9'’:-]*(?:\s+[A-Z0-9][A-Za-z0-9'’:-]*){0,3})\s+the\b/i);
  if (inGameEntity) return clean(inGameEntity[1]);
  return primary;
}

async function readFreshRefillEvidenceRows(storyPackagesPath) {
  const payload = await readJsonIfPresent(storyPackagesPath, []);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.stories)) return payload.stories;
  if (Array.isArray(payload?.packages)) return payload.packages;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function freshRefillDryRunReadyStoryIds(plan = {}) {
  const readyStoryIds = [];
  for (const story of asArray(plan.ready_stories)) {
    readyStoryIds.push(freshRefillStoryId(story));
  }
  const enabledPlatforms = new Set(["youtube_shorts", "instagram_reels", "facebook_reels"]);
  const publishNowByStory = new Map();
  for (const action of asArray(plan.actions)) {
    const storyId = freshRefillStoryId(action);
    if (!storyId) continue;
    if (clean(action.action) !== "would_publish") continue;
    if (!enabledPlatforms.has(clean(action.platform))) continue;
    if (asArray(action.blockers).length) continue;
    publishNowByStory.set(storyId, (publishNowByStory.get(storyId) || 0) + 1);
  }
  for (const [storyId, count] of publishNowByStory.entries()) {
    if (count > 0) readyStoryIds.push(storyId);
  }
  return uniqueClean(readyStoryIds);
}

async function readFreshRefillDryRunReadyStoryIds(dryRunPlanPath = path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json")) {
  const plan = await readJsonIfPresent(dryRunPlanPath, {});
  return freshRefillDryRunReadyStoryIds(plan);
}

function freshRefillPackageTitle(row = {}, canonical = {}) {
  return clean(
    canonical.selected_title ||
      canonical.public_title ||
      canonical.canonical_title ||
      row.selected_title ||
      row.public_title ||
      row.title,
  );
}

function hasFreshRefillDirectMotionRunway({ row = {}, canonical = {}, sourceManifest = {} } = {}) {
  function parseMaybeJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const scalarUrlKeys = [
    "approved_direct_media_url",
    "direct_media_url",
    "direct_media_url_if_available",
    "official_direct_media_url",
    "media_url",
    "video_url",
    "trailer_url",
  ];
  const scalarSources = [
    row,
    canonical,
    sourceManifest,
    sourceManifest.primary_source,
    sourceManifest.media_manifest,
  ].filter(Boolean);
  const scalarCandidates = [];
  for (const source of scalarSources) {
    for (const key of scalarUrlKeys) {
      const url = clean(source?.[key]);
      if (!url) continue;
      if (!/\.(?:mp4|mov|webm|m3u8)(?:[?#].*)?$/i.test(url)) continue;
      scalarCandidates.push({
        direct_media_url: url,
        source_type: source.source_type || source.type || "official_direct_media_url",
        source_owner: source.source_owner || source.owner || source.name || source.publisher,
      });
    }
  }
  const buckets = [
    scalarCandidates,
    row.video_clips,
    parseMaybeJsonArray(row.video_clips),
    row.direct_media_candidates,
    row.official_direct_media_candidates,
    row.trusted_footage_references,
    row.footage_references,
    canonical.direct_media_candidates,
    canonical.official_direct_media_candidates,
    canonical.trusted_footage_references,
    canonical.footage_references,
    sourceManifest.direct_media_candidates,
    sourceManifest.official_direct_media_candidates,
    sourceManifest.approved_direct_media,
    sourceManifest.trusted_footage_references,
    sourceManifest.footage_references,
    sourceManifest.primary_source?.direct_media_candidates,
    sourceManifest.primary_source?.official_direct_media_candidates,
    sourceManifest.primary_source?.trusted_footage_references,
    sourceManifest.primary_source?.footage_references,
    sourceManifest.media_manifest?.direct_media_candidates,
    sourceManifest.media_manifest?.trusted_footage_references,
  ];

  for (const candidate of buckets.flatMap((bucket) => asArray(bucket))) {
    if (isFreshRefillReferenceOnlyYoutubeCandidate(candidate)) continue;
    const url = clean(
      candidate.direct_media_url ||
        candidate.approved_direct_media_url ||
        candidate.media_url ||
        candidate.video_url ||
        candidate.path ||
        candidate.file_path ||
        candidate.url,
    );
    if (!url) continue;
    if (/\.(?:mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(url)) return true;
    const sourceType = clean(candidate.source_type || candidate.type).toLowerCase();
    if (officialDirectMediaSourceType(candidate)) return true;
    if (/\b(?:official|direct|video|media|trailer|gameplay|storefront|steam|youtube)\b/i.test(sourceType)) {
      return true;
    }
  }

  return false;
}

function freshRefillOfficialSourceDiscoveryPages({ row = {}, canonical = {}, sourceManifest = {} } = {}) {
  const rows = [
    row.official_source_pages,
    row.storefront_sources,
    canonical.official_source_pages,
    canonical.storefront_sources,
    sourceManifest.official_source_pages,
    sourceManifest.storefront_sources,
    sourceManifest.primary_source?.official_source_pages,
    sourceManifest.primary_source?.storefront_sources,
    sourceManifest.approved_source_url,
    sourceManifest.primary_source?.approved_source_url,
    canonical.approved_direct_media_url,
    canonical.store_url,
    canonical.storefront_url,
    row.approved_direct_media_url,
    row.store_url,
    row.storefront_url,
  ];
  const seen = new Set();
  return rows
    .flatMap((value) => asArray(value).length ? asArray(value) : [value])
    .map((entry, index) => {
      const item = entry && typeof entry === "object" ? entry : { official_source_url: entry };
      const url = clean(
        item.official_source_url ||
          item.source_url ||
          item.reference_url ||
          item.page_url ||
          item.store_url ||
          item.url ||
          item.href,
      );
      if (!url || seen.has(url.toLowerCase())) return null;
      seen.add(url.toLowerCase());
      const sourceName = clean(item.source_name || item.name || item.source_owner || sourceManifest.primary_source?.name);
      const sourceType = clean(item.source_type || item.type) || officialFreshRefillSourceType(sourceName, url);
      if (!sourceType && !officialFreshRefillSourceType(sourceName, url)) return null;
      return {
        official_source_url: url,
        source_url: url,
        source_title: clean(item.source_title || item.title || item.label || canonical.selected_title || row.title),
        source_family: clean(item.source_family || item.family || `official_source_page_${index + 1}`),
        source_type: sourceType || "official_source_page",
        source_owner: sourceName,
      };
    })
    .filter(Boolean);
}

function hasFreshRefillOfficialSourceDiscoveryRunway({ row = {}, canonical = {}, sourceManifest = {} } = {}) {
  if (freshRefillOfficialSourceDiscoveryPages({ row, canonical, sourceManifest }).length > 0) return true;

  const primarySourceUrl = clean(
    sourceManifest.primary_source?.url || canonical.primary_source_url || row.primary_source_url,
  );
  const sourceName = clean(
    sourceManifest.primary_source?.name || canonical.primary_source || row.source || row.source_name,
  );
  const motionIntent = clean([
    freshRefillPackageTitle(row, canonical),
    canonical.canonical_title,
    row.title,
    primarySourceUrl,
  ].join(" "));

  return Boolean(
    officialFreshRefillSourceType(sourceName, primarySourceUrl) &&
      /\b(?:trailer|gameplay|playtest|demo|beta|showcase|deep[- ]?dive|hands[- ]?on|footage|reveal|launch video)\b/i.test(
        motionIntent,
      ),
  );
}

function isFreshRefillMotionPoorServiceStory({ row = {}, canonical = {}, sourceManifest = {} } = {}) {
  const title = freshRefillPackageTitle(row, canonical);
  const subject = canonicalSubjectFromFreshRefill(canonical, sourceManifest);
  const sourceName = clean(sourceManifest.primary_source?.name || canonical.primary_source || row.source);
  const sourceUrl = clean(sourceManifest.primary_source?.url || canonical.primary_source_url || row.url);
  const script = clean(canonical.narration_script || canonical.full_script || row.full_script || row.narration_script);
  const combined = clean([title, subject, sourceName, sourceUrl, script].join(" "));

  return /\b(?:console\s+prices?|price\s+update|hardware\s+prices?|free\s+play\s+days|top\s+deals?|daily\s+deals?|deal\s+roundup|subscription|game\s+pass|playstation\s+plus|ps\s+plus|switch\s+online|weekend\s+trap|sale|discount|bundle)\b/i.test(
    combined,
  ) || /\b(?:collector(?:s|')?|collectible|collectibles|auction|listing|film\s+slides?|35mm|retrospective|still\s+matters|changed\s+the\s+series|series\s+blueprint|made\s+the\s+blueprint|nostalgia\s+test|gaming\s+history|retro)\b/i.test(
    combined,
  );
}

function freshRefillTitleEvidenceKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ");
}

function freshRefillMediaHouseTitleEvidenceIsCurrent({
  title,
  canonical = {},
  mediaHouseScore = {},
} = {}) {
  const repairedAt = Date.parse(clean(canonical.script_repair?.repaired_at));
  const scoredAt = Date.parse(clean(mediaHouseScore.generated_at));
  if (
    Number.isFinite(repairedAt) &&
    (!Number.isFinite(scoredAt) || scoredAt < repairedAt)
  ) {
    return false;
  }

  const feedReport = mediaHouseScore.shorts_feed_competition_report || {};
  const scoredTitles = uniqueClean([
    feedReport.title,
    ...asArray(feedReport.platform_titles),
  ]);
  if (!scoredTitles.length) return true;
  const currentTitle = freshRefillTitleEvidenceKey(title);
  return scoredTitles.some(
    (candidate) => freshRefillTitleEvidenceKey(candidate) === currentTitle,
  );
}

function freshRefillRepairQuarantineReasons({
  row = {},
  canonical = {},
  sourceManifest = {},
  scriptScorecard = {},
  mediaHouseScore = {},
} = {}) {
  const title = freshRefillPackageTitle(row, canonical);
  const script = clean(canonical.narration_script || canonical.full_script || row.full_script);
  const rowBlockers = (Array.isArray(row.blockers) ? row.blockers : []).map(clean).filter(Boolean);
  const sourceBlockers = (Array.isArray(sourceManifest.blockers) ? sourceManifest.blockers : []).map(clean).filter(Boolean);
  const scorecardBlockers = [
    ...(Array.isArray(scriptScorecard.blockers) ? scriptScorecard.blockers : []),
    ...(Array.isArray(scriptScorecard.failures) ? scriptScorecard.failures : []),
  ].map(clean).filter(Boolean);
  const mediaHouseBlockers = [
    ...(Array.isArray(mediaHouseScore.blockers) ? mediaHouseScore.blockers : []),
    ...(Array.isArray(mediaHouseScore.hard_failures) ? mediaHouseScore.hard_failures : []),
    ...(Array.isArray(mediaHouseScore.shorts_feed_competition_report?.blockers)
      ? mediaHouseScore.shorts_feed_competition_report.blockers
      : []),
  ].map(clean).filter(Boolean);
  const mediaHouseTitleEvidenceIsCurrent =
    freshRefillMediaHouseTitleEvidenceIsCurrent({
      title,
      canonical,
      mediaHouseScore,
    });
  const scorecardClean =
    clean(scriptScorecard.verdict).toLowerCase() === "viral_ready" &&
    scorecardBlockers.length === 0;
  const scriptBlockers = scorecardClean ? scorecardBlockers : [...rowBlockers, ...scorecardBlockers];
  const blockers = [...rowBlockers, ...sourceBlockers, ...scorecardBlockers];
  const combined = clean([title, script, ...blockers].join(" "));
  const scriptCombined = clean([title, script, ...scriptBlockers].join(" "));
  const reasons = [];
  const sourceEvidence = clean(JSON.stringify({
    primary_source: sourceManifest.primary_source,
    secondary_sources: sourceManifest.secondary_sources,
    approved_sources: sourceManifest.approved_sources,
    source_attribution: canonical.source_attribution,
    source_entries: canonical.source_entries,
  })).toLowerCase();
  const attributedSources = [...script.matchAll(
    /\b(PlayStation Blog|Xbox Wire|Nintendo(?: Life)?|Steam|IGN|GameSpot|Eurogamer|PC Gamer|GamesRadar\+?|VGC|Kotaku|Polygon|Rock Paper Shotgun|RockPaperShotgun)\s+(?:says|reports|confirms|announces|reveals)\b/gi,
  )].map((match) => clean(match[1]).toLowerCase());

  if (
    row.repeat_or_stale_risk === true ||
    /\b(?:near_repeat_story_cluster|terminal_duplicate|duplicate_blocked|already_public|already_has_public_platform_id|public_platform_id)\b/i.test(combined)
  ) {
    reasons.push(
      /\b(?:already_public|already_has_public_platform_id|public_platform_id)\b/i.test(combined)
        ? "already_public_runway_candidate"
        : "repeat_or_stale_runway_candidate",
    );
  }
  if (/\bcould split players\b/i.test(title)) reasons.push("generic_could_split_title_template");
  if (
    mediaHouseTitleEvidenceIsCurrent &&
    mediaHouseBlockers.some((blocker) =>
      /\bfeed_title_template_fatigue\b/i.test(blocker),
    )
  ) {
    reasons.push("feed_title_template_fatigue");
  }
  if (/\bgeneric_(?:title|could_split_title|player_test)_template\b/i.test(scriptCombined)) {
    reasons.push("script_generic_template_blocker");
  }
  if (
    clean(scriptScorecard.verdict).toLowerCase() === "rewrite_required" ||
    scriptBlockers.includes("script:rewrite_required") ||
    scriptBlockers.some((blocker) => /\bscript_verdict_rewrite_required\b/i.test(blocker)) ||
    scriptBlockers.some((blocker) => /\bscript_score_below_threshold\b/i.test(blocker))
  ) {
    reasons.push("script_rewrite_required");
  }
  if (clean(scriptScorecard.verdict).toLowerCase() === "tighten_before_tts") {
    reasons.push("script_tighten_required");
  }
  if (/\b(?:the hook here is|the signal is|for fans to argue about|this story finally has something specific to judge|source-backed update)\b/i.test(script)) {
    reasons.push("public_narration_scaffold_language");
  }
  if (
    /\b(?:has one detail worth checking before it becomes background noise|the important part is whether it changes timing,\s*access,\s*price,\s*performance or actual footage|not every update deserves a spotlight|use this as a watch signal,\s*not a verdict|has to answer one simple thing:\s*why should players care now|a named source is only useful when it changes a real choice|gives that choice teeth|belongs in the watch pile until stronger proof lands)\b/i.test(script)
  ) {
    reasons.push("generic_source_signal_template");
  }
  if (attributedSources.some((source) => !sourceEvidence.includes(source))) {
    reasons.push("source_attribution_mismatch");
  }
  if (/\bmedia_house:script_sounds_ai_generic\b/i.test(scriptCombined)) {
    reasons.push("media_house_script_generic");
  }
  if (/\b(?:public_output|platform):generic_title\b/i.test(scriptCombined)) {
    reasons.push("public_generic_title");
  }
  if (clean(sourceManifest.freshness_gate).toLowerCase() === "fail" || /\b(?:stale_source|source_age_expired|source_age_failed)\b/i.test(combined)) {
    reasons.push("source_freshness_failed");
  }
  if (clean(sourceManifest.coherence_gate).toLowerCase() === "fail" || /\b(?:source_coherence|title_source_mismatch)\b/i.test(combined)) {
    reasons.push("source_coherence_failed");
  }
  if (
    isFreshRefillMotionPoorServiceStory({ row, canonical, sourceManifest }) &&
    !hasFreshRefillDirectMotionRunway({ row, canonical, sourceManifest }) &&
    !hasFreshRefillOfficialSourceDiscoveryRunway({ row, canonical, sourceManifest })
  ) {
    reasons.push("motion_runway_unfit_for_automatic_refill");
  }

  return uniqueClean(reasons);
}

async function buildFreshRefillRepairPackageFilter({
  storyPackagesPath,
  outputDir,
  alreadyReadyStoryIds = [],
} = {}) {
  const root = path.resolve(__dirname, "..");
  const rows = await readFreshRefillEvidenceRows(storyPackagesPath);
  const eligibleRows = [];
  const quarantinedRows = [];
  const alreadyReadyRows = [];
  const alreadyReadySet = new Set(uniqueClean(alreadyReadyStoryIds));

  for (const row of rows) {
    const storyId = freshRefillStoryId(row);
    const artifactDir = freshRefillArtifactDir(row, root);
    const canonical = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {})
      : {};
    const sourceManifest = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "source_manifest.json"), {})
      : {};
    const scriptScorecard = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {})
      : {};
    const mediaHouseScore = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "pulse_media_house_score.json"), {})
      : {};
    const quarantineReasons = freshRefillRepairQuarantineReasons({
      row,
      canonical,
      sourceManifest,
      scriptScorecard,
      mediaHouseScore,
    });
    if (storyId && alreadyReadySet.has(storyId)) {
      alreadyReadyRows.push({
        story_id: storyId,
        artifact_dir: artifactDir,
        title: freshRefillPackageTitle(row, canonical),
        reasons: ["already_scheduler_ready"],
      });
      continue;
    }
    if (quarantineReasons.length) {
      quarantinedRows.push({
        story_id: storyId,
        artifact_dir: artifactDir,
        title: freshRefillPackageTitle(row, canonical),
        reasons: quarantineReasons,
      });
      continue;
    }
    eligibleRows.push(row);
  }

  await fs.ensureDir(outputDir);
  const eligibleStoryPackagesPath = path.join(outputDir, "story-packages-motion-repair-eligible.json");
  const quarantineReportPath = path.join(outputDir, "fresh_refill_quarantined_story_packages.json");
  await fs.writeJson(eligibleStoryPackagesPath, eligibleRows, { spaces: 2 });
  await fs.writeJson(
    quarantineReportPath,
    {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source_story_packages: storyPackagesPath,
      summary: {
        story_package_count: rows.length,
        repair_eligible_story_package_count: eligibleRows.length,
        quarantined_story_package_count: quarantinedRows.length,
        motion_runway_quarantined_story_package_count: quarantinedRows.filter((row) =>
          asArray(row.reasons).includes("motion_runway_unfit_for_automatic_refill"),
        ).length,
        already_ready_skipped_story_package_count: alreadyReadyRows.length,
      },
      quarantined: quarantinedRows,
      already_ready_skipped: alreadyReadyRows,
    },
    { spaces: 2 },
  );

  return {
    rows,
    eligibleRows,
    quarantinedRows,
    alreadyReadyRows,
    eligibleStoryPackagesPath,
    quarantineReportPath,
  };
}

function freshRefillScriptRewriteReasons(row = {}) {
  const reasons = [
    ...(Array.isArray(row.reasons) ? row.reasons : []),
    ...(Array.isArray(row.blockers) ? row.blockers : []),
    ...(Array.isArray(row.reason_codes) ? row.reason_codes : []),
  ];
  return uniqueClean(reasons.filter((reason) => (
    /\bscript_rewrite_required\b/i.test(reason) ||
    /\bscript_verdict_rewrite_required\b/i.test(reason) ||
    /\bscript_tighten_required\b/i.test(reason) ||
    /\bscript_score_below_threshold\b/i.test(reason) ||
    /\bgeneric_title_template\b/i.test(reason) ||
    /\bpersuasive_authority_trope\b/i.test(reason) ||
    /\binternal_audience_scaffold\b/i.test(reason) ||
    /\bscript_generic_template_blocker\b/i.test(reason) ||
    /\bpublic_narration_scaffold_language\b/i.test(reason) ||
    /\bmedia_house_script_generic\b/i.test(reason) ||
    /\bgeneric_source_signal_template\b/i.test(reason) ||
    /\bsource_attribution_mismatch\b/i.test(reason) ||
    /\bgeneric_could_split_title_template\b/i.test(reason) ||
    /\bfeed_title_template_fatigue\b/i.test(reason)
  )));
}

const FRESH_REFILL_TITLE_ONLY_REPAIR_REASON_RE =
  /^(?:feed_title_template_fatigue|generic_could_split_title_template|public_generic_title)$/i;
const FRESH_REFILL_GENERATED_TITLE_RE =
  /\b(?:Has A (?:Footage Readability Test|Source-Proof Risk|Studio Risk|Player Test|Ghosting Test)|Needs (?:One Real Proof Point|A Clearer Reason To Care)|Footage Has To Prove Itself|Finally Shows Real Gameplay|Could Split Players)\b/i;

function freshRefillApprovedTitleCandidates(row = {}, canonical = {}) {
  return uniqueClean([
    canonical.short_title,
    ...asArray(canonical.title_candidates),
    canonical.public_title,
    canonical.selected_title,
    canonical.canonical_title,
    canonical.title,
    row.title,
  ]).filter((title) => !FRESH_REFILL_GENERATED_TITLE_RE.test(title));
}

function freshRefillTitleOnlyRepair({
  reasons = [],
  canonical = {},
  scriptScorecard = {},
  scorecardBlockers = [],
} = {}) {
  const script = clean(canonical.narration_script || canonical.full_script);
  return Boolean(
    script &&
      reasons.length > 0 &&
      reasons.every((reason) => FRESH_REFILL_TITLE_ONLY_REPAIR_REASON_RE.test(clean(reason))) &&
      clean(scriptScorecard.verdict).toLowerCase() === "viral_ready" &&
      scorecardBlockers.length === 0,
  );
}

function scopedFreshRefillOfficialPageEvidence(officialPageEvidence, canonical = {}) {
  if (!officialPageEvidence || typeof officialPageEvidence !== "object") {
    return officialPageEvidence;
  }
  const claimRows = asArray(officialPageEvidence.claims);
  if (!claimRows.length) return officialPageEvidence;
  const claimText = (claim) =>
    clean(
      claim && typeof claim === "object"
        ? claim.text || claim.claim || claim.evidence_text
        : claim,
    );
  const relevantClaims = relevantFreshRefillSourceEvidenceClaims(
    claimRows.map(claimText),
    canonical,
  );
  const relevantKeys = new Set(relevantClaims.map((claim) => clean(claim).toLowerCase()));
  let scopedClaims = claimRows.filter((claim) =>
    relevantKeys.has(claimText(claim).toLowerCase()),
  );
  let method = "approved_narration_token_overlap";
  const headline = clean(officialPageEvidence.headline || officialPageEvidence.title);
  const betaSubjectMatch = headline.match(
    /:\s*([a-z0-9][a-z0-9:'\u2019&.+-]*(?:\s+[a-z0-9][a-z0-9:'\u2019&.+-]*){0,4}?)\s+(?:closed|open)\s+beta\b/i,
  );
  const headlineSubjectTokens = freshRefillClaimTokens(betaSubjectMatch?.[1]);
  if (headlineSubjectTokens.size > 0) {
    const sourceUrl = clean(officialPageEvidence.source_url);
    const sourceBodyClaim = (claim) => {
      if (!claim || typeof claim !== "object") return false;
      const claimSourceUrl = clean(claim.source_url);
      return (
        clean(claim.origin).toLowerCase() === "source_body" &&
        (!sourceUrl || !claimSourceUrl || claimSourceUrl === sourceUrl)
      );
    };
    const firstSubjectClaimIndex = claimRows.findIndex((claim) => {
      if (!sourceBodyClaim(claim)) return false;
      const tokens = freshRefillClaimTokens(claimText(claim));
      return [...headlineSubjectTokens].every((token) => tokens.has(token));
    });
    if (firstSubjectClaimIndex >= 0) {
      const scopedBetaClaims = [];
      for (let index = firstSubjectClaimIndex; index < claimRows.length; index += 1) {
        const claim = claimRows[index];
        const text = claimText(claim);
        if (
          !sourceBodyClaim(claim) ||
          !text ||
          /\b(?:related stories|latest news|did you like this|share of the week)\b/i.test(text)
        ) {
          break;
        }
        const claimTokens = freshRefillClaimTokens(text);
        const subjectMatch = [...headlineSubjectTokens].every((token) =>
          claimTokens.has(token),
        );
        const betaEvidenceSignal =
          /\b(?:xbox\s+insiders?|series\s+x|windows\s+pc|technical\s+test|midnight|no\s+fixed\s+classes|spires|ascension|3v3|15\s+teams|regional\s+windows|pages|prestige|remain\s+on|insider\s+hub|previews|select\s+join)\b/i.test(
            text,
          );
        if (!subjectMatch && !betaEvidenceSignal) continue;
        scopedBetaClaims.push(claim);
        if (scopedBetaClaims.length >= 12) break;
      }
      if (scopedBetaClaims.length > 0) {
        scopedClaims = scopedBetaClaims;
        method = "official_beta_headline_subject_bound_source_body";
      }
    }
  }
  if (!scopedClaims.length) {
    const subjectTokens = freshRefillClaimTokens(
      canonical.canonical_game ||
        canonical.canonical_subject ||
        canonical.short_title ||
        canonical.selected_title ||
        canonical.canonical_title ||
        canonical.title,
    );
    const headlineTokens = freshRefillClaimTokens(
      officialPageEvidence.headline || officialPageEvidence.title,
    );
    const headlineBindsSubject =
      subjectTokens.size > 0 &&
      [...subjectTokens].every((token) => headlineTokens.has(token));
    const sourceUrl = clean(officialPageEvidence.source_url);
    if (headlineBindsSubject) {
      scopedClaims = claimRows
        .filter((claim) => {
          if (!claim || typeof claim !== "object") return false;
          const claimSourceUrl = clean(claim.source_url);
          return (
            clean(claim.origin).toLowerCase() === "source_body" &&
            (!sourceUrl || !claimSourceUrl || claimSourceUrl === sourceUrl)
          );
        })
        .slice(0, 8);
      method = "official_headline_subject_bound_source_body";
    }
  }
  return {
    ...officialPageEvidence,
    claims: scopedClaims,
    claim_scope: {
      method,
      input_claim_count: claimRows.length,
      scoped_claim_count: scopedClaims.length,
      excluded_claim_count: Math.max(0, claimRows.length - scopedClaims.length),
      fail_closed: scopedClaims.length === 0,
    },
  };
}

function renderFreshRefillScriptRewriteMarkdown(workOrder = {}) {
  const lines = [];
  lines.push("# Fresh Refill Script Rewrite Work Order");
  lines.push("");
  lines.push(`Generated: ${workOrder.generated_at}`);
  lines.push(`Jobs: ${workOrder.summary?.job_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local script repair planning only.");
  lines.push("- No manual publish, DB mutation, OAuth/token mutation or disabled-platform enablement.");
  lines.push("");
  lines.push("## Jobs");
  lines.push("");
  for (const job of workOrder.jobs || []) {
    lines.push(`- ${job.story_id}: ${job.title || "untitled"}`);
    lines.push(`  - reasons: ${(job.reasons || []).join(", ") || "unknown"}`);
    lines.push(`  - source: ${job.source?.name || "unknown"} ${job.source?.url || ""}`.trimEnd());
    lines.push(`  - lane: ${job.repair_lane}`);
  }
  if (!workOrder.jobs?.length) lines.push("- none");
  return `${lines.join("\n")}\n`;
}

async function buildFreshRefillScriptRewriteWorkOrder({
  quarantinedRows = [],
  outputDir,
  sourceEvidenceFetcher = null,
}) {
  const jobs = [];

  for (const row of quarantinedRows || []) {
    const reasons = freshRefillScriptRewriteReasons(row);
    if (!reasons.length) continue;
    const artifactDir = clean(row.artifact_dir);
    const canonical = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {})
      : {};
    const sourceManifest = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "source_manifest.json"), {})
      : {};
    const scriptScorecard = artifactDir
      ? await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {})
      : {};
    const primarySource = sourceManifest.primary_source || {};
    const sourceUrl = clean(primarySource.url || canonical.primary_source_url);
    const sourcePublishedAt = clean(primarySource.published_at || canonical.source_published_at);
    let officialPageEvidence =
      sourceManifest.source_evidence &&
      typeof sourceManifest.source_evidence === "object" &&
      !Array.isArray(sourceManifest.source_evidence)
        ? sourceManifest.source_evidence
        : null;
    if (typeof sourceEvidenceFetcher === "function" && /^https?:\/\//i.test(sourceUrl)) {
      try {
        officialPageEvidence = await sourceEvidenceFetcher({
          url: sourceUrl,
          publishedAt: sourcePublishedAt,
        });
      } catch (err) {
        officialPageEvidence = {
          status: "blocked",
          reason: "official_source_page_fetch_failed",
          source_url: sourceUrl,
          error: clean(err.message || String(err)),
          claims: [],
          confirmed_event_window: null,
        };
      }
    }
    const scorecardBlockers = uniqueClean([
      ...(Array.isArray(scriptScorecard.blockers) ? scriptScorecard.blockers : []),
      ...(Array.isArray(scriptScorecard.failures) ? scriptScorecard.failures : []),
    ]);
    officialPageEvidence = scopedFreshRefillOfficialPageEvidence(
      officialPageEvidence,
      canonical,
    );
    const titleOnlyRepair = freshRefillTitleOnlyRepair({
      reasons,
      canonical,
      scriptScorecard,
      scorecardBlockers,
    });
    const currentScript = clean(canonical.narration_script || canonical.full_script);
    jobs.push({
      story_id: clean(row.story_id || canonical.story_id),
      title: clean(row.title || canonical.selected_title || canonical.canonical_title),
      artifact_dir: artifactDir,
      reasons,
      repair_lane: titleOnlyRepair
        ? "source_bound_title_repair"
        : "source_bound_script_rewrite",
      preserve_current_script: titleOnlyRepair,
      current_script_sha256: currentScript ? sha256Text(currentScript) : null,
      candidate_titles: freshRefillApprovedTitleCandidates(row, canonical),
      source: {
        name: clean(primarySource.name || canonical.primary_source || canonical.discovery_source),
        url: sourceUrl,
        type: clean(primarySource.type || canonical.primary_source_type),
        published_at: sourcePublishedAt,
        title: clean(officialPageEvidence?.headline),
        description: clean(officialPageEvidence?.source_text),
        body: clean(officialPageEvidence?.source_text),
        confirmed_event_window: officialPageEvidence?.confirmed_event_window || null,
      },
      source_evidence: officialPageEvidence
        ? {
            status: officialPageEvidence.status,
            source_url: clean(officialPageEvidence.source_url || sourceUrl),
            headline: clean(officialPageEvidence.headline),
            source_text_sha256: clean(officialPageEvidence.source_text_sha256) || null,
            claims: asArray(officialPageEvidence.claims),
            confirmed_event_window: officialPageEvidence.confirmed_event_window || null,
            reason: clean(officialPageEvidence.reason) || null,
          }
        : null,
      current_script: currentScript,
      scorecard_verdict: clean(scriptScorecard.verdict),
      scorecard_blockers: scorecardBlockers,
      required_changes: titleOnlyRepair
        ? [
            "replace only the fatigued public title",
            "preserve approved narration byte-for-byte",
            "preserve the approved narration SHA-256 through motion hydration and audio",
          ]
        : [
            "remove internal/scaffold narration language",
            "open with the named subject immediately",
            "ground the script in the recorded primary source",
            "add a concrete player-impact beat",
            "end with a story-specific payoff before the Pulse CTA",
          ],
      acceptance: [
        "script_scorecard verdict is viral_ready",
        "no generic_player_test_template blocker",
        "no public_narration_scaffold_language blocker",
        "no missing_story_specific_payoff blocker",
      ],
      safety: {
        local_only: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_mutation: true,
        disabled_platforms_unchanged: true,
      },
    });
  }

  const workOrder = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: "fresh_production_refill_script_quarantine",
    summary: {
      quarantined_package_count: quarantinedRows.length,
      job_count: jobs.length,
    },
    jobs,
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
    },
  };
  await fs.ensureDir(outputDir);
  const workOrderPath = path.join(outputDir, "fresh_refill_script_rewrite_work_order.json");
  const markdownPath = path.join(outputDir, "fresh_refill_script_rewrite_work_order.md");
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  await fs.writeFile(markdownPath, renderFreshRefillScriptRewriteMarkdown(workOrder), "utf8");

  return {
    workOrderPath,
    markdownPath,
    jobCount: jobs.length,
  };
}

async function applyFreshRefillScriptRewriteWorkOrder({
  scriptRewriteWorkOrder,
  repairDir,
  log,
}) {
  if (!scriptRewriteWorkOrder?.workOrderPath || !scriptRewriteWorkOrder.jobCount) {
    return {
      status: "not_needed",
      reason: "no_script_rewrite_jobs",
      summary: {
        job_count: 0,
        pass_count: 0,
        applied_count: 0,
        blocked_count: 0,
      },
      output_dir: null,
      report_path: null,
      markdown_path: null,
    };
  }

  const { runFreshRefillScriptRewrite } = require("./ops/fresh-refill-script-rewrite");
  const outDir = path.join(repairDir, "script-rewrite-apply");
  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath: scriptRewriteWorkOrder.workOrderPath,
    outDir,
    applyLocal: true,
  });
  if (log) {
    log(
      `[fresh-production-refill] script-rewrite applied=${report.summary?.applied_count || 0} blocked=${report.summary?.blocked_count || 0}`,
    );
  }
  return {
    status: "completed",
    summary: report.summary || {},
    blocked_rewrite_reasons: scriptRewriteBlockedReasons(report),
    output_dir: report.output_dir || outDir,
    report_path: path.join(report.output_dir || outDir, "fresh_refill_script_rewrite_report.json"),
    markdown_path: path.join(report.output_dir || outDir, "fresh_refill_script_rewrite_report.md"),
    safety: report.safety || {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
    },
  };
}

function scriptRewriteBlockedReasons(report = {}) {
  return uniqueClean(
    asArray(report.items)
      .filter((item) => clean(item.action) === "blocked" || clean(item.verdict) === "blocked")
      .flatMap((item) => [
        ...(Array.isArray(item.quality_blockers) ? item.quality_blockers : []),
        ...(Array.isArray(item.coherence_failures) ? item.coherence_failures : []),
        item.error,
      ]),
  );
}

function scriptRewriteNextAction({ fallback = "source_motion_first_intake_required", scriptRewriteApply = {} } = {}) {
  const reasons = scriptRewriteApply.blocked_rewrite_reasons || [];
  if (
    reasons.some((reason) =>
      /(?:missing_source_support|rewritten_angle_not_supported_by_source_claims|source_claim_scope_mismatch|source_title_mismatch)/i.test(
        reason,
      ),
    )
  ) {
    return "replace_source_drift_story_with_fresh_supported_story";
  }
  return fallback;
}

function freshRefillEditorialDedupeKey(story = {}) {
  const subject = clean(story.canonical_subject || story.canonical_game || story.subject).toLowerCase();
  const title = clean(story.title || story.selected_title || story.canonical_title)
    .toLowerCase()
    .replace(/(?:\s+needs\s+(?:one real proof point|ps5 pro motion proof))+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!subject || !title) return "";
  return `${subject.replace(/[^a-z0-9]+/g, " ").trim()}|${title}`;
}

function freshRefillOfficialSourcePreference(story = {}) {
  const source = clean(story.primary_source || story.source_name).toLowerCase();
  const url = clean(story.primary_source_url || story.source_url || story.url).toLowerCase();
  if (
    /\b(?:xbox wire|playstation blog|nintendo|steam|epic games|ubisoft|bethesda|ea|capcom|sega|square enix)\b/i.test(source) ||
    /(?:news\.xbox\.com|blog\.playstation\.com|nintendo\.com|steampowered\.com|ubisoft\.com|bethesda\.net|ea\.com|capcom\.com|sega\.com|square-enix\.com)/i.test(url)
  ) {
    return 100;
  }
  if (/\b(?:ign|gamespot|eurogamer|pc gamer|gamesradar|vgc|kotaku|polygon|rock paper shotgun|rockpapershotgun)\b/i.test(source)) {
    return 60;
  }
  return 20;
}

function dedupeFreshRefillOfficialStories(stories = []) {
  const retained = [];
  const dropped = [];
  const indexByKey = new Map();
  for (const story of asArray(stories)) {
    const key = freshRefillEditorialDedupeKey(story);
    if (!key || !indexByKey.has(key)) {
      if (key) indexByKey.set(key, retained.length);
      retained.push(story);
      continue;
    }
    const retainedIndex = indexByKey.get(key);
    const current = retained[retainedIndex];
    if (freshRefillOfficialSourcePreference(story) > freshRefillOfficialSourcePreference(current)) {
      dropped.push({
        ...current,
        reason: "duplicate_editorial_angle",
        retained_story_id: clean(story.story_id || story.id),
      });
      retained[retainedIndex] = story;
    } else {
      dropped.push({
        ...story,
        reason: "duplicate_editorial_angle",
        retained_story_id: clean(current.story_id || current.id),
      });
    }
  }
  return { stories: retained, dropped };
}

const FRESH_REFILL_SOURCE_CLAIM_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "because",
  "before",
  "being",
  "check",
  "from",
  "game",
  "gameplay",
  "games",
  "get",
  "have",
  "into",
  "july",
  "more",
  "new",
  "now",
  "only",
  "optimised",
  "optimized",
  "other",
  "patch",
  "play",
  "players",
  "preorder",
  "series",
  "should",
  "their",
  "there",
  "these",
  "this",
  "title",
  "titles",
  "through",
  "update",
  "version",
  "week",
  "while",
  "with",
  "would",
  "xbox",
]);

function freshRefillClaimTokens(value) {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(
        (token) =>
          token &&
          (token.length >= 4 || /\d/.test(token)) &&
          !FRESH_REFILL_SOURCE_CLAIM_STOP_WORDS.has(token),
      ),
  );
}

function relevantFreshRefillSourceEvidenceClaims(sourceEvidenceClaims, canonical) {
  const narrationTokens = freshRefillClaimTokens(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.display_script ||
      canonical.caption_display_text,
  );
  const subjectTokens = freshRefillClaimTokens(
    canonical.canonical_game ||
      canonical.canonical_subject ||
      canonical.short_title ||
      canonical.selected_title,
  );
  const evaluatedClaims = sourceEvidenceClaims
    .map((claim, index) => {
      const text = clean(claim);
      if (!text || /\b(?:did you like this|like this|latest news|learn more|share of the week)\b/i.test(text)) {
        return null;
      }
      const claimTokens = freshRefillClaimTokens(text);
      const overlap = [...claimTokens].filter((token) => narrationTokens.has(token));
      const subjectMatch =
        subjectTokens.size > 0 &&
        [...subjectTokens].every((token) => claimTokens.has(token));
      if (text.split(/\s+/).filter(Boolean).length > 45 && !subjectMatch) {
        return null;
      }
      return {
        text,
        index,
        overlap_count: overlap.length,
        subject_match: subjectMatch,
      };
    });
  const firstSubjectClaimIndex = evaluatedClaims.findIndex((claim) => claim?.subject_match);
  if (firstSubjectClaimIndex >= 0) {
    const contiguousClaims = [];
    for (let index = firstSubjectClaimIndex; index < evaluatedClaims.length; index += 1) {
      const claim = evaluatedClaims[index];
      if (!claim || (!claim.subject_match && claim.overlap_count < 2)) break;
      contiguousClaims.push(claim.text);
      if (contiguousClaims.length >= 8) break;
    }
    return contiguousClaims;
  }
  return evaluatedClaims
    .filter(
      (claim) =>
        claim &&
        claim.overlap_count >= 3,
    )
    .sort(
      (left, right) =>
        right.overlap_count - left.overlap_count ||
        left.index - right.index,
    )
    .slice(0, 8)
    .sort((left, right) => left.index - right.index)
    .map((claim) => claim.text);
}

function freshRefillRegexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceRepeatedFreshRefillGameReferences(value, canonicalGame) {
  const text = clean(value);
  const game = clean(canonicalGame);
  if (!text || !game) return text;
  const pattern = freshRefillRegexEscape(game).replace(/\s+/g, "\\s+");
  let seen = false;
  return text.replace(
    new RegExp(`${pattern}(['\u2019]s)?`, "gi"),
    (match, possessive) => {
      if (!seen) {
        seen = true;
        return match;
      }
      return possessive ? "the game's" : "the game";
    },
  );
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
    const sourceOwnerName = officialFreshRefillSourceOwner(sourceName, sourceUrl);
    const directMediaCandidateRows = [
      ...(Array.isArray(sourceManifest.direct_media_candidates) ? sourceManifest.direct_media_candidates : []),
      ...(Array.isArray(primarySource.direct_media_candidates) ? primarySource.direct_media_candidates : []),
      ...(Array.isArray(sourceManifest.media_candidates) ? sourceManifest.media_candidates : []),
      ...(Array.isArray(canonical.direct_media_candidates) ? canonical.direct_media_candidates : []),
      ...(Array.isArray(canonical.media_candidates) ? canonical.media_candidates : []),
      sourceManifest.direct_media_url_if_available,
      sourceManifest.approved_direct_media_url,
      primarySource.direct_media_url_if_available,
      primarySource.approved_direct_media_url,
      canonical.approved_direct_media_url,
      canonical.direct_media_url,
      canonical.direct_media_url_if_available,
    ];
    const officialSourcePages = freshRefillOfficialSourceDiscoveryPages({ row, canonical, sourceManifest });
    const seenDirectMediaUrls = new Set();
    const directMediaCandidates = directMediaCandidateRows
      .map((candidate, index) => {
        const row =
          candidate && typeof candidate === "object"
            ? candidate
            : { direct_media_url: candidate };
        const directMediaUrl = clean(
          row.direct_media_url ||
            row.direct_media_url_if_available ||
            row.approved_direct_media_url ||
            row.url ||
            row.href ||
            row.source_url ||
            row.video_url ||
            row.trailer_url,
        );
        const sourceKind = mediaSourceUrlKindFields(directMediaUrl);
        const isOfficialYoutubeReference =
          /^youtube_/.test(sourceKind.source_url_kind) &&
          /^official_youtube_(?:reference|video|watch|channel|channel_url)$/.test(
            clean(row.source_type || row.type).toLowerCase(),
          );
        if (sourceKind.segment_validation_eligible !== true && !isOfficialYoutubeReference) return null;
        const key = directMediaUrl.toLowerCase();
        if (seenDirectMediaUrls.has(key)) return null;
        seenDirectMediaUrls.add(key);
        return {
          direct_media_url: directMediaUrl,
          source_url_kind: sourceKind.source_url_kind,
          segment_validation_eligible: sourceKind.segment_validation_eligible === true,
          segment_validation_ineligible_reason: sourceKind.segment_validation_ineligible_reason || null,
          source_title: clean(row.source_title || row.title || row.label || row.name),
          source_family: clean(row.source_family || row.family || row.media_identity) || `direct_media_${index + 1}`,
          source_type: clean(row.source_type || row.type),
          source_owner: clean(row.source_owner || row.owner || row.source_name || row.publisher),
          official_source_url: freshRefillOfficialSourceUrl({
            ...row,
            direct_media_url: directMediaUrl,
          }),
          youtube_video_id: freshRefillYoutubeVideoId({
            ...row,
            direct_media_url: directMediaUrl,
          }),
          source_duration_s: row.source_duration_s || row.duration_s || row.durationS || null,
        };
      })
      .filter(Boolean);
    const entity = canonicalSubjectFromFreshRefill(canonical, sourceManifest);
    const primarySourceType = officialFreshRefillSourceType(sourceOwnerName, sourceUrl);
    if (!entity) continue;

    const candidateEntries = directMediaCandidates.length > 0 ? directMediaCandidates : [{}];
    const rowEntries = [];
    for (const [index, candidate] of candidateEntries.entries()) {
      const directMediaSourceType = candidate.direct_media_url ? officialDirectMediaSourceType(candidate) : "";
      const entrySourceType = candidate.direct_media_url ? directMediaSourceType : primarySourceType;
      if (!entrySourceType) continue;
      const directMediaProvided = candidate.segment_validation_eligible === true;
      const sourceKind = clean(candidate.source_url_kind);
      const candidateOwner = ownerFromOfficialDirectMedia(candidate);
      const candidateOfficialSourceUrl = freshRefillOfficialSourceUrl(candidate);
      const entrySourceName = clean(
        (primarySourceType ? sourceOwnerName : candidateOwner) ||
          candidateOwner ||
          sourceOwnerName ||
          "official source",
      );
      const entrySourceUrl = clean(
        candidateOfficialSourceUrl ||
          (/^https?:\/\//i.test(candidate.direct_media_url) ? candidate.direct_media_url : "") ||
          sourceUrl,
      );
      if (!entrySourceUrl) continue;
      const sourceTitle = clean(
        candidate.source_title ||
          canonical.canonical_title ||
          canonical.selected_title ||
          `${entity} official source`,
      );
      rowEntries.push({
        story_id: storyId,
        entity,
        source_type: entrySourceType,
        official_source_url: entrySourceUrl,
        direct_media_url_if_available: directMediaProvided ? candidate.direct_media_url || "" : "",
        local_operator_file_path:
          sourceKind === "local_video_file" ? candidate.direct_media_url || "" : "",
        youtube_video_id: candidate.youtube_video_id || null,
        source_url_kind: sourceKind || null,
        segment_validation_eligible: candidate.segment_validation_eligible === true,
        segment_validation_ineligible_reason: candidate.segment_validation_ineligible_reason || null,
        source_title: sourceTitle,
        source_owner: `${entrySourceName} official source`,
        source_family: freshRefillSourceFamilySlug(
          `${entrySourceName}_${entity}_${storyId}`,
          candidate.source_family || index + 1,
        ),
        source_duration_s: candidate.source_duration_s || null,
        evidence_of_officialness: directMediaProvided
          ? `${entrySourceName} official direct media is recorded in this story package source manifest.`
          : sourceKind.startsWith("youtube")
            ? `${entrySourceName} official YouTube reference is recorded in this story package source manifest.`
          : `${entrySourceName} is the official/platform source recorded in this story package source manifest.`,
        entity_match_notes: `Story entity is ${entity}; source manifest and public title concern the same story.`,
        direct_media_provided: directMediaProvided,
        downloads_allowed: false,
      });
    }
    for (const [index, page] of officialSourcePages.entries()) {
      const officialSourceUrl = clean(page.official_source_url || page.source_url || page.url);
      if (!officialSourceUrl || officialSourceUrl === sourceUrl) continue;
      const entrySourceType = clean(page.source_type) || officialFreshRefillSourceType(clean(page.source_owner || sourceName), officialSourceUrl);
      if (!entrySourceType) continue;
      rowEntries.push({
        story_id: storyId,
        entity,
        source_type: entrySourceType,
        official_source_url: officialSourceUrl,
        direct_media_url_if_available: "",
        source_url_kind: null,
        segment_validation_eligible: false,
        segment_validation_ineligible_reason: null,
        source_title: clean(page.source_title || canonical.canonical_title || canonical.selected_title || `${entity} official source`),
        source_owner: `${clean(page.source_owner || sourceName || "official source")} official source`,
        source_family: freshRefillSourceFamilySlug(
          `${clean(page.source_owner || sourceName || "official")}_${entity}_${storyId}_supplemental`,
          page.source_family || index + 1,
        ),
        source_duration_s: null,
        evidence_of_officialness: `${clean(page.source_owner || sourceName || "This")} official source page is recorded in this story package source manifest.`,
        entity_match_notes: `Story entity is ${entity}; supplemental official source page is attached for motion discovery.`,
        direct_media_provided: false,
        downloads_allowed: false,
      });
    }
    const sourceEvidence =
      sourceManifest.source_evidence &&
      typeof sourceManifest.source_evidence === "object" &&
      !Array.isArray(sourceManifest.source_evidence)
        ? sourceManifest.source_evidence
        : {};
    const sourceEvidenceClaims = asArray(sourceEvidence.claims)
      .map((claim) =>
        clean(
          claim && typeof claim === "object"
            ? claim.text || claim.claim || claim.evidence_text
            : claim,
        ),
      )
      .filter(Boolean);
    const relevantSourceEvidenceClaims = relevantFreshRefillSourceEvidenceClaims(
      sourceEvidenceClaims,
      canonical,
    );
    const sourceEvidenceClaimKeys = new Set(
      sourceEvidenceClaims.map((claim) => clean(claim).toLowerCase()),
    );
    const canonicalClaims = uniqueClean([
      ...asArray(canonical.confirmed_claims),
      ...asArray(canonical.claim_inventory?.confirmed),
    ]).filter(
      (claim) => !sourceEvidenceClaimKeys.has(clean(claim).toLowerCase()),
    );
    const confirmedClaims = uniqueClean([
      ...canonicalClaims,
      ...relevantSourceEvidenceClaims,
    ]);
    const unconfirmedClaims = uniqueClean([
      ...asArray(canonical.unconfirmed_claims),
      ...asArray(canonical.claim_inventory?.unconfirmed),
    ]);
    const prohibitedClaims = uniqueClean([
      ...asArray(canonical.prohibited_claims),
      ...asArray(canonical.claim_inventory?.prohibited),
    ]);
    const narrationScript = replaceRepeatedFreshRefillGameReferences(
      canonical.narration_script ||
        canonical.full_script ||
        canonical.display_script ||
        canonical.caption_display_text,
      clean(canonical.canonical_game || entity),
    );
    const story = {
      ...canonical,
      id: storyId,
      story_id: storyId,
      title: clean(canonical.selected_title || canonical.canonical_title || entity),
      canonical_subject: entity,
      canonical_game: clean(canonical.canonical_game || entity),
      primary_source: sourceOwnerName,
      primary_source_url: sourceUrl,
      direct_media_candidates: directMediaCandidates,
      official_source_pages: officialSourcePages,
      confirmed_claims: confirmedClaims,
      unconfirmed_claims: unconfirmedClaims,
      prohibited_claims: prohibitedClaims,
      claim_inventory: {
        ...(canonical.claim_inventory || {}),
        confirmed: confirmedClaims,
        unconfirmed: unconfirmedClaims,
        prohibited: prohibitedClaims,
      },
      ...(Object.keys(sourceEvidence).length
        ? { source_evidence: sourceEvidence }
        : {}),
      narration_script: narrationScript,
      full_script: narrationScript,
      display_script: narrationScript,
      caption_display_text: narrationScript,
      tts_script: narrationScript,
      spoken_narration_script: narrationScript,
      word_count: narrationScript.split(/\s+/).filter(Boolean).length,
    };
    stories.push(story);
    if (!rowEntries.length) continue;
    entries.push(...rowEntries);
  }

  const deduped = dedupeFreshRefillOfficialStories(stories);
  const retainedStoryIds = new Set(deduped.stories.map((story) => clean(story.story_id || story.id)).filter(Boolean));
  const dedupedEntries = entries.filter((entry) => retainedStoryIds.has(clean(entry.story_id)));

  await fs.ensureDir(outputDir);
  const candidateStoriesPath = path.join(outputDir, "official_source_candidate_stories.json");
  const officialSourceEntriesPath = path.join(outputDir, "official_source_entries.json");
  await fs.writeJson(candidateStoriesPath, deduped.stories, { spaces: 2 });
  await fs.writeJson(officialSourceEntriesPath, dedupedEntries, { spaces: 2 });

  const {
    buildOfficialSourceIntakeReport,
    renderOfficialSourceIntakeMarkdown,
  } = require("./official-source-intake");
  const officialSourceIntakeReport = buildOfficialSourceIntakeReport({
    stories: deduped.stories,
    entries: dedupedEntries,
  });
  officialSourceIntakeReport.editorial_dedupe = {
    input_story_count: stories.length,
    retained_story_count: deduped.stories.length,
    dropped_story_count: deduped.dropped.length,
    dropped: deduped.dropped.map((story) => ({
      story_id: clean(story.story_id || story.id),
      retained_story_id: story.retained_story_id,
      title: clean(story.title),
      reason: story.reason,
    })),
  };
  const officialSourceIntakeMarkdown = renderOfficialSourceIntakeMarkdown(officialSourceIntakeReport);
  const officialSourceIntakeJsonPath = path.join(outputDir, "official_source_intake_report.json");
  const officialSourceIntakeMdPath = path.join(outputDir, "official_source_intake_report.md");
  await fs.writeJson(officialSourceIntakeJsonPath, officialSourceIntakeReport, { spaces: 2 });
  await fs.writeFile(officialSourceIntakeMdPath, officialSourceIntakeMarkdown, "utf8");

  return {
    story_count: deduped.stories.length,
    deduplicated_story_count: deduped.dropped.length,
    official_source_entries_count: dedupedEntries.length,
    accepted_official_source_count: officialSourceIntakeReport.summary?.accepted || 0,
    rejected_official_source_count: officialSourceIntakeReport.summary?.rejected || 0,
    candidateStoriesPath,
    officialSourceEntriesPath,
    officialSourceIntakeJsonPath,
    officialSourceIntakeMdPath,
  };
}

function freshRefillSearchTemplateRows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.official_search_template?.entries)) {
    return payload.official_search_template.entries;
  }
  if (Array.isArray(payload.governed_visual_plan_template?.entries)) {
    return payload.governed_visual_plan_template.entries.flatMap((entry) =>
      asArray(entry.official_search_actions).map((action) => ({
        story_id: entry.story_id,
        entity: action.entity || entry.entity,
        ...action,
      })),
    );
  }
  return [];
}

async function buildFreshRefillDirectMediaDiscoveryInput({
  sourceEntriesPath,
  officialSearchAutofillTemplatePath,
  officialYoutubeMotionTemplatePath,
  outputPath,
} = {}) {
  const sourceEntries = freshRefillSearchTemplateRows(await readJsonIfPresent(sourceEntriesPath, []));
  const officialSearchRows = freshRefillSearchTemplateRows(await readJsonIfPresent(officialSearchAutofillTemplatePath, []));
  const officialYoutubeMotionRows = freshRefillSearchTemplateRows(
    await readJsonIfPresent(officialYoutubeMotionTemplatePath, []),
  );
  const merged = [];
  const seen = new Set();
  // A decoded, hash-bound local master is stronger evidence than its
  // metadata-only discovery row, so it must win any identity collision.
  for (const row of [...officialYoutubeMotionRows, ...sourceEntries, ...officialSearchRows]) {
    const storyId = freshRefillStoryId(row);
    const key = [
      storyId,
      clean(row.entity).toLowerCase(),
      clean(row.official_source_url || row.source_url || row.reference_url || row.page_url).toLowerCase(),
      clean(
        row.direct_media_url_if_available ||
          row.direct_media_url ||
          row.approved_direct_media_url ||
          row.url ||
          row.href ||
          row.source_url,
      ).toLowerCase(),
      clean(row.source_family || row.family).toLowerCase(),
    ].join("|");
    if (!storyId || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  if (outputPath) {
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(outputPath, merged, { spaces: 2 });
  }
  return {
    entries: merged,
    source_entry_count: sourceEntries.length,
    official_search_entry_count: officialSearchRows.length,
    official_youtube_motion_entry_count: officialYoutubeMotionRows.length,
    merged_entry_count: merged.length,
  };
}

function freshRefillOfficialYoutubeMotionRows(payload = {}) {
  return freshRefillSearchTemplateRows(payload).filter((row) => {
    const sourceType = clean(row.source_type).toLowerCase();
    const videoId = clean(row.youtube_video_id);
    const officialChannelUrl = clean(
      row.official_channel_url || row.provenance?.official_channel,
    );
    return (
      sourceType === "official_youtube_channel_url" &&
      row.source_verified === true &&
      /^[A-Za-z0-9_-]{6,20}$/.test(videoId) &&
      /^https:\/\/(?:www\.)?youtube\.com\/@[^/]+$/i.test(officialChannelUrl)
    );
  });
}

function freshRefillOfficialYoutubeMotionChildArgs({
  inputPath,
  outputDir,
  outputJsonPath,
  outputTemplatePath,
} = {}) {
  return [
    "tools/official-youtube-motion-materializer.js",
    "--input",
    inputPath,
    "--output-dir",
    outputDir,
    "--output-json",
    outputJsonPath,
    "--output-template",
    outputTemplatePath,
    "--json",
  ];
}

function freshRefillShouldRunOfficialDiscovery({
  sourceEvidence = {},
  supplementalOfficialSearchEvidence = {},
  officialSearchTemplate = {},
} = {}) {
  return (
    Number(sourceEvidence.official_source_entries_count || 0) > 0 ||
    Number(supplementalOfficialSearchEvidence.total_entry_count || 0) > 0 ||
    freshRefillSearchTemplateRows(officialSearchTemplate).length > 0
  );
}

function freshRefillSupplementalSearchEntity(story = {}) {
  const entity = clean(
    story.canonical_subject ||
      story.canonical_game ||
      story.target_entity ||
      story.title ||
      story.selected_title ||
      story.canonical_title,
  );
  const title = clean(
    story.title ||
      story.selected_title ||
      story.canonical_title,
  );
  if (
    entity &&
    title.toLowerCase().startsWith(`${entity.toLowerCase()}:`)
  ) {
    const subtitle = title.slice(entity.length + 1).trim();
    const possessiveTitle = subtitle.match(/^(.+?)(?:['’]s)\b/i)?.[1];
    if (possessiveTitle) {
      return `${entity}: ${clean(possessiveTitle)}`;
    }
  }
  return entity;
}

async function buildFreshRefillSupplementalOfficialSearchTemplate({
  candidateStoriesPath,
  sourceFamilyReportPath,
  templatePath,
} = {}) {
  const stories = freshRefillSearchTemplateRows(await readJsonIfPresent(candidateStoriesPath, []));
  const sourceFamilyReport = await readJsonIfPresent(sourceFamilyReportPath, {});
  const sourceFamilyRows = new Map(
    freshRefillSearchTemplateRows(sourceFamilyReport)
      .map((row) => [freshRefillStoryId(row), row])
      .filter(([storyId]) => storyId),
  );
  const existingRows = freshRefillSearchTemplateRows(await readJsonIfPresent(templatePath, {}));
  const rows = [...existingRows];
  const seen = new Set(
    rows.map((row) =>
      [
        freshRefillStoryId(row),
        clean(row.entity).toLowerCase(),
        clean(row.query).toLowerCase(),
      ].join("|"),
    ),
  );

  let added = 0;
  for (const story of stories) {
    const storyId = freshRefillStoryId(story);
    const entity = freshRefillSupplementalSearchEntity(story);
    if (!storyId || !entity) continue;
    const hasSourceFamilyRow = sourceFamilyRows.has(storyId);
    const sourceRow = sourceFamilyRows.get(storyId) || {};
    const motionStarved =
      !sourceFamilyRows.size ||
      !hasSourceFamilyRow ||
      Number(sourceRow.missing_motion_clips || 0) > 0 ||
      Number(sourceRow.missing_motion_families || 0) > 0 ||
      /blocked|missing|insufficient/i.test(clean(sourceRow.readiness_status));
    if (!motionStarved) continue;
    const query = `${entity} official gameplay trailer`;
    const key = [storyId, entity.toLowerCase(), query.toLowerCase()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      story_id: storyId,
      entity,
      query,
      accepted_sources: [
        "Steam",
        "official publisher channel",
        "official game site",
        "platform storefront",
      ],
      status: "supplemental_official_search_required",
      reason: "fresh_refill_motion_variety_deficit",
      local_only: true,
      no_download: true,
      no_publish: true,
    });
    added += 1;
  }

  await fs.ensureDir(path.dirname(templatePath));
  await fs.writeJson(
    templatePath,
    {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source: "fresh_refill_supplemental_motion_variety_search",
      entries: rows,
      summary: {
        existing_entry_count: existingRows.length,
        supplemental_entry_count: added,
        total_entry_count: rows.length,
      },
      safety: {
        local_only: true,
        no_download: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_mutation: true,
      },
    },
    { spaces: 2 },
  );

  return {
    template_path: templatePath,
    existing_entry_count: existingRows.length,
    supplemental_entry_count: added,
    total_entry_count: rows.length,
  };
}

async function runFreshRefillRepairChild({ runChild, args, childKind, log, childProcesses, timeoutMs }) {
  const resolvedTimeoutMs = Number(timeoutMs || process.env.PULSE_FRESH_PRODUCTION_REFILL_REPAIR_TIMEOUT_MS || 15 * 60 * 1000);
  try {
    const result = await runChild({
      label: childKind,
      args,
      childKind,
      timeoutEnvName: "PULSE_FRESH_PRODUCTION_REFILL_REPAIR_TIMEOUT_MS",
      timeoutMs: resolvedTimeoutMs,
      log,
    });
    const evidence = normaliseJobChildProcessEvidence({
      childKind,
      args,
      result,
    });
    childProcesses.push(evidence);
    return evidence.ok;
  } catch (err) {
    childProcesses.push(normaliseJobChildProcessEvidence({
      childKind,
      args,
      error: err,
    }));
    return false;
  }
}

function freshRefillRepairStoryLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.max(1, Math.min(30, Math.round(number)));
}

function freshRefillRepairEvidenceMode(value) {
  const mode = clean(value).toLowerCase();
  if (["plan", "quick", "report"].includes(mode)) return "plan";
  if (["full", "deep", "repair"].includes(mode)) return "full";
  return "full";
}

function summarizeFreshRefillUnderSupportedMotion(realMotionReport = {}) {
  const jobs = asArray(realMotionReport.jobs);
  const underSupportedJobs = jobs.filter((job) => {
    const blockers = asArray(job.blockers).map((blocker) => clean(blocker));
    const status = clean(job.status).toLowerCase();
    const partialCounts = job.partial_evidence_counts_towards_final_render_readiness === true;
    const familyBlocked = blockers.some((blocker) =>
      /real_motion_family_minimum_not_met|real_motion_clip_minimum_not_met|distinct_motion_families/i.test(blocker),
    );
    return !partialCounts && status !== "materialized" && familyBlocked;
  });

  const storyIds = uniqueClean(underSupportedJobs.map((job) => job.story_id));
  const minFamilyCount = underSupportedJobs.length
    ? Math.min(...underSupportedJobs.map((job) => Number(job.distinct_motion_family_count || job.direct_video_motion_family_count || 0)))
    : 0;

  return {
    under_supported_motion_story_count: storyIds.length,
    under_supported_motion_story_ids: storyIds,
    under_supported_motion_needs_official_family_count: storyIds.length,
    under_supported_motion_min_distinct_family_count: minFamilyCount,
    under_supported_motion_defer_reason: storyIds.length
      ? "insufficient_distinct_official_motion_families"
      : null,
  };
}

function freshRefillDirectMediaCandidateCount({ row = {}, canonical = {}, sourceManifest = {} } = {}) {
  function parseMaybeJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return uniqueClean([
    row.direct_media_url,
    row.approved_direct_media_url,
    ...(asArray(row.video_clips).map((candidate) =>
      clean(candidate.path || candidate.file_path || candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(parseMaybeJsonArray(row.video_clips).map((candidate) =>
      clean(candidate.path || candidate.file_path || candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(asArray(row.direct_media_candidates).map((candidate) =>
      clean(candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(asArray(row.official_direct_media_candidates).map((candidate) =>
      clean(candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(asArray(canonical.direct_media_candidates).map((candidate) =>
      clean(candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(asArray(canonical.official_direct_media_candidates).map((candidate) =>
      clean(candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(asArray(sourceManifest.direct_media_candidates).map((candidate) =>
      clean(candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    ...(asArray(sourceManifest.primary_source?.direct_media_candidates).map((candidate) =>
      clean(candidate.direct_media_url || candidate.approved_direct_media_url || candidate.url || candidate.video_url),
    )),
    sourceManifest.approved_direct_media_url,
    sourceManifest.direct_media_url,
    sourceManifest.primary_source?.approved_direct_media_url,
    sourceManifest.primary_source?.direct_media_url,
    canonical.approved_direct_media_url,
    canonical.direct_media_url,
  ]).length;
}

async function freshRefillRepairAttemptPriority(row = {}, index = 0) {
  const artifactDir = freshRefillArtifactDir(row, ROOT);
  const canonical = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {})
    : {};
  const sourceManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "source_manifest.json"), {})
    : {};
  const scriptScorecard = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {})
    : {};
  const primarySource = sourceManifest.primary_source || {};
  const sourceName = clean(primarySource.name || canonical.primary_source || row.source || row.source_name);
  const sourceUrl = clean(primarySource.url || canonical.primary_source_url || row.url || row.primary_source_url);
  const sourceType = officialFreshRefillSourceType(sourceName, sourceUrl);
  const title = freshRefillPackageTitle(row, canonical);
  const discoverySourceType =
    sourceType ||
    majorMediaFreshRefillDiscoverySourceType({
      sourceName,
      sourceUrl,
      title,
      subject: clean(canonical.canonical_subject || canonical.canonical_game || canonical.subject),
    });
  const sourceText = clean([sourceName, sourceUrl, sourceType].join(" "));
  const directMediaCount = freshRefillDirectMediaCandidateCount({ row, canonical, sourceManifest });
  const hasDirectMotionRunway = hasFreshRefillDirectMotionRunway({ row, canonical, sourceManifest });
  const rowBlockers = uniqueClean([
    ...(Array.isArray(row.blockers) ? row.blockers : []),
    ...(Array.isArray(row.reason_codes) ? row.reason_codes : []),
  ]);
  let score = 0;

  if (hasDirectMotionRunway) score += 700;
  score += Math.min(8, directMediaCount) * 80;
  if (sourceType) score += 260;
  else if (discoverySourceType) score += 180;
  if (/\b(?:playstation\s+blog|xbox\s+wire|nintendo|steam|store\.steampowered|rockstar|ubisoft|bandai|sega|capcom|square[-\s]?enix|bethesda|ea|electronic\s+arts|konami|epic\s+games)\b/i.test(sourceText)) {
    score += 180;
  }
  if (/\b(?:ign|kotaku|polygon|eurogamer|gamespot|pc\s+gamer|vgc|gamesradar|rock\s+paper\s+shotgun)\b/i.test(sourceText)) {
    score += 35;
  }
  if (clean(scriptScorecard.verdict).toLowerCase() === "viral_ready") score += 40;
  if (rowBlockers.some((blocker) => /\bgovernance:RED\b/i.test(blocker))) score -= 500;
  if (rowBlockers.some((blocker) => /\bsource_lock_not_verified\b/i.test(blocker))) score -= 25;

  return {
    row,
    index,
    story_id: freshRefillStoryId(row),
    title,
    score,
    source_name: sourceName,
    source_type: discoverySourceType,
    direct_media_candidate_count: directMediaCount,
    has_direct_motion_runway: hasDirectMotionRunway,
    topic_key: clean(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  };
}

async function freshRefillRepairAttemptScope({
  packageFilter,
  repairStoryLimit,
  repairDir,
  requireDirectMotionRunway = false,
  allowOfficialSourceDiscoveryWithoutRunway = false,
}) {
  const priorityRows = await Promise.all(
    (packageFilter.eligibleRows || []).map((row, index) =>
      freshRefillRepairAttemptPriority(row, index),
    ),
  );
  priorityRows.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const firstStoryByTopic = new Map();
  const duplicateTopicRows = [];
  const distinctPriorityRows = [];
  for (const item of priorityRows) {
    const topicKey = clean(item.topic_key);
    const first = topicKey ? firstStoryByTopic.get(topicKey) : null;
    if (first) {
      item.duplicate_of_story_id = first.story_id;
      duplicateTopicRows.push(item);
      continue;
    }
    if (topicKey) firstStoryByTopic.set(topicKey, item);
    distinctPriorityRows.push(item);
  }
  const motionRunwayRequired = requireDirectMotionRunway === true;
  const directRunwayRows = distinctPriorityRows.filter((item) => item.has_direct_motion_runway === true);
  const discoveryRows =
    motionRunwayRequired && allowOfficialSourceDiscoveryWithoutRunway
      ? distinctPriorityRows.filter((item) => item.has_direct_motion_runway !== true && item.source_type)
      : [];
  const discoveryStoryIds = new Set(discoveryRows.map((item) => item.story_id).filter(Boolean));
  const attemptPriorityRows = motionRunwayRequired
    ? [...directRunwayRows, ...discoveryRows]
    : distinctPriorityRows;
  const motionRunwayDeferredPriorityRows = motionRunwayRequired
    ? distinctPriorityRows.filter((item) => {
        if (item.has_direct_motion_runway === true) return false;
        if (discoveryStoryIds.has(item.story_id)) return false;
        return true;
      })
    : [];
  const allRepairStoryPackageRows = attemptPriorityRows.map((item) => item.row);
  const repairStoryLimitValue = freshRefillRepairStoryLimit(repairStoryLimit);
  const storyPackageRows = repairStoryLimitValue
    ? allRepairStoryPackageRows.slice(0, repairStoryLimitValue)
    : allRepairStoryPackageRows;
  const repairDeferredByLimitRows = [
    ...(repairStoryLimitValue ? allRepairStoryPackageRows.slice(repairStoryLimitValue) : []),
    ...motionRunwayDeferredPriorityRows.map((item) => item.row),
    ...duplicateTopicRows.map((item) => item.row),
  ];
  let repairStoryPackagesPath = packageFilter.eligibleStoryPackagesPath;
  let repairAttemptStoryPackagesPath = packageFilter.eligibleStoryPackagesPath;
  let repairDeferredStoryPackagesPath = null;
  let repairPriorityReportPath = null;
  if (repairDir) {
    await fs.ensureDir(repairDir);
    repairPriorityReportPath = path.join(repairDir, "fresh_refill_repair_attempt_priority.json");
    await fs.writeJson(repairPriorityReportPath, {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      summary: {
        eligible_story_package_count: allRepairStoryPackageRows.length,
        repair_story_limit: repairStoryLimitValue,
        motion_runway_required_for_attempt: motionRunwayRequired,
        motion_runway_deferred_count: motionRunwayDeferredPriorityRows.length,
        duplicate_topic_variant_count: duplicateTopicRows.length,
      },
      ranked: priorityRows.map((item, rank) => ({
        rank: rank + 1,
        story_id: item.story_id,
        title: item.title,
        score: item.score,
        source_name: item.source_name,
        source_type: item.source_type,
        direct_media_candidate_count: item.direct_media_candidate_count,
        has_direct_motion_runway: item.has_direct_motion_runway,
        duplicate_of_story_id: item.duplicate_of_story_id || null,
        selected_for_attempt: storyPackageRows.includes(item.row),
        defer_reason: item.duplicate_of_story_id
          ? "duplicate_topic_variant"
          : motionRunwayRequired && item.has_direct_motion_runway !== true
          ? storyPackageRows.includes(item.row)
            ? "official_source_discovery_required"
            : "source_motion_first_required"
          : storyPackageRows.includes(item.row)
            ? null
            : "repair_story_limit",
      })),
    }, { spaces: 2 });
  }
  if (repairDeferredByLimitRows.length) {
    repairAttemptStoryPackagesPath = path.join(
      repairDir,
      repairStoryLimitValue
        ? `story-packages-motion-repair-attempt-limit-${repairStoryLimitValue}.json`
        : "story-packages-motion-repair-attempt.json",
    );
    repairDeferredStoryPackagesPath = path.join(
      repairDir,
      repairStoryLimitValue
        ? `story-packages-motion-repair-deferred-after-limit-${repairStoryLimitValue}.json`
        : "story-packages-motion-repair-deferred.json",
    );
    await fs.writeJson(repairAttemptStoryPackagesPath, storyPackageRows, { spaces: 2 });
    await fs.writeJson(repairDeferredStoryPackagesPath, repairDeferredByLimitRows, { spaces: 2 });
    repairStoryPackagesPath = repairAttemptStoryPackagesPath;
  }
  return {
    allRepairStoryPackageRows,
    repairStoryLimitValue,
    storyPackageRows,
    repairDeferredByLimitRows,
    repairStoryPackagesPath,
    repairAttemptStoryPackagesPath,
    repairDeferredStoryPackagesPath,
    repairPriorityReportPath,
  };
}

async function writeFreshRefillVisualSourceReviewsForRejectedSegments({
  segmentReportPath,
  storyPackageRows = [],
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  const reportPath = clean(segmentReportPath);
  if (!reportPath || !(await fs.pathExists(reportPath))) {
    return {
      status: "skipped",
      reason: "segment_report_missing",
      summary: {
        visual_source_review_count: 0,
        reject_count: 0,
        rejected_segment_story_count: 0,
      },
    };
  }

  const segmentReport = await readJsonIfPresent(reportPath, {});
  const grouped = new Map();
  for (const segment of asArray(segmentReport.segments)) {
    const storyId = clean(segment.story_id || segment.id);
    if (!storyId) continue;
    const state = grouped.get(storyId) || { total: 0, rejected: 0, validated: 0 };
    state.total += 1;
    const status = clean(segment.status || segment.segment_status);
    if (/validated|accepted|passed/i.test(status)) state.validated += 1;
    else if (/rejected|failed|blocked/i.test(status)) state.rejected += 1;
    grouped.set(storyId, state);
  }

  const jobs = [];
  for (const row of storyPackageRows || []) {
    const storyId = freshRefillStoryId(row);
    const artifactDir = clean(row.artifact_dir);
    const state = grouped.get(storyId);
    if (!storyId || !artifactDir || !state) continue;
    if (state.total <= 0 || state.rejected <= 0 || state.validated > 0) continue;
    jobs.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      title: freshRefillPackageTitle(row),
      status: "blocked_after_segment_validation",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
        "segment_validation_zero_validated_windows",
      ],
      actions: [
        {
          action_id: "materialise_validated_real_motion_clips",
          status: "rejected",
          repair_lane: "reject_visually_unsupported_candidate_after_zero_validated_segments",
          auto_repairable: false,
          operator_approval_required: false,
          dead_end_blocker: true,
        },
      ],
      segment_validation: {
        report_path: reportPath,
        total_segments: state.total,
        rejected_segments: state.rejected,
        validated_segments: state.validated,
      },
    });
  }

  if (!jobs.length) {
    return {
      status: "not_needed",
      reason: "no_zero_validated_segment_stories",
      summary: {
        visual_source_review_count: 0,
        reject_count: 0,
        rejected_segment_story_count: 0,
      },
    };
  }

  const { writeVisualSourceReviewReport } = require("./goal-visual-source-review");
  const result = await writeVisualSourceReviewReport({
    workOrder: { jobs },
    outputDir: outputDir || path.dirname(reportPath),
    generatedAt,
  });
  return {
    status: "generated",
    report_path: result.jsonPath,
    markdown_path: result.markdownPath,
    summary: {
      ...result.report.summary,
      rejected_segment_story_count: jobs.length,
    },
    reviews: result.report.reviews,
  };
}

function renderFreshRefillHyperframesCardMarkdown(report = {}) {
  const lines = [];
  lines.push("# Fresh Refill HyperFrames Card Evidence");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Status: ${report.status}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- candidate stories: ${report.summary?.candidate_story_count || 0}`);
  lines.push(`- attempted: ${report.summary?.attempted_count || 0}`);
  lines.push(`- completed: ${report.summary?.completed_count || 0}`);
  lines.push(`- failed: ${report.summary?.failed_count || 0}`);
  lines.push(`- card evidence blocked: ${report.summary?.card_evidence_blocked_count || 0}`);
  lines.push(
    `- shortest planned card dwell: ${report.summary?.shortest_planned_visible_duration_s ?? "unknown"}s`,
  );
  lines.push(
    `- longest required card dwell: ${report.summary?.longest_required_visible_duration_s ?? "unknown"}s`,
  );
  lines.push("");
  lines.push("## Stories");
  lines.push("");
  for (const item of report.stories || []) {
    lines.push(
      `- ${item.story_id}: ${item.status} (${item.passing_card_count || 0}/${item.card_count || 0} cards pass)`,
    );
    if (item.shortest_planned_visible_duration_s != null) {
      lines.push(`  - shortest planned dwell: ${item.shortest_planned_visible_duration_s}s`);
    }
    if (item.longest_required_visible_duration_s != null) {
      lines.push(`  - longest required dwell: ${item.longest_required_visible_duration_s}s`);
    }
    for (const blocker of item.blockers || []) {
      lines.push(`  - blocker: ${blocker}`);
    }
  }
  if (!report.stories?.length) lines.push("- none");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local HyperFrames card generation only.");
  lines.push("- No manual publish, DB mutation, OAuth/token mutation or disabled-platform enablement.");
  return lines.join("\n") + "\n";
}

function freshRefillHyperframesCardTimeoutMs(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return 6 * 60 * 1000;
  return Math.min(15 * 60 * 1000, Math.max(60 * 1000, Math.round(requested)));
}

function freshRefillAudioTimestampMaterializerTimeoutMs(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return 30 * 60 * 1000;
  return Math.min(
    60 * 60 * 1000,
    Math.max(15 * 60 * 1000, Math.round(requested)),
  );
}

async function buildFreshRefillHyperframesCardEvidence({
  candidateStoriesPath,
  candidateStoryIds = [],
  outputDir,
  channelId = "pulse-gaming",
  runChild,
  log,
  childProcesses,
}) {
  const storyIds = uniqueClean(candidateStoryIds);
  await fs.ensureDir(outputDir);
  const stories = [];
  const startedCount = childProcesses.length;
  const cardTimeoutMs = freshRefillHyperframesCardTimeoutMs(
    process.env.PULSE_FRESH_REFILL_HYPERFRAMES_CARD_TIMEOUT_MS,
  );
  for (const storyId of storyIds) {
    const ok = await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_hyperframes_story_cards",
      timeoutMs: cardTimeoutMs,
      args: [
        "tools/studio-v2-build-story-cards.js",
        "--story-file",
        candidateStoriesPath,
        "--story-id",
        storyId,
        "--channel-id",
        channelId,
      ],
    });
    const storyEvidence = await collectFreshRefillHyperframesCardStoryEvidence({
      storyId,
      channelId,
    });
    stories.push({
      ...storyEvidence,
      child_process_status: ok ? "completed" : "failed",
      status: ok ? storyEvidence.status : "failed",
    });
  }
  const cardChildren = childProcesses.slice(startedCount);
  const failedCount = cardChildren.filter((child) => !child.ok).length;
  const evidenceBlockedCount = stories.filter((story) => story.status === "blocked").length;
  const visibleDurations = stories
    .map((story) => story.shortest_planned_visible_duration_s)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  const requiredDurations = stories
    .map((story) => story.longest_required_visible_duration_s)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: !storyIds.length
      ? "skipped"
      : failedCount || evidenceBlockedCount
        ? "partial"
        : "generated",
    summary: {
      candidate_story_count: storyIds.length,
      attempted_count: cardChildren.length,
      completed_count: cardChildren.filter((child) => child.ok).length,
      failed_count: failedCount,
      card_evidence_blocked_count: evidenceBlockedCount,
      card_count: stories.reduce((sum, story) => sum + Number(story.card_count || 0), 0),
      passing_card_count: stories.reduce((sum, story) => sum + Number(story.passing_card_count || 0), 0),
      failing_card_count: stories.reduce((sum, story) => sum + Number(story.failing_card_count || 0), 0),
      shortest_planned_visible_duration_s: visibleDurations.length
        ? Number(Math.min(...visibleDurations).toFixed(3))
        : null,
      longest_required_visible_duration_s: requiredDurations.length
        ? Number(Math.max(...requiredDurations).toFixed(3))
        : null,
    },
    candidate_stories_path: candidateStoriesPath,
    channel_id: channelId,
    stories,
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
    },
  };
  const reportPath = path.join(outputDir, "fresh_refill_hyperframes_card_evidence.json");
  const markdownPath = path.join(outputDir, "fresh_refill_hyperframes_card_evidence.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderFreshRefillHyperframesCardMarkdown(report), "utf8");
  return {
    status: report.status,
    report_path: reportPath,
    markdown_path: markdownPath,
    completed_count: report.summary.completed_count,
    failed_count: report.summary.failed_count,
    evidence_blocked_count: report.summary.card_evidence_blocked_count,
    card_count: report.summary.card_count,
    passing_card_count: report.summary.passing_card_count,
    failing_card_count: report.summary.failing_card_count,
    shortest_planned_visible_duration_s: report.summary.shortest_planned_visible_duration_s,
    longest_required_visible_duration_s: report.summary.longest_required_visible_duration_s,
  };
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
  lines.push(`- motion-repair eligible packages: ${report.summary.repair_eligible_story_package_count}`);
  lines.push(`- motion-repair attempted this run: ${report.summary.repair_attempt_story_package_count ?? report.summary.repair_eligible_story_package_count}`);
  lines.push(`- motion-repair deferred by run limit: ${report.summary.repair_deferred_by_limit_count || 0}`);
  lines.push(`- quarantined packages: ${report.summary.quarantined_story_package_count}`);
  lines.push(`- script rewrite work-order jobs: ${report.summary.script_rewrite_work_order_count || 0}`);
  if (report.summary.script_rewrite_blocked_reasons?.length) {
    lines.push(`- script rewrite blocked reasons: ${report.summary.script_rewrite_blocked_reasons.join(", ")}`);
  }
  lines.push(`- official source entries: ${report.summary.official_source_entries_count}`);
  lines.push(`- accepted official references: ${report.summary.accepted_official_source_count}`);
  lines.push(`- direct media intake accepted: ${report.summary.direct_media_intake_accepted_count || 0}`);
  lines.push(
    `- materializable direct media accepted: ${report.summary.direct_media_intake_materializable_accepted_count || 0}`,
  );
  lines.push(`- reference-only direct media accepted: ${report.summary.direct_media_intake_reference_only_accepted_count || 0}`);
  lines.push(`- segment validation: ${report.summary.segment_validation_status || "not_attempted"}`);
  lines.push(
    `- real motion materialisation: ${report.summary.real_motion_materialization_status || "not_attempted"}`,
  );
  lines.push(`- child processes: ${report.summary.child_process_count}`);
  lines.push(`- failed child processes: ${report.summary.failed_child_process_count}`);
  if (report.summary.quarantined_package_ids?.length) {
    lines.push(`- quarantined ids: ${report.summary.quarantined_package_ids.join(", ")}`);
  }
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
    if (child.ok) {
      lines.push(`- ${child.child_kind}: ok`);
      continue;
    }
    const details = [
      child.failure_reason,
      child.exit_code !== null && child.exit_code !== undefined ? `exit=${child.exit_code}` : "",
      child.signal ? `signal=${child.signal}` : "",
      child.timed_out ? "timed_out=true" : "",
      child.error ? `error=${clean(child.error).slice(0, 160)}` : "",
    ].filter(Boolean);
    lines.push(`- ${child.child_kind}: failed (${details.join("; ") || "unknown"})`);
    if (child.stdout_tail) lines.push(`  - stdout_tail: ${clean(child.stdout_tail).slice(-240)}`);
    if (child.stderr_tail) lines.push(`  - stderr_tail: ${clean(child.stderr_tail).slice(-240)}`);
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
  const discoveredEntries = Array.isArray(template)
    ? template
    : Array.isArray(template?.entries)
      ? template.entries
      : [];
  const sourceManifestEntries = await readJsonIfPresent(sourceEvidence.officialSourceEntriesPath, []);
  const entries = mergeFreshRefillDirectMediaIntakeEntries({
    sourceManifestEntries,
    discoveredEntries,
  });
  if (!entries.length) {
    return {
      status: "skipped",
      reason: "direct_media_template_empty",
      report_path: null,
      markdown_path: null,
      accepted_count: 0,
      materializable_accepted_count: 0,
      reference_only_accepted_count: 0,
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
  const materializableAcceptedEntries = (report.accepted_entries || []).filter((entry) => {
    const directUrl = clean(entry.direct_media_url_if_available);
    if (!directUrl) return false;
    if (entry.segment_validation_eligible === false) return false;
    return /\.(?:mp4|mov|m4v|webm|m3u8)(?:[?#]|$)/i.test(directUrl);
  });
  const referenceOnlyAcceptedEntries = (report.accepted_entries || []).filter((entry) => {
    if (entry.segment_validation_eligible === false) return true;
    if (clean(entry.accepted_for) === "reference_validation_only" && !clean(entry.direct_media_url_if_available)) return true;
    return false;
  });
  report.summary = {
    ...(report.summary || {}),
    materializable_accepted: materializableAcceptedEntries.length,
    reference_only_accepted: referenceOnlyAcceptedEntries.length,
  };
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
    materializable_accepted_count: report.summary?.materializable_accepted || 0,
    reference_only_accepted_count: report.summary?.reference_only_accepted || 0,
    rejected_count: report.summary?.rejected || 0,
    entries_count: report.summary?.entries || entries.length,
  };
}

function directMediaUrlFromFreshRefillEntry(entry = {}) {
  return clean(
    entry.direct_media_url_if_available ||
      entry.approved_direct_media_url ||
      entry.direct_media_url ||
      entry.source_url ||
      entry.official_source_url,
  );
}

function freshRefillDirectMediaEntryKey(entry = {}) {
  const directMediaUrl = directMediaUrlFromFreshRefillEntry(entry).toLowerCase();
  return [
    clean(entry.story_id).toLowerCase(),
    clean(entry.source_family).toLowerCase(),
    directMediaUrl,
  ].join("|");
}

function freshRefillSegmentEligibleDirectMediaEntry(entry = {}) {
  const directMediaUrl = directMediaUrlFromFreshRefillEntry(entry);
  if (!directMediaUrl) return false;
  const sourceKind = mediaSourceUrlKindFields(directMediaUrl);
  return sourceKind.segment_validation_eligible === true;
}

function freshRefillReferenceOnlyOfficialEntry(entry = {}) {
  const sourceType = clean(entry.source_type).toLowerCase();
  const officialSourceUrl = clean(entry.official_source_url || entry.source_url || entry.url);
  if (!officialSourceUrl) return false;
  if (clean(entry.direct_media_url_if_available || entry.approved_direct_media_url || entry.direct_media_url)) {
    return false;
  }
  if (sourceType !== "official_youtube_channel_url") return false;
  const sourceKind = mediaSourceUrlKindFields(officialSourceUrl);
  return (
    /^youtube_/i.test(clean(sourceKind.source_url_kind)) &&
    entry.segment_validation_eligible === false &&
    clean(entry.segment_validation_ineligible_reason) === "segment_source_is_youtube_reference"
  );
}

function mergeFreshRefillDirectMediaIntakeEntries({
  sourceManifestEntries = [],
  discoveredEntries = [],
} = {}) {
  const rows = [];
  const seen = new Set();

  function add(entry = {}) {
    if (!freshRefillSegmentEligibleDirectMediaEntry(entry) && !freshRefillReferenceOnlyOfficialEntry(entry)) return;
    const key = freshRefillDirectMediaEntryKey(entry);
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(entry);
  }

  for (const entry of Array.isArray(sourceManifestEntries) ? sourceManifestEntries : []) add(entry);
  for (const entry of Array.isArray(discoveredEntries) ? discoveredEntries : []) add(entry);
  return rows;
}

function freshRefillSegmentValidationBudget(storyPackageCount) {
  return {
    maxSegments: 96,
    candidateWindowsPerSource: 4,
    includeFrameAnchoredWindows: true,
  };
}

function freshRefillSegmentValidationTimeoutMs({ budget = {}, storyPackageCount = 0, env = process.env } = {}) {
  const override = Number(env.PULSE_FRESH_REFILL_SEGMENT_VALIDATION_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return Math.round(override);

  const maxSegments = Math.max(1, Number(budget.maxSegments || 48) || 48);
  const stories = Math.max(1, Math.min(4, Number(storyPackageCount || 1) || 1));
  const minMs = 6 * 60 * 1000;
  const maxMs = 12 * 60 * 1000;
  const segmentBudgetMs = maxSegments * 7500;
  const multiStoryBufferMs = Math.max(0, stories - 1) * 2 * 60 * 1000;
  return Math.min(maxMs, Math.max(minMs, Math.round(segmentBudgetMs + multiStoryBufferMs)));
}

function hydratedFreshProductionRefillArgs({
  baseArgs = [],
  candidateStoriesPath,
  repairMotionPackDir,
  candidateStoryIds = [],
  allowOwnedMotionFallback = false,
  existingArtifactRoot = "",
} = {}) {
  const args = [];
  for (let i = 0; i < baseArgs.length; i += 1) {
    const arg = baseArgs[i];
    if (arg === "--live-rss") continue;
    if (arg === "--live-rss-only") continue;
    if (arg === "--stories-file") {
      i += 1;
      continue;
    }
    if (arg === "--rss-per-feed") {
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      const baseOutDir = baseArgs[++i];
      args.push(arg, path.join(baseOutDir, "motion-hydrated"));
      continue;
    }
    if (arg === "--contract-out-dir") {
      const baseContractOutDir = baseArgs[++i];
      args.push(arg, path.join(baseContractOutDir, "motion-hydrated"));
      continue;
    }
    args.push(arg);
  }
  const storyFile = clean(candidateStoriesPath);
  if (storyFile) {
    args.unshift(storyFile);
    args.unshift("--stories-file");
  }
  args.push("--v4-motion-pack-dir", repairMotionPackDir);
  if (allowOwnedMotionFallback) args.push("--allow-owned-motion-fallback");
  if (clean(existingArtifactRoot)) {
    args.push("--existing-artifact-root", clean(existingArtifactRoot));
  }
  const ids = uniqueClean(candidateStoryIds);
  if (ids.length) args.push("--story-id", ids.join(","));
  return args;
}

function freshRefillWorkOrderJobsWithAction(workOrder = {}, actionId = "") {
  const wanted = clean(actionId);
  if (!wanted) return [];
  return (Array.isArray(workOrder.jobs) ? workOrder.jobs : []).filter((job) =>
    (Array.isArray(job.actions) ? job.actions : []).some((action) => clean(action?.action_id) === wanted),
  );
}

function freshRefillWorkOrderJobsWithAnyAction(workOrder = {}, actionIds = []) {
  const wanted = new Set(uniqueClean(actionIds));
  if (!wanted.size) return [];
  return (Array.isArray(workOrder.jobs) ? workOrder.jobs : []).filter((job) =>
    (Array.isArray(job.actions) ? job.actions : []).some((action) => wanted.has(clean(action?.action_id))),
  );
}

function freshRefillWorkOrderWithForcedRenderJobs(workOrder = {}, storyIds = []) {
  const wanted = new Set(uniqueClean(storyIds));
  if (!wanted.size) return workOrder;
  const next = JSON.parse(JSON.stringify(workOrder || {}));
  next.jobs = (Array.isArray(next.jobs) ? next.jobs : []).map((job) => {
    const storyId = clean(job?.story_id);
    if (!wanted.has(storyId)) return job;
    const artifactDir = clean(job.artifact_dir);
    const targetRenderManifest = job.target_render_manifest || {
      renderer: "visual_v4_production",
      output: "visual_v4_render.mp4",
      local_promotion_only: true,
    };
    const existingActions = Array.isArray(job.actions) ? job.actions : [];
    const hasRenderAction = existingActions.some((action) =>
      clean(action?.action_id) === "run_visual_v4_production_render",
    );
    const actions = hasRenderAction
      ? existingActions.map((action) =>
          clean(action?.action_id) === "run_visual_v4_production_render"
            ? { ...action, force: true, reason: "fresh_audio_timestamps_regenerated" }
            : action,
        )
      : [
          ...existingActions,
          {
            action_id: "run_visual_v4_production_render",
            status: "ready_after_inputs",
            repair_lane: "visual_v4_production_render",
            exact_missing_input: "fresh Visual V4 production render after narration regeneration",
            required_artefact_path: artifactDir ? path.join(artifactDir, "visual_v4_render.mp4") : "",
            auto_repairable: true,
            operator_approval_required: false,
            dead_end_blocker: false,
            force: true,
            reason: "fresh_audio_timestamps_regenerated",
            target_render_manifest: targetRenderManifest,
            output_expectations: [
              "visual_v4_render.mp4 is regenerated after final narration and word timestamps change",
              "render_manifest.json matches the current narration, timestamps and motion inputs",
            ],
          },
        ];
    return {
      ...job,
      status: "ready_for_final_render_job",
      force_final_render: true,
      blockers: uniqueClean([
        ...(Array.isArray(job.blockers) ? job.blockers : []),
        "render_stale_after_audio_regeneration",
      ]),
      actions,
    };
  });
  return next;
}

async function freshRefillMaterializedAudioStoryIdsFromReport({
  reportPath = "",
  candidateStoryIds = [],
  fallbackStoryIds = [],
} = {}) {
  const wanted = new Set(uniqueClean(candidateStoryIds));
  const fallback = uniqueClean(fallbackStoryIds).filter((storyId) => !wanted.size || wanted.has(storyId));
  const resolved = clean(reportPath);
  if (!resolved || !(await fs.pathExists(resolved))) return fallback;
  const report = await readJsonIfPresent(resolved, {});
  const reportJobs = Array.isArray(report.jobs) ? report.jobs : [];
  const materialized = uniqueClean(
    reportJobs
      .filter((job) => {
        const storyId = clean(job?.story_id);
        if (!storyId || (wanted.size && !wanted.has(storyId))) return false;
        const status = clean(job?.status).toLowerCase();
        return ["materialized", "generated", "regenerated", "refreshed"].includes(status);
      })
      .map((job) => job.story_id),
  );
  return materialized;
}

function motionPackFamilyCount(manifest = {}) {
  const explicit = Number(
    manifest.distinct_base_source_family_count ||
      manifest.distinct_motion_family_count ||
      manifest.direct_video_motion_family_count ||
      manifest.summary?.distinct_base_source_family_count ||
      manifest.summary?.distinct_motion_family_count ||
      0,
  );
  if (explicit > 0) return explicit;
  const clips = asArray(manifest.clips || manifest.motion_clips || manifest.materialised_clips);
  return uniqueClean(
    clips.map((clip) =>
      clip.base_source_family ||
      clip.source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
    ),
  ).length;
}

function motionPackClipCount(manifest = {}) {
  const explicit = Number(
    manifest.clip_count ||
      manifest.motion_clip_count ||
      manifest.direct_video_motion_asset_count ||
      manifest.summary?.clip_count ||
      manifest.summary?.motion_clip_count ||
      0,
  );
  if (explicit > 0) return explicit;
  return asArray(manifest.clips || manifest.motion_clips || manifest.materialised_clips).length;
}

function motionPackIsReadyForFreshRefill(manifest = {}) {
  const status = clean(
    manifest.readiness?.status ||
      manifest.readiness_status ||
      manifest.status ||
      manifest.verdict,
  );
  const blockers = [
    ...asArray(manifest.blockers),
    ...asArray(manifest.readiness?.blockers),
  ];
  return (
    ["v4_motion_ready", "ready", "pass", "green"].includes(status) &&
    blockers.length === 0 &&
    motionPackClipCount(manifest) >= 5 &&
    motionPackFamilyCount(manifest) >= 4
  );
}

async function freshRefillExistingMotionReadyStoryIds({
  candidateStoryIds = [],
  motionPackDir = "",
} = {}) {
  const ids = uniqueClean(candidateStoryIds);
  const dir = clean(motionPackDir);
  if (!ids.length || !dir || !(await fs.pathExists(dir))) return [];
  const readyIds = [];
  for (const storyId of ids) {
    const manifestPath = path.join(dir, `${storyId}_motion_pack_manifest.json`);
    if (!(await fs.pathExists(manifestPath))) continue;
    const manifest = await readJsonIfPresent(manifestPath, {});
    if (motionPackIsReadyForFreshRefill(manifest)) readyIds.push(storyId);
  }
  return readyIds;
}

async function writeFreshRefillContinuationWorkOrder({
  storyPackagesPath,
  outputDir,
  generatedAt = new Date().toISOString(),
  segmentReportPath = "",
  realMotionOutDir = "",
  realMotionArtifactRoot = "",
} = {}) {
  const packages = await readFreshRefillEvidenceRows(storyPackagesPath);
  const { buildLocalPromotionRenderInputWorkOrder } = require("./fresh-green-buffer-local-promotion");
  const { writeGoalRenderInputWorkOrder } = require("./goal-render-input-workorder");
  const workOrder = buildLocalPromotionRenderInputWorkOrder({
    packages,
    generatedAt,
    storyPackagesPath,
    outputDir,
    renderInputWorkOrderPath: path.join(outputDir, "render_input_work_order.json"),
    productionCutoverPlanPath: path.join(outputDir, "production_render_cutover_plan.json"),
    segmentReportPath,
    realMotionOutDir,
    realMotionArtifactRoot,
  });
  const written = await writeGoalRenderInputWorkOrder(workOrder, {
    outputDir,
  });
  return {
    packages,
    workOrder,
    written,
  };
}

async function freshRefillHyperframesStoryIdsAfterMotion({
  candidateStoryIds = [],
  realMotionReportPath = "",
  motionPackDir = "",
  sourceCardFallbackStoryIds = [],
  ownedMotionReadyStoryIds = [],
} = {}) {
  const fallbackIds = uniqueClean(candidateStoryIds);
  const candidateSet = new Set(fallbackIds);
  const sourceCardFallbackIds = uniqueClean(sourceCardFallbackStoryIds).filter((storyId) =>
    candidateSet.has(storyId),
  );
  const reportPath = clean(realMotionReportPath);
  const motionReadyIds = await freshRefillExistingMotionReadyStoryIds({
    candidateStoryIds: fallbackIds,
    motionPackDir,
  });
  const ownedMotionReadyIds = uniqueClean(ownedMotionReadyStoryIds).filter(
    (storyId) => candidateSet.has(storyId),
  );
  if (!reportPath || !(await fs.pathExists(reportPath))) {
    const readyIds = uniqueClean([
      ...motionReadyIds,
      ...ownedMotionReadyIds,
    ]);
    return readyIds.length ? readyIds : fallbackIds;
  }

  const report = await readJsonIfPresent(reportPath, {});
  const jobs = Array.isArray(report.jobs) ? report.jobs : [];
  const materializedIds = uniqueClean(
    jobs
      .filter((job) => {
        const status = clean(job.status);
        if (status === "materialized") return true;
        if (status === "ready" || status === "ready_for_scheduler_preflight") return true;
        return (
          Number(job.materialized_count || 0) > 0 &&
          Number(job.total_direct_video_motion_family_count || job.direct_video_motion_family_count || 0) >= 5 &&
          !asArray(job.blockers).length
        );
      })
      .map((job) => job.story_id),
  );
  const realMotionStoryIds = uniqueClean([
    ...materializedIds,
    ...motionReadyIds,
    ...ownedMotionReadyIds,
  ]);
  if (!realMotionStoryIds.length && sourceCardFallbackIds.length) {
    return [];
  }
  return realMotionStoryIds;
}

function freshRefillPlatformVariantChildArgs({ storyPackagesPath, outputDir } = {}) {
  return [
    "tools/goal-platform-variant-materializer.js",
    "--story-packages",
    clean(storyPackagesPath),
    "--out-dir",
    clean(outputDir),
    "--json",
  ];
}

async function runFreshRefillMaterializationContinuation({
  storyPackagesPath,
  segmentReportPath = "",
  realMotionOutDir = "",
  realMotionArtifactRoot = "",
  generatedAt = new Date().toISOString(),
  narrationProvider = "local",
  runChild,
  log,
} = {}) {
  const resolvedStoryPackagesPath = clean(storyPackagesPath);
  if (!resolvedStoryPackagesPath || !(await fs.pathExists(resolvedStoryPackagesPath))) {
    return {
      status: "skipped",
      reason: "story_packages_missing",
      story_packages_path: resolvedStoryPackagesPath,
    };
  }

  const continuationDir = path.join(path.dirname(resolvedStoryPackagesPath), "materialization-continuation");
  await fs.ensureDir(continuationDir);
  const childProcesses = [];
  const providerPreference = clean(narrationProvider).toLowerCase() === "elevenlabs" ? "elevenlabs" : "local";
  let initial = await writeFreshRefillContinuationWorkOrder({
    storyPackagesPath: resolvedStoryPackagesPath,
    outputDir: continuationDir,
    generatedAt,
    segmentReportPath,
    realMotionOutDir,
    realMotionArtifactRoot,
  });
  const storyIds = uniqueClean(initial.packages.map((row) => freshRefillStoryId(row)));
  if (!storyIds.length) {
    return {
      status: "skipped",
      reason: "no_story_packages",
      story_packages_path: resolvedStoryPackagesPath,
      outputs: {
        continuation_dir: continuationDir,
        render_input_work_order: initial.written.jsonPath,
      },
    };
  }

  const initialAutoRepairItems = Array.isArray(initial.workOrder?.auto_repair_plan?.items)
    ? initial.workOrder.auto_repair_plan.items
    : [];
  const autoRepairRunnerOutDir = path.join(continuationDir, "auto-repair-runner");
  const needsTtsPrewarm = initialAutoRepairItems.some((item) =>
    /goal-audio-timestamps|goal-public-copy-repair/i.test(clean(item.recommended_command || item.command)),
  );
  if (needsTtsPrewarm && providerPreference === "local") {
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_local_tts_doctor",
      args: [
        "tools/local-tts-doctor.js",
        "--json",
        "--restart",
        "--prewarm",
        "--smoke",
      ],
    });
  }
  if (initialAutoRepairItems.length) {
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_contextual_auto_repair_runner",
      args: [
        "tools/auto-repair-runner.js",
        "--plan",
        initial.written.autoRepairPlanPath,
        "--out-dir",
        autoRepairRunnerOutDir,
        "--limit",
        String(initialAutoRepairItems.length),
        "--execute",
        "--json",
      ],
    });
  }

  const afterAutoRepair = await writeFreshRefillContinuationWorkOrder({
    storyPackagesPath: resolvedStoryPackagesPath,
    outputDir: continuationDir,
    generatedAt,
    segmentReportPath,
    realMotionOutDir,
    realMotionArtifactRoot,
  });
  const audioJobs = freshRefillWorkOrderJobsWithAnyAction(
    afterAutoRepair.workOrder,
    [
      "generate_final_narration_audio_and_word_timestamps",
      "generate_caption_file",
    ],
  );
  const audioStoryIds = uniqueClean(audioJobs.map((job) => job.story_id));
  const audioWorkbenchPath = path.join(continuationDir, "audio_timestamp_workbench.json");
  const audioMaterializationReportPath = path.join(continuationDir, "audio_timestamp_materialization_report.json");
  let audioMaterializedOk = false;
  let audioMaterializedStoryIds = [];
  if (audioStoryIds.length) {
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_audio_timestamp_workbench",
      args: [
        "tools/goal-audio-timestamp-workbench.js",
        "--work-order",
        afterAutoRepair.written.jsonPath,
        "--out-dir",
        continuationDir,
        "--workspace",
        ROOT,
        "--provider",
        providerPreference,
        ...audioStoryIds.flatMap((storyId) => ["--story-id", storyId]),
        "--json",
      ],
    });
    audioMaterializedOk = await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_audio_timestamp_materializer",
      timeoutMs: freshRefillAudioTimestampMaterializerTimeoutMs(
        process.env.PULSE_FRESH_REFILL_AUDIO_MATERIALIZER_TIMEOUT_MS,
      ),
      args: [
        "tools/goal-audio-timestamp-materializer.js",
        "--workbench",
        audioWorkbenchPath,
        "--out-dir",
        continuationDir,
        "--workspace",
        ROOT,
        "--provider",
        providerPreference,
        "--alignment",
        "whisper",
        ...audioStoryIds.flatMap((storyId) => ["--story-id", storyId]),
        "--json",
      ],
    });
    audioMaterializedStoryIds = await freshRefillMaterializedAudioStoryIdsFromReport({
      reportPath: audioMaterializationReportPath,
      candidateStoryIds: audioStoryIds,
      fallbackStoryIds: audioMaterializedOk ? audioStoryIds : [],
    });
  }

  const afterAudio = await writeFreshRefillContinuationWorkOrder({
    storyPackagesPath: resolvedStoryPackagesPath,
    outputDir: continuationDir,
    generatedAt,
    segmentReportPath,
    realMotionOutDir,
    realMotionArtifactRoot,
  });
  const audioRegeneratedRerenderStoryIds = audioMaterializedStoryIds.length
    ? uniqueClean(
        audioMaterializedStoryIds.filter((storyId) =>
          (Array.isArray(afterAudio.workOrder.jobs) ? afterAudio.workOrder.jobs : []).some(
            (job) => clean(job.story_id) === storyId,
          ),
        ),
      )
    : [];
  const renderJobs = (Array.isArray(afterAudio.workOrder.jobs) ? afterAudio.workOrder.jobs : []).filter(
    (job) =>
      clean(job.status) === "ready_for_final_render_job" ||
      audioRegeneratedRerenderStoryIds.includes(clean(job.story_id)),
  );
  const renderStoryIds = uniqueClean(renderJobs.map((job) => job.story_id));
  const renderWorkOrderPath = audioRegeneratedRerenderStoryIds.length
    ? path.join(continuationDir, "audio_regenerated_render_input_work_order.json")
    : afterAudio.written.jsonPath;
  if (audioRegeneratedRerenderStoryIds.length) {
    await fs.writeJson(
      renderWorkOrderPath,
      freshRefillWorkOrderWithForcedRenderJobs(afterAudio.workOrder, audioRegeneratedRerenderStoryIds),
      { spaces: 2 },
    );
  }
  if (renderStoryIds.length) {
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_final_render_materializer",
      args: [
        "tools/goal-production-render-materializer.js",
        "--work-order",
        renderWorkOrderPath,
        "--out-dir",
        continuationDir,
        "--workspace",
        ROOT,
        "--limit",
        String(renderStoryIds.length),
        ...(audioRegeneratedRerenderStoryIds.length ? ["--force"] : []),
        "--json",
      ],
    });
  }

  const afterRender = await writeFreshRefillContinuationWorkOrder({
    storyPackagesPath: resolvedStoryPackagesPath,
    outputDir: continuationDir,
    generatedAt,
    segmentReportPath,
    realMotionOutDir,
    realMotionArtifactRoot,
  });
  const schedulerReadyJobs = (Array.isArray(afterRender.workOrder.jobs) ? afterRender.workOrder.jobs : []).filter(
    (job) => clean(job.status) === "ready_for_scheduler_preflight",
  );
  if (schedulerReadyJobs.length) {
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_platform_native_pack_repair",
      args: [
        "tools/goal-platform-native-pack-repair.js",
        "--story-packages",
        resolvedStoryPackagesPath,
        "--out-dir",
        continuationDir,
        "--backup-root",
        path.join(continuationDir, "native-pack-repair-backups"),
        "--apply",
        ...storyIds.flatMap((storyId) => ["--story-id", storyId]),
        "--json",
      ],
    });
  }
  await runFreshRefillRepairChild({
    runChild,
    log,
    childProcesses,
    childKind: "fresh_refill_platform_variant_materializer",
    args: freshRefillPlatformVariantChildArgs({
      storyPackagesPath: resolvedStoryPackagesPath,
      outputDir: continuationDir,
    }),
  });

  const failedChildProcessCount = childProcesses.filter((child) => !child.ok).length;
  const finalWorkOrder = await writeFreshRefillContinuationWorkOrder({
    storyPackagesPath: resolvedStoryPackagesPath,
    outputDir: continuationDir,
    generatedAt,
    segmentReportPath,
    realMotionOutDir,
    realMotionArtifactRoot,
  });
  const finalSchedulerReadyJobs = (Array.isArray(finalWorkOrder.workOrder.jobs) ? finalWorkOrder.workOrder.jobs : []).filter(
    (job) => clean(job.status) === "ready_for_scheduler_preflight",
  );
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    status: failedChildProcessCount ? "partial" : "completed",
    story_packages_path: resolvedStoryPackagesPath,
    summary: {
      story_count: storyIds.length,
      audio_story_count: audioStoryIds.length,
      audio_regenerated_rerender_story_count: audioRegeneratedRerenderStoryIds.length,
      render_ready_story_count: renderStoryIds.length,
      scheduler_ready_story_count: finalSchedulerReadyJobs.length,
      auto_repair_item_count: initialAutoRepairItems.length,
      child_process_count: childProcesses.length,
      failed_child_process_count: failedChildProcessCount,
    },
    story_ids: storyIds,
    audio_story_ids: audioStoryIds,
    audio_regenerated_rerender_story_ids: audioRegeneratedRerenderStoryIds,
    render_story_ids: renderStoryIds,
    narration_provider_preference: providerPreference,
    scheduler_ready_story_ids: uniqueClean(finalSchedulerReadyJobs.map((job) => job.story_id)),
    outputs: {
      continuation_dir: continuationDir,
      initial_render_input_work_order: initial.written.jsonPath,
      post_auto_repair_render_input_work_order: afterAutoRepair.written.jsonPath,
      audio_timestamp_workbench: audioWorkbenchPath,
      audio_timestamp_materialization_report: audioMaterializationReportPath,
      audio_regenerated_render_input_work_order: audioRegeneratedRerenderStoryIds.length
        ? renderWorkOrderPath
        : null,
      auto_repair_runner_out_dir: autoRepairRunnerOutDir,
      final_render_input_work_order: finalWorkOrder.written.jsonPath,
      repair_backlog: finalWorkOrder.written.repairBacklogPath,
      auto_repair_plan: finalWorkOrder.written.autoRepairPlanPath,
      post_repair_validation_plan: finalWorkOrder.written.postRepairValidationPlanPath,
    },
    child_processes: childProcesses,
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
      gates_weakened: false,
      external_tts_provider_used: providerPreference === "elevenlabs" ? "elevenlabs" : null,
    },
  };
  const reportPath = path.join(continuationDir, "fresh_refill_materialization_continuation_report.json");
  const markdownPath = path.join(continuationDir, "fresh_refill_materialization_continuation_report.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(
    markdownPath,
    [
      "# Fresh Refill Materialization Continuation",
      "",
      `Generated: ${report.generated_at}`,
      `Status: ${report.status}`,
      `Stories: ${report.summary.story_count}`,
      `Audio/timestamp jobs: ${report.summary.audio_story_count}`,
      `Final render jobs: ${report.summary.render_ready_story_count}`,
      `Scheduler-ready local packages: ${report.summary.scheduler_ready_story_count}`,
      "",
      "Safety: local materialisation only. No publishing, DB mutation, OAuth/token change or disabled-platform enablement.",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    ...report,
    report_path: reportPath,
    markdown_path: markdownPath,
  };
}

async function buildFreshProductionRefillRepairPlanEvidence({
  outputs,
  outDir,
  contractOutDir,
  storyCount,
  redCount,
  alreadyReadyStoryIds = [],
  repairStoryLimit,
}) {
  const storyPackagesPath = clean(outputs?.storyPackagesPath);
  if (!redCount) return { status: "not_needed", reason: "no_red_packages" };
  if (!storyPackagesPath || !(await fs.pathExists(storyPackagesPath))) {
    return { status: "skipped", reason: "story_packages_missing", storyPackagesPath };
  }

  const contractDir = path.resolve(contractOutDir || path.dirname(storyPackagesPath));
  const repairDir = path.join(contractDir, "fresh_production_refill_repair");
  await fs.ensureDir(repairDir);
  const packageFilter = await buildFreshRefillRepairPackageFilter({
    storyPackagesPath,
    outputDir: repairDir,
    alreadyReadyStoryIds,
  });
  const scriptRewriteWorkOrder = await buildFreshRefillScriptRewriteWorkOrder({
    quarantinedRows: packageFilter.quarantinedRows,
    outputDir: repairDir,
  });
  const {
    allRepairStoryPackageRows,
    repairStoryLimitValue,
    storyPackageRows,
    repairDeferredByLimitRows,
    repairStoryPackagesPath,
    repairAttemptStoryPackagesPath,
    repairDeferredStoryPackagesPath,
    repairPriorityReportPath,
  } = await freshRefillRepairAttemptScope({
    packageFilter,
    repairStoryLimit,
    repairDir,
  });
  const sourceEvidence = await buildFreshRefillOfficialSourceEvidence({
    storyPackagesPath: repairStoryPackagesPath,
    outputDir: repairDir,
  });
  const declaredEligibleStoryCount = Math.max(
    0,
    (Number(storyCount || 0) || 0) -
      packageFilter.quarantinedRows.length -
      packageFilter.alreadyReadyRows.length,
  );
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: "planned",
    mode: "plan",
    summary: {
      story_package_count: packageFilter.rows.length,
      repair_eligible_story_package_count: allRepairStoryPackageRows.length,
      repair_attempt_story_package_count: storyPackageRows.length,
      repair_deferred_by_limit_count: repairDeferredByLimitRows.length,
      repair_story_limit: repairStoryLimitValue,
      quarantined_story_package_count: packageFilter.quarantinedRows.length,
      already_ready_skipped_story_package_count: packageFilter.alreadyReadyRows.length,
      script_blocked_package_count: packageFilter.quarantinedRows.length,
      script_rewrite_work_order_count: scriptRewriteWorkOrder.jobCount,
      quarantined_package_ids: packageFilter.quarantinedRows.map((row) => row.story_id).filter(Boolean),
      repair_attempt_story_ids: storyPackageRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
      repair_deferred_by_limit_story_ids:
        repairDeferredByLimitRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
      already_ready_skipped_package_ids:
        packageFilter.alreadyReadyRows.map((row) => row.story_id).filter(Boolean),
      effective_story_package_count: storyPackageRows.length || declaredEligibleStoryCount,
      official_source_entries_count: sourceEvidence.official_source_entries_count,
      accepted_official_source_count: sourceEvidence.accepted_official_source_count,
      rejected_official_source_count: sourceEvidence.rejected_official_source_count,
      supplemental_official_search_entry_count: 0,
      official_search_entry_count: 0,
      direct_media_intake_entries_count: 0,
      direct_media_intake_accepted_count: 0,
      direct_media_intake_materializable_accepted_count: 0,
      direct_media_intake_reference_only_accepted_count: 0,
      direct_media_intake_rejected_count: 0,
      real_motion_materialization_status: "not_attempted",
      real_motion_materialized_story_count: 0,
      real_motion_materialized_clip_count: 0,
      hyperframes_card_evidence_status: "not_attempted",
      hyperframes_card_sets_completed: 0,
      hyperframes_card_sets_failed: 0,
      hyperframes_card_evidence_blocked_count: 0,
      hyperframes_card_count: 0,
      hyperframes_card_passing_count: 0,
      hyperframes_card_failing_count: 0,
      child_process_count: 0,
      failed_child_process_count: 0,
    },
    outputs: {
      story_packages: storyPackagesPath,
      repair_eligible_story_packages: repairStoryPackagesPath,
      all_repair_eligible_story_packages: packageFilter.eligibleStoryPackagesPath,
      repair_attempt_story_packages: repairAttemptStoryPackagesPath,
      repair_deferred_story_packages: repairDeferredStoryPackagesPath,
      repair_attempt_priority_report: repairPriorityReportPath,
      quarantined_story_packages: packageFilter.quarantineReportPath,
      already_ready_exclusion_source: alreadyReadyStoryIds.length ? "dry_run_ready_stories" : null,
      script_rewrite_work_order: scriptRewriteWorkOrder.workOrderPath,
      script_rewrite_work_order_markdown: scriptRewriteWorkOrder.markdownPath,
      candidate_stories: sourceEvidence.candidateStoriesPath,
      official_source_entries: sourceEvidence.officialSourceEntriesPath,
      official_source_intake_report: sourceEvidence.officialSourceIntakeJsonPath,
      official_source_intake_markdown: sourceEvidence.officialSourceIntakeMdPath,
      next_full_repair_command:
        `npm run ops:fresh-production-refill -- --json --limit ${Math.max(1, Number(storyCount || 0) || 1)} --repair-evidence-mode full --repair-story-limit ${repairStoryLimitValue || 0}`,
    },
    child_processes: [],
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
    summary: report.summary,
    official_source_entries_count: sourceEvidence.official_source_entries_count,
    accepted_official_source_count: sourceEvidence.accepted_official_source_count,
    child_processes: [],
    outputs: report.outputs,
  };
}

async function buildFreshProductionRefillRepairEvidence({
  outputs,
  outDir,
  contractOutDir,
  channelId = "pulse-gaming",
  storyCount,
  redCount,
  alreadyReadyStoryIds = [],
  repairStoryLimit,
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
  let packageFilter = await buildFreshRefillRepairPackageFilter({
    storyPackagesPath,
    outputDir: repairDir,
    alreadyReadyStoryIds,
  });
  const preScriptRewriteQuarantinedCount = packageFilter.quarantinedRows.length;
  const scriptRewriteWorkOrder = await buildFreshRefillScriptRewriteWorkOrder({
    quarantinedRows: packageFilter.quarantinedRows,
    outputDir: repairDir,
    sourceEvidenceFetcher: require("./official-source-page-evidence").fetchOfficialSourcePageEvidence,
  });
  const scriptRewriteApply = await applyFreshRefillScriptRewriteWorkOrder({
    scriptRewriteWorkOrder,
    repairDir,
    log,
  });
  let scriptRewritePromotedCount = 0;
  if (Number(scriptRewriteApply.summary?.applied_count || 0) > 0) {
    const beforeQuarantinedIds = new Set(
      packageFilter.quarantinedRows.map((row) => clean(row.story_id)).filter(Boolean),
    );
    const beforeEligiblePath = packageFilter.eligibleStoryPackagesPath;
    const beforeQuarantinePath = packageFilter.quarantineReportPath;
    if (beforeEligiblePath && await fs.pathExists(beforeEligiblePath)) {
      await fs.copy(
        beforeEligiblePath,
        path.join(repairDir, "story-packages-motion-repair-eligible-before-script-rewrite.json"),
      );
    }
    if (beforeQuarantinePath && await fs.pathExists(beforeQuarantinePath)) {
      await fs.copy(
        beforeQuarantinePath,
        path.join(repairDir, "fresh_refill_quarantined_story_packages_before_script_rewrite.json"),
      );
    }
    packageFilter = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath,
      outputDir: repairDir,
      alreadyReadyStoryIds,
    });
    const afterEligibleIds = new Set(
      packageFilter.eligibleRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
    );
    scriptRewritePromotedCount = [...beforeQuarantinedIds].filter((storyId) =>
      afterEligibleIds.has(storyId),
    ).length;
  }
  const {
    allRepairStoryPackageRows,
    repairStoryLimitValue,
    storyPackageRows,
    repairDeferredByLimitRows,
    repairStoryPackagesPath,
    repairAttemptStoryPackagesPath,
    repairDeferredStoryPackagesPath,
    repairPriorityReportPath,
  } = await freshRefillRepairAttemptScope({
    packageFilter,
    repairStoryLimit,
    repairDir,
    requireDirectMotionRunway: true,
    allowOfficialSourceDiscoveryWithoutRunway: true,
  });
  const declaredEligibleStoryCount = Math.max(
    0,
    (Number(storyCount || 0) || 0) -
      packageFilter.quarantinedRows.length -
      packageFilter.alreadyReadyRows.length,
  );
  if (!storyPackageRows.length) {
    const sourceEvidence = await buildFreshRefillOfficialSourceEvidence({
      storyPackagesPath: repairStoryPackagesPath,
      outputDir: repairDir,
    });
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      status: "generated",
      mode: "full",
      summary: {
        story_package_count: packageFilter.rows.length,
        repair_eligible_story_package_count: allRepairStoryPackageRows.length,
        repair_attempt_story_package_count: 0,
        repair_deferred_by_limit_count: repairDeferredByLimitRows.length,
        repair_story_limit: repairStoryLimitValue,
        motion_runway_required_for_attempt: true,
        motion_runway_deferred_count: repairDeferredByLimitRows.length,
        quarantined_story_package_count: packageFilter.quarantinedRows.length,
        already_ready_skipped_story_package_count: packageFilter.alreadyReadyRows.length,
        script_blocked_package_count: packageFilter.quarantinedRows.length,
        script_rewrite_work_order_count: scriptRewriteWorkOrder.jobCount,
        quarantined_package_ids: packageFilter.quarantinedRows.map((row) => row.story_id).filter(Boolean),
        repair_attempt_story_ids: [],
        repair_deferred_by_limit_story_ids:
          repairDeferredByLimitRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
        already_ready_skipped_package_ids:
          packageFilter.alreadyReadyRows.map((row) => row.story_id).filter(Boolean),
        effective_story_package_count: 0,
        script_rewrite_apply_status: scriptRewriteApply.status,
        script_rewrite_applied_count: Number(scriptRewriteApply.summary?.applied_count || 0),
        script_rewrite_blocked_count: Number(scriptRewriteApply.summary?.blocked_count || 0),
        script_rewrite_blocked_reasons: scriptRewriteApply.blocked_rewrite_reasons || [],
        script_rewrite_pass_count: Number(scriptRewriteApply.summary?.pass_count || 0),
        pre_script_rewrite_quarantined_package_count: preScriptRewriteQuarantinedCount,
        script_rewrite_promoted_count: scriptRewritePromotedCount,
        script_rewrite_remaining_quarantined_count: packageFilter.quarantinedRows.length,
        official_source_entries_count: sourceEvidence.official_source_entries_count,
        accepted_official_source_count: sourceEvidence.accepted_official_source_count,
        rejected_official_source_count: sourceEvidence.rejected_official_source_count,
        supplemental_official_search_entry_count: 0,
        official_search_entry_count: 0,
        segment_validation_max_segments: 0,
        segment_validation_candidate_windows_per_source: 0,
        segment_validation_include_frame_anchored_windows: false,
        direct_media_intake_entries_count: 0,
        direct_media_intake_accepted_count: 0,
        direct_media_intake_materializable_accepted_count: 0,
        direct_media_intake_reference_only_accepted_count: 0,
        direct_media_intake_rejected_count: 0,
        real_motion_materialization_status: "not_attempted",
        real_motion_materialized_story_count: 0,
        real_motion_materialized_clip_count: 0,
        segment_validation_timeout_ms: 0,
        hyperframes_card_evidence_status: "not_attempted",
        hyperframes_card_sets_completed: 0,
        hyperframes_card_sets_failed: 0,
        hyperframes_card_evidence_blocked_count: 0,
        hyperframes_card_count: 0,
        hyperframes_card_passing_count: 0,
        hyperframes_card_failing_count: 0,
        child_process_count: 0,
        failed_child_process_count: 0,
      },
      outputs: {
        story_packages: storyPackagesPath,
        repair_eligible_story_packages: repairStoryPackagesPath,
        all_repair_eligible_story_packages: packageFilter.eligibleStoryPackagesPath,
        repair_attempt_story_packages: repairAttemptStoryPackagesPath,
        repair_deferred_story_packages: repairDeferredStoryPackagesPath,
        repair_attempt_priority_report: repairPriorityReportPath,
        quarantined_story_packages: packageFilter.quarantineReportPath,
        already_ready_exclusion_source: alreadyReadyStoryIds.length ? "dry_run_ready_stories" : null,
        script_rewrite_work_order: scriptRewriteWorkOrder.workOrderPath,
        script_rewrite_work_order_markdown: scriptRewriteWorkOrder.markdownPath,
        script_rewrite_apply_report: scriptRewriteApply.report_path,
        script_rewrite_apply_markdown: scriptRewriteApply.markdown_path,
        candidate_stories: sourceEvidence.candidateStoriesPath,
        official_source_entries: sourceEvidence.officialSourceEntriesPath,
        official_source_intake_report: sourceEvidence.officialSourceIntakeJsonPath,
        official_source_intake_markdown: sourceEvidence.officialSourceIntakeMdPath,
        next_action: scriptRewriteNextAction({ scriptRewriteApply }),
      },
      child_processes: [],
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
      summary: report.summary,
      official_source_entries_count: sourceEvidence.official_source_entries_count,
      accepted_official_source_count: sourceEvidence.accepted_official_source_count,
      child_processes: [],
      outputs: report.outputs,
    };
  }
  const effectiveStoryPackageCount = repairStoryLimitValue
    ? storyPackageRows.length
    : Math.max(storyPackageRows.length, declaredEligibleStoryCount);
  const segmentValidationBudget = freshRefillSegmentValidationBudget(effectiveStoryPackageCount);
  const segmentValidationTimeoutMs = freshRefillSegmentValidationTimeoutMs({
    budget: segmentValidationBudget,
    storyPackageCount: storyPackageRows.length,
  });

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
      repairStoryPackagesPath,
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
      repairStoryPackagesPath,
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
    storyPackagesPath: repairStoryPackagesPath,
    outputDir: repairDir,
  });

  const directMediaJsonPath = path.join(repairDir, "official_direct_media_discovery.json");
  const directMediaMdPath = path.join(repairDir, "official_direct_media_discovery.md");
  const directMediaTemplatePath = path.join(repairDir, "official_direct_media_intake_template.json");
  const directMediaDiscoveryInputMergedPath = path.join(repairDir, "official_direct_media_discovery_input.json");
  const officialSearchTemplatePath = path.join(repairDir, "visual_v4_official_search_template.json");
  const sourceFamilyIntakeTemplatePath = path.join(repairDir, "visual_v4_source_family_intake_template.json");
  const officialSearchAutofillJsonPath = path.join(repairDir, "official_search_intake_autofill.json");
  const officialSearchAutofillMdPath = path.join(repairDir, "official_search_intake_autofill.md");
  const officialSearchAutofillTemplatePath = path.join(
    repairDir,
    "visual_v4_source_family_intake_template_autofill.json",
  );
  const officialYoutubeMotionInputPath = path.join(
    repairDir,
    "official_youtube_motion_input.json",
  );
  const officialYoutubeMotionJsonPath = path.join(
    repairDir,
    "official_youtube_motion_materialization.json",
  );
  const officialYoutubeMotionTemplatePath = path.join(
    repairDir,
    "official_youtube_motion_intake_template.json",
  );
  const officialYoutubeMotionOutputDir = path.join(
    repairDir,
    "official-youtube-motion",
  );
  let supplementalOfficialSearchEvidence = {
    template_path: officialSearchTemplatePath,
    existing_entry_count: 0,
    supplemental_entry_count: 0,
    total_entry_count: 0,
  };
  let directMediaDiscoveryInputPath = sourceEvidence.officialSourceEntriesPath;
  let officialYoutubeMotionEvidence = {
    status: "not_needed",
    requested_count: 0,
    accepted_count: 0,
    blocked_count: 0,
    report_path: null,
    template_path: null,
  };
  let directMediaIntakeEvidence = {
    status: "not_needed",
    report_path: null,
    markdown_path: null,
    accepted_count: 0,
    materializable_accepted_count: 0,
    reference_only_accepted_count: 0,
    rejected_count: 0,
    entries_count: 0,
  };
  let licensedDirectMediaJsonPath = null;
  let licensedDirectMediaMdPath = null;
  let licensedDirectMediaTemplatePath = null;
  let trailerReferenceJsonPath = null;
  let segmentValidationJsonPath = null;
  let segmentValidationOutputRoot = null;
  let segmentValidationStatus = "not_needed";
  let segmentValidationCheckpointRecovered = false;
  let segmentValidationCheckpointValidatedCount = 0;
  let realMotionWorkOrderPath = null;
  let realMotionMaterializationJsonPath = null;
  let realMotionMaterializationMdPath = null;
  let realMotionMaterializationStatus = "not_needed";
  let realMotionMaterializedStoryCount = 0;
  let realMotionMaterializedClipCount = 0;
  let realMotionUnderSupportedSummary = summarizeFreshRefillUnderSupportedMotion();
  let ownedMotionFallbackStatus = "not_needed";
  let ownedMotionFallbackReadyStoryIds = [];
  let ownedMotionFallbackBlockedStoryIds = [];
  let ownedMotionFallbackBlockers = [];
  let ownedMotionFallbackReportPath = null;
  let ownedMotionFallbackEvaluationPath = null;
  let visualSourceReviewEvidence = null;
  const materializedMotionPackDir = path.join(ROOT, "output", "studio-v4", "motion-packs");
  let hyperframesCardEvidence = {
    status: "not_needed",
    report_path: null,
    markdown_path: null,
    completed_count: 0,
    failed_count: 0,
    evidence_blocked_count: 0,
    card_count: 0,
    passing_card_count: 0,
    failing_card_count: 0,
    shortest_planned_visible_duration_s: null,
    longest_required_visible_duration_s: null,
  };
  supplementalOfficialSearchEvidence = await buildFreshRefillSupplementalOfficialSearchTemplate({
    candidateStoriesPath: sourceEvidence.candidateStoriesPath,
    sourceFamilyReportPath: sourceFamilyJsonPath,
    templatePath: officialSearchTemplatePath,
  });
  const officialSearchTemplate = await readJsonIfPresent(officialSearchTemplatePath, {});
  const shouldRunOfficialDiscovery = freshRefillShouldRunOfficialDiscovery({
    sourceEvidence,
    supplementalOfficialSearchEvidence,
    officialSearchTemplate,
  });

  if (shouldRunOfficialDiscovery) {

    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_official_search_autofill",
      args: [
        "tools/official-search-intake-autofill.js",
        "--input",
        officialSearchTemplatePath,
        "--merge-input",
        sourceFamilyIntakeTemplatePath,
        "--output-json",
        officialSearchAutofillJsonPath,
        "--output-md",
        officialSearchAutofillMdPath,
        "--output-template",
        officialSearchAutofillTemplatePath,
        "--json",
      ],
    });
    const officialSearchAutofillTemplate = await readJsonIfPresent(officialSearchAutofillTemplatePath, {});
    const officialYoutubeMotionRows = freshRefillOfficialYoutubeMotionRows(
      officialSearchAutofillTemplate,
    );
    if (officialYoutubeMotionRows.length > 0) {
      await fs.writeJson(
        officialYoutubeMotionInputPath,
        {
          schema_version: 1,
          generated_at: new Date().toISOString(),
          entries: officialYoutubeMotionRows,
          safety: {
            local_only: true,
            no_publish: true,
            no_db_mutation: true,
            no_oauth_or_token_mutation: true,
          },
        },
        { spaces: 2 },
      );
      const materializationOk = await runFreshRefillRepairChild({
        runChild,
        log,
        childProcesses,
        childKind: "fresh_refill_official_youtube_motion_materialization",
        timeoutMs: 4 * 60 * 1000,
        args: freshRefillOfficialYoutubeMotionChildArgs({
          inputPath: officialYoutubeMotionInputPath,
          outputDir: officialYoutubeMotionOutputDir,
          outputJsonPath: officialYoutubeMotionJsonPath,
          outputTemplatePath: officialYoutubeMotionTemplatePath,
        }),
      });
      const materializationReport = await readJsonIfPresent(
        officialYoutubeMotionJsonPath,
        {},
      );
      officialYoutubeMotionEvidence = {
        status: materializationOk ? "generated" : "partial_or_blocked",
        requested_count: officialYoutubeMotionRows.length,
        accepted_count: Number(materializationReport.summary?.accepted || 0),
        blocked_count: Number(materializationReport.summary?.blocked || 0),
        report_path: officialYoutubeMotionJsonPath,
        template_path: officialYoutubeMotionTemplatePath,
      };
    }
    if (
      freshRefillSearchTemplateRows(officialSearchAutofillTemplate).length > 0 ||
      officialYoutubeMotionEvidence.accepted_count > 0
    ) {
      const mergedDirectInput = await buildFreshRefillDirectMediaDiscoveryInput({
        sourceEntriesPath: sourceEvidence.officialSourceEntriesPath,
        officialSearchAutofillTemplatePath,
        officialYoutubeMotionTemplatePath:
          officialYoutubeMotionEvidence.accepted_count > 0
            ? officialYoutubeMotionTemplatePath
            : null,
        outputPath: directMediaDiscoveryInputMergedPath,
      });
      directMediaDiscoveryInputPath =
        mergedDirectInput.merged_entry_count > 0 ? directMediaDiscoveryInputMergedPath : officialSearchAutofillTemplatePath;
    }

    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_direct_media_discovery",
      args: [
        "tools/official-direct-media-discovery.js",
        "--input",
        directMediaDiscoveryInputPath,
        "--output-json",
        directMediaJsonPath,
        "--output-md",
        directMediaMdPath,
        "--output-template",
        directMediaTemplatePath,
        "--timeout-ms",
        "15000",
        "--max-candidates-per-entry",
        String(FRESH_REFILL_DIRECT_MEDIA_MAX_CANDIDATES_PER_ENTRY),
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

    segmentValidationOutputRoot = path.join(
      ROOT,
      "test",
      "output",
      `fresh-refill-segment-validation-${Date.now()}`,
    );
    segmentValidationJsonPath = path.join(
      segmentValidationOutputRoot,
      "official_trailer_segment_validation_apply_local.json",
    );
    const segmentValidationMdPath = path.join(
      segmentValidationOutputRoot,
      "official_trailer_segment_validation_apply_local.md",
    );
    const singleSegmentStoryIdArgs = storyPackageRows.length === 1 && storyPackageRows[0]?.story_id
      ? ["--story-id", storyPackageRows[0].story_id]
      : [];
    const segmentValidationOk = await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_segment_validation",
      timeoutMs: segmentValidationTimeoutMs,
      args: [
        "tools/official-trailer-segment-validator.js",
        "--no-frame-report",
        "--reference-report",
        trailerReferenceJsonPath,
        "--reference-report",
        licensedDirectMediaJsonPath,
        "--apply-local",
        "--output-root",
        segmentValidationOutputRoot,
        "--report-json",
        segmentValidationJsonPath,
        "--report-md",
        segmentValidationMdPath,
        "--checkpoint-report",
        ...singleSegmentStoryIdArgs,
        "--reference-duration-probe-timeout-ms",
        "10000",
        "--max-reference-duration-probes",
        "12",
        "--max-segments",
        String(segmentValidationBudget.maxSegments),
        "--candidate-windows-per-source",
        String(segmentValidationBudget.candidateWindowsPerSource),
        ...(segmentValidationBudget.includeFrameAnchoredWindows ? ["--include-frame-anchored-windows"] : []),
        "--deep-scan",
        "--exploratory-starts",
        "6,12,18,24,30,36,42,48,54,60",
        "--allow-early-exploratory-windows",
        "--no-exhausted-source-family-filter",
        "--json",
      ],
    });

    const segmentValidationReportExists = await fs.pathExists(segmentValidationJsonPath);
    const segmentValidationReport = segmentValidationReportExists
      ? await readJsonIfPresent(segmentValidationJsonPath, {})
      : {};
    const checkpointValidatedSegments = asArray(segmentValidationReport.segments).filter(
      (segment) =>
        segment?.segment_validated === true &&
        segment?.allowed_for_flash_lane === true,
    );
    const usablePartialCheckpoint =
      !segmentValidationOk &&
      segmentValidationReportExists &&
      segmentValidationReport.checkpoint_report === true &&
      clean(segmentValidationReport.status) === "partial" &&
      segmentValidationReport.completed === false &&
      checkpointValidatedSegments.length > 0;
    const segmentValidationReportPresent =
      segmentValidationReportExists && (segmentValidationOk || usablePartialCheckpoint);
    if (!segmentValidationReportPresent) {
      segmentValidationStatus = "segment_validation_failed";
      realMotionMaterializationStatus = "segment_validation_failed";
      if (segmentValidationOk) {
        childProcesses.push({
          child_kind: "fresh_refill_segment_validation_report",
          args: [segmentValidationJsonPath],
          ok: false,
          exit_code: null,
          signal: null,
          timed_out: false,
          failure_reason: "expected_report_missing",
          error: `segment validation report missing: ${segmentValidationJsonPath}`,
          stdout_tail: "",
          stderr_tail: "",
          actionable_diagnostic: true,
        });
      }
    } else {
      segmentValidationCheckpointRecovered = usablePartialCheckpoint;
      segmentValidationCheckpointValidatedCount = usablePartialCheckpoint
        ? checkpointValidatedSegments.length
        : 0;
      segmentValidationStatus = usablePartialCheckpoint
        ? "validated_partial_checkpoint"
        : "validated";
      await runFreshRefillRepairChild({
        runChild,
        log,
        childProcesses,
        childKind: "fresh_refill_motion_pack_after_segment_validation",
        args: [
          "tools/studio-v4-motion-pack.js",
          "--stories",
          repairStoryPackagesPath,
          "--segment-report",
          segmentValidationJsonPath,
          "--trusted-footage-report",
          trailerReferenceJsonPath,
          "--out-dir",
          motionPackDir,
          "--no-preserve-existing",
          "--json",
        ],
      });

    realMotionWorkOrderPath = path.join(repairDir, "fresh_refill_real_motion_work_order.json");
    realMotionMaterializationJsonPath = path.join(repairDir, "real_motion_materialization_report.json");
    realMotionMaterializationMdPath = path.join(repairDir, "real_motion_materialization_report.md");
    await fs.writeJson(realMotionWorkOrderPath, {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source: "fresh_production_refill_repair",
      jobs: [],
      note: "Segment-report-only work order. Validated official/direct-motion windows are materialised by story ID.",
      safety: {
        local_only: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_mutation: true,
      },
    }, { spaces: 2 });
    const materializerStoryIds = uniqueClean(storyPackageRows.map((row) => row.story_id));
    await runFreshRefillRepairChild({
      runChild,
      log,
      childProcesses,
      childKind: "fresh_refill_real_motion_materialization",
      args: [
        "tools/goal-real-motion-materializer.js",
        "--work-order",
        realMotionWorkOrderPath,
        "--out-dir",
        repairDir,
        "--artifact-root",
        outDir,
        "--segment-report",
        segmentValidationJsonPath,
        ...materializerStoryIds.flatMap((storyId) => ["--story-id", storyId]),
        "--min-clips",
        "6",
        "--min-families",
        "5",
        "--max-clips",
        String(FRESH_REFILL_REAL_MOTION_MAX_CLIPS),
        "--json",
      ],
    });
    realMotionMaterializationStatus = "attempted";
    if (await fs.pathExists(realMotionMaterializationJsonPath)) {
      const realMotionReport = await readJsonIfPresent(realMotionMaterializationJsonPath, {});
      realMotionMaterializedStoryCount = Number(realMotionReport?.summary?.materialized_story_count || 0);
      realMotionMaterializedClipCount = Number(realMotionReport?.summary?.materialized_clip_count || 0);
      realMotionUnderSupportedSummary = summarizeFreshRefillUnderSupportedMotion(realMotionReport);
      if (realMotionMaterializedStoryCount > 0 && realMotionMaterializedClipCount > 0) {
        realMotionMaterializationStatus = "materialized";
      } else if (Number(realMotionReport?.summary?.failed_story_count || 0) > 0) {
        realMotionMaterializationStatus = "partial";
      } else if (realMotionUnderSupportedSummary.under_supported_motion_story_count > 0) {
        realMotionMaterializationStatus = "under_supported_motion";
      }
    }
    if (realMotionUnderSupportedSummary.under_supported_motion_story_count > 0) {
      const ownedMotionFallbackDir = path.join(repairDir, "owned-motion-fallback");
      ownedMotionFallbackReportPath = path.join(
        ownedMotionFallbackDir,
        "owned_motion_materialization_report.json",
      );
      ownedMotionFallbackEvaluationPath = path.join(
        ownedMotionFallbackDir,
        "owned_motion_fallback_evaluation.json",
      );
      await runFreshRefillRepairChild({
        runChild,
        log,
        childProcesses,
        childKind: "fresh_refill_owned_motion_fallback",
        timeoutMs: Math.max(segmentValidationTimeoutMs, 12 * 60 * 1000),
        args: [
          "tools/goal-owned-motion-materializer.js",
          "--story-packages",
          repairAttemptStoryPackagesPath,
          "--out-dir",
          ownedMotionFallbackDir,
          "--root",
          ROOT,
          "--refresh-existing",
          ...realMotionUnderSupportedSummary.under_supported_motion_story_ids.flatMap(
            (storyId) => ["--story-id", storyId],
          ),
          "--json",
        ],
      });
      const {
        evaluateFreshRefillOwnedMotionFallbackEvidence,
      } = require("./ops/fresh-refill-owned-motion-fallback");
      const ownedMotionEvaluation =
        await evaluateFreshRefillOwnedMotionFallbackEvidence({
          reportPath: ownedMotionFallbackReportPath,
          requiredPlatforms: [
            "youtube_shorts",
            "instagram_reels",
            "facebook_reels",
          ],
          workspaceRoot: ROOT,
        });
      ownedMotionFallbackStatus = ownedMotionEvaluation.status;
      ownedMotionFallbackReadyStoryIds = asArray(
        ownedMotionEvaluation.ready_story_ids,
      );
      ownedMotionFallbackBlockedStoryIds = asArray(
        ownedMotionEvaluation.blocked_story_ids,
      );
      ownedMotionFallbackBlockers = asArray(ownedMotionEvaluation.blockers);
      await fs.ensureDir(path.dirname(ownedMotionFallbackEvaluationPath));
      await fs.writeJson(
        ownedMotionFallbackEvaluationPath,
        ownedMotionEvaluation,
        { spaces: 2 },
      );
    }
    visualSourceReviewEvidence = await writeFreshRefillVisualSourceReviewsForRejectedSegments({
      segmentReportPath: segmentValidationJsonPath,
      storyPackageRows,
      outputDir: repairDir,
    });

    const candidateHyperframesStoryIds = uniqueClean(
      (await readFreshRefillEvidenceRows(sourceEvidence.candidateStoriesPath)).map((story) => freshRefillStoryId(story)),
    );
    const sourceCardFallbackStoryIds = uniqueClean(
      storyPackageRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
    );
    const hyperframesStoryIds = await freshRefillHyperframesStoryIdsAfterMotion({
      candidateStoryIds: candidateHyperframesStoryIds,
      realMotionReportPath: realMotionMaterializationJsonPath,
      motionPackDir: materializedMotionPackDir,
      sourceCardFallbackStoryIds,
      ownedMotionReadyStoryIds: ownedMotionFallbackReadyStoryIds,
    });
      hyperframesCardEvidence = await buildFreshRefillHyperframesCardEvidence({
        candidateStoriesPath: sourceEvidence.candidateStoriesPath,
        candidateStoryIds: hyperframesStoryIds,
        outputDir: repairDir,
        channelId,
        runChild,
        log,
        childProcesses,
      });
    }
  }

  const failedChildProcessCount = childProcesses.filter((child) => !child.ok).length;
  const hyperframesEvidenceBlocked = Number(hyperframesCardEvidence.evidence_blocked_count || 0) > 0;
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: failedChildProcessCount || hyperframesEvidenceBlocked ? "partial" : "generated",
    summary: {
      story_package_count: packageFilter.rows.length,
      repair_eligible_story_package_count: allRepairStoryPackageRows.length,
      repair_attempt_story_package_count: storyPackageRows.length,
      repair_deferred_by_limit_count: repairDeferredByLimitRows.length,
      repair_story_limit: repairStoryLimitValue,
      quarantined_story_package_count: packageFilter.quarantinedRows.length,
      already_ready_skipped_story_package_count: packageFilter.alreadyReadyRows.length,
      script_blocked_package_count: packageFilter.quarantinedRows.length,
      script_rewrite_work_order_count: scriptRewriteWorkOrder.jobCount,
      quarantined_package_ids: packageFilter.quarantinedRows.map((row) => row.story_id).filter(Boolean),
      repair_attempt_story_ids: storyPackageRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
      repair_deferred_by_limit_story_ids:
        repairDeferredByLimitRows.map((row) => freshRefillStoryId(row)).filter(Boolean),
      already_ready_skipped_package_ids:
        packageFilter.alreadyReadyRows.map((row) => row.story_id).filter(Boolean),
      effective_story_package_count: effectiveStoryPackageCount,
      script_rewrite_apply_status: scriptRewriteApply.status,
      script_rewrite_applied_count: Number(scriptRewriteApply.summary?.applied_count || 0),
      script_rewrite_blocked_count: Number(scriptRewriteApply.summary?.blocked_count || 0),
      script_rewrite_blocked_reasons: scriptRewriteApply.blocked_rewrite_reasons || [],
      script_rewrite_pass_count: Number(scriptRewriteApply.summary?.pass_count || 0),
      pre_script_rewrite_quarantined_package_count: preScriptRewriteQuarantinedCount,
      script_rewrite_promoted_count: scriptRewritePromotedCount,
      script_rewrite_remaining_quarantined_count: packageFilter.quarantinedRows.length,
      official_source_entries_count: sourceEvidence.official_source_entries_count,
      accepted_official_source_count: sourceEvidence.accepted_official_source_count,
      rejected_official_source_count: sourceEvidence.rejected_official_source_count,
      supplemental_official_search_entry_count:
        supplementalOfficialSearchEvidence.supplemental_entry_count || 0,
      official_search_entry_count:
        supplementalOfficialSearchEvidence.total_entry_count || 0,
      official_youtube_motion_materialization_status:
        officialYoutubeMotionEvidence.status,
      official_youtube_motion_requested_count:
        officialYoutubeMotionEvidence.requested_count,
      official_youtube_motion_accepted_count:
        officialYoutubeMotionEvidence.accepted_count,
      official_youtube_motion_blocked_count:
        officialYoutubeMotionEvidence.blocked_count,
      segment_validation_max_segments: segmentValidationBudget.maxSegments,
      segment_validation_candidate_windows_per_source: segmentValidationBudget.candidateWindowsPerSource,
      segment_validation_status: segmentValidationStatus,
      segment_validation_checkpoint_recovered: segmentValidationCheckpointRecovered,
      segment_validation_checkpoint_validated_count:
        segmentValidationCheckpointValidatedCount,
      segment_validation_include_frame_anchored_windows:
        segmentValidationBudget.includeFrameAnchoredWindows,
      direct_media_intake_entries_count: directMediaIntakeEvidence.entries_count,
      direct_media_intake_accepted_count: directMediaIntakeEvidence.accepted_count,
      direct_media_intake_materializable_accepted_count:
        directMediaIntakeEvidence.materializable_accepted_count,
      direct_media_intake_reference_only_accepted_count:
        directMediaIntakeEvidence.reference_only_accepted_count,
      direct_media_intake_rejected_count: directMediaIntakeEvidence.rejected_count,
      real_motion_materialization_status: realMotionMaterializationStatus,
      real_motion_materialized_story_count: realMotionMaterializedStoryCount,
      real_motion_materialized_clip_count: realMotionMaterializedClipCount,
      under_supported_motion_story_count:
        realMotionUnderSupportedSummary.under_supported_motion_story_count,
      under_supported_motion_story_ids:
        realMotionUnderSupportedSummary.under_supported_motion_story_ids,
      under_supported_motion_defer_reason:
        realMotionUnderSupportedSummary.under_supported_motion_defer_reason,
      owned_motion_fallback_status: ownedMotionFallbackStatus,
      owned_motion_fallback_ready_story_count:
        ownedMotionFallbackReadyStoryIds.length,
      owned_motion_fallback_ready_story_ids:
        ownedMotionFallbackReadyStoryIds,
      owned_motion_fallback_blocked_story_count:
        ownedMotionFallbackBlockedStoryIds.length,
      owned_motion_fallback_blocked_story_ids:
        ownedMotionFallbackBlockedStoryIds,
      owned_motion_fallback_blockers:
        ownedMotionFallbackBlockers,
      visual_source_review_status: clean(visualSourceReviewEvidence?.status || "not_attempted"),
      visual_source_review_count: Number(visualSourceReviewEvidence?.summary?.visual_source_review_count || 0),
      visual_source_review_reject_count: Number(visualSourceReviewEvidence?.summary?.reject_count || 0),
      segment_validation_timeout_ms: segmentValidationTimeoutMs,
      segment_validation_max_segments: segmentValidationBudget.maxSegments,
      segment_validation_candidate_windows_per_source: segmentValidationBudget.candidateWindowsPerSource,
      hyperframes_card_evidence_status: hyperframesCardEvidence.status,
      hyperframes_card_sets_completed: hyperframesCardEvidence.completed_count,
      hyperframes_card_sets_failed: hyperframesCardEvidence.failed_count,
      hyperframes_card_evidence_blocked_count: hyperframesCardEvidence.evidence_blocked_count,
      hyperframes_card_count: hyperframesCardEvidence.card_count,
      hyperframes_card_passing_count: hyperframesCardEvidence.passing_card_count,
      hyperframes_card_failing_count: hyperframesCardEvidence.failing_card_count,
      hyperframes_shortest_planned_visible_duration_s:
        hyperframesCardEvidence.shortest_planned_visible_duration_s,
      hyperframes_longest_required_visible_duration_s:
        hyperframesCardEvidence.longest_required_visible_duration_s,
      child_process_count: childProcesses.length,
      failed_child_process_count: failedChildProcessCount,
    },
    outputs: {
      story_packages: storyPackagesPath,
      repair_eligible_story_packages: repairStoryPackagesPath,
      all_repair_eligible_story_packages: packageFilter.eligibleStoryPackagesPath,
      repair_attempt_story_packages: repairAttemptStoryPackagesPath,
      repair_deferred_story_packages: repairDeferredStoryPackagesPath,
      repair_attempt_priority_report: repairPriorityReportPath,
      quarantined_story_packages: packageFilter.quarantineReportPath,
      already_ready_exclusion_source: alreadyReadyStoryIds.length ? "dry_run_ready_stories" : null,
      script_rewrite_work_order: scriptRewriteWorkOrder.workOrderPath,
      script_rewrite_work_order_markdown: scriptRewriteWorkOrder.markdownPath,
      script_rewrite_apply_report: scriptRewriteApply.report_path,
      script_rewrite_apply_markdown: scriptRewriteApply.markdown_path,
      motion_pack_index: motionPackIndexPath,
      source_family_report: sourceFamilyJsonPath,
      source_family_markdown: sourceFamilyMdPath,
      candidate_stories: sourceEvidence.candidateStoriesPath,
      official_source_entries: sourceEvidence.officialSourceEntriesPath,
      official_source_intake_report: sourceEvidence.officialSourceIntakeJsonPath,
      official_source_intake_markdown: sourceEvidence.officialSourceIntakeMdPath,
      official_search_autofill_report:
        shouldRunOfficialDiscovery ? officialSearchAutofillJsonPath : null,
      official_search_autofill_markdown:
        shouldRunOfficialDiscovery ? officialSearchAutofillMdPath : null,
      official_search_template:
        shouldRunOfficialDiscovery ? supplementalOfficialSearchEvidence.template_path : null,
      official_search_autofill_template:
        shouldRunOfficialDiscovery ? officialSearchAutofillTemplatePath : null,
      official_youtube_motion_input:
        officialYoutubeMotionEvidence.requested_count > 0
          ? officialYoutubeMotionInputPath
          : null,
      official_youtube_motion_report: officialYoutubeMotionEvidence.report_path,
      official_youtube_motion_template: officialYoutubeMotionEvidence.template_path,
      direct_media_discovery_input: directMediaDiscoveryInputPath,
      direct_media_discovery_report: shouldRunOfficialDiscovery ? directMediaJsonPath : null,
      direct_media_intake_report: directMediaIntakeEvidence.report_path,
      direct_media_intake_markdown: directMediaIntakeEvidence.markdown_path,
      licensed_direct_media_report: licensedDirectMediaJsonPath,
      licensed_direct_media_markdown: licensedDirectMediaMdPath,
      licensed_direct_media_intake_template: licensedDirectMediaTemplatePath,
      trailer_reference_report: trailerReferenceJsonPath,
      segment_validation_report: segmentValidationJsonPath,
      segment_validation_output_root: segmentValidationOutputRoot,
      real_motion_work_order: realMotionWorkOrderPath,
      real_motion_materialization_report: realMotionMaterializationJsonPath,
      real_motion_materialization_markdown: realMotionMaterializationMdPath,
      owned_motion_fallback_report: ownedMotionFallbackReportPath,
      owned_motion_fallback_evaluation: ownedMotionFallbackEvaluationPath,
      visual_source_review_report: clean(visualSourceReviewEvidence?.report_path),
      visual_source_review_markdown: clean(visualSourceReviewEvidence?.markdown_path),
      hyperframes_card_evidence_report: hyperframesCardEvidence.report_path,
      hyperframes_card_evidence_markdown: hyperframesCardEvidence.markdown_path,
      materialized_motion_pack_dir: materializedMotionPackDir,
      next_action: scriptRewriteNextAction({
        scriptRewriteApply,
        fallback: realMotionUnderSupportedSummary.under_supported_motion_story_count
          ? "repair_under_supported_motion_or_replace_story"
          : "continue_source_motion_first_intake",
      }),
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
    summary: report.summary,
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
  const seedStoriesFile = clean(payload.seed_stories_file);
  const targetPlatforms = uniqueClean([
    ...asArray(payload.target_platforms),
    ...asArray(payload.targetPlatforms),
  ]
    .flatMap((value) => clean(value).split(","))
    .map((value) => value.toLowerCase()));
  const resumeStoryPackagesPath = clean(payload.resume_story_packages_path || payload.resumeStoryPackagesPath);
  const { resolveZeroYieldQuarantinePath } = require("./refill-zero-yield-quarantine");
  const zeroYieldQuarantinePath = resolveZeroYieldQuarantinePath({
    root: ROOT,
    explicitPath:
      payload.zero_yield_quarantine_path ||
      payload.zeroYieldQuarantinePath,
  });
  const narrationProvider = freshRefillNarrationProviderPreference({ payload });
  const log = (ctx && ctx.log) || console.log;
  const runChild = ctx?.runNodeJobChildProcess || runNodeJobChildProcess;
  if (resumeStoryPackagesPath) {
    const materializationContinuation = await runFreshRefillMaterializationContinuation({
      storyPackagesPath: resumeStoryPackagesPath,
      segmentReportPath: clean(payload.segment_report_path || payload.segmentReportPath),
      realMotionOutDir: clean(payload.real_motion_out_dir || payload.realMotionOutDir),
      realMotionArtifactRoot: clean(payload.real_motion_artifact_root || payload.realMotionArtifactRoot),
      generatedAt: generatedAt.toISOString(),
      narrationProvider,
      runChild,
      log,
    });
    return {
      status: materializationContinuation.status || "completed",
      resume_mode: true,
      story_count: Number(materializationContinuation.summary?.story_count || 0),
      green_count: Number(materializationContinuation.summary?.scheduler_ready_story_count || 0),
      red_count: Math.max(
        0,
        Number(materializationContinuation.summary?.story_count || 0) -
          Number(materializationContinuation.summary?.scheduler_ready_story_count || 0),
      ),
      outputs: materializationContinuation.outputs || {},
      materialization_continuation: materializationContinuation,
      safety: {
        local_only: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_mutation: true,
        disabled_platforms_unchanged: true,
      },
    };
  }
  const skipExistingReady = payload.skip_existing_ready !== false && !seedStoriesFile;
  const explicitExcludedStoryIds = uniqueClean([
    ...asArray(payload.exclude_story_ids),
    ...asArray(payload.excludeStoryIds),
    ...asArray(payload.already_ready_story_ids),
    ...asArray(payload.alreadyReadyStoryIds),
  ]);
  const dryRunReadyStoryIds = skipExistingReady
    ? await readFreshRefillDryRunReadyStoryIds(clean(payload.dry_run_plan_path) || undefined)
    : [];
  const alreadyReadyStoryIds = uniqueClean([
    ...explicitExcludedStoryIds,
    ...dryRunReadyStoryIds,
  ]);
  const { main: runGoalBatchPackages } = require("../tools/goal-batch-packages");
  const args = [
    "--limit",
    String(limit),
    "--out-dir",
    outDir,
    "--contract-out-dir",
    contractOutDir,
    "--zero-yield-quarantine",
    zeroYieldQuarantinePath,
  ];
  if (seedStoriesFile) {
    args.unshift(seedStoriesFile);
    args.unshift("--stories-file");
  } else {
    args.unshift(String(rssPerFeed));
    args.unshift("--rss-per-feed");
    args.unshift("--live-rss-only");
    args.unshift("--live-rss");
  }
  if (targetPlatforms.length) args.push("--platforms", targetPlatforms.join(","));
  let result = await runGoalBatchPackages(args);
  let summary = result?.batch?.summary || {};
  let outputs = result?.outputs || {};
  log(
    `[fresh-production-refill] stories=${summary.story_count || 0} green=${summary.green_count || 0} red=${summary.red_count || 0}`,
  );
  const repairEvidenceMode = freshRefillRepairEvidenceMode(
    payload.repair_evidence_mode ||
      payload.repairEvidenceMode ||
      process.env.PULSE_FRESH_PRODUCTION_REFILL_REPAIR_EVIDENCE_MODE,
  );
  const repairEvidence = payload.repair_evidence === false
    ? { status: "disabled", reason: "payload_repair_evidence_false" }
    : repairEvidenceMode === "plan"
      ? await buildFreshProductionRefillRepairPlanEvidence({
          outputs,
          outDir,
          contractOutDir,
          storyCount: Number(summary.story_count || 0),
          redCount: Number(summary.red_count || 0),
          alreadyReadyStoryIds,
          repairStoryLimit: payload.repair_story_limit ?? payload.repairStoryLimit,
        })
      : await buildFreshProductionRefillRepairEvidence({
        outputs,
        outDir,
        contractOutDir,
        channelId: clean(job.channel_id || payload.channel_id || payload.channelId || process.env.CHANNEL || "pulse-gaming") || "pulse-gaming",
        storyCount: Number(summary.story_count || 0),
        redCount: Number(summary.red_count || 0),
        alreadyReadyStoryIds,
        repairStoryLimit: payload.repair_story_limit ?? payload.repairStoryLimit,
        runChild,
        log,
      });
  let motionHydratedRefill = {
    status: "not_attempted",
    reason: "repair_motion_pack_unavailable",
  };
  let materializationContinuation = {
    status: "not_attempted",
    reason: "motion_hydrated_refill_not_attempted",
  };
  const repairMotionPackIndex = clean(repairEvidence?.outputs?.motion_pack_index);
  if (
    repairEvidence &&
    !["disabled", "skipped", "not_needed"].includes(clean(repairEvidence.status)) &&
    repairMotionPackIndex
  ) {
    const repairMotionPackDir =
      clean(repairEvidence?.outputs?.materialized_motion_pack_dir) || path.dirname(repairMotionPackIndex);
    const candidateStories = await readFreshRefillEvidenceRows(repairEvidence?.outputs?.candidate_stories);
    const ownedMotionFallbackEvaluation = await readJsonIfPresent(
      clean(repairEvidence?.outputs?.owned_motion_fallback_evaluation),
      {},
    );
    const candidateStoryIds = await freshRefillHyperframesStoryIdsAfterMotion({
      candidateStoryIds: uniqueClean(candidateStories.map((story) => freshRefillStoryId(story))),
      realMotionReportPath: clean(repairEvidence?.outputs?.real_motion_materialization_report),
      motionPackDir: repairMotionPackDir,
      sourceCardFallbackStoryIds: uniqueClean(
        (await readFreshRefillEvidenceRows(repairEvidence?.outputs?.repair_attempt_story_packages))
          .map((row) => freshRefillStoryId(row)),
      ),
      ownedMotionReadyStoryIds: asArray(
        ownedMotionFallbackEvaluation.ready_story_ids,
      ),
    });
    if (!candidateStoryIds.length) {
      motionHydratedRefill = {
        status: "skipped",
        reason: "no_repair_eligible_candidate_stories",
        motion_pack_dir: repairMotionPackDir,
      };
    } else {
      const hydratedArgs = hydratedFreshProductionRefillArgs({
        baseArgs: args,
        candidateStoriesPath: repairEvidence?.outputs?.candidate_stories,
        repairMotionPackDir,
        candidateStoryIds,
        allowOwnedMotionFallback: true,
        existingArtifactRoot: outDir,
      });
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
      if (motionHydratedRefill.red_count > 0 && motionHydratedRefill.green_count < candidateStoryIds.length) {
        materializationContinuation = await runFreshRefillMaterializationContinuation({
          storyPackagesPath: hydratedOutputs.storyPackagesPath,
          segmentReportPath: clean(repairEvidence?.outputs?.segment_validation_report),
          realMotionOutDir: clean(repairEvidence?.outputs?.materialized_motion_pack_dir) || repairMotionPackDir,
          generatedAt: generatedAt.toISOString(),
          narrationProvider,
          runChild,
          log,
        });
        if (!["skipped", "not_attempted"].includes(clean(materializationContinuation.status))) {
          const finalHydratedResult = await runGoalBatchPackages(hydratedArgs);
          const finalHydratedSummary = finalHydratedResult?.batch?.summary || {};
          const finalHydratedOutputs = finalHydratedResult?.outputs || {};
          result = finalHydratedResult || result;
          summary = finalHydratedSummary;
          outputs = finalHydratedOutputs;
          materializationContinuation.final_story_count = Number(finalHydratedSummary.story_count || 0);
          materializationContinuation.final_green_count = Number(finalHydratedSummary.green_count || 0);
          materializationContinuation.final_red_count = Number(finalHydratedSummary.red_count || 0);
          materializationContinuation.final_outputs = finalHydratedOutputs;
          log(
            `[fresh-production-refill] materialized-continuation stories=${materializationContinuation.final_story_count} green=${materializationContinuation.final_green_count} red=${materializationContinuation.final_red_count}`,
          );
        }
      } else {
        materializationContinuation = {
          status: "not_needed",
          reason: "motion_hydrated_refill_already_green_or_empty",
        };
      }
    }
  }
  const storyCount = Number(summary.story_count || 0);
  const localPackageGreenCount = Number(summary.green_count || 0);
  const localPackageRedCount = Number(summary.red_count || 0);
  const minimumNewGreenCandidates = Math.max(
    0,
    Number(payload.source_minimum_new_green_candidates || 0) || 0,
  );
  let strictOutcome = null;
  if (minimumNewGreenCandidates > 0) {
    const storyPackages = await readFreshRefillEvidenceRows(outputs.storyPackagesPath);
    const evaluateStrictOutcome =
      ctx?.evaluateFreshProductionRefillOutcome ||
      require("./ops/fresh-production-refill-outcome").evaluateFreshProductionRefillOutcome;
    strictOutcome = await evaluateStrictOutcome({
      storyPackages,
      localPackageGreenCount,
      minimumNewGreenCandidates,
      parentJobId: job?.id ?? null,
      generatedAt: generatedAt.toISOString(),
      outputDir: path.join(contractOutDir, "strict-refill-outcome"),
    });
  }
  const greenCount = strictOutcome
    ? Number(strictOutcome.strict_green_count || 0)
    : localPackageGreenCount;
  const redCount = strictOutcome
    ? Math.max(localPackageRedCount, storyCount - greenCount)
    : localPackageRedCount;
  const repairPlanDeferred =
    repairEvidenceMode === "plan" &&
    clean(repairEvidence?.status) === "planned" &&
    localPackageGreenCount === 0 &&
    localPackageRedCount > 0;
  const zeroYieldDetected =
    !repairPlanDeferred &&
    (strictOutcome ? strictOutcome.target_met !== true : greenCount === 0);
  const zeroYieldAttempt = Math.max(
    0,
    Math.min(
      1,
      Number(payload.zero_yield_attempt || payload.recovery_depth || 0) || 0,
    ),
  );
  const zeroYieldRecovery = {
    detected: zeroYieldDetected,
    evaluation_status: repairPlanDeferred ? "deferred_plan_mode" : "evaluated",
    attempt: zeroYieldAttempt,
    outcome: repairPlanDeferred
      ? "repair_planned_not_executed"
      : strictOutcome?.outcome || (greenCount === 0 ? "zero_local_package_yield" : "target_met"),
    minimum_new_green_candidates: minimumNewGreenCandidates || null,
    shortfall: strictOutcome?.shortfall ?? null,
    incident_fingerprint: strictOutcome?.incident_fingerprint || null,
    alternate_refill_enqueued: false,
    alternate_cohort_selected_count: 0,
    alternate_cohort_selection_fingerprint: null,
    alternate_cohort_report_path: null,
    alternate_cohort_stories_path: null,
    alternate_cohort_error: null,
    repair_enqueued: false,
    verification_enqueued: false,
    enqueue_errors: [],
    attempted_story_ids: [],
    quarantine: {
      path: zeroYieldQuarantinePath,
      status: repairPlanDeferred ? "not_applicable_plan_mode" : "not_updated",
      active_entry_count: 0,
      excluded_story_count: 0,
      excluded_source_count: 0,
      rss_offset_per_feed: 0,
      error: null,
    },
  };
  if (zeroYieldDetected) {
    let activeZeroYieldExclusions = {
      story_ids: [],
      source_fingerprints: [],
      rss_offset_per_feed: 0,
      active_entry_count: 0,
    };
    const attemptedRows = await readFreshRefillEvidenceRows(outputs.storyPackagesPath);
    const attemptedStoryIds = uniqueClean([
      ...asArray(strictOutcome?.attempted_story_ids),
      ...attemptedRows.map((row) => freshRefillStoryId(row)),
    ]);
    zeroYieldRecovery.attempted_story_ids = attemptedStoryIds;
    try {
      const {
        buildZeroYieldExclusions,
        readZeroYieldQuarantine,
        recordZeroYieldCohort,
        writeZeroYieldQuarantine,
      } = require("./refill-zero-yield-quarantine");
      const currentQuarantine = await readZeroYieldQuarantine(
        zeroYieldQuarantinePath,
        { now: generatedAt },
      );
      const updatedQuarantine = recordZeroYieldCohort(currentQuarantine, {
        stories: attemptedRows,
        now: generatedAt,
      });
      await writeZeroYieldQuarantine(
        zeroYieldQuarantinePath,
        updatedQuarantine,
      );
      const activeExclusions = buildZeroYieldExclusions(updatedQuarantine, {
        now: generatedAt,
      });
      activeZeroYieldExclusions = activeExclusions;
      zeroYieldRecovery.quarantine = {
        path: zeroYieldQuarantinePath,
        status: "updated",
        active_entry_count: activeExclusions.active_entry_count,
        excluded_story_count: activeExclusions.story_ids.length,
        excluded_source_count:
          activeExclusions.source_fingerprints.length,
        rss_offset_per_feed: activeExclusions.rss_offset_per_feed,
        error: null,
      };
    } catch (err) {
      zeroYieldRecovery.quarantine.status = "update_failed";
      zeroYieldRecovery.quarantine.error = clean(err.message);
      zeroYieldRecovery.enqueue_errors.push(
        `zero_yield_quarantine:${clean(err.message)}`,
      );
      log(
        `[fresh-production-refill] zero-yield quarantine update failed: ${err.message}`,
      );
    }
    let alternateCohort = null;
    if (zeroYieldAttempt < 1) {
      try {
        const buildAlternateIntake =
          ctx?.buildFreshReviewLocalPromotionIntake ||
          require("./fresh-review-local-promotion-intake")
            .buildFreshReviewLocalPromotionIntake;
        const selectAlternateCandidates =
          ctx?.selectAlternateCohortCandidates ||
          require("./ops/alternate-cohort-candidate-selector")
            .selectAlternateCohortCandidates;
        const motionScorecardDocument = await readJsonIfPresent(
          clean(payload.alternate_motion_scorecards_path) ||
            path.join(ROOT, "output", "candidate-supply", "story_priority_scorecard.json"),
          {},
        );
        const motionScorecards = Array.isArray(motionScorecardDocument)
          ? motionScorecardDocument
          : asArray(
              motionScorecardDocument.scorecards ||
                motionScorecardDocument.priority_scorecards ||
                motionScorecardDocument.rows ||
                motionScorecardDocument.candidates,
            );
        const alternateIntake = await buildAlternateIntake({
          db: ctx?.repos?.db || null,
          limit: Math.min(6, Math.max(1, Number(payload.alternate_cohort_limit || 6) || 6)),
          maxAgeHours: 7 * 24,
          approvedMaxAgeHours: Math.min(
            48,
            Math.max(
              1,
              Number(payload.alternate_approved_max_age_hours || 36) || 36,
            ),
          ),
          minScore: Math.max(1, Number(payload.alternate_cohort_min_score || 60) || 60),
          now: generatedAt,
          motionScorecards,
        });
        const selection = selectAlternateCandidates({
          primaryAttemptedStoryIds: attemptedStoryIds,
          reviewLocalPromotionCandidates: asArray(
            alternateIntake?.fresh_source_intake_stories,
          ),
          excludedStoryIds: activeZeroYieldExclusions.story_ids,
          excludedSourceFingerprints:
            activeZeroYieldExclusions.source_fingerprints,
          maxCandidates: Math.min(
            6,
            Math.max(1, Number(payload.alternate_cohort_limit || 6) || 6),
          ),
          now: generatedAt,
        });
        const alternateDir = path.resolve(
          ROOT,
          contractOutDir,
          "strict-refill-outcome",
          "alternate-cohort",
        );
        const reportPath = path.join(
          alternateDir,
          "alternate_cohort_selection_report.json",
        );
        const storiesPath = path.join(
          alternateDir,
          "alternate_cohort_stories.json",
        );
        await fs.ensureDir(alternateDir);
        await fs.writeJson(
          reportPath,
          {
            ...selection,
            intake_summary: alternateIntake?.summary || null,
            intake_repair_results: asArray(
              alternateIntake?.repair_results,
            ),
            primary_attempted_story_ids: attemptedStoryIds,
          },
          { spaces: 2 },
        );
        await fs.writeJson(storiesPath, asArray(selection.candidates), {
          spaces: 2,
        });
        alternateCohort = {
          ...selection,
          report_path: reportPath,
          stories_path: storiesPath,
        };
        zeroYieldRecovery.alternate_cohort_selected_count =
          Number(selection.summary?.selected_count || 0);
        zeroYieldRecovery.alternate_cohort_selection_fingerprint =
          clean(selection.selection_fingerprint) || null;
        zeroYieldRecovery.alternate_cohort_report_path = reportPath;
        zeroYieldRecovery.alternate_cohort_stories_path = storiesPath;
      } catch (err) {
        zeroYieldRecovery.alternate_cohort_error = clean(err.message);
        zeroYieldRecovery.enqueue_errors.push(
          `alternate_cohort:${clean(err.message)}`,
        );
        log(
          `[fresh-production-refill] alternate cohort selection failed: ${err.message}`,
        );
      }
    }
    if (ctx?.repos?.jobs) {
      const channelId = job.channel_id || process.env.CHANNEL || "pulse-gaming";
      const isoHour = generatedAt.toISOString().slice(0, 13).replace(/[:T]/g, "-");
      const incidentKey = clean(strictOutcome?.incident_fingerprint).slice(0, 24) || isoHour;
      const verificationRunAt = new Date(generatedAt.getTime() + (10 * 60 * 1000))
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "");
      if (
        zeroYieldAttempt < 1 &&
        alternateCohort &&
        asArray(alternateCohort.candidates).length > 0
      ) {
        try {
          ctx.repos.jobs.enqueue({
            kind: "fresh_production_refill",
            channel_id: channelId,
            payload: {
              ...payload,
              limit: Math.min(6, asArray(alternateCohort.candidates).length),
              seed_stories_file: alternateCohort.stories_path,
              out_dir: `${outDir}-zero-yield-${zeroYieldAttempt + 1}`,
              contract_out_dir: `${contractOutDir}-zero-yield-${zeroYieldAttempt + 1}`,
              reason: "fresh_production_refill_zero_yield_alternate_cohort",
              zero_yield_attempt: zeroYieldAttempt + 1,
              recovery_depth: zeroYieldAttempt + 1,
              exclude_story_ids: uniqueClean([
                ...asArray(payload.exclude_story_ids),
                ...asArray(payload.excludeStoryIds),
                ...alreadyReadyStoryIds,
                ...attemptedStoryIds,
              ]),
              repair_evidence: true,
              repair_evidence_mode: "full",
              repair_story_limit: Math.max(
                6,
                Number(payload.repair_story_limit || payload.repairStoryLimit || 0),
              ),
              post_discord_on_zero_yield: payload.post_discord_on_zero_yield !== false,
            },
            priority: Math.max(74, Number(payload.priority || 0)),
            max_attempts: 1,
            idempotency_key:
              `fresh_refill_zero_yield_alternate:${incidentKey}:` +
              `${clean(alternateCohort.selection_fingerprint).slice(0, 16) || "selected"}`,
          });
          zeroYieldRecovery.alternate_refill_enqueued = true;
        } catch (err) {
          zeroYieldRecovery.enqueue_errors.push(`alternate_refill:${clean(err.message)}`);
        }
      }
      try {
        ctx.repos.jobs.enqueue({
          kind: "safe_auto_repair_runner",
          channel_id: channelId,
          payload: {
            limit: Math.max(8, Number(payload.repair_limit || 0)),
            execute: true,
            reason: "fresh_production_refill_zero_yield",
            source_story_ids: attemptedStoryIds,
            recovery_depth: zeroYieldAttempt,
          },
          priority: 73,
          max_attempts: 1,
          idempotency_key: `fresh_refill_zero_yield_repair:${incidentKey}:${zeroYieldAttempt}`,
        });
        zeroYieldRecovery.repair_enqueued = true;
      } catch (err) {
        zeroYieldRecovery.enqueue_errors.push(`repair:${clean(err.message)}`);
      }
      try {
        ctx.repos.jobs.enqueue({
          kind: "candidate_supply_monitor",
          channel_id: channelId,
          payload: {
            reason: "fresh_production_refill_zero_yield_verification",
            enqueue_hunt_on_runway_gap: false,
            enqueue_fresh_review_script_repair: false,
            enqueue_local_tts_retry_recovery: false,
            enqueue_fresh_production_refill: false,
            enqueue_repair_on_amber: false,
            post_discord: true,
          },
          priority: 72,
          max_attempts: 1,
          run_at: verificationRunAt,
          idempotency_key: `fresh_refill_zero_yield_verify:${incidentKey}:${zeroYieldAttempt}`,
        });
        zeroYieldRecovery.verification_enqueued = true;
      } catch (err) {
        zeroYieldRecovery.enqueue_errors.push(`verification:${clean(err.message)}`);
      }
    }
    if (payload.post_discord_on_zero_yield !== false) {
      try {
        const sendDiscord = require("../notify");
        await sendDiscord([
          "**Pulse Fresh Refill Zero-Yield Incident**",
          `Stories checked: ${storyCount}`,
          `Local package GREEN: ${localPackageGreenCount}`,
          `Strict scheduler GREEN: ${greenCount}`,
          `Target shortfall: ${strictOutcome?.shortfall ?? (greenCount === 0 ? 1 : 0)}`,
          `Attempt: ${zeroYieldAttempt + 1}/2`,
          `Failed-source quarantine: ${zeroYieldRecovery.quarantine.status === "updated"
            ? `${zeroYieldRecovery.quarantine.active_entry_count} active`
            : "update failed"}`,
          `Alternate intake: ${zeroYieldRecovery.alternate_refill_enqueued ? "queued" : "not queued"}`,
          `Repair lane: ${zeroYieldRecovery.repair_enqueued ? "queued" : "not queued"}`,
          `Verification: ${zeroYieldRecovery.verification_enqueued ? "queued" : "not queued"}`,
          `Next: ${zeroYieldRecovery.alternate_refill_enqueued
            ? "broader intake excludes the failed cohort"
            : "hold publishing until a fresh strict-GREEN candidate exists"}`,
        ].join("\n"));
      } catch (err) {
        zeroYieldRecovery.enqueue_errors.push(`discord:${clean(err.message)}`);
        log(`[fresh-production-refill] zero-yield Discord alert failed: ${err.message}`);
      }
    }
  }
  return {
    status: repairPlanDeferred
      ? "repair_planned"
      : zeroYieldDetected
        ? zeroYieldRecovery.alternate_refill_enqueued
          ? "zero_yield_recovery_enqueued"
          : "zero_yield_blocked"
        : "completed",
    story_count: storyCount,
    green_count: greenCount,
    red_count: redCount,
    local_package_green_count: localPackageGreenCount,
    local_package_red_count: localPackageRedCount,
    outputs,
    repair_evidence: repairEvidence,
    motion_hydrated_refill: motionHydratedRefill,
    materialization_continuation: materializationContinuation,
    strict_outcome: strictOutcome,
    zero_yield_incident: zeroYieldRecovery,
    ready_story_exclusion: {
      enabled: skipExistingReady || explicitExcludedStoryIds.length > 0,
      source: skipExistingReady ? "dry_run_ready_stories" : "payload_only",
      story_ids: alreadyReadyStoryIds,
      skipped_count: Number(repairEvidence?.summary?.already_ready_skipped_story_package_count || 0),
    },
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
        enqueue_fresh_production_refill: true,
        enqueue_fresh_review_script_repair: true,
        enqueue_local_tts_retry_recovery: true,
        fresh_production_refill_limit: Number(payload.fresh_production_refill_limit || 12),
        fresh_production_refill_rss_per_feed: Number(payload.fresh_production_refill_rss_per_feed || 4),
        fresh_production_refill_tts_provider: clean(
          payload.fresh_production_refill_tts_provider ||
            payload.fresh_production_refill_tts_provider_preference ||
            payload.tts_provider_preference ||
            payload.tts_provider ||
            "elevenlabs",
        ),
        local_tts_retry_limit: Number(payload.local_tts_retry_limit || 6),
        local_tts_retry_apply_limit: Number(payload.local_tts_retry_apply_limit || 3),
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
  if (payload.smoke !== false) args.push("--smoke");

  return withLocalTtsJobLease({
    kind: "local_tts_doctor",
    job,
    payload,
    root,
    ctx,
    run: async () => {
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
    },
  });
}

function resolveLocalTtsJobLeasePath({ root = ROOT, payload = {}, env = process.env } = {}) {
  const explicit = clean(
    payload.local_tts_lock_path ||
      payload.local_tts_lease_path ||
      env.PULSE_LOCAL_TTS_JOB_LEASE_PATH,
  );
  return explicit
    ? path.resolve(root, explicit)
    : path.join(root, "test", "output", "local_tts_job_lease.json");
}

function localTtsJobLeaseTtlMs({ payload = {}, env = process.env } = {}) {
  const raw = Number(payload.local_tts_lease_ttl_ms || env.PULSE_LOCAL_TTS_JOB_LEASE_MS);
  if (Number.isFinite(raw) && raw >= 60_000) return Math.min(raw, 60 * 60 * 1000);
  return 20 * 60 * 1000;
}

async function readLocalTtsJobLease(lockPath) {
  try {
    return JSON.parse(await fsp.readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function localTtsJobLeaseExpired(lease = {}, nowMs = Date.now()) {
  const expiresAt = Date.parse(lease.expires_at || lease.expiresAt || "");
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

async function tryAcquireLocalTtsJobLease({ lockPath, owner, ttlMs, nowMs = Date.now() } = {}) {
  await fs.ensureDir(path.dirname(lockPath));
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const lease = {
    owner,
    pid: process.pid,
    created_at: createdAt,
    expires_at: expiresAt,
  };
  try {
    await fsp.writeFile(lockPath, JSON.stringify(lease, null, 2), { flag: "wx" });
    return { acquired: true, lease };
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
    const existing = await readLocalTtsJobLease(lockPath);
    if (existing && !localTtsJobLeaseExpired(existing, nowMs)) {
      return { acquired: false, existing };
    }
    await fsp.unlink(lockPath).catch(() => {});
    await fsp.writeFile(lockPath, JSON.stringify(lease, null, 2), { flag: "wx" });
    return { acquired: true, lease, reclaimed_stale: true };
  }
}

async function withLocalTtsJobLease({ kind, job, payload = {}, root = ROOT, ctx, run }) {
  if (payload.local_tts_lease === false) return run();
  const lockPath = resolveLocalTtsJobLeasePath({ root, payload });
  const owner = `${kind}:${job?.id || "manual"}:${process.pid}`;
  const acquired = await tryAcquireLocalTtsJobLease({
    lockPath,
    owner,
    ttlMs: localTtsJobLeaseTtlMs({ payload }),
  });
  if (!acquired.acquired) {
    const holder = clean(acquired.existing?.owner || acquired.existing?.pid || "unknown");
    ctx?.log?.(`[${kind}] skipped: local TTS busy holder=${holder}`);
    return {
      status: "skipped",
      reason: "local_tts_busy",
      local_tts_busy: true,
      holder,
      lease_path: lockPath,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
    };
  }
  try {
    return await run();
  } finally {
    const current = await readLocalTtsJobLease(lockPath);
    if (!current || clean(current.owner) === owner) {
      await fsp.unlink(lockPath).catch(() => {});
    }
  }
}

function countReadyLocalScriptDrafts(plan = {}) {
  const explicit = Number(plan.counts?.ready);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return (Array.isArray(plan.drafts) ? plan.drafts : []).filter(
    (draft) => clean(draft?.action) === "ready_for_local_liam_audio",
  ).length;
}

function localTtsCrashQuarantineEvidence(report = {}) {
  if (!report || typeof report !== "object") return { quarantined: false };
  const failureCode = clean(report.failure_code || report.failureCode);
  const action = clean(report.action);
  const smoke = report.generation_smoke && typeof report.generation_smoke === "object"
    ? report.generation_smoke
    : {};
  const smokeError = clean(smoke.error || smoke.reason || smoke.message);
  const reason = clean(report.reason);
  const text = `${failureCode} ${action} ${smokeError} ${reason}`.toLowerCase();
  const smokeFailed =
    smoke.ok === false ||
    /^generation_smoke_failed/.test(failureCode) ||
    /\bgeneration_smoke_failed\b/.test(text);
  const nativeCrashLike =
    /\bconnection_reset\b/.test(text) ||
    /\baccess\s+violation\b/.test(text) ||
    /\bnative_crash\b/.test(text) ||
    /\bserver_down\b/.test(text);
  if (!smokeFailed || !nativeCrashLike) return { quarantined: false };
  return {
    quarantined: true,
    failure_code: failureCode || "local_tts_generation_smoke_failed",
    smoke_error: smokeError || null,
    action: action || null,
    reason: reason || null,
    recommended_provider: "elevenlabs",
  };
}

async function handleLocalTtsRetryRecovery(job, ctx) {
  const payload = (job && job.payload) || {};
  const root = path.join(__dirname, "..");
  const limit = Math.max(1, Math.min(20, Number(payload.limit || 6) || 6));
  const applyLimit = Math.max(0, Math.min(limit, Number(payload.apply_limit || 3) || 3));
  const execute = payload.execute !== false;
  const outDir = payload.out_dir
    ? path.resolve(root, String(payload.out_dir))
    : path.join(root, "test", "output");
  const queuePath = path.join(outDir, "local_media_repair_queue.json");
  const planPath = path.join(outDir, "local_script_extension_plan.json");
  const applyPath = path.join(outDir, "local_script_extension_audio_apply.json");
  const overnightPath = path.join(outDir, "local_tts_overnight_report.json");
  const defaultOvernightPath = path.join(root, "test", "output", "local_tts_overnight_report.json");
  const runChild = ctx?.runNodeJobChildProcess || runNodeJobChildProcess;
  const log = (ctx && ctx.log) || console.log;
  const childResults = [];
  const doctorReportPath = payload.local_tts_doctor_report_path
    ? path.resolve(root, String(payload.local_tts_doctor_report_path))
    : path.join(outDir, "local_tts_doctor.json");

  if (payload.ignore_local_tts_crash_quarantine !== true) {
    const doctorReport = await readJsonIfPresent(doctorReportPath, {});
    const quarantine = localTtsCrashQuarantineEvidence(doctorReport);
    if (quarantine.quarantined) {
      return {
        status: "skipped",
        reason: "local_tts_crash_quarantined",
        local_tts_crash_quarantined: true,
        recommended_provider: quarantine.recommended_provider,
        local_tts_doctor_report: doctorReportPath,
        local_tts_failure_code: quarantine.failure_code,
        local_tts_smoke_error: quarantine.smoke_error,
        local_tts_action: quarantine.action,
        local_tts_reason: quarantine.reason,
        local_only: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_mutation: true,
        disabled_platforms_unchanged: true,
      };
    }
  }

  return withLocalTtsJobLease({
    kind: "local_tts_retry_recovery",
    job,
    payload,
    root,
    ctx,
    run: async () => {
      await fs.ensureDir(outDir);

      const run = async ({ label, childKind, args, timeoutEnvName }) => {
        const result = await runChild({
          label,
          childKind,
          args,
          timeoutEnvName,
          log,
        });
        childResults.push({
          child_kind: childKind,
          ok: result?.ok !== false,
          stdout_tail: clean(result?.stdout_tail).slice(-500),
          stderr_tail: clean(result?.stderr_tail).slice(-500),
        });
        return result;
      };

      await run({
        label: "local-tts-retry-doctor",
        childKind: "local_tts_retry_doctor",
        args: ["tools/local-tts-doctor.js", "--json", "--restart", "--prewarm", "--smoke"],
        timeoutEnvName: "PULSE_LOCAL_TTS_DOCTOR_CHILD_TIMEOUT_MS",
      });
      await run({
        label: "local-tts-retry-queue",
        childKind: "local_tts_retry_queue",
        args: [
          "tools/local-media-repair.js",
          "--dry-run",
          "--limit",
          String(limit),
          "--out-dir",
          outDir,
        ],
        timeoutEnvName: "PULSE_LOCAL_TTS_RETRY_CHILD_TIMEOUT_MS",
      });
      await run({
        label: "local-tts-retry-preflight",
        childKind: "local_tts_retry_preflight",
        args: [
          "tools/local-script-extension.js",
          "--dry-run",
          "--limit",
          String(limit),
          "--out-dir",
          outDir,
          "--queue",
          queuePath,
        ],
        timeoutEnvName: "PULSE_LOCAL_TTS_RETRY_CHILD_TIMEOUT_MS",
      });

      const plan = await readJsonIfPresent(planPath, {});
      const planReadyCount = countReadyLocalScriptDrafts(plan);
      let applyReport = {};
      if (execute && applyLimit > 0 && planReadyCount > 0) {
        await run({
          label: "local-tts-retry-apply",
          childKind: "local_tts_retry_apply",
          args: [
            "tools/local-script-extension.js",
            "--apply-local-audio",
            "--apply-limit",
            String(applyLimit),
            "--out-dir",
            outDir,
            "--queue",
            queuePath,
          ],
          timeoutEnvName: "PULSE_LOCAL_TTS_RETRY_APPLY_CHILD_TIMEOUT_MS",
        });
        applyReport = await readJsonIfPresent(applyPath, {});
      }

      await run({
        label: "local-tts-retry-report",
        childKind: "local_tts_retry_report",
        args: ["tools/local-tts-overnight-report.js", "--json"],
        timeoutEnvName: "PULSE_LOCAL_TTS_RETRY_CHILD_TIMEOUT_MS",
      });
      const overnightReport = await readJsonIfPresent(
        overnightPath,
        await readJsonIfPresent(defaultOvernightPath, {}),
      );

      return {
        status: "completed",
        limit,
        apply_limit: applyLimit,
        execute_requested: execute,
        child_process_count: childResults.length,
        failed_child_process_count: childResults.filter((child) => !child.ok).length,
        plan_ready_count: planReadyCount,
        applied_count: (Array.isArray(applyReport.applied) ? applyReport.applied : []).length,
        skipped_count: (Array.isArray(applyReport.skipped) ? applyReport.skipped : []).length,
        overnight_verdict: clean(overnightReport.verdict || overnightReport.status || null) || null,
        autonomous_recovery_status:
          clean(overnightReport.autonomous_recovery?.status || null) || null,
        outputs: {
          out_dir: outDir,
          queue: queuePath,
          plan: planPath,
          apply: execute && planReadyCount > 0 ? applyPath : null,
          overnight_report:
            (await fs.pathExists(overnightPath)) ? overnightPath : defaultOvernightPath,
        },
        child_processes: childResults,
        local_only: true,
        no_publish: true,
        no_db_mutation: true,
        no_oauth_or_token_mutation: true,
        disabled_platforms_unchanged: true,
      };
    },
  });
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
  const authCheckExplicitlyEnabled = /^(true|1|yes|on)$/i.test(
    String(process.env.TIKTOK_AUTH_CHECK_ENABLED || "").trim(),
  );
  const tiktokDisabled = !authCheckExplicitlyEnabled && (
    /^(false|0|no|off)$/i.test(String(process.env.TIKTOK_ENABLED || "").trim()) ||
    /^(false|0|no|off)$/i.test(String(process.env.TIKTOK_AUTO_UPLOAD_ENABLED || "").trim())
  );
  if (tiktokDisabled) {
    if (ctx.log) ctx.log("[tiktok_auth_check] skipped: operator_disabled");
    return {
      skipped: "operator_disabled",
      refresh_attempted: false,
      refresh_ok: false,
      needs_reauth: false,
    };
  }

  // The primary protected runner may come back after an outage with several
  // daily auth checks queued. Complete every superseded check without touching
  // OAuth state, then let the newest due check perform one real inspection.
  // Comparing due rows instead of using a fixed age means a long outage still
  // gets a recovery check as soon as the runtime returns.
  const rawRunAt = String(job?.run_at || "").trim();
  let newerDueJob = null;
  if (job?.id && rawRunAt && ctx?.repos?.db?.prepare) {
    newerDueJob = ctx.repos.db
      .prepare(`
        SELECT id
        FROM jobs
        WHERE kind = 'tiktok_auth_check'
          AND status = 'pending'
          AND run_at <= datetime('now')
          AND (
            datetime(run_at) > datetime(@runAt)
            OR (datetime(run_at) = datetime(@runAt) AND id > @id)
          )
        ORDER BY datetime(run_at) DESC, id DESC
        LIMIT 1
      `)
      .get({ id: Number(job.id), runAt: rawRunAt });
  }
  if (newerDueJob) {
    if (ctx.log) {
      ctx.log(
        `[tiktok_auth_check] skipped superseded job=${job.id} newer_due_job=${newerDueJob.id}`,
      );
    }
    return {
      skipped: "superseded_auth_check_job",
      scheduled_for: rawRunAt || null,
      superseded_by_job_id: Number(newerDueJob.id),
      refresh_attempted: false,
      refresh_ok: false,
      needs_reauth: false,
    };
  }

  const { inspectTokenStatus, forceRefreshStoredToken } = require("../upload_tiktok");
  const { getPublicUrl } = require("./deployment-mode");
  const tiktokAuthUrl = `${getPublicUrl()}/auth/tiktok`;

  // TikTok access tokens normally last 24 hours. Refresh at the fixed
  // daily checkpoint even when the previous refresh happened at another
  // time of day, otherwise the route can remain expired for most of a day.
  const REFRESH_IF_LESS_THAN_SECONDS = 26 * 60 * 60;

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
        await forceRefreshStoredToken();
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
      await forceRefreshStoredToken();
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
  oauth_uptime_maintenance: handleOAuthUptimeMaintenance,
  instagram_pending_verify: handleInstagramPendingVerify,
  publish_runway_generate: handlePublishRunwayGenerate,
  publish_schedule_recovery_monitor: handlePublishScheduleRecoveryMonitor,
  publish_window_watchdog: handlePublishWindowWatchdog,
  render_health_digest: handleRenderHealthDigest,
  overnight_produce_sweep: handleOvernightProduceSweep,
  overnight_analytics_backfill: handleOvernightAnalyticsBackfill,
  overnight_claude_analyst: handleOvernightClaudeAnalyst,
  overnight_morning_digest: handleOvernightMorningDigest,
  live_performance_analyst: handleLivePerformanceAnalyst,
  continuous_learning_loop: handleContinuousLearningLoop,
  growth_autopilot: handleGrowthAutopilot,
  candidate_supply_monitor: handleCandidateSupplyMonitor,
  fresh_review_script_repair: handleFreshReviewScriptRepair,
  fresh_production_refill: handleFreshProductionRefill,
  competitor_forensics_lab: handleCompetitorForensicsLab,
  competitor_quality_gate: handleCompetitorQualityGate,
  commercial_learning_loop: handleCommercialLearningLoop,
  autonomous_feedback_monitor: handleAutonomousFeedbackMonitor,
  local_tts_doctor: handleLocalTtsDoctor,
  local_tts_retry_recovery: handleLocalTtsRetryRecovery,
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
  handlePublishRunwayGenerate,
  handlePublishScheduleRecoveryMonitor,
  handlePublishWindowWatchdog,
  buildFreshRefillOfficialSourceEvidence,
  buildFreshRefillDirectMediaDiscoveryInput,
  buildFreshRefillScriptRewriteWorkOrder,
  dedupeFreshRefillOfficialStories,
  buildFreshRefillRepairPackageFilter,
  freshRefillRepairAttemptScope,
  freshRefillDryRunReadyStoryIds,
  freshRefillAudioTimestampMaterializerTimeoutMs,
  freshRefillHyperframesStoryIdsAfterMotion,
  freshRefillHyperframesCardTimeoutMs,
  hydratedFreshProductionRefillArgs,
  freshRefillMaterializedAudioStoryIdsFromReport,
  freshRefillNarrationProviderPreference,
  freshRefillOfficialYoutubeMotionRows,
  freshRefillOfficialYoutubeMotionChildArgs,
  freshRefillPlatformVariantChildArgs,
  freshRefillShouldRunOfficialDiscovery,
  freshRefillSupplementalSearchEntity,
  collectFreshRefillHyperframesCardStoryEvidence,
  summarizeFreshRefillUnderSupportedMotion,
  mergeFreshRefillDirectMediaIntakeEntries,
  writeFreshRefillVisualSourceReviewsForRejectedSegments,
  handleGuardedLiveDispatchPublish,
  normaliseJobChildProcessEvidence,
  runNodeJobChildProcess,
  runProduceChildProcess,
  runAnalyticsChildProcess,
  CORE_PLATFORMS,
  OPTIONAL_PLATFORMS,
  FALLBACK_POSTS,
};
