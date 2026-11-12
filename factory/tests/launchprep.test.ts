import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  airTimeProblems,
  isGta6,
  leonidaLine,
  nextOpenSlot,
  releaseDateProblems,
} from "../src/launchprep.ts";
import {
  premakeDue,
  premakeFrom,
  readRun,
  spareFits,
  sparesDue,
  type RunEntry,
  type RunWhy,
} from "../src/shortrun.ts";
import { dayKey, localTime } from "../src/lanes.ts";

const tz = "Europe/London";
const why = (over: Partial<RunWhy> = {}): RunWhy => ({
  kind: "why",
  date: "2026-11-18",
  slot: "12:00",
  question: "Is GTA 6 out yet?",
  title: "GTA 6 Is Out in New Zealand Right Now",
  game: "Grand Theft Auto VI",
  arc: "a",
  angle: "b",
  sources: [{ url: "https://example.com/a", source: "Kotaku" }],
  ...over,
});

test("Leonida's page follows the launch: countdown, then server status on 18 and 19 Nov, then map and patch notes", () => {
  const before = leonidaLine(new Date("2026-11-18T10:59:00Z"))!;
  assert.match(
    before,
    /^Unlock times by country: https:\/\/leonida-intel\.com\/countdown\/\?utm_source=pulse \(from the same team\)$/,
  );
  const unlock = leonidaLine(new Date("2026-11-18T12:00:00Z"))!;
  assert.match(unlock, /\/gta-6-server-status\/\?utm_source=pulse/);
  assert.match(
    leonidaLine(new Date("2026-11-19T23:59:00Z"))!,
    /gta-6-server-status/,
  );
  const after = leonidaLine(new Date("2026-11-20T12:00:00Z"))!;
  assert.match(after, /\/map\/\?utm_source=pulse/);
  assert.match(after, /\/gta-6-patch-notes\/\?utm_source=pulse/);
  for (const l of [before, unlock, after]) {
    assert.doesNotMatch(l, /ref=/, "never ref=");
    assert.doesNotMatch(l, /martin|morr|orryy/i, "never the owner");
    assert.doesNotMatch(l, /\u2014/);
  }
  assert.equal(
    leonidaLine(new Date("2026-12-22T00:00:00Z")),
    undefined,
    "stops by itself",
  );
});

test("release date: November 19 alone is sent back, with New Zealand's November 18 it passes; other Nov 19 facts pass", () => {
  assert.equal(
    releaseDateProblems("GTA 6 is out November 19 on PS5 and Xbox.").length,
    1,
  );
  assert.equal(releaseDateProblems("GTA 6 launches 19 November.").length, 1);
  assert.deepEqual(
    releaseDateProblems(
      "GTA 6 is out from November 18 in New Zealand, then November 19 everywhere else.",
    ),
    [],
  );
  assert.deepEqual(
    releaseDateProblems(
      "Rockstar's free GTA 6 map is a download on November 19.",
    ),
    [],
  );
  assert.deepEqual(
    releaseDateProblems("Elden Ring is out November 19."),
    [],
    "only GTA VI",
  );
});

test("air time: a Short airing before New Zealand's unlock cannot say GTA 6 is out; after the last unlock it cannot say tonight", () => {
  const out = "GTA 6 is out in New Zealand right now. Here is your time.";
  assert.equal(
    airTimeProblems(out, new Date("2026-11-18T10:00:00Z")).length,
    1,
  );
  assert.deepEqual(airTimeProblems(out, new Date("2026-11-18T12:00:00Z")), []);
  assert.deepEqual(
    airTimeProblems(
      "GTA 6 unlocks tonight at midnight. Pre-load is live.",
      new Date("2026-11-17T18:30:00Z"),
    ),
    [],
  );
  assert.equal(
    airTimeProblems(
      "GTA 6 unlocks tonight in the US.",
      new Date("2026-11-19T12:00:00Z"),
    ).length,
    1,
  );
  assert.deepEqual(
    airTimeProblems("Elden Ring is out now.", new Date("2026-11-10T12:00:00Z")),
    [],
  );
  assert.ok(
    isGta6("Grand Theft Auto VI") && isGta6("GTA6") && !isGta6("GTA V"),
  );
});

