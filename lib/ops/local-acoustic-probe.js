"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_TTS_PYTHON = path.join(ROOT, "tts_server", "venv", "Scripts", "python.exe");

function firstNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function lastNumber(text, patterns) {
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const number = Number(matches[i][1]);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function parseAstats(stderr) {
  const text = String(stderr || "");
  return {
    integratedLufs: lastNumber(text, [/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gi]),
    truePeakDb: firstNumber(text, [
      /True peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/i,
      /\bTPK:\s*(-?\d+(?:\.\d+)?)\s*dBFS/i,
      /Peak level dB:\s*(-?\d+(?:\.\d+)?)/i,
    ]),
    silenceRatio: null,
    clippingRatio: null,
    zeroCrossingRate: firstNumber(text, [/Zero crossings rate:\s*(\d+(?:\.\d+)?)/i]),
  };
}

function probeMedianPitch(file) {
  const python = fs.existsSync(LOCAL_TTS_PYTHON) ? LOCAL_TTS_PYTHON : "python";
  const code = [
    "import json, sys",
    "import numpy as np",
    "import librosa",
    "y, sr = librosa.load(sys.argv[1], sr=48000, mono=True)",
    "if y.size == 0:",
    "    print(json.dumps({'medianPitchHz': None}))",
    "    raise SystemExit(0)",
    "f0 = librosa.yin(y, fmin=50, fmax=300, sr=sr)",
    "f0 = f0[np.isfinite(f0)]",
    "f0 = f0[(f0 >= 50) & (f0 <= 300)]",
    "centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]",
    "rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]",
    "n_fft = 1024",
    "S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=512)) ** 2",
    "freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)",
    "voice_band = (freqs >= 80) & (freqs <= min(7500, sr / 2))",
    "high_band = freqs >= 5000",
    "total = S[voice_band].sum(axis=0)",
    "high = S[high_band].sum(axis=0)",
    "ratio = high / np.maximum(total, 1e-12)",
    "print(json.dumps({",
    "  'medianPitchHz': float(np.median(f0)) if f0.size else None,",
    "  'spectralCentroidHz': float(np.median(centroid)) if centroid.size else None,",
    "  'spectralRolloff85Hz': float(np.median(rolloff)) if rolloff.size else None,",
    "  'highFrequencyRatioGt5Khz': float(np.median(ratio)) if ratio.size else None,",
    "}))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code, file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    windowsHide: true,
  });
  if (result.status !== 0) return { medianPitchHz: null };
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return { medianPitchHz: null };
  }
}

function probeLocalAudioAcoustics(file) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-af",
      "astats=metadata=1:reset=1,ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 45000, windowsHide: true },
  );
  return {
    ...parseAstats([result.stderr, result.stdout, result.error?.message].filter(Boolean).join("\n")),
    ...probeMedianPitch(file),
  };
}

module.exports = {
  parseAstats,
  probeLocalAudioAcoustics,
  probeMedianPitch,
};
