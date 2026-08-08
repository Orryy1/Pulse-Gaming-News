"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION =
  "pulse-governed-autonomous-narration-timing-evidence-v1";
const NARRATION_TIMING_EVIDENCE_REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-narration-timing-evidence-request-v1";
const MODE = "LOCAL_PROOF";
const DURATION_BAND_ID =
  "what_changes_breaking_flash_18_24";
const MINIMUM_TARGET_SECONDS = 18;
const MAXIMUM_TARGET_SECONDS = 24;
const END_BEAT_SECONDS = 0.35;
const MAXIMUM_NARRATION_TAIL_SECONDS = 1.5;
const TIMING_TOLERANCE_SECONDS = 0.1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_FIELDS = new Set([
  "alignment_end_seconds",
  "alignment_sha256",
  "audio_duration_seconds",
  "audio_sha256",
  "generated_at",
  "legacy_story_id",
  "mode",
  "provider",
  "provider_result_sha256",
  "reviewed_at",
  "schema_version",
  "script_sha256",
  "state_root",
  "story_id",
]);
const EVIDENCE_FIELDS = new Set([
  "alignment",
  "audio",
  "duration_band_id",
  "generated_at",
  "legacy_story_id",
  "mode",
  "provider",
  "provider_result",
  "reviewed_at",
  "safety",
  "schema_version",
  "script_sha256",
  "story_id",
  "target",
]);
const PROVIDER_FIELDS = new Set([
  "model_id",
  "provider",
  "speed",
  "voice_id",
]);
const PROVIDER_RESULT_FIELDS = new Set(["sha256"]);
const AUDIO_FIELDS = new Set(["duration_seconds", "sha256"]);
const ALIGNMENT_FIELDS = new Set(["end_seconds", "sha256"]);
const TARGET_FIELDS = new Set([
  "duration_seconds",
  "end_beat_seconds",
  "narration_tail_seconds",
]);
const SAFETY_FIELDS = new Set([
  "database_mutated",
  "external_posting",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority_created",
]);

class GovernedAutonomousNarrationTimingEvidenceError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name =
      "GovernedAutonomousNarrationTimingEvidenceError";
    this.code = code;
  }
}

function fail(code, cause = null) {
  throw new GovernedAutonomousNarrationTimingEvidenceError(
    code,
    cause,
  );
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
  if (
    !plainObject(value) ||
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((field) => !fields.has(field))
  ) {
    fail(code);
  }
  return value;
}

function text(value) {
  return String(value ?? "").trim();
}

function exactSha256(value, code, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const milliseconds = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== raw
  ) {
    fail(code);
  }
  return { raw, milliseconds };
}

function exactStoryId(value, code) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) fail(code);
  return storyId;
}

function exactPositiveNumber(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(code);
  return number;
}

function roundSeconds(value) {
  return Number(Number(value).toFixed(6));
}

function deepFreeze(value) {
  if (
    value &&
    typeof value === "object" &&
    !Object.isFrozen(value)
  ) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
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

function governedAutonomousNarrationTimingEvidencePath({
  stateRoot,
  legacyStoryId,
  scriptSha256,
} = {}) {
  const root = text(stateRoot);
  if (
    !root ||
    !path.isAbsolute(root) ||
    path.resolve(root) !== root
  ) {
    fail("narration_timing_evidence_state_root_invalid");
  }
  const storyId = exactStoryId(
    legacyStoryId,
    "narration_timing_evidence_legacy_story_id_invalid",
  );
  const scriptHash = exactSha256(
    scriptSha256,
    "narration_timing_evidence_script_sha256_invalid",
  );
  const storyKey = crypto
    .createHash("sha256")
    .update(storyId)
    .digest("hex");
  return path.join(
    root,
    "narration-timing-evidence",
    storyKey,
    `${scriptHash}.json`,
  );
}

async function discoverGovernedAutonomousNarrationTimingEvidence(
  value,
  options = {},
) {
  const expectedStoryId = exactStoryId(
    value?.storyId,
    "narration_timing_evidence_expected_story_id_invalid",
  );
  const expectedLegacyStoryId = exactStoryId(
    value?.legacyStoryId,
    "narration_timing_evidence_legacy_story_id_invalid",
  );
  const expectedScriptSha256 = exactSha256(
    value?.scriptSha256,
    "narration_timing_evidence_script_sha256_invalid",
  );
  const expectedProvider = normaliseProvider(
    value?.provider,
    "narration_timing_evidence_expected_provider_invalid",
  );
  const fileSystem = options.fileSystem || defaultFileSystem;
  const filePath =
    governedAutonomousNarrationTimingEvidencePath({
      stateRoot: value?.stateRoot,
      legacyStoryId: expectedLegacyStoryId,
      scriptSha256: expectedScriptSha256,
    });
  let fileStat;
  try {
    fileStat = await fileSystem.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("narration_timing_evidence_discovery_failed", error);
  }
  if (
    !fileStat.isFile() ||
    fileStat.isSymbolicLink() ||
    fileStat.size < 1 ||
    fileStat.size > 1024 * 1024
  ) {
    fail("narration_timing_evidence_cache_file_invalid");
  }
  const stateRoot = path.resolve(value.stateRoot);
  let realPath;
  try {
    realPath = path.resolve(await fileSystem.realpath(filePath));
  } catch (error) {
    fail("narration_timing_evidence_discovery_failed", error);
  }
  if (!pathWithin(stateRoot, realPath)) {
    fail("narration_timing_evidence_cache_path_outside_state_root");
  }
  let bytes;
  try {
    bytes = await fileSystem.readFile(realPath);
  } catch (error) {
    fail("narration_timing_evidence_discovery_failed", error);
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
    validateGovernedAutonomousNarrationTimingEvidence(
      evidence,
      {
        storyId: expectedStoryId,
        legacyStoryId: expectedLegacyStoryId,
        scriptSha256: expectedScriptSha256,
        provider: expectedProvider,
        requireAudioSha256: true,
      },
    );
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousNarrationTimingEvidenceError
    ) {
      throw error;
    }
    fail("narration_timing_evidence_cache_json_invalid", error);
  }
  return deepFreeze({
    path: filePath,
    file_sha256: crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex"),
  });
}

