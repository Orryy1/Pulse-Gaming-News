// The retention test loop (owner, 30 Oct 2026: the channel is polished but nobody is watching). One
// controlled test at a time on the news Shorts: two variants of ONE thing (the hook style first, then the
// title shape, then the cold-open length), given to Shorts alternately as they are written, recorded on the
// episode (assets_json.test), and judged by the factory itself from the retention curves it already captures
// (src/analytics.ts captureCurves and captureRetention). The judge compares the share still watching at
// three seconds (one minus the swipe-away rate) and the average view duration, needs six Shorts a side with
// a curve, and calls a winner only when a bootstrap over the per-Short values says so in 90 of 100 draws.
// The winner becomes the default for every later Short through the settings overrides src/experiments.ts
// already uses; the loser is dropped; the next test starts. Every decision is one plain-English Discord post.
//
// Why a bootstrap: six to twenty Shorts a side with 50-odd views each is too small for a t-test's
// assumptions and too noisy for a bare difference of means. Resampling each side with replacement 2,000
// times and counting how often B's mean beats A's gives a plain "B held more viewers in 94 of 100 draws"
// that the owner can read, with no distribution assumed. The secondary metric (average percentage viewed)
// only stops a winner that holds the first three seconds by losing the rest.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { Episode } from "./episodes.ts";
import type { Script } from "./editorial/schema.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { logEvent } from "./episodes.ts";
import { readOverride, writeOverride } from "./experiments.ts";
import { watchAt } from "./analytics.ts";
import { dayKey } from "./lanes.ts";
import { TAIL_SECONDS } from "./render/plan.ts";
import { log } from "./lib/util.ts";

export type Variant = "A" | "B";

export interface GrowthVariant {
  id: Variant;
  /** How the Discord report names it. */
  label: string;
  /** The rule the writer is given, worded so the "low" and "mid" tiers can follow it and a check can test it. */
  instruction: string;
}

export interface GrowthTest {
  key: string;
  name: string;
  /** What the test compares, in the report's words. */
  what: string;
  variants: [GrowthVariant, GrowthVariant];
}

/**
 * The tests, in the order they run. Each later test starts the moment the one before it has a verdict. The
 * title shape runs last on purpose: titles also feed YouTube search (a fifth of the channel's views), and the
 * judge sees only retention, so that verdict needs the most care and the best-rehearsed loop.
 */
export const GROWTH_TESTS: GrowthTest[] = [
  {
    key: "hook_style",
    name: "hook style",
    what: "a question gap against the stated stake in the opening line",
    variants: [
      {
        id: "A",
        label: "question gap",
        instruction:
          'Hook style for this Short: the hook is one answerable question, ending with "?", with the game or company named in its first five words, and the take answers it plainly in its first sentence. Example of the shape (never the words): "Is Switch 2\'s $80 Zelda really the new normal?" The hook is not a statement.',
      },
      {
        id: "B",
        label: "stated stake",
        instruction:
          'Hook style for this Short: the hook is one statement that gives the news and its stake for the viewer, with the game or company named in its first five words, and no question mark anywhere in it. Example of the shape (never the words): "GTA 6\'s launch trailer is out, and November 19 holds." The hook is not a question.',
      },
    ],
  },
  // The clean frame (31 Oct 2026, src/render/cleanframe.ts): a render-side test, so its variants carry no rule
  // for the writer (an empty instruction is never shown). Listed second so it runs straight after the hook-style
  // test; until then, and after a verdict for A, every Short is clean (SHORTS_CLEAN).
  {
    key: "shorts_clean",
    name: "clean frame",
    what: "full-bleed footage with one overlay at a time against the full header, source line, rule and footer",
    variants: [
      { id: "A", label: "clean frame", instruction: "" },
      { id: "B", label: "full chrome", instruction: "" },
    ],
  },
  {
    key: "cold_open_length",
    name: "cold-open length",
    what: "a 5-7 word hook against a 9-12 word hook",
    variants: [
      {
        id: "A",
        label: "5-7 words",
        instruction:
          "Hook length for this Short: the hook is 5 to 7 words, no more, the news alone; its why goes in the first beat.",
      },
      {
        id: "B",
        label: "9-12 words",
        instruction:
          "Hook length for this Short: the hook is 9 to 12 words, the news and its why in one breath.",
      },
    ],
  },
  {
    key: "title_shape",
    name: "title shape",
    what: "a number-first title against a question title",
    variants: [
      {
        id: "A",
        label: "number first",
        instruction:
          'YouTube title shape for this Short: a statement, never a question, with the game named first and the number that carries the story (a price, a date, a count) in it when the story has one, e.g. "Switch 2 Games Now Cost $80". No question mark in the title.',
      },
      {
        id: "B",
        label: "question",
        instruction:
          'YouTube title shape for this Short: a question the Short answers, ending with "?", with the game named first, e.g. "Is $80 the New Normal for Switch 2?"',
      },
    ],
  },
];

