/**
 * lib/studio/v2/sound-layer-v2.js — premium sound design layer.
 *
 * Three things this layer adds on top of v1:
 *
 *   1. SFX hits on cut transitions
 *      A short transient (audio/sfx/whoosh_short.wav, 0.45s, mono)
 *      is overlaid at every CUT transition in the slate. The hit
 *      lands on the cut frame, slightly hot (-3 dBFS), and decays
 *      under the voice naturally.
 *
 *   2. Opener sting on the cold open
 *      A longer hit (audio/sfx/hit_short.wav, 0.6s) lands at t=0
 *      with the first frame of the opener. Gives the video an
 *      "intentional cold open" feel rather than just fading in.
 *
 *   3. Bed ducking via sidechaincompress
 *      Music input is compressed against the voice as the sidechain
 *      trigger. When voice is louder than threshold, music drops
 *      6+ dB. Attack 5ms, release 250ms — fast enough to catch
 *      the start of each spoken phrase, slow enough to not pump.
 *
 * Output: a list of ffmpeg input strings + a list of audio filter
 * graph fragments. The studio renderer slots these into its
 * existing audio mix path.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..", "..");

const WHOOSH_PATH = path.join(ROOT, "audio", "sfx", "whoosh_short.wav");
const HIT_PATH = path.join(ROOT, "audio", "sfx", "hit_short.wav");

/**
 * Compute the absolute start time of every CUT transition in the
 * slate. Used to schedule SFX hits.
 *
 * The slate's transition plan from the renderer maps each edge to
 * a `type` (cut / dissolve / slide / etc.) and an `offset`. We
 * only emit SFX on the `cut` type — dissolves are smooth, they
 * don't need a hit.
 */
function buildSfxCueList({ scenes, transitions, openerStingS = 0 }) {
  const cues = [];
  if (process.env.STUDIO_V2_SFX_MODE === "off") {
    return [];
  }
  // Opener sting is opt-in. The default is silence at t=0 because
  // the generic hit tested harshly on real renders.
  if (openerStingS > 0 && process.env.STUDIO_V2_OPENER_STING === "true") {
    cues.push({ atS: 0, kind: "opener-sting", durationS: openerStingS });
  }
  if ((process.env.STUDIO_V2_SFX_MODE || "minimal") === "minimal") {
    return cues;
  }
  // SFX whooshes on every CUT edge.
  let runningDur = scenes[0]?.duration || 0;
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (t.type === "cut") {
      cues.push({
        atS: Number(runningDur.toFixed(2)),
        kind: "whoosh",
        durationS: 0.45,
      });
      runningDur += scenes[i + 1]?.duration || 0;
    } else {
      // xfade / dissolve / slide — no SFX
      runningDur = (t.offset || runningDur) + (scenes[i + 1]?.duration || 0);
    }
  }
  return cues;
}

/**
 * Build the ffmpeg `-i` strings for each SFX cue. Each cue becomes
 * a separate input so we can volume-adjust + adelay individually.
 *
 * Each cue MAY carry its own `path` (from the audio-library plan) —
 * if absent, falls back to the legacy WHOOSH/HIT pair so older
 * callers still work unchanged.
 *
 * Returns:
 *   {
 *     inputs:    array of `-i ...` strings (one per cue)
 *     baseIdx:   the offset where these inputs land in the
 *                inputs array (caller passes in audioBaseIdx)
 *   }
 */
function buildSfxInputs({ cues, audioBaseIdx }) {
  const inputs = [];
  const cueDescriptors = [];
  cues.forEach((cue, i) => {
    let src = cue.path;
    if (!src) {
      // Legacy fallback for the original two-asset cue plan.
      src = cue.kind === "opener-sting" ? HIT_PATH : WHOOSH_PATH;
    }
    inputs.push(`-i "${src.replace(/\\/g, "/")}"`);
    cueDescriptors.push({
      ...cue,
      inputIdx: audioBaseIdx + i,
    });
  });
  return { inputs, cueDescriptors };
}

/**
 * Build the audio filter graph. Inputs:
 *   voiceIdx  — index of the narration audio input
 *   musicIdx  — index of the music bed (looped via -stream_loop -1)
 *   sfxCues   — descriptors from buildSfxInputs
 *
 * Output label: [outa]
 *
 * Filter chain:
 *   1. Voice volume to 1.0 → [voice]
 *   2. Each SFX → adelay to its cue time → asetpts → volume → [sfxN]
 *   3. amix all SFX → [sfxsum]
 *   4. Music → [bgm_raw]
 *   5. sidechaincompress [bgm_raw] keyed by [voice] → [bgm]
 *      (music ducks when voice is present)
 *   6. amix [voice][sfxsum][bgm] duration=first → [outa]
 */
