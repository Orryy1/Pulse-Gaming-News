"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
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

test("autonomous feedback holds selected candidate when live Discord ingestion reports quality issue", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-17T10:20:00.000Z",
    normalOperationsReport: normalOps(),
    candidateReport: {
      candidates: [currentCandidate()],
    },
    ingestedDiscordFeedbackReport: {
      capability: { status: "loaded" },
      summary: {
        messages_seen: 1,
        actionable_count: 1,
        blocking_count: 1,
        stale_count: 0,
        unmatched_count: 0,
      },
      items: [
        {
          story_id: "fresh_xbox_beastro_20260611",
          categories: ["tts_voice_quality", "transcript_confusing"],
          state: "current_selected_feedback_blocker",
          blocks_publishing: true,
          action: "hold_selected_candidate_and_repair_feedback_issue",
        },
      ],
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "hold_scheduler_and_apply_discord_feedback");
  assert.ok(
    report.blockers.includes("discord_ingested_feedback:fresh_xbox_beastro_20260611:tts_voice_quality"),
    report.blockers.join(", "),
  );
  assert.match(formatAutonomousFeedbackDiscord(report), /Live Discord ingest: loaded \| 1 actionable \| 1 blocking/);
});

test("autonomous feedback holds selected candidate when transcript audience audit fails it", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-17T10:20:00.000Z",
    normalOperationsReport: normalOps(),
    candidateReport: {
      candidates: [currentCandidate()],
    },
    transcriptAudienceReport: {
      summary: { total: 1, pass: 0, rewrite_required: 1 },
      stories: [
        {
          story_id: "fresh_xbox_beastro_20260611",
          title: "Beastro Has A Cozy Deckbuilding Test",
          verdict: "rewrite_required",
          blockers: ["mass_audience:tts_transcript_subject_drift"],
        },
      ],
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "repair_transcript_audience_blockers");
  assert.ok(
    report.blockers.includes(
      "transcript_audience:fresh_xbox_beastro_20260611:mass_audience:tts_transcript_subject_drift",
    ),
    report.blockers.join(", "),
  );
  assert.match(formatAutonomousFeedbackDiscord(report), /Transcripts: 1 rewrite required \| 1 current blockers/);
});

test("autonomous feedback does not hold the selected publish window for non-selected repair-lane motion gaps", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T22:25:00.000Z",
    normalOperationsReport: normalOps({
      guarded_selection: {
        action_id: "fresh_xbox_beastro_20260611:youtube_shorts",
        exhausted: false,
      },
    }),
    candidateReport: {
      candidates: [
        currentCandidate(),
        {
          id: "fresh_xbox_alien_isolation_2_20260610",
          title: "Alien Isolation 2 Has One Horror Risk",
          status: "review",
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
        },
      ],
    },
    discordDigestPayload: {
      generated_at: "2026-06-16T22:02:14.091Z",
      summary: {
        scheduler_bridge_direct_video_gap_count: 2,
        scheduler_bridge_direct_video_subject_mismatch_count: 1,
      },
      markdown:
        "Direct-video gap sample: fresh_xbox_beastro_20260611, fresh_xbox_alien_isolation_2_20260610.",
    },
  });

  assert.equal(report.discord_feedback.real_blocker_count, 0);
  assert.equal(report.discord_feedback.items[0].state, "superseded_by_current_preflight");
  assert.equal(report.discord_feedback.items[1].state, "backlog_repair_candidate_not_selected");
  assert.ok(!report.blockers.includes("discord_feedback:direct_motion_gap_current:fresh_xbox_alien_isolation_2_20260610"));
  assert.equal(report.current_action, "observe_next_scheduler_window");
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

test("autonomous feedback prefers current guarded dispatch action over stale scheduler selection", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-17T13:45:00.000Z",
    normalOperationsReport: normalOps({
      guarded_selection: {
        action_id: "fresh_xbox_beastro_20260611:youtube_shorts",
        exhausted: false,
      },
    }),
    guardedDispatchPreflightReport: {
      verdict: "GREEN",
      dispatch_ready_actions: [
        {
          story_id: "fresh_steam_next_fest_demo_discovery_20260616",
          platform: "youtube_shorts",
          title: "Steam Next Fest Turns Demos Into A Trust Fight",
        },
      ],
    },
  });

  assert.equal(
    report.scheduler.selected_action,
    "fresh_steam_next_fest_demo_discovery_20260616:youtube_shorts",
  );
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

