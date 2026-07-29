"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  buildReadyInventoryFixture,
} = require("../helpers/governed-editorial-inventory-fixture");

const NOW = "2026-07-28T12:00:00.000Z";

test("the scheduled planner hydrates a DB-only breaking story from its exact READY inventory and routes immutable review refs", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-lane-bridge-"),
  );
  t.after(() => fs.remove(root));
  const fixture = buildReadyInventoryFixture(root);
  const outDir = path.join(root, "planner-output");
  const queued = [];
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return {
          all() {
            return [
              {
                id: fixture.storyId,
                title: "DB-only breaking candidate",
                url: fixture.primarySourceUrl,
                breaking_score: 100,
                score: 90,
                full_script: "",
                published_at: "2026-07-28T09:30:00.000Z",
                created_at: "2026-07-28T09:30:00.000Z",
                youtube_post_id: "",
                publish_status: "",
                _extra: JSON.stringify({
                  breaking_fast_track: true,
                }),
              },
            ];
          },
        };
      }
      if (sql.includes("FROM platform_publication_state")) {
        return { get() { return null; } };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };

  const result = await handlers.governed_multi_lane_plan(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        runtime_control: {
          kill_switch_healthy: false,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: false,
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
      },
    },
    {
      prevalidatedRuntimeControl: true,
      governedEditorialInventoryRoot: fixture.inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        fixture.outputRoot,
      ],
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 1201, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.no_publish, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "plan_breaking_short");
  assert.equal(queued[0].story_id, fixture.storyId);
  assert.deepEqual(queued[0].payload.source_evidence_ref, {
    path: fixture.sourcePath,
    sha256: fixture.sourceFileSha256,
    canonical_sha256: fixture.sourcePacket.packet_sha256,
    story_id: fixture.storyId,
    lane_id: "breaking_short",
  });
  assert.deepEqual(queued[0].payload.rights_ledger_ref, {
    path: fixture.rightsPath,
    sha256: fixture.rightsFileSha256,
    canonical_sha256: fixture.ledger.ledger_sha256,
    story_id: fixture.storyId,
    lane_id: "breaking_short",
  });
  assert.equal(
    queued[0].payload.candidate_revision
      .source_evidence_sha256,
    fixture.sourcePacket.packet_sha256,
  );
  assert.equal(
    queued[0].payload.candidate_revision
      .rights_ledger_sha256,
    fixture.ledger.ledger_sha256,
  );
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.human_review_required, true);
  assert.equal(
    Object.hasOwn(
      queued[0].payload,
      "external_posting_authorised",
    ),
    false,
  );

  const report = await fs.readJson(result.report_json);
  assert.equal(report.candidate_hydration.verdict, "READY");
  assert.equal(
    report.candidate_hydration.hydrated[0].story_id,
    fixture.storyId,
  );
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .story_id,
    fixture.storyId,
  );
  assert.equal(report.safety.live_publish_enabled, false);
});