/** Shorts a side with a retention curve before a test can be called. */
export const MIN_EACH = 6;
/** A test assigns variants for at least this long before its first check. */
export const MIN_DAYS = 7;
/** Checks a test gets (one a week) before it is closed as no clear difference. */
export const MAX_CHECKS = 4;
/** The share of bootstrap draws one side must win on the three-second hold to be the winner. */
export const WIN_PROB = 0.9;
/** Points of average percentage viewed a winner may trail the loser by; more and it is not a winner. */
export const PCT_TOLERANCE = 2;
/** The least a winner must lead by on the three-second hold (0.02 = 2 points): a smaller gap is noise, whatever the draws say. */
export const MIN_GAP = 0.02;
/** Bootstrap draws. */
export const DRAWS = 2000;
/** The lanes the tests run on: the news writer's Shorts only. */
export const TEST_LANES = ["news", "news_breaking"];

const STATE_KEY = "growth_tests";
const overrideKey = (key: string) => `override:growth_${key}`;

/** What the episode carries (assets_json.test). */
export interface EpisodeTest {
  key: string;
  variant: Variant;
  label: string;
}

export interface GrowthState {
  current?: { key: string; since: string; checks: number; next?: string };
  done: Array<{ key: string; winner?: Variant; at: string }>;
}

export async function readGrowthState(db: Db): Promise<GrowthState> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [STATE_KEY],
  );
  try {
    if (row) {
      const s = JSON.parse(row.value) as GrowthState;
      if (Array.isArray(s.done)) return s;
    }
  } catch {
    // a damaged record reads as never started
  }
  return { done: [] };
}

async function writeGrowthState(db: Db, state: GrowthState): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify(state)],
  );
}

export const testByKey = (key: string): GrowthTest | undefined =>
  GROWTH_TESTS.find((t) => t.key === key);

/** The test that runs after the ones already done, if any is left. */
export function nextTest(state: GrowthState): GrowthTest | undefined {
  const used = new Set(state.done.map((d) => d.key));
  if (state.current) used.add(state.current.key);
  return GROWTH_TESTS.find((t) => !used.has(t.key));
}

/** "Growth test 2 of 3". */
export const testNumber = (key: string): string =>
  `Growth test ${GROWTH_TESTS.findIndex((t) => t.key === key) + 1} of ${GROWTH_TESTS.length}`;

/** Alternate: the n-th Short assigned to a test (n from 0) gets A, B, A, B. */
export function assignVariant(n: number): Variant {
  return n % 2 === 0 ? "A" : "B";
}

const variantOf = (test: GrowthTest, id: Variant): GrowthVariant =>
  test.variants.find((v) => v.id === id) ?? test.variants[0];

/** How the first post explains a test as it starts. */
export function startNotice(test: GrowthTest, now: Date): string {
  const [a, b] = test.variants;
  return `${testNumber(test.key)} started today: **${test.name}**, ${test.what}. News Shorts take turns: ${a.label}, then ${b.label}, then ${a.label} again. In about two weeks (once each side has ${MIN_EACH} Shorts with a retention curve) the factory says which held viewers through the first 3 seconds, makes it the rule for every later Short, and starts the next test. Nothing else about the Shorts changes. (${dayKey(now, "Europe/London")})`;
}

