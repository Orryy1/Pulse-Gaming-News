"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  BUILDER_RESULT_SCHEMA_VERSION,
  canonicalSha256,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  REQUEST_SCHEMA_VERSION:
    PRODUCTION_REQUEST_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-production-coordinator");
const {
  CAPABILITIES_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRuntime,
} = require("../../lib/services/governed-autonomous-production-runtime");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");

const GENERATED_AT = "2026-07-30T07:25:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const STORY_ID = "story-primary";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function builderResult(workspaceRoot) {
  const script =
    "Xbox just confirmed four classics are returning with achievement support.";
  const canonicalIdentityUrl =
    "https://news.xbox.com/en-us/2026/07/30/classics-return/";
  const inventoryFileSha256 = sha256("inventory");
  const productionRequest = {
    schema_version: PRODUCTION_REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    role: "PRIMARY",
    candidate_revision_sha256: sha256("revision"),
    request_fingerprint: sha256("fingerprint"),
    workspace_root: workspaceRoot,
    candidate_source_root: path.join(
      workspaceRoot,
      "source",
      STORY_ID,
    ),
    candidate_workspace_relative_root:
      `output/canary/${STORY_ID}`,
    locked_intake: {
      database_story_binding:
        createGovernedAutonomousDatabaseStoryBinding({
          canonical_story_id: STORY_ID,
          database_story_id: STORY_ID,
          canonical_identity_url: canonicalIdentityUrl,
          inventory_file_sha256: inventoryFileSha256,
          final_script_sha256: sha256(script),
        }),
      inventory_path: path.join(workspaceRoot, "inventory.json"),
      inventory_file_sha256: inventoryFileSha256,
      inventory_root: workspaceRoot,
      allowed_roots: [workspaceRoot],
      canonical_identity_url: canonicalIdentityUrl,
      final_script: script,
      final_script_sha256: sha256(script),
      script_claim_bindings: [
        { claim_key: "return", source_index: 0 },
      ],
      presentation_claim_bindings: [],
      supplemental_official_sources: [],
      contract: { target_duration_seconds: 30 },
      freshness: { publish_by: SCHEDULED_FOR },
      visual_brief: { format: "game_native_news" },
      experiment_dimensions: { eligible: false },
    },
    creative: {
      scenes: [{ asset_id: "xbox-classics", role: "hook" }],
      title: "Four Xbox Classics Are Coming Back",
      description: "Four classics return with achievements.",
      official_source_url:
        "https://news.xbox.com/en-us/2026/07/30/classics-return/",
      required_attributions: ["Official source: Xbox Wire"],
      subject_terms: ["Xbox classics"],
    },
    narration: {
      provider: "elevenlabs",
      voice_id: "pulse-approved",
      model_id: "eleven_multilingual_v2",
      speed: 1,
    },
    visual_qa: {
      reviewers: [
        {
          provider: "ollama",
          model: "gemma3:12b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
        {
          provider: "ollama",
          model: "qwen2.5vl:7b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
      ],
    },
    disclosure_policy: {
      policy_id: "pulse-youtube-synthetic-media",
      policy_version: "1",
    },
  };
  const body = {
    schema_version: BUILDER_RESULT_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    story_id: STORY_ID,
    role: "PRIMARY",
    scheduled_for: SCHEDULED_FOR,
    reservation_set_sha256: sha256("reservation"),
    production_request: productionRequest,
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  return {
    ...body,
    builder_sha256: canonicalSha256(body),
  };
}

function alignment(text) {
  const characters = Array.from(text);
  return {
    characters,
    character_start_times_seconds: characters.map(
      (_, index) => index * 0.01,
    ),
    character_end_times_seconds: characters.map(
      (_, index) => (index + 1) * 0.01,
    ),
  };
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-runtime-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binRoot = path.join(root, "bin");
  await fs.mkdir(binRoot, { recursive: true });
  const executable = async (name) => {
    const filePath = path.join(
      binRoot,
      process.platform === "win32" ? `${name}.exe` : name,
    );
    await fs.writeFile(filePath, name, "utf8");
    return filePath;
  };
  const ffmpegPath = await executable("ffmpeg");
  const ffprobePath = await executable("ffprobe");
  const hyperframesCliPath = await executable("hyperframes");
  const processCalls = [];
  const networkCalls = [];
  const creditCalls = [];
  const processRunner =
    options.processRunner ||
    (async (invocation) => {
      processCalls.push(structuredClone(invocation));
      const outputIndex = invocation.args.indexOf("--output");
      const outputPath =
        outputIndex >= 0
          ? invocation.args[outputIndex + 1]
          : invocation.args.at(-1);
      if (
        invocation.command === ffmpegPath ||
        invocation.command === process.execPath
      ) {
        await fs.mkdir(path.dirname(outputPath), {
          recursive: true,
        });
        await fs.writeFile(
          outputPath,
          Buffer.from(
            `process-output:${path.basename(outputPath)}`,
            "utf8",
          ),
        );
      }
      return { status: 0, stdout: "", stderr: "" };
    });
  const providerResponse = {
    status: 200,
    data: {
      audio_base64: Buffer.from("elevenlabs-audio").toString(
        "base64",
      ),
      alignment: alignment(
        builderResult(root).production_request.locked_intake
          .final_script,
      ),
    },
  };
  const creditReport = {
    schema_version: "pulse-elevenlabs-credit-preflight-v1",
    generated_at: GENERATED_AT,
    provider: "elevenlabs",
    tier: "pro",
    status: "active",
    included_credit_limit: 500000,
    included_credits_remaining: 400000,
    idempotency_key_hash: sha256("credit-key"),
    durable_reservation_state: "reserved",
    verdict: "ALLOW",
    warnings: [],
  };
  const creditLease = {
    report: creditReport,
    replayAvailable: false,
    async markProviderCallStarted() {
      creditCalls.push("provider_started");
    },
    async recordProviderSuccess() {
      creditCalls.push("provider_recorded");
    },
    async markProviderCallAmbiguous() {
      creditCalls.push("provider_ambiguous");
    },
    async complete() {
      creditCalls.push("completed");
    },
  };
  const creditGovernor =
    options.creditGovernor ||
    {
      async preflight() {
        creditCalls.push("preflight");
        return creditLease;
      },
    };
  const elevenLabsHttpClient =
    options.elevenLabsHttpClient ||
    (async (request) => {
      networkCalls.push({
        type: "elevenlabs",
        request: structuredClone(request),
      });
      return providerResponse;
    });
  const loopbackHttpClient =
    options.loopbackHttpClient ||
    (async (request) => {
      networkCalls.push({
        type: "loopback",
        request: structuredClone(request),
      });
      if (new URL(request.url).pathname === "/api/show") {
        return {
          status: 200,
          data: { capabilities: ["completion", "vision"] },
        };
      }
      return {
        status: 200,
        data: {
          done: true,
          message: {
            content: JSON.stringify({
              verdict: "PASS",
              blockers: [],
            }),
          },
        },
      };
    });
  const imageRenderer = async ({ outputPath, svg }) => {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      Buffer.from(`png:${sha256(svg)}`, "utf8"),
    );
  };
  const imageInspector = async () => ({
    width: 1080,
    height: 1920,
  });
  const build = builderResult(root);
  const runtime = buildGovernedAutonomousProductionRuntime({
    builderResult: build,
    env: {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "pulse-approved",
      PULSE_STATE_ROOT: path.join(root, "state"),
    },
    executablePaths: {
      ffmpeg_path: ffmpegPath,
      ffprobe_path: ffprobePath,
      blockers: [],
      resolution: {
        ffmpeg: "injected",
        ffprobe: "injected",
      },
    },
    hyperframesRuntime: {
      cli_path: hyperframesCliPath,
      version: "0.7.77",
      blockers: [],
    },
    processRunner,
    creditGovernor,
    elevenLabsHttpClient,
    loopbackHttpClient,
    imageRenderer,
    imageInspector,
  });
  return {
    root,
    build,
    runtime,
    ffmpegPath,
    ffprobePath,
    hyperframesCliPath,
    processCalls,
    networkCalls,
    creditCalls,
  };
}

test("builds the exact ready LOCAL_PROOF dependency contract without side effects", async (t) => {
  const input = await fixture(t);

  assert.equal(
    input.runtime.capabilities.schema_version,
    CAPABILITIES_SCHEMA_VERSION,
  );
  assert.equal(input.runtime.capabilities.ready, true);
  assert.deepEqual(input.runtime.capabilities.blockers, []);
  assert.deepEqual(
    Object.keys(input.runtime.dependencies).sort(),
    [
      "finalComposite",
      "generateNarration",
      "ownedProgramme",
      "probeNarrationAudio",
      "visualQa",
    ],
  );
  assert.deepEqual(input.processCalls, []);
  assert.deepEqual(input.networkCalls, []);
  assert.deepEqual(input.creditCalls, []);
  assert.equal(
    input.runtime.capabilities.safety.external_publish_authority,
    false,
  );
  assert.equal(
    input.runtime.capabilities.safety.oauth_mutation_authority,
    false,
  );
  assert.equal(
    input.runtime.capabilities.safety.platform_contact_authority,
    false,
  );
});

test("credit preflight and durable reservation happen before the only paid narration call", async (t) => {
  const input = await fixture(t);
  const request = input.build.production_request;
  const audioPath = path.join(input.root, "narration", "voice.mp3");
  const alignmentPath = path.join(
    input.root,
    "narration",
    "alignment.json",
  );

  const generated = await input.runtime.dependencies.generateNarration({
    schema_version:
      "pulse-governed-autonomous-narration-generation-v1",
    mode: "LOCAL_PROOF",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    script_text: request.locked_intake.final_script,
    script_sha256:
      request.locked_intake.final_script_sha256,
    provider: request.narration,
    audio_path: audioPath,
    alignment_path: alignmentPath,
    publish_authority: false,
  });

  assert.deepEqual(input.creditCalls, [
    "preflight",
    "provider_started",
    "provider_recorded",
    "completed",
  ]);
  assert.equal(input.networkCalls.length, 1);
  assert.equal(input.networkCalls[0].type, "elevenlabs");
  assert.equal(
    new URL(input.networkCalls[0].request.url).origin,
    "https://api.elevenlabs.io",
  );
  assert.equal(
    await fs.readFile(audioPath, "utf8"),
    "elevenlabs-audio",
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(alignmentPath, "utf8")),
    providerAlignment(
      request.locked_intake.final_script,
    ),
  );
  assert.equal(generated.provider.id, "elevenlabs");
  assert.equal(generated.provider.http_status, 200);
  assert.equal(generated.provider.provider_result_recorded, true);
  assert.equal(generated.network_used, true);
  assert.equal(generated.transform_status, "COMPLETE");
  assert.equal(
    generated.post_generation_transform_status,
    "COMPLETE",
  );
});

