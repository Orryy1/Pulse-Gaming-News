"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const mediaPaths = require("../../media-paths");
const { storyIdFromPath } = require("./final-voice-audit");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_OUTPUT_DIRS = [path.join(ROOT, "test", "output")];

async function safeReadJson(file) {
  try {
    if (await fs.pathExists(file)) return await fs.readJson(file);
  } catch (_) {
    return null;
  }
  return null;
}

function jsonCandidatePaths(candidate, baseDir) {
  if (!candidate) return [];
  const attempts = [];
  const value = String(candidate);
  if (path.isAbsolute(value)) attempts.push(value);
  else {
    if (baseDir) attempts.push(path.resolve(baseDir, value));
    attempts.push(path.resolve(value));
  }
  if (typeof mediaPaths._resolutionCandidates === "function") {
    attempts.push(...mediaPaths._resolutionCandidates(value));
  }
  return [...new Set(attempts)];
}

async function readJsonCandidates(candidate, baseDir, fsImpl = fs) {
  const results = [];
  const attempts = jsonCandidatePaths(candidate, baseDir);
  for (const attempt of [...new Set(attempts)]) {
    try {
      if (await fsImpl.pathExists(attempt)) {
        results.push({ json: await fsImpl.readJson(attempt), path: attempt });
      }
    } catch (_) {
      // Try the next candidate.
    }
  }
  return results;
}

async function readJsonCandidate(candidate, baseDir, fsImpl = fs) {
  const results = await readJsonCandidates(candidate, baseDir, fsImpl);
  if (results.length) return results[0];
  return { json: null, path: null };
}

