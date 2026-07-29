"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  DEFAULT_LANE_REGISTRY,
  DEFAULT_WORKER_POOLS,
  buildGovernedLaneRoutingPlan,
} = require("../../lib/services/multi-lane-job-routing");
const {
  buildMultiLaneWorkerDefinitions,
} = require("../../lib/services/multi-lane-worker-topology");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  createAutonomousEligibleCandidateFixture,
} = require("../helpers/autonomous-window-eligibility-fixture");

const NOW = "2026-07-28T12:00:00.000Z";
const AUTONOMOUS_AUTHORITY_TYPE =
  "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";

function greenRuntimeControl() {
  return {
    kill_switch_healthy: true,
    operating_contract_valid: true,
    scheduler_owner_healthy: true,
    autonomous_production_enabled: true,
    live_publish_enabled: true,
  };
}

function scheduledCandidate(laneId, storyId, eventId) {
  const scheduledFor = "2026-07-28T19:00:00.000Z";
  return {
    lane_id: laneId,
    story_id: storyId,
    stage: "SCHEDULED",
    score: 100,
    publication: {
      platform: "youtube",
      lifecycle_state: "SCHEDULED",
      scheduled_event_id: eventId,
      scheduled_for: scheduledFor,
      dispatch_idempotency_key:
        `youtube:${storyId}:${scheduledFor}`,
      request_fingerprint: String(eventId)
        .padStart(64, "a")
        .slice(-64),
      control_tower_verdict: "GREEN",
    },
  };
}

function autonomousAdmissionCandidate(storyId, overrides = {}) {
  return createAutonomousEligibleCandidateFixture({
    storyId,
    now: NOW,
    scheduledFor: "2026-07-28T19:00:00.000Z",
    candidateRevisionSha256: "8".repeat(64),
    requestFingerprint: "9".repeat(64),
    evidenceHashes: {
      source_evidence_sha256: "1".repeat(64),
      script_sha256: "2".repeat(64),
      media_sha256: "3".repeat(64),
      qa_report_sha256: "4".repeat(64),
      rights_ledger_sha256: "5".repeat(64),
    },
    candidateOverrides: overrides,
  });
}

test("routing pool IDs exactly match the physical isolated worker topology", () => {
  const handlers = Object.fromEntries(
    DEFAULT_LANE_REGISTRY.map((lane) => [
      lane.produce_kind,
      () => {},
    ]),
  );
  const physicalPoolByKind = Object.fromEntries(
    buildMultiLaneWorkerDefinitions({ handlers }).flatMap(
      (definition) =>
        definition.kinds.map((kind) => [
          kind,
          definition.pool_id,
        ]),
    ),
  );

  for (const lane of DEFAULT_LANE_REGISTRY) {
    assert.equal(
      lane.production_pool,
      physicalPoolByKind[lane.produce_kind],
    );
    assert.ok(DEFAULT_WORKER_POOLS[lane.production_pool]);
  }
});

test("a saturated longform production worker cannot block a critical breaking dispatch", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {
        longform_production: 1,
        critical_publication: 0,
      },
      inflight_by_lane: {
        weekly_longform: 1,
        breaking_short: 0,
      },
    },
    candidates: [
      scheduledCandidate("breaking_short", "breaking-urgent", 501),
      {
        lane_id: "weekly_longform",
        story_id: "longform-render",
        stage: "PRODUCTION_READY",
        score: 80,
      },
    ],
  });

  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  const longform = plan.lanes.find(
    (lane) => lane.lane_id === "weekly_longform",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(
    breaking.next_job.kind,
    "verify_governed_youtube_release_t0",
  );
  assert.equal(
    breaking.next_job.worker_pool,
    "critical_publication",
  );
  assert.equal(longform.verdict, "HOLD");
  assert.ok(longform.blockers.includes("lane_max_inflight_reached"));
  assert.ok(longform.blockers.includes("worker_pool_saturated"));
});

