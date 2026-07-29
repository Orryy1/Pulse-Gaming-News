"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(
  ROOT,
  "tools",
  "multi-lane-activation-evidence.js",
);

test("CLI writes blocked JSON and Markdown when no exact artefact index is supplied", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-evidence-cli-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        TOOL,
        "--output-dir",
        directory,
        "--now",
        "2026-07-28T12:00:00.000Z",
        "--json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.equal(
      evidence.schema_version,
      "pulse-multi-lane-activation-evidence-v2",
    );
    assert.equal(evidence.collection.verdict, "BLOCKED");
    assert.ok(
      evidence.collection.blockers.includes(
        "activation_artifact_index_required",
      ),
    );
    const jsonPath = path.join(
      directory,
      "multi_lane_activation_evidence.json",
    );
    const markdownPath = path.join(
      directory,
      "multi_lane_activation_evidence.md",
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(jsonPath, "utf8")),
      evidence,
    );
    assert.match(
      fs.readFileSync(markdownPath, "utf8"),
      /does not prove an external publication/i,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI implementation has no network, database, token, OAuth, publisher or process-spawn action path", () => {
  const source = fs.readFileSync(TOOL, "utf8");
  assert.doesNotMatch(source, /require\(["']dotenv["']\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /require\(["'](?:node:)?https?["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/lib\/db["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/publisher["']\)/);
  assert.doesNotMatch(
    source,
    /require\(["'](?:node:)?child_process["']\)/,
  );
  assert.doesNotMatch(source, /tokens[\\/]/i);
});

test("activation evidence collection has a stable operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:multi-lane-activation-evidence"],
    "node tools/multi-lane-activation-evidence.js",
  );
});
