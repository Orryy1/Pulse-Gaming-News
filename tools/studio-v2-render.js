/**
 * tools/studio-v2-render.js — Studio Short Engine v2 orchestrator.
 *
 * Wires together every v2 module to produce one serious local render
 * and a quality gate v2 report.
 *
 * Pipeline:
 *   1. Story package    (lib/studio/v2/story-package.js)
 *   2. Editorial        (existing v1 layer — uses tightened script)
 *   3. Media discovery  (existing v1 acquisition)
 *   4. Voice path       (existing — ElevenLabs production by default)
 *   5. Compose v1 slate then TRANSFORM with v2 grammar:
 *        - Replace selected clip slots with 2× punch slices each
 *        - Insert one freeze-frame at ~70% with caption beat
 *        - Insert one speed-ramp slow-in at climax
 *   6. Apply premium card lane v2 (HF source / context / quote /
 *      takeaway).
 *   7. Build sound layer v2 (SFX hits + sidechain bed ducking).
 *   8. Build subtitle layer v2 (kinetic word-pop ASS).
 *   9. Beat-aware transition planner (cut on word boundaries when
 *      possible).
 *  10. ffmpeg render → MP4.
 *  11. Quality gate v2 → JSON report + verdict.
 *
 * No deploys, no env-var changes, no production publish jobs.
 * This is local-only experimentation.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const { smartCropToReel } = require("../lib/image-crop");
const { composeStudioSlate, SCENE_TYPES } = require("../lib/scene-composer");
const {
  buildStudioEditorial,
  scriptFromTimestampAlignment,
} = require("../lib/studio/editorial-layer");
const {
  discoverLocalStudioMedia,
  ensureTrailerClipSlices,
  ensureTrailerFrames,
  rankSourceDiversity,
  ffprobeDuration,
} = require("../lib/studio/media-acquisition");
const {
  ensureTrimmedLocalLiam,
  ensureFreshLocalLiam,
  ensureProductionElevenLabsVoice,
  wordsFromAlignment,
} = require("../lib/studio/sound-layer");
const {
  buildSceneInput,
  dispatchSceneFilter,
  FPS,
} = require("../lib/studio/ffmpeg-scene-renderer");

// V2 modules
const { buildStoryPackage } = require("../lib/studio/v2/story-package");
const {
  buildPunchScene,
  buildSpeedRampScene,
  buildFreezeFrameScene,
  planPunchSlicesFromClip,
} = require("../lib/studio/v2/scene-grammar-v2");
const {
  applyPremiumCardLaneV2,
} = require("../lib/studio/v2/premium-card-lane-v2");
const {
  buildSoundLayerV2,
  ensureSfxAssets,
} = require("../lib/studio/v2/sound-layer-v2");
const { buildKineticAss } = require("../lib/studio/v2/subtitle-layer-v2");
const { buildQualityReportV2 } = require("../lib/studio/v2/quality-gate-v2");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const STORY_ID = process.argv[2] || "1sn9xhe";
const OUTPUT_SUFFIX = process.env.STUDIO_V2_OUTPUT_SUFFIX || "";

const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

function ffprobeJson(file) {
  return JSON.parse(
    execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${file.replace(/\\/g, "/")}"`,
      { encoding: "utf8" },
    ),
  );
}

function currentBranch() {
  try {
    return execSync("git branch --show-current", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function loadStoryRow(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(ROOT, "data", "pulse.db"), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, classification,
              flair, subreddit, source_type, top_comment
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  if (!row) throw new Error(`no story row found for ${storyId}`);
  return row;
}

async function preprocessStills(media) {
  return {
    ...media,
    trailerFrames: await Promise.all(
      media.trailerFrames.map(async (frame) => ({
        ...frame,
        path: await smartCropToReel(frame.path),
      })),
    ),
    articleHeroes: await Promise.all(
      media.articleHeroes.map(async (hero) => ({
        ...hero,
        path: await smartCropToReel(hero.path),
      })),
    ),
    publisherAssets: await Promise.all(
      media.publisherAssets.map(async (asset) => ({
        ...asset,
        path: await smartCropToReel(asset.path),
      })),
    ),
  };
}

/**
 * Apply v2 scene grammar transformations:
 *   - Find clip slots in the middle 50% and replace selected ones
 *     with 2× punch slices (each ~1.6s) — adds visible "more cuts
 *     per minute" feel.
 *   - Insert one freeze-frame at ~70% mark with a caption beat.
 *   - Insert one speed-ramp slow-in at the slot just before the
 *     takeaway card. Used sparingly (max 1).
 *
 * Returns transformed scene array. If no clip is available, returns
 * the slate unchanged.
 */
