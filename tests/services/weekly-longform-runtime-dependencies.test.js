"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createWeeklyLongformRuntimeDependencies,
} = require("../../lib/services/weekly-longform-runtime-dependencies");
const {
  createWeeklyLongformProductionAdapters,
} = require("../../lib/services/weekly-longform-production-adapters");

const RUN_ID = "weekly-runtime-2026-07-28";
const GENERATED_AT = "2026-07-28T18:00:00.000Z";

function fixture(t, stage) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-runtime-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, RUN_ID, "adapters", stage);
  fs.mkdirSync(outputDir, { recursive: true });
  return { root, outputDir };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return sha256(fs.readFileSync(filePath));
}

test("the default runtime exposes only the safe exact-alignment converter and reports every unavailable external capability", () => {
  const runtime = createWeeklyLongformRuntimeDependencies();

  assert.equal(
    runtime.capabilities.schema_version,
    "pulse-weekly-longform-runtime-capabilities-v1",
  );
  assert.equal(runtime.capabilities.ready, false);
  assert.deepEqual(runtime.capabilities.blockers, [
    "elevenlabs_http_client_unavailable",
    "elevenlabs_api_key_unavailable",
    "elevenlabs_voice_id_unavailable",
    "elevenlabs_credit_state_root_unavailable",
    "verified_render_longform_dependency_unavailable",
    "explicit_ffmpeg_binary_path_required",
    "explicit_ffprobe_binary_path_required",
    "process_runner_unavailable",
  ]);
  assert.deepEqual(Object.keys(runtime.dependencies), [
    "materializeAlignment",
  ]);
  assert.equal(
    runtime.capabilities.dependencies.materializeAlignment.available,
    true,
  );
  assert.deepEqual(runtime.capabilities.safety, {
    implicit_network_enabled: false,
    implicit_process_spawn_enabled: false,
    upload_authority: false,
    oauth_mutation_authority: false,
    database_mutation_authority: false,
  });
});

test("the ElevenLabs dependency writes real response audio and the exact with-timestamps alignment under its output directory", async (t) => {
  const values = fixture(t, "narration");
  const scriptText = "Pulse ships exact words.";
  const audioBytes = Buffer.from("provider-returned-mp3-bytes");
  const characters = Array.from(scriptText);
  const scriptPath = path.join(values.root, RUN_ID, "script.txt");
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  const alignment = {
    characters,
    character_start_times_seconds: characters.map((_, index) =>
      Number((index * 0.04).toFixed(3)),
    ),
    character_end_times_seconds: characters.map((_, index) =>
      Number(((index + 1) * 0.04).toFixed(3)),
    ),
  };
  const requests = [];
  const runtime = createWeeklyLongformRuntimeDependencies({
    env: {
      ELEVENLABS_API_KEY: "test-elevenlabs-key",
      ELEVENLABS_VOICE_ID: "pulse-voice",
      ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
      ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
      ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
      PULSE_STATE_ROOT: path.join(values.root, "state"),
    },
    async httpClient(input) {
      requests.push(input);
      if (input.method === "GET") {
        return {
          status: 200,
          data: {
            tier: "pro",
            status: "active",
            character_count: 1000,
            character_limit: 100000,
            next_character_count_reset_unix: 1785799831,
            max_credit_limit_extension: "unlimited",
            current_overage: { amount: "0", currency: "usd" },
          },
        };
      }
      return {
        status: 200,
        data: {
          audio_base64: audioBytes.toString("base64"),
          alignment,
        },
      };
    },
  });

  const result = await runtime.dependencies.produceNarration({
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    text: scriptText,
    script_path: scriptPath,
    script_sha256: sha256(Buffer.from(scriptText)),
    output_dir: values.outputDir,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "GET");
  assert.equal(
    requests[0].url,
    "https://api.elevenlabs.io/v1/user/subscription",
  );
  const request = requests[1];
  assert.equal(
    request.url,
    "https://api.elevenlabs.io/v1/text-to-speech/pulse-voice/with-timestamps?output_format=mp3_44100_128",
  );
  assert.equal(request.method, "POST");
  assert.equal(request.headers["xi-api-key"], "test-elevenlabs-key");
  assert.equal(request.data.text, scriptText);
  assert.equal(request.data.model_id, "eleven_multilingual_v2");
  assert.equal(result.provider, "elevenlabs");
  assert.equal(result.voice_id, "pulse-voice");
  assert.equal(result.model_id, "eleven_multilingual_v2");
  assert.equal(result.network_used, true);
  assert.ok(result.path.startsWith(values.outputDir));
  assert.deepEqual(fs.readFileSync(result.path), audioBytes);
  assert.equal(result.sha256, sha256(audioBytes));
  assert.ok(result.raw_alignment.path.startsWith(values.outputDir));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(result.raw_alignment.path, "utf8")),
    alignment,
  );
  assert.equal(
    result.raw_alignment.sha256,
    sha256(fs.readFileSync(result.raw_alignment.path)),
  );
  assert.ok(result.credit_preflight.path.startsWith(values.outputDir));
  assert.equal(
    result.credit_preflight.sha256,
    sha256(fs.readFileSync(result.credit_preflight.path)),
  );
  const creditReceipt = JSON.parse(
    fs.readFileSync(result.credit_preflight.path, "utf8"),
  );
  assert.equal(creditReceipt.committed, true);
  assert.equal(creditReceipt.used_credits, 1000);
  assert.equal(creditReceipt.included_credit_limit, 100000);
  assert.equal(creditReceipt.estimated_request_credits, scriptText.length);
  assert.doesNotMatch(
    JSON.stringify(creditReceipt),
    /test-elevenlabs-key/,
  );
});

