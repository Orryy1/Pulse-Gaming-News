// Shorts length lanes (upgrade queue item 11; niche research, 11 Nov 2026, changes 7 and 19). Of 100 top-five Shorts
// on 20 channels, 60 run under 30 seconds and none 52 to 60; Pulse's own 45 to 59 second Shorts broke out 3 times in
// 24 on YouTube and never in 22 on Instagram. The reading is two lanes, not one cap: news and "why" at about 22 to
// 35 seconds, and a small test lane of 60 to 75 seconds for strand pieces on the owner's own footage.
//
// The format redesign plan (11 Nov 2026) reads Pulse's own numbers the other way for the serials: Shorts of 60 s and
// over converted best (2.22 subscribers per 1,000 views). So The Why as a serial gets its own band
// (WHY_TARGET_SECONDS, 45-60, only with WHY_SERIAL_ENABLED; withWhyTarget) and The GTA File, which replaced the strand
// (src/gtafile.ts), has the "gta_file" lane; the old "strand" key still reads as it.
//
// SHORT_LENGTHS sets a target per format ("news=22-35,why=22-35,gta_file=45-55"); empty keeps the writer's old 25-40
// seconds and 70-100 words for every Short. The word budget follows from the seconds at the narrator's own pace, so
// the voice is never sped up or slowed down to fit. INSTAGRAM_MAX_SECONDS (0 = off) keeps a longer Short off
// Instagram: the cutdown code cuts entries out of long rankings and cannot make a shorter cut of a Short.

/** The formats with a length lane. */
export type LengthFormat = "news" | "why" | "gta_file";
export const LENGTH_FORMATS: LengthFormat[] = ["news", "why", "gta_file"];

/** A target length in seconds. */
export interface LengthBand {
  min: number;
  max: number;
}

export type ShortLengths = Partial<Record<LengthFormat, LengthBand>>;

/**
 * The narrator's spoken pace, in words a second: the figure the footage planner already times lines by
 * (src/assets/footagefirst.ts WORDS_PER_SECOND), and the one the old 25-40 seconds and 70-100 words came from.
 */
export const SHORT_WORDS_PER_SECOND = 2.6;

/** The narration cap every Short had before the lanes: under a minute with the end card. */
export const SHORT_NARRATION_CAP_SECONDS = 58;

/** One band, "45-60" (WHY_TARGET_SECONDS); undefined when it is not a usable band. */
export function parseBand(raw: string): LengthBand | undefined {
  const m = raw.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return undefined;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (min < 10 || max > 180 || min >= max) return undefined;
  return { min, max };
}

/** SHORT_LENGTHS (pure): "news=22-35,why=22-35,gta_file=45-55" ("strand" is read as "gta_file"). Unknown formats and bad bands are dropped. */
export function parseShortLengths(raw: string): ShortLengths {
  const out: ShortLengths = {};
  for (const part of raw.split(",")) {
    const m = part
      .trim()
      .toLowerCase()
      .match(/^([a-z_]+)\s*=\s*(\d+)\s*-\s*(\d+)$/);
    if (!m) continue;
    const format = (m[1] === "strand" ? "gta_file" : m[1]) as LengthFormat;
    const min = Number(m[2]);
    const max = Number(m[3]);
    if (!LENGTH_FORMATS.includes(format)) continue;
    if (min < 10 || max > 180 || min >= max) continue;
    out[format] = { min, max };
  }
  return out;
}

/**
 * Which lane a Short is in: only the news lane's Shorts have one (news, why, and a GTA File part). A planned launch
 * run topic (launch_run.json, src/shortrun.ts: the GTA VI launch calendar's "why" entries) has none: it keeps the
 * length rules it was planned under, whatever SHORT_LENGTHS says. Long videos and every other lane have none either.
 */
export function lengthFormatOf(ep: {
  lane: string;
  story_json: { why?: unknown; run?: boolean; gtaFile?: unknown } | null | undefined;
}): LengthFormat | undefined {
  if (ep.lane !== "news" && ep.lane !== "news_breaking") return undefined;
  if (!ep.story_json) return undefined;
  if (ep.story_json.gtaFile) return "gta_file";
  if (ep.story_json.run) return undefined;
  if (ep.story_json.why) return "why";
  return "news";
}

/**
 * The lanes with The Why's serial band laid over them (WHY_TARGET_SECONDS, only when WHY_SERIAL_ENABLED): the Why
 * band, and the GTA File's too when SHORT_LENGTHS gives it none, since its parts are written by the Why writer.
 */
export function withWhyTarget(
  lengths: ShortLengths,
  serial: boolean,
  band: LengthBand | undefined,
): ShortLengths {
  if (!serial || !band) return lengths;
  return { ...lengths, why: band, gta_file: lengths.gta_file ?? band };
}

/** What the writer, the checks and the voice step hold a Short to. */
export interface ShortTarget {
  format: LengthFormat;
  seconds: LengthBand;
  wordsMin: number;
  wordsMax: number;
  /** Beats a script may have: two to four, up to six in a lane over 45 seconds. */
  beatsMax: number;
  /** The longest narration the voice step lets through. */
  capSeconds: number;
}

/**
 * The target for a format, or undefined when SHORT_LENGTHS leaves it unset (the old rules then stand). A "why"
 * Short with no band of its own follows the news band; a GTA File part follows the Why band, else the news band.
 */
export function shortTarget(
  lengths: ShortLengths,
  format: LengthFormat | undefined,
  /** SHORT_SPEED: every Short plays this much faster, so the same seconds hold this many more words (12 Nov 2026). */
  speed = 1,
): ShortTarget | undefined {
  if (!format) return undefined;
  const own = lengths[format];
  const viaWhy = format === "gta_file" && !own ? lengths.why : undefined;
  const band = own ?? viaWhy ?? lengths.news;
  if (!band) return undefined;
  const lane = own ? format : viaWhy ? "why" : "news";
  return {
    format: lane,
    seconds: band,
    wordsMin: Math.round(band.min * SHORT_WORDS_PER_SECOND * Math.max(1, speed)),
    wordsMax: Math.floor(band.max * SHORT_WORDS_PER_SECOND * Math.max(1, speed)),
    beatsMax: band.max > 45 ? 6 : 4,
    capSeconds: Math.max(SHORT_NARRATION_CAP_SECONDS, band.max + 5),
  };
}

/** True when INSTAGRAM_MAX_SECONDS is set and the Short runs over it: Instagram does not get it. */
export function overInstagramLength(
  maxSeconds: number,
  durationSeconds: number | undefined,
): boolean {
  return (
    maxSeconds > 0 &&
    durationSeconds !== undefined &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > maxSeconds
  );
}

/** One line for the start-up summary. */
export function shortLengthsSummary(
  lengths: ShortLengths,
  instagramMaxSeconds: number,
): string {
  const lanes = LENGTH_FORMATS.filter((f) => lengths[f])
    .map((f) => `${f} ${lengths[f]!.min}-${lengths[f]!.max}s`)
    .join(", ");
  return `${lanes || "off (25-40s)"}${instagramMaxSeconds > 0 ? `; Instagram up to ${instagramMaxSeconds}s` : ""}`;
}
