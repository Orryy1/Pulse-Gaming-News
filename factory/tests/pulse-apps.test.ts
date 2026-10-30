import { test } from "node:test";
import assert from "node:assert/strict";
import { inEra } from "../src/render/components/packs/types.ts";
import { STYLES } from "../src/render/components/packs/pulse/apps.ts";
import {
  calendarDate,
  fitsPulseCalendar,
  monthGrid,
} from "../src/render/components/packs/pulse/PulseCalendar.tsx";
import { wallLook } from "../src/render/components/packs/pulse/PulseCalendarPaper.tsx";
import {
  distanceLabel,
  fitBox,
  fitsPulseMaps,
  geodesic,
  mapStops,
  roundDistance,
  stopPoints,
  toScreen,
} from "../src/render/components/packs/pulse/geo.ts";
import {
  labelSide,
  placeLabels,
} from "../src/render/components/packs/pulse/PulseMaps.tsx";
import { pastelOf } from "../src/render/components/packs/pulse/PulseMapsPaper.tsx";
import {
  BODIES,
  HANDSET_H,
  HANDSET_W,
  screenOf,
} from "../src/render/components/packs/pulse/handset.tsx";
import { iconAt } from "../src/render/components/packs/pulse/home.tsx";

const g = (
  kind: string,
  primary: string,
  secondary = "",
  items: string[] = [],
) => ({ kind, primary, secondary, items }) as never;

test("a calendar date needs a month and a year; seasons, quarters and bare years do not fit", () => {
  assert.deepEqual(calendarDate("September 17, 2013"), {
    year: 2013,
    month: 8,
    day: 17,
  });
  assert.deepEqual(calendarDate("17 September 2013"), {
    year: 2013,
    month: 8,
    day: 17,
  });
  assert.deepEqual(calendarDate("October 2002"), {
    year: 2002,
    month: 9,
    day: undefined,
  });
  assert.deepEqual(calendarDate("2013-09-17"), {
    year: 2013,
    month: 8,
    day: 17,
  });
  assert.equal(calendarDate("Fall 2025"), undefined);
  assert.equal(calendarDate("Spring 2013"), undefined);
  assert.equal(calendarDate("Q3 2025"), undefined);
  assert.equal(calendarDate("2013"), undefined);
  assert.equal(calendarDate("September 17"), undefined);
  // A day the month does not have is refused rather than drawn in the wrong week.
  assert.equal(calendarDate("February 30, 2013"), undefined);
  assert.deepEqual(calendarDate("February 29, 2012"), {
    year: 2012,
    month: 1,
    day: 29,
  });
  assert.equal(calendarDate("February 29, 2013"), undefined);
});

test("the month grid is the real calendar's, weeks from Sunday", () => {
  // 1 September 2013 was a Sunday, so GTA V's launch (the 17th) falls on a Tuesday.
  assert.deepEqual(monthGrid(2013, 8), { lead: 0, days: 30, rows: 5 });
  assert.equal((monthGrid(2013, 8).lead + 17 - 1) % 7, 2);
  // 1 October 2002 was a Tuesday.
  assert.deepEqual(monthGrid(2002, 9), { lead: 2, days: 31, rows: 5 });
  // February 2015 fills exactly four weeks; 2012 was a leap year; August 2026 needs six rows.
  assert.deepEqual(monthGrid(2015, 1), { lead: 0, days: 28, rows: 4 });
  assert.deepEqual(monthGrid(2012, 1), { lead: 3, days: 29, rows: 5 });
  assert.deepEqual(monthGrid(2026, 7), { lead: 6, days: 31, rows: 6 });
});

