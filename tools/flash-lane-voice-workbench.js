#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true });
} catch {}

const { ffprobeDuration } = require("../lib/studio/media-acquisition");
const {
  buildFlashLaneVoiceWorkbench,
  generateLocalVoiceCandidate,
  renderFlashLaneVoiceWorkbenchMarkdown,
} = require("../lib/studio/v2/flash-lane-voice-workbench");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const LOCAL_TTS_PYTHON = path.join(ROOT, "tts_server", "venv", "Scripts", "python.exe");

function parseArgs(argv) {
  const args = {
    fixture: false,
    storyId: null,
    audioPaths: [],
    candidateManifest: null,
    timestampsPath: null,
    provider: null,
    source: null,
    approvedLocalVoice: false,
    generateLocal: false,
    engine: process.env.LOCAL_TTS_ENGINE || process.env.STUDIO_V2_LOCAL_TTS_ENGINE || "voxcpm2",
    rate: Number(process.env.STUDIO_V2_VOICE_WORKBENCH_RATE || 1.7),
    pitchFactor: Number(process.env.STUDIO_V2_VOICE_PITCH_FACTOR || 1),
    outputDir: OUT,
    normaliseAudio: true,
    dryRun: true,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--audio" || arg === "--candidate") args.audioPaths.push(path.resolve(argv[++i] || ""));
    else if (arg === "--candidate-manifest") args.candidateManifest = path.resolve(argv[++i] || "");
    else if (arg === "--timestamps") args.timestampsPath = path.resolve(argv[++i] || "");
    else if (arg === "--provider") args.provider = argv[++i] || null;
    else if (arg === "--source") args.source = argv[++i] || null;
    else if (arg === "--approved-local-voice") args.approvedLocalVoice = true;
    else if (arg === "--generate-local") args.generateLocal = true;
    else if (arg === "--engine") args.engine = argv[++i] || args.engine;
    else if (arg === "--rate") args.rate = Number(argv[++i] || args.rate);
    else if (arg === "--pitch-factor") args.pitchFactor = Number(argv[++i] || args.pitchFactor);
    else if (arg === "--out-dir") args.outputDir = path.resolve(argv[++i] || OUT);
    else if (arg === "--no-normalise" || arg === "--no-normalize") args.normaliseAudio = false;
    else if (arg === "--apply-local") args.dryRun = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function fixtureStory() {
  return {
    id: "fixture_flash_lane_story",
    title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
    hook: "Take-Two just made the weirdest legacy franchise call of the week.",
    full_script: [
      "Take-Two just made the weirdest legacy franchise call of the week.",
      "The company says it passed on a sequel to one of its legacy franchises because the pitch was not strong enough.",
      "That matters because Take-Two owns names that still make gaming audiences stop scrolling: GTA, Red Dead, BioShock, Mafia and Borderlands.",
      "This is not a release-date reveal and it is not confirmation of a cancelled project.",
      "It is a rare look at how the publisher decides what gets revived and what stays buried.",
      "The interesting bit is the standard.",
      "Take-Two is saying nostalgia alone is not enough.",
      "If a sequel cannot clear the creative bar, even a famous logo does not save it.",
      "That makes the mystery bigger, not smaller.",
      "Was it BioShock, Midnight Club, Bully, Max Payne or something else entirely?",
      "For players, the real takeaway is brutal.",
      "A beloved franchise can still lose internally if the pitch feels average.",
      "Follow Pulse Gaming so you never miss a beat.",
    ].join(" "),
  };
}

function parseJsonField(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normaliseStory(row) {
  return {
    ...row,
    downloaded_images: Array.isArray(row?.downloaded_images)
      ? row.downloaded_images
      : parseJsonField(row?.downloaded_images) || [],
    game_images: Array.isArray(row?.game_images)
      ? row.game_images
      : parseJsonField(row?.game_images) || [],
  };
}

async function loadStory(args) {
  if (args.fixture) return fixtureStory();
  const db = require("../lib/db");
  const rows = (await db.getStories()).map(normaliseStory);
  if (args.storyId) {
    const story = rows.find((item) => item.id === args.storyId);
    if (!story) throw new Error(`story not found: ${args.storyId}`);
    return story;
  }
  const latest = rows.find((item) => item.approved || item.auto_approved) || rows[0];
  if (!latest) throw new Error("no stories available; use --fixture");
  return latest;
}

function inferProvider(file, args) {
  if (args.provider) return args.provider;
  const lower = String(file || "").toLowerCase();
  if (lower.includes("chatterbox") || lower.includes("voxcpm") || lower.includes("local")) {
    return "local";
  }
  if (lower.includes("eleven")) return "elevenlabs";
  return "unknown";
}

function inferSource(file, args) {
  if (args.source) return args.source;
  const lower = String(file || "").toLowerCase();
  if (lower.includes("chatterbox")) return "local-production-chatterbox-path";
  if (lower.includes("voxcpm") || lower.includes("local")) return "local-production-voxcpm-path";
  if (lower.includes("eleven")) return "elevenlabs-production-path";
  return "provided-audio";
}

async function readTranscript(timestampsPath) {
  if (!timestampsPath || !(await fs.pathExists(timestampsPath))) return "";
  const data = await fs.readJson(timestampsPath).catch(() => null);
  if (!data) return "";
  if (typeof data?.meta?.text === "string") return data.meta.text;
  const chars = data.characters || data.alignment?.characters || data.alignment?.alignment?.characters;
  return Array.isArray(chars) ? chars.join("") : "";
}

function parseAstats(stderr) {
  const text = String(stderr || "");
  const firstNumber = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const number = Number(match[1]);
        if (Number.isFinite(number)) return number;
      }
    }
    return null;
  };
  const lastNumber = (patterns) => {
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      for (let i = matches.length - 1; i >= 0; i--) {
        const number = Number(matches[i][1]);
        if (Number.isFinite(number)) return number;
      }
    }
    return null;
  };
  return {
    integratedLufs: lastNumber([/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gi]),
    truePeakDb: firstNumber([
      /True peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/i,
      /\bTPK:\s*(-?\d+(?:\.\d+)?)\s*dBFS/i,
      /Peak level dB:\s*(-?\d+(?:\.\d+)?)/i,
    ]),
    silenceRatio: null,
    clippingRatio: null,
    zeroCrossingRate: firstNumber([/Zero crossings rate:\s*(\d+(?:\.\d+)?)/i]),
  };
}

