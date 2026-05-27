"use strict";

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function tokenGateFromReports(authDoctorReport = {}, dispatchManifest = {}) {
  const authToken = authDoctorReport?.token_status || null;
  const authTokenStatusMode = authDoctorReport?.token_status_mode || null;
  const dispatchToken = dispatchManifest?.tiktokTokenGate || null;
  if (authToken) {
    return {
      source: "auth_doctor",
      token_status_mode: authTokenStatusMode || "inspected",
      ok: authToken.ok === true || authToken.connected === true,
      reason: authToken.reason || null,
      expires_in_seconds:
        Number.isFinite(Number(authToken.expires_in_seconds))
          ? Number(authToken.expires_in_seconds)
          : null,
      refresh_available: authToken.refresh_available === true,
      needs_reauth: authToken.needs_reauth === true,
      needs_refresh_or_sync: authToken.needs_refresh_or_sync === true,
      action: authToken.local_action || null,
    };
  }
  if (dispatchToken) {
    return {
      source:
        authTokenStatusMode === "skipped_by_operator_flag"
          ? "dispatch_manifest_snapshot"
          : "dispatch_manifest",
      token_status_mode: authTokenStatusMode || "unknown",
      ok: dispatchToken.ok === true,
      reason: dispatchToken.reason || null,
      expires_in_seconds:
        Number.isFinite(Number(dispatchToken.expires_in_seconds))
          ? Number(dispatchToken.expires_in_seconds)
          : null,
      refresh_available: dispatchToken.refresh_available === true,
      needs_reauth: dispatchToken.needs_reauth === true,
      needs_refresh_or_sync: dispatchToken.needs_refresh_or_sync === true,
      action: dispatchToken.action || null,
    };
  }
  return {
    source: authTokenStatusMode === "skipped_by_operator_flag" ? "not_inspected" : "not_checked",
    token_status_mode: authTokenStatusMode || "unknown",
    ok: false,
    reason: "not_checked",
    expires_in_seconds: null,
    refresh_available: false,
    needs_reauth: false,
    needs_refresh_or_sync: false,
    action: "run_tiktok_auth_doctor",
  };
}

function freshPackSummary(freshDispatchPack = null) {
  const pack = freshDispatchPack?.dispatchPack || null;
  const inboxPlan = freshDispatchPack?.inboxPlan || null;
  if (!pack) return null;
  const creativeBlockers = unique([
    ...(Array.isArray(pack.creativeGate?.blockers) ? pack.creativeGate.blockers : []),
    ...(Array.isArray(freshDispatchPack?.creativeReview?.blockers)
      ? freshDispatchPack.creativeReview.blockers
      : []),
    ...(Array.isArray(inboxPlan?.blockers) ? inboxPlan.blockers : []),
  ]);
  return {
    ...pack,
    source: "fresh_local_dispatch_pack",
    dryRunOnly: inboxPlan?.dry_run !== false,
    creativeReviewRequired:
      freshDispatchPack?.creativeReview?.operator_visual_review_required !== false,
    inboxPlanStatus: inboxPlan?.status || null,
    creativeBlockers,
  };
}

function freshReadyPack(freshDispatchPack = null) {
  const pack = freshPackSummary(freshDispatchPack);
  const inboxPlan = freshDispatchPack?.inboxPlan || null;
  if (!pack || pack.status !== "ready_for_operator_review") return null;
  if (inboxPlan && inboxPlan.status !== "dry_run_ready") return null;
  if (inboxPlan && inboxPlan.will_upload_to_tiktok === true) return null;
  if (freshDispatchPack?.safety?.public_post_created === true) return null;
  return pack;
}

function findReadyPack(dispatchManifest = {}, freshDispatchPack = null) {
  const freshPack = freshReadyPack(freshDispatchPack);
  if (freshPack) return freshPack;
  if (dispatchManifest?.topReadyPack) return dispatchManifest.topReadyPack;
  const packs = Array.isArray(dispatchManifest?.packs) ? dispatchManifest.packs : [];
  return packs.find((pack) => pack.status === "ready_for_operator_review") || null;
}

function firstPack(dispatchManifest = {}, freshDispatchPack = null) {
  const freshPack = freshPackSummary(freshDispatchPack);
  if (freshPack) return freshPack;
  return dispatchManifest?.topPack || (Array.isArray(dispatchManifest?.packs) ? dispatchManifest.packs[0] : null) || null;
}

