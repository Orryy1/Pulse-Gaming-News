"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  evaluateApprovedVoicePath,
  renderApprovedVoicePathMarkdown,
} = require("../../lib/studio/v2/approved-voice-path");
const {
  CTA_POLICY,
} = require("../../lib/services/pulse-editorial-contract");

const OUT = path.join(process.cwd(), "test", "output", "tmp-approved-voice-path");

function omittedCtaStory(overrides = {}) {
  return {
    id: "voice-no-cta",
    cta: "",
    full_script: "Take-Two changed course.",
    cta_policy: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
      cohort_bucket: 1,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"b".repeat(64)}`,
    },
    ...overrides,
  };
}

function audioFile(name = "voice.mp3", bytes = "fake audio bytes") {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test("approved voice path rejects missing audio path before proof render", () => {
  const result = evaluateApprovedVoicePath({
    story: omittedCtaStory(),
    narration: { provider: "external", source: "provided-real-audio" },
  });

  assert.equal(result.verdict, "rejected");
  assert.ok(result.blockers.includes("audio_path_missing"));
});

test("approved voice path rejects missing and empty files", () => {
  const missing = evaluateApprovedVoicePath({
    story: omittedCtaStory(),
    narration: {
      provider: "external",
      source: "provided-real-audio",
      audioPath: path.join(OUT, "missing.mp3"),
    },
  });
  const emptyPath = audioFile("empty.mp3", "");
  const empty = evaluateApprovedVoicePath({
    story: omittedCtaStory(),
    narration: {
      provider: "external",
      source: "provided-real-audio",
      audioPath: emptyPath,
    },
  });

  assert.ok(missing.blockers.includes("audio_file_missing"));
  assert.ok(empty.blockers.includes("audio_file_empty"));
});

test("approved voice path blocks unapproved low local voice", () => {
  const result = evaluateApprovedVoicePath({
    story: omittedCtaStory(),
    narration: {
      provider: "local",
      source: "local-production-voxcpm-path",
      audioPath: audioFile("local.mp3"),
      transcript: "Take-Two changed course.",
      acoustic: { medianPitchHz: 61 },
    },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
  });

  assert.equal(result.verdict, "rejected");
  assert.ok(result.blockers.includes("unapproved_local_tts_voice_path"));
  assert.ok(result.blockers.includes("demonic_low_voice_risk"));
});

test("approved voice path approves existing production audio", () => {
  const result = evaluateApprovedVoicePath({
    story: omittedCtaStory(),
    narration: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: audioFile("production.mp3"),
      transcript: "Take-Two changed course.",
      acoustic: { medianPitchHz: 118 },
    },
  });

  assert.equal(result.verdict, "approved_for_studio_v2_proof");
  assert.equal(result.pilot_allowed, true);
  assert.deepEqual(result.blockers, []);
});

test("approved voice path requires the selected contextual CTA in narration", () => {
  const cta = "Which version would you install first?";
  const story = omittedCtaStory({
    id: "voice-selected-cta",
    cta,
    full_script: `Achievements are now confirmed. ${cta}`,
    cta_policy: {
      policy_version: CTA_POLICY.version,
      scope: "shorts",
      include_cta: true,
      copy_strategy: CTA_POLICY.copy_strategy,
      cohort_bucket: 0,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"a".repeat(64)}`,
    },
  });
  const missing = evaluateApprovedVoicePath({
    story,
    narration: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: audioFile("selected-missing.mp3"),
      transcript: "Achievements are now confirmed.",
      acoustic: { medianPitchHz: 118 },
    },
  });
  const present = evaluateApprovedVoicePath({
    story,
    narration: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: audioFile("selected-present.mp3"),
      transcript: `Achievements are now confirmed. ${cta}`,
      acoustic: { medianPitchHz: 118 },
    },
  });

  assert.ok(
    missing.blockers.includes("selected_cta_missing_from_full_script"),
  );
  assert.equal(present.verdict, "approved_for_studio_v2_proof");
  assert.equal(present.transcript.cta_policy_verified, true);
});

test("approved voice path markdown is readable for operators", () => {
  const result = evaluateApprovedVoicePath({
    story: omittedCtaStory(),
    narration: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: audioFile("markdown.mp3"),
      transcript: "Take-Two changed course.",
      acoustic: { medianPitchHz: 118 },
    },
  });
  const md = renderApprovedVoicePathMarkdown(result);

  assert.match(md, /Approved Voice Path v1/);
  assert.match(md, /approved_for_studio_v2_proof/);
  assert.match(md, /No Railway, OAuth, production DB or posting/);
});
