/**
 * Studio V2 audio-plan resolver.
 *
 * The renderer asks this module for a story-aware music bed and a restrained
 * cue list. The cue planner deliberately stays small: varied assets, low
 * levels, no repeated generic whooshes and a hard cap so the forensic audio
 * gate does not flag cut-synchronous recurrence.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const AUDIO_DIR = path.join(ROOT, "audio");
const MAX_STUDIO_SFX_CUES = 1;
const MIN_STUDIO_CUE_SPACING_S = 3.25;

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

function resolveSfxMode(env = process.env) {
  const raw = String(env.STUDIO_V2_SFX_MODE || "studio").toLowerCase().trim();
  if (raw === "off" || raw === "false" || raw === "0" || raw === "none") {
    return "off";
  }
  if (raw === "minimal" || raw === "bed" || raw === "beds-only") {
    return "minimal";
  }
  if (
    raw === "studio" ||
    raw === "professional" ||
    raw === "pro" ||
    raw === "full"
  ) {
    return "studio";
  }
  return "studio";
}

function sceneStartTimes(scenes = []) {
  const starts = [];
  let t = 0;
  for (const scene of scenes || []) {
    starts.push(Number(t.toFixed(3)));
    t += Number(scene?.duration || 0);
  }
  return starts;
}

function findSceneStart(scenes, starts, match) {
  for (let i = 0; i < (scenes || []).length; i++) {
    if (match(scenes[i])) return starts[i];
  }
  return null;
}

function pickSfxAsset(category, preferredNames, usedPaths = new Set()) {
  const kit = listKit(category).filter((item) => fs.existsSync(item.path));
  for (const name of preferredNames || []) {
    const exact = kit.find(
      (item) => item.name.toLowerCase() === String(name).toLowerCase(),
    );
    if (exact && !usedPaths.has(exact.path)) return exact;
  }
  return kit.find((item) => !usedPaths.has(item.path)) || null;
}

function addCueCandidate(candidates, cue) {
  if (!Number.isFinite(cue?.atS)) return;
  if (cue.atS < 0) return;
  candidates.push({
    ...cue,
    atS: Number(cue.atS.toFixed(2)),
    durationS: Number((cue.durationS || 0.35).toFixed(2)),
  });
}

function buildStudioSfxCues({ scenes = [], transitions = [] } = {}) {
  if (!Array.isArray(scenes) || scenes.length === 0) return [];

  const starts = sceneStartTimes(scenes);
  const candidates = [];

  addCueCandidate(candidates, {
    family: "reveal",
    kind: "opener-lift",
    atS: 0.12,
    category: "reveal",
    preferred: ["swell", "riser-fast"],
    vol: 0.07,
    durationS: 0.72,
    priority: 100,
    reason: "subtle channel-open lift",
  });

  const firstSourceCard = findSceneStart(scenes, starts, (scene) =>
    /card\.(source|quote|context|timeline)/.test(String(scene?.type || "")),
  );
  if (firstSourceCard !== null) {
    addCueCandidate(candidates, {
      family: "impact",
      kind: "source-card-snap",
      atS: firstSourceCard + 0.04,
      category: "impact",
      preferred: ["snap", "punch-mid"],
      vol: 0.08,
      durationS: 0.22,
      priority: 90,
      reason: "source/card reveal punctuation",
    });
  }

  const firstPunchCut = transitions.find((transition) => {
    const idx = transitions.indexOf(transition) + 1;
    const nextScene = scenes[idx];
    return (
      transition?.type === "cut" &&
      /punch|speed-ramp|freeze/.test(
        String(nextScene?.type || nextScene?.sceneType || ""),
      )
    );
  });
  if (firstPunchCut) {
    addCueCandidate(candidates, {
      family: "transition",
      kind: "editorial-transition",
      atS: Number(firstPunchCut.offset || 0),
      category: "transition",
      preferred: ["whoosh-sub", "swipe-tonal", "whoosh-short"],
      vol: 0.1,
      durationS: 0.38,
      priority: 80,
      reason: "editorial cut movement",
    });
  }

  const takeawayStart = findSceneStart(scenes, starts, (scene) =>
    /card\.(takeaway|must|hot)|takeaway/.test(String(scene?.type || "")),
  );
  if (takeawayStart !== null) {
    addCueCandidate(candidates, {
      family: "boom",
      kind: "takeaway-weight",
      atS: takeawayStart + 0.02,
      category: "boom",
      preferred: ["boom-soft", "boom-impact"],
      vol: 0.09,
      durationS: 0.5,
      priority: 95,
      reason: "main takeaway weight",
    });
  }

  const statStart = findSceneStart(scenes, starts, (scene) =>
    /card\.(stat|date|release|known)/.test(String(scene?.type || "")),
  );
  if (statStart !== null) {
    addCueCandidate(candidates, {
      family: "tick",
      kind: "data-tick",
      atS: statStart + 0.08,
      category: "tick",
      preferred: ["tick-soft", "tick-blip"],
      vol: 0.055,
      durationS: 0.12,
      priority: 70,
      reason: "data/card micro-detail",
    });
  }

  const usedPaths = new Set();
  const selected = [];
  const byPriority = candidates.sort(
    (a, b) => b.priority - a.priority || a.atS - b.atS,
  );

  for (const candidate of byPriority) {
    if (selected.length >= MAX_STUDIO_SFX_CUES) break;
    if (
      selected.some(
        (cue) => Math.abs(Number(cue.atS) - Number(candidate.atS)) < MIN_STUDIO_CUE_SPACING_S,
      )
    ) {
      continue;
    }
    const asset = pickSfxAsset(candidate.category, candidate.preferred, usedPaths);
    if (!asset) continue;
    usedPaths.add(asset.path);
    selected.push({
      atS: candidate.atS,
      kind: candidate.kind,
      family: candidate.family,
      path: asset.path,
      vol: candidate.vol,
      durationS: candidate.durationS,
      reason: candidate.reason,
      source: asset.source,
    });
  }

  return selected.sort((a, b) => a.atS - b.atS);
}

function sfxBreakdown(cues) {
  return (cues || []).reduce((acc, cue) => {
    const key = cue.family || cue.kind || "cue";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function resolveAudioPlan({ story, scenes = [], transitions = [] } = {}) {
  const flair = story?.flair || story?.classification || "";
  const breakingScore = Number(story?.breaking_score || story?.score || 0);
  const vibe = flairToVibe(flair, breakingScore);
  const bed = pickBed(vibe);
  const bedPath = path.join(AUDIO_DIR, bed.file);
  const sfxMode = resolveSfxMode();
  const sfxCues =
    sfxMode === "studio"
      ? buildStudioSfxCues({ scenes, transitions })
      : [];

  return {
    musicBed: {
      path: bedPath,
      file: bed.file,
      durationS: bedDuration(bedPath),
      vibe: bed.vibe,
      note: bed.note,
    },
    sfxCues,
    decisions: {
      vibe,
      flair: flair || "(none)",
      breakingScore,
      bed: bed.file,
      sfxMode,
      sfxCueCount: sfxCues.length,
      forensicSafeCueCount: sfxCues.length <= 1,
      sfxBreakdown: sfxBreakdown(sfxCues),
      reason:
        sfxMode === "studio"
          ? "studio-capped-varied-cue-plan"
          : "tracked-bed-only",
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
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) {
        // Junction/symlink — resolve to see if it points at a directory
        // (Sonniss bundles are commonly junctioned in to avoid copying
        // 25-50 GB of audio into the working tree).
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) {
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
  resolveSfxMode,
  buildStudioSfxCues,
  flairToVibe,
  BEDS,
  // SFX kit helpers — additive, do not affect resolveAudioPlan
  listKit,
  listAllSfx,
  indexSonniss,
};
