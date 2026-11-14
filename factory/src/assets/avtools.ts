// Instant replay and sharpening for the rebuilt gameplay Short (INSTANT_REPLAY, CROP_UPSCALE; both off by default).
//   - INSTANT_REPLAY: the outcome plays again at a quarter speed (gameplaydirect.ts instantReplayTiming), and the
//     slowed frames are made by RIFE 4.26 (MIT) instead of each frame shown four times, so the replay moves smoothly.
//   - CROP_UPSCALE: the 9:16 crop of a 16:9 recording is about 607x1080 shown at 1080x1920, a 1.78x blow-up. It is
//     cropped at the source's own size and upscaled by Real-ESRGAN general x4v3 (BSD-3-Clause), or classically
//     (Lanczos then contrast-adaptive sharpening) when CROP_UPSCALE_MODE=classical or the model fails.
// Both run src/assets/avtools/vidtools.py (python -I, from its own folder) with a GPU turn from the PC orchestrator.
// Anything that fails returns false and the caller makes the cut the old way: never a lost Short.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { loadOrch } from "../lib/orch.ts";
import { errorMessage, log } from "../lib/util.ts";
import { AVTOOLS_DIR } from "./radiostrip.ts";
import type { AvToolsSettings } from "./avtools/settings.ts";
import {
  atempoChain,
  directFilter,
  replayWindow,
  type DirectCut,
} from "../gameplaydirect.ts";

const run = promisify(execFile);
const VIDTOOLS = path.join(AVTOOLS_DIR, "vidtools.py");
const OUT_W = 1080;
const OUT_H = 1920;

async function gpuTurn(job: string, est: number): Promise<() => void> {
  try {
    const orch = await loadOrch();
    return (await orch.lease("gpu", {
      job,
      project: "pulse",
      priority: 60,
      kind: "pulse:avtools",
      est,
      vram: 6,
      ram: 4,
      maxWait: 30,
    })) as () => void;
  } catch {
    return () => undefined;
  }
}

