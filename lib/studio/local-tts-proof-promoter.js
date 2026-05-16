"use strict";

const path = require("node:path");

const {
  DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  resolveAcceptedLocalVoiceReference,
} = require("./v2/local-voice-reference");

const DEFAULT_MIN_LOCAL_VOICE_LUFS = -20;
const DEFAULT_MAX_LOCAL_VOICE_LUFS = -13.5;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return [...new Set(list(values).filter(Boolean))];
}

function normalisePathKey(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function timestampPathForAudio(audioPath) {
  const value = String(audioPath || "");
  if (!/\.(mp3|wav|m4a)$/i.test(value)) return null;
  return value.replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json");
}

function timestampCandidatesForRow(row = {}) {
  return unique([
    row.timestamps_path,
    row.timestamp_path,
    row.resolved_timestamps_path,
    timestampPathForAudio(row.resolved_audio_path),
    timestampPathForAudio(row.output_audio_path),
    timestampPathForAudio(row.audio_path),
  ]);
}

function buildTimestampPayloadLookup(timestampPayloads = {}) {
  const lookup = new Map();
  for (const [rawKey, payload] of Object.entries(timestampPayloads || {})) {
    lookup.set(String(rawKey), payload);
    lookup.set(normalisePathKey(rawKey), payload);
  }
  return lookup;
}

function lookupTimestampPayload(row, timestampPayloads = {}) {
  const lookup = buildTimestampPayloadLookup(timestampPayloads);
  for (const candidate of timestampCandidatesForRow(row)) {
    if (lookup.has(candidate)) return { path: candidate, payload: lookup.get(candidate) };
    const normalised = normalisePathKey(candidate);
    if (lookup.has(normalised)) {
      return { path: candidate, payload: lookup.get(normalised) };
    }
  }
  return {
    path: timestampCandidatesForRow(row)[0] || null,
    payload: null,
  };
}

function referenceSummary(reference = {}) {
  return {
    id: reference?.id || null,
    fileName: reference?.fileName || reference?.file_name || null,
    referencePresent: reference?.referencePresent === true || reference?.reference_present === true,
    referenceHash: reference?.referenceHash || reference?.reference_hash || reference?.hash || null,
  };
}

function acceptedReferenceOk(reference = {}, expectedId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  const ref = referenceSummary(reference);
  return (
    String(ref.id || "") === String(expectedId) &&
    ref.referencePresent === true &&
    /^[a-f0-9]{40,64}$/i.test(String(ref.referenceHash || ""))
  );
}

function evaluateApprovedVoiceSample({
  acceptedReference = null,
  expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  env = process.env,
} = {}) {
  const reference = referenceSummary(
    acceptedReference || resolveAcceptedLocalVoiceReference(env),
  );
  const blockers = [];
  if (reference.id !== expectedVoiceId) {
    blockers.push("approved_sleepy_liam_reference_id_mismatch");
  }
  if (reference.referencePresent !== true) {
    blockers.push("approved_sleepy_liam_sample_missing");
  }
  if (!/^[a-f0-9]{40,64}$/i.test(String(reference.referenceHash || ""))) {
    blockers.push("approved_sleepy_liam_reference_hash_missing");
  }

  return {
    ok: blockers.length === 0,
    expected_id: expectedVoiceId,
    id: reference.id,
    file_name: reference.fileName,
    reference_present: reference.referencePresent,
    reference_hash_present: Boolean(reference.referenceHash),
    blockers,
  };
}

function currentDoctorSummary(doctorReport = {}) {
  return doctorReport.after || doctorReport.before || {};
}

function evaluateHealth(doctorReport = {}, expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  const summary = currentDoctorSummary(doctorReport);
  const voice = summary.voice || {};
  const voiceReference = referenceSummary(voice.reference || {});
  const blockers = [];
  if (!doctorReport || Object.keys(doctorReport).length === 0) {
    blockers.push("local_tts_doctor_missing");
  }
  if (String(doctorReport.verdict || "").toLowerCase() !== "green") {
    blockers.push("local_tts_health_not_green");
  }
  if (doctorReport.failure_code) {
    blockers.push(`local_tts_failure:${doctorReport.failure_code}`);
  }
  if (summary.ok !== true) {
    blockers.push("local_tts_health_not_ok");
  }
  if (voice.loaded !== true) {
    blockers.push("local_tts_voice_not_loaded");
  }
  if (voice.refResolved !== true && voice.ref_resolved !== true) {
    blockers.push("local_tts_voice_reference_not_resolved");
  }
  if (voiceReference.id && voiceReference.id !== expectedVoiceId) {
    blockers.push("local_tts_health_reference_id_mismatch");
  }

  return {
    ok: blockers.length === 0,
    doctor_verdict: doctorReport.verdict || "unknown",
    failure_code: doctorReport.failure_code || null,
    status: summary.status || "unknown",
    phase: summary.phase || "unknown",
    ready: summary.ready === true || summary.ok === true,
    voice: {
      alias: voice.alias || null,
      loaded: voice.loaded === true,
      ref_resolved: voice.refResolved === true || voice.ref_resolved === true,
      reference_id: voiceReference.id,
      reference_hash_present: Boolean(voiceReference.referenceHash),
    },
    blockers: unique(blockers),
  };
}

function normaliseProofReport(entry, index = 0) {
  if (!entry || typeof entry !== "object") {
    return { source: `proof_batch_${index + 1}`, applied: [], skipped: [] };
  }
  const report = entry.report && typeof entry.report === "object" ? entry.report : entry;
  const source = entry.source || entry.proof_source || report.source || `proof_batch_${index + 1}`;
  return {
    source,
    applied: list(report.applied).map((row) => ({
      ...row,
      proof_source: row.proof_source || source,
    })),
    skipped: list(report.skipped).map((row) => ({
      ...row,
      proof_source: row.proof_source || source,
    })),
  };
}

function dedupeRows(rows, keyFn) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function proofRowIdentity(row = {}) {
  const audioPath = row.resolved_audio_path || row.output_audio_path || row.audio_path || "";
  const audioName = path.basename(String(audioPath).replace(/\\/g, "/"));
  return [
    row.story_id || "unknown",
    row.proof_source || "unknown",
    audioName || audioPath,
    row.duration_seconds ?? "",
    row.failure_code || "",
  ].join(":");
}

function skippedRowIdentity(row = {}) {
  return [
    row.story_id || "unknown",
    row.reason || "",
    row.failure_code || "",
  ].join(":");
}

function collectLocalTtsProofRows({
  proofReports = [],
  overnightReport = null,
} = {}) {
  const reports = list(proofReports).map(normaliseProofReport);
  if (overnightReport?.proof_batch) {
    reports.push({
      source: "local_tts_overnight_report",
      applied: list(overnightReport.proof_batch.applied).map((row) => ({
        ...row,
        proof_source: row.proof_source || "local_tts_overnight_report",
      })),
      skipped: list(overnightReport.proof_batch.skipped).map((row) => ({
        ...row,
        proof_source: row.proof_source || "local_tts_overnight_report",
      })),
    });
  }

  const applied = dedupeRows(
    reports.flatMap((report) => report.applied),
    proofRowIdentity,
  );
  const skipped = dedupeRows(
    reports.flatMap((report) => report.skipped),
    skippedRowIdentity,
  );
  return { applied, skipped };
}

function acceptedProofReference(row = {}, expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  const ref = referenceSummary(row.local_voice_reference || row.acceptedLocalVoice || {});
  return String(ref.id || "") === String(expectedVoiceId) && ref.referencePresent === true;
}

function rowIsVoiceReady(row = {}, expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  if (String(row.verdict || "") === "voice_ready") return true;
  return (
    !row.failure_code &&
    String(row.duration_verdict || "").toLowerCase() === "pass" &&
    acceptedProofReference(row, expectedVoiceId)
  );
}

function evaluateGenerationEvidence(rows, expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
  const readyRows = rows.applied.filter((row) => rowIsVoiceReady(row, expectedVoiceId));
  const readyStoryIds = new Set(readyRows.map((row) => row.story_id).filter(Boolean));
  const unresolvedRejected = rows.applied.filter(
    (row) => !rowIsVoiceReady(row, expectedVoiceId) && !readyStoryIds.has(row.story_id),
  );
  const unresolvedSkipped = rows.skipped.filter((row) => !readyStoryIds.has(row.story_id));
  const blockers = [];
  if (readyRows.length === 0) blockers.push("local_tts_generation_evidence_missing");
  if (unresolvedRejected.length > 0 || unresolvedSkipped.length > 0) {
    blockers.push("local_tts_unresolved_generation_failures");
  }

  return {
    ok: blockers.length === 0,
    ready_count: readyRows.length,
    unresolved_rejected_count: unresolvedRejected.length,
    unresolved_skipped_count: unresolvedSkipped.length,
    ready_rows: readyRows,
    blockers,
  };
}

function timingArray(payload = {}, names = []) {
  for (const name of names) {
    if (Array.isArray(payload[name])) return payload[name];
  }
  return [];
}

function transcriptFromPayload(payload = {}) {
  if (typeof payload.meta?.transcript === "string" && payload.meta.transcript.trim()) {
    return payload.meta.transcript.trim();
  }
  if (Array.isArray(payload.characters)) {
    return payload.characters.join("").replace(/\s+/g, " ").trim();
  }
  return "";
}

function hasSpokenOutro(transcript) {
  return String(transcript || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .includes("follow pulse gaming so you never miss a beat");
}

function evaluateTimestampEvidenceForRow(row = {}, timestampPayloads = {}) {
  const { path: timestampsPath, payload } = lookupTimestampPayload(row, timestampPayloads);
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      story_id: row.story_id || null,
      timestamps_path: timestampsPath,
      reason: "timestamp_evidence_missing",
      blockers: ["timestamp_evidence_missing"],
    };
  }

  const characters = list(payload.characters);
  const starts = timingArray(payload, [
    "character_start_times_seconds",
    "character_start_times",
    "char_start_times_seconds",
    "char_start_times",
    "character_start_times_ms",
  ]);
  const ends = timingArray(payload, [
    "character_end_times_seconds",
    "character_end_times",
    "char_end_times_seconds",
    "char_end_times",
    "character_end_times_ms",
  ]);
  const transcript = transcriptFromPayload(payload);
  const metaRef = referenceSummary(payload.meta?.acceptedLocalVoice || {});
  const blockers = [];
  if (!characters.length) blockers.push("timestamp_characters_missing");
  if (!starts.length || !ends.length || starts.length !== characters.length || ends.length !== characters.length) {
    blockers.push("timestamp_timing_unusable");
  }
  if (metaRef.id && metaRef.id !== DEFAULT_ACCEPTED_LOCAL_VOICE_ID) {
    blockers.push("timestamp_voice_reference_mismatch");
  }
  if (payload.meta?.acceptedLocalVoice && metaRef.referencePresent !== true) {
    blockers.push("timestamp_voice_reference_unverified");
  }
  if (transcript && !hasSpokenOutro(transcript)) {
    blockers.push("timestamp_spoken_outro_missing");
  }

  return {
    ok: blockers.length === 0,
    story_id: row.story_id || null,
    timestamps_path: timestampsPath,
    character_count: characters.length,
    timing_count: Math.min(starts.length, ends.length),
    transcript_present: Boolean(transcript),
    spoken_outro_present: transcript ? hasSpokenOutro(transcript) : null,
    blockers,
  };
}

