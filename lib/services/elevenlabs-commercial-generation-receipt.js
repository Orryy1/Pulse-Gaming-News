"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION =
  "pulse-elevenlabs-commercial-generation-receipt-request-v1";
const RECEIPT_SCHEMA = "pulse_elevenlabs_generation_receipt_v1";
const MODE = "GENERATION_EVIDENCE";
const CREDIT_REPORT_SCHEMA =
  "pulse-elevenlabs-credit-preflight-v1";
const MAX_ENTITLEMENT_AGE_MS = 5 * 60 * 1000;
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "generated_at",
  "root_dir",
  "output_path",
  "request_text",
  "provider",
  "credit_report",
  "audio",
  "allowed_platforms",
]);
const PROVIDER_FIELDS = new Set([
  "id",
  "model_id",
  "voice_id",
  "http_status",
  "provider_result_recorded",
]);
const AUDIO_FIELDS = new Set([
  "path",
  "sha256",
  "transform_status",
  "post_generation_transform_status",
]);

class ElevenLabsCommercialGenerationReceiptError extends Error {
  constructor(code) {
    super(code);
    this.name = "ElevenLabsCommercialGenerationReceiptError";
    this.code = code;
  }
}

function fail(code) {
  throw new ElevenLabsCommercialGenerationReceiptError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  const normalised = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(normalised)) fail(code);
  return normalised;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return { raw, timestamp };
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function sameIdentity(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

async function exactRoot(rootPath, fileSystem) {
  const resolved = path.resolve(text(rootPath));
  if (!path.isAbsolute(text(rootPath))) {
    fail("elevenlabs_generation_root_invalid");
  }
  let stat;
  try {
    stat = await fileSystem.lstat(resolved, { bigint: true });
  } catch {
    fail("elevenlabs_generation_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("elevenlabs_generation_root_invalid");
  }
  const realPath = await fileSystem.realpath(resolved);
  if (path.resolve(realPath) !== resolved) {
    fail("elevenlabs_generation_root_link_forbidden");
  }
  return { path: resolved, real_path: realPath };
}

async function assertContainedComponents(
  root,
  candidate,
  {
    fileSystem,
    allowMissingLeaf = false,
    code,
  },
) {
  if (!pathWithin(root.path, candidate)) fail(code);
  const relative = path.relative(root.path, candidate);
  const parts = relative.split(path.sep).filter(Boolean);
  let cursor = root.path;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor, { bigint: true });
    } catch (error) {
      if (
        allowMissingLeaf &&
        error?.code === "ENOENT" &&
        index === parts.length - 1
      ) {
        return;
      }
      fail(code);
    }
    if (stat.isSymbolicLink()) fail(code);
    const realPath = await fileSystem.realpath(cursor);
    if (!pathWithin(root.real_path, realPath)) fail(code);
  }
}

async function readExactAudio({
  root,
  audioPath,
  expectedSha256,
  fileSystem,
}) {
  const resolved = path.resolve(audioPath);
  await assertContainedComponents(root, resolved, {
    fileSystem,
    code: "elevenlabs_generation_audio_invalid",
  });
  const initial = await fileSystem.lstat(resolved, { bigint: true });
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(MAX_AUDIO_BYTES) ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail("elevenlabs_generation_audio_invalid");
  }
  const handle = await fileSystem.open(resolved, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(initial, opened)) {
      fail("elevenlabs_generation_audio_changed_during_read");
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const finalPathStat = await fileSystem.lstat(resolved, {
      bigint: true,
    });
    if (
      offset !== bytes.length ||
      !sameIdentity(opened, completed) ||
      !sameIdentity(opened, finalPathStat)
    ) {
      fail("elevenlabs_generation_audio_changed_during_read");
    }
    const observedSha256 = sha256Bytes(bytes);
    if (observedSha256 !== expectedSha256) {
      fail("elevenlabs_generation_audio_sha256_mismatch");
    }
    return { bytes, observed_sha256: observedSha256 };
  } finally {
    await handle.close();
  }
}

