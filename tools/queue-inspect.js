"use strict";

require("dotenv").config({ override: true });

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildQueueReport,
  renderQueueInspectMarkdown,
} = require("../lib/ops/queue-inspect");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function main() {
  await fs.ensureDir(OUT);
  const report = await buildQueueReport();
  const jsonPath = path.join(OUT, "queue_inspect.json");
  const mdPath = path.join(OUT, "queue_inspect.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderQueueInspectMarkdown(report), "utf8");
  console.log(`[queue-inspect] verdict=${report.verdict}`);
  console.log(`[queue-inspect] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[queue-inspect] md=${path.relative(ROOT, mdPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
