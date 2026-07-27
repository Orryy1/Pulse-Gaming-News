"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFfmpegInvocation,
  deriveCombinedOwnedMotionManifest,
  executeGovernedFinalComposite,
  normaliseWordTimestamps,
  parseLoudnormOutput,
  parseTerminalSilenceOutput,
  samePath,
  validateCombinedOwnedMotionManifest,
  validateGovernedNarrationManifest,
} = require("../../lib/services/governed-final-composite");

const STORY_ID = "official_d86953ca92ca";
const SCRIPT =
  "Final Fantasy XIV just revealed a tank that fights with two giant shields.";
const GENERATED_AT = "2026-07-27T17:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function videoProbe({ duration = 28, audio = false } = {}) {
  const streams = [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1080,
      height: 1920,
      avg_frame_rate: "30/1",
    },
  ];
  if (audio) {
    streams.push({
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
    });
  }
  return {
    streams,
    format: { duration: String(duration) },
  };
}

function audioProbe(duration = 0.72) {
  return {
    streams: [
      {
        codec_type: "audio",
        codec_name: "mp3",
        sample_rate: "44100",
      },
    ],
    format: { duration: String(duration) },
  };
}

function sourceLoudness() {
  return {
    integrated_lufs: -23.9,
    true_peak_dbfs: -8.4,
    loudness_range_lu: 3.2,
    threshold_lufs: -34,
    target_offset_lu: 0.1,
  };
}

function finalLoudness() {
  return {
    integrated_lufs: -16,
    true_peak_dbfs: -1.7,
    loudness_range_lu: 3.1,
    threshold_lufs: -26,
    target_offset_lu: 0,
  };
}

