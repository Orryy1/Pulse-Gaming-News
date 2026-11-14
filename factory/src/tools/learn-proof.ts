// The learning core's proof on the live factory's own data (read-only: an export of a copy of its tables, never the
// live database). Writes a report and its data to the given folder:
//   node --import tsx src/tools/learn-proof.ts <export dir> <out dir> [boots.txt] [env.json] [analytics latest.json]
// 1. backfill: version stamps and the change ledger, as far as the events, the boot log and git can reconstruct them;
// 2. judge calibration: every judge score so far against the outcomes;
// 3. a simulated bandit on the channel's own spread of 3-second holds, and a replay of the logged hook-style test;
// 4. the holdout's power: how long a 10% control takes to see a difference;
// 5. the playbook curating the latest weekly report's lessons; 6. the hook sameness guard and hook model on real hooks.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "../db.ts";
import { loadExport } from "./learn-data.ts";
import {
  scoresFromEvent,
  judgeReport,
  judgeLines,
  judgeName,
  type Calibration,
} from "../learn/judges.ts";
import { METRIC_NAME } from "../learn/outcomes.ts";
import { compare, replay, type Summary } from "../learn/simulate.ts";
import {
  curate,
  allLessons,
  proposalsFromReport,
  playbookFor,
} from "../learn/playbook.ts";
import { closest, fitHookModel, predictHook } from "../learn/breadth.ts";
import { mean, spearman, variance } from "../learn/stats.ts";
import { parseGitLog } from "../learn/ledger.ts";
import { safeName, safeValue } from "../learn/stamps.ts";

const [exportDir, outDir, bootsFile, envFile, reportFile] =
  process.argv.slice(2);
if (!exportDir || !outDir) {
  console.error(
    "usage: learn-proof.ts <export dir> <out dir> [boots.txt] [env.json] [latest.json]",
  );
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const x = loadExport(exportDir);
const md: string[] = [];
const data: Record<string, unknown> = {};
const pc = (v?: number, d = 1) =>
  v === undefined || Number.isNaN(v) ? "n/a" : (v * 100).toFixed(d);
const f2 = (v?: number) =>
  v === undefined || Number.isNaN(v) ? "n/a" : v.toFixed(2);

// ---- 1. Backfill ----------------------------------------------------------------------------------
const BOOT = /^\[([^\]]+)\] starting factory \(([0-9a-f]{40})\)/;
const boots =
  bootsFile && fs.existsSync(bootsFile)
    ? fs
        .readFileSync(bootsFile, "utf8")
        .split("\n")
        .map((l) => l.match(BOOT))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ at: new Date(m[1]!).toISOString(), commit: m[2]! }))
    : [];
