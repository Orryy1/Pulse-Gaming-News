"use strict";

const CONTROL_KEYS = new Set([
  "DEPLOYMENT_MODE",
  "PULSE_PRIMARY_INSTANCE",
  "USE_SQLITE",
  "USE_JOB_QUEUE",
  "AUTO_PUBLISH",
  "LOCAL_PUBLIC_URL",
  "PULSE_PUBLIC_URL",
  "MEDIA_ROOT",
  "SQLITE_DB_PATH",
  "PULSE_TOKEN_DIR",
  "PORT",
]);

const SAFE_VALUE_KEYS = new Set([
  "DEPLOYMENT_MODE",
  "PULSE_PRIMARY_INSTANCE",
  "USE_SQLITE",
  "USE_JOB_QUEUE",
  "AUTO_PUBLISH",
  "LOCAL_PUBLIC_URL",
  "PULSE_PUBLIC_URL",
  "MEDIA_ROOT",
  "SQLITE_DB_PATH",
  "PULSE_TOKEN_DIR",
  "PORT",
  "CHANNEL",
  "NODE_ENV",
]);

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function redactEnvValue(key, value) {
  if (SAFE_VALUE_KEYS.has(key)) return String(value || "");
  if (value == null || value === "") return "";
  return `(set, len ${String(value).length})`;
}

function parseEnvEntries(text) {
  const entries = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const splitAt = trimmed.indexOf("=");
    const key = trimmed.slice(0, splitAt).trim();
    if (!key) return;
    entries.push({
      key,
      line: index + 1,
      value: trimmed.slice(splitAt + 1).trim(),
    });
  });
  return entries;
}

function summariseEnv(text) {
  const entries = parseEnvEntries(text);
  const byKey = new Map();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }

  const duplicateKeys = [];
  const effective = {};
  for (const [key, values] of byKey.entries()) {
    if (values.length > 1) duplicateKeys.push(key);
    effective[key] = values[values.length - 1]?.value || "";
  }

  return {
    duplicate_keys: duplicateKeys.sort(),
    duplicate_details: duplicateKeys
      .sort()
      .map((key) => ({
        key,
        lines: byKey.get(key).map((entry) => entry.line),
        effective_value: redactEnvValue(key, effective[key]),
      })),
    effective_control: Object.fromEntries(
      Array.from(CONTROL_KEYS)
        .filter((key) => Object.prototype.hasOwnProperty.call(effective, key))
        .sort()
        .map((key) => [key, redactEnvValue(key, effective[key])]),
    ),
    flags: {
      deployment_mode: effective.DEPLOYMENT_MODE || "",
      primary: truthy(effective.PULSE_PRIMARY_INSTANCE),
      use_sqlite: truthy(effective.USE_SQLITE),
      use_job_queue: truthy(effective.USE_JOB_QUEUE),
      auto_publish: truthy(effective.AUTO_PUBLISH),
      public_url: effective.PULSE_PUBLIC_URL || effective.LOCAL_PUBLIC_URL || "",
      media_root: effective.MEDIA_ROOT || "",
      sqlite_db_path: effective.SQLITE_DB_PATH || "",
      port: effective.PORT || "3001",
    },
  };
}

