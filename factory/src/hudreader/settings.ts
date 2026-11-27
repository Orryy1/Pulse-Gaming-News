// The settings of the GTA HUD and minimap reader (HUD_READER, off by default), read in one place (pure: the
// environment is passed in). Every output has its own switch, so each can be tried on its own and switched off
// without touching the rest: the per-VOD telemetry, the live-clip signal, the Day N pin, ticker and end map, and the
// measured facts.

import os from "node:os";
import path from "node:path";

export type HudRunner = "orch" | "mac" | "direct";
export type HudMatcher = "sift" | "lightglue";

export interface HudSettings {
  /** HUD_READER: read the owner's GTA streams (stars, minimap, money, banners, text) into a telemetry track. */
  enabled: boolean;
  /** HUD_READER_FPS: frames a second read (2 tracks a helicopter; more costs time, not accuracy on foot). */
  fps: number;
  /** HUD_READER_PYTHON: Python with OpenCV 5 and NumPy (the parallax venv has both). */
  python: string;
  /** HUD_READER_LIBS: folder with rapidocr_onnxruntime, lightglue and kornia (pip install --target). */
  libs: string;
  /** HUD_READER_MODELS: torch hub folder whose checkpoints/ hold the LightGlue DISK weights. */
  models: string;
  /** HUD_READER_MATCHER: sift (CPU, always there) or lightglue (DISK + LightGlue, for finding a minimap again). */
  matcher: HudMatcher;
  /** HUD_READER_OCR: read on-screen text with RapidOCR's PP-OCR models (Apache-2.0). */
  ocr: boolean;
  /** HUD_READER_THREADS: CPU threads for OpenCV and the OCR; 0 (unset) leaves them every core, as before. */
  threads: number;
  /**
   * HUD_READER_VOD_KEYFRAMES: whole recordings are read from their key frames only, at 0.5 fps (one every 2 s on
   * Twitch): about a tenth of the CPU of every-frame decoding at 2 fps, a second either way on a moment. Live pieces
   * and clips are always read in full.
   */
  vodKeyframes: boolean;
  /** HUD_READER_RUNNER: orch (PC orchestrator, class gpu, priority 20), mac (~/orch/macrun.sh) or direct (tests). */
  runner: HudRunner;
  /** HUD_READER_ORCH: the PC orchestrator's command. */
  orch: string;
  /** HUD_READER_MACRUN: the Mac's turn-taking script. */
  macrun: string;
  /** HUD_READER_GAMES: which games' streams are read (profile names in src/hudreader/profiles). */
  games: string[];
  /** HUD_LIVE_SIGNAL: HUD events (stars jump, Wasted, mission passed) are a fourth signal for live clips. */
  liveSignal: boolean;
  /** HUD_PIN: a location pin in the first 2 seconds of GTA 6 Day N Shorts. */
  pin: boolean;
  /** HUD_TICKER: a wanted-level ticker that pulses when the stars change. */
  ticker: boolean;
  /** HUD_END_MAP: the "every spot so far" map at the end of a Day N Short. */
  endMap: boolean;
  /** HUD_FACTS: measured facts (wanted spells, journeys, collectibles) offered to "I measured it" Shorts. */
  facts: boolean;
  /** HUD_MIN_CONFIDENCE: a pin or fact is used only above this (0-1). */
  minConfidence: number;
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

/** Where the reader's Python lives on each machine (the parallax venv: OpenCV 5, NumPy, torch). */
export function defaultHudPython(platform: string, home: string): string {
  return platform === "win32"
    ? "D:/pulse-tools/parallax-venv/Scripts/python.exe"
    : path.posix.join(home, "PulseFactory/parallax/bin/python");
}

export function hudSettings(
  env: NodeJS.ProcessEnv,
  platform: string = process.platform,
  home: string = os.homedir(),
): HudSettings {
  const win = platform === "win32";
  const matcher = (env.HUD_READER_MATCHER || "sift").toLowerCase();
  const runner = (
    env.HUD_READER_RUNNER || (win ? "orch" : "mac")
  ).toLowerCase();
  return {
    enabled: bool(env, "HUD_READER", false),
    fps: num(env, "HUD_READER_FPS", 2, 0.5, 10),
    python: env.HUD_READER_PYTHON || defaultHudPython(platform, home),
    libs:
      env.HUD_READER_LIBS ||
      (win
        ? "D:/pulse-tools/hud-libs"
        : path.posix.join(home, "PulseFactory/hud-libs")),
    models:
      env.HUD_READER_MODELS ||
      (win
        ? "D:/pulse-tools/models/hud/hub"
        : path.posix.join(home, "PulseFactory/models/hud/hub")),
    matcher: matcher === "lightglue" ? "lightglue" : "sift",
    ocr: bool(env, "HUD_READER_OCR", true),
    threads: Math.round(num(env, "HUD_READER_THREADS", 0, 0, 16)),
    vodKeyframes: bool(env, "HUD_READER_VOD_KEYFRAMES", false),
    runner:
      runner === "direct" || runner === "mac" || runner === "orch"
        ? (runner as HudRunner)
        : "orch",
    orch: env.HUD_READER_ORCH || "C:/Claude/orchestrator/orch.cmd",
    macrun: env.HUD_READER_MACRUN || path.posix.join(home, "orch/macrun.sh"),
    games: (env.HUD_READER_GAMES || "gta5,gta6")
      .split(",")
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean),
    liveSignal: bool(env, "HUD_LIVE_SIGNAL", false),
    pin: bool(env, "HUD_PIN", false),
    ticker: bool(env, "HUD_TICKER", false),
    endMap: bool(env, "HUD_END_MAP", false),
    facts: bool(env, "HUD_FACTS", false),
    minConfidence: num(env, "HUD_MIN_CONFIDENCE", 0.6, 0, 1),
  };
}

/** One line for the boot summary. */
export function hudSummary(s: HudSettings): string {
  if (!s.enabled) return "off";
  const outs = [
    s.liveSignal ? "live signal" : "",
    s.pin ? "pin" : "",
    s.ticker ? "ticker" : "",
    s.endMap ? "end map" : "",
    s.facts ? "facts" : "",
  ].filter(Boolean);
  return `on (${s.games.join(",")}; ${s.fps} fps; ${s.matcher}${s.ocr ? "+ocr" : ""}; via ${s.runner}${outs.length ? `; ${outs.join(", ")}` : "; telemetry only"})`;
}
