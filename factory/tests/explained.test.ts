import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb, testConfig, goodScript } from "./helpers.ts";
import type { Db } from "../src/db.ts";
import type { DiscordMessage } from "../src/approval/discord.ts";
import type { Services } from "../src/pipeline.ts";
import {
  EXPLAINED_PARTS,
  RUMOUR_FACTOR,
  STORY_MIN_SCORE,
  explainedBookendProblems,
  explainedOutline,
  explainedSource,
  explainedToScript,
  groupStories,
  packagingProblems,
  pickStory,
  rankStories,
  scoreStory,
  validateExplainedChapter,
  type ExplainedPackaging,
  type ExplainedStory,
  type StoryCandidate,
  type StoryShort,
  type StorySighting,
} from "../src/editorial/explained.ts";
import {
  chooseWeekStory,
  selectExplainedEpisode,
} from "../src/explainedstep.ts";
import { readWeeklyState } from "../src/weeklytest.ts";

const url = (source: string, n = 1) => ({
  url: `https://${source.toLowerCase().replace(/\W+/g, "")}.example/${n}`,
  source,
  title: `${source} story`,
});
const short = (
  o: Partial<StoryShort> & { id: string; game: string },
): StoryShort => ({
  headline: `${o.game} news`,
  score: 80,
  views: 100,
  rumour: false,
  urls: [url("IGN")],
  ...o,
});
const sighting = (
  o: Partial<StorySighting> & { hash: string; headline: string },
): StorySighting => ({
  score: 80,
  items: 3,
  official: false,
  sources: ["IGN", "Eurogamer", "PC Gamer"],
  rumour: false,
  summaries: [],
  urls: [url("Eurogamer", 2)],
  ...o,
});

test("the week's Shorts and clusters group into stories: a game inside another's name is the same story", () => {
  const groups = groupStories(
    [
      short({ id: "a", game: "Mass Effect 5", views: 9 }),
      short({ id: "b", game: "Mass Effect", views: 91 }),
      short({ id: "c", game: "Dark Souls 3", views: 1106 }),
    ],
    [
      sighting({
        hash: "h1",
        headline: "223,000 people sign petition to save Mass Effect",
        score: 109,
      }),
      sighting({
        hash: "h2",
        headline: "Leaf Blower Co. launches November 13",
        game: "Leaf Blower Co.",
      }),
    ],
  );
  const me = groups.find((g) => g.key === "mass effect")!;
  assert.deepEqual(me.shorts.map((s) => s.id).sort(), ["a", "b"]);
  assert.equal(me.sightings.length, 1);
  assert.equal(
    me.headline,
    "223,000 people sign petition to save Mass Effect",
    "the strongest cluster names it",
  );
  assert.ok(groups.find((g) => g.key === "dark souls 3"));
  assert.ok(
    groups.find((g) => g.key === "leaf blower co"),
    "a cluster with no Short stands alone",
  );
  assert.equal(groups.length, 3);
});

const candidate = (o: Partial<StoryCandidate> = {}): StoryCandidate => ({
  key: "dark souls 3",
  game: "Dark Souls 3",
  headline:
    "Dark Souls 2 and Dark Souls 3 are shutting down servers indefinitely, FromSoftware says",
  headlines: [
    "Dark Souls 2 and Dark Souls 3 are shutting down servers indefinitely, FromSoftware says",
  ],
  shorts: [short({ id: "c", game: "Dark Souls 3", views: 1106, score: 81 })],
  sightings: [
    sighting({
      hash: "d",
      headline: "x",
      score: 81,
      official: true,
      sources: ["Eurogamer", "Steam News"],
    }),
  ],
  rumour: false,
  ...o,
});

