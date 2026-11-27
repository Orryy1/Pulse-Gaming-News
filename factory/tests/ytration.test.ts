// The YouTube rationing of 25 Nov 2026 (src/lib/ytguard.ts, src/lib/ytapisearch.ts): the anonymous lane retiring after
// failed lifts, the signed-in lane's budgets, spacing and priority order, failures not asked again, and searches
// answered by the Data API. Fixed clocks, no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterCall,
  anonClosedWindow,
  anonOpenNow,
  createYtGuard,
  currentYtPriority,
  decide,
  DEMAND_MS,
  emptyState,
  guardSettings,
  isBotCheck,
  isGoneVideo,
  isYtPaused,
  isYtRecentFailure,
  noteFailure,
  pacificDay,
  recentFailure,
  seedLiftFails,
  takeApiSearch,
  withYtPriority,
  type GuardSettings,
  type GuardState,
} from "../src/lib/ytguard.ts";
import {
  apiSearch,
  isApiQuotaError,
  isoSeconds,
  parseSearchCall,
  printableTemplate,
  renderTemplate,
  type ApiGet,
} from "../src/lib/ytapisearch.ts";
import { ytPriorityFor } from "../src/pipeline.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;
const s: GuardSettings = guardSettings({});
const BOT =
  "ERROR: [youtube] YiiTOJZDWyA: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies";
const GONE =
  "ERROR: [youtube] jNQXAC9IVRw: Video unavailable. This video has been removed by the uploader";
const URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const SIGNED = ["--cookies", "/data/yt_cookies.txt"];
const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);

// ---------------------------------------------------------------- settings

test("rationing settings: protective defaults, each overridable, bad values ignored", () => {
  assert.equal(s.anonLane, "auto");
  assert.equal(s.anonRetireDays, 14);
  assert.equal(s.anonRetireAfterLiftFails, 2);
  assert.equal(s.signedHourlyBudget, 4);
  assert.equal(s.signedDailyBudget, 30);
  assert.equal(s.signedMinGapMs, 300_000);
  assert.equal(s.signedBackgroundShare, 0.3);
  assert.equal(s.apiSearch, true);
  assert.equal(s.apiSearchesPerDay, 40);
  const o = guardSettings({
    YT_ANON_LANE: "OFF",
    YT_ANON_RETIRE_DAYS: "7",
    YT_SIGNED_DAILY: "50",
    YT_SIGNED_MIN_GAP_SECONDS: "120",
    YT_SIGNED_BG_SHARE: "0.5",
    YT_API_SEARCH: "off",
    YT_API_SEARCHES_PER_DAY: "10",
  });
  assert.equal(o.anonLane, "off");
  assert.equal(o.anonRetireDays, 7);
  assert.equal(o.signedDailyBudget, 50);
  assert.equal(o.signedMinGapMs, 120_000);
  assert.equal(o.signedBackgroundShare, 0.5);
  assert.equal(o.apiSearch, false);
  assert.equal(o.apiSearchesPerDay, 10);
  assert.equal(guardSettings({ YT_ANON_LANE: "sometimes" }).anonLane, "auto");
  assert.equal(guardSettings({ YT_SIGNED_DAILY: "-3" }).signedDailyBudget, 30);
  assert.equal(
    guardSettings({ YT_SIGNED_BG_SHARE: "4" }).signedBackgroundShare,
    1,
  );
});

// ---------------------------------------------------------------- the anonymous lane retiring

/** One block, then its lift by a working probe, then the first answer after the lift. Returns the last change. */
function liftThen(st: GuardState, at: number, first: "ok" | "bot", set = s) {
  st.block = { since: at - 7 * HOUR, until: at - HOUR, strikes: 3 };
  st.probeAt = undefined;
  const probe = decide(st, at, "urgent", set, 0);
  assert.ok(probe.go && probe.probe, "a probe goes after the pause");
  assert.equal(afterCall(st, at, "ok", true, set), "lifted");
  assert.equal(st.anonAfterLift, at);
  const next = decide(st, at + 34_000, "urgent", set, 0);
  assert.ok(next.go, "the first request after the lift goes");
  return afterCall(st, at + 34_000, first, false, set);
}