test("a saturated longform production worker cannot block critical breaking planning", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {
        longform_production: 1,
        critical_planning: 0,
      },
      inflight_by_lane: {
        weekly_longform: 1,
        breaking_short: 0,
      },
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-plan-now",
        stage: "PLANNING",
        score: 100,
      },
      {
        lane_id: "weekly_longform",
        story_id: "longform-still-rendering",
        stage: "PRODUCTION_READY",
        score: 70,
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(breaking.next_job.kind, "plan_breaking_short");
  assert.equal(
    breaking.next_job.worker_pool,
    "breaking_planning",
  );
  assert.equal(
    breaking.next_job.payload.publish_authority,
    false,
  );
  assert.equal(
    breaking.next_job.payload.human_review_required,
    true,
  );
});

test("an exact validated inventory candidate carries immutable source and rights refs into breaking planning without authority", () => {
  const storyId = "breaking-inventory-route";
  const sourceCanonical = "1".repeat(64);
  const sourceFile = "2".repeat(64);
  const rightsCanonical = "3".repeat(64);
  const rightsFile = "4".repeat(64);
  const inventoryCanonical = "5".repeat(64);
  const inventoryFile = "6".repeat(64);
  const publicationSourceFile = "7".repeat(64);
  const sourcePath =
    "D:/pulse-data/output/editorial-evidence/source.json";
  const rightsPath =
    "D:/pulse-data/output/editorial-inventory/rights.json";
  const inventoryPath =
    "D:/pulse-data/output/editorial-inventory/inventory.json";
  const publicationSourcePath =
    "D:/pulse-data/output/editorial-inventory/weekly-source-evidence.json";
  const publicationClaim =
    "Xbox confirms the exact player-facing change.";
  const publicationClaimSha256 = crypto
    .createHash("sha256")
    .update(publicationClaim)
    .digest("hex");
  const officialSourceReleaseBinding =
    buildOfficialSourceReleaseBinding({
      storyId,
      sourceEvidenceSha256: publicationSourceFile,
      sourceEvidence: {
        schema_version: "pulse-source-evidence-v1",
        story_id: storyId,
        source_url:
          "https://news.xbox.com/en-us/example/",
        source_type: "official",
        claims: [
          {
            claim_key: "player-change",
            text: publicationClaim,
            claim_text_sha256: publicationClaimSha256,
          },
        ],
        official_source_snapshot: {
          schema_version:
            "pulse-official-source-snapshot-v1",
          source_url:
            "https://news.xbox.com/en-us/example/",
          source_id: "xbox-wire",
          source_class: "OFFICIAL_FIRST_PARTY",
          canonical_body_algorithm:
            "pulse-readable-body-v1",
          canonical_body_sha256:
            publicationClaimSha256,
          claims: [
            {
              claim_key: "player-change",
              text: publicationClaim,
              claim_text_sha256: publicationClaimSha256,
            },
          ],
        },
      },
    });
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: storyId,
        stage: "PLANNING",
        score: 100,
        source_evidence_path: sourcePath,
        source_evidence_file_sha256: sourceFile,
        source_evidence_sha256: sourceCanonical,
        publication_source_evidence_path:
          publicationSourcePath,
        publication_source_evidence_file_sha256:
          publicationSourceFile,
        publication_source_evidence_sha256:
          publicationSourceFile,
        official_source_release_binding:
          officialSourceReleaseBinding,
        rights_ledger_path: rightsPath,
        rights_ledger_file_sha256: rightsFile,
        rights_ledger_canonical_sha256: rightsCanonical,
        rights_ledger_sha256: rightsCanonical,
        governed_editorial_inventory_bindings: {
          schema_version:
            "pulse-governed-editorial-inventory-planner-bindings-v1",
          story_id: storyId,
          inventory: {
            path: inventoryPath,
            file_sha256: inventoryFile,
            canonical_sha256: inventoryCanonical,
          },
          source_evidence: {
            path: sourcePath,
            file_sha256: sourceFile,
            canonical_sha256: sourceCanonical,
          },
          publication_source_evidence: {
            path: publicationSourcePath,
            file_sha256: publicationSourceFile,
            source_evidence_sha256:
              publicationSourceFile,
            official_source_release_binding:
              officialSourceReleaseBinding,
          },
          rights_ledger: {
            path: rightsPath,
            file_sha256: rightsFile,
            canonical_sha256: rightsCanonical,
          },
        },
      },
    ],
  });
  const job = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  ).next_job;

  assert.equal(job.kind, "plan_breaking_short");
  assert.deepEqual(job.payload.source_evidence_ref, {
    path: sourcePath,
    sha256: sourceFile,
    canonical_sha256: sourceCanonical,
    story_id: storyId,
    lane_id: "breaking_short",
  });
  assert.deepEqual(
    job.payload.publication_source_evidence_ref,
    {
      path: publicationSourcePath,
      sha256: publicationSourceFile,
      source_evidence_sha256:
        publicationSourceFile,
      story_id: storyId,
      lane_id: "breaking_short",
    },
  );
  assert.deepEqual(
    job.payload.official_source_release_binding,
    officialSourceReleaseBinding,
  );
  assert.notEqual(
    job.payload.source_evidence_ref.path,
    job.payload.publication_source_evidence_ref.path,
  );
  assert.deepEqual(job.payload.rights_ledger_ref, {
    path: rightsPath,
    sha256: rightsFile,
    canonical_sha256: rightsCanonical,
    story_id: storyId,
    lane_id: "breaking_short",
  });
  assert.deepEqual(
    job.payload.governed_editorial_inventory_ref,
    {
      path: inventoryPath,
      sha256: inventoryFile,
      canonical_sha256: inventoryCanonical,
      story_id: storyId,
      lane_id: "breaking_short",
    },
  );
  assert.equal(job.payload.source_evidence_sha256, sourceCanonical);
  assert.equal(
    job.payload.rights_ledger_canonical_sha256,
    rightsCanonical,
  );
  assert.equal(job.payload.publish_authority, false);
  assert.equal(job.payload.human_review_required, true);
  assert.equal(
    Object.keys(job.payload).some((field) =>
      /guarded.*authority|external_posting_authorised/.test(field),
    ),
    false,
  );
});

