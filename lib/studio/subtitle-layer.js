"use strict";

const fs = require("fs-extra");
const { buildAss } = require("../caption-emphasis");

function charsToWords(alignment) {
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

function normaliseTimestampWords(data) {
  if (Array.isArray(data?.words)) return data.words;
  if (Array.isArray(data?.alignment?.words)) return data.alignment.words;
  if (Array.isArray(data?.characters)) return charsToWords(data);
  if (Array.isArray(data?.alignment?.characters)) {
    return charsToWords(data.alignment);
  }
  return [];
}

function assTimeToSeconds(value) {
  const parts = String(value || "0:00:00.00")
    .split(":")
    .map(Number.parseFloat);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function inspectAss(assText, audioDurationS) {
  const dialogue = String(assText || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Dialogue:"));

  const events = dialogue
    .map((line) => {
      const m = line.match(/^Dialogue:\s*\d+,([^,]+),([^,]+),/);
      if (!m) return null;
      return {
        startS: assTimeToSeconds(m[1]),
        endS: assTimeToSeconds(m[2]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startS - b.startS);

  let maxGapS = 0;
  let lastEndS = 0;
  for (const event of events) {
    if (event.startS > lastEndS) {
      maxGapS = Math.max(maxGapS, event.startS - lastEndS);
    }
    lastEndS = Math.max(lastEndS, event.endS);
  }

  return {
    dialogueLines: dialogue.length,
    firstStartS: events[0]?.startS ?? null,
    lastDialogueEndS: Number(lastEndS.toFixed(2)),
    maxGapS: Number(maxGapS.toFixed(2)),
    runsPastAudio: Number.isFinite(audioDurationS)
      ? lastEndS > audioDurationS + 0.1
      : false,
    blackoutRisk: maxGapS > 3.0 || dialogue.length === 0,
    status:
      dialogue.length === 0
        ? "missing"
        : maxGapS > 3.0
          ? "blackout-risk"
          : lastEndS > audioDurationS + 0.1
            ? "runs-past-audio"
            : "aligned",
  };
}

function applyStudioCaptionStyle(assText) {
  return String(assText || "")
    .replace(
      /^Style: Caption,.*$/m,
      "Style: Caption,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC8000000,-1,0,0,0,100,100,0,0,1,4,2,2,64,64,240,1",
    )
    .replace(
      /^Style: Emphasis,.*$/m,
      "Style: Emphasis,Arial,68,&H001A6BFF,&H001A6BFF,&H00000000,&HC8000000,-1,0,0,0,108,108,0,0,1,4,2,2,64,64,240,1",
    );
}

async function buildStudioSubtitles({
  story,
  timestampsPath,
  durationS,
  scriptText,
  outputPath,
}) {
  const data = await fs.readJson(timestampsPath);
  const words = normaliseTimestampWords(data);
  let assText = applyStudioCaptionStyle(
    buildAss({ story, words, duration: durationS, scriptText }),
  );
  let inspection = inspectAss(assText, durationS);

  if (inspection.blackoutRisk || inspection.dialogueLines === 0) {
    const fallbackText = scriptText || story?.fullScript || story?.full_script || story?.body || story?.hook || "";
    assText = applyStudioCaptionStyle(
      buildEvenlySpacedAss({
        story,
        text: fallbackText,
        durationS,
      }),
    );
    inspection = {
      ...inspectAss(assText, durationS),
      fallbackUsed: true,
      fallbackReason: inspection.status,
    };
    inspection.status = "safe-fallback";
  } else {
    inspection.fallbackUsed = false;
  }

  await fs.writeFile(outputPath, assText);
  return {
    outputPath,
    words: words.length,
    status: inspection.status,
    inspection,
  };
}

function buildEvenlySpacedAss({ story, text, durationS }) {
  const tokens = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const words = [];
  const safeTokens = tokens.length ? tokens : ["Pulse", "Gaming"];
  const per = durationS / safeTokens.length;
  for (let i = 0; i < safeTokens.length; i++) {
    words.push({
      word: safeTokens[i],
      start: i * per,
      end: (i + 1) * per,
    });
  }
  return buildAss({ story, words, duration: durationS, scriptText: text });
}

module.exports = {
  buildStudioSubtitles,
  normaliseTimestampWords,
  charsToWords,
  inspectAss,
  assTimeToSeconds,
  applyStudioCaptionStyle,
};
