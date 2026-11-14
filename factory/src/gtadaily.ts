// "GTA 6 Day N" (owner, 14 Nov 2026): a numbered daily series for GTA VI's launch weeks, made from the owner's own
// TinoTV streams. Each day one gameplay Short is "GTA 6 Day N: <what was tested>", answering what people asked that
// day (src/streamasks), and every episode joins one playlist and links to the next, so a viewer can binge the run.
//
// How it fits what is already there, so nothing is duplicated and no volume is added:
//   - the Short is a gameplay-lane Short (src/gameplay.ts): the same inbox, reviewer, cut and owner's tap in Discord.
//     GTA_DAILY only numbers it and pins it to the daily slot (GTA_DAILY_SLOT), which must be one of GAMEPLAY_SLOTS,
//     so the slot was already going to carry a gameplay Short. Other gameplay Shorts move to the next free slot.
//   - Day N counts calendar days from GTA_DAILY_START (Day 1 = launch day, 19 Nov 2026). A skipped day is simply
//     never published, and the next episode keeps its own date's number. The day an episode was given is claimed in
//     the settings table ("gta_daily:day:N" -> episode id) and kept on the story (story_json.gtaDaily), so a restart
//     never renumbers anything and two clips can never both be Day N.
//   - the next link reuses the next-part machinery (src/nextpart.ts nextPartFor and dayPhrase): the pinned comment
//     names Day N+1 and its day only when Day N+1 is already made and claimed (no plan, no promise). The description
//     carries "Previous:" from upload, and "Next:" is written into the previous day's description once Day N is
//     public (one videos.update, src/youtube/upload.ts rewriteDescriptions).
//   - the playlist is filed by addToSeries (src/pipeline.ts seriesFor), the same way The GTA File's is.
//   - no story spoilers: for SPOILER_WINDOW_DAYS after launch (4 weeks) a clip is numbered only when the reviewer saw
//     no story, the spoiler guard's phrases and late names (src/sceneindex/spoilers.ts) find nothing, and none of the
//     daily's own plot words appear. Day N is about systems, the map, tests, secrets and myths. A clip that fails stays
//     an ordinary gameplay Short (and the gameplay lane's own spoiler hold still applies to it).
// Off until GTA_DAILY=true.

import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { addDays, dayKey, localTime } from "./lanes.ts";
import { nextPartFor, type NextPart, type PartEntry } from "./nextpart.ts";
import { GTA_FILE_ALIASES, GTA_FILE_GAME, aboutFranchise } from "./gtafile.ts";
import {
  spoilerHits,
  spoilerNotes,
  spoilerWindow,
  type SpoilerWindow,
} from "./sceneindex/spoilers.ts";
import { TITLE_MAX, titleProblems } from "./editorial/seo.ts";

/** How every title starts: "GTA 6 Day 3: ...". The name fans search ("GTA 6"), not the roman numeral. */
export const GTA_DAILY_PREFIX = "GTA 6 Day";
/** The playlist every episode joins. */
export const GTA_DAILY_PLAYLIST = "GTA 6 Day by Day";
export const GTA_DAILY_GAME = GTA_FILE_GAME;
/** How far ahead a backlog of good clips may be given days: today and the next two. */
export const GTA_DAILY_AHEAD_DAYS = 2;
/** The settings key that holds which episode is Day N. */
export const dayKeyFor = (day: number) => `gta_daily:day:${day}`;

type GtaDailyConfig = Pick<
  Config,
  | "gtaDaily"
  | "gtaDailyStart"
  | "gtaDailySlot"
  | "gtaDailyDays"
  | "gameplayEnabled"
  | "gameplaySlots"
  | "timezone"
  | "spoilerWindowDays"
>;

export interface GtaDaily {
  /** Day 1, local YYYY-MM-DD. */
  start: string;
  /** "HH:MM" local: one of GAMEPLAY_SLOTS. */
  slot: string;
  /** The last day number the series runs to. */
  days: number;
  timeZone: string;
  /** Days after launch the no-story rule holds (SPOILER_WINDOW_DAYS, 28 by default). */
  spoilerDays: number;
}

