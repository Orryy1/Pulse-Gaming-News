import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { testDb, tmpDir, testConfig } from "./helpers.ts";
import { learnSettings } from "../src/learn/settings.ts";
import { outcomeOf } from "../src/learn/outcomes.ts";
import {
  kendall,
  spearman,
  spearmanCi,
  ranks,
  bootstrapProb,
} from "../src/learn/stats.ts";
import {
  scoresFromEvent,
  episodeJudgeTable,
  calibrate,
  judgeReport,
  judgeLines,
  ingestJudgeScores,
  driftOf,
  freezeAnchors,
} from "../src/learn/judges.ts";
import {
  BANDIT_FACTORS,
  posteriors,
  thompson,
  withFloor,
  pick,
  toRetire,
  drawFor,
  banditAssign,
  drawsAsDefaults,
  residuals,
  banditVerdicts,
  type Obs,
} from "../src/learn/bandit.ts";
import { simulate, compare, replay } from "../src/learn/simulate.ts";
import {
  lessonKey,
  topicKey,
  polarity,
  scopeOf,
  curate,
  retireLessons,
  playbookFor,
  creditOf,
  allLessons,
  proposalsFromReport,
} from "../src/learn/playbook.ts";
import {
  similarity,
  closest,
  choose,
  briefsFor,
  fitHookModel,
  predictHook,
  ANGLE_BRIEFS,
} from "../src/learn/breadth.ts";
import {
  compareHoldout,
  weeklyMessage,
  localParts,
  weeklyDue,
} from "../src/learn/weekly.ts";
import {
  pickHook,
  banditForShort,
  playbookForShort,
} from "../src/learn/writer.ts";
import { readGrowthState, GROWTH_TESTS } from "../src/growth.ts";
import { goodScript } from "./helpers.ts";

const curve = (watch3: number) =>
  Array.from({ length: 100 }, (_, i) => ({
    at: (i + 1) / 100,
    watch: i < 10 ? watch3 : 0.5,
    relative: 0.5,
  }));

test("outcomes: hold at 3 s, average viewed, click-through and subscribers per 1,000 from the stored rows", () => {
  const o = outcomeOf(
    { id: "e1", lane: "news", story_hash: "abc", duration: 29 },
    [
      { episode_id: "e1", label: "curve", raw: curve(0.9) },
      {
        episode_id: "e1",
        label: "retention",
        raw: JSON.stringify({
          views: 2000,
          avgViewPercent: 61.5,
          subscribersGained: 3,
        }),
      },
      {
        episode_id: "e1",
        label: "ctr",
        raw: { ctr: 0.021, impressions: 4000 },
      },
      { episode_id: "e1", label: "ctr", raw: { ctr: 0.5, impressions: 10 } },
      { episode_id: "other", label: "retention", raw: { views: 1 } },
    ],
  );
  assert.equal(o.format, "news");
  assert.equal(o.hold3, 0.9);
  assert.equal(o.apv, 61.5);
  assert.equal(o.subsPer1k, 1.5);
  // the last ctr row for the episode wins; under 100 impressions it is not counted
  assert.equal(o.ctr, undefined);
  const why = outcomeOf({ id: "w", lane: "news", story_hash: "why:1" }, []);
  assert.equal(why.format, "why");
  assert.equal(why.hold3, undefined);
});

