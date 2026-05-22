"use strict";

const { buildPlatformOperationalConfig } = require("./platform-status");
const { shouldAttemptInstagramUrlFallback } = require("../../upload_instagram");

const SECRET_PATTERNS = [
  /\b(access_token|refresh_token|client_secret|api_key)\b\s*[:=]\s*["']?[^"',\s}]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /([?&](?:access_token|refresh_token|token|client_secret|api_key)=)[^&\s]+/gi,
];

function redact(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "$1[REDACTED]");
  return text;
}

function tokenReadyStatus(tokenStatus = {}) {
  if (tokenStatus.ok === true) return "token_ready";
  if (tokenStatus.needs_reauth === true) return "operator_reauth_required";
  if (tokenStatus.refresh_available === true || tokenStatus.needs_refresh_or_sync === true) {
    return "needs_local_token_refresh_or_sync";
  }
  return tokenStatus.reason || "token_state_unclear";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasEnv(env, name) {
  return String(env?.[name] || "").trim().length > 0;
}

function envFlag(env, name) {
  return /^(true|1|yes|on)$/i.test(String(env?.[name] || "").trim());
}

function topReadyTikTokPack(tiktokAutomationReport = {}) {
  return (
    tiktokAutomationReport.dispatchGate?.topReadyPack ||
    tiktokAutomationReport.dispatchGate?.topPack ||
    null
  );
}

function packNeedsTikTokCreativeReview(pack = {}) {
  const status = String(pack?.status || "");
  if (!status) return false;
  if (pack.creativeReviewRequired === true) return true;
  if (Array.isArray(pack.creativeBlockers) && pack.creativeBlockers.length > 0) {
    return true;
  }
  return /(?:creative|promotion|forensic|visual|weak_rendered).*review|required|blocked/i.test(
    status,
  );
}

function packDurationSeconds(pack = {}) {
  return numberOrNull(
    pack?.eligibility?.durationSeconds ??
      pack?.durationSeconds ??
      pack?.duration_seconds,
  );
}

function normaliseTikTokNoPostReadiness(
  tiktokAutomationReport = {},
  tokenStatus = {},
  { officialInboxRoute = "not_checked", readyPack = null, creativeBlocked = false } = {},
) {
  const gates = tiktokAutomationReport.noPostReadiness || {};
  const browserOAuth = gates.browserOAuth || {};
  const localToken = gates.localToken || {};
  const officialInbox = gates.officialInbox || {};
  const directPost = gates.directPost || {};
  const dispatchCreative = gates.dispatchCreative || {};

  return {
    browser_oauth: {
      status: browserOAuth.status || "not_verified_by_this_report",
      completed_at: browserOAuth.completed_at || null,
      evidence: browserOAuth.evidence || null,
      local_token_proven:
        browserOAuth.local_token_proven === true || tokenStatus.ok === true,
      local_token_status:
        browserOAuth.local_token_status ||
        (tokenStatus.ok === true
          ? "usable"
          : tokenStatus.refresh_available === true || tokenStatus.needs_refresh_or_sync === true
            ? "expired_but_refreshable"
            : tokenStatus.needs_reauth === true
              ? "operator_reauth_required"
              : tokenStatus.reason || "unknown"),
    },
    local_token: {
      status:
        localToken.status ||
        (tokenStatus.ok === true
          ? "usable"
          : tokenStatus.refresh_available === true || tokenStatus.needs_refresh_or_sync === true
            ? "expired_but_refreshable"
            : tokenStatus.needs_reauth === true
              ? "operator_reauth_required"
              : tokenStatus.reason || "unknown"),
      next_action:
        localToken.next_action ||
        (tokenStatus.ok === true
          ? "none"
          : tokenStatus.refresh_available === true || tokenStatus.needs_refresh_or_sync === true
            ? "refresh_or_sync_local_token"
            : tokenStatus.needs_reauth === true
              ? "operator_reauth_required"
              : "inspect_token_state"),
      refresh_available:
        localToken.refresh_available === true || tokenStatus.refresh_available === true,
      needs_reauth: localToken.needs_reauth === true || tokenStatus.needs_reauth === true,
    },
    official_inbox: {
      status: officialInbox.status || officialInboxRoute,
      ready_pack_present: officialInbox.ready_pack_present === true,
      public_auto_publish: false,
    },
    direct_post: {
      status:
        directPost.status ||
        "blocked_by_app_review_or_direct_post_approval",
      blocker: directPost.blocker || "direct_post_approval_not_declared",
    },
    dispatch_creative: {
      status:
        readyPack && !creativeBlocked
          ? "ready_for_operator_review"
          : dispatchCreative.status || "not_checked",
      story_id:
        readyPack && !creativeBlocked
          ? readyPack.storyId || readyPack.story_id || null
          : dispatchCreative.storyId || dispatchCreative.story_id || null,
      blockers:
        readyPack && !creativeBlocked
          ? []
          : Array.isArray(dispatchCreative.blockers)
            ? dispatchCreative.blockers
            : [],
    },
  };
}

function buildXReadiness({ platformConfig = {}, xEnv = process.env } = {}) {
  const config = platformConfig.twitter || buildPlatformOperationalConfig(xEnv).twitter || {};
  const requiredCredentials = [
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_SECRET",
  ];
  const missingCredentials = requiredCredentials.filter((name) => !hasEnv(xEnv, name));
  const credentialsPresent = missingCredentials.length === 0;
  const billingConfirmed =
    envFlag(xEnv, "TWITTER_API_BILLING_CONFIRMED") ||
    envFlag(xEnv, "X_API_BILLING_CONFIRMED") ||
    envFlag(xEnv, "X_PAID_API_CONFIRMED");
  const operatorEnabled = config.state === "enabled" || envFlag(xEnv, "TWITTER_ENABLED");
  const status = !operatorEnabled
    ? "operator_disabled"
    : !credentialsPresent
      ? "missing_credentials"
      : !billingConfirmed
        ? "api_billing_not_confirmed"
        : "ready_for_dry_run_upload_test";
  const enablementGaps = [];
  if (!operatorEnabled) enablementGaps.push("x_operator_disabled");
  if (!credentialsPresent) enablementGaps.push("x_credentials_missing");
  if (!billingConfirmed) enablementGaps.push("x_api_billing_not_declared");

  return {
    status,
    reason: config.reason || null,
    public_auto_publish: false,
    network_calls_allowed: false,
    enablement_gaps: enablementGaps,
    no_post_readiness: {
      operator_switch: {
        status: operatorEnabled ? "enabled" : "disabled",
        required_env: "TWITTER_ENABLED",
      },
      credential_set: {
        status: credentialsPresent ? "present" : "missing",
        missing_count: missingCredentials.length,
        required_count: requiredCredentials.length,
      },
      api_billing: {
        status: billingConfirmed ? "confirmed" : "not_declared",
        accepted_envs: [
          "TWITTER_API_BILLING_CONFIRMED",
          "X_API_BILLING_CONFIRMED",
          "X_PAID_API_CONFIRMED",
        ],
      },
      direct_post: {
        status: status === "ready_for_dry_run_upload_test"
          ? "ready_for_operator_dry_run_test"
          : "blocked_until_enablement_complete",
        public_auto_publish: false,
        network_calls_allowed: false,
      },
    },
    recommendation:
      status === "operator_disabled"
        ? "keep_x_disabled_until_paid_api_and_credentials_are_confirmed"
        : status === "missing_credentials"
          ? "add_complete_x_oauth_1a_write_credentials_before_testing"
          : status === "api_billing_not_confirmed"
            ? "confirm_paid_x_api_video_posting_before_enabling"
            : "run_dry_run_x_upload_policy_check_before_any_live_post",
  };
}

function buildTikTokReadiness({ tokenStatus = {}, tiktokAutomationReport = {} } = {}) {
  const status = tokenReadyStatus(tokenStatus);
  const pack = topReadyTikTokPack(tiktokAutomationReport);
  const packStatus = String(pack?.status || "");
  const creativeBlocked =
    packNeedsTikTokCreativeReview(pack) ||
    (Array.isArray(tiktokAutomationReport.blockers) &&
      tiktokAutomationReport.blockers.some((blocker) => /creative|promotion|review/i.test(String(blocker))));
  const hasUsablePack =
    pack &&
    (pack.status === "ready_for_operator_review" ||
      tiktokAutomationReport.routeStrategy?.some((route) => route.id === "official_inbox_upload"));
  const officialInboxRoute = creativeBlocked
    ? "creative_review_required_before_inbox"
    : hasUsablePack
      ? tokenStatus.ok === true
        ? "ready_pending_explicit_upload_approval"
        : "prepared_not_executed"
      : "needs_clean_60s_dispatch_pack";

  return {
    status,
    browser_oauth_may_be_ok: tokenStatus.ok !== true && tokenStatus.needs_reauth !== true,
    official_inbox_route: officialInboxRoute,
    public_direct_post: "blocked_until_tiktok_app_review_or_direct_post_approval",
    no_post_readiness: normaliseTikTokNoPostReadiness(
      tiktokAutomationReport,
      tokenStatus,
      { officialInboxRoute, readyPack: pack, creativeBlocked },
    ),
    token: {
      ok: tokenStatus.ok === true,
      reason: tokenStatus.reason || null,
      expires_in_seconds: Number.isFinite(Number(tokenStatus.expires_in_seconds))
        ? Number(tokenStatus.expires_in_seconds)
        : null,
      refresh_available: tokenStatus.refresh_available === true,
      needs_reauth: tokenStatus.needs_reauth === true,
    },
    pack: pack
      ? {
          story_id: pack.storyId || pack.story_id || null,
          status: pack.status || null,
          duration_seconds: packDurationSeconds(pack),
          mp4_present: Boolean(pack.mp4 || pack.mp4_path),
          cover_present: Boolean(pack.cover || pack.cover_path),
          creative_review_required: creativeBlocked,
        }
      : null,
    recommendation:
      status === "token_ready"
        ? "prepare_one_official_inbox_upload_packet_but_do_not_send_without_approval"
        : status === "needs_local_token_refresh_or_sync"
          ? "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload"
          : "produce_clean_current_60s_pack_then_rerun_platform_doctor",
  };
}

function classifyInstagramReadinessError(errorLike) {
  const text = redact(errorLike?.message || errorLike || "");
  const code = text.match(/\b(2207\d{3})\b/)?.[1] || null;
  const fallbackAllowed = shouldAttemptInstagramUrlFallback(new Error(text));
  if (
    code === "2207076" ||
    /Media upload has failed|processing failed|unsupported|codec|pix_fmt|profile|duration|aspect/i.test(text)
  ) {
    return {
      category: "media_processing_rejected",
      error_code: code,
      summary: text,
      url_fallback_allowed: false,
      retry_same_mp4_recommended: false,
      next_action: "rerender_mp4_codec_qa_required",
    };
  }
  if (/pending_processing_timeout/i.test(text)) {
    return {
      category: "pending_processing_verifier_required",
      error_code: code,
      summary: text,
      url_fallback_allowed: false,
      retry_same_mp4_recommended: false,
      next_action: "run_delayed_verifier_before_retry",
    };
  }
  if (fallbackAllowed) {
    return {
      category: "transport_or_upload_session_failure",
      error_code: code,
      summary: text,
      url_fallback_allowed: true,
      retry_same_mp4_recommended: false,
      next_action: "url_fallback_may_be_safe_if_mp4_passes_codec_qa",
    };
  }
  return {
    category: text ? "unknown_instagram_error" : "no_recent_error",
    error_code: code,
    summary: text || null,
    url_fallback_allowed: false,
    retry_same_mp4_recommended: false,
    next_action: text ? "inspect_instagram_error_and_media_qa" : "monitor_next_publish",
  };
}

function buildInstagramReadiness({ lastError = null } = {}) {
  const diagnosis = classifyInstagramReadinessError(lastError);
  const status =
    diagnosis.category === "media_processing_rejected"
      ? "blocked_by_media_processing_rejection"
      : diagnosis.category === "pending_processing_verifier_required"
        ? "pending_verifier_required"
        : diagnosis.category === "no_recent_error"
          ? "enabled_monitor_next_publish"
          : "needs_operator_review";
  return {
    status,
    last_error: diagnosis,
    fallback_policy:
      diagnosis.url_fallback_allowed === true
        ? "transport_only_after_codec_qa"
        : "do_not_resubmit_same_rejected_mp4",
  };
}

function buildFacebookReadiness({
  platformConfig = {},
  facebookManualProof = {},
  facebookEligibilityReport = {},
} = {}) {
  const config = platformConfig.facebook_reel || buildPlatformOperationalConfig().facebook_reel;
  const eligibility = facebookEligibilityReport.classification || {};
  const evidence = facebookEligibilityReport.evidence || {};
  const visibleGraphReel =
    eligibility.verdict === "eligible_for_normal_publish" ||
    Number(evidence.videos?.count || 0) > 0 ||
    Number(evidence.reels?.count || 0) > 0;
  const tokenValid = evidence.tokenDebug?.data?.is_valid === true;
  const pageCanPost = evidence.page?.data?.can_post === true;
  const manualObserved = facebookManualProof.observed === true;
  const graphEligible =
    eligibility.verdict === "eligible_for_normal_publish" ||
    (visibleGraphReel && tokenValid && pageCanPost);
  return {
    status: config.state === "enabled" ? "enabled_verify_after_upload" : config.state,
    reason: config.reason || null,
    manual_reel_upload_observed: manualObserved || graphEligible,
    manual_proof_note:
      facebookManualProof.note ||
      (graphEligible
        ? "read_only_graph_eligibility_visible_reel_or_video_found"
        : null),
    graph_eligibility: {
      verdict: eligibility.verdict || "not_checked",
      reason: eligibility.reason || null,
      visible_reel_or_video_found: visibleGraphReel,
      token_valid: tokenValid,
      page_can_post: pageCanPost,
      videos_count: Number(evidence.videos?.count || 0),
      reels_count: Number(evidence.reels?.count || 0),
    },
    verifier_contract: {
      requires_ready_status: true,
      requires_permalink_or_published_flag: true,
      treats_complete_without_permalink_as_not_live: true,
      avoids_false_success: true,
    },
    recommendation:
      config.state === "enabled"
        ? "watch_next_normal_publish_and_trust_verifier_not_finish_phase_alone"
        : "resolve_facebook_reels_mode_before_upload",
  };
}

function buildPlatformReadinessDoctor({
  generatedAt = new Date().toISOString(),
  tiktokTokenStatus = {},
  tiktokAutomationReport = {},
  platformConfig = null,
  xEnv = process.env,
  instagramLastError = null,
  facebookManualProof = {},
  facebookEligibilityReport = {},
} = {}) {
  const operational = platformConfig || buildPlatformOperationalConfig();
  const tiktok = buildTikTokReadiness({ tokenStatus: tiktokTokenStatus, tiktokAutomationReport });
  const instagram = buildInstagramReadiness({ lastError: instagramLastError });
  const x = buildXReadiness({ platformConfig: operational, xEnv });
  const facebook = buildFacebookReadiness({
    platformConfig: operational,
    facebookManualProof,
    facebookEligibilityReport,
  });
  const blockers = [];

  if (tiktok.status === "needs_local_token_refresh_or_sync") {
    blockers.push("tiktok_local_token_refresh_or_sync_required");
  } else if (tiktok.status === "operator_reauth_required") {
    blockers.push("tiktok_operator_reauth_required");
  }
  if (tiktok.official_inbox_route === "needs_clean_60s_dispatch_pack") {
    blockers.push("tiktok_clean_dispatch_pack_required");
  }
  if (tiktok.official_inbox_route === "creative_review_required_before_inbox") {
    blockers.push("tiktok_creative_review_required");
  }
  if (instagram.last_error.category === "media_processing_rejected") {
    blockers.push("instagram_reel_rerender_required");
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_platform_readiness_doctor",
    verdict: blockers.length ? "AMBER" : "GREEN",
    blockers,
    platforms: {
      tiktok,
      x,
      facebook_reel: facebook,
      instagram_reel: instagram,
    },
    enablement_gaps: x.enablement_gaps,
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
      no_production_db_mutation: true,
    },
  };
}

