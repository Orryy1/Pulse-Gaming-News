"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const mediaPaths = require("./media-paths");

const MAX_SAFE_ASR_INSERTED_WORDS = 0;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function unique(values) {
  return [...new Set(asArray(values).map((value) => String(value)).filter(Boolean))];
}

function normalisePath(value) {
  return String(value || "").replace(/\\/g, path.sep);
}

function resolveReadablePath(value, { workspaceRoot, artifactDir } = {}) {
  const raw = cleanText(value);
  if (!raw) return null;
  if (/^[a-z_]+\.json:/i.test(raw)) return null;
  const normalised = normalisePath(raw);
  if (path.isAbsolute(normalised)) return path.resolve(normalised);
  if (
    normalised === "output" ||
    /^output[\\/]/i.test(normalised) ||
    normalised === "test" ||
    /^test[\\/]/i.test(normalised)
  ) {
    return path.resolve(workspaceRoot || process.cwd(), normalised);
  }
  const roots = unique([artifactDir, workspaceRoot, process.cwd()]);
  return roots.length ? path.resolve(roots[0], normalised) : path.resolve(normalised);
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function actionNeedsAudio(action = {}) {
  return cleanText(action.action_id) === "generate_final_narration_audio_and_word_timestamps";
}

function collectExpectationPaths(job = {}, extension) {
  const values = [];
  for (const action of asArray(job.actions)) {
    for (const expectation of asArray(action.output_expectations)) {
      const text = cleanText(expectation);
      if (text.toLowerCase().endsWith(extension)) values.push(text);
    }
  }
  return values;
}

function audioManifestAudioFields(manifest = {}) {
  return [
    manifest.narration_audio_path,
    manifest.final_narration_audio_path,
    manifest.audio_path,
    manifest.voice_path,
    manifest.enriched_audio_path,
  ];
}

function audioManifestTimestampFields(manifest = {}) {
  return [
    manifest.word_timestamps_path,
    manifest.word_timestamp_path,
    manifest.timestamps_path,
    manifest.enriched_timestamps_path,
  ];
}

function buildAudioCandidates(job = {}, audioManifest = {}, { workspaceRoot } = {}) {
  const storyId = cleanText(job.story_id);
  return unique([
    job.evidence?.narration_audio_path,
    ...audioManifestAudioFields(audioManifest),
    ...collectExpectationPaths(job, ".mp3"),
    path.join("output", "audio", `${storyId}.mp3`),
  ]).map((candidate) =>
    resolveReadablePath(candidate, {
      workspaceRoot,
      artifactDir: job.artifact_dir || null,
    }),
  ).filter(Boolean);
}

function buildTimestampCandidates(job = {}, audioManifest = {}, { workspaceRoot } = {}) {
  const storyId = cleanText(job.story_id);
  return unique([
    job.evidence?.word_timestamps_path,
    ...audioManifestTimestampFields(audioManifest),
    ...collectExpectationPaths(job, ".json"),
    path.join("output", "audio", `${storyId}_timestamps.json`),
    path.join("output", "audio", `${storyId}_timing.json`),
  ]).map((candidate) =>
    resolveReadablePath(candidate, {
      workspaceRoot,
      artifactDir: job.artifact_dir || null,
    }),
  ).filter(Boolean);
}

async function inspectAudioCandidate(filePath) {
  const resolvedPath = await resolveCandidateWithMediaRoot(filePath);
  if (!resolvedPath || !(await fs.pathExists(resolvedPath))) {
    return { path: filePath || null, exists: false, usable: false, size_bytes: 0, mtime_ms: null };
  }
  const stat = await fs.stat(resolvedPath);
  return {
    path: path.resolve(resolvedPath),
    exists: true,
    usable: stat.isFile() && stat.size >= 1024,
    size_bytes: stat.size,
    mtime_ms: stat.mtimeMs,
  };
}

function relativeOutputPath(filePath) {
  const text = String(filePath || "");
  const match = text.match(/[\\/]output[\\/].+$/i);
  if (!match) return null;
  return match[0].replace(/^[\\/]/, "").replace(/\\/g, "/");
}

async function resolveCandidateWithMediaRoot(filePath) {
  if (!filePath) return null;
  const rel = relativeOutputPath(filePath);
  if (rel) {
    const resolved = await mediaPaths.resolveExisting(rel).catch(() => null);
    if (resolved && (await fs.pathExists(resolved))) return resolved;
  }
  if (await fs.pathExists(filePath)) return filePath;
  return filePath;
}

function extractWords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.words)) return payload.words;
  return [];
}

