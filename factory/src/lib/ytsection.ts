// A YouTube section download that survives a refused stream (13 Nov 2026). yt-dlp --download-sections hands the
// signed stream link to ffmpeg, and YouTube sometimes answers that link with 403 Forbidden (the San Andreas proof
// lost 3 scene-index clips and 5 cutscene sections that way; the same section fetched a minute later was fine).
// On a 403 the download is tried again with formats fetched afresh (yt-dlp's cache set aside, so a new signed link),
// then with another format (720p, then any mp4); only then does the caller move to its next shot or upload.

import { runCapped } from "./child.ts";
import { errorMessage, log } from "./util.ts";

/** The refusal this retries: the stream link answered 403 (ffmpeg or yt-dlp's own words). */
const REFUSED = /\b403\b|forbidden/i;

/** True when a failed download was YouTube refusing the stream link. */
export function streamRefused(err: unknown): boolean {
  const e = err as { stderr?: unknown; message?: unknown } | undefined;
  return REFUSED.test(`${errorMessage(err)} ${String(e?.stderr ?? "")}`);
}

/** The pictures-only formats tried after the caller's own, in order (pure): 720p, then any mp4 stream. */
export const FALLBACK_FORMATS = [
  "bv*[height<=720][ext=mp4][vcodec^=avc1]/bv*[height<=720][ext=mp4]/b[height<=720][ext=mp4]",
  "bv*[ext=mp4]/b[ext=mp4]/bv*/b",
];
/** The same with sound, for a caller that fetches the section's sound too. */
export const FALLBACK_FORMATS_WITH_SOUND = [
  "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]",
  "b[ext=mp4]/bv*+ba/b",
];

/**
 * The argument lists tried for one section (pure): the caller's own; the same with formats fetched afresh (and any partial file overwritten); then
 * the same with each fallback format in place of its -f value. A list without -f gets the fresh try only.
 */
export function sectionAttempts(
  args: readonly string[],
  formats: readonly string[] = FALLBACK_FORMATS,
): string[][] {
  // A refused try may leave part of the file behind: it is overwritten, never taken as already downloaded.
  const fresh = ["--no-cache-dir", "--force-overwrites", ...args];
  const f = args.indexOf("-f");
  const out: string[][] = [[...args], fresh];
  if (f < 0 || f + 1 >= args.length) return out;
  const own = args[f + 1]!;
  const sound = own.includes("+ba") || own.includes("ba[");
  for (const alt of sound && formats === FALLBACK_FORMATS
    ? FALLBACK_FORMATS_WITH_SOUND
    : formats) {
    if (alt === own) continue;
    const next = [...fresh];
    next[f + 3] = alt; // fresh has two arguments in front
    out.push(next);
  }
  return out;
}

export interface SectionDeps {
  run?: (cmd: string, args: string[]) => Promise<unknown>;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Runs a yt-dlp section download, trying again on a 403 as sectionAttempts lists (with a short pause between),
 * and throws the last error when every try is refused. Any other failure throws at once.
 */
export async function downloadSectionRetrying(
  ytdlp: string,
  args: readonly string[],
  opts: {
    timeout?: number;
    maxBuffer?: number;
    formats?: readonly string[];
  } = {},
  deps: SectionDeps = {},
): Promise<void> {
  const run =
    deps.run ??
    ((cmd: string, a: string[]) =>
      runCapped(cmd, a, {
        timeout: opts.timeout ?? 300_000,
        maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
      }));
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = sectionAttempts(args, opts.formats);
  let last: unknown;
  for (const [i, a] of attempts.entries()) {
    try {
      await run(ytdlp, a);
      if (i > 0)
        log("info", "youtube section fetched after a refusal", {
          attempt: i + 1,
          format: a[a.indexOf("-f") + 1],
        });
      return;
    } catch (err) {
      last = err;
      if (!streamRefused(err)) throw err;
      if (i < attempts.length - 1) await wait(1500 * (i + 1));
    }
  }
  log("warn", "youtube section refused on every try", {
    tries: attempts.length,
  });
  throw last;
}
