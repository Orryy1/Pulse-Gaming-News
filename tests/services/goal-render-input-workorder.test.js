"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalRenderInputWorkOrder,
  renderGoalRenderInputWorkOrderMarkdown,
  writeGoalRenderInputWorkOrder,
} = require("../../lib/goal-render-input-workorder");

function blockedQueueItem(overrides = {}) {
  return {
    story_id: "story-blocked",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    artifact_dir: "C:/repo/output/goal-proof/batch/story-blocked",
    status: "needs_final_render",
    render_input_status: "blocked",
    render_input_blockers: [
      "final_narration_audio_missing",
      "word_timestamps_missing",
      "materialised_motion_clips_missing",
      "materialised_motion_families_insufficient",
      "real_visual_motion_clips_missing",
      "real_visual_motion_families_insufficient",
    ],
    render_input_evidence: {
      materialised_motion_clip_count: 0,
      distinct_motion_family_count: 0,
      motion_candidates_seen: 8,
    },
    target_render_manifest: {
      renderer: "visual_v4_production",
      output: "visual_v4_render.mp4",
    },
    ...overrides,
  };
}

test("render input work order maps queued blockers to exact local actions", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-22T04:00:00.000Z",
      queue: [
        blockedQueueItem(),
        blockedQueueItem({
          story_id: "story-ready",
          title: "Star Fox Deal Has One Catch",
          render_input_status: "ready_for_final_render_job",
          render_input_blockers: [],
        }),
      ],
    },
    generatedAt: "2026-05-22T04:01:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 2);
  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.summary.blocked_on_render_inputs_count, 1);
  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.owned_motion_materialisation_jobs, 0);
  assert.equal(workOrder.jobs[0].status, "blocked_on_render_inputs");
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "generate_final_narration_audio_and_word_timestamps",
      "materialise_validated_real_motion_clips",
    ],
  );
  assert.equal(workOrder.jobs[1].status, "ready_for_final_render_job");
  assert.deepEqual(
    workOrder.jobs[1].actions.map((action) => action.action_id),
    ["run_visual_v4_production_render"],
  );
  assert.equal(workOrder.safety.no_publish_triggered, true);
});

test("render input work order preserves publish-blocker repair backlog when render queue is empty", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-31T02:30:00.000Z",
      queue: [],
      blocked: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-31T02:35:00.000Z",
      blocked_stories: [],
      held_stories: [],
    },
    publishBlockerResolutionPlan: {
      generated_at: "2026-05-31T02:40:00.000Z",
      publish_runway: {
        status: "publishable_now",
      },
      repair_orchestration: {
        stages: [
          {
            id: "auto_repair_backlog",
            items: [
              {
                story_id: "qa-motion",
                title: "Helldivers 2 Won't Get Space Marines",
                blocker_type: "qa:gold_standard:motion_density_below_reference",
                repair_lane: "visual_v4_motion_enrichment",
                exact_missing_input: "distinct V4 motion clips and source families",
                recommended_command: "npm run ops:v4-source-deficit -- --story-id qa-motion --json",
                expected_output: "updated V4 motion/source work order",
                db_mutation_required: false,
                operator_approval_required: false,
                post_repair_validation_command:
                  "npm run ops:next-publish-candidates -- --preflight-qa --story-id qa-motion",
              },
            ],
          },
        ],
      },
    },
    generatedAt: "2026-05-31T02:41:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 0);
  assert.equal(workOrder.summary.publish_blocker_resolution_repair_items, 1);
  assert.equal(workOrder.repair_backlog.summary.total_items, 1);
  assert.equal(workOrder.repair_backlog.summary.auto_repairable_items, 1);
  assert.equal(workOrder.auto_repair_plan.status, "auto_repairable_jobs_available");
  const item = workOrder.repair_backlog.items[0];
  assert.equal(item.story_id, "qa-motion");
  assert.equal(item.source, "publish_blocker_resolution");
  assert.equal(item.repair_lane, "visual_v4_motion_enrichment");
  assert.equal(item.db_mutation_needed, false);
  assert.equal(item.operator_approval_required, false);
  assert.match(item.post_repair_validation_command, /next-publish-candidates/);
  const markdown = renderGoalRenderInputWorkOrderMarkdown(workOrder);
  assert.match(markdown, /Publish blocker repair items: 1/);
  assert.match(markdown, /qa-motion/);
});

test("render input work order routes stale repaired-copy audio through the audio regeneration lane", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-22T09:10:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "stale-copy-story",
          title: "Lego Batman Is Packed With Deep Cuts",
          force_final_render: true,
          render_input_blockers: [
            "final_narration_audio_stale_after_public_copy_repair",
            "word_timestamps_stale_after_public_copy_repair",
          ],
        }),
      ],
    },
    generatedAt: "2026-05-22T09:11:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.jobs[0].force_final_render, true);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, [
    "final_narration_audio_stale_after_public_copy_repair",
    "word_timestamps_stale_after_public_copy_repair",
  ]);
});

test("render input work order routes stale duration-variant audio through the audio regeneration lane", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-22T10:10:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "stale-duration-story",
          title: "Hades II Finally Has A Console Date",
          force_final_render: true,
          render_input_blockers: [
            "final_narration_audio_stale_after_duration_variant_repair",
            "word_timestamps_stale_after_duration_variant_repair",
          ],
        }),
      ],
    },
    generatedAt: "2026-05-22T10:11:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.jobs[0].force_final_render, true);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, [
    "final_narration_audio_stale_after_duration_variant_repair",
    "word_timestamps_stale_after_duration_variant_repair",
  ]);
});

test("render input work order routes stale pronunciation-policy audio through the audio regeneration lane", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T08:05:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "stale-pronunciation-story",
          title: "Hades II Finally Has A Console Date",
          force_final_render: true,
          render_input_blockers: [
            "final_narration_audio_stale_after_pronunciation_repair",
            "word_timestamps_stale_after_pronunciation_repair",
          ],
        }),
      ],
    },
    generatedAt: "2026-05-26T08:06:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.jobs[0].force_final_render, true);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, [
    "final_narration_audio_stale_after_pronunciation_repair",
    "word_timestamps_stale_after_pronunciation_repair",
  ]);
});

test("render input work order routes non-ASR local timestamps through the audio alignment lane", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T10:15:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "local-asr-required",
          title: "Forza Needs Better Caption Timing",
          force_final_render: true,
          render_input_blockers: ["word_timestamps_not_asr_aligned"],
          render_input_evidence: {
            word_timestamp_source: "local_audio_silence_anchored",
            word_timestamp_alignment_required: "local_whisper_word_alignment",
          },
        }),
      ],
    },
    generatedAt: "2026-05-26T10:16:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, [
    "word_timestamps_not_asr_aligned",
  ]);
});

test("render input work order emits one audio repair action for overlapping timestamp blockers", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-27T09:00:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "overlap-audio-story",
          title: "Hades II Needs Exact Caption Timing",
          force_final_render: true,
          render_input_blockers: [
            "word_timestamps_missing",
            "word_timestamps_not_asr_aligned",
            "final_narration_audio_missing",
          ],
          render_input_evidence: {
            word_timestamp_source: "local_audio_silence_anchored",
            word_timestamp_alignment_required: "local_whisper_word_alignment",
          },
        }),
      ],
    },
    generatedAt: "2026-05-27T09:01:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.repair_backlog.summary.total_items, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, [
    "word_timestamps_missing",
    "word_timestamps_not_asr_aligned",
    "final_narration_audio_missing",
  ]);
});

test("render input work order routes incomplete ASR coverage through the audio alignment lane", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T16:15:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "partial-asr-coverage",
          title: "The Expanse Shows Real Gameplay",
          force_final_render: true,
          render_input_blockers: ["word_timestamps_asr_coverage_incomplete"],
          render_input_evidence: {
            word_timestamp_source: "local_whisper_word_alignment",
            word_timestamp_coverage_ratio: 0.42,
            word_timestamp_opening_covered: false,
          },
        }),
      ],
    },
    generatedAt: "2026-05-26T16:16:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, [
    "word_timestamps_asr_coverage_incomplete",
  ]);
});

test("render input work order routes missing direct-video evidence to real motion materialisation", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-23T16:20:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "direct-video-missing",
          title: "Hades 2 Needs Real Gameplay Motion",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    generatedAt: "2026-05-23T16:21:00.000Z",
  });

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["materialise_validated_real_motion_clips"],
  );
  assert.deepEqual(workOrder.jobs[0].actions[0].reason_codes, ["visual_evidence:direct_video_motion_missing"]);
  assert.equal(workOrder.jobs[0].actions[0].repair_lane, "validated_real_motion_materialisation");
  assert.equal(workOrder.jobs[0].actions[0].auto_repairable, true);
});

test("render input work order does not let stale scheduler preflight override ready final-render inputs", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T19:59:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "steam-controller-ready-inputs",
          title: "Steam Controller Date May Have Leaked",
          force_final_render: true,
          blockers: ["materialised_motion_newer_than_render"],
          render_input_status: "ready_for_final_render_job",
          render_input_blockers: [],
          render_input_evidence: {
            materialised_motion_clip_count: 18,
            distinct_motion_family_count: 14,
            real_visual_motion_clip_count: 5,
            real_visual_motion_family_count: 1,
            real_motion_input_readiness: {
              has_direct_video_motion: true,
              direct_video_motion_asset_count: 5,
              direct_video_motion_family_count: 1,
              real_visual_motion_clip_floor_met: true,
              total_motion_budget_met: true,
              direct_video_proof_plus_owned_motion_ready: true,
            },
          },
        }),
      ],
    },
    dryRunPlan: {
      blocked_stories: [
        {
          story_id: "steam-controller-ready-inputs",
          title: "Steam Controller Date May Have Leaked",
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
          ],
        },
      ],
    },
    generatedAt: "2026-05-26T20:00:00.000Z",
  });

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.jobs[0].status, "ready_for_final_render_job");
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["run_visual_v4_production_render"],
  );
  assert.deepEqual(workOrder.jobs[0].blockers, []);
  assert.deepEqual(workOrder.jobs[0].evidence.scheduler_preflight_blockers, [
    "preflight_candidate_not_publish_ready:review",
    "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
  ]);
});

