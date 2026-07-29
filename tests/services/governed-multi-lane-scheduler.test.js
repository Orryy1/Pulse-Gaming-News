"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  buildGovernedMultiLanePlan,
} = require("../../lib/services/governed-multi-lane-plan");
const {
  buildGovernedLaneRoutingPlan,
} = require("../../lib/services/multi-lane-job-routing");
const { handlers } = require("../../lib/job-handlers");
const {
  STABILISATION_SCHEDULER_PROFILE,
  schedulesForProfile,
} = require("../../lib/scheduler");

const NOW = "2026-07-28T12:00:00.000Z";

function scheduledCandidate(laneId, storyId, eventId, scheduledFor) {
  return {
    lane_id: laneId,
    story_id: storyId,
    title: `${laneId} candidate`,
    score: 90,
    stage: "SCHEDULED",
    publication: {
      platform: "youtube",
      lifecycle_state: "SCHEDULED",
      scheduled_event_id: eventId,
      scheduled_for: scheduledFor,
      dispatch_idempotency_key: `youtube:${storyId}:${scheduledFor}`,
      request_fingerprint: String(eventId).padStart(64, "a").slice(-64),
      control_tower_verdict: "GREEN",
    },
  };
}

async function runDbDerivedUrgentStoryPlanner(
  t,
  { storyId, title, fullScript, outPrefix, extra = {} },
) {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), outPrefix),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return {
          all() {
            return [
              {
                id: storyId,
                title,
                breaking_score: 100,
                score: 90,
                full_script: fullScript,
                published_at: "2026-07-28T11:00:00.000Z",
                created_at: "2026-07-28T11:00:00.000Z",
                youtube_post_id: "",
                publish_status: "",
                _extra: JSON.stringify({
                  breaking_fast_track: true,
                  ...extra,
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
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
        breaking_story_id: storyId,
        verification_status: "CONFIRMED",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/confirmed-update/",
        source_evidence_sha256: "1".repeat(64),
        source_evidence_path:
          `D:/pulse-data/evidence/${storyId}.json`,
        source_evidence_file_sha256: "2".repeat(64),
      },
    },
    {
      prevalidatedRuntimeControl: true,
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 983, ...input };
          },
        },
      },
      log() {},
    },
  );
  return {
    queued,
    report: await fs.readJson(result.report_json),
  };
}

test("three lanes receive independent budgets and exact dispatch jobs with breaking first", () => {
  const plan = buildGovernedMultiLanePlan({
    now: NOW,
    runtimeControl: {
      kill_switch_healthy: true,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
      autonomous_production_enabled: true,
      live_publish_enabled: true,
    },
    queueState: { inflight_by_worker_class: {} },
    candidates: [
      scheduledCandidate(
        "weekly_longform",
        "longform-001",
        103,
        "2026-08-02T14:00:00.000Z",
      ),
      scheduledCandidate(
        "evergreen_short",
        "evergreen-001",
        102,
        "2026-07-31T19:00:00.000Z",
      ),
      scheduledCandidate(
        "breaking_short",
        "breaking-001",
        101,
        "2026-07-28T19:00:00.000Z",
      ),
    ],
  });

  assert.equal(plan.schema_version, "pulse-governed-multi-lane-plan-v1");
  assert.equal(plan.verdict, "GREEN");
  assert.deepEqual(
    plan.lanes.map((lane) => lane.lane_id),
    ["breaking_short", "evergreen_short", "weekly_longform"],
  );
  assert.deepEqual(
    plan.lanes.map((lane) => lane.priority),
    [100, 60, 40],
  );
  assert.deepEqual(
    plan.lanes.map((lane) => lane.candidate.story_id),
    ["breaking-001", "evergreen-001", "longform-001"],
  );
  assert.ok(
    plan.lanes.every(
      (lane) =>
        lane.jobs.next.kind === "dispatch_governed_publication" &&
        lane.jobs.next.payload.scheduled_event_id > 0,
    ),
  );
  assert.equal(
    plan.lanes.some((lane) => lane.jobs.next.kind === "publish"),
    false,
  );
  assert.notEqual(
    plan.lanes[0].worker_class,
    plan.lanes[2].worker_class,
  );
  assert.deepEqual(plan.worker_topology, {
    breaking_planning: { concurrency: 2 },
    critical_planning: { concurrency: 1 },
    editorial_evidence_capture: { concurrency: 2 },
    editorial_preparation: { concurrency: 1 },
    governed_review: { concurrency: 2 },
    critical_publication: { concurrency: 2 },
    breaking_production: { concurrency: 2 },
    evergreen_production: { concurrency: 1 },
    longform_production: { concurrency: 1 },
    general_production: { concurrency: 1 },
    maintenance: { concurrency: 1 },
  });
});

