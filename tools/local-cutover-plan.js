#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  buildLocalCutoverPlan,
  formatLocalCutoverPlanMarkdown,
} = require("../lib/ops/local-cutover-plan");
const { fetchJson } = require("../lib/ops/local-primary-readiness");

function readIfExists(filePath) {
  try {
    if (!fs.pathExistsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function runCloudflaredInfo(tunnelId) {
  if (!tunnelId) return "";
  try {
    return execFileSync("cloudflared", ["tunnel", "info", tunnelId], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
  } catch (err) {
    const stdout = err.stdout ? String(err.stdout) : "";
    const stderr = err.stderr ? String(err.stderr) : "";
    return `${stdout}\n${stderr}`.trim();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const outputDir = path.join(process.cwd(), "test", "output");
  const envText = readIfExists(path.join(process.cwd(), ".env"));
  const defaultConfigPath = path.join(
    process.env.USERPROFILE || "",
    ".cloudflared",
    "config.yml",
  );
  const pulseConfigPath =
    process.env.PULSE_CLOUDFLARED_CONFIG || "D:/pulse-data/cloudflared-pulse.yml";
  const defaultCloudflaredConfigText = readIfExists(defaultConfigPath);
  const pulseCloudflaredConfigText = readIfExists(pulseConfigPath);
  const tunnelId =
    pulseCloudflaredConfigText.match(/^\s*tunnel:\s*([^\r\n#]+)/m)?.[1]?.trim() ||
    "";
  const localHealth = await fetchJson("http://localhost:3001/api/health");
  const publicHealth = await fetchJson("https://pulse.orryy.com/api/health");
  const tunnelInfo = runCloudflaredInfo(tunnelId);
  const plan = buildLocalCutoverPlan({
    envText,
    defaultCloudflaredConfigText,
    pulseCloudflaredConfigText,
    localHealth,
    publicHealth,
    tunnelInfo,
    pulseConfigPath,
  });

  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "local_cutover_plan.json");
  const mdPath = path.join(outputDir, "local_cutover_plan.md");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, formatLocalCutoverPlanMarkdown(plan));

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else {
    process.stdout.write(formatLocalCutoverPlanMarkdown(plan) + "\n");
    process.stderr.write(`[local-cutover-plan] json=${jsonPath}\n`);
    process.stderr.write(`[local-cutover-plan] md=${mdPath}\n`);
  }
  if (plan.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-cutover-plan] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { readIfExists, runCloudflaredInfo };