test("ElevenLabs audio is not materialised when its returned alignment does not exactly match the submitted script", async (t) => {
  const values = fixture(t, "narration");
  const scriptText = "Exact script";
  const scriptPath = path.join(values.root, RUN_ID, "script.txt");
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  const wrongText = "Other script";
  const characters = Array.from(wrongText);
  const runtime = createWeeklyLongformRuntimeDependencies({
    env: {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "pulse-voice",
      PULSE_STATE_ROOT: path.join(values.root, "state"),
    },
    async httpClient() {
      return {
        status: 200,
        data: {
          audio_base64: Buffer.from("audio").toString("base64"),
          alignment: {
            characters,
            character_start_times_seconds: characters.map(
              (_, index) => index * 0.05,
            ),
            character_end_times_seconds: characters.map(
              (_, index) => (index + 1) * 0.05,
            ),
          },
        },
      };
    },
    creditGovernor: {
      async preflight() {
        return {
          report: {
            remaining_percent: 90,
            estimated_request_credits: scriptText.length,
            hard_reserve_credits: 1000,
            warnings: [],
          },
          async markProviderCallStarted() {},
          async recordProviderSuccess() {},
          async markProviderCallAmbiguous() {},
          async complete() {},
          async release() {},
        };
      },
    },
  });

  await assert.rejects(
    () =>
      runtime.dependencies.produceNarration({
        run_id: RUN_ID,
        generated_at: GENERATED_AT,
        text: scriptText,
        script_path: scriptPath,
        script_sha256: sha256(fs.readFileSync(scriptPath)),
        output_dir: values.outputDir,
      }),
    (error) =>
      error?.name === "WeeklyLongformRuntimeDependencyError" &&
      error.codes.includes("elevenlabs_alignment_exact_text_mismatch"),
  );
  assert.deepEqual(fs.readdirSync(values.outputDir), []);
});

