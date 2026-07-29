"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { handlers } = require("../../lib/job-handlers");

const GENERATED_AT = "2026-07-28T18:00:00.000Z";

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ref(name, laneId, storyId) {
  return {
    path: path.join("C:\\proof", `${name}.json`),
    sha256: hash(name),
    story_id: storyId,
    lane_id: laneId,
  };
}

function breakingStory(overrides = {}) {
  return {
    id: "breaking-review-fanout-001",
    title: "Xbox confirms a major compatibility update",
    approved: 1,
    full_script:
      "Xbox has confirmed a major compatibility update and explained exactly what changes for players.",
    breaking_score: 130,
    publish_status: "review",
    _extra: JSON.stringify({
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example/",
      source_evidence_sha256: hash("verified-source"),
      verification_status: "CONFIRMED",
    }),
    ...overrides,
  };
}

test("all governed lane review job kinds are registered", () => {
  for (const kind of [
    "review_breaking_short",
    "review_evergreen_short",
    "review_weekly_longform",
  ]) {
    assert.equal(typeof handlers[kind], "function");
  }
});

test("review handler passes only exact supplied refs to the packet materializer and creates no authority", async () => {
  const laneId = "evergreen_short";
  const storyId = "evergreen-review-001";
  const reviewEvidence = {
    production_work_order_ref: ref("work-order", laneId, storyId),
    final_media_ref: ref("final-media", laneId, storyId),
    renderer_manifest_ref: ref("renderer", laneId, storyId),
    qa_ref: ref("qa", laneId, storyId),
    source_evidence_ref: ref("source", laneId, storyId),
    rights_ledger_ref: ref("rights", laneId, storyId),
    originality_transformation_ref: ref(
      "originality",
      laneId,
      storyId,
    ),
    synthetic_disclosure_proposal_ref: ref(
      "disclosure",
      laneId,
      storyId,
    ),
  };
  let received = null;
  let enqueued = false;

  const result = await handlers.review_evergreen_short(
    {
      kind: "review_evergreen_short",
      payload: {
        lane_id: laneId,
        story_id: storyId,
        generated_at: GENERATED_AT,
        output_dir: path.join("C:\\proof", "review"),
        review_evidence: reviewEvidence,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        jobs: {
          enqueue() {
            enqueued = true;
          },
        },
      },
      async materializeGovernedLaneReviewPacket(input) {
        received = input;
        return {
          packet: {
            verdict: "READY_FOR_HUMAN_REVIEW",
            blockers: [],
            immutable_fingerprint_sha256: "f".repeat(64),
            human_review: {
              required: true,
              decision: null,
              approval_inferred: false,
            },
            authority: {
              approval_created: false,
              admission_created: false,
              scheduler_created: false,
              publish_created: false,
              external_publish_authorised: false,
            },
          },
          paths: {
            json: path.join("C:\\proof", "review.json"),
            markdown: path.join("C:\\proof", "review.md"),
          },
          sha256: {
            json: "1".repeat(64),
            markdown: "2".repeat(64),
          },
        };
      },
    },
  );

  assert.equal(received.lane_id, laneId);
  assert.equal(received.story_id, storyId);
  assert.equal(received.generated_at, GENERATED_AT);
  for (const [name, exactRef] of Object.entries(reviewEvidence)) {
    assert.deepEqual(received[name], exactRef);
  }
  assert.equal(result.status, "READY_FOR_HUMAN_REVIEW");
  assert.equal(result.human_review_required, true);
  assert.equal(result.publish_authority, false);
  assert.equal(result.approval_inferred, false);
  assert.equal(result.no_publish, true);
  assert.equal(enqueued, false);
});

test("missing evidence still materialises a durable HOLD packet instead of disappearing", async (t) => {
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-review-handler-hold-"),
  );
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const result = await handlers.review_breaking_short(
    {
      kind: "review_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: "breaking-review-hold-001",
        generated_at: GENERATED_AT,
        output_dir: outputDir,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {},
  );

  assert.equal(result.status, "HOLD");
  assert.ok(
    result.blockers.includes("production_work_order_path_required"),
  );
  assert.ok(result.blockers.includes("final_media_sha256_required"));
  assert.equal(
    await fs.stat(result.review_packet_json).then((stat) => stat.isFile()),
    true,
  );
  assert.equal(
    await fs
      .stat(result.review_packet_markdown)
      .then((stat) => stat.isFile()),
    true,
  );
  const packet = JSON.parse(
    await fs.readFile(result.review_packet_json, "utf8"),
  );
  assert.equal(packet.verdict, "HOLD");
  assert.equal(packet.human_review.approval_inferred, false);
  assert.equal(packet.authority.admission_created, false);
  assert.equal(packet.authority.publish_created, false);
});