function hasCharacterAlignment(payload) {
  return (
    Array.isArray(payload?.characters) ||
    Array.isArray(payload?.alignment?.characters) ||
    Array.isArray(payload?.timestamps?.alignment?.characters)
  );
}

function validWordTimestamp(word = {}) {
  return (
    cleanText(word.word || word.text) !== "" &&
    Number.isFinite(Number(word.start)) &&
    Number.isFinite(Number(word.end)) &&
    Number(word.end) >= Number(word.start)
  );
}

function timestampMeta(payload = {}) {
  return payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
}

function timestampIsAsrAligned(meta = {}) {
  const source = cleanText(meta.wordTimestampSource || meta.word_timestamp_source).toLowerCase();
  return (
    source === "local_whisper_word_alignment" ||
    meta.timestampWhisperAlignment?.repaired === true ||
    meta.timestamp_whisper_alignment?.repaired === true
  );
}

function whisperAttemptModelNames(alignment = {}) {
  const names = [];
  for (const attempt of asArray(alignment.model_attempts)) {
    if (typeof attempt === "string") names.push(cleanText(attempt).toLowerCase());
    else names.push(cleanText(attempt?.model).toLowerCase());
  }
  const finalModel = cleanText(alignment.model).toLowerCase();
  if (finalModel) names.push(finalModel);
  return unique(names).filter(Boolean);
}

function timestampWhisperFailureRequiresRegeneration(alignment = {}) {
  if (!alignment || typeof alignment !== "object") return false;
  if (alignment.repaired === true) return false;
  const error = cleanText(alignment.error).toLowerCase();
  const terminalScriptMismatch =
    /reconciled_word_count_mismatch|script_coverage_below_threshold|script_opening_not_covered|whisper_script_coverage_failed/.test(
      error,
    );
  if (!terminalScriptMismatch) return false;
  const modelNames = whisperAttemptModelNames(alignment);
  return modelNames.some((name) => name.includes("small")) || modelNames.length >= 2;
}

function timestampWhisperNeedsAlignmentRetry(alignment = {}) {
  if (!alignment || typeof alignment !== "object") return false;
  if (alignment.repaired === true) return false;
  if (timestampWhisperFailureRequiresRegeneration(alignment)) return false;
  return cleanText(alignment.error) !== "";
}

function timestampWhisperQualityIssue(alignment = {}) {
  if (!alignment || typeof alignment !== "object") return null;
  const insertedWordCount = Number(alignment.script_inserted_actual_word_count);
  if (Number.isFinite(insertedWordCount) && insertedWordCount > MAX_SAFE_ASR_INSERTED_WORDS) {
    return "asr_inserted_words_above_threshold";
  }
  const trailingWordCount = Number(alignment.script_trailing_actual_word_count);
  if (Number.isFinite(trailingWordCount) && trailingWordCount > 0) {
    return "asr_trailing_words_detected";
  }
  return null;
}

function buildAsrFailureSummary(candidate = {}) {
  const alignment = candidate.timestamp_whisper_alignment || null;
  if (!timestampWhisperFailureRequiresRegeneration(alignment)) return null;
  return {
    status: "exhausted_requires_narration_regeneration",
    reason: cleanText(alignment.error) || "whisper_script_alignment_exhausted",
    model: cleanText(alignment.model) || null,
    model_attempts: whisperAttemptModelNames(alignment),
    script_coverage_ratio: alignment.script_coverage_ratio ?? null,
    script_opening_covered: alignment.script_opening_covered ?? null,
  };
}