function terminalSilence() {
  return {
    threshold_db: -50,
    minimum_duration_seconds: 0.1,
    terminal_silence_start_seconds: 23.684,
    terminal_silence_seconds: 1.316,
  };
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-final-composite-"),
  );
  const projectDir = path.join(root, "videos", "evercold");
  const evidenceDir = path.join(root, "evidence");
  const backbonePath = path.join(evidenceDir, "owned-motion-backbone.mp4");
  const hyperframesPath = path.join(evidenceDir, "evercold-hf.mp4");
  const projectPath = path.join(projectDir, "index.html");
  const configPath = path.join(projectDir, "hyperframes.json");
  const audioPath = path.join(evidenceDir, "narration.mp3");
  const alignmentPath = path.join(evidenceDir, "timestamps.json");
  const timestampsPath = path.join(
    evidenceDir,
    "word-timestamps.json",
  );
  const narrationManifestPath = path.join(
    evidenceDir,
    "governed-narration-manifest.json",
  );
  const storyIntakePath = path.join(evidenceDir, "story-intake.json");
  const combinedManifestPath = path.join(
    evidenceDir,
    "owned-motion-manifest.json",
  );
  const originalManifestPath = path.join(
    evidenceDir,
    "original-owned-motion-manifest.json",
  );
  const outputDir = path.join(root, "final-output");

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(backbonePath, "owned-backbone");
  fs.writeFileSync(hyperframesPath, "hyperframes-intermediate");
  fs.writeFileSync(
    projectPath,
    "<html><body>material captions stage</body></html>",
  );
  fs.writeFileSync(configPath, '{"paths":{"assets":"assets"}}');
  fs.writeFileSync(audioPath, "narration");
  const alignment = {
    characters: [
      "F",
      "i",
      "n",
      "a",
      "l",
      " ",
      "F",
      "a",
      "n",
      "t",
      "a",
      "s",
      "y",
      " ",
      "X",
      "I",
      "V",
      " ",
      "j",
      "u",
      "s",
      "t",
      " ",
      "r",
      "e",
      "v",
      "e",
      "a",
      "l",
      "e",
      "d",
      " ",
      "a",
      " ",
      "t",
      "a",
      "n",
      "k",
      " ",
      "t",
      "h",
      "a",
      "t",
      " ",
      "f",
      "i",
      "g",
      "h",
      "t",
      "s",
      " ",
      "w",
      "i",
      "t",
      "h",
      " ",
      "t",
      "w",
      "o",
      " ",
      "g",
      "i",
      "a",
      "n",
      "t",
      " ",
      "s",
      "h",
      "i",
      "e",
      "l",
      "d",
      "s",
      ".",
    ],
    character_start_times_seconds: Array.from(
      { length: SCRIPT.length },
      (_, index) => Number((index * 0.01).toFixed(3)),
    ),
    character_end_times_seconds: Array.from(
      { length: SCRIPT.length },
      (_, index) => Number(((index + 1) * 0.01).toFixed(3)),
    ),
  };
  writeJson(alignmentPath, alignment);
  const alignmentSha256 = sha256(fs.readFileSync(alignmentPath));
  const audioSha256 = sha256(fs.readFileSync(audioPath));
  const words = normaliseWordTimestamps({
    storyId: STORY_ID,
    timestamps: alignment,
    expectedScript: SCRIPT,
    expectedScriptSha256: sha256(SCRIPT),
    expectedAudioSha256: audioSha256,
  }).words;
  writeJson(timestampsPath, {
    schema_version: "pulse-word-timestamps-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    script_sha256: sha256(SCRIPT),
    source_alignment_sha256: alignmentSha256,
    audio_sha256: audioSha256,
    audio_duration_seconds: 0.72,
    character_count: SCRIPT.length,
    word_count: words.length,
    words,
  });
  writeJson(narrationManifestPath, {
    schema_version: "pulse-governed-narration-manifest-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    generator_identity: "pulse-governed-narration-materialize-v1",
    plan_sha256: "e".repeat(64),
    script: {
      sha256: sha256(SCRIPT),
      aligned_text_sha256: sha256(SCRIPT),
      exact_alignment_match: true,
      character_count: SCRIPT.length,
    },
    narration: {
      duration_seconds: 0.72,
      final_target_seconds: 28,
      visual_breath_allowance_seconds: 27.28,
      word_count: words.length,
      provider: "elevenlabs",
      voice_id: "fixture-voice",
      model_id: "eleven_multilingual_v2",
      speed: 0.75,
      provider_metadata_basis: "operator_attestation",
    },
    licence: {
      rights_basis: "LICENSED",
      evidence_reference:
        "operator-attestation://channel-owner/elevenlabs-full-subscription",
      attested_by: "channel-owner",
      attested_at: GENERATED_AT,
      evidence_scope:
        "operator subscription and permitted-use attestation reference",
    },
    sources: {
      audio: {
        path: audioPath,
        expected_sha256: audioSha256,
        pre_apply_sha256: audioSha256,
        post_apply_sha256: audioSha256,
        copied: false,
        mutated: false,
      },
      alignment: {
        path: alignmentPath,
        expected_sha256: alignmentSha256,
        pre_apply_sha256: alignmentSha256,
        post_apply_sha256: alignmentSha256,
        copied: false,
        mutated: false,
      },
    },
    outputs: {
      word_timestamps: {
        path: "word-timestamps.json",
        schema_version: "pulse-word-timestamps-v1",
        sha256: sha256(fs.readFileSync(timestampsPath)),
        word_count: words.length,
      },
    },
    controls: {
      operating_mode: "HUMAN_REVIEW",
      emergency_kill_switch_tripped: true,
      auto_publish_enabled: false,
      live_dispatch_enabled: false,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
  });
  writeJson(storyIntakePath, {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: "https://example.test/official-evercold",
    source_type: "official",
    source_evidence_path: "source-evidence.json",
    source_evidence_sha256: "a".repeat(64),
    contract: {
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: STORY_ID,
      title: "Final Fantasy XIV reveals Bastion",
      full_script: SCRIPT,
      script_sha256: sha256(SCRIPT),
      visual_brief: {
        format: "owned-motion-only",
        palette: ["#9EEBFF", "#244866", "#E8F8FF", "#FF6B1A"],
      },
    },
  });
  const originalManifest = {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    assets: [
      {
        path: "owned-motion-backbone.mp4",
        sha256: sha256(fs.readFileSync(backbonePath)),
        media_type: "video",
        role: "owned_motion_backbone",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
        width: 1080,
        height: 1920,
        duration_seconds: 28,
      },
    ],
  };
  writeJson(originalManifestPath, originalManifest);
  writeJson(combinedManifestPath, {
    ...originalManifest,
    assets: [
      ...originalManifest.assets,
      {
        path: "evercold-hf.mp4",
        sha256: sha256(fs.readFileSync(hyperframesPath)),
        media_type: "video",
        role: "hyperframes_intermediate",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
        width: 1080,
        height: 1920,
        duration_seconds: 28,
        generator_identity: "hyperframes@0.7.76",
        provenance: {
          source: "hyperframes_material_stage",
          third_party_media_used: false,
          source_backbone: {
            path: "owned-motion-backbone.mp4",
            sha256: sha256(fs.readFileSync(backbonePath)),
          },
          project_files: [
            {
              path: "../videos/evercold/index.html",
              sha256: sha256(fs.readFileSync(projectPath)),
            },
            {
              path: "../videos/evercold/hyperframes.json",
              sha256: sha256(fs.readFileSync(configPath)),
            },
          ],
        },
      },
    ],
  });
  return {
    root,
    projectDir,
    evidenceDir,
    backbonePath,
    hyperframesPath,
    projectPath,
    configPath,
    audioPath,
    alignmentPath,
    timestampsPath,
    narrationManifestPath,
    narrationManifestSha256: sha256(
      fs.readFileSync(narrationManifestPath),
    ),
    storyIntakePath,
    combinedManifestPath,
    originalManifestPath,
    outputDir,
  };
}

