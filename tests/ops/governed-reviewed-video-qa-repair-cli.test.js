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
} = require("../../tools/governed-reviewed-video-qa-repair");

test("video-QA repair CLI defaults to dry-run and writes JSON plus Markdown proof", async (t) => {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-video-qa-repair-cli-"),
  );
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  let received = null;
  const outcome = await run(
    [
      "--database",
      "pulse.db",
      "--story-id",
      "official_story",
      "--guarded-dispatch-result",
      "dispatch.json",
      "--out-dir",
      outDir,
    ],
    {},
    {
      preflightArtifacts() {
        return outDir;
      },
      async execute(options) {
        received = options;
        return {
          schema_version:
            "pulse-governed-reviewed-video-qa-repair-result-v1",
          generated_at: "2026-07-27T21:30:00.000Z",
          mode: "DRY_RUN",
          verdict: "READY",
          mutated: false,
          blockers: [],
          story_id: "official_story",
          platform: "youtube",
          scheduled_event_id: 11,
          qa_failures_resolved: ["duration_too_short (25.00s)"],
          safety: {
            create_boundary_entered: false,
            external_object_created: false,
            auth_boundary_entered: false,
            uploader_invoked: false,
            platform_calls_performed: false,
            oauth_or_tokens_mutated: false,
          },
        };
      },
    },
  );
  assert.equal(received.apply, false);
  assert.equal(received.guardedDispatchResultPath, "dispatch.json");
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result.verdict, "READY");
  assert.ok(fs.existsSync(outcome.result.artifacts.json));
  assert.ok(fs.existsSync(outcome.result.artifacts.markdown));
  assert.match(
    fs.readFileSync(outcome.result.artifacts.markdown, "utf8"),
    /Auth boundary entered: no/,
  );
  assert.match(usage(), /--confirm-renderer-manifest-sha256/);
  assert.match(usage(), /--confirm-source-evidence-sha256/);
  assert.match(usage(), /--confirm-guarded-dispatch-result-sha256/);
  assert.match(usage(), /--confirm-rights-ledger-sha256/);
  assert.match(usage(), /--confirm-publication-metadata-sha256/);
  assert.deepEqual(
    parseCliArgs(["--dry-run", "--story-id", "official_story"]),
    { dryRun: true, storyId: "official_story" },
  );
});

test("video-QA repair CLI parses every exact APPLY confirmation and rejects ambiguous mode", () => {
  const parsed = parseCliArgs([
    "--apply",
    "--database",
    "pulse.db",
    "--confirm-database-path",
    "pulse.db",
    "--backup-evidence",
    "backup.json",
    "--guarded-dispatch-result",
    "dispatch.json",
    "--story-id",
    "official_story",
    "--expected-source-commit",
    "a".repeat(40),
    "--expected-runtime-commit",
    "a".repeat(40),
    "--confirm-story-id",
    "official_story",
    "--confirm-scheduled-event-id",
    "11",
    "--confirm-dispatch-idempotency-key",
    "youtube:official_story:scheduled",
    "--confirm-request-fingerprint",
    "1".repeat(64),
    "--confirm-media-sha256",
    "2".repeat(64),
    "--confirm-script-sha256",
    "3".repeat(64),
    "--confirm-review-manifest-sha256",
    "4".repeat(64),
    "--confirm-renderer-manifest-sha256",
    "5".repeat(64),
    "--confirm-source-evidence-sha256",
    "6".repeat(64),
    "--confirm-guarded-dispatch-result-sha256",
    "7".repeat(64),
    "--confirm-rights-ledger-sha256",
    "8".repeat(64),
    "--confirm-publication-metadata-sha256",
    "9".repeat(64),
    "--actor-id",
    "user:MORR",
    "--confirm-actor-id",
    "user:MORR",
    "--reason",
    "Exact video QA repair",
    "--confirm-reason",
    "Exact video QA repair",
    "--change-window-id",
    "window-1",
    "--confirm-change-window-id",
    "window-1",
  ]);
  assert.equal(parsed.apply, true);
  assert.equal(parsed.confirmScheduledEventId, 11);
  assert.equal(
    parsed.confirmGuardedDispatchResultSha256,
    "7".repeat(64),
  );
  assert.equal(parsed.confirmRightsLedgerSha256, "8".repeat(64));
  assert.equal(
    parsed.confirmPublicationMetadataSha256,
    "9".repeat(64),
  );
  assert.throws(
    () => parseCliArgs(["--apply", "--dry-run"]),
    (error) =>
      error.codes.includes(
        "apply_and_dry_run_are_mutually_exclusive",
      ),
  );
  assert.throws(
    () =>
      parseCliArgs(["--confirm-scheduled-event-id", "not-an-id"]),
    (error) =>
      error.codes.includes("confirm_scheduled_event_id_invalid"),
  );
});

test("video-QA repair CLI returns a hard failure if proof artefacts cannot be written after mutation", async () => {
  const outcome = await run(
    ["--apply", "--out-dir", "ignored"],
    {},
    {
      preflightArtifacts() {},
      async execute() {
        return {
          schema_version:
            "pulse-governed-reviewed-video-qa-repair-result-v1",
          generated_at: "2026-07-27T21:30:00.000Z",
          mode: "APPLY",
          verdict: "APPLIED",
          mutated: true,
          blockers: [],
          safety: {
            platform_calls_performed: false,
            oauth_or_tokens_mutated: false,
          },
        };
      },
      writeArtifacts() {
        throw new Error("proof_disk_full");
      },
    },
  );
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.result.verdict, "APPLIED");
  assert.equal(outcome.result.artifact_write_failed, true);
  assert.equal(outcome.result.artifact_error, "proof_disk_full");
});

test("video-QA repair lane has no publisher, uploader, platform or OAuth implementation dependency", () => {
  const files = [
    path.resolve(
      __dirname,
      "..",
      "..",
      "tools",
      "governed-reviewed-video-qa-repair.js",
    ),
    path.resolve(
      __dirname,
      "..",
      "..",
      "lib",
      "ops",
      "governed-reviewed-video-qa-repair.js",
    ),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /require\([^)]*(?:publisher|upload_|oauth|platforms)[^)]*\)/i,
      file,
    );
  }
});
