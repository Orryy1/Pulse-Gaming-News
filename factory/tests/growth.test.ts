import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig, goodScript } from "./helpers.ts";
import type { Db } from "../src/db.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";
import {
  GROWTH_TESTS,
  MIN_EACH,
  MAX_CHECKS,
  assignVariant,
  bootstrapWinProb,
  growthAssign,
  growthDefaults,
  growthNotes,
  growthProblems,
  growthVerdict,
  judgeTest,
  nextTest,
  readGrowthState,
  testShorts,
  verdictReport,
  type TestShort,
} from "../src/growth.ts";
import { readOverride } from "../src/experiments.ts";

const hookStyle = GROWTH_TESTS[0]!;
const coldOpen = GROWTH_TESTS[1]!;
const titleShape = GROWTH_TESTS[2]!;

test("the tests run in order, title shape last, one at a time, and the variants alternate", () => {
  assert.deepEqual(
    GROWTH_TESTS.map((t) => t.key),
    ["hook_style", "cold_open_length", "title_shape"],
  );
  assert.deepEqual([0, 1, 2, 3].map(assignVariant), ["A", "B", "A", "B"]);
  assert.equal(nextTest({ done: [] })?.key, "hook_style");
  assert.equal(
    nextTest({ done: [{ key: "hook_style", at: "" }] })?.key,
    "cold_open_length",
  );
  assert.equal(
    nextTest({
      current: { key: "cold_open_length", since: "", checks: 0 },
      done: [{ key: "hook_style", at: "" }],
    })?.key,
    "title_shape",
  );
  assert.equal(
    nextTest({ done: GROWTH_TESTS.map((t) => ({ key: t.key, at: "" })) }),
    undefined,
  );
});

test("the writer's note carries this Short's variant and the winners so far, nothing when there is neither", () => {
  assert.equal(growthNotes(undefined, []), "");
  const note = growthNotes(
    { key: "title_shape", variant: "B", label: "question" },
    [{ test: hookStyle, variant: "A" }],
  );
  assert.match(note, /answerable question, ending with "\?"/);
  assert.match(note, /YouTube title shape for this Short: a question/);
  assert.ok(
    !note.includes("number first"),
    "the losing variant is not mentioned",
  );
  // The running test's own key is never doubled by a stale default.
  const once = growthNotes(
    { key: "hook_style", variant: "B", label: "stated stake" },
    [{ test: hookStyle, variant: "A" }],
  );
  assert.equal((once.match(/Hook style for this Short/g) ?? []).length, 1);
  assert.match(once, /statement/);
});

test("a draft that ignores its variant is sent back with the rule named", () => {
  const q = goodScript({
    hook: "Is Starfield's expansion really slipping to 2027?",
  });
  const st = goodScript({
    hook: "Starfield's second expansion slips to early 2027.",
  });
  const A = { key: "hook_style", variant: "A" as const, label: "question gap" };
  const B = { key: "hook_style", variant: "B" as const, label: "stated stake" };
  assert.equal(growthProblems(q, A, []).length, 0);
  assert.match(growthProblems(st, A, [])[0]!, /is a statement/);
  assert.equal(growthProblems(st, B, []).length, 0);
  assert.match(growthProblems(q, B, [])[0]!, /is a question/);
  // Title shape.
  const tq = goodScript({
    youtube: {
      title: "Is Starfield's Expansion Slipping Again?",
      description: "",
      tags: [],
    },
  });
  const tA = {
    key: "title_shape",
    variant: "A" as const,
    label: "number first",
  };
  const tB = { key: "title_shape", variant: "B" as const, label: "question" };
  assert.match(growthProblems(tq, tA, [])[0]!, /title .* is a question/);
  assert.equal(growthProblems(tq, tB, []).length, 0);
  assert.match(growthProblems(st, tB, [])[0]!, /title .* is a statement/);
  // Cold-open length.
  const short = goodScript({ hook: "Starfield's expansion slips to 2027." }); // 5 words
  const long = goodScript({
    hook: "Starfield's second expansion has slipped to early 2027 and that changes everything.", // 12
  });
  const cA = {
    key: "cold_open_length",
    variant: "A" as const,
    label: "5-7 words",
  };
  const cB = {
    key: "cold_open_length",
    variant: "B" as const,
    label: "9-12 words",
  };
  assert.equal(growthProblems(short, cA, []).length, 0);
  assert.match(
    growthProblems(long, cA, [])[0]!,
    /12 words; this Short's rule is 5 to 7/,
  );
  assert.equal(growthProblems(long, cB, []).length, 0);
  assert.match(
    growthProblems(short, cB, [])[0]!,
    /5 words; this Short's rule is 9 to 12/,
  );
  // A finished test's winner is a standing rule too.
  assert.match(
    growthProblems(st, cA, [{ test: hookStyle, variant: "A" }])[0]!,
    /is a statement/,
  );
});