test("render input work order stops auto-looping exhausted real-motion materialiser failures", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-25T21:25:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "screenshot-only-motion",
          title: "Star Wars Zero Company Is More Than XCOM",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
        blockedQueueItem({
          story_id: "no-direct-candidates",
          title: "PS5 Price Hike Rumour Hits Europe",
          render_input_blockers: [
            "materialised_motion_clips_missing",
            "real_visual_motion_clips_missing",
            "visual_evidence:direct_video_motion_missing",
          ],
        }),
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "screenshot-only-motion",
          status: "blocked",
          blockers: ["direct_video_motion_clip_missing"],
          candidate_count: 5,
          materialized_count: 5,
          direct_video_motion_clip_count: 0,
        },
        {
          story_id: "no-direct-candidates",
          status: "blocked",
          blockers: ["validated_direct_media_candidates_missing"],
          candidate_count: 0,
        },
      ],
    },
    generatedAt: "2026-05-25T21:26:00.000Z",
  });

  const [screenshotOnlyAction, noCandidateAction] = workOrder.jobs.map((job) => job.actions[0]);

  assert.equal(screenshotOnlyAction.repair_lane, "official_direct_video_source_required_after_materialization_exhausted");
  assert.equal(screenshotOnlyAction.auto_repairable, false);
  assert.equal(screenshotOnlyAction.operator_approval_required, true);
  assert.match(screenshotOnlyAction.exact_missing_input, /official direct-video source/i);
  assert.equal(screenshotOnlyAction.evidence.real_motion_blockers[0], "direct_video_motion_clip_missing");

  assert.equal(noCandidateAction.repair_lane, "official_direct_media_intake_required_after_materialization_exhausted");
  assert.equal(noCandidateAction.auto_repairable, false);
  assert.equal(noCandidateAction.operator_approval_required, true);
  assert.match(noCandidateAction.recommended_command, /official-source/i);
  assert.equal(noCandidateAction.evidence.candidate_count, 0);

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 2);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
  assert.equal(workOrder.summary.operator_required_jobs, 2);
});

test("render input work order surfaces partial real-motion evidence without treating it as publishable", () => {
  const partialEvidencePath = "C:/repo/output/goal-proof/batch/partial-official-motion/partial_real_motion_evidence.json";
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T09:45:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "partial-official-motion",
          title: "Xbox Controller Deal Has One Catch",
          render_input_blockers: [
            "real_visual_motion_clips_missing",
            "real_visual_motion_families_insufficient",
          ],
        }),
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "partial-official-motion",
          status: "blocked",
          blockers: ["real_motion_clip_minimum_not_met", "real_motion_family_minimum_not_met"],
          candidate_count: 3,
          materialized_count: 3,
          distinct_motion_family_count: 1,
          direct_video_motion_clip_count: 3,
          partial_evidence_path: partialEvidencePath,
          partial_evidence_clip_count: 3,
          partial_evidence_counts_towards_final_render_readiness: false,
        },
      ],
    },
    generatedAt: "2026-05-28T09:46:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];

  assert.equal(action.action_id, "materialise_validated_real_motion_clips");
  assert.equal(action.repair_lane, "additional_official_motion_family_required");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.exact_missing_input, /at least 5 validated real-motion clips/i);
  assert.equal(action.evidence.partial_evidence_path, partialEvidencePath);
  assert.equal(action.evidence.partial_evidence_clip_count, 3);
  assert.equal(action.evidence.partial_evidence_counts_towards_final_render_readiness, false);
  assert.equal(action.evidence.materialized_count, 3);
  assert.equal(action.evidence.distinct_motion_family_count, 1);
  assert.equal(action.evidence.direct_video_motion_clip_count, 3);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
});

test("render input work order marks resolved official references as segment-validation repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T01:30:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "resolved-official-ref",
          title: "The Expanse Shows Real Gameplay",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "resolved-official-ref",
          source_family_candidates: [
            {
              source_family: "steam_3727390_2016455987",
              source_url: "https://video.akamai.steamstatic.com/store_trailers/3727390/hls_264_master.m3u8",
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-24T01:31:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "validate_resolved_official_reference_segments");
  assert.equal(action.auto_repairable, true);
  assert.equal(action.operator_approval_required, false);
  assert.match(action.recommended_command, /media:validate-trailer-segments/);
  assert.match(action.recommended_command, /resolved-official-ref/);
  assert.match(action.post_repair_validation_command, /ops:v4-motion-pack/);
  assert.match(action.post_repair_validation_command, /--stories/);
  assert.match(action.post_repair_validation_command, /canonical_story_manifest\.json/);
  assert.match(action.post_repair_validation_command, /resolved-official-ref/);
  assert.equal(workOrder.summary.auto_repairable_jobs, 1);
  assert.equal(workOrder.summary.operator_required_jobs, 0);
});

test("render input work order routes search-only motion gaps to operator source intake", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T01:35:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "search-only-motion",
          title: "Xbox Controller Deal Has One Catch",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "search-only-motion",
          source_family_candidates: [],
          official_search_actions: [
            {
              query: "Xbox Controller official gameplay trailer",
              status: "official_search_required",
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-24T01:36:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "official_source_search_required");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.recommended_command, /visual_v4_official_search_template_remaining\.json/);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
});

test("render input work order routes source-proofed motion gaps to direct-media intake", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-27T16:20:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "source-proof-only-motion",
          title: "Super Mario RPG Drops To $15",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "source-proof-only-motion",
          source_proof_covered_target_entities: ["Super Mario RPG"],
          source_proof_missing_target_entities: [],
          source_family_candidates: [
            {
              source_family: "nintendo_store_super_mario_rpg",
              source_url: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
              source_url_kind: "html_or_unknown_page",
              status: "needs_direct_media_url",
            },
          ],
          official_search_actions: [],
        },
      ],
    },
    generatedAt: "2026-05-27T16:21:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "official_direct_media_search_required");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.exact_missing_input, /direct-media URL/);
  assert.match(action.recommended_command, /official source proof already exists/i);
  assert.equal(action.evidence.source_proof_covered_target_entities[0], "Super Mario RPG");
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
});

test("render input work order routes malformed story entities to public-copy repair before source search", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T01:38:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "bad-subject",
          title: "Capturing Has One Player Question",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "bad-subject",
          primary_story_entity: "Capturing",
          source_family_candidates: [],
          official_search_actions: [],
          source_search_blockers: ["generic_gerund_primary_entity"],
        },
      ],
    },
    generatedAt: "2026-05-24T01:39:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "canonical_subject_repair_required_before_motion_search");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.recommended_command, /public copy/i);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  assert.equal(workOrder.summary.dead_end_blocker_jobs, 1);
});

test("render input work order routes non-game visual blockers to owned visual planning", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T01:39:30.000Z",
      queue: [
        blockedQueueItem({
          story_id: "kadokawa-stake",
          title: "Kadokawa Stake Just Passed Sony",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "kadokawa-stake",
          primary_story_entity: "Kadokawa",
          source_family_candidates: [],
          official_search_actions: [],
          source_search_blockers: [
            "corporate_transaction_requires_owned_explainer_visual_plan",
          ],
        },
      ],
    },
    generatedAt: "2026-05-24T01:39:45.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(workOrder.jobs[0].actions.length, 1);
  assert.equal(action.action_id, "materialise_owned_generated_motion_clips");
  assert.equal(action.repair_lane, "owned_generated_explainer_motion_materialisation");
  assert.equal(action.auto_repairable, true);
  assert.equal(action.operator_approval_required, false);
  assert.equal(action.dead_end_blocker, false);
  assert.match(action.exact_missing_input, /owned.*visual plan/i);
  assert.ok(
    action.evidence.source_search_blockers.includes(
      "corporate_transaction_requires_owned_explainer_visual_plan",
    ),
  );
  assert.equal(workOrder.summary.owned_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 1);
});

test("render input work order stops rerunning owned motion after generated-only selected deck fails benchmark", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-27T17:40:00.000Z",
      queue: [],
      blocked: [
        {
          story_id: "kadokawa-stale-owned-deck",
          title: "Kadokawa Stake Just Passed Sony",
          artifact_dir: "C:/repo/output/goal-proof/batch/kadokawa-stale-owned-deck",
          blockers: [
            "scheduler_candidate_benchmark_not_pass",
            "scheduler_candidate:gold_standard:visual_evidence:generated_only_motion_deck",
            "scheduler_candidate:gold_standard:visual_evidence:no_real_visual_media_asset",
            "scheduler_candidate:benchmark_below_production_threshold:motion_density_score",
          ],
          owned_explainer_motion_ready: true,
          owned_explainer_exception_approved: true,
          visual_evidence_profile: {
            generated_only_motion_deck: true,
            real_media_asset_count: 0,
            real_motion_asset_count: 0,
            direct_video_motion_asset_count: 0,
          },
        },
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "kadokawa-stale-owned-deck",
          primary_story_entity: "Kadokawa",
          source_family_candidates: [],
          official_search_actions: [],
          source_search_blockers: [
            "corporate_transaction_requires_owned_explainer_visual_plan",
          ],
        },
      ],
    },
    generatedAt: "2026-05-27T17:41:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.owned_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.action_id, "materialise_validated_real_motion_clips");
  assert.equal(action.repair_lane, "real_visual_media_required_after_owned_explainer_deck_failed_benchmark");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.recommended_command, /do not rerun owned-motion/i);
  assert.ok(action.evidence.owned_explainer_motion_ready);
  assert.ok(action.evidence.cutover_blockers.includes("scheduler_candidate_benchmark_not_pass"));
});