async function inspectTimestampCandidate(filePath) {
  const resolvedPath = await resolveCandidateWithMediaRoot(filePath);
  if (!resolvedPath || !(await fs.pathExists(resolvedPath))) {
    return {
      path: filePath || null,
      exists: false,
      usable: false,
      word_count: 0,
      format: "missing",
      reason: "timestamp_file_missing",
      mtime_ms: null,
    };
  }
  const stat = await fs.stat(resolvedPath);
  const payload = await readJsonIfPresent(resolvedPath, null);
  if (!payload) {
    return {
      path: path.resolve(resolvedPath),
      exists: true,
      usable: false,
      word_count: 0,
      format: "invalid_json",
      reason: "timestamp_json_invalid",
      mtime_ms: stat.mtimeMs,
    };
  }
  const words = extractWords(payload).filter(validWordTimestamp);
  const meta = timestampMeta(payload);
  const timestampWhisperAlignment = meta.timestampWhisperAlignment || meta.timestamp_whisper_alignment || null;
  const asrQualityIssue = timestampWhisperQualityIssue(timestampWhisperAlignment);
  const asrAlignmentIssue = !asrQualityIssue && timestampWhisperNeedsAlignmentRetry(timestampWhisperAlignment);
  const asrRegenerationIssue = timestampWhisperFailureRequiresRegeneration(timestampWhisperAlignment);
  const timestampReason =
    asrQualityIssue ||
    (asrRegenerationIssue
      ? "asr_alignment_exhausted_regenerate_narration"
      : asrAlignmentIssue
        ? cleanText(timestampWhisperAlignment?.error) || "whisper_alignment_failed"
        : null);
  if (words.length > 0) {
    return {
      path: path.resolve(resolvedPath),
      exists: true,
      usable: !timestampReason,
      word_count: words.length,
      format: Array.isArray(payload) ? "word_array" : "words_object",
      reason: timestampReason,
      mtime_ms: stat.mtimeMs,
      word_timestamp_source: cleanText(meta.wordTimestampSource || meta.word_timestamp_source) || null,
      timestamp_whisper_alignment: timestampWhisperAlignment,
      requires_asr_quality_repair: Boolean(asrQualityIssue),
      requires_asr_alignment: Boolean(asrAlignmentIssue),
      requires_audio_regeneration:
        asrQualityIssue === "asr_inserted_words_above_threshold" || Boolean(asrRegenerationIssue),
      asr_aligned: timestampIsAsrAligned(meta) && !asrQualityIssue && !asrAlignmentIssue && !asrRegenerationIssue,
    };
  }
  return {
    path: path.resolve(resolvedPath),
    exists: true,
    usable: false,
    word_count: 0,
    format: hasCharacterAlignment(payload) ? "character_alignment" : "unknown",
    reason: hasCharacterAlignment(payload)
      ? "character_alignment_not_word_timestamps"
      : "word_timestamps_missing",
    mtime_ms: stat.mtimeMs,
  };
}

async function firstUsableAudio(candidates = []) {
  const inspected = [];
  for (const candidate of unique(candidates)) {
    const result = await inspectAudioCandidate(candidate);
    inspected.push(result);
    if (result.usable) return { selected: result, inspected };
  }
  return {
    selected: inspected.find((candidate) => candidate.exists) || inspected[0] || {
      path: null,
      exists: false,
      usable: false,
      size_bytes: 0,
    },
    inspected,
  };
}

async function firstUsableTimestamp(candidates = []) {
  const inspected = [];
  for (const candidate of unique(candidates)) {
    const result = await inspectTimestampCandidate(candidate);
    inspected.push(result);
    if (result.requires_asr_quality_repair) return { selected: result, inspected };
    if (result.requires_asr_alignment) return { selected: result, inspected };
    if (result.requires_audio_regeneration) return { selected: result, inspected };
    if (result.usable) return { selected: result, inspected };
  }
  return {
    selected: inspected.find((candidate) => candidate.exists) || inspected[0] || {
      path: null,
      exists: false,
      usable: false,
      word_count: 0,
      format: "missing",
      reason: "timestamp_file_missing",
    },
    inspected,
  };
}

