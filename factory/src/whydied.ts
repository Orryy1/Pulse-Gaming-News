// The "why it died" documentary strand (upgrade queue item 13, from the 11 Nov niche research, change 9). nelvox has
// made 57 films in one "how or why it died" frame for a 174K median on 55K subscribers; Selwen's studio-downfall films
// have a 370K median on 64.4K; a search limited to this year puts fresh failures (1.33M and 486K) above older
// histories, and games that failed in the last 18 months lead those channels' top lists. Pulse's news desk already
// sees which launches are failing. Caution: nelvox's newest films sit at 39K to 217K, so the frame may be tiring;
// judge over three films.
//
// Behind WHY_DIED_ENABLED (off by default), at most one film every WHY_DIED_EVERY_DAYS days (14), in the documentary
// lane's monthly slot ahead of the breakout pick:
// - topics come from the news desk: the last 18 months of the factory's own stories (episodes and cluster sightings)
//   that report a shutdown, an end of service, a delisting, a collapse in players or a studio closure, grouped by game;
// - a game needs at least two such stories and a concrete loss the stories state (a share of players, a number of
//   days, a sum of money); the title carries it in the strand's one shape, "How <game> Lost <loss>";
// - one subject, its fall and the loss, 25 to 35 minutes (WHY_DIED_OUTLINE_RULE), told calmly and attributed: a
//   failure is the studio's decisions, never mockery of the people who made it;
// - every proposal is written to WHY_DIED_FILE (whydied_slate.json in the data folder when empty) for the owner.
// Pure functions first; pickWhyDied reads the database.

import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.ts";
import type { DocTopic } from "./editorial/documentary.ts";
import { log, errorMessage } from "./lib/util.ts";

/** What a "why it died" film carries on its topic and script. */
export interface WhyDiedMeta {
  game: string;
  /** The loss as the title says it: "90% of Its Players", "$200 Million", "Its Servers in 12 Days". */
  loss: string;
  /** Target length in minutes. */
  minutes: [number, number];
  /** The news headlines the proposal came from, newest first. */
  stories: string[];
}

export const WHY_DIED_MINUTES: [number, number] = [25, 35];
/** How far back the news desk looks: games that failed in the last 18 months lead the hit lists. */
export const WHY_DIED_LOOKBACK_DAYS = 540;
/** Stories a game needs before it is a candidate: one headline is a blip. */
export const WHY_DIED_MIN_STORIES = 2;

// A failed launch, in a headline. Regexes live here.
export const FAILURE =
  /\b(shut(?:ting|s)? down|shutdown|servers? (?:are |will )?(?:go(?:ing)? )?(?:offline|dark|closing|close)|end of service|sunset(?:ting|s)?|delist(?:ed|ing)?|pulled from sale|taken offline|refunds?|player count (?:drops?|crash(?:es|ed)?|collapses?)|lost \d[\d,.]*\s*%|(?:studio|developer) (?:closes?|closed|closure|shut)|layoffs?|cancel(?:l)?ed (?:all )?(?:future )?(?:updates|seasons|support)|ends? (?:support|development)|dead on arrival|flop(?:ped|s)?|failed launch|peak(?:ed)? at (?:just |only )?\d)\b/i;

const PERCENT =
  /\b(\d{1,3}(?:\.\d+)?)\s*(?:%|per ?cent)\s*(?:of (?:its |their )?(players|player base|playerbase|users|audience|staff|workforce))?/i;
const MONEY = /([$£€])\s?(\d[\d,.]*)\s*(million|billion|m|bn)\b/i;
const DAYS =
  /\b(?:after|in|within|just|only)\s+(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days|weeks|months)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** The concrete loss a set of headlines states, as the title says it (pure); undefined when none is stated. */
