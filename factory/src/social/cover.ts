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
// SHORT_LAYOUTS (src/render/untemplate.ts): a Short that opens on the footage or the lower third has no headline card
// beneath the cover, so a hard cut jumps from the card to a different picture; there the cover holds as long, then
// fades out over COVER_FADE_FRAMES into the video. A card-opening Short (and every Short with the test off) keeps the cut.
import fs from "node:fs";
import path from "node:path";

/** The cover still's name in the episode folder. */
export const COVER_FILE = "cover.jpg";
/** The social copy (TikTok): the Short with the cover over its first moments. */
export const SOCIAL_FILE = "social.mp4";
/**
 * How long the cover holds at the start of the social copy: then it cuts to a card opening, or fades out over
 * COVER_FADE_FRAMES into a footage or lower-third opening.
 */
export const COVER_HOLD_SECONDS = 0.4;
/** Frames the cover takes to fade into a footage or lower-third opening, after the full hold (6 frames, 0.2 s). */
export const COVER_FADE_FRAMES = 6;
/** The cover moment the platforms are told to use: well inside the hold, clear of the first frame and the cut. */
export const COVER_OFFSET_MS = 200;

/**
 * The ffmpeg arguments for the social copy (pure): picture re-encoded with the cover on top, sound copied. With
 * `crossfade` (a footage or lower-third opening) the cover holds as long, then fades out over COVER_FADE_FRAMES;
 * without it the arguments are exactly the hard cut's.
 */
export function socialCutArgs(
  video: string,
  cover: string,
  out: string,
  crossfade = false,
): string[] {
  const fadeS = COVER_FADE_FRAMES / 30;
  // The still lasts through the fade and one frame more, whose alpha is 0, so it leaves fully faded.
  const hold = crossfade
    ? Number(((Math.round(COVER_HOLD_SECONDS * 30) + COVER_FADE_FRAMES + 1) / 30).toFixed(4))
    : COVER_HOLD_SECONDS;
  const layer = crossfade
    ? `[1:v][0:v]scale2ref[c0][base];[c0]format=rgba,fade=t=out:st=${COVER_HOLD_SECONDS}:d=${Number(fadeS.toFixed(4))}:alpha=1[c];`
    : `[1:v][0:v]scale2ref[c][base];`;
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
    `${layer}[base][c]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]`,
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
 * goes with it. Undefined when there is no cover: the platform gets the Short as before. `open` is the Short's
 * opening (assets.shortShape.open): footage or lower fades the cover out, anything else cuts as before.
 */
export async function socialCut(
  enabled: boolean,
  video: string,
  run: (args: string[]) => Promise<void> = ffmpeg,
  open?: string,
): Promise<{ file: string; offsetMs: number } | undefined> {
  const dir = path.dirname(video);
  const cover = coverOf(enabled, dir);
  if (!cover) return undefined;
  const out = path.join(dir, SOCIAL_FILE);
  if (!freshFrom(out, [video, cover])) {
    const tmp = path.join(dir, `social.part.mp4`);
    await run(socialCutArgs(video, cover, tmp, open === "footage" || open === "lower"));
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
