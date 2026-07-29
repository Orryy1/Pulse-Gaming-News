"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createWeeklyLongformProductionAdapters,
} = require("../../lib/services/weekly-longform-production-adapters");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  runGovernedWeeklyLongformProduction,
} = require("../../lib/services/weekly-longform-production-runner");
const {
  workOrderFingerprint,
} = require("../../lib/services/weekly-longform-work-order");

const RUN_ID = "weekly-adapter-2026-07-28";
const GENERATED_AT = "2026-07-28T16:00:00.000Z";

function fixture(t, adapterName) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-adapters-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDir = path.join(root, RUN_ID, "adapters", adapterName);
  fs.mkdirSync(outputDir, { recursive: true });
  return {
    root,
    outputDir,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return sha256(fs.readFileSync(filePath));
}

function readyWorkOrder(evidenceRoot = null) {
  const fullScript = Array.from(
    { length: 1_200 },
    (_, index) => `verified-${index + 1}`,
  ).join(" ");
  const selected = [1, 2, 3, 4].map((index) => {
    const storyId = `weekly-adapter-story-${index}`;
    const sourceUrl =
      `https://example.com/official/${storyId}`;
    const claims = [
      {
        claim_id: `${storyId}-claim-1`,
        story_id: storyId,
        text: `Verified adapter claim ${index}`,
      },
    ];
    let sourceEvidence = {
      sha256: String(index).repeat(64),
      claims,
    };
    if (evidenceRoot) {
      const sourcePath = path.join(
        evidenceRoot,
        `${storyId}-source-evidence.json`,
      );
      sourceEvidence = {
        path: sourcePath,
        sha256: writeJson(sourcePath, {
          schema_version: "pulse-source-evidence-v1",
          story_id: storyId,
          source_type: "official",
          source_url: sourceUrl,
          claims,
        }),
        claims,
      };
    }
    const admittedAssetIds = [
      `${storyId}-gameplay`,
      `${storyId}-key-art`,
      `${storyId}-screenshot`,
    ];
    return {
      story_id: storyId,
      title: `Verified weekly adapter story ${index}`,
      primary_source_url: sourceUrl,
      source_evidence: sourceEvidence,
      rights_ledger: { sha256: String(index + 4).repeat(64) },
      visual_asset_admission: {
        schema_version:
          "pulse-weekly-longform-visual-admission-v1",
        status: "READY",
        blockers: [],
        admitted_asset_ids: admittedAssetIds,
        landscape_exact_subject_asset_count: 3,
        landscape_exact_subject_motion_count: 1,
      },
    };
  });
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: GENERATED_AT,
    generator_identity: "pulse-weekly-longform-work-order-v1",
    run_id: RUN_ID,
    mode: "LOCAL_PROOF",
    status: "HOLD",
    blockers: [
      "final_narration_evidence_required",
      "real_word_alignment_evidence_required",
      "final_master_evidence_required",
    ],
    production_runner_admission: {
      status: "READY",
      scope: "LOCAL_PROOF_PRODUCTION_RUNNER",
      blockers: [],
    },
    selection: {
      minimum_story_count: 4,
      maximum_story_count: 6,
      selected,
    },
    dossier: {
      schema_version: "pulse-weekly-editorial-dossier-v1",
      story_count: selected.length,
      stories: selected,
    },
    script: {
      schema_version: "pulse-weekly-longform-script-v1",
      full_script: fullScript,
      sha256: sha256(Buffer.from(fullScript)),
      word_count: 1_200,
      estimated_duration_seconds: 480,
    },
    visual_beat_plan: {
      schema_version: "pulse-weekly-visual-beat-plan-v1",
      beats: selected.flatMap((story) =>
        story.visual_asset_admission.admitted_asset_ids.map(
          (assetItemId, index) => ({
            beat_id: `${story.story_id}-beat-${index + 1}`,
            story_id: story.story_id,
            asset_item_id: assetItemId,
          }),
        ),
      ),
    },
    derivative_plan: {
      schema_version: "pulse-weekly-derivative-plan-v1",
      items: [{ derivative_id: "weekly-short-1" }],
    },
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);
  return workOrder;
}