function normaliseProvider(value, code) {
  exactFields(value, PROVIDER_FIELDS, code);
  const provider = text(value.provider).toLowerCase();
  const voiceId = text(value.voice_id);
  const modelId = text(value.model_id);
  const speed = Number(value.speed);
  if (
    provider !== "elevenlabs" ||
    !voiceId ||
    !modelId ||
    !Number.isFinite(speed) ||
    speed < 0.7 ||
    speed > 1.2
  ) {
    fail(code);
  }
  return {
    provider,
    voice_id: voiceId,
    model_id: modelId,
    speed,
  };
}

function sameProvider(left, right) {
  return (
    left.provider === right.provider &&
    left.voice_id === right.voice_id &&
    left.model_id === right.model_id &&
    left.speed === right.speed
  );
}

function deriveTarget({
  audioDurationSeconds,
  alignmentEndSeconds,
}) {
  if (
    alignmentEndSeconds >
    audioDurationSeconds + TIMING_TOLERANCE_SECONDS
  ) {
    fail("narration_timing_evidence_alignment_exceeds_audio");
  }
  const targetDurationSeconds = roundSeconds(
    Math.max(
      MINIMUM_TARGET_SECONDS,
      audioDurationSeconds + END_BEAT_SECONDS,
    ),
  );
  if (targetDurationSeconds > MAXIMUM_TARGET_SECONDS) {
    fail("narration_timing_evidence_target_outside_band");
  }
  const narrationTailSeconds = roundSeconds(
    targetDurationSeconds - alignmentEndSeconds,
  );
  if (
    narrationTailSeconds < 0 ||
    narrationTailSeconds >
      MAXIMUM_NARRATION_TAIL_SECONDS
  ) {
    fail("narration_timing_evidence_tail_excessive");
  }
  return {
    duration_seconds: targetDurationSeconds,
    end_beat_seconds: END_BEAT_SECONDS,
    narration_tail_seconds: narrationTailSeconds,
  };
}