const CODEX_NOTE =
  /now answers these steps instead of Claude, with Claude as the fallback: (.*?)(\.| \(vision)/;
const restarts = x.notes
  .filter((e) => CODEX_NOTE.test(String((e.detail as any)?.text ?? "")))
  .map((e) => ({
    at: new Date(e.created_at).toISOString(),
    codex: String((e.detail as any).text)
      .match(CODEX_NOTE)![1]!
      .split(", ")
      .sort(),
  }));
const env =
  envFile && fs.existsSync(envFile)
    ? (JSON.parse(fs.readFileSync(envFile, "utf8")) as {
        current: Record<string, string>;
        changed: Array<{
          k: string;
          before: string | null;
          after: string | null;
        }>;
      })
    : undefined;
const SWITCH_ON = "2026-11-14T15:30:00.000Z";
const commitAt = (t: string) =>
  [...boots].reverse().find((b) => b.at <= t)?.commit;
const codexAt = (t: string) =>
  [...restarts].reverse().find((r) => r.at <= t)?.codex;
const armEvents = new Map<string, Record<string, unknown>>();
for (const e of x.events) {
  if (!e.episode_id) continue;
  const d = (e.detail ?? {}) as Record<string, any>;
  const arms = armEvents.get(e.episode_id) ?? {};
  if (e.kind === "growth_test") arms[`growth:${d.key}`] = d.variant;
  if (e.kind === "voice_test")
    arms.voice_test = d.personal ? "personal" : "standard";
  if (e.kind === "short_argument") arms.short_argument = d.arm;
  if (e.kind === "shorts_clean")
    arms.shorts_clean = d.clean ?? d.variant ?? true;
  if (e.kind === "funnel_arm") arms.funnel = d.arm;
  armEvents.set(e.episode_id, arms);
}
const backfill = x.episodes.map((ep) => {
  const t = new Date(ep.created_at).toISOString();
  const commit = commitAt(t);
  const settingsKnown = env
    ? Object.fromEntries(
        Object.entries(env.current).filter(
          ([k, v]) => safeName(k) && v !== "<withheld>" && safeValue(v),
        ),
      )
    : undefined;
  // before the 14 Nov 15:30 switch-ons, the keys that were added then were unset
  if (settingsKnown && t < SWITCH_ON)
    for (const c of env!.changed)
      if (c.before === null) delete settingsKnown[c.k];
  return {
    episode_id: ep.id,
    code_commit: commit ?? null,
    codex_sites: codexAt(t) ?? null,
    arms: armEvents.get(ep.id) ?? {},
    settings_from:
      t >= SWITCH_ON
        ? "the Mac's settings now"
        : env
          ? "the Mac's settings now, less the 14 Nov 15:30 switch-ons"
          : null,
    confidence: commit ? "reconstructed" : "partial",
    settings: settingsKnown,
  };
});
const withCommit = backfill.filter((b) => b.code_commit).length;
const withCodex = backfill.filter((b) => b.codex_sites).length;
const withArms = backfill.filter((b) => Object.keys(b.arms).length).length;
// the ledger: each boot with a new commit, with the commits between releases from git
const ledger: Array<{
  at: string;
  kind: string;
  commit?: string;
  summary: string;
}> = [];
for (let i = 0; i < boots.length; i++) {
  const b = boots[i]!;
  const prev = boots[i - 1];
  if (prev && prev.commit === b.commit) {
    ledger.push({
      at: b.at,
      kind: "restart",
      commit: b.commit,
      summary: "restart on the same code (a settings change or a crash)",
    });
    continue;
  }
  ledger.push({
    at: b.at,
    kind: "deploy",
    commit: b.commit,
    summary: `code ${prev?.commit.slice(0, 9) ?? "?"} to ${b.commit.slice(0, 9)}`,
  });
  if (prev)
    try {
      const out = execFileSync(
        "git",
        [
          "log",
          "--format=%H%x09%cI%x09%s",
          "-n",
          "60",
          `${prev.commit}..${b.commit}`,
          "--",
          "factory/",
        ],
        { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
      ).toString();
      for (const c of parseGitLog(out).reverse())
        ledger.push({
          at: b.at,
          kind: "commit",
          commit: c.hash,
          summary: c.subject,
        });
    } catch {
      // that range is not in this checkout
    }
}
for (let i = 1; i < restarts.length; i++)
  if (restarts[i]!.codex.join(",") !== restarts[i - 1]!.codex.join(","))
    ledger.push({
      at: restarts[i]!.at,
      kind: "setting",
      summary: `CODEX_CALLS changed: ${restarts[i]!.codex.join(", ")}`,
    });
for (const c of env?.changed ?? [])
  ledger.push({
    at: SWITCH_ON,
    kind: "setting",
    summary: `${c.k}: ${c.before ?? "unset"} to ${c.after ?? "unset"}`,
  });
ledger.sort((a, b) => a.at.localeCompare(b.at));
fs.writeFileSync(
  path.join(outDir, "backfill_stamps.json"),
  JSON.stringify(
    backfill.map((b) => ({
      ...b,
      settings: b.settings ? Object.keys(b.settings).length : null,
    })),
  ),
);
fs.writeFileSync(
  path.join(outDir, "backfill_ledger.json"),
  JSON.stringify(ledger, null, 1),
);
data.backfill = {
  episodes: backfill.length,
  withCommit,
  withCodex,
  withArms,
  boots: boots.length,
  restarts: restarts.length,
  ledger: ledger.length,
};
md.push(
  "## 1. Backfill: version stamps and the change ledger",
  "",
  `Reconstructed from the live tables (read-only copy), the Mac's boot log and git. ${backfill.length} episodes since 17 Oct:`,
  "",
  `- code commit known for ${withCommit} (${pc(withCommit / backfill.length, 0)}%): the boot log only reaches back to 5 Nov, so older episodes have none;`,
  `- which steps Codex answered (the model routing) known for ${withCodex} (${pc(withCodex / backfill.length, 0)}%), from the note each boot writes;`,
  `- test arms (growth test, voice test, argument, clean frame, funnel) known for ${withArms};`,
  `- settings: the Mac's ${env ? Object.keys(env.current).length : "?"} current keys (${env ? Object.values(env.current).filter((v) => v === "<withheld>").length : "?"} secret ones withheld, never read out), with the ${env?.changed.length ?? 0} keys switched on at 15:30 on 14 Nov taken off for earlier episodes. Earlier .env edits left no backup, so settings before that are approximate;`,
  "- prompt hashes cannot be reconstructed (the texts that ran were never kept); they start with LEARN_STAMPS.",
  "",
  `The ledger holds ${ledger.length} entries: ${ledger.filter((l) => l.kind === "deploy").length} deploys, ${ledger.filter((l) => l.kind === "commit").length} commits with their subjects, ${ledger.filter((l) => l.kind === "restart").length} restarts on the same code, ${ledger.filter((l) => l.kind === "setting").length} setting changes. Between 5 and 14 Nov a new release went live every ${f2((Date.parse(boots.at(-1)?.at ?? "") - Date.parse(boots[0]?.at ?? "")) / 3_600_000 / Math.max(1, ledger.filter((l) => l.kind === "deploy").length))} hours on average.`,
  "",
);

// ---- 2. Judge calibration -------------------------------------------------------------------------
const scores = x.events.flatMap(scoresFromEvent);
const MIN = 15;
const jr = judgeReport(scores, x.outcomes, MIN);
data.judges = jr;
const counts: Record<string, number> = {};
for (const s of scores) counts[s.judge] = (counts[s.judge] ?? 0) + 1;
const firstSeen: Record<string, string> = {};
for (const s of scores)
  if (!firstSeen[s.judge] || s.scoredAt < firstSeen[s.judge]!)
    firstSeen[s.judge] = s.scoredAt.slice(0, 10);
md.push(
  "## 2. Judge calibration on the existing scores",
  "",
  `${scores.length} judge scores in the events table; ${x.outcomes.length} published videos, of which ${x.outcomes.filter((o) => o.hold3 !== undefined).length} have a 3-second hold, ${x.outcomes.filter((o) => o.apv !== undefined).length} average viewed, ${x.outcomes.filter((o) => o.ctr !== undefined).length} click-through and ${x.outcomes.filter((o) => o.subsPer1k !== undefined).length} subscribers per 1,000. A link is stated from ${MIN} videos (the live setting defaults to 40); intervals are 90% bootstrap intervals on Spearman's rank correlation.`,
  "",
  "| Judge | Scores | Logged since | Status |",
  "| --- | --- | --- | --- |",
  ...jr.judges.map(
    (j) =>
      `| ${judgeName(j.judge)} | ${counts[j.judge] ?? 0} | ${firstSeen[j.judge] ?? ""} | ${j.status}${j.best ? ` (${METRIC_NAME[j.best.metric]}, rho ${f2(j.best.rho)})` : ""}, ${j.n} videos with an outcome |`,
  ),
  "",
  ...judgeLines(jr, MIN).map((l) => `- ${l}`),
  "",
  "Every correlation with enough videos (all formats together, then each format with enough):",
  "",
  "| Judge | Stage | Outcome | Format | Videos | rho | 90% interval | Lowest quarter | Highest quarter | Verdict |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...jr.rows
    .filter((c: Calibration) => c.verdict !== "too_few")
    .map((c) => {
      const scale =
        c.metric === "hold3" || c.metric === "ctr"
          ? (v?: number) => pc(v, c.metric === "ctr" ? 2 : 1)
          : f2;
      return `| ${judgeName(c.judge)} | ${c.stage} | ${METRIC_NAME[c.metric]} | ${c.format} | ${c.n} | ${f2(c.rho)} | ${f2(c.lo)} to ${f2(c.hi)} | ${scale(c.lowQuarter)} | ${scale(c.highQuarter)} | ${c.verdict} |`;
    }),
  "",
);

// ---- 3. Bandit simulation and replay ---------------------------------------------------------------
const holds = x.outcomes
  .filter(
    (o) =>
      (o.lane === "news" || o.lane === "news_breaking") &&
      o.hold3 !== undefined,
  )
  .map((o) => o.hold3!);
const base = mean(holds);
const noise = holds.map((h) => h - base);
const sd = Math.sqrt(variance(holds));
const perDay =
  Math.round(
    (x.episodes.filter(
      (e) => e.status === "published" && String(e.lane).startsWith("news"),
    ).length /
      28) *
      10,
  ) / 10;
const RUNS = Number(process.env.SIM_RUNS ?? 300);
const scen = (
  factors: Array<{ key: string; gap: number }>,
  lagDays: number,
  days: number,
) =>
  compare(
    {
      factors,
      noise,
      base,
      shortsPerDay: Math.max(1, Math.round(perDay)),
      lagDays,
      days,
      floor: 0.15,
      maxChecks: 4,
    },
    RUNS,
  );
const single: Array<{ gap: number; lag: number; res: Summary[] }> = [];
for (const lag of [2, 7])
  for (const gap of [0, 0.02, 0.04, 0.06])
    single.push({ gap, lag, res: scen([{ key: "f", gap }], lag, 63) });
const multi = scen(
  [
    { key: "hook_style", gap: 0.04 },
    { key: "cold_open_length", gap: -0.03 },
    { key: "title_shape", gap: 0 },
  ],
  2,
  112,
);
const logged = x.episodes
  .filter((e) => e.assets_json?.test?.key === "hook_style")
  .map((e) => ({
    id: e.id,
    arm: e.assets_json.test.variant as "A" | "B",
    y: x.outcomes.find((o) => o.episodeId === e.id)?.hold3,
    day: Date.parse(e.created_at) / 86_400_000,
  }))
  .filter(
    (r): r is { id: string; arm: "A" | "B"; y: number; day: number } =>
      r.y !== undefined,
  );
const rep = replay(logged, { floor: 0.15, lagDays: 7 });
data.bandit = {
  base,
  sd,
  perDay,
  single,
  multi,
  replay: rep,
  logged: logged.length,
};
const row = (label: string, s: Summary, key = "f") =>
  `| ${label} | ${s.policy} | ${pc(s.correct[key], 0)}% | ${pc(s.falseWinner[key], 0)}% | ${f2(s.decidedDay[key])} | ${f2(s.shortsOnWorse[key])} | ${pc(s.regretPerShort, 2)} |`;
md.push(
  "## 3. The bandit, simulated on the channel's own numbers",
  "",
  `News Shorts' 3-second hold (YouTube's watch ratio at 3 s, which counts replays, so it can pass 100): mean ${pc(base)}, spread (SD) ${pc(sd)} points over ${holds.length} Shorts; about ${perDay} news Shorts a day. The simulator resamples that real spread, adds a known true difference between two arms and applies growth.ts's own verdict rule (six a side, 90 of 100 resamples, a two-point lead) at weekly checks, up to four. ${RUNS} runs per row, seeded.`,
  "",
  "One factor, both policies (the 48-hour curves of RETENTION_LEARN, then the week-old curves):",
  "",
  "| True gap, curve delay | Policy | Right winner | False winner | Day of verdict | Shorts on the worse arm | Hold lost per Short (points) |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...single.flatMap((r) =>
    r.res.map((s) => row(`${pc(r.gap, 0)} pts, ${r.lag} days`, s)),
  ),
  "",
  "Three factors at once (hook style +4 points for B, cold-open length 3 points worse for B, title shape no difference), 16 weeks, 48-hour curves: growth.ts runs them one after another, the bandit all together.",
  "",
  "| Policy | Hook style right | Cold open right | Title: no false winner | All three settled | Day all settled | Hold lost per Short |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...multi.map(
    (s) =>
      `| ${s.policy} | ${pc(s.correct.hook_style, 0)}% | ${pc(s.correct.cold_open_length, 0)}% | ${pc(1 - s.falseWinner.title_shape!, 0)}% | ${pc(s.allDecided, 0)}% | ${f2(s.allDecidedDay)} | ${pc(s.regretPerShort, 2)} |`,
  ),
  "",
  `Replay of the logged hook-style test (${logged.length} Shorts with a curve, alternating A and B since 31 Oct; Li et al.'s rejection replay with the week-old curves): the bandit would have kept ${rep.accepted} of them, ${pc(rep.shareB, 0)}% stated stake, with a mean hold of ${pc(rep.banditMean)} against ${pc(rep.loggedMean)} for the alternate turns. With arms this close (see section 2 of the notes) the replay can only show the bandit does no harm, not a gain.`,
  "",
);