test("anonymous lane: a bot check on the first request after two lifts in a row retires it for 14 days", () => {
  const st = emptyState();
  assert.equal(
    liftThen(st, T0, "bot"),
    "started",
    "one failed lift: an ordinary block",
  );
  assert.equal(st.anonLiftFails, 1);
  assert.equal(st.anonRetired, undefined);
  assert.equal(liftThen(st, T0 + 4 * DAY, "bot"), "retired");
  assert.equal(st.anonLiftFails, 2);
  assert.equal(st.anonRetired!.until, T0 + 4 * DAY + 34_000 + 14 * DAY);
  assert.match(st.alerts.at(-1)!, /retired anonymous YouTube fetching until/);
  assert.ok(!st.alerts.at(-1)!.includes("—"), "no em dash in an owner line");
  // While retired every anonymous call is refused without a request, even after the block itself has ended.
  st.block = undefined;
  const held = decide(st, T0 + 10 * DAY, "urgent", s, 0);
  assert.ok(
    !held.go &&
      held.reason === "retired" &&
      held.until === st.anonRetired!.until,
  );
  assert.equal(anonOpenNow(st, T0 + 10 * DAY, s), false);
  // The signed-in lane is untouched.
  assert.ok(
    decide(st, T0 + 10 * DAY, "urgent", s, 0, "signed", "fetcher", "short").go,
  );
  // After the 14 days the lane may be tried again with a fresh count.
  const back = decide(st, T0 + 19 * DAY, "urgent", s, 0);
  assert.ok(back.go, "the retirement ends");
  assert.equal(st.anonRetired, undefined);
  assert.equal(st.anonLiftFails, 0);
});

test("anonymous lane: a working first answer after a lift clears the count; YT_ANON_LANE on never retires, off never asks", () => {
  const st = emptyState();
  liftThen(st, T0, "bot");
  assert.equal(st.anonLiftFails, 1);
  assert.equal(liftThen(st, T0 + 2 * DAY, "ok"), undefined);
  assert.equal(
    st.anonLiftFails,
    0,
    "the lane answered: the count starts again",
  );
  assert.equal(
    liftThen(st, T0 + 4 * DAY, "bot"),
    "started",
    "one failed lift again, not two",
  );
  assert.equal(st.anonRetired, undefined);

  const on = { ...s, anonLane: "on" as const };
  const st2 = emptyState();
  liftThen(st2, T0, "bot", on);
  assert.notEqual(liftThen(st2, T0 + 2 * DAY, "bot", on), "retired");
  assert.equal(st2.anonRetired, undefined);

  const off = { ...s, anonLane: "off" as const };
  const d = decide(emptyState(), T0, "urgent", off, 0);
  assert.ok(!d.go && d.reason === "retired" && d.until === undefined);
  assert.equal(anonOpenNow(emptyState(), T0, off), false);
  assert.equal(anonOpenNow(emptyState(), T0, s), true);
});

test("anonymous lane: a removed video after a lift says nothing; the next real answer decides", () => {
  const st = emptyState();
  st.anonLiftFails = 1;
  st.anonAfterLift = T0;
  assert.equal(afterCall(st, T0 + 1000, "other", false, s), undefined);
  assert.equal(st.anonAfterLift, T0, "still waiting for a real answer");
  assert.equal(afterCall(st, T0 + 2000, "bot", false, s), "retired");
});

test("anonymous lane: the Mac mini's state (block 34 seconds after the last lift) already counts one failed lift", () => {
  const mac = emptyState();
  mac.liftedAt = Date.UTC(2026, 10, 24, 23, 1, 20);
  mac.lastStrikes = 7;
  mac.block = {
    since: Date.UTC(2026, 10, 24, 23, 1, 54),
    until: Date.UTC(2026, 10, 26, 23, 1, 54),
    strikes: 8,
  };
  seedLiftFails(mac);
  assert.equal(mac.anonLiftFails, 1);
  seedLiftFails(mac);
  assert.equal(mac.anonLiftFails, 1, "seeded once only");
  // The next lift's first request meeting the wall again retires the lane.
  assert.equal(
    liftThen(mac, Date.UTC(2026, 10, 26, 23, 2, 0), "bot"),
    "retired",
  );
  const quiet = emptyState();
  quiet.liftedAt = T0;
  quiet.block = { since: T0 + 5 * HOUR, until: T0 + 11 * HOUR, strikes: 1 };
  seedLiftFails(quiet);
  assert.equal(
    quiet.anonLiftFails,
    0,
    "a block hours after a lift is not a failed lift",
  );
});

