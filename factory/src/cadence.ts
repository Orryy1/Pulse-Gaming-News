// Fewer, better Shorts (growth research, 26 Oct 2026: none of the organic breakouts won on multi-game news
// volume, and five Shorts a day at 50 views each teach the feed that the channel is skippable). The news lane
// honours SHORTS_PER_DAY_MAX: once that many news-lane Shorts (scheduled slots and breaking) exist today, the
// remaining slots are held back and the stories that would have filled them stay on the shelf, with one line
// a day in the evening summary saying how many and why. The default (0) is no cap, so nothing changes until
// the lead sets it. Breaking Shorts count towards the cap but are never blocked by it: they already clear a
// high bar, and a breaking story simply displaces the day's last slot.
// Story-first (1 Nov 2026, src/storymix.ts): Why Shorts are made in the news lane and count too. A news slot
// also leaves room for the Why slots still to come today, so news gives way to the stories; a Why slot is
// only held once the cap itself is reached (two big breaking stories on one day).

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { countToday, logEvent } from "./episodes.ts";
import { dayKey } from "./lanes.ts";
import { log } from "./lib/util.ts";

/** The lanes the cap counts: the news writer's Shorts. */
export const CAPPED_LANES = ["news", "news_breaking"];
const NOTICE_KEY = "news_cap_notice";
/** Headlines named in the notice; the rest are counted. */
const NAMED = 3;

export interface HeldStory {
  headline: string;
  score: number;
}

/** Whether the day's news allowance is used up: a cap of 0 means no cap. */
export function newsCapReached(cap: number, madeToday: number): boolean {
  return cap > 0 && madeToday >= cap;
}

/** News-lane Shorts made today (scheduled and breaking), in the owner's day. */
export async function newsMadeToday(db: Db, timeZone: string): Promise<number> {
  let n = 0;
  for (const lane of CAPPED_LANES) n += await countToday(db, timeZone, lane);
  return n;
}

/** The evening-summary line: how many Shorts today, the cap, the slot held back and what stayed on the shelf. */
export function heldBackLine(
  cap: number,
  madeToday: number,
  slotLocal: string,
  held: HeldStory[],
  /** Why slots still to come today that the slot gave way to. */
  whyAhead = 0,
): string {
  const named = [...held]
    .sort((a, b) => b.score - a.score)
    .slice(0, NAMED)
    .map((h) => `"${h.headline}" (score ${Math.round(h.score)})`)
    .join(", ");
  const shelf =
    held.length === 0
      ? "No other story was waiting for it."
      : `${held.length} ${held.length === 1 ? "story" : "stories"} stayed on the shelf: ${named}${held.length > NAMED ? ` and ${held.length - NAMED} more` : ""}.`;
  const ahead =
    whyAhead > 0
      ? ` and ${whyAhead} Why Short${whyAhead === 1 ? "" : "s"} still to come`
      : "";
  return `Shorts cap: ${madeToday} news Short${madeToday === 1 ? "" : "s"} already today${ahead}, the SHORTS_PER_DAY_MAX limit of ${cap}, so the ${slotLocal} slot was held back. ${shelf} Raise SHORTS_PER_DAY_MAX (or set it to 0) to allow more.`;
}

/** Local "HH:MM" of a slot instant. */
export function slotLabel(slot: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(slot);
}

/** True once a day: the first time a slot is held back, so the summary gets one line, not one a tick. */
export async function capNoticeDue(db: Db, day: string): Promise<boolean> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [NOTICE_KEY],
  );
  if (row?.value === day) return false;
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [NOTICE_KEY, day],
  );
  return true;
}

/**
 * Whether a due news slot is held back by the cap. When it is, the first hold of the day is logged and
 * reported (one line in the evening summary); later ticks that day stay quiet.
 */
export async function holdSlotForCap(
  db: Db,
  cfg: Pick<Config, "shortsPerDayMax" | "timezone">,
  now: Date,
  slot: Date,
  waiting: HeldStory[],
  notify: (m: DiscordMessage) => Promise<unknown>,
  /** Why slots still to come today (src/storymix.ts whySlotsAhead): the news slot leaves room for them. */
  whyAhead = 0,
): Promise<boolean> {
  if (cfg.shortsPerDayMax <= 0) return false;
  const made = await newsMadeToday(db, cfg.timezone);
  if (!newsCapReached(cfg.shortsPerDayMax, made + whyAhead)) return false;
  const day = dayKey(now, cfg.timezone);
  if (await capNoticeDue(db, day)) {
    const line = heldBackLine(
      cfg.shortsPerDayMax,
      made,
      slotLabel(slot, cfg.timezone),
      waiting,
      whyAhead,
    );
    log("info", "news slot held back by the cap", {
      slot: slot.toISOString(),
      made,
      cap: cfg.shortsPerDayMax,
      waiting: waiting.length,
      whyAhead,
    });
    await logEvent(db, null, "news_cap_hold", {
      slot: slot.toISOString(),
      made,
      cap: cfg.shortsPerDayMax,
      why_ahead: whyAhead,
      held: waiting.slice(0, 12),
    });
    await notify({ level: "info", content: line });
  }
  return true;
}

/** The evening-summary line when a Why slot is held because the day's news-lane Shorts already reach the cap. */
export function whyHeldLine(cap: number, madeToday: number, slotLocal: string): string {
  return `Shorts cap: ${madeToday} news-lane Shorts already today (breaking included), the SHORTS_PER_DAY_MAX limit of ${cap}, so the ${slotLocal} Why slot was held back. Raise SHORTS_PER_DAY_MAX (or set it to 0) to allow more.`;
}

/**
 * Whether a due Why slot is held by the cap: only once the day's news-lane Shorts reach it (the news slots
 * already gave way to it). Logged and reported once a day, like a held news slot.
 */
export async function holdWhyForCap(
  db: Db,
  cfg: Pick<Config, "shortsPerDayMax" | "timezone">,
  now: Date,
  slot: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<boolean> {
  if (cfg.shortsPerDayMax <= 0) return false;
  const made = await newsMadeToday(db, cfg.timezone);
  if (!newsCapReached(cfg.shortsPerDayMax, made)) return false;
  const day = dayKey(now, cfg.timezone);
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'why_cap_notice'`,
  );
  if (row?.value !== day) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('why_cap_notice', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [day],
    );
    await logEvent(db, null, "why_cap_hold", {
      slot: slot.toISOString(),
      made,
      cap: cfg.shortsPerDayMax,
    });
    await notify({
      level: "info",
      content: whyHeldLine(cfg.shortsPerDayMax, made, slotLabel(slot, cfg.timezone)),
    });
  }
  return true;
}