test("PulseCalendar fits a month-and-year date with a short event, never a season or a quarter", () => {
  assert.equal(
    fitsPulseCalendar(g("date", "September 17, 2013", "GTA V launches")),
    true,
  );
  assert.equal(
    fitsPulseCalendar(g("date", "October 2002", "Vice City arrives")),
    true,
  );
  assert.equal(fitsPulseCalendar(g("date", "May 2023", "")), true);
  assert.equal(
    fitsPulseCalendar(g("date", "Fall 2025", "GTA VI window")),
    false,
  );
  assert.equal(fitsPulseCalendar(g("date", "Q4 2025", "GTA VI window")), false);
  assert.equal(fitsPulseCalendar(g("date", "2008", "GTA IV launches")), false);
  assert.equal(
    fitsPulseCalendar(
      g(
        "date",
        "May 26, 2026",
        "Rockstar confirms the new release date for the game worldwide today",
      ),
    ),
    false,
  );
  assert.equal(fitsPulseCalendar(g("date", "", "GTA V launches")), false);
});

test("the paper calendar's look follows the date's period", () => {
  assert.deepEqual([1990, 1994, 1997, 2004, 2005, 2011].map(wallLook), [
    "print",
    "print",
    "band",
    "band",
    "gloss",
    "gloss",
  ]);
});

test("a Pulse map shows every named place or none, in story order", () => {
  const stops = mapStops(["Edinburgh", "New York City"]);
  assert.deepEqual(
    stops?.map((s) => s.label),
    ["Edinburgh", "New York City"],
  );
  // The label is the graphic's own spelling, the lookup forgiving.
  assert.equal(mapStops(["New York"])?.[0]?.label, "New York");
  assert.equal(mapStops(["Edinburgh", "Atlantis"]), undefined);
  assert.equal(mapStops([]), undefined);
  assert.equal(
    mapStops(["Edinburgh", "Glasgow", "London", "Leeds"]),
    undefined,
  );
  // The same place twice is not a route.
  assert.equal(mapStops(["New York", "NYC"]), undefined);
});

test("PulseMaps fits a 2-6 word heading and one to three known places", () => {
  assert.equal(
    fitsPulseMaps(g("map", "Where Rockstar North works", "", ["Edinburgh"])),
    true,
  );
  assert.equal(
    fitsPulseMaps(
      g("map", "From Edinburgh to Manhattan", "", [
        "Edinburgh",
        "New York City",
      ]),
    ),
    true,
  );
  assert.equal(
    fitsPulseMaps(
      g("map", "Rockstar's studios", "", ["Edinburgh", "Atlantis"]),
    ),
    false,
  );
  assert.equal(fitsPulseMaps(g("map", "Studios", "", ["Edinburgh"])), false);
  assert.equal(
    fitsPulseMaps(g("map", "Where Rockstar North works", "", [])),
    false,
  );
  assert.equal(
    fitsPulseMaps(
      g("map", "The long road from a small Scottish town to the world", "", [
        "Dundee",
      ]),
    ),
    false,
  );
});

test("the route's distance is the great circle, rounded, miles first", () => {
  const s = mapStops(["Edinburgh", "New York City"])!;
  assert.equal(distanceLabel(s), "3,260 mi / 5,240 km");
  assert.equal(
    distanceLabel(mapStops(["Edinburgh", "Glasgow"])!),
    "42 mi / 67 km",
  );
  assert.equal(distanceLabel(mapStops(["Edinburgh"])!), undefined);
  // Three stops: the two legs added.
  const three = distanceLabel(
    mapStops(["Edinburgh", "London", "New York City"])!,
  )!;
  assert.match(three, /^[\d,]+ mi \/ [\d,]+ km$/);
  assert.ok(Number(three.split(" ")[0]!.replace(",", "")) > 3260);
  assert.equal(roundDistance(41.5), 42);
  assert.equal(roundDistance(3259.06), 3260);
  assert.equal(roundDistance(0.2), 1);
});

