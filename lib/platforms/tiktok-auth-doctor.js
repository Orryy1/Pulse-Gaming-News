"use strict";

const crypto = require("node:crypto");

const REQUIRED_SCOPES = ["user.info.basic", "video.publish", "video.upload"];

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

  const warnings = [];
  if (!directPostApproved) warnings.push("direct_public_post_not_approved_or_not_declared");
  warnings.push("dashboard_client_key_error_requires_operator_dashboard_fix");

  const verdict = blockers.length ? "RED" : "AMBER";
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
    blockers,
    warnings,
    operator_actions: [
      "Verify the same TikTok app/environment owns the dashboard client key, Login Kit product, Content Posting API product, URL properties and redirect URI.",
      `Confirm the TikTok dashboard redirect URI exactly matches ${oauth.redirect_uri}.`,
      "Confirm you are using the Production app client key for the Production OAuth URL, not a Sandbox key.",
      "Use npm run tiktok:auth-link locally to generate the protected one-time auth link; direct /auth/tiktok is intentionally API-token protected.",
      "If TikTok still reports client_key after exact dashboard values, the app/dashboard state is being rejected before OAuth; save the app again or raise it with TikTok support.",
      "After OAuth succeeds, keep public auto-posting disabled until TikTok app approval is confirmed; use inbox upload/manual completion as the safe bridge.",
    ],
    forbiddenActionsAvoided: [
      "no OAuth flow triggered",
      "no token read or mutation",
      "no TikTok upload",
      "no browser-cookie automation",
      "no production env change",
    ],
  };
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
  renderTikTokAuthDoctorMarkdown,
};