function applySceneGrammarV2({
  scenes,
  story,
  mediaClips = [],
  transforms = {},
}) {
  const out = scenes.slice();
  const clipScenes = [];
  for (let i = 0; i < out.length; i++) {
    if (
      out[i].type === SCENE_TYPES.CLIP ||
      (out[i].type === SCENE_TYPES.OPENER && out[i].isClipBacked)
    ) {
      clipScenes.push({ idx: i, scene: out[i] });
    }
  }

  if (clipScenes.length < 2) return { scenes: out, applied: [] };

  const applied = [];

  // 1. Punch pair: replace ONE mid clip with two punches drawn from
  //    DIFFERENT clip sources. The point is to add cuts AND
  //    diversify sources, not to slice the same clip in half.
  //    Picks the two least-used clip sources by walking the slate.
  if (transforms.punch !== false && clipScenes.length >= 2) {
    const sourceUseCount = new Map();
    for (const cs of clipScenes) {
      const src = cs.scene.source;
      if (!src) continue;
      sourceUseCount.set(src, (sourceUseCount.get(src) || 0) + 1);
    }
    // Add unused clips with 0 count so they're preferred for punches.
    for (const c of mediaClips) {
      if (!sourceUseCount.has(c.path)) sourceUseCount.set(c.path, 0);
    }
    const sortedClips = [...sourceUseCount.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    // Pick two distinct source paths for the two punches.
    const punchSourcePaths = sortedClips.slice(0, 2).map(([p]) => p);
    if (punchSourcePaths.length === 2) {
      const target = clipScenes[Math.floor(clipScenes.length / 2)];
      const punchScenes = punchSourcePaths.map((src) => {
        const clipDur = ffprobeDuration(src) || 5.0;
        // Pick a midpoint slice, ~1.5s
        const sliceDur = Math.min(1.6, target.scene.duration / 2 - 0.05);
        const startInSrc = Math.max(
          0.4,
          Math.min(clipDur - sliceDur - 0.2, clipDur * 0.4),
        );
        return buildPunchScene({
          slot: 0,
          source: src,
          startInSourceS: startInSrc,
          duration: sliceDur,
          fontOpt: FONT_OPT,
        });
      });
      out.splice(target.idx, 1, ...punchScenes);
      applied.push({
        kind: "punch-pair-cross-clip",
        atIdx: target.idx,
        sources: punchSourcePaths.map((p) => path.basename(p)),
        sliceCount: punchScenes.length,
      });

      // Second punch pair: pick a different clip slot (one not yet
      // touched by the first pair) and apply the same transformation
      // with two MORE distinct clip sources picked from least-used.
      // This roughly doubles the visible cuts-per-minute at the cost
      // of two slate slots — acceptable for an energetic shorts edit.
      if (transforms.punchSecondPair !== false && clipScenes.length >= 3) {
        // Re-locate clip scenes in the new `out` array since indices
        // have shifted after the first splice.
        const remainingClipScenes = [];
        for (let i = 0; i < out.length; i++) {
          if (
            (out[i].type === SCENE_TYPES.CLIP ||
              (out[i].type === SCENE_TYPES.OPENER && out[i].isClipBacked)) &&
            // Skip the first punch group (just inserted)
            !(i >= target.idx && i < target.idx + punchScenes.length)
          ) {
            remainingClipScenes.push({ idx: i, scene: out[i] });
          }
        }
        // Want a clip far from the first punch pair so visually
        // they don't cluster.
        if (remainingClipScenes.length >= 1) {
          const second =
            remainingClipScenes[Math.floor(remainingClipScenes.length * 0.7)] ||
            remainingClipScenes[remainingClipScenes.length - 1];
          // Pick two NEW least-used sources, ideally different from
          // the first pair's sources.
          const usedAlready = new Set(punchSourcePaths);
          const sortedAgain = sortedClips.filter(([p]) => !usedAlready.has(p));
          // Wrap around if exhausted.
          while (sortedAgain.length < 2 && sortedClips.length > 0) {
            sortedAgain.push(
              sortedClips[sortedAgain.length % sortedClips.length],
            );
          }
          const secondSourcePaths = sortedAgain.slice(0, 2).map(([p]) => p);
          if (secondSourcePaths.length === 2 && second?.scene?.source) {
            const secondPunchScenes = secondSourcePaths.map((src) => {
              const clipDur = ffprobeDuration(src) || 5.0;
              const sliceDur = Math.min(1.6, second.scene.duration / 2 - 0.05);
              // Pick a different start offset (later in the clip) so
              // these punches show different content from pair 1.
              const startInSrc = Math.max(
                0.4,
                Math.min(clipDur - sliceDur - 0.2, clipDur * 0.65),
              );
              return buildPunchScene({
                slot: 0,
                source: src,
                startInSourceS: startInSrc,
                duration: sliceDur,
                fontOpt: FONT_OPT,
              });
            });
            out.splice(second.idx, 1, ...secondPunchScenes);
            applied.push({
              kind: "punch-pair-cross-clip",
              atIdx: second.idx,
              sources: secondSourcePaths.map((p) => path.basename(p)),
              sliceCount: secondPunchScenes.length,
              note: "second pair",
            });
          }
        }
      }
    }
  }

  // 2. Freeze-frame at ~70% mark — pick a non-card scene, replace
  //    with a freeze-frame using its source.
  if (transforms.freeze !== false) {
    const targetIdx = Math.min(out.length - 4, Math.floor(out.length * 0.65));
    const target = out[targetIdx];
    if (
      target &&
      target.source &&
      target.type !== SCENE_TYPES.OPENER &&
      target.type !== SCENE_TYPES.CARD_TAKEAWAY &&
      !target.type?.startsWith("card.")
    ) {
      const captionText = pickFreezeCaption(story);
      const freeze = buildFreezeFrameScene({
        slot: 0,
        source: target.source,
        startInSourceS: 0,
        playInS: 0.6,
        duration: target.duration,
        caption: captionText,
        fontOpt: FONT_OPT,
      });
      out[targetIdx] = freeze;
      applied.push({
        kind: "freeze-frame",
        atIdx: targetIdx,
        source: path.basename(target.source),
        caption: captionText,
      });
    }
  }

  // 3. Speed-ramp slow-in: pick the CLIP (not still or clip.frame —
  //    speed-ramp needs a real video source for the setpts envelope)
  //    just before the takeaway card, swap with a slow-in ramp.
  if (transforms.speedRamp !== false) {
    let rampApplied = false;
    const takeawayIdx = out.findIndex(
      (s) => s.type === SCENE_TYPES.CARD_TAKEAWAY,
    );
    if (takeawayIdx > 0) {
      for (let i = takeawayIdx - 1; i >= Math.max(0, takeawayIdx - 3); i--) {
        const cand = out[i];
        if (cand?.type === SCENE_TYPES.CLIP || cand?.sceneType === "clip") {
          if (!cand.source) continue;
          const ramp = buildSpeedRampScene({
            slot: 0,
            source: cand.source,
            startInSourceS: 0.5,
            duration: cand.duration,
            envelope: "slow-in",
          });
          out[i] = ramp;
          applied.push({
            kind: "speed-ramp",
            envelope: "slow-in",
            atIdx: i,
            source: path.basename(cand.source),
          });
          rampApplied = true;
          break;
        }
      }
    }

    if (!rampApplied && transforms.forceClimaxRamp === true) {
      const sourceUseCount = new Map();
      for (const scene of out) {
        if (!scene.source) continue;
        sourceUseCount.set(
          scene.source,
          (sourceUseCount.get(scene.source) || 0) + 1,
        );
      }
      for (const clip of mediaClips) {
        if (!sourceUseCount.has(clip.path)) sourceUseCount.set(clip.path, 0);
      }
      const rampSource = [...sourceUseCount.entries()]
        .filter(([src]) => /\.(mp4|mov|m4v|webm)$/i.test(src))
        .sort((a, b) => a[1] - b[1])[0]?.[0];
      const replaceIdx = (() => {
        const end = takeawayIdx > 0 ? takeawayIdx - 1 : out.length - 1;
        for (let i = end; i >= Math.max(3, end - 5); i--) {
          const cand = out[i];
          if (
            cand?.source &&
            (cand.type === SCENE_TYPES.CLIP_FRAME ||
              cand.type === SCENE_TYPES.STILL) &&
            !cand.type?.startsWith("card.")
          ) {
            return i;
          }
        }
        return -1;
      })();
      if (rampSource && replaceIdx >= 0) {
        const target = out[replaceIdx];
        const ramp = buildSpeedRampScene({
          slot: 0,
          source: rampSource,
          startInSourceS: 0.25,
          duration: target.duration,
          envelope: "fast-out",
        });
        out[replaceIdx] = ramp;
        applied.push({
          kind: "forced-climax-speed-ramp",
          envelope: "fast-out",
          atIdx: replaceIdx,
          replaced: target.label || target.type,
          source: path.basename(rampSource),
        });
      }
    }
  }

  // 4. Timeline card insertion (v2.1 — addresses the "visible
  //    scene-variety" pass identified by the gauntlet).
  //    Find the most-repeated still-source mid-slate (positions 30%-55%)
  //    and replace ONE of its instances with a card.timeline scene.
  //    The lane resolves the scene to the per-story HF timeline MP4
  //    when present, otherwise to the ffmpeg fallback drawtext.
  if (transforms.timeline !== false) {
    // Count how many times each still source appears
    const stillSources = new Map();
    for (let i = 0; i < out.length; i++) {
      const s = out[i];
      if (
        (s.type === SCENE_TYPES.CLIP_FRAME || s.type === SCENE_TYPES.STILL) &&
        s.source
      ) {
        const id = String(s.source).replace(
          /_smartcrop_v2(_[a-z]+)?\.jpe?g$/i,
          ".jpg",
        );
        const arr = stillSources.get(id) || [];
        arr.push(i);
        stillSources.set(id, arr);
      }
    }
    // Look for a still source used twice or more — replace the second
    // instance with the timeline card. If no source is used twice,
    // pick a single still in the 30-55% slot range.
    const startPct = 0.3;
    const endPct = 0.55;
    let timelineIdx = -1;
    for (const [, indices] of stillSources) {
      if (indices.length < 2) continue;
      // Take an instance in the mid-slate range
      const candidate = indices.find(
        (i) => i / out.length >= startPct && i / out.length <= endPct,
      );
      if (candidate !== undefined) {
        timelineIdx = candidate;
        break;
      }
    }
    if (timelineIdx === -1) {
      // No repeated stills — pick any still in the 30-55% range
      for (let i = 0; i < out.length; i++) {
        const pct = i / out.length;
        if (pct < startPct || pct > endPct) continue;
        const s = out[i];
        if (s.type === SCENE_TYPES.CLIP_FRAME || s.type === SCENE_TYPES.STILL) {
          timelineIdx = i;
          break;
        }
      }
    }
    if (timelineIdx >= 0) {
      const replaced = out[timelineIdx];
      out[timelineIdx] = {
        type: SCENE_TYPES.CARD_TIMELINE,
        duration: replaced.duration,
        label: "card_timeline",
        backgroundSource: replaced.source || replaced.backgroundSource || null,
        // The lane will fill prerenderedMp4 with the per-story HF
        // render. If missing, the ffmpeg fallback in
        // ffmpeg-scene-renderer.js handles rendering.
        kicker: "WHAT WE KNOW",
        heading: (story?.title || "")
          .split(/\s+[-–—:|]\s+/)[0]
          .toUpperCase()
          .slice(0, 18),
        bullets: ["Trailer live", "Personal story arc", "No date yet"],
        cardKind: "timeline",
      };
      applied.push({
        kind: "timeline-card",
        atIdx: timelineIdx,
        replaced: replaced.label || replaced.type,
      });
    }
  }

  // 5. AUTHORED variant transformations (gated by STUDIO_V2_AUTHORED=true).
  //    Two narrow-scope improvements:
  //
  //    a) MID-VIDEO SCENE VARIETY: replace the redundant clip.frame
  //       at slot 9 (or thereabouts) with a NEW punch slice drawn
  //       from clip B's EARLY portion (~0.15× duration). Existing
  //       punches use 0.4× and 0.65× offsets — early-clip content
  //       is genuinely visually different from those slices.
  //
  //    b) PREMIUM AUTHORED MOMENT: tag the freeze-frame scene with
  //       authored:true so the freeze-frame builder includes a 60ms
  //       white shutter-snap flash at the freeze instant. Reads as
  //       a deliberate "photo finish" beat rather than a still pause.
  //
  //    No new env-fanned features beyond the two above. No new
  //    scene types. No architecture changes.
  if (transforms.authored === true) {
    // (a) Find a redundant mid-late clip.frame to replace with an
    //     early-clip punch.
    let varietyIdx = -1;
    for (let i = out.length - 4; i >= Math.floor(out.length * 0.45); i--) {
      const s = out[i];
      if (
        (s.type === SCENE_TYPES.CLIP_FRAME || s.type === SCENE_TYPES.STILL) &&
        s.source
      ) {
        varietyIdx = i;
        break;
      }
    }
    if (varietyIdx >= 0) {
      // Pick the LEAST-used clip source for the early-offset punch
      const clipUseCount = new Map();
      for (const c of mediaClips) clipUseCount.set(c.path, 0);
      for (const s of out) {
        if (s.source && clipUseCount.has(s.source)) {
          clipUseCount.set(s.source, clipUseCount.get(s.source) + 1);
        }
      }
      const earlyPunchSrc = [...clipUseCount.entries()].sort(
        (a, b) => a[1] - b[1],
      )[0]?.[0];
      if (earlyPunchSrc) {
        const clipDur = ffprobeDuration(earlyPunchSrc) || 5.0;
        const sliceDur = Math.min(1.6, out[varietyIdx].duration / 2 + 0.2);
        const startInSrc = Math.max(
          0.2,
          Math.min(clipDur - sliceDur - 0.2, clipDur * 0.15),
        );
        const earlyPunch = buildPunchScene({
          slot: 0,
          source: earlyPunchSrc,
          startInSourceS: startInSrc,
          duration: sliceDur,
          fontOpt: FONT_OPT,
        });
        const replacedLabel = out[varietyIdx].label || out[varietyIdx].type;
        out[varietyIdx] = earlyPunch;
        applied.push({
          kind: "authored-early-punch",
          atIdx: varietyIdx,
          source: path.basename(earlyPunchSrc),
          startInSourceS: Number(startInSrc.toFixed(2)),
          replaced: replacedLabel,
        });
      }
    }

    // (b) Rebuild the freeze-frame scene with authored:true so
    //     buildFreezeFrameScene injects a 60ms white shutter flash
    //     into its filter chain at the freeze instant. Source,
    //     caption, duration are preserved from the original freeze.
    for (let i = 0; i < out.length; i++) {
      const fs = out[i];
      if (
        (fs.sceneType === "freeze-frame" || fs.type === "freeze-frame") &&
        fs.source
      ) {
        const reauthored = buildFreezeFrameScene({
          slot: 0,
          source: fs.source,
          startInSourceS: 0,
          playInS: 0.6,
          duration: fs.duration,
          caption: fs.caption || "",
          fontOpt: FONT_OPT,
          authored: true,
        });
        out[i] = reauthored;
        applied.push({
          kind: "authored-freeze-shutter",
          atIdx: i,
          note: "60ms white flash at freeze instant",
        });
        break;
      }
    }
  }

  return { scenes: out, applied };
}

function pickFreezeCaption(story) {
  const title = String(story?.title || "").toUpperCase();
  if (/METRO\s*2039/i.test(title)) return "SEVEN YEARS QUIET";
  if (/GTA\s*6/i.test(title)) return "THE TIMELINE LOCKED IN";
  if (/SILKSONG/i.test(title)) return "AT LAST";
  // Default: pull a short noun phrase
  const words = title.split(/\s+/).filter((w) => /^[A-Z0-9]{3,}$/.test(w));
  return words.slice(0, 2).join(" ") || "PAUSE ON THIS";
}

/**
 * Beat-aware transition plan. Walks scenes, tries to align each cut
 * to the nearest word-end boundary within ±0.20s. Falls back to the
 * scene's natural offset when no boundary is close enough.
 *
 * Returns transitions array shaped like the v1 planner:
 *   { type, duration, offset }
 *
 * The renderer treats every transition as a CUT at offset (offset
 * being the absolute timestamp of the cut). xfade transitions are
 * disabled in v2 — every edit is a cut, which gives the snappiest
 * feel and lets SFX hits land cleanly. This was a deliberate
 * editorial choice, not a renderer limitation.
 */
function buildBeatAwareTransitions(scenes, words) {
  const transitions = [];
  let runningDur = Number(scenes[0]?.duration || 0);
  for (let i = 0; i < scenes.length - 1; i++) {
    let offset = runningDur;
    if (Array.isArray(words) && words.length > 0) {
      let nearest = Infinity;
      let nearestT = offset;
      for (const w of words) {
        const t = Number(w.end);
        if (!Number.isFinite(t)) continue;
        const d = Math.abs(t - offset);
        if (d < nearest) {
          nearest = d;
          nearestT = t;
        }
      }
      if (nearest <= 0.2) {
        offset = Number(nearestT.toFixed(2));
      }
    }
    transitions.push({ type: "cut", duration: 0, offset });
    runningDur = offset + Number(scenes[i + 1]?.duration || 0);
  }
  return transitions;
}

function buildV2SceneInput(scene) {
  // V2 grammar scenes (punch, freeze-frame, speed-ramp) bring their
  // own ffmpegInput. Use it directly.
  if (scene.ffmpegInput) return scene.ffmpegInput;
  // HyperFrames pre-rendered card.
  if (scene.prerenderedMp4) {
    return buildSceneInput(scene);
  }
  // Otherwise, v1 input builder.
  return buildSceneInput(scene);
}

function buildV2SceneFilter({ slot, scene, story, fontOpt }) {
  // V2 grammar scenes: rewrite their ffmpegFilter to use the
  // correct slot index. The grammar builders embed `[N:v]...` with
  // their own slot — replace it with the actual one.
  let filter;
  if (scene.ffmpegFilter) {
    filter = scene.ffmpegFilter
      .replace(/^\[\d+:v\]/, `[${slot}:v]`)
      .replace(/\[v\d+\]$/, `[v${slot}]`);
  } else {
    filter = dispatchSceneFilter({ slot, scene, story, fontOpt });
  }

  return enforceDeclaredSceneDuration({
    filter,
    slot,
    duration: Number(scene.duration || 4),
  });
}

function enforceDeclaredSceneDuration({ filter, slot, duration }) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 4;
  const preLabel = `v${slot}_durpre`;
  const rewritten = String(filter).replace(/\[v\d+\]$/, `[${preLabel}]`);
  if (rewritten === filter) {
    throw new Error(`v2 scene filter did not end with [v${slot}]`);
  }
  return [
    rewritten,
    `[${preLabel}]tpad=stop_mode=clone:stop_duration=${(
      safeDuration + 1
    ).toFixed(3)},trim=duration=${safeDuration},setpts=PTS-STARTPTS[v${slot}]`,
  ].join(";");
}