function validateGovernedAutonomousNarrationTimingEvidence(
  value,
  expected = {},
) {
  exactFields(
    value,
    EVIDENCE_FIELDS,
    "narration_timing_evidence_fields_invalid",
  );
  if (
    value.schema_version !==
      NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.duration_band_id !== DURATION_BAND_ID
  ) {
    fail("narration_timing_evidence_schema_invalid");
  }
  const storyId = exactStoryId(
    value.story_id,
    "narration_timing_evidence_story_id_invalid",
  );
  const legacyStoryId = exactStoryId(
    value.legacy_story_id,
    "narration_timing_evidence_legacy_story_id_invalid",
  );
  const scriptSha256 = exactSha256(
    value.script_sha256,
    "narration_timing_evidence_script_sha256_invalid",
  );
  const provider = normaliseProvider(
    value.provider,
    "narration_timing_evidence_provider_invalid",
  );
  exactFields(
    value.provider_result,
    PROVIDER_RESULT_FIELDS,
    "narration_timing_evidence_provider_result_fields_invalid",
  );
  const providerResultSha256 = exactSha256(
    value.provider_result.sha256,
    "narration_timing_evidence_provider_result_sha256_invalid",
  );
  exactFields(
    value.audio,
    AUDIO_FIELDS,
    "narration_timing_evidence_audio_fields_invalid",
  );
  const audioSha256 = exactSha256(
    value.audio.sha256,
    "narration_timing_evidence_audio_sha256_invalid",
    { nullable: true },
  );
  if (expected.requireAudioSha256 === true && !audioSha256) {
    fail("narration_timing_evidence_audio_sha256_required");
  }
  const audioDurationSeconds = exactPositiveNumber(
    value.audio.duration_seconds,
    "narration_timing_evidence_audio_duration_invalid",
  );
  exactFields(
    value.alignment,
    ALIGNMENT_FIELDS,
    "narration_timing_evidence_alignment_fields_invalid",
  );
  const alignmentSha256 = exactSha256(
    value.alignment.sha256,
    "narration_timing_evidence_alignment_sha256_invalid",
  );
  const alignmentEndSeconds = exactPositiveNumber(
    value.alignment.end_seconds,
    "narration_timing_evidence_alignment_end_invalid",
  );
  const generated = exactTimestamp(
    value.generated_at,
    "narration_timing_evidence_generated_at_invalid",
  );
  const reviewed = exactTimestamp(
    value.reviewed_at,
    "narration_timing_evidence_reviewed_at_invalid",
  );
  if (reviewed.milliseconds < generated.milliseconds) {
    fail("narration_timing_evidence_review_time_invalid");
  }
  exactFields(
    value.target,
    TARGET_FIELDS,
    "narration_timing_evidence_target_fields_invalid",
  );
  const target = deriveTarget({
    audioDurationSeconds,
    alignmentEndSeconds,
  });
  if (
    Number(value.target.duration_seconds) !==
      target.duration_seconds ||
    Number(value.target.end_beat_seconds) !==
      target.end_beat_seconds ||
    Number(value.target.narration_tail_seconds) !==
      target.narration_tail_seconds
  ) {
    fail("narration_timing_evidence_target_mismatch");
  }
  exactFields(
    value.safety,
    SAFETY_FIELDS,
    "narration_timing_evidence_safety_fields_invalid",
  );
  if (
    Object.values(value.safety).some((entry) => entry !== false)
  ) {
    fail("narration_timing_evidence_safety_invalid");
  }

  const expectedStoryId = text(expected.storyId);
  const expectedLegacyStoryId = text(expected.legacyStoryId);
  const expectedScriptSha256 = text(
    expected.scriptSha256,
  ).toLowerCase();
  const expectedProviderResultSha256 = text(
    expected.providerResultSha256,
  ).toLowerCase();
  const expectedAudioSha256 = text(
    expected.audioSha256,
  ).toLowerCase();
  const expectedAlignmentSha256 = text(
    expected.alignmentSha256,
  ).toLowerCase();
  const expectedProvider = expected.provider
    ? normaliseProvider(
        expected.provider,
        "narration_timing_evidence_expected_provider_invalid",
      )
    : null;
  if (
    (expectedStoryId && storyId !== expectedStoryId) ||
    (expectedLegacyStoryId &&
      legacyStoryId !== expectedLegacyStoryId) ||
    (expectedScriptSha256 &&
      scriptSha256 !== expectedScriptSha256) ||
    (expectedProviderResultSha256 &&
      providerResultSha256 !==
        expectedProviderResultSha256) ||
    (expectedAudioSha256 &&
      audioSha256 !== expectedAudioSha256) ||
    (expectedAlignmentSha256 &&
      alignmentSha256 !== expectedAlignmentSha256) ||
    (expectedProvider &&
      !sameProvider(provider, expectedProvider))
  ) {
    fail("narration_timing_evidence_binding_mismatch");
  }

  return deepFreeze({
    schema_version:
      NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION,
    mode: MODE,
    story_id: storyId,
    legacy_story_id: legacyStoryId,
    script_sha256: scriptSha256,
    provider,
    provider_result: {
      sha256: providerResultSha256,
    },
    audio: {
      sha256: audioSha256,
      duration_seconds: audioDurationSeconds,
    },
    alignment: {
      sha256: alignmentSha256,
      end_seconds: alignmentEndSeconds,
    },
    duration_band_id: DURATION_BAND_ID,
    target,
    generated_at: generated.raw,
    reviewed_at: reviewed.raw,
    safety: {
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
      external_posting: false,
    },
  });
}

