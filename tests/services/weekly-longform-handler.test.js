"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  STABILISATION_SCHEDULER_PROFILE,
  schedulesForProfile,
} = require("../../lib/scheduler");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("stabilisation continuously prepares the weekly flagship without increasing its publication cadence", () => {
  const schedule = schedulesForProfile(
    STABILISATION_SCHEDULER_PROFILE,
  ).find((item) => item.name === "weekly_longform_planner");

  assert.ok(schedule);
  assert.equal(schedule.kind, "plan_weekly_longform");
  assert.equal(schedule.cron_expr, "15 */6 * * *");
  assert.equal(
    schedule.idempotencyTemplate,
    "plan_weekly_longform:{iso_week}:{date}:{hour}",
  );
  assert.equal(schedule.payload.live_publish_enabled, false);
});

test("weekly planner materialises evidence and queues one hash-bound production run", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const workOrderPath = path.join(
    outDir,
    "weekly-longform-work-order.json",
  );
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: "weekly-flagship-2026-W31",
    status: "HOLD",
    blockers: [
      "final_narration_evidence_required",
      "real_word_alignment_evidence_required",
      "final_master_evidence_required",
    ],
    selection: {
      selected: [
        { story_id: "weekly-1" },
        { story_id: "weekly-2" },
        { story_id: "weekly-3" },
        { story_id: "weekly-4" },
      ],
    },
    script: {
      full_script: "A complete exact weekly script.",
      sha256: "a".repeat(64),
      estimated_duration_seconds: 600,
    },
    visual_beat_plan: { beat_count: 12, beats: [] },
    derivative_plan: { item_count: 8, items: [] },
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
    work_order_sha256: "b".repeat(64),
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const queued = [];
  let received = null;

  const result = await handlers.plan_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: "2026-08-01T07:00:00.000Z",
        run_id: workOrder.run_id,
        out_dir: outDir,
        candidates: [{ id: "input-proof" }],
        editorial_frame: { episode_title: "Weekly proof" },
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 601, ...input };
          },
        },
      },
      async materializeWeeklyLongformWorkOrder(input) {
        received = input;
        return {
          workOrder,
          paths: {
            json: workOrderPath,
            markdown: path.join(
              outDir,
              "weekly-longform-work-order.md",
            ),
          },
          json_sha256: sha256(
            await fs.readFile(workOrderPath),
          ),
        };
      },
    },
  );

  assert.equal(received.runId, workOrder.run_id);
  assert.deepEqual(received.candidates, [{ id: "input-proof" }]);
  assert.equal(result.status, "READY_FOR_LONGFORM_PRODUCTION");
  assert.equal(result.no_publish, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "produce_weekly_longform");
  assert.equal(queued[0].payload.run_id, workOrder.run_id);
  assert.equal(
    queued[0].payload.work_order_sha256,
    sha256(await fs.readFile(workOrderPath)),
  );
});

test("weekly planner reports editorial blockers and never queues a renderer", async () => {
  const queued = [];
  const result = await handlers.plan_weekly_longform(
    {
      payload: {
        run_id: "weekly-flagship-blocked",
        candidates: [],
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return input;
          },
        },
      },
      async materializeWeeklyLongformWorkOrder() {
        return {
          workOrder: {
            run_id: "weekly-flagship-blocked",
            status: "HOLD",
            blockers: [
              "minimum_verified_weekly_story_set_not_met",
              "editorial_dossier_incomplete",
              "final_narration_evidence_required",
            ],
            selection: { selected: [] },
            script: null,
            visual_beat_plan: null,
            safety: {
              external_publish_authorised: false,
            },
          },
          paths: {
            json: "blocked.json",
            markdown: "blocked.md",
          },
          json_sha256: "c".repeat(64),
        };
      },
    },
  );

  assert.equal(result.status, "HOLD");
  assert.ok(
    result.blockers.includes(
      "minimum_verified_weekly_story_set_not_met",
    ),
  );
  assert.equal(queued.length, 0);
});

