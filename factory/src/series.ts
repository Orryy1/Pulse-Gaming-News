// The series (format redesign plan, 11 Nov 2026, C:\Claude\reports\pulse-format-redesign-plan.md, sections 4 to 7).
// From Sun 22 Nov the daily mix moves from one-off news to three named series, with one news Short a day kept as the
// control. Every Short carries a series tag on its script (`series`) so the weekly analytics loop can sum
// subscribers per 1,000 views by series, keep the control and GTA news apart, and leave series Shorts out of the
// 25 Nov "fit Shorts" test. The tag is the one field the three series branches share:
//   "why"          The Why (the Why lane, made serial on claude/series-runs)
//   "gta_file"     The GTA File (claude/series-runs)
//   "verdict"      Buy, Wait or Skip (claude/series-look)
//   "news_control" the scheduled news Short, unchanged format: the control arm
// A writer or selector that knows its Short's series sets `series` on the script, or on the story (story_json) before
// writing; seriesTagFor keeps that value and only fills in "why" and "news_control" for Shorts nobody tagged, so older
// Shorts are read the same way. Breaking, ranking, deals, gameplay and rumour Shorts carry no tag.
//
// The mix changes of plan item 2 live here too, each behind its own setting and all off by default: RUMOUR_SHARE,
// SHORT_MIN_SECONDS, NEWS_LATE_SLOT_ENABLED and BREAKING_HOME_ONLY with HOME_SHELF.

export const SERIES_TAGS = [
  "why",
  "gta_file",
  "verdict",
  "news_control",
] as const;
export type SeriesTag = (typeof SERIES_TAGS)[number];

export const SERIES_NAMES: Record<SeriesTag, string> = {
  why: "The Why",
  gta_file: "The GTA File",
  verdict: "Buy, Wait or Skip",
  news_control: "Control: news",
};

/** The day the series switch on: Shorts live from then are series Shorts in the readings and the fit test. */
export const SERIES_START = "2026-11-22";

export function isSeriesTag(x: unknown): x is SeriesTag {
  return (
    typeof x === "string" && (SERIES_TAGS as readonly string[]).includes(x)
  );
}

/** The three named series (everything but the control). */
export function isSerial(tag: SeriesTag | undefined): boolean {
  return tag === "why" || tag === "gta_file" || tag === "verdict";
}

/**
 * The series a Short belongs to: the script's own tag, else the story's, else what its lane says. A Why Short is The
 * Why; a scheduled news Short that is not a rumour is the control. Everything else has none.
 */
export function seriesTagFor(
  ep: {
    lane: string;
    story_json?: { why?: unknown; series?: unknown; run?: unknown; gtaFile?: unknown } | null;
  },
  script?: { series?: unknown; is_rumour?: boolean } | null,
): SeriesTag | undefined {
  if (isSeriesTag(script?.series)) return script.series;
  if (isSeriesTag(ep.story_json?.series)) return ep.story_json.series;
  if (ep.lane !== "news" && ep.lane !== "news_breaking") return undefined;
  // A GTA File part is written by the Why writer, so it carries a why brief too: its own tag comes first.
  if (ep.story_json?.gtaFile) return "gta_file";
  if (ep.story_json?.why) return "why";
  if (ep.lane === "news" && !script?.is_rumour && !ep.story_json?.run)
    return "news_control";
  return undefined;
}

const GTA = /\b(gta|grand theft auto)\b/i;
/** A Short about GTA: the control's GTA news is read apart, so the launch does not flatter The GTA File. */
export const isGta = (text: string): boolean => GTA.test(text);

/** The groups the weekly reading shows: the series, the control split into GTA news and the rest, and the others. */
export type SeriesGroup = SeriesTag | "gta_news" | "other";
export const GROUP_ORDER: SeriesGroup[] = [
  "why",
  "gta_file",
  "verdict",
  "news_control",
  "gta_news",
  "other",
];
export const GROUP_NAMES: Record<SeriesGroup, string> = {
  ...SERIES_NAMES,
  news_control: "Control: news, not GTA",
  gta_news: "Control: GTA news",
  other: "Everything else",
};

export function seriesGroup(
  tag: SeriesTag | undefined,
  game: string,
  title = "",
): SeriesGroup {
  if (!tag) return "other";
  if (tag === "news_control" && (isGta(game) || isGta(title)))
    return "gta_news";
  return tag;
}

