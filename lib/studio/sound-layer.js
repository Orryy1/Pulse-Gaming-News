"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const { ffprobeDuration } = require("./media-acquisition");
const mediaPaths = require("../media-paths");
const { buildVoiceMasteringSignature } = require("../audio-quality");
const productionAudio = require("../../audio");
const brand = require("../../brand");

const DEFAULT_LIAM_STEM = "1sn9xhe_v2";
const STUDIO_LIAM_STEM = "1sn9xhe_studio_v1_liam";
const FRESH_LIAM_STEM = "1sn9xhe_studio_v1_liam_fresh";
const PRODUCTION_VOICE_STEM = "1sn9xhe_studio_v1_elevenlabs";
const LIAM_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ";
const LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765";
const LOCAL_PACE_GUARD_VERSION = 2;
const LOCAL_INTER_SEGMENT_PAUSE_VERSION = 4;
const DEFAULT_LOCAL_TTS_TARGET_DURATION_S = 62.5;
const DEFAULT_LOCAL_TTS_MAX_INTERSEGMENT_PAUSE_S = 1.85;
const DEFAULT_LOCAL_TTS_MAX_OUTRO_LEAD_GAP_S = 0.65;
const DEFAULT_LOCAL_TTS_MAX_TITLE_FRAGMENT_GAP_S = 0.18;
const ACCEPTED_LOCAL_VOICE_ID = "pulse-sleepy-liam-20260502";
const ACCEPTED_LOCAL_VOICE_FILE = path.join(
  "tts_server",
  "voices",
  "pulse_liam_sleepy.wav",
);
const DEFAULT_STUDIO_OUTRO_LINE =
  "Follow Pulse Gaming so you never miss a beat.";
const TERMINAL_PULSE_CTA_RE =
  /\bFollow\s+Pulse\s+Gaming\b[^.!?]*(?:[.!?]\s*)?$/i;
const FIXED_PROTECTED_VOICE_PHRASES = [
  ["follow", "pulse", "gaming"],
  ["pulse", "gaming"],
];
const TITLE_PHRASE_CONNECTORS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "vs",
  "versus",
  "with",
]);
const TITLE_CONTINUATION_FALSE_STARTERS = new Set([
  "after",
  "before",
  "body",
  "but",
  "follow",
  "hook",
  "however",
  "it",
  "loop",
  "now",
  "report",
  "reports",
  "source",
  "sources",
  "that",
  "these",
  "this",
  "those",
]);

function escapeInput(file) {
  return file.replace(/\\/g, "/");
}

