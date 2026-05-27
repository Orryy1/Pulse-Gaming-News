"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SCRIPT = path.join(ROOT, "tools", "local_whisper_word_align.py");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function usableWord(word = {}) {
  const text = cleanText(word.word || word.text);
  const start = Number(word.start);
  const end = Number(word.end);
  return text && Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

function normaliseWhisperWords(result = {}) {
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const words = [];
  for (const segment of segments) {
    const segmentWords = Array.isArray(segment?.words) ? segment.words : [];
    if (segmentWords.length) {
      for (const word of segmentWords) {
        if (!usableWord(word)) continue;
        words.push({
          word: cleanText(word.word || word.text),
          start: Number(Number(word.start).toFixed(3)),
          end: Number(Number(word.end).toFixed(3)),
        });
      }
      continue;
    }
    const tokens = cleanText(segment?.text).match(/\S+/g) || [];
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!tokens.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const step = (end - start) / tokens.length;
    tokens.forEach((token, index) => {
      const wordStart = start + step * index;
      const wordEnd = index === tokens.length - 1 ? end : start + step * (index + 1);
      words.push({
        word: token,
        start: Number(wordStart.toFixed(3)),
        end: Number(wordEnd.toFixed(3)),
      });
    });
  }
  return words.filter(usableWord);
}

function parseWhisperJson(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function alignWordsWithLocalWhisper({
  audioPath,
  scriptText = "",
  model = process.env.LOCAL_WHISPER_MODEL || "tiny.en",
  python = process.env.PYTHON || "python",
  scriptPath = DEFAULT_SCRIPT,
  timeoutMs = Number(process.env.LOCAL_WHISPER_TIMEOUT_MS || 900000),
  execFileImpl = execFileAsync,
} = {}) {
  if (!audioPath) {
    return { ok: false, error: "audio_path_missing" };
  }
  const args = [
    scriptPath,
    "--audio",
    audioPath,
    "--model",
    model,
  ];
  const prompt = cleanText(scriptText);
  if (prompt) args.push("--prompt", prompt);
  try {
    const result = await execFileImpl(python, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 12,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
      },
    });
    const parsed = parseWhisperJson(result.stdout);
    const words = normaliseWhisperWords(parsed);
    if (!words.length) {
      return {
        ok: false,
        error: "whisper_word_timestamps_missing",
        transcript: cleanText(parsed?.text),
      };
    }
    return {
      ok: true,
      source: "local_whisper_word_alignment",
      model: parsed?.model || model,
      words,
      transcript: cleanText(parsed?.text),
      language: parsed?.language || null,
      segments: Array.isArray(parsed?.segments) ? parsed.segments.length : 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: cleanText(error.message) || "whisper_alignment_failed",
      stderr: cleanText(error.stderr).slice(0, 1000),
    };
  }
}

module.exports = {
  alignWordsWithLocalWhisper,
  normaliseWhisperWords,
  parseWhisperJson,
};
