// Shorts length lanes (upgrade queue item 11; niche research, 11 Nov 2026, changes 7 and 19). Of 100 top-five Shorts
// on 20 channels, 60 run under 30 seconds and none 52 to 60; Pulse's own 45 to 59 second Shorts broke out 3 times in
// 24 on YouTube and never in 22 on Instagram. The reading is two lanes, not one cap: news and "why" at about 22 to
// 35 seconds, and a small test lane of 60 to 75 seconds for strand pieces on the owner's own footage.
//
// SHORT_LENGTHS sets a target per format ("news=22-35,why=22-35,strand=60-75"); empty keeps the writer's old 25-40
// seconds and 70-100 words for every Short. The word budget follows from the seconds at the narrator's own pace, so
// the voice is never sped up or slowed down to fit. INSTAGRAM_MAX_SECONDS (0 = off) keeps a longer Short off
// Instagram: the cutdown code cuts entries out of long rankings and cannot make a shorter cut of a Short.

/** The formats with a length lane. */
export type LengthFormat = "news" | "why" | "strand";
export const LENGTH_FORMATS: LengthFormat[] = ["news", "why", "strand"];

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

/** SHORT_LENGTHS (pure): "news=22-35,why=22-35,strand=60-75". Unknown formats and bad bands are dropped. */
export function parseShortLengths(raw: string): ShortLengths {
  const out: ShortLengths = {};
  for (const part of raw.split(",")) {
    const m = part
      .trim()
      .toLowerCase()
      .match(/^([a-z]+)\s*=\s*(\d+)\s*-\s*(\d+)$/);
    if (!m) continue;
    const format = m[1] as LengthFormat;
    const min = Number(m[2]);
    const max = Number(m[3]);
    if (!LENGTH_FORMATS.includes(format)) continue;
    if (min < 10 || max > 180 || min >= max) continue;
    out[format] = { min, max };
  }
  return out;
}

/**
 * Which lane a Short is in: only the news lane's Shorts have one (news, why, strand). A strand Short is in the long
 * strand lane only when it opens on the owner's own footage; otherwise it is a news Short.
 */
export function lengthFormatOf(ep: {
  lane: string;
  story_json: { why?: unknown; strand?: { ownFootage: boolean } };
}): LengthFormat | undefined {
  if (ep.lane !== "news" && ep.lane !== "news_breaking") return undefined;
  if (ep.story_json.strand?.ownFootage) return "strand";
  if (ep.story_json.why) return "why";
  return "news";
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
 * Short with no band of its own follows the news band; the strand lane has to be set on its own, and without it a
 * strand Short follows the news band too.
 */
export function shortTarget(
  lengths: ShortLengths,
  format: LengthFormat | undefined,
): ShortTarget | undefined {
  if (!format) return undefined;
  const own = lengths[format];
  const band = own ?? lengths.news;
  if (!band) return undefined;
  const lane = own ? format : "news";
  return {
    format: lane,
    seconds: band,
    wordsMin: Math.round(band.min * SHORT_WORDS_PER_SECOND),
    wordsMax: Math.floor(band.max * SHORT_WORDS_PER_SECOND),
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
