"use strict";

const OPERATING_MODES = Object.freeze([
  "LOCAL_PROOF",
  "HUMAN_REVIEW",
  "LIVE_GUARDED",
]);

const PLATFORM_POLICY = Object.freeze({
  youtube: Object.freeze({
    visible: true,
    automation: "governed_approval_union",
    phase: "primary",
  }),
  instagram: Object.freeze({
    visible: true,
    automation: "disabled",
    phase: "post_experiment_pilot",
  }),
  facebook: Object.freeze({
    visible: true,
    automation: "disabled",
    phase: "controlled_proof_only",
  }),
  tiktok: Object.freeze({
    visible: true,
    automation: "manual_only",
    phase: "post_stabilisation",
  }),
  x: Object.freeze({
    visible: true,
    automation: "disabled",
    phase: "frozen",
  }),
  threads: Object.freeze({
    visible: true,
    automation: "disabled",
    phase: "frozen",
  }),
  pinterest: Object.freeze({
    visible: true,
    automation: "disabled",
    phase: "frozen",
  }),
});

const SECONDARY_AUTOMATION_FLAGS = Object.freeze([
  "TIKTOK_ENABLED",
  "TIKTOK_AUTO_PUBLISH",
  "INSTAGRAM_AUTO_PUBLISH",
  "FACEBOOK_AUTO_PUBLISH",
  "TWITTER_ENABLED",
  "X_AUTO_PUBLISH",
  "THREADS_AUTO_PUBLISH",
  "PINTEREST_AUTO_PUBLISH",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function normaliseMode(value) {
  const mode = String(value || "LOCAL_PROOF")
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
  return OPERATING_MODES.includes(mode) ? mode : null;
}

function normalisePlatform(value) {
  const platform = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  const aliases = {
    youtube_shorts: "youtube",
    instagram_reel: "instagram",
    instagram_reels: "instagram",
    facebook_reel: "facebook",
    facebook_reels: "facebook",
    twitter: "x",
    twitter_video: "x",
  };
  return aliases[platform] || platform;
}

function resolveOperatingContract({ env = process.env } = {}) {
  const rawMode = env.PULSE_OPERATING_MODE || env.OPERATING_MODE || "LOCAL_PROOF";
  const mode = normaliseMode(rawMode);
  const blockers = [];
  const advisory = [];

  if (!mode) blockers.push("unknown_operating_mode");

  const effectiveMode = mode || "LOCAL_PROOF";
  const autoPublish = truthy(env.AUTO_PUBLISH);
  const guardedArmed = truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED);
  const useQueue = truthy(env.USE_JOB_QUEUE);
  const useSqlite = truthy(env.USE_SQLITE);
  const explicitPrimary = truthy(env.PULSE_PRIMARY_INSTANCE);
  const killSwitchTripped =
    truthy(env.PULSE_EMERGENCY_KILL_SWITCH) ||
    truthy(env.PULSE_KILL_SWITCH);
  const configuredYoutubeOAuthClientSha256 = String(
    env.PULSE_YOUTUBE_OAUTH_CLIENT_SHA256 || "",
  )
    .trim()
    .toLowerCase();
  const youtubeOAuthClientSha256 =
    SHA256_PATTERN.test(configuredYoutubeOAuthClientSha256)
      ? configuredYoutubeOAuthClientSha256
      : null;

  if (autoPublish && effectiveMode !== "LIVE_GUARDED") {
    blockers.push("legacy_auto_publish_contradicts_operating_mode");
  }

  if (effectiveMode === "LIVE_GUARDED") {
    if (!autoPublish) blockers.push("legacy_publish_arm_not_enabled");
    if (!guardedArmed) blockers.push("guarded_live_dispatch_not_armed");
    if (!useQueue) blockers.push("durable_queue_required");
    if (!useSqlite) blockers.push("sqlite_required");
    if (!explicitPrimary) blockers.push("explicit_primary_required");
    if (killSwitchTripped) blockers.push("kill_switch_tripped");
    if (!configuredYoutubeOAuthClientSha256) {
      blockers.push("youtube_oauth_client_sha256_required");
    } else if (!youtubeOAuthClientSha256) {
      blockers.push("youtube_oauth_client_sha256_invalid");
    }
  }

  const armedSecondaryFlags = SECONDARY_AUTOMATION_FLAGS.filter((key) =>
    truthy(env[key]),
  );
  if (armedSecondaryFlags.length) {
    blockers.push("secondary_platform_automation_frozen");
    advisory.push(
      `Disable frozen secondary automation flags: ${armedSecondaryFlags.join(", ")}`,
    );
  }

  if (
    env.PULSE_OPERATING_MODE &&
    env.OPERATING_MODE &&
    normaliseMode(env.PULSE_OPERATING_MODE) !==
      normaliseMode(env.OPERATING_MODE)
  ) {
    blockers.push("contradictory_operating_mode_flags");
  }

  return {
    contract_version: "pulse-stabilisation-v1",
    mode: effectiveMode,
    requested_mode: String(rawMode),
    valid: blockers.length === 0,
    live_mutation_allowed:
      effectiveMode === "LIVE_GUARDED" && blockers.length === 0,
    human_review_required: effectiveMode !== "LOCAL_PROOF",
    youtube_account_binding: {
      required: effectiveMode === "LIVE_GUARDED",
      expected_oauth_client_sha256:
        effectiveMode === "LIVE_GUARDED"
          ? youtubeOAuthClientSha256
          : null,
    },
    platform_policy: PLATFORM_POLICY,
    freeze: {
      new_platforms: true,
      new_verticals: true,
      finance_crypto: true,
      new_studio_generations: true,
      new_affiliates: true,
      discord_economy: true,
      autonomous_engagement: true,
      broad_auto_publish: true,
      stack_replacement: true,
    },
    approved_stack: ["ElevenLabs", "Epidemic Sound", "HyperFrames", "FFmpeg"],
    disabled_stack: ["HeyGen", "Kokoro", "MusicGen"],
    blockers: [...new Set(blockers)],
    advisory,
  };
}

function evaluatePlatformDispatch({
  contract,
  platform,
  automatic = true,
  humanReviewStatus,
  approvalType,
  autonomousLifecycleVerified = false,
  controlTowerVerdict,
  killSwitchHealthy,
  operatorApproved = false,
} = {}) {
  const current = contract || resolveOperatingContract();
  const target = normalisePlatform(platform);
  const policy = PLATFORM_POLICY[target];
  const blockers = [];

  if (!current.valid) blockers.push("operating_contract_invalid");
  if (!policy) blockers.push("unknown_platform");
  if (!current.live_mutation_allowed) blockers.push("live_guarded_mode_required");

  if (automatic) {
    if (!policy || policy.automation === "disabled") {
      blockers.push("platform_automation_disabled");
    } else if (policy.automation === "manual_only") {
      blockers.push("platform_manual_only");
    }
  } else if (!operatorApproved) {
    blockers.push("operator_approval_required");
  }

  if (target === "youtube") {
    const requestedApprovalType = String(approvalType || "")
      .trim()
      .toUpperCase();
    const effectiveApprovalType =
      requestedApprovalType ||
      (String(humanReviewStatus || "").trim()
        ? "HUMAN"
        : "MISSING");
    if (effectiveApprovalType === "HUMAN") {
      if (
        String(humanReviewStatus || "").toLowerCase() !== "approved"
      ) {
        blockers.push("human_review_not_approved");
      }
      if (autonomousLifecycleVerified === true) {
        blockers.push("approval_basis_cross_conflation");
      }
    } else if (
      effectiveApprovalType ===
      "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE"
    ) {
      if (String(humanReviewStatus || "").trim()) {
        blockers.push("approval_basis_cross_conflation");
      }
      if (autonomousLifecycleVerified !== true) {
        blockers.push(
          "autonomous_publication_lifecycle_not_verified",
        );
      }
    } else {
      blockers.push("governed_approval_type_invalid");
    }
    if (String(controlTowerVerdict || "").toUpperCase() !== "GREEN") {
      blockers.push("control_tower_not_green");
    }
    if (killSwitchHealthy !== true) {
      blockers.push("kill_switch_not_healthy");
    }
  }

  return {
    platform: target,
    automatic: !!automatic,
    approval_type:
      target === "youtube"
        ? String(approvalType || "").trim().toUpperCase() ||
          (String(humanReviewStatus || "").trim()
            ? "HUMAN"
            : "MISSING")
        : null,
    allowed: blockers.length === 0,
    verdict: blockers.length ? "RED" : "GREEN",
    policy: policy || null,
    blockers: [...new Set(blockers)],
  };
}

function evaluateStoryHumanReview(story = {}) {
  const fields = [
    "human_review_status",
    "render_review_status",
    "studio_v21_review_status",
    "operator_review_status",
  ];
  const evidence = fields
    .map((field) => ({ field, value: story?.[field] }))
    .filter((entry) => entry.value !== undefined && entry.value !== null);
  const approved = evidence.some(
    (entry) => String(entry.value).trim().toLowerCase() === "approved",
  );
  return {
    approved,
    status: approved
      ? "approved"
      : evidence[0]
        ? String(evidence[0].value).trim().toLowerCase()
        : "missing",
    evidence,
    blocker: approved ? null : "human_review_not_approved",
  };
}

module.exports = {
  OPERATING_MODES,
  PLATFORM_POLICY,
  SECONDARY_AUTOMATION_FLAGS,
  evaluatePlatformDispatch,
  evaluateStoryHumanReview,
  normaliseMode,
  normalisePlatform,
  resolveOperatingContract,
  truthy,
};
