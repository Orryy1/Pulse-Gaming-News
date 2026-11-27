import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  judgeSeries,
  nextLineReading,
  readSeriesResults,
  seriesJson,
  seriesLines,
  seriesReadings,
  type SeriesRow,
} from "../src/seriesreport.ts";
import { runAnalyticsLoop, seriesShort } from "../src/analyticsloop.ts";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";

const DAY = 86_400_000;
const now = new Date("2026-12-05T09:00:00Z");
let n = 0;
const row = (over: Partial<SeriesRow>): SeriesRow => ({
  episode_id: `e${++n}`,
  posted_at: new Date(now.getTime() - 5 * DAY).toISOString(),
  views: 1000,
  subs: 1,
  viewed_pct: 60,
  title: "A Short",
  game: "Starfield",
  ...over,
});

test("subscribers per 1,000 are summed by series, the control's GTA news apart, Shorts under 72 hours left out", () => {
  const rows = [
    row({ series: "why", views: 2000, subs: 4 }),
    row({ series: "why", views: 3000, subs: 2 }),
    row({
      series: "gta_file",
      game: "Grand Theft Auto VI",
      views: 1000,
      subs: 2,
    }),
    row({ series: "news_control", views: 4000, subs: 1 }),
    row({ series: "news_control", game: "GTA VI", views: 2000, subs: 2 }),
    row({ views: 500, subs: 0 }),
    row({
      series: "why",
      views: 9000,
      subs: 9,
      posted_at: new Date(now.getTime() - 48 * 3_600_000).toISOString(),
    }),
    row({ series: "why", views: 100, subs: undefined }),
  ];
  const r = seriesReadings(rows, now);
  assert.deepEqual(
    r.map((x) => x.group),
    ["why", "gta_file", "news_control", "gta_news", "other"],
  );
  const whyR = r.find((x) => x.group === "why")!;
  assert.equal(
    whyR.shorts,
    2,
    "the young Short and the one with no subscriber reading are left out",
  );
  assert.equal(whyR.views, 5000);
  assert.equal(whyR.subs, 6);
  assert.equal(whyR.rate, 1.2);
  assert.equal(r.find((x) => x.group === "news_control")!.rate, 0.25);
  assert.equal(r.find((x) => x.group === "gta_news")!.rate, 1);
  assert.equal(r.find((x) => x.group === "gta_file")!.name, "The GTA File");
});

test("a series where one Short holds over half the subscribers is flagged", () => {
  const r = seriesReadings(
    [
      row({ series: "why", subs: 5, title: "The big one" }),
      row({ series: "why", subs: 1 }),
      row({ series: "why", subs: 0 }),
    ],
    now,
  )[0]!;
  assert.equal(r.single_breakout, true);
  assert.equal(r.top?.title, "The big one");
  const lines = seriesLines({
    readings: [r],
    next_line: nextLineReading([], now),
    verdicts: [],
  }).join("\n");
  assert.match(lines, /one Short holds 83% of its subscribers/);
  assert.equal(
    seriesReadings(
      [row({ series: "why", subs: 2 }), row({ series: "why", subs: 0 })],
      now,
    )[0]!.single_breakout,
    false,
    "two subscribers are too few to call a breakout",
  );
});

test("the next-part line test pools both series, counts only Shorts that said it, and needs 4,000 views an arm", () => {
  const line = (views: number, subs: number, said = true, viewed = 60) =>
    row({
      series: "why",
      views,
      subs,
      viewed_pct: viewed,
      next_line: { arm: "line", said },
    });
  const none = (views: number, subs: number, viewed = 60) =>
    row({
      series: "gta_file",
      views,
      subs,
      viewed_pct: viewed,
      next_line: { arm: "none", said: false },
    });
  assert.equal(
    nextLineReading([line(1000, 2), none(1000, 1)], now).verdict,
    "too few",
  );
  const pass = nextLineReading(
    [line(5000, 10), line(9000, 9, false), none(5000, 5)],
    now,
  );
  assert.equal(
    pass.line.shorts,
    1,
    "a line day with nothing planned said nothing",
  );
  assert.equal(pass.verdict, "pass");
  assert.equal(
    nextLineReading([line(5000, 6), none(5000, 5)], now).verdict,
    "fail",
    "under the 50% lift",
  );
  assert.equal(
    nextLineReading([line(5000, 10, true, 50), none(5000, 5, 60)], now).verdict,
    "fail",
    "viewed 10 points lower",
  );
  assert.equal(
    nextLineReading(
      [
        row({
          series: "news_control",
          next_line: { arm: "line", said: true },
          views: 9000,
        }),
      ],
      now,
    ).line.shorts,
    0,
    "only The Why and The GTA File are in the test",
  );
});