test("bootstrap: no difference reads near a half, a clear gap near one, the same seed the same answer", () => {
  const same = bootstrapWinProb(
    [0.6, 0.62, 0.58, 0.61, 0.59, 0.6],
    [0.6, 0.62, 0.58, 0.61, 0.59, 0.6],
  );
  assert.ok(same > 0.4 && same < 0.6, `about a half, got ${same}`);
  const clear = bootstrapWinProb(
    [0.5, 0.52, 0.49, 0.51, 0.5, 0.48],
    [0.7, 0.72, 0.69, 0.71, 0.7, 0.68],
  );
  assert.ok(clear > 0.99, `near one, got ${clear}`);
  assert.equal(
    bootstrapWinProb([0.5, 0.6, 0.7], [0.55, 0.65, 0.75], 500, 3),
    bootstrapWinProb([0.5, 0.6, 0.7], [0.55, 0.65, 0.75], 500, 3),
  );
  assert.equal(bootstrapWinProb([], [0.5]), 0.5);
});

/** n Shorts on one side with the hold at 3 s spread a little around `hold`. */
const side = (
  variant: "A" | "B",
  n: number,
  hold: number,
  pct = 60,
): TestShort[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${variant}${i}`,
    variant,
    hold3: hold + ((i % 3) - 1) * 0.02,
    pct,
    seconds: (pct / 100) * 40,
  }));

test("judge: six a side, a 90-in-100 lead on the three-second hold wins unless it watches less of the Short", () => {
  const few = judgeTest([...side("A", 5, 0.6), ...side("B", 6, 0.8)]);
  assert.equal(few.enough, false);
  assert.equal(few.winner, undefined);
  assert.equal(few.reason, "too_few");

  const bWins = judgeTest([...side("A", 6, 0.6), ...side("B", 6, 0.75)]);
  assert.equal(bWins.winner, "B");
  assert.ok(bWins.prob >= 0.9);
  const aWins = judgeTest([...side("A", 6, 0.75), ...side("B", 6, 0.6)]);
  assert.equal(aWins.winner, "A");
  assert.ok(aWins.prob <= 0.1);

  const close = judgeTest([...side("A", 6, 0.6), ...side("B", 6, 0.61)]);
  assert.equal(close.winner, undefined);
  assert.equal(close.reason, "too_close");
  // Every draw agrees (no spread) but the gap is under 2 points: noise, not a winner.
  const flat = (v: "A" | "B", hold: number): TestShort[] =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `${v}${i}`,
      variant: v,
      hold3: hold,
    }));
  const tiny = judgeTest([...flat("A", 0.6), ...flat("B", 0.615)]);
  assert.equal(tiny.prob, 1);
  assert.equal(tiny.winner, undefined);
  assert.equal(tiny.reason, "too_close");
  assert.equal(judgeTest([...flat("A", 0.6), ...flat("B", 0.62)]).winner, "B");

  // Holds the first three seconds but loses the rest: not called.
  const hollow = judgeTest([
    ...side("A", 6, 0.6, 60),
    ...side("B", 6, 0.75, 55),
  ]);
  assert.equal(hollow.winner, undefined);
  assert.equal(hollow.reason, "pct_worse");
  // Within the tolerance it still wins.
  assert.equal(
    judgeTest([...side("A", 6, 0.6, 60), ...side("B", 6, 0.75, 58.5)]).winner,
    "B",
  );
});

test("the verdict reads as plain English, under one Discord message, with no dashes", () => {
  const o = { since: "2026-10-31T10:00:00Z", checks: 1 };
  const win = verdictReport(
    hookStyle,
    judgeTest([...side("A", 7, 0.6), ...side("B", 7, 0.75)]),
    { ...o, following: coldOpen },
  );
  assert.match(win, /^\*\*Growth test 1 of 3: hook style\*\*/);
  assert.match(
    win,
    /- question gap: 60% still watching at 3 seconds, 24\.0 s watched on average \(60% of the Short\) \(7 Shorts\)/,
  );
  assert.match(
    win,
    /Verdict: \*\*stated stake wins\.\*\* In \d+ of 100 resamples the stated stake Shorts held more viewers through the first 3 seconds and they watched at least as much of each Short\. Every news Short now follows the stated stake rule; question gap is dropped\./,
  );
  assert.match(
    win,
    /Next test: \*\*cold-open length\*\*, a 5-7 word hook against a 9-12 word hook, starting with the next news Short\./,
  );
  const few = verdictReport(
    hookStyle,
    judgeTest([...side("A", 2, 0.6), ...side("B", 3, 0.75)]),
    { ...o, next: "2026-11-14" },
  );
  assert.match(
    few,
    /Verdict: \*\*not enough Shorts yet\.\*\* 6 a side with a retention curve are needed .*; 2 and 3 so far\. The test carries on; next check 14 Nov\./,
  );
  const close = verdictReport(
    hookStyle,
    judgeTest([...side("A", 6, 0.6), ...side("B", 6, 0.61)]),
    { ...o, next: "2026-11-14" },
  );
  assert.match(
    close,
    /Verdict: \*\*too close to call\*\* \(stated stake ahead in \d+ of 100 resamples, (90 is the bar|under 2 points apart)\)\. The test carries on; next check 14 Nov\./,
  );
  const closed = verdictReport(
    titleShape,
    judgeTest([...side("A", 6, 0.6), ...side("B", 6, 0.61)]),
    { ...o, checks: MAX_CHECKS, closed: true },
  );
  assert.match(closed, /^\*\*Growth test 3 of 3: title shape\*\*/);
  assert.match(closed, /no clear difference after 4 checks/);
  assert.match(closed, /That was the last test on the list/);
  for (const t of [win, few, close, closed]) {
    assert.ok(!t.includes("—") && !t.includes("–"), "no em or en dashes");
    assert.ok(t.length < 1900, `fits one Discord message (${t.length})`);
  }
});

let n = 0;
async function addShort(
  db: Db,
  o: {
    lane?: string;
    status?: string;
    test?: { key: string; variant: "A" | "B" };
    hold3?: number;
    pct?: number;
    duration?: number;
  },
): Promise<string> {
  const id = `ep_${++n}`;
  const duration = o.duration ?? 39;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, assets_json, youtube_video_id, publish_at)
     VALUES ($1, $1, $2, '{"headline":"x","items":[]}', $3, '{}', $4, $5, '2026-11-01T12:00:00Z')`,
    [
      id,
      o.status ?? "published",
      o.lane ?? "news",
      JSON.stringify({
        durationSeconds: duration,
        ...(o.test ? { test: { ...o.test, label: "x" } } : {}),
      }),
      o.status === "selected" ? null : `vid_${id}`,
    ],
  );
  if (o.hold3 !== undefined) {
    // A curve that holds `hold3` through the first ten percent, then falls away.
    const curve = Array.from({ length: 50 }, (_, i) => {
      const at = i / 49;
      const watch = at < 0.1 ? o.hold3! : Math.max(0.1, o.hold3! - (at - 0.1));
      return { at, watch, relative: 1 };
    });
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'curve', '2026-11-09T12:00:00Z', 0, 0, 0, $2)`,
      [id, JSON.stringify(curve)],
    );
  }
  if (o.pct !== undefined)
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'retention', '2026-11-06T12:00:00Z', 50, 0, 0, $2)`,
      [
        id,
        JSON.stringify({
          views: 50,
          engagedViews: 30,
          avgViewPercent: o.pct,
          subscribersGained: 0,
        }),
      ],
    );
  return id;
}