test("the built-in alignment dependency converts the exact ElevenLabs character timing sidecar into canonical word evidence", async (t) => {
  const values = fixture(t, "alignment");
  const scriptText = "Exact words, exact timing.";
  const runRoot = path.join(values.root, RUN_ID);
  const scriptPath = path.join(runRoot, "script.txt");
  const narrationDir = path.join(runRoot, "adapters", "narration");
  const audioPath = path.join(narrationDir, "narration.mp3");
  const rawAlignmentPath = path.join(
    narrationDir,
    "elevenlabs-raw-alignment.json",
  );
  fs.mkdirSync(narrationDir, { recursive: true });
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  fs.writeFileSync(audioPath, Buffer.from("provider-audio"));
  const characters = Array.from(scriptText);
  const rawAlignment = {
    characters,
    character_start_times_seconds: characters.map((_, index) =>
      Number((index * 0.037 + (index % 3) * 0.002).toFixed(3)),
    ),
    character_end_times_seconds: characters.map((_, index) =>
      Number((index * 0.037 + 0.032 + (index % 3) * 0.002).toFixed(3)),
    ),
  };
  const rawAlignmentSha256 = writeJson(rawAlignmentPath, rawAlignment);
  const runtime = createWeeklyLongformRuntimeDependencies();

  const result = await runtime.dependencies.materializeAlignment({
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    script_text: scriptText,
    script_path: scriptPath,
    script_sha256: sha256(fs.readFileSync(scriptPath)),
    audio_path: audioPath,
    audio_sha256: sha256(fs.readFileSync(audioPath)),
    output_dir: values.outputDir,
  });

  const value = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.equal(value.schema_version, "pulse-word-timestamps-v1");
  assert.equal(value.run_id, RUN_ID);
  assert.equal(value.script_sha256, sha256(fs.readFileSync(scriptPath)));
  assert.equal(value.audio_sha256, sha256(fs.readFileSync(audioPath)));
  assert.equal(value.source_alignment_sha256, rawAlignmentSha256);
  assert.equal(value.provider, "elevenlabs");
  assert.equal(value.timing_basis, "provider_word_alignment");
  assert.deepEqual(
    value.words.map((word) => word.text),
    ["Exact", "words,", "exact", "timing."],
  );
  assert.equal(value.word_count, 4);
  assert.equal(result.provider, "elevenlabs");
  assert.equal(result.network_used, false);
  assert.equal(result.sha256, sha256(fs.readFileSync(result.path)));
});

test("the platform-variant dependency runs explicit FFmpeg and FFprobe binaries then records observed media metadata", async (t) => {
  const values = fixture(t, "variants");
  const runRoot = path.join(values.root, RUN_ID);
  const masterPath = path.join(
    runRoot,
    "adapters",
    "render",
    "master.mp4",
  );
  const binDir = path.join(values.root, "bin");
  const ffmpegPath = path.join(binDir, "ffmpeg.exe");
  const ffprobePath = path.join(binDir, "ffprobe.exe");
  fs.mkdirSync(path.dirname(masterPath), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(masterPath, Buffer.from("master-media"));
  fs.writeFileSync(ffmpegPath, Buffer.from("injected-test-binary"));
  fs.writeFileSync(ffprobePath, Buffer.from("injected-test-binary"));
  const calls = [];
  const runtime = createWeeklyLongformRuntimeDependencies({
    ffmpegPath,
    ffprobePath,
    async processRunner(invocation) {
      calls.push(invocation);
      if (invocation.command === ffmpegPath) {
        fs.writeFileSync(
          invocation.args.at(-1),
          Buffer.from("ffmpeg-produced-platform-media"),
        );
        return { status: 0, stdout: "", stderr: "" };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              height: 1080,
              duration: "480.0",
            },
            {
              codec_type: "audio",
              codec_name: "aac",
              duration: "480.0",
            },
          ],
          format: {
            duration: "480.0",
            format_name: "mov,mp4,m4a,3gp,3g2,mj2",
          },
        }),
        stderr: "",
      };
    },
  });

  const result = await runtime.dependencies.materializeVariants({
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    master_path: masterPath,
    master_sha256: sha256(fs.readFileSync(masterPath)),
    derivative_plan: { items: [{ derivative_id: "weekly-short-1" }] },
    output_dir: values.outputDir,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, ffmpegPath);
  assert.equal(calls[1].command, ffprobePath);
  assert.ok(calls[0].args.includes("-vf"));
  assert.equal(calls[0].args.at(-1), path.join(values.outputDir, "youtube-longform.mp4"));
  const value = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.equal(
    value.schema_version,
    "pulse-longform-platform-variants-v1",
  );
  assert.equal(value.run_id, RUN_ID);
  assert.equal(value.master_sha256, sha256(fs.readFileSync(masterPath)));
  assert.equal(value.variants.length, 1);
  assert.equal(value.variants[0].platform, "YOUTUBE_LONGFORM");
  assert.equal(value.variants[0].width, 1920);
  assert.equal(value.variants[0].height, 1080);
  assert.equal(value.variants[0].duration_seconds, 480);
  assert.equal(value.variants[0].video_codec, "h264");
  assert.equal(value.variants[0].audio_codec, "aac");
  assert.ok(value.variants[0].path.startsWith(values.outputDir));
  assert.equal(
    value.variants[0].sha256,
    sha256(fs.readFileSync(value.variants[0].path)),
  );
  assert.equal(result.variant_count, 1);
  assert.equal(result.network_used, false);
});

