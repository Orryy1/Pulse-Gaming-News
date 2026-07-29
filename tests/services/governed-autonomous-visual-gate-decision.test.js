"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  materialiseGovernedAutonomousVisualGateDecision,
} = require("../../lib/services/governed-autonomous-visual-gate-decision");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-visual-decision-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const finalPath = path.join(root, "final", "candidate.mp4");
  const finalBytes = Buffer.from("exact-governed-final-mp4", "utf8");
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, finalBytes);

  const visualQaPath = path.join(
    root,
    "visual-qa",
    "local-multimodal-visual-review.json",
  );
  const modelIds = ["gemma3:12b", "qwen2.5vl:7b"];
  const visualQa = stableValue({
    schema_version: "pulse-local-multimodal-visual-review-v1",
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-29T16:45:00.000Z",
    story_id: "official-visual-story",
    verdict: "PASS",
    blockers: [],
    authority: {
      human_review: false,
      approval_authority: false,
      publication_authorised: false,
      may_replace_human_approval: false,
    },
    bindings: {
      final_mp4: {
        path: finalPath,
        sha256: sha256(finalBytes),
      },
    },
    frames: [
      {
        frame_id: "frame-000",
        timestamp_ms: 0,
        path: path.join(root, "visual-qa", "frames", "frame-000.png"),
        sha256: sha256("frame-000"),
        width: 1080,
        height: 1920,
        deterministic_blockers: [],
      },
      {
        frame_id: "frame-12000",
        timestamp_ms: 12000,
        path: path.join(root, "visual-qa", "frames", "frame-12000.png"),
        sha256: sha256("frame-12000"),
        width: 1080,
        height: 1920,
        deterministic_blockers: [],
      },
    ],
    model_aggregation: {
      strategy: "UNANIMOUS_PASS",
      requested_models: modelIds,
      review_count: 2,
      pass_count: 2,
      all_reviews_must_pass: true,
    },
    model_reviews: modelIds.map((model) => ({
      provider: "ollama",
      model,
      verdict: "PASS",
      blockers: [],
      capability_evidence: {
        completion: true,
        vision: true,
      },
    })),
    controls: {
      local_files_only: true,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
      external_network_used: false,
      loopback_inference_only: true,
    },
  });
  const visualQaBytes = Buffer.from(
    `${JSON.stringify(visualQa, null, 2)}\n`,
    "utf8",
  );
  await fs.mkdir(path.dirname(visualQaPath), { recursive: true });
  await fs.writeFile(visualQaPath, visualQaBytes);

  const outputPath = path.join(
    root,
    "visual-gate",
    "autonomous-visual-gate-decision.json",
  );
  return {
    root,
    finalPath,
    finalSha256: sha256(finalBytes),
    visualQa,
    visualQaPath,
    visualQaRawSha256: sha256(visualQaBytes),
    visualQaCanonicalSha256: canonicalSha256(visualQa),
    outputPath,
    request: {
      schema_version: REQUEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      story_id: "official-visual-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      generated_at: "2026-07-29T16:46:00.000Z",
      root_dir: root,
      output_path: outputPath,
      final_mp4: {
        path: finalPath,
        sha256: sha256(finalBytes),
      },
      visual_qa: {
        path: visualQaPath,
        raw_sha256: sha256(visualQaBytes),
        canonical_sha256: canonicalSha256(visualQa),
      },
    },
  };
}