test("assignment: the first news Short starts the first test and says so; Shorts then alternate; other lanes and the off switch get nothing", async () => {
  const db = await testDb();
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  const now = new Date("2026-10-31T10:00:00Z");
  const off = testConfig("", { growthTests: false });
  assert.equal(
    await growthAssign(db, off, now, { id: "e0", lane: "news" }, notify),
    undefined,
  );
  assert.equal((await readGrowthState(db)).current, undefined);

  const cfg = testConfig("", { growthTests: true });
  assert.equal(
    await growthAssign(db, cfg, now, { id: "e0", lane: "evergreen" }, notify),
    undefined,
  );
  const first = await growthAssign(
    db,
    cfg,
    now,
    { id: "e1", lane: "news" },
    notify,
  );
  assert.deepEqual(first, {
    key: "hook_style",
    variant: "A",
    label: "question gap",
  });
  assert.equal(sent.length, 1);
  assert.match(
    sent[0]!.content!,
    /^Growth test 1 of 3 started today: \*\*hook style\*\*, a question gap against the stated stake in the opening line\. News Shorts take turns: question gap, then stated stake, then question gap again\./,
  );
  assert.equal((await readGrowthState(db)).current?.key, "hook_style");
  // Recorded on the episode, the next one gets the other variant; a dropped one does not count.
  await addShort(db, { status: "scripted", test: first });
  const second = await growthAssign(
    db,
    cfg,
    now,
    { id: "e2", lane: "news_breaking" },
    notify,
  );
  assert.equal(second?.variant, "B");
  await addShort(db, { status: "rejected", test: second });
  const third = await growthAssign(
    db,
    cfg,
    now,
    { id: "e3", lane: "news" },
    notify,
  );
  assert.equal(third?.variant, "B");
  assert.equal(sent.length, 1, "the start notice goes once");
  await db.close();
});