// ---------------------------------------------------------------- the signed-in lane's ration

const sig = (
  st: GuardState,
  at: number,
  priority: "short" | "long" | "background",
  set = s,
  purpose: "fetcher" | "clip" | "trend" = "fetcher",
  rand = 0,
) => decide(st, at, "urgent", set, rand, "signed", purpose, priority);

test("signed-in lane: requests are spaced YT_SIGNED_MIN_GAP_SECONDS apart (plus up to half at random); a Short waits its turn", () => {
  const st = emptyState();
  const a = sig(st, T0, "short");
  assert.ok(a.go && a.at === T0);
  const b = sig(st, T0 + 1000, "short", s, "fetcher", 1);
  assert.ok(
    b.go && b.at === T0 + 5 * MIN,
    "the next Short request is booked at the gap",
  );
  assert.equal(
    st.signed!.nextAt,
    T0 + 5 * MIN + 7.5 * MIN,
    "rand 1 adds half the gap",
  );
  const c = sig(st, T0 + 2000, "short");
  assert.ok(
    !c.go && c.reason === "busy",
    "more than 8 minutes away: the Short's fallbacks take over",
  );
});

test("signed-in lane: YT_SIGNED_PER_HOUR and YT_SIGNED_DAILY cap the lane", () => {
  const st = emptyState();
  let t = T0;
  for (let i = 0; i < 4; i++) {
    const d = sig(st, t, "short");
    assert.ok(d.go, `request ${i + 1} of the hour`);
    t = d.at + 8 * MIN;
  }
  const fifth = sig(st, t, "short");
  assert.ok(!fifth.go && fifth.reason === "budget", "four an hour");
  // Over a day: 30 at most, Shorts included.
  const day = emptyState();
  let n = 0;
  for (let i = 0; i < 90; i++)
    if (sig(day, T0 + i * 16 * MIN, "short").go) n++;
  assert.equal(n, 30, "30 in any 24 hours");
  const after = sig(day, T0 + 200 * 16 * MIN, "short");
  assert.ok(
    after.go || after.reason !== "daily",
    "the rolling day frees up again",
  );
});

test("signed-in lane: background yields to Shorts and long videos, takes only a free slot, and keeps to its share", () => {
  const st = emptyState();
  assert.ok(sig(st, T0, "long").go);
  const bg = sig(st, T0 + 6 * MIN, "background");
  assert.ok(
    !bg.go && bg.reason === "queue",
    "a long video asked in the last 15 minutes",
  );
  const later = sig(st, T0 + DEMAND_MS + MIN, "background");
  assert.ok(later.go, "nobody else asked for 15 minutes: background may go");
  const busy = sig(st, T0 + DEMAND_MS + 2 * MIN, "background");
  assert.ok(
    !busy.go && busy.reason === "busy",
    "background never waits for a slot",
  );
  // A Short keeps long videos off the lane while it is being made.
  const sh = emptyState();
  assert.ok(sig(sh, T0, "short").go);
  const long = sig(sh, T0 + 6 * MIN, "long");
  assert.ok(!long.go && long.reason === "queue");
  assert.ok(sig(sh, T0 + 6 * MIN, "short").go, "the Short itself goes on");
  // Background's daily share: 30% of 30 is 9.
  const share = emptyState();
  let n = 0;
  for (let i = 0; i < 60; i++)
    if (sig(share, T0 + i * 16 * MIN, "background").go) n++;
  assert.equal(n, 9);
  const refused = sig(share, T0 + 60 * 16 * MIN, "background");
  assert.ok(!refused.go && refused.reason === "share");
});