test("weekly planner sends an evidence-ready story set to isolated editorial enrichment before rendering", async () => {
  const queued = [];
  const candidates = [1, 2, 3, 4, 5].map((index) => ({
    id: `weekly-editorial-${index}`,
    source_evidence: {
      path: `source-${index}.json`,
      sha256: String(index).repeat(64).slice(0, 64),
    },
    rights_ledger: {
      path: `rights-${index}.json`,
      sha256: String(index + 1).repeat(64).slice(0, 64),
    },
  }));
  const selected = candidates.slice(0, 4).map((candidate) => ({
    story_id: candidate.id,
  }));

  const result = await handlers.plan_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: "2026-08-01T07:00:00.000Z",
        run_id: "weekly-flagship-2026-W31",
        out_dir: "weekly-output",
        candidates,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 602, ...input };
          },
        },
      },
      async materializeWeeklyLongformWorkOrder() {
        return {
          workOrder: {
            run_id: "weekly-flagship-2026-W31",
            status: "HOLD",
            blockers: [
              "editorial_dossier_incomplete",
              "weekly_episode_title_required",
              "weekly_pitch_script_section_required",
              "final_narration_evidence_required",
            ],
            selection: { selected },
            script: null,
            visual_beat_plan: null,
            safety: {
              external_publish_authorised: false,
            },
          },
          paths: {
            json: "weekly-output/weekly-longform-work-order.json",
            markdown: "weekly-output/weekly-longform-work-order.md",
          },
          json_sha256: "f".repeat(64),
        };
      },
    },
  );

  assert.equal(
    result.status,
    "READY_FOR_LONGFORM_EDITORIAL_ENRICHMENT",
  );
  assert.equal(result.editorial_enrichment_job_id, 602);
  assert.equal(result.production_job_id, null);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "enrich_weekly_longform");
  assert.deepEqual(
    queued[0].payload.candidates.map((candidate) => candidate.id),
    selected.map((candidate) => candidate.story_id),
  );
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.human_review_required, true);
});

test("weekly editorial enrichment materialises a hash-bound work order then queues isolated production", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-editorial-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const finalWorkOrderPath = path.join(
    outDir,
    "weekly-longform-work-order.json",
  );
  const finalWorkOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: "weekly-flagship-2026-W31",
    production_runner_admission: {
      status: "READY",
      blockers: [],
    },
    safety: {
      external_publish_authorised: false,
    },
  };
  await fs.writeJson(finalWorkOrderPath, finalWorkOrder, {
    spaces: 2,
  });
  const candidates = [1, 2, 3, 4].map((index) => ({
    id: `weekly-editorial-${index}`,
  }));
  const enrichedCandidates = candidates.map((candidate) => ({
    ...candidate,
    weekly_longform_pitch: {
      section_title: candidate.id,
    },
  }));
  const editorialFrame = {
    episode_title: "The Week in Gaming",
  };
  const queued = [];
  let enrichmentInput = null;
  let materializeInput = null;
  const generator = async () => ({});

  const result = await handlers.enrich_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: "2026-08-01T07:05:00.000Z",
        run_id: finalWorkOrder.run_id,
        out_dir: outDir,
        candidates,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 603, ...input };
          },
        },
      },
      weeklyLongformEditorialGenerator: generator,
      async enrichWeeklyLongformEditorial(input) {
        enrichmentInput = input;
        return {
          schema_version:
            "pulse-weekly-longform-editorial-enrichment-v1",
          generated_at: input.generatedAt,
          run_id: input.runId,
          mode: "LOCAL_PROOF",
          verdict: "READY_FOR_LOCAL_PRODUCTION",
          blockers: [],
          editorial_frame: editorialFrame,
          enriched_candidates: enrichedCandidates,
          generator_provenance: {
            provider: "fixture",
            model: "fixture-v1",
          },
          evidence_preservation: { all_match: true },
          safety: {
            publish_authority_created: false,
          },
        };
      },
      async materializeWeeklyLongformWorkOrder(input) {
        materializeInput = input;
        return {
          workOrder: finalWorkOrder,
          paths: {
            json: finalWorkOrderPath,
            markdown: path.join(
              outDir,
              "weekly-longform-work-order.md",
            ),
          },
          json_sha256: sha256(
            await fs.readFile(finalWorkOrderPath),
          ),
        };
      },
    },
  );

  assert.equal(enrichmentInput.generator, generator);
  assert.deepEqual(
    materializeInput.candidates,
    enrichedCandidates,
  );
  assert.deepEqual(
    materializeInput.editorialFrame,
    editorialFrame,
  );
  assert.equal(result.status, "READY_FOR_LONGFORM_PRODUCTION");
  assert.equal(result.production_job_id, 603);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "produce_weekly_longform");
  assert.equal(
    queued[0].payload.work_order_sha256,
    sha256(await fs.readFile(finalWorkOrderPath)),
  );
  assert.equal(await fs.pathExists(result.report_json), true);
  assert.equal(await fs.pathExists(result.report_markdown), true);
});