export function lossPhrase(texts: readonly string[]): string | undefined {
  const all = texts.join(" \n ");
  const pct = all.match(PERCENT);
  const money = all.match(MONEY);
  const days = all.match(DAYS);
  const span = days
    ? `${NUMBER_WORDS[days[1]!.toLowerCase()] ?? Number(days[1])} ${days[2]!.toLowerCase().replace(/^(\w)/, (c) => c.toUpperCase())}`
    : undefined;
  if (pct) {
    const whom = (pct[2] ?? "players")
      .toLowerCase()
      .replace(/player ?base/, "players");
    return `${pct[1]}% of Its ${whom.replace(/^(\w)/, (c) => c.toUpperCase())}${span ? ` in ${span}` : ""}`;
  }
  if (money) {
    const unit = /^b/i.test(money[3]!) ? "Billion" : "Million";
    return `${money[1]}${money[2]} ${unit}${span ? ` in ${span}` : ""}`;
  }
  if (span) return `Its Players in ${span}`;
  return undefined;
}

/** The thumbnail's word for a loss (pure): its figure, "90%" or "$200M"; the strand allows two words at most. */
export function lossThumb(loss: string): string {
  const pct = loss.match(/\d[\d.]*%/);
  if (pct) return pct[0];
  const money = loss.match(/([$£€]\d[\d,.]*)\s+(Million|Billion)/i);
  if (money) return `${money[1]}${/^b/i.test(money[2]!) ? "BN" : "M"}`;
  const span = loss.match(/(\d+)\s+(Days|Weeks|Months)/i);
  return span ? `${span[1]} ${span[2]!.toUpperCase()}` : "";
}

/** The strand's one title shape (pure), at most 70 characters; undefined when it would run over. */
export function whyDiedTitle(game: string, loss: string): string | undefined {
  const t = `How ${game.trim()} Lost ${loss.trim()}`;
  return t.length <= 70 ? t : undefined;
}

export interface NewsStory {
  headline: string;
  game: string;
  at: string;
}

export interface WhyDiedProposal {
  game: string;
  title: string;
  loss: string;
  stories: string[];
  newest: string;
  /** Failure stories and how recent the newest is: more and newer ranks first. */
  score: number;
}

const gameKey = (g: string) =>
  g
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The news desk's "why it died" candidates (pure): games with at least two failure stories in the lookback and a loss
 * the stories state, best first. `covered` are subjects already made (documentary franchises), never proposed again.
 */
