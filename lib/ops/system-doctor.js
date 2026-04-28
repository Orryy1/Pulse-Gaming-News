"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_HEALTH_URL =
  "https://marvelous-curiosity-production.up.railway.app/api/health";

function run(cmd, args = []) {
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
      stdio: ["ignore", "pipe", "pipe"],
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

function commandPath(command) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const result = run(process.platform === "win32" ? "where" : "which", [
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

function packageSummary() {
  const pkg = require(path.join(ROOT, "package.json"));
  return {
    scripts: pkg.scripts || {},
    dependencies: Object.keys(pkg.dependencies || {}).sort(),
    devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
  };
}

function gitSummary() {
  const branch = run("git", ["branch", "--show-current"]);
  const head = run("git", ["rev-parse", "HEAD"]);
  const origin = run("git", ["rev-parse", "origin/main"]);
  const status = run("git", ["status", "--short", "--branch"]);
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

async function buildSystemDoctorReport({
  healthUrl = DEFAULT_HEALTH_URL,
  includeHealth = true,
} = {}) {
  const commands = {};
  for (const command of ["git", "node", "npm", "ffmpeg", "ffprobe", "railway", "gh"]) {
    commands[command] = commandPath(command);
  }
  const railwayNpx = !commands.railway
    ? run("npx", ["@railway/cli", "--version"])
    : null;
  if (!commands.railway && railwayNpx?.ok) {
    commands.railway = `npx @railway/cli (${railwayNpx.stdout})`;
  }
  const githubAuth =
    commands.gh ? run("gh", ["auth", "status"]) : { ok: false, error: "gh missing" };

  const health = includeHealth ? await fetchHealth(healthUrl) : null;
  const pkg = packageSummary();
  const git = gitSummary();

  const findings = [];
  const blockers = [];
  const green = [];

  if (health?.ok && health.body?.status === "ok") {
    green.push("production_health_ok");
  } else if (includeHealth) {
    blockers.push("production_health_unavailable_or_not_ok");
  }

  if (!commands.railway) findings.push("railway_cli_unavailable");
  if (!commands.gh) findings.push("github_cli_unavailable");
  if (commands.gh && !githubAuth.ok) findings.push("github_cli_not_authenticated");
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
      detail: githubAuth.ok ? "authenticated" : "not authenticated",
    },
    package: pkg,
    productionHealth: health
      ? {
          ok: health.ok,
          status: health.status,
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
    `- gh auth: ${report.githubAuth?.authenticated ? "authenticated" : "not authenticated"}`,
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
  renderSystemDoctorMarkdown,
  writeSystemDoctorReport,
};
