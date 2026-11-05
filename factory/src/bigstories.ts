// Big stories always get made (owner, 4 Nov 2026). God of War's delay scored the day's highest and the Ocarina remake
// was the talk of gaming, and neither became a Short: the delay had no first-party feed, so it never counted as
// breaking; the news slot it could have filled was already refused because a long video and a ranking had used up the
// day's count, and nothing said so. This file decides, in code, what the day's biggest stories are (src/discovery/
// storysize.ts), whether each one is covered or planned, and if not, exactly why not. A story at BIG_STORY_SIZE or
// above is never held by the cap, the breaking allowance or the day's count, and each one made takes the place of a
// filler slot (BIG_STORY_BUMPS). Every hold is a log line and an event; each evening one line goes to the alerts
// channel naming the biggest stories, made or missed. BIG_STORY_MODE: off, report (say what it would do) or make.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { RunEntry, RunWhy } from "./shortrun.ts";
import {
  centralHeadline,
  knownEntity,
  newDevelopment,
  outletOf,
  similarTitles,
  sizeStories,
  storyCluster,
  storyEvent,
  type SizedStory,
  type StoryEvent,
} from "./discovery/storysize.ts";
import {
  applyChatter,
  chatterTerms,
  readChatter,
  type ChatterSignal,
} from "./discovery/chatter.ts";
import type { TrendingVideo } from "./discovery/demand.ts";
import {
  applyLaunches,
  launchesWithoutStory,
  readLaunches,
} from "./discovery/launches.ts";
import { logEvent } from "./episodes.ts";
import { dayKey, inWindow, localTime } from "./lanes.ts";
import { log } from "./lib/util.ts";

export type BigMode = "off" | "report" | "make";

/** Past this the story has been around long enough that "just announced" would be wrong. */
const LATE_AFTER_HOURS = 3;
/** Episodes looked at when asking whether a story is already covered. */
const COVERED_HOURS = 72;
/** A second big Short on one game inside this needs BIG_STORY_HUGE. */
const SAME_GAME_HOURS = 24;
/** A story whose Short failed gets this many goes before it is reported as failed. */
export const BIG_ATTEMPTS = 2;
/** Even huge stories stop here: launch week can make everything about one game huge at once. */
const HUGE_EXTRA = 2;
const HUGE_SAME_GAME = 2;

export type BigCfg = Pick<
  Config,
  | "bigStoryMode"
  | "bigStorySize"
  | "bigStoryHuge"
  | "bigStoryMaxAgeHours"
  | "bigStoryPerDay"
  | "bigStoryBumps"
  | "breakingWindow"
  | "timezone"
>;

/** The part of an episode that says what it covered. */
export interface CoverEpisode {
  id: string;
  lane: string;
  status: string;
  story_hash: string;
  created_at: string;
  last_error?: string | null;
  story_json: Pick<
    StoryCluster,
    "headline" | "gameHint" | "why" | "bigStory"
  > & { items?: unknown[] };
}

export type BigAction = "make" | "made" | "planned" | "held";

export interface BigVerdict {
  story: SizedStory;
  action: BigAction;
  /** Why it is not being made now, or how it is covered: said in plain words, for the owner. */
  reason: string;
  episode?: string;
  /** Goes on the hash so a failed attempt can be tried again. */
  attempt: number;
  /** A new development on a story already covered: the editor judges it, and may always pass. */
  development?: string;
}

/** What an episode or a run entry is about: the known game and every kind of news its words carry. */
function aboutOf(texts: Array<string | undefined>): {
  entity?: string;
  events: Set<StoryEvent>;
} {
  const said = texts.filter((t): t is string => !!t);
  const entity = said.map((t) => knownEntity(t)?.key).find(Boolean);
  return { entity, events: new Set(said.map(storyEvent)) };
}

