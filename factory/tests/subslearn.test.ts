import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMove,
  applyMoves,
  applyToConfig,
  decide,
  decisionLine,
  per1k,
  readState,
  restoreSubsLearn,
  runSubsLearn,
  sampleOk,
  subsFormat,
  subsLearnDue,
  subsReportLines,
  subsTableLines,
  tallyFormats,
  type FlexSlots,
  type SubsFormat,
  type SubsTally,
} from "../src/subslearn/learn.ts";
import { subsLearnSettings } from "../src/subslearn/settings.ts";
import { growthReport } from "../src/growthreport.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const NOW = new Date("2026-11-15T10:00:00Z"); // a Sunday
const DAY = 86_400_000;
const S = subsLearnSettings({ SUBS_LEARN: "true" });
const BASE: FlexSlots = {
  news: ["13:00", "17:00", "22:00"],
  why: ["12:00", "18:30"],
};
const month = (e: Partial<Record<SubsFormat, SubsTally>>) =>
  new Map(Object.entries(e)) as Map<SubsFormat, SubsTally>;
// The October picture: news has the views, the Why Shorts have the subscribers.
const OCT = month({
  news: { videos: 60, views: 30_000, subs: 4 },
  why: { videos: 12, views: 8_000, subs: 14 },
});

test("settings: off by default, apply on once enabled, report-only with SUBS_LEARN_APPLY=false", () => {
  assert.equal(subsLearnSettings({}).enabled, false);
  assert.equal(S.enabled, true);
  assert.equal(S.apply, true);
  assert.equal(
    subsLearnSettings({ SUBS_LEARN: "1", SUBS_LEARN_APPLY: "false" }).apply,
    false,
  );
  assert.equal(S.minViews, 5000);
  assert.equal(S.minVideos, 5);
});

test("each video lands in its format", () => {
  assert.equal(subsFormat({ lane: "news", story_hash: "abc" }), "news");
  assert.equal(
    subsFormat({ lane: "news_breaking", story_hash: "big:x" }),
    "news",
  );
  assert.equal(
    subsFormat({ lane: "news", story_hash: "why:san-andreas" }),
    "why",
  );
  assert.equal(
    subsFormat({ lane: "news", story_hash: "search:gta-6-map" }),
    "search",
  );
  assert.equal(
    subsFormat({
      lane: "evergreen",
      story_hash: "evergreen:ranking:x:2026-10",
    }),
    "ranking",
  );
  assert.equal(
    subsFormat({ lane: "cutdown", story_hash: "cutdown:ep:3" }),
    "ranking",
  );
  assert.equal(
    subsFormat({ lane: "gameplay", story_hash: "gameplay:1" }),
    "gameplay",
  );
  assert.equal(
    subsFormat({ lane: "gameplay", story_hash: "gameplay:2", live: "true" }),
    "live_clip",
  );
  assert.equal(subsFormat({ lane: "news", story_hash: "reply:abc" }), "reply");
  assert.equal(
    subsFormat({ lane: "longform", story_hash: "longform:2026-11-01:best" }),
    "long_ranking",
  );
  assert.equal(
    subsFormat({
      lane: "evergreen",
      story_hash: "evergreen:ranking:y",
      runtime: "long",
    }),
    "long_ranking",
  );
  assert.equal(
    subsFormat({
      lane: "evergreen",
      story_hash: "documentary:x",
      runtime: "long",
    }),
    "documentary",
  );
  assert.equal(
    subsFormat({ lane: "news", story_hash: "gtafile:4" }),
    "gta_daily",
  );
  assert.equal(subsFormat({ lane: "free", story_hash: "deals" }), "other");
});

test("the maths: subscribers per 1,000 views, summed per format", () => {
  const t = tallyFormats([
    { format: "news", views: 1000, subs: 1 },
    { format: "news", views: 3000, subs: 1 },
    { format: "why", views: 2000, subs: 6 },
    { format: "why", views: 0, subs: 0 }, // no views in the window: not counted
  ]);
  assert.deepEqual(t.get("news"), { videos: 2, views: 4000, subs: 2 });
  assert.equal(per1k(t.get("news")!), 0.5);
  assert.equal(per1k(t.get("why")!), 3);
  assert.equal(t.get("why")!.videos, 1);
  assert.equal(per1k({ videos: 0, views: 0, subs: 0 }), undefined);
});