function statusCount(dispatchManifest = {}, key) {
  return Number(dispatchManifest?.statusCounts?.[key] || 0);
}

function buildOfficialInboxStatus({ tokenGate, readyPack }) {
  if (!readyPack) return "needs_ready_60s_dispatch_pack";
  if (tokenGate.ok) return "ready_for_operator_review_not_executed";
  if (tokenGate.needs_refresh_or_sync || tokenGate.action === "refresh_or_sync_local_token") {
    return "needs_local_token_refresh_or_sync";
  }
  if (tokenGate.needs_reauth) return "operator_reauth_required";
  return "token_state_unclear";
}

function mergeBlockedStatus({ tokenGate, creativeBlocked }) {
  if (!creativeBlocked) return null;
  return tokenGate.ok ? "blocked_by_creative_review" : "blocked_by_local_token_and_creative_review";
}

function localTokenStatus(tokenGate = {}) {
  if (tokenGate.ok) return "usable";
  if (tokenGate.needs_refresh_or_sync || tokenGate.action === "refresh_or_sync_local_token") {
    return "expired_but_refreshable";
  }
  if (tokenGate.needs_reauth) return "operator_reauth_required";
  return tokenGate.reason || "not_ready";
}

function normaliseBrowserOAuthGate(authDoctorReport = {}, tokenGate = {}) {
  const raw = authDoctorReport.browser_oauth || authDoctorReport.browserOAuth || null;
  const operatorActionEvidence = Array.isArray(authDoctorReport.operator_actions)
    ? authDoctorReport.operator_actions.find((action) =>
        /browser OAuth (?:succeeded|was reported as successful)|operator\/browser OAuth was reported as successful/i.test(
          String(action),
        ),
      )
    : null;
  const rawStatus =
    typeof raw === "string"
      ? raw
      : raw === true
        ? "succeeded"
        : raw && typeof raw === "object"
          ? raw.status || raw.verdict || null
          : null;
  const status = rawStatus
    ? String(rawStatus)
    : operatorActionEvidence
      ? "reported_success"
      : "not_verified_by_this_report";
  const completedAt =
    raw && typeof raw === "object"
      ? raw.completed_at || raw.completedAt || raw.checked_at || null
      : null;
  const evidence =
    raw && typeof raw === "object"
      ? raw.evidence || raw.source || raw.note || null
      : operatorActionEvidence
        ? "auth_doctor_operator_action"
        : null;
  return {
    status,
    completed_at: completedAt,
    evidence,
    local_token_proven: tokenGate.ok === true,
    local_token_status: localTokenStatus(tokenGate),
    note:
      tokenGate.ok === true
        ? "Browser/OAuth evidence and the local token gate are both usable for no-post readiness."
        : "Browser OAuth evidence is not treated as local upload readiness; the local token gate is reported separately.",
  };
}

function buildNoPostReadiness({
  authDoctorReport = {},
  tokenGate,
  officialInboxStatus,
  creativeBlockedStatus,
  directPublicPostPermitted,
  readyPack,
  topPack,
}) {
  const officialInboxRouteStatus = creativeBlockedStatus || officialInboxStatus;
  const dispatchCreativeStatus = (() => {
    const creativeBlockers = topPack?.creativeBlockers || [];
    if (!topPack) return "no_dispatch_pack";
    if (readyPack) return "ready_for_operator_visual_review";
    if (
      topPack.status === "creative_review_required" ||
      creativeBlockers.length > 0 ||
      topPack.creativeReviewRequired === true
    ) {
      return "blocked_by_creative_review";
    }
    if (readyPack) return "ready_for_operator_visual_review";
    return topPack.status || "not_ready";
  })();

  return {
    browserOAuth: normaliseBrowserOAuthGate(authDoctorReport, tokenGate),
    localToken: {
      source: tokenGate.source || "unknown",
      status: localTokenStatus(tokenGate),
      ok: tokenGate.ok === true,
      reason: tokenGate.reason || null,
      expires_in_seconds: tokenGate.expires_in_seconds ?? null,
      refresh_available: tokenGate.refresh_available === true,
      needs_reauth: tokenGate.needs_reauth === true,
      next_action:
        tokenGate.ok === true
          ? "none"
          : tokenGate.action || tokenGate.reason || "inspect_token_state",
    },
    officialInbox: {
      status: officialInboxRouteStatus,
      public_auto_publish: false,
      ready_pack_present: Boolean(readyPack),
      blocked_by_local_token: tokenGate.ok !== true,
      blocked_by_creative_review: /^blocked_by_.*creative|creative_review/.test(officialInboxRouteStatus),
    },
    directPost: {
      status: directPublicPostPermitted
        ? "approval_declared_but_not_exercised_by_no_post_report"
        : "blocked_by_app_review_or_direct_post_approval",
      public_auto_publish: true,
      blocker: directPublicPostPermitted
        ? "requires_safe_live_api_verification_before_use"
        : "direct_post_approval_not_declared",
    },
    dispatchCreative: {
      status: dispatchCreativeStatus,
      storyId: readyPack?.storyId || topPack?.storyId || null,
      pack_status: readyPack?.status || topPack?.status || null,
      durationSeconds:
        readyPack?.eligibility?.durationSeconds ??
        topPack?.eligibility?.durationSeconds ??
        null,
      blockers: readyPack ? [] : topPack?.creativeBlockers || [],
      operator_visual_review_required:
        (readyPack?.creativeReviewRequired ?? topPack?.creativeReviewRequired) !== false &&
        Boolean(topPack || readyPack),
    },
    safety: {
      no_post_report: true,
      upload_executed: false,
      public_post_created: false,
      browser_automation_used: false,
      oauth_triggered: false,
      token_mutated: false,
    },
  };
}