test("exact breaking planning preserves validated inventory refs through production into governed human review", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-review-bridge-"),
  );
  t.after(() => fs.remove(root));
  const fixture = buildReadyInventoryFixture(root);
  const story = {
    id: fixture.storyId,
    title: "Exact governed breaking story",
    breaking_score: 100,
    full_script:
      "Xbox has confirmed the update. This exact script now explains what changed and why it matters to players.",
    approved: false,
    publish_status: "",
    _extra: JSON.stringify({ breaking_fast_track: true }),
  };
  const productionJobs = [];
  const planning = await handlers.plan_breaking_short(
    {
      kind: "plan_breaking_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: fixture.storyId,
        now: NOW,
        out_dir: path.join(root, "work-order"),
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url: fixture.primarySourceUrl,
        source_evidence_path: fixture.sourcePath,
        source_evidence_file_sha256:
          fixture.sourceFileSha256,
        source_evidence_sha256:
          fixture.sourcePacket.packet_sha256,
        source_evidence_ref: {
          path: fixture.sourcePath,
          sha256: fixture.sourceFileSha256,
          canonical_sha256:
            fixture.sourcePacket.packet_sha256,
          story_id: fixture.storyId,
          lane_id: "breaking_short",
        },
        governed_editorial_inventory_ref: {
          path: fixture.registryPath,
          sha256: fixture.registryFileSha256,
          canonical_sha256: fixture.registry.inventory_sha256,
          story_id: fixture.storyId,
          lane_id: "breaking_short",
        },
        governed_source_evidence: {
          verification_status: "CONFIRMED",
          verified_for_planning: true,
          primary_source_url: fixture.primarySourceUrl,
          source_evidence_sha256:
            fixture.sourcePacket.packet_sha256,
          path: fixture.sourcePath,
          file_sha256: fixture.sourceFileSha256,
        },
        rights_ledger_path: fixture.rightsPath,
        rights_ledger_file_sha256:
          fixture.rightsFileSha256,
        rights_ledger_canonical_sha256:
          fixture.ledger.ledger_sha256,
        rights_ledger_ref: {
          path: fixture.rightsPath,
          sha256: fixture.rightsFileSha256,
          canonical_sha256: fixture.ledger.ledger_sha256,
          story_id: fixture.storyId,
          lane_id: "breaking_short",
        },
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        stories: { get() { return story; } },
        jobs: {
          enqueue(input) {
            productionJobs.push(input);
            return { id: 1301, ...input };
          },
        },
      },
    },
  );
  assert.equal(planning.status, "READY_FOR_EXACT_PRODUCTION");
  assert.equal(productionJobs.length, 1);
  assert.deepEqual(
    productionJobs[0].payload.governed_editorial_inventory_ref,
    {
      path: fixture.registryPath,
      sha256: fixture.registryFileSha256,
      canonical_sha256: fixture.registry.inventory_sha256,
      story_id: fixture.storyId,
      lane_id: "breaking_short",
    },
  );
  assert.equal(
    productionJobs[0].payload.governed_source_evidence
      .primary_source_url,
    fixture.primarySourceUrl,
  );
  assert.deepEqual(
    productionJobs[0].payload.rights_ledger_ref,
    {
      path: fixture.rightsPath,
      sha256: fixture.rightsFileSha256,
      canonical_sha256: fixture.ledger.ledger_sha256,
      story_id: fixture.storyId,
      lane_id: "breaking_short",
    },
  );

  const reviewJobs = [];
  const produced = await handlers.produce_breaking_short(
    productionJobs[0],
    {
      repos: {
        stories: { get() { return story; } },
        jobs: {
          enqueue(input) {
            reviewJobs.push(input);
            return { id: 1302, ...input };
          },
        },
      },
      async produceExactStory() {
        return { status: "rendered", story_id: fixture.storyId };
      },
    },
  );
  assert.equal(
    produced.status,
    "prepared_for_human_review",
    JSON.stringify(produced),
  );
  assert.equal(reviewJobs.length, 1);
  assert.deepEqual(
    reviewJobs[0].payload.review_evidence.source_evidence_ref,
    productionJobs[0].payload.source_evidence_ref,
  );
  assert.deepEqual(
    reviewJobs[0].payload.review_evidence.rights_ledger_ref,
    productionJobs[0].payload.rights_ledger_ref,
  );
  assert.equal(reviewJobs[0].payload.publish_authority, false);
  assert.equal(reviewJobs[0].payload.human_review_required, true);
});

