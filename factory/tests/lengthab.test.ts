// The Why length test (WHY_LENGTH_AB) and the strong-fandom pick multiplier (LOOP_FANDOM_WEIGHT), 19 Nov 2026 audit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testConfig } from "./helpers.ts";
import {
  LENGTH_AB_SHORT,
  lengthArm,
  parseShortLengths,
  shortTarget,
  withLengthArm,
  withWhyTarget,
} from "../src/shortlengths.ts";
import { lengthArmFor, lengthsFor } from "../src/pipeline.ts";
import {
  lengthAbReading,
  splitReading,
  type SplitRow,
} from "../src/loopsplits.ts";
import {
  FANDOM_WEIGHT_KEY,
  pickWeight,
  withoutFandomWeight,
  WEIGHT_MAX,
} from "../src/loopfeedback.ts";
import { fandomWeight, type LoopPattern } from "../src/analyticsloop.ts";
import { redactedConfig } from "../src/config.ts";

test("lengthArm alternates by UTC day, and the day alone decides", () => {
  assert.equal(lengthArm("2026-11-22"), lengthArm("2026-11-22T23:59:00Z"));
  assert.notEqual(lengthArm("2026-11-22"), lengthArm("2026-11-23"));
  assert.equal(lengthArm("2026-11-22"), lengthArm("2026-11-24"));
  const week = ["20", "21", "22", "23", "24", "25", "26"].map((d) =>
    lengthArm(`2026-11-${d}`),
  );
  assert.ok(week.filter((a) => a === "short").length >= 3);
  assert.ok(week.filter((a) => a === "long").length >= 3);
});

test("a short-arm day puts The Why and The GTA File at 30-35 s; a long-arm day changes nothing", () => {
  const serial = withWhyTarget(
    parseShortLengths("news=25-35,gta_file=45-55"),
    true,
    {
      min: 45,
      max: 60,
    },
  );
  assert.deepEqual(withLengthArm(serial, "long"), serial);
  assert.deepEqual(withLengthArm(serial, undefined), serial);
  const short = withLengthArm(serial, "short");
  assert.deepEqual(short.why, LENGTH_AB_SHORT);
  assert.deepEqual(
    short.gta_file,
    LENGTH_AB_SHORT,
    "even over the GTA File's own band",
  );
  assert.deepEqual(short.news, { min: 25, max: 35 }, "news keeps its own lane");
  const t = shortTarget(short, "why")!;
  assert.equal(t.beatsMax, 4);
  assert.equal(t.capSeconds, 58);
});

test("lengthArmFor: only serial Why and GTA File Shorts, only with the test on, and the script's arm wins", () => {
  const off = testConfig("/tmp/x");
  assert.equal(off.whyLengthAb, false);
  const cfg = { ...off, whyLengthAb: true, whySerialEnabled: true };
  const why = {
    lane: "news",
    story_json: { why: { question: "q" } } as never,
    script_json: null,
    slot_at: "2026-11-22T17:00:00Z",
    created_at: "2026-11-21T09:00:00Z",
  };
  assert.equal(lengthArmFor(off, why), undefined, "test off");
  assert.equal(
    lengthArmFor({ ...cfg, whySerialEnabled: false }, why),
    undefined,
    "serial off",
  );
  assert.equal(
    lengthArmFor(cfg, why),
    lengthArm("2026-11-22"),
    "the slot's day",
  );
  assert.equal(
    lengthArmFor(cfg, { ...why, story_json: { headline: "news" } as never }),
    undefined,
    "a news Short is in no arm",
  );
  assert.equal(
    lengthArmFor(cfg, { ...why, story_json: { why: {}, run: true } as never }),
    undefined,
    "a planned launch run topic keeps its own rules",
  );
  const other = lengthArm("2026-11-22") === "short" ? "long" : "short";
  assert.equal(
    lengthArmFor(off, {
      ...why,
      script_json: { length_arm: { arm: other, band: "45-60" } } as never,
    }),
    other,
    "a written script keeps its arm",
  );
  const shortDay = ["2026-11-22", "2026-11-23"].find(
    (d) => lengthArm(d) === "short",
  )!;
  const lanes = lengthsFor(
    cfg,
    lengthArmFor(cfg, { ...why, slot_at: `${shortDay}T17:00:00Z` }),
  );
  assert.deepEqual(lanes.why, LENGTH_AB_SHORT);
  assert.match(
    String(redactedConfig({ ...cfg }).whySerial),
    /30-35s on even UTC days/,
  );
});