test("stats: ranks with ties, Spearman, Kendall, intervals", () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), undefined);
  assert.equal(kendall([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  const xs = Array.from({ length: 60 }, (_, i) => i);
  const ci = spearmanCi(
    xs,
    xs.map((x) => x + (x % 7) * 3),
  );
  assert.ok(ci.lo! > 0.5 && ci.hi! <= 1);
  assert.equal(bootstrapProb([1, 1, 1], [2, 2, 2]), 1);
});

test("judge scores from each kind of event", () => {
  const ev = (kind: string, detail: unknown, id = 1) => ({
    id,
    episode_id: "e1",
    kind,
    detail,
    created_at: "2026-11-13T10:00:00Z",
  });
  assert.deepEqual(
    scoresFromEvent(ev("clarity_gate", { before: 7, after: 10 })).map((s) => [
      s.judge,
      s.stage,
      s.score,
    ]),
    [
      ["clarity", "first", 7],
      ["clarity", "final", 10],
    ],
  );
  const rub = scoresFromEvent(
    ev("rubric", {
      grade: "amber",
      summary: "a=0.1 (amber), b=2 (amber), c=0 (red)",
    }),
  );
  assert.deepEqual(
    rub.map((s) => [s.judge, s.score]),
    [
      ["rubric", 1],
      ["rubric_ambers", -4],
    ],
  );
  assert.equal(
    scoresFromEvent(ev("release_gate", { mean: 2.4, pass: true }))[0]!.score,
    2.4,
  );
  assert.equal(scoresFromEvent(ev("release_gate", { skipped: "x" })).length, 0);
  const gfx = scoresFromEvent(
    ev("graphics_audit", {
      before: { texts: 5, readable: 3 },
      after: { texts: 5, readable: 4 },
    }),
  );
  assert.deepEqual(
    gfx.map((s) => s.score),
    [0.6, 0.8],
  );
  assert.equal(
    scoresFromEvent(ev("factcheck", { attempt: 1, verdict: "fail" }))[0]!.stage,
    "final",
  );
  assert.equal(
    scoresFromEvent({ ...ev("clarity_gate", { before: 1 }), episode_id: null })
      .length,
    0,
  );
});

test("judge table: first and final kept apart, the last fact check is final", () => {
  const s = (
    judge: string,
    stage: "first" | "final",
    score: number,
    at: string,
  ) => ({
    episodeId: "e",
    judge,
    stage,
    score,
    scaleMax: 1,
    sourceId: at,
    scoredAt: at,
  });
  const t = episodeJudgeTable([
    s("fact_check", "first", 0, "2026-01-01"),
    s("fact_check", "final", 1, "2026-01-02"),
    s("rubric", "final", 2, "2026-01-01"),
  ]).get("e")!;
  assert.deepEqual(t.get("fact_check"), { first: 0, final: 1 });
  assert.deepEqual(
    t.get("rubric"),
    { first: undefined, final: 2 },
    "a judge with no first look is never counted twice",
  );
});

test("calibration verdicts: predicts, no link, too few, no spread", () => {
  const strong = Array.from({ length: 50 }, (_, i) => ({
    score: i % 10,
    outcome: (i % 10) * 0.01 + ((i * 7) % 3) * 0.001,
  }));
  assert.equal(
    calibrate(strong, {
      judge: "j",
      stage: "final",
      metric: "hold3",
      format: "all",
      min: 40,
    }).verdict,
    "predicts",
  );
  const flat = Array.from({ length: 200 }, (_, i) => ({
    score: i % 10,
    outcome: ((i * 7919) % 101) / 100,
  }));
  assert.equal(
    calibrate(flat, {
      judge: "j",
      stage: "final",
      metric: "hold3",
      format: "all",
      min: 40,
    }).verdict,
    "no_link",
  );
  assert.equal(
    calibrate(flat.slice(0, 10), {
      judge: "j",
      stage: "final",
      metric: "hold3",
      format: "all",
      min: 40,
    }).verdict,
    "too_few",
  );
  assert.equal(
    calibrate(
      flat.map((p) => ({ ...p, score: 1 })),
      { judge: "j", stage: "final", metric: "hold3", format: "all", min: 40 },
    ).verdict,
    "no_spread",
  );
});

test("judge report flags a judge that predicts nothing and names one that does", () => {
  const scores = [];
  const outcomes = [];
  for (let i = 0; i < 60; i++) {
    const id = `e${i}`;
    scores.push({
      episodeId: id,
      judge: "good",
      stage: "final" as const,
      score: i % 10,
      scaleMax: 10,
      sourceId: `a${i}`,
      scoredAt: "2026-11-01",
    });
    scores.push({
      episodeId: id,
      judge: "noise",
      stage: "final" as const,
      score: (i * 7919) % 10,
      scaleMax: 10,
      sourceId: `b${i}`,
      scoredAt: "2026-11-01",
    });
    outcomes.push({
      episodeId: id,
      format: "news",
      lane: "news",
      hold3: (i % 10) / 10 + 0.001 * ((i * 13) % 5),
      apv: 50 + ((i * 31) % 17),
      ctr: 0.02 + ((i * 17) % 13) / 1000,
      subsPer1k: ((i * 23) % 11) / 10,
    });
  }
  const r = judgeReport(scores, outcomes, 40);
  assert.equal(r.judges.find((j) => j.judge === "good")!.status, "predicts");
  const lines = judgeLines(r, 40).join("\n");
  assert.match(lines, /good predicts 3-second hold/);
});

test("ingest copies judge events once, with the stamped prompt as the version", async () => {
  const db = await testDb();
  await db.query(
    `INSERT INTO events (episode_id, kind, detail) VALUES ('e1', 'clarity_gate', '{"before":6,"after":9}'), ('e1', 'note', '{}'), ('e1', 'rubric', '{"grade":"green","summary":"all green"}')`,
  );
  await db.query(
    `INSERT INTO episode_prompts (episode_id, site, prompt_hash, model, role, step) VALUES ('e1', 'clarity.judge', 'abc123', 'codex:text', 'judge', 'selected')`,
  );
  assert.equal(await ingestJudgeScores(db), 4);
  assert.equal(await ingestJudgeScores(db), 0);
  const rows = await db.query<{ judge: string; version: string | null }>(
    `SELECT judge, version FROM judge_scores ORDER BY judge, stage`,
  );
  assert.equal(
    rows.find((r) => r.judge === "clarity")!.version,
    "prompt:abc123",
  );
});

test("drift: a moved mean or a changed ranking on the anchors", () => {
  const same = Array.from({ length: 10 }, (_, i) => ({
    frozen: i,
    now: i + 0.1,
  }));
  assert.equal(driftOf("r", same).drifted, false);
  assert.equal(
    driftOf(
      "r",
      same.map((p) => ({ ...p, now: p.frozen + 1 })),
    ).drifted,
    true,
  );
  assert.equal(
    driftOf(
      "r",
      same.map((p, i) => ({ ...p, now: 9 - i })),
    ).drifted,
    true,
  );
});

test("anchors freeze once from published scripts with a clarity score", async () => {
  const db = await testDb();
  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json) VALUES ($1, $1, 'published', '{}', $2)`,
      [`a${i}`, JSON.stringify(goodScript())],
    );
    await db.query(
      `INSERT INTO judge_scores (episode_id, judge, stage, score, source_id, scored_at) VALUES ($1, 'clarity', 'final', 8, $2, now())`,
      [`a${i}`, `s${i}`],
    );
  }
  assert.equal(await freezeAnchors(db, 2), 2);
  assert.equal(await freezeAnchors(db, 2), 2);
});

// ---- bandit -------------------------------------------------------------------------------------

const factor = {
  key: "hook_style",
  arms: ["A", "B"],
  labels: { A: "q", B: "s" },
};
const obsOf = (n: number, gap: number, format = "news"): Obs[] =>
  Array.from({ length: n }, (_, i) => ({
    episodeId: `o${format}${i}`,
    factor: "hook_style",
    arm: i % 2 ? "B" : "A",
    format,
    y: 1 + (i % 2 ? gap : 0) + (((i * 7919) % 11) - 5) / 100,
    at: new Date(Date.UTC(2026, 10, 1 + (i % 10))).toISOString(),
  }));

test("bandit factors are the writer-side growth tests", () => {
  assert.deepEqual(
    BANDIT_FACTORS.map((f) => f.key),
    ["hook_style", "cold_open_length", "title_shape"],
  );
});

test("posteriors: a real gap shows; formats pool; baselines absorb a format's level", () => {
  const now = new Date("2026-11-14T00:00:00Z");
  const p = posteriors(obsOf(80, 0.06), factor, "news", {
    now,
    halfLifeDays: 21,
  });
  assert.ok(p[1]!.mean - p[0]!.mean > 0.03, JSON.stringify(p));
  // a format with no Shorts borrows the pooled effect
  const q = posteriors(obsOf(80, 0.06), factor, "why", {
    now,
    halfLifeDays: 21,
  });
  assert.ok(q[1]!.mean > q[0]!.mean);
  assert.ok(
    q[0]!.sd > p[0]!.sd,
    "less certain where it has no data of its own",
  );
  // a format that simply holds better is not mistaken for an arm effect
  const mixed = [
    ...obsOf(40, 0, "news"),
    ...obsOf(40, 0, "why").map((o) => ({ ...o, y: o.y + 0.3 })),
  ];
  const r = residuals(mixed, { now, halfLifeDays: 21 });
  assert.ok(
    Math.abs(
      r.filter((x) => x.format === "why").reduce((s, x) => s + x.r, 0) / 40,
    ) < 0.1,
  );
});

test("thompson, floor and pick", () => {
  const t = thompson([
    { arm: "A", mean: 0, sd: 0.01, n: 10 },
    { arm: "B", mean: 0.05, sd: 0.01, n: 10 },
  ]);
  assert.ok(t.pBest.B! > 0.99);
  assert.ok(
    Math.abs(t.topTwo.A! - 0.5) < 0.02,
    "top-two keeps half the draws on the challenger",
  );
  const f = withFloor({ A: 0, B: 1 }, 0.15);
  assert.ok(Math.abs(f.A! - 0.15) < 1e-9 && Math.abs(f.B! - 0.85) < 1e-9);
  assert.equal(pick({ A: 0.15, B: 0.85 }, 0.1), "A");
  assert.equal(pick({ A: 0.15, B: 0.85 }, 0.5), "B");
  assert.deepEqual(
    toRetire(
      [
        { arm: "A", mean: 0, sd: 0.01, n: 8 },
        { arm: "B", mean: 0.1, sd: 0.01, n: 8 },
      ],
      { A: 0, B: 1 },
    ),
    [],
    "never with two arms",
  );
  assert.deepEqual(
    toRetire(
      [
        { arm: "A", mean: 0, sd: 0.01, n: 9 },
        { arm: "B", mean: 0.1, sd: 0.01, n: 9 },
        { arm: "C", mean: 0.1, sd: 0.01, n: 3 },
      ],
      { A: 0.01, B: 0.6, C: 0.39 },
    ),
    ["A"],
  );
});

test("a draw is seeded by the episode, so a retry keeps its arm", () => {
  const o = {
    now: new Date("2026-11-14T00:00:00Z"),
    halfLifeDays: 21,
    floor: 0.15,
  };
  const a = drawFor(
    obsOf(30, 0.04),
    factor,
    ["A", "B"],
    { id: "ep1", format: "news" },
    o,
  );
  const b = drawFor(
    obsOf(30, 0.04),
    factor,
    ["A", "B"],
    { id: "ep1", format: "news" },
    o,
  );
  assert.equal(a.arm, b.arm);
  assert.ok(a.propensity >= 0.15);
});

test("bandit in the database: shadow records, on settles a factor with growth.ts's bootstrap", async () => {
  const db = await testDb();
  const now = new Date("2026-11-14T12:00:00Z");
  const off = await banditAssign(
    db,
    learnSettings({}),
    { id: "x", format: "news" },
    now,
  );
  assert.deepEqual(off, []);
  const shadow = learnSettings({ LEARN_BANDIT: "shadow" });
  const d = await banditAssign(db, shadow, { id: "x", format: "news" }, now);
  assert.equal(d.length, 3);
  const again = await banditAssign(
    db,
    shadow,
    { id: "x", format: "news" },
    now,
  );
  assert.deepEqual(
    again.map((a) => a.arm),
    d.map((a) => a.arm),
    "a retry reads back its arms",
  );
  assert.equal(drawsAsDefaults(d, "hook_style").length, 2);
  // 30 published Shorts on the title test, B clearly better
  for (let i = 0; i < 30; i++) {
    const id = `t${i}`;
    const arm = i % 2 ? "B" : "A";
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, lane, story_json, youtube_video_id, assets_json, publish_at) VALUES ($1, $1, 'published', 'news', '{}', $1, '{"durationSeconds":29}', $2)`,
      [id, new Date(now.getTime() - (i + 3) * 3_600_000).toISOString()],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, raw) VALUES ($1, 'curve', $2)`,
      [
        id,
        JSON.stringify(
          curve(arm === "B" ? 1.3 + (i % 3) / 100 : 1.0 + (i % 3) / 100),
        ),
      ],
    );
    await db.query(
      `INSERT INTO bandit_assignments (episode_id, factor, arm, format, propensity, mode) VALUES ($1, 'title_shape', $2, 'news', 0.5, 'on')`,
      [id, arm],
    );
  }
  const status = await banditVerdicts(
    db,
    learnSettings({ LEARN_BANDIT: "on" }),
    now,
  );
  const title = status.find((s) => s.factor === "title_shape")!;
  assert.equal(title.verdict?.winner, "B");
  const state = await readGrowthState(db);
  assert.ok(
    state.done.some((x) => x.key === "title_shape" && x.winner === "B"),
  );
  const [o] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'override:growth_title_shape'`,
  );
  assert.equal(o!.value, "1");
});

