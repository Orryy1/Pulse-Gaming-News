"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "tools", "governed-story-intake.js");
const SOURCE_URL =
  "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947";
const STORY_ID = "official_ff567afb1a07";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-intake-cli-"));
  const sourcePath = path.join(root, "source.json");
  const claims = [
    "Thirty-day bans now qualify victims for compensation.",
    "Compensation mail should arrive within three business days.",
  ];
  writeJson(sourcePath, {
    schema_version: "pulse-source-evidence-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    published_at: "2026-07-27T09:15:34.000Z",
    claims,
  });
  const manifestPath = path.join(root, "intake.json");
  writeJson(manifestPath, {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    source_evidence_path: "source.json",
    source_evidence_sha256: sha256(fs.readFileSync(sourcePath)),
    published_at: "2026-07-27T09:15:34.000Z",
    claims,
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: STORY_ID,
      title: "Delta Force widens cheater compensation",
      hook: "Delta Force just widened cheater compensation.",
      full_script: SCRIPT,
      script_sha256: sha256(SCRIPT),
    },
  });
  return { root, manifestPath, outDir: path.join(root, "proof") };
}

test("CLI defaults to dry-run, emits JSON and writes machine-readable proof", () => {
  const values = fixture();
  const run = spawnSync(
    process.execPath,
    [
      CLI,
      "ingest",
      "--manifest",
      values.manifestPath,
      "--generated-at",
      "2026-07-27T12:00:00.000Z",
      "--out-dir",
      values.outDir,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.mode, "DRY_RUN");
  assert.equal(output.verdict, "VALID");
  assert.equal(output.story_id, STORY_ID);
  assert.ok(fs.existsSync(output.artifacts.json));
  assert.ok(fs.existsSync(output.artifacts.markdown));
  assert.equal(
    JSON.parse(fs.readFileSync(output.artifacts.json, "utf8")).story_id,
    STORY_ID,
  );
});

test("CLI fails closed on unknown flags and never treats them as positional values", () => {
  const values = fixture();
  const run = spawnSync(
    process.execPath,
    [CLI, "ingest", "--manifest", values.manifestPath, "--surprise"],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.notEqual(run.status, 0);
  const output = JSON.parse(run.stderr);
  assert.ok(output.errors.includes("unknown_flag:--surprise"));
});

test("package exposes the governed story-intake operator command", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    pkg.scripts["ops:story-intake"],
    "node tools/governed-story-intake.js",
  );
});
