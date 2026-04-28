"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildPlatformStatus,
  renderPlatformStatusMarkdown,
} = require("../lib/ops/platform-status");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function main() {
  await fs.ensureDir(OUT);
  const db = require("../lib/db");
  const stories = await db.getStories();
  let platformPosts = [];
  try {
    if (db.useSqlite()) {
      platformPosts = db
        .getDb()
        .prepare("SELECT * FROM platform_posts ORDER BY updated_at DESC, id DESC LIMIT 200")
        .all();
    }
  } catch {
    platformPosts = [];
  }
  const report = buildPlatformStatus({ stories, platformPosts });
  const jsonPath = path.join(OUT, "platform_status.json");
  const mdPath = path.join(OUT, "platform_status.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderPlatformStatusMarkdown(report), "utf8");
  console.log(`[platform-status] stories=${report.storyCount}`);
  console.log(`[platform-status] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[platform-status] md=${path.relative(ROOT, mdPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
