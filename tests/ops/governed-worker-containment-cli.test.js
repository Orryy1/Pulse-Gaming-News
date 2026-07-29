"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  parseCliArgs,
  run,
  usage,
} = require("../../tools/governed-worker-containment");

test("CLI defaults to inspect, rejects ambiguous mode flags and documents every irreversible confirmation", async (t) => {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-worker-containment-cli-"),
  );
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const databasePath = path.join(outDir, "pulse.db");
  let received;
  const outcome = await run(
    [
      "--database",
      databasePath,
      "--generated-at",
      "2026-07-27T16:30:00.000Z",
      "--out-dir",
      outDir,
    ],
    {},
    {
      execute: async (options) => {
        received = options;
        return {
          schema_version:
            "pulse-governed-worker-containment-result-v1",
          generated_at: options.generatedAt,
          mode: "INSPECT",
          verdict: "INSPECTED",
          mutated: false,
          idempotent: false,
          database_path: databasePath,
          blockers: [],
          inspection: {
            target_worker_ids: ["worker-a"],
            active_runtime_lease_count: 0,
            claimed_or_running_job_count: 0,
          },
          change: null,
          safety: {
            external_calls: [],
            oauth_or_tokens_mutated: false,
            platform_objects_created: false,
          },
        };
      },
    },
  );

  assert.equal(received.apply, false);
  assert.equal(outcome.exitCode, 0);
  assert.ok(fs.existsSync(outcome.result.artifacts.json));
  assert.ok(fs.existsSync(outcome.result.artifacts.markdown));
  assert.match(
    fs.readFileSync(outcome.result.artifacts.markdown, "utf8"),
    /Target workers: 1/,
  );

  assert.throws(
    () => parseCliArgs(["--apply", "--inspect"]),
    /governed_worker_containment_cli_arguments_invalid/,
  );
  const help = usage();
  for (const flag of [
    "--confirm-database-path",
    "--backup-evidence",
    "--confirm-actor-id",
    "--confirm-reason",
    "--confirm-change-window-id",
    "--confirm-scheduler-stopped",
    "--confirm-workers-stopped",
    "--confirm-worker-containment",
  ]) {
    assert.match(help, new RegExp(flag));
  }
  assert.match(
    help,
    /I CONFIRM PULSE SCHEDULER AND WORKERS ARE STOPPED; SET ACTIVE WORKERS OFFLINE/,
  );
});

test("CLI rejects unknown flags instead of silently broadening authority", () => {
  assert.throws(
    () => parseCliArgs(["--database", "pulse.db", "--force"]),
    (error) =>
      error.message ===
        "governed_worker_containment_cli_arguments_invalid" &&
      error.codes.includes("unknown_flag:--force"),
  );
});
