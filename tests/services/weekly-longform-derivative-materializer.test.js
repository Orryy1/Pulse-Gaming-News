"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  materializeGovernedWeeklyLongformDerivatives,
} = require("../../lib/services/weekly-longform-derivative-materializer");
const {
  workOrderFingerprint,
} = require("../../lib/services/weekly-longform-work-order");
const {
  canonicalRightsLedger,
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

const RUN_ID = "weekly-derivative-2026-07-28";
const GENERATED_AT = "2026-07-28T19:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256(bytes),
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-derivatives-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const inputDir = path.join(root, "same-run");
  const outputDir = path.join(root, "derivatives");
  const binDir = path.join(root, "bin");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  const ffmpegPath = path.join(binDir, "ffmpeg.exe");
  const ffprobePath = path.join(binDir, "ffprobe.exe");
  fs.writeFileSync(ffmpegPath, "fixture-ffmpeg");
  fs.writeFileSync(ffprobePath, "fixture-ffprobe");

  const masterPath = path.join(inputDir, "master.mp4");
  fs.writeFileSync(masterPath, "completed-same-run-master");
  const masterSha256 = sha256(fs.readFileSync(masterPath));

  const words = Array.from({ length: 121 }, (_, index) => ({
    text: `word${index + 1}`,
    start_seconds: index,
    end_seconds: index + 0.8,
  }));
  const timestamps = writeJson(path.join(inputDir, "word-timestamps.json"), {
    schema_version: "pulse-longform-word-timestamps-binding-v1",
    generated_at: GENERATED_AT,
    run_id: RUN_ID,
    timing_basis: "provider_word_alignment",
    provider: "elevenlabs",
    source_alignment_sha256: "a".repeat(64),
    source_timestamps_sha256: "b".repeat(64),
    script_sha256: "c".repeat(64),
    audio_sha256: "d".repeat(64),
    exact_script_match: true,
    word_count: words.length,
    words,
  });
  const captionManifest = writeJson(
    path.join(inputDir, "caption-manifest.json"),
    {
      schema_version: "pulse-longform-caption-manifest-v1",
      generated_at: GENERATED_AT,
      run_id: RUN_ID,
      timing_basis: "provider_word_alignment",
      source: {
        path: timestamps.path,
        sha256: timestamps.sha256,
      },
      bindings: {
        script_sha256: "c".repeat(64),
        audio_sha256: "d".repeat(64),
        master_sha256: masterSha256,
        word_timestamps_sha256: timestamps.sha256,
      },
      outputs: {
        word_timestamps: {
          path: timestamps.path,
          sha256: timestamps.sha256,
          word_count: words.length,
        },
      },
      ready: true,
      blockers: [],
    },
  );

  const rawRights = {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-weekly-master",
        source_url: `pulse-owned://${RUN_ID}/master`,
        asset_sha256: masterSha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: `operator-evidence://${RUN_ID}/master`,
          sha256: "e".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  const canonicalRights = canonicalRightsLedger(rawRights);
  const canonicalRightsSha256 = hashRightsLedger(rawRights);
  const rightsLineage = writeJson(
    path.join(inputDir, "rights-lineage.json"),
    {
      schema_version: "pulse-longform-rights-lineage-v1",
      generated_at: GENERATED_AT,
      generator_identity: "pulse-longform-same-run-evidence-v1",
      run_id: RUN_ID,
      status: "CLEARED",
      ready: true,
      blockers: [],
      source: {
        path: path.join(inputDir, "source-rights.json"),
        sha256: "f".repeat(64),
      },
      bindings: {
        master_sha256: masterSha256,
        canonical_ledger_sha256: canonicalRightsSha256,
        declared_ledger_sha256: canonicalRightsSha256,
      },
      decision: canonicalRights,
    },
  );

  const manifestValue = {
    schema_version: "pulse-longform-same-run-manifest-v1",
    generated_at: GENERATED_AT,
    generator_identity: "pulse-longform-same-run-evidence-v1",
    run_id: RUN_ID,
    mode: "LOCAL_PROOF",
    sources: {
      script: {
        path: path.join(inputDir, "script.txt"),
        sha256: "c".repeat(64),
      },
      narration_audio: {
        path: path.join(inputDir, "narration.mp3"),
        sha256: "d".repeat(64),
      },
      master: {
        path: masterPath,
        sha256: masterSha256,
      },
    },
    package_bindings: {
      all_match: true,
    },
    controls: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
    evidence_outputs: {
      captions: {
        path: captionManifest.path,
        sha256: captionManifest.sha256,
        ready: true,
      },
      rights_lineage: {
        path: rightsLineage.path,
        sha256: rightsLineage.sha256,
        ready: true,
      },
    },
    machine_evidence_complete: true,
  };
  const manifest = writeJson(
    path.join(inputDir, "longform-run-manifest.json"),
    manifestValue,
  );
  const report = writeJson(
    path.join(inputDir, "longform-same-run-evidence-report.json"),
    {
      schema_version: "pulse-longform-same-run-evidence-report-v1",
      generated_at: GENERATED_AT,
      generator_identity: "pulse-longform-same-run-evidence-v1",
      run_id: RUN_ID,
      mode: "LOCAL_PROOF",
      status: "MACHINE_EVIDENCE_COMPLETE_AWAITING_HUMAN_REVIEW",
      blockers: ["human_review_pending"],
      same_run_core_bound: true,
      machine_evidence_complete: true,
      evidence: {
        manifest_sha256: manifest.sha256,
      },
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
  );

  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: GENERATED_AT,
    run_id: RUN_ID,
    mode: "LOCAL_PROOF",
    status: "HOLD",
    blockers: [
      "final_narration_evidence_required",
      "real_word_alignment_evidence_required",
      "final_master_evidence_required",
    ],
    selection: {
      selected: [
        {
          story_id: "story-xbox",
          rights_ledger: { sha256: "1".repeat(64) },
        },
      ],
    },
    script: {
      schema_version: "pulse-weekly-longform-script-v1",
      sha256: "c".repeat(64),
      estimated_duration_seconds: 480,
    },
    visual_beat_plan: {
      schema_version: "pulse-weekly-visual-beat-plan-v1",
      beats: [
        {
          beat_id: "xbox-beat-1",
          story_id: "story-xbox",
          estimated_start_seconds: 40,
          estimated_end_seconds: 160,
        },
        {
          beat_id: "xbox-beat-2",
          story_id: "story-xbox",
          estimated_start_seconds: 160,
          estimated_end_seconds: 280,
        },
      ],
    },
    derivative_plan: {
      schema_version: "pulse-weekly-derivative-plan-v1",
      status: "PLANNED_LOCAL_PROOF",
      item_count: 2,
      items: [
        {
          derivative_id: "story-xbox-vertical-short",
          story_id: "story-xbox",
          format: "vertical_short",
          hook: "Original Xbox games are coming back.",
          claim_ids: ["story-xbox-claim-1"],
          source_evidence_sha256: "2".repeat(64),
          rights_lineage_sha256: "1".repeat(64),
          status: "PLANNED_LOCAL_PROOF",
        },
        {
          derivative_id: "story-xbox-social-thread",
          story_id: "story-xbox",
          format: "social_thread",
          hook: "The full backwards compatibility breakdown.",
          claim_ids: ["story-xbox-claim-1"],
          source_evidence_sha256: "2".repeat(64),
          rights_lineage_sha256: "1".repeat(64),
          status: "PLANNED_LOCAL_PROOF",
        },
      ],
    },
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);

  const processCalls = [];
  const encodedDurations = new Map();
  async function processRunner(invocation) {
    processCalls.push(invocation);
    if (invocation.command === ffprobePath) {
      const mediaPath = invocation.args.at(-1);
      const duration = encodedDurations.get(mediaPath);
      return {
        status: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1080,
              height: 1920,
              duration: String(duration),
            },
            {
              codec_type: "audio",
              codec_name: "aac",
              duration: String(duration),
            },
          ],
          format: {
            format_name: "mov,mp4,m4a,3gp,3g2,mj2",
            duration: String(duration),
          },
        }),
        stderr: "",
      };
    }
    const outputPath = invocation.args.at(-1);
    if (outputPath !== "-") {
      const durationIndex = invocation.args.indexOf("-t");
      encodedDurations.set(
        outputPath,
        Number(invocation.args[durationIndex + 1]),
      );
      fs.writeFileSync(outputPath, "deterministic-encoded-derivative");
    }
    return { status: 0, stdout: "", stderr: "" };
  }

  return {
    root,
    outputDir,
    ffmpegPath,
    ffprobePath,
    processRunner,
    processCalls,
    workOrder,
    sameRunEvidence: {
      manifest,
      report,
      caption_manifest: captionManifest,
      rights_lineage: rightsLineage,
    },
    masterPath,
  };
}

