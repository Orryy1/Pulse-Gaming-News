"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  runGovernedWeeklyLongformProduction,
} = require("../../lib/services/weekly-longform-production-runner");
const {
  workOrderFingerprint,
} = require("../../lib/services/weekly-longform-work-order");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  materializeGovernedLaneReviewPacket,
} = require("../../lib/services/governed-lane-review-packet");

const RUN_ID = "weekly-flagship-2026-07-28";
const GENERATED_AT = "2026-07-28T14:00:00.000Z";

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-production-runner-"),
  );
  return {
    root,
    outputDir: path.join(root, "output"),
  };
}

function holdWorkOrder() {
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: GENERATED_AT,
    generator_identity: "pulse-weekly-longform-work-order-v1",
    run_id: RUN_ID,
    mode: "LOCAL_PROOF",
    status: "HOLD",
    blockers: ["minimum_verified_weekly_story_set_not_met"],
    selection: {
      minimum_story_count: 4,
      maximum_story_count: 6,
      selected: [],
    },
    dossier: null,
    script: null,
    visual_beat_plan: null,
    derivative_plan: null,
    safety: {
      external_publish_authorised: false,
    },
  };
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);
  return workOrder;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readyWorkOrder() {
  const fullScript = Array.from(
    { length: 1_200 },
    (_, index) => `verified-${index + 1}`,
  ).join(" ");
  const selected = [1, 2, 3, 4].map((index) => ({
    story_id: `weekly-story-${index}`,
    title: `Verified weekly story ${index}`,
    source_evidence: {
      sha256: String(index).repeat(64),
    },
    rights_ledger: {
      sha256: String(index + 4).repeat(64),
    },
    visual_asset_admission: {
      schema_version: "pulse-weekly-longform-visual-admission-v1",
      status: "READY",
      blockers: [],
      admitted_asset_ids: [
        `weekly-story-${index}-gameplay`,
        `weekly-story-${index}-key-art`,
        `weekly-story-${index}-screenshot`,
      ],
      landscape_exact_subject_asset_count: 3,
      landscape_exact_subject_motion_count: 1,
    },
  }));
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
      story_count: 4,
      stories: selected,
    },
    script: {
      schema_version: "pulse-weekly-longform-script-v1",
      full_script: fullScript,
      sha256: sha256(fullScript),
      word_count: 1_200,
      estimated_duration_seconds: 480,
      target_minimum_seconds: 480,
      target_maximum_seconds: 720,
    },
    visual_beat_plan: {
      schema_version: "pulse-weekly-visual-beat-plan-v1",
      beat_count: 12,
      beats: selected.flatMap((story) =>
        story.visual_asset_admission.admitted_asset_ids.map(
          (assetItemId, index) => ({
            beat_id: `${story.story_id}-beat-${index + 1}`,
            story_id: story.story_id,
            asset_item_id: assetItemId,
            rights_bound: true,
            claims_bound: true,
          }),
        ),
      ),
    },
    derivative_plan: {
      schema_version: "pulse-weekly-derivative-plan-v1",
      item_count: 8,
      items: Array.from({ length: 8 }, (_, index) => ({
        derivative_id: `derivative-${index + 1}`,
      })),
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return sha256(fs.readFileSync(filePath));
}

function measuredMetric(
  metricId,
  value,
  unit,
  operator,
  threshold,
) {
  return {
    metric_id: metricId,
    value,
    unit,
    threshold: {
      operator,
      value: threshold,
    },
    pass: true,
    measurement_source: "independent-local-proof-analyser",
  };
}

