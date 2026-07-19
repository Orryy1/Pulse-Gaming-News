"use strict";

const path = require("node:path");
const { execFile, execFileSync, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("fs-extra");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SCRIPT = path.join(ROOT, "tools", "local_whisper_word_align.py");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseWhisperModelSpec(value = "") {
  const spec = cleanText(value) || "tiny.en";
  const fasterWhisperMatch = spec.match(/^faster-whisper:(.+)$/i);
  if (fasterWhisperMatch) {
    const model = cleanText(fasterWhisperMatch[1]);
    return {
      backend: "faster-whisper",
      model: model || "base.en",
      spec: `faster-whisper:${model || "base.en"}`,
    };
  }
  return {
    backend: "openai-whisper",
    model: spec,
    spec,
  };
}

function powershellLiteral(value = "") {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsWhisperBoundary({ python, args }) {
  const command = `& ${[python, ...args].map(powershellLiteral).join(" ")}`;
  return {
    executable: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
  };
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
  promptText = "",
  model = process.env.LOCAL_WHISPER_MODEL || "tiny.en",
  // The Windows host ships a CUDA-enabled Whisper/Torch stack. Prefer the
  // available GPU and retain the existing one-shot CPU fallback below for
  // transient VRAM or driver failures. LOCAL_WHISPER_DEVICE remains the
  // explicit operator override.
  device = process.env.LOCAL_WHISPER_DEVICE || (process.platform === "win32" ? "cuda" : ""),
  python = process.env.PYTHON || "python",
  scriptPath = DEFAULT_SCRIPT,
  timeoutMs = Number(process.env.LOCAL_WHISPER_TIMEOUT_MS || 900000),
  useScriptPrompt = /^(true|1|yes|on)$/i.test(
    String(process.env.LOCAL_WHISPER_USE_SCRIPT_PROMPT || ""),
  ),
  useSyncExec = /^(true|1|yes|on)$/i.test(
    String(process.env.LOCAL_WHISPER_SYNC_EXEC || ""),
  ),
  execFileImpl = execFileAsync,
  execFileSyncImpl = execFileSync,
  spawnImpl = spawn,
  useOutputFileSpawn = execFileImpl === execFileAsync,
  allowCpuFallback = true,
  useWindowsPowerShellBoundary = process.platform === "win32" && spawnImpl === spawn,
} = {}) {
  if (!audioPath) {
    return { ok: false, error: "audio_path_missing" };
  }
  const modelSpec = parseWhisperModelSpec(model);
  const args = [
    scriptPath,
    "--audio",
    audioPath,
    "--model",
    modelSpec.model,
  ];
  if (modelSpec.backend === "faster-whisper") {
    args.push("--backend", modelSpec.backend);
  }
  const selectedDevice = cleanText(device);
  if (selectedDevice) args.push("--device", selectedDevice);
  const prompt = cleanText(promptText) || cleanText(scriptText);
  if (prompt && useScriptPrompt) args.push("--prompt", prompt);
  const outputPath = `${audioPath}.whisper-align-${process.pid}-${Date.now()}.json`;
  args.push("--output", outputPath);
  const resultFromPayload = (parsed) => {
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
      model: parsed?.model || modelSpec.spec,
      backend: parsed?.backend || modelSpec.backend,
      words,
      transcript: cleanText(parsed?.text),
      language: parsed?.language || null,
      segments: Array.isArray(parsed?.segments) ? parsed.segments.length : 0,
    };
  };
  try {
    const executionOptions = {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 12,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
      },
    };
    const stdout = useSyncExec
      ? execFileSyncImpl(python, args, { ...executionOptions, encoding: "utf8" })
      : useOutputFileSpawn
        ? await new Promise((resolve, reject) => {
            const invocation = useWindowsPowerShellBoundary
              ? windowsWhisperBoundary({ python, args })
              : { executable: python, args };
            const child = spawnImpl(invocation.executable, invocation.args, {
              env: executionOptions.env,
              windowsHide: true,
              // Python 3.14/OpenAI Whisper can exit with Windows code -1 when both
              // output handles are detached. The helper writes structured output
              // to a sidecar, while inherited handles keep the native process stable.
              stdio: ["ignore", "inherit", "inherit"],
            });
            const timeout = setTimeout(() => {
              child.kill();
              reject(new Error(`whisper_alignment_timeout_after_${timeoutMs}ms`));
            }, timeoutMs);
            child.once("error", (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            child.once("close", (code, signal) => {
              clearTimeout(timeout);
              if (code === 0) resolve("");
              else reject(new Error(`whisper_alignment_process_failed:code=${code}:signal=${signal || "none"}`));
            });
          })
        : (await execFileImpl(python, args, executionOptions)).stdout;
    const filePayload = await fs.readFile(outputPath, "utf8").catch(() => "");
    return resultFromPayload(parseWhisperJson(filePayload || stdout));
  } catch (error) {
    const filePayload = await fs.readFile(outputPath, "utf8").catch(() => "");
    if (filePayload) {
      try {
        return resultFromPayload(parseWhisperJson(filePayload));
      } catch (_parseError) {
        // Fall through to the original process failure evidence.
      }
    }
    if (allowCpuFallback && selectedDevice.toLowerCase() !== "cpu") {
      const fallback = await alignWordsWithLocalWhisper({
        audioPath,
        scriptText,
        promptText,
        model,
        device: "cpu",
        python,
        scriptPath,
        timeoutMs,
        useScriptPrompt,
        useSyncExec,
        execFileImpl,
        execFileSyncImpl,
        spawnImpl,
        useOutputFileSpawn,
        allowCpuFallback: false,
        useWindowsPowerShellBoundary,
      });
      if (fallback.ok) {
        return {
          ...fallback,
          fallback_device: "cpu",
          primary_device_error: cleanText(error.message) || "whisper_alignment_failed",
        };
      }
    }
    if (useWindowsPowerShellBoundary) {
      const directFallback = await alignWordsWithLocalWhisper({
        audioPath,
        scriptText,
        promptText,
        model,
        device: selectedDevice || device,
        python,
        scriptPath,
        timeoutMs,
        useScriptPrompt,
        useSyncExec,
        execFileImpl,
        execFileSyncImpl,
        spawnImpl,
        useOutputFileSpawn,
        allowCpuFallback,
        useWindowsPowerShellBoundary: false,
      });
      if (directFallback.ok) {
        return {
          ...directFallback,
          windows_boundary_fallback: true,
          windows_boundary_error: cleanText(error.message) || "whisper_windows_boundary_failed",
        };
      }
    }
    return {
      ok: false,
      error: cleanText(error.message) || "whisper_alignment_failed",
      stderr: cleanText(error.stderr).slice(0, 1000),
    };
  } finally {
    await fs.remove(outputPath).catch(() => {});
  }
}

module.exports = {
  alignWordsWithLocalWhisper,
  normaliseWhisperWords,
  parseWhisperJson,
  parseWhisperModelSpec,
};
