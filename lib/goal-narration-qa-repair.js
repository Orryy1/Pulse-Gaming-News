"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const mediaPaths = require("./media-paths");
const { auditNarrationQaArtifacts } = require("./narration-qa-artifact");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function transcriptFrom(canonical = {}, narrationManifest = {}) {
  return clean(
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
  const audioPathRef = clean(
    existingNarrationManifest.audio_path ||
      existingNarrationManifest.final_audio_path ||
      existingNarrationManifest.narration_audio_path ||
      audioManifest.narration_audio_path ||
      audioManifest.audio_path,
  );
  const timestampPathRef = clean(
    existingNarrationManifest.word_timestamps_path ||
      audioManifest.word_timestamps_path ||
      audioManifest.timestamps_path,
  );
  const resolvedAudioPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    audioManifest.resolved_narration_audio_path || existingNarrationManifest.resolved_audio_path || audioPathRef,
  );
  const resolvedTimestampPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    audioManifest.resolved_word_timestamps_path ||
      existingNarrationManifest.resolved_word_timestamps_path ||
      timestampPathRef,
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
  const wordCount = positiveNumber(audioManifest.word_timestamp_count) ||
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
    story_id: canonical.story_id || audioManifest.story_id || path.basename(artifactDir),
    generated_at: generatedAt,
    status: blockers.length ? "blocked" : "ready",
    provider: audioManifest.voice_provider || existingNarrationManifest.provider || "unknown",
    audio_path: audioPathRef || null,
    resolved_audio_path: resolvedAudioPath || null,
    transcript,
    final_transcript: transcript,
    word_timestamps_path: timestampPathRef || null,
    resolved_word_timestamps_path: resolvedTimestampPath || null,
    word_timestamp_count: wordCount,
    word_timestamp_source: audioManifest.word_timestamp_source || null,
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

async function buildCurrentVoiceQualityReport({
  artifactDir = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const audioManifest = await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {});
  const captionManifest = await readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), null);
  const narrationManifest = await readJsonIfPresent(path.join(artifactDir, "narration_manifest.json"), {});
  const audioPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    audioManifest.resolved_narration_audio_path ||
      narrationManifest.audio_path ||
      audioManifest.narration_audio_path,
  );
  const captionPath = await resolveExistingArtifactOrMediaPath(
    artifactDir,
    captionManifest?.caption_srt_path || "captions.srt",
  );
  const audioBytes = await fileSize(audioPath);
  const wordCount = positiveNumber(audioManifest.word_timestamp_count);
  const chunks = await captionCueCount(captionPath);
  const transcript = transcriptFrom(canonical, narrationManifest);
  const draft = {
    story_id: canonical.story_id || audioManifest.story_id || path.basename(artifactDir),
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
    audioManifest,
    captionManifest,
    voiceQualityReport: draft,
  });
  const blockers = Array.from(new Set([...failedChecks, ...asArray(audit.blockers)]));
  draft.verdict = blockers.length ? "FAIL" : "PASS";
  draft.blockers = blockers;
  return {
    voiceQualityReport: draft,
    audit,
    audioManifest,
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

async function repairNarrationQaArtifacts({
  dryRunPlan = {},
  generatedAt = new Date().toISOString(),
  apply = false,
} = {}) {
  const targets = repairTargetsFromDryRunPlan(dryRunPlan);
  const rows = [];
  for (const target of targets) {
    const narration = await buildCurrentNarrationManifest({
      artifactDir: target.artifact_dir,
      generatedAt,
    });
    const built = await buildCurrentVoiceQualityReport({
      artifactDir: target.artifact_dir,
      generatedAt,
    });
    const narrationOutPath = path.join(target.artifact_dir, "narration_manifest.json");
    const outPath = path.join(target.artifact_dir, "voice_quality_report.json");
    if (apply) {
      await fs.writeJson(narrationOutPath, narration.narrationManifest, { spaces: 2 });
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
      previous_blockers: target.blockers,
      narration_manifest_result: narration.narrationManifest.status,
      narration_manifest_blockers: narration.narrationManifest.blockers,
      repaired_report_result: built.voiceQualityReport.verdict,
      freshness_after_repair: afterAudit.status,
      remaining_blockers: afterAudit.blockers,
      written: apply === true,
      narration_manifest_written: apply === true,
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
  buildCurrentNarrationManifest,
  buildCurrentVoiceQualityReport,
  repairNarrationQaArtifacts,
  repairTargetsFromDryRunPlan,
};