test("render input work order exposes official search actions after generated-only deck fails benchmark", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T10:00:00.000Z",
      blocked: [
        {
          story_id: "xbox-controller-owned-deck",
          title: "Xbox Controller Deal Has One Catch",
          artifact_dir: "C:/repo/output/goal-proof/batch/xbox-controller-owned-deck",
          blockers: [
            "benchmark_not_pass",
            "benchmark_below_production_threshold:motion_density_score",
            "benchmark_below_production_threshold:media_house_polish_score",
          ],
          owned_explainer_motion_ready: true,
          owned_explainer_exception_approved: true,
          visual_evidence_profile: {
            generated_only_motion_deck: true,
            real_media_asset_count: 0,
            real_motion_asset_count: 0,
            direct_video_motion_asset_count: 0,
            blockers: [
              "visual_evidence:generated_only_motion_deck",
              "visual_evidence:no_real_visual_media_asset",
            ],
          },
        },
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "xbox-controller-owned-deck",
          primary_story_entity: "Xbox Controller",
          source_family_candidates: [],
          official_search_actions: [
            {
              query: "Xbox Controller official product video",
              status: "official_search_required",
              accepted_source_types: [
                "official_product_page",
                "official_platform_channel",
              ],
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-28T10:01:00.000Z",
  });

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.action_id, "materialise_validated_real_motion_clips");
  assert.equal(action.repair_lane, "official_source_search_after_generated_only_benchmark_failure");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.recommended_command, /visual_v4_official_search_template_remaining\.json/);
  assert.match(action.recommended_command, /do not rerun owned-motion/i);
  assert.equal(action.evidence.official_search_action_count, 1);
  assert.equal(action.evidence.first_query, "Xbox Controller official product video");
  assert.equal(action.evidence.primary_story_entity, "Xbox Controller");
});

test("render input work order exposes official direct-media gaps after generated-only deck fails benchmark", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T10:10:00.000Z",
      blocked: [
        {
          story_id: "xbox-controller-family-known",
          title: "Xbox Controller Deal Has One Catch",
          artifact_dir: "C:/repo/output/goal-proof/batch/xbox-controller-family-known",
          blockers: [
            "benchmark_not_pass",
            "benchmark_below_production_threshold:motion_density_score",
          ],
          owned_explainer_motion_ready: true,
          owned_explainer_exception_approved: true,
          visual_evidence_profile: {
            generated_only_motion_deck: true,
            real_media_asset_count: 0,
            real_motion_asset_count: 0,
            blockers: [
              "visual_evidence:generated_only_motion_deck",
              "visual_evidence:no_real_visual_media_asset",
            ],
          },
        },
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "xbox-controller-family-known",
          primary_story_entity: "Xbox Controller",
          source_family_candidates: [
            {
              source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
              source_url: "https://www.youtube.com/watch?v=oYhaW-Vr4wg",
              source_url_kind: "youtube_watch",
              status: "needs_direct_media_url",
            },
            {
              source_family: "xbox_wire_forza_horizon_6_developer_direct_breakdown",
              source_url: "https://news.xbox.com/en-us/2026/01/22/forza-horizon-6-developer-direct-breakdown-interview/",
              source_url_kind: "html_or_unknown_page",
              status: "needs_direct_media_url",
            },
          ],
          official_search_actions: [],
          source_search_blockers: [],
        },
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "xbox-controller-family-known",
          status: "blocked",
          blockers: ["real_motion_clip_minimum_not_met", "real_motion_family_minimum_not_met"],
          materialized_count: 3,
          distinct_motion_family_count: 1,
          direct_video_motion_clip_count: 3,
          partial_evidence_path:
            "C:/repo/output/goal-proof/batch/xbox-controller-family-known/partial_real_motion_evidence.json",
          partial_evidence_clip_count: 3,
          partial_evidence_counts_towards_final_render_readiness: false,
        },
      ],
    },
    generatedAt: "2026-05-28T10:11:00.000Z",
  });

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.action_id, "materialise_validated_real_motion_clips");
  assert.equal(action.repair_lane, "official_direct_media_search_after_generated_only_benchmark_failure");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.recommended_command, /direct-media URL/i);
  assert.match(action.recommended_command, /do not rerun owned-motion/i);
  assert.equal(action.evidence.source_family_candidate_count, 2);
  assert.equal(action.evidence.first_source_family, "xbox_official_youtube_forza_horizon_6_launch_trailer");
  assert.equal(action.evidence.primary_story_entity, "Xbox Controller");
  assert.equal(action.evidence.partial_evidence_clip_count, 3);
  assert.equal(action.evidence.partial_evidence_counts_towards_final_render_readiness, false);
  assert.equal(action.evidence.direct_video_motion_clip_count, 3);
  assert.equal(action.evidence.distinct_motion_family_count, 1);
});

test("render input work order routes stale owned motion through owned motion rematerialisation", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-25T21:05:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "stale-owned-motion",
          title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
          render_input_blockers: ["materialised_motion_stale_after_public_copy_repair"],
          render_input_evidence: {
            owned_explainer_motion_ready: true,
            stale_materialised_motion_clip_paths: [
              "C:/repo/output/generated-motion/stale-owned-motion/01_kinetic_title_card.mp4",
            ],
          },
        }),
      ],
    },
    generatedAt: "2026-05-25T21:06:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.action_id, "materialise_owned_generated_motion_clips");
  assert.equal(action.repair_lane, "owned_generated_explainer_motion_materialisation");
  assert.equal(action.auto_repairable, true);
  assert.equal(action.operator_approval_required, false);
  assert.deepEqual(action.reason_codes, ["materialised_motion_stale_after_public_copy_repair"]);
  assert.match(action.recommended_command, /--refresh-existing\b/);
  assert.equal(workOrder.summary.owned_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 1);
});

test("render input work order does not keep rescanning exhausted trailer segments", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T01:40:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "exhausted-motion",
          title: "Star Wars Zero Company Is More Than XCOM",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "exhausted-motion",
          source_family_candidates: [
            { source_family: "steam_2075800_876175" },
          ],
        },
      ],
    },
    segmentValidationReports: [
      {
        segments: Array.from({ length: 6 }, (_, index) => ({
          story_id: "exhausted-motion",
          source_family: "steam_2075800_876175",
          status: "rejected",
          segment_validated: false,
          validation_reason: index % 2 ? "segment_lacks_gameplay_action_samples" : "segment_contains_low_detail_frame",
        })),
      },
    ],
    generatedAt: "2026-05-24T01:41:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "alternate_official_source_required_after_segment_validation_exhausted");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.dead_end_blocker, true);
  assert.equal(action.operator_approval_required, true);
  assert.match(action.recommended_command, /find a non-exhausted official source family/i);
  assert.equal(workOrder.summary.dead_end_blocker_jobs, 1);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
});

test("render input work order lets failed segment validation outrank stale real-motion materialiser blockers", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T07:25:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "attempted-official-motion",
          title: "Star Wars Zero Company Is More Than XCOM",
          render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "attempted-official-motion",
          source_family_candidates: [
            { source_family: "steam_star_wars_zero_company_announce_trailer" },
          ],
        },
      ],
    },
    segmentValidationReports: [
      {
        segments: Array.from({ length: 6 }, (_, index) => ({
          story_id: "attempted-official-motion",
          source_family: "steam_star_wars_zero_company_announce_trailer",
          status: "rejected",
          segment_validated: false,
          validation_reason: index % 2 ? "segment_lacks_gameplay_action_samples" : "segment_contains_low_detail_frame",
        })),
      },
    ],
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "attempted-official-motion",
          status: "blocked",
          blockers: ["direct_video_motion_clip_missing"],
          candidate_count: 5,
          materialized_count: 5,
          direct_video_motion_clip_count: 0,
        },
      ],
    },
    generatedAt: "2026-05-26T07:26:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "alternate_official_source_required_after_segment_validation_exhausted");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.dead_end_blocker, true);
  assert.equal(action.operator_approval_required, true);
  assert.equal(action.evidence.validated_segments, 0);
  assert.equal(action.evidence.rejected_segments, 6);
  assert.equal(workOrder.summary.dead_end_blocker_jobs, 1);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
});

test("render input work order does not let stale segment summaries overwrite detailed validation evidence", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T22:20:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "partial-motion-story",
          title: "The Expanse Shows Real Gameplay",
          render_input_blockers: ["real_visual_motion_clips_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "partial-motion-story",
          source_family_candidates: [
            { source_family: "steam_3727390_1896418716" },
          ],
        },
      ],
    },
    segmentValidationReports: [
      {
        segments: [
          {
            story_id: "partial-motion-story",
            source_family: "steam_3727390_1896418716",
            status: "validated",
            segment_validated: true,
            validation_reason: "official_storefront_trailer_motion_samples_passed",
          },
          {
            story_id: "partial-motion-story",
            source_family: "steam_3727390_2016455987",
            status: "validated",
            segment_validated: true,
            validation_reason: "official_storefront_trailer_motion_samples_passed",
          },
          {
            story_id: "partial-motion-story",
            source_family: "steam_3727390_2016455987",
            status: "rejected",
            segment_validated: false,
            segment_motion_class: "gameplay_action",
            validation_reason: "segment_contains_low_detail_frame",
          },
        ],
      },
      {
        story_id: "partial-motion-story",
        summary: {
          segments: 0,
          segments_validated: 0,
          segments_rejected: 0,
        },
      },
    ],
    generatedAt: "2026-05-26T22:21:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "additional_official_motion_family_required");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.equal(action.evidence.validated_segments, 2);
  assert.equal(action.evidence.rejected_segments, 1);
  assert.equal(action.evidence.source_family_count, 2);
});

