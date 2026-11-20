import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers.ts";
import {
  auditLines,
  fitDescription,
  recentShortTexts,
  repeatedPhrases,
  repetitionProblems,
  shapePhrases,
  shapeTokens,
  verbatimLines,
} from "../src/authenticity.ts";

const deals = [
  {
    title: "Super Meat Boy Is $1.19 Right Now, Plus 4 More Steam Deals",
    hook: "",
    game: "Super Meat Boy",
  },
  {
    title: "To the Moon Is $1.49 Right Now, Plus 4 More Steam Deals",
    hook: "",
    game: "To the Moon",
  },
  {
    title: "House Flipper Is $1.99 Right Now, Plus 4 More Steam Deals",
    hook: "",
    game: "House Flipper",
  },
];

test("a line's shape: figures as #, the game's own words and possessives set aside", () => {
  assert.deepEqual(shapeTokens("GTA 6's Map Is 3x GTA 5's", "GTA 6"), [
    "map",
    "is",
    "#",
    "#",
  ]);
  const p = shapePhrases(
    "Super Meat Boy Is $1.19 Right Now, Plus 4 More Steam Deals",
    "Super Meat Boy",
  );
  assert.ok(p.has("right now"));
  assert.ok(p.has("plus # more"));
  assert.ok(!p.has("is #"), "a stop word and a figure are no template");
  assert.ok(
    !shapePhrases("Out now on PS5 and Xbox", "").has("ps5 xbox"),
    "platforms are not a template",
  );
});

test("a title that reuses a phrase three recent Shorts used is sent back once, naming the phrase", () => {
  const draft = {
    title: "The Last Campfire Is $1.49 Right Now, Plus 4 More Steam Deals",
    hook: "Five games under two dollars.",
    game: "The Last Campfire",
  };
  const p = repetitionProblems(draft, deals, 3);
  assert.equal(p.length, 1);
  assert.match(
    p[0]!,
    /^The YouTube title reuses "(right now|now plus|plus # more|more steam deals)[^"]*", which 3 Shorts in the last 30 days already used/,
  );
  assert.deepEqual(
    repetitionProblems(draft, deals.slice(0, 2), 3),
    [],
    "two is not yet a template",
  );
  assert.deepEqual(repetitionProblems(draft, deals, 0), [], "0 turns it off");
  assert.deepEqual(
    repetitionProblems(
      {
        title: "Hogwarts Legacy Drops to $5.99 on Steam",
        hook: "",
        game: "Hogwarts Legacy",
      },
      deals,
      3,
    ),
    [],
  );
  // The same game in three news titles is not a template: its name is set aside.
  const gta = [1, 2, 3].map((i) => ({
    title: `GTA 6 Story ${i} Lands`,
    hook: "",
    game: "GTA 6",
  }));
  assert.deepEqual(
    repetitionProblems(
      { title: "GTA 6 Trailer Breaks Records", hook: "", game: "GTA 6" },
      gta,
      3,
    ),
    [],
  );
  const hooks = [1, 2, 3].map(() => ({
    title: "",
    hook: "These five great Steam games cost less than a sandwich right now.",
    game: "",
  }));
  assert.match(
    repetitionProblems(
      {
        title: "",
        hook: "These five great Steam games cost less than lunch.",
        game: "",
      },
      hooks,
      3,
    )[0]!,
    /^The hook reuses/,
  );
  assert.equal(
    repeatedPhrases("Ranking EVERY Halo Game", "Halo", [], 3).length,
    0,
  );
});

test("the audit replays the rule in order and lists the most used phrases and word-for-word lines", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d));
  const items = [...deals, deals[0]!].map((x, i) => ({
    line: x.title,
    game: x.game,
    at: day(10 + i),
  }));
  const a = auditLines(items, 3);
  assert.equal(a.items, 4);
  assert.equal(a.repeatShare, 0.25, "only the fourth meets three before it");
  assert.ok(a.top.some((t) => t.phrase === "right now" && t.count === 4));
  // Older than 30 days does not count.
  const spread = items.map((x, i) => ({ ...x, at: day(1 + i * 20) }));
  assert.equal(auditLines(spread, 3).repeatShare, 0);
  assert.deepEqual(
    verbatimLines([
      "Same line here, word for word.",
      "Same line here, word for word.",
      "short",
    ]),
    [{ line: "Same line here, word for word.", count: 2 }],
  );
});

test("the description keeps its AI disclosure and channel line however long the credits run", () => {
  const credits = `\nFootage: ${Array.from({ length: 400 }, (_, i) => `https://www.pexels.com/video/clip-${i}/`).join(", ")}`;
  const tail = [
    "\nNarration: AI-generated synthetic voice. Visuals: official publisher material, credited.",
    "\nPulse Gaming News: the stories behind the games.",
    "#GTA #Gaming",
  ];
  const d = fitDescription(["Lead line.", "", "Body text.", credits], tail);
  assert.ok(Buffer.byteLength(d, "utf8") <= 4900);
  assert.ok(d.startsWith("Lead line.\nBody text.\n"));
  assert.ok(
    d.includes("Narration: AI-generated synthetic voice."),
    "the disclosure survives",
  );
  assert.ok(d.endsWith("#GTA #Gaming"));
  assert.match(
    d,
    /clip-\d+\/?,?\.\.\.\n/,
    "the credits are cut at a word with an ellipsis",
  );
  // A short description is unchanged: the old join, blanks dropped.
  assert.equal(fitDescription(["a", "", "b"], ["c", ""]), "a\nb\nc");
  // Bytes, not characters: YouTube counts 5,000 bytes.
  const wide = fitDescription(["®".repeat(3000)], ["tail"]);
  assert.ok(Buffer.byteLength(wide, "utf8") <= 4900 && wide.endsWith("tail"));
});

test("recent Short texts: the last 30 days, Shorts only, failures and twins left out", async () => {
  const db = await testDb();
  const add = (
    id: string,
    status: string,
    lane: string,
    created: string,
    script: object,
  ) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, script_json, lane, created_at) VALUES ($1, $1, $2, '{"headline":"x","items":[]}', $3, $4, $5)`,
      [id, status, JSON.stringify(script), lane, created],
    );
  const s = (title: string) => ({
    youtube: { title },
    hook: `${title} hook`,
    game_title: "G",
  });
  await add("a", "published", "news", "2026-10-25T10:00:00Z", s("Kept"));
  await add("b", "failed", "news", "2026-10-26T10:00:00Z", s("Failed"));
  await add("c", "published", "twin", "2026-10-26T10:00:00Z", s("Twin"));
  await add("d", "published", "longform", "2026-10-26T10:00:00Z", {
    ...s("Long"),
    runtime: "long",
  });
  await add("e", "published", "news", "2026-09-01T10:00:00Z", s("Old"));
  const texts = await recentShortTexts(
    db,
    "zzz",
    new Date("2026-11-01T12:00:00Z"),
  );
  assert.deepEqual(texts, [{ title: "Kept", hook: "Kept hook", game: "G" }]);
  await db.close();
});