test("banditForShort: on swaps the running test's variant; shadow and off leave the Short alone", async () => {
  const db = await testDb();
  const host = (mode: string) => ({
    db,
    llm: { structured: async () => ({}) } as any,
    cfg: { learn: learnSettings({ LEARN_BANDIT: mode }) },
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  const test0 = {
    key: "hook_style",
    variant: "A" as const,
    label: "question gap",
  };
  const off = await banditForShort(
    host("off"),
    { id: "e1", lane: "news" },
    test0,
    [],
  );
  assert.equal(off.test, test0);
  const shadow = await banditForShort(
    host("shadow"),
    { id: "e2", lane: "news" },
    test0,
    [],
  );
  assert.equal(shadow.test, test0);
  assert.equal(shadow.defaults.length, 0);
  const on = await banditForShort(
    host("on"),
    { id: "e3", lane: "news" },
    test0,
    [],
  );
  assert.equal(on.test?.key, "hook_style");
  assert.equal(
    on.defaults.length,
    2,
    "the other two factors' arms become rules for this Short",
  );
  assert.ok(on.defaults.every((d) => GROWTH_TESTS.includes(d.test)));
});

test("simulator: seeded, and the strict rule cuts false winners", () => {
  const noise = Array.from(
    { length: 50 },
    (_, i) => ((i * 7919) % 41) / 100 - 0.2,
  );
  const o = {
    factors: [{ key: "f", gap: 0 }],
    noise,
    base: 1,
    shortsPerDay: 4,
    lagDays: 2,
    days: 35,
    floor: 0.15,
    maxChecks: 4,
  };
  assert.deepEqual(
    simulate("bandit", { ...o, seed: 5 }),
    simulate("bandit", { ...o, seed: 5 }),
  );
  const s = compare(o, 30);
  assert.deepEqual(
    s.map((x) => x.policy),
    ["alternate", "alternate_strict", "bandit"],
  );
  assert.ok(s[1]!.falseWinner.f! <= s[0]!.falseWinner.f!);
  const r = replay(
    Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      arm: (i % 2 ? "B" : "A") as "A" | "B",
      y: 1 + (i % 2) * 0.1,
      day: i,
    })),
    { floor: 0.15, lagDays: 2 },
  );
  assert.ok(r.accepted > 0 && r.accepted <= 20);
});

