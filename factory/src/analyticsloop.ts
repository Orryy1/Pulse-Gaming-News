// The weekly cross-platform analytics loop (spec: reports/Analytics loop spec.md, 11 Nov 2026). Once a week it
// reads the last 28 days from every platform it can reach (YouTube through the factory's own stored login,
// Instagram and Facebook through the Graph API, TikTok through Buffer), matches each Short across platforms,
// works out winners, losers and patterns with minimum sample sizes, and writes latest.md (the shared six-section
// format of C:\Claude\analytics\README.md), a dated copy and latest.json under data/reports/analytics. The PC pulls
// those files (mac/pull-analytics.sh); the Mac never pushes. No model calls: every figure is a platform reading
// and the "likely reason" sentences are templated from the Short's own traits.
//
// What feeds back is read from latest.json by src/loopfeedback.ts, each behind its own setting (all off): lessons
// for the writers, which Shorts go to TikTok and Instagram, and a small story-pick multiplier. Visuals, titles,
// target lengths and pausing a platform are only ever proposals in the report. ANALYTICS_LOOP starts the job.

import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { Script } from "./editorial/schema.ts";
import { polishTitle } from "./editorial/seo.ts";
import { logEvent } from "./episodes.ts";
import {
  LIVE_AT,
  percentileRanks,
  rankGaps,
  type VideoStats,
} from "./analytics.ts";
import { QUOTA, dayKey, quotaAdd, quotaUsed, weekday } from "./lanes.ts";
import { errorMessage, log } from "./lib/util.ts";
import { GRAPH, THREADS, threadsLogin } from "./social/platforms.ts";
import {
  IG_MEDIA_METRICS,
  graphGet,
  insightsDropping,
  type SocialNumbers,
} from "./social/metrics.ts";
import {
  bufferNumbers,
  bufferPostStats,
  type BufferPostStat,
} from "./social/buffer.ts";
import {
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  FAVOUR_KEYS,
  durationBand,
  hasNumber,
  heldKeys,
  isFit,
  loopDir,
  shortFormat,
  stakeForYou,
  strongFandom,
  weightKey,
  type PostingFavour,
} from "./loopfeedback.ts";
import { SERIES_START, isSerial, isSeriesTag, seriesTagFor } from "./series.ts";
import { seriesJson, seriesLines, type SeriesJson } from "./seriesreport.ts";

const DAY = 86_400_000;
const H = 3_600_000;
export const WINDOW_DAYS = 28;
/** The video_metrics labels that are public view counts at an age (src/analytics.ts CAPTURE_LABELS). */
const AGE_LABELS = ["1h", "3h", "24h", "72h", "7d", "28d"];

// ------------------------------------------------------------------ guard rails (spec section 7)

/** No pattern is stated under this many posts in the smaller group. */
export const MIN_PATTERN = 8;
/** Breakout-rate comparisons need at least this many breakouts on the platform. */
export const MIN_BREAKOUTS = 5;
/** No automatic change under this many posts in the smaller group. */
export const MIN_AUTO = 30;
/** Posts younger than this are left out of winners, losers and patterns (age fairness). */
export const MIN_AGE_HOURS = 72;
/** The next test's fixed breakout bars (first report): Instagram and TikTok at 72 hours. */
export const TEST_BARS: Record<string, number> = {
  instagram: 1000,
  tiktok: 2000,
};
/** Posting caps the job may never push past. */
export const CAPS: Record<string, number> = {
  tiktok: 4,
  instagram: 6,
  facebook: 1,
};
/** Facebook's per-Reel calls stay off until the Page reaches this many media views in 28 days. */
export const FACEBOOK_REEL_CALLS_FROM = 500;

export type Strength = "strong" | "moderate" | "weak";

/**
 * The evidence word for a pattern: weak at 8 to 14 posts in the smaller group, moderate at 15 to 29 (or 30 plus but
 * new this week), strong at 30 plus in the same direction as last week's run. Confounded patterns cap at moderate.
 * Under 8 there is no pattern at all.
 */
export function strengthOf(
  smaller: number,
  sameAsLastWeek: boolean,
  confounded = false,
): Strength | undefined {
  if (smaller < MIN_PATTERN) return undefined;
  if (smaller < 15) return "weak";
  if (smaller < MIN_AUTO || !sameAsLastWeek || confounded) return "moderate";
  return "strong";
}

// ------------------------------------------------------------------ small maths

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** The value at a share of the way through the sorted list (nearest rank). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[
    Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))
  ]!;
}

