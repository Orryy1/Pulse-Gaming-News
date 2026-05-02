"use strict";

function getOperationalState(platformStatus, platform) {
  return platformStatus?.operational?.[platform] || {
    state: "unknown",
    reason: "not_reported",
  };
}

function normaliseWorkingState(config) {
  if (config.state === "enabled" || config.state === "enabled_via_scheduler") {
    return "working";
  }
  if (config.state === "blocked_external") return "blocked_external";
  if (config.state === "disabled") return "blocked_external";
  if (config.state === "needs_credentials") return "needs_operator_action";
  return "review";
}

function buildTikTokRoutes({ tiktokDiagnosis = {}, dispatchManifest = {} } = {}) {
  const routes = [
    {
      id: "official_inbox_upload",
      label: "Use TikTok official inbox upload/draft route",
      safety: "low",
      publicAutoPublish: false,
      requiresOperatorTap: true,
      status: tiktokDiagnosis?.evidence?.uploadScopeRequested
        ? "technically_plausible"
        : "needs_video_upload_scope",
      note:
        "Uses TikTok's sanctioned upload-to-inbox flow; operator completes the public post in TikTok.",
    },
    {
      id: "third_party_scheduler_true_autopublish",
      label: "Use an audited third-party scheduler with true TikTok auto-publish",
      safety: "low_medium",
      publicAutoPublish: true,
      requiresOperatorTap: false,
      status: "needs_vendor_test",
      note:
        "Only use after a vendor proves true auto-publish without browser automation or account-risky behaviour.",
    },
    {
      id: "phone_dispatch_pack",
      label: "Use Pulse dispatch pack for manual phone publishing",
      safety: "very_low",
      publicAutoPublish: false,
      requiresOperatorTap: true,
      status: dispatchManifest?.topPack ? dispatchManifest.topPack.status : "no_ready_pack",
      note:
        "Already available and safest today; keeps Creator Rewards account type intact.",
    },
    {
      id: "browser_rpa_test_account_only",
      label: "Browser automation against TikTok Studio",
      safety: "high_account_risk",
      publicAutoPublish: true,
      requiresOperatorTap: false,
      status: "test_account_only",
      note:
        "Do not use on the main Pulse TikTok account; TikTok can treat automated access as abusive.",
    },
  ];
  return routes;
}

function buildFacebookReelAssessment(facebookReelsEligibility = {}) {
  const c = facebookReelsEligibility.classification || {};
  const counts = c.counts || {};
  const page = c.page || {};
  const zeroSurfaces =
    Number(counts.videos || 0) === 0 && Number(counts.reels || 0) === 0;
  const actions = [];
  if (zeroSurfaces) {
    actions.push(
      "Keep automatic Facebook Reels disabled until Meta shows at least one visible Page video/Reel.",
    );
    actions.push(
      "Run one manual Meta Business Suite or Page UI Reel test with the same MP4 to prove the Page itself can publish Reels.",
    );
  }
  if (Number(page.followers_count || page.fan_count || 0) === 0) {
    actions.push(
      "Grow or validate the Page surface first; current Graph evidence shows a published Page with zero followers/fans.",
    );
  }
  return {
    verdict: c.verdict || "unknown",
    reason: c.reason || "not_reported",
    graphCounts: {
      videos: Number(counts.videos || 0),
      reels: Number(counts.reels || 0),
      posts: Number(counts.posts || 0),
    },
    page,
    recommendedActions: actions,
  };
}