// ---- playbook ----------------------------------------------------------------------------------

test("lesson keys ignore figures and bookkeeping; topics and directions", () => {
  const a =
    "Instagram: posts weekday Sat did better (broke out 3 of 16 times (19%) against 5 of 75 (7%) for the rest). Evidence: moderate, 16 against 75 posts. (weekly report 2026-11-11)";
  const b =
    "Instagram: posts weekday Sat did better (broke out 4 of 20 times (20%) against 6 of 80 (8%) for the rest). Evidence: strong, 20 against 80 posts. (weekly report 2026-11-18)";
  assert.equal(lessonKey(a), lessonKey(b));
  assert.equal(scopeOf(a), "social");
  assert.equal(scopeOf("A card in the first 2 s loses 8 points more"), "news");
  const up = lessonKey("Shorts with a number in the hook held better");
  const down = lessonKey("Shorts with a number in the hook held worse");
  assert.equal(topicKey(up), topicKey(down));
  assert.equal(polarity(up), 1);
  assert.equal(polarity(down), -1);
});

test("curate: add, confirm without duplicating, contradiction retires the older", async () => {
  const db = await testDb();
  const t0 = new Date("2026-11-01T00:00:00Z");
  const r1 = await curate(
    db,
    [
      {
        text: "Shorts with a number in the hook held better (12 against 30)",
        scope: "news",
        source: "test",
      },
    ],
    t0,
  );
  assert.equal(r1.added.length, 1);
  const r2 = await curate(
    db,
    [
      {
        text: "Shorts with a number in the hook held better (20 against 41)",
        scope: "news",
        source: "test",
      },
    ],
    new Date("2026-11-08T00:00:00Z"),
  );
  assert.deepEqual(r2.confirmed, r1.added);
  let rows = await allLessons(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.confirmations, 2);
  assert.equal(
    rows[0]!.text,
    "Shorts with a number in the hook held better (12 against 30)",
    "the text is never rewritten",
  );
  const r3 = await curate(
    db,
    [
      {
        text: "Shorts with a number in the hook held worse (25 against 50)",
        scope: "news",
        source: "test",
      },
    ],
    new Date("2026-11-15T00:00:00Z"),
  );
  assert.equal(r3.retired.length, 1);
  rows = await allLessons(db);
  assert.deepEqual(rows.map((r) => r.status).sort(), ["active", "retired"]);
});