test("weekly handler preserves the provider-aware 16K Google long-output default", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-google-budget-handler-"),
  );
  const previousPaidAiEnabled =
    process.env.PULSE_PAID_AI_ENABLED;
  process.env.PULSE_PAID_AI_ENABLED = "true";
  t.after(async () => {
    await fs.remove(outDir);
    if (previousPaidAiEnabled === undefined) {
      delete process.env.PULSE_PAID_AI_ENABLED;
    } else {
      process.env.PULSE_PAID_AI_ENABLED =
        previousPaidAiEnabled;
    }
  });
  const generatorCalls = [];
  const editorialMessagesClient = {
    editorial_identity: {
      provider: "google",
      model: "gemini-weekly-handler-test",
      adapter: "gemini.generateContent",
    },
    messages: {
      async create(input) {
        generatorCalls.push(input);
        return {
          content: [{ type: "text", text: "{}" }],
        };
      },
    },
  };

  const result = await handlers.enrich_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: "2026-08-01T07:05:00.000Z",
        run_id: "weekly-google-budget-handler",
        out_dir: outDir,
        candidates: [1, 2, 3, 4].map((index) => ({
          id: `weekly-google-${index}`,
        })),
      },
    },
    {
      editorialMessagesClient,
      async enrichWeeklyLongformEditorial(input) {
        await input.generator({
          stories: [1, 2, 3, 4].map((index) => ({
            story_id: `weekly-google-${index}`,
            verified_claims: [
              { claim_id: `claim-weekly-google-${index}` },
            ],
            cleared_asset_ids: [
              `asset-weekly-google-${index}`,
            ],
          })),
        });
        return {
          schema_version:
            "pulse-weekly-longform-editorial-enrichment-v1",
          generated_at: input.generatedAt,
          run_id: input.runId,
          mode: "LOCAL_PROOF",
          verdict: "BLOCKED",
          blockers: ["fixture_stop_after_generator_observation"],
          generator_error_code: null,
          editorial_frame: null,
          enriched_candidates: null,
          evidence_preservation: { all_match: true },
          safety: {
            publish_authority_created: false,
          },
        };
      },
    },
  );

  assert.equal(result.status, "HOLD");
  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].max_tokens, 16_384);
  assert.equal(
    generatorCalls[0].editorial_request_profile,
    "long_output",
  );
  assert.equal(
    generatorCalls[0].editorial_thinking_level,
    "MEDIUM",
  );
  assert.deepEqual(
    generatorCalls[0].editorial_response_json_schema.properties
      .weekly_longform_pitch.properties["weekly-google-1"]
      .properties.claim_ids,
    {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        type: "string",
        enum: ["claim-weekly-google-1"],
      },
    },
  );
});

test("weekly production re-hashes the exact work order before calling the isolated runner", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-produce-"),
  );
  t.after(() => fs.remove(outDir));
  const workOrderPath = path.join(outDir, "work-order.json");
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: "weekly-flagship-2026-W31",
    script: { sha256: "a".repeat(64) },
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const workOrderSha = sha256(await fs.readFile(workOrderPath));
  let received = null;

  const result = await handlers.produce_weekly_longform(
    {
      payload: {
        lane_id: "weekly_longform",
        run_id: workOrder.run_id,
        work_order_path: workOrderPath,
        work_order_sha256: workOrderSha,
      },
    },
    {
      async runWeeklyLongformProduction(input) {
        received = input;
        return {
          status: "MACHINE_EVIDENCE_COMPLETE_AWAITING_HUMAN_REVIEW",
          blockers: ["human_av_review_pending"],
          report_json: path.join(outDir, "report.json"),
        };
      },
    },
  );

  assert.equal(received.workOrder.run_id, workOrder.run_id);
  assert.equal(received.workOrderPath, workOrderPath);
  assert.equal(
    result.status,
    "MACHINE_EVIDENCE_COMPLETE_AWAITING_HUMAN_REVIEW",
  );
  assert.equal(result.no_publish, true);
});

