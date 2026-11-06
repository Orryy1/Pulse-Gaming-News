// ffmpeg/ffprobe come bundled (ffmpeg-static / ffprobe-static) so the PC needs
// no separate install. FFMPEG_PATH / FFPROBE_PATH override them.

import { execFileSync } from "node:child_process";
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

/** The major version in `ffmpeg -version` output; 0 when it cannot be read (pure). */
export function ffmpegMajor(versionText: string): number {
  return Number(versionText.match(/ffmpeg version n?(\d+)\./)?.[1] ?? 0);
}

/**
 * The arguments that read an audio filter from a file (pure). ffmpeg 9 removed -filter_script (Homebrew's on the
 * Mac, 4 Nov 2026: every narration failed at its breath step); the new form exists from 7, and the PC's bundled
 * ffmpeg is 6.1, so it depends on the build. An unreadable version gets the new form: only very old builds lack it.
 */
export function audioFilterScriptArgs(script: string, major: number): string[] {
  return major > 0 && major < 7
    ? ["-filter_script:a", script]
    : ["-/filter:a", script];
}

let installedMajor: number | undefined;
/** The installed ffmpeg's major version, asked once. */
export function installedFfmpegMajor(): number {
  if (installedMajor === undefined) {
    try {
      installedMajor = ffmpegMajor(
        execFileSync(FFMPEG, ["-version"], { encoding: "utf8", timeout: 20_000 }),
      );
    } catch {
      installedMajor = 0;
    }
  }
  return installedMajor;
}
