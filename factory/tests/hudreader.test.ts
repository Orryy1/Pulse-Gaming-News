import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers.ts";
import { hudSettings, hudSummary } from "../src/hudreader/settings.ts";
import {
  CLEAR_SECONDS,
  PROFILE_DIR,
  airEvents,
  areaEvents,
  buildTrack,
  loadProfile,
  moneyEvents,
  textEvents,
  wantedEvents,
  type HudProfile,
  type RawSample,
  type RawTelemetry,
} from "../src/hudreader/telemetry.ts";
import {
  collectibleRuns,
  journeys,
  measuredFacts,
  sayDistance,
  sayDuration,
  wantedSpells,
} from "../src/hudreader/facts.ts";
import { pinFor } from "../src/hudreader/where.ts";
import {
  moveSpots,
  spotFromPin,
  withSpot,
  addSpot,
  readSpots,
} from "../src/hudreader/spots.ts";
import {
  auditOverlay,
  buildOverlay,
  hasOverlay,
  PIN_SECONDS,
} from "../src/hudreader/overlay.ts";
import {
  hudSignals,
  liveHudSignals,
  scoreHudEvent,
} from "../src/hudreader/signal.ts";
import {
  sourceToShort,
  spotsOnPicture,
  starsOnShort,
} from "../src/hudreader/dayn.ts";
import {
  commandFor,
  estimateMinutes,
  lastJson,
  readArgs,
} from "../src/hudreader/run.ts";
import { profileFor } from "../src/hudreader/job.ts";
import { LiveDetector, type DetectOptions } from "../src/liveclips/detect.ts";
import { servedHud } from "../src/render/render.ts";
import { starsAt } from "../src/render/components/hud/HudOverlay.tsx";

const PROFILE: HudProfile = {
  game: "gta5",
  label: "GTA V",
  calibrated: true,
  events: [
    {
      kind: "wasted",
      region: "centre",
      pattern: "\\bwasted\\b",
      label: "Wasted",
    },
    {
      kind: "mission_passed",
      region: "banner|centre",
      pattern: "mission\\s+passed",
      label: "Mission passed",
    },
    {
      kind: "collectible",
      region: "banner",
      pattern: "(\\d{1,3})\\s*/\\s*(\\d{1,3})",
      label: "Collected",
    },
    {
      kind: "stunt",
      region: "banner|centre",
      pattern: "under\\s+the\\s+bridge",
      label: "Stunt",
    },
  ],
  areaPattern: "^[A-Z][A-Za-z'. ]{2,30}$",
  ignoreText: "^(browse|back|select)$",
  metresPerUnit: null,
};

const hud = (t: number, o: Partial<RawSample> = {}): RawSample => ({
  t,
  state: "hud",
  stars: 0,
  ...o,
});
const raw = (samples: RawSample[]): RawTelemetry => ({
  version: 1,
  game: "gta5",
  video: "v.mp4",
  width: 1920,
  height: 1080,
  fps: 2,
  start: 0,
  duration: samples.length / 2,
  matcher: "sift",
  ocr: { engine: "off", reads: 0 },
  stats: {},
  seconds: 1,
  places: [],
  islands: {},
  samples,
});

// ------------------------------------------------------------------ settings

test("the HUD reader and every output are off by default; the summary says so", () => {
  const s = hudSettings({}, "win32", "C:/Users/x");
  assert.equal(s.enabled, false);
  assert.equal(s.liveSignal || s.pin || s.ticker || s.endMap || s.facts, false);
  assert.equal(s.runner, "orch");
  assert.equal(s.matcher, "sift");
  assert.equal(hudSummary(s), "off");
  const mac = hudSettings(
    { HUD_READER: "true", HUD_PIN: "1", HUD_READER_MATCHER: "lightglue" },
    "darwin",
    "/Users/m",
  );
  assert.equal(mac.runner, "mac");
  assert.equal(mac.python, "/Users/m/PulseFactory/parallax/bin/python");
  assert.match(hudSummary(mac), /lightglue.*via mac.*pin/);
  assert.equal(hudSettings({ HUD_READER_FPS: "99" }).fps, 10);
});