test("the default factory reports every unavailable real capability and exposes no runnable adapter", () => {
  const bundle = createWeeklyLongformProductionAdapters();

  assert.equal(
    bundle.capabilities.schema_version,
    "pulse-weekly-longform-adapter-capabilities-v1",
  );
  assert.equal(bundle.capabilities.ready, false);
  assert.deepEqual(bundle.capabilities.blockers, [
    "elevenlabs_narration_producer_unavailable",
    "real_alignment_producer_unavailable",
    "hyperframes_or_ffmpeg_renderer_unavailable",
    "platform_variants_producer_unavailable",
    "decoded_qa_producer_unavailable",
  ]);
  assert.deepEqual(bundle.adapters, {});
  assert.deepEqual(bundle.capabilities.safety, {
    implicit_network_enabled: false,
    implicit_process_spawn_enabled: false,
    upload_authority: false,
    oauth_mutation_authority: false,
    database_mutation_authority: false,
  });
});

test("the narration adapter binds observed ElevenLabs output and forwards the exact script contract", async (t) => {
  const values = fixture(t, "narration");
  const scriptText = "A verified weekly script with exact copy.";
  const scriptPath = path.join(values.root, RUN_ID, "script.txt");
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  let received;
  const bundle = createWeeklyLongformProductionAdapters({
    async produceNarration(input) {
      received = input;
      const audioPath = path.join(input.output_dir, "narration.mp3");
      fs.writeFileSync(audioPath, Buffer.from("real-provider-audio-bytes"));
      return {
        path: audioPath,
        sha256: sha256(fs.readFileSync(audioPath)),
        provider: "elevenlabs",
        voice_id: "pulse-editorial-voice",
        model_id: "eleven_multilingual_v2",
        network_used: true,
      };
    },
  });

  const result = await bundle.adapters.narration.materialize({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    outputDir: values.outputDir,
    workOrder: { schema_version: "pulse-weekly-longform-work-order-v1" },
    script: {
      path: scriptPath,
      sha256: sha256(Buffer.from(scriptText)),
      text: scriptText,
    },
  });

  assert.equal(received.run_id, RUN_ID);
  assert.equal(received.generated_at, GENERATED_AT);
  assert.equal(received.text, scriptText);
  assert.equal(received.script_path, scriptPath);
  assert.equal(received.script_sha256, sha256(Buffer.from(scriptText)));
  assert.equal(received.output_dir, values.outputDir);
  assert.equal(result.sha256, sha256(fs.readFileSync(result.path)));
  assert.equal(result.provider, "elevenlabs");
  assert.equal(result.voice_id, "pulse-editorial-voice");
  assert.equal(result.model_id, "eleven_multilingual_v2");
  assert.equal(result.network_used, true);
  assert.equal(bundle.capabilities.adapters.narration.available, true);
});

test("a tampered script is rejected before an injected narration producer can run", async (t) => {
  const values = fixture(t, "narration");
  const expectedText = "Exact approved copy";
  const scriptPath = path.join(values.root, RUN_ID, "script.txt");
  fs.writeFileSync(scriptPath, "tampered copy", "utf8");
  let called = false;
  const bundle = createWeeklyLongformProductionAdapters({
    async produceNarration() {
      called = true;
      throw new Error("must_not_run");
    },
  });

  await assert.rejects(
    () =>
      bundle.adapters.narration.materialize({
        runId: RUN_ID,
        generatedAt: GENERATED_AT,
        outputDir: values.outputDir,
        script: {
          path: scriptPath,
          sha256: sha256(Buffer.from(expectedText)),
          text: expectedText,
        },
      }),
    (error) =>
      error?.name === "WeeklyLongformProductionAdapterError" &&
      error.codes.includes("adapter_script_file_sha256_mismatch"),
  );
  assert.equal(called, false);
});

