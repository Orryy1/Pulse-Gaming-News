"use strict";

const crypto = require("node:crypto");

const REQUIRED_SCOPES = ["user.info.basic", "video.publish", "video.upload"];
const CLIENT_TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function fingerprint(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function credentialStatus(value) {
  const raw = String(value || "");
  return {
    present: raw.length > 0,
    length: raw.length,
    sha12: raw ? fingerprint(raw) : null,
  };
}

function safeRedirectUri(env, publicUrl) {
  return (
    String(env.TIKTOK_REDIRECT_URI || "").trim() ||
    `${String(publicUrl || "https://pulse.orryy.com").replace(/\/+$/, "")}/auth/tiktok/callback`
  );
}

function buildOAuthShape(env, publicUrl) {
  const clientKey = String(env.TIKTOK_CLIENT_KEY || "").trim();
  const redirectUri = safeRedirectUri(env, publicUrl);
  const scope = REQUIRED_SCOPES.join(",");
  const params = new URLSearchParams({
    client_key: clientKey,
    scope,
    response_type: "code",
    redirect_uri: redirectUri,
  });
  const url = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  const missing = REQUIRED_SCOPES.filter((scopeName) => !scope.split(",").includes(scopeName));
  return {
    generated_url_shape: clientKey && redirectUri ? "valid" : "invalid",
    generated_url_redacted: url.replace(clientKey, clientKey ? "<client_key_redacted>" : ""),
    redirect_uri: redirectUri,
    redirect_https: /^https:\/\//i.test(redirectUri),
    scope,
    scope_separator: "comma",
    required_scopes: REQUIRED_SCOPES,
    required_scopes_missing: missing,
    response_type: "code",
    host: "www.tiktok.com",
  };
}

function buildTikTokAuthDoctorReport({
  env = process.env,
  publicUrl = "https://pulse.orryy.com",
  now = new Date().toISOString(),
  clientCredentialsProbe = null,
  tokenStatus = null,
  tokenStatusMode = tokenStatus ? "inspected" : "not_inspected",
} = {}) {
  const oauth = buildOAuthShape(env, publicUrl);
  const credentials = {
    client_key: credentialStatus(env.TIKTOK_CLIENT_KEY),
    client_secret: credentialStatus(env.TIKTOK_CLIENT_SECRET),
  };
  const directPostApproved =
    truthy(env.TIKTOK_DIRECT_POST_APPROVED) || truthy(env.TIKTOK_CONTENT_POSTING_APPROVED);

  const blockers = [];
  if (!credentials.client_key.present) blockers.push("client_key_missing");
  if (!credentials.client_secret.present) blockers.push("client_secret_missing");
  if (!oauth.redirect_https) blockers.push("redirect_uri_not_https");
  if (oauth.required_scopes_missing.length) blockers.push("required_scopes_missing");

  const safeTokenStatus = tokenStatus
    ? (() => {
        const connected = tokenStatus.ok === true;
        const refreshAvailable = tokenStatus.refresh_available === true;
        const needsReauth = tokenStatus.needs_reauth === true;
        const needsRefreshOrSync = !connected && refreshAvailable && !needsReauth;
        return {
          connected,
          ok: connected,
          reason: tokenStatus.reason || null,
          expires_in_seconds:
            Number.isFinite(Number(tokenStatus.expires_in_seconds))
              ? Number(tokenStatus.expires_in_seconds)
              : null,
          refresh_available: refreshAvailable,
          needs_reauth: needsReauth,
          needs_refresh_or_sync: needsRefreshOrSync,
          local_action: needsRefreshOrSync
            ? "refresh_or_sync_local_token"
            : needsReauth
              ? "operator_reauth_required"
              : connected
                ? "token_usable"
                : "inspect_token_state",
        };
      })()
    : null;

  const localTokenCanBeRecoveredWithoutDashboard =
    safeTokenStatus?.needs_refresh_or_sync === true;
  const dashboardStateStillNeedsOperatorCheck =
    !safeTokenStatus?.connected &&
    !localTokenCanBeRecoveredWithoutDashboard &&
    clientCredentialsProbe?.verdict !== "client_credentials_accepted";
  const warnings = [];
  if (!safeTokenStatus) warnings.push("local_token_status_not_inspected");
  if (!directPostApproved) warnings.push("direct_public_post_not_approved_or_not_declared");
  if (dashboardStateStillNeedsOperatorCheck) {
    warnings.push("dashboard_client_key_error_requires_operator_dashboard_fix");
  }

  const verdict = blockers.length ? "RED" : "AMBER";
  if (safeTokenStatus?.needs_refresh_or_sync) {
    warnings.push("local_token_expired_but_refreshable");
  }
  const tokenActions = [];
  if (safeTokenStatus?.needs_refresh_or_sync) {
    tokenActions.push(
      "Refresh or sync the local TikTok token before local uploads. Earlier operator/browser OAuth was reported as successful on pulse.orryy.com, but this local proof did not refresh or verify this repo's local token file.",
    );
  }
  const dashboardActions = dashboardStateStillNeedsOperatorCheck
    ? [
        "Verify the same TikTok app/environment owns the dashboard client key, Login Kit product, Content Posting API product, URL properties and redirect URI.",
        `Confirm the TikTok dashboard redirect URI exactly matches ${oauth.redirect_uri}.`,
        "If the app is still Draft/Staging, use Sandbox mode with your TikTok account added as a target user, or submit the Production app for review before expecting Production OAuth to work.",
        "Confirm you are using the Production app client key for a reviewed/live Production OAuth flow, or the Sandbox client key for a Sandbox target-user OAuth flow.",
        "If TikTok still reports client_key after exact dashboard values, the app/dashboard state is being rejected before OAuth; save the app again or raise it with TikTok support.",
      ]
    : [];
  return {
    schemaVersion: 1,
    generatedAt: now,
    mode: "read-only-tiktok-auth-diagnosis",
    verdict,
    credentials,
    oauth,
    posting_capability: {
      official_inbox_upload_supported_by_code: true,
      public_auto_posting_permitted_by_env: directPostApproved,
      public_auto_posting_expected_blocker: directPostApproved
        ? "token_or_app_state_unknown"
        : "app_audit_or_direct_post_approval_not_confirmed",
    },
    token_status_mode: tokenStatusMode,
    token_status: safeTokenStatus,
    client_credentials_probe: clientCredentialsProbe,
    blockers,
    warnings,
    operator_actions: [
      ...tokenActions,
      ...dashboardActions,
      "Use npm run tiktok:auth-link locally to generate the protected one-time auth link; direct /auth/tiktok is intentionally API-token protected.",
      "After OAuth succeeds, keep public auto-posting disabled until TikTok app approval is confirmed; use inbox upload/manual completion as the safe bridge.",
    ],
    forbiddenActionsAvoided: [
      "no OAuth flow triggered",
      "no token value printed or refreshed",
      "no TikTok upload",
      "no browser-cookie automation",
      "no production env change",
    ],
  };
}

async function probeTikTokClientCredentials({
  env = process.env,
  postForm,
  now = new Date().toISOString(),
} = {}) {
  const clientKey = String(env.TIKTOK_CLIENT_KEY || "").trim();
  const clientSecret = String(env.TIKTOK_CLIENT_SECRET || "").trim();
  const report = {
    checkedAt: now,
    mode: "live_client_credentials_probe",
    endpoint: CLIENT_TOKEN_ENDPOINT,
    client_key_present: clientKey.length > 0,
    client_key_length: clientKey.length,
    client_secret_present: clientSecret.length > 0,
    client_secret_length: clientSecret.length,
    verdict: "not_checked",
    http_status: null,
    error: null,
    error_description: null,
    has_access_token: false,
  };

  if (!clientKey || !clientSecret) {
    report.verdict = "missing_credentials";
    return report;
  }

  const doPost =
    postForm ||
    (async (url, body) => {
      const axios = require("axios");
      return axios.post(url, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000,
        validateStatus: () => true,
      });
    });

  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const response = await doPost(CLIENT_TOKEN_ENDPOINT, body);
    const data = response?.data && typeof response.data === "object" ? response.data : {};
    const nested = data.data && typeof data.data === "object" ? data.data : {};
    report.http_status = response?.status || null;
    report.has_access_token = !!(data.access_token || nested.access_token);
    report.error = data.error || nested.error || null;
    report.error_description =
      data.error_description || nested.error_description || data.message || null;
    report.verdict = report.has_access_token
      ? "client_credentials_accepted"
      : "client_credentials_rejected_or_not_supported";
  } catch (err) {
    report.verdict = "network_or_probe_error";
    report.error = err.code || err.name || "error";
    report.error_description = err.message || null;
  }

  return report;
}

