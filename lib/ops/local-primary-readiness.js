"use strict";

const http = require("node:http");
const https = require("node:https");

const DEFAULT_TIMEOUT_MS = 5000;
const CRITICAL_ENV_KEYS = new Set([
  "DEPLOYMENT_MODE",
  "PULSE_PRIMARY_INSTANCE",
  "USE_SQLITE",
  "USE_JOB_QUEUE",
  "AUTO_PUBLISH",
  "LOCAL_PUBLIC_URL",
  "PULSE_PUBLIC_URL",
  "MEDIA_ROOT",
  "SQLITE_DB_PATH",
]);

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ ok: false, status: null, error: `invalid_url:${err.message}` });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(parsed, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          /* non-json body is still useful as status evidence */
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json,
          error: null,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: null, json: null, error: err.message });
    });
  });
}

async function buildLocalPrimaryReadiness({
  env = process.env,
  publicHealth,
  localHealth,
  duplicateEnvKeys = [],
  now = new Date(),
} = {}) {
  const deployment = require("../deployment-mode");
  const summary = deployment.summary(env);
  const publicUrl = summary.public_url;
  const port = env.PORT || 3001;
  const localUrl = `http://localhost:${port}`;

  const checks = {
    deployment_mode_local: summary.mode === "local",
    primary_enabled: summary.primary === true,
    use_sqlite_enabled: truthy(env.USE_SQLITE),
    use_job_queue_enabled: truthy(env.USE_JOB_QUEUE),
    auto_publish_enabled: truthy(env.AUTO_PUBLISH),
    public_url_not_localhost: !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(
      publicUrl || "",
    ),
    media_root_configured: Boolean(env.MEDIA_ROOT),
    sqlite_db_path_configured: Boolean(env.SQLITE_DB_PATH),
  };

  const health = {
    local: localHealth || null,
    public: publicHealth || null,
  };

  if (!localHealth) {
    health.local = await fetchJson(`${localUrl}/api/health`);
  }
  if (!publicHealth && publicUrl) {
    health.public = await fetchJson(`${publicUrl}/api/health`);
  }

  const blockers = [];
  const warnings = [];
  const criticalDuplicates = duplicateEnvKeys.filter((key) =>
    CRITICAL_ENV_KEYS.has(key),
  );

  if (!checks.deployment_mode_local) blockers.push("DEPLOYMENT_MODE is not local");
  if (criticalDuplicates.length) {
    blockers.push(`duplicate critical .env keys: ${criticalDuplicates.join(", ")}`);
  }
  if (!checks.primary_enabled) blockers.push("PULSE_PRIMARY_INSTANCE is not true");
  if (!checks.use_sqlite_enabled) blockers.push("USE_SQLITE is not true");
  if (!checks.use_job_queue_enabled) blockers.push("USE_JOB_QUEUE is not true");
  if (!checks.auto_publish_enabled) blockers.push("AUTO_PUBLISH is not true");
  if (!checks.public_url_not_localhost) blockers.push("public URL is localhost");
  if (!checks.media_root_configured) blockers.push("MEDIA_ROOT is not configured");
  if (!checks.sqlite_db_path_configured) blockers.push("SQLITE_DB_PATH is not configured");
  if (!health.local.ok) blockers.push("local /api/health is not reachable");
  if (!health.public.ok) blockers.push("public /api/health is not reachable");

  const publicPrimary = health.public.json?.deployment?.primary;
  const publicMode = health.public.json?.deployment?.mode;
  if (health.public.ok && publicMode !== "local") {
    warnings.push(`public URL reports mode=${publicMode || "unknown"}, expected local`);
  }
  if (health.public.ok && publicPrimary !== true) {
    warnings.push("public URL is reachable but does not report primary=true");
  }

  let verdict = "green";
  if (blockers.length) verdict = "red";
  else if (warnings.length) verdict = "amber";

  return {
    generated_at: now.toISOString(),
    verdict,
    deployment: summary,
    checks,
    health,
    duplicate_env_keys: duplicateEnvKeys,
    blockers,
    warnings,
    recommendation:
      verdict === "green"
        ? "local_primary_ready_for_controlled_start"
        : "do_not_start_local_primary_yet",
  };
}

function formatLocalPrimaryReadinessMarkdown(report) {
  const lines = [];
  lines.push("# Local Primary Readiness");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push("");
  lines.push("## Deployment");
  lines.push(`- mode: ${report.deployment.mode}`);
  lines.push(`- primary: ${report.deployment.primary}`);
  lines.push(`- public_url: ${report.deployment.public_url}`);
  lines.push(`- media_root: ${report.deployment.media_root}`);
  lines.push(`- sqlite_db_path: ${report.deployment.sqlite_db_path}`);
  lines.push("");
  lines.push("## Checks");
  for (const [key, value] of Object.entries(report.checks || {})) {
    lines.push(`- ${key}: ${value ? "pass" : "fail"}`);
  }
  lines.push("");
  lines.push("## Health");
  for (const [key, value] of Object.entries(report.health || {})) {
    lines.push(
      `- ${key}: ${value?.ok ? "pass" : "fail"}${value?.status ? ` (${value.status})` : ""}${value?.error ? ` - ${value.error}` : ""}`,
    );
  }
  if (report.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  if (report.duplicate_env_keys?.length) {
    lines.push("");
    lines.push("## Duplicate .env Keys");
    for (const key of report.duplicate_env_keys) lines.push(`- ${key}`);
  }
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push(`Recommendation: ${report.recommendation}`);
  lines.push("");
  lines.push("Safety: read-only; no env, token, DB, Railway or platform mutations.");
  return lines.join("\n");
}

module.exports = {
  buildLocalPrimaryReadiness,
  CRITICAL_ENV_KEYS,
  fetchJson,
  formatLocalPrimaryReadinessMarkdown,
  truthy,
};
