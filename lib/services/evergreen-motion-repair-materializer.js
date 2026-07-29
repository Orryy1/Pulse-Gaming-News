"use strict";

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("fs-extra");
const {
  hasValidEvergreenMotionRepairWorkOrderHash,
} = require("./evergreen-motion-repair-work-order");

const SCHEMA_VERSION =
  "pulse-evergreen-motion-materialisation-v1";
const WORK_ORDER_SCHEMA =
  "pulse-evergreen-motion-coverage-repair-work-order-v1";
const RECEIPT_FILENAME =
  "evergreen-motion-materialisation-receipt.json";
const MAX_SEGMENTS = 12;
const MIN_SEGMENT_SECONDS = 2;
const MAX_SEGMENT_SECONDS = 8;
const MIN_DISCONTIGUOUS_GAP_SECONDS = 1;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function isUnder(parent, child) {
  const relative = path.relative(
    path.resolve(parent),
    path.resolve(child),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function finiteNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code);
  return number;
}

function roundMillis(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeout || 120_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function defaultProbe({ filePath }) {
  const { stdout } = await execFilePromise("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height",
    "-of",
    "json",
    filePath,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail("motion_repair_ffprobe_json_invalid");
  }
  const streams = Array.isArray(parsed?.streams)
    ? parsed.streams
    : [];
  const videoStreams = streams.filter(
    (stream) => stream?.codec_type === "video",
  );
  return {
    duration_seconds: Number(parsed?.format?.duration),
    width: Number(videoStreams[0]?.width) || null,
    height: Number(videoStreams[0]?.height) || null,
    video_stream_count: videoStreams.length,
    audio_stream_count: streams.filter(
      (stream) => stream?.codec_type === "audio",
    ).length,
  };
}

async function defaultExtractor({
  source_video_path,
  output_path,
  segment,
}) {
  await execFilePromise(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      String(segment.start_seconds),
      "-i",
      source_video_path,
      "-t",
      String(segment.duration_seconds),
      "-map",
      "0:v:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-avoid_negative_ts",
      "make_zero",
      "-y",
      output_path,
    ],
    { timeout: 180_000 },
  );
}

async function readVerifiedWorkOrder(workOrderPath) {
  if (!(await fs.pathExists(workOrderPath))) {
    fail("motion_repair_work_order_not_found");
  }
  const workOrder = await fs.readJson(workOrderPath);
  if (workOrder?.schema_version !== WORK_ORDER_SCHEMA) {
    fail("motion_repair_work_order_schema_invalid");
  }
  const declaredSha256 = String(
    workOrder?.work_order_sha256 || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(declaredSha256)) {
    fail("motion_repair_work_order_sha256_required");
  }
  if (!hasValidEvergreenMotionRepairWorkOrderHash(workOrder)) {
    fail("motion_repair_work_order_sha256_mismatch");
  }
  if (
    !String(workOrder?.story_id || "").trim() ||
    !String(workOrder?.candidate_id || "").trim()
  ) {
    fail("motion_repair_work_order_binding_required");
  }
  const requiredSeconds = Number(
    workOrder?.additional_motion_seconds_required,
  );
  if (!Number.isFinite(requiredSeconds) || requiredSeconds <= 0) {
    fail("motion_repair_work_order_motion_gap_invalid");
  }
  return {
    workOrder,
    fileSha256: await fileSha256(workOrderPath),
  };
}

function normaliseSegments(rawSegments, sourceDurationSeconds) {
  if (
    !Array.isArray(rawSegments) ||
    rawSegments.length === 0 ||
    rawSegments.length > MAX_SEGMENTS
  ) {
    fail("motion_repair_segment_count_invalid");
  }
  const segments = rawSegments
    .map((segment, index) => {
      const startSeconds = finiteNumber(
        segment?.start_seconds,
        "motion_repair_segment_start_invalid",
      );
      const durationSeconds = finiteNumber(
        segment?.duration_seconds,
        "motion_repair_segment_duration_invalid",
      );
      if (startSeconds < 0) {
        fail("motion_repair_segment_start_invalid");
      }
      if (
        durationSeconds < MIN_SEGMENT_SECONDS ||
        durationSeconds > MAX_SEGMENT_SECONDS
      ) {
        fail("motion_repair_segment_duration_outside_bounds");
      }
      return {
        index: index + 1,
        start_seconds: roundMillis(startSeconds),
        duration_seconds: roundMillis(durationSeconds),
        end_seconds: roundMillis(startSeconds + durationSeconds),
      };
    })
    .sort((left, right) => left.start_seconds - right.start_seconds)
    .map((segment, index) => ({ ...segment, index: index + 1 }));

  for (const [index, segment] of segments.entries()) {
    if (segment.end_seconds > sourceDurationSeconds + 0.001) {
      fail("motion_repair_segment_out_of_bounds");
    }
    if (index === 0) continue;
    const previous = segments[index - 1];
    if (segment.start_seconds < previous.end_seconds - 0.001) {
      fail("motion_repair_segment_overlap");
    }
    if (
      segment.start_seconds - previous.end_seconds <
      MIN_DISCONTIGUOUS_GAP_SECONDS
    ) {
      fail("motion_repair_segments_must_be_discontiguous");
    }
  }
  return segments;
}