function buildSocialPlatformOperationsReport({
  generatedAt = new Date().toISOString(),
  platformStatus = {},
  facebookReelsEligibility = {},
  tiktokDiagnosis = {},
  tiktokTokenStatus = null,
  dispatchManifest = {},
} = {}) {
  const youtube = getOperationalState(platformStatus, "youtube");
  const instagram = getOperationalState(platformStatus, "instagram_reel");
  const facebook = getOperationalState(platformStatus, "facebook_reel");
  const tiktok = getOperationalState(platformStatus, "tiktok");
  const twitter = getOperationalState(platformStatus, "twitter");
  const fbAssessment = buildFacebookReelAssessment(facebookReelsEligibility);
  const tiktokSafeRoutes = buildTikTokRoutes({ tiktokDiagnosis, dispatchManifest });

  const operatorActions = [];
  if (tiktokTokenStatus?.needs_reauth) {
    operatorActions.push(
      `TikTok re-auth required before any official API/inbox route can be tested (reason: ${tiktokTokenStatus.reason}).`,
    );
  }
  if (fbAssessment.recommendedActions.length > 0) {
    operatorActions.push(...fbAssessment.recommendedActions);
  }
  if (tiktok.state === "blocked_external") {
    operatorActions.push(
      "Choose a TikTok route: official inbox upload first, phone dispatch pack as fallback, audited scheduler only after a safe vendor proof.",
    );
  }

  const facebookReelState = (() => {
    if (facebook.state !== "enabled") return "blocked_external";
    if (fbAssessment.verdict === "blocked") return "blocked_external";
    if (fbAssessment.verdict === "eligible_for_normal_publish") return "working";
    return "review";
  })();

  const platforms = {
    youtube: {
      state: normaliseWorkingState(youtube),
      reason: youtube.reason,
      counts: platformStatus.counts?.youtube || {},
    },
    instagram_reel: {
      state: normaliseWorkingState(instagram),
      reason: instagram.reason,
      counts: platformStatus.counts?.instagram_reel || {},
    },
    facebook_reel: {
      state: facebookReelState,
      reason: fbAssessment.reason || facebook.reason,
      counts: platformStatus.counts?.facebook_reel || {},
      eligibility: fbAssessment,
    },
    tiktok: {
      state: tiktok.state === "enabled" ? "working" : "blocked_external",
      reason: tiktok.reason || tiktokDiagnosis.likelyBlocker || "unknown",
      counts: platformStatus.counts?.tiktok || {},
      token: tiktokTokenStatus
        ? {
            ok: tiktokTokenStatus.ok === true,
            reason: tiktokTokenStatus.reason || null,
            refresh_available: tiktokTokenStatus.refresh_available === true,
            needs_reauth: tiktokTokenStatus.needs_reauth === true,
          }
        : null,
      safeRoutes: tiktokSafeRoutes,
    },
    twitter: {
      state: normaliseWorkingState(twitter),
      reason: twitter.reason,
      counts: platformStatus.counts?.twitter || {},
    },
  };

  const blocked = Object.values(platforms).filter((p) =>
    ["blocked_external", "needs_operator_action"].includes(p.state),
  ).length;
  const verdict = blocked > 0 ? "AMBER" : "GREEN";

  return {
    generatedAt,
    verdict,
    platforms,
    operatorActions: Array.from(new Set(operatorActions)),
    safety: {
      readOnly: true,
      postsExternally: false,
      mutatesTokens: false,
      mutatesRailway: false,
      browserAutomation: false,
    },
  };
}

function renderSocialPlatformOperationsMarkdown(report) {
  const lines = [
    "# Social Platform Operations",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    "",
    "## Platform State",
  ];
  for (const [name, platform] of Object.entries(report.platforms || {})) {
    lines.push(
      `- ${name}: ${platform.state}${platform.reason ? ` (${platform.reason})` : ""}`,
    );
  }

  const tiktok = report.platforms?.tiktok;
  if (tiktok) {
    lines.push("", "## TikTok Routes");
    for (const route of tiktok.safeRoutes || []) {
      lines.push(
        `- ${route.id}: status=${route.status}; public_auto_publish=${route.publicAutoPublish}; operator_tap=${route.requiresOperatorTap}; risk=${route.safety}`,
      );
    }
  }

  const fb = report.platforms?.facebook_reel?.eligibility;
  if (fb) {
    lines.push(
      "",
      "## Facebook Reels",
      `- verdict: ${fb.verdict}`,
      `- reason: ${fb.reason}`,
      `- Graph: videos=${fb.graphCounts.videos}, reels=${fb.graphCounts.reels}, posts=${fb.graphCounts.posts}`,
      `- Page: followers=${fb.page.followers_count ?? "unknown"}, fans=${fb.page.fan_count ?? "unknown"}, verified=${fb.page.is_verified ?? "unknown"}`,
    );
  }

  lines.push("", "## Operator Actions");
  if (report.operatorActions?.length) {
    for (const action of report.operatorActions) lines.push(`- ${action}`);
  } else {
    lines.push("- none");
  }

  lines.push(
    "",
    "## Safety",
    "- read-only report",
    "- no OAuth",
    "- no external posting",
    "- no Railway mutation",
    "- no browser automation",
  );
  return lines.join("\n") + "\n";
}

module.exports = {
  buildSocialPlatformOperationsReport,
  renderSocialPlatformOperationsMarkdown,
  buildFacebookReelAssessment,
  buildTikTokRoutes,
};