function summariseLocalTtsDoctor(report = {}, { generatedAt = null, maxAgeMs = 15 * 60 * 1000 } = {}) {
  const verdict = cleanText(report.verdict || "unknown").toLowerCase() || "unknown";
  const failureCode = cleanText(report.failure_code || report.failureCode);
  const beforeStatus = cleanText(report.before?.status).toLowerCase();
  const afterStatus = cleanText(report.after?.status).toLowerCase();
  const reportMs = timeMs(report.generated_at || report.generatedAt);
  const generatedMs = timeMs(generatedAt);
  const ageMs = reportMs != null && generatedMs != null ? generatedMs - reportMs : null;
  const stale = ageMs != null && ageMs > maxAgeMs;
  const ready =
    !stale &&
    (
      verdict === "green" ||
      report.ready === true ||
      report.after?.ready === true ||
      report.after?.ok === true ||
      afterStatus === "ok"
    );
  const staleUnreachable =
    failureCode === "server_down" ||
    beforeStatus === "unreachable" ||
    /unreachable/i.test(cleanText(report.reason));
  return {
    verdict: stale ? "stale" : verdict,
    action: cleanText(report.action),
    failure_code: stale ? "stale_doctor_report" : failureCode || null,
    reason: stale
      ? `local TTS doctor report is stale; run npm run tts:doctor before materialising narration`
      : cleanText(report.reason),
    ready,
    stale,
    generated_at: report.generated_at || null,
    age_ms: ageMs,
    unreachable: ready ? false : staleUnreachable,
  };
}

function summariseElevenLabsTts(env = {}, { providerPreference = "auto" } = {}) {
  const preference = cleanText(providerPreference || "auto").toLowerCase();
  const disabled = /^(true|1|yes|on)$/i.test(String(env.ELEVENLABS_DISABLED || env.DISABLE_ELEVENLABS_TTS || ""));
  const hasApiKey = Boolean(cleanText(env.ELEVENLABS_API_KEY));
  const hasVoiceId = Boolean(cleanText(env.ELEVENLABS_VOICE_ID));
  const allowed = preference === "elevenlabs" && !disabled;
  const ready = allowed && hasApiKey && hasVoiceId;
  const missing = [];
  if (!hasApiKey) missing.push("ELEVENLABS_API_KEY");
  if (!hasVoiceId) missing.push("ELEVENLABS_VOICE_ID");
  return {
    provider: "elevenlabs",
    ready,
    allowed,
    configured: hasApiKey || hasVoiceId,
    missing,
    reason: ready
      ? "ElevenLabs explicitly selected for governed narration generation"
      : disabled
        ? "ElevenLabs fallback is disabled"
        : !allowed
          ? "external ElevenLabs generation requires --provider elevenlabs; local clone is default"
          : missing.length
          ? `missing ${missing.join(", ")}`
          : "not selected",
    secret_values_exposed: false,
  };
}

function selectTtsProvider({ localTts = {}, elevenlabs = {}, providerPreference = "auto" } = {}) {
  const preference = cleanText(providerPreference || "auto").toLowerCase();
  if (preference === "local") return localTts.ready ? "local" : null;
  if (preference === "elevenlabs") return elevenlabs.ready ? "elevenlabs" : null;
  if (localTts.ready) return "local";
  return null;
}

function statusForJob({
  audio,
  timestamps,
  localTts,
  selectedProvider,
  requiresAsrAlignment = false,
  requiresAsrCoverageRepair = false,
} = {}) {
  const requiresTimestampAsrRepair =
    requiresAsrCoverageRepair ||
    (requiresAsrAlignment && timestamps?.asr_aligned !== true) ||
    timestamps?.requires_asr_alignment === true ||
    (timestamps?.requires_asr_quality_repair === true && timestamps?.requires_audio_regeneration !== true);
  if (audio?.usable && timestamps?.exists && requiresTimestampAsrRepair) {
    return "requires_word_timestamp_asr_alignment";
  }
  if (audio?.usable && timestamps?.usable) {
    return "ready_audio_timestamp_pair";
  }
  if (selectedProvider) return "requires_audio_timestamp_generation";
  if (localTts.stale) return "blocked_local_tts_stale";
  if (localTts.unreachable) return "blocked_local_tts_unreachable";
  if (localTts.verdict === "red") return "blocked_local_tts_red";
  if (!localTts.ready && localTts.verdict === "unknown") return "blocked_local_tts_status_unknown";
  return "requires_audio_timestamp_generation";
}