test("the alignment adapter accepts only exact real provider word timing bound to script and audio", async (t) => {
  const values = fixture(t, "alignment");
  const scriptText = "Exact words need real timing";
  const scriptPath = path.join(values.root, RUN_ID, "script.txt");
  const audioPath = path.join(
    values.root,
    RUN_ID,
    "adapters",
    "narration",
    "narration.mp3",
  );
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  fs.writeFileSync(audioPath, Buffer.from("bound-narration"));
  let received;
  const bundle = createWeeklyLongformProductionAdapters({
    async materializeAlignment(input) {
      received = input;
      const alignmentPath = path.join(
        input.output_dir,
        "word-timestamps.json",
      );
      writeJson(alignmentPath, {
        schema_version: "pulse-word-timestamps-v1",
        run_id: input.run_id,
        script_sha256: input.script_sha256,
        audio_sha256: input.audio_sha256,
        source_alignment_sha256: "a".repeat(64),
        provider: "whisperx",
        timing_basis: "forced_alignment",
        word_count: 5,
        words: [
          { text: "Exact", start_seconds: 0, end_seconds: 0.2 },
          { text: "words", start_seconds: 0.2, end_seconds: 0.4 },
          { text: "need", start_seconds: 0.4, end_seconds: 0.6 },
          { text: "real", start_seconds: 0.6, end_seconds: 0.8 },
          { text: "timing", start_seconds: 0.8, end_seconds: 1 },
        ],
      });
      return {
        path: alignmentPath,
        sha256: sha256(fs.readFileSync(alignmentPath)),
        provider: "whisperx",
        network_used: false,
      };
    },
  });

  const result = await bundle.adapters.alignment.materialize({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    outputDir: values.outputDir,
    workOrder: { schema_version: "pulse-weekly-longform-work-order-v1" },
    script: {
      path: scriptPath,
      sha256: sha256(fs.readFileSync(scriptPath)),
      text: scriptText,
    },
    narration: {
      path: audioPath,
      sha256: sha256(fs.readFileSync(audioPath)),
    },
  });

  assert.equal(received.run_id, RUN_ID);
  assert.equal(received.script_path, scriptPath);
  assert.equal(received.audio_path, audioPath);
  assert.equal(received.output_dir, values.outputDir);
  assert.equal(result.provider, "whisperx");
  assert.equal(result.sha256, sha256(fs.readFileSync(result.path)));
  assert.equal(result.network_used, false);
});

test("estimated or uniformly invented word timing is rejected as non-evidence", async (t) => {
  const values = fixture(t, "alignment");
  const scriptText = "Real timing required";
  const scriptPath = path.join(values.root, RUN_ID, "script.txt");
  const audioPath = path.join(
    values.root,
    RUN_ID,
    "adapters",
    "narration",
    "narration.mp3",
  );
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  fs.writeFileSync(audioPath, Buffer.from("narration"));
  const bundle = createWeeklyLongformProductionAdapters({
    async materializeAlignment(input) {
      const alignmentPath = path.join(
        input.output_dir,
        "word-timestamps.json",
      );
      writeJson(alignmentPath, {
        schema_version: "pulse-word-timestamps-v1",
        run_id: input.run_id,
        script_sha256: input.script_sha256,
        audio_sha256: input.audio_sha256,
        source_alignment_sha256: "a".repeat(64),
        provider: "estimated",
        timing_basis: "uniform_estimate",
        word_count: 3,
        words: [
          { text: "Real", start_seconds: 0, end_seconds: 0.2 },
          { text: "timing", start_seconds: 0.2, end_seconds: 0.4 },
          { text: "required", start_seconds: 0.4, end_seconds: 0.6 },
        ],
      });
      return {
        path: alignmentPath,
        sha256: sha256(fs.readFileSync(alignmentPath)),
      };
    },
  });

  await assert.rejects(
    () =>
      bundle.adapters.alignment.materialize({
        runId: RUN_ID,
        generatedAt: GENERATED_AT,
        outputDir: values.outputDir,
        script: {
          path: scriptPath,
          sha256: sha256(fs.readFileSync(scriptPath)),
          text: scriptText,
        },
        narration: {
          path: audioPath,
          sha256: sha256(fs.readFileSync(audioPath)),
        },
      }),
    (error) =>
      error?.name === "WeeklyLongformProductionAdapterError" &&
      error.codes.includes("real_word_alignment_provider_required"),
  );
});

