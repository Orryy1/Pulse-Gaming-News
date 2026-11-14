// What the weekly analytics loop (src/analyticsloop.ts) hands back to the rest of the factory, read from its
// latest.json. Kept apart from the loop itself so the crosspost picker and the story picker can read it without
// pulling in the platform readers (and their import of the crosspost module). Each use has its own setting, all
// off by default: ANALYTICS_LOOP_LESSONS (advice lines for the writers), ANALYTICS_LOOP_POSTING (which Shorts go
// to TikTok and Instagram) and ANALYTICS_LOOP_SCORING (a small multiplier on news story picks). A report older
// than LOOP_STALE_DAYS is ignored, so a stopped job never leaves last month's advice standing.

import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";

/** A report this old no longer steers anything: the job runs weekly, so two missed runs and it falls silent. */
export const LOOP_STALE_DAYS = 15;
/** The most a fit Short's TikTok ranking number may be raised (spec section 6, Tier 2). */
export const MAX_TIKTOK_BOOST = 0.25;
/** Story-pick multipliers stay inside these bounds and move at most WEIGHT_STEP a week. */
export const WEIGHT_MIN = 0.85;
export const WEIGHT_MAX = 1.15;
export const WEIGHT_STEP = 0.05;
/** A held Instagram format still gets one post in this many, so its numbers never dry up. */
export const HELD_RETRY_EVERY = 5;

/** Traits the weekly report may favour in a capped platform's daily pick (see `favourKeys`). */
export const FAVOUR_KEYS = ["fit", "why", "strong_fandom"] as const;
export type FavourKey = (typeof FAVOUR_KEYS)[number];
/** Per platform, the lift the report gives each favoured trait (0 to MAX_TIKTOK_BOOST). */
export type PostingFavour = Record<string, Partial<Record<FavourKey, number>>>;

export interface LoopFeedback {
  run_at: string;
  lessons: string[];
  lessons_blocklist: string[];
  posting: {
    tiktok_boost: number;
    instagram_held: string[];
    favour: PostingFavour;
  };
  weights: Record<string, number>;
}

export function loopDir(cfg: Pick<Config, "dataDir">): string {
  return path.join(cfg.dataDir, "reports", "analytics");
}

let cache:
  | { file: string; mtime: number; value: LoopFeedback | undefined }
  | undefined;

/** The feedback part of the latest report, or undefined when there is none or it is stale. */
export function readLoopFeedback(
  cfg: Pick<Config, "dataDir">,
  now = new Date(),
): LoopFeedback | undefined {
  const file = path.join(loopDir(cfg), "latest.json");
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  if (!cache || cache.file !== file || cache.mtime !== mtime) {
    let value: LoopFeedback | undefined;
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      value = {
        run_at: String(j.run_at ?? ""),
        lessons: Array.isArray(j.feedback?.lessons)
          ? j.feedback.lessons.map(String)
          : [],
        lessons_blocklist: Array.isArray(j.lessons_blocklist)
          ? j.lessons_blocklist.map(String)
          : [],
        posting: {
          tiktok_boost: Math.min(
            MAX_TIKTOK_BOOST,
            Math.max(0, Number(j.feedback?.posting?.tiktok_boost) || 0),
          ),
          instagram_held: Array.isArray(j.feedback?.posting?.instagram_held)
            ? j.feedback.posting.instagram_held.map(String)
            : [],
          favour: parseFavour(j.feedback?.posting?.favour),
        },
        weights: Object.fromEntries(
          Object.entries((j.feedback?.weights ?? {}) as Record<string, unknown>)
            .map(([k, v]) => [k, Number(v)] as const)
            .filter(([, v]) => Number.isFinite(v))
            .map(([k, v]) => [
              k,
              Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, v)),
            ]),
        ),
      };
    } catch {
      value = undefined;
    }
    cache = { file, mtime, value };
  }
  const v = cache.value;
  if (!v || !Date.parse(v.run_at)) return undefined;
  if (now.getTime() - Date.parse(v.run_at) > LOOP_STALE_DAYS * 86_400_000)
    return undefined;
  return v;
}