function jobBlockers(job = {}) {
  return unique([
    ...asArray(job.blockers),
    ...asArray(job.render_input_blockers),
  ]);
}

function forceStaleAudioRegeneration(job = {}) {
  const blockers = jobBlockers(job);
  const publicCopyAudio = blockers.includes("final_narration_audio_stale_after_public_copy_repair");
  const publicCopyTimestamps = blockers.includes("word_timestamps_stale_after_public_copy_repair");
  const durationAudio = blockers.includes("final_narration_audio_stale_after_duration_variant_repair");
  const durationTimestamps = blockers.includes("word_timestamps_stale_after_duration_variant_repair");
  const pronunciationAudio = blockers.includes("final_narration_audio_stale_after_pronunciation_repair");
  const pronunciationTimestamps = blockers.includes("word_timestamps_stale_after_pronunciation_repair");
  return {
    audio: publicCopyAudio || durationAudio || pronunciationAudio,
    timestamps: publicCopyTimestamps || durationTimestamps || pronunciationTimestamps,
    audioReason: pronunciationAudio
      ? "stale_after_pronunciation_repair"
      : durationAudio
        ? "stale_after_duration_variant_repair"
        : publicCopyAudio
          ? "stale_after_public_copy_repair"
          : null,
    timestampsReason: pronunciationTimestamps
        ? "stale_after_pronunciation_repair"
        : durationTimestamps
          ? "stale_after_duration_variant_repair"
          : publicCopyTimestamps
            ? "stale_after_public_copy_repair"
            : null,
  };
}

function requiresWordTimestampAsrAlignment(job = {}) {
  return jobBlockers(job).includes("word_timestamps_not_asr_aligned");
}

function requiresWordTimestampAsrCoverageRepair(job = {}) {
  return jobBlockers(job).includes("word_timestamps_asr_coverage_incomplete");
}

function latestRepairEvent(...sources) {
  const events = [];
  for (const source of sources) {
    const publicCopyMs = timeMs(source?.public_copy_repaired_at);
    if (publicCopyMs != null) {
      events.push({
        ms: publicCopyMs,
        reason: "stale_after_public_copy_repair",
      });
    }
    const durationMs = timeMs(source?.duration_variant_repaired_at);
    if (durationMs != null) {
      events.push({
        ms: durationMs,
        reason: "stale_after_duration_variant_repair",
      });
    }
  }
  return events.sort((a, b) => b.ms - a.ms)[0] || null;
}

function staleAfterRepairEvent(candidate = {}, repairEvent = null) {
  return (
    repairEvent?.ms != null &&
    candidate.usable === true &&
    candidate.mtime_ms != null &&
    Number(candidate.mtime_ms) + 1000 < repairEvent.ms
  );
}

function nextActionsForStatus(status, selectedProvider = null) {
  if (status === "ready_audio_timestamp_pair") {
    return ["run_visual_v4_production_render"];
  }
  if (status === "requires_word_timestamp_asr_alignment") {
    return [
      "align_existing_local_voice_audio_with_local_whisper_word_timestamps",
      "rerun_goal_production_cutover_after_audio_materialisation",
    ];
  }
  if (selectedProvider === "elevenlabs") {
    return [
      "generate_elevenlabs_narration_with_word_timestamps",
      "rerun_goal_production_cutover_after_audio_materialisation",
    ];
  }
  if (status.startsWith("blocked_local_tts")) {
    return [
      "start_or_repair_local_tts_then_generate_narration_with_word_timestamps",
      "or_supply_approved_licensed_audio_and_matching_word_timestamps",
    ];
  }
  return [
    "generate_narration_audio_with_word_timestamps",
    "rerun_goal_production_cutover_after_audio_materialisation",
  ];
}