test("a SCRIPT_READY inventory candidate carries its validated official source binding into direct production", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-direct-production-"),
  );
  t.after(() => fs.remove(root));
  const fixture = buildReadyInventoryFixture(root);
  const story = {
    id: fixture.storyId,
    title: "Exact governed breaking story",
    breaking_score: 100,
    full_script:
      "Xbox has confirmed the update. This exact script explains what changed, who benefits and why the timing matters.",
    approved: false,
    publish_status: "",
    _extra: "{}",
  };
  const productionJobs = [];

  const planning = await handlers.governed_multi_lane_plan(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: path.join(root, "planner-output"),
        candidates: [
          {
            lane_id: "breaking_short",
            story_id: fixture.storyId,
            title: story.title,
            score: 100,
            stage: "SCRIPT_READY",
            published_at: "2026-07-28T09:30:00.000Z",
          },
        ],
        runtime_control: {
          kill_switch_healthy: false,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: false,
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
      },
    },
    {
      prevalidatedRuntimeControl: true,
      governedEditorialInventoryRoot: fixture.inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        fixture.outputRoot,
      ],
      repos: {
        jobs: {
          enqueue(input) {
            productionJobs.push(input);
            return { id: 124992, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(planning.no_publish, true);
  assert.equal(productionJobs.length, 1);
  assert.equal(productionJobs[0].kind, "produce_breaking_short");
  assert.equal(
    productionJobs[0].payload.verification_status,
    "CONFIRMED",
  );
  assert.equal(
    productionJobs[0].payload.primary_source_url,
    fixture.primarySourceUrl,
  );

  let rendererCalled = false;
  const produced = await handlers.produce_breaking_short(
    productionJobs[0],
    {
      repos: {
        stories: { get() { return story; } },
      },
      async produceExactStory() {
        rendererCalled = true;
        return { status: "rendered", story_id: fixture.storyId };
      },
    },
  );

  assert.equal(
    produced.status,
    "prepared_for_human_review",
    JSON.stringify(produced),
  );
  assert.equal(rendererCalled, true);
  assert.equal(produced.no_publish, true);
});

test("direct production fails closed when official source semantics are tampered after immutable inventory routing", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-source-tamper-"),
  );
  t.after(() => fs.remove(root));
  const fixture = buildReadyInventoryFixture(root);
  const story = {
    id: fixture.storyId,
    title: "Exact governed breaking story",
    breaking_score: 100,
    full_script:
      "Xbox has confirmed the update. This exact script explains what changed, who benefits and why the timing matters.",
    approved: false,
    publish_status: "",
    _extra: "{}",
  };
  let rendererCalled = false;

  const produced = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: fixture.storyId,
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url:
          "https://example.invalid/tampered-primary-source",
        source_evidence_path: fixture.sourcePath,
        source_evidence_file_sha256:
          fixture.sourceFileSha256,
        source_evidence_sha256:
          fixture.sourcePacket.packet_sha256,
        governed_editorial_inventory_ref: {
          path: fixture.registryPath,
          sha256: fixture.registryFileSha256,
          canonical_sha256: fixture.registry.inventory_sha256,
          story_id: fixture.storyId,
          lane_id: "breaking_short",
        },
        source_evidence_ref: {
          path: fixture.sourcePath,
          sha256: fixture.sourceFileSha256,
          canonical_sha256:
            fixture.sourcePacket.packet_sha256,
          story_id: fixture.storyId,
          lane_id: "breaking_short",
        },
        governed_source_evidence: {
          verification_status: "CONFIRMED",
          verified_for_planning: true,
          primary_source_url: fixture.primarySourceUrl,
          source_evidence_sha256:
            fixture.sourcePacket.packet_sha256,
          path: fixture.sourcePath,
          file_sha256: fixture.sourceFileSha256,
        },
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        stories: { get() { return story; } },
      },
      async produceExactStory() {
        rendererCalled = true;
        return { status: "rendered", story_id: fixture.storyId };
      },
    },
  );

  assert.equal(produced.status, "held");
  assert.equal(rendererCalled, false);
  assert.ok(
    produced.blockers.includes(
      "governed_source_evidence_binding_mismatch",
    ),
  );
  assert.equal(produced.no_publish, true);
});

test("direct production cannot downgrade an inventory-bound revision by stripping its inventory ref", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-ref-stripped-"),
  );
  t.after(() => fs.remove(root));
  const fixture = buildReadyInventoryFixture(root);
  const story = {
    id: fixture.storyId,
    title: "Exact governed breaking story",
    breaking_score: 100,
    full_script:
      "Xbox has confirmed the update. This exact script explains what changed, who benefits and why the timing matters.",
    approved: false,
    publish_status: "",
    _extra: "{}",
  };
  let rendererCalled = false;

  const produced = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: fixture.storyId,
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url: fixture.primarySourceUrl,
        source_evidence_path: fixture.sourcePath,
        source_evidence_file_sha256:
          fixture.sourceFileSha256,
        source_evidence_sha256:
          fixture.sourcePacket.packet_sha256,
        source_evidence_ref: {
          path: fixture.sourcePath,
          sha256: fixture.sourceFileSha256,
          canonical_sha256:
            fixture.sourcePacket.packet_sha256,
          story_id: fixture.storyId,
          lane_id: "breaking_short",
        },
        governed_source_evidence: {
          verification_status: "CONFIRMED",
          verified_for_planning: true,
          primary_source_url: fixture.primarySourceUrl,
          source_evidence_sha256:
            fixture.sourcePacket.packet_sha256,
          path: fixture.sourcePath,
          file_sha256: fixture.sourceFileSha256,
        },
        candidate_revision: {
          schema_version:
            "pulse-multi-lane-candidate-revision-v1",
          stage: "SCRIPT_READY",
          source_evidence_sha256:
            fixture.sourcePacket.packet_sha256,
          editorial_inventory_sha256:
            fixture.registry.inventory_sha256,
        },
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        stories: { get() { return story; } },
      },
      async produceExactStory() {
        rendererCalled = true;
        return { status: "rendered", story_id: fixture.storyId };
      },
    },
  );

  assert.equal(produced.status, "held");
  assert.equal(rendererCalled, false);
  assert.ok(
    produced.blockers.includes(
      "governed_source_evidence_binding_mismatch",
    ),
  );
  assert.equal(produced.no_publish, true);
});