test("critical planning backlog cannot invert priority over the isolated breaking planning pool", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {
        critical_planning: 1,
        breaking_planning: 0,
      },
      inflight_by_lane: {},
      active_idempotency_keys: [],
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-priority-isolated",
        stage: "PLANNING",
        score: 100,
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(breaking.next_job.kind, "plan_breaking_short");
  assert.equal(
    breaking.next_job.worker_pool,
    "breaking_planning",
  );
});

test("a lane will not enqueue the same idempotent job twice", () => {
  const input = {
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {},
      inflight_by_lane: {},
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-deduplicated",
        stage: "PRODUCTION_READY",
        score: 90,
      },
    ],
  };
  const first = buildGovernedLaneRoutingPlan(input);
  const firstBreaking = first.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  const key = firstBreaking.next_job.idempotency_key;

  const repeated = buildGovernedLaneRoutingPlan({
    ...input,
    queueState: {
      ...input.queueState,
      active_idempotency_keys: [key],
    },
  });
  const repeatedBreaking = repeated.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.match(
    key,
    /^produce:breaking_short:breaking-deduplicated:[a-f0-9]{64}$/,
  );
  assert.equal(repeatedBreaking.verdict, "HOLD");
  assert.ok(
    repeatedBreaking.blockers.includes(
      "idempotent_job_already_active",
    ),
  );
  assert.equal(repeatedBreaking.next_job, null);
  assert.equal(repeatedBreaking.existing_job_key, key);
});

test("unchanged candidate evidence dedupes but a changed immutable revision receives a new route key", () => {
  const candidate = {
    lane_id: "evergreen_short",
    story_id: "evergreen-revision",
    stage: "PLANNING",
    score: 90,
    source_evidence_sha256: "1".repeat(64),
    script_sha256: "2".repeat(64),
    media_sha256: "3".repeat(64),
    rights_ledger_sha256: "4".repeat(64),
    pitch_sha256: "5".repeat(64),
    work_order_sha256: "6".repeat(64),
  };
  const input = {
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {},
      inflight_by_lane: {},
      active_idempotency_keys: [],
    },
    candidates: [candidate],
  };
  const first = buildGovernedLaneRoutingPlan(input);
  const firstEvergreen = first.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );
  const firstKey = firstEvergreen.next_job.idempotency_key;

  const unchanged = buildGovernedLaneRoutingPlan({
    ...input,
    queueState: {
      ...input.queueState,
      active_idempotency_keys: [firstKey],
    },
  }).lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );
  assert.equal(unchanged.verdict, "HOLD");
  assert.equal(unchanged.existing_job_key, firstKey);

  const changed = buildGovernedLaneRoutingPlan({
    ...input,
    queueState: {
      ...input.queueState,
      active_idempotency_keys: [firstKey],
    },
    candidates: [
      {
        ...candidate,
        source_evidence_sha256: "a".repeat(64),
      },
    ],
  }).lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );

  assert.equal(changed.verdict, "GREEN");
  assert.notEqual(changed.next_job.idempotency_key, firstKey);
  assert.match(
    changed.next_job.idempotency_key,
    /^plan:evergreen_short:evergreen-revision:[a-f0-9]{64}$/,
  );
  assert.match(
    changed.next_job.payload.candidate_revision_sha256,
    /^[a-f0-9]{64}$/,
  );
});

