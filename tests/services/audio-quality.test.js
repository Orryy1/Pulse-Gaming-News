"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  buildNarrationMusicMixFilter,
  buildVoiceMasteringFilter,
  shouldMasterTtsAudio,
} = require("../../lib/audio-quality");

test("buildNarrationMusicMixFilter: preserves narration level when adding music", () => {
  const filter = buildNarrationMusicMixFilter({
    voiceLabel: "voice",
    musicLabel: "bgm",
    outputLabel: "outa",
  });

  assert.match(filter, /amix=inputs=2:duration=first/);
  assert.match(filter, /normalize=0/);
  assert.match(filter, /alimiter=limit=0\.92/);
  assert.equal(filter, "[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.92[outa]");
});

test("buildVoiceMasteringFilter: normalises local narration for crisp social-video playback", () => {
  const filter = buildVoiceMasteringFilter();

  assert.match(filter, /highpass=f=80/);
  assert.match(filter, /acompressor=/);
  assert.match(filter, /loudnorm=I=-16:TP=-1\.5:LRA=8/);
  assert.match(filter, /alimiter=limit=0\.92/);
});

test("shouldMasterTtsAudio: defaults to local TTS only and can be disabled", () => {
  assert.equal(shouldMasterTtsAudio({ provider: "local", env: {} }), true);
  assert.equal(shouldMasterTtsAudio({ provider: "elevenlabs", env: {} }), false);
  assert.equal(
    shouldMasterTtsAudio({
      provider: "local",
      env: { LOCAL_TTS_VOICE_MASTERING: "false" },
    }),
    false,
  );
  assert.equal(
    shouldMasterTtsAudio({
      provider: "elevenlabs",
      env: { TTS_VOICE_MASTERING: "true" },
    }),
    true,
  );
});

test("assemble.js uses the narration-preserving mix helper instead of default amix normalisation", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "assemble.js"),
    "utf8",
  );

  assert.match(source, /buildNarrationMusicMixFilter/);
  assert.doesNotMatch(source, /amix=inputs=2:duration=first\[outa\]/);
});
