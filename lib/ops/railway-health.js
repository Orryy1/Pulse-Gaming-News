"use strict";

const DEFAULT_PUBLIC_HEALTH_URL =
  "https://marvelous-curiosity-production.up.railway.app/api/health";

const SECRET_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CLIENT[_-]?SECRET|ACCESS[_-]?TOKEN)\s*[=:]\s*)[^\s,;}]+/gi,
  /([?&](?:token|access_token|client_secret|api_key)=)[^&\s]+/gi,
];

function redactSensitive(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "$1[REDACTED]");
  }
  return text;
}

function parseRailwayJsonLines(raw) {
  const text = String(raw || "").replace(/\u0000/g, "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { message: line, parseError: true };
      }
    });
}

function safeLogEntry(entry) {
  const message = redactSensitive(entry.message || entry.msg || entry.log || "");
  return {
    timestamp: entry.timestamp || entry.time || entry.ts || null,
    level: entry.level || entry.severity || null,
    message,
    status:
      entry.httpStatus ||
      entry.status ||
      entry.statusCode ||
      entry.responseStatus ||
      null,
    method: entry.method || entry.httpMethod || null,
    path: entry.path || entry.requestPath || null,
  };
}

function latestDeployment(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) return null;
  return deployments[0];
}

function normaliseDeployment(deployment) {
  if (!deployment) return null;
  return {
    id: deployment.id || null,
    status: deployment.status || null,
    createdAt: deployment.createdAt || null,
    commitHash: deployment.meta?.commitHash || null,
    commitMessage: deployment.meta?.commitMessage || null,
    branch: deployment.meta?.branch || null,
    repo: deployment.meta?.repo || null,
  };
}

function summariseHealth(health) {
  if (!health) {
    return {
      ok: false,
      status: null,
      body: null,
      issue: "health_not_checked",
    };
  }
  const body = health.body && typeof health.body === "object" ? health.body : null;
  return {
    ok: Boolean(health.ok),
    status: health.status || null,
    body: body
      ? {
          status: body.status,
          version: body.version,
          uptime: body.uptime,
          autonomousMode: body.autonomousMode,
          schedulerActive: body.schedulerActive,
          build: body.build
            ? {
                commit_sha: body.build.commit_sha,
                commit_short: body.build.commit_short,
                commit_message: body.build.commit_message,
                branch: body.build.branch,
                deployment_id: body.build.deployment_id,
                environment: body.build.environment,
              }
            : undefined,
          runtime: body.runtime
            ? {
                use_sqlite: body.runtime.use_sqlite,
                auto_publish: body.runtime.auto_publish,
                dispatch: body.runtime.dispatch,
                sqlite_db_path: body.runtime.sqlite_db_path,
                sqlite_db_path_looks_ephemeral:
                  body.runtime.sqlite_db_path_looks_ephemeral,
              }
            : undefined,
        }
      : null,
    issue: health.ok ? null : health.error || "health_failed",
  };
}

function classifyLogIssues(entries, { source = "app" } = {}) {
  const safeEntries = (entries || []).map(safeLogEntry);
  const issues = [];
  const warnings = [];
  const advisories = [];

  for (const entry of safeEntries) {
    const msg = entry.message || "";
    const level = String(entry.level || "").toLowerCase();
    const status = Number(entry.status || 0);

    if (/checksum mismatch|migration runner failed|\[migrate\] FATAL/i.test(msg)) {
      issues.push({
        code: "migration_checksum_error",
        source,
        timestamp: entry.timestamp,
        message: msg,
      });
      continue;
    }

    if (/FATAL|uncaught|unhandled|crash|listen EADDRINUSE/i.test(msg)) {
      issues.push({
        code: "runtime_startup_error",
        source,
        timestamp: entry.timestamp,
        message: msg,
      });
      continue;
    }

    if (status >= 500) {
      issues.push({
        code: "http_5xx",
        source,
        timestamp: entry.timestamp,
        status,
        method: entry.method,
        path: entry.path,
        message: msg,
      });
      continue;
    }

    if (status >= 400) {
      warnings.push({
        code: "http_4xx",
        source,
        timestamp: entry.timestamp,
        status,
        method: entry.method,
        path: entry.path,
        message: msg,
      });
      continue;
    }

    if (/EBADENGINE|moderate severity vulnerabilities|npm audit/i.test(msg)) {
      warnings.push({
        code: "build_warning",
        source,
        timestamp: entry.timestamp,
        message: msg,
      });
      continue;
    }

    if (/deprecated|New major version of npm available/i.test(msg)) {
      advisories.push({
        code: "build_advisory",
        source,
        timestamp: entry.timestamp,
        message: msg,
      });
      continue;
    }

    if (
      level === "error" &&
      !/SENTRY_DSN not set - error tracking disabled/i.test(msg)
    ) {
      warnings.push({
        code: "logged_error_level",
        source,
        timestamp: entry.timestamp,
        message: msg,
      });
    }
  }

  return { issues, warnings, advisories, sample: safeEntries.slice(-20) };
}

function resolveExpectedCommit({ env = process.env, gitHead = null } = {}) {
  const explicit = String(env.RAILWAY_EXPECTED_COMMIT || "").trim();
  if (explicit) return explicit;
  return typeof gitHead === "function" ? gitHead() : gitHead;
}