function coversStory(
  story: SizedStory,
  headline: string,
  texts: Array<string | undefined>,
): boolean {
  const about = aboutOf(texts);
  if (story.event === "other" || story.event === "update")
    return (
      similarTitles(story.headline, headline) ||
      (!!texts[2] && similarTitles(story.headline, texts[2]))
    );
  const said = texts.filter(Boolean).join(" ").toLowerCase();
  const sameGame = story.entity.startsWith("w:")
    ? said.includes(story.entity.slice(2))
    : about.entity === story.entity;
  // A launch-day story is what a Why on the game that day already says: reviews, times, what changed.
  if (story.key.includes("|launch:")) return sameGame;
  return sameGame && about.events.has(story.event);
}

function episodeTexts(e: CoverEpisode): Array<string | undefined> {
  const j = e.story_json;
  return [j.headline, j.gameHint, j.why?.question, j.why?.angle];
}

/**
 * An episode this much older than a story's oldest article is about something else: GTA's score album on 29 Oct is not
 * its pre-load on 3 Nov, and a rumour of a reveal is not the reveal.
 */
const COVER_GAP_HOURS = 48;

/** How the story is covered by an episode that was not dropped, if any; failed attempts are counted by the caller. */
export function coveringEpisode(
  story: SizedStory,
  episodes: CoverEpisode[],
): CoverEpisode | undefined {
  const dropped = new Set(["failed", "rejected"]);
  const earliest = story.coverFrom
    ? new Date(story.coverFrom).getTime()
    : new Date(story.firstAt).getTime() - COVER_GAP_HOURS * 3_600_000;
  return episodes.find(
    (e) =>
      !dropped.has(e.status) &&
      (story.hashes.includes(e.story_hash) ||
        (new Date(e.created_at).getTime() >= earliest &&
          (e.story_json.bigStory?.key === story.key ||
            coversStory(story, e.story_json.headline, episodeTexts(e))))),
  );
}

/** A planned Why this close holds a story back: it will say the same thing. */
const PLANNED_AHEAD_HOURS = 24;
const PLANNED_GRACE_MINUTES = 30;

/** A big Short already out on what a planned Why was going to say, in the last two days (pure): the plan gives way. */
export function runEntryCovered(
  entry: Pick<RunWhy, "title" | "game" | "question" | "angle" | "arc">,
  episodes: CoverEpisode[],
  now: Date,
): CoverEpisode | undefined {
  const about = aboutOf([entry.title, entry.game, entry.question, entry.angle, entry.arc]);
  return episodes.find((e) => {
    const big = e.story_json.bigStory;
    return (
      !!big &&
      e.status !== "failed" &&
      e.status !== "rejected" &&
      now.getTime() - new Date(e.created_at).getTime() < 48 * 3_600_000 &&
      big.entity === about.entity &&
      about.events.has(big.event as StoryEvent)
    );
  });
}

/** A Why Short planned for this story in the launch run within a day, not yet made. */
export function plannedEntry(
  story: SizedStory,
  run: RunEntry[],
  now: Date,
  timeZone: string,
): RunWhy | undefined {
  return run.find((e): e is RunWhy => {
    if (e.kind !== "why") return false;
    const at = localTime(e.date, e.slot, timeZone).getTime();
    // Just past its slot the Why may still be starting: it is not given up on until its grace has run out.
    if (
      at < now.getTime() - PLANNED_GRACE_MINUTES * 60_000 ||
      at > now.getTime() + PLANNED_AHEAD_HOURS * 3_600_000
    )
      return false;
    return coversStory(story, e.title, [
      e.title,
      e.game,
      e.question,
      e.angle,
      e.arc,
    ]);
  });
}

/** Everything the decision needs that is not the story (pure, so tests can state it). */
export interface BigContext {
  now: Date;
  episodes: CoverEpisode[];
  run: RunEntry[];
  rumoursToday: number;
  rumourCap: number;
  includeRumours: boolean;
  bigMadeToday: number;
  /** Set when selection cannot run at all right now: paused, or the factory is full. */
  blocked?: string;
}

