import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  faultSchedule,
  parseFaults,
  activeAt,
  FAULTS,
} from "../src/flightsim/faults.ts";
import { minimalOf } from "../src/flightsim/zodfill.ts";
import { checkAll, type SimRecord } from "../src/flightsim/invariants.ts";
import { runFlightSim } from "../src/flightsim/run.ts";
import { missedSlots } from "../src/outputwatch.ts";

const start = new Date("2026-11-16T00:00:00Z");

test("faults: parsed, scheduled one a day from day two, the ranking's fact check on a Saturday", () => {
  assert.deepEqual(parseFaults("none"), []);
  assert.equal(parseFaults("all").length, FAULTS.length);
  assert.throws(() => parseFaults("nope"), /unknown fault/);
  const w = faultSchedule(parseFaults("all"), start, 14);
  for (const f of FAULTS)
    assert.ok(
      w.some((x) => x.id === f.id),
      `${f.id} happens`,
    );
  assert.ok(
    w.every((x) => x.from.getTime() >= start.getTime() + 86_400_000),
    "day one is a clean baseline",
  );
  assert.equal(w.find((x) => x.id === "factcheck")!.from.getUTCDay(), 6);
  assert.deepEqual(
    activeAt(w, new Date(w[0]!.from.getTime() + 1000))
      .map((x) => x.id)
      .includes(w[0]!.id),
    true,
  );
});

test("the stand-in model answers any schema with something the schema accepts", () => {
  const s = z.object({
    a: z.string().min(30),
    b: z.array(z.number()).min(2),
    c: z.enum(["x", "y"]),
    d: z.string().optional(),
  });
  const v = minimalOf(s) as z.infer<typeof s>;
  assert.ok(s.safeParse(v).success);
  assert.equal(v.c, "x");
});

function record(over: Partial<SimRecord> = {}): SimRecord {
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
    cfg: {
      timezone: "Europe/London",
      newsSlots: [],
      whySlots: [],
      whyEnabled: false,
      dailyTarget: 5,
      shortsPerDayMax: 5,
      breakingPerDay: 1,
      breakingBigScore: 0,
      rumoursPerDay: 2,
      minUploadGapMinutes: 60,
      breakingWindow: "07:00-03:00",
    },
    faults: [],
    episodes: [],
    notices: [],
    videos: [0, 8, 16, 24, 32, 40].map((h, i) => ({
      id: `v${i}`,
      marker: `m${i}`,
      title: `t${i}`,
      description: "",
      uploadedAt: new Date(start.getTime() + h * 3_600_000).toISOString(),
      privacy: "public",
    })),
    crashes: [],
    spoilerWindows: [],
    maxSilentHours: 30,
    ...over,
  };
}

test("invariants: a pause with only a content fault on, a false YouTube alert and a duplicate all break", () => {
  assert.ok(
    checkAll(record()).every((r) => r.ok),
    "a quiet clean record passes",
  );
  const at = new Date(start.getTime() + 30 * 3_600_000).toISOString();
  const bad = record({
    faults: [
      {
        id: "factcheck",
        kind: "content",
        from: new Date(at),
        to: new Date(Date.parse(at) + 3_600_000),
      },
    ],
    notices: [
      {
        at,
        text: "⏸️ New stories are paused for 12 hours after x failed",
        ping: false,
        faults: ["factcheck"],
      },
      {
        at,
        text: "⚠️ Needs you: YouTube refused an upload (fact-check ...)",
        ping: true,
        faults: ["factcheck"],
      },
    ],
  });
  bad.videos.push({ ...bad.videos[1]!, id: "dup" });
  const failed = checkAll(bad)
    .filter((r) => !r.ok)
    .map((r) => r.id);
  assert.deepEqual(
    failed.sort(),
    ["no_cross_lane_pause", "no_duplicate_upload", "truthful_alerts"].sort(),
  );
  // The same pause during an expired login is the right call.
  const ok = record({
    faults: [
      {
        id: "token_expired",
        kind: "auth",
        from: new Date(at),
        to: new Date(Date.parse(at) + 3_600_000),
      },
    ],
    notices: bad.notices,
  });
  assert.ok(checkAll(ok).every((r) => r.ok));
});

test("the output watch counts only a slot that went by with nothing made", () => {
  const tz = "Europe/London";
  const now = new Date("2026-11-16T15:00:00Z");
  const since = new Date("2026-11-16T10:00:00Z");
  assert.deepEqual(
    missedSlots(["12:00", "18:30"], since, now, tz, [
      new Date("2026-11-16T12:00:00Z"),
    ]),
    [],
  );
  assert.equal(missedSlots(["12:00", "18:30"], since, now, tz, []).length, 1);
});

test("a simulated day with writer's notes in a Horizon Forbidden West Short: the video drops, nothing else stops", async () => {
  const r = await runFlightSim({ days: 2, faults: ["forbidden_west"] });
  for (const x of r.results)
    assert.ok(x.ok, `${x.id}: ${x.problems.join("; ")}`);
  assert.ok(r.stats.published >= 6, `${r.stats.published} published`);
  assert.ok(
    !r.record.notices.some((n) => /New stories are paused/.test(n.text)),
  );
});
