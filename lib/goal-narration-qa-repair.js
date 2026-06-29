"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const mediaPaths = require("./media-paths");
const { analyseNarrationCadence } = require("./narration-cadence-qa");
const { auditNarrationQaArtifacts } = require("./narration-qa-artifact");
const {
  hasMalformedGtaViSpokenStutter,
  hasRiskyGtaViOpening,
  hasSplitGtaViRomanNarration,
} = require("./studio/v2/approved-voice-path");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function gtaViSpokenPronunciationAudit(transcript = "") {
  const text = clean(transcript);
  const present = Boolean(text);
  const audit = {
    present,
    gta_vi_spoken_stutter: present ? hasMalformedGtaViSpokenStutter(text) : null,
    gta_vi_spoken_roman_split: present ? hasSplitGtaViRomanNarration(text) : null,
    gta_vi_opening_spoken_six_risk: present ? hasRiskyGtaViOpening(text) : null,
  };
  const blockers = [];
  if (audit.gta_vi_spoken_stutter) blockers.push("gta_vi_spoken_stutter");
  if (audit.gta_vi_spoken_roman_split) blockers.push("gta_vi_spoken_roman_split");
  if (audit.gta_vi_opening_spoken_six_risk) blockers.push("gta_vi_opening_spoken_six_risk");
  return { audit, blockers };
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function firstClean(values = []) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function timestampWordCount(timestampPayload = {}) {
  const words = asArray(timestampPayload.words || timestampPayload.word_timestamps);
  return words.filter((word) => clean(word.word || word.text)).length;
}

function segmentedLocalTtsEvidence(timestampPayload = {}) {
  const meta = timestampPayload && typeof timestampPayload.meta === "object" ? timestampPayload.meta : {};
  const segmented = meta.segmentedLocalTtsMaterialized === true;
  const segmentCount = positiveNumber(meta.local_tts_segment_count) ||
    positiveNumber(meta.tts_segment_count) ||
    positiveNumber(meta.segment_count);
  if (!segmented && !segmentCount) return {};
  const continuityVerified = Boolean(
    meta.local_tts_segment_voice_continuity_verified === true ||
      meta.segment_voice_continuity_verified === true ||
      meta.voiceContinuity?.verified === true ||
      (segmented && segmentCount > 1 && meta.voiceMetadataRepair?.repaired === true),
  );
  return {
    segmentedLocalTtsMaterialized: segmented || segmentCount > 1,
    local_tts_segment_count: segmentCount || null,
    tts_segment_count: segmentCount || null,
    segment_count: segmentCount || null,
    segment_word_counts: asArray(meta.segment_word_counts),
    segment_gap_s: positiveNumber(meta.segment_gap_s) || null,
    local_tts_segment_voice_continuity_verified: continuityVerified,
    segment_voice_continuity_verified: continuityVerified,
    voice_metadata_repair: meta.voiceMetadataRepair || null,
    acceptedLocalVoice: meta.acceptedLocalVoice || null,
  };
}

function audioEvidenceManifest(audioManifest = {}, narrationManifest = {}, captionManifest = {}) {
  const wordCount = positiveNumber(audioManifest.word_timestamp_count) ||
    positiveNumber(narrationManifest.word_timestamp_count) ||
    positiveNumber(captionManifest?.word_count) ||
    positiveNumber(captionManifest?.word_timestamp_count);
  const narrationAudioPath = firstClean([
    audioManifest.narration_audio_path,
    audioManifest.audio_path,
    narrationManifest.narration_audio_path,
    narrationManifest.audio_path,
    narrationManifest.final_audio_path,
  ]);
  const resolvedNarrationAudioPath = firstClean([
    audioManifest.resolved_narration_audio_path,
    audioManifest.resolved_audio_path,
    narrationManifest.resolved_narration_audio_path,
    narrationManifest.resolved_audio_path,
    narrationManifest.resolved_final_audio_path,
  ]);
  const wordTimestampsPath = firstClean([
    audioManifest.word_timestamps_path,
    audioManifest.timestamps_path,
    narrationManifest.word_timestamps_path,
    narrationManifest.timestamps_path,
    captionManifest?.word_timestamps_path,
  ]);
  const resolvedWordTimestampsPath = firstClean([
    audioManifest.resolved_word_timestamps_path,
    audioManifest.resolved_timestamps_path,
    narrationManifest.resolved_word_timestamps_path,
    narrationManifest.resolved_timestamps_path,
    captionManifest?.resolved_word_timestamps_path,
    path.isAbsolute(wordTimestampsPath) ? wordTimestampsPath : "",
  ]);
  return {
    ...audioManifest,
    story_id: audioManifest.story_id || narrationManifest.story_id || captionManifest?.story_id,
    voice_status: audioManifest.voice_status || (narrationManifest.status === "ready" ? "materialized" : narrationManifest.status),
    narration_audio_path: narrationAudioPath || null,
    audio_path: firstClean([audioManifest.audio_path, narrationManifest.audio_path, narrationManifest.final_audio_path, narrationAudioPath]) || null,
    resolved_narration_audio_path: resolvedNarrationAudioPath || null,
    word_timestamps_path: wordTimestampsPath || null,
    timestamps_path: firstClean([audioManifest.timestamps_path, wordTimestampsPath]) || null,
    resolved_word_timestamps_path: resolvedWordTimestampsPath || null,
    word_timestamp_count: wordCount || audioManifest.word_timestamp_count,
    materialized_at: firstClean([
      audioManifest.materialized_at,
      audioManifest.audio_materialized_at,
      audioManifest.generated_at,
      narrationManifest.materialized_at,
      narrationManifest.generated_at,
    ]) || audioManifest.materialized_at,
    generated_at: firstClean([audioManifest.generated_at, narrationManifest.generated_at]) || audioManifest.generated_at,
  };
}

function currentCaptionWordCount(existingCaptionManifest = {}, audioWordCount = 0) {
  const alignedWordCount = positiveNumber(existingCaptionManifest.timestamp_whisper_alignment?.word_count);
  if (audioWordCount && alignedWordCount === audioWordCount) return audioWordCount;
  return positiveNumber(
    existingCaptionManifest.word_count ||
      existingCaptionManifest.word_timestamp_count ||
      existingCaptionManifest.caption_word_count,
  ) || audioWordCount;
}

async function resolveExistingArtifactOrMediaPath(artifactDir = "", relOrAbs = "") {
  const text = clean(relOrAbs);
  if (!text) return null;
  if (path.isAbsolute(text) && await fs.pathExists(text)) return text;
  const artifactPath = artifactDir ? path.resolve(artifactDir, text) : "";
  if (artifactPath && await fs.pathExists(artifactPath)) return artifactPath;
  return mediaPaths.resolveExisting(text);
}

async function fileSize(filePath = "") {
  try {
    if (!filePath || !(await fs.pathExists(filePath))) return 0;
    return (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function captionCueCount(filePath = "") {
  try {
    if (!filePath || !(await fs.pathExists(filePath))) return 0;
    const text = await fs.readFile(filePath, "utf8");
    return (text.match(/\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/g) || []).length;
  } catch {
    return 0;
  }
}

function transcriptFrom(canonical = {}, narrationManifest = {}, audioManifest = {}, captionManifest = {}) {
  return clean(
    audioManifest.timestamp_whisper_alignment?.transcript ||
      audioManifest.timestampWhisperAlignment?.transcript ||
      captionManifest.transcript ||
      captionManifest.timestamp_whisper_alignment?.transcript ||
      narrationManifest.transcript ||
      canonical.narration_script ||
      canonical.tts_script ||
      canonical.full_script ||
      canonical.first_spoken_line,
  );
}

async function buildCurrentNarrationManifest({
  artifactDir = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const audioManifest = await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {});
  const existingNarrationManifest = await readJsonIfPresent(path.join(artifactDir, "narration_manifest.json"), {});
  const effectiveAudioManifest = audioEvidenceManifest(audioManifest, existingNarrationManifest);
  const audioPathRef = clean(
    effectiveAudioManifest.narration_audio_path ||
      effectiveAudioManifest.audio_path,
  );
  const timestampPathRef = clean(
    effectiveAudioManifest.word_timestamps_path ||
      effectiveAudioManifest.timestamps_path,
  );
  const resolvedAudioPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    effectiveAudioManifest.resolved_narration_audio_path || audioPathRef,
  );
  const resolvedTimestampPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    effectiveAudioManifest.resolved_word_timestamps_path || timestampPathRef,
  );
  const audioBytes = await fileSize(resolvedAudioPath);
  const timestampBytes = await fileSize(resolvedTimestampPath);
  const transcript = clean(
    existingNarrationManifest.transcript ||
      existingNarrationManifest.final_transcript ||
      audioManifest.timestamp_whisper_alignment?.transcript ||
      audioManifest.transcript ||
      canonical.narration_script ||
      canonical.tts_script ||
      canonical.full_script ||
      canonical.first_spoken_line,
  );
  const wordCount = positiveNumber(effectiveAudioManifest.word_timestamp_count) ||
    transcript.split(/\s+/).filter(Boolean).length;
  const checks = {
    narration_audio_present: audioBytes > 0,
    narration_audio_usable: audioBytes >= 1000,
    transcript_available: transcript.split(/\s+/).filter(Boolean).length >= 3,
    word_timestamps_present: timestampBytes > 0 || wordCount > 0,
  };
  const blockers = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => `narration_manifest_check_failed:${name}`);
  const manifest = {
    schema_version: 1,
    story_id: canonical.story_id || effectiveAudioManifest.story_id || path.basename(artifactDir),
    generated_at: generatedAt,
    status: blockers.length ? "blocked" : "ready",
    provider: audioManifest.voice_provider || existingNarrationManifest.provider || existingNarrationManifest.voice_provider || "unknown",
    audio_path: audioPathRef || null,
    resolved_audio_path: resolvedAudioPath || null,
    transcript,
    final_transcript: transcript,
    word_timestamps_path: timestampPathRef || null,
    resolved_word_timestamps_path: resolvedTimestampPath || null,
    word_timestamp_count: wordCount,
    word_timestamp_source: audioManifest.word_timestamp_source || existingNarrationManifest.word_timestamp_source || null,
    source: "current_audio_manifest_and_canonical_story",
    checks,
    blockers,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      media_mutated: false,
    },
  };
  return { narrationManifest: manifest };
}

