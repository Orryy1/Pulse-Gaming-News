// The learning core's weekly work and its plain-English Discord summary (LEARN_WEEKLY): what changed this week, whether
// the month's changes beat the holdout, which judges predict viewing and which are flagged, where each test stands,
// and what the lesson playbook kept, added and retired. Every job is behind its own setting and runs once a week on
// LEARN_WEEKLY_DAY after 09:00 UK; the judge scores are copied into the ledger every tick.

import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import { logEvent } from "../episodes.ts";
import { log } from "../lib/util.ts";
import type { LearnJob, LearnTickHost } from "./tick.ts";
import { loadOutcomes, type Outcome } from "./outcomes.ts";
import {
  freezeAnchors,
  ingestJudgeScores,
  judgeLines,
  judgeReport,
  rescoreAnchors,
  type DriftResult,
  type JudgeReport,
  type JudgeScore,
} from "./judges.ts";
import {
  banditStatus,
  banditVerdicts,
  BANDIT_FACTORS,
  type FactorStatus,
} from "./bandit.ts";
import {
  allLessons,
  creditLessons,
  curate,
  proposalsFromReport,
  retireLessons,
  type CurateResult,
} from "./playbook.ts";
import { fitHookModel, hookModelSkill } from "./breadth.ts";
import { saveHookModel } from "./writer.ts";
import { changesBetween, type LedgerRow } from "./ledger.ts";
import { bootstrapProb, mean } from "./stats.ts";

const DAY = 86_400_000;

/** The local weekday, hour and date of a moment. */
export function localParts(
  now: Date,
  timeZone: string,
): { day: number; hour: number; date: string } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(
    f.formatToParts(now).map((x) => [x.type, x.value]),
  );
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    day: days.indexOf(p.weekday!),
    hour: Number(p.hour),
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Whether the weekly run is due now: the right weekday, 09:00 or later, not yet run that date. */
export async function weeklyDue(
  db: Db,
  now: Date,
  timeZone: string,
  weekday: number,
): Promise<string | undefined> {
  const p = localParts(now, timeZone);
  if (p.day !== weekday || p.hour < 9) return undefined;
  const done = await db.query(`SELECT 1 FROM settings WHERE key = $1`, [
    `learn:weekly:${p.date}`,
  ]);
  return done.length ? undefined : p.date;
}

export interface HoldoutComparison {
  live: { n: number; hold3?: number; apv?: number; subsPer1k?: number };
  holdout: { n: number; hold3?: number; apv?: number; subsPer1k?: number };
  /** P(live's 3-second hold beats the holdout's), by bootstrap. */
  prob?: number;
}

/** Live against holdout news Shorts over the last 28 days (pure). */
export function compareHoldout(
  outcomes: Outcome[],
  profiles: Map<string, string>,
): HoldoutComparison {
  const side = (name: string) =>
    outcomes.filter(
      (o) =>
        (profiles.get(o.episodeId) ?? "live") === name &&
        profiles.has(o.episodeId),
    );
  const stat = (xs: Outcome[]) => {
    const pick = (k: "hold3" | "apv" | "subsPer1k") => {
      const v = xs.map((o) => o[k]).filter((x): x is number => x !== undefined);
      return v.length ? mean(v) : undefined;
    };
    return {
      n: xs.length,
      hold3: pick("hold3"),
      apv: pick("apv"),
      subsPer1k: pick("subsPer1k"),
    };
  };
  const live = side("live");
  const hold = side("holdout");
  const h = (xs: Outcome[]) =>
    xs.map((o) => o.hold3).filter((x): x is number => x !== undefined);
  return {
    live: stat(live),
    holdout: stat(hold),
    prob:
      h(live).length >= 3 && h(hold).length >= 3
        ? bootstrapProb(h(hold), h(live))
        : undefined,
  };
}

export interface WeeklyFacts {
  date: string;
  changes: LedgerRow[];
  holdout?: HoldoutComparison;
  judges?: JudgeReport;
  judgeMin: number;
  drift?: DriftResult;
  bandit?: FactorStatus[];
  playbook?: {
    curated: CurateResult;
    retired: Array<{ id: string; reason: string }>;
    active: number;
    best?: { id: string; text: string; helpful: number; harmful: number };
  };
  hooks?: { n: number; kept: number };
}

const pts = (x?: number) =>
  x === undefined ? "n/a" : `${(x * 100).toFixed(1)}`;
const factorName = (k: string) => k.replace(/_/g, " ");