test("a saturated longform worker cannot hold the critical breaking lane", () => {
  const plan = buildGovernedMultiLanePlan({
    now: NOW,
    runtimeControl: {
      kill_switch_healthy: true,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
      autonomous_production_enabled: true,
      live_publish_enabled: true,
    },
    queueState: {
      inflight_by_worker_class: {
        longform_production: 1,
      },
    },
    candidates: [
      scheduledCandidate(
        "breaking_short",
        "breaking-urgent",
        201,
        "2026-07-28T19:00:00.000Z",
      ),
      scheduledCandidate(
        "weekly_longform",
        "longform-rendering",
        202,
        "2026-08-02T14:00:00.000Z",
      ),
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
    breaking.jobs.next.kind,
    "dispatch_governed_publication",
  );
  assert.equal(longform.verdict, "HOLD");
  assert.ok(longform.blockers.includes("lane_capacity_reached"));
});

test("a tripped publication kill switch still allows safe production planning but blocks admission and dispatch", () => {
  const plan = buildGovernedMultiLanePlan({
    now: NOW,
    runtimeControl: {
      kill_switch_healthy: false,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
      autonomous_production_enabled: true,
    },
    queueState: { inflight_by_worker_class: {} },
    candidates: [
      {
        lane_id: "breaking_short",
        story_id: "breaking-plan-only",
        title: "Verified breaking candidate",
        score: 99,
        stage: "PLANNING",
      },
      scheduledCandidate(
        "evergreen_short",
        "evergreen-dispatch-held",
        203,
        "2026-07-31T19:00:00.000Z",
      ),
    ],
  });

  const breaking = plan.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  const evergreen = plan.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );

  assert.equal(breaking.verdict, "GREEN");
  assert.equal(breaking.jobs.next.kind, "plan_breaking_short");
  assert.equal(evergreen.verdict, "HOLD");
  assert.ok(
    evergreen.blockers.includes("global_kill_switch_not_healthy"),
  );
  assert.equal(evergreen.jobs.next, null);
  assert.equal(plan.safety.production_continues_when_publish_held, true);
});

test("stabilisation schedules the multi-lane planner without granting publish authority", () => {
  const schedule = schedulesForProfile(
    STABILISATION_SCHEDULER_PROFILE,
  ).find((entry) => entry.name === "governed_multi_lane_plan");

  assert.ok(schedule);
  assert.equal(schedule.kind, "governed_multi_lane_plan");
  assert.equal(schedule.cron_expr, "*/15 * * * *");
  assert.equal(schedule.payload.live_publish_enabled, false);
  assert.equal(schedule.payload.human_admission_required, true);
});

test("scheduled planner writes machine-readable evidence and never posts", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-plan-"),
  );
  t.after(() => fs.remove(outDir));

  const result = await handlers.governed_multi_lane_plan(
    {
      payload: {
        now: NOW,
        out_dir: outDir,
        runtime_control: {
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
        },
        queue_state: { inflight_by_worker_class: {} },
        candidates: [
          scheduledCandidate(
            "breaking_short",
            "breaking-proof",
            301,
            "2026-07-28T19:00:00.000Z",
          ),
        ],
      },
    },
    {
      log() {},
      prevalidatedRuntimeControl: true,
      prevalidatedMultiLaneCandidates: true,
    },
  );

  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
  assert.equal(await fs.pathExists(result.report_json), true);
  assert.equal(await fs.pathExists(result.report_markdown), true);
  const report = await fs.readJson(result.report_json);
  assert.equal(report.schema_version, "pulse-governed-multi-lane-plan-v1");
  assert.equal(report.safety.live_publish_enabled, false);
});

