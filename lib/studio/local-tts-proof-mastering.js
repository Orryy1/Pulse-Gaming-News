"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const mediaPaths = require("../media-paths");
const { repairTtsAudioFileLoudness } = require("../audio-quality");
const {
  collectLocalTtsProofRows,
  rowIsVoiceReady,
  timestampCandidatesForRow,
  timestampPathForAudio,
} = require("./local-tts-proof-promoter");
const { DEFAULT_ACCEPTED_LOCAL_VOICE_ID } = require("./v2/local-voice-reference");

const ALLOWED_PROOF_MARKERS = [
  "/test/output/local-media-repair/audio/",
  "/test/output/local-script-extension/audio/",
];

function normaliseSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function proofAudioPathForRow(row = {}) {
  return row.resolved_audio_path || row.output_audio_path || row.audio_path || null;
}

async function resolveExistingPath(rawPath, paths = mediaPaths) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;
  return paths.resolveExisting(rawPath);
}

function isAllowedProofAudioPath(filePath) {
  const normalised = normaliseSlashes(path.resolve(String(filePath || ""))).toLowerCase();
  return ALLOWED_PROOF_MARKERS.some((marker) => normalised.includes(marker));
}

async function resolveTimestampPathForRow(row = {}, audioPath, deps = {}) {
  const paths = deps.mediaPaths || mediaPaths;
  const fsImpl = deps.fs || fs;
  const candidates = [
    ...timestampCandidatesForRow(row),
    timestampPathForAudio(proofAudioPathForRow(row)),
    timestampPathForAudio(audioPath),
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    const resolved = await resolveExistingPath(candidate, paths);
    if (resolved && (await fsImpl.pathExists(resolved))) return resolved;
  }
  return null;
}

function readMasteringFromSidecar(payload = {}) {
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const mastering =
    meta.voiceMastering ||
    meta.voice_mastering ||
    meta.mastering ||
    {};
  const acoustic = mastering.acoustic || meta.acoustic || {};
  return {
    ok:
      mastering.ok === true ||
      String(mastering.code || "").toLowerCase() === "voice_mastered",
    integratedLufs: numberOrNull(
      acoustic.integratedLufs ??
        acoustic.integratedLUFS ??
        acoustic.input_i ??
        acoustic.output_i,
    ),
    truePeakDb: numberOrNull(
      acoustic.truePeakDb ??
        acoustic.true_peak_db ??
        acoustic.input_tp ??
        acoustic.output_tp,
    ),
  };
}

async function inspectProofMasteringTarget(row = {}, deps = {}) {
  const fsImpl = deps.fs || fs;
  const paths = deps.mediaPaths || mediaPaths;
  const rawAudioPath = proofAudioPathForRow(row);
  const audioPath = await resolveExistingPath(rawAudioPath, paths);
  const target = {
    story_id: row.story_id || null,
    proof_source: row.proof_source || null,
    audio_path: audioPath || rawAudioPath || null,
    timestamps_path: null,
    allowed: false,
    action: "blocked",
    blockers: [],
    warnings: [],
    mastering_before: null,
  };

  if (!audioPath || !(await fsImpl.pathExists(audioPath))) {
    target.blockers.push("proof_audio_missing");
    return target;
  }
  if (!isAllowedProofAudioPath(audioPath)) {
    target.blockers.push("proof_audio_outside_allowed_local_output");
    return target;
  }
  target.allowed = true;

  const timestampsPath = await resolveTimestampPathForRow(row, audioPath, { fs: fsImpl, mediaPaths: paths });
  target.timestamps_path = timestampsPath;
  if (!timestampsPath) {
    target.blockers.push("proof_timestamps_missing");
    return target;
  }

  let payload = {};
  try {
    payload = await fsImpl.readJson(timestampsPath);
  } catch (err) {
    target.blockers.push("proof_timestamps_unreadable");
    target.warnings.push(err.message);
    return target;
  }

  target.mastering_before = readMasteringFromSidecar(payload);
  if (target.mastering_before.ok && target.mastering_before.integratedLufs !== null) {
    target.action = "already_mastered";
    return target;
  }

  target.action = "would_master";
  return target;
}

