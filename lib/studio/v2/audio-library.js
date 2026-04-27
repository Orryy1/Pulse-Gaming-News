/**
 * Conservative Studio V2 audio-plan resolver.
 *
 * The renderer can ask this module for a story-aware music bed and an
 * optional SFX cue list. The committed v1 stays deliberately narrow:
 * use only already-tracked bed loops and return no custom SFX cues, so
 * sound-layer-v2 falls back to its minimal opener-sting path.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const AUDIO_DIR = path.join(ROOT, "audio");

const BEDS = [
  {
    file: "Main Background Loop 1.wav",
    vibe: ["default", "energetic"],
    note: "general gaming-news bed",
  },
  {
    file: "Main Background Loop 2.wav",
    vibe: ["verified", "confirmed"],
    note: "cleaner confirmed-news bed",
  },
  {
    file: "Main Background Loop 3.wav",
    vibe: ["rumour", "leak"],
    note: "more restrained rumour/leak bed",
  },
  {
    file: "Main Background Loop 4.wav",
    vibe: ["breaking", "urgent"],
    note: "higher-energy breaking-news bed",
  },
];

function flairToVibe(flair, breakingScore) {
  const value = String(flair || "").toLowerCase();
  if (/breaking|urgent/.test(value)) return "breaking";
  if (/rumou?r|leak/.test(value)) return "rumour";
  if (/verified|confirmed|official|news/.test(value)) return "verified";
  if (Number(breakingScore) >= 80) return "breaking";
  if (Number(breakingScore) >= 60) return "energetic";
  return "default";
}

function pickBed(vibe) {
  const match = BEDS.find((bed) => bed.vibe.includes(vibe));
  return match || BEDS[0];
}

function bedDuration(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);
    if (header.toString("ascii", 0, 4) !== "RIFF") return 0;
    const byteRate = header.readUInt32LE(28);
    if (!byteRate) return 0;
    return Math.max(0, (fs.statSync(filePath).size - 44) / byteRate);
  } catch {
    return 0;
  }
}

function resolveAudioPlan({ story } = {}) {
  const flair = story?.flair || story?.classification || "";
  const breakingScore = Number(story?.breaking_score || story?.score || 0);
  const vibe = flairToVibe(flair, breakingScore);
  const bed = pickBed(vibe);
  const bedPath = path.join(AUDIO_DIR, bed.file);

  return {
    musicBed: {
      path: bedPath,
      file: bed.file,
      durationS: bedDuration(bedPath),
      vibe: bed.vibe,
      note: bed.note,
    },
    // Empty by design: sound-layer-v2 falls back to its minimal,
    // forensic-safe opener sting instead of an uncommitted SFX kit.
    sfxCues: [],
    decisions: {
      vibe,
      flair: flair || "(none)",
      breakingScore,
      bed: bed.file,
      sfxCueCount: 0,
      sfxBreakdown: {},
      reason: "tracked-bed-only",
    },
  };
}

module.exports = {
  resolveAudioPlan,
  flairToVibe,
  BEDS,
};