test("materialises hash-bound vertical Shorts and platform teasers from the completed same-run master", async (t) => {
  const values = fixture(t);

  const result = await materializeGovernedWeeklyLongformDerivatives({
    workOrder: values.workOrder,
    sameRunEvidence: values.sameRunEvidence,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    ffmpegPath: values.ffmpegPath,
    ffprobePath: values.ffprobePath,
    processRunner: values.processRunner,
  });

  assert.equal(
    result.manifest.schema_version,
    "pulse-weekly-longform-derivative-manifest-v1",
  );
  assert.equal(result.manifest.status, "AWAITING_HUMAN_AV_REVIEW");
  assert.equal(result.manifest.clips.length, 2);
  assert.deepEqual(
    result.manifest.clips.map((clip) => clip.kind),
    ["platform_teaser", "vertical_short"],
  );
  for (const clip of result.manifest.clips) {
    assert.equal(clip.width, 1080);
    assert.equal(clip.height, 1920);
    assert.equal(clip.decode_evidence.full_decode_passed, true);
    assert.equal(clip.captions.timing_basis, "provider_word_alignment");
    assert.match(clip.media.sha256, /^[a-f0-9]{64}$/);
    assert.match(clip.metadata.sha256, /^[a-f0-9]{64}$/);
    assert.match(clip.rights_inheritance.sha256, /^[a-f0-9]{64}$/);
    assert.match(clip.decoded_probe.sha256, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(clip.media.path));
    assert.ok(fs.existsSync(clip.captions.path));
    assert.match(fs.readFileSync(clip.captions.path, "utf8"), /MarginV/);
    const inheritedRights = JSON.parse(
      fs.readFileSync(clip.rights_inheritance.path, "utf8"),
    );
    assert.equal(
      inheritedRights.policy,
      "NO_RIGHTS_EXPANSION_FROM_COMPLETED_PARENT_MASTER",
    );
    assert.equal(
      inheritedRights.parent.master_sha256,
      result.manifest.inputs.master.sha256,
    );
  }
  assert.equal(result.manifest.inputs.master.sha256, sha256(
    fs.readFileSync(values.masterPath),
  ));
  assert.equal(result.manifest.controls.external_publish_authorised, false);
  assert.equal(result.manifest.controls.database_mutation_authorised, false);
  assert.equal(result.manifest.controls.oauth_mutation_authorised, false);
  assert.equal(result.manifest.controls.network_used, false);
  assert.equal(result.external_publish_authorised, false);
  assert.equal(values.processCalls.length, 6);

  const transcodes = values.processCalls.filter(
    (call) =>
      call.command === values.ffmpegPath &&
      call.args.at(-1) !== "-",
  );
  assert.equal(transcodes.length, 2);
  for (const call of transcodes) {
    assert.equal(call.args[call.args.indexOf("-i") + 1], values.masterPath);
    assert.ok(call.args.includes("-ss"));
    assert.ok(call.args.includes("-t"));
    assert.match(
      call.args[call.args.indexOf("-filter_complex") + 1],
      /subtitles=/,
    );
  }
  const teaser = result.manifest.clips.find(
    (clip) => clip.kind === "platform_teaser",
  );
  const vertical = result.manifest.clips.find(
    (clip) => clip.kind === "vertical_short",
  );
  assert.deepEqual(teaser.exact_time_bounds, {
    start_seconds: 10,
    end_seconds: 29.8,
    duration_seconds: 19.8,
  });
  assert.deepEqual(vertical.exact_time_bounds, {
    start_seconds: 10,
    end_seconds: 64.8,
    duration_seconds: 54.8,
  });
  assert.deepEqual(
    transcodes.map((call) => ({
      start: Number(call.args[call.args.indexOf("-ss") + 1]),
      duration: Number(call.args[call.args.indexOf("-t") + 1]),
    })),
    [
      { start: 10, duration: 19.8 },
      { start: 10, duration: 54.8 },
    ],
  );
});

