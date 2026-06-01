"use strict";

const {
  DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
} = require("./v2/local-voice-reference");
const {
  classifyLocalTtsProofFailure,
} = require("./local-tts-failures");

const LOCAL_PROOF_TARGET_MIN_SECONDS = 64;
const LOCAL_PROOF_TARGET_MAX_SECONDS = 70;

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

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampVerdict(row = {}) {
  if (row.local_voice_metadata === "stamped") return "pass";
  if (/^not_stamped:/i.test(String(row.local_voice_metadata || ""))) return "fail";
  return "unknown";
}

function wordsPerMinute(wordCount, durationSeconds) {
  const words = numberOrNull(wordCount);
  const duration = numberOrNull(durationSeconds);
  if (!words || !duration || duration <= 0) return null;
  return Math.round((words / duration) * 60);
}

function uniqueTruthy(values) {
  return [...new Set(list(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasSpokenOutro(transcript) {
  return normaliseText(transcript).includes("follow pulse gaming so you never miss a beat");
}

function acousticFor(row = {}) {
  const acoustic = row.acoustic || row.local_voice_evidence?.acoustic || row.local_pace?.acoustic || null;
  if (!acoustic || typeof acoustic !== "object") return null;
  return {
    ...acoustic,
    medianPitchHz: numberOrNull(
      acoustic.medianPitchHz ??
        acoustic.meanPitchHz ??
        acoustic.pitchHz ??
        acoustic.f0MedianHz ??
        acoustic.median_f0_hz,
    ),
  };
}

function transcriptFor(row = {}) {
  return String(
    row.transcript ||
      row.local_voice_evidence?.transcript ||
      row.local_voice_metadata?.transcript ||
      "",
  );
}

function proofVerdict(row = {}, expectedId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  if (!acceptedReference(row.local_voice_reference, expectedId)) {
    return "reject_unaccepted_voice";
  }
  if (row.failure_code) return `reject_${row.failure_code}`;
  if (row.duration_verdict !== "pass") return `reject_${row.duration_verdict || "duration_unknown"}`;
  const failure = classifyLocalTtsProofFailure({
    durationSeconds: row.duration_seconds,
    timestampsStamped: row.timestamp_verdict !== "fail",
    localVoiceReference: row.local_voice_reference,
    acoustic: row.acoustic,
    transcript: row.transcript,
    wordCount: row.word_count,
    wpm: row.wpm,
  });
  if (failure.code) return `reject_${failure.code}`;
  return "voice_ready";
}

function targetDurationVerdict(durationSeconds) {
  const duration = numberOrNull(durationSeconds);
  if (duration === null) return "unknown";
  if (duration < LOCAL_PROOF_TARGET_MIN_SECONDS) return "below_target";
  if (duration > LOCAL_PROOF_TARGET_MAX_SECONDS) return "above_target";
  return "pass";
}

function normaliseProofReport(report, source) {
  if (!report || typeof report !== "object") {
    return { applied: [], skipped: [] };
  }
  return {
    applied: list(report.applied).map((row) => ({
      ...row,
      proof_source: row.proof_source || source || "unknown",
    })),
    skipped: list(report.skipped).map((row) => ({
      ...row,
      proof_source: row.proof_source || source || "unknown",
    })),
  };
}

function buildRecoveryPlan(proofRejected, skipped, proofReady = []) {
  const recoveredStoryIds = new Set(proofReady.map((row) => row.story_id).filter(Boolean));
  const extendScriptStoryIds = uniqueTruthy(
    proofRejected
      .filter((row) =>
        !recoveredStoryIds.has(row.story_id) &&
        (
          row.failure_code === "duration_too_short" ||
          row.verdict === "reject_duration_too_short" ||
          row.verdict === "reject_below_target"
        ),
      )
      .map((row) => row.story_id),
  );
  const shortenScriptStoryIds = uniqueTruthy(
    proofRejected
      .filter((row) =>
        !recoveredStoryIds.has(row.story_id) &&
        (
          row.failure_code === "duration_too_long" ||
          row.verdict === "reject_duration_too_long"
        ),
      )
      .map((row) => row.story_id),
  );
  const retryTtsStoryIds = uniqueTruthy(
    skipped
      .filter((row) =>
        !recoveredStoryIds.has(row.story_id) &&
        [
          "connection_reset",
          "tts_timeout",
          "health_timeout",
          "server_down",
          "voice_not_loaded",
        ].includes(row.failure_code || row.reason),
      )
      .map((row) => row.story_id),
  );
  const durationWorkOrders = [
    ...extendScriptStoryIds.map((storyId) => ({
      work_order_id: `local_audio_duration_repair:${storyId}`,
      story_id: storyId,
      blocker_type: "duration_too_short",
      repair_lane: "local_audio_duration_repair",
      exact_missing_input: "64-70 second local Liam-safe narration text and fresh timestamped proof audio",
      recommended_command: `npm run ops:local-script-extension -- --story-id ${storyId} --dry-run`,
      expected_output: "test/output/local_script_extension_plan.json",
      db_mutation_required: false,
      operator_approval_required: true,
      external_posting_risk: false,
      post_repair_validation_command:
        `npm run ops:local-script-extension -- --story-id ${storyId} --apply-local-audio --apply-limit 1`,
    })),
    ...shortenScriptStoryIds.map((storyId) => ({
      work_order_id: `local_audio_duration_repair:${storyId}`,
      story_id: storyId,
      blocker_type: "duration_too_long",
      repair_lane: "local_audio_duration_repair",
      exact_missing_input: "64-70 second local Liam-safe narration text and fresh timestamped proof audio",
      recommended_command:
        `npm run ops:reprocess-script-failures -- --story-id ${storyId} --force-story --source-bound-only --dry-run --json`,
      expected_output: "test/output/script_failure_reprocess.json",
      db_mutation_required: false,
      operator_approval_required: true,
      external_posting_risk: false,
      post_repair_validation_command:
        `npm run ops:local-script-extension -- --story-id ${storyId} --dry-run`,
    })),
  ];
  const retryWorkOrders = retryTtsStoryIds.map((storyId) => ({
    work_order_id: `local_tts_retry:${storyId}`,
    story_id: storyId,
    blocker_type: "local_tts_transport_failure",
    repair_lane: "local_tts_retry",
    exact_missing_input: "fresh local Liam proof audio after TTS health is green and the local script-extension preflight returns ready",
    preflight_required: true,
    preflight_command: `npm run ops:local-script-extension -- --story-id ${storyId} --dry-run`,
    recommended_command: `npm run ops:local-script-extension -- --story-id ${storyId} --dry-run`,
    apply_command: `npm run ops:local-script-extension -- --story-id ${storyId} --apply-local-audio --apply-limit 1`,
    expected_output: "test/output/local_script_extension_plan.json",
    db_mutation_required: false,
    operator_approval_required: false,
    external_posting_risk: false,
    post_repair_validation_command: "npm run tts:overnight-report -- --json",
  }));
  const blockedByVoiceQuality = proofRejected.some((row) =>
    [
      "reject_unaccepted_voice",
      "reject_unsafe_voice",
      "reject_demonic_low_voice_risk",
      "reject_pitch_profile_unverified",
      "reject_missing_spoken_outro",
    ].includes(row.verdict),
  );
  const hasWork =
    extendScriptStoryIds.length > 0 ||
    shortenScriptStoryIds.length > 0 ||
    retryTtsStoryIds.length > 0;
  return {
    local_only: true,
    blocked_by_voice_quality: blockedByVoiceQuality,
    extend_script_story_ids: extendScriptStoryIds,
    shorten_script_story_ids: shortenScriptStoryIds,
    retry_tts_story_ids: retryTtsStoryIds,
    work_orders: [...durationWorkOrders, ...retryWorkOrders],
    commands: hasWork
      ? [
          "npm run ops:local-media-repair -- --dry-run",
          "npm run ops:local-script-extension -- --dry-run",
          "npm run ops:local-script-extension -- --apply-local-audio --apply-limit 3",
          "npm run tts:overnight-report",
        ]
      : [],
    notes: hasWork
      ? [
          "duration_too_short proofs should be repaired by local script extension before another Studio V2 proof render",
          "timeout/reset stories can be retried locally after the TTS server health check is green",
        ]
      : ["no local recovery work required for the current proof batch"],
  };
}

function buildLocalTtsOvernightReport({
  doctorReport = {},
  repairQueue = {},
  audioApply = {},
  audioApplyReports = null,
  expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  generatedAt = new Date().toISOString(),
} = {}) {
  const reports = Array.isArray(audioApplyReports)
    ? audioApplyReports
    : [normaliseProofReport(audioApply, "local_media_repair")];
  const proofReports = reports.map((entry, index) => {
    if (entry?.applied || entry?.skipped) {
      return normaliseProofReport(entry, entry.proof_source || entry.source || `proof_batch_${index + 1}`);
    }
    return normaliseProofReport(entry?.report, entry?.source || `proof_batch_${index + 1}`);
  });

  const applied = proofReports.flatMap((report) => report.applied).map((rawRow) => {
    const row = {
      story_id: rawRow.story_id || null,
      proof_source: rawRow.proof_source || "unknown",
      output_audio_path: rawRow.output_audio_path || null,
      resolved_audio_path: rawRow.resolved_audio_path || null,
      word_count: numberOrNull(rawRow.text_word_count ?? rawRow.word_count),
      estimated_seconds: numberOrNull(rawRow.estimated_seconds),
      duration_seconds: numberOrNull(rawRow.duration_seconds),
      duration_verdict: rawRow.duration_verdict || "unknown",
      target_duration_verdict: targetDurationVerdict(rawRow.duration_seconds),
      failure_code: rawRow.failure_code || null,
      acoustic: acousticFor(rawRow),
      transcript: transcriptFor(rawRow),
      local_pace: rawRow.local_pace || null,
      local_voice_reference: rawRow.local_voice_reference || null,
      local_voice_metadata: rawRow.local_voice_metadata || "unknown",
      timestamp_verdict: timestampVerdict(rawRow),
    };
    row.wpm = numberOrNull(rawRow.wpm) || wordsPerMinute(row.word_count, row.duration_seconds);
    row.spoken_outro_present = hasSpokenOutro(row.transcript);
    row.verdict = proofVerdict(row, expectedVoiceId);
    row.voice_verdict = row.verdict;
    return row;
  });
  const skipped = proofReports.flatMap((report) => report.skipped).map((row) => ({
    story_id: row.story_id || null,
    proof_source: row.proof_source || "unknown",
    reason: row.reason || "unknown",
    failure_code: row.failure_code || null,
    server_reset_recorded: row.server_reset_recorded === true,
  }));

  const proofReady = applied.filter((row) => row.verdict === "voice_ready");
  const readyStoryIds = new Set(proofReady.map((row) => row.story_id).filter(Boolean));
  const allRejected = applied.filter((row) => row.verdict !== "voice_ready");
  const proofRejected = allRejected.filter((row) => !readyStoryIds.has(row.story_id));
  const supersededRejected = allRejected.filter((row) => readyStoryIds.has(row.story_id));
  const activeSkipped = skipped.filter((row) => !readyStoryIds.has(row.story_id));
  const supersededSkipped = skipped.filter((row) => readyStoryIds.has(row.story_id));
  const doctorGreen = String(doctorReport.verdict || "").toLowerCase() === "green";
  const currentDoctorSummary = doctorReport.after || doctorReport.before || {};
  const localReady =
    doctorGreen &&
    bool(currentDoctorSummary.ok) &&
    bool(currentDoctorSummary.voice?.loaded) &&
    bool(currentDoctorSummary.voice?.refResolved);

  let verdict = "AMBER";
  if (!doctorGreen || doctorReport.failure_code) verdict = "RED";
  else if (applied.length > 0 && proofRejected.length === 0 && activeSkipped.length === 0) verdict = "GREEN";

  const failureCounts = countBy(
    [
      ...proofRejected.map((row) => ({ code: row.failure_code || row.verdict })),
      ...activeSkipped.map((row) => ({ code: row.failure_code || row.reason })),
    ],
    (row) => row.code,
  );
  const supersededFailureCounts = countBy(
    [
      ...supersededRejected.map((row) => ({ code: row.failure_code || row.verdict })),
      ...supersededSkipped.map((row) => ({ code: row.failure_code || row.reason })),
    ],
    (row) => row.code,
  );
  const recoveryPlan = buildRecoveryPlan(proofRejected, activeSkipped, proofReady);

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
        alias: currentDoctorSummary.voice?.alias || null,
        loaded: bool(currentDoctorSummary.voice?.loaded),
        ref_resolved: bool(currentDoctorSummary.voice?.refResolved),
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
      superseded_rejected_count: supersededRejected.length,
      skipped_count: activeSkipped.length,
      superseded_skipped_count: supersededSkipped.length,
      failure_counts: failureCounts,
      superseded_failure_counts: supersededFailureCounts,
      source_counts: countBy(applied, (row) => row.proof_source),
      applied,
      skipped: activeSkipped,
      superseded_failed_attempts: [...supersededRejected, ...supersededSkipped],
    },
    recovery_plan: recoveryPlan,
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
  lines.push(
    `Local proof preferred duration: ${LOCAL_PROOF_TARGET_MIN_SECONDS}-${LOCAL_PROOF_TARGET_MAX_SECONDS}s preferred, 61-75s accepted`,
  );
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
    `- applied=${report.proof_batch.applied_count} voice_ready=${report.proof_batch.voice_ready_count} rejected=${report.proof_batch.rejected_count} skipped=${report.proof_batch.skipped_count} superseded=${(report.proof_batch.superseded_rejected_count || 0) + (report.proof_batch.superseded_skipped_count || 0)}`,
  );
  const failureKeys = Object.keys(report.proof_batch.failure_counts || {});
  lines.push(`- failures=${failureKeys.length ? failureKeys.map((key) => `${key}:${report.proof_batch.failure_counts[key]}`).join(", ") : "none"}`);
  const supersededKeys = Object.keys(report.proof_batch.superseded_failure_counts || {});
  if (supersededKeys.length) {
    lines.push(
      `- superseded_failures=${supersededKeys.map((key) => `${key}:${report.proof_batch.superseded_failure_counts[key]}`).join(", ")}`,
    );
  }
  lines.push("");
  lines.push("## Voice-Ready MP3s");
  const ready = report.proof_batch.applied.filter((row) => row.verdict === "voice_ready");
  if (!ready.length) {
    lines.push("- none");
  } else {
    for (const row of ready) {
      lines.push(
        `- ${row.story_id}: source=${row.proof_source} | measured=${row.duration_seconds ?? "unknown"}s | target=${row.target_duration_verdict || "unknown"} | estimated=${row.estimated_seconds ?? "unknown"}s | ${row.word_count ?? "unknown"} words | ${row.wpm ?? "unknown"} WPM | pitch=${row.acoustic?.medianPitchHz ?? "unknown"}Hz | outro=${row.spoken_outro_present} | ${row.resolved_audio_path || row.output_audio_path}`,
      );
    }
  }
  const readyStoryIds = new Set(ready.map((row) => row.story_id).filter(Boolean));
  const rejected = report.proof_batch.applied.filter(
    (row) => row.verdict !== "voice_ready" && !readyStoryIds.has(row.story_id),
  );
  if (rejected.length) {
    lines.push("");
    lines.push("## Unresolved Rejected Proofs");
    for (const row of rejected) {
      lines.push(
        `- ${row.story_id}: source=${row.proof_source} | ${row.verdict}${row.failure_code ? ` (${row.failure_code})` : ""}`,
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
  if (report.proof_batch.superseded_failed_attempts?.length) {
    lines.push("");
    lines.push("## Superseded Failed Attempts");
    for (const row of report.proof_batch.superseded_failed_attempts) {
      const label = row.verdict || row.reason || "failed_attempt";
      lines.push(
        `- ${row.story_id}: source=${row.proof_source || "unknown"} | ${label}${row.failure_code ? ` (${row.failure_code})` : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("## Local Recovery Plan");
  lines.push(`- local_only=${report.recovery_plan.local_only}`);
  lines.push(
    `- extend_script_story_ids=${report.recovery_plan.extend_script_story_ids.length ? report.recovery_plan.extend_script_story_ids.join(", ") : "none"}`,
  );
  lines.push(
    `- shorten_script_story_ids=${report.recovery_plan.shorten_script_story_ids?.length ? report.recovery_plan.shorten_script_story_ids.join(", ") : "none"}`,
  );
  lines.push(
    `- retry_tts_story_ids=${report.recovery_plan.retry_tts_story_ids.length ? report.recovery_plan.retry_tts_story_ids.join(", ") : "none"}`,
  );
  lines.push(`- blocked_by_voice_quality=${report.recovery_plan.blocked_by_voice_quality}`);
  if (report.recovery_plan.commands.length) {
    lines.push("- commands:");
    for (const command of report.recovery_plan.commands) {
      lines.push(`  - \`${command}\``);
    }
  }
  if (report.recovery_plan.notes.length) {
    lines.push("- notes:");
    for (const note of report.recovery_plan.notes) {
      lines.push(`  - ${note}`);
    }
  }
  if (report.recovery_plan.work_orders?.length) {
    lines.push("");
    lines.push("## Recovery Work Orders");
    for (const order of report.recovery_plan.work_orders) {
      lines.push(`- ${order.work_order_id}: ${order.blocker_type} via ${order.repair_lane}`);
      if (order.preflight_command) lines.push(`  - preflight: \`${order.preflight_command}\``);
      lines.push(`  - command: \`${order.recommended_command}\``);
      if (order.apply_command) lines.push(`  - apply: \`${order.apply_command}\``);
      lines.push(`  - validate: \`${order.post_repair_validation_command}\``);
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
