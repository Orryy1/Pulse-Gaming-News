#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { alignWordsWithLocalWhisper } = require("../lib/local-whisper-word-aligner");
const {
  alignFrameWithBoundedRepair,
  parseNarrationFrames,
  reconcileAlignedAudioMetadata,
} = require("../lib/services/system-trace-display-audio-alignment");

const REPO_ROOT = path.resolve(__dirname, "..");
const PROJECTS = Object.freeze([
  "system-trace-screen-tearing",
  "system-trace-vsync-latency",
  "system-trace-variable-refresh-rate",
  "system-trace-hdr-tone-mapping",
  "system-trace-anti-aliasing",
  "system-trace-motion-blur",
  "system-trace-frame-generation",
]);

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function stageJson(target, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const staging = `${target}.staging-${process.pid}-${Date.now()}`;
  await fs.writeFile(staging, bytes, { flag: "wx" });
  return { target, staging, bytes, sha256: sha256(bytes) };
}

async function runCampaign({
  repoRoot = REPO_ROOT,
  aligner = alignWordsWithLocalWhisper,
  generatedAt = new Date().toISOString(),
} = {}) {
  const pendingDocuments = [];
  const episodes = [];
  for (const storyId of PROJECTS) {
    const projectDir = path.join(repoRoot, "videos", storyId);
    const scriptPath = path.join(projectDir, "SCRIPT.md");
    const audioMetaPath = path.join(projectDir, "audio_meta.json");
    const scriptFrames = parseNarrationFrames(await fs.readFile(scriptPath, "utf8"));
    const audioMeta = await readJson(audioMetaPath);
    const alignments = new Map();
    for (const script of scriptFrames) {
      const voice = audioMeta.voices?.find((entry) => Number(entry.frame) === script.frame);
      if (!voice?.path) throw new Error(`voice_path_required:${storyId}:${script.frame}`);
      const audioPath = path.resolve(projectDir, voice.path);
      const result = await alignFrameWithBoundedRepair({
        aligner,
        audioPath,
        scriptText: script.text,
      });
      alignments.set(script.frame, result);
    }
    const reconciled = reconcileAlignedAudioMetadata({
      storyId,
      audioMeta,
      scriptFrames,
      alignments,
    });
    const evidence = { ...reconciled.evidence, generated_at: generatedAt };
    const audioMetaBytes = Buffer.from(`${JSON.stringify(reconciled.audioMeta, null, 2)}\n`);
    const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
    pendingDocuments.push({ target: audioMetaPath, value: reconciled.audioMeta });
    pendingDocuments.push({
      target: path.join(projectDir, "audio_alignment_report.json"),
      value: evidence,
    });
    episodes.push({
      story_id: storyId,
      verdict: "GREEN",
      frame_count: evidence.frame_count,
      audio_meta_sha256: sha256(audioMetaBytes),
      alignment_report_sha256: sha256(evidenceBytes),
    });
  }
  const report = {
    schema_version: 1,
    schema: "pulse_system_trace_display_pipeline_audio_alignment_v1",
    generated_at: generatedAt,
    verdict: "GREEN",
    episode_count: episodes.length,
    frame_count: episodes.reduce((sum, episode) => sum + episode.frame_count, 0),
    alignment_source: "local_whisper_word_alignment",
    alignment_model: "faster-whisper:base.en with one bounded small.en repair",
    remote_requests: 0,
    database_mutations: 0,
    blockers: [],
    episodes,
  };
  const campaignTarget = path.join(
    repoRoot,
    "videos",
    "system-trace-display-pipeline-audio-alignment.json",
  );
  pendingDocuments.push({ target: campaignTarget, value: report });
  const pendingWrites = [];
  try {
    for (const entry of pendingDocuments) {
      pendingWrites.push(await stageJson(entry.target, entry.value));
    }
    for (const entry of pendingWrites) {
      await fs.rename(entry.staging, entry.target);
    }
  } catch (error) {
    await Promise.all(pendingWrites.map((entry) => fs.rm(entry.staging, { force: true })));
    throw error;
  }
  return report;
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const write = deps.write || ((value) => process.stdout.write(`${value}\n`));
  if (argv.length !== 1 || argv[0] !== "--apply") {
    write("Usage: node tools/system-trace-display-audio-align.js --apply");
    return 64;
  }
  const report = await (deps.run || runCampaign)();
  write(JSON.stringify(report));
  return report.verdict === "GREEN" ? 0 : 2;
}

if (require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${error.stack || error.message || error}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = { PROJECTS, main, runCampaign };
