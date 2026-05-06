"use strict";

function tokenGateFromReports(authDoctorReport = {}, dispatchManifest = {}) {
  const authToken = authDoctorReport?.token_status || null;
  const dispatchToken = dispatchManifest?.tiktokTokenGate || null;
  if (authToken) {
    return {
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
    ok: false,
    reason: "not_checked",
    expires_in_seconds: null,
    refresh_available: false,
    needs_reauth: false,
    needs_refresh_or_sync: false,
    action: "run_tiktok_auth_doctor",
  };
}

function findReadyPack(dispatchManifest = {}) {
  if (dispatchManifest?.topReadyPack) return dispatchManifest.topReadyPack;
  const packs = Array.isArray(dispatchManifest?.packs) ? dispatchManifest.packs : [];
  return packs.find((pack) => pack.status === "ready_for_operator_review") || null;
}

function firstPack(dispatchManifest = {}) {
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

function buildTikTokAutomationReport({
  generatedAt = new Date().toISOString(),
  authDoctorReport = {},
  dispatchManifest = {},
} = {}) {
  const tokenGate = tokenGateFromReports(authDoctorReport, dispatchManifest);
  const readyPack = findReadyPack(dispatchManifest);
  const topPack = firstPack(dispatchManifest);
  const directPublicPostPermitted =
    authDoctorReport?.posting_capability?.public_auto_posting_permitted_by_env === true;
  const officialInboxStatus = buildOfficialInboxStatus({ tokenGate, readyPack });
  const noReadyReason = readyPack
    ? null
    : topPack?.status || (dispatchManifest?.count ? "no_pack_passed_tiktok_gate" : "no_dispatch_packs");

  const routeStrategy = [
    {
      id: "official_inbox_upload",
      label: "Official TikTok inbox upload",
      status: officialInboxStatus,
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
      status: readyPack ? "available" : "needs_ready_pack",
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
    const statusKeys = Object.keys(dispatchManifest?.statusCounts || {}).filter(
      (status) => status !== "ready_for_operator_review",
    );
    blockers.push(...(statusKeys.length ? statusKeys : [noReadyReason || "no_ready_pack"]));
  }
  if (!tokenGate.ok) blockers.push(tokenGate.action || tokenGate.reason || "token_not_ready");
  if (statusCount(dispatchManifest, "tiktok_length_review_required") > 0) {
    blockers.push("one_or_more_packs_under_60s");
  }
  if (statusCount(dispatchManifest, "duration_review_required") > 0) {
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
      packCount: Number(dispatchManifest?.count || 0),
      statusCounts: dispatchManifest?.statusCounts || {},
      topPack: topPack
        ? {
            storyId: topPack.storyId || null,
            status: topPack.status || null,
            durationSeconds: topPack.eligibility?.durationSeconds ?? null,
            captionReady: topPack.eligibility?.captionReady ?? null,
            dispatchLengthReady: topPack.eligibility?.dispatchLengthReady ?? null,
            mp4: topPack.mp4 || null,
            cover: topPack.cover || null,
          }
        : null,
      topReadyPack: readyPack
        ? {
            storyId: readyPack.storyId || null,
            status: readyPack.status || null,
            durationSeconds: readyPack.eligibility?.durationSeconds ?? null,
            mp4: readyPack.mp4 || null,
            cover: readyPack.cover || null,
          }
        : null,
    },
    postingCapability: authDoctorReport?.posting_capability || null,
    routeStrategy,
    blockers,
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
  lines.push(`- ok: ${report.tokenGate.ok}`);
  lines.push(`- reason: ${report.tokenGate.reason || "unknown"}`);
  lines.push(`- action: ${report.tokenGate.action || "none"}`);
  lines.push(`- refresh available: ${report.tokenGate.refresh_available}`);
  lines.push(`- needs re-auth: ${report.tokenGate.needs_reauth}`);
  lines.push("");
  lines.push("## Dispatch Gate");
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