/** The verdict on each big story, biggest first. At most one is "make": the rest wait their turn (pure). */
export function judgeBigStories(
  stories: SizedStory[],
  cfg: BigCfg,
  ctx: BigContext,
): BigVerdict[] {
  let bigMade = ctx.bigMadeToday;
  let makeTaken = false;
  const out: BigVerdict[] = [];
  for (let story of stories) {
    if (story.size < cfg.bigStorySize) continue;
    let development: string | undefined;
    const base = () => ({ story, attempt: 1, ...(development ? { development } : {}) });
    const cover = coveringEpisode(story, ctx.episodes);
    // Covered, unless the press has since moved to something the Short did not say.
    const fresh =
      cover && !story.hashes.includes(cover.story_hash)
        ? newDevelopment(
            story,
            // Not the bare game name: every headline about the game reads like that.
            [cover.story_json.headline, cover.story_json.why?.question, cover.story_json.why?.angle].filter((x): x is string => !!x),
            new Date(cover.created_at).getTime(),
          )
        : undefined;
    if (cover && fresh) {
      // Only the new articles go forward, under a hash of their own; the same rules then apply as to any big story.
      story = {
        ...story,
        items: fresh,
        headline: centralHeadline(fresh),
        outlets: [...new Set(fresh.map((i) => outletOf(i.source)))],
        articles: fresh.length,
        firstAt: fresh[fresh.length - 1]!.publishedAt,
        newestAt: fresh[0]!.publishedAt,
        hashes: [],
      };
      development = cover.id;
    } else if (cover) {
      out.push({
        ...base(),
        action: "made",
        reason: `made as "${cover.story_json.headline}"`,
        episode: cover.id,
      });
      continue;
    }
    const planned = development
      ? undefined
      : plannedEntry(story, ctx.run, ctx.now, cfg.timezone);
    if (planned) {
      out.push({
        ...base(),
        action: "planned",
        reason: `planned: "${planned.title}" at ${planned.slot} on ${planned.date}`,
      });
      continue;
    }
    const hold = (reason: string) =>
      out.push({ ...base(), action: "held", reason });
    if (story.leak) {
      hold(
        "the coverage is of leaked or datamined material, which Pulse does not cover",
      );
      continue;
    }
    if (story.unsafe) {
      hold("the headlines are not advertiser safe");
      continue;
    }
    const failed = ctx.episodes.filter(
      (e) =>
        e.story_json.bigStory?.key === story.key &&
        (e.status === "failed" || e.status === "rejected"),
    );
    if (failed.length >= BIG_ATTEMPTS) {
      const last = failed[0]!;
      hold(
        `its Short ${last.status === "rejected" ? "was rejected" : "failed"} ${failed.length} times${last.last_error ? ` (${last.last_error.slice(0, 80)})` : ""}`,
      );
      continue;
    }
    if (story.rumour && !ctx.includeRumours) {
      hold("it is a report not yet confirmed, and INCLUDE_RUMOURS is off");
      continue;
    }
    if (story.rumour && ctx.rumoursToday >= ctx.rumourCap) {
      hold(
        `it is a report not yet confirmed, and today's ${ctx.rumourCap} rumour Shorts are already made`,
      );
      continue;
    }
    if (ctx.blocked) {
      hold(ctx.blocked);
      continue;
    }
    // The ceiling is on cost, and it never stops the day's very biggest story: God of War's delay came at 17:15 on 4 Nov,
    // after three smaller stories would already have been made.
    if (
      bigMade >= cfg.bigStoryPerDay + HUGE_EXTRA ||
      (bigMade >= cfg.bigStoryPerDay && story.size < cfg.bigStoryHuge)
    ) {
      hold(
        `today's ${cfg.bigStoryPerDay} big-story Shorts are already made (BIG_STORY_PER_DAY)`,
      );
      continue;
    }
    const sameGames = ctx.episodes.filter(
      (e) =>
        e.story_json.bigStory?.entity === story.entity &&
        e.status !== "failed" &&
        e.status !== "rejected" &&
        ctx.now.getTime() - new Date(e.created_at).getTime() <
          SAME_GAME_HOURS * 3_600_000,
    );
    const sameGame = sameGames[0];
    if (sameGames.length >= HUGE_SAME_GAME) {
      hold(
        `${HUGE_SAME_GAME} big Shorts on ${story.name} went out in the last ${SAME_GAME_HOURS} hours, the most a day`,
      );
      continue;
    }
    if (sameGame && story.size < cfg.bigStoryHuge) {
      hold(
        `a big Short on ${story.name} went out in the last ${SAME_GAME_HOURS} hours ("${sameGame.story_json.headline}"), and a second needs size ${cfg.bigStoryHuge}`,
      );
      continue;
    }
    if (!inWindow(ctx.now, cfg.breakingWindow, cfg.timezone)) {
      hold(`waiting for the morning (BREAKING_WINDOW ${cfg.breakingWindow})`);
      continue;
    }
    if (makeTaken) {
      hold("next in line after a bigger story");
      continue;
    }
    if (cfg.bigStoryMode !== "make") {
      hold("BIG_STORY_MODE is report, so nothing was made");
      continue;
    }
    makeTaken = true;
    bigMade++;
    out.push({
      ...base(),
      action: "make",
      reason: "being made now",
      attempt: failed.length + 1,
    });
  }
  return out;
}