test("the shipped profiles parse, their patterns compile, GTA V is calibrated and GTA VI waits for calibration", async () => {
  const v = await loadProfile("gta5");
  const vi = await loadProfile("gta6");
  assert.equal(v.calibrated, true);
  assert.equal(vi.calibrated, false);
  for (const p of [v, vi]) {
    for (const e of p.events)
      assert.doesNotThrow(() => new RegExp(e.pattern, "i"));
    assert.doesNotThrow(() => new RegExp(p.areaPattern ?? ""));
  }
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROFILE_DIR, "gta5.json"), "utf8"),
  );
  assert.match("$43,852", new RegExp(raw.money.pattern));
  assert.match("+$500", new RegExp(raw.money.deltaPattern));
  assert.match(
    "22 / 50 Bridges flown under",
    new RegExp(v.events.find((e) => e.kind === "collectible")!.pattern),
  );
});

// ------------------------------------------------------------------ the wanted level

test("a star count must hold two samples, flashing stars are a search, and clearing waits", () => {
  const s: RawSample[] = [
    hud(0),
    hud(0.5, { stars: 1 }), // one flicker: no event
    hud(1),
    hud(1.5, { stars: 2 }),
    hud(2, { stars: 2 }), // held: 0 -> 2
    { t: 2.5, state: "menu" }, // a menu changes nothing
    hud(3, { stars: 4 }),
    hud(3.5, { stars: 4 }), // 2 -> 4
    hud(4, { stars: 0, dim: 4 }), // the search
    hud(4.5, { stars: 0, dim: 4 }),
    hud(5, { stars: 0 }),
    hud(5.5, { stars: 0 }),
    hud(6, { stars: 0 }),
    hud(7.5, { stars: 0 }), // 3 s after the last star seen
  ];
  const { events, level } = wantedEvents(s);
  assert.deepEqual(
    events.map((e) => [e.kind, e.value]),
    [
      ["wanted_start", 2],
      ["wanted_up", 4],
      ["searching", 4],
      ["wanted_clear", 0],
    ],
  );
  assert.equal(level.get(2.5)!.stars, 2);
  assert.equal(level.get(4.5)!.searching, true);
  assert.equal(level.get(7.5)!.stars, 0);
  assert.ok(events[3]!.t <= 7.5 - CLEAR_SECONDS + 0.01);
});

test("stars that come back during the search end the search without a new spell", () => {
  const { events } = wantedEvents([
    hud(0, { stars: 3 }),
    hud(0.5, { stars: 3 }),
    hud(1, { dim: 3 }),
    hud(1.5, { stars: 3 }),
    hud(2, { stars: 3 }),
  ]);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["wanted_start", "searching"],
  );
});

// ------------------------------------------------------------------ banners, money, areas, flight

test("banners become events once, collectibles keep their count and total, junk is ignored", () => {
  const banner = (t: number, lines: string[]) =>
    hud(t, { texts: { banner: lines } });
  const ev = textEvents(
    [
      banner(906.5, ["UndeR the bRidge", "22 / 50 Bridges flown under"]),
      banner(907, ["UndeR the bRidge", "22 / 50 Bridges flown under"]),
      banner(930, ["UndeR the bRidge", "23 / 50 Bridges flown under"]),
      hud(940, { texts: { centre: ["WASTED"] } }),
      banner(941, ["99 / 50"]), // impossible count
    ],
    PROFILE,
  );
  assert.deepEqual(
    ev.map((e) => [e.kind, e.value ?? null, e.total ?? null]),
    [
      ["collectible", 22, 50],
      ["stunt", null, null],
      ["collectible", 23, 50],
      ["stunt", null, null],
      ["wasted", null, null],
    ],
  );
});

test("money changes need the game's own line or two agreeing readings", () => {
  const ev = moneyEvents([
    hud(0, { money: 43852 }),
    hud(1, { money: 43852 }),
    hud(2, { money: 48852 }), // one reading: not yet
    hud(3, { money: 48852 }), // confirmed: +5,000
    hud(4, { money: 41852 }),
    hud(5, { money: 48852 }), // a misread that did not hold
    hud(20, { moneyDelta: -2000 }),
  ]);
  assert.deepEqual(
    ev.map((e) => e.value),
    [5000, -2000],
  );
  assert.match(ev[0]!.detail, /\+\$5,000/);
});