function renderPlatformReadinessDoctorMarkdown(report = {}) {
  const lines = [
    "# Platform Readiness Doctor",
    "",
    "Read-only diagnostic. It performs no OAuth, token mutation, uploads or posts.",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "unknown"}`,
    "",
    "## Blockers",
  ];
  if (report.blockers?.length) {
    for (const blocker of report.blockers) lines.push(`- ${redact(blocker)}`);
  } else {
    lines.push("- none");
  }
  const tiktok = report.platforms?.tiktok || {};
  lines.push(
    "",
    "## TikTok",
    "",
    `- Status: ${redact(tiktok.status || "unknown")}`,
    `- Official inbox route: ${redact(tiktok.official_inbox_route || "unknown")}`,
    `- Public direct post: ${redact(tiktok.public_direct_post || "unknown")}`,
    `- Recommendation: ${redact(tiktok.recommendation || "unknown")}`,
  );
  if (tiktok.pack?.story_id) {
    const durationSeconds = numberOrNull(tiktok.pack.duration_seconds);
    const duration = durationSeconds !== null
      ? `${durationSeconds.toFixed(1)}s`
      : "duration unknown";
    lines.push(`- Ready pack: ${redact(tiktok.pack.story_id)} (${duration})`);
  }
  if (tiktok.no_post_readiness) {
    const gates = tiktok.no_post_readiness;
    lines.push(
      "",
      "### TikTok No-Post Readiness",
      "",
      `- Browser OAuth: ${redact(gates.browser_oauth?.status || "unknown")}; local token proven=${gates.browser_oauth?.local_token_proven === true}; local token status=${redact(gates.browser_oauth?.local_token_status || "unknown")}`,
      `- Local token: ${redact(gates.local_token?.status || "unknown")}; action=${redact(gates.local_token?.next_action || "unknown")}`,
      `- Official inbox: ${redact(gates.official_inbox?.status || "unknown")}; public_auto_publish=false`,
      `- Direct post: ${redact(gates.direct_post?.status || "unknown")}; blocker=${redact(gates.direct_post?.blocker || "unknown")}`,
      `- Dispatch creative: ${redact(gates.dispatch_creative?.status || "unknown")}; story=${redact(gates.dispatch_creative?.story_id || "none")}; blockers=${(gates.dispatch_creative?.blockers || []).map(redact).join(", ") || "none"}`,
    );
  }

  const x = report.platforms?.x || {};
  if (x.status) {
    const gates = x.no_post_readiness || {};
    lines.push(
      "",
      "## X",
      "",
      `- Status: ${redact(x.status || "unknown")}`,
      `- Reason: ${redact(x.reason || "unknown")}`,
      `- Public auto-publish: ${x.public_auto_publish === true}`,
      `- Network calls allowed: ${x.network_calls_allowed === true}`,
      `- Operator switch: ${redact(gates.operator_switch?.status || "unknown")}`,
      `- Credentials: ${redact(gates.credential_set?.status || "unknown")}; missing=${Number(gates.credential_set?.missing_count || 0)}`,
      `- API billing: ${redact(gates.api_billing?.status || "unknown")}`,
      `- Direct post lane: ${redact(gates.direct_post?.status || "unknown")}`,
      `- Recommendation: ${redact(x.recommendation || "unknown")}`,
    );
  }

  const fb = report.platforms?.facebook_reel || {};
  lines.push(
    "",
    "## Facebook Reels",
    "",
    `- Status: ${redact(fb.status || "unknown")}`,
    `- Reason: ${redact(fb.reason || "unknown")}`,
    `- Manual proof observed: ${fb.manual_reel_upload_observed === true}`,
    `- Manual proof note: ${redact(fb.manual_proof_note || "none")}`,
    `- Graph eligibility: ${redact(fb.graph_eligibility?.verdict || "not_checked")}; reason=${redact(fb.graph_eligibility?.reason || "none")}`,
    `- Graph evidence: visible_reel_or_video=${fb.graph_eligibility?.visible_reel_or_video_found === true}; token_valid=${fb.graph_eligibility?.token_valid === true}; page_can_post=${fb.graph_eligibility?.page_can_post === true}`,
    "- Verifier: requires ready status plus published/permalink evidence",
  );

  const ig = report.platforms?.instagram_reel || {};
  lines.push(
    "",
    "## Instagram Reels",
    "",
    `- Status: ${redact(ig.status || "unknown")}`,
    `- Last error category: ${redact(ig.last_error?.category || "none")}`,
    `- Last error code: ${redact(ig.last_error?.error_code || "none")}`,
    `- URL fallback allowed: ${ig.last_error?.url_fallback_allowed === true}`,
    `- Retry same MP4 recommended: ${ig.last_error?.retry_same_mp4_recommended === true}`,
    `- Next action: ${redact(ig.last_error?.next_action || "unknown")}`,
    `- Fallback policy: ${redact(ig.fallback_policy || "unknown")}`,
  );

  lines.push(
    "",
    "## Safety",
    "",
    "- No OAuth triggered",
    "- No token files changed",
    "- No upload attempted",
    "- No public post created",
    "- No production DB rows changed",
    "",
  );
  return `${lines.join("\n")}`;
}

module.exports = {
  buildXReadiness,
  buildPlatformReadinessDoctor,
  classifyInstagramReadinessError,
  renderPlatformReadinessDoctorMarkdown,
};
