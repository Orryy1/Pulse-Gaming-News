"use strict";

const {
  POOLS,
} = require("./multi-lane-worker-topology");

const LANE_REGISTRY = Object.freeze([
  Object.freeze({
    lane_id: "breaking_short",
    label: "Breaking News Short",
    priority: 100,
    format_family: "breaking_news_short",
    trigger: Object.freeze({
      type: "event",
      value: "verified_breaking_score_at_least_80",
    }),
    cadence: Object.freeze({
      daily_cap: 6,
      weekly_cap: null,
      min_gap_minutes: 45,
      service_level_minutes: 30,
    }),
    max_inflight: 2,
    worker_class: "shorts_production",
    jobs: Object.freeze({
      plan_kind: "plan_breaking_short",
      produce_kind: "produce_breaking_short",
      review_kind: "review_breaking_short",
      admit_kind: "admit_governed_publication",
      dispatch_kind: "dispatch_governed_publication",
    }),
  }),
  Object.freeze({
    lane_id: "evergreen_short",
    label: "Evergreen Verdict Short",
    priority: 60,
    format_family: "evergreen_verdict_short",
    trigger: Object.freeze({
      type: "cron",
      value: "Tuesday and Friday reserve slots",
    }),
    cadence: Object.freeze({
      daily_cap: 1,
      weekly_cap: 2,
      min_gap_minutes: 48 * 60,
      service_level_minutes: 24 * 60,
    }),
    max_inflight: 1,
    worker_class: "shorts_production",
    jobs: Object.freeze({
      plan_kind: "plan_evergreen_short",
      produce_kind: "produce_evergreen_short",
      review_kind: "review_evergreen_short",
      admit_kind: "admit_governed_publication",
      dispatch_kind: "dispatch_governed_publication",
    }),
  }),
  Object.freeze({
    lane_id: "weekly_longform",
    label: "Weekly Flagship Longform",
    priority: 40,
    format_family: "youtube_flagship_longform",
    trigger: Object.freeze({
      type: "cron",
      value: "Sunday flagship window",
    }),
    cadence: Object.freeze({
      daily_cap: 1,
      weekly_cap: 1,
      min_gap_minutes: 7 * 24 * 60,
      service_level_minutes: 72 * 60,
    }),
    max_inflight: 1,
    worker_class: "longform_production",
    jobs: Object.freeze({
      plan_kind: "plan_weekly_longform",
      produce_kind: "produce_weekly_longform",
      review_kind: "review_weekly_longform",
      admit_kind: "admit_governed_publication",
      dispatch_kind: "dispatch_governed_publication",
    }),
  }),
]);

