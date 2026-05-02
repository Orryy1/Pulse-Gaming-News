"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  evaluateApprovedVoicePath,
  looksLikeLocalTtsPath,
  renderApprovedVoicePathMarkdown,
} = require("../../lib/studio/v2/approved-voice-path");

const OUT = path.join(process.cwd(), "test", "output", "tmp-approved-voice-path");

function audioFile(name = "voice.mp3", bytes = "fake audio bytes") {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test("approved voice path rejects missing audio path before proof render", () => {
  const result = evaluateApprovedVoicePath({
    narration: { provider: "external", source: "provided-real-audio" },
  });

  assert.equal(result.verdict, "rejected");
  assert.ok(result.blockers.includes("audio_path_missing"));
});

test("approved voice path rejects missing and empty files", () => {
  const missing = evaluateApprovedVoicePath({
    narration: {
      provider: "external",
      source: "provided-real-audio",
      audioPath: path.join(OUT, "missing.mp3"),
    },
  });
  const emptyPath = audioFile("empty.mp3", "");
  const empty = evaluateApprovedVoicePath({
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
    narration: {
      provider: "local",
      source: "local-production-voxcpm-path",
      audioPath: audioFile("local.mp3"),
      transcript: "Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 61 },
    },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
  });

  assert.equal(result.verdict, "rejected");
  assert.ok(result.blockers.includes("unapproved_local_tts_voice_path"));
  assert.ok(result.blockers.includes("demonic_low_voice_risk"));
});

test("approved voice path recognises production-shaped local Studio V2 cache names", () => {
  assert.equal(
    looksLikeLocalTtsPath("D:/pulse-data/media/output/audio/rss_story_studio_v1_local.mp3"),
    true,
  );
});

test("approved voice path approves existing production audio", () => {
  const result = evaluateApprovedVoicePath({
    narration: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: audioFile("production.mp3"),
      transcript: "Take-Two changed course. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
    },
  });

  assert.equal(result.verdict, "approved_for_studio_v2_proof");
  assert.equal(result.pilot_allowed, true);
  assert.deepEqual(result.blockers, []);
});

test("approved voice path markdown is readable for operators", () => {
  const result = evaluateApprovedVoicePath({
    narration: {
      provider: "elevenlabs",
      source: "elevenlabs-production-path",
      audioPath: audioFile("markdown.mp3"),
      transcript: "Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
    },
  });
  const md = renderApprovedVoicePathMarkdown(result);

  assert.match(md, /Approved Voice Path v1/);
  assert.match(md, /approved_for_studio_v2_proof/);
  assert.match(md, /No Railway, OAuth, production DB or posting/);
});
