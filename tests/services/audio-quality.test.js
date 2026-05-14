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
  assert.match(filter, /loudnorm=I=-15:TP=-2:LRA=8/);
  assert.match(filter, /alimiter=limit=0\.8/);
  assert.equal(filter, "[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-15:TP=-2:LRA=8,alimiter=limit=0.8[outa]");
});

test("buildVoiceMasteringFilter: normalises local narration for crisp social-video playback", () => {
  const filter = buildVoiceMasteringFilter();

  assert.match(filter, /highpass=f=90/);
  assert.doesNotMatch(filter, /afftdn=/);
  assert.match(filter, /equalizer=f=240:t=q:w=1\.0:g=-2/);
  assert.match(filter, /equalizer=f=3200:t=q:w=1\.1:g=1\.8/);
  assert.match(filter, /equalizer=f=6500:t=q:w=1\.0:g=1\.0/);
  assert.match(filter, /equalizer=f=9500:t=q:w=0\.9:g=0\.4/);
  assert.match(filter, /acompressor=threshold=-22dB:ratio=2\.0:attack=5:release=100:makeup=1\.2/);
  assert.match(filter, /loudnorm=I=-15:TP=-1\.7:LRA=8/);
  assert.match(filter, /alimiter=limit=0\.88/);
});

test("buildVoiceMasteringFilter: denoise is opt-in so Liam consonants stay crisp by default", () => {
  const transparent = buildVoiceMasteringFilter();
  const denoised = buildVoiceMasteringFilter({ denoise: true });

  assert.doesNotMatch(transparent, /afftdn=/);
  assert.match(denoised, /afftdn=nf=-30/);
});

test("audio-quality defaults keep local TTS loud and high-bitrate after mastering", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "audio-quality.js"),
    "utf8",
  );

  assert.match(source, /TTS_VOICE_TARGET_LUFS,\s*-15/);
  assert.match(source, /TTS_VOICE_MASTER_BITRATE,\s*"256k"/);
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

test("local TTS server does not use nearest-neighbour MP3 resampling", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tts_server", "server.py"),
    "utf8",
  );

  assert.doesNotMatch(source, /np\.linspace\(0,\s*len\(audio\)\s*-\s*1,\s*new_len\)\.astype\(np\.int64\)/);
  assert.match(source, /frame_rate=sample_rate/);
  assert.match(source, /parameters=\["-ar",\s*str\(target_sr\)\]/);
});
