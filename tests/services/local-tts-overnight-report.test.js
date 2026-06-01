"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalTtsOvernightReport,
  renderLocalTtsOvernightMarkdown,
} = require("../../lib/studio/local-tts-overnight-report");

const DOCTOR_GREEN = {
  verdict: "green",
  action: "none",
  failure_code: null,
  reason: "local TTS is ready with the accepted voice loaded",
  before: {
    ok: true,
    voice: { alias: "liam", loaded: true, refResolved: true },
  },
};

const ACCEPTED_REF = {
  id: "pulse-sleepy-liam-20260502",
  fileName: "pulse_liam_sleepy.wav",
  referencePresent: true,
};

const PASSING_PROOF = {
  acoustic: { medianPitchHz: 118 },
  transcript: "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
};

test("local TTS overnight report is green when all Liam proofs are accepted", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    repairQueue: { counts: { ready_local_repair: 2 } },
    audioApply: {
      applied: [
        {
          story_id: "rss_one",
          resolved_audio_path: "D:/pulse-data/media/test/output/rss_one_liam.mp3",
          text_word_count: 192,
          estimated_seconds: 66.8,
          duration_seconds: 66.2,
          duration_verdict: "pass",
          local_voice_metadata: "stamped",
          local_voice_reference: ACCEPTED_REF,
          ...PASSING_PROOF,
        },
        {
          story_id: "rss_two",
          resolved_audio_path: "D:/pulse-data/media/test/output/rss_two_liam.mp3",
          text_word_count: 196,
          duration_seconds: 68.4,
          duration_verdict: "pass",
          local_voice_reference: ACCEPTED_REF,
          ...PASSING_PROOF,
        },
      ],
      skipped: [],
    },
    generatedAt: "2026-05-06T00:00:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.proof_batch.voice_ready_count, 2);
  assert.equal(report.proof_batch.applied[0].word_count, 192);
  assert.equal(report.proof_batch.applied[0].estimated_seconds, 66.8);
  assert.equal(report.proof_batch.applied[0].wpm, 174);
  assert.equal(report.proof_batch.applied[0].acoustic.medianPitchHz, 118);
  assert.equal(report.proof_batch.applied[0].spoken_outro_present, true);
  assert.equal(report.proof_batch.applied[0].timestamp_verdict, "pass");
  assert.equal(report.proof_batch.rejected_count, 0);
  assert.equal(report.safety.production_voice_unchanged, true);
  assert.equal(report.safety.bad_fallback_voice_allowed, false);
});

test("local TTS overnight report trusts recovered doctor after-state over stale before-state", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: {
      verdict: "green",
      action: "none",
      failure_code: null,
      before: {
        ok: false,
        status: "unreachable",
        voice: { alias: null, loaded: false, refResolved: false },
      },
      after: {
        ok: true,
        status: "ok",
        voice: { alias: "liam", loaded: true, refResolved: true },
      },
    },
    audioApply: { applied: [] },
  });

  assert.equal(report.doctor.local_ready, true);
  assert.equal(report.doctor.voice.alias, "liam");
});

test("local TTS overnight report merges repair and script-extension proof sources", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApplyReports: [
      {
        source: "local_media_repair",
        report: {
          applied: [
            {
              story_id: "rss_too_short",
              duration_seconds: 54,
              duration_verdict: "reject_duration",
              failure_code: "duration_too_short",
              text_word_count: 165,
              local_voice_reference: ACCEPTED_REF,
              ...PASSING_PROOF,
            },
          ],
          skipped: [],
        },
      },
      {
        source: "local_script_extension",
        report: {
          applied: [
            {
              story_id: "rss_extended",
              duration_seconds: 67,
              duration_verdict: "pass",
              text_word_count: 195,
              local_voice_reference: ACCEPTED_REF,
              local_voice_metadata: "stamped",
              ...PASSING_PROOF,
            },
          ],
          skipped: [],
        },
      },
    ],
  });
  const markdown = renderLocalTtsOvernightMarkdown(report);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.proof_batch.applied_count, 2);
  assert.equal(report.proof_batch.voice_ready_count, 1);
  assert.equal(report.proof_batch.rejected_count, 1);
  assert.equal(report.proof_batch.source_counts.local_media_repair, 1);
  assert.equal(report.proof_batch.source_counts.local_script_extension, 1);
  assert.equal(report.proof_batch.applied[1].proof_source, "local_script_extension");
  assert.match(markdown, /rss_extended: source=local_script_extension/);
});