function nested(...values) {
  for (const value of values) {
    if (value && typeof value === "object") return value;
  }
  return {};
}

function acousticValue(acoustic = {}, ...keys) {
  for (const key of keys) {
    const value = numberOrNull(acoustic[key]);
    if (value !== null) return value;
  }
  return null;
}

function evaluateMasteringEvidenceForRow({
  row = {},
  timestampPayloads = {},
  minIntegratedLufs = DEFAULT_MIN_LOCAL_VOICE_LUFS,
  maxIntegratedLufs = DEFAULT_MAX_LOCAL_VOICE_LUFS,
} = {}) {
  const { path: timestampsPath, payload } = lookupTimestampPayload(row, timestampPayloads);
  const meta = payload?.meta || {};
  const mastering = nested(
    meta.voiceMastering,
    meta.voice_mastering,
    meta.mastering,
    row.voiceMastering,
    row.voice_mastering,
    row.mastering,
  );
  const masteringOk =
    mastering.ok === true || String(mastering.code || "").toLowerCase() === "voice_mastered";
  const acoustic = nested(
    mastering.acoustic,
    meta.acoustic,
    row.acoustic,
  );
  const integratedLufs = acousticValue(
    acoustic,
    "integratedLufs",
    "integratedLUFS",
    "lufs",
    "input_i",
    "inputI",
    "output_i",
    "outputI",
  );
  const truePeakDb = acousticValue(
    acoustic,
    "truePeakDb",
    "truePeakDB",
    "true_peak_db",
    "truePeak",
    "input_tp",
    "inputTp",
    "output_tp",
    "outputTp",
  );
  const blockers = [];
  const warnings = [];
  if (!masteringOk) blockers.push("voice_mastering_evidence_missing");
  if (integratedLufs === null) blockers.push("voice_loudness_evidence_missing");
  else if (integratedLufs < minIntegratedLufs) blockers.push("voice_loudness_too_quiet");
  else if (integratedLufs > maxIntegratedLufs) blockers.push("voice_loudness_too_hot");
  if (truePeakDb === null) warnings.push("voice_true_peak_unverified");

  return {
    ok: blockers.length === 0,
    story_id: row.story_id || null,
    timestamps_path: timestampsPath,
    mastering_code: mastering.code || null,
    target_lufs: numberOrNull(mastering.targetLufs ?? mastering.target_lufs),
    integrated_lufs: integratedLufs,
    true_peak_db: truePeakDb,
    min_integrated_lufs: minIntegratedLufs,
    max_integrated_lufs: maxIntegratedLufs,
    blockers,
    warnings,
  };
}

