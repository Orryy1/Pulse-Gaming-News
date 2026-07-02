"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildAutonomousFeedbackReport,
  formatAutonomousFeedbackDiscord,
  loadCurrentCandidateReport,
  mergeTranscriptAudienceReports,
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

test("autonomous feedback loads goal-contract candidates before stale test-output candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autonomous-feedback-candidates-"));
  const goalPath = path.join(root, "goal", "next_publish_candidates.json");
  const stalePath = path.join(root, "test", "next_publish_candidates.json");
  await fs.ensureDir(path.dirname(goalPath));
  await fs.ensureDir(path.dirname(stalePath));
  await fs.writeJson(stalePath, {
    generated_at: "2026-06-27T04:17:21.749Z",
    candidates: [
      {
        id: "old_candidate",
        title: "Old Candidate",
      },
    ],
  });
  await fs.writeJson(goalPath, {
    generated_at: "2026-06-28T02:47:58.772Z",
    candidates: [
      {
        id: "rss_336678f89aaf64b2",
        title: "Invincible VS Turns Its Roster Into A Meta Fight",
      },
    ],
  });

  const report = await loadCurrentCandidateReport({
    paths: [goalPath, stalePath],
  });

  assert.equal(report.generated_at, "2026-06-28T02:47:58.772Z");
  assert.equal(report.candidates[0].id, "rss_336678f89aaf64b2");
});

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