/** The report's per-platform favours, each lift kept inside 0 to MAX_TIKTOK_BOOST; unknown keys dropped. */
function parseFavour(v: unknown): PostingFavour {
  const out: PostingFavour = {};
  if (!v || typeof v !== "object") return out;
  for (const [platform, keys] of Object.entries(v as Record<string, unknown>)) {
    if (!keys || typeof keys !== "object") continue;
    const kept: Partial<Record<FavourKey, number>> = {};
    for (const k of FAVOUR_KEYS) {
      const n = Number((keys as Record<string, unknown>)[k]);
      if (Number.isFinite(n) && n > 0) kept[k] = Math.min(MAX_TIKTOK_BOOST, n);
    }
    if (Object.keys(kept).length) out[platform] = kept;
  }
  return out;
}

// ------------------------------------------------------------------ what a Short is (shared with the loop)

/**
 * Fandoms with a strong identity: the ones whose Shorts travelled on Instagram and TikTok in the first report
 * (11 Nov 2026), plus their close kin. The fit test needs a fixed list, so the definition does not drift while
 * the test runs; the weekly report says which fandoms actually broke out.
 */
export const STRONG_FANDOMS: RegExp[] = [
  /mass effect/i,
  /resident evil/i,
  /warcraft|\bwow\b/i,
  /elden ring|dark souls|bloodborne|sekiro|fromsoft/i,
  /\bnier\b/i,
  /\bgta\b|grand theft auto|san andreas|red dead/i,
  /zelda|ocarina/i,
  /pok[eé]mon/i,
  /final fantasy|\bffx/i,
  /\bhalo\b/i,
  /crash bandicoot/i,
  /silksong|hollow knight/i,
  /metal gear/i,
  /god of war/i,
  /battlefront|star wars/i,
];

export interface ShortTraits {
  title: string;
  hook?: string;
  game?: string;
  durationSeconds?: number;
}

export const strongFandom = (t: ShortTraits): boolean =>
  STRONG_FANDOMS.some((re) => re.test(`${t.game ?? ""} ${t.title}`));

/**
 * A stake for the viewer: the title or hook talks to "you", or carries a size, price, date or count that lands on
 * the viewer (366GB, $70, half your Series S, March 14).
 */