test("render input work order does not inflate motion readiness from duplicate segment reports", () => {
  const duplicateClipReports = [
    {
      generated_at: "2026-05-26T20:00:00.000Z",
      segments: [
        {
          story_id: "duplicate-motion-story",
          clip_key: "steam-clip-a",
          source_family: "steam_3727390_1896418716",
          media_start_s: 12,
          status: "validated",
          segment_validated: true,
          validation_reason: "official_storefront_trailer_motion_samples_passed",
        },
        {
          story_id: "duplicate-motion-story",
          clip_key: "steam-clip-b",
          source_family: "steam_3727390_2016455987",
          media_start_s: 20,
          status: "validated",
          segment_validated: true,
          validation_reason: "official_storefront_trailer_motion_samples_passed",
        },
      ],
    },
    {
      generated_at: "2026-05-26T21:00:00.000Z",
      segments: [
        {
          story_id: "duplicate-motion-story",
          clip_key: "steam-clip-a",
          source_url: "https://video.akamai.steamstatic.com/store_trailers/3727390/1896418716/video/hls_264_master.m3u8",
          media_start_s: 12,
          status: "validated",
          segment_validated: true,
          validation_reason: "trimmed_official_storefront_detail_motion_samples_passed",
        },
        {
          story_id: "duplicate-motion-story",
          clip_key: "steam-clip-b",
          source_url: "https://video.akamai.steamstatic.com/store_trailers/3727390/2016455987/video/hls_264_master.m3u8",
          media_start_s: 20,
          status: "validated",
          segment_validated: true,
          validation_reason: "trimmed_official_storefront_detail_motion_samples_passed",
        },
      ],
    },
    {
      generated_at: "2026-05-26T22:00:00.000Z",
      segments: [
        {
          story_id: "duplicate-motion-story",
          clip_key: "steam-clip-a",
          movie_id: "1896418716",
          media_start_s: 12,
          status: "validated",
          segment_validated: true,
          validation_reason: "official_storefront_trailer_motion_samples_passed",
        },
        {
          story_id: "duplicate-motion-story",
          clip_key: "steam-clip-b",
          movie_id: "2016455987",
          media_start_s: 20,
          status: "validated",
          segment_validated: true,
          validation_reason: "official_storefront_trailer_motion_samples_passed",
        },
      ],
    },
  ];
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T22:05:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "duplicate-motion-story",
          title: "The Expanse Shows Real Gameplay",
          render_input_blockers: ["real_visual_motion_clips_missing"],
        }),
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "duplicate-motion-story",
          source_family_candidates: [
            { source_family: "steam_3727390_1896418716" },
          ],
        },
      ],
    },
    segmentValidationReports: duplicateClipReports,
    generatedAt: "2026-05-26T22:06:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "additional_official_motion_family_required");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.equal(action.evidence.validated_segments, 2);
  assert.equal(action.evidence.source_family_count, 2);
});

test("render input work order names direct-video floor gaps after real motion exists", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-27T10:20:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "direct-floor-gap",
          title: "Forza Horizon 6 Needs One More Direct Clip",
          render_input_blockers: ["direct_video_motion_clip_floor_not_met"],
          render_input_evidence: {
            real_visual_motion_clip_count: 5,
            distinct_motion_family_count: 5,
            real_motion_input_readiness: {
              has_direct_video_motion: true,
              direct_video_motion_asset_count: 4,
              direct_video_motion_family_count: 4,
              direct_video_motion_clip_floor: 5,
              direct_video_motion_clip_floor_met: false,
              materialised_real_motion_clip_floor_met: true,
            },
          },
        }),
      ],
    },
    generatedAt: "2026-05-27T10:21:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "additional_direct_video_motion_required");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.equal(action.reason_codes.includes("direct_video_motion_clip_floor_not_met"), true);
  assert.match(action.exact_missing_input, /5 direct-video motion clips/i);
  assert.ok(action.output_expectations.some((line) => /direct-video motion clips/i.test(line)));
  assert.equal(action.evidence.direct_video_motion_asset_count, 4);
  assert.equal(action.evidence.direct_video_motion_clip_floor, 5);
});

test("render input work order prefers fresh real-motion direct counts over stale cutover evidence", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T10:50:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "expanse-direct-refresh",
          title: "The Expanse Shows Real Gameplay",
          render_input_blockers: ["direct_video_motion_clip_floor_not_met"],
          render_input_evidence: {
            real_visual_motion_clip_count: 8,
            real_motion_input_readiness: {
              has_direct_video_motion: true,
              direct_video_motion_asset_count: 2,
              direct_video_motion_family_count: 2,
              direct_video_motion_clip_floor: 5,
              direct_video_motion_clip_floor_met: false,
              materialised_real_motion_clip_floor_met: true,
            },
          },
        }),
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "expanse-direct-refresh",
          status: "materialized",
          candidate_count: 12,
          materialized_count: 8,
          distinct_motion_family_count: 8,
          direct_video_motion_clip_count: 3,
          direct_video_motion_family_count: 3,
          total_direct_video_motion_asset_count: 3,
          total_direct_video_motion_family_count: 3,
          total_motion_clip_count: 8,
        },
      ],
    },
    generatedAt: "2026-05-28T10:51:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "additional_direct_video_motion_required");
  assert.equal(action.evidence.direct_video_motion_asset_count, 3);
  assert.equal(action.evidence.direct_video_motion_family_count, 3);
  assert.equal(action.evidence.direct_video_motion_clip_count, 3);
  assert.equal(action.evidence.total_direct_video_motion_family_count, 3);
  assert.equal(action.evidence.materialized_count, 8);
  assert.match(action.recommended_command, /Find 2 more rights-backed official direct-video sources/i);
});

test("render input work order uses fresh materialised direct-video count even when stale cutover evidence is higher", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T14:57:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "controller-single-cinemagraph",
          title: "Xbox Controller Deal Has One Catch",
          render_input_blockers: ["direct_video_motion_clip_floor_not_met"],
          render_input_evidence: {
            real_visual_motion_clip_count: 6,
            visual_evidence_profile: {
              direct_video_motion_asset_count: 2,
              direct_video_motion_family_count: 1,
            },
            real_motion_input_readiness: {
              has_direct_video_motion: true,
              direct_video_motion_asset_count: 2,
              direct_video_motion_family_count: 1,
              direct_video_motion_clip_floor: 5,
              direct_video_motion_clip_floor_met: false,
              materialised_real_motion_clip_floor_met: true,
            },
          },
        }),
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "controller-single-cinemagraph",
          status: "materialized",
          candidate_count: 7,
          materialized_count: 6,
          distinct_motion_family_count: 6,
          direct_video_motion_clip_count: 1,
          direct_video_motion_family_count: 1,
          total_direct_video_motion_asset_count: 1,
          total_direct_video_motion_family_count: 1,
          total_motion_clip_count: 6,
        },
      ],
    },
    generatedAt: "2026-05-28T15:05:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "additional_direct_video_motion_required");
  assert.equal(action.evidence.direct_video_motion_asset_count, 1);
  assert.equal(action.evidence.stale_cutover_direct_video_motion_asset_count, 2);
  assert.equal(action.evidence.missing_direct_video_motion_clip_count, 4);
  assert.match(action.recommended_command, /Find 4 more rights-backed official direct-video sources/i);
});

test("render input work order refreshes stale cutover after fresh real-motion clears the direct-video floor", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T10:50:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "expanse-direct-cleared",
          title: "The Expanse Shows Real Gameplay",
          render_input_blockers: ["direct_video_motion_clip_floor_not_met"],
          render_input_evidence: {
            real_visual_motion_clip_count: 8,
            real_motion_input_readiness: {
              has_direct_video_motion: true,
              direct_video_motion_asset_count: 2,
              direct_video_motion_family_count: 2,
              direct_video_motion_clip_floor: 5,
              direct_video_motion_clip_floor_met: false,
              materialised_real_motion_clip_floor_met: true,
            },
          },
        }),
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "expanse-direct-cleared",
          status: "materialized",
          candidate_count: 14,
          materialized_count: 8,
          distinct_motion_family_count: 7,
          direct_video_motion_clip_count: 5,
          direct_video_motion_family_count: 4,
          total_direct_video_motion_asset_count: 5,
          total_direct_video_motion_family_count: 4,
          total_motion_clip_count: 8,
        },
      ],
    },
    generatedAt: "2026-05-28T11:18:00.000Z",
  });

  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["refresh_stale_render_qa_state"],
  );
  assert.equal(workOrder.jobs[0].actions[0].repair_lane, "stale_cutover_after_real_motion_repair");
  assert.equal(workOrder.jobs[0].actions[0].auto_repairable, true);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.stale_qa_refresh_jobs, 1);
});

