"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  materializeEvergreenMotionRepair,
} = require("../../lib/services/evergreen-motion-repair-materializer");
const {
  hashEvergreenMotionRepairWorkOrder,
} = require("../../lib/services/evergreen-motion-repair-work-order");

const NOW = "2026-07-28T12:00:00.000Z";
const SEGMENTS = [
  { start_seconds: 30, duration_seconds: 5 },
  { start_seconds: 75, duration_seconds: 5 },
  { start_seconds: 120, duration_seconds: 5 },
  { start_seconds: 165, duration_seconds: 5 },
  { start_seconds: 210, duration_seconds: 5 },
  { start_seconds: 255, duration_seconds: 5 },
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-motion-materializer-"),
  );
  t.after(() => fs.remove(root));
  const workOrderDir = path.join(root, "motion-repair", "story-one");
  await fs.ensureDir(workOrderDir);
  const sourceVideoPath = path.join(root, "official-trailer.mp4");
  await fs.writeFile(
    sourceVideoPath,
    Buffer.from("operator-supplied-official-trailer"),
  );
  const workOrderBase = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: "story-one",
    candidate_id: "candidate-one",
    blocker: "exact_subject_motion_ratio_too_low",
    minimum_required_motion_seconds: 53.3,
    verified_materialised_motion_seconds: 28,
    additional_motion_seconds_required: 25.3,
    completion_contract: {
      static_images_count_as_motion_seconds: false,
      materialised_video_probe_required: true,
    },
    safety: {
      local_proof_only: true,
      publish_authority_created: false,
    },
  };
  const workOrder = {
    ...workOrderBase,
    work_order_sha256:
      hashEvergreenMotionRepairWorkOrder(workOrderBase),
  };
  const workOrderPath = path.join(
    workOrderDir,
    "evergreen-motion-coverage-repair-work-order.json",
  );
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  return {
    root,
    workOrder,
    workOrderDir,
    workOrderPath,
    sourceVideoPath,
    outputDir: path.join(workOrderDir, "materialised-motion"),
  };
}

function probeFixture({ filePath, kind }) {
  if (kind === "source") {
    return Promise.resolve({
      duration_seconds: 513,
      width: 1920,
      height: 1080,
      video_stream_count: 1,
      audio_stream_count: 1,
    });
  }
  return Promise.resolve({
    duration_seconds: 5,
    width: 1920,
    height: 1080,
    video_stream_count: 1,
    audio_stream_count: 0,
    file_path: filePath,
  });
}

test("dry-run plans enough non-overlapping local exact-subject motion without writing clips", async (t) => {
  const value = await fixture(t);
  let extractorCalls = 0;

  const report = await materializeEvergreenMotionRepair({
    work_order_path: value.workOrderPath,
    source_video_path: value.sourceVideoPath,
    source_media_url: "https://www.youtube.com/watch?v=022l3iJMBAg",
    segments: SEGMENTS,
    output_dir: value.outputDir,
    now: NOW,
    probe: probeFixture,
    extractor: async () => {
      extractorCalls += 1;
    },
  });

  assert.equal(report.schema_version, "pulse-evergreen-motion-materialisation-v1");
  assert.equal(report.mode, "DRY_RUN");
  assert.equal(report.verdict, "READY_TO_MATERIALISE");
  assert.equal(report.story_id, "story-one");
  assert.equal(report.candidate_id, "candidate-one");
  assert.equal(report.work_order_sha256, value.workOrder.work_order_sha256);
  assert.equal(report.summary.segment_count, 6);
  assert.equal(report.summary.planned_motion_seconds, 30);
  assert.equal(report.summary.required_additional_motion_seconds, 25.3);
  assert.equal(report.summary.verified_materialised_motion_seconds, 0);
  assert.equal(report.source.source_duration_seconds, 513);
  assert.match(report.source.file_sha256, /^[a-f0-9]{64}$/);
  assert.equal(extractorCalls, 0);
  assert.equal(await fs.pathExists(value.outputDir), false);
  assert.equal(report.safety.network_used, false);
  assert.equal(report.safety.rights_decision_created, false);
  assert.equal(report.safety.publish_authority_created, false);
});

test("fails closed when proposed excerpts do not close the exact motion gap", async (t) => {
  const value = await fixture(t);

  await assert.rejects(
    () =>
      materializeEvergreenMotionRepair({
        work_order_path: value.workOrderPath,
        source_video_path: value.sourceVideoPath,
        segments: SEGMENTS.slice(0, 5),
        output_dir: value.outputDir,
        probe: probeFixture,
      }),
    /motion_repair_segment_duration_insufficient/,
  );
});

