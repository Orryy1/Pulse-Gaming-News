"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { buildOAuthUptimePlan } = require("./oauth-uptime");

function safeError(error) {
  return String(error?.message || error || "unknown_error")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>")
    .replace(
      /\b(access_token|refresh_token|client_secret|code)=?[^\s&"']*/gi,
      "$1=<redacted>",
    )
    .slice(0, 500);
}

function renderOAuthUptimeMarkdown(report = {}) {
  const lines = [
    "# Pulse OAuth Uptime",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "unknown"}`,
    `Human re-authorisation required: ${report.requires_human_reauth === true}`,
    "",
    "## Platforms",
    "",
  ];
  for (const [platform, result] of Object.entries(report.results || {})) {
    lines.push(`- ${platform}: ${result.status} (${result.reason || "none"})`);
  }
  lines.push(
    "",
    "## Safety",
    "",
    "- Credential values are never written to this report.",
    "- No social post, production database change or platform enablement was triggered.",
    "",
  );
  return lines.join("\n");
}

async function runOAuthUptimeMaintenance({
  now = Date.now(),
  outDir,
  platformAdapters = {},
  allowTokenMutation = false,
} = {}) {
  if (!outDir) throw new Error("outDir is required");
  const statuses = {};
  for (const platform of ["youtube", "tiktok", "instagram", "facebook", "x"]) {
    const adapter = platformAdapters[platform];
    if (!adapter?.inspect) {
      statuses[platform] = { enabled: false };
      continue;
    }
    try {
      const inspected = await adapter.inspect();
      statuses[platform] = {
        enabled: inspected?.enabled === true,
        access_expires_at: inspected?.access_expires_at ?? null,
        refresh_expires_at: inspected?.refresh_expires_at ?? null,
        refresh_available: inspected?.refresh_available === true,
        credential_kind: inspected?.credential_kind || null,
      };
    } catch (error) {
      statuses[platform] = {
        enabled: true,
        refresh_available: false,
        inspect_error: safeError(error),
      };
    }
  }

  const plan = buildOAuthUptimePlan({ now, platforms: statuses });
  const results = {};
  for (const check of plan.checks) {
    const adapter = platformAdapters[check.platform];
    if (check.action === "disabled" || check.action === "none") {
      results[check.platform] = {
        status: check.action === "disabled" ? "disabled" : "healthy",
        reason: check.reason,
      };
      continue;
    }
    if (check.action === "reauthorise") {
      results[check.platform] = {
        status: "reauthorisation_required",
        reason: check.reason,
      };
      continue;
    }
    try {
      if (check.action === "refresh") {
        if (!allowTokenMutation) {
          results[check.platform] = {
            status: "refresh_planned",
            reason: check.reason,
          };
          continue;
        }
        await adapter.refresh();
        results[check.platform] = {
          status: "refreshed",
          reason: check.reason,
        };
      } else {
        const validation = await adapter.validate();
        results[check.platform] = {
          status: validation?.ok === false ? "invalid" : "valid",
          reason: validation?.reason || check.reason,
        };
      }
    } catch (error) {
      results[check.platform] = {
        status: "reauthorisation_required",
        reason: safeError(error),
      };
    }
  }

  const requiresHuman = Object.values(results).some(
    (result) => result.status === "reauthorisation_required",
  );
  const report = {
    schema_version: 1,
    generated_at: plan.generated_at,
    verdict: requiresHuman
      ? "RED"
      : Object.values(results).some((result) => result.status === "refreshed")
        ? "GREEN"
        : plan.verdict,
    requires_human_reauth: requiresHuman,
    results,
    next_check_within_hours: 6,
    safety: { ...plan.safety },
  };
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "oauth_uptime_report.json");
  const mdPath = path.join(outDir, "oauth_uptime_report.md");
  await Promise.all([
    fs.writeJson(jsonPath, report, { spaces: 2 }),
    fs.writeFile(mdPath, renderOAuthUptimeMarkdown(report), "utf8"),
  ]);
  return { report, artefacts: { jsonPath, mdPath } };
}

module.exports = {
  renderOAuthUptimeMarkdown,
  runOAuthUptimeMaintenance,
  safeError,
};
