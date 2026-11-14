// The footage screen's memory (FOOTAGE_SCREEN_CACHE, default on). Every keyframe the local vision model screens is
// remembered by its source video and its time, so a Rockstar trailer is screened once and every later Short that cuts
// from it reuses the verdicts, even while the PC vision relay is down. A moment the final visual QA faulted for ad
// safety is written here too, so no later gather picks it again (14 Nov 2026: the same bent-over shot from a GTA VI
// trailer failed five Shorts, three renders each, because nothing remembered it).
//
// The file is plain JSON under DATA_DIR (screen_cache.json), keyed by the screen's prompt version, so a change to the
// criteria starts afresh instead of trusting verdicts made under the old ones. A PC batch (src/tools/prescreen.ts)
// writes the same file, which can be copied to the Mac as it is.

import fs from "node:fs";
import path from "node:path";
import type { FrameFlags } from "./localvision.ts";

/** Bumped whenever the screen's prompt or flags change: old verdicts are then ignored, never trusted. */
export const SCREEN_VERSION = "s2";

/** Keyframes are read every 1.5 s (src/assets/clipscore.ts CANDIDATE_STEP); keys round to a tenth of a second. */
const GRID = 1.5;

export interface CachedVerdict extends FrameFlags {
  /** When it was written (ISO). */
  at: string;
  /** "screen" for the local model's verdict, "qa" for a moment the final check faulted. */
  by: "screen" | "qa";
  /** The final check's words, for a moment it faulted. */
  why?: string;
}

export function cacheEnabled(): boolean {
  return process.env.FOOTAGE_SCREEN_CACHE !== "off";
}

export function cacheFile(): string {
  return (
    process.env.SCREEN_CACHE_FILE ||
    path.join(
      path.resolve(process.env.DATA_DIR || "./data"),
      "screen_cache.json",
    )
  );
}

/** The source's stable name (pure): a YouTube video id when the URL has one, else the URL; a section keeps its id. */
export function sourceKey(
  url: string | undefined,
  sectionId?: string,
): string | undefined {
  if (!url) return undefined;
  const id =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/)?.[1];
  const base = id ? `yt:${id}` : url.trim();
  return sectionId ? `${base}#${sectionId}` : base;
}

/** One keyframe's key (pure). */
export function frameKey(source: string, seconds: number): string {
  return `${SCREEN_VERSION}|${source}|${(Math.round(seconds * 10) / 10).toFixed(1)}`;
}

let memo:
  | { file: string; mtime: number; data: Record<string, CachedVerdict> }
  | undefined;

function load(): Record<string, CachedVerdict> {
  const file = cacheFile();
  try {
    const st = fs.statSync(file);
    if (memo && memo.file === file && memo.mtime === st.mtimeMs)
      return memo.data;
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      CachedVerdict
    >;
    memo = { file, mtime: st.mtimeMs, data };
    return data;
  } catch {
    memo = { file, mtime: -1, data: {} };
    return memo.data;
  }
}

/** The cached verdicts for these keys (undefined where none). */
export function cachedVerdicts(
  keys: Array<string | undefined>,
): Array<CachedVerdict | undefined> {
  if (!cacheEnabled()) return keys.map(() => undefined);
  const data = load();
  return keys.map((k) => (k ? data[k] : undefined));
}

/**
 * Writes verdicts. A "qa" verdict (the final check faulted the moment) is never overwritten by a later "screen" one:
 * the stricter judge wins.
 */
export function storeVerdicts(
  entries: Array<{
    key: string;
    flags: FrameFlags;
    by?: "screen" | "qa";
    why?: string;
  }>,
): void {
  if (!cacheEnabled() || !entries.length) return;
  const data = { ...load() };
  const at = new Date().toISOString();
  let changed = false;
  for (const e of entries) {
    const by = e.by ?? "screen";
    if (data[e.key]?.by === "qa" && by === "screen") continue;
    data[e.key] = {
      ...e.flags,
      at,
      by,
      ...(e.why ? { why: e.why.slice(0, 200) } : {}),
    };
    changed = true;
  }
  if (!changed) return;
  const file = cacheFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
    memo = { file, mtime: fs.statSync(file).mtimeMs, data };
  } catch {
    // A cache that cannot be written only costs a second screening.
  }
}

/** The keyframe times (on the 1.5 s grid) a clip of `seconds` from `start` covers (pure). */
export function gridTimes(start: number, seconds: number): number[] {
  const out: number[] = [];
  const from = Math.max(0, Math.floor((start - GRID / 2) / GRID));
  for (let k = from; k * GRID <= start + seconds; k++)
    out.push(Math.round(k * GRID * 10) / 10);
  return out;
}

export const UNSAFE_FLAGS: FrameFlags = {
  hud: false,
  text: false,
  webcam: false,
  gore: false,
  letterbox: false,
  dark: false,
  blurry: false,
  suggestive: true,
};

/**
 * The final QA faulted a clip for ad safety: every keyframe it covers is remembered as unsafe, so the retry's
 * re-gather and every later Short skip that stretch of the source. Returns how many keys were written.
 */
export function banMoment(o: {
  sourceUrl?: string;
  sectionId?: string;
  start?: number;
  seconds?: number;
  why: string;
}): number {
  const src = sourceKey(o.sourceUrl, o.sectionId);
  if (!src || o.start === undefined || !(o.seconds && o.seconds > 0)) return 0;
  const entries = gridTimes(o.start, o.seconds).map((t) => ({
    key: frameKey(src, t),
    flags: UNSAFE_FLAGS,
    by: "qa" as const,
    why: o.why,
  }));
  storeVerdicts(entries);
  return entries.length;
}