function buildAudioMixFilters({ voiceIdx, musicIdx, sfxCues, targetDurationS }) {
  const lines = [];
  const targetDuration = Number(targetDurationS);
  const hasTargetDuration =
    Number.isFinite(targetDuration) && targetDuration > 0;

  // 1. Voice — split into two streams so we can use one as the
  //    sidechain trigger and the other in the final mix.
  lines.push(`[${voiceIdx}:a]volume=1.0[voicepre]`);
  lines.push(`[voicepre]asplit=2[voice][voiceSC]`);

  // 2. Each SFX → delay to cue time + volume normalise. Per-cue
  //    `vol` from the audio-library plan takes precedence; legacy
  //    cues without it default to opener=0.5 / non-opener=0.22.
  const sfxLabels = [];
  sfxCues.forEach((cue, i) => {
    const delayMs = Math.max(0, Math.round(cue.atS * 1000));
    const cueVol = Number.isFinite(Number(cue.vol))
      ? Number(cue.vol)
      : cue.kind === "opener-sting"
        ? 0.5
        : 0.22;
    const cueDuration = Math.max(0.08, Number(cue.durationS || 0.35));
    const fadeIn = Math.min(0.04, cueDuration / 3);
    const fadeOut = Math.min(0.08, cueDuration / 2);
    const fadeOutStart = Math.max(0, cueDuration - fadeOut);
    const lab = `sfx${i}`;
    lines.push(
      `[${cue.inputIdx}:a]atrim=0:${cueDuration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${cueVol.toFixed(3)},afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)},adelay=${delayMs}|${delayMs},apad[${lab}]`,
    );
    sfxLabels.push(lab);
  });

  // 3. amix SFX (or empty stream if none)
  let sfxSum = null;
  if (sfxLabels.length > 0) {
    sfxSum = "sfxsum";
    if (sfxLabels.length === 1) {
      lines.push(`[${sfxLabels[0]}]anull[${sfxSum}]`);
    } else {
      lines.push(
        `${sfxLabels.map((l) => `[${l}]`).join("")}amix=inputs=${sfxLabels.length}:duration=first:dropout_transition=0:normalize=0[${sfxSum}]`,
      );
    }
  }

  // 4. Music with sidechain compression keyed by voice. Settings:
  //    threshold=0.035, ratio=6, attack=20ms, release=450ms.
  //    This keeps the bed present between phrases while clearing room for
  //    narration like a broadcast mix, not a loud gaming montage.
  if (musicIdx >= 0) {
    lines.push(`[${musicIdx}:a]volume=0.075[bgm_raw]`);
    lines.push(
      `[bgm_raw][voiceSC]sidechaincompress=threshold=0.035:ratio=6:attack=20:release=450:knee=3:level_sc=1[bgm]`,
    );
  }

  // 5. Final mix
  const mixInputs = ["[voice]"];
  if (sfxSum) mixInputs.push(`[${sfxSum}]`);
  if (musicIdx >= 0) mixInputs.push("[bgm]");
  if (mixInputs.length === 1) {
    lines.push(`${mixInputs[0]}anull[mixpre]`);
  } else {
    lines.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=${hasTargetDuration ? "longest" : "first"}:dropout_transition=0:normalize=0[mixpre]`,
    );
  }
  lines.push("[mixpre]alimiter=limit=0.92[mixlimited]");
  if (hasTargetDuration) {
    lines.push(
      `[mixlimited]apad,atrim=duration=${targetDuration.toFixed(3)},asetpts=PTS-STARTPTS[outa]`,
    );
  } else {
    lines.push("[mixlimited]anull[outa]");
  }

  return { lines, outLabel: "[outa]" };
}

/**
 * Convenience: end-to-end builder. Returns a ready-to-splice payload.
 *
 *   {
 *     extraInputs:  string[]   — additional ffmpeg -i lines (SFX inputs)
 *     filterLines:  string[]   — audio filter graph lines
 *     mapArg:       string     — "-map [outa]"
 *     cueCount:     number
 *   }
 */
function buildSoundLayerV2({
  scenes,
  transitions,
  voiceInputIdx,
  musicInputIdx,
  audioInputsBaseIdx,
  audioPlan,
  targetDurationS,
}) {
  // Prefer an explicit cue list from the audio-library plan when
  // supplied — it carries per-cue path + vol + kind. Fall back to
  // the legacy minimal/full env-gated cue list otherwise so callers
  // that haven't migrated still work.
  const cues =
    Array.isArray(audioPlan?.sfxCues) && audioPlan.sfxCues.length > 0
      ? audioPlan.sfxCues
      : buildSfxCueList({
          scenes,
          transitions,
          openerStingS: 0.6,
        });
  const { inputs, cueDescriptors } = buildSfxInputs({
    cues,
    audioBaseIdx: audioInputsBaseIdx,
  });
  const { lines } = buildAudioMixFilters({
    voiceIdx: voiceInputIdx,
    musicIdx: musicInputIdx,
    sfxCues: cueDescriptors,
    targetDurationS,
  });
  return {
    extraInputs: inputs,
    filterLines: lines,
    mapArg: `-map "[outa]"`,
    cueCount: cueDescriptors.length,
    cues: cueDescriptors,
    plan: audioPlan || null,
  };
}

async function ensureSfxAssets() {
  const required = [WHOOSH_PATH, HIT_PATH];
  for (const p of required) {
    if (!(await fs.pathExists(p))) {
      throw new Error(
        `Sound layer v2: missing SFX asset ${p}. Run the SFX-extraction step first.`,
      );
    }
  }
  return { WHOOSH_PATH, HIT_PATH };
}

module.exports = {
  buildSoundLayerV2,
  buildSfxCueList,
  buildSfxInputs,
  buildAudioMixFilters,
  ensureSfxAssets,
  WHOOSH_PATH,
  HIT_PATH,
};