function readyWorkOrderWithSourceEvidence(root) {
  const workOrder = readyWorkOrder();
  for (const story of workOrder.selection.selected) {
    const sourcePath = path.join(
      root,
      `${story.story_id}-source-evidence.json`,
    );
    const sourceValue = {
      schema_version: "pulse-source-evidence-v1",
      story_id: story.story_id,
      verification_status: "CONFIRMED",
      source_type: "official",
      source_url:
        `https://example.com/official/${story.story_id}`,
      claims: [
        {
          claim_id: `${story.story_id}-claim-1`,
          story_id: story.story_id,
          text: `Verified source claim for ${story.story_id}`,
        },
      ],
    };
    story.source_evidence = {
      path: sourcePath,
      sha256: writeJson(sourcePath, sourceValue),
    };
  }
  workOrder.dossier.stories = workOrder.selection.selected;
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);
  return workOrder;
}

function localProofAdapters(
  calls,
  { independentReviewEvidence = false } = {},
) {
  return {
    narration: {
      async materialize(context) {
        calls.push("narration");
        const audioPath = path.join(context.outputDir, "narration.wav");
        fs.writeFileSync(
          audioPath,
          Buffer.from("fixture-narration-materialised-by-adapter"),
        );
        return {
          path: audioPath,
          sha256: sha256(fs.readFileSync(audioPath)),
          provider: "local-test-adapter",
          network_used: false,
        };
      },
    },
    alignment: {
      async materialize(context) {
        calls.push("alignment");
        const timestampsPath = path.join(
          context.outputDir,
          "word-timestamps.json",
        );
        const words = context.script.text
          .split(/\s+/)
          .filter(Boolean)
          .map((word, index) => ({
            text: word,
            start_seconds: Number((index * 0.4).toFixed(3)),
            end_seconds: Number(((index + 1) * 0.4).toFixed(3)),
          }));
        writeJson(timestampsPath, {
          schema_version: "pulse-word-timestamps-v1",
          run_id: context.runId,
          generated_at: context.generatedAt,
          script_sha256: context.script.sha256,
          audio_sha256: context.narration.sha256,
          source_alignment_sha256: "a".repeat(64),
          provider: "elevenlabs",
          word_count: words.length,
          words,
        });
        return {
          path: timestampsPath,
          sha256: sha256(fs.readFileSync(timestampsPath)),
          provider: "elevenlabs",
          network_used: false,
        };
      },
    },
    render: {
      async materialize(context) {
        calls.push("render");
        const masterPath = path.join(context.outputDir, "master.mp4");
        fs.writeFileSync(
          masterPath,
          Buffer.from("fixture-master-materialised-by-render-adapter"),
        );
        const masterSha256 = sha256(fs.readFileSync(masterPath));
        const rightsPath = path.join(context.outputDir, "rights.json");
        const rights = {
          schema_version: "pulse-longform-rights-ledger-v1",
          run_id: context.runId,
          master_sha256: masterSha256,
          ledger_version: 1,
          decision: "CLEARED",
          items: [
            {
              item_id: "weekly-runner-owned-master",
              source_url: `pulse-owned://${context.runId}/master`,
              asset_sha256: masterSha256,
              included_in_final: true,
              rights_decision: "CLEARED",
              rights_basis: "OWNED",
              rights_evidence: {
                reference:
                  `operator-evidence://${context.runId}/local-render`,
                sha256: "b".repeat(64),
              },
              attribution_decision: "NOT_REQUIRED",
              attribution_text: null,
            },
          ],
        };
        rights.ledger_sha256 = hashRightsLedger(rights);
        writeJson(rightsPath, rights);
        let rendererManifest = null;
        let originalityTransformation = null;
        if (independentReviewEvidence) {
          const rendererPath = path.join(
            context.outputDir,
            "native-renderer-manifest.json",
          );
          const rendererValue = {
            schema_version:
              "pulse-weekly-longform-native-renderer-manifest-v1",
            generated_at: context.generatedAt,
            generator_identity:
              "independent-weekly-render-adapter-test-v1",
            story_id: context.runId,
            run_id: context.runId,
            lane_id: "weekly_longform",
            status: "READY_FOR_QA",
            blockers: [],
            renderer: {
              identity: "hyperframes-independent-local-test",
            },
            bindings: {
              production_work_order_sha256:
                context.workOrder.work_order_sha256,
              final_media_sha256: masterSha256,
            },
            output: {
              path: masterPath,
              sha256: masterSha256,
            },
          };
          rendererManifest = {
            path: rendererPath,
            sha256: writeJson(rendererPath, rendererValue),
          };
          const originalityPath = path.join(
            context.outputDir,
            "measured-originality-transformation.json",
          );
          const originalityValue = {
            schema_version:
              "pulse-weekly-longform-originality-transformation-measurement-v1",
            generated_at: context.generatedAt,
            generator_identity:
              "independent-weekly-originality-analyser-test-v1",
            story_id: context.runId,
            run_id: context.runId,
            lane_id: "weekly_longform",
            verdict: "ADEQUATE",
            rationale:
              "Independent measurements confirm original narration, designed visual composition and multiple editorial interventions in this exact master.",
            bindings: {
              production_work_order_sha256:
                context.workOrder.work_order_sha256,
              final_media_sha256: masterSha256,
              renderer_manifest_sha256:
                rendererManifest.sha256,
            },
            measurement: {
              method: "frame-audio-lineage-analysis-v1",
              evaluator_identity:
                "independent-weekly-originality-analyser-test-v1",
              measured_at: context.generatedAt,
              metrics: [
                measuredMetric(
                  "original_narration_ratio",
                  1,
                  "ratio",
                  ">=",
                  0.9,
                ),
                measuredMetric(
                  "original_visual_design_ratio",
                  0.72,
                  "ratio",
                  ">=",
                  0.5,
                ),
                measuredMetric(
                  "third_party_excerpt_ratio",
                  0.28,
                  "ratio",
                  "<=",
                  0.5,
                ),
                measuredMetric(
                  "editorial_intervention_count",
                  24,
                  "count",
                  ">=",
                  12,
                ),
              ],
            },
          };
          originalityTransformation = {
            path: originalityPath,
            sha256: writeJson(
              originalityPath,
              originalityValue,
            ),
          };
        }
        return {
          master: {
            path: masterPath,
            sha256: masterSha256,
          },
          rights: {
            path: rightsPath,
            sha256: sha256(fs.readFileSync(rightsPath)),
          },
          renderer: "hyperframes-local-test",
          renderer_manifest: rendererManifest,
          originality_transformation:
            originalityTransformation,
          network_used: false,
        };
      },
    },
    variants: {
      async materialize(context) {
        calls.push("variants");
        const variantsPath = path.join(
          context.outputDir,
          "platform-variants.json",
        );
        writeJson(variantsPath, {
          schema_version: "pulse-longform-platform-variants-v1",
          run_id: context.runId,
          master_sha256: context.master.sha256,
          variants: [
            {
              id: "youtube-landscape-master",
              platform: "YOUTUBE_LONGFORM",
              path: context.master.path,
              sha256: context.master.sha256,
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
          path: variantsPath,
          sha256: sha256(fs.readFileSync(variantsPath)),
          network_used: false,
        };
      },
    },
    decodedQa: {
      async materialize(context) {
        calls.push("decodedQa");
        const qaPath = path.join(context.outputDir, "decoded-qa.json");
        writeJson(qaPath, {
          schema_version: "pulse-decoded-qa-v1",
          run_id: context.runId,
          master_sha256: context.master.sha256,
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
        let nativeRendererQa = null;
        if (
          independentReviewEvidence &&
          context.renderer_manifest
        ) {
          const nativeQaPath = path.join(
            context.outputDir,
            "native-renderer-qa.json",
          );
          const nativeQaValue = {
            schema_version:
              "pulse-weekly-longform-native-renderer-qa-v1",
            generated_at: context.generatedAt,
            generator_identity:
              "independent-weekly-renderer-qa-test-v1",
            story_id: context.runId,
            run_id: context.runId,
            lane_id: "weekly_longform",
            status: "PASS",
            verdict: "PASS",
            complete: true,
            blockers: [],
            media_sha256: context.master.sha256,
            renderer_manifest_sha256:
              context.renderer_manifest.sha256,
            bindings: {
              production_work_order_sha256:
                context.workOrder.work_order_sha256,
              final_media_sha256: context.master.sha256,
              renderer_manifest_sha256:
                context.renderer_manifest.sha256,
            },
            visual_quality_gate: {
              verdict: "GREEN",
              strict_gate_applied: true,
              measurements: [
                measuredMetric(
                  "black_frame_ratio",
                  0,
                  "ratio",
                  "<=",
                  0.01,
                ),
                measuredMetric(
                  "freeze_frame_ratio",
                  0.01,
                  "ratio",
                  "<=",
                  0.05,
                ),
                measuredMetric(
                  "blur_frame_ratio",
                  0.02,
                  "ratio",
                  "<=",
                  0.08,
                ),
                measuredMetric(
                  "repeated_frame_ratio",
                  0.03,
                  "ratio",
                  "<=",
                  0.1,
                ),
                measuredMetric(
                  "safe_zone_compliance_ratio",
                  1,
                  "ratio",
                  ">=",
                  1,
                ),
              ],
            },
          };
          nativeRendererQa = {
            path: nativeQaPath,
            sha256: writeJson(nativeQaPath, nativeQaValue),
          };
        }
        return {
          path: qaPath,
          sha256: sha256(fs.readFileSync(qaPath)),
          native_renderer_qa: nativeRendererQa,
          network_used: false,
        };
      },
    },
  };
}

function localProofDerivativeMaterializer(calls) {
  return async function materializeDerivatives(input) {
    calls.push("derivatives");
    fs.mkdirSync(input.outputDir, { recursive: true });
    const manifestPath = path.join(
      input.outputDir,
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
      clips: [
        {
          clip_id: "fixture-vertical-short",
          status: "AWAITING_HUMAN_AV_REVIEW",
        },
      ],
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
  };
}

test("a HOLD weekly work order emits a machine-readable blocked result without invoking any adapter", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const forbiddenAdapter = {
    materialize: async () => {
      calls.push("called");
      throw new Error("adapter_must_not_run");
    },
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: holdWorkOrder(),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: {
      narration: forbiddenAdapter,
      alignment: forbiddenAdapter,
      render: forbiddenAdapter,
      variants: forbiddenAdapter,
      decodedQa: forbiddenAdapter,
    },
  });

  assert.equal(
    result.schema_version,
    "pulse-weekly-longform-production-result-v1",
  );
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "ADMISSION");
  assert.ok(result.blockers.includes("weekly_work_order_hold"));
  assert.deepEqual(calls, []);
  assert.ok(fs.existsSync(result.result_path));
  assert.equal(
    JSON.parse(fs.readFileSync(result.result_path, "utf8")).status,
    "BLOCKED",
  );
  assert.equal(result.external_publish_authorised, false);
  assert.equal(result.database_mutation_authorised, false);
  assert.equal(result.oauth_mutation_authorised, false);
});

test("a stale READY work order without exact visual admission is blocked before any adapter runs", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const workOrder = readyWorkOrder();
  delete workOrder.selection.selected[0].visual_asset_admission;
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);
  const calls = [];

  const result = await runGovernedWeeklyLongformProduction({
    workOrder,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: localProofAdapters(calls),
    materializeDerivatives: async () => {
      calls.push("derivatives");
      throw new Error("must not run");
    },
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "ADMISSION");
  assert.ok(
    result.blockers.includes(
      "weekly_work_order_visual_admission_required",
    ),
  );
  assert.deepEqual(calls, []);
});

test("a READY work order fails closed at adapter preflight when any required production adapter is absent", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrder(),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: {},
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "ADAPTER_PREFLIGHT");
  assert.deepEqual(result.blockers, [
    "narration_adapter_required",
    "alignment_adapter_required",
    "render_adapter_required",
    "variants_adapter_required",
    "decoded_qa_adapter_required",
    "derivative_materializer_required",
  ]);
  assert.deepEqual(result.adapter_execution, []);
  assert.deepEqual(result.artifacts, {});
});

