"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");
const { getPublicUrl } = require("../lib/deployment-mode");
const {
  buildTikTokAuthDoctorReport,
  probeTikTokClientCredentials,
  renderTikTokAuthDoctorMarkdown,
} = require("../lib/platforms/tiktok-auth-doctor");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function main() {
  await fs.ensureDir(OUT);
  const publicUrl = getPublicUrl();
  const liveProbe = process.argv.includes("--live-probe")
    ? await probeTikTokClientCredentials({ env: process.env })
    : null;
  const report = buildTikTokAuthDoctorReport({
    env: process.env,
    publicUrl,
    clientCredentialsProbe: liveProbe,
  });
  const jsonPath = path.join(OUT, "tiktok_auth_doctor.json");
  const mdPath = path.join(OUT, "tiktok_auth_doctor.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTikTokAuthDoctorMarkdown(report), "utf8");
  console.log(`[tiktok-auth-doctor] verdict=${report.verdict}`);
  if (liveProbe) {
    console.log(`[tiktok-auth-doctor] client_credentials_probe=${liveProbe.verdict}`);
  }
  console.log(`[tiktok-auth-doctor] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-auth-doctor] md=${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