test("normaliseWordTimestamps converts exact ElevenLabs characters into review words", () => {
  const values = fixture();
  try {
    const input = JSON.parse(fs.readFileSync(values.alignmentPath, "utf8"));
    const result = normaliseWordTimestamps({
      storyId: STORY_ID,
      timestamps: input,
      expectedScript: SCRIPT,
    });
    assert.equal(result.schema_version, "pulse-word-timestamps-v1");
    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.transcript, SCRIPT);
    assert.deepEqual(
      result.words.map((word) => word.text),
      SCRIPT.split(" "),
    );
    assert.equal(result.words[0].start_seconds, 0);
    assert.equal(
      result.words.at(-1).end_seconds,
      Number((SCRIPT.length * 0.01).toFixed(3)),
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation binds licensed audio, source alignment and exact word timestamps", () => {
  const values = fixture();
  try {
    const result = validateGovernedNarrationManifest({
      manifestPath: values.narrationManifestPath,
      expectedManifestSha256: values.narrationManifestSha256,
      storyId: STORY_ID,
      scriptSha256: sha256(SCRIPT),
      audioPath: values.audioPath,
      timestampsPath: values.timestampsPath,
      audioDurationSeconds: 0.72,
    });
    assert.equal(
      result.manifest.schema_version,
      "pulse-governed-narration-manifest-v1",
    );
    assert.equal(result.provider, "elevenlabs");
    assert.equal(result.licence.rights_basis, "LICENSED");
    assert.equal(
      result.timestamps.sha256,
      sha256(fs.readFileSync(values.timestampsPath)),
    );
    assert.equal(
      result.alignment.sha256,
      sha256(fs.readFileSync(values.alignmentPath)),
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation fails closed when a bound timestamp artefact is substituted", () => {
  const values = fixture();
  try {
    const timestamp = JSON.parse(
      fs.readFileSync(values.timestampsPath, "utf8"),
    );
    timestamp.words[0].text = "Tampered";
    writeJson(values.timestampsPath, timestamp);
    assert.throws(
      () =>
        validateGovernedNarrationManifest({
          manifestPath: values.narrationManifestPath,
          expectedManifestSha256:
            values.narrationManifestSha256,
          storyId: STORY_ID,
          scriptSha256: sha256(SCRIPT),
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          audioDurationSeconds: 0.72,
        }),
      /narration_word_timestamps_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation requires the independently supplied manifest hash", () => {
  const values = fixture();
  try {
    assert.throws(
      () =>
        validateGovernedNarrationManifest({
          manifestPath: values.narrationManifestPath,
          expectedManifestSha256: "f".repeat(64),
          storyId: STORY_ID,
          scriptSha256: sha256(SCRIPT),
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          audioDurationSeconds: 0.72,
        }),
      /narration_manifest_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("normaliseWordTimestamps accepts an already governed pulse word-timestamp file", () => {
  const words = [
    { text: "Final", start_seconds: 0, end_seconds: 0.3 },
    {
      text: "Fantasy",
      start_seconds: 0.31,
      end_seconds: 0.72,
    },
  ];
  const expectedScript = "Final Fantasy";
  const expectedScriptSha256 = sha256(expectedScript);
  const expectedAudioSha256 = "b".repeat(64);
  const result = normaliseWordTimestamps({
    storyId: STORY_ID,
    timestamps: {
      schema_version: "pulse-word-timestamps-v1",
      story_id: STORY_ID,
      script_sha256: expectedScriptSha256,
      audio_sha256: expectedAudioSha256,
      source_alignment_sha256: "c".repeat(64),
      words,
    },
    expectedScript,
    expectedScriptSha256,
    expectedAudioSha256,
  });
  assert.equal(result.schema_version, "pulse-word-timestamps-v1");
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.transcript, expectedScript);
  assert.deepEqual(result.words, words);
  assert.equal(result.script_sha256, expectedScriptSha256);
  assert.equal(result.audio_sha256, expectedAudioSha256);
  assert.equal(result.source_alignment_sha256, "c".repeat(64));
});

test("combined manifest validation binds the exact HF video, backbone and project hashes", () => {
  const values = fixture();
  try {
    const result = validateCombinedOwnedMotionManifest({
      manifestPath: values.combinedManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
    });
    assert.equal(result.hyperframesAsset.role, "hyperframes_intermediate");
    assert.equal(result.backboneAsset.role, "owned_motion_backbone");
    assert.deepEqual(
      result.projectFiles.map((record) => path.basename(record.path)).sort(),
      ["hyperframes.json", "index.html"],
    );
    assert.equal(result.thirdPartyMediaUsed, false);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("path identity preserves POSIX case sensitivity and Windows case folding", () => {
  assert.equal(samePath("/tmp/Pulse/Foo", "/tmp/Pulse/foo", "linux"), false);
  assert.equal(
    samePath("C:/Pulse/Foo", "C:/Pulse/foo", "win32"),
    true,
  );
});

test("combined manifest validation fails closed on a substituted HF intermediate", () => {
  const values = fixture();
  try {
    fs.appendFileSync(values.hyperframesPath, "tampered");
    assert.throws(
      () =>
        validateCombinedOwnedMotionManifest({
          manifestPath: values.combinedManifestPath,
          storyId: STORY_ID,
          hyperframesVideoPath: values.hyperframesPath,
        }),
      /hyperframes_intermediate_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("deriveCombinedOwnedMotionManifest safely binds an original manifest to explicit HF project files", async () => {
  const values = fixture();
  try {
    const outputPath = path.join(
      values.root,
      "derived",
      "combined-owned-motion-manifest.json",
    );
    const derived = await deriveCombinedOwnedMotionManifest({
      sourceManifestPath: values.originalManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      hyperframesProbe: videoProbe(),
      projectFilePaths: [values.projectPath, values.configPath],
      outputPath,
      generatedAt: GENERATED_AT,
      generatorIdentity: "hyperframes@0.7.76",
    });
    assert.equal(derived.derived, true);
    assert.equal(derived.path, outputPath);
    const validation = validateCombinedOwnedMotionManifest({
      manifestPath: outputPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
    });
    assert.equal(
      validation.hyperframesAsset.sha256,
      sha256(fs.readFileSync(values.hyperframesPath)),
    );
    assert.equal(validation.projectFiles.length, 2);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("ffmpeg invocation burns captions and pads exact narration without shortest truncation", () => {
  const invocation = buildFfmpegInvocation({
    videoPath: "C:/proof/hf.mp4",
    audioPath: "C:/proof/narration.mp3",
    filterPath: "C:/proof/out/filter-complex.txt",
    outputPath: "C:/proof/out/final.mp4",
    durationSeconds: 25,
    sourceVideoDurationSeconds: 28,
    sourceLoudness: sourceLoudness(),
  });
  assert.equal(invocation.command, "ffmpeg");
  assert.ok(invocation.args.includes("libx264"));
  assert.ok(invocation.args.includes("aac"));
  assert.ok(invocation.args.includes("48000"));
  assert.ok(invocation.args.includes("30"));
  assert.equal(invocation.args.includes("-shortest"), false);
  assert.match(invocation.filter, /ass=captions\.ass/);
  assert.match(invocation.filter, /setpts=0\.892857142857\*PTS/);
  assert.match(invocation.filter, /loudnorm=I=-16:TP=-1\.5:LRA=11/);
  assert.match(invocation.filter, /measured_I=-23\.9/);
  assert.match(invocation.filter, /apad=whole_dur=25/);
  assert.match(invocation.filter, /atrim=duration=25/);
});

test("audio QA parsers retain exact loudness and terminal-silence evidence", () => {
  const loudness = parseLoudnormOutput(`
    [Parsed_loudnorm_0] {
      "input_i" : "-16.16",
      "input_tp" : "-4.37",
      "input_lra" : "1.80",
      "input_thresh" : "-26.66",
      "target_offset" : "-0.16"
    }
  `);
  assert.deepEqual(loudness, {
    integrated_lufs: -16.16,
    true_peak_dbfs: -4.37,
    loudness_range_lu: 1.8,
    threshold_lufs: -26.66,
    target_offset_lu: -0.16,
  });
  const silence = parseTerminalSilenceOutput(
    [
      "silence_start: 23.338146",
      "silence_end: 23.621583 | silence_duration: 0.283438",
      "silence_start: 23.655313",
      "silence_end: 24.015646 | silence_duration: 0.360333",
    ].join("\n"),
    { durationSeconds: 24 },
  );
  assert.equal(silence.terminal_silence_start_seconds, 23.655);
  assert.equal(silence.terminal_silence_seconds, 0.345);
});

test("executeGovernedFinalComposite writes a hash-bound studio-v21 LOCAL_PROOF bundle", async () => {
  const values = fixture();
  try {
    const calls = [];
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.combinedManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        outDir: values.outputDir,
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          calls.push(invocation);
          fs.writeFileSync(invocation.outputPath, "final-studio-v21");
        },
      },
    );

    assert.equal(result.mode, "LOCAL_PROOF");
    assert.equal(result.verdict, "MATERIALIZED_LOCAL_PROOF");
    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.renderer_identity, "studio-v21");
    assert.equal(result.publish_authorised, false);
    assert.equal(result.network_used, false);
    assert.equal(result.database_mutated, false);
    assert.equal(
      result.narration_manifest_sha256,
      sha256(fs.readFileSync(values.narrationManifestPath)),
    );
    assert.equal(calls.length, 1);
    assert.ok(fs.existsSync(result.final_mp4_path));
    assert.ok(fs.existsSync(result.captions_path));
    assert.ok(fs.existsSync(result.word_timestamps_path));
    assert.ok(fs.existsSync(result.renderer_manifest_path));
    assert.ok(fs.existsSync(result.qa_report_path));
    assert.ok(fs.existsSync(result.composite_manifest_path));
    assert.ok(fs.existsSync(result.markdown_path));
    assert.equal(
      path.dirname(result.final_mp4_path),
      path.join(values.outputDir, STORY_ID),
    );
    assert.doesNotMatch(result.final_mp4_path, /\.staging-/);
    const promotedMotion = validateCombinedOwnedMotionManifest({
      manifestPath: result.combined_owned_motion_manifest_path,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
    });
    assert.equal(promotedMotion.projectFiles.length, 2);

    const renderer = JSON.parse(
      fs.readFileSync(result.renderer_manifest_path, "utf8"),
    );
    assert.equal(renderer.renderer.id, "studio-v21");
    assert.deepEqual(renderer.stack, {
      hyperframes: true,
      ffmpeg: true,
    });
    assert.equal(renderer.output.width, 1080);
    assert.equal(renderer.output.height, 1920);
    assert.equal(renderer.output.video_codec, "h264");
    assert.equal(renderer.output.video_profile, "High");
    assert.equal(renderer.output.pixel_format, "yuv420p");
    assert.equal(renderer.output.audio_codec, "aac");
    assert.equal(renderer.output.audio_sample_rate_hz, 48000);
    assert.equal(renderer.output.duration_seconds, 25);
    assert.equal(renderer.inputs[0].role, "motion");
    assert.equal(renderer.inputs[0].sha256, sha256(fs.readFileSync(values.hyperframesPath)));

    const qa = JSON.parse(fs.readFileSync(result.qa_report_path, "utf8"));
    assert.equal(qa.schema_version, "pulse-final-render-qa-v1");
    assert.equal(qa.verdict, "PASS");
    assert.equal(qa.story_id, STORY_ID);
    assert.equal(qa.media_sha256, result.media_sha256);
    assert.equal(
      qa.audio.loudness.final.integrated_lufs,
      -16,
    );
    assert.equal(
      qa.audio.loudness.final.true_peak_dbfs,
      -1.7,
    );
    assert.equal(
      qa.audio.terminal_silence_seconds,
      1.316,
    );
    assert.equal(qa.technical.duration_seconds, 25);

    const manifest = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.equal(manifest.mode, "LOCAL_PROOF");
    assert.equal(manifest.hyperframes.material_stage, true);
    assert.equal(manifest.ffmpeg.final_composite, true);
    assert.equal(
      manifest.inputs.governed_narration_manifest.sha256,
      sha256(fs.readFileSync(values.narrationManifestPath)),
    );
    assert.equal(
      manifest.inputs.hyperframes_intermediate.sha256,
      sha256(fs.readFileSync(values.hyperframesPath)),
    );
    assert.equal(manifest.safety.external_calls.length, 0);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite checks the independent narration manifest hash before audio analysis or render", async () => {
  const values = fixture();
  let audioAnalysed = false;
  let rendered = false;
  try {
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256: "f".repeat(64),
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            return videoProbe();
          },
          measureLoudness() {
            audioAnalysed = true;
            return sourceLoudness();
          },
          renderComposite() {
            rendered = true;
          },
        },
      ),
      /narration_manifest_sha256_mismatch/,
    );
    assert.equal(audioAnalysed, false);
    assert.equal(rendered, false);
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite derives the combined manifest from explicit local project files", async () => {
  const values = fixture();
  try {
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.originalManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        outDir: values.outputDir,
        hyperframesProjectFiles: [
          values.projectPath,
          values.configPath,
        ],
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          fs.writeFileSync(invocation.outputPath, "derived-final");
        },
      },
    );
    assert.ok(fs.existsSync(result.combined_owned_motion_manifest_path));
    const combined = JSON.parse(
      fs.readFileSync(
        result.combined_owned_motion_manifest_path,
        "utf8",
      ),
    );
    assert.ok(
      combined.assets.some(
        (asset) => asset.role === "hyperframes_intermediate",
      ),
    );
    const promotedMotion = validateCombinedOwnedMotionManifest({
      manifestPath: result.combined_owned_motion_manifest_path,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
    });
    assert.equal(promotedMotion.projectFiles.length, 2);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite rejects a non-conforming final probe", async () => {
  const values = fixture();
  try {
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            if (filePath === values.hyperframesPath) return videoProbe();
            return videoProbe({ duration: 23.4, audio: true });
          },
          measureLoudness(filePath) {
            return filePath === values.audioPath
              ? sourceLoudness()
              : finalLoudness();
          },
          measureTerminalSilence() {
            return terminalSilence();
          },
          renderComposite(invocation) {
            fs.writeFileSync(invocation.outputPath, "short-final");
          },
        },
      ),
      /final_duration_must_be_25_seconds/,
    );
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
    assert.deepEqual(
      fs.existsSync(values.outputDir)
        ? fs
            .readdirSync(values.outputDir)
            .filter((name) => name.includes(".staging-"))
        : [],
      [],
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite refuses to overwrite an existing story bundle", async () => {
  const values = fixture();
  const finalStoryDir = path.join(values.outputDir, STORY_ID);
  const sentinelPath = path.join(finalStoryDir, "operator-proof.txt");
  try {
    fs.mkdirSync(finalStoryDir, { recursive: true });
    fs.writeFileSync(sentinelPath, "preserve-me");
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia() {
            throw new Error("must_not_probe");
          },
          renderComposite() {
            throw new Error("must_not_render");
          },
        },
      ),
      /final_composite_output_already_exists/,
    );
    assert.equal(fs.readFileSync(sentinelPath, "utf8"), "preserve-me");
    assert.deepEqual(
      fs
        .readdirSync(values.outputDir)
        .filter((name) => name.includes(".staging-")),
      [],
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite discards a staged render that misses loudness or dead-tail limits", async () => {
  const values = fixture();
  try {
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            if (filePath === values.hyperframesPath) return videoProbe();
            return videoProbe({ duration: 25, audio: true });
          },
          measureLoudness(filePath) {
            return filePath === values.audioPath
              ? sourceLoudness()
              : {
                  ...finalLoudness(),
                  integrated_lufs: -18.4,
                  true_peak_dbfs: -1.2,
                };
          },
          measureTerminalSilence() {
            return {
              ...terminalSilence(),
              terminal_silence_start_seconds: 21,
              terminal_silence_seconds: 3,
            };
          },
          renderComposite(invocation) {
            fs.writeFileSync(invocation.outputPath, "bad-audio-final");
          },
        },
      ),
      (error) => {
        assert.equal(error.name, "GovernedFinalCompositeError");
        assert.ok(
          error.codes.includes("final_audio_loudness_out_of_range"),
        );
        assert.ok(
          error.codes.includes("final_audio_true_peak_exceeds_limit"),
        );
        assert.ok(
          error.codes.includes("final_audio_terminal_silence_excessive"),
        );
        return true;
      },
    );
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("final composite implementation has no DB, OAuth, publisher or network boundary", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "lib",
      "services",
      "governed-final-composite.js",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /require\([^)]*(?:db|oauth|publisher|upload_)/i,
  );
  assert.doesNotMatch(source, /\b(?:fetch|axios|https?\.request)\s*\(/i);
});
