"use strict";

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

function firstTimeMs(values = []) {
  for (const value of asArray(values)) {
    const ms = timeMs(value);
    if (ms != null) return ms;
  }
  return null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function passLike(value) {
  return ["pass", "passed", "green", "ok"].includes(cleanText(value).toLowerCase());
}

function audioGeneratedAt(audioManifest = {}) {
  return firstTimeMs([
    audioManifest.materialized_at,
    audioManifest.materializedAt,
    audioManifest.audio_materialized_at,
    audioManifest.generated_at,
    audioManifest.generatedAt,
  ]);
}

function captionGeneratedAt(captionManifest = {}) {
  return firstTimeMs([
    captionManifest.generated_at,
    captionManifest.generatedAt,
    captionManifest.materialized_at,
  ]);
}

function voiceGeneratedAt(voiceQualityReport = {}) {
  return firstTimeMs([
    voiceQualityReport.generated_at,
    voiceQualityReport.generatedAt,
    voiceQualityReport.checked_at,
  ]);
}

function auditNarrationQaArtifacts({
  audioManifest = {},
  captionManifest = null,
  voiceQualityReport = null,
} = {}) {
  const blockers = [];
  const audioAt = audioGeneratedAt(audioManifest);
  const audioWordCount = positiveNumber(audioManifest.word_timestamp_count);
  let captionAt = null;

  if (!captionManifest || typeof captionManifest !== "object") {
    blockers.push("caption_manifest_missing");
  } else {
    captionAt = captionGeneratedAt(captionManifest);
    const captionWordCount = positiveNumber(captionManifest.word_count || captionManifest.word_timestamp_count);
    if (captionAt == null) blockers.push("caption_manifest_missing_generated_at");
    if (audioAt != null && captionAt != null && captionAt < audioAt) {
      blockers.push("caption_manifest_stale_after_audio");
    }
    if (audioWordCount != null && captionWordCount != null && captionWordCount !== audioWordCount) {
      blockers.push("caption_manifest_word_count_mismatch");
    }
  }

  if (!voiceQualityReport || typeof voiceQualityReport !== "object") {
    blockers.push("voice_quality_report_missing");
  } else {
    if (!passLike(voiceQualityReport.verdict || voiceQualityReport.status)) {
      blockers.push("voice_quality_report_not_pass");
    }
    const voiceAt = voiceGeneratedAt(voiceQualityReport);
    const voiceWordCount = positiveNumber(voiceQualityReport.word_timestamp_count);
    if (voiceAt == null) blockers.push("voice_quality_report_missing_generated_at");
    if (audioAt != null && voiceAt != null && voiceAt < audioAt) {
      blockers.push("voice_quality_report_stale_after_audio");
    }
    if (captionAt != null && voiceAt != null && voiceAt < captionAt) {
      blockers.push("voice_quality_report_stale_after_captions");
    }
    if (audioWordCount != null && voiceWordCount != null && voiceWordCount !== audioWordCount) {
      blockers.push("voice_quality_word_count_mismatch");
    }
  }

  return {
    status: blockers.length ? "blocked" : "fresh",
    blockers: Array.from(new Set(blockers)),
    evidence: {
      audio_generated_at: audioAt,
      caption_generated_at: captionAt,
      voice_quality_generated_at: voiceGeneratedAt(voiceQualityReport || {}),
      audio_word_count: audioWordCount,
      caption_word_count: captionManifest && typeof captionManifest === "object"
        ? positiveNumber(captionManifest.word_count || captionManifest.word_timestamp_count)
        : null,
      voice_quality_word_count: voiceQualityReport && typeof voiceQualityReport === "object"
        ? positiveNumber(voiceQualityReport.word_timestamp_count)
        : null,
    },
  };
}

module.exports = {
  auditNarrationQaArtifacts,
};