test("the render adapter requires a HyperFrames or FFmpeg master with a cleared hash-bound rights ledger", async (t) => {
  const values = fixture(t, "render");
  const runRoot = path.join(values.root, RUN_ID);
  const scriptText = "Bound render copy";
  const scriptPath = path.join(runRoot, "script.txt");
  const narrationPath = path.join(
    runRoot,
    "adapters",
    "narration",
    "narration.mp3",
  );
  const alignmentPath = path.join(
    runRoot,
    "adapters",
    "alignment",
    "word-timestamps.json",
  );
  fs.mkdirSync(path.dirname(narrationPath), { recursive: true });
  fs.mkdirSync(path.dirname(alignmentPath), { recursive: true });
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  fs.writeFileSync(narrationPath, Buffer.from("real-audio"));
  writeJson(alignmentPath, { schema_version: "pulse-word-timestamps-v1" });
  let received;
  const bundle = createWeeklyLongformProductionAdapters({
    async renderLongform(input) {
      received = input;
      const masterPath = path.join(input.output_dir, "master.mp4");
      fs.writeFileSync(masterPath, Buffer.from("decoded-master-media"));
      const masterSha256 = sha256(fs.readFileSync(masterPath));
      const rightsPath = path.join(input.output_dir, "rights-ledger.json");
      const rights = {
        schema_version: "pulse-longform-rights-ledger-v1",
        run_id: input.run_id,
        master_sha256: masterSha256,
        ledger_version: 1,
        decision: "CLEARED",
        items: [
          {
            item_id: "owned-motion-master",
            source_url: `pulse-owned://${input.run_id}/motion`,
            asset_sha256: masterSha256,
            included_in_final: true,
            rights_decision: "CLEARED",
            rights_basis: "OWNED",
            rights_evidence: {
              reference: `operator-evidence://${input.run_id}/render`,
              sha256: "b".repeat(64),
            },
            attribution_decision: "NOT_REQUIRED",
            attribution_text: null,
          },
        ],
      };
      rights.ledger_sha256 = hashRightsLedger(rights);
      writeJson(rightsPath, rights);
      const rendererManifestPath = path.join(
        input.output_dir,
        "native-renderer-manifest.json",
      );
      const originalityPath = path.join(
        input.output_dir,
        "measured-originality.json",
      );
      writeJson(rendererManifestPath, {
        schema_version:
          "pulse-weekly-longform-native-renderer-manifest-v1",
      });
      writeJson(originalityPath, {
        schema_version:
          "pulse-weekly-longform-originality-transformation-measurement-v1",
      });
      return {
        master: {
          path: masterPath,
          sha256: masterSha256,
        },
        rights: {
          path: rightsPath,
          sha256: sha256(fs.readFileSync(rightsPath)),
        },
        renderer: "hyperframes+ffmpeg",
        renderer_manifest: {
          path: rendererManifestPath,
          sha256: sha256(fs.readFileSync(rendererManifestPath)),
        },
        originality_transformation: {
          path: originalityPath,
          sha256: sha256(fs.readFileSync(originalityPath)),
        },
        network_used: false,
      };
    },
  });

  const result = await bundle.adapters.render.materialize({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    outputDir: values.outputDir,
    workOrder: {
      visual_beat_plan: { beats: [{ beat_id: "beat-1" }] },
      derivative_plan: { items: [{ derivative_id: "clip-1" }] },
    },
    script: {
      path: scriptPath,
      sha256: sha256(fs.readFileSync(scriptPath)),
      text: scriptText,
    },
    narration: {
      path: narrationPath,
      sha256: sha256(fs.readFileSync(narrationPath)),
    },
    alignment: {
      path: alignmentPath,
      sha256: sha256(fs.readFileSync(alignmentPath)),
      value: JSON.parse(fs.readFileSync(alignmentPath, "utf8")),
    },
  });

  assert.equal(received.audio_path, narrationPath);
  assert.equal(received.alignment_path, alignmentPath);
  assert.equal(received.visual_beat_plan.beats[0].beat_id, "beat-1");
  assert.equal(result.renderer, "hyperframes+ffmpeg");
  assert.equal(result.master.sha256, sha256(fs.readFileSync(result.master.path)));
  assert.equal(result.rights.sha256, sha256(fs.readFileSync(result.rights.path)));
  assert.equal(
    result.renderer_manifest.sha256,
    sha256(fs.readFileSync(result.renderer_manifest.path)),
  );
  assert.equal(
    result.originality_transformation.sha256,
    sha256(fs.readFileSync(result.originality_transformation.path)),
  );
  assert.equal(result.network_used, false);
});