test("area names are read once per stay and the menu words are ignored", () => {
  const ev = areaEvents(
    [
      hud(1, { texts: { area: ["La Puerta"] } }),
      hud(5, { texts: { area: ["La Puerta"] } }),
      hud(9, { texts: { area: ["back"] } }),
      hud(12, { texts: { area: ["Pillbox Hill"] } }),
    ],
    PROFILE,
  );
  assert.deepEqual(
    ev.map((e) => e.text),
    ["La Puerta", "Pillbox Hill"],
  );
});

test("flight starts and ends only when the altimeter holds", () => {
  const ev = airEvents([
    hud(0),
    hud(1, { air: true }),
    hud(2),
    hud(3, { air: true }),
    hud(4, { air: true }),
    hud(5, { air: true }),
  ]);
  assert.deepEqual(
    ev.map((e) => e.kind),
    ["air_start"],
  );
});

// ------------------------------------------------------------------ the track and facts

const drive = (
  n: number,
  o: { from?: number; island?: number; step?: number } = {},
) =>
  Array.from({ length: n }, (_, i) =>
    hud((o.from ?? 0) + i * 0.5, {
      mm: {
        island: o.island ?? 1,
        x: i * (o.step ?? 10),
        y: 0,
        heading: 0,
        zoom: 1,
        how: "refined",
      },
    }),
  );

test("the track measures speed and drops impossible jumps", () => {
  const s = drive(6);
  s[3] = hud(1.5, {
    mm: { island: 1, x: 5000, y: 0, heading: 0, zoom: 1, how: "f2f" },
  });
  const tr = buildTrack(raw(s), PROFILE);
  assert.equal(tr.points[1]!.speed, 20);
  assert.equal(
    tr.points[3]!.x,
    undefined,
    "a 5,000-unit jump in half a second is not a drive",
  );
  assert.equal(tr.quality.hudShare, 1);
  assert.equal(tr.quality.placedShare, 0.833);
});

test("wanted spells, journeys and collectible runs make measured facts in the channel's words", () => {
  const s: RawSample[] = [
    ...drive(80, { step: 8 }).map((x, i) =>
      i >= 10 && i < 40 ? { ...x, stars: i < 20 ? 1 : 3 } : x,
    ),
  ];
  s[60] = {
    ...s[60]!,
    texts: { banner: ["under the bridge", "22 / 50 Bridges flown under"] },
  };
  s[75] = {
    ...s[75]!,
    texts: { banner: ["under the bridge", "25 / 50 Bridges flown under"] },
  };
  const tr = buildTrack(raw(s), PROFILE);
  const spells = wantedSpells(tr);
  assert.equal(spells.length, 1);
  assert.equal(spells[0]!.peak, 3);
  assert.equal(spells[0]!.endedBy, "lost them");
  const js = journeys(tr);
  assert.equal(js.length, 1);
  assert.equal(js[0]!.distance, 79 * 8);
  const runs = collectibleRuns(tr.events);
  assert.equal(runs[0]!.count, 3);
  assert.equal(runs[0]!.label, "Bridges flown under");
  const facts = measuredFacts(tr);
  assert.ok(
    facts.some(
      (f) =>
        f.kind === "wanted" &&
        /^Lost a 3-star wanted level in \d+ seconds$/.test(f.text),
    ),
  );
  assert.ok(facts.some((f) => f.kind === "wanted_climb"));
  // No metres until the map scale is measured.
  assert.ok(
    facts.some(
      (f) =>
        f.kind === "journey" &&
        /without a stop/.test(f.text) &&
        f.unit === "seconds",
    ),
  );
  assert.ok(
    measuredFacts(tr, { metresPerUnit: 2 }).some(
      (f) =>
        f.kind === "journey" && f.unit === "metres" && /1\.3 km/.test(f.text),
    ),
  );
  assert.ok(
    facts.some(
      (f) =>
        f.kind === "collectibles" &&
        /^Bridges flown under: 3 more in/.test(f.text),
    ),
  );
  for (const f of facts) assert.doesNotMatch(f.text, /[\u2013\u2014]/);
});

test("durations and distances are said the way the channel says them", () => {
  assert.equal(sayDuration(48.4), "48 seconds");
  assert.equal(sayDuration(187), "3 minutes");
  assert.equal(sayDuration(195), "just over 3 minutes");
  assert.equal(sayDuration(210), "3 and a half minutes");
  assert.equal(sayDuration(5400), "about an hour and a half");
  assert.equal(sayDistance(812), "810 metres");
  assert.equal(sayDistance(2440), "2.4 km");
});