test("render input work order refreshes stale generated-only cutover after fresh direct-video motion exists", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T13:49:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "mario-storefront-repaired",
          title: "Super Mario RPG Drops To $15",
          render_input_blockers: [
            "visual_evidence:generated_only_motion_deck",
            "visual_evidence:no_real_visual_media_asset",
          ],
          render_input_evidence: {
            cutover_blockers: [
              "benchmark_not_pass",
              "benchmark_below_production_threshold:motion_density_score",
              "benchmark_below_production_threshold:media_house_polish_score",
            ],
            owned_explainer_motion_ready: true,
            owned_explainer_exception_approved: true,
            visual_evidence_profile: {
              generated_only_motion_deck: true,
              real_media_asset_count: 0,
              direct_video_motion_asset_count: 0,
              blockers: [
                "visual_evidence:generated_only_motion_deck",
                "visual_evidence:no_real_visual_media_asset",
              ],
            },
          },
        }),
      ],
    },
    realMotionMaterializationReport: {
      jobs: [
        {
          story_id: "mario-storefront-repaired",
          status: "materialized",
          candidate_count: 11,
          materialized_count: 11,
          distinct_motion_family_count: 6,
          direct_video_motion_clip_count: 11,
          direct_video_motion_family_count: 6,
          total_direct_video_motion_asset_count: 11,
          total_direct_video_motion_family_count: 6,
          total_motion_clip_count: 11,
        },
      ],
    },
    generatedAt: "2026-05-28T14:35:00.000Z",
  });

  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["refresh_stale_render_qa_state"],
  );
  assert.equal(workOrder.jobs[0].actions[0].repair_lane, "stale_cutover_after_real_motion_repair");
  assert.equal(workOrder.jobs[0].actions[0].auto_repairable, true);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.stale_qa_refresh_jobs, 1);
});

test("render input work order converts incident guard blockers into repair lanes", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    incidentGuardReport: {
      generated_at: "2026-05-22T16:55:00.000Z",
      stories: [
        {
          story_id: "incident-story",
          title: "Nintendo Switch 2 Just Got More Expensive",
          artifact_dir: "C:/repo/output/goal-proof/batch/incident-story",
          disaster_upload_blockers: [
            "incident:narration_missing",
            "incident:word_timestamps_missing",
            "incident:thumbnail_title_script_mismatch",
          ],
          file_evidence: {
            mp4_ready: true,
            captions_ready: true,
            materialised_motion_ready: true,
            rights_ledger_ready: true,
          },
        },
      ],
    },
    generatedAt: "2026-05-22T16:56:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.summary.public_output_repair_jobs, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "generate_final_narration_audio_and_word_timestamps",
      "repair_public_output_coherence",
    ],
  );
  assert.ok(workOrder.jobs[0].blockers.includes("word_timestamps_missing"));
  assert.ok(workOrder.jobs[0].blockers.includes("public_output_coherence_mismatch"));
});

test("render input work order blocks auto motion repair when public copy is a dead-end image post", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-input-public-copy-qa-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "image-only-story",
    canonical_subject: "Capturing",
    canonical_game: "Capturing",
    selected_title: "Capturing Has One Player Question",
    first_spoken_line: "Capturing Has One Player Question.",
    narration_script:
      "Capturing Has One Player Question. I reports Capturing mewtwo in the office shh. The practical question is whether this changes what people play next.",
    description: "Capturing mewtwo in the office shh. Source: I.",
    primary_source: "I",
    source_card_label: "I",
    primary_source_url: "https://i.redd.it/example.jpeg",
    confirmed_claims: ["Capturing mewtwo in the office shh"],
  });

  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T18:59:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "image-only-story",
          title: "",
          artifact_dir: artifactDir,
          render_input_blockers: [
            "materialised_motion_clips_missing",
            "real_visual_motion_clips_missing",
          ],
        }),
      ],
    },
    generatedAt: "2026-05-24T19:00:00.000Z",
  });

  assert.equal(workOrder.summary.public_output_repair_jobs, 1);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.auto_repairable_jobs, 0);
  assert.equal(workOrder.jobs[0].title, "Capturing Has One Player Question");
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["repair_public_output_coherence"],
  );
  assert.ok(workOrder.jobs[0].blockers.includes("public_copy_repair_required"));
  assert.ok(workOrder.jobs[0].evidence.public_copy_qa.failures.includes("public_copy:non_news_image_post_source"));
  const publicCopyAction = workOrder.jobs[0].actions.find((action) => action.action_id === "repair_public_output_coherence");
  assert.equal(publicCopyAction.repair_lane, "reject_or_human_review_non_news_image_post");
  assert.equal(publicCopyAction.auto_repairable, false);
  assert.equal(publicCopyAction.operator_approval_required, true);
  assert.equal(publicCopyAction.dead_end_blocker, true);
  assert.match(publicCopyAction.exact_missing_input, /Reject the story/i);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
});

test("render input work order includes cutover-blocked public-copy stories in the repair backlog", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T07:45:00.000Z",
      queue: [],
      blocked: [
        {
          story_id: "blocked-public-copy",
          title: "Capturing Has One Player Question",
          artifact_dir: "C:/repo/output/goal-proof/batch/blocked-public-copy",
          status: "blocked",
          blockers: [
            "public_copy:weak_title_pattern",
            "public_copy:malformed_primary_source_label",
            "public_copy:non_news_image_post_source",
          ],
          public_copy_qa: {
            verdict: "fail",
            failures: [
              "public_copy:weak_title_pattern",
              "public_copy:malformed_primary_source_label",
              "public_copy:non_news_image_post_source",
            ],
          },
        },
      ],
    },
    generatedAt: "2026-05-26T07:46:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.public_output_repair_jobs, 1);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  assert.equal(workOrder.repair_backlog.summary.total_items, 1);
  const job = workOrder.jobs[0];
  assert.equal(job.story_id, "blocked-public-copy");
  assert.ok(job.blockers.includes("public_copy_repair_required"));
  assert.ok(job.blockers.includes("source_label_consistency_repair_required"));
  const action = job.actions[0];
  assert.equal(action.action_id, "repair_public_output_coherence");
  assert.equal(action.repair_lane, "reject_or_human_review_non_news_image_post");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.operator_approval_required, true);
  assert.equal(action.dead_end_blocker, true);
  assert.match(action.exact_missing_input, /Reject the story/i);
});

test("render input work order emits executable public-copy repair commands", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T08:20:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "formulaic-public-copy",
          title: "Forza Horizon 6 Finally Hit Steam",
          render_input_blockers: ["public_copy_repair_required"],
          render_input_evidence: {
            public_copy_qa: {
              verdict: "fail",
              failures: ["public_copy:formulaic_public_narration"],
            },
          },
        }),
      ],
    },
    generatedAt: "2026-05-26T08:21:00.000Z",
  });

  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.action_id, "repair_public_output_coherence");
  assert.equal(action.auto_repairable, true);
  assert.match(action.recommended_command, /ops:goal-public-copy-repair/);
  assert.match(action.recommended_command, /--story-packages output\/goal-contract\/production_cutover_story_packages\.json/);
  assert.doesNotMatch(action.recommended_command, /--work-order\b/);
});

test("render input work order routes short final renders to normal-duration repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T21:10:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "short-final-render",
          title: "Kadokawa Stake Just Passed Sony",
          force_final_render: true,
          render_input_status: "ready_for_final_render_job",
          render_input_blockers: [],
          blockers: ["normal_production_duration_below_quality_floor:18"],
          rendered_duration_s: 17.933,
        }),
      ],
    },
    generatedAt: "2026-05-26T21:11:00.000Z",
  });

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(workOrder.summary.normal_duration_repair_jobs, 1);
  assert.equal(workOrder.jobs[0].status, "blocked_on_render_inputs");
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["repair_normal_production_duration"],
  );
  const action = workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "normal_production_duration_floor");
  assert.equal(action.auto_repairable, true);
  assert.match(action.recommended_command, /ops:goal-normal-duration-repair/);
  assert.match(action.recommended_command, /--work-order output\/goal-contract\/normal_duration_repair_work_order\.json/);
  assert.match(action.recommended_command, /--story-id short-final-render/);
});

test("render input work order does not reintroduce stale dry-run blockers after fresh cutover", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T04:42:51.097Z",
      blocked: [
        {
          story_id: "duration-repaired-story",
          title: "Kadokawa Stake Just Passed Sony",
          artifact_dir: "C:/repo/output/goal-proof/batch/duration-repaired-story",
          status: "blocked",
          blockers: [
            "benchmark_not_pass",
            "benchmark_below_production_threshold:motion_density_score",
          ],
          rendered_duration_s: 50.267,
        },
      ],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T02:24:59.679Z",
      blocked_stories: [
        {
          story_id: "duration-repaired-story",
          title: "Kadokawa Stake Just Passed Sony",
          artifact_dir: "C:/repo/output/goal-proof/batch/duration-repaired-story",
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
          ],
          rendered_duration_s: 21.44,
        },
      ],
    },
    generatedAt: "2026-05-28T04:43:07.881Z",
  });

  assert.equal(workOrder.summary.story_count, 0);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.summary.normal_duration_repair_jobs, 0);
  assert.equal(workOrder.source_dry_run_loaded, false);
  assert.equal(workOrder.source_dry_run_ignored_as_stale, true);
});

