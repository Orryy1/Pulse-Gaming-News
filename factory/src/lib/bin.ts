// ffmpeg/ffprobe come bundled (ffmpeg-static / ffprobe-static) so the PC needs
// no separate install. FFMPEG_PATH / FFPROBE_PATH override them.

import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function bundled(name: "ffmpeg" | "ffprobe"): string | undefined {
  try {
    return name === "ffmpeg"
      ? (require("ffmpeg-static") as string)
      : (require("ffprobe-static") as { path: string }).path;
  } catch {
    return undefined;
  }
}

/**
 * Which ffmpeg/ffprobe to run (pure): the setting, else on a Mac Homebrew's (ffprobe-static's darwin/arm64
 * binary is an Intel build that macOS refuses with error -86 without Rosetta, 29 Oct and 1 Nov 2026, so
 * anything run without the .env, the tests and the tools included, failed there), else the bundled one,
 * else whatever is on the PATH.
 */
export function pickBinary(
  name: "ffmpeg" | "ffprobe",
  platform: string,
  setting: string | undefined,
  exists: (p: string) => boolean,
  bundledPath: string | undefined,
): string {
  if (setting) return setting;
  if (platform === "darwin") {
    const brew = `/opt/homebrew/bin/${name}`;
    if (exists(brew)) return brew;
  }
  return bundledPath || name;
}

export const FFMPEG = pickBinary(
  "ffmpeg",
  process.platform,
  process.env.FFMPEG_PATH,
  fs.existsSync,
  bundled("ffmpeg"),
);
export const FFPROBE = pickBinary(
  "ffprobe",
  process.platform,
  process.env.FFPROBE_PATH,
  fs.existsSync,
  bundled("ffprobe"),
);

/**
 * yt-dlp prints text in the Windows code page unless told otherwise, which mangled accented creator
 * names in public credits ("Nachteule schön" became "sch�n"). Use these for any call that reads text back.
 */
export const YTDLP_TEXT = {
  args: ["--encoding", "utf-8"],
  env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
};