async function buildJobReport(job = {}, { workspaceRoot, localTts, elevenlabs, providerPreference } = {}) {
  const artifactDir = job.artifact_dir ? path.resolve(job.artifact_dir) : null;
  const audioManifest = await readJsonIfPresent(
    artifactDir ? path.join(artifactDir, "audio_manifest.json") : null,
    {},
  );
  const canonicalManifest = await readJsonIfPresent(
    artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : null,
    {},
  );
  const audioCandidates = buildAudioCandidates(job, audioManifest || {}, { workspaceRoot });
  const timestampCandidates = buildTimestampCandidates(job, audioManifest || {}, { workspaceRoot });
  const audioResult = await firstUsableAudio(audioCandidates);
  const timestampResult = await firstUsableTimestamp(timestampCandidates);
  const repairEvent = latestRepairEvent(job.evidence || {}, canonicalManifest || {}, audioManifest || {});
  const forcedStale = forceStaleAudioRegeneration(job);
  const requiresAsrAlignment = requiresWordTimestampAsrAlignment(job);
  const requiresAsrCoverageRepair = requiresWordTimestampAsrCoverageRepair(job);
  const asrFailure = buildAsrFailureSummary(timestampResult.selected);
  const timestampNeedsNarrationRegeneration = timestampResult.selected?.requires_audio_regeneration === true;
  const stale = {
    audio: forcedStale.audio || staleAfterRepairEvent(audioResult.selected, repairEvent),
    timestamps: forcedStale.timestamps || staleAfterRepairEvent(timestampResult.selected, repairEvent),
  };
  const audio = stale.audio
    ? { ...audioResult.selected, usable: false, reason: forcedStale.audioReason || repairEvent?.reason || "stale_after_repair" }
    : asrFailure
      ? { ...audioResult.selected, usable: false, reason: "asr_alignment_exhausted_regenerate_narration" }
    : timestampNeedsNarrationRegeneration
      ? { ...audioResult.selected, usable: false, reason: "asr_inserted_words_regenerate_narration" }
    : audioResult.selected;
  const timestamps = stale.timestamps
    ? { ...timestampResult.selected, usable: false, reason: forcedStale.timestampsReason || repairEvent?.reason || "stale_after_repair" }
    : asrFailure
      ? { ...timestampResult.selected, usable: false, reason: "asr_alignment_exhausted_regenerate_narration" }
    : timestampResult.selected;
  const selectedProvider = selectTtsProvider({ localTts, elevenlabs, providerPreference });
  const status = statusForJob({
    audio,
    timestamps,
    localTts,
    selectedProvider,
    requiresAsrAlignment,
    requiresAsrCoverageRepair,
  });
  const missing = [];
  if (status === "requires_word_timestamp_asr_alignment") {
    missing.push("word_timestamps_asr_alignment");
  } else {
    if (!audio.usable) missing.push("narration_audio");
    if (!timestamps.usable) missing.push("word_timestamps");
  }
  return {
    story_id: cleanText(job.story_id),
    title: cleanText(job.title),
    artifact_dir: artifactDir,
    status,
    missing,
    audio,
    timestamps,
    tts_provider: status === "requires_audio_timestamp_generation" ? selectedProvider : null,
    tts_provider_reason: selectedProvider === "elevenlabs" ? elevenlabs.reason : localTts.reason,
    candidate_counts: {
      audio: audioResult.inspected.length,
      timestamps: timestampResult.inspected.length,
    },
    ...(asrFailure ? { asr_failure: asrFailure } : {}),
    local_tts: localTts,
    next_actions: nextActionsForStatus(status, selectedProvider),
  };
}

function isAudioTimestampJob(job = {}) {
  return asArray(job.actions).some(actionNeedsAudio);
}

