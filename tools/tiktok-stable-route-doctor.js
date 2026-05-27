"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

const {
  buildTikTokAuthDoctorReport,
} = require("../lib/platforms/tiktok-auth-doctor");
const {
  buildTikTokAutomationReport,
} = require("../lib/platforms/tiktok-automation-report");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const SECRET_PATTERNS = [
  /\b(client_secret|api_key|token)\b\s*[:=]\s*["']?[^"',\s}]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /([?&](?:client_secret|api_key|token)=)[^&\s]+/gi,
];

function redact(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "$1[REDACTED]");
  return text;
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function explicitlyFalse(value) {
  return /^(0|false|no|off)$/i.test(String(value || "").trim());
}

function operatorDisabled(env = {}) {
  return explicitlyFalse(env.TIKTOK_ENABLED) || explicitlyFalse(env.TIKTOK_AUTO_UPLOAD_ENABLED);
}

function normaliseTokenStatus(tokenStatus = {}) {
  const ok = tokenStatus.ok === true;
  const refreshAvailable = tokenStatus.refresh_available === true;
  const needsReauth = tokenStatus.needs_reauth === true;
  const needsRefreshOrSync =
    !ok &&
    !needsReauth &&
    (refreshAvailable === true || tokenStatus.needs_refresh_or_sync === true);
  return {
    ok,
    reason: tokenStatus.reason || null,
    expires_in_seconds: Number.isFinite(Number(tokenStatus.expires_in_seconds))
      ? Number(tokenStatus.expires_in_seconds)
      : null,
    refresh_available: refreshAvailable,
    needs_reauth: needsReauth,
    needs_refresh_or_sync: needsRefreshOrSync,
  };
}

function tokenAction(token) {
  if (token.ok) return "none";
  if (token.needs_reauth) return "operator_reauth_required";
  if (token.needs_refresh_or_sync) return "refresh_or_sync_local_token";
  return "inspect_local_token_state";
}

function directPostApproved({ env = {}, authDoctorReport = {} } = {}) {
  return (
    truthy(env.TIKTOK_DIRECT_POST_APPROVED) ||
    truthy(env.TIKTOK_CONTENT_POSTING_APPROVED) ||
    authDoctorReport?.posting_capability?.public_auto_posting_permitted_by_env === true
  );
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalisePack(rawPack = null) {
  if (!rawPack || typeof rawPack !== "object") return null;
  const status = rawPack.status || null;
  const creativeBlockers = Array.isArray(rawPack.creativeBlockers)
    ? rawPack.creativeBlockers.slice()
    : [];
  const readyForOperatorReview = /^ready_for_operator_review/i.test(String(status || ""));
  const blockedByCreativeStatus =
    !readyForOperatorReview &&
    /creative|visual|forensic|promotion|review_required|blocked/i.test(String(status || ""));
  return {
    story_id: rawPack.storyId || rawPack.story_id || null,
    status,
    duration_seconds: numberOrNull(
      rawPack.durationSeconds ??
        rawPack.duration_seconds ??
        rawPack.eligibility?.durationSeconds,
    ),
    mp4: rawPack.mp4 || rawPack.mp4_path || null,
    cover: rawPack.cover || rawPack.cover_path || null,
    creative_blockers: creativeBlockers,
    creative_review_required:
      creativeBlockers.length > 0 ||
      blockedByCreativeStatus ||
      (!readyForOperatorReview && rawPack.creativeReviewRequired === true),
    operator_visual_review_required:
      rawPack.creativeReviewRequired === true || readyForOperatorReview,
  };
}

function selectDispatchPack(automationReport = {}) {
  const ready =
    normalisePack(automationReport.dispatchGate?.topReadyPack) ||
    normalisePack(automationReport.noPostReadiness?.dispatchCreative?.status === "ready_for_operator_visual_review"
      ? {
          storyId: automationReport.noPostReadiness.dispatchCreative.storyId,
          status: "ready_for_operator_review",
        }
      : null);
  const top = normalisePack(automationReport.dispatchGate?.topPack);
  return {
    readyPack: ready,
    topPack: ready || top,
  };
}

function manualDispatchStatus({ readyPack, topPack }) {
  if (readyPack?.story_id) return "ready_available";
  if (!topPack?.story_id) return "needs_ready_dispatch_pack";
  if (topPack.creative_review_required) return "blocked_by_dispatch_pack_review";
  return topPack.status || "needs_dispatch_pack_review";
}

function officialTokenBlockedStatus(action) {
  if (action === "operator_reauth_required") return "blocked_by_operator_reauth_required";
  if (action === "refresh_or_sync_local_token") return "blocked_by_local_token_refresh_or_sync";
  if (action === "inspect_local_token_state") return "blocked_by_unclear_local_token_state";
  return null;
}

function officialInboxStatus({ action, disabled, readyPack, topPack }) {
  const tokenBlocked = officialTokenBlockedStatus(action);
  if (tokenBlocked) return tokenBlocked;
  if (!readyPack?.story_id) {
    if (topPack?.creative_review_required) return "blocked_by_dispatch_pack_review";
    return "needs_ready_dispatch_pack";
  }
  if (disabled) return "ready_but_operator_disabled_until_explicit_approval";
  return "ready_pending_explicit_operator_approval";
}

function officialApiStatus({ action, disabled, directApproved }) {
  const tokenBlocked = officialTokenBlockedStatus(action);
  if (tokenBlocked) return tokenBlocked;
  if (disabled) return "blocked_by_operator_disable";
  if (!directApproved) return "blocked_until_direct_post_approval";
  return "candidate_requires_controlled_live_proof";
}

function selectedRoute({ action, officialApi, officialInbox, manual }) {
  if (officialApi.status === "candidate_requires_controlled_live_proof") return "official_api";
  if (
    officialInbox.status === "ready_pending_explicit_operator_approval" ||
    officialInbox.status === "ready_but_operator_disabled_until_explicit_approval"
  ) {
    return "official_inbox_upload";
  }
  if (manual.status === "ready_available") return "manual_dispatch";
  if (action === "operator_reauth_required") return "needs_reauth";
  if (action === "refresh_or_sync_local_token") return "needs_token_sync";
  return "needs_ready_dispatch_pack";
}

function verdictForSelection(route, action, manualStatus) {
  if (route === "needs_reauth") return "RED";
  if (route === "needs_token_sync") return "AMBER";
  if (action !== "none" || manualStatus !== "ready_available") return "AMBER";
  return "GREEN";
}

function recommendedNextAction({ route, action, readyPack }) {
  const story = readyPack?.story_id || "STORY_ID";
  if (route === "official_api") {
    return "Official API is only a controlled candidate. Do not post from this doctor; if Martin approves a controlled official API proof, use the existing publish path after confirming TikTok direct-post approval is real.";
  }
  if (route === "official_inbox_upload") {
    return `Run npm run tiktok:inbox-upload -- --story ${story} for the dry-run plan. Only add --send-inbox --operator-confirmed after Martin explicitly approves one inbox upload.`;
  }
  if (route === "manual_dispatch") {
    if (action === "refresh_or_sync_local_token") {
      return `Use the manual dispatch pack for ${story} if TikTok must move now. Official API and inbox routes need local token sync first: run npm run tiktok:token -- --dry-run, then refresh or sync only with Martin present.`;
    }
    if (action === "operator_reauth_required") {
      return `Use manual dispatch only if a current pack is ready. Official API and inbox routes need operator re-auth: run npm run tiktok:auth-doctor first.`;
    }
    return `Use the manual dispatch pack for ${story}, then rerun npm run tiktok:stable-route-doctor after any route changes.`;
  }
  if (route === "needs_reauth") {
    return "Run npm run tiktok:auth-doctor, then have Martin complete the protected TikTok OAuth flow. Rerun this doctor after the local token file is synced.";
  }
  if (route === "needs_token_sync") {
    return "Run npm run tiktok:token -- --dry-run. If it confirms refreshable expiry, refresh or sync the local token only with Martin present, then rerun this doctor.";
  }
  return "Produce or select a current 60s TikTok dispatch pack, then rerun npm run tiktok:stable-route-doctor.";
}

function buildTikTokStableRouteDoctor({
  generatedAt = new Date().toISOString(),
  env = process.env,
  tokenStatus = {},
  authDoctorReport = {},
  automationReport = {},
} = {}) {
  const token = normaliseTokenStatus(tokenStatus);
  const action = tokenAction(token);
  const disabled = operatorDisabled(env);
  const approved = directPostApproved({ env, authDoctorReport });
  const { readyPack, topPack } = selectDispatchPack(automationReport);
  const manualStatus = manualDispatchStatus({ readyPack, topPack });
  const officialApi = {
    status: officialApiStatus({ action, disabled, directApproved: approved }),
    public_auto_publish: true,
    requires_explicit_live_approval: true,
    note:
      approved
        ? "Direct posting approval is declared locally, but this doctor does not prove it with a live post."
        : "Direct public posting is not declared approved; keep this route blocked.",
  };
  const officialInbox = {
    status: officialInboxStatus({ action, disabled, readyPack, topPack }),
    public_auto_publish: false,
    requires_manual_completion: true,
    note:
      "Official inbox upload can only create an inbox/draft item; the operator completes or discards it in TikTok.",
  };
  const manual = {
    status: manualStatus,
    public_auto_publish: false,
    requires_manual_completion: true,
    note:
      "Manual dispatch uses the prepared pack and phone workflow. It does not depend on TikTok API token health.",
  };
  const route = selectedRoute({
    action,
    officialApi,
    officialInbox,
    manual,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "read_only_tiktok_stable_route_doctor",
    verdict: verdictForSelection(route, action, manual.status),
    selected_route: route,
    token_action: action,
    token: {
      ok: token.ok,
      reason: token.reason,
      expires_in_seconds: token.expires_in_seconds,
      refresh_available: token.refresh_available,
      needs_reauth: token.needs_reauth,
      needs_refresh_or_sync: token.needs_refresh_or_sync,
    },
    routes: {
      official_api: officialApi,
      official_inbox: officialInbox,
      manual_dispatch: manual,
    },
    dispatch_pack: readyPack || topPack,
    recommended_next_action: recommendedNextAction({
      route,
      action,
      readyPack: readyPack || topPack,
    }),
    safety: {
      read_only: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_uploads: true,
      no_public_posts: true,
      no_browser_automation: true,
      no_database_mutation: true,
    },
  };
}

function renderTikTokStableRouteDoctorMarkdown(report = {}) {
  const pack = report.dispatch_pack || {};
  const lines = [
    "# TikTok Stable Route Doctor",
    "",
    "Read-only diagnostic. It checks route readiness without OAuth, token mutation, uploads, public posts, browser automation or DB writes.",
    "",
    `Generated: ${redact(report.generated_at || "unknown")}`,
    `Verdict: ${redact(report.verdict || "unknown")}`,
    `Selected route: ${redact(report.selected_route || "unknown")}`,
    `Token action: ${redact(report.token_action || "unknown")}`,
    "",
    "## Token",
    `- ok: ${report.token?.ok === true}`,
    `- reason: ${redact(report.token?.reason || "unknown")}`,
    `- expires in seconds: ${report.token?.expires_in_seconds ?? "unknown"}`,
    `- refresh available: ${report.token?.refresh_available === true}`,
    `- needs re-auth: ${report.token?.needs_reauth === true}`,
    "",
    "## Routes",
    `- Official API: ${redact(report.routes?.official_api?.status || "unknown")}; public_auto_publish=${report.routes?.official_api?.public_auto_publish === true}`,
    `- Official inbox: ${redact(report.routes?.official_inbox?.status || "unknown")}; public_auto_publish=false; manual_completion=true`,
    `- Manual dispatch: ${redact(report.routes?.manual_dispatch?.status || "unknown")}; public_auto_publish=false; manual_completion=true`,
    "",
    "## Dispatch Pack",
  ];
  if (pack.story_id) {
    lines.push(`- story: ${redact(pack.story_id)}`);
    lines.push(`- status: ${redact(pack.status || "unknown")}`);
    lines.push(`- duration: ${pack.duration_seconds ?? "unknown"}s`);
    lines.push(`- mp4: ${redact(pack.mp4 || "unknown")}`);
    lines.push(`- cover: ${redact(pack.cover || "unknown")}`);
    if (pack.creative_blockers?.length) {
      lines.push(`- creative blockers: ${pack.creative_blockers.map(redact).join(", ")}`);
    }
    lines.push(`- operator visual review required: ${pack.operator_visual_review_required === true}`);
  } else {
    lines.push("- none");
  }
  lines.push(
    "",
    "## Recommended Next Action",
    `- ${redact(report.recommended_next_action || "unknown")}`,
    "",
    "## Safety",
    "- no OAuth triggered",
    "- no token files changed",
    "- no upload attempted",
    "- no public post created",
    "- no browser automation",
    "- no database rows changed",
  );
  return `${lines.join("\n")}\n`;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function inspectLocalTokenReadOnly() {
  try {
    const { inspectTokenStatus } = require("../upload_tiktok");
    return inspectTokenStatus();
  } catch (err) {
    return {
      ok: false,
      reason: `token_status_failed:${err.message}`,
      refresh_available: false,
      needs_reauth: true,
    };
  }
}

async function main() {
  await fs.ensureDir(OUT);
  const tokenStatus = await inspectLocalTokenReadOnly();
  const authDoctorReport = buildTikTokAuthDoctorReport({
    env: process.env,
    tokenStatus,
    tokenStatusMode: "inspected",
  });
  const dispatchManifest = await readJsonIfExists(path.join(OUT, "tiktok_dispatch_manifest.json"));
  const freshDispatchPack = await readJsonIfExists(
    path.join(OUT, "tiktok-fresh-dispatch", "tiktok_fresh_dispatch_pack.json"),
  );
  const automationReport = buildTikTokAutomationReport({
    authDoctorReport,
    dispatchManifest,
    freshDispatchPack,
  });
  const report = buildTikTokStableRouteDoctor({
    env: process.env,
    tokenStatus,
    authDoctorReport,
    automationReport,
  });
  const jsonPath = path.join(OUT, "tiktok_stable_route_doctor.json");
  const mdPath = path.join(OUT, "tiktok_stable_route_doctor.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTikTokStableRouteDoctorMarkdown(report), "utf8");
  console.log(`[tiktok-stable-route] verdict=${report.verdict}`);
  console.log(`[tiktok-stable-route] selected_route=${report.selected_route}`);
  console.log(`[tiktok-stable-route] token_action=${report.token_action}`);
  console.log(`[tiktok-stable-route] next=${report.recommended_next_action}`);
  console.log(`[tiktok-stable-route] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-stable-route] md=${path.relative(ROOT, mdPath)}`);
  if (report.verdict === "RED") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tiktok-stable-route] ERROR: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildTikTokStableRouteDoctor,
  renderTikTokStableRouteDoctorMarkdown,
  normaliseTokenStatus,
};
