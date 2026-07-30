"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION,
  discoverGovernedAutonomousNarrationTimingEvidence,
  governedAutonomousNarrationTimingEvidencePath,
  materializeGovernedAutonomousNarrationTimingEvidence,
  validateGovernedAutonomousNarrationTimingEvidence,
} = require("../../lib/services/governed-autonomous-narration-timing-evidence");

const SCRIPT_SHA256 = "a".repeat(64);
const AUDIO_SHA256 = "b".repeat(64);
const PROVIDER_RESULT_SHA256 = "c".repeat(64);
const ALIGNMENT_SHA256 = "d".repeat(64);
const GENERATED_AT = "2026-07-30T18:00:00.000Z";
const REVIEWED_AT = "2026-07-30T18:00:01.000Z";

function request(overrides = {}) {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-narration-timing-"),
  );
  return {
    schema_version:
      "pulse-governed-autonomous-narration-timing-evidence-request-v1",
    mode: "LOCAL_PROOF",
    story_id: "official_timing-primary",
    legacy_story_id: "rss_exact-story",
    script_sha256: SCRIPT_SHA256,
    provider: {
      provider: "elevenlabs",
      voice_id: "voice-bound",
      model_id: "eleven_multilingual_v2",
      speed: 1,
    },
    provider_result_sha256: PROVIDER_RESULT_SHA256,
    audio_sha256: AUDIO_SHA256,
    audio_duration_seconds: 19.691,
    alignment_sha256: ALIGNMENT_SHA256,
    alignment_end_seconds: 19.691,
    generated_at: GENERATED_AT,
    reviewed_at: REVIEWED_AT,
    state_root: stateRoot,
    ...overrides,
  };
}

test("materialises a hash-stable measured 18-24 second target for the known primary narration", async () => {
  const input = request();
  const result =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);

  assert.equal(
    result.evidence.schema_version,
    NARRATION_TIMING_EVIDENCE_SCHEMA_VERSION,
  );
  assert.equal(result.evidence.duration_band_id, "what_changes_breaking_flash_18_24");
  assert.equal(result.evidence.audio.duration_seconds, 19.691);
  assert.equal(result.evidence.alignment.end_seconds, 19.691);
  assert.equal(result.evidence.alignment.sha256, ALIGNMENT_SHA256);
  assert.equal(
    result.evidence.provider_result.sha256,
    PROVIDER_RESULT_SHA256,
  );
  assert.equal(result.evidence.target.end_beat_seconds, 0.35);
  assert.equal(result.evidence.target.duration_seconds, 20.041);
  assert.equal(result.evidence.target.narration_tail_seconds, 0.35);
  assert.equal(
    result.file_sha256,
    crypto.createHash("sha256").update(fs.readFileSync(result.path)).digest("hex"),
  );
  assert.deepEqual(
    validateGovernedAutonomousNarrationTimingEvidence(
      JSON.parse(fs.readFileSync(result.path, "utf8")),
      {
        storyId: input.story_id,
        legacyStoryId: input.legacy_story_id,
        scriptSha256: SCRIPT_SHA256,
        provider: input.provider,
        providerResultSha256: PROVIDER_RESULT_SHA256,
        alignmentSha256: ALIGNMENT_SHA256,
        requireAudioSha256: true,
      },
    ),
    result.evidence,
  );
});

test("uses the 18 second floor without leaving a dead tail for the known standby narration", async () => {
  const input = request({
    story_id: "official_timing-standby",
    audio_duration_seconds: 17.461,
    alignment_end_seconds: 17.461,
  });
  const result =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);

  assert.equal(result.evidence.target.duration_seconds, 18);
  assert.equal(result.evidence.target.narration_tail_seconds, 0.539);
});

test("rejects evidence whose measured narration would leave more than 1.5 seconds of editorial tail", async () => {
  await assert.rejects(
    materializeGovernedAutonomousNarrationTimingEvidence(
      request({
        audio_duration_seconds: 18,
        alignment_end_seconds: 16.49,
      }),
    ),
    {
      code: "narration_timing_evidence_tail_excessive",
    },
  );
});

