"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  materialiseAutonomousMultimodalVisualQa,
} = require("../../lib/services/autonomous-multimodal-visual-qa-materializer");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-visual-qa-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const finalPath = path.join(root, "final", "final.mp4");
  const finalBytes = Buffer.from("exact-final-video", "utf8");
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, finalBytes);
  const outputDir = path.join(root, "visual-qa");
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    story_id: "official-visual-story",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    generated_at: "2026-07-29T16:45:00.000Z",
    root_dir: root,
    output_dir: outputDir,
    final_mp4: {
      path: finalPath,
      sha256: sha256(finalBytes),
    },
    frame_plan: [
      { frame_id: "frame-000", timestamp_ms: 0 },
      { frame_id: "frame-12000", timestamp_ms: 12000 },
      { frame_id: "frame-24000", timestamp_ms: 24000 },
    ],
    reviewers: [
      {
        provider: "ollama",
        model: "gemma3:12b",
        endpoint_origin: "http://127.0.0.1:11434",
      },
      {
        provider: "ollama",
        model: "qwen2.5vl:7b",
        endpoint_origin: "http://127.0.0.1:11434",
      },
    ],
  };
  async function extractFrames({ frame_plan: plan, frames_dir: framesDir }) {
    await fs.mkdir(framesDir, { recursive: true });
    return Promise.all(
      plan.map(async (frame) => {
        const bytes = Buffer.from(
          `exact-frame:${frame.frame_id}:${frame.timestamp_ms}`,
          "utf8",
        );
        const framePath = path.join(framesDir, `${frame.frame_id}.png`);
        await fs.writeFile(framePath, bytes);
        return {
          frame_id: frame.frame_id,
          timestamp_ms: frame.timestamp_ms,
          path: framePath,
          sha256: sha256(bytes),
          width: 1080,
          height: 1920,
          deterministic_blockers: [],
        };
      }),
    );
  }
  const reviewerAdapters = Object.fromEntries(
    request.reviewers.map((reviewer) => [
      `${reviewer.provider}:${reviewer.model}`,
      async () => ({
        provider: reviewer.provider,
        model: reviewer.model,
        verdict: "PASS",
        blockers: [],
        capability_evidence: {
          completion: true,
          vision: true,
        },
      }),
    ]),
  );
  return {
    root,
    finalPath,
    outputDir,
    request,
    extractFrames,
    reviewerAdapters,
  };
}

test("materialises a unanimous local vision PASS with deterministic frames and no authority", async (t) => {
  const input = await fixture(t);
  const options = {
    extractFrames: input.extractFrames,
    reviewerAdapters: input.reviewerAdapters,
  };

  const first = await materialiseAutonomousMultimodalVisualQa(
    input.request,
    options,
  );
  const replay = await materialiseAutonomousMultimodalVisualQa(
    input.request,
    options,
  );

  assert.equal(first.status, "CREATED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(first.report.verdict, "PASS");
  assert.deepEqual(first.report.blockers, []);
  assert.equal(first.report.frames.length, 3);
  assert.deepEqual(first.report.model_aggregation, {
    strategy: "UNANIMOUS_PASS",
    requested_models: ["gemma3:12b", "qwen2.5vl:7b"],
    review_count: 2,
    pass_count: 2,
    all_reviews_must_pass: true,
  });
  assert.equal(first.report.authority.human_review, false);
  assert.equal(first.report.authority.approval_authority, false);
  assert.equal(first.report.authority.publication_authorised, false);
  assert.equal(first.report.authority.may_replace_human_approval, false);
  assert.equal(first.report.controls.local_files_only, true);
  assert.equal(first.report.controls.external_network_used, false);
  assert.equal(first.report.controls.loopback_inference_only, true);
  assert.equal(first.file_sha256, replay.file_sha256);
  assert.equal(await fs.readFile(first.summary_path, "utf8").then(Boolean), true);
});

test("writes HOLD when any local vision reviewer fails or lacks proven vision capability", async (t) => {
  const input = await fixture(t);
  input.request.output_dir = path.join(input.root, "visual-qa-hold");
  input.reviewerAdapters["ollama:qwen2.5vl:7b"] = async () => ({
    provider: "ollama",
    model: "qwen2.5vl:7b",
    verdict: "HOLD",
    blockers: ["caption_collides_with_platform_ui"],
    capability_evidence: {
      completion: true,
      vision: false,
    },
  });

  const result = await materialiseAutonomousMultimodalVisualQa(
    input.request,
    {
      extractFrames: input.extractFrames,
      reviewerAdapters: input.reviewerAdapters,
    },
  );

  assert.equal(result.report.verdict, "HOLD");
  assert.equal(result.report.model_aggregation.pass_count, 1);
  assert.ok(
    result.report.blockers.includes(
      "caption_collides_with_platform_ui",
    ),
  );
  assert.ok(
    result.report.blockers.includes(
      "vision_capability_not_proven:qwen2.5vl:7b",
    ),
  );
  assert.equal(result.report.authority.publication_authorised, false);
});

test("fails closed on final-media drift, frame path escape and hidden reviewer fields", async (t) => {
  const input = await fixture(t);
  const drifted = structuredClone(input.request);
  drifted.final_mp4.sha256 = "a".repeat(64);
  await assert.rejects(
    () =>
      materialiseAutonomousMultimodalVisualQa(drifted, {
        extractFrames: input.extractFrames,
        reviewerAdapters: input.reviewerAdapters,
      }),
    (error) => error?.code === "autonomous_visual_qa_final_mp4_sha256_mismatch",
  );

  const escaped = structuredClone(input.request);
  escaped.output_dir = path.join(input.root, "escaped-frame-review");
  await assert.rejects(
    () =>
      materialiseAutonomousMultimodalVisualQa(escaped, {
        async extractFrames() {
          const outside = path.join(
            path.dirname(input.root),
            "outside-frame.png",
          );
          await fs.writeFile(outside, "outside");
          return escaped.frame_plan.map((frame) => ({
            ...frame,
            path: outside,
            sha256: sha256(Buffer.from("outside")),
            width: 1080,
            height: 1920,
            deterministic_blockers: [],
          }));
        },
        reviewerAdapters: input.reviewerAdapters,
      }),
    (error) => error?.code === "autonomous_visual_qa_frame_outside_root",
  );

  const hidden = structuredClone(input.request);
  hidden.output_dir = path.join(input.root, "hidden-review-field");
  input.reviewerAdapters["ollama:gemma3:12b"] = async () => ({
    provider: "ollama",
    model: "gemma3:12b",
    verdict: "PASS",
    blockers: [],
    capability_evidence: {
      completion: true,
      vision: true,
    },
    publish_now: true,
  });
  await assert.rejects(
    () =>
      materialiseAutonomousMultimodalVisualQa(hidden, {
        extractFrames: input.extractFrames,
        reviewerAdapters: input.reviewerAdapters,
      }),
    (error) => error?.code === "autonomous_visual_qa_review_fields_invalid",
  );
});
