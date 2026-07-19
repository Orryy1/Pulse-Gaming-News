const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  parseArgs,
  runCli,
} = require("../../tools/video-temporal-qa");

test("video temporal QA CLI writes hash-bound machine and human proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-temporal-qa-cli-"));
  const mp4Path = path.join(root, "final.mp4");
  const outDir = path.join(root, "proof");
  const bytes = Buffer.from("decoded-media-fixture");
  await fs.outputFile(mp4Path, bytes);

  const result = await runCli(
    [
      "node",
      "tools/video-temporal-qa.js",
      "--mp4",
      mp4Path,
      "--story-id",
      "arknights-proof",
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      runVideoQa: async () => ({
        result: "pass",
        failures: [],
        warnings: [],
        evidence: {
          decode: {
            complete: true,
            video_stream: true,
            audio_stream: true,
          },
          temporal: {
            analysis_scope: "full_frame",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: { choppy: false },
            supplemental_center_crop: {
              analysis_scope: "center_crop",
              scan_complete: true,
              coverage_ratio: 1,
              sampled_frame_count: 300,
              repeated_motion_sequences: [],
              repeated_motion_seconds: 0,
              cadence: { choppy: false },
            },
          },
        },
      }),
      stdout: { write() {} },
    },
  );

  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.report.verdict, "GREEN");
  assert.strictEqual(result.report.can_publish, true);
  assert.strictEqual(
    result.report.final_media.sha256,
    crypto.createHash("sha256").update(bytes).digest("hex"),
  );
  assert.strictEqual(
    result.report.final_media.size_bytes,
    bytes.length,
  );
  assert.strictEqual(
    result.report.evidence.temporal.scan_complete,
    true,
  );
  assert.strictEqual(
    (await fs.readJson(path.join(outDir, "temporal_video_qa_report.json"))).story_id,
    "arknights-proof",
  );
  assert.match(
    await fs.readFile(path.join(outDir, "temporal_video_qa_report.md"), "utf8"),
    /Verdict: GREEN/,
  );
});

test("video temporal QA CLI records clean centre motion but keeps a full-frame repeat blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-temporal-shell-"));
  const mp4Path = path.join(root, "final.mp4");
  await fs.outputFile(mp4Path, Buffer.from("shell-disambiguated-media-fixture"));

  const result = await runCli(
    [
      "node",
      "tools/video-temporal-qa.js",
      "--mp4",
      mp4Path,
      "--story-id",
      "arknights-shell-proof",
      "--out-dir",
      path.join(root, "proof"),
    ],
    {
      runVideoQa: async () => ({
        result: "pass",
        failures: [],
        warnings: [],
        evidence: {
          decode: {
            complete: true,
            video_stream: true,
            audio_stream: true,
          },
          temporal: {
            analysis_scope: "full_frame",
            scan_complete: true,
            coverage_ratio: 0.9956,
            sampled_frame_count: 106,
            repeated_motion_sequences: [
              {
                first_start_seconds: 1.5,
                repeat_start_seconds: 41.5,
                duration_seconds: 2,
                mean_hash_distance: 3.25,
              },
            ],
            repeated_motion_seconds: 2,
            cadence: { choppy: false },
            supplemental_center_crop: {
              analysis_scope: "center_crop",
              scan_complete: true,
              coverage_ratio: 0.9956,
              sampled_frame_count: 106,
              repeated_motion_sequences: [],
              repeated_motion_seconds: 0,
              cadence: { choppy: false },
            },
          },
        },
      }),
      stdout: { write() {} },
    },
  );

  assert.strictEqual(result.exitCode, 2);
  assert.strictEqual(result.report.verdict, "RED");
  assert.strictEqual(result.report.can_publish, false);
  assert.ok(
    result.report.blockers.includes(
      "temporal_video_qa_repeated_motion_detected",
    ),
  );
  assert.strictEqual(
    result.report.validation.repeat_reconciliation
      .full_frame_only_disambiguated_by_center_crop,
    true,
  );
});

test("video temporal QA CLI remains non-publishable when decoded cadence fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-temporal-qa-red-"));
  const mp4Path = path.join(root, "final.mp4");
  await fs.outputFile(mp4Path, Buffer.from("bad-media-fixture"));

  const result = await runCli(
    [
      "node",
      "tools/video-temporal-qa.js",
      "--mp4",
      mp4Path,
      "--story-id",
      "bad-proof",
      "--out-dir",
      path.join(root, "proof"),
    ],
    {
      runVideoQa: async () => ({
        result: "fail",
        failures: ["choppy_temporal_cadence (0.800 overall, 1.000 peak)"],
        warnings: [],
        evidence: {
          decode: { complete: true },
          temporal: {
            scan_complete: true,
            cadence: { choppy: true },
          },
        },
      }),
      stdout: { write() {} },
    },
  );

  assert.strictEqual(result.exitCode, 2);
  assert.strictEqual(result.report.verdict, "RED");
  assert.strictEqual(result.report.can_publish, false);
});