async function buildCurrentCaptionManifest({
  artifactDir = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const audioManifest = await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {});
  const narrationManifest = await readJsonIfPresent(path.join(artifactDir, "narration_manifest.json"), {});
  const existingCaptionManifest = await readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), {});
  const effectiveAudioManifest = audioEvidenceManifest(audioManifest, narrationManifest, existingCaptionManifest);
  const captionPathRef = clean(
    existingCaptionManifest.caption_srt_path ||
      existingCaptionManifest.captions_path ||
      audioManifest.caption_srt_path ||
      "captions.srt",
  );
  const resolvedCaptionPath = await resolveExistingArtifactOrMediaPath(artifactDir, captionPathRef);
  const captionBytes = await fileSize(resolvedCaptionPath);
  const cueCount = await captionCueCount(resolvedCaptionPath);
  const audioWordCount = positiveNumber(effectiveAudioManifest.word_timestamp_count);
  const captionWordCount = currentCaptionWordCount(existingCaptionManifest, audioWordCount);
  const checks = {
    caption_file_present: captionBytes > 0,
    captions_well_formed: cueCount > 0,
    caption_word_count_available: captionWordCount > 0,
  };
  const blockers = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => `caption_manifest_check_failed:${name}`);
  const manifest = {
    ...existingCaptionManifest,
    schema_version: 1,
    story_id: canonical.story_id || effectiveAudioManifest.story_id || path.basename(artifactDir),
    generated_at: generatedAt,
    status: blockers.length ? "blocked" : "ready",
    caption_srt_path: captionPathRef || null,
    resolved_caption_srt_path: resolvedCaptionPath || null,
    word_timestamps_path: clean(existingCaptionManifest.word_timestamps_path || effectiveAudioManifest.word_timestamps_path) || null,
    word_count: captionWordCount,
    word_timestamp_count: captionWordCount,
    caption_chunk_count: cueCount,
    repair_source: "current_caption_file_and_audio_manifest",
    checks,
    blockers,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      media_mutated: false,
    },
  };
  return { captionManifest: manifest };
}