test("retirement: harmful, stale, crowded out; the playbook shows the most proven with ids", async () => {
  const db = await testDb();
  const t0 = new Date("2026-11-01T00:00:00Z");
  await curate(
    db,
    Array.from({ length: 5 }, (_, i) => ({
      text: `Lesson number ${"abcde"[i]} about hooks and pictures`,
      scope: "news" as const,
      source: "t",
    })),
    t0,
  );
  const ids = (await allLessons(db)).map((l) => l.id);
  await db.query(`UPDATE lessons SET harmful = 3 WHERE id = $1`, [ids[0]]);
  await db.query(`UPDATE lessons SET helpful = 4 WHERE id = $1`, [ids[1]]);
  await db.query(
    `UPDATE lessons SET last_confirmed = '2026-09-01' WHERE id = $1`,
    [ids[2]],
  );
  const retired = await retireLessons(db, new Date("2026-11-10T00:00:00Z"), {
    staleDays: 28,
    max: 1,
  });
  assert.deepEqual(retired.map((r) => r.reason).sort(), [
    "crowded out",
    "crowded out",
    "harmful",
    "stale",
  ]);
  const pb = await playbookFor(db, ["news"], 5);
  assert.deepEqual(pb.ids, [ids[1]]);
  assert.match(pb.text, new RegExp(`\\[${ids[1]}\\]`));
  assert.equal(creditOf([1, 1, 1, 1], [0.9, 0.9, 0.9, 0.9]), "helpful");
  assert.equal(creditOf([1, 1, 1], [1, 1, 1, 1]), "too_few");
});