test("sample minimum: 5,000 views and 5 videos", () => {
  assert.equal(sampleOk({ videos: 5, views: 5000, subs: 0 }, S), true);
  assert.equal(sampleOk({ videos: 4, views: 50_000, subs: 9 }, S), false);
  assert.equal(sampleOk({ videos: 30, views: 4999, subs: 9 }, S), false);
  assert.equal(sampleOk(undefined, S), false);
  // The Why Shorts short of the sample: nothing moves, however good their rate.
  const d = decide({
    month: month({
      news: { videos: 60, views: 30_000, subs: 2 },
      why: { videos: 4, views: 9_000, subs: 30 },
    }),
    base: BASE,
    state: { moves: [] },
    now: NOW,
    settings: S,
  });
  assert.equal(d.kind, "hold");
  assert.match(d.kind === "hold" ? d.reason : "", /not enough data/);
});

test("a clear winner takes one slot from the weakest, the latest of its day", () => {
  const d = decide({
    month: OCT,
    base: BASE,
    state: { moves: [] },
    now: NOW,
    settings: S,
  });
  assert.equal(d.kind, "move");
  if (d.kind !== "move") return;
  assert.deepEqual(
    [d.move.slot, d.move.from, d.move.to],
    ["22:00", "news", "why"],
  );
  assert.deepEqual(d.after, {
    news: ["13:00", "17:00"],
    why: ["12:00", "18:30", "22:00"],
  });
  const line = decisionLine(d, true, NOW, "Europe/London");
  assert.match(line, /moved the 22:00 slot from News to The Why/);
  assert.match(line, /1\.8 subscribers per 1,000 views/);
  assert.match(line, /breaking news is never held/);
  assert.doesNotMatch(line, /—/);
  assert.match(
    decisionLine(d, false, NOW, "Europe/London"),
    /report only.*would move the 22:00 slot.*Nothing changed/,
  );
});

test("no clear lead, or too few subscribers behind the lead: hold", () => {
  const close = decide({
    month: month({
      news: { videos: 20, views: 10_000, subs: 10 },
      why: { videos: 10, views: 8_000, subs: 10 },
    }),
    base: BASE,
    state: { moves: [] },
    now: NOW,
    settings: S,
  });
  assert.equal(close.kind, "hold");
  assert.match(
    close.kind === "hold" ? close.reason : "",
    /no format is clearly ahead/,
  );
  const lucky = decide({
    month: month({
      news: { videos: 20, views: 10_000, subs: 0 },
      why: { videos: 6, views: 6_000, subs: 2 },
    }),
    base: BASE,
    state: { moves: [] },
    now: NOW,
    settings: S,
  });
  assert.equal(lucky.kind, "hold");
  assert.match(lucky.kind === "hold" ? lucky.reason : "", /only 2 subscribers/);
});

test("one change a week", () => {
  const recent = {
    moves: [],
    lastChangeAt: new Date(NOW.getTime() - 6 * DAY).toISOString(),
  };
  const d = decide({
    month: OCT,
    base: BASE,
    state: recent,
    now: NOW,
    settings: S,
  });
  assert.equal(d.kind, "hold");
  assert.match(d.kind === "hold" ? d.reason : "", /only one changes a week/);
  const weekOld = {
    moves: [],
    lastChangeAt: new Date(NOW.getTime() - 7 * DAY).toISOString(),
  };
  assert.equal(
    decide({ month: OCT, base: BASE, state: weekOld, now: NOW, settings: S })
      .kind,
    "move",
  );
});

