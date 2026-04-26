"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const { ffprobeDuration } = require("./media-acquisition");
const mediaPaths = require("../media-paths");
const productionAudio = require("../../audio");
const brand = require("../../brand");

const DEFAULT_LIAM_STEM = "1sn9xhe_v2";
const STUDIO_LIAM_STEM = "1sn9xhe_studio_v1_liam";
const FRESH_LIAM_STEM = "1sn9xhe_studio_v1_liam_fresh";
const PRODUCTION_VOICE_STEM = "1sn9xhe_studio_v1_elevenlabs";
const LIAM_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ";
const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765";

function escapeInput(file) {
  return file.replace(/\\/g, "/");
}

function trimAlignment(alignment, cutoffS) {
  const chars = alignment?.characters || [];
  const starts =
    alignment?.character_start_times_seconds ||
    alignment?.characterStartTimesSeconds ||
    [];
  const ends =
    alignment?.character_end_times_seconds ||
    alignment?.characterEndTimesSeconds ||
    [];
  const outChars = [];
  const outStarts = [];
  const outEnds = [];
  for (let i = 0; i < chars.length; i++) {
    const start = starts[i] ?? 0;
    if (start >= cutoffS) break;
    outChars.push(chars[i]);
    outStarts.push(start);
    outEnds.push(Math.min(ends[i] ?? start, cutoffS));
  }
  while (outChars.length && /\s/.test(outChars[outChars.length - 1])) {
    outChars.pop();
    outStarts.pop();
    outEnds.pop();
  }
  return {
    characters: outChars,
    character_start_times_seconds: outStarts,
    character_end_times_seconds: outEnds,
  };
}

function alignmentText(alignment) {
  const chars = alignment?.characters || [];
  return Array.isArray(chars) ? chars.join("").replace(/\s+/g, " ").trim() : "";
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hashScript(text) {
  return crypto.createHash("sha1").update(String(text || "")).digest("hex");
}

function hashJson(value) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(value || null))
    .digest("hex");
}

function wordsFromAlignment(alignment) {
  const chars = alignment?.characters || [];
  const starts =
    alignment?.character_start_times_seconds ||
    alignment?.characterStartTimesSeconds ||
    [];
  const ends =
    alignment?.character_end_times_seconds ||
    alignment?.characterEndTimesSeconds ||
    [];
  const words = [];
  let buffer = "";
  let start = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (buffer) {
        words.push({
          word: buffer,
          start,
          end: ends[i - 1] ?? start,
        });
        buffer = "";
        start = null;
      }
      continue;
    }
    if (start === null) start = starts[i] ?? 0;
    buffer += ch;
  }
  if (buffer && start !== null) {
    words.push({ word: buffer, start, end: ends[ends.length - 1] ?? start });
  }
  return words;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 600_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    return JSON.parse(bodyText);
  } finally {
    clearTimeout(timer);
  }
}

function findCtaCutoff(alignment, fallbackDurationS) {
  const chars = alignment?.characters || [];
  const starts =
    alignment?.character_start_times_seconds ||
    alignment?.characterStartTimesSeconds ||
    [];
  const text = chars.join("");
  const idx = text.search(/follow pulse gaming/i);
  if (idx >= 0 && Number.isFinite(starts[idx])) {
    return Math.max(1, starts[idx] - 0.08);
  }
  return fallbackDurationS;
}

