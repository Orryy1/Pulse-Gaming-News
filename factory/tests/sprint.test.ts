import { test } from "node:test";
import assert from "node:assert/strict";
import { showcaseLive, slotsLeftToday } from "../src/lanes.ts";

const story = (headline: string, minutesAgo: number, now: Date) => ({
  cluster: {
    headline,
    items: [],
    newestAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  } as any,
  sighting: {
    first_seen: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  },
});

test("a showcase is live once two fresh stories come from it", () => {
  const now = new Date("2026-10-20T21:30:00Z");
  assert.equal(
    showcaseLive(
      [story("Metroid Prime 5 revealed in today's Nintendo Direct", 20, now)],
      now,
    ),
    undefined,
    "one story is not a showcase",
  );
  assert.equal(
    showcaseLive(
      [
        story("Metroid Prime 5 revealed in today's Nintendo Direct", 20, now),
        story("Every announcement from the Nintendo Direct", 40, now),
        story("Saros update out now", 10, now),
      ],
      now,
    ),
    "nintendo direct",
  );
  assert.equal(
    showcaseLive(
      [
        story("State of Play recap", 300, now),
        story("Everything shown at State of Play", 320, now),
      ],
      now,
    ),
    undefined,
    "a showcase from five hours ago is over",
  );
});

test("slots still to come today are counted in the channel's time zone", () => {
  const now = new Date("2026-10-20T15:00:00Z"); // 16:00 in London
  assert.equal(
    slotsLeftToday(
      now,
      ["13:00", "17:00", "22:00", "20:00", "16:30"],
      "Europe/London",
    ),
    4,
  );
  assert.equal(
    slotsLeftToday(
      new Date("2026-10-20T20:30:00Z"),
      ["13:00", "17:00", "22:00"],
      "Europe/London",
    ),
    1,
  );
});

test("uploads still due today count the deals slot on deals days and the long video on its day", async () => {
  const { uploadsLeftToday } = await import("../src/pipeline.ts");
  const { testConfig } = await import("./helpers.ts");
  const cfg = {
    ...testConfig("."),
    timezone: "Europe/London",
    newsSlots: ["13:00", "17:00", "22:00"],
    weeklySlot: "20:00",
    dealsSlot: "16:30",
    dealsDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    longformEnabled: true,
    longformDays: ["sun"],
    longformSlot: "19:00",
  };
  // Monday 20 Oct 2026, 15:00 London: 16:30 deals, 17:00, 20:00, 22:00 still to come.
  assert.equal(
    uploadsLeftToday(cfg as any, new Date("2026-10-20T14:00:00Z")),
    4,
  );
  // Sunday 25 Oct (clocks back, so London is UTC): no deals, but the 19:00 long video.
  assert.equal(
    uploadsLeftToday(cfg as any, new Date("2026-10-25T15:00:00Z")),
    4,
  );
});

test("slots after YouTube's quota reset are not reserved against tonight's quota", async () => {
  const { uploadsLeftToday, spareUnits } = await import("../src/pipeline.ts");
  const { testConfig } = await import("./helpers.ts");
  const cfg = {
    ...testConfig("."),
    timezone: "Europe/London",
    newsSlots: ["13:00", "17:00", "22:00"],
    weeklySlot: "20:00",
    dealsSlot: "16:30",
    dealsDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    longformEnabled: false,
    longformDays: [],
    longformSlot: "19:00",
    quotaUnitsPerDay: 10000,
  };
  // Wednesday 21 Oct 2026, 05:30 London: the quota resets at 08:00 London, every slot today comes after it.
  assert.equal(
    uploadsLeftToday(cfg as any, new Date("2026-10-21T04:30:00Z")),
    0,
  );
  // Tuesday 20 Oct, 21:30 London: only the 22:00 news slot is left before the reset.
  assert.equal(
    uploadsLeftToday(cfg as any, new Date("2026-10-20T20:30:00Z")),
    1,
  );
  // 6,616 used, nothing due, nothing in flight: room for one more upload, not two.
  const spare = spareUnits(cfg as any, 6616, 0, 0);
  assert.equal(spare, 3384);
  assert.ok(spare >= 1720 && spare - 1720 < 1720);
  assert.ok(
    spareUnits(cfg as any, 6616, 0, 1) < 1720,
    "an episode still in production keeps its upload's units",
  );
});

test("the channel focus reaches the editors until its end date, then stops", async () => {
  const { focusBlock } = await import("../src/pipeline.ts");
  const { testConfig } = await import("./helpers.ts");
  const cfg = {
    ...testConfig("."),
    focusTopic: "Grand Theft Auto",
    focusUntil: "2026-11-26",
    focusNote: "GTA 6 launches November 19.",
  };
  assert.match(
    focusBlock(cfg as any, new Date("2026-10-21T12:00:00Z")),
    /Grand Theft Auto.*November 19.*Never pick a weak story/s,
  );
  assert.equal(focusBlock(cfg as any, new Date("2026-11-27T12:00:00Z")), "");
  assert.equal(
    focusBlock(
      { ...cfg, focusTopic: "" } as any,
      new Date("2026-10-21T12:00:00Z"),
    ),
    "",
  );
});

test("videos join their series playlists, and focus videos the focus playlist while it runs", async () => {
  const { seriesFor, launchWave, focusMatch } =
    await import("../src/pipeline.ts");
  const { testConfig, goodScript } = await import("./helpers.ts");
  const cfg = {
    ...testConfig("."),
    timezone: "Europe/London",
    focusTopic: "Grand Theft Auto",
    focusUntil: "2026-11-26",
    focusMatch: "grand theft auto|gta",
    focusPlaylist: "GTA 6: Everything Before Launch",
    waveFrom: "2026-11-17",
    waveTo: "2026-11-21",
  };
  const now = new Date("2026-10-22T12:00:00Z");
  const titles = (ep: any) =>
    seriesFor(cfg as any, ep, now).map((x) => x.title);
  assert.deepEqual(
    titles({ lane: "news", story_hash: "x", script_json: goodScript() }),
    ["Gaming News Today"],
  );
  assert.deepEqual(
    titles({
      lane: "news",
      story_hash: "why:gta-4",
      script_json: goodScript({
        game_title: "Grand Theft Auto IV",
        headline: "Why Rockstar Skips GTA 4",
      }),
    }),
    ["The Why: Gaming's Biggest Questions", "GTA 6: Everything Before Launch"],
  );
  assert.deepEqual(
    titles({
      lane: "longform",
      story_hash: "x",
      script_json: { ...goodScript(), runtime: "long" },
    }),
    ["Every Game Ranked: Worst to Best"],
  );
  assert.deepEqual(
    titles({
      lane: "longform",
      story_hash: "x",
      script_json: { ...goodScript(), runtime: "long", recap: true },
    }),
    ["The Pulse Weekly: This Week in Gaming"],
  );
  assert.equal(
    seriesFor(
      cfg as any,
      {
        lane: "news",
        story_hash: "x",
        script_json: goodScript({ game_title: "GTA 6" }),
      } as any,
      new Date("2026-12-01T12:00:00Z"),
    ).length,
    1,
    "the focus playlist ends with the focus",
  );
  assert.equal(launchWave(cfg as any, now), false);
  assert.equal(launchWave(cfg as any, new Date("2026-11-19T12:00:00Z")), true);
  assert.equal(focusMatch(cfg as any, "GTA 6 review scores are in"), true);
  assert.equal(focusMatch(cfg as any, "Agatha's new game"), false);
});
