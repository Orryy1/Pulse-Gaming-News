"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");

const CONTRACT_ID = "longform_flagship_repair_plan_v1";
const LONGFORM_MIN_DURATION_SECONDS = 600;
const REQUIRED_EVIDENCE_CHECKS = Object.freeze([
  "same_run_transcript",
  "final_narration",
  "word_timestamps",
  "captions",
  "rights_lineage",
  "platform_variants",
  "decoded_qa",
  "human_av_review",
]);

const DEFAULT_EVIDENCE_FILES = Object.freeze({
  same_run_transcript: "longform_run_manifest.json",
  final_narration: "pulse_release_radar_audio_manifest.json",
  word_timestamps: "word_timestamps.json",
  captions: "caption_manifest.json",
  rights_lineage: "rights_lineage.json",
  platform_variants: "platform_variants.json",
  decoded_qa: "decoded_qa_report.json",
  human_av_review: "final_av_review.json",
});

const MISSING_BLOCKERS = Object.freeze({
  same_run_transcript: "same_run_transcript_binding_missing",
  final_narration: "final_narration_manifest_missing",
  word_timestamps: "word_timestamps_missing",
  captions: "captions_missing",
  rights_lineage: "rights_lineage_missing",
  platform_variants: "platform_variants_manifest_missing",
  decoded_qa: "decoded_qa_report_missing",
  human_av_review: "human_av_review_missing",
});
const DECODED_QA_REQUIRED_CHECKS = Object.freeze([
  "audio",
  "video",
  "captions",
  "av_sync",
  "freeze",
  "black",
  "blur",
  "repetition",
]);