function resolveLocalTtsOutputFormat(env = process.env) {
  return productionAudio.resolveTtsOutputFormat("local", env);
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

function sha1FileIfPresent(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function resolveAcceptedLocalVoiceReference(env = process.env) {
  const rawId = String(
    env.STUDIO_V2_LOCAL_VOICE_REFERENCE_ID || ACCEPTED_LOCAL_VOICE_ID,
  ).trim();
  const rawFile = String(
    env.STUDIO_V2_LOCAL_VOICE_REFERENCE_FILE || ACCEPTED_LOCAL_VOICE_FILE,
  ).trim();
  const absoluteFile = path.isAbsolute(rawFile)
    ? rawFile
    : path.resolve(__dirname, "..", "..", rawFile);
  const referenceHash = sha1FileIfPresent(absoluteFile);
  return {
    id: rawId || ACCEPTED_LOCAL_VOICE_ID,
    fileName: path.basename(rawFile || ACCEPTED_LOCAL_VOICE_FILE),
    referencePresent: Boolean(referenceHash),
    referenceHash,
  };
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
  const speakingRate = Number(process.env.STUDIO_V1_LIAM_RATE || 1.0);

  if (!text.trim()) {
    return ensureTrimmedLocalLiam({ root, storyId });
  }

  if (!force && (await fs.pathExists(outputMp3)) && (await fs.pathExists(outputTs))) {
    const existing = await fs.readJson(outputTs).catch(() => null);
    if (
      existing?.meta?.scriptHash === scriptHash &&
      Number(existing?.meta?.speakingRate || 1.0) === speakingRate
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
        output_format: resolveLocalTtsOutputFormat(process.env),
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

function resolveStudioOutroLine(env = process.env) {
  if (/^(true|1|yes|on)$/i.test(String(env.STUDIO_V2_DISABLE_SPOKEN_OUTRO || ""))) {
    return "";
  }
  const configured = String(env.STUDIO_V2_SPOKEN_OUTRO || "").trim();
  return configured || DEFAULT_STUDIO_OUTRO_LINE;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normaliseTerminalCtaText(value) {
  return String(value || "")
    .replace(/\[PAUSE\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .toLowerCase();
}

function cleanTerminalCtaForSegment(value) {
  const clean = String(value || "")
    .replace(/\[PAUSE\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "");
  return clean ? `${clean}.` : "";
}

function cleanProductionVoiceSegmentText(text) {
  const cleaned = productionAudio.cleanForTTS(text);
  const match = String(text || "").trim().match(TERMINAL_PULSE_CTA_RE);
  if (!match) return cleaned;

  const originalCta = cleanTerminalCtaForSegment(match[0]);
  const defaultCta = cleanTerminalCtaForSegment(DEFAULT_STUDIO_OUTRO_LINE);
  if (!originalCta || normaliseTerminalCtaText(originalCta) === normaliseTerminalCtaText(defaultCta)) {
    return cleaned;
  }

  const defaultOutroRe = new RegExp(
    `\\s*${escapeRegExp(defaultCta.replace(/[.!?]+$/g, ""))}[.!?]?\\s*$`,
    "i",
  );
  const withoutDefaultOutro = cleaned.replace(defaultOutroRe, "").trim();
  return `${withoutDefaultOutro} ${originalCta}`.replace(/\s+/g, " ").trim();
}

function buildProductionVoiceSegments(editorial, env = process.env) {
  const baseRate = (brand.voiceSettings || {}).speaking_rate || 1.0;
  const rawSegments = [
    {
      label: "hook",
      text: editorial?.hook || "",
      rate: baseRate,
    },
    {
      label: "body",
      text: editorial?.body || "",
      rate: baseRate,
    },
    {
      label: "loop",
      text: editorial?.loop || "",
      rate: baseRate,
    },
  ];
  const hasTerminalPulseCta = rawSegments.some((segment) =>
    TERMINAL_PULSE_CTA_RE.test(String(segment.text || "").trim()),
  );
  const outroLine = hasTerminalPulseCta ? "" : resolveStudioOutroLine(env);
  if (outroLine) {
    rawSegments.push({
      label: "outro",
      text: outroLine,
      rate: baseRate,
    });
  }

  const cleaned = rawSegments
    .map((segment) => ({
      ...segment,
      cleanText: cleanProductionVoiceSegmentText(segment.text),
    }))
    .filter((segment) => segment.cleanText.length > 0);
  const deduped = [];
  for (const segment of cleaned) {
    const previous = deduped[deduped.length - 1];
    const cleanText = trimDuplicateSegmentBoundary(previous?.cleanText, segment.cleanText);
    if (!cleanText) continue;
    deduped.push({
      ...segment,
      cleanText,
    });
  }
  return mergeSplitTitleContinuationSegments(deduped);
}

function sentenceChunks(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function sentenceDedupeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trimDuplicateSegmentBoundary(previousText, currentText) {
  const current = sentenceChunks(currentText);
  if (!current.length) return "";
  const previous = sentenceChunks(previousText);
  let previousLastKey = sentenceDedupeKey(previous[previous.length - 1] || "");
  while (current.length && previousLastKey && sentenceDedupeKey(current[0]) === previousLastKey) {
    current.shift();
    previousLastKey = sentenceDedupeKey(previous[previous.length - 1] || "");
  }
  return current.join(" ").replace(/\s+/g, " ").trim();
}

function mergeSegmentLabels(leftLabel, rightLabel) {
  const left = String(leftLabel || "").trim();
  const right = String(rightLabel || "").trim();
  if (!left) return right;
  if (!right || right === left) return left;
  return `${left}_${right}`;
}

function mergeSegmentRates(left, right) {
  const leftRate = Number(left?.rate);
  const rightRate = Number(right?.rate);
  if (!Number.isFinite(leftRate)) return Number.isFinite(rightRate) ? rightRate : 1;
  if (!Number.isFinite(rightRate)) return leftRate;
  const leftWords = Math.max(1, countWords(left?.cleanText || left?.text || ""));
  const rightWords = Math.max(1, countWords(right?.cleanText || right?.text || ""));
  const weightedRate =
    ((leftRate * leftWords) + (rightRate * rightWords)) /
    (leftWords + rightWords);
  return Number(
    weightedRate.toFixed(3),
  );
}

function mergeSplitTitleContinuationSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && isSplitTitleFragmentBoundary(previous, segment)) {
      const text = [
        previous.text || previous.cleanText || "",
        segment.text || segment.cleanText || "",
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      previous.label = mergeSegmentLabels(previous.label, segment.label);
      previous.text = text;
      previous.cleanText = cleanProductionVoiceSegmentText(text);
      previous.rate = mergeSegmentRates(previous, segment);
      previous.mergedTitleContinuation = true;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

async function readAlignmentForRelPath(relPath) {
  const abs = (await mediaPaths.resolveExisting(relPath)) || relPath;
  const data = await fs.readJson(abs);
  return data.alignment || data;
}

function timestampRepairFromPayload(payload = {}) {
  const candidates = [
    payload?.meta?.timestampRepair,
    payload?.meta?.timestamp_repair,
    payload?.alignment?.meta?.timestampRepair,
    payload?.alignment?.meta?.timestamp_repair,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function sidecarMetaFromPayload(payload = {}) {
  return payload?.meta || payload?.alignment?.meta || {};
}

function voiceMetaFromPayload(payload = {}) {
  const meta = sidecarMetaFromPayload(payload);
  return {
    voiceMastering:
      meta.voiceMastering ||
      meta.voice_mastering ||
      meta.mastering ||
      undefined,
    acoustic: meta.acoustic || undefined,
    voiceDiagnostics: meta.voiceDiagnostics || meta.voice_diagnostics || undefined,
    generation: meta.generation || undefined,
  };
}

async function collectSegmentVoiceMeta(segmentRelPaths) {
  const segmentVoiceMastering = [];
  const segmentAcoustics = [];
  const voiceDiagnostics = [];
  const generations = [];
  for (const relPath of segmentRelPaths) {
    const tsRel = relPath.replace(/\.mp3$/, "_timestamps.json");
    const tsAbs = (await mediaPaths.resolveExisting(tsRel)) || tsRel;
    const payload = await fs.readJson(tsAbs).catch(() => null);
    const meta = voiceMetaFromPayload(payload);
    if (meta.voiceMastering) {
      segmentVoiceMastering.push({
        relPath: tsRel,
        ...meta.voiceMastering,
      });
    }
    if (meta.acoustic) segmentAcoustics.push({ relPath: tsRel, ...meta.acoustic });
    if (meta.voiceDiagnostics) voiceDiagnostics.push({ relPath: tsRel, ...meta.voiceDiagnostics });
    if (meta.generation) generations.push({ relPath: tsRel, ...meta.generation });
  }
  const masteredSegments = segmentVoiceMastering.filter(
    (item) => item.ok === true || String(item.code || "").toLowerCase() === "voice_mastered",
  );
  return {
    voiceMastering: masteredSegments.length
      ? {
          ok: masteredSegments.length === segmentVoiceMastering.length,
          code: "voice_mastered",
          source: "merged_segment_voice_mastering",
          segmentCount: segmentVoiceMastering.length,
          targetLufs: masteredSegments[0]?.targetLufs ?? null,
          truePeak: masteredSegments[0]?.truePeak ?? null,
          outputBitrate: masteredSegments[0]?.outputBitrate ?? null,
        }
      : undefined,
    acoustic: segmentAcoustics[0] || undefined,
    voiceDiagnostics: voiceDiagnostics.length ? { segments: voiceDiagnostics } : undefined,
    generation: generations.length ? { segments: generations } : undefined,
    segmentVoiceMastering: segmentVoiceMastering.length ? segmentVoiceMastering : undefined,
  };
}

async function mergeSegmentAlignments(segmentRelPaths, options = {}) {
  const mergedChars = [];
  const mergedStarts = [];
  const mergedEnds = [];
  const segmentTimestampRepairs = [];
  let cumulativeOffset = 0;
  const interSegmentGapsS = normaliseInterSegmentGaps(
    segmentRelPaths.length,
    options,
  );

  for (let segmentIndex = 0; segmentIndex < segmentRelPaths.length; segmentIndex++) {
    const relPath = segmentRelPaths[segmentIndex];
    const tsRel = relPath.replace(/\.mp3$/, "_timestamps.json");
    const tsAbs = (await mediaPaths.resolveExisting(tsRel)) || tsRel;
    const payload = await fs.readJson(tsAbs).catch(() => null);
    const alignment = payload?.alignment || payload;
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

      const repair = timestampRepairFromPayload(payload);
      if (repair?.repaired === true || String(repair?.repaired || "").toLowerCase() === "true") {
        segmentTimestampRepairs.push({
          segmentIndex,
          relPath: tsRel,
          reason: repair.reason || repair.repairReason || "unknown",
          strategy: repair.strategy || repair.repairStrategy || null,
          originalInspection: repair.originalInspection || repair.original_inspection || null,
          repairedInspection: repair.repairedInspection || repair.repaired_inspection || null,
        });
      }
    }

    const abs = (await mediaPaths.resolveExisting(relPath)) || relPath;
    cumulativeOffset += ffprobeDuration(abs) || 0;
    if (segmentIndex < segmentRelPaths.length - 1) {
      cumulativeOffset += interSegmentGapsS[segmentIndex] || 0;
    }
  }

  const merged = {
    characters: mergedChars,
    character_start_times_seconds: mergedStarts,
    character_end_times_seconds: mergedEnds,
  };
  if (segmentTimestampRepairs.length > 0) {
    merged.meta = {
      segmentTimestampRepairs,
      timestampRepair: {
        repaired: true,
        reason: "segment_timestamp_repair",
        strategy: "merged_segment_repair_provenance",
        repairedSegments: segmentTimestampRepairs.length,
      },
    };
  }
  return merged;
}

function normaliseInterSegmentGaps(segmentCount, options = {}) {
  const gapCount = Math.max(0, Number(segmentCount || 0) - 1);
  const fallback = Math.max(0, Number(options.interSegmentGapS || options.gapS || 0));
  const configured = Array.isArray(options.interSegmentGapsS)
    ? options.interSegmentGapsS
    : null;
  return Array.from({ length: gapCount }, (_, index) => {
    const value = configured ? Number(configured[index]) : fallback;
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
}

function resolveLocalInterSegmentPauseS({
  provider,
  segmentDurations = [],
  voiceSegments = [],
  text = "",
  env = process.env,
} = {}) {
  return resolveLocalInterSegmentPausePlan({
    provider,
    segmentDurations,
    voiceSegments,
    text,
    env,
  }).gapS;
}

function resolveLocalVoiceTargetMaxWpm(env = process.env) {
  return clampNumber(
    Number(
      env.STUDIO_V2_LOCAL_TTS_TARGET_MAX_WPM ||
        env.STUDIO_V2_LOCAL_TTS_MAX_WPM ||
        158,
    ),
    130,
    180,
  );
}

function resolveLocalMaxOutroLeadGapS(env = process.env) {
  return clampNumber(
    Number(
      env.STUDIO_V2_LOCAL_TTS_MAX_OUTRO_LEAD_GAP_S ||
        DEFAULT_LOCAL_TTS_MAX_OUTRO_LEAD_GAP_S,
    ),
    0,
    1.25,
  );
}

function resolveLocalMaxTitleFragmentGapS(env = process.env) {
  return clampNumber(
    Number(
      env.STUDIO_V2_LOCAL_TTS_MAX_TITLE_FRAGMENT_GAP_S ||
        DEFAULT_LOCAL_TTS_MAX_TITLE_FRAGMENT_GAP_S,
    ),
    0,
    0.75,
  );
}

function redistributeLocalGapExcess(gaps, excess, { maxPauseS, excluded = new Set() } = {}) {
  let remaining = Math.max(0, Number(excess || 0));
  if (remaining <= 0.001) return remaining;
  for (let index = 0; index < gaps.length && remaining > 0.001; index += 1) {
    if (excluded.has(index)) continue;
    const room = Math.max(0, maxPauseS - gaps[index]);
    if (room <= 0.001) continue;
    const add = Math.min(room, remaining);
    gaps[index] += add;
    remaining -= add;
  }
  return remaining;
}

function applyTitleFragmentGapCaps({ gaps, voiceSegments, maxPauseS, env }) {
  if (!gaps.length) return new Set();
  const capped = new Set();
  const maxTitleGapS = resolveLocalMaxTitleFragmentGapS(env);
  let excess = 0;
  for (let index = 0; index < gaps.length; index += 1) {
    if (
      gaps[index] > maxTitleGapS &&
      isSplitTitleFragmentBoundary(voiceSegments[index], voiceSegments[index + 1])
    ) {
      excess += gaps[index] - maxTitleGapS;
      gaps[index] = maxTitleGapS;
      capped.add(index);
    }
  }
  redistributeLocalGapExcess(gaps, excess, { maxPauseS, excluded: capped });
  return capped;
}

function resolveLocalInterSegmentGapSchedule({
  interSegmentPausePlan,
  voiceSegments = [],
  env = process.env,
} = {}) {
  const gapCount = Math.max(0, voiceSegments.length - 1);
  if (!gapCount) return [];
  const baseGapS = Math.max(0, Number(interSegmentPausePlan?.gapS || 0));
  const maxPauseS = Math.max(0, Number(interSegmentPausePlan?.maxPauseS || baseGapS));
  const gaps = Array.from({ length: gapCount }, () => baseGapS);
  const cappedTitleGaps = applyTitleFragmentGapCaps({
    gaps,
    voiceSegments,
    maxPauseS,
    env,
  });
  const last = voiceSegments[voiceSegments.length - 1];
  const hasOutro = String(last?.label || "").toLowerCase() === "outro";
  if (!hasOutro || baseGapS <= 0) {
    return gaps.map((gap) => Number(gap.toFixed(3)));
  }

  const outroLeadIndex = gapCount - 1;
  const maxOutroLeadGapS = resolveLocalMaxOutroLeadGapS(env);
  if (gaps[outroLeadIndex] <= maxOutroLeadGapS) {
    return gaps.map((gap) => Number(gap.toFixed(3)));
  }

  let excess = gaps[outroLeadIndex] - maxOutroLeadGapS;
  gaps[outroLeadIndex] = maxOutroLeadGapS;
  cappedTitleGaps.add(outroLeadIndex);
  excess = redistributeLocalGapExcess(gaps, excess, {
    maxPauseS,
    excluded: cappedTitleGaps,
  });
  return gaps.map((gap) => Number(gap.toFixed(3)));
}

function resolveLocalInterSegmentPausePlan({
  provider,
  segmentDurations = [],
  voiceSegments = [],
  text = "",
  env = process.env,
} = {}) {
  const durations = (segmentDurations || [])
    .map((duration) => Number(duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  const targetMaxWpm = resolveLocalVoiceTargetMaxWpm(env);
  const wordCount = countWords(
    text ||
      (voiceSegments || [])
        .map((segment) => segment?.text || segment?.cleanText || "")
        .join(" "),
  );
  const configuredTargetDurationS = clampNumber(
    Number(
      env.STUDIO_V2_LOCAL_TTS_TARGET_DURATION_S ||
        DEFAULT_LOCAL_TTS_TARGET_DURATION_S,
    ),
    50,
    75,
  );
  const wpmTargetDurationS =
    wordCount >= 20 ? (wordCount / targetMaxWpm) * 60 : 0;
  const targetDurationS = Number(
    Math.max(configuredTargetDurationS, wpmTargetDurationS).toFixed(3),
  );
  const basePlan = {
    version: LOCAL_INTER_SEGMENT_PAUSE_VERSION,
    gapS: 0,
    targetDurationS,
    configuredTargetDurationS,
    targetMaxWpm,
    wordCount,
    totalSegmentDurationS: durations.length
      ? Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(3))
      : 0,
    reason:
      wpmTargetDurationS > configuredTargetDurationS
        ? "target_wpm_guard"
        : "configured_target_duration",
    method: "concat_inserted_silence_between_native_rate_segments",
  };
  if (String(provider || "").toLowerCase() !== "local") {
    return { ...basePlan, reason: "non_local_provider" };
  }
  if (durations.length <= 1) return { ...basePlan, reason: "single_segment" };

  const maxPauseS = clampNumber(
    Number(
      env.STUDIO_V2_LOCAL_TTS_MAX_INTERSEGMENT_PAUSE_S ||
        DEFAULT_LOCAL_TTS_MAX_INTERSEGMENT_PAUSE_S,
    ),
    0,
    2.2,
  );
  const totalSegmentDurationS = durations.reduce((sum, duration) => sum + duration, 0);
  const missingS = targetDurationS - totalSegmentDurationS;
  if (missingS <= 0) {
    return {
      ...basePlan,
      totalSegmentDurationS: Number(totalSegmentDurationS.toFixed(3)),
      maxPauseS,
      missingS: Number(missingS.toFixed(3)),
      reason: "native_runtime_satisfies_target",
    };
  }
  return {
    ...basePlan,
    gapS: Number(Math.min(maxPauseS, missingS / (durations.length - 1)).toFixed(3)),
    totalSegmentDurationS: Number(totalSegmentDurationS.toFixed(3)),
    maxPauseS,
    missingS: Number(missingS.toFixed(3)),
  };
}

function resolveLocalTtsEngine(env = process.env) {
  const raw = String(
    env.LOCAL_TTS_ENGINE || env.STUDIO_V2_LOCAL_TTS_ENGINE || "voxcpm2",
  )
    .trim()
    .toLowerCase();
  if (raw.includes("chatterbox")) return "chatterbox";
  if (raw.includes("vox")) return "voxcpm2";
  return raw || "voxcpm2";
}

function productionVoiceStem(storyId, provider, env = process.env) {
  if (provider === "local") {
    const localEngine = resolveLocalTtsEngine(env);
    if (localEngine === "chatterbox") {
      return `${storyId}_studio_v1_chatterbox`;
    }
    return storyId === "1sn9xhe"
      ? "1sn9xhe_studio_v1_local"
      : `${storyId}_studio_v1_local`;
  }
  return storyId === "1sn9xhe"
    ? PRODUCTION_VOICE_STEM
    : `${storyId}_studio_v1_elevenlabs`;
}

function productionVoiceSource(provider, env = process.env) {
  if (provider !== "local") return "elevenlabs-production-path";
  const localEngine = resolveLocalTtsEngine(env);
  return localEngine === "chatterbox"
    ? "local-production-chatterbox-path"
    : "local-production-voxcpm-path";
}

function buildProductionVoiceSignature({
  provider,
  localEngine,
  voiceSegments,
  env = process.env,
}) {
  const isLocal = provider === "local";
  const baseVoiceSettings = brand.voiceSettings || {
    stability: 0.2,
    similarity_boost: 0.8,
    style: 0.75,
    speaking_rate: 1.0,
  };
  const signature = {
    provider,
    endpoint: "/v1/text-to-speech/{voiceId}/with-timestamps",
    voiceId: brand.voiceId || env.ELEVENLABS_VOICE_ID || "default",
    model: isLocal
      ? localEngine || resolveLocalTtsEngine(env)
      : brand.voiceModel || "eleven_multilingual_v2",
    voiceSettings: isLocal
      ? { ...baseVoiceSettings, speaking_rate: 1.0 }
      : baseVoiceSettings,
    preprocessing: "audio.cleanForTTS",
    dynamicPacing: "native-rate-segments",
    segments: voiceSegments || [],
  };

  if (isLocal) {
    const engine = localEngine || resolveLocalTtsEngine(env);
    signature.localEndpoint = env.LOCAL_TTS_URL || "http://127.0.0.1:8765";
    signature.localEngine = engine;
    signature.acceptedLocalVoice = resolveAcceptedLocalVoiceReference(env);
    signature.voiceMastering = buildVoiceMasteringSignature(env);
    signature.localPaceGuard = {
      version: LOCAL_PACE_GUARD_VERSION,
      minWpm: resolveLocalVoiceMinWpm(env),
      speakingRateMode:
        engine === "chatterbox"
          ? "server-ffmpeg-atempo-required"
          : "provider-speaking-rate",
    };
    signature.naturalInterSegmentPause = {
      version: LOCAL_INTER_SEGMENT_PAUSE_VERSION,
      targetDurationS: clampNumber(
        Number(
          env.STUDIO_V2_LOCAL_TTS_TARGET_DURATION_S ||
            DEFAULT_LOCAL_TTS_TARGET_DURATION_S,
        ),
        50,
        75,
      ),
      targetMaxWpm: resolveLocalVoiceTargetMaxWpm(env),
      maxPauseS: clampNumber(
        Number(
          env.STUDIO_V2_LOCAL_TTS_MAX_INTERSEGMENT_PAUSE_S ||
            DEFAULT_LOCAL_TTS_MAX_INTERSEGMENT_PAUSE_S,
        ),
        0,
        2.2,
      ),
      maxOutroLeadGapS: resolveLocalMaxOutroLeadGapS(env),
      method: "concat_inserted_silence_between_native_rate_segments_outro_capped",
    };
  }

  return signature;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function resolveLocalVoiceMinWpm(env = process.env) {
  return clampNumber(Number(env.STUDIO_V2_LOCAL_TTS_MIN_WPM || 105), 80, 170);
}

function evaluateLocalVoicePace({
  provider,
  source,
  durationS,
  alignment,
  text,
  env = process.env,
} = {}) {
  if (String(provider || "").toLowerCase() !== "local") {
    return { ok: true, skipped: true, reason: "non-local provider" };
  }

  const duration = Number(durationS);
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      ok: false,
      source,
      durationS: null,
      wordCount: 0,
      wpm: 0,
      minWpm: resolveLocalVoiceMinWpm(env),
      reason: "local TTS duration is unknown",
    };
  }

  const alignedText = alignment ? alignmentText(alignment) : "";
  const wordCount = countWords(alignedText || text || "");
  const minWpm = resolveLocalVoiceMinWpm(env);
  if (wordCount < 20) {
    return {
      ok: true,
      skipped: true,
      source,
      durationS: Number(duration.toFixed(3)),
      wordCount,
      wpm: Number(((wordCount / duration) * 60).toFixed(1)),
      minWpm,
      reason: "too little text for a whole-voice pace guard",
    };
  }

  const wpm = Number(((wordCount / duration) * 60).toFixed(1));
  const ok = wpm >= minWpm;
  return {
    ok,
    source,
    durationS: Number(duration.toFixed(3)),
    wordCount,
    wpm,
    minWpm,
    reason: ok
      ? "local TTS pace is publishable"
      : `local TTS pace ${wpm} WPM is below minimum ${minWpm} WPM`,
  };
}

function applyLocalVoiceRateMultiplier(segments, env = process.env) {
  const localEngine = resolveLocalTtsEngine(env);
  if (localEngine === "chatterbox") {
    const multiplier = clampNumber(
      Number(env.STUDIO_V2_CHATTERBOX_RATE_MULTIPLIER || 1.65),
      0.75,
      2.1,
    );
    const effectiveRateCap = clampNumber(
      Number(env.STUDIO_V2_CHATTERBOX_EFFECTIVE_RATE_CAP || 1.95),
      0.85,
      2.1,
    );
    return (segments || []).map((segment) => ({
      ...segment,
      rate: Number(
        Math.min(Number(segment.rate || 1) * multiplier, effectiveRateCap).toFixed(3),
      ),
    }));
  }

  const multiplier = clampNumber(
    Number(env.STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER || 1.75),
    0.75,
    2.1,
  );
  const baseSpeed = clampNumber(
    Number(env.STUDIO_V2_LOCAL_TTS_BASE_SPEED || 1.0),
    0.5,
    3.0,
  );
  const effectiveRateCap = clampNumber(
    Number(env.STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP || 1.0),
    1.0,
    2.4,
  );
  const maxProviderRate = effectiveRateCap / baseSpeed;
  return (segments || []).map((segment) => ({
    ...segment,
    rate: Number(
      Math.min(Number(segment.rate || 1) * multiplier, maxProviderRate).toFixed(3),
    ),
  }));
}

function splitSentenceLikeText(text) {
  const input = String(text || "").replace(/\s+/g, " ").trim();
  if (!input) return [];
  const sentenceMatches = input.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return (sentenceMatches || [input])
    .map((part) => part.trim())
    .filter(Boolean);
}

function normaliseVoicePhraseWord(word) {
  return String(word || "")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .toLowerCase();
}

function cleanVoicePhraseWord(word) {
  return String(word || "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function isTitlePhraseWord(word) {
  const clean = cleanVoicePhraseWord(word);
  if (!clean) return false;
  if (/^\d/.test(clean)) return true;
  if (/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/i.test(clean)) return true;
  if (/^[A-Z0-9]{2,}$/.test(clean)) return true;
  return /^[A-Z][A-Za-z0-9]*(?:[-'][A-Z0-9][A-Za-z0-9]*)*$/.test(clean);
}

function mergeProtectedVoiceSpans(spans) {
  const sorted = spans
    .filter((span) => span && span.end - span.start > 1)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }
  return merged;
}

function protectedVoiceSpans(words) {
  const normalised = words.map(normaliseVoicePhraseWord);
  const spans = [];

  for (const phrase of FIXED_PROTECTED_VOICE_PHRASES) {
    for (let i = 0; i <= normalised.length - phrase.length; i++) {
      const matches = phrase.every((part, offset) => normalised[i + offset] === part);
      if (matches) spans.push({ start: i, end: i + phrase.length });
    }
  }

  for (let i = 0; i < words.length; i++) {
    if (!isTitlePhraseWord(words[i])) continue;
    let j = i + 1;
    let strongWords = 1;
    while (j < words.length) {
      if (isTitlePhraseWord(words[j])) {
        strongWords += 1;
        j += 1;
        continue;
      }
      if (
        TITLE_PHRASE_CONNECTORS.has(normalised[j]) &&
        j + 1 < words.length &&
        isTitlePhraseWord(words[j + 1])
      ) {
        j += 1;
        continue;
      }
      break;
    }
    if (strongWords >= 2) spans.push({ start: i, end: j });
    i = Math.max(i, j - 1);
  }

  return mergeProtectedVoiceSpans(spans);
}

function moveBoundaryAwayFromProtectedVoicePhrase({ words, start, boundary, spans }) {
  if (boundary >= words.length) return words.length;
  const hit = spans.find(
    (span) => span.start < boundary && boundary < span.end && span.end > start,
  );
  if (!hit) return boundary;
  if (hit.start > start) return hit.start;
  return Math.min(words.length, hit.end);
}

function voicePhraseWords(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function titleFragmentStats(text) {
  const words = voicePhraseWords(text);
  let strong = 0;
  let allTitleOrConnector = words.length > 0;
  let hasAcronymOrNumber = false;
  for (const word of words) {
    const clean = cleanVoicePhraseWord(word);
    const normalised = normaliseVoicePhraseWord(word);
    if (isTitlePhraseWord(word)) {
      strong += 1;
      if (/^\d/.test(clean) || /^[A-Z0-9]{2,}$/.test(clean)) {
        hasAcronymOrNumber = true;
      }
    } else if (!TITLE_PHRASE_CONNECTORS.has(normalised)) {
      allTitleOrConnector = false;
    }
  }
  return {
    words,
    wordCount: words.length,
    strong,
    allTitleOrConnector,
    hasAcronymOrNumber,
  };
}

function leadingTitlePhraseStats(text) {
  const words = voicePhraseWords(text);
  let strong = 0;
  let consumed = 0;
  let firstStrong = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const normalised = normaliseVoicePhraseWord(word);
    if (isTitlePhraseWord(word)) {
      strong += 1;
      consumed = index + 1;
      if (!firstStrong) firstStrong = normalised;
      continue;
    }
    if (
      TITLE_PHRASE_CONNECTORS.has(normalised) &&
      index + 1 < words.length &&
      isTitlePhraseWord(words[index + 1])
    ) {
      consumed = index + 1;
      continue;
    }
    break;
  }
  return {
    words,
    wordCount: words.length,
    leadingWordCount: consumed,
    leadingStrong: strong,
    firstStrong,
  };
}

function isSplitTitleFragmentBoundary(left, right) {
  const leftStats = titleFragmentStats(left?.text || "");
  if (
    leftStats.wordCount < 1 ||
    leftStats.wordCount > 5 ||
    leftStats.strong < 1 ||
    !leftStats.allTitleOrConnector
  ) {
    return false;
  }

  const rightStats = leadingTitlePhraseStats(right?.text || "");
  if (rightStats.leadingStrong < 1) return false;
  if (TITLE_CONTINUATION_FALSE_STARTERS.has(rightStats.firstStrong)) {
    return false;
  }

  return (
    rightStats.leadingStrong >= 2 ||
    leftStats.strong >= 2 ||
    leftStats.hasAcronymOrNumber
  );
}

function splitOversizedSentence(sentence, maxWords) {
  const words = String(sentence || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [sentence.trim()];
  const chunks = [];
  const spans = protectedVoiceSpans(words);
  for (let i = 0; i < words.length;) {
    let next = Math.min(i + maxWords, words.length);
    next = moveBoundaryAwayFromProtectedVoicePhrase({
      words,
      start: i,
      boundary: next,
      spans,
    });
    if (next <= i) next = Math.min(i + maxWords, words.length);
    chunks.push(words.slice(i, next).join(" "));
    i = next;
  }
  return chunks;
}

function packTextChunks(text, { maxWords, maxChars }) {
  const chunks = [];
  let current = "";
  let currentWords = 0;
  const sentences = splitSentenceLikeText(text)
    .flatMap((sentence) => splitOversizedSentence(sentence, maxWords));

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    const next = current ? `${current} ${sentence}` : sentence;
    if (
      current &&
      (currentWords + words > maxWords || next.length > maxChars)
    ) {
      chunks.push(current);
      current = sentence;
      currentWords = words;
    } else {
      current = next;
      currentWords += words;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongVoiceSegments(segments, opts = {}, env = process.env) {
  const maxWords = Math.max(
    8,
    Number(
      opts.maxWords ||
        env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_WORDS ||
        32,
    ),
  );
  const maxChars = Math.max(
    80,
    Number(
      opts.maxChars ||
        env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_CHARS ||
        260,
    ),
  );

  const out = [];
  for (const segment of segments || []) {
    const text = String(segment?.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words <= maxWords && text.length <= maxChars) {
      out.push({ ...segment, text });
      continue;
    }
    const chunks = packTextChunks(text, { maxWords, maxChars });
    chunks.forEach((chunk, index) => {
      out.push({
        ...segment,
        label: `${segment.label || "segment"}_${index + 1}`,
        text: chunk,
      });
    });
  }
  return out;
}

async function ensureProductionVoice({
  root,
  storyId,
  editorial,
  force = false,
  provider = "elevenlabs",
}) {
  const isLocal = provider === "local";
  const localEngine = isLocal ? resolveLocalTtsEngine(process.env) : null;
  const outputStem = productionVoiceStem(storyId, provider, process.env);
  const outputRel = path.join("output", "audio", `${outputStem}.mp3`);
  const outputTsRel = outputRel.replace(/\.mp3$/, "_timestamps.json");
  const outputMp3 = mediaPaths.writePath(outputRel);
  const outputTs = mediaPaths.writePath(outputTsRel);
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
    : [
        {
          label: "full",
          text: fallbackText,
          rate: isLocal ? 1.0 : brand.voiceSettings?.speaking_rate || 1.0,
        },
      ];
  const voiceSegments = isLocal
    ? splitLongVoiceSegments(applyLocalVoiceRateMultiplier(segmentPayload))
    : segmentPayload;
  const signature = buildProductionVoiceSignature({
    provider,
    localEngine,
    voiceSegments,
    env: process.env,
  });
  const signatureHash = hashJson(signature);
  const displayText =
    editorial?.scriptForCaption || editorial?.fullScript || fallbackText;

  if (!fallbackText.trim() && !segments.length) {
    throw new Error("[studio-v1] production voice path has no script text");
  }

  const existingMp3 = await mediaPaths.resolveExisting(outputRel);
  const existingTs = await mediaPaths.resolveExisting(outputTsRel);
  if (
    !force &&
    existingMp3 &&
    existingTs &&
    (await fs.pathExists(existingMp3)) &&
    (await fs.pathExists(existingTs))
  ) {
    const existing = await fs.readJson(existingTs).catch(() => null);
    if (existing?.meta?.signatureHash === signatureHash) {
      const durationS = ffprobeDuration(existingMp3);
      const pace = evaluateLocalVoicePace({
        provider,
        source: productionVoiceSource(provider, process.env),
        durationS,
        alignment: existing?.alignment || existing,
        text: existing?.meta?.text,
        env: process.env,
      });
      if (!pace.ok) {
        console.warn(
          `[studio-v1] ignoring cached local TTS for ${storyId}: ${pace.reason}`,
        );
      } else {
      const segmentTimeline = existing?.meta?.segmentTimeline || [];
      const outroSegment = segmentTimeline.find(
        (segment) => segment.label === "outro",
      );
      return {
        stem: outputStem,
        audioPath: existingMp3,
        timestampsPath: existingTs,
        source: productionVoiceSource(provider, process.env),
        warning: null,
        wasTrimmed: false,
        durationS,
        editorialScriptAppliedToAudio: true,
        timestampSource: isLocal
          ? "local-tts-forced-alignment"
          : "elevenlabs-with-timestamps",
        provider,
        voiceId: signature.voiceId,
        model: signature.model,
        voiceSettings: signature.voiceSettings,
        preprocessing: signature.preprocessing,
        dynamicPacing: signature.dynamicPacing,
        signatureHash,
        acceptedLocalVoice: signature.acceptedLocalVoice || null,
        localPace: pace,
        segmentTimeline,
        outroStartS: outroSegment?.startS,
        outroEndS: outroSegment?.endS,
      };
      }
    }
  }

  if (!isLocal && !process.env.ELEVENLABS_API_KEY) {
    throw new Error("[studio-v1] ELEVENLABS_API_KEY is required for production voice path");
  }

  await fs.ensureDir(path.dirname(outputMp3));
  const originalProvider = process.env.TTS_PROVIDER;
  process.env.TTS_PROVIDER = provider;

  try {
    let alignment;
    let cleanedAudioText;
    let segmentTimeline = [];
    let sourceVoiceMeta = {};
    let interSegmentPausePlan = null;

    if (voiceSegments.length > 1) {
      const segmentRelPaths = [];
      const segmentDurations = [];
      let cumulativeS = 0;
      for (const segment of voiceSegments) {
        const segmentRel = path.join(
          "output",
          "audio",
          `${outputStem}_${segment.label}.mp3`,
        );
        await productionAudio.generateTTS(
          segment.text,
          segmentRel,
          segment.rate,
        );
        segmentRelPaths.push(segmentRel);
        const segmentAbs =
          (await mediaPaths.resolveExisting(segmentRel)) || segmentRel;
        const durationS = ffprobeDuration(segmentAbs) || 0;
        segmentDurations.push(durationS);
        segmentTimeline.push({
          label: segment.label,
          startS: Number(cumulativeS.toFixed(3)),
          endS: Number((cumulativeS + durationS).toFixed(3)),
          durationS: Number(durationS.toFixed(3)),
        });
        cumulativeS += durationS;
      }

      interSegmentPausePlan = resolveLocalInterSegmentPausePlan({
        provider,
        segmentDurations,
        voiceSegments,
        env: process.env,
      });
      const interSegmentGapS = interSegmentPausePlan.gapS;
      const interSegmentGapsS = resolveLocalInterSegmentGapSchedule({
        interSegmentPausePlan,
        voiceSegments,
        env: process.env,
      });
      if (interSegmentGapsS.some((gap) => gap > 0)) {
        cumulativeS = 0;
        segmentTimeline = segmentTimeline.map((segment, index) => {
          const startS = cumulativeS;
          const endS = startS + segment.durationS;
          const gapAfterS =
            index < segmentTimeline.length - 1 ? interSegmentGapsS[index] || 0 : 0;
          cumulativeS = endS + gapAfterS;
          return {
            ...segment,
            startS: Number(startS.toFixed(3)),
            endS: Number(endS.toFixed(3)),
            interSegmentGapAfterS: Number(gapAfterS.toFixed(3)),
          };
        });
      }

      await productionAudio.concatAudioFiles(segmentRelPaths, outputRel, {
        interSegmentGapS,
        interSegmentGapsS,
      });
      alignment = await mergeSegmentAlignments(segmentRelPaths, {
        interSegmentGapS,
        interSegmentGapsS,
      });
      sourceVoiceMeta = await collectSegmentVoiceMeta(segmentRelPaths);
      cleanedAudioText = voiceSegments.map((segment) => segment.text).join(" ");

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
      const text = voiceSegments[0]?.text || fallbackText;
      await productionAudio.generateTTS(text, outputRel, voiceSegments[0].rate);
      const payload = await fs.readJson((await mediaPaths.resolveExisting(outputTsRel)) || outputTsRel);
      alignment = payload.alignment || payload;
      sourceVoiceMeta = voiceMetaFromPayload(payload);
      cleanedAudioText = text;
      const durationS = ffprobeDuration(outputMp3) || 0;
      segmentTimeline = [
        {
          label: voiceSegments[0]?.label || "full",
          startS: 0,
          endS: Number(durationS.toFixed(3)),
          durationS: Number(durationS.toFixed(3)),
        },
      ];
    }

    const words = wordsFromAlignment(alignment);
    const outroSegment = segmentTimeline.find(
      (segment) => segment.label === "outro",
    );
    const alignmentRepairMeta =
      alignment?.meta && typeof alignment.meta === "object"
        ? {
            timestampRepair: alignment.meta.timestampRepair || null,
            segmentTimestampRepairs:
              alignment.meta.segmentTimestampRepairs || undefined,
          }
        : {};
    await fs.writeJson(
      outputTs,
      {
        alignment,
        words,
        meta: {
          ...signature,
          ...Object.fromEntries(
            Object.entries(alignmentRepairMeta).filter(([, value]) => value),
          ),
          signatureHash,
          scriptHash: hashScript(cleanedAudioText),
          text: cleanedAudioText,
          displayText,
          segmentTimeline,
          voiceMastering: sourceVoiceMeta.voiceMastering,
          acoustic: sourceVoiceMeta.acoustic,
          voiceDiagnostics: sourceVoiceMeta.voiceDiagnostics,
          generation: {
            ...(sourceVoiceMeta.generation || {}),
            naturalInterSegmentPause:
              provider === "local" && voiceSegments.length > 1
                ? {
                    ...interSegmentPausePlan,
                    applied: segmentTimeline.some(
                      (segment) => Number(segment.interSegmentGapAfterS || 0) > 0,
                    ),
                    gap_s: Number(segmentTimeline[0]?.interSegmentGapAfterS || 0),
                    gap_schedule_s: segmentTimeline
                      .slice(0, -1)
                      .map((segment) => Number(segment.interSegmentGapAfterS || 0)),
                    target_duration_s: interSegmentPausePlan.targetDurationS,
                    method: "concat_inserted_silence_between_native_rate_segments_outro_capped",
                  }
                : null,
          },
          segmentVoiceMastering: sourceVoiceMeta.segmentVoiceMastering,
          outroStartS: outroSegment?.startS,
          outroEndS: outroSegment?.endS,
          generatedAt: new Date().toISOString(),
        },
      },
      { spaces: 2 },
    );

    if (isLocal) {
      const durationS = ffprobeDuration(outputMp3) || 0;
      const pace = evaluateLocalVoicePace({
        provider,
        source: productionVoiceSource(provider, process.env),
        durationS,
        alignment,
        text: cleanedAudioText,
        env: process.env,
      });
      if (!pace.ok) {
        throw new Error(`[studio-v1] local TTS pace guard failed: ${pace.reason}`);
      }
    }
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
    source: productionVoiceSource(provider, process.env),
    warning: null,
    wasTrimmed: false,
    durationS: ffprobeDuration(outputMp3),
    editorialScriptAppliedToAudio: true,
    timestampSource: isLocal
      ? "local-tts-forced-alignment"
      : "elevenlabs-with-timestamps",
    provider,
    voiceId: signature.voiceId,
    model: signature.model,
    voiceSettings: signature.voiceSettings,
    preprocessing: signature.preprocessing,
    dynamicPacing: signature.dynamicPacing,
    signatureHash,
    acceptedLocalVoice: signature.acceptedLocalVoice || null,
    localPace: (() => {
      try {
        const data = fs.readJsonSync(outputTs);
        const durationS = ffprobeDuration(outputMp3) || 0;
        return evaluateLocalVoicePace({
          provider,
          source: productionVoiceSource(provider, process.env),
          durationS,
          alignment: data?.alignment || data,
          text: data?.meta?.text,
          env: process.env,
        });
      } catch {
        return null;
      }
    })(),
    segmentTimeline: (() => {
      try {
        const data = fs.readJsonSync(outputTs);
        return data?.meta?.segmentTimeline || [];
      } catch {
        return [];
      }
    })(),
    outroStartS: (() => {
      try {
        const data = fs.readJsonSync(outputTs);
        return data?.meta?.outroStartS;
      } catch {
        return undefined;
      }
    })(),
    outroEndS: (() => {
      try {
        const data = fs.readJsonSync(outputTs);
        return data?.meta?.outroEndS;
      } catch {
        return undefined;
      }
    })(),
  };
}

async function ensureProductionElevenLabsVoice(args) {
  return ensureProductionVoice({ ...args, provider: "elevenlabs" });
}

async function ensureProductionLocalVoice(args) {
  return ensureProductionVoice({ ...args, provider: "local" });
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
  ensureProductionLocalVoice,
  buildProductionVoiceSignature,
  buildProductionVoiceSegments,
  discoverSoundAssets,
  buildAudioInputSpecs,
  buildAudioMixFilters,
  cueTimesForScenes,
  trimAlignment,
  findCtaCutoff,
  mergeSegmentAlignments,
  applyLocalVoiceRateMultiplier,
  resolveLocalInterSegmentPauseS,
  resolveLocalInterSegmentPausePlan,
  resolveLocalInterSegmentGapSchedule,
  evaluateLocalVoicePace,
  resolveLocalTtsEngine,
  resolveLocalVoiceMinWpm,
  resolveAcceptedLocalVoiceReference,
  splitLongVoiceSegments,
  resolveStudioOutroLine,
  alignmentText,
  wordsFromAlignment,
  STUDIO_LIAM_STEM,
  FRESH_LIAM_STEM,
  PRODUCTION_VOICE_STEM,
  ACCEPTED_LOCAL_VOICE_ID,
};