test("max inflight is enforced per content lane rather than across all Shorts", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {},
      inflight_by_lane: {
        breaking_short: 0,
        evergreen_short: 1,
      },
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-capacity",
        stage: "PRODUCTION_READY",
        score: 95,
      },
      {
        lane_id: "evergreen_short",
        story_id: "evergreen-capacity",
        stage: "PRODUCTION_READY",
        score: 85,
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  const evergreen = plan.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(
    breaking.next_job.worker_pool,
    "breaking_production",
  );
  assert.equal(
    breaking.next_job.payload.publish_authority,
    false,
  );
  assert.equal(
    breaking.next_job.payload.human_review_required,
    true,
  );
  assert.equal(evergreen.verdict, "HOLD");
  assert.ok(evergreen.blockers.includes("lane_max_inflight_reached"));
  assert.notEqual(
    breaking.production_pool,
    evergreen.production_pool,
  );
});

test("human-approved work is admitted through the critical pool and no route emits a generic publish job", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    queueState: {
      inflight_by_pool: {},
      inflight_by_lane: {},
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-admission",
        stage: "HUMAN_APPROVED",
        score: 100,
        admission: {
          human_review_status: "approved",
          actor_id: "operator-001",
          reason: "Exact reviewed video approved",
          confirmation_story_id: "breaking-admission",
          scheduled_for: "2026-07-28T19:00:00.000Z",
          evidence: {
            source_evidence_sha256: "1".repeat(64),
          },
        },
      },
      {
        lane_id: "evergreen_short",
        story_id: "evergreen-production",
        stage: "PRODUCTION_READY",
        score: 80,
      },
      scheduledCandidate(
        "weekly_longform",
        "longform-dispatch",
        702,
      ),
    ],
  });
  const jobs = plan.lanes.map((lane) => lane.next_job);
  const admission = jobs.find(
    (job) => job.kind === "admit_governed_publication",
  );

  assert.deepEqual(admission, {
    kind: "admit_governed_publication",
    worker_pool: "critical_publication",
    idempotency_key: admission.idempotency_key,
    run_at: "2026-07-28T17:45:00.000Z",
    payload: {
      lane_id: "breaking_short",
      story_id: "breaking-admission",
      platform: "youtube",
      human_admission_required: true,
      guarded_admission_authority: true,
      candidate_revision_sha256:
        admission.payload.candidate_revision_sha256,
      candidate_revision: {
        schema_version:
          "pulse-multi-lane-candidate-revision-v1",
        stage: "HUMAN_APPROVED",
        source_evidence_sha256: "1".repeat(64),
        publication_source_evidence_sha256:
          "1".repeat(64),
        script_sha256: null,
        media_sha256: null,
        rights_ledger_sha256: null,
        pitch_sha256: null,
        work_order_sha256: null,
        admission_sha256:
          admission.payload.candidate_revision
            .admission_sha256,
      },
      admission: {
        human_review_status: "approved",
        actor_id: "operator-001",
        reason: "Exact reviewed video approved",
        confirmation_story_id: "breaking-admission",
        scheduled_for: "2026-07-28T19:00:00.000Z",
        evidence: {
          source_evidence_sha256: "1".repeat(64),
        },
      },
    },
  });
  assert.match(
    admission.idempotency_key,
    /^admit:youtube:breaking_short:breaking-admission:[a-f0-9]{64}:2026-07-28T19:00:00\.000Z$/,
  );
  assert.equal(jobs.some((job) => job.kind === "publish"), false);
  assert.deepEqual(
    new Set(jobs.map((job) => job.kind)),
    new Set([
      "admit_governed_publication",
      "produce_evergreen_short",
      "verify_governed_youtube_release_t0",
    ]),
  );
});