function buildTikTokAutomationReport({
  generatedAt = new Date().toISOString(),
  authDoctorReport = {},
  dispatchManifest = {},
  freshDispatchPack = null,
} = {}) {
  const tokenGate = tokenGateFromReports(authDoctorReport, dispatchManifest);
  const readyPack = findReadyPack(dispatchManifest, freshDispatchPack);
  const topPack = firstPack(dispatchManifest, freshDispatchPack);
  const displayTopPack = readyPack || topPack;
  const usingFreshPack = topPack?.source === "fresh_local_dispatch_pack";
  const displaySource = readyPack
    ? readyPack.source || "dispatch_manifest"
    : usingFreshPack
      ? "fresh_local_dispatch_pack"
      : "dispatch_manifest";
  const freshPackBlocked = usingFreshPack && !readyPack;
  const directPublicPostPermitted =
    authDoctorReport?.posting_capability?.public_auto_posting_permitted_by_env === true;
  const officialInboxStatus = buildOfficialInboxStatus({ tokenGate, readyPack });
  const creativeBlockedStatus = mergeBlockedStatus({ tokenGate, creativeBlocked: freshPackBlocked });
  const noReadyReason = readyPack
    ? null
    : topPack?.status || (dispatchManifest?.count ? "no_pack_passed_tiktok_gate" : "no_dispatch_packs");
  const noPostReadiness = buildNoPostReadiness({
    authDoctorReport,
    tokenGate,
    officialInboxStatus,
    creativeBlockedStatus,
    directPublicPostPermitted,
    readyPack,
    topPack,
  });

  const routeStrategy = [
    {
      id: "official_inbox_upload",
      label: "Official TikTok inbox upload",
      status: creativeBlockedStatus || officialInboxStatus,
      public_auto_publish: false,
      account_risk: "low",
      recommendation:
        "Use this first after a pack is ready and a local token is usable. It uploads to TikTok inbox/drafts only; the operator completes the public post in TikTok.",
    },
    {
      id: "official_public_api",
      label: "Official TikTok public API posting",
      status: directPublicPostPermitted
        ? "app_approval_declared_but_needs_safe_verification"
        : "blocked_until_tiktok_app_review_or_direct_post_approval",
      public_auto_publish: true,
      account_risk: "low_after_approval",
      recommendation:
        "Do not rely on this until TikTok app review/direct post approval is confirmed by a real API response.",
    },
    {
      id: "manual_phone_workflow",
      label: "Manual phone workflow using dispatch pack",
      status: readyPack ? "available" : freshPackBlocked ? "blocked_by_creative_review" : "needs_ready_pack",
      public_auto_publish: false,
      account_risk: "very_low",
      recommendation:
        "Safest fallback today. Use when a human can complete the last TikTok app step.",
    },
    {
      id: "third_party_scheduler",
      label: "Audited third-party scheduler",
      status: "vendor_proof_required",
      public_auto_publish: true,
      account_risk: "medium",
      recommendation:
        "Only use after a vendor proves true TikTok auto-publish without account-risky browser automation.",
    },
    {
      id: "browser_automation",
      label: "Browser automation",
      status: "test_account_only",
      public_auto_publish: true,
      account_risk: "high",
      recommendation:
        "Never use on the live Pulse TikTok account without a separate explicit approval and test-account burn-in.",
    },
    {
      id: "va_last_resort",
      label: "Human VA posting",
      status: "last_resort",
      public_auto_publish: true,
      account_risk: "operational_trust_risk",
      recommendation:
        "Only consider after standardised dispatch packs, audit logs and access controls exist.",
    },
  ];

  const recommendedRoute = (() => {
    if (freshPackBlocked && !tokenGate.ok) {
      return "refresh_or_sync_local_token_then_fix_fresh_dispatch_creative_blockers";
    }
    if (freshPackBlocked) return "fix_fresh_dispatch_creative_blockers";
    if (!readyPack) return "produce_or_select_fresh_60s_dispatch_pack";
    if (!tokenGate.ok) return "fix_local_token_state_then_official_inbox_upload";
    return "official_inbox_upload_prepare_only";
  })();

  const approvalQueue = [];
  if (readyPack && tokenGate.ok) {
    approvalQueue.push({
      decision: `Approve one TikTok official inbox upload test for ${readyPack.storyId}.`,
      why: "The dispatch pack is locally ready and the token gate reports usable, but sending to TikTok inbox still mutates the live TikTok account.",
      risk: "The upload may create a draft/inbox item or hit an app/account-level API rejection.",
      rollback: "Delete the TikTok inbox/draft item manually if it appears; no public post should be created by this route.",
      recommendation: "Approve a single explicit inbox-upload test before any repeat use.",
    });
  } else if (tokenGate.needs_refresh_or_sync || tokenGate.needs_reauth) {
    approvalQueue.push({
      decision: "Refresh, sync or re-run TikTok OAuth for the local token store.",
      why: "Official inbox upload cannot be tested locally until the token gate is clear.",
      risk: "OAuth/token actions affect platform account credentials.",
      rollback: "Keep previous token file backup and do not run upload until the auth doctor is green.",
      recommendation: "Only do this with Martin present because TikTok OAuth is an operator-owned account action.",
    });
  }
  approvalQueue.push({
    decision: "Do not approve live-account TikTok browser automation yet.",
    why: "Browser automation is account-risky and not needed before the official inbox route is exhausted.",
    risk: "Automated TikTok Studio access could trigger anti-abuse systems.",
    rollback: "Use official inbox upload or manual phone workflow instead.",
    recommendation: "If explored later, use a TikTok test account only.",
  });

  const blockers = [];
  if (!readyPack) {
    if (freshPackBlocked) {
      blockers.push(...(topPack.creativeBlockers || []), topPack.status || "fresh_pack_blocked");
    } else {
      const statusKeys = Object.keys(dispatchManifest?.statusCounts || {}).filter(
        (status) => status !== "ready_for_operator_review",
      );
      blockers.push(...(statusKeys.length ? statusKeys : [noReadyReason || "no_ready_pack"]));
    }
  }
  if (!tokenGate.ok) blockers.push(tokenGate.action || tokenGate.reason || "token_not_ready");
  if (!usingFreshPack && statusCount(dispatchManifest, "tiktok_length_review_required") > 0) {
    blockers.push("one_or_more_packs_under_60s");
  }
  if (!usingFreshPack && statusCount(dispatchManifest, "duration_review_required") > 0) {
    blockers.push("one_or_more_packs_missing_duration_probe");
  }

  return {
    schemaVersion: 1,
    generatedAt,
    mode: "read-only-tiktok-automation-strategy",
    verdict: blockers.length ? "AMBER" : "GREEN",
    recommendedRoute,
    tokenGate,
    dispatchGate: {
      source: displaySource,
      packCount: Number(dispatchManifest?.count || 0),
      statusCounts: dispatchManifest?.statusCounts || {},
      topPack: displayTopPack
        ? {
            storyId: displayTopPack.storyId || null,
            status: displayTopPack.status || null,
            durationSeconds: displayTopPack.eligibility?.durationSeconds ?? null,
            captionReady: displayTopPack.eligibility?.captionReady ?? null,
            dispatchLengthReady: displayTopPack.eligibility?.dispatchLengthReady ?? null,
            mp4: displayTopPack.mp4 || null,
            cover: displayTopPack.cover || null,
            source: displayTopPack.source || displaySource,
            dryRunOnly: displayTopPack.dryRunOnly ?? null,
            creativeReviewRequired: displayTopPack.creativeReviewRequired ?? null,
            creativeBlockers: displayTopPack.creativeBlockers || [],
          }
        : null,
      topReadyPack: readyPack
        ? {
            storyId: readyPack.storyId || null,
            status: readyPack.status || null,
            durationSeconds: readyPack.eligibility?.durationSeconds ?? null,
            mp4: readyPack.mp4 || null,
            cover: readyPack.cover || null,
            source: readyPack.source || displaySource,
            dryRunOnly: readyPack.dryRunOnly ?? null,
            creativeReviewRequired: readyPack.creativeReviewRequired ?? null,
            creativeBlockers: readyPack.creativeBlockers || [],
          }
        : null,
      legacyManifestWarnings:
        usingFreshPack && !readyPack && Object.keys(dispatchManifest?.statusCounts || {}).length
          ? dispatchManifest.statusCounts
          : {},
    },
    postingCapability: authDoctorReport?.posting_capability || null,
    noPostReadiness,
    diagnostics: {
      authDoctorVerdict: authDoctorReport?.verdict || null,
      warnings: Array.isArray(authDoctorReport?.warnings) ? authDoctorReport.warnings : [],
      operatorActions: Array.isArray(authDoctorReport?.operator_actions)
        ? authDoctorReport.operator_actions
        : [],
    },
    routeStrategy,
    blockers: unique(blockers),
    approvalQueue,
    preparedCommands: {
      safeDiagnostics: [
        "npm run tiktok:auth-doctor",
        "npm run tiktok:dispatch",
        "npm run tiktok:overnight-report",
      ],
      safeDryRun: readyPack
        ? [`npm run tiktok:inbox-upload -- --story ${readyPack.storyId}`]
        : [],
      requiresApprovalBeforeExecution: readyPack
        ? [`npm run tiktok:inbox-upload -- --story ${readyPack.storyId} --send-inbox`]
        : [],
    },
    forbiddenActionsAvoided: [
      "no TikTok upload",
      "no OAuth flow triggered",
      "no token mutation",
      "no browser-cookie automation",
      "no production posting",
    ],
  };
}