test("bounds: never below one news slot, never past the shift limit, protected slot stays", () => {
  // News already gave up two slots (the shift limit): no third.
  const moves = [
    {
      slot: "22:00",
      from: "news" as const,
      to: "why" as const,
      at: "2026-10-25T09:00:00Z",
    },
    {
      slot: "17:00",
      from: "news" as const,
      to: "why" as const,
      at: "2026-11-01T09:00:00Z",
    },
  ];
  const d = decide({
    month: OCT,
    base: BASE,
    state: { moves },
    now: NOW,
    settings: S,
  });
  assert.equal(d.kind, "hold");
  // With a bigger limit, news still keeps one slot.
  const wide = decide({
    month: OCT,
    base: BASE,
    state: { moves },
    now: NOW,
    settings: { ...S, maxShift: 9 },
  });
  assert.equal(wide.kind, "hold");
  assert.match(wide.kind === "hold" ? wide.reason : "", /down to 1 slot/);
  // applyMoves itself never empties a format, whatever is on file.
  const all = applyMoves(BASE, [
    ...moves,
    { slot: "13:00", from: "news", to: "why", at: "x" },
  ]);
  assert.deepEqual(all.news, ["13:00"]);
  // The other way: news wins, the Why loses a slot but never the GTA File's.
  const flipped = month({
    news: { videos: 60, views: 30_000, subs: 60 },
    why: { videos: 12, views: 8_000, subs: 3 },
  });
  const back = decide({
    month: flipped,
    base: BASE,
    state: { moves: [] },
    now: NOW,
    settings: S,
    protectedSlots: ["18:30"],
  });
  assert.equal(back.kind, "move");
  if (back.kind === "move")
    assert.deepEqual([back.move.slot, back.move.from], ["12:00", "why"]);
  // Why disabled: only news takes part, nothing to compare.
  assert.equal(
    decide({
      month: OCT,
      base: BASE,
      state: { moves: [] },
      now: NOW,
      settings: S,
      pool: ["news"],
    }).kind,
    "hold",
  );
});

test("a move that undoes an earlier one puts the slot back and clears it", () => {
  const first = {
    slot: "22:00",
    from: "news" as const,
    to: "why" as const,
    at: "2026-11-01T09:00:00Z",
  };
  const flipped = month({
    news: { videos: 60, views: 30_000, subs: 60 },
    why: { videos: 12, views: 8_000, subs: 3 },
  });
  const d = decide({
    month: flipped,
    base: BASE,
    state: { moves: [first] },
    now: NOW,
    settings: S,
  });
  assert.equal(d.kind, "move");
  if (d.kind !== "move") return;
  assert.equal(d.move.slot, "22:00");
  assert.deepEqual(addMove([first], d.move), []);
  assert.deepEqual(d.after, BASE);
});

test("the table: 7 and 28 days, every format with numbers, the sample flagged", () => {
  const lines = subsTableLines(
    month({ why: { videos: 3, views: 2_000, subs: 4 } }),
    OCT,
    S,
  );
  assert.match(lines[0]!, /7 days \| 28 days/);
  assert.match(
    lines.find((l) => l.includes("News"))!,
    /no videos \| 0\.1 \(30,000 views, 60 videos, \+4\)/,
  );
  assert.match(lines.find((l) => l.includes("The Why"))!, /2\.0 .*\| 1\.8/);
  assert.match(
    subsTableLines(
      month({ gameplay: { videos: 2, views: 300, subs: 1 } }),
      month({ gameplay: { videos: 2, views: 300, subs: 1 } }),
      S,
    )[1]!,
    /below the sample/,
  );
});

async function seed(db: Awaited<ReturnType<typeof testDb>>) {
  // 6 news videos (6,000 views each, 1 subscriber between them) and 6 Why videos (1,000 views each, 2 subscribers each).
  const report: Array<Record<string, number | string>> = [];
  for (let i = 0; i < 12; i++) {
    const why = i >= 6;
    const id = `ep_${i}`;
    await db.query(
      `INSERT INTO episodes (id, lane, status, story_hash, story_json, youtube_video_id) VALUES ($1, 'news', 'published', $2, '{}'::jsonb, $3)`,
      [id, why ? `why:story-${i}` : `news-${i}`, `vid${i}`],
    );
    report.push({
      video: `vid${i}`,
      views: why ? 1000 : 6000,
      subscribersGained: why ? 2 : i === 0 ? 1 : 0,
    });
  }
  report.push({ video: "not-ours", views: 99_999, subscribersGained: 50 });
  return report;
}