test("an explicitly autonomous official-source approval routes only to guarded admission without human review", () => {
  const candidate = autonomousAdmissionCandidate(
    "breaking-autonomous-admission",
  );
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [candidate],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(
    breaking.next_job.kind,
    "admit_governed_publication",
  );
  assert.equal(
    breaking.next_job.worker_pool,
    "critical_publication",
  );
  assert.equal(
    breaking.next_job.run_at,
    "2026-07-28T17:45:00.000Z",
  );
  assert.equal(
    breaking.next_job.payload.human_admission_required,
    false,
  );
  assert.equal(
    breaking.next_job.payload.guarded_admission_authority,
    true,
  );
  assert.equal(
    breaking.next_job.payload.candidate_revision.stage,
    "AUTONOMOUS_ELIGIBLE",
  );
  assert.equal(
    breaking.next_job.payload.admission.approval_type,
    AUTONOMOUS_AUTHORITY_TYPE,
  );
  assert.equal(
    breaking.next_job.payload.admission
      .autonomous_eligibility_attestation_sha256,
    candidate.admission
      .autonomous_eligibility_attestation_sha256,
  );
  assert.equal(
    breaking.next_job.payload.admission
      .jit_preparation_sha256,
    candidate.admission.jit_preparation_sha256,
  );
  assert.equal(
    breaking.next_job.payload.admission
      .autonomous_window_eligibility_attestation
      .attestation_scope,
    "WINDOW_ELIGIBILITY_ONLY",
  );
  assert.equal(
    breaking.next_job.payload
      .autonomous_jit_materialisation_required,
    true,
  );
  assert.equal(
    Object.hasOwn(
      breaking.next_job.payload.admission,
      "autonomous_publication_authority",
    ),
    false,
  );
  assert.equal(
    breaking.next_job.payload.publish_authority,
    false,
  );
  assert.equal(
    breaking.next_job.payload.external_posting,
    false,
  );
});

test("autonomous routing rejects stale, mismatched, dispatch-authorised and human-conflated packets", () => {
  const base = autonomousAdmissionCandidate(
    "breaking-autonomous-rejections",
  );
  const stale =
    createAutonomousEligibleCandidateFixture({
      storyId: "breaking-autonomous-rejections",
      now: "2026-07-28T11:58:00.000Z",
      validUntil: "2026-07-28T11:59:00.000Z",
      scheduledFor: "2026-07-28T19:00:00.000Z",
      candidateRevisionSha256: "8".repeat(64),
      requestFingerprint: "9".repeat(64),
      evidenceHashes: {
        source_evidence_sha256: "1".repeat(64),
        script_sha256: "2".repeat(64),
        media_sha256: "3".repeat(64),
        qa_report_sha256: "4".repeat(64),
        rights_ledger_sha256: "5".repeat(64),
      },
    });
  const cases = [
    {
      candidate: stale,
      blocker: "autonomous_window_eligibility_stale",
    },
    {
      candidate: {
        ...structuredClone(base),
        request_fingerprint: "0".repeat(64),
      },
      blocker:
        "exact_autonomous_jit_preparation_binding_mismatch",
    },
    {
      candidate: {
        ...structuredClone(base),
        admission: {
          ...structuredClone(base.admission),
          autonomous_publication_authority: {
            dispatch_authorised: true,
          },
        },
      },
      blocker:
        "preissued_autonomous_publication_authority_forbidden",
    },
    {
      candidate: {
        ...structuredClone(base),
        admission: {
          ...structuredClone(base.admission),
          human_review_status: "approved",
          actor_id: "operator-should-not-be-here",
        },
      },
      blocker: "autonomous_human_approval_cross_conflation",
    },
    {
      candidate: {
        ...structuredClone(base),
        human_review_audit_id: 42,
      },
      blocker: "autonomous_human_approval_cross_conflation",
    },
  ];

  for (const { candidate, blocker } of cases) {
    const plan = buildGovernedLaneRoutingPlan({
      now: NOW,
      runtimeControl: greenRuntimeControl(),
      candidates: [candidate],
    });
    const breaking = plan.lanes.find(
      (lane) => lane.lane_id === "breaking_short",
    );
    assert.equal(breaking.verdict, "HOLD");
    assert.equal(breaking.next_job, null);
    assert.ok(
      breaking.blockers.includes(blocker),
      `${blocker} was not reported: ${breaking.blockers.join(
        ", ",
      )}`,
    );
  }

  const humanStageWithAutonomousPacket = {
    ...structuredClone(base),
    stage: "HUMAN_APPROVED",
  };
  const conflated = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [humanStageWithAutonomousPacket],
  }).lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(conflated.verdict, "HOLD");
  assert.ok(
    conflated.blockers.includes(
      "human_autonomous_approval_cross_conflation",
    ),
  );
});