test("a route across the date line stays continuous and ends on its places", () => {
  const [tokyo, la] = mapStops(["Tokyo", "Los Angeles"])!;
  const pts = stopPoints([tokyo!, la!]);
  assert.ok(Math.abs(pts[1]!.x - pts[0]!.x) < 180);
  const path = geodesic(tokyo!.place, la!.place, pts[0]!.x);
  for (let i = 1; i < path.length; i++)
    assert.ok(Math.abs(path[i]!.x - path[i - 1]!.x) < 10);
  assert.ok(Math.abs(path[0]!.x - 139.69) < 1e-6);
  assert.ok(Math.abs(path[path.length - 1]!.x - pts[1]!.x) < 1e-6);
  // The great circle from Edinburgh to New York bows north of both cities.
  const [ed, ny] = mapStops(["Edinburgh", "New York City"])!;
  const arc = geodesic(ed!.place, ny!.place, ed!.place.lon);
  assert.ok(Math.min(...arc.map((p) => p.y)) < stopPoints([ed!])[0]!.y);
});

test("the places fit inside the box they are given, west to east as on the globe", () => {
  const stops = mapStops(["Edinburgh", "New York City"])!;
  const box = { left: 40, top: 200, w: 420, h: 400 };
  const fit = fitBox(stops, box, 7);
  const [a, b] = stopPoints(stops).map((p) => toScreen(fit, p));
  for (const p of [a!, b!]) {
    assert.ok(p.x > box.left && p.x < box.left + box.w);
    assert.ok(p.y > box.top && p.y < box.top + box.h);
  }
  assert.ok(b!.x < a!.x); // New York lies west of Edinburgh.
  assert.ok(b!.y > a!.y); // and south of it.
});

test("place names sit away from the other pins, on screen and clear of each other", () => {
  assert.equal(labelSide([{ x: 400 }, { x: 100 }], 0, 500, 150), "left");
  assert.equal(labelSide([{ x: 400 }, { x: 100 }], 1, 500, 150), "right");
  assert.equal(labelSide([{ x: 250 }], 0, 500, 150), "right");
  // Two pins side by side: the second name moves below its pin rather than covering the first.
  const out = placeLabels(
    [
      { x: 100, y: 300 },
      { x: 140, y: 305 },
    ],
    [160, 160],
    46,
    1000,
    26,
  );
  assert.equal(out[0]!.dy, 0);
  assert.notEqual(out[1]!.dy, 0);
});

test("the paper map's country colours are fixed per country", () => {
  assert.equal(pastelOf("United Kingdom"), pastelOf("United Kingdom"));
  assert.match(pastelOf("France"), /^#[0-9a-f]{6}$/);
});

test("the handset's screen is PhoneStory's, and the home screen's icons sit on it", () => {
  for (const gen of ["classic", "slim", "edge"] as const) {
    const s = screenOf(gen);
    const b = BODIES[gen];
    assert.equal(s.w, HANDSET_W - b.side * 2);
    assert.equal(s.h, HANDSET_H - b.top - b.bottom);
    for (const app of ["calendar", "maps"] as const) {
      const at = iconAt(s, app);
      assert.ok(at.x > 0 && at.x < s.w && at.y > s.status && at.y < s.h);
    }
  }
  assert.deepEqual(screenOf("classic"), {
    w: 488,
    h: 808,
    left: 26,
    top: 126,
    radius: 4,
    status: 34,
    gen: "classic",
    skin: "orbit",
  });
});

test("phone apps belong to 2012 on, paper to the years before, and each style draws its own kind", () => {
  assert.equal(STYLES.PulseCalendar!.kind, "date");
  assert.equal(STYLES.PulseCalendarPaper!.kind, "date");
  assert.equal(STYLES.PulseMaps!.kind, "map");
  assert.equal(STYLES.PulseMapsPaper!.kind, "map");
  for (const name of ["PulseCalendar", "PulseMaps"]) {
    assert.equal(inEra(STYLES[name]!, 2013), true);
    assert.equal(inEra(STYLES[name]!, 2011), false);
    assert.equal(inEra(STYLES[`${name}Paper`]!, 2002), true);
    assert.equal(inEra(STYLES[`${name}Paper`]!, 2012), false);
  }
});
