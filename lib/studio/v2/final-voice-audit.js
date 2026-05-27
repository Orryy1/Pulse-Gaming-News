"use strict";

const path = require("node:path");

const {
  evaluateApprovedVoicePath,
} = require("./approved-voice-path");

function storyIdFromPath(mp4Path) {
  const base = path.basename(String(mp4Path || ""), path.extname(String(mp4Path || "")));
  return base.replace(/_teaser$/i, "");
}

function isTeaser(mp4Path) {
  return /_teaser\.mp4$/i.test(String(mp4Path || ""));
}

function extractNarrationEvidence(report = {}) {
  return (
    report.narration ||
    report.voice ||
    report.audio?.narration ||
    report.audio?.voice ||
    report.render?.narration ||
    report.render_manifest?.narration ||
    report.approved_voice_path?.narration ||
    report.audioMeta ||
    null
  );
}

function normaliseBlockers(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(numberOrNull).filter((number) => number !== null);
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function deriveNarrationWpm(narration = {}) {
  const explicit = numberOrNull(narration.wpm ?? narration.localPace?.wpm ?? narration.pace?.wpm);
  if (explicit !== null) return explicit;
  const durationSeconds = numberOrNull(
    narration.durationSeconds ??
      narration.duration_seconds ??
      narration.acoustic?.durationSeconds ??
      narration.acoustic?.duration_seconds ??
      narration.acoustic?.duration_s,
  );
  const words = countWords(narration.transcript || narration.text || "");
  if (!durationSeconds || words <= 0) return null;
  return Math.round((words / durationSeconds) * 60);
}

function voiceLoudnessWarnings({ approved = {}, narration = {}, env = process.env } = {}) {
  const warnings = [];
  const acoustic = approved.acoustic || {};
  const localVoice = approved.local_voice === true;
  const integratedLufs = numberOrNull(acoustic.integratedLufs);
  const truePeakDb = numberOrNull(acoustic.truePeakDb);
  const wpm = deriveNarrationWpm(narration);
  const maxLocalLufs = numberOrNull(env.STUDIO_FLASH_VOICE_MAX_LOCAL_LUFS) ?? -13.5;
  const maxGenericLufs = numberOrNull(env.STUDIO_FLASH_VOICE_MAX_LUFS) ?? -12;
  const maxSegmentJumpLu = numberOrNull(env.STUDIO_FLASH_VOICE_MAX_SEGMENT_JUMP_LU) ?? 5;
  const segmentLufs = numericArray(
    acoustic.segmentLufs ||
      acoustic.segment_lufs ||
      acoustic.segmentLoudnessLufs ||
      acoustic.segment_loudness_lufs ||
      narration.acoustic?.segmentLufs ||
      narration.acoustic?.segment_lufs ||
      narration.acoustic?.segmentLoudnessLufs ||
      narration.acoustic?.segment_loudness_lufs ||
      narration.segmentLufs ||
      narration.segment_lufs,
  );

  if (localVoice && integratedLufs === null) warnings.push("voice_loudness_unverified");
  else if (localVoice && integratedLufs !== null && integratedLufs > maxLocalLufs) warnings.push("voice_loudness_too_hot");
  else if (integratedLufs !== null && integratedLufs > maxGenericLufs) warnings.push("voice_loudness_too_hot");
  else if (integratedLufs !== null && integratedLufs < -18) warnings.push("voice_loudness_too_low");

  if (truePeakDb !== null && truePeakDb > -1) warnings.push("voice_true_peak_too_hot");
  if (
    segmentLufs.length >= 2 &&
    Math.max(...segmentLufs) - Math.min(...segmentLufs) > maxSegmentJumpLu
  ) {
    warnings.push("voice_segment_loudness_jump");
  }
  if (localVoice && wpm === null) warnings.push("voice_pace_unverified");

  return warnings;
}

function classifyFinalRenderVoice({
  mp4Path,
  report = null,
  env = process.env,
} = {}) {
  const storyId = storyIdFromPath(mp4Path);
  if (!mp4Path) {
    return {
      story_id: null,
      mp4_path: null,
      verdict: "reject",
      blockers: ["mp4_path_missing"],
      warnings: [],
      do_not_reuse_for_tiktok_dispatch: true,
    };
  }

  if (isTeaser(mp4Path)) {
    return {
      story_id: storyId,
      mp4_path: mp4Path,
      verdict: "skip",
      blockers: [],
      warnings: ["teaser_render_not_a_full_short"],
      do_not_reuse_for_tiktok_dispatch: true,
    };
  }

  const narration = extractNarrationEvidence(report || {});
  if (!narration) {
    return {
      story_id: storyId,
      mp4_path: mp4Path,
      verdict: "review",
      blockers: ["approved_voice_metadata_missing"],
      warnings: [],
      do_not_reuse_for_tiktok_dispatch: true,
      voice_path: null,
    };
  }

  const approved = evaluateApprovedVoicePath({
    narration,
    env,
    requireExistingAudio: false,
  });
  const blockers = normaliseBlockers(approved.blockers);
  const warnings = normaliseBlockers([
    ...(approved.warnings || []),
    ...voiceLoudnessWarnings({ approved, narration, env }),
  ]);
  const verdict =
    blockers.length > 0
      ? "reject"
      : warnings.length > 0
        ? "review"
        : "pass";

  return {
    story_id: storyId,
    mp4_path: mp4Path,
    verdict,
    blockers,
    warnings,
    do_not_reuse_for_tiktok_dispatch: verdict !== "pass",
    voice_path: {
      provider: approved.provider,
      source: approved.source,
      audio_path: approved.audio_path,
      local_voice: approved.local_voice,
      acoustic: approved.acoustic,
      transcript: approved.transcript,
      wpm: deriveNarrationWpm(narration),
    },
  };
}

function buildFinalVoiceAudit({
  files = [],
  reportsByStoryId = {},
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = (Array.isArray(files) ? files : []).map((file) => {
    const storyId = storyIdFromPath(file);
    return classifyFinalRenderVoice({
      mp4Path: file,
      report: reportsByStoryId[storyId] || null,
      env,
    });
  });
  const counts = {
    pass: rows.filter((row) => row.verdict === "pass").length,
    review: rows.filter((row) => row.verdict === "review").length,
    reject: rows.filter((row) => row.verdict === "reject").length,
    skip: rows.filter((row) => row.verdict === "skip").length,
  };
  return {
    schema_version: 1,
    generated_at: generatedAt,
    verdict: counts.reject > 0 ? "RED" : counts.review > 0 ? "AMBER" : "GREEN",
    counts,
    rows,
    safety: {
      read_only: true,
      mutates_media: false,
      mutates_production_db: false,
      mutates_tokens: false,
      posts_to_platforms: false,
    },
  };
}

function renderFinalVoiceAuditMarkdown(report) {
  const lines = [];
  lines.push("# Final Voice Audit");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(
    `Counts: pass=${report.counts.pass} review=${report.counts.review} reject=${report.counts.reject} skip=${report.counts.skip}`,
  );
  lines.push("");
  lines.push("## Rows");
  if (!report.rows.length) {
    lines.push("- none");
  } else {
    for (const row of report.rows) {
      const pitch = numberOrNull(row.voice_path?.acoustic?.medianPitchHz);
      const lufs = numberOrNull(row.voice_path?.acoustic?.integratedLufs);
      const truePeak = numberOrNull(row.voice_path?.acoustic?.truePeakDb);
      const outro = row.voice_path?.transcript?.spoken_outro_present;
      const wpm = numberOrNull(row.voice_path?.wpm);
      const evidence = [
        `pitch=${pitch === null ? "unknown" : `${pitch}Hz`}`,
        `lufs=${lufs === null ? "unknown" : lufs}`,
        `tp=${truePeak === null ? "unknown" : `${truePeak}dBTP`}`,
        `outro=${outro === null || outro === undefined ? "unknown" : outro}`,
        `wpm=${wpm === null ? "unknown" : wpm}`,
      ].join(" ");
      lines.push(
        `- ${row.story_id || "unknown"}: ${row.verdict} blockers=${row.blockers.join(", ") || "clear"} warnings=${row.warnings.join(", ") || "none"} ${evidence} reuse_for_tiktok=${!row.do_not_reuse_for_tiktok_dispatch}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- read-only audit");
  lines.push("- no media deletion");
  lines.push("- no production DB, OAuth, token or platform posting changes");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildFinalVoiceAudit,
  classifyFinalRenderVoice,
  extractNarrationEvidence,
  renderFinalVoiceAuditMarkdown,
  storyIdFromPath,
};