test("scheduled planner routes a GREEN lane into its exact registered handler without generic publishing", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-route-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];

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
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
        breaking_story_id: "breaking-route-proof",
        verification_status: "CONFIRMED",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/example/",
        source_evidence_sha256: "f".repeat(64),
        source_evidence_path:
          "D:/pulse-data/evidence/breaking-route-proof.json",
        source_evidence_file_sha256: "e".repeat(64),
        candidates: [
          {
            lane_id: "breaking_short",
            story_id: "breaking-route-proof",
            title: "A verified breaking story",
            score: 140,
            stage: "PLANNING",
          },
        ],
      },
    },
    {
      prevalidatedRuntimeControl: true,
      prevalidatedMultiLaneCandidates: true,
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 801, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.no_publish, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "plan_breaking_short");
  assert.equal(queued[0].story_id, "breaking-route-proof");
  assert.equal(
    queued[0].payload.worker_pool,
    "breaking_planning",
  );
  assert.equal(
    queued[0].payload.verification_status,
    "CONFIRMED",
  );
  assert.equal(
    queued[0].payload.primary_source_url,
    "https://news.xbox.com/en-us/2026/07/28/example/",
  );
  assert.equal(
    queued[0].payload.source_evidence_sha256,
    "f".repeat(64),
  );
  assert.equal(
    queued[0].payload.candidate_revision.source_evidence_sha256,
    "f".repeat(64),
  );
  assert.match(
    queued[0].idempotency_key,
    /^plan:breaking_short:breaking-route-proof:[a-f0-9]{64}$/,
  );
  assert.equal(
    queued.some((item) => item.kind === "publish"),
    false,
  );

  const report = await fs.readJson(result.report_json);
  assert.equal(
    report.routing.schema_version,
    "pulse-multi-lane-job-routing-v1",
  );
  assert.deepEqual(report.enqueued_jobs, [
    {
      id: 801,
      kind: "plan_breaking_short",
      lane_id: "breaking_short",
      story_id: "breaking-route-proof",
      worker_pool: "breaking_planning",
    },
  ]);
  assert.equal(report.safety.live_publish_enabled, false);
});

test("scheduled planner preserves durable T0 run_at when enqueueing exact dispatch", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-dispatch-run-at-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const scheduledFor = "2026-07-28T19:00:00.000Z";

  await handlers.governed_multi_lane_plan(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        runtime_control: {
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: true,
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
        candidates: [
          scheduledCandidate(
            "breaking_short",
            "breaking-dispatch-run-at",
            811,
            scheduledFor,
          ),
        ],
      },
    },
    {
      prevalidatedRuntimeControl: true,
      prevalidatedMultiLaneCandidates: true,
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 811, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "verify_governed_youtube_release_t0");
  assert.equal(queued[0].run_at, scheduledFor);
  assert.equal(queued[0].payload.scheduled_for, scheduledFor);
});

test("scheduled planner honours active idempotency keys and emits no duplicate lane job", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-dedupe-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const candidate = {
    lane_id: "breaking_short",
    story_id: "breaking-route-existing",
    title: "Already queued",
    score: 120,
    stage: "PLANNING",
  };
  const key = buildGovernedLaneRoutingPlan({
    now: NOW,
    runtimeControl: {
      kill_switch_healthy: true,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
      autonomous_production_enabled: true,
    },
    candidates: [candidate],
  }).lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  ).next_job.idempotency_key;

  const result = await handlers.governed_multi_lane_plan(
    {
      payload: {
        now: NOW,
        out_dir: outDir,
        runtime_control: {
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [key],
        },
        candidates: [candidate],
      },
    },
    {
      prevalidatedRuntimeControl: true,
      prevalidatedMultiLaneCandidates: true,
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return input;
          },
        },
      },
    },
  );

  assert.equal(queued.length, 0);
  const report = await fs.readJson(result.report_json);
  const breaking = report.routing.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(breaking.verdict, "HOLD");
  assert.equal(breaking.existing_job_key, key);
  assert.ok(
    breaking.blockers.includes("idempotent_job_already_active"),
  );
});

