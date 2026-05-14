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
  return {
    narration: {
      provider,
      source,
      audioPath,
      transcript: textFromTimestampPayload(payload),
      acoustic: acousticFromTimestampMeta(meta),
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
      wpm: meta.localPace?.wpm || meta.pace?.wpm || null,
    },
    source: "audio_timestamp_sidecar",
    timestampPath,
  };
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

async function loadFinalVoiceReportsByStoryId(files, opts = {}) {
  const outputDirs =
    Array.isArray(opts.outputDirs) && opts.outputDirs.length
      ? opts.outputDirs
      : DEFAULT_OUTPUT_DIRS;
  const reports = {};
  for (const file of Array.isArray(files) ? files : []) {
    const id = storyIdFromPath(file);
    const finalDir = opts.finalDir || path.dirname(file);
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
      for (const dir of dirs) {
        const json = await scanReportDir(id, dir);
        if (json) {
          reports[id] = json;
          break;
        }
      }
    }
    if (!reports[id]) {
      const json = await loadTimestampSidecarReport(id, file, opts.fs || fs);
      if (json) reports[id] = json;
    }
  }
  return reports;
}

module.exports = {
  audioTimestampCandidates,
  loadFinalVoiceReportsByStoryId,
  reportFromTimestampPayload,
};