/** Runs vidtools.py with a GPU turn; its last stdout line is JSON. */
async function vidtools(
  s: Pick<AvToolsSettings, "python" | "models">,
  args: string[],
  job: string,
  est: number,
): Promise<Record<string, unknown>> {
  const release = await gpuTurn(job, est);
  try {
    const { stdout } = await run(
      s.python,
      [
        "-I",
        VIDTOOLS,
        "--ffmpeg",
        FFMPEG,
        "--ffprobe",
        FFPROBE,
        "--models",
        s.models,
        ...args,
      ],
      {
        cwd: AVTOOLS_DIR,
        timeout: 20 * 60_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const last = String(stdout).trim().split(/\r?\n/).at(-1) ?? "{}";
    return JSON.parse(last) as Record<string, unknown>;
  } finally {
    release();
  }
}

const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], {
    timeout: 10 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

/** The classical upscale filter (pure): Lanczos to the phone's size, then contrast-adaptive sharpening. */
export function classicalUpscaleFilter(
  w = OUT_W,
  h = OUT_H,
  sharpen = 0.5,
): string {
  return `scale=${w}:${h}:flags=lanczos,cas=strength=${sharpen.toFixed(2)}`;
}

/** The slowed replay's frame factor (pure): 1/speed rounded, at least 2. */
export const slowFactor = (speed: number) =>
  Math.max(2, Math.round(1 / Math.max(0.05, speed)));

export interface EnhancedCut {
  replay: "ai" | "classical" | "none";
  upscale: "ai" | "classical" | "plain";
  seconds: Record<string, number>;
}

/**
 * The gameplay Short's cut.mp4 with an AI replay and an upscaled crop. Returns undefined (and leaves no cut.mp4)
 * when anything fails, so the caller's single ffmpeg pass makes it instead.
 */
export async function enhanceDirectCut(o: {
  s: AvToolsSettings;
  source: string;
  workDir: string;
  out: string;
  cut: DirectCut;
  tone: string;
  focusStart: number;
  focusPayoff: number;
  replaySource: number;
  replaySpeed: number;
}): Promise<EnhancedCut | undefined> {
  const { s } = o;
  const work = path.join(o.workDir, "enhance");
  await fs.mkdir(work, { recursive: true });
  const t: Record<string, number> = {};
  const clock = async <T>(name: string, f: () => Promise<T>) => {
    const a = Date.now();
    try {
      return await f();
    } finally {
      t[name] = Math.round((Date.now() - a) / 100) / 10;
    }
  };
  try {
    // 1. The joined cut, cropped to 9:16 at the source's own size, with no replay yet.
    const main = path.join(work, "main.mp4");
    await clock("cut", () =>
      ff([
        "-i",
        o.source,
        "-filter_complex",
        directFilter(o.cut, {
          tone: o.tone,
          focusStart: o.focusStart,
          focusPayoff: o.focusPayoff,
          replaySource: 0,
          native: true,
        }),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "14",
        "-c:a",
        "pcm_s16le",
        main.replace(/\.mp4$/, ".mkv"),
      ]),
    );
    const mainMkv = main.replace(/\.mp4$/, ".mkv");
    // 2. The replay: RIFE frames when INSTANT_REPLAY is on, else the old repeated frames.
    let joined = mainMkv;
    let replay: EnhancedCut["replay"] = "none";
    if (o.replaySource > 0) {
      const { from, to } = replayWindow(o.cut, o.replaySource);
      const rsrc = path.join(work, "replay_src.mkv");
      const rslow = path.join(work, "replay_slow.mp4");
      const raud = path.join(work, "replay.wav");
      await ff([
        "-ss",
        String(from),
        "-to",
        String(to),
        "-i",
        mainMkv,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "12",
        rsrc,
      ]);
      await ff([
        "-ss",
        String(from),
        "-to",
        String(to),
        "-i",
        mainMkv,
        "-vn",
        "-af",
        atempoChain(o.replaySpeed),
        raud,
      ]);
      const factor = slowFactor(o.replaySpeed);
      if (s.replay.enabled) {
        try {
          await clock("rife", () =>
            vidtools(
              s,
              ["slowmo", rsrc, rslow, "--factor", String(factor)],
              "instant replay (RIFE)",
              2,
            ),
          );
          replay = "ai";
        } catch (err) {
          log("warn", "AI replay failed; repeated frames instead", {
            error: errorMessage(err),
          });
        }
      }
      if (replay !== "ai") {
        await ff([
          "-i",
          rsrc,
          "-vf",
          `setpts=PTS/${o.replaySpeed},fps=30`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "14",
          rslow,
        ]);
        replay = "classical";
      }
      joined = path.join(work, "joined.mkv");
      await clock("join", () =>
        ff([
          "-i",
          mainMkv,
          "-i",
          rslow,
          "-i",
          raud,
          "-filter_complex",
          "[0:v]fps=30,setsar=1[a];[1:v]fps=30,setsar=1[b];[a][b]concat=n=2:v=1:a=0[v];[0:a][2:a]concat=n=2:v=0:a=1[au]",
          "-map",
          "[v]",
          "-map",
          "[au]",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "14",
          "-c:a",
          "pcm_s16le",
          joined,
        ]),
      );
    }
    // 3. To the phone's size: the model, the classical sharpen, or a plain resize when CROP_UPSCALE is off.
    let upscale: EnhancedCut["upscale"] = "plain";
    const video = path.join(work, "video.mp4");
    if (s.upscale.enabled && s.upscale.mode === "ai") {
      try {
        await clock("esrgan", () =>
          vidtools(
            s,
            [
              "upscale",
              joined,
              video,
              "--width",
              String(OUT_W),
              "--height",
              String(OUT_H),
              "--strength",
              String(s.upscale.strength),
            ],
            "crop upscale (Real-ESRGAN)",
            4,
          ),
        );
        upscale = "ai";
      } catch (err) {
        log("warn", "AI upscale failed; classical sharpening instead", {
          error: errorMessage(err),
        });
      }
    }
    if (upscale !== "ai") {
      const vf = s.upscale.enabled
        ? classicalUpscaleFilter()
        : `scale=${OUT_W}:${OUT_H}:flags=lanczos`;
      await clock("scale", () =>
        ff([
          "-i",
          joined,
          "-vf",
          vf,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "16",
          video,
        ]),
      );
      upscale = s.upscale.enabled ? "classical" : "plain";
    }
    // 4. Picture and sound together, with the old cut's end fade on the sound.
    const total = await durationOf(video);
    await ff([
      "-i",
      video,
      "-i",
      joined,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-af",
      `afade=t=out:st=${Math.max(0, total - 0.08).toFixed(3)}:d=0.08`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      o.out,
    ]);
    log("info", "gameplay cut enhanced", { replay, upscale, seconds: t });
    return { replay, upscale, seconds: t };
  } catch (err) {
    log("warn", "gameplay cut enhancement failed; the plain cut is made", {
      error: errorMessage(err),
    });
    await fs.rm(o.out, { force: true }).catch(() => undefined);
    return undefined;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function durationOf(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(String(stdout).trim()) || 0;
}
