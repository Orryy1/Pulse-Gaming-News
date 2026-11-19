// TREND_FEED (19 Nov 2026): the download account's subscriptions feed read as labelled story leads.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  TREND_FEED_URL,
  TREND_MAX_CALLS,
  leadItem,
  mergeLeads,
  parseTrendRows,
  readTrendItems,
  trendArgs,
  trendFeedRun,
  trendLeadsFile,
} from "../src/discovery/trendfeed.ts";
import { clusterItems, scoreCluster } from "../src/discovery/cluster.ts";
import { DEFAULT_TREND_CHANNELS, trendChannelList } from "../src/config.ts";
import { ownChannelFrom, PULSE_CHANNEL_ID } from "../src/lib/ytown.ts";
import { subscribeGuide } from "../src/tools/trendchannels.ts";
import { item, tmpDir } from "./helpers.ts";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const ts = (hoursAgo: number) =>
  Math.round((NOW - hoursAgo * 3_600_000) / 1000);
const row = (
  id: string,
  title: string,
  hoursAgo: number | "NA",
  channelId = "UCign0000000000000000000",
  channel = "IGN",
  views = 120000,
) =>
  [
    id,
    views,
    hoursAgo === "NA" ? "NA" : ts(hoursAgo),
    channelId,
    channel,
    title,
  ].join("\t");
const own = ownChannelFrom({}, ["pulseVideo1"]);
const COOKIES = ["--cookies", "/data/yt_cookies.txt"];

test("trend feed: one flat, metadata-only read of the subscriptions page, never a download", () => {
  const a = trendArgs();
  assert.equal(a.at(-1), TREND_FEED_URL);
  assert.ok(a.includes("--flat-playlist") && a.includes("--skip-download"));
  assert.ok(!a.includes("-o") && !a.some((x) => /^--(write|exec)/.test(x)));
  assert.ok(TREND_MAX_CALLS <= 2);
});

test("trend feed: rows are parsed; missing values are tolerated", () => {
  const rows = parseTrendRows(
    [
      row("aaaaaaaaaaa", "GTA 6 trailer 3 breakdown", 2),
      row("bbbbbbbbbbb", "Zelda news", "NA", "NA", "NA", 0),
      "garbage",
      "",
    ].join("\n"),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.uploadedAt, ts(2) * 1000);
  assert.equal(rows[0]!.views, 120000);
  assert.equal(rows[1]!.channel, "");
  assert.equal(rows[1]!.uploadedAt, undefined);
});

test("trend feed: Pulse's own uploads are never leads; old ones are forgotten; first sighting stands in for age", () => {
  const read = parseTrendRows(
    [
      row("aaaaaaaaaaa", "GTA 6 trailer 3 breakdown", 2),
      row("pulseVideo1", "Our own Short", 1),
      row(
        "ccccccccccc",
        "Pulse channel upload",
        1,
        PULSE_CHANNEL_ID,
        "Pulse Gaming",
      ),
      row("ddddddddddd", "Three days old", 72),
      row("eeeeeeeeeee", "No date", "NA"),
    ].join("\n"),
  );
  const leads = mergeLeads([], read, NOW, own);
  assert.deepEqual(leads.map((l) => l.videoId).sort(), [
    "aaaaaaaaaaa",
    "eeeeeeeeeee",
  ]);
  assert.equal(leads.find((l) => l.videoId === "eeeeeeeeeee")!.firstSeen, NOW);
  const later = mergeLeads(leads, read, NOW + 3_600_000, own);
  assert.equal(
    later.find((l) => l.videoId === "eeeeeeeeeee")!.firstSeen,
    NOW,
    "the first sighting is kept",
  );
});