function segmentOutputPath(outputDir, segment) {
  const start = segment.start_seconds
    .toFixed(3)
    .replace(".", "_");
  const duration = segment.duration_seconds
    .toFixed(3)
    .replace(".", "_");
  return path.join(
    outputDir,
    `segment-${String(segment.index).padStart(
      2,
      "0",
    )}-${start}-${duration}.mp4`,
  );
}

async function materializeEvergreenMotionRepair({
  work_order_path,
  source_video_path,
  source_video_sha256 = null,
  source_media_url = null,
  segments,
  output_dir,
  apply_local = false,
  now = new Date().toISOString(),
  probe = defaultProbe,
  extractor = defaultExtractor,
} = {}) {
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(
      String(source_video_path || ""),
    )
  ) {
    fail("motion_repair_local_source_required");
  }
  const workOrderPath = path.resolve(
    String(work_order_path || ""),
  );
  const sourceVideoPath = path.resolve(
    String(source_video_path || ""),
  );
  if (!(await fs.pathExists(sourceVideoPath))) {
    fail("motion_repair_source_video_not_found");
  }
  const observedSourceVideoSha256 =
    await fileSha256(sourceVideoPath);
  const expectedSourceVideoSha256 = String(
    source_video_sha256 || "",
  )
    .trim()
    .toLowerCase();
  if (
    expectedSourceVideoSha256 &&
    (!/^[a-f0-9]{64}$/.test(expectedSourceVideoSha256) ||
      observedSourceVideoSha256 !==
        expectedSourceVideoSha256)
  ) {
    fail("motion_repair_source_video_sha256_mismatch");
  }
  const workOrderProof =
    await readVerifiedWorkOrder(workOrderPath);
  const workOrder = workOrderProof.workOrder;
  const workOrderDir = path.dirname(workOrderPath);
  const outputDir = path.resolve(
    output_dir ||
      path.join(workOrderDir, "materialised-motion"),
  );
  if (!isUnder(workOrderDir, outputDir)) {
    fail("motion_repair_output_not_bound_to_work_order");
  }
  if (isUnder(outputDir, sourceVideoPath)) {
    fail("motion_repair_source_inside_output");
  }

  const sourceProbe = await probe({
    filePath: sourceVideoPath,
    file_path: sourceVideoPath,
    kind: "source",
  });
  const sourceDurationSeconds = finiteNumber(
    sourceProbe?.duration_seconds,
    "motion_repair_source_duration_invalid",
  );
  if (
    sourceDurationSeconds <= 0 ||
    Number(sourceProbe?.video_stream_count) < 1
  ) {
    fail("motion_repair_source_video_invalid");
  }
  const normalisedSegments = normaliseSegments(
    segments,
    sourceDurationSeconds,
  );
  const plannedMotionSeconds = roundMillis(
    normalisedSegments.reduce(
      (total, segment) => total + segment.duration_seconds,
      0,
    ),
  );
  const requiredAdditionalMotionSeconds = Number(
    workOrder.additional_motion_seconds_required,
  );
  if (
    plannedMotionSeconds + 0.001 <
    requiredAdditionalMotionSeconds
  ) {
    fail("motion_repair_segment_duration_insufficient");
  }

  const source = {
    local_path: sourceVideoPath,
    file_sha256: observedSourceVideoSha256,
    source_media_url:
      String(source_media_url || "").trim() || null,
    source_duration_seconds: roundMillis(sourceDurationSeconds),
    width: Number(sourceProbe?.width) || null,
    height: Number(sourceProbe?.height) || null,
    video_stream_count: Number(
      sourceProbe?.video_stream_count || 0,
    ),
    audio_stream_count: Number(
      sourceProbe?.audio_stream_count || 0,
    ),
  };
  let materialisedSegments = normalisedSegments.map((segment) => ({
    ...segment,
    status: "WOULD_MATERIALISE",
    local_path: null,
    file_sha256: null,
    probed_duration_seconds: null,
    audio_stream_count: null,
  }));

  if (apply_local === true) {
    await fs.ensureDir(outputDir);
    const hashes = new Set();
    materialisedSegments = [];
    for (const segment of normalisedSegments) {
      const outputPath = segmentOutputPath(outputDir, segment);
      if (await fs.pathExists(outputPath)) {
        fail("motion_repair_segment_output_exists");
      }
      await extractor({
        source_video_path: sourceVideoPath,
        sourceVideoPath,
        output_path: outputPath,
        outputPath,
        segment,
      });
      if (!(await fs.pathExists(outputPath))) {
        fail("motion_repair_segment_not_materialised");
      }
      const segmentProbe = await probe({
        filePath: outputPath,
        file_path: outputPath,
        kind: "segment",
        segment,
      });
      const probedDurationSeconds = finiteNumber(
        segmentProbe?.duration_seconds,
        "motion_repair_segment_probe_duration_invalid",
      );
      if (
        probedDurationSeconds <
          segment.duration_seconds - 0.25 ||
        probedDurationSeconds >
          segment.duration_seconds + 0.5
      ) {
        fail("motion_repair_segment_duration_mismatch");
      }
      if (Number(segmentProbe?.video_stream_count) < 1) {
        fail("motion_repair_segment_video_missing");
      }
      if (Number(segmentProbe?.audio_stream_count) !== 0) {
        fail("motion_repair_segment_audio_present");
      }
      const outputSha256 = await fileSha256(outputPath);
      if (hashes.has(outputSha256)) {
        fail("motion_repair_segment_duplicate_hash");
      }
      hashes.add(outputSha256);
      materialisedSegments.push({
        ...segment,
        status: "MATERIALISED",
        local_path: outputPath,
        file_sha256: outputSha256,
        probed_duration_seconds: roundMillis(
          probedDurationSeconds,
        ),
        width: Number(segmentProbe?.width) || null,
        height: Number(segmentProbe?.height) || null,
        video_stream_count: Number(
          segmentProbe?.video_stream_count || 0,
        ),
        audio_stream_count: 0,
      });
    }
  }

  const verifiedMaterialisedMotionSeconds =
    apply_local === true
      ? roundMillis(
          materialisedSegments.reduce(
            (total, segment) =>
              total +
              Math.min(
                segment.duration_seconds,
                segment.probed_duration_seconds,
              ),
            0,
          ),
        )
      : 0;
  if (
    apply_local === true &&
    verifiedMaterialisedMotionSeconds + 0.001 <
      requiredAdditionalMotionSeconds
  ) {
    fail("motion_repair_verified_duration_insufficient");
  }

  const report = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date(now).toISOString(),
    mode: apply_local === true ? "APPLY_LOCAL" : "DRY_RUN",
    verdict:
      apply_local === true
        ? "MATERIALISED"
        : "READY_TO_MATERIALISE",
    story_id: String(workOrder.story_id).trim(),
    candidate_id: String(workOrder.candidate_id).trim(),
    work_order_sha256: workOrder.work_order_sha256,
    work_order_ref: {
      path: workOrderPath,
      file_sha256: workOrderProof.fileSha256,
    },
    source,
    segments: materialisedSegments,
    summary: {
      segment_count: normalisedSegments.length,
      materialised_segment_count:
        apply_local === true
          ? materialisedSegments.length
          : 0,
      planned_motion_seconds: plannedMotionSeconds,
      required_additional_motion_seconds:
        requiredAdditionalMotionSeconds,
      verified_materialised_motion_seconds:
        verifiedMaterialisedMotionSeconds,
      static_motion_seconds: 0,
    },
    rights_decision: null,
    rights_basis: null,
    completion_manifest_created: false,
    safety: {
      local_proof_only: true,
      local_source_only: true,
      network_used: false,
      source_audio_removed: apply_local === true,
      static_images_counted_as_motion: false,
      rights_decision_created: false,
      database_mutated: false,
      oauth_mutated: false,
      external_platform_contacted: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
    },
  };
  if (apply_local !== true) return report;

  const receiptPath = path.join(outputDir, RECEIPT_FILENAME);
  const receiptBytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(receiptPath, receiptBytes, { flag: "wx" });
  return {
    ...report,
    receipt_path: receiptPath,
    receipt_file_sha256: sha256(receiptBytes),
  };
}

module.exports = {
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  RECEIPT_FILENAME,
  SCHEMA_VERSION,
  materializeEvergreenMotionRepair,
};
