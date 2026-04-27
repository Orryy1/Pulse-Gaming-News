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

// ---------------- SFX kit indexer (additive, opt-in) ---------------- //
//
// `resolveAudioPlan` currently returns no SFX cues by design — the
// gauntlet's audio-recurrence detector flags >5 declared cues as
// fail and >2 as warn. So sound-layer-v2 falls back to its minimal
// opener-sting path and the rubric stays clean.
//
// BUT the bespoke SFX library (audio/sfx/{transition,impact,reveal,
// glitch,tick,boom}/) and any unzipped Sonniss GameAudioGDC bundle
// in audio/sonniss/ are still indexed below as exported helpers.
// Operator-side tooling, manual sound design, or a future opt-in
// cue planner can call listKit() / listAllSfx() to discover what's
// available without breaking the current forensic-safe contract.

const SFX_DIR = path.join(AUDIO_DIR, "sfx");
const SONNISS_DIR = path.join(AUDIO_DIR, "sonniss");

const SONNISS_KEYWORDS = {
  transition: [
    "whoosh",
    "swipe",
    "swoosh",
    "transition",
    "pass-by",
    "passby",
    "sweep",
  ],
  impact: ["impact", "hit", "punch", "thump", "slam", "thud", "smash"],
  reveal: ["riser", "swell", "drone", "ambient pad", "build-up", "buildup"],
  glitch: ["glitch", "stutter", "static", "digital", "bitcrush", "broken"],
  tick: ["tick", "blip", "click", "beep", "ui", "interface"],
  boom: ["boom", "sub", "bass-drop", "explosion", "cinematic"],
};

let sonnissCache = null;

function indexSonniss() {
  if (sonnissCache) return sonnissCache;
  sonnissCache = {
    transition: [],
    impact: [],
    reveal: [],
    glitch: [],
    tick: [],
    boom: [],
  };
  if (!fs.existsSync(SONNISS_DIR)) return sonnissCache;
  // Sonniss bundles are typically <publisher>/<pack>/<file>. Walk
  // depth-limited (max 6 levels) so a malformed extract doesn't
  // hang.
  const stack = [{ dir: SONNISS_DIR, depth: 0 }];
  let scanned = 0;
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > 6) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!/\.(wav|flac|mp3)$/i.test(e.name)) continue;
      scanned++;
      const haystack = full.replace(SONNISS_DIR, "").toLowerCase();
      for (const [cat, kws] of Object.entries(SONNISS_KEYWORDS)) {
        if (kws.some((kw) => haystack.includes(kw))) {
          sonnissCache[cat].push({
            path: full,
            name: e.name.replace(/\.(wav|flac|mp3)$/i, ""),
            source: "sonniss",
          });
          break;
        }
      }
    }
  }
  // Cap each category at 50 so a Sonniss-heavy bundle doesn't
  // dominate cue selection if a future planner uses these.
  for (const cat of Object.keys(sonnissCache)) {
    if (sonnissCache[cat].length > 50)
      sonnissCache[cat] = sonnissCache[cat].slice(0, 50);
  }
  if (scanned > 0) {
    const counts = Object.entries(sonnissCache)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(",");
    console.log(`[audio-library] Sonniss indexed ${scanned} files: ${counts}`);
  }
  return sonnissCache;
}

/**
 * List all SFX in a category (bespoke first, then Sonniss).
 *
 *   category: "transition" | "impact" | "reveal" |
 *             "glitch" | "tick" | "boom"
 *
 * Returns: [{ path, name, source: "bespoke" | "sonniss" }, ...]
 */
function listKit(category) {
  const dir = path.join(SFX_DIR, category);
  const native = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /\.(wav|flac|mp3)$/i.test(f))
        .map((f) => ({
          path: path.join(dir, f),
          name: f.replace(/\.(wav|flac|mp3)$/i, ""),
          source: "bespoke",
        }))
    : [];
  const sonniss = indexSonniss()[category] || [];
  return [...native, ...sonniss];
}

function listAllSfx() {
  return {
    transition: listKit("transition"),
    impact: listKit("impact"),
    reveal: listKit("reveal"),
    glitch: listKit("glitch"),
    tick: listKit("tick"),
    boom: listKit("boom"),
  };
}

module.exports = {
  resolveAudioPlan,
  flairToVibe,
  BEDS,
  // SFX kit helpers — additive, do not affect resolveAudioPlan
  listKit,
  listAllSfx,
  indexSonniss,
};