/**
 * The variant for a news Short being written now: starts the first test when none is running (and says so
 * on Discord), then alternates by how many Shorts the running test already has. Undefined when the tests are
 * off, the lane is not news, or every test has run.
 */
export async function growthAssign(
  db: Db,
  cfg: Pick<Config, "growthTests">,
  now: Date,
  ep: Pick<Episode, "id" | "lane">,
  notify?: (m: DiscordMessage) => Promise<unknown>,
): Promise<EpisodeTest | undefined> {
  if (!cfg.growthTests || !TEST_LANES.includes(ep.lane)) return undefined;
  const state = await readGrowthState(db);
  if (!state.current) {
    const t = nextTest(state);
    if (!t) return undefined;
    state.current = { key: t.key, since: now.toISOString(), checks: 0 };
    await writeGrowthState(db, state);
    log("info", "growth test started", { key: t.key });
    await logEvent(db, null, "growth_test_started", { key: t.key });
    if (notify) await notify({ content: startNotice(t, now) });
  }
  const test = testByKey(state.current.key);
  if (!test) return undefined;
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE assets_json->'test'->>'key' = $1 AND status NOT IN ('failed','rejected')`,
    [test.key],
  );
  const variant = assignVariant(Number(row?.n ?? 0));
  const out = { key: test.key, variant, label: variantOf(test, variant).label };
  await logEvent(db, ep.id, "growth_test", out);
  return out;
}

/** The winners so far: each finished test's default variant, from the settings overrides. */
export async function growthDefaults(
  db: Db,
): Promise<Array<{ test: GrowthTest; variant: Variant }>> {
  const out: Array<{ test: GrowthTest; variant: Variant }> = [];
  for (const test of GROWTH_TESTS) {
    const o = await readOverride(db, overrideKey(test.key));
    if (o === undefined) continue;
    out.push({ test, variant: o >= 1 ? "B" : "A" });
  }
  return out;
}

/** What the writer is told: the finished tests' winners as standing rules, then this Short's variant. */
export function growthNotes(
  current: EpisodeTest | undefined,
  defaults: Array<{ test: GrowthTest; variant: Variant }>,
): string {
  const rules: string[] = [];
  for (const d of defaults)
    if (d.test.key !== current?.key)
      rules.push(variantOf(d.test, d.variant).instruction);
  if (current) {
    const t = testByKey(current.key);
    if (t) rules.push(variantOf(t, current.variant).instruction);
  }
  // A render-side test (the clean frame) has no rule for the writer.
  rules.splice(0, rules.length, ...rules.filter((r) => r.trim()));
  if (!rules.length) return "";
  return `Rules from the channel's own retention tests (follow each one exactly; they override the general shapes above where they differ):\n${rules.map((r) => `- ${r}`).join("\n")}`;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** The problem with a script that did not follow a variant, worded for the rewrite; undefined when it did. */
export function variantProblem(
  key: string,
  variant: Variant,
  script: Pick<Script, "hook" | "youtube">,
): string | undefined {
  const hook = script.hook.trim();
  const title = script.youtube.title.trim();
  switch (key) {
    case "hook_style":
      if (variant === "A" && !hook.endsWith("?"))
        return `The hook "${hook}" is a statement; this Short's rule is one answerable question ending with "?", which the take answers first.`;
      if (variant === "B" && hook.includes("?"))
        return `The hook "${hook}" is a question; this Short's rule is a statement of the news and its stake, with no question mark.`;
      return undefined;
    case "title_shape":
      if (variant === "A" && title.endsWith("?"))
        return `The title "${title}" is a question; this Short's rule is a statement with the game first and the story's number in it.`;
      if (variant === "B" && !title.endsWith("?"))
        return `The title "${title}" is a statement; this Short's rule is a question the Short answers, ending with "?".`;
      return undefined;
    case "cold_open_length": {
      const n = words(hook);
      if (variant === "A" && (n < 5 || n > 7))
        return `The hook is ${n} words; this Short's rule is 5 to 7 words, the news alone.`;
      if (variant === "B" && (n < 9 || n > 12))
        return `The hook is ${n} words; this Short's rule is 9 to 12 words, the news and its why together.`;
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Problems for the rewrite loop: the running test's variant and every finished test's winner, checked on the draft. */
export function growthProblems(
  script: Pick<Script, "hook" | "youtube">,
  current: EpisodeTest | undefined,
  defaults: Array<{ test: GrowthTest; variant: Variant }>,
): string[] {
  const out: string[] = [];
  for (const d of defaults) {
    if (d.test.key === current?.key) continue;
    const p = variantProblem(d.test.key, d.variant, script);
    if (p) out.push(p);
  }
  if (current) {
    const p = variantProblem(current.key, current.variant, script);
    if (p) out.push(p);
  }
  return out;
}

// ---- The judge -----------------------------------------------------------------------------------

/** One published Short in a test, with the numbers the judge uses. */
export interface TestShort {
  id: string;
  variant: Variant;
  /** Share still watching at three seconds (0-1), from the retention curve. */
  hold3: number;
  /** Average percentage viewed (0-100), from the retention row; undefined until captured. */
  pct?: number;
  /** Average view duration in seconds (pct of the Short's length). */
  seconds?: number;
}

type Curve = Array<{ at: number; watch: number; relative: number }>;

/** Every published Short of a test that has a retention curve. */
export async function testShorts(db: Db, key: string): Promise<TestShort[]> {
  const rows = await db.query<{
    id: string;
    variant: string | null;
    duration: string | null;
    curve: unknown;
    retention: unknown;
  }>(
    `SELECT e.id, e.assets_json->'test'->>'variant' AS variant, e.assets_json->>'durationSeconds' AS duration,
            (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'curve' LIMIT 1) AS curve,
            (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention' LIMIT 1) AS retention
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'twin'
        AND e.assets_json->'test'->>'key' = $1`,
    [key],
  );
  const parse = (x: unknown) => (typeof x === "string" ? JSON.parse(x) : x);
  const out: TestShort[] = [];
  for (const r of rows) {
    if (r.variant !== "A" && r.variant !== "B") continue;
    const curve = parse(r.curve) as Curve | null;
    const duration = Number(r.duration ?? 0) + TAIL_SECONDS;
    if (!Array.isArray(curve) || curve.length < 20 || !(duration > 0)) continue;
    const ret = parse(r.retention) as { avgViewPercent?: number } | null;
    const pct =
      ret?.avgViewPercent !== undefined
        ? Number(ret.avgViewPercent)
        : undefined;
    out.push({
      id: r.id,
      variant: r.variant,
      hold3: watchAt(curve, 3, duration),
      pct,
      seconds: pct !== undefined ? (pct / 100) * duration : undefined,
    });
  }
  return out;
}

/** A small seeded generator (mulberry32), so a judgement is the same whenever it is run on the same Shorts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

/**
 * The share of bootstrap draws in which B's mean beats A's: each draw resamples both sides with replacement.
 * 0.5 means no difference; 0.9 and over, or 0.1 and under, is the rule for a winner (WIN_PROB).
 */
export function bootstrapWinProb(
  a: number[],
  b: number[],
  draws = DRAWS,
  seed = 7,
): number {
  if (!a.length || !b.length) return 0.5;
  const r = rng(seed);
  const draw = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)]!;
    return s / xs.length;
  };
  let wins = 0;
  for (let d = 0; d < draws; d++) if (draw(b) > draw(a)) wins++;
  return wins / draws;
}

export interface SideStat {
  n: number;
  hold3: number; // mean share still watching at 3 s (0-1)
  pct: number; // mean average percentage viewed, over Shorts that have it
  seconds: number; // mean average view duration, over Shorts that have it
  withPct: number;
}

export function sideStat(rows: TestShort[]): SideStat {
  const held = rows.filter((r) => r.pct !== undefined);
  return {
    n: rows.length,
    hold3: mean(rows.map((r) => r.hold3)),
    pct: mean(held.map((r) => r.pct!)),
    seconds: mean(held.map((r) => r.seconds ?? 0)),
    withPct: held.length,
  };
}

export type JudgeReason = "win" | "too_few" | "too_close" | "pct_worse";

export interface Judgement {
  winner?: Variant;
  enough: boolean;
  /** P(B holds more at 3 s than A), from the bootstrap. */
  prob: number;
  a: SideStat;
  b: SideStat;
  reason: JudgeReason;
}

/**
 * The rule: six Shorts a side with a curve; the side that holds more viewers at three seconds in 90 of 100
 * bootstrap draws, and by at least 2 points, wins, unless its average percentage viewed trails the other
 * side's by more than 2 points.
 */
export function judgeTest(rows: TestShort[], seed = 7): Judgement {
  const ra = rows.filter((r) => r.variant === "A");
  const rb = rows.filter((r) => r.variant === "B");
  const a = sideStat(ra);
  const b = sideStat(rb);
  const enough = a.n >= MIN_EACH && b.n >= MIN_EACH;
  if (!enough) return { enough, prob: 0.5, a, b, reason: "too_few" };
  const prob = bootstrapWinProb(
    ra.map((r) => r.hold3),
    rb.map((r) => r.hold3),
    DRAWS,
    seed,
  );
  const candidate: Variant | undefined =
    prob >= WIN_PROB ? "B" : prob <= 1 - WIN_PROB ? "A" : undefined;
  if (!candidate || Math.abs(b.hold3 - a.hold3) < MIN_GAP)
    return { enough, prob, a, b, reason: "too_close" };
  const [win, lose] = candidate === "B" ? [b, a] : [a, b];
  // The percentage check needs the figure on both sides; without it the three-second hold decides alone.
  if (win.withPct && lose.withPct && win.pct < lose.pct - PCT_TOLERANCE)
    return { enough, prob, a, b, reason: "pct_worse" };
  return { winner: candidate, enough, prob, a, b, reason: "win" };
}

// ---- The report ----------------------------------------------------------------------------------

const pc = (x: number) => `${Math.round(x * 100)}%`;
const secs = (x: number) => `${x.toFixed(1)} s`;
const shorts = (n: number) => `${n} Short${n === 1 ? "" : "s"}`;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const dayName = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
};
const inHundred = (p: number) => Math.round(p * 100);