export function stakeForYou(t: ShortTraits): boolean {
  const s = `${t.title} ${t.hook ?? ""}`;
  return (
    /\b(you|your|you're|yours)\b/i.test(s) ||
    /\d[\d,.]*\s?(gb|tb|mb|fps|hours?|hrs|minutes?|%)\b/i.test(s) ||
    /[$£€]\s?\d/.test(s) ||
    /\b(half|double|twice)\b/i.test(s) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i.test(
      s,
    )
  );
}

export const hasNumber = (t: ShortTraits): boolean => /\d/.test(t.title);

/** The first report's test: 35 seconds or under, a strong-identity fandom, and a stake or a number up front. */
export function isFit(t: ShortTraits): boolean {
  return (
    t.durationSeconds !== undefined &&
    t.durationSeconds > 0 &&
    t.durationSeconds <= 35 &&
    strongFandom(t) &&
    (stakeForYou(t) || hasNumber(t))
  );
}

/** How many of the three fit flags a Short has (35 s or under, stake for you, strong fandom), for tie-breaks. */
export function fitFlags(t: ShortTraits): number {
  return (
    (t.durationSeconds !== undefined &&
    t.durationSeconds > 0 &&
    t.durationSeconds <= 35
      ? 1
      : 0) +
    (stakeForYou(t) ? 1 : 0) +
    (strongFandom(t) ? 1 : 0)
  );
}

/** A Short's format as the loop groups it (why/how, ranked, deals, achievements, rumour, news, other). */
export function shortFormat(ep: {
  lane?: string | null;
  story_hash?: string | null;
  evergreen_format?: string | null;
  is_rumour?: boolean | null;
}): string {
  const f = ep.evergreen_format ?? "";
  if (ep.story_hash?.startsWith("why:")) return "why";
  if (/achievements$/.test(f)) return "achievements";
  if (f === "steam_deals" || f === "steam_climbers") return "deals";
  if (
    ep.lane === "cutdown" ||
    ["ranking", "best_per_year", "versus"].includes(f)
  )
    return "ranking";
  if (ep.is_rumour) return "rumour";
  if (ep.lane === "news" || ep.lane === "news_breaking") return "news";
  return "other";
}

/** The length band a Short falls in (spec section 5). */
export function durationBand(seconds?: number): string | undefined {
  if (seconds === undefined || !(seconds > 0)) return undefined;
  if (seconds < 30) return "under 30 s";
  if (seconds < 35) return "30 to 34 s";
  if (seconds < 45) return "35 to 44 s";
  if (seconds < 60) return "45 to 59 s";
  return "60 s plus";
}

// ------------------------------------------------------------------ Tier 2: posting choices

/** TikTok's ranking number for a candidate: YouTube views per hour, raised by at most the report's boost for a fit Short. */
export function tiktokRank(
  viewsPerHour: number,
  t: ShortTraits,
  boost: number,
): number {
  const b = Math.min(MAX_TIKTOK_BOOST, Math.max(0, boost));
  return viewsPerHour * (isFit(t) ? 1 + b : 1);
}

/** Re-orders TikTok candidates by the boosted number, the fit flags breaking ties (the original order otherwise). */
export function rankForTikTok<T>(
  rows: T[],
  vph: (r: T) => number,
  traits: (r: T) => ShortTraits,
  boost: number,
): T[] {
  return rankForPlatform(rows, vph, traits, () => "", { fit: boost });
}

/** Which of the favourable traits a Short has: the fit test, a "why" story, a strong-identity fandom. */
export function favourKeys(t: ShortTraits, format: string): FavourKey[] {
  return [
    ...(isFit(t) ? (["fit"] as const) : []),
    ...(format === "why" ? (["why"] as const) : []),
    ...(strongFandom(t) ? (["strong_fandom"] as const) : []),
  ];
}

/**
 * A capped platform's ranking number: YouTube views per hour, raised for each trait the report favours on that
 * platform (TikTok's fit boost counts as a favour of "fit"), never by more than MAX_TIKTOK_BOOST in all.
 */
export function platformRank(
  viewsPerHour: number,
  t: ShortTraits,
  format: string,
  boosts: { fit?: number; favour?: Partial<Record<FavourKey, number>> },
): number {
  const have = favourKeys(t, format);
  const lift =
    (have.includes("fit") ? Math.max(0, boosts.fit ?? 0) : 0) +
    have.reduce((a, k) => a + Math.max(0, boosts.favour?.[k] ?? 0), 0);
  return viewsPerHour * (1 + Math.min(MAX_TIKTOK_BOOST, lift));
}

/** Re-orders a capped platform's candidates by `platformRank`, the fit flags breaking ties (the original order otherwise). */
export function rankForPlatform<T>(
  rows: T[],
  vph: (r: T) => number,
  traits: (r: T) => ShortTraits,
  format: (r: T) => string,
  boosts: { fit?: number; favour?: Partial<Record<FavourKey, number>> },
): T[] {
  return rows
    .map((r, i) => ({
      r,
      i,
      rank: platformRank(vph(r), traits(r), format(r), boosts),
      flags: fitFlags(traits(r)),
    }))
    .sort((a, b) => b.rank - a.rank || b.flags - a.flags || a.i - b.i)
    .map((x) => x.r);
}

/** The keys a Short is held under on Instagram: its format, and "45s+" for 45 seconds or longer. */
export function heldKeys(format: string, durationSeconds?: number): string[] {
  return [
    format,
    ...(durationSeconds !== undefined && durationSeconds >= 45 ? ["45s+"] : []),
  ];
}

/**
 * Whether a held Short may still go to Instagram: one in HELD_RETRY_EVERY, judged from the latest Instagram posts
 * (true for each that was a held kind, newest first), and never when that would leave a healthy platform under
 * two posts a day (the caller passes `starved` when nothing else is left to post).
 */
export function heldMayPost(recentHeld: boolean[], starved: boolean): boolean {
  if (starved) return true;
  return !recentHeld.slice(0, HELD_RETRY_EVERY - 1).some(Boolean);
}

// ------------------------------------------------------------------ Tier 2: story picks

/**
 * A news story's likely story type and format from its headline, for the pick multiplier (the editor decides the
 * real type only after it picks). Rough on purpose: a wrong guess only means the neutral 1.0.
 */
export function guessKind(
  headline: string,
  rumour = false,
): { storyType: string; format: string } {
  const h = headline.toLowerCase();
  const format = /^(why|how)\b/.test(h) ? "why" : rumour ? "rumour" : "news";
  const storyType = rumour
    ? "rumour"
    : /\b(delay|delayed|pushed back|postponed|slips?)\b/.test(h)
      ? "delay"
      : /\b(review|reviews|metacritic|opencritic|scores?)\b/.test(h)
        ? "review_scores"
        : /\b(sold|sales|copies|players|million)\b/.test(h)
          ? "sales"
          : /\b(price|costs?|\$|£|€|free)\b/.test(h)
            ? "price"
            : /\btrailer\b/.test(h)
              ? "trailer"
              : /\b(release date|launches|out now|release|preload|pre-load)\b/.test(
                    h,
                  )
                ? "release_date"
                : /\b(patch|update|hotfix|servers?)\b/.test(h)
                  ? "update"
                  : /\b(ps5|ps6|xbox|switch 2|console|gpu|rtx|steam deck|hardware)\b/.test(
                        h,
                      )
                    ? "hardware"
                    : /\b(announced|announces|reveal|revealed|unveil)\b/.test(h)
                      ? "reveal"
                      : /\b(studio|layoffs?|acquires?|acquisition|ceo|lawsuit)\b/.test(
                            h,
                          )
                        ? "industry"
                        : "other";
  return { storyType, format };
}

export const weightKey = (storyType: string, format: string) =>
  `${storyType}|${format}`;

/** The pick multiplier for a story type and format; 1.0 when the report has none. */
export function storyWeight(
  weights: Record<string, number>,
  storyType: string,
  format: string,
): number {
  const w = weights[weightKey(storyType, format)];
  return w === undefined ? 1 : Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w));
}

