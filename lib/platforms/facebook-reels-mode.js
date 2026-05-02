"use strict";

function normaliseFlag(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveFacebookReelsMode(env = process.env) {
  const raw = normaliseFlag(env.FACEBOOK_REELS_ENABLED);

  if (["false", "0", "no", "off"].includes(raw)) {
    return {
      enabled: false,
      state: "disabled",
      reason: "facebook_reels_operator_disabled",
    };
  }

  if (["true", "1", "yes", "on"].includes(raw)) {
    return {
      enabled: true,
      state: "enabled",
      reason: "facebook_reels_enabled",
    };
  }

  if (!raw) {
    return {
      enabled: true,
      state: "enabled",
      reason: "facebook_reels_default_enabled",
    };
  }

  return {
    enabled: false,
    state: "disabled",
    reason: "facebook_reels_invalid_flag",
  };
}

module.exports = {
  resolveFacebookReelsMode,
};