test("the verdicts follow the plan: under minimum keeps, a pass scales only on the second reading, at control kills", () => {
  const readings = (
    why: [number, number],
    control: [number, number],
    viewed = 60,
    gtaNews?: [number, number],
  ) =>
    seriesReadings(
      [
        // Two Shorts a series with even halves, so no single breakout decides.
        ...[0, 1].map((k) =>
          row({
            series: "why",
            views: why[0] / 2,
            subs: k ? Math.floor(why[1] / 2) : Math.ceil(why[1] / 2),
            viewed_pct: viewed,
          }),
        ),
        row({ series: "news_control", views: control[0], subs: control[1] }),
        ...(gtaNews
          ? [
              row({
                series: "news_control",
                game: "GTA VI",
                views: gtaNews[0],
                subs: gtaNews[1],
              }),
            ]
          : []),
        row({
          series: "gta_file",
          game: "GTA VI",
          views: why[0],
          subs: why[1],
          viewed_pct: viewed,
        }),
      ],
      now,
    );
  assert.equal(
    judgeSeries(readings([3000, 9], [3000, 1]), "why")!.decision,
    "keep",
    "under 5,000 views",
  );
  assert.equal(
    judgeSeries(readings([3000, 9], [3000, 1]), "why")!.mark,
    "under minimum",
  );
  const pass = judgeSeries(readings([6000, 8], [6000, 1]), "why")!;
  assert.equal(pass.mark, "pass");
  assert.equal(
    pass.decision,
    "keep",
    "first pass: wait for the second reading",
  );
  assert.equal(
    judgeSeries(readings([6000, 8], [6000, 1]), "why", true)!.decision,
    "scale",
  );
  assert.equal(
    judgeSeries(readings([6000, 8], [6000, 5]), "why")!.mark,
    "between",
    "not double the control",
  );
  assert.equal(
    judgeSeries(readings([12000, 2], [6000, 2]), "why")!.decision,
    "kill",
    "at control after 10,000 views",
  );
  assert.equal(
    judgeSeries(readings([6000, 8], [6000, 1], 40), "why")!.decision,
    "kill",
    "viewed 14 points under 54%",
  );
  // The GTA File is held to GTA news too, so the launch does not flatter it.
  const gta = judgeSeries(
    readings([6000, 8], [6000, 1], 60, [6000, 6]),
    "gta_file",
  )!;
  assert.equal(gta.mark, "between");
  assert.match(gta.why, /Control: GTA news 1\.00/);
  assert.equal(
    judgeSeries(readings([6000, 8], [6000, 1]), "verdict"),
    undefined,
    "no Shorts, no verdict",
  );
});

test("the judging reports read the series results from the weekly report's latest.json", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "series-"));
  assert.equal(readSeriesResults(dir), undefined);
  const s = seriesJson([row({ series: "why", views: 6000, subs: 8 })], now);
  fs.writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify({ version: 1, series: s }),
  );
  assert.deepEqual(readSeriesResults(dir), JSON.parse(JSON.stringify(s)));
  fs.writeFileSync(
    path.join(dir, "latest.json"),
    JSON.stringify({ version: 1 }),
  );
  assert.equal(readSeriesResults(dir), undefined, "an older report has none");
});

test("the weekly report shows each series, the control and GTA news apart, and the fit test leaves series Shorts out", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  const run = new Date("2026-12-07T09:05:00Z");
  const put = async (
    id: string,
    storyJson: object,
    script: object,
    views: number,
    subs: number,
    lane = "news",
  ) => {
    const live = new Date(run.getTime() - 5 * DAY);
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, assets_json, youtube_video_id, publish_at, lane) VALUES ($1, $1, 'published', $2, $3, $4, $5, $6, $7)`,
      [
        id,
        JSON.stringify(storyJson),
        JSON.stringify(goodScript(script)),
        JSON.stringify({ durationSeconds: 40 }),
        `v_${id}`,
        live,
        lane,
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, 'retention', $2, $3, 0, 0, $4)`,
      [
        id,
        live,
        views,
        JSON.stringify({
          subscribersGained: subs,
          avgViewPercent: 55,
          privacyStatus: "public",
        }),
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw) VALUES ($1, '72h', $2, $3, 0, 0, '{"privacyStatus":"public"}')`,
      [id, live, views],
    );
  };
  await put("w1", { why: { question: "Why?" } }, {}, 2000, 3);
  await put(
    "g1",
    {},
    { series: "gta_file", game_title: "Grand Theft Auto VI" },
    1000,
    2,
  );
  await put("c1", {}, {}, 4000, 1);
  await put("c2", {}, { game_title: "Grand Theft Auto VI" }, 1000, 1);
  const { markdown, json } = await runAnalyticsLoop(
    db,
    cfg,
    { youtube: {} },
    run,
  );
  assert.equal(
    json.episodes.w1!.series,
    "why",
    "an untagged Why Short is read as The Why",
  );
  assert.equal(json.episodes.g1!.series, "gta_file");
  assert.equal(json.episodes.c1!.series, "news_control");
  const groups = json.series!.readings.map((r) => [r.group, r.subs]);
  assert.deepEqual(groups, [
    ["why", 3],
    ["gta_file", 2],
    ["news_control", 1],
    ["gta_news", 1],
  ]);
  assert.match(markdown, /\*\*Subscribers per 1,000 views by series\*\*/);
  assert.match(markdown, /\| The Why \| 1 \| 2,000 \| 3 \| 1\.50 \| 55% \|/);
  assert.match(markdown, /\| Control: GTA news \| 1 \| 1,000 \| 1 \| 1\.00 \|/);
  assert.ok(!markdown.includes("—"), "no em dashes");
  for (const h of ["## 4. Patterns", "## 5. Changes made", "## 6. Next test"])
    assert.ok(markdown.includes(h), h);
  assert.equal(
    seriesShort(json.episodes.w1),
    true,
    "live after 22 Nov, so out of the fit test",
  );
  assert.equal(seriesShort(json.episodes.c1), false, "the control stays in");
  assert.equal(
    seriesShort({ ...json.episodes.w1!, live_at: "2026-11-20T12:00:00Z" }),
    false,
    "before the switch-on it stays in",
  );
  await db.close();
});