async function ensureTrimmedLocalLiam({ root, storyId }) {
  const audioDir = path.join(root, "output", "audio");
  const sourceStem = storyId === "1sn9xhe" ? DEFAULT_LIAM_STEM : storyId;
  const sourceMp3 = path.join(audioDir, `${sourceStem}.mp3`);
  const sourceTs = path.join(audioDir, `${sourceStem}_timestamps.json`);
  const outputStem = storyId === "1sn9xhe" ? STUDIO_LIAM_STEM : `${storyId}_studio_v1`;
  const outputMp3 = path.join(audioDir, `${outputStem}.mp3`);
  const outputTs = path.join(audioDir, `${outputStem}_timestamps.json`);

  if (!(await fs.pathExists(sourceMp3)) || !(await fs.pathExists(sourceTs))) {
    return {
      stem: storyId,
      audioPath: path.join(audioDir, `${storyId}.mp3`),
      timestampsPath: path.join(audioDir, `${storyId}_timestamps.json`),
      source: "legacy-fixture",
      warning: "local Liam fixture missing, using legacy cached audio",
      wasTrimmed: false,
    };
  }

  const sourceDurationS = ffprobeDuration(sourceMp3) || 60;

  if ((await fs.pathExists(outputMp3)) && (await fs.pathExists(outputTs))) {
    const existing = await fs.readJson(outputTs).catch(() => null);
    const existingAlignment = existing?.alignment || existing;
    const existingWords = countWords(alignmentText(existingAlignment));
    if (storyId !== "1sn9xhe" || existingWords >= 120) {
      const existingDurationS = ffprobeDuration(outputMp3);
      const wasActuallyTrimmed =
        Number.isFinite(existingDurationS) &&
        existingDurationS < sourceDurationS - 0.2;
      return {
        stem: outputStem,
        audioPath: outputMp3,
        timestampsPath: outputTs,
        source: "local-liam-voxcpm-fixture",
        warning: wasActuallyTrimmed
          ? null
          : "CTA trim skipped because timestamp alignment would discard too much script text",
        wasTrimmed: wasActuallyTrimmed,
        durationS: existingDurationS,
      };
    }
    await fs.remove(outputMp3).catch(() => {});
    await fs.remove(outputTs).catch(() => {});
  }

  const data = await fs.readJson(sourceTs);
  const alignment = data.alignment || data;
  const originalWords = countWords(alignmentText(alignment));
  const cutoffS = findCtaCutoff(alignment, sourceDurationS);
  const trimmedAlignment = trimAlignment(alignment, cutoffS);
  const trimmedWords = countWords(alignmentText(trimmedAlignment));
  await fs.ensureDir(audioDir);

  if (trimmedWords < Math.max(100, originalWords * 0.75)) {
    await fs.copy(sourceMp3, outputMp3);
    await fs.writeJson(outputTs, { alignment }, { spaces: 2 });
    return {
      stem: outputStem,
      audioPath: outputMp3,
      timestampsPath: outputTs,
      source: "local-liam-voxcpm-fixture",
      warning:
        "CTA trim skipped because timestamp alignment would discard too much script text",
      wasTrimmed: false,
      durationS: ffprobeDuration(outputMp3),
    };
  }

  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    String(cutoffS),
    "-i",
    sourceMp3,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputMp3,
  ]);

  await fs.writeJson(
    outputTs,
    { alignment: trimmedAlignment },
    { spaces: 2 },
  );

  return {
    stem: outputStem,
    audioPath: outputMp3,
    timestampsPath: outputTs,
    source: "local-liam-voxcpm-fixture",
    warning: null,
    wasTrimmed: true,
    trimmedAtS: Number(cutoffS.toFixed(2)),
    durationS: ffprobeDuration(outputMp3),
  };
}

