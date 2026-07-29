#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const axios = require("axios");
const dotenv = require("dotenv");
const {
  safeRedirectConfig,
} = require("../lib/safe-url");
const {
  loadDotenvOnce,
} = require("../lib/stabilisation/runtime-config");
const {
  createElevenLabsCreditGovernor,
} = require("../lib/services/elevenlabs-credit-governor");
const {
  buildElevenLabsCreditMonitorArtifact,
} = require("../lib/services/elevenlabs-credit-monitor");

const ROOT = path.resolve(__dirname, "..");

async function writeAtomic(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function markdown(artifact) {
  return [
    "# ElevenLabs credit status",
    "",
    `- Verdict: ${artifact.verdict}`,
    `- Plan: ${artifact.subscription.tier || "unknown"} (${artifact.subscription.status || "unknown"})`,
    `- Included credits: ${artifact.included_credits.remaining.toLocaleString("en-GB")} remaining of ${artifact.included_credits.limit.toLocaleString("en-GB")} (${artifact.included_credits.remaining_percent.toFixed(2)}%)`,
    `- Protected reserve: ${artifact.included_credits.hard_reserve.toLocaleString("en-GB")}`,
    `- Safely spendable before reserve: ${artifact.included_credits.safe_spendable.toLocaleString("en-GB")}`,
    `- Next reset: ${artifact.next_reset_at || "unknown"}`,
    `- Account overage permitted externally: ${artifact.subscription.external_overage_enabled ? "yes" : "no"}`,
    `- Pulse permits overage: ${artifact.subscription.local_overage_allowed ? "yes" : "no"}`,
    "",
    "## Conservative capacity",
    "",
    `- 750-character Shorts: ${artifact.capacity.short_750_characters.safe_renders}`,
    `- 10,000-character longforms: ${artifact.capacity.longform_10000_characters.safe_renders}`,
    "",
    "## Warnings",
    "",
    ...(artifact.warnings.length
      ? artifact.warnings.map((warning) => `- ${warning}`)
      : ["- None"]),
    "",
    "## Actions",
    "",
    ...(artifact.actions.length
      ? artifact.actions.map((action) => `- ${action}`)
      : ["- None"]),
    "",
  ].join("\n");
}

async function main() {
  loadDotenvOnce({ dotenv, env: process.env });
  const governor = createElevenLabsCreditGovernor({
    env: process.env,
    request: (input) =>
      axios({
        ...input,
        validateStatus: () => true,
        ...safeRedirectConfig(0),
        maxBodyLength: 256 * 1024,
        maxContentLength: 2 * 1024 * 1024,
      }),
  });
  const report = await governor.status({ force: true });
  const artifact = buildElevenLabsCreditMonitorArtifact(report);
  const outputRoot = path.resolve(
    process.env.PULSE_OPS_OUTPUT_ROOT ||
      path.join(ROOT, "output", "ops"),
  );
  const jsonPath = path.join(
    outputRoot,
    "elevenlabs-credit-status.json",
  );
  const markdownPath = path.join(
    outputRoot,
    "elevenlabs-credit-status.md",
  );
  await writeAtomic(
    jsonPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  await writeAtomic(markdownPath, markdown(artifact));
  process.stdout.write(
    `${JSON.stringify({
      verdict: artifact.verdict,
      remaining: artifact.included_credits.remaining,
      remaining_percent:
        artifact.included_credits.remaining_percent,
      safe_spendable:
        artifact.included_credits.safe_spendable,
      hard_reserve: artifact.included_credits.hard_reserve,
      next_reset_at: artifact.next_reset_at,
      json_path: jsonPath,
      markdown_path: markdownPath,
    })}\n`,
  );
  if (artifact.verdict === "BLOCKED") process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(
    `[elevenlabs-credit-status] ${String(
      error?.code || error?.message || "failed",
    )}\n`,
  );
  process.exitCode = 1;
});