// ------------------------------------------------------------------ where, spots, overlay

test("a pin is the median placed spot, named from the screen first, then the atlas, never invented", () => {
  const s = drive(20, { step: 2 });
  s[5] = hud(2.5, {
    mm: { island: 1, x: 9000, y: 9000, heading: 0, zoom: 1, how: "relocated" },
  }); // an outlier
  const tr = buildTrack(raw(s), PROFILE);
  const p = pinFor(tr, 0, 10, [
    { name: "Vespucci Canals", island: 1, x: 300, y: 0, seen: 3 },
  ])!;
  assert.ok(Math.abs(p.x - 20) <= 4);
  assert.equal(p.label, "near Vespucci Canals");
  assert.equal(p.labelSource, "atlas");
  const none = pinFor(tr, 0, 10, [
    { name: "Far Away", island: 1, x: 5000, y: 0, seen: 1 },
  ])!;
  assert.equal(none.label, undefined);
  assert.equal(none.labelSource, "none");
  const s2 = drive(10);
  s2[4] = { ...s2[4]!, texts: { area: ["Pillbox Hill"] } };
  const named = pinFor(buildTrack(raw(s2), PROFILE), 0, 5)!;
  assert.equal(named.label, "Pillbox Hill");
  assert.equal(
    pinFor(buildTrack(raw([hud(0), hud(1)]), PROFILE), 0, 5),
    undefined,
  );
});

test("the spot book keeps one spot a day, follows island merges and is saved", async () => {
  const pin = {
    island: 2,
    x: 10,
    y: 20,
    label: "Pier",
    labelSource: "screen" as const,
    confidence: 0.9,
    t: 5,
  };
  let book = withSpot(
    { game: "gta6", spots: [] },
    spotFromPin(pin, {
      day: 3,
      episode: "e3",
      video: "c.mp4",
      at: new Date(0),
    }),
  );
  book = withSpot(
    book,
    spotFromPin(
      { ...pin, x: 11 },
      { day: 3, episode: "e3b", video: "c.mp4", at: new Date(0) },
    ),
  );
  book = withSpot(
    book,
    spotFromPin(pin, {
      day: 1,
      episode: "e1",
      video: "c.mp4",
      at: new Date(0),
    }),
  );
  assert.deepEqual(
    book.spots.map((s) => [s.day, s.episode]),
    [
      [1, "e1"],
      [3, "e3b"],
    ],
  );
  const moved = moveSpots(book, [
    [
      2,
      1,
      [
        [1, 0, 100],
        [0, 1, 50],
        [0, 0, 1],
      ],
    ],
  ]);
  assert.deepEqual(
    [moved.spots[0]!.island, moved.spots[0]!.x, moved.spots[0]!.y],
    [1, 110, 70],
  );
  const dir = await tmpDir();
  await addSpot(dir, "gta6", book.spots[0]!);
  assert.equal((await readSpots(dir, "gta6")).spots.length, 1);
});

