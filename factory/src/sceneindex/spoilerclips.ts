// The spoiler guard's look at the owner's own stream clips (SPOILER_GUARD, src/sceneindex/spoilers.ts): during a
// game's spoiler window, before a reviewed clip becomes a Short, it is measured for the signs of a story cutscene:
// how much of it someone is speaking (Whisper's word timings, or Sound Analysis' speech share when the Mac's finder
// wrote one into meta.json), how many sampled frames carry cinema bars, and whether its words are a line the scene
// index knows (which also says where in the story it is). A clip held here waits until the window closes.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { letterboxed } from "../assets/footagefirst.ts";
import { loadSceneIndex } from "./schema.ts";
import {
  clipStoryMoment,
  spoilerWindows,
  streamClipHold,
  windowFor,
  type SpoilerWindow,
} from "./spoilers.ts";
import type { Config } from "../config.ts";

/** A child whose stdout is bytes (a 9x8 frame), not text. */
const runRaw = (cmd: string, args: string[]) =>
  promisify(execFile)(cmd, args, {
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  }) as Promise<{ stdout: Buffer; stderr: Buffer }>;

/** The share of a clip someone is speaking, from word timings (pure): words merged where under 0.6 s apart. */
export function speechShare(
  words: Array<{ start: number; end?: number }>,
  seconds: number,
): number {
  if (!(seconds > 0) || !words.length) return 0;
  let total = 0;
  let from = -1;
  let to = -1;
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const end = Math.max(w.start + 0.2, w.end ?? w.start + 0.3);
    if (w.start - to <= 0.6) to = Math.max(to, end);
    else {
      if (to > from) total += to - from;
      from = w.start;
      to = end;
    }
  }
  if (to > from) total += to - from;
  return Math.min(1, total / seconds);
}

/** The share of `samples` evenly spaced frames with cinema bars (9x8 greyscale each, src/assets/footagefirst.ts). */
async function barsShare(
  file: string,
  seconds: number,
  samples = 8,
): Promise<number> {
  let bars = 0;
  let seen = 0;
  for (let k = 0; k < samples; k++) {
    const at = ((k + 0.5) / samples) * Math.max(1, seconds);
    try {
      const { stdout } = await runRaw(FFMPEG, [
        "-v",
        "error",
        "-ss",
        at.toFixed(2),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=9:8,format=gray",
        "-f",
        "rawvideo",
        "-",
      ]);
      if (stdout.length >= 72) {
        seen++;
        if (letterboxed(new Uint8Array(stdout.subarray(0, 72)))) bars++;
      }
    } catch {
      /* a frame that will not decode is not counted */
    }
  }
  return seen ? bars / seen : 0;
}

/**
 * Whether a reviewed stream clip is held from Shorts for spoilers; undefined outside every window. Never throws:
 * a measurement that fails is left out, and the reviewer's own spoiler flag still counts.
 */
export async function streamClipSpoiler(
  cfg: Pick<Config, "dataDir" | "spoilerGuard">,
  dir: string,
  meta: {
    clip: { file?: string; seconds: number };
    sound?: { speech_share?: number };
  },
  game: string,
  reviewSpoiler: boolean,
  now: Date,
  windows: readonly SpoilerWindow[] = spoilerWindows(),
): Promise<{ hold: boolean; reason: string; until: string } | undefined> {
  if (!cfg.spoilerGuard) return undefined;
  const w = windowFor(windows, game, now);
  if (!w) return undefined;
  try {
    const words = JSON.parse(
      await fs.readFile(path.join(dir, "words.json"), "utf8").catch(() => "[]"),
    ) as Array<{
      text: string;
      start: number;
      end?: number;
    }>;
    const seconds = meta.clip.seconds;
    const index = await loadSceneIndex(cfg.dataDir, w.game);
    const transcript = words.map((x) => x.text).join(" ");
    const verdict = streamClipHold(
      w,
      index,
      {
        reviewSpoiler,
        speechShare: meta.sound?.speech_share ?? speechShare(words, seconds),
        letterboxShare: await barsShare(
          path.join(dir, meta.clip.file || "clip.mp4"),
          seconds,
        ),
        storyAt: index ? clipStoryMoment(index, transcript) : undefined,
      },
      now,
    );
    return { ...verdict, until: w.until };
  } catch (err) {
    log("warn", "spoiler guard: stream clip not measured", {
      dir,
      error: errorMessage(err),
    });
    return {
      hold: Boolean(reviewSpoiler),
      reason: "could not be measured",
      until: w.until,
    };
  }
}