/** Why the daily cannot run although it was switched on; undefined when it runs or is off. */
export function gtaDailyProblem(cfg: GtaDailyConfig): string | undefined {
  if (!cfg.gtaDaily) return undefined;
  const slot = cfg.gtaDailySlot.trim();
  if (!/^\d\d:\d\d$/.test(slot)) return `GTA_DAILY_SLOT "${slot}" is not HH:MM`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.gtaDailyStart.trim()))
    return `GTA_DAILY_START "${cfg.gtaDailyStart}" is not YYYY-MM-DD`;
  if (!cfg.gameplayEnabled)
    return "GAMEPLAY_ENABLED is off, and the daily is made from the gameplay lane";
  if (!cfg.gameplaySlots.includes(slot))
    return `GTA_DAILY_SLOT ${slot} is not one of GAMEPLAY_SLOTS (${cfg.gameplaySlots.join(",")}), and the daily never adds a slot`;
  if (!(cfg.gtaDailyDays > 0)) return "GTA_DAILY_DAYS must be 1 or more";
  return undefined;
}

/** The daily when it is on and sound; otherwise undefined (off). */
export function gtaDailyFrom(cfg: GtaDailyConfig): GtaDaily | undefined {
  if (!cfg.gtaDaily || gtaDailyProblem(cfg)) return undefined;
  return {
    start: cfg.gtaDailyStart.trim(),
    slot: cfg.gtaDailySlot.trim(),
    days: cfg.gtaDailyDays,
    timeZone: cfg.timezone,
    spoilerDays: cfg.spoilerWindowDays > 0 ? cfg.spoilerWindowDays : 28,
  };
}

/** One line for the start-up summary. */
export function gtaDailySummary(cfg: GtaDailyConfig): string {
  const d = gtaDailyFrom(cfg);
  if (d)
    return `"${GTA_DAILY_PREFIX} N" at ${d.slot} from ${d.start} for ${d.days} days, playlist "${GTA_DAILY_PLAYLIST}"`;
  const why = gtaDailyProblem(cfg);
  return why ? `off: ${why}` : "off";
}

// ------------------------------------------------------------------ numbering

const dayIndex = (key: string) => Date.parse(`${key}T12:00:00Z`) / 86_400_000;

/** Day N of a local date (pure): launch day is Day 1, the day before is Day 0. Counts calendar days, so a skipped day still counts. */
export function dayNumber(start: string, date: string): number {
  return Math.round(dayIndex(date) - dayIndex(start)) + 1;
}

/** The local date of Day N. */
export function dateOfDay(start: string, day: number): string {
  return addDays(start, day - 1);
}

/** The instant Day N goes out: its date at the daily slot. */
export function slotOfDay(daily: GtaDaily, day: number): Date {
  return localTime(dateOfDay(daily.start, day), daily.slot, daily.timeZone);
}

/** The day number of an instant, when it falls inside the run (1 to days). */
export function dayOf(daily: GtaDaily, at: Date): number | undefined {
  const n = dayNumber(daily.start, dayKey(at, daily.timeZone));
  return n >= 1 && n <= daily.days ? n : undefined;
}

/**
 * The day a new episode takes (pure): the first daily slot, from today up to GTA_DAILY_AHEAD_DAYS ahead, that is inside
 * the run, at least 20 minutes away, not already claimed and a full upload gap from every other scheduled video.
 * Undefined when none is free: the clip then stays an ordinary gameplay Short.
 */
export function targetDay(
  daily: GtaDaily,
  now: Date,
  claimed: ReadonlySet<number>,
  scheduled: Date[],
  gapMinutes: number,
): { day: number; at: Date } | undefined {
  const today = dayNumber(daily.start, dayKey(now, daily.timeZone));
  const gap = gapMinutes * 60_000;
  for (
    let day = Math.max(1, today);
    day <= Math.min(daily.days, today + GTA_DAILY_AHEAD_DAYS);
    day++
  ) {
    if (claimed.has(day)) continue;
    const at = slotOfDay(daily, day);
    if (at.getTime() - now.getTime() < 20 * 60_000) continue;
    if (scheduled.some((t) => Math.abs(t.getTime() - at.getTime()) < gap))
      continue;
    return { day, at };
  }
  return undefined;
}

// ------------------------------------------------------------------ the next link (src/nextpart.ts)

/** The run as next-part entries (series "gta_daily", part N, dated), for nextPartFor. Only the given days. */
export function dailyParts(
  daily: GtaDaily,
  days: Iterable<number>,
): PartEntry[] {
  return [...new Set(days)]
    .filter((d) => d >= 1 && d <= daily.days)
    .sort((a, b) => a - b)
    .map((d) => ({
      kind: "daily",
      series: "gta_daily",
      part: d,
      date: dateOfDay(daily.start, d),
      slot: daily.slot,
      title: `${GTA_DAILY_PREFIX} ${d}`,
    }));
}

/**
 * The episode after Day N, said the way the next-part line says it ("tomorrow", "on Saturday"), but only when that
 * day is already made and claimed: a broken promise is worse than none. Undefined otherwise.
 */