async function materializeGovernedAutonomousNarrationTimingEvidence(
  value,
  options = {},
) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "narration_timing_evidence_request_fields_invalid",
  );
  if (
    value.schema_version !==
      NARRATION_TIMING_EVIDENCE_REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("narration_timing_evidence_local_proof_only");
  }
  const outputPath =
    governedAutonomousNarrationTimingEvidencePath({
      stateRoot: value.state_root,
      legacyStoryId: value.legacy_story_id,
      scriptSha256: value.script_sha256,
    });
  const evidence =
    validateGovernedAutonomousNarrationTimingEvidence(
      {
        schema_version:
          NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION,
        mode: MODE,
        story_id: value.story_id,
        legacy_story_id: value.legacy_story_id,
        script_sha256: value.script_sha256,
        provider: value.provider,
        provider_result: {
          sha256: value.provider_result_sha256,
        },
        audio: {
          sha256: value.audio_sha256,
          duration_seconds: value.audio_duration_seconds,
        },
        alignment: {
          sha256: value.alignment_sha256,
          end_seconds: value.alignment_end_seconds,
        },
        duration_band_id: DURATION_BAND_ID,
        target: deriveTarget({
          audioDurationSeconds: exactPositiveNumber(
            value.audio_duration_seconds,
            "narration_timing_evidence_audio_duration_invalid",
          ),
          alignmentEndSeconds: exactPositiveNumber(
            value.alignment_end_seconds,
            "narration_timing_evidence_alignment_end_invalid",
          ),
        }),
        generated_at: value.generated_at,
        reviewed_at: value.reviewed_at,
        safety: {
          database_mutated: false,
          oauth_or_tokens_mutated: false,
          platform_contacted: false,
          publish_authority_created: false,
          external_posting: false,
        },
      },
      {
        storyId: value.story_id,
        legacyStoryId: value.legacy_story_id,
        scriptSha256: value.script_sha256,
        provider: value.provider,
        providerResultSha256:
          value.provider_result_sha256,
        alignmentSha256: value.alignment_sha256,
        requireAudioSha256: true,
      },
    );
  const bytes = Buffer.from(
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  const fileSystem = options.fileSystem || defaultFileSystem;
  await fileSystem.mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  const fileSha256 = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  let replayed = false;
  try {
    const existingStat = await fileSystem.lstat(outputPath);
    if (
      !existingStat.isFile() ||
      existingStat.isSymbolicLink() ||
      existingStat.size < 1 ||
      existingStat.size > 1024 * 1024
    ) {
      fail("narration_timing_evidence_existing_file_invalid");
    }
    const existing = await fileSystem.readFile(outputPath);
    if (
      crypto.createHash("sha256").update(existing).digest("hex") !==
      fileSha256
    ) {
      fail("narration_timing_evidence_conflict");
    }
    replayed = true;
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousNarrationTimingEvidenceError
    ) {
      throw error;
    }
    if (error?.code !== "ENOENT") {
      fail("narration_timing_evidence_read_failed", error);
    }
  }
  if (replayed) {
    return deepFreeze({
      path: outputPath,
      file_sha256: fileSha256,
      evidence,
      replayed: true,
    });
  }
  const temporaryPath =
    `${outputPath}.${process.pid}.${Date.now()}.` +
    `${crypto.randomUUID()}.tmp`;
  try {
    await fileSystem.writeFile(temporaryPath, bytes, {
      flag: "wx",
    });
    try {
      await fileSystem.link(temporaryPath, outputPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await fileSystem.readFile(outputPath);
      if (
        crypto
          .createHash("sha256")
          .update(existing)
          .digest("hex") !== fileSha256
      ) {
        fail("narration_timing_evidence_conflict");
      }
      replayed = true;
    }
    await fileSystem.rm(temporaryPath, { force: true });
  } catch (error) {
    await fileSystem.rm(temporaryPath, { force: true });
    if (
      error instanceof
      GovernedAutonomousNarrationTimingEvidenceError
    ) {
      throw error;
    }
    fail("narration_timing_evidence_write_failed", error);
  }
  return deepFreeze({
    path: outputPath,
    file_sha256: fileSha256,
    evidence,
    replayed,
  });
}

module.exports = {
  DURATION_BAND_ID,
  END_BEAT_SECONDS,
  GovernedAutonomousNarrationTimingEvidenceError,
  MAXIMUM_NARRATION_TAIL_SECONDS,
  NARRATION_TIMING_EVIDENCE_REQUEST_SCHEMA_VERSION,
  NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION,
  discoverGovernedAutonomousNarrationTimingEvidence,
  governedAutonomousNarrationTimingEvidencePath,
  materializeGovernedAutonomousNarrationTimingEvidence,
  validateGovernedAutonomousNarrationTimingEvidence,
};