async function main() {
  await fs.ensureDir(TEST_OUT);

  console.log("");
  console.log("==============================================");
  console.log(`  STUDIO SHORT ENGINE v2 — render`);
  console.log(`  story: ${STORY_ID}`);
  console.log(`  branch: ${currentBranch()}`);
  console.log("==============================================");
  console.log("");

  // ---- 1. Story package ----
  console.log("[1/11] building story package...");
  const { pkg, outPath: pkgPath } = await buildStoryPackage(STORY_ID, {
    skipLlm: process.env.STUDIO_V2_SKIP_LLM === "true",
  });
  console.log(
    `       chosen hook: "${pkg.hook.chosen.text}" (${pkg.hook.chosen.wordCount}w, ${pkg.hook.source})`,
  );
  console.log(`       script: ${pkg.script.wordCountTightened}w tightened`);
  console.log(
    `       inventory: ${pkg.mediaInventory.trailerClips.length} clips, ${pkg.mediaInventory.trailerFrames.length} frames, ${pkg.mediaInventory.articleHeroes.length} heroes`,
  );
  console.log(
    `       viability: ${pkg.viability.score}/100 (${pkg.viability.verdict})`,
  );
  console.log(`       package: ${path.relative(ROOT, pkgPath)}`);

  if (pkg.viability.verdict === "reject") {
    console.error("");
    console.error("[v2] viability verdict = reject; aborting render.");
    console.error(
      `     risk flags: ${pkg.riskFlags.map((r) => r.flag).join(", ")}`,
    );
    process.exit(1);
  }

  // ---- 2. SFX assets sanity check ----
  console.log("[2/11] verifying SFX assets...");
  await ensureSfxAssets();

  // ---- 3. DB story + editorial ----
  console.log("[3/11] building editorial layer...");
  const story = loadStoryRow(STORY_ID);
  const editorial = buildStudioEditorial(story);

  // ---- 4. Media discovery ----
  console.log("[4/11] discovering media...");
  let media = await discoverLocalStudioMedia({ root: ROOT, storyId: STORY_ID });
  media = await ensureTrailerClipSlices({
    root: ROOT,
    storyId: STORY_ID,
    media,
  });
  media = await ensureTrailerFrames({ root: ROOT, storyId: STORY_ID, media });
  const mediaDiversity = rankSourceDiversity(media);
  const croppedMedia = await preprocessStills(media);
  console.log(
    `       ${media.clips.length} clips · ${media.trailerFrames.length} trailer frames · ${media.articleHeroes.length} article heroes`,
  );
  console.log(
    `       diversity score: ${mediaDiversity.sourceMixScore}/100 (${mediaDiversity.verdict})`,
  );

  // ---- 5. Voice ----
  console.log("[5/11] resolving voice path...");
  const voiceMode = (process.env.STUDIO_V2_VOICE || "production").toLowerCase();
  let voice;
  if (voiceMode === "production" || voiceMode === "elevenlabs") {
    voice = await ensureProductionElevenLabsVoice({
      root: ROOT,
      storyId: STORY_ID,
      editorial,
      force: process.env.STUDIO_V2_FORCE_TTS === "true",
    }).catch(async (err) => {
      console.warn(`       production voice failed: ${err.message}`);
      if (process.env.STUDIO_V2_ALLOW_VOICE_FALLBACK !== "true") throw err;
      const fallback = await ensureFreshLocalLiam({
        root: ROOT,
        storyId: STORY_ID,
        editorial,
        force: false,
      }).catch(() => ensureTrimmedLocalLiam({ root: ROOT, storyId: STORY_ID }));
      return {
        ...fallback,
        warning: `production failed, fell back: ${err.message}`,
      };
    });
  } else {
    voice = await ensureTrimmedLocalLiam({ root: ROOT, storyId: STORY_ID });
  }
  if (!(await fs.pathExists(voice.audioPath))) {
    throw new Error(`voice audio missing: ${voice.audioPath}`);
  }
  const audioDurationS = ffprobeDuration(voice.audioPath);
  const tsData = await fs.readJson(voice.timestampsPath);
  const alignment = tsData.alignment || tsData;
  const realignedWords = wordsFromAlignment(alignment);
  const spokenTranscript = scriptFromTimestampAlignment(alignment);
  console.log(
    `       audio: ${audioDurationS.toFixed(2)}s · ${realignedWords.length} words · ${voice.source}`,
  );

  const renderStory = {
    ...story,
    hook: pkg.hook.chosen.text,
    body: editorial.body,
    full_script: editorial.scriptForCaption,
    studio_editorial_script: editorial.fullScript,
    studio_spoken_transcript: spokenTranscript,
  };

  // ---- 6. Compose v1 slate, then transform with v2 grammar ----
  console.log("[6/11] composing slate (v1 + v2 grammar)...");
  const composed = composeStudioSlate({
    story: renderStory,
    media: croppedMedia,
    audioDurationS,
    opts: {
      takeawayText: "WATCH THE FULL TRAILER",
      cta: "FOLLOW FOR MORE",
      allowStockFiller: false,
    },
  });
  const v2Transform = applySceneGrammarV2({
    scenes: composed.scenes,
    story: renderStory,
    mediaClips: media.clips,
    transforms: {
      punch: process.env.STUDIO_V2_DISABLE_PUNCH !== "true",
      freeze: process.env.STUDIO_V2_DISABLE_FREEZE !== "true",
      speedRamp: process.env.STUDIO_V2_DISABLE_RAMP !== "true",
      forceClimaxRamp: process.env.STUDIO_V2_FORCE_CLIMAX_RAMP === "true",
      authored: process.env.STUDIO_V2_AUTHORED === "true",
    },
  });
  const grammarApplied = v2Transform.applied;
  console.log(
    `       grammar v2: ${grammarApplied.length} transformation${grammarApplied.length === 1 ? "" : "s"} applied`,
  );
  for (const a of grammarApplied) {
    console.log(
      `         - ${a.kind}@${a.atIdx} (${a.source || a.envelope || ""})`,
    );
  }

  // ---- 7. Premium card lane v2 ----
  console.log("[7/11] applying premium card lane v2 (HF cards)...");
  const lane = applyPremiumCardLaneV2({
    scenes: v2Transform.scenes,
    story: renderStory,
    root: ROOT,
    channelId: process.env.CHANNEL || "pulse-gaming",
  });
  const scenes = lane.scenes;
  console.log(
    `       HF cards: ${lane.premiumLane.hyperframesCardCount} attached · verdict ${lane.premiumLane.verdict}`,
  );
  for (const d of lane.premiumLane.decisions) {
    console.log(`         - ${d.scene} (${d.type}) → ${d.renderer}`);
  }

  // ---- 8. Beat-aware transitions ----
  console.log("[8/11] planning beat-aware cuts...");
  const transitions = buildBeatAwareTransitions(scenes, realignedWords);
  const beatAligned = transitions.filter((t) => {
    let nearest = Infinity;
    for (const w of realignedWords) {
      const d = Math.min(
        Math.abs(t.offset - (w.start || 0)),
        Math.abs(t.offset - (w.end || 0)),
      );
      if (d < nearest) nearest = d;
    }
    return nearest <= 0.15;
  }).length;
  console.log(
    `       cuts: ${transitions.length} · beat-aligned: ${beatAligned}/${transitions.length}`,
  );

  // ---- 9. Inputs + filter graph ----
  console.log("[9/11] building inputs + filter graph...");
  const sceneInputs = scenes.map(buildV2SceneInput);
  const filterParts = scenes.map((scene, index) =>
    buildV2SceneFilter({
      slot: index,
      scene,
      story: renderStory,
      fontOpt: FONT_OPT,
    }),
  );

  // Concat all scenes (every transition in v2 is a cut)
  let prev = "v0";
  for (let i = 0; i < transitions.length; i++) {
    const out = i === transitions.length - 1 ? "base" : `xf${i + 1}`;
    filterParts.push(
      `[${prev}][v${i + 1}]concat=n=2:v=1:a=0,fps=${FPS},setpts=PTS-STARTPTS[${out}]`,
    );
    prev = out;
  }
  // Single-scene safety
  if (scenes.length === 1) {
    filterParts.push(`[v0]copy[base]`);
  }

  // ---- 10. Sound layer v2 ----
  console.log("[10/11] building sound layer v2 (SFX + ducking)...");
  const musicPath = path.join(ROOT, "audio", "Main Background Loop 1.wav");
  const hasMusic = await fs.pathExists(musicPath);

  // Audio inputs land AFTER all scene inputs.
  const voiceInputIdx = sceneInputs.length; // first audio input
  const audioInputs = [`-i "${voice.audioPath.replace(/\\/g, "/")}"`];
  let musicInputIdx = -1;
  if (hasMusic) {
    musicInputIdx = sceneInputs.length + audioInputs.length;
    audioInputs.push(`-stream_loop -1 -i "${musicPath.replace(/\\/g, "/")}"`);
  }
  const audioInputsBaseIdx = sceneInputs.length + audioInputs.length;

  const soundLayer = buildSoundLayerV2({
    scenes,
    transitions,
    voiceInputIdx,
    musicInputIdx,
    audioInputsBaseIdx,
  });
  const sfxInputs = soundLayer.extraInputs;
  filterParts.push(...soundLayer.filterLines);

  console.log(
    `       SFX cues: ${soundLayer.cueCount} · music: ${hasMusic ? "yes" : "no"} · sidechain ducking: yes`,
  );

  // ---- 11. Subtitle layer v2 ----
  console.log("[11/11] building kinetic word-pop subtitles...");
  const assPath = path.join(
    TEST_OUT,
    `${STORY_ID}_studio_v2${OUTPUT_SUFFIX}.ass`,
  );
  const channelTheme = (() => {
    try {
      const { getChannelTheme } = require("../lib/studio/v2/channel-themes");
      return getChannelTheme(process.env.CHANNEL || "pulse-gaming");
    } catch {
      return null;
    }
  })();
  const assContent = buildKineticAss({
    story: renderStory,
    words: realignedWords,
    duration: audioDurationS,
    scriptText: editorial.scriptForCaption,
    emphasisHex: channelTheme?.primary,
  });
  await fs.writeFile(assPath, assContent);
  const assDialogueCount = (assContent.match(/^Dialogue:/gm) || []).length;
  console.log(
    `       ASS file: ${assDialogueCount} dialogue events @ ${path.relative(ROOT, assPath)}`,
  );

  const assRel = path.relative(ROOT, assPath).replace(/\\/g, "/");
  const finalVideoDurationS = Number(audioDurationS.toFixed(3));
  filterParts.push(
    `[base]ass=${assRel},tpad=stop_mode=clone:stop_duration=${(
      finalVideoDurationS + 1
    ).toFixed(
      3,
    )},trim=duration=${finalVideoDurationS},setpts=PTS-STARTPTS[outv]`,
  );

  // ---- ffmpeg invocation ----
  const allInputs = [...sceneInputs, ...audioInputs, ...sfxInputs];
  const filterPath = path.join(
    TEST_OUT,
    `${STORY_ID}_studio_v2${OUTPUT_SUFFIX}_filter.txt`,
  );
  await fs.writeFile(filterPath, filterParts.join(";\n"));

  const outputPath = path.join(
    TEST_OUT,
    `studio_v2_${STORY_ID}${OUTPUT_SUFFIX}.mp4`,
  );
  const command = [
    "ffmpeg -y -hide_banner -loglevel warning",
    allInputs.join(" "),
    `-filter_complex_script "${filterPath.replace(/\\/g, "/")}"`,
    `-map "[outv]" -map "${soundLayer.mapArg.replace(/-map\s+/, "")}"`,
    "-c:v libx264 -crf 20 -preset medium",
    "-pix_fmt yuv420p -profile:v high -level:v 4.0",
    "-c:a aac -b:a 192k",
    `-r ${FPS} -shortest`,
    `-movflags +faststart "${outputPath.replace(/\\/g, "/")}"`,
  ].join(" ");

  console.log("");
  console.log("[ffmpeg] rendering v2 prototype...");
  const renderStart = Date.now();
  execSync(command, {
    cwd: ROOT,
    stdio: "inherit",
    maxBuffer: 80 * 1024 * 1024,
  });

  // Optional loudnorm post-pass — gated by STUDIO_V2_LOUDNESS_TARGET.
  // The gauntlet validated -16 LUFS as forensic-clean and +7.6 LU
  // louder than the canonical -24 LUFS mix. -14 LUFS is too aggressive
  // (audio recurrence warning) and is intentionally NOT supported here.
  const loudnessTarget = process.env.STUDIO_V2_LOUDNESS_TARGET;
  if (loudnessTarget) {
    const target = Number(loudnessTarget);
    if (!Number.isFinite(target) || target > -10 || target < -24) {
      console.warn(
        `[loudnorm] ignoring out-of-range STUDIO_V2_LOUDNESS_TARGET=${loudnessTarget} (must be between -24 and -10)`,
      );
    } else if (target === -14) {
      console.warn(
        "[loudnorm] -14 LUFS is blocked because the audio gauntlet flagged it as too aggressive (audio recurrence warning). Use -16 or above.",
      );
    } else {
      const tmpPath = outputPath.replace(/\.mp4$/i, "_pre_loudnorm.mp4");
      await fs.move(outputPath, tmpPath, { overwrite: true });
      const tp = -1.5;
      const lra = 11;
      const cmd = [
        "ffmpeg -y -hide_banner -loglevel warning",
        `-i "${tmpPath.replace(/\\/g, "/")}"`,
        "-map 0:v -map 0:a",
        "-c:v copy",
        `-c:a aac -b:a 192k`,
        `-af "loudnorm=I=${target}:TP=${tp}:LRA=${lra}"`,
        `-movflags +faststart "${outputPath.replace(/\\/g, "/")}"`,
      ].join(" ");
      console.log(
        `[loudnorm] post-pass: target=${target} LUFS, TP=${tp} dBFS, LRA=${lra}`,
      );
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
      await fs.remove(tmpPath).catch(() => {});
    }
  }

  const elapsedMs = Date.now() - renderStart;

  const probe = ffprobeJson(outputPath);
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  const output = {
    path: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
    durationS: Number.parseFloat(probe.format.duration),
    sizeBytes: Number.parseInt(probe.format.size, 10),
    bitrateKbps: Math.round(Number.parseInt(probe.format.bit_rate, 10) / 1000),
    width: video?.width,
    height: video?.height,
    pixFmt: video?.pix_fmt,
    profile: video?.profile,
    audioCodec: audio?.codec_name,
    audioSampleRate: audio?.sample_rate,
    elapsedMs,
  };

  // ---- Quality gate v2 ----
  console.log("");
  console.log("[gate] running quality gate v2...");
  const audioMeta = {
    provider:
      voice.provider ||
      (voice.source?.includes("eleven") ? "elevenlabs" : "local"),
    voiceId: voice.voiceId || null,
    source: voice.source,
    editorialScriptAppliedToAudio: voice.editorialScriptAppliedToAudio === true,
  };
  const report = buildQualityReportV2({
    storyId: STORY_ID,
    outputPath: output.path,
    pkg,
    scenes,
    transitions,
    audioMeta,
    audioDurationS,
    assPath,
    soundLayerPayload: soundLayer,
    realignedWords,
    renderedDurationS: output.durationS,
    branch: currentBranch(),
  });

  // Augment with the runtime stats + the v1-style scene list/transition log
  report.runtime = output;
  report.editorial = {
    chosenHook: pkg.hook.chosen.text,
    chosenHookSource: pkg.hook.source,
    tightenedWordCount: pkg.script.wordCountTightened,
    pronunciationMapEntries: pkg.pronunciationMap.length,
    riskFlags: pkg.riskFlags,
  };
  report.mediaDiversity = mediaDiversity;
  report.voice = {
    source: voice.source,
    audioPath: path.relative(ROOT, voice.audioPath).replace(/\\/g, "/"),
    durationS: audioDurationS,
    timestampSource: voice.timestampSource || null,
    editorialScriptAppliedToAudio: voice.editorialScriptAppliedToAudio === true,
  };
  report.subtitles = {
    assPath: path.relative(ROOT, assPath).replace(/\\/g, "/"),
    dialogueCount: assDialogueCount,
    style: "kinetic-word-pop",
  };
  report.premiumLane = lane.premiumLane;
  report.grammarApplied = grammarApplied;
  report.beatAware = {
    cutCount: transitions.length,
    cutsAlignedWithin150ms: beatAligned,
    ratio:
      transitions.length === 0
        ? 0
        : Number((beatAligned / transitions.length).toFixed(2)),
  };
  report.sceneList = scenes.map((scene) => ({
    type: scene.type || scene.sceneType,
    label: scene.label,
    duration: scene.duration,
    source:
      scene.source ||
      scene.backgroundSource ||
      scene.prerenderedMp4 ||
      scene.statLabel ||
      scene.dateLabel ||
      null,
    premiumLane: scene.premiumLane || null,
    grammarV2: scene.sceneType
      ? scene.sceneType.startsWith("punch") ||
        scene.sceneType.startsWith("speed-ramp") ||
        scene.sceneType.startsWith("freeze-frame")
        ? scene.sceneType
        : null
      : null,
  }));
  report.transitions = transitions;

  // ---- SEO package (channel-aware upload metadata) ----
  try {
    const { buildSeoPackage } = require("../lib/studio/v2/seo-package");
    const channelForSeo = channelTheme || {
      channelId: "pulse-gaming",
      channelName: "PULSE GAMING",
    };
    const seo = buildSeoPackage({
      story: renderStory,
      pkg,
      scenes,
      runtimeS: output.durationS,
      channel: channelForSeo,
    });
    const seoPath = path.join(
      TEST_OUT,
      `${STORY_ID}_studio_v2${OUTPUT_SUFFIX}_seo.json`,
    );
    await fs.writeJson(seoPath, seo, { spaces: 2 });
    report.seo = {
      path: path.relative(ROOT, seoPath).replace(/\\/g, "/"),
      title: seo.title,
      titleLength: seo.title.length,
      hashtagCount: seo.hashtags.length,
      hasChapters: !!seo.chapters,
      validationIssueCount: seo.validation.length,
      validationReds: seo.validation.filter((v) => v.severity === "red").length,
    };
    console.log(
      `[seo] package: title="${seo.title}" (${seo.title.length}c) · ${seo.hashtags.length} tags · ${seo.validation.length} validation flags`,
    );
  } catch (err) {
    console.warn(`[seo] package generation failed: ${err.message}`);
    report.seo = { error: err.message };
  }

  const reportPath = path.join(
    TEST_OUT,
    `${STORY_ID}_studio_v2${OUTPUT_SUFFIX}_report.json`,
  );
  await fs.writeJson(reportPath, report, { spaces: 2 });

  console.log("");
  console.log("=================================================");
  console.log(`  Studio Short Engine v2 render complete (${elapsedMs} ms)`);
  console.log("=================================================");
  console.log(`  output:  ${output.path}`);
  console.log(`  report:  ${path.relative(ROOT, reportPath)}`);
  console.log(`  duration: ${output.durationS.toFixed(2)}s`);
  console.log(`  size:    ${(output.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log("");
  console.log("  --- rubric verdict ---");
  console.log(`  lane: ${report.verdict.lane}`);
  console.log(
    `  green: ${report.verdict.greenHits} · amber: ${report.verdict.amberTrips} · red: ${report.verdict.redTrips}`,
  );
  for (const r of report.verdict.reasons) console.log(`    · ${r}`);
  console.log("");
  console.log("  --- automatic scores ---");
  for (const [k, v] of Object.entries(report.auto)) {
    if (!v || typeof v !== "object" || !v.grade) continue;
    const tag =
      v.grade === "green" ? "GREEN" : v.grade === "amber" ? "AMBER" : "RED  ";
    console.log(`  ${tag}  ${k.padEnd(28)} ${v.value}`);
  }
  console.log("");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