test("the render adapter rejects attribution-only records as a substitute for permission", async (t) => {
  const values = fixture(t, "render");
  const runRoot = path.join(values.root, RUN_ID);
  const scriptText = "Rights-bound render copy";
  const scriptPath = path.join(runRoot, "script.txt");
  const narrationPath = path.join(
    runRoot,
    "adapters",
    "narration",
    "narration.mp3",
  );
  const alignmentPath = path.join(
    runRoot,
    "adapters",
    "alignment",
    "word-timestamps.json",
  );
  fs.mkdirSync(path.dirname(narrationPath), { recursive: true });
  fs.mkdirSync(path.dirname(alignmentPath), { recursive: true });
  fs.writeFileSync(scriptPath, scriptText, "utf8");
  fs.writeFileSync(narrationPath, Buffer.from("real-audio"));
  writeJson(alignmentPath, { schema_version: "pulse-word-timestamps-v1" });
  const bundle = createWeeklyLongformProductionAdapters({
    async renderLongform(input) {
      const masterPath = path.join(input.output_dir, "master.mp4");
      fs.writeFileSync(masterPath, Buffer.from("ffmpeg-master"));
      const masterSha256 = sha256(fs.readFileSync(masterPath));
      const rightsPath = path.join(input.output_dir, "rights-ledger.json");
      const rights = {
        schema_version: "pulse-longform-rights-ledger-v1",
        run_id: input.run_id,
        master_sha256: masterSha256,
        ledger_version: 1,
        decision: "CLEARED",
        items: [
          {
            item_id: "third-party-clip",
            source_url: "https://example.invalid/trailer",
            asset_sha256: masterSha256,
            included_in_final: true,
            rights_decision: "CLEARED",
            rights_basis: "ATTRIBUTION_ONLY",
            rights_evidence: {
              reference: "onscreen-credit",
              sha256: "c".repeat(64),
            },
            attribution_decision: "REQUIRED_AND_SUPPLIED",
            attribution_text: "Source: Example",
          },
        ],
      };
      rights.ledger_sha256 = hashRightsLedger(rights);
      writeJson(rightsPath, rights);
      return {
        master: { path: masterPath, sha256: masterSha256 },
        rights: {
          path: rightsPath,
          sha256: sha256(fs.readFileSync(rightsPath)),
        },
        renderer: "ffmpeg",
      };
    },
  });

  await assert.rejects(
    () =>
      bundle.adapters.render.materialize({
        runId: RUN_ID,
        generatedAt: GENERATED_AT,
        outputDir: values.outputDir,
        workOrder: { visual_beat_plan: { beats: [] } },
        script: {
          path: scriptPath,
          sha256: sha256(fs.readFileSync(scriptPath)),
          text: scriptText,
        },
        narration: {
          path: narrationPath,
          sha256: sha256(fs.readFileSync(narrationPath)),
        },
        alignment: {
          path: alignmentPath,
          sha256: sha256(fs.readFileSync(alignmentPath)),
        },
      }),
    (error) =>
      error?.name === "WeeklyLongformProductionAdapterError" &&
      error.codes.includes("attribution_is_not_permission"),
  );
});

test("the variants adapter binds real decoded platform files to the exact master", async (t) => {
  const values = fixture(t, "variants");
  const masterPath = path.join(
    values.root,
    RUN_ID,
    "adapters",
    "render",
    "master.mp4",
  );
  fs.mkdirSync(path.dirname(masterPath), { recursive: true });
  fs.writeFileSync(masterPath, Buffer.from("landscape-master"));
  let received;
  const bundle = createWeeklyLongformProductionAdapters({
    async materializeVariants(input) {
      received = input;
      const verticalPath = path.join(input.output_dir, "vertical.mp4");
      fs.writeFileSync(verticalPath, Buffer.from("vertical-derived-media"));
      const manifestPath = path.join(
        input.output_dir,
        "platform-variants.json",
      );
      writeJson(manifestPath, {
        schema_version: "pulse-longform-platform-variants-v1",
        run_id: input.run_id,
        master_sha256: input.master_sha256,
        variants: [
          {
            id: "weekly-youtube-vertical",
            platform: "YOUTUBE_SHORTS",
            path: verticalPath,
            sha256: sha256(fs.readFileSync(verticalPath)),
            width: 1080,
            height: 1920,
            duration_seconds: 59,
            container: "mp4",
            video_codec: "h264",
            audio_codec: "aac",
          },
        ],
      });
      return {
        path: manifestPath,
        sha256: sha256(fs.readFileSync(manifestPath)),
        network_used: false,
      };
    },
  });

  const result = await bundle.adapters.variants.materialize({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    outputDir: values.outputDir,
    workOrder: {
      derivative_plan: { items: [{ derivative_id: "clip-1" }] },
    },
    master: {
      path: masterPath,
      sha256: sha256(fs.readFileSync(masterPath)),
    },
  });

  assert.equal(received.master_path, masterPath);
  assert.equal(received.master_sha256, sha256(fs.readFileSync(masterPath)));
  assert.equal(received.derivative_plan.items[0].derivative_id, "clip-1");
  assert.equal(result.variant_count, 1);
  assert.equal(result.sha256, sha256(fs.readFileSync(result.path)));
  assert.equal(result.network_used, false);
});