test("a story scores on breaking, coverage, our Shorts, demand and conflict; harm, one person's move and one outlet are skipped", () => {
  const s = scoreStory(candidate(), { weekBestViews: 1106 });
  assert.equal(s.excluded, undefined);
  assert.ok(s.conflictTerms.includes("shutting down"));
  assert.equal(s.parts.conflict, 20, "every headline is about the shutdown");
  // A launch with one input-lag headline among four is a launch: conflict counts for its share of the coverage.
  const launch = scoreStory(
    candidate({
      headlines: [
        "MW4 is live worldwide",
        "MW4 season 1 detailed",
        "MW4 passes $40 billion",
        "Input lag on Switch 2 in MW4",
      ],
    }),
    { weekBestViews: 1106 },
  );
  assert.equal(launch.parts.conflict, 11);
  assert.equal(
    s.parts.performance,
    25,
    "the week's best Short with no retention yet scores in full",
  );
  assert.equal(s.parts.demand, 7.5, "unknown demand counts as half");
  assert.ok(s.total >= STORY_MIN_SCORE);
  const high = scoreStory(candidate(), {
    weekBestViews: 1106,
    demand: {
      query: "Dark Souls 3",
      views: 9e6,
      hits: 5,
      level: "high",
      at: "",
    },
  });
  assert.equal(high.parts.demand, 15);
  const rumour = scoreStory(candidate({ rumour: true }), {
    weekBestViews: 1106,
  });
  assert.equal(rumour.total, Math.round(s.total * RUMOUR_FACTOR * 10) / 10);
  assert.match(
    scoreStory(
      candidate({
        headline: "Studio head accused of harassment",
        headlines: ["Studio head accused of harassment"],
      }),
      { weekBestViews: 1 },
    ).excluded ?? "",
    /harm to people/,
  );
  assert.match(
    scoreStory(
      candidate({
        headline: "Xbox COO Helen Chiang leaves Microsoft",
        headlines: ["Xbox COO Helen Chiang leaves Microsoft"],
      }),
      { weekBestViews: 1 },
    ).excluded ?? "",
    /career move/,
  );
  assert.match(
    scoreStory(
      candidate({
        sightings: [],
        shorts: [short({ id: "x", game: "X", urls: [url("IGN")] })],
      }),
      { weekBestViews: 1 },
    ).excluded ?? "",
    /only 1 outlet/,
  );
  // A game's own name is not a harm word: "Dead Space" is a game.
  assert.equal(
    scoreStory(
      candidate({
        game: "Dead Space",
        headline: "Dead Space remake delayed",
        headlines: ["Dead Space remake delayed"],
      }),
      { weekBestViews: 1 },
    ).excluded,
    undefined,
  );
});

test("the pick is the best story that is not skipped, and a weak week has none", () => {
  const safe = candidate();
  const unsafe = candidate({
    key: "y",
    headline: "Developer died",
    headlines: ["Developer died"],
    shorts: [short({ id: "y", game: "Y", views: 5000 })],
  });
  const ranked = rankStories([unsafe, safe]);
  assert.equal(
    ranked[0]!.story,
    safe,
    "a skipped story sorts last whatever it scores",
  );
  assert.equal(pickStory(ranked)?.story, safe);
  const weak = candidate({
    headline: "A patch is out",
    headlines: ["A patch is out"],
    shorts: [short({ id: "w", game: "W", views: 1, score: 10 })],
    sightings: [
      sighting({
        hash: "w",
        headline: "A patch is out",
        score: 10,
        sources: ["IGN", "VGC"],
      }),
    ],
  });
  assert.equal(
    pickStory(
      rankStories([
        weak,
        candidate({
          key: "z",
          shorts: [short({ id: "z", game: "Z", views: 1000 })],
          headline: "Z launches",
          headlines: ["Z launches"],
          sightings: [],
        }),
      ]),
    ),
    undefined,
  );
});