test("runs the injected local adapters in order, writes one exact production package and invokes the same-run binder", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const workOrder = readyWorkOrderWithSourceEvidence(values.root);

  const result = await runGovernedWeeklyLongformProduction({
    workOrder,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: localProofAdapters(calls),
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.deepEqual(calls, [
    "narration",
    "alignment",
    "render",
    "variants",
    "decodedQa",
    "derivatives",
  ]);
  assert.equal(result.status, "HOLD");
  assert.equal(result.phase, "REVIEW_EVIDENCE_PENDING");
  assert.deepEqual(result.blockers, [
    "weekly_review_measured_originality_transformation_pending",
    "weekly_review_native_renderer_qa_pending",
    "weekly_review_renderer_manifest_pending",
  ]);
  assert.equal(result.adapter_execution.length, 6);
  assert.ok(
    result.adapter_execution.every(
      (entry) =>
        entry.status === "MATERIALISED" &&
        entry.network_used === false,
    ),
  );
  assert.ok(fs.existsSync(result.artifacts.production_package.path));
  const productionPackage = JSON.parse(
    fs.readFileSync(result.artifacts.production_package.path, "utf8"),
  );
  assert.equal(productionPackage.run_id, RUN_ID);
  assert.equal(
    productionPackage.work_order_sha256,
    workOrder.work_order_sha256,
  );
  assert.equal(
    productionPackage.assets.script.sha256,
    workOrder.script.sha256,
  );
  assert.equal(
    productionPackage.evidence_inputs.word_alignment.sha256,
    result.artifacts.word_alignment.sha256,
  );
  assert.equal(
    productionPackage.evidence_inputs.rights_lineage.sha256,
    result.artifacts.rights_lineage_input.sha256,
  );
  assert.equal(
    productionPackage.evidence_inputs.platform_variants.sha256,
    result.artifacts.platform_variants_input.sha256,
  );
  assert.equal(
    productionPackage.evidence_inputs.decoded_qa.sha256,
    result.artifacts.decoded_qa_input.sha256,
  );
  assert.ok(fs.existsSync(result.artifacts.same_run_manifest.path));
  assert.ok(fs.existsSync(result.artifacts.same_run_report.path));
  assert.ok(
    fs.existsSync(result.artifacts.derivatives_manifest.path),
  );
  const evidenceReport = JSON.parse(
    fs.readFileSync(result.artifacts.same_run_report.path, "utf8"),
  );
  assert.equal(evidenceReport.machine_evidence_complete, true);
  assert.equal(result.external_publish_authorised, false);
  assert.equal(result.database_mutation_authorised, false);
  assert.equal(result.oauth_mutation_authorised, false);
  assert.equal(result.network_used_by_runner, false);
});

test("a local production run cannot manufacture renderer, QA or originality evidence and remains on HOLD", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const workOrder = readyWorkOrderWithSourceEvidence(values.root);

  const result = await runGovernedWeeklyLongformProduction({
    workOrder,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: localProofAdapters(calls),
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "HOLD");
  const evidence = result.review_evidence;
  assert.deepEqual(
    Object.keys(evidence).sort(),
    [
      "final_media_ref",
      "originality_transformation_ref",
      "production_work_order_ref",
      "qa_ref",
      "renderer_manifest_ref",
      "rights_ledger_ref",
      "source_evidence_ref",
      "synthetic_disclosure_proposal_ref",
    ],
  );
  for (const ref of Object.values(evidence).filter(Boolean)) {
    assert.equal(ref.story_id, RUN_ID);
    assert.equal(ref.lane_id, "weekly_longform");
    assert.match(ref.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(fs.readFileSync(ref.path)), ref.sha256);
  }

  assert.equal(evidence.renderer_manifest_ref, null);
  assert.equal(evidence.qa_ref, null);
  assert.equal(evidence.originality_transformation_ref, null);
  const bridgeManifest = JSON.parse(
    fs.readFileSync(
      result.artifacts.review_evidence_manifest.path,
      "utf8",
    ),
  );
  assert.equal(bridgeManifest.status, "HOLD");
  assert.deepEqual(bridgeManifest.blockers, result.blockers);
  const bridgeOutput = path.dirname(
    result.artifacts.review_evidence_manifest.path,
  );
  assert.equal(
    fs.existsSync(path.join(bridgeOutput, "renderer-manifest.json")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(bridgeOutput, "governed-review-qa.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(bridgeOutput, "originality-transformation.json"),
    ),
    false,
  );

  const review = await materializeGovernedLaneReviewPacket({
    lane_id: "weekly_longform",
    story_id: RUN_ID,
    generated_at: GENERATED_AT,
    output_dir: path.join(values.root, "governed-review"),
    ...evidence,
  });
  assert.equal(review.packet.verdict, "HOLD");
  assert.ok(review.packet.blockers.includes("renderer_manifest_path_required"));
  assert.ok(review.packet.blockers.includes("qa_path_required"));
  assert.ok(
    review.packet.blockers.includes(
      "originality_transformation_path_required",
    ),
  );
});

test("independent native renderer QA and measured originality evidence can satisfy the review bridge only when all exact hashes match", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const workOrder = readyWorkOrderWithSourceEvidence(values.root);

  const result = await runGovernedWeeklyLongformProduction({
    workOrder,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: localProofAdapters(calls, {
      independentReviewEvidence: true,
    }),
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "AWAITING_HUMAN_AV_REVIEW");
  assert.equal(result.phase, "DERIVATIVES_BOUND");
  assert.deepEqual(result.blockers, ["human_av_review_pending"]);
  const evidence = result.review_evidence;
  assert.ok(evidence.renderer_manifest_ref);
  assert.ok(evidence.qa_ref);
  assert.ok(evidence.originality_transformation_ref);
  for (const ref of [
    evidence.renderer_manifest_ref,
    evidence.qa_ref,
    evidence.originality_transformation_ref,
  ]) {
    assert.equal(sha256(fs.readFileSync(ref.path)), ref.sha256);
  }
  const bridgeManifest = JSON.parse(
    fs.readFileSync(
      result.artifacts.review_evidence_manifest.path,
      "utf8",
    ),
  );
  assert.equal(bridgeManifest.status, "READY_FOR_HUMAN_AV_REVIEW");
  assert.deepEqual(bridgeManifest.blockers, []);
  const review = await materializeGovernedLaneReviewPacket({
    lane_id: "weekly_longform",
    story_id: RUN_ID,
    generated_at: GENERATED_AT,
    output_dir: path.join(values.root, "independent-governed-review"),
    ...evidence,
  });
  assert.equal(review.packet.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(review.packet.blockers, []);
});

test("measured originality evidence with a mismatched master binding is rejected instead of being relabelled", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeRender = adapters.render.materialize;
  adapters.render.materialize = async (context) => {
    const output = await materializeRender(context);
    const originality = JSON.parse(
      fs.readFileSync(
        output.originality_transformation.path,
        "utf8",
      ),
    );
    originality.bindings.final_media_sha256 = "f".repeat(64);
    output.originality_transformation.sha256 = writeJson(
      output.originality_transformation.path,
      originality,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_originality_final_media_sha256_mismatch",
    ),
  );
  assert.equal(result.review_evidence, undefined);
});

test("native renderer QA cannot claim strict GREEN when its measured value fails the declared threshold", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    nativeQa.visual_quality_gate.measurements.find(
      (metric) => metric.metric_id === "black_frame_ratio",
    ).value = 0.5;
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_black_frame_ratio_measurement_invalid",
    ),
  );
});