function providerAlignment(text) {
  return alignment(text);
}

test("a credit-governor HOLD prevents the paid provider call and leaves no narration files", async (t) => {
  const input = await fixture(t, {
    creditGovernor: {
      async preflight() {
        throw Object.assign(new Error("reserve crossed"), {
          code: "elevenlabs_credit_reserve_would_be_crossed",
        });
      },
    },
  });
  const request = input.build.production_request;
  const audioPath = path.join(input.root, "blocked", "voice.mp3");
  const alignmentPath = path.join(
    input.root,
    "blocked",
    "alignment.json",
  );

  await assert.rejects(
    () =>
      input.runtime.dependencies.generateNarration({
        schema_version:
          "pulse-governed-autonomous-narration-generation-v1",
        mode: "LOCAL_PROOF",
        story_id: STORY_ID,
        generated_at: GENERATED_AT,
        script_text: request.locked_intake.final_script,
        script_sha256:
          request.locked_intake.final_script_sha256,
        provider: request.narration,
        audio_path: audioPath,
        alignment_path: alignmentPath,
        publish_authority: false,
      }),
    (error) =>
      error?.code ===
      "elevenlabs_credit_reserve_would_be_crossed",
  );
  assert.deepEqual(input.networkCalls, []);
  await assert.rejects(
    () => fs.access(audioPath),
    (error) => error?.code === "ENOENT",
  );
  await assert.rejects(
    () => fs.access(alignmentPath),
    (error) => error?.code === "ENOENT",
  );
});