test("autonomous feedback supersedes stale normal-ops RED when current enabled runway is clean", () => {
  const staleOps = normalOps();
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-07-01T01:15:00.000Z",
    normalOperationsReport: {
      ...staleOps,
      generated_at: "2026-06-29T15:22:07.758Z",
      overall_verdict: "red",
      layers: {
        ...staleOps.layers,
        publish_readiness: {
          verdict: "red",
          blockers: ["strict_dry_run_control: strict_dry_run_blocked"],
          advisory: ["old_strict_dry_run_control"],
        },
        post_window_verification: {
          ...staleOps.layers.post_window_verification,
          next_safe_publish_at_utc: "2026-06-29T16:00:00.000Z",
        },
      },
      guarded_selection: {
        action_id: "stale_story:youtube_shorts",
        exhausted: false,
      },
    },
    schedulerWindowReadiness: {
      generated_at: "2026-06-29T15:22:07.758Z",
      verdict: "red",
      ready_for_next_window_boolean: false,
      next_publish_window_utc: "2026-06-29T16:00:00.000Z",
      selected_action: {
        action_id: "stale_story:youtube_shorts",
        story_id: "stale_story",
        platform: "youtube_shorts",
      },
      blockers: ["publish_readiness_blocked"],
    },
    guardedDispatchPreflightReport: {
      generated_at: "2026-07-01T00:45:00.000Z",
      verdict: "GREEN",
      summary: {
        dispatch_ready_action_count: 1,
        blocked_action_count: 0,
      },
      dispatch_ready_actions: [
        {
          story_id: "fresh_xbox_beastro_20260611",
          platform: "youtube_shorts",
          title: "Beastro Has A Cozy Deckbuilding Test",
        },
      ],
    },
    dryRunPublishPlan: {
      generated_at: "2026-07-01T00:44:00.000Z",
      summary: {
        platform_enabled_dry_run_action_count: 3,
        blocked_action_count: 0,
      },
    },
    publishCadenceReport: {
      generated_at: "2026-07-01T00:50:00.000Z",
      next_safe_publish: {
        next_safe_publish_at_utc: "2026-07-01T09:00:00.000Z",
      },
    },
    candidateReport: {
      generated_at: "2026-07-01T00:46:00.000Z",
      candidates: [currentCandidate()],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.current_action, "observe_next_scheduler_window");
  assert.equal(report.scheduler.selected_action, "fresh_xbox_beastro_20260611:youtube_shorts");
  assert.equal(report.scheduler.next_safe_publish_at_utc, "2026-07-01T09:00:00.000Z");
  assert.equal(report.publish_readiness.verdict, "amber");
  assert.deepEqual(report.publish_readiness.blockers, []);
  assert.deepEqual(report.scheduler.blockers, []);
  assert.equal(report.stale_evidence.normal_operations_superseded, true);
  assert.equal(report.stale_evidence.scheduler_window_superseded, true);
  assert.ok(
    !report.blockers.some((blocker) => blocker.startsWith("publish_readiness:")),
    report.blockers.join(", "),
  );
  assert.ok(
    !report.blockers.some((blocker) => blocker.startsWith("scheduler_window:")),
    report.blockers.join(", "),
  );
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

test("autonomous feedback supersedes stale transcript audit debt when current package preflight passes", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-28T03:10:00.000Z",
    normalOperationsReport: normalOps({
      guarded_selection: {
        action_id: "fresh_xbox_beastro_20260611:youtube_shorts",
        exhausted: false,
      },
    }),
    candidateReport: {
      candidates: [
        currentCandidate({
          preflight_qa: {
            status: "pass",
            blockers: [],
            checks: {
              content: { result: "pass" },
              public_copy: { result: "pass" },
              script_scorecard: { result: "pass" },
              media_house: { result: "pass" },
              visual_entity_match: {
                result: "pass",
                evidence: { direct_motion_asset_count: 7 },
              },
              timestamp_alignment: { result: "pass" },
              voice_quality: { result: "pass" },
            },
          },
        }),
      ],
    },
    transcriptAudienceReport: {
      summary: { total: 2605, pass: 591, rewrite_required: 2014 },
      stories: [
        {
          story_id: "fresh_xbox_beastro_20260611",
          title: "Why Beastro Could Split Players",
          verdict: "rewrite_required",
          blockers: ["generic_could_split_title_template"],
        },
      ],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.current_action, "observe_next_scheduler_window");
  assert.equal(report.transcript_audience_feedback.summary.current_blocking_count, 0);
  assert.equal(report.transcript_audience_feedback.summary.superseded_by_current_preflight_count, 1);
  assert.equal(report.transcript_audience_feedback.items[0].state, "superseded_by_current_transcript_preflight");
  assert.ok(
    !report.blockers.includes(
      "transcript_audience:fresh_xbox_beastro_20260611:generic_could_split_title_template",
    ),
  );
  assert.match(formatAutonomousFeedbackDiscord(report), /Transcripts: 2014 rewrite required \| 0 current blockers/);
});

test("autonomous feedback does not hold selected window for stale same-story transcript rows when selected artefact passed", () => {
  const currentDir = path.join(os.tmpdir(), "pulse-current-selected-artifact");
  const staleDir = path.join(os.tmpdir(), "pulse-stale-selected-artifact");
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-07-02T13:42:00.000Z",
    normalOperationsReport: normalOps(),
    guardedDispatchPreflightReport: {
      generated_at: "2026-07-02T13:39:55.976Z",
      verdict: "GREEN",
      summary: {
        dispatch_ready_action_count: 1,
        blocked_action_count: 0,
      },
      dispatch_ready_actions: [
        {
          story_id: "fresh_star_wars_monopoly_20260702",
          platform: "youtube_shorts",
          title: "Star Wars Monopoly Could Ruin Game Night",
          canonical_manifest_path: path.join(currentDir, "canonical_story_manifest.json"),
          platform_publish_manifest_path: path.join(currentDir, "platform_publish_manifest.json"),
          video_path: path.join(currentDir, "visual_v4_render.mp4"),
          captions_path: path.join(currentDir, "captions.srt"),
          first_frame_source: path.join(currentDir, "visual_v4_render.mp4"),
        },
      ],
    },
    candidateReport: {
      candidates: [],
    },
    transcriptAudienceReport: {
      summary: { total: 2, pass: 1, rewrite_required: 1 },
      stories: [
        {
          story_id: "fresh_star_wars_monopoly_20260702",
          title: "Old Star Wars Monopoly Script",
          artifact_dir: staleDir,
          verdict: "rewrite_required",
          blockers: ["mass_audience:low_concrete_detail"],
        },
        {
          story_id: "fresh_star_wars_monopoly_20260702",
          title: "Star Wars Monopoly Could Ruin Game Night",
          artifact_dir: currentDir,
          verdict: "pass",
          blockers: [],
        },
      ],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.current_action, "observe_next_scheduler_window");
  assert.equal(report.scheduler.selected_action, "fresh_star_wars_monopoly_20260702:youtube_shorts");
  assert.equal(report.transcript_audience_feedback.summary.current_blocking_count, 0);
  assert.equal(report.transcript_audience_feedback.summary.superseded_by_current_preflight_count, 1);
  assert.equal(report.transcript_audience_feedback.items[0].state, "superseded_by_current_transcript_preflight");
  assert.ok(
    !report.blockers.includes(
      "transcript_audience:fresh_star_wars_monopoly_20260702:mass_audience:low_concrete_detail",
    ),
  );
});

test("autonomous feedback merges selected artefact transcript audit before classifying stale same-story debt", () => {
  const currentDir = path.join(os.tmpdir(), "pulse-current-selected-artifact-merge");
  const staleDir = path.join(os.tmpdir(), "pulse-stale-selected-artifact-merge");
  const transcriptAudienceReport = mergeTranscriptAudienceReports(
    {
      summary: { total: 1, pass: 0, rewrite_required: 1 },
      stories: [
        {
          story_id: "fresh_star_wars_monopoly_20260702",
          title: "Old Star Wars Monopoly Script",
          artifact_dir: staleDir,
          verdict: "rewrite_required",
          blockers: ["mass_audience:low_concrete_detail"],
        },
      ],
    },
    {
      generated_at: "2026-07-02T13:51:00.000Z",
      summary: { total: 1, pass: 1, rewrite_required: 0 },
      stories: [
        {
          story_id: "fresh_star_wars_monopoly_20260702",
          title: "Star Wars Monopoly Could Ruin Game Night",
          artifact_dir: currentDir,
          verdict: "pass",
          blockers: [],
        },
      ],
    },
  );

  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-07-02T13:52:00.000Z",
    normalOperationsReport: normalOps(),
    guardedDispatchPreflightReport: {
      generated_at: "2026-07-02T13:39:55.976Z",
      verdict: "GREEN",
      summary: {
        dispatch_ready_action_count: 1,
        blocked_action_count: 0,
      },
      dispatch_ready_actions: [
        {
          story_id: "fresh_star_wars_monopoly_20260702",
          platform: "youtube_shorts",
          title: "Star Wars Monopoly Could Ruin Game Night",
          canonical_manifest_path: path.join(currentDir, "canonical_story_manifest.json"),
          platform_publish_manifest_path: path.join(currentDir, "platform_publish_manifest.json"),
          video_path: path.join(currentDir, "visual_v4_render.mp4"),
          captions_path: path.join(currentDir, "captions.srt"),
          first_frame_source: path.join(currentDir, "visual_v4_render.mp4"),
        },
      ],
    },
    candidateReport: {
      candidates: [],
    },
    transcriptAudienceReport,
  });

  assert.equal(transcriptAudienceReport.selected_artifact_audit.story_count, 1);
  assert.equal(report.verdict, "amber");
  assert.equal(report.current_action, "observe_next_scheduler_window");
  assert.equal(report.transcript_audience_feedback.summary.current_blocking_count, 0);
  assert.equal(report.transcript_audience_feedback.items[0].state, "superseded_by_current_transcript_preflight");
});