test("fails before invoking FFmpeg when the completed same-run master bytes are tampered", async (t) => {
  const values = fixture(t);
  fs.appendFileSync(values.masterPath, "tampered");

  await assert.rejects(
    materializeGovernedWeeklyLongformDerivatives({
      workOrder: values.workOrder,
      sameRunEvidence: values.sameRunEvidence,
      outputDir: values.outputDir,
      generatedAt: GENERATED_AT,
      ffmpegPath: values.ffmpegPath,
      ffprobePath: values.ffprobePath,
      processRunner: values.processRunner,
    }),
    (error) =>
      error.name ===
        "WeeklyLongformDerivativeMaterializationError" &&
      error.codes.includes("derivative_same_run_master_sha256_mismatch"),
  );
  assert.equal(values.processCalls.length, 0);
});

test("rejects any work-order publish authority before materialising derivatives", async (t) => {
  const values = fixture(t);
  values.workOrder.safety.external_publish_authorised = true;
  values.workOrder.work_order_sha256 = workOrderFingerprint(
    values.workOrder,
  );

  await assert.rejects(
    materializeGovernedWeeklyLongformDerivatives({
      workOrder: values.workOrder,
      sameRunEvidence: values.sameRunEvidence,
      outputDir: values.outputDir,
      generatedAt: GENERATED_AT,
      ffmpegPath: values.ffmpegPath,
      ffprobePath: values.ffprobePath,
      processRunner: values.processRunner,
    }),
    (error) =>
      error.codes.includes("derivative_publish_authority_forbidden"),
  );
  assert.equal(values.processCalls.length, 0);
});