test("admission idempotency binds the exact schedule and approval packet", () => {
  const baseCandidate = {
    lane_id: "breaking_short",
    story_id: "breaking-admission-revision",
    stage: "HUMAN_APPROVED",
    score: 100,
    admission: {
      human_review_status: "approved",
      actor_id: "operator-001",
      reason: "Reviewed exact video",
      confirmation_story_id: "breaking-admission-revision",
      scheduled_for: "2026-07-28T19:00:00.000Z",
      evidence: {
        source_evidence_sha256: "1".repeat(64),
      },
    },
  };
  const plan = (candidate) =>
    buildGovernedLaneRoutingPlan({
      now: NOW,
      runtimeControl: greenRuntimeControl(),
      candidates: [candidate],
    }).lanes.find(
      (lane) => lane.lane_id === "breaking_short",
    ).next_job;

  const first = plan(baseCandidate);
  const changedSchedule = plan({
    ...baseCandidate,
    admission: {
      ...baseCandidate.admission,
      scheduled_for: "2026-07-29T09:00:00.000Z",
    },
  });
  const changedApproval = plan({
    ...baseCandidate,
    admission: {
      ...baseCandidate.admission,
      reason: "Reviewed repaired exact video",
    },
  });

  assert.notEqual(
    first.idempotency_key,
    changedSchedule.idempotency_key,
  );
  assert.equal(
    first.idempotency_key.endsWith(
      ":2026-07-28T19:00:00.000Z",
    ),
    true,
  );
  assert.equal(
    changedSchedule.idempotency_key.endsWith(
      ":2026-07-29T09:00:00.000Z",
    ),
    true,
  );
  assert.notEqual(
    first.idempotency_key,
    changedApproval.idempotency_key,
  );
  assert.notEqual(
    first.payload.candidate_revision.admission_sha256,
    changedSchedule.payload.candidate_revision.admission_sha256,
  );
  assert.equal(
    changedSchedule.run_at,
    "2026-07-29T07:45:00.000Z",
  );
});

test("publication jobs wake durably at T-75 admission and exact T0 public verification", () => {
  const admissionPlan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-durable-admission",
        stage: "HUMAN_APPROVED",
        score: 100,
        admission: {
          human_review_status: "approved",
          actor_id: "operator-001",
          reason: "Exact reviewed video approved",
          confirmation_story_id: "breaking-durable-admission",
          scheduled_for: "2026-07-28T19:00:00.000Z",
          evidence: {
            source_evidence_sha256: "1".repeat(64),
          },
        },
      },
    ],
  });
  const admission = admissionPlan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  ).next_job;
  assert.equal(admission.kind, "admit_governed_publication");
  assert.equal(admission.run_at, "2026-07-28T17:45:00.000Z");
  assert.equal(
    admission.payload.admission.scheduled_for,
    "2026-07-28T19:00:00.000Z",
  );

  const dispatchPlan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [
      scheduledCandidate(
        "breaking_short",
        "breaking-durable-dispatch",
        908,
      ),
    ],
  });
  const dispatch = dispatchPlan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  ).next_job;
  assert.equal(
    dispatch.kind,
    "verify_governed_youtube_release_t0",
  );
  assert.equal(dispatch.run_at, "2026-07-28T19:00:00.000Z");
  assert.equal(
    dispatch.payload.scheduled_for,
    "2026-07-28T19:00:00.000Z",
  );
});