test("render input work order routes strict dry-run bridge motion blockers into repair backlog", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-26T13:40:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-26T13:43:00.000Z",
      blocked_stories: [
        {
          story_id: "xbox-feedback",
          artifact_dir: "C:/repo/output/goal-proof/batch/xbox-feedback",
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
          ],
          incident_guard: {
            evidence: {
              title: "Xbox Fans Used Feedback To Demand Exclusives",
              canonical_subject: "Xbox",
            },
          },
        },
      ],
    },
    sourceFamilyAcquisitionReport: {
      rows: [
        {
          story_id: "xbox-feedback",
          source_search_blockers: ["broad_platform_story_requires_specific_visual_plan"],
          primary_story_entity: "Xbox",
        },
      ],
    },
    generatedAt: "2026-05-26T13:44:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.owned_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 1);
  assert.equal(workOrder.repair_backlog.summary.total_items, 1);
  const job = workOrder.jobs[0];
  assert.equal(job.story_id, "xbox-feedback");
  assert.equal(job.title, "Xbox Fans Used Feedback To Demand Exclusives");
  assert.ok(job.blockers.includes("visual_evidence:direct_video_motion_missing"));
  assert.ok(
    job.evidence.scheduler_preflight_blockers.includes(
      "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
    ),
  );
  const action = job.actions[0];
  assert.equal(action.action_id, "materialise_owned_generated_motion_clips");
  assert.equal(action.repair_lane, "owned_generated_explainer_motion_materialisation");
  assert.equal(action.auto_repairable, true);
  assert.equal(action.operator_approval_required, false);
});

test("render input work order routes strict dry-run script and sound benchmark blockers into repair backlog", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T12:00:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T12:05:00.000Z",
      blocked_stories: [
        {
          story_id: "script-weak-story",
          artifact_dir: "C:/repo/output/goal-proof/batch/script-weak-story",
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:script_scorecard:script_score_below_threshold",
          ],
          incident_guard: {
            evidence: {
              title: "Forza Horizon 6 Reviews Are In",
              canonical_subject: "Forza Horizon 6",
            },
          },
        },
        {
          story_id: "sound-stale-story",
          artifact_dir: "C:/repo/output/goal-proof/batch/sound-stale-story",
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:aggregate_benchmark:upstream:goal09_sound_design_engine_blocked",
          ],
          incident_guard: {
            evidence: {
              title: "Star Wars Zero Company Is More Than XCOM",
              canonical_subject: "Star Wars Zero Company",
            },
          },
        },
      ],
    },
    generatedAt: "2026-05-28T12:06:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 2);
  assert.equal(workOrder.summary.script_scorecard_repair_jobs, 1);
  assert.equal(workOrder.summary.sound_benchmark_repair_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 2);
  assert.equal(workOrder.repair_backlog.summary.total_items, 2);

  const scriptJob = workOrder.jobs.find((job) => job.story_id === "script-weak-story");
  assert.ok(scriptJob.blockers.includes("script_scorecard_repair_required"));
  assert.equal(scriptJob.actions[0].action_id, "repair_script_scorecard");
  assert.equal(scriptJob.actions[0].repair_lane, "script_rewrite_and_audio_rerender");
  assert.match(scriptJob.actions[0].recommended_command, /ops:goal-public-copy-repair/);
  assert.match(scriptJob.actions[0].post_repair_validation_command, /ops:next-publish-candidates/);

  const soundJob = workOrder.jobs.find((job) => job.story_id === "sound-stale-story");
  assert.ok(soundJob.blockers.includes("sound_design_benchmark_repair_required"));
  assert.equal(soundJob.actions[0].action_id, "repair_sound_design_benchmark");
  assert.equal(soundJob.actions[0].repair_lane, "sound_visual_benchmark_repair");
  assert.match(soundJob.actions[0].recommended_command, /ops:goal-sfx-evidence-repair/);
  assert.match(soundJob.actions[0].post_repair_validation_command, /ops:goal10-gold-standard-forensics/);
});

test("render input work order routes aggregate visual benchmark failures away from sound-only repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T12:00:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T12:08:00.000Z",
      blocked_stories: [
        {
          story_id: "aggregate-visual-story",
          artifact_dir: "C:/repo/output/goal-proof/batch/aggregate-visual-story",
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:aggregate_benchmark:upstream:goal09_sound_design_engine_blocked",
          ],
          scheduler_preflight: {
            status: "blocked",
            blockers: ["aggregate_benchmark:upstream:goal09_sound_design_engine_blocked"],
            checks: {
              aggregate_benchmark: {
                result: "fail",
                failures: [
                  "upstream:goal09_sound_design_engine_blocked",
                  "upstream:goal08_visual_v4_renderer_blocked",
                  "upstream:goal07_director_brain_blocked",
                  "director:unsuitable_duration",
                  "render:sfx_mix_policy_stale",
                  "render:visual_design_policy_stale",
                  "visual:gold_standard:motion_density_below_reference",
                  "visual:weak_motion_density",
                ],
              },
            },
          },
          incident_guard: {
            evidence: {
              title: "Star Wars Zero Company Is More Than XCOM",
              canonical_subject: "Star Wars Zero Company",
            },
          },
        },
      ],
    },
    generatedAt: "2026-05-28T12:09:00.000Z",
  });

  assert.equal(workOrder.summary.aggregate_benchmark_repair_jobs, 1);
  assert.equal(workOrder.summary.sound_benchmark_repair_jobs, 0);
  const job = workOrder.jobs.find((entry) => entry.story_id === "aggregate-visual-story");
  assert.ok(job.blockers.includes("aggregate_benchmark_repair_required"));
  assert.ok(!job.blockers.includes("sound_design_benchmark_repair_required"));
  assert.deepEqual(
    job.evidence.scheduler_preflight_failures.slice(-8),
    [
      "upstream:goal09_sound_design_engine_blocked",
      "upstream:goal08_visual_v4_renderer_blocked",
      "upstream:goal07_director_brain_blocked",
      "director:unsuitable_duration",
      "render:sfx_mix_policy_stale",
      "render:visual_design_policy_stale",
      "visual:gold_standard:motion_density_below_reference",
      "visual:weak_motion_density",
    ],
  );
  assert.equal(job.actions[0].action_id, "repair_aggregate_benchmark");
  assert.equal(job.actions[0].repair_lane, "aggregate_visual_director_benchmark_refresh");
  assert.match(job.actions[0].recommended_command, /ops:goal-production-render/);
  assert.match(job.actions[0].post_repair_validation_command, /ops:next-publish-candidates/);
});

test("render input work order routes public-copy-newer scheduler blockers to audio freshness repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T12:00:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T12:10:00.000Z",
      blocked_stories: [
        {
          story_id: "fresh-copy-stale-render",
          artifact_dir: "C:/repo/output/goal-proof/batch/fresh-copy-stale-render",
          blockers: ["public_copy_newer_than_render"],
          scheduler_preflight: {
            status: "blocked",
            blockers: ["public_copy_newer_than_render"],
            checks: {
              public_copy: { result: "pass", failures: [], warnings: [] },
              bridge_artifact_freshness: {
                result: "fail",
                failures: ["public_copy_newer_than_render"],
                warnings: [],
              },
            },
          },
          incident_guard: {
            evidence: {
              title: "Crimson Desert Is Already Live",
              canonical_subject: "Crimson Desert",
            },
          },
        },
      ],
    },
    generatedAt: "2026-05-28T12:11:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(workOrder.summary.public_output_repair_jobs, 0);
  const job = workOrder.jobs.find((entry) => entry.story_id === "fresh-copy-stale-render");
  assert.ok(job.blockers.includes("final_narration_audio_stale_after_public_copy_repair"));
  assert.ok(job.blockers.includes("word_timestamps_stale_after_public_copy_repair"));
  assert.ok(!job.blockers.includes("public_copy_repair_required"));
  assert.deepEqual(
    job.actions.map((action) => action.action_id),
    ["generate_final_narration_audio_and_word_timestamps"],
  );
  assert.match(job.actions[0].recommended_command, /ops:goal-audio-timestamps/);
});

test("render input work order routes dry-run title duplicates to event deduplication repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T13:20:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T13:21:00.000Z",
      blocked_stories: [
        {
          story_id: "forza-duplicate",
          title: "Forza Horizon 6 Scores 84 On PC Gamer",
          artifact_dir: "C:/repo/output/goal-proof/batch/forza-duplicate",
          blockers: ["title_duplicate:Forza Horizon 6 Scores 84 On PC Gamer"],
          scheduler_preflight: {
            status: "pass",
            blockers: [],
            checks: {
              aggregate_benchmark: { result: "pass", failures: [], warnings: [] },
            },
          },
          incident_guard: {
            evidence: {
              title: "Forza Horizon 6 Scores 84 On PC Gamer",
              canonical_subject: "Forza Horizon 6",
            },
          },
        },
      ],
    },
    generatedAt: "2026-05-28T13:22:00.000Z",
  });

  assert.equal(workOrder.summary.duplicate_title_repair_jobs, 1);
  const job = workOrder.jobs.find((entry) => entry.story_id === "forza-duplicate");
  assert.ok(job.blockers.includes("duplicate_title_repair_required"));
  assert.equal(job.actions[0].action_id, "resolve_duplicate_title_or_event");
  assert.equal(job.actions[0].repair_lane, "event_deduplication_or_angle_split");
  assert.equal(job.actions[0].operator_approval_required, true);
  assert.match(job.actions[0].recommended_command, /goal-public-copy-repair/);
  assert.match(job.actions[0].recommended_command, /--reserved-title "Forza Horizon 6 Scores 84 On PC Gamer"/);
  assert.match(job.actions[0].post_repair_validation_command, /goal-dry-run-publish/);
  assert.deepEqual(job.evidence.scheduler_preflight_blockers, [
    "title_duplicate:Forza Horizon 6 Scores 84 On PC Gamer",
  ]);
});