test("signed-in lane: long videos and background leave the last 30% of the day for Shorts", () => {
  const st = emptyState();
  let n = 0;
  for (let i = 0; i < 60; i++) if (sig(st, T0 + i * 16 * MIN, "long").go) n++;
  assert.equal(n, 21, "70% of 30");
  const long = sig(st, T0 + 60 * 16 * MIN, "long");
  assert.ok(!long.go && long.reason === "reserve");
  assert.ok(
    sig(st, T0 + 60 * 16 * MIN + 20 * MIN, "short").go,
    "a Short still has its reserve",
  );
});

test("signed-in lane: the measured window (requests since the last lift) is kept with each block", () => {
  const st = emptyState();
  for (let i = 0; i < 5; i++) assert.ok(sig(st, T0 + i * 16 * MIN, "short").go);
  assert.equal(
    afterCall(st, T0 + 2 * HOUR, "bot", false, s, "signed"),
    "started",
  );
  assert.equal(st.signed!.block!.calls, 5);
  assert.equal(st.signed!.days![new Date(T0).toISOString().slice(0, 10)], 5);
  st.signed!.block!.until = T0 + 3 * HOUR;
  assert.ok(sig(st, T0 + 3 * HOUR + 1, "short").go, "the probe");
  assert.equal(
    afterCall(st, T0 + 3 * HOUR + 1, "ok", true, s, "signed"),
    "lifted",
  );
  assert.equal(st.signed!.sinceLift, 0, "a new window starts at the lift");
  assert.equal(
    st.anonAfterLift,
    undefined,
    "a signed-in lift is not the anonymous lane's",
  );
});

test("priority: an episode's step sets it; children and the trend feed are background; nothing set is background", async () => {
  assert.equal(ytPriorityFor({ lane: "standard" } as never), "short");
  assert.equal(ytPriorityFor({ lane: "longform" } as never), "long");
  assert.equal(ytPriorityFor({ lane: "evergreen" } as never), "long");
  assert.equal(currentYtPriority("urgent", "fetcher"), "background");
  await withYtPriority("short", async () => {
    assert.equal(currentYtPriority("urgent", "clip"), "short");
    assert.equal(
      currentYtPriority("background", "clip"),
      "background",
      "a background child stays background",
    );
    assert.equal(currentYtPriority("urgent", "trend"), "background");
  });
});

// ---------------------------------------------------------------- failures not asked again

test("failures: a gone video is not asked again for a week on either lane; other failures 6 hours; a bot check until the pause ends", () => {
  const st = emptyState();
  assert.ok(isGoneVideo(GONE));
  assert.ok(!isGoneVideo(BOT));
  noteFailure(st, "anon", ["--dump-single-json", URL], T0, "other", GONE);
  assert.ok(
    recentFailure(st, "signed", [...SIGNED, "-f", "b", URL], T0 + DAY),
    "the video is gone for both lanes",
  );
  assert.equal(
    recentFailure(st, "signed", [...SIGNED, URL], T0 + 8 * DAY),
    undefined,
    "a week later it may be tried",
  );
  const search = [
    "--flat-playlist",
    "--dump-json",
    "ytsearch15:gta 6 cutscenes",
  ];
  noteFailure(
    st,
    "anon",
    search,
    T0,
    "other",
    "ERROR: Unable to download API page: HTTP Error 500",
  );
  assert.ok(recentFailure(st, "anon", search, T0 + 5 * HOUR));
  assert.equal(
    recentFailure(st, "signed", search, T0 + HOUR),
    undefined,
    "the other lane is not held",
  );
  assert.equal(recentFailure(st, "anon", search, T0 + 7 * HOUR), undefined);
  afterCall(st, T0, "bot", false, s, "anon");
  noteFailure(
    st,
    "anon",
    ["--dump-single-json", "https://youtu.be/YiiTOJZDWyA"],
    T0,
    "bot",
    BOT,
  );
  assert.ok(
    recentFailure(
      st,
      "anon",
      ["--dump-single-json", "https://youtu.be/YiiTOJZDWyA"],
      st.block!.until - 1,
    ),
  );
  noteFailure(st, "anon", search, T0, "age", "Sign in to confirm your age");
  noteFailure(st, "anon", search, T0, "cookies", "cookies are no longer valid");
});