test("publication routing refuses non-guarded windows and never catches up past T-75 or T0", () => {
  const outside = scheduledCandidate(
    "breaking_short",
    "breaking-outside-window",
    909,
  );
  outside.publication.scheduled_for =
    "2026-07-28T14:00:00.000Z";

  const outsidePlan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [outside],
  });
  const outsideLane = outsidePlan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(outsideLane.verdict, "HOLD");
  assert.ok(
    outsideLane.blockers.includes(
      "scheduled_time_outside_guarded_youtube_windows",
    ),
  );
  assert.equal(outsideLane.next_job, null);

  const expiredAdmission = buildGovernedLaneRoutingPlan({
    now: "2026-07-28T17:45:00.001Z",
    runtimeControl: greenRuntimeControl(),
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-expired-admission",
        stage: "HUMAN_APPROVED",
        score: 100,
        admission: {
          human_review_status: "approved",
          actor_id: "operator-001",
          reason: "Exact reviewed video approved",
          confirmation_story_id: "breaking-expired-admission",
          scheduled_for: "2026-07-28T19:00:00.000Z",
          evidence: {},
        },
      },
    ],
  }).lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(expiredAdmission.verdict, "HOLD");
  assert.ok(
    expiredAdmission.blockers.includes(
      "admission_wakeup_expired_no_catch_up",
    ),
  );
  assert.equal(expiredAdmission.next_job, null);

  const expiredDispatch = buildGovernedLaneRoutingPlan({
    now: "2026-07-28T19:00:00.001Z",
    runtimeControl: greenRuntimeControl(),
    candidates: [
      scheduledCandidate(
        "breaking_short",
        "breaking-expired-dispatch",
        910,
      ),
    ],
  }).lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(expiredDispatch.verdict, "HOLD");
  assert.ok(
    expiredDispatch.blockers.includes(
      "scheduled_window_expired_no_catch_up",
    ),
  );
  assert.equal(expiredDispatch.next_job, null);
});

test("the public worker topology reserves publication capacity away from production pools", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
  });

  assert.deepEqual(
    plan.worker_pools.breaking_planning.accepts,
    ["breaking_story_discovery", "plan_breaking_short"],
  );
  assert.equal(
    plan.worker_pools.critical_planning.accepts.includes(
      "plan_breaking_short",
    ),
    false,
  );
  assert.deepEqual(
    plan.worker_pools.critical_publication.accepts,
    [
      "admit_governed_publication",
      "prestage_governed_youtube_release",
      "verify_governed_youtube_release_tminus15",
      "verify_governed_youtube_release_t0",
    ],
  );
  assert.deepEqual(
    plan.worker_pools.longform_production.accepts,
    ["produce_weekly_longform"],
  );
  assert.equal(
    plan.worker_pools.longform_production.accepts.includes(
      "dispatch_governed_publication",
    ),
    false,
  );
  assert.equal(
    Object.values(plan.worker_pools)
      .flatMap((pool) => pool.accepts)
      .includes("publish"),
    false,
  );
});

test("a tripped publication kill switch holds admission while safe planning keeps running", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: {
      ...greenRuntimeControl(),
      kill_switch_healthy: false,
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-held",
        stage: "HUMAN_APPROVED",
        score: 100,
      },
      {
        lane_id: "evergreen_short",
        story_id: "evergreen-safe-planning",
        stage: "PLANNING",
        score: 80,
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  const evergreen = plan.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );

  assert.equal(plan.verdict, "GREEN");
  assert.deepEqual(plan.global_blockers, []);
  assert.equal(breaking.verdict, "HOLD");
  assert.ok(
    breaking.blockers.includes("global_kill_switch_not_healthy"),
  );
  assert.equal(breaking.next_job, null);
  assert.equal(evergreen.verdict, "GREEN");
  assert.equal(evergreen.next_job.kind, "plan_evergreen_short");
});

