"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const mediaPaths = require("./media-paths");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeId(value) {
  return cleanText(value)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function normalisePath(value) {
  return String(value || "").replace(/\\/g, path.sep);
}

async function readJsonIfPresent(filePath, fallback = null) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function relativeOutputPath(filePath) {
  const text = String(filePath || "");
  const match = text.match(/[\\/]output[\\/].+$/i);
  if (!match) return null;
  return match[0].replace(/^[\\/]/, "").replace(/\\/g, "/");
}

async function resolveExistingMediaPath(filePath, { workspaceRoot } = {}) {
  const raw = cleanText(filePath);
  if (!raw) return null;
  const normalised = normalisePath(raw);
  const rel = relativeOutputPath(normalised);
  if (rel) {
    const mediaRootPath = await mediaPaths.resolveExisting(rel).catch(() => null);
    if (mediaRootPath && (await fs.pathExists(mediaRootPath))) return mediaRootPath;
  }
  if (path.isAbsolute(normalised)) return path.resolve(normalised);
  const workspacePath = path.resolve(workspaceRoot || process.cwd(), normalised);
  if (await fs.pathExists(workspacePath)) return workspacePath;
  if (rel) return path.resolve(workspaceRoot || process.cwd(), rel);
  return workspacePath;
}

function defaultAudioPath(storyId) {
  return `output/audio/${safeId(storyId)}.mp3`;
}

function defaultTimestampPath(storyId) {
  return `output/audio/${safeId(storyId)}_timestamps.json`;
}

function validWord(word = {}) {
  return (
    cleanText(word.word || word.text) !== "" &&
    Number.isFinite(Number(word.start)) &&
    Number.isFinite(Number(word.end)) &&
    Number(word.end) >= Number(word.start)
  );
}