// ---- 4. Holdout power ------------------------------------------------------------------------------
const power = [7, 14, 28, 56, 84].map((days) => {
  const n = perDay * days;
  const nh = n * 0.1;
  const nl = n * 0.9;
  const se = sd * Math.sqrt(1 / Math.max(1, nh) + 1 / Math.max(1, nl));
  return {
    days,
    holdout: Math.round(nh),
    live: Math.round(nl),
    se,
    detectable: 2.5 * se,
  };
});
data.power = power;
md.push(
  "## 4. The holdout's power",
  "",
  "A 10% holdout of news Shorts, with the real spread of the 3-second hold. The smallest cumulative difference it can see (about 2.5 standard errors):",
  "",
  "| Days | Holdout Shorts | Live Shorts | Standard error (points) | Detectable difference (points) |",
  "| --- | --- | --- | --- | --- |",
  ...power.map(
    (p) =>
      `| ${p.days} | ${p.holdout} | ${p.live} | ${pc(p.se)} | ${pc(p.detectable)} |`,
  ),
  "",
  'So the holdout answers "did the last month or two of changes add up to a real gain" for gains of several points, not small ones; that is its job (Kohavi et al.). Per-change credit stays with the bandit and the stamps.',
  "",
);

// ---- 5. Playbook ---------------------------------------------------------------------------------
async function memDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    query: async (sql, params = []) =>
      (await pg.query(sql, params)).rows as any,
    exec: async (sql) => void (await pg.exec(sql)),
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}
if (reportFile && fs.existsSync(reportFile)) {
  const db = await memDb();
  const tmp = fs.mkdtempSync(path.join(outDir, ".pb-"));
  fs.mkdirSync(path.join(tmp, "reports", "analytics"), { recursive: true });
  fs.copyFileSync(
    reportFile,
    path.join(tmp, "reports", "analytics", "latest.json"),
  );
  const props = proposalsFromReport(tmp);
  const r1 = await curate(db, props, new Date("2026-11-11T13:00:00Z"));
  const r2 = await curate(db, props, new Date("2026-11-18T13:00:00Z"));
  const items = await allLessons(db);
  const pb = await playbookFor(db, ["news", "social"], 25);
  fs.rmSync(tmp, { recursive: true, force: true });
  data.playbook = { proposals: props.length, first: r1, second: r2, items };
  md.push(
    "## 5. The lesson playbook on the latest weekly report",
    "",
    `The 11 Nov weekly report's ${props.length} lessons, curated twice (as if the same report came again a week later): first pass ${r1.added.length} added; second pass ${r2.confirmed.length} confirmed and ${r2.added.length} added, so a lesson seen again is counted, never duplicated or rewritten. What a writer would be shown:`,
    "",
    "```",
    pb.text,
    "```",
    "",
  );
  await db.close();
}

