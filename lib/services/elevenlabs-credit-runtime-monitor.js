"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const axios = require("axios");
const {
  safeRedirectConfig,
} = require("../safe-url");
const {
  createElevenLabsCreditGovernor,
} = require("./elevenlabs-credit-governor");
const {
  buildElevenLabsCreditMonitorArtifact,
} = require("./elevenlabs-credit-monitor");

const RUNTIME_HEALTH_SCHEMA =
  "pulse-elevenlabs-credit-runtime-health-v1";
const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const JSON_FILENAME = "elevenlabs-credit-status.json";
const MARKDOWN_FILENAME = "elevenlabs-credit-status.md";

function finiteInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function safeErrorCode(error) {
  const candidate = String(error?.code || "").trim();
  if (/^elevenlabs_[a-z0-9_]{1,120}$/.test(candidate)) {
    return candidate;
  }
  return "elevenlabs_credit_monitor_refresh_failed";
}

function transitionKey(artifact) {
  const thresholdState = {
    verdict: artifact?.verdict || "BLOCKED",
    subscription_status:
      artifact?.subscription?.status || "unavailable",
    warnings: [...(artifact?.warnings || [])].sort(),
    overage_reported:
      Number(artifact?.subscription?.current_overage_amount || 0) > 0,
  };
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(thresholdState))
    .digest("hex")
    .slice(0, 16)}`;
}

function renderMarkdown(artifact) {
  return [
    "# ElevenLabs credit status",
    "",
    `- Verdict: ${artifact.verdict}`,
    `- Plan: ${artifact.subscription.tier || "unknown"} (${artifact.subscription.status || "unknown"})`,
    `- Included credits: ${artifact.included_credits.remaining.toLocaleString("en-GB")} remaining of ${artifact.included_credits.limit.toLocaleString("en-GB")} (${artifact.included_credits.remaining_percent.toFixed(2)}%)`,
    `- Protected reserve: ${artifact.included_credits.hard_reserve.toLocaleString("en-GB")}`,
    `- Safely spendable before reserve: ${artifact.included_credits.safe_spendable.toLocaleString("en-GB")}`,
    `- Next reset: ${artifact.next_reset_at || "unknown"}`,
    `- Account overage permitted externally: ${artifact.subscription.external_overage_enabled ? "yes" : "no"}`,
    `- Pulse permits overage: ${artifact.subscription.local_overage_allowed ? "yes" : "no"}`,
    "",
    "## Conservative capacity",
    "",
    `- 750-character Shorts: ${artifact.capacity.short_750_characters.safe_renders}`,
    `- 10,000-character longforms: ${artifact.capacity.longform_10000_characters.safe_renders}`,
    "",
    "## Warnings",
    "",
    ...(artifact.warnings.length
      ? artifact.warnings.map((warning) => `- ${warning}`)
      : ["- None"]),
    "",
    "## Actions",
    "",
    ...(artifact.actions.length
      ? artifact.actions.map((action) => `- ${action}`)
      : ["- None"]),
    "",
  ].join("\n");
}

async function replaceFileAtomically(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.` +
    `${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function failureArtifact(error, generatedAt) {
  const errorCode = safeErrorCode(error);
  const artifact = buildElevenLabsCreditMonitorArtifact({
    generated_at: generatedAt,
    provider: "elevenlabs",
    status: "unavailable",
    warnings: [errorCode],
    available_credits_before_request: 0,
    included_credits_remaining: 0,
    included_credit_limit: 0,
    remaining_percent: 0,
    hard_reserve_credits: 0,
    external_overage_enabled: false,
    local_overage_allowed: false,
  });
  artifact.actions = [
    ...new Set([
      ...artifact.actions,
      "restore_read_only_subscription_monitoring_before_paid_tts",
    ]),
  ];
  return { artifact, errorCode };
}

function createDefaultRequest(input) {
  return axios({
    ...input,
    validateStatus: () => true,
    ...safeRedirectConfig(0),
    maxBodyLength: 256 * 1024,
    maxContentLength: 2 * 1024 * 1024,
  });
}

function createElevenLabsCreditRuntimeMonitor(options = {}) {
  const env = options.env || process.env;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const log =
    typeof options.log === "function" ? options.log : () => {};
  const notify =
    typeof options.notify === "function" ? options.notify : null;
  const alertsEnabled =
    /^(true|1|yes|on)$/i.test(
      String(
        env.ELEVENLABS_CREDIT_MONITOR_DISCORD_ALERTS || "",
      ).trim(),
    );
  const setIntervalFn =
    options.setIntervalFn || globalThis.setInterval;
  const clearIntervalFn =
    options.clearIntervalFn || globalThis.clearInterval;
  const refreshIntervalMs = finiteInRange(
    env.ELEVENLABS_CREDIT_MONITOR_INTERVAL_MS,
    DEFAULT_REFRESH_INTERVAL_MS,
    MIN_REFRESH_INTERVAL_MS,
    MAX_REFRESH_INTERVAL_MS,
  );
  const outputRoot = path.resolve(
    options.outputRoot ||
      env.PULSE_OPS_OUTPUT_ROOT ||
      path.join(__dirname, "..", "..", "output", "ops"),
  );
  const governor =
    options.governor ||
    createElevenLabsCreditGovernor({
      env,
      request: options.request || createDefaultRequest,
      now,
    });

  let active = false;
  let timer = null;
  let inFlight = null;
  let artifact = null;
  let lastAttemptAt = null;
  let lastSuccessAt = null;
  let nextRefreshAt = null;
  let lastErrorCode = null;
  let lastTransitionKey = null;
  let lastTransitionVerdict = null;

  function currentTimeMs() {
    const candidate = Number(now());
    return Number.isFinite(candidate) ? candidate : Date.now();
  }

  function health() {
    return {
      schema_version: RUNTIME_HEALTH_SCHEMA,
      active,
      verdict: artifact?.verdict || "BLOCKED",
      allow_paid_synthesis:
        artifact?.allow_paid_synthesis === true,
      included_credits_remaining:
        artifact?.included_credits?.remaining ?? 0,
      remaining_percent:
        artifact?.included_credits?.remaining_percent ?? 0,
      safe_spendable_credits:
        artifact?.included_credits?.safe_spendable ?? 0,
      next_reset_at: artifact?.next_reset_at || null,
      last_attempt_at: lastAttemptAt,
      last_success_at: lastSuccessAt,
      next_refresh_at: nextRefreshAt,
      refresh_interval_ms: refreshIntervalMs,
      threshold_state_key: lastTransitionKey,
      last_error_code: lastErrorCode,
      evidence: {
        json: JSON_FILENAME,
        markdown: MARKDOWN_FILENAME,
      },
      safety: {
        read_only_subscription_check: true,
        invokes_tts: false,
        mutates_billing: false,
        secrets_excluded: true,
      },
    };
  }

  async function loadPreviousTransitionKey() {
    try {
      const prior = JSON.parse(
        await fs.readFile(path.join(outputRoot, JSON_FILENAME), "utf8"),
      );
      if (
        typeof prior?.monitoring?.threshold_state_key === "string"
      ) {
        lastTransitionKey = prior.monitoring.threshold_state_key;
        lastTransitionVerdict =
          typeof prior?.verdict === "string"
            ? prior.verdict
            : null;
      }
    } catch {
      /* No trustworthy previous baseline. */
    }
  }

  async function persist(nextArtifact) {
    await Promise.all([
      replaceFileAtomically(
        path.join(outputRoot, JSON_FILENAME),
        `${JSON.stringify(nextArtifact, null, 2)}\n`,
      ),
      replaceFileAtomically(
        path.join(outputRoot, MARKDOWN_FILENAME),
        renderMarkdown(nextArtifact),
      ),
    ]);
  }

  async function performRefresh(trigger) {
    const attemptMs = currentTimeMs();
    lastAttemptAt = new Date(attemptMs).toISOString();
    nextRefreshAt = new Date(
      attemptMs + refreshIntervalMs,
    ).toISOString();

    let nextArtifact;
    let errorCode = null;
    try {
      const report = await governor.status({ force: true });
      nextArtifact = buildElevenLabsCreditMonitorArtifact(report);
      lastSuccessAt = nextArtifact.generated_at;
    } catch (error) {
      const failure = failureArtifact(error, lastAttemptAt);
      nextArtifact = failure.artifact;
      errorCode = failure.errorCode;
    }

    const nextTransitionKey = transitionKey(nextArtifact);
    const stateChanged =
      lastTransitionKey !== null &&
      lastTransitionKey !== nextTransitionKey;
    const previousVerdict = lastTransitionVerdict;
    nextArtifact.monitoring = {
      trigger,
      refresh_interval_ms: refreshIntervalMs,
      threshold_state_key: nextTransitionKey,
      state_changed: stateChanged,
      last_error_code: errorCode,
    };
    await persist(nextArtifact);
    artifact = nextArtifact;
    lastTransitionKey = nextTransitionKey;
    lastTransitionVerdict = nextArtifact.verdict;
    lastErrorCode = errorCode;
    log(
      `[elevenlabs-credit-monitor] ${nextArtifact.verdict} trigger=${trigger}`,
    );
    if (stateChanged && alertsEnabled && notify) {
      const message =
        `**ElevenLabs credit state changed**\n` +
        `${previousVerdict || "UNKNOWN"} -> ${nextArtifact.verdict}\n` +
        `Remaining: ${nextArtifact.included_credits.remaining} ` +
        `(${nextArtifact.included_credits.remaining_percent.toFixed(2)}%)\n` +
        `Safe spendable before reserve: ${nextArtifact.included_credits.safe_spendable}\n` +
        `Paid TTS allowed by credit state: ${nextArtifact.allow_paid_synthesis ? "yes" : "no"}`;
      try {
        await notify(message);
      } catch {
        log(
          "[elevenlabs-credit-monitor] transition_alert_failed",
        );
      }
    }
    return health();
  }

  async function refreshNow(trigger = "manual") {
    if (!inFlight) {
      inFlight = performRefresh(String(trigger || "manual")).finally(
        () => {
          inFlight = null;
        },
      );
    }
    return inFlight;
  }

  async function start() {
    if (active) return health();
    active = true;
    await loadPreviousTransitionKey();
    await refreshNow("startup");
    timer = setIntervalFn(() => {
      void refreshNow("interval").catch((error) => {
        log(
          `[elevenlabs-credit-monitor] persistence_failed code=${safeErrorCode(error)}`,
        );
      });
    }, refreshIntervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    return health();
  }

  async function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    active = false;
    return health();
  }

  return {
    start,
    stop,
    refreshNow,
    status: health,
  };
}

module.exports = {
  DEFAULT_REFRESH_INTERVAL_MS,
  RUNTIME_HEALTH_SCHEMA,
  createElevenLabsCreditRuntimeMonitor,
};
