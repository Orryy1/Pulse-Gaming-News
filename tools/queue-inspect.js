"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { inspectQueue, renderQueueInspectMarkdown } = require("../lib/ops/queue-inspect");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function isUnixVolumePathOnWindows(dbPath) {
  return process.platform === "win32" && /^\/[^/\\]/.test(String(dbPath || ""));
}

async function main() {
  await fs.ensureDir(OUT);
  let report;
  try {
    const dbModule = require("../lib/db");
    if (!dbModule.useSqlite()) {
      report = { generatedAt: new Date().toISOString(), verdict: "skip", reason: "USE_SQLITE_not_enabled" };
    } else if (isUnixVolumePathOnWindows(dbModule.DB_PATH)) {
      report = {
        generatedAt: new Date().toISOString(),
        verdict: "skip",
        reason: "railway_volume_path_not_local",
        dbPath: dbModule.DB_PATH,
      };
    } else if (!(await fs.pathExists(dbModule.DB_PATH))) {
      report = {
        generatedAt: new Date().toISOString(),
        verdict: "skip",
        reason: "sqlite_db_missing",
        dbPath: dbModule.DB_PATH,
      };
    } else {
      const Database = require("better-sqlite3");
      const sqlite = new Database(dbModule.DB_PATH, { readonly: true, fileMustExist: true });
      try {
        report = {
          ...inspectQueue({ db: sqlite }),
          dbPath: dbModule.DB_PATH,
          readOnly: true,
        };
      } finally {
        sqlite.close();
      }
    }
  } catch (err) {
    report = { generatedAt: new Date().toISOString(), verdict: "skip", reason: err.message };
  }
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