test("weekly production fanout forwards the post-production work order and all semantic review refs unchanged", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-review-fanout-"),
  );
  t.after(() => fs.remove(outDir));
  const runId = "weekly-flagship-2026-W31-review";
  const workOrderPath = path.join(outDir, "work-order.json");
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: runId,
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const workOrderSha = sha256(await fs.readFile(workOrderPath));
  const fields = [
    "production_work_order_ref",
    "final_media_ref",
    "renderer_manifest_ref",
    "qa_ref",
    "source_evidence_ref",
    "rights_ledger_ref",
    "originality_transformation_ref",
    "synthetic_disclosure_proposal_ref",
  ];
  const reviewEvidence = Object.fromEntries(
    fields.map((field, index) => [
      field,
      {
        path: path.join(outDir, `${field}.json`),
        sha256: String(index + 1).repeat(64),
        story_id: runId,
        lane_id: "weekly_longform",
      },
    ]),
  );
  const queued = [];

  const result = await handlers.produce_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "weekly_longform",
        run_id: runId,
        work_order_path: workOrderPath,
        work_order_sha256: workOrderSha,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: queued.length };
          },
        },
      },
      async runWeeklyLongformProduction() {
        return {
          status: "AWAITING_HUMAN_AV_REVIEW",
          blockers: ["human_av_review_pending"],
          result_sha256: "f".repeat(64),
          review_evidence: reviewEvidence,
        };
      },
    },
  );

  assert.equal(result.review_job_id, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "review_weekly_longform");
  assert.deepEqual(
    queued[0].payload.review_evidence,
    reviewEvidence,
  );
  assert.equal(
    queued[0].payload.review_evidence
      .production_work_order_ref.path,
    reviewEvidence.production_work_order_ref.path,
  );
});

test("weekly fanout never relabels generic decoded QA as independent native renderer QA", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-pending-review-fanout-"),
  );
  t.after(() => fs.remove(outDir));
  const runId = "weekly-flagship-pending-native-qa";
  const workOrderPath = path.join(outDir, "work-order.json");
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: runId,
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const workOrderSha = sha256(await fs.readFile(workOrderPath));
  const genericQa = {
    path: path.join(outDir, "generic-decoded-qa.json"),
    sha256: "a".repeat(64),
  };
  const reviewEvidence = {
    production_work_order_ref: {
      path: workOrderPath,
      sha256: workOrderSha,
      story_id: runId,
      lane_id: "weekly_longform",
    },
    final_media_ref: null,
    renderer_manifest_ref: null,
    qa_ref: null,
    source_evidence_ref: null,
    rights_ledger_ref: null,
    originality_transformation_ref: null,
    synthetic_disclosure_proposal_ref: null,
  };
  const queued = [];

  const result = await handlers.produce_weekly_longform(
    {
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "weekly_longform",
        run_id: runId,
        work_order_path: workOrderPath,
        work_order_sha256: workOrderSha,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: queued.length };
          },
        },
      },
      async runWeeklyLongformProduction() {
        return {
          status: "HOLD",
          blockers: [
            "weekly_review_native_renderer_qa_pending",
          ],
          result_sha256: "f".repeat(64),
          review_evidence: reviewEvidence,
          artifacts: {
            decoded_qa_input: genericQa,
          },
        };
      },
    },
  );

  assert.equal(result.status, "HOLD");
  assert.equal(queued.length, 1);
  assert.equal(
    queued[0].payload.review_evidence.qa_ref,
    null,
  );
});

test("weekly production fails closed on byte drift before invoking any renderer", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-drift-"),
  );
  t.after(() => fs.remove(outDir));
  const workOrderPath = path.join(outDir, "work-order.json");
  await fs.writeJson(workOrderPath, {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: "weekly-drift",
  });
  let called = false;

  const result = await handlers.produce_weekly_longform(
    {
      payload: {
        lane_id: "weekly_longform",
        run_id: "weekly-drift",
        work_order_path: workOrderPath,
        work_order_sha256: "d".repeat(64),
      },
    },
    {
      async runWeeklyLongformProduction() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "HOLD");
  assert.deepEqual(result.blockers, [
    "weekly_longform_work_order_sha256_mismatch",
  ]);
});