function buildRailwayHealthReport({
  generatedAt = new Date().toISOString(),
  deployments = [],
  health = null,
  appLogs = [],
  buildLogs = [],
  httpLogs = [],
  expectedCommit = null,
} = {}) {
  const latest = normaliseDeployment(latestDeployment(deployments));
  const healthSummary = summariseHealth(health);
  const app = classifyLogIssues(appLogs, { source: "app" });
  const build = classifyLogIssues(buildLogs, { source: "build" });
  const http = classifyLogIssues(httpLogs, { source: "http" });

  const hardFails = [];
  const warnings = [];
  const advisories = [];
  const green = [];

  if (!latest) {
    hardFails.push({ code: "deployment_missing", message: "No Railway deployment was found." });
  } else if (latest.status !== "SUCCESS") {
    hardFails.push({
      code: "latest_deployment_not_success",
      message: `Latest Railway deployment is ${latest.status}.`,
      deploymentId: latest.id,
    });
  } else {
    green.push("latest_deployment_success");
  }

  if (expectedCommit && latest?.commitHash && latest.commitHash !== expectedCommit) {
    hardFails.push({
      code: "deployment_commit_mismatch",
      message: "Railway latest deployment does not match the expected local commit.",
      expectedCommit,
      actualCommit: latest.commitHash,
    });
  } else if (expectedCommit && latest?.commitHash) {
    green.push("deployment_commit_matches");
  }

  if (!healthSummary.ok || healthSummary.body?.status !== "ok") {
    hardFails.push({
      code: "health_endpoint_failed",
      message: "Production /api/health did not return ok.",
      status: healthSummary.status,
      issue: healthSummary.issue,
    });
  } else {
    green.push("health_endpoint_ok");
  }

  for (const issue of [...app.issues, ...build.issues, ...http.issues]) {
    hardFails.push(issue);
  }

  for (const warning of [...app.warnings, ...build.warnings, ...http.warnings]) {
    warnings.push(warning);
  }

  for (const advisory of [
    ...app.advisories,
    ...build.advisories,
    ...http.advisories,
  ]) {
    advisories.push(advisory);
  }

  if (healthSummary.body?.runtime?.sqlite_db_path_looks_ephemeral === true) {
    warnings.push({
      code: "sqlite_path_ephemeral",
      message: "Production SQLite path appears ephemeral.",
    });
  } else if (healthSummary.body?.runtime?.sqlite_db_path) {
    green.push("sqlite_path_persistent");
  }

  const verdict = hardFails.length ? "fail" : warnings.length ? "review" : "pass";

  return {
    generatedAt,
    verdict,
    latestDeployment: latest,
    health: healthSummary,
    hardFails,
    warnings,
    advisories,
    green,
    logSamples: {
      app: app.sample,
      build: build.sample,
      http: http.sample,
    },
  };
}

function renderRailwayHealthMarkdown(report) {
  const lines = [
    "# Railway Health Check",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    "",
    "## Latest Deployment",
    "",
  ];

  if (report.latestDeployment) {
    lines.push(
      `- id: ${report.latestDeployment.id}`,
      `- status: ${report.latestDeployment.status}`,
      `- commit: ${report.latestDeployment.commitHash || "unknown"}`,
      `- branch: ${report.latestDeployment.branch || "unknown"}`,
      `- message: ${redactSensitive(report.latestDeployment.commitMessage || "unknown").split("\n")[0]}`,
    );
  } else {
    lines.push("- None found.");
  }

  lines.push("", "## Health", "");
  lines.push(`- ok: ${report.health.ok}`);
  lines.push(`- httpStatus: ${report.health.status ?? "unknown"}`);
  if (report.health.body?.build) {
    lines.push(`- deployedCommit: ${report.health.body.build.commit_short || "unknown"}`);
    lines.push(`- deploymentId: ${report.health.body.build.deployment_id || "unknown"}`);
  }
  if (report.health.body?.runtime) {
    lines.push(`- sqliteDbPath: ${report.health.body.runtime.sqlite_db_path || "unknown"}`);
    lines.push(
      `- sqliteEphemeral: ${report.health.body.runtime.sqlite_db_path_looks_ephemeral}`,
    );
    lines.push(
      `- dispatch: ${report.health.body.runtime.dispatch?.mode || "unknown"} / strict=${report.health.body.runtime.dispatch?.strict}`,
    );
  }

  lines.push("", "## Hard Fails", "");
  if (report.hardFails.length === 0) lines.push("- None.");
  for (const item of report.hardFails) {
    lines.push(`- ${item.code}: ${redactSensitive(item.message || "")}`);
  }

  lines.push("", "## Warnings", "");
  if (report.warnings.length === 0) lines.push("- None.");
  for (const item of report.warnings.slice(0, 25)) {
    lines.push(`- ${item.code}: ${redactSensitive(item.message || "")}`.slice(0, 500));
  }
  if (report.warnings.length > 25) {
    lines.push(`- ...and ${report.warnings.length - 25} more warnings.`);
  }

  lines.push("", "## Advisories", "");
  if (!report.advisories || report.advisories.length === 0) lines.push("- None.");
  for (const item of (report.advisories || []).slice(0, 25)) {
    lines.push(`- ${item.code}: ${redactSensitive(item.message || "")}`.slice(0, 500));
  }
  if ((report.advisories || []).length > 25) {
    lines.push(`- ...and ${report.advisories.length - 25} more advisories.`);
  }

  lines.push("", "## Green Signals", "");
  if (report.green.length === 0) lines.push("- None.");
  for (const item of report.green) lines.push(`- ${item}`);

  lines.push("", "## Safety", "");
  lines.push("- Read-only Railway inspection.");
  lines.push("- No deploy, restart, variable mutation, publish job or OAuth flow.");
  lines.push("- Secrets and token-shaped values are redacted from report text.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_PUBLIC_HEALTH_URL,
  redactSensitive,
  parseRailwayJsonLines,
  safeLogEntry,
  classifyLogIssues,
  resolveExpectedCommit,
  buildRailwayHealthReport,
  renderRailwayHealthMarkdown,
};