test("the decoded QA adapter requires a complete FFmpeg or FFprobe PASS bound to the master", async (t) => {
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
  fs.mkdirSync(path.dirname(masterPath), { recursive: true });
  fs.mkdirSync(path.dirname(alignmentPath), { recursive: true });
  fs.mkdirSync(path.dirname(variantsPath), { recursive: true });
  fs.writeFileSync(masterPath, Buffer.from("decoded-master"));
  writeJson(alignmentPath, { schema_version: "pulse-word-timestamps-v1" });
  writeJson(variantsPath, {
    schema_version: "pulse-longform-platform-variants-v1",
  });
  let received;
  const bundle = createWeeklyLongformProductionAdapters({
    async runDecodedQa(input) {
      received = input;
      const qaPath = path.join(input.output_dir, "decoded-qa.json");
      writeJson(qaPath, {
        schema_version: "pulse-decoded-qa-v1",
        run_id: input.run_id,
        master_sha256: input.master_sha256,
        decoder: "ffmpeg+ffprobe",
        complete: true,
        verdict: "PASS",
        decoded_media: {
          width: 1920,
          height: 1080,
          duration_seconds: 512.4,
          container: "mp4",
          video_codec: "h264",
          audio_codec: "aac",
        },
        checks: {
          video_decode: { pass: true },
          audio_decode: { pass: true },
          captions: { pass: true },
          av_sync: { pass: true },
          black_frames: { pass: true },
          freeze_frames: { pass: true },
          blur: { pass: true },
          repetition: { pass: true },
        },
      });
      const nativeQaPath = path.join(
        input.output_dir,
        "native-renderer-qa.json",
      );
      writeJson(nativeQaPath, {
        schema_version:
          "pulse-weekly-longform-native-renderer-qa-v1",
      });
      return {
        path: qaPath,
        sha256: sha256(fs.readFileSync(qaPath)),
        native_renderer_qa: {
          path: nativeQaPath,
          sha256: sha256(fs.readFileSync(nativeQaPath)),
        },
        network_used: false,
      };
    },
  });

  const result = await bundle.adapters.decodedQa.materialize({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    outputDir: values.outputDir,
    workOrder: { schema_version: "pulse-weekly-longform-work-order-v1" },
    renderer_manifest: {
      path: path.join(
        runRoot,
        "adapters",
        "render",
        "renderer-manifest.json",
      ),
      sha256: "e".repeat(64),
    },
    master: {
      path: masterPath,
      sha256: sha256(fs.readFileSync(masterPath)),
    },
    alignment: {
      path: alignmentPath,
      sha256: sha256(fs.readFileSync(alignmentPath)),
    },
    variants: {
      path: variantsPath,
      sha256: sha256(fs.readFileSync(variantsPath)),
    },
  });

  assert.equal(received.master_path, masterPath);
  assert.equal(received.alignment_path, alignmentPath);
  assert.equal(received.variants_path, variantsPath);
  assert.deepEqual(received.renderer_manifest, {
    path: path.join(
      runRoot,
      "adapters",
      "render",
      "renderer-manifest.json",
    ),
    sha256: "e".repeat(64),
  });
  assert.equal(result.decoder, "ffmpeg+ffprobe");
  assert.equal(result.sha256, sha256(fs.readFileSync(result.path)));
  assert.equal(
    result.native_renderer_qa.sha256,
    sha256(fs.readFileSync(result.native_renderer_qa.path)),
  );
  assert.equal(result.network_used, false);
});