test("DB collection excludes a stale raw-script distractor and routes only the exact evidence-bound urgent target", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-db-eligibility-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return {
          all() {
            return [
              {
                id: "reddit-temu-stale",
                title: "I got a 4TB external drive off Temu",
                breaking_score: 99999,
                score: 99999,
                full_script: "An arbitrary old raw script.",
                published_at: "2026-05-19T09:00:00.000Z",
                created_at: "2026-05-19T09:00:00.000Z",
                youtube_post_id: "",
                publish_status: "",
                _extra: JSON.stringify({
                  breaking_fast_track: true,
                }),
              },
              {
                id: "rss_5efb04ad7c4889e1",
                title:
                  "4 Xbox Classics Hit PC, Achievements Come Later",
                breaking_score: 80,
                score: 50,
                full_script: "A governed urgent script.",
                published_at: "2026-07-22T10:00:00.000Z",
                created_at: "2026-07-22T10:00:00.000Z",
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
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
        breaking_story_id: "rss_5efb04ad7c4889e1",
        verification_status: "CONFIRMED",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/22/xbox-backward-compatibility-on-pc/",
        source_evidence_sha256: "a".repeat(64),
        source_evidence_path:
          "D:/pulse-data/evidence/xbox-back-compat.json",
        source_evidence_file_sha256: "b".repeat(64),
      },
    },
    {
      prevalidatedRuntimeControl: true,
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 980, ...input };
          },
        },
      },
    },
  );

  assert.equal(queued.length, 1);
  assert.equal(queued[0].story_id, "rss_5efb04ad7c4889e1");
  assert.equal(queued[0].kind, "produce_breaking_short");
  assert.equal(
    queued.some(
      (job) => job.story_id === "reddit-temu-stale",
    ),
    false,
  );
  const report = await fs.readJson(result.report_json);
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .story_id,
    "rss_5efb04ad7c4889e1",
  );
  assert.ok(
    report.candidate_eligibility.rejected_candidates.some(
      (candidate) =>
        candidate.story_id === "reddit-temu-stale" &&
        candidate.blockers.includes(
          "breaking_story_outside_current_window",
        ),
    ),
  );
});

test("DB collection unions the exact urgent story when the bounded candidate query did not return it", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-urgent-union-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const urgentStory = {
    id: "rss_urgent_below_top_n",
    title: "Current Xbox update",
    breaking_score: 80,
    score: 50,
    published_at: "2026-07-28T10:00:00.000Z",
    created_at: "2026-07-28T10:00:00.000Z",
    youtube_post_id: "",
    publish_status: "",
    _extra: JSON.stringify({
      breaking_fast_track: true,
    }),
  };
  const db = {
    prepare(sql) {
      if (
        sql.includes("FROM stories") &&
        sql.includes("WHERE id = ?")
      ) {
        return {
          get(storyId) {
            return storyId === urgentStory.id
              ? urgentStory
              : null;
          },
        };
      }
      if (sql.includes("FROM stories")) {
        return {
          all() {
            return [
              {
                id: "reddit-stale-top-row",
                title: "Stale high-score distractor",
                breaking_score: 99999,
                score: 99999,
                published_at: "2026-05-19T09:00:00.000Z",
                created_at: "2026-05-19T09:00:00.000Z",
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
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
        breaking_story_id: urgentStory.id,
        verification_status: "CONFIRMED",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/current-update/",
        source_evidence_sha256: "c".repeat(64),
        source_evidence_path:
          "D:/pulse-data/evidence/rss_urgent_below_top_n.json",
        source_evidence_file_sha256: "d".repeat(64),
      },
    },
    {
      prevalidatedRuntimeControl: true,
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 981, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(queued.length, 1);
  assert.equal(queued[0].story_id, urgentStory.id);
  assert.equal(queued[0].kind, "plan_breaking_short");
  const report = await fs.readJson(result.report_json);
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .story_id,
    urgentStory.id,
  );
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .eligibility.exact_urgent_target,
    true,
  );
});

test("planner holds an exact verified breaking target below the lane score floor", async (t) => {
  const storyId = "rss_cabe09fbc0ecebd8";
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-score-floor-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];

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
        },
        queue_state: {
          inflight_by_pool: {},
          inflight_by_lane: {},
          active_idempotency_keys: [],
        },
        breaking_story_id: storyId,
        verification_status: "CONFIRMED",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/play-more-ubisoft-games-on-pc/",
        source_evidence_sha256: "7".repeat(64),
        source_evidence_path:
          `D:/pulse-data/evidence/${storyId}.json`,
        source_evidence_file_sha256: "8".repeat(64),
        candidates: [
          {
            lane_id: "breaking_short",
            story_id: storyId,
            title: "Play More Ubisoft Games on PC",
            stage: "PLANNING",
            score: 70,
            published_at: "2026-07-28T10:00:00.000Z",
          },
        ],
      },
    },
    {
      prevalidatedRuntimeControl: true,
      hydrateGovernedEditorialInventoryCandidates: async ({
        candidates,
      }) => ({
        schema_version:
          "pulse-governed-editorial-inventory-candidate-hydration-v1",
        generated_at: NOW,
        verdict: "READY",
        candidates,
        hydrated: [],
        rejected: [],
      }),
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 984, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(queued.length, 0);
  const report = await fs.readJson(result.report_json);
  assert.deepEqual(
    report.candidate_eligibility.eligible_candidates,
    [],
  );
  assert.deepEqual(
    report.candidate_eligibility.rejected_candidates,
    [
      {
        lane_id: "breaking_short",
        story_id: storyId,
        stage: "PLANNING",
        score: 70,
        exact_urgent_target: true,
        blockers: ["breaking_score_below_80"],
      },
    ],
  );
  const breaking = report.routing.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(breaking.verdict, "HOLD");
  assert.equal(breaking.next_job, null);
});

