#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { alignWordsWithLocalWhisper } = require("../lib/local-whisper-word-aligner");

const DEFAULT_MODEL = "faster-whisper:small.en";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractFrameVoiceovers(storyboard = "") {
  const result = {};
  const sections = String(storyboard).split(/^## Frame\s+/m).slice(1);
  for (const section of sections) {
    const frameMatch = section.match(/^(\d+)\b/);
    const voiceMatch = section.match(/^- voiceover:\s*"([\s\S]*?)"\s*$/m);
    if (!frameMatch || !voiceMatch) continue;
    result[Number(frameMatch[1])] = cleanText(voiceMatch[1]);
  }
  return result;
}

function usableWords(words) {
  return Array.isArray(words) && words.length > 0 && words.every((word) => {
    const text = cleanText(word?.word || word?.text);
    const start = Number(word?.start);
    const end = Number(word?.end);
    return text && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start;
  });
}

async function alignHyperframesAudioMeta({
  projectRoot,
  model = DEFAULT_MODEL,
  device = process.env.LOCAL_WHISPER_DEVICE || "cuda",
  aligner = alignWordsWithLocalWhisper,
} = {}) {
  const root = path.resolve(projectRoot || ".");
  const audioMetaPath = path.join(root, "audio_meta.json");
  const storyboardPath = path.join(root, "STORYBOARD.md");
  const [rawMeta, storyboard] = await Promise.all([
    fs.readFile(audioMetaPath, "utf8"),
    fs.readFile(storyboardPath, "utf8"),
  ]);
  const meta = JSON.parse(rawMeta);
  const voiceovers = extractFrameVoiceovers(storyboard);
  const voices = Array.isArray(meta.voices) ? meta.voices : [];
  if (!voices.length) throw new Error("audio_meta_voices_missing");

  const alignedVoices = [];
  for (const voice of voices) {
    const frame = Number(voice.frame);
    const scriptText = voiceovers[frame];
    if (!scriptText) throw new Error(`frame_${frame}_voiceover_missing`);
    const audioPath = path.resolve(root, voice.path || "");
    const relative = path.relative(root, audioPath);
    if (!voice.path || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`frame_${frame}_audio_path_outside_project`);
    }
    await fs.access(audioPath);
    const aligned = usableWords(voice.words)
      ? {
          ok: true,
          words: voice.words,
          source: voice.alignment?.source,
          model: voice.alignment?.model,
          backend: voice.alignment?.backend,
          language: voice.alignment?.language,
          transcript: voice.alignment?.transcript,
        }
      : await aligner({ audioPath, scriptText, model, device });
    if (!aligned?.ok || !usableWords(aligned.words)) {
      throw new Error(`frame_${frame}_alignment_failed:${cleanText(aligned?.error) || "word_timestamps_missing"}`);
    }
    alignedVoices.push({
      ...voice,
      words: aligned.words.map((word) => ({
        text: cleanText(word.word || word.text),
        word: cleanText(word.word || word.text),
        start: Number(Number(word.start).toFixed(3)),
        end: Number(Number(word.end).toFixed(3)),
      })),
      alignment: {
        source: aligned.source || "local_whisper_word_alignment",
        model: aligned.model || model,
        backend: aligned.backend || null,
        language: aligned.language || "en",
        transcript: cleanText(aligned.transcript),
      },
    });
  }

  const next = { ...meta, voices: alignedVoices };
  const temporaryPath = `${audioMetaPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporaryPath, audioMetaPath);
  return {
    ok: true,
    project_root: root,
    model,
    aligned_voice_count: alignedVoices.length,
    aligned_word_count: alignedVoices.reduce((sum, voice) => sum + voice.words.length, 0),
  };
}

function parseArgs(argv) {
  const args = { projectRoot: ".", model: DEFAULT_MODEL };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--project-root") args.projectRoot = argv[++index];
    else if (token === "--model") args.model = argv[++index];
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`unknown_argument:${token}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node tools/hyperframes-align-audio-meta.js --project-root <dir> [--model faster-whisper:small.en]\n");
    return;
  }
  const report = await alignHyperframesAudioMeta(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MODEL,
  alignHyperframesAudioMeta,
  extractFrameVoiceovers,
  parseArgs,
};
