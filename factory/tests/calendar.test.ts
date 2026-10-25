import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarBlock, parseCalendar, plannedFor } from "../src/calendar.ts";

const MD = `# Calendar
Some prose that is not an entry.
2026-11-19 news: GTA 6 release day. Review scores, unlock times.
- 2026-11-19 evergreen: Release-day guide: editions and prices.
2026-11-21 doc: The road to GTA 6.
2026-11-18 any: Launch eve explainer.
2026-11-20 [why]: Why GTA launches break records.
2026-11-99 news: a bad date is still a line, but a nonsense lane is "any"
2026-11-20 chaos: Something with an unknown lane.
`;

test("the calendar parses dated lines with an optional lane and ignores prose", () => {
  const e = parseCalendar(MD);
  assert.equal(e.length, 7);
  assert.deepEqual(e[0], {
    date: "2026-11-19",
    lane: "news",
    text: "GTA 6 release day. Review scores, unlock times.",
  });
  assert.equal(e[1]!.lane, "evergreen", "a bullet is fine");
  assert.equal(e[4]!.lane, "why", "brackets are fine");
  assert.equal(e[6]!.lane, "any", "an unknown lane counts for everyone");
});

test("each lane sees its own day's plan plus the ones for everyone, and the news desk sees what is coming", () => {
  const e = parseCalendar(MD);
  assert.deepEqual(
    plannedFor(e, "2026-11-19", "news").map((x) => x.text),
    ["GTA 6 release day. Review scores, unlock times."],
  );
  assert.deepEqual(
    plannedFor(e, "2026-11-18", "why").map((x) => x.text),
    ["Launch eve explainer."],
    "an 'any' entry reaches the why lane",
  );
  assert.equal(plannedFor(e, "2026-11-17", "news").length, 0);
  const block = calendarBlock(e, "2026-11-18", "news", [
    "2026-11-19",
    "2026-11-20",
  ]);
  assert.match(block, /Planned for today/);
  assert.match(block, /Launch eve explainer/);
  assert.match(block, /Coming up/);
  assert.match(block, /2026-11-19: GTA 6 release day/);
  assert.doesNotMatch(
    block,
    /road to GTA 6/,
    "a doc entry is not the news desk's",
  );
  assert.equal(
    calendarBlock(e, "2026-10-01", "why"),
    "",
    "a quiet day says nothing",
  );
});