test("rejects tampered story, script, provider and audio bindings", async () => {
  const input = request();
  const result =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);
  const checks = [
    { storyId: "official_other" },
    { legacyStoryId: "rss_other-story" },
    { scriptSha256: "c".repeat(64) },
    { providerResultSha256: "e".repeat(64) },
    { audioSha256: "9".repeat(64) },
    { alignmentSha256: "f".repeat(64) },
    {
      provider: {
        ...input.provider,
        voice_id: "different-voice",
      },
    },
  ];
  for (const expected of checks) {
    assert.throws(
      () =>
        validateGovernedAutonomousNarrationTimingEvidence(
          result.evidence,
          {
            storyId: input.story_id,
            legacyStoryId: input.legacy_story_id,
            scriptSha256: SCRIPT_SHA256,
            provider: input.provider,
            providerResultSha256: PROVIDER_RESULT_SHA256,
            alignmentSha256: ALIGNMENT_SHA256,
            requireAudioSha256: true,
            ...expected,
          },
        ),
      {
        code: "narration_timing_evidence_binding_mismatch",
      },
    );
  }

  const tampered = structuredClone(result.evidence);
  tampered.audio.sha256 = null;
  assert.throws(
    () =>
      validateGovernedAutonomousNarrationTimingEvidence(
        tampered,
        {
          storyId: input.story_id,
          legacyStoryId: input.legacy_story_id,
          scriptSha256: SCRIPT_SHA256,
          provider: input.provider,
          providerResultSha256: PROVIDER_RESULT_SHA256,
          alignmentSha256: ALIGNMENT_SHA256,
          requireAudioSha256: true,
        },
      ),
    {
      code: "narration_timing_evidence_audio_sha256_required",
    },
  );
});

test("discovers only the deterministic state-root timing evidence for the exact legacy story and script", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-narration-state-"),
  );
  const input = request({
    state_root: stateRoot,
  });
  const materialised =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);
  const outputPath =
    governedAutonomousNarrationTimingEvidencePath({
      stateRoot,
      legacyStoryId: "rss_exact-story",
      scriptSha256: SCRIPT_SHA256,
    });

  assert.deepEqual(
    await discoverGovernedAutonomousNarrationTimingEvidence({
      stateRoot,
      legacyStoryId: "rss_exact-story",
      storyId: input.story_id,
      scriptSha256: SCRIPT_SHA256,
      provider: input.provider,
    }),
    {
      path: outputPath,
      file_sha256: materialised.file_sha256,
    },
  );
  assert.equal(
    await discoverGovernedAutonomousNarrationTimingEvidence({
      stateRoot,
      legacyStoryId: "rss_other-story",
      storyId: input.story_id,
      scriptSha256: SCRIPT_SHA256,
      provider: input.provider,
    }),
    null,
  );
});

test("refuses arbitrary output paths and binds the deterministic state-root location", async () => {
  const input = request();
  const arbitrary = {
    ...input,
    output_path: path.join(input.state_root, "arbitrary.json"),
  };
  await assert.rejects(
    materializeGovernedAutonomousNarrationTimingEvidence(arbitrary),
    {
      code: "narration_timing_evidence_request_fields_invalid",
    },
  );

  const materialised =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);
  assert.equal(
    materialised.path,
    governedAutonomousNarrationTimingEvidencePath({
      stateRoot: input.state_root,
      legacyStoryId: input.legacy_story_id,
      scriptSha256: input.script_sha256,
    }),
  );
});

test("replays identical immutable evidence and refuses a conflicting replacement", async () => {
  const input = request();
  const first =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);
  const replay =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.file_sha256, first.file_sha256);

  await assert.rejects(
    materializeGovernedAutonomousNarrationTimingEvidence({
      ...input,
      audio_duration_seconds: 19.9,
      alignment_end_seconds: 19.9,
    }),
    {
      code: "narration_timing_evidence_conflict",
    },
  );
});

test("discovery validates the file's canonical story, script and provider bindings", async () => {
  const input = request();
  const materialised =
    await materializeGovernedAutonomousNarrationTimingEvidence(input);
  const original = JSON.parse(
    fs.readFileSync(materialised.path, "utf8"),
  );

  for (const mutate of [
    (evidence) => {
      evidence.story_id = "official_other";
    },
    (evidence) => {
      evidence.script_sha256 = "e".repeat(64);
    },
    (evidence) => {
      evidence.provider.voice_id = "other-voice";
    },
  ]) {
    const tampered = structuredClone(original);
    mutate(tampered);
    fs.writeFileSync(
      materialised.path,
      `${JSON.stringify(tampered, null, 2)}\n`,
    );
    await assert.rejects(
      discoverGovernedAutonomousNarrationTimingEvidence({
        stateRoot: input.state_root,
        legacyStoryId: input.legacy_story_id,
        storyId: input.story_id,
        scriptSha256: input.script_sha256,
        provider: input.provider,
      }),
      {
        code: "narration_timing_evidence_binding_mismatch",
      },
    );
    fs.writeFileSync(
      materialised.path,
      `${JSON.stringify(original, null, 2)}\n`,
    );
  }
});
