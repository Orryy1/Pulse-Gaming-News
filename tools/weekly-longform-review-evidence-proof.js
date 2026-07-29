#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  materializeGovernedLaneReviewPacket,
} = require("../lib/services/governed-lane-review-packet");
const {
  materializeWeeklyLongformReviewEvidence,
} = require("../lib/services/weekly-longform-review-evidence");
const {
  hashRightsLedger,
} = require("../lib/services/publication-evidence-gates");
const {
  workOrderFingerprint,
} = require("../lib/services/weekly-longform-work-order");

const RUN_ID = "weekly-review-bridge-synthetic-proof";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256(bytes),
  };
}

async function writeBinary(filePath, bytes) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256(bytes),
  };
}

function exactGeneratedAt(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "weekly_longform_review_proof_generated_at_invalid",
    );
  }
  return new Date(parsed).toISOString();
}

async function run({
  outputDir = path.join(
    __dirname,
    "..",
    "test",
    "output",
    "weekly-longform-review-evidence-proof",
  ),
  generatedAt = "2026-07-28T16:00:00.000Z",
} = {}) {
  const exactOutputDir = path.resolve(outputDir);
  const exactNow = exactGeneratedAt(generatedAt);
  const inputDir = path.join(exactOutputDir, "synthetic-input");
  await fsp.mkdir(inputDir, { recursive: true });

  const stories = [];
  for (let index = 1; index <= 4; index += 1) {
    const storyId = `weekly-proof-story-${index}`;
    const sourceUrl =
      `https://example.com/official/${storyId}`;
    const sourceValue = {
      schema_version: "pulse-source-evidence-v1",
      story_id: storyId,
      source_type: "official",
      source_url: sourceUrl,
      claims: [
        {
          claim_id: `${storyId}-claim-1`,
          story_id: storyId,
          text: `Synthetic verified claim ${index}`,
        },
      ],
    };
    const sourceRef = await writeJson(
      path.join(inputDir, `${storyId}-source.json`),
      sourceValue,
    );
    stories.push({
      story_id: storyId,
      title: `Synthetic verified story ${index}`,
      primary_source_url: sourceUrl,
      source_evidence: {
        ...sourceRef,
        claims: sourceValue.claims,
      },
    });
  }

  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: exactNow,
    generator_identity:
      "pulse-weekly-longform-work-order-v1",
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
      selected: stories,
    },
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  workOrder.work_order_sha256 =
    workOrderFingerprint(workOrder);

  const master = await writeBinary(
    path.join(inputDir, "synthetic-master.mp4"),
    Buffer.from(
      "synthetic-local-proof-master-not-a-production-render",
      "utf8",
    ),
  );
  const rightsValue = {
    schema_version: "pulse-longform-rights-ledger-v1",
    generated_at: exactNow,
    generator_identity:
      "pulse-weekly-review-proof-v1",
    run_id: RUN_ID,
    master_sha256: master.sha256,
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "synthetic-owned-proof-master",
        source_url: `pulse-owned://${RUN_ID}/master`,
        asset_sha256: master.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: `operator-evidence://${RUN_ID}/synthetic-proof`,
          sha256: stories[0].source_evidence.sha256,
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  rightsValue.ledger_sha256 =
    hashRightsLedger(rightsValue);
  const rights = await writeJson(
    path.join(inputDir, "rights-ledger.json"),
    rightsValue,
  );
  const decodedQa = await writeJson(
    path.join(inputDir, "decoded-qa.json"),
    {
      schema_version: "pulse-decoded-qa-v1",
      run_id: RUN_ID,
      master_sha256: master.sha256,
      decoder: "ffprobe-synthetic-proof",
      complete: true,
      verdict: "PASS",
      blockers: [],
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
    },
  );
  const sameRunManifest = await writeJson(
    path.join(inputDir, "same-run-manifest.json"),
    {
      schema_version: "pulse-longform-same-run-manifest-v1",
      run_id: RUN_ID,
      machine_evidence_complete: true,
    },
  );
  const sameRunReport = await writeJson(
    path.join(inputDir, "same-run-report.json"),
    {
      schema_version:
        "pulse-longform-same-run-evidence-report-v1",
      run_id: RUN_ID,
      machine_evidence_complete: true,
      blockers: [],
    },
  );
  const derivativesManifest = await writeJson(
    path.join(inputDir, "derivatives-manifest.json"),
    {
      schema_version:
        "pulse-weekly-longform-derivative-manifest-v1",
      run_id: RUN_ID,
      status: "AWAITING_HUMAN_AV_REVIEW",
      blockers: [],
    },
  );

  const materialized =
    await materializeWeeklyLongformReviewEvidence({
      runId: RUN_ID,
      generatedAt: exactNow,
      outputDir: path.join(
        exactOutputDir,
        "review-evidence",
      ),
      runRoot: exactOutputDir,
      workOrder,
      finalMedia: master,
      rightsLedger: {
        ...rights,
        canonical_sha256:
          rightsValue.ledger_sha256,
      },
      decodedQa,
      sameRunManifest,
      sameRunReport,
      derivativesManifest,
      productionAdapterNetworkUsed: false,
    });
  const review =
    await materializeGovernedLaneReviewPacket({
      lane_id: "weekly_longform",
      story_id: RUN_ID,
      generated_at: exactNow,
      output_dir: path.join(
        exactOutputDir,
        "governed-review",
      ),
      ...materialized.review_evidence,
    });
  const summary = {
    schema_version:
      "pulse-weekly-longform-review-evidence-proof-v1",
    generated_at: exactNow,
    run_id: RUN_ID,
    mode: "LOCAL_PROOF",
    status:
      materialized.manifest.status === "HOLD" &&
      review.packet.verdict === "HOLD" &&
      materialized.manifest.blockers.includes(
        "weekly_review_renderer_manifest_pending",
      ) &&
      materialized.manifest.blockers.includes(
        "weekly_review_native_renderer_qa_pending",
      ) &&
      materialized.manifest.blockers.includes(
        "weekly_review_measured_originality_transformation_pending",
      )
        ? "PASS"
        : "FAIL",
    expected_hold_proven:
      materialized.manifest.status === "HOLD" &&
      review.packet.verdict === "HOLD",
    bridge_status: materialized.manifest.status,
    bridge_blockers: materialized.manifest.blockers,
    governed_review_verdict: review.packet.verdict,
    structural_blocker_count:
      review.packet.blockers.length,
    structural_blockers: review.packet.blockers,
    immutable_review_fingerprint_sha256:
      review.packet.immutable_fingerprint_sha256,
    review_evidence: materialized.review_evidence,
    review_evidence_manifest:
      materialized.manifest_ref,
    synthetic_fixture_only: true,
    narration_generated: false,
    full_render_performed: false,
    paid_inference_used: false,
    network_used: false,
    external_publish_authorised: false,
    database_mutated: false,
    oauth_mutated: false,
  };
  const summaryArtifact = await writeJson(
    path.join(
      exactOutputDir,
      "weekly-longform-review-evidence-proof.json",
    ),
    summary,
  );
  return {
    summary,
    paths: {
      summary: summaryArtifact.path,
      review_packet: review.paths.json,
      review_packet_markdown: review.paths.markdown,
      review_evidence_manifest:
        materialized.manifest_ref.path,
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--generated-at") {
      args.generatedAt = argv[index + 1];
      index += 1;
    } else {
      throw new Error(
        `weekly_longform_review_proof_argument_invalid:${argv[index]}`,
      );
    }
  }
  return args;
}

if (require.main === module) {
  run(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: result.summary.status,
            governed_review_verdict:
              result.summary.governed_review_verdict,
            structural_blocker_count:
              result.summary.structural_blocker_count,
            summary_path: result.paths.summary,
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode =
        result.summary.status === "PASS" ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(
        `${error.code || error.message || "weekly_longform_review_proof_failed"}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  run,
};
