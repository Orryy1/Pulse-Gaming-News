// GAME_DAY_CAP (improvement engine, 27 Nov 2026): a hard limit on how many Shorts a day may name one game.
//
// Why: since GTA VI launched (19 Nov) every big channel posts it, and Pulse's GTA VI Shorts drew a median of 99 views
// against 315 for every other game's (19 and 15 Shorts, 19-26 Nov, YouTube Data API); the GTA VI "why" Shorts did
// worse still. The 19 Nov fix was one line in FOCUS_NOTE ("at most two GTA 6 Shorts a day"), which is only a prompt:
// the editor still made about two a day and three on 20 Nov. This makes the limit a rule in code.
//
// Setting: GAME_DAY_CAP, ";"-separated games, each "alias|alias|...=N". Empty (the default) is off.
//   GAME_DAY_CAP="GTA VI|GTA 6|Grand Theft Auto VI|Grand Theft Auto 6=1"
// A Short counts for a game when its headline, game or YouTube title names one of the aliases as whole words, so
// "GTA V" and San Andreas history stay free. A headline that names GTA VI in passing ("Call of Duty Loses 42% of
// Players After GTA 6", 28 views) counts and is held too, on purpose: those did as badly as GTA VI's own Shorts.
// Counted: every Short lane made today (news, breaking, Why, search, free, evergreen, cutdowns), plus the day's
// planned GTA File part while it is not yet made and its slot can still run (a Why day, a Why slot, nobody else in
// it), so the numbered series keeps its part and the rest gives way to it.
// Applied: the news slot's stories (before the best twelve are taken), a big story that would fill a news slot, the
// Why lane's planned topic and editor list, and the search slot's pick. Never held: breaking news (its own one-a-day
// rule and franchise cooldown, and a big story with no slot due is made as breaking) and the GTA File part. Long
// videos are not Shorts and are neither counted nor held. When every story of a news slot (or every Why candidate) is
// capped, all are kept: a lost slot costs more than one more GTA Short. A search slot whose every query is capped stays
// empty for that harvest (search Shorts are extra, outside the day's target).

import type { Db } from "./db.ts";

export interface GameCap {
  /** The first alias, for logs. */
  name: string;
  aliases: string[];
  perDay: number;
}

/** "a|b=1; c|d=2" to caps; entries without a name or a whole number of 0 or more are skipped. */
export function parseGameDayCap(raw: string): GameCap[] {
  const out: GameCap[] = [];
  for (const part of (raw ?? "").split(";")) {
    const eq = part.lastIndexOf("=");
    if (eq < 0) continue;
    const aliases = part
      .slice(0, eq)
      .split("|")
      .map((a) => a.trim())
      .filter(Boolean);
    const n = Number(part.slice(eq + 1).trim());
    if (!aliases.length || !Number.isInteger(n) || n < 0) continue;
    out.push({ name: aliases[0]!, aliases, perDay: n });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text names one of the game's aliases as whole words, any spacing, any case. */
export function namesGame(
  cap: Pick<GameCap, "aliases">,
  text: string,
): boolean {
  return cap.aliases.some((a) =>
    new RegExp(
      `(?<![a-z0-9])${a.split(/\s+/).map(escape).join("\\s*")}(?![a-z0-9])`,
      "i",
    ).test(text),
  );
}

/** The first cap the text names whose day is full, else undefined. */
export function fullCap(
  caps: GameCap[],
  counts: Map<string, number>,
  text: string,
): GameCap | undefined {
  return caps.find(
    (c) => (counts.get(c.name) ?? 0) >= c.perDay && namesGame(c, text),
  );
}

/**
 * Drops the items naming a game whose day is full. When every item would go, all are kept (allCapped), so a slot
 * is never emptied by the cap.
 */
export function filterCapped<T>(
  items: T[],
  textOf: (t: T) => string,
  caps: GameCap[],
  counts: Map<string, number>,
): {
  kept: T[];
  dropped: Array<{ item: T; game: string }>;
  allCapped: boolean;
} {
  if (!caps.length) return { kept: items, dropped: [], allCapped: false };
  const kept: T[] = [];
  const dropped: Array<{ item: T; game: string }> = [];
  for (const it of items) {
    const cap = fullCap(caps, counts, textOf(it));
    if (cap) dropped.push({ item: it, game: cap.name });
    else kept.push(it);
  }
  if (items.length && !kept.length)
    return { kept: items, dropped: [], allCapped: true };
  return { kept, dropped, allCapped: false };
}

/** Lanes whose episodes are Shorts and count towards a game's day. */
export const CAP_LANES = ["news", "news_breaking", "free", "evergreen", "cutdown"];

/**
 * Today's Shorts per capped game (local day in timeZone, a pre-made or spare Short on its slot's day as countToday
 * counts it), plus `reserved` (the planned GTA File part not yet made, by game name).
 */
export async function gameCountsToday(
  db: Db,
  caps: GameCap[],
  timeZone: string,
  now: Date,
  reserved: Map<string, number> = new Map(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!caps.length) return counts;
  const rows = await db.query<{ text: string | null }>(
    `SELECT concat_ws(' ', story_json->>'headline', story_json->>'gameHint', script_json->'youtube'->>'title') AS text
       FROM episodes
      WHERE (CASE WHEN story_json ? 'premade' OR story_json ? 'spare' THEN slot_at ELSE created_at END)
              >= date_trunc('day', $2::timestamptz AT TIME ZONE $1) AT TIME ZONE $1
        AND (CASE WHEN story_json ? 'premade' OR story_json ? 'spare' THEN slot_at ELSE created_at END)
              < (date_trunc('day', $2::timestamptz AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1
        AND status NOT IN ('failed','rejected')
        AND lane = ANY($3::text[])`,
    [timeZone, now, CAP_LANES],
  );
  for (const c of caps) {
    const made = rows.filter((r) => namesGame(c, r.text ?? "")).length;
    counts.set(c.name, made + (reserved.get(c.name) ?? 0));
  }
  return counts;
}

/** Reserved places for a planned part (the GTA File): one for each cap the part's game or title names. */
export function reserveFor(
  caps: GameCap[],
  text: string | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!text) return out;
  for (const c of caps) if (namesGame(c, text)) out.set(c.name, 1);
  return out;
}