test("autonomous feedback supersedes stale TTS failures when current preflight proves voice and timestamps pass", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T22:20:00.000Z",
    normalOperationsReport: normalOps(),
    candidateReport: {
      generated_at: "2026-06-16T22:14:52.178Z",
      candidates: [
        {
          id: "fresh_xbox_beastro_20260611",
          status: "publish_ready",
          preflight_qa: {
            status: "pass",
            blockers: [],
            checks: {
              voice_quality: { result: "pass", warnings: ["voice_cadence:above_target_wpm"] },
              timestamp_alignment: { result: "pass", warnings: [] },
            },
          },
        },
      ],
    },
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

  assert.notEqual(report.current_action, "repair_tts_caption_blockers");
  assert.equal(report.tts_caption_feedback.failed_count, 0);
  assert.equal(report.tts_caption_feedback.superseded_count, 1);
  assert.equal(report.tts_caption_feedback.blocks_publishing, false);
  assert.ok(
    !report.blockers.includes(
      "tts_caption:fresh_xbox_beastro_20260611:caption_alignment_failed",
    ),
  );
  assert.match(formatAutonomousFeedbackDiscord(report), /TTS\/captions: 0 failed materialisations/);
});

test("autonomous feedback supersedes stale TTS failures when newer story proof artefacts pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autonomous-feedback-audio-proof-"));
  const artifactDir = path.join(root, "fresh_xbox_beastro_20260611");
  await fs.ensureDir(artifactDir);
  await fs.writeFile(path.join(artifactDir, "visual_v4_render.mp4"), "");
  await fs.writeJson(path.join(artifactDir, "voice_quality_report.json"), {
    generated_at: "2026-06-16T23:27:47.950Z",
    verdict: "PASS",
    blockers: [],
  });
  await fs.writeJson(path.join(artifactDir, "caption_manifest.json"), {
    generated_at: "2026-06-16T23:27:47.950Z",
    status: "ready",
    blockers: [],
    word_timestamp_count: 118,
    checks: { word_timestamps_present: true },
  });
  await fs.writeJson(path.join(artifactDir, "narration_manifest.json"), {
    generated_at: "2026-06-16T23:27:47.950Z",
    status: "ready",
    blockers: [],
    checks: { word_timestamps_present: true },
  });

  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-17T13:20:00.000Z",
    normalOperationsReport: normalOps(),
    candidateReport: {
      generated_at: "2026-06-17T07:13:46.029Z",
      candidates: [
        {
          id: "fresh_xbox_beastro_20260611",
          status: "publish_ready",
          source: {
            exported_path: path.join(artifactDir, "visual_v4_render.mp4"),
          },
        },
      ],
    },
    ttsCaptionReport: {
      generated_at: "2026-06-16T16:44:24.195Z",
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

  assert.equal(report.tts_caption_feedback.failed_count, 0);
  assert.equal(report.tts_caption_feedback.superseded_count, 1);
  assert.equal(report.tts_caption_feedback.blocks_publishing, false);
  assert.ok(!report.blockers.includes("tts_caption:fresh_xbox_beastro_20260611:caption_alignment_failed"));
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

test("autonomous feedback surfaces durable supply and expiring backlog in Discord", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T22:10:00.000Z",
    normalOperationsReport: normalOps(),
    candidateSupplyReport: {
      generated_at: "2026-06-16T22:06:24.000Z",
      verdict: "amber",
      summary: {
        fresh_source_backed_stories_24h: 7,
        green_ready_candidates: 5,
        durable_green_ready_candidates: 5,
        ready_candidates_expiring_within_24h: 0,
        non_ready_candidates_expiring_within_24h: 3,
        v4_ready_candidates: 5,
      },
      next_action: "refresh_fresh_source_intake_and_promote_new_green_candidates_before_expiring_backlog",
      warnings: [
        "non_ready_candidates_expiring_within_24h:3",
        "durable_green_ready_candidates_below_target:5/10",
      ],
    },
  });

  assert.equal(report.market_intelligence.candidate_supply.green_ready_candidates, 5);
  assert.equal(report.market_intelligence.candidate_supply.durable_green_ready_candidates, 5);
  assert.equal(report.market_intelligence.candidate_supply.non_ready_candidates_expiring_within_24h, 3);
  assert.equal(
    report.market_intelligence.candidate_supply.next_action,
    "refresh_fresh_source_intake_and_promote_new_green_candidates_before_expiring_backlog",
  );
  assert.match(formatAutonomousFeedbackDiscord(report), /candidate=amber \(5 durable GREEN, 3 expiring non-ready\)/);
});

test("scheduler has an autonomous feedback monitor schedule", () => {
  const entry = DEFAULT_SCHEDULES.find((schedule) => schedule.name === "autonomous_feedback_monitor_30m");

  assert.ok(entry, "missing autonomous feedback schedule");
  assert.equal(entry.kind, "autonomous_feedback_monitor");
  assert.equal(entry.cron_expr, "20,50 * * * *");
  assert.equal(entry.idempotencyTemplate, "autonomous_feedback_monitor:{date}:{hour}:{minute}");
});