test("native renderer QA cannot coerce missing numeric measurements into a strict GREEN pass", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    const safeZoneMetric =
      nativeQa.visual_quality_gate.measurements.find(
        (metric) =>
          metric.metric_id === "safe_zone_compliance_ratio",
      );
    safeZoneMetric.value = null;
    safeZoneMetric.threshold.value = null;
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_safe_zone_compliance_ratio_measurement_invalid",
    ),
  );
});

test("case-variant review bridge generator identity cannot self-attest renderer evidence", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeRender = adapters.render.materialize;
  adapters.render.materialize = async (context) => {
    const output = await materializeRender(context);
    const rendererManifest = JSON.parse(
      fs.readFileSync(output.renderer_manifest.path, "utf8"),
    );
    rendererManifest.generator_identity =
      "PULSE-WEEKLY-LONGFORM-REVIEW-EVIDENCE-BRIDGE-V1";
    output.renderer_manifest.sha256 = writeJson(
      output.renderer_manifest.path,
      rendererManifest,
    );
    const originality = JSON.parse(
      fs.readFileSync(
        output.originality_transformation.path,
        "utf8",
      ),
    );
    originality.bindings.renderer_manifest_sha256 =
      output.renderer_manifest.sha256;
    output.originality_transformation.sha256 = writeJson(
      output.originality_transformation.path,
      originality,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_renderer_manifest_independent_generator_required",
    ),
  );
});

