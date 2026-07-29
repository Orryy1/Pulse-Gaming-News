"use strict";

const crypto = require("node:crypto");
const { resolveOperatingContract } = require("./operating-contract");
const {
  EXPERIMENTAL_RENDERER_ID,
  STANDARD_RENDERER_ID,
} = require("./renderer-governance");

const BOOLEAN_KEYS = Object.freeze([
  "USE_SQLITE",
  "USE_JOB_QUEUE",
  "AUTO_PUBLISH",
  "PULSE_GUARDED_LIVE_DISPATCH_ENABLED",
  "PULSE_PRIMARY_INSTANCE",
  "PULSE_EMERGENCY_KILL_SWITCH",
  "PULSE_MULTI_LANE_WORKERS",
  "PULSE_MULTI_LANE_STARTUP_PRIME",
  "BREAKING_WATCHER_ENABLED",
  "PULSE_PAID_AI_ENABLED",
  "ELEVENLABS_ALLOW_OVERAGE",
  "ELEVENLABS_CREDIT_MONITOR_ENABLED",
  "ELEVENLABS_CREDIT_MONITOR_DISCORD_ALERTS",
  "TIKTOK_ENABLED",
  "INSTAGRAM_AUTO_PUBLISH",
  "FACEBOOK_AUTO_PUBLISH",
  "TWITTER_ENABLED",
]);

const ENUMS = Object.freeze({
  NODE_ENV: ["development", "test", "production"],
  PULSE_OPERATING_MODE: ["LOCAL_PROOF", "HUMAN_REVIEW", "LIVE_GUARDED"],
  PULSE_SCHEDULER_PROFILE: [
    "stabilisation_30d",
    "governed_multi_lane",
  ],
  CHANNEL: ["pulse-gaming"],
  PULSE_STANDARD_RENDERER: [STANDARD_RENDERER_ID],
  PULSE_EXPERIMENTAL_RENDERER: [
    EXPERIMENTAL_RENDERER_ID,
    "disabled",
  ],
});

const SECRET_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "ELEVENLABS_API_KEY",
  "YOUTUBE_API_KEY",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "TIKTOK_CLIENT_SECRET",
  "TIKTOK_ACCESS_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN",
  "FACEBOOK_PAGE_TOKEN",
  "TWITTER_API_SECRET",
  "TWITTER_ACCESS_SECRET",
  "DISCORD_WEBHOOK_URL",
  "API_TOKEN",
]);
const NON_SECRET_SCALAR_KEYS = Object.freeze([
  "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256",
]);

let dotenvLoadResult = null;
const patchedDotenvModules = new Map();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (/^(true|1|yes|on)$/i.test(String(value).trim())) return true;
  if (/^(false|0|no|off)$/i.test(String(value).trim())) return false;
  return null;
}

function parseRuntimeConfig(env = process.env) {
  const values = {
    NODE_ENV: String(env.NODE_ENV || "development").trim().toLowerCase(),
    PULSE_OPERATING_MODE: String(
      env.PULSE_OPERATING_MODE || "LOCAL_PROOF",
    )
      .trim()
      .toUpperCase(),
    PULSE_SCHEDULER_PROFILE: String(
      env.PULSE_SCHEDULER_PROFILE || "stabilisation_30d",
    ).trim(),
    CHANNEL: String(env.CHANNEL || "pulse-gaming").trim(),
    PULSE_STANDARD_RENDERER: String(
      env.PULSE_STANDARD_RENDERER || STANDARD_RENDERER_ID,
    ).trim(),
    PULSE_EXPERIMENTAL_RENDERER: String(
      env.PULSE_EXPERIMENTAL_RENDERER || EXPERIMENTAL_RENDERER_ID,
    ).trim(),
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: String(
      env.PULSE_YOUTUBE_OAUTH_CLIENT_SHA256 || "",
    )
      .trim()
      .toLowerCase(),
  };
  const errors = [];

  for (const key of BOOLEAN_KEYS) {
    const fallback = key === "USE_JOB_QUEUE";
    values[key] = parseBoolean(env[key], fallback);
    if (values[key] === null) errors.push(`invalid_boolean:${key}`);
  }

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(values[key])) errors.push(`invalid_enum:${key}`);
  }

  if (values.NODE_ENV === "production" && values.USE_JOB_QUEUE !== true) {
    errors.push("production_requires_durable_job_queue");
  }
  if (values.USE_JOB_QUEUE !== true) {
    errors.push("durable_job_queue_required");
  }
  if (values.NODE_ENV === "production" && values.USE_SQLITE !== true) {
    errors.push("production_requires_sqlite");
  }
  if (
    values.AUTO_PUBLISH === true &&
    values.PULSE_OPERATING_MODE !== "LIVE_GUARDED"
  ) {
    errors.push("auto_publish_requires_live_guarded_mode");
  }
  const operatingContract = resolveOperatingContract({ env });
  for (const blocker of operatingContract.blockers) {
    errors.push(`operating_contract:${blocker}`);
  }

  return {
    schema_version: "pulse-runtime-config-v1",
    valid: errors.length === 0,
    values,
    errors: [...new Set(errors)],
    operating_contract: operatingContract,
  };
}

