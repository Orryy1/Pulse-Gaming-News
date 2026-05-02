#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");
const {
  fetchTikTokAuthRedirect,
  renderTikTokAuthLinkHtml,
  defaultOutputPath,
} = require("../lib/platforms/tiktok-auth-link");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const plan = await fetchTikTokAuthRedirect({ env: process.env });
  const outPath = defaultOutputPath(ROOT);
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, renderTikTokAuthLinkHtml(plan), "utf8");
  console.log(`[tiktok-auth-link] wrote ${path.relative(ROOT, outPath)}`);
  console.log(`[tiktok-auth-link] expires_in_minutes=${plan.expiresInMinutes}`);
  console.log("[tiktok-auth-link] open the HTML file and click the button while the local server is running");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tiktok-auth-link] ${err.message || err}`);
    process.exitCode = 1;
  });
}
