#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  buildLocalTunnelReadiness,
  formatLocalTunnelReadinessMarkdown,
} = require("../lib/ops/local-tunnel-readiness");
const { fetchJson } = require("../lib/ops/local-primary-readiness");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function hasFlag(name) {
  return process.argv.includes(name);
}

function readIfExists(filePath) {
  try {
    if (!fs.pathExistsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function execReadOnly(command, args, timeout = 15000) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      }),
      stderr: "",
    };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout ? String(err.stdout) : "",
      stderr: err.stderr ? String(err.stderr) : err.message || String(err),
    };
  }
}

function resolveCloudflaredPath() {
  const found = execReadOnly("where.exe", ["cloudflared"], 5000);
  return found.stdout.split(/\r?\n/).find(Boolean) || "";
}

async function main() {
  const jsonOnly = hasFlag("--json");
  const configPath =
    process.env.PULSE_CLOUDFLARED_CONFIG || "D:/pulse-data/cloudflared-pulse.yml";
  const configText = readIfExists(configPath);
  const tunnelId = configText.match(/^\s*tunnel:\s*([^\r\n#]+)/m)?.[1]?.trim() || "";
  const credentialsFile =
    configText.match(/^\s*credentials-file:\s*([^\r\n#]+)/m)?.[1]?.trim() || "";
  const cloudflaredPath = resolveCloudflaredPath();
  const version = execReadOnly("cloudflared", ["--version"], 5000);
  const tunnelInfo = tunnelId
    ? execReadOnly("cloudflared", ["tunnel", "info", tunnelId], 15000)
    : { stdout: "", stderr: "" };
  const localHealth = await fetchJson("http://localhost:3001/api/health");
  const publicHealth = await fetchJson("https://pulse.orryy.com/api/health");
  const report = buildLocalTunnelReadiness({
    configText,
    configPath,
    cloudflaredPath,
    cloudflaredVersionOutput: version.stdout || version.stderr,
    credentialsExists: credentialsFile ? fs.pathExistsSync(credentialsFile) : false,
    localHealth,
    publicHealth,
    tunnelInfo: `${tunnelInfo.stdout}\n${tunnelInfo.stderr}`.trim(),
  });
  const markdown = formatLocalTunnelReadinessMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "local_tunnel_readiness.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "local_tunnel_readiness.md"), markdown);
  await fs.writeFile(path.join(ROOT, "LOCAL_TUNNEL_READINESS.md"), markdown);

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(markdown);
  }
  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-tunnel-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