test("a scheduled candidate without an exact immutable binding cannot route to dispatch", () => {
  const candidate = scheduledCandidate(
    "breaking_short",
    "breaking-invalid-binding",
    901,
  );
  delete candidate.publication.request_fingerprint;

  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [candidate],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "HOLD");
  assert.ok(
    breaking.blockers.includes(
      "scheduled_request_fingerprint_invalid",
    ),
  );
  assert.equal(breaking.next_job, null);
});

test("publication remains held when the planner has no explicit live guarded authority", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: {
      ...greenRuntimeControl(),
      live_publish_enabled: false,
    },
    candidates: [
      scheduledCandidate(
        "breaking_short",
        "breaking-live-arm-held",
        902,
      ),
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "HOLD");
  assert.ok(breaking.blockers.includes("live_publish_not_enabled"));
  assert.equal(breaking.next_job, null);
});

test("QA alone cannot auto-admit and exact human admission evidence is required", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-qa-only",
        stage: "QA_PASSED",
        score: 100,
      },
      {
        lane_id: "evergreen_short",
        story_id: "evergreen-human-no-packet",
        stage: "HUMAN_APPROVED",
        score: 90,
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  const evergreen = plan.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );

  assert.equal(breaking.verdict, "HOLD");
  assert.ok(
    breaking.blockers.includes(
      "human_review_required_before_admission",
    ),
  );
  assert.equal(evergreen.verdict, "HOLD");
  assert.ok(
    evergreen.blockers.includes(
      "exact_human_admission_packet_required",
    ),
  );
});

test("human admission stays held when persisted approval evidence does not bind the current candidate hashes", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: greenRuntimeControl(),
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-stale-approval",
        stage: "HUMAN_APPROVED",
        score: 100,
        source_evidence_sha256: "a".repeat(64),
        script_sha256: "b".repeat(64),
        media_sha256: "c".repeat(64),
        rights_ledger_sha256: "d".repeat(64),
        admission: {
          human_review_status: "approved",
          actor_id: "operator-004",
          reason: "Approved a prior candidate revision",
          confirmation_story_id: "breaking-stale-approval",
          scheduled_for: "2026-07-28T19:00:00.000Z",
          evidence: {
            source_evidence_sha256: "1".repeat(64),
            script_sha256: "2".repeat(64),
            media_sha256: "3".repeat(64),
            rights_ledger_sha256: "4".repeat(64),
          },
        },
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "HOLD");
  assert.deepEqual(breaking.blockers, [
    "exact_human_source_evidence_sha256_mismatch",
    "exact_human_script_sha256_mismatch",
    "exact_human_media_sha256_mismatch",
    "exact_human_rights_ledger_sha256_mismatch",
  ]);
  assert.equal(breaking.next_job, null);
});

test("a held higher-score publication candidate is surfaced while the highest-score independently routable production candidate continues in the same lane", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: {
      ...greenRuntimeControl(),
      kill_switch_healthy: false,
      live_publish_enabled: false,
    },
    queueState: {
      inflight_by_pool: {},
      inflight_by_lane: {},
      active_idempotency_keys: [],
    },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-reviewed-held",
        stage: "HUMAN_APPROVED",
        score: 150,
        admission: {
          human_review_status: "approved",
          actor_id: "operator-003",
          reason: "Approved exact render",
          confirmation_story_id: "breaking-reviewed-held",
          scheduled_for: "2026-07-28T19:00:00.000Z",
          evidence: {
            source_evidence_sha256: "1".repeat(64),
          },
        },
      },
      {
        lane_id: "breaking_short",
        story_id: "breaking-production-routable",
        stage: "PRODUCTION_READY",
        score: 120,
      },
      {
        lane_id: "breaking_short",
        story_id: "breaking-planning-lower",
        stage: "PLANNING",
        score: 90,
      },
    ],
  });
  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(
    breaking.candidate.story_id,
    "breaking-production-routable",
  );
  assert.equal(
    breaking.next_job.payload.story_id,
    "breaking-production-routable",
  );
  assert.equal(breaking.next_job.kind, "produce_breaking_short");
  assert.deepEqual(breaking.held_candidates, [
    {
      story_id: "breaking-reviewed-held",
      stage: "HUMAN_APPROVED",
      score: 150,
      blockers: [
        "global_kill_switch_not_healthy",
        "live_publish_not_enabled",
      ],
    },
  ]);
});