const story: ExplainedStory = {
  key: "dark souls 3",
  game: "Dark Souls 3",
  steamTerm: "Dark Souls 3",
  headline: "Dark Souls 2 and 3 servers shut down",
  headlines: [],
  shortIds: ["c"],
  urls: [url("Eurogamer"), url("Steam News")],
  summaries: ["FromSoftware said the servers are offline indefinitely."],
  rumour: false,
  score: 60,
  scoreLine: "",
};
const packaging = (
  o: Partial<ExplainedPackaging["youtube"]> = {},
  top: Partial<ExplainedPackaging> = {},
): ExplainedPackaging => ({
  question: "Why did FromSoftware switch off the Dark Souls servers?",
  title: "Why the Dark Souls Servers Went Dark",
  kicker: "FromSoftware's quiet switch-off",
  chapter_titles: [
    "The Servers Go Dark",
    "Inside the Decision",
    "What Players Lose",
    "What Comes Back",
  ],
  youtube: {
    title: "Why FromSoftware Really Switched Off Dark Souls",
    thumb_text: "SERVERS OFF",
    description:
      "FromSoftware switched off online play for two Dark Souls games. We explain why and what it means.",
    tags: [],
    ...o,
  },
  ...top,
});

test("packaging names the story, never 'this week', stays calm and labels a rumor", () => {
  assert.deepEqual(packagingProblems(packaging(), story), []);
  assert.match(
    packagingProblems(
      packaging({ title: "This Week in Gaming: Dark Souls Servers" }),
      story,
    ).join(" "),
    /weekly show/,
  );
  assert.match(
    packagingProblems(
      packaging({
        title:
          "Why the Dark Souls Server Crisis Is a Disaster for FromSoftware Fans Today",
      }),
      story,
    ).join(" "),
    /under 70|inflammatory/,
  );
  assert.match(
    packagingProblems(
      packaging({ title: "The Dark Souls Crisis" }),
      story,
    ).join(" "),
    /"Crisis" in the title is inflammatory/,
  );
  assert.match(
    packagingProblems(
      packaging({ title: "Dark Souls Servers in November 2026" }),
      story,
    ).join(" "),
    /date/,
  );
  // The game's own name is never read as an inflammatory word.
  assert.deepEqual(
    packagingProblems(
      packaging({ title: "Why Gears of War Really Stayed on Xbox" }),
      { ...story, game: "Gears of War: E-Day" },
    ).filter((p) => /inflammatory/.test(p)),
    [],
  );
  const r = { ...story, rumour: true };
  assert.match(packagingProblems(packaging(), r).join(" "), /rumor: the title/);
  assert.deepEqual(
    packagingProblems(
      packaging({
        title: "Why EA Reportedly Shelved Mass Effect",
        description:
          "EA reportedly shelved Mass Effect, according to a report. Not confirmed.",
      }),
      r,
    ),
    [],
  );
});

const para = (words: number, callout = false) => ({
  narration:
    Array.from({ length: words }, (_, i) =>
      i === 0 ? "Eurogamer" : `word${i}`,
    ).join(" ") + ".",
  callout: callout
    ? {
        kind: "quote" as const,
        primary: "offline indefinitely",
        secondary: "FromSoftware",
      }
    : { kind: "none" as const, primary: "", secondary: "" },
  footage: { want: "gameplay" as const, keywords: ["x"] },
});
const chapter = (
  paras = [para(120, true), para(120), para(120), para(120)],
) => ({
  paragraphs: paras,
  claims: [{ claim: "The servers went offline", section: "Eurogamer" }],
});

test("an explainer chapter keeps its word band, its callout limit, calm words and a rumor's label", () => {
  assert.deepEqual(
    validateExplainedChapter(chapter(), { game: "Dark Souls 3", index: 1 }),
    [],
  );
  assert.match(
    validateExplainedChapter(
      chapter([para(60), para(60), para(60), para(60)]),
    ).join(" "),
    /240 words; it must be 430-720/,
  );
  assert.match(
    validateExplainedChapter(
      chapter([para(120, true), para(120, true), para(120, true), para(120)]),
    ).join(" "),
    /Too many callouts/,
  );
  const angry = chapter();
  angry.paragraphs[1] = {
    ...para(120),
    narration: `${para(119).narration} It was a disaster.`,
  };
  assert.match(
    validateExplainedChapter(angry).join(" "),
    /"disaster" is inflammatory/,
  );
  assert.match(
    validateExplainedChapter(chapter(), { rumour: true, index: 0 }).join(" "),
    /rumor/,
  );
  const labeled = chapter();
  labeled.paragraphs[0] = {
    ...para(120),
    narration: `According to Insider Gaming, ${para(118).narration}`,
  };
  assert.deepEqual(
    validateExplainedChapter(labeled, { rumour: true, index: 0 }),
    [],
  );
});