test("DB collection keeps current breaking news ahead of stale high-score rows at the candidate limit", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-current-first-"),
  );
  const db = new Database(":memory:");
  t.after(() => {
    db.close();
    return fs.remove(outDir);
  });
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      breaking_score REAL,
      score REAL,
      published_at TEXT,
      timestamp TEXT,
      created_at TEXT,
      youtube_post_id TEXT,
      publish_status TEXT,
      full_script TEXT,
      _extra TEXT
    )
  `);
  const insert = db.prepare(`
    INSERT INTO stories (
      id,
      title,
      breaking_score,
      score,
      published_at,
      created_at,
      youtube_post_id,
      publish_status,
      full_script,
      _extra
    ) VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)
  `);
  const insertRows = db.transaction(() => {
    for (let index = 0; index < 100; index += 1) {
      insert.run(
        `stale-high-score-${index}`,
        `Stale high-score story ${index}`,
        10000 + index,
        10000 + index,
        "2026-05-19T09:00:00.000Z",
        "2026-05-19T09:00:00.000Z",
        null,
        JSON.stringify({ breaking_fast_track: true }),
      );
    }
    insert.run(
      "current-low-score-story",
      "A current confirmed gaming update",
      80,
      50,
      "2026-07-28T11:00:00.000Z",
      "2026-07-28T11:00:00.000Z",
      null,
      JSON.stringify({
        breaking_fast_track: true,
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/28/current-story/",
        source_evidence_sha256: "e".repeat(64),
        source_evidence_path:
          "D:/pulse-data/evidence/current-low-score-story.json",
        source_evidence_file_sha256: "f".repeat(64),
      }),
    );
  });
  insertRows();
  const queued = [];

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
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 982, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(queued.length, 1);
  assert.equal(queued[0].story_id, "current-low-score-story");
  assert.equal(queued[0].kind, "plan_breaking_short");
  const report = await fs.readJson(result.report_json);
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .story_id,
    "current-low-score-story",
  );
});

test("DB collection uses the latest safe governed editorial score for a current evidence-bound breaking story", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pulse-multi-lane-governed-editorial-score-",
    ),
  );
  const db = new Database(":memory:");
  t.after(() => {
    db.close();
    return fs.remove(outDir);
  });
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      breaking_score REAL,
      score REAL,
      published_at TEXT,
      timestamp TEXT,
      created_at TEXT,
      youtube_post_id TEXT,
      publish_status TEXT,
      full_script TEXT,
      _extra TEXT
    );
    CREATE TABLE story_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      channel_id TEXT,
      total INTEGER NOT NULL,
      decision TEXT NOT NULL,
      hard_stops TEXT,
      scored_at TEXT NOT NULL
    );
  `);
  const storyId = "official-story-with-governed-score";
  db.prepare(`
    INSERT INTO stories (
      id,
      title,
      breaking_score,
      score,
      published_at,
      created_at,
      youtube_post_id,
      publish_status,
      full_script,
      _extra
    ) VALUES (?, ?, ?, ?, ?, ?, '', '', NULL, ?)
  `).run(
    storyId,
    "Official Xbox update changes what players can access",
    55,
    50,
    "2026-07-28T11:00:00.000Z",
    "2026-07-28T11:00:00.000Z",
    JSON.stringify({
      breaking_fast_track: true,
      verification_status: "CONFIRMED",
      verified_for_planning: true,
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/official-update/",
      source_evidence_sha256: "7".repeat(64),
      source_evidence_path:
        "D:/pulse-data/evidence/official-story-with-governed-score.json",
      source_evidence_file_sha256: "8".repeat(64),
    }),
  );
  const insertScore = db.prepare(`
    INSERT INTO story_scores (
      story_id,
      channel_id,
      total,
      decision,
      hard_stops,
      scored_at
    ) VALUES (?, 'pulse-gaming', ?, ?, ?, ?)
  `);
  insertScore.run(
    storyId,
    99,
    "auto",
    "[]",
    "2026-07-28T10:00:00.000Z",
  );
  insertScore.run(
    storyId,
    90,
    "review",
    "[]",
    "2026-07-28T11:30:00.000Z",
  );
  const queued = [];

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
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 984, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "plan_breaking_short");
  assert.equal(queued[0].story_id, storyId);
  const report = await fs.readJson(result.report_json);
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .story_id,
    storyId,
  );
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .score,
    90,
  );
});