test("the overlay draws only what is switched on and sure, and the audit holds it to the graphics rules", () => {
  const base = {
    durationSeconds: 20,
    clipStart: 0,
    day: 4,
    pin: {
      label: "Vespucci Canals",
      confidence: 0.9,
      crop: { image: "hud/pin.png", x: 0.5, y: 0.5 },
    },
    stars: [
      { t: 0, stars: 0 },
      { t: 3, stars: 2 },
      { t: 3.4, stars: 3 },
      { t: 9, stars: 0 },
    ],
    endMap: {
      image: "hud/atlas/island_1.png",
      width: 800,
      height: 600,
      spots: [{ x: 0.2, y: 0.3, day: 4, today: true }],
    },
    switches: { pin: true, ticker: true, endMap: true },
    minConfidence: 0.6,
    accent: "#FF6B1A",
  };
  const o = buildOverlay(base);
  assert.equal(o.pin!.until, PIN_SECONDS);
  assert.equal(o.pin!.sub, "GTA 6 Day 4");
  assert.equal(o.endMap!.title, "Day 4: 1 spot so far");
  const a = auditOverlay(o, {
    durationSeconds: 20,
    hookEnd: 1.8,
    payoffAt: 15.1,
  });
  // Two changes 0.4 s apart cannot both be read: merged into the later level.
  assert.deepEqual(
    a.props.ticker!.changes.map((c) => c.stars),
    [0, 3, 0],
  );
  // The end map would cover the result stamp: moved after it, still long enough.
  assert.ok(Math.abs(a.props.endMap!.from - 17.5) < 1e-9);
  assert.ok(a.findings.some((f) => f.key === "hud_endmap" && f.check === "clash"));
  assert.ok(
    a.findings.some((f) => f.key === "hud_ticker" && f.check === "reading"),
  );
  assert.equal(
    buildOverlay({ ...base, pin: { ...base.pin, confidence: 0.3 } }).pin,
    undefined,
  );
  assert.equal(
    buildOverlay({ ...base, stars: [{ t: 0, stars: 0 }] }).ticker,
    undefined,
    "a row of empty stars says nothing",
  );
  assert.equal(
    hasOverlay(
      buildOverlay({
        ...base,
        switches: { pin: false, ticker: false, endMap: false },
      }),
    ),
    false,
  );
  const late = auditOverlay(buildOverlay(base), {
    durationSeconds: 20,
    hookEnd: 1.8,
    payoffAt: 18.5,
  });
  assert.equal(
    late.props.endMap,
    undefined,
    "no room after the stamp: dropped, not squeezed",
  );
  const long = auditOverlay(
    buildOverlay({
      ...base,
      pin: {
        ...base.pin,
        label: "The very long name of a far away hillside place",
      },
    }),
    { durationSeconds: 20, hookEnd: 1, payoffAt: 10 },
  );
  assert.equal(long.props.pin!.label, "Today's spot");
});

test("the ticker's level at a time follows the changes", () => {
  const ch = [
    { t: 0, stars: 0 },
    { t: 3, stars: 2 },
  ];
  assert.equal(starsAt(ch, 2.9).stars, 0);
  assert.equal(starsAt(ch, 3).stars, 2);
});

test("the cut's segments map clip seconds onto the Short's clock", () => {
  const segs = [
    { start: 10, end: 15 },
    { start: 20, end: 30 },
  ];
  assert.equal(sourceToShort(segs, 12), 2);
  assert.equal(sourceToShort(segs, 21), 6);
  assert.equal(sourceToShort(segs, 17), undefined);
  const tr = buildTrack(
    raw([
      hud(10),
      hud(12, { stars: 2 }),
      hud(12.5, { stars: 2 }),
      hud(21, { stars: 2 }),
      hud(25, { stars: 0 }),
    ]),
    PROFILE,
  );
  const st = starsOnShort(tr, segs);
  assert.deepEqual(st[0], { t: 0, stars: 0 });
  assert.ok(st.some((x) => x.stars === 2));
  const spots = spotsOnPicture(
    {
      game: "gta6",
      spots: [
        {
          day: 1,
          episode: "a",
          island: 1,
          x: 150,
          y: 100,
          video: "",
          t: 0,
          at: "",
        },
        {
          day: 2,
          episode: "b",
          island: 2,
          x: 0,
          y: 0,
          video: "",
          t: 0,
          at: "",
        },
      ],
    },
    1,
    { x0: 100, y0: 50, scale: 0.5, width: 50, height: 50 },
    1,
  );
  assert.deepEqual(spots, [{ x: 0.5, y: 0.5, day: 1, today: true }]);
});

test("served HUD pictures become URLs on the render's file server", () => {
  const h = servedHud(
    {
      accent: "#f00",
      pin: {
        label: "x",
        sub: "y",
        from: 0,
        until: 2,
        mapImage: "hud\\pin.png",
      },
      endMap: {
        image: "hud/atlas/island_1.png",
        width: 1,
        height: 1,
        spots: [],
        title: "t",
        from: 1,
        until: 2,
      },
    },
    "http://127.0.0.1:9",
  );
  assert.equal(h.pin!.mapImage, "http://127.0.0.1:9/hud/pin.png");
  assert.equal(h.endMap!.image, "http://127.0.0.1:9/hud/atlas/island_1.png");
});

// ------------------------------------------------------------------ the live signal

