import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recapToScript,
  validateRecapChapter,
  type RecapStory,
} from "../src/editorial/recap.ts";
import { keywordLead, pinnedComment } from "../src/editorial/seo.ts";

const para = (words: number, callout = false) => ({
  narration: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
  callout: callout
    ? {
        kind: "stat" as const,
        primary: "9 million",
        secondary: "views in a day",
      }
    : { kind: "none" as const, primary: "", secondary: "" },
  footage: { want: "gameplay" as const, keywords: ["x"] },
});
const chapter = () => ({
  paragraphs: [para(80, true), para(80), para(80)],
  claims: [{ claim: "A thing happened", section: "IGN" }],
});
const story = (i: number): RecapStory => ({
  episodeId: `ep_${i}`,
  headline: `Story ${i}`,
  game: `Game ${i}`,
  steamTerm: `Game ${i}`,
  views: 1000 - i,
  source: {
    title: "IGN / Gematsu",
    url: `https://example.com/${i}`,
    text: "sources",
  },
});

test("a recap chapter keeps to its word band and callout limit", () => {
  assert.deepEqual(validateRecapChapter(chapter()), []);
  assert.match(
    validateRecapChapter({
      ...chapter(),
      paragraphs: [para(40), para(40), para(40)],
    }).join(" "),
    /120 words/,
  );
  assert.match(
    validateRecapChapter({
      ...chapter(),
      paragraphs: [para(80, true), para(80, true), para(80, true)],
    }).join(" "),
    /Too many callouts/,
  );
});

test("the recap becomes a documentary-shaped script whose chapters point back at their Shorts", () => {
  const stories = [1, 2, 3, 4, 5].map(story);
  const s = recapToScript(
    {
      title: "This Week in Gaming",
      kicker: "GTA 6 breaks the internet",
      chapter_titles: stories.map((x) => `${x.game} news`),
      youtube: {
        title: "GTA 6 Trailer and More: Gaming News This Week",
        description: "d",
        tags: [],
      },
    },
    stories,
    stories.map(chapter),
    {
      intro: { narration: "intro", on_screen: "kicker" },
      outro: { label: "OUR READ", narration: "outro", on_screen: "line" },
    },
    2026,
  );
  assert.equal(s.recap, true);
  assert.equal(s.runtime, "long");
  assert.equal(s.evergreen_format, "documentary");
  assert.deepEqual(
    s.entries!.map((e) => e.from_episode),
    ["ep_1", "ep_2", "ep_3", "ep_4", "ep_5"],
  );
  assert.deepEqual(
    s.entries!.map((e) => e.rank),
    [5, 4, 3, 2, 1],
    "media is gathered per entry: chapter i is entry i",
  );
  const cards = s.beats.filter((b) => b.visual.kind === "chapter");
  assert.equal(cards.length, 5);
  assert.deepEqual(
    cards[0]!.visual.items,
    [],
    "a news chapter card carries no year or platform line",
  );
  assert.match(keywordLead(s), /^This week in gaming news/);
  assert.match(pinnedComment(s), /biggest one for you this week/);
});

test("viewer requests reach the topic pickers only once someone has asked", async () => {
  const { requestsBlock } = await import("../src/social/requests.ts");
  assert.equal(requestsBlock(undefined), "");
  assert.equal(requestsBlock({ at: "x", requests: [] }), "");
  assert.equal(
    requestsBlock({ at: "x", requests: [{ name: "Halo", count: 4 }, { name: "Metal Gear Solid", count: 2 }] }),
    "Viewers asked us to rank next (comments on our long videos, last 30 days): Halo (4), Metal Gear Solid (2).",
  );
});

test("only the long ranking's pinned comment asks what to rank next", async () => {
  const { goodScript } = await import("./helpers.ts");
  const entries = [{ rank: 1, game_title: "Halo 3", steam_search_term: "", year: 2007, platforms: "Xbox 360" }];
  assert.match(pinnedComment(goodScript({ entries, runtime: "long" } as any)), /which series should we rank next/);
  assert.doesNotMatch(pinnedComment(goodScript({ entries } as any)), /rank next/);
});

test("the recap's outro belongs to the story it is about, not the last chapter", async () => {
  const { entryOf } = await import("../src/render/longplan.ts");
  const seg = (kind: string, visual?: any) => ({ kind, visual, text: "", start: 0, end: 1 }) as any;
  const segments = [seg("hook"), seg("beat", { kind: "chapter", primary: "A" }), seg("beat", { kind: "none" }), seg("beat", { kind: "chapter", primary: "B" }), seg("beat", { kind: "chapter", primary: "C" }), seg("take")];
  assert.equal(entryOf(segments, 5), 2, "a documentary's outro belongs to the last chapter");
  assert.equal(entryOf(segments, 5, 0), 0, "a recap's outro belongs to the story named");
  assert.equal(entryOf(segments, 2, 0), 0, "beats are unaffected");
  assert.equal(entryOf(segments, 4, 0), 2);
});

test("a recap is never scoped to a single-player campaign because one story mentions one", async () => {
  const { scopeOf } = await import("../src/pipeline.ts");
  const { goodScript } = await import("./helpers.ts");
  const base = goodScript({ headline: "This Week in Gaming", youtube: { title: "MW4 Campaign Reviews and More: Gaming News This Week", description: "d", tags: [] } } as any);
  assert.equal(scopeOf(base), "campaign");
  assert.equal(scopeOf({ ...base, recap: true } as any), undefined);
});
