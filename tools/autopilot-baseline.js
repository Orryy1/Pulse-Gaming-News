#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { runMigrations } = require("../lib/migrate");
const { buildBaselineAudit } = require("../lib/runtime/baseline-audit");
const { assertExpectedCliVerdict } = require("../lib/ops/exact-cli-expectation");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "db", "migrations");

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stdout") {
      args.stdout = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((filename) => ({
      version: filename.slice(0, 3),
      filename,
      checksum: sha256(path.join(MIGRATIONS, filename)),
    }));
}

function git(...args) {
  return cp.execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trimEnd();
}

function gitState() {
  const branch = git("branch", "--show-current").trim();
  return {
    head: git("rev-parse", "HEAD").trim(),
    branch: branch || null,
    detached: !branch,
    status: git("status", "--porcelain=v1", "--untracked-files=all"),
  };
}

function appliedRows(db) {
  const table = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations' LIMIT 1",
  ).get();
  return table
    ? db.prepare("SELECT version, filename, checksum FROM schema_migrations ORDER BY version").all()
    : [];
}

function createFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-autopilot-baseline-"));
  if (fs.lstatSync(parent).isSymbolicLink()) throw new Error("fixture_root_symlink");
  const databasePath = path.join(parent, "pulse.db");
  const db = new Database(databasePath);
  try {
    runMigrations(db, { log: () => {} });
    return {
      databasePath,
      migrationRows: appliedRows(db),
      close() {
        db.close();
        fs.rmSync(parent, { recursive: true, force: true });
      },
    };
  } catch (error) {
    db.close();
    fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

function inspectProduction(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return { databasePath, migrationRows: appliedRows(db), close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}

function atomicWrite(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, body, { flag: "wx" });
  fs.renameSync(temp, file);
}

function markdown(audit) {
  return [
    "# Pulse GREEN autopilot baseline",
    "",
    `Result: **${audit.result}**`,
    "",
    `Database mode: ${audit.database.mode}`,
    `Database: ${audit.database.path}`,
    `Migrations: ${audit.database.migration_count}/${audit.database.committed_migration_count}`,
    `Highest migration: ${audit.database.highest_migration_version || "none"}`,
    `Git commit: ${audit.git.head}`,
    `Git branch: ${audit.git.branch || "DETACHED"}`,
    `Git clean: ${audit.git.clean}`,
    "",
    "## Blockers",
    "",
    ...(audit.blockers.length ? audit.blockers.map((value) => `- ${value}`) : ["- None"]),
    "",
    "## Pending",
    "",
    ...(audit.pending.length ? audit.pending.map((value) => `- ${value}`) : ["- None"]),
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const mode = String(args["database-mode"] || "").trim();
  if (!['fixture', 'production'].includes(mode)) {
    console.error("--database-mode fixture|production is required");
    return 64;
  }
  const expectedBranch = String(args["expected-branch"] || "").trim();
  if (!expectedBranch) {
    console.error("--expected-branch is required");
    return 64;
  }
  let inspected;
  try {
    if (mode === "production" && !String(args.database || process.env.SQLITE_DB_PATH || "").trim()) {
      throw new Error("production_database_path_required");
    }
    inspected = mode === "fixture"
      ? createFixture()
      : inspectProduction(path.resolve(String(args.database || process.env.SQLITE_DB_PATH)));
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    return 2;
  }
  try {
    const audit = buildBaselineAudit({
      databaseMode: mode,
      databasePath: inspected.databasePath,
      migrationFiles: migrationFiles(),
      migrationRows: inspected.migrationRows,
      gitState: gitState(),
      expectedBranch,
    });
    audit.artifact_identity = {
      repository_root: ROOT,
      migration_directory: MIGRATIONS,
      migration_directory_digest: crypto
        .createHash("sha256")
        .update(JSON.stringify(migrationFiles()))
        .digest("hex"),
    };
    const json = `${JSON.stringify(audit, null, 2)}\n`;
    if (args.stdout) process.stdout.write(json);
    if (args.out) {
      const out = path.resolve(args.out);
      const relative = path.relative(ROOT, out);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        throw new Error("baseline_output_inside_checkout");
      }
      atomicWrite(`${out}.json`, json);
      atomicWrite(`${out}.md`, `${markdown(audit)}\n`);
    }
    const expectation = assertExpectedCliVerdict({
      actual: audit.result,
      expected: args.expect,
      allowed: ["GREEN", "PENDING", "BLOCKED"],
      required: Boolean(args.expect),
    });
    if (!expectation.matched && args.expect) {
      console.error(`expected ${args.expect}, received ${audit.result}`);
    }
    return args.expect
      ? expectation.exitCode
      : audit.result === "GREEN"
        ? 0
        : 2;
  } finally {
    inspected.close();
  }
}

process.exitCode = main();