test("owned programme adapters use deterministic local render and HyperFrames process seams", async (t) => {
  const input = await fixture(t);
  const imagePath = path.join(input.root, "scene.png");
  const videoPath = path.join(input.root, "scene.mp4");
  const programmePath = path.join(input.root, "programme.mp4");
  const scene = {
    asset_id: "owned-hook",
    role: "hook_slam",
    media_type: "image",
    duration_seconds: 3,
    design: {
      schema_version: "pulse-owned-vector-scene-v1",
      headline: "TWO GIANT SHIELDS",
      supporting_text: "A new tank changes the fight",
      accent_colour: "#FF6B1A",
      layout: "TITLE",
    },
  };

  const imageReceipt =
    await input.runtime.dependencies.ownedProgramme.renderScene({
      storyId: STORY_ID,
      scene,
      outputPath: imagePath,
      width: 1080,
      height: 1920,
      fps: 30,
    });
  const videoReceipt =
    await input.runtime.dependencies.ownedProgramme.renderScene({
      storyId: STORY_ID,
      scene: { ...scene, media_type: "video" },
      outputPath: videoPath,
      width: 1080,
      height: 1920,
      fps: 30,
    });
  const projectRoot = path.join(input.root, "hyperframes");
  await fs.mkdir(projectRoot, { recursive: true });
  const programmeReceipt =
    await input.runtime.dependencies.ownedProgramme.renderProgramme({
      storyId: STORY_ID,
      targetDurationSeconds: 30,
      width: 1080,
      height: 1920,
      fps: 30,
      sceneAssets: [],
      hyperframesProject: {
        root: projectRoot,
        manifest_path: path.join(projectRoot, "manifest.json"),
        manifest_sha256: sha256("manifest"),
        project_files: [],
      },
      outputPath: programmePath,
    });

  assert.equal(imageReceipt.network_used, false);
  assert.equal(videoReceipt.network_used, false);
  assert.equal(
    programmeReceipt.generator_identity,
    "hyperframes@0.7.77",
  );
  assert.match(programmeReceipt.adapter_id, /hyperframes/i);
  assert.ok(await fs.stat(imagePath));
  assert.ok(await fs.stat(videoPath));
  assert.ok(await fs.stat(programmePath));
  assert.ok(
    input.processCalls.some(
      (call) =>
        call.command === process.execPath &&
        call.args.includes(input.hyperframesCliPath) &&
        call.args.includes("--no-best-effort"),
    ),
  );
});