test("DB collection does not promote rejected or hard-stopped governed editorial scores", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pulse-multi-lane-unsafe-editorial-score-",
    ),
  );
  const db = new Database(":memory:");
  t.after(() => {
    db.close();
    return fs.remove(outDir);
  });
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      breaking_score REAL,
      score REAL,
      published_at TEXT,
      timestamp TEXT,
      created_at TEXT,
      youtube_post_id TEXT,
      publish_status TEXT,
      full_script TEXT,
      _extra TEXT
    );
    CREATE TABLE story_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      channel_id TEXT,
      total INTEGER NOT NULL,
      decision TEXT NOT NULL,
      hard_stops TEXT,
      scored_at TEXT NOT NULL
    );
  `);
  const insertStory = db.prepare(`
    INSERT INTO stories (
      id,
      title,
      breaking_score,
      score,
      published_at,
      created_at,
      youtube_post_id,
      publish_status,
      full_script,
      _extra
    ) VALUES (?, ?, 55, 50, ?, ?, '', '', NULL, ?)
  `);
  const insertScore = db.prepare(`
    INSERT INTO story_scores (
      story_id,
      channel_id,
      total,
      decision,
      hard_stops,
      scored_at
    ) VALUES (?, 'pulse-gaming', 95, ?, ?, ?)
  `);
  const publishedAt = "2026-07-28T11:00:00.000Z";
  for (const [storyId, decision, hardStops] of [
    ["governed-score-rejected", "reject", "[]"],
    [
      "governed-score-hard-stopped",
      "auto",
      JSON.stringify(["advertiser_unfriendly"]),
    ],
  ]) {
    insertStory.run(
      storyId,
      `Unsafe governed score ${storyId}`,
      publishedAt,
      publishedAt,
      JSON.stringify({
        breaking_fast_track: true,
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url:
          `https://news.xbox.com/en-us/2026/07/28/${storyId}/`,
        source_evidence_sha256: "9".repeat(64),
        source_evidence_path:
          `D:/pulse-data/evidence/${storyId}.json`,
        source_evidence_file_sha256: "a".repeat(64),
      }),
    );
    insertScore.run(
      storyId,
      decision,
      hardStops,
      "2026-07-28T11:30:00.000Z",
    );
  }
  const queued = [];

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
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 985, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(queued.length, 0);
  const report = await fs.readJson(result.report_json);
  assert.deepEqual(
    report.candidate_eligibility.rejected_candidates.map(
      ({ story_id, score, blockers }) => ({
        story_id,
        score,
        blockers,
      }),
    ).sort((left, right) =>
      left.story_id.localeCompare(right.story_id),
    ),
    [
      {
        story_id: "governed-score-hard-stopped",
        score: 55,
        blockers: ["breaking_score_below_80"],
      },
      {
        story_id: "governed-score-rejected",
        score: 55,
        blockers: ["breaking_score_below_80"],
      },
    ],
  );
});

test("DB collection keeps a script-generation failure sentinel in planning instead of production", async (t) => {
  const storyId = "breaking-script-generation-failed";
  const { queued, report } =
    await runDbDerivedUrgentStoryPlanner(t, {
      storyId,
      title: "A current confirmed gaming update",
      fullScript:
        "Script generation failed. Manual edit required.",
      outPrefix: "pulse-multi-lane-failed-script-",
    });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].story_id, storyId);
  assert.equal(queued[0].kind, "plan_breaking_short");
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0].stage,
    "PLANNING",
  );
});