function evaluateReadyRowsEvidence({
  readyRows = [],
  timestampPayloads = {},
  env = process.env,
} = {}) {
  const minIntegratedLufs =
    numberOrNull(env.STUDIO_FLASH_VOICE_MIN_LOCAL_LUFS) ?? DEFAULT_MIN_LOCAL_VOICE_LUFS;
  const maxIntegratedLufs =
    numberOrNull(env.STUDIO_FLASH_VOICE_MAX_LOCAL_LUFS) ?? DEFAULT_MAX_LOCAL_VOICE_LUFS;
  const timestampRows = readyRows.map((row) =>
    evaluateTimestampEvidenceForRow(row, timestampPayloads),
  );
  const masteringRows = readyRows.map((row) =>
    evaluateMasteringEvidenceForRow({
      row,
      timestampPayloads,
      minIntegratedLufs,
      maxIntegratedLufs,
    }),
  );

  return {
    timestamps: {
      ok: readyRows.length > 0 && timestampRows.every((row) => row.ok),
      usable_count: timestampRows.filter((row) => row.ok).length,
      checked_count: timestampRows.length,
      rows: timestampRows,
      blockers: unique(timestampRows.flatMap((row) => row.blockers)),
    },
    mastering: {
      ok: readyRows.length > 0 && masteringRows.every((row) => row.ok),
      mastered_count: masteringRows.filter((row) => row.ok).length,
      checked_count: masteringRows.length,
      rows: masteringRows,
      blockers: unique(masteringRows.flatMap((row) => row.blockers)),
      warnings: unique(masteringRows.flatMap((row) => row.warnings)),
    },
  };
}