test("verdict: waits a week, needs six a side with a curve, applies the winner as the default and starts the next test", async () => {
  const db = await testDb();
  const cfg = testConfig("", { growthTests: true });
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  const start = new Date("2026-10-31T10:00:00Z");
  await growthAssign(db, cfg, start, { id: "e1", lane: "news" }, notify);
  sent.length = 0;
  for (let i = 0; i < 6; i++)
    await addShort(db, {
      test: { key: "hook_style", variant: "A" },
      hold3: 0.6,
      pct: 60,
    });
  for (let i = 0; i < 5; i++)
    await addShort(db, {
      test: { key: "hook_style", variant: "B" },
      hold3: 0.78,
      pct: 61,
    });
  // Never counted: a twin, one without a curve, one from another test.
  await addShort(db, {
    lane: "twin",
    test: { key: "hook_style", variant: "B" },
    hold3: 0.9,
  });
  await addShort(db, { test: { key: "hook_style", variant: "B" }, pct: 90 });
  await addShort(db, {
    test: { key: "title_shape", variant: "B" },
    hold3: 0.9,
  });
  const rows = await testShorts(db, "hook_style");
  assert.equal(rows.length, 11);
  assert.equal(
    Math.round(rows.find((r) => r.variant === "B")!.hold3 * 100),
    78,
  );
  assert.equal(rows.find((r) => r.variant === "A")!.pct, 60);
  assert.equal(Math.round(rows.find((r) => r.variant === "A")!.seconds!), 24);

  // Not due before a week has passed.
  assert.equal(
    await growthVerdict(db, cfg, new Date("2026-11-06T10:00:00Z"), notify),
    undefined,
  );
  // Due, but five on the B side: carries on, next check a week later.
  const few = await growthVerdict(
    db,
    cfg,
    new Date("2026-11-07T11:00:00Z"),
    notify,
  );
  assert.match(few!, /not enough Shorts yet/);
  assert.match(few!, /6 and 5 so far/);
  assert.match(few!, /next check 14 Nov/);
  const s1 = await readGrowthState(db);
  assert.equal(s1.current?.checks, 1);
  assert.equal(s1.current?.next, "2026-11-14");
  // Not again until then.
  assert.equal(
    await growthVerdict(db, cfg, new Date("2026-11-10T10:00:00Z"), notify),
    undefined,
  );
  await addShort(db, {
    test: { key: "hook_style", variant: "B" },
    hold3: 0.78,
    pct: 61,
  });
  const win = await growthVerdict(
    db,
    cfg,
    new Date("2026-11-14T08:00:00Z"),
    notify,
  );
  assert.match(win!, /stated stake wins/);
  assert.match(win!, /Next test: \*\*cold-open length\*\*/);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.content, win);
  assert.equal(
    sent[1]!.level,
    undefined,
    "sent now, not held for the evening summary",
  );
  assert.equal(await readOverride(db, "override:growth_hook_style"), 1);
  const s2 = await readGrowthState(db);
  assert.deepEqual(
    s2.done.map((d) => [d.key, d.winner]),
    [["hook_style", "B"]],
  );
  assert.equal(s2.current?.key, "cold_open_length");
  // The winner is now a standing rule for the writer, and the new test assigns from A again.
  const defaults = await growthDefaults(db);
  assert.deepEqual(
    defaults.map((d) => [d.test.key, d.variant]),
    [["hook_style", "B"]],
  );
  const next = await growthAssign(
    db,
    cfg,
    new Date("2026-11-14T09:00:00Z"),
    { id: "e9", lane: "news" },
    notify,
  );
  assert.deepEqual(next, {
    key: "cold_open_length",
    variant: "A",
    label: "5-7 words",
  });
  assert.match(
    growthNotes(next, defaults),
    /statement that gives the news and its stake/,
  );
  assert.match(
    growthNotes(next, defaults),
    /Hook length for this Short: the hook is 5 to 7 words/,
  );
  await db.close();
});

