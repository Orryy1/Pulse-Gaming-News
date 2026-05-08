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