test("autonomous feedback holds selected window when selected artefact transcript row fails", () => {
  const currentDir = path.join(os.tmpdir(), "pulse-current-selected-bad-artifact");
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-07-02T13:42:00.000Z",
    normalOperationsReport: normalOps(),
    guardedDispatchPreflightReport: {
      generated_at: "2026-07-02T13:39:55.976Z",
      verdict: "GREEN",
      summary: {
        dispatch_ready_action_count: 1,
        blocked_action_count: 0,
      },
      dispatch_ready_actions: [
        {
          story_id: "fresh_bad_transcript_20260702",
          platform: "youtube_shorts",
          title: "Bad Transcript Story",
          canonical_manifest_path: path.join(currentDir, "canonical_story_manifest.json"),
          platform_publish_manifest_path: path.join(currentDir, "platform_publish_manifest.json"),
          video_path: path.join(currentDir, "visual_v4_render.mp4"),
          captions_path: path.join(currentDir, "captions.srt"),
          first_frame_source: path.join(currentDir, "visual_v4_render.mp4"),
        },
      ],
    },
    candidateReport: {
      candidates: [],
    },
    transcriptAudienceReport: {
      summary: { total: 1, pass: 0, rewrite_required: 1 },
      stories: [
        {
          story_id: "fresh_bad_transcript_20260702",
          title: "Bad Transcript Story",
          artifact_dir: currentDir,
          verdict: "rewrite_required",
          blockers: ["mass_audience:tts_transcript_subject_drift"],
        },
      ],
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.current_action, "repair_transcript_audience_blockers");
  assert.equal(report.transcript_audience_feedback.summary.current_blocking_count, 1);
  assert.equal(report.transcript_audience_feedback.items[0].selected_artifact, true);
  assert.ok(
    report.blockers.includes(
      "transcript_audience:fresh_bad_transcript_20260702:mass_audience:tts_transcript_subject_drift",
    ),
  );
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

test("autonomous feedback accepts platform evidence written during a completed publish job", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-19T09:20:00.000Z",
    normalOperationsReport: normalOps(),
    recentJobs: [
      {
        id: 49431,
        kind: "publish",
        status: "done",
        created_at: "2026-06-19T09:00:00.000Z",
        updated_at: "2026-06-19T09:01:13.000Z",
        completed_at: "2026-06-19T09:01:13.000Z",
      },
    ],
    platformPosts: [
      {
        story_id: "fresh_gta6_release_reconfirm_20260616",
        platform: "facebook_reel",
        status: "published",
        external_id: "1510187686692156",
        created_at: "2026-06-19T09:01:12.000Z",
        updated_at: "2026-06-19T09:01:12.000Z",
        published_at: "2026-06-19T09:01:12.000Z",
      },
    ],
  });

  assert.equal(report.post_window_feedback.anomaly_count, 0);
  assert.equal(report.verdict, "amber");
});