async function ensureFreshLocalLiam({
  root,
  storyId,
  editorial,
  force = false,
  baseUrl = LOCAL_TTS_URL,
}) {
  const audioDir = path.join(root, "output", "audio");
  const outputStem =
    storyId === "1sn9xhe" ? FRESH_LIAM_STEM : `${storyId}_studio_v1_liam_fresh`;
  const outputMp3 = path.join(audioDir, `${outputStem}.mp3`);
  const outputTs = path.join(audioDir, `${outputStem}_timestamps.json`);
  const text = editorial?.scriptForTTS || editorial?.fullScript || "";
  const displayText = editorial?.scriptForCaption || editorial?.fullScript || text;
  const scriptHash = hashScript(text);
  const speakingRate = Number(process.env.STUDIO_V1_LIAM_RATE || 1.78);

  if (!text.trim()) {
    return ensureTrimmedLocalLiam({ root, storyId });
  }

  if (!force && (await fs.pathExists(outputMp3)) && (await fs.pathExists(outputTs))) {
    const existing = await fs.readJson(outputTs).catch(() => null);
    if (
      existing?.meta?.scriptHash === scriptHash &&
      Number(existing?.meta?.speakingRate || 1.78) === speakingRate
    ) {
      return {
        stem: outputStem,
        audioPath: outputMp3,
        timestampsPath: outputTs,
        source: "local-liam-voxcpm-fresh",
        warning: null,
        wasTrimmed: false,
        durationS: ffprobeDuration(outputMp3),
        editorialScriptAppliedToAudio: true,
        timestampSource: "local-tts-forced-alignment",
        textHash: scriptHash,
      };
    }
  }

  await fs.ensureDir(audioDir);

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/text-to-speech/${LIAM_VOICE_ID}/with-timestamps`;
  const response = await fetchJsonWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice_settings: {
          stability: 0.2,
          similarity_boost: 0.8,
          style: 0.75,
          speaking_rate: speakingRate,
        },
        output_format: "mp3_44100_128",
      }),
    },
    Number(process.env.STUDIO_V1_TTS_TIMEOUT_MS || 600_000),
  );

  if (!response.audio_base64 || !response.alignment?.characters?.length) {
    throw new Error("[studio-v1] local Liam TTS returned no audio/alignment");
  }

  await fs.writeFile(outputMp3, Buffer.from(response.audio_base64, "base64"));
  const alignment = response.alignment;
  const words = wordsFromAlignment(alignment);
  await fs.writeJson(
    outputTs,
    {
      alignment,
      words,
      meta: {
        provider: "local-tts",
        voiceId: LIAM_VOICE_ID,
        voiceAlias: "liam",
        scriptHash,
        speakingRate,
        text,
        displayText,
        generatedAt: new Date().toISOString(),
      },
    },
    { spaces: 2 },
  );

  return {
    stem: outputStem,
    audioPath: outputMp3,
    timestampsPath: outputTs,
    source: "local-liam-voxcpm-fresh",
    warning: null,
    wasTrimmed: false,
    durationS: ffprobeDuration(outputMp3),
    editorialScriptAppliedToAudio: true,
    timestampSource: "local-tts-forced-alignment",
    textHash: scriptHash,
  };
}

function buildProductionVoiceSegments(editorial) {
  const baseRate = (brand.voiceSettings || {}).speaking_rate || 1.1;
  const rawSegments = [
    {
      label: "hook",
      text: editorial?.hook || "",
      rate: baseRate * 1.05,
    },
    {
      label: "body",
      text: editorial?.body || "",
      rate: baseRate * 0.95,
    },
    {
      label: "loop",
      text: editorial?.loop || "",
      rate: baseRate * 1.0,
    },
  ];

  return rawSegments
    .map((segment) => ({
      ...segment,
      cleanText: productionAudio.cleanForTTS(segment.text),
    }))
    .filter((segment) => segment.cleanText.length > 0);
}

async function readAlignmentForRelPath(relPath) {
  const abs = (await mediaPaths.resolveExisting(relPath)) || relPath;
  const data = await fs.readJson(abs);
  return data.alignment || data;
}

async function mergeSegmentAlignments(segmentRelPaths) {
  const mergedChars = [];
  const mergedStarts = [];
  const mergedEnds = [];
  let cumulativeOffset = 0;

  for (const relPath of segmentRelPaths) {
    const tsRel = relPath.replace(/\.mp3$/, "_timestamps.json");
    const alignment = await readAlignmentForRelPath(tsRel).catch(() => null);
    if (
      alignment?.characters &&
      alignment?.character_start_times_seconds &&
      alignment?.character_end_times_seconds
    ) {
      if (mergedChars.length > 0) {
        mergedChars.push(" ");
        mergedStarts.push(cumulativeOffset);
        mergedEnds.push(cumulativeOffset);
      }
      for (let i = 0; i < alignment.characters.length; i++) {
        mergedChars.push(alignment.characters[i]);
        mergedStarts.push(
          alignment.character_start_times_seconds[i] + cumulativeOffset,
        );
        mergedEnds.push(
          alignment.character_end_times_seconds[i] + cumulativeOffset,
        );
      }
    }

    const abs = (await mediaPaths.resolveExisting(relPath)) || relPath;
    cumulativeOffset += ffprobeDuration(abs) || 0;
  }

  return {
    characters: mergedChars,
    character_start_times_seconds: mergedStarts,
    character_end_times_seconds: mergedEnds,
  };
}

async function ensureProductionElevenLabsVoice({
  root,
  storyId,
  editorial,
  force = false,
}) {
  const audioDir = path.join(root, "output", "audio");
  const outputStem =
    storyId === "1sn9xhe"
      ? PRODUCTION_VOICE_STEM
      : `${storyId}_studio_v1_elevenlabs`;
  const outputRel = path.join("output", "audio", `${outputStem}.mp3`);
  const outputTsRel = outputRel.replace(/\.mp3$/, "_timestamps.json");
  const outputMp3 = path.join(audioDir, `${outputStem}.mp3`);
  const outputTs = path.join(audioDir, `${outputStem}_timestamps.json`);
  const segments = buildProductionVoiceSegments(editorial);
  const fallbackText = productionAudio.cleanForTTS(
    editorial?.scriptForCaption || editorial?.fullScript || "",
  );
  const segmentPayload = segments.length
    ? segments.map((segment) => ({
        label: segment.label,
        text: segment.cleanText,
        rate: Number(segment.rate.toFixed(3)),
      }))
    : [{ label: "full", text: fallbackText, rate: brand.voiceSettings?.speaking_rate || 1.1 }];
  const signature = {
    provider: "elevenlabs",
    endpoint: "/v1/text-to-speech/{voiceId}/with-timestamps",
    voiceId: brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default",
    model: brand.voiceModel || "eleven_multilingual_v2",
    voiceSettings: brand.voiceSettings || {
      stability: 0.2,
      similarity_boost: 0.8,
      style: 0.75,
      speaking_rate: 1.1,
    },
    preprocessing: "audio.cleanForTTS",
    dynamicPacing: "production-hook-body-loop-rates",
    segments: segmentPayload,
  };
  const signatureHash = hashJson(signature);
  const displayText =
    editorial?.scriptForCaption || editorial?.fullScript || fallbackText;

  if (!fallbackText.trim() && !segments.length) {
    throw new Error("[studio-v1] production ElevenLabs voice has no script text");
  }

  if (!force && (await fs.pathExists(outputMp3)) && (await fs.pathExists(outputTs))) {
    const existing = await fs.readJson(outputTs).catch(() => null);
    if (existing?.meta?.signatureHash === signatureHash) {
      return {
        stem: outputStem,
        audioPath: outputMp3,
        timestampsPath: outputTs,
        source: "elevenlabs-production-path",
        warning: null,
        wasTrimmed: false,
        durationS: ffprobeDuration(outputMp3),
        editorialScriptAppliedToAudio: true,
        timestampSource: "elevenlabs-with-timestamps",
        provider: "elevenlabs",
        voiceId: signature.voiceId,
        model: signature.model,
        voiceSettings: signature.voiceSettings,
        preprocessing: signature.preprocessing,
        dynamicPacing: signature.dynamicPacing,
        signatureHash,
      };
    }
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("[studio-v1] ELEVENLABS_API_KEY is required for production voice path");
  }

  await fs.ensureDir(audioDir);
  const originalProvider = process.env.TTS_PROVIDER;
  process.env.TTS_PROVIDER = "elevenlabs";

  try {
    let alignment;
    let cleanedAudioText;

    if (segments.length > 1) {
      const segmentRelPaths = [];
      for (const segment of segments) {
        const segmentRel = path.join(
          "output",
          "audio",
          `${outputStem}_${segment.label}.mp3`,
        );
        await productionAudio.generateTTS(
          segment.cleanText,
          segmentRel,
          segment.rate,
        );
        segmentRelPaths.push(segmentRel);
      }

      await productionAudio.concatAudioFiles(segmentRelPaths, outputRel);
      alignment = await mergeSegmentAlignments(segmentRelPaths);
      cleanedAudioText = segments.map((segment) => segment.cleanText).join(" ");

      for (const segmentRel of segmentRelPaths) {
        const segmentAbs = (await mediaPaths.resolveExisting(segmentRel)) || segmentRel;
        const segmentTsAbs =
          (await mediaPaths.resolveExisting(
            segmentRel.replace(/\.mp3$/, "_timestamps.json"),
          )) || segmentRel.replace(/\.mp3$/, "_timestamps.json");
        await fs.remove(segmentAbs).catch(() => {});
        await fs.remove(segmentTsAbs).catch(() => {});
      }
    } else {
      const text = segments[0]?.cleanText || fallbackText;
      await productionAudio.generateTTS(text, outputRel, segmentPayload[0].rate);
      alignment = await readAlignmentForRelPath(outputTsRel);
      cleanedAudioText = text;
    }

    const words = wordsFromAlignment(alignment);
    await fs.writeJson(
      outputTs,
      {
        alignment,
        words,
        meta: {
          ...signature,
          signatureHash,
          scriptHash: hashScript(cleanedAudioText),
          text: cleanedAudioText,
          displayText,
          generatedAt: new Date().toISOString(),
        },
      },
      { spaces: 2 },
    );
  } finally {
    if (originalProvider === undefined) {
      delete process.env.TTS_PROVIDER;
    } else {
      process.env.TTS_PROVIDER = originalProvider;
    }
  }

  return {
    stem: outputStem,
    audioPath: outputMp3,
    timestampsPath: outputTs,
    source: "elevenlabs-production-path",
    warning: null,
    wasTrimmed: false,
    durationS: ffprobeDuration(outputMp3),
    editorialScriptAppliedToAudio: true,
    timestampSource: "elevenlabs-with-timestamps",
    provider: "elevenlabs",
    voiceId: signature.voiceId,
    model: signature.model,
    voiceSettings: signature.voiceSettings,
    preprocessing: signature.preprocessing,
    dynamicPacing: signature.dynamicPacing,
    signatureHash,
  };
}

function discoverSoundAssets(root) {
  const musicPath = path.join(root, "audio", "Main Background Loop 1.wav");
  const stingPath = path.join(root, "audio", "Breaking News Sting 5.wav");
  return {
    musicPath: fs.existsSync(musicPath) ? musicPath : null,
    stingPath: fs.existsSync(stingPath) ? stingPath : null,
  };
}

function buildAudioInputSpecs({ voicePath, musicPath, stingPath, cueTimesS }) {
  const inputs = [`-i "${escapeInput(voicePath)}"`];
  const indices = { voice: 0, music: null, stings: [] };
  if (musicPath) {
    indices.music = inputs.length;
    inputs.push(`-stream_loop -1 -i "${escapeInput(musicPath)}"`);
  }
  if (stingPath) {
    for (const cue of cueTimesS || []) {
      indices.stings.push({ index: inputs.length, cueS: cue });
      inputs.push(`-i "${escapeInput(stingPath)}"`);
    }
  }
  return { inputs, indices };
}

function buildAudioMixFilters({ indices, outputLabel = "outa" }) {
  const parts = [];
  parts.push(`[${indices.voice}:a]volume=1.0,asplit=2[voice_main][voice_side]`);

  const mixLabels = ["[voice_main]"];
  if (indices.music !== null && indices.music !== undefined) {
    parts.push(
      `[${indices.music}:a]volume=0.075,aresample=44100[bgm_raw]`,
    );
    parts.push(
      `[bgm_raw][voice_side]sidechaincompress=threshold=0.035:ratio=6:attack=20:release=450[bgm_ducked]`,
    );
    mixLabels.push("[bgm_ducked]");
  }

  for (let i = 0; i < (indices.stings || []).length; i++) {
    const { index, cueS } = indices.stings[i];
    const delayMs = Math.max(0, Math.round(cueS * 1000));
    parts.push(
      `[${index}:a]atrim=0:0.55,asetpts=PTS-STARTPTS,volume=0.11,adelay=${delayMs}|${delayMs}[sfx${i}]`,
    );
    mixLabels.push(`[sfx${i}]`);
  }

  if (mixLabels.length === 1) {
    parts.push(`[voice_main]anull[${outputLabel}]`);
  } else {
    parts.push(
      `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2[${outputLabel}]`,
    );
  }
  return parts;
}

function cueTimesForScenes(scenes) {
  const cues = [];
  let t = 0;
  for (const scene of scenes || []) {
    if (
      scene.type === "card.source" ||
      scene.type === "card.stat" ||
      scene.type === "card.takeaway"
    ) {
      cues.push(t);
    }
    t += Number(scene.duration || 0);
  }
  return cues.slice(0, 3);
}

module.exports = {
  ensureTrimmedLocalLiam,
  ensureFreshLocalLiam,
  ensureProductionElevenLabsVoice,
  discoverSoundAssets,
  buildAudioInputSpecs,
  buildAudioMixFilters,
  cueTimesForScenes,
  trimAlignment,
  findCtaCutoff,
  alignmentText,
  wordsFromAlignment,
  STUDIO_LIAM_STEM,
  FRESH_LIAM_STEM,
  PRODUCTION_VOICE_STEM,
};