function renderTikTokAutomationMarkdown(report) {
  const lines = [];
  lines.push("# TikTok Overnight Automation Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Recommended route: ${report.recommendedRoute}`);
  lines.push("");
  lines.push("## Token Gate");
  lines.push(`- source: ${report.tokenGate.source || "unknown"}`);
  lines.push(`- token status mode: ${report.tokenGate.token_status_mode || "unknown"}`);
  lines.push(`- ok: ${report.tokenGate.ok}`);
  lines.push(`- reason: ${report.tokenGate.reason || "unknown"}`);
  lines.push(`- action: ${report.tokenGate.action || "none"}`);
  lines.push(`- refresh available: ${report.tokenGate.refresh_available}`);
  lines.push(`- needs re-auth: ${report.tokenGate.needs_reauth}`);
  if (report.tokenGate.source === "dispatch_manifest_snapshot") {
    lines.push("- note: token state came from the existing dispatch manifest snapshot; the auth doctor did not inspect token files in this run");
  }
  lines.push("");
  if (report.noPostReadiness) {
    const gates = report.noPostReadiness;
    lines.push("## No-Post Readiness Gates");
    lines.push(
      `- Browser OAuth: ${gates.browserOAuth.status}; local token proven=${gates.browserOAuth.local_token_proven}; local token status=${gates.browserOAuth.local_token_status}`,
    );
    if (gates.browserOAuth.completed_at) {
      lines.push(`- Browser OAuth completed at: ${gates.browserOAuth.completed_at}`);
    }
    if (gates.browserOAuth.evidence) {
      lines.push(`- Browser OAuth evidence: ${gates.browserOAuth.evidence}`);
    }
    lines.push(
      `- Local token: ${gates.localToken.status}; action=${gates.localToken.next_action}; refresh_available=${gates.localToken.refresh_available}; needs_reauth=${gates.localToken.needs_reauth}`,
    );
    lines.push(
      `- Official inbox: ${gates.officialInbox.status}; ready_pack_present=${gates.officialInbox.ready_pack_present}; public_auto_publish=false`,
    );
    lines.push(
      `- Direct post: ${gates.directPost.status}; blocker=${gates.directPost.blocker}`,
    );
    lines.push(
      `- Dispatch creative: ${gates.dispatchCreative.status}; story=${gates.dispatchCreative.storyId || "none"}; blockers=${gates.dispatchCreative.blockers.join(", ") || "none"}`,
    );
    lines.push("");
  }
  lines.push("## Dispatch Gate");
  lines.push(`- source: ${report.dispatchGate.source}`);
  lines.push(`- packs: ${report.dispatchGate.packCount}`);
  if (Object.keys(report.dispatchGate.statusCounts || {}).length) {
    for (const [status, count] of Object.entries(report.dispatchGate.statusCounts)) {
      lines.push(`- ${status}: ${count}`);
    }
  } else {
    lines.push("- no dispatch packs found");
  }
  if (report.dispatchGate.topPack) {
    lines.push(
      `- top pack: ${report.dispatchGate.topPack.storyId} (${report.dispatchGate.topPack.status}, duration=${report.dispatchGate.topPack.durationSeconds ?? "unknown"})`,
    );
  }
  if (report.dispatchGate.topReadyPack) {
    lines.push(
      `- top ready pack: ${report.dispatchGate.topReadyPack.storyId} (${report.dispatchGate.topReadyPack.durationSeconds ?? "unknown"}s)`,
    );
    if (report.dispatchGate.topReadyPack.source === "fresh_local_dispatch_pack") {
      lines.push("- fresh local dispatch pack: dry-run only; visual/operator review is still required before any inbox upload");
    }
  }
  if (Object.keys(report.dispatchGate.legacyManifestWarnings || {}).length) {
    lines.push("- older dispatch manifest warnings were not treated as blockers because the fresh local pack is newer:");
    for (const [status, count] of Object.entries(report.dispatchGate.legacyManifestWarnings)) {
      lines.push(`  - ${status}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Route Strategy");
  for (const route of report.routeStrategy) {
    lines.push(
      `- ${route.label} (${route.id}): status=${route.status}; public_auto_publish=${route.public_auto_publish}; account_risk=${route.account_risk}`,
    );
    lines.push(`  ${route.recommendation}`);
  }
  lines.push("");
  lines.push("## Diagnostics");
  lines.push(`- auth doctor verdict: ${report.diagnostics.authDoctorVerdict || "unknown"}`);
  if (report.diagnostics.warnings.length) {
    lines.push("- warnings:");
    for (const warning of report.diagnostics.warnings) lines.push(`  - ${warning}`);
  } else {
    lines.push("- warnings: none");
  }
  if (report.diagnostics.operatorActions.length) {
    lines.push("- operator actions:");
    for (const action of report.diagnostics.operatorActions) lines.push(`  - ${action}`);
  }
  lines.push("");
  lines.push("## Blockers");
  if (report.blockers.length) {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- none for report-only readiness");
  }
  lines.push("");
  lines.push("## Prepared Commands");
  lines.push("Safe diagnostics:");
  for (const command of report.preparedCommands.safeDiagnostics) lines.push(`- ${command}`);
  if (report.preparedCommands.safeDryRun.length) {
    lines.push("Safe dry-run:");
    for (const command of report.preparedCommands.safeDryRun) lines.push(`- ${command}`);
  }
  if (report.preparedCommands.requiresApprovalBeforeExecution.length) {
    lines.push("Requires approval before execution:");
    for (const command of report.preparedCommands.requiresApprovalBeforeExecution) {
      lines.push(`- ${command}`);
    }
  }
  lines.push("");
  lines.push("## Morning Approval Queue Entries");
  for (const item of report.approvalQueue) {
    lines.push(`- ${item.decision}`);
    lines.push(`  Why: ${item.why}`);
    lines.push(`  Risk: ${item.risk}`);
    lines.push(`  Rollback: ${item.rollback}`);
    lines.push(`  Recommendation: ${item.recommendation}`);
  }
  lines.push("");
  lines.push("## Safety");
  for (const action of report.forbiddenActionsAvoided) lines.push(`- ${action}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildTikTokAutomationReport,
  renderTikTokAutomationMarkdown,
  tokenGateFromReports,
};