// ------------------------------------------------------------------ Tier 1: writers' lessons

/** The report's lesson lines for the writers, minus anything on the hand-kept blocklist; none when switched off. */
export function loopLessonLines(
  cfg: Pick<Config, "dataDir" | "analyticsLoopLessons">,
  now = new Date(),
): string[] {
  if (!cfg.analyticsLoopLessons) return [];
  const fb = readLoopFeedback(cfg, now);
  if (!fb) return [];
  const blocked = fb.lessons_blocklist
    .map((b) => b.toLowerCase())
    .filter(Boolean);
  return fb.lessons
    .filter((l) => !blocked.some((b) => l.toLowerCase().includes(b)))
    .slice(0, 6);
}

/** The Tier 2 posting choices, or the neutral ones when switched off or stale. */
export function loopPosting(
  cfg: Pick<Config, "dataDir" | "analyticsLoopPosting">,
  now = new Date(),
): { tiktok_boost: number; instagram_held: string[] } {
  if (!cfg.analyticsLoopPosting) return { tiktok_boost: 0, instagram_held: [] };
  const p = readLoopFeedback(cfg, now)?.posting;
  return {
    tiktok_boost: p?.tiktok_boost ?? 0,
    instagram_held: p?.instagram_held ?? [],
  };
}

/** The traits the report favours in one platform's daily pick, or none when switched off or stale. */
export function loopFavour(
  cfg: Pick<Config, "dataDir" | "analyticsLoopPosting">,
  platform: string,
  now = new Date(),
): Partial<Record<FavourKey, number>> {
  if (!cfg.analyticsLoopPosting) return {};
  return readLoopFeedback(cfg, now)?.posting.favour[platform] ?? {};
}

/** The story-pick multipliers, or none when switched off or stale. */
export function loopWeights(
  cfg: Pick<Config, "dataDir" | "analyticsLoopScoring">,
  now = new Date(),
): Record<string, number> {
  if (!cfg.analyticsLoopScoring) return {};
  return readLoopFeedback(cfg, now)?.weights ?? {};
}