// ------------------------------------------------------------------ the mix (plan item 2)

/** HOME_SHELF: "GTA|Grand Theft Auto|Resident Evil". Empty entries are dropped. */
export function parseHomeShelf(raw: string): string[] {
  return raw
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The story names a home-shelf franchise, as a whole word or phrase. */
export function onHomeShelf(text: string, shelf: string[]): boolean {
  return shelf.some((f) =>
    new RegExp(`(?:^|[^a-z0-9])${escape(f.toLowerCase())}(?:$|[^a-z0-9])`).test(
      text.toLowerCase(),
    ),
  );
}

/**
 * BREAKING_HOME_ONLY: with it on, the breaking lane takes a story only when it is about a home-shelf game or the story
 * desk rates it major (src/discovery/storysize.ts, at BIG_STORY_SIZE or more). Off, every story may break as before.
 */
export function breakingAllowed(
  cfg: { breakingHomeOnly: boolean; homeShelf: string[] },
  text: string,
  major: boolean,
): boolean {
  if (!cfg.breakingHomeOnly) return true;
  return major || onHomeShelf(text, cfg.homeShelf);
}

/** A slot at 21:00 or later is the late news slot (22:00 today). */
export const isLateSlot = (hhmm: string): boolean =>
  Number(hhmm.slice(0, 2)) >= 21;

/** NEWS_LATE_SLOT_ENABLED=false drops the late news slot; true keeps NEWS_SLOTS as written. */
export function newsSlotsFor(slots: string[], lateEnabled: boolean): string[] {
  return lateEnabled ? slots : slots.filter((s) => !isLateSlot(s));
}

/** RUMOUR_SHARE as written: 0 to 1, and anything unreadable keeps the allowance as it is (1). */
export function rumourShareFrom(raw: string): number {
  const n = raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/** RUMOUR_SHARE scales the day's rumour allowance: 1 keeps it, 0 stops rumour Shorts. */
export function rumourCapFor(perDay: number, share: number): number {
  const s = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 1;
  return Math.max(0, Math.round(perDay * s));
}

/** The narrator's spoken pace (src/assets/footagefirst.ts WORDS_PER_SECOND). */
export const SPOKEN_WORDS_PER_SECOND = 2.6;

/** The fewest spoken words that reach SHORT_MIN_SECONDS at the narrator's own pace; 0 when the floor is off. */
export function shortMinWords(minSeconds: number): number {
  return minSeconds > 0 ? Math.ceil(minSeconds * SPOKEN_WORDS_PER_SECOND) : 0;
}

/** The writer's note for the floor. */
export function shortFloorRule(minSeconds: number): string {
  if (minSeconds <= 0) return "";
  return `Length floor: this Short must run at least ${minSeconds} seconds, so at least ${shortMinWords(minSeconds)} spoken words across hook, beats, take and loop line. Reach it with real substance from the sources (a consequence for the viewer, a comparison, the history), never padding.`;
}

/** A draft under the floor goes back to the writer like any other house-rule miss. */
export function shortFloorProblems(
  spokenWords: number,
  minSeconds: number,
): string[] {
  const min = shortMinWords(minSeconds);
  if (!min || spokenWords >= min) return [];
  return [
    `The script is ${spokenWords} spoken words, under the ${min} a ${minSeconds}-second Short needs (SHORT_MIN_SECONDS). Add substance from the sources, not padding.`,
  ];
}

/**
 * The playback factor (pure) that brings a sped-up Short back up to the floor: below 1 slows it, 1 leaves it. Never
 * slower than the take was voiced (1 / SHORT_SPEED), and nothing when there is no floor or no speed-up to undo. The
 * floor keeps half a second spare for rounding in the render.
 */
export function floorBackFactor(seconds: number, minSeconds: number, speed: number): number {
  if (minSeconds <= 0 || speed <= 1 || !Number.isFinite(seconds) || seconds <= 0) return 1;
  const want = minSeconds + 0.5;
  if (seconds >= want) return 1;
  return Math.max(1 / speed, seconds / want);
}

/** The lanes the floor holds to: the news writer's Shorts (news, breaking, Why and the free lane). */
export const FLOOR_LANES = ["news", "news_breaking", "free"];