function rig(
  o: {
    settings?: Partial<GuardSettings>;
    apiKey?: string;
    apiGet?: ApiGet;
    cls?: "urgent" | "background";
  } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytration-"));
  let now = T0;
  const g = createYtGuard({
    dir,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    rand: () => 0,
    settings: () => ({ ...guardSettings({}), ...o.settings }),
    cls: () => o.cls ?? "urgent",
    apiKey: () => o.apiKey ?? "",
    apiGet: o.apiGet,
  });
  return { g, dir, advance: (ms: number) => (now += ms), at: () => now };
}

const fail =
  (text: string, extra: Record<string, unknown> = {}) =>
  async () => {
    throw Object.assign(new Error("Command failed: yt-dlp"), {
      stderr: text,
      ...extra,
    });
  };

test("guard: a failed call is not asked again (no request), a timeout is not remembered", async () => {
  const { g, advance } = rig();
  await assert.rejects(
    g.run("yt-dlp", ["--dump-single-json", URL], fail(GONE)),
    /Command failed/,
  );
  let asked = 0;
  const count = async () => {
    asked++;
    return { stdout: "{}", stderr: "" };
  };
  advance(HOUR);
  await assert.rejects(
    g.run("yt-dlp", ["-f", "b", "-o", "/tmp/x.mp4", URL], count),
    (e: unknown) => isYtRecentFailure(e),
  );
  assert.equal(asked, 0, "YouTube was not asked");
  const other = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  await assert.rejects(
    g.run(
      "yt-dlp",
      ["--dump-single-json", other],
      fail("killed", { killed: true }),
    ),
  );
  advance(HOUR);
  await g.run("yt-dlp", ["--dump-single-json", other], count);
  assert.equal(asked, 1, "a timed-out call may be tried again");
});

test("guard: while the anonymous lane is retired no anonymous request is made; the retirement is logged once in the state", async () => {
  const { g, dir, advance } = rig();
  const st: GuardState = {
    ...emptyState(),
    anonRetired: { since: T0, until: T0 + 14 * DAY, liftFails: 2 },
    anonLiftFails: 2,
  };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(st));
  let asked = 0;
  const count = async () => {
    asked++;
    return { stdout: "{}", stderr: "" };
  };
  await assert.rejects(
    g.run("yt-dlp", ["--dump-single-json", URL], count),
    (e: unknown) => isYtPaused(e) && /retired/.test(String(e)),
  );
  assert.equal(asked, 0);
  assert.equal(g.anonOpen(), false);
  await g.run("yt-dlp", [...SIGNED, "--dump-single-json", URL], count);
  assert.equal(asked, 1, "the signed-in lane still fetches");
  advance(15 * DAY);
  assert.equal(g.anonOpen(), true);
});

test("guard: two failed lifts through real calls retire the lane and queue one owner line", async () => {
  const { g, dir, advance } = rig();
  const blocked: GuardState = {
    ...emptyState(),
    block: { since: T0 - 7 * HOUR, until: T0 - HOUR, strikes: 7 },
    anonLiftFails: 1,
  };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(blocked));
  await g.run("yt-dlp", ["--dump-single-json", URL], async () => ({
    stdout: "{}",
    stderr: "",
  }));
  assert.ok((await g.state()).anonAfterLift, "the probe lifted the block");
  advance(34_000);
  await assert.rejects(
    g.run(
      "yt-dlp",
      ["--dump-single-json", "https://youtu.be/YiiTOJZDWyA"],
      fail(BOT),
    ),
  );
  const st = await g.state();
  assert.ok(st.anonRetired, "retired");
  assert.equal(st.alerts.filter((a) => /retired anonymous/.test(a)).length, 1);
});

test("guard: an episode's priority reaches the signed-in lane through the call chain", async () => {
  const { g, advance } = rig();
  const ok = async () => ({ stdout: "{}", stderr: "" });
  await withYtPriority("short", () =>
    g.run("yt-dlp", [...SIGNED, "--dump-single-json", URL], ok),
  );
  advance(6 * MIN);
  await assert.rejects(
    g.run(
      "yt-dlp",
      [...SIGNED, "--dump-single-json", "https://youtu.be/YiiTOJZDWyA"],
      ok,
    ),
    (e: unknown) => isYtPaused(e) && /background work waits/.test(String(e)),
    "background yields while the Short is being made",
  );
});

