// SHORT_FULL_COVER (25 Nov 2026). TikTok's profile grid showed half-built titles: "GAVE KRATOS" over a "GOD OF WAR"
// caption, "TV KEEPS" over "GOD OF WAR'S", "GTA 6'S" over "GTA FILE". Each cover was the Short's first frame, and since
// SHORT_OPEN_WORDS that frame carries one or two caption words in place of the headline, plus the first page of the
// word-by-word caption. No frame of the video holds the whole title, so no offset alone could fix it.
//
// The render now also writes cover.jpg (render.ts coverStillProps): frame 0 with the whole headline and no caption.
// Where a platform takes a picture it gets that picture (Instagram cover_url, the YouTube custom thumbnail). Where it
// only takes a moment in the video (TikTok, through Buffer's thumbnailOffset or TikTok's own video_cover_timestamp_ms),
// it gets a social copy whose first 0.4 s show the cover over the opening, then cut to the Short as it is, and the
// offset points inside that hold. A cut, not a fade: the picture beneath is the same opening, and a fade ghosted the
// headline over the opening words for six frames (proof, 25 Nov 2026). The YouTube Short itself is never touched: its hook keeps its pace.
import fs from "node:fs";
import path from "node:path";

/** The cover still's name in the episode folder. */
export const COVER_FILE = "cover.jpg";
/** The social copy (TikTok): the Short with the cover over its first moments. */
export const SOCIAL_FILE = "social.mp4";
/** How long the cover holds at the start of the social copy before it cuts to the opening. */
export const COVER_HOLD_SECONDS = 0.4;
/** The cover moment the platforms are told to use: well inside the hold, clear of the first frame and the cut. */
export const COVER_OFFSET_MS = 200;

/** The ffmpeg arguments for the social copy (pure): picture re-encoded with the cover on top, sound copied. */
export function socialCutArgs(
  video: string,
  cover: string,
  out: string,
): string[] {
  const hold = COVER_HOLD_SECONDS;
  return [
    "-y",
    "-v",
    "error",
    "-i",
    video,
    "-loop",
    "1",
    "-framerate",
    "30",
    "-t",
    String(hold),
    "-i",
    cover,
    "-filter_complex",
    // The still as a layer the size of the video for the hold, then gone; the video plays on beneath from frame 0, so
    // the sound and every later frame keep their timing.
    `[1:v][0:v]scale2ref[c][base];[base][c]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]`,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "19",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** Whether a made file is still good: present and no older than any of its sources (pure but for the stats). */
export function freshFrom(out: string, sources: string[]): boolean {
  if (!fs.existsSync(out)) return false;
  const made = fs.statSync(out).mtimeMs;
  return sources.every(
    (s) => fs.existsSync(s) && fs.statSync(s).mtimeMs <= made,
  );
}

/** The episode's cover still, when the switch is on and the render made one; undefined otherwise. */
export function coverOf(
  enabled: boolean,
  episodeDir: string,
): string | undefined {
  if (!enabled) return undefined;
  const file = path.join(episodeDir, COVER_FILE);
  return fs.existsSync(file) ? file : undefined;
}

/**
 * The social copy for a Short with a cover (made once, remade when the Short or the cover is newer); the cover moment
 * goes with it. Undefined when there is no cover: the platform gets the Short as before.
 */
export async function socialCut(
  enabled: boolean,
  video: string,
  run: (args: string[]) => Promise<void> = ffmpeg,
): Promise<{ file: string; offsetMs: number } | undefined> {
  const dir = path.dirname(video);
  const cover = coverOf(enabled, dir);
  if (!cover) return undefined;
  const out = path.join(dir, SOCIAL_FILE);
  if (!freshFrom(out, [video, cover])) {
    const tmp = path.join(dir, `social.part.mp4`);
    await run(socialCutArgs(video, cover, tmp));
    await fs.promises.rename(tmp, out);
  }
  return { file: out, offsetMs: COVER_OFFSET_MS };
}

async function ffmpeg(args: string[]): Promise<void> {
  const { FFMPEG } = await import("../lib/bin.ts");
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) =>
    execFile(FFMPEG, args, { maxBuffer: 10 * 1024 * 1024 }, (err) =>
      err ? reject(err) : resolve(),
    ),
  );
}
