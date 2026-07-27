"use strict";

const RECOVERY_PHASES = Object.freeze([
  Object.freeze({
    id: "phase_0",
    days: "0-3",
    objective: "establish_one_source_of_truth",
    actions: Object.freeze([
      "freeze_feature_work",
      "preserve_approved_media_assets",
      "record_local_and_public_runtime_commits",
      "inventory_publish_capable_processes",
      "read_only_queue_and_database_snapshot",
      "verified_database_backup",
      "forensic_archive_candidates_for_pr68_and_pr69",
      "human_review_mode_during_reconciliation",
      "single_current_status_evidence",
    ]),
  }),
  Object.freeze({
    id: "phase_1",
    days: "4-14",
    objective: "restore_engineering_and_analytics_truth",
    actions: Object.freeze([
      "required_ci",
      "protected_main",
      "typed_configuration",
      "no_dotenv_override",
      "read_only_youtube_analytics_proof",
      "verify_five_published_shorts",
      "reconcile_conflicted_platform_rows",
      "canonical_documentation",
      "two_publish_windows",
      "clean_release_pulse_v1",
    ]),
  }),
  Object.freeze({
    id: "phase_2",
    days: "15-30",
    objective: "run_controlled_12_video_experiment",
    actions: Object.freeze([
      "twelve_video_matrix",
      "maximum_two_daily",
      "minimum_four_hour_gap",
      "manual_review_every_video",
      "creative_variables_in_analytics",
      "no_fixed_cta",
      "exact_subject_media",
      "weekly_editorial_review",
      "no_mid_experiment_scoring_changes",
    ]),
  }),
  Object.freeze({
    id: "phase_3",
    days: "31-60",
    objective: "release_maintainable_pulse_v1",
    actions: Object.freeze([
      "thematic_pull_requests",
      "merge_protected_main",
      "tag_v1_0_0",
      "deploy_from_tag",
      "operator_approved_brand_update",
      "archive_redundant_renderers",
      "executive_dashboard",
      "restore_rehearsal",
      "restart_rehearsal",
      "youtube_only_automation",
    ]),
  }),
  Object.freeze({
    id: "phase_4",
    days: "61-90",
    objective: "scale_only_the_proven_editorial_product",
    permitted_expansion: Object.freeze([
      "third_daily_short_only_if_retention_stable",
      "instagram_pilot_from_youtube_winners",
      "separate_facebook_pilot",
      "explicitly_approved_tiktok",
      "one_four_to_eight_minute_youtube_explainer",
      "one_selective_commercial_test_if_intent_supports_it",
      "discord_expansion_only_on_repeat_viewer_demand",
    ]),
    still_prohibited: Object.freeze([
      "finance_and_crypto",
      "mass_autonomous_cross_posting",
      "automated_public_comment_interaction",
      "additional_studio_generations",
      "generic_article_to_video_scale",
      "bulk_backlog_publication",
      "unreviewed_live_publishing",
    ]),
  }),
]);

function evaluateAutonomousPublishingReadiness(evidence = {}) {
  const blockers = [];
  const atLeast = (value, minimum) =>
    Number.isFinite(Number(value)) && Number(value) >= minimum;
  if (evidence.runtime_provenance_exact !== true) {
    blockers.push("runtime_provenance_not_proved");
  }
  if (evidence.production_equals_protected_main !== true) {
    blockers.push("production_not_equal_to_protected_main");
  }
  if (evidence.clean_ci_green !== true) blockers.push("clean_ci_not_green");
  if (!atLeast(evidence.duplicate_free_days, 30)) {
    blockers.push("duplicate_free_observation_below_30_days");
  }
  if (!atLeast(evidence.off_schedule_free_days, 30)) {
    blockers.push("cadence_observation_below_30_days");
  }
  if (Number(evidence.unresolved_failed_rows_with_platform_ids) !== 0) {
    blockers.push("unresolved_platform_state_conflicts");
  }
  if (Number(evidence.public_qa_incidents) !== 0) {
    blockers.push("public_qa_incidents_present");
  }
  if (evidence.rich_analytics_active !== true) {
    blockers.push("rich_analytics_not_active");
  }
  if (Number(evidence.rights_manifest_coverage_fraction) !== 1) {
    blockers.push("rights_manifest_coverage_below_100_percent");
  }
  if (evidence.kill_switch_tested !== true) {
    blockers.push("kill_switch_not_tested");
  }
  if (evidence.backup_restore_rehearsal_passed !== true) {
    blockers.push("backup_restore_rehearsal_not_passed");
  }
  if (!atLeast(evidence.controlled_videos_analysed, 12)) {
    blockers.push("controlled_video_sample_below_12");
  }
  if (evidence.repeatable_winning_lane_proved !== true) {
    blockers.push("repeatable_winning_lane_not_proved");
  }
  return {
    schema_version: "pulse-autonomy-acceptance-v1",
    ready: blockers.length === 0,
    verdict: blockers.length ? "BLOCKED" : "GREEN",
    blockers,
    observation_requirement_days: 30,
    note: "The 30-day observation window is internal governance, not a YouTube requirement.",
  };
}

module.exports = {
  RECOVERY_PHASES,
  evaluateAutonomousPublishingReadiness,
};