// ---------------------------------------------------------------- searches through the Data API

test("API search: the searches it understands, and the ones it leaves to yt-dlp", () => {
  const dump = parseSearchCall(
    [
      "--encoding",
      "utf-8",
      "--no-warnings",
      "--flat-playlist",
      "--dump-json",
      "ytsearch15:gta 6 cutscenes",
    ],
    T0,
  );
  assert.deepEqual(dump, {
    query: "gta 6 cutscenes",
    max: 15,
    order: "relevance",
    output: { kind: "dump" },
  });
  const demand = parseSearchCall(
    [
      "--flat-playlist",
      "--playlist-end",
      "20",
      "--print",
      "%(id)s\t%(view_count)s\t%(channel)s\t%(title)s",
      "https://www.youtube.com/results?search_query=Steam%20Deck&sp=CAMSAggD",
    ],
    T0,
  );
  assert.equal(demand!.query, "Steam Deck");
  assert.equal(demand!.max, 20);
  assert.equal(demand!.order, "viewCount");
  assert.equal(demand!.publishedAfter, "2026-11-18T12:00:00Z");
  const cc = parseSearchCall(
    [
      "--flat-playlist",
      "--playlist-end",
      "15",
      "--print",
      "%(id)s\t%(channel_id)s\t%(channel)s\t%(title)s",
      "https://www.youtube.com/results?search_query=gta&sp=EgIwAQ%253D%253D",
    ],
    T0,
  );
  assert.equal(cc!.creativeCommons, true);
  assert.equal(
    parseSearchCall(
      [...SIGNED, "--flat-playlist", "--dump-json", "ytsearchdate5:x"],
      T0,
    )!.order,
    "date",
  );
  // Left alone: not flat, a download, an unknown filter or flag, a template it cannot fill, a video link.
  assert.equal(parseSearchCall(["--dump-json", "ytsearch5:x"], T0), undefined);
  assert.equal(
    parseSearchCall(
      [
        "--flat-playlist",
        "--dump-json",
        "https://www.youtube.com/results?search_query=x&sp=EgQIAhAB",
      ],
      T0,
    ),
    undefined,
  );
  assert.equal(
    parseSearchCall(
      ["--flat-playlist", "--dump-json", "--match-filter", "x", "ytsearch5:x"],
      T0,
    ),
    undefined,
  );
  assert.equal(
    parseSearchCall(
      ["--flat-playlist", "--print", "%(title).20s", "ytsearch5:x"],
      T0,
    ),
    undefined,
  );
  assert.equal(
    parseSearchCall(["--flat-playlist", "--dump-json", URL], T0),
    undefined,
  );
  assert.equal(
    parseSearchCall(["-f", "b", "-o", "/tmp/a.mp4", "ytsearch1:x"], T0),
    undefined,
  );
  assert.ok(printableTemplate("%(id)s\t%(title)s"));
  assert.ok(!printableTemplate("%(like_count)s"));
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("P1DT1S"), 86401);
  assert.equal(isoSeconds("bad"), undefined);
});

function fakeApi(o: { fail?: number; reason?: string } = {}) {
  const urls: string[] = [];
  const get: ApiGet = async (url) => {
    urls.push(url);
    if (o.fail)
      return {
        ok: false,
        status: o.fail,
        json: async () => ({
          error: { errors: [{ reason: o.reason ?? "backendError" }] },
        }),
      };
    if (url.includes("/search?"))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: { videoId: "aaaaaaaaaaa" },
              snippet: {
                title: "GTA 6 &amp; All Cutscenes",
                channelId: "UC1",
                channelTitle: "Maxi",
                liveBroadcastContent: "none",
              },
            },
            {
              id: { videoId: "bbbbbbbbbbb" },
              snippet: {
                title: "Live now",
                channelId: "UC2",
                channelTitle: "Live",
                liveBroadcastContent: "live",
              },
            },
            { id: { kind: "youtube#channel" } },
          ],
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "aaaaaaaaaaa",
            snippet: {
              title: "GTA 6 & All Cutscenes",
              channelId: "UC1",
              channelTitle: "Maxi",
              description: "d",
              liveBroadcastContent: "none",
            },
            contentDetails: { duration: "PT2H30M" },
            statistics: { viewCount: "346258" },
          },
        ],
      }),
    };
  };
  return { get, urls };
}

