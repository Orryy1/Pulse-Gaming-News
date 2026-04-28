"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const dotenv = require("dotenv");

const {
  DEFAULT_PUBLIC_HEALTH_URL,
  buildRailwayHealthReport,
  parseRailwayJsonLines,
  renderRailwayHealthMarkdown,
} = require("../lib/ops/railway-health");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "test", "output");

function railwayCommand() {
  if (process.env.RAILWAY_BIN) {
    return { cmd: process.env.RAILWAY_BIN, prefixArgs: [] };
  }
  const homeExe = path.join(process.env.USERPROFILE || "", "railway.exe");
  if (homeExe && require("node:fs").existsSync(homeExe)) {
    return { cmd: homeExe, prefixArgs: [] };
  }
  return { cmd: "npx", prefixArgs: ["-y", "@railway/cli"] };
}

function runRailway(args, { optional = false } = {}) {
  const railway = railwayCommand();
  try {
    const buffer = execFileSync(railway.cmd, [...railway.prefixArgs, ...args], {
      cwd: ROOT,
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return buffer.toString("utf8").replace(/\u0000/g, "");
  } catch (err) {
    if (optional) return "";
    const stderr = Buffer.isBuffer(err.stderr)
      ? err.stderr.toString("utf8")
      : String(err.stderr || err.message || err);
    throw new Error(`railway ${args.join(" ")} failed: ${stderr.trim()}`);
  }
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function loadHealthUrl() {
  const envPath = path.join(ROOT, ".env");
  let parsed = {};
  if (require("node:fs").existsSync(envPath)) {
    parsed = dotenv.parse(require("node:fs").readFileSync(envPath));
  }
  const candidate =
    process.env.RAILWAY_HEALTH_URL ||
    process.env.RAILWAY_PUBLIC_URL ||
    parsed.RAILWAY_HEALTH_URL ||
    parsed.RAILWAY_PUBLIC_URL ||
    "";
  const clean = String(candidate).trim().replace(/\/$/, "");
  if (!clean || /^https?:\/\/localhost(?::\d+)?$/i.test(clean)) {
    return DEFAULT_PUBLIC_HEALTH_URL;
  }
  if (/\/api\/health$/i.test(clean)) return clean;
  return `${clean}/api/health`;
}

async function fetchHealth(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
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
    clearTimeout(timeout);
  }
}

async function main() {
  await fs.ensureDir(OUTPUT_DIR);

  const deployments = JSON.parse(runRailway(["deployment", "list", "--limit", "5", "--json"]));
  const appLogs = parseRailwayJsonLines(
    runRailway(["logs", "--lines", "200", "--json", "--latest"], { optional: true }),
  );
  const buildLogs = parseRailwayJsonLines(
    runRailway(["logs", "--build", "--lines", "200", "--json", "--latest"], {
      optional: true,
    }),
  );
  const httpLogs = parseRailwayJsonLines(
    runRailway(["logs", "--http", "--lines", "120", "--json"], { optional: true }),
  );
  const health = await fetchHealth(loadHealthUrl());

  const report = buildRailwayHealthReport({
    deployments,
    health,
    appLogs,
    buildLogs,
    httpLogs,
    expectedCommit: gitHead(),
  });

  const jsonPath = path.join(OUTPUT_DIR, "railway_health_check.json");
  const mdPath = path.join(OUTPUT_DIR, "railway_health_check.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderRailwayHealthMarkdown(report), "utf8");

  console.log(`[railway-health] verdict: ${report.verdict}`);
  console.log(`[railway-health] deployment: ${report.latestDeployment?.id || "unknown"}`);
  console.log(`[railway-health] commit: ${report.latestDeployment?.commitHash || "unknown"}`);
  console.log(`[railway-health] hard fails: ${report.hardFails.length}`);
  console.log(`[railway-health] warnings: ${report.warnings.length}`);
  console.log(`[railway-health] json: ${path.relative(ROOT, jsonPath)}`);
  console.log(`[railway-health] md:   ${path.relative(ROOT, mdPath)}`);

  if (report.verdict === "fail") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