export function whyDiedProposals(
  stories: readonly NewsStory[],
  now: Date,
  covered: readonly string[] = [],
  lookbackDays = WHY_DIED_LOOKBACK_DAYS,
): WhyDiedProposal[] {
  const since = now.getTime() - lookbackDays * 86_400_000;
  const done = new Set(covered.map(gameKey));
  const byGame = new Map<string, { game: string; hits: NewsStory[] }>();
  for (const s of stories) {
    const game = s.game?.trim();
    if (!game || !FAILURE.test(s.headline)) continue;
    const t = new Date(s.at).getTime();
    if (!Number.isFinite(t) || t < since || t > now.getTime()) continue;
    const k = gameKey(game);
    if (done.has(k)) continue;
    const g = byGame.get(k) ?? { game, hits: [] };
    if (!g.hits.some((h) => h.headline === s.headline)) g.hits.push(s);
    byGame.set(k, g);
  }
  const out: WhyDiedProposal[] = [];
  for (const { game, hits } of byGame.values()) {
    if (hits.length < WHY_DIED_MIN_STORIES) continue;
    hits.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const loss = lossPhrase(hits.map((h) => h.headline));
    if (!loss) continue;
    const title = whyDiedTitle(game, loss);
    if (!title) continue;
    const ageDays =
      (now.getTime() - new Date(hits[0]!.at).getTime()) / 86_400_000;
    out.push({
      game,
      title,
      loss,
      stories: hits.map((h) => h.headline).slice(0, 8),
      newest: hits[0]!.at,
      score:
        Math.round(
          (hits.length + Math.max(0, 1 - ageDays / lookbackDays) * 3) * 100,
        ) / 100,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** True when the last "why it died" film was made at least `everyDays` ago (or never). */
export function whyDiedDue(
  lastAt: string | undefined,
  now: Date,
  everyDays: number,
): boolean {
  if (!lastAt) return true;
  return now.getTime() - new Date(lastAt).getTime() >= everyDays * 86_400_000;
}

/** The outline's rule for the strand: one subject, its fall, the loss; 25 to 35 minutes; calm and attributed. */
export const WHY_DIED_OUTLINE_RULE = `This is a "why it died" film: one game, its fall and the loss the title names. Plan 7 to 10 chapters for 25 to 35 minutes, in time order: the promise, the launch, the first signs, the numbers falling, the decisions that made it worse or tried to save it, the end, and what it cost (the title's loss, said plainly with its source). Every cause is a decision someone made and the sources report; judge decisions, never the people who made the game, and never mock players or staff. If a cause is reported but not confirmed, say who reported it. The YouTube title stays exactly as given.`;

/** The documentary topic for a proposal (pure). */
export function whyDiedTopic(p: WhyDiedProposal): DocTopic {
  return {
    kind: "story",
    franchise_index: -1,
    story_index: -1,
    title_idea: p.title,
    angle: `Why ${p.game} failed: the launch, the fall and what it cost (${p.loss}), from the news Pulse covered`,
    reason: `"Why it died" strand: ${p.stories.length} failure stories on the news desk, newest ${p.newest.slice(0, 10)}.`,
    franchise: p.game,
    wiki: p.game,
    why_died: {
      game: p.game,
      loss: p.loss,
      minutes: WHY_DIED_MINUTES,
      stories: p.stories,
    },
  };
}

/**
 * The strand's next film, when one is due (reads the database): the best proposal not yet made. Every proposal is
 * written to the proposals file for the owner. Undefined: off, not due, or nothing qualifies.
 */
export async function pickWhyDied(
  s: {
    db: Db;
    cfg: {
      whyDied: boolean;
      whyDiedFile: string;
      whyDiedEveryDays: number;
      dataDir: string;
    };
  },
  now: Date,
  covered: readonly string[],
): Promise<{ topic: DocTopic; proposals: WhyDiedProposal[] } | undefined> {
  if (!s.cfg.whyDied) return undefined;
  const last = (
    await s.db.query<{ at: string }>(
      `SELECT max(created_at) AS at FROM episodes WHERE factcheck_json->'topic'->'why_died' IS NOT NULL AND status NOT IN ('failed','rejected')`,
    )
  )[0]?.at;
  if (
    !whyDiedDue(
      last ? new Date(last).toISOString() : undefined,
      now,
      s.cfg.whyDiedEveryDays,
    )
  )
    return undefined;
  const made = (
    await s.db.query<{ game: string }>(
      `SELECT factcheck_json->'topic'->'why_died'->>'game' AS game FROM episodes WHERE factcheck_json->'topic'->'why_died' IS NOT NULL`,
    )
  ).map((r) => r.game);
  const stories = await s.db.query<NewsStory>(
    `SELECT story_json->>'headline' AS headline, COALESCE(script_json->>'game_title', story_json->>'gameHint', '') AS game, created_at::text AS at
       FROM episodes WHERE created_at > $1::timestamptz - make_interval(days => $2) AND story_json->>'headline' IS NOT NULL
     UNION ALL
     SELECT headline, COALESCE(cluster_json->>'gameHint', '') AS game, last_seen::text AS at
       FROM cluster_sightings WHERE last_seen > $1::timestamptz - make_interval(days => $2)`,
    [now, WHY_DIED_LOOKBACK_DAYS],
  );
  const proposals = whyDiedProposals(stories, now, [...covered, ...made]);
  const file =
    s.cfg.whyDiedFile || path.join(s.cfg.dataDir, "whydied_slate.json");
  await fs
    .writeFile(
      file,
      JSON.stringify({ at: now.toISOString(), proposals }, null, 2),
    )
    .catch((err) =>
      log("warn", "why-it-died proposals not written", {
        error: errorMessage(err),
      }),
    );
  const best = proposals[0];
  return best ? { topic: whyDiedTopic(best), proposals } : undefined;
}