test("API search: answers in yt-dlp's own shape (flat JSON lines, or the --print template with NA for gaps)", async () => {
  const api = fakeApi();
  const dump = await apiSearch(
    parseSearchCall(
      ["--flat-playlist", "--dump-json", "ytsearch15:gta 6 cutscenes"],
      T0,
    )!,
    "KEY",
    api.get,
  );
  const rows = dump
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(rows.length, 2, "the channel result is dropped");
  assert.equal(rows[0].id, "aaaaaaaaaaa");
  assert.equal(rows[0].title, "GTA 6 & All Cutscenes");
  assert.equal(rows[0].duration, 9000);
  assert.equal(rows[0].view_count, 346258);
  assert.equal(rows[0].uploader, "Maxi");
  assert.equal(rows[1].live_status, "is_live");
  assert.equal(
    rows[1].title,
    "Live now",
    "a video missing from the details keeps the search snippet",
  );
  assert.equal(rows[1].view_count, null);
  assert.match(api.urls[0]!, /type=video/);
  assert.match(api.urls[0]!, /maxResults=15/);
  const tpl = "%(id)s\t%(view_count)s\t%(channel)s\t%(title)s";
  const printed = await apiSearch(
    parseSearchCall(
      [
        "--flat-playlist",
        "--playlist-end",
        "20",
        "--print",
        tpl,
        "https://www.youtube.com/results?search_query=GTA&sp=CAMSAggD",
      ],
      T0,
    )!,
    "KEY",
    fakeApi().get,
  );
  assert.equal(
    printed,
    "aaaaaaaaaaa\t346258\tMaxi\tGTA 6 & All Cutscenes\nbbbbbbbbbbb\tNA\tLive\tLive now\n",
  );
  assert.equal(
    renderTemplate("%(duration)s", { duration: null } as never),
    "NA",
  );
});

test("guard: a search goes to the Data API (no page request), is kept, and the key never appears in a log or error", async () => {
  const api = fakeApi();
  const { g } = rig({ apiKey: "SECRET-KEY", apiGet: api.get });
  let asked = 0;
  const page = async () => {
    asked++;
    return { stdout: "page\n", stderr: "" };
  };
  const args = ["--flat-playlist", "--dump-json", "ytsearch15:gta 6 cutscenes"];
  const r = await g.run("yt-dlp", args, page);
  assert.equal(asked, 0, "no page request");
  assert.equal(String(r.stdout).trim().split("\n").length, 2);
  await g.run("yt-dlp", args, page);
  assert.equal(
    api.urls.length,
    2,
    "the second time comes from the kept answer",
  );
  const st = await g.state();
  assert.equal(st.api!.used, 1);
  assert.equal(st.api!.day, pacificDay(T0));
  assert.ok(!JSON.stringify(st).includes("SECRET-KEY"));
  // The API refusing: the search goes the usual way, and the error never carries the key.
  const bad = fakeApi({ fail: 403, reason: "quotaExceeded" });
  const r2 = rig({ apiKey: "SECRET-KEY", apiGet: bad.get });
  const lines: string[] = [];
  const orig = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const fallback = await r2.g.run("yt-dlp", args, page);
    assert.equal(fallback.stdout, "page\n");
  } finally {
    console.log = orig;
    console.error = origErr;
  }
  assert.ok(
    !lines.join("\n").includes("SECRET-KEY"),
    "the key is never logged",
  );
  assert.equal(
    (await r2.g.state()).api!.used,
    40,
    "quota spent: no more API searches today",
  );
  assert.equal(asked, 1);
});

