"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { verifyMedia, renderMediaVerifyMarkdown } = require("../lib/ops/media-verify");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function main() {
  await fs.ensureDir(OUT);
  const db = require("../lib/db");
  const stories = await db.getStories();
  const report = await verifyMedia({ stories });
  const jsonPath = path.join(OUT, "media_verify.json");
  const mdPath = path.join(OUT, "media_verify.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderMediaVerifyMarkdown(report), "utf8");
  console.log(`[media-verify] verdict=${report.verdict}`);
  console.log(`[media-verify] issues=${report.issueCount}`);
  console.log(`[media-verify] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[media-verify] md=${path.relative(ROOT, mdPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