function exactCreditReport(value, generatedAt) {
  if (!plainObject(value)) {
    fail("elevenlabs_generation_credit_report_invalid");
  }
  const observedAt = exactTimestamp(
    value.generated_at,
    "elevenlabs_generation_credit_report_invalid",
  );
  const reportGeneratedAge = generatedAt.timestamp - observedAt.timestamp;
  const limit = Number(value.included_credit_limit);
  const remaining = Number(value.included_credits_remaining);
  const tier = text(value.tier).toLowerCase();
  const status = text(value.status).toLowerCase();
  const verdict = text(value.verdict).toUpperCase();
  if (
    value.schema_version !== CREDIT_REPORT_SCHEMA ||
    text(value.provider).toLowerCase() !== "elevenlabs" ||
    reportGeneratedAge < 0 ||
    reportGeneratedAge > MAX_ENTITLEMENT_AGE_MS ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    !Number.isFinite(remaining) ||
    remaining < 0 ||
    remaining > limit ||
    !SHA256_PATTERN.test(
      text(value.idempotency_key_hash).toLowerCase(),
    ) ||
    !["ALLOW", "REPLAY"].includes(verdict) ||
    !Array.isArray(value.warnings)
  ) {
    fail("elevenlabs_generation_credit_report_invalid");
  }
  if (!tier || tier === "free" || status !== "active") {
    fail("elevenlabs_generation_paid_entitlement_required");
  }
  return {
    paid_at_generation: true,
    tier,
    status,
    observed_at: observedAt.raw,
    included_credit_limit: limit,
    included_credits_remaining: remaining,
    credit_report_sha256: canonicalSha256(value),
    credit_verdict: verdict,
    durable_reservation_state:
      text(value.durable_reservation_state) || null,
  };
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "elevenlabs_generation_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("elevenlabs_generation_request_schema_invalid");
  }
  const storyId = text(value.story_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("elevenlabs_generation_story_id_invalid");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "elevenlabs_generation_time_invalid",
  );
  const requestText = String(value.request_text ?? "");
  if (!requestText.trim()) {
    fail("elevenlabs_generation_request_text_required");
  }
  exactFields(
    value.provider,
    PROVIDER_FIELDS,
    "elevenlabs_generation_provider_invalid",
  );
  const provider = {
    id: text(value.provider.id).toLowerCase(),
    model_id: text(value.provider.model_id),
    voice_id: text(value.provider.voice_id),
    http_status: Number(value.provider.http_status),
    provider_result_recorded:
      value.provider.provider_result_recorded,
  };
  if (
    provider.id !== "elevenlabs" ||
    !provider.model_id ||
    !provider.voice_id ||
    !Number.isInteger(provider.http_status) ||
    provider.http_status < 200 ||
    provider.http_status >= 300 ||
    provider.provider_result_recorded !== true
  ) {
    fail("elevenlabs_generation_provider_invalid");
  }
  exactFields(
    value.audio,
    AUDIO_FIELDS,
    "elevenlabs_generation_audio_invalid",
  );
  const audioPath = text(value.audio.path);
  if (!audioPath || !path.isAbsolute(audioPath)) {
    fail("elevenlabs_generation_audio_invalid");
  }
  if (
    text(value.audio.transform_status).toUpperCase() !== "COMPLETE" ||
    text(
      value.audio.post_generation_transform_status,
    ).toUpperCase() !== "COMPLETE"
  ) {
    fail("elevenlabs_generation_mastering_incomplete");
  }
  if (
    !Array.isArray(value.allowed_platforms) ||
    value.allowed_platforms.length !== 1 ||
    value.allowed_platforms[0] !== "youtube_shorts"
  ) {
    fail("elevenlabs_generation_allowed_platforms_invalid");
  }
  const rootDir = text(value.root_dir);
  const outputPath = text(value.output_path);
  if (
    !rootDir ||
    !path.isAbsolute(rootDir) ||
    !outputPath ||
    !path.isAbsolute(outputPath)
  ) {
    fail("elevenlabs_generation_output_invalid");
  }
  return {
    story_id: storyId,
    generated_at: generatedAt,
    root_dir: path.resolve(rootDir),
    output_path: path.resolve(outputPath),
    request_text_sha256: sha256Bytes(Buffer.from(requestText, "utf8")),
    provider,
    account_entitlement: exactCreditReport(
      value.credit_report,
      generatedAt,
    ),
    audio: {
      path: path.resolve(audioPath),
      sha256: exactSha256(
        value.audio.sha256,
        "elevenlabs_generation_audio_sha256_invalid",
      ),
      transform_status: "COMPLETE",
      post_generation_transform_status: "COMPLETE",
    },
    allowed_platforms: ["youtube_shorts"],
  };
}

