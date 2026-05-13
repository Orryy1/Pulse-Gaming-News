"use strict";

const { parseCloudflaredConfig } = require("./local-cutover-plan");

function statusFromHealth(health) {
  if (!health) return "unknown";
  if (health.ok) return "pass";
  if (health.status) return `fail:${health.status}`;
  if (health.error) return `fail:${health.error}`;
  return "fail";
}

function parseCloudflaredVersion(output) {
  const text = String(output || "").trim();
  const version = text.match(/cloudflared\s+version\s+([^\s]+)/i)?.[1] || null;
  return {
    raw: text,
    version,
    present: Boolean(version || text),
  };
}

function classifyTunnelConnection(tunnelInfo = "") {
  const text = String(tunnelInfo || "");
  if (!text.trim()) return "unknown";
  if (/does not have any active connection|no active connection/i.test(text)) {
    return "inactive";
  }
  if (/active connections?\s*:\s*(?!0\b|none\b)[^\r\n]+/i.test(text)) {
    return "active";
  }
  if (/\bconnector\b|\bconn\b/i.test(text) && !/inactive|disconnected/i.test(text)) {
    return "active";
  }
  return "unknown";
}

function buildLocalTunnelReadiness({
  configText = "",
  configPath = "D:/pulse-data/cloudflared-pulse.yml",
  cloudflaredPath = "",
  cloudflaredVersionOutput = "",
  credentialsExists = false,
  localHealth = null,
  publicHealth = null,
  tunnelInfo = "",
  expectedHost = "pulse.orryy.com",
  expectedService = "http://localhost:3001",
} = {}) {
  const config = parseCloudflaredConfig(configText);
  const version = parseCloudflaredVersion(cloudflaredVersionOutput);
  const route = config.ingress.find((entry) => entry.hostname === expectedHost) || null;
  const connectionStatus = classifyTunnelConnection(tunnelInfo);
  const startCommand = `cloudflared tunnel --config ${configPath} run pulse-gaming-local`;
  const blockers = [];
  const warnings = [];
  const nextSteps = [];

  if (!cloudflaredPath && !version.present) blockers.push("cloudflared binary was not found");
  if (!config.present) blockers.push(`${configPath} is missing or empty`);
  if (!config.tunnel) blockers.push(`${configPath} does not declare a tunnel id/name`);
  if (!config.credentials_file) blockers.push(`${configPath} does not declare credentials-file`);
  if (config.credentials_file && !credentialsExists) {
    blockers.push(`Cloudflare tunnel credentials file is missing: ${config.credentials_file}`);
  }
  if (!route) {
    blockers.push(`${configPath} does not route ${expectedHost}`);
  } else if (route.service !== expectedService) {
    blockers.push(
      `${configPath} routes ${expectedHost} to ${route.service || "unknown"}, expected ${expectedService}`,
    );
  }
  if (statusFromHealth(localHealth) !== "pass") {
    blockers.push("local /api/health is not reachable");
  }
  if (connectionStatus !== "active") {
    blockers.push("pulse-gaming-local tunnel has no active Cloudflare connection");
  }
  if (statusFromHealth(publicHealth) !== "pass") {
    blockers.push("public /api/health is not reachable through pulse.orryy.com");
  }

  nextSteps.push("Do not flip local primary, queue or AUTO_PUBLISH from this report.");
  nextSteps.push(`Start the existing tunnel only in a controlled cutover window: ${startCommand}`);
  nextSteps.push("After starting the tunnel, verify https://pulse.orryy.com/api/health reports mode=local and primary=false.");
  nextSteps.push("Only after public health is green should local primary readiness be re-run.");

  const verdict = blockers.length ? "red" : warnings.length ? "amber" : "green";
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    verdict,
    safety:
      "read-only; does not start Cloudflare, change DNS, edit env vars, start jobs, post or mutate tokens",
    cloudflared: {
      binary_path: cloudflaredPath || null,
      version: version.version,
      version_raw: version.raw,
    },
    config: {
      path: configPath,
      present: config.present,
      tunnel: config.tunnel || null,
      credentials_file: config.credentials_file || null,
      credentials_exists: Boolean(credentialsExists),
      expected_host: expectedHost,
      expected_service: expectedService,
      route_found: Boolean(route),
      route_service: route?.service || null,
      ingress: config.ingress,
    },
    tunnel: {
      status: connectionStatus,
      info_excerpt: String(tunnelInfo || "").trim().slice(0, 1000),
    },
    health: {
      local: localHealth,
      public: publicHealth,
      local_status: statusFromHealth(localHealth),
      public_status: statusFromHealth(publicHealth),
    },
    start_command: startCommand,
    blockers,
    warnings,
    next_steps: nextSteps,
  };
}

function formatLocalTunnelReadinessMarkdown(report = {}) {
  const lines = [];
  lines.push("# Local Tunnel Readiness");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push(`Safety: ${report.safety || "read-only"}`);
  lines.push("");
  lines.push("## Cloudflared");
  lines.push(`- binary: ${report.cloudflared?.binary_path || "(missing)"}`);
  lines.push(`- version: ${report.cloudflared?.version || "(unknown)"}`);
  lines.push("");
  lines.push("## Tunnel Config");
  lines.push(`- config: ${report.config?.path || "(unknown)"}`);
  lines.push(`- tunnel: ${report.config?.tunnel || "(missing)"}`);
  lines.push(`- credentials file present: ${report.config?.credentials_exists === true}`);
  lines.push(`- expected route: ${report.config?.expected_host} -> ${report.config?.expected_service}`);
  lines.push(`- actual route: ${report.config?.route_found ? report.config?.route_service : "(missing)"}`);
  lines.push("");
  lines.push("## Connection And Health");
  lines.push(`- tunnel status: ${report.tunnel?.status || "unknown"}`);
  lines.push(`- local health: ${report.health?.local_status || "unknown"}`);
  lines.push(`- public health: ${report.health?.public_status || "unknown"}`);
  if (report.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Controlled Start Command");
  lines.push(`- ${report.start_command || "(unknown)"}`);
  lines.push("");
  lines.push("## Next Steps");
  for (const step of report.next_steps || []) lines.push(`- ${step}`);
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLocalTunnelReadiness,
  classifyTunnelConnection,
  formatLocalTunnelReadinessMarkdown,
  parseCloudflaredVersion,
};