export function nextDay(
  daily: GtaDaily,
  day: number,
  claimed: Iterable<number>,
): NextPart | undefined {
  const later = [...claimed].filter((d) => d > day);
  if (!later.length) return undefined;
  return nextPartFor(
    dailyParts(daily, [day, Math.min(...later)]),
    slotOfDay(daily, day),
    daily.timeZone,
  );
}

// ------------------------------------------------------------------ the spoiler gate

/** GTA VI by any of its names ("GTA 6", "GTA VI", "Grand Theft Auto VI"), never GTA V. */
export const isGtaVi = (text: string): boolean =>
  aboutFranchise({ aliases: GTA_FILE_ALIASES }, text);

/** The daily's own window: launch to SPOILER_WINDOW_DAYS later, whatever SPOILER_GUARD says. */
export function dailyWindow(daily: GtaDaily): SpoilerWindow {
  return spoilerWindow(GTA_DAILY_GAME, daily.start, {
    days: daily.spoilerDays,
    openingShare: 0.1,
  })!;
}

/**
 * Plot words a daily never carries during the window, on top of the spoiler guard's phrases. A daily is systems, the
 * map, tests, secrets and myths: anything about the story waits.
 */
export const DAILY_PLOT_WORDS =
  /\b(story|stories|plot|cutscenes?|missions?|endings?|campaign|chapter|characters? (?:arc|fate)|boss fight|finale|twist)\b/i;

/**
 * What stops a clip becoming Day N (pure): empty when it may. `live` are the spoiler guard's registered windows (they
 * carry the scene index's late names); the daily's own window is always added, so the rule holds even with
 * SPOILER_GUARD off.
 */
export function dailySpoilerProblems(
  daily: GtaDaily,
  texts: Array<string | undefined>,
  now: Date,
  o: {
    reviewerSawStory?: boolean;
    spoilerHeld?: boolean;
    live?: readonly SpoilerWindow[];
  } = {},
): string[] {
  const own = dailyWindow(daily);
  const t = now.getTime();
  if (t < Date.parse(own.from) || t >= Date.parse(own.until)) return [];
  const out: string[] = [];
  if (o.reviewerSawStory)
    out.push("The reviewer saw a story moment in the clip.");
  if (o.spoilerHeld) out.push("The clip is held by the spoiler guard.");
  const text = texts.filter(Boolean).join("\n");
  const windows = [
    own,
    ...(o.live ?? []).filter((w) => w.aliases.some((a) => isGtaVi(a))),
  ];
  out.push(...spoilerNotes(spoilerHits(text, windows, now, [GTA_DAILY_GAME])));
  const plot = text.match(DAILY_PLOT_WORDS);
  if (plot)
    out.push(
      `"${plot[0]}" is about the story; a GTA 6 Day episode is systems, the map, tests, secrets or myths during the first ${daily.spoilerDays} days.`,
    );
  return [...new Set(out)];
}

/** What the day is about, for the description and the readings. */
export type DailyTheme = "test" | "myth" | "secret" | "map" | "systems";
const THEMES: Array<[DailyTheme, RegExp]> = [
  [
    "myth",
    /\b(myth|true or not|really|fake|debunk|rumou?r|previews? said|claim)/i,
  ],
  ["secret", /\b(secret|hidden|easter egg|rare|unlock|find)/i],
  [
    "map",
    /\b(map|size|edge|island|city|vice city|leonida|interiors?|buildings?|explore|fly|swim)/i,
  ],
  ["test", /\b(can you|test|tested|try|tried|how (?:long|far|many|fast))\b/i],
];
export function dailyTheme(text: string): DailyTheme {
  return THEMES.find(([, re]) => re.test(text))?.[0] ?? "systems";
}

// ------------------------------------------------------------------ titles

const DASHES = /\s*[\u2013\u2014]\s*/g;
const ADVERTISER =
  /\b(death|dead|kill(?:s|ed|ing)?|war|attack|crisis|horror|scary|murder|gore)\b/i;
const LEAD =
  /^\s*(?:the\s+)?(?:gta\s*(?:vi|6)|grand theft auto\s*(?:vi|6))\b\s*(?:day\s*\d+)?\s*[:,.\-|]?\s*/i;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A claim with any game or day lead taken off, dashes made colons and shouting brought down (pure). */