// ---- 6. Hooks: sameness guard and the hook model ---------------------------------------------------
const news = x.episodes
  .filter(
    (e) =>
      (e.lane === "news" || e.lane === "news_breaking") &&
      e.script_json?.hook &&
      !["failed", "rejected"].includes(e.status),
  )
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const sims = news
  .map(
    (e, i) =>
      closest(
        e.script_json.hook,
        news
          .slice(Math.max(0, i - 30), i)
          .reverse()
          .map((p) => p.script_json.hook),
      ).sim,
  )
  .slice(5);
const over = (t: number) => sims.filter((s) => s > t).length;
const pairs = x.outcomes
  .filter((o) => o.hold3 !== undefined)
  .map((o) => ({ o, e: x.episodes.find((e) => e.id === o.episodeId) }))
  .filter((p) => p.e?.script_json?.hook)
  .map((p) => ({
    hook: p.e!.script_json.hook as string,
    game: p.e!.script_json.game_title as string | undefined,
    y: p.o.hold3!,
  }));
// leave-one-out: does the small hook model rank unseen hooks better than chance?
const loo: number[] = [];
for (let i = 0; i < pairs.length; i++) {
  const w = fitHookModel(pairs.filter((_, j) => j !== i));
  loo.push(w ? predictHook(w, pairs[i]!.hook, pairs[i]!.game) : base);
}
const looRho = spearman(
  loo,
  pairs.map((p) => p.y),
);
data.hooks = {
  sims,
  over: { 0.5: over(0.5), 0.6: over(0.6), 0.7: over(0.7) },
  looRho,
  n: pairs.length,
};
md.push(
  "## 6. Hooks: the sameness guard and the hook model",
  "",
  `Each of ${sims.length} past news hooks against the 30 before it (character-trigram similarity, no model): median closest match ${f2(sims.sort((a, b) => a - b)[Math.floor(sims.length / 2)])}; ${over(0.5)} over 0.5, ${over(0.6)} over 0.6 (the default refusal line), ${over(0.7)} over 0.7. The guard refuses only near-repeats, not shared game names.`,
  "",
  `The channel's own small hook model (ridge regression on question, number, length, "you", "I" and the game named first), tested leave-one-out on ${pairs.length} hooks with a 3-second hold: rank correlation ${f2(looRho)} with what actually held. ${looRho !== undefined && looRho > 0.15 ? "It carries some signal." : "It carries little or no signal yet, so it is only a tie-breaker; the clarity judge and the packaging lab's scorer (when merged) decide."}`,
  "",
);

fs.writeFileSync(
  path.join(outDir, "proof.json"),
  JSON.stringify(data, null, 1),
);
fs.writeFileSync(path.join(outDir, "proof.md"), md.join("\n"));
console.log(md.join("\n"));