test("API search allowance: YT_API_SEARCHES_PER_DAY a Pacific day, background half of it", () => {
  const st = emptyState();
  const set = { ...s, apiSearchesPerDay: 4 };
  assert.ok(takeApiSearch(st, T0, "background", set));
  assert.ok(takeApiSearch(st, T0, "background", set));
  assert.ok(!takeApiSearch(st, T0, "background", set), "background takes half");
  assert.ok(takeApiSearch(st, T0, "short", set));
  assert.ok(takeApiSearch(st, T0, "long", set));
  assert.ok(
    !takeApiSearch(st, T0, "short", set),
    "the day's allowance is used",
  );
  assert.ok(takeApiSearch(st, T0 + DAY, "short", set), "a new Pacific day");
  assert.ok(
    !takeApiSearch(emptyState(), T0, "short", { ...s, apiSearchesPerDay: 0 }),
  );
});

test("no fallback to anonymous after a signed-in try anywhere in the source", () => {
  const src = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
  );
  const build = fs.readFileSync(
    path.join(src, "sceneindex", "build.ts"),
    "utf8",
  );
  assert.ok(!/trying anonymously/.test(build));
  const signin = fs.readFileSync(path.join(src, "lib", "ytsignin.ts"), "utf8");
  assert.ok(!/trying anonymously/.test(signin));
});

// ---------------------------------------------------------------- review fixes

test("the soft rate limit is a wall (a bot check), never a gone video; local faults are not remembered", () => {
  const soft = "ERROR: [youtube] jNQXAC9IVRw: Video unavailable. This content isn't available, try again later.";
  assert.ok(isBotCheck(soft));
  assert.ok(isBotCheck("The current session has been rate-limited by YouTube for up to an hour"));
  assert.ok(!isGoneVideo(soft), "a throttled video is not blacklisted for a week");
  const st = emptyState();
  noteFailure(st, "anon", ["--dump-single-json", URL], T0, "other", "spawn yt-dlp ENOENT");
  assert.equal(st.failures, undefined, "yt-dlp missing on our side: the call may go again at once");
  noteFailure(st, "anon", ["--dump-single-json", URL], T0, "other", "ERROR: [youtube] jNQXAC9IVRw: Requested format is not available");
  assert.ok(recentFailure(st, "anon", ["--dump-single-json", URL], T0 + HOUR), "YouTube's own answer is remembered");
});

test("the Shorts' footage wait sees a retired anonymous lane as far too long to wait for", () => {
  const st = emptyState();
  assert.equal(anonClosedWindow(st, T0, s), undefined);
  st.block = { since: T0 - HOUR, until: T0 + HOUR, strikes: 1 };
  assert.deepEqual(anonClosedWindow(st, T0, s), { since: T0 - HOUR, until: T0 + HOUR });
  st.anonRetired = { since: T0, until: T0 + 14 * DAY, liftFails: 2 };
  assert.equal(anonClosedWindow(st, T0, s)!.until, T0 + 14 * DAY);
  assert.equal(anonClosedWindow(emptyState(), T0, { ...s, anonLane: "off" })!.until, T0 + 365 * DAY);
  assert.deepEqual(anonClosedWindow(st, T0, { ...s, anonLane: "on" }), { since: T0 - HOUR, until: T0 + HOUR });
});

test("API search: a finished livestream is was_live; a per-second limit is not the day's quota; a bare --print field is left to yt-dlp", async () => {
  const get: ApiGet = async (url) =>
    url.includes("/search?")
      ? { ok: true, status: 200, json: async () => ({ items: [{ id: { videoId: "ccccccccccc" }, snippet: { title: "VOD", liveBroadcastContent: "none" } }] }) }
      : {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: "ccccccccccc", snippet: { title: "VOD" }, liveStreamingDetails: { actualEndTime: "2026-11-20T00:00:00Z" } }] }),
        };
  const out = await apiSearch(parseSearchCall(["--flat-playlist", "--dump-json", "ytsearch5:gta"], T0)!, "KEY", get);
  assert.equal(JSON.parse(out.trim()).live_status, "was_live");
  assert.ok(isApiQuotaError("YouTube Data API search HTTP 403 quotaExceeded"));
  assert.ok(!isApiQuotaError("YouTube Data API search HTTP 403 rateLimitExceeded"));
  assert.equal(parseSearchCall(["--flat-playlist", "--print", "id", "ytsearch5:gta"], T0), undefined);
});
