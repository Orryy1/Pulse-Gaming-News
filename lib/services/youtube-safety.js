"use strict";

const { redactSensitive } = require("../ops/railway-health");

const YOUTUBE_AUTH_TELEMETRY_SCHEMA =
  "pulse-youtube-auth-telemetry-v1";

function createYoutubeAuthTelemetry() {
  return {
    schema_version: YOUTUBE_AUTH_TELEMETRY_SCHEMA,
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };
}

function normaliseYoutubeAuthTelemetry(value = {}) {
  const refresh = value?.ephemeral_access_token_refresh || {};
  return {
    schema_version: YOUTUBE_AUTH_TELEMETRY_SCHEMA,
    durable_oauth_or_token_mutated:
      value?.durable_oauth_or_token_mutated === true,
    ephemeral_access_token_refresh: {
      attempted:
        refresh.attempted === true ||
        refresh.succeeded === true ||
        refresh.failed === true,
      succeeded: refresh.succeeded === true,
      failed: refresh.failed === true,
    },
  };
}

function updateYoutubeAuthTelemetry(target, value) {
  const normalised = normaliseYoutubeAuthTelemetry(value);
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return normalised;
  }
  target.schema_version = normalised.schema_version;
  target.durable_oauth_or_token_mutated =
    normalised.durable_oauth_or_token_mutated;
  target.ephemeral_access_token_refresh = {
    ...normalised.ephemeral_access_token_refresh,
  };
  return target;
}

function sanitiseYoutubeErrorMessage(value, env = process.env) {
  let safe = redactSensitive(String(value ?? ""));
  safe = safe
    .replace(
      /(Bearer\s+)[^\s,;}"']+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:["']?(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|authorization|password|secret|token)["']?)\s*[:=]\s*["']?)[^"'\s,;}&]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:access_token|refresh_token|client_secret|api_key|key|token)=)[^&\s]+/gi,
      "$1[REDACTED]",
    );
  for (const key of [
    "YOUTUBE_ACCESS_TOKEN",
    "YOUTUBE_REFRESH_TOKEN",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_API_KEY",
  ]) {
    const secret = String(env?.[key] || "");
    if (secret.length >= 8) {
      safe = safe.split(secret).join("[REDACTED]");
    }
  }
  return safe.slice(0, 1000);
}

function sanitiseYoutubeError(error, env = process.env) {
  const safe =
    error instanceof Error
      ? error
      : new Error(sanitiseYoutubeErrorMessage(error, env));
  safe.message = sanitiseYoutubeErrorMessage(safe.message, env);
  if (typeof safe.stack === "string") {
    safe.stack = sanitiseYoutubeErrorMessage(safe.stack, env);
  }
  for (const field of [
    "response",
    "request",
    "config",
    "cause",
    "errors",
  ]) {
    if (field in safe) {
      try {
        safe[field] = undefined;
      } catch {
        // Non-writable diagnostic fields remain inaccessible to persistence,
        // which consumes only the already-sanitised message.
      }
    }
  }
  return safe;
}

async function runSanitisedYoutubeOperation(operation, env = process.env) {
  try {
    return await operation();
  } catch (error) {
    throw sanitiseYoutubeError(error, env);
  }
}

module.exports = {
  YOUTUBE_AUTH_TELEMETRY_SCHEMA,
  createYoutubeAuthTelemetry,
  normaliseYoutubeAuthTelemetry,
  runSanitisedYoutubeOperation,
  sanitiseYoutubeError,
  sanitiseYoutubeErrorMessage,
  updateYoutubeAuthTelemetry,
};