async function buildCurrentVoiceQualityReport({
  artifactDir = "",
  generatedAt = new Date().toISOString(),
  captionManifestOverride = null,
} = {}) {
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const audioManifest = await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {});
  const captionManifest = captionManifestOverride ||
    await readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), null);
  const narrationManifest = await readJsonIfPresent(path.join(artifactDir, "narration_manifest.json"), {});
  const effectiveAudioManifest = audioEvidenceManifest(audioManifest, narrationManifest, captionManifest);
  const audioPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    effectiveAudioManifest.resolved_narration_audio_path ||
      effectiveAudioManifest.narration_audio_path ||
      effectiveAudioManifest.audio_path,
  );
  const timestampPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    effectiveAudioManifest.resolved_word_timestamps_path ||
      effectiveAudioManifest.word_timestamps_path ||
      effectiveAudioManifest.timestamps_path,
  );
  const captionPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    captionManifest?.caption_srt_path || "captions.srt",
  );
  const audioBytes = await fileSize(audioPath);
  const transcript = transcriptFrom(canonical, narrationManifest, audioManifest, captionManifest || {});
  const timestampPayload = await readJsonIfPresent(timestampPath, {});
  const wordCount = positiveNumber(effectiveAudioManifest.word_timestamp_count) ||
    timestampWordCount(timestampPayload);
  const segmentEvidence = segmentedLocalTtsEvidence(timestampPayload);
  effectiveAudioManifest.word_timestamp_count = wordCount || effectiveAudioManifest.word_timestamp_count;
  const chunks = await captionCueCount(captionPath);
  const cadence = await analyseNarrationCadence({
    audioManifest: effectiveAudioManifest,
    narrationManifest,
    timestampPayload,
    transcript,
    audioPath,
    generatedAt,
  });
  const pronunciationAudit = gtaViSpokenPronunciationAudit(transcript);
  const draft = {
    story_id: canonical.story_id || effectiveAudioManifest.story_id || path.basename(artifactDir),
    generated_at: generatedAt,
    verdict: "PASS",
    checks: {
      narration_audio_present: audioBytes > 0,
      narration_audio_usable: audioBytes >= 1000,
      word_timestamps_present: wordCount > 0,
      captions_well_formed: chunks > 0,
      transcript_available: transcript.length > 0,
    },
    warnings: [],
    audio_size_bytes: audioBytes,
    word_timestamp_count: wordCount,
    caption_chunk_count: chunks,
    cadence,
    transcript: {
      ...pronunciationAudit.audit,
    },
    ...segmentEvidence,
    repair_source: "current_audio_caption_manifest_and_files",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      media_mutated: false,
    },
  };
  const failedChecks = Object.entries(draft.checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => `voice_quality_check_failed:${name}`);
  const audit = auditNarrationQaArtifacts({
    audioManifest: effectiveAudioManifest,
    captionManifest,
    voiceQualityReport: draft,
  });
  const blockers = Array.from(new Set([...failedChecks, ...asArray(cadence.blockers), ...asArray(audit.blockers)]));
  blockers.push(...pronunciationAudit.blockers.filter((blocker) => !blockers.includes(blocker)));
  draft.verdict = blockers.length ? "FAIL" : "PASS";
  draft.blockers = blockers;
  draft.warnings = Array.from(new Set([...asArray(draft.warnings), ...asArray(cadence.warnings)]));
  return {
    voiceQualityReport: draft,
    audit,
    audioManifest: effectiveAudioManifest,
    captionManifest,
  };
}