test("DB collection keeps a title-only full_script in planning instead of production", async (t) => {
  const storyId = "breaking-title-only-script";
  const title = "A current confirmed gaming update";
  const { queued, report } =
    await runDbDerivedUrgentStoryPlanner(t, {
      storyId,
      title,
      fullScript: `  ${title.toUpperCase()}  `,
      outPrefix: "pulse-multi-lane-title-only-script-",
      extra: {
        script_sha256: "3".repeat(64),
      },
    });

  assert.equal(queued.length, 1);
  assert.equal(queued[0].story_id, storyId);
  assert.equal(queued[0].kind, "plan_breaking_short");
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0].stage,
    "PLANNING",
  );
  assert.equal(
    report.candidate_eligibility.eligible_candidates[0]
      .script_sha256,
    null,
  );
});

test("DB-derived HUMAN_APPROVED work carries the exact persisted admission packet into the guarded admission job", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-db-admission-"),
  );
  t.after(() => fs.remove(outDir));
  const admission = {
    human_review_status: "approved",
    actor_id: "operator-db-001",
    reason: "Approved the exact reviewed render",
    confirmation_story_id: "breaking-db-approved",
    scheduled_for: "2026-07-28T19:00:00.000Z",
    evidence: {
      source_evidence_sha256: "1".repeat(64),
      script_sha256: "2".repeat(64),
      media_sha256: "3".repeat(64),
      rights_ledger_sha256: "4".repeat(64),
    },
  };
  const queued = [];
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return {
          all() {
            return [
              {
                id: "breaking-db-approved",
                title: "Canonical DB approval",
                breaking_score: 120,
                score: 90,
                created_at: NOW,
                youtube_post_id: "",
                publish_status: "",
                _extra: JSON.stringify({
                  breaking_fast_track: true,
                  verification_status: "CONFIRMED",
                  verified_for_planning: true,
                  primary_source_url:
                    "https://news.xbox.com/en-us/2026/07/28/db-approved/",
                  source_evidence_sha256: "1".repeat(64),
                  source_evidence_path:
                    "D:/pulse-data/evidence/breaking-db-approved.json",
                  source_evidence_file_sha256:
                    "6".repeat(64),
                  script_sha256: "2".repeat(64),
                  media_sha256: "3".repeat(64),
                  rights_ledger_canonical_sha256:
                    "4".repeat(64),
                  human_review_status: "approved",
                  admission,
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

  await handlers.governed_multi_lane_plan(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        runtime_control: {
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: true,
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
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 991, ...input };
          },
        },
      },
    },
  );

  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "admit_governed_publication");
  assert.equal(queued[0].run_at, "2026-07-28T17:45:00.000Z");
  assert.deepEqual(queued[0].payload.admission, admission);
  assert.notStrictEqual(queued[0].payload.admission, admission);
});

test("DB-derived HUMAN_APPROVED work stays held when its persisted admission packet confirms a different story", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-multi-lane-db-admission-mismatch-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return {
          all() {
            return [
              {
                id: "breaking-db-mismatch",
                title: "Mismatched DB approval",
                breaking_score: 120,
                score: 90,
                created_at: NOW,
                youtube_post_id: "",
                publish_status: "",
                _extra: JSON.stringify({
                  breaking_fast_track: true,
                  verification_status: "CONFIRMED",
                  verified_for_planning: true,
                  primary_source_url:
                    "https://news.xbox.com/en-us/2026/07/28/db-mismatch/",
                  source_evidence_sha256: "1".repeat(64),
                  source_evidence_path:
                    "D:/pulse-data/evidence/breaking-db-mismatch.json",
                  source_evidence_file_sha256:
                    "6".repeat(64),
                  human_review_status: "approved",
                  admission: {
                    human_review_status: "approved",
                    actor_id: "operator-db-002",
                    reason: "Approved another exact render",
                    confirmation_story_id: "different-story",
                    scheduled_for: "2026-07-28T19:00:00.000Z",
                    evidence: {
                      source_evidence_sha256: "1".repeat(64),
                    },
                  },
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
      payload: {
        now: NOW,
        out_dir: outDir,
        runtime_control: {
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          autonomous_production_enabled: true,
          live_publish_enabled: true,
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
      repos: {
        db,
        jobs: {
          enqueue(input) {
            queued.push(input);
            return input;
          },
        },
      },
    },
  );

  assert.equal(queued.length, 0);
  const report = await fs.readJson(result.report_json);
  const breaking = report.routing.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(breaking.verdict, "HOLD");
  assert.ok(
    breaking.blockers.includes(
      "exact_human_story_confirmation_required",
    ),
  );
});