test("an inventory hydration exception removes all affected breaking candidates before eligibility and routing", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-bridge-failure-"),
  );
  t.after(() => fs.remove(root));
  const outDir = path.join(root, "planner-output");
  const queued = [];
  const storyId = "breaking-stale-evidence";
  const sourceSha256 = "1".repeat(64);
  const fileSha256 = "2".repeat(64);

  const result = await handlers.governed_multi_lane_plan(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        candidates: [
          {
            lane_id: "breaking_short",
            story_id: storyId,
            title: "Syntactically valid stale evidence",
            score: 100,
            stage: "PLANNING",
            governed_source_evidence: {
              verification_status: "CONFIRMED",
              verified_for_planning: true,
              primary_source_url:
                "https://news.xbox.com/en-us/stale/",
              source_evidence_sha256: sourceSha256,
              path: path.join(root, "stale-source.json"),
              file_sha256: fileSha256,
            },
          },
        ],
        runtime_control: {
          kill_switch_healthy: false,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: false,
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
      },
    },
    {
      prevalidatedRuntimeControl: true,
      async hydrateGovernedEditorialInventoryCandidates() {
        throw new Error("simulated inventory read failure");
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 1401, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.deepEqual(queued, []);
  assert.deepEqual(result.enqueued_jobs, []);
  const report = await fs.readJson(result.report_json);
  assert.equal(report.candidate_hydration.verdict, "HOLD");
  assert.equal(
    report.candidate_hydration.rejected[0].story_id,
    storyId,
  );
  assert.deepEqual(
    report.candidate_eligibility.eligible_candidates,
    [],
  );
  assert.equal(
    report.lanes.find(
      (lane) => lane.lane_id === "breaking_short",
    ).stage,
    "EMPTY",
  );
});

test("a rejected exact inventory cannot fall through to syntactically valid stale candidate evidence", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-inventory-rejection-bridge-"),
  );
  t.after(() => fs.remove(root));
  const fixture = buildReadyInventoryFixture(root);
  await fs.appendFile(
    fixture.rightsPath,
    "\nchanged after the inventory binding\n",
  );
  const queued = [];

  const result = await handlers.governed_multi_lane_plan(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: path.join(root, "planner-output"),
        candidates: [
          {
            lane_id: "breaking_short",
            story_id: fixture.storyId,
            title: "Candidate carrying stale persisted evidence",
            score: 100,
            stage: "PLANNING",
            governed_source_evidence: {
              verification_status: "CONFIRMED",
              verified_for_planning: true,
              primary_source_url: fixture.primarySourceUrl,
              source_evidence_sha256:
                fixture.sourcePacket.packet_sha256,
              path: fixture.sourcePath,
              file_sha256: fixture.sourceFileSha256,
            },
          },
        ],
        runtime_control: {
          kill_switch_healthy: false,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: false,
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
      },
    },
    {
      prevalidatedRuntimeControl: true,
      governedEditorialInventoryRoot: fixture.inventoryRoot,
      governedEditorialInventoryAllowedRoots: [
        fixture.outputRoot,
      ],
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 1501, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.deepEqual(queued, []);
  assert.deepEqual(result.enqueued_jobs, []);
  const report = await fs.readJson(result.report_json);
  assert.equal(report.candidate_hydration.verdict, "HOLD");
  assert.equal(
    report.candidate_hydration.rejected[0].story_id,
    fixture.storyId,
  );
  assert.ok(
    report.candidate_hydration.rejected[0].blockers.includes(
      "rights_ledger_file_sha256_mismatch",
    ),
  );
  assert.deepEqual(
    report.candidate_eligibility.eligible_candidates,
    [],
  );
});