async function stampProofMasteringSidecar({ timestampsPath, repairResult, now = new Date(), fsImpl = fs } = {}) {
  if (!timestampsPath || !repairResult?.ok) return null;
  const payload = await fsImpl.readJson(timestampsPath);
  payload.meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  payload.meta.acoustic = {
    ...(payload.meta.acoustic || {}),
    ...(repairResult.acoustic || {}),
  };
  payload.meta.voiceMastering = {
    ...(payload.meta.voiceMastering || {}),
    ok: true,
    code: "voice_mastered",
    targetLufs: repairResult.targetLufs ?? -16,
    truePeak: repairResult.truePeak ?? -2.2,
    acoustic: repairResult.acoustic || null,
    masteredAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    source: "local_tts_proof_mastering",
  };
  await fsImpl.writeJson(timestampsPath, payload, { spaces: 2 });
  return timestampsPath;
}

async function applyProofMasteringTarget(target = {}, deps = {}) {
  const execFileAsync = deps.execFileAsync;
  const fsImpl = deps.fs || fs;
  const now = deps.now || new Date();
  if (target.action !== "would_master") return { ...target, applied: false };
  const repair = await repairTtsAudioFileLoudness({
    inputPath: target.audio_path,
    execFileAsync,
    ffmpegPath: deps.ffmpegPath || "ffmpeg",
    env: deps.env || process.env,
    now,
  });
  const stamped = repair.ok
    ? await stampProofMasteringSidecar({
        timestampsPath: target.timestamps_path,
        repairResult: repair,
        now,
        fsImpl,
      })
    : null;
  return {
    ...target,
    action: repair.ok ? "applied_local_mastering" : "mastering_failed",
    applied: repair.ok === true,
    repair,
    stamped_timestamps_path: stamped,
  };
}

async function buildLocalTtsProofMasteringReport({
  proofReports = [],
  overnightReport = null,
  storyIds = [],
  limit = 20,
  applyLocal = false,
  deps = {},
} = {}) {
  const rows = collectLocalTtsProofRows({ proofReports, overnightReport });
  const wanted = new Set(storyIds.filter(Boolean));
  const readyRows = rows.applied
    .filter((row) => rowIsVoiceReady(row, DEFAULT_ACCEPTED_LOCAL_VOICE_ID))
    .filter((row) => !wanted.size || wanted.has(String(row.story_id || "")))
    .slice(0, Math.max(1, Number(limit) || 20));

  const inspected = [];
  for (const row of readyRows) {
    const target = await inspectProofMasteringTarget(row, deps);
    inspected.push(applyLocal ? await applyProofMasteringTarget(target, deps) : target);
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: applyLocal ? "apply-local" : "dry-run",
    counts: {
      ready_rows_seen: readyRows.length,
      would_master: inspected.filter((row) => row.action === "would_master").length,
      already_mastered: inspected.filter((row) => row.action === "already_mastered").length,
      applied: inspected.filter((row) => row.applied === true).length,
      blocked: inspected.filter((row) => row.blockers?.length).length,
    },
    rows: inspected,
    safety: {
      local_only: true,
      writes_local_proof_audio: applyLocal,
      mutates_db: false,
      mutates_tokens: false,
      posts_to_platforms: false,
      production_voice_unchanged: true,
    },
  };
}

function renderLocalTtsProofMasteringMarkdown(report = {}) {
  const lines = [
    "# Local TTS Proof Mastering",
    "",
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    `Ready proof rows: ${report.counts?.ready_rows_seen ?? 0}`,
    `Would master: ${report.counts?.would_master ?? 0}`,
    `Already mastered: ${report.counts?.already_mastered ?? 0}`,
    `Applied: ${report.counts?.applied ?? 0}`,
    `Blocked: ${report.counts?.blocked ?? 0}`,
    "",
    "## Rows",
  ];
  for (const row of report.rows || []) {
    const lufs = row.repair?.acoustic?.integratedLufs ?? row.mastering_before?.integratedLufs ?? "unknown";
    const peak = row.repair?.acoustic?.truePeakDb ?? row.mastering_before?.truePeakDb ?? "unknown";
    lines.push(
      `- ${row.story_id || "unknown"}: ${row.action} lufs=${lufs} peak=${peak} blockers=${row.blockers?.length ? row.blockers.join(",") : "none"}`,
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- Local proof MP3s only.");
  lines.push("- Backups are written before in-place mastering.");
  lines.push("- No DB rows, tokens, OAuth, Railway settings, production voice defaults or platform posts are touched.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLocalTtsProofMasteringReport,
  inspectProofMasteringTarget,
  isAllowedProofAudioPath,
  renderLocalTtsProofMasteringMarkdown,
  stampProofMasteringSidecar,
};