/** The Discord summary in plain English, under Discord's 2,000 characters (pure). */
export function weeklyMessage(f: WeeklyFacts): string {
  const L: string[] = [`**What the data says works (week to ${f.date})**`];
  const deploys = f.changes.filter((c) => c.kind === "deploy").length;
  const settings = f.changes.filter(
    (c) => c.kind === "setting" || c.kind === "override",
  ).length;
  const intents = f.changes.filter((c) => c.kind === "intent");
  L.push(
    `Changes this week: ${deploys} code update${deploys === 1 ? "" : "s"}, ${settings} setting change${settings === 1 ? "" : "s"}${intents.length ? `, ${intents.length} planned improvement${intents.length === 1 ? "" : "s"} (latest: ${intents.at(-1)!.summary.slice(0, 90)})` : ""}.`,
  );
  if (f.holdout) {
    const { live, holdout, prob } = f.holdout;
    if (holdout.n < 3)
      L.push(
        `Control group: ${holdout.n} holdout Short${holdout.n === 1 ? "" : "s"} so far; the comparison needs a few more.`,
      );
    else
      L.push(
        `Control group: today's factory held ${pts(live.hold3)} at 3 seconds against ${pts(holdout.hold3)} for the pinned baseline (${live.n} and ${holdout.n} Shorts)${prob !== undefined ? `; the changes are ahead in ${Math.round(prob * 100)} of 100 resamples` : ""}.`,
      );
  }
  if (f.judges) {
    const lines = judgeLines(f.judges, f.judgeMin);
    const predicts = lines.filter((l) => l.includes(" predicts "));
    const flags = lines.filter((l) => l.startsWith("FLAG"));
    if (predicts.length)
      L.push(
        `Judges that predict viewing: ${predicts.map((l) => l.replace(/\.$/, "")).join("; ")}.`,
      );
    if (flags.length) L.push(flags.join(" "));
    if (!predicts.length && !flags.length)
      L.push("Judges: not enough videos with both a score and an outcome yet.");
  }
  if (f.drift)
    L.push(
      f.drift.drifted
        ? `Judge drift: the clarity judge now scores the same ${f.drift.n} past scripts ${f.drift.shift >= 0 ? "+" : ""}${f.drift.shift.toFixed(1)} points differently (ranking agreement ${f.drift.tau?.toFixed(2) ?? "n/a"}). Worth checking which model answers it.`
        : `Judge drift: none (clarity judge steady on ${f.drift.n} anchor scripts).`,
    );
  if (f.bandit?.length)
    for (const b of f.bandit) {
      const factor = BANDIT_FACTORS.find((x) => x.key === b.factor);
      const lead = Object.entries(b.pBest).sort((a, c) => c[1] - a[1])[0];
      if (!lead || !factor) continue;
      const n = Object.values(b.n).reduce((s, x) => s + x, 0);
      L.push(
        b.verdict?.winner
          ? `Test ${factorName(b.factor)}: settled, ${factor.labels[b.verdict.winner]} wins.`
          : `Test ${factorName(b.factor)}: ${factor.labels[lead[0]]} leads (${Math.round(lead[1] * 100)}% likely best, ${n} Shorts); new Shorts now go ${Object.entries(
              b.shares,
            )
              .map(([a, s]) => `${Math.round(s * 100)}% ${factor.labels[a]}`)
              .join(", ")}.`,
      );
    }
  if (f.playbook) {
    const p = f.playbook;
    L.push(
      `Lesson playbook: ${p.active} active, ${p.curated.added.length} new, ${p.curated.confirmed.length} confirmed again, ${p.retired.length + p.curated.retired.length} retired${p.retired.length ? ` (${[...new Set(p.retired.map((r) => r.reason))].join(", ")})` : ""}.${p.best && p.best.helpful > 0 ? ` Best proven: "${p.best.text.slice(0, 120)}" (helped ${p.best.helpful} week${p.best.helpful === 1 ? "" : "s"}).` : ""}`,
    );
  }
  if (f.hooks && f.hooks.n)
    L.push(
      `Hook breadth: ${f.hooks.n} Shorts chose from several hooks; the writer's first hook won ${f.hooks.kept} times.`,
    );
  let msg = L.join("\n");
  if (msg.length > 1950) msg = `${msg.slice(0, 1940)}...`;
  return msg;
}