test("local TTS overnight report creates a local-only recovery plan for short proofs and TTS timeouts", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApplyReports: [
      {
        source: "local_media_repair",
        report: {
          applied: [
            {
              story_id: "rss_short",
              duration_seconds: 57.4,
              duration_verdict: "reject_duration",
              failure_code: "duration_too_short",
              text_word_count: 172,
              local_voice_reference: ACCEPTED_REF,
              ...PASSING_PROOF,
            },
            {
              story_id: "rss_recovered",
              duration_seconds: 57.4,
              duration_verdict: "reject_duration",
              failure_code: "duration_too_short",
              text_word_count: 172,
              local_voice_reference: ACCEPTED_REF,
              ...PASSING_PROOF,
            },
            {
              story_id: "rss_recovered",
              duration_seconds: 71.1,
              duration_verdict: "pass",
              text_word_count: 198,
              local_voice_reference: ACCEPTED_REF,
              local_voice_metadata: "stamped",
              ...PASSING_PROOF,
            },
          ],
          skipped: [
            {
              story_id: "rss_reset",
              reason: "generate_tts_failed",
              failure_code: "connection_reset",
              server_reset_recorded: true,
            },
            {
              story_id: "rss_timeout",
              reason: "generate_tts_failed",
              failure_code: "tts_timeout",
            },
            {
              story_id: "rss_recovered",
              reason: "generate_tts_failed",
              failure_code: "tts_timeout",
            },
          ],
        },
      },
    ],
  });
  const markdown = renderLocalTtsOvernightMarkdown(report);

  assert.equal(report.recovery_plan.local_only, true);
  assert.equal(report.proof_batch.rejected_count, 1);
  assert.equal(report.proof_batch.superseded_rejected_count, 1);
  assert.equal(report.proof_batch.skipped_count, 2);
  assert.equal(report.proof_batch.superseded_skipped_count, 1);
  assert.deepEqual(report.recovery_plan.extend_script_story_ids, ["rss_short"]);
  assert.deepEqual(report.recovery_plan.retry_tts_story_ids, ["rss_reset", "rss_timeout"]);
  assert.deepEqual(
    report.recovery_plan.work_orders
      .filter((order) => order.repair_lane === "local_tts_retry")
      .map((order) => ({
        story_id: order.story_id,
        preflight_required: order.preflight_required,
        preflight_command: order.preflight_command,
        recommended_command: order.recommended_command,
        apply_command: order.apply_command,
      })),
    [
      {
        story_id: "rss_reset",
        preflight_required: true,
        preflight_command: "npm run ops:local-script-extension -- --story-id rss_reset --dry-run",
        recommended_command: "npm run ops:local-script-extension -- --story-id rss_reset --dry-run",
        apply_command:
          "npm run ops:local-script-extension -- --story-id rss_reset --apply-local-audio --apply-limit 1",
      },
      {
        story_id: "rss_timeout",
        preflight_required: true,
        preflight_command: "npm run ops:local-script-extension -- --story-id rss_timeout --dry-run",
        recommended_command: "npm run ops:local-script-extension -- --story-id rss_timeout --dry-run",
        apply_command:
          "npm run ops:local-script-extension -- --story-id rss_timeout --apply-local-audio --apply-limit 1",
      },
    ],
  );
  assert.equal(report.recovery_plan.blocked_by_voice_quality, false);
  assert.match(report.recovery_plan.commands[0], /ops:local-media-repair -- --dry-run/);
  assert.match(report.recovery_plan.commands[1], /ops:local-script-extension -- --dry-run/);
  assert.match(markdown, /## Local Recovery Plan/);
  assert.match(markdown, /## Superseded Failed Attempts/);
  assert.match(markdown, /extend_script_story_ids=rss_short/);
  assert.match(markdown, /retry_tts_story_ids=rss_reset, rss_timeout/);
  assert.match(markdown, /## Recovery Work Orders/);
  assert.match(markdown, /local_tts_retry:rss_reset/);
  assert.match(markdown, /preflight: `npm run ops:local-script-extension -- --story-id rss_reset --dry-run`/);
  assert.match(markdown, /apply: `npm run ops:local-script-extension -- --story-id rss_reset --apply-local-audio --apply-limit 1`/);
});

test("local TTS overnight report creates duration repair work orders for overlong proofs", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApply: {
      applied: [
        {
          story_id: "rss_overlong",
          duration_seconds: 78.4,
          duration_verdict: "reject_duration",
          failure_code: "duration_too_long",
          text_word_count: 214,
          local_voice_reference: ACCEPTED_REF,
          ...PASSING_PROOF,
        },
      ],
      skipped: [],
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.deepEqual(report.recovery_plan.shorten_script_story_ids, ["rss_overlong"]);
  assert.equal(report.recovery_plan.work_orders.length, 1);
  assert.deepEqual(report.recovery_plan.work_orders[0], {
    work_order_id: "local_audio_duration_repair:rss_overlong",
    story_id: "rss_overlong",
    blocker_type: "duration_too_long",
    repair_lane: "local_audio_duration_repair",
    exact_missing_input: "64-70 second local Liam-safe narration text and fresh timestamped proof audio",
    recommended_command:
      "npm run ops:reprocess-script-failures -- --story-id rss_overlong --force-story --source-bound-only --dry-run --json",
    expected_output: "test/output/script_failure_reprocess.json",
    db_mutation_required: false,
    operator_approval_required: true,
    external_posting_risk: false,
    post_repair_validation_command:
      "npm run ops:local-script-extension -- --story-id rss_overlong --dry-run",
  });
});

test("local TTS overnight report flags proofs outside the preferred 64-70s target without rejecting 61-75s audio", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApply: {
      applied: [
        {
          story_id: "rss_edge_long",
          duration_seconds: 72.96,
          duration_verdict: "pass",
          text_word_count: 194,
          local_voice_reference: ACCEPTED_REF,
          local_voice_metadata: "stamped",
          ...PASSING_PROOF,
        },
      ],
    },
  });
  const markdown = renderLocalTtsOvernightMarkdown(report);

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.proof_batch.voice_ready_count, 1);
  assert.equal(report.proof_batch.applied[0].target_duration_verdict, "above_target");
  assert.equal(report.proof_batch.applied[0].verdict, "voice_ready");
  assert.match(markdown, /64-70s preferred, 61-75s accepted/);
});