test("proposals from the weekly report honour its blocklist", async () => {
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, "reports", "analytics"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "reports", "analytics", "latest.json"),
    JSON.stringify({
      run_at: "2026-11-11",
      lessons_blocklist: ["saturday"],
      feedback: {
        lessons: [
          "Posts on Saturday did better",
          "TikTok: shorter posts did better",
        ],
      },
      retention: { lessons: ["A card in the first 2 s loses viewers"] },
    }),
  );
  const p = proposalsFromReport(dir);
  assert.deepEqual(
    p.map((x) => [x.scope, x.source]),
    [
      ["social", "analytics_loop"],
      ["news", "retention_learn"],
    ],
  );
});

test("playbookForShort records what the writer saw, only when on", async () => {
  const db = await testDb();
  await curate(
    db,
    [
      {
        text: "Hooks that name the game first held better",
        scope: "news",
        source: "t",
      },
    ],
    new Date(),
  );
  const host = (mode: string) => ({
    db,
    llm: {} as any,
    cfg: { learn: learnSettings({ LEARN_PLAYBOOK: mode }) },
    now: () => new Date(),
  });
  assert.equal(await playbookForShort(host("shadow"), "e1"), "");
  assert.match(await playbookForShort(host("on"), "e2"), /name the game first/);
  const exp = await db.query(`SELECT * FROM lesson_exposures`);
  assert.equal(exp.length, 1);
});

