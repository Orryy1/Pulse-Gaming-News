"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "tools", "governed-publication-review.js");
const STORY_ID = "official_ff567afb1a07";

test("CLI defaults to dry-run and writes JSON plus Markdown proof", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-review-cli-"),
  );
  const outDir = path.join(root, "proof");
  let received;
  const { run } = require("../../tools/governed-publication-review");
  const outcome = await run(
    [
      "--manifest",
      path.join(root, "review.json"),
      "--generated-at",
      "2026-07-27T12:00:00.000Z",
      "--out-dir",
      outDir,
    ],
    {},
    {
      execute: async (options) => {
        received = options;
        return {
          schema_version:
            "pulse-governed-publication-review-result-v1",
          generated_at: options.generatedAt,
          mode: "DRY_RUN",
          verdict: "VALID",
          mutated: false,
          idempotent: false,
          story_id: STORY_ID,
          channel_id: "pulse-gaming",
          script_sha256: "1".repeat(64),
          media_sha256: "2".repeat(64),
          review_manifest_sha256: "3".repeat(64),
          preflight_evidence: { artifact_evidence: {} },
          blockers: [],
          safety: {
            lifecycle_admission_performed: false,
            external_calls: [],
            uploads_performed: false,
            oauth_or_tokens_mutated: false,
            platform_objects_created: false,
          },
        };
      },
    },
  );

  assert.equal(received.apply, false);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result.mode, "DRY_RUN");
  assert.ok(fs.existsSync(outcome.result.artifacts.json));
  assert.ok(fs.existsSync(outcome.result.artifacts.markdown));
  assert.equal(
    JSON.parse(
      fs.readFileSync(outcome.result.artifacts.json, "utf8"),
    ).story_id,
    STORY_ID,
  );
  assert.match(
    fs.readFileSync(outcome.result.artifacts.markdown, "utf8"),
    /Publish or admission performed: no/,
  );
});

test("CLI fails closed on unknown flags", () => {
  const run = spawnSync(
    process.execPath,
    [CLI, "--manifest", "review.json", "--surprise"],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.notEqual(run.status, 0);
  const output = JSON.parse(run.stderr);
  assert.equal(output.verdict, "ERROR");
  assert.ok(output.errors.includes("unknown_flag:--surprise"));
});
