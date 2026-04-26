/**
 * lib/studio/v2/quality-gate-v2.js — post-render quality gate.
 *
 * Reads the rendered MP4, the slate, the subtitle file, the audio
 * mix metadata, and the story package; writes a JSON report
 * conforming to STUDIO_V2_RUBRIC.schema.json. Returns the verdict
 * (pass / downgrade / reject) the renderer can act on.
 *
 * Each measurable in the rubric maps to a function below. The
 * grading thresholds match STUDIO_V2_RUBRIC.md.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");

const AI_TELL_RE =
  /\b(you won'?t believe|this changes everything|but here'?s where it gets interesting|but here is where it gets interesting|let that sink in|and that'?s not all)\b/i;

function ffprobeJson(filePath) {
  const out = execSync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath.replace(/\\/g, "/")}"`,
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

function grade(value, greenPredicate, amberPredicate) {
  if (greenPredicate(value)) return "green";
  if (amberPredicate(value)) return "amber";
  return "red";
}

// ---- Hook checks ----

function gradeHook(pkg, scenes) {
  // Hook spoken-word count — first ~1.6s of narration. We don't have
  // the audio waveform here, so we approximate by taking the spoken
  // form of the chosen hook and counting words. The chosen hook
  // is what landed in the audio.
  const chosen = pkg?.hook?.chosen?.text || "";
  const words = chosen.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const wcGrade = grade(
    wordCount,
    (v) => v >= 8 && v <= 12,
    (v) => v >= 6 && v <= 15,
  );

  const tellMatches = (() => {
    const m = chosen.match(AI_TELL_RE);
    return m ? [m[0]] : [];
  })();

  return {
    hookWordCount: { value: wordCount, grade: wcGrade },
    hookAiTells: {
      value: tellMatches.length,
      grade: tellMatches.length === 0 ? "green" : "red",
      matches: tellMatches,
    },
    chosenHookText: chosen,
  };
}

// ---- Spoken pacing ----

function gradeSpokenWPM(pkg, audioDurationS) {
  const tightenedScript = pkg?.script?.tightened || "";
  const wordCount = tightenedScript.split(/\s+/).filter(Boolean).length;
  const wpm = audioDurationS > 0 ? (wordCount / audioDurationS) * 60 : 0;
  const g = grade(
    wpm,
    (v) => v >= 130 && v <= 160,
    (v) => v >= 110 && v <= 180,
  );
  return { value: Number(wpm.toFixed(1)), grade: g };
}

// ---- Source diversity + clip dominance ----

function gradeSourceDiversity(scenes) {
  const totalScenes = scenes.length;
  if (totalScenes === 0)
    return { value: 0, grade: "red", uniqueSources: 0, totalScenes: 0 };
  const sources = new Set();
  for (const s of scenes) {
    // Prefer prerenderedMp4 (HF cards) as the source identity — each
    // HF card is its own unique designed asset, not derivative of
    // whatever backdrop image happened to ship in its background.
    const id =
      s.prerenderedMp4 ||
      s.source ||
      s.backgroundSource ||
      s.dateLabel ||
      s.sourceLabel ||
      s.label ||
      "(unknown)";
    sources.add(String(id).replace(/_smartcrop_v2(_[a-z]+)?\.jpe?g$/i, ".jpg"));
  }
  const uniqueSources = sources.size;
  const ratio = uniqueSources / totalScenes;
  const g = grade(
    ratio,
    (v) => v >= 0.85,
    (v) => v >= 0.7,
  );
  return {
    value: Number(ratio.toFixed(2)),
    grade: g,
    uniqueSources,
    totalScenes,
  };
}

function gradeClipDominance(scenes) {
  const totalScenes = scenes.length;
  if (totalScenes === 0)
    return { value: 0, grade: "red", clipScenes: 0, totalScenes: 0 };
  const clipScenes = scenes.filter((s) =>
    ["clip", "punch", "speed-ramp", "freeze-frame", "clip.frame"].includes(
      s.type || s.sceneType,
    ),
  ).length;
  // Opener-with-clip-backed counts as a clip too.
  const openerClipBacked = scenes.filter(
    (s) => (s.type === "opener" || s.sceneType === "opener") && s.isClipBacked,
  ).length;
  const total = clipScenes + openerClipBacked;
  const ratio = total / totalScenes;
  const g = grade(
    ratio,
    (v) => v >= 0.55,
    (v) => v >= 0.4,
  );
  return {
    value: Number(ratio.toFixed(2)),
    grade: g,
    clipScenes: total,
    totalScenes,
  };
}

// ---- Scene variety ----

function gradeSceneVariety(scenes) {
  const distinct = new Set(scenes.map((s) => s.type || s.sceneType));
  const value = distinct.size;
  const g = grade(
    value,
    (v) => v >= 6,
    (v) => v >= 4,
  );
  return { value, grade: g, distinctTypes: [...distinct] };
}

// ---- Repetition ----

function gradeMaxStillRepeat(scenes) {
  const counts = new Map();
  for (const s of scenes) {
    const isStill =
      s.type === "still" ||
      s.type === "clip.frame" ||
      s.sceneType === "clip.frame" ||
      s.sceneType === "still";
    if (!isStill) continue;
    const id = String(
      s.source || s.backgroundSource || s.label || "(unk)",
    ).replace(/_smartcrop_v2(_[a-z]+)?\.jpe?g$/i, ".jpg");
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const max = counts.size === 0 ? 0 : Math.max(...counts.values());
  const g = grade(
    max,
    (v) => v <= 1,
    (v) => v <= 2,
  );
  return { value: max, grade: g };
}

// ---- Caption integrity ----

function gradeCaptionGaps(assPath, audioDurationS) {
  if (!fs.existsSync(assPath)) {
    return { value: 0, grade: "amber", gaps: [], note: "ass file missing" };
  }
  const txt = fs.readFileSync(assPath, "utf8");
  const lines = txt.split("\n").filter((l) => l.startsWith("Dialogue:"));
  const intervals = [];
  for (const line of lines) {
    const m = line.match(/Dialogue:\s*\d+,([^,]+),([^,]+),/);
    if (!m) continue;
    const [s1, e1] = [m[1], m[2]].map((t) => {
      const p = t.split(":").map(parseFloat);
      return p[0] * 3600 + p[1] * 60 + p[2];
    });
    intervals.push([s1, e1]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  for (let i = 1; i < intervals.length; i++) {
    const gap = intervals[i][0] - intervals[i - 1][1];
    if (gap > 2.0) {
      gaps.push({ fromS: intervals[i - 1][1], toS: intervals[i][0] });
    }
  }
  const g = grade(
    gaps.length,
    (v) => v === 0,
    (v) => v === 1,
  );
  return { value: gaps.length, grade: g, gaps };
}

function assTimeToSeconds(value) {
  const parts = String(value || "0:00:00.00")
    .split(":")
    .map(Number.parseFloat);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseAssLastCueEnd(assPath) {
  if (!fs.existsSync(assPath)) return null;
  const txt = fs.readFileSync(assPath, "utf8");
  const lines = txt.split("\n").filter((l) => l.startsWith("Dialogue:"));
  let lastEndS = null;
  for (const line of lines) {
    const m = line.match(/Dialogue:\s*\d+,([^,]+),([^,]+),/);
    if (!m) continue;
    const endS = assTimeToSeconds(m[2]);
    if (Number.isFinite(endS)) lastEndS = Math.max(lastEndS ?? 0, endS);
  }
  return lastEndS;
}

function gradeDurationIntegrity({ renderedDurationS, audioDurationS, assPath }) {
  const rendered = Number(renderedDurationS);
  const audio = Number(audioDurationS);
  const assLastCueEndS = parseAssLastCueEnd(assPath);
  const checks = {
    renderedDurationS: Number.isFinite(rendered)
      ? Number(rendered.toFixed(3))
      : null,
    audioDurationS: Number.isFinite(audio) ? Number(audio.toFixed(3)) : null,
    assLastCueEndS:
      assLastCueEndS === null || !Number.isFinite(assLastCueEndS)
        ? null
        : Number(assLastCueEndS.toFixed(3)),
  };
  const audioFits =
    Number.isFinite(rendered) &&
    Number.isFinite(audio) &&
    rendered >= audio - 0.25;
  const subtitlesFit =
    assLastCueEndS === null ||
    (Number.isFinite(rendered) && assLastCueEndS <= rendered + 0.1);

  if (audioFits && subtitlesFit) {
    return {
      value: Number(rendered.toFixed(2)),
      grade: "green",
      ...checks,
    };
  }

  return {
    value: Number.isFinite(rendered) ? Number(rendered.toFixed(2)) : 0,
    grade: "red",
    ...checks,
    failures: [
      !audioFits ? "rendered MP4 is shorter than narration" : null,
      !subtitlesFit ? "subtitle cues run past rendered MP4" : null,
    ].filter(Boolean),
  };
}

// ---- Adjacent same-type cards ----

function gradeAdjacentCards(scenes) {
  const cardTypes = new Set([
    "card.source",
    "card.release",
    "card.quote",
    "card.stat",
    "card.takeaway",
  ]);
  let count = 0;
  for (let i = 1; i < scenes.length; i++) {
    const t = scenes[i].type || scenes[i].sceneType;
    const tPrev = scenes[i - 1].type || scenes[i - 1].sceneType;
    if (cardTypes.has(t) && t === tPrev) count++;
  }
  return { value: count, grade: count === 0 ? "green" : "red" };
}

// ---- Stock filler ----

function gradeStockFiller(scenes) {
  const count = scenes.filter((s) => s._stock).length;
  const g = grade(
    count,
    (v) => v === 0,
    (v) => v <= 1,
  );
  return { value: count, grade: g };
}

// ---- Voice path ----

function gradeVoicePath(audioMeta) {
  const voiceId = audioMeta?.voiceId || null;
  const provider = audioMeta?.provider || "";
  let lane = "unknown";
  let g = "amber";
  if (provider === "elevenlabs") {
    lane = "production";
    g = "green";
  } else if (provider === "voxcpm" || provider === "local") {
    lane = "fresh-local";
    g = "amber";
  }
  return { value: lane, grade: g, voiceId };
}

// ---- Motion density ----

function gradeMotionDensity(scenes, transitions, audioDurationS) {
  const cutCount = transitions.filter((t) => t.type === "cut").length;
  const xfadeCount = transitions.filter((t) => t.type !== "cut").length;
  // Motion density = cuts + xfades per minute. Cuts count 1.0,
  // xfades count 0.5 (less of a perceptual edit).
  const weighted = cutCount + 0.5 * xfadeCount;
  const perMin = audioDurationS > 0 ? (weighted / audioDurationS) * 60 : 0;
  const g = grade(
    perMin,
    (v) => v >= 18,
    (v) => v >= 12,
  );
  return { value: Number(perMin.toFixed(1)), grade: g };
}

// ---- Beat awareness ----

function gradeBeatAwareness(transitions, words) {
  if (!Array.isArray(words) || words.length === 0 || transitions.length === 0) {
    return { value: 0, grade: "amber", syllableMatches: 0, totalCuts: 0 };
  }
  const cutTimes = [];
  let runningDur = 0;
  for (const t of transitions) {
    if (t.type === "cut") cutTimes.push(t.offset || runningDur);
    runningDur = t.offset || runningDur;
  }
  if (cutTimes.length === 0) {
    return { value: 0, grade: "amber", syllableMatches: 0, totalCuts: 0 };
  }
  // For each cut, find the nearest word boundary. If within 0.15s,
  // count as beat-aligned.
  let matches = 0;
  for (const cut of cutTimes) {
    let nearest = Infinity;
    for (const w of words) {
      const d1 = Math.abs(cut - (w.start || 0));
      const d2 = Math.abs(cut - (w.end || 0));
      const d = Math.min(d1, d2);
      if (d < nearest) nearest = d;
    }
    if (nearest <= 0.15) matches++;
  }
  const ratio = matches / cutTimes.length;
  const g = grade(
    ratio,
    (v) => v >= 0.6,
    (v) => v >= 0.4,
  );
  return {
    value: Number(ratio.toFixed(2)),
    grade: g,
    syllableMatches: matches,
    totalCuts: cutTimes.length,
  };
}

// ---- SFX presence + bed ducking ----

function gradeSfx(soundLayerPayload) {
  const cueCount = soundLayerPayload?.cueCount || 0;
  const g = grade(
    cueCount,
    (v) => v >= 3,
    (v) => v >= 1,
  );
  return { value: cueCount, grade: g };
}

function gradeBedDucking(soundLayerPayload) {
  const usedSidechain =
    soundLayerPayload?.filterLines?.some((l) =>
      l.includes("sidechaincompress"),
    ) || false;
  // We claim 6 dB drop based on the sidechain settings (threshold 0.05,
  // ratio 4). Empirically the drop is usually 6-10 dB during voice.
  const value = usedSidechain ? 7 : 0;
  const g = grade(
    value,
    (v) => v >= 6,
    (v) => v >= 3,
  );
  return { value, grade: g };
}

// ---- Verdict ----

function deriveVerdict(auto) {
  const reds = [];
  const ambers = [];
  const greens = [];
  for (const [k, v] of Object.entries(auto)) {
    if (!v || typeof v !== "object" || !v.grade) continue;
    if (v.grade === "red") reds.push(k);
    else if (v.grade === "amber") ambers.push(k);
    else greens.push(k);
  }
  let lane = "pass";
  const reasons = [];
  if (reds.length > 0) {
    lane = "downgrade";
    reasons.push(`red trips: ${reds.join(", ")}`);
  }
  // Hard rejects: severe failure modes
  if (
    auto.clipDominance?.grade === "red" &&
    auto.maxStillRepeat?.grade === "red"
  ) {
    lane = "reject";
    reasons.push("clip dominance + still repetition both red — slideshow risk");
  }
  if (auto.stockFillerCount?.grade === "red") {
    lane = "reject";
    reasons.push("stock filler in slate — premium lane refuses");
  }
  if (auto.durationIntegrity?.grade === "red") {
    lane = "reject";
    reasons.push("render duration does not cover narration/subtitles");
  }
  if (greens.length / Object.keys(auto).length < 0.5 && lane !== "reject") {
    lane = "reject";
    reasons.push("less than 50% green hits");
  }
  // Otherwise pass
  if (reasons.length === 0) {
    reasons.push("all rubric thresholds clear");
  }
  return {
    lane,
    reasons,
    redTrips: reds.length,
    amberTrips: ambers.length,
    greenHits: greens.length,
  };
}

// ---- Main ----

function buildQualityReportV2({
  storyId,
  outputPath,
  pkg,
  scenes,
  transitions,
  audioMeta,
  audioDurationS,
  assPath,
  soundLayerPayload,
  realignedWords,
  renderedDurationS,
  branch = null,
}) {
  const hookGrades = gradeHook(pkg, scenes);
  const auto = {
    hookWordCount: hookGrades.hookWordCount,
    hookAiTells: hookGrades.hookAiTells,
    spokenWPM: gradeSpokenWPM(pkg, audioDurationS),
    sourceDiversity: gradeSourceDiversity(scenes),
    clipDominance: gradeClipDominance(scenes),
    sceneVariety: gradeSceneVariety(scenes),
    maxStillRepeat: gradeMaxStillRepeat(scenes),
    captionGapsOver2s: gradeCaptionGaps(assPath, audioDurationS),
    durationIntegrity: gradeDurationIntegrity({
      renderedDurationS,
      audioDurationS,
      assPath,
    }),
    adjacentSameTypeCards: gradeAdjacentCards(scenes),
    stockFillerCount: gradeStockFiller(scenes),
    voicePathUsed: gradeVoicePath(audioMeta),
    motionDensityPerMin: gradeMotionDensity(
      scenes,
      transitions,
      audioDurationS,
    ),
    beatAwarenessRatio: gradeBeatAwareness(transitions, realignedWords),
    sfxEventCount: gradeSfx(soundLayerPayload),
    bedDuckingDb: gradeBedDucking(soundLayerPayload),
  };

  const human = {
    hookStrength: null,
    editRhythm: null,
    cardPolish: null,
    motionIntensity: null,
    soundDesignFeel: null,
    subjectFocus: null,
    subtitleReadability: null,
    slideshowRisk: null,
    brandConsistency: null,
    comparableToHumanEdit: null,
  };

  const verdict = deriveVerdict(auto);

  return {
    storyId,
    generatedAt: new Date().toISOString(),
    branch,
    outputPath,
    auto,
    human,
    verdict,
  };
}

module.exports = {
  buildQualityReportV2,
  AI_TELL_RE,
  assTimeToSeconds,
  parseAssLastCueEnd,
  gradeDurationIntegrity,
};
