// Pre-blurred 1080x1920 plates for the framed-footage panel, made once at
// asset time with ffmpeg so the renderer never runs a live blur.

import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

/** Writes `<file>.blur.jpg` next to the asset (first frame for clips) and returns its episode-relative path. */
export async function blurPlate(episodeDir: string, file: string): Promise<string> {
  const out = file.replace(/\.[a-z0-9]+$/i, "") + ".blur.jpg";
  const abs = path.join(episodeDir, out);
  try {
    await fs.access(abs);
    return out;
  } catch {
    // not made yet
  }
  await run(FFMPEG, [
    "-loglevel", "error", "-y", "-i", path.join(episodeDir, file),
    "-frames:v", "1",
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.22:saturation=0.75",
    "-q:v", "4", abs,
  ]);
  return out;
}