async function buildGoalAudioTimestampWorkbench({
  workOrder = {},
  workspaceRoot = process.cwd(),
  localTtsDoctorReport = {},
  ttsEnv = {},
  providerPreference = "auto",
  storyIds = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const root = path.resolve(workspaceRoot);
  const localTts = summariseLocalTtsDoctor(localTtsDoctorReport, { generatedAt });
  const elevenlabs = summariseElevenLabsTts(ttsEnv, { providerPreference });
  const requestedStoryIds = new Set(asArray(storyIds).map(cleanText).filter(Boolean));
  const allWorkOrderJobs = Array.isArray(workOrder) ? workOrder : asArray(workOrder.jobs);
  const workOrderJobs = requestedStoryIds.size > 0
    ? allWorkOrderJobs.filter((job) => requestedStoryIds.has(cleanText(job.story_id)))
    : allWorkOrderJobs;
  const jobs = [];
  for (const job of workOrderJobs) {
    jobs.push(await buildJobReport(job, {
      workspaceRoot: root,
      localTts,
      elevenlabs,
      providerPreference,
    }));
  }
  const ready = jobs.filter((job) => job.status === "ready_audio_timestamp_pair");
  const blockedLocalTts = jobs.filter((job) => job.status.startsWith("blocked_local_tts"));
  const requiresGeneration = jobs.filter((job) => job.status === "requires_audio_timestamp_generation");
  const requiresAsrAlignment = jobs.filter((job) => job.status === "requires_word_timestamp_asr_alignment");
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_AUDIO_TIMESTAMP_WORKBENCH",
    source_work_order_generated_at: Array.isArray(workOrder) ? null : workOrder.generated_at || null,
    summary: {
      story_count: jobs.length,
      ready_audio_timestamp_pair_count: ready.length,
      blocked_local_tts_count: blockedLocalTts.length,
      requires_generation_count: requiresGeneration.length,
      requires_asr_alignment_count: requiresAsrAlignment.length,
      elevenlabs_generation_count: requiresGeneration.filter((job) => job.tts_provider === "elevenlabs").length,
    },
    local_tts: localTts,
    elevenlabs_tts: elevenlabs,
    provider_preference: providerPreference,
    jobs,
    safety: {
      no_tts_generation_triggered: true,
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function renderGoalAudioTimestampWorkbenchMarkdown(report = {}) {
  const lines = [];
  lines.push("# Local Audio Timestamp Workbench");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Ready pairs: ${report.summary?.ready_audio_timestamp_pair_count || 0}`);
  lines.push(`Needs ASR alignment: ${report.summary?.requires_asr_alignment_count || 0}`);
  lines.push(`Blocked by local TTS: ${report.summary?.blocked_local_tts_count || 0}`);
  lines.push(`Needs generation: ${report.summary?.requires_generation_count || 0}`);
  lines.push("");
  lines.push("## Local TTS");
  lines.push(
    `- verdict: ${report.local_tts?.verdict || "unknown"}; failure: ${report.local_tts?.failure_code || "none"}`,
  );
  if (report.local_tts?.reason) lines.push(`- reason: ${report.local_tts.reason}`);
  lines.push("");
  lines.push("## ElevenLabs TTS");
  lines.push(
    `- ready: ${report.elevenlabs_tts?.ready === true ? "yes" : "no"}; configured: ${report.elevenlabs_tts?.configured === true ? "yes" : "no"}`,
  );
  if (report.elevenlabs_tts?.reason) lines.push(`- reason: ${report.elevenlabs_tts.reason}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 30)) {
    const missing = job.missing.length ? `; missing: ${job.missing.join(", ")}` : "";
    const provider = job.tts_provider ? `; provider: ${job.tts_provider}` : "";
    lines.push(`- ${job.story_id}: ${job.status}${provider}${missing}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: planning only. No TTS generation, publishing, database mutation, token change or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalAudioTimestampWorkbench(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalAudioTimestampWorkbench requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "audio_timestamp_workbench.json");
  const markdownPath = path.join(outDir, "audio_timestamp_workbench.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalAudioTimestampWorkbenchMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  buildGoalAudioTimestampWorkbench,
  renderGoalAudioTimestampWorkbenchMarkdown,
  writeGoalAudioTimestampWorkbench,
  summariseElevenLabsTts,
  summariseLocalTtsDoctor,
  selectTtsProvider,
};
