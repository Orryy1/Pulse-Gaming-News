"use strict";

const crypto = require("node:crypto");

const CORE_PUBLISH_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];
const SUPPORTED_AUTHORITY_PLATFORMS = [
  ...CORE_PUBLISH_PLATFORMS,
  "tiktok",
  "x",
];
const LEGACY_ENABLED_PLATFORMS = [...CORE_PUBLISH_PLATFORMS];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalisePlatform(value) {
  const platform = clean(value).toLowerCase();
  const aliases = {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    youtube_shorts: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    instagram_reels: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
    facebook_reels: "facebook_reels",
  };
  return aliases[platform] || platform;
}

function declaredEnabledPlatforms(platformPublishManifest = {}) {
  if (Array.isArray(platformPublishManifest.enabled_platforms)) {
    return platformPublishManifest.enabled_platforms;
  }
  if (Array.isArray(platformPublishManifest.platform_scope?.enabled_platforms)) {
    return platformPublishManifest.platform_scope.enabled_platforms;
  }
  return null;
}

function resolvePlatformPublishScope(platformPublishManifest = {}) {
  const declared = declaredEnabledPlatforms(platformPublishManifest);
  const enabledPlatforms = declared === null
    ? [...LEGACY_ENABLED_PLATFORMS]
    : [...new Set(declared.map(normalisePlatform).filter(Boolean))].sort();
  const blockers = [];
  if (declared !== null && !enabledPlatforms.length) {
    blockers.push("platform_scope_enabled_platforms_empty");
  }
  for (const platform of enabledPlatforms) {
    if (!SUPPORTED_AUTHORITY_PLATFORMS.includes(platform)) {
      blockers.push(`platform_scope_enabled_platform_unsupported:${platform}`);
    }
  }
  const disabledPlatforms = CORE_PUBLISH_PLATFORMS
    .filter((platform) => !enabledPlatforms.includes(platform))
    .sort();
  const disabledPlatformReasons = {};
  if (declared !== null) {
    for (const platform of disabledPlatforms) {
      const output = platformPublishManifest.outputs?.[platform];
      if (!output || typeof output !== "object" || Array.isArray(output)) {
        blockers.push(`disabled_platform_entry_missing:${platform}`);
        continue;
      }
      if (clean(output.operational_state || output.status).toLowerCase() !== "disabled") {
        blockers.push(`disabled_platform_state_not_disabled:${platform}`);
      }
      const reason = clean(
        output.reason ||
          output.disabled_reason ||
          output.operational_reason,
      );
      if (!reason) blockers.push(`disabled_platform_reason_missing:${platform}`);
      else disabledPlatformReasons[platform] = reason;
      if (output.can_auto_publish !== false) {
        blockers.push(`disabled_platform_can_auto_publish_not_false:${platform}`);
      }
      if (
        clean(output.planned_action) ||
        asArray(output.planned_actions).length > 0
      ) {
        blockers.push(`disabled_platform_has_planned_action:${platform}`);
      }
    }
  }
  const canonical = {
    enabled_platforms: enabledPlatforms,
    disabled_platforms: disabledPlatforms,
    disabled_platform_reasons: disabledPlatformReasons,
  };
  return {
    explicit: declared !== null,
    ...canonical,
    sha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex"),
    blockers: [...new Set(blockers)],
  };
}

function authorityPlatformScope(scope = {}) {
  return {
    enabled_platforms: asArray(scope.enabled_platforms).map(normalisePlatform).sort(),
    disabled_platforms: asArray(scope.disabled_platforms).map(normalisePlatform).sort(),
    disabled_platform_reasons: {
      ...(scope.disabled_platform_reasons || {}),
    },
    sha256: clean(scope.sha256),
  };
}

module.exports = {
  CORE_PUBLISH_PLATFORMS,
  LEGACY_ENABLED_PLATFORMS,
  SUPPORTED_AUTHORITY_PLATFORMS,
  authorityPlatformScope,
  normalisePlatform,
  resolvePlatformPublishScope,
};
