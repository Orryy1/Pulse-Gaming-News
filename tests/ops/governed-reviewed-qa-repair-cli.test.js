"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(
  ROOT,
  "tools",
  "governed-reviewed-qa-repair.js",
);
const STORY_ID = "official_reviewed_qa_repair";

test("reviewed QA repair CLI defaults to dry-run and writes proof artifacts", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-reviewed-qa-repair-cli-"),
  );
  t.after(() =>
    fs.rmSync(directory, { recursive: true, force: true }),
  );
  const outDir = path.join(directory, "proof");
  let received;
  const { run } = require("../../tools/governed-reviewed-qa-repair");
  const outcome = await run(
    [
      "--database",
      path.join(directory, "pulse.db"),
      "--backup-evidence",
      path.join(directory, "backup-evidence.json"),
      "--story-id",
      STORY_ID,
      "--generated-at",
      "2026-07-27T12:00:00.000Z",
      "--out-dir",
      outDir,
    ],
    {
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
      AUTO_PUBLISH: "false",
    },
    {
      execute: async (options) => {
        received = options;
        return {
          schema_version:
            "pulse-governed-reviewed-qa-repair-result-v1",
          generated_at: options.generatedAt,
          mode: "DRY_RUN",
          verdict: "READY",
          mutated: false,
          blockers: [],
          story_id: STORY_ID,
          channel_id: "pulse-gaming",
          platform: "youtube",
          scheduled_event_id: 9,
          scheduled_for: "2026-07-27T11:00:00.000Z",
          dispatch_idempotency_key:
            "youtube:official_reviewed_qa_repair:2026-07-27T11:00:00.000Z",
          request_fingerprint: "1".repeat(64),
          media_sha256: "2".repeat(64),
          script_sha256: "3".repeat(64),
          review_manifest_sha256: "4".repeat(64),
          qa_failures_before: [
            "legacy_unstamped_render_requires_rerender",
            "script_too_short (47 words, min 80)",
          ],
          qa_failures_resolved: [
            "legacy_unstamped_render_requires_rerender",
            "script_too_short (47 words, min 80)",
          ],
          backup: { backup_id: "fixture-backup" },
          repair: null,
          safety: {
            create_boundary_entered: false,
            external_object_created: false,
            platform_calls_performed: false,
            oauth_or_tokens_mutated: false,
            secondary_platforms_contacted: false,
          },
        };
      },
    },
  );

  assert.equal(received.apply, false);
  assert.equal(received.storyId, STORY_ID);
  assert.equal(
    received.env.PULSE_OPERATING_MODE,
    "HUMAN_REVIEW",
  );
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result.verdict, "READY");
  assert.ok(fs.existsSync(outcome.result.artifacts.json));
  assert.ok(fs.existsSync(outcome.result.artifacts.markdown));
  assert.equal(
    JSON.parse(
      fs.readFileSync(outcome.result.artifacts.json, "utf8"),
    ).story_id,
    STORY_ID,
  );
  const markdown = fs.readFileSync(
    outcome.result.artifacts.markdown,
    "utf8",
  );
  assert.match(markdown, /Verdict: READY/);
  assert.match(markdown, /Platform calls performed: no/);
  assert.match(markdown, /OAuth or token changes: no/);
});