function assertValidRuntimeConfig(env = process.env) {
  const parsed = parseRuntimeConfig(env);
  if (parsed.valid) return parsed;

  const error = new Error(
    `Pulse runtime configuration is invalid: ${parsed.errors.join(", ")}`,
  );
  error.name = "PulseRuntimeConfigError";
  error.code = "PULSE_RUNTIME_CONFIG_INVALID";
  error.validationErrors = parsed.errors;
  throw error;
}

function valueHash(value) {
  if (value === undefined || value === null || value === "") return null;
  return `sha256:${crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, 16)}`;
}

function buildEffectiveConfigReport({
  env = process.env,
  sourceClasses = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const parsed = parseRuntimeConfig(env);
  const keys = [
    ...Object.keys(ENUMS),
    ...BOOLEAN_KEYS,
    ...NON_SECRET_SCALAR_KEYS,
    ...SECRET_KEYS,
  ].filter((key, index, all) => all.indexOf(key) === index);

  return {
    schema_version: "pulse-effective-config-v1",
    generated_at: generatedAt,
    valid: parsed.valid,
    validation_errors: parsed.errors,
    entries: keys.map((key) => {
      const present = env[key] !== undefined && String(env[key]).length > 0;
      const secret = SECRET_KEYS.includes(key);
      const validation = parsed.errors.filter((error) => error.endsWith(key));
      const entry = {
        key,
        present,
        source_class:
          sourceClasses[key] || (present ? "process_environment" : "default"),
        secret,
        value_hash: valueHash(env[key]),
        validation: validation.length ? validation : ["valid"],
      };
      if (!secret) {
        entry.value =
          parsed.values[key] !== undefined ? parsed.values[key] : env[key] ?? null;
      }
      return entry;
    }),
  };
}

function loadDotenvOnce({ dotenv, env = process.env } = {}) {
  if (dotenvLoadResult) {
    return { ...dotenvLoadResult, cached: true };
  }
  if (!dotenv || typeof dotenv.config !== "function") {
    throw new Error("dotenv_config_function_required");
  }

  const inherited = new Map(Object.entries(env));
  const originalConfig = patchedDotenvModules.get(dotenv) || dotenv.config;
  const result = originalConfig.call(dotenv, {
    override: false,
    quiet: true,
  }) || {};
  for (const [key, value] of inherited.entries()) {
    env[key] = value;
  }
  if (parseBoolean(env.PULSE_PAID_AI_ENABLED, false) !== true) {
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_AI_API_KEY;
  }
  dotenvLoadResult = {
    loaded: !result.error,
    cached: false,
    parsed_keys: Object.keys(result.parsed || {}),
    error: result.error ? String(result.error.message || result.error) : null,
  };
  if (!patchedDotenvModules.has(dotenv)) {
    patchedDotenvModules.set(dotenv, originalConfig);
    dotenv.config = function pulseOneShotDotenvConfig() {
      return {
        parsed: {},
        pulse_cached: true,
        pulse_loaded: dotenvLoadResult?.loaded === true,
      };
    };
  }
  return { ...dotenvLoadResult };
}

function resetRuntimeConfigForTests() {
  dotenvLoadResult = null;
  for (const [dotenv, originalConfig] of patchedDotenvModules.entries()) {
    dotenv.config = originalConfig;
  }
  patchedDotenvModules.clear();
}

module.exports = {
  BOOLEAN_KEYS,
  ENUMS,
  SECRET_KEYS,
  assertValidRuntimeConfig,
  buildEffectiveConfigReport,
  loadDotenvOnce,
  parseBoolean,
  parseRuntimeConfig,
  resetRuntimeConfigForTests,
  valueHash,
};
