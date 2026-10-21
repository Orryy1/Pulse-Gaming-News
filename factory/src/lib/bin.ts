// ffmpeg/ffprobe come bundled (ffmpeg-static / ffprobe-static) so the PC needs
// no separate install. FFMPEG_PATH / FFPROBE_PATH override them.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function bundled(name: "ffmpeg" | "ffprobe"): string | undefined {
  try {
    return name === "ffmpeg" ? (require("ffmpeg-static") as string) : (require("ffprobe-static") as { path: string }).path;
  } catch {
    return undefined;
  }
}

export const FFMPEG = process.env.FFMPEG_PATH || bundled("ffmpeg") || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || bundled("ffprobe") || "ffprobe";

/**
 * yt-dlp prints text in the Windows code page unless told otherwise, which mangled accented creator
 * names in public credits ("Nachteule schön" became "sch�n"). Use these for any call that reads text back.
 */
export const YTDLP_TEXT = {
  args: ["--encoding", "utf-8"],
  env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
};
