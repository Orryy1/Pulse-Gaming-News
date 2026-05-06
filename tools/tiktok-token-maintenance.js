"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

const {
  inspectTokenStatus,
  refreshToken,
  resolveTokenPath,
} = require("../upload_tiktok");
const {
  buildTikTokTokenMaintenancePlan,
  renderTikTokTokenMaintenanceMarkdown,
  sanitiseTokenStatus,
} = require("../lib/platforms/tiktok-token-maintenance");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = process.argv.slice(2)) {
  return {
    refresh: argv.includes("--refresh"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--refresh"),
  };
}

async function readRefreshTokenSafely() {
  const tokenPath = resolveTokenPath();
  const data = await fs.readJson(tokenPath);
  if (typeof data.refresh_token !== "string" || data.refresh_token.length < 8) {
    throw new Error("TikTok token file has no usable refresh_token");
  }
  return data.refresh_token;
}

async function runMaintenance(options = {}) {
  await fs.ensureDir(OUT);
  const beforeRaw = await inspectTokenStatus();
  const before = sanitiseTokenStatus(beforeRaw);
  const initialPlan = buildTikTokTokenMaintenancePlan(beforeRaw, {
    allowRefresh: options.refresh === true,
  });

  const report = {
    generated_at: new Date().toISOString(),
    mode: options.refresh === true ? "refresh_local_token" : "dry_run",
    token_path: resolveTokenPath(),
    verdict: initialPlan.verdict,
    action: initialPlan.action,
    reason: initialPlan.reason,
    before,
    after: null,
    refreshed: false,
    safety: {
      printsToken: false,
      startsOAuth: false,
      uploadsToTikTok: false,
      mutatesRailwayEnv: false,
      mutatesProductionDb: false,
    },
  };

  console.log(`[tiktok-token] before ok=${before.ok} reason=${before.reason}`);
  console.log(`[tiktok-token] action=${initialPlan.action}`);

  if (initialPlan.action === "refresh_local_token") {
    const refresh = await readRefreshTokenSafely();
    await refreshToken(refresh);
    report.refreshed = true;
    report.after = sanitiseTokenStatus(await inspectTokenStatus());
    const finalPlan = buildTikTokTokenMaintenancePlan(report.after, {
      allowRefresh: false,
    });
    report.verdict = finalPlan.verdict;
    report.action = finalPlan.action;
    report.reason = finalPlan.reason;
    console.log(
      `[tiktok-token] after ok=${report.after.ok} reason=${report.after.reason} expires_in_seconds=${report.after.expires_in_seconds}`,
    );
  }

  const jsonPath = path.join(OUT, "tiktok_token_maintenance.json");
  const mdPath = path.join(OUT, "tiktok_token_maintenance.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTikTokTokenMaintenanceMarkdown(report), "utf8");
  console.log(`[tiktok-token] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-token] md=${path.relative(ROOT, mdPath)}`);

  if (report.verdict === "red") process.exitCode = 1;
  return report;
}

if (require.main === module) {
  runMaintenance(parseArgs()).catch((err) => {
    console.error(`[tiktok-token] ERROR: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runMaintenance,
};
