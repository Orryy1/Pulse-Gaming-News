"use strict";

const {
  DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
} = require("./v2/local-voice-reference");

function list(value) {
  return Array.isArray(value) ? value : [];
}

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function acceptedReference(reference = {}, expectedId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  return (
    reference &&
    String(reference.id || "") === String(expectedId) &&
    reference.referencePresent === true
  );
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function proofVerdict(row = {}, expectedId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  if (!acceptedReference(row.local_voice_reference, expectedId)) {
    return "reject_unaccepted_voice";
  }
  if (row.failure_code) return `reject_${row.failure_code}`;
  if (row.duration_verdict !== "pass") return `reject_${row.duration_verdict || "duration_unknown"}`;
  return "voice_ready";
}

function buildLocalTtsOvernightReport({
  doctorReport = {},
  repairQueue = {},
  audioApply = {},
  expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  generatedAt = new Date().toISOString(),
} = {}) {
  const applied = list(audioApply.applied).map((row) => ({
    story_id: row.story_id || null,
    output_audio_path: row.output_audio_path || null,
    resolved_audio_path: row.resolved_audio_path || null,
    duration_seconds:
      row.duration_seconds === null || row.duration_seconds === undefined
        ? null
        : Number(row.duration_seconds),
    duration_verdict: row.duration_verdict || "unknown",
    failure_code: row.failure_code || null,
    local_voice_reference: row.local_voice_reference || null,
    local_voice_metadata: row.local_voice_metadata || "unknown",
    verdict: proofVerdict(row, expectedVoiceId),
  }));
  const skipped = list(audioApply.skipped).map((row) => ({
    story_id: row.story_id || null,
    reason: row.reason || "unknown",
    failure_code: row.failure_code || null,
    server_reset_recorded: row.server_reset_recorded === true,
  }));

  const proofReady = applied.filter((row) => row.verdict === "voice_ready");
  const proofRejected = applied.filter((row) => row.verdict !== "voice_ready");
  const doctorGreen = String(doctorReport.verdict || "").toLowerCase() === "green";
  const localReady =
    doctorGreen &&
    bool(doctorReport.before?.ok ?? doctorReport.after?.ok) &&
    bool((doctorReport.after || doctorReport.before || {}).voice?.loaded) &&
    bool((doctorReport.after || doctorReport.before || {}).voice?.refResolved);

  let verdict = "AMBER";
  if (!doctorGreen || doctorReport.failure_code) verdict = "RED";
  else if (applied.length > 0 && proofRejected.length === 0 && skipped.length === 0) verdict = "GREEN";

  const failureCounts = countBy(
    [
      ...proofRejected.map((row) => ({ code: row.failure_code || row.verdict })),
      ...skipped.map((row) => ({ code: row.failure_code || row.reason })),
    ],
    (row) => row.code,
  );

  return {
    schema_version: 1,
    generated_at: generatedAt,
    verdict,
    expected_local_voice_id: expectedVoiceId,
    doctor: {
      verdict: doctorReport.verdict || "unknown",
      action: doctorReport.action || "unknown",
      failure_code: doctorReport.failure_code || null,
      reason: doctorReport.reason || null,
      base_url: doctorReport.base_url || null,
      local_ready: localReady,
      voice: {
        alias: (doctorReport.after || doctorReport.before || {}).voice?.alias || null,
        loaded: bool((doctorReport.after || doctorReport.before || {}).voice?.loaded),
        ref_resolved: bool((doctorReport.after || doctorReport.before || {}).voice?.refResolved),
      },
    },
    queue: {
      counts: repairQueue.counts || {},
      local_tts: repairQueue.local_tts || {},
    },
    proof_batch: {
      applied_count: applied.length,
      voice_ready_count: proofReady.length,
      rejected_count: proofRejected.length,
      skipped_count: skipped.length,
      failure_counts: failureCounts,
      applied,
      skipped,
    },
    safety: {
      local_only: true,
      production_voice_unchanged: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
      bad_fallback_voice_allowed: false,
    },
  };
}

function renderLocalTtsOvernightMarkdown(report) {
  const lines = [];
  lines.push("# Local TTS Overnight Report");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Expected local voice: ${report.expected_local_voice_id}`);
  lines.push("");
  lines.push("## Doctor");
  lines.push(
    `- verdict=${report.doctor.verdict} action=${report.doctor.action} ready=${report.doctor.local_ready} voice=${report.doctor.voice.alias || "unknown"} loaded=${report.doctor.voice.loaded} ref=${report.doctor.voice.ref_resolved}`,
  );
  if (report.doctor.failure_code) lines.push(`- failure=${report.doctor.failure_code}`);
  if (report.doctor.reason) lines.push(`- reason=${report.doctor.reason}`);
  lines.push("");
  lines.push("## Proof Batch");
  lines.push(
    `- applied=${report.proof_batch.applied_count} voice_ready=${report.proof_batch.voice_ready_count} rejected=${report.proof_batch.rejected_count} skipped=${report.proof_batch.skipped_count}`,
  );
  const failureKeys = Object.keys(report.proof_batch.failure_counts || {});
  lines.push(`- failures=${failureKeys.length ? failureKeys.map((key) => `${key}:${report.proof_batch.failure_counts[key]}`).join(", ") : "none"}`);
  lines.push("");
  lines.push("## Voice-Ready MP3s");
  const ready = report.proof_batch.applied.filter((row) => row.verdict === "voice_ready");
  if (!ready.length) {
    lines.push("- none");
  } else {
    for (const row of ready) {
      lines.push(
        `- ${row.story_id}: ${row.duration_seconds ?? "unknown"}s | ${row.resolved_audio_path || row.output_audio_path}`,
      );
    }
  }
  const rejected = report.proof_batch.applied.filter((row) => row.verdict !== "voice_ready");
  if (rejected.length) {
    lines.push("");
    lines.push("## Rejected Proofs");
    for (const row of rejected) {
      lines.push(
        `- ${row.story_id}: ${row.verdict}${row.failure_code ? ` (${row.failure_code})` : ""}`,
      );
    }
  }
  if (report.proof_batch.skipped.length) {
    lines.push("");
    lines.push("## Skipped");
    for (const row of report.proof_batch.skipped) {
      lines.push(
        `- ${row.story_id}: ${row.reason}${row.failure_code ? ` (${row.failure_code})` : ""}${row.server_reset_recorded ? " | server reset recorded" : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local proof/reporting only.");
  lines.push("- Production voice, renderer, Railway, OAuth, tokens, DB rows and platform posting are unchanged.");
  lines.push("- Old low/demonic local fallback voice is not allowed as an approved proof path.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLocalTtsOvernightReport,
  renderLocalTtsOvernightMarkdown,
};