test("review resolution accepts only documented exact refs and never invents a missing expected hash", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-review-no-self-hash-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const laneId = "breaking_short";
  const storyId = "breaking-review-resolution-001";
  const untrustedWorkOrderPath = path.join(root, "work-order.json");
  await fs.writeFile(
    untrustedWorkOrderPath,
    '{"story_id":"breaking-review-resolution-001"}\n',
    "utf8",
  );
  const sourceRef = ref("source-from-story", laneId, storyId);
  const qaRef = ref("qa-from-production", laneId, storyId);
  const story = {
    id: storyId,
    _extra: JSON.stringify({
      review_evidence: {
        source_evidence_ref: sourceRef,
      },
    }),
  };
  let received = null;

  await handlers.review_breaking_short(
    {
      kind: "review_breaking_short",
      payload: {
        lane_id: laneId,
        story_id: storyId,
        generated_at: GENERATED_AT,
        output_dir: path.join(root, "review"),
        production_work_order_ref: {
          path: untrustedWorkOrderPath,
          story_id: storyId,
          lane_id: laneId,
        },
        production_result: {
          review_evidence: {
            qa_ref: qaRef,
          },
          report_json: path.join(root, "generic-report.json"),
        },
      },
    },
    {
      repos: { stories: { get: () => story } },
      async materializeGovernedLaneReviewPacket(input) {
        received = input;
        return {
          packet: {
            verdict: "HOLD",
            blockers: ["production_work_order_sha256_required"],
            immutable_fingerprint_sha256: "9".repeat(64),
          },
          paths: {
            json: path.join(root, "review.json"),
            markdown: path.join(root, "review.md"),
          },
          sha256: {
            json: "8".repeat(64),
            markdown: "7".repeat(64),
          },
        };
      },
    },
  );

  assert.equal(
    Object.hasOwn(received.production_work_order_ref, "sha256"),
    false,
  );
  assert.deepEqual(received.qa_ref, qaRef);
  assert.deepEqual(received.source_evidence_ref, sourceRef);
  assert.equal(received.renderer_manifest_ref, null);
  assert.equal(
    JSON.stringify(received).includes("generic-report.json"),
    false,
  );
});

test("exact short production fans out only a revision-bound lane review when evidence is incomplete", async () => {
  const story = breakingStory();
  const workOrderRef = ref(
    "breaking-production-work-order",
    "breaking_short",
    story.id,
  );
  const queued = [];

  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
        generated_at: GENERATED_AT,
        production_work_order_ref: workOrderRef,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        stories: { get: () => story },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 801, ...input };
          },
        },
      },
      async produceExactStory() {
        return {
          exact_scope: true,
          story_ids: [story.id],
          human_review_required: true,
          no_publish: true,
        };
      },
    },
  );

  assert.equal(result.status, "prepared_for_human_review");
  assert.equal(result.review_job_id, 801);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "review_breaking_short");
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.human_review_required, true);
  assert.equal(queued[0].payload.approval_inferred, false);
  assert.deepEqual(
    queued[0].payload.review_evidence.production_work_order_ref,
    workOrderRef,
  );
  assert.equal(
    queued[0].payload.review_evidence.renderer_manifest_ref,
    null,
  );
  assert.match(
    queued[0].idempotency_key,
    new RegExp(`^review:breaking_short:${story.id}:[a-f0-9]{64}$`),
  );
  assert.equal(
    queued.some((item) =>
      ["publish", "admit_governed_publication"].includes(item.kind),
    ),
    false,
  );
});