test("verdict: a test with no clear answer after four checks is closed without a default and the list moves on", async () => {
  const db = await testDb();
  const cfg = testConfig("", { growthTests: true });
  const sent: DiscordMessage[] = [];
  const notify = async (m: DiscordMessage) => void sent.push(m);
  await growthAssign(
    db,
    cfg,
    new Date("2026-10-31T10:00:00Z"),
    { id: "e1", lane: "news" },
    notify,
  );
  // Both sides spread over the same range, half a point apart on average: no answer, ever.
  for (let i = 0; i < MIN_EACH; i++) {
    const jitter = ((i % 3) - 1) * 0.03;
    await addShort(db, {
      test: { key: "hook_style", variant: "A" },
      hold3: 0.6 + jitter,
      pct: 60,
    });
    await addShort(db, {
      test: { key: "hook_style", variant: "B" },
      hold3: 0.605 + jitter,
      pct: 60,
    });
  }
  let last: string | undefined;
  for (let week = 1; week <= MAX_CHECKS; week++)
    last = await growthVerdict(
      db,
      cfg,
      new Date(
        Date.parse("2026-10-31T10:00:00Z") + week * 7 * 86_400_000 + 3_600_000,
      ),
      notify,
    );
  assert.match(last!, /no clear difference after 4 checks/);
  assert.match(last!, /Next test: \*\*cold-open length\*\*/);
  assert.equal(await readOverride(db, "override:growth_hook_style"), undefined);
  const s = await readGrowthState(db);
  assert.equal(s.done[0]?.winner, undefined);
  assert.equal(s.current?.key, "cold_open_length");
  assert.equal(s.current?.checks, 0);
  await db.close();
});