// ---- hooks -------------------------------------------------------------------------------------

test("sameness: near repeats score high, different hooks low", () => {
  assert.ok(
    similarity(
      "GTA 6 is still on for November 19",
      "GTA 6 is still on for November 19th",
    ) > 0.8,
  );
  assert.ok(
    similarity(
      "Xbox adds a free tier with ads",
      "Nintendo raised Switch 2 prices to $80",
    ) < 0.3,
  );
  assert.equal(closest("abc", []).sim, 0);
  assert.equal(new Set(briefsFor("e1", 5).map((b) => b.id)).size, 5);
  assert.notDeepEqual(
    briefsFor("e1", 7).map((b) => b.id),
    briefsFor("e2", 7).map((b) => b.id),
  );
  assert.equal(ANGLE_BRIEFS.length, 7);
});

test("choose: refuses repeats and rule breakers, the clarity judge must beat the draft", async () => {
  const r = await choose(
    "Xbox adds free cloud gaming with ads",
    [
      {
        angle: "stake",
        hook: "Free Xbox cloud gaming costs you ads, not money",
      },
      { angle: "number", hook: "GTA 6 is still on for November 19" },
      { angle: "question", hook: "Would you watch ads to play Xbox for free" },
    ],
    {
      recent: ["GTA 6 is still on for November 19th"],
      maxSameness: 0.6,
      problemsWith: (h) => (h.includes("Would") ? 1 : 0),
      prior: (h) => h.length,
      clarity: async (h) => (h.startsWith("Free") ? 9 : 7),
    },
  );
  assert.match(r.all[2]!.refused!, /recent hook/);
  assert.match(r.all[3]!.refused!, /house rule/);
  assert.equal(r.chosen.angle, "stake");
  const keep = await choose(
    "Draft hook that is clear",
    [{ angle: "stake", hook: "Another way in entirely" }],
    {
      recent: [],
      maxSameness: 0.6,
      problemsWith: () => 0,
      prior: () => undefined,
      clarity: async (h) => (h.startsWith("Draft") ? 9 : 6),
    },
  );
  assert.equal(keep.chosen.idx, 0, "the draft stays when nothing beats it");
});

test("hook model: fits and predicts in the right direction on clear data", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    hook: i % 2 ? `Is game ${i} worth it?` : `Game ${i} is out now`,
    y: i % 2 ? 1.2 : 1.0,
  }));
  const w = fitHookModel(rows)!;
  assert.ok(
    predictHook(w, "Is it worth it?") > predictHook(w, "It is out now"),
  );
  assert.equal(fitHookModel(rows.slice(0, 5)), undefined);
});

test("pickHook: shadow writes candidates and keeps the draft; on takes the winner; a fault keeps the draft", async () => {
  const db = await testDb();
  const script = goodScript();
  const llm = {
    structured: async (o: any) =>
      o.site === "hooks.breadth"
        ? {
            candidates: [
              {
                angle: o.content.match(/- (\w+):/)[1],
                hook: "A completely different opening line here",
              },
            ],
          }
        : {
            score: o.content?.includes?.("completely different") ? 10 : 6,
            point: "p",
            issues: [],
            verdict: "pass",
          },
  } as any;
  const host = (mode: string) => ({
    db,
    llm,
    cfg: { learn: learnSettings({ LEARN_HOOKS: mode }) },
    now: () => new Date(),
  });
  const ep = { id: "h1", lane: "news" };
  const opts = { rules: "", recentHooks: [], problemsWith: () => 0 };
  const shadow = await pickHook(host("shadow"), ep, script, opts);
  assert.equal(shadow.hook, script.hook);
  const rows = await db.query(
    `SELECT * FROM hook_candidates WHERE episode_id = 'h1'`,
  );
  assert.equal(rows.length, 2);
  const broken = await pickHook(
    {
      ...host("on"),
      llm: {
        structured: async () => {
          throw new Error("down");
        },
      } as any,
    },
    { id: "h2", lane: "news" },
    script,
    opts,
  );
  assert.equal(broken.hook, script.hook);
});