test("the loop's length reading: median 72-hour views and subscribers per 1,000 per arm, 15 a side to judge", () => {
  const now = new Date("2026-12-20T00:00:00Z");
  const rows: Array<SplitRow & { arm: string }> = [];
  for (let i = 0; i < 16; i++) {
    rows.push({
      episode_id: `s${i}`,
      posted_at: "2026-12-01T00:00:00Z",
      views: 1000,
      views_72h: 600,
      subs: 2,
      arm: "short",
    });
    rows.push({
      episode_id: `l${i}`,
      posted_at: "2026-12-01T00:00:00Z",
      views: 1000,
      views_72h: 300,
      subs: 2,
      arm: "long",
    });
  }
  rows.push({
    episode_id: "young",
    posted_at: "2026-12-19T00:00:00Z",
    views: 9,
    arm: "short",
  });
  const groups = splitReading(
    rows,
    (r) => (r as SplitRow & { arm: string }).arm,
    now,
  );
  const short = groups.find((g) => g.group === "short")!;
  assert.equal(short.shorts, 16, "under 72 hours left out");
  assert.equal(short.median, 600);
  assert.equal(short.per_1000, 2);
  assert.equal(lengthAbReading(groups).verdict, "keep short");
  assert.equal(
    lengthAbReading(groups.map((g) => ({ ...g, shorts: 10 }))).verdict,
    "too few",
  );
  assert.equal(
    lengthAbReading(
      groups.map((g) => (g.group === "short" ? { ...g, per_1000: 1.5 } : g)),
    ).verdict,
    "keep long",
    "subscribers more than 0.2 per 1,000 lower",
  );
});

const pattern = (p: Partial<LoopPattern>): LoopPattern => ({
  platform: "youtube",
  dim: "strong-identity fandom",
  group: "yes",
  n: 54,
  rest_n: 62,
  breakouts: 21,
  rest_breakouts: 6,
  median: 287,
  rest_median: 162,
  uses_rate: true,
  direction: "better",
  strength: "strong",
  ...p,
});

test("the fandom multiplier fills from YouTube's strong fandom pattern, inside the bounds, and eases off", () => {
  assert.equal(
    fandomWeight([pattern({})], undefined).weight,
    WEIGHT_MAX,
    "287 against 162 is capped at 1.15",
  );
  assert.equal(
    fandomWeight([pattern({ median: 170 })], undefined).weight,
    1.05,
  );
  assert.equal(
    fandomWeight([pattern({ strength: "moderate" })], undefined).weight,
    undefined,
  );
  assert.equal(
    fandomWeight([pattern({ platform: "instagram" })], undefined).weight,
    undefined,
  );
  assert.equal(
    fandomWeight([], 1.15).weight,
    1.1,
    "no longer strong: one step back",
  );
  assert.equal(
    fandomWeight([], 1.05).weight,
    undefined,
    "back at 1.00 the key goes",
  );
  assert.equal(
    fandomWeight(
      [pattern({ direction: "worse", median: 100, rest_median: 200 })],
      undefined,
    ).weight,
    0.85,
  );
});

test("pickWeight: the fandom key only for a fandom story, the product inside the bounds; off, the key is dropped", () => {
  const w = { [FANDOM_WEIGHT_KEY]: 1.15, "delay|news": 1.1 };
  assert.equal(pickWeight(w, "delay", "news", true), WEIGHT_MAX);
  assert.equal(pickWeight(w, "delay", "news", false), 1.1);
  assert.equal(pickWeight(w, "other", "news", true), 1.15);
  assert.deepEqual(withoutFandomWeight(w), { "delay|news": 1.1 });
  assert.equal(testConfig("/tmp/x").loopFandomWeight, false);
});
