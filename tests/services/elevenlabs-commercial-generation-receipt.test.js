"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  materializeElevenLabsCommercialGenerationReceipt,
} = require("../../lib/services/elevenlabs-commercial-generation-receipt");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-commercial-receipt-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const audioPath = path.join(root, "narration", "narration.mp3");
  const outputPath = path.join(
    root,
    "narration",
    "elevenlabs-generation-receipt.json",
  );
  const audioBytes = Buffer.from("exact-mastered-elevenlabs-audio", "utf8");
  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await fs.writeFile(audioPath, audioBytes);
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "GENERATION_EVIDENCE",
    story_id: "official-xbox-story-001",
    generated_at: "2026-07-29T16:00:02.000Z",
    root_dir: root,
    output_path: outputPath,
    request_text: "Exact locked narration for the official Xbox story.",
    provider: {
      id: "elevenlabs",
      model_id: "eleven_multilingual_v2",
      voice_id: "pulse-voice",
      http_status: 200,
      provider_result_recorded: true,
    },
    credit_report: {
      schema_version: "pulse-elevenlabs-credit-preflight-v1",
      generated_at: "2026-07-29T16:00:00.000Z",
      provider: "elevenlabs",
      tier: "pro",
      status: "active",
      included_credit_limit: 500000,
      included_credits_remaining: 400000,
      idempotency_key_hash: "b".repeat(64),
      durable_reservation_state: "reserved",
      verdict: "ALLOW",
      warnings: [],
    },
    audio: {
      path: audioPath,
      sha256: sha256(audioBytes),
      transform_status: "COMPLETE",
      post_generation_transform_status: "COMPLETE",
    },
    allowed_platforms: ["youtube_shorts"],
  };
  return { root, audioPath, outputPath, audioBytes, request };
}

test("materialises one hash-bound paid ElevenLabs generation receipt and replays it idempotently", async (t) => {
  const input = await fixture(t);

  const first =
    await materializeElevenLabsCommercialGenerationReceipt(input.request);
  const repeated =
    await materializeElevenLabsCommercialGenerationReceipt(input.request);

  assert.equal(first.status, "CREATED");
  assert.equal(repeated.status, "REPLAYED");
  assert.equal(first.file_sha256, repeated.file_sha256);
  assert.equal(first.receipt.receipt_sha256, repeated.receipt.receipt_sha256);
  assert.equal(
    first.receipt.schema,
    "pulse_elevenlabs_generation_receipt_v1",
  );
  assert.equal(first.receipt.schema_version, 1);
  assert.equal(first.receipt.story_id, input.request.story_id);
  assert.equal(first.receipt.verdict, "AMBER");
  assert.equal(first.receipt.generation_verdict, "GREEN");
  assert.equal(first.receipt.final_media_lineage_status, "PENDING");
  assert.equal(first.receipt.commercial_use_allowed, false);
  assert.deepEqual(first.receipt.generation_blockers, []);
  assert.deepEqual(first.receipt.blockers, [
    "final_media_lineage_pending",
  ]);
  assert.equal(
    first.receipt.generation.request_text_sha256,
    sha256(input.request.request_text),
  );
  assert.equal(
    first.receipt.mastering_lineage.mastered_audio_sha256,
    sha256(input.audioBytes),
  );
  assert.equal(
    first.receipt.account_entitlement.paid_at_generation,
    true,
  );
  assert.equal(
    first.receipt.generation_checks.every_generation_condition_proven,
    true,
  );
  assert.deepEqual(first.receipt.allowed_platforms, ["youtube_shorts"]);
  assert.equal(first.safety.publish_authority, false);
  assert.equal(first.safety.database_mutated, false);
  assert.equal(first.safety.oauth_or_tokens_mutated, false);
  assert.equal(first.safety.network_used, false);
  const persisted = await fs.readFile(input.outputPath, "utf8");
  assert.equal(sha256(Buffer.from(persisted, "utf8")), first.file_sha256);
  assert.doesNotMatch(persisted, /Exact locked narration/);
  assert.doesNotMatch(
    persisted,
    /"(?:api[_-]?key|token|secret)"\s*:/i,
  );
});

test("fails closed when the entitlement is free, inactive or not an exact provider snapshot", async (t) => {
  const input = await fixture(t);
  for (const [field, value, code] of [
    ["tier", "free", "elevenlabs_generation_paid_entitlement_required"],
    ["status", "inactive", "elevenlabs_generation_paid_entitlement_required"],
    [
      "schema_version",
      "other-schema",
      "elevenlabs_generation_credit_report_invalid",
    ],
  ]) {
    const request = structuredClone(input.request);
    request.output_path = path.join(
      input.root,
      "narration",
      `receipt-${field}-${value}.json`,
    );
    request.credit_report[field] = value;
    await assert.rejects(
      () => materializeElevenLabsCommercialGenerationReceipt(request),
      (error) => error?.code === code,
    );
    await assert.rejects(
      () => fs.access(request.output_path),
      (error) => error?.code === "ENOENT",
    );
  }
});

test("fails closed on audio drift, an external output path or an existing conflicting receipt", async (t) => {
  const input = await fixture(t);
  const drifted = structuredClone(input.request);
  drifted.audio.sha256 = "c".repeat(64);
  await assert.rejects(
    () => materializeElevenLabsCommercialGenerationReceipt(drifted),
    (error) => error?.code === "elevenlabs_generation_audio_sha256_mismatch",
  );

  const external = structuredClone(input.request);
  external.output_path = path.join(
    path.dirname(input.root),
    "outside-receipt.json",
  );
  await assert.rejects(
    () => materializeElevenLabsCommercialGenerationReceipt(external),
    (error) => error?.code === "elevenlabs_generation_output_outside_root",
  );

  await fs.writeFile(input.outputPath, "{}\n", "utf8");
  await assert.rejects(
    () => materializeElevenLabsCommercialGenerationReceipt(input.request),
    (error) => error?.code === "elevenlabs_generation_receipt_conflict",
  );
});