async function rewriteVisualQa(input, mutate) {
  const next = structuredClone(input.visualQa);
  mutate(next);
  const bytes = Buffer.from(
    `${JSON.stringify(stableValue(next), null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(input.visualQaPath, bytes);
  input.request.visual_qa.raw_sha256 = sha256(bytes);
  input.request.visual_qa.canonical_sha256 = canonicalSha256(next);
}

test("materialises an idempotent SYSTEM_POLICY visual decision from two distinct unanimous local models", async (t) => {
  const input = await fixture(t);

  const first =
    await materialiseGovernedAutonomousVisualGateDecision(input.request);
  const replay =
    await materialiseGovernedAutonomousVisualGateDecision(input.request);

  assert.equal(first.status, "CREATED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(first.decision.verdict, "PASS");
  assert.equal(first.decision.decision_authority, "SYSTEM_POLICY");
  assert.equal(
    first.decision.authority_scope,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  assert.deepEqual(first.decision.visual_review_policy, {
    policy_id: "pulse-visual-review-policy",
    policy_version: "2",
    gate: "AUTONOMOUS_OFFICIAL_UNANIMOUS",
    required_report_schema: "pulse-local-multimodal-visual-review-v1",
    required_aggregation: "UNANIMOUS_PASS",
    minimum_distinct_vision_models: 2,
  });
  assert.deepEqual(first.decision.bindings.final_mp4, {
    path: input.finalPath,
    sha256: input.finalSha256,
  });
  assert.deepEqual(first.decision.bindings.visual_qa, {
    path: input.visualQaPath,
    raw_sha256: input.visualQaRawSha256,
    canonical_sha256: input.visualQaCanonicalSha256,
  });
  assert.deepEqual(first.decision.model_evidence, {
    strategy: "UNANIMOUS_PASS",
    model_ids: ["gemma3:12b", "qwen2.5vl:7b"],
    distinct_model_count: 2,
    review_count: 2,
    pass_count: 2,
  });
  assert.deepEqual(first.decision.controls, {
    human_approval: false,
    models_treated_as_humans: false,
    publish_authority: false,
    scheduler_authority: false,
    database_authority: false,
    oauth_or_token_authority: false,
    platform_contacted: false,
    network_used: false,
  });
  assert.equal(first.file_sha256, replay.file_sha256);
  assert.deepEqual(
    JSON.parse(await fs.readFile(input.outputPath, "utf8")),
    first.decision,
  );
});

test("rejects hidden request authority fields at the closed-schema boundary", async (t) => {
  const input = await fixture(t);
  input.request[Symbol("publish_now")] = true;

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(input.request),
    (error) =>
      error?.code === "autonomous_visual_gate_request_fields_invalid",
  );
});

test("rejects a visual-QA frame reference that escapes the local proof root", async (t) => {
  const input = await fixture(t);
  await rewriteVisualQa(input, (report) => {
    report.frames[0].path = path.join(
      path.dirname(input.root),
      "untrusted-frame.png",
    );
  });

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(input.request),
    (error) => error?.code === "autonomous_visual_gate_frame_invalid",
  );
});

test("requires at least two distinct model IDs for autonomous visual policy", async (t) => {
  const input = await fixture(t);
  await rewriteVisualQa(input, (report) => {
    report.model_aggregation.requested_models = ["gemma3:12b"];
    report.model_aggregation.review_count = 1;
    report.model_aggregation.pass_count = 1;
    report.model_reviews = [report.model_reviews[0]];
  });

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(input.request),
    (error) =>
      error?.code === "autonomous_visual_gate_unanimous_pass_required",
  );

  const duplicateInput = await fixture(t);
  await rewriteVisualQa(duplicateInput, (report) => {
    report.model_aggregation.requested_models = [
      "gemma3:12b",
      "gemma3:12b",
    ];
    report.model_reviews[1].model = "gemma3:12b";
  });
  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(
        duplicateInput.request,
      ),
    (error) =>
      error?.code === "autonomous_visual_gate_unanimous_pass_required",
  );
});

test("rejects HOLD evidence instead of converting model output into human approval", async (t) => {
  const input = await fixture(t);
  await rewriteVisualQa(input, (report) => {
    report.verdict = "HOLD";
    report.blockers = ["caption_collides_with_platform_ui"];
    report.model_aggregation.pass_count = 1;
    report.model_reviews[1].verdict = "HOLD";
    report.model_reviews[1].blockers = [
      "caption_collides_with_platform_ui",
    ];
  });

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(input.request),
    (error) =>
      error?.code === "autonomous_visual_gate_unanimous_pass_required",
  );
  await assert.rejects(
    () => fs.stat(input.outputPath),
    (error) => error?.code === "ENOENT",
  );
});

test("rejects raw, canonical and final-media hash drift", async (t) => {
  const rawDrift = await fixture(t);
  rawDrift.request.visual_qa.raw_sha256 = sha256(
    "different-raw-visual-qa",
  );
  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(rawDrift.request),
    (error) =>
      error?.code === "autonomous_visual_gate_visual_qa_sha256_mismatch",
  );

  const canonicalDrift = await fixture(t);
  canonicalDrift.request.visual_qa.canonical_sha256 = sha256(
    "different-canonical-visual-qa",
  );
  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(
        canonicalDrift.request,
      ),
    (error) =>
      error?.code ===
      "autonomous_visual_gate_visual_qa_canonical_sha256_mismatch",
  );

  const finalDrift = await fixture(t);
  finalDrift.request.final_mp4.sha256 = sha256(
    "different-final-media",
  );
  await assert.rejects(
    () =>
      materialiseGovernedAutonomousVisualGateDecision(finalDrift.request),
    (error) =>
      error?.code === "autonomous_visual_gate_final_mp4_sha256_mismatch",
  );
});