/** The story as an episode carries it, marked as big, and late when it is no longer news of the last few hours. */
export function bigCluster(verdict: BigVerdict, now: Date): StoryCluster {
  const s = verdict.story;
  const base = storyCluster(s);
  const lateHours = Math.round(
    (now.getTime() - new Date(s.firstAt).getTime()) / 3_600_000,
  );
  return {
    ...base,
    hash: `${base.hash}${verdict.development ? `:after-${verdict.development}` : ""}${verdict.attempt > 1 ? `:${verdict.attempt}` : ""}`,
    bigStory: {
      key: s.key,
      entity: s.entity,
      size: s.size,
      event: s.event,
      ...(lateHours >= LATE_AFTER_HOURS ? { lateHours } : {}),
    },
  };
}

/** Sightings of stories already made or planned: not for the usual lanes either, or the day says it twice (pure). */
export function coveredHashes(verdicts: BigVerdict[]): Set<string> {
  const out = new Set<string>();
  for (const v of verdicts)
    if (v.action === "made" || v.action === "planned")
      for (const h of v.story.hashes) out.add(h);
  return out;
}

/** The note the editor reads with a big story: it is the day's news, and "avoid reviews" does not apply to it. */
export function bigEditorNote(s: SizedStory): string {
  return `This candidate is one of the biggest stories in gaming today: ${s.outlets.length} independent outlets and ${s.articles} articles (${s.why}). Choose it unless it cannot be made safely for advertisers. Reviews, scores and acclaim of a game this big are news here, whatever the usual rule on reviews says. Give the exact game title, not the series.`;
}

/**
 * What the writer is told when the story broke hours ago: viewers have seen the headline, so the Short says where
 * things stand now. Only what the sources say; it changes the angle, not the standard.
 */
export function lateAngleNote(lateHours: number | undefined): string {
  if (!lateHours) return "";
  return `This story broke about ${lateHours} hours ago and many viewers have already seen the headline. Do not write it as if it just happened, and no "breaking" or "just announced". Lead with where things stand now: what has happened since, the reaction, what it changes for the viewer. The newest sources come first. Use only what the sources say.`;
}

/** Which filler lanes give way today: one for each big story made, in the order given (pure). */
export function fillerBumped(
  lane: string,
  bigMadeToday: number,
  order: string[],
): boolean {
  const at = order.indexOf(lane);
  return at >= 0 && at < bigMadeToday;
}

/** Big-story Shorts started today and not dropped, in the owner's day. */
export async function bigMadeToday(db: Db, timeZone: string): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected') AND story_json ? 'bigStory'`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}

/** Is a filler lane giving way to today's big stories? Logged and evented once a day per lane. */
export async function bumpFiller(
  db: Db,
  cfg: BigCfg,
  lane: string,
  now: Date,
): Promise<boolean> {
  if (cfg.bigStoryMode !== "make" || !cfg.bigStoryBumps.includes(lane))
    return false;
  const made = await bigMadeToday(db, cfg.timezone);
  if (!fillerBumped(lane, made, cfg.bigStoryBumps)) return false;
  const key = `big_bumped:${lane}:${dayKey(now, cfg.timezone)}`;
  const rows = await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, 'yes') ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key],
  );
  if (rows.length) {
    log("info", "filler slot gave way to a big story", { lane, made });
    await logEvent(db, null, "filler_bumped", { lane, big_made_today: made });
  }
  return true;
}

