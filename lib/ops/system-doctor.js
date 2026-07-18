"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_HEALTH_URL =
  "https://marvelous-curiosity-production.up.railway.app/api/health";

function healthEndpoint(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return DEFAULT_HEALTH_URL;
  return /\/api\/health$/i.test(base) ? base : `${base}/api/health`;
}

function resolveSystemDoctorHealthUrl({ healthUrl, env = process.env } = {}) {
  if (healthUrl) return healthEndpoint(healthUrl);
  const localMode = String(env.DEPLOYMENT_MODE || "").trim().toLowerCase() === "local";
  const configured =
    env.PULSE_PUBLIC_URL ||
    (localMode ? env.LOCAL_PUBLIC_URL : "") ||
    env.RAILWAY_PUBLIC_URL ||
    env.LOCAL_PUBLIC_URL ||
    DEFAULT_HEALTH_URL;
  return healthEndpoint(configured);
}

function run(cmd, args = [], options = {}) {
  const executable =
    process.platform === "win32" && cmd === "npx" ? "cmd.exe" : cmd;
  const finalArgs =
    process.platform === "win32" && cmd === "npx"
      ? ["/d", "/s", "/c", ["npx", ...args].join(" ")]
      : args;
  try {
    return {
      ok: true,
      stdout: execFileSync(executable, finalArgs, {
        cwd: ROOT,
        encoding: "utf8",
        input: options.input,
        stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      }).trim(),
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err.stderr || err.message || err).trim(),
    };
  }
}

function commandPath(command, commandRunner = run) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const result = commandRunner(process.platform === "win32" ? "where" : "which", [
    command + (command === "npm" && process.platform === "win32" ? suffix : ""),
  ]);
  return result.ok ? result.stdout.split(/\r?\n/)[0] : null;
}

async function fetchHealth(url = DEFAULT_HEALTH_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: null, error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function wait(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Number(ms));
    timer.unref?.();
  });
}

async function fetchHealthWithRetry(
  url,
  {
    healthFetcher = fetchHealth,
    attempts = 3,
    delayMs = 250,
  } = {},
) {
  const maxAttempts = Math.max(1, Math.min(5, Number(attempts) || 3));
  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await healthFetcher(url);
    if (result?.ok === true) return { ...result, probeAttempts: attempt };
    if (attempt < maxAttempts) await wait(delayMs);
  }
  return { ...(result || { ok: false }), probeAttempts: maxAttempts };
}

function packageSummary() {
  const pkg = require(path.join(ROOT, "package.json"));
  return {
    scripts: pkg.scripts || {},
    dependencies: Object.keys(pkg.dependencies || {}).sort(),
    devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
  };
}

function gitSummary(commandRunner = run) {
  const branch = commandRunner("git", ["branch", "--show-current"]);
  const head = commandRunner("git", ["rev-parse", "HEAD"]);
  const origin = commandRunner("git", ["rev-parse", "origin/main"]);
  const status = commandRunner("git", ["status", "--short", "--branch"]);
  const ahead = status.ok
    ? /\[ahead\s+(\d+)/.exec(status.stdout)?.[1] || "0"
    : null;
  return {
    branch: branch.ok ? branch.stdout : null,
    head: head.ok ? head.stdout : null,
    originMain: origin.ok ? origin.stdout : null,
    ahead: ahead === null ? null : Number(ahead),
    status: status.ok ? status.stdout.split(/\r?\n/) : [],
  };
}

function inspectGithubCredentialFallback(commandRunner = run) {
  const result = commandRunner("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
  });
  if (!result.ok || !result.stdout) {
    return { available: false, provider: "git_credential" };
  }

  const fields = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    fields[line.slice(0, idx)] = line.slice(idx + 1);
  }

  return {
    available: Boolean(fields.password),
    provider: "git_credential",
    usernamePresent: Boolean(fields.username),
  };
}