test("review job idempotency changes only with the exact production evidence revision", async () => {
  const story = breakingStory({
    id: "breaking-review-revision-001",
  });
  const keys = [];
  const ctx = {
    repos: {
      stories: { get: () => story },
      jobs: {
        enqueue(input) {
          keys.push(input.idempotency_key);
          return { id: keys.length, ...input };
        },
      },
    },
    async produceExactStory() {
      return { story_ids: [story.id], no_publish: true };
    },
  };
  const basePayload = {
    lane_id: "breaking_short",
    story_id: story.id,
    generated_at: GENERATED_AT,
    publish_authority: false,
    human_review_required: true,
  };

  await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        ...basePayload,
        production_work_order_ref: {
          ...ref("revision-a", "breaking_short", story.id),
          path: "C:\\proof\\work-order.json",
        },
      },
    },
    ctx,
  );
  await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        ...basePayload,
        production_work_order_ref: {
          ...ref("revision-b", "breaking_short", story.id),
          path: "C:\\proof\\work-order.json",
        },
      },
    },
    ctx,
  );

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.match(keys[0], /:[a-f0-9]{64}$/);
  assert.match(keys[1], /:[a-f0-9]{64}$/);
});

test("weekly production fans out exact semantic artefacts without relabelling generic reports", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-weekly-review-fanout-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runId = "weekly-review-2026-W31";
  const workOrderPath = path.join(root, "work-order.json");
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: GENERATED_AT,
    run_id: runId,
    safety: {
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
  await fs.writeFile(
    workOrderPath,
    `${JSON.stringify(workOrder, null, 2)}\n`,
    "utf8",
  );
  const workOrderSha256 = hash(await fs.readFile(workOrderPath));
  const queued = [];
  const master = {
    path: path.join(root, "master.mp4"),
    sha256: "a".repeat(64),
  };
  const decodedQa = {
    path: path.join(root, "decoded-qa.json"),
    sha256: "b".repeat(64),
  };
  const rights = {
    path: path.join(root, "rights-lineage.json"),
    sha256: "c".repeat(64),
  };

  const result = await handlers.produce_weekly_longform(
    {
      kind: "produce_weekly_longform",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "weekly_longform",
        run_id: runId,
        work_order_path: workOrderPath,
        work_order_sha256: workOrderSha256,
        generated_at: GENERATED_AT,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 901, ...input };
          },
        },
      },
      async runWeeklyLongformProduction() {
        return {
          status: "AWAITING_HUMAN_AV_REVIEW",
          blockers: ["human_av_review_pending"],
          result_path: path.join(root, "generic-result.json"),
          result_sha256: "d".repeat(64),
          artifacts: {
            master,
            decoded_qa_input: decodedQa,
            rights_lineage_input: rights,
            same_run_report: {
              path: path.join(root, "same-run-report.json"),
              sha256: "e".repeat(64),
            },
            same_run_manifest: {
              path: path.join(root, "same-run-manifest.json"),
              sha256: "f".repeat(64),
            },
          },
        };
      },
    },
  );

  assert.equal(result.review_job_id, 901);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "review_weekly_longform");
  assert.deepEqual(
    queued[0].payload.review_evidence.production_work_order_ref,
    {
      path: workOrderPath,
      sha256: workOrderSha256,
      story_id: runId,
      lane_id: "weekly_longform",
    },
  );
  assert.deepEqual(
    queued[0].payload.review_evidence.final_media_ref,
    {
      ...master,
      story_id: runId,
      lane_id: "weekly_longform",
    },
  );
  assert.equal(
    queued[0].payload.review_evidence.qa_ref,
    null,
    "generic decoded QA must not be relabelled as native renderer QA",
  );
  assert.deepEqual(
    queued[0].payload.review_evidence.rights_ledger_ref,
    {
      ...rights,
      story_id: runId,
      lane_id: "weekly_longform",
    },
  );
  assert.equal(
    queued[0].payload.review_evidence.renderer_manifest_ref,
    null,
  );
  assert.equal(
    queued[0].payload.review_evidence.source_evidence_ref,
    null,
  );
  assert.equal(
    JSON.stringify(queued[0].payload.review_evidence).includes(
      "same-run-report",
    ),
    false,
  );
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.approval_inferred, false);
  assert.equal(
    queued.some((item) => item.kind === "publish"),
    false,
  );
});
