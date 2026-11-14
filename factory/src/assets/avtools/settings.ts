// The audio and video tools' settings (pure: the environment is passed in), each off by default:
//   RADIO_STRIP        licensed car-radio music separated out of the owner's gameplay clips (src/assets/radiostrip.ts)
//   INSTANT_REPLAY     the gameplay Short's replay slowed with AI frames instead of repeated ones (src/assets/avtools.ts)
//   CROP_UPSCALE       the 9:16 crop of a 16:9 recording upscaled by a model (or sharpened classically) before it fills
//                      the phone, instead of a plain 1.78x stretch
//   RELAY_MUSIC_STRIP  the live relay's audio passed through a streaming music remover (src/relay/musicstrip.ts)
// See src/assets/avtools/MODELS.md for every model, its licence and where it came from.
import os from "node:os";
import fs from "node:fs";

export interface AvToolsSettings {
  /** The Python with torch, demucs, BS-RoFormer 0.3.10 and transformers (AVTOOLS_PYTHON). */
  python: string;
  /** The folder holding cdx23/, mbr-kim/, ast/, rife/ and realesrgan/ (AVTOOLS_MODELS). */
  models: string;
  radioStrip: {
    /** RADIO_STRIP: radio clips are stripped and used instead of thrown away. */
    enabled: boolean;
    /** RADIO_STRIP_CHECKPOINTS: CDX23 checkpoints averaged, 1 (fast) to 3 (the challenge's best). */
    checkpoints: number;
    /** RADIO_STRIP_LYRIC_PASS: the RoFormer pass that takes sung vocals out of the kept dialogue. */
    lyricPass: boolean;
    /** RADIO_STRIP_MAX_RESIDUE: the most of a clip's seconds that may still sound like music (AudioSet score 0.25+). */
    maxResidue: number;
    /** RADIO_STRIP_MAX_FINGERPRINT: the most of a clip's blocks whose fingerprint may still match the removed music. */
    maxFingerprint: number;
    /** COPYRIGHT_CHECK_GATE: a video with stripped sound uploads private and waits for a clean copyright check. */
    copyrightGate: boolean;
  };
  replay: {
    /** INSTANT_REPLAY: RIFE frames for the gameplay Short's slowed replay. */
    enabled: boolean;
    /** INSTANT_REPLAY_FACTOR: frames made per source frame (4 = quarter speed). */
    factor: number;
  };
  upscale: {
    /** CROP_UPSCALE: the crop is upscaled before it fills the phone. */
    enabled: boolean;
    /** CROP_UPSCALE_MODE: "ai" (Real-ESRGAN, falls back to classical on failure) or "classical" (Lanczos and CAS). */
    mode: "ai" | "classical";
    /** CROP_UPSCALE_STRENGTH: 0-1, how much of the model's detail is kept over a plain bicubic resize. */
    strength: number;
  };
  relay: {
    /** RELAY_MUSIC_STRIP: the relay's audio goes through the live music remover. */
    enabled: boolean;
    /** RELAY_STRIP_BLOCK, RELAY_STRIP_AHEAD, RELAY_STRIP_LEFT: seconds per step, look-ahead and context. */
    block: number;
    ahead: number;
    left: number;
    /** RELAY_STRIP_DEVICE: "mps" on the Mac mini by default; "cpu" to keep the GPU for the factory. */
    device: string;
  };
}

const bool = (env: NodeJS.ProcessEnv, name: string, fallback: boolean) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};
const num = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const n = Number(env[name]);
  return env[name] === undefined || env[name] === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};

/** The first of the usual places that exists, on the PC or the Mac mini. */
function firstThere(paths: string[], exists: (p: string) => boolean): string {
  return paths.find((p) => p && exists(p)) ?? paths[0] ?? "";
}

export function avToolsSettings(
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean = fs.existsSync,
  home = os.homedir(),
): AvToolsSettings {
  const mode = (env.CROP_UPSCALE_MODE ?? "").trim().toLowerCase();
  return {
    python:
      env.AVTOOLS_PYTHON ||
      firstThere(
        [
          "D:/pulse-tools/avtools-venv/Scripts/python.exe",
          `${home}/PulseFactory/avtools/venv/bin/python`,
        ],
        exists,
      ),
    models:
      env.AVTOOLS_MODELS ||
      firstThere(
        [
          "D:/pulse-tools/models/avtools",
          `${home}/PulseFactory/avtools/models`,
        ],
        exists,
      ),
    radioStrip: {
      enabled: bool(env, "RADIO_STRIP", false),
      checkpoints: Math.round(num(env, "RADIO_STRIP_CHECKPOINTS", 1, 1, 3)),
      lyricPass: bool(env, "RADIO_STRIP_LYRIC_PASS", true),
      maxResidue: num(env, "RADIO_STRIP_MAX_RESIDUE", 0.1, 0, 1),
      maxFingerprint: num(env, "RADIO_STRIP_MAX_FINGERPRINT", 0.1, 0, 1),
      copyrightGate: bool(env, "COPYRIGHT_CHECK_GATE", true),
    },
    replay: {
      enabled: bool(env, "INSTANT_REPLAY", false),
      factor: Math.round(num(env, "INSTANT_REPLAY_FACTOR", 4, 2, 8)),
    },
    upscale: {
      enabled: bool(env, "CROP_UPSCALE", false),
      mode: mode === "classical" ? "classical" : "ai",
      strength: num(env, "CROP_UPSCALE_STRENGTH", 0.8, 0, 1),
    },
    relay: {
      enabled: bool(env, "RELAY_MUSIC_STRIP", false),
      block: num(env, "RELAY_STRIP_BLOCK", 4, 1, 8),
      ahead: num(env, "RELAY_STRIP_AHEAD", 1.5, 0, 4),
      left: num(env, "RELAY_STRIP_LEFT", 2, 0, 6),
      device: (env.RELAY_STRIP_DEVICE || "mps").trim(),
    },
  };
}

/** One line for the boot summary. */
export function avToolsSummary(s: AvToolsSettings): string {
  const on = [
    s.radioStrip.enabled
      ? `radio strip (x${s.radioStrip.checkpoints}${s.radioStrip.lyricPass ? ", lyric pass" : ""}${s.radioStrip.copyrightGate ? ", copyright gate" : ""})`
      : "",
    s.replay.enabled ? `AI replay x${s.replay.factor}` : "",
    s.upscale.enabled ? `crop upscale (${s.upscale.mode})` : "",
    s.relay.enabled
      ? `relay music strip (${s.relay.block + s.relay.ahead}s behind)`
      : "",
  ].filter(Boolean);
  return on.length ? on.join(", ") : "off";
}