test("the outline is the fixed four parts, and the script is a documentary marked as the explainer", () => {
  const o = explainedOutline(story, packaging(), 2026);
  assert.deepEqual(
    o.chapters.map((c) => c.chapter_title),
    packaging().chapter_titles,
  );
  assert.equal(o.chapters.length, EXPLAINED_PARTS.length);
  assert.ok(o.chapters.every((c) => c.game_title === "Dark Souls 3"));
  assert.match(o.chapters[1]!.focus, /Why it happened/);
  const src = explainedSource(
    story,
    [
      {
        ...url("Eurogamer"),
        text: "FromSoftware said the servers are offline indefinitely.",
      },
    ],
    ["Our Short said it."],
  );
  assert.match(
    src.text,
    /\[Eurogamer\][\s\S]*\[Coverage summaries\][\s\S]*\[Pulse Short/,
  );
  const bookends = {
    intro: { narration: "x", on_screen: "Servers off" },
    outro: { label: "WHAT TO WATCH", narration: "y", on_screen: "z" },
  };
  const script = explainedToScript(
    story,
    o,
    EXPLAINED_PARTS.map(() => ({ chapter: chapter(), source: src })),
    bookends,
  );
  assert.equal(script.evergreen_format, "documentary");
  assert.equal(script.runtime, "long");
  assert.equal(script.explained, true);
  assert.equal(script.recap, undefined);
  assert.equal(script.is_rumour, false);
  assert.deepEqual(
    script.sources,
    story.urls.map((u) => u.url),
  );
  assert.equal(
    script.beats.filter((b) => b.visual.kind === "chapter").length,
    4,
  );
  assert.equal(
    script.youtube.title,
    "Why FromSoftware Really Switched Off Dark Souls",
  );
});

test("the cold open opens on the fact, not 'this week' or a greeting, and a rumor's cold open names the report", () => {
  const b = (intro: string) => ({
    intro: { narration: intro, on_screen: "" },
    outro: {
      label: "WHAT TO WATCH",
      narration: "Watch the patch notes.",
      on_screen: "",
    },
  });
  assert.deepEqual(
    explainedBookendProblems(
      b("Two Dark Souls games lost online play overnight."),
      story,
    ),
    [],
  );
  assert.match(
    explainedBookendProblems(
      b("This week, Dark Souls lost its servers."),
      story,
    ).join(" "),
    /this week/,
  );
  assert.match(
    explainedBookendProblems(
      b("Welcome back. Dark Souls lost its servers."),
      story,
    ).join(" "),
    /greets/,
  );
  assert.match(
    explainedBookendProblems(b("EA shelved Mass Effect."), {
      ...story,
      rumour: true,
    }).join(" "),
    /rumor/,
  );
});

// ---- the selection, on a database --------------------------------------------------------------

async function seed(db: Db): Promise<void> {
  const add = async (
    id: string,
    game: string,
    headline: string,
    views: number,
    score: number,
    sources: string[],
  ) => {
    await db.query(
      `INSERT INTO episodes (id, story_hash, status, story_json, lane, script_json, youtube_video_id, publish_at)
       VALUES ($1, $1, 'published', $2, 'news', $3, $4, '2026-10-30T17:00:00Z')`,
      [
        id,
        JSON.stringify({
          headline,
          score,
          items: sources.map((s, i) => ({ ...url(s, i), summary: headline })),
        }),
        JSON.stringify(goodScript({ game_title: game, headline })),
        `vid_${id}`,
      ],
    );
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, views) VALUES ($1, '72h', $2)`,
      [id, views],
    );
  };
  await add(
    "ds",
    "Dark Souls 3",
    "Dark Souls 2 and Dark Souls 3 are shutting down servers indefinitely",
    1106,
    81,
    ["Eurogamer", "Steam News"],
  );
  await add("lb", "Leaf Blower Co.", "Leaf Blower Co. is out now", 40, 60, [
    "Gematsu",
    "Push Square",
  ]);
  await db.query(
    `INSERT INTO cluster_sightings (hash, headline, first_seen, last_seen, item_count, has_official, max_score, cluster_json)
     VALUES ('c1', 'Dark Souls 3 servers offline, FromSoftware says', '2026-11-02T10:00:00Z', '2026-11-02T12:00:00Z', 3, true, 81, $1)`,
    [
      JSON.stringify({
        sources: ["Eurogamer", "PC Gamer", "Steam News"],
        items: [{ ...url("PC Gamer"), summary: "Servers are offline." }],
      }),
    ],
  );
}

test("an explainer week picks the story from the factory's own data and creates the long-form episode", async () => {
  const db = await testDb();
  await seed(db);
  const now = new Date("2026-11-06T15:00:00Z");
  const posts: DiscordMessage[] = [];
  const cfg = testConfig("/tmp", {
    weeklyExplainedTest: true,
    demandCheck: false,
  });
  const { pick, ranked } = await chooseWeekStory({ db, cfg }, now);
  assert.equal(pick?.story.game, "Dark Souls 3");
  assert.equal(ranked.length, 2);
  // A rumoured story is the explainer only while rumours are on (INCLUDE_RUMOURS).
  await db.query(
    `UPDATE episodes SET script_json = jsonb_set(script_json, '{is_rumour}', 'true') WHERE id = 'ds'`,
  );
  await db.query(
    `UPDATE cluster_sightings SET cluster_json = jsonb_set(cluster_json, '{rumourSignals}', 'true')`,
  );
  const off = await chooseWeekStory(
    { db, cfg: { ...cfg, includeRumours: false } },
    now,
  );
  assert.notEqual(off.pick?.story.game, "Dark Souls 3");
  const on = await chooseWeekStory(
    { db, cfg: { ...cfg, includeRumours: true } },
    now,
  );
  assert.equal(on.pick?.story.rumour, true);
  await db.query(
    `UPDATE episodes SET script_json = jsonb_set(script_json, '{is_rumour}', 'false') WHERE id = 'ds'`,
  );
  await db.query(
    `UPDATE cluster_sightings SET cluster_json = jsonb_set(cluster_json, '{rumourSignals}', 'false')`,
  );
  const s = {
    db,
    cfg,
    now: () => now,
    notify: async (m: DiscordMessage) => void posts.push(m),
  } as unknown as Services;
  const due = new Date("2026-11-06T20:00:00Z");
  const made = await selectExplainedEpisode(s, now, due, "2026-11-06");
  assert.ok(made.id);
  const [ep] = await db.query<{
    lane: string;
    factcheck_json: any;
    slot_at: string;
  }>(`SELECT lane, factcheck_json, slot_at FROM episodes WHERE id = $1`, [
    made.id,
  ]);
  assert.equal(ep!.lane, "longform");
  assert.equal(ep!.factcheck_json.explained, true);
  assert.equal(ep!.factcheck_json.story.game, "Dark Souls 3");
  assert.ok(ep!.factcheck_json.story.urls.length >= 2);
  assert.equal(new Date(ep!.slot_at).toISOString(), due.toISOString());
  assert.match(
    String(posts[0]!.content),
    /explainer week: the story is \*\*Dark Souls 3 servers offline/,
  );
  assert.deepEqual(
    (await readWeeklyState(db)).entries.map((e) => e.arm),
    ["explained"],
  );
  // A week with nothing worth explaining says why, and makes nothing.
  const empty = await testDb();
  const none = await selectExplainedEpisode(
    { ...s, db: empty } as Services,
    now,
    due,
    "2026-11-06",
  );
  assert.equal(none.id, undefined);
  assert.match(none.reason ?? "", /no stories/);
  await db.close();
  await empty.close();
});