test("requires an injected process runner and explicit FFmpeg and FFprobe binaries", async (t) => {
  const values = fixture(t);

  await assert.rejects(
    materializeGovernedWeeklyLongformDerivatives({
      workOrder: values.workOrder,
      sameRunEvidence: values.sameRunEvidence,
      outputDir: values.outputDir,
      generatedAt: GENERATED_AT,
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
    }),
    (error) =>
      error.codes.includes(
        "derivative_explicit_ffmpeg_path_required",
      ) &&
      error.codes.includes(
        "derivative_explicit_ffprobe_path_required",
      ) &&
      error.codes.includes(
        "derivative_injected_process_runner_required",
      ),
  );
  assert.equal(values.processCalls.length, 0);
});

test("fails closed when the inherited same-run rights evidence changes", async (t) => {
  const values = fixture(t);
  fs.appendFileSync(
    values.sameRunEvidence.rights_lineage.path,
    "tampered",
  );

  await assert.rejects(
    materializeGovernedWeeklyLongformDerivatives({
      workOrder: values.workOrder,
      sameRunEvidence: values.sameRunEvidence,
      outputDir: values.outputDir,
      generatedAt: GENERATED_AT,
      ffmpegPath: values.ffmpegPath,
      ffprobePath: values.ffprobePath,
      processRunner: values.processRunner,
    }),
    (error) =>
      error.codes.includes(
        "derivative_rights_lineage_sha256_mismatch",
      ),
  );
  assert.equal(values.processCalls.length, 0);
});

test("rejects a derivative whose decoded probe does not prove 9:16 output geometry", async (t) => {
  const values = fixture(t);
  const processRunner = async (invocation) => {
    if (invocation.command !== values.ffprobePath) {
      return values.processRunner(invocation);
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
            duration: "19.8",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            duration: "19.8",
          },
        ],
        format: {
          format_name: "mp4",
          duration: "19.8",
        },
      }),
      stderr: "",
    };
  };

  await assert.rejects(
    materializeGovernedWeeklyLongformDerivatives({
      workOrder: values.workOrder,
      sameRunEvidence: values.sameRunEvidence,
      outputDir: values.outputDir,
      generatedAt: GENERATED_AT,
      ffmpegPath: values.ffmpegPath,
      ffprobePath: values.ffprobePath,
      processRunner,
    }),
    (error) =>
      error.codes.includes("derivative_decoded_geometry_invalid"),
  );
  assert.equal(
    fs.existsSync(
      path.join(
        values.outputDir,
        "weekly-longform-derivative-manifest.json",
      ),
    ),
    false,
  );
});

test("writes byte-identical manifests for the same immutable inputs and generated-at value", async (t) => {
  const values = fixture(t);
  const input = {
    workOrder: values.workOrder,
    sameRunEvidence: values.sameRunEvidence,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    ffmpegPath: values.ffmpegPath,
    ffprobePath: values.ffprobePath,
    processRunner: values.processRunner,
  };

  const first = await materializeGovernedWeeklyLongformDerivatives(
    input,
  );
  const firstBytes = fs.readFileSync(first.manifest_path);
  fs.rmSync(values.outputDir, { recursive: true, force: true });
  const second = await materializeGovernedWeeklyLongformDerivatives(
    input,
  );
  const secondBytes = fs.readFileSync(second.manifest_path);

  assert.deepEqual(secondBytes, firstBytes);
  assert.equal(second.manifest_sha256, first.manifest_sha256);
  assert.equal(
    second.materialization_plan_sha256,
    first.materialization_plan_sha256,
  );
});