function repairTargetsFromDryRunPlan(plan = {}) {
  const rows = [
    ...asArray(plan.blocked_stories),
    ...asArray(plan.held_stories),
  ];
  return rows
    .filter((row) =>
      asArray(row.blockers).some((blocker) =>
        /^(voice_quality_report|voice_quality_|caption_manifest|narration_manifest|incident:narration_missing)/.test(clean(blocker)),
      ),
    )
    .map((row) => ({
      story_id: clean(row.story_id),
      artifact_dir: clean(row.artifact_dir),
      blockers: asArray(row.blockers).map(clean).filter(Boolean),
    }))
    .filter((row) => row.story_id && row.artifact_dir);
}

function bridgeCandidateRows(value = {}) {
  if (Array.isArray(value)) return value;
  return [
    ...asArray(value.scheduler_bridge_candidates),
    ...asArray(value.bridge_candidates),
    ...asArray(value.candidates),
    ...asArray(value.stories),
  ];
}

function repairTargetsFromBridgeCandidates(bridgeCandidates = {}) {
  return bridgeCandidateRows(bridgeCandidates)
    .map((row) => ({
      story_id: clean(row.story_id || row.id),
      artifact_dir: clean(
        row.artifact_dir ||
          row.artifactDir ||
          row.scheduler_bridge_artifact_dir ||
          row.output_dir ||
          row.package_dir,
      ),
      blockers: asArray(row.blockers).map(clean).filter(Boolean),
      source: "scheduler_bridge_candidate",
    }))
    .filter((row) => row.story_id && row.artifact_dir);
}