function directReportCandidates(id, dirs) {
  const names = [
    `${id}.voice.json`,
    `${id}.render_manifest.json`,
    `${id}.json`,
    `${id}_studio_v2_report.json`,
    `${id}_qa.json`,
  ];
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

function looksLikeReportForStory(id, fileName) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}.*(?:voice|render_manifest|studio_v2_report|qa|report)\\.json$`, "i").test(
    fileName,
  );
}

function audioTimestampCandidates(id, mp4Path) {
  const names = [`${id}_timestamps.json`, `${id}.timestamps.json`];
  const candidates = [];
  const finalDir = path.dirname(String(mp4Path || ""));
  const outputDir = path.basename(finalDir).toLowerCase() === "final"
    ? path.dirname(finalDir)
    : null;
  if (outputDir) {
    candidates.push(...names.map((name) => path.join(outputDir, "audio", name)));
  }
  candidates.push(...names.map((name) => path.join("output", "audio", name)));
  return [...new Set(candidates)];
}

function textFromTimestampPayload(payload = {}) {
  const meta = payload.meta || {};
  if (typeof meta.transcript === "string" && meta.transcript.trim()) {
    return meta.transcript.trim();
  }
  if (typeof meta.text === "string" && meta.text.trim()) {
    return meta.text.trim();
  }
  if (Array.isArray(payload.characters)) {
    return payload.characters.join("").replace(/\s+/g, " ").trim();
  }
  return "";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function timestampWordsFromPayload(payload = {}) {
  const candidates = [
    payload.alignment?.words,
    payload.words,
    payload.word_timestamps,
    payload.wordTimestamps,
    payload.timestamps?.words,
  ];
  return candidates.find((items) => Array.isArray(items) && items.length) || [];
}

function wordTimelineDurationSeconds(payload = {}) {
  const words = timestampWordsFromPayload(payload);
  const spans = words
    .map((word) => ({
      start: numberOrNull(word.start ?? word.start_s ?? word.startSeconds),
      end: numberOrNull(word.end ?? word.end_s ?? word.endSeconds),
    }))
    .filter((span) => span.start !== null && span.end !== null && span.end > span.start)
    .sort((left, right) => left.start - right.start);
  if (!spans.length) return null;
  const duration = spans[spans.length - 1].end - spans[0].start;
  return duration > 0 ? Math.round(duration * 1000) / 1000 : null;
}

function deriveWpmFromDuration({ transcript, wordCount, durationSeconds } = {}) {
  const duration = numberOrNull(durationSeconds);
  const words = countWords(transcript) || numberOrNull(wordCount) || 0;
  if (!duration || words <= 0) return null;
  return Math.round((words / duration) * 60);
}

function acousticFromTimestampMeta(meta = {}) {
  if (meta.acoustic && typeof meta.acoustic === "object") return meta.acoustic;
  const diagnostics = meta.voiceDiagnostics || meta.voice_diagnostics || {};
  if (diagnostics.acoustic && typeof diagnostics.acoustic === "object") {
    return diagnostics.acoustic;
  }
  if (diagnostics.metrics && typeof diagnostics.metrics === "object") {
    return diagnostics.metrics;
  }
  return null;
}

function reportFromTimestampPayload(payload = {}, timestampPath = null) {
  const meta = payload.meta || {};
  if (!meta || typeof meta !== "object") return null;
  const audioPath = String(timestampPath || "").replace(/_timestamps\.json$/i, ".mp3").replace(/\.timestamps\.json$/i, ".mp3");
  const provider = String(meta.provider || "").trim();
  const source = String(meta.source || "").trim();
  if (!provider || !source) return null;
  const transcript = textFromTimestampPayload(payload);
  const wordDuration = wordTimelineDurationSeconds(payload);
  const timelineWordCount = timestampWordsFromPayload(payload).length;
  const acoustic = {
    ...(acousticFromTimestampMeta(meta) || {}),
  };
  if (wordDuration !== null) acoustic.durationSeconds = wordDuration;
  const timelineWpm = deriveWpmFromDuration({
    transcript,
    wordCount: timelineWordCount,
    durationSeconds: wordDuration,
  });
  return {
    narration: {
      provider,
      source,
      audioPath,
      transcript,
      acoustic,
      voiceMastering:
        meta.voiceMastering ||
        meta.voice_mastering ||
        meta.mastering ||
        null,
      approvedLocalVoice: meta.approvedLocalVoice,
      acceptedLocalVoice:
        meta.acceptedLocalVoice ||
        meta.localVoiceReference ||
        meta.voiceReference ||
        null,
      wpm: timelineWpm ?? meta.localPace?.wpm ?? meta.pace?.wpm ?? meta.wpm ?? null,
    },
    source: "audio_timestamp_sidecar",
    timestampPath,
    wordTimelineDurationSeconds: wordDuration,
    wordTimelineWordCount: timelineWordCount || null,
  };
}

function timestampEvidenceScore(payload = {}) {
  const meta = payload?.meta || {};
  if (!meta || typeof meta !== "object") return 0;
  let score = 0;
  const provider = String(meta.provider || "").trim();
  const source = String(meta.source || "").trim();
  if (provider && source) score += 4;
  if (meta.approvedLocalVoice === true) score += 4;
  const accepted =
    meta.acceptedLocalVoice ||
    meta.localVoiceReference ||
    meta.voiceReference ||
    {};
  if (accepted && typeof accepted === "object") {
    if (accepted.id) score += 2;
    if (accepted.referenceHash || accepted.hash) score += 2;
  }
  const acoustic = acousticFromTimestampMeta(meta);
  if (acoustic && typeof acoustic === "object") {
    if (Number.isFinite(Number(acoustic.medianPitchHz))) score += 1;
    if (Number.isFinite(Number(acoustic.integratedLufs))) score += 1;
    if (Number.isFinite(Number(acoustic.truePeakDb))) score += 1;
    if (Number.isFinite(Number(acoustic.durationSeconds))) score += 1;
  }
  if (meta.voiceMastering || meta.voice_mastering || meta.mastering) score += 2;
  if (textFromTimestampPayload(payload)) score += 1;
  return score;
}

async function loadTimestampSidecarReport(id, mp4Path, fsImpl = fs) {
  for (const candidate of audioTimestampCandidates(id, mp4Path)) {
    const resolved = await mediaPaths.resolveExisting(candidate, { fs: fsImpl });
    if (!resolved || !(await fsImpl.pathExists(resolved))) continue;
    const json = await safeReadJson(resolved);
    const report = reportFromTimestampPayload(json, resolved);
    if (report) return report;
  }
  return null;
}

async function scanReportDir(id, dir, depth = 2) {
  if (depth < 0 || !(await fs.pathExists(dir))) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && looksLikeReportForStory(id, entry.name)) {
      const json = await safeReadJson(full);
      if (json) return json;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const json = await scanReportDir(id, path.join(dir, entry.name), depth - 1);
    if (json) return json;
  }
  return null;
}

function proofArtifactDirs(mp4Path) {
  const dirs = [];
  let current = path.dirname(String(mp4Path || ""));
  for (let index = 0; index < 5 && current && !dirs.includes(current); index++) {
    dirs.push(current);
    const next = path.dirname(current);
    if (!next || next === current) break;
    current = next;
  }
  return dirs;
}

function normaliseProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "local_tts" || value === "local-tts") return "local";
  return provider || null;
}

function segmentLufsFromReport(report = {}) {
  const safeReport = report || {};
  return (Array.isArray(safeReport.segments) ? safeReport.segments : [])
    .map((segment) => Number(segment?.mean_volume_db ?? segment?.meanVolumeDb))
    .filter((number) => Number.isFinite(number));
}

function mergeProofNarrationReport({
  manifest = {},
  timestampReport = null,
  timestampPath = null,
  segmentReport = null,
}) {
  const timestampNarration = timestampReport?.narration || {};
  const transcript =
    manifest.final_transcript ||
    manifest.transcript ||
    timestampNarration.transcript ||
    "";
  const acoustic = {
    ...(timestampNarration.acoustic || {}),
  };
  const wordDuration = numberOrNull(timestampReport?.wordTimelineDurationSeconds);
  if (wordDuration !== null) acoustic.durationSeconds = wordDuration;
  const segmentLufs = segmentLufsFromReport(segmentReport);
  if (segmentLufs.length) acoustic.segmentLufs = segmentLufs;
  const timelineWpm = deriveWpmFromDuration({
    transcript,
    wordCount: timestampReport?.wordTimelineWordCount,
    durationSeconds: wordDuration,
  });
  return {
    narration: {
      provider: normaliseProvider(timestampNarration.provider || manifest.provider),
      source: timestampNarration.source || manifest.source || "local-tts-server",
      audioPath:
        timestampNarration.audioPath ||
        manifest.resolved_audio_path ||
        manifest.audio_path ||
        manifest.audioPath ||
        null,
      transcript,
      acoustic,
      voiceMastering: timestampNarration.voiceMastering || null,
      approvedLocalVoice: timestampNarration.approvedLocalVoice,
      acceptedLocalVoice: timestampNarration.acceptedLocalVoice || null,
      wpm: timelineWpm ?? timestampNarration.wpm ?? null,
    },
    source: "goal_proof_narration_manifest",
    timestampPath,
  };
}

async function loadProofNarrationManifestReport(mp4Path, fsImpl = fs) {
  for (const dir of proofArtifactDirs(mp4Path)) {
    const manifestPath = path.join(dir, "narration_manifest.json");
    const manifest = await safeReadJson(manifestPath);
    if (!manifest) continue;
    const timestampCandidates = [
      manifest.resolved_word_timestamps_path,
      manifest.word_timestamps_path,
      manifest.wordTimestampsPath,
      path.join(dir, "word_timestamps.json"),
    ].filter(Boolean);
    let timestampPayload = null;
    let timestampPath = null;
    let timestampScore = -1;
    for (const candidate of timestampCandidates) {
      const results = await readJsonCandidates(candidate, dir, fsImpl);
      for (const result of results) {
        const score = timestampEvidenceScore(result.json);
        if (score > timestampScore) {
          timestampPayload = result.json;
          timestampPath = result.path;
          timestampScore = score;
        }
      }
    }
    const timestampReport = timestampPayload
      ? reportFromTimestampPayload(timestampPayload, timestampPath)
      : null;
    const segmentReport = await safeReadJson(path.join(dir, "audio_segment_loudness_report.json"));
    return mergeProofNarrationReport({
      manifest,
      timestampReport,
      timestampPath,
      segmentReport,
    });
  }
  return null;
}

async function loadFinalVoiceReportsByStoryId(files, opts = {}) {
  const outputDirs =
    Array.isArray(opts.outputDirs) && opts.outputDirs.length
      ? opts.outputDirs
      : DEFAULT_OUTPUT_DIRS;
  const reports = {};
  for (const file of Array.isArray(files) ? files : []) {
    const id = storyIdFromPath(file);
    const finalDir = opts.finalDir || path.dirname(file);
    const proofReport = await loadProofNarrationManifestReport(file, opts.fs || fs);
    if (proofReport) {
      reports[id] = proofReport;
      continue;
    }
    const dirs = [
      finalDir,
      ...outputDirs,
    ]
      .filter(Boolean)
      .map((dir) => path.resolve(dir));
    for (const candidate of directReportCandidates(id, dirs)) {
      const json = await safeReadJson(candidate);
      if (json) {
        reports[id] = json;
        break;
      }
    }
    if (!reports[id]) {
      const json = await loadTimestampSidecarReport(id, file, opts.fs || fs);
      if (json) reports[id] = json;
    }
    if (!reports[id]) {
      for (const dir of dirs) {
        const json = await scanReportDir(id, dir);
        if (json) {
          reports[id] = json;
          break;
        }
      }
    }
  }
  return reports;
}

module.exports = {
  audioTimestampCandidates,
  loadFinalVoiceReportsByStoryId,
  loadProofNarrationManifestReport,
  reportFromTimestampPayload,
};