/** Everything the weekly run does; returns the facts it reported. */
export async function runWeekly(
  s: LearnTickHost & { llm?: Llm },
  date: string,
): Promise<WeeklyFacts> {
  const ls = s.cfg.learn;
  const now = s.now();
  const outcomes = await loadOutcomes(s.db, {
    since: new Date(now.getTime() - 120 * DAY),
  });
  const facts: WeeklyFacts = {
    date,
    changes: await changesBetween(s.db, new Date(now.getTime() - 7 * DAY), now),
    judgeMin: ls.judgeMin,
  };
  if (ls.holdoutShare > 0 || ls.stamps) {
    const recent = outcomes.filter(
      (o) =>
        Date.parse(o.publishedAt ?? "") > now.getTime() - 28 * DAY &&
        ls.holdoutLanes.includes(o.lane),
    );
    const rows = await s.db.query<{ episode_id: string; profile: string }>(
      `SELECT episode_id, profile FROM episode_stamps WHERE episode_id = ANY($1::text[])`,
      [recent.map((o) => o.episodeId)],
    );
    if (rows.some((r) => r.profile === "holdout"))
      facts.holdout = compareHoldout(
        recent,
        new Map(rows.map((r) => [r.episode_id, r.profile])),
      );
  }
  if (ls.judges) {
    const scores = (
      await s.db.query<{
        episode_id: string;
        judge: string;
        stage: "first" | "final";
        score: number;
        scale_max: number;
        source_id: string;
        scored_at: string;
      }>(
        `SELECT episode_id, judge, stage, score, scale_max, source_id, scored_at FROM judge_scores`,
      )
    ).map(
      (r): JudgeScore => ({
        episodeId: r.episode_id,
        judge: r.judge,
        stage: r.stage,
        score: Number(r.score),
        scaleMax: Number(r.scale_max),
        sourceId: r.source_id,
        scoredAt: new Date(r.scored_at).toISOString(),
      }),
    );
    facts.judges = judgeReport(scores, outcomes, ls.judgeMin);
    for (const j of facts.judges.judges.filter((x) => x.status === "flagged"))
      await logEvent(s.db, null, "judge_flagged", {
        judge: j.judge,
        videos: j.n,
      });
    await freezeAnchors(s.db, ls.anchorCount);
    if (ls.anchors && s.llm) {
      facts.drift = await rescoreAnchors(s.db, s.llm, date);
      if (facts.drift?.drifted)
        await logEvent(s.db, null, "judge_drift", { ...facts.drift });
    }
  }
  if (ls.bandit === "on")
    facts.bandit = await banditVerdicts(s.db, ls, now, (m) => s.notify(m));
  else if (ls.bandit === "shadow")
    facts.bandit = await banditStatus(s.db, ls, now);
  if (ls.playbook !== "off") {
    const curated = await curate(s.db, proposalsFromReport(s.cfg.dataDir), now);
    await creditLessons(s.db, outcomes, now, date);
    const retired = await retireLessons(s.db, now, {
      staleDays: ls.playbookStaleDays,
      max: ls.playbookMax,
    });
    const active = (await allLessons(s.db)).filter(
      (l) => l.status === "active",
    );
    const best = [...active].sort(
      (a, b) => b.helpful - b.harmful - (a.helpful - a.harmful),
    )[0];
    facts.playbook = { curated, retired, active: active.length, best };
  }
  if (ls.hooks !== "off") {
    const rows = await s.db.query<{
      id: string;
      hook: string | null;
      game: string | null;
    }>(
      `SELECT id, script_json->>'hook' AS hook, script_json->>'game_title' AS game FROM episodes WHERE id = ANY($1::text[])`,
      [outcomes.filter((o) => o.hold3 !== undefined).map((o) => o.episodeId)],
    );
    const byId = new Map(outcomes.map((o) => [o.episodeId, o]));
    const train = rows
      .filter((r) => r.hook)
      .map((r) => ({ hook: r.hook!, game: r.game ?? undefined, y: byId.get(r.id)!.hold3! }));
    const w = fitHookModel(train);
    if (w) await saveHookModel(s.db, w, train.length, now, hookModelSkill(train));
    const picks = await s.db.query<{ chosen_idx: number }>(
      `SELECT idx AS chosen_idx FROM hook_candidates WHERE chosen AND created_at > $1`,
      [new Date(now.getTime() - 7 * DAY).toISOString()],
    );
    facts.hooks = {
      n: picks.length,
      kept: picks.filter((p) => Number(p.chosen_idx) === 0).length,
    };
  }
  const dir = path.join(s.cfg.dataDir, "reports", "learn");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}.json`),
    JSON.stringify(facts, null, 2),
  );
  return facts;
}

/** The weekly job and the per-tick judge copy, run by the learning tick in this order. */
export function learnJobs(): LearnJob[] {
  return [{
    name: "judge ledger",
    run: async (s) => {
      if (s.cfg.learn.judges) await ingestJudgeScores(s.db);
    },
  },
  {
    name: "weekly learning",
    run: async (s) => {
      const ls = s.cfg.learn;
      if (
        !(
          ls.weekly ||
          ls.judges ||
          ls.bandit !== "off" ||
          ls.playbook !== "off" ||
          ls.hooks !== "off"
        )
      )
        return;
      const date = await weeklyDue(s.db, s.now(), s.cfg.timezone, ls.weeklyDay);
      if (!date) return;
      // Marked first, so a fault never repeats a week's posts.
      await s.db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [`learn:weekly:${date}`, s.now().toISOString()],
      );
      const facts = await runWeekly(s, date);
      log("info", "learning core weekly run", { date });
      if (ls.weekly) await s.notify({ content: weeklyMessage(facts) });
    },
  }];
}