test("trend feed: a lead is labelled, never an outlet, and says it needs the press", () => {
  const [l] = mergeLeads(
    [],
    parseTrendRows(row("aaaaaaaaaaa", "GTA 6 trailer 3 breakdown", 2)),
    NOW,
    own,
  );
  const it = leadItem(l!, NOW);
  assert.equal(it.sourceKind, "lead");
  assert.equal(it.source, "YouTube trend feed: IGN");
  assert.match(it.summary, /not a source/);
  assert.match(it.summary, /120K views/);
  assert.equal(it.url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
});

test("trend feed: leads push a press story a little but never corroborate it, and alone are never picked", () => {
  const now = new Date(NOW);
  const press = item(
    "GTA 6 trailer 3 revealed by Rockstar",
    "IGN",
    "outlet",
    60,
    now,
  );
  const lead = {
    ...press,
    source: "YouTube trend feed: gameranx",
    sourceKind: "lead" as const,
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  };
  const alone = scoreCluster([press], now);
  const pushed = scoreCluster([press, lead], now);
  assert.equal(pushed.score - alone.score, 6);
  assert.equal(
    pushed.corroborated,
    alone.corroborated,
    "a lead never corroborates",
  );
  assert.equal(pushed.headline, press.title);
  const lead2 = { ...lead, source: "YouTube trend feed: SkillUp" };
  const leadsOnly = scoreCluster([lead, lead2], now);
  assert.ok(leadsOnly.score <= 0, "never selected on its own");
  assert.equal(leadsOnly.corroborated, false);
  assert.equal(
    clusterItems([press, lead], now).length,
    1,
    "the lead joins the press story",
  );
});

test("trend feed: a run reads once signed in with the trend purpose, keeps leads and discovery reads them", async () => {
  const dir = await tmpDir();
  const reads: string[][] = [];
  const n = await trendFeedRun(
    { dataDir: dir, ytdlp: "yt-dlp", cookiesFile: "/data/yt_cookies.txt" },
    {
      cookies: async () => COOKIES,
      read: async (a) => {
        reads.push(a);
        return [
          row("aaaaaaaaaaa", "GTA 6 trailer 3 breakdown", 2),
          row("pulseVideo1", "Ours", 1),
        ].join("\n");
      },
      own: () => own,
      now: () => NOW,
    },
  );
  assert.equal(n, 1);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]!.slice(0, 2), COOKIES);
  const items = readTrendItems(dir, new Date(NOW));
  assert.deepEqual(
    items.map((i) => i.source),
    ["YouTube trend feed: IGN"],
  );
  assert.equal(
    readTrendItems(dir, new Date(NOW + 30 * 3_600_000)).length,
    0,
    "a day later it is no longer a lead",
  );
  assert.ok(fs.existsSync(trendLeadsFile(dir)));
  assert.equal(path.basename(trendLeadsFile(dir)), "leads.json");
});

test("trend feed: no usable cookies, nothing is read", async () => {
  const dir = await tmpDir();
  let reads = 0;
  const n = await trendFeedRun(
    { dataDir: dir, ytdlp: "yt-dlp", cookiesFile: "" },
    {
      cookies: async () => [],
      read: async () => (reads++, ""),
      own: () => own,
      now: () => NOW,
    },
  );
  assert.equal(n, 0);
  assert.equal(reads, 0);
  assert.deepEqual(readTrendItems(dir, new Date(NOW)), []);
});

test("trend channels: the default list, the owner's own list, and the checklist of links", () => {
  assert.equal(DEFAULT_TREND_CHANNELS.length, 20);
  assert.deepEqual(trendChannelList(undefined), DEFAULT_TREND_CHANNELS);
  assert.deepEqual(trendChannelList(" @IGN, gameranx ,,IGN"), [
    "IGN",
    "gameranx",
  ]);
  assert.deepEqual(trendChannelList(""), []);
  const guide = subscribeGuide(["IGN", "gameranx"]);
  assert.match(guide, /https:\/\/www\.youtube\.com\/@IGN/);
  assert.match(guide, /Brave/);
  assert.match(guide, /Mac mini/);
  assert.match(guide, /never the Pulse/);
  assert.ok(!/—/.test(guide), "no em dashes");
});