test("decoded QA cannot claim readiness when any required decoded-media check fails", async (t) => {
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
  fs.mkdirSync(path.dirname(masterPath), { recursive: true });
  fs.mkdirSync(path.dirname(alignmentPath), { recursive: true });
  fs.mkdirSync(path.dirname(variantsPath), { recursive: true });
  fs.writeFileSync(masterPath, Buffer.from("master-with-freeze"));
  writeJson(alignmentPath, { schema_version: "pulse-word-timestamps-v1" });
  writeJson(variantsPath, {
    schema_version: "pulse-longform-platform-variants-v1",
  });
  const bundle = createWeeklyLongformProductionAdapters({
    async runDecodedQa(input) {
      const qaPath = path.join(input.output_dir, "decoded-qa.json");
      const checks = Object.fromEntries(
        [
          "video_decode",
          "audio_decode",
          "captions",
          "av_sync",
          "black_frames",
          "freeze_frames",
          "blur",
          "repetition",
        ].map((check) => [check, { pass: check !== "freeze_frames" }]),
      );
      writeJson(qaPath, {
        schema_version: "pulse-decoded-qa-v1",
        run_id: input.run_id,
        master_sha256: input.master_sha256,
        decoder: "ffprobe",
        complete: true,
        verdict: "PASS",
        decoded_media: {
          width: 1920,
          height: 1080,
          duration_seconds: 480,
          container: "mp4",
          video_codec: "h264",
          audio_codec: "aac",
        },
        checks,
      });
      return {
        path: qaPath,
        sha256: sha256(fs.readFileSync(qaPath)),
      };
    },
  });

  await assert.rejects(
    () =>
      bundle.adapters.decodedQa.materialize({
        runId: RUN_ID,
        generatedAt: GENERATED_AT,
        outputDir: values.outputDir,
        master: {
          path: masterPath,
          sha256: sha256(fs.readFileSync(masterPath)),
        },
        alignment: {
          path: alignmentPath,
          sha256: sha256(fs.readFileSync(alignmentPath)),
        },
        variants: {
          path: variantsPath,
          sha256: sha256(fs.readFileSync(variantsPath)),
        },
      }),
    (error) =>
      error?.name === "WeeklyLongformProductionAdapterError" &&
      error.codes.includes("decoded_qa_check_failed_freeze_frames"),
  );
});