function dedupeTargets(targets = []) {
  const seen = new Set();
  const deduped = [];
  for (const target of targets) {
    const key = `${target.story_id}\n${path.resolve(target.artifact_dir)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

async function repairNarrationQaArtifacts({
  dryRunPlan = {},
  bridgeCandidates = {},
  includeBridgeCandidates = false,
  generatedAt = new Date().toISOString(),
  apply = false,
} = {}) {
  const targets = dedupeTargets([
    ...repairTargetsFromDryRunPlan(dryRunPlan),
    ...(includeBridgeCandidates ? repairTargetsFromBridgeCandidates(bridgeCandidates) : []),
  ]);
  const rows = [];
  for (const target of targets) {
    const narration = await buildCurrentNarrationManifest({
      artifactDir: target.artifact_dir,
      generatedAt,
    });
    const caption = await buildCurrentCaptionManifest({
      artifactDir: target.artifact_dir,
      generatedAt,
    });
    const built = await buildCurrentVoiceQualityReport({
      artifactDir: target.artifact_dir,
      generatedAt,
      captionManifestOverride: caption.captionManifest,
    });
    const narrationOutPath = path.join(target.artifact_dir, "narration_manifest.json");
    const captionOutPath = path.join(target.artifact_dir, "caption_manifest.json");
    const outPath = path.join(target.artifact_dir, "voice_quality_report.json");
    if (apply) {
      await fs.writeJson(narrationOutPath, narration.narrationManifest, { spaces: 2 });
      await fs.writeJson(captionOutPath, caption.captionManifest, { spaces: 2 });
      await fs.writeJson(outPath, built.voiceQualityReport, { spaces: 2 });
    }
    const afterAudit = auditNarrationQaArtifacts({
      audioManifest: built.audioManifest,
      captionManifest: built.captionManifest,
      voiceQualityReport: built.voiceQualityReport,
    });
    rows.push({
      story_id: target.story_id,
      artifact_dir: target.artifact_dir,
      output_path: outPath,
      narration_manifest_output_path: narrationOutPath,
      caption_manifest_output_path: captionOutPath,
      previous_blockers: target.blockers,
      narration_manifest_result: narration.narrationManifest.status,
      narration_manifest_blockers: narration.narrationManifest.blockers,
      caption_manifest_result: caption.captionManifest.status,
      caption_manifest_blockers: caption.captionManifest.blockers,
      repaired_report_result: built.voiceQualityReport.verdict,
      repaired_report_blockers: built.voiceQualityReport.blockers,
      repaired_report_warnings: built.voiceQualityReport.warnings,
      cadence: built.voiceQualityReport.cadence,
      freshness_after_repair: afterAudit.status,
      remaining_blockers: afterAudit.blockers,
      written: apply === true,
      narration_manifest_written: apply === true,
      caption_manifest_written: apply === true,
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "apply_file_repair" : "dry_run_no_file_write",
    summary: {
      target_count: targets.length,
      written_count: apply ? rows.length : 0,
      narration_manifest_written_count: apply ? rows.filter((row) => row.narration_manifest_written).length : 0,
      caption_manifest_written_count: apply ? rows.filter((row) => row.caption_manifest_written).length : 0,
      freshness_pass_count: rows.filter((row) => row.freshness_after_repair === "fresh").length,
      remaining_blocked_count: rows.filter((row) => row.remaining_blockers.length > 0).length,
    },
    rows,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      media_mutated: false,
    },
  };
}

module.exports = {
  buildCurrentCaptionManifest,
  buildCurrentNarrationManifest,
  buildCurrentVoiceQualityReport,
  repairNarrationQaArtifacts,
  repairTargetsFromBridgeCandidates,
  repairTargetsFromDryRunPlan,
};