test("case-variant review bridge measurement source cannot self-attest strict renderer QA", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    nativeQa.visual_quality_gate.measurements[0].measurement_source =
      "PULSE-WEEKLY-LONGFORM-REVIEW-EVIDENCE-BRIDGE-V1";
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_black_frame_ratio_measurement_invalid",
    ),
  );
});

test("native renderer QA with conflicting story and run identities is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    nativeQa.run_id = "different-weekly-review-run";
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_identity_mismatch",
    ),
  );
});

test("native renderer QA with conflicting verdict and status is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    nativeQa.verdict = "PASS";
    nativeQa.status = "HOLD";
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_not_strict_green",
    ),
  );
});

test("renderer manifest with conflicting verdict and status is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeRender = adapters.render.materialize;
  adapters.render.materialize = async (context) => {
    const output = await materializeRender(context);
    const rendererManifest = JSON.parse(
      fs.readFileSync(output.renderer_manifest.path, "utf8"),
    );
    rendererManifest.verdict = "PASS";
    rendererManifest.status = "HOLD";
    output.renderer_manifest.sha256 = writeJson(
      output.renderer_manifest.path,
      rendererManifest,
    );
    const originality = JSON.parse(
      fs.readFileSync(
        output.originality_transformation.path,
        "utf8",
      ),
    );
    originality.bindings.renderer_manifest_sha256 =
      output.renderer_manifest.sha256;
    output.originality_transformation.sha256 = writeJson(
      output.originality_transformation.path,
      originality,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_renderer_manifest_not_ready",
    ),
  );
});