function buildLocalTtsProofPromotionReport({
  acceptedReference = null,
  doctorReport = {},
  overnightReport = null,
  proofReports = [],
  timestampPayloads = {},
  expectedVoiceId = DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  generatedAt = new Date().toISOString(),
  env = process.env,
} = {}) {
  const voiceSample = evaluateApprovedVoiceSample({
    acceptedReference,
    expectedVoiceId,
    env,
  });
  const health = evaluateHealth(doctorReport, expectedVoiceId);
  const rows = collectLocalTtsProofRows({ proofReports, overnightReport });
  const generation = evaluateGenerationEvidence(rows, expectedVoiceId);
  const rowEvidence = evaluateReadyRowsEvidence({
    readyRows: generation.ready_rows,
    timestampPayloads,
    env,
  });
  const blockers = unique([
    ...voiceSample.blockers,
    ...health.blockers,
    ...generation.blockers,
    ...rowEvidence.timestamps.blockers,
    ...rowEvidence.mastering.blockers,
  ]);
  const warnings = unique(rowEvidence.mastering.warnings);
  const verdict = blockers.length > 0 ? "RED" : warnings.length > 0 ? "AMBER" : "GREEN";
  const canReplace = verdict === "GREEN";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    verdict,
    can_replace_elevenlabs_for_proof_renders: canReplace,
    recommendation: canReplace
      ? "local_tts_can_replace_elevenlabs_for_proof_renders"
      : "keep_elevenlabs_for_proof_renders_until_blockers_clear",
    expected_local_voice_id: expectedVoiceId,
    blockers,
    warnings,
    gates: {
      approved_voice_sample: voiceSample,
      health,
      generation_evidence: {
        ok: generation.ok,
        ready_count: generation.ready_count,
        unresolved_rejected_count: generation.unresolved_rejected_count,
        unresolved_skipped_count: generation.unresolved_skipped_count,
        blockers: generation.blockers,
      },
      timestamp_usability: rowEvidence.timestamps,
      loudness_mastering: rowEvidence.mastering,
    },
    proof_candidates: generation.ready_rows.map((row) => ({
      story_id: row.story_id || null,
      proof_source: row.proof_source || null,
      audio_path: row.resolved_audio_path || row.output_audio_path || row.audio_path || null,
      duration_seconds: numberOrNull(row.duration_seconds),
      wpm: numberOrNull(row.wpm),
      local_voice_reference_id: row.local_voice_reference?.id || null,
    })),
    safety: {
      local_only: true,
      read_only: true,
      production_voice_unchanged: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      paid_credits_spent: false,
      render_default_changed: false,
    },
  };
}