function sideLine(v: GrowthVariant, s: SideStat): string {
  if (!s.n) return `- ${v.label}: no Shorts with a retention curve yet`;
  const watched = s.withPct
    ? `, ${secs(s.seconds)} watched on average (${pc(s.pct / 100)} of the Short)`
    : "";
  return `- ${v.label}: ${pc(s.hold3)} still watching at 3 seconds${watched} (${shorts(s.n)})`;
}

/** The Discord verdict, in plain English. `next` is the UK day of the next check when the test goes on. */
export function verdictReport(
  test: GrowthTest,
  j: Judgement,
  o: {
    since: string;
    checks: number;
    next?: string;
    following?: GrowthTest;
    closed?: boolean;
  },
): string {
  const [a, b] = test.variants;
  const lines = [
    `**${testNumber(test.key)}: ${test.name}** (news Shorts since ${dayName(o.since.slice(0, 10))}, judged on YouTube's retention curves; check ${o.checks} of ${MAX_CHECKS})`,
    sideLine(a, j.a),
    sideLine(b, j.b),
  ];
  const nextLine = o.following
    ? `Next test: **${o.following.name}**, ${o.following.what}, starting with the next news Short.`
    : "That was the last test on the list; nothing further starts by itself.";
  if (j.winner) {
    const [win, lose] = j.winner === "A" ? [a, b] : [b, a];
    const wp = j.winner === "B" ? j.prob : 1 - j.prob;
    const ws = j.winner === "A" ? j.a : j.b;
    const ls = j.winner === "A" ? j.b : j.a;
    const watched =
      ws.withPct && ls.withPct
        ? ws.pct >= ls.pct
          ? " and they watched at least as much of each Short"
          : ` and they watched only ${(ls.pct - ws.pct).toFixed(1)} points less of each Short`
        : "";
    lines.push(
      `Verdict: **${win.label} wins.** In ${inHundred(wp)} of 100 resamples the ${win.label} Shorts held more viewers through the first 3 seconds${watched}. Every news Short now follows the ${win.label} rule; ${lose.label} is dropped.`,
      nextLine,
    );
  } else if (o.closed) {
    lines.push(
      `Verdict: **no clear difference after ${MAX_CHECKS} checks** (${test.variants[1].label} ahead in ${inHundred(j.prob)} of 100 resamples). The writer keeps its free choice between the two.`,
      nextLine,
    );
  } else if (!j.enough) {
    lines.push(
      `Verdict: **not enough Shorts yet.** ${MIN_EACH} a side with a retention curve are needed (curves arrive about a week after a Short goes live); ${j.a.n} and ${j.b.n} so far. The test carries on; next check ${dayName(o.next ?? o.since.slice(0, 10))}.`,
    );
  } else if (j.reason === "pct_worse") {
    const lead = j.prob >= WIN_PROB ? b : a;
    lines.push(
      `Verdict: **not yet.** ${lead.label} holds more viewers through the first 3 seconds (${inHundred(j.prob >= WIN_PROB ? j.prob : 1 - j.prob)} of 100 resamples) but they watch less of each Short, so it is not called. The test carries on; next check ${dayName(o.next ?? o.since.slice(0, 10))}.`,
    );
  } else {
    lines.push(
      `Verdict: **too close to call** (${b.label} ahead in ${inHundred(j.prob)} of 100 resamples, ${Math.abs(j.b.hold3 - j.a.hold3) < MIN_GAP ? "under 2 points apart" : "90 is the bar"}). The test carries on; next check ${dayName(o.next ?? o.since.slice(0, 10))}.`,
    );
  }
  return lines.join("\n");
}