function cleanClaim(claim: string): string {
  let c = claim.replace(DASHES, ": ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && LEAD.test(c); i++) c = c.replace(LEAD, "").trim();
  if (c === c.toUpperCase() && /[A-Z]{3,}/.test(c))
    c = c
      .toLowerCase()
      .replace(/\bgta( (?:vi|v|iv)\b)?/g, (m) => m.toUpperCase())
      .replace(/\bi\b/g, "I");
  return cap(c.replace(/^[:,.\-\s]+/, ""));
}

/**
 * The title (pure): "GTA 6 Day N: <claim>", within the channel's TITLE_MAX. Each claim is tried in turn (the
 * reviewer's title, then its shorter question) and the first that fits whole wins: a question is never cut off half
 * way, which reads as nonsense (the dry run's "Is the Map Really About Twice the Size of GTA"). When none fits, a day
 * that answered a stream ask says "I tested what you asked". Dashes become a colon (no em dashes on the channel).
 */
export function dailyTitle(
  day: number,
  claims: string | Array<string | undefined>,
  o: { ask?: boolean } = {},
): string {
  const lead = `${GTA_DAILY_PREFIX} ${day}: `;
  const room = TITLE_MAX - lead.length;
  const list = (Array.isArray(claims) ? claims : [claims])
    .map((c) => cleanClaim(c ?? ""))
    .filter(Boolean);
  const fits = list.find((c) => c.length <= room);
  return lead + (fits ?? (o.ask ? "I tested what you asked" : "I tested it"));
}

/** House rules for a daily title, on top of the channel's own (src/editorial/seo.ts titleProblems). */
export function dailyTitleProblems(title: string, day: number): string[] {
  const out = [...titleProblems(title)];
  if (!title.startsWith(`${GTA_DAILY_PREFIX} ${day}: `))
    out.push(`The title must open "${GTA_DAILY_PREFIX} ${day}: ".`);
  if (/[\u2013\u2014]/.test(title))
    out.push("No em or en dashes in the title.");
  const bad = title.match(ADVERTISER);
  if (bad)
    out.push(`"${bad[0]}" is not advertiser-friendly; say it another way.`);
  if (DAILY_PLOT_WORDS.test(title))
    out.push("The title talks about the story.");
  return out;
}

// ------------------------------------------------------------------ playlist, description, comment

/** The playlist every episode joins (filed by addToSeries). */
export function dailySeries(): { title: string; description: string } {
  return {
    title: GTA_DAILY_PLAYLIST,
    description:
      "GTA 6 from launch day, one day at a time: what you asked us to test, tried on our own copy. Systems, the map, secrets and myths. No story spoilers. In order, from Pulse Gaming.",
  };
}

export const playlistUrl = (id: string) =>
  `https://www.youtube.com/playlist?list=${id}`;
export const videoUrl = (id: string) => `https://youtu.be/${id}`;

/** What the daily keeps on the story (story_json.gtaDaily). */
export interface GtaDailyStory {
  day: number;
  /** Local YYYY-MM-DD and "HH:MM" of the day's slot. */
  date: string;
  slot: string;
  theme: DailyTheme;
  /** The stream ask the episode answers, when it answers one. */
  ask?: string;
  /** The day before that went out, filled just before upload. */
  previous?: { day: number; videoId: string; title: string };
  /** The playlist's id once it exists, filled just before upload. */
  playlistId?: string;
}

/** The description's daily lines (pure): where the run started and where to watch it in order. */
export function dailyDescriptionLines(story: GtaDailyStory): string[] {
  const out: string[] = [];
  if (story.previous)
    out.push(
      `Previous: ${GTA_DAILY_PREFIX} ${story.previous.day} ${videoUrl(story.previous.videoId)}`,
    );
  if (story.playlistId)
    out.push(`Every day so far, in order: ${playlistUrl(story.playlistId)}`);
  else
    out.push(
      `Every day so far is in the "${GTA_DAILY_PLAYLIST}" playlist on our channel.`,
    );
  return out;
}

const NEXT_LINE = new RegExp(`^Next: ${GTA_DAILY_PREFIX} \\d+ \\S+$`);

/**
 * A live description with its "Next:" line (pure and idempotent): an old next line is replaced, otherwise it goes in
 * right after the first line (the keyword lead), where a viewer sees it before "more".
 */
export function withNextLink(
  description: string,
  next: { day: number; videoId: string },
): string {
  const line = `Next: ${GTA_DAILY_PREFIX} ${next.day} ${videoUrl(next.videoId)}`;
  const lines = description.split("\n");
  const at = lines.findIndex((l) => NEXT_LINE.test(l.trim()));
  if (at >= 0) {
    lines[at] = line;
    return lines.join("\n");
  }
  if (!description.trim()) return line;
  lines.splice(1, 0, line);
  return lines.join("\n");
}

/**
 * The daily's line for the channel's first comment (pure). Comment links do not click on Shorts, so it names the day
 * and the playlist plainly. Never a subscribe or follow ask.
 */
export function dailyCommentLine(
  day: number,
  next: NextPart | undefined,
  playlistId?: string,
): string {
  const where = playlistId
    ? `Every day so far, in order: ${playlistUrl(playlistId)}`
    : `Every day so far is in the "${GTA_DAILY_PLAYLIST}" playlist.`;
  return next
    ? `${GTA_DAILY_PREFIX} ${next.part} lands ${next.day}. ${where}`
    : `That was ${GTA_DAILY_PREFIX} ${day}. ${where}`;
}

/** With GTA_DAILY on, the inbox's stream-ask answers go first (pure, stable): a day should answer what people asked. */
export function askFirst<
  T extends { meta: { stream_ask?: unknown; live?: { ask?: string } } },
>(clips: T[]): T[] {
  const ask = (c: T) => (c.meta.stream_ask || c.meta.live?.ask ? 1 : 0);
  return clips
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ask(b.c) - ask(a.c) || a.i - b.i)
    .map((x) => x.c);
}

