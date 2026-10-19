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
