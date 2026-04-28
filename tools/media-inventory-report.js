"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildMediaInventoryReport,
  renderMediaInventoryMarkdown,
} = require("../lib/media-inventory");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function main() {
  await fs.ensureDir(OUT);
  const stories = await require("../lib/db").getStories();
  const report = buildMediaInventoryReport(stories);
  const jsonPath = path.join(OUT, "media_inventory_report.json");
  const mdPath = path.join(OUT, "media_inventory_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderMediaInventoryMarkdown(report), "utf8");
  console.log(`[media-inventory] stories=${report.items.length}`);
  console.log(`[media-inventory] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[media-inventory] md=${path.relative(ROOT, mdPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