test("pre-make: make_at, then make_hours_before, then RUN_PREMAKE_HOURS; premake false never; a near or taken slot is left alone", () => {
  const at = localTime("2026-11-18", "12:00", tz);
  assert.equal(premakeFrom(why(), tz, 0), undefined, "no setting, no pre-make");
  assert.equal(
    premakeFrom(why(), tz, 96)!.getTime(),
    at.getTime() - 96 * 3600_000,
  );
  assert.equal(
    premakeFrom(why({ make_hours_before: 24 }), tz, 96)!.getTime(),
    at.getTime() - 24 * 3600_000,
  );
  assert.equal(
    premakeFrom(
      why({ make_at: "2026-11-13T05:00:00Z", make_hours_before: 24 }),
      tz,
      96,
    )!.toISOString(),
    "2026-11-13T05:00:00.000Z",
  );
  assert.equal(
    premakeFrom(why({ premake: false, make_hours_before: 24 }), tz, 96),
    undefined,
  );
  const run: RunEntry[] = [
    why({ make_at: "2026-11-13T05:00:00Z" }),
    why({ slot: "18:30", question: "q2", make_at: "2026-11-14T05:00:00Z" }),
  ];
  const now = new Date("2026-11-13T06:00:00Z");
  assert.deepEqual(
    premakeDue(run, now, [], tz, 0, 105).map((d) => d.entry.slot),
    ["12:00"],
  );
  assert.deepEqual(
    premakeDue(run, now, [at], tz, 0, 105),
    [],
    "slot already taken",
  );
  assert.deepEqual(
    premakeDue(run, new Date(at.getTime() - 60 * 60_000), [], tz, 0, 105).map(
      (d) => d.entry.slot,
    ),
    ["18:30"],
    "inside the 12:00 slot's own lead the Why lane makes it; 18:30 is still pre-made",
  );
});

test("spares: made from make_at, fill only between from and until", () => {
  const spare: RunEntry = {
    kind: "spare",
    question: "q",
    title: "t",
    game: "Grand Theft Auto VI",
    arc: "a",
    angle: "b",
    sources: [
      { url: "https://example.com/a", source: "Rockstar", official: true },
    ],
    make_at: "2026-11-15T05:00:00Z",
    from: "2026-11-17",
    until: "2026-11-23",
  };
  assert.deepEqual(sparesDue([spare], new Date("2026-11-15T04:00:00Z")), []);
  assert.equal(sparesDue([spare], new Date("2026-11-15T05:00:00Z")).length, 1);
  assert.ok(
    !spareFits(spare as never, "2026-11-16") &&
      spareFits(spare as never, "2026-11-17") &&
      !spareFits(spare as never, "2026-11-24"),
  );
});

test("next open slot: the first slot after, clear of taken times by the gap, over the next days", () => {
  const lt = (d: string, h: string) => localTime(d, h, tz);
  const dk = (d: Date) => dayKey(d, tz);
  const after = lt("2026-11-18", "12:00");
  const slots = ["12:00", "17:00", "18:30", "22:00"];
  assert.equal(
    nextOpenSlot(after, slots, [], 60, lt, dk)!.getTime(),
    lt("2026-11-18", "17:00").getTime(),
  );
  assert.equal(
    nextOpenSlot(
      after,
      slots,
      [lt("2026-11-18", "17:00"), lt("2026-11-18", "18:00")],
      60,
      lt,
      dk,
    )!.getTime(),
    lt("2026-11-18", "22:00").getTime(),
  );
});

test("the shipped launch run: spares are GTA VI, 15 to 21 Nov Whys are pre-made, no release date said as Nov 19 alone", () => {
  const run = readRun(path.join(import.meta.dirname, "..", "launch_run.json"));
  const spares = run.filter((e) => e.kind === "spare");
  assert.equal(spares.length, 3);
  for (const e of spares) {
    assert.equal(e.game, "Grand Theft Auto VI");
    assert.ok(
      e.sources.every((x) => x.official),
      "confirmed facts only: official sources",
    );
  }
  for (const e of run) {
    if (e.kind !== "why" || e.date < "2026-11-15" || e.date > "2026-11-21")
      continue;
    const from = premakeFrom(e, tz, 0);
    assert.ok(from, `${e.date} ${e.slot} has a make time`);
    assert.ok(
      from!.getTime() <= new Date("2026-11-16T23:59:00Z").getTime(),
      `${e.date} ${e.slot} made by 16 Nov`,
    );
    assert.deepEqual(releaseDateProblems(`${e.title} ${e.angle}`), [], e.title);
  }
  for (const e of run) {
    if (e.kind === "doc") continue;
    assert.doesNotMatch(JSON.stringify(e), /\u2014/, "no em dashes");
  }
});
