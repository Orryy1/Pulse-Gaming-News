import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKey,
  dueSlot,
  franchiseKey,
  inWindow,
  isBreaking,
  localTime,
  nextWindowStart,
  quotaResetAt,
} from "../src/lanes.ts";
import { choosePublishAt } from "../src/pipeline.ts";
import { testConfig } from "./helpers.ts";
import type { StoryCluster } from "../src/discovery/cluster.ts";

const LONDON = "Europe/London";

test("local slot times follow UK clock changes", () => {
  // 16 Oct 2026 is British Summer Time (UTC+1); 1 Dec 2026 is GMT.
  assert.equal(
    localTime("2026-10-16", "13:00", LONDON).toISOString(),
    "2026-10-16T12:00:00.000Z",
  );
  assert.equal(
    localTime("2026-12-01", "13:00", LONDON).toISOString(),
    "2026-12-01T13:00:00.000Z",
  );
  assert.equal(
    dayKey(new Date("2026-10-16T23:30:00Z"), LONDON),
    "2026-10-17",
    "23:30Z is already tomorrow in BST",
  );
  assert.equal(
    inWindow(new Date("2026-10-16T22:30:00Z"), "07:00-23:00", LONDON),
    false,
    "23:30 London is outside the window",
  );
  assert.equal(
    inWindow(new Date("2026-10-16T21:30:00Z"), "07:00-23:00", LONDON),
    true,
  );
  assert.equal(
    nextWindowStart(
      new Date("2026-10-16T22:30:00Z"),
      "07:00-23:00",
      LONDON,
    ).toISOString(),
    "2026-10-17T06:00:00.000Z",
  );
});

test("a news slot is due a lead time ahead, is skipped once missed, and is never double-booked", () => {
  const plan = {
    slots: ["12:00", "16:00", "19:30"],
    leadMinutes: 75,
    graceMinutes: 30,
    timeZone: LONDON,
  };
  const at = (iso: string) => new Date(iso);
  // 09:00 London: nothing due yet (12:00 slot opens at 10:45).
  assert.equal(dueSlot(at("2026-10-16T08:00:00Z"), plan, []), undefined);
  // 10:50 London: the 12:00 slot is due.
  assert.equal(
    dueSlot(at("2026-10-16T09:50:00Z"), plan, [])?.toISOString(),
    "2026-10-16T11:00:00.000Z",
  );
  // 12:20 London: 12:00 was missed by 20 min, still within grace, so it is filled.
  assert.equal(
    dueSlot(at("2026-10-16T11:20:00Z"), plan, [])?.toISOString(),
    "2026-10-16T11:00:00.000Z",
  );
  // 13:00 London: 12:00 is gone; 16:00 is not due until 14:45.
  assert.equal(dueSlot(at("2026-10-16T12:00:00Z"), plan, []), undefined);
  // 15:00 London with the 16:00 slot already taken: nothing until 19:30 opens at 18:15.
  assert.equal(
    dueSlot(at("2026-10-16T14:00:00Z"), plan, [at("2026-10-16T15:00:00Z")]),
    undefined,
  );
  assert.equal(
    dueSlot(at("2026-10-16T17:20:00Z"), plan, [
      at("2026-10-16T15:00:00Z"),
    ])?.toISOString(),
    "2026-10-16T18:30:00.000Z",
  );
  // 23:00 London: tomorrow's first slot is not due.
  assert.equal(dueSlot(at("2026-10-16T22:00:00Z"), plan, []), undefined);
});

function cluster(over: Partial<StoryCluster> = {}): StoryCluster {
  return {
    hash: "h",
    headline: "Grand Theft Auto VI trailer 3 is out now",
    items: [],
    sources: ["Rockstar Newswire", "IGN"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: "2026-10-16T12:00:00Z",
    score: 90,
    ...over,
  };
}

test("breaking means official, fresh, above the bar and not a rumour", () => {
  const now = new Date("2026-10-16T12:30:00Z");
  const rule = {
    scoreMin: 75,
    maxAgeMinutes: 90,
    window: "07:00-23:00",
    timeZone: LONDON,
  };
  const fresh = {
    hash: "h",
    first_seen: "2026-10-16T12:05:00Z",
    last_seen: "2026-10-16T12:30:00Z",
    item_count: 3,
    has_official: true,
    max_score: 90,
  };
  assert.equal(isBreaking(cluster(), fresh, now, rule), true);
  assert.equal(
    isBreaking(cluster({ hasOfficial: false }), fresh, now, rule),
    false,
    "outlets alone never break",
  );
  assert.equal(
    isBreaking(cluster({ rumourSignals: true }), fresh, now, rule),
    false,
    "rumours never break",
  );
  assert.equal(
    isBreaking(cluster({ score: 60 }), { ...fresh, max_score: 60 }, now, rule),
    false,
    "below the bar",
  );
  assert.equal(
    isBreaking(
      cluster(),
      { ...fresh, first_seen: "2026-10-16T10:00:00Z" },
      now,
      rule,
    ),
    false,
    "first seen too long ago",
  );
  assert.equal(
    isBreaking(cluster(), undefined, now, rule),
    true,
    "without a sighting the newest item's time counts",
  );
  assert.equal(franchiseKey(cluster()), "grand theft");
  assert.equal(
    franchiseKey(cluster({ gameHint: "Grand Theft Auto VI" })),
    "grand theft",
  );
});

test("publish time: breaking goes now inside its window, news goes at its slot, and uploads keep their gap", () => {
  const cfg = testConfig("x", {
    minUploadGapMinutes: 60,
    breakingWindow: "07:00-23:00",
    youtubeVetoMinutes: 0,
  });
  const now = new Date("2026-10-16T12:00:00Z");
  assert.equal(
    choosePublishAt(cfg, now, { lane: "news_breaking", slot_at: null }),
    undefined,
    "breaking publishes now",
  );
  assert.equal(
    choosePublishAt(cfg, new Date("2026-10-16T22:30:00Z"), {
      lane: "news_breaking",
      slot_at: null,
    })?.toISOString(),
    "2026-10-17T06:00:00.000Z",
    "outside the window it waits for 07:00",
  );
  assert.equal(
    choosePublishAt(cfg, now, {
      lane: "news",
      slot_at: "2026-10-16T15:00:00Z",
    })?.toISOString(),
    "2026-10-16T15:00:00.000Z",
    "news publishes at its slot",
  );
  assert.equal(
    choosePublishAt(cfg, now, {
      lane: "news",
      slot_at: "2026-10-16T11:30:00Z",
    }),
    undefined,
    "a passed slot publishes now",
  );
  assert.equal(
    choosePublishAt(
      cfg,
      now,
      { lane: "news_breaking", slot_at: null },
      new Date("2026-10-16T11:30:00Z"),
    )?.toISOString(),
    "2026-10-16T12:30:00.000Z",
    "never within an hour of the last publish",
  );
  assert.equal(
    quotaResetAt(new Date("2026-10-16T12:00:00Z")).toISOString(),
    "2026-10-17T07:00:00.000Z",
    "quota resets at midnight Pacific (PDT)",
  );
});
