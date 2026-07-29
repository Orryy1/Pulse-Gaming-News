#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const Database = require("better-sqlite3");

const {
  readGovernedYoutubeWindowInventoryReport,
  renderGovernedYoutubeWindowInventoryMarkdown,
} = require("../lib/services/governed-youtube-window-inventory-monitor");

function parseArgs(argv = []) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

async function atomicWrite(filename, contents) {
  await fs.ensureDir(path.dirname(filename));
  const temporary = `${filename}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, filename);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dbPath = path.resolve(
    String(args.db || process.env.SQLITE_DB_PATH || "").trim(),
  );
  if (!String(args.db || process.env.SQLITE_DB_PATH || "").trim()) {
    throw new Error(
      "window_inventory_db_path_required_use_--db_or_SQLITE_DB_PATH",
    );
  }
  if (!(await fs.pathExists(dbPath))) {
    throw new Error(`window_inventory_db_not_found:${dbPath}`);
  }
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  let report;
  try {
    db.pragma("query_only = ON");
    report = readGovernedYoutubeWindowInventoryReport({
      db,
      now: args.now || new Date(),
      horizonHours: Number(args["horizon-hours"] || 36),
    });
  } finally {
    db.close();
  }
  const outDir = path.resolve(
    String(
      args["out-dir"] ||
        path.join(
          __dirname,
          "..",
          "output",
          "window-inventory",
        ),
    ),
  );
  const jsonPath = path.join(
    outDir,
    "governed-youtube-window-inventory.json",
  );
  const markdownPath = path.join(
    outDir,
    "governed-youtube-window-inventory.md",
  );
  await atomicWrite(
    jsonPath,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await atomicWrite(
    markdownPath,
    renderGovernedYoutubeWindowInventoryMarkdown(report),
  );
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      verdict: report.verdict,
      next_window: report.next_window?.scheduled_for || null,
      coverage_status:
        report.next_window?.coverage_status || null,
      json: jsonPath,
      markdown: markdownPath,
      database_mutated: false,
      external_posting: false,
    })}\n`,
  );
  return { report, jsonPath, markdownPath };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[governed-youtube-window-inventory] ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
};