// ---- weekly ------------------------------------------------------------------------------------

test("holdout comparison and the weekly message", () => {
  const outs = Array.from({ length: 20 }, (_, i) => ({
    episodeId: `e${i}`,
    format: "news",
    lane: "news",
    hold3: i < 4 ? 1.0 : 1.1,
    apv: 60,
  }));
  const profiles = new Map(
    outs.map((o, i) => [o.episodeId, i < 4 ? "holdout" : "live"]),
  );
  const c = compareHoldout(outs, profiles);
  assert.equal(c.holdout.n, 4);
  assert.equal(c.live.n, 16);
  assert.ok(c.prob! > 0.9);
  const msg = weeklyMessage({
    date: "2026-11-16",
    changes: [
      {
        id: 1,
        at: "",
        kind: "deploy",
        key: null,
        before: null,
        after: null,
        code_commit: null,
        summary: "x",
        source: "observed",
        detail: null,
      },
      {
        id: 2,
        at: "",
        kind: "intent",
        key: null,
        before: null,
        after: null,
        code_commit: null,
        summary: "Shorter hooks for news",
        source: "intent",
        detail: null,
      },
    ],
    holdout: c,
    judgeMin: 40,
    judges: {
      rows: [],
      judges: [{ judge: "clarity", status: "flagged", n: 50 }],
    },
  });
  assert.match(msg, /1 code update/);
  assert.match(msg, /Shorter hooks/);
  assert.match(msg, /FLAG: the clarity judge/);
  assert.ok(msg.length < 2000);
  assert.ok(!msg.includes("—"), "no em dashes");
});

test("weekly is due once, on the day, from 09:00 UK", async () => {
  const db = await testDb();
  assert.deepEqual(
    localParts(new Date("2026-11-16T09:30:00Z"), "Europe/London"),
    { day: 1, hour: 9, date: "2026-11-16" },
  );
  assert.equal(
    await weeklyDue(db, new Date("2026-11-16T08:30:00Z"), "Europe/London", 1),
    undefined,
  );
  assert.equal(
    await weeklyDue(db, new Date("2026-11-16T09:30:00Z"), "Europe/London", 1),
    "2026-11-16",
  );
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('learn:weekly:2026-11-16', 'x')`,
  );
  assert.equal(
    await weeklyDue(db, new Date("2026-11-16T10:30:00Z"), "Europe/London", 1),
    undefined,
  );
  assert.equal(
    await weeklyDue(db, new Date("2026-11-17T10:30:00Z"), "Europe/London", 1),
    undefined,
  );
});

test("the learning tick with everything off touches nothing", async () => {
  const { learnTick } = await import("../src/learn/tick.ts");
  const db = await testDb();
  const cfg = testConfig(await tmpDir());
  await learnTick({
    db,
    cfg,
    now: () => new Date(),
    notify: async () => undefined,
  });
  assert.equal((await db.query(`SELECT * FROM change_ledger`)).length, 0);
  assert.equal(
    (await db.query(`SELECT * FROM settings WHERE key LIKE 'learn:%'`)).length,
    0,
  );
  const on = testConfig(await tmpDir(), {
    learn: learnSettings({ LEARN_STAMPS: "1", LEARN_JUDGES: "1" }),
  });
  await learnTick({
    db,
    cfg: on,
    now: () => new Date(),
    notify: async () => undefined,
  });
  assert.equal((await db.query(`SELECT * FROM change_ledger`)).length, 1);
});