/** Spearman's rank correlation (ties share their average rank); undefined under 3 pairs or with no spread. */
export function spearman(xs: number[], ys: number[]): number | undefined {
  if (xs.length !== ys.length || xs.length < 3) return undefined;
  const a = percentileRanks(xs);
  const b = percentileRanks(ys);
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : undefined;
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ------------------------------------------------------------------ the rows

export type LoopPlatform = "youtube" | "instagram" | "tiktok" | "facebook";
export const LOOP_PLATFORMS: LoopPlatform[] = [
  "youtube",
  "instagram",
  "tiktok",
  "facebook",
];
export const PLATFORM_NAME: Record<string, string> = {
  youtube: "YouTube Shorts",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  bluesky: "Bluesky",
};

/** One post on one platform with its latest reading; every figure is a platform reading with its capture time. */
export interface LoopRow {
  platform: LoopPlatform;
  post_id: string;
  kind: "short" | "long" | "reel" | "feed";
  episode_id?: string;
  match?: "self" | "ledger" | "title" | "caption";
  posted_at: string;
  captured_at: string;
  /** The title (YouTube) or the caption's first line. */
  text: string;
  /** null: no reading yet (Buffer's first day reads 0). */
  views: number | null;
  views_1h?: number;
  views_3h?: number;
  views_24h?: number;
  views_72h?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  subs?: number;
  viewed_pct?: number;
  avg_watch_s?: number;
  search_share?: number;
  fit_tag?: boolean;
}

/** What the factory knows about a Short, for the groups and the matcher. */
export interface EpisodeInfo {
  id: string;
  video: string;
  title: string;
  /** The title as the captions carry it (polishTitle), when it differs. */
  caption_title: string;
  hook: string;
  headline: string;
  loop: string;
  game: string;
  lane: string;
  story_type: string;
  format: string;
  duration?: number;
  live_at: string;
  opening?: string;
  events_per_minute?: number;
  wpm?: number;
  long: boolean;
  /** The series tag (format redesign plan, src/series.ts); absent for Shorts in no series. */
  series?: string;
  /** The next-part line test's arm (SERIES_NEXT_LINE). */
  next_line?: { arm: "line" | "none"; said: boolean };
}

// ------------------------------------------------------------------ matching (spec section 4)

const SMALL = /^[a-z]{1,3}$/;
/** Words for matching: lower case, punctuation gone, words of three letters or fewer ignored (numbers kept). */
export function matchWords(s: string): Set<string> {
  return new Set(
    (
      s
        .toLowerCase()
        .replace(/['’]/g, "")
        .match(/[a-z0-9$£€]+/g) ?? []
    ).filter((w) => !SMALL.test(w)),
  );
}

/** A title normalised for equality: lower case, punctuation stripped, spaces collapsed. */
export const titleKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9$£€]+/g, " ")
    .trim();

/** Shared words over all words of the two texts (short words ignored). */
export function titleOverlap(a: string, b: string): number {
  const A = matchWords(a);
  const B = matchWords(b);
  const all = new Set([...A, ...B]);
  if (!all.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / all.size;
}

/** The share of the caption's own words found in the other text. */
export function captionCoverage(caption: string, other: string): number {
  const A = matchWords(caption);
  if (!A.size) return 0;
  const B = matchWords(other);
  let found = 0;
  for (const w of A) if (B.has(w)) found++;
  return found / A.size;
}

/** The caption before the "Narrated with an AI voice" line, which every caption shares. */
export const captionHead = (text: string) =>
  text.split(/\n?\s*Narrated with/i)[0]!.trim();
const firstLine = (text: string) => text.trim().split(/\n/)[0]!.trim();

/** Among passing candidates within 0.1 of the best score, the one that went live closest before the post. */
function closest(
  scored: Array<{ e: EpisodeInfo; score: number }>,
  postedAt?: number,
): EpisodeInfo | undefined {
  if (!scored.length) return undefined;
  const best = Math.max(...scored.map((s) => s.score));
  const near = scored.filter((s) => s.score >= best - 0.1);
  if (postedAt === undefined || near.length === 1)
    return near.sort((a, b) => b.score - a.score)[0]!.e;
  const gap = (e: EpisodeInfo) => {
    const d = postedAt - Date.parse(e.live_at);
    return d >= 0 ? d : Number.MAX_SAFE_INTEGER / 2 - d; // live after the post: only if nothing went live before it
  };
  return near.sort((a, b) => gap(a.e) - gap(b.e))[0]!.e;
}

/** Rule 2: the caption's first line equals the title, else shares 0.6 or more of its words. */
export function matchByTitle(
  text: string,
  eps: EpisodeInfo[],
  postedAt?: number,
): EpisodeInfo | undefined {
  const line = firstLine(text);
  if (!line) return undefined;
  const key = titleKey(line);
  const exact = eps.filter(
    (e) => titleKey(e.title) === key || titleKey(e.caption_title) === key,
  );
  if (exact.length)
    return closest(
      exact.map((e) => ({ e, score: 1 })),
      postedAt,
    );
  const scored = eps
    .map((e) => ({
      e,
      score: Math.max(
        titleOverlap(line, e.title),
        titleOverlap(line, e.caption_title),
      ),
    }))
    .filter((s) => s.score >= 0.6);
  return closest(scored, postedAt);
}

/**
 * Rule 3, for TikTok posts with no ledger row: their captions lead with the hook and a question, not the title.
 * 0.6 or more of the caption's words must be found in a candidate's title, hook, headline, loop line and game,
 * and only Shorts that went live between 8 days before and 1 hour after the post are candidates.
 */
export function matchByCaption(
  text: string,
  postedAt: number,
  eps: EpisodeInfo[],
): EpisodeInfo | undefined {
  const caption = captionHead(text);
  if (!caption) return undefined;
  const scored = eps
    .filter((e) => {
      const live = Date.parse(e.live_at);
      return live <= postedAt + H && live >= postedAt - 8 * DAY;
    })
    .map((e) => ({
      e,
      score: captionCoverage(
        caption,
        [e.title, e.hook, e.headline, e.loop, e.game].join(" "),
      ),
    }))
    .filter((s) => s.score >= 0.6);
  return closest(scored, postedAt);
}

/**
 * Keys every row to an episode: the crosspost ledger first (exact), then the title, then (TikTok) the caption.
 * One post per Short per platform: a Short already taken on a platform is not given a second post there. Never
 * guesses: the rest are returned unmatched and left out of cross-platform analysis.
 */
export function matchRows(
  rows: LoopRow[],
  eps: EpisodeInfo[],
  ledger: Map<string, string>,
): { rows: LoopRow[]; unmatched: LoopRow[] } {
  const taken = new Set<string>();
  const shorts = eps.filter((e) => !e.long);
  const out: LoopRow[] = [];
  const unmatched: LoopRow[] = [];
  const order = [...rows].sort(
    (a, b) =>
      Number(!ledger.has(`${a.platform}:${a.post_id}`)) -
        Number(!ledger.has(`${b.platform}:${b.post_id}`)) ||
      a.posted_at.localeCompare(b.posted_at),
  );
  for (const r of order) {
    if (r.platform === "youtube" || r.kind === "feed") {
      out.push(r);
      continue;
    }
    const free = shorts.filter((e) => !taken.has(`${r.platform}:${e.id}`));
    const at = Date.parse(r.posted_at);
    let id = ledger.get(`${r.platform}:${r.post_id}`);
    let how: LoopRow["match"] = id ? "ledger" : undefined;
    if (!id) {
      const e =
        matchByTitle(r.text, free, at) ??
        (r.platform === "tiktok"
          ? matchByCaption(r.text, at, free)
          : undefined);
      if (e) {
        id = e.id;
        how = matchByTitle(r.text, [e], at) ? "title" : "caption";
      }
    }
    if (!id) {
      unmatched.push(r);
      out.push(r);
      continue;
    }
    taken.add(`${r.platform}:${id}`);
    out.push({ ...r, episode_id: id, match: how });
  }
  return { rows: out, unmatched };
}

// ------------------------------------------------------------------ the analysis (spec section 5)

const age = (r: LoopRow, now: Date) =>
  (now.getTime() - Date.parse(r.posted_at)) / H;
const isShortRow = (r: LoopRow) => r.kind === "short" || r.kind === "reel";

/**
 * The views a platform's posts are compared on: the 72-hour reading when most posts have one (same-age
 * comparison), else the latest reading of posts at least 72 hours old. Returns the rule used, for the caveats.
 */
export function comparable(
  rows: LoopRow[],
  now: Date,
): { rows: Array<LoopRow & { v: number }>; rule: "72h" | "latest" } {
  const old = rows.filter(
    (r) => isShortRow(r) && age(r, now) >= MIN_AGE_HOURS && r.views !== null,
  );
  const with72 = old.filter((r) => r.views_72h !== undefined);
  if (old.length && with72.length >= 0.8 * old.length)
    return {
      rows: with72.map((r) => ({ ...r, v: r.views_72h! })),
      rule: "72h",
    };
  return { rows: old.map((r) => ({ ...r, v: r.views! })), rule: "latest" };
}

/** A breakout is 3 times the platform's median or more, at the comparison reading. */
export const breakoutBar = (vs: number[]) => 3 * median(vs);

const ET = "America/New_York";
function etParts(iso: string): { hour: number; day: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ET,
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { hour: Number(p.hour), day: String(p.weekday) };
}
export const hourBlock = (h: number) => {
  const a = Math.floor(h / 4) * 4;
  return `${String(a).padStart(2, "0")}:00 to ${String(a + 3).padStart(2, "0")}:59 ET`;
};

/** The groups a post belongs to, one value per dimension (spec section 5's list). */
export function features(
  r: LoopRow,
  e: EpisodeInfo | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const { hour, day } = etParts(r.posted_at);
  out["posting hours"] = hourBlock(hour);
  out["weekday"] = day;
  const line = firstLine(r.text);
  if (r.platform !== "youtube" && line)
    out["caption first line"] = /\?\s*$/.test(line)
      ? "a question"
      : "a statement";
  if (!e) return out;
  const traits = {
    title: e.title,
    hook: e.hook,
    game: e.game,
    durationSeconds: e.duration,
  };
  out["lane"] = e.lane;
  out["story type"] = e.story_type.replace(/_/g, " ");
  out["format"] = e.format;
  if (e.game) out["game"] = e.game;
  const band = durationBand(e.duration);
  if (band) out["length"] = band;
  out["title opens with why, how or can"] = /^(why|how|can)\b/i.test(e.title)
    ? "yes"
    : "no";
  out["number in the title"] = hasNumber(traits) ? "yes" : "no";
  out["title ends in a question"] = /\?\s*$/.test(e.title) ? "yes" : "no";
  out["stake for you"] = stakeForYou(traits) ? "yes" : "no";
  out["strong-identity fandom"] = strongFandom(traits) ? "yes" : "no";
  out["fit"] = (r.fit_tag ?? isFit(traits)) ? "yes" : "no";
  if (e.opening)
    out["opening"] = e.opening === "clip" ? "moving footage" : "a still";
  if (r.platform !== "youtube") {
    const gap = (Date.parse(r.posted_at) - Date.parse(e.live_at)) / H;
    out["gap after the YouTube publish"] =
      gap < 1
        ? "under 1 h"
        : gap < 3
          ? "1 to 3 h"
          : gap < 6
            ? "3 to 6 h"
            : "6 h plus";
  }
  return out;
}

export interface LoopPattern {
  platform: LoopPlatform;
  dim: string;
  group: string;
  n: number;
  rest_n: number;
  breakouts: number;
  rest_breakouts: number;
  median: number;
  rest_median: number;
  /** True when the platform had enough breakouts for rates to mean something. */
  uses_rate: boolean;
  direction: "better" | "worse";
  strength: Strength;
  confounded?: string;
}

/**
 * Every group that differs from the rest on a platform, with its sample: breakout rate when the platform has five
 * or more breakouts, else the middle value. Groups under 8 posts are only named as "too few to judge" (game
 * groups from 3). A group whose posts bunch into the last week is named as confounded by timing.
 */
export function platformPatterns(
  platform: LoopPlatform,
  rows: Array<LoopRow & { v: number }>,
  eps: Map<string, EpisodeInfo>,
  last: LoopPattern[],
  now: Date,
): {
  patterns: LoopPattern[];
  tooFew: string[];
  bar: number;
  breakouts: number;
} {
  const bar = breakoutBar(rows.map((r) => r.v));
  const isBreak = (r: { v: number }) => bar > 0 && r.v >= bar;
  const breakouts = rows.filter(isBreak).length;
  const usesRate = breakouts >= MIN_BREAKOUTS;
  const feats = rows.map((r) => ({
    r,
    f: features(r, r.episode_id ? eps.get(r.episode_id) : undefined),
  }));
  const dims = new Map<string, Map<string, typeof feats>>();
  for (const x of feats)
    for (const [d, g] of Object.entries(x.f)) {
      const m = dims.get(d) ?? new Map();
      m.set(g, [...(m.get(g) ?? []), x]);
      dims.set(d, m);
    }
  const recent = (xs: typeof feats) =>
    xs.filter((x) => now.getTime() - Date.parse(x.r.posted_at) < 7 * DAY)
      .length / Math.max(1, xs.length);
  const patterns: LoopPattern[] = [];
  const tooFew: string[] = [];
  for (const [dim, groups] of dims) {
    const inDim = [...groups.values()].flat();
    for (const [group, xs] of groups) {
      const rest = inDim.filter((x) => !xs.includes(x));
      if (xs.length < MIN_PATTERN || rest.length < MIN_PATTERN) {
        if (xs.length < MIN_PATTERN && xs.length >= 3)
          tooFew.push(`${dim}: ${group} (${xs.length})`);
        continue;
      }
      const b = xs.filter((x) => isBreak(x.r)).length;
      const rb = rest.filter((x) => isBreak(x.r)).length;
      const med = median(xs.map((x) => x.r.v));
      const rmed = median(rest.map((x) => x.r.v));
      const rate = b / xs.length;
      const rrate = rb / rest.length;
      let direction: "better" | "worse" | undefined;
      if (usesRate) {
        if (rate - rrate >= 0.05 && rate >= 1.5 * rrate) direction = "better";
        else if (rrate - rate >= 0.05 && rate <= 0.67 * rrate)
          direction = "worse";
      } else if (rmed > 0) {
        if (med >= 1.3 * rmed) direction = "better";
        else if (med <= 0.77 * rmed) direction = "worse";
      }
      if (!direction) continue;
      const before = last.find(
        (p) => p.platform === platform && p.dim === dim && p.group === group,
      );
      const confounded =
        recent(xs) >= 0.7 && recent(inDim) <= 0.4
          ? "most of these posts are from the last 7 days, so timing may explain part of it"
          : undefined;
      const strength = strengthOf(
        Math.min(xs.length, rest.length),
        before?.direction === direction,
        Boolean(confounded),
      )!;
      patterns.push({
        platform,
        dim,
        group,
        n: xs.length,
        rest_n: rest.length,
        breakouts: b,
        rest_breakouts: rb,
        median: med,
        rest_median: rmed,
        uses_rate: usesRate,
        direction,
        strength,
        ...(confounded ? { confounded } : {}),
      });
    }
  }
  const rank = { strong: 0, moderate: 1, weak: 2 } as const;
  const effect = (p: LoopPattern) =>
    p.uses_rate
      ? Math.abs(p.breakouts / p.n - p.rest_breakouts / p.rest_n)
      : Math.abs(Math.log((p.median + 1) / (p.rest_median + 1)));
  patterns.sort(
    (a, b) => rank[a.strength] - rank[b.strength] || effect(b) - effect(a),
  );
  return { patterns, tooFew, bar, breakouts };
}

/** One numbered pattern line, ending with its evidence strength and sample size. */
export function patternLine(p: LoopPattern): string {
  const name = PLATFORM_NAME[p.platform];
  const what = /^(yes|no)$/.test(p.group)
    ? `${p.group === "yes" ? "with" : "without"} ${p.dim}`
    : `${p.dim} ${p.group}`;
  const fig = p.uses_rate
    ? `broke out ${p.breakouts} of ${p.n} times (${pct(p.breakouts / p.n)}) against ${p.rest_breakouts} of ${p.rest_n} (${pct(p.rest_breakouts / p.rest_n)}) for the rest`
    : `got a middle of ${n0(p.median)} views against ${n0(p.rest_median)} for the rest`;
  return `${name}: posts ${what} did ${p.direction} (${fig}). Evidence: ${p.strength}, ${p.n} against ${p.rest_n} posts${p.confounded ? `; capped at moderate, ${p.confounded}` : ""}.`;
}

/** The health checks that found the first report's two biggest problems (spec section 5). */
export function healthChecks(
  platform: LoopPlatform,
  rows: LoopRow[],
  now: Date,
  timeZone: string,
): string[] {
  const name = PLATFORM_NAME[platform];
  const read = rows
    .filter((r) => isShortRow(r) && r.views !== null && age(r, now) >= 24)
    .sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  const out: string[] = [];
  const all = rows.filter(isShortRow);
  const total = all.reduce((s, r) => s + (r.views ?? 0), 0);
  if (all.length >= 5 && total < 50)
    out.push(
      `${name}: ${all.length} posts went out in 28 days and drew ${n0(total)} views in total. Nobody is being shown them.`,
    );
  const last7 = read.filter((r) => age(r, now) < 7 * 24).map((r) => r.views!);
  const before = read.filter((r) => age(r, now) >= 7 * 24).map((r) => r.views!);
  if (
    last7.length >= 5 &&
    before.length >= 5 &&
    median(last7) <= 0.5 * median(before)
  )
    out.push(
      `${name}: the middle post of the last 7 days got ${n0(median(last7))} views against ${n0(median(before))} in the 21 days before (${last7.length} and ${before.length} posts), down by half or more.`,
    );
  const med = median(read.map((r) => r.views!));
  let run: LoopRow[] = [];
  const runs: LoopRow[][] = [];
  for (const r of read) {
    if (med > 0 && r.views! < med / 10) run.push(r);
    else {
      if (run.length >= 3) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 3) runs.push(run);
  const when = (r: LoopRow) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(r.posted_at));
  for (const x of runs)
    out.push(
      `${name}: ${x.length} posts in a row between ${when(x[0]!)} and ${when(x.at(-1)!)} UK got ${n0(Math.min(...x.map((r) => r.views!)))} to ${n0(Math.max(...x.map((r) => r.views!)))} views, under a tenth of the usual ${n0(med)}. A dead window: check the account and whether those posts were shown.`,
    );
  const cap = CAPS[platform];
  if (cap) {
    const perDay = new Map<string, number>();
    for (const r of all.filter((r) => age(r, now) < 7 * 24)) {
      const d = dayKey(new Date(r.posted_at), timeZone);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const most = Math.max(0, ...perDay.values());
    if (most > cap)
      out.push(
        `${name}: up to ${most} posts a day in the last week, over the cap of ${cap} a day.`,
      );
  }
  return out;
}

/** Likely reasons, templated from the Short's traits (no model call). */
export function likelyReason(
  r: LoopRow,
  e: EpisodeInfo | undefined,
  winner: boolean,
): string {
  if (!e) return "not matched to a Short";
  const traits = {
    title: e.title,
    hook: e.hook,
    game: e.game,
    durationSeconds: e.duration,
  };
  const bits: string[] = [];
  if (winner) {
    if (r.search_share !== undefined && r.search_share >= 0.25)
      bits.push(`${pct(r.search_share)} of views from YouTube search`);
    if (/^(why|how)\b/i.test(e.title))
      bits.push(`a "${e.title.split(/\s/)[0]!.toLowerCase()}" Short`);
    if (stakeForYou(traits)) bits.push("a stake for the viewer");
    else if (hasNumber(traits)) bits.push("a number in the title");
    if (strongFandom(traits))
      bits.push(
        `a strong fandom (${strongFandom({ title: e.game }) ? e.game : "named in the title"})`,
      );
    if (e.duration && e.duration <= 35)
      bits.push(`${Math.round(e.duration)} seconds`);
    if (e.lane === "news_breaking") bits.push("breaking");
  } else {
    if (e.duration && e.duration >= 45)
      bits.push(`${Math.round(e.duration)} seconds long`);
    if (["deals", "ranking", "achievements"].includes(e.format))
      bits.push(`${e.format} format`);
    if (!strongFandom(traits) && !stakeForYou(traits))
      bits.push("no stake for the viewer");
    const h = etParts(r.posted_at).hour;
    if (h >= 3 && h < 11)
      bits.push(`posted ${String(h).padStart(2, "0")}:00 ET`);
  }
  return bits.length
    ? bits.slice(0, 3).join(", ")
    : winner
      ? "no single trait stands out"
      : "nothing obvious";
}

// ------------------------------------------------------------------ the report and its JSON

export interface PlatformStatus {
  read: boolean;
  /** Where it was read from, or why it could not be. */
  source: string;
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  gained?: number;
  note?: string;
}

export interface LoopChange {
  date: string;
  lever: string;
  old: string;
  new: string;
  basis: string;
  applied: boolean;
}

export interface NextTest {
  id: string;
  name: string;
  started: string;
  judge_on: string;
  pass_mark: string;
  result?: string;
}

export interface LoopJson {
  version: 1;
  run_at: string;
  window: { start: string; end: string };
  platforms: Record<string, PlatformStatus>;
  matched: Record<string, { matched: number; of: number }>;
  episodes: Record<string, EpisodeInfo>;
  posts: LoopRow[];
  unmatched: Array<{ platform: string; post_id: string; text: string }>;
  patterns: LoopPattern[];
  health: string[];
  /** Hand-kept: phrases never to emit as lessons again. Carried from run to run. */
  lessons_blocklist: string[];
  feedback: {
    lessons: string[];
    posting: {
      tiktok_boost: number;
      instagram_held: string[];
      /** Per capped platform, the lift each favoured trait gets in its daily pick (absent in older reports). */
      favour?: PostingFavour;
    };
    weights: Record<string, number>;
    /** Last week's direction per weight key, so a weight only moves on two runs pointing the same way. */
    weight_signals: Record<string, number>;
  };
  changes: LoopChange[];
  next_test: NextTest;
  /** Subscribers per 1,000 views by series, the line test and the verdicts so far (src/seriesreport.ts); absent in older reports. */
  series?: SeriesJson;
}

/** The test queue: the first is already set by the first report; each runs until judged. */
const TESTS: Array<Omit<NextTest, "started" | "judge_on">> = [
  {
    id: "fit-2026-11",
    name: 'Do "fit" Shorts (35 seconds or under, strong-identity fandom, a stake for the viewer or a number in the first line) break out more often on Instagram and TikTok?',
    pass_mark:
      "the fit group breaks out (1,000 or more Instagram views at 72 hours, 2,000 or more on TikTok) at least twice as often as the rest, with 20 or more Shorts in each group on both platforms",
  },
  {
    id: "question-opener",
    name: "Do Instagram Reels whose caption opens with a question break out more often than those opening on a statement?",
    pass_mark:
      "question openers break out at least 1.5 times as often, with 20 or more Reels in each group",
  },
];
const FIRST_TEST_START = "2026-11-11";

/** A series Short from the switch-on (22 Nov): the fit test leaves it out so the loop reads cleanly. */
export function seriesShort(e: EpisodeInfo | undefined): boolean {
  return (
    !!e &&
    isSeriesTag(e.series) &&
    isSerial(e.series) &&
    e.live_at.slice(0, 10) >= SERIES_START
  );
}

/** The fit test's reading: per platform, fit and not-fit breakouts at the fixed bars, at 72 hours. */
export function judgeFitTest(
  rows: LoopRow[],
  eps: Map<string, EpisodeInfo>,
  since: string,
  now: Date,
): { lines: string[]; verdict: "pass" | "fail" | "too few" } {
  const lines: string[] = [];
  let verdict: "pass" | "fail" | "too few" = "pass";
  for (const p of ["instagram", "tiktok"] as const) {
    const xs = rows.filter(
      (r) =>
        r.platform === p &&
        r.episode_id &&
        r.posted_at >= since &&
        age(r, now) >= MIN_AGE_HOURS &&
        r.views !== null &&
        !seriesShort(eps.get(r.episode_id)),
    );
    const v = (r: LoopRow) => r.views_72h ?? r.views!;
    const fit = xs.filter(
      (r) => features(r, eps.get(r.episode_id!))["fit"] === "yes",
    );
    const rest = xs.filter((r) => !fit.includes(r));
    const fb = fit.filter((r) => v(r) >= TEST_BARS[p]!).length;
    const rb = rest.filter((r) => v(r) >= TEST_BARS[p]!).length;
    lines.push(
      `${PLATFORM_NAME[p]}: fit ${fb} of ${fit.length} broke out${fit.length ? ` (${pct(fb / fit.length)})` : ""}, not fit ${rb} of ${rest.length}${rest.length ? ` (${pct(rb / rest.length)})` : ""}.`,
    );
    if (fit.length < 20 || rest.length < 20) verdict = "too few";
    else if (
      verdict === "pass" &&
      !(fb / fit.length >= 2 * (rb / rest.length) && fb > 0)
    )
      verdict = "fail";
  }
  return { lines, verdict };
}

/** What the next test section says: the running test's reading, its result once judged, or the next one named. */
export function nextTest(
  prev: NextTest | undefined,
  rows: LoopRow[],
  eps: Map<string, EpisodeInfo>,
  now: Date,
): { test: NextTest; lines: string[] } {
  const today = now.toISOString().slice(0, 10);
  const start = (i: number, from: string): NextTest => ({
    ...TESTS[i]!,
    started: from,
    judge_on: new Date(Date.parse(from) + 14 * DAY).toISOString().slice(0, 10),
  });
  let test = prev ?? start(0, FIRST_TEST_START);
  const lines: string[] = [];
  if (test.id === TESTS[0]!.id) {
    const j = judgeFitTest(rows, eps, test.started, now);
    lines.push(
      `**${test.name}**`,
      "",
      `Started ${test.started}. Pass mark: ${test.pass_mark}.`,
      "",
      ...j.lines.map((l) => `- ${l}`),
    );
    if (today >= test.judge_on) {
      if (j.verdict === "too few") {
        test = {
          ...test,
          judge_on: new Date(Date.parse(test.judge_on) + 7 * DAY)
            .toISOString()
            .slice(0, 10),
        };
        lines.push(
          "",
          `Result: too few Shorts in a group to judge, so it runs another week and nothing changes. Judged again on ${test.judge_on}.`,
        );
      } else {
        lines.push(
          "",
          `Result: **${j.verdict === "pass" ? "passed" : "did not pass"}**. ${j.verdict === "pass" ? "Proposal: the picker sends only fit Shorts to Instagram and TikTok (needs ANALYTICS_LOOP_POSTING and the owner's yes)." : "No change to the picker."}`,
        );
        const next = start(1, today);
        lines.push(
          "",
          `Next: **${next.name}** Pass mark: ${next.pass_mark}. Judged on ${next.judge_on}.`,
        );
        test = next;
      }
    } else lines.push("", `Judged on ${test.judge_on}.`);
    return { test, lines };
  }
  // Any later test in the queue is reported by its own numbers; the job names it, Martin's chat judges it.
  lines.push(
    `**${test.name}**`,
    "",
    `Started ${test.started}. Pass mark: ${test.pass_mark}. Judged on ${test.judge_on}.`,
  );
  if (test.id === "question-opener") {
    const xs = comparable(
      rows.filter((r) => r.platform === "instagram"),
      now,
    ).rows.filter((r) => r.posted_at >= test.started);
    const q = xs.filter((r) => /\?\s*$/.test(firstLine(r.text)));
    const s = xs.filter((r) => !q.includes(r));
    const bq = q.filter((r) => r.v >= TEST_BARS.instagram!).length;
    const bs = s.filter((r) => r.v >= TEST_BARS.instagram!).length;
    lines.push(
      "",
      `- Question openers ${bq} of ${q.length} broke out, statements ${bs} of ${s.length}.`,
    );
  }
  return { test, lines };
}

// ------------------------------------------------------------------ feedback (spec section 6)

/** Tier 1: at most six advice lines, each from a strong or moderate pattern, dated, never a blocked phrase. */
export function lessonLines(
  patterns: LoopPattern[],
  watch: Array<{
    platform: LoopPlatform;
    breakout: number;
    rest: number;
    n: number;
    rest_n: number;
  }>,
  subs: { format: string; rate: number; rest: number; n: number } | undefined,
  blocklist: string[],
  date: string,
): string[] {
  const ok = (p: LoopPattern) => p.strength !== "weak";
  const out: string[] = [];
  for (const p of patterns
    .filter(
      (p) => ok(p) && p.direction === "better" && p.platform !== "youtube",
    )
    .slice(0, 2))
    out.push(`${patternLine(p)} (weekly report ${date})`);
  for (const w of watch)
    if (Math.min(w.n, w.rest_n) >= 15)
      out.push(
        `${PLATFORM_NAME[w.platform]} posts that broke out were watched ${w.breakout.toFixed(1)} s on average; the rest ${w.rest.toFixed(1)} s (${w.n} against ${w.rest_n}). Hold attention past the first ${Math.round(w.breakout)} seconds (weekly report ${date}).`,
      );
  for (const p of patterns
    .filter((p) => ok(p) && p.uses_rate && p.breakouts === 0 && p.n >= 15)
    .slice(0, 2))
    out.push(
      `0 of ${p.n} ${p.dim} ${p.group} posts broke out on ${PLATFORM_NAME[p.platform]}: stop leaning on them there (weekly report ${date}).`,
    );
  if (subs && subs.n >= 15)
    out.push(
      `${subs.format} Shorts brought ${subs.rate.toFixed(1)} subscribers per 1,000 views against ${subs.rest.toFixed(1)} for the rest (${subs.n} Shorts): subscribers are the goal (weekly report ${date}).`,
    );
  const blocked = blocklist.map((b) => b.toLowerCase()).filter(Boolean);
  return out
    .filter((l) => !blocked.some((b) => l.toLowerCase().includes(b)))
    .slice(0, 6);
}

/** Tier 2, TikTok: the boost for fit Shorts, only on 30 or more a side with five or more breakouts. */
export function tiktokBoost(p: {
  fit: number;
  fitBreaks: number;
  rest: number;
  restBreaks: number;
}): number {
  if (
    Math.min(p.fit, p.rest) < MIN_AUTO ||
    p.fitBreaks + p.restBreaks < MIN_BREAKOUTS
  )
    return 0;
  const a = p.fitBreaks / p.fit;
  const b = p.restBreaks / p.rest;
  if (b === 0) return a > 0 ? 0.25 : 0;
  const ratio = a / b;
  return ratio >= 2 ? 0.25 : ratio >= 1.25 ? 0.1 : 0;
}

/**
 * Tier 2, Instagram: the formats (and "45s+") with 30 or more Reels and not one breakout, on a platform that does
 * have breakouts. At most one new hold a week; earlier holds stay while their numbers still support them.
 */
export function instagramHolds(
  groups: Array<{ key: string; n: number; breakouts: number }>,
  platformBreakouts: number,
  previous: string[],
): string[] {
  if (platformBreakouts < MIN_BREAKOUTS) return [];
  const supported = groups
    .filter((g) => g.n >= MIN_AUTO && g.breakouts === 0)
    .map((g) => g.key);
  const kept = previous.filter((k) => supported.includes(k));
  const fresh = supported.filter((k) => !kept.includes(k)).slice(0, 1);
  return [...kept, ...fresh];
}

/**
 * Tier 2, story picks: one multiplier per (story type, format) from YouTube 24-hour views, subscribers per 1,000
 * views counting double. A key moves by at most 0.05, inside 0.85 to 1.15, only with 30 or more Shorts on each
 * side and last week pointing the same way; only the one key with the clearest signal moves in a week.
 */
export function storyWeights(
  groups: Array<{ key: string; n: number; rest_n: number; score: number }>,
  previous: Record<string, number>,
  lastSignals: Record<string, number>,
): {
  weights: Record<string, number>;
  signals: Record<string, number>;
  moved?: { key: string; from: number; to: number; score: number };
} {
  const signals: Record<string, number> = {};
  for (const g of groups)
    if (Math.min(g.n, g.rest_n) >= MIN_AUTO)
      signals[g.key] = g.score > 1.1 ? 1 : g.score < 0.9 ? -1 : 0;
  const weights = { ...previous };
  const ready = groups
    .filter((g) => signals[g.key] && signals[g.key] === lastSignals[g.key])
    .sort((a, b) => Math.abs(b.score - 1) - Math.abs(a.score - 1));
  for (const g of ready) {
    const from = weights[g.key] ?? 1;
    const to =
      Math.round(
        Math.min(
          WEIGHT_MAX,
          Math.max(WEIGHT_MIN, from + signals[g.key]! * WEIGHT_STEP),
        ) * 100,
      ) / 100;
    if (to === from) continue;
    weights[g.key] = to;
    return {
      weights,
      signals,
      moved: { key: g.key, from, to, score: g.score },
    };
  }
  return { weights, signals };
}

// ------------------------------------------------------------------ the platform readers

export interface IgMedia {
  id: string;
  caption: string;
  product: string;
  timestamp: string;
  likes?: number;
  comments?: number;
}
export interface FbReel {
  id: string;
  postId?: string;
  description: string;
  created: string;
  views?: number;
  likes?: number;
  comments?: number;
}

export interface LoopSources {
  youtube?: {
    stats?(ids: string[]): Promise<Map<string, VideoStats>>;
    channelReport?(
      start: string,
      end: string,
    ): Promise<Array<Record<string, number | string>>>;
    trafficSourcesBatch?(
      ids: string[],
      start: string,
      end: string,
    ): Promise<Record<string, Record<string, number>>>;
  };
  instagram?: {
    list(since: Date): Promise<IgMedia[]>;
    insights(id: string, product: string): Promise<SocialNumbers>;
    followers?(): Promise<number | undefined>;
  };
  facebook?: {
    list(since: Date): Promise<FbReel[]>;
    pageViews28(): Promise<number | undefined>;
    followers?(): Promise<number | undefined>;
    insights?(id: string): Promise<SocialNumbers>;
  };
  tiktok?: (since: Date) => Promise<BufferPostStat[]>;
  threads?: (since: Date) => Promise<number>;
}

const int = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v)
    : typeof v === "string" && v !== "" && Number.isFinite(Number(v))
      ? Math.round(Number(v))
      : undefined;

/** Feed posts (the daily question pictures) refuse the two Reel metrics, so they are never asked for there. */
export const igMetricsFor = (product: string): readonly string[] =>
  product === "REELS"
    ? IG_MEDIA_METRICS
    : IG_MEDIA_METRICS.filter((m) => !m.startsWith("ig_reels_"));

/** The live readers, from the tokens in cfg (never logged). A platform with no login is simply absent. */
export function liveLoopSources(
  cfg: Config,
  youtube: NonNullable<LoopSources["youtube"]>,
  fetchFn: typeof fetch = fetch,
): LoopSources {
  const q = (t: string) => `access_token=${encodeURIComponent(t)}`;
  const out: LoopSources = { youtube };
  const pages = async <T>(
    first: string,
    keep: (x: any) => T | undefined,
    older: (x: T) => boolean,
  ): Promise<T[]> => {
    const got: T[] = [];
    let url: string | undefined = first;
    for (let i = 0; url && i < 10; i++) {
      const b = await graphGet(url, fetchFn);
      const items = (b.data ?? [])
        .map(keep)
        .filter((x: T | undefined): x is T => x !== undefined) as T[];
      got.push(...items);
      if (!items.length || older(items.at(-1)!)) break;
      url = b.paging?.next;
    }
    return got;
  };
  if (cfg.instagramToken && cfg.instagramAccountId) {
    const bad = { REELS: new Set<string>(), FEED: new Set<string>() };
    out.instagram = {
      list: (since) =>
        pages<IgMedia>(
          `${GRAPH}/${cfg.instagramAccountId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&limit=50&${q(cfg.instagramToken)}`,
          (x) =>
            x?.id
              ? {
                  id: String(x.id),
                  caption: String(x.caption ?? ""),
                  product: String(x.media_product_type ?? ""),
                  timestamp: String(x.timestamp ?? ""),
                  likes: int(x.like_count),
                  comments: int(x.comments_count),
                }
              : undefined,
          (x) => Date.parse(x.timestamp) < since.getTime(),
        ).then((xs) =>
          xs.filter((x) => Date.parse(x.timestamp) >= since.getTime()),
        ),
      insights: async (id, product) => {
        const v = await insightsDropping(
          (m) =>
            `${GRAPH}/${id}/insights?metric=${m.join(",")}&${q(cfg.instagramToken)}`,
          igMetricsFor(product),
          product === "REELS" ? bad.REELS : bad.FEED,
          fetchFn,
        );
        return {
          views: int(v.views),
          reach: int(v.reach),
          likes: int(v.likes),
          comments: int(v.comments),
          shares: int(v.shares),
          saves: int(v.saved),
          avgWatchSeconds:
            typeof v.ig_reels_avg_watch_time === "number"
              ? Math.round(v.ig_reels_avg_watch_time / 100) / 10
              : undefined,
        };
      },
      followers: async () =>
        int(
          (
            await graphGet(
              `${GRAPH}/${cfg.instagramAccountId}?fields=followers_count,media_count&${q(cfg.instagramToken)}`,
              fetchFn,
            )
          ).followers_count,
        ),
    };
  }
  if (cfg.facebookPageToken && cfg.facebookPageId) {
    out.facebook = {
      list: (since) =>
        pages<FbReel>(
          `${GRAPH}/${cfg.facebookPageId}/video_reels?fields=id,description,created_time,length,permalink_url,views,post_id,likes.summary(true).limit(0),comments.summary(true).limit(0)&limit=50&${q(cfg.facebookPageToken)}`,
          (x) =>
            x?.id
              ? {
                  id: String(x.id),
                  postId: x.post_id ? String(x.post_id) : undefined,
                  description: String(x.description ?? ""),
                  created: String(x.created_time ?? ""),
                  views: int(x.views),
                  likes: int(x.likes?.summary?.total_count),
                  comments: int(x.comments?.summary?.total_count),
                }
              : undefined,
          (x) => Date.parse(x.created) < since.getTime(),
        ).then((xs) =>
          xs.filter((x) => Date.parse(x.created) >= since.getTime()),
        ),
      pageViews28: async () => {
        const b = await graphGet(
          `${GRAPH}/${cfg.facebookPageId}/insights?metric=page_media_view&period=days_28&${q(cfg.facebookPageToken)}`,
          fetchFn,
        );
        return int(b.data?.[0]?.values?.at(-1)?.value);
      },
      followers: async () =>
        int(
          (
            await graphGet(
              `${GRAPH}/${cfg.facebookPageId}?fields=followers_count&${q(cfg.facebookPageToken)}`,
              fetchFn,
            )
          ).followers_count,
        ),
      insights: async (id) => {
        const b = await graphGet(
          `${GRAPH}/${id}/video_insights?${q(cfg.facebookPageToken)}`,
          fetchFn,
        );
        const v: Record<string, unknown> = {};
        for (const d of b?.data ?? [])
          if (d?.name) v[d.name] = d.values?.at(-1)?.value;
        return {
          views: int(v.fb_reels_total_plays) ?? int(v.blue_reels_play_count),
          avgWatchSeconds:
            typeof v.post_video_avg_time_watched === "number"
              ? Math.round(v.post_video_avg_time_watched / 100) / 10
              : undefined,
        };
      },
    };
  }
  if (cfg.bufferApiKey && cfg.bufferTiktokChannel)
    out.tiktok = (since) =>
      bufferPostStats(
        cfg.bufferApiKey,
        cfg.bufferTiktokChannel,
        since,
        fetchFn,
      );
  if (cfg.threadsLoginPath && fs.existsSync(cfg.threadsLoginPath))
    out.threads = async (since) => {
      const login = await threadsLogin(cfg.threadsLoginPath, fetchFn);
      const xs = await pages<{ t: string }>(
        `${THREADS}/me/threads?fields=id,timestamp&limit=100&${q(login.token)}`,
        (x) => (x?.id ? { t: String(x.timestamp ?? "") } : undefined),
        (x) => Date.parse(x.t) < since.getTime(),
      );
      return xs.filter((x) => Date.parse(x.t) >= since.getTime()).length;
    };
  return out;
}

// ------------------------------------------------------------------ the run

/** Reads from the database and every reachable platform, then works it all out. Platforms fail one at a time. */
export async function runAnalyticsLoop(
  db: Db,
  cfg: Config,
  sources: LoopSources,
  now: Date,
): Promise<{ markdown: string; json: LoopJson; files: string[] }> {
  const dir = loopDir(cfg);
  const prev = readPrevious(dir);
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const start = since.toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const status: Record<string, PlatformStatus> = {};
  const notRead = (source: string): PlatformStatus => ({
    read: false,
    source,
    posts: 0,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
  });
  const caveats: string[] = [];

  // ---- the factory's own records
  const epRows = await db.query<{
    id: string;
    lane: string;
    story_hash: string | null;
    youtube_video_id: string;
    script_json: Script | null;
    headline: string | null;
    live_at: string | Date;
    duration: unknown;
    opening: string | null;
    rubric: unknown;
    story_series: string | null;
    has_why: boolean | null;
    has_run: boolean | null;
  }>(
    `SELECT e.id, e.lane, e.story_hash, e.youtube_video_id, e.script_json, e.story_json->>'headline' AS headline, ${LIVE_AT("e")} AS live_at,
            e.assets_json->'durationSeconds' AS duration, e.assets_json->'plan'->'shots'->0->'media'->>'type' AS opening, e.qa_json->'rubric'->'metrics' AS rubric,
            e.story_json->>'series' AS story_series, (e.story_json->'why') IS NOT NULL AS has_why, (e.story_json->>'run') = 'true' AS has_run
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'twin'
        AND ${LIVE_AT("e")} > $1::timestamptz - interval '36 days'`,
    [now],
  );
  const eps = new Map<string, EpisodeInfo>();
  for (const r of epRows) {
    const sc = r.script_json;
    const metrics = (
      typeof r.rubric === "string" ? JSON.parse(r.rubric) : r.rubric
    ) as Array<{ name: string; value: unknown }> | null;
    const metric = (n: string) => {
      const v = metrics?.find((m) => m.name === n)?.value;
      return typeof v === "number" ? v : undefined;
    };
    let captionTitle = "";
    try {
      captionTitle = sc ? polishTitle(sc) : "";
    } catch {
      captionTitle = "";
    }
    const duration = Number(
      typeof r.duration === "string" ? JSON.parse(r.duration) : r.duration,
    );
    eps.set(r.id, {
      id: r.id,
      video: r.youtube_video_id,
      title: sc?.youtube?.title ?? r.headline ?? r.id,
      caption_title: captionTitle || (sc?.youtube?.title ?? ""),
      hook: sc?.hook ?? "",
      headline: sc?.headline ?? r.headline ?? "",
      loop: sc?.loop_line ?? "",
      game: sc?.game_title ?? "",
      lane: r.lane,
      story_type: sc?.is_rumour ? "rumour" : (sc?.story_type ?? "other"),
      format: shortFormat({
        lane: r.lane,
        story_hash: r.story_hash,
        evergreen_format: sc?.evergreen_format,
        is_rumour: sc?.is_rumour,
      }),
      duration:
        Number.isFinite(duration) && duration > 0 ? duration : undefined,
      live_at: new Date(r.live_at).toISOString(),
      opening: r.opening ?? undefined,
      events_per_minute: metric("events_per_minute"),
      wpm: metric("wpm"),
      long: sc?.runtime === "long" || r.lane === "longform",
      series: seriesTagFor(
        {
          lane: r.lane,
          story_json: {
            series: r.story_series ?? undefined,
            why: r.has_why || undefined,
            run: r.has_run || undefined,
          },
        },
        sc,
      ),
      ...(sc?.next_line
        ? { next_line: { arm: sc.next_line.arm, said: sc.next_line.said } }
        : {}),
    });
  }
  const snaps = new Map<
    string,
    Map<string, { views: number; raw: any; at: string }>
  >();
  if (eps.size)
    for (const m of await db.query<{
      episode_id: string;
      label: string;
      views: number | string;
      raw: unknown;
      captured_at: string | Date;
    }>(
      `SELECT episode_id, label, views, raw, captured_at FROM video_metrics WHERE episode_id = ANY($1)`,
      [[...eps.keys()]],
    )) {
      const s = snaps.get(m.episode_id) ?? new Map();
      s.set(m.label, {
        views: Number(m.views),
        raw: typeof m.raw === "string" ? JSON.parse(m.raw) : m.raw,
        at: new Date(m.captured_at).toISOString(),
      });
      snaps.set(m.episode_id, s);
    }
  const ledger = new Map<string, string>();
  const fitTags = new Map<string, boolean>();
  for (const v of await db.query<{
    episode_id: string;
    platform: string;
    id: string | null;
    post_id: string | null;
    fit: string | null;
  }>(
    `SELECT episode_id, detail->>'platform' AS platform, detail->>'id' AS id, detail->>'post_id' AS post_id, detail->>'fit' AS fit
       FROM events WHERE kind = 'crosspost' AND episode_id IS NOT NULL AND created_at > $1::timestamptz - interval '40 days'`,
    [now],
  )) {
    if (v.id) ledger.set(`${v.platform}:${v.id}`, v.episode_id);
    if (v.post_id) ledger.set(`${v.platform}:${v.post_id}`, v.episode_id);
    if (v.fit !== null)
      fitTags.set(`${v.platform}:${v.episode_id}`, v.fit === "true");
  }
  const stored = new Map<
    string,
    {
      views: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      saves: number | null;
      avg: number | null;
      at: string;
    }
  >();
  for (const s of await db.query<any>(
    `SELECT platform, post_id, label, views, likes, comments, shares, saves, avg_watch_seconds, captured_at FROM social_metrics
      WHERE post_id <> 'account' AND captured_at > $1::timestamptz - interval '40 days'`,
    [now],
  ))
    stored.set(`${s.platform}:${s.post_id}:${s.label}`, {
      views: s.views === null ? null : Number(s.views),
      likes: s.likes === null ? null : Number(s.likes),
      comments: s.comments === null ? null : Number(s.comments),
      shares: s.shares === null ? null : Number(s.shares),
      saves: s.saves === null ? null : Number(s.saves),
      avg: s.avg_watch_seconds === null ? null : Number(s.avg_watch_seconds),
      at: new Date(s.captured_at).toISOString(),
    });

  const rows: LoopRow[] = [];

  // ---- YouTube: stored snapshots, one Analytics call, traffic sources (stored reach rows first), public counts
  const shortsInWindow = [...eps.values()].filter(
    (e) => Date.parse(e.live_at) >= since.getTime(),
  );
  const ids = shortsInWindow.map((e) => e.video);
  let lifetime = new Map<string, VideoStats>();
  let report = new Map<string, Record<string, number | string>>();
  const ytNotes: string[] = [];
  const headroom = cfg.quotaUnitsPerDay - (await quotaUsed(db, now));
  if (sources.youtube?.stats && headroom >= 500) {
    try {
      for (let i = 0; i < ids.length; i += 50) {
        for (const [k, v] of await sources.youtube.stats(ids.slice(i, i + 50)))
          lifetime.set(k, v);
        await quotaAdd(db, now, QUOTA.poll);
      }
    } catch (err) {
      ytNotes.push(
        `public counts not read (${errorMessage(err).slice(0, 80)}), stored snapshots used`,
      );
      lifetime = new Map();
    }
  } else
    ytNotes.push(
      "the quota guard kept the Data API out of it, so stored snapshots were used",
    );
  try {
    if (sources.youtube?.channelReport)
      report = new Map(
        (await sources.youtube.channelReport(start, end)).map((r) => [
          String(r.video),
          r,
        ]),
      );
  } catch (err) {
    ytNotes.push(
      `YouTube Analytics not read (${errorMessage(err).slice(0, 80)})`,
    );
  }
  const traffic = new Map<string, Record<string, number>>();
  for (const e of shortsInWindow) {
    const reach = snaps.get(e.id)?.get("reach")?.raw;
    if (reach && typeof reach === "object")
      traffic.set(e.video, reach as Record<string, number>);
  }
  const missing = ids.filter((id) => !traffic.has(id));
  if (sources.youtube?.trafficSourcesBatch && missing.length)
    try {
      for (let i = 0; i < missing.length && i < 8 * 25; i += 25)
        for (const [k, v] of Object.entries(
          await sources.youtube.trafficSourcesBatch(
            missing.slice(i, i + 25),
            start,
            end,
          ),
        ))
          traffic.set(k, v);
    } catch (err) {
      ytNotes.push(
        `traffic sources read for ${traffic.size} of ${ids.length} Shorts (${errorMessage(err).slice(0, 60)})`,
      );
    }
  let longViews = 0;
  let longCount = 0;
  for (const e of shortsInWindow) {
    const s = snaps.get(e.id);
    const life = lifetime.get(e.video);
    const rep = report.get(e.video);
    // Only the age snapshots carry public views (retention, reach and curve rows count other things).
    const latest = [...(s?.entries() ?? [])]
      .filter(([label]) => AGE_LABELS.includes(label))
      .map(([, x]) => x)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    const privacy =
      life?.privacyStatus ||
      (latest?.raw?.privacyStatus as string | undefined) ||
      "public";
    if (privacy !== "public") continue; // private and unlisted uploads stay out of the report
    const views =
      life?.views ?? (rep ? Number(rep.views) : undefined) ?? latest?.views;
    if (e.long) {
      longCount++;
      longViews += views ?? 0;
      continue;
    }
    const ret = s?.get("retention")?.raw;
    const src = traffic.get(e.video);
    const srcTotal = src
      ? Object.values(src).reduce((a, b) => a + Number(b), 0)
      : 0;
    rows.push({
      platform: "youtube",
      post_id: e.video,
      kind: "short",
      episode_id: e.id,
      match: "self",
      posted_at: e.live_at,
      captured_at: life ? now.toISOString() : (latest?.at ?? now.toISOString()),
      text: e.title,
      views: views ?? null,
      views_1h: s?.get("1h")?.views,
      views_3h: s?.get("3h")?.views,
      views_24h: s?.get("24h")?.views,
      views_72h: s?.get("72h")?.views,
      likes: life?.likes ?? (rep ? Number(rep.likes) : undefined),
      comments: life?.comments ?? (rep ? Number(rep.comments) : undefined),
      shares: rep ? Number(rep.shares) : undefined,
      subs: rep
        ? Number(rep.subscribersGained)
        : ret
          ? Number(ret.subscribersGained)
          : undefined,
      viewed_pct: rep
        ? Number(rep.averageViewPercentage)
        : ret
          ? Number(ret.avgViewPercent)
          : undefined,
      search_share:
        srcTotal > 0 ? Number(src?.YT_SEARCH ?? 0) / srcTotal : undefined,
    });
  }
  status.youtube = {
    ...tally(rows.filter((r) => r.platform === "youtube")),
    read: true,
    source: `factory records and YouTube Analytics through the stored login${ytNotes.length ? `; ${ytNotes.join("; ")}` : ""}`,
    gained: rows
      .filter((r) => r.platform === "youtube")
      .reduce((a, r) => a + (r.subs ?? 0), 0),
  };

  // ---- Instagram
  if (sources.instagram)
    try {
      const media = await sources.instagram.list(since);
      for (const m of media) {
        const product = m.product || "REELS";
        const final = stored.get(`instagram:${m.id}:7d`);
        let n: SocialNumbers | undefined;
        if (final && final.views !== null)
          n = {
            views: final.views,
            likes: final.likes ?? undefined,
            comments: final.comments ?? undefined,
            shares: final.shares ?? undefined,
            saves: final.saves ?? undefined,
            avgWatchSeconds: final.avg ?? undefined,
          };
        else
          n = await sources.instagram
            .insights(m.id, product)
            .catch(() => undefined);
        rows.push({
          platform: "instagram",
          post_id: m.id,
          kind: product === "REELS" ? "reel" : "feed",
          posted_at: new Date(m.timestamp).toISOString(),
          captured_at:
            final && final.views !== null ? final.at : now.toISOString(),
          text: m.caption,
          views: n?.views ?? null,
          views_24h: stored.get(`instagram:${m.id}:24h`)?.views ?? undefined,
          views_72h: stored.get(`instagram:${m.id}:72h`)?.views ?? undefined,
          likes: n?.likes ?? m.likes,
          comments: n?.comments ?? m.comments,
          shares: n?.shares,
          saves: n?.saves,
          avg_watch_s: n?.avgWatchSeconds,
        });
      }
      const followers = await sources.instagram
        .followers?.()
        .catch(() => undefined);
      status.instagram = {
        ...tally(rows.filter((r) => r.platform === "instagram")),
        read: true,
        source: "Meta Graph API",
        ...(followers !== undefined
          ? { note: `${n0(followers)} followers` }
          : {}),
      };
    } catch (err) {
      status.instagram = notRead(
        `not read: ${errorMessage(err).slice(0, 120)}`,
      );
    }
  else status.instagram = notRead("not read: no Instagram login");

  // ---- Facebook: the list plus the Page total; per-Reel calls only once the Page has an audience
  let fbPageViews: number | undefined;
  if (sources.facebook)
    try {
      const reels = await sources.facebook.list(since);
      fbPageViews = await sources.facebook.pageViews28().catch(() => undefined);
      const perReel =
        (fbPageViews ?? 0) >= FACEBOOK_REEL_CALLS_FROM &&
        sources.facebook.insights;
      for (const r of reels) {
        const n = perReel
          ? await sources.facebook.insights!(r.id).catch(() => undefined)
          : undefined;
        rows.push({
          platform: "facebook",
          post_id: r.id,
          kind: "reel",
          posted_at: new Date(r.created).toISOString(),
          captured_at: now.toISOString(),
          text: r.description,
          views: n?.views ?? r.views ?? null,
          views_72h: stored.get(`facebook:${r.id}:72h`)?.views ?? undefined,
          likes: r.likes,
          comments: r.comments,
          avg_watch_s: n?.avgWatchSeconds,
        });
        // The ledger may hold the Reel's post id instead of its video id.
        const viaPost = r.postId
          ? ledger.get(`facebook:${r.postId}`)
          : undefined;
        if (viaPost && !ledger.has(`facebook:${r.id}`))
          ledger.set(`facebook:${r.id}`, viaPost);
      }
      status.facebook = {
        ...tally(rows.filter((r) => r.platform === "facebook")),
        read: true,
        source: `Meta Graph API (Reel list${fbPageViews !== undefined ? `, Page media views in 28 days ${n0(fbPageViews)}` : ""}${perReel ? ", per-Reel insights" : ""})`,
      };
    } catch (err) {
      status.facebook = notRead(`not read: ${errorMessage(err).slice(0, 120)}`);
    }
  else status.facebook = notRead("not read: no Facebook login");

  // ---- TikTok through Buffer (only Pulse's channel): a post under a day old is "no reading yet", not zero
  if (sources.tiktok)
    try {
      const posts = await sources.tiktok(since);
      let pending = 0;
      for (const p of posts) {
        if (!p.sentAt) continue; // drafts and queued posts never went out
        const n = bufferNumbers(p, now);
        if (!n) pending++;
        rows.push({
          platform: "tiktok",
          post_id: `buffer:${p.id}`,
          kind: "reel",
          posted_at: p.sentAt!.toISOString(),
          captured_at: p.metricsUpdatedAt?.toISOString() ?? now.toISOString(),
          text: p.text,
          views: n?.views ?? null,
          views_72h:
            stored.get(`tiktok:buffer:${p.id}:72h`)?.views ?? undefined,
          likes: n?.likes,
          comments: n?.comments,
          shares: n?.shares,
          avg_watch_s: n?.avgWatchSeconds,
        });
      }
      status.tiktok = {
        ...tally(rows.filter((r) => r.platform === "tiktok")),
        read: true,
        source: "Buffer API",
        ...(pending
          ? {
              note: `${pending} post${pending === 1 ? "" : "s"} under a day old or not yet refreshed by Buffer: no reading yet`,
            }
          : {}),
      };
    } catch (err) {
      status.tiktok = notRead(`not read: ${errorMessage(err).slice(0, 120)}`);
    }
  else status.tiktok = notRead("not read: Buffer is not set up");

  if (sources.threads)
    try {
      const n = await sources.threads(since);
      status.threads = {
        ...notRead(
          "post list only: the login lacks the insights permission (needs reconnect)",
        ),
        posts: n,
      };
    } catch (err) {
      status.threads = notRead(`not read: ${errorMessage(err).slice(0, 120)}`);
    }
  else status.threads = notRead("not read: not connected");
  status.x = notRead(
    cfg.crosspost.x ? "not read: no reader for X" : "off: not posting",
  );
  status.bluesky = notRead("off: not posting");

  // ---- match and analyse
  for (const r of rows) {
    const id = r.episode_id ?? ledger.get(`${r.platform}:${r.post_id}`);
    if (id && fitTags.has(`${r.platform}:${id}`))
      r.fit_tag = fitTags.get(`${r.platform}:${id}`);
  }
  const matched = matchRows(rows, [...eps.values()], ledger);
  for (const r of matched.rows)
    if (
      r.episode_id &&
      r.fit_tag === undefined &&
      fitTags.has(`${r.platform}:${r.episode_id}`)
    )
      r.fit_tag = fitTags.get(`${r.platform}:${r.episode_id}`);
  const all = matched.rows;
  const matchCounts: LoopJson["matched"] = {};
  for (const p of LOOP_PLATFORMS.slice(1)) {
    const xs = all.filter((r) => r.platform === p && r.kind !== "feed");
    matchCounts[p] = {
      matched: xs.filter((r) => r.episode_id).length,
      of: xs.length,
    };
  }

  const patterns: LoopPattern[] = [];
  const tooFew: string[] = [];
  const health: string[] = [];
  const breakouts: Record<
    string,
    {
      bar: number;
      n: number;
      rule: string;
      rows: Array<LoopRow & { v: number }>;
    }
  > = {};
  for (const p of LOOP_PLATFORMS) {
    if (!status[p]?.read) continue;
    const mine = all.filter((r) => r.platform === p);
    const cmp = comparable(mine, now);
    const pp = platformPatterns(p, cmp.rows, eps, prev?.patterns ?? [], now);
    patterns.push(...pp.patterns);
    tooFew.push(...pp.tooFew.map((t) => `${PLATFORM_NAME[p]} ${t}`));
    breakouts[p] = {
      bar: pp.bar,
      n: pp.breakouts,
      rule: cmp.rule,
      rows: cmp.rows,
    };
    health.push(...healthChecks(p, mine, now, cfg.timezone));
    if (cmp.rule === "latest" && cmp.rows.length)
      caveats.push(
        `${PLATFORM_NAME[p]} is compared on each post's latest reading (posts 72 hours old or more), since too few have a stored 72-hour reading.`,
      );
  }
  if (
    status.facebook?.read &&
    fbPageViews !== undefined &&
    fbPageViews < FACEBOOK_REEL_CALLS_FROM
  )
    caveats.push(
      `Facebook per-Reel insights stay off until the Page passes ${FACEBOOK_REEL_CALLS_FROM} media views in 28 days (now ${n0(fbPageViews)}).`,
    );

  // Cross platform: rank correlation with YouTube and the rank gaps.
  const yt = new Map(
    all
      .filter((r) => r.platform === "youtube" && r.views !== null)
      .map((r) => [r.episode_id!, r]),
  );
  const crossLines: string[] = [];
  for (const p of ["instagram", "tiktok", "facebook"] as const) {
    const pairs = (breakouts[p]?.rows ?? []).filter(
      (r) => r.episode_id && yt.has(r.episode_id),
    );
    const rho = spearman(
      pairs.map((r) => yt.get(r.episode_id!)!.views!),
      pairs.map((r) => r.v),
    );
    const s = strengthOf(pairs.length, true);
    if (rho !== undefined && s)
      crossLines.push(
        `${PLATFORM_NAME[p]} against YouTube: rank correlation ${rho.toFixed(2)} over ${pairs.length} Shorts (1 is the same order, 0 no link). Evidence: ${s}, ${pairs.length} Shorts.`,
      );
    if (pairs.length >= 6) {
      const gaps = rankGaps(
        pairs.map((r) => ({
          title: eps.get(r.episode_id!)!.title,
          hook: "",
          question: "",
          ytViews: yt.get(r.episode_id!)!.views!,
          views: r.v,
        })),
      );
      const over = gaps
        .filter((g) => g.gap >= 0.25)
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 3);
      if (over.length)
        crossLines.push(
          `Did better on ${PLATFORM_NAME[p]} than their YouTube rank: ${over.map((g) => `"${g.title}" (${n0(g.views)} there, ${n0(g.ytViews)} on YouTube)`).join("; ")}.`,
        );
    }
  }
  // Watch time and early signals.
  const watch: Array<{
    platform: LoopPlatform;
    breakout: number;
    rest: number;
    n: number;
    rest_n: number;
  }> = [];
  for (const p of ["instagram", "tiktok"] as const) {
    const b = breakouts[p];
    if (!b || b.n < MIN_BREAKOUTS) continue;
    const w = b.rows.filter((r) => r.avg_watch_s !== undefined);
    const hi = w.filter((r) => r.v >= b.bar).map((r) => r.avg_watch_s!);
    const lo = w.filter((r) => r.v < b.bar).map((r) => r.avg_watch_s!);
    if (hi.length >= MIN_BREAKOUTS && lo.length >= MIN_PATTERN)
      watch.push({
        platform: p,
        breakout: hi.reduce((a, x) => a + x, 0) / hi.length,
        rest: lo.reduce((a, x) => a + x, 0) / lo.length,
        n: hi.length,
        rest_n: lo.length,
      });
  }
  const signalLines: string[] = [];
  const signal = (
    label: string,
    p: LoopPlatform,
    xs: Array<{ x: number; v: number }>,
  ) => {
    const rho = spearman(
      xs.map((a) => a.x),
      xs.map((a) => a.v),
    );
    const s = strengthOf(xs.length, true);
    if (rho !== undefined && s)
      signalLines.push(
        `${PLATFORM_NAME[p]}: ${label} against views, rank correlation ${rho.toFixed(2)} (${xs.length} posts). Evidence: ${s}.`,
      );
  };
  const ytRows = breakouts.youtube?.rows ?? [];
  signal(
    "views at 3 hours",
    "youtube",
    ytRows
      .filter((r) => r.views_3h !== undefined)
      .map((r) => ({ x: r.views_3h!, v: r.views_24h ?? r.v })),
  );
  signal(
    "average viewed %",
    "youtube",
    ytRows
      .filter((r) => r.viewed_pct !== undefined)
      .map((r) => ({ x: r.viewed_pct!, v: r.v })),
  );
  signal(
    "on-screen events per minute",
    "youtube",
    ytRows
      .filter((r) => eps.get(r.episode_id!)?.events_per_minute !== undefined)
      .map((r) => ({ x: eps.get(r.episode_id!)!.events_per_minute!, v: r.v })),
  );
  signal(
    "words per minute",
    "youtube",
    ytRows
      .filter((r) => eps.get(r.episode_id!)?.wpm !== undefined)
      .map((r) => ({ x: eps.get(r.episode_id!)!.wpm!, v: r.v })),
  );
  for (const p of ["instagram", "tiktok"] as const) {
    const xs = breakouts[p]?.rows ?? [];
    signal(
      "average watch seconds",
      p,
      xs
        .filter((r) => r.avg_watch_s !== undefined)
        .map((r) => ({ x: r.avg_watch_s!, v: r.v })),
    );
    signal(
      "watch share (average watch over length)",
      p,
      xs
        .filter(
          (r) =>
            r.avg_watch_s !== undefined &&
            eps.get(r.episode_id ?? "")?.duration,
        )
        .map((r) => ({
          x: r.avg_watch_s! / eps.get(r.episode_id!)!.duration!,
          v: r.v,
        })),
    );
    signal(
      "shares per 1,000 views",
      p,
      xs
        .filter((r) => r.shares !== undefined && r.v > 0)
        .map((r) => ({ x: (1000 * r.shares!) / r.v, v: r.v })),
    );
  }
  // Subscribers by format (YouTube): the goal.
  const subsBy = new Map<string, { subs: number; views: number; n: number }>();
  for (const r of ytRows) {
    if (r.subs === undefined) continue;
    const f = eps.get(r.episode_id!)!.format;
    const t = subsBy.get(f) ?? { subs: 0, views: 0, n: 0 };
    t.subs += r.subs;
    t.views += r.views ?? 0;
    t.n++;
    subsBy.set(f, t);
  }
  const subsTotal = [...subsBy.values()].reduce(
    (a, t) => ({
      subs: a.subs + t.subs,
      views: a.views + t.views,
      n: a.n + t.n,
    }),
    { subs: 0, views: 0, n: 0 },
  );
  const subsBest = [...subsBy.entries()]
    .filter(
      ([, t]) =>
        t.n >= MIN_PATTERN && t.views > 0 && subsTotal.n - t.n >= MIN_PATTERN,
    )
    .map(([format, t]) => ({
      format,
      rate: (1000 * t.subs) / t.views,
      rest:
        (1000 * (subsTotal.subs - t.subs)) /
        Math.max(1, subsTotal.views - t.views),
      n: t.n,
    }))
    .sort((a, b) => b.rate - a.rate)[0];
  const subsLine =
    subsBest && subsBest.rate >= 1.5 * subsBest.rest && subsBest.rate > 0
      ? `YouTube: ${subsBest.format} Shorts brought ${subsBest.rate.toFixed(1)} subscribers per 1,000 views against ${subsBest.rest.toFixed(1)} for the rest (${subsBest.n} Shorts, ${subsTotal.subs} subscribers in all). Evidence: ${strengthOf(subsBest.n, true) ?? "too few"}.`
      : undefined;

  // ---- feedback
  const date = end;
  const blocklist = prev?.lessons_blocklist ?? [];
  const lessons = lessonLines(
    patterns,
    watch,
    subsBest && subsBest.rate >= 1.5 * subsBest.rest ? subsBest : undefined,
    blocklist,
    date,
  );
  const tk = breakouts.tiktok;
  const fitSplit = (tk?.rows ?? [])
    .filter((r) => r.episode_id)
    .map((r) => ({
      fit: features(r, eps.get(r.episode_id!))["fit"] === "yes",
      hit: r.v >= (tk?.bar ?? Infinity),
    }));
  const boost = tiktokBoost({
    fit: fitSplit.filter((x) => x.fit).length,
    fitBreaks: fitSplit.filter((x) => x.fit && x.hit).length,
    rest: fitSplit.filter((x) => !x.fit).length,
    restBreaks: fitSplit.filter((x) => !x.fit && x.hit).length,
  });
  const ig = breakouts.instagram;
  const igGroups = new Map<
    string,
    { key: string; n: number; breakouts: number }
  >();
  for (const r of (ig?.rows ?? []).filter((r) => r.episode_id)) {
    const e = eps.get(r.episode_id!)!;
    for (const k of heldKeys(e.format, e.duration)) {
      const g = igGroups.get(k) ?? { key: k, n: 0, breakouts: 0 };
      g.n++;
      if (r.v >= ig!.bar) g.breakouts++;
      igGroups.set(k, g);
    }
  }
  const held = instagramHolds(
    [...igGroups.values()],
    ig?.n ?? 0,
    prev?.feedback.posting.instagram_held ?? [],
  );
  // Capped platforms' daily picks (src/social/crosspost.ts): a trait (the fit test, a "why" story, a strong
  // fandom) whose Shorts broke out at least 1.25 times as often as the rest there lifts its rank, by the TikTok
  // boost's rule. TikTok keeps its own fit boost above.
  const favour: PostingFavour = {};
  const favourBasis: string[] = [];
  for (const p of ["instagram", "facebook"]) {
    const b = breakouts[p];
    if (!b) continue;
    const split = b.rows
      .filter((r) => r.episode_id && eps.get(r.episode_id))
      .map((r) => {
        const f = features(r, eps.get(r.episode_id!));
        return {
          fit: f["fit"] === "yes",
          why: f["format"] === "why",
          strong_fandom: f["strong-identity fandom"] === "yes",
          hit: r.v >= b.bar,
        };
      });
    for (const k of FAVOUR_KEYS) {
      const has = split.filter((x) => x[k]);
      const rest = split.filter((x) => !x[k]);
      const lift = tiktokBoost({
        fit: has.length,
        fitBreaks: has.filter((x) => x.hit).length,
        rest: rest.length,
        restBreaks: rest.filter((x) => x.hit).length,
      });
      if (!lift) continue;
      (favour[p] ??= {})[k] = lift;
      favourBasis.push(
        `${PLATFORM_NAME[p] ?? p} ${k.replace("_", " ")}: ${has.filter((x) => x.hit).length} of ${has.length} broke out, the rest ${rest.filter((x) => x.hit).length} of ${rest.length}`,
      );
    }
  }
  // Story picks, from YouTube 24-hour views and subscribers per 1,000 (counted double).
  const yt24 = all.filter(
    (r) =>
      r.platform === "youtube" &&
      r.views_24h !== undefined &&
      age(r, now) >= 24,
  );
  const allMed = median(yt24.map((r) => r.views_24h!));
  const allSubs =
    yt24.reduce((a, r) => a + (r.subs ?? 0), 0) /
    Math.max(
      1,
      yt24.reduce((a, r) => a + (r.views ?? 0), 0),
    );
  const byKey = new Map<string, typeof yt24>();
  for (const r of yt24) {
    const e = eps.get(r.episode_id!)!;
    const k = weightKey(e.story_type, e.format);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const weightGroups = [...byKey.entries()].map(([key, xs]) => {
    const viewsRel =
      allMed > 0 ? median(xs.map((r) => r.views_24h!)) / allMed : 1;
    const subsRate =
      xs.reduce((a, r) => a + (r.subs ?? 0), 0) /
      Math.max(
        1,
        xs.reduce((a, r) => a + (r.views ?? 0), 0),
      );
    const subsRel = allSubs > 0 ? subsRate / allSubs : 1;
    return {
      key,
      n: xs.length,
      rest_n: yt24.length - xs.length,
      score: (viewsRel + 2 * subsRel) / 3,
    };
  });
  const sw = storyWeights(
    weightGroups,
    prev?.feedback.weights ?? {},
    prev?.feedback.weight_signals ?? {},
  );

  const changes: LoopChange[] = [];
  const prevPosting = prev?.feedback.posting ?? {
    tiktok_boost: 0,
    instagram_held: [],
  };
  if (boost !== prevPosting.tiktok_boost)
    changes.push({
      date,
      lever: "TikTok fit boost",
      old: pct(prevPosting.tiktok_boost),
      new: pct(boost),
      basis: `fit ${fitSplit.filter((x) => x.fit && x.hit).length} of ${fitSplit.filter((x) => x.fit).length} broke out, the rest ${fitSplit.filter((x) => !x.fit && x.hit).length} of ${fitSplit.filter((x) => !x.fit).length}`,
      applied: cfg.analyticsLoopPosting,
    });
  if (held.join(",") !== prevPosting.instagram_held.join(","))
    changes.push({
      date,
      lever: "Instagram held formats (each still retried 1 post in 5)",
      old: prevPosting.instagram_held.join(", ") || "none",
      new: held.join(", ") || "none",
      basis:
        held
          .map((k) => `${k}: 0 of ${igGroups.get(k)?.n ?? 0} broke out`)
          .join("; ") || "no held format is still supported",
      applied: cfg.analyticsLoopPosting,
    });
  const favourText = (f: PostingFavour | undefined) =>
    Object.entries(f ?? {})
      .flatMap(([p, ks]) =>
        Object.entries(ks).map(
          ([k, v]) => `${PLATFORM_NAME[p] ?? p} ${k.replace("_", " ")} ${pct(v!)}`,
        ),
      )
      .join(", ") || "none";
  if (favourText(favour) !== favourText(prevPosting.favour))
    changes.push({
      date,
      lever: "daily-pick favours on capped platforms",
      old: favourText(prevPosting.favour),
      new: favourText(favour),
      basis: favourBasis.join("; ") || "no trait broke out clearly more often",
      applied: cfg.analyticsLoopPosting,
    });
  if (sw.moved)
    changes.push({
      date,
      lever: `story-pick multiplier ${sw.moved.key.replace("|", ", ")}`,
      old: sw.moved.from.toFixed(2),
      new: sw.moved.to.toFixed(2),
      basis: `score ${sw.moved.score.toFixed(2)} against 1.00 (24-hour views and subscribers per 1,000, subscribers counted double), two runs in the same direction`,
      applied: cfg.analyticsLoopScoring,
    });
  for (const c of changes.filter((c) => c.applied))
    await logEvent(db, null, "analytics_loop_change", { ...c });

  const test = nextTest(prev?.next_test, all, eps, now);
  // Subscribers per 1,000 views by series (format redesign plan items 1 and 11), YouTube Shorts 72 hours or older.
  const series = seriesJson(
    all
      .filter((r) => r.platform === "youtube" && r.kind === "short" && r.episode_id)
      .map((r) => {
        const e = eps.get(r.episode_id!)!;
        return {
          episode_id: e.id,
          posted_at: r.posted_at,
          views: r.views,
          subs: r.subs,
          viewed_pct: r.viewed_pct,
          title: e.title,
          game: e.game,
          series: isSeriesTag(e.series) ? e.series : undefined,
          next_line: e.next_line,
        };
      }),
    now,
  );
  const json: LoopJson = {
    version: 1,
    run_at: now.toISOString(),
    window: { start, end },
    platforms: status,
    matched: matchCounts,
    episodes: Object.fromEntries(eps),
    posts: all,
    unmatched: matched.unmatched.map((r) => ({
      platform: r.platform,
      post_id: r.post_id,
      text: firstLine(r.text).slice(0, 120),
    })),
    patterns,
    health,
    lessons_blocklist: blocklist,
    feedback: {
      lessons,
      // Written whatever the settings say: src/loopfeedback.ts applies each part only while its own setting is on.
      posting: { tiktok_boost: boost, instagram_held: held, favour },
      weights: sw.weights,
      weight_signals: sw.signals,
    },
    changes,
    next_test: test.test,
    series,
  };
  const markdown = renderReport({
    cfg,
    now,
    json,
    prev,
    caveats,
    tooFew,
    crossLines,
    signalLines,
    watch,
    subsLine,
    breakouts,
    longCount,
    longViews,
    testLines: test.lines,
  });
  const files = writeReport(dir, now, cfg.timezone, markdown, json);
  log("info", "analytics loop written", {
    posts: all.length,
    patterns: patterns.length,
    files: files.length,
  });
  return { markdown, json, files };
}

function tally(rows: LoopRow[]): Omit<PlatformStatus, "read" | "source"> {
  const sum = (k: keyof LoopRow) =>
    rows.reduce(
      (a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0),
      0,
    );
  return {
    posts: rows.length,
    views: sum("views"),
    likes: sum("likes"),
    comments: sum("comments"),
    shares: sum("shares"),
    saves: sum("saves"),
  };
}

function readPrevious(dir: string): LoopJson | undefined {
  try {
    const j = JSON.parse(
      fs.readFileSync(path.join(dir, "latest.json"), "utf8"),
    ) as LoopJson;
    return j?.version === 1 ? j : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the three files, each through a temporary name, so a failed run never leaves half a report. */
export function writeReport(
  dir: string,
  now: Date,
  timeZone: string,
  markdown: string,
  json: LoopJson,
): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const put = (name: string, body: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(`${file}.tmp`, body);
    fs.renameSync(`${file}.tmp`, file);
    return file;
  };
  return [
    put(`${dayKey(now, timeZone)}.md`, markdown),
    put("latest.json", `${JSON.stringify(json, null, 1)}\n`),
    put("latest.md", markdown),
  ];
}

// ------------------------------------------------------------------ the markdown (the README's six sections)

interface RenderInput {
  cfg: Pick<
    Config,
    | "timezone"
    | "analyticsLoopLessons"
    | "analyticsLoopPosting"
    | "analyticsLoopScoring"
  >;
  now: Date;
  json: LoopJson;
  prev: LoopJson | undefined;
  caveats: string[];
  tooFew: string[];
  crossLines: string[];
  signalLines: string[];
  watch: Array<{
    platform: LoopPlatform;
    breakout: number;
    rest: number;
    n: number;
    rest_n: number;
  }>;
  subsLine?: string;
  breakouts: Record<
    string,
    {
      bar: number;
      n: number;
      rule: string;
      rows: Array<LoopRow & { v: number }>;
    }
  >;
  longCount: number;
  longViews: number;
  testLines: string[];
}

export function renderReport(x: RenderInput): string {
  const { json, now, cfg } = x;
  const eps = new Map(Object.entries(json.episodes));
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timezone, ...o }).format(
      d,
    );
  const long = (iso: string) =>
    fmt(new Date(iso), { day: "numeric", month: "long", year: "numeric" });
  const short = (iso: string) =>
    fmt(new Date(iso), { day: "numeric", month: "short" });
  const L: string[] = ["# Pulse Gaming: analytics feedback loop", ""];

  // 1. Updated
  L.push(
    "## 1. Updated",
    "",
    `${fmt(now, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${fmt(now, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} UK. Weekly automated run.`,
    "",
    `Covers ${long(json.window.start)} to ${long(json.window.end)} (${WINDOW_DAYS} days). Every number below is a platform reading kept in latest.json with its capture time. Nothing is estimated.`,
    "",
    "| Platform | Read from | Posts | Views in the period | Against last run |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [p, s] of Object.entries(json.platforms)) {
    const before = x.prev?.platforms[p];
    const vs =
      s.read && before?.read
        ? `${s.views >= before.views ? "+" : ""}${n0(s.views - before.views)} views, ${s.posts - before.posts >= 0 ? "+" : ""}${s.posts - before.posts} posts`
        : "first reading";
    const views = s.read
      ? `${n0(s.views)}${p === "youtube" && s.gained !== undefined ? ` (${n0(s.gained)} subscribers gained)` : ""}`
      : "not read";
    L.push(
      `| ${PLATFORM_NAME[p] ?? p} | ${s.source}${s.note ? `; ${s.note}` : ""} | ${s.posts} | ${views} | ${s.read ? vs : "-"} |`,
    );
  }
  if (x.longCount)
    L.push(
      `| YouTube long videos | same | ${x.longCount} | ${n0(x.longViews)} | - |`,
    );
  const m = json.matched;
  L.push(
    "",
    `Matched to their Short: ${
      ["instagram", "facebook", "tiktok"]
        .filter((p) => m[p]?.of)
        .map((p) => `${m[p]!.matched} of ${m[p]!.of} on ${PLATFORM_NAME[p]}`)
        .join(", ") || "nothing to match"
    }. Unmatched posts are listed in latest.json and left out of the cross-platform lines.`,
  );
  const caveats = [
    ...x.caveats,
    "Posts under 72 hours old are left out of winners, losers and patterns.",
  ];
  L.push("", `Caveats: ${caveats.join(" ")}`, "");

  // 2. Winners and 3. Losers
  const winners: string[] = ["## 2. Winners", ""];
  const losers: string[] = ["## 3. Losers", ""];
  for (const p of LOOP_PLATFORMS) {
    const b = x.breakouts[p];
    if (!b || !b.rows.length) continue;
    const vs = b.rows.map((r) => r.v);
    const rows = [...b.rows].sort((a, c) => c.v - a.v);
    const watchHead = p === "youtube" ? "Viewed" : "Avg watch";
    winners.push(
      `**${PLATFORM_NAME[p]}** (${b.rule === "72h" ? "views at 72 hours" : "latest views"}; the middle post gets ${n0(median(vs))}, normal is ${n0(quantile(vs, 0.1))} to ${n0(quantile(vs, 0.9))}; ${b.n} of ${b.rows.length} broke out at ${n0(b.bar)} or more)`,
      "",
      `| Views | ${watchHead} | Short | Likely reason |`,
      "| --- | --- | --- | --- |",
      ...rows.slice(0, 5).map((r) => {
        const e = r.episode_id ? eps.get(r.episode_id) : undefined;
        const w =
          p === "youtube"
            ? r.viewed_pct !== undefined
              ? `${Math.round(r.viewed_pct)}%`
              : "-"
            : r.avg_watch_s !== undefined
              ? `${r.avg_watch_s.toFixed(1)} s`
              : "-";
        return `| ${n0(r.v)} | ${w} | ${(e?.title ?? firstLine(r.text)).replace(/\|/g, "/").slice(0, 70)} (${short(r.posted_at)}) | ${likelyReason(r, e, true)} |`;
      }),
      "",
    );
    const bottom = rows.slice(-5).reverse();
    if (rows.length > 5)
      losers.push(
        `**${PLATFORM_NAME[p]}:** ${bottom.map((r) => `${(r.episode_id ? eps.get(r.episode_id)?.title : undefined) ?? firstLine(r.text).slice(0, 60)} (${n0(r.v)}; ${likelyReason(r, r.episode_id ? eps.get(r.episode_id) : undefined, false)})`).join("; ")}.`,
        "",
      );
  }
  if (winners.length === 2)
    winners.push("No platform had posts old enough to judge.", "");
  if (losers.length === 2)
    losers.push("Too few posts old enough to name losers.", "");
  L.push(...winners, ...losers);

  // 4. Patterns
  L.push("## 4. Patterns", "");
  let k = 0;
  const num = (s: string) => `${++k}. ${s}`;
  L.push(
    "**Health checks**",
    "",
    ...(json.health.length
      ? json.health.map(num)
      : ["Nothing flagged: no platform halved, no dead run of posts, no platform posting to nobody, no cap passed."]),
    "",
  );
  const lines = [
    ...json.patterns.slice(0, 12).map(patternLine),
    ...x.crossLines,
    ...x.watch.map(
      (w) =>
        `${PLATFORM_NAME[w.platform]}: posts that broke out were watched ${w.breakout.toFixed(1)} s on average against ${w.rest.toFixed(1)} s for the rest. Evidence: ${strengthOf(Math.min(w.n, w.rest_n), true) ?? "too few"}, ${w.n} against ${w.rest_n} posts.`,
    ),
    ...(x.subsLine ? [x.subsLine] : []),
    ...x.signalLines,
  ];
  L.push(
    "**What separates breakouts from the rest**",
    "",
    ...(lines.length
      ? lines.map(num)
      : ["Nothing clears the minimum samples yet."]),
    "",
  );
  if (json.series)
    L.push(
      "**Subscribers per 1,000 views by series** (YouTube Shorts 72 hours or older; the control's GTA news apart; TikTok and Instagram give no per-post follows, so they are left out)",
      "",
      ...seriesLines(json.series),
      "",
    );
  if (x.tooFew.length)
    L.push(
      `Too few to judge (under ${MIN_PATTERN} posts): ${x.tooFew.slice(0, 25).join("; ")}.`,
      "",
    );

  // 5. Changes made
  L.push("## 5. Changes made", "");
  const applied = json.changes.filter((c) => c.applied);
  L.push(
    ...(applied.length
      ? applied.map(
          (c) =>
            `- ${c.date}: ${c.lever} from ${c.old} to ${c.new}. Numbers: ${c.basis}.`,
        )
      : ["None applied this run."]),
    "",
  );
  const settings = `Writers' lessons ${cfg.analyticsLoopLessons ? "on" : "off"} (ANALYTICS_LOOP_LESSONS), posting choices ${cfg.analyticsLoopPosting ? "on" : "off"} (ANALYTICS_LOOP_POSTING), story-pick multiplier ${cfg.analyticsLoopScoring ? "on" : "off"} (ANALYTICS_LOOP_SCORING).`;
  L.push(`Feedback settings: ${settings}`, "");
  const proposals: string[] = [
    ...json.changes
      .filter((c) => !c.applied)
      .map(
        (c) =>
          `Would change (its setting is off): ${c.lever} from ${c.old} to ${c.new}. Numbers: ${c.basis}.`,
      ),
    ...(json.feedback.lessons.length
      ? [
          `Writers' lessons this week (${json.feedback.lessons.length} lines${cfg.analyticsLoopLessons ? ", in use" : ", not in use until switched on"}): ${json.feedback.lessons.map((l) => `"${l.replace(/ \(weekly report [^)]*\)$/, "")}"`).join(" ")}`,
        ]
      : []),
    ...proposalLines(json, x.breakouts),
  ];
  L.push(
    "Proposals (never applied by the job):",
    "",
    ...proposals.map((p, i) => `${i + 1}. ${p}`),
    "",
  );

  // 6. Next test
  L.push("## 6. Next test", "", ...x.testLines, "");
  return L.join("\n").replace(/\u2014/g, ",");
}

/** Tier 3: titles and packaging, target lengths, pausing a platform, posting hours, long videos. */
function proposalLines(
  json: LoopJson,
  breakouts: RenderInput["breakouts"],
): string[] {
  const out: string[] = [];
  const fb = json.platforms.facebook;
  if (
    fb?.read &&
    json.health.some(
      (h) => h.startsWith("Facebook:") && /Nobody is being shown/.test(h),
    )
  )
    out.push(
      `Facebook: ${fb.posts} Reels drew ${n0(fb.views)} views in 28 days. Cut to one Reel a day (the best of the day), and Martin checks the Page's status and Reels eligibility once in Meta Business Suite (PC browser).`,
    );
  const longer = json.patterns.find(
    (p) =>
      p.dim === "length" &&
      /45 to 59|60 s plus/.test(p.group) &&
      p.direction === "worse" &&
      p.platform !== "youtube",
  );
  if (longer)
    out.push(
      `Target length: ${PLATFORM_NAME[longer.platform]} ${longer.group} posts did worse (${longer.n} posts, ${longer.strength}). Consider a 35-second cap for news and why Shorts.`,
    );
  const title = json.patterns.find(
    (p) =>
      /title|caption first line/.test(p.dim) &&
      p.direction === "better" &&
      p.platform !== "youtube",
  );
  if (title)
    out.push(
      `Titles and captions: on ${PLATFORM_NAME[title.platform]}, posts ${/^(yes|no)$/.test(title.group) ? `${title.group === "yes" ? "with" : "without"} ${title.dim}` : `whose ${title.dim} is ${title.group}`} did better (${title.n} posts, ${title.strength}). Suggested caption openers in that style there; wording tests go through the YouTube A/B route one at a time, and any change to how cards, thumbnails or on-screen captions look needs Martin's approval on before-and-after frames.`,
    );
  // Posting hours: a move only toward a block with 15+ posts and at least double the busiest block's breakout rate.
  for (const p of ["instagram", "tiktok", "facebook"] as const) {
    const b = breakouts[p];
    if (!b || b.n < MIN_BREAKOUTS) continue;
    const blocks = new Map<string, { n: number; hits: number }>();
    for (const r of b.rows) {
      const k = hourBlock(etParts(r.posted_at).hour);
      const t = blocks.get(k) ?? { n: 0, hits: 0 };
      t.n++;
      if (r.v >= b.bar) t.hits++;
      blocks.set(k, t);
    }
    const [busiest] = [...blocks.entries()].sort((a, c) => c[1].n - a[1].n);
    const better = [...blocks.entries()].find(
      ([k, t]) =>
        busiest &&
        k !== busiest[0] &&
        t.n >= 15 &&
        t.hits / t.n >= 2 * (busiest[1].hits / busiest[1].n) &&
        t.hits > 0,
    );
    if (better && busiest)
      out.push(
        `Posting hours on ${PLATFORM_NAME[p]}: ${better[0]} broke out ${better[1].hits} of ${better[1].n} against ${busiest[1].hits} of ${busiest[1].n} at ${busiest[0]}. Move that platform's window by one hour toward it.`,
      );
  }
  if (!out.some((l) => l.startsWith("Posting hours")))
    out.push(
      "Posting hours: no hour block has 15 or more posts with double the breakout rate of the usual one, so no window moves. Settings left alone.",
    );
  const longs = Object.values(json.episodes).filter((e) => e.long).length;
  if (longs < 20)
    out.push(
      `Long videos: ${longs} in the period, too few to judge (20 needed). No change.`,
    );
  return out;
}

// ------------------------------------------------------------------ the timer

/** True once a week: Monday from 09:00 local (after the weekend's Shorts have their 24-hour readings), when switched on. */
export async function analyticsLoopDue(
  db: Db,
  cfg: Pick<Config, "analyticsLoop" | "timezone">,
  now: Date,
): Promise<string | undefined> {
  if (!cfg.analyticsLoop || weekday(now, cfg.timezone) !== "mon")
    return undefined;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (hour < 9) return undefined;
  const key = dayKey(now, cfg.timezone);
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'analytics_loop_sent'`,
  );
  return row?.value === key ? undefined : key;
}

export async function markAnalyticsLoopSent(
  db: Db,
  key: string,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('analytics_loop_sent', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key],
  );
}