test("render input work order routes stale current-news incident failures to human review", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T21:44:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T22:57:00.000Z",
      blocked_stories: [
        {
          story_id: "stale-launch-story",
          title: "Crimson Desert Is Already Live",
          artifact_dir: "C:/repo/output/goal-proof/batch/stale-launch-story",
          blockers: [
            "incident:stale_temporal_claim",
            "incident:current_wording_on_old_event",
          ],
          scheduler_preflight: {
            status: "pass",
            blockers: [],
            checks: {
              public_copy: { result: "pass", failures: [], warnings: [] },
            },
          },
          incident_guard: {
            evidence: {
              title: "Crimson Desert Is Already Live",
              canonical_subject: "Crimson Desert",
              temporal_freshness: {
                stale_dated_claims: [
                  {
                    date_text: "March 19, 2026",
                    age_days: 70,
                  },
                ],
              },
            },
          },
        },
      ],
    },
    generatedAt: "2026-05-28T22:58:00.000Z",
  });

  assert.equal(workOrder.summary.stale_temporal_review_jobs, 1);
  const job = workOrder.jobs.find((entry) => entry.story_id === "stale-launch-story");
  assert.ok(job.blockers.includes("stale_temporal_story_review_required"));
  assert.equal(job.actions[0].action_id, "review_stale_temporal_story");
  assert.equal(job.actions[0].repair_lane, "stale_temporal_story_human_review");
  assert.equal(job.actions[0].operator_approval_required, true);
  assert.equal(job.actions[0].auto_repairable, false);
  assert.match(job.actions[0].recommended_command, /goal-public-copy-repair/);
  assert.match(job.actions[0].recommended_command, /stale-launch-story/);
  assert.deepEqual(job.evidence.scheduler_preflight_blockers, [
    "incident:stale_temporal_claim",
    "incident:current_wording_on_old_event",
  ]);
});

test("render input work order does not reopen stale temporal stories already rejected by review", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T21:44:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T22:57:00.000Z",
      skipped_stories: [
        {
          story_id: "stale-launch-story",
          status: "stale_temporal_rejected",
          reason: "reject_stale_current_news_candidate",
        },
      ],
    },
    incidentGuardReport: {
      generated_at: "2026-05-28T22:57:00.000Z",
      stories: [
        {
          story_id: "stale-launch-story",
          artifact_dir: "C:/repo/output/goal-proof/batch/stale-launch-story",
          disaster_upload_blockers: [
            "incident:stale_temporal_claim",
            "incident:current_wording_on_old_event",
          ],
          file_evidence: {},
        },
      ],
    },
    generatedAt: "2026-05-28T22:58:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 0);
  assert.equal(workOrder.summary.stale_temporal_review_jobs, 0);
  assert.equal(workOrder.repair_backlog.summary.total_items, 0);
});

test("render input work order does not reopen visual source stories already deferred by review", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T21:44:00.000Z",
      blocked: [
        {
          story_id: "visual-source-story",
          title: "Xbox Fans Used Feedback To Demand Exclusives",
          artifact_dir: "C:/repo/output/goal-proof/batch/visual-source-story",
          blockers: [
            "visual_evidence:generated_only_motion_deck",
            "visual_evidence:no_real_visual_media_asset",
          ],
          visual_evidence_profile: {
            generated_only_motion_deck: true,
            motion_asset_count: 8,
            real_media_asset_count: 0,
            blockers: [
              "visual_evidence:generated_only_motion_deck",
              "visual_evidence:no_real_visual_media_asset",
            ],
          },
        },
      ],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T22:57:00.000Z",
      skipped_stories: [
        {
          story_id: "visual-source-story",
          status: "visual_source_deferred",
          reason: "defer_until_rights_backed_media_available",
        },
      ],
    },
    generatedAt: "2026-05-28T22:58:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 0);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 0);
  assert.equal(workOrder.repair_backlog.summary.total_items, 0);
});

test("render input work order converts Goal 03 missing artefacts into executable repair lanes", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T09:56:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "artefact-gap-story",
          title: "Metroid Prime 4 Needs A Final Render",
          render_input_blockers: [
            "final_mp4_missing",
            "caption_file_missing",
            "render_manifest_missing",
            "audio_manifest_missing",
            "stale_qa_state",
          ],
        }),
      ],
    },
    generatedAt: "2026-05-24T09:57:00.000Z",
  });

  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "materialise_final_mp4",
      "generate_caption_file",
      "repair_render_manifest",
      "repair_audio_manifest",
      "refresh_stale_render_qa_state",
    ],
  );
  assert.equal(workOrder.summary.final_mp4_repair_jobs, 1);
  assert.equal(workOrder.summary.caption_repair_jobs, 1);
  assert.equal(workOrder.summary.manifest_repair_jobs, 2);
  assert.equal(workOrder.summary.stale_qa_refresh_jobs, 1);
  assert.equal(workOrder.repair_backlog.items.length, 5);
  for (const item of workOrder.repair_backlog.items) {
    assert.equal(typeof item.required_artefact_path, "string");
    assert.notEqual(item.required_artefact_path, "");
    assert.equal(item.db_mutation_needed, false);
    assert.equal(item.operator_approval_needed, false);
    assert.equal(typeof item.post_repair_validation_command, "string");
    assert.notEqual(item.post_repair_validation_command, "");
  }
  assert.equal(workOrder.post_repair_validation_plan.summary.validation_items, 5);
  assert.equal(
    workOrder.post_repair_validation_plan.items.every((item) => item.validation_command),
    true,
  );
});

test("render input work order converts held stale source-family dry-run warnings into operator repair lanes", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T21:44:00.000Z",
      queue: [],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T21:50:00.000Z",
      held_stories: [
        {
          story_id: "source-warning-story",
          title: "Xbox Controller Deal Has One Catch",
          artifact_dir: "C:/repo/output/goal-proof/batch/source-warning-story",
          status: "held_for_scheduler_warning",
          hold_reasons: ["preflight_warning_requires_operator_review"],
          blockers: ["preflight_qa_warn:bridge_motion_governance:stale_source_family_evidence_ignored"],
          incident_guard: {
            evidence: {
              canonical_subject: "Xbox Controller",
              title: "Xbox Controller Deal Has One Catch",
            },
          },
        },
      ],
    },
    generatedAt: "2026-05-28T21:51:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.operator_required_jobs, 1);
  assert.equal(workOrder.repair_backlog.summary.total_items, 1);
  assert.equal(workOrder.jobs[0].story_id, "source-warning-story");
  assert.ok(workOrder.jobs[0].blockers.includes("source_family_evidence_stale"));
  assert.equal(workOrder.jobs[0].actions[0].action_id, "refresh_source_family_governance_evidence");
  assert.equal(workOrder.jobs[0].actions[0].repair_lane, "refresh_bridge_source_family_evidence");
  assert.equal(workOrder.jobs[0].actions[0].operator_approval_required, true);
  assert.match(workOrder.jobs[0].actions[0].recommended_command, /v4-source-family-acquisition/);
  assert.match(workOrder.jobs[0].actions[0].post_repair_validation_command, /goal-dry-run-publish/);
});

test("render input work order does not turn held generated-only benchmark failures into auto refresh work", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T21:44:00.000Z",
      blocked: [
        {
          story_id: "generated-held-story",
          title: "Xbox Exclusives Are Back Under Review",
          artifact_dir: "C:/repo/output/goal-proof/batch/generated-held-story",
          blockers: [
            "benchmark_not_pass",
            "benchmark_below_production_threshold:motion_density_score",
            "benchmark_below_production_threshold:media_house_polish_score",
          ],
          owned_explainer_motion_ready: true,
          owned_explainer_exception_approved: true,
          visual_evidence_profile: {
            asset_count: 26,
            motion_asset_count: 26,
            generated_motion_asset_count: 26,
            real_media_asset_count: 0,
            generated_only_motion_deck: true,
            blockers: [
              "visual_evidence:generated_only_motion_deck",
              "visual_evidence:no_real_visual_media_asset",
            ],
          },
        },
      ],
    },
    dryRunPlan: {
      generated_at: "2026-05-28T21:50:00.000Z",
      held_stories: [
        {
          story_id: "generated-held-story",
          title: "Xbox Exclusives Are Back Under Review",
          status: "held_for_operator_source_review",
          hold_reasons: ["preflight_candidate_missing", "operator_source_review_required"],
          blockers: [
            "incident:benchmark_qa_failed",
            "incident:motion_density_too_low",
            "incident:below_benchmark_polish",
          ],
        },
      ],
    },
    generatedAt: "2026-05-28T21:51:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.aggregate_benchmark_repair_jobs, 0);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["materialise_validated_real_motion_clips"],
  );
});

test("render input work order uses incident file evidence to avoid false-ready candidates", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-24T09:58:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "false-ready-story",
          title: "Silksong Needs A Real MP4",
          render_input_status: "ready_for_final_render_job",
          render_input_blockers: [],
        }),
      ],
    },
    incidentGuardReport: {
      generated_at: "2026-05-24T09:59:00.000Z",
      stories: [
        {
          story_id: "false-ready-story",
          title: "Silksong Needs A Real MP4",
          artifact_dir: "C:/repo/output/goal-proof/batch/false-ready-story",
          disaster_upload_blockers: [],
          file_evidence: {
            mp4_ready: false,
            captions_ready: false,
            narration_ready: false,
            word_timestamps_ready: false,
            materialised_motion_ready: false,
            distinct_motion_families_ready: false,
            rights_ledger_ready: false,
          },
        },
      ],
    },
    generatedAt: "2026-05-24T10:00:00.000Z",
  });

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(workOrder.summary.blocked_on_render_inputs_count, 1);
  assert.ok(workOrder.jobs[0].blockers.includes("final_mp4_missing"));
  assert.ok(workOrder.jobs[0].blockers.includes("final_narration_audio_missing"));
  assert.ok(workOrder.jobs[0].blockers.includes("word_timestamps_missing"));
  assert.ok(workOrder.jobs[0].blockers.includes("caption_file_missing"));
  assert.ok(workOrder.jobs[0].blockers.includes("rights_ledger_missing"));
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "generate_final_narration_audio_and_word_timestamps",
      "materialise_validated_real_motion_clips",
      "repair_rights_ledger_evidence",
      "materialise_final_mp4",
      "generate_caption_file",
    ],
  );
});