test("the weekly run: moves one slot in the running config, says so, and holds the week after", async () => {
  const db = await testDb();
  const report = await seed(db);
  const cfg = testConfig(await tmpDir(), {
    subsLearn: S,
    newsSlots: [...BASE.news],
    whySlots: [...BASE.why],
    whySlot: "12:00",
    whyEnabled: true,
    seriesGtaFileSlot: "18:30",
    timezone: "Europe/London",
  });
  const said: string[] = [];
  const calls: string[] = [];
  const out = await runSubsLearn({
    db,
    cfg,
    now: NOW,
    report: async (start, end) => {
      calls.push(`${start}..${end}`);
      return report;
    },
    notify: async (m) => void said.push(String(m.content)),
  });
  assert.equal(out.windows.source, "analytics");
  assert.deepEqual(calls, ["2026-11-07..2026-11-13", "2026-10-17..2026-11-13"]);
  assert.equal(out.windows.month.get("news")!.views, 36_000); // the video the factory did not make is left out
  assert.equal(out.applied, true);
  assert.deepEqual(cfg.newsSlots, ["13:00", "17:00"]);
  assert.deepEqual(cfg.whySlots, ["12:00", "18:30", "22:00"]);
  assert.match(said[0]!, /moved the 22:00 slot from News to The Why/);
  assert.equal((await readState(db)).moves.length, 1);
  // A restart: the move comes back from the database.
  const fresh = testConfig(await tmpDir(), {
    subsLearn: S,
    newsSlots: [...BASE.news],
    whySlots: [...BASE.why],
    whyEnabled: true,
  });
  await restoreSubsLearn(db, fresh);
  assert.deepEqual(fresh.newsSlots, ["13:00", "17:00"]);
  // Three days later (a forced re-run): one change a week, nothing more moves.
  const again = await runSubsLearn({
    db,
    cfg,
    now: new Date(NOW.getTime() + 3 * DAY),
    report: async () => report,
    notify: async (m) => void said.push(String(m.content)),
  });
  assert.equal(again.decision.kind, "hold");
  assert.deepEqual(cfg.newsSlots, ["13:00", "17:00"]);
  // The growth report carries the table from this run.
  const msg = await growthReport(
    db,
    { timezone: "Europe/London", subsLearn: S },
    new Date(NOW.getTime() + 3 * DAY),
  );
  assert.match(
    String(msg.embeds?.[0]?.description),
    /Subscribers per 1,000 views, by format\*\* \(7 days \| 28 days\)/,
  );
  // Off or report-only: the configured slots come back.
  applyToConfig(cfg, await readState(db));
  cfg.subsLearn = { ...S, apply: false };
  applyToConfig(cfg, await readState(db));
  assert.deepEqual(cfg.newsSlots, BASE.news);
  await db.close();
});

test("report only: says what it would do, changes nothing", async () => {
  const db = await testDb();
  const report = await seed(db);
  const cfg = testConfig(await tmpDir(), {
    subsLearn: { ...S, apply: false },
    newsSlots: [...BASE.news],
    whySlots: [...BASE.why],
    whyEnabled: true,
  });
  const said: string[] = [];
  const out = await runSubsLearn({
    db,
    cfg,
    now: NOW,
    report: async () => report,
    notify: async (m) => void said.push(String(m.content)),
  });
  assert.equal(out.decision.kind, "move");
  assert.equal(out.applied, false);
  assert.deepEqual(cfg.newsSlots, BASE.news);
  assert.equal((await readState(db)).moves.length, 0);
  assert.match(said[0]!, /report only/);
  await db.close();
});

test("without the Analytics report it reads the day-four rows; due once on Sunday from 09:00", async () => {
  const db = await testDb();
  await seed(db);
  for (let i = 0; i < 12; i++)
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'retention', $2, 1, 0, 0, $3)`,
      [
        `ep_${i}`,
        new Date(NOW.getTime() - 3 * DAY),
        JSON.stringify({ views: 1000, subscribersGained: i >= 6 ? 3 : 0 }),
      ],
    );
  const lines = await subsReportLines(db, NOW, S);
  assert.match(
    lines.find((l) => l.includes("The Why"))!,
    /3\.0 \(6,000 views, 6 videos, \+18\)/,
  );
  const cfg = { timezone: "Europe/London", subsLearn: S };
  assert.equal(
    await subsLearnDue(db, cfg, new Date("2026-11-15T08:30:00Z")),
    undefined,
  );
  assert.equal(await subsLearnDue(db, cfg, NOW), "2026-11-15");
  assert.equal(
    await subsLearnDue(db, { ...cfg, subsLearn: { enabled: false } }, NOW),
    undefined,
  );
  assert.equal(
    await subsLearnDue(db, cfg, new Date("2026-11-16T10:00:00Z")),
    undefined,
  );
  await db.close();
});