test("local TTS overnight report stays amber when the batch recovered from a reset", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApply: {
      applied: [
        {
          story_id: "rss_two",
          duration_seconds: 67,
          duration_verdict: "pass",
          local_voice_reference: ACCEPTED_REF,
          text_word_count: 190,
          ...PASSING_PROOF,
        },
      ],
      skipped: [
        {
          story_id: "rss_one",
          reason: "generate_tts_failed",
          failure_code: "connection_reset",
          server_reset_recorded: true,
        },
      ],
    },
  });
  const markdown = renderLocalTtsOvernightMarkdown(report);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.proof_batch.failure_counts.connection_reset, 1);
  assert.match(markdown, /server reset recorded/);
});

test("local TTS overnight report rejects proofs without the accepted Liam reference", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApply: {
      applied: [
        {
          story_id: "rss_bad",
          duration_seconds: 66.2,
          duration_verdict: "pass",
          text_word_count: 190,
          ...PASSING_PROOF,
          local_voice_reference: {
            id: "old-local-voice",
            referencePresent: true,
          },
        },
      ],
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.proof_batch.applied[0].verdict, "reject_unaccepted_voice");
  assert.equal(report.proof_batch.rejected_count, 1);
});

test("local TTS overnight report rejects accepted-reference proofs without pitch and outro evidence", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: DOCTOR_GREEN,
    audioApply: {
      applied: [
        {
          story_id: "rss_no_acoustic",
          duration_seconds: 66.2,
          duration_verdict: "pass",
          text_word_count: 190,
          local_voice_reference: ACCEPTED_REF,
          transcript: "Follow Pulse Gaming so you never miss a beat.",
        },
        {
          story_id: "rss_low_pitch",
          duration_seconds: 66.2,
          duration_verdict: "pass",
          text_word_count: 190,
          local_voice_reference: ACCEPTED_REF,
          acoustic: { medianPitchHz: 61 },
          transcript: "Follow Pulse Gaming so you never miss a beat.",
        },
        {
          story_id: "rss_no_outro",
          duration_seconds: 66.2,
          duration_verdict: "pass",
          text_word_count: 190,
          local_voice_reference: ACCEPTED_REF,
          acoustic: { medianPitchHz: 118 },
          transcript: "This proof ends without the spoken channel line.",
        },
      ],
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.deepEqual(
    report.proof_batch.applied.map((row) => row.verdict),
    [
      "reject_pitch_profile_unverified",
      "reject_demonic_low_voice_risk",
      "reject_missing_spoken_outro",
    ],
  );
  assert.equal(report.proof_batch.voice_ready_count, 0);
});

test("local TTS overnight report is red when the doctor is red", () => {
  const report = buildLocalTtsOvernightReport({
    doctorReport: {
      verdict: "red",
      failure_code: "server_down",
      before: { ok: false },
    },
    audioApply: { applied: [] },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.doctor.failure_code, "server_down");
});