function extractWords(payload = {}) {
  if (Array.isArray(payload)) return payload.filter(validWord);
  if (Array.isArray(payload?.words)) return payload.words.filter(validWord);
  return [];
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildCaptionChunks(words = [], { maxWords = 8, maxDurationS = 3.2 } = {}) {
  const chunks = [];
  let current = [];
  for (const word of words) {
    const next = [...current, word];
    const first = next[0];
    const last = next[next.length - 1];
    const tooManyWords = next.length > maxWords;
    const tooLong = Number(last.end) - Number(first.start) > maxDurationS;
    if (current.length && (tooManyWords || tooLong)) {
      chunks.push(current);
      current = [word];
    } else {
      current = next;
    }
  }
  if (current.length) chunks.push(current);
  return chunks.map((chunk) => ({
    start: Number(chunk[0].start),
    end: Number(chunk[chunk.length - 1].end),
    text: chunk.map((word) => cleanText(word.word || word.text)).join(" "),
    word_count: chunk.length,
  }));
}

function renderSrt(chunks = []) {
  return chunks
    .map((chunk, index) => [
      String(index + 1),
      `${formatSrtTime(chunk.start)} --> ${formatSrtTime(chunk.end)}`,
      chunk.text,
      "",
    ].join("\n"))
    .join("\n");
}

function transcriptFromCanonical(canonical = {}, words = []) {
  return cleanText(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.first_spoken_line ||
      words.map((word) => cleanText(word.word || word.text)).join(" "),
  );
}

function wordCount(text) {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function parityWarning(transcript = "", words = []) {
  const transcriptCount = wordCount(transcript);
  if (!transcriptCount || !words.length) return "transcript_or_word_timestamps_missing";
  const ratio = words.length / transcriptCount;
  if (ratio < 0.55 || ratio > 1.45) return "transcript_word_count_drift";
  return null;
}

async function inspectAudio(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) {
    return { path: filePath || null, exists: false, usable: false, size_bytes: 0 };
  }
  const stat = await fs.stat(filePath);
  return {
    path: path.resolve(filePath),
    exists: true,
    usable: stat.isFile() && stat.size >= 1024,
    size_bytes: stat.size,
    mtime_ms: stat.mtimeMs,
  };
}

async function writeReadyStoryProof({
  storyId,
  artifactDir,
  outputDir,
  canonical,
  audio,
  timestampPath,
  words,
  generatedAt,
  localTts,
  provider,
} = {}) {
  const transcriptDir = path.join(outputDir, "transcripts");
  const captionDir = path.join(outputDir, "captions");
  await fs.ensureDir(transcriptDir);
  await fs.ensureDir(captionDir);

  const id = safeId(storyId);
  const transcript = transcriptFromCanonical(canonical, words);
  const chunks = buildCaptionChunks(words);
  const transcriptPath = path.join(transcriptDir, `${id}.txt`);
  const srtPath = path.join(captionDir, `${id}.srt`);
  await fs.writeFile(transcriptPath, `${transcript}\n`, "utf8");
  await fs.writeFile(srtPath, renderSrt(chunks), "utf8");

  const warning = parityWarning(transcript, words);
  const voiceQualityReport = {
    story_id: storyId,
    generated_at: generatedAt,
    verdict: audio.usable && words.length > 0 && chunks.length > 0 ? "PASS" : "FAIL",
    checks: {
      narration_audio_present: audio.exists === true,
      narration_audio_usable: audio.usable === true,
      word_timestamps_present: words.length > 0,
      captions_well_formed: chunks.length > 0 && chunks.every((chunk) => chunk.end >= chunk.start && cleanText(chunk.text)),
      transcript_available: transcript.length > 0,
    },
    warnings: warning ? [warning] : [],
    audio_size_bytes: audio.size_bytes || 0,
    word_timestamp_count: words.length,
    caption_chunk_count: chunks.length,
  };
  const ttsDoctorReport = {
    story_id: storyId,
    generated_at: generatedAt,
    provider: provider || "existing",
    local_tts: {
      verdict: localTts?.verdict || "unknown",
      ready: localTts?.ready === true,
      failure_code: localTts?.failure_code || null,
      stale: localTts?.stale === true,
      unreachable: localTts?.unreachable === true,
      reason: localTts?.reason || null,
    },
    secret_values_exposed: false,
  };
  const captionManifest = {
    story_id: storyId,
    generated_at: generatedAt,
    transcript_path: transcriptPath,
    caption_srt_path: srtPath,
    word_timestamps_path: timestampPath,
    caption_chunk_count: chunks.length,
    word_timestamp_count: words.length,
    platform_caption_files: {
      youtube: srtPath,
      tiktok: srtPath,
      instagram: srtPath,
      facebook: srtPath,
      x: srtPath,
    },
  };

  if (artifactDir && await fs.pathExists(artifactDir)) {
    await fs.writeJson(path.join(artifactDir, "caption_manifest.json"), captionManifest, { spaces: 2 });
    await fs.writeJson(path.join(artifactDir, "voice_quality_report.json"), voiceQualityReport, { spaces: 2 });
    await fs.writeJson(path.join(artifactDir, "tts_doctor_report.json"), ttsDoctorReport, { spaces: 2 });
  }

  return {
    transcript,
    transcriptPath,
    srtPath,
    captionManifest,
    voiceQualityReport,
    ttsDoctorReport,
  };
}

function blockedReasonForJob(job = {}, { localTts = {} } = {}) {
  const blockers = [];
  for (const missing of asArray(job.missing)) {
    if (missing === "narration_audio") blockers.push("narration_audio_missing");
    if (missing === "word_timestamps") blockers.push("word_timestamps_missing");
  }
  const status = cleanText(job.status);
  if (status.startsWith("blocked_local_tts") || localTts.ready === false && localTts.verdict === "red") {
    blockers.push("tts_unavailable");
  }
  if (status === "failed" && job.error) blockers.push(`tts_generation_failed:${job.error}`);
  return [...new Set(blockers.length ? blockers : [status || "not_ready"])];
}

async function inspectStory(job = {}, options = {}) {
  const storyId = cleanText(job.story_id);
  const artifactDir = job.artifact_dir ? path.resolve(job.artifact_dir) : null;
  const canonical = await readJsonIfPresent(
    artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : null,
    {},
  );
  const readyishStatuses = new Set([
    "ready_audio_timestamp_pair",
    "materialized",
    "materialized_existing_pair",
    "skipped_existing_ready_pair",
  ]);
  if (!readyishStatuses.has(cleanText(job.status))) {
    return {
      story_id: storyId,
      title: cleanText(job.title || canonical.selected_title),
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: blockedReasonForJob(job, { localTts: options.localTts }),
      proof: {
        transcript_exists: false,
        srt_exists: false,
      },
    };
  }

  const audioPath = await resolveExistingMediaPath(
    job.audio?.path || job.audio_path || defaultAudioPath(storyId),
    { workspaceRoot: options.workspaceRoot },
  );
  const timestampPath = await resolveExistingMediaPath(
    job.timestamps?.path || job.word_timestamps_path || defaultTimestampPath(storyId),
    { workspaceRoot: options.workspaceRoot },
  );
  const audio = await inspectAudio(audioPath);
  const timestampPayload = await readJsonIfPresent(timestampPath, null);
  const words = extractWords(timestampPayload);
  const blockers = [];
  if (!audio.usable) blockers.push("narration_audio_missing_or_unusable");
  if (!words.length) blockers.push("word_timestamps_missing_or_malformed");
  if (blockers.length) {
    return {
      story_id: storyId,
      title: cleanText(job.title || canonical.selected_title),
      artifact_dir: artifactDir,
      status: "blocked",
      blockers,
      audio,
      word_timestamps_path: timestampPath,
      proof: {
        transcript_exists: false,
        srt_exists: false,
      },
    };
  }

  const proof = await writeReadyStoryProof({
    storyId,
    artifactDir,
    outputDir: options.outputDir,
    canonical,
    audio,
    timestampPath,
    words,
    generatedAt: options.generatedAt,
    localTts: options.localTts,
    provider: job.provider || job.tts_provider || canonical.voice_provider || "existing",
  });

  return {
    story_id: storyId,
    title: cleanText(job.title || canonical.selected_title),
    artifact_dir: artifactDir,
    status: "ready",
    blockers: [],
    final_narration_audio_path: audio.path,
    word_timestamps_path: timestampPath,
    transcript_path: proof.transcriptPath,
    caption_srt_path: proof.srtPath,
    caption_manifest: proof.captionManifest,
    voice_quality_report: proof.voiceQualityReport,
    tts_doctor_report: proof.ttsDoctorReport,
    proof: {
      transcript_exists: await fs.pathExists(proof.transcriptPath),
      srt_exists: await fs.pathExists(proof.srtPath),
      audio_usable: audio.usable,
      word_timestamp_count: words.length,
    },
  };
}

async function buildGoal05NarrationReadiness({
  workbenchReport = {},
  materializationReport = null,
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal05NarrationReadiness requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const localTts = workbenchReport.local_tts || materializationReport?.local_tts || {};
  const workbenchJobs = asArray(workbenchReport.jobs);
  const materializedJobs = asArray(materializationReport?.jobs);
  const workbenchByStory = new Map(
    workbenchJobs
      .map((job) => [cleanText(job.story_id), job])
      .filter(([storyId]) => storyId),
  );
  const jobs = materializedJobs.length
    ? materializedJobs.map((job) => {
      const workbenchJob = workbenchByStory.get(cleanText(job.story_id)) || {};
      return { ...workbenchJob, ...job };
    })
    : workbenchJobs;
  const stories = [];
  for (const job of jobs) {
    stories.push(await inspectStory(job, {
      workspaceRoot: path.resolve(workspaceRoot),
      outputDir: outDir,
      generatedAt,
      localTts,
    }));
  }
  const ready = stories.filter((story) => story.status === "ready");
  const blocked = stories.filter((story) => story.status === "blocked");
  const ttsBlocked = blocked.filter((story) => story.blockers.includes("tts_unavailable"));
  const verdict = blocked.length ? "PARTIAL" : stories.length ? "PASS" : "FAIL";
  return {
    schema_version: 1,
    goal: "05_narration_transcript_word_timestamps",
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    summary: {
      story_count: stories.length,
      ready_story_count: ready.length,
      blocked_story_count: blocked.length,
      tts_blocked_story_count: ttsBlocked.length,
      transcript_count: ready.length,
      caption_srt_count: ready.length,
      voice_quality_report_count: ready.length,
    },
    upstream_blockers: {
      goal04_owned_motion_materialiser_blocked: true,
      note: "Goal 05 proof is limited to narration, transcript, timestamp and caption readiness. It does not override motion, rights, render or publish gates.",
    },
    local_tts: {
      verdict: localTts.verdict || "unknown",
      ready: localTts.ready === true,
      failure_code: localTts.failure_code || null,
      reason: localTts.reason || null,
    },
    stories,
    safety: {
      no_tts_generation_triggered: true,
      no_publish_triggered: true,
      no_platform_uploads: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function renderGoal05NarrationReadinessMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 05 Narration Readiness");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Ready: ${report.summary?.ready_story_count || 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_story_count || 0}`);
  lines.push("");
  lines.push("## Stories");
  for (const story of asArray(report.stories)) {
    const blockerText = story.blockers?.length ? `; blockers: ${story.blockers.join(", ")}` : "";
    lines.push(`- ${story.story_id}: ${story.status}${blockerText}`);
  }
  if (!asArray(report.stories).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local proof only. This gate did not trigger TTS generation, publishing, platform upload, database mutation, OAuth or token changes.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal05NarrationReadiness(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal05NarrationReadiness requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal05_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal05_readiness_report.md");
  const narrationManifest = path.join(outDir, "final_narration_manifest.json");
  const transcriptManifest = path.join(outDir, "transcript_manifest.json");
  const captionManifest = path.join(outDir, "caption_manifest.json");
  const voiceQualityReport = path.join(outDir, "voice_quality_report.json");
  const ttsDoctorReport = path.join(outDir, "tts_doctor_report.json");
  const blockedReasons = path.join(outDir, "blocked_narration_reasons.json");

  const readyStories = asArray(report.stories).filter((story) => story.status === "ready");
  const blockedStories = asArray(report.stories).filter((story) => story.status === "blocked");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal05NarrationReadinessMarkdown(report), "utf8");
  await fs.writeJson(narrationManifest, {
    schema_version: 1,
    generated_at: report.generated_at || null,
    stories: readyStories.map((story) => ({
      story_id: story.story_id,
      final_narration_audio_path: story.final_narration_audio_path,
      word_timestamps_path: story.word_timestamps_path,
      transcript_path: story.transcript_path,
    })),
  }, { spaces: 2 });
  await fs.writeJson(transcriptManifest, {
    schema_version: 1,
    generated_at: report.generated_at || null,
    stories: readyStories.map((story) => ({
      story_id: story.story_id,
      transcript_path: story.transcript_path,
    })),
  }, { spaces: 2 });
  await fs.writeJson(captionManifest, {
    schema_version: 1,
    generated_at: report.generated_at || null,
    stories: readyStories.map((story) => story.caption_manifest),
  }, { spaces: 2 });
  await fs.writeJson(voiceQualityReport, {
    schema_version: 1,
    generated_at: report.generated_at || null,
    stories: readyStories.map((story) => story.voice_quality_report),
  }, { spaces: 2 });
  await fs.writeJson(ttsDoctorReport, {
    schema_version: 1,
    generated_at: report.generated_at || null,
    stories: readyStories.map((story) => story.tts_doctor_report),
    local_tts: report.local_tts || null,
    secret_values_exposed: false,
  }, { spaces: 2 });
  await fs.writeJson(blockedReasons, {
    schema_version: 1,
    generated_at: report.generated_at || null,
    stories: blockedStories.map((story) => ({
      story_id: story.story_id,
      blockers: story.blockers || [],
    })),
  }, { spaces: 2 });

  return {
    readinessJson,
    readinessMarkdown,
    narrationManifest,
    transcriptManifest,
    captionManifest,
    voiceQualityReport,
    ttsDoctorReport,
    blockedReasons,
  };
}

module.exports = {
  buildCaptionChunks,
  buildGoal05NarrationReadiness,
  formatSrtTime,
  renderGoal05NarrationReadinessMarkdown,
  renderSrt,
  writeGoal05NarrationReadiness,
};