function renderTikTokAuthDoctorMarkdown(report) {
  const lines = [];
  lines.push("# TikTok Auth Doctor");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push("");
  lines.push("## Credentials");
  lines.push(`- Client key: present=${report.credentials.client_key.present} length=${report.credentials.client_key.length} sha12=${report.credentials.client_key.sha12 || "n/a"}`);
  lines.push(`- Client secret: present=${report.credentials.client_secret.present} length=${report.credentials.client_secret.length} sha12=${report.credentials.client_secret.sha12 || "n/a"}`);
  lines.push("");
  lines.push("## OAuth Shape");
  lines.push(`- URL shape: ${report.oauth.generated_url_shape}`);
  lines.push(`- Redirect URI: ${report.oauth.redirect_uri}`);
  lines.push(`- HTTPS redirect: ${report.oauth.redirect_https}`);
  lines.push(`- Scopes: ${report.oauth.scope}`);
  lines.push(`- Missing scopes: ${report.oauth.required_scopes_missing.length ? report.oauth.required_scopes_missing.join(", ") : "none"}`);
  lines.push(`- Redacted URL: ${report.oauth.generated_url_redacted}`);
  lines.push("");
  lines.push("## Posting Capability");
  lines.push(`- Inbox upload supported by code: ${report.posting_capability.official_inbox_upload_supported_by_code}`);
  lines.push(`- Public auto-posting permitted by env: ${report.posting_capability.public_auto_posting_permitted_by_env}`);
  lines.push(`- Expected public-post blocker: ${report.posting_capability.public_auto_posting_expected_blocker}`);
  lines.push("");
  lines.push("## Token Inspection");
  lines.push(`- Token status mode: ${report.token_status_mode || "unknown"}`);
  if (!report.token_status) {
    lines.push("- OAuth token: not inspected");
  }
  lines.push("");
  if (report.token_status) {
    lines.push("## OAuth Token");
    lines.push(`- Connected: ${report.token_status.connected}`);
    lines.push(`- Status: ${report.token_status.reason || "unknown"}`);
    lines.push(`- Expires in seconds: ${report.token_status.expires_in_seconds ?? "unknown"}`);
    lines.push(`- Refresh available: ${report.token_status.refresh_available}`);
    lines.push(`- Needs re-auth: ${report.token_status.needs_reauth}`);
    lines.push(`- Needs refresh or sync: ${report.token_status.needs_refresh_or_sync}`);
    lines.push(`- Local action: ${report.token_status.local_action}`);
    lines.push("");
  }
  if (report.client_credentials_probe) {
    lines.push("## Live Client Credential Probe");
    lines.push(`- Verdict: ${report.client_credentials_probe.verdict}`);
    lines.push(`- HTTP status: ${report.client_credentials_probe.http_status || "n/a"}`);
    lines.push(`- Client key length: ${report.client_credentials_probe.client_key_length}`);
    lines.push(`- Client secret length: ${report.client_credentials_probe.client_secret_length}`);
    lines.push(`- Access token returned: ${report.client_credentials_probe.has_access_token}`);
    if (report.client_credentials_probe.error) {
      lines.push(`- Error: ${report.client_credentials_probe.error}`);
    }
    if (report.client_credentials_probe.error_description) {
      lines.push(`- Error description: ${report.client_credentials_probe.error_description}`);
    }
    lines.push("");
  }
  lines.push("## Blockers");
  if (report.blockers.length) {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- none in local config shape");
  }
  lines.push("");
  lines.push("## Warnings");
  for (const warning of report.warnings) lines.push(`- ${warning}`);
  lines.push("");
  lines.push("## Operator Actions");
  for (const action of report.operator_actions) lines.push(`- ${action}`);
  lines.push("");
  lines.push("## Safety");
  for (const action of report.forbiddenActionsAvoided) lines.push(`- ${action}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  REQUIRED_SCOPES,
  buildTikTokAuthDoctorReport,
  probeTikTokClientCredentials,
  renderTikTokAuthDoctorMarkdown,
};