async function buildSystemDoctorReport({
  healthUrl = null,
  env = process.env,
  includeHealth = true,
  commandRunner = run,
  healthFetcher = fetchHealth,
  healthProbeAttempts = 3,
  healthProbeDelayMs = 250,
  packageReader = packageSummary,
} = {}) {
  const commands = {};
  for (const command of ["git", "node", "npm", "ffmpeg", "ffprobe", "railway", "gh"]) {
    commands[command] = commandPath(command, commandRunner);
  }
  const railwayNpx = !commands.railway
    ? commandRunner("npx", ["@railway/cli", "--version"])
    : null;
  if (!commands.railway && railwayNpx?.ok) {
    commands.railway = `npx @railway/cli (${railwayNpx.stdout})`;
  }
  const githubAuth =
    commands.gh ? commandRunner("gh", ["auth", "status"]) : { ok: false, error: "gh missing" };
  const githubCredential =
    commands.git && commands.gh && !githubAuth.ok
      ? inspectGithubCredentialFallback(commandRunner)
      : { available: false, provider: "git_credential" };

  const resolvedHealthUrl = resolveSystemDoctorHealthUrl({ healthUrl, env });
  const health = includeHealth
    ? await fetchHealthWithRetry(resolvedHealthUrl, {
        healthFetcher,
        attempts: healthProbeAttempts,
        delayMs: healthProbeDelayMs,
      })
    : null;
  const pkg = packageReader();
  const git = gitSummary(commandRunner);

  const findings = [];
  const blockers = [];
  const green = [];
  const advisories = [];

  if (health?.ok && health.body?.status === "ok") {
    green.push("production_health_ok");
  } else if (includeHealth) {
    blockers.push("production_health_unavailable_or_not_ok");
  }

  if (!commands.railway) findings.push("railway_cli_unavailable");
  if (!commands.gh) findings.push("github_cli_unavailable");
  if (commands.gh && !githubAuth.ok && !githubCredential.available) {
    findings.push("github_cli_not_authenticated");
  }
  if (commands.gh && !githubAuth.ok && githubCredential.available) {
    advisories.push("github_cli_auth_not_persistent_using_git_credential_fallback");
    green.push("github_credential_fallback_available");
  }
  if (git.ahead && git.ahead > 0) findings.push(`local_branch_ahead_${git.ahead}`);
  if (commands.ffmpeg && commands.ffprobe) green.push("ffmpeg_available");
  if (commands.railway) green.push("railway_cli_available");
  if (pkg.scripts["ops:railway:health"]) green.push("railway_health_script_registered");

  const verdict = blockers.length ? "fail" : findings.length ? "review" : "pass";

  return {
    generatedAt: new Date().toISOString(),
    verdict,
    git,
    commands,
    githubAuth: {
      available: Boolean(commands.gh),
      authenticated: Boolean(githubAuth.ok),
      credentialFallbackAvailable: Boolean(githubCredential.available),
      detail: githubAuth.ok
        ? "authenticated"
        : githubCredential.available
          ? "not authenticated; git credential fallback available"
          : "not authenticated",
    },
    package: pkg,
    productionHealth: health
      ? {
          ok: health.ok,
          status: health.status,
          url: resolvedHealthUrl,
          probeAttempts: health.probeAttempts || null,
          commit: health.body?.build?.commit_short || null,
          deploymentId: health.body?.build?.deployment_id || null,
          schedulerActive: health.body?.schedulerActive,
          autonomousMode: health.body?.autonomousMode,
          dispatch: health.body?.runtime?.dispatch || null,
          sqlitePath: health.body?.runtime?.sqlite_db_path || null,
          sqlitePathLooksEphemeral:
            health.body?.runtime?.sqlite_db_path_looks_ephemeral ?? null,
        }
      : null,
    green,
    advisories,
    findings,
    blockers,
  };
}

function renderSystemDoctorMarkdown(report) {
  const lines = [
    "# Pulse System Doctor",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    "",
    "## Production",
    `- Health: ${report.productionHealth?.ok ? "ok" : "not ok / not checked"}`,
    `- Deployed commit: ${report.productionHealth?.commit || "unknown"}`,
    `- Scheduler active: ${report.productionHealth?.schedulerActive}`,
    `- Dispatch: ${report.productionHealth?.dispatch?.mode || "unknown"}`,
    "",
    "## Local Git",
    `- Branch: ${report.git.branch || "unknown"}`,
    `- Head: ${report.git.head || "unknown"}`,
    `- Origin main: ${report.git.originMain || "unknown"}`,
    `- Ahead: ${report.git.ahead ?? "unknown"}`,
    "",
    "## Commands",
    ...Object.entries(report.commands).map(
      ([name, found]) => `- ${name}: ${found ? "available" : "missing"}`,
    ),
    `- gh auth: ${
      report.githubAuth?.authenticated
        ? "authenticated"
        : report.githubAuth?.credentialFallbackAvailable
          ? "not persistent; git credential fallback available"
          : "not authenticated"
    }`,
    "",
    "## Advisories",
    ...(report.advisories?.length ? report.advisories.map((f) => `- ${f}`) : ["- none"]),
    "",
    "## Findings",
    ...(report.findings.length ? report.findings.map((f) => `- ${f}`) : ["- none"]),
    "",
    "## Blockers",
    ...(report.blockers.length ? report.blockers.map((f) => `- ${f}`) : ["- none"]),
  ];
  return lines.join("\n") + "\n";
}

async function writeSystemDoctorReport(outDir) {
  await fs.ensureDir(outDir);
  const report = await buildSystemDoctorReport();
  const jsonPath = path.join(outDir, "system_doctor.json");
  const mdPath = path.join(outDir, "system_doctor.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderSystemDoctorMarkdown(report), "utf8");
  return { report, jsonPath, mdPath };
}

module.exports = {
  buildSystemDoctorReport,
  fetchHealthWithRetry,
  inspectGithubCredentialFallback,
  resolveSystemDoctorHealthUrl,
  renderSystemDoctorMarkdown,
  writeSystemDoctorReport,
};