test("render input work order preserves cutover stale-audio blockers when incident guard is fresher", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-23T06:26:32.000Z",
      queue: [
        blockedQueueItem({
          story_id: "stale-cutover-story",
          title: "Forza Horizon 6 Reviews Are In",
          render_input_blockers: [
            "final_narration_audio_stale_after_public_copy_repair",
            "word_timestamps_stale_after_public_copy_repair",
            "materialised_motion_clips_missing",
          ],
        }),
      ],
    },
    incidentGuardReport: {
      generated_at: "2026-05-23T06:26:50.000Z",
      stories: [
        {
          story_id: "stale-cutover-story",
          title: "Forza Horizon 6 Reviews Are In",
          artifact_dir: "C:/repo/output/goal-proof/batch/stale-cutover-story",
          disaster_upload_blockers: [
            "incident:render_not_final_publish_ready",
            "incident:materialised_motion_missing",
          ],
          file_evidence: {
            narration_ready: true,
            word_timestamps_ready: true,
            materialised_motion_ready: false,
          },
        },
      ],
    },
    generatedAt: "2026-05-23T06:27:00.000Z",
  });

  assert.equal(workOrder.summary.audio_timestamp_jobs, 1);
  assert.ok(workOrder.jobs[0].blockers.includes("final_narration_audio_stale_after_public_copy_repair"));
  assert.ok(workOrder.jobs[0].blockers.includes("word_timestamps_stale_after_public_copy_repair"));
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "generate_final_narration_audio_and_word_timestamps",
      "materialise_validated_real_motion_clips",
    ],
  );
});

test("render input work order ignores stale incident blockers when cutover is newer", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-23T06:38:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "fresh-cutover-story",
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          render_input_status: "ready_for_final_render_job",
          render_input_blockers: [],
        }),
      ],
    },
    incidentGuardReport: {
      generated_at: "2026-05-23T06:26:00.000Z",
      stories: [
        {
          story_id: "fresh-cutover-story",
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          artifact_dir: "C:/repo/output/goal-proof/batch/fresh-cutover-story",
          disaster_upload_blockers: [
            "incident:narration_missing",
            "incident:word_timestamps_missing",
            "incident:render_not_final_publish_ready",
          ],
        },
      ],
    },
    generatedAt: "2026-05-23T06:39:00.000Z",
  });

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.summary.audio_timestamp_jobs, 0);
  assert.deepEqual(workOrder.jobs[0].blockers, []);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["run_visual_v4_production_render"],
  );
});

test("render input work order routes scheduler visual-evidence blockers to real motion repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-27T17:12:00.000Z",
      blocked: [
        {
          story_id: "generated-only-cutover-story",
          title: "Kadokawa Stake Just Passed Sony",
          artifact_dir: "C:/repo/output/goal-proof/batch/generated-only-cutover-story",
          blockers: [
            "scheduler_candidate_benchmark_not_pass",
            "scheduler_candidate:gold_standard:visual_evidence:generated_only_motion_deck",
            "scheduler_candidate:gold_standard:visual_evidence:no_real_visual_media_asset",
            "scheduler_candidate:benchmark_below_production_threshold:motion_density_score",
          ],
          visual_evidence_profile: {
            generated_only_motion_deck: true,
            real_media_asset_count: 0,
            real_motion_asset_count: 0,
          },
        },
      ],
    },
    generatedAt: "2026-05-27T17:13:00.000Z",
  });

  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.blocked_on_render_inputs_count, 1);
  assert.ok(workOrder.jobs[0].blockers.includes("visual_evidence:generated_only_motion_deck"));
  assert.ok(workOrder.jobs[0].blockers.includes("visual_evidence:no_real_visual_media_asset"));
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["materialise_validated_real_motion_clips"],
  );
});

test("render input work order routes plain benchmark failures with generated-only evidence to real motion repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-28T08:30:00.000Z",
      blocked: [
        {
          story_id: "plain-generated-only-cutover-story",
          title: "Xbox Controller Deal Has One Catch",
          artifact_dir: "C:/repo/output/goal-proof/batch/plain-generated-only-cutover-story",
          blockers: [
            "benchmark_not_pass",
            "benchmark_below_production_threshold:motion_density_score",
            "benchmark_below_production_threshold:media_house_polish_score",
          ],
          visual_evidence_profile: {
            generated_only_motion_deck: true,
            real_media_asset_count: 0,
            real_motion_asset_count: 0,
            direct_video_motion_asset_count: 0,
            blockers: [
              "visual_evidence:generated_only_motion_deck",
              "visual_evidence:no_real_visual_media_asset",
            ],
          },
        },
      ],
    },
    generatedAt: "2026-05-28T08:31:00.000Z",
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(workOrder.summary.auto_repairable_jobs, 1);
  const job = workOrder.jobs[0];
  assert.ok(job.blockers.includes("visual_evidence:generated_only_motion_deck"));
  assert.ok(job.blockers.includes("visual_evidence:no_real_visual_media_asset"));
  const action = job.actions[0];
  assert.equal(action.action_id, "materialise_validated_real_motion_clips");
  assert.equal(action.repair_lane, "validated_real_motion_materialisation");
  assert.equal(action.auto_repairable, true);
});

test("render input work order does not let final-publish incident blockers stop a ready final-render job", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: {
      generated_at: "2026-05-23T06:26:00.000Z",
      queue: [
        blockedQueueItem({
          story_id: "ready-render-story",
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          render_input_status: "ready_for_final_render_job",
          render_input_blockers: [],
        }),
      ],
    },
    incidentGuardReport: {
      generated_at: "2026-05-23T06:27:00.000Z",
      stories: [
        {
          story_id: "ready-render-story",
          title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
          artifact_dir: "C:/repo/output/goal-proof/batch/ready-render-story",
          disaster_upload_blockers: [
            "incident:render_not_final_publish_ready",
            "incident:control_tower_verdict_not_green",
          ],
        },
      ],
    },
    generatedAt: "2026-05-23T06:28:00.000Z",
  });

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.deepEqual(workOrder.jobs[0].blockers, []);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["run_visual_v4_production_render"],
  );
});

test("render input work order routes commercial disclosure incidents to disclosure repair", () => {
  const workOrder = buildGoalRenderInputWorkOrder({
    incidentGuardReport: {
      generated_at: "2026-05-22T17:10:00.000Z",
      stories: [
        {
          story_id: "deal-story",
          title: "GameSir G7 Pro Deal Has One Catch",
          artifact_dir: "C:/repo/output/goal-proof/batch/deal-story",
          disaster_upload_blockers: ["incident:commercial_deal_disclosure_missing"],
          file_evidence: {
            mp4_ready: true,
            captions_ready: true,
            materialised_motion_ready: true,
            rights_ledger_ready: true,
          },
        },
      ],
    },
    generatedAt: "2026-05-22T17:11:00.000Z",
  });

  assert.equal(workOrder.summary.commercial_disclosure_repair_jobs, 1);
  assert.deepEqual(
    workOrder.jobs[0].actions.map((action) => action.action_id),
    ["repair_commercial_disclosure_evidence"],
  );
  assert.ok(workOrder.jobs[0].blockers.includes("commercial_deal_disclosure_missing"));
});

test("render input work order writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-input-workorder-"));
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan: { queue: [blockedQueueItem()] },
    generatedAt: "2026-05-22T04:05:00.000Z",
  });

  const written = await writeGoalRenderInputWorkOrder(workOrder, { outputDir: root });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  assert.equal(await fs.pathExists(written.repairBacklogPath), true);
  assert.equal(await fs.pathExists(written.autoRepairPlanPath), true);
  assert.equal(await fs.pathExists(written.postRepairValidationPlanPath), true);
  const saved = await fs.readJson(written.jsonPath);
  assert.equal(saved.jobs[0].story_id, "story-blocked");
  assert.equal(saved.repair_backlog.summary.total_items, 2);
  assert.equal(saved.auto_repair_plan.summary.auto_repairable_items, 2);
  assert.equal(saved.post_repair_validation_plan.summary.validation_items, 2);
  const repairBacklog = await fs.readJson(written.repairBacklogPath);
  assert.equal(repairBacklog.items[0].story_id, "story-blocked");
  assert.equal(repairBacklog.items[0].db_mutation_needed, false);
  assert.equal(typeof repairBacklog.items[0].required_artefact_path, "string");
  assert.ok(repairBacklog.items[0].post_repair_validation_command);
  const autoRepairPlan = await fs.readJson(written.autoRepairPlanPath);
  assert.equal(autoRepairPlan.items.every((item) => item.auto_repairable), true);
  const postRepairValidationPlan = await fs.readJson(written.postRepairValidationPlanPath);
  assert.equal(postRepairValidationPlan.items[0].story_id, "story-blocked");
  assert.equal(postRepairValidationPlan.items[0].validation_command, repairBacklog.items[0].post_repair_validation_command);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /generate_final_narration_audio_and_word_timestamps/);
  assert.match(markdown, /materialise_validated_real_motion_clips/);
});