// ---------------------------------------------------------------- reading the database

const memo = new WeakMap<object, { at: number; stories: SizedStory[] }>();
const MEMO_MS = 5 * 60_000;
const CHATTER_KEY = "chatter_signal";
const CHATTER_EVERY_MS = 60 * 60_000;

/** What sizing reads besides the sightings. */
export type StoryCfg = Pick<
  Config,
  | "bigStoryMaxAgeHours"
  | "bigStoryHuge"
  | "timezone"
  | "launchCalendarFile"
  | "chatterSources"
>;

async function storiesFromSightings(
  db: Db,
  hours: number,
  now: Date,
): Promise<SizedStory[]> {
  const rows = await db.query<{
    hash: string;
    cluster_json: Pick<StoryCluster, "items">;
  }>(
    `SELECT hash, cluster_json FROM cluster_sightings WHERE last_seen > $1::timestamptz - ($2 || ' hours')::interval`,
    [now, String(hours)],
  );
  return sizeStories(rows, now, hours);
}

async function readChatterSignal(db: Db): Promise<ChatterSignal | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [CHATTER_KEY],
  );
  try {
    return row ? (JSON.parse(row.value) as ChatterSignal) : undefined;
  } catch {
    return undefined;
  }
}

/** The stories the sightings hold now, biggest first, with chatter and the launch calendar applied. Sized at most once every five minutes: it is a lot of JSON. */
export async function currentStories(
  db: Db,
  cfg: StoryCfg,
  now: Date,
): Promise<SizedStory[]> {
  const hit = memo.get(db);
  if (hit && Math.abs(now.getTime() - hit.at) < MEMO_MS) return hit.stories;
  const sized = await storiesFromSightings(db, cfg.bigStoryMaxAgeHours, now);
  const stories = applyLaunches(
    applyChatter(
      sized,
      cfg.chatterSources.length ? await readChatterSignal(db) : undefined,
      now,
    ),
    readLaunches(cfg.launchCalendarFile),
    now,
    cfg.timezone,
    cfg.bigStoryHuge,
  );
  memo.set(db, { at: now.getTime(), stories });
  return stories;
}

/** Runs after discovery, at most once an hour: asks the free sources about the games in the news. */
export async function refreshChatter(
  db: Db,
  cfg: StoryCfg & Pick<Config, "bigStoryMode">,
  now: Date,
  trending: () => Promise<TrendingVideo[]>,
  read: typeof readChatter = readChatter,
): Promise<ChatterSignal | undefined> {
  if (cfg.bigStoryMode === "off" || !cfg.chatterSources.length) return undefined;
  const was = await readChatterSignal(db);
  if (was && now.getTime() - new Date(was.at).getTime() < CHATTER_EVERY_MS)
    return was;
  const stories = await storiesFromSightings(db, cfg.bigStoryMaxAgeHours, now);
  const signal = await read(chatterTerms(stories), cfg.chatterSources, now, trending);
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CHATTER_KEY, JSON.stringify(signal)],
  );
  log("info", "chatter read", { entities: signal.entities });
  return signal;
}

/** Forgets the sized stories, for tests that move the clock and the feeds. */
export function forgetStories(db: Db): void {
  memo.delete(db);
}

/** Recent episodes that can cover a story, newest first. */
export async function recentCover(db: Db, now: Date): Promise<CoverEpisode[]> {
  return db.query<CoverEpisode>(
    `SELECT id, lane, status, story_hash, created_at, last_error, story_json FROM episodes
      WHERE created_at > $1::timestamptz - ($2 || ' hours')::interval
        AND lane NOT IN ('evergreen','longform','gameplay','twin') ORDER BY created_at DESC`,
    [now, String(COVERED_HOURS)],
  );
}

// ---------------------------------------------------------------- saying why

const STATE_KEY = "big_stories_today";

export interface BigRecord {
  headline: string;
  name: string;
  event: StoryEvent;
  size: number;
  outlets: number;
  articles: number;
  action: BigAction;
  reason: string;
  episode?: string;
}

interface BigState {
  day: string;
  stories: Record<string, BigRecord>;
}