function parseCloudflaredConfig(text) {
  const configText = String(text || "");
  const tunnel = configText.match(/^\s*tunnel:\s*([^\r\n#]+)/m)?.[1]?.trim() || "";
  const credentialsFile =
    configText.match(/^\s*credentials-file:\s*([^\r\n#]+)/m)?.[1]?.trim() || "";
  const ingress = [];
  const lines = configText.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const hostMatch = line.match(/^\s*-\s*hostname:\s*([^\r\n#]+)/);
    if (hostMatch) {
      current = { hostname: hostMatch[1].trim(), service: "" };
      ingress.push(current);
      continue;
    }
    const serviceMatch = line.match(/^\s*service:\s*([^\r\n#]+)/);
    if (serviceMatch && current) current.service = serviceMatch[1].trim();
  }
  return {
    present: Boolean(configText.trim()),
    tunnel,
    credentials_file: credentialsFile,
    ingress,
  };
}

function statusFromHealth(health) {
  if (!health) return "unknown";
  if (health.ok) return "pass";
  if (health.status) return `fail:${health.status}`;
  if (health.error) return `fail:${health.error}`;
  return "fail";
}

function buildLocalCutoverPlan({
  envText = "",
  defaultCloudflaredConfigText = "",
  pulseCloudflaredConfigText = "",
  localHealth = null,
  publicHealth = null,
  tunnelInfo = "",
  expectedHost = "pulse.orryy.com",
  expectedService = "http://localhost:3001",
  pulseConfigPath = "D:/pulse-data/cloudflared-pulse.yml",
} = {}) {
  const env = summariseEnv(envText);
  const defaultTunnel = parseCloudflaredConfig(defaultCloudflaredConfigText);
  const pulseTunnel = parseCloudflaredConfig(pulseCloudflaredConfigText);
  const blockers = [];
  const warnings = [];
  const nextSteps = [];

  const criticalDuplicates = env.duplicate_keys.filter((key) =>
    CONTROL_KEYS.has(key),
  );
  if (criticalDuplicates.length) {
    blockers.push(`duplicate local control keys: ${criticalDuplicates.join(", ")}`);
  }
  if (env.flags.deployment_mode !== "local") {
    blockers.push("DEPLOYMENT_MODE is not local");
  }
  if (!env.flags.use_sqlite) blockers.push("USE_SQLITE is not true");
  if (!env.flags.media_root) blockers.push("MEDIA_ROOT is not configured");
  if (!env.flags.sqlite_db_path) blockers.push("SQLITE_DB_PATH is not configured");

  const pulseIngress = pulseTunnel.ingress.find(
    (entry) => entry.hostname === expectedHost,
  );
  if (!pulseTunnel.present) {
    blockers.push(`${pulseConfigPath} is missing`);
  } else if (!pulseIngress) {
    blockers.push(`${pulseConfigPath} does not route ${expectedHost}`);
  } else if (pulseIngress.service !== expectedService) {
    blockers.push(
      `${pulseConfigPath} routes ${expectedHost} to ${pulseIngress.service || "unknown"}, expected ${expectedService}`,
    );
  }

  const defaultRoutesExpectedHost = defaultTunnel.ingress.some(
    (entry) => entry.hostname === expectedHost,
  );
  if (defaultTunnel.present && !defaultRoutesExpectedHost) {
    warnings.push(
      "default cloudflared config does not route pulse.orryy.com; start Cloudflare with the explicit Pulse config",
    );
  }
  if (/does not have any active connection|no active connection/i.test(tunnelInfo)) {
    blockers.push("pulse-gaming-local tunnel has no active Cloudflare connection");
  }

  if (statusFromHealth(localHealth) !== "pass") {
    blockers.push("local /api/health is not reachable");
  }
  if (statusFromHealth(publicHealth) !== "pass") {
    blockers.push("public /api/health is not reachable through pulse.orryy.com");
  }

  if (env.flags.primary || env.flags.use_job_queue || env.flags.auto_publish) {
    warnings.push(
      "one or more posting flags are already enabled locally; confirm this is intentional before starting the server",
    );
  }

  nextSteps.push("Keep Railway standby; do not restore Railway as the publisher.");
  nextSteps.push("Clean duplicate local control keys in .env so each switch appears once.");
  nextSteps.push("Start local server in mirror mode first and verify http://localhost:3001/api/health.");
  nextSteps.push(
    `Start Cloudflare with: cloudflared tunnel --config ${pulseConfigPath} run pulse-gaming-local`,
  );
  nextSteps.push("Verify https://pulse.orryy.com/api/health reports mode=local.");
  nextSteps.push("Run npm run ops:local-primary-readiness and only cut over after it is green.");
  nextSteps.push(
    "Only after readiness is green, flip local PULSE_PRIMARY_INSTANCE=true, USE_JOB_QUEUE=true and AUTO_PUBLISH=true.",
  );

  const verdict = blockers.length ? "red" : warnings.length ? "amber" : "green";
  return {
    generated_at: new Date().toISOString(),
    verdict,
    env,
    cloudflared: {
      default_config: defaultTunnel,
      pulse_config: pulseTunnel,
      expected_host: expectedHost,
      expected_service: expectedService,
      tunnel_info: tunnelInfo ? tunnelInfo.trim().slice(0, 1000) : "",
    },
    health: {
      local: localHealth,
      public: publicHealth,
    },
    blockers,
    warnings,
    next_steps: nextSteps,
    safety: "read-only; does not edit .env, start jobs, post, mutate DB, change Railway or change Cloudflare DNS",
  };
}

function formatLocalCutoverPlanMarkdown(plan) {
  const lines = [];
  lines.push("# Local Cutover Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Verdict: ${String(plan.verdict || "unknown").toUpperCase()}`);
  lines.push(`Safety: ${plan.safety}`);
  lines.push("");
  lines.push("## Effective Local Control Flags");
  const control = plan.env?.effective_control || {};
  if (!Object.keys(control).length) {
    lines.push("- none found");
  } else {
    for (const [key, value] of Object.entries(control)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  if (plan.env?.duplicate_details?.length) {
    lines.push("");
    lines.push("## Duplicate .env Keys");
    for (const detail of plan.env.duplicate_details) {
      lines.push(
        `- ${detail.key}: lines ${detail.lines.join(", ")}; effective value ${detail.effective_value || "(empty)"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Cloudflare");
  const pulse = plan.cloudflared?.pulse_config || {};
  lines.push(`- expected host: ${plan.cloudflared?.expected_host}`);
  lines.push(`- expected service: ${plan.cloudflared?.expected_service}`);
  lines.push(`- pulse config present: ${pulse.present ? "yes" : "no"}`);
  lines.push(`- pulse tunnel: ${pulse.tunnel || "(missing)"}`);
  for (const entry of pulse.ingress || []) {
    lines.push(`- route: ${entry.hostname} -> ${entry.service || "(missing)"}`);
  }
  lines.push("");
  lines.push("## Health");
  lines.push(`- local: ${statusFromHealth(plan.health?.local)}`);
  lines.push(`- public: ${statusFromHealth(plan.health?.public)}`);
  if (plan.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of plan.blockers) lines.push(`- ${blocker}`);
  }
  if (plan.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Next Steps");
  for (const step of plan.next_steps || []) lines.push(`- ${step}`);
  return lines.join("\n");
}

module.exports = {
  buildLocalCutoverPlan,
  CONTROL_KEYS,
  formatLocalCutoverPlanMarkdown,
  parseCloudflaredConfig,
  parseEnvEntries,
  redactEnvValue,
  summariseEnv,
};