test("HUD events score on the detector's scale and fold together when close", () => {
  assert.equal(scoreHudEvent({ kind: "wasted", t: 0, detail: "" }), 1.2);
  assert.equal(
    scoreHudEvent({ kind: "wanted_up", t: 0, value: 2, from: 1, detail: "" }),
    0,
  );
  assert.equal(
    scoreHudEvent({ kind: "wanted_up", t: 0, value: 5, from: 2, detail: "" }),
    1.6,
  );
  assert.equal(
    scoreHudEvent({ kind: "wanted_clear", t: 0, from: 4, detail: "" }),
    1,
  );
  const sig = hudSignals([
    { kind: "wanted_up", t: 10, value: 4, from: 3, detail: "3 to 4" },
    { kind: "wasted", t: 11, detail: "Wasted", text: "WASTED" },
    { kind: "area", t: 30, detail: "in X" },
  ]);
  assert.equal(sig.length, 1);
  assert.equal(sig[0]!.score, 1.2);
  assert.match(sig[0]!.detail, /Wasted.*3 to 4/);
});

test("the live HUD signal carries state across ten-second pieces", () => {
  const p1 = [
    hud(100, { stars: 3 }),
    hud(100.5, { stars: 3 }),
    hud(101, { stars: 3 }),
  ];
  const a = liveHudSignals([], p1, PROFILE);
  assert.equal(a.signals.length, 1, "0 to 3 stars is a moment");
  const p2 = [hud(110, { stars: 3 }), hud(110.5, { stars: 3 })];
  const b = liveHudSignals(a.kept, p2, PROFILE);
  assert.equal(b.signals.length, 0, "still 3 stars is not a new moment");
  const c = liveHudSignals(
    b.kept,
    [hud(120, { texts: { centre: ["WASTED"] } })],
    PROFILE,
  );
  assert.equal(c.signals[0]!.score, 1.2);
});

test("the detector takes a HUD signal as a fourth signal with a known peak", () => {
  const o: DetectOptions = {
    minScore: 1,
    perHour: 6,
    perDay: 30,
    gapMinutes: 2,
    warmupMinutes: 8,
    chatLagSeconds: 8,
    clipLagSeconds: 15,
    dayStart: () => 0,
  };
  const d = new LiveDetector(o);
  const t0 = Date.UTC(2026, 10, 19, 20);
  d.addHud({ at: t0, score: 1.2, detail: "Wasted" });
  d.addHud({ at: t0 + 200, score: 1.2, detail: "Wasted" }); // the same event again
  d.addHud({ at: t0 + 60_000, score: 0, detail: "nothing" });
  assert.deepEqual(d.poll(t0 + 10_000), []);
  const ready = d.poll(t0 + 120_000);
  assert.equal(ready.length, 1);
  assert.equal(ready[0]!.signals.length, 1);
  assert.equal(ready[0]!.signals[0]!.kind, "hud");
  assert.equal(
    ready[0]!.peakInClip,
    14,
    "the HUD knows the second, so the cut keeps the build-up",
  );
});

// ------------------------------------------------------------------ running the Python

test("the reader's command line keeps a VOD name with % in one argument and adds the Mac's turn-taking", () => {
  const s = hudSettings({ HUD_READER: "1" }, "darwin", "/Users/m");
  const vod = "/v/2026-11-02 GTA V 100% [v2917738469].mp4";
  const args = readArgs(s, {
    video: vod,
    profile: "p.json",
    out: "o.json",
    atlas: "a",
    start: 5,
    duration: 40,
  });
  assert.equal(args[args.indexOf("--video") + 1], vod);
  assert.ok(
    args.includes("--atlas") &&
      args.includes("--start") &&
      args.includes("--duration"),
  );
  const mac = commandFor(s, "mac", "read v1", args);
  assert.equal(mac.cmd, "/bin/bash");
  assert.equal(mac.args[0], "/Users/m/orch/macrun.sh");
  assert.ok(mac.args.includes(vod));
  assert.ok(mac.args.includes("-I"));
  const direct = commandFor(s, "direct", "x", args);
  assert.equal(direct.cmd, s.python);
  assert.equal(estimateMinutes(1913, 2), 6);
  assert.deepEqual(lastJson('{"progress": 3}\n{"ok": true, "n": 2}\n'), {
    ok: true,
    n: 2,
  });
});

test("a stream title picks the right profile, GTA VI never read as GTA V", () => {
  assert.equal(profileFor("GTA V 100%"), "gta5");
  assert.equal(profileFor("GTA VI day one"), "gta6");
  assert.equal(profileFor("Grand Theft Auto VI"), "gta6");
  assert.equal(profileFor("GTA 6 launch"), "gta6");
  assert.equal(profileFor("Silent Hill f"), undefined);
});