test("reviewed QA repair CLI parses exact apply confirmations", () => {
  const {
    parseCliArgs,
  } = require("../../tools/governed-reviewed-qa-repair");
  const args = parseCliArgs([
    "--apply",
    "--database",
    "D:\\pulse-data\\pulse.db",
    "--confirm-database-path",
    "D:\\pulse-data\\pulse.db",
    "--backup-evidence",
    "backup.json",
    "--story-id",
    STORY_ID,
    "--expected-source-commit",
    "a".repeat(40),
    "--expected-runtime-commit",
    "a".repeat(40),
    "--confirm-story-id",
    STORY_ID,
    "--confirm-scheduled-event-id",
    "9",
    "--confirm-dispatch-idempotency-key",
    "youtube:key",
    "--confirm-request-fingerprint",
    "1".repeat(64),
    "--confirm-media-sha256",
    "2".repeat(64),
    "--confirm-script-sha256",
    "3".repeat(64),
    "--confirm-review-manifest-sha256",
    "4".repeat(64),
    "--actor-id",
    "user:MORR",
    "--confirm-actor-id",
    "user:MORR",
    "--reason",
    "Repair exact reviewed false positive",
    "--confirm-reason",
    "Repair exact reviewed false positive",
    "--change-window-id",
    "reviewed-qa-repair-window",
    "--confirm-change-window-id",
    "reviewed-qa-repair-window",
  ]);

  assert.equal(args.apply, true);
  assert.equal(args.confirmScheduledEventId, 9);
  assert.equal(args.confirmRequestFingerprint, "1".repeat(64));
  assert.equal(args.expectedSourceCommit, "a".repeat(40));
  assert.equal(args.expectedRuntimeCommit, "a".repeat(40));
  assert.equal(
    args.confirmDatabasePath,
    "D:\\pulse-data\\pulse.db",
  );
  assert.equal(args.confirmActorId, "user:MORR");
  assert.equal(
    args.confirmChangeWindowId,
    "reviewed-qa-repair-window",
  );
});

test("reviewed QA repair CLI fails closed on unknown flags", () => {
  const outcome = spawnSync(
    process.execPath,
    [
      CLI,
      "--database",
      "pulse.db",
      "--story-id",
      STORY_ID,
      "--surprise",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.notEqual(outcome.status, 0);
  const error = JSON.parse(outcome.stderr);
  assert.equal(error.verdict, "ERROR");
  assert.ok(error.errors.includes("unknown_flag:--surprise"));
});

test("reviewed QA repair CLI proves the output path before executing a mutation", async () => {
  const { run } = require("../../tools/governed-reviewed-qa-repair");
  let executed = false;
  await assert.rejects(
    run(
      [
        "--apply",
        "--database",
        "D:\\pulse-data\\pulse.db",
        "--story-id",
        STORY_ID,
      ],
      {},
      {
        preflightArtifacts() {
          throw new Error("artifact_output_not_writable");
        },
        async execute() {
          executed = true;
          return {};
        },
      },
    ),
    /artifact_output_not_writable/,
  );
  assert.equal(executed, false);
});

test("reviewed QA repair CLI preserves an APPLIED result if proof writing later fails", async () => {
  const { run } = require("../../tools/governed-reviewed-qa-repair");
  const outcome = await run(
    [
      "--apply",
      "--database",
      "D:\\pulse-data\\pulse.db",
      "--story-id",
      STORY_ID,
    ],
    {},
    {
      preflightArtifacts() {},
      async execute() {
        return {
          schema_version:
            "pulse-governed-reviewed-qa-repair-result-v1",
          generated_at: "2026-07-27T20:00:00.000Z",
          mode: "APPLY",
          verdict: "APPLIED",
          mutated: true,
          story_id: STORY_ID,
          blockers: [],
          safety: {
            create_boundary_entered: false,
            external_object_created: false,
            platform_calls_performed: false,
            oauth_or_tokens_mutated: false,
            secondary_platforms_contacted: false,
          },
        };
      },
      writeArtifacts() {
        throw new Error("fixture_disk_full");
      },
    },
  );

  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.result.verdict, "APPLIED");
  assert.equal(outcome.result.mutated, true);
  assert.equal(outcome.result.artifact_write_failed, true);
  assert.equal(outcome.result.artifact_error, "fixture_disk_full");
});

test("reviewed QA repair Markdown renders unknown historical state explicitly", () => {
  const {
    renderMarkdown,
  } = require("../../tools/governed-reviewed-qa-repair");
  const markdown = renderMarkdown({
    generated_at: "2026-07-27T20:00:00.000Z",
    mode: "APPLY",
    verdict: "HOLD",
    mutated: false,
    blockers: ["database_boundary_changed"],
    safety: {
      create_boundary_entered: null,
      external_object_created: null,
      platform_calls_performed: false,
      oauth_or_tokens_mutated: false,
      secondary_platforms_contacted: false,
    },
  });
  assert.match(markdown, /Create boundary entered: unknown/);
  assert.match(markdown, /External object created: unknown/);
});