test("the complete injected factory remains on HOLD until independent review measurements are supplied", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-adapter-integration-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createWeeklyLongformProductionAdapters({
    async produceNarration(input) {
      const filePath = path.join(input.output_dir, "narration.mp3");
      fs.writeFileSync(filePath, Buffer.from("elevenlabs-audio-response"));
      return {
        path: filePath,
        sha256: sha256(fs.readFileSync(filePath)),
        provider: "elevenlabs",
        voice_id: "pulse-editorial-voice",
        model_id: "eleven_multilingual_v2",
        network_used: true,
      };
    },
    async materializeAlignment(input) {
      const filePath = path.join(
        input.output_dir,
        "word-timestamps.json",
      );
      const words = input.script_text
        .split(/\s+/)
        .filter(Boolean)
        .map((word, index) => ({
          text: word,
          start_seconds: Number((index * 0.4).toFixed(3)),
          end_seconds: Number(((index + 1) * 0.4).toFixed(3)),
        }));
      writeJson(filePath, {
        schema_version: "pulse-word-timestamps-v1",
        run_id: input.run_id,
        script_sha256: input.script_sha256,
        audio_sha256: input.audio_sha256,
        source_alignment_sha256: "a".repeat(64),
        provider: "elevenlabs",
        timing_basis: "provider_word_alignment",
        word_count: words.length,
        words,
      });
      return {
        path: filePath,
        sha256: sha256(fs.readFileSync(filePath)),
        network_used: false,
      };
    },
    async renderLongform(input) {
      const masterPath = path.join(input.output_dir, "master.mp4");
      fs.writeFileSync(masterPath, Buffer.from("hyperframes-ffmpeg-master"));
      const masterSha256 = sha256(fs.readFileSync(masterPath));
      const rightsPath = path.join(input.output_dir, "rights.json");
      const rights = {
        schema_version: "pulse-longform-rights-ledger-v1",
        run_id: input.run_id,
        master_sha256: masterSha256,
        ledger_version: 1,
        decision: "CLEARED",
        items: [
          {
            item_id: "owned-weekly-master",
            source_url: `pulse-owned://${input.run_id}/master`,
            asset_sha256: masterSha256,
            included_in_final: true,
            rights_decision: "CLEARED",
            rights_basis: "OWNED",
            rights_evidence: {
              reference: `operator-evidence://${input.run_id}/render`,
              sha256: "b".repeat(64),
            },
            attribution_decision: "NOT_REQUIRED",
            attribution_text: null,
          },
        ],
      };
      rights.ledger_sha256 = hashRightsLedger(rights);
      writeJson(rightsPath, rights);
      return {
        master: { path: masterPath, sha256: masterSha256 },
        rights: {
          path: rightsPath,
          sha256: sha256(fs.readFileSync(rightsPath)),
        },
        renderer: "hyperframes+ffmpeg",
        network_used: false,
      };
    },
    async materializeVariants(input) {
      const filePath = path.join(
        input.output_dir,
        "platform-variants.json",
      );
      writeJson(filePath, {
        schema_version: "pulse-longform-platform-variants-v1",
        run_id: input.run_id,
        master_sha256: input.master_sha256,
        variants: [
          {
            id: "youtube-longform",
            platform: "YOUTUBE_LONGFORM",
            path: input.master_path,
            sha256: input.master_sha256,
            width: 1920,
            height: 1080,
            duration_seconds: 480,
            container: "mp4",
            video_codec: "h264",
            audio_codec: "aac",
          },
        ],
      });
      return {
        path: filePath,
        sha256: sha256(fs.readFileSync(filePath)),
        network_used: false,
      };
    },
    async runDecodedQa(input) {
      const filePath = path.join(input.output_dir, "decoded-qa.json");
      writeJson(filePath, {
        schema_version: "pulse-decoded-qa-v1",
        run_id: input.run_id,
        master_sha256: input.master_sha256,
        decoder: "ffmpeg+ffprobe",
        complete: true,
        verdict: "PASS",
        decoded_media: {
          width: 1920,
          height: 1080,
          duration_seconds: 480,
          container: "mp4",
          video_codec: "h264",
          audio_codec: "aac",
        },
        checks: Object.fromEntries(
          [
            "video_decode",
            "audio_decode",
            "captions",
            "av_sync",
            "black_frames",
            "freeze_frames",
            "blur",
            "repetition",
          ].map((check) => [check, { pass: true }]),
        ),
      });
      return {
        path: filePath,
        sha256: sha256(fs.readFileSync(filePath)),
        network_used: false,
      };
    },
  });

  assert.equal(bundle.capabilities.ready, true);
  assert.deepEqual(bundle.capabilities.blockers, []);
  assert.deepEqual(Object.keys(bundle.adapters), [
    "narration",
    "alignment",
    "render",
    "variants",
    "decodedQa",
  ]);

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrder(root),
    outputDir: path.join(root, "output"),
    generatedAt: GENERATED_AT,
    adapters: bundle.adapters,
    async materializeDerivatives(input) {
      const outputDir = path.resolve(input.outputDir);
      fs.mkdirSync(outputDir, { recursive: true });
      const manifestPath = path.join(
        outputDir,
        "weekly-longform-derivative-manifest.json",
      );
      writeJson(manifestPath, {
        schema_version:
          "pulse-weekly-longform-derivative-manifest-v1",
        generated_at: input.generatedAt,
        run_id: input.workOrder.run_id,
        mode: "LOCAL_PROOF",
        status: "AWAITING_HUMAN_AV_REVIEW",
        clip_count: 1,
        clips: [{ clip_id: "fixture-short" }],
        controls: {
          external_publish_authorised: false,
          database_mutation_authorised: false,
          oauth_mutation_authorised: false,
          network_used: false,
        },
      });
      return {
        manifest_path: manifestPath,
        manifest_sha256: sha256(fs.readFileSync(manifestPath)),
        network_used: false,
        external_publish_authorised: false,
        database_mutation_authorised: false,
        oauth_mutation_authorised: false,
      };
    },
  });

  assert.equal(result.status, "HOLD");
  assert.equal(result.phase, "REVIEW_EVIDENCE_PENDING");
  assert.deepEqual(result.blockers, [
    "weekly_review_measured_originality_transformation_pending",
    "weekly_review_native_renderer_qa_pending",
    "weekly_review_renderer_manifest_pending",
  ]);
  assert.equal(result.adapter_execution.length, 6);
  assert.equal(result.network_used_by_runner, false);
  assert.equal(result.network_used_by_adapters, true);
  assert.equal(result.external_publish_authorised, false);
  assert.equal(result.database_mutation_authorised, false);
  assert.equal(result.oauth_mutation_authorised, false);
});
