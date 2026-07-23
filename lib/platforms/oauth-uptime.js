"use strict";

const REFRESH_HORIZONS_MS = Object.freeze({
  youtube: 6 * 60 * 60 * 1000,
  tiktok: 12 * 60 * 60 * 1000,
  instagram: 30 * 24 * 60 * 60 * 1000,
});

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildPlatformAction(platform, status = {}, now = Date.now()) {
  if (status.enabled !== true) {
    return {
      platform,
      action: "disabled",
      reason: "platform_disabled",
      mutates_token: false,
      requires_human: false,
    };
  }

  if (
    status.credential_kind === "page_access_token" ||
    status.credential_kind === "platform_managed"
  ) {
    return {
      platform,
      action: "validate",
      reason: "non_rotating_or_platform_managed_credential",
      mutates_token: false,
      requires_human: false,
    };
  }

  const expiry = numberOrNull(status.access_expires_at);
  const horizon = REFRESH_HORIZONS_MS[platform];
  if (!horizon) {
    return {
      platform,
      action: "validate",
      reason: "non_rotating_or_platform_managed_credential",
      mutates_token: false,
      requires_human: false,
    };
  }

  if (expiry === null) {
    return {
      platform,
      action: status.refresh_available === true ? "refresh" : "reauthorise",
      reason: "access_expiry_unobserved",
      mutates_token: status.refresh_available === true,
      requires_human: status.refresh_available !== true,
    };
  }

  if (expiry - now <= horizon) {
    return {
      platform,
      action: status.refresh_available === true ? "refresh" : "reauthorise",
      reason: expiry <= now ? "access_expired" : "access_expires_before_horizon",
      mutates_token: status.refresh_available === true,
      requires_human: status.refresh_available !== true,
    };
  }

  return {
    platform,
    action: "none",
    reason: "credential_healthy",
    mutates_token: false,
    requires_human: false,
  };
}

function buildOAuthUptimePlan({
  now = Date.now(),
  platforms = {},
} = {}) {
  const orderedPlatforms = [
    "youtube",
    "tiktok",
    "instagram",
    "facebook",
    "x",
  ];
  const checks = orderedPlatforms.map((platform) =>
    buildPlatformAction(platform, platforms[platform] || {}, Number(now)),
  );
  const actions = checks.filter((check) =>
    ["refresh", "reauthorise", "validate"].includes(check.action),
  );
  return {
    schema_version: 1,
    generated_at: new Date(Number(now)).toISOString(),
    verdict: checks.some((check) => check.requires_human)
      ? "RED"
      : actions.some((action) => action.action === "refresh")
        ? "AMBER"
        : "GREEN",
    checks,
    actions,
    requires_human_reauth: checks.some((check) => check.requires_human),
    safety: {
      social_posting_triggered: false,
      production_db_mutated: false,
      platform_enablement_changed: false,
      token_values_exposed: false,
    },
  };
}

module.exports = {
  REFRESH_HORIZONS_MS,
  buildOAuthUptimePlan,
  buildPlatformAction,
};