function probeAcoustic(file) {
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
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 45000 },
  );
  return {
    ...parseAstats([result.stderr, result.stdout, result.error?.message].filter(Boolean).join("\n")),
    ...probeMedianPitch(file),
  };
}

function probeMedianPitch(file) {
  const python = fs.existsSync(LOCAL_TTS_PYTHON) ? LOCAL_TTS_PYTHON : "python";
  const code = [
    "import json, sys",
    "import numpy as np",
    "import librosa",
    "y, sr = librosa.load(sys.argv[1], sr=16000, mono=True)",
    "if y.size == 0:",
    "    print(json.dumps({'medianPitchHz': None}))",
    "    raise SystemExit(0)",
    "f0 = librosa.yin(y, fmin=50, fmax=300, sr=sr)",
    "f0 = f0[np.isfinite(f0)]",
    "f0 = f0[(f0 >= 50) & (f0 <= 300)]",
    "print(json.dumps({'medianPitchHz': float(np.median(f0)) if f0.size else None}))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code, file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (result.status !== 0) return { medianPitchHz: null };
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return { medianPitchHz: null };
  }
}

async function normaliseVoiceAudio({ inputPath, outputPath, pitchFactor = 1 }) {
  const filters = [];
  if (Number.isFinite(Number(pitchFactor)) && Number(pitchFactor) > 0 && Number(pitchFactor) !== 1) {
    filters.push(`rubberband=pitch=${Number(pitchFactor).toFixed(3)}`);
  }
  filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-nostats",
      "-i",
      inputPath,
      "-af",
      filters.join(","),
      "-ar",
      "44100",
      "-ac",
      "1",
      "-b:a",
      "128k",
      outputPath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 },
  );
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg voice normalisation failed: ${result.stderr || result.error?.message || "unknown error"}`,
    );
  }
  return {
    applied: true,
    filter: filters.join(","),
    pitchFactor: Number(pitchFactor),
    inputPath,
    outputPath,
  };
}

async function candidatesFromArgs(args) {
  const out = [];
  if (args.candidateManifest) {
    const data = await fs.readJson(args.candidateManifest);
    const list = Array.isArray(data) ? data : data.candidates || [];
    out.push(...list);
  }

  const transcript = await readTranscript(args.timestampsPath);
  for (const audioPath of args.audioPaths) {
    const durationS = await fs.pathExists(audioPath) ? ffprobeDuration(audioPath) : null;
    out.push({
      id: path.basename(audioPath).replace(/\.[^.]+$/, ""),
      provider: inferProvider(audioPath, args),
      source: inferSource(audioPath, args),
      path: audioPath,
      durationS,
      transcript,
      acoustic: (await fs.pathExists(audioPath)) ? probeAcoustic(audioPath) : null,
      approvedLocalVoice: args.approvedLocalVoice,
    });
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/flash-lane-voice-workbench.js [options]",
      "",
      "Options:",
      "  --fixture                    Use a local Flash Lane fixture story",
      "  --story <id>                 Use a local DB story",
      "  --audio <path>               Add an MP3/WAV candidate; repeatable",
      "  --candidate <path>           Alias for --audio",
      "  --candidate-manifest <path>  JSON array or { candidates: [...] }",
      "  --timestamps <path>          ElevenLabs/local timestamp JSON for transcript/outro check",
      "  --provider <name>            Candidate provider for --audio",
      "  --source <name>              Candidate source label for --audio",
      "  --approved-local-voice       Mark supplied local voice as human-approved",
      "  --generate-local             Generate one local TTS candidate only when --apply-local is present",
      "  --engine <name>              Local engine label for generated candidate",
      "  --rate <number>              Local voice speaking rate, default 1.7",
      "  --pitch-factor <number>      Optional local pitch correction, e.g. 1.8",
      "  --out-dir <dir>              Output directory, default test/output",
      "  --no-normalise               Do not apply local FFmpeg loudness normalisation",
      "",
      "Default is dry-run/report-only. Local TTS generation writes only under test/output and never renders, posts, touches OAuth, Railway or production DB rows.",
    ].join("\n") + "\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const story = await loadStory(args);
  const candidates = await candidatesFromArgs(args);
  let localGeneration = null;
  if (args.generateLocal) {
    localGeneration = await generateLocalVoiceCandidate({
      story,
      outputRoot: path.join(args.outputDir, "flash-lane-voice-workbench-assets"),
      applyLocal: args.dryRun !== true,
      engine: args.engine,
      rate: args.rate,
      durationProbe: ffprobeDuration,
      acousticProbe: probeAcoustic,
      postProcessAudio: args.normaliseAudio
        ? (io) => normaliseVoiceAudio({ ...io, pitchFactor: args.pitchFactor })
        : null,
    });
    if (localGeneration.candidate) candidates.push(localGeneration.candidate);
  }
  const report = buildFlashLaneVoiceWorkbench({
    story,
    candidates,
    dryRun: args.dryRun,
  });
  if (localGeneration) report.local_generation = localGeneration;
  await fs.ensureDir(args.outputDir);
  const stem = `flash_lane_voice_workbench_${story.id || "story"}`;
  const jsonPath = path.join(args.outputDir, `${stem}.json`);
  const mdPath = path.join(args.outputDir, `${stem}.md`);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderFlashLaneVoiceWorkbenchMarkdown(report), "utf8");
  process.stdout.write(renderFlashLaneVoiceWorkbenchMarkdown(report));
  process.stderr.write(
    `[voice-workbench] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")} and ${path.relative(ROOT, mdPath).replace(/\\/g, "/")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[voice-workbench] ${err.stack || err.message}\n`);
  process.exit(1);
});