/** Due a week after the test began, then on the day each week-long extension ends. */
export function growthDue(
  current: NonNullable<GrowthState["current"]>,
  now: Date,
  timeZone: string,
): boolean {
  if (now.getTime() < Date.parse(current.since) + MIN_DAYS * 86_400_000)
    return false;
  if (!current.next) return true;
  return dayKey(now, timeZone) >= current.next;
}

/**
 * Judges the running test when it is due, applies a winner as the default (a settings override), records the
 * run, starts the next test and posts the report. Runs from the analytics tick; at most once a week per test.
 */
export async function growthVerdict(
  db: Db,
  cfg: Pick<Config, "growthTests" | "timezone">,
  now: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<string | undefined> {
  if (!cfg.growthTests) return undefined;
  const state = await readGrowthState(db);
  const current = state.current;
  if (!current || !growthDue(current, now, cfg.timezone)) return undefined;
  const test = testByKey(current.key);
  if (!test) {
    // A key from an older build: drop it so the list moves on.
    state.current = undefined;
    await writeGrowthState(db, state);
    return undefined;
  }
  const j = judgeTest(await testShorts(db, test.key));
  const checks = current.checks + 1;
  const closed = !j.winner && checks >= MAX_CHECKS;
  let following: GrowthTest | undefined;
  let next: string | undefined;
  if (j.winner || closed) {
    if (j.winner)
      await writeOverride(db, overrideKey(test.key), j.winner === "B" ? 1 : 0);
    state.done.push({ key: test.key, winner: j.winner, at: now.toISOString() });
    state.current = undefined;
    following = nextTest(state);
    if (following)
      state.current = {
        key: following.key,
        since: now.toISOString(),
        checks: 0,
      };
  } else {
    next = dayKey(new Date(now.getTime() + 7 * 86_400_000), cfg.timezone);
    state.current = { ...current, checks, next };
  }
  const report = verdictReport(test, j, {
    since: current.since,
    checks,
    next,
    following,
    closed,
  });
  // Recorded before the post, so a failed post never repeats a decision.
  await writeGrowthState(db, state);
  await logEvent(db, null, "growth_verdict", {
    key: test.key,
    winner: j.winner ?? null,
    reason: j.reason,
    prob: Math.round(j.prob * 100) / 100,
    a: j.a.n,
    b: j.b.n,
    checks,
    following: following?.key ?? null,
  });
  log("info", "growth test judged", {
    key: test.key,
    winner: j.winner ?? "none",
    reason: j.reason,
    following: following?.key,
  });
  await notify({ content: report });
  return report;
}