function renderLocalTtsProofPromotionMarkdown(report) {
  const lines = [];
  lines.push("# Local TTS Proof Render Promotion");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(
    `Can replace ElevenLabs for proof renders: ${report.can_replace_elevenlabs_for_proof_renders ? "yes" : "no"}`,
  );
  lines.push(`Expected local voice: ${report.expected_local_voice_id}`);
  lines.push(`Recommendation: ${report.recommendation}`);
  lines.push(`Blockers: ${report.blockers.length ? report.blockers.join(", ") : "clear"}`);
  lines.push(`Warnings: ${report.warnings.length ? report.warnings.join(", ") : "none"}`);
  lines.push("");
  lines.push("## Gates");
  lines.push(
    `- approved_voice_sample=${report.gates.approved_voice_sample.ok} sample=${report.gates.approved_voice_sample.file_name || "missing"} hash=${report.gates.approved_voice_sample.reference_hash_present ? "present" : "missing"}`,
  );
  lines.push(
    `- health=${report.gates.health.ok} doctor=${report.gates.health.doctor_verdict} voice=${report.gates.health.voice.alias || "unknown"} loaded=${report.gates.health.voice.loaded} ref=${report.gates.health.voice.ref_resolved}`,
  );
  lines.push(
    `- generation_evidence=${report.gates.generation_evidence.ok} ready=${report.gates.generation_evidence.ready_count} unresolved_rejected=${report.gates.generation_evidence.unresolved_rejected_count} unresolved_skipped=${report.gates.generation_evidence.unresolved_skipped_count}`,
  );
  lines.push(
    `- timestamp_usability=${report.gates.timestamp_usability.ok} usable=${report.gates.timestamp_usability.usable_count}/${report.gates.timestamp_usability.checked_count}`,
  );
  lines.push(
    `- loudness_mastering=${report.gates.loudness_mastering.ok} mastered=${report.gates.loudness_mastering.mastered_count}/${report.gates.loudness_mastering.checked_count}`,
  );
  lines.push("");
  lines.push("## Proof Candidates");
  if (!report.proof_candidates.length) {
    lines.push("- none");
  } else {
    for (const candidate of report.proof_candidates) {
      lines.push(
        `- ${candidate.story_id}: source=${candidate.proof_source || "unknown"} duration=${candidate.duration_seconds ?? "unknown"}s wpm=${candidate.wpm ?? "unknown"} voice=${candidate.local_voice_reference_id || "missing"} audio=${candidate.audio_path || "missing"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local-only read/report check.");
  lines.push("- Production voice remains unchanged.");
  lines.push("- No ElevenLabs credits, OAuth flow, Railway env var, token, production DB row or platform post is touched.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLocalTtsProofPromotionReport,
  collectLocalTtsProofRows,
  evaluateApprovedVoiceSample,
  evaluateHealth,
  renderLocalTtsProofPromotionMarkdown,
  timestampCandidatesForRow,
  timestampPathForAudio,
};