function clean(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseSha256(value) {
  const hash = clean(value).replace(/^sha256:/i, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function resolveDeclaredPath(value, baseDir) {
  const target = clean(value);
  if (!target) return "";
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(baseDir, target);
}

function quoteCommandArg(value) {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

function safeFileToken(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "longform";
}

function pathContains(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function defaultProbeMedia(filePath, {
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  probeTimeoutMs = 30_000,
} = {}) {
  const result = spawnSync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,duration",
    "-of", "json",
    filePath,
  ], {
    encoding: "utf8",
    timeout: probeTimeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(clean(result.stderr) || "ffprobe failed");
  const payload = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video") || null;
  const audio = streams.find((stream) => stream.codec_type === "audio") || null;
  const durationSeconds = numberOrNull(payload.format?.duration) || Math.max(
    0,
    ...streams.map((stream) => numberOrNull(stream.duration)).filter((value) => value > 0),
  );
  return {
    decodable: Boolean((video || audio) && durationSeconds > 0),
    format_name: clean(payload.format?.format_name).toLowerCase(),
    duration_seconds: durationSeconds || null,
    video: video ? {
      codec: clean(video.codec_name).toLowerCase(),
      width: numberOrNull(video.width),
      height: numberOrNull(video.height),
    } : null,
    audio: audio ? { codec: clean(audio.codec_name).toLowerCase() } : null,
  };
}

async function readJson(filePath) {
  try {
    return await fs.readJson(filePath);
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${error.message}`);
  }
}

async function inspectSameRunTranscript({
  evidencePath,
  artifactDir,
  candidatePackage,
  candidatePackagePath,
  candidatePackageSha256,
  finalMp4,
}) {
  if (!(await fs.pathExists(evidencePath))) {
    const blockers = [MISSING_BLOCKERS.same_run_transcript];
    const observed = {};
    const candidateGeneratedMs = Date.parse(clean(candidatePackage.generated_at));
    const finalMp4MtimeMs = Date.parse(clean(finalMp4.mtime_utc));
    if (
      Number.isFinite(candidateGeneratedMs) &&
      Number.isFinite(finalMp4MtimeMs) &&
      candidateGeneratedMs > finalMp4MtimeMs + 1000
    ) {
      blockers.push("same_run_candidate_newer_than_final_mp4");
    }
    const compilationPath = path.join(artifactDir, "longform_compilation.json");
    if (await fs.pathExists(compilationPath)) {
      try {
        const compilation = await fs.readJson(compilationPath);
        const compiledScript = String(
          compilation.fullScript || compilation.full_script || compilation.script || "",
        ).trim();
        const candidateScript = String(asObject(candidatePackage.longform).script || "").trim();
        observed.compilation_path = compilationPath;
        observed.compilation_transcript_sha256 = compiledScript ? sha256Text(compiledScript) : null;
        if (compiledScript && candidateScript && compiledScript !== candidateScript) {
          blockers.push("same_run_compilation_transcript_mismatch");
        }
      } catch {
        blockers.push("same_run_compilation_invalid_json");
      }
    }
    const longformEvidencePath = path.join(artifactDir, "longform_evidence.json");
    if (await fs.pathExists(longformEvidencePath)) {
      try {
        const longformEvidence = await fs.readJson(longformEvidencePath);
        const candidateStoryIds = asArray(asObject(candidatePackage.longform).segments)
          .map((row) => clean(row.id || row.story_id).toLowerCase())
          .filter(Boolean)
          .sort();
        const evidenceStoryIds = asArray(longformEvidence.sourcePack || longformEvidence.source_pack)
          .map((row) => clean(row.story_id || row.id).toLowerCase())
          .filter(Boolean)
          .sort();
        observed.longform_evidence_path = longformEvidencePath;
        observed.candidate_story_ids = candidateStoryIds;
        observed.evidence_story_ids = evidenceStoryIds;
        if (
          candidateStoryIds.length &&
          evidenceStoryIds.length &&
          JSON.stringify(candidateStoryIds) !== JSON.stringify(evidenceStoryIds)
        ) {
          blockers.push("same_run_story_set_mismatch");
        }
      } catch {
        blockers.push("same_run_adjacent_evidence_invalid_json");
      }
    }
    return {
      id: "same_run_transcript",
      status: "BLOCKED",
      evidence_path: evidencePath,
      expected_paths: [evidencePath],
      blockers,
      evidence: {
        candidate_generated_at: clean(candidatePackage.generated_at) || null,
        final_mp4_mtime_utc: clean(finalMp4.mtime_utc) || null,
        ...observed,
        hashes_bound: false,
      },
    };
  }
  let manifest;
  try {
    manifest = await fs.readJson(evidencePath);
  } catch {
    return {
      id: "same_run_transcript",
      status: "BLOCKED",
      evidence_path: evidencePath,
      expected_paths: [evidencePath],
      blockers: ["same_run_transcript_binding_invalid_json"],
    };
  }
  const blockers = [];
  const baseDir = path.dirname(evidencePath);
  const runId = clean(manifest.run_id);
  const candidateRunId = clean(
    candidatePackage.production_run_id || candidatePackage.run_id || candidatePackage.render_run_id,
  );
  const declaredCandidatePath = resolveDeclaredPath(manifest.candidate_package?.path, baseDir);
  const declaredCandidateHash = normaliseSha256(manifest.candidate_package?.sha256);
  const transcriptPath = resolveDeclaredPath(manifest.transcript?.path, baseDir);
  const declaredTranscriptHash = normaliseSha256(manifest.transcript?.sha256);
  const declaredTranscriptTextHash = normaliseSha256(manifest.transcript?.text_sha256);
  const declaredMp4Path = resolveDeclaredPath(manifest.final_mp4?.path, baseDir);
  const declaredMp4Hash = normaliseSha256(manifest.final_mp4?.sha256);
  const packageScript = String(asObject(candidatePackage.longform).script || "").trim();
  let transcriptHash = "";
  let transcriptTextHash = "";

  if (manifest.complete !== true) blockers.push("same_run_manifest_incomplete");
  if (!runId) blockers.push("same_run_id_missing");
  if (!candidateRunId) blockers.push("same_run_candidate_run_id_missing");
  else if (runId && candidateRunId !== runId) blockers.push("same_run_id_mismatch");
  if (!declaredCandidatePath || declaredCandidatePath !== path.resolve(candidatePackagePath)) {
    blockers.push("same_run_candidate_package_path_mismatch");
  }
  if (!declaredCandidateHash) blockers.push("same_run_candidate_package_sha256_missing");
  else if (declaredCandidateHash !== candidatePackageSha256) {
    blockers.push("same_run_candidate_package_sha256_mismatch");
  }
  if (!transcriptPath || !(await fs.pathExists(transcriptPath))) {
    blockers.push("same_run_transcript_file_missing");
  } else {
    transcriptHash = await sha256File(transcriptPath);
    transcriptTextHash = sha256Text(await fs.readFile(transcriptPath, "utf8"));
  }
  if (!declaredTranscriptHash) blockers.push("same_run_transcript_sha256_missing");
  else if (transcriptHash && declaredTranscriptHash !== transcriptHash) {
    blockers.push("same_run_transcript_sha256_mismatch");
  }
  if (!declaredTranscriptTextHash) blockers.push("same_run_transcript_text_sha256_missing");
  else if (
    declaredTranscriptTextHash !== sha256Text(packageScript) ||
    (transcriptTextHash && declaredTranscriptTextHash !== transcriptTextHash)
  ) {
    blockers.push("same_run_transcript_text_sha256_mismatch");
  }
  if (!declaredMp4Path || declaredMp4Path !== finalMp4.path) {
    blockers.push("same_run_final_mp4_path_mismatch");
  }
  if (!declaredMp4Hash) blockers.push("same_run_final_mp4_sha256_missing");
  else if (declaredMp4Hash !== finalMp4.sha256) blockers.push("same_run_final_mp4_sha256_mismatch");

  return {
    id: "same_run_transcript",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: evidencePath,
    expected_paths: [evidencePath, transcriptPath].filter(Boolean),
    blockers,
    evidence: {
      run_id: runId || null,
      candidate_run_id: candidateRunId || null,
      candidate_package_sha256: candidatePackageSha256,
      transcript_path: transcriptPath || null,
      transcript_sha256: transcriptHash || null,
      transcript_text_sha256: transcriptTextHash || null,
      final_mp4_sha256: finalMp4.sha256,
      hashes_bound: blockers.length === 0,
    },
  };
}

async function inspectFinalNarration({
  evidencePath,
  candidatePackage,
  finalMp4,
  probeAudio,
  options,
  transcriptEvidence,
}) {
  if (!(await fs.pathExists(evidencePath))) {
    return {
      check: {
        id: "final_narration",
        status: "BLOCKED",
        evidence_path: evidencePath,
        expected_paths: [evidencePath],
        blockers: [MISSING_BLOCKERS.final_narration],
      },
      manifest: {},
      audio: {},
    };
  }
  let manifest;
  try {
    manifest = await fs.readJson(evidencePath);
  } catch {
    return {
      check: {
        id: "final_narration",
        status: "BLOCKED",
        evidence_path: evidencePath,
        expected_paths: [evidencePath],
        blockers: ["final_narration_manifest_invalid_json"],
      },
      manifest: {},
      audio: {},
    };
  }
  const blockers = [];
  const baseDir = path.dirname(evidencePath);
  const audioPath = resolveDeclaredPath(manifest.audio_path || manifest.narration_path, baseDir);
  const declaredAudioHash = normaliseSha256(manifest.audio_sha256 || manifest.narration_sha256);
  const declaredDuration = numberOrNull(manifest.duration_seconds || manifest.duration_s);
  const declaredTranscriptHash = normaliseSha256(manifest.transcript_sha256);
  const declaredMp4Hash = normaliseSha256(manifest.final_mp4_sha256);
  const runId = clean(manifest.run_id);
  const expectedRunId = clean(
    transcriptEvidence?.run_id ||
    candidatePackage.production_run_id ||
    candidatePackage.run_id ||
    candidatePackage.render_run_id,
  );
  let audioExists = false;
  let audioSha256 = "";
  let measuredDuration = null;
  let audioDecodable = false;

  if (manifest.complete !== true) blockers.push("final_narration_complete_flag_missing");
  if (!runId) blockers.push("final_narration_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) blockers.push("final_narration_run_id_mismatch");
  const candidateGeneratedMs = Date.parse(clean(candidatePackage.generated_at));
  const narrationGeneratedMs = Date.parse(clean(manifest.generated_at));
  if (
    Number.isFinite(candidateGeneratedMs) &&
    Number.isFinite(narrationGeneratedMs) &&
    narrationGeneratedMs < candidateGeneratedMs
  ) {
    blockers.push("final_narration_predates_candidate_package");
  }
  const candidateSubjects = asArray(asObject(candidatePackage.longform).segments)
    .map((row) => clean(row.canonical_game || row.title).toLowerCase())
    .filter(Boolean)
    .sort();
  const narrationSubjects = asArray(manifest.protected_titles)
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
    .sort();
  if (
    candidateSubjects.length &&
    narrationSubjects.length &&
    JSON.stringify(candidateSubjects) !== JSON.stringify(narrationSubjects)
  ) {
    blockers.push("final_narration_candidate_subject_set_mismatch");
  }
  if (!audioPath || !(await fs.pathExists(audioPath))) {
    blockers.push("final_narration_audio_missing");
  } else {
    const stat = await fs.stat(audioPath);
    audioExists = stat.isFile() && stat.size > 0;
    if (!audioExists) blockers.push("final_narration_audio_missing");
    else {
      audioSha256 = await sha256File(audioPath);
      try {
        const probe = await (probeAudio || defaultProbeMedia)(audioPath, options);
        measuredDuration = numberOrNull(probe?.duration_seconds);
        audioDecodable = probe?.decodable === true && Boolean(probe?.audio);
        if (!audioDecodable) blockers.push("final_narration_audio_not_decodable");
      } catch {
        blockers.push("final_narration_probe_failed");
      }
    }
  }
  if (!declaredAudioHash) blockers.push("final_narration_audio_sha256_missing");
  else if (audioSha256 && declaredAudioHash !== audioSha256) {
    blockers.push("final_narration_audio_sha256_mismatch");
  }
  if (!(declaredDuration > 0)) blockers.push("final_narration_duration_missing_or_invalid");
  else if (measuredDuration && Math.abs(declaredDuration - measuredDuration) > Math.max(1, measuredDuration * 0.01)) {
    blockers.push("final_narration_duration_mismatch");
  }
  if (measuredDuration && measuredDuration < finalMp4.duration_seconds - Math.max(2, finalMp4.duration_seconds * 0.02)) {
    blockers.push("final_narration_duration_incomplete");
  }
  if (!declaredTranscriptHash) blockers.push("final_narration_transcript_sha256_missing");
  else if (transcriptEvidence?.transcript_sha256 && declaredTranscriptHash !== transcriptEvidence.transcript_sha256) {
    blockers.push("final_narration_transcript_sha256_mismatch");
  }
  if (!declaredMp4Hash) blockers.push("final_narration_final_mp4_sha256_missing");
  else if (declaredMp4Hash !== finalMp4.sha256) blockers.push("final_narration_final_mp4_sha256_mismatch");

  return {
    check: {
      id: "final_narration",
      status: blockers.length ? "BLOCKED" : "PASS",
      evidence_path: evidencePath,
      expected_paths: [evidencePath, audioPath].filter(Boolean),
      blockers,
      evidence: {
        run_id: runId || null,
        audio_path: audioPath || null,
        audio_exists: audioExists,
        audio_sha256: audioSha256 || null,
        declared_audio_sha256: declaredAudioHash || null,
        declared_duration_seconds: declaredDuration,
        measured_duration_seconds: measuredDuration,
        decodable: audioDecodable,
      },
    },
    manifest,
    audio: {
      path: audioPath,
      sha256: audioSha256,
      duration_seconds: measuredDuration || declaredDuration,
      run_id: runId,
    },
  };
}

function timestampRows(payload) {
  const object = asObject(payload);
  for (const key of ["words", "word_timestamps", "timestamps"]) {
    if (Array.isArray(object[key])) return object[key];
  }
  return [];
}

async function inspectWordTimestamps({
  defaultPath,
  narrationManifest,
  narrationAudio,
  finalMp4,
  expectedRunId,
}) {
  const manifestPath = resolveDeclaredPath(
    narrationManifest.timestamps_path || narrationManifest.word_timestamps_path,
    path.dirname(defaultPath),
  );
  const evidencePath = manifestPath || defaultPath;
  if (!(await fs.pathExists(evidencePath))) {
    return {
      id: "word_timestamps",
      status: "BLOCKED",
      evidence_path: evidencePath,
      expected_paths: [defaultPath],
      blockers: [MISSING_BLOCKERS.word_timestamps],
    };
  }
  let payload;
  try {
    payload = await fs.readJson(evidencePath);
  } catch {
    return {
      id: "word_timestamps",
      status: "BLOCKED",
      evidence_path: evidencePath,
      expected_paths: [defaultPath, evidencePath],
      blockers: ["word_timestamps_invalid_json"],
    };
  }
  const blockers = [];
  const rows = timestampRows(payload);
  const runId = clean(payload.run_id);
  const declaredFileHash = normaliseSha256(
    narrationManifest.timestamps_sha256 || narrationManifest.word_timestamps_sha256,
  );
  const actualFileHash = await sha256File(evidencePath);
  const boundAudioHash = normaliseSha256(
    payload.audio_sha256 || payload.narration_sha256 || payload.source_audio_sha256,
  );
  let validRows = rows.length > 0;
  let coverageStart = null;
  let coverageEnd = null;
  let maxGap = null;
  let previousEnd = null;
  let lexicalWordCount = 0;
  for (const row of rows) {
    const word = clean(row.word || row.text || row.token);
    const start = numberOrNull(row.start ?? row.start_seconds ?? row.start_s);
    const end = numberOrNull(row.end ?? row.end_seconds ?? row.end_s);
    if (!word || start === null || end === null || start < 0 || end <= start) validRows = false;
    if (coverageStart === null && start !== null) coverageStart = start;
    if (start !== null && previousEnd !== null) {
      const gap = start - previousEnd;
      if (gap < -0.05) validRows = false;
      else maxGap = Math.max(maxGap || 0, gap);
    }
    if (end !== null) {
      coverageEnd = Math.max(coverageEnd || 0, end);
      previousEnd = end;
    }
    if (word) lexicalWordCount += word.split(/\s+/).filter(Boolean).length;
  }
  const expectedDuration = narrationAudio.duration_seconds || finalMp4.duration_seconds;
  const minimumWords = Math.max(12, Math.floor(expectedDuration * 0.9));
  const nontrivial = (
    validRows &&
    lexicalWordCount >= minimumWords &&
    coverageStart !== null && coverageStart <= 1 &&
    coverageEnd >= expectedDuration - Math.max(2, expectedDuration * 0.02) &&
    (maxGap === null || maxGap <= 3)
  );

  if (payload.complete !== true) blockers.push("word_timestamps_complete_flag_missing");
  if (!runId) blockers.push("word_timestamps_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) blockers.push("word_timestamps_run_id_mismatch");
  if (!declaredFileHash) blockers.push("word_timestamps_sha256_missing");
  else if (declaredFileHash !== actualFileHash) blockers.push("word_timestamps_sha256_mismatch");
  if (!boundAudioHash) blockers.push("word_timestamps_audio_sha256_missing");
  else if (narrationAudio.sha256 && boundAudioHash !== narrationAudio.sha256) {
    blockers.push("word_timestamps_audio_sha256_mismatch");
  }
  if (!rows.length) blockers.push("word_timestamps_not_word_level");
  else if (!validRows) blockers.push("word_timestamps_content_invalid");
  if (!nontrivial) blockers.push("word_timestamps_nontrivial_coverage_missing");

  return {
    id: "word_timestamps",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: evidencePath,
    expected_paths: [...new Set([defaultPath, evidencePath])],
    blockers,
    evidence: {
      run_id: runId || null,
      sha256: actualFileHash,
      declared_sha256: declaredFileHash || null,
      bound_audio_sha256: boundAudioHash || null,
      row_count: rows.length,
      lexical_word_count: lexicalWordCount,
      coverage_start_seconds: coverageStart,
      coverage_end_seconds: coverageEnd,
      max_gap_seconds: maxGap,
    },
  };
}

function srtTimeSeconds(value) {
  const parts = clean(value).replace(",", ".").split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

async function inspectCaptions({
  manifestPath,
  finalMp4,
  expectedRunId,
  narrationCheck,
  wordTimestampsCheck,
}) {
  if (!(await fs.pathExists(manifestPath))) {
    return {
      id: "captions",
      status: "BLOCKED",
      evidence_path: manifestPath,
      expected_paths: [manifestPath, path.join(path.dirname(manifestPath), "captions.srt")],
      blockers: [MISSING_BLOCKERS.captions],
    };
  }
  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch {
    return {
      id: "captions",
      status: "BLOCKED",
      evidence_path: manifestPath,
      expected_paths: [manifestPath],
      blockers: ["caption_manifest_invalid_json"],
    };
  }
  const blockers = [];
  const baseDir = path.dirname(manifestPath);
  const captionsPath = resolveDeclaredPath(
    manifest.captions_path || manifest.srt_path || "captions.srt",
    baseDir,
  );
  const runId = clean(manifest.run_id);
  const declaredCaptionHash = normaliseSha256(manifest.captions_sha256 || manifest.sha256);
  const declaredAudioHash = normaliseSha256(manifest.audio_sha256 || manifest.narration_sha256);
  const declaredTimestampsHash = normaliseSha256(manifest.word_timestamps_sha256);
  const declaredMp4Hash = normaliseSha256(manifest.final_mp4_sha256);
  let actualCaptionHash = "";
  let contents = "";
  let cueCount = 0;
  let lexicalWordCount = 0;
  let coverageStart = null;
  let coverageEnd = null;
  let maxGap = null;
  let previousEnd = null;
  let contentValid = true;
  let cueTooLong = false;

  if (manifest.complete !== true) blockers.push("captions_complete_flag_missing");
  if (!runId) blockers.push("captions_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) blockers.push("captions_run_id_mismatch");
  if (!captionsPath || !(await fs.pathExists(captionsPath))) {
    blockers.push("captions_file_missing");
    contentValid = false;
  } else {
    actualCaptionHash = await sha256File(captionsPath);
    contents = await fs.readFile(captionsPath, "utf8");
  }
  if (!declaredCaptionHash) blockers.push("captions_sha256_missing");
  else if (actualCaptionHash && declaredCaptionHash !== actualCaptionHash) {
    blockers.push("captions_sha256_mismatch");
  }
  if (!declaredAudioHash) blockers.push("captions_audio_sha256_missing");
  else if (
    narrationCheck.evidence?.audio_sha256 &&
    declaredAudioHash !== narrationCheck.evidence.audio_sha256
  ) {
    blockers.push("captions_audio_sha256_mismatch");
  }
  if (!declaredTimestampsHash) blockers.push("captions_word_timestamps_sha256_missing");
  else if (
    wordTimestampsCheck.evidence?.sha256 &&
    declaredTimestampsHash !== wordTimestampsCheck.evidence.sha256
  ) {
    blockers.push("captions_word_timestamps_sha256_mismatch");
  }
  if (!declaredMp4Hash) blockers.push("captions_final_mp4_sha256_missing");
  else if (declaredMp4Hash !== finalMp4.sha256) blockers.push("captions_final_mp4_sha256_mismatch");

  if (contents) {
    const pattern = /(\d{1,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})[^\r\n]*/g;
    const matches = [...contents.matchAll(pattern)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const start = srtTimeSeconds(match[1]);
      const end = srtTimeSeconds(match[2]);
      const bodyStart = match.index + match[0].length;
      const bodyEnd = matches[index + 1]?.index ?? contents.length;
      const text = contents
        .slice(bodyStart, bodyEnd)
        .replace(/^\s*\d+\s*$/gm, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const words = text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
      if (start === null || end === null || end <= start || !words.length) contentValid = false;
      if (coverageStart === null && start !== null) coverageStart = start;
      if (start !== null && previousEnd !== null) {
        const gap = start - previousEnd;
        if (gap < -0.1) contentValid = false;
        else maxGap = Math.max(maxGap || 0, gap);
      }
      if (start !== null && end !== null && end > start) {
        if (end - start > 8 || words.length > 24) cueTooLong = true;
        coverageEnd = Math.max(coverageEnd || 0, end);
        previousEnd = end;
      }
      lexicalWordCount += words.length;
      cueCount += 1;
    }
    if (!cueCount) contentValid = false;
  }
  const minimumWords = Math.max(12, Math.floor(finalMp4.duration_seconds * 0.9 * 0.85));
  const minimumCues = Math.max(4, Math.ceil(finalMp4.duration_seconds / 6));
  const nontrivial = (
    contentValid &&
    !cueTooLong &&
    cueCount >= minimumCues &&
    lexicalWordCount >= minimumWords &&
    coverageStart !== null && coverageStart <= 1 &&
    coverageEnd >= finalMp4.duration_seconds - Math.max(2, finalMp4.duration_seconds * 0.02) &&
    (maxGap === null || maxGap <= 4)
  );
  if (!contentValid) blockers.push("captions_content_incomplete");
  if (cueTooLong) blockers.push("captions_cue_duration_exceeds_8_seconds");
  if (!nontrivial) blockers.push("captions_nontrivial_coverage_missing");
  if (narrationCheck.status !== "PASS") blockers.push("captions_final_narration_not_verified");
  if (wordTimestampsCheck.status !== "PASS") blockers.push("captions_word_timestamps_not_verified");

  return {
    id: "captions",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: manifestPath,
    expected_paths: [manifestPath, captionsPath],
    blockers,
    evidence: {
      run_id: runId || null,
      captions_path: captionsPath,
      sha256: actualCaptionHash || null,
      cue_count: cueCount,
      lexical_word_count: lexicalWordCount,
      coverage_start_seconds: coverageStart,
      coverage_end_seconds: coverageEnd,
      max_gap_seconds: maxGap,
    },
  };
}

async function inspectReferencedFile(filePath, declaredSha256, baseDir) {
  const resolvedPath = resolveDeclaredPath(filePath, baseDir);
  const declaredHash = normaliseSha256(declaredSha256);
  const result = {
    path: resolvedPath || null,
    exists: false,
    sha256: null,
    declared_sha256: declaredHash || null,
    hash_matches: false,
  };
  if (!resolvedPath || !(await fs.pathExists(resolvedPath))) return result;
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile() || stat.size <= 0) return result;
  result.exists = true;
  result.sha256 = await sha256File(resolvedPath);
  result.hash_matches = Boolean(declaredHash && declaredHash === result.sha256);
  return result;
}

async function inspectRightsLineage({ manifestPath, finalMp4, expectedRunId }) {
  if (!(await fs.pathExists(manifestPath))) {
    return {
      id: "rights_lineage",
      status: "BLOCKED",
      evidence_path: manifestPath,
      expected_paths: [manifestPath],
      blockers: [MISSING_BLOCKERS.rights_lineage],
    };
  }
  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch {
    return {
      id: "rights_lineage",
      status: "BLOCKED",
      evidence_path: manifestPath,
      expected_paths: [manifestPath],
      blockers: ["rights_lineage_invalid_json"],
    };
  }
  const blockers = [];
  const addBlocker = (code) => {
    if (!blockers.includes(code)) blockers.push(code);
  };
  const runId = clean(manifest.run_id);
  const declaredMp4Hash = normaliseSha256(manifest.final_mp4_sha256);
  const assets = asArray(manifest.used_assets).length
    ? asArray(manifest.used_assets)
    : asArray(manifest.assets);
  const records = [
    ...asArray(manifest.records),
    ...asArray(manifest.rights_records),
    ...asArray(manifest.rights_ledger),
  ];
  const recordsById = new Map();
  let verifiedAssetCount = 0;
  let verifiedEvidenceCount = 0;

  if (manifest.complete !== true) addBlocker("rights_lineage_complete_flag_missing");
  if (!runId) addBlocker("rights_lineage_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) addBlocker("rights_lineage_run_id_mismatch");
  if (!declaredMp4Hash) addBlocker("rights_lineage_final_mp4_sha256_missing");
  else if (declaredMp4Hash !== finalMp4.sha256) addBlocker("rights_lineage_final_mp4_sha256_mismatch");
  if (!assets.length) addBlocker("rights_lineage_assets_missing");
  if (!records.length) addBlocker("rights_lineage_records_missing");

  for (const record of records) {
    const assetId = clean(record.asset_id || record.id || record.source_id);
    if (!assetId || recordsById.has(assetId)) {
      addBlocker("rights_record_id_missing_or_duplicate");
      continue;
    }
    recordsById.set(assetId, record);
  }
  const seenAssets = new Set();
  for (const asset of assets) {
    const assetId = clean(asset.asset_id || asset.id || asset.source_id);
    const record = recordsById.get(assetId);
    const assetHash = normaliseSha256(asset.sha256 || asset.asset_sha256 || asset.content_hash);
    const recordHash = normaliseSha256(record?.asset_sha256 || record?.sha256 || record?.content_hash);
    const sourceLocator = clean(record?.source_url || asset.source_url || record?.source_reference);
    const rightsBasis = clean(
      record?.rights_basis || record?.licence_basis || record?.license_basis || record?.allowed_use,
    );
    const inspectedAsset = await inspectReferencedFile(
      asset.path || asset.local_path || asset.asset_path || asset.file_path,
      assetHash,
      path.dirname(manifestPath),
    );
    const evidenceHash = normaliseSha256(
      record?.rights_evidence_sha256 || record?.licence_evidence_sha256 || record?.evidence_sha256,
    );
    const inspectedEvidence = await inspectReferencedFile(
      record?.rights_evidence_path || record?.licence_evidence_path || record?.evidence_path,
      evidenceHash,
      path.dirname(manifestPath),
    );
    let assetValid = true;
    let evidenceValid = true;

    if (!assetId || seenAssets.has(assetId) || !record) {
      addBlocker("rights_asset_record_missing_or_duplicate");
      assetValid = false;
    }
    seenAssets.add(assetId);
    if (!sourceLocator || !rightsBasis || record?.commercial_use_allowed !== true) {
      addBlocker("rights_commercial_basis_incomplete");
      assetValid = false;
    }
    if (!assetHash || !recordHash) {
      addBlocker("rights_asset_sha256_missing_or_invalid");
      assetValid = false;
    } else if (assetHash !== recordHash) {
      addBlocker("rights_asset_record_sha256_mismatch");
      assetValid = false;
    }
    if (!inspectedAsset.exists) {
      addBlocker("rights_asset_file_missing");
      assetValid = false;
    } else if (!inspectedAsset.hash_matches) {
      addBlocker("rights_asset_sha256_mismatch");
      assetValid = false;
    }
    if (inspectedAsset.sha256 === finalMp4.sha256) {
      addBlocker("rights_asset_is_final_mp4");
      assetValid = false;
    }
    if (!evidenceHash) {
      addBlocker("rights_evidence_sha256_missing_or_invalid");
      evidenceValid = false;
    }
    if (!inspectedEvidence.exists) {
      addBlocker("rights_evidence_file_missing");
      evidenceValid = false;
    } else if (!inspectedEvidence.hash_matches) {
      addBlocker("rights_evidence_sha256_mismatch");
      evidenceValid = false;
    }
    if (
      inspectedAsset.exists &&
      inspectedEvidence.exists &&
      inspectedAsset.sha256 === inspectedEvidence.sha256
    ) {
      addBlocker("rights_evidence_not_independent");
      evidenceValid = false;
    }
    if (assetValid) verifiedAssetCount += 1;
    if (assetValid && evidenceValid) verifiedEvidenceCount += 1;
  }
  if (records.length !== assets.length) addBlocker("rights_lineage_asset_record_count_mismatch");

  return {
    id: "rights_lineage",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: manifestPath,
    expected_paths: [manifestPath],
    blockers,
    evidence: {
      run_id: runId || null,
      used_asset_count: assets.length,
      rights_record_count: records.length,
      verified_asset_count: verifiedAssetCount,
      verified_evidence_count: verifiedEvidenceCount,
    },
  };
}

async function inspectPlatformVariants({
  manifestPath,
  finalMp4,
  expectedRunId,
  probeMedia,
  options,
}) {
  if (!(await fs.pathExists(manifestPath))) {
    return {
      id: "platform_variants",
      status: "BLOCKED",
      evidence_path: manifestPath,
      expected_paths: [manifestPath],
      blockers: [MISSING_BLOCKERS.platform_variants],
    };
  }
  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch {
    return {
      id: "platform_variants",
      status: "BLOCKED",
      evidence_path: manifestPath,
      expected_paths: [manifestPath],
      blockers: ["platform_variants_manifest_invalid_json"],
    };
  }
  const blockers = [];
  const addBlocker = (code) => {
    if (!blockers.includes(code)) blockers.push(code);
  };
  const runId = clean(manifest.run_id);
  const sourceHash = normaliseSha256(manifest.source_final_mp4_sha256 || manifest.final_mp4_sha256);
  const requiredPlatforms = [...new Set(asArray(manifest.required_platforms).map(clean).filter(Boolean))];
  const variants = asArray(manifest.variants || manifest.outputs);
  const variantsByPlatform = new Map();
  let verifiedVariantCount = 0;

  if (manifest.complete !== true) addBlocker("platform_variants_complete_flag_missing");
  if (!runId) addBlocker("platform_variants_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) addBlocker("platform_variants_run_id_mismatch");
  if (!sourceHash) addBlocker("platform_variants_source_mp4_sha256_missing");
  else if (sourceHash !== finalMp4.sha256) addBlocker("platform_variants_source_mp4_sha256_mismatch");
  if (!requiredPlatforms.length) addBlocker("platform_variants_required_platforms_missing");
  if (!variants.length) addBlocker("platform_variants_rows_missing");
  for (const variant of variants) {
    const platform = clean(variant.platform || variant.platform_id || variant.id);
    if (!platform || variantsByPlatform.has(platform)) {
      addBlocker("platform_variant_id_missing_or_duplicate");
      continue;
    }
    variantsByPlatform.set(platform, variant);
  }

  for (const platform of requiredPlatforms) {
    const variant = variantsByPlatform.get(platform);
    if (!variant) {
      addBlocker(`platform_variant_missing:${platform}`);
      continue;
    }
    let valid = true;
    const variantSourceHash = normaliseSha256(
      variant.source_final_mp4_sha256 || variant.source_mp4_sha256,
    );
    if (!variantSourceHash) {
      addBlocker(`platform_variant_source_mp4_sha256_missing:${platform}`);
      valid = false;
    } else if (variantSourceHash !== finalMp4.sha256) {
      addBlocker(`platform_variant_source_mp4_sha256_mismatch:${platform}`);
      valid = false;
    }
    if (clean(variant.status).toLowerCase() !== "ready") {
      addBlocker(`platform_variant_status_not_ready:${platform}`);
      valid = false;
    }
    const variantPath = resolveDeclaredPath(variant.path || variant.output_path, path.dirname(manifestPath));
    const declaredHash = normaliseSha256(variant.sha256);
    if (!variantPath || !(await fs.pathExists(variantPath))) {
      addBlocker(`platform_variant_file_missing:${platform}`);
      valid = false;
    } else {
      const actualHash = await sha256File(variantPath);
      if (!declaredHash) {
        addBlocker(`platform_variant_sha256_missing:${platform}`);
        valid = false;
      } else if (declaredHash !== actualHash) {
        addBlocker(`platform_variant_sha256_mismatch:${platform}`);
        valid = false;
      }
      try {
        const probe = await (probeMedia || defaultProbeMedia)(variantPath, options);
        const duration = numberOrNull(probe?.duration_seconds);
        const width = numberOrNull(probe?.video?.width);
        const height = numberOrNull(probe?.video?.height);
        const codec = clean(probe?.video?.codec).toLowerCase();
        const audioCodec = clean(probe?.audio?.codec).toLowerCase();
        if (probe?.decodable !== true || !probe?.video || !probe?.audio) {
          addBlocker(`platform_variant_not_decodable:${platform}`);
          valid = false;
        }
        if (
          numberOrNull(variant.duration_seconds) !== null &&
          Math.abs(numberOrNull(variant.duration_seconds) - duration) > Math.max(1, duration * 0.01)
        ) {
          addBlocker(`platform_variant_duration_mismatch:${platform}`);
          valid = false;
        }
        if (numberOrNull(variant.width) !== width || numberOrNull(variant.height) !== height) {
          addBlocker(`platform_variant_dimensions_mismatch:${platform}`);
          valid = false;
        }
        if (clean(variant.video_codec).toLowerCase() !== codec || codec !== "h264") {
          addBlocker(`platform_variant_video_codec_invalid:${platform}`);
          valid = false;
        }
        if (clean(variant.audio_codec).toLowerCase() !== audioCodec || audioCodec !== "aac") {
          addBlocker(`platform_variant_audio_codec_invalid:${platform}`);
          valid = false;
        }
        if (variant.decodable !== true) {
          addBlocker(`platform_variant_declared_decodable_missing:${platform}`);
          valid = false;
        }
        if (platform === "youtube_longform" && !(duration >= LONGFORM_MIN_DURATION_SECONDS && width > height)) {
          addBlocker("youtube_longform_variant_contract_failed");
          valid = false;
        }
      } catch {
        addBlocker(`platform_variant_probe_failed:${platform}`);
        valid = false;
      }
    }
    if (valid) verifiedVariantCount += 1;
  }

  return {
    id: "platform_variants",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: manifestPath,
    expected_paths: [manifestPath],
    blockers,
    evidence: {
      run_id: runId || null,
      source_final_mp4_sha256: sourceHash || null,
      required_platforms: requiredPlatforms,
      variant_count: variants.length,
      verified_variant_count: verifiedVariantCount,
    },
  };
}

async function firstExistingPath(paths) {
  for (const filePath of paths) {
    if (await fs.pathExists(filePath)) return filePath;
  }
  return paths[0];
}

async function inspectDecodedQa({ reportPath, expectedPath, finalMp4, expectedRunId }) {
  if (!(await fs.pathExists(reportPath))) {
    return {
      id: "decoded_qa",
      status: "BLOCKED",
      evidence_path: expectedPath,
      expected_paths: [expectedPath],
      blockers: [MISSING_BLOCKERS.decoded_qa],
    };
  }
  let report;
  try {
    report = await fs.readJson(reportPath);
  } catch {
    return {
      id: "decoded_qa",
      status: "BLOCKED",
      evidence_path: reportPath,
      expected_paths: [expectedPath],
      blockers: ["decoded_qa_report_invalid_json"],
    };
  }
  const blockers = [];
  const addBlocker = (code) => {
    if (!blockers.includes(code)) blockers.push(code);
  };
  const reportSha256 = await sha256File(reportPath);
  const runId = clean(report.run_id);
  const verdict = clean(report.verdict).toLowerCase();
  const reportedHash = normaliseSha256(report.final_media?.sha256 || report.final_mp4_sha256);
  const reportedSize = numberOrNull(report.final_media?.size_bytes || report.final_mp4_size_bytes);
  const decode = asObject(report.decode || report.decode_evidence?.decode || report.full_decode);
  const checks = asObject(report.checks);
  const sampledFrames = asArray(report.sampled_frames);
  const criticalDefects = report.critical_defects;
  const reportedBlackEvents = numberOrNull(
    report.black_events ?? checks.black?.event_count ?? checks.black?.events,
  ) || 0;

  if (report.schema_version !== 1) addBlocker("decoded_qa_schema_version_invalid");
  if (report.complete !== true) addBlocker("decoded_qa_complete_flag_missing");
  if (!runId) addBlocker("decoded_qa_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) addBlocker("decoded_qa_run_id_mismatch");
  if (verdict !== "pass") addBlocker("decoded_qa_verdict_not_pass");
  if (!reportedHash) addBlocker("decoded_qa_final_mp4_sha256_missing");
  else if (reportedHash !== finalMp4.sha256) addBlocker("decoded_qa_final_mp4_sha256_mismatch");
  if (!(reportedSize > 0)) addBlocker("decoded_qa_final_mp4_size_missing");
  else if (reportedSize !== finalMp4.size_bytes) addBlocker("decoded_qa_final_mp4_size_mismatch");
  if (
    decode.fully_decoded !== true ||
    decode.audio_checked !== true ||
    decode.video_checked !== true ||
    !Array.isArray(decode.errors) ||
    decode.errors.length > 0
  ) {
    addBlocker("decoded_qa_full_decode_missing");
  }
  const decodedDuration = numberOrNull(decode.decoded_duration_seconds || decode.duration_seconds);
  if (
    decodedDuration !== null &&
    decodedDuration < finalMp4.duration_seconds - Math.max(1, finalMp4.duration_seconds * 0.01)
  ) {
    addBlocker("decoded_qa_full_decode_duration_incomplete");
  }
  for (const checkId of DECODED_QA_REQUIRED_CHECKS) {
    const check = asObject(checks[checkId]);
    if (check.checked !== true) addBlocker(`decoded_qa_required_check_missing:${checkId}`);
    else if (clean(check.verdict).toLowerCase() !== "pass") {
      addBlocker(`decoded_qa_required_check_not_pass:${checkId}`);
    }
  }
  if (sampledFrames.length < 4) {
    addBlocker("decoded_qa_sampled_frames_missing");
  } else {
    const times = sampledFrames
      .map((frame) => numberOrNull(frame.time_seconds))
      .filter((value) => value !== null)
      .sort((left, right) => left - right);
    if (sampledFrames.some((frame) => !normaliseSha256(frame.hash || frame.sha256))) {
      addBlocker("decoded_qa_sampled_frame_sha256_invalid");
    }
    const tolerance = Math.max(1, finalMp4.duration_seconds * 0.05);
    const maxGap = times.length > 1
      ? Math.max(...times.slice(1).map((value, index) => value - times[index]))
      : Infinity;
    if (
      times.length !== sampledFrames.length ||
      times[0] > tolerance ||
      times.at(-1) < finalMp4.duration_seconds - tolerance ||
      maxGap > finalMp4.duration_seconds / 3 + 0.25
    ) {
      addBlocker("decoded_qa_sampled_frames_timeline_incomplete");
    }
  }
  if (!Array.isArray(criticalDefects)) addBlocker("decoded_qa_critical_defects_missing");
  else if (criticalDefects.length) addBlocker("decoded_qa_critical_defects_present");
  if (reportedBlackEvents > 0) addBlocker("decoded_qa_black_events_present");

  return {
    id: "decoded_qa",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: reportPath,
    expected_paths: [...new Set([expectedPath, reportPath])],
    blockers,
    evidence: {
      run_id: runId || null,
      sha256: reportSha256,
      reported_final_mp4_sha256: reportedHash || null,
      reported_final_mp4_size_bytes: reportedSize,
      fully_decoded: decode.fully_decoded === true,
      required_check_count: DECODED_QA_REQUIRED_CHECKS.length,
      sampled_frame_count: sampledFrames.length,
      critical_defect_count: Array.isArray(criticalDefects) ? criticalDefects.length : null,
      reported_black_events: reportedBlackEvents,
    },
  };
}

async function inspectHumanAvReview({
  reviewPath,
  finalMp4,
  expectedRunId,
  decodedQaCheck,
}) {
  if (!(await fs.pathExists(reviewPath))) {
    return {
      id: "human_av_review",
      status: "BLOCKED",
      evidence_path: reviewPath,
      expected_paths: [reviewPath],
      blockers: [MISSING_BLOCKERS.human_av_review],
    };
  }
  let review;
  try {
    review = await fs.readJson(reviewPath);
  } catch {
    return {
      id: "human_av_review",
      status: "BLOCKED",
      evidence_path: reviewPath,
      expected_paths: [reviewPath],
      blockers: ["human_av_review_invalid_json"],
    };
  }
  const blockers = [];
  const addBlocker = (code) => {
    if (!blockers.includes(code)) blockers.push(code);
  };
  const runId = clean(review.run_id);
  const reviewer = asObject(review.reviewer);
  const reviewerId = clean(reviewer.id);
  const reviewedAt = clean(review.reviewed_at);
  const reviewedArtifacts = asObject(review.reviewed_artifacts || review.reviewed_artefacts);
  const reviewedMp4Hash = normaliseSha256(
    reviewedArtifacts.final_mp4_sha256 || review.reviewed_hashes?.media,
  );
  const reviewedDecodedQaHash = normaliseSha256(reviewedArtifacts.decoded_qa_sha256);
  const contactSheetPath = resolveDeclaredPath(
    reviewedArtifacts.contact_sheet_path || review.artefacts?.contact_sheet,
    path.dirname(reviewPath),
  );
  const declaredContactSheetHash = normaliseSha256(
    reviewedArtifacts.contact_sheet_sha256 || review.reviewed_artefact_fingerprints?.contact_sheet,
  );
  let contactSheetHash = "";

  if (review.schema_version !== 1) addBlocker("human_av_review_schema_version_invalid");
  if (review.complete !== true) addBlocker("human_av_review_complete_flag_missing");
  if (!runId) addBlocker("human_av_review_run_id_missing");
  else if (expectedRunId && runId !== expectedRunId) addBlocker("human_av_review_run_id_mismatch");
  if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) {
    addBlocker("human_av_review_reviewed_at_invalid");
  }
  if (!reviewerId) addBlocker("human_av_review_reviewer_id_missing");
  if (reviewer.human !== true) addBlocker("human_av_review_reviewer_not_human");
  if (reviewer.independent !== true) addBlocker("human_av_review_reviewer_not_independent");
  if (reviewer.registry_verified !== true) {
    addBlocker("human_av_review_reviewer_not_registry_verified");
  }
  if (/\b(?:codex|agent|automated|automation|bot|model|llm)\b/i.test(reviewerId)) {
    addBlocker("human_av_review_reviewer_identity_automated");
  }
  if (clean(review.verdict).toUpperCase() !== "GREEN") {
    addBlocker("human_av_review_declared_verdict_not_green");
  }
  if (!reviewedMp4Hash) addBlocker("human_av_review_final_mp4_sha256_missing");
  else if (reviewedMp4Hash !== finalMp4.sha256) addBlocker("human_av_review_final_mp4_sha256_mismatch");
  if (!reviewedDecodedQaHash) addBlocker("human_av_review_decoded_qa_sha256_missing");
  else if (
    decodedQaCheck.evidence?.sha256 &&
    reviewedDecodedQaHash !== decodedQaCheck.evidence.sha256
  ) {
    addBlocker("human_av_review_decoded_qa_sha256_mismatch");
  }
  if (!contactSheetPath || !(await fs.pathExists(contactSheetPath))) {
    addBlocker("human_av_review_contact_sheet_missing");
  } else {
    contactSheetHash = await sha256File(contactSheetPath);
  }
  if (!declaredContactSheetHash) addBlocker("human_av_review_contact_sheet_sha256_missing");
  else if (contactSheetHash && declaredContactSheetHash !== contactSheetHash) {
    addBlocker("human_av_review_contact_sheet_sha256_mismatch");
  }
  const attestations = asObject(review.attestations);
  for (const key of ["full_watch", "full_listen", "av_sync", "caption_readability", "subject_match"]) {
    if (attestations[key] !== true) addBlocker(`human_av_review_attestation_missing:${key}`);
  }
  if (!Array.isArray(review.defects)) addBlocker("human_av_review_defects_missing");
  else if (review.defects.some((defect) => {
    const severity = clean(defect?.severity || defect?.level).toLowerCase();
    return defect?.blocking === true || severity === "high" || severity === "critical";
  })) {
    addBlocker("human_av_review_blocking_defect_present");
  }
  if (decodedQaCheck.status !== "PASS") addBlocker("human_av_review_decoded_qa_not_verified");

  return {
    id: "human_av_review",
    status: blockers.length ? "BLOCKED" : "PASS",
    evidence_path: reviewPath,
    expected_paths: [reviewPath, contactSheetPath].filter(Boolean),
    blockers,
    evidence: {
      run_id: runId || null,
      reviewer_id: reviewerId || null,
      reviewer_human: reviewer.human === true,
      reviewer_independent: reviewer.independent === true,
      reviewer_registry_verified: reviewer.registry_verified === true,
      reviewed_at: reviewedAt || null,
      reviewed_final_mp4_sha256: reviewedMp4Hash || null,
      reviewed_decoded_qa_sha256: reviewedDecodedQaHash || null,
      contact_sheet_path: contactSheetPath || null,
      contact_sheet_sha256: contactSheetHash || null,
      attestation_complete: blockers.every((blocker) => !blocker.startsWith("human_av_review_attestation_")),
      signoff_generated_by_planner: false,
    },
  };
}

function buildRepairWorkOrder({
  checks,
  candidatePackage,
  candidatePackagePath,
  finalMp4Path,
  artifactDir,
  repairRoot,
  sourceInputPath,
  workspaceRoot,
  generatedAt,
}) {
  const packageId = safeFileToken(candidatePackage.package_id || candidatePackage.format || "release-radar");
  const timestampToken = safeFileToken(generatedAt).slice(0, 32);
  const resolvedRepairRoot = path.resolve(
    repairRoot || path.join(workspaceRoot, "output", "longform-flagship-repair", `${packageId}-${timestampToken}`),
  );
  if (pathContains(artifactDir, resolvedRepairRoot) || pathContains(resolvedRepairRoot, artifactDir)) {
    throw new Error("repairRoot must be disjoint from the inspected production artefact directory");
  }
  const resolvedSourceInput = path.resolve(
    sourceInputPath || path.join(workspaceRoot, "output", "longform-candidate-intake", "release_radar_candidates.json"),
  );
  const monthLabel = clean(candidatePackage.month_label || candidatePackage.monthLabel || "Next Month");
  const stagedPackagePath = path.join(resolvedRepairRoot, "pulse_release_radar_package.json");
  const stagedMp4Path = path.join(resolvedRepairRoot, "pulse_release_radar_longform.mp4");
  const proofDir = path.join(resolvedRepairRoot, "repair-plan-proof");
  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  const validationCommand = [
    "node tools/longform-flagship-repair-plan.js",
    "--candidate-package", quoteCommandArg(stagedPackagePath),
    "--final-mp4", quoteCommandArg(stagedMp4Path),
    "--artifact-dir", quoteCommandArg(resolvedRepairRoot),
    "--output-dir", quoteCommandArg(proofDir),
    "--json",
  ].join(" ");
  const safeCommands = {
    render_same_run_master: {
      purpose: "Render a new >=600s Release Radar master, narration and alignment into disjoint staging.",
      working_directory: workspaceRoot,
      command: [
        "node tools/pulse-release-radar.js",
        "--input", quoteCommandArg(resolvedSourceInput),
        "--out-dir", quoteCommandArg(resolvedRepairRoot),
        "--month", quoteCommandArg(monthLabel),
        "--render-longform",
        "--json",
      ].join(" "),
      expected_paths: [
        stagedPackagePath,
        path.join(resolvedRepairRoot, "longform_script.md"),
        path.join(resolvedRepairRoot, "pulse_release_radar_longform.mp4"),
        path.join(resolvedRepairRoot, "pulse_release_radar.mp3"),
        path.join(resolvedRepairRoot, "pulse_release_radar_audio_manifest.json"),
        path.join(resolvedRepairRoot, "pulse_release_radar_timestamps.json"),
      ],
      safety: "local_render_only_no_publish_flag_disjoint_output",
      completes_flagship_evidence_contract: false,
    },
    probe_staged_master: {
      purpose: "Probe the staged master without changing it.",
      working_directory: workspaceRoot,
      command: `ffprobe -v error -show_entries format=format_name,duration,size,bit_rate:stream=codec_type,codec_name,width,height,duration -of json ${quoteCommandArg(stagedMp4Path)}`,
      expected_paths: [stagedMp4Path],
      safety: "read_only_probe",
      completes_flagship_evidence_contract: false,
    },
    decode_staged_master: {
      purpose: "Decode the full staged video and audio streams without creating media output.",
      working_directory: workspaceRoot,
      command: `ffmpeg -nostdin -v error -xerror -i ${quoteCommandArg(stagedMp4Path)} -map 0:v:0 -map 0:a:0 -f null ${nullSink}`,
      expected_paths: [stagedMp4Path],
      safety: "read_only_full_decode_to_null_sink",
      completes_flagship_evidence_contract: false,
    },
    validate_repair: {
      purpose: "Regenerate this read-only evidence repair plan for the staged run.",
      working_directory: workspaceRoot,
      command: validationCommand,
      expected_paths: [
        path.join(proofDir, "longform_flagship_repair_plan.json"),
        path.join(proofDir, "longform_flagship_repair_plan.md"),
      ],
      safety: "local_proof_only",
      completes_flagship_evidence_contract: false,
    },
  };
  const expectedByCheck = {
    same_run_transcript: [
      path.join(resolvedRepairRoot, "longform_run_manifest.json"),
      path.join(resolvedRepairRoot, "longform_script.md"),
      stagedMp4Path,
    ],
    final_narration: [
      path.join(resolvedRepairRoot, "pulse_release_radar_audio_manifest.json"),
      path.join(resolvedRepairRoot, "pulse_release_radar.mp3"),
    ],
    word_timestamps: [path.join(resolvedRepairRoot, "word_timestamps.json")],
    captions: [
      path.join(resolvedRepairRoot, "caption_manifest.json"),
      path.join(resolvedRepairRoot, "captions.srt"),
    ],
    rights_lineage: [path.join(resolvedRepairRoot, "rights_lineage.json")],
    platform_variants: [path.join(resolvedRepairRoot, "platform_variants.json")],
    decoded_qa: [path.join(resolvedRepairRoot, "decoded_qa_report.json")],
    human_av_review: [
      path.join(resolvedRepairRoot, "final_av_review.json"),
      path.join(resolvedRepairRoot, "contact_sheet.jpg"),
    ],
  };
  const laneByCheck = {
    same_run_transcript: "same_run_transcript_and_master_rerender",
    final_narration: "final_narration_materialisation",
    word_timestamps: "word_level_timestamp_materialisation",
    captions: "longform_caption_materialisation",
    rights_lineage: "asset_rights_lineage_reconciliation",
    platform_variants: "longform_platform_variant_materialisation",
    decoded_qa: "decoded_forensic_qa_materialisation",
    human_av_review: "independent_human_av_review",
  };
  const materializerGapByCheck = {
    same_run_transcript: "governed_longform_run_binding_materializer_missing",
    final_narration: "governed_longform_narration_binding_materializer_missing",
    word_timestamps: "governed_longform_word_timestamp_materializer_missing",
    captions: "governed_longform_caption_materializer_missing",
    rights_lineage: "governed_longform_rights_lineage_materializer_missing",
    platform_variants: "governed_longform_platform_variant_materializer_missing",
    decoded_qa: "governed_longform_decoded_qa_report_materializer_missing",
    human_av_review: "human_review_cannot_be_automated",
  };
  const commandByCheck = {
    same_run_transcript: safeCommands.render_same_run_master.command,
    final_narration: safeCommands.render_same_run_master.command,
    word_timestamps: null,
    captions: null,
    rights_lineage: null,
    platform_variants: null,
    decoded_qa: safeCommands.decode_staged_master.command,
    human_av_review: null,
  };
  const repairActions = REQUIRED_EVIDENCE_CHECKS
    .filter((checkId) => checks[checkId].status !== "PASS")
    .map((checkId, index) => ({
      order: index + 1,
      check_id: checkId,
      blocker_type: checkId,
      blocker_codes: [...checks[checkId].blockers],
      repair_lane: laneByCheck[checkId],
      missing_input: checks[checkId].blockers.join(", "),
      command: commandByCheck[checkId],
      command_available: Boolean(commandByCheck[checkId]),
      command_completes_check: false,
      materializer_gap: materializerGapByCheck[checkId],
      expected_paths: expectedByCheck[checkId],
      production_db_mutation: "forbidden",
      production_artefact_mutation: "forbidden",
      operator_approval_status: checkId === "human_av_review"
        ? "human_action_required"
        : "not_required_for_local_proof",
      human_signoff_may_be_generated: false,
      post_repair_validation_command: validationCommand,
    }));
  return {
    repairWorkspace: resolvedRepairRoot,
    sourceInputPath: resolvedSourceInput,
    safeCommands,
    repairActions,
  };
}

async function inspectFinalMp4(finalMp4Path, options = {}) {
  const resolvedPath = path.resolve(finalMp4Path || "");
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Final MP4 is missing or empty: ${resolvedPath}`);
  const probe = await (options.probeMedia || defaultProbeMedia)(resolvedPath, options);
  const durationSeconds = numberOrNull(probe?.duration_seconds);
  const formatName = clean(probe?.format_name).toLowerCase();
  const width = numberOrNull(probe?.video?.width);
  const height = numberOrNull(probe?.video?.height);
  const videoCodec = clean(probe?.video?.codec).toLowerCase();
  const audioCodec = clean(probe?.audio?.codec).toLowerCase();
  const blockers = [];
  if (probe?.decodable !== true) blockers.push("final_mp4_not_decodable");
  if (!formatName.split(",").some((name) => name === "mp4" || name === "mov")) {
    blockers.push("final_mp4_container_not_mp4");
  }
  if (!(durationSeconds >= LONGFORM_MIN_DURATION_SECONDS)) {
    blockers.push("final_mp4_duration_below_600_seconds");
  }
  if (!(width > height)) blockers.push("final_mp4_not_landscape");
  if (videoCodec !== "h264") blockers.push("final_mp4_video_codec_not_h264");
  if (audioCodec !== "aac") blockers.push("final_mp4_audio_codec_not_aac");
  return {
    path: resolvedPath,
    exists: true,
    size_bytes: stat.size,
    mtime_utc: stat.mtime.toISOString(),
    sha256: await sha256File(resolvedPath),
    duration_seconds: durationSeconds,
    meets_minimum_duration: durationSeconds >= LONGFORM_MIN_DURATION_SECONDS,
    format_name: formatName || null,
    video_codec: videoCodec || null,
    audio_codec: audioCodec || null,
    width,
    height,
    landscape: width > height,
    probed_decodable: probe?.decodable === true,
    meets_flagship_contract: blockers.length === 0,
    blockers,
  };
}

function expectedEvidencePaths(artifactDir) {
  return Object.fromEntries(
    REQUIRED_EVIDENCE_CHECKS.map((checkId) => [
      checkId,
      path.join(artifactDir, DEFAULT_EVIDENCE_FILES[checkId]),
    ]),
  );
}

async function buildLongformFlagshipRepairPlan({
  candidatePackagePath,
  finalMp4Path,
  artifactDir,
  generatedAt = new Date().toISOString(),
  ...options
} = {}) {
  if (!clean(candidatePackagePath)) throw new Error("candidatePackagePath is required");
  if (!clean(finalMp4Path)) throw new Error("finalMp4Path is required");
  const resolvedCandidatePath = path.resolve(candidatePackagePath);
  const candidatePackage = await readJson(resolvedCandidatePath);
  const candidatePackageSha256 = await sha256File(resolvedCandidatePath);
  const finalMp4 = await inspectFinalMp4(finalMp4Path, options);
  const resolvedArtifactDir = path.resolve(artifactDir || path.dirname(finalMp4.path));
  const expectedPaths = expectedEvidencePaths(resolvedArtifactDir);
  const checks = {};

  checks.same_run_transcript = await inspectSameRunTranscript({
    evidencePath: expectedPaths.same_run_transcript,
    artifactDir: resolvedArtifactDir,
    candidatePackage,
    candidatePackagePath: resolvedCandidatePath,
    candidatePackageSha256,
    finalMp4,
  });
  const narration = await inspectFinalNarration({
    evidencePath: expectedPaths.final_narration,
    candidatePackage,
    finalMp4,
    probeAudio: options.probeAudio,
    options,
    transcriptEvidence: checks.same_run_transcript.evidence,
  });
  checks.final_narration = narration.check;
  checks.word_timestamps = await inspectWordTimestamps({
    defaultPath: expectedPaths.word_timestamps,
    narrationManifest: narration.manifest,
    narrationAudio: narration.audio,
    finalMp4,
    expectedRunId: clean(
      checks.same_run_transcript.evidence?.run_id ||
      candidatePackage.production_run_id ||
      candidatePackage.run_id,
    ),
  });
  checks.captions = await inspectCaptions({
    manifestPath: expectedPaths.captions,
    finalMp4,
    expectedRunId: clean(
      checks.same_run_transcript.evidence?.run_id ||
      candidatePackage.production_run_id ||
      candidatePackage.run_id,
    ),
    narrationCheck: checks.final_narration,
    wordTimestampsCheck: checks.word_timestamps,
  });
  const expectedRunId = clean(
    checks.same_run_transcript.evidence?.run_id ||
    candidatePackage.production_run_id ||
    candidatePackage.run_id,
  );
  checks.rights_lineage = await inspectRightsLineage({
    manifestPath: expectedPaths.rights_lineage,
    finalMp4,
    expectedRunId,
  });
  checks.platform_variants = await inspectPlatformVariants({
    manifestPath: expectedPaths.platform_variants,
    finalMp4,
    expectedRunId,
    probeMedia: options.probeMedia,
    options,
  });
  const decodedQaPath = await firstExistingPath([
    expectedPaths.decoded_qa,
    path.join(resolvedArtifactDir, "review", "decoded_forensic_report.json"),
    path.join(resolvedArtifactDir, "review", "forensic_summary.json"),
  ]);
  checks.decoded_qa = await inspectDecodedQa({
    reportPath: decodedQaPath,
    expectedPath: expectedPaths.decoded_qa,
    finalMp4,
    expectedRunId,
  });
  checks.human_av_review = await inspectHumanAvReview({
    reviewPath: expectedPaths.human_av_review,
    finalMp4,
    expectedRunId,
    decodedQaCheck: checks.decoded_qa,
  });

  const blockerCodes = [
    ...finalMp4.blockers,
    ...REQUIRED_EVIDENCE_CHECKS.flatMap((checkId) => checks[checkId].blockers),
  ];
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const workOrder = buildRepairWorkOrder({
    checks,
    candidatePackage,
    candidatePackagePath: resolvedCandidatePath,
    finalMp4Path: finalMp4.path,
    artifactDir: resolvedArtifactDir,
    repairRoot: options.repairRoot,
    sourceInputPath: options.sourceInputPath,
    workspaceRoot,
    generatedAt,
  });
  return {
    schema_version: 1,
    contract_id: CONTRACT_ID,
    report_type: "longform_flagship_evidence_repair_plan",
    generated_at: generatedAt,
    operating_mode: "LOCAL_PROOF",
    status: blockerCodes.length ? "BLOCKED" : "EVIDENCE_COMPLETE_AWAITING_EXTERNAL_GATE",
    verdict: blockerCodes.length ? "NOT_GREEN_BLOCKED" : "NOT_GREEN_EVIDENCE_COMPLETE",
    green_claimed: false,
    publish_authorised: false,
    candidate_package: {
      path: resolvedCandidatePath,
      sha256: candidatePackageSha256,
      package_id: clean(candidatePackage.package_id) || null,
      format: clean(candidatePackage.format) || null,
      generated_at: clean(candidatePackage.generated_at) || null,
      longform_title: clean(asObject(candidatePackage.longform).title) || null,
    },
    final_mp4: finalMp4,
    minimum_duration_seconds: LONGFORM_MIN_DURATION_SECONDS,
    repair_workspace: workOrder.repairWorkspace,
    source_input_path: workOrder.sourceInputPath,
    checks,
    blocker_codes: blockerCodes,
    blockers: blockerCodes.map((code) => ({ code })),
    safe_commands: workOrder.safeCommands,
    repair_actions: workOrder.repairActions,
    safety: {
      no_publish: true,
      publish_authorised: false,
      external_posting_performed: false,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      production_artefacts_mutated: false,
      human_signoff_generated: false,
      gates_weakened: false,
    },
  };
}

function markdownCell(value) {
  return clean(value).replace(/\|/g, "\\|") || "none";
}

function renderLongformFlagshipRepairPlanMarkdown(report = {}) {
  const lines = [
    "# Longform Flagship Evidence Repair Plan",
    "",
    `- Status: ${clean(report.status) || "BLOCKED"}`,
    `- Verdict: ${clean(report.verdict) || "NOT_GREEN_BLOCKED"}`,
    `- Green claimed: ${report.green_claimed === true ? "yes" : "no"}`,
    `- Publish authorised: ${report.publish_authorised === true ? "yes" : "no"}`,
    `- Generated: ${clean(report.generated_at) || "unknown"}`,
    `- Candidate package: ${clean(report.candidate_package?.path) || "missing"}`,
    `- Final MP4: ${clean(report.final_mp4?.path) || "missing"}`,
    `- Repair workspace: ${clean(report.repair_workspace) || "missing"}`,
    "",
    "## Final MP4",
    "",
    `- Duration: ${numberOrNull(report.final_mp4?.duration_seconds) ?? "missing"}s`,
    `- Minimum duration: ${numberOrNull(report.minimum_duration_seconds) ?? LONGFORM_MIN_DURATION_SECONDS}s`,
    `- Geometry: ${report.final_mp4?.width || "?"}x${report.final_mp4?.height || "?"}`,
    `- Codecs: ${clean(report.final_mp4?.video_codec) || "missing"}/${clean(report.final_mp4?.audio_codec) || "missing"}`,
    `- SHA-256: ${clean(report.final_mp4?.sha256) || "missing"}`,
    `- Master contract met: ${report.final_mp4?.meets_flagship_contract === true ? "yes" : "no"}`,
    "",
    "## Evidence Checks",
    "",
    "| Check | Status | Evidence | Blockers |",
    "| --- | --- | --- | --- |",
  ];
  for (const checkId of REQUIRED_EVIDENCE_CHECKS) {
    const check = asObject(report.checks?.[checkId]);
    lines.push(
      `| ${checkId} | ${markdownCell(check.status || "BLOCKED")} | ${markdownCell(check.evidence_path || "missing")} | ${markdownCell(asArray(check.blockers).join(", "))} |`,
    );
  }
  lines.push("", "## Repair Actions", "");
  if (!asArray(report.repair_actions).length) {
    lines.push("- No machine-evidence repair action is currently listed. External gates still apply.");
  }
  for (const action of asArray(report.repair_actions)) {
    lines.push(`### ${action.order}. ${clean(action.check_id)}`);
    lines.push("");
    lines.push(`- Repair lane: ${clean(action.repair_lane)}`);
    lines.push(`- Blockers: ${asArray(action.blocker_codes).join(", ")}`);
    lines.push(`- Missing input: ${clean(action.missing_input)}`);
    lines.push(`- Materialiser gap: ${clean(action.materializer_gap)}`);
    lines.push(`- Operator approval: ${clean(action.operator_approval_status)}`);
    lines.push("- Expected paths:");
    for (const expectedPath of asArray(action.expected_paths)) lines.push(`  - \`${expectedPath}\``);
    if (action.command) {
      lines.push("- Safe precursor command:", "", "```powershell", action.command, "```");
    } else {
      lines.push("- Safe automated repair command: unavailable; do not fabricate the missing evidence.");
    }
    lines.push("- Post-repair validation:", "", "```powershell", clean(action.post_repair_validation_command), "```", "");
  }
  lines.push("## Safe Commands", "");
  for (const [commandId, command] of Object.entries(asObject(report.safe_commands))) {
    lines.push(`### ${commandId}`);
    lines.push("");
    lines.push(clean(command.purpose));
    lines.push("", "```powershell", clean(command.command), "```", "");
  }
  lines.push(
    "## Safety",
    "",
    `- Human signoff generated: ${report.safety?.human_signoff_generated === true ? "yes" : "no"}`,
    `- Production database mutated: ${report.safety?.production_db_mutated === true ? "yes" : "no"}`,
    `- OAuth or tokens mutated: ${report.safety?.oauth_or_token_mutated === true ? "yes" : "no"}`,
    `- Existing production artefacts mutated: ${report.safety?.production_artefacts_mutated === true ? "yes" : "no"}`,
    "- This proof cannot publish, grant control-tower authority or create a human review decision.",
    "",
  );
  return lines.join("\n");
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.outputFile(temporaryPath, contents, "utf8");
  try {
    await fs.move(temporaryPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(temporaryPath);
  }
}

async function writeLongformFlagshipRepairPlan(report = {}, { outputDir } = {}) {
  if (report.contract_id !== CONTRACT_ID || report.report_type !== "longform_flagship_evidence_repair_plan") {
    throw new Error("writeLongformFlagshipRepairPlan requires an evaluated repair plan");
  }
  if (!clean(outputDir)) throw new Error("writeLongformFlagshipRepairPlan requires outputDir");
  const resolvedOutputDir = path.resolve(outputDir);
  const sourceArtifactDir = path.dirname(path.resolve(report.final_mp4?.path || ""));
  if (
    pathContains(sourceArtifactDir, resolvedOutputDir) ||
    pathContains(resolvedOutputDir, sourceArtifactDir)
  ) {
    throw new Error("Repair proof output must stay outside the inspected production artefact directory");
  }
  const safeReport = {
    ...report,
    green_claimed: false,
    publish_authorised: false,
    safety: {
      ...asObject(report.safety),
      no_publish: true,
      publish_authorised: false,
      external_posting_performed: false,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      production_artefacts_mutated: false,
      human_signoff_generated: false,
      gates_weakened: false,
    },
  };
  await fs.ensureDir(resolvedOutputDir);
  const jsonPath = path.join(resolvedOutputDir, "longform_flagship_repair_plan.json");
  const markdownPath = path.join(resolvedOutputDir, "longform_flagship_repair_plan.md");
  await atomicWrite(jsonPath, `${JSON.stringify(safeReport, null, 2)}\n`);
  await atomicWrite(markdownPath, renderLongformFlagshipRepairPlanMarkdown(safeReport));
  return { outputDir: resolvedOutputDir, jsonPath, markdownPath, report: safeReport };
}

module.exports = {
  CONTRACT_ID,
  LONGFORM_MIN_DURATION_SECONDS,
  REQUIRED_EVIDENCE_CHECKS,
  buildLongformFlagshipRepairPlan,
  defaultProbeMedia,
  renderLongformFlagshipRepairPlanMarkdown,
  writeLongformFlagshipRepairPlan,
};
