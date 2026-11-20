import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backCatalogueEntry,
  newAngles,
  upsertAbQueue,
  type AbQueueEntry,
} from "../src/backcatalogue.ts";
import {
  auditMarkdown,
  originalityRisks,
  titleSimilarity,
  titleSkeleton,
  commonWords,
  trailerSecondsOf,
  type Upload,
} from "../src/originality.ts";

const NOW = new Date("2026-11-01T12:00:00Z");

test("three new angles: shaped, distinct from the live title and each other, with thumbnail words", () => {
  const a = newAngles("Every Halo Campaign Ranked Worst to Best", [
    { title: "Top 10 Halo Campaigns", angle: "claim" },
    { title: "Halo 3 Isn't the Best Halo Campaign", angle: "claim" },
    { title: "Why Halo Reach Still Beats Halo Infinite", angle: "why" },
    { title: "Halo Infinite Is Better Than You Remember", angle: "claim" },
    {
      title: "How Halo Lost Its Way After Bungie Left",
      angle: "downfall",
      thumb: "after bungie",
    },
  ]);
  assert.deepEqual(
    a.map((x) => [x.angle, x.thumb]),
    [
      ["claim", "YOU'LL DISAGREE"],
      ["why", "THE REAL REASON"],
      ["downfall", "AFTER BUNGIE"],
    ],
  );
});

test("an entry keeps the live title first, two angles to test and the third for the next round", () => {
  const angles = newAngles("Why GTA 6 Took Thirteen Years | Documentary", [
    { title: "How GTA Online's Money Nearly Ended Single-Player GTA" },
    { title: "The GTA 6 Nobody Saw Before the Leak" },
    { title: "How Rockstar Came Back From the Biggest Leak in Gaming" },
  ]);
  const e = backCatalogueEntry({
    videoId: "2i7tdUD939s",
    episode: "ep_x",
    liveTitle: "Why GTA 6 Took Thirteen Years | Documentary",
    angles,
    thumbs: ["a.jpg", "b.jpg", "c.jpg"],
    publishAt: "2026-10-27T19:00:00Z",
    now: NOW,
  });
  assert.equal(e.titles.length, 3);
  assert.equal(e.titles[0], "Why GTA 6 Took Thirteen Years | Documentary");
  assert.equal(e.nextTitles?.length, 1);
  assert.equal(e.repackage, true);
});

test("the queue replaces an untested entry for the video and leaves a set-up test alone", () => {
  const old: AbQueueEntry = {
    videoId: "v1",
    episode: "e",
    titles: ["Old"],
    thumbs: [],
    publishAt: null,
    added: "x",
  };
  const fresh: AbQueueEntry = { ...old, titles: ["Old", "New A", "New B"] };
  assert.equal(upsertAbQueue([old], fresh, new Set()).action, "replaced");
  assert.deepEqual(
    upsertAbQueue([old], fresh, new Set()).list[0]!.titles,
    fresh.titles,
  );
  assert.equal(upsertAbQueue([], fresh, new Set()).action, "added");
  assert.equal(
    upsertAbQueue([old], fresh, new Set(["v1"])).action,
    "skipped (test already set up)",
  );
});

test("title skeletons, similarity and trailer seconds", () => {
  const common = commonWords(["A Slips Two Weeks to May", "B Slips One Week to June", "C Slips Four Weeks to July"]);
  assert.equal(
    titleSkeleton("Final Fantasy 14 Evercold Slips Four Weeks to February 23", common),
    titleSkeleton("Witchbrook Slips Two Weeks to March 3", common),
  );
  assert.ok(
    titleSimilarity(
      "Every Halo Campaign Ranked Worst to Best",
      "Every Core Halo Campaign Ranked Worst to Best",
    ) > 0.8,
  );
  assert.equal(
    trailerSecondsOf([
      { provenance: 'Official Steam trailer "X"', durationSeconds: 2 },
      { provenance: "owner recording", durationSeconds: 5 },
    ]),
    2,
  );
});

test("a trailer-led, templated near-twin ranks high; an original long video low; the list is markdown", () => {
  const all: Upload[] = [
    {
      videoId: "a",
      title: "Witchbrook Slips Two Weeks to March 3",
      views: 40,
      duration: 45,
      order: 0,
    },
    {
      videoId: "b",
      title: "Evercold Slips Four Weeks to February 23",
      views: 238,
      duration: 45,
      order: 1,
    },
    {
      videoId: "c",
      title: "Hollow Knight Slips One Week to May 2",
      views: 90,
      duration: 45,
      order: 2,
    },
    {
      videoId: "d",
      title: "Why GTA 6 Took Thirteen Years",
      views: 434,
      duration: 2051,
      order: 3,
    },
  ];
  const facts = new Map([
    ["a", { trailerSeconds: 40, durationSeconds: 45 }],
    ["d", { trailerSeconds: 60, durationSeconds: 2051 }],
  ]);
  const r = originalityRisks(all, facts);
  assert.equal(r.get("a")!.band, "high");
  assert.match(r.get("a")!.advice, /unlisting \(never deleting\)/);
  assert.equal(r.get("d")!.band, "low");
  const md = auditMarkdown(r, all, NOW, 20);
  assert.match(md, /^# Pre-review originality audit, 2026-11-01/);
  assert.match(md, /Nothing on YouTube was changed/);
  assert.ok(!/[—–]/.test(md));
});

test("the same title uploaded twice is high risk whatever its footage", () => {
  const all: Upload[] = [
    { videoId: "a", title: "Rayman Legends Retold Gives PS5 a Free Suit", views: 300, duration: 40, order: 0 },
    { videoId: "b", title: "Rayman Legends Retold Gives PS5 a Free Suit", views: 180, duration: 40, order: 1 },
  ];
  const r = originalityRisks(all, new Map([["a", { trailerSeconds: 0, durationSeconds: 40 }]]));
  assert.equal(r.get("a")!.band, "high");
  assert.match(r.get("a")!.advice, /near-identical title/);
});
