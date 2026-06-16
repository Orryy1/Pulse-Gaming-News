"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAutonomousFeedbackReport,
  formatAutonomousFeedbackDiscord,
} = require("../../lib/ops/autonomous-feedback-monitor");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");

function normalOps(overrides = {}) {
  return {
    overall_verdict: "amber",
    operating_posture: "normal_operations",
    generated_at: "2026-06-16T15:18:00.000Z",
    layers: {
      runtime_ownership: {
        verdict: "green",
        facts: {
          auto_publish: true,
          use_job_queue: "true",
          scheduler_active: true,
          dispatch_mode: "queue",
        },
        blockers: [],
      },
      publish_readiness: {
        verdict: "amber",
        blockers: [],
        advisory: ["cadence_wait"],
        next_action: "Let the guarded scheduler run.",
      },
      queue_health: {
        verdict: "green",
        pending_jobs: 0,
        recent_failed_jobs: 0,
        stale_claims: 0,
        hard_fails: [],
      },
      candidate_buffer: {
        verdict: "amber",
        counts: {
          ready_candidates: 1,
          source_safe_candidates: 1,
          v4_ready_candidates: 1,
        },
        targets: { ready_candidates: 10 },
        blockers: [],
        warnings: ["ready_candidates_below_target:1/10"],
        top_candidates: [
          {
            id: "fresh_xbox_beastro_20260611",
            title: "Beastro Has A Cozy Deckbuilding Test",
            score: 85,
            v4_ready: true,
          },
        ],
      },
      post_window_verification: {
        verdict: "amber",
        next_safe_publish_at_utc: "2026-06-16T16:00:00.000Z",
        publish_jobs_seen: 1,
        blockers: [],
        advisory: ["wait_for_next_window"],
      },
    },
    guarded_selection: {
      action_id: "fresh_xbox_beastro_20260611:youtube_shorts",
      exhausted: false,
    },
    ...overrides,
  };
}

function currentCandidate(overrides = {}) {
  return {
    id: "fresh_xbox_beastro_20260611",
    title: "Beastro Has A Cozy Deckbuilding Test",
    status: "publish_ready",
    preflight_qa: {
      status: "pass",
      blockers: [],
      checks: {
        visual_entity_match: {
          result: "pass",
          evidence: {
            direct_motion_asset_count: 7,
          },
        },
        timestamp_alignment: {
          result: "pass",
        },
        voice_quality: {
          result: "pass",
          warnings: ["voice_cadence:above_target_wpm"],
        },
      },
    },
    ...overrides,
  };
}

test("autonomous feedback treats stale Discord direct-motion warnings as superseded by current preflight", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T15:20:00.000Z",
    normalOperationsReport: normalOps(),
    candidateReport: {
      candidates: [currentCandidate()],
    },
    discordDigestPayload: {
      generated_at: "2026-06-16T14:03:58.000Z",
      summary: {
        scheduler_bridge_direct_video_gap_count: 1,
        scheduler_bridge_direct_video_subject_mismatch_count: 1,
      },
      markdown:
        "Bridge warning: direct-video sidecar provenance does not match the story subject; rebuild motion before publishing.\nDirect-video gap sample: fresh_xbox_beastro_20260611.",
    },
    learningReport: {
      blockers: ["youtube_access_token_not_fresh"],
      automatic_adjustments: { script_hooks: true, public_posting: false },
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.current_action, "observe_next_scheduler_window");
  assert.equal(report.discord_feedback.real_blocker_count, 0);
  assert.equal(report.discord_feedback.items[0].state, "superseded_by_current_preflight");
  assert.match(formatAutonomousFeedbackDiscord(report), /Beastro Has A Cozy Deckbuilding Test/);
  assert.match(formatAutonomousFeedbackDiscord(report), /Discord feedback: 0 current blockers/);
});

test("autonomous feedback holds scheduler when Discord wrong-motion feedback is still current", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T15:20:00.000Z",
    normalOperationsReport: normalOps(),
    candidateReport: {
      candidates: [
        currentCandidate({
          preflight_qa: {
            status: "fail",
            blockers: ["visual_entity_match_failed"],
            checks: {
              visual_entity_match: {
                result: "fail",
                evidence: { direct_motion_asset_count: 0 },
              },
            },
          },
        }),
      ],
    },
    discordDigestPayload: {
      generated_at: "2026-06-16T15:18:00.000Z",
      summary: {
        scheduler_bridge_direct_video_gap_count: 1,
        scheduler_bridge_direct_video_subject_mismatch_count: 1,
      },
      markdown: "Direct-video gap sample: fresh_xbox_beastro_20260611.",
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "hold_scheduler_and_repair_current_candidate");
  assert.equal(report.discord_feedback.real_blocker_count, 1);
  assert.deepEqual(report.blockers, ["discord_feedback:direct_motion_gap_current:fresh_xbox_beastro_20260611"]);
});

