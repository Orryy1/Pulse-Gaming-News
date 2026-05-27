"use strict";

function buildTikTokTokenMaintenancePlan(status = {}, options = {}) {
  const allowRefresh = options.allowRefresh === true;
  const ok = status.ok === true;
  const refreshAvailable = status.refresh_available === true;
  const needsReauth = status.needs_reauth === true;
  const reason = status.reason || "unknown";

  if (ok) {
    return {
      verdict: "green",
      action: "none",
      mutatesTokenFile: false,
      reason: "local token is usable",
    };
  }

  if (needsReauth || !refreshAvailable) {
    return {
      verdict: "red",
      action: "operator_reauth_required",
      mutatesTokenFile: false,
      reason,
    };
  }

  return {
    verdict: allowRefresh ? "amber" : "amber",
    action: allowRefresh ? "refresh_local_token" : "dry_run_refresh_available",
    mutatesTokenFile: allowRefresh,
    reason,
  };
}

function sanitiseTokenStatus(status = {}) {
  return {
    ok: status.ok === true,
    reason: status.reason || null,
    expires_at: Number.isFinite(Number(status.expires_at))
      ? Number(status.expires_at)
      : null,
    expires_in_seconds: Number.isFinite(Number(status.expires_in_seconds))
      ? Number(status.expires_in_seconds)
      : null,
    refresh_available: status.refresh_available === true,
    needs_reauth: status.needs_reauth === true,
  };
}

function renderTikTokTokenMaintenanceMarkdown(report) {
  const before = report.before || {};
  const after = report.after || null;
  const lines = [];
  lines.push("# TikTok Token Maintenance");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Action: ${report.action}`);
  lines.push(`Reason: ${report.reason}`);
  lines.push("");
  lines.push("## Before");
  lines.push(`- ok: ${before.ok === true}`);
  lines.push(`- reason: ${before.reason || "unknown"}`);
  lines.push(`- expires_in_seconds: ${before.expires_in_seconds ?? "unknown"}`);
  lines.push(`- refresh_available: ${before.refresh_available === true}`);
  lines.push(`- needs_reauth: ${before.needs_reauth === true}`);
  if (after) {
    lines.push("");
    lines.push("## After");
    lines.push(`- ok: ${after.ok === true}`);
    lines.push(`- reason: ${after.reason || "unknown"}`);
    lines.push(`- expires_in_seconds: ${after.expires_in_seconds ?? "unknown"}`);
    lines.push(`- refresh_available: ${after.refresh_available === true}`);
    lines.push(`- needs_reauth: ${after.needs_reauth === true}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Token values are never printed.");
  lines.push("- `--refresh` mutates only the local TikTok token JSON file.");
  lines.push("- No OAuth browser flow, Railway env mutation, production DB mutation or social upload is performed.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildTikTokTokenMaintenancePlan,
  renderTikTokTokenMaintenanceMarkdown,
  sanitiseTokenStatus,
};