test("final composite adapters and narration probe use only the injected process runner", async (t) => {
  const input = await fixture(t, {
    processRunner: async (invocation) => {
      const isProbe = invocation.command.includes("ffprobe");
      if (isProbe) {
        return {
          status: 0,
          stdout: JSON.stringify({
            streams: [
              {
                codec_type: "audio",
                codec_name: "mp3",
                duration: "12.5",
              },
            ],
            format: { duration: "12.5", format_name: "mp3" },
          }),
          stderr: "",
        };
      }
      const outputPath = invocation.args.at(-1);
      if (path.isAbsolute(outputPath)) {
        await fs.mkdir(path.dirname(outputPath), {
          recursive: true,
        });
        await fs.writeFile(outputPath, "rendered", "utf8");
      }
      if (invocation.args.some((arg) => String(arg).includes("loudnorm="))) {
        return {
          status: 0,
          stdout: "",
          stderr: JSON.stringify({
            input_i: "-16",
            input_tp: "-2",
            input_lra: "5",
            input_thresh: "-26",
            target_offset: "0",
          }),
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  const audioPath = path.join(input.root, "audio.mp3");
  await fs.writeFile(audioPath, "audio", "utf8");

  assert.deepEqual(
    await input.runtime.dependencies.probeNarrationAudio(audioPath),
    {
      duration_seconds: 12.5,
      codec_name: "mp3",
      has_audio: true,
    },
  );
  assert.equal(
    input.runtime.dependencies.finalComposite.ffmpegPath,
    input.ffmpegPath,
  );
  const loudness =
    await input.runtime.dependencies.finalComposite.measureLoudness(
      audioPath,
      "source_audio",
    );
  assert.equal(loudness.integrated_lufs, -16);
  const invocation = {
    command: input.ffmpegPath,
    args: ["-i", audioPath, path.join(input.root, "final.mp4")],
    cwd: input.root,
    outputPath: path.join(input.root, "final.mp4"),
  };
  await input.runtime.dependencies.finalComposite.renderComposite(
    invocation,
  );
  assert.equal(
    await fs.readFile(invocation.outputPath, "utf8"),
    "rendered",
  );
});

test("visual QA extracts frames and proves local model vision capability before review", async (t) => {
  const input = await fixture(t);
  const finalMp4 = path.join(input.root, "final.mp4");
  await fs.writeFile(finalMp4, "final", "utf8");
  const framesDir = path.join(input.root, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  const frames =
    await input.runtime.dependencies.visualQa.extractFrames({
      story_id: STORY_ID,
      final_mp4: {
        path: finalMp4,
        sha256: sha256("final"),
      },
      frame_plan: [
        { frame_id: "frame-000", timestamp_ms: 0 },
        { frame_id: "frame-001", timestamp_ms: 1000 },
        { frame_id: "frame-002", timestamp_ms: 2000 },
      ],
      frames_dir: framesDir,
      publish_authority: false,
    });
  const adapter =
    input.runtime.dependencies.visualQa.reviewerAdapters[
      "ollama:gemma3:12b"
    ];
  const review = await adapter({
    story_id: STORY_ID,
    final_mp4: {
      path: finalMp4,
      sha256: sha256("final"),
    },
    frames,
    endpoint_origin: "http://127.0.0.1:11434",
    publish_authority: false,
  });

  assert.equal(frames.length, 3);
  assert.ok(
    frames.every(
      (frame) =>
        frame.width === 1080 &&
        frame.height === 1920 &&
        frame.deterministic_blockers.length === 0,
    ),
  );
  assert.deepEqual(review, {
    provider: "ollama",
    model: "gemma3:12b",
    verdict: "PASS",
    blockers: [],
    capability_evidence: {
      completion: true,
      vision: true,
    },
  });
  const loopback = input.networkCalls.filter(
    (call) => call.type === "loopback",
  );
  assert.deepEqual(
    loopback.map((call) => new URL(call.request.url).pathname),
    ["/api/show", "/api/chat"],
  );
  assert.equal(
    loopback[1].request.data.messages[0].images.length,
    3,
  );
});

test("reports exact binary, credential and local-review blockers without constructing unsafe dependencies", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-runtime-blocked-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const runtime = buildGovernedAutonomousProductionRuntime({
    builderResult: builderResult(root),
    env: {},
    executablePaths: {
      ffmpeg_path: null,
      ffprobe_path: null,
      blockers: [
        "ffmpeg_binary_unavailable",
        "ffprobe_binary_unavailable",
      ],
      resolution: {},
    },
    hyperframesRuntime: {
      cli_path: null,
      version: null,
      blockers: [
        "hyperframes_cli_unavailable",
        "hyperframes_version_unavailable",
      ],
    },
  });

  assert.equal(runtime.capabilities.ready, false);
  assert.deepEqual(runtime.dependencies, {});
  for (const blocker of [
    "ffmpeg_binary_unavailable",
    "ffprobe_binary_unavailable",
    "hyperframes_cli_unavailable",
    "hyperframes_version_unavailable",
    "elevenlabs_api_key_unavailable",
    "elevenlabs_voice_id_unavailable",
    "elevenlabs_credit_state_root_unavailable",
    "elevenlabs_http_client_unavailable",
    "elevenlabs_credit_governor_unavailable",
  ]) {
    assert.ok(runtime.capabilities.blockers.includes(blocker));
  }
  assert.equal(
    runtime.capabilities.safety.external_publish_authority,
    false,
  );
});