test("native renderer QA with non-array blockers is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    nativeQa.blockers = "critical-visual-defect";
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_not_strict_green",
    ),
  );
});

test("renderer manifest with non-array blockers is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeRender = adapters.render.materialize;
  adapters.render.materialize = async (context) => {
    const output = await materializeRender(context);
    const rendererManifest = JSON.parse(
      fs.readFileSync(output.renderer_manifest.path, "utf8"),
    );
    rendererManifest.blockers = "critical-render-defect";
    output.renderer_manifest.sha256 = writeJson(
      output.renderer_manifest.path,
      rendererManifest,
    );
    const originality = JSON.parse(
      fs.readFileSync(
        output.originality_transformation.path,
        "utf8",
      ),
    );
    originality.bindings.renderer_manifest_sha256 =
      output.renderer_manifest.sha256;
    output.originality_transformation.sha256 = writeJson(
      output.originality_transformation.path,
      originality,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_renderer_manifest_not_ready",
    ),
  );
});

test("native renderer QA with a non-empty blockers array is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeQa = adapters.decodedQa.materialize;
  adapters.decodedQa.materialize = async (context) => {
    const output = await materializeQa(context);
    const nativeQa = JSON.parse(
      fs.readFileSync(output.native_renderer_qa.path, "utf8"),
    );
    nativeQa.blockers = ["critical-visual-defect"];
    output.native_renderer_qa.sha256 = writeJson(
      output.native_renderer_qa.path,
      nativeQa,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_native_renderer_qa_not_strict_green",
    ),
  );
});