test("recent jobs loader reads current jobs schema without requiring legacy result_summary column", async () => {
  const reposPath = require.resolve("../../lib/repositories");
  const monitorPath = require.resolve("../../lib/ops/autonomous-feedback-monitor");
  const originalRepos = require.cache[reposPath];
  const originalMonitor = require.cache[monitorPath];
  const statements = [];
  try {
    require.cache[reposPath] = {
      id: reposPath,
      filename: reposPath,
      loaded: true,
      exports: {
        getRepos() {
          return {
            db: {
              prepare(sql) {
                statements.push(sql);
                if (/result_summary/i.test(sql)) {
                  throw new Error("no such column: result_summary");
                }
                return {
                  all(limit) {
                    assert.equal(limit, 3);
                    return [
                      {
                        id: 101,
                        kind: "publish",
                        status: "done",
                        completed_at: "2026-06-17T16:00:09.000Z",
                      },
                    ];
                  },
                };
              },
            },
          };
        },
      },
    };
    delete require.cache[monitorPath];
    const { recentJobsFromDb } = require("../../lib/ops/autonomous-feedback-monitor");
    const rows = await recentJobsFromDb({ limit: 3 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 101);
    assert.ok(statements[0].includes("last_error"));
    assert.ok(!statements[0].includes("result_summary"));
  } finally {
    if (originalRepos) require.cache[reposPath] = originalRepos;
    else delete require.cache[reposPath];
    if (originalMonitor) require.cache[monitorPath] = originalMonitor;
    else delete require.cache[monitorPath];
  }
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

test("autonomous feedback prefers a fresh guarded action over residual cross-post catch-up", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-19T09:25:00.000Z",
    normalOperationsReport: normalOps({
      guarded_selection: {
        action_id: "fresh_gta6_release_reconfirm_20260616:facebook_reels",
        exhausted: false,
      },
    }),
    guardedDispatchPreflightReport: {
      verdict: "GREEN",
      dispatch_ready_actions: [
        {
          story_id: "fresh_gta6_release_reconfirm_20260616",
          platform: "facebook_reels",
          title: "GTA 6 Delay Raises The November Test",
        },
        {
          story_id: "fresh_gears_eday_pc_specs_20260616",
          platform: "instagram_reels",
          title: "Gears E-Day Has To Make Xbox Feel Dangerous",
        },
      ],
    },
    platformPosts: [
      {
        story_id: "fresh_gta6_release_reconfirm_20260616",
        platform: "youtube_shorts",
        status: "published",
        external_id: "uZ_Xwo23d7k",
        published_at: "2026-06-18T14:00:00.000Z",
      },
      {
        story_id: "fresh_gta6_release_reconfirm_20260616",
        platform: "instagram_reels",
        status: "published",
        external_id: "17948103933192700",
        published_at: "2026-06-18T16:01:00.000Z",
      },
    ],
  });

  assert.equal(
    report.scheduler.selected_action,
    "fresh_gears_eday_pc_specs_20260616:instagram_reels",
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

test("autonomous feedback does not block current guarded window for non-selected TTS failures", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-19T09:45:00.000Z",
    normalOperationsReport: normalOps({
      guarded_selection: {
        action_id: "fresh_steam_next_fest_demo_discovery_20260616:youtube_shorts",
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

  assert.notEqual(report.current_action, "repair_tts_caption_blockers");
  assert.equal(report.tts_caption_feedback.failed_count, 0);
  assert.equal(report.tts_caption_feedback.superseded_count, 1);
  assert.equal(report.tts_caption_feedback.blocks_publishing, false);
  assert.ok(!report.blockers.includes("tts_caption:fresh_xbox_beastro_20260611:caption_alignment_failed"));
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