test("the default weekly production path materialises a fail-closed runtime capability report before any renderer runs", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-runtime-blocked-"),
  );
  t.after(() => fs.remove(outDir));
  const workOrderPath = path.join(outDir, "work-order.json");
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: "weekly-runtime-blocked",
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const workOrderSha = sha256(await fs.readFile(workOrderPath));
  let runnerCalled = false;

  const result = await handlers.produce_weekly_longform(
    {
      payload: {
        lane_id: "weekly_longform",
        run_id: workOrder.run_id,
        work_order_path: workOrderPath,
        work_order_sha256: workOrderSha,
        out_dir: path.join(outDir, "production"),
      },
    },
    {
      buildWeeklyLongformRuntimeStack() {
        return {
          capabilities: {
            schema_version:
              "pulse-weekly-longform-runtime-stack-v1",
            ready: false,
            blockers: ["gsap_runtime_unavailable"],
            safety: {
              external_publish_authority: false,
              database_mutation_authority: false,
              oauth_mutation_authority: false,
              process_commands_allowlisted: true,
              provider_network_origin_pinned: true,
            },
          },
          runtime_capabilities: {
            schema_version:
              "pulse-weekly-longform-runtime-capabilities-v1",
            ready: false,
          },
          renderer_capabilities: { ready: false },
          adapter_capabilities: { ready: false },
          adapters: {},
        };
      },
      async governedWeeklyLongformProductionRunner() {
        runnerCalled = true;
      },
    },
  );

  assert.equal(result.status, "HOLD");
  assert.equal(runnerCalled, false);
  assert.deepEqual(result.blockers, [
    "weekly_longform_runtime_not_ready",
    "gsap_runtime_unavailable",
  ]);
  assert.equal(
    await fs.pathExists(result.runtime_capabilities_json),
    true,
  );
  const report = JSON.parse(
    await fs.readFile(result.runtime_capabilities_json, "utf8"),
  );
  assert.equal(report.capabilities.ready, false);
  assert.equal(report.external_publish_authorised, false);
});

test("the default weekly production path passes the exact ready adapter stack to the governed runner", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-runtime-ready-"),
  );
  t.after(() => fs.remove(outDir));
  const workOrderPath = path.join(outDir, "work-order.json");
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    run_id: "weekly-runtime-ready",
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const workOrderSha = sha256(await fs.readFile(workOrderPath));
  const adapters = {
    narration: async () => {},
    alignment: async () => {},
    render: async () => {},
    variants: async () => {},
    decodedQa: async () => {},
  };
  const materializeDerivatives = async () => {};
  let received = null;

  const result = await handlers.produce_weekly_longform(
    {
      payload: {
        lane_id: "weekly_longform",
        run_id: workOrder.run_id,
        work_order_path: workOrderPath,
        work_order_sha256: workOrderSha,
        out_dir: path.join(outDir, "production"),
      },
    },
    {
      buildWeeklyLongformRuntimeStack() {
        return {
          capabilities: {
            schema_version:
              "pulse-weekly-longform-runtime-stack-v1",
            ready: true,
            blockers: [],
            safety: {
              external_publish_authority: false,
              database_mutation_authority: false,
              oauth_mutation_authority: false,
              process_commands_allowlisted: true,
              provider_network_origin_pinned: true,
            },
          },
          runtime_capabilities: {
            schema_version:
              "pulse-weekly-longform-runtime-capabilities-v1",
            ready: true,
          },
          renderer_capabilities: { ready: true },
          adapter_capabilities: { ready: true },
          adapters,
          materializeDerivatives,
        };
      },
      async governedWeeklyLongformProductionRunner(input) {
        received = input;
        return {
          status: "AWAITING_HUMAN_AV_REVIEW",
          blockers: ["human_av_review_pending"],
        };
      },
    },
  );

  assert.equal(received.adapters, adapters);
  assert.equal(
    received.materializeDerivatives,
    materializeDerivatives,
  );
  assert.equal(received.workOrderPath, workOrderPath);
  assert.equal(result.status, "AWAITING_HUMAN_AV_REVIEW");
  assert.equal(
    await fs.pathExists(result.runtime_capabilities_json),
    true,
  );
  assert.equal(result.no_publish, true);
});