test("renderer manifest with a non-empty blockers array is rejected", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls, {
    independentReviewEvidence: true,
  });
  const materializeRender = adapters.render.materialize;
  adapters.render.materialize = async (context) => {
    const output = await materializeRender(context);
    const rendererManifest = JSON.parse(
      fs.readFileSync(output.renderer_manifest.path, "utf8"),
    );
    rendererManifest.blockers = ["critical-render-defect"];
    output.renderer_manifest.sha256 = writeJson(
      output.renderer_manifest.path,
      rendererManifest,
    );
    const originality = JSON.parse(
      fs.readFileSync(
        output.originality_transformation.path,
        "utf8",
      ),
    );
    originality.bindings.renderer_manifest_sha256 =
      output.renderer_manifest.sha256;
    output.originality_transformation.sha256 = writeJson(
      output.originality_transformation.path,
      originality,
    );
    return output;
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrderWithSourceEvidence(values.root),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_renderer_manifest_not_ready",
    ),
  );
});

test("the review bridge fails closed when a selected story evidence file drifts before post-production binding", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const workOrder = readyWorkOrderWithSourceEvidence(values.root);
  fs.appendFileSync(
    workOrder.selection.selected[0].source_evidence.path,
    "\ntampered-after-work-order",
  );

  const result = await runGovernedWeeklyLongformProduction({
    workOrder,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters: localProofAdapters(calls),
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "REVIEW_EVIDENCE");
  assert.ok(
    result.blockers.includes(
      "weekly_review_source_evidence_1_sha256_mismatch",
    ),
  );
  assert.equal(result.review_evidence, undefined);
  assert.equal(
    result.artifacts.review_evidence_manifest,
    undefined,
  );
  assert.deepEqual(calls, [
    "narration",
    "alignment",
    "render",
    "variants",
    "decodedQa",
    "derivatives",
  ]);
});

test("stops before rendering or package creation when an adapter returns a missing artifact instead of evidence", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const calls = [];
  const adapters = localProofAdapters(calls);
  adapters.alignment = {
    async materialize(context) {
      calls.push("alignment");
      return {
        path: path.join(context.outputDir, "missing-timestamps.json"),
        sha256: "f".repeat(64),
        network_used: false,
      };
    },
  };

  const result = await runGovernedWeeklyLongformProduction({
    workOrder: readyWorkOrder(),
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    adapters,
    materializeDerivatives:
      localProofDerivativeMaterializer(calls),
  });

  assert.deepEqual(calls, ["narration", "alignment"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.phase, "ALIGNMENT");
  assert.ok(result.blockers.includes("word_alignment_file_missing"));
  assert.equal(
    result.adapter_execution.at(-1).status,
    "INVALID_ARTIFACT",
  );
  assert.equal(result.artifacts.production_package, undefined);
  assert.equal(result.artifacts.same_run_manifest, undefined);
  assert.ok(fs.existsSync(result.result_path));
});