async function readState(db: Db, day: string): Promise<BigState> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [STATE_KEY],
  );
  try {
    const s = row ? (JSON.parse(row.value) as BigState) : undefined;
    if (s?.day === day) return s;
  } catch {
    // a broken row starts the day again
  }
  return { day, stories: {} };
}

/**
 * Keeps the day's record of every big story. A story's first appearance and any change of what is happening to it is
 * a log line and an event, so nothing is ever passed over silently; a tick that changes nothing writes nothing.
 */
export async function recordVerdicts(
  db: Db,
  cfg: BigCfg,
  verdicts: BigVerdict[],
  now: Date,
): Promise<void> {
  const day = dayKey(now, cfg.timezone);
  const state = await readState(db, day);
  let changed = false;
  for (const v of verdicts) {
    const s = v.story;
    const was = state.stories[s.key];
    const record: BigRecord = {
      headline: s.headline,
      name: s.name,
      event: s.event,
      size: Math.max(s.size, was?.size ?? 0),
      outlets: Math.max(s.outlets.length, was?.outlets ?? 0),
      articles: Math.max(s.articles, was?.articles ?? 0),
      action: v.action,
      reason: v.reason,
      ...(v.episode ? { episode: v.episode } : {}),
    };
    const sameStory = was && was.action === v.action && was.reason === v.reason;
    state.stories[s.key] = record;
    changed = true;
    if (sameStory) continue;
    const detail = {
      key: s.key,
      headline: s.headline,
      size: s.size,
      why: s.why,
      action: v.action,
      reason: v.reason,
    };
    log(
      v.action === "held" ? "warn" : "info",
      v.action === "held" ? "big story not being made" : "big story",
      detail,
    );
    await logEvent(
      db,
      v.episode ?? null,
      v.action === "held" ? "big_story_held" : "big_story",
      detail,
    );
  }
  if (changed)
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [STATE_KEY, JSON.stringify(state)],
    );
}

/** The evening line: the day's biggest stories, each made, planned or missed, with the reason (pure). */
export function missReportLine(
  records: BigRecord[],
  fallback: Array<{ headline: string; size: number }> = [],
): string {
  if (!records.length) {
    const top = fallback
      .slice(0, 3)
      .map((f) => `"${f.headline}" (size ${f.size})`)
      .join(", ");
    return `Biggest stories today: none reached the big-story bar.${top ? ` The largest were ${top}.` : ""}`;
  }
  const parts = [...records]
    .sort((a, b) => b.size - a.size)
    .slice(0, 6)
    .map((r) => {
      const label = `"${r.headline}" (size ${r.size}, ${r.outlets} outlets)`;
      if (r.action === "made" || r.action === "make") return `${label}: made`;
      if (r.action === "planned") return `${label}: ${r.reason}`;
      return `${label}: missed because ${r.reason}`;
    });
  return `Biggest stories today: ${parts.join("; ")}.`.slice(0, 1900);
}

/** Sent each evening with the daily summary. Missed stories make it a warning, and so a line in the alert digest. */
export async function sendMissReport(
  db: Db,
  cfg: BigCfg & StoryCfg,
  now: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<string | undefined> {
  if (cfg.bigStoryMode === "off") return undefined;
  const day = dayKey(now, cfg.timezone);
  const state = await readState(db, day);
  const stories = await currentStories(db, cfg, now);
  const due = launchesWithoutStory(
    stories,
    readLaunches(cfg.launchCalendarFile),
    now,
    cfg.timezone,
  );
  const line = `${missReportLine(
    Object.values(state.stories),
    stories.slice(0, 3).map((s) => ({ headline: s.headline, size: s.size })),
  )}${due.length ? ` Launch calendar: ${due.join("; ")}.` : ""}`;
  const missed = Object.values(state.stories).filter(
    (r) => r.action === "held",
  ).length;
  await logEvent(db, null, "big_story_report", {
    day,
    missed,
    stories: state.stories,
  });
  log(missed ? "warn" : "info", "big story report", { line });
  // Posted on its own, not kept for tomorrow's summary as level "info" would be.
  await notify({ content: line });
  return line;
}