test("autonomous feedback alerts on completed publish jobs with no newer platform evidence", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T15:20:00.000Z",
    normalOperationsReport: normalOps(),
    recentJobs: [
      {
        id: 44647,
        kind: "publish",
        status: "done",
        completed_at: "2026-06-16T14:00:07.000Z",
      },
    ],
    platformPosts: [
      {
        story_id: "old_story",
        platform: "youtube_shorts",
        created_at: "2026-06-15T20:57:56.000Z",
      },
    ],
  });

  assert.equal(report.post_window_feedback.anomalies[0].type, "publish_job_without_platform_evidence");
  assert.equal(report.post_window_feedback.anomalies[0].job_id, 44647);
  assert.equal(report.verdict, "red");
});

test("autonomous feedback treats exhausted guarded selection as a live scheduler blocker", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T16:05:00.000Z",
    normalOperationsReport: normalOps({
      guarded_selection: {
        action_id: null,
        exhausted: true,
        skipped_actions: [
          {
            action_id: "fresh_xbox_beastro_20260611:youtube_shorts",
            reason: "last_second_quality_gate_failed",
            blockers: ["video:duration_too_short (36.04s)"],
          },
        ],
      },
    }),
    schedulerWindowReadiness: {
      verdict: "red",
      ready_for_next_window_boolean: false,
      blockers: ["no_guarded_action_selected"],
      next_action: "hold_scheduler_and_repair_blockers",
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "repair_guarded_scheduler_selection");
  assert.ok(report.blockers.includes("scheduler_window:no_guarded_action_selected"));
  assert.equal(report.scheduler.ready_for_next_window_boolean, false);
});

test("autonomous feedback treats current TTS and caption materialisation failures as blockers", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T17:00:00.000Z",
    normalOperationsReport: normalOps(),
    ttsCaptionReport: {
      generated_at: "2026-06-16T16:44:24.195Z",
      summary: {
        failed_count: 1,
      },
      jobs: [
        {
          story_id: "fresh_xbox_beastro_20260611",
          title: "Beastro Has A Cozy Deckbuilding Test",
          status: "failed",
          error: "local_whisper_word_alignment_failed",
        },
      ],
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "repair_tts_caption_blockers");
  assert.ok(
    report.blockers.includes(
      "tts_caption:fresh_xbox_beastro_20260611:caption_alignment_failed",
    ),
  );
  assert.match(formatAutonomousFeedbackDiscord(report), /TTS\/captions: 1 failed materialisations/);
});

test("autonomous feedback escalates zero live candidates when safe repair runway exists", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T17:30:00.000Z",
    normalOperationsReport: normalOps({
      layers: {
        ...normalOps().layers,
        candidate_buffer: {
          verdict: "red",
          counts: {
            ready_candidates: 0,
            source_safe_candidates: 0,
            v4_ready_candidates: 0,
          },
          blockers: ["no_scheduler_visible_candidates"],
          warnings: [],
          top_candidates: [],
        },
      },
    }),
    publishBlockerResolutionReport: {
      summary: {
        live_publish_candidates: 0,
        auto_repairable_items: 107,
        dead_end_blockers: 0,
      },
      publish_runway: {
        status: "repair_lane_supply_available",
        publishable_now: 0,
        green_pack_available: 0,
        repairable_backlog: 107,
        next_action: "Run the highest-priority repair lanes, then rerun publish preflight.",
        recommended_sequence: ["repair_script_audio_visual_render_backlog"],
      },
      priority_items: [
        {
          story_id: "1th58jx",
          title: "Steam decrees bullet heaven the name of the Vampire Survivors genre",
          resolution_lane: "public_copy_package_repair",
          safe_next_command:
            "npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id 1th58jx --out-dir output/goal-contract --json",
        },
      ],
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "run_safe_repair_lanes_for_candidate_runway");
  assert.ok(report.blockers.includes("publish_runway:no_live_candidates_with_repairable_backlog"));
  assert.equal(report.publish_runway_feedback.repairable_backlog, 107);
  assert.match(formatAutonomousFeedbackDiscord(report), /Runway: 0 live \| 107 repairable/);
});

test("scheduler has an autonomous feedback monitor schedule", () => {
  const entry = DEFAULT_SCHEDULES.find((schedule) => schedule.name === "autonomous_feedback_monitor_30m");

  assert.ok(entry, "missing autonomous feedback schedule");
  assert.equal(entry.kind, "autonomous_feedback_monitor");
  assert.equal(entry.cron_expr, "20,50 * * * *");
  assert.equal(entry.idempotencyTemplate, "autonomous_feedback_monitor:{date}:{hour}:{minute}");
});
