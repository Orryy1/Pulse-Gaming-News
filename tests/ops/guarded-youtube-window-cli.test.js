"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  runCli,
  writeArtifacts,
} = require("../../tools/guarded-youtube-window");

test("parseArgs defaults to inspect and keeps irreversible confirmations explicit", () => {
  const parsed = parseArgs([
    "--story-id",
    "official_story",
    "--confirm-supervisor-stopped",
    "--confirm-workers-stopped",
  ]);

  assert.equal(parsed.action, "inspect");
  assert.equal(parsed.storyId, "official_story");
  assert.equal(parsed.confirmSupervisorStopped, true);
  assert.equal(parsed.confirmWorkersStopped, true);
  assert.equal(parsed.confirmLiveYoutubeDispatch, false);
});

test("parseArgs accepts the exact guarded identity, hash and dispatch controls", () => {
  const parsed = parseArgs([
    "--action",
    "dispatch",
    "--database",
    "C:\\data\\pulse.db",
    "--backup-evidence",
    "C:\\proof\\backup.json",
    "--publication-review-result",
    "C:\\proof\\review.json",
    "--story-id",
    "official_story",
    "--confirm-story-id",
    "official_story",
    "--scheduled-for",
    "2026-07-27T19:00:00.000Z",
    "--confirm-scheduled-for",
    "2026-07-27T19:00:00.000Z",
    "--confirm-live-youtube-dispatch",
  ]);

  assert.equal(parsed.action, "dispatch");
  assert.equal(parsed.databasePath, "C:\\data\\pulse.db");
  assert.equal(parsed.confirmStoryId, "official_story");
  assert.equal(parsed.confirmLiveYoutubeDispatch, true);
});

test("parseArgs accepts help without requiring any live inputs", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    action: "inspect",
    confirmSupervisorStopped: false,
    confirmWorkersStopped: false,
    confirmLiveYoutubeDispatch: false,
    help: true,
  });
});

test("runCli help is read-only and does not execute the guarded operation", async () => {
  let executions = 0;
  let output = "";
  const result = await runCli({
    argv: ["--help"],
    execute: async () => {
      executions += 1;
    },
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.equal(executions, 0);
  assert.equal(result.help, true);
  assert.match(output, /Usage: node tools\/guarded-youtube-window\.js/);
  assert.match(output, /--confirm-request-fingerprint/);
});

test("runCli writes machine JSON and Markdown while inspect remains read-only", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-guarded-youtube-cli-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let received = null;
  let output = "";
  const result = await runCli({
    argv: ["--story-id", "official_story", "--out-dir", root],
    env: { NODE_ENV: "test" },
    execute: async (options) => {
      received = options;
      return {
        schema_version: "pulse-guarded-youtube-window-result-v1",
        generated_at: "2026-07-27T19:02:00.000Z",
        action: "inspect",
        verdict: "READY_TO_ADMIT",
        story_id: "official_story",
        scheduled_for: null,
        mutated: false,
        blockers: [],
        safety: {
          platforms_contacted: false,
          oauth_or_tokens_mutated: false,
        },
      };
    },
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.equal(received.action, "inspect");
  assert.equal(result.verdict, "READY_TO_ADMIT");
  assert.match(output, /READY_TO_ADMIT/);
  const jsonPath = path.join(
    root,
    "guarded-youtube-window-inspect-2026-07-27T19-02-00-000Z.json",
  );
  const markdownPath = path.join(
    root,
    "guarded-youtube-window-inspect-2026-07-27T19-02-00-000Z.md",
  );
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.equal(JSON.parse(fs.readFileSync(jsonPath, "utf8")).mutated, false);
  assert.match(fs.readFileSync(markdownPath, "utf8"), /READY_TO_ADMIT/);
});

test("writeArtifacts preserves each action and timestamp as immutable evidence", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-guarded-artifacts-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    schema_version: "pulse-guarded-youtube-window-result-v1",
    generated_at: "2026-07-27T19:02:00.000Z",
    verdict: "HOLD",
    story_id: "official_story",
    scheduled_for: "2026-07-27T19:00:00.000Z",
    mutated: false,
    blockers: ["confirmation_required"],
    safety: {
      platforms_contacted: false,
      oauth_or_tokens_mutated: false,
    },
  };

  const inspect = writeArtifacts({
    outDir: root,
    result: { ...base, action: "inspect" },
  });
  const admit = writeArtifacts({
    outDir: root,
    result: {
      ...base,
      generated_at: "2026-07-27T19:03:00.000Z",
      action: "admit",
    },
  });

  assert.notEqual(inspect.json_path, admit.json_path);
  assert.equal(fs.existsSync(inspect.json_path), true);
  assert.equal(fs.existsSync(admit.json_path), true);
  assert.match(path.basename(inspect.json_path), /-inspect-/);
  assert.match(path.basename(admit.json_path), /-admit-/);
});

test("writeArtifacts is idempotent for identical bytes and rejects collisions", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-guarded-collision-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = {
    schema_version: "pulse-guarded-youtube-window-result-v1",
    generated_at: "2026-07-27T19:02:00.000Z",
    action: "inspect",
    verdict: "HOLD",
    story_id: "official_story",
    scheduled_for: "2026-07-27T19:00:00.000Z",
    mutated: false,
    blockers: ["confirmation_required"],
    safety: {
      platforms_contacted: false,
      oauth_or_tokens_mutated: false,
    },
  };

  const first = writeArtifacts({ outDir: root, result });
  const second = writeArtifacts({ outDir: root, result });
  assert.deepEqual(second, first);
  const original = fs.readFileSync(first.json_path, "utf8");

  assert.throws(
    () =>
      writeArtifacts({
        outDir: root,
        result: { ...result, verdict: "READY_TO_ADMIT", blockers: [] },
      }),
    /guarded_evidence_collision/,
  );
  assert.equal(fs.readFileSync(first.json_path, "utf8"), original);
});

test("CLI source has no OAuth mutation, uploader stub or direct platform adapter", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "guarded-youtube-window.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /uploadShort|upload_youtube|oauth|token.*write/i);
  assert.doesNotMatch(source, /governedDispatch\s*:/);
  assert.match(source, /executeGuardedYoutubeWindow/);
});
