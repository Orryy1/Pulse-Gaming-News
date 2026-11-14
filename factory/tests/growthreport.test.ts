import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backThis,
  growthFormat,
  growthLines,
  growthReport,
  growthReportDue,
  markGrowthReportSent,
  tally,
  type GrowthRow,
} from "../src/growthreport.ts";
import { testConfig, testDb } from "./helpers.ts";

const NOW = new Date("2026-11-08T10:00:00Z");
const DAY = 86_400_000;
const row = (
  format: GrowthRow["format"],
  views: number,
  subs: number,
  daysAgo: number,
): GrowthRow => ({
  format,
  views,
  subs,
  at: NOW.getTime() - daysAgo * DAY,
});

test("each video lands in its format", () => {
  const f = growthFormat;
  assert.equal(f({ lane: "news", story_hash: "abc" }), "news");
  assert.equal(f({ lane: "news_breaking", story_hash: "abc" }), "news");
  assert.equal(f({ lane: "news", story_hash: "why:san" }), "why");
  assert.equal(
    f({ lane: "evergreen", evergreen_format: "ranking" }),
    "ranking",
  );
  assert.equal(
    f({ lane: "evergreen", story_hash: "evergreen:ranking:re:2026-10" }),
    "ranking",
  );
  assert.equal(f({ lane: "cutdown" }), "ranking");
  assert.equal(f({ lane: "longform", evergreen_format: "documentary" }), "doc");
  assert.equal(
    f({ lane: "longform", evergreen_format: "documentary", explained: true }),
    "explainer",
  );
  assert.equal(
    f({ lane: "evergreen", evergreen_format: "steam_deals" }),
    "other",
  );
});

test("the week and the week before count separately", () => {
  const rows = [
    row("why", 100, 1, 1),
    row("why", 900, 3, 8),
    row("why", 5, 5, 20),
  ];
  const t = NOW.getTime();
  assert.deepEqual(tally(rows, t - 7 * DAY, t).get("why"), {
    videos: 1,
    views: 100,
    subs: 1,
  });
  assert.equal(tally(rows, t - 14 * DAY, t - 7 * DAY).get("why")!.views, 900);
});

test("a format short of views says not enough data and never prints a rate", () => {
  const lines = growthLines(
    [row("doc", 250, 2, 1), row("why", 1000, 2, 1), row("why", 1000, 1, 8)],
    NOW,
  ).join("\n");
  assert.match(lines, /Documentaries: not enough data \(250 views/);
  assert.doesNotMatch(lines, /Documentaries: \*\*/);
  assert.match(lines, /The Why: \*\*2\.0\*\*.*last week 1\.0, up 1\.0/);
  assert.match(lines, /Explainers: no videos; last week: not enough data/);
  assert.doesNotMatch(lines, /—/, "no em dashes");
});

test("the call backs a format only on enough videos, views, subscribers and a clear lead", () => {
  const month = (...rows: GrowthRow[]) =>
    tally(rows, NOW.getTime() - 28 * DAY, NOW.getTime());
  const clear = month(
    row("why", 600, 2, 1),
    row("why", 600, 1, 2),
    row("why", 600, 1, 3),
    row("news", 9000, 1, 3),
  );
  assert.match(backThis(clear), /Back this: \*\*The Why\*\*, 2\.2 .*News/);
  assert.match(backThis(clear), /only 4 subscribers/);
  assert.match(backThis(month()), /not enough data/);
  assert.match(
    backThis(month(row("why", 5000, 9, 1))),
    /not enough data/,
    "one video backs nothing",
  );
  assert.match(
    backThis(
      month(
        row("why", 600, 0, 1),
        row("why", 600, 1, 2),
        row("why", 600, 0, 3),
      ),
    ),
    /not enough data/,
    "one subscriber backs nothing",
  );
  assert.match(
    backThis(
      month(
        row("why", 900, 2, 1),
        row("why", 900, 2, 2),
        row("why", 900, 2, 3),
        row("ranking", 2700, 5, 3),
      ),
    ),
    /not enough data/,
    "a narrow lead is no call",
  );
});

test("it is due on Sunday from 10:00 London, once, and only with the setting on", async () => {
  const db = await testDb();
  const on = testConfig(".", {
    growthReport: true,
    timezone: "Europe/London",
  });
  const off = testConfig(".", { timezone: "Europe/London" });
  const sunday = new Date("2026-11-08T10:05:00Z");
  assert.equal(await growthReportDue(db, off, sunday), undefined);
  assert.equal(
    await growthReportDue(db, on, new Date("2026-11-08T09:55:00Z")),
    undefined,
  );
  assert.equal(
    await growthReportDue(db, on, new Date("2026-11-07T12:00:00Z")),
    undefined,
    "not Saturday",
  );
  assert.equal(await growthReportDue(db, on, sunday), "2026-11-08");
  await markGrowthReportSent(db, "2026-11-08");
  assert.equal(await growthReportDue(db, on, sunday), undefined);
  assert.equal(
    await growthReportDue(db, on, new Date("2026-11-15T10:05:00Z")),
    "2026-11-15",
  );
  await db.close();
});

test("the message reads the factory's retention rows and fits an embed", async () => {
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, lane, status, story_json, script_json) VALUES ('w', 'why:a', 'news', 'published', '{}', '{}')`,
  );
  await db.query(
    `INSERT INTO video_metrics (episode_id, label, captured_at, views, raw) VALUES ('w', 'retention', $1, 1000, $2)`,
    [
      new Date(NOW.getTime() - DAY),
      JSON.stringify({ views: 1000, subscribersGained: 3 }),
    ],
  );
  const msg = await growthReport(
    db,
    testConfig(".", { timezone: "Europe/London" }),
    NOW,
  );
  const e = msg.embeds![0]!;
  assert.match(String(e.title), /week to 8 Nov/);
  assert.match(String(e.description), /The Why: \*\*3\.0\*\*/);
  assert.ok(String(e.description).length < 4000);
  await db.close();
});
