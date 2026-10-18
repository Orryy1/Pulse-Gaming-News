import { test } from "node:test";
import assert from "node:assert/strict";
import { engageTick, formatForDay } from "../src/social/engage.ts";
import { testDb, tmpDir, testConfig } from "./helpers.ts";
import type { Llm } from "../src/editorial/llm.ts";

test("community posts: once a day after the slot, the answer a day later, the comment count read once", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, {
    engageEnabled: true,
    engageSlot: "15:00",
    publicUrl: "https://pulse.orryy.com",
    timezone: "Europe/London",
  });
  let clock = new Date("2026-10-19T13:30:00Z"); // 14:30 London: before the slot
  const llm = {
    structured: async () => ({
      format: "guess",
      games: ["Super Mario World"],
      kicker: "Guess the game",
      question: "Name this game from one screenshot.",
      caption: "Your guess below. #gaming",
      answer: "Super Mario World",
    }),
  } as unknown as Llm;
  const posted: string[] = [];
  const comments: string[] = [];
  const deps = {
    db,
    cfg,
    llm,
    now: () => clock,
    headlines: async () => ["Nintendo Direct announced"],
    candidates: async () => ["Super Mario World"],
    igdbArt: async () => [
      {
        kind: "screenshot" as const,
        file: "assets/igdb_0.jpg",
        sourceUrl: "x",
        provenance: "IGDB",
      },
    ],
    render: async () => undefined,
    facebook: {
      photo: async (url: string) => (posted.push(`fb ${url}`), "fb1"),
      comment: async (_id: string, t: string) => (
        comments.push(`fb ${t}`),
        "c1"
      ),
      comments: async () => 4,
    },
    instagram: {
      image: async (url: string) => (posted.push(`ig ${url}`), "ig1"),
      comment: async (_id: string, t: string) => (
        comments.push(`ig ${t}`),
        "c2"
      ),
      comments: async () => 3,
    },
    notify: async () => true,
  };
  await engageTick(deps);
  assert.equal(posted.length, 0);
  clock = new Date("2026-10-19T14:05:00Z"); // 15:05 London
  await engageTick(deps);
  await engageTick(deps);
  assert.equal(posted.length, 2);
  assert.match(
    posted[0]!,
    /^fb https:\/\/pulse\.orryy\.com\/engage\/2026-10-19\/post_\d+\.jpg$/,
  );
  // A day on: the answer goes up once, and the comment count is read once.
  await db.query(
    `UPDATE events SET created_at = now() - interval '25 hours' WHERE kind = 'engage_post'`,
  );
  clock = new Date("2026-10-20T13:00:00Z");
  await engageTick(deps);
  await engageTick(deps);
  assert.deepEqual(comments, [
    "fb The answer: Super Mario World. How many of you got it? 🎮",
    "ig The answer: Super Mario World. How many of you got it? 🎮",
  ]);
  const [m] = await db.query<{ c: string }>(
    `SELECT detail->>'comments' AS c FROM events WHERE kind = 'engage_post'`,
  );
  assert.equal(m!.c, "7");
  await db.close();
});

test("the format rotates by day", () => {
  const days = [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ];
  const formats = new Set(days.map(formatForDay));
  assert.ok(formats.size >= 3, [...formats].join(","));
});