// ------------------------------------------------------------------ the database (settings and episodes)

/**
 * Claims Day N for an episode: true when it is now (or already was) this episode's. The settings table's primary key
 * makes the claim atomic, so two clips reviewed at once can never both be Day N.
 */
export async function claimDay(
  db: Db,
  day: number,
  episode: string,
): Promise<boolean> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [dayKeyFor(day), episode],
  );
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [dayKeyFor(day)],
  );
  return row?.value === episode;
}

/** Frees an episode's day (rejected, expired or failed), so another clip can still be that day. */
export async function releaseDay(db: Db, episode: string): Promise<number> {
  const rows = await db.query<{ key: string }>(
    `DELETE FROM settings WHERE key LIKE 'gta_daily:day:%' AND value = $1 RETURNING key`,
    [episode],
  );
  return rows.length;
}

/** Every claimed day and its episode. */
export async function claimedDays(db: Db): Promise<Map<number, string>> {
  const rows = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key LIKE 'gta_daily:day:%'`,
  );
  return new Map(
    rows.map((r) => [Number(r.key.slice("gta_daily:day:".length)), r.value]),
  );
}

/** The latest day before Day N that is published and public by `now`: the one Day N links back to, and forward from. */
export async function previousDay(
  db: Db,
  day: number,
  now: Date,
): Promise<
  { episode: string; day: number; videoId: string; title: string } | undefined
> {
  const [row] = await db.query<{
    id: string;
    day: string | number;
    video_id: string;
    title: string | null;
  }>(
    `SELECT id, (story_json->'gtaDaily'->>'day')::int AS day, youtube_video_id AS video_id,
            script_json->'youtube'->>'title' AS title
       FROM episodes
      WHERE status = 'published' AND youtube_video_id IS NOT NULL
        AND story_json->'gtaDaily' IS NOT NULL
        AND (story_json->'gtaDaily'->>'day')::int < $1
        AND (publish_at IS NULL OR publish_at <= $2::timestamptz)
      ORDER BY (story_json->'gtaDaily'->>'day')::int DESC
      LIMIT 1`,
    [day, now],
  );
  if (!row) return undefined;
  return {
    episode: row.id,
    day: Number(row.day),
    videoId: row.video_id,
    title: row.title ?? "",
  };
}

/**
 * The days claimed by episodes still on their way or out. A claim whose episode was rejected, expired, failed or is
 * gone is released first, so another clip can still be that day while it lies ahead.
 */
export async function liveClaims(db: Db): Promise<number[]> {
  await db.query(
    `DELETE FROM settings s WHERE s.key LIKE 'gta_daily:day:%'
       AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.id = s.value AND e.status NOT IN ('rejected','failed'))`,
  );
  return [...(await claimedDays(db)).keys()].sort((a, b) => a - b);
}

/** A live description with its "Previous:" line (pure and idempotent): replaced when there, else put after line one. */
export function withPreviousLink(
  description: string,
  prev: { day: number; videoId: string },
): string {
  const line = `Previous: ${GTA_DAILY_PREFIX} ${prev.day} ${videoUrl(prev.videoId)}`;
  const lines = description.split("\n");
  const at = lines.findIndex((l) => PREVIOUS_LINE.test(l.trim()));
  if (at >= 0) lines[at] = line;
  else if (!description.trim()) return line;
  else lines.splice(1, 0, line);
  return lines.join("\n");
}
const PREVIOUS_LINE = new RegExp(`^Previous: ${GTA_DAILY_PREFIX} \\d+ \\S+$`);