test("the decoded-QA dependency performs real probe, decode, defect and frame-repetition passes through the explicit process runtime", async (t) => {
  const values = fixture(t, "decoded-qa");
  const runRoot = path.join(values.root, RUN_ID);
  const masterPath = path.join(
    runRoot,
    "adapters",
    "render",
    "master.mp4",
  );
  const alignmentPath = path.join(
    runRoot,
    "adapters",
    "alignment",
    "word-timestamps.json",
  );
  const variantsPath = path.join(
    runRoot,
    "adapters",
    "variants",
    "platform-variants.json",
  );
  const binDir = path.join(values.root, "bin");
  const ffmpegPath = path.join(binDir, "ffmpeg.exe");
  const ffprobePath = path.join(binDir, "ffprobe.exe");
  fs.mkdirSync(path.dirname(masterPath), { recursive: true });
  fs.mkdirSync(path.dirname(alignmentPath), { recursive: true });
  fs.mkdirSync(path.dirname(variantsPath), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(masterPath, Buffer.from("decoded-master-media"));
  fs.writeFileSync(ffmpegPath, Buffer.from("injected-test-binary"));
  fs.writeFileSync(ffprobePath, Buffer.from("injected-test-binary"));
  writeJson(alignmentPath, {
    schema_version: "pulse-word-timestamps-v1",
    run_id: RUN_ID,
    word_count: 2,
    words: [
      { text: "Weekly", start_seconds: 0, end_seconds: 1 },
      { text: "recap", start_seconds: 1, end_seconds: 2 },
    ],
  });
  writeJson(variantsPath, {
    schema_version: "pulse-longform-platform-variants-v1",
    run_id: RUN_ID,
    master_sha256: sha256(fs.readFileSync(masterPath)),
    variants: [{ id: "youtube-longform" }],
  });
  const calls = [];
  const runtime = createWeeklyLongformRuntimeDependencies({
    ffmpegPath,
    ffprobePath,
    async processRunner(invocation) {
      calls.push(invocation);
      if (invocation.command === ffprobePath) {
        return {
          status: 0,
          stdout: JSON.stringify({
            streams: [
              {
                codec_type: "video",
                codec_name: "h264",
                width: 1920,
                height: 1080,
                duration: "480.10",
              },
              {
                codec_type: "audio",
                codec_name: "aac",
                duration: "480.00",
              },
            ],
            format: {
              duration: "480.10",
              format_name: "mov,mp4,m4a,3gp,3g2,mj2",
            },
          }),
          stderr: "",
        };
      }
      const filterIndex = invocation.args.indexOf("-vf");
      const filter =
        filterIndex >= 0 ? invocation.args[filterIndex + 1] : "";
      if (filter.includes("blackdetect")) {
        return {
          status: 0,
          stdout: "",
          stderr:
            "black_start:0 black_end:0.4 black_duration:0.4",
        };
      }
      if (filter.includes("freezedetect")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (filter.includes("blurdetect")) {
        return {
          status: 0,
          stdout: "",
          stderr: "blur mean: 2.75",
        };
      }
      if (invocation.args.includes("framehash")) {
        return {
          status: 0,
          stdout: [
            "#format: frame checksums",
            "0, 0, 0, 1, 100, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0, 1, 1, 1, 100, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "0, 2, 2, 1, 100, cccccccccccccccccccccccccccccccc",
            "0, 3, 3, 1, 100, dddddddddddddddddddddddddddddddd",
          ].join("\n"),
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  const result = await runtime.dependencies.runDecodedQa({
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    master_path: masterPath,
    master_sha256: sha256(fs.readFileSync(masterPath)),
    alignment_path: alignmentPath,
    alignment_sha256: sha256(fs.readFileSync(alignmentPath)),
    variants_path: variantsPath,
    variants_sha256: sha256(fs.readFileSync(variantsPath)),
    output_dir: values.outputDir,
  });

  assert.equal(calls.length, 6);
  assert.equal(calls[0].command, ffprobePath);
  assert.ok(calls.slice(1).every((call) => call.command === ffmpegPath));
  const value = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.equal(value.schema_version, "pulse-decoded-qa-v1");
  assert.equal(value.run_id, RUN_ID);
  assert.equal(value.decoder, "ffmpeg+ffprobe");
  assert.equal(value.complete, true);
  assert.equal(value.verdict, "PASS");
  assert.equal(value.decoded_media.width, 1920);
  assert.equal(value.decoded_media.height, 1080);
  assert.equal(value.decoded_media.duration_seconds, 480.1);
  assert.ok(
    Object.values(value.checks).every((check) => check.pass === true),
  );
  assert.equal(value.checks.av_sync.delta_seconds, 0.1);
  assert.equal(value.checks.black_frames.maximum_seconds, 0.4);
  assert.equal(value.checks.blur.maximum_mean, 2.75);
  assert.equal(value.checks.repetition.unique_frame_ratio, 1);
  assert.equal(result.decoder, "ffmpeg+ffprobe");
  assert.equal(result.network_used, false);
  assert.equal(result.sha256, sha256(fs.readFileSync(result.path)));
});

test("a verified injected renderer completes the exact dependency seam consumed by the production-adapter factory", (t) => {
  const values = fixture(t, "capabilities");
  const binDir = path.join(values.root, "bin");
  const ffmpegPath = path.join(binDir, "ffmpeg.exe");
  const ffprobePath = path.join(binDir, "ffprobe.exe");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(ffmpegPath, Buffer.from("injected-test-binary"));
  fs.writeFileSync(ffprobePath, Buffer.from("injected-test-binary"));
  const renderLongform = async () => {
    throw new Error("not_invoked_by_capability_test");
  };
  const runtime = createWeeklyLongformRuntimeDependencies({
    env: {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "pulse-voice",
      PULSE_STATE_ROOT: path.join(values.root, "state"),
    },
    httpClient: async () => {
      throw new Error("not_invoked_by_capability_test");
    },
    ffmpegPath,
    ffprobePath,
    processRunner: async () => {
      throw new Error("not_invoked_by_capability_test");
    },
    renderLongform,
  });

  assert.equal(runtime.capabilities.ready, true);
  assert.deepEqual(runtime.capabilities.blockers, []);
  assert.equal(runtime.dependencies.renderLongform, renderLongform);
  assert.deepEqual(Object.keys(runtime.dependencies), [
    "produceNarration",
    "materializeAlignment",
    "renderLongform",
    "materializeVariants",
    "runDecodedQa",
    "materializeDerivatives",
  ]);
  assert.equal(
    runtime.capabilities.dependencies.materializeDerivatives
      .available,
    true,
  );

  const adapters = createWeeklyLongformProductionAdapters(
    runtime.dependencies,
  );
  assert.equal(adapters.capabilities.ready, true);
  assert.deepEqual(adapters.capabilities.blockers, []);
});