function receiptFor(request) {
  const base = stableValue({
    schema: RECEIPT_SCHEMA,
    schema_version: 1,
    story_id: request.story_id,
    generated_at: request.generated_at.raw,
    verdict: "AMBER",
    generation_verdict: "GREEN",
    final_media_lineage_status: "PENDING",
    commercial_use_allowed: false,
    provider: {
      id: request.provider.id,
      model_id: request.provider.model_id,
      voice_id: request.provider.voice_id,
    },
    account_entitlement: request.account_entitlement,
    generation: {
      request_text_sha256: request.request_text_sha256,
      provider_http_status: request.provider.http_status,
      provider_result_recorded:
        request.provider.provider_result_recorded,
    },
    generation_checks: {
      paid_entitlement_observed: true,
      provider_success_recorded: true,
      exact_request_text_hash_recorded: true,
      exact_mastered_audio_hash_recorded: true,
      every_generation_condition_proven: true,
    },
    generation_blockers: [],
    blockers: ["final_media_lineage_pending"],
    licence_basis: "elevenlabs_commercial_tts_generation",
    allowed_platforms: request.allowed_platforms,
    mastering_lineage: {
      mastered_audio_sha256: request.audio.sha256,
      transform_status: request.audio.transform_status,
      post_generation_transform_status:
        request.audio.post_generation_transform_status,
    },
    safety: {
      publish_authority: false,
      external_publish_authorised: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      network_used: false,
    },
  });
  return {
    ...base,
    receipt_sha256: canonicalSha256(base),
  };
}

async function writeReceiptIdempotently({
  outputPath,
  bytes,
  fileSystem,
}) {
  try {
    const existing = await fileSystem.readFile(outputPath);
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("elevenlabs_generation_receipt_conflict");
  } catch (error) {
    if (
      error instanceof ElevenLabsCommercialGenerationReceiptError
    ) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  let handle;
  try {
    handle = await fileSystem.open(outputPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = await fileSystem.readFile(outputPath);
      if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
      fail("elevenlabs_generation_receipt_conflict");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return "CREATED";
}

async function materializeElevenLabsCommercialGenerationReceipt(
  value,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const request = normaliseRequest(value);
  const root = await exactRoot(request.root_dir, fileSystem);
  if (!pathWithin(root.path, request.output_path)) {
    fail("elevenlabs_generation_output_outside_root");
  }
  if (!pathWithin(root.path, request.audio.path)) {
    fail("elevenlabs_generation_audio_outside_root");
  }
  const outputParent = path.dirname(request.output_path);
  await fileSystem.mkdir(outputParent, { recursive: true });
  await assertContainedComponents(root, outputParent, {
    fileSystem,
    code: "elevenlabs_generation_output_parent_invalid",
  });
  await assertContainedComponents(root, request.output_path, {
    fileSystem,
    allowMissingLeaf: true,
    code: "elevenlabs_generation_output_invalid",
  });
  const observedAudio = await readExactAudio({
    root,
    audioPath: request.audio.path,
    expectedSha256: request.audio.sha256,
    fileSystem,
  });
  const receipt = receiptFor({
    ...request,
    audio: {
      ...request.audio,
      sha256: observedAudio.observed_sha256,
    },
  });
  const bytes = Buffer.from(
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  const status = await writeReceiptIdempotently({
    outputPath: request.output_path,
    bytes,
    fileSystem,
  });
  return Object.freeze({
    status,
    path: request.output_path,
    file_sha256: sha256Bytes(bytes),
    receipt,
    safety: receipt.safety,
  });
}

module.exports = {
  CREDIT_REPORT_SCHEMA,
  ElevenLabsCommercialGenerationReceiptError,
  MODE,
  RECEIPT_SCHEMA,
  REQUEST_SCHEMA_VERSION,
  canonicalSha256,
  materializeElevenLabsCommercialGenerationReceipt,
};