function text(value) {
  return String(value || "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function globalBlockers(runtimeControl = {}) {
  const blockers = [];
  if (runtimeControl.operating_contract_valid !== true) {
    blockers.push("operating_contract_not_valid");
  }
  if (runtimeControl.scheduler_owner_healthy !== true) {
    blockers.push("scheduler_owner_not_healthy");
  }
  if (runtimeControl.autonomous_production_enabled !== true) {
    blockers.push("autonomous_production_not_enabled");
  }
  return blockers;
}

function candidateOrder(a, b) {
  const scoreDelta = number(b?.score) - number(a?.score);
  if (scoreDelta) return scoreDelta;
  const deadlineA = Date.parse(a?.deadline_at || "");
  const deadlineB = Date.parse(b?.deadline_at || "");
  if (Number.isFinite(deadlineA) && Number.isFinite(deadlineB)) {
    const deadlineDelta = deadlineA - deadlineB;
    if (deadlineDelta) return deadlineDelta;
  } else if (Number.isFinite(deadlineA)) {
    return -1;
  } else if (Number.isFinite(deadlineB)) {
    return 1;
  }
  return text(a?.story_id).localeCompare(text(b?.story_id));
}

function exactScheduledPublication(candidate = {}) {
  const publication = candidate.publication || {};
  const blockers = [];
  if (
    text(candidate.stage).toUpperCase() !== "SCHEDULED" ||
    text(publication.lifecycle_state).toUpperCase() !== "SCHEDULED"
  ) {
    return { binding: null, blockers };
  }
  const eventId = Number(publication.scheduled_event_id);
  const scheduledFor = text(publication.scheduled_for);
  const dispatchIdempotencyKey = text(
    publication.dispatch_idempotency_key,
  );
  const requestFingerprint = text(
    publication.request_fingerprint,
  ).toLowerCase();
  if (publication.platform !== "youtube") {
    blockers.push("scheduled_platform_must_be_youtube");
  }
  if (!Number.isInteger(eventId) || eventId <= 0) {
    blockers.push("scheduled_event_id_required");
  }
  if (!Number.isFinite(Date.parse(scheduledFor))) {
    blockers.push("scheduled_for_required");
  }
  if (!dispatchIdempotencyKey) {
    blockers.push("scheduled_dispatch_idempotency_key_required");
  }
  if (!/^[a-f0-9]{64}$/.test(requestFingerprint)) {
    blockers.push("scheduled_request_fingerprint_invalid");
  }
  if (text(publication.control_tower_verdict).toUpperCase() !== "GREEN") {
    blockers.push("scheduled_control_tower_not_green");
  }
  return {
    blockers,
    binding: blockers.length
      ? null
      : {
          story_id: text(candidate.story_id),
          platform: "youtube",
          scheduled_event_id: eventId,
          scheduled_for: new Date(scheduledFor).toISOString(),
          dispatch_idempotency_key: dispatchIdempotencyKey,
          request_fingerprint: requestFingerprint,
        },
  };
}

function nextJob(lane, candidate) {
  const stage = text(candidate?.stage).toUpperCase();
  if (stage === "SCHEDULED") {
    const exact = exactScheduledPublication(candidate);
    if (exact.blockers.length) {
      return { job: null, blockers: exact.blockers };
    }
    return {
      blockers: [],
      job: {
        kind: lane.jobs.dispatch_kind,
        worker_class: "critical_dispatch",
        idempotency_key:
          `dispatch:${exact.binding.scheduled_event_id}:` +
          exact.binding.request_fingerprint,
        payload: exact.binding,
      },
    };
  }
  if (stage === "QA_PASSED") {
    return {
      blockers: ["human_review_required_before_admission"],
      job: null,
    };
  }
  if (stage === "HUMAN_APPROVED") {
    if (
      !candidate?.admission ||
      typeof candidate.admission !== "object" ||
      Array.isArray(candidate.admission)
    ) {
      return {
        blockers: ["exact_human_admission_packet_required"],
        job: null,
      };
    }
    return {
      blockers: [],
      job: {
        kind: lane.jobs.admit_kind,
        worker_class: "critical_dispatch",
        idempotency_key:
          `admit:${lane.lane_id}:${text(candidate.story_id)}`,
        payload: {
          story_id: text(candidate.story_id),
          lane_id: lane.lane_id,
          human_admission_required: true,
          admission: structuredClone(candidate.admission),
        },
      },
    };
  }
  if (
    ["PRODUCTION_READY", "SCRIPT_READY", "ASSETS_CLEARED"].includes(stage)
  ) {
    return {
      blockers: [],
      job: {
        kind: lane.jobs.produce_kind,
        worker_class: lane.worker_class,
        idempotency_key:
          `produce:${lane.lane_id}:${text(candidate.story_id)}`,
        payload: {
          story_id: text(candidate.story_id),
          lane_id: lane.lane_id,
        },
      },
    };
  }
  return {
    blockers: [],
    job: {
      kind: lane.jobs.plan_kind,
      worker_class: "critical_planning",
      idempotency_key:
        `plan:${lane.lane_id}:${text(candidate.story_id)}`,
      payload: {
        story_id: text(candidate.story_id),
        lane_id: lane.lane_id,
      },
    },
  };
}

function buildLanePlan({
  lane,
  candidates,
  queueState,
  runtimeBlockers,
  publicationKillSwitchHealthy,
  livePublishEnabled,
  laneSwitches,
}) {
  const enabled = laneSwitches[lane.lane_id] !== false;
  const blockers = [...runtimeBlockers];
  if (!enabled) blockers.push("lane_disabled");
  const inflight = number(
    queueState?.inflight_by_worker_class?.[lane.worker_class],
  );
  if (inflight >= lane.max_inflight) {
    blockers.push("lane_capacity_reached");
  }
  const laneCandidates = (candidates || [])
    .filter((candidate) => candidate?.lane_id === lane.lane_id)
    .filter((candidate) => candidate?.reserved !== true)
    .sort(candidateOrder);
  const candidate = laneCandidates[0] || null;
  if (!candidate) blockers.push("lane_candidate_required");
  const candidateStage = text(candidate?.stage).toUpperCase();
  if (
    ["QA_PASSED", "HUMAN_APPROVED", "SCHEDULED"].includes(
      candidateStage,
    ) &&
    publicationKillSwitchHealthy !== true
  ) {
    blockers.push("global_kill_switch_not_healthy");
  }
  if (
    ["HUMAN_APPROVED", "SCHEDULED"].includes(candidateStage) &&
    livePublishEnabled !== true
  ) {
    blockers.push("live_publish_not_enabled");
  }

  const next = candidate ? nextJob(lane, candidate) : { job: null, blockers: [] };
  blockers.push(...next.blockers);
  const uniqueBlockers = [...new Set(blockers)];

  return {
    lane_id: lane.lane_id,
    label: lane.label,
    enabled,
    priority: lane.priority,
    format_family: lane.format_family,
    trigger: { ...lane.trigger },
    cadence: { ...lane.cadence },
    max_inflight: lane.max_inflight,
    worker_class: lane.worker_class,
    stage: candidate ? text(candidate.stage).toUpperCase() || "PLANNING" : "EMPTY",
    verdict: uniqueBlockers.length ? "HOLD" : "GREEN",
    blockers: uniqueBlockers,
    candidate: candidate
      ? {
          story_id: text(candidate.story_id),
          title: text(candidate.title),
          score: number(candidate.score),
        }
      : null,
    jobs: {
      ...lane.jobs,
      next: uniqueBlockers.length ? null : next.job,
    },
  };
}

function buildGovernedMultiLanePlan({
  now = new Date().toISOString(),
  laneRegistry = LANE_REGISTRY,
  candidates = [],
  runtimeControl = {},
  queueState = {},
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("multi_lane_plan_time_invalid");
  }
  const runtimeBlockers = globalBlockers(runtimeControl);
  const laneSwitches = runtimeControl.lanes || {};
  const lanes = [...laneRegistry]
    .sort((a, b) => b.priority - a.priority)
    .map((lane) =>
      buildLanePlan({
        lane,
        candidates,
        queueState,
        runtimeBlockers,
        publicationKillSwitchHealthy:
          runtimeControl.kill_switch_healthy === true,
        livePublishEnabled:
          runtimeControl.live_publish_enabled === true,
        laneSwitches,
      }),
    );

  return {
    schema_version: "pulse-governed-multi-lane-plan-v1",
    generated_at: generatedAt.toISOString(),
    verdict:
      runtimeBlockers.length === 0 &&
      lanes.some((lane) => lane.verdict === "GREEN")
        ? "GREEN"
        : "HOLD",
    global_blockers: runtimeBlockers,
    lane_count: lanes.length,
    green_lane_count: lanes.filter((lane) => lane.verdict === "GREEN").length,
    lanes,
    worker_topology: Object.fromEntries(
      POOLS.map((pool) => [
        pool.pool_id,
        { concurrency: pool.instances },
      ]),
    ),
    safety: {
      generic_publish_jobs_allowed: false,
      exact_scheduled_dispatch_binding_required: true,
      human_admission_required: true,
      live_publish_enabled: false,
      production_continues_when_publish_held: true,
    },
  };
}

module.exports = {
  LANE_REGISTRY,
  buildGovernedMultiLanePlan,
};