test("video temporal QA CLI reports the exact decoded local-stall window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-temporal-local-stall-"));
  const mp4Path = path.join(root, "final.mp4");
  const outDir = path.join(root, "proof");
  await fs.outputFile(mp4Path, Buffer.from("locally-stalled-media-fixture"));

  const result = await runCli(
    [
      "node",
      "tools/video-temporal-qa.js",
      "--mp4",
      mp4Path,
      "--story-id",
      "black-flag",
      "--out-dir",
      outDir,
    ],
    {
      runVideoQa: async () => ({
        result: "pass",
        failures: [],
        warnings: [],
        evidence: {
          decode: {
            complete: true,
            video_stream: true,
            audio_stream: true,
          },
          temporal: {
            analysis_scope: "full_frame",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 350,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: {
              choppy: false,
              local_stall_detected: true,
              local_stall_start_seconds: 50.333,
              local_stall_end_seconds: 53.333,
            },
            supplemental_center_crop: {
              analysis_scope: "center_crop",
              scan_complete: true,
              coverage_ratio: 1,
              sampled_frame_count: 350,
              repeated_motion_sequences: [],
              repeated_motion_seconds: 0,
              cadence: {
                choppy: false,
                local_stall_detected: true,
                local_stall_start_seconds: 50.333,
                local_stall_end_seconds: 53.333,
              },
            },
          },
        },
      }),
      stdout: { write() {} },
    },
  );

  assert.strictEqual(result.exitCode, 2);
  assert.strictEqual(result.report.verdict, "RED");
  assert.ok(
    result.report.blockers.includes("temporal_video_qa_local_stall_detected"),
  );
  assert.match(
    await fs.readFile(path.join(outDir, "temporal_video_qa_report.md"), "utf8"),
    /Local visual stall: YES \(50\.33-53\.33s\)/,
  );
});

test("video temporal QA CLI cannot emit GREEN from crop-incomplete temporal proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-temporal-qa-scope-red-"));
  const mp4Path = path.join(root, "final.mp4");
  await fs.outputFile(mp4Path, Buffer.from("scope-incomplete-media-fixture"));

  const result = await runCli(
    [
      "node",
      "tools/video-temporal-qa.js",
      "--mp4",
      mp4Path,
      "--story-id",
      "scope-incomplete-proof",
      "--out-dir",
      path.join(root, "proof"),
    ],
    {
      runVideoQa: async () => ({
        result: "pass",
        failures: [],
        warnings: [],
        evidence: {
          decode: {
            complete: true,
            video_stream: true,
            audio_stream: true,
          },
          temporal: {
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: { choppy: false },
          },
        },
      }),
      stdout: { write() {} },
    },
  );

  assert.strictEqual(result.exitCode, 2);
  assert.strictEqual(result.report.verdict, "RED");
  assert.strictEqual(result.report.can_publish, false);
  assert.ok(result.report.blockers.includes("temporal_video_qa_full_frame_scope_missing"));
  assert.ok(result.report.blockers.includes("temporal_video_qa_center_crop_scope_missing"));
});

test("video temporal QA CLI arguments fail closed without an MP4", () => {
  assert.throws(
    () => parseArgs(["node", "tools/video-temporal-qa.js", "--json"]),
    /--mp4 is required/,
  );
});

test("video temporal QA defaults proof beside the authoritative final MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-temporal-authority-path-"));
  const mp4Path = path.join(root, "visual_v4_render.mp4");
  await fs.outputFile(mp4Path, Buffer.from("authoritative-temporal-media-fixture"));

  const result = await runCli(
    [
      "node",
      "tools/video-temporal-qa.js",
      "--mp4",
      mp4Path,
      "--story-id",
      "black-flag-v31",
    ],
    {
      runVideoQa: async () => ({
        result: "pass",
        failures: [],
        warnings: [],
        evidence: {
          decode: {
            complete: true,
            video_stream: true,
            audio_stream: true,
          },
          temporal: {
            analysis_scope: "full_frame",
            scan_complete: true,
            coverage_ratio: 1,
            sampled_frame_count: 300,
            repeated_motion_sequences: [],
            repeated_motion_seconds: 0,
            cadence: { choppy: false },
            supplemental_center_crop: {
              analysis_scope: "center_crop",
              scan_complete: true,
              coverage_ratio: 1,
              sampled_frame_count: 300,
              repeated_motion_sequences: [],
              repeated_motion_seconds: 0,
              cadence: { choppy: false },
            },
          },
        },
      }),
      stdout: { write() {} },
    },
  );

  assert.equal(result.jsonPath, path.join(root, "temporal_video_qa_report.json"));
  assert.equal(result.markdownPath, path.join(root, "temporal_video_qa_report.md"));
  assert.equal(await fs.pathExists(result.jsonPath), true);
  assert.equal(
    await fs.pathExists(path.join(root, "qa", "temporal-video", "temporal_video_qa_report.json")),
    false,
  );
});
