// The same-day angle for official drops (upgrade queue item 16, 11 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript, item } from "./helpers.ts";
import {
  DROP_ANGLE_RULE,
  detailListProblems,
  dropWait,
  excludeDropStories,
  isDropCoverage,
  isDropText,
  isOfficialDrop,
  isDropStory,
} from "../src/editorial/dropangle.ts";
import { writeScript } from "../src/editorial/editorial.ts";
import {
  pickStory,
  rankStories,
  type StoryCandidate,
} from "../src/editorial/explained.ts";
import type { Llm } from "../src/editorial/llm.ts";

test("an official drop is a trailer, screenshots or a reveal from the publisher, not a date, price or delay", () => {
  for (const t of [
    "Grand Theft Auto VI trailer 3 is out now",
    "New Ghost of Yotei screenshots show the snowy north",
    "Rockstar reveals the first look at Leonida's swamps",
    "Fable gameplay deep dive shows combat and towns",
  ])
    assert.ok(isDropText(t), t);
  for (const t of [
    "GTA 6 delayed to November 2026",
    "Switch 2 price revealed at $449",
    "Starfield expansion trailer confirms the price is $29.99",
    "Ubisoft layoffs hit the Assassin's Creed team",
    "Elden Ring sold 30 million",
  ])
    assert.ok(!isDropText(t), t);
  assert.equal(
    isOfficialDrop({
      headline: "GTA 6 trailer 3 is out now",
      hasOfficial: true,
    }),
    true,
  );
  assert.equal(
    isOfficialDrop({
      headline: "GTA 6 trailer 3 is out now",
      hasOfficial: false,
    }),
    false,
    "an outlet's trailer story without the publisher's own source is not an official drop",
  );
  assert.equal(
    isDropStory({
      headline: "GTA 6 trailer 3 is out now",
      official: true,
      event: "reveal",
    }),
    true,
  );
  assert.equal(
    isDropStory({
      headline: "GTA 6 trailer 3 is out now",
      official: true,
      event: "acclaim",
    }),
    false,
  );
});

test("a big official drop waits for the usual slot, but never past the hours", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  const drop = {
    headline: "GTA 6 trailer 3 is out now",
    official: true,
    event: "reveal",
    firstAt: "2026-11-10T14:00:00Z",
  };
  const o = { hours: 12, leadHours: 1.25, slotDue: false };
  assert.match(
    dropWait(drop, now, o)!,
    /keeps the usual slot.*12 hours.*DROP_ANGLE/,
  );
  assert.equal(
    dropWait(drop, now, { ...o, slotDue: true }),
    undefined,
    "a due slot takes it now",
  );
  assert.equal(
    dropWait({ ...drop, firstAt: "2026-11-10T04:00:00Z" }, now, o),
    undefined,
    "11 hours in, with the lead time, it goes now to land inside 12",
  );
  assert.equal(
    dropWait(
      { ...drop, event: "delay", headline: "GTA 6 delayed again" },
      now,
      o,
    ),
    undefined,
    "not a drop: as before",
  );
});

test("the writer gets the reframing rule only for a drop, and a detail list is sent back", async () => {
  const briefs: string[] = [];
  const llm = {
    structured: async (req: { content: string }) => {
      briefs.push(req.content);
      return goodScript();
    },
  } as unknown as Llm;
  const cluster = {
    hash: "drop",
    items: [
      item("GTA 6 trailer 3 is out now", "Rockstar Newswire", "official"),
    ],
  } as never;
  await writeScript(llm, cluster, [], { mustLabelRumour: false });
  assert.ok(!briefs[0]!.includes(DROP_ANGLE_RULE));
  await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    dropAngle: true,
  });
  assert.ok(briefs[1]!.includes(DROP_ANGLE_RULE));
  assert.match(DROP_ANGLE_RULE, /one reframing idea/);

  assert.deepEqual(detailListProblems(goodScript()), []);
  const list = goodScript({
    hook: "12 details you missed in GTA 6's third trailer.",
    beats: [
      {
        narration: "You can see a new pier in Vice City at sunset.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
      {
        narration: "We also spotted a police chopper over the Keys.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
  });
  const p = detailListProblems(list);
  assert.equal(p.length, 2);
  assert.match(p[0]!, /promises a list of details/);
  assert.match(p[1]!, /2 beats list things the trailer shows/);
});

const story = (o: Partial<StoryCandidate>): StoryCandidate => ({
  key: "gta 6",
  game: "GTA 6",
  headline: "GTA 6 trailer 3 is out now",
  headlines: [
    "GTA 6 trailer 3 is out now",
    "Everything in GTA 6 trailer 3",
    "GTA 6 trailer 3 breaks records",
  ],
  shorts: [
    {
      id: "s1",
      game: "GTA 6",
      headline: "GTA 6 trailer 3",
      score: 120,
      views: 5000,
      rumour: false,
      urls: [{ url: "https://ign.example/1", source: "IGN", title: "t" }],
    },
  ],
  sightings: [
    {
      hash: "h",
      headline: "GTA 6 trailer 3 is out now",
      score: 120,
      items: 9,
      official: true,
      sources: [
        "Rockstar Newswire",
        "IGN",
        "VGC",
        "Eurogamer",
        "GameSpot",
        "PC Gamer",
      ],
      rumour: false,
      summaries: [],
      urls: [
        {
          url: "https://rockstar.example/1",
          source: "Rockstar Newswire",
          title: "t",
        },
      ],
    },
  ],
  rumour: false,
  ...o,
});

test("long breakdowns are off: a trailer drop is never the week's explained video while DROP_ANGLE is on", () => {
  const trailer = story({});
  const shutdown = story({
    key: "dark souls 3",
    game: "Dark Souls 3",
    headline: "Dark Souls 3 servers are shutting down",
    headlines: ["Dark Souls 3 servers are shutting down"],
    shorts: [
      { ...trailer.shorts[0]!, id: "s2", game: "Dark Souls 3", views: 400 },
    ],
    sightings: [
      {
        ...trailer.sightings[0]!,
        hash: "d",
        headline: "Dark Souls 3 servers are shutting down",
        score: 60,
        sources: ["FromSoftware", "IGN", "Eurogamer"],
      },
    ],
  });
  const ranked = rankStories([trailer, shutdown]);
  // Off: the trailer wins on size alone, as before.
  assert.equal(pickStory(ranked)?.story.key, "gta 6");
  // On: it is excluded with the reason, and the next story carries the week.
  const on = excludeDropStories(ranked);
  assert.match(
    on.find((r) => r.story.key === "gta 6")!.score.excluded!,
    /long breakdowns are switched off/,
  );
  assert.equal(pickStory(on)?.story.key, "dark souls 3");
  // A drop story with a fight in it (a backlash over the trailer) is a story, not a breakdown.
  assert.equal(isDropCoverage(trailer.headlines, ["backlash"]), false);
  assert.equal(isDropCoverage(trailer.headlines, []), true);
  assert.equal(
    isDropCoverage(["GTA 6 trailer 3", "GTA 6 delayed", "GTA 6 price"], []),
    false,
  );
});