test("fails before probing or extracting when the bound local source hash drifts", async (t) => {
  const value = await fixture(t);
  let probeCalls = 0;
  let extractorCalls = 0;

  await assert.rejects(
    () =>
      materializeEvergreenMotionRepair({
        work_order_path: value.workOrderPath,
        source_video_path: value.sourceVideoPath,
        source_video_sha256: "f".repeat(64),
        segments: SEGMENTS,
        output_dir: value.outputDir,
        apply_local: true,
        probe: async (input) => {
          probeCalls += 1;
          return probeFixture(input);
        },
        extractor: async () => {
          extractorCalls += 1;
        },
      }),
    /motion_repair_source_video_sha256_mismatch/,
  );
  assert.equal(probeCalls, 0);
  assert.equal(extractorCalls, 0);
});

test("rejects overlapping or out-of-bounds excerpt windows", async (t) => {
  const value = await fixture(t);

  await assert.rejects(
    () =>
      materializeEvergreenMotionRepair({
        work_order_path: value.workOrderPath,
        source_video_path: value.sourceVideoPath,
        segments: [
          ...SEGMENTS.slice(0, 5),
          { start_seconds: 32, duration_seconds: 5 },
        ],
        output_dir: value.outputDir,
        probe: probeFixture,
      }),
    /motion_repair_segment_overlap/,
  );

  await assert.rejects(
    () =>
      materializeEvergreenMotionRepair({
        work_order_path: value.workOrderPath,
        source_video_path: value.sourceVideoPath,
        segments: [
          ...SEGMENTS.slice(0, 5),
          { start_seconds: 510, duration_seconds: 5 },
        ],
        output_dir: value.outputDir,
        probe: probeFixture,
      }),
    /motion_repair_segment_out_of_bounds/,
  );
});

test("apply-local creates muted probe/hash-bound clips and a machine-readable receipt", async (t) => {
  const value = await fixture(t);

  const report = await materializeEvergreenMotionRepair({
    work_order_path: value.workOrderPath,
    source_video_path: value.sourceVideoPath,
    source_media_url: "https://www.youtube.com/watch?v=022l3iJMBAg",
    segments: SEGMENTS,
    output_dir: value.outputDir,
    apply_local: true,
    now: NOW,
    probe: probeFixture,
    extractor: async ({ output_path, segment }) => {
      await fs.ensureDir(path.dirname(output_path));
      await fs.writeFile(
        output_path,
        Buffer.from(
          `muted-clip-${segment.start_seconds}-${segment.duration_seconds}`,
        ),
      );
    },
  });

  assert.equal(report.mode, "APPLY_LOCAL");
  assert.equal(report.verdict, "MATERIALISED");
  assert.equal(report.summary.materialised_segment_count, 6);
  assert.equal(report.summary.verified_materialised_motion_seconds, 30);
  assert.equal(report.segments.length, 6);
  assert.ok(
    report.segments.every(
      (segment) =>
        segment.status === "MATERIALISED" &&
        segment.audio_stream_count === 0 &&
        /^[a-f0-9]{64}$/.test(segment.file_sha256) &&
        segment.local_path.startsWith(value.outputDir),
    ),
  );
  assert.equal(await fs.pathExists(report.receipt_path), true);
  const {
    receipt_path: receiptPath,
    receipt_file_sha256: receiptFileSha256,
    ...receipt
  } = report;
  const receiptBytes = await fs.readFile(receiptPath);
  assert.equal(
    receiptFileSha256,
    crypto.createHash("sha256").update(receiptBytes).digest("hex"),
  );
  assert.deepEqual(await fs.readJson(receiptPath), receipt);
  assert.equal(report.rights_decision, null);
  assert.equal(report.rights_basis, null);
  assert.equal(report.safety.rights_decision_created, false);
});

test("apply-local rejects an excerpt that still contains source audio", async (t) => {
  const value = await fixture(t);

  await assert.rejects(
    () =>
      materializeEvergreenMotionRepair({
        work_order_path: value.workOrderPath,
        source_video_path: value.sourceVideoPath,
        segments: SEGMENTS,
        output_dir: value.outputDir,
        apply_local: true,
        extractor: async ({ output_path, segment }) => {
          await fs.ensureDir(path.dirname(output_path));
          await fs.writeFile(
            output_path,
            Buffer.from(`clip-${segment.start_seconds}`),
          );
        },
        probe: async (input) => {
          const probed = await probeFixture(input);
          return input.kind === "segment"
            ? { ...probed, audio_stream_count: 1 }
            : probed;
        },
      }),
    /motion_repair_segment_audio_present/,
  );
});

test("apply-local output must remain bound beneath the immutable work-order directory", async (t) => {
  const value = await fixture(t);

  await assert.rejects(
    () =>
      materializeEvergreenMotionRepair({
        work_order_path: value.workOrderPath,
        source_video_path: value.sourceVideoPath,
        segments: SEGMENTS,
        output_dir: path.join(value.root, "unbound-output"),
        apply_local: true,
        probe: probeFixture,
      }),
    /motion_repair_output_not_bound_to_work_order/,
  );
});
